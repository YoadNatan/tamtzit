// Package U-3's part of the e2e mock (spec §8.3; §12.5.U's U-3): the trap
// museum, its meter (decision 3 of 17 Nov 2026), the trap cards' badges and
// the meeting's opening exhibit. The shared mock loads it for every script
// (every plugin in e2e/study/mocks/ is), so a build with VITE_STUDY_MUSEUM
// finds its RPCs in any flow. It plays section U's U-3 block as the SQL does
// (supabase/study-schema.sql), with the pulse's own rules (mocks/pulse.cjs's
// db.pulseMock): the switch 'pulse' off answers "off" and nothing else; only
// a member the last night counted reads an exhibit or a badge (review SEC-8);
// the meter counts from the night (db.museumMock.need: how many more wrong
// "על בטוח" bets the closest candidate needs, never which question or who).
//   rpc/study_museum, study_museum_meter, study_trap_cards, study_museum_pick,
//   study_museum_shown
// db.museumMock.calls keeps every call (fn, who), for the privacy checks.

module.exports = {
  seed(db) {
    db.museumMock = {
      exhibits: [], // study_museum rows (open or retired, already open)
      soon: 0, // exhibits found that open the next study day
      need: 3, // the closest candidate's missing bets (decision 3)
      traps: [], // study_trap_cards rows
      shown: new Set(),
      calls: [],
    };
  },

  async rest({ method, path, body, who, db, json: answer, refuse: deny, check }) {
    if (method !== "POST" || !path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    const mine = ["study_museum", "study_museum_meter", "study_trap_cards", "study_museum_pick", "study_museum_shown"];
    if (!mine.includes(fn)) return undefined;
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    check.rpc(fn, body, `${method} ${path}`);
    const M = db.museumMock;
    const P = db.pulseMock;
    const me = who?.id ?? null;
    M.calls.push({ fn, who: me });
    if (!me) return refuse("not signed in");
    const member = db.members.some((m) => m.user_id === me);
    const reader = Boolean(P && P.reader(me));
    const open = (e) => e.state !== "retired";
    switch (fn) {
      case "study_museum_pick": {
        const l = db.lectures.find((x) => x.id === body.p_lecture);
        if (!member || !l) return refuse("lecture not found");
        if (!reader) return json(null);
        const pick = M.exhibits.filter((e) => e.lecture_id === body.p_lecture && open(e)).sort((a, b) => Number(M.shown.has(a.trap_id)) - Number(M.shown.has(b.trap_id)))[0];
        return json(pick ? pick.trap_id : null);
      }
      case "study_museum_shown": {
        const e = M.exhibits.find((x) => x.trap_id === body.p_trap);
        if (!member || !reader || !e || !open(e)) return refuse("exhibit not found");
        M.shown.add(e.trap_id);
        return json(null);
      }
    }
    if (!member || body.p_group !== db.group.id) return refuse("forbidden");
    const L = body.p_lecture ?? null;
    switch (fn) {
      case "study_museum":
        return json(reader ? M.exhibits.filter((e) => !L || e.lecture_id === L) : []);
      case "study_trap_cards":
        return json(reader ? M.traps : []);
      case "study_museum_meter": {
        if (!P || !P.on) return json({ state: "off", floor: 3 });
        if (P.out.has(me)) return json({ state: "out", floor: 3 });
        if (!reader) return json({ state: "waiting", floor: 3, join_days: 7, join_days_left: P.joinDaysLeft[me] ?? 1 });
        const ex = M.exhibits.filter((e) => !L || e.lecture_id === L);
        return json({
          state: "open", floor: 3, cutoff: P.cutoff, group_need: P.groupNeed,
          exhibits: ex.length, retired: ex.filter((e) => e.state === "retired").length, soon: M.soon,
          traps: M.traps.length, need: M.need,
        });
      }
    }
    return undefined;
  },
};
