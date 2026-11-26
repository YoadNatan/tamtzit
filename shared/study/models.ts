import { ANTHROPIC_PRICES, anthropicId, DEFAULT_MODEL, rateOf, UNKNOWN_PRICE, type Price, type PriceRow } from "./prices.js";

/* ── The model registry (design-models D2, §7.2; WP1, slice 0) ──
 *
 * Every model the app may route a kind of work to, with its dated prices and
 * what it can do. Slice 0 lists Anthropic's models only and routes nothing:
 * every call still uses DEFAULT_MODEL. Prices come from prices.ts (one
 * place); the server prices calls through priceOf below (budget.ts), and the
 * phone never imports this file (prices.ts is its small share).
 *
 * Ledger ids (D3): Anthropic ids stay bare; other providers' models will be
 * "<provider>:<model>", at most 80 characters.
 */

export { DEFAULT_MODEL };
export type { Price, PriceRow };

export type Provider = "anthropic" | "openai" | "google" | "openrouter" | "deepseek" | "dashscope" | "moonshot" | "zai";
export type Effort = "low" | "medium" | "high";

export type ModelInfo = {
  /** The ledger's id (D3). */
  id: string;
  provider: Provider;
  /** The id the provider's API takes. */
  apiId: string;
  /** The model's own name, as people know it (not translated). */
  label: string;
  /** Oldest first: a row with `from` replaces the one before it from that date. */
  prices: PriceRow[];
  /** When the prices were last checked against the provider (YYYY-MM-DD). */
  checked: string;
  /** False: an unchecked price, estimated × 1.5 in comparisons and never routed in production (D16). */
  verified: boolean;
  source: string;
  /** A provider fee on top of the token prices (OpenRouter 1.055). */
  fee?: number;
  /** The provider reports the call's cost: settle at max(registry, reported). */
  reportsCost?: boolean;
  vision: boolean;
  caching: "explicit" | "auto" | "none";
  batch: boolean;
  /** What the provider takes for each effort level; null: no effort control. */
  effort: Record<Effort, unknown> | null;
  maxOut: number;
  /** Thinking shares max_tokens, so a small cap may leave no room for the answer. */
  thinkingInMax: boolean;
  /** The smallest max_tokens a call to it may send. */
  minMaxTokens?: number;
  json: "schema" | "strict" | "object" | "prompt";
  /** The provider can finish a declined request on another model (Anthropic's `fallbacks`). */
  serverFallback: boolean;
  /** Hebrew characters a token for this model's tokenizer (estimates only). */
  charsPerToken: number;
  tier: "top" | "mid" | "small";
  /** About twice the default's price: production routes need a second confirmation (OD14). */
  expensive?: true;
  china?: true;
  notes?: string;
};

const PRICING = "https://platform.claude.com/docs/en/about-claude/pricing";
const CLAUDE_EFFORT: Record<Effort, unknown> = { low: "low", medium: "medium", high: "high" };
const claude = {
  provider: "anthropic",
  checked: "2026-11-26",
  verified: true,
  source: PRICING,
  vision: true,
  caching: "explicit",
  batch: true,
  effort: CLAUDE_EFFORT,
  maxOut: 128_000,
  thinkingInMax: false,
  json: "schema",
  serverFallback: true,
  charsPerToken: 2.5,
} as const;
const row = (id: string): PriceRow[] => [ANTHROPIC_PRICES[id]];

export const MODELS: readonly ModelInfo[] = [
  { ...claude, id: "claude-fable-5-2", apiId: "claude-fable-5-2", label: "Claude Fable 5.2", prices: row("claude-fable-5-2"), tier: "top", expensive: true },
  { ...claude, id: "claude-opus-5-5", apiId: "claude-opus-5-5", label: "Claude Opus 5.5", prices: row("claude-opus-5-5"), tier: "top" },
  {
    ...claude,
    id: "claude-sonnet-5-5",
    apiId: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    prices: row("claude-sonnet-5-5"),
    tier: "mid",
    notes: "Its default effort is high: always pass the effort.",
  },
  {
    ...claude,
    id: "claude-haiku-5-5",
    apiId: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    prices: row("claude-haiku-5-5"),
    tier: "small",
    serverFallback: false,
    thinkingInMax: true,
    minMaxTokens: 2_000,
    charsPerToken: 1.9,
    notes: "Two rate cards by prompt length (100k tokens). No server-side fallback. Its tokenizer counts about 30% more tokens.",
  },
];

/** The registry's entry for a model (a dated Anthropic id is its model), or null. */
export function modelInfo(model: string | null | undefined): ModelInfo | null {
  const m = model ?? "";
  const id = anthropicId(m) ?? m;
  return MODELS.find((x) => x.id === id) ?? null;
}

/** The row in force on a day (YYYY-MM-DD; today when left out). */
export function priceRowOn(info: ModelInfo, day: string = new Date().toISOString().slice(0, 10)): PriceRow {
  let current = info.prices[0];
  for (const r of info.prices) if (!r.from || r.from <= day) current = r;
  return current;
}

/** A model's rates for a prompt of this many tokens: the registry's dated row
 *  for a listed model, prices.ts's row for any other Claude model (a
 *  fallback's, pricing only: Sonnet 5, Haiku 4.5, older Opus and Sonnet),
 *  and the dearest rates for a model nobody knows. */
export function priceOf(model: string | null | undefined, promptTokens = 0, day?: string): Price {
  const info = modelInfo(model);
  if (info) return rateOf(priceRowOn(info, day), promptTokens);
  const id = anthropicId(model);
  return id ? rateOf(ANTHROPIC_PRICES[id], promptTokens) : UNKNOWN_PRICE;
}

/** The label people know a model by; the id itself when it is not listed. */
export function labelOf(model: string): string {
  return modelInfo(model)?.label ?? model;
}

/** Who serves a model: listed, an Anthropic id, or the "<provider>:" prefix (D3). */
export function providerOf(model: string): Provider | null {
  const info = modelInfo(model);
  if (info) return info.provider;
  if (anthropicId(model)) return "anthropic";
  const p = /^([a-z]+):/.exec(model)?.[1];
  const known: Provider[] = ["openai", "google", "openrouter", "deepseek", "dashscope", "moonshot", "zai"];
  return p && (known as string[]).includes(p) ? (p as Provider) : null;
}
