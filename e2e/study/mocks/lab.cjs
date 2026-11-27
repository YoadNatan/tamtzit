// "השוואת מודלים"'s part of the e2e mock (docs/study/models.md; section Y,
// VITE_STUDY_MODELS), in memory. It plays section Y's functions
// (supabase/study-schema.sql) and the op "lab" (server/study/ops/lab.ts),
// with deterministic stand-in models and synthetic material only (no course
// material, no real model):
//   rpc/study_lab_owner, study_models, study_lab_list, study_lab_todo,
//   study_lab_run, study_lab_source, study_lab_rate, study_lab_reveal,
//   study_lab_board, study_model_provider_set;
//   POST /api/study/ai {op: "lab"}  price, run (NDJSON: {t:"run"}, then
//   {t:"progress"} counts, then {t:"done"}), resume, retry, check, route,
//   cancel.
// The kinds rated by people (WP8: practice, a set's batch, points, cards,
// "לשאול", a summary part) answer synthetic questions, points, cards or
// text; members rate the short ones (member_rate), the owner every one, blind
// until the caller's own reveal, which needs a score on every finished
// answer (or a skip, which drops the caller's scores).
// Blind as the SQL is (D12): while a run runs, study_lab_run gives labels
// only; done, each answer's status, text and checks; model, cost and time only
// after the caller's own reveal. The run goes on without the phone: each
// answer is done `L.pace` ms after the run started (read at the next call),
// unless `L.stall` keeps one waiting until a resume.
// The models answer by their id (L.outcome): Opus and Sonnet every bank
// question right (Haiku: L.haikuRight of 10), Claude Sonnet 5
// refuses, Fable times out (L.fableTimeout).
// Levers on db.labMock: on (the switch lab), routesOn (the switch routes),
// spent (this month's comparison spend), runsToday, material (per kind:
// false = none), stall, pace, usage30, calls; L.seedRuns(n) adds n done runs
// of the question check, revealed by the owner (for the results).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (t = Date.now()) => new Date(t).toISOString();
const userOfToken = (token) => {
  const m = /^tok-(\d+)$/.exec(token || "");
  return m ? `${m[1].padStart(8, "0")}-0000-4000-8000-${m[1].padStart(12, "0")}` : null;
};
const LABELS = ["א", "ב", "ג", "ד"];
const KEYED = ["solver", "fix_check", "exam_read", "sheet_read"];
const RATED = ["practice", "set_write", "points", "cards", "ask", "part"];
const KINDS = [...KEYED, ...RATED];
/** What members rate (section Y's lab_settings.member_kinds' default). */
const MEMBER_KINDS = ["practice", "set_write", "ask", "points", "cards"];
const NAMES = {
  solver: "הבדיקה של השאלות", fix_check: "בדיקת תיקון", exam_read: "קריאת מבחן", sheet_read: "קריאת דף תרגילים",
  practice: "שאלות תרגול", set_write: "שאלות בסט חדש", points: "נקודות שצריך לדעת", cards: "כרטיסיות", ask: "לשאול", part: "סיכומים",
};
const ROUTE_KEYS = [
  "part", "outline", "notes", "practice", "set_write", "solver", "reword", "style", "points", "cards",
  "ask", "ask_route", "mnemonic", "wall_check", "fix_check", "var", "trap_check",
  "exam_read", "exam_key", "exam_solve", "sheet_read", "sheet_key", "sheet_solve", "similar", "judge",
];
/** The registry's Claude models the stand-in knows, with a worst case per kind relative to Opus. */
const FACTOR = {
  "claude-fable-5-2": 2, "claude-mythos-5-2": 5, "claude-fable-5-1": 2, "claude-mythos-5-1": 5, "claude-fable-5": 2, "claude-mythos-5": 5,
  "claude-opus-5-5": 1, "claude-opus-5": 1, "claude-opus-4-8": 1, "claude-opus-4-7": 1, "claude-opus-4-6": 1,
  "claude-sonnet-5-5": 0.5, "claude-sonnet-5": 0.5, "claude-sonnet-4-6": 0.6, "claude-haiku-5-5": 0.026, "claude-haiku-4-5": 0.25,
};
const EXPENSIVE = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-fable-5", "claude-mythos-5-2", "claude-mythos-5-1", "claude-mythos-5"]);
const MYTHOS = new Set(["claude-mythos-5-2", "claude-mythos-5-1", "claude-mythos-5"]);
/** Opus's worst case on each kind's material (the price action), and its typical settled cost. */
const BASE = { solver: 0.03, fix_check: 0.02, exam_read: 0.5, sheet_read: 0.4, practice: 0.25, set_write: 0.25, points: 0.12, cards: 0.1, ask: 0.08, part: 0.4 };
const SETTLED = { solver: 0.027, fix_check: 0.015, exam_read: 0.18, sheet_read: 0.15, practice: 0.09, set_write: 0.09, points: 0.05, cards: 0.04, ask: 0.03, part: 0.2 };
/** A rated kind's material line (the title after the kind's name). */
const WHAT = { practice: "הרצאה בדויה · חלק 1", set_write: "הרצאה בדויה · חלק 1", points: "הרצאה בדויה · חלק 1", cards: "הרצאה בדויה · חלק 1", ask: "הרצאה בדויה", part: "הרצאה בדויה · חלק 1" };
const titleOf = (route) =>
  `${NAMES[route]} · ${route === "solver" ? "10 שאלות מהבנק" : route === "fix_check" ? "הרצאה בדויה" : RATED.includes(route) ? WHAT[route] : "מועד א׳ בדוי · עמודים 1-4"}`;
/** A rated kind's synthetic answer by model: what each model "writes" (no model ever names itself). */
function ratedAnswer(model, route) {
  const weak = model === "claude-haiku-5-5";
  if (route === "practice" || route === "set_write") {
    const q = (i) => ({
      vignette: i === 2 ? "מטופלת בדויה בת 60 מקבלת תרופה בדויה." : "",
      question: `שאלה בדויה ${i}: מה מנגנון הפעולה של התרופה הבדויה?`,
      options: ["עיכוב משאבה בדויה", "חסימת תעלה בדויה", "הפעלת קולטן בדוי", "עיכוב אנזים בדוי"].map((text, j) => ({ text, correct: j === (weak && i === 3 ? 1 : 0), why: `הסבר בדוי. [ש' ${i + 2}]` })),
      takeaway: `עובדה בדויה ${i}. [ש' ${i + 2}]`,
    });
    return { text: JSON.stringify({ questions: [q(1), q(2), q(3)] }), checks: { pass: !weak, items: 3, match: weak ? 2 : 3, ok: weak ? 2 : 3, solved: 3, solver_agrees: weak ? 2 : 3, solver_differs: weak ? 1 : 0 }, check_status: "done" };
  }
  if (route === "points")
    return { text: JSON.stringify({ points: [1, 2, 3, 4].map((i) => ({ subject: "Fakeomycin", text: `נקודה בדויה ${i} על התרופה הבדויה.`, red_flag: i === 4 })) }), checks: { pass: true, items: 4, match: 4, ok: 4, red: 1 } };
  if (route === "cards")
    return { text: JSON.stringify({ cards: [1, 2, 3].map((i) => ({ front: `מה עושה התרופה הבדויה ${i}?`, back: `מעכבת משאבה בדויה ${i}` })) }), checks: { pass: true, items: 3, match: 3, ok: 3 } };
  if (route === "ask") return { text: `לפי השקפים הבדויים, התרופה מעכבת משאבה בדויה [ש' 3]${weak ? "" : ", ולכן נגרמת היפוקלמיה בדויה [ש' 4]"}.`, checks: { pass: true, items: 1, match: 1, tags: weak ? 1 : 2, bad: 0 } };
  return { text: "## חלק בדוי\n\nהתרופה הבדויה מעכבת משאבה בדויה [ש' 3]. המינון 500 mg פעמיים ביום [ש' 4].", checks: { pass: true, items: 3, match: 2, tags: 2, bad: 0, numbers: weak ? 0 : 1, numbers_of: 1, words: 14 } };
}
const STATUS = { off: 403, "not the creator": 403, forbidden: 403, run_cap: 402, lab_budget: 402, reserve: 402, daily_runs: 429, closed: 409, "not waiting": 409, expensive: 409 };

module.exports = {
  seed(db) {
    const L = {
      on: true,
      routesOn: true,
      spent: 0,
      runsToday: 0,
      line: 3.3,
      runCap: 1.5,
      daily: 3,
      pace: 1500,
      stall: false,
      fableTimeout: true,
      haikuRight: 10,
      material: { solver: true, fix_check: true, exam_read: true, sheet_read: false, practice: true, set_write: true, points: true, cards: true, ask: true, part: true },
      ratings: [],
      runs: [],
      outputs: [],
      seen: [],
      routes: {},
      providers: {},
      admins: [],
      seq: 0,
      calls: [],
      usage30: { solver: { calls: 100, usd: 2.7 }, part: { calls: 40, usd: 9.5 }, practice: { calls: 30, usd: 4.2 }, bank: { calls: 4, usd: 0.6 }, points: { calls: 40, usd: 3.72 }, cards: { calls: 12, usd: 1.1 }, ask: { calls: 60, usd: 2.1 }, exam: { calls: 8, usd: 1.6 }, fix_check: { calls: 6, usd: 0.1 } },
    };
    db.labMock = L;
    L.owner = (me) => Boolean(me) && db.members.some((m) => m.user_id === me) && (db.group.created_by === me || L.admins.includes(me));
    L.outcome = (model, route) => {
      if (model === "claude-sonnet-5") return { status: "refused", text: null, checks: {} };
      if (model === "claude-fable-5-2" && L.fableTimeout) return { status: "timeout", text: null, checks: {} };
      const f = FACTOR[model] ?? 1;
      const cost = Math.round(SETTLED[route] * f * 100000) / 100000;
      if (RATED.includes(route)) return { status: "done", cost, ...ratedAnswer(model, route) };
      if (route === "solver") {
        const right = model === "claude-haiku-5-5" ? L.haikuRight : 10;
        const answers = Array.from({ length: 10 }, (_, i) => ({ id: `q${i + 1}`, choice: i < right ? 1 : 0, ambiguous: false, seq: [] }));
        return { status: "done", text: JSON.stringify({ answers }), checks: { pass: true, items: 10, match: right, false_rejects: 10 - right, ambiguous: 0, blind: 0, missing: 0 }, cost };
      }
      if (route === "fix_check") {
        const agrees = model !== "claude-haiku-5-5";
        return { status: "done", text: JSON.stringify({ ok: agrees, why: "השקף אומר זאת (בדוי)." }), checks: { pass: true, items: 1, match: agrees ? 1 : 0, false_rejects: agrees ? 0 : 1, agrees, ok: agrees }, cost };
      }
      const copied = model === "claude-haiku-5-5" ? 9 : 12;
      return { status: "done", text: JSON.stringify({ questions: [{ no: 1, question: "שאלה בדויה", options: ["א", "ב", "ג", "ד"] }] }), checks: { pass: true, items: 12, match: copied, numbered: 12, options: 12, copied, figures: 12, extra: 0 }, cost };
    };
    L.finished = (s) => s === "done" || s === "truncated";
    /** The run goes on on the server: answers whose time has come end (read at every call). */
    L.tick = () => {
      for (const r of L.runs) {
        if (r.status !== "running") continue;
        for (const o of L.outputs.filter((x) => x.run_id === r.id && x.status === "running" && Date.now() >= x.doneAt)) {
          const out = L.outcome(o.model, r.route);
          Object.assign(o, { status: out.status, text: out.text, checks: out.checks, check_status: out.check_status ?? "none", cost_usd: out.cost ?? 0.0004, latency_ms: o.model === "claude-haiku-5-5" ? 6000 : 31000, usage: { input_tokens: 3000, output_tokens: 600 }, finished_at: iso() });
          L.spent += o.cost_usd;
        }
        if (!L.outputs.some((x) => x.run_id === r.id && (x.status === "waiting" || x.status === "running"))) Object.assign(r, { status: "done", closed_at: iso() });
      }
    };
    L.plan = ({ route, models, by, title, created = Date.now(), stall = false, judge = false }) => {
      const id = hex("1ab00000", ++L.seq);
      const differs = { practice: "count", set_write: "count", cards: "count", ask: "no threads", part: "max_tokens" }[route] ?? "";
      const r = { id, group_id: db.group.id, route, title, status: "running", source: { lecture: null }, differs, member_rate: MEMBER_KINDS.includes(route), judge_model: judge ? "claude-opus-5-5" : null, created_by: by, created_at: iso(created), estimate_usd: models.reduce((a, m) => a + BASE[route] * (FACTOR[m] ?? 1), 0), closed_at: null };
      L.runs.push(r);
      // Labels shuffled, deterministically: the first model never gets א.
      const labels = LABELS.slice(0, models.length);
      const order = models.map((m, i) => ({ m, label: labels[(i + 1) % models.length] }));
      order.forEach(({ m, label }, i) => {
        const waiting = stall && i === models.length - 1;
        L.outputs.push({ id: hex("1ac00000", ++L.seq), run_id: id, slot: i, label, model: m, provider: "anthropic", status: waiting ? "waiting" : "running", reason: null, tries: 0, text: null, checks: {}, check_status: "none", cost_usd: null, latency_ms: null, usage: null, doneAt: Date.now() + L.pace * (i + 1) });
      });
      L.runsToday += 1;
      return r;
    };
    /** A done run of a rated kind by the owner (members see it to rate): its answers in at once. */
    L.seedRated = (route, owner, models = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], ago = 3_600_000) => {
      const r = L.plan({ route, models, by: owner, title: titleOf(route), created: Date.now() - ago });
      for (const o of L.outputs.filter((x) => x.run_id === r.id)) o.doneAt = 0;
      L.runsToday -= 1;
      L.tick();
      return r;
    };
    /** n done runs of the question check, Opus against Haiku, revealed by the owner: the results' history. */
    L.seedRuns = (n, owner) => {
      for (let i = 0; i < n; i++) {
        const r = L.plan({ route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5"], by: owner, title: `${NAMES.solver} · 10 שאלות מהבנק`, created: Date.now() - (n - i + 1) * 86_400_000 });
        for (const o of L.outputs.filter((x) => x.run_id === r.id)) o.doneAt = 0;
        L.runsToday -= 1;
        L.tick();
        L.seen.push({ run_id: r.id, user_id: owner, rated: false, best_label: null });
      }
    };
  },

  async rest({ method, path, body, who, db, json: answer, refuse: deny, check }) {
    const L = db.labMock;
    if (!L || method !== "POST") return undefined;
    const m = /^\/rest\/v1\/rpc\/(study_lab_owner|study_models|study_lab_list|study_lab_todo|study_lab_run|study_lab_source|study_lab_rate|study_lab_reveal|study_lab_board|study_model_provider_set)$/.exec(path);
    if (!m) return undefined;
    check.rpc(m[1], body, `${method} ${path}`);
    const me = who?.id ?? null;
    L.calls.push({ fn: m[1], who: me, body });
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (msg, s) => (await deny(msg, s), true);
    const member = me && db.members.some((x) => x.user_id === me);
    if (!member) return refuse("forbidden");
    L.tick();
    const owner = L.owner(me);
    const seenBy = (run) => L.seen.find((s) => s.run_id === run && s.user_id === me);
    const outs = (run) => L.outputs.filter((o) => o.run_id === run).sort((a, b) => (a.label < b.label ? -1 : 1));
    const finishedOf = (run) => outs(run).filter((o) => L.finished(o.status));
    const myRating = (output) => L.ratings.find((x) => x.output_id === output && x.user_id === me) ?? null;
    const groupOf = (output) => {
      const xs = L.ratings.filter((x) => x.output_id === output);
      return { n: xs.length, mean: xs.length ? Math.round((xs.reduce((a, x) => a + x.overall, 0) / xs.length) * 100) / 100 : null, errors: xs.filter((x) => x.error_flag).length };
    };
    switch (m[1]) {
      case "study_lab_owner":
        return json(owner);
      case "study_models":
        return json({
          routes: L.routes,
          providers: L.providers,
          switches: { lab: L.on, routes: L.routesOn },
          lab: { line_usd: L.line, run_cap: L.runCap, daily_runs: L.daily, member_kinds: ["practice", "set_write", "ask", "points", "cards"], todo_days: 7, spent_usd: Math.round(L.spent * 10000) / 10000, runs_today: L.runsToday },
        });
      case "study_lab_list": {
        const rows = L.runs
          .filter((r) => owner || (r.member_rate && r.status === "done" && finishedOf(r.id).length >= 2))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .map((r) => {
            const s = seenBy(r.id);
            const o = outs(r.id);
            return {
              id: r.id, route: r.route, title: r.title, status: r.status, created_at: r.created_at,
              ready: o.filter((x) => x.status !== "waiting" && x.status !== "running").length, total: o.length, member_rate: r.member_rate,
              mine: s ? (s.rated ? "rated" : "skipped") : !(r.member_rate || owner) || r.status !== "done" ? null : Date.parse(r.created_at) >= Date.now() - 7 * 86_400_000 ? "todo" : "old",
              cost_usd: s ? Math.round(o.reduce((a, x) => a + (Number(x.cost_usd) || 0), 0) * 100000) / 100000 : null,
            };
          });
        return json(rows);
      }
      case "study_lab_todo":
        return json(L.runs.filter((r) => r.member_rate && r.status === "done" && !seenBy(r.id) && finishedOf(r.id).length >= 2 && Date.parse(r.created_at) >= Date.now() - 7 * 86_400_000).length);
      case "study_lab_run": {
        const r = L.runs.find((x) => x.id === body.p_run);
        if (!r) return refuse("forbidden");
        const s = seenBy(r.id);
        const open = r.status !== "running";
        const o = outs(r.id);
        return json({
          id: r.id, title: r.title, route: r.route, status: r.status, ready: o.filter((x) => x.status !== "waiting" && x.status !== "running").length, total: o.length,
          source: r.source, differs: r.differs, member_rate: r.member_rate, created_at: r.created_at, estimate_usd: owner ? r.estimate_usd : null,
          owner, can_rate: r.status === "done" && (r.member_rate || owner) && !s, judge: s ? (r.judge_model ? "done" : "none") : null, mine: s ? { rated: s.rated, best: s.best_label } : null,
          outputs: o.map((x) =>
            !open
              ? { label: x.label }
              : {
                  id: x.id, label: x.label, status: x.status, reason: x.reason, tries: x.tries, text: x.text, checks: x.checks, check_status: x.check_status,
                  my: (() => {
                    const y = myRating(x.id);
                    return y ? { overall: y.overall, accuracy: y.accuracy, hebrew: y.hebrew, structure: y.structure, error: y.error_flag, note: y.note } : null;
                  })(),
                  model: s ? x.model : null, provider: s ? x.provider : null, cost_usd: s ? x.cost_usd : null, usage: s && owner ? x.usage : null,
                  latency_ms: s ? x.latency_ms : null, first_ms: s ? 900 : null, served_by: s ? x.model : null,
                  ai: s && r.judge_model ? { overall: x.model === "claude-haiku-5-5" ? 3 : 4, accuracy: 4, hebrew: 4, structure: 4, errors: [] } : null, group: s ? groupOf(x.id) : null,
                },
          ),
        });
      }
      case "study_lab_source": {
        const r = L.runs.find((x) => x.id === body.p_run);
        if (!r) return refuse("forbidden");
        const material =
          r.route === "solver"
            ? { lecture: null, title: "הרצאה בדויה", items: Array.from({ length: 3 }, (_, i) => ({ vignette: "", question: `שאלה בדויה ${i + 1}: מהו אתר הפעולה של התרופה הבדויה?`, options: ["Proximal tubule", "Thick ascending limb", "Collecting duct"] })) }
            : r.route === "fix_check"
              ? { title: "הרצאה בדויה", before: "התרופה הבדויה מעכבת את NCC.", after: "התרופה הבדויה מעכבת את NKCC2.", slides: [3] }
              : { title: "מועד א׳ בדוי", pages: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] };
        return json({ source: r.source, material, kept: true });
      }
      case "study_lab_rate": {
        if (!L.on) return refuse("off");
        const o = L.outputs.find((x) => x.id === body.p_output);
        if (!o) return refuse("forbidden");
        const r = L.runs.find((x) => x.id === o.run_id);
        if (!r.member_rate && !owner) return refuse("not rated here");
        if (seenBy(r.id)) return refuse("seen");
        if (r.status !== "done" || !L.finished(o.status)) return refuse("not done");
        const n = Number(body.p_overall);
        if (!Number.isInteger(n) || n < 1 || n > 5) return refuse("bad rating");
        L.ratings = L.ratings.filter((x) => !(x.output_id === o.id && x.user_id === me));
        L.ratings.push({
          output_id: o.id, user_id: me, overall: n, error_flag: body.p_error === true, note: String(body.p_note ?? "").slice(0, 300),
          accuracy: owner ? (body.p_accuracy ?? null) : null, hebrew: owner ? (body.p_hebrew ?? null) : null, structure: owner ? (body.p_structure ?? null) : null,
        });
        return json(null);
      }
      case "study_lab_reveal": {
        const r = L.runs.find((x) => x.id === body.p_run);
        if (!r) return refuse("forbidden");
        if (seenBy(r.id)) return refuse("seen");
        if (body.p_skip) {
          const mine = new Set(outs(r.id).map((o) => o.id));
          L.ratings = L.ratings.filter((x) => !(x.user_id === me && mine.has(x.output_id)));
          L.seen.push({ run_id: r.id, user_id: me, rated: false, best_label: null });
          return json(null);
        }
        if (r.status !== "done") return refuse("not done");
        if (!r.member_rate && !owner) return refuse("not rated here");
        const fin = finishedOf(r.id);
        const rated = fin.filter((o) => myRating(o.id)).length;
        if (rated < fin.length && (rated > 0 || r.member_rate)) return refuse("not rated");
        if (body.p_best && body.p_best !== "=" && !fin.some((o) => o.label === body.p_best)) return refuse("bad rating");
        L.seen.push({ run_id: r.id, user_id: me, rated: rated > 0, best_label: rated > 0 ? (body.p_best ?? null) : null });
        return json(null);
      }
      case "study_lab_board": {
        if (!ROUTE_KEYS.includes(body.p_route)) return refuse("bad route");
        const today = L.routes[body.p_route]?.model ?? "claude-opus-5-5";
        const runs = L.runs.filter((r) => r.route === body.p_route && r.status === "done" && seenBy(r.id)).map((r) => r.id);
        const o = L.outputs.filter((x) => runs.includes(x.run_id));
        const byModel = new Map();
        for (const x of o) {
          const k = byModel.get(x.model) ?? [];
          k.push(x);
          byModel.set(x.model, k);
        }
        const med = (xs) => {
          const s = xs.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
          return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
        };
        const models = [...byModel.entries()].map(([model, xs]) => ({
          model, today: model === today, runs: new Set(xs.map((x) => x.run_id)).size, answers: xs.length, score: null, rated: 0, flags: 0, ai: null, ai_n: 0, best: 0, shared: 0, same_or_better: 0,
          refused: xs.filter((x) => x.status === "refused").length, truncated: xs.filter((x) => x.status === "truncated").length, failed: xs.filter((x) => x.status === "timeout" || x.status === "error").length,
          checked: xs.filter((x) => "pass" in (x.checks ?? {})).length, passed: xs.filter((x) => x.checks?.pass === true).length,
          items: xs.reduce((a, x) => a + (Number(x.checks?.items) || 0), 0), match: xs.reduce((a, x) => a + (Number(x.checks?.match) || 0), 0), false_rejects: xs.reduce((a, x) => a + (Number(x.checks?.false_rejects) || 0), 0),
          mean_usd: xs.length ? Math.round((xs.reduce((a, x) => a + (Number(x.cost_usd) || 0), 0) / xs.length) * 100000) / 100000 : null,
          median_usd: med(xs.map((x) => Number(x.cost_usd) || 0)), p50_ms: med(xs.map((x) => x.latency_ms)),
        })).sort((a, b) => (a.model < b.model ? -1 : 1));
        return json({ route: body.p_route, today, models, usage30: owner ? L.usage30 : null });
      }
      case "study_model_provider_set":
        if (!owner) return refuse("not the creator");
        if (!["openai", "google", "openrouter"].includes(body.p_provider)) return refuse("bad provider");
        L.providers[body.p_provider] = { allowed: body.p_allowed === true, scope: body.p_scope ?? "all", set_at: iso() };
        return json(null);
    }
    return undefined;
  },

  async api(req, res, db, b) {
    const p = new URL(req.url, "http://x").pathname;
    if (p !== "/api/study/ai" || !b || b.op !== "lab") return undefined;
    const L = db.labMock;
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return true;
    };
    const fail = (code) => send(STATUS[code] ?? 400, { error: code });
    const me = userOfToken((req.headers.authorization || "").replace(/^Bearer /, ""));
    L.calls.push({ fn: `op lab ${b.action}`, who: me, body: b });
    if (!me || !db.members.some((m) => m.user_id === me)) return send(401, { error: "not signed in" });
    L.tick();
    const owner = L.owner(me);
    /** NDJSON as the op streams it: {t:"run"}, the counts as answers end, {t:"done"}. */
    const stream = (r, ready0 = 0) => {
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
      const total = L.outputs.filter((o) => o.run_id === r.id).length;
      res.write("​" + JSON.stringify({ t: "run", run: r.id, total }) + "\n");
      let sent = ready0;
      const timer = setInterval(() => {
        L.tick();
        const o = L.outputs.filter((x) => x.run_id === r.id);
        const ready = o.filter((x) => x.status !== "waiting" && x.status !== "running").length;
        if (ready > sent) {
          sent = ready;
          res.write(JSON.stringify({ t: "progress", ready, total }) + "\n");
        }
        if (!o.some((x) => x.status === "running")) {
          clearInterval(timer);
          res.end(JSON.stringify({ t: "done" }) + "\n");
        }
      }, 250);
      timer.unref?.();
      return true;
    };
    switch (b.action) {
      case "price": {
        if (!owner) return fail("not the creator");
        if (!KINDS.includes(b.route)) return fail("bad route");
        if (!L.material[b.route]) return fail("no material");
        const ids = Array.isArray(b.models) ? b.models : Object.keys(FACTOR);
        const models = {};
        for (const id of ids) {
          if (!(id in FACTOR)) continue;
          models[id] = MYTHOS.has(id) ? { refused: "bad model" } : { usd: Math.round(BASE[b.route] * FACTOR[id] * 100000) / 100000 };
        }
        const steps = RATED.includes(b.route) ? { check: b.route === "practice" || b.route === "set_write" ? 0.004 : 0, judge: [0, 0, 0.06, 0.08, 0.1] } : undefined;
        return send(200, { route: b.route, title: titleOf(b.route), source: b.route === "solver" ? { lecture: null, n: 10 } : RATED.includes(b.route) ? { lecture: null, part: 0 } : { exam: null }, pictures: ["exam_read", "sheet_read", "part"].includes(b.route), models, runCap: L.runCap, ...(steps ? { steps } : {}) });
      }
      case "run": {
        if (!owner) return fail("not the creator");
        if (!L.on) return fail("off");
        if (!KINDS.includes(b.route)) return fail("bad route");
        if (!L.material[b.route]) return fail("no material");
        const models = Array.isArray(b.models) ? b.models : [];
        if (models.length < 2 || models.length > 4 || new Set(models).size !== models.length || models.some((x) => !(x in FACTOR))) return fail("bad slots");
        if (models.some((x) => MYTHOS.has(x))) return fail("bad model");
        if (b.route === "ask" && !String(b.source?.question ?? "").trim()) return fail("no question");
        const est = models.reduce((a, x) => a + BASE[b.route] * FACTOR[x], 0);
        if (est > L.runCap) return fail("run_cap");
        if (L.runsToday >= L.daily) return fail("daily_runs");
        if (L.spent + est > L.line) return fail("lab_budget");
        const r = L.plan({ route: b.route, models, by: me, title: titleOf(b.route), created: L.backdate ? Date.now() - L.backdate : Date.now(), stall: L.stall, judge: b.judge === true });
        return stream(r);
      }
      case "resume": {
        const r = L.runs.find((x) => x.id === b.run);
        if (!r) return fail("forbidden");
        if (!owner) return fail("not the creator");
        if (r.status !== "running") return fail("closed");
        const waiting = L.outputs.filter((x) => x.run_id === r.id && x.status === "waiting");
        for (const o of waiting) Object.assign(o, { status: "running", doneAt: Date.now() + L.pace });
        const total = L.outputs.filter((x) => x.run_id === r.id).length;
        return stream(r, total - waiting.length);
      }
      case "retry": {
        const r = L.runs.find((x) => x.id === b.run);
        if (!r) return fail("forbidden");
        if (!owner) return fail("not the creator");
        const o = L.outputs.find((x) => x.run_id === r.id && x.label === b.label);
        if (!o || !["timeout", "error"].includes(o.status) || o.tries >= 1) return fail("not waiting");
        L.fableTimeout = false;
        Object.assign(o, { status: "running", tries: o.tries + 1, doneAt: Date.now() + L.pace });
        Object.assign(r, { status: "running", closed_at: null });
        return stream(r, L.outputs.filter((x) => x.run_id === r.id).length - 1);
      }
      case "check": {
        const r = L.runs.find((x) => x.id === b.run);
        if (!r || !owner) return fail("not the creator");
        if (r.status !== "done") return fail("not done");
        const waiting = L.outputs.filter((x) => x.run_id === r.id && x.check_status === "pending");
        for (const o of waiting) Object.assign(o, { check_status: "done", checks: { ...o.checks, solved: 3, solver_agrees: 3, solver_differs: 0 } });
        res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
        res.end("​" + JSON.stringify({ t: "check", pending: waiting.length }) + "\n" + JSON.stringify({ t: "done" }) + "\n");
        return true;
      }
      case "route": {
        if (!owner) return fail("not the creator");
        if (!ROUTE_KEYS.includes(b.route)) return fail("bad route");
        if (b.model === null || b.model === undefined) {
          delete L.routes[b.route];
          return send(200, { route: b.route, model: null });
        }
        if (!(b.model in FACTOR)) return fail("bad model");
        if (MYTHOS.has(b.model)) return fail("not for this kind");
        if (EXPENSIVE.has(b.model) && b.confirmExpensive !== true) return fail("expensive");
        L.routes[b.route] = { model: b.model, set_at: iso() };
        return send(200, { route: b.route, model: b.model });
      }
      case "cancel": {
        const r = L.runs.find((x) => x.id === b.run);
        if (!r || !owner) return fail("not the creator");
        if (r.status !== "running") return fail("closed");
        Object.assign(r, { status: "cancelled", closed_at: iso() });
        for (const o of L.outputs.filter((x) => x.run_id === r.id && (x.status === "waiting" || x.status === "running"))) Object.assign(o, { status: "error", reason: "cancelled" });
        return send(200, { cancelled: true });
      }
      default:
        return fail("bad action");
    }
  },
};
