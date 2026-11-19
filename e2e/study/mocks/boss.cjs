// Package H's part of the e2e mock (spec §8.3; §12.5.H, H-2 … H-4): the
// boss battle on Z's plugin (mocks/quiz.cjs), as section H plays it
// (supabase/study-schema.sql): the card's heads and decision 3's meter
// (study_boss_open), the battle opened as a quiz in mode "boss"
// (study_boss_create), its rounds in head order (Z's plugin asks
// db.bossMock.roundsFor at the start, and refuses "need 3" below three
// players), each reveal's hit points (db.bossMock.afterReveal, a port of
// study_quiz__after_reveal: a round counts from 3 answers, the head loses up
// to its share, full at 80%, the team up to 150/planned × the wrong share
// and at least 20 when half fall for the trap, relapses, won/lost), the
// state the HUD reads (db.bossMock.stateOf), the private loot
// (study_boss_loot, study_boss_loot_save, study_loot_done; Today reads
// db.bossMock.due) and the revenge round. The pulse's rules
// (db.pulseMock): off: 'off'; a member the night did not count reads no
// heads and gets "no heads".
//   rpc/study_boss_open, study_boss_create, study_boss_loot,
//   study_boss_loot_save, study_loot_done
// db.bossMock.calls keeps every call (fn, who).
const iso = (ms) => new Date(ms).toISOString();
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const studyDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms - 4 * 3_600_000));
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const BOSS = { MIN_HEADS: 2, PLAYERS: 3, TRAP_HP: 20, RELAPSES: 2, HIT: 0.8, LOOT_DAYS: 3 };

module.exports = {
  seed(db) {
    const B = {
      // What study_boss_open answers for a reader: the scripts set them.
      heads: [], // [{ name, qs: [question ids], trap_q, trap_opt, slides }]
      hot: 0,
      topics: 0,
      answersNext: null,
      battles: [], // { id, quiz_id, name, lecture_ids, heads, rounds, planned, team_hp, log, outcome, revenge_of, ended_at }
      loot: [], // { user_id, quiz_id, question_id, due_on, done_at }
      calls: [],
      seq: 0,
    };
    const battleOf = (quizId) => B.battles.find((b) => b.quiz_id === quizId);
    /** Z's plugin, at the start: the battle's rounds, in head order. */
    B.roundsFor = (quizId) => (battleOf(quizId)?.rounds ?? []).map((r) => r.q);
    /** Z's plugin, after each scored reveal (section H's study_quiz__after_reveal). */
    B.afterReveal = (q, r, answers, z) => {
      const b = battleOf(q.id);
      if (!b || b.outcome) return;
      const e = b.rounds[r.idx];
      if (!e || e.done) return;
      const hd = b.heads[e.h];
      const n = answers.length;
      const rgt = answers.filter((a) => a.correct).length;
      const trapn = answers.filter((a) => hd.trap_q && r.question_id === hd.trap_q && a.choice === hd.trap_opt).length;
      if (n < BOSS.PLAYERS) Object.assign(e, { done: true, few: true });
      else {
        const perQ = Math.ceil(hd.max / Math.max(1, hd.qs.length));
        let dmg = Math.round(perQ * Math.min(1, rgt / n / BOSS.HIT));
        if (e.relapse && rgt / n >= BOSS.HIT) dmg = hd.hp;
        const hp = Math.max(0, hd.hp - dmg);
        let loss = Math.round(Math.ceil(150 / b.planned) * ((n - rgt) / n));
        if (trapn > 0 && trapn * 2 >= n) {
          loss = Math.max(loss, BOSS.TRAP_HP);
          b.log.push({ t: "trap", head: hd.name, q: hd.trap_q, opt: hd.trap_opt, hp: -BOSS.TRAP_HP, slides: hd.slides });
        }
        b.team_hp = Math.max(0, b.team_hp - loss);
        hd.hp = hp;
        Object.assign(e, { done: true, dmg, loss });
        if (hp === 0 && !hd.down) {
          hd.down = true;
          b.log.push({ t: "down", head: hd.name, relapses: hd.relapses, slides: hd.slides });
          for (const x of z.rounds.filter((x) => x.quiz_id === q.id && x.idx > r.idx && !x.opens_at && b.rounds[x.idx]?.h === e.h)) x.question_id = null;
        } else {
          const later = b.rounds.some((x, i) => x.h === e.h && i > r.idx);
          if (hp > 0 && b.team_hp > 0 && !later && hd.relapses < BOSS.RELAPSES && b.rounds.length < 30) {
            hd.relapses += 1;
            hd.hp = Math.min(hd.max, hp + Math.ceil(perQ / 2));
            const idx = b.rounds.length;
            b.rounds.push({ h: e.h, q: hd.key_q, relapse: true, done: false });
            z.pushRound(q, idx, hd.key_q);
            b.log.push({ t: "relapse", head: hd.name, slides: hd.slides });
          }
        }
      }
      const later = z.rounds.filter((x) => x.quiz_id === q.id && x.idx > r.idx && !x.opens_at && x.question_id);
      if (b.heads.every((h) => h.down)) {
        Object.assign(b, { outcome: "won", ended_at: Date.now() });
        b.log.push({ t: "last", head: hd.name, slides: hd.slides });
        for (const x of later) x.question_id = null;
      } else if (b.team_hp === 0 || !later.length) {
        Object.assign(b, { outcome: "lost", ended_at: Date.now() });
        if (b.team_hp === 0) b.log.push({ t: "fall" });
        for (const x of later) x.question_id = null;
      }
    };
    /** Z's plugin's study_quiz_state: the battle as every phone shows it (study_quiz__boss_state). */
    B.stateOf = (q) => {
      const b = battleOf(q.id);
      if (!b) return null;
      const e = q.idx >= 0 ? b.rounds[q.idx] : null;
      return {
        id: b.id, name: b.name, team_hp: b.team_hp, planned: b.planned,
        boss_hp: b.heads.reduce((s, h) => s + h.hp, 0),
        heads: b.heads.map((h) => ({ name: h.name, hp: h.hp, max: h.max, down: h.down, relapses: h.relapses, slides: h.slides })),
        head: e ? e.h : null, relapse: e ? Boolean(e.relapse) : null,
        trap: Boolean(e && b.heads[e.h].trap_q && e.q === b.heads[e.h].trap_q),
        last_round: q.state === "reveal" && e ? e : null,
        moments: b.log, outcome: b.outcome ?? null, revenge_of: b.revenge_of ?? null,
        revenge_on: b.outcome === "lost" ? addDays(studyDay(b.ended_at), 1) : null,
      };
    };
    /** Today's study_today: the caller's loot due today (section H's study_my_loot). */
    B.due = (me) =>
      B.loot
        .filter((l) => l.user_id === me && !l.done_at && l.due_on <= studyDay(Date.now()))
        .map((l) => {
          const x = db.practice?.questions.find((y) => y.id === l.question_id);
          return { question_id: l.question_id, quiz_id: l.quiz_id, due_on: l.due_on, question: x?.question ?? "", topic: x?.topic ?? "", slides: x?.slides ?? [], kind: x?.kind ?? "mcq" };
        });
    db.bossMock = B;
  },

  async rest({ method, path, body, who, db, json: answer, refuse: deny, check }) {
    if (method !== "POST" || !path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    if (!["study_boss_open", "study_boss_create", "study_boss_loot", "study_boss_loot_save", "study_loot_done"].includes(fn)) return undefined;
    const json = async (b, s) => (await answer(b, s), true);
    const refuse = async (m, s) => (await deny(m, s), true);
    check.rpc(fn, body, `${method} ${path}`);
    const B = db.bossMock;
    const P = db.pulseMock;
    const Z = db.quiz;
    const me = who?.id ?? null;
    B.calls.push({ fn, who: me });
    if (!me) return refuse("not signed in");
    const member = db.members.some((m) => m.user_id === me);
    const reader = Boolean(P && P.reader(me));
    const lootOf = (quizId) => {
      const b = B.battles.find((x) => x.quiz_id === quizId);
      const rounds = Z.rounds.filter((r) => r.quiz_id === quizId && !r.voided_at);
      const wrong = [];
      for (const r of rounds) {
        const a = Z.answers.find((x) => x.round_id === r.id && x.user_id === me && x.vote === 1);
        const qid = r.question_id ?? b?.rounds[r.idx]?.q;
        if (a && a.correct === false && qid && !wrong.some((w) => w.question_id === qid)) wrong.push({ question_id: qid, idx: r.idx });
      }
      const today = studyDay(Date.now());
      const topics = [];
      return wrong.map((w) => {
        const x = db.practice.questions.find((y) => y.id === w.question_id);
        const k = (x?.topic || "").trim().toLowerCase();
        if (!topics.includes(k)) topics.push(k);
        const d = (topics.indexOf(k) % BOSS.LOOT_DAYS) + 1;
        return { question_id: w.question_id, topic: (x?.topic || "").trim(), question: x?.question ?? "", slides: x?.slides ?? [], due_on: addDays(today, d) };
      });
    };
    switch (fn) {
      case "study_boss_open": {
        if (!member || body.p_group !== db.group.id) return refuse("group not found");
        const lost = [...B.battles].filter((b) => b.outcome).sort((a, b) => b.ended_at - a.ended_at)[0];
        const base = { heads: [], hot: 0, topics: B.topics, min_heads: BOSS.MIN_HEADS, answers_next: null };
        if (!P || !P.on) return json({ state: "off", floor: 3, ...base });
        if (P.out.has(me)) return json({ state: "out", floor: 3, ...base });
        if (!reader) return json({ state: "waiting", floor: 3, join_days: 7, join_days_left: P.joinDaysLeft[me] ?? 1, ...base });
        return json({
          state: "open", floor: 3, cutoff: P.cutoff, group_need: P.groupNeed,
          heads: B.heads.slice(0, 4).map((h) => h.name), hot: B.hot, topics: B.topics, min_heads: BOSS.MIN_HEADS, answers_next: B.answersNext,
          revenge: lost && lost.outcome === "lost"
            ? { battle: lost.id, name: lost.name, heads: lost.heads.filter((h) => !h.down).map((h) => h.name), open: studyDay(lost.ended_at) < studyDay(Date.now()) }
            : null,
        });
      }
      case "study_boss_create": {
        if (!member || body.p_group !== db.group.id) return refuse("group not found");
        if (!P || !P.on) return refuse("off");
        if (!reader) return refuse("no heads");
        let heads;
        let lectures = body.p_lectures;
        let name;
        if (body.p_revenge) {
          const old = B.battles.find((b) => b.id === body.p_revenge);
          if (!old || old.outcome !== "lost") return refuse("no heads");
          if (studyDay(old.ended_at) >= studyDay(Date.now())) return refuse("revenge not yet");
          heads = old.heads.filter((h) => !h.down).map((h) => ({ name: h.name, qs: h.qs, trap_q: h.trap_q, trap_opt: h.trap_opt, slides: h.slides }));
          lectures = old.lecture_ids;
          name = old.name;
        } else {
          if (!Array.isArray(lectures) || !lectures.length || lectures.some((l) => !db.lectures.some((x) => x.id === l))) return refuse("lecture not found");
          heads = B.heads.slice(0, 4);
          if (heads.length < BOSS.MIN_HEADS) return refuse("no heads");
          const ls = lectures.map((l) => db.lectures.find((x) => x.id === l));
          const courses = [...new Set(ls.map((l) => (l.course || "").trim()))];
          name = `ההידרה של ${ls.length === 1 || courses.length !== 1 || !courses[0] ? ls[0].title : courses[0]}`;
        }
        if (Z.quizzes.some((x) => x.group_id === db.group.id && ["lobby", "question", "reveal"].includes(x.state))) return refuse("quiz open");
        const k = heads.length;
        const base = Math.floor(100 / k);
        const hs = heads.map((h, i) => ({ ...h, key_q: h.qs[0], max: i === 0 ? 100 - base * (k - 1) : base, hp: i === 0 ? 100 - base * (k - 1) : base, relapses: 0, down: false }));
        const rounds = hs.flatMap((h, i) => h.qs.map((q) => ({ h: i, q, relapse: false, done: false })));
        if (rounds.length < 3) return refuse("no heads");
        const t = iso(Date.now());
        const q = {
          id: hex("7b100000", ++B.seq), group_id: db.group.id, mode: "boss", title: `קרב הבוס · ${name}`, lecture_ids: lectures, kinds: "all", n_wanted: rounds.length, seconds: body.p_seconds ?? 45,
          state: "lobby", idx: -1, n_total: 0, opens_at: null, closes_at: null, answered_n: 0, players_n: 1, version: 1, host_id: me, created_by: me, created_at: t, started_at: null, ended_at: null, updated_at: t,
          preset: "free", meeting_id: null, part_from: null, part_to: null, vote: 1, stage: "final", argue_until: null,
        };
        Z.quizzes.push(q);
        Z.players.push({ quiz_id: q.id, user_id: me, joined_at: Date.now(), joined_idx: -1, seen_at: Date.now(), left_at: null, score: 0, correct_n: 0, answered_n: 0, ms_total: 0 });
        B.battles.push({ id: hex("7b200000", B.seq), quiz_id: q.id, name, lecture_ids: lectures, heads: hs, rounds, planned: rounds.length, team_hp: 100, log: [], outcome: null, revenge_of: body.p_revenge ?? null, ended_at: null });
        return json(q.id);
      }
      case "study_boss_loot": {
        const b = B.battles.find((x) => x.quiz_id === body.p_quiz);
        if (!b || !member) return refuse("quiz not found");
        return json(lootOf(body.p_quiz));
      }
      case "study_boss_loot_save": {
        const b = B.battles.find((x) => x.quiz_id === body.p_quiz);
        if (!b || !member) return refuse("quiz not found");
        let n = 0;
        for (const l of lootOf(body.p_quiz)) {
          if (B.loot.some((x) => x.user_id === me && x.quiz_id === body.p_quiz && x.question_id === l.question_id)) continue;
          B.loot.push({ user_id: me, quiz_id: body.p_quiz, question_id: l.question_id, due_on: l.due_on, done_at: null });
          n += 1;
        }
        return json(n);
      }
      case "study_loot_done": {
        let n = 0;
        for (const l of B.loot.filter((x) => x.user_id === me && x.question_id === body.p_question && !x.done_at)) {
          l.done_at = Date.now();
          n += 1;
        }
        return json(n);
      }
    }
    return undefined;
  },
};
