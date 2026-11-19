import { lazy, Suspense } from "react";
import type { NeedsMeRow, QueueItem } from "../../../shared/study/today";
import { flags } from "../lib/flags";
import type { Ctx } from "./types";

/* ── Package T's slot (§12.2.3): Today ("היום") ──
 * Package T owns this file. "/" opens Today once flags.today is on
 * (decision 6); its screen (TodayScreen, with the session ?v=today&run=1)
 * loads lazily (review F-8), so nothing below the two exports F1Δ fixed is
 * in the study entry beyond these few lines.
 *
 * ── The rows other packages add to "התור שלי" ──
 * Their rows reach Today through TODAY_SLOTS: each loader returns queue
 * items of its kind (shared/study/today.ts's table: its flag, priority, chip
 * and estimate are there), or [] while its package is not merged. Today calls them only with
 * their flag on, after its own sources, and a failure only leaves the row
 * out. An item with `ref.route` (a Route) is opened from the session with
 * that route ("לתרגל"); one without it is a plain step.
 *
 *  - danger (A2, row 3): Today's own. study_today reads section P's
 *    study_my_danger_list by name (its first due row), and the row shows
 *    with flags.progress.
 *  - again (Q-2, row 3b, flags.mistakes): the due mistakes in another
 *    wording, from A2's study_my_progress_counts (again_due, minus the
 *    danger row Today already holds); one item per question, each opening
 *    ?v=practice&s=r.<group> (the session runs the whole run of them).
 *  - pulse (U-2, row 8, flags.pulse): "רק אצלך חם", each topic hot for the
 *    member and not for the group (U's study_pulse and study_my_pulse,
 *    merged), opening ?v=practice&s=t.<topic>&n=5.
 *  Wired in wave 5's integration: the loaders are lib/todaySlots.ts (loaded
 *  lazily here, so the study entry carries none of them), their rules
 *  shared/study/todaySlots.ts with its tests.
 *  - lane (G, row 9, flags.groupPlan): the private lane's rows that Today
 *    has no row for (a relearning round that is due, a lecture the group
 *    read without her), from lib/laneMine.ts (package G, decision 3).
 *  - loot (H, row 7) comes through study_today. */
export type TodaySlot = (ctx: Ctx) => Promise<QueueItem[]>;
export const TODAY_SLOTS: { again: TodaySlot; pulse: TodaySlot; lane: TodaySlot } = {
  again: async (ctx) => (await import("../lib/todaySlots")).againRows(ctx.group.id), // Q-2 (A2's counts)
  pulse: async (ctx) => (await import("../lib/todaySlots")).pulseRows(ctx.group.id), // U-2
  // G (decision 3: usable early): the private lane's due rounds and catch-ups, from the group's plan.
  lane: async (ctx) => (await import("../lib/laneMine")).laneItems(ctx.group.id, ctx.userId),
};

/** Today (?v=today, "/" with flags.today; run=1 the session). */
export const TodayScreen = lazy(() => import("../components/TodayScreen"));

const NeedsMeBody = lazy(() => import("../components/NeedsMe").then((m) => ({ default: m.NeedsMeBody })));
const NeedsMeToggle = lazy(() => import("../components/NeedsMe").then((m) => ({ default: m.NeedsMeToggle })));

/** "הקבוצה צריכה אותך" on Today, after "בקבוצה" (T-2; decision 3): the rows
 *  study_today hands as `needs_me`, or the member's own meter when she opted
 *  in and nothing waits for her; nothing when she did not opt in. */
export function NeedsMeCard({ ctx, rows }: { ctx: Ctx; rows: Array<Record<string, unknown>> }) {
  if (!flags.needsMe) return null;
  return (
    <Suspense fallback={null}>
      <NeedsMeBody ctx={ctx} rows={rows as unknown as NeedsMeRow[]} />
    </Suspense>
  );
}

/** "הקבוצה צריכה אותך" on or off, under "שלי" → הגדרות (T-2): off by default. */
export function NeedsMeSetting({ ctx }: { ctx: Ctx }) {
  if (!flags.needsMe) return null;
  return (
    <Suspense fallback={null}>
      <NeedsMeToggle ctx={ctx} />
    </Suspense>
  );
}
