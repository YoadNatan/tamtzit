/// <reference path="../env.d.ts" />

/* ── The providers' keys (design-models §7.4, §10; OD18) ──
 *
 * Read from process.env only (Vercel, Production only), never logged,
 * returned or put in an error: health shows booleans only. The Chinese models
 * go only through OpenRouter (OD22), so their direct providers have no key.
 */

/** The environment variable that holds each provider's key. */
export const PROVIDER_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
} as const;
export type KeyedProvider = keyof typeof PROVIDER_KEYS;

/** A provider's key, trimmed, or "" (never to be logged or returned). */
export function keyOf(p: KeyedProvider, env: Record<string, string | undefined> = process.env): string {
  return (env[PROVIDER_KEYS[p]] ?? "").trim();
}

/** Whether each provider's key is set (booleans only: /api/study/health). */
export function providersConfigured(env: Record<string, string | undefined> = process.env): Record<KeyedProvider, boolean> {
  const out = {} as Record<KeyedProvider, boolean>;
  for (const p of Object.keys(PROVIDER_KEYS) as KeyedProvider[]) out[p] = Boolean(keyOf(p, env));
  return out;
}

/** An error's words with the key taken out, at most `max` characters: a
 *  provider may echo a bad key back in its message. */
export function scrub(text: string, key: string, max = 300): string {
  const out = key ? text.split(key).join("[key]") : text;
  return out.length > max ? out.slice(0, max) + "…" : out;
}
