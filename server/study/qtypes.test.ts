import assert from "node:assert/strict";
import { test } from "node:test";
import type { FigureGeo } from "../../shared/study/figureGeo.js";
import { buildLabelItem, labelledFigures, labelIndex, modeFor, pageCrop, pinOrder } from "./labels.js";
import { checkCall, maxTokensFor, solverFree, solverItemOf, typesCtx } from "./practice.js";
import { partFacts } from "./practice2.js";
import { questionsRequest } from "./prompts/questions.js";
import { checkQuestion, type Ctx, MATCH_LEAD, ORDER_LEAD, type Question, stripOrdinal, TF_LEAD } from "./questions.js";
import type { StoredSlide } from "./study.js";

/* Question types (docs/study/question-types.md): each checker's accept and
 * reject, the label item built from geometry (deterministic, its pins and
 * explanations, the key never in the layout), the leak checks, a release-1
 * round refusing the new types, the solver's view and the facts the plan
 * reads. Synthetic material only (a made-up lecture of 30 slides). */

const opt = (text: string, why: string, correct = false, left = "") => ({ text, correct, why, when: "", tag: "", left });
const BASE: Question = {
  topic: "Nephron",
  aspect: "physiology",
  style: "tf",
  points: [],
  takeaway: "הלולאה מרכזת את השתן. [ש' 3]",
  difficulty: 2,
  case: false,
  vignette: "",
  question: "",
  options: [],
  para: 0,
  teaser: "",
  figure: "",
  slides: [3],
  resolved: "",
  stages: [],
};
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const lectureSlides = new Set(Array.from({ length: 30 }, (_, i) => i + 1));
const GEO: FigureGeo = {
  v: 1,
  src: "pptx",
  stage: { w: 400, h: 300 },
  img: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  labels: [
    { t: "Glomerulus", b: { x: 0.1, y: 0.1, w: 0.1, h: 0.05 } },
    { t: "Proximal tubule", b: { x: 0.5, y: 0.12, w: 0.15, h: 0.05 } },
    { t: "Loop of Henle", b: { x: 0.45, y: 0.7, w: 0.15, h: 0.05 } },
    { t: "Distal convoluted tubule", b: { x: 0.8, y: 0.3, w: 0.18, h: 0.05 } },
    { t: "Collecting duct", b: { x: 0.02, y: 0.85, w: 0.15, h: 0.05 } },
  ],
  lines: [[0.8, 0.32, 0.7, 0.35]],
  baked: false,
};
const ctx = (styles: Question["style"][], extra: Partial<Ctx> = {}): Ctx => ({
  optionCount: 4,
  lectureSlides,
  from: 1,
  to: 10,
  known: [],
  random: seeded(11),
  styles: styles as never,
  lectureText: "glomerulus proximal tubule loop of henle distal convoluted tubule collecting duct bowman capsule furosemide",
  figures: new Set(["fig:3-1"]),
  labelled: new Map([["fig:3-1", { geo: GEO }]]),
  newSeries: () => "e7300000-0000-4000-8000-00000000000a",
  ...extra,
});

// ── tf ──
const TF: Question = {
  ...BASE,
  style: "tf",
  question: "",
  options: [
    opt("Furosemide פועלת ב-Loop of Henle", "נכון: מעכבת NKCC2. [ש' 3]", true),
    opt("Furosemide חוסכת אשלגן", "לא נכון: היא מאבדת אשלגן. [ש' 3]"),
    opt("הלולאה מרכזת את השתן", "נכון. [ש' 3]", true),
  ],
};

test("tf: 3-5 statements of mixed truth; the server's lead-in; seq 1/0 per stored statement", () => {
  const r = checkQuestion(TF, ctx(["tf"]));
  assert.ok(r.ok, r.ok ? "" : r.reasons.join("; "));
  assert.equal(r.item.form, "tf");
  assert.equal(r.item.answer, null);
  assert.equal(r.item.question, TF_LEAD);
  assert.deepEqual(
    r.item.seq,
    r.item.options.map((o) => (o.includes("חוסכת") ? 0 : 1)),
  );
  assert.equal(r.item.explanations.length, 3);
});

test("tf: rejects all true, too few, a statement without a tag, all of the above", () => {
  const no = (q: Question) => {
    const r = checkQuestion(q, ctx(["tf"]));
    return r.ok ? "accepted" : r.reasons.join("; ");
  };
  assert.match(no({ ...TF, options: TF.options.map((o) => ({ ...o, correct: true })) }), /true and false/);
  assert.match(no({ ...TF, options: TF.options.slice(0, 2) }), /tf with 2 statements/);
  assert.match(no({ ...TF, options: [TF.options[0], { ...TF.options[1], why: "בלי תג" }, TF.options[2]] }), /without a tag/);
  assert.match(no({ ...TF, options: [...TF.options, opt("כל התשובות נכונות", "x [ש' 3]")] }), /all\/none/);
  assert.match(no({ ...TF, options: [...TF.options.slice(0, 2), { ...TF.options[0] }] }), /say the same/);
});

// ── match ──
const MATCH: Question = {
  ...BASE,
  style: "match",
  question: "",
  options: [
    opt("NKCC2", "Furosemide חוסמת NKCC2. [ש' 3]", true, "Furosemide"),
    opt("NCC", "Thiazide חוסמת NCC. [ש' 4]", true, "Thiazide"),
    opt("ENaC", "Amiloride חוסמת ENaC. [ש' 5]", true, "Amiloride"),
    opt("Carbonic anhydrase", "לא מתאים לאף אחת מהן. [ש' 6]", false, ""),
  ],
};

test("match: prompts and bank shuffled apart; seq maps every prompt to its option", () => {
  const r = checkQuestion(MATCH, ctx(["match"]));
  assert.ok(r.ok, r.ok ? "" : r.reasons.join("; "));
  assert.equal(r.item.question, MATCH_LEAD);
  const layout = r.item.layout;
  assert.ok(layout && layout.kind === "match");
  const pairs: Record<string, string> = { Furosemide: "NKCC2", Thiazide: "NCC", Amiloride: "ENaC" };
  layout.prompts.forEach((p, i) => assert.equal(r.item.options[r.item.seq![i]], pairs[p]));
  assert.equal(new Set(r.item.seq).size, 3);
  assert.equal(r.item.options.length, 4, "the extra option is in the bank");
});

test("match: rejects two extras, two prompts alike, too few pairs", () => {
  const no = (q: Question) => {
    const r = checkQuestion(q, ctx(["match"]));
    return r.ok ? "accepted" : r.reasons.join("; ");
  };
  assert.match(no({ ...MATCH, options: [...MATCH.options, opt("Aquaporin", "x [ש' 6]")] }), /more than one extra/);
  assert.match(no({ ...MATCH, options: MATCH.options.map((o, i) => (i === 1 ? { ...o, left: "Furosemide" } : o)) }), /two prompts/);
  assert.match(no({ ...MATCH, options: MATCH.options.slice(0, 2) }), /match with 2 pairs/);
});

// ── order ──
const ORDER: Question = {
  ...BASE,
  style: "order",
  question: "",
  options: [
    opt("1. Glomerulus", "הסינון מתחיל כאן. [ש' 3]", true),
    opt("שלב 2: Proximal tubule", "ספיגה ראשונה. [ש' 3]", true),
    opt("ואז Loop of Henle", "ריכוז. [ש' 3]", true),
    opt("לבסוף Collecting duct", "הסוף. [ש' 3]", true),
  ],
};

test("order: ordinals stripped; stored shuffled, never in order; seq is the order", () => {
  for (let seed = 1; seed < 30; seed++) {
    const r = checkQuestion(ORDER, ctx(["order"], { random: seeded(seed) }));
    assert.ok(r.ok, r.ok ? "" : r.reasons.join("; "));
    assert.equal(r.item.question, ORDER_LEAD);
    assert.notDeepEqual(r.item.seq, [0, 1, 2, 3], `seed ${seed}: never already in order`);
    assert.deepEqual(
      r.item.seq!.map((i) => r.item.options[i]),
      ["Glomerulus", "Proximal tubule", "ואז Loop of Henle", "Collecting duct"].map((t) => t.replace(/^ואז /, "ואז ")),
    );
  }
  assert.equal(stripOrdinal("לבסוף Collecting duct"), "Collecting duct");
  assert.equal(stripOrdinal("(3) Loop"), "Loop");
});

// ── label ──
const LABEL: Question = {
  ...BASE,
  style: "label",
  figure: "fig:3-1",
  question: "מה זה?",
  options: [
    opt("Loop of Henle", "הלולאה מרכזת. [ש' 3]", true),
    opt("Proximal tubule", "סופג את רוב הנתרן. [ש' 3]"),
    opt("Collecting duct", "בבקרת ADH. [ש' 3]"),
    opt("Bowman capsule", "עוטף את הגלומרולוס. [ש' 3]"),
  ],
};

test("label: name mode; the server's lead-in; pins numbered; the layout never holds a label's text", () => {
  const r = checkQuestion(LABEL, ctx(["label"], { labelIndex: 0 }));
  assert.ok(r.ok, r.ok ? "" : r.reasons.join("; "));
  assert.equal(r.item.form, "one");
  const lay = r.item.layout;
  assert.ok(lay && lay.kind === "label" && lay.mode === "name");
  assert.equal(r.item.question, `מה מסומן במספר ${lay.ask} בשרטוט?`);
  assert.equal(r.item.options[r.item.answer!], "Loop of Henle");
  const text = JSON.stringify(lay);
  for (const l of GEO.labels) assert.ok(!text.includes(l.t), `the layout has no "${l.t}"`);
  assert.equal(lay.pins.length, 5);
  assert.deepEqual(lay.masks, [], "pptx labels are never drawn, so nothing to mask");
});

test("label: tap mode every other item; options are pin numbers; each explained by its label; deterministic", () => {
  const a = checkQuestion(LABEL, ctx(["label"], { labelIndex: 1 }));
  const b = checkQuestion(LABEL, ctx(["label"], { labelIndex: 1, random: seeded(99) }));
  assert.ok(a.ok && b.ok);
  assert.equal(a.item.form, "tap");
  assert.equal(a.item.question, "באיזה מספר מסומן Loop of Henle?");
  assert.deepEqual(a.item.options, a.item.options.map((_, i) => String(i + 1)));
  assert.match(a.item.explanations[a.item.answer!], /הוא Loop of Henle\. הלולאה מרכזת/);
  assert.ok(a.item.explanations.every((e, i) => e.startsWith(`${i + 1} הוא `)));
  assert.deepEqual(a.item.layout, b.item.layout, "the same geometry gives the same pins");
  assert.deepEqual([a.item.answer, a.item.options], [b.item.answer, b.item.options]);
});

test("label: rejects a picture without geometry, a key that is not a label, a distractor from nowhere", () => {
  const no = (q: Question, c = ctx(["label"])) => {
    const r = checkQuestion(q, c);
    return r.ok ? "accepted" : r.reasons.join("; ");
  };
  assert.match(no({ ...LABEL, figure: "fig:9-1" }), /without a labelled picture/);
  assert.match(no({ ...LABEL, options: [opt("Renal pelvis", "x [ש' 3]", true), ...LABEL.options.slice(1)] }), /not a label/);
  assert.match(no({ ...LABEL, options: [...LABEL.options.slice(0, 3), opt("Hepatocyte", "x [ש' 3]")] }), /neither a label nor in the lecture/);
});

test("labels.ts: reading order top to bottom, right to left within a row; tap pins prefer the writer's distractors", () => {
  const boxes = [
    { x: 0.1, y: 0.1, w: 0.1, h: 0.05 },
    { x: 0.6, y: 0.11, w: 0.1, h: 0.05 }, // the same row, to the right: first
    { x: 0.3, y: 0.5, w: 0.1, h: 0.05 },
  ];
  assert.deepEqual(pinOrder(boxes), [1, 0, 2]);
  assert.equal(modeFor(1, 3), "name", "3 labels: name mode only");
  assert.equal(modeFor(1, 4), "tap");
  const t = buildLabelItem({ fig: "fig:3-1", geo: GEO, target: 2, mode: "tap", options: [], prefer: [4] });
  assert.ok(t.layout.pins.length >= 3 && t.layout.pins.length <= 6);
  assert.equal(t.options.length, t.layout.pins.length);
  assert.equal(labelIndex(GEO, " loop of henle "), 2);
  const pdf = pageCrop({ ...GEO, src: "pdf", baked: true, img: { x: -0.25, y: -0.5, w: 2, h: 2 } });
  assert.deepEqual(pdf.crop, { x: 0.125, y: 0.25, w: 0.5, h: 0.5 });
  assert.equal(pdf.masks.length, 5);
});

// ── image ──
const IMAGE: Question = {
  ...BASE,
  style: "image",
  figure: "fig:3-1",
  question: "מה מראה התמונה שבשקף?",
  options: [opt("נפרון", "נכון. [ש' 3]", true), opt("אונה של כבד", "לא. [ש' 3]"), opt("נאדית ריאה", "לא. [ש' 3]"), opt("גלומרולוס בלבד", "לא. [ש' 3]")],
};

test("image: needs a captioned picture of the part; on a PDF page without geometry the answer must not be printed", () => {
  const r = checkQuestion(IMAGE, ctx(["image"], { labelled: new Map() }));
  assert.ok(r.ok, r.ok ? "" : r.reasons.join("; "));
  assert.deepEqual(r.item.layout, { kind: "image", fig: "fig:3-1" });
  const none = checkQuestion({ ...IMAGE, figure: "" }, ctx(["image"]));
  assert.ok(!none.ok && /without a picture/.test(none.reasons[0]));
  const leak = checkQuestion(IMAGE, ctx(["image"], { pdf: true, labelled: new Map(), slideText: new Map([[3, "מקטעי הנפרון בשקף"]]) }));
  assert.ok(!leak.ok && /printed on the page/.test(leak.reasons[0]));
  const masked = checkQuestion(IMAGE, ctx(["image"], { pdf: true, labelled: new Map([["fig:3-1", { geo: { ...GEO, src: "pdf", baked: true } }]]) }));
  assert.ok(masked.ok && masked.item.layout?.kind === "image" && masked.item.layout.masks?.length === 5);
});

// ── steps ──
const CASE = "גבר בן 64 מגיע לחדר מיון עם חולשה של יומיים. ברקע אי ספיקת כליות ונטילת תרופות. בבדיקה דופק איטי.";
const STEPS: Question = {
  ...BASE,
  style: "steps",
  case: true,
  vignette: CASE,
  question: "מה הממצא הצפוי בבדיקות הדם?",
  options: [opt("Hyperkalemia", "נכון. [ש' 7]", true), opt("Hyponatremia", "לא. [ש' 7]"), opt("Hypercalcemia", "לא. [ש' 7]"), opt("Hypoglycemia", "לא. [ש' 7]")],
  resolved: "בבדיקות הדם נמצאה Hyperkalemia.",
  stages: [
    {
      update: "ב-ECG נראים גלי T גבוהים.",
      question: "מה הצעד הראשון בטיפול?",
      options: [opt("Calcium gluconate", "מייצב את הממברנה. [ש' 8]", true), opt("Furosemide", "לא ראשון. [ש' 8]"), opt("Observation", "מסוכן. [ש' 8]"), opt("Digoxin", "מסוכן. [ש' 8]")],
      resolved: "ניתן Calcium gluconate.",
    },
  ],
};

test("steps: 2 rows in one series; each row stands alone; carried text folded by lead", () => {
  const r = checkQuestion(STEPS, ctx(["steps"]));
  assert.ok(r.ok, r.ok ? "" : r.reasons.join("; "));
  assert.equal(r.more?.length, 1);
  const [a, b] = [r.item, r.more![0]];
  assert.deepEqual([a.series, a.step, b.series, b.step], ["e7300000-0000-4000-8000-00000000000a", 1, "e7300000-0000-4000-8000-00000000000a", 2]);
  assert.ok(b.vignette.startsWith(CASE) && b.vignette.includes("נמצאה Hyperkalemia") && b.vignette.endsWith("ב-ECG נראים גלי T גבוהים."));
  assert.deepEqual(a.layout, { kind: "steps", of: 2, lead: 0 });
  assert.ok(b.layout?.kind === "steps" && b.layout.lead === `${CASE} בבדיקות הדם נמצאה Hyperkalemia.`.length);
  assert.equal(a.kind, "case");
});

test("steps: a step whose story gives its own answer, a case without stages, a step that fails its checks", () => {
  const leak = checkQuestion({ ...STEPS, stages: [{ ...STEPS.stages[0], update: "ניתן Calcium gluconate וה-ECG השתפר." }] }, ctx(["steps"]));
  assert.ok(!leak.ok && /step 2: the case gives its answer/.test(leak.reasons[0]));
  const single = checkQuestion({ ...STEPS, stages: [] }, ctx(["steps"]));
  assert.ok(!single.ok && /2-3 steps/.test(single.reasons[0]));
  const bad = checkQuestion({ ...STEPS, stages: [{ ...STEPS.stages[0], options: STEPS.stages[0].options.map((o) => ({ ...o, correct: true })) }] }, ctx(["steps"]));
  assert.ok(!bad.ok && /step 2: 4 correct/.test(bad.reasons[0]));
});

test("a release-1 round takes none of the new types", () => {
  for (const q of [TF, MATCH, ORDER, LABEL, IMAGE, STEPS]) {
    const r = checkQuestion(q, { ...ctx([]), styles: undefined });
    assert.ok(!r.ok && r.reasons[0] === "style not allowed here", q.style);
  }
});

test("the solver's view: a set's form and prompts, an image's caption; a label is never solved; the check call by form", () => {
  const m = checkQuestion(MATCH, ctx(["match"]));
  assert.ok(m.ok);
  const s = solverItemOf(m.item, new Map());
  assert.equal(s.form, "match");
  assert.deepEqual(s.prompts, m.item.layout?.kind === "match" ? m.item.layout.prompts : null);
  const i = checkQuestion(IMAGE, ctx(["image"], { labelled: new Map() }));
  assert.ok(i.ok);
  assert.equal(solverItemOf(i.item, new Map([["fig:3-1", "חתך של נפרון"]])).caption, "חתך של נפרון");
  assert.ok(solverFree({ style: "label" }) && !solverFree({ style: "tf" }));
  assert.equal(checkCall("d", { form: "tf" }, { choice: -1, ambiguous: false, ok: true, seq: [1, 0, 1] }).fn, "study_draft_check_set");
  assert.deepEqual(checkCall("d", { form: "order" }, null).args, { p_draft: "d", p_seq: null, p_ambiguous: null });
  assert.equal(checkCall("d", { form: "one" }, null).fn, "study_draft_check");
});

test("tokens scale with the types; the request lists labelled pictures; the plan's facts per part", () => {
  assert.equal(maxTokensFor(2), 9_000);
  assert.equal(maxTokensFor(2, ["steps", "steps"]), 4_000 + 2_500 * 5);
  assert.equal(maxTokensFor(2, ["label", "label"]), 9_000, "never below plain questions");
  const slides: StoredSlide[] = [
    { n: 3, title: "Nephron", lines: ["Nephron"], tables: [], notes: "", figures: [{ k: 1, path: "g/l/s3-1.jpg", w: 4, h: 3, geo: GEO }] },
    { n: 12, title: "Table", lines: [], tables: [[["a"]]], notes: "", figures: [{ k: 1, path: "g/l/s12-1.jpg", w: 4, h: 3 }] },
  ];
  const lab = labelledFigures(slides, 1, 10, new Map([["fig:3-1", "נפרון"]]));
  assert.deepEqual(lab.map((f) => [f.id, f.caption, f.labels.length]), [["fig:3-1", "נפרון", 5]]);
  const req = questionsRequest({ heading: "", from: 1, to: 10, count: 1, options: 4, cases: 0, asked: [], labelled: lab });
  assert.ok(req.includes("LABELLED PICTURES") && req.includes("3. Loop of Henle"));
  assert.ok(!questionsRequest({ heading: "", from: 1, to: 10, count: 1, options: 4, cases: 0, asked: [] }).includes("LABELLED"), "a part without them reads as before");
  const facts = partFacts(
    { slides },
    [
      { part_idx: 0, slide_from: 1, slide_to: 10 },
      { part_idx: 1, slide_from: 11, slide_to: 20 },
    ],
    [{ idx: 0, markdown: "![נפרון](fig:3-1)" }],
    [
      { part_idx: 0, kind: "structure" },
      { part_idx: 0, kind: "structure" },
      { part_idx: 1, kind: "drug" },
    ],
  );
  assert.deepEqual(facts.get(0), { tables: false, figures: 1, labelled: 1, points: { structure: 2 } });
  assert.deepEqual(facts.get(1), { tables: true, figures: 0, labelled: 0, points: { drug: 1 } });
  const t = typesCtx({ slides, source_kind: "pdf" }, { labelled: lab });
  assert.ok(t.pdf && t.labelled?.has("fig:3-1") && t.slideText?.get(3)?.includes("nephron"));
});
