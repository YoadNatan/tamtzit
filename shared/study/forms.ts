/* ── Question types: the forms, the new styles and how a set answer scores ──
 *
 * docs/study/question-types.md. Two storage families: a one-answer question
 * (form "one", or "tap" for "באיזה מספר מסומן X?", answered with
 * study_answer_question) and a set question (tf, match, order: the key is
 * study_question_keys.seq, the answer study_answers.choices, answered with
 * study_answer_set). Old questions are all form "one". Used by the server
 * (op "questions"), the screens and the tests. Pure; imports end in ".js". */

import type { Box, FigureGeo } from "./figureGeo.js";
export type { Box, FigureGeo } from "./figureGeo.js";

export const FORMS = ["one", "tap", "tf", "match", "order"] as const;
export type Form = (typeof FORMS)[number];
/** The forms answered as a set (study_answer_set). */
export const SET_FORMS = ["tf", "match", "order"] as const;
export type SetForm = (typeof SET_FORMS)[number];
export const isSetForm = (f: string | null | undefined): f is SetForm => f === "tf" || f === "match" || f === "order";

/** The seven multiple-choice styles of practice 2.0. */
export const MCQ_STYLES = ["case", "mechanism", "drug_choice", "adverse_contra", "compare", "not_true", "blank_table"] as const;
/** The six question types added after them. */
export const NEW_STYLES = ["image", "label", "steps", "tf", "match", "order"] as const;
export type NewStyle = (typeof NEW_STYLES)[number];
export const isNewStyle = (s: string | null | undefined): s is NewStyle => !!s && (NEW_STYLES as readonly string[]).includes(s);

/** The forms each new style may be stored in (a label is "one" in name mode, "tap" in tap mode). */
export const STYLE_FORM: Record<NewStyle, readonly Form[]> = {
  image: ["one"],
  label: ["one", "tap"],
  steps: ["one"],
  tf: ["tf"],
  match: ["match"],
  order: ["order"],
};
/** The form a style's item must have (any older style: "one"). */
export const formsOf = (style: string): readonly Form[] => (isNewStyle(style) ? STYLE_FORM[style] : ["one"]);

/** How much one planned item of a style costs and weighs against a plain
 *  question (the estimate and the writer's token reservation): a label item
 *  skips the blind solver; a staged case is 2-3 solved questions. */
export const STYLE_WEIGHT: Record<string, number> = { label: 0.5, image: 1, tf: 1.2, match: 1, order: 1, steps: 2.5 };
export const styleWeight = (s: string): number => STYLE_WEIGHT[s] ?? 1;
/** Σ of the weights of planned items. */
export const weightOf = (styles: readonly string[]): number => styles.reduce((n, s) => n + styleWeight(s), 0);

/** "סוג שאלה" in a practice round (סבב חדש): each group and the styles it counts. */
export const TYPE_GROUPS: ReadonlyArray<{ key: string; he: string; styles: readonly string[] | null }> = [
  { key: "all", he: "הכול", styles: null },
  { key: "mcq", he: "אמריקאיות", styles: [...MCQ_STYLES, "other"] },
  { key: "picture", he: "שאלות על תמונה", styles: ["label", "image"] },
  { key: "steps", he: "מקרה בשלבים", styles: ["steps"] },
  { key: "tf", he: "נכון / לא נכון", styles: ["tf"] },
  { key: "match", he: "התאמה", styles: ["match"] },
  { key: "order", he: "סידור", styles: ["order"] },
];

// ── Layouts (study_questions.layout) ──

export type Pin = { n: number; x: number; y: number };
export type ImageLayout = { kind: "image"; fig: string; crop?: Box; masks?: Box[] };
export type LabelLayout = {
  kind: "label";
  mode: "name" | "tap";
  fig: string;
  stage: FigureGeo["stage"];
  img: Box;
  clip?: Box;
  lines: FigureGeo["lines"];
  baked: boolean;
  /** Numbered top to bottom, then right to left. Never a label's text. */
  pins: Pin[];
  /** Over every label's text (PDF, where it is in the pixels); [] for PPTX. */
  masks: Box[];
  /** Name mode: the pin asked about. */
  ask?: number;
  /** Tap mode: the labels without a pin, drawn as small grey dots. */
  dots?: Array<{ x: number; y: number }>;
};
export type MatchLayout = { kind: "match"; prompts: string[] };
export type StepsLayout = { kind: "steps"; of: 2 | 3; lead: number };
export type Layout = ImageLayout | LabelLayout | MatchLayout | StepsLayout;

// ── Scoring a set answer ──

/** A set answer against its key: how many elements are right, of how many,
 *  and whether all are (the only thing that counts as correct). `choices`
 *  null is "לא יודעים". tf: 1/0 per statement; match: the option placed at
 *  each prompt; order: the option at each position. */
export function scoreSet(form: SetForm, seq: readonly number[], choices: readonly number[] | null): { right: number; total: number; correct: boolean } {
  const total = seq.length;
  if (!choices || choices.length !== total) return { right: 0, total, correct: false };
  let right = 0;
  for (let i = 0; i < total; i++) if (choices[i] === seq[i]) right += 1;
  void form;
  return { right, total, correct: total > 0 && right === total };
}

/** Whether `choices` is a well-formed answer of this form for `n` options and
 *  `slots` places (the SQL's 'bad choices' rule). */
export function validChoices(form: SetForm, choices: readonly number[], n: number, slots: number): boolean {
  if (choices.length !== slots || !choices.every((c) => Number.isInteger(c))) return false;
  if (form === "tf") return choices.every((c) => c === 0 || c === 1);
  if (!choices.every((c) => c >= 0 && c < n)) return false;
  return new Set(choices).size === choices.length;
}

/** A showing's answer in the stored order. `order[shown] = stored index` (as
 *  practiceSession.showOrder). tf: the shown statements' marks put back on
 *  their stored statements; match and order: each shown option index made
 *  the stored one (the places, prompts and positions, never move). */
export function toStoredSet(form: SetForm, order: readonly number[], shown: readonly number[]): number[] {
  if (form === "tf") {
    const out = new Array<number>(shown.length).fill(0);
    shown.forEach((v, s) => (out[order[s] ?? s] = v));
    return out;
  }
  return shown.map((v) => order[v] ?? v);
}

/** The key (or an answer) in a showing's order: the inverse of toStoredSet. */
export function toShownSet(form: SetForm, order: readonly number[], stored: readonly number[]): number[] {
  if (form === "tf") return order.map((i, s) => stored[i] ?? stored[s]);
  return stored.map((v) => {
    const at = order.indexOf(v);
    return at < 0 ? v : at;
  });
}

// ── Which types a part can have, and the defaults ──

/** What a part (or the chosen parts) offers the types. */
export type PartFacts = {
  /** Its slides have a table (a blank table needs one). */
  tables: boolean;
  /** Pictures with a caption in the part's summary ("fig:N-K"). */
  figures: number;
  /** Pictures with label geometry. */
  labelled: number;
  /** Its points to know by kind. */
  points: Partial<Record<string, number>>;
};
export const emptyFacts = (): PartFacts => ({ tables: false, figures: 0, labelled: 0, points: {} });
export const pointsIn = (f: PartFacts) => Object.values(f.points).reduce<number>((n, x) => n + (x ?? 0), 0);
export function addFacts(a: PartFacts, b: PartFacts): PartFacts {
  const points: Record<string, number> = { ...(a.points as Record<string, number>) };
  for (const [k, v] of Object.entries(b.points)) points[k] = (points[k] ?? 0) + (v ?? 0);
  return { tables: a.tables || b.tables, figures: a.figures + b.figures, labelled: a.labelled + b.labelled, points };
}

/** Whether a part can have a question of this style. */
export function canStyle(style: string, f: PartFacts): boolean {
  switch (style) {
    case "blank_table":
      return f.tables;
    case "label":
      return f.labelled > 0;
    case "image":
      return f.figures > 0;
    case "steps":
    case "match":
    case "order":
      return pointsIn(f) >= 3;
    default:
      return true;
  }
}

const PHARM = ["drug", "mechanism", "indication", "adverse", "contra"];
export const DEFAULT_MAX = 6;

/** The types "שאלות חדשות" checks first for these facts: always a case and
 *  נכון / לא נכון; a pharmacology lecture (half its points or more are drugs,
 *  mechanisms, indications, adverse effects or contraindications) adds
 *  mechanism, drug choice and adverse effects, any other adds התאמה and
 *  סידור; then סימון על תמונה when a picture has labels, שאלה על תמונה with
 *  two captioned pictures, a staged case with 12 points or more. At most 6. */
export function defaultStylesFor(f: PartFacts): string[] {
  const total = pointsIn(f);
  const pharm = PHARM.reduce((n, k) => n + (f.points[k] ?? 0), 0);
  const out = ["case", "tf"];
  if (total > 0 && pharm * 2 >= total) out.push("mechanism", "drug_choice", "adverse_contra");
  else out.push("match", "order");
  if (f.labelled >= 1) out.push("label");
  if (f.figures >= 2) out.push("image");
  if (total >= 12) out.push("steps");
  return out.slice(0, DEFAULT_MAX);
}
