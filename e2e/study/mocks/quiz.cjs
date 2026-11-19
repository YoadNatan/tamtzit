// Package Z's plugin for the e2e mock (spec §8.3; design-quiz §6.5): section
// Z's functions as PostgREST answers them for each member, a JavaScript port
// of the SQL's state machine with Z's end (supabase/study-schema.sql, section
// Z): create, join, leave, next (start, "לסבב 2", the next question), answer
// (with the bet and the vote), reveal (Mazur's rule from 3 first votes: ≥ 70%
// explain, 30-70% argue, < 30% the source), void, take_host, end, ping,
// state (filtered for the caller as study_quiz_state filters it: no key
// before the reveal, counts only from 3 answers, scores only to a race's
// players, the end only to players), open, pool, recent and record. The
// questions and keys are package Q's plugin's (db.practice); an open round
// holds its key there ("in quiz"), and a reveal copies each first vote, with
// its bet, into the owner's practice answers (mode "quiz").
//
// Realtime: every change sends the quiz row (UPDATE; INSERT on create) to
// the subscribers whose filter matches (id, group_id). db.quiz.bare = true
// sends rows with no columns (record {}), to exercise the re-read path.
// Times come from the environment, as design-quiz §6.5 says: E2E_LEAD_MS
// (3000), E2E_GRACE_MS (1500), E2E_DUE_MS (4500), E2E_ARGUE_MS (90000, as the
// SQL) and E2E_AWAY_MS: 20000 (30 s in the SQL). The design's 4000 is shorter
// than the phones' 15-s ping, so every phone that had not just answered or
// pinged would count as away and a round would be revealed before they
// answered; 20 s keeps a live phone "here" and lets a closed one go sooner.
// Every response body is logged in db.quiz.bodies for the privacy checks.
const LEAD = Number(process.env.E2E_LEAD_MS || 3000);
const GRACE = Number(process.env.E2E_GRACE_MS || 1500);
const DUE = Number(process.env.E2E_DUE_MS || 4500);
const AWAY = Number(process.env.E2E_AWAY_MS || 20000);
const ARGUE = Number(process.env.E2E_ARGUE_MS || 90000);
const STALE = 20 * 60_000;
const iso = (ms) => new Date(ms).toISOString();
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const studyDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms - 4 * 3_600_000));
/** study_quiz__seconds: the setting, or ~15 characters a second + 10 s, at most 240. */
const seconds = (setting, chars) => Math.min(240, Math.max(setting, Math.ceil(chars / 15) + 10));
/** study_quiz__points: right +bet; wrong 0, −2, −6; none 0; no bet is ניחוש. */
const points = (choice, key, bet) => {
  if (choice === null || choice === undefined || key === null || key === undefined) return 0;
  const b = bet === 2 || bet === 3 ? bet : 1;
  return choice === key ? b : b === 1 ? 0 : b === 2 ? -2 : -6;
};
const ROW = ["id", "group_id", "mode", "title", "lecture_ids", "kinds", "n_wanted", "seconds", "state", "idx", "n_total", "opens_at", "closes_at", "answered_n", "players_n", "version", "host_id", "created_by", "created_at", "started_at", "ended_at", "updated_at", "preset", "meeting_id", "part_from", "part_to", "vote", "stage", "argue_until"];

module.exports = {
  seed(db) {
    db.quiz = { quizzes: [], rounds: [], players: [], answers: [], seq: { quiz: 0, round: 0 }, notify: null, bare: false, bodies: [], log: [] };
  },

  async rest({ method, path, body, who, db, notify, json: reply, refuse: refuseWith, check }) {
    const Z = db.quiz;
    if (!Z) return undefined;
    Z.notify = Z.notify ?? notify;
    if (!path.startsWith("/rest/v1/rpc/study_quiz_")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    check.rpc(fn, body, `${method} ${path}`);
    const json = async (b, s) => {
      Z.bodies.push({ fn, who: who?.id ?? null, at: Date.now(), body: JSON.stringify(b ?? null) });
      await reply(b, s);
      return true;
    };
    const refuse = async (m, s) => {
      Z.log.push(`${fn} ${who?.user_metadata?.full_name ?? "?"}: ${m}`);
      await refuseWith(m, s);
      return true;
    };
    const P = db.practice;
    const me = who ? who.id : null;
    if (!me) return refuse("not signed in", 401);
    const isMember = (g) => db.members.some((m) => m.group_id === g && m.user_id === me);
    const nameOf = (u) => db.members.find((m) => m.user_id === u)?.name ?? "";
    const now = () => Date.now();
    const quizOf = (id) => Z.quizzes.find((q) => q.id === id);
    const roundsOf = (q) => Z.rounds.filter((r) => r.quiz_id === q.id).sort((a, b) => a.idx - b.idx);
    const roundAt = (q, idx) => Z.rounds.find((r) => r.quiz_id === q.id && r.idx === idx);
    const playersOf = (q) => Z.players.filter((p) => p.quiz_id === q.id);
    const playerOf = (q, u) => Z.players.find((p) => p.quiz_id === q.id && p.user_id === u);
    const answersOf = (r, vote) => Z.answers.filter((a) => a.round_id === r.id && (vote === undefined || a.vote === vote));
    const questionOf = (id) => (id ? P.questions.find((x) => x.id === id) : null);
    const keyOf = (id) => (id ? P.keys.get(id) ?? null : null);
    const playing = (q, u = me) => Boolean(playerOf(q, u) && !playerOf(q, u).left_at);
    const seen = (q, u = me) => {
      const p = playerOf(q, u);
      if (p && !p.left_at) p.seen_at = now();
    };
    const hostHere = (q) => {
      const p = q.host_id ? playerOf(q, q.host_id) : null;
      return Boolean(p && !p.left_at && p.seen_at > now() - AWAY);
    };
    const send = (q, type = "UPDATE") => {
      const row = Object.fromEntries(ROW.map((k) => [k, q[k] === undefined ? null : q[k]]));
      Z.notify?.("study_quizzes", type, row, {}, Z.bare ? { bare: true } : undefined);
    };
    const step = (q) => {
      q.version += 1;
      q.updated_at = iso(now());
      send(q);
    };
    const hold = (qid, on) => {
      if (!qid) return;
      if (on) P.inQuiz.add(qid);
      else P.inQuiz.delete(qid);
    };

    /* ── the internal functions (study_quiz__*) ── */
    const allAnswered = (q, idx) => {
      const r = roundAt(q, idx);
      return playersOf(q)
        .filter((p) => !p.left_at && p.seen_at > now() - AWAY)
        .every((p) => r && answersOf(r, q.vote).some((a) => a.user_id === p.user_id));
    };
    /** A round of a quiz (H's relapse adds one after the start, as study_quiz__after_reveal does). */
    const pushRound = (q, idx, qid) => {
      const x = questionOf(qid);
      if (!x) return;
      const chars = (x.vignette || "").length + x.question.length + x.options.reduce((n, o) => n + o.length, 0);
      Z.rounds.push({ id: hex("7a000000", ++Z.seq.round), quiz_id: q.id, idx, question_id: qid, seconds: seconds(q.seconds, chars), opens_at: null, closes_at: null, revealed_at: null, answer: null, voided_at: null, voided_by: null, vote: 1, next_step: null, answered1: null, right1: null, counts1: null, trap: null });
      if (q.n_total) q.n_total += 1;
    };
    const pick = (q) => {
      Z.rounds = Z.rounds.filter((r) => r.quiz_id !== q.id);
      // A boss battle: section H's rounds, in head order (H's plugin, db.bossMock).
      if (q.mode === "boss") {
        const ids = db.bossMock?.roundsFor?.(q.id) ?? [];
        ids.forEach((qid, i) => pushRound(q, i, qid));
        return Z.rounds.filter((r) => r.quiz_id === q.id).length;
      }
      // "3 לקפה": section M's picker (package M's plugin), as study_quiz__pick_preset.
      const preset = q.preset === "coffee" ? db.meetingMock?.pickPreset?.(q) : null;
      if (preset) {
        preset.slice(0, q.n_wanted).forEach((qid, i) => {
          const x = questionOf(qid);
          const chars = (x.vignette || "").length + x.question.length + x.options.reduce((n, o) => n + o.length, 0);
          Z.rounds.push({ id: hex("7a000000", ++Z.seq.round), quiz_id: q.id, idx: i, question_id: qid, seconds: seconds(q.seconds, chars), opens_at: null, closes_at: null, revealed_at: null, answer: null, voided_at: null, voided_by: null, vote: 1, next_step: null, answered1: null, right1: null, counts1: null, trap: null });
        });
        return Math.min(preset.length, q.n_wanted);
      }
      const pool = P.questions
        .filter((x) => x.group_id === q.group_id && q.lecture_ids.includes(x.lecture_id ?? x.ref_lecture) && !x.retired_at && x.has_key && (q.kinds === "all" || x.kind === q.kinds))
        .filter((x) => q.part_from === null || q.part_from === undefined || (x.part_idx ?? -1) >= q.part_from && (x.part_idx ?? -1) <= q.part_to)
        .map((x) => ({
          x,
          lec: q.lecture_ids.indexOf(x.lecture_id ?? x.ref_lecture),
          part: x.part_idx ?? -1,
          flagged: P.flags.some((f) => f.question_id === x.id && ["wrong_key", "two_answers", "not_in_slides"].includes(f.reason)),
          rnd: Math.random(),
          chars: (x.vignette || "").length + x.question.length + x.options.reduce((n, o) => n + o.length, 0),
        }));
      // Spread over the parts: rank within (lecture, part), flagged last, then at random.
      const rank = new Map();
      for (const p of [...pool].sort((a, b) => Number(a.flagged) - Number(b.flagged) || a.rnd - b.rnd)) {
        const k = `${p.lec}|${p.part}`;
        rank.set(k, (rank.get(k) ?? 0) + 1);
        p.rk = rank.get(k);
      }
      const chosen = [...pool].sort((a, b) => Number(a.flagged) - Number(b.flagged) || a.rk - b.rk || a.rnd - b.rnd).slice(0, q.n_wanted);
      const ordered = q.mode === "coop" ? chosen.sort((a, b) => a.lec - b.lec || a.part - b.part || a.rnd - b.rnd) : chosen.sort((a, b) => a.rnd - b.rnd);
      ordered.forEach((c, i) =>
        Z.rounds.push({ id: hex("7a000000", ++Z.seq.round), quiz_id: q.id, idx: i, question_id: c.x.id, seconds: seconds(q.seconds, c.chars), opens_at: null, closes_at: null, revealed_at: null, answer: null, voided_at: null, voided_by: null, vote: 1, next_step: null, answered1: null, right1: null, counts1: null, trap: null }),
      );
      return ordered.length;
    };
    const finish = (q) => {
      if (!["lobby", "question", "reveal"].includes(q.state)) return;
      const was = q.state;
      if (q.state === "question") reveal(q, q.idx);
      if (q.state === "reveal" && q.stage === "argue") {
        const r = roundAt(q, q.idx);
        score(q, r, keyOf(r.question_id)?.answer ?? null, "explain", now());
      }
      Object.assign(q, { state: was === "lobby" ? "cancelled" : "ended", ended_at: iso(now()), opens_at: null, closes_at: null, stage: "final", argue_until: null });
      step(q);
    };
    const open = (q, idx) => {
      const r = roundsOf(q).find((x) => x.idx >= idx && x.question_id);
      if (!r) return finish(q);
      const t0 = now() + LEAD;
      Object.assign(r, { opens_at: iso(t0), closes_at: iso(t0 + r.seconds * 1000), vote: 1 });
      hold(r.question_id, true);
      Object.assign(q, { state: "question", idx: r.idx, opens_at: r.opens_at, closes_at: r.closes_at, vote: 1, stage: "final", argue_until: null, answered_n: 0 });
      step(q);
    };
    const counts = (r, vote, n) => {
      const out = Array(n).fill(0);
      for (const a of answersOf(r, vote)) if (a.choice !== null) out[a.choice] += 1;
      return out;
    };
    const score = (q, r, key, stepName, t) => {
      hold(r.question_id, false);
      for (const a of answersOf(r)) {
        a.correct = a.choice !== null && a.choice === key;
        a.points = a.vote === 1 ? points(a.choice, key, a.bet) : 0;
      }
      for (const a of answersOf(r, 1)) {
        const p = playerOf(q, a.user_id);
        if (!p) continue;
        p.score += a.points;
        p.correct_n += a.correct ? 1 : 0;
        p.answered_n += 1;
        p.ms_total += a.ms;
        P.answers.push({ user_id: a.user_id, question_id: r.question_id, choice: a.choice, correct: a.correct, mode: "quiz", ms: a.ms, answered_at: a.answered_at, confidence: a.bet });
      }
      Object.assign(r, { revealed_at: iso(t), answer: key, closes_at: iso(Math.min(Date.parse(r.closes_at), t)), next_step: stepName });
      // Section H's hook: a battle's hit points (H's plugin, db.bossMock).
      if (q.mode === "boss") db.bossMock?.afterReveal?.(q, r, answersOf(r, 1), { rounds: Z.rounds, pushRound });
      Object.assign(q, { state: "reveal", stage: "final", argue_until: null, closes_at: iso(Math.min(Date.parse(q.closes_at), t)), answered_n: answersOf(r, q.vote).length });
      step(q);
    };
    const reveal = (q, idx) => {
      if (q.state !== "question" || q.idx !== idx) return;
      const r = roundAt(q, idx);
      const t = now();
      const key = keyOf(r.question_id)?.answer ?? null;
      const nopt = questionOf(r.question_id)?.options.length ?? 0;
      if (key === null || !questionOf(r.question_id)) {
        hold(r.question_id, false);
        Object.assign(r, { revealed_at: iso(t), voided_at: iso(t), closes_at: iso(Math.min(Date.parse(r.closes_at), t)) });
        Object.assign(q, { state: "reveal", stage: "final", argue_until: null, answered_n: answersOf(r, q.vote).length });
        return step(q);
      }
      let next = "explain";
      if (q.vote === 1) {
        const v1 = answersOf(r, 1);
        const n1 = v1.length;
        const ok1 = v1.filter((a) => a.choice === key).length;
        const c1 = counts(r, 1, nopt);
        let trap = null;
        if (n1 >= 3) {
          const wrong = c1.map((n, i) => ({ n, i })).filter((x) => x.i !== key);
          const top = Math.max(...wrong.map((x) => x.n));
          if (top >= 2 && wrong.filter((x) => x.n === top).length === 1) trap = wrong.find((x) => x.n === top).i;
        }
        if (q.mode === "coop" && q.preset !== "coffee" && n1 >= 3) {
          const share = ok1 / n1;
          next = share >= 0.7 ? "explain" : share >= 0.3 ? "argue" : "source";
        }
        Object.assign(r, { answered1: n1, right1: ok1, counts1: c1, trap });
        if (next === "argue") {
          Object.assign(r, { next_step: "argue", closes_at: iso(Math.min(Date.parse(r.closes_at), t)) });
          Object.assign(q, { state: "reveal", stage: "argue", argue_until: iso(t + ARGUE), closes_at: iso(Math.min(Date.parse(q.closes_at), t)), answered_n: n1 });
          return step(q);
        }
      }
      score(q, r, key, next, t);
    };
    const openVote2 = (q) => {
      if (q.state !== "reveal" || q.stage !== "argue") return;
      const r = roundAt(q, q.idx);
      const t0 = now() + LEAD;
      const secs = Math.min(r.seconds, 30);
      Object.assign(r, { vote: 2, opens_at: iso(t0), closes_at: iso(t0 + secs * 1000) });
      hold(r.question_id, true);
      Object.assign(q, { state: "question", vote: 2, stage: "final", argue_until: null, opens_at: r.opens_at, closes_at: r.closes_at, answered_n: 0 });
      step(q);
    };
    const due = (q) => {
      if (q.state === "question" && now() > Date.parse(q.closes_at) + DUE) reveal(q, q.idx);
      else if (q.state === "reveal" && q.stage === "argue" && now() > Date.parse(q.argue_until) + 1000) openVote2(q);
    };
    const record = (g, before) => {
      let best = null;
      for (const q of Z.quizzes.filter((x) => x.group_id === g && x.state === "ended" && x.mode === "coop" && ["free", "end"].includes(x.preset) && Date.parse(x.ended_at) < before)) {
        const rs = roundsOf(q).filter((r) => r.revealed_at && !r.voided_at);
        if (rs.length < 5 || playersOf(q).length < 3) continue;
        const fin = rs.flatMap((r) => answersOf(r, r.vote));
        if (!fin.length) continue;
        const pct = Math.round((100 * fin.filter((a) => a.correct).length) / fin.length);
        best = best === null ? pct : Math.max(best, pct);
      }
      return best;
    };
    /** "3 לקפה"'s word for a round, from 3 first votes (section Z's end: never a count). */
    const majorityOf = (r) => {
      const n = r.answered1 ?? 0;
      if (n < 3) return null;
      return r.right1 * 2 > n ? "most_right" : r.right1 * 2 === n ? "split" : "most_wrong";
    };
    const qJson = (x, extra = {}) =>
      x
        ? { id: x.id, kind: x.kind, vignette: x.vignette || "", question: x.question, teaser: x.teaser ?? "", options: x.options, slides: x.slides, topic: x.topic, aspect: x.aspect, lecture_id: x.lecture_id ?? x.ref_lecture, part_idx: x.part_idx ?? null, anchor: x.anchor ?? null, ...extra }
        : null;

    /* ── what the phones call ── */
    switch (fn) {
      case "study_quiz_create": {
        const g = body.p_group;
        if (!g || !isMember(g)) return refuse("group not found");
        const preset = body.p_preset ?? "free";
        if (!["free", "end", "coffee", "stop"].includes(preset)) return refuse("bad preset");
        if (!["coop", "race", "boss"].includes(body.p_mode)) return refuse("bad mode");
        if (["coffee", "stop"].includes(preset) && body.p_mode !== "coop") return refuse("bad mode");
        const kinds = body.p_kinds ?? "all";
        if (!["all", "mcq", "case"].includes(kinds)) return refuse("bad kinds");
        const count = body.p_count;
        if (count === null || count === undefined || (preset === "stop" && count !== 1) || (preset === "coffee" && count !== 3) || (["free", "end"].includes(preset) && (count < 3 || count > 30))) return refuse("bad count");
        if (!(body.p_seconds >= 15 && body.p_seconds <= 120)) return refuse("bad seconds");
        const lecs = [...new Set((body.p_lectures || []).filter(Boolean))];
        if (!lecs.length || lecs.length > 40 || lecs.some((l) => db.lectures.find((x) => x.id === l)?.group_id !== g)) return refuse("lecture not found");
        // Section M (package M's plugin, db.meetingMock): a meeting of this group, not cancelled.
        const M = db.meetingMock;
        if (["coffee", "stop"].includes(preset) && !body.p_meeting) return refuse("meeting not found");
        if (body.p_meeting && !(M && M.meetings.some((x) => x.id === body.p_meeting && x.group_id === g && !x.cancelled_at))) return refuse("meeting not found");
        if (body.p_meeting && ["coffee", "end"].includes(preset) && Z.quizzes.some((x) => x.meeting_id === body.p_meeting && x.preset === preset && x.state !== "cancelled")) return refuse("already");
        for (const q of Z.quizzes.filter((x) => x.group_id === g && ["lobby", "question", "reveal"].includes(x.state))) {
          if (Date.parse(q.updated_at) < now() - STALE && !playersOf(q).some((p) => p.seen_at > now() - STALE)) finish(q);
        }
        if (Z.quizzes.some((x) => x.group_id === g && ["lobby", "question", "reveal"].includes(x.state))) return refuse("quiz open");
        if (["coffee", "end"].includes(preset) && Z.quizzes.some((x) => x.group_id === g && x.preset === preset && x.state !== "cancelled" && studyDay(Date.parse(x.created_at)) === studyDay(now()))) return refuse("already");
        const ls = lecs.map((l) => db.lectures.find((x) => x.id === l));
        const courses = [...new Set(ls.map((l) => (l.course || "").trim()))];
        const title = ls.length === 1 ? ls[0].title : courses.length === 1 && courses[0] ? `${courses[0]} · ${ls.length} הרצאות` : ls.map((l) => l.title).join(" · ");
        const t = iso(now());
        const q = {
          id: hex("7b000000", ++Z.seq.quiz), group_id: g, mode: body.p_mode, title: title.slice(0, 200) || "מבחן", lecture_ids: lecs, kinds, n_wanted: count, seconds: body.p_seconds,
          state: "lobby", idx: -1, n_total: 0, opens_at: null, closes_at: null, answered_n: 0, players_n: 1, version: 1, host_id: me, created_by: me, created_at: t, started_at: null, ended_at: null, updated_at: t,
          preset, meeting_id: body.p_meeting ?? null, part_from: body.p_part_from ?? null, part_to: body.p_part_to ?? null, vote: 1, stage: "final", argue_until: null,
        };
        Z.quizzes.push(q);
        Z.players.push({ quiz_id: q.id, user_id: me, joined_at: now(), joined_idx: -1, seen_at: now(), left_at: null, score: 0, correct_n: 0, answered_n: 0, ms_total: 0 });
        send(q, "INSERT");
        return json(q.id);
      }
      case "study_quiz_open": {
        if (!isMember(body.p_group)) return json([]);
        const q = Z.quizzes
          .filter((x) => x.group_id === body.p_group && ["lobby", "question", "reveal"].includes(x.state))
          .filter((x) => Date.parse(x.updated_at) > now() - STALE || playersOf(x).some((p) => p.seen_at > now() - STALE))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
        if (!q) return json([]);
        const active = playersOf(q).filter((p) => !p.left_at).sort((a, b) => a.joined_at - b.joined_at);
        return json([{ id: q.id, mode: q.mode, title: q.title, state: q.state, idx: q.idx, n_total: q.n_total, players_n: q.players_n, host_id: q.host_id, playing: playing(q), names: active.map((p) => nameOf(p.user_id)) }]);
      }
      case "study_quiz_pool": {
        if (!isMember(body.p_group)) return json([]);
        const by = new Map();
        for (const x of P.questions.filter((y) => y.group_id === body.p_group && !y.retired_at && y.has_key && (y.lecture_id ?? y.ref_lecture))) {
          const k = x.lecture_id ?? x.ref_lecture;
          const row = by.get(k) ?? { lecture_id: k, mcq: 0, cases: 0 };
          if (x.kind === "mcq") row.mcq += 1;
          else row.cases += 1;
          by.set(k, row);
        }
        return json([...by.values()]);
      }
      case "study_quiz_recent": {
        if (!isMember(body.p_group)) return json([]);
        const rows = Z.quizzes
          .filter((q) => q.group_id === body.p_group && q.state === "ended")
          .sort((a, b) => (a.ended_at < b.ended_at ? 1 : -1))
          .slice(0, Math.max(1, Math.min(body.p_limit ?? 5, 50)))
          .map((q) => {
            const ps = playersOf(q);
            const rs = roundsOf(q).filter((r) => r.revealed_at && !r.voided_at);
            const fin = rs.flatMap((r) => answersOf(r, r.vote));
            const mine = playerOf(q, me);
            const better = (o) => o.score > mine.score || (o.score === mine.score && o.ms_total < mine.ms_total);
            return {
              id: q.id, mode: q.mode, title: q.title, ended_at: q.ended_at, players_n: ps.length, rounds: rs.length,
              right_pct: q.preset !== "coffee" && ps.length >= 3 && fin.length ? Math.round((100 * fin.filter((a) => a.correct).length) / fin.length) : null,
              played: Boolean(mine), my_correct: mine ? mine.correct_n : null, my_answered: mine ? mine.answered_n : null,
              my_rank: q.mode === "race" && mine ? 1 + ps.filter(better).length : null,
            };
          });
        return json(rows);
      }
      case "study_quiz_record":
        if (!isMember(body.p_group)) return refuse("group not found");
        return json(record(body.p_group, now()));
    }

    const q = quizOf(body.p_quiz);
    if (!q || !isMember(q.group_id)) return refuse("quiz not found");
    switch (fn) {
      case "study_quiz_join": {
        if (!["lobby", "question", "reveal"].includes(q.state)) return refuse("quiz over");
        if (playing(q)) {
          seen(q);
          return json(null);
        }
        const p = playerOf(q, me);
        if (p) Object.assign(p, { left_at: null, seen_at: now() });
        else Z.players.push({ quiz_id: q.id, user_id: me, joined_at: now(), joined_idx: q.idx, seen_at: now(), left_at: null, score: 0, correct_n: 0, answered_n: 0, ms_total: 0 });
        q.players_n = playersOf(q).filter((x) => !x.left_at).length;
        q.host_id = q.host_id ?? me;
        step(q);
        return json(null);
      }
      case "study_quiz_leave": {
        const p = playerOf(q, me);
        if (!p || p.left_at || !["lobby", "question", "reveal"].includes(q.state)) {
          if (p && !p.left_at) p.left_at = now();
          return json(null);
        }
        p.left_at = now();
        const left = playersOf(q).filter((x) => !x.left_at);
        if (!left.length) {
          q.players_n = 0;
          finish(q);
          return json(null);
        }
        if (q.host_id === me) q.host_id = [...left].sort((a, b) => b.seen_at - a.seen_at || a.joined_at - b.joined_at)[0].user_id;
        q.players_n = left.length;
        step(q);
        if (q.state === "question" && allAnswered(q, q.idx)) reveal(q, q.idx);
        return json(null);
      }
      case "study_quiz_next": {
        if (!["lobby", "question", "reveal"].includes(q.state)) return refuse("quiz over");
        if (q.host_id !== me) return refuse("not host");
        seen(q);
        if (q.idx !== body.p_from) return json(null);
        if (q.state === "question") return refuse("not revealed");
        if (q.state === "lobby") {
          // A boss battle needs 3 players: below three, every hit would tell who missed (section H).
          if (q.mode === "boss" && playersOf(q).filter((p) => !p.left_at).length < 3) return refuse("need 3");
          const n = pick(q);
          if (!n) return refuse("no questions");
          Object.assign(q, { n_total: n, started_at: iso(now()) });
          open(q, 0);
        } else if (q.stage === "argue") openVote2(q);
        else open(q, q.idx + 1);
        return json(null);
      }
      case "study_quiz_answer": {
        if (!playing(q)) return refuse("not playing");
        const v = body.p_vote ?? q.vote;
        const r = roundAt(q, body.p_idx);
        const kept = r && answersOf(r, v).find((a) => a.user_id === me);
        if (kept) return json([{ idx: body.p_idx, choice: kept.choice, ms: kept.ms, answered_at: kept.answered_at, vote: kept.vote, bet: kept.bet }]);
        if (q.state !== "question" || q.idx !== body.p_idx || v !== q.vote) return refuse("closed");
        const t = now();
        if (t < Date.parse(r.opens_at)) return refuse("not open");
        if (t > Date.parse(r.closes_at) + GRACE) return refuse("closed");
        const nopt = questionOf(r.question_id)?.options.length;
        if (!nopt) return refuse("closed");
        const choice = body.p_choice === null || body.p_choice === undefined ? null : Number(body.p_choice);
        if (choice === null ? !["coop", "boss"].includes(q.mode) : choice < 0 || choice >= nopt) return refuse("bad choice");
        if (body.p_bet !== null && body.p_bet !== undefined && !(body.p_bet >= 1 && body.p_bet <= 3)) return refuse("bad bet");
        const bet = v === 1 && choice !== null ? body.p_bet ?? 1 : null;
        const ms = Math.min(r.seconds * 1000, Math.max(0, t - Date.parse(r.opens_at)));
        Z.answers.push({ round_id: r.id, user_id: me, choice, ms, answered_at: iso(t), vote: v, bet, correct: null, points: 0 });
        seen(q);
        if (allAnswered(q, body.p_idx)) reveal(q, body.p_idx);
        else {
          q.answered_n = answersOf(r, v).length;
          q.updated_at = iso(now());
          send(q);
        }
        return json([{ idx: body.p_idx, choice, ms, answered_at: iso(t), vote: v, bet }]);
      }
      case "study_quiz_reveal": {
        if (q.state !== "question" || q.idx !== body.p_idx) return json(null);
        if (!playing(q)) return refuse("not playing");
        if (now() < Date.parse(q.opens_at)) return refuse("not open");
        if (now() < Date.parse(q.closes_at) + GRACE && !(q.mode === "coop" && q.host_id === me)) return refuse("too early");
        seen(q);
        reveal(q, body.p_idx);
        return json(null);
      }
      case "study_quiz_end": {
        if (!["lobby", "question", "reveal"].includes(q.state)) return json(null);
        if (q.host_id !== me) return refuse("not host");
        finish(q);
        return json(null);
      }
      case "study_quiz_take_host": {
        if (!["lobby", "question", "reveal"].includes(q.state)) return refuse("quiz over");
        if (!playing(q)) return refuse("not playing");
        if (q.host_id === me) return json(null);
        if (hostHere(q)) return refuse("host here");
        q.host_id = me;
        step(q);
        seen(q);
        return json(null);
      }
      case "study_quiz_void": {
        if (q.host_id !== me) return refuse("not host");
        const r = roundAt(q, body.p_idx);
        if (!r || !r.revealed_at) return refuse("not revealed");
        if (r.voided_at) return json(null);
        if (q.mode === "race" && q.idx !== body.p_idx) return refuse("too late");
        for (const a of answersOf(r, 1)) {
          const p = playerOf(q, a.user_id);
          if (!p) continue;
          p.score -= a.points;
          p.correct_n = Math.max(0, p.correct_n - (a.correct ? 1 : 0));
          p.answered_n = Math.max(0, p.answered_n - 1);
          p.ms_total = Math.max(0, p.ms_total - a.ms);
          P.answers = P.answers.filter((x) => !(x.user_id === a.user_id && x.question_id === r.question_id && x.mode === "quiz" && x.answered_at === a.answered_at));
        }
        for (const a of answersOf(r)) a.points = 0;
        Object.assign(r, { voided_at: iso(now()), voided_by: me });
        step(q);
        return json(null);
      }
      case "study_quiz_ping": {
        seen(q);
        due(q);
        return json([{ server_now: iso(now()), version: q.version, state: q.state, idx: q.idx, answered_n: q.answered_n, host_here: hostHere(q) }]);
      }
      case "study_quiz_state": {
        due(q);
        const player = Boolean(playerOf(q, me));
        const p = playerOf(q, me);
        const r = ["question", "reveal"].includes(q.state) ? roundAt(q, q.idx) : null;
        const x = r ? questionOf(r.question_id) : null;
        let round = null;
        if (r) {
          const lecture = x ? db.lectures.find((l) => l.id === (x.lecture_id ?? x.ref_lecture)) : null;
          const mineV = answersOf(r, r.vote).find((a) => a.user_id === me);
          const mine1 = answersOf(r, 1).find((a) => a.user_id === me);
          round = {
            idx: r.idx, seconds: r.seconds, opens_at: r.opens_at, closes_at: r.closes_at, vote: r.vote, stage: q.stage, voided: Boolean(r.voided_at), voided_by: r.voided_by,
            q: qJson(x, { lecture_title: lecture?.title ?? null }),
            mine: mineV ? { choice: mineV.choice, ms: mineV.ms, bet: mineV.bet } : null,
            mine1: mine1 ? { choice: mine1.choice, bet: mine1.bet } : null,
          };
          if (q.state === "reveal" && q.stage === "argue") {
            Object.assign(round, { argue_until: q.argue_until, answered1: r.answered1, counts1: r.answered1 >= 3 ? r.counts1 : null });
          } else if (q.state === "reveal") {
            const k = keyOf(r.question_id);
            const fin = answersOf(r, r.vote);
            const ok = fin.filter((a) => a.correct).length;
            Object.assign(round, {
              answer: r.answer, explanations: k?.explanations ?? [], takeaway: k?.takeaway ?? "", next_step: r.next_step,
              points: mine1 ? mine1.points : null, correct: mine1 ? mine1.correct : null,
            });
            if (!player) Object.assign(round, { answered: fin.length });
            else if (q.preset === "coffee") Object.assign(round, { majority: majorityOf(r) });
            else {
              Object.assign(round, {
                counts: fin.length >= 3 ? counts(r, r.vote, x?.options.length ?? 0) : null,
                dont_know: fin.length >= 3 ? fin.filter((a) => a.choice === null).length : null,
                answered: fin.length, right: fin.length >= 3 ? ok : null, trap: r.trap,
                correct2: answersOf(r, 2).find((a) => a.user_id === me)?.correct ?? null,
                jump: r.next_step === "source" && x?.anchor !== null && x?.anchor !== undefined ? { lecture_id: x.lecture_id, part: x.part_idx, anchor: x.anchor, quote: x.quote ?? "" } : null,
              });
              if (r.vote === 2) Object.assign(round, { counts1: r.counts1, answered1: r.answered1, right1: r.right1 });
            }
          }
        }
        const players = playersOf(q)
          .sort((a, b) => a.joined_at - b.joined_at)
          .map((pl) => ({
            user_id: pl.user_id, name: nameOf(pl.user_id), host: pl.user_id === q.host_id, here: !pl.left_at && pl.seen_at > now() - AWAY, left: Boolean(pl.left_at), joined_idx: pl.joined_idx,
            ...(q.mode === "race" && player
              ? { score: pl.score, correct_n: pl.correct_n, ms: pl.ms_total, last_points: q.state === "reveal" && q.stage === "final" && r ? answersOf(r, 1).find((a) => a.user_id === pl.user_id)?.points ?? null : null }
              : {}),
          }));
        let summary = null;
        let team = null;
        if (q.state === "ended" && player) {
          summary = roundsOf(q)
            .filter((r2) => r2.revealed_at)
            .map((r2) => {
              const x2 = questionOf(r2.question_id);
              const k2 = keyOf(r2.question_id);
              const fin = answersOf(r2, r2.vote);
              const a1 = answersOf(r2, 1).find((a) => a.user_id === me);
              const a2 = answersOf(r2, 2).find((a) => a.user_id === me);
              if (q.preset === "coffee") {
                return {
                  idx: r2.idx, voided: Boolean(r2.voided_at), vote: r2.vote, trap: r2.trap, q: qJson(x2), answer: r2.answer, explanations: k2?.explanations ?? [], takeaway: k2?.takeaway ?? "",
                  majority: majorityOf(r2),
                  mine: a1 ? { choice: a1.choice, correct: a1.correct, points: a1.points, bet: a1.bet, choice2: null, correct2: null } : null,
                };
              }
              return {
                idx: r2.idx, voided: Boolean(r2.voided_at), vote: r2.vote, trap: r2.trap, q: qJson(x2), answer: r2.answer, explanations: k2?.explanations ?? [], takeaway: k2?.takeaway ?? "",
                answered: fin.length,
                ...(fin.length >= 3 ? { right: fin.filter((a) => a.correct).length, counts: counts(r2, r2.vote, x2?.options.length ?? 0), counts1: r2.vote === 2 ? r2.counts1 : null, right1: r2.vote === 2 ? r2.right1 : null } : {}),
                mine: a1 ? { choice: a1.choice, correct: a1.correct, points: a1.points, bet: a1.bet, choice2: a2?.choice ?? null, correct2: a2?.correct ?? null } : null,
              };
            });
          if (q.mode === "coop" && ["free", "end"].includes(q.preset) && playersOf(q).length >= 3) {
            const rs = roundsOf(q).filter((r3) => r3.revealed_at && !r3.voided_at);
            const fin = rs.flatMap((r3) => answersOf(r3, r3.vote));
            const pct = fin.length ? Math.round((100 * fin.filter((a) => a.correct).length) / fin.length) : null;
            const before = record(q.group_id, Date.parse(q.ended_at));
            team = { right_pct: pct, passed: pct !== null && pct >= 80, record_before: before, new_record: pct !== null && pct > (before ?? -1) && rs.length >= 5 && playersOf(q).length >= 3 };
          }
        }
        return json({
          now: iso(now()),
          quiz: { ...Object.fromEntries(ROW.map((k) => [k, q[k] === undefined ? null : q[k]])), record: q.mode === "coop" && ["free", "end"].includes(q.preset) ? record(q.group_id, q.ended_at ? Date.parse(q.ended_at) : now()) : null },
          me: p ? { playing: !p.left_at, score: p.score, correct_n: p.correct_n, answered_n: p.answered_n, joined_idx: p.joined_idx, ms_total: p.ms_total } : null,
          host_here: hostHere(q),
          players,
          round,
          summary,
          team,
          boss: q.mode === "boss" ? db.bossMock?.stateOf?.(q) ?? null : null,
        });
      }
    }
    return undefined;
  },
};
