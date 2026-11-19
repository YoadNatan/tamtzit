import assert from "node:assert/strict";
import { test } from "node:test";
import { qColumns, visibleQuestions } from "./questionColumns";
import { examSeconds, keepSeries, loadSession, orderFor, pickQueue, recordAnswer, setArgs, startSession, toShown, type SessionQuestion } from "./practiceSession";
import { verdictOf } from "../components/PracticeQuestion";

/* Question types in a practice session (docs/study/question-types.md): a
 * staged case kept together and in step order, never started at step 2 in a
 * lecture's session; a set question's arguments and shown order; the clock;
 * a saved session from before (v 1) still loading; the verdict's "3 מתוך 4";
 * a build without the flag asking none of them. */

const L = "aaaaaaaa-0000-4000-8000-000000000001";
const q = (id: string, extra: Partial<SessionQuestion> = {}): SessionQuestion => ({
  id,
  lecture_id: L,
  ref_lecture: null,
  exam_no: null,
  part_idx: 0,
  created_at: `2026-11-0${id.length % 9}T00:00:00Z`,
  topic: "Nephron",
  vignette: "",
  question: `${id}?`,
  options: ["a", "b", "c"],
  ...extra,
});

test("keepSeries: the steps of a case together, in step order, where the case first comes", () => {
  const items = [q("x"), q("s2", { series: "S", step: 2 }), q("y"), q("s1", { series: "S", step: 1 })];
  assert.deepEqual(
    keepSeries(items, true).map((x) => x.id),
    ["x", "s1", "s2", "y"],
  );
  // A lecture's session never starts a case at its step 2.
  assert.deepEqual(
    keepSeries([q("x"), q("s2", { series: "S", step: 2 })], true).map((x) => x.id),
    ["x"],
  );
  // Mistakes and courses may ask one step alone (each row stands alone).
  assert.deepEqual(
    keepSeries([q("s2", { series: "S", step: 2 })], false).map((x) => x.id),
    ["s2"],
  );
});

test("pickQueue: a lecture's session asks a staged case's steps one after the other", () => {
  const questions = [q("p1"), q("c2", { series: "S", step: 2 }), q("c1", { series: "S", step: 1 }), q("p2")];
  const ids = pickQueue({ key: `l.${L}`, questions, latest: new Map(), size: "all", random: () => 0.5 });
  const at = ids.indexOf("c1");
  assert.ok(at >= 0 && ids[at + 1] === "c2", ids.join(","));
});

test("a set question is shuffled for each showing (review QT-11); its answer goes back in stored order; feedback maps through", () => {
  // A fixed "random" that reverses three items (Fisher-Yates from the end, always the first slot).
  const first = () => 0;
  for (const form of ["tf", "match", "order"]) assert.deepEqual(orderFor({ options: ["x", "y", "z"], form }, first), [1, 2, 0], form);
  assert.deepEqual(orderFor({ options: ["1", "2", "3"], form: "tap" }, first), [0, 1, 2], "a tap item's pins keep their numbers");
  const seen = new Set<string>();
  for (let k = 0; k < 40; k++) seen.add(orderFor({ options: ["a", "b", "c", "d"], form: "order" }).join(""));
  assert.ok(seen.size > 1, "a new order on another showing");
  // A shuffled showing: the shown choices go back to the stored order, and the feedback comes back shown.
  const order = [2, 0, 1];
  assert.deepEqual(toShown(order, { answer: -1, seq: [1, 1, 0], explanations: ["a", "b", "c"], takeaway: "" }, "tf").seq, [0, 1, 1]);
  assert.deepEqual(toShown(order, { answer: -1, seq: [1, 1, 0], explanations: ["a", "b", "c"], takeaway: "" }, "tf").explanations, ["c", "a", "b"]);
  assert.deepEqual(toShown(order, { answer: -1, seq: [2, 0, 1], explanations: ["a", "b", "c"], takeaway: "" }, "order").seq, [0, 1, 2], "the stored right order, as shown places");
  const s = startSession({ key: `l.${L}`, timed: false, queue: [{ id: "t", vignette: "", question: "?", options: ["s1", "s2", "s3"], form: "tf" }], now: 0, random: () => 0.999 });
  assert.equal(s.v, 2);
  const args = setArgs(s, "tf", [1, 0, 1], 2500, 2);
  assert.deepEqual(args, { p_question: "t", p_choices: [1, 0, 1], p_mode: "lecture", p_ms: 2500, p_confidence: 2 });
  assert.deepEqual(setArgs(s, "tf", null, 10, 3).p_confidence, null, "לא יודעים carries no bet");
  const fb = { answer: -1, seq: [1, 1, 0], explanations: ["a", "b", "c"], takeaway: "", correct: false, right: 1, total: 3, choices: [1, 0, 1] };
  const after = recordAnswer(s, [1, 0, 1], fb, 3000, 2);
  assert.deepEqual(after.results[0], { id: "t", choice: [1, 0, 1], correct: false, bet: 2 });
  assert.deepEqual(toShown([0, 1, 2], fb, "tf").seq, [1, 1, 0]);
});

test("examSeconds: 4 s more per element of a set, 12 s more for a picture", () => {
  const base = { vignette: "", question: "x".repeat(150), options: ["a", "b", "c"] };
  const plain = examSeconds(base, 10);
  assert.equal(examSeconds({ ...base, form: "order" }, 10), plain + 12);
  assert.equal(examSeconds({ ...base, figure: "fig:3-1" }, 10), plain + 12);
  assert.equal(examSeconds({ ...base, form: "tap", layout: { kind: "label" } }, 10), plain + 12);
});

test("a session saved before the question types (v 1) still loads", () => {
  const g = globalThis as Record<string, unknown>;
  const store = new Map<string, string>();
  g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    const old = { v: 1, key: `l.${L}`, mode: "lecture", timed: false, ids: ["a"], orders: [[1, 0]], seconds: [0], i: 0, shownAt: 0, results: [], feedback: {} };
    store.set("k", JSON.stringify(old));
    assert.equal(loadSession("k")?.v, 1);
    store.set("k", JSON.stringify({ ...old, v: 3 }));
    assert.equal(loadSession("k"), null, "an unknown version is dropped");
  } finally {
    delete g.sessionStorage;
  }
});

test("the verdict of a set question says how much was right", () => {
  const fb = { answer: -1, explanations: [], takeaway: "", correct: false, right: 2, total: 3 };
  assert.equal(verdictOf([1, 0, 0], fb, 2).text, "✗ טעות · 2 מתוך 3 · ׳נראה לי׳");
  assert.equal(verdictOf([1, 0, 1], { ...fb, correct: true, right: 3 }, 3).text, "✓ נכון · ׳על בטוח׳");
  assert.equal(verdictOf(null, fb, null).text, "בלי תשובה");
});

test("without the flag: the types' columns are not read and their questions never asked", () => {
  assert.ok(!qColumns({ qtypes: false }).includes("layout"));
  assert.ok(qColumns({ qtypes: true }).includes("form, layout, series, step"));
  assert.ok(qColumns({ qtypes: false }).includes("figure"), "figure is Q 2's column");
  const rows = [{ style: "case" }, { style: "tf" }, { style: null }, { style: "label" }];
  assert.deepEqual(visibleQuestions(rows, { qtypes: false }), [{ style: "case" }, { style: null }]);
  assert.equal(visibleQuestions(rows, { qtypes: true }).length, 4);
});
