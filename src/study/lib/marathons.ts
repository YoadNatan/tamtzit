import type { Block } from "../../../shared/study/lane";
import { sb } from "./api";

/* ── Marathons (section P's, shared inside the group; spec §6.4 A R1-R6) ──
 * The group reads every marathon and who is in (RLS: members); changes go
 * through section P's functions (study_marathon_save, _answer, _step,
 * _cancel), each with the member's name. A day of the group's plan (package
 * G) is a marathon with plan_id. Loaded lazily by the marathons' screen and
 * the card on "יחד". */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}
const num = (x: unknown) => Number(x ?? 0);

export type Answer = "in" | "maybe" | "out";
export type Marathon = {
  id: string;
  title: string;
  starts_at: string;
  minutes: number;
  place: string;
  note: string;
  lecture_ids: string[];
  agenda: Block[];
  state: "planned" | "live" | "ended" | "cancelled";
  step: number;
  version: number;
  plan_id: string | null;
  updated_by: string | null;
  created_by: string | null;
  people: Array<{ user_id: string; answer: Answer }>;
};

const COLUMNS = "id, title, starts_at, minutes, place, note, lecture_ids, agenda, state, step, version, updated_by, created_by";

/** Over as section P says it: ended, cancelled, or 3 hours past its planned end. */
export const isOver = (m: Pick<Marathon, "state" | "starts_at" | "minutes">, now = Date.now()): boolean =>
  m.state === "ended" || m.state === "cancelled" || now > Date.parse(m.starts_at) + (m.minutes + 180) * 60_000;

async function withPeople(rows: Array<Omit<Marathon, "people" | "plan_id"> & { plan_id?: string | null }>): Promise<Marathon[]> {
  if (!rows.length) return [];
  const { data, error } = await client().from("study_marathon_people").select("marathon_id, user_id, answer").in("marathon_id", rows.map((r) => r.id));
  if (error) fail(error);
  const by = new Map<string, Marathon["people"]>();
  for (const p of (data ?? []) as Array<{ marathon_id: string; user_id: string; answer: Answer }>) by.set(p.marathon_id, [...(by.get(p.marathon_id) ?? []), { user_id: p.user_id, answer: p.answer }]);
  return rows.map((r) => ({ ...r, plan_id: r.plan_id ?? null, agenda: Array.isArray(r.agenda) ? r.agenda : [], minutes: num(r.minutes), step: num(r.step), version: num(r.version), people: by.get(r.id) ?? [] }));
}

/** The group's marathons that are not over, soonest first (and those of the last 3 hours). */
export async function upcoming(groupId: string, now = Date.now()): Promise<Marathon[]> {
  const { data, error } = await client()
    .from("study_marathons")
    .select(COLUMNS)
    .eq("group_id", groupId)
    .neq("state", "cancelled")
    .gte("starts_at", new Date(now - 15 * 3_600_000).toISOString())
    .order("starts_at")
    .limit(30);
  if (error) fail(error);
  const rows = await withPeople((data ?? []) as unknown as Marathon[]);
  return rows.filter((m) => !isOver(m, now));
}

/** One marathon, with who is in; null when it is not there. */
export async function oneMarathon(id: string): Promise<Marathon | null> {
  const full = await client().from("study_marathons").select(`${COLUMNS}, plan_id`).eq("id", id).limit(1);
  // Before section G there is no plan_id column (42703): read without it.
  const { data, error } = full.error?.code === "42703" ? await client().from("study_marathons").select(COLUMNS).eq("id", id).limit(1) : full;
  if (error) fail(error);
  const rows = await withPeople((data ?? []) as unknown as Marathon[]);
  return rows[0] ?? null;
}

export async function saveMarathon(groupId: string, m: { id: string | null; version: number | null; title: string; starts_at: string; minutes: number; lecture_ids: string[]; agenda: Block[] }): Promise<string> {
  const { data, error } = await client().rpc("study_marathon_save", {
    p_id: m.id,
    p_version: m.version,
    p_group: groupId,
    p_title: m.title,
    p_starts_at: m.starts_at,
    p_minutes: m.minutes,
    p_place: "",
    p_note: "",
    p_lectures: m.lecture_ids,
    p_agenda: m.agenda,
  });
  if (error) fail(error);
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? "";
}

export async function answerMarathon(id: string, answer: Answer): Promise<void> {
  const { error } = await client().rpc("study_marathon_answer", { p_id: id, p_answer: answer });
  if (error) fail(error);
}

/** Moves the run-of-show from `from` to `to` (to = the number of steps ends it). */
export async function stepMarathon(id: string, from: number, to: number): Promise<number> {
  const { data, error } = await client().rpc("study_marathon_step", { p_id: id, p_from: from, p_to: to });
  if (error) fail(error);
  return num(data);
}
