import { mergePulse, pulseLabel } from "../../../shared/study/pulse";
import { buildLane, missedOf, myLane, sharedDays, type GroupPlan, type LectureFact, type MeterRow, type MyRow } from "../../../shared/study/lane";
import type { QueueItem } from "../../../shared/study/today";
import { flags } from "./flags";
import { activePlan, lectureFacts, myRelearning, planDayRows, planMeterRows, todayIso, type PlanDayRow } from "./groupPlan";

/* ── The private lane's inputs (package G, PL3: "המסלול שלך · רק לך") ──
 * Everything here is the member's own: due cards (C's queue on the phone,
 * with the in-app review on), open mistakes (A2's counts, with "הטעויות
 * שלי"), the relearning rounds that are due (study_my_relearning), a
 * lecture the group read without her, and the topics hot only for her (U's
 * pulse, with it on). Each source waits for its own flag and a failing one
 * leaves its rows out. Used by the plan's screen and by Today's row 9. */

export async function myLaneRows(
  groupId: string,
  userId: string,
  plan: GroupPlan,
  facts: Record<string, LectureFact>,
  meter: readonly MeterRow[],
  saved: readonly PlanDayRow[],
): Promise<MyRow[]> {
  const today = todayIso();
  const lane = buildLane(plan, facts, meter, missedOf(saved, today));
  const [relearning, cardsDue, mistakes, alone] = await Promise.all([
    myRelearning(plan.id).catch(() => []),
    flags.cardsReview
      ? import("./today")
          .then((m) => m.loadTodayCards(groupId, userId))
          .then((c) => (c.anki ? 0 : c.ids.length))
          .catch(() => 0)
      : Promise.resolve(0),
    flags.mistakes
      ? import("./progress")
          .then((m) => m.myProgressCounts(groupId))
          .then((c) => c.mistakes)
          .catch(() => 0)
      : Promise.resolve(0),
    flags.pulse && flags.practice
      ? import("./pulse")
          .then(async (m) => ((await m.pulseReady(groupId)) ? mergePulse((await m.getPulse(groupId)) ?? [], (await m.getMyPulse(groupId)) ?? []) : []))
          .then((rows) => {
            const seen = new Set<string>();
            return rows
              .filter((r) => r.alone && !seen.has(r.topic_key) && (seen.add(r.topic_key), true))
              .filter((r) => plan.lecture_ids.includes(r.lecture_id))
              .map((r) => ({ key: r.topic_key, label: pulseLabel(r.topic, r.aspect), slides: r.slides ?? [] }));
          })
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  return myLane({
    plan,
    today,
    facts,
    sharedDay: sharedDays(lane),
    relearning,
    cardsDue,
    mistakes,
    alone,
    cardsRoute: flags.cardsReview ? { v: "cards", s: "today" } : null,
    mistakesRoute: flags.mistakes ? { v: "practice", s: "m" } : null,
  });
}

/** Today's row 9 (TODAY_SLOTS.lane): the private lane's rows as queue items, each opening its route. */
export async function laneItems(groupId: string, userId: string): Promise<QueueItem[]> {
  const plan = await activePlan(groupId);
  if (!plan) return [];
  const [{ facts }, meter, saved] = await Promise.all([lectureFacts(groupId, userId, plan.lecture_ids), planMeterRows(plan.id).catch(() => []), planDayRows(plan.id).catch(() => [])]);
  const rows = await myLaneRows(groupId, userId, plan, facts, meter, saved);
  // Cards and mistakes (rows 5 and 3b) and, with the pulse, its topics (row 8) have rows of their own on Today.
  return rows
    .filter((r) => r.key !== "cards" && !(flags.pulse && r.key.startsWith("topic:")))
    .map((r, i) => ({
      key: `lane:${r.key}`,
      kind: "lane" as const,
      seconds: r.minutes * 60,
      at: String(i).padStart(5, "0"),
      example: r.title,
      slides: r.slides,
      ref: { route: r.route },
    }));
}
