import { SUMMARY_PRICES } from "./batch.js";
import { CHARS_PER_TOKEN } from "./prices.js";

/* ── What reading a past exam usually costs (sources.md B6.2, B10) ──
 *
 * "להעלות ולהעתיק את השאלות · כ-$1.40": the phone shows the price before a
 * byte is uploaded, so the sum lives here, pure, and the server's
 * examPriceUsd (server/study/exams.ts, the op exam_read's reservation) calls
 * the same function with its prompts' real lengths (server/study/exams.test.ts
 * checks that EXAM_PROMPT_CHARS below is what the prompts are). Not a
 * reservation: each unit reserves its own worst case when it runs. */

/** The read, key and solve prompts' lengths in characters (the system prompts). */
export const EXAM_PROMPT_CHARS = { read: 3421, key: 1299, solve: 861 } as const;
/** Pages are stored at most 1,500 px on the long side (the phone's pdf.ts and images.ts), A4 shaped. */
export const EXAM_PAGE_SIDE = 1500;
/** A read unit's pages (B6.2): 4, with the page after them and the page before them as context. */
export const READ_PAGES = 4;
/** What a typical unit writes (a solve unit's thinking included), and the questions a page holds on average. */
const TYPICAL_READ_OUT = 6_000;
const TYPICAL_SOLVE_OUT = 5_000;
const ITEMS_PER_PAGE = 3.3;

/** A picture's input tokens: width × height / 750 (budget.ts's imageTokens). */
const pictureTokens = (w: number, h: number) => Math.ceil((w * h) / 750);
/** An A4 page 1,500 px tall: 1,061 × 1,500. */
const PAGE_TOKENS = pictureTokens(Math.round(EXAM_PAGE_SIDE / 1.414), EXAM_PAGE_SIDE);

/** One call's usual price: its input at the plain input rate (the systems are
 *  too short to be cached, so nothing is written to the cache), its output.
 *  Each unit's own reservation (estimateUsd) is the worst case, not this. */
function callUsd(inputChars: number, outTokens: number, imageTokens = 0): number {
  const input = Math.max(0, inputChars) / CHARS_PER_TOKEN + Math.max(0, imageTokens);
  return (input * SUMMARY_PRICES.in + Math.max(0, outTokens) * SUMMARY_PRICES.out) / 1_000_000;
}

/** The read units of an exam's pages, as section S queues them: 4 pages
 *  each (the key sheet's pages apart), each with the page after it as
 *  context (and, after the first, the page before it). */
export function readUnits(pages: readonly number[]): Array<{ pages: number[]; next: number | null }> {
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<{ pages: number[]; next: number | null }> = [];
  for (let i = 0; i < sorted.length; i += READ_PAGES) out.push({ pages: sorted.slice(i, i + READ_PAGES), next: sorted[i + READ_PAGES] ?? null });
  return out;
}

/** The usual price of reading an exam, in USD, rounded to cents: its read
 *  units at a typical output, the key sheet's unit, and, for an exam without
 *  answers, solving about 3.3 questions a page. */
export function examPriceUsd(o: { pages: number; keyPages?: number; keySource?: string }, prompts: { read: number; key: number; solve: number } = EXAM_PROMPT_CHARS): number {
  const pages = Math.max(0, Math.round(o.pages));
  const keyPages = Math.max(0, Math.round(o.keyPages ?? 0));
  if (!pages) return 0;
  let usd = 0;
  for (const u of readUnits(Array.from({ length: pages }, (_, i) => i + 1))) {
    const seen = u.pages.length + (u.next !== null ? 1 : 0) + (u.pages[0] > 1 ? 1 : 0);
    usd += callUsd(prompts.read + 400, TYPICAL_READ_OUT, seen * PAGE_TOKENS);
  }
  if (keyPages) usd += callUsd(prompts.key + 100, 600, keyPages * PAGE_TOKENS);
  if (o.keySource === "none") {
    const solve = Math.ceil((pages * ITEMS_PER_PAGE) / 20);
    usd += solve * callUsd(prompts.solve + 20 * 450, TYPICAL_SOLVE_OUT);
  }
  return Math.round(usd * 100) / 100;
}

/** "כ-$1.40" (at least "כ-$0.10", so a short exam never reads as free). */
export function priceText(usd: number): string {
  return `כ-$${Math.max(0.1, usd).toFixed(2)}`;
}
