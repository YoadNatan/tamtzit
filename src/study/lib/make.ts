import { emptyFacts, addFacts, canStyle, MCQ_STYLES, weightOf, type PartFacts } from "../../../shared/study/forms";
import {
  coverageAfter,
  DEFAULT_STYLES,
  planRequest,
  plannedStyles,
  REQUEST_MAX,
  STYLES,
  type Difficulty,
  type Plan,
  type PlanAnswer,
  type PlanInputs,
  type Style,
} from "../../../shared/study/practice2";

/* ── "סט חדש" on the phone: the defaults, the preview and the rules (practice sets, slice A) ──
 *
 * The create screen asks action "plan" with `inputs: true` once per lecture
 * (on open and when the lecture changes, never on a size or type change: D13)
 * and computes everything else here, with the same shared planner the server
 * plans with (shared/study/practice2.ts): how many questions of which types,
 * the bank's coverage after the set, and the price on the button. The rules
 * that block the button (the monthly lines, the daily limit, a lecture that
 * is full or not written yet) are decided here too, from the same answer,
 * so the screen and its tests agree. Pure but for the device's memory of the
 * last size and types (`study-make:<user>`, every access in try/catch). */

/** The size control: 5 · 10 · 20, 10 by default; "מספר אחר" is 1-40. */
export const SIZES = [5, 10, 20] as const;
export const DEFAULT_SIZE = 10;
export const CUSTOM_MAX = REQUEST_MAX;
/** The lecture's limit of active questions (study_draft_keep's). */
export const BANK_MAX = 150;
/** Below this many dollars of headroom the preview says "נשאר מעט מהתקציב החודשי". */
export const LOW_USD = 3;
/** A set above this many dollars asks first (OD17). */
export const BIG_USD = 1;
/** Two batches' worst-case reservations in flight: a set needs its cost plus this much headroom. */
export const MARGIN_USD = 1;
/** "בבנק יש N שאלות שעוד לא נענו" from this many. */
export const FREE_MIN = 5;
/** The daily line shows when this many or fewer new sets are left today. */
export const DAILY_SHOW = 2;

/** What the member chose on the screen (the lecture is the route's). */
export type MakeChoices = {
  /** One of SIZES, or the custom number (1-40). */
  size: number;
  custom: boolean;
  difficulty: Difficulty;
  /** null: the lecture's defaults (the server's `defaults`, else DEFAULT_STYLES). */
  styles: Style[] | null;
  /** null: every part with points. */
  parts: number[] | null;
  focus: string;
  exampleText: string;
  exampleImage: boolean;
};

export const DEFAULT_CHOICES: MakeChoices = {
  size: DEFAULT_SIZE,
  custom: false,
  difficulty: "exam",
  styles: null,
  parts: null,
  focus: "",
  exampleText: "",
  exampleImage: false,
};

/* ── The device's memory: the last size and types (never the lecture's parts or the focus) ── */

export type Sticky = { size?: number; styles?: Style[] };
const stickyKey = (user: string) => `study-make:${user}`;

export function readSticky(user: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): Sticky {
  try {
    const raw = storage?.getItem(stickyKey(user));
    const x = raw ? (JSON.parse(raw) as unknown) : null;
    if (!x || typeof x !== "object") return {};
    const o = x as Record<string, unknown>;
    const size = typeof o.size === "number" && Number.isInteger(o.size) && o.size >= 1 && o.size <= CUSTOM_MAX ? o.size : undefined;
    const styles = Array.isArray(o.styles) && o.styles.length && o.styles.every((s) => (STYLES as readonly unknown[]).includes(s)) ? (o.styles as Style[]) : undefined;
    return { ...(size ? { size } : {}), ...(styles ? { styles } : {}) };
  } catch {
    return {};
  }
}

export function writeSticky(user: string, s: Sticky, storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()): void {
  try {
    if (!s.size && !s.styles) storage?.removeItem(stickyKey(user));
    else storage?.setItem(stickyKey(user), JSON.stringify(s));
  } catch {
    // this device cannot keep it: the defaults next time
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The choices a screen opens with: the device's last size and types. */
export function initialChoices(sticky: Sticky): MakeChoices {
  const size = sticky.size ?? DEFAULT_SIZE;
  return { ...DEFAULT_CHOICES, size, custom: !(SIZES as readonly number[]).includes(size), styles: sticky.styles ?? null };
}

/* ── The lecture the screen opens on, without one in the route ── */

export type LectureLite = { id: string; title: string; course: string; status: string; created_at: string };

/** The last lecture the member marked read (study_reads), else the newest
 *  lecture whose summary is written, else the newest; null with none. */
export function defaultLecture(lectures: readonly LectureLite[], myReads: ReadonlyArray<{ lecture_id: string; read_at: string }>): string | null {
  const live = new Set(lectures.map((l) => l.id));
  const read = [...myReads].filter((r) => live.has(r.lecture_id)).sort((a, b) => Date.parse(b.read_at) - Date.parse(a.read_at))[0];
  if (read) return read.lecture_id;
  const newest = [...lectures].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return (newest.find((l) => l.status === "ready") ?? newest[0])?.id ?? null;
}

/** The lecture sheet's list: by course (lectures without one last), newest first in each, filtered by `q`. */
export function lectureGroups(lectures: readonly LectureLite[], q = ""): Array<{ course: string; lectures: LectureLite[] }> {
  const words = q.trim().toLowerCase();
  const by = new Map<string, LectureLite[]>();
  for (const l of [...lectures].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    if (words && !`${l.title} ${l.course}`.toLowerCase().includes(words)) continue;
    const k = l.course.trim();
    by.set(k, [...(by.get(k) ?? []), l]);
  }
  return [...by].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "he"))).map(([course, ls]) => ({ course, lectures: ls }));
}

/* ── The types a lecture offers ── */

/** The styles this build offers: the question types only with their flag. */
export const shownStyles = (qtypes: boolean): readonly Style[] => (qtypes ? STYLES : STYLES.filter((s) => (MCQ_STYLES as readonly string[]).includes(s)));

/** The chosen parts' facts together (none known: null, every type offered). */
export function factsFor(answer: Pick<PlanAnswer, "facts">, parts: readonly number[]): PartFacts | null {
  if (!answer.facts) return null;
  return parts.reduce((a, p) => addFacts(a, answer.facts?.[String(p)] ?? emptyFacts()), emptyFacts());
}

/** The chips the screen shows: the build's styles the chosen parts can have
 *  (a label item may fall back to a picture question). */
export function offeredStyles(qtypes: boolean, facts: PartFacts | null): Style[] {
  return shownStyles(qtypes).filter((s) => !facts || canStyle(s, facts) || (s === "label" && canStyle("image", facts)));
}

/** The lecture's default types: the server's for the chosen parts, else the approved four (offered only). */
export function defaultStyles(answer: Pick<PlanAnswer, "defaults">, offered: readonly Style[]): Style[] {
  const from = (answer.defaults?.length ? answer.defaults : DEFAULT_STYLES).filter((s) => offered.includes(s));
  return from.length ? STYLES.filter((s) => from.includes(s)) : offered.slice(0, 4);
}

/** The types a set is written in, and where they come from ("ברירת מחדל" · "מהפעם הקודמת"). */
export function stylesOf(choices: Pick<MakeChoices, "styles">, answer: Pick<PlanAnswer, "defaults">, offered: readonly Style[]): { styles: Style[]; from: "default" | "last" } {
  const mine = choices.styles?.filter((s) => offered.includes(s)) ?? [];
  if (mine.length) return { styles: STYLES.filter((s) => mine.includes(s)), from: "last" };
  return { styles: defaultStyles(answer, offered), from: "default" };
}

/* ── The preview ── */

/** The preview's type groups, in this order: what the tiles and the legend show. */
export const TILE_GROUPS: ReadonlyArray<{ key: string; he: string; styles: readonly Style[] }> = [
  { key: "mcq", he: "אמריקאית", styles: ["mechanism", "drug_choice", "adverse_contra", "compare", "not_true"] },
  { key: "case", he: "מקרה", styles: ["case", "steps"] },
  { key: "table", he: "טבלה", styles: ["blank_table"] },
  { key: "picture", he: "תמונה", styles: ["image", "label"] },
  { key: "tf", he: "נכון/לא נכון", styles: ["tf"] },
  { key: "match", he: "התאמה", styles: ["match"] },
  { key: "order", he: "סידור", styles: ["order"] },
];

export type Preview = {
  plan: Plan;
  /** Questions the set writes. */
  total: number;
  /** Per type group with any: "6 אמריקאית · 3 מקרה". */
  groups: Array<{ key: string; he: string; n: number }>;
  cover: ReturnType<typeof coverageAfter>;
  /** The writing (weighted by type), the lecture's read when stale, the example's read. */
  usd: { questions: number; read: number; example: number; total: number };
  /** The parts the set takes (every part with points when none was chosen). */
  parts: number[];
  styles: Style[];
  stylesFrom: "default" | "last";
  /** No points read yet (all stale): the count and the price are the size's,
   *  planned once the generating screen has read the lecture. */
  estimated: boolean;
};

/** Rounded up to the cent, as the screens print a price. */
export const cents = (x: number): number => Math.ceil(Math.max(0, x) * 100 - 1e-9) / 100 || 0;

/** The parts with points, and the parts a set takes. */
export function partsOf(inputs: Pick<PlanInputs, "points">, chosen: readonly number[] | null, unread: readonly number[] = []): { all: number[]; chosen: number[] } {
  // A lecture never read has no points yet: its parts are the ones to be read (`unread`).
  const fromPoints = [...new Set(inputs.points.map((p) => p.part_idx))];
  const all = (fromPoints.length ? fromPoints : [...new Set(unread)]).sort((a, b) => a - b);
  const picked = chosen?.filter((p) => all.includes(p)) ?? [];
  return { all, chosen: picked.length ? picked : all };
}

/** The set the choices make, computed on the phone as the server will plan it
 *  (custom level, `size` questions, fresh first) with its price. */
/** The parts a lecture's points will come from: those with points, and those still to be read. */
export const partIdxsOf = (answer: { parts?: PlanAnswer["parts"]; points: Pick<PlanAnswer["points"], "stale"> }): number[] =>
  (answer.parts ?? []).filter((p) => p.points > 0 || answer.points.stale.includes(p.part_idx)).map((p) => p.part_idx);

export function previewOf(answer: Pick<PlanAnswer, "facts" | "defaults" | "points"> & { parts?: PlanAnswer["parts"] }, inputs: PlanInputs, choices: MakeChoices, qtypes: boolean): Preview {
  const parts = partsOf(inputs, choices.parts, partIdxsOf(answer));
  const facts = factsFor(answer, parts.chosen);
  const offered = offeredStyles(qtypes, facts);
  const { styles, from } = stylesOf(choices, answer, offered);
  const partFacts = answer.facts ? new Map(Object.entries(answer.facts).map(([k, v]) => [Number(k), v])) : undefined;
  const plan = planRequest({
    points: inputs.points,
    level: "custom",
    count: Math.max(1, Math.min(CUSTOM_MAX, Math.round(choices.size) || 1)),
    parts: parts.chosen,
    styles,
    partFacts,
    covered: inputs.covered,
  });
  const counts = new Map<Style, number>();
  for (const s of plannedStyles(plan)) counts.set(s, (counts.get(s) ?? 0) + 1);
  const groups = TILE_GROUPS.map((g) => ({ key: g.key, he: g.he, n: g.styles.reduce((n, s) => n + (counts.get(s) ?? 0), 0) })).filter((g) => g.n > 0);
  const size = Math.max(1, Math.min(CUSTOM_MAX, Math.round(choices.size) || 1));
  const estimated = plan.total === 0 && answer.points.stale.length > 0;
  const questions = cents((estimated ? size : weightOf(plannedStyles(plan))) * inputs.perQuestionUsd);
  const read = answer.points.stale.length ? cents(inputs.readUsd) : 0;
  const example = choices.exampleText.trim() || choices.exampleImage ? cents(inputs.styleUsd) : 0;
  return {
    plan,
    total: estimated ? size : plan.total,
    groups,
    cover: coverageAfter(inputs.points, inputs.covered, plan),
    usd: { questions, read, example, total: cents(questions + read + example) },
    parts: parts.chosen,
    styles,
    stylesFrom: from,
    estimated,
  };
}

/* ── What blocks the button, and the lines under the preview ── */

export type Block = "notReady" | "full" | "cap" | "capMine" | "line" | "daily" | "tooBig" | "noTypes" | "noPoints" | "off";

/** The smallest headroom known (USD), or null when none is. */
export function smallestHeadroom(h: PlanInputs["headroom"]): number | null {
  const known = [h.group80, h.member40, h.line].filter((x): x is number => typeof x === "number");
  return known.length ? Math.min(...known) : null;
}

/** Why the button is off, first reason first, or null. A line already
 *  reached says so; a set too big for what is left says to make a smaller
 *  one (smaller sizes stay on). */
export function blockOf(answer: Pick<PlanAnswer, "parts" | "points">, inputs: PlanInputs, preview: Pick<Preview, "total" | "styles" | "usd">): Block | null {
  const written = answer.parts.some((p) => p.summary === "ready");
  if (!written) return "notReady";
  if (inputs.active >= BANK_MAX) return "full";
  const h = inputs.headroom;
  if (h.group80 !== null && h.group80 <= 0) return "cap";
  if (h.member40 !== null && h.member40 <= 0) return "capMine";
  if (h.line !== null && h.line <= 0) return "line";
  if (inputs.dailyLeft !== null && inputs.dailyLeft <= 0) return "daily";
  const room = smallestHeadroom(h);
  if (room !== null && room < preview.usd.total + MARGIN_USD) return "tooBig";
  if (!preview.styles.length) return "noTypes";
  // Points still to read: the generating screen reads them first, then plans.
  if (preview.total === 0 && !answer.points.stale.length) return "noPoints";
  return null;
}

/** The quiet lines under the preview: little headroom left, sets left today. */
export function notesOf(inputs: PlanInputs): { low: boolean; dailyLeft: number | null } {
  const room = smallestHeadroom(inputs.headroom);
  const d = inputs.dailyLeft;
  return { low: room !== null && room < LOW_USD, dailyLeft: d !== null && d > 0 && d <= DAILY_SHOW ? d : null };
}

/** The size a 402 or a refusal of "create" maps to (the screen's words for it), or null for another code. */
export function blockOfCode(code: string): Block | null {
  switch (code) {
    case "budget":
    case "reserve":
      return "cap";
    case "member_share":
      return "capMine";
    case "sets_line":
      return "line";
    case "daily_limit":
      return "daily";
    case "too_big":
      return "tooBig";
    case "off":
      return "off";
    case "summary not ready":
      return "notReady";
    case "lecture full":
    case "bank full":
      return "full";
    default:
      return null;
  }
}

/** The bank's free questions are worth a link from this many. */
export const freeWorthIt = (free: number | null): boolean => free !== null && free >= FREE_MIN;

/** A set above $1 asks first (OD17). */
export const isBig = (usd: number): boolean => usd > BIG_USD;

/* ── The keyboard (pointer: fine): ←/→ the size, Enter creates ── */

export type KeyTarget = { tag: string; type?: string; editable?: boolean; isButtonGo?: boolean; isBody?: boolean };

/** What a key does on the create screen: "smaller", "bigger", "go", or null.
 *  In a right-to-left row the sizes run from the right (5) to the left (20):
 *  ← is bigger. Nothing while focus is in a text or number field, a select
 *  or a text area; Enter creates only from the page's body or the button. */
export function keyAction(key: string, t: KeyTarget, mods: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}): "smaller" | "bigger" | "go" | null {
  if (mods.alt || mods.ctrl || mods.meta) return null;
  const tag = t.tag.toUpperCase();
  if (t.editable || tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !["radio", "checkbox", "button"].includes((t.type ?? "text").toLowerCase()))) return null;
  if (key === "Enter") return t.isButtonGo || t.isBody ? "go" : null;
  if (tag === "BUTTON" && !t.isButtonGo && !t.isBody && key !== "ArrowLeft" && key !== "ArrowRight") return null;
  if (key === "ArrowLeft") return "bigger";
  if (key === "ArrowRight") return "smaller";
  return null;
}

/** The next size in the control (5 · 10 · 20), from a custom number to its nearest. */
export function stepSize(size: number, dir: "smaller" | "bigger"): number {
  if (dir === "bigger") return SIZES.find((s) => s > size) ?? SIZES[SIZES.length - 1];
  return [...SIZES].reverse().find((s) => s < size) ?? SIZES[0];
}

/* ── The generating screen ── */

export type TileState = "coming" | "ready" | "failed";
export type TileBatch = { id: string; wanted: number; made: number; status: "pending" | "writing" | "ready" | "failed"; error?: string | null; attempts?: number };
export type TileDraft = { id: string; batch_id: string | null; status: string; check_state: string; series?: string | null; step?: number | null };

/** A draft that counts as a question ready to solve: pending or kept, the
 *  check passed or could not run; a staged case's later steps not counted. */
export const readyDraft = (d: TileDraft): boolean =>
  (d.status === "pending" || d.status === "kept") && (d.check_state === "ok" || d.check_state === "unchecked") && !(d.series && (d.step ?? 1) > 1);

/** The set's tiles in batch order, one per wanted question: מוכנה, בדרך
 *  (waiting, written, checked or rewritten), לא יצאה (its batch failed, or
 *  ended with fewer). `unchecked`: ready ones the check could not run on. */
export function tilesOf(batches: readonly TileBatch[], drafts: readonly TileDraft[]): { tiles: TileState[]; ready: number; coming: number; failed: number; unchecked: number } {
  const tiles: TileState[] = [];
  let unchecked = 0;
  for (const b of batches) {
    const mine = drafts.filter((d) => d.batch_id === b.id && readyDraft(d));
    unchecked += mine.filter((d) => d.check_state === "unchecked").length;
    const ready = Math.min(b.wanted, mine.length);
    const over = b.status === "ready" || b.status === "failed";
    for (let i = 0; i < b.wanted; i++) tiles.push(i < ready ? "ready" : over ? "failed" : "coming");
  }
  return {
    tiles,
    ready: tiles.filter((t) => t === "ready").length,
    coming: tiles.filter((t) => t === "coming").length,
    failed: tiles.filter((t) => t === "failed").length,
    unchecked,
  };
}

/** The live region's moments: the first ready question, each 25% step and
 *  the end; the step a count is at (−1 before the first). */
export function progressStep(ready: number, total: number): number {
  if (total <= 0 || ready <= 0) return -1;
  if (ready >= total) return 4;
  return Math.floor((4 * ready) / total);
}

/** The round's size for k questions (?n=: 5, 10, 20, or all of them). */
export const roundSize = (k: number): "5" | "10" | "20" | "all" => (k <= 5 ? "5" : k <= 10 ? "10" : k <= 20 ? "20" : "all");

/** The codes that stop a set for the budget, which "לנסות שוב" cannot help. */
export const BUDGET_CODES: ReadonlySet<string> = new Set(["budget", "reserve", "member_share", "daily_limit", "sets_line", "off"]);
