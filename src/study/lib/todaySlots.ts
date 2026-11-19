import type { QueueItem } from "../../../shared/study/today";
import { mergePulse } from "../../../shared/study/pulse";
import { againItems, pulseItems } from "../../../shared/study/todaySlots";
import { flags } from "./flags";
import { myProgressCounts } from "./progress";
import { getMyPulse, getPulse, pulseReady } from "./pulse";

/* ── The loaders behind TODAY_SLOTS.again and .pulse (wave 5's integration) ──
 * Loaded lazily by features/today.tsx's slots, so the study entry carries
 * none of it. The rules are shared/study/todaySlots.ts's (tested there). */

/** Row 3b: Q-2's due mistakes in another wording, minus Today's own danger row (A2's counts). */
export async function againRows(groupId: string): Promise<QueueItem[]> {
  return againItems(groupId, await myProgressCounts(groupId));
}

/** Row 8: "רק אצלך חם", only for a member the last night counted (U's two reads, merged). */
export async function pulseRows(groupId: string): Promise<QueueItem[]> {
  if (!flags.practice) return []; // each row opens practice's topic session
  if (!(await pulseReady(groupId))) return [];
  const [group, mine] = await Promise.all([getPulse(groupId), getMyPulse(groupId)]);
  return pulseItems(mergePulse(group ?? [], mine ?? []));
}
