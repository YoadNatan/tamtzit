import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { NumberedBlock } from "../../shared/study/blocks.js";
import { citedSlides } from "../../shared/study/edits.js";
import type { Difficulty, Style } from "../../shared/study/practice2.js";
import { askMessages, askSystem, badTags } from "./ask.js";
import { CardItem, CardSet, cardsCall, checkCard, type Figure, type KnownCard } from "./cards.js";
import { cleanSchema, type Effort } from "./claude.js";
import { estimateUsd } from "./budget.js";
import type { Frozen } from "./lab.js";
import { ASK_EFFORT, ASK_MAX_TOKENS, LAB_CARDS_COUNT, LAB_JUDGE_TOKENS, LAB_JUDGE_TOKENS_EACH, LAB_PART_TOKENS, LAB_PRACTICE_COUNT } from "./limits.js";
import { checkPoint, pieceCall, pointPieces, POINTS_EFFORT, PointItem, PointSet, type ClaimedPart } from "./points.js";
import { questionsCall, type PartText } from "./practice.js";
import { askTurnText, summaryBlock } from "./prompts/collab.js";
import { judgeRequest, LAB_JUDGE_SYSTEM } from "./prompts/lab.js";
import type { Correction, StyleInput } from "./prompts/questions.js";
import { checkQuestion, QuestionIn, type Known } from "./questions.js";
import { solverCall, SolverAnswerIn, verdictsOf, type SolverAnswer, type SolverItem } from "./solver.js";
import { lectureBlock, type Lecture } from "./study.js";
import { partRequest, type InputSection, type PartFigure } from "./writer.js";

/* ── "השוואת מודלים": the short kinds members rate (design-models §5.5,
 *    §7.5-§7.6, OD6, OD9, OD12, D15; WP8) ──
 *
 * The comparison's other kinds, beside the answer-key kinds of lab.ts:
 *   practice   a lecture part's practice questions (a release-1 round), 3
 *   set_write  the practice-set generator's batch (styles, difficulty), 3
 *   points     a part's points to know (its first piece)
 *   cards      a part's cards, 6
 *   ask        "לשאול" on a lecture, a question the owner types
 *   part       a summary part (16k tokens instead of 48k, D15)
 * Each frozen request is production's builder's output; how it differs is
 * the run's `differs` (count, max_tokens, no threads: the codes the phone
 * words). Members rate the answers blind (OD6: every kind here but part,
 * which only the owner rates); the $0 checks below and, for the questions,
 * a paid check by the solver sit beside the group's score, and the AI score
 * (judgeCall, off by default) is its own column (D13). Pure: ops/lab.ts
 * reads the material and runs the calls. */

export const RATED_ROUTES = ["practice", "set_write", "points", "cards", "ask", "part"] as const;
export type RatedRoute = (typeof RATED_ROUTES)[number];
export const isRatedRoute = (r: unknown): r is RatedRoute => typeof r === "string" && (RATED_ROUTES as readonly string[]).includes(r);
/** The kinds whose answers the solver checks after they are written (a paid check, `check`). */
export const CHECKED_ROUTES: ReadonlySet<string> = new Set(["practice", "set_write"]);

/** How each kind's frozen request differs from production (codes; the phone words them). */
export const RATED_DIFFERS: Readonly<Record<RatedRoute, string>> = {
  practice: "count",
  set_write: "count",
  points: "",
  cards: "count",
  ask: "no threads",
  part: "max_tokens",
};

export const RATED_NAMES: Readonly<Record<RatedRoute, string>> = {
  practice: "שאלות תרגול",
  set_write: "שאלות בסט חדש",
  points: "נקודות שצריך לדעת",
  cards: "כרטיסיות",
  ask: "לשאול",
  part: "סיכומים",
};

/** What a rated kind's $0 checks compare an answer with. */
export type RatedKey =
  | { route: "practice" | "set_write"; optionCount: number; from: number; to: number; slides: number[]; styles: string[] | null }
  | { route: "points"; part: number; from: number; to: number; slides: number[]; blocks: NumberedBlock[] }
  | { route: "cards"; from: number; to: number; slides: number[]; figures: string[]; blocks: NumberedBlock[] }
  | { route: "ask"; slides: number[] }
  | { route: "part"; from: number; to: number; slides: number[]; numbers: string[] };

type Rated = Omit<Frozen, "route" | "key"> & { route: RatedRoute; key: RatedKey };
type TextBlock = Anthropic.Beta.BetaTextBlockParam;
const schemaOf = (wrapper: z.ZodType) => cleanSchema(zodOutputFormat(wrapper as never).schema as Record<string, unknown>);
const slidesOf = (lecture: Pick<Lecture, "slides">) => lecture.slides.map((s) => s.n);

/** A lecture part as the comparison takes it (study_sections' row). */
export type LabPart = { idx: number; heading: string; from: number; to: number };

/** The practice-set generator's styles in a comparison (three plain styles, the exam's difficulty, no points). */
export const SET_STYLES: readonly Style[] = ["case", "mechanism", "compare"];
const SET_DIFFICULTY: Difficulty = "exam";

/** practice's and set_write's frozen request: questionsCall as op "questions"
 *  sends a batch (a release-1 round, or a set's batch with its styles), for
 *  LAB_PRACTICE_COUNT questions. */
export function practiceFrozen(
  route: "practice" | "set_write",
  lecture: Pick<Lecture, "id" | "title" | "lecturer" | "slides">,
  part: LabPart,
  inputs: { text: PartText; known: Known[]; style: StyleInput | null; corrections: Correction[] },
): Rated {
  const set = route === "set_write";
  const styles = set ? SET_STYLES.slice(0, LAB_PRACTICE_COUNT) : null;
  const call = questionsCall({
    lecture,
    effort: "high",
    claim: { part_idx: part.idx, heading: part.heading, slide_from: part.from, slide_to: part.to },
    want: LAB_PRACTICE_COUNT,
    optionCount: inputs.style?.optionCount ?? 5,
    known: inputs.known,
    style: inputs.style,
    corrections: inputs.corrections,
    part: inputs.text,
    extras: styles ? { styles, difficulty: SET_DIFFICULTY, points: [], focus: "" } : undefined,
    memberStyle: null,
    pictures: [],
  });
  return {
    v: 1,
    route,
    kind: "practice",
    system: call.system,
    messages: call.messages,
    effort: call.effort,
    maxTokens: call.maxTokens,
    format: { type: "json_schema", schema: call.schema },
    imageTokens: 0,
    material: { lecture: lecture.id, title: lecture.title, part: part.idx, heading: part.heading, slides: [part.from, part.to], count: LAB_PRACTICE_COUNT },
    key: { route, optionCount: inputs.style?.optionCount ?? 5, from: part.from, to: part.to, slides: slidesOf(lecture), styles: styles ? [...styles] : null },
  };
}

/** points' frozen request: the part's first piece, as op "points" sends it. */
export function pointsFrozen(lecture: Pick<Lecture, "id" | "title" | "slides">, part: ClaimedPart): Rated {
  const piece = pointPieces([part])[0];
  const call = pieceCall(piece);
  return {
    v: 1,
    route: "points",
    kind: "points",
    system: call.system,
    messages: [{ role: "user", content: [{ type: "text", text: call.user }] }],
    effort: POINTS_EFFORT,
    maxTokens: call.maxTokens,
    format: { type: "json_schema", schema: schemaOf(PointSet) },
    imageTokens: 0,
    material: { lecture: lecture.id, title: lecture.title, part: part.part_idx, heading: part.heading, slides: [part.slide_from, part.slide_to] },
    key: { route: "points", part: part.part_idx, from: part.slide_from, to: part.slide_to, slides: slidesOf(lecture), blocks: piece.blocks },
  };
}

/** cards' frozen request: cardsCall as op "cards" sends a batch, LAB_CARDS_COUNT cards. */
export function cardsFrozen(
  lecture: Lecture,
  part: LabPart,
  inputs: { figures: Figure[]; corrections: Correction[]; known: KnownCard[]; blocks: NumberedBlock[] },
): Rated {
  const call = cardsCall({ lecture, claim: { heading: part.heading, slide_from: part.from, slide_to: part.to }, figures: inputs.figures, corrections: inputs.corrections, known: inputs.known, blocks: inputs.blocks }, LAB_CARDS_COUNT);
  return {
    v: 1,
    route: "cards",
    kind: "cards",
    system: call.system,
    messages: call.messages,
    effort: "medium",
    maxTokens: call.maxTokens,
    format: { type: "json_schema", schema: schemaOf(CardSet) },
    imageTokens: 0,
    material: { lecture: lecture.id, title: lecture.title, part: part.idx, heading: part.heading, slides: [part.from, part.to], count: LAB_CARDS_COUNT },
    key: { route: "cards", from: part.from, to: part.to, slides: slidesOf(lecture), figures: inputs.figures.map((f) => f.id), blocks: inputs.blocks },
  };
}

/** "לשאול"'s frozen request: askSystem without the group's corrections and
 *  answered threads (OD9) and without a recording's notes, the summary as
 *  production sends it, the owner's question as the first turn. */
export function askFrozen(lecture: Pick<Lecture, "id" | "title" | "lecturer" | "slides">, summaryParts: string[], question: string): Rated {
  const system = askSystem(lecture, [], null, summaryBlock(summaryParts), null);
  const messages = askMessages([], askTurnText(question, null, false));
  return {
    v: 1,
    route: "ask",
    kind: "ask",
    system,
    messages,
    effort: ASK_EFFORT,
    maxTokens: ASK_MAX_TOKENS,
    cacheTail: true,
    imageTokens: 0,
    material: { lecture: lecture.id, title: lecture.title, question },
    key: { route: "ask", slides: slidesOf(lecture) },
  };
}

/** Numbers with a unit in a text (a dose, a percentage, a duration): what a summary should keep. */
const NUMBER = /\d+(?:[.,]\d+)?\s?(?:%|mg|mcg|μg|g|kg|ml|mL|L|mmHg|mEq|mmol|IU|U|h|min|ימים|שעות|שבועות|חודשים|שנים)(?![A-Za-z֐-׿])/g;
export function numbersOf(text: string): string[] {
  return [...new Set([...text.matchAll(NUMBER)].map((m) => m[0].replace(/\s/g, "").replace(",", ".")))].slice(0, 40);
}

/** A summary part's frozen request: partRequest as the writer sends it, with
 *  no corrections (a first write) and max_tokens LAB_PART_TOKENS (D15).
 *  `figures` carry their storage path as the url (study-path:…), signed per call. */
export function partFrozen(lecture: Lecture, sections: InputSection[], idx: number, figures: PartFigure[]): Rated {
  const r = partRequest({ lecture, sections, idx, figures, corrections: [] });
  const sec = sections.find((s) => s.idx === idx)!;
  const text = lecture.slides
    .filter((s) => s.n >= sec.slide_from && s.n <= sec.slide_to)
    .map((s) => [s.title, ...s.lines].join("\n"))
    .join("\n");
  return {
    v: 1,
    route: "part",
    kind: "part",
    system: r.request.system,
    messages: r.request.messages,
    effort: "high",
    maxTokens: LAB_PART_TOKENS,
    imageTokens: r.imageTokens,
    material: { lecture: lecture.id, title: lecture.title, part: idx, heading: sec.title, slides: [sec.slide_from, sec.slide_to] },
    key: { route: "part", from: sec.slide_from, to: sec.slide_to, slides: slidesOf(lecture), numbers: numbersOf(text) },
  };
}

/* ── The $0 checks of the rated kinds ── */

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const list = (doc: unknown, k: string): unknown[] => {
  const v = doc && typeof doc === "object" ? (doc as Record<string, unknown>)[k] : null;
  return Array.isArray(v) ? v : [];
};
/** A fixed order for the question check's option shuffle, so a check is repeatable. */
const still = () => 0.5;

/** The questions of an answer that pass checkQuestion, as SaveItems (the paid check's input). */
export function checkedQuestions(key: Extract<RatedKey, { route: "practice" | "set_write" }>, text: string) {
  const out = [];
  for (const raw of list(parse(text), "questions")) {
    const q = QuestionIn.safeParse(raw);
    if (!q.success) continue;
    const r = checkQuestion(q.data, {
      optionCount: key.optionCount,
      lectureSlides: new Set(key.slides),
      from: key.from,
      to: key.to,
      known: [],
      random: still,
      ...(key.styles ? { styles: key.styles as Style[] } : {}),
    });
    if (r.ok) out.push(r.item);
  }
  return out;
}

export type RatedChecks = { pass: boolean; items: number; match: number } & Record<string, unknown>;

/** The $0 checks of one answer of a rated kind (C29): how many of its items pass production's own checks. */
export function ratedChecks(key: RatedKey, text: string, complete: boolean): RatedChecks {
  switch (key.route) {
    case "practice":
    case "set_write": {
      const doc = parse(text);
      const n = list(doc, "questions").length;
      const ok = checkedQuestions(key, text).length;
      return { pass: doc !== null && complete && n > 0 && ok === n, items: n, match: ok, ok };
    }
    case "points": {
      const doc = parse(text);
      const parts = new Map([[key.part, { blocks: key.blocks }]]);
      const slides = new Set(key.slides);
      let ok = 0;
      let red = 0;
      const raw = list(doc, "points");
      for (const x of raw) {
        const p = PointItem.safeParse(x);
        if (!p.success) continue;
        const r = checkPoint(p.data, parts, slides);
        if (r.ok) {
          ok += 1;
          if (r.point.red_flag) red += 1;
        }
      }
      return { pass: doc !== null && complete && raw.length > 0 && ok === raw.length, items: raw.length, match: ok, ok, red };
    }
    case "cards": {
      const doc = parse(text);
      const raw = list(doc, "cards");
      let ok = 0;
      for (const x of raw) {
        const c = CardItem.safeParse(x);
        if (!c.success) continue;
        const r = checkCard(c.data, { lectureSlides: new Set(key.slides), from: key.from, to: key.to, figures: new Set(key.figures), known: [], blocks: key.blocks });
        if (r.ok) ok += 1;
      }
      return { pass: doc !== null && complete && raw.length > 0 && ok === raw.length, items: raw.length, match: ok, ok };
    }
    case "ask": {
      const tags = citedSlides(text);
      const bad = badTags(text, key.slides).length;
      const pass = complete && text.trim().length > 0 && tags.length > 0 && bad === 0;
      return { pass, items: 1, match: pass ? 1 : 0, tags: tags.length, bad };
    }
    case "part": {
      const tags = citedSlides(text);
      const inRange = tags.filter((n) => n >= key.from && n <= key.to).length;
      const bad = badTags(text, key.slides).length;
      const flat = text.replace(/\s/g, "").replace(/,/g, ".");
      const kept = key.numbers.filter((n) => flat.includes(n)).length;
      const words = text.split(/\s+/).filter(Boolean).length;
      return {
        pass: complete && words > 0 && bad === 0,
        items: key.to - key.from + 1,
        match: inRange,
        tags: tags.length,
        bad,
        numbers: kept,
        numbers_of: key.numbers.length,
        words,
      };
    }
  }
}

/* ── The paid check: the solver answers a practice answer's questions ── */

/** The solver's request over an answer's checked one-answer questions, and the items with their keys (null: nothing to check). */
export function practiceSolve(lecture: Pick<Lecture, "lecturer" | "slides">, key: Extract<RatedKey, { route: "practice" | "set_write" }>, text: string) {
  const items: SolverItem[] = checkedQuestions(key, text)
    .filter((q) => q.answer !== null)
    .map((q) => ({ vignette: q.vignette, question: q.question, options: q.options, answer: q.answer }));
  if (!items.length) return null;
  return { items, call: solverCall({ lecture, items }) };
}

/** The paid check's result, merged into the answer's checks: how many the solver answered as the answer's own key. */
export function solveChecks(items: readonly SolverItem[], solverText: string, complete: boolean): Record<string, number> {
  const answers: SolverAnswer[] = [];
  for (const a of list(parse(solverText), "answers")) {
    const r = SolverAnswerIn.safeParse(a);
    if (r.success) answers.push(r.data);
  }
  const v = verdictsOf(items, answers, complete);
  const judged = v.filter((x) => x !== null).length;
  const agrees = v.filter((x) => x?.ok).length;
  return { solved: judged, solver_agrees: agrees, solver_differs: judged - agrees };
}

/* ── The AI score (OD12): one call over every answer, under its label ── */

export const JudgeScore = z.object({
  label: z.string().describe("The answer's label exactly as given: א, ב, ג or ד"),
  overall: z.number().int().describe("1-5"),
  accuracy: z.number().int().describe("1-5"),
  hebrew: z.number().int().describe("1-5"),
  structure: z.number().int().describe("1-5"),
  errors: z.array(z.object({ quote: z.string(), why: z.string() })).describe("Every factual error; an empty array when none"),
});
export const JudgeOut = z.object({ outputs: z.array(JudgeScore) });
export type JudgeScore = z.infer<typeof JudgeScore>;
export const JUDGE_EFFORT: Effort = "medium";

/** What the judge is told each model was asked: the kind's request in short (never a key). */
export function askedOf(material: Record<string, unknown>): string {
  if (typeof material.question === "string") return `A student's question about the lecture: ${material.question}`;
  const heading = typeof material.heading === "string" ? material.heading : "";
  const slides = Array.isArray(material.slides) ? material.slides.join("-") : "";
  const count = typeof material.count === "number" ? `, ${material.count} items` : "";
  return `The lecture's part "${heading}" (slides ${slides})${count}.`;
}

/** The judge's request: the slides' text only (no pictures, also for a summary part), then the answers in `order`. */
export function judgeCall(o: { lecture: Pick<Lecture, "lecturer" | "slides">; route: string; material: Record<string, unknown>; answers: ReadonlyArray<{ label: string; text: string }> }): {
  system: TextBlock[];
  messages: Anthropic.Beta.BetaMessageParam[];
  maxTokens: number;
  effort: Effort;
  format: { type: "json_schema"; schema: Record<string, unknown> };
} {
  return {
    system: [
      { type: "text", text: LAB_JUDGE_SYSTEM },
      { type: "text", text: lectureBlock(o.lecture), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: judgeRequest({ kind: RATED_NAMES[o.route as RatedRoute] ?? o.route, asked: askedOf(o.material), answers: o.answers }) }],
    maxTokens: LAB_JUDGE_TOKENS + LAB_JUDGE_TOKENS_EACH * o.answers.length,
    effort: JUDGE_EFFORT,
    format: { type: "json_schema", schema: schemaOf(JudgeOut) },
  };
}

/** The judge's scores by label; an entry outside 1-5 or with a label not asked is left out. */
export function judgeScores(text: string, labels: readonly string[]): Map<string, Omit<JudgeScore, "label">> {
  const out = new Map<string, Omit<JudgeScore, "label">>();
  const r = JudgeOut.safeParse(parse(text));
  if (!r.success) return out;
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
  for (const s of r.data.outputs) {
    const label = s.label.trim();
    if (!labels.includes(label) || out.has(label) || ![s.overall, s.accuracy, s.hebrew, s.structure].every(ok)) continue;
    out.set(label, { overall: s.overall, accuracy: s.accuracy, hebrew: s.hebrew, structure: s.structure, errors: s.errors.slice(0, 10).map((e) => ({ quote: e.quote.slice(0, 200), why: e.why.slice(0, 300) })) });
  }
  return out;
}

/** The judge's worst case before a run: the slides, what was asked, and every
 *  answer at its whole max_tokens (2.5 characters a token), on `model`. */
export function judgeEstimate(f: Pick<Frozen, "material" | "maxTokens">, lecture: Pick<Lecture, "lecturer" | "slides">, n: number, model: string): number {
  const chars = LAB_JUDGE_SYSTEM.length + lectureBlock(lecture).length + askedOf(f.material).length + n * (f.maxTokens * 2.5 + 40);
  return estimateUsd(model, chars, LAB_JUDGE_TOKENS + LAB_JUDGE_TOKENS_EACH * n);
}

/** The paid check's worst case for one answer: the solver over the lecture and LAB_PRACTICE_COUNT questions of at most 2,500 characters. */
export function solveEstimate(lecture: Pick<Lecture, "lecturer" | "slides">, model: string): number {
  const items: SolverItem[] = Array.from({ length: LAB_PRACTICE_COUNT }, () => ({ vignette: "x".repeat(1500), question: "x".repeat(300), options: Array.from({ length: 5 }, () => "x".repeat(140)), answer: 0 }));
  const c = solverCall({ lecture, items });
  const chars = c.system.reduce((k, b) => k + b.text.length, 0) + c.messages.reduce((k, m) => k + (Array.isArray(m.content) ? m.content.reduce((j, b) => j + ("text" in b ? b.text.length : 0), 0) : 0), 0);
  return estimateUsd(model, chars, c.max_tokens);
}
