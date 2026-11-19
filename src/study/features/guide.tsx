import { lazy, Suspense } from "react";
import { flags } from "../lib/flags";
import { freshFor, guideSend, hasScreenGuide } from "../lib/guideMark";
import { allowed, parseRoute, type Route } from "../lib/route";
import type { Ctx, ScreenProps } from "./types";

/* ── The guide's slot (docs/study/guide.md) ──
 * What the app's screens render of the guide, each nothing without
 * VITE_STUDY_GUIDE. Everything with a body loads lazily (the layer that
 * rings and explains, the home's "הצעדים הראשונים" or its offer of the app
 * tour, help's "מדריך לאפליקציה" and "איך עושים…?",
 * the rows in "שלי", the sandbox), so the study entry carries only these
 * wrappers, the "?" button and lib/guideMark.ts. */

const GuideLayer = lazy(() => import("../components/GuideLayer"));
const GuideSteps = lazy(() => import("../components/GuideSteps"));
const HowToBody = lazy(() => import("../components/HowTo"));
const GuideMeBody = lazy(() => import("../components/GuideMe"));
const TryBody = lazy(() => import("../components/TryScreen"));

/** The layer over every screen in the shell: the ring, the docked bubble,
 *  the walks, the "?" mini-guides and the one "חדש" hint. */
export function GuideSlot({ route, ctx }: { route: Route; ctx: Ctx }) {
  if (!flags.guide) return null;
  return (
    <Suspense fallback={null}>
      <GuideLayer route={route} ctx={ctx} />
    </Suspense>
  );
}

/** The screen the address shows (Head has no route of its own). */
function shownRoute(): Route {
  return allowed(parseRoute(location.search), flags).route;
}

/** "?" at the end of a screen's top bar: the screen's mini-guide. */
export function GuideButton() {
  if (!flags.guide) return null;
  const r = shownRoute() as Route & { l?: string; s?: string; x?: string; run?: true };
  if (!hasScreenGuide(r.v, { l: r.l, s: r.s, x: r.x, run: r.run })) return null;
  return (
    <button type="button" className="a-btn ghost icon guide-btn" aria-label="איך זה עובד? מדריך קצר למסך" onClick={(e) => guideSend({ type: "screen", opener: e.currentTarget })}>
      ?
    </button>
  );
}

/** The reader's "איך קוראים כאן?" chip, first in its actions row (its head
 *  is full at 360 px): in RTL that is the row's visible right edge, never
 *  past the end of a row that scrolls sideways. */
export function ReaderGuideChip() {
  if (!flags.guide) return null;
  return (
    <button type="button" className="a-btn small guide-chip" onClick={(e) => guideSend({ type: "screen", opener: e.currentTarget })}>
      איך קוראים כאן?
    </button>
  );
}

/** Whether the home's card will render, read without loading the guide, so
 *  its place is kept from the first paint (no jump when it arrives). */
function cardWanted(ctx: Ctx): "expanded" | "collapsed" | "offer" | null {
  if (freshFor(ctx.group.id)) return "expanded";
  try {
    const raw = localStorage.getItem(`study-guide:${ctx.userId}`);
    // Never started and never answered: the one-time offer of the app tour.
    if (!raw) return "offer";
    const m = JSON.parse(raw) as { born?: number; closed?: boolean; hidden?: boolean; views?: number; offer?: string };
    if (!m.born) return m.offer ? null : "offer";
    if (m.closed || m.hidden || Date.now() - m.born > 14 * 86_400_000) return null;
    return (m.views ?? 0) < 2 ? "expanded" : "collapsed";
  } catch {
    return null;
  }
}

/** "הצעדים הראשונים" on the home (Today, or the library before Today), or,
 *  for a member who never had them, the one-time offer of the app tour. */
export function GuideHome({ ctx, home, queue }: { ctx: Ctx; home: "today" | "library"; queue?: number | null }) {
  if (!flags.guide) return null;
  const want = cardWanted(ctx);
  const hold = want ? <div className="g-steps-hold" aria-hidden="true" style={{ minHeight: want === "expanded" ? 260 : want === "offer" ? 150 : 76 }} /> : null;
  return (
    <Suspense fallback={hold}>
      <GuideSteps ctx={ctx} home={home} queue={queue ?? null} />
    </Suspense>
  );
}

/** Help's "איך עושים…?" (members only): the search, its answers with "הראו
 *  לי", and the filter it hands help's own rows. */
export function GuideHowTo({ ctx, query, onQuery }: { ctx: Ctx; query: string; onQuery: (q: string) => void }) {
  if (!flags.guide) return null;
  return (
    <Suspense fallback={null}>
      <HowToBody ctx={ctx} query={query} onQuery={onQuery} />
    </Suspense>
  );
}

/** The guide's rows in "שלי": the first steps again, the tips switch, "איך עושים…?", the sandbox. */
export function GuideMeRows({ ctx }: { ctx: Ctx }) {
  if (!flags.guide) return null;
  return (
    <Suspense fallback={null}>
      <GuideMeBody ctx={ctx} />
    </Suspense>
  );
}

/** ?v=try: the sandbox (a paragraph and a question, local only). */
export function TryScreen({ route, ctx }: ScreenProps<"try">) {
  return <TryBody route={route} ctx={ctx} />;
}

