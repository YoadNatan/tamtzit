import { dateOfDay, dayOfDate, dayStart, studyDay } from "../../../shared/study/day";
import { marathonMinutes, minutesOfClock, LANE, type Block, type GroupPlan, type LaneDay, type LectureFact, type MeterRow, type RelearnRow } from "../../../shared/study/lane";
import { getSections, groupReadMarks, listLectures, members, sb } from "./api";

/* ── Package G's data: the group's marathon plan (spec §12.6.G; review F-7:
 *    G's own module, not lib/plan.ts) ──
 *
 * The plan is the group's (section G's study_group_plans, read by members
 * through RLS, changed only through study_group_plan_save with names); its
 * days are section P's marathons with plan_id and plan_day, saved for the
 * next LANE.SAVE_DAYS days only (PL2); the meter is
 * study_group_plan_meter (decision 3: real counts, from 3 members); the
 * relearning rounds are the caller's own (study_my_relearning). Every call
 * throws Error(code) with the database's code ("plan not found",
 * "conflict"); failText(code, "plan") words it. Loaded only by G's screens
 * and slots (lazily), so nothing here is in the study entry. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}
const num = (x: unknown) => Number(x ?? 0);

/** Today as the plan counts it (YYYY-MM-DD, the study day). */
export const todayIso = (now = Date.now()) => dateOfDay(studyDay(now));

const PLAN_COLUMNS = "id, group_id, title, exam_date, lecture_ids, shared_from, leave_from, shared_minutes, leave_minutes, rounds, day_start, slips, version, created_by, updated_by, updated_at";

/** The group's active plan, or null. */
export async function activePlan(groupId: string): Promise<GroupPlan | null> {
  const { data, error } = await client().from("study_group_plans").select(PLAN_COLUMNS).eq("group_id", groupId).eq("state", "active").limit(1);
  if (error) fail(error);
  const p = ((data ?? []) as unknown as GroupPlan[])[0];
  return p ? { ...p, day_start: String(p.day_start ?? "09:00").slice(0, 5), slips: Array.isArray(p.slips) ? p.slips : [], rounds: num(p.rounds), version: num(p.version) } : null;
}

export type PlanInput = {
  title: string;
  exam_date: string;
  lecture_ids: string[];
  shared_minutes: number;
  leave_minutes: number;
  rounds: number;
};

/** PL1: a new plan (archives the group's previous one) or a change at `version`. */
export async function savePlan(groupId: string, input: PlanInput, existing: Pick<GroupPlan, "id" | "version" | "day_start"> | null): Promise<{ id: string; version: number }> {
  const { data, error } = await client().rpc("study_group_plan_save", {
    p_id: existing?.id ?? null,
    p_version: existing?.version ?? null,
    p_group: groupId,
    p_title: input.title,
    p_exam_date: input.exam_date,
    p_lectures: input.lecture_ids,
    p_shared_from: dateOfDay(dayOfDate(input.exam_date) - LANE.SHARED_DAYS),
    p_leave_from: dateOfDay(dayOfDate(input.exam_date) - LANE.LEAVE_DAYS),
    p_shared_minutes: input.shared_minutes,
    p_leave_minutes: input.leave_minutes,
    p_rounds: input.rounds,
    p_day_start: existing?.day_start ?? "09:00",
  });
  if (error) fail(error);
  const r = ((data ?? []) as Array<{ id: string; version: number }>)[0];
  return { id: r.id, version: num(r.version) };
}

/** PL5: the price of a day that slipped, with the member's name. */
export async function priceSlip(planId: string, day: string, choice: "longer" | "drop_review", until: string | null): Promise<number> {
  const { data, error } = await client().rpc("study_group_plan_slip", { p_plan: planId, p_day: day, p_choice: choice, p_until: until });
  if (error) fail(error);
  return num(data);
}

/** Decision 3's meter, one row a lecture (no names). */
export async function planMeterRows(planId: string): Promise<MeterRow[]> {
  const { data, error } = await client().rpc("study_group_plan_meter", { p_plan: planId });
  if (error) fail(error);
  return ((data ?? []) as MeterRow[]).map((r) => ({ ...r, answers: num(r.answers), answers_short: num(r.answers_short), members_short: num(r.members_short), bucket: r.bucket ?? null }));
}

/** PL4: the caller's own rounds. */
export async function myRelearning(planId: string): Promise<RelearnRow[]> {
  const { data, error } = await client().rpc("study_my_relearning", { p_plan: planId });
  if (error) fail(error);
  return ((data ?? []) as RelearnRow[]).map((r) => ({ ...r, rounds: num(r.rounds), key_total: num(r.key_total), key_left: num(r.key_left) }));
}

/** A day of the lane as section P saved it. */
export type PlanDayRow = { id: string; plan_day: string; title: string; starts_at: string; minutes: number; agenda: Block[]; step: number; state: string; version: number; updated_by: string | null; updated_at: string };

/** The plan's saved days (marathons with plan_id). */
export async function planDayRows(planId: string): Promise<PlanDayRow[]> {
  const { data, error } = await client()
    .from("study_marathons")
    .select("id, plan_day, title, starts_at, minutes, agenda, step, state, version, updated_by, updated_at")
    .eq("plan_id", planId)
    .neq("state", "cancelled")
    .order("plan_day");
  if (error) fail(error);
  return ((data ?? []) as PlanDayRow[]).map((r) => ({ ...r, agenda: Array.isArray(r.agenda) ? r.agenda : [], step: num(r.step), version: num(r.version), minutes: num(r.minutes) }));
}

/** The instant "HH:MM" on a date, Israel time (the marathon's starts_at):
 *  from the study day's 04:00 (shared/study/day.ts's dayStart). */
export function startsAt(day: string, clock: string): string {
  return new Date(dayStart(dayOfDate(day)) + (minutesOfClock(clock) - 240) * 60_000).toISOString();
}

/** PL2: saves the lane's next days as marathons of the plan: a missing day
 *  is created; with `rewrite` (the plan itself changed, by a member, with
 *  her name) an existing day is rewritten at its version, and a day a member
 *  edited meanwhile answers "conflict" and stays as she left it. Days that
 *  already started are never touched. Returns how many were saved. */
export async function saveLaneDays(plan: GroupPlan, lane: readonly LaneDay[], saved: readonly PlanDayRow[], titleOf: (l: string) => string, rewrite = false, now = Date.now()): Promise<number> {
  const today = todayIso(now);
  const last = dateOfDay(dayOfDate(today) + LANE.SAVE_DAYS - 1);
  const have = new Map(saved.map((r) => [r.plan_day, r]));
  let n = 0;
  // The plan changed (a member, with her name): a saved day that is no longer a
  // day of it (the exam moved earlier) and has not started is cancelled.
  if (rewrite) {
    const days = new Set(lane.map((d) => d.day));
    for (const r of saved) {
      if (r.state !== "planned" || days.has(r.plan_day) || r.plan_day < today) continue;
      const { error } = await client().rpc("study_marathon_cancel", { p_id: r.id, p_cancel: true });
      if (!error) n++;
    }
  }
  for (const d of lane) {
    if (d.day < today || d.day > last || !d.blocks.length) continue;
    const row = have.get(d.day);
    if (row && (!rewrite || row.state !== "planned")) continue;
    const start = startsAt(d.day, plan.day_start);
    if (Date.parse(start) < now - 30 * 60_000) continue; // section P: a new day cannot start in the past
    const lectures = d.lectures.slice(0, 20);
    const agenda = d.blocks.filter((b) => !b.l || lectures.includes(b.l));
    const head = d.blocks.find((b) => b.k === "read" && b.l);
    const title = `יום ${d.n}/${d.total}${head?.l ? ` · ${titleOf(head.l)}` : ""}`.slice(0, 120);
    const { error } = await client().rpc("study_group_plan_day", {
      p_plan: plan.id,
      p_day: d.day,
      p_version: row ? row.version : null,
      p_title: title,
      p_starts_at: start,
      p_minutes: marathonMinutes(d),
      p_lectures: lectures,
      p_agenda: agenda.map((b) => clean(b)),
    });
    if (!error) n++;
  }
  return n;
}

/** A step as section P's run-of-show takes it (no undefined keys). */
function clean(b: Block): Block {
  const out: Record<string, unknown> = { k: b.k, min: Math.max(1, Math.min(LANE.MAX_BLOCK_MIN, Math.round(b.min))) };
  if (b.l) out.l = b.l;
  if (b.from !== undefined) out.from = b.from;
  if (b.to !== undefined) out.to = b.to;
  if (b.n !== undefined) out.n = b.n;
  if (b.title) out.title = b.title.slice(0, 80);
  if (b.moved) out.moved = true;
  return out as Block;
}

/** What the plan needs to know of its lectures: titles, ready parts with their
 *  slides, who read each (what every member sees already: who-read-what). */
export async function lectureFacts(groupId: string, userId: string, ids: readonly string[]): Promise<{ facts: Record<string, LectureFact>; members: number; all: Array<{ id: string; title: string }> }> {
  const [lectures, marks, people] = await Promise.all([listLectures(groupId), groupReadMarks(groupId), members(groupId)]);
  const wanted = new Set(ids);
  const facts: Record<string, LectureFact> = {};
  await Promise.all(
    lectures
      .filter((l) => wanted.has(l.id))
      .map(async (l) => {
        const parts = await getSections(l.id).catch(() => []);
        const ready = parts.filter((p) => p.status === "ready").sort((a, b) => a.idx - b.idx);
        const readers = new Set(marks.filter((m) => m.lecture_id === l.id).map((m) => m.user_id));
        facts[l.id] = {
          id: l.id,
          title: l.title,
          parts: Math.max(1, ready.length || parts.length),
          slides: (ready.length ? ready : parts).map((p) => [num(p.slide_from), num(p.slide_to)] as [number, number]),
          readers: readers.size,
          readByMe: readers.has(userId),
        };
      }),
  );
  return { facts, members: people.length, all: lectures.map((l) => ({ id: l.id, title: l.title })) };
}
