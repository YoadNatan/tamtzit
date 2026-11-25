import { isIos, type Env } from "./install";

/* ── The install flow's parts only lazy code uses (docs/study/install.md) ──
 * Apart from lib/install.ts, which is in the study entry: the way out of
 * another app's built-in browser (the install screens) and what the guide's
 * step knows of this device (lib/guideFacts.ts). */

/** The link that opens this address in the real browser, from another
 *  app's built-in one: Safari's undocumented x-safari- scheme on iOS (works
 *  in many apps, not reliably in Meta's), Chrome's intent on Android (with
 *  the address itself as the fallback). Only ever followed on a tap. */
export function escapeUrl(env: Env, href: string): string | null {
  if (env.kind === "ios-inapp") return `x-safari-${href}`;
  if (env.kind !== "android-inapp") return null;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(/:$/, "");
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

/** What the guide's first step needs to know ("להוסיף למסך הבית"). */
export type InstallFact = "ios" | "android" | "prompt" | "none";

export function installFact(env: Env, canPrompt: boolean): InstallFact {
  if (env.kind === "standalone") return "none";
  if (canPrompt) return "prompt";
  if (isIos(env)) return "ios";
  if (env.kind === "desktop") return "none";
  return "android";
}
