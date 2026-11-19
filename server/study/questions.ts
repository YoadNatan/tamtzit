import { z } from "zod/v4";
import type { NumberedBlock } from "../../shared/study/blocks.js";
import type { Box, FigureGeo } from "../../shared/study/figureGeo.js";
import { isLabelText, normLabel, relTo, roundBox } from "../../shared/study/figureGeo.js";
import { type Form, isNewStyle, type Layout } from "../../shared/study/forms.js";
import { type DraftOnLine, STYLES, type Style } from "../../shared/study/practice2.js";
import { buildLabelItem, labelIndex, modeFor, pageCrop } from "./labels.js";
import { normalize, similarity } from "./similar.js";
import { tidyMarkdown } from "./study.js";

/* ── Practice questions: the format, the checks no schema can express, option
 * order and duplicates (spec §4.6; design-questions §3.4-§3.6; §12.3.Q) ──
 *
 * Pure functions, no network: they run the same in the op (practice.ts), in
 * section B's batch (which imports them, §12.1.2) and in the offline tests
 * (questions.test.ts). Ported from the design's tested prototype;
 * `similarity` and `normalize` come from similar.ts and `cleanSchema` from
 * claude.ts. Q's end (§12.3.Q) adds the paragraph that answers a question
 * (`para`, placed by similarity when the model's number is not one of the
 * part's), the teaser for the meeting's opening, "מתי כן" and the drug or
 * organism of each option (`when`, `tag`), and the slide's diagram
 * (`figure`). Practice 2.0 adds each question's style and the points to
 * know it tests (`style`, `points`), the checks of the styles that have a
 * form of their own (a case, a blank table, "what is not true"), and the
 * public line of a draft (toDraftPublic). */

/** What a question tests: the keys the SQL allows in study_questions.aspect
 *  (section Q), so weak points add up across lectures. The Hebrew labels are
 *  the app's (shared/study/aspects.ts, F1); the server needs only the keys. */
export const ASPECT_KEYS = [
  "mechanism",
  "uses",
  "pk",
  "adverse",
  "contra",
  "interactions",
  "resistance",
  "dosing",
  "classification",
  "epidemiology",
  "lifecycle",
  "pathogenesis",
  "clinical",
  "diagnosis",
  "treatment",
  "prevention",
  "anatomy",
  "histology",
  "physiology",
  "imaging",
  "other",
] as const;
export type Aspect = (typeof ASPECT_KEYS)[number];

/* Every field required; no nullable fields, unions or enums (SDK 1.3.0 moves
 * `enum` into the description, so the API would not enforce it anyway); no
 * field that asks for reasoning (reasoning_extraction refusals). Counts are
 * checked in code: the API supports minItems 0 or 1 only. */
/** An option's fields (a function: the stages reuse them, and one shared
 *  instance would make the JSON schema a $ref, which the sent schema avoids). */
const qOption = () =>
  z.object({
  text: z
    .string()
    .describe(
      "The option in Hebrew, English names as the lecture writes them; the same kind of thing as the other options, parallel in form and close in length; no letter or number in front",
    ),
  correct: z
    .boolean()
    .describe("true for the one best answer only; for a true/false question (tf) true for each true statement; for an order question true for every step"),
  why: z
    .string()
    .describe(
      "One or two Hebrew sentences from the slides: why this option is the answer, or why it is wrong for this question; ends with a slide tag such as [ש' 12]",
    ),
  when: z
    .string()
    .describe(
      "For a wrong option: one short Hebrew line beginning 'מתי כן:' saying when this option would be the answer according to this lecture; an empty string when the lecture gives no such case, and for the correct option",
    ),
  tag: z.string().describe("The drug, organism, stage or test this option names, in English exactly as the lecture writes it; an empty string when it names none"),
  left: z.string().describe("For a match question: the prompt this option answers (the drug, structure or finding it is matched to); an empty string otherwise and for a match's one extra option"),
});
export const QOption = qOption();
/** A staged case's later step (steps 2 and 3): what is new in the case, its question, its options, and its answer as a fact of the case. */
export const QStage = z.object({
  update: z.string().describe("One or two Hebrew sentences: what happens next in the case (a result, a change), without the answer to this step"),
  question: z.string().describe("The step's lead-in: one Hebrew question ending with '?'"),
  options: z.array(qOption()).describe("Exactly the number of options the request asks for, exactly one correct"),
  resolved: z.string().describe("One Hebrew sentence stating this step's answer as a fact of the case, as the next step will read it"),
});
export const Question = z.object({
  topic: z.string().describe("The drug, organism, disease or process tested, in English exactly as the lecture writes it"),
  aspect: z
    .string()
    .describe(
      "One key: mechanism, uses, pk, adverse, contra, interactions, resistance, dosing, classification, epidemiology, lifecycle, pathogenesis, clinical, diagnosis, treatment, prevention, anatomy, histology, physiology, imaging, other",
    ),
  style: z
    .string()
    .describe(
      "One key: case, mechanism, drug_choice, adverse_contra, compare, not_true, blank_table, image, label, steps, tf, match, order; one the request assigns, when it assigns styles",
    ),
  points: z
    .array(z.number().int())
    .describe("The numbers of the request's points to know that the question tests, its main point first; an empty array when the request lists none"),
  takeaway: z.string().describe("One Hebrew sentence: the fact from the slides that this question tests, ending with its slide tag"),
  difficulty: z
    .number()
    .int()
    .describe("1 recall of one fact; 2 understanding that connects two facts; 3 application in a case that needs two steps"),
  case: z.boolean().describe("true for a clinical case with a patient story, false for a direct question"),
  vignette: z
    .string()
    .describe(
      "For a case: the patient story (age and sex, setting, complaint and duration, history, findings, test results). For a direct question: an empty string",
    ),
  question: z
    .string()
    .describe("The lead-in: one complete Hebrew question that ends with '?' and can be answered before reading the options"),
  options: z.array(QOption).describe("Exactly the number of options the request asks for, exactly one of them correct"),
  para: z.number().int().describe("The number of the paragraph (¶) of the part shown in the request whose text answers the question; never 0"),
  teaser: z
    .string()
    .describe("One Hebrew line of at most 70 characters that names the drug or organism and hints at the situation without giving the answer, or an empty string"),
  figure: z
    .string()
    .describe("A picture id from the request's list (fig:20-1) when the question asks about what that picture shows and its labels do not give the answer away, or an empty string"),
  slides: z.array(z.number().int()).describe("Every slide number the question, its answer and its explanations rely on"),
  resolved: z.string().describe("For a staged case (steps): one Hebrew sentence stating step 1's answer as a fact of the case; an empty string otherwise"),
  stages: z.array(QStage).describe("For a staged case (steps): its steps 2 and 3 (one or two); an empty array otherwise"),
});
export const QuestionSet = z.object({ questions: z.array(Question) });
export type Question = z.infer<typeof Question>;

/** What the op reads back: the schema sent (every field required, so the
 *  model always writes them), with the question types' fields defaulted
 *  when absent (a reply from before them, a replayed test stream). */
const QOptionIn = QOption.extend({ left: z.string().default("") });
const QStageIn = QStage.extend({ options: z.array(QOptionIn) });
export const QuestionIn = Question.extend({
  options: z.array(QOptionIn),
  resolved: z.string().default(""),
  stages: z.array(QStageIn).default([]),
});

/** What study_save_question() receives as p_q (plus `model`): Q's end adds
 *  the paragraph (`para`, null when it could not be placed, with its first
 *  words as `quote`), the teaser, the diagram, and per option "מתי כן"
 *  (`whens`, '' for the key) and its drug or organism (`option_tags`), all in
 *  the stored order. */
export type SaveItem = {
  kind: "mcq" | "case";
  difficulty: 1 | 2 | 3;
  vignette: string;
  question: string;
  options: string[];
  /** null for a set question (tf, match, order): its key is `seq`. */
  answer: number | null;
  explanations: string[];
  takeaway: string;
  slides: number[];
  topic: string;
  aspect: Aspect;
  para: number | null;
  quote: string;
  teaser: string;
  figure: string;
  whens: string[];
  option_tags: string[];
  /** Practice 2.0: its style (null: none of the seven), and the points to
   *  know it tests as numbers in the request's list (1-based; the op maps
   *  them to the points' ids). */
  style: Style | null;
  points: number[];
  /** Question types (docs/study/question-types.md): the form ("one" for
   *  every plain question), what the screen draws, a set question's key
   *  (tf 1/0 per statement; match the option of each prompt; order the
   *  option at each position), a staged case's series and step. */
  form: Form;
  layout: Layout | null;
  seq: number[] | null;
  series: string | null;
  step: number | null;
};
/** A question that passed checkQuestion, as the blind solver and the save
 *  take it (§12.3.Q: CheckedQuestion). */
export type CheckedQuestion = SaveItem;

/** A question already in the lecture: its public text only (the op runs as a
 *  member and never reads keys). `part_idx` and `slides` place it in a part
 *  for the "already asked" list. */
export type Known = {
  id: string;
  vignette: string;
  question: string;
  options: string[];
  topic: string;
  aspect: string;
  part_idx?: number | null;
  slides?: number[];
};

export type Ctx = {
  optionCount: number;
  lectureSlides: ReadonlySet<number>;
  from: number;
  to: number;
  known: Known[];
  /** Randomness for the option order; crypto in production, seeded in tests. */
  random?: () => number;
  /** The part's blocks as numberBlocks() numbers them (¶0 the heading), when
   *  the request showed them; none: no paragraph is placed. */
  blocks?: readonly NumberedBlock[];
  /** The picture ids the request offered ("fig:20-1"). */
  figures?: ReadonlySet<string>;
  /** The lecture's text in lower case (deckText()): an option's tag must be
   *  a word of the lecture. Without it, tags are dropped. */
  lectureText?: string;
  /** Practice 2.0: the styles this batch may write (a question in another
   *  style is mapped to one of them); none: any of the seven, or none. */
  styles?: readonly Style[];
  /** The points to know the request lists (their text, for placing a
   *  question whose "points" name none of them). */
  points?: readonly { text: string }[];
  /** Question types: the part's pictures with label geometry (by id). */
  labelled?: ReadonlyMap<string, { geo: FigureGeo }>;
  /** The lecture's text of each slide, lower case (an image item on a PDF page must not show its answer printed). */
  slideText?: ReadonlyMap<number, string>;
  /** The lecture is a PDF (each picture is its whole page). */
  pdf?: boolean;
  /** A PPTX picture's visible frame (the lecturer's crop), 0..1 of the stored, uncropped picture, by figure id. */
  crops?: ReadonlyMap<string, Box>;
  /** How many label items this batch made before this one (name and tap alternate). */
  labelIndex?: number;
  /** A staged case's series id (tests pass a fixed one). */
  newSeries?: () => string;
};

/** `more`: a staged case's later steps, saved after `item` with its series. */
export type Checked = { ok: true; item: SaveItem; warnings: string[]; more?: SaveItem[] } | { ok: false; reasons: string[] };

/* ── Text helpers ── */

/** tidyMarkdown() (hyphen ranges, no direction marks), then one line. */
export function tidy(s: string): string {
  return tidyMarkdown(s).replace(/\s+/g, " ").trim();
}

const TAG_SOURCE = String.raw`\[ש['׳]\s?(\d+(?:\s?-\s?\d+)?(?:\s?,\s?\d+(?:\s?-\s?\d+)?)*)\]`;
/** One slide tag, as the summaries write it: [ש' 5], [ש׳ 3-4, 9]. */
const TAG_ONE = new RegExp(TAG_SOURCE);

/** Slide numbers named by the [ש' n] tags in a text (ranges expanded). */
export function tagSlides(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(new RegExp(TAG_SOURCE, "g"))) {
    for (const part of m[1].split(",")) {
      const [a, b] = part.split("-").map((x) => Number(x.trim()));
      if (b === undefined) out.push(a);
      else for (let n = a; n <= b && n - a < 60; n++) out.push(n);
    }
  }
  return out;
}

const HEBREW = /[א-ת]/;
/** A Hebrew letter in front of an option ("א. ", "ב) "): never the start of a
 *  real option, so it is always removed. */
const HEBREW_LABEL = /^\s*[א-ו]\s*[.)]\s+/;
/** A Latin letter or a digit in front ("A. ", "b) ", "3. "). Removed only when
 *  every option carries the label of its own place (A, B, C… or 1, 2, 3…), so
 *  an organism such as "E. histolytica" or "C. albicans" keeps its genus. */
const LATIN_LABEL = /^\s*([A-Fa-f1-6])\s*[.)]\s+/;
const LABEL_ORDER = ["ABCDEF", "abcdef", "123456"];

function stripLabels(texts: string[]): string[] {
  const latin = texts.map((t) => LATIN_LABEL.exec(t)?.[1] ?? "");
  const inOrder = texts.length > 1 && LABEL_ORDER.some((seq) => latin.every((l, i) => l === seq[i]));
  return texts.map((t) => (inOrder ? t.replace(LATIN_LABEL, "") : t).replace(HEBREW_LABEL, ""));
}

/** Options that point at other options, or at everything. */
const BANNED_OPTION =
  /(כל\s+(ה)?תשובות|אף\s+(אחת\s+)?(מה)?תשובות|אף\s+תשובה|כל\s+הנ["״]ל|אף\s+אחד\s+מהנ["״]ל|תשובות?\s+[א-ה]\s*(ו-?|\+)\s*[א-ה]|all of the above|none of the above|both [a-e] and [a-e])/i;
/** Negative lead-ins; allowed only when the negative word is bold. */
const NEGATIVE =
  /(?<!\*\*)(?:\b(EXCEPT|NOT)\b|(?<![א-ת])(אינו|אינה|אינם|אינן|איננה|איננו|למעט|לא נכון|לא נכונה|חוץ מ)(?![א-ת]))(?!\*\*)/;
/** A "why" that names another option by its letter ("תשובה ב", "אפשרות ג").
 *  Practice sessions show the options in a fresh order (review UX-2), so the
 *  letter would point at the wrong option. The spec writes /תשובה [א-ה]\b/,
 *  but JavaScript's \b never matches after a Hebrew letter, so the end of
 *  the letter is "no Hebrew letter follows". */
const OPTION_BY_LETTER = /(?:תשובה|אפשרות)\s+[א-ו](?![א-ת])/;

/** A teaser that tells the reader what to do instead of hinting (imperative
 *  openings, any gender or number, and "אל ת…"). */
const IMPERATIVE = /^\s*(?:אל\s+ת|(?:זכור|זכרי|זכרו|שים|שימי|שימו|בחר|בחרי|בחרו|חשוב|חשבי|חשבו|דע|דעי|דעו|היזהר|היזהרי|היזהרו|הקפד|הקפידי|הקפידו|נסה|נסי|נסו|תן|תני|תנו|קח|קחי|קחו|בדוק|בדקי|בדקו|ענה|עני|ענו|שאל|שאלי|שאלו|קרא|קראי|קראו|הימנע|הימנעי|הימנעו)(?![א-ת]))/;
/** "מתי כן" opens every kept `when` line. */
const WHEN_OPENING = "מתי כן:";
const WHEN_MAX = 120;
const TEASER_MAX = 120;
const TAG_MAX = 80;
/** The paragraph a question falls back to needs at least this similarity. */
const PARA_MIN = 0.2;

/** The paragraph that answers a question: the model's number when it is one
 *  of the part's blocks after the heading; else the block whose text is most
 *  similar to the stem and the key's explanation, when that is at least 0.2
 *  and no other block ties it; else null (a good question is kept unplaced). */
export function placePara(para: number, blocks: readonly NumberedBlock[], text: string): number | null {
  const body = blocks.filter((b) => b.n >= 1);
  if (Number.isInteger(para) && body.some((b) => b.n === para)) return para;
  let best: NumberedBlock | null = null;
  let bestScore = -1;
  let tie = false;
  for (const b of body) {
    const score = similarity(text, b.text);
    if (score > bestScore + 1e-12) {
      best = b;
      bestScore = score;
      tie = false;
    } else if (Math.abs(score - bestScore) <= 1e-12) tie = true;
  }
  return best && bestScore >= PARA_MIN && !tie ? best.n : null;
}

/** The teaser, or '' when it is long, contains the answer, or starts with an imperative. */
export function cleanTeaser(teaser: string, keyText: string): string {
  const t = tidy(teaser);
  if (!t || t.length > TEASER_MAX || IMPERATIVE.test(t)) return "";
  const key = normalize(keyText);
  return key && normalize(t).includes(key) ? "" : t;
}

/** "מתי כן" of one option: '' for the key, and '' unless it opens with
 *  "מתי כן:", is at most 120 characters, names no slide outside a tag and
 *  tags only real slides. */
export function cleanWhen(when: string, isKey: boolean, lectureSlides: ReadonlySet<number>): string {
  if (isKey) return "";
  const t = tidy(when);
  if (!t.startsWith(WHEN_OPENING) || t.length > WHEN_MAX) return "";
  if (/שקף\s*\d/.test(t.replace(new RegExp(TAG_SOURCE, "g"), ""))) return "";
  return tagSlides(t).every((n) => lectureSlides.has(n)) ? t : "";
}

/** An option's drug or organism, or '' when it is long or not a word of the lecture. */
export function cleanTag(tag: string, lectureText: string | undefined): string {
  const t = tidy(tag);
  if (!t || t.length > TAG_MAX || !lectureText) return "";
  return lectureText.includes(t.toLowerCase()) ? t : "";
}

const DUP_STEM = 0.6;
const DUP_OPTIONS = 0.8;

/** The existing question this one repeats, if any: nearly the same story and
 *  lead-in, or the same topic and aspect with (nearly) the same options. Only
 *  public text is compared: the op never reads other questions' keys. */
export function duplicateOf(
  q: { vignette: string; question: string; options: string[]; topic: string; aspect: string },
  known: Known[],
): Known | null {
  const stem = `${q.vignette} ${q.question}`;
  const opts = new Set(q.options.map(normalize));
  for (const k of known) {
    if (similarity(stem, `${k.vignette} ${k.question}`) >= DUP_STEM) return k;
    const shared = k.options.map(normalize).filter((o) => opts.has(o)).length;
    const samePoint = normalize(k.topic) === normalize(q.topic) && k.aspect === q.aspect;
    if (samePoint && shared / Math.max(opts.size, k.options.length) >= DUP_OPTIONS) return k;
  }
  return null;
}

/** An option that is a number with at most a short unit ("48 שעות"), else null. */
export function numericValue(s: string): number | null {
  const m = /^[^\dא-ת]{0,3}(\d+(?:[.,]\d+)?)/.exec(s);
  if (!m) return null;
  const rest = s.slice(m[0].length);
  if (rest.replace(/[\s\d.,%/×x\-–~≈<>≤≥()]/g, "").length > 14) return null;
  return Number(m[1].replace(",", "."));
}

/** Numbers sort ascending (a logical order); anything else is shuffled. */
export function orderOptions<T>(items: T[], text: (t: T) => string, random: () => number): T[] {
  const nums = items.map((t) => numericValue(text(t)));
  if (nums.every((n) => n !== null)) {
    return items
      .map((t, i) => ({ t, n: nums[i] as number }))
      .sort((a, b) => a.n - b.n)
      .map((x) => x.t);
  }
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cryptoRandom(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 2 ** 32;
}

/** Every check the schema cannot make (design-questions §3.5). Hard failures
 *  reject the item; fixes are applied silently; warnings are counted on the
 *  part (the op logs them, for calibrating the prompt). Question types
 *  (docs/study/question-types.md) dispatch by style: a picture (image), a
 *  label (label), a staged case (steps), true/false (tf), match and order
 *  each have their checker; every other style is a plain question. A
 *  release-1 round (no ctx.styles) takes none of the six. */
export function checkQuestion(q: Question, ctx: Ctx): Checked {
  const named = q.style.trim().toLowerCase();
  if (!ctx.styles?.length) {
    if (isNewStyle(named)) return { ok: false, reasons: ["style not allowed here"] };
    return checkOne(q, ctx);
  }
  const warnings: string[] = [];
  const style = styleOf(q, ctx, warnings);
  const withWarnings = (r: Checked): Checked => (r.ok ? { ...r, warnings: [...warnings.filter((w) => !r.warnings.includes(w)), ...r.warnings] } : r);
  switch (style) {
    case "image":
      return withWarnings(checkImage(q, ctx));
    case "label":
      return withWarnings(checkLabel(q, ctx));
    case "tf":
      return withWarnings(checkTf(q, ctx));
    case "match":
      return withWarnings(checkMatch(q, ctx));
    case "order":
      return withWarnings(checkOrder(q, ctx));
    case "steps":
      return withWarnings(checkSteps(q, ctx));
    default:
      return checkOne(q, ctx);
  }
}

/** A plain one-answer question (the seven styles, and each step of a staged case, an image item before its picture checks). */
export function checkOne(q: Question, ctx: Ctx, styleWanted?: Style): Checked {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const texts = stripLabels(q.options.map((o) => tidy(o.text)));
  const options = q.options.map((o, i) => ({
    text: texts[i],
    correct: o.correct,
    why: tidy(o.why),
    when: cleanWhen(o.when, o.correct, ctx.lectureSlides),
    tag: cleanTag(o.tag, ctx.lectureText),
  }));
  let question = tidy(q.question);
  const style = styleWanted ?? styleOf(q, ctx, warnings);
  // A blank table keeps its rows, one a line; any other vignette is one line.
  const vignette = style === "blank_table" ? tidyLines(q.vignette) : tidy(q.vignette);
  const takeaway = tidy(q.takeaway);

  if (options.length !== ctx.optionCount) reasons.push(`options ${options.length}, not ${ctx.optionCount}`);
  const right = options.filter((o) => o.correct).length;
  if (right !== 1) reasons.push(`${right} correct options`);
  if (options.some((o) => !o.text || o.text.length > 220)) reasons.push("option text empty or long");
  if (options.some((o) => !o.why || o.why.length > 450)) reasons.push("explanation empty or long");
  if (new Set(options.map((o) => normalize(o.text))).size !== options.length) reasons.push("two options say the same");
  if (options.some((o) => BANNED_OPTION.test(o.text))) reasons.push("all/none of the above");
  if (!question.endsWith("?")) reasons.push("lead-in is not a question");
  if (question.length < 8 || question.length > 400 || !HEBREW.test(question)) reasons.push("lead-in length or language");
  if (NEGATIVE.test(question)) {
    // Bold the negative word deterministically rather than drop a good item.
    question = question.replace(NEGATIVE, (w) => `**${w}**`);
    warnings.push("negative lead-in bolded");
  }
  if (q.case && vignette.length < 60) reasons.push("case without a vignette");
  if (!q.case && vignette.length > (style === "blank_table" ? BLANK_TABLE_MAX : 300)) reasons.push("direct question with a long story");
  if (style === "case" && !q.case) reasons.push("case style without a case");
  if (style === "blank_table" && (!vignette.includes(BLANK) || vignette.split("\n").filter((l) => l.trim().startsWith("|")).length < 2)) {
    reasons.push("blank table without a table");
  }
  if (style === "not_true" && !/\*\*/.test(question)) warnings.push("not_true without a negative lead-in");
  if (!takeaway) reasons.push("no takeaway");

  // Slides: listed ones exist; at least one in the part; every tag names a real slide.
  const slides = [...new Set(q.slides)].sort((a, b) => a - b);
  if (!slides.length) reasons.push("no slides");
  if (slides.some((n) => !ctx.lectureSlides.has(n))) reasons.push("unknown slide");
  if (!slides.some((n) => n >= ctx.from && n <= ctx.to)) reasons.push("outside the part");
  const tagged = [vignette, question, takeaway, ...options.map((o) => o.why)];
  if (tagged.flatMap(tagSlides).some((n) => !ctx.lectureSlides.has(n))) reasons.push("tag names an unknown slide");
  const key = options.find((o) => o.correct);
  if (key && !tagSlides(key.why).length) reasons.push("the answer's explanation has no tag");
  if (!tagSlides(takeaway).length) warnings.push("takeaway without a tag");
  if (options.some((o) => !o.correct && !tagSlides(o.why).length)) warnings.push("a distractor's explanation without a tag");
  if (options.some((o) => TAG_ONE.test(o.text) || /שקף\s*\d/.test(o.text))) warnings.push("slide number inside an option");
  if (options.some((o) => OPTION_BY_LETTER.test(o.why))) warnings.push("an explanation names an option by its letter");
  if (q.options.some((o, i) => tidy(o.when) && !options[i].when && !o.correct)) warnings.push("a when dropped");
  if (q.options.some((o, i) => tidy(o.tag) && !options[i].tag)) warnings.push("a tag dropped");

  // Cues (warnings only; the quality rubric judges them).
  if (key && options.length > 1) {
    const others = options.filter((o) => !o.correct).map((o) => o.text.length);
    if (key.text.length > 1.75 * Math.max(...others) && key.text.length > 30) warnings.push("the answer is much the longest option");
  }

  const aspect = ASPECT_KEYS.find((k) => k === q.aspect.trim().toLowerCase());
  if (!aspect) warnings.push(`aspect "${q.aspect}" mapped to other`);
  const difficulty = Math.min(3, Math.max(1, Math.round(q.difficulty))) as 1 | 2 | 3;
  if (difficulty !== q.difficulty) warnings.push("difficulty clamped");

  if (!reasons.length) {
    const dup = duplicateOf({ vignette, question, options: options.map((o) => o.text), topic: q.topic, aspect: aspect ?? "other" }, ctx.known);
    if (dup) reasons.push(`duplicate of ${dup.id}`);
  }
  if (reasons.length) return { ok: false, reasons };

  // The paragraph (placed by similarity when the model's number is not one of the part's), the teaser, the diagram.
  const blocks = ctx.blocks ?? [];
  const para = blocks.length ? placePara(q.para, blocks, `${vignette} ${question} ${key?.why ?? ""}`) : null;
  if (blocks.length && para !== q.para) warnings.push(para === null ? "paragraph not placed" : "paragraph placed by similarity");
  const block = para === null ? undefined : blocks.find((b) => b.n === para);
  const teaser = cleanTeaser(q.teaser, key?.text ?? "");
  if (tidy(q.teaser) && !teaser) warnings.push("teaser dropped");
  const figure = ctx.figures?.has(tidy(q.figure)) ? tidy(q.figure) : "";
  if (tidy(q.figure) && !figure) warnings.push("figure dropped");
  const points = pointsOf(q, `${takeaway} ${question}`, ctx, warnings);

  const ordered = orderOptions(options, (o) => o.text, ctx.random ?? cryptoRandom);
  return {
    ok: true,
    warnings,
    item: {
      kind: q.case ? "case" : "mcq",
      difficulty,
      vignette: q.case || style === "blank_table" ? vignette : "",
      question,
      options: ordered.map((o) => o.text),
      answer: ordered.findIndex((o) => o.correct),
      explanations: ordered.map((o) => o.why),
      takeaway,
      slides,
      topic: tidy(q.topic).slice(0, 120),
      aspect: aspect ?? "other",
      para,
      quote: block ? block.text.slice(0, 80) : "",
      teaser,
      figure,
      whens: ordered.map((o) => o.when),
      option_tags: ordered.map((o) => o.tag),
      style,
      points,
      form: "one",
      layout: null,
      seq: null,
      series: null,
      step: null,
    },
  };
}

/** The blank cell of a blank table, and the longest table a vignette holds. */
const BLANK = "___";
const BLANK_TABLE_MAX = 1200;

/** tidy() line by line: a table's rows stay on lines of their own. */
function tidyLines(s: string): string {
  return tidyMarkdown(s)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** A question's style: its own key when this batch may write it; else, in a
 *  practice 2.0 batch, a case to "case" or the batch's first style (a
 *  warning); else (a release-1 round) none when the key is not one of the
 *  seven. */
function styleOf(q: Question, ctx: Ctx, warnings: string[]): Style | null {
  const named = STYLES.find((s) => s === q.style.trim().toLowerCase()) ?? null;
  const allowed = ctx.styles?.length ? ctx.styles : null;
  if (!allowed) {
    if (!named && q.style.trim()) warnings.push(`style "${q.style}" dropped`);
    return named;
  }
  if (named && allowed.includes(named)) return named;
  warnings.push(`style "${q.style}" mapped`);
  return q.case && allowed.includes("case") ? "case" : (allowed.find((s) => s !== "case" && s !== "blank_table") ?? allowed[0]);
}

/** The points to know a question tests, as numbers of the request's list:
 *  its own (1 to the list's length, at most 3, the main one first); when it
 *  names none of them, the point most like its takeaway and lead-in (at
 *  least 0.12 similar); else none (a warning). */
const POINT_MIN = 0.12;
function pointsOf(q: Question, text: string, ctx: Ctx, warnings: string[]): number[] {
  const list = ctx.points ?? [];
  if (!list.length) return [];
  const own = [...new Set(q.points.filter((n) => Number.isInteger(n) && n >= 1 && n <= list.length))].slice(0, 3);
  if (own.length) return own;
  let best = -1;
  let score = POINT_MIN;
  list.forEach((p, i) => {
    const sc = similarity(text, p.text);
    if (sc >= score) {
      best = i;
      score = sc;
    }
  });
  warnings.push(best >= 0 ? "point placed by similarity" : "no point");
  return best >= 0 ? [best + 1] : [];
}

/** How many of a part's questions are asked as clinical cases (about 40%). */
export function casesFor(count: number): number {
  return count <= 1 ? 0 : Math.round(count * 0.4);
}

/* ── Past exams (Q-2: exams.ts reads and explains them with these) ── */
export const ExamItem = z.object({
  no: z.number().int().describe("The question's number in the exam"),
  case: z.boolean().describe("true when the question has a patient story"),
  vignette: z.string().describe("The patient story as printed, or an empty string"),
  question: z.string().describe("The question as printed"),
  options: z.array(z.string()).describe("Every option in order, as printed, without its letter or number"),
  answer: z.number().int().describe("0-based index of the option the exam marks as correct, or -1 when the pages do not mark one"),
  complete: z.boolean().describe("false when the question's options run past the pages given"),
  lecture: z.number().int().describe("The number of the lecture in the given list that covers the question, or -1"),
  topic: z.string().describe("The drug, organism, disease or process it is about, in English as printed"),
});
export const ExamItems = z.object({ questions: z.array(ExamItem) });
export type ExamItem = z.infer<typeof ExamItem>;

export const Explained = z.object({
  no: z.number().int().describe("The question number given"),
  covered: z.boolean().describe("false when the slides do not deal with the question's subject at all"),
  conflict: z.boolean().describe("true when the slides seem to disagree with the exam's answer"),
  whys: z.array(z.string()).describe("One per option, in the order given, each ending with a slide tag"),
  takeaway: z.string().describe("The tested fact as one Hebrew sentence with its tag, or empty when not covered"),
  slides: z.array(z.number().int()).describe("Every slide the explanations use"),
});
export const ExplainedSet = z.object({ questions: z.array(Explained) });
export type Explained = z.infer<typeof Explained>;

export const NOT_COVERED = "השקפים של ההרצאה לא עוסקים בזה.";

/** What the op streams to the phone for a saved question: the public fields
 *  only (Q's end adds the paragraph, the teaser, the diagram and the
 *  options' tags, which study_questions publishes too; practice 2.0 the
 *  style). The key, the explanations, "מתי כן" and the takeaway never leave
 *  the server here; the phone gets them from study_answer_question after
 *  answering. */
export type PublicLine = {
  t: "q";
  q: {
    id: string;
    part_idx: number;
    kind: SaveItem["kind"];
    difficulty: number;
    vignette: string;
    question: string;
    options: string[];
    slides: number[];
    topic: string;
    aspect: Aspect;
    anchor: number | null;
    teaser: string;
    figure: string;
    option_tags: string[];
    style: Style | null;
    form: Form;
    layout: Layout | null;
    series: string | null;
    step: number | null;
  };
};
export function toPublic(id: string, partIdx: number, item: SaveItem): PublicLine {
  const { kind, difficulty, vignette, question, options, slides, topic, aspect, para, teaser, figure, option_tags, style, form, layout, series, step } = item;
  return {
    t: "q",
    q: { id, part_idx: partIdx, kind, difficulty, vignette, question, options, slides, topic, aspect, anchor: para, teaser, figure, option_tags, style, form, layout, series, step },
  };
}

/** A draft as the op streams it ({"t":"draft"}): the fields every member
 *  reads in study_question_drafts, never the key, the explanations, "מתי
 *  כן", the takeaway or the blind solver's answer. `replaces` names the
 *  draft a rewrite stands in for. */
export type DraftLine = { t: "draft"; d: DraftOnLine };
export function toDraftPublic(
  o: { id: string; requestId: string; batchId: string; partIdx: number; style: Style; points: string[]; rewrites: number; replaces: string | null },
  item: SaveItem,
): DraftLine {
  const { kind, difficulty, vignette, question, options, slides, topic, aspect, para, teaser, figure, option_tags, form, layout, series, step } = item;
  return {
    t: "draft",
    d: {
      id: o.id,
      request_id: o.requestId,
      batch_id: o.batchId,
      part_idx: o.partIdx,
      style: o.style,
      points: o.points,
      kind,
      difficulty,
      vignette,
      question,
      options,
      slides,
      topic,
      aspect,
      anchor: para,
      teaser,
      figure,
      option_tags,
      check_state: "checking",
      rewrites: o.rewrites,
      replaces: o.replaces,
      form,
      layout,
      series,
      step,
    },
  };
}

/* ── Question types (docs/study/question-types.md) ──
 * Each new type's checker. A set question (tf, match, order) stores the
 * statements, the bank or the steps as its options and its key as `seq`;
 * the server writes a lead-in when the writer gave none. A label item is
 * built from the picture's geometry (labels.ts); a staged case is 2-3 plain
 * one-answer rows sharing a series. */

/** The lead-ins the server writes for a set question without one. */
export const TF_LEAD = "אילו מהמשפטים נכונים?";
export const MATCH_LEAD = "מה מתאים לכל אחד?";
export const ORDER_LEAD = "מה הסדר הנכון?";
const PROMPT_MAX = 120;
const SET_TEXT_MAX = 220;
const WHY_MAX = 450;
const DUP_SET = 0.6;

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A known question this set repeats: as many of its options as `ratio` of either list, or the same options. */
function duplicateSet(options: readonly string[], known: readonly Known[], ratio: number): Known | null {
  const mine = new Set(options.map(normalize));
  for (const k of known) {
    const shared = k.options.map(normalize).filter((o) => mine.has(o)).length;
    if (shared / Math.max(mine.size, k.options.length) >= ratio) return k;
  }
  return null;
}

/** A writer's own lead-in when it is a Hebrew question; else the server's. */
function leadIn(q: Question, fallback: string): string {
  const own = tidy(q.question);
  return own.endsWith("?") && HEBREW.test(own) && own.length >= 8 && own.length <= 400 && !NEGATIVE.test(own) ? own : fallback;
}

/** What every question has besides its options: slides, tags, takeaway, aspect, difficulty, points, paragraph, teaser. */
function common(q: Question, ctx: Ctx, o: { vignette: string; question: string; whys: string[]; keyText: string }, reasons: string[], warnings: string[]) {
  const takeaway = tidy(q.takeaway);
  if (!takeaway) reasons.push("no takeaway");
  const slides = [...new Set(q.slides)].sort((a, b) => a - b);
  if (!slides.length) reasons.push("no slides");
  if (slides.some((n) => !ctx.lectureSlides.has(n))) reasons.push("unknown slide");
  if (!slides.some((n) => n >= ctx.from && n <= ctx.to)) reasons.push("outside the part");
  if ([o.vignette, o.question, takeaway, ...o.whys].flatMap(tagSlides).some((n) => !ctx.lectureSlides.has(n))) reasons.push("tag names an unknown slide");
  if (!tagSlides(takeaway).length) warnings.push("takeaway without a tag");
  const aspect = ASPECT_KEYS.find((k) => k === q.aspect.trim().toLowerCase());
  if (!aspect) warnings.push(`aspect "${q.aspect}" mapped to other`);
  const difficulty = Math.min(3, Math.max(1, Math.round(q.difficulty))) as 1 | 2 | 3;
  const blocks = ctx.blocks ?? [];
  const para = blocks.length ? placePara(q.para, blocks, `${o.vignette} ${o.question} ${o.whys.join(" ")}`) : null;
  const block = para === null ? undefined : blocks.find((b) => b.n === para);
  const teaser = cleanTeaser(q.teaser, o.keyText);
  const points = pointsOf(q, `${takeaway} ${o.question}`, ctx, warnings);
  return { takeaway, slides, aspect: aspect ?? ("other" as Aspect), difficulty, para, quote: block ? block.text.slice(0, 80) : "", teaser, points };
}

/** נכון / לא נכון: 3-5 statements of one topic, both true and false ones,
 *  each explained with a slide tag; stored shuffled, seq 1/0 per statement. */
export function checkTf(q: Question, ctx: Ctx): Checked {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const st = q.options.map((o) => ({ text: tidy(o.text).replace(HEBREW_LABEL, ""), correct: o.correct, why: tidy(o.why), when: cleanWhen(o.when, o.correct, ctx.lectureSlides) }));
  if (st.length < 3 || st.length > 5) reasons.push(`tf with ${st.length} statements`);
  const t = st.filter((x) => x.correct).length;
  if (t === 0 || t === st.length) reasons.push("tf needs true and false statements");
  if (st.some((x) => !x.text || x.text.length > SET_TEXT_MAX)) reasons.push("statement empty or long");
  if (st.some((x) => BANNED_OPTION.test(x.text))) reasons.push("all/none of the above");
  if (new Set(st.map((x) => normalize(x.text))).size !== st.length) reasons.push("two statements say the same");
  if (st.some((x) => !x.why || x.why.length > WHY_MAX || !tagSlides(x.why).length)) reasons.push("a statement's explanation is empty, long or without a tag");
  if (st.some((x) => NEGATIVE.test(x.text))) warnings.push("a negative word in a statement");
  const vignette = q.case ? tidy(q.vignette) : "";
  if (q.case && vignette.length < 60) reasons.push("case without a vignette");
  const question = leadIn(q, TF_LEAD);
  const c = common(q, ctx, { vignette, question, whys: st.map((x) => x.why), keyText: "" }, reasons, warnings);
  if (!reasons.length) {
    const dup = duplicateSet(
      st.map((x) => x.text),
      ctx.known,
      DUP_SET,
    );
    if (dup) reasons.push(`duplicate of ${dup.id}`);
  }
  if (reasons.length) return { ok: false, reasons };
  const ordered = shuffled(st, ctx.random ?? cryptoRandom);
  return {
    ok: true,
    warnings,
    item: {
      kind: q.case ? "case" : "mcq",
      difficulty: c.difficulty,
      vignette,
      question,
      options: ordered.map((x) => x.text),
      answer: null,
      explanations: ordered.map((x) => x.why),
      takeaway: c.takeaway,
      slides: c.slides,
      topic: tidy(q.topic).slice(0, 120),
      aspect: c.aspect,
      para: c.para,
      quote: c.quote,
      teaser: c.teaser,
      figure: "",
      whens: ordered.map((x) => x.when),
      option_tags: [],
      style: "tf",
      points: c.points,
      form: "tf",
      layout: null,
      seq: ordered.map((x) => (x.correct ? 1 : 0)),
      series: null,
      step: null,
    },
  };
}

/** התאמה: 3-5 pairs of one kind (each option's `left` is its prompt) and at
 *  most one extra option; prompts and bank shuffled apart; seq[i] = the
 *  bank's index for prompts[i]. */
export function checkMatch(q: Question, ctx: Ctx): Checked {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const opts = q.options.map((o) => ({ text: tidy(o.text).replace(HEBREW_LABEL, ""), left: tidy(o.left), why: tidy(o.why) }));
  const pairs = opts.filter((o) => o.left);
  const extra = opts.filter((o) => !o.left);
  if (pairs.length < 3 || pairs.length > 5) reasons.push(`match with ${pairs.length} pairs`);
  if (extra.length > 1) reasons.push("match with more than one extra option");
  if (opts.some((o) => !o.text || o.text.length > PROMPT_MAX) || pairs.some((o) => o.left.length > PROMPT_MAX)) reasons.push("a match item empty or long");
  if (new Set(pairs.map((o) => normalize(o.left))).size !== pairs.length) reasons.push("two prompts say the same");
  if (new Set(opts.map((o) => normalize(o.text))).size !== opts.length) reasons.push("two options say the same");
  if (pairs.some((o) => !o.why || o.why.length > WHY_MAX || !tagSlides(o.why).length)) reasons.push("a pair's explanation is empty, long or without a tag");
  if (extra.some((o) => !o.why)) warnings.push("the extra option is not explained");
  const question = leadIn(q, MATCH_LEAD);
  const c = common(q, ctx, { vignette: "", question, whys: opts.map((o) => o.why), keyText: "" }, reasons, warnings);
  if (!reasons.length) {
    const dup = duplicateSet(
      opts.map((o) => o.text),
      ctx.known,
      DUP_OPTIONS,
    );
    if (dup) reasons.push(`duplicate of ${dup.id}`);
  }
  if (reasons.length) return { ok: false, reasons };
  const random = ctx.random ?? cryptoRandom;
  const prompts = shuffled(
    pairs.map((p) => p.left),
    random,
  );
  const bank = shuffled(opts, random);
  return {
    ok: true,
    warnings,
    item: {
      kind: "mcq",
      difficulty: c.difficulty,
      vignette: "",
      question,
      options: bank.map((o) => o.text),
      answer: null,
      explanations: bank.map((o) => o.why),
      takeaway: c.takeaway,
      slides: c.slides,
      topic: tidy(q.topic).slice(0, 120),
      aspect: c.aspect,
      para: c.para,
      quote: c.quote,
      teaser: c.teaser,
      figure: "",
      whens: [],
      option_tags: [],
      style: "match",
      points: c.points,
      form: "match",
      layout: { kind: "match", prompts },
      seq: prompts.map((p) => bank.findIndex((b) => b.left === p)),
      series: null,
      step: null,
    },
  };
}

/** Numbers and ordinal words a step may begin with ("1.", "שלב 2:", "ראשית", "לבסוף"). */
const ORDINAL = /^\s*(?:\(?\d{1,2}[.):]\s*|שלב\s+\d{1,2}\s*[.:)-]?\s*|(?:ראשית|ראשון|ראשונה|שני|שנייה|שלישי|שלישית|רביעי|רביעית|חמישי|חמישית|שישי|שישית|לבסוף|ולבסוף|בסוף|אחר כך|לאחר מכן|בהמשך|first|then|finally|next)\s*[,:-]?\s+)/i;
export const stripOrdinal = (s: string) => {
  let t = s;
  for (let i = 0; i < 3 && ORDINAL.test(t); i++) t = t.replace(ORDINAL, "");
  return t.trim();
};

/** סידור: 3-6 steps of one process, written in their order (numbers and
 *  ordinal words stripped); stored shuffled and never already in order;
 *  seq[pos] = the stored index of the step at pos. */
export function checkOrder(q: Question, ctx: Ctx): Checked {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const steps = q.options.map((o) => ({ text: stripOrdinal(tidy(o.text).replace(HEBREW_LABEL, "")), why: tidy(o.why) }));
  if (steps.length < 3 || steps.length > 6) reasons.push(`order with ${steps.length} steps`);
  if (steps.some((x) => !x.text || x.text.length > SET_TEXT_MAX)) reasons.push("a step empty or long");
  if (new Set(steps.map((x) => normalize(x.text))).size !== steps.length) reasons.push("two steps say the same");
  if (steps.some((x) => !x.why || x.why.length > WHY_MAX)) reasons.push("a step's explanation is empty or long");
  if (steps.some((x) => !tagSlides(x.why).length)) warnings.push("a step's explanation without a tag");
  const question = leadIn(q, ORDER_LEAD);
  const c = common(q, ctx, { vignette: "", question, whys: steps.map((x) => x.why), keyText: "" }, reasons, warnings);
  if (!reasons.length) {
    const dup = duplicateSet(
      steps.map((x) => x.text),
      ctx.known,
      DUP_OPTIONS,
    );
    if (dup) reasons.push(`duplicate of ${dup.id}`);
  }
  if (reasons.length) return { ok: false, reasons };
  const random = ctx.random ?? cryptoRandom;
  const idx = steps.map((_, i) => i);
  let stored = shuffled(idx, random);
  for (let k = 0; k < 20 && stored.every((v, i) => v === i); k++) stored = shuffled(idx, random);
  if (stored.every((v, i) => v === i)) stored = [...idx.slice(1), idx[0]];
  return {
    ok: true,
    warnings,
    item: {
      kind: "mcq",
      difficulty: c.difficulty,
      vignette: "",
      question,
      options: stored.map((i) => steps[i].text),
      answer: null,
      explanations: stored.map((i) => steps[i].why),
      takeaway: c.takeaway,
      slides: c.slides,
      topic: tidy(q.topic).slice(0, 120),
      aspect: c.aspect,
      para: c.para,
      quote: c.quote,
      teaser: c.teaser,
      figure: "",
      whens: [],
      option_tags: [],
      style: "order",
      points: c.points,
      form: "order",
      layout: null,
      seq: idx.map((pos) => stored.indexOf(pos)),
      series: null,
      step: null,
    },
  };
}

/** שאלה על תמונה: a plain question about a captioned picture of the part.
 *  On a PDF lecture without geometry the page must not print the answer;
 *  with geometry the page is cropped to the diagram and its labels masked. */
export function checkImage(q: Question, ctx: Ctx): Checked {
  const r = checkOne(q, ctx, "image");
  if (!r.ok) return r;
  const fig = r.item.figure;
  if (!fig) return { ok: false, reasons: ["image without a picture of the part"] };
  const n = Number(/^fig:(\d+)-/.exec(fig)?.[1]);
  const lab = ctx.labelled?.get(fig);
  if (ctx.pdf && !lab && r.item.answer !== null) {
    const key = normalize(r.item.options[r.item.answer] ?? "");
    const page = normalize(ctx.slideText?.get(n) ?? "");
    if (key.length >= 3 && page.includes(key)) return { ok: false, reasons: ["the answer is printed on the page"] };
  }
  // The picture as the slide shows it: a PDF page cut to its diagram with its labels masked; a PPTX
  // picture cut to the lecturer's crop (a cropped-away legend or source line can give the answer).
  const crop = ctx.pdf && lab ? pageCrop(lab.geo) : pptxCrop(fig, lab?.geo, ctx.crops);
  const layout: Layout = { kind: "image", fig, ...crop };
  return { ...r, item: { ...r.item, layout } };
}

/** A PPTX picture's crop as an image layout's: the label geometry's clip
 *  relative to the stored picture, else the crop the upload kept; none when
 *  the picture is shown whole. */
export function pptxCrop(fig: string, geo: FigureGeo | undefined, crops: ReadonlyMap<string, Box> | undefined): { crop?: Box } {
  const c = geo?.clip ? roundBox(relTo(geo.clip, geo.img)) : crops?.get(fig);
  if (!c || !(c.w > 0) || !(c.h > 0)) return {};
  if (c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999) return {};
  return { crop: c };
}

/** The script an option is written in: Hebrew, Latin, or both (a Hebrew word with an English term). */
export function scriptOf(t: string): "he" | "latin" | "mixed" | "none" {
  const he = /[א-ת]/.test(t);
  const la = /[A-Za-z]/.test(t);
  return he && la ? "mixed" : he ? "he" : la ? "latin" : "none";
}
/** A Hebrew option with an English term matches either; Hebrew and Latin alone do not match each other. */
const sameScript = (a: ReturnType<typeof scriptOf>, b: ReturnType<typeof scriptOf>) => a === b || a === "mixed" || b === "mixed" || a === "none" || b === "none";

/** סימון על תמונה: the picture must have label geometry, the key must be
 *  exactly one of its labels, every distractor a label of the picture or a
 *  word of the lecture. The server writes the lead-in, numbers the pins and
 *  the explanations (labels.ts); name or tap mode in turn. */
export function checkLabel(q: Question, ctx: Ctx): Checked {
  const fig = tidy(q.figure);
  const lab = ctx.labelled?.get(fig);
  if (!lab) return { ok: false, reasons: ["label without a labelled picture"] };
  const keyOpt = q.options.find((o) => o.correct);
  const target = keyOpt ? labelIndex(lab.geo, tidy(keyOpt.text)) : -1;
  if (target < 0) return { ok: false, reasons: [target === -2 ? "the key matches two labels" : "the key is not a label of the picture"] };
  // The key must name a structure: not a panel letter, "Fig. 2" or a source line (older geometry may hold them).
  if (!isLabelText(lab.geo.labels[target].t)) return { ok: false, reasons: ["the key is not a structure's name"] };
  // One script for every option: a single English option among Hebrew ones (or the reverse) gives the answer away.
  const keyScript = scriptOf(lab.geo.labels[target].t);
  if (q.options.some((o) => !o.correct && !sameScript(scriptOf(tidy(o.text)), keyScript))) return { ok: false, reasons: ["the options are written in two scripts"] };
  const text = ctx.lectureText ?? "";
  const prefer: number[] = [];
  for (const o of q.options) {
    if (o.correct) continue;
    const i = labelIndex(lab.geo, tidy(o.text));
    if (i >= 0) prefer.push(i);
    else if (!text.includes(tidy(o.text).toLowerCase())) return { ok: false, reasons: ["a distractor is neither a label nor in the lecture"] };
  }
  // The plain checks on a neutral lead-in (the server writes the real one) and without stem duplicates.
  const r = checkOne({ ...q, case: false, vignette: "", question: "מה מסומן בשרטוט?", figure: fig }, { ...ctx, known: [], figures: new Set([fig]) }, "label");
  if (!r.ok) return r;
  const keyName = normLabel(lab.geo.labels[target].t);
  const dup = ctx.known.find(
    (k) => normLabel(k.question).includes(keyName) && /^באיזה מספר מסומן/.test(k.question) || (/^מה מסומן במספר/.test(k.question) && k.options.some((x) => normLabel(x) === keyName) && duplicateSet(r.item.options, [k], DUP_OPTIONS)),
  );
  if (dup) return { ok: false, reasons: [`duplicate of ${dup.id}`] };
  const options = r.item.options.map((t, i) => ({ text: t, correct: i === r.item.answer, why: r.item.explanations[i] }));
  const wanted = modeFor(ctx.labelIndex ?? 0, lab.geo.labels.length);
  // A tap item whose pins would crowd each other on a phone is asked by name instead; neither: rejected.
  let mode = wanted;
  let built = buildLabelItem({ fig, geo: lab.geo, target, mode, options, prefer });
  if (!built && mode === "tap") {
    mode = "name";
    built = buildLabelItem({ fig, geo: lab.geo, target, mode, options, prefer });
  }
  if (!built) return { ok: false, reasons: ["the labels are too close together for pins"] };
  return {
    ...r,
    item: {
      ...r.item,
      kind: "mcq",
      vignette: "",
      question: built.question,
      options: built.options,
      answer: built.answer,
      explanations: built.explanations,
      whens: mode === "tap" ? [] : r.item.whens,
      option_tags: mode === "tap" ? [] : r.item.option_tags,
      figure: fig,
      form: built.form,
      layout: built.layout,
    },
  };
}

const VIGNETTE_MAX = 2400;

/** מקרה קליני בשלבים: a case and 1-2 later stages; every step a whole
 *  one-answer question (its vignette the base story, the earlier steps'
 *  updates and answers as facts, and its own update), sharing one series.
 *  A step must not carry its own answer in its story. */
export function checkSteps(q: Question, ctx: Ctx): Checked {
  const warnings: string[] = [];
  const stages = q.stages.slice(0, 2);
  if (!stages.length) return { ok: false, reasons: ["a staged case needs 2-3 steps"] };
  if (q.stages.length > 2) warnings.push("steps cut to 3");
  const base = tidy(q.vignette);
  if (base.length < 60) return { ok: false, reasons: ["case without a vignette"] };
  const series = (ctx.newSeries ?? (() => crypto.randomUUID()))();
  const of = (1 + stages.length) as 2 | 3;
  const defs = [{ update: "", question: q.question, options: q.options, resolved: q.resolved }, ...stages];
  const items: SaveItem[] = [];
  let carried = base;
  for (let k = 0; k < defs.length; k++) {
    const def = defs[k];
    const update = tidy(def.update);
    if (k > 0 && !update) return { ok: false, reasons: [`step ${k + 1}: no update`] };
    const vignette = k === 0 ? base : `${carried} ${update}`;
    if (vignette.length > VIGNETTE_MAX) return { ok: false, reasons: [`step ${k + 1}: the case is too long`] };
    const qk: Question = { ...q, case: true, vignette, question: def.question, options: def.options, teaser: k === 0 ? q.teaser : "", style: "steps", resolved: "", stages: [] };
    const r = checkOne(qk, ctx, "steps");
    if (!r.ok) return { ok: false, reasons: r.reasons.map((x) => `step ${k + 1}: ${x}`) };
    r.warnings.forEach((w) => warnings.push(`step ${k + 1}: ${w}`));
    const keyText = r.item.answer === null ? "" : r.item.options[r.item.answer];
    const key = normalize(keyText);
    if (key.length >= 3 && normalize(vignette).includes(key)) return { ok: false, reasons: [`step ${k + 1}: the case gives its answer`] };
    const resolved = tidy(def.resolved);
    if (!resolved && k < defs.length - 1) return { ok: false, reasons: [`step ${k + 1}: no resolved sentence for the next step`] };
    if (resolved && key && !normalize(resolved).includes(key)) warnings.push(`step ${k + 1}: resolved does not name its answer`);
    items.push({ ...r.item, kind: "case", series, step: k + 1, layout: { kind: "steps", of, lead: k === 0 ? 0 : carried.length } });
    carried = k === 0 ? `${base} ${resolved}`.trim() : `${carried} ${update} ${resolved}`.trim();
  }
  return { ok: true, warnings, item: items[0], more: items.slice(1) };
}
