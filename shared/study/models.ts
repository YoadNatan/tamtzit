import { ANTHROPIC_PRICES, anthropicId, DEFAULT_MODEL, rateOf, UNKNOWN_PRICE, type Price, type PriceRow } from "./prices.js";

/* ── The model registry (design-models D2, §7.2; WP1, slice 0) ──
 *
 * Every model the app may route a kind of work to, with its dated prices and
 * what it can do: every current Claude API model. Nothing is routed until
 * section Y holds a route: every call still uses DEFAULT_MODEL. Prices come from prices.ts (one
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
  /** The context window, in tokens. */
  context: number;
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
  /** Served only from China (design-models C43, OD22): OpenRouter cannot
   *  keep it on hosts outside China, so its requests go without the
   *  China-hosts exclusion (still zero data retention), and the screens say
   *  "המעבד של {host} נמצא בסין". */
  china?: true;
  /** Who processes its requests, for that line (a company's own name). */
  host?: string;
  /** Anthropic serves it only to organizations it verified: never offered. */
  verifiedOrgsOnly?: true;
  notes?: string;
};

const PRICING = "https://platform.claude.com/docs/en/about-claude/pricing";
const CLAUDE_EFFORT: Record<Effort, unknown> = { low: "low", medium: "medium", high: "high" };
const claude = {
  provider: "anthropic",
  checked: "2026-11-27",
  verified: true,
  source: PRICING,
  vision: true,
  caching: "explicit",
  batch: true,
  effort: CLAUDE_EFFORT,
  context: 1_000_000,
  maxOut: 128_000,
  thinkingInMax: false,
  json: "schema",
  serverFallback: false,
  charsPerToken: 2.5,
} as const;
const row = (id: string): PriceRow[] => [ANTHROPIC_PRICES[id]];
/** A Claude model: its id is its API id, its prices are prices.ts's row. */
const c = (id: string, label: string, tier: ModelInfo["tier"], more: Partial<ModelInfo> = {}): ModelInfo => ({
  ...claude,
  id,
  apiId: id,
  label,
  prices: row(id),
  tier,
  ...more,
});
/** Anthropic's server-side fallback (`fallbacks`) is offered on these
 *  (Anthropic's model notes); on every other Claude model a refusal stays a
 *  refusal unless the app retries (design-models D8). */
const FALLBACK = { serverFallback: true } as const;
/** Claude Opus 4.6, Sonnet 4.6 and Haiku 4.5 count the same Hebrew text as
 *  about 30% fewer tokens than the newer tokenizer; their estimates keep
 *  2.5 characters a token, which errs high (never under-reserved). */
const OLDER_TOKENIZER = "Older tokenizer: about 30% fewer tokens for the same text; estimates keep 2.5 characters a token, which errs high.";
const VERIFIED_ORGS = "Only for organizations Anthropic verified (its access programs); a call from another organization is refused.";

/** Every current Claude API model (Anthropic's model list, checked
 *  2026-11-27). Only the default runs until a route is set (section Y). */
export const MODELS: readonly ModelInfo[] = [
  c("claude-fable-5-2", "Claude Fable 5.2", "top", { ...FALLBACK, expensive: true, notes: "Thinking always on; its default effort is high." }),
  c("claude-mythos-5-2", "Claude Mythos 5.2", "top", { ...FALLBACK, expensive: true, verifiedOrgsOnly: true, notes: VERIFIED_ORGS }),
  c("claude-fable-5-1", "Claude Fable 5.1", "top", { ...FALLBACK, expensive: true }),
  c("claude-mythos-5-1", "Claude Mythos 5.1", "top", { ...FALLBACK, expensive: true, verifiedOrgsOnly: true, notes: VERIFIED_ORGS }),
  c("claude-fable-5", "Claude Fable 5", "top", { expensive: true, notes: "Cache hits at $1 a million tokens." }),
  c("claude-mythos-5", "Claude Mythos 5", "top", { expensive: true, verifiedOrgsOnly: true, notes: `${VERIFIED_ORGS} No safety classifiers, so no refusals.` }),
  c("claude-opus-5-5", "Claude Opus 5.5", "top", { ...FALLBACK, notes: "The default. Thinking always on; its default effort is medium: always pass the effort." }),
  c("claude-opus-5", "Claude Opus 5", "top", FALLBACK),
  c("claude-opus-4-8", "Claude Opus 4.8", "top"),
  c("claude-opus-4-7", "Claude Opus 4.7", "top"),
  c("claude-opus-4-6", "Claude Opus 4.6", "top", { notes: OLDER_TOKENIZER }),
  c("claude-sonnet-5-5", "Claude Sonnet 5.5", "mid", { ...FALLBACK, notes: "Its default effort is high: always pass the effort." }),
  c("claude-sonnet-5", "Claude Sonnet 5", "mid"),
  c("claude-sonnet-4-6", "Claude Sonnet 4.6", "mid", { notes: OLDER_TOKENIZER }),
  c("claude-haiku-5-5", "Claude Haiku 5.5", "small", {
    thinkingInMax: true,
    minMaxTokens: 2_000,
    charsPerToken: 1.9,
    notes: "Two rate cards by prompt length (100k tokens). No server-side fallback. Its tokenizer counts about 30% more tokens.",
  }),
  c("claude-haiku-4-5", "Claude Haiku 4.5", "small", {
    context: 200_000,
    maxOut: 64_000,
    effort: null,
    notes: `No effort control; thinking only with a token budget. ${OLDER_TOKENIZER}`,
  }),
];

/* ── Other providers (design-models phase 2, WP9: OpenAI and Google) ──
 *
 * Ledger ids are "<provider>:<the API's id>" (D3). Prices are USD per million
 * tokens. Every row below is verified: false: the build session could not
 * load the vendors' pricing pages (their hosts are outside its network), so
 * the figures and ids come from searches limited to the vendors' own sites
 * (openai.com, ai.google.dev), checked 2026-11-27, with the page each should
 * be read from as `source`. An unverified price is estimated × 1.5 in
 * comparisons and never routed in production (D16): the owner reads the
 * vendor's page, sets verified: true and the date (RELEASE-Y2.md).
 *
 * Caching is automatic at both (no write premium; cached input is a part of
 * the input, which usage.ts takes out). Writes are kept at 1.25 × and 2.5 ×
 * the input so a reservation errs high. Thinking is output and shares the
 * output cap (thinkingInMax), so every call sends at least 4,000 tokens of
 * it. None has server-side fallback: D8's rerun on the default applies in
 * production. Tokenizers count Hebrew differently: 2.0 characters a token
 * until the ledger calibrates it. */
const OPENAI_PRICING = "https://developers.openai.com/api/docs/pricing";
const GEMINI_PRICING = "https://ai.google.dev/gemini-api/docs/pricing";
const UNCHECKED = "Unverified: the vendor's page could not be loaded from the build session (figures from searches of the vendor's own site, 2026-11-27).";
const LEVELS: Record<Effort, unknown> = { low: "low", medium: "medium", high: "high" };
const other = {
  checked: "2026-11-27",
  verified: false,
  vision: true,
  caching: "auto",
  batch: false,
  effort: LEVELS,
  thinkingInMax: true,
  minMaxTokens: 4_000,
  serverFallback: false,
  charsPerToken: 2,
} as const;
/** OpenAI's rate card: above 272k input tokens, input and cache rates double and output is 1.5 × for the whole request. */
const openaiRow = (input: number, hit: number, out: number): PriceRow => ({
  in: input,
  out,
  w5m: input * 1.25,
  w1h: input * 2.5,
  hit,
  upTo: { promptTokens: 272_000, then: { in: input * 2, out: out * 1.5, w5m: input * 2.5, w1h: input * 5, hit: hit * 2 } },
});
const oa = (apiId: string, label: string, tier: ModelInfo["tier"], row: PriceRow, more: Partial<ModelInfo> = {}): ModelInfo => ({
  ...other,
  id: `openai:${apiId}`,
  provider: "openai",
  apiId,
  label,
  prices: [row],
  source: OPENAI_PRICING,
  context: 1_050_000,
  maxOut: 128_000,
  json: "strict",
  tier,
  notes: `${UNCHECKED} Responses API; reasoning.effort low, medium or high.`,
  ...more,
});
/** Gemini's implicit caching: hits at a tenth of the input, no write premium (kept high here as above). */
const geminiRow = (input: number, out: number, from?: string): PriceRow => ({ ...(from ? { from } : {}), in: input, out, w5m: input * 1.25, w1h: input * 2.5, hit: input / 10 });
const gm = (apiId: string, label: string, tier: ModelInfo["tier"], prices: PriceRow[], more: Partial<ModelInfo> = {}): ModelInfo => ({
  ...other,
  id: `google:${apiId}`,
  provider: "google",
  apiId,
  label,
  prices,
  source: GEMINI_PRICING,
  context: 1_048_576,
  maxOut: 65_536,
  json: "schema",
  tier,
  notes: `${UNCHECKED} streamGenerateContent; thinkingLevel low, medium or high. The key must come from a project with billing on (the free tier's data may be used by Google).`,
  ...more,
});

/** OpenAI's and Google's models a kind may be compared on (and, once a price
 *  is verified, routed to). Only ids the vendors' own pages show. */
export const OTHER_MODELS: readonly ModelInfo[] = [
  oa("gpt-6.2-astra", "GPT-6.2 Astra", "top", openaiRow(8, 0.4, 40), { expensive: true }),
  oa("gpt-6.2-sol", "GPT-6.2 Sol", "mid", openaiRow(2, 0.1, 10)),
  oa("gpt-6.1-terra", "GPT-6.1 Terra", "mid", openaiRow(1, 0.05, 5)),
  oa("gpt-6-luna", "GPT-6 Luna", "small", openaiRow(0.1, 0.01, 0.5)),
  // D16: Argon enters only at its price from 1 December ($4/$20), never the introductory one.
  gm("gemini-4-argon", "Gemini 4 Argon", "top", [geminiRow(4, 20)]),
  // The introductory price to 31 December 2026, then the standard one.
  gm("gemini-3.8-flash", "Gemini 3.8 Flash", "mid", [geminiRow(0.75, 3.75), geminiRow(1.5, 7.5, "2027-01-01")]),
];

/* ── The Chinese open models through OpenRouter (design-models phase 3, WP10; OD22) ──
 *
 * DeepSeek, Qwen, Kimi and GLM only through OpenRouter (one key, one
 * processor), never their direct endpoints: every request asks for zero data
 * retention and providers that do not collect data (compat.ts), and leaves
 * out the providers based in China, so an open model runs on a host outside
 * China. A model only its maker serves (`china: true`) goes without that
 * exclusion, and the screens say where it is processed (C43).
 *
 * Ledger ids are "openrouter:<OpenRouter's slug>" (D3). OpenRouter passes the
 * hosts' prices through and takes 5.5% on the credits they are paid with
 * (`fee`); it reports each call's cost (usage.cost), and a call settles at
 * the larger of that and the registry's price, × the fee (`reportsCost`,
 * D16). Every row below is verified: false: openrouter.ai is outside the
 * build session's network, so the slugs and figures come from searches
 * limited to openrouter.ai, checked 2026-11-27, whose snapshots disagree
 * (several hosts per model, each at its own price, and a fast route at
 * more): the highest figure seen is kept, so a reservation errs high. The
 * owner reads each model's page (`source`) before a route (RELEASE-Y2.md).
 * Vision only where the model's page says it reads pictures; contexts and
 * output caps are kept low where the pages disagree. */
const OPENROUTER = "https://openrouter.ai/";
const OPENROUTER_FEE = 1.055;
const ROUTED = "Unverified: openrouter.ai could not be loaded from the build session (figures from searches of openrouter.ai, 2026-11-27, whose snapshots disagree: the highest is kept).";
const chatRow = (input: number, hit: number, out: number): PriceRow => ({ in: input, out, w5m: input * 1.25, w1h: input * 2.5, hit });
const or = (apiId: string, label: string, tier: ModelInfo["tier"], row: PriceRow, more: Partial<ModelInfo> = {}): ModelInfo => ({
  ...other,
  id: `openrouter:${apiId}`,
  provider: "openrouter",
  apiId,
  label,
  prices: [row],
  source: `${OPENROUTER}${apiId}`,
  fee: OPENROUTER_FEE,
  reportsCost: true,
  vision: false,
  context: 128_000,
  maxOut: 32_000,
  json: "schema",
  tier,
  notes: `${ROUTED} Chat Completions through OpenRouter; reasoning.effort low, medium or high.`,
  ...more,
});

/** The Chinese open models a kind may be compared on (and, once a price is
 *  verified, routed to). Only slugs openrouter.ai's own pages show. */
export const OPENROUTER_MODELS: readonly ModelInfo[] = [
  or("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", "mid", chatRow(0.66, 0.14, 2.7)),
  or("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", "small", chatRow(0.05, 0.01, 1.28)),
  or("qwen/qwen3.8-2.4t-a95b-20260812", "Qwen3.8 2.4T A95B", "top", chatRow(2, 0.25, 6)),
  // Qwen's own closed model: listed at 5% off ($1.425/$4.275); the full price is kept.
  or("qwen/qwen4-max-20261115", "Qwen4 Max", "top", chatRow(1.5, 0.075, 4.5), { context: 1_000_000, china: true, host: "Alibaba Cloud" }),
  or("moonshotai/kimi-k3", "Kimi K3", "top", chatRow(2.28, 0.228, 24), { vision: true, context: 1_048_576 }),
  or("z-ai/glm-5.3", "GLM 5.3", "top", chatRow(2.1, 0.42, 6.6)),
];

/** Every model the registry lists: Claude's first. */
export const ALL_MODELS: readonly ModelInfo[] = [...MODELS, ...OTHER_MODELS, ...OPENROUTER_MODELS];

/* ── Route keys (design-models §7.2, §9.1): one per kind of work, the unit a
 * route is set for. Section Y's study_model_set accepts exactly these
 * (models.test.ts reads its list). Uploaded sheets (section O) reserve under
 * kind exam with refs sheet_read, sheet_key and sheet_solve, and similar
 * questions under kind similar: each is its own key. The practice-set
 * generator (op questions, practice2.ts) is set_write; practice is the
 * lecture's own batch (practice.ts). ── */
export const ROUTE_KEYS = [
  "part", "outline", "notes", "practice", "set_write", "solver", "reword", "style", "points", "cards",
  "ask", "ask_route", "mnemonic", "wall_check", "fix_check", "var", "trap_check",
  "exam_read", "exam_key", "exam_solve", "sheet_read", "sheet_key", "sheet_solve", "similar", "judge",
] as const;
export type RouteKey = (typeof ROUTE_KEYS)[number];

/** What a key's requests send (D18, OD19-OD20): pictures, members' own
 *  wording, pages of past exams or uploaded sheets. A provider approved with
 *  scope "text" serves only keys with none of these; scope "all" (the
 *  default once approved, Yoad's change of OD19, OD20 and OD24) serves every
 *  key. anthropicOnly: the request is not made through run() (D5), so only
 *  a Claude model can take it. */
export type RouteRule = { pictures?: true; memberText?: true; exam?: true; anthropicOnly?: true };
export const ROUTE_RULES: Readonly<Record<RouteKey, RouteRule>> = {
  part: { pictures: true },
  outline: { anthropicOnly: true },
  notes: {},
  practice: { pictures: true },
  set_write: { pictures: true },
  solver: { pictures: true },
  reword: { pictures: true },
  style: { pictures: true },
  points: {},
  cards: { memberText: true }, // its input carries members' corrections (study_edits: their before and after text)
  ask: { memberText: true },
  ask_route: { memberText: true, anthropicOnly: true },
  mnemonic: { memberText: true },
  wall_check: { memberText: true },
  fix_check: { memberText: true },
  var: { pictures: true, memberText: true },
  trap_check: { memberText: true },
  exam_read: { pictures: true, exam: true },
  exam_key: { pictures: true, exam: true },
  exam_solve: { exam: true },
  sheet_read: { pictures: true, exam: true },
  sheet_key: { pictures: true, exam: true },
  sheet_solve: { pictures: true, exam: true },
  similar: { pictures: true, exam: true },
  judge: {},
};

/** May a provider approved with this scope take the key? */
export function scopeAllows(scope: "text" | "all", key: RouteKey): boolean {
  if (scope === "all") return true;
  const r = ROUTE_RULES[key];
  return !r.pictures && !r.memberText && !r.exam;
}

/** The registry's entry for a model (a dated Anthropic id is its model), or null. */
export function modelInfo(model: string | null | undefined): ModelInfo | null {
  const m = model ?? "";
  const id = anthropicId(m) ?? m;
  return ALL_MODELS.find((x) => x.id === id) ?? null;
}

/** The row in force on a day (YYYY-MM-DD; today when left out). */
export function priceRowOn(info: ModelInfo, day: string = new Date().toISOString().slice(0, 10)): PriceRow {
  let current = info.prices[0];
  for (const r of info.prices) if (!r.from || r.from <= day) current = r;
  return current;
}

/** A model's rates for a prompt of this many tokens: the registry's dated row
 *  for a listed model, prices.ts's row for any other Claude model (pricing
 *  only: Opus 4.5 and Sonnet 4.5, which a ledger row or a fallback may name),
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
