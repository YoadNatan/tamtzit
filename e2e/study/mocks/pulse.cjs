// Package U's part of the e2e mock (spec §8.3; §12.5.U, U-1 and U-2): the
// pulse, its meter, "אצלך", the brief, the paragraphs and the cards the
// group finds hard, and the opt-out. The shared mock loads it for every
// script (every plugin in e2e/study/mocks/ is), so a build with
// VITE_STUDY_PULSE finds its tables and RPCs in any flow. It plays section U
// as the SQL does (supabase/study-schema.sql, U's markers), with its rules:
//   - the switch 'pulse' (db.pulseMock.on) off: nothing is counted, the
//     meter says "off", every read is empty;
//   - only a member the last night counted (db.pulseMock.counted) and who is
//     not out (db.pulseMock.out) reads the group's words (review SEC-8,
//     reciprocal); the others get null, nothing, or their meter;
//   - an opt-out or a return changes the count only at the next night
//     (db.pulseMock.night(), the scripts' stand-in for pg_cron);
//   - "אצלך" (db.pulseMock.mine) is the member's own, at any count.
//   rpc/study_pulse_ready, _meter, study_pulse, study_my_pulse,
//   study_pulse_brief, study_pulse_needed; GET study_pulse_spots,
//   study_pulse_questions; GET/POST/DELETE study_pulse_optout (own rows).
// db.pulseMock.calls keeps every call (fn, who), for the privacy checks.
const CUT = "2026-11-17T02:00:00.000Z";

function cols(query) {
  return (query.get("select") || "*").split(",").map((c) => c.trim());
}
function pick(rows, query) {
  const c = cols(query);
  return rows.map((r) => (c.includes("*") ? r : Object.fromEntries(c.map((k) => [k, r[k] === undefined ? null : r[k]]))));
}
function eqs(query) {
  const out = {};
  for (const [k, v] of query) if (!["select", "order", "limit", "offset"].includes(k)) out[k] = v.replace(/^eq\./, "");
  return out;
}

module.exports = {
  seed(db) {
    const P = {
      on: true,
      cutoff: CUT,
      counted: new Set(), // the members the last night counted
      out: new Set(), // opted out now (rows of study_pulse_optout)
      joinDaysLeft: {}, // user id → days until a night counts them
      groupNeed: 0,
      topics: [], // study_pulse rows
      mine: {}, // user id → study_my_pulse rows
      meter: [], // { lecture_id, open, waiting, need }
      brief: {}, // lecture id → { hot, question }
      spots: [], // { lecture_id, part_idx, anchor }
      needed: [], // study_pulse_needed rows
      signals: [], // { question_id, signal, group_id }
      calls: [],
    };
    /** The next night: whoever is in the group and not out is counted (the week is the script's to set). */
    P.night = (members) => {
      P.counted = new Set(members.filter((id) => !P.out.has(id)));
    };
    P.reader = (me) => P.on && P.counted.has(me) && !P.out.has(me);
    db.pulseMock = P;
    // Section M's agenda: line 2 is section U's hook.
    db.pulseHotSpot = (lectureId, me) => {
      if (!P.reader(me)) return null;
      const t = P.topics.find((r) => r.lecture_id === lectureId && r.bucket === "hot");
      return t ? { title: t.topic, aspect: t.aspect, slides: t.slides, lecture_id: lectureId } : null;
    };
  },

  async rest({ method, path, query, body, who, db, json: answer, refuse: deny, check }) {
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    const where = `${method} ${path}`;
    const P = db.pulseMock;
    const me = who?.id ?? null;
    const member = me && db.members.some((m) => m.user_id === me);

    if (path === "/rest/v1/study_pulse_optout") {
      P.calls.push({ fn: `optout ${method}`, who: me });
      if (method === "GET") {
        check.cols("study_pulse_optout", cols(query).filter((c) => c !== "*"), where);
        return json(member && P.out.has(me) ? pick([{ group_id: db.group.id, user_id: me, created_at: CUT }], query) : []);
      }
      if (method === "POST") {
        if (!member) return refuse("new row violates row-level security policy", 403);
        if (P.out.has(me)) return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
        P.out.add(me);
        return json(null, 201);
      }
      if (method === "DELETE") {
        P.out.delete(me);
        return json(null, 200);
      }
    }
    if (path === "/rest/v1/study_pulse_spots" && method === "GET") {
      check.cols("study_pulse_spots", [...cols(query).filter((c) => c !== "*"), ...Object.keys(eqs(query))], where);
      P.calls.push({ fn: "spots", who: me });
      const f = eqs(query);
      return json(P.reader(me) ? pick(P.spots.filter((s) => !f.lecture_id || s.lecture_id === f.lecture_id), query) : []);
    }
    if (path === "/rest/v1/study_pulse_questions" && method === "GET") {
      check.cols("study_pulse_questions", [...cols(query).filter((c) => c !== "*"), ...Object.keys(eqs(query))], where);
      P.calls.push({ fn: "signals", who: me });
      return json(P.reader(me) ? pick(P.signals, query) : []);
    }
    if (!path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    const mine = ["study_pulse_ready", "study_pulse_meter", "study_pulse", "study_my_pulse", "study_pulse_brief", "study_pulse_needed"];
    if (!mine.includes(fn)) return undefined;
    check.rpc(fn, body, where);
    P.calls.push({ fn, who: me });
    if (!me) return refuse("not signed in");
    if (fn === "study_pulse_brief") {
      if (!member || !db.lectures.some((l) => l.id === body.p_lecture)) return refuse("lecture not found");
      return json(P.reader(me) ? P.brief[body.p_lecture] ?? { hot: null, question: null } : { hot: null, question: null });
    }
    if (!member || body.p_group !== db.group.id) return refuse("forbidden");
    const L = body.p_lecture ?? null;
    switch (fn) {
      case "study_pulse_ready":
        return json(P.reader(me) ? P.cutoff : null);
      case "study_pulse_meter":
        if (!P.on) return json({ state: "off", floor: 3 });
        if (P.out.has(me)) return json({ state: "out", floor: 3 });
        if (!P.reader(me)) return json({ state: "waiting", floor: 3, join_days: 7, join_days_left: P.joinDaysLeft[me] ?? 1 });
        return json({ state: "open", floor: 3, cutoff: P.cutoff, group_need: P.groupNeed, lectures: P.meter });
      case "study_pulse":
        return json(P.reader(me) ? P.topics.filter((r) => !L || r.lecture_id === L) : []);
      case "study_my_pulse":
        return json((P.mine[me] ?? []).filter((r) => !L || r.lecture_id === L));
      case "study_pulse_needed":
        return json(P.reader(me) ? P.needed.filter((r) => !L || r.lecture_id === L) : []);
    }
    return undefined;
  },
};
