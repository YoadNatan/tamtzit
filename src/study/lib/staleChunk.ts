/* ── A screen's code from before a deploy (docs/study/install.md) ──
 * Screens load lazily. After a deploy, a page opened before it asks for
 * chunks that are gone; the import fails and the screen never comes. The
 * home-screen app has no reload button, so the page reloads itself, once:
 * at most one reload a minute per tab (sessionStorage), and none at all
 * where that storage is refused, so a chunk that is really broken never
 * loops. Vite reports a failed lazy import as "vite:preloadError"; a failure
 * that reaches React or a promise is caught by its message. */

export const RELOAD_KEY = "study-stale-reload";
const GAP_MS = 60_000;

/** The messages a failed module load has, per browser (Chrome, Firefox,
 *  Safari, Vite's CSS preload, a chunk answered with HTML). */
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Expected a JavaScript(?:-or-Wasm)? module script/i;

export function isChunkError(e: unknown): boolean {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : (e as { message?: unknown } | null)?.message;
  return typeof text === "string" && CHUNK_ERROR.test(text);
}

/** Whether to reload now, given the last reload this tab made for this. */
export function reloadDue(last: number | null, now: number): boolean {
  return !last || now - last > GAP_MS;
}

function reloadOnce(): boolean {
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || null;
    if (!reloadDue(last, now)) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false; // no way to remember it: never risk a loop
  }
  location.reload();
  return true;
}

/** main.tsx, once. */
export function watchStaleChunks(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadOnce()) e.preventDefault();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (isChunkError(e.reason)) reloadOnce();
  });
  window.addEventListener("error", (e) => {
    if (isChunkError(e.error ?? e.message)) reloadOnce();
  });
}
