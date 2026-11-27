/// <reference path="../env.d.ts" />
import type { ModelInfo, Provider } from "../../../shared/study/models.js";
import type { RunOpts, RunResult } from "../claude.js";
import { geminiAdapter } from "./gemini.js";
import { providersConfigured, PROVIDER_KEYS, type KeyedProvider } from "./keys.js";
import { openaiAdapter } from "./openai.js";
import { streamCall, type Adapter as StreamAdapter } from "./stream.js";

export { PROVIDER_KEYS, providersConfigured, type KeyedProvider };

/* ── The providers seam (design-models §7.1, §7.4; WP4, WP9) ──
 *
 * claude.ts's run() calls a Claude model itself and every other provider
 * through its adapter here. An adapter streams the request (system,
 * messages, pictures, effort, max_tokens, format) with plain fetch (D6),
 * hands text to o.onText, honours o.stopAt and o.signal, settles through
 * o.ledger in its own `finally` (at no less than o.reservedUsd when the
 * provider's final usage never came, D4), and never throws: a failure is
 * stop "error" with its `cause`, so run() can rerun on the default (D8).
 *
 * This build has OpenAI's (openai.ts, the Responses API) and Google's
 * (gemini.ts, streamGenerateContent); stream.ts is what they share. Until a
 * provider has both its key and an adapter, routes.ts never resolves a key
 * to it, and run() fails such a call before any text.
 *
 * Keys come only from process.env (Vercel, Production only), are never
 * logged, returned or put in an error; health shows booleans only.
 */

export type AdapterOutcome = RunResult & { cause?: unknown };
export type Adapter = (o: RunOpts, m: ModelInfo) => Promise<AdapterOutcome>;

const viaStream =
  (a: StreamAdapter): Adapter =>
  (o, m) =>
    streamCall(a, o, m);

/** The adapters of this build, by provider. */
const ADAPTERS: Partial<Record<Provider, Adapter>> = {
  openai: viaStream(openaiAdapter),
  google: viaStream(geminiAdapter),
};

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
