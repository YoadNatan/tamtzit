/// <reference path="../env.d.ts" />
import type { ModelInfo, Provider } from "../../../shared/study/models.js";
import type { RunOpts, RunResult } from "../claude.js";

/* ── The providers seam (design-models §7.1, §7.4; WP4) ──
 *
 * claude.ts's run() calls a Claude model itself and every other provider
 * through its adapter here. An adapter streams the request (system,
 * messages, pictures, effort, max_tokens, format) with plain fetch (D6),
 * hands text to o.onText, honours o.stopAt and o.signal, settles through
 * o.ledger in its own `finally` (at no less than o.reservedUsd when the
 * provider's final usage never came, D4), and never throws: a failure is
 * stop "error" with its `cause`, so run() can rerun on the default (D8).
 *
 * This build has no adapter: the providers' modules (openai, gemini, the
 * OpenAI-compatible one for OpenRouter) add themselves to ADAPTERS. Until a
 * provider has both its key and an adapter, routes.ts never resolves a key
 * to it, and run() fails such a call before any text.
 *
 * Keys come only from process.env (Vercel, Production only), are never
 * logged, returned or put in an error; health shows booleans only.
 */

export type AdapterOutcome = RunResult & { cause?: unknown };
export type Adapter = (o: RunOpts, m: ModelInfo) => Promise<AdapterOutcome>;

/** The adapters of this build, by provider. */
const ADAPTERS: Partial<Record<Provider, Adapter>> = {};

/** The environment variable that holds each provider's key. The Chinese
 *  models go only through OpenRouter (OD22), so their direct providers have
 *  none here. */
export const PROVIDER_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;
export type KeyedProvider = keyof typeof PROVIDER_KEYS;

/** Whether each provider's key is set (booleans only: /api/study/health). */
export function providersConfigured(env: Record<string, string | undefined> = process.env): Record<KeyedProvider, boolean> {
  const out = {} as Record<KeyedProvider, boolean>;
  for (const [p, name] of Object.entries(PROVIDER_KEYS) as Array<[KeyedProvider, string]>) out[p] = Boolean((env[name] ?? "").trim());
  return out;
}

/** The adapter for a provider, or null (Anthropic is claude.ts's own). */
export function adapterFor(p: Provider): Adapter | null {
  return ADAPTERS[p] ?? null;
}

/** A provider a call can go to now: Anthropic always (the default's own
 *  key is checked where the client is made); any other with its key set
 *  and an adapter in this build. */
export function providerReady(p: Provider, env: Record<string, string | undefined> = process.env): boolean {
  if (p === "anthropic") return true;
  if (!Object.hasOwn(PROVIDER_KEYS, p) || !adapterFor(p)) return false;
  return providersConfigured(env)[p as KeyedProvider];
}
