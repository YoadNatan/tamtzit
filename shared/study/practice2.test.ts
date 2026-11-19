import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchSizes,
  CUSTOM_PER_POINT,
  coverage,
  DEFAULT_STYLES,
  EXPECTED_USD,
  keepable,
  levelCounts,
  partQuestions,
  planRequest,
  type PlanPoint,
  pointsUsd,
  questionsPerPart,
  readOptions,
  REQUEST_MAX,
  requestUsd,
  type SessionCount,
  solverUsd,
  sessionCount,
  shareOut,
  sourceCounts,
  STYLES,
} from "./practice2.js";

/* Practice 2.0's shared numbers (docs/study/proposal/practice-2/DECISIONS.md;
 * docs/study/practice-2-api.md): the count by level from the points to know,
 * the batches and the points and styles of each, the options a request may
 * carry, the estimates, the coverage bars and the session builder's counts.
 * The example is the approved screens': 46 points in four parts, אמבות 6,
 * לישמניה 9, מלריה 22, תולעים 9, which give ממוקד 12, מלא 24 and מקיף 40. */

/** n points in a part, the first `red` of them red flags, weights 3, 2, 1 in turn. */
function part(idx: number, n: number, red = 0): PlanPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${idx}-${i + 1}`,
    part_idx: idx,
    n: i + 1,
    kind: (["drug", "mechanism", "indication", "adverse", "contra", "number"] as const)[i % 6],
    red_flag: i < red,
    weight: ([3, 2, 1] as const)[i % 3],
  }));
}
/** The example lecture: אמבות 6 (1 red flag), לישמניה 9 (1), מלריה 22 (4), תולעים 9 (1). */
const EXAMPLE: PlanPoint[] = [...part(0, 6, 1), ...part(1, 9, 1), ...part(2, 22, 4), ...part(3, 9, 1)];

test("levels: the example's 46 points give ממוקד 12, מלא 24, מקיף 40 (DECISIONS.md, the setup screen)", () => {
  assert.equal(EXAMPLE.length, 46);
  assert.deepEqual(levelCounts(EXAMPLE), { focused: 12, full: 24, deep: 40 });
  // Per part: ממוקד about 1 per 4 (half up), מלא about 1 per 2, מקיף 1 per point within the request's 40.
  const counts = [
    { part_idx: 0, points: 6, red_flags: 1 },
    { part_idx: 1, points: 9, red_flags: 1 },
    { part_idx: 2, points: 22, red_flags: 4 },
    { part_idx: 3, points: 9, red_flags: 1 },
  ];
  assert.deepEqual(questionsPerPart("focused", counts), [2, 2, 6, 2]);
  assert.deepEqual(questionsPerPart("full", counts), [3, 5, 11, 5]);
  assert.deepEqual(questionsPerPart("deep", counts), [5, 8, 19, 8], "46 over the cap of 40: by the largest remainder");
  // The parts chosen: only מלריה.
  assert.deepEqual(levelCounts(EXAMPLE, [2]), { focused: 6, full: 11, deep: 22 });
});

test("levels: red flags are always in for ממוקד; a part with no points writes nothing", () => {
  assert.equal(partQuestions("focused", 8, 0), 2);
  assert.equal(partQuestions("focused", 8, 5), 5, "every red flag gets a question");
  assert.equal(partQuestions("focused", 3, 9), 3, "never more than the points");
  assert.equal(partQuestions("focused", 1, 0), 0, "one detail is not the most important material");
  assert.equal(partQuestions("full", 1, 0), 1, "every point at least once");
  assert.equal(partQuestions("deep", 7, 0), 7);
  for (const l of ["focused", "full", "deep"] as const) assert.equal(partQuestions(l, 0, 0), 0);
});

test("levels: משלי shares the member's number by points, at most 2 a point and 40 in all", () => {
  const counts = [
    { part_idx: 0, points: 6, red_flags: 0 },
    { part_idx: 1, points: 2, red_flags: 0 },
  ];
  assert.deepEqual(questionsPerPart("custom", counts, 8), [6, 2]);
  assert.deepEqual(questionsPerPart("custom", counts, 1), [1, 0]);
  assert.deepEqual(questionsPerPart("custom", counts, 2), [1, 1], "each part at least one when there are enough");
  assert.equal(
    questionsPerPart("custom", counts, 40).reduce((a, b) => a + b, 0),
    8 * CUSTOM_PER_POINT,
    "at most two a point",
  );
  assert.deepEqual(questionsPerPart("custom", [{ part_idx: 0, points: 46, red_flags: 0 }], 99), [REQUEST_MAX]);
});

test("shareOut: the largest remainder, ties to the earlier, caps kept, at least one each", () => {
  assert.deepEqual(shareOut(40, [6, 9, 22, 9], [6, 9, 22, 9]), [5, 8, 19, 8]);
  assert.deepEqual(shareOut(3, [1, 1, 1, 1]), [1, 1, 1, 0], "not enough for everyone: the earlier first");
  assert.deepEqual(shareOut(10, [5, 5], [3, 9]), [3, 7], "a cap passes the rest on");
  assert.deepEqual(shareOut(0, [1, 2]), [0, 0]);
  assert.deepEqual(shareOut(5, [0, 0]), [0, 0]);
  for (let total = 0; total <= 60; total++) {
    const w = [1, 7, 3, 22, 0, 9];
    const out = shareOut(total, w, w.map((x) => x * 2));
    assert.equal(
      out.reduce((a, b) => a + b, 0),
      Math.min(total, 84),
      `total ${total}`,
    );
    assert.equal(out[4], 0, "a part with no weight gets nothing");
  }
});

test("plan: batches of at most 5, as even as possible, larger first", () => {
  assert.deepEqual(batchSizes(11), [4, 4, 3]);
  assert.deepEqual(batchSizes(5), [5]);
  assert.deepEqual(batchSizes(6), [3, 3]);
  assert.deepEqual(batchSizes(19), [5, 5, 5, 4]);
  assert.deepEqual(batchSizes(0), []);
});

test("plan: מלא covers every point once, neighbouring paragraphs together, and the styles in turn", () => {
  const plan = planRequest({ points: EXAMPLE, level: "full", parts: [0, 1, 2, 3], styles: [...DEFAULT_STYLES] });
  assert.equal(plan.total, 24);
  assert.deepEqual(
    plan.batches.map((b) => [b.part_idx, b.seq, b.wanted]),
    [
      [0, 0, 3],
      [1, 0, 5],
      [2, 0, 4],
      [2, 1, 4],
      [2, 2, 3],
      [3, 0, 5],
    ],
  );
  // Every point of every part, each in exactly one batch, in the paragraphs' order.
  const covered = plan.batches.flatMap((b) => b.points);
  assert.equal(new Set(covered).size, 46);
  assert.deepEqual(
    plan.batches.filter((b) => b.part_idx === 2).map((b) => b.points.length),
    [8, 8, 6],
    "מלריה's 22 points split as its batches",
  );
  assert.deepEqual(plan.batches[2].points.slice(0, 2), ["p2-1", "p2-2"]);
  // The styles in turn across the request: 6 of each of the four.
  const styles = plan.batches.flatMap((b) => b.styles);
  assert.equal(styles.length, 24);
  for (const s of DEFAULT_STYLES) assert.equal(styles.filter((x) => x === s).length, 6, s);
  assert.deepEqual(plan.batches[0].styles, ["case", "mechanism", "drug_choice"]);
  assert.deepEqual(plan.batches[1].styles, ["adverse_contra", "case", "mechanism", "drug_choice", "adverse_contra"]);
  assert.deepEqual(
    plan.parts.map((p) => [p.part_idx, p.questions, p.covers]),
    [
      [0, 3, 6],
      [1, 5, 9],
      [2, 11, 22],
      [3, 5, 9],
    ],
  );
});

test("plan: ממוקד takes the red flags first, then the weightiest, one point a question", () => {
  const plan = planRequest({ points: EXAMPLE, level: "focused", parts: [0, 1, 2, 3], styles: ["case"] });
  assert.equal(plan.total, 12);
  const malaria = plan.batches.filter((b) => b.part_idx === 2).flatMap((b) => b.points);
  assert.equal(malaria.length, 6);
  for (const red of ["p2-1", "p2-2", "p2-3", "p2-4"]) assert.ok(malaria.includes(red), `${red} (a red flag) is in`);
  // Then weight 3 (n = 7, 10, …), in the paragraphs' order within the batch.
  assert.deepEqual(malaria, ["p2-1", "p2-2", "p2-3", "p2-4", "p2-7", "p2-10"]);
  // A part whose red flags outnumber its quarter: one question a red flag.
  const many = planRequest({ points: part(0, 8, 5), level: "focused", parts: [0], styles: ["case"] });
  assert.equal(many.total, 5);
  assert.deepEqual(many.batches[0].points, ["p0-1", "p0-2", "p0-3", "p0-4", "p0-5"]);
});

test("plan: מקיף covers every point within 40 questions; משלי the weightiest two a question", () => {
  const deep = planRequest({ points: EXAMPLE, level: "deep", parts: [0, 1, 2, 3], styles: ["case", "mechanism"] });
  assert.equal(deep.total, 40);
  assert.equal(new Set(deep.batches.flatMap((b) => b.points)).size, 46, "every point, a few questions taking two");
  const custom = planRequest({ points: EXAMPLE, level: "custom", count: 4, parts: [2], styles: ["case"] });
  assert.equal(custom.total, 4);
  assert.equal(custom.batches[0].points.length, 8, "two points a question");
  for (const red of ["p2-1", "p2-2", "p2-3", "p2-4"]) assert.ok(custom.batches[0].points.includes(red));
});

test("plan: a blank table only where the slides have a table; alone, a part without one gets nothing", () => {
  const styles = ["blank_table", "case"] as const;
  const plan = planRequest({ points: EXAMPLE, level: "full", parts: [0, 1], styles: [...styles], tableParts: new Set([1]) });
  assert.ok(
    plan.batches.filter((b) => b.part_idx === 0).every((b) => !b.styles.includes("blank_table")),
    "אמבות has no table",
  );
  assert.ok(plan.batches.filter((b) => b.part_idx === 1).some((b) => b.styles.includes("blank_table")));
  const only = planRequest({ points: EXAMPLE, level: "full", parts: [0, 1], styles: ["blank_table"], tableParts: new Set([1]) });
  assert.deepEqual(
    only.batches.map((b) => b.part_idx),
    [1],
  );
  assert.ok(only.batches.every((b) => b.styles.every((s) => s === "blank_table")));
  // Without the table list (the server always sends it) nothing is held back.
  assert.ok(planRequest({ points: EXAMPLE, level: "full", parts: [0], styles: ["blank_table"] }).total > 0);
});

test("options: the defaults are מלא, the four checked styles, כמו במבחן, every part", () => {
  const r = readOptions({});
  assert.ok(r.ok);
  assert.deepEqual(r.options, { level: "full", styles: ["case", "mechanism", "drug_choice", "adverse_contra"], difficulty: "exam", focus: "" });
  const full = readOptions({
    level: "custom",
    count: 17,
    parts: [3, 1, 3],
    styles: ["not_true", "case"],
    difficulty: "hard",
    focus: "  מלריה  בהריון ",
    style: { description: "מקרה קצר", example: "שאלה?", sig: "a".repeat(64) },
  });
  assert.ok(full.ok);
  assert.deepEqual(full.options, {
    level: "custom",
    count: 17,
    parts: [1, 3],
    styles: ["case", "not_true"],
    difficulty: "hard",
    focus: "מלריה בהריון",
    style: { description: "מקרה קצר", example: "שאלה?", sig: "a".repeat(64) },
  });
});

test("options: each refusal has its code", () => {
  const code = (o: unknown) => {
    const r = readOptions(o);
    return r.ok ? "ok" : r.code;
  };
  assert.equal(code({ level: "everything" }), "bad level");
  assert.equal(code({ level: "custom" }), "count out of range", "משלי needs its number");
  assert.equal(code({ level: "custom", count: 0 }), "count out of range");
  assert.equal(code({ level: "custom", count: 41 }), "count out of range");
  assert.equal(code({ level: "custom", count: 2.5 }), "count out of range");
  assert.equal(code({ level: "full", count: 99 }), "ok", "a count is read only for משלי");
  assert.equal(code({ parts: [] }), "bad parts");
  assert.equal(code({ parts: [-1] }), "bad parts");
  assert.equal(code({ parts: ["1"] }), "bad parts");
  assert.equal(code({ styles: [] }), "bad styles");
  assert.equal(code({ styles: ["essay"] }), "bad styles");
  assert.equal(code({ difficulty: "medium" }), "bad difficulty");
  assert.equal(code({ focus: "א".repeat(201) }), "focus too long");
  assert.equal(code({ focus: "א".repeat(200) }), "ok");
  assert.equal(code({ focus: 7 }), "bad request");
  assert.equal(code({ style: { description: "x" } }), "bad style");
  assert.equal(code({ style: { description: "x".repeat(401), example: "", sig: "" } }), "bad style");
  assert.equal(code(null), "ok");
  assert.equal(code([]), "ok", "not an object: the defaults");
});

test("estimates: $0.025 a question, as DECISIONS.md's table (12 ≈ $0.30, 24 ≈ $0.60, 40 ≈ $1.00)", () => {
  assert.equal(EXPECTED_USD.question, 0.025);
  assert.equal(solverUsd(24), 0.12, "the blind solver's part of מלא, already in its $0.60");
  const { focused, full, deep } = levelCounts(EXAMPLE);
  assert.deepEqual([requestUsd(focused), requestUsd(full), requestUsd(deep)], [0.3, 0.6, 1]);
  assert.equal(requestUsd(0), 0);
  assert.equal(requestUsd(7), 0.18, "rounded up to the cent");
  // Reading the points: about $0.14 for an 18,000-character summary, once per lecture for the group.
  assert.equal(pointsUsd(18_000), 0.14);
  assert.equal(pointsUsd(0), 0.04);
  assert.ok(pointsUsd(40_000) > pointsUsd(18_000));
  // One call per part: each part after the first adds the prompt and some thinking.
  assert.equal(pointsUsd(18_000, 1), pointsUsd(18_000));
  assert.equal(pointsUsd(18_000, 5), 0.24);
  assert.ok(pointsUsd(18_000, 8) > pointsUsd(18_000, 5));
});

test("coverage: the request's points per part, covered by drafts waiting or kept, not by removed or failed ones", () => {
  const points = [...part(0, 3), ...part(1, 2)];
  const drafts = [
    { part_idx: 0, points: ["p0-1", "p0-2"], status: "pending" as const, check_state: "ok" as const },
    { part_idx: 0, points: ["p0-2"], status: "kept" as const, check_state: "ok" as const },
    { part_idx: 0, points: ["p0-3"], status: "removed" as const, check_state: "ok" as const },
    { part_idx: 1, points: ["p1-1"], status: "pending" as const, check_state: "failed" as const },
    { part_idx: 1, points: ["p1-2", "p0-3"], status: "pending" as const, check_state: "checking" as const },
  ];
  assert.deepEqual(coverage(points, drafts), [
    { part_idx: 0, points: 3, covered: 2 },
    { part_idx: 1, points: 2, covered: 1 },
  ]);
  assert.ok(keepable({ status: "pending", check_state: "ok" }));
  assert.ok(keepable({ status: "pending", check_state: "unchecked" }));
  assert.ok(!keepable({ status: "pending", check_state: "failed" }));
  assert.ok(!keepable({ status: "pending", check_state: "checking" }));
  assert.ok(!keepable({ status: "kept", check_state: "ok" }));
});

test("סבב חדש: the union of the chosen sources, within the parts and styles chosen", () => {
  const L = "lec";
  const rows: SessionCount[] = [
    { lecture_id: L, part_idx: 2, style: "case", state: "new", flagged: false, n: 5 },
    { lecture_id: L, part_idx: 2, style: "mechanism", state: "new", flagged: false, n: 4 },
    { lecture_id: L, part_idx: 2, style: "case", state: "wrong", flagged: true, n: 1 },
    { lecture_id: L, part_idx: 2, style: "other", state: "wrong", flagged: false, n: 3 },
    { lecture_id: L, part_idx: 0, style: "case", state: "right", flagged: true, n: 1 },
    { lecture_id: L, part_idx: 0, style: "case", state: "new", flagged: false, n: 10 },
  ];
  // The mock's numbers: מלריה chosen, לא נענו 9 and טעיתי 4: "13 · הכול".
  assert.deepEqual(sourceCounts(rows, { parts: [2] }), { new: 9, wrong: 4, flagged: 1, all: 13 });
  assert.equal(sessionCount(rows, { sources: ["new", "wrong"], parts: [2] }), 13);
  assert.equal(sessionCount(rows, { sources: ["wrong", "flagged"] }), 5, "a flagged mistake counts once");
  assert.equal(sessionCount(rows, { sources: ["flagged"] }), 2);
  assert.equal(sessionCount(rows, { sources: ["all"], styles: ["case"] }), 17);
  assert.equal(sessionCount(rows, { sources: ["new"], parts: [2], styles: ["case"] }), 5, "רק מקרים קליניים");
  assert.equal(sessionCount(rows, { sources: [] }), 0);
  assert.equal(sessionCount(rows, { sources: ["all"], lectures: ["other"] }), 0);
  assert.equal(STYLES.length, 13);
});
