// Practice sets' part of the e2e mock (section L 1; docs/study/sets.md), in
// memory. The shared mock loads it for every script (every plugin in
// e2e/study/mocks/ is), so a build with VITE_STUDY_SETS finds section L's
// member RPCs in any flow. It plays the SQL's rules (supabase/study-schema.sql,
// section L) over the practice mock's requests, batches, drafts and answers
// (mocks/practice.cjs, which calls back here: "create" with `set` begins a
// set and refuses an open one with 409 "already making" unless forced; a kept
// question of a set's request joins the set, as L's trigger does; the
// answers' wrappers study_qset_answer(_seq) check the attempt here):
//   rpc/study_qsets_shelf          the group's sets, newest first, with the caller's marks and score;
//   rpc/study_qset_open            {set, options, items, my_attempts, unchecked}; "set not found";
//   rpc/study_qset_progress        {state, want, made, size, failed, unchecked, paused};
//   rpc/study_lecture_making       the open sets on a lecture (D6);
//   rpc/study_qset_room            {sets_usd, today};
//   rpc/study_qset_seen, _hide, _delete (the author or the group's creator), _rename (the author);
//   rpc/study_qset_attempt_start   the caller's open attempt of the last 12 hours, or a new one;
//   rpc/study_qset_attempt_finish  scored on the first answer per question; an empty one dropped;
//   rpc/study_qset_stats           OD5: solvers and mine always; avg and per_q only from 3 others;
//   rpc/study_qset_names_pref      OD7;
//   GET study_qset_requests, study_qset_prefs (own row).
// db.qsetsMock.calls keeps every call (fn, who, body). db.qsetsMock.finisher(userId, setId,
// right, total) adds another member's finished attempt (with answers) for the group numbers.
// With the notifications' mock (mocks/notify.cjs), a set's first "ready" adds
// set_shared for the group but the author (WP17), and a non-author's first
// finish adds set_solved for the author, as section L's hooks do.
const FLOOR = 3;
const PAUSE_MS = 6 * 60_000;
const FNS = [
  "study_qsets_shelf", "study_qset_open", "study_qset_progress", "study_lecture_making", "study_qset_room", "study_qset_seen", "study_qset_hide",
  "study_qset_delete", "study_qset_rename", "study_qset_attempt_start", "study_qset_attempt_finish", "study_qset_stats", "study_qset_names_pref",
];
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (t = Date.now()) => new Date(t).toISOString();

module.exports = {
  seed(db) {
    const Q = { sets: [], items: [], links: [], attempts: [], marks: [], prefs: new Map(), calls: [], seq: 0, notify: null };
    db.qsetsMock = Q;
    const P = () => db.practice ?? { batches: [], drafts: [], answers: [], questions: [] };
    const lectureOf = (id) => db.lectures.find((l) => l.id === id);
    const nameOf = (uid) => db.members.find((m) => m.user_id === uid)?.name ?? null;
    const requestsOf = (setId) => Q.links.filter((l) => l.set_id === setId).map((l) => l.request_id);
    const send = (table, type, row) => Q.notify?.(table, type, row);

    /** What a set's requests have made so far (study_private.qset_facts). */
    Q.facts = (s) => {
      const reqs = requestsOf(s.id);
      const b = (P().batches ?? []).filter((x) => reqs.includes(x.request_id));
      const d = (P().drafts ?? []).filter((x) => reqs.includes(x.request_id));
      const items = Q.items.filter((i) => i.set_id === s.id).length;
      const busyRows = b.filter((x) => x.status === "pending" || x.status === "writing");
      const max = (rows) => rows.reduce((m, x) => (!m || x.updated_at > m ? x.updated_at : m), null);
      return {
        items,
        made: Math.max(items, d.filter((x) => ["pending", "kept"].includes(x.status) && ["ok", "unchecked"].includes(x.check_state)).length),
        failed: b.filter((x) => x.status === "ready" || x.status === "failed").reduce((n, x) => n + Math.max(0, x.wanted - x.made), 0),
        unchecked: d.filter((x) => x.status === "pending" && x.check_state === "unchecked").length,
        busy: busyRows.length,
        busyAt: max(busyRows),
        lastAt: max(b),
      };
    };
    const paused = (s, f) =>
      s.state === "reading" ? Date.parse(s.updated_at) < Date.now() - PAUSE_MS : s.state === "making" ? f.busy > 0 && Date.parse(f.lastAt ?? s.updated_at) < Date.now() - PAUSE_MS : false;
    /** study_private.qset_refresh: ready once nothing is pending or writing; then the once-only notice. */
    Q.refresh = (s) => {
      if (s.deleted_at || !requestsOf(s.id).length) return s;
      const f = Q.facts(s);
      if (s.state === "making" && f.busy === 0) Object.assign(s, { state: "ready", updated_at: iso() });
      else if (s.state === "ready" && f.busy > 0) Object.assign(s, { state: "making", updated_at: iso() });
      if (s.state === "ready" && !s.notified_at && f.items > 0) {
        s.notified_at = iso();
        Q.announce(s, f.items);
      }
      return s;
    };
    /** WP17, study_private.notice_set_shared through R's notice_add: the group
     *  but the author, one row a member a day (coalesced while unseen: the
     *  shelf as its route, no args), obj "qsets". Pushes are not played here. */
    Q.announce = (s, k) => {
      const N = db.notifyMock;
      if (!N) return;
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
      const dedupe = `qsets:${s.group_id}:${day}`;
      const args = { lecture: lectureOf(s.lecture_id)?.title ?? null, k, name: nameOf(s.created_by) };
      for (const m of db.members.filter((x) => x.group_id === s.group_id && x.user_id !== s.created_by)) {
        const open = N.notices.some((n) => n.user_id === m.user_id && n.dedupe === dedupe && !n.seen_at);
        const row = N.add({ user_id: m.user_id, kind: "set_shared", cat: "mine", args: open ? {} : args, route: open ? { v: "sets" } : { v: "sets", k: s.id }, obj: "qsets", dedupe, lecture_id: s.lecture_id });
        send("study_notices", row.count > 1 ? "UPDATE" : "INSERT", row);
      }
    };
    Q.isOpen = (s) => {
      if (s.deleted_at) return false;
      if (s.state === "reading") return Date.parse(s.updated_at) > Date.now() - 10 * 60_000;
      if (s.state !== "making") return false;
      if (!requestsOf(s.id).length) return Date.parse(s.updated_at) > Date.now() - 2 * 60_000;
      const f = Q.facts(s);
      return f.busy > 0 && Date.parse(f.busyAt) > Date.now() - 30 * 60_000;
    };
    Q.openOn = (lectureId, me) => {
      const s = Q.sets.filter((x) => x.lecture_id === lectureId && Q.isOpen(x)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      if (!s) return null;
      return { set_id: s.id, author_name: nameOf(s.created_by), made: Q.facts(s).made, want: s.want, state: s.state, mine: s.created_by === me };
    };
    /** "create" with `set`: the set, then its request linked (begin + attach in one). */
    Q.begin = ({ lectureId, request, want, by, state = "making", title }) => {
      const l = lectureOf(lectureId);
      const t = iso();
      const s = {
        id: hex("5e700000", ++Q.seq), group_id: db.group.id, kind: "lecture", title: title ?? `${l?.title ?? ""} · ${want} שאלות`, lecture_id: lectureId,
        want, options: {}, state, notified_at: null, created_by: by, created_at: t, updated_at: t, deleted_at: null, deleted_by: null,
      };
      Q.sets.push(s);
      if (request) Q.links.push({ set_id: s.id, request_id: request.id });
      send("study_qsets", "INSERT", s);
      return s;
    };
    /** L's trigger: a kept question of a set's request joins it at the next place. */
    Q.kept = (q) => {
      const link = Q.links.find((x) => x.request_id === q.request_id);
      if (!link) return;
      const pos = Q.items.filter((i) => i.set_id === link.set_id).length + 1;
      const item = { set_id: link.set_id, question_id: q.id, pos, added_at: iso(), auto_kept_at: null };
      Q.items.push(item);
      const s = Q.sets.find((x) => x.id === link.set_id);
      if (s) s.updated_at = iso();
      send("study_qset_items", "INSERT", item);
    };
    /** The wrappers' check (study_private.qset_attempt_open). */
    Q.attemptFor = (me, attemptId, questionId) => {
      const a = Q.attempts.find((x) => x.id === attemptId);
      if (!a || a.user_id !== me) return { error: "attempt not found" };
      if (a.finished_at) return { error: "attempt finished" };
      const s = Q.sets.find((x) => x.id === a.set_id);
      if (!s || s.deleted_at) return { error: "set not found" };
      if (!Q.items.some((i) => i.set_id === a.set_id && i.question_id === questionId)) return { error: "not in set" };
      return a;
    };
    const firstAnswers = (attemptId) => {
      const by = new Map();
      for (const a of (P().answers ?? []).filter((x) => x.set_attempt === attemptId).sort((x, y) => (x.answered_at < y.answered_at ? -1 : 1)))
        if (!by.has(a.question_id)) by.set(a.question_id, a);
      return by;
    };
    Q.finish = (a) => {
      const firsts = firstAnswers(a.id);
      const answered = firsts.size;
      const right = [...firsts.values()].filter((x) => x.correct).length;
      Object.assign(a, { finished_at: iso(), answered, right_n: right, total: Math.max(a.total, answered) });
      return a;
    };
    /** Another member's finished attempt, with first answers on the set's first `total` questions (`right` of them right). */
    Q.finisher = (userId, setId, right, total) => {
      const a = { id: hex("a7700000", ++Q.seq), set_id: setId, user_id: userId, started_at: iso(Date.now() - 60_000), finished_at: null, total, answered: 0, right_n: 0 };
      Q.attempts.push(a);
      const items = Q.items.filter((i) => i.set_id === setId).sort((x, y) => x.pos - y.pos).slice(0, total);
      items.forEach((it, i) => P().answers.push({ user_id: userId, question_id: it.question_id, choice: 0, correct: i < right, mode: "lecture", ms: 1000, confidence: 2, answered_at: iso(Date.now() - 30_000 + i), set_attempt: a.id }));
      return Q.finish(a);
    };
    Q.row = (s, me) => {
      const f = Q.facts(s);
      const mk = Q.marks.find((m) => m.user_id === me && m.set_id === s.id);
      const l = lectureOf(s.lecture_id);
      const finished = (uid) => Q.attempts.filter((a) => a.set_id === s.id && a.user_id === uid && a.finished_at).sort((x, y) => (x.finished_at < y.finished_at ? -1 : 1));
      const mine = finished(me)[0];
      const open = Q.attempts.filter((a) => a.set_id === s.id && a.user_id === me && !a.finished_at && Date.parse(a.started_at) > Date.now() - 12 * 3600_000).sort((x, y) => (x.started_at < y.started_at ? 1 : -1))[0];
      return {
        id: s.id, kind: s.kind, title: s.title, lecture_id: s.lecture_id, lecture_title: l?.title ?? null, course: l?.course ?? "", author_id: s.created_by,
        author_name: nameOf(s.created_by), created_at: s.created_at, updated_at: s.updated_at, want: s.want, size: f.items, made: f.made, state: s.state,
        paused: paused(s, f), solvers: new Set(Q.attempts.filter((a) => a.set_id === s.id && a.finished_at).map((a) => a.user_id)).size,
        my_score: mine ? mine.right_n : null, my_total: mine ? mine.total : null, my_open_attempt: open?.id ?? null,
        is_new: s.created_by !== me && !mk?.seen_at, is_mine: s.created_by === me, is_hidden: Boolean(mk?.hidden_at),
      };
    };
    Q.visible = (id) => {
      const s = Q.sets.find((x) => x.id === id);
      return s && !s.deleted_at ? s : null;
    };
    Q.mark = (me, setId) => {
      let m = Q.marks.find((x) => x.user_id === me && x.set_id === setId);
      if (!m) Q.marks.push((m = { user_id: me, set_id: setId, seen_at: null, hidden_at: null }));
      return m;
    };
  },

  async rest({ method, path, query, body, who, db, notify, json: answer, refuse: deny, check }) {
    const Q = db.qsetsMock;
    if (!Q) return undefined;
    Q.notify = notify;
    const me = who?.id ?? null;
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const member = me && db.members.some((m) => m.user_id === me);
    if (method === "GET" && (path === "/rest/v1/study_qset_requests" || path === "/rest/v1/study_qset_prefs")) {
      const table = path.slice("/rest/v1/".length);
      const cols = (query.get("select") || "*").split(",").map((c) => c.trim()).filter(Boolean);
      check.cols(table, cols, `${method} ${path}`);
      Q.calls.push({ fn: `GET ${table}`, who: me, body: null });
      if (!member) return json([]);
      if (table === "study_qset_prefs") {
        const p = Q.prefs.get(me);
        return json(p ? [{ user_id: me, show_name: p.show_name, asked_at: p.asked_at }] : []);
      }
      const set = (query.get("set_id") || "").replace(/^eq\./, "");
      return json(Q.links.filter((l) => (!set || l.set_id === set) && Q.visible(l.set_id)).map((l) => ({ set_id: l.set_id, request_id: l.request_id })));
    }
    if (method !== "POST" || !path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    if (!FNS.includes(fn)) return undefined;
    check.rpc(fn, body, `${method} ${path}`);
    Q.calls.push({ fn, who: me, body });
    if (!me) return refuse("not signed in");
    if (!member) return refuse("forbidden");
    const get = (id) => {
      const s = Q.visible(id);
      return s && s.group_id === db.group.id ? s : null;
    };
    switch (fn) {
      case "study_qsets_shelf": {
        if (body.p_group !== db.group.id) return refuse("forbidden");
        const rows = Q.sets
          .filter((s) => !s.deleted_at && s.group_id === body.p_group && (!body.p_lecture || s.lecture_id === body.p_lecture))
          .map((s) => Q.refresh(s))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1))
          .slice(0, Math.max(1, Math.min(body.p_limit ?? 40, 200)));
        return json(rows.map((s) => Q.row(s, me)));
      }
      case "study_qset_open": {
        const s = get(body.p_set);
        if (!s) return refuse("set not found");
        Q.refresh(s);
        const reqs = Q.links.filter((l) => l.set_id === s.id).map((l) => l.request_id);
        return json({
          set: Q.row(s, me),
          options: s.options,
          items: Q.items.filter((i) => i.set_id === s.id).sort((a, b) => a.pos - b.pos).map((i) => ({ question_id: i.question_id, pos: i.pos })),
          my_attempts: Q.attempts.filter((a) => a.set_id === s.id && a.user_id === me).map((a) => ({ id: a.id, started_at: a.started_at, finished_at: a.finished_at, total: a.total, answered: a.answered, right_n: a.right_n })),
          unchecked: (db.practice?.drafts ?? []).filter((d) => reqs.includes(d.request_id) && d.status === "pending" && d.check_state === "unchecked").map((d) => d.id),
        });
      }
      case "study_qset_progress": {
        const s = get(body.p_set);
        if (!s) return refuse("set not found");
        Q.refresh(s);
        const f = Q.facts(s);
        return json({ state: s.state, want: s.want, made: f.made, size: f.items, failed: f.failed, unchecked: f.unchecked, paused: (s.state === "making" && f.busy > 0 && Date.parse(f.lastAt ?? s.updated_at) < Date.now() - PAUSE_MS) });
      }
      case "study_lecture_making":
        return json(
          Q.sets
            .filter((s) => s.lecture_id === body.p_lecture && Q.isOpen(s))
            .map((s) => ({ set_id: s.id, author_name: db.members.find((m) => m.user_id === s.created_by)?.name ?? null, made: Q.facts(s).made, want: s.want, state: s.state, updated_at: s.updated_at, is_mine: s.created_by === me })),
        );
      case "study_qset_room":
        return json([{ sets_usd: 0, today: Q.sets.filter((s) => s.created_by === me && Date.parse(s.created_at) > Date.now() - 86_400_000).length }]);
      case "study_qset_seen": {
        let n = 0;
        for (const id of body.p_sets ?? []) {
          if (!get(id)) continue;
          const m = Q.mark(me, id);
          if (!m.seen_at) m.seen_at = iso();
          n += 1;
        }
        return json(n);
      }
      case "study_qset_hide": {
        if (!get(body.p_set)) return refuse("set not found");
        const m = Q.mark(me, body.p_set);
        m.hidden_at = body.p_hidden ? (m.hidden_at ?? iso()) : null;
        return json(null);
      }
      case "study_qset_delete": {
        const s = get(body.p_set);
        if (!s) return refuse("set not found");
        if (s.created_by !== me && db.group.created_by !== me) return refuse("not yours");
        Object.assign(s, { deleted_at: iso(), deleted_by: me, updated_at: iso() });
        notify("study_qsets", "UPDATE", s);
        return json(null);
      }
      case "study_qset_rename": {
        const s = get(body.p_set);
        if (!s) return refuse("set not found");
        if (s.created_by !== me) return refuse("not yours");
        const t = String(body.p_title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (!t) return refuse("bad title");
        Object.assign(s, { title: t, updated_at: iso() });
        notify("study_qsets", "UPDATE", s);
        return json(null);
      }
      case "study_qset_attempt_start": {
        const s = get(body.p_set);
        if (!s) return refuse("set not found");
        const open = Q.attempts.filter((a) => a.set_id === s.id && a.user_id === me && !a.finished_at && Date.parse(a.started_at) > Date.now() - 12 * 3600_000).sort((x, y) => (x.started_at < y.started_at ? 1 : -1))[0];
        if (open) return json(open);
        const a = { id: hex("a7700000", ++Q.seq), set_id: s.id, user_id: me, started_at: iso(), finished_at: null, total: Q.items.filter((i) => i.set_id === s.id).length, answered: 0, right_n: 0 };
        Q.attempts.push(a);
        return json(a);
      }
      case "study_qset_attempt_finish": {
        const a = Q.attempts.find((x) => x.id === body.p_attempt);
        if (!a || a.user_id !== me) return refuse("attempt not found");
        if (a.finished_at) return json({ answered: a.answered, right_n: a.right_n, total: a.total, first: false });
        const first = !Q.attempts.some((x) => x.set_id === a.set_id && x.user_id === me && x.finished_at);
        Q.finish(a);
        if (a.answered === 0) {
          Q.attempts.splice(Q.attempts.indexOf(a), 1);
          return json({ answered: 0, right_n: 0, total: a.total, first: false });
        }
        // WP17: someone other than the author finished first: set_solved in the author's inbox (never pushed).
        const s = Q.sets.find((x) => x.id === a.set_id);
        if (first && s && s.created_by && s.created_by !== me && !s.deleted_at && db.notifyMock) {
          const k = new Set(Q.attempts.filter((x) => x.set_id === s.id && x.finished_at && x.user_id !== s.created_by).map((x) => x.user_id)).size;
          const row = db.notifyMock.add({ user_id: s.created_by, kind: "set_solved", cat: "inapp", args: { title: s.title, k }, route: { v: "sets", k: s.id }, obj: `qset:${s.id}`, dedupe: `qset_solved:${s.id}`, lecture_id: s.lecture_id });
          notify("study_notices", row.count > 1 ? "UPDATE" : "INSERT", row);
        }
        return json({ answered: a.answered, right_n: a.right_n, total: a.total, first });
      }
      case "study_qset_stats": {
        const s = get(body.p_set);
        if (!s) return refuse("set not found");
        const firsts = new Map();
        for (const a of Q.attempts.filter((x) => x.set_id === s.id && x.finished_at).sort((x, y) => (x.finished_at < y.finished_at ? -1 : 1)))
          if (!firsts.has(a.user_id)) firsts.set(a.user_id, a);
        const others = [...firsts.values()].filter((a) => a.user_id !== me);
        const mine = firsts.get(me);
        let avg = null;
        let perQ = null;
        if (others.length >= FLOOR) {
          const all = [...firsts.values()];
          avg = Math.round((all.reduce((n, a) => n + a.right_n / Math.max(1, Math.max(a.total, a.answered)), 0) / all.length) * 1000) / 1000;
          perQ = Q.items
            .filter((i) => i.set_id === s.id)
            .sort((x, y) => x.pos - y.pos)
            .map((i) => {
              const got = others.map((a) => firstOf(db, a.id, i.question_id)).filter(Boolean);
              const r = got.filter((x) => x.correct).length;
              const band = got.length < FLOOR ? null : r / got.length < 0.34 ? 1 : r / got.length <= 0.66 ? 2 : 3;
              return { question_id: i.question_id, pos: i.pos, band };
            });
        }
        const names = [...firsts.keys()].filter((uid) => Q.prefs.get(uid)?.show_name).map((uid) => db.members.find((m) => m.user_id === uid)?.name).filter(Boolean).sort();
        return json({ solvers: firsts.size, others: others.length, floor: FLOOR, mine: mine ? { answered: mine.answered, right_n: mine.right_n, total: mine.total } : null, avg, per_q: perQ, names });
      }
      case "study_qset_names_pref": {
        Q.prefs.set(me, { show_name: Boolean(body.p_on), asked_at: iso() });
        return json(Boolean(body.p_on));
      }
      default:
        return undefined;
    }
  },
};

/** An attempt's first answer to a question. */
function firstOf(db, attemptId, questionId) {
  return (db.practice?.answers ?? []).filter((x) => x.set_attempt === attemptId && x.question_id === questionId).sort((x, y) => (x.answered_at < y.answered_at ? -1 : 1))[0] ?? null;
}
