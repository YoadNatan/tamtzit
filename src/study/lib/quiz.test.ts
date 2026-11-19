import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/* Z-3 (spec §7.Z): the group quiz's client logic, offline. design-quiz
 * §6.3's 27 checks (spec/quiz-proto/test/run.ts), moved, with what the
 * addendum changes (§12.3.Z, ZA-3):
 *  - C1-C3 the server clock; V1-V7 what the screen shows; A1-A6 when a
 *    phone acts by itself; R1-R7 Realtime events and pings: as the design;
 *  - P1-P3 were the race's old points (500 + up to 500 for speed). Decision 2
 *    replaces them: P1 is the race's order by points and then time, with
 *    the table of the top three and one's own place (review UX-24); P2 and
 *    P3 are the bet's points, equal to study_quiz__points; P4 the clock text;
 *  - ZA-3: the argue stage and vote 2 in the view and the timer, mine1, the
 *    coffee's majority words, and the bet row: an option and its bet go
 *    together, and an option chosen without a bet goes as "ניחוש" with 3 s
 *    left. */

// quiz.ts reads the app's Supabase client (api.ts), which reads Vite's import.meta.env.
(import.meta as unknown as { env: Record<string, string> }).env = {};
const Q = await import("./quiz");
type QuizState = import("./quiz").QuizState;
type QuizPlayer = import("./quiz").QuizPlayer;

// ── the server clock: a phone 40 s fast, round trips of 80-900 ms
test("C1 clock: a phone 40 s fast still counts down to the server's deadline (error ≤ 40 ms with an 80 ms round trip)", () => {
  let local = 1_000_000;
  const c = new Q.ServerClock(() => local);
  const skew = 40_000; // local = server + 40 s
  const trips = [
    [900, 100],
    [80, 40],
    [300, 280],
    [120, 60],
    [600, 50],
  ]; // [rtt, server stamp after send]
  for (const [rtt, at] of trips) {
    const t0 = local;
    const server = t0 - skew + at;
    local += rtt;
    c.add(new Date(server).toISOString(), t0, local);
  }
  const err = Math.abs(c.now() - (local - skew));
  assert.ok(err <= 40, `${err} ms`);
});
test("C2 clock: no samples means no offset", () => assert.equal(new Q.ServerClock(() => 5).now(), 5));
test("C3 clock: a bad server time is ignored", () => {
  const c3 = new Q.ServerClock(() => 0);
  c3.add("not a date", 0, 10);
  assert.equal(c3.offset(), 0);
});

// ── a state as study_quiz_state returns it
const T = Date.parse("2026-11-15T18:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
function state(over: Partial<QuizState["quiz"]> = {}, round: Partial<NonNullable<QuizState["round"]>> | null = {}, playing = true): QuizState {
  return {
    now: iso(T),
    quiz: {
      id: "q", group_id: "g", mode: "race", title: "Antimalarials", lecture_ids: ["l"], kinds: "all", n_wanted: 10, seconds: 20,
      state: "question", idx: 0, n_total: 10, opens_at: iso(T + 3000), closes_at: iso(T + 23000), answered_n: 0, players_n: 3,
      version: 5, host_id: "a", vote: 1, stage: "final", argue_until: null, ...over,
    },
    me: playing ? { playing: true, score: 0, correct_n: 0, answered_n: 0, joined_idx: -1 } : null,
    host_here: true,
    players: [],
    round:
      round === null
        ? null
        : {
            idx: 0, seconds: 20, opens_at: iso(T + 3000), closes_at: iso(T + 23000), vote: 1, stage: "final", voided: false, voided_by: null,
            q: { id: "x", kind: "mcq", vignette: "", question: "?", options: ["a", "b", "c", "d", "e"], slides: [3], topic: "", aspect: "other", lecture_id: "l" },
            mine: null, mine1: null, ...round,
          },
    summary: null,
  };
}

// ── what the screen shows
test("V1 view: before opens_at, a 3-2-1 countdown", () => {
  const v = Q.viewOf(state(), T);
  assert.ok(v.v === "countdown" && v.secs === 3, JSON.stringify(v));
});
test("V2 view: during the round, the time left and the options", () => {
  const v = Q.viewOf(state(), T + 13000);
  assert.ok(v.v === "question" && v.leftMs === 10000 && v.canAnswer, JSON.stringify(v));
});
test("V3 view: after answering, no second answer", () => {
  const v = Q.viewOf(state({}, { mine: { choice: 2, ms: 4000, bet: 1 } }), T + 13000);
  assert.ok(v.v === "question" && v.answered && !v.canAnswer);
});
test("V4 view: a member watching cannot answer", () => {
  const v = Q.viewOf(state({}, {}, false), T + 13000);
  assert.ok(v.v === "question" && !v.canAnswer);
});
test("V5 view: after the deadline, waiting for the reveal", () => assert.equal(Q.viewOf(state(), T + 23500).v, "waiting"));
test("V6 view: the other states map one to one", () => {
  for (const s of ["lobby", "reveal", "ended", "cancelled"] as const) assert.equal(Q.viewOf(state({ state: s }), T).v, s);
});
test("V7 view: a round whose question was deleted cannot be answered", () => {
  const v = Q.viewOf(state({}, { q: null }), T + 5000);
  assert.ok(v.v === "question" && !v.canAnswer);
});

// ── acting by itself
test("A1 act: before the round, the countdown ticks each second (3, 2, 1) and wakes exactly when the question opens", () => {
  const a = Q.nextAction(state(), T, 300, T);
  assert.ok(a.what === "tick" && a.inMs === 1000, JSON.stringify(a));
  assert.equal(Q.nextAction(state(), T + 2500, 300, T).inMs, 500);
  assert.equal(Q.nextAction(state(), T + 2999.5, 300, T).inMs, 0.5);
});
test("A1b act: the screen and the timer agree: at any instant the number shown holds until the timer's moment, and changes then", () => {
  const s = state();
  const shown = (t: number) => {
    const v = Q.viewOf(s, t);
    return v.v === "countdown" ? `cd ${v.secs}` : v.v === "question" ? `q ${Q.clock(v.leftMs)}` : v.v;
  };
  for (let t = T; t < T + 23000; t += 37.25) {
    const a = Q.nextAction(s, t, 300, t);
    assert.equal(a.what, "tick", `${t - T}`);
    assert.equal(shown(t + a.inMs - 0.25), shown(t), `${t - T}: unchanged just before`);
    assert.notEqual(shown(t + a.inMs), shown(t), `${t - T}: changed at the timer's moment`);
  }
  assert.equal(shown(T + 3000), "q 0:20", "the question opens at the opening, with all its seconds");
});
test("A2 act: at the deadline, ask for the reveal after the 1.5 s grace plus this phone's jitter", () => {
  const a = Q.nextAction(state(), T + 23000, 300, T + 20000);
  assert.ok(a.what === "reveal" && a.inMs === 1800, JSON.stringify(a));
});
test("A3 act: a member watching never asks for the reveal (only players may); it pings after the server's own 4.5 s", () => {
  const a = Q.nextAction(state({}, {}, false), T + 23000, 300, T + 20000);
  assert.ok(a.what === "ping" && a.inMs === 4800, JSON.stringify(a));
});
test("A4 act: on the reveal screen, only the 15 s ping", () => {
  const a = Q.nextAction(state({ state: "reveal" }), T + 30000, 300, T + 20000);
  assert.ok(a.what === "ping" && a.inMs === 5000, JSON.stringify(a));
});
test("A5 act: during the round, tick every second", () => {
  const a = Q.nextAction(state(), T + 10000, 0, T + 9000);
  assert.ok(a.what === "tick" && a.inMs === 1000);
});
test("A6 act: six phones' reveal requests spread over 0.8 s", () => {
  const jit = [0, 137, 512, 799].map((j) => Q.nextAction(state(), T + 23000, j, T + 22000).inMs);
  assert.ok(new Set(jit).size === 4 && Math.max(...jit) - Math.min(...jit) === 799, jit.join(","));
});

// ── Realtime events
const s5 = state();
test("R1 event: same version, only the count moved: applied without a request", () => {
  const e1 = Q.onRowEvent(s5, { version: 5, answered_n: 2, players_n: 3 });
  assert.ok(e1.kind === "apply" && e1.state.quiz.answered_n === 2);
});
test("R2 event: a new version means a step: read the state", () => assert.equal(Q.onRowEvent(s5, { version: 6, answered_n: 0 }).kind, "refetch"));
test("R3 event: a partial payload (no version) is never trusted", () => assert.equal(Q.onRowEvent(s5, {}).kind, "refetch"));
test("R4 event: before the first state, read it", () => assert.equal(Q.onRowEvent(null, { version: 1, answered_n: 0 }).kind, "refetch"));
test("R5 ping: the same version and host: nothing to read", () => assert.ok(!Q.pingNeedsState(s5, { version: 5, host_here: true })));
test("R6 ping: a version missed while the socket was down: read the state", () => assert.ok(Q.pingNeedsState(s5, { version: 7, host_here: true })));
test("R7 ping: the host's phone went quiet: read the state (shows the take-over button)", () => assert.ok(Q.pingNeedsState(s5, { version: 5, host_here: false })));

// ── the race's table and the bet's points (decision 2)
const players: QuizPlayer[] = [
  { user_id: "1", name: "שוהם", host: true, here: true, left: false, joined_idx: -1, score: 4, ms: 9000 },
  { user_id: "2", name: "נועה", host: false, here: true, left: false, joined_idx: -1, score: 6, ms: 12000 },
  { user_id: "3", name: "יעל", host: false, here: true, left: false, joined_idx: 1, score: 4, ms: 7000 },
  { user_id: "4", name: "דנה", host: false, here: true, left: false, joined_idx: -1, score: -2, ms: 3000 },
  { user_id: "5", name: "מאיה", host: false, here: true, left: false, joined_idx: -1, score: -2, ms: 3000 },
];
test("P1 table: points first, then the shorter time breaks a tie; the same points and time share a place; a player sees the top three and their own place", () => {
  const ranks = Q.rankRows(players).map((p) => `${p.name}:${p.rank}`).join(" ");
  assert.equal(ranks, "נועה:1 יעל:2 שוהם:3 דנה:4 מאיה:4", ranks);
  assert.deepEqual(Q.tableRows(players, "4").map((p) => `${p.name}${p.mine ? "*" : ""}`), ["נועה", "יעל", "שוהם", "דנה*"], "fourth place: the top three and one's own row");
  assert.deepEqual(Q.tableRows(players, "3").map((p) => p.name), ["נועה", "יעל", "שוהם"], "in the top three: no extra row");
  assert.deepEqual(Q.rankRows([{ ...players[0], score: undefined }]), [], "a watcher's copy has no scores: no table");
});
test("P2 points: the bet's, as study_quiz__points: right +1/+2/+3; wrong 0/−2/−6; לא יודעים or none 0; no bet is ניחוש", () => {
  // The SQL: case when choice is null or key is null then 0 when choice = key then coalesce(bet, 1) else case coalesce(bet, 1) when 1 then 0 when 2 then -2 else -6 end end
  const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  assert.match(sql, /when p_choice = p_key then coalesce\(p_bet, 1\)\s+else case coalesce\(p_bet, 1\) when 1 then 0 when 2 then -2 else -6 end end/);
  const cases: Array<[number | null, number, number | null, number]> = [
    [1, 1, 1, 1],
    [1, 1, 2, 2],
    [1, 1, 3, 3],
    [2, 1, 1, 0],
    [2, 1, 2, -2],
    [2, 1, 3, -6],
    [null, 1, null, 0],
    [1, 1, null, 1],
    [2, 1, null, 0],
  ];
  for (const [choice, key, bet, want] of cases) assert.equal(Q.betPoints(choice, key, bet), want, `${choice} vs ${key}, bet ${bet}`);
  assert.equal(Q.betPoints(1, null, 3), 0, "a voided round (no key) counts nothing");
});
test("P3 points: a race's first answers and the tie: ZA11's race (שוהם 2, נועה כהן 2, מאיה −6; Shoham faster) ranks Noa second", () => {
  const race: QuizPlayer[] = [
    { user_id: "s", name: "שוהם", host: true, here: true, left: false, joined_idx: -1, score: Q.betPoints(1, 1, 2), ms: 5100 },
    { user_id: "n", name: "נועה כהן", host: false, here: true, left: false, joined_idx: -1, score: Q.betPoints(1, 1, 2), ms: 9200 },
    { user_id: "m", name: "מאיה", host: false, here: true, left: false, joined_idx: -1, score: Q.betPoints(2, 1, 3), ms: 9300 },
  ];
  assert.deepEqual(Q.rankRows(race).map((p) => `${p.name} ${p.score} ${p.rank}`), ["שוהם 2 1", "נועה כהן 2 2", "מאיה -6 3"]);
  assert.equal(Q.signed(2), "+2");
  assert.equal(Q.signed(-6), "−6");
  assert.equal(Q.signed(0), "0");
});
test("P4 clock text", () => {
  assert.equal(Q.clock(7000), "0:07");
  assert.equal(Q.clock(61001), "1:02");
  assert.equal(Q.clock(-5), "0:00");
});

// ── ZA-3: the argue stage, vote 2, the bet row, mine1, majority
test("ZA-3 view: the argue stage shows vote 1's counts and its 90 s, then vote 2 counts down and asks again", () => {
  const argue = state({ state: "reveal", stage: "argue", argue_until: iso(T + 90_000) }, { stage: "argue", argue_until: iso(T + 90_000), counts1: [2, 2, 0, 0, 0], answered1: 4 });
  const v = Q.viewOf(argue, T + 43_000);
  assert.ok(v.v === "argue" && v.leftMs === 47_000, JSON.stringify(v));
  assert.equal(Q.clock(47_000), "0:47", "מתווכחים בקול. הסבב השני נפתח בעוד 0:47");
  // vote 2: a countdown, then the question again, with the vote on screen
  const v2 = state({ vote: 2 }, { vote: 2, mine: null, mine1: { choice: 1, bet: 3 } });
  const c = Q.viewOf(v2, T);
  assert.ok(c.v === "countdown" && c.vote === 2, JSON.stringify(c));
  const q = Q.viewOf(v2, T + 13000);
  assert.ok(q.v === "question" && q.vote === 2 && q.canAnswer, JSON.stringify(q));
});
test("ZA-3 act: during the argument the countdown ticks; once it is over any phone's ping opens vote 2", () => {
  const argue = state({ state: "reveal", stage: "argue", argue_until: iso(T + 90_000) });
  const a = Q.nextAction(argue, T + 40_000, 200, T + 39_000);
  assert.ok(a.what === "tick" && a.inMs === 1000, JSON.stringify(a));
  const b = Q.nextAction(argue, T + 90_000, 200, T + 89_000);
  assert.ok(b.what === "ping" && b.inMs === 1500, JSON.stringify(b)); // 1 s after the end + 300 ms + this phone's 200 ms
});
test("ZA-3 mine1: the first vote is kept apart once vote 2 opens", () => {
  assert.deepEqual(Q.firstVote(state({}, { mine: { choice: 2, ms: 900, bet: 3 } }).round), { choice: 2, bet: 3 }, "vote 1: this vote");
  assert.deepEqual(Q.firstVote(state({ vote: 2 }, { vote: 2, mine: { choice: 1, ms: 400, bet: null }, mine1: { choice: 2, bet: 3 } }).round), { choice: 2, bet: 3 }, "vote 2: the first vote, with its bet");
  assert.equal(Q.firstVote(state({}, { mine: null }).round), null);
});
test("ZA-3 bet row: an option and its bet go together; לא יודעים and vote 2 carry no bet", () => {
  assert.deepEqual(Q.answerArgs("q", 3, 2, 3, 1), { p_quiz: "q", p_idx: 3, p_choice: 2, p_bet: 3, p_vote: 1 });
  assert.deepEqual(Q.answerArgs("q", 3, 2, null, 1), { p_quiz: "q", p_idx: 3, p_choice: 2, p_bet: 1, p_vote: 1 }, "no bet: ניחוש");
  assert.deepEqual(Q.answerArgs("q", 3, null, 3, 1), { p_quiz: "q", p_idx: 3, p_choice: null, p_bet: null, p_vote: 1 }, "לא יודעים");
  assert.deepEqual(Q.answerArgs("q", 3, 1, 3, 2), { p_quiz: "q", p_idx: 3, p_choice: 1, p_bet: null, p_vote: 2 }, "vote 2: no bet");
  assert.deepEqual(Q.BET_WORDS, { 1: "ניחוש", 2: "נראה לי", 3: "על בטוח" });
});
test("ZA-3 bet row: the scale's approved copy, each signed number set left to right (its sign stays before it in a Hebrew line)", () => {
  assert.equal(Q.BET_SCALE.replace(/[\u2066-\u2069]/g, ""), "צודקים: +1 · +2 · +3. טועים: 0 · −2 · −6.");
  for (const n of ["+1", "+2", "+3", "−2", "−6"]) assert.ok(Q.BET_SCALE.includes(`\u2066${n}\u2069`), n);
  assert.equal(Q.ltr(Q.signed(-6)), "\u2066−6\u2069");
});
test("ZA-3 bet row: with 3 s left an option chosen without a bet goes as ניחוש; never before, never in vote 2, never twice", () => {
  const s = state();
  const at = (left: number) => Q.viewOf(s, T + 23000 - left);
  assert.equal(Q.autoBet(at(3500), 2, false), null, "3.5 s left: still waiting for the bet");
  assert.equal(Q.autoBet(at(3000), 2, false), 1, "3 s left: ניחוש");
  assert.equal(Q.autoBet(at(2000), null, false), null, "nothing chosen: nothing sent");
  assert.equal(Q.autoBet(at(2000), 2, true), null, "already on its way");
  const v2 = state({ vote: 2 }, { vote: 2 });
  assert.equal(Q.autoBet(Q.viewOf(v2, T + 21000), 2, false), null, "vote 2 has no bet: a tap sends");
  assert.equal(Q.autoBet(Q.viewOf(state({}, {}, false), T + 21000), 2, false), null, "a member watching sends nothing");
});
test("ZA-3 majority: the coffee's words (section M's opening), never a number", () => {
  assert.deepEqual(Q.MAJORITY_WORD, { most_right: "רובכם צדקו", split: "הקבוצה חלוקה", most_wrong: "רובכם טעו" });
});

// ── the reveal's numbers and the setup's
test("counts: the bars of a vote, most chosen first, the key marked; 83%, היה 33%", () => {
  const bars = Q.barRows([3, 2, 1, 0, 0], ["Doxycycline", "Clindamycin", "Primaquine", "x", "y"], 1);
  assert.deepEqual(bars.map((b) => `${b.text} ${b.n}${b.right ? " ✓" : ""}`), ["Doxycycline 3", "Clindamycin 2 ✓", "Primaquine 1"]);
  assert.deepEqual(Q.barRows([1, 5, 0, 0], ["Doxycycline", "Clindamycin", "c", "d"], 1).map((b) => b.n), [5, 1]);
  assert.equal(Q.barRows(null, ["a"]).length, 0, "below 3 answers the database sends no counts: no bars");
  assert.equal(`${Q.pct(5, 6)}%, היה ${Q.pct(2, 6)}%`, "83%, היה 33%");
});
test("the question that broke the group: the lowest share right among rounds with counts", () => {
  const r = (idx: number, right: number | undefined, answered: number, voided = false) =>
    ({ idx, voided, q: null, answer: 0, explanations: [], takeaway: "", right, answered, mine: null }) as import("./quiz").SummaryRound;
  assert.equal(Q.hardest([r(0, 5, 6), r(1, 2, 6), r(2, 1, 2), r(3, 0, 6, true)])?.idx, 1, "a round of 2 answers has no counts; a voided one is out");
  assert.equal(Q.hardest([r(0, undefined, 2)]), null);
});
test("the setup: a long question's time is study_quiz__seconds's (QZ3b: a 1,300-character case gets 97 s), and the summary line's minutes", () => {
  assert.equal(Q.questionSeconds(30, 1300), 97);
  assert.equal(Q.questionSeconds(60, 100), 60);
  assert.equal(Q.questionSeconds(20, 9000), 240);
  assert.equal(Q.quizMinutes(Array(10).fill(60), "coop"), 15);
  assert.equal(Q.quizMinutes(Array(10).fill(30), "race"), 7);
  assert.equal(Q.namesLine(["שוהם", "נועה", "יעל", "דנה", "רוני"]), "שוהם, נועה +3");
  assert.equal(Q.namesLine(["שוהם"]), "שוהם");
});
test("errors: every code the quiz's functions raise has words or is a re-read; a shared code reads as everywhere else", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  const z = sql.slice(sql.indexOf("-- ════ BEGIN SECTION Z"), sql.indexOf("-- ════ END SECTION Z"));
  const codes = new Set([...z.matchAll(/raise exception '([^'%]+)'/g)].map((m) => m[1]));
  assert.ok(codes.size >= 20, `${codes.size} codes`);
  for (const c of codes) assert.ok(Object.prototype.hasOwnProperty.call(Q.QUIZ_ERROR_TEXT, c) || ["not signed in", "group not found", "lecture not found"].includes(c), c);
  assert.equal(Q.quizErrorText("closed"), "הזמן נגמר לפני שהתשובה הגיעה.");
  assert.equal(Q.quizErrorText("not host"), null, "another phone moved on: re-read");
  assert.equal(Q.quizErrorText("group not found"), "הקבוצה לא נמצאה. כדאי לרענן.");
  assert.equal(Q.quizErrorText("something new"), Q.QUIZ_ERROR_TEXT.network);
});

// LOOK-5: the setup never shows a selected count it cannot ask for.
test("quizCounts: fewer ready than the kept count: a 'הכול' choice (N ready) is selected, never a disabled count", () => {
  const COUNTS = [5, 10, 15, 20];
  const six = Q.quizCounts(COUNTS, 10, 6, false);
  assert.equal(six.count, 6);
  assert.deepEqual(
    six.choices.map((c) => [c.label, c.checked, c.disabled]),
    [
      ["5", false, false],
      ["הכול", true, false],
      ["10", false, true],
      ["15", false, true],
      ["20", false, true],
    ],
  );
  for (const r of [0, 2, 3, 4, 6, 9, 10, 12, 20, 40]) {
    for (const wanted of COUNTS) {
      const { count, choices } = Q.quizCounts(COUNTS, wanted, r, false);
      const on = choices.filter((c) => c.checked);
      assert.ok(on.length <= 1, `${wanted}/${r}: one selected at most`);
      for (const c of on) assert.ok(!c.disabled && (c.n === count || (c.all && count >= c.n)), `${wanted}/${r}: the selected choice is what the quiz asks (${count})`);
      if (r >= 3) assert.equal(on.length, 1, `${wanted}/${r}: something is selected`);
    }
  }
  // Picking 5 then asks for 5; picking "הכול" keeps a valid preference (10) and asks for the 6 ready.
  assert.equal(Q.quizCounts(COUNTS, 5, 6, false).choices.find((c) => c.checked)!.label, "5");
  const all = six.choices.find((c) => c.all)!;
  assert.equal(all.pick, 10);
  assert.equal(Q.quizCounts(COUNTS, all.pick, 6, false).count, 6);
  // Enough ready, or a lecture written first: the counts as they are, the kept one selected.
  assert.deepEqual(Q.quizCounts(COUNTS, 10, 40, false).choices.map((c) => [c.label, c.checked]), [["5", false], ["10", true], ["15", false], ["20", false]]);
  assert.deepEqual(Q.quizCounts(COUNTS, 15, 2, true).choices.map((c) => [c.label, c.checked, c.disabled]), [["5", false, false], ["10", false, false], ["15", true, false], ["20", false, false]]);
});
