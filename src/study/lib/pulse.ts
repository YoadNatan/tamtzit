import { db, run } from "./quizOpen";
import type { Meter, MyRow, PulseRow } from "../../../shared/study/pulse";

/** Q10 in practice (shared/study/pulse.ts's SIGNAL_WEIGHT; here so the study entry carries no more of U). */
export const SIGNAL_WEIGHT = { sure: 3, missed: 2, split: 1 } as const;

/* ── The pulse's calls (package U; spec §12.5.U, the fun design §5.4) ──
 * Each names its function and arguments literally, so npm run test:contract
 * checks them against the loaded schema. The database is the referee: who is
 * counted, what a reader may see, from 3 (section U). Every read that runs
 * the night first (study_pulse_ready and the functions that call it) is a
 * POST, so a read can count the study day when pg_cron has not. */

export type { Meter, MyRow, PulseRow } from "../../../shared/study/pulse";

/** The cut-off the counts cover, or null (the switch is off, or the night did not count the caller). */
export const pulseReady = (groupId: string) => run<string | null>(db().rpc("study_pulse_ready", { p_group: groupId }));
export const getMeter = (groupId: string) => run<Meter>(db().rpc("study_pulse_meter", { p_group: groupId }));
export const getPulse = (groupId: string, lectureId?: string) =>
  run<PulseRow[]>(db().rpc("study_pulse", lectureId ? { p_group: groupId, p_lecture: lectureId } : { p_group: groupId }));
export const getMyPulse = (groupId: string, lectureId?: string) =>
  run<MyRow[]>(db().rpc("study_my_pulse", lectureId ? { p_group: groupId, p_lecture: lectureId } : { p_group: groupId }));

export type Brief = {
  hot: { topic: string; aspect: string; slides: number[] } | null;
  question: { question_id: string; question: string; kind: string; slides: number[] } | null;
};
export const getBrief = (lectureId: string) => run<Brief>(db().rpc("study_pulse_brief", { p_lecture: lectureId }));

/** "דרושה אסוציאציה": cards at least 3 members keep forgetting, without a winner on their paragraph. */
export type Needed = { card_id: string; lecture_id: string; part_idx: number | null; anchor: number | null; front: string; slides: number[] };
export const getNeeded = (groupId: string, lectureId?: string) =>
  run<Needed[]>(db().rpc("study_pulse_needed", lectureId ? { p_group: groupId, p_lecture: lectureId } : { p_group: groupId }));

/** The paragraphs at least 3 members found hard (the table's read policy: readers only). */
export async function getSpots(lectureId: string): Promise<Array<{ part_idx: number; anchor: number }>> {
  return run(db().from("study_pulse_spots").select("part_idx,anchor").eq("lecture_id", lectureId));
}

/** Q10 in practice: question id → 3 sure · 2 missed · 1 split, for the questions with a signal. */
export async function getSignals(groupId: string): Promise<Map<string, number>> {
  const rows = await run<Array<{ question_id: string; signal: keyof typeof SIGNAL_WEIGHT }>>(
    db().from("study_pulse_questions").select("question_id,signal").eq("group_id", groupId),
  );
  return new Map(rows.map((r) => [r.question_id, SIGNAL_WEIGHT[r.signal] ?? 0]));
}

/** "לא לכלול אותי בדופק": the member's own row (owner-only). */
export async function getOptOut(groupId: string): Promise<boolean> {
  const rows = await run<Array<{ group_id: string }>>(db().from("study_pulse_optout").select("group_id").eq("group_id", groupId));
  return rows.length > 0;
}
export async function setOptOut(groupId: string, out: boolean): Promise<void> {
  if (out) await run(db().from("study_pulse_optout").insert({ group_id: groupId }));
  else await run(db().from("study_pulse_optout").delete().eq("group_id", groupId));
}
