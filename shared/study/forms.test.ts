import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addFacts,
  canStyle,
  defaultStylesFor,
  emptyFacts,
  formsOf,
  isSetForm,
  NEW_STYLES,
  scoreSet,
  STYLE_WEIGHT,
  styleWeight,
  toShownSet,
  toStoredSet,
  TYPE_GROUPS,
  validChoices,
  weightOf,
} from "./forms.js";
import { isFigureGeo, isLabelText, normLabel } from "./figureGeo.js";
import { planRequest, plannedStyles, requestUsd, solverUsd, STYLE_HE, STYLES, type PlanPoint } from "./practice2.js";

/* Question types (docs/study/question-types.md): the forms, how a set answer
 * scores, the shown↔stored maps, which types a part can have and the
 * defaults, the weights of the estimate. */

test("scoreSet: all or nothing; the partial count is only shown", () => {
  assert.deepEqual(scoreSet("tf", [1, 0, 1], [1, 0, 1]), { right: 3, total: 3, correct: true });
  assert.deepEqual(scoreSet("tf", [1, 0, 1, 0], [1, 1, 1, 0]), { right: 3, total: 4, correct: false });
  assert.deepEqual(scoreSet("match", [2, 0, 1], [0, 2, 1]), { right: 1, total: 3, correct: false });
  assert.deepEqual(scoreSet("order", [3, 1, 0, 2], [3, 1, 0, 2]), { right: 4, total: 4, correct: true });
  assert.deepEqual(scoreSet("order", [1, 0, 2], null), { right: 0, total: 3, correct: false }, "לא יודעים");
  assert.deepEqual(scoreSet("tf", [1, 0, 1], [1, 0]), { right: 0, total: 3, correct: false }, "the wrong length is never right");
});

test("validChoices: the SQL's 'bad choices' rule", () => {
  assert.ok(validChoices("tf", [0, 1, 1], 3, 3));
  assert.ok(!validChoices("tf", [0, 2, 1], 3, 3), "tf is 0 or 1");
  assert.ok(!validChoices("tf", [0, 1], 3, 3), "one per statement");
  assert.ok(validChoices("match", [3, 0, 1], 4, 3), "the bank may have one more than the prompts");
  assert.ok(!validChoices("match", [1, 1, 0], 4, 3), "distinct");
  assert.ok(!validChoices("order", [0, 1, 4], 3, 3), "in range");
  assert.ok(validChoices("order", [2, 0, 1], 3, 3));
});

test("toStoredSet and toShownSet are inverse for every form", () => {
  const order = [2, 0, 3, 1]; // order[shown] = stored
  // tf: the statement shown first is stored 2.
  assert.deepEqual(toStoredSet("tf", order, [1, 0, 0, 1]), [0, 1, 1, 0]);
  assert.deepEqual(toShownSet("tf", order, [0, 1, 1, 0]), [1, 0, 0, 1]);
  // match / order: values are options; the places stay.
  assert.deepEqual(toStoredSet("order", order, [0, 1, 2, 3]), [2, 0, 3, 1]);
  for (const form of ["match", "order"] as const) {
    const shown = [3, 1, 0, 2];
    assert.deepEqual(toShownSet(form, order, toStoredSet(form, order, shown)), shown);
  }
  const id = [0, 1, 2];
  assert.deepEqual(toStoredSet("match", id, [2, 0, 1]), [2, 0, 1], "the identity order changes nothing");
});

test("forms: each new style's forms; sets", () => {
  assert.deepEqual([...formsOf("label")], ["one", "tap"]);
  assert.deepEqual([...formsOf("case")], ["one"]);
  assert.deepEqual([...formsOf("tf")], ["tf"]);
  assert.ok(isSetForm("match") && isSetForm("order") && isSetForm("tf") && !isSetForm("tap") && !isSetForm("one"));
  assert.equal(NEW_STYLES.length, 6);
  for (const s of NEW_STYLES) assert.ok((STYLES as readonly string[]).includes(s) && STYLE_HE[s], s);
  assert.equal(STYLE_HE.label, "סימון על תמונה");
  assert.equal(STYLE_HE.steps, "מקרה קליני בשלבים");
  const grouped = TYPE_GROUPS.flatMap((g) => g.styles ?? []);
  for (const s of STYLES) assert.ok(grouped.includes(s), `${s} is in a type group`);
});

test("canStyle: a table, labelled pictures, captioned pictures, enough points", () => {
  const f = { ...emptyFacts(), points: { drug: 2 } };
  assert.ok(canStyle("case", f) && canStyle("tf", f));
  assert.ok(!canStyle("blank_table", f) && !canStyle("label", f) && !canStyle("image", f) && !canStyle("steps", f) && !canStyle("match", f));
  const g = { tables: true, figures: 2, labelled: 1, points: { structure: 4 } };
  for (const s of ["blank_table", "label", "image", "steps", "match", "order"]) assert.ok(canStyle(s, g), s);
  assert.deepEqual(addFacts(f, g), { tables: true, figures: 2, labelled: 1, points: { drug: 2, structure: 4 } });
});

test("defaultStylesFor: case and tf always; pharmacology or not; pictures; a staged case from 12 points; at most 6", () => {
  assert.deepEqual(defaultStylesFor({ ...emptyFacts(), points: { drug: 5, mechanism: 3, structure: 2 } }), ["case", "tf", "mechanism", "drug_choice", "adverse_contra"]);
  assert.deepEqual(defaultStylesFor({ ...emptyFacts(), points: { structure: 5, process: 3, drug: 1 } }), ["case", "tf", "match", "order"]);
  assert.deepEqual(defaultStylesFor({ tables: false, figures: 3, labelled: 2, points: { structure: 10, process: 4 } }), ["case", "tf", "match", "order", "label", "image"]);
  assert.deepEqual(defaultStylesFor({ tables: false, figures: 1, labelled: 0, points: { structure: 10, process: 4 } }), ["case", "tf", "match", "order", "steps"]);
  assert.equal(defaultStylesFor({ tables: true, figures: 9, labelled: 9, points: { drug: 30 } }).length, 6);
});

test("weights: a label item half, a staged case 2.5; the estimate is weighted", () => {
  assert.equal(STYLE_WEIGHT.label, 0.5);
  assert.equal(styleWeight("steps"), 2.5);
  assert.equal(styleWeight("case"), 1);
  assert.equal(weightOf(["case", "tf", "label", "steps"]), 1 + 1.2 + 0.5 + 2.5);
  assert.equal(requestUsd(["case", "case"]), requestUsd(2));
  assert.equal(requestUsd(["steps", "steps"]), 0.13, "5 × $0.025, rounded up");
  assert.equal(solverUsd(["label", "label"]), 0, "label items are never solved");
});

/** n points in a part, of one kind. */
const pts = (part: number, n: number, kind: PlanPoint["kind"] = "structure"): PlanPoint[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${part}-${i}`, part_idx: part, n: i + 1, kind, red_flag: false, weight: 2 }));

test("planRequest with partFacts: label → image without geometry; per-part quotas; a part none fits writes nothing", () => {
  const points = [...pts(0, 8), ...pts(1, 8), ...pts(2, 8)];
  const partFacts = new Map([
    [0, { tables: false, figures: 2, labelled: 1, points: { structure: 8 } }],
    [1, { tables: false, figures: 1, labelled: 0, points: { structure: 8 } }],
    [2, { tables: false, figures: 0, labelled: 0, points: { structure: 8 } }],
  ]);
  const plan = planRequest({ points, level: "full", parts: [0, 1, 2], styles: ["label", "steps", "tf"], partFacts });
  const by = (p: number) => plan.batches.filter((b) => b.part_idx === p).flatMap((b) => b.styles);
  assert.ok(by(0).filter((s) => s === "label").length <= 2, "label ≤ 2 × labelled");
  assert.ok(by(0).includes("label"));
  assert.ok(!by(1).includes("label") && by(1).filter((s) => s === "image").length === 1, "label became image (one picture)");
  assert.ok(!by(2).includes("label") && !by(2).includes("image"), "no pictures: no picture types");
  for (const p of [0, 1, 2]) assert.ok(by(p).filter((s) => s === "steps").length <= 2, "two staged cases a part at most");
  // Only label requested, a part without pictures: no questions there.
  const only = planRequest({ points, level: "full", parts: [0, 2], styles: ["label"], partFacts });
  assert.deepEqual(only.parts.map((p) => p.part_idx), [0]);
  assert.equal(only.total, 2, "the part writes no more than its quota");
  assert.deepEqual(plannedStyles(only), ["label", "label"]);
});

test("figure geometry: the stored shape; label text rule; label normalising", () => {
  const box = { x: 0.1, y: 0.1, w: 0.1, h: 0.05 };
  const geo = { v: 1, src: "pptx", stage: { w: 4, h: 3 }, img: { x: 0, y: 0, w: 1, h: 1 }, labels: [{ t: "A", b: box }, { t: "B", b: box }, { t: "C", b: box }], lines: [], baked: false };
  assert.ok(isFigureGeo(geo));
  assert.ok(!isFigureGeo({ ...geo, labels: geo.labels.slice(0, 2) }), "3 labels at least");
  assert.ok(!isFigureGeo({ ...geo, v: 2 }));
  assert.ok(!isFigureGeo({ ...geo, lines: [[0, 0, 9, 0]] }), "coordinates within -0.5..1.5");
  assert.ok(isLabelText("Loop of Henle") && !isLabelText("12") && !isLabelText("a b c d e f") && !isLabelText("x".repeat(41)));
  assert.ok(!isLabelText("Loop", 3), "at most 2 lines");
  assert.equal(normLabel("  1. Loop  of Henle: "), "loop of henle");
});
