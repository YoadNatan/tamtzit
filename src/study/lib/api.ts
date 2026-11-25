import type { Box, FigureGeo } from "../../../shared/study/figureGeo";
import {
  createClient,
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type RealtimeChannel,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { REQUIRED_SCHEMA } from "./flags";
import type { Slide } from "./pptx";

/* ── Talking to Supabase and to /api/study ──
 *
 * A client of its own (storageKey "study-auth", kept from the days the app
 * shared a domain with other apps, so a session there was never mistaken for
 * a study member's). Members sign in anonymously with app = "study" in their
 * metadata, which /board's sign-up trigger skips (see study-schema.sql).
 */

// The study app may live in its own Supabase project (more storage, its own
// auth settings): set VITE_STUDY_SUPABASE_URL / _ANON_KEY on Vercel and it
// moves, no code change. Without them it shares the site's project.
const url = (import.meta.env.VITE_STUDY_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL) as string | undefined;
const anonKey = (import.meta.env.VITE_STUDY_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const configured = Boolean(url && anonKey);

export const sb: SupabaseClient | null = configured
  ? createClient(url as string, anonKey as string, {
      auth: { storageKey: "study-auth", persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 5 } },
    })
  : null;

function client(): SupabaseClient {
  if (!sb) throw new Error("not-configured");
  return sb;
}

/** What a wrapper throws when Supabase refuses: an Error whose message is the
 *  refusal's code, the database's exception text ("wrong code", "name taken",
 *  "lecture not found"…), which the screens match (spec §2.11, §5.4).
 *  supabase-js hands PostgREST's refusals over as plain objects, not Errors,
 *  so `err instanceof Error` would otherwise miss every one of them. */
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}

/* ─────────────────────────── types ─────────────────────────── */

export type Group = { id: string; name: string };
export type Member = { user_id: string; name: string };
/** geo: the picture's label geometry (question types: "סימון על תמונה"), when the upload found labels;
 *  crop: a PPTX picture's visible frame (its srcRect), 0..1 of the stored picture. */
export type Figure = { k: number; path: string; w: number; h: number; geo?: FigureGeo; crop?: Box };
export type StoredSlide = Omit<Slide, "images"> & { figures: Figure[] };
export type LectureStatus = "new" | "outlining" | "writing" | "ready" | "failed";
export type LectureRow = {
  id: string;
  group_id: string;
  course: string;
  title: string;
  lecturer: string;
  lecture_date: string | null;
  source_name: string;
  source_kind: "pptx" | "pdf";
  status: LectureStatus;
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Set when the server writer took the lecture (package W). */
  queued_at?: string | null;
  /** A deleted lecture is hidden for 30 days (study_delete_lecture). */
  deleted_at?: string | null;
  deleted_by?: string | null;
};
export type Lecture = LectureRow & { slides: StoredSlide[] };
export type SectionStatus = "pending" | "writing" | "ready" | "failed";
export type Section = {
  lecture_id: string;
  idx: number;
  title: string;
  slide_from: number;
  slide_to: number;
  markdown: string;
  status: SectionStatus;
  error: string | null;
  updated_at: string;
  /** The writer's lease (package W): a claimed part is someone's until then. */
  lease_until?: string | null;
  attempts?: number;
  /** A failed part is tried again by itself at this time. */
  retry_at?: string | null;
  writer?: string | null;
  /** Corrections (package K): the part's revision and its writing generation. */
  rev?: number;
  gen?: number;
};
const SECTION_COLUMNS = "lecture_id, idx, title, slide_from, slide_to, markdown, status, error, updated_at";
const SECTION_F_COLUMNS = `${SECTION_COLUMNS}, lease_until, attempts, retry_at, writer, rev, gen`;

/** A member's mark that they read a lecture (shared inside the group). */
export type ReadMark = { lecture_id: string; user_id: string; read_at: string };
/** "answer" (a shared answer from לשאול) and "mnemonic" (a shared memory aid) come with package K. */
export type CommentKind = "comment" | "question" | "mnemonic" | "answer";
/** A comment or question on one paragraph of a summary part; a reply has parent_id. */
export type Comment = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number;
  quote: string;
  kind: CommentKind;
  body: string;
  parent_id: string | null;
  resolved: boolean;
  author_id: string;
  created_at: string;
};
const COMMENT_COLUMNS = "id, lecture_id, part_idx, anchor, quote, kind, body, parent_id, resolved, author_id, created_at";

const BASE_LECTURE_COLUMNS =
  "id, group_id, course, title, lecturer, lecture_date, source_name, source_kind, status, error, created_by, created_at, updated_at";
const LECTURE_COLUMNS = `${BASE_LECTURE_COLUMNS}, queued_at, deleted_at, deleted_by`;

/* ─────────────────────────── session ─────────────────────────── */

export async function getSession(): Promise<Session | null> {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (s: Session | null) => void): () => void {
  if (!sb) return () => undefined;
  const { data } = sb.auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
}

async function ensureSignedIn(name: string): Promise<Session> {
  const c = client();
  const existing = (await c.auth.getSession()).data.session;
  if (existing) return existing;
  const { data, error } = await c.auth.signInAnonymously({
    options: { data: { app: "study", full_name: name.trim() } },
  });
  if (error || !data.session) throw error ?? new Error("sign-in failed");
  return data.session;
}

/** Signs out on this device only ("יציאה מהמכשיר הזה"): Supabase's default
 *  scope, "global", would sign the person out on every device. The device's
 *  stored conversations, sessions and pending answers go with it (§5.9). */
export async function signOut(): Promise<void> {
  await sb?.auth.signOut({ scope: "local" });
  forgetOtherUsers(null);
}

/* ── The personal code (SQL section I; docs/study/personal-code.md) ──
 * The same member on any device: /api/study/code turns the code into a
 * session of that member's own (anonymous) user, which replaces this
 * device's. No account, no email. */

export type CodeStatus = { has_code: boolean; created_at: string | null; by_opener: boolean; by_name: string | null; notice: boolean };

/** Signs this device in as the code's member. Throws "code not found", "too
 *  many tries", "codes off", "sign-in failed" or "network". Another member's
 *  session on this device is signed out here first (their entries leave with
 *  claimDevice once the new session is in); the same member's is replaced. */
export async function redeemPersonalCode(code: string): Promise<{ userId: string; same: boolean }> {
  const c = client();
  let res: Response;
  try {
    res = await fetch("/api/study/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("network");
  }
  let body: { error?: string; access_token?: string; refresh_token?: string; user_id?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* not json: by its status */
  }
  if (!res.ok) {
    if (res.status === 401 || body.error === "code not found") throw new Error("code not found");
    if (res.status === 429 || body.error === "too many tries") throw new Error("too many tries");
    if (res.status === 503 || body.error === "codes off") throw new Error("codes off");
    throw new Error("sign-in failed");
  }
  if (!body.access_token || !body.refresh_token || !body.user_id) throw new Error("sign-in failed");
  const before = (await c.auth.getSession()).data.session;
  const same = before?.user.id === body.user_id;
  if (before && !same) await c.auth.signOut({ scope: "local" }).catch(() => undefined);
  const { data, error } = await c.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  if (error || !data.session) throw new Error(isAuthRetryableFetchError(error) ? "network" : "sign-in failed");
  return { userId: data.session.user.id, same };
}

/** A new personal code for this member; the one before stops working. */
export async function newPersonalCode(): Promise<string> {
  const { data, error } = await client().rpc("study_code_new");
  if (error) fail(error);
  return String(data ?? "");
}

/** Whether this member has a code, since when, and whether the group's opener made it. */
export async function personalCodeStatus(): Promise<CodeStatus> {
  const { data, error } = await client().rpc("study_code_status");
  if (error) fail(error);
  const r = ((data ?? []) as CodeStatus[])[0];
  return r ?? { has_code: false, created_at: null, by_opener: false, by_name: null, notice: false };
}

/** "הבנתי" on the opener's notice. */
export async function personalCodeSeen(): Promise<void> {
  const { error } = await client().rpc("study_code_seen");
  if (error) fail(error);
}

/** The group's opener makes a member a new personal code (shown once). */
export async function issuePersonalCode(groupId: string, userId: string): Promise<string> {
  const { data, error } = await client().rpc("study_code_issue", { p_group: groupId, p_user: userId });
  if (error) fail(error);
  return String(data ?? "");
}

/** Signs this member out on every other device ("ניתוק המכשירים האחרים"). */
export async function signOutOthers(): Promise<void> {
  const { error } = await client().auth.signOut({ scope: "others" });
  if (error) throw new Error(isAuthRetryableFetchError(error) ? "network" : "sign-in failed");
}

/* ── Storage on the device (spec §5.9; §12.2.5) ──
 * Keys that hold a person's own material carry their user id. When the
 * device's session belongs to another user than the stored one, or on
 * sign-out, the entries of everyone else go, so the next person on a shared
 * device never sees the last one's "לשאול" conversation, practice, unsent
 * association (J's composer) or the day's queue (T). */
const DEVICE_USER = "study-device-user";
const PERSONAL: Array<[prefix: string, store: "local" | "session"]> = [
  ["study-ask-v1:", "local"],
  ["study-question-hidden:", "local"],
  ["study-session:", "session"],
  ["study-quiz-pending:", "session"],
  ["study-wall-draft:", "local"],
  ["study-today:", "session"],
  // The guide's memory of what it showed and what was done (docs/study/guide.md).
  ["study-guide:", "local"],
  // A simulation left open on this phone (past exams, sources.md phase 2): its attempt.
  ["study-mock:", "local"],
  // The personal code made on this device, and "אחר כך" on its prompt (docs/study/personal-code.md).
  ["study-code:", "local"],
  ["study-code-later:", "local"],
];

/** Deletes every personal entry that is not `userId`'s (all of them for null),
 *  and records `userId` as the device's user. */
export function forgetOtherUsers(userId: string | null): void {
  for (const [prefix, which] of PERSONAL) {
    try {
      const store = which === "local" ? localStorage : sessionStorage;
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k?.startsWith(prefix)) keys.push(k);
      }
      for (const k of keys) {
        const owner = k.slice(prefix.length).split(":")[0];
        if (owner !== userId) store.removeItem(k);
      }
    } catch {
      /* no storage: nothing kept */
    }
  }
  try {
    if (userId) localStorage.setItem(DEVICE_USER, userId);
    else localStorage.removeItem(DEVICE_USER);
  } catch {
    /* private mode */
  }
}

/** On start: when the session is another user's than the one the device's
 *  entries belong to, forget the other user's entries. */
export function claimDevice(userId: string): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(DEVICE_USER);
  } catch {
    /* private mode */
  }
  if (stored !== userId) forgetOtherUsers(userId);
}

/* ─────────────────────────── groups ─────────────────────────── */

export async function myGroups(userId: string): Promise<Array<Group & { me: string }>> {
  const { data, error } = await client()
    .from("study_members")
    .select("name, study_groups ( id, name )")
    .eq("user_id", userId);
  if (error) fail(error);
  return (data ?? [])
    .map((r) => {
      const g = (r as unknown as { study_groups: Group | null; name: string }).study_groups;
      return g ? { id: g.id, name: g.name, me: (r as { name: string }).name } : null;
    })
    .filter((g): g is Group & { me: string } => g !== null);
}

export async function createGroup(groupName: string, memberName: string): Promise<Group> {
  await ensureSignedIn(memberName);
  const { data, error } = await client().rpc("study_create_group", {
    p_group_name: groupName.trim(),
    p_member_name: memberName.trim(),
  });
  if (error) fail(error);
  const row = (data as Array<{ id: string; name: string }>)[0];
  return { id: row.id, name: row.name };
}

export async function joinGroup(code: string, memberName: string): Promise<Group> {
  await ensureSignedIn(memberName);
  const { data, error } = await client().rpc("study_join", {
    p_code: code.trim().toUpperCase(),
    p_member_name: memberName.trim(),
  });
  if (error) fail(error);
  const row = (data as Array<{ id: string; name: string }>)[0];
  return { id: row.id, name: row.name };
}

export async function groupCode(groupId: string): Promise<string> {
  const { data, error } = await client().rpc("study_group_code", { g: groupId });
  if (error) fail(error);
  return (data as string) ?? "";
}

export async function members(groupId: string): Promise<Member[]> {
  const { data, error } = await client().from("study_members").select("user_id, name").eq("group_id", groupId);
  if (error) fail(error);
  return (data ?? []) as Member[];
}

/** Who opened the group (its creator replaces the code and removes members). */
export async function groupCreator(groupId: string): Promise<string | null> {
  const { data, error } = await client().from("study_groups").select("created_by").eq("id", groupId).maybeSingle();
  if (error) fail(error);
  return ((data as { created_by?: string } | null)?.created_by as string | undefined) ?? null;
}

/** The group's creator replaces the invite code: a link already sent stops working. */
export async function rotateCode(groupId: string): Promise<string> {
  const { data, error } = await client().rpc("study_rotate_code", { p_group: groupId });
  if (error) fail(error);
  return (data as string) ?? "";
}

/** The group's creator removes a member; their comments and corrections stay. */
export async function removeMember(groupId: string, userId: string): Promise<void> {
  const { error } = await client().rpc("study_remove_member", { p_group: groupId, p_user: userId });
  if (error) fail(error);
}

/** Which members have a personal code, or a saved account (the "יש קוד" chip). */
export async function memberSaved(groupId: string): Promise<Record<string, boolean>> {
  const { data, error } = await client().rpc("study_member_saved", { p_group: groupId });
  if (error) fail(error);
  const out: Record<string, boolean> = {};
  for (const r of (data ?? []) as Array<{ user_id: string; saved: boolean }>) out[r.user_id] = r.saved === true;
  return out;
}

/* ─────────────────────────── lectures ─────────────────────────── */

/** The group's lectures, newest first. A deleted lecture is hidden for 30 days
 *  (study_delete_lecture) and left out here. */
export async function listLectures(groupId: string): Promise<LectureRow[]> {
  const list = (sectionF: boolean) => {
    const q = client().from("study_lectures").select(sectionF ? LECTURE_COLUMNS : BASE_LECTURE_COLUMNS).eq("group_id", groupId);
    return (sectionF ? q.is("deleted_at", null) : q).order("created_at", { ascending: false });
  };
  let { data, error } = await list(true);
  // A database from before section F has no deleted_at column (42703) and
  // nothing hidden: if this code was deployed before its SQL ran, the library
  // still lists every lecture, while writing answers "schema" (spec §2.11).
  if (error?.code === "42703") ({ data, error } = await list(false));
  if (error) fail(error);
  return (data ?? []) as unknown as LectureRow[];
}

const DAY_MS = 86_400_000;

/** Lectures deleted in the last 30 days, newest first ("נמחקו לאחרונה"). */
export async function recentlyDeleted(groupId: string): Promise<LectureRow[]> {
  const { data, error } = await client()
    .from("study_lectures")
    .select(LECTURE_COLUMNS)
    .eq("group_id", groupId)
    .gte("deleted_at", new Date(Date.now() - 30 * DAY_MS).toISOString())
    .order("deleted_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as unknown as LectureRow[];
}

/** "שחזור": puts a deleted lecture back, within 30 days ("too old" after). */
export async function restoreLecture(id: string): Promise<void> {
  const { error } = await client().rpc("study_delete_lecture", { p_lecture: id, p_delete: false });
  if (error) fail(error);
}

const PURGE_KEY = "study-purge-day";

/** Lectures hidden over 30 days go for good: their files first (only the
 *  Storage API removes files), then the row with everything on it. Runs at
 *  most once a day per device, when the library opens; failures wait for the
 *  next day. */
export async function purgeDue(groupId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(PURGE_KEY) === today) return 0;
    localStorage.setItem(PURGE_KEY, today);
  } catch {
    return 0; // no storage: never purge from this device
  }
  const c = client();
  const { data, error } = await c
    .from("study_lectures")
    .select("id, group_id")
    .eq("group_id", groupId)
    .lt("deleted_at", new Date(Date.now() - 30 * DAY_MS).toISOString());
  if (error) return 0;
  let purged = 0;
  for (const l of (data ?? []) as Array<{ id: string; group_id: string }>) {
    try {
      const folder = `${l.group_id}/${l.id}`;
      const listed = await c.storage.from("study").list(folder, { limit: 1000 });
      const paths = (listed.data ?? []).map((f) => `${folder}/${f.name}`);
      if (paths.length) await c.storage.from("study").remove(paths);
      const { data: done } = await c.rpc("study_purge_lecture", { p_lecture: l.id });
      if (done === true) purged += 1;
    } catch {
      /* next time */
    }
  }
  return purged;
}

/** Lectures' titles by id (the banner names what is being read). */
export async function lectureTitles(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data, error } = await client().from("study_lectures").select("id, title").in("id", ids);
  if (error) fail(error);
  return Object.fromEntries(((data ?? []) as Array<{ id: string; title: string }>).map((l) => [l.id, l.title]));
}

export async function getLecture(id: string): Promise<Lecture | null> {
  const read = (columns: string) => client().from("study_lectures").select(`${columns}, slides`).eq("id", id).maybeSingle();
  let { data, error } = await read(LECTURE_COLUMNS);
  if (error?.code === "42703") ({ data, error } = await read(BASE_LECTURE_COLUMNS)); // before section F
  if (error) fail(error);
  return (data as unknown as Lecture | null) ?? null;
}

export async function getSections(lectureId: string): Promise<Section[]> {
  const read = (columns: string) => client().from("study_sections").select(columns).eq("lecture_id", lectureId).order("idx");
  let { data, error } = await read(SECTION_F_COLUMNS);
  if (error?.code === "42703") ({ data, error } = await read(SECTION_COLUMNS)); // before section F
  if (error) fail(error);
  return (data ?? []) as unknown as Section[];
}

/** Deletes a lecture for the whole group by hiding it: its summary, pictures
 *  and everyone's read marks and comments stay for 30 days, after which
 *  study_purge_lecture may remove them. Members can no longer delete the row
 *  itself, so one tap cannot erase the others' work. */
export async function deleteLecture(l: LectureRow & { slides?: StoredSlide[] }): Promise<void> {
  const { error } = await client().rpc("study_delete_lecture", { p_lecture: l.id });
  if (error) fail(error);
}

/** A changed row as Realtime sends it (the full new row; {} on a delete). */
export type Changed = Record<string, unknown>;

/** Live updates for a group's lectures and for one lecture's sections. Read
 *  marks and comments have no group column to filter on; Row Level Security
 *  already limits their events to the member's own group. Callbacks receive
 *  the changed row (`payload.new`), so a screen can patch it in place. */
export function watchGroup(groupId: string, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const ch: RealtimeChannel = sb
    .channel(`study-lectures-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_lectures", filter: `group_id=eq.${groupId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_reads" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_comments" }, onChange)
    .subscribe();
  return () => void sb?.removeChannel(ch);
}

export function watchLecture(
  lectureId: string,
  onChange: (row: Changed, table: string) => void,
  onTogether?: (row: Changed, table: string) => void,
): () => void {
  if (!sb) return () => undefined;
  const main = (p: { new: Changed; table: string }) => onChange(p.new ?? {}, p.table);
  const together = (p: { new: Changed; table: string }) => (onTogether ?? onChange)(p.new ?? {}, p.table);
  const ch: RealtimeChannel = sb
    .channel(`study-lecture-${lectureId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_sections", filter: `lecture_id=eq.${lectureId}` }, main)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_lectures", filter: `id=eq.${lectureId}` }, main)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_comments", filter: `lecture_id=eq.${lectureId}` }, together)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_reads", filter: `lecture_id=eq.${lectureId}` }, together)
    // A deleted row carries only its primary key, so a lecture filter never
    // matches it: listen to every delete and reload.
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "study_comments" }, together)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "study_reads" }, together)
    .subscribe();
  return () => void sb?.removeChannel(ch);
}

/* ─────────────────────────── studying together ─────────────────────────── */

export async function readMarks(lectureIds: string[]): Promise<ReadMark[]> {
  if (!lectureIds.length) return [];
  const { data, error } = await client().from("study_reads").select("lecture_id, user_id, read_at").in("lecture_id", lectureIds);
  if (error) fail(error);
  return (data ?? []) as ReadMark[];
}

export async function setRead(lectureId: string, read: boolean): Promise<void> {
  const c = client();
  // Removing touches only the caller's own mark: the delete policy allows no other.
  const { error } = read
    ? await c.from("study_reads").upsert({ lecture_id: lectureId }, { onConflict: "lecture_id,user_id", ignoreDuplicates: true })
    : await c.from("study_reads").delete().eq("lecture_id", lectureId);
  if (error) fail(error);
}

export async function listComments(lectureIds: string[]): Promise<Comment[]> {
  if (!lectureIds.length) return [];
  const { data, error } = await client()
    .from("study_comments")
    .select(COMMENT_COLUMNS)
    .in("lecture_id", lectureIds)
    .order("created_at");
  if (error) fail(error);
  return (data ?? []) as Comment[];
}

/** Every row of a query, a page at a time (the API returns at most 1000). */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) fail(error);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

/** Read marks of a whole group, for the library: filtered through the group,
 *  not a list of lecture ids (which outgrows a URL within a semester). */
export async function groupReadMarks(groupId: string): Promise<ReadMark[]> {
  return allPages<ReadMark>((from, to) =>
    client()
      .from("study_reads")
      .select("lecture_id, user_id, read_at, study_lectures!inner(group_id)")
      .eq("study_lectures.group_id", groupId)
      .order("id")
      .range(from, to),
  );
}

/** Open questions per lecture of a group, for the library (no comment text). */
export async function groupOpenQuestions(groupId: string): Promise<Record<string, number>> {
  const rows = await allPages<{ lecture_id: string }>((from, to) =>
    client()
      .from("study_comments")
      .select("lecture_id, study_lectures!inner(group_id)")
      .eq("study_lectures.group_id", groupId)
      .eq("kind", "question")
      .eq("resolved", false)
      .is("parent_id", null)
      .order("id")
      .range(from, to),
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.lecture_id] = (out[r.lecture_id] ?? 0) + 1;
  return out;
}

/** An open question of the group, for "יחד" (a tap opens its paragraph). */
export type GroupQuestion = Pick<Comment, "id" | "lecture_id" | "part_idx" | "anchor" | "quote" | "body" | "author_id" | "created_at"> & {
  title: string;
};

/** Every unresolved question in the group, newest first, with its lecture's
 *  title; hidden lectures' questions are left out. */
export async function groupQuestions(groupId: string): Promise<GroupQuestion[]> {
  const rows = await allPages<GroupQuestion & { study_lectures: { title: string } | null }>((from, to) =>
    client()
      .from("study_comments")
      .select("id, lecture_id, part_idx, anchor, quote, body, author_id, created_at, study_lectures!inner(group_id, title)")
      .eq("study_lectures.group_id", groupId)
      .is("study_lectures.deleted_at", null)
      .eq("kind", "question")
      .eq("resolved", false)
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  return rows.map(({ study_lectures, ...q }) => ({ ...q, title: study_lectures?.title ?? "" }));
}

/** The parts' headings of some lectures, for the library's search (no text). */
export async function partTitles(lectureIds: string[]): Promise<Array<{ lecture_id: string; idx: number; title: string }>> {
  if (!lectureIds.length) return [];
  return allPages((from, to) =>
    client().from("study_sections").select("lecture_id, idx, title").in("lecture_id", lectureIds).order("lecture_id").order("idx").range(from, to),
  );
}

export async function addComment(c: {
  lecture_id: string;
  part_idx: number;
  anchor: number;
  quote: string;
  kind: CommentKind;
  body: string;
  parent_id?: string | null;
}): Promise<Comment> {
  const { data, error } = await client()
    .from("study_comments")
    .insert({ ...c, quote: c.quote.slice(0, 200), body: c.body.trim().slice(0, c.kind === "answer" ? 4000 : 2000), parent_id: c.parent_id ?? null })
    .select(COMMENT_COLUMNS)
    .single();
  if (error) fail(error);
  return data as Comment;
}

export async function setResolved(id: string, resolved: boolean): Promise<void> {
  const { error } = await client().from("study_comments").update({ resolved }).eq("id", id);
  if (error) fail(error);
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await client().from("study_comments").delete().eq("id", id);
  if (error) fail(error);
}

/* ── Presence: one helper for both private channels (review FE-6) ──
 * Supabase Realtime allows 5 presence calls per client in 30 s, and warns
 * that calling track() rapidly floods the channel. So every presence call of
 * this client goes through one limiter: at most one track() every 7 s per
 * channel, and never more than 5 in any 31 s on the socket, with a trailing
 * update so the last state always arrives. Leaving a channel removes its
 * presence on the server, so no untrack() is spent on it.
 *
 * The room is kept here, from the join and leave events, one entry per
 * presence ref. The library's own presenceState() cannot be trusted: when a
 * member updates their entry, realtime-js keeps the replaced entry in its
 * state with its ref stripped, so a member who left would still look present
 * (the README's "A workaround for realtime-js"). */

const PER_CHANNEL_MS = 7_000;
const WINDOW_MS = 31_000; // Supabase counts 30 s; one more absorbs clock and network skew
const PER_WINDOW = 5;
const presenceCalls: number[] = []; // this client's recent presence calls

function presenceSlot(now: number): number {
  while (presenceCalls.length && presenceCalls[0] <= now - WINDOW_MS) presenceCalls.shift();
  return presenceCalls.length < PER_WINDOW ? now : presenceCalls[0] + WINDOW_MS + 50;
}

type PresenceEntry = Record<string, unknown> & { key: string };
type Presence = {
  /** Sends `state` as this member's presence, or removes it with null. */
  set(state: Record<string, unknown> | null): void;
  leave(): void;
};

function presenceChannel(topic: string, key: string, onEntries: (entries: PresenceEntry[]) => void, initial: Record<string, unknown> | null): Presence {
  if (!sb) return { set: () => undefined, leave: () => undefined };
  const ch: RealtimeChannel = sb.channel(topic, { config: { private: true, presence: { key } } });
  const entries = new Map<string, PresenceEntry>();
  let joined = false;
  let left = false;
  let wanted: Record<string, unknown> | null = initial;
  let sent: Record<string, unknown> | null | undefined; // undefined: nothing sent yet
  let lastAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;

  ch.on("presence", { event: "join" }, ({ key: k, newPresences }) => {
    for (const p of newPresences) if (p.presence_ref) entries.set(p.presence_ref, { ...(p as Record<string, unknown>), key: k });
  });
  ch.on("presence", { event: "leave" }, ({ leftPresences }) => {
    for (const p of leftPresences) entries.delete(p.presence_ref);
  });
  ch.on("presence", { event: "sync" }, () => onEntries([...entries.values()]));

  const flush = () => {
    timer = undefined;
    if (!joined || left) return;
    if (JSON.stringify(wanted) === JSON.stringify(sent) || (wanted === null && sent === undefined)) return;
    const now = Date.now();
    const at = Math.max(lastAt + PER_CHANNEL_MS, presenceSlot(now));
    if (at > now) {
      timer = setTimeout(flush, at - now);
      return;
    }
    lastAt = now;
    presenceCalls.push(now);
    sent = wanted;
    void (wanted ? ch.track(wanted) : ch.untrack());
  };
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      joined = true;
      flush();
    }
  });
  return {
    set: (state) => {
      wanted = state;
      if (!timer) flush();
    },
    leave: () => {
      left = true;
      clearTimeout(timer);
      void sb?.removeChannel(ch);
    },
  };
}

/* Follow the reader. One private Realtime channel per lecture: the database
 * lets only members of the lecture's group join it (study_can_use_topic in
 * study-schema.sql). Each member's presence says who they are, whether they
 * are reading aloud, and (for the reader) which paragraph they are on.
 * Presence, not one-off messages, so a member who opens the lecture late
 * still finds the reader's place at once. Members' payloads are still checked
 * by the page before use (LectureView). */
export type InRoom = { key: string; user_id: string; name: string; reading: boolean; part?: number; anchor?: number; at?: number };

export type ReadingRoom = {
  /** Start or stop reading aloud. */
  setReading(on: boolean): void;
  /** The reader's current paragraph. */
  setPlace(part: number, anchor: number): void;
  leave(): void;
};

export function readingRoom(lectureId: string, me: { id: string; name: string }, onPeople: (people: InRoom[]) => void): ReadingRoom {
  let state: Omit<InRoom, "key"> = { user_id: me.id, name: me.name, reading: false };
  const room = presenceChannel(
    `study-read-${lectureId}`,
    me.id,
    (entries) => {
      // One entry per member, however many tabs or devices they have open: an
      // entry that is reading wins (the most recent one), else the newest.
      const byKey = new Map<string, InRoom[]>();
      for (const e of entries as unknown as InRoom[]) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
      onPeople(
        [...byKey.values()].map((metas) => {
          const sorted = [...metas].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
          return sorted.find((m) => m.reading === true) ?? sorted[0];
        }),
      );
    },
    state,
  );
  const push = (next: Partial<InRoom>) => {
    state = { ...state, ...next, at: Date.now() };
    room.set(state);
  };
  return {
    setReading: (on) => push({ reading: on, ...(on ? {} : { part: undefined, anchor: undefined }) }),
    setPlace: (part, anchor) => push({ part, anchor }),
    leave: () => room.leave(),
  };
}

/* The group channel, study-group-<group id> (the shell's banner and "יחד"):
 * it carries only what a member chose to share, reading aloud, tracked when
 * it starts and stops. Being in the app is not announced. One channel per
 * group is shared by every screen that listens (the banner, the reader). */
export type LiveReader = { user_id: string; reading: string };
export type GroupLive = { setReading(lectureId: string | null): void; leave(): void };

const groupChannels = new Map<string, { presence: Presence; listeners: Set<(r: LiveReader[]) => void>; last: LiveReader[] }>();

export function groupLive(groupId: string, me: { id: string }, onState: (readers: LiveReader[]) => void): GroupLive {
  let shared = groupChannels.get(groupId);
  if (!shared) {
    const listeners = new Set<(r: LiveReader[]) => void>();
    const box = { presence: null as unknown as Presence, listeners, last: [] as LiveReader[] };
    box.presence = presenceChannel(
      `study-group-${groupId}`,
      me.id,
      (entries) => {
        const readers = new Map<string, LiveReader>();
        for (const e of entries) {
          if (e.key === e.user_id && typeof e.reading === "string" && /^[0-9a-f-]{36}$/.test(e.reading)) {
            readers.set(e.key, { user_id: e.key, reading: e.reading });
          }
        }
        box.last = [...readers.values()];
        for (const l of listeners) l(box.last);
      },
      null,
    );
    groupChannels.set(groupId, box);
    shared = box;
  }
  const mine = shared;
  mine.listeners.add(onState);
  if (mine.last.length) onState(mine.last);
  return {
    setReading: (lectureId) => mine.presence.set(lectureId ? { user_id: me.id, reading: lectureId } : null),
    leave: () => {
      mine.listeners.delete(onState);
      if (!mine.listeners.size) {
        mine.presence.leave();
        groupChannels.delete(groupId);
      }
    },
  };
}

/* ─────────────────────────── upload ─────────────────────────── */

export type NewLecture = {
  groupId: string;
  title: string;
  lecturer: string;
  course: string;
  date: string;
  sourceName: string;
  kind: "pptx" | "pdf";
  slides: Slide[];
  /** The pictures to store for one slide: k = 0 is the whole page, k ≥ 1 embedded pictures. */
  figures: (slide: Slide) => Promise<Array<{ k: number; blob: Blob; width: number; height: number; geo?: FigureGeo; crop?: Box }>>;
  /** The new lecture's id, when the caller made it first (the batch upload
   *  writes it in its resume list before the insert); else a new one. */
  id?: string;
};

/** Saves a new lecture's pictures and slides. Returns the lecture as saved and
 *  the storage paths of its pictures (W's afterUpload signs them for the
 *  server writer without reading them back). */
export async function createLecture(
  input: NewLecture,
  onProgress: (done: number, total: number) => void,
): Promise<{ id: string; lecture: Lecture; figurePaths: string[] }> {
  const c = client();
  const id = input.id ?? crypto.randomUUID();
  const stored: StoredSlide[] = [];
  const total = input.slides.length;
  let done = 0;
  const queue = [...input.slides];
  const workers = Array.from({ length: 3 }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const figs = await input.figures(s);
      const saved: Figure[] = [];
      for (const f of figs) {
        const path = `${input.groupId}/${id}/s${s.n}-${f.k}.jpg`;
        const up = await c.storage.from("study").upload(path, f.blob, { contentType: "image/jpeg", upsert: true });
        if (up.error) throw up.error;
        saved.push({ k: f.k, path, w: f.width, h: f.height, ...(f.geo ? { geo: f.geo } : {}), ...(f.crop ? { crop: f.crop } : {}) });
      }
      const { images: _images, geo: _geo, crops: _crops, ...rest } = s;
      stored.push({ ...rest, figures: saved });
      onProgress(++done, total);
    }
  });
  await Promise.all(workers);
  stored.sort((a, b) => a.n - b.n);

  const row = {
    id,
    group_id: input.groupId,
    title: input.title.trim() || input.sourceName,
    lecturer: input.lecturer.trim(),
    course: input.course.trim(),
    lecture_date: input.date || null,
    source_name: input.sourceName,
    source_kind: input.kind,
    slides: stored,
  };
  const { error } = await c.from("study_lectures").insert(row);
  if (error) fail(error);
  const now = new Date().toISOString();
  const me = (await c.auth.getSession()).data.session?.user.id ?? "";
  const lecture: Lecture = { ...row, status: "new", error: null, created_by: me, created_at: now, updated_at: now, queued_at: null, deleted_at: null, deleted_by: null };
  return { id, lecture, figurePaths: stored.flatMap((s) => s.figures.map((f) => f.path)) };
}

/** "לסמן תוויות בשרטוטים": the label geometry of a lecture's pictures, read
 *  again from the same file on this phone (study_lecture_set_geo, section X).
 *  Returns how many pictures got labels. */
export async function setLectureGeo(lectureId: string, geo: Array<{ n: number; k: number; geo: FigureGeo }>): Promise<number> {
  const { data, error } = await client().rpc("study_lecture_set_geo", { p_lecture: lectureId, p_geo: geo });
  if (error) fail(error);
  return Number(data) || 0;
}

/** A picture's storage path: the pattern createLecture writes. */
export const figurePathOf = (groupId: string, lectureId: string, fig: string): string | null => {
  const m = /^fig:(\d{1,4})-(\d{1,3})$/.exec(fig);
  return m ? `${groupId}/${lectureId}/s${m[1]}-${m[2]}.jpg` : null;
};

export async function figureUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await client().storage.from("study").createSignedUrls(paths, 60 * 60 * 6);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

/* ─────────────────────────── generation ─────────────────────────── */

/** The code of a forced refresh that brought no session:
 *  - "session expired" only when Auth refused the refresh token for good
 *    (a 400, 401 or 403: used, revoked or timed out; or no session at all):
 *    signing in again is the only way back;
 *  - "network" when Auth could not be reached (auth-js counts its 5xx so too);
 *  - "server" for the rest (a 429 from Auth, a refresh auth-js discarded, an
 *    error of its own): the session may still be good, so another try later. */
export const refreshFailure = (error: unknown): "network" | "server" | "session expired" => {
  if (isAuthRetryableFetchError(error) || error instanceof TypeError) return "network";
  if (isAuthSessionMissingError(error)) return "session expired";
  if (isAuthApiError(error) && [400, 401, 403].includes(error.status ?? 0)) return "session expired";
  return "server";
};

/** The server refuses a session with under 5 minutes left ("session
 *  expiring"; 30 s for a quick call with no model call): its token must
 *  outlive a call of up to 270 s. Such a session is refreshed before it is
 *  sent; `refresh` forces it. A forced refresh that brings no new session
 *  never sends the refused token again. It first takes the stored session
 *  when that is another one (another tab refreshed meanwhile); else it
 *  throws refreshFailure's code. On "session expired" the session also goes
 *  from this device (scope local), so the app shows Join, where the sign-in
 *  is: auth-js keeps a session whose token still runs until it runs out,
 *  and the screens would say "signed out" beside a signed-in app for those
 *  minutes. The device's stored material stays (no forgetOtherUsers): the
 *  same member signing in again finds it. An early refresh that fails sends
 *  the token it has: the server decides whether it still serves. */
export async function authHeader(refresh = false): Promise<Record<string, string>> {
  const c = client();
  let s = (await c.auth.getSession()).data.session;
  if (s && (refresh || (s.expires_at ?? Infinity) * 1000 - Date.now() < 360_000)) {
    let next: Session | null = null;
    let error: unknown = null;
    try {
      ({ data: { session: next }, error } = await c.auth.refreshSession());
    } catch (e) {
      error = e;
    }
    if (next) s = next;
    else if (refresh) {
      const stored = (await c.auth.getSession()).data.session;
      if (!stored || stored.access_token === s.access_token) {
        const code = refreshFailure(error);
        if (code === "session expired") await c.auth.signOut({ scope: "local" }).catch(() => undefined);
        throw new Error(code);
      }
      s = stored;
    }
  }
  if (!s) throw new Error("not signed in");
  return { authorization: `Bearer ${s.access_token}`, "content-type": "application/json" };
}

/** POST to /api/study/*; after a 401 "session expiring" the session is
 *  refreshed and the call made once more (a refresh that fails throws
 *  "network", "server" or "session expired" instead: authHeader). */
export async function postStudy(path: string, body: unknown, init?: { signal?: AbortSignal }): Promise<Response> {
  const send = async (refresh: boolean) =>
    fetch(path, { method: "POST", headers: await authHeader(refresh), body: JSON.stringify(body), signal: init?.signal });
  const res = await send(false);
  if (res.status !== 401) return res;
  let code = "";
  try {
    code = ((await res.clone().json()) as { error?: string }).error ?? "";
  } catch {
    /* not json */
  }
  return code === "session expiring" ? send(true) : res;
}

/** The error of a response that did not start a stream: its JSON `error`. */
async function refusalOf(res: Response): Promise<Error> {
  let msg = `http_${res.status}`;
  try {
    msg = ((await res.json()) as { error?: string }).error ?? msg;
  } catch {
    /* not json */
  }
  return new Error(msg);
}

/** Reads an NDJSON stream (the item ops: questions, cards, answers): a U+200B
 *  first byte, then one JSON value per line, and a failure after the start
 *  as "\n\u0000ERROR <code>" (spec §2.11). Each complete line goes to onLine
 *  as it arrives; a line that is not JSON is skipped. */
export async function readLines(res: Response, onLine: (line: unknown) => void): Promise<void> {
  if (!res.ok || !res.body) throw await refusalOf(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let first = true;
  const take = (line: string) => {
    if (first) {
      line = line.replace(/^\u200b/, "");
      first = false;
    }
    const err = line.indexOf("\u0000ERROR");
    if (err >= 0) throw new Error(line.slice(err + 7).trim() || "error");
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    onLine(value);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      take(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  buf += dec.decode();
  if (buf) take(buf);
}

/** Reads a streamed answer; the server marks failures with a NUL + "ERROR". */
async function readStream(res: Response, onText?: (all: string) => void): Promise<string> {
  if (!res.ok || !res.body) throw await refusalOf(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let all = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    all += dec.decode(value, { stream: true });
    const shown = all.replace(/^​/, "");
    const err = shown.indexOf("\u0000ERROR");
    if (err >= 0) throw new Error(shown.slice(err + 7).trim() || "error");
    onText?.(shown);
  }
  all += dec.decode();
  const final = all.replace(/^​/, "");
  const err = final.indexOf("\u0000ERROR");
  if (err >= 0) throw new Error(final.slice(err + 7).trim() || "error");
  return final;
}

export async function runOutline(lectureId: string): Promise<void> {
  await readStream(await postStudy("/api/study/outline", { lectureId }));
}

export async function runSection(lectureId: string, idx: number, onText: (text: string) => void): Promise<void> {
  await readStream(await postStudy("/api/study/section", { lectureId, idx }), onText);
}

/** A section counts as stuck if it says "writing" but its writer is gone:
 *  its lease ran out (30 s allowed for clock skew), or, for a part written
 *  without a lease, nothing happened for 6 minutes (the phone slept, the tab
 *  closed). Anyone may restart it. */
export function isStuck(s: Pick<Section, "status" | "updated_at" | "lease_until">, now = Date.now()): boolean {
  if (s.status !== "writing") return false;
  return s.lease_until ? Date.parse(s.lease_until) < now - 30_000 : now - Date.parse(s.updated_at) > 6 * 60_000;
}

/** A failed unit "המשך כתיבה" already started over, which no writer has
 *  claimed yet: failed with no attempts and a retry time. Only a restart
 *  leaves a unit so (every claim counts an attempt), and study_queue does
 *  not count a second tap on it (W2): it waits its turn. */
export function startedOver(s: Pick<Section, "status" | "attempts" | "retry_at">): boolean {
  return s.status === "failed" && (s.attempts ?? 0) === 0 && Boolean(s.retry_at);
}

/* ─────────────────────────── spend, health, schema ─────────────────────────── */

/** The group's spend this calendar month (UTC), in dollars. */
export async function groupSpent(groupId: string): Promise<number> {
  const { data, error } = await client().rpc("study_spent", { p_group: groupId });
  if (error) fail(error);
  return Number(data ?? 0);
}

/** This member's own optional spend this month (never the summaries). */
export async function mySpent(groupId: string): Promise<number> {
  const { data, error } = await client().rpc("study_my_spent", { p_group: groupId });
  if (error) fail(error);
  return Number(data ?? 0);
}

export type Health = {
  ok?: boolean;
  worker?: boolean;
  budgetUsd?: number;
  schema?: Record<string, number> | null;
  schemaOk?: boolean;
  features?: Record<string, boolean> | null;
  /** The personal code works end to end (section I, the server key, the switch, Auth's email sign-in). */
  codes?: boolean;
};

/** GET /api/study/health, or null when it does not answer in 6 s. */
export async function health(): Promise<Health | null> {
  try {
    const res = await fetch("/api/study/health", { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;
    return (await res.json()) as Health;
  } catch {
    return null;
  }
}

/** Whether a database's sections (study_schema(): {"F":1,…}) are at least
 *  what this build needs (REQUIRED_SCHEMA in flags.ts: F, and each package
 *  whose flag is on). */
export function schemaOk(h: Pick<Health, "schema"> | null, required: Record<string, number> = REQUIRED_SCHEMA): boolean {
  const have = h?.schema;
  if (!have || typeof have !== "object") return false;
  return Object.entries(required).every(([k, v]) => typeof have[k] === "number" && have[k] >= v);
}

/** The schema gate's question on start (review FE-2): false only when the
 *  database is known to be older than this build; true when it is current or
 *  nothing could be asked (offline: the screens say so themselves). */
export async function schemaReady(): Promise<boolean> {
  const h = await health();
  if (h?.schema) return schemaOk(h);
  if (!sb) return true;
  try {
    const { data, error } = await sb.rpc("study_schema");
    if (error) return error.code === "PGRST202" || /study_schema/.test(error.message) ? false : true; // no such function: before section F
    return schemaOk({ schema: data as Record<string, number> });
  } catch {
    return true;
  }
}

