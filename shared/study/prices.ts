/* ── Claude's prices, small enough for the phone (design-models D2, WP1) ──
 *
 * USD per million tokens: base input, output, 5-minute and 1-hour cache
 * writes, cache hits. The server prices every call from these rows (through
 * models.ts and budget.ts), and the phone's price cards (batch.ts,
 * examPrice.ts) read the default model's row from here, so a price lives in
 * one place. Only Anthropic rows: the full registry (models.ts) stays out of
 * any static client import.
 *
 * Checked on 2026-11-26 against Anthropic's model and pricing notes
 * (https://platform.claude.com/docs/en/about-claude/pricing). Cache hits are
 * 0.1 × input except where a model's notes say otherwise (Fable and Mythos
 * 5.1 and 5.2 at 0.025 ×, Opus 5.5 and Sonnet 5.5 at 0.05 ×, Fable and
 * Mythos 5 at $1); writes are 1.25 × (5 minutes) and 2 × (1 hour) input.
 */

export type Price = { in: number; out: number; w5m: number; w1h: number; hit: number };
/** A price row: `from` (YYYY-MM-DD) dates a row that starts later; `upTo`
 *  switches to `then` for a prompt (input, cache writes and cache hits
 *  together) longer than `promptTokens`. */
export type PriceRow = Price & { from?: string; upTo?: { promptTokens: number; then: Price } };

/** The model every call uses unless a route says otherwise. */
export const DEFAULT_MODEL = "claude-opus-5-5";
/** Hebrew characters a token that every estimate assumes for Claude's
 *  tokenizer (budget.ts's §2.4; calibrated against the stored usage). */
export const CHARS_PER_TOKEN = 2.5;

const fable52: PriceRow = { in: 8, out: 40, w5m: 10, w1h: 16, hit: 0.2 };
const fable51: PriceRow = { in: 10, out: 50, w5m: 12.5, w1h: 20, hit: 0.25 };
const fable5: PriceRow = { in: 10, out: 50, w5m: 12.5, w1h: 20, hit: 1 };
const opus4: PriceRow = { in: 5, out: 25, w5m: 6.25, w1h: 10, hit: 0.5 };

/** Every Claude model a call can be served by (a server-side fallback can
 *  answer with an older one), by its id. A dated id (the id, "-" and eight
 *  digits) is the same model. */
export const ANTHROPIC_PRICES: Readonly<Record<string, PriceRow>> = {
  "claude-fable-5-2": fable52,
  "claude-mythos-5-2": fable52,
  "claude-fable-5-1": fable51,
  "claude-mythos-5-1": fable51,
  "claude-fable-5": fable5,
  "claude-mythos-5": fable5,
  "claude-opus-5-5": { in: 4, out: 20, w5m: 5, w1h: 8, hit: 0.2 },
  "claude-opus-5": opus4,
  "claude-opus-4-8": opus4,
  "claude-opus-4-7": opus4,
  "claude-opus-4-6": opus4,
  "claude-opus-4-5": opus4,
  "claude-sonnet-5-5": { in: 2, out: 10, w5m: 2.5, w1h: 4, hit: 0.1 },
  "claude-sonnet-5": { in: 2, out: 10, w5m: 2.5, w1h: 4, hit: 0.2 },
  "claude-sonnet-4-6": { in: 3, out: 15, w5m: 3.75, w1h: 6, hit: 0.3 },
  "claude-sonnet-4-5": { in: 3, out: 15, w5m: 3.75, w1h: 6, hit: 0.3 },
  "claude-haiku-5-5": {
    in: 0.1,
    out: 0.5,
    w5m: 0.125,
    w1h: 0.2,
    hit: 0.01,
    upTo: { promptTokens: 100_000, then: { in: 0.5, out: 2.5, w5m: 0.625, w1h: 1, hit: 0.05 } },
  },
  "claude-haiku-4-5": { in: 1, out: 5, w5m: 1.25, w1h: 2, hit: 0.1 },
};

/** A model not listed (a fallback we don't know): the dearest rates a
 *  fallback can have, so it is never under-counted (review FE-14). */
export const UNKNOWN_PRICE: Price = { in: 10, out: 50, w5m: 12.5, w1h: 20, hit: 1 };

/** The listed id a served model's name stands for ("claude-opus-5-5" and
 *  "claude-opus-5-5-20260101" are one), or null. */
export function anthropicId(model: string | null | undefined): string | null {
  const m = model ?? "";
  const listed = (id: string) => Object.prototype.hasOwnProperty.call(ANTHROPIC_PRICES, id);
  if (listed(m)) return m;
  const dated = /^(.+)-\d{8}$/.exec(m);
  return dated && listed(dated[1]) ? dated[1] : null;
}

/** A row's rates for a prompt of this many tokens (its `upTo` tier). */
export function rateOf(row: PriceRow, promptTokens = 0): Price {
  const p = row.upTo && promptTokens > row.upTo.promptTokens ? row.upTo.then : row;
  return { in: p.in, out: p.out, w5m: p.w5m, w1h: p.w1h, hit: p.hit };
}

/** A Claude model's rates for a prompt of this many tokens; an unknown model
 *  at UNKNOWN_PRICE. */
export function priceOf(model: string | null | undefined, promptTokens = 0): Price {
  const id = anthropicId(model);
  return id ? rateOf(ANTHROPIC_PRICES[id], promptTokens) : UNKNOWN_PRICE;
}
