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
