// The personal code's part of the e2e mock (SQL section I,
// docs/study/personal-code.md). The shared mock loads it for every script
// (every plugin in e2e/study/mocks/ is), so by default it changes nothing:
// db.codes.on is false and /api/study/health keeps "codes" false, as on a
// database before part 9, so no other script ever sees the code's screens.
// e2e/study/code.cjs turns it on:
//   /api/study/health    the base answer, with section I in the schema and "codes": true
//   /api/study/code      the code in, a new session for the code's own user out
//                        (the mock's auth.issue, as the server's sign-in does);
//                        401 "code not found" for anything else; each call in
//                        db.codes.redeems
//   rpc/study_code_new, study_code_status, study_code_seen, study_code_issue
//                        (only the group's creator, never for oneself),
//                        study_code_finish, and study_member_saved ("יש קוד")
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const now = () => new Date().toISOString();

function makeCode() {
  let c = "";
  for (let i = 0; i < 16; i++) c += ALPHABET[Math.floor(Math.random() * 32)];
  return c.match(/.{4}/g).join("-");
}
const norm = (raw) => {
  const x = String(raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  return /^[2-9A-HJ-NP-Z]{16}$/.test(x) ? x : "";
};

module.exports = {
  seed(db) {
    db.codes = { on: false, byUser: new Map(), redeems: [], issued: [] };
  },
  async rest({ path, body, who, db, json: answer, refuse: deny, check }) {
    if (!db.codes.on) return undefined;
    // Handled: true (the mock's own json resolves to nothing).
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const fn = path.startsWith("/rest/v1/rpc/") ? path.slice("/rest/v1/rpc/".length) : "";
    if (!/^study_code_(new|status|seen|issue|finish)$/.test(fn) && fn !== "study_member_saved") return undefined;
    check.rpc(fn, body, `POST ${path}`);
    if (!who) return refuse("not signed in");
    const member = (id) => db.members.some((m) => m.user_id === id);
    const set = (userId, by) => {
      const code = makeCode();
      const replaced = db.codes.byUser.has(userId);
      db.codes.byUser.set(userId, { hash: norm(code), created_at: now(), issued_by: by, seen_at: null, replaced, used_at: null, uses: 0 });
      return code;
    };
    switch (fn) {
      case "study_code_new":
        if (!member(who.id)) return refuse("no code here");
        return json(set(who.id, who.id));
      case "study_code_status": {
        const c = db.codes.byUser.get(who.id);
        const byOpener = Boolean(c && c.issued_by !== who.id);
        const byName = byOpener ? (db.members.find((m) => m.user_id === c.issued_by)?.name ?? null) : null;
        return json([
          {
            has_code: Boolean(c),
            created_at: c?.created_at ?? null,
            by_opener: byOpener,
            by_name: byName,
            notice: byOpener && !c.seen_at,
            replaced: Boolean(c?.replaced),
            used_at: c?.used_at ?? null,
            uses: c?.uses ?? 0,
          },
        ]);
      }
      case "study_code_seen": {
        const c = db.codes.byUser.get(who.id);
        if (c && !c.seen_at) c.seen_at = now();
        return json(null);
      }
      case "study_code_issue": {
        if (db.group.created_by !== who.id) return refuse("not the creator");
        if (!db.members.some((m) => m.user_id === body.p_user && m.group_id === body.p_group)) return refuse("member not found");
        db.codes.issued.push({ by: who.id, user: body.p_user });
        return json(set(body.p_user, who.id));
      }
      case "study_code_finish":
        return json(null);
      case "study_member_saved":
        return json(db.members.map((m) => ({ user_id: m.user_id, saved: db.codes.byUser.has(m.user_id) })));
    }
    return undefined;
  },
  async api(req, res, db, body, { auth }) {
    if (!db.codes.on) return undefined;
    const p = new URL(req.url, "http://x").pathname;
    const send = (status, b) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(b));
      return true;
    };
    if (p === "/api/study/health") {
      return send(200, { ok: true, anthropicKey: true, supabase: true, worker: true, workerOk: true, budgetUsd: db.budgetUsd, schema: { ...db.schema, I: 1 }, schemaOk: true, features: {}, codes: true });
    }
    if (p !== "/api/study/code") return undefined;
    if (req.method !== "POST") return send(405, { error: "POST only" });
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return send(415, { error: "json only" });
    if (req.headers.authorization) db.codes.redeems.push({ withToken: true });
    const code = norm(body?.code);
    const hit = code ? [...db.codes.byUser.entries()].find(([, c]) => c.hash === code) : undefined;
    db.codes.redeems.push({ code, found: Boolean(hit) });
    if (!hit || !db.members.some((m) => m.user_id === hit[0])) return send(401, { error: "code not found" });
    hit[1].used_at = now();
    hit[1].uses += 1;
    return send(200, auth.issue(hit[0]));
  },
};
