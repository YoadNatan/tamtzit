// Similar questions' part of the e2e mock (docs/study/sheets.md; section O
// 3, release B, VITE_STUDY_SIMILAR), in memory, over the exams, sheets,
// practice and sets mocks (mocks/exams.cjs keeps the sheets, mocks/practice.cjs
// the questions, keys and answers, mocks/sets.cjs section L's sets). It plays
// the SQL's rules (supabase/study-schema.sql, section O 3) and the op's
// (server/study/ops/similar.ts):
//   rpc/study_similar_plan     an item's root (a twin's: its source's), its label, parts, the
//                              twins it has, the room under 6, a run making it; a sheet's
//                              roots without a twin (24 at most), today's run, a run making it;
//                              'not eligible' (an open part, no sure key), 'exam not found'
//                              (not a sheet), 'off' (the switch);
//   rpc/study_similar_of       a root's twins (no keys), its sheet and label, the room, a run;
//   GET study_similar_runs     members read their group's runs;
//   POST /api/study/ai {op: "similar"}   plan (price), start (existing twins first unless
//                              make; joined; max, today, nothing to make; the similar line),
//                              unit (the phone's fallback: claimed false, the server runs it).
// A run is done at the next read of its row at least `M.pace` ms after it
// started (the worker's job, played): each root gets its twins (source
// 'twin', twin_of the root's part, from_exam the sheet, keys copied with a new
// stem), `M.drop` of them are dropped by the check, and they join the sheet's
// practice set (L's qset_for_similar, qset_add_items, qset_similar_done: kind
// 'sheet', ready, its one set_shared to the group). A whole sheet's run that
// made some tells its requester (R's similar_ready, route the set).
// Levers on db.similarMock: on (the switch), drop (twins dropped a run),
// cap (the similar line spent: 402 similar_cap), failNext (the next start
// refused with this code, e.g. daily_limit: 429), pace (or a run's own
// doneAt), calls; S.begin(o) starts a run as the op does (another member's).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHOICE = ["one", "tf", "match", "order"];
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (t = Date.now()) => new Date(t).toISOString();
const userOfToken = (token) => {
  const m = /^tok-(\d+)$/.exec(token || "");
  return m ? `${m[1].padStart(8, "0")}-0000-4000-8000-${m[1].padStart(12, "0")}` : null;
};
const dayOf = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const STATUS = { daily_limit: 429, "not signed in": 401, off: 403, "exam not found": 404, "question not found": 404, "not eligible": 409, max: 409, today: 409, "nothing to make": 409, similar_cap: 402, "bad request": 400 };

module.exports = {
  seed(db) {
    const S = { runs: [], calls: [], seq: 0, on: true, drop: 0, cap: false, pace: 1500 };
    db.similarMock = S;
    const P = () => db.practice;
    const E = () => db.examsMock;
    const qOf = (id) => P().questions.find((q) => q.id === id);
    /** A live sheet of the caller's group (study_private.similar_sheet). */
    S.sheet = (id) => {
      const e = E()?.exams.find((x) => x.id === id && x.group_id === db.group.id);
      if (!e || e.deleted_at || e.kind !== "sheet") throw new Error("exam not found");
      if (!S.on || !E().sheetsOn) throw new Error("off");
      return e;
    };
    /** The first part of an item's question; a twin's root is its source's. */
    S.root = (id) => {
      let q = qOf(id);
      if (q?.source === "twin") q = qOf(q.twin_of);
      if (!q || q.source !== "exam") return null;
      if (q.series) return P().questions.filter((x) => x.series === q.series && x.exam_id === q.exam_id).sort((a, b) => (a.step ?? 1) - (b.step ?? 1))[0];
      return q;
    };
    S.parts = (root) => (root.series ? P().questions.filter((x) => x.series === root.series && x.exam_id === root.exam_id) : [root]);
    /** study_private.similar_ok: every part a choice form or numeric, keyed, not only by a model's unsure guess. */
    S.ok = (root) =>
      !root.retired_at &&
      S.parts(root).every((x) => {
        const k = P().keys.get(x.id);
        if (!k) return false;
        if (k.origin === "solved" && (k.conf ?? 0) < 3) return false;
        if (x.form === "numeric") return k.num !== null && k.num !== undefined;
        return CHOICE.includes(x.form ?? "one") && (k.answer !== null || (Array.isArray(k.seq) && k.seq.length > 0));
      });
    S.twinsOf = (root) => {
      const parts = new Set(S.parts(root).map((x) => x.id));
      return P().questions.filter((t) => t.source === "twin" && !t.retired_at && !t.hidden_at && parts.has(t.twin_of)).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    };
    /** Twins a root has: a twin with parts counts once. */
    S.count = (root) => new Set(S.twinsOf(root).map((t) => t.series ?? t.id)).size;
    S.live = (r) => r.status === "running";
    S.pages = (root) => [...new Set(S.parts(root).flatMap((x) => (x.figures ?? (x.figure ? [x.figure] : [])).map((f) => Number(/^pg:(\d+):/.exec(f)?.[1])).filter(Boolean)))];
    S.label = (q) => q.no_label ?? String(q.exam_no ?? "");
    S.openRoots = (e) =>
      P()
        .questions.filter((q) => q.exam_id === e.id && q.source === "exam" && !q.retired_at && (!q.series || S.root(q.id)?.id === q.id))
        .filter((q) => S.ok(q) && S.count(q) === 0)
        .sort((a, b) => (a.exam_no ?? 0) - (b.exam_no ?? 0));
    S.plan = (examId, questionId, scope) => {
      const e = S.sheet(examId);
      if (scope === "item") {
        const r = S.root(questionId);
        if (!r || r.exam_id !== e.id) throw new Error("question not found");
        if (!S.ok(r)) throw new Error("not eligible");
        const parts = S.parts(r);
        const run = S.runs.find((x) => x.exam_id === e.id && S.live(x) && x.items.includes(r.id));
        return {
          scope: "item", root: r.id, label: S.label(r), form: r.form ?? "one", parts: parts.length, numeric: parts.filter((x) => x.form === "numeric").length,
          count: S.count(r), room: Math.max(0, 6 - S.count(r)), twins: S.twinsOf(r).map((t) => t.id), joined: run?.id ?? null, pages: S.pages(r),
        };
      }
      if (scope !== "sheet") throw new Error("bad request");
      const roots = S.openRoots(e);
      const day = dayOf(Date.now());
      const run = S.runs.find((x) => x.exam_id === e.id && x.scope === "sheet" && S.live(x));
      return {
        scope: "sheet", items: roots.slice(0, 24).map((q) => q.id), more: Math.max(0, roots.length - 24), forms: roots.slice(0, 24).map((q) => q.form ?? "one"),
        roots: roots.slice(0, 24).map((q) => ({ id: q.id, parts: S.parts(q).length, numeric: S.parts(q).filter((x) => x.form === "numeric").length, pages: S.pages(q) })),
        today: S.runs.some((x) => x.exam_id === e.id && x.scope === "sheet" && dayOf(Date.parse(x.created_at)) === day && (x.status !== "failed" || x.made > 0)),
        joined: run?.id ?? null, pages: [...new Set(roots.slice(0, 24).flatMap(S.pages))],
      };
    };
    /** The op's usual price (sheetPrice.ts's similarPriceUsd, near enough for the screens). */
    S.price = (plan, per) => Math.round((plan.scope === "item" ? 0.035 * per : 0.034 * (plan.items ?? []).length) * 100) / 100;
    /** The sheet's one set in section L (qset_for_similar), made by the first run. */
    S.setFor = (e, by) => {
      const Q = db.qsetsMock;
      if (!Q) return null;
      let s = Q.sets.find((x) => x.kind === "sheet" && x.exam_id === e.id && !x.deleted_at);
      if (!s) {
        const t = iso();
        s = { id: hex("5e7a0000", ++Q.seq), group_id: e.group_id, kind: "sheet", title: `שאלות דומות · ${e.title}`.slice(0, 80), lecture_id: null, exam_id: e.id, want: 1, options: {}, state: "making", notified_at: null, created_by: by, created_at: t, updated_at: t, deleted_at: null, deleted_by: null };
        Q.sets.push(s);
      }
      return s;
    };
    /** The worker's job, played: twins of each root, the check's drops, the set, the notice. */
    S.finish = (r) => {
      const e = E().exams.find((x) => x.id === r.exam_id);
      let drop = S.drop;
      const made = [];
      for (const rootId of r.items) {
        const root = qOf(rootId);
        if (!root) continue;
        for (let i = 0; i < r.per; i++) {
          if (S.count(root) >= 6) break;
          if (drop > 0) {
            drop -= 1;
            r.dropped += 1;
            continue;
          }
          const series = root.series ? `tw-${++S.seq}` : null;
          for (const part of S.parts(root)) {
            const n = ++S.seq;
            const t = {
              ...part, id: hex("7a1e0000", n), source: "twin", exam_id: null, exam_no: null, no_label: null, no_key: null, lecture_id: null, from_exam: e.id, twin_of: part.id,
              twin_check: part.form === "numeric" ? "recalc" : "blind", series, step: series ? part.step : null, created_by: r.created_by, created_at: iso(Date.now() + n), model: "mock",
              question: `(שאלה דומה ${n}) ${part.question}`, vignette: part.vignette ? `מקרה חדש (בדוי): ${part.vignette}` : "", retired_at: null, hidden_at: null, study_question_flags: [],
            };
            P().questions.push(t);
            const k = P().keys.get(part.id);
            P().keys.set(t.id, { ...k, origin: "twin", conf: 3, by: null });
            made.push(t);
          }
          r.made += 1;
        }
      }
      const Q = db.qsetsMock;
      const s = r.set_id ? Q?.sets.find((x) => x.id === r.set_id) : null;
      if (s && Q) {
        for (const t of made) {
          if (Q.items.some((i) => i.set_id === s.id && i.question_id === t.id)) continue;
          Q.items.push({ set_id: s.id, question_id: t.id, pos: Q.items.filter((i) => i.set_id === s.id).length + 1, added_at: iso(), auto_kept_at: null });
        }
        if (Q.items.some((i) => i.set_id === s.id)) {
          Object.assign(s, { state: "ready", want: Math.min(60, Q.items.filter((i) => i.set_id === s.id).length), updated_at: iso() });
          if (!s.notified_at) {
            s.notified_at = iso();
            Q.announce(s, Q.items.filter((i) => i.set_id === s.id).length);
          }
        } else if (s.similar_run === r.id) Object.assign(s, { deleted_at: iso() });
      }
      Object.assign(r, { status: r.made > 0 || !r.dropped ? "done" : "failed", charged_usd: Math.round(0.03 * (r.made + r.dropped) * 100) / 100, updated_at: iso() });
      if (r.scope === "sheet" && r.made > 0 && db.notifyMock) {
        db.notifyMock.add({ user_id: r.created_by, kind: "similar_ready", cat: "mine", args: { k: r.made, kind: "sheet", course: e.course }, route: s ? { v: "sets", k: s.id } : { v: "exams", e: e.id }, obj: null, dedupe: `similar:${r.id}` });
      }
    };
    /** study_similar_begin's run, its set (L) and its kick. */
    S.begin = ({ examId, scope, items, per, by, worstUsd = 0.2, urls = null, doneAt }) => {
      const e = S.sheet(examId);
      const t = iso();
      const r = {
        id: hex("51a00000", ++S.seq), group_id: e.group_id, exam_id: e.id, scope, items, per, status: "running", made: 0, dropped: 0, skipped_figs: 0, error: null,
        reserve_id: null, reserved_usd: worstUsd, charged_usd: 0, set_id: null, created_by: by, created_at: t, updated_at: t, urls, doneAt,
      };
      const s = S.setFor(e, by);
      if (s) {
        r.set_id = s.id;
        if (!s.similar_run) s.similar_run = r.id;
      }
      S.runs.push(r);
      return r;
    };
    /** Runs whose time has come are done (read through the members' table). */
    S.tick = () => {
      for (const r of S.runs) if (S.live(r) && Date.now() >= (r.doneAt ?? Date.parse(r.created_at) + S.pace)) S.finish(r);
    };
  },

  async rest({ method, path, query, body, who, db, json: answer, refuse: deny, check }) {
    const S = db.similarMock;
    if (!S || !db.examsMock) return undefined;
    const me = who?.id ?? null;
    const member = me && db.members.some((m) => m.user_id === me);
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    if (method === "GET" && path === "/rest/v1/study_similar_runs") {
      const cols = (query.get("select") || "*").split(",").map((c) => c.trim()).filter(Boolean);
      check.cols("study_similar_runs", cols, `${method} ${path}`);
      S.calls.push({ fn: "GET study_similar_runs", who: me, body: null });
      if (!member) return json([]);
      S.tick();
      let rows = S.runs.filter((r) => r.group_id === db.group.id);
      for (const f of ["id", "exam_id", "scope"]) {
        const v = query.get(f);
        if (v) rows = rows.filter((r) => `eq.${r[f]}` === v);
      }
      if (query.get("set_id") === "not.is.null") rows = rows.filter((r) => r.set_id);
      rows = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const limit = Number(query.get("limit") || 0);
      if (limit) rows = rows.slice(0, limit);
      return json(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))));
    }
    if (method !== "POST") return undefined;
    const m = /^\/rest\/v1\/rpc\/(study_similar_plan|study_similar_of)$/.exec(path);
    if (!m) return undefined;
    check.rpc(m[1], body, `${method} ${path}`);
    S.calls.push({ fn: m[1], who: me, body });
    if (!me) return refuse("not signed in");
    if (!member) return refuse("exam not found");
    S.tick();
    try {
      if (m[1] === "study_similar_plan") return json(S.plan(body.p_exam, body.p_question ?? null, body.p_scope ?? "item"));
      const r = S.root(body.p_question);
      const e = r && db.examsMock.exams.find((x) => x.id === r.exam_id && !x.deleted_at);
      if (!r || !e) return refuse("question not found");
      const run = S.runs.find((x) => x.exam_id === e.id && S.live(x) && x.items.includes(r.id));
      return json({
        root: r.id, exam_id: e.id, label: S.label(r),
        twins: S.twinsOf(r).map((t) => ({ id: t.id, form: t.form, series: t.series, step: t.step, check: t.twin_check, of: t.twin_of, created_at: t.created_at })),
        room: Math.max(0, 6 - S.count(r)), running: run?.id ?? null,
      });
    } catch (err) {
      return refuse(err.message);
    }
  },

  async api(req, res, db, b) {
    const p = new URL(req.url, "http://x").pathname;
    if (p !== "/api/study/ai" || !b || b.op !== "similar") return undefined;
    const S = db.similarMock;
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return true;
    };
    const fail = (code) => send(STATUS[code] ?? 500, { error: code });
    const me = userOfToken((req.headers.authorization || "").replace(/^Bearer /, ""));
    S.calls.push({ fn: `op similar ${b.action ?? "start"}`, who: me, body: b });
    if (!me || !db.members.some((m) => m.user_id === me)) return send(401, { error: "not signed in" });
    S.tick();
    const action = b.action ?? "start";
    if (action === "unit") {
      const r = S.runs.find((x) => x.id === b.runId);
      return send(200, { claimed: false, status: r?.status ?? null });
    }
    const scope = b.scope === "sheet" ? "sheet" : b.scope === "item" ? "item" : null;
    if (!UUID.test(b.examId ?? "") || !scope || (scope === "item" && !UUID.test(b.questionId ?? ""))) return fail("bad request");
    let plan;
    try {
      plan = S.plan(b.examId, b.questionId ?? null, scope);
    } catch (err) {
      return fail(err.message);
    }
    const per = scope === "item" ? Math.max(1, Math.min(2, plan.room ?? 2)) : 1;
    const priceUsd = S.price(plan, per);
    const worstUsd = Math.round(priceUsd * 2.6 * 100) / 100;
    if (action === "plan") return send(200, { plan, priceUsd, worstUsd });
    if (plan.joined) return send(200, { joined: plan.joined });
    if (scope === "item") {
      if (plan.twins.length && b.make !== true) return send(200, { twins: plan.twins });
      if ((plan.room ?? 0) <= 0) return fail("max");
    } else {
      if (plan.today) return fail("today");
      if (!plan.items.length) return fail("nothing to make");
    }
    if (S.failNext) {
      const code = S.failNext;
      S.failNext = null;
      return fail(code);
    }
    if (S.cap) return fail("similar_cap");
    const r = S.begin({ examId: b.examId, scope, items: scope === "item" ? [plan.root] : plan.items, per, by: me, worstUsd, urls: b.urls ?? null });
    return send(202, { runId: r.id, setId: r.set_id, jobs: Math.ceil(r.items.length / 4), items: r.items.length, per, priceUsd, worstUsd, server: true });
  },
};
