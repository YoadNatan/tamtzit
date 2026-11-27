import type { ModelInfo } from "../../../shared/study/models.js";
import { costUsd, floorUsage, type UsageLike } from "../budget.js";

/* ── Usage in Anthropic's shape, and what a call settles at (D4, D16) ──
 *
 * One pricing path: every provider's usage is turned into Anthropic's shape
 * before budget.ts's costUsd prices it at the registry's rates:
 *   input_tokens             the uncached input (the provider's cached
 *                            tokens are a part of its input count, so they
 *                            are taken out)
 *   cache_read_input_tokens  the cached input
 *   output_tokens            visible output plus thinking (both billed as output)
 * The provider's own counts stay in `raw`, with `provider`.
 */

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** OpenAI Responses' usage: input_tokens (input_tokens_details.cached_tokens
 *  a part of it), output_tokens (output_tokens_details.reasoning_tokens a
 *  part of it). */
export function normalizeOpenAI(u: unknown): UsageLike {
  const r = (u ?? {}) as { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } | null };
  const input = n(r.input_tokens);
  const cached = Math.min(input, n(r.input_tokens_details?.cached_tokens));
  return { input_tokens: input - cached, cache_read_input_tokens: cached, output_tokens: n(r.output_tokens), provider: "openai", raw: u } as UsageLike;
}

/** Gemini's usageMetadata: promptTokenCount (cachedContentTokenCount a part
 *  of it), candidatesTokenCount and thoughtsTokenCount (billed as output,
 *  reported apart: added here), toolUsePromptTokenCount (input). */
export function normalizeGemini(u: unknown): UsageLike {
  const r = (u ?? {}) as { promptTokenCount?: unknown; cachedContentTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown; toolUsePromptTokenCount?: unknown };
  const input = n(r.promptTokenCount) + n(r.toolUsePromptTokenCount);
  const cached = Math.min(input, n(r.cachedContentTokenCount));
  return {
    input_tokens: input - cached,
    cache_read_input_tokens: cached,
    output_tokens: n(r.candidatesTokenCount) + n(r.thoughtsTokenCount),
    provider: "google",
    raw: u,
  } as UsageLike;
}

/** Chat Completions' usage (OpenRouter, compat.ts): prompt_tokens
 *  (prompt_tokens_details.cached_tokens and cache_write_tokens a part of
 *  it), completion_tokens (completion_tokens_details.reasoning_tokens a part
 *  of it). Written cache counts as a write, priced at the registry's write
 *  rate. */
export function normalizeChat(u: unknown, provider = "openrouter"): UsageLike {
  const r = (u ?? {}) as { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown; cache_write_tokens?: unknown } | null };
  const input = n(r.prompt_tokens);
  const cached = Math.min(input, n(r.prompt_tokens_details?.cached_tokens));
  const written = Math.min(input - cached, n(r.prompt_tokens_details?.cache_write_tokens));
  return {
    input_tokens: input - cached - written,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: written,
    output_tokens: n(r.completion_tokens),
    provider,
    raw: u,
  } as UsageLike;
}

/** What a call settles at (design-models §7.4):
 *  - its final usage came: the registry's cost, or the cost the provider
 *    reported when that is more (OpenRouter's usage.cost), × the provider's
 *    fee (OpenRouter's 5.5% on the credits its cost is counted in);
 *  - it ended without its final usage after the provider began (an abort, a
 *    timeout, a stream cut): no less than its reservation, because these
 *    providers report usage only at the end, and the thinking so far is
 *    billed (D4);
 *  - the provider refused the request before streaming (an HTTP error, no
 *    connection): $0, nothing was generated.
 *  `estimated` marks a figure that is not the provider's final count. */
export function settled(o: {
  m: Pick<ModelInfo, "id" | "fee">;
  usage: UsageLike | null;
  final: boolean;
  chars: number;
  opened: boolean;
  floorUsd: number;
  reportedUsd?: number | null;
}): { usage: UsageLike | null; costUsd: number; estimated: boolean } {
  const fee = o.m.fee ?? 1;
  if (o.final && o.usage) {
    const cost = Math.max(costUsd(o.usage, o.m.id), o.reportedUsd ?? 0) * fee;
    return { usage: o.usage, costUsd: cost, estimated: false };
  }
  const usage = floorUsage(o.usage, o.chars);
  const counted = costUsd(usage, o.m.id) * fee;
  return { usage, costUsd: o.opened ? Math.max(counted, o.floorUsd, (o.reportedUsd ?? 0) * fee) : counted, estimated: true };
}
