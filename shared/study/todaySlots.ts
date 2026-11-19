/* ── Today's rows from A2/Q-2 and U-2, pure (wave 5's integration; spec
 *    §12.4.T rows 3b and 8, §12.3.Q tier 1, §12.5.U P-5) ──
 *
 * Package T left two slots in features/today.tsx (TODAY_SLOTS.again and
 * .pulse). These builders turn the packages' own reads into Today's queue
 * items, so the slots stay thin and the rules are tested here:
 *
 *  - again (row 3b, flags.mistakes): what is due again today in another
 *    wording, from A2's study_my_progress_counts. Its again_due counts each
 *    question once, the danger list's due rows included; Today already
 *    holds the danger list's first due row (row 3, study_today), so that one
 *    is taken off. One item per question; each opens Q-2's session
 *    ?v=practice&s=r.<group>, sized to the run of these items in the day's
 *    cut (practiceSize).
 *  - pulse (row 8, flags.pulse): "רק אצלך חם", a topic hot for the member and
 *    not hot for the group (U's mergePulse, `alone`), one item per topic,
 *    opening ?v=practice&s=t.<topic> for 5 questions. Only rows the group
 *    may see reach it (study_pulse answers only a member the night counted,
 *    from 3 members), so Today never shows more than the pulse screen.
 *
 * Every number is a count the database returned; nothing is invented. */

import { pulseLabel, type MergedRow } from "./pulse";
import type { ProgressCounts } from "./progress";
import type { QueueItem } from "./today";

/** Practice's session sizes (route `n`). */
export type PracticeSize = "5" | "10" | "20" | "all";

/** The smallest session size that holds `n` questions. */
export function practiceSize(n: number): PracticeSize {
  if (n <= 5) return "5";
  if (n <= 10) return "10";
  if (n <= 20) return "20";
  return "all";
}

/** The session key of Q-2's "what is due again today" (lib/progress.ts's AGAIN_KEY). */
const againKey = (groupId: string) => `r.${groupId}`;

/** How many of today's "again" questions are not already Today's danger row. */
export function againCount(c: Pick<ProgressCounts, "again_due" | "danger_due">): number {
  return Math.max(0, c.again_due - (c.danger_due > 0 ? 1 : 0));
}

/** Row 3b's items: one a question, in order, each opening the r.<group> session. */
export function againItems(groupId: string, c: Pick<ProgressCounts, "again_due" | "danger_due">): QueueItem[] {
  const n = againCount(c);
  return Array.from({ length: n }, (_, i) => ({
    key: `again:${i}`,
    kind: "again" as const,
    seconds: 0,
    at: String(i).padStart(5, "0"),
    ref: { route: { v: "practice", s: againKey(groupId), n: practiceSize(n) } },
  }));
}

/** Row 8's items: each topic hot only for the member, once (its first aspect in the pulse's order). */
export function pulseItems(rows: readonly MergedRow[]): QueueItem[] {
  const seen = new Set<string>();
  const out: QueueItem[] = [];
  for (const r of rows) {
    if (!r.alone || seen.has(r.topic_key)) continue;
    seen.add(r.topic_key);
    out.push({
      key: `practice:${r.topic_key}.${r.aspect}`,
      kind: "practice",
      seconds: 0,
      at: String(out.length).padStart(5, "0"),
      example: pulseLabel(r.topic, r.aspect),
      slides: r.slides ?? [],
      ref: { route: { v: "practice", s: `t.${r.topic_key}`, n: "5" } },
    });
  }
  return out;
}

/** The run of same-kind items starting at `i` (a run of "again" items is one session). */
export function runOf(items: readonly Pick<QueueItem, "kind">[], i: number): number {
  const kind = items[i]?.kind;
  if (!kind) return 0;
  let n = 0;
  while (items[i + n]?.kind === kind) n++;
  return n;
}
