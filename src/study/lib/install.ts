/* ── Adding תמצית to the home screen (docs/study/install.md) ──
 * Pure and small, in the study entry: where this page runs (an iPhone's
 * Safari, another app's built-in browser, Android's Chrome, a computer, or
 * the home-screen app itself) and the device's memory of the install card
 * (lib/installLazy.ts has the parts only lazy code uses). The screens load
 * lazily (features/install.tsx); the browser's own install prompt is kept
 * by lib/installPrompt.ts. Nothing here talks to the network. */

import { standalone } from "./personalCode";

export type InApp = "facebook" | "instagram" | "other";
export type IosBrowser = "chrome" | "edge" | "firefox";

export type Env =
  | { kind: "standalone" }
  | { kind: "ios-safari"; ipad: boolean; safari: number | null } // safari: Version/NN's major
  | { kind: "ios-browser"; app: IosBrowser; ipad: boolean }
  | { kind: "ios-inapp"; app: InApp }
  | { kind: "android-chrome" } // Chrome, Edge, Opera (Chromium): a prompt may or may not come
  | { kind: "android-samsung" }
  | { kind: "android-other" } // Firefox and the rest: the menu's words only
  | { kind: "android-inapp"; app: InApp }
  | { kind: "desktop" };

/** What detect() reads of the browser (a plain object, so a test can make one). */
export type Probe = { ua: string; platform: string; touch: number; standalone: boolean };

/** Where this page runs. In order: the home-screen app; another app's
 *  built-in browser (Facebook, Instagram, an Android WebView "; wv)", an iOS
 *  WKWebView: "Mobile/" with no "Safari/"); iOS (an iPad says it is a Mac,
 *  with touch); Android; everything else is a computer. iOS's version is
 *  Safari's "Version/NN", never the OS token (frozen at 18_6 from iOS 26). */
export function detect(p: Probe): Env {
  if (p.standalone) return { kind: "standalone" };
  const ua = p.ua || "";
  const app: InApp | null = /FBAN|FBAV|FB_IAB|FB4A/.test(ua) ? "facebook" : /Instagram/.test(ua) ? "instagram" : null;
  const macTouch = p.platform === "MacIntel" && p.touch > 1;
  if (/iPhone|iPod|iPad/.test(ua) || macTouch) {
    const ipad = /iPad/.test(ua) || macTouch;
    if (app) return { kind: "ios-inapp", app };
    if (/CriOS\//.test(ua)) return { kind: "ios-browser", app: "chrome", ipad };
    if (/EdgiOS\//.test(ua)) return { kind: "ios-browser", app: "edge", ipad };
    if (/FxiOS\//.test(ua)) return { kind: "ios-browser", app: "firefox", ipad };
    if (!/Safari\//.test(ua)) return { kind: "ios-inapp", app: "other" };
    const v = /Version\/(\d+)/.exec(ua);
    return { kind: "ios-safari", ipad, safari: v ? Number(v[1]) : null };
  }
  if (/Android/i.test(ua)) {
    if (app) return { kind: "android-inapp", app };
    if (/; wv\)/.test(ua)) return { kind: "android-inapp", app: "other" };
    if (/SamsungBrowser\//.test(ua)) return { kind: "android-samsung" };
    if (/Chrome\//.test(ua) && !/Firefox\//.test(ua)) return { kind: "android-chrome" };
    return { kind: "android-other" };
  }
  return { kind: "desktop" };
}

/** This browser, read now. */
export function probe(): Probe {
  try {
    return { ua: navigator.userAgent, platform: navigator.platform ?? "", touch: navigator.maxTouchPoints ?? 0, standalone: standalone() };
  } catch {
    return { ua: "", platform: "", touch: 0, standalone: false };
  }
}

/** This browser's place, read now. */
export const envNow = (): Env => detect(probe());

export const isIos = (e: Env) => e.kind === "ios-safari" || e.kind === "ios-browser" || e.kind === "ios-inapp";
export const isInApp = (e: Env) => e.kind === "ios-inapp" || e.kind === "android-inapp";

/** Whether there is a way to install here: never in the app itself; on a
 *  computer only with the browser's own prompt (or navigator.install); on a
 *  phone always (the steps, or the way to the real browser first). */
export function installWanted(env: Env, canPrompt: boolean): boolean {
  if (env.kind === "standalone") return false;
  if (env.kind === "desktop") return canPrompt;
  return true;
}

/* ── The device's memory (per browser on purpose: on iOS, Safari and the
 *  icon have separate storage anyway) ── */

export const INSTALL_KEY = "study-install";
export type InstallVia = "prompt" | "event" | "said" | "standalone";
export type InstallMemory = { v: 1; dismissed?: number; done?: number; via?: InstallVia };

const VIA: readonly InstallVia[] = ["prompt", "event", "said", "standalone"];

/** A stored value, cleaned: anything else is dropped. */
export function parseInstall(raw: string | null | undefined): InstallMemory {
  const m: InstallMemory = { v: 1 };
  if (!raw) return m;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return m;
  }
  if (!x || typeof x !== "object") return m;
  const o = x as Record<string, unknown>;
  const time = (t: unknown) => (typeof t === "number" && Number.isFinite(t) && t > 0 ? t : undefined);
  const dismissed = time(o.dismissed);
  const done = time(o.done);
  if (dismissed) m.dismissed = dismissed;
  if (done) m.done = done;
  if (VIA.includes(o.via as InstallVia)) m.via = o.via as InstallVia;
  return m;
}

let held: InstallMemory | null = null;

export function readInstall(): InstallMemory {
  try {
    const raw = localStorage.getItem(INSTALL_KEY);
    if (raw !== null) return parseInstall(raw);
  } catch {
    /* private mode: this load's copy */
  }
  return held ?? { v: 1 };
}

export function writeInstall(patch: Partial<Omit<InstallMemory, "v">>): InstallMemory {
  const m: InstallMemory = { ...readInstall(), ...patch, v: 1 };
  held = m;
  try {
    localStorage.setItem(INSTALL_KEY, JSON.stringify(m));
  } catch {
    /* private mode: kept for this load */
  }
  window.dispatchEvent(new Event(INSTALL_CHANGED));
  return m;
}

/** The app was added (a tap on "הוספתי", the prompt accepted, the browser's
 *  event, or a launch from the icon). The first way is kept. */
export function markInstalled(via: InstallVia, now = Date.now()): void {
  const m = readInstall();
  if (m.done) return;
  writeInstall({ done: now, via });
}

export const INSTALL_CHANGED = "study-install-changed";

/** Whether the home's install card shows: there is a way to install here,
 *  it was never added nor put off on this browser, and the guide's own card
 *  (its first steps, or its one-time tour offer) is not on the home: one
 *  thing at a time. */
export function cardWanted(o: { env: Env; canPrompt: boolean; memory: InstallMemory; guideBusy: boolean }): boolean {
  return installWanted(o.env, o.canPrompt) && !o.memory.dismissed && !o.memory.done && !o.guideBusy;
}

/** Whether the guide holds the home: a member who just joined (its fresh
 *  mark), a live first-steps card (started, not hidden or closed, within 14
 *  days), or the tour's offer not answered yet. `raw` is the guide's stored
 *  memory for this member (study-guide:<id>), or null. */
export function guideBusy(guideOn: boolean, fresh: boolean, raw: string | null, now: number): boolean {
  if (!guideOn) return false;
  if (fresh) return true;
  if (!raw) return true; // the tour's offer
  try {
    const m = JSON.parse(raw) as { born?: unknown; closed?: unknown; hidden?: unknown; offer?: unknown };
    if (typeof m.born !== "number") return m.offer !== "taken" && m.offer !== "dismissed";
    return m.closed !== true && m.hidden !== true && now - m.born <= 14 * 86_400_000;
  } catch {
    return false;
  }
}
