import assert from "node:assert/strict";
import { test } from "node:test";
import { numericValue } from "../../../server/study/questions";
import {
  appendQueue,
  answerArgs,
  answered,
  autopsyOrder,
  keepPrinted,
  printedOrder,
  betLabel,
  inPick,
  styleOf,
  currentId,
  examSeconds,
  type Feedback,
  isNumericOption,
  isOver,
  loadHidden,
  loadSession,
  dropStart,
  mistakeNote,
  modeOf,
  next,
  parseScope,
  peekStart,
  pickQueue,
  recordAnswer,
  requestStart,
  saveSession,
  score,
  type SessionQuestion,
  sessionKey,
  setHidden,
  showOrder,
  shownOptions,
  startSession,
  takeStart,
  timeUp,
  toShown,
  toStored,
  unpracticed,
  visibleFeedback,
} from "./practiceSession";
import { studyDay } from "../../../shared/study/day";

/* Q-3 (spec §7.Q): the pure part of a practice session. pickQueue's tiers,
 * flagged last, hidden left out, sizes, exam order, t.<topic> and
 * m.<lecture>; over 500 seeds each showing's order, the choice sent, the key
 * and the explanations stay aligned, and all-numeric options never move;
 * "מצב מבחן" holds every feedback until the end. Synthetic questions only. */

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const L1 = "11111111-0000-4000-8000-000000000001";
const L2 = "11111111-0000-4000-8000-000000000002";
const L3 = "11111111-0000-4000-8000-000000000003";
const EXAM = "66666666-0000-4000-8000-000000000001";
const QUIZ = "77777777-0000-4000-8000-000000000001";

const q = (id: string, o: Partial<SessionQuestion> = {}): SessionQuestion => ({
  id,
  lecture_id: L1,
  ref_lecture: null,
  exam_no: null,
  part_idx: 0,
  created_at: "2026-11-01T10:00:00Z",
  topic: "Examplomycin",
  vignette: "",
  question: `שאלה ${id}?`,
  options: ["Examplomycin", "Mockazole", "Placebrin", "Stubamide", "Testoquine"],
  ...o,
});
const latest = (rows: Array<[string, boolean, string]>) => new Map(rows.map(([id, correct, at]) => [id, { correct, at, times: 1 }]));
const flag = [{ id: "f1" }];

// ── Session keys ──
test("parseScope: every key of the practice route, and nothing else", () => {
  assert.deepEqual(parseScope(`l.${L1}`), { kind: "lecture", lecture: L1 });
  assert.deepEqual(parseScope("c.פתוגן מאכסן"), { kind: "course", course: "פתוגן מאכסן" });
  assert.deepEqual(parseScope("m"), { kind: "mistakes", lecture: null });
  assert.deepEqual(parseScope(`m.${L2}`), { kind: "mistakes", lecture: L2 });
  assert.deepEqual(parseScope("t. Mockaquine "), { kind: "topic", topic: "mockaquine" });
  assert.deepEqual(parseScope(`e.${EXAM}`), { kind: "exam", exam: EXAM });
  assert.deepEqual(parseScope(`q.${QUIZ}`), { kind: "quiz", quiz: QUIZ });
  for (const bad of [undefined, "", "l.not-a-uuid", "m.x", "e.", "x.1", "lecture", `t.${"a".repeat(201)}`]) assert.equal(parseScope(bad), null, String(bad));
  assert.deepEqual(
    [`l.${L1}`, "c.x", "m", "t.x", `e.${EXAM}`, `q.${QUIZ}`].map((s) => modeOf(parseScope(s)!)),
    ["lecture", "course", "mistakes", "course", "exam", "course"],
  );
  assert.equal(modeOf(parseScope(`l.${L1}`)!, true), "exam", "מצב מבחן records exam");
});

// ── pickQueue ──
test("pickQueue: a lecture's tiers: never answered in part order, then wrong now (oldest first), then right (least recent first)", () => {
  const qs = [
    q("a", { part_idx: 2 }),
    q("b", { part_idx: 0, created_at: "2026-11-01T10:05:00Z" }),
    q("c", { part_idx: 0 }),
    q("d", { part_idx: 1 }),
    q("e", { part_idx: 1 }),
    q("f", { part_idx: 3 }),
    q("g", { part_idx: 3 }),
    q("h", { part_idx: 0, lecture_id: L2 }),
  ];
  const ids = pickQueue({
    key: `l.${L1}`,
    questions: qs,
    latest: latest([
      ["d", true, "2026-11-03T09:00:00Z"],
      ["e", false, "2026-11-04T09:00:00Z"],
      ["f", false, "2026-11-02T09:00:00Z"],
      ["g", true, "2026-11-01T09:00:00Z"],
    ]),
    size: "all",
    random: seeded(1),
  });
  assert.deepEqual(ids, ["c", "b", "a", "f", "e", "g", "d"], "h is another lecture's");
});

test("pickQueue: an open mistake answered right today stays in the wrong tier (review UX-2)", () => {
  const ids = pickQueue({
    key: `l.${L1}`,
    questions: [q("a"), q("b")],
    latest: latest([
      ["a", true, "2026-11-04T09:00:00Z"],
      ["b", true, "2026-11-03T09:00:00Z"],
    ]),
    mistakes: [{ question_id: "a", wrong_at: "2026-11-04T08:59:00Z" }],
    size: "all",
    random: seeded(1),
  });
  assert.deepEqual(ids, ["a", "b"]);
});

test("pickQueue: flagged questions go last in each tier", () => {
  const ids = pickQueue({
    key: `l.${L1}`,
    questions: [
      q("a", { part_idx: 0, study_question_flags: flag }),
      q("b", { part_idx: 1 }),
      q("c", { part_idx: 2 }),
      q("w1", { study_question_flags: flag }),
      q("w2"),
      q("r1", { study_question_flags: flag }),
      q("r2"),
    ],
    latest: latest([
      ["w1", false, "2026-11-01T09:00:00Z"],
      ["w2", false, "2026-11-02T09:00:00Z"],
      ["r1", true, "2026-11-01T09:00:00Z"],
      ["r2", true, "2026-11-02T09:00:00Z"],
    ]),
    size: "all",
    random: seeded(1),
  });
  assert.deepEqual(ids, ["b", "c", "a", "w2", "w1", "r2", "r1"]);
});

test("pickQueue: questions this person hid never come, in any session", () => {
  const qs = [q("a"), q("b", { exam_no: 1 }), q("c")];
  const hidden = new Set(["b"]);
  for (const key of [`l.${L1}`, "c.x", `e.${EXAM}`, "m", "t.examplomycin"]) {
    const ids = pickQueue({
      key,
      questions: qs,
      latest: new Map(),
      mistakes: [{ question_id: "b", wrong_at: "2026-11-01T00:00:00Z" }],
      hidden,
      size: "all",
      random: seeded(2),
    });
    assert.ok(!ids.includes("b"), key);
  }
});

test("pickQueue: sizes: 10, 20, all, and never more than there are", () => {
  const qs = Array.from({ length: 25 }, (_, i) => q(`q${String(i).padStart(2, "0")}`, { part_idx: i }));
  const pick = (size: number | "all") => pickQueue({ key: `l.${L1}`, questions: qs, latest: new Map(), size, random: seeded(3) });
  assert.equal(pick(10).length, 10);
  assert.equal(pick(20).length, 20);
  assert.equal(pick("all").length, 25);
  assert.equal(pick(0).length, 0);
  assert.deepEqual(pick(10), pick("all").slice(0, 10));
  assert.deepEqual(pickQueue({ key: "nonsense", questions: qs, latest: new Map(), size: "all", random: seeded(3) }), []);
});

test("pickQueue: a past exam in its own order", () => {
  const qs = [q("x3", { exam_no: 3 }), q("x1", { exam_no: 1 }), q("x12", { exam_no: 12 }), q("x2", { exam_no: 2 }), q("none", { exam_no: null })];
  const ids = pickQueue({ key: `e.${EXAM}`, questions: qs, latest: latest([["x1", true, "2026-11-01T00:00:00Z"]]), size: "all", random: seeded(4) });
  assert.deepEqual(ids, ["x1", "x2", "x3", "x12", "none"], "answered or not, the exam's order");
});

test("pickQueue: m and m.<lecture>: the open mistakes, oldest first, of one lecture when asked", () => {
  const qs = [q("a"), q("b", { lecture_id: L2 }), q("c"), q("d", { lecture_id: null, ref_lecture: L2, exam_no: 4 })];
  const mistakes = [
    { question_id: "c", wrong_at: "2026-11-03T00:00:00Z" },
    { question_id: "b", wrong_at: "2026-11-01T00:00:00Z" },
    { question_id: "a", wrong_at: "2026-11-02T00:00:00Z" },
    { question_id: "d", wrong_at: "2026-11-02T12:00:00Z" },
    { question_id: "gone", wrong_at: "2026-10-01T00:00:00Z" },
  ];
  const pick = (key: string) => pickQueue({ key, questions: qs, latest: new Map(), mistakes, size: "all", random: seeded(5) });
  assert.deepEqual(pick("m"), ["b", "a", "d", "c"], "a mistake whose question is not loaded is skipped");
  assert.deepEqual(pick(`m.${L2}`), ["b", "d"], "a past-exam item counts for the lecture that explains it");
});

test("Q-2 (§12.3.Q tier 1): m asks what is due again first, each in another wording, then today's mistakes as themselves", () => {
  const G = "22222222-2222-4222-8222-222222222222";
  // a and c are due again (wrong on an earlier day): a in another wording (a2, on its paragraph), c as itself;
  // e is today's mistake; b2 would be a's wording too but a2 is the one chosen; h is hidden by this person.
  const qs = [q("a"), q("a2"), q("c"), q("e"), q("h"), q("h2"), q("x", { lecture_id: L2 }), q("x2", { lecture_id: L2 })];
  const mistakes = [
    { question_id: "e", wrong_at: "2026-11-15T09:00:00Z" },
    { question_id: "c", wrong_at: "2026-11-13T09:00:00Z" },
    { question_id: "a", wrong_at: "2026-11-12T09:00:00Z" },
    { question_id: "x", wrong_at: "2026-11-11T09:00:00Z" },
  ];
  const again = [
    { question_id: "c", ask: "c", wrong_at: "2026-11-13T09:00:00Z" },
    { question_id: "a", ask: "a2", wrong_at: "2026-11-12T09:00:00Z" },
    { question_id: "x", ask: "x2", wrong_at: "2026-11-11T09:00:00Z" },
  ];
  const pick = (key: string, o: { hidden?: Set<string>; again?: typeof again } = {}) =>
    pickQueue({ key, questions: qs, latest: new Map(), mistakes, again: o.again ?? again, hidden: o.hidden, size: "all", random: seeded(3) });
  assert.deepEqual(pick("m"), ["x2", "a2", "c", "e"], "the oldest due first, each in its wording; a is not asked again as itself");
  assert.deepEqual(pick(`m.${L1}`), ["a2", "c", "e"], "m.<lecture>: that lecture's");
  assert.deepEqual(pick("m", { again: [] }), ["x", "a", "c", "e"], "without Q-2's list: the open mistakes, oldest first, as before");
  assert.deepEqual(pick("m", { hidden: new Set(["a2"]) }), ["x2", "a", "c", "e"], "a hidden wording: the question itself");
  // r.<group>: only what is due again, in the order given (the danger list's rows first), each once.
  const danger = [{ question_id: "h", ask: "h2", wrong_at: "2026-11-14T09:00:00Z" }, ...again, { question_id: "a", ask: "a2", wrong_at: "2026-11-12T09:00:00Z" }];
  assert.deepEqual(pick(`r.${G}`, { again: danger }), ["h2", "c", "a2", "x2"], "today's mistake e is not due yet; a twice is asked once");
  assert.deepEqual(pick(`r.${G}`, { again: [] }), [], "nothing due: an empty session");
  assert.deepEqual(parseScope(`r.${G}`), { kind: "again", group: G });
  assert.equal(parseScope("r.not-a-uuid"), null);
  assert.equal(modeOf(parseScope(`r.${G}`)!), "mistakes", "answers in another wording are recorded as mistakes");
});

test("pickQueue: t.<topic>: the topic's questions only, weakest first as a course session", () => {
  const qs = [
    q("a", { topic: "Mockaquine" }),
    q("b", { topic: " mockaquine ", lecture_id: L2 }),
    q("c", { topic: "Examplomycin" }),
    q("d", { topic: "MOCKAQUINE", lecture_id: L3 }),
  ];
  const ids = pickQueue({ key: "t.mockaquine", questions: qs, latest: latest([["a", false, "2026-11-01T00:00:00Z"], ["b", true, "2026-11-01T00:00:00Z"]]), size: "all", random: seeded(6) });
  assert.deepEqual(ids, ["d", "a", "b"]);
});

test("pickQueue: a course's never-answered questions are shuffled with the lectures interleaved; a seed repeats", () => {
  const qs = [
    ...Array.from({ length: 6 }, (_, i) => q(`a${i}`, { lecture_id: L1, part_idx: i })),
    ...Array.from({ length: 6 }, (_, i) => q(`b${i}`, { lecture_id: L2, part_idx: i })),
    ...Array.from({ length: 6 }, (_, i) => q(`c${i}`, { lecture_id: L3, part_idx: i })),
  ];
  for (const key of ["c.קורס", `q.${QUIZ}`]) {
    const seen = new Set<string>();
    for (let s = 1; s <= 40; s++) {
      const ids = pickQueue({ key, questions: qs, latest: new Map(), size: "all", random: seeded(s) });
      assert.equal(ids.length, 18);
      for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i][0], ids[i - 1][0], `${key}: two of one lecture in a row (seed ${s})`);
      seen.add(ids.join());
      assert.deepEqual(ids, pickQueue({ key, questions: qs, latest: new Map(), size: "all", random: seeded(s) }));
    }
    assert.ok(seen.size > 30, `${key}: ${seen.size} different orders in 40 seeds`);
  }
});

// ── Each showing's order ──
const OPTIONS = ["Testoquine", "Fictemisinins", "Mockaquine", "Placebone-stubanil", "Shaminine"];
const FB: Feedback = { answer: 2, explanations: OPTIONS.map((o) => `הסבר על ${o}. [ש' 23]`), takeaway: "רק Mockaquine. [ש' 20]", correct: false };

test("order: over 500 seeds the shown order, the choice sent, the key and the explanations stay aligned", () => {
  const places = [0, 0, 0, 0, 0];
  let moved = 0;
  for (let s = 1; s <= 500; s++) {
    const rnd = seeded(s);
    const order = showOrder(OPTIONS, rnd);
    assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4], "a permutation");
    const shown = shownOptions(OPTIONS, order);
    if (shown.join() !== OPTIONS.join()) moved += 1;
    for (let pick = 0; pick < 5; pick++) assert.equal(OPTIONS[toStored(order, pick)!], shown[pick], "the choice sent is the option tapped");
    const fb = toShown(order, FB);
    assert.equal(shown[fb.answer], "Mockaquine", "the key points at the right option as shown");
    fb.explanations.forEach((e, i) => assert.equal(e, `הסבר על ${shown[i]}. [ש' 23]`, "each explanation under its own option"));
    assert.equal(fb.takeaway, FB.takeaway);
    places[fb.answer] += 1;
  }
  assert.ok(moved > 490, `${moved} of 500 showings moved the options`);
  assert.ok(
    places.every((n) => n > 60),
    places.join("/"),
  );
  assert.equal(toStored([2, 0, 1], null), null, "לא יודעים stays null");
  assert.throws(() => toStored([2, 0, 1], 3));
});

test("order: all-numeric options are never permuted; a mixed list is", () => {
  const numeric = ["5 חודשים", "6 שעות", "8 שעות", "24 שעות", "48 שעות"];
  for (let s = 1; s <= 500; s++) assert.deepEqual(showOrder(numeric, seeded(s)), [0, 1, 2, 3, 4]);
  for (const t of [...numeric, "7-31 ימים", "≥ 3 mg/kg", "0.5%", "Examplomycin", "פעמיים ביום", "3 פעמים ביום עם ארוחה שומנית מאוד"]) {
    assert.equal(isNumericOption(t), numericValue(t) !== null, `the server's rule for "${t}"`);
  }
  assert.ok([1, 2, 3, 4, 5].some((s) => showOrder([...numeric.slice(0, 4), "Examplomycin"], seeded(s)).join() !== "0,1,2,3,4"));
});

// ── The session, and "מצב מבחן" ──
const queue = [q("a", { vignette: "מטופלת בת 30 עם חום. ".repeat(30) }), q("b"), q("c")];
const fbFor = (id: string, answer = 1): Feedback => ({ answer, explanations: OPTIONS.map((o) => `${id}: ${o}. [ש' 1]`), takeaway: `${id}. [ש' 1]` });

test("session: feedback right after each answer; answers sent with the stored index, the mode and the time", () => {
  let s = startSession({ key: `l.${L1}`, timed: false, queue, now: 1_000, random: seeded(9) });
  assert.deepEqual([s.mode, s.timed, s.seconds], ["lecture", false, [0, 0, 0]]);
  const shown = shownOptions(queue[0].options, s.orders[0]);
  const args = answerArgs(s, 3, 13_500);
  assert.deepEqual(args, { p_question: "a", p_choice: queue[0].options.indexOf(shown[3]), p_mode: "lecture", p_ms: 12_500, p_confidence: null }, "no bet given: p_confidence null");
  s = recordAnswer(s, args.p_choice, { ...fbFor("a"), correct: args.p_choice === 1 }, 14_000);
  assert.ok(answered(s));
  assert.equal(currentId(s), "a", "the feedback shows until next()");
  const fb = visibleFeedback(s, "a")!;
  assert.equal(shownOptions(queue[0].options, s.orders[0])[fb.answer], queue[0].options[1]);
  assert.throws(() => answerArgs(s, 0, 15_000), /no question/);
  s = next(s, 20_000);
  assert.equal(answerArgs(s, null, 20_000 + 7_200_000).p_ms, 3_600_000, "at most an hour");
});

test("מצב מבחן: every feedback is held until the end, then all of them show; each question timed by study_quiz__seconds", () => {
  let s = startSession({ key: `l.${L1}`, timed: true, queue, now: 0, setting: 30, random: seeded(11) });
  assert.equal(s.mode, "exam");
  const chars = (x: SessionQuestion) => x.vignette.length + x.question.length + x.options.reduce((n, t) => n + t.length, 0);
  assert.deepEqual(
    s.seconds,
    queue.map((x) => Math.min(240, Math.max(30, Math.ceil(chars(x) / 15) + 10))),
  );
  assert.ok(s.seconds[0] > 30, "a long case gets more time than the setting");
  assert.equal(examSeconds({ vignette: "", question: "x".repeat(10_000), options: [] }, 30), 240);
  s = recordAnswer(s, 1, fbFor("a"), 10);
  assert.equal(currentId(s), "b", "on to the next question at once");
  assert.equal(visibleFeedback(s, "a"), null, "held");
  s = timeUp(s, fbFor("b", 2), 20);
  assert.equal(visibleFeedback(s, "b"), null, "held");
  assert.deepEqual(s.results.map((r) => [r.id, r.choice, r.correct]), [
    ["a", 1, true],
    ["b", null, false],
  ]);
  s = recordAnswer(s, 0, fbFor("c", 4), 30);
  assert.ok(isOver(s));
  for (const id of ["a", "b", "c"]) {
    const fb = visibleFeedback(s, id)!;
    assert.ok(fb, id);
    assert.equal(fb.explanations.length, 5);
  }
  assert.deepEqual(score(s), { right: 1, of: 3 });
  assert.equal(next(s, 40), s, "nothing after the end");
});

test("storage: a reload resumes the same question with the same orders; no storage, no failure", () => {
  const store = new Map<string, string>();
  const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const g = globalThis as Record<string, unknown>;
  const key = sessionKey("u1", { s: `l.${L1}`, n: "20" });
  assert.equal(key, `study-session:u1:l.${L1}|20`);
  const s = recordAnswer(startSession({ key: `l.${L1}`, timed: false, queue, now: 0, random: seeded(12) }), 0, fbFor("a"), 5);
  // No storage at all (a private window, a browser that refuses): nothing throws.
  assert.equal(loadSession(key), null);
  saveSession(key, s);
  assert.deepEqual([...loadHidden("u1")], []);
  assert.deepEqual([...setHidden("u1", "a", true)], ["a"]);
  try {
    g.sessionStorage = fake;
    g.localStorage = fake;
    saveSession(key, s);
    assert.deepEqual(loadSession(key), s);
    store.set(key, "{not json");
    assert.equal(loadSession(key), null);
    store.set(key, JSON.stringify({ ...s, orders: [] }));
    assert.equal(loadSession(key), null, "a broken state is not resumed");
    setHidden("u1", "a", true);
    setHidden("u1", "b", true);
    setHidden("u1", "a", false);
    assert.deepEqual([...loadHidden("u1")], ["b"]);
    assert.deepEqual([...loadHidden("u2")], [], "per person");
  } finally {
    delete g.sessionStorage;
    delete g.localStorage;
  }
});

/* ── What the screens add (Q-1's screens: P2's start, P5's line, P7's count) ── */

test("P2's start request: the next session on its key starts fresh, timed or not, once", () => {
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  const r = { s: `l.${L1}`, n: "20" };
  // No storage: nothing kept, nothing thrown.
  requestStart("u1", r, true);
  assert.equal(takeStart("u1", r), null);
  try {
    g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    requestStart("u1", r, true);
    assert.ok([...store.keys()].every((k) => k.startsWith("study-session:u1:")), "kept beside the person's sessions, so sign-out forgets it (§5.9)");
    assert.deepEqual(takeStart("u1", r), { timed: true });
    assert.equal(takeStart("u1", r), null, "taken once: a reload resumes the saved session");
    requestStart("u1", r, false);
    assert.equal(takeStart("u1", { s: `l.${L1}`, n: "10" }), null, "another size is another session");
    assert.equal(store.size, 0, "a request for another session is dropped too");
    requestStart("u1", { s: `l.${L1}` }, false);
    assert.deepEqual(takeStart("u1", { s: `l.${L1}`, n: "10" }), { timed: false }, "no size is 10");
    // The screen peeks (its effect may run twice) and drops the request once its session is saved.
    requestStart("u1", r, true);
    assert.deepEqual(peekStart("u1", r), { timed: true });
    assert.deepEqual(peekStart("u1", r), { timed: true }, "still there for a second run");
    dropStart("u1");
    assert.equal(peekStart("u1", r), null);
  } finally {
    delete g.sessionStorage;
  }
});

test("review UX-2: a right answer after a mistake says 'tomorrow' on the same study day, 'cleared' on a later one", () => {
  // 15 Nov 2026, 10:00 in Israel (UTC+2), and the study day's edge at 04:00.
  const now = Date.parse("2026-11-15T08:00:00Z");
  assert.equal(mistakeNote({ wrongAt: "2026-11-15T07:00:00Z", wrongHere: false, now, day: studyDay }), "tomorrow");
  assert.equal(mistakeNote({ wrongAt: "2026-11-15T02:30:00Z", wrongHere: false, now, day: studyDay }), "tomorrow", "04:30 is today's study day");
  assert.equal(mistakeNote({ wrongAt: "2026-11-15T01:30:00Z", wrongHere: false, now, day: studyDay }), "cleared", "03:30 still belongs to yesterday");
  assert.equal(mistakeNote({ wrongAt: "2026-11-14T08:00:00Z", wrongHere: false, now, day: studyDay }), "cleared");
  assert.equal(mistakeNote({ wrongAt: null, wrongHere: true, now, day: studyDay }), "tomorrow", "wrong earlier on this screen");
  assert.equal(mistakeNote({ wrongAt: null, wrongHere: false, now, day: studyDay }), null, "no mistake, no line");
  assert.equal(mistakeNote({ wrongAt: "not a date", wrongHere: false, now, day: studyDay }), null);
});

test("P7's 'נשארו N שאלות שעוד לא תורגלו.': never answered, not in this round, not hidden, in the scope", () => {
  const qs = [q("a"), q("b"), q("c"), q("d", { lecture_id: L2 }), q("e", { topic: "Mockazole" })];
  const latest = new Map([["a", { correct: true, at: "2026-11-10T10:00:00Z", times: 1 }]]);
  assert.equal(unpracticed({ key: `l.${L1}`, questions: qs, latest, answered: ["b"] }), 2, "c and e: a was answered before, b now, d is another lecture's");
  assert.equal(unpracticed({ key: `l.${L1}`, questions: qs, latest, answered: ["b"], hidden: new Set(["c"]) }), 1);
  assert.equal(unpracticed({ key: "c.קורס", questions: qs, latest, answered: [] }), 4, "a course: the questions given");
  assert.equal(unpracticed({ key: "t.mockazole", questions: qs, latest, answered: [] }), 1, "a topic: only its own");
  assert.equal(unpracticed({ key: "m", questions: qs, latest, answered: [] }), 0, "mistakes have no 'not practised yet'");
  assert.equal(unpracticed({ key: "nonsense", questions: qs, latest, answered: [] }), 0);
});

test("generation (practiceGenerate.ts): the parts a phone writes, the latest round, a round's size and its estimate", async () => {
  // practiceGenerate imports the app's Supabase wrapper, which reads Vite's import.meta.env.
  const meta = import.meta as unknown as { env?: Record<string, string> };
  meta.env = meta.env ?? {};
  const G = await import("./practiceGenerate");
  const t = Date.parse("2026-11-15T10:00:00Z");
  const ago = (min: number) => new Date(t - min * 60_000).toISOString();
  const b = (part: number, o: Record<string, unknown>) =>
    ({ id: `b${part}`, lecture_id: L1, round: 2, part_idx: part, heading: "", slide_from: 1, slide_to: 3, wanted: 2, status: "pending", made: 0, rejected: 0, error: null, attempts: 0, created_at: ago(1), updated_at: ago(1), created_by: null, ...o }) as never;
  const batches = [
    b(5, { status: "ready", made: 2 }),
    b(3, { status: "writing", updated_at: ago(7) }),
    b(2, { status: "writing", updated_at: ago(2) }),
    b(1, { status: "failed", error: "timeout", attempts: 1 }),
    b(4, { status: "failed", error: "timeout", attempts: 3 }),
    b(0, {}),
    { ...(b(6, {}) as object), round: 1 } as never,
  ];
  assert.deepEqual(G.writableParts(batches, 2, t), ["b0", "b1", "b3"], "pending, failed (not given up), stale; in part order; this round only");
  assert.equal(G.isStuckBatch(b(0, { status: "writing", updated_at: ago(6.1) }), t), true);
  assert.equal(G.isStuckBatch(b(0, { status: "writing", updated_at: ago(5.9) }), t), false);
  assert.equal(G.isIdleBatch(b(0, { updated_at: ago(7) }), t), true);
  assert.equal(G.gaveUp(b(0, { status: "failed", error: "gave up" })), true);
  assert.equal(G.gaveUp(b(0, { status: "failed", attempts: 3 })), true);
  assert.equal(G.gaveUp(b(0, { status: "failed", attempts: 2 })), false);

  const latest = G.latestRound(batches);
  assert.deepEqual(
    { round: latest?.round, parts: latest?.parts.map((x) => x.part_idx), open: latest?.open, made: latest?.made, wanted: latest?.wanted, done: latest?.done },
    { round: 2, parts: [0, 1, 2, 3, 4, 5], open: true, made: 2, wanted: 12, done: false },
  );
  assert.equal(G.latestRound([]), null);
  assert.equal(G.latestRound([b(0, { status: "ready", made: 2 })])?.done, true);

  // study_question_round's target: one per 2.5 slides, 6 to 25 (the antiparasitics deck's 38 slides: 15).
  assert.deepEqual([5, 20, 38, 100].map(G.roundSize), [6, 8, 15, 25]);
  // P3's estimate: $0.019 a question, up to the next $0.05 (15 questions: $0.30).
  assert.deepEqual([0, 6, 8, 15, 25].map(G.estimateCents), [0, 15, 20, 30, 50]);
  assert.deepEqual([12.4, 33, 0.2, 0.3, 1.25].map(G.usd), ["$12.40", "$33", "$0.20", "$0.30", "$1.25"]);
  assert.equal(G.roundKey(L1), `questions:${L1}`);
});

/* ── practice 2.0 (proposal/practice-2, proposal/mockups/practice.html) ── */

test("the bet: sent as p_confidence with the choice, kept with the result, never with 'לא יודעים'", () => {
  const s = startSession({ key: `l.${L1}`, timed: false, queue: [q("a")], now: 1000, random: () => 0.99 });
  const args = answerArgs(s, 2, 4000, 2);
  assert.deepEqual(args, { p_question: "a", p_choice: s.orders[0][2], p_mode: "lecture", p_ms: 3000, p_confidence: 2 });
  assert.equal(answerArgs(s, null, 4000, 3).p_confidence, null, "'לא יודעים' has no bet");
  assert.equal(answerArgs(s, 1, 4000).p_confidence, null, "no bet given: null");
  const fb: Feedback = { answer: 0, explanations: ["", "", "", "", ""], takeaway: "", correct: false, whens: ["", "w1", "w2", "w3", "w4"] };
  const after = recordAnswer(s, args.p_choice, fb, 5000, 3);
  assert.deepEqual(after.results, [{ id: "a", choice: s.orders[0][2], correct: false, bet: 3 }]);
  assert.deepEqual(
    [1, 2, 3].map((b) => betLabel(b as 1 | 2 | 3)),
    ["ניחוש", "נראה לי", "על בטוח"],
  );
  assert.equal(betLabel(null), "");
});

test("'מתי כן' follows each option to its shown place, as the explanations do", () => {
  const order = [3, 0, 4, 1, 2];
  const fb: Feedback = { answer: 0, explanations: ["e0", "e1", "e2", "e3", "e4"], takeaway: "t", whens: ["", "w1", "w2", "w3", "w4"] };
  const shown = toShown(order, fb);
  assert.equal(shown.answer, 1);
  assert.deepEqual(shown.explanations, ["e3", "e0", "e4", "e1", "e2"]);
  assert.deepEqual(shown.whens, ["w3", "", "w4", "w1", "w2"]);
  assert.equal(toShown(order, { answer: 0, explanations: [], takeaway: "" }).whens, undefined, "a release-1 answer has no whens");
});

test("the autopsy's order: the wrong choice, then the key, then the rest as shown", () => {
  assert.deepEqual(autopsyOrder(5, 2, 4), [2, 4, 0, 1, 3], "wrong: the choice first, the key second");
  assert.deepEqual(autopsyOrder(5, 4, 4), [4, 0, 1, 2, 3], "right: the key (the choice) first");
  assert.deepEqual(autopsyOrder(5, null, 1), [1, 0, 2, 3, 4], "'לא יודעים': the key first");
  assert.deepEqual(autopsyOrder(5, undefined, 0), [0, 1, 2, 3, 4]);
  assert.deepEqual(autopsyOrder(4, 9, 3), [3, 0, 1, 2], "a choice out of range is ignored");
});

test("סבב חדש's pick: from where (new, wrong, flagged, all), parts and styles, before the tiers", () => {
  const me = "u1";
  const qs = [
    q("n1", { part_idx: 0, style: "case" }),
    q("n2", { part_idx: 1, style: null, kind: "case" }),
    q("w1", { part_idx: 0, style: "mechanism" }),
    q("r1", { part_idx: 1, style: null, kind: "mcq", study_question_flags: [{ user_id: me }] }),
    q("r2", { part_idx: 2, style: "compare", study_question_flags: [{ user_id: "u2" }] }),
  ];
  const lt = latest([
    ["w1", false, "2026-11-10T10:00:00Z"],
    ["r1", true, "2026-11-09T10:00:00Z"],
    ["r2", true, "2026-11-08T10:00:00Z"],
  ]);
  const mistakes = [{ question_id: "w1", wrong_at: "2026-11-10T10:00:00Z" }];
  const ids = (pick: Parameters<typeof inPick>[1]) =>
    pickQueue({ key: `l.${L1}`, questions: qs, latest: lt, mistakes, size: "all", random: () => 0.5, pick, me }).sort();
  assert.deepEqual(ids({ sources: ["new"] }), ["n1", "n2"]);
  assert.deepEqual(ids({ sources: ["wrong"] }), ["w1"], "טעיתי: the open mistakes");
  assert.deepEqual(ids({ sources: ["flagged"] }), ["r1"], "סימנתי: the caller's own flags only");
  assert.deepEqual(ids({ sources: ["new", "wrong"] }), ["n1", "n2", "w1"]);
  assert.deepEqual(ids({ sources: ["all"] }), ["n1", "n2", "r1", "r2", "w1"]);
  assert.deepEqual(ids({ sources: ["all"], parts: [1] }), ["n2", "r1"]);
  assert.deepEqual(ids({ sources: ["all"], styles: ["case"] }), ["n1", "n2"], "a release-1 case counts as 'case'");
  assert.deepEqual(ids({ sources: ["all"], styles: ["other"] }), ["r1"], "a release-1 question that is not a case is 'other'");
  assert.deepEqual(ids({ sources: ["new"], parts: [0], styles: ["case"] }), ["n1"]);
  assert.equal(styleOf({ style: "compare", kind: "case" }), "compare");
  assert.equal(
    pickQueue({ key: `l.${L1}`, questions: qs, latest: lt, mistakes, size: 1, random: () => 0.5, pick: { sources: ["new"] }, me }).length,
    1,
    "then the size",
  );
});

test("סבב חדש's start request carries its pick, and the session keeps it for 'סבב נוסף'", () => {
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  const r = { s: `l.${L1}`, n: "5" };
  try {
    g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const pick = { sources: ["new", "wrong"] as Array<"new" | "wrong">, parts: [2, 3], styles: ["case"] };
    requestStart("u1", r, true, pick);
    assert.deepEqual(peekStart("u1", r), { timed: true, pick });
    store.set("study-session:u1:start", JSON.stringify({ s: r.s, n: r.n, timed: false, pick: { sources: ["everything"] } }));
    assert.deepEqual(peekStart("u1", r), { timed: false }, "a pick that is not one is dropped");
    const s = startSession({ key: r.s, timed: false, queue: [q("a")], now: 1, pick });
    saveSession("k", s);
    assert.deepEqual(loadSession("k")?.pick, pick);
    assert.equal(startSession({ key: r.s, timed: false, queue: [q("a")], now: 1 }).pick, undefined);
  } finally {
    delete g.sessionStorage;
  }
});

test("practice 2.0 on the phone (practice2.ts): the options a request sends, the batches a phone may write", async () => {
  const meta = import.meta as unknown as { env?: Record<string, string> };
  meta.env = meta.env ?? {};
  const P2 = await import("./practice2");
  const c = { ...P2.DEFAULT_CHOICES };
  assert.deepEqual(P2.optionsOf(c), { level: "full", styles: ["case", "mechanism", "drug_choice", "adverse_contra"], difficulty: "exam", focus: "" }, "מלא by default (decision 1), every part");
  const style = { description: "ככה", example: "דוגמה", sig: "a".repeat(64) };
  assert.deepEqual(
    P2.optionsOf({ ...c, level: "custom", count: 55, parts: [3, 1], focus: "  מלריה  ", style }),
    { level: "custom", count: 40, parts: [1, 3], styles: ["case", "mechanism", "drug_choice", "adverse_contra"], difficulty: "exam", focus: "מלריה", style },
    "משלי at most 40; parts in order; the focus trimmed; the read example as the server signed it",
  );
  assert.deepEqual(P2.optionsOf({ ...c, focus: "x", style }, { withExample: false }), { level: "full", styles: ["case", "mechanism", "drug_choice", "adverse_contra"], difficulty: "exam", focus: "" }, "the plan never sends the example or the focus");
  assert.equal(P2.optionsOf({ ...c, level: "focused", count: 7 }).count, undefined, "a count only for משלי");
  const t = Date.parse("2026-11-16T10:00:00Z");
  const ago = (m: number) => new Date(t - m * 60_000).toISOString();
  const b = (o: Record<string, unknown>) => ({ status: "pending", error: null, attempts: 0, updated_at: ago(1), ...o }) as never;
  assert.equal(P2.writable(b({}), t), true);
  assert.equal(P2.writable(b({ status: "failed", error: "timeout", attempts: 1 }), t), true);
  assert.equal(P2.writable(b({ status: "failed", error: "gave up" }), t), false);
  assert.equal(P2.writable(b({ status: "failed", attempts: 3 }), t), false);
  assert.equal(P2.writable(b({ status: "writing", updated_at: ago(7) }), t), true, "stuck");
  assert.equal(P2.writable(b({ status: "writing", updated_at: ago(2) }), t), false);
  assert.equal(P2.writable(b({ status: "ready" }), t), false);
  assert.equal(P2.writingSomewhere([b({ status: "writing", updated_at: ago(2) })], t), true);
  assert.equal(P2.writingSomewhere([b({ status: "writing", updated_at: ago(7) }), b({})], t), false);
  assert.deepEqual([0.6, 0.45, 1, 12.4].map(P2.usd), ["$0.60", "$0.45", "$1", "$12.40"]);
  assert.equal(P2.requestKey("r1"), "request:r1");
});

// ── Practice sets (docs/study/sets.md, slice B): s=k.<set> ──
const SET = "88888888-0000-4000-8000-000000000001";
test("k.<set>: a practice set's scope, recorded as a lecture's, its questions in the set's order", () => {
  assert.deepEqual(parseScope(`k.${SET}`), { kind: "set", set: SET });
  assert.equal(parseScope("k.nope"), null, "a set's id is an id");
  assert.deepEqual(parseScope(`r.${L1}`), { kind: "again", group: L1 }, "r. stays another wording");
  assert.equal(parseScope(`d.${L1}`), null, "d. is the exams design's, untouched here");
  assert.equal(modeOf({ kind: "set", set: SET }), "lecture");
  assert.equal(modeOf({ kind: "set", set: SET }, true), "exam", "מצב מבחן");
  // The order given (the set's), every one whatever the size, the hidden left out, a series kept as stored.
  const qs = [q("c", { part_idx: 3 }), q("a", { part_idx: 0 }), q("b", { part_idx: 1, study_question_flags: flag }), q("d")];
  const got = pickQueue({ key: `k.${SET}`, questions: qs, latest: latest([["a", true, "2026-11-02T10:00:00Z"]]), hidden: new Set(["d"]), size: 2, random: seeded(1) });
  assert.deepEqual(got, ["c", "a", "b"], "the set's order: no tiers, no size, flagged ones stay in place");
  assert.equal(unpracticed({ key: `k.${SET}`, questions: qs, latest: new Map(), answered: [] }), 0, "a set has no 'נשארו'");
});

test("a set's attempt rides with its session, and questions ready later join its end once", () => {
  const s0 = startSession({ key: `k.${SET}`, timed: false, queue: [q("a"), q("b")], now: 1000, random: seeded(2), attempt: "att-1" });
  assert.equal(s0.attempt, "att-1");
  assert.equal(s0.mode, "lecture");
  assert.equal(startSession({ key: `l.${L1}`, timed: false, queue: [q("a")], now: 1 }).attempt, undefined, "only a set's session has one");
  const s1 = appendQueue(s0, [q("b"), q("c"), q("c")], { now: 2000, random: seeded(3) });
  assert.deepEqual(s1.ids, ["a", "b", "c"], "b is already in it; c once");
  assert.equal(s1.orders.length, 3);
  assert.equal(s1.seconds.length, 3);
  assert.equal(s1.shownAt, 1000, "the question on screen keeps its time");
  assert.equal(appendQueue(s1, [q("a")], { now: 3000 }), s1, "nothing new: the same state");
  // A round that was over goes on with the new questions, timed ones with their clocks.
  let t = startSession({ key: `k.${SET}`, timed: true, queue: [q("a")], now: 0, random: seeded(4), attempt: "att-2" });
  t = recordAnswer(t, 0, { answer: 0, explanations: [], takeaway: "", correct: true }, 10);
  assert.ok(isOver(t));
  const t2 = appendQueue(t, [q("z")], { now: 50 });
  assert.equal(isOver(t2), false);
  assert.equal(currentId(t2), "z");
  assert.equal(t2.shownAt, 50);
  assert.ok(t2.seconds[1] >= 60, "a clock in מצב מבחן");
  assert.equal(t2.attempt, "att-2");
});

test("an uploaded item keeps its printed order after the answer (uploaded sheets, D10), with the flag only", () => {
  assert.equal(keepPrinted({ source: "exam" }, true), true);
  assert.equal(keepPrinted({ source: "exam" }, false), false, "without VITE_STUDY_SHEETS: the autopsy order, as before");
  assert.equal(keepPrinted({ source: "ai" }, true), false, "a lecture's question: the chosen and the right option first");
  assert.equal(keepPrinted({ source: "member" }, true), false);
  assert.deepEqual(printedOrder(5), [0, 1, 2, 3, 4]);
  assert.deepEqual(printedOrder(0), []);
});
