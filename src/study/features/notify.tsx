import { lazy, Suspense, type ComponentType } from "react";
import { flags } from "../lib/flags";
import type { Route } from "../lib/route";
import type { Ctx, ScreenProps } from "./types";

/* ── Notifications' slot (section R; VITE_STUDY_NOTIFY) ──
 * Only these wrappers are in the study entry chunk: each is nothing without
 * the flag, and everything else loads lazily (components/NotifyParts.tsx,
 * which picks the inbox or the settings; tools/study-bundle.mjs holds R's
 * share). One helper makes each: a part of NotifyParts inside Suspense. */

type Parts = typeof import("../components/NotifyParts");

function part<P extends object>(name: keyof Parts): ComponentType<P> {
  const C = lazy(() => import("../components/NotifyParts").then((m) => ({ default: m[name] as unknown as ComponentType<P> }))) as unknown as ComponentType<P>;
  return (props: P) =>
    flags.notify ? (
      <Suspense fallback={null}>
        <C {...props} />
      </Suspense>
    ) : null;
}

/** Beside the guide's slot in the shell: the bell's count, seen notices. */
export const NotifySlot = part<{ route: Route; ctx: Ctx }>("NotifyCore");
/** The bell, at the end of a tab screen's top bar. */
export const Bell = part<object>("Bell");
/** The uploader's lecture while it is written: "להודיע כשהסיכום מוכן?" (once on a device). */
export const NotifyOffer = part<{ ctx: Ctx }>("NotifyOffer");
/** ?v=notify: the inbox; x=set: its settings (the inbox when pushes are not offered). */
export const NotifyRoute = part<ScreenProps<"notify">>("NotifyScreens");
