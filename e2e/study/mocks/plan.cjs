// Package G's part of the e2e mock (spec §8.3; §12.6.G) and T-2's (§12.4.T's
// D11): the group's plan, its days and every marathon (section P's), the
// plan's meter, the member's relearning rounds, and "הקבוצה צריכה אותך". The
// shared mock loads it for every script (every plugin in e2e/study/mocks/
// is), so a build with VITE_STUDY_MARATHONS, VITE_STUDY_GROUP_PLAN or
// VITE_STUDY_NEEDS_ME finds its tables and RPCs in any flow. It plays the
// SQL's rules (supabase/study-schema.sql, sections P, G and T's end):
//   GET study_group_plans (members: the group's), study_marathons (members),
//       study_marathon_people (members);
//   rpc/study_group_plan_save   any member; a new plan archives the previous;
//                               a stale version answers "conflict"; names
//                               (updated_by) on every change;
//   rpc/study_group_plan_day    a day of the plan as a marathon (created, or
//                               changed at its version, else "conflict");
//   rpc/study_group_plan_slip   'longer' (with a date before the exam) or
//                               'drop_review', with the name;
//   rpc/study_group_plan_meter  decision 3's meter from db.planMock.answers
//                               ({ lecture_id, user_id, correct } rows: the
//                               first answers of a member, question and day),
//                               with section G's thresholds: "has data" from
//                               20 answers by 3 members, the bucket only then;
//   rpc/study_my_relearning     the caller's own rows (db.planMock.rounds[user]);
//   rpc/study_exam_marks        [] (recordings off);
//   rpc/study_marathon_save, _answer, _step, _cancel   section P's;
//   rpc/study_needs_me_meter, study_set_needs_me   T-2: the caller's own
//                               (db.planMock.needsMeter[user], prefs);
//   db.needsMeRows(me) gives study_today its needs_me rows (today.cjs): only
//                               for an opted-in member, db.planMock.needs[user].
// db.planMock.calls keeps every call (fn, who) for the privacy checks.
const PLAN = { LECTURE_ANSWERS: 20, FLOOR: 3 };
const uid = (n) => `9e${String(n).padStart(6, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayText = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - 4 * 3_600_000));

function cols(query) {
  return (query.get("select") || "*").split(",").map((c) => c.trim());
}
function pick(rows, query) {
  const c = cols(query);
  return rows.map((r) => (c.includes("*") ? r : Object.fromEntries(c.map((k) => [k, r[k] === undefined ? null : r[k]]))));
}
/** PostgREST's filters the app uses here: eq, neq, gte, lt, in. */
function filtered(rows, query) {
  let out = rows;
  for (const [k, v] of query) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    const arg = rest.join(".");
    const s = (x) => (x === null || x === undefined ? null : String(x));
    if (op === "eq") out = out.filter((r) => s(r[k]) === arg);
    else if (op === "neq") out = out.filter((r) => s(r[k]) !== arg);
    else if (op === "gte") out = out.filter((r) => s(r[k]) !== null && s(r[k]) >= arg);
    else if (op === "lt") out = out.filter((r) => s(r[k]) !== null && s(r[k]) < arg);
    else if (op === "in") {
      const set = arg.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      out = out.filter((r) => set.includes(s(r[k])));
    } else throw new Error(`filter ${k}=${v} not mocked`);
  }
  const order = query.get("order");
  if (order) {
    const key = order.split(".")[0];
    out = [...out].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
  }
  const limit = Number(query.get("limit") || 0);
  return limit ? out.slice(0, limit) : out;
}

module.exports = {
  PLAN,
  seed(db) {
    db.planMock = { plans: [], marathons: [], people: [], answers: [], rounds: {}, prefs: new Map(), needs: {}, needsMeter: {}, calls: [], seq: 1 };
    const G = db.planMock;
    db.needsMeRows = (me) => (G.prefs.get(me) ? G.needs[me] ?? [] : []);
  },

  async rest({ method, path, query, body, who, db, json: answer, refuse: deny, check }) {
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const G = db.planMock;
    if (!G) return undefined;
    const where = `${method} ${path}`;
    const me = who?.id ?? null;
    const member = Boolean(me && db.members.some((m) => m.user_id === me));
    const tables = { "/rest/v1/study_group_plans": "study_group_plans", "/rest/v1/study_marathons": "study_marathons", "/rest/v1/study_marathon_people": "study_marathon_people" };
    if (tables[path] && method === "GET") {
      const t = tables[path];
      check.cols(t, [...cols(query).filter((c) => c !== "*"), ...[...query.keys()].filter((k) => !["select", "order", "limit", "offset"].includes(k))], where);
      G.calls.push({ fn: `GET ${t}`, who: me });
      if (!member) return json([]);
      const rows = t === "study_group_plans" ? G.plans : t === "study_marathons" ? G.marathons : G.people;
      return json(pick(filtered(rows, query), query));
    }
    if (method !== "POST" || !path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    const FNS = [
      "study_group_plan_save", "study_group_plan_day", "study_group_plan_slip", "study_group_plan_meter", "study_my_relearning", "study_exam_marks",
      "study_marathon_save", "study_marathon_answer", "study_marathon_step", "study_marathon_cancel", "study_needs_me_meter", "study_set_needs_me",
    ];
    if (!FNS.includes(fn)) return undefined;
    check.rpc(fn, body, where);
    G.calls.push({ fn, who: me, body });
    if (!me) return refuse("not signed in");
    const now = new Date().toISOString();
    const planOf = (id) => G.plans.find((p) => p.id === id);
    const lecturesOk = (ids, max) => ids.length > 0 && ids.length <= max && ids.every((l) => db.lectures.some((x) => x.id === l && x.group_id === db.group.id));

    const saveMarathon = (b) => {
      if (!member || b.p_group !== db.group.id) return { error: "group not found" };
      if (!String(b.p_title || "").trim()) return { error: "bad title" };
      if (!(b.p_minutes >= 30 && b.p_minutes <= 720)) return { error: "bad minutes" };
      const lec = [...new Set(b.p_lectures || [])];
      if (lec.length > 20 || !lec.every((l) => db.lectures.some((x) => x.id === l))) return { error: "lecture not found" };
      const ag = b.p_agenda || [];
      const keys = ["k", "l", "from", "to", "min", "n", "mode", "title", "moved"];
      if (ag.length > 40 || ag.some((s) => Object.keys(s).some((k) => !keys.includes(k)) || !(s.min >= 1 && s.min <= 240) || (s.l && !lec.includes(s.l)) || (["read", "quiz"].includes(s.k) && !s.l)))
        return { error: "bad agenda" };
      if (!b.p_id) {
        if (Date.parse(b.p_starts_at) < Date.now() - 3_600_000) return { error: "bad time" };
        const m = { id: uid(G.seq++), group_id: db.group.id, title: b.p_title.trim(), starts_at: b.p_starts_at, minutes: b.p_minutes, place: "", note: "", lecture_ids: lec, agenda: ag, state: "planned", step: -1, version: 1, created_by: me, updated_by: me, created_at: now, updated_at: now, plan_id: null, plan_day: null };
        G.marathons.push(m);
        G.people.push({ id: uid(G.seq++), marathon_id: m.id, user_id: me, answer: "in", updated_at: now });
        return { m };
      }
      const m = G.marathons.find((x) => x.id === b.p_id);
      if (!m) return { error: "marathon not found" };
      if (m.version !== b.p_version) return { error: "conflict" };
      Object.assign(m, { title: b.p_title.trim(), starts_at: b.p_starts_at, minutes: b.p_minutes, lecture_ids: lec, agenda: ag, version: m.version + 1, updated_by: me, updated_at: now });
      return { m };
    };

    switch (fn) {
      case "study_group_plan_save": {
        if (!member || body.p_group !== db.group.id) return refuse("group not found");
        if (!String(body.p_title || "").trim()) return refuse("bad title");
        const exam = body.p_exam_date;
        const sf = body.p_shared_from ?? addDays(exam, -21);
        const lf = body.p_leave_from ?? addDays(exam, -14);
        if (!exam || exam < todayText() || sf > lf || lf > exam) return refuse("bad date");
        const lec = [...new Set(body.p_lectures || [])];
        if (!lecturesOk(lec, 40)) return refuse("lecture not found");
        const fields = { title: body.p_title.trim(), exam_date: exam, lecture_ids: lec, shared_from: sf, leave_from: lf, shared_minutes: body.p_shared_minutes ?? 180, leave_minutes: body.p_leave_minutes ?? 600, rounds: body.p_rounds ?? 3, day_start: `${body.p_day_start ?? "09:00"}:00`.slice(0, 8), updated_by: me, updated_at: now };
        if (!body.p_id) {
          for (const p of G.plans) if (p.group_id === db.group.id && p.state === "active") Object.assign(p, { state: "archived", updated_by: me, updated_at: now });
          const p = { id: uid(G.seq++), group_id: db.group.id, slips: [], state: "active", version: 1, created_by: me, created_at: now, ...fields };
          G.plans.push(p);
          return json([{ id: p.id, version: 1 }]);
        }
        const p = planOf(body.p_id);
        if (!p || p.state !== "active") return refuse("plan not found");
        if (p.version !== body.p_version) return refuse("conflict");
        Object.assign(p, fields, { version: p.version + 1 });
        return json([{ id: p.id, version: p.version }]);
      }
      case "study_group_plan_day": {
        const p = planOf(body.p_plan);
        if (!p || !member || p.state !== "active") return refuse("plan not found");
        if (!body.p_day || body.p_day < p.shared_from || body.p_day > p.exam_date) return refuse("bad date");
        const have = G.marathons.find((m) => m.plan_id === p.id && m.plan_day === body.p_day && m.state !== "cancelled");
        const r = saveMarathon({ p_id: have?.id ?? null, p_version: body.p_version ?? have?.version, p_group: p.group_id, p_title: body.p_title, p_starts_at: body.p_starts_at, p_minutes: body.p_minutes, p_lectures: body.p_lectures, p_agenda: body.p_agenda });
        if (r.error) return refuse(r.error);
        Object.assign(r.m, { plan_id: p.id, plan_day: body.p_day });
        return json([{ id: r.m.id, version: r.m.version }]);
      }
      case "study_group_plan_slip": {
        const p = planOf(body.p_plan);
        if (!p || !member || p.state !== "active") return refuse("plan not found");
        if (!["longer", "drop_review"].includes(body.p_choice)) return refuse("bad choice");
        if (!body.p_day || body.p_day < p.shared_from || body.p_day > p.exam_date || (body.p_choice === "longer" && (!body.p_until || body.p_until <= body.p_day || body.p_until > p.exam_date))) return refuse("bad date");
        p.slips = [...p.slips, { day: body.p_day, choice: body.p_choice, until: body.p_until ?? null, by: me, at: now }].slice(-60);
        Object.assign(p, { version: p.version + 1, updated_by: me, updated_at: now });
        return json(p.version);
      }
      case "study_group_plan_meter": {
        const p = planOf(body.p_plan);
        if (!p || !member) return refuse("plan not found");
        return json(
          p.lecture_ids.map((l) => {
            const rows = G.answers.filter((a) => a.lecture_id === l && db.members.some((m) => m.user_id === a.user_id));
            const n = rows.length;
            const people = new Set(rows.map((a) => a.user_id)).size;
            const right = rows.filter((a) => a.correct).length;
            const has = n >= PLAN.LECTURE_ANSWERS && people >= PLAN.FLOOR;
            return { lecture_id: l, answers: n, answers_short: Math.max(0, PLAN.LECTURE_ANSWERS - n), members_short: Math.max(0, PLAN.FLOOR - people), bucket: !has ? null : right * 100 < 60 * n ? "hot" : right * 100 >= 80 * n ? "ok" : "warm" };
          }),
        );
      }
      case "study_my_relearning": {
        const p = planOf(body.p_plan);
        if (!p || !member) return refuse("plan not found");
        const mine = G.rounds[me] ?? [];
        return json(p.lecture_ids.map((l) => mine.find((r) => r.lecture_id === l) ?? { lecture_id: l, rounds: 0, key_total: 0, key_left: 0, last_day: null, next_day: null }));
      }
      case "study_exam_marks":
        if (!member) return refuse("lecture not found");
        return json([]);
      case "study_marathon_save": {
        const r = saveMarathon(body);
        if (r.error) return refuse(r.error);
        return json([{ id: r.m.id, version: r.m.version }]);
      }
      case "study_marathon_answer": {
        const m = G.marathons.find((x) => x.id === body.p_id);
        if (!m || !member) return refuse("marathon not found");
        if (!["in", "maybe", "out"].includes(body.p_answer)) return refuse("bad answer");
        const have = G.people.find((x) => x.marathon_id === m.id && x.user_id === me);
        if (have) Object.assign(have, { answer: body.p_answer, updated_at: now });
        else G.people.push({ id: uid(G.seq++), marathon_id: m.id, user_id: me, answer: body.p_answer, updated_at: now });
        return json(null);
      }
      case "study_marathon_step": {
        const m = G.marathons.find((x) => x.id === body.p_id);
        if (!m || !member) return refuse("marathon not found");
        const n = m.agenda.length;
        if (!n) return refuse("no agenda");
        if (m.step !== body.p_from) return json(m.step);
        if (body.p_to === n) Object.assign(m, { state: "ended", version: m.version + 1, updated_by: me, updated_at: now });
        else Object.assign(m, { step: body.p_to, state: "live", version: m.version + 1, updated_by: me, updated_at: now });
        return json(body.p_to);
      }
      case "study_marathon_cancel": {
        const m = G.marathons.find((x) => x.id === body.p_id);
        if (!m || !member) return refuse("marathon not found");
        if (body.p_cancel !== false) Object.assign(m, { state: "cancelled", version: m.version + 1, updated_by: me, updated_at: now });
        return json(null);
      }
      case "study_needs_me_meter": {
        if (!member || body.p_group !== db.group.id) return refuse("group not found");
        const own = G.needsMeter[me] ?? { topics: 0, next: null };
        const open = db.comments.filter((c) => c.kind === "question" && !c.parent_id && !c.resolved && c.author_id !== me).length;
        return json({ on: Boolean(G.prefs.get(me)), topics: own.topics, next: own.next, open });
      }
      case "study_set_needs_me": {
        if (!member || body.p_group !== db.group.id) return refuse("group not found");
        G.prefs.set(me, Boolean(body.p_on));
        return json(null);
      }
    }
    return undefined;
  },
};
