/* ── The batch upload's price, before anything is uploaded (sources.md B8, B9) ──
 *
 * "העלאה של כמה קבצים" shows one card before the upload:
 *   "סיכומים ל-8 הרצאות: כ-$7 · נשארו החודש $24"
 *   "3 סיכומים יחכו לחודש הבא. ההרצאות עצמן עולות עכשיו."
 * The files are read on the phone first (slides, characters, pictures), so
 * the price is known before a byte is sent. What is left this month comes
 * from the ledger: the group's spend (study_spent, which members may call)
 * against the cap (/api/study/health's budgetUsd). Pure, so the phone shows
 * it and the tests check it; no call costs anything.
 *
 * A summary is written as soon as its lecture is uploaded and stops only at
 * the month's cap (the writer's kinds, outline and part, have share 1 in
 * budget.ts's POLICY: the 80% line keeps the last fifth for summaries). But
 * each part reserves its worst case before its call (PART_TOKENS of output,
 * about $1), and up to 3 parts of the group are written at once, so parts are
 * refused while about 3 × that is still left. The summaries that do not fit
 * under the cap less that room (and the points read ahead after each summary,
 * when that switch is on), in upload order, wait for next month: the batch
 * uploads those lectures now but does not hand them to the writer
 * (UploadMany, lib/later.ts), so none is refused half way. */

/** What the phone read of one lecture file. */
export type DeckSize = { slides: number; chars: number; pictures: number };

/** USD per million tokens for the writer's model: input, output, a 5-minute
 *  cache write, a cache hit (budget.ts's PRICES; server/study/batch.test.ts
 *  checks they are the same). */
export const SUMMARY_PRICES = { in: 4, out: 20, w5m: 5, hit: 0.2 } as const;
/** 2.5 Hebrew characters a token, as every estimate (budget.ts). */
const CHARS_PER_TOKEN = 2.5;
/** A picture as the writer sends it (at most 1,400 px): about 1,600 tokens. */
const PICTURE_TOKENS = 1_600;
/** The outline's output (thinking included), and a part's per slide. */
const OUTLINE_OUT = 3_000;
const PART_OUT_BASE = 1_500;
const PART_OUT_PER_SLIDE = 450;
/** A part covers about this many slides (the outline's parts). */
const SLIDES_PER_PART = 8;
/** The system prompt and a part's request, in tokens. */
const PROMPT_TOKENS = 3_000;
/** The output a part reserves (server/study/writer.ts's PART_TOKENS), and how
 *  many units of a group are written at once (study_private.plan's 3). */
export const PART_RESERVE_TOKENS = 48_000;
export const WRITERS_AT_ONCE = 3;
/** The points read ahead after a summary (package B, the switch
 *  points_ahead): about $5 for a block of 25 lectures (sources.md B10). */
export const POINTS_AHEAD_USD = 0.2;

/** The usual cost of one lecture's summary, in USD: the outline reads the
 *  deck once (written to the cache), then each part reads it from the
 *  cache with its own pictures and writes its text. A typical figure for
 *  "כ-", not the worst case each call reserves. A 40-slide deck of 30,000
 *  characters and 20 pictures: about $0.85 ("A lecture costs under $1"). */
export function summaryUsd(d: DeckSize): number {
  const slides = Math.max(1, Math.round(d.slides) || 1);
  const deck = Math.max(0, d.chars) / CHARS_PER_TOKEN + PROMPT_TOKENS;
  const parts = Math.max(1, Math.round(slides / SLIDES_PER_PART));
  const pictures = Math.max(0, d.pictures) * PICTURE_TOKENS;
  const outline = deck * SUMMARY_PRICES.w5m + OUTLINE_OUT * SUMMARY_PRICES.out;
  const writing =
    parts * (deck * SUMMARY_PRICES.hit + PROMPT_TOKENS * SUMMARY_PRICES.in) +
    pictures * SUMMARY_PRICES.in +
    (parts * PART_OUT_BASE + slides * PART_OUT_PER_SLIDE) * SUMMARY_PRICES.out;
  return (outline + writing) / 1_000_000;
}

/** What one part of this deck reserves before its call, in USD: the deck and
 *  the request at the dearer of the input and cache-write prices, the part's
 *  share of the pictures, and PART_RESERVE_TOKENS of output (budget.ts's
 *  estimateUsd). The worst case, not the usual cost. */
export function partReserveUsd(d: DeckSize): number {
  const slides = Math.max(1, Math.round(d.slides) || 1);
  const parts = Math.max(1, Math.round(slides / SLIDES_PER_PART));
  const input = Math.max(0, d.chars) / CHARS_PER_TOKEN + PROMPT_TOKENS + (Math.max(0, d.pictures) * PICTURE_TOKENS) / parts;
  return (input * Math.max(SUMMARY_PRICES.in, SUMMARY_PRICES.w5m) + PART_RESERVE_TOKENS * SUMMARY_PRICES.out) / 1_000_000;
}

export type BatchCost = {
  /** Each file's summary, in upload order. */
  perFile: number[];
  /** All the summaries together. */
  summariesUsd: number;
  /** What is left this month before the cap (never below 0). */
  leftUsd: number;
  /** What the writers' reservations hold at once (3 parts' worst case): the
   *  summaries fit in leftUsd less this. */
  headroomUsd: number;
  /** How many summaries do not fit this month (the last ones in upload
   *  order): "3 סיכומים יחכו לחודש הבא". */
  waiting: number;
  /** Little is left this month (under $10): "כדאי להעלות בתחילת החודש". */
  low: boolean;
};

/** Below this much left, the card suggests the start of next month. */
export const LOW_LEFT_USD = 10;

/** The card's numbers for these lectures, from the month's spend and cap
 *  (`share` × cap is where summaries stop: 1, as POLICY's outline and part;
 *  `ahead`: the points are read ahead after each summary). */
export function batchCost(files: DeckSize[], money: { spentUsd: number; capUsd: number; share?: number; ahead?: boolean }): BatchCost {
  const perFile = files.map(summaryUsd);
  const line = Math.max(0, money.capUsd) * (money.share ?? 1);
  const leftUsd = Math.max(0, line - Math.max(0, money.spentUsd));
  const headroomUsd = files.length ? WRITERS_AT_ONCE * Math.max(...files.map(partReserveUsd)) : 0;
  const room = leftUsd - headroomUsd;
  const extra = money.ahead ? POINTS_AHEAD_USD : 0;
  let used = 0;
  let fit = 0;
  for (const usd of perFile) {
    if (used + usd + extra > room) break;
    used += usd + extra;
    fit += 1;
  }
  return {
    perFile,
    summariesUsd: perFile.reduce((n, x) => n + x, 0),
    leftUsd,
    headroomUsd,
    waiting: files.length - fit,
    low: leftUsd < LOW_LEFT_USD,
  };
}

/** Dollars as the card writes them: "$7", "$0.80", "$24". Whole dollars from
 *  $5 up, else cents rounded up to the next 10 (never shows less than it costs). */
export function cardUsd(usd: number): string {
  if (usd >= 5) return `$${Math.round(usd)}`;
  const tenths = Math.max(1, Math.ceil(usd * 10 - 1e-9));
  return tenths >= 50 ? "$5" : `$${(tenths / 10).toFixed(2)}`;
}
