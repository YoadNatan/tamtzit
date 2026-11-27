import { modelInfo, priceOf } from "./models.js";
import { CHARS_PER_TOKEN } from "./prices.js";

/* ── What a call reserves before it runs (§2.4; design-models D2, WP1) ──
 *
 * Moved from server/study/budget.ts, which re-exports it, so the server's
 * call sites stay as they are. Pure: no SDK, no database.
 */

/** The app stores pictures at most 1,400 px on the long side (images.ts) and
 *  PDF pages at 1,200 px (pdf.ts). */
const MAX_PICTURE_SIDE = 1400;

/** The rate card a reservation uses is the one for a prompt this much longer than estimated. */
export const RESERVE_MARGIN = 1.2;

/** Hebrew characters a token for a model: the registry's factor (Haiku 5.5's
 *  tokenizer counts about 30% more tokens: 1.9), else CHARS_PER_TOKEN (2.5,
 *  calibrated for Claude against the stored usage by §8.5's query). */
export function charsPerToken(model: string): number {
  return modelInfo(model)?.charsPerToken ?? CHARS_PER_TOKEN;
}

/** A picture's input tokens: about width × height / 750, Claude's documented
 *  image cost; a picture of unknown size counts as the largest the app stores. */
export function imageTokens(w?: number | null, h?: number | null): number {
  const width = w && w > 0 ? w : MAX_PICTURE_SIDE;
  const height = h && h > 0 ? h : MAX_PICTURE_SIDE;
  return Math.ceil((width * height) / 750);
}

/** One attempt's worst case, which is what a call reserves: its input
 *  (characters ÷ the model's characters a token, plus any pictures' tokens)
 *  and all of max_tokens as output (thinking is output, and max_tokens bounds
 *  it), at the model's prices for a prompt that long (Haiku 5.5's dearer card
 *  above 100k tokens). Input is priced at the 5-minute cache write rate, 1.25
 *  times the uncached rate, because a call that writes its prefix to the
 *  cache pays that; at the uncached rate a call that wrote its whole prefix
 *  and used all of max_tokens would cost more than its reservation. No call
 *  here writes the 1-hour cache. A call that the model declines and a
 *  server-side fallback finishes can cost more: see budget.ts's fallbackUsd.
 *  A request sent through Message Batches (`opts.batch`, the bank's worker)
 *  is priced at half (§12.2.4: the fifth argument, so F0's four keep their
 *  meaning). A model's output floor (the registry's minMaxTokens, which
 *  run() sends at least) is reserved too, and so is a provider's fee (the
 *  registry's `fee`: OpenRouter's 1.055). */
export function estimateUsd(model: string, inputChars: number, maxTokens: number, extraInputTokens = 0, opts: { batch?: boolean } = {}): number {
  const input = Math.max(0, inputChars) / charsPerToken(model) + Math.max(0, extraInputTokens);
  // A model whose calls send at least so many (Haiku 5.5's 2,000: thinking shares max_tokens) reserves that many.
  maxTokens = Math.max(maxTokens, modelInfo(model)?.minMaxTokens ?? 0);
  // The card is chosen as if the prompt were a fifth longer: characters ÷ a
  // factor is an estimate, and a prompt just under the dearer card's line
  // that turns out just over it must not be reserved at a fifth of its cost.
  const p = priceOf(model, input * RESERVE_MARGIN);
  // A provider's fee on top of its prices (OpenRouter's 5.5%, D16) is reserved too; Claude has none.
  const fee = modelInfo(model)?.fee ?? 1;
  return ((input * Math.max(p.in, p.w5m) + Math.max(0, maxTokens) * p.out) / 1_000_000) * (opts.batch ? 0.5 : 1) * fee;
}
