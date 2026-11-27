import assert from "node:assert/strict";
import { test } from "node:test";
import { numberBlocks } from "../../shared/study/blocks.js";
import { askMessages, askSystem } from "./ask.js";
import { cardsCall } from "./cards.js";
import { checksFor, labEstimate, LAB_NAMES, LAB_PICTURES, picturePaths, thaw, type Frozen } from "./lab.js";
import {
  askFrozen,
  cardsFrozen,
  CHECKED_ROUTES,
  checkedQuestions,
  judgeCall,
  judgeEstimate,
  judgeScores,
  numbersOf,
  partFrozen,
  pointsFrozen,
  practiceFrozen,
  practiceSolve,
  RATED_ROUTES,
  SET_STYLES,
  solveChecks,
  solveEstimate,
} from "./labRated.js";
import { LAB_CARDS_COUNT, LAB_PART_TOKENS, LAB_PRACTICE_COUNT } from "./limits.js";
import { askQuestion, needsCheck, stepModel } from "./ops/labRated.js";
import { pieceCall, pointPieces } from "./points.js";
import { questionsCall } from "./practice.js";
import { askTurnText, summaryBlock } from "./prompts/collab.js";
import { LAB_JUDGE_SYSTEM } from "./prompts/lab.js";
import type { Lecture, StoredSlide } from "./study.js";
import { partRequest, type InputSection } from "./writer.js";

/* "השוואת מודלים", the short kinds members rate (WP8; design-models §7.5,
 * §7.6, OD6, OD9, OD12, D15): each frozen request is production's builder's
 * output (differing only as `differs` says: the count, the summary's
 * max_tokens, "לשאול" without threads and corrections); the $0 checks are
 * production's own checks; the solver's paid check; the AI score's request
 * (slide text only, the labels in the order given) and its scores. Synthetic
 * lecture and items only (an invented drug, Examplomycin, as questions.test.ts). */

const slides: StoredSlide[] = Array.from({ length: 38 }, (_, i) => ({
  n: i + 1,
  title: `שקף בדוי ${i + 1}`,
  lines: [i === 4 ? "Examplomycin: משופעלת בתא על ידי חיזור; הרגישות תואמת את פעילות ה-XRD. מינון 500 mg פעמיים ביום, 7 ימים." : `טקסט בדוי של שקף ${i + 1}`],
  tables: [],
  notes: "",
  figures: i === 5 ? [{ k: 1, path: "g1/l1/s6-1.jpg", w: 900, h: 700 }] : [],
}));
const lecture: Lecture = { id: "l1", group_id: "g1", course: "", title: "תרופות בדויות", lecturer: "", lecture_date: null, source_kind: "pptx", slides };
const md = "## חלק בדוי\n\nExamplomycin משופעלת בתא על ידי חיזור, והרגישות תואמת את פעילות ה-XRD [ש' 5].\n\nהמינון 500 mg פעמיים ביום למשך 7 ימים [ש' 5-6].";
const part = { idx: 0, heading: "חלק בדוי", from: 5, to: 7 };
const text = { gen: 1, inPart: true, blocks: numberBlocks(md), figures: [] };

/** A question that passes checkQuestion (questions.test.ts's PART1[0], an invented drug). */
const opt = (t: string, why: string, correct = false) => ({ text: t, correct, why, when: "", tag: "", left: "" });
const QUESTION = {
  topic: "Examplomycin",
  aspect: "mechanism",
  style: "mechanism",
  points: [],
  takeaway: "הרגישות של אורגניזם ל-Examplomycin תואמת את פעילות ה-XRD שלו. [ש' 5]",
  difficulty: 2,
  case: false,
  vignette: "",
  question: "מה קובע את מידת הרגישות של אורגניזם ל-Examplomycin?",
  options: [
    opt("פעילות האנזים XRD שלו", "Examplomycin משופעלת בתא על ידי חיזור, והרגישות של אורגניזם לתרופה תואמת את פעילות ה-XRD שלו. [ש' 5]", true),
    opt("פעילות האנזים FHR שלו", "FHR הוא המטרה של Shamtrexate, ולא קשור להפעלת Examplomycin. [ש' 31-32]"),
    opt("כמות ה-Q-tubulin שלו", "Q-tubulin הוא המטרה של ה-Mockazoles, שנקשרות אליו וגורמות לאובדן microtubules בתולעים. [ש' 35]"),
    opt("כמות ה-fictosterol בממברנה שלו", "ל-fictosterol נקשרת Placebrin ויוצרת נקבוביות בממברנה של Fakeomonas. [ש' 13]"),
    opt("פעילות האנזים examplothione reductase שלו", "את examplothione reductase מעכבת Stubamide, וזו מטרה של התרופות נגד Fakeomonas. [ש' 17]"),
  ],
  slides: [5, 13, 17, 31, 32, 35],
  para: 0,
  teaser: "",
  figure: "",
  resolved: "",
  stages: [],
};

test("the rated kinds: six, none with an answer key; only practice and a set's batch have the paid check; only the summary sends pictures", () => {
  assert.deepEqual([...RATED_ROUTES], ["practice", "set_write", "points", "cards", "ask", "part"]);
  assert.deepEqual([...CHECKED_ROUTES].sort(), ["practice", "set_write"]);
  for (const r of RATED_ROUTES) assert.equal(LAB_PICTURES[r], r === "part", r);
  assert.equal(LAB_NAMES.practice, "שאלות תרגול");
  assert.equal(LAB_NAMES.part, "סיכומים");
});

test("practice: questionsCall's request for LAB_PRACTICE_COUNT questions, as op questions sends a round; a set's batch adds its styles", () => {
  const f = practiceFrozen("practice", lecture, part, { text, known: [], style: null, corrections: [] });
  const want = questionsCall({ lecture, effort: "high", claim: { part_idx: 0, heading: "חלק בדוי", slide_from: 5, slide_to: 7 }, want: LAB_PRACTICE_COUNT, optionCount: 5, known: [], style: null, corrections: [], part: text, memberStyle: null, pictures: [] });
  assert.deepEqual({ system: f.system, messages: f.messages, maxTokens: f.maxTokens, effort: f.effort, schema: f.format?.schema }, { system: want.system, messages: want.messages, maxTokens: want.maxTokens, effort: want.effort, schema: want.schema });
  assert.equal(f.kind, "practice");
  assert.equal(LAB_PRACTICE_COUNT, 3);
  assert.deepEqual(f.material, { lecture: "l1", title: "תרופות בדויות", part: 0, heading: "חלק בדוי", slides: [5, 7], count: 3 });
  const set = practiceFrozen("set_write", lecture, part, { text, known: [], style: null, corrections: [] });
  const sw = questionsCall({ lecture, effort: "high", claim: { part_idx: 0, heading: "חלק בדוי", slide_from: 5, slide_to: 7 }, want: 3, optionCount: 5, known: [], style: null, corrections: [], part: text, extras: { styles: SET_STYLES, difficulty: "exam", points: [], focus: "" }, memberStyle: null, pictures: [] });
  assert.deepEqual(set.messages, sw.messages);
  assert.deepEqual((set.key as { styles: string[] }).styles, ["case", "mechanism", "compare"]);
  assert.notDeepEqual(set.messages, f.messages, "the set's batch asks for its styles");
});

test("points, cards, ask, a summary part: production's builders; ask without the group's threads and corrections (OD9); the part at 16k tokens (D15)", () => {
  const claimed = { part_idx: 0, heading: "חלק בדוי", slide_from: 5, slide_to: 7, md5: "", blocks: numberBlocks(md) };
  const p = pointsFrozen(lecture, claimed);
  const pc = pieceCall(pointPieces([claimed])[0]);
  assert.deepEqual(p.system, pc.system);
  assert.deepEqual(p.messages, [{ role: "user", content: [{ type: "text", text: pc.user }] }]);
  assert.equal(p.maxTokens, pc.maxTokens);
  assert.ok(p.format?.schema && JSON.stringify(p.format.schema).includes("red_flag"));

  const c = cardsFrozen(lecture, part, { figures: [], corrections: [], known: [], blocks: numberBlocks(md) });
  const cc = cardsCall({ lecture, claim: { heading: "חלק בדוי", slide_from: 5, slide_to: 7 }, figures: [], corrections: [], known: [], blocks: numberBlocks(md) }, LAB_CARDS_COUNT);
  assert.deepEqual({ system: c.system, messages: c.messages, maxTokens: c.maxTokens }, { system: cc.system, messages: cc.messages, maxTokens: cc.maxTokens });

  const a = askFrozen(lecture, [md], "מה קובע את הרגישות ל-Examplomycin?");
  assert.deepEqual(a.system, askSystem(lecture, [], null, summaryBlock([md]), null));
  assert.deepEqual(a.messages, askMessages([], askTurnText("מה קובע את הרגישות ל-Examplomycin?", null, false)));
  assert.equal(a.cacheTail, true, "as production: top-level caching");
  assert.equal(a.system.length, 3, "the prompt, the deck, the summary: no corrections, no notes, no threads");
  assert.equal((a.material as { question: string }).question, "מה קובע את הרגישות ל-Examplomycin?");
  assert.equal(thaw(a as Frozen, new Map())?.cacheTail, true);

  const sections: InputSection[] = [
    { idx: 0, title: "חלק בדוי", slide_from: 5, slide_to: 7, status: "ready", error: null, markdown: md },
    { idx: 1, title: "חלק שני", slide_from: 8, slide_to: 12, status: "ready", error: null, markdown: "" },
  ];
  const figures = [{ n: 6, k: 1, w: 900, h: 700, url: "study-path:g1/l1/s6-1.jpg" }];
  const s = partFrozen(lecture, sections, 0, figures);
  const want = partRequest({ lecture, sections, idx: 0, figures, corrections: [] });
  assert.deepEqual(s.system, want.request.system);
  assert.deepEqual(s.messages, want.request.messages);
  assert.equal(s.maxTokens, LAB_PART_TOKENS);
  assert.equal(LAB_PART_TOKENS, 16_000);
  assert.deepEqual(picturePaths(s as Frozen), ["g1/l1/s6-1.jpg"], "the picture is kept as its path, signed per call");
  assert.deepEqual((s.key as { numbers: string[] }).numbers, ["500mg", "7ימים"]);
});

test("$0 checks: production's own checks, by kind", () => {
  const key = { route: "practice" as const, optionCount: 5, from: 5, to: 7, slides: slides.map((s) => s.n), styles: null };
  const good = JSON.stringify({ questions: [QUESTION] });
  assert.equal(checkedQuestions(key, good).length, 1);
  assert.deepEqual(checksFor(key, good, true), { pass: true, items: 1, match: 1, ok: 1 });
  const bad = JSON.stringify({ questions: [QUESTION, { ...QUESTION, question: "?", options: [] }] });
  assert.deepEqual(checksFor(key, bad, true), { pass: false, items: 2, match: 1, ok: 1 });
  assert.equal(checksFor(key, "not json", true).pass, false);
  assert.equal(checksFor(key, good, false).pass, false, "a cut answer does not pass");

  const blocks = numberBlocks(md);
  const pkey = { route: "points" as const, part: 0, from: 5, to: 7, slides: slides.map((s) => s.n), blocks };
  const point = { part: 0, para: 1, kind: "mechanism", subject: "Examplomycin", text: "Examplomycin משופעלת בתא על ידי חיזור.", slides: [5], red_flag: false, weight: 3 };
  assert.deepEqual(checksFor(pkey, JSON.stringify({ points: [point, { ...point, kind: "nonsense" }] }), true), { pass: false, items: 2, match: 1, ok: 1, red: 0 });

  const ckey = { route: "cards" as const, from: 5, to: 7, slides: slides.map((s) => s.n), figures: [], blocks };
  const card = { topic: "Examplomycin", aspect: "mechanism", cloze: false, front: "איך משופעלת Examplomycin בתא?", back: "על ידי חיזור", extra: "", figure: "", slides: [5], para: 1 };
  assert.deepEqual(checksFor(ckey, JSON.stringify({ cards: [card] }), true), { pass: true, items: 1, match: 1, ok: 1 });

  const akey = { route: "ask" as const, slides: slides.map((s) => s.n) };
  assert.deepEqual(checksFor(akey, "לפי השקפים, הרגישות תואמת את ה-XRD [ש' 5].", true), { pass: true, items: 1, match: 1, tags: 1, bad: 0 });
  assert.deepEqual(checksFor(akey, "תשובה בלי הפניה, ושקף שאין [ש' 90].", true), { pass: false, items: 1, match: 0, tags: 1, bad: 1 });

  const skey = { route: "part" as const, from: 5, to: 7, slides: slides.map((s) => s.n), numbers: ["500mg", "7ימים"] };
  const c = checksFor(skey, "Examplomycin משופעלת על ידי חיזור [ש' 5]. המינון 500 mg [ש' 6].", true);
  assert.deepEqual({ pass: c.pass, items: c.items, match: c.match, numbers: c.numbers, numbers_of: c.numbers_of, bad: c.bad }, { pass: true, items: 3, match: 2, numbers: 1, numbers_of: 2, bad: 0 });
  assert.deepEqual(numbersOf("כ-65% נספג, 0,5 g, 12 שעות ו-3 ימים, 7 pills"), ["65%", "0.5g", "12שעות", "3ימים"]);
});

test("the paid check: the solver answers the checked questions without their keys; agreement with the answer's own key", () => {
  const key = { route: "practice" as const, optionCount: 5, from: 5, to: 7, slides: slides.map((s) => s.n), styles: null };
  const good = JSON.stringify({ questions: [QUESTION] });
  const s = practiceSolve(lecture, key, good);
  assert.ok(s);
  assert.equal(s.items.length, 1);
  const sent = JSON.stringify(s.call.messages);
  assert.ok(!sent.includes('"answer"') && !sent.includes("correct"), "never the key");
  const right = s.items[0].answer!;
  assert.deepEqual(solveChecks(s.items, JSON.stringify({ answers: [{ id: "q1", choice: right, ambiguous: false, seq: [] }] }), true), { solved: 1, solver_agrees: 1, solver_differs: 0 });
  assert.deepEqual(solveChecks(s.items, JSON.stringify({ answers: [{ id: "q1", choice: (right + 1) % 5, ambiguous: false, seq: [] }] }), true), { solved: 1, solver_agrees: 0, solver_differs: 1 });
  assert.equal(practiceSolve(lecture, key, "{}"), null, "nothing to check");
  assert.equal(needsCheck({ route: "practice", key }, good), true);
  assert.equal(needsCheck({ route: "practice", key }, "{}"), false);
  assert.equal(needsCheck({ route: "points", key: { route: "points", part: 0, from: 5, to: 7, slides: [], blocks: [] } }, good), false);
  assert.ok(solveEstimate(lecture, "claude-opus-5-5") > solveEstimate(lecture, "claude-haiku-5-5"));
});

test("the AI score: the slides' text only, the answers under their labels in the order given; scores read within 1-5; its worst case grows with the answers", () => {
  const f = practiceFrozen("practice", lecture, part, { text, known: [], style: null, corrections: [] });
  const call = judgeCall({ lecture, route: "practice", material: f.material, answers: [{ label: "ב", text: "תשובה ב" }, { label: "א", text: "תשובה א" }] });
  assert.equal(call.system[0].text, LAB_JUDGE_SYSTEM);
  const user = String(call.messages[0].content);
  assert.ok(user.indexOf("=== Answer ב ===") < user.indexOf("=== Answer א ==="), "the order given");
  assert.ok(!JSON.stringify(call).includes('"image"'), "no pictures");
  assert.ok(!/claude|opus|haiku|sonnet/i.test(JSON.stringify(call)), "no model is named to the judge");
  const s = judgeScores(
    JSON.stringify({
      outputs: [
        { label: "א", overall: 4, accuracy: 5, hebrew: 4, structure: 3, errors: [] },
        { label: "ב", overall: 9, accuracy: 5, hebrew: 4, structure: 3, errors: [] },
        { label: "ג", overall: 3, accuracy: 3, hebrew: 3, structure: 3, errors: [] },
      ],
    }),
    ["א", "ב"],
  );
  assert.deepEqual([...s.keys()], ["א"], "out of range and labels not asked are left out");
  assert.equal(judgeScores("nonsense", ["א"]).size, 0);
  const two = judgeEstimate(f, lecture, 2, "claude-opus-5-5");
  const four = judgeEstimate(f, lecture, 4, "claude-opus-5-5");
  assert.ok(two > 0 && four > two);
  assert.ok(labEstimate(f as Frozen, "claude-opus-5-5") > 0);
});

test("the op's helpers: the typed question for לשאול, the steps' models", () => {
  assert.equal(askQuestion("  מה  ההבדל?  ", false), "מה ההבדל?");
  assert.throws(() => askQuestion("", false), /no question/);
  assert.throws(() => askQuestion("ש".repeat(501), false), /no question/);
  assert.equal(askQuestion(undefined, true).length, 500, "a price takes the longest question");
  assert.equal(stepModel({}, "judge"), "claude-opus-5-5");
  assert.equal(stepModel({ solver: { model: "claude-haiku-5-5" } }, "solver"), "claude-haiku-5-5");
  assert.equal(stepModel({ solver: { model: "nonsense" } }, "solver"), "claude-opus-5-5");
});
