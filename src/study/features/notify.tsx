import { lazy, Suspense } from "react";
import { flags } from "../lib/flags";
import type { Route } from "../lib/route";
import type { Ctx, ScreenProps } from "./types";

/* ── Notifications' slot (section R; VITE_STUDY_NOTIFY) ──
 * Only these wrappers are in the study entry chunk: each is nothing without
 * the flag, and everything else loads lazily (components/NotifyParts.tsx,
 * which picks the inbox or the settings; tools/study-bundle.mjs holds R's
 * share). */

const Parts = () => import("../components/NotifyParts");
const Core = lazy(() => Parts().then((m) => ({ default: m.NotifyCore })));
const BellPart = lazy(() => Parts().then((m) => ({ default: m.Bell })));
const Screen = lazy(() => Parts().then((m) => ({ default: m.NotifyScreens })));

/** Beside the guide's slot in the shell: the bell's count, seen notices. */
export function NotifySlot({ route, ctx }: { route: Route; ctx: Ctx }) {
  return flags.notify ? (
    <Suspense fallback={null}>
      <Core route={route} ctx={ctx} />
    </Suspense>
  ) : null;
}

/** The bell, at the end of a tab screen's top bar. */
export function Bell() {
  return flags.notify ? (
    <Suspense fallback={null}>
      <BellPart />
    </Suspense>
  ) : null;
}

/** ?v=notify: the inbox; x=set: its settings (the inbox when pushes are not offered). */
export function NotifyRoute({ route, ctx }: ScreenProps<"notify">) {
  return <Screen route={route} ctx={ctx} />;
}
