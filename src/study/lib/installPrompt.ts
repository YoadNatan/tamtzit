import { flags } from "./flags";
import { guideMark } from "./guideMark";
import { markInstalled } from "./install";
import { standalone } from "./personalCode";

/* ── The browser's own install prompt (Chrome and Edge, Android and computers) ──
 * Registered in main.tsx before React mounts: the event can come before any
 * screen does. It is kept here, and a screen calls runPrompt() from a tap
 * (prompt() may be called once per event, and only from a gesture). After
 * "accepted" the app is marked added; after "dismissed" the event is
 * dropped (Chrome may send a new one later). A computer's Chrome may also
 * have navigator.install() (the Web Install API): used when there is no
 * event. Components read it through useSyncExternalStore. */

type Choice = { outcome: "accepted" | "dismissed"; platform?: string };
export type InstallPromptEvent = Event & { prompt: () => Promise<unknown>; userChoice: Promise<Choice> };

let deferred: InstallPromptEvent | null = null;
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  for (const fn of subs) fn();
};

export function subscribePrompt(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Changes whenever the prompt comes or goes (useSyncExternalStore's snapshot). */
export const promptVersion = () => version;

type WithInstall = Navigator & { install?: () => Promise<unknown> };
const webInstall = (): boolean => {
  try {
    return typeof (navigator as WithInstall).install === "function";
  } catch {
    return false;
  }
};

/** Whether a tap can install right here (the kept event, or navigator.install). */
export function canPrompt(): boolean {
  return deferred !== null || webInstall();
}

/** The added app: the device's memory and the guide's first step. */
function added(via: "prompt" | "event" | "standalone"): void {
  markInstalled(via);
  guideMark("install");
}

/** Shows the browser's install dialog (from a tap only). */
export async function runPrompt(): Promise<"accepted" | "dismissed" | "none"> {
  const e = deferred;
  if (e) {
    try {
      await e.prompt();
      const choice = await e.userChoice;
      deferred = null;
      if (choice.outcome === "accepted") added("prompt");
      emit();
      return choice.outcome;
    } catch {
      deferred = null;
      emit();
      return "none";
    }
  }
  if (webInstall()) {
    try {
      await (navigator as WithInstall).install!();
      added("prompt");
      emit();
      return "accepted";
    } catch {
      return "dismissed";
    }
  }
  return "none";
}

let listening = false;

/** main.tsx, once, before React mounts. Nothing without VITE_STUDY_INSTALL. */
export function listenInstall(): void {
  if (!flags.install || listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    deferred = ev as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    added("event");
    emit();
  });
  // Opened from the icon: the app is there (on Android the browser's tab, which
  // shares this storage, then knows it too), and the guide's step is done.
  if (standalone()) added("standalone");
  try {
    matchMedia("(display-mode: standalone)").addEventListener?.("change", (e) => {
      if (e.matches) added("standalone");
      emit();
    });
  } catch {
    /* an old browser */
  }
}
