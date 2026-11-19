import { lazy, Suspense } from "react";
import { flags } from "../lib/flags";
import type { Ctx } from "./types";

/* ── Package H's slot (§12.2.3): the boss battle ──
 * A battle itself is Z's quiz (?v=quiz&q=), which renders BossHud and
 * BossEnd in mode "boss". H-1 (wave 5, phase 3, usable early by Yoad's
 * decision 3): the setup screen and the card, HUD and end load on their own
 * chunks (components/Boss.tsx, components/BossParts.tsx), each behind the
 * flag `boss` (pulse && quiz && VITE_STUDY_BOSS). */

/** A new battle's setup (?v=boss, ?v=boss&new=1). */
export const BossScreen = lazy(() => import("../components/Boss"));

const LazyCard = lazy(() => import("../components/BossParts").then((m) => ({ default: m.BossCardBody })));
const LazyHud = lazy(() => import("../components/BossParts").then((m) => ({ default: m.BossHudBody })));
const LazyEnd = lazy(() => import("../components/BossParts").then((m) => ({ default: m.BossEndBody })));

/** "קרב הבוס" on "יחד": the heads, the meter, the revenge round. */
export function BossCard({ ctx }: { ctx: Ctx }) {
  if (!flags.boss) return null;
  return (
    <Suspense fallback={null}>
      <LazyCard ctx={ctx} />
    </Suspense>
  );
}

/** The battle's heads-up display on Z's quiz screen. A battle someone else
 *  opened shows even on a phone built without the flag: it is the group's. */
export function BossHud({ state }: { ctx: Ctx; state: unknown }) {
  return (
    <Suspense fallback={null}>
      <LazyHud state={state} />
    </Suspense>
  );
}

/** The battle's end on Z's end screen. */
export function BossEnd({ ctx, state }: { ctx: Ctx; state: unknown }) {
  return (
    <Suspense fallback={null}>
      <LazyEnd ctx={ctx} state={state} />
    </Suspense>
  );
}
