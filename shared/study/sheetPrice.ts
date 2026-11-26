import { estimateUsd } from "./estimate.js";
import { EXAM_PAGE_SIDE, EXAM_PROMPT_CHARS, examPriceUsd, readUnits } from "./examPrice.js";

/* ── What reading an uploaded sheet costs, and its bounds (docs/study/sheets.md;
 *    design-exams §5.2, §8.4, OD13) ──
 *
 * Release A0 reads a sheet with the past exams' reader as it is (4-page read
 * units, a key unit for an answers file, solve units of 20 items), so its
 * usual price is examPriceUsd's. What is new is the worst case, which the op
 * exam_read checks before a sheet is read: every unit at all of its
 * max_tokens, and every page as full as a page gets. A sheet is read only
 * when that worst case fits the sheets line (STUDY_SHEETS_MONTHLY_USD, $6)
 * and the room under the group's 80% line. Pure: the phone shows the usual
 * price and the minutes; the server reserves and checks with the same
 * numbers (server/study/exams.test.ts pins the unit sizes to the reader's). */

/** At most this many pages a sheet (OD13); an answers file at most KEY_MAX_PAGES. */
export const SHEET_MAX_PAGES = 40;
export const SHEET_KEY_MAX_PAGES = 10;
/** Above this usual price the upload asks once more ("הדף ארוך … להמשיך?"). */
export const SHEET_CONFIRM_USD = 3;
/** The exam reader's units (server/study/exams.ts): max_tokens, and items a solve unit. */
export const EXAM_UNIT_TOKENS = { read: 12_000, key: 4_000, solve: 16_000 } as const;
export const EXAM_SOLVE_ITEMS = 20;
/** The worst case's page: its text lines (a PDF's, as many as the reader is sent) and its items. */
const WORST_LINES_CHARS = 4_000;
const WORST_ITEMS_PER_PAGE = 8;
/** A solve item as the request writes it, at most (question, options, prompts). */
const WORST_ITEM_CHARS = 1_600;

const PAGE_TOKENS = Math.ceil((Math.round(EXAM_PAGE_SIDE / 1.414) * EXAM_PAGE_SIDE) / 750);

export type SheetSize = { pages: number; keyPages?: number; keySource?: string };

/** The usual price: the exam reader's (release A0). */
export const sheetPriceUsd = (o: SheetSize, prompts: { read: number; key: number; solve: number } = EXAM_PROMPT_CHARS): number => examPriceUsd(o, prompts);

/** The worst case in USD (every unit at all of its max_tokens), rounded up
 *  to the cent: the read units with their context pages, the answers file's
 *  unit, and solve units for 8 items a page with no answers (2 a page when
 *  the answers are marked or in a file: the items they missed). */
export function sheetWorstUsd(o: SheetSize, model: string, prompts: { read: number; key: number; solve: number } = EXAM_PROMPT_CHARS): number {
  const pages = Math.max(0, Math.round(o.pages));
  const keyPages = Math.max(0, Math.round(o.keyPages ?? 0));
  if (!pages) return 0;
  let usd = 0;
  for (const u of readUnits(Array.from({ length: pages }, (_, i) => i + 1))) {
    const seen = u.pages.length + (u.next !== null ? 1 : 0) + (u.pages[0] > 1 ? 1 : 0);
    usd += estimateUsd(model, prompts.read + 600 + seen * (WORST_LINES_CHARS + 120), EXAM_UNIT_TOKENS.read, seen * PAGE_TOKENS);
  }
  if (keyPages) usd += estimateUsd(model, prompts.key + 200 + keyPages * (WORST_LINES_CHARS + 120), EXAM_UNIT_TOKENS.key, keyPages * PAGE_TOKENS);
  // Items the marks or the answers file left without an answer are solved too: a quarter of them at worst.
  const items = Math.ceil((pages * WORST_ITEMS_PER_PAGE) / (o.keySource === "none" || o.keySource === undefined ? 1 : 4));
  for (let left = items; left > 0; left -= EXAM_SOLVE_ITEMS) {
    const n = Math.min(EXAM_SOLVE_ITEMS, left);
    usd += estimateUsd(model, prompts.solve + n * WORST_ITEM_CHARS, EXAM_UNIT_TOKENS.solve);
  }
  return Math.ceil(usd * 100) / 100;
}

/** "לרוב 5–10 דקות" for a sheet of n pages (the units run one after another
 *  at the group's pace; solving adds a few minutes). Pure. */
export function sheetMinutes(o: SheetSize): { from: number; to: number } {
  const pages = Math.max(0, Math.round(o.pages));
  const units = readUnits(Array.from({ length: pages }, (_, i) => i + 1)).length + (o.keyPages ? 1 : 0);
  const solve = o.keySource === "none" ? Math.ceil((pages * 3.3) / EXAM_SOLVE_ITEMS) : 0;
  const from = Math.max(5, 2 * (units + solve));
  return { from, to: Math.max(10, 2 * from) };
}

/** Why a sheet of this size cannot be read, or "": over 40 pages, or an answers file over 10. */
export function sheetSizeProblem(o: SheetSize): "" | "too many pages" {
  return o.pages > SHEET_MAX_PAGES || (o.keyPages ?? 0) > SHEET_KEY_MAX_PAGES ? "too many pages" : "";
}

/* ── The sheet reader (release A1, section O 2; server/study/sheets.ts) ──
 * A sheet read with the client's forms: read units of 3 pages, an answers
 * file read by label, and items without an answer solved SHEET_SOLVE_PER_UNIT
 * a unit with a worked solution (study_private.sheet_solve_items() queues
 * them; server/study/sheets.test.ts pins the two numbers to each other and
 * the prompts' lengths below to the prompts). The usual price is what the
 * button shows (design §11.1: about $0.066 a page to copy, $0.024 an item
 * solved); the worst case is what the op checks against the sheets line and
 * the headroom, as for release A0. */

/** The sheet prompts' lengths in characters (server/study/prompts/sheets.ts). */
export const SHEET_PROMPT_CHARS = { read: 4481, key: 1614, solve: 1924 } as const;
/** Pages a read unit, items a solve unit (study_private.sheet_solve_items()). */
export const SHEET_READ_PAGES = 3;
export const SHEET_SOLVE_PER_UNIT = 4;
/** The sheet reader's max_tokens: a read unit, the answers file's unit, and a solve unit of n items. */
export const SHEET_UNIT_TOKENS = { read: 16_000, key: 6_000, solveMax: 14_000 } as const;
export const sheetSolveTokens = (n: number): number => Math.min(SHEET_UNIT_TOKENS.solveMax, 2_000 + 2_500 * Math.max(1, Math.round(n)));
/** What a usual unit writes: a page copied exactly (with thinking), a key page, an item solved with its worked solution. */
const SHEET_TYPICAL = { outPerPage: 1_800, keyOutPerPage: 900, solveOutPerItem: 1_000, itemsPerPage: 3, missedPerPage: 0.75 };

/** The sheet reader's read units: 3 pages each, the next page as context. */
export function sheetReadUnits(pages: readonly number[]): Array<{ pages: number[]; next: number | null }> {
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<{ pages: number[]; next: number | null }> = [];
  for (let i = 0; i < sorted.length; i += SHEET_READ_PAGES) out.push({ pages: sorted.slice(i, i + SHEET_READ_PAGES), next: sorted[i + SHEET_READ_PAGES] ?? null });
  return out;
}

/** One call's usual price: its input at the plain rate, its output. */
function readerCallUsd(inputChars: number, outTokens: number, images = 0): number {
  return ((Math.max(0, inputChars) / 2.5 + Math.max(0, images)) * 4 + Math.max(0, outTokens) * 20) / 1_000_000;
}

/** The usual price of a sheet read by the sheet reader, in USD, to the cent. */
export function sheetReaderPriceUsd(o: SheetSize, prompts: { read: number; key: number; solve: number } = SHEET_PROMPT_CHARS): number {
  const pages = Math.max(0, Math.round(o.pages));
  const keyPages = Math.max(0, Math.round(o.keyPages ?? 0));
  if (!pages) return 0;
  let usd = 0;
  for (const u of sheetReadUnits(Array.from({ length: pages }, (_, i) => i + 1))) {
    const seen = u.pages.length + (u.next !== null ? 1 : 0) + (u.pages[0] > 1 ? 1 : 0);
    usd += readerCallUsd(prompts.read + 600, u.pages.length * SHEET_TYPICAL.outPerPage, seen * PAGE_TOKENS);
  }
  if (keyPages) usd += readerCallUsd(prompts.key + 200, keyPages * SHEET_TYPICAL.keyOutPerPage, keyPages * PAGE_TOKENS);
  const items = Math.ceil(pages * (o.keySource === "none" || o.keySource === undefined ? SHEET_TYPICAL.itemsPerPage : SHEET_TYPICAL.missedPerPage));
  for (let left = items; left > 0; left -= SHEET_SOLVE_PER_UNIT) {
    const n = Math.min(SHEET_SOLVE_PER_UNIT, left);
    usd += readerCallUsd(prompts.solve + n * 600, n * SHEET_TYPICAL.solveOutPerItem);
  }
  return Math.round(usd * 100) / 100;
}

/** The worst case of a sheet read by the sheet reader (every unit at all of
 *  its max_tokens, every page as full as a page gets, 8 items a page solved
 *  with no answers, 2 a page with them), rounded up to the cent. */
export function sheetReaderWorstUsd(o: SheetSize, model: string, prompts: { read: number; key: number; solve: number } = SHEET_PROMPT_CHARS): number {
  const pages = Math.max(0, Math.round(o.pages));
  const keyPages = Math.max(0, Math.round(o.keyPages ?? 0));
  if (!pages) return 0;
  let usd = 0;
  for (const u of sheetReadUnits(Array.from({ length: pages }, (_, i) => i + 1))) {
    const seen = u.pages.length + (u.next !== null ? 1 : 0) + (u.pages[0] > 1 ? 1 : 0);
    usd += estimateUsd(model, prompts.read + 600 + seen * (WORST_LINES_CHARS + 120), SHEET_UNIT_TOKENS.read, seen * PAGE_TOKENS);
  }
  if (keyPages) usd += estimateUsd(model, prompts.key + 200 + keyPages * (WORST_LINES_CHARS + 120), SHEET_UNIT_TOKENS.key, keyPages * PAGE_TOKENS);
  const items = Math.ceil((pages * WORST_ITEMS_PER_PAGE) / (o.keySource === "none" || o.keySource === undefined ? 1 : 4));
  for (let left = items; left > 0; left -= SHEET_SOLVE_PER_UNIT) {
    const n = Math.min(SHEET_SOLVE_PER_UNIT, left);
    // a solve unit may attach one figure page per item
    usd += estimateUsd(model, prompts.solve + n * (WORST_ITEM_CHARS + 60), sheetSolveTokens(n), n * PAGE_TOKENS);
  }
  return Math.ceil(usd * 100) / 100;
}

/** "להעתיק גם N שאלות פתוחות · כ-$…" (OD15): the pages of the read units that
 *  skipped them read again for their open questions, and those solved. The
 *  usual price and the worst case (the pages' units at all of max_tokens;
 *  every skipped question solved, at most 8 a page). */
export function openAddPriceUsd(o: { pages: number; skipped: number }, prompts: { read: number; key: number; solve: number } = SHEET_PROMPT_CHARS): number {
  const pages = Math.max(0, Math.round(o.pages));
  const skipped = Math.max(0, Math.round(o.skipped));
  if (!pages || !skipped) return 0;
  const units = Math.ceil(pages / 4);
  let usd = units * readerCallUsd(prompts.read + 600, Math.min(pages, 4) * 600 + 1_000, 6 * PAGE_TOKENS);
  for (let left = skipped; left > 0; left -= SHEET_SOLVE_PER_UNIT) {
    const n = Math.min(SHEET_SOLVE_PER_UNIT, left);
    usd += readerCallUsd(prompts.solve + n * 600, n * SHEET_TYPICAL.solveOutPerItem);
  }
  return Math.round(usd * 100) / 100;
}
export function openAddWorstUsd(o: { pages: number; skipped: number }, model: string, prompts: { read: number; key: number; solve: number } = SHEET_PROMPT_CHARS): number {
  const pages = Math.max(0, Math.round(o.pages));
  const skipped = Math.max(0, Math.round(o.skipped));
  if (!pages || !skipped) return 0;
  const units = Math.ceil(pages / 4);
  let usd = units * estimateUsd(model, prompts.read + 600 + 6 * (WORST_LINES_CHARS + 120), SHEET_UNIT_TOKENS.read, 6 * PAGE_TOKENS);
  for (let left = Math.min(skipped, pages * WORST_ITEMS_PER_PAGE); left > 0; left -= SHEET_SOLVE_PER_UNIT) {
    const n = Math.min(SHEET_SOLVE_PER_UNIT, left);
    usd += estimateUsd(model, prompts.solve + n * (WORST_ITEM_CHARS + 60), sheetSolveTokens(n), n * PAGE_TOKENS);
  }
  return Math.ceil(usd * 100) / 100;
}
