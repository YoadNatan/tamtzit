import { dateOfDay, studyDay } from "../../../shared/study/day";
import type { AspectRow, CalibrationRow, DangerRow, ProgressCounts, ReadinessRow } from "../../../shared/study/progress";
import { dueToday } from "../../../shared/study/progress";
import { sb } from "./api";

/* ── Package A2's data: the caller's own progress (spec §12.3.A) and Q-2's
 *    "another wording" (§12.3.Q) ──
 *
 * Every read is the caller's own, through section P's definer functions,
 * which answer only rows with user_id = auth.uid(). Decision 1 (17 Nov 2026):
 * the caller is the device's member; nothing waits for an account.
 *
 * READ HELPERS FOR TODAY (T-1) AND OTHER SCREENS (docs/study/progress.md):
 *   myProgressCounts(group)  one call: answers, parts with a range, "על בטוח"
 *                            answers and right ones, the danger list's size
 *                            and what is due today, open mistakes, the
 *                            ones due again in another wording, and
 *                            again_due: all that is due again today, each
 *                            question once (the r.<group> session's size).
 *   myOpenMistakesCount(group)  open mistakes ("הטעויות שלי"'s count).
 *   myDangerDue(group)      the danger list's rows due today, the first is
 *                            Today's "על בטוח" row (review F-9).
 *   myRewordings(group)     each open mistake from an earlier day and what to
 *                            ask instead (Q-2: another wording).
 *   AGAIN_KEY(group)        the practice session of what is due again today,
 *                            each in another wording (?v=practice&s=r.<group>).
 * Each throws Error(code) with the server's code ("group not found"). */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}
const n = (x: unknown) => Number(x ?? 0);

/** The session key of "what is due again today, in another wording" (Q-2). */
export const AGAIN_KEY = (groupId: string) => `r.${groupId}`;

/** Today as the danger list counts it (YYYY-MM-DD, the study day: Israel time from 04:00). */
export const todayText = (now = Date.now()) => dateOfDay(studyDay(now));

export async function myReadiness(groupId: string): Promise<ReadinessRow[]> {
  const { data, error } = await client().rpc("study_my_readiness", { p_group: groupId });
  if (error) fail(error);
  return ((data ?? []) as ReadinessRow[]).map((r) => ({
    ...r,
    part_idx: n(r.part_idx),
    heading: r.heading ?? "",
    answers: n(r.answers),
    right_n: n(r.right_n),
    lo: r.lo === null || r.lo === undefined ? null : n(r.lo),
    hi: r.hi === null || r.hi === undefined ? null : n(r.hi),
  }));
}

export async function myDangerList(groupId: string): Promise<DangerRow[]> {
  const { data, error } = await client().rpc("study_my_danger_list", { p_group: groupId });
  if (error) fail(error);
  return ((data ?? []) as DangerRow[]).map((r) => ({ ...r, slides: (r.slides ?? []).map(n), rights: n(r.rights), chosen: r.chosen ?? "", right_text: r.right_text ?? "" }));
}

export async function myAspects(groupId: string, lectureId?: string): Promise<AspectRow[]> {
  const { data, error } = await client().rpc("study_my_aspects", { p_group: groupId, ...(lectureId ? { p_lecture: lectureId } : {}) });
  if (error) fail(error);
  return ((data ?? []) as AspectRow[]).map((r) => ({ ...r, questions: n(r.questions), wrong_now: n(r.wrong_now), bucket: r.bucket ?? null }));
}

export async function myCalibration(groupId: string): Promise<CalibrationRow[]> {
  const { data, error } = await client().rpc("study_my_calibration", { p_group: groupId });
  if (error) fail(error);
  return ((data ?? []) as CalibrationRow[]).map((r) => ({ ...r, sure: n(r.sure), sure_right: n(r.sure_right), pct: r.pct === null || r.pct === undefined ? null : n(r.pct) }));
}

export async function myProgressCounts(groupId: string): Promise<ProgressCounts> {
  const { data, error } = await client().rpc("study_my_progress_counts", { p_group: groupId });
  if (error) fail(error);
  const r = ((data ?? []) as ProgressCounts[])[0];
  return {
    answers: n(r?.answers),
    parts: n(r?.parts),
    parts_ranged: n(r?.parts_ranged),
    sure: n(r?.sure),
    sure_right: n(r?.sure_right),
    danger: n(r?.danger),
    danger_due: n(r?.danger_due),
    mistakes: n(r?.mistakes),
    rewordings_due: n(r?.rewordings_due),
    again_due: n(r?.again_due),
  };
}

/** "הטעויות שלי"'s count: the open mistakes (section Q's rule, study_open_mistakes). */
export async function myOpenMistakesCount(groupId: string): Promise<number> {
  return (await myProgressCounts(groupId)).mistakes;
}

/** The danger list's rows due today (or before), the first first. */
export async function myDangerDue(groupId: string, now = Date.now()): Promise<DangerRow[]> {
  return dueToday(await myDangerList(groupId), todayText(now));
}

/** One open mistake from an earlier study day and what to ask instead (Q-2,
 *  study_my_rewordings): another question on its paragraph, else a card on
 *  it, else the question itself ("same"). */
export type Rewording = { question_id: string; wrong_at: string; ask_kind: "question" | "card" | "same"; ask_question: string | null; ask_card: string | null };

export async function myRewordings(groupId: string): Promise<Rewording[]> {
  const { data, error } = await client().rpc("study_my_rewordings", { p_group: groupId });
  if (error) fail(error);
  return (data ?? []) as Rewording[];
}
