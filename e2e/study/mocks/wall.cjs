// Package J's part of the e2e mock (spec §8.3; §12.5.J): the association
// wall. The shared mock loads it for every script (every plugin in
// e2e/study/mocks/ is), so a build with VITE_STUDY_WALL finds its tables and
// RPCs in any flow. It plays section J as the SQL does
// (supabase/study-schema.sql, J's markers), with the codes the SQL raises:
//   study_aid_drafts            GET with eq filters, order, limit (the group's)
//   rpc/study_aid_post          "bad fact", "bad body", "unknown slide", "bad photo"
//                               (another member's upload, or one used already),
//                               "bad figure", "bad remix", "bad draft", "bad credit",
//                               "daily_limit" (30)
//   rpc/study_aid_edit|_delete  the author only ("aid not found"); delete answers the photo
//   rpc/study_aid_vote          "own aid"; {funny, stuck, check}
//   rpc/study_aid_flag          "not yours"; "not_ok" hides it from all but its author
//   rpc/study_aid_pin, _credit_requests, _credit_answer ("credit not found"), _week,
//   rpc/study_aid_wall          the caller's view: no author for an entry without a name
//   rpc/study_aid_hint, _for_cards   the caller's pin, else the paragraph's winner
//   rpc/study_my_uses_today     p_kind "mnemonic": the caller's paid draft requests today
//   POST /api/study/ai {op:"mnemonic"}   saved drafts for the same text: {"t":"saved"}, no
//                               reservation; else one reservation, three drafts streamed
//                               (db.wallDelayMs apart), saved, {"t":"done"}
//   POST /api/study/ai {op:"wall_check"} the hold ("busy"/"checked"), one reservation, the
//                               verdict (db.wallVerdict, else ok), the winner again
//   Storage: a single signed URL; DELETE removes the file (db.files)
// Realtime: study_aids rows only, never an author (notify on every change).
// Every op call is kept in db.wallOps, every reservation in db.wallReserves.
const crypto = require("crypto");

const now = () => new Date().toISOString();
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const uuidJ = (n) => `a1d0${String(n).padStart(4, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userOfToken = (token) => {
  const m = /^tok-(\d+)$/.exec(token || "");
  return m ? `${m[1].padStart(8, "0")}-0000-4000-8000-${m[1].padStart(12, "0")}` : null;
};
/** The published row (no author column: decision 10). */
const PUBLIC = ["id", "group_id", "lecture_id", "part_idx", "anchor", "quote", "drug", "kind", "body", "fact", "slides", "photo", "figure", "remix_of", "draft_id", "draft_no",
  "named_by", "credit_id", "funny_n", "stuck_n", "flag", "flagged_by", "check_state", "checked_at", "check_note", "edited_at", "created_at"];
const pub = (a) => Object.fromEntries(PUBLIC.map((k) => [k, a[k] === undefined ? null : a[k]]));
const nameOf = (db, id) => (id ? (db.members.find((m) => m.user_id === id)?.name ?? "") : null);
const len = (s) => [...String(s ?? "").trim()].length;

/** The block at `anchor` of a part, as blockSources numbers a part of headings and paragraphs (the
 *  scripts use paragraphs before any list): its text, for the op's sha256. */
function blockText(md, anchor) {
  return (md.split(/\n\s*\n/)[anchor] ?? "").trim();
}
const sha = (t) => crypto.createHash("sha256").update(t.trim(), "utf8").digest("hex");

function rewin(db, lecture, part, anchor) {
  const here = db.aids.filter((a) => a.lecture_id === lecture && a.part_idx === part && a.anchor === anchor && !a.flag && a.funny_n + a.stuck_n >= 2);
  const order = (x, y) => y.funny_n + y.stuck_n - (x.funny_n + x.stuck_n) || y.stuck_n - x.stuck_n || (x.created_at < y.created_at ? -1 : 1);
  const top = here.filter((a) => a.check_state === "ok").sort(order)[0];
  db.aidWinners = db.aidWinners.filter((w) => !(w.lecture_id === lecture && w.part_idx === part && w.anchor === anchor));
  if (top) db.aidWinners.push({ lecture_id: lecture, part_idx: part, anchor, aid_id: top.id, since: now() });
  const best = here.filter((a) => a.check_state !== "bad").sort(order)[0];
  return best && best.check_state === "no" ? best.id : null;
}

function wallRow(db, a, me, week) {
  const l = db.lectures.find((x) => x.id === a.lecture_id);
  return {
    id: a.id, lecture_id: a.lecture_id, lecture_title: l?.title ?? "", part_idx: a.part_idx, anchor: a.anchor, quote: a.quote, drug: a.drug, kind: a.kind,
    body: a.body, fact: a.fact, slides: a.slides, photo: a.photo, figure: a.figure,
    author: a.named_by ? nameOf(db, a.named_by) : null,
    credit: a.credit_id ? nameOf(db, a.credit_id) : null,
    funny_n: a.funny_n, stuck_n: a.stuck_n,
    my_funny: db.aidVotes.some((v) => v.aid_id === a.id && v.user_id === me && v.kind === "funny"),
    my_stuck: db.aidVotes.some((v) => v.aid_id === a.id && v.user_id === me && v.kind === "stuck"),
    mine: db.aidAuthors.some((w) => w.aid_id === a.id && w.user_id === me),
    pinned: db.aidPins.some((p) => p.aid_id === a.id && p.user_id === me),
    on_cards: db.aidWinners.some((w) => w.aid_id === a.id),
    week: a.id === week,
    flag: a.flag, flagged_by: a.flagged_by ? nameOf(db, a.flagged_by) : null, check_note: a.check_note,
    remix_of: a.remix_of, draft_id: a.draft_id, draft_no: a.draft_no, created_at: a.created_at,
  };
}

function weekOf(db) {
  const since = Date.now() - 7 * 86_400_000;
  const by = new Map();
  for (const v of db.aidVotes) if (Date.parse(v.created_at) >= since) by.set(v.aid_id, (by.get(v.aid_id) ?? 0) + 1);
  const rows = [...by].filter(([id, n]) => n >= 2 && !db.aids.find((a) => a.id === id)?.flag).sort((x, y) => y[1] - x[1]);
  return rows[0]?.[0] ?? null;
}

function cardOf(db, id) {
  return db.cardsMock?.cards.find((c) => c.id === id) ?? null;
}
function aidForCard(db, card, me) {
  if (!card || card.anchor === null || card.anchor === undefined) return null;
  const pin = db.aidPins.find((p) => p.user_id === me && p.lecture_id === card.lecture_id && p.part_idx === card.part_idx && p.anchor === card.anchor);
  const win = db.aidWinners.find((w) => w.lecture_id === card.lecture_id && w.part_idx === card.part_idx && w.anchor === card.anchor);
  const id = pin?.aid_id ?? win?.aid_id;
  const a = id && db.aids.find((x) => x.id === id);
  return a ? { a, pinned: Boolean(pin), since: pin?.created_at ?? win.since } : null;
}

module.exports = {
  seed(db) {
    db.aids = [];
    db.aidAuthors = [];
    db.aidVotes = [];
    db.aidPins = [];
    db.aidCredits = [];
    db.aidWinners = [];
    db.aidDrafts = [];
    db.wallOps = [];
    db.wallReserves = [];
    db.wallCalls = [];
    db.wallSeq = 0;
    db.wallDelayMs = 300;
    db.wallVerdict = null;
  },

  async rest({ method, path, query, body, who, db, notify, json: answer, refuse: deny, check }) {
    // The base mock awaits a plugin's answer: true says "handled" (route.fulfill resolves to undefined).
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const me = who?.id ?? null;
    const member = me && db.members.some((m) => m.user_id === me);
    const where = `${method} ${path}`;

    if (path === "/rest/v1/study_aid_drafts" && method === "GET") {
      let rows = member ? [...db.aidDrafts] : [];
      for (const [k, v] of query) {
        if (["select", "order", "limit", "offset"].includes(k)) continue;
        check.cols("study_aid_drafts", [k], where);
        const arg = v.replace(/^eq\./, "");
        rows = rows.filter((r) => String(r[k]) === arg);
      }
      const order = query.get("order");
      if (order) {
        const [col, dir] = order.split(".");
        rows.sort((a, b) => (a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (dir === "desc" ? -1 : 1)));
      }
      if (query.get("limit")) rows = rows.slice(0, Number(query.get("limit")));
      const cols = (query.get("select") || "*").split(",").map((c) => c.trim());
      check.cols("study_aid_drafts", cols.filter((c) => c !== "*"), where);
      return json(rows.map((r) => (cols.includes("*") ? r : Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))));
    }

    // Storage: one signed URL (a wall photo), and a removal that really removes.
    if (path.startsWith("/storage/v1/object/sign/study/") && method === "POST") {
      const key = decodeURIComponent(path.replace("/storage/v1/object/sign/study/", ""));
      return json({ signedURL: `/object/sign/study/${key}?token=t` });
    }
    if (path === "/storage/v1/object/study" && method === "DELETE") {
      const gone = [];
      for (const k of body?.prefixes ?? []) {
        if (/\/wall\//.test(k) && db.wallFileOwner?.get(k) && db.wallFileOwner.get(k) !== me) continue; // only its uploader (section F's end)
        if (db.files.delete(k)) gone.push({ name: k });
      }
      db.wallCalls.push({ fn: "storage remove", who: who?.user_metadata?.full_name, keys: body?.prefixes });
      return json(gone);
    }
    if (/^\/storage\/v1\/object\/study\/.+\/wall\//.test(path) && (method === "POST" || method === "PUT")) {
      // The upload itself is the shared mock's; this records its uploader (storage.objects.owner_id).
      db.wallFileOwner = db.wallFileOwner ?? new Map();
      db.wallFileOwner.set(decodeURIComponent(path.replace("/storage/v1/object/study/", "")), me);
      return undefined;
    }

    if (!path.startsWith("/rest/v1/rpc/study_aid_") && !(path === "/rest/v1/rpc/study_my_uses_today" && body?.p_kind === "mnemonic")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    check.rpc(fn, body, where);
    db.wallCalls.push({ fn, who: who?.user_metadata?.full_name, body });
    const b = body || {};
    const aidOf = (id) => db.aids.find((a) => a.id === id && member);
    const tell = (a, type = "UPDATE") => notify("study_aids", type, pub(a), pub(a));
    const isAuthor = (id) => db.aidAuthors.some((w) => w.aid_id === id && w.user_id === me);

    switch (fn) {
      case "study_my_uses_today":
        return json(db.wallReserves.filter((r) => r.kind === "mnemonic" && r.user === me).length);
      case "study_aid_post": {
        const l = db.lectures.find((x) => x.id === b.p_lecture && !x.deleted_at);
        if (!member || !l) return refuse("lecture not found");
        if (!db.sections.some((s) => s.lecture_id === l.id && s.idx === b.p_part)) return refuse("part not found");
        if (!["line", "remix", "sketch", "meme", "moment", "draft"].includes(b.p_kind)) return refuse("bad kind");
        if (len(b.p_body) < 3 || len(b.p_body) > 500) return refuse("bad body");
        if (len(b.p_fact) < 3 || len(b.p_fact) > 300) return refuse("bad fact");
        const have = new Set(l.slides.map((s) => s.n));
        if ((b.p_slides ?? []).length > 6 || (b.p_slides ?? []).some((n) => !have.has(n))) return refuse("unknown slide");
        const photo = b.p_photo ?? null;
        if ((["sketch", "meme"].includes(b.p_kind)) !== (photo !== null)) return refuse("bad photo");
        if (photo && (!photo.startsWith(`${db.group.id}/wall/`) || !db.files.has(photo) || db.wallFileOwner?.get(photo) !== me || db.aids.some((a) => a.photo === photo))) return refuse("bad photo");
        if (b.p_figure) {
          const m = /^fig:(\d+)-(\d+)$/.exec(b.p_figure);
          if (!m || !l.slides.find((s) => s.n === Number(m[1]))?.figures?.some((f) => f.k === Number(m[2]))) return refuse("bad figure");
        }
        if ((b.p_kind === "remix" && !b.p_remix_of && !b.p_draft) || (b.p_kind !== "remix" && b.p_remix_of)) return refuse("bad remix");
        const d = b.p_draft ? db.aidDrafts.find((x) => x.id === b.p_draft && x.lecture_id === l.id && x.part_idx === b.p_part && x.anchor === b.p_anchor) : null;
        if ((b.p_kind === "draft" && !b.p_draft) || (b.p_draft && (!d || !(b.p_draft_no >= 1 && b.p_draft_no <= d.drafts.length)))) return refuse("bad draft");
        if (b.p_kind === "draft" && d.drafts[b.p_draft_no - 1].hook.trim() !== String(b.p_body).trim()) return refuse("bad draft");
        if (b.p_credit && (b.p_credit === me || !db.members.some((m) => m.user_id === b.p_credit))) return refuse("bad credit");
        if (db.aidAuthors.filter((w) => w.user_id === me).length >= 30) return refuse("daily_limit");
        const a = {
          id: uuidJ(++db.wallSeq), group_id: db.group.id, lecture_id: l.id, part_idx: b.p_part, anchor: b.p_anchor, quote: String(b.p_quote ?? "").slice(0, 200),
          drug: String(b.p_drug ?? "").trim().toLowerCase(), kind: b.p_kind, body: String(b.p_body).trim(), fact: String(b.p_fact).trim(), slides: b.p_slides ?? [],
          photo, figure: b.p_figure ?? null, remix_of: b.p_remix_of ?? null, draft_id: b.p_draft ?? null, draft_no: b.p_draft_no ?? null,
          named_by: b.p_named === false ? null : me, credit_id: null, funny_n: 0, stuck_n: 0, flag: null, flagged_by: null, check_state: "no", checked_at: null, check_note: "",
          edited_at: null, created_at: now(),
        };
        db.aids.push(a);
        db.aidAuthors.push({ aid_id: a.id, user_id: me });
        if (b.p_credit) db.aidCredits.push({ aid_id: a.id, user_id: b.p_credit, state: "asked", asked_at: now() });
        tell(a, "INSERT");
        return json(a.id);
      }
      case "study_aid_edit": {
        const a = aidOf(b.p_aid);
        if (!a || !isAuthor(a.id)) return refuse("aid not found");
        if (len(b.p_body) < 3 || len(b.p_body) > 500) return refuse("bad body");
        if (len(b.p_fact) < 3 || len(b.p_fact) > 300) return refuse("bad fact");
        Object.assign(a, { body: b.p_body.trim(), fact: b.p_fact.trim(), slides: b.p_slides ?? [], edited_at: now(), flag: null, flagged_by: null, check_state: "no", checked_at: null, check_note: "" });
        const next = rewin(db, a.lecture_id, a.part_idx, a.anchor);
        tell(a);
        return json(next);
      }
      case "study_aid_delete": {
        const a = aidOf(b.p_aid);
        if (!a || !isAuthor(a.id)) return refuse("aid not found");
        db.aids = db.aids.filter((x) => x !== a);
        db.aidAuthors = db.aidAuthors.filter((w) => w.aid_id !== a.id);
        db.aidVotes = db.aidVotes.filter((v) => v.aid_id !== a.id);
        db.aidPins = db.aidPins.filter((p) => p.aid_id !== a.id);
        rewin(db, a.lecture_id, a.part_idx, a.anchor);
        notify("study_aids", "DELETE", {}, { id: a.id });
        return json(a.photo);
      }
      case "study_aid_vote": {
        const a = aidOf(b.p_aid);
        if (!a) return refuse("aid not found");
        if (!["funny", "stuck"].includes(b.p_kind)) return refuse("bad vote");
        if (isAuthor(a.id)) return refuse("own aid");
        const has = db.aidVotes.find((v) => v.aid_id === a.id && v.user_id === me && v.kind === b.p_kind);
        if (b.p_on && !has) {
          db.aidVotes.push({ aid_id: a.id, user_id: me, kind: b.p_kind, created_at: now() });
          a[b.p_kind === "funny" ? "funny_n" : "stuck_n"] += 1;
        } else if (!b.p_on && has) {
          db.aidVotes = db.aidVotes.filter((v) => v !== has);
          a[b.p_kind === "funny" ? "funny_n" : "stuck_n"] -= 1;
        }
        const next = rewin(db, a.lecture_id, a.part_idx, a.anchor);
        tell(a);
        return json({ funny: a.funny_n, stuck: a.stuck_n, check: next });
      }
      case "study_aid_flag": {
        const a = aidOf(b.p_aid);
        if (!a) return refuse("aid not found");
        if (b.p_flag !== null && !["inaccurate", "not_ok"].includes(b.p_flag)) return refuse("bad flag");
        if (b.p_flag === null) {
          if (!a.flag) return json(null);
          if (!a.flagged_by || (a.flagged_by !== me && !isAuthor(a.id))) return refuse("not yours");
          Object.assign(a, { flag: null, flagged_by: null });
        } else Object.assign(a, { flag: b.p_flag, flagged_by: me });
        rewin(db, a.lecture_id, a.part_idx, a.anchor);
        tell(a);
        return json(null);
      }
      case "study_aid_pin": {
        const a = aidOf(b.p_aid);
        if (!a) return refuse("aid not found");
        db.aidPins = db.aidPins.filter((p) => !(p.user_id === me && p.lecture_id === a.lecture_id && p.part_idx === a.part_idx && p.anchor === a.anchor) && !(p.user_id === me && p.aid_id === a.id));
        if (b.p_on) db.aidPins.push({ user_id: me, lecture_id: a.lecture_id, part_idx: a.part_idx, anchor: a.anchor, aid_id: a.id, created_at: now() });
        return json(null);
      }
      case "study_aid_credit_requests":
        return json(
          db.aidCredits
            .filter((r) => r.user_id === me && r.state === "asked")
            .map((r) => {
              const a = db.aids.find((x) => x.id === r.aid_id);
              return a ? { aid_id: a.id, lecture_id: a.lecture_id, part_idx: a.part_idx, anchor: a.anchor, body: a.body, fact: a.fact, slides: a.slides, asked_by: a.named_by ? nameOf(db, a.named_by) : "", asked_at: r.asked_at } : null;
            })
            .filter(Boolean),
        );
      case "study_aid_credit_answer": {
        const r = db.aidCredits.find((x) => x.aid_id === b.p_aid && x.user_id === me && x.state === "asked");
        if (!r) return refuse("credit not found");
        Object.assign(r, { state: b.p_ok ? "ok" : "no", answered_at: now() });
        const a = db.aids.find((x) => x.id === b.p_aid);
        if (b.p_ok && a) {
          a.credit_id = me;
          tell(a);
        }
        return json(null);
      }
      case "study_aid_week":
        return json(member ? weekOf(db) : null);
      case "study_aid_wall": {
        if (!member) return refuse("forbidden");
        const week = weekOf(db);
        const rows = db.aids
          .filter((a) => (!b.p_lecture || a.lecture_id === b.p_lecture) && (!b.p_drug || a.drug === String(b.p_drug).trim().toLowerCase()))
          .filter((a) => db.lectures.some((l) => l.id === a.lecture_id && !l.deleted_at))
          .filter((a) => a.flag !== "not_ok" || isAuthor(a.id))
          .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
          .map((a) => wallRow(db, a, me, week));
        return json(rows);
      }
      case "study_aid_hint": {
        const card = cardOf(db, b.p_card);
        if (!member || !card) return refuse("card not found");
        const f = aidForCard(db, card, me);
        return json(f ? [{ aid_id: f.a.id, body: f.a.body, fact: f.a.fact, slides: f.a.slides, photo: f.a.photo, figure: f.a.figure, author: f.a.named_by ? nameOf(db, f.a.named_by) : null, pinned: f.pinned }] : []);
      }
      case "study_aid_for_cards": {
        if (!member) return refuse("lecture not found");
        const cards = (db.cardsMock?.cards ?? []).filter((c) => c.lecture_id === b.p_lecture && !c.deleted_at);
        const out = [];
        for (const c of cards) {
          const f = aidForCard(db, c, me);
          if (f) out.push({ card_id: c.id, aid_id: f.a.id, body: f.a.body, fact: f.a.fact, slides: f.a.slides, author: f.a.named_by ? nameOf(db, f.a.named_by) : null, pinned: f.pinned, since: f.since });
        }
        return json(out);
      }
      default:
        return undefined;
    }
  },

  async api(req, res, db, body) {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p !== "/api/study/ai" || !["mnemonic", "wall_check"].includes(body?.op)) return undefined;
    const me = userOfToken((req.headers.authorization || "").replace(/^Bearer /, ""));
    const send = (status, b) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(b));
    };
    if (!me || !db.members.some((m) => m.user_id === me)) return send(401, { error: "not signed in" }), true;
    const log = { op: body.op, who: db.members.find((m) => m.user_id === me)?.name, at: Date.now(), reserved: false, answer: null };
    db.wallOps.push(log);

    if (body.op === "mnemonic") {
      const l = db.lectures.find((x) => x.id === body.lectureId && !x.deleted_at);
      if (!l) return send(404, { error: "lecture not found" }), true;
      const s = db.sections.find((x) => x.lecture_id === l.id && x.idx === body.part);
      if (!s) return send(404, { error: "part not found" }), true;
      if (s.status !== "ready") return send(409, { error: "part busy" }), true;
      if ((s.gen ?? 0) !== body.gen) return send(409, { error: "part rewritten" }), true;
      const text = blockText(s.markdown, body.anchor);
      if (!text) return send(400, { error: "bad block" }), true;
      const hash = sha(text);
      const saved = db.aidDrafts.find((d) => d.lecture_id === l.id && d.part_idx === body.part && d.anchor === body.anchor && d.src_hash === hash);
      const left = () => Math.max(0, 5 - db.wallReserves.filter((r) => r.kind === "mnemonic" && r.user === me).length);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.write("​");
      if (saved) {
        log.answer = "saved";
        res.end(JSON.stringify({ t: "saved", id: saved.id, fact: saved.fact, slides: saved.slides, drafts: saved.drafts, left: left() }) + "\n");
        return true;
      }
      if (left() === 0) {
        res.end("\n\u0000ERROR daily_limit");
        return true;
      }
      db.wallReserves.push({ kind: "mnemonic", ref: `${body.part}.${body.anchor}`, user: me, key: "server-key" });
      log.reserved = true;
      const tag = (/\[ש['׳]\s?(\d+)/.exec(text) ?? [])[1] ?? "6";
      const drafts = db.wallDrafts ?? [
        { technique: "משחק מילים", hook: "Furosemide = פורה סמיך: הפה יבש, אבל הכלייה פתוחה עד הסוף.", decode: "ספיגה פומית משתנה · הפרשה פעילה" },
        { technique: "חרוז", hook: "Furosemide בבליעה? תלוי במזל, מעשר עד תשעים, ואז הכול נגמר מהר.", decode: "10-90% ספיגה · t½ ≈ 1.5 h" },
        { technique: "סצנה הזויה", hook: "Furosemide עומדת בתור לרכבת לתל אביב: חצי מהזמן עולה, חצי נשארת ברציף.", decode: "ספיגה פומית משתנה, 10-90%" },
      ];
      for (const d of drafts) {
        await pause(db.wallDelayMs);
        res.write(JSON.stringify({ t: "d", d }) + "\n");
      }
      const row = { id: uuidJ(++db.wallSeq), group_id: db.group.id, lecture_id: l.id, part_idx: body.part, anchor: body.anchor, src_hash: hash, fact: `ספיגה פומית של Furosemide משתנה (10-90%) [ש' ${tag}]`, slides: [Number(tag)], drafts, model: "claude-opus-5-5", created_at: now() };
      db.aidDrafts.push(row);
      log.answer = "done";
      res.end(JSON.stringify({ t: "done", id: row.id, fact: row.fact, slides: row.slides, made: 3, rejected: 0, left: left(), unsettled: 0 }) + "\n");
      return true;
    }

    // op wall_check: the hold, then one reservation and the verdict.
    const a = db.aids.find((x) => x.id === body.aidId);
    if (!a) return send(404, { error: "aid not found" }), true;
    if (a.check_state === "ok" || a.check_state === "bad" || a.flag || a.funny_n + a.stuck_n < 2) return send(409, { error: "checked" }), true;
    if (a.check_state === "checking" && Date.parse(a.checked_at) > Date.now() - 120_000) return send(409, { error: "busy" }), true;
    Object.assign(a, { check_state: "checking", checked_at: now() });
    db.wallReserves.push({ kind: "wall_check", ref: a.id, user: me, key: "server-key" });
    log.reserved = true;
    await pause(db.wallDelayMs);
    const v = db.wallVerdict ?? { ok: true, problem: "" };
    Object.assign(a, { check_state: v.ok ? "ok" : "bad", checked_at: now(), check_note: v.ok ? "" : v.problem, ...(v.ok ? {} : { flag: "inaccurate", flagged_by: null }) });
    const next = rewin(db, a.lecture_id, a.part_idx, a.anchor);
    db.notifyWall?.("study_aids", "UPDATE", pub(a), pub(a));
    log.answer = v.ok ? "ok" : "bad";
    send(200, { ok: v.ok, problem: v.ok ? "" : v.problem, next });
    return true;
  },
};
