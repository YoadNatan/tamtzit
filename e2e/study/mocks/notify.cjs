// Notifications' part of the e2e mock (section R; DECISIONS-2026-11-26.md):
// the inbox, the settings and the devices, in memory. The shared mock loads
// it for every script (every plugin in e2e/study/mocks/ is), so a build with
// VITE_STUDY_NOTIFY finds section R's member RPCs in any flow. It plays the
// SQL's rules (supabase/study-schema.sql, section R):
//   rpc/study_notices_mine       the caller's rows of this group and the
//                                group-less ones, last changed first, 30 days,
//                                never a test; p_before pages (by the row's
//                                updated_at and id), p_limit 1-100;
//   rpc/study_notices_unseen     {n (≤ 99; no test, no live row past ends_at), objs};
//   rpc/study_notices_seen       these ids (null: all), as Realtime UPDATEs;
//   rpc/study_notices_seen_obj   the caller's unseen rows about one object;
//   rpc/study_notify_state       {send}: db.notifyMock.send, or the pilot list;
//   rpc/study_notify_prefs_set   only the known keys and types; the whole row back;
//   rpc/study_push_subscribe, _unsubscribe, _devices, _remove, _keep_only;
//   rpc/study_notify_test, study_quiz_quiet;
// every one refused ("forbidden") to a caller who is not in the group.
// db.notifyMock.add(row) inserts a notice (the hooks' and the minute job's
// work on the server) and returns it; the script then sends Realtime's INSERT
// with mock.notify("study_notices", "INSERT", row) (see e2e/study/notify.cjs).
// db.notifyMock.calls keeps every call (fn, who, body).
// db.notifyMock.health: when set ({notify, vapid, notifyOn?, notifyStuck?}),
// /api/study/health answers the mock's base answer with these (pushes,
// slice 2); unset, health stays the base answer (no pushes offered).
const DAY = 86_400_000;
const PREFS = { live: true, mine: true, digest: false, digest_at: "19:30", quiet: true, quiet_from: "23:00", quiet_to: "07:30", shabbat: false };
const FNS = [
  "study_notices_mine", "study_notices_unseen", "study_notices_seen", "study_notices_seen_obj", "study_notify_state", "study_notify_prefs_set",
  "study_push_subscribe", "study_push_unsubscribe", "study_push_devices", "study_push_remove", "study_push_keep_only", "study_notify_test", "study_quiz_quiet",
];
const CATS = { quiz_open: "live", boss_open: "live", meeting_soon: "live", reading: "live", session_soon: "live", reply: "mine", answer: "mine", summary_ready: "mine", summary_failed: "mine", exam_ready: "mine", exam_failed: "mine", digest: "digest", code_used: "security", test: "security" };

module.exports = {
  seed(db) {
    const N = { notices: [], prefs: new Map(), subs: [], pilot: new Set(), send: false, calls: [], seq: 1, subSeq: 1, health: null, healthCalls: 0 };
    db.notifyMock = N;
    /** A notice for a user, as section R's notice_add() writes it (coalesced while unseen, by dedupe). */
    N.add = (o) => {
      const t = new Date(o.at ?? Date.now()).toISOString();
      const dedupe = o.dedupe ?? `e2e:${N.seq}`;
      const open = N.notices.find((n) => n.user_id === o.user_id && n.dedupe === dedupe && !n.seen_at);
      if (open) {
        Object.assign(open, { count: Math.min(open.count + 1, 999), args: o.args ?? open.args, route: o.route ?? open.route, updated_at: t });
        return open;
      }
      const row = {
        id: N.seq++, user_id: o.user_id, group_id: o.group_id === undefined ? db.group.id : o.group_id, lecture_id: o.lecture_id ?? null,
        kind: o.kind, cat: o.cat ?? CATS[o.kind] ?? "inapp", args: o.args ?? {}, route: o.route ?? {}, obj: o.obj ?? null, count: o.count ?? 1,
        dedupe, created_at: t, updated_at: t, seen_at: o.seen_at ?? null, ends_at: o.ends_at ?? null,
      };
      N.notices.push(row);
      return row;
    };
  },

  async api(req, res, db) {
    const N = db.notifyMock;
    if (!N || new URL(req.url, "http://x").pathname !== "/api/study/health") return undefined;
    N.healthCalls += 1;
    if (!N.health) return undefined;
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, anthropicKey: true, supabase: true, worker: true, workerOk: true, budgetUsd: db.budgetUsd, schema: db.schema, schemaOk: true, features: {}, notifyOn: false, notifyStuck: false, ...N.health }));
    return true;
  },

  async rest({ method, path, body, who, db, notify, json: answer, refuse: deny, check }) {
    const N = db.notifyMock;
    if (!N || method !== "POST" || !path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    if (!FNS.includes(fn)) return undefined;
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    check.rpc(fn, body, `${method} ${path}`);
    const me = who?.id ?? null;
    N.calls.push({ fn, who: me, body });
    // notify_member(p_group): a signed-in member (of this group, when one is named).
    if (!me || !db.members.some((m) => m.user_id === me)) return refuse("forbidden");
    if (body && "p_group" in body && body.p_group !== db.group.id) return refuse("forbidden");
    const now = Date.now();
    const mine = (n) => n.user_id === me && (n.group_id === body.p_group || n.group_id === null) && n.kind !== "test";
    const out = (n) => ({ id: n.id, group_id: n.group_id, kind: n.kind, cat: n.cat, args: n.args, route: n.route, obj: n.obj, count: n.count, created_at: n.created_at, updated_at: n.updated_at, seen_at: n.seen_at, ends_at: n.ends_at });
    const newest = (a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.id - a.id);
    const see = (rows) => {
      const t = new Date().toISOString();
      for (const n of rows) {
        n.seen_at = t;
        notify("study_notices", "UPDATE", n);
      }
      return rows.length;
    };

    switch (fn) {
      case "study_notices_mine": {
        let rows = N.notices.filter((n) => mine(n) && Date.parse(n.updated_at) > now - 30 * DAY).sort(newest);
        if (body.p_before != null) {
          const c = N.notices.find((n) => n.id === body.p_before && n.user_id === me);
          if (!c) return json([]);
          rows = rows.filter((n) => newest(n, c) > 0);
        }
        return json(rows.slice(0, Math.min(Math.max(body.p_limit ?? 50, 1), 100)).map(out));
      }
      case "study_notices_unseen": {
        const open = N.notices.filter((n) => mine(n) && !n.seen_at);
        const counted = open.filter((n) => !(n.cat === "live" && n.ends_at && Date.parse(n.ends_at) < now));
        const objs = [...new Set(open.map((n) => n.obj).filter(Boolean))].sort().slice(0, 50);
        return json({ n: Math.min(counted.length, 99), objs });
      }
      case "study_notices_seen": {
        const ids = body.p_ids ?? null;
        return json(see(N.notices.filter((n) => n.user_id === me && !n.seen_at && (n.group_id === body.p_group || n.group_id === null) && (ids === null || ids.includes(n.id)))));
      }
      case "study_notices_seen_obj":
        return json(see(N.notices.filter((n) => n.user_id === me && !n.seen_at && n.obj === body.p_obj && (n.group_id === body.p_group || n.group_id === null))));
      case "study_notify_state":
        return json({ send: N.send || N.pilot.has(me) });
      case "study_notify_prefs_set": {
        const p = body.p;
        if (!p || typeof p !== "object" || Array.isArray(p)) return refuse("bad prefs");
        for (const [k, v] of Object.entries(p)) {
          if (["live", "mine", "digest", "quiet", "shabbat"].includes(k)) {
            if (typeof v !== "boolean") return refuse("bad prefs");
          } else if (["digest_at", "quiet_from", "quiet_to"].includes(k)) {
            if (typeof v !== "string" || !/^([01]\d|2[0-3]):(00|30)$/.test(v)) return refuse("bad prefs");
            if (k === "digest_at" && (v < "06:00" || v > "22:00")) return refuse("bad prefs");
          } else return refuse("bad prefs");
        }
        const row = { ...PREFS, ...(N.prefs.get(me) ?? {}), ...p };
        N.prefs.set(me, row);
        return json(row);
      }
      case "study_push_subscribe": {
        const okHost = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//.test(body.p_endpoint || "");
        if (!okHost) return refuse("bad endpoint");
        if (!/^[A-Za-z0-9_-]{86,88}$/.test(body.p_p256dh || "") || !/^[A-Za-z0-9_-]{21,24}$/.test(body.p_auth || "")) return refuse("bad keys");
        let s = N.subs.find((x) => x.endpoint === body.p_endpoint);
        if (!s) N.subs.push((s = { id: N.subSeq++, created_at: new Date().toISOString(), ok_at: null }));
        Object.assign(s, { user_id: me, endpoint: body.p_endpoint, device: body.p_device ?? "other", browser: body.p_browser ?? "", seen_at: new Date().toISOString() });
        return json(s.id);
      }
      case "study_push_unsubscribe": {
        const before = N.subs.length;
        N.subs = N.subs.filter((s) => !(s.user_id === me && s.endpoint === body.p_endpoint));
        return json(before - N.subs.length);
      }
      case "study_push_devices":
        return json(N.subs.filter((s) => s.user_id === me).map((s) => ({ id: s.id, device: s.device, browser: s.browser, created_at: s.created_at, seen_at: s.seen_at, ok_at: s.ok_at, this: s.endpoint === body.p_endpoint })));
      case "study_push_remove": {
        const before = N.subs.length;
        N.subs = N.subs.filter((s) => !(s.user_id === me && s.id === body.p_id));
        return json(before - N.subs.length);
      }
      case "study_push_keep_only": {
        const before = N.subs.length;
        N.subs = N.subs.filter((s) => !(s.user_id === me && s.endpoint !== body.p_endpoint));
        return json(before - N.subs.length);
      }
      case "study_notify_test":
        return json(N.add({ user_id: me, group_id: null, kind: "test", cat: "security" }).id);
      case "study_quiz_quiet":
        return json(null);
      default:
        return undefined;
    }
  },
};
