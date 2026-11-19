/* ── Practice 2.0: the shared vocabulary, the plan and the numbers ──
 *
 * What the server and the screens must agree on for question creation by
 * level (docs/study/proposal/practice-2/DECISIONS.md; the API in
 * docs/study/practice-2-api.md): the kinds of points to know, the levels,
 * styles and difficulties with their Hebrew, how many questions a level
 * writes for a lecture's points and how they split into batches, the
 * options a request may carry, the estimates shown before anything is
 * spent, the coverage bars of "הבנק נבנה" and the counts of "סבב חדש".
 * Pure functions only: this file is in the browser bundle and in the server
 * (op "questions", server/study/practice.ts), so no zod and no I/O.
 * Imports end in ".js" (spec §2.2). */

import { canStyle, emptyFacts, NEW_STYLES, weightOf, type Form, type Layout, type PartFacts } from "./forms.js";

// ── Points to know ──

/** structure, process and finding (question types): anatomy, physiology and
 *  imaging lectures, whose points fitted no pharmacology kind. */
export const POINT_KINDS = ["drug", "mechanism", "indication", "adverse", "contra", "number", "structure", "process", "finding"] as const;
export type PointKind = (typeof POINT_KINDS)[number];
export const POINT_KIND_HE: Record<PointKind, string> = {
  drug: "תרופה",
  mechanism: "מנגנון",
  indication: "התוויה",
  adverse: "תופעת לוואי",
  contra: "התוויית נגד",
  number: "מספר לזכור",
  structure: "מבנה ומיקום",
  process: "תהליך ושלבים",
  finding: "ממצא",
};

/** A point to know, as study_points stores it and every member reads it. */
export type Point = {
  id: string;
  lecture_id: string;
  part_idx: number;
  /** The order in its part (the paragraphs' order). */
  n: number;
  kind: PointKind;
  /** The drug, organism or process, in English as the lecture writes it; "" when none. */
  subject: string;
  /** The fact, one Hebrew sentence. */
  text: string;
  /** The paragraph that states it (SummaryView's data-blk), and its first words for re-anchoring. */
  anchor: number | null;
  quote: string;
  slides: number[];
  red_flag: boolean;
  /** 3 core, 2 standard, 1 detail. */
  weight: 1 | 2 | 3;
};

/** What the planner needs of a point. */
export type PlanPoint = Pick<Point, "id" | "part_idx" | "n" | "kind" | "red_flag" | "weight">;

/** One part on the setup screen (study_points_state). */
export type PointsPart = {
  part_idx: number;
  title: string;
  slide_from: number;
  slide_to: number;
  /** The summary part's own status (only a "ready" part has points). */
  summary: string;
  points: number;
  red_flags: number;
  status: "pending" | "writing" | "ready" | "failed";
  /** Read from the part's text as it is now (a rewrite or a correction makes it false). */
  current: boolean;
  /** A read in progress on some phone. */
  busy: boolean;
  error: string | null;
};

// ── Levels, styles, difficulty ──

export const LEVELS = ["focused", "full", "deep", "custom"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_HE: Record<Level, string> = { focused: "ממוקד", full: "מלא", deep: "מקיף", custom: "משלי" };
/** Decision 1 (DECISIONS.md): the default count is מלא. */
export const DEFAULT_LEVEL: Level = "full";

export const STYLES = ["case", "mechanism", "drug_choice", "adverse_contra", "compare", "not_true", "blank_table", ...NEW_STYLES] as const;
export type Style = (typeof STYLES)[number];
export const STYLE_HE: Record<Style, string> = {
  case: "מקרה קליני",
  mechanism: "מנגנון",
  drug_choice: "תרופה לבחירה",
  adverse_contra: "תופעות והתוויות נגד",
  compare: "השוואה",
  not_true: "׳מה לא נכון׳",
  blank_table: "טבלה ריקה",
  image: "שאלה על תמונה",
  label: "סימון על תמונה",
  steps: "מקרה קליני בשלבים",
  tf: "נכון / לא נכון",
  match: "התאמה",
  order: "סידור",
};
/** The four styles the approved setup screen shows checked. */
export const DEFAULT_STYLES: readonly Style[] = ["case", "mechanism", "drug_choice", "adverse_contra"];

export const DIFFICULTIES = ["easy", "exam", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const DIFFICULTY_HE: Record<Difficulty, string> = { easy: "קל", exam: "כמו במבחן", hard: "קשה" };
export const DEFAULT_DIFFICULTY: Difficulty = "exam";

/** At most this many questions in one request (מקיף on the example's 46 points gives 40). */
export const REQUEST_MAX = 40;
/** At most this many questions in one batch (one model call; study_question_batches.wanted). */
export const BATCH_MAX = 5;
/** משלי: at most two questions for each point of the chosen parts. */
export const CUSTOM_PER_POINT = 2;
export const FOCUS_MAX = 200;
export const STYLE_NOTE_MAX = 400;
export const STYLE_EXAMPLE_MAX = 2000;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

// ── How many questions ──

/** Rounds half up (22/4 = 5.5 → 6, as the example's מלריה). */
const halfUp = (x: number) => Math.floor(x + 0.5 + 1e-9);

/** The questions a level writes for a part with `points` points, `redFlags` of
 *  them red flags: ממוקד about one per 4 points but every red flag in; מלא
 *  about one per 2 points (each point at least once); מקיף one per point. */
export function partQuestions(level: Exclude<Level, "custom">, points: number, redFlags: number): number {
  if (points <= 0) return 0;
  if (level === "focused") return Math.min(points, Math.max(halfUp(points / 4), redFlags));
  if (level === "full") return halfUp(points / 2);
  return points;
}

/** Shares `total` out over `weights` by the largest remainder (ties to the
 *  earlier), never above `caps` and, while total allows, at least 1 where
 *  the weight is positive. */
export function shareOut(total: number, weights: readonly number[], caps?: readonly number[]): number[] {
  const n = weights.length;
  const cap = (i: number) => (caps ? caps[i] : Number.POSITIVE_INFINITY);
  const out = new Array<number>(n).fill(0);
  const live = weights.map((w, i) => w > 0 && cap(i) > 0);
  const sum = weights.reduce((s, w, i) => s + (live[i] ? w : 0), 0);
  if (total <= 0 || sum <= 0) return out;
  const raw = weights.map((w, i) => (live[i] ? (total * w) / sum : 0));
  for (let i = 0; i < n; i++) out[i] = Math.min(cap(i), Math.floor(raw[i] + 1e-9));
  // At least one where it can be (when there is enough to go round).
  const positive = live.filter(Boolean).length;
  if (total >= positive) for (let i = 0; i < n; i++) if (live[i] && out[i] === 0) out[i] = 1;
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r + 1e-9) }))
    .filter(({ i }) => live[i])
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  // Hand out the rest by remainder, round after round while caps allow.
  while (left > 0) {
    let moved = false;
    for (const { i } of order) {
      if (left <= 0) break;
      if (out[i] < cap(i)) {
        out[i] += 1;
        left -= 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Too many (the minimum of 1 pushed it over): take back from the largest, latest first.
  while (left < 0) {
    let k = -1;
    for (let i = n - 1; i >= 0; i--) if (out[i] > 1 && (k < 0 || out[i] > out[k])) k = i;
    if (k < 0) break;
    out[k] -= 1;
    left += 1;
  }
  return out;
}

export type PartCount = { part_idx: number; points: number; red_flags: number };

/** Each chosen part's points and red flags, in part order. */
export function partCounts(points: readonly PlanPoint[], parts?: readonly number[]): PartCount[] {
  const chosen = parts ? new Set(parts) : null;
  const by = new Map<number, PartCount>();
  for (const p of points) {
    if (chosen && !chosen.has(p.part_idx)) continue;
    const c = by.get(p.part_idx) ?? { part_idx: p.part_idx, points: 0, red_flags: 0 };
    c.points += 1;
    if (p.red_flag) c.red_flags += 1;
    by.set(p.part_idx, c);
  }
  return [...by.values()].sort((a, b) => a.part_idx - b.part_idx);
}

/** The questions of each chosen part for a level (and for משלי, `count`),
 *  at most REQUEST_MAX in all: over it, shared out by the largest remainder. */
export function questionsPerPart(level: Level, counts: readonly PartCount[], count?: number): number[] {
  if (level === "custom") {
    const room = counts.map((c) => c.points * CUSTOM_PER_POINT);
    const want = Math.max(0, Math.min(Math.floor(count ?? 0), REQUEST_MAX, room.reduce((s, x) => s + x, 0)));
    return shareOut(
      want,
      counts.map((c) => c.points),
      room,
    );
  }
  const raw = counts.map((c) => partQuestions(level, c.points, c.red_flags));
  const total = raw.reduce((s, x) => s + x, 0);
  return total <= REQUEST_MAX ? raw : shareOut(REQUEST_MAX, raw, raw);
}

/** The setup screen's three numbers ("ממוקד 12 · מלא 24 · מקיף 40"). */
export function levelCounts(points: readonly PlanPoint[], parts?: readonly number[]): Record<Exclude<Level, "custom">, number> {
  const counts = partCounts(points, parts);
  const sum = (l: Exclude<Level, "custom">) => questionsPerPart(l, counts).reduce((s, x) => s + x, 0);
  return { focused: sum("focused"), full: sum("full"), deep: sum("deep") };
}

// ── The plan: batches, their points and their styles ──

/** Points in the order a level takes them: red flags, then weight, then the paragraphs' order. */
const priority = (a: PlanPoint, b: PlanPoint) => Number(b.red_flag) - Number(a.red_flag) || b.weight - a.weight || a.n - b.n;

/** The points of a part a request covers: ממוקד the most important, one per
 *  question (every red flag first); מלא and מקיף all of them; משלי the most
 *  important two per question. In the paragraphs' order. */
export function chosenPoints(level: Level, partPoints: readonly PlanPoint[], questions: number): PlanPoint[] {
  if (questions <= 0) return [];
  const take = level === "focused" ? questions : level === "custom" ? questions * CUSTOM_PER_POINT : partPoints.length;
  return [...partPoints]
    .sort(priority)
    .slice(0, Math.max(take, level === "focused" ? partPoints.filter((p) => p.red_flag).length : 0))
    .sort((a, b) => a.n - b.n);
}

export type PlannedBatch = { part_idx: number; seq: number; wanted: number; points: string[]; styles: Style[] };
export type Plan = {
  total: number;
  parts: Array<{ part_idx: number; points: number; red_flags: number; questions: number; covers: number }>;
  batches: PlannedBatch[];
};

/** Splits a part's questions into batches of at most BATCH_MAX, as even as
 *  possible, larger ones first (11 → 4, 4, 3). */
export function batchSizes(questions: number): number[] {
  if (questions <= 0) return [];
  const k = Math.ceil(questions / BATCH_MAX);
  return Array.from({ length: k }, (_, i) => Math.floor(questions / k) + (i < questions % k ? 1 : 0));
}

/** At most this many items of a type in one part: a label item per labelled
 *  picture twice over, an image item per captioned picture, two staged cases. */
export function styleQuota(style: Style, f: PartFacts): number {
  if (style === "label") return 2 * f.labelled;
  if (style === "image") return f.figures;
  if (style === "steps") return 2;
  return Number.POSITIVE_INFINITY;
}

/** The plan of a request: per chosen part its questions, the points they
 *  must cover (neighbouring paragraphs together in a batch) and the style of
 *  each question, the request's styles in turn across the whole request. A
 *  style a part cannot have (canStyle on `partFacts`: a blank table needs a
 *  table, a label item a labelled picture, an image item a captioned
 *  picture), or whose quota in the part is used up, takes the next style; a
 *  label item in a part with pictures but no labels becomes an image item.
 *  A part none of the request's styles fits gets no questions. `tableParts`
 *  is the older form of the facts (tables only). */
export function planRequest(o: {
  points: readonly PlanPoint[];
  level: Level;
  count?: number;
  parts: readonly number[];
  styles: readonly Style[];
  tableParts?: ReadonlySet<number>;
  partFacts?: ReadonlyMap<number, PartFacts>;
}): Plan {
  const styles = STYLES.filter((s) => o.styles.includes(s));
  const factsOf = (part: number): PartFacts | null => {
    if (o.partFacts) return o.partFacts.get(part) ?? emptyFacts();
    if (o.tableParts) return { ...emptyFacts(), tables: o.tableParts.has(part), figures: 1e9, labelled: 1e9, points: { any: 1e9 } };
    return null;
  };
  const fits = (s: Style, part: number) => {
    const f = factsOf(part);
    return !f || canStyle(s, f) || (s === "label" && canStyle("image", f));
  };
  const usableParts = o.parts.filter((p) => styles.some((s) => fits(s, p)));
  const counts = partCounts(o.points, usableParts);
  // A part whose every fitting style has a quota (only pictures, only staged cases) writes at most their sum.
  const room = (part: number) => {
    const f = factsOf(part);
    if (!f) return Number.POSITIVE_INFINITY;
    let n = 0;
    for (const s of styles) {
      const t = s === "label" && !canStyle("label", f) ? "image" : s;
      if (!canStyle(t, f)) continue;
      if (t === "image" && s === "label" && styles.includes("image")) continue; // counted once, as image
      n += styleQuota(t, f);
    }
    return n;
  };
  const perPart = questionsPerPart(o.level, counts, o.count).map((n, i) => Math.min(n, room(counts[i].part_idx)));
  const batches: PlannedBatch[] = [];
  const parts: Plan["parts"] = [];
  let slot = 0;
  counts.forEach((c, i) => {
    const questions = perPart[i];
    const partPoints = o.points.filter((p) => p.part_idx === c.part_idx);
    const cover = chosenPoints(o.level, partPoints, questions);
    parts.push({ ...c, questions, covers: cover.length });
    const sizes = batchSizes(questions);
    const shares = shareOut(cover.length, sizes, sizes.map(() => cover.length));
    const f = factsOf(c.part_idx);
    const used = new Map<Style, number>();
    const take = (s: Style): Style | null => {
      let t = s;
      if (f && t === "label" && !canStyle("label", f) && canStyle("image", f)) t = "image";
      if (f && (!canStyle(t, f) || (used.get(t) ?? 0) >= styleQuota(t, f))) return null;
      used.set(t, (used.get(t) ?? 0) + 1);
      return t;
    };
    let at = 0;
    sizes.forEach((wanted, seq) => {
      const pts = cover.slice(at, at + shares[seq]).map((p) => p.id);
      at += shares[seq];
      const own: Style[] = [];
      for (let q = 0; q < wanted; q++) {
        // The style in turn; one the part cannot have (or whose quota is used): the next.
        let s: Style | null = null;
        for (let k = 0; k < styles.length && !s; k++) s = take(styles[(slot + k) % styles.length]);
        // Every quota is used (the room above prevents it): a style the part can have, again.
        if (!s) s = styles.find((x) => !f || canStyle(x, f)) ?? styles[0];
        own.push(s);
        slot += 1;
      }
      batches.push({ part_idx: c.part_idx, seq, wanted, points: pts, styles: own });
    });
  });
  return { total: batches.reduce((s, b) => s + b.wanted, 0), parts, batches };
}

/** Every planned item's style, for the weighted estimate. */
export const plannedStyles = (plan: Pick<Plan, "batches">): Style[] => plan.batches.flatMap((b) => b.styles);

// ── The options of a request ──

/** What "ככה השאלות ייכתבו" read back from an example (action "style"),
 *  signed by the server so a request carries only what it wrote. */
export type StyleRead = { description: string; example: string; sig: string };

export type Options = {
  level: Level;
  /** משלי only: the number the member chose (1-40). */
  count?: number;
  /** The summary parts chosen (part_idx); all parts with points when none is sent. */
  parts?: number[];
  styles: Style[];
  difficulty: Difficulty;
  /** "על מה להתמקד", at most 200 characters. */
  focus: string;
  style?: StyleRead;
};

/** The options a request may carry, with their defaults, or the code that
 *  refuses them (400): bad level, count out of range, bad parts, bad styles, bad
 *  difficulty, focus too long, bad style (an example's read), bad request. */
export function readOptions(raw: unknown): { ok: true; options: Options } | { ok: false; code: string } {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const level = o.level === undefined ? DEFAULT_LEVEL : o.level;
  if (!isOneOf(LEVELS, level)) return { ok: false, code: "bad level" };
  let count: number | undefined;
  if (level === "custom") {
    if (typeof o.count !== "number" || !Number.isInteger(o.count) || o.count < 1 || o.count > REQUEST_MAX) return { ok: false, code: "count out of range" };
    count = o.count;
  }
  let parts: number[] | undefined;
  if (o.parts !== undefined) {
    if (!Array.isArray(o.parts) || !o.parts.length || o.parts.length > 60 || !o.parts.every((p) => Number.isInteger(p) && p >= 0 && p < 1000)) {
      return { ok: false, code: "bad parts" };
    }
    parts = [...new Set(o.parts as number[])].sort((a, b) => a - b);
  }
  const styles = o.styles === undefined ? [...DEFAULT_STYLES] : o.styles;
  if (!Array.isArray(styles) || !styles.length || !styles.every((s) => isOneOf(STYLES, s))) return { ok: false, code: "bad styles" };
  const difficulty = o.difficulty === undefined ? DEFAULT_DIFFICULTY : o.difficulty;
  if (!isOneOf(DIFFICULTIES, difficulty)) return { ok: false, code: "bad difficulty" };
  const focus = o.focus === undefined || o.focus === null ? "" : o.focus;
  if (typeof focus !== "string") return { ok: false, code: "bad request" };
  if (focus.trim().length > FOCUS_MAX) return { ok: false, code: "focus too long" };
  let style: StyleRead | undefined;
  if (o.style !== undefined && o.style !== null) {
    const s = o.style as Record<string, unknown>;
    if (
      typeof s !== "object" ||
      typeof s.description !== "string" ||
      typeof s.example !== "string" ||
      typeof s.sig !== "string" ||
      s.description.length > STYLE_NOTE_MAX ||
      s.example.length > STYLE_EXAMPLE_MAX
    ) {
      return { ok: false, code: "bad style" };
    }
    style = { description: s.description, example: s.example, sig: s.sig };
  }
  return {
    ok: true,
    options: {
      level,
      ...(count !== undefined ? { count } : {}),
      ...(parts ? { parts } : {}),
      styles: STYLES.filter((s) => (styles as string[]).includes(s)),
      difficulty,
      focus: focus.trim().replace(/\s+/g, " "),
      ...(style ? { style } : {}),
    },
  };
}

// ── What it costs (shown before anything is spent) ──

/** Full-price estimates in USD, shown before a member creates anything. The
 *  approved figures (DECISIONS.md: 12 ≈ $0.30, 24 ≈ $0.60, 40 ≈ $1.00 a
 *  lecture) are $0.025 a question: its share of the writing call, the
 *  blind solver's check and the automatic rewrites. Calibrate against the
 *  ledger (study_usage, kinds practice, solver, points, reword, style) once
 *  the first lectures are written; the reservations are separate and always
 *  the worst case (budget.ts estimateUsd). Batch mode (section B) halves them. */
export const EXPECTED_USD = {
  /** One question written, checked by the blind solver, rewritten when it failed. */
  question: 0.025,
  /** The blind solver's share of a question (in `question`, shown apart). */
  solver: 0.005,
  /** One member's "↻ לנסח מחדש": a question written again and checked. */
  reword: 0.03,
  /** Reading an example back ("ככה השאלות ייכתבו"). */
  style: 0.01,
} as const;

/** Reading a summary's points to know: its paragraphs in (characters ÷ 2.5
 *  tokens at $4 a million, with the prompt's 1,600) and about one point per
 *  350 characters out (65 tokens each, plus 1,500 of thinking, at $20 a
 *  million). About $0.14 for an 18,000-character summary (about 50 points),
 *  once per lecture for the whole group. Each part is its own call (read in
 *  parallel), so each part after the first adds the prompt again and some
 *  thinking of its own (1,000 tokens): about $0.24 for those 18,000
 *  characters in five parts. */
export function pointsUsd(summaryChars: number, parts = 1): number {
  const chars = Math.max(0, summaryChars);
  const more = Math.max(0, Math.floor(parts) - 1);
  const input = (chars / 2.5 + 1600 * (1 + more)) * 4e-6;
  const output = ((chars / 350) * 65 + 1500 + 1000 * more) * 20e-6;
  return round2(input + output);
}

/** A request of `questions` questions, at full price: a number of plain
 *  questions, or the planned styles, each weighted (forms.ts STYLE_WEIGHT: a
 *  label item half, a staged case 2.5). */
export const requestUsd = (questions: number | readonly string[]): number => round2(Math.max(0, weighted(questions)) * EXPECTED_USD.question);
/** The blind solver's part of that (already in requestUsd; label items have none). */
export const solverUsd = (questions: number | readonly string[]): number =>
  round2(Math.max(0, typeof questions === "number" ? questions : weighted(questions.filter((s) => s !== "label"))) * EXPECTED_USD.solver);
const weighted = (q: number | readonly string[]) => (typeof q === "number" ? q : weightOf(q));

/** Rounded up to the cent, as the screens print it. */
function round2(x: number): number {
  return Math.ceil(x * 100 - 1e-9) / 100 || 0; // never -0
}

// ── "הבנק נבנה": the coverage bars ──

/** A draft as every member reads it (study_question_drafts): never its key. */
export type Draft = {
  id: string;
  request_id: string;
  batch_id: string | null;
  lecture_id: string;
  part_idx: number;
  style: Style;
  points: string[];
  kind: "mcq" | "case";
  difficulty: 1 | 2 | 3;
  vignette: string;
  question: string;
  options: string[];
  slides: number[];
  topic: string;
  aspect: string;
  anchor: number | null;
  teaser: string;
  figure: string;
  option_tags: string[];
  status: "pending" | "kept" | "removed" | "replaced" | "rejected";
  check_state: "checking" | "ok" | "failed" | "unchecked";
  rewrites: number;
  replaces: string | null;
  question_id: string | null;
  created_at: string;
  updated_at: string;
  /** Question types (section Q at 3): absent before; "one" for every older draft. */
  form?: Form;
  layout?: Layout | null;
  series?: string | null;
  step?: number | null;
};

/** Per part: the request's points of that part and how many of them its
 *  drafts cover (pending or kept, and not failed by the blind solver),
 *  "אמבות 6/6" (study_request_progress counts the same). */
export function coverage(
  requestPoints: readonly Pick<PlanPoint, "id" | "part_idx">[],
  drafts: readonly Pick<Draft, "part_idx" | "points" | "status" | "check_state">[],
): Array<{ part_idx: number; points: number; covered: number }> {
  const parts = new Map<number, { points: Set<string>; covered: Set<string> }>();
  for (const p of requestPoints) {
    const e = parts.get(p.part_idx) ?? { points: new Set<string>(), covered: new Set<string>() };
    e.points.add(p.id);
    parts.set(p.part_idx, e);
  }
  for (const d of drafts) {
    if ((d.status !== "pending" && d.status !== "kept") || d.check_state === "failed") continue;
    const e = parts.get(d.part_idx);
    if (!e) continue;
    for (const id of d.points) if (e.points.has(id)) e.covered.add(id);
  }
  return [...parts]
    .sort((a, b) => a[0] - b[0])
    .map(([part_idx, e]) => ({ part_idx, points: e.points.size, covered: e.covered.size }));
}

/** A draft "✓ להשאיר" and "להוסיף הכול" may take into the bank. */
export const keepable = (d: Pick<Draft, "status" | "check_state">): boolean => d.status === "pending" && (d.check_state === "ok" || d.check_state === "unchecked");

// ── What op "questions" answers (docs/study/practice-2-api.md §2) ──

type Levels3 = Record<Exclude<Level, "custom">, number>;

/** Action "plan" (free): the setup screen's numbers. */
export type PlanAnswer = {
  lecture: { slides: number };
  parts: PointsPart[];
  points: { total: number; current: boolean; stale: number[]; busy: boolean };
  levels: Levels3;
  plan: { level: Level; total: number; parts: Plan["parts"]; batches: number };
  estimate: {
    readUsd: number;
    questionsUsd: number;
    solverUsd: number;
    totalUsd: number;
    perQuestionUsd: number;
    levels: Levels3;
    rewordUsd: number;
    styleUsd: number;
  };
  spent: { groupUsd: number | null; mineUsd: number | null; capUsd: number; share: number; memberShare: number | null };
};

/** Action "create": the request and the batches to write one by one. */
export type CreateAnswer = {
  request: { id: string; round: number; level: Level; count: number; parts: number[]; styles: Style[]; difficulty: Difficulty };
  batches: Array<{ id: string; part_idx: number; seq: number; wanted: number }>;
  plan: Plan["parts"];
  estimate: { questionsUsd: number };
};

/** Action "style": the example read back, to send again with "create". */
export type StyleAnswer = StyleRead & { optionCount: number; case: boolean; costUsd: number; unsettled: number };

/** A line of action "points". */
export type PointsLine =
  | { t: "start" }
  | { t: "part"; part: number; points: number }
  | { t: "fail"; part: number; why: string }
  | { t: "done"; parts: number; points: number; costUsd: number; unsettled: number };

/** A draft as a stream line carries it: its public fields, just saved. */
export type DraftOnLine = Omit<Draft, "lecture_id" | "status" | "check_state" | "question_id" | "created_at" | "updated_at" | "batch_id"> & {
  batch_id: string;
  check_state: "checking";
};

/** A line of writing a batch (no action, or "write") or of action "reword". */
export type WriteLine =
  | { t: "start" }
  | { t: "q"; q: { id: string; part_idx: number; kind: "mcq" | "case"; difficulty: number; vignette: string; question: string; options: string[]; slides: number[]; topic: string; aspect: string; anchor: number | null; teaser: string; figure: string; option_tags: string[]; style: Style | null; form?: Form; layout?: Layout | null; series?: string | null; step?: number | null } }
  | { t: "draft"; d: DraftOnLine; replaces?: string }
  | { t: "check"; id: string; state: "ok" | "failed" | "unchecked" }
  | { t: "drop"; id: string }
  | { t: "skip"; why: string }
  | { t: "done"; made: number; rejected: number; solverRejected: number; costUsd: number; unsettled: number };

// ── "סבב חדש": the counts, private to the member ──

export type SessionState = "new" | "wrong" | "right";
/** One row of study_session_counts: how many of the caller's questions are in this cell. */
export type SessionCount = { lecture_id: string; part_idx: number; style: Style | "other"; state: SessionState; flagged: boolean; n: number };
/** "מאיפה": לא נענו · טעיתי · סימנתי · הכול. */
export type Source = "new" | "wrong" | "flagged" | "all";
export const SOURCE_HE: Record<Source, string> = { new: "לא נענו", wrong: "טעיתי", flagged: "סימנתי", all: "הכול" };

/** How many questions a choice gives: the union of the chosen sources,
 *  within the chosen parts and styles (none chosen: all of them). */
export function sessionCount(
  rows: readonly SessionCount[],
  pick: { sources: readonly Source[]; parts?: readonly number[]; styles?: readonly (Style | "other")[]; lectures?: readonly string[] },
): number {
  const parts = pick.parts?.length ? new Set(pick.parts) : null;
  const styles = pick.styles?.length ? new Set(pick.styles) : null;
  const lectures = pick.lectures?.length ? new Set(pick.lectures) : null;
  const all = pick.sources.includes("all");
  return rows
    .filter((r) => (!parts || parts.has(r.part_idx)) && (!styles || styles.has(r.style)) && (!lectures || lectures.has(r.lecture_id)))
    .filter((r) => all || pick.sources.includes(r.state as Source) || (r.flagged && pick.sources.includes("flagged")))
    .reduce((s, r) => s + r.n, 0);
}

/** Each source's chip count for the chosen parts and styles ("לא נענו · 9"). */
export function sourceCounts(
  rows: readonly SessionCount[],
  pick: { parts?: readonly number[]; styles?: readonly (Style | "other")[]; lectures?: readonly string[] } = {},
): Record<Source, number> {
  const one = (s: Source) => sessionCount(rows, { ...pick, sources: [s] });
  return { new: one("new"), wrong: one("wrong"), flagged: one("flagged"), all: one("all") };
}
