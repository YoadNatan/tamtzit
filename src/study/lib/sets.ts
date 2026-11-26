import type { RealtimeChannel } from "@supabase/supabase-js";
import { sb } from "./api";
import { setLinkText } from "./setsCopy";
import { shareUrl } from "./route";

/* ── Practice sets' data on the phone (docs/study/sets.md, slice B; section L 1) ──
 *
 * The member's RPCs of section L, each a thin wrapper that throws
 * Error(code) with the server's code (failText turns it into words), and the
 * pure rules the set screens share: the shelf's grouping (new first, then by
 * lecture, the hidden folded at the end), "paused" as the server computes it
 * (§7.4), the group's numbers as shown (OD5: an average and bands only from
 * 3 other members who finished, which the server already enforces), the
 * share link's text (no title, no lecture) and a set's date in words.
 * Imported only by the lazy set screens and the session (never by the slot
 * module), so none of it is in the study entry chunk. Answers stay private:
 * nothing here reads study_answers; a set's numbers come from attempt
 * summaries through study_qset_stats. */

export type SetState = "reading" | "making" | "ready";

/** One set as the shelf, the set page and the lecture page show it (study_qsets_shelf). */
export type ShelfRow = {
  id: string;
  kind: "lecture" | "course" | "sheet";
  title: string;
  lecture_id: string | null;
  lecture_title: string | null;
  course: string;
  author_id: string | null;
  /** The author's name in the group, or null once they left. */
  author_name: string | null;
  created_at: string;
  updated_at: string;
  want: number;
  /** Its questions now (the set's items). */
  size: number;
  /** Ready so far (kept, or checked and waiting for "להתחיל לפתור"). */
  made: number;
  state: SetState;
  paused: boolean;
  /** Members with a finished attempt. */
  solvers: number;
  /** The caller's first finished attempt, or null. */
  my_score: number | null;
  my_total: number | null;
  my_open_attempt: string | null;
  is_new: boolean;
  is_mine: boolean;
  is_hidden: boolean;
};

export type Attempt = { id: string; started_at: string; finished_at: string | null; total: number; answered: number; right_n: number };
export type OpenSet = {
  set: ShelfRow;
  items: Array<{ question_id: string; pos: number }>;
  my_attempts: Attempt[];
  /** Drafts the solver could not check ("לאשר או להסיר"). */
  unchecked: string[];
};
export type Progress = { state: SetState; want: number; made: number; size: number; failed: number; unchecked: number; paused: boolean };
/** 1: most were wrong · 2: some were right · 3: most were right (null: too few others answered it). */
export type Band = 1 | 2 | 3;
export type Stats = {
  solvers: number;
  others: number;
  floor: number;
  mine: { answered: number; right_n: number; total: number } | null;
  /** The share right (0-1) over every finisher's first attempt; only from `floor` others. */
  avg: number | null;
  per_q: Array<{ question_id: string; pos: number; band: Band | null }> | null;
  names: string[];
};
export type Finish = { answered: number; right_n: number; total: number; first: boolean };

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}
const num = (x: unknown): number => (typeof x === "number" ? x : Number(x ?? 0) || 0);
const numOrNull = (x: unknown): number | null => (x === null || x === undefined ? null : num(x));

/** A row as it comes (numbers may come as strings), as the screens read it. */
export function toRow(r: Record<string, unknown>): ShelfRow {
  return {
    id: String(r.id),
    kind: (r.kind as ShelfRow["kind"]) ?? "lecture",
    title: String(r.title ?? ""),
    lecture_id: (r.lecture_id as string | null) ?? null,
    lecture_title: (r.lecture_title as string | null) ?? null,
    course: String(r.course ?? ""),
    author_id: (r.author_id as string | null) ?? null,
    author_name: (r.author_name as string | null) ?? null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? r.created_at ?? ""),
    want: num(r.want),
    size: num(r.size),
    made: num(r.made),
    state: (r.state as SetState) ?? "ready",
    paused: r.paused === true,
    solvers: num(r.solvers),
    my_score: numOrNull(r.my_score),
    my_total: numOrNull(r.my_total),
    my_open_attempt: (r.my_open_attempt as string | null) ?? null,
    is_new: r.is_new === true,
    is_mine: r.is_mine === true,
    is_hidden: r.is_hidden === true,
  };
}

/* ─────────────────────────── reads ─────────────────────────── */

/** "סטים של הקבוצה" (with a lecture: the sets on it), newest first, hidden ones included. */
export async function shelf(groupId: string, lectureId?: string, limit = 40): Promise<ShelfRow[]> {
  const { data, error } = await client().rpc("study_qsets_shelf", { p_group: groupId, p_lecture: lectureId ?? null, p_limit: limit });
  if (error) fail(error);
  return ((data ?? []) as Array<Record<string, unknown>>).map(toRow);
}

/** A set's page: its row, its questions in order, the caller's attempts. 'set not found' for a deleted one. */
export async function openSet(setId: string): Promise<OpenSet> {
  const { data, error } = await client().rpc("study_qset_open", { p_set: setId });
  if (error) fail(error);
  const d = (data ?? {}) as { set?: Record<string, unknown> | null; items?: Array<{ question_id: string; pos: number }>; my_attempts?: Attempt[]; unchecked?: string[] };
  if (!d.set) throw new Error("set not found");
  return {
    set: toRow(d.set),
    items: [...(d.items ?? [])].map((i) => ({ question_id: String(i.question_id), pos: num(i.pos) })).sort((a, b) => a.pos - b.pos),
    my_attempts: (d.my_attempts ?? []).map((a) => ({ ...a, total: num(a.total), answered: num(a.answered), right_n: num(a.right_n) })),
    unchecked: (d.unchecked ?? []).map(String),
  };
}

/** The generating state, brought up to date by the server (and its once-only notice). */
export async function setProgress(setId: string): Promise<Progress> {
  const { data, error } = await client().rpc("study_qset_progress", { p_set: setId });
  if (error) fail(error);
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    state: (d.state as SetState) ?? "making",
    want: num(d.want),
    made: num(d.made),
    size: num(d.size),
    failed: num(d.failed),
    unchecked: num(d.unchecked),
    paused: d.paused === true,
  };
}

/** The group's numbers on a set (OD5). */
export async function setStats(setId: string): Promise<Stats> {
  const { data, error } = await client().rpc("study_qset_stats", { p_set: setId });
  if (error) fail(error);
  const d = (data ?? {}) as Record<string, unknown>;
  const mine = d.mine as Record<string, unknown> | null | undefined;
  return {
    solvers: num(d.solvers),
    others: num(d.others),
    floor: num(d.floor) || 3,
    mine: mine ? { answered: num(mine.answered), right_n: num(mine.right_n), total: num(mine.total) } : null,
    avg: numOrNull(d.avg),
    per_q: Array.isArray(d.per_q)
      ? (d.per_q as Array<Record<string, unknown>>).map((p) => ({ question_id: String(p.question_id), pos: num(p.pos), band: (numOrNull(p.band) as Band | null) ?? null }))
      : null,
    names: Array.isArray(d.names) ? (d.names as unknown[]).map(String) : [],
  };
}

/** The requests that fill a set (one for a lecture set). */
export async function setRequests(setId: string): Promise<string[]> {
  const { data, error } = await client().from("study_qset_requests").select("request_id").eq("set_id", setId);
  if (error) fail(error);
  return ((data ?? []) as Array<{ request_id: string }>).map((r) => r.request_id);
}

/** The caller's choice about showing their name among who solved (OD7), or null: never asked. */
export async function myNamesPref(): Promise<{ show_name: boolean; asked_at: string | null } | null> {
  const { data, error } = await client().from("study_qset_prefs").select("show_name, asked_at").maybeSingle();
  if (error) fail(error);
  return data ? { show_name: Boolean((data as { show_name: boolean }).show_name), asked_at: (data as { asked_at: string | null }).asked_at ?? null } : null;
}

/* ─────────────────────────── writes (RPCs only) ─────────────────────────── */

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client().rpc(fn, args);
  if (error) fail(error);
  return data;
}

/** "חדש" clears for the sets the caller opened. */
export const markSeen = (ids: string[]): Promise<unknown> => (ids.length ? call("study_qset_seen", { p_sets: ids }) : Promise.resolve(0));
/** "להסתיר אצלי" / "להחזיר". */
export const hideSet = (setId: string, hidden: boolean): Promise<unknown> => call("study_qset_hide", { p_set: setId, p_hidden: hidden });
/** The author or the group's creator: the set leaves every shelf; its questions stay in the bank. */
export const deleteSet = (setId: string): Promise<unknown> => call("study_qset_delete", { p_set: setId });
/** The author's new title. */
export const renameSet = (setId: string, title: string): Promise<unknown> => call("study_qset_rename", { p_set: setId, p_title: title });
/** OD7's opt-in. */
export const setNamesPref = (on: boolean): Promise<unknown> => call("study_qset_names_pref", { p_on: on });

/** "לפתור": the caller's open attempt from the last 12 hours, or a new one. */
export async function attemptStart(setId: string): Promise<{ id: string; total: number }> {
  const d = (await call("study_qset_attempt_start", { p_set: setId })) as Record<string, unknown> | Array<Record<string, unknown>> | null;
  const row = Array.isArray(d) ? d[0] : d;
  if (!row?.id) throw new Error("attempt not found");
  return { id: String(row.id), total: num(row.total) };
}

/** The end of a round: scored on the first answer per question (first: the caller's first finished attempt of the set). */
export async function attemptFinish(attempt: string): Promise<Finish> {
  const d = ((await call("study_qset_attempt_finish", { p_attempt: attempt })) ?? {}) as Record<string, unknown>;
  return { answered: num(d.answered), right_n: num(d.right_n), total: num(d.total), first: d.first === true };
}

/* ─────────────────────────── live ─────────────────────────── */

let watchSeq = 0;

/** The group's sets and their questions as they change (study_qsets and study_qset_items are in Realtime). */
export function watchSets(scope: { groupId: string } | { setId: string }, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const on = () => onChange();
  let ch: RealtimeChannel = sb.channel(`study-qsets-${"setId" in scope ? scope.setId : scope.groupId}-${++watchSeq}`);
  ch =
    "setId" in scope
      ? ch
          .on("postgres_changes", { event: "*", schema: "public", table: "study_qsets", filter: `id=eq.${scope.setId}` }, on)
          .on("postgres_changes", { event: "*", schema: "public", table: "study_qset_items", filter: `set_id=eq.${scope.setId}` }, on)
      : ch.on("postgres_changes", { event: "*", schema: "public", table: "study_qsets", filter: `group_id=eq.${scope.groupId}` }, on);
  ch.subscribe();
  return () => void sb?.removeChannel(ch);
}

/* ─────────────────────────── pure rules ─────────────────────────── */

/** "Paused" as section L computes it (§7.4): a set reading its lecture for 6
 *  minutes, or one being written whose newest open batch has not moved for 6. */
export const PAUSE_MS = 6 * 60_000;
export function isPaused(o: { state: SetState; updatedAt: string; busy: number; lastAt: string | null }, now = Date.now()): boolean {
  const old = (at: string | null) => {
    const t = Date.parse(at ?? "");
    return Number.isFinite(t) && t < now - PAUSE_MS;
  };
  if (o.state === "reading") return old(o.updatedAt);
  if (o.state === "making") return o.busy > 0 && old(o.lastAt ?? o.updatedAt);
  return false;
}

export type ShelfGroups = {
  /** Sets the caller has not opened (never their own), newest first. */
  fresh: ShelfRow[];
  /** The rest by lecture, the lecture with the latest activity first, its sets newest first. */
  lectures: Array<{ lecture_id: string | null; title: string; course: string; rows: ShelfRow[] }>;
  /** Hidden for the caller ("הוסתרו"), newest first. */
  hidden: ShelfRow[];
};

/** The shelf's order (design §5.8): new first, then grouped by lecture, the hidden folded at the end. */
export function shelfGroups(rows: readonly ShelfRow[]): ShelfGroups {
  const newest = (a: ShelfRow, b: ShelfRow) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1);
  const activity = (r: ShelfRow) => (r.updated_at > r.created_at ? r.updated_at : r.created_at);
  const shown = rows.filter((r) => !r.is_hidden);
  const fresh = shown.filter((r) => r.is_new).sort(newest);
  const by = new Map<string, { lecture_id: string | null; title: string; course: string; rows: ShelfRow[]; last: string }>();
  for (const r of shown.filter((x) => !x.is_new)) {
    const k = r.lecture_id ?? "";
    const g = by.get(k) ?? { lecture_id: r.lecture_id, title: r.lecture_title ?? "", course: r.course, rows: [], last: "" };
    g.rows.push(r);
    if (activity(r) > g.last) g.last = activity(r);
    by.set(k, g);
  }
  const lectures = [...by.values()]
    .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : a.title.localeCompare(b.title, "he")))
    .map(({ last: _last, ...g }) => ({ ...g, rows: g.rows.sort(newest) }));
  return { fresh, lectures, hidden: rows.filter((r) => r.is_hidden).sort(newest) };
}

/** The group's average as "x/n" (one decimal), from the share right; null without one. */
export function avgOutOf(avg: number | null, n: number): number | null {
  if (avg === null || !Number.isFinite(avg) || n <= 0) return null;
  return Math.round(avg * n * 10) / 10;
}

/** A band's words' key. */
export const bandKey = (b: Band): "few" | "some" | "most" => (b === 1 ? "few" : b === 2 ? "some" : "most");

/** Whether a set can be solved now: one question at least (a set being made too). */
export const solvable = (r: Pick<ShelfRow, "size">): boolean => r.size > 0;

/** A set's date (Israel time): "היום 14:20", "אתמול", else "12.11". */
export function setWhen(at: string, now = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const key = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  if (key(d) === key(now)) return `היום ${d.toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" })}`;
  if (key(d) === key(new Date(now.getTime() - 86_400_000))) return "אתמול";
  const [, m, day] = key(d).split("-");
  return `${Number(day)}.${Number(m)}`;
}

/** The set's own link (?v=sets&k=…): members only (decision 1); it opens the same set for any member. */
export const setLink = (setId: string): string => shareUrl(`?v=sets&k=${setId}`);

/** "לשלוח קישור": the phone's share sheet with the generic text (no title, no
 *  lecture), else the clipboard. "shared", "copied" ("הקישור הועתק"), or
 *  "none" (closed, or nothing worked). */
export async function shareSet(setId: string, size: number): Promise<"shared" | "copied" | "none"> {
  const url = setLink(setId);
  const text = setLinkText(size, url);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ text });
      return "shared";
    }
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return "none";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "none";
  }
}
