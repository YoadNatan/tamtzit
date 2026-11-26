import { flags } from "./flags";
import { miniScreen, type MiniRoute } from "./guideScreens";

/* ── The guide's core (docs/study/guide.md), in the study entry ──
 * The few lines the app's own screens call, so the guide itself (its
 * registry, its layer, its card) loads lazily and only with VITE_STUDY_GUIDE.
 * With the flag off every function here returns at once and does nothing.
 *
 *  - guideMark(ev): a real action happened ("para": a paragraph was opened,
 *    "bet": an answer was sent with a bet, "upload": a summary started,
 *    "invite": the invite was shared, "install": the app was added to the
 *    home screen, "notify": notifications were turned on on this device). The guide's layer ticks the matching
 *    first step off. Marks made before the layer loads wait in `pending`.
 *  - markFresh(mode, group): Join's success. The device's member is new to
 *    this group: the home shows "הצעדים הראשונים" once (sessionStorage, and a
 *    module copy for a browser without it).
 *  - guideSend(cmd): what the "?" buttons, help's "הראו לי" and "שלי" ask the
 *    layer to do (start a screen's mini-guide, the app tour, a walk, …).
 *
 * Nothing here talks to the network. */

export type GuideEvent = "para" | "bet" | "upload" | "invite" | "install" | "notify";
export type GuideCommand =
  | { type: "mark"; ev: GuideEvent }
  | { type: "screen"; opener?: HTMLElement | null }
  | { type: "tour"; opener?: HTMLElement | null }
  | { type: "walk"; walk: string; opener?: HTMLElement | null }
  | { type: "stop" }
  | { type: "changed" };

export const GUIDE_EVENT = "study-guide";
export const FRESH_KEY = "study-guide-fresh";

const pending: GuideEvent[] = [];
let freshHere: { mode: "join" | "create"; group: string } | null = null;

/** Sends a command to the guide's layer (it listens while it is mounted). */
export function guideSend(cmd: GuideCommand): void {
  if (!flags.guide) return;
  window.dispatchEvent(new CustomEvent<GuideCommand>(GUIDE_EVENT, { detail: cmd }));
}

/** A real action the first steps count (never a click the guide made: it makes none). */
export function guideMark(ev: GuideEvent): void {
  if (!flags.guide) return;
  pending.push(ev);
  guideSend({ type: "mark", ev });
}

/** The marks made before the layer listened; each is handed over once. */
export function takePending(): GuideEvent[] {
  return pending.splice(0, pending.length);
}

/** Join's success: this device's member is new here. Preloads the guide so
 *  the home's card is there with the home's first paint. */
export function markFresh(mode: "join" | "create", group: string): void {
  if (!flags.guide) return;
  freshHere = { mode, group };
  try {
    sessionStorage.setItem(FRESH_KEY, JSON.stringify(freshHere));
  } catch {
    /* private mode: the module copy holds it for this load */
  }
  void import("../components/GuideSteps").catch(() => undefined);
}

/** A member brought back with the personal code (StudyApp's restore) on a
 *  browser that never had them, such as the iPhone's home-screen icon: the
 *  guide's memory starts with the tour's offer answered, so the home does not
 *  offer the app tour to a member who knows the app. A memory already there
 *  is kept. */
export function markRestored(userId: string): void {
  if (!flags.guide) return;
  try {
    const key = `study-guide:${userId}`;
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(key, JSON.stringify({ v: 1, views: 0, did: [], list: [], tips: true, offer: "dismissed" }));
  } catch {
    /* private mode: the offer shows once */
  }
}

/** The fresh mark for this group, if any; `take` removes it. */
export function freshFor(group: string, take = false): { mode: "join" | "create" } | null {
  let mark = freshHere;
  try {
    const raw = sessionStorage.getItem(FRESH_KEY);
    if (raw) mark = JSON.parse(raw) as typeof freshHere;
  } catch {
    /* no storage, or a broken value: the module copy */
  }
  if (!mark || mark.group !== group || (mark.mode !== "join" && mark.mode !== "create")) return null;
  if (take) {
    freshHere = null;
    try {
      sessionStorage.removeItem(FRESH_KEY);
    } catch {
      /* private mode */
    }
  }
  return { mode: mark.mode };
}

/** The screens whose top bar has a "?" (lib/guideScreens.ts's one check,
 *  which screenGuide shares, lets the button show before the guide loads).
 *  The reader has its own chip instead ("איך קוראים כאן?"). */
export function hasScreenGuide(v: string, o: Omit<MiniRoute, "v"> = {}): boolean {
  if (!flags.guide || v === "lecture") return false;
  return miniScreen({ v, ...o }, flags);
}
