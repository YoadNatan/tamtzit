import { z } from "zod/v4";
import type { NumberedBlock } from "../../shared/study/blocks.js";
import { type DraftOnLine, STYLES, type Style } from "../../shared/study/practice2.js";
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
  "other",
] as const;
export type Aspect = (typeof ASPECT_KEYS)[number];

/* Every field required; no nullable fields, unions or enums (SDK 1.3.0 moves
 * `enum` into the description, so the API would not enforce it anyway); no
 * field that asks for reasoning (reasoning_extraction refusals). Counts are
 * checked in code: the API supports minItems 0 or 1 only. */
export const QOption = z.object({
  text: z
    .string()
    .describe(
      "The option in Hebrew, English names as the lecture writes them; the same kind of thing as the other options, parallel in form and close in length; no letter or number in front",
    ),
  correct: z.boolean().describe("true for the one best answer only"),
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
});
export const Question = z.object({
  topic: z.string().describe("The drug, organism, disease or process tested, in English exactly as the lecture writes it"),
  aspect: z
    .string()
    .describe(
      "One key: mechanism, uses, pk, adverse, contra, interactions, resistance, dosing, classification, epidemiology, lifecycle, pathogenesis, clinical, diagnosis, treatment, prevention, other",
    ),
  style: z.string().describe("One key: case, mechanism, drug_choice, adverse_contra, compare, not_true, blank_table; one the request assigns, when it assigns styles"),
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
});
export const QuestionSet = z.object({ questions: z.array(Question) });
export type Question = z.infer<typeof Question>;

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
  answer: number;
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
};

export type Checked = { ok: true; item: SaveItem; warnings: string[] } | { ok: false; reasons: string[] };

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
 *  part (the op logs them, for calibrating the prompt). */
export function checkQuestion(q: Question, ctx: Ctx): Checked {
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
  const style = styleOf(q, ctx, warnings);
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
  };
};
export function toPublic(id: string, partIdx: number, item: SaveItem): PublicLine {
  const { kind, difficulty, vignette, question, options, slides, topic, aspect, para, teaser, figure, option_tags, style } = item;
  return {
    t: "q",
    q: { id, part_idx: partIdx, kind, difficulty, vignette, question, options, slides, topic, aspect, anchor: para, teaser, figure, option_tags, style },
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
  const { kind, difficulty, vignette, question, options, slides, topic, aspect, para, teaser, figure, option_tags } = item;
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
    },
  };
}
