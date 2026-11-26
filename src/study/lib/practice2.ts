import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_LEVEL,
  DEFAULT_STYLES,
  type CreateAnswer,
  type Difficulty,
  type Draft,
  type Level,
  type Options,
  type PlanAnswer,
  type PointsLine,
  type SessionCount,
  type Style,
  type StyleAnswer,
  type StyleRead,
  type WriteLine,
} from "../../../shared/study/practice2";
import type { FlagReason } from "../../../shared/study/aspects";
import { postStudy, readLines, sb } from "./api";
import { hasText } from "./failText";
import { flags } from "./flags";
import type { PointPartRow } from "./pointsRead";
import { startRound, type RoundResult } from "./rounds";

/* ── Practice 2.0 on the phone: the op's actions, the drafts, the counts ──
 *
 * What the four approved screens call (docs/study/practice-2-api.md): action
 * "plan" (free) for מה ליצור's numbers, "points" (once per lecture for the
 * group) when the points to know are not current, "style" for an example read
 * back, "create" for a request and its batches, then each batch written as a
 * release-1 round is (rounds.ts: the first alone until its start line, then
 * two at a time), "reword" for "↻ לנסח מחדש"; the drafts' RPCs (keep, keep
 * all, remove) and "הבנק נבנה"'s progress; and סבב חדש's private counts. Every
 * wrapper throws Error(code) with the server's code, which the screens turn
 * into Hebrew with failText(code, "practice"). The drafts never carry their
 * key: it stays in study_question_draft_keys, which no member reads. */

export type { CreateAnswer, Draft, Options, PlanAnswer, SessionCount, StyleAnswer, StyleRead } from "../../../shared/study/practice2";

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}
/** fetch's own failures (a dropped connection, a locked phone) are TypeErrors: "network". */
function network(e: unknown): never {
  if (e instanceof TypeError) throw new Error("network");
  throw e;
}

/** Error(code) with the answer's own code as `raw` (failText.ts failCode). */
function coded(code: string, raw: string): Error {
  return Object.assign(new Error(code), { raw });
}

/** POST op "questions" with an action; a JSON answer, or Error(code). An
 *  answer that is no JSON (the platform's own page or a firewall's) is
 *  "server" for a 5xx, "blocked" for a 403 or 429; a 5xx whose code has no
 *  words is "server"; an empty 200 is "bad reply". Each keeps what came as
 *  `raw` ("http_504", the database's message), so the screen can show it. */
async function action<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await postStudy("/api/study/ai", { op: "questions", ...body });
  } catch (e) {
    network(e);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const code = (json as { error?: unknown } | null)?.error;
    if (typeof code !== "string" || !code) throw coded(res.status === 403 || res.status === 429 ? "blocked" : "server", `http_${res.status}`);
    if (res.status >= 500 && !hasText(code, "practice")) throw coded("server", code);
    throw new Error(code);
  }
  if (json === null || typeof json !== "object") throw coded("bad reply", `http_${res.status}`);
  return json as T;
}

/** A streamed action: each line to `on`, in order. `open`: the server
 *  accepted it (a 200 whose stream starts), before any line. `signal` closes it. */
async function stream<L>(body: Record<string, unknown>, on: (line: L) => void, opts: StreamOpts = {}): Promise<void> {
  try {
    const res = await postStudy("/api/study/ai", { op: "questions", ...body }, { signal: opts.signal });
    if (res.ok && res.body) opts.open?.();
    await readLines(res, (line) => {
      if (line && typeof line === "object" && typeof (line as { t?: unknown }).t === "string") on(line as L);
    });
  } catch (e) {
    network(e);
  }
}

/* ─────────────────────────── the op's actions ─────────────────────────── */

/** מה ליצור's numbers: the parts with their points, the levels' counts, the plan of these options and every estimate. Free. */
export function askPlan(lectureId: string, options?: Partial<Options>): Promise<PlanAnswer> {
  return action<PlanAnswer>({ action: "plan", lectureId, ...(options ? { options } : {}) });
}

/** "סט חדש"'s planning inputs with the same answer (`inputs`: the points, the
 *  bank's coverage, the headroom and the prices; practice sets D13). Free. */
export function askPlanInputs(lectureId: string, options?: Partial<Options>): Promise<PlanAnswer> {
  return action<PlanAnswer>({ action: "plan", lectureId, inputs: true, ...(options ? { options } : {}) });
}

type StreamOpts = { signal?: AbortSignal; open?: () => void };

/** Reads the summary's points to know (only its stale parts, for the whole
 *  group). The server goes on reading when this stream ends early (a locked
 *  phone, another screen, `signal`): the screen follows study_point_parts.
 *  `open`: the server claimed the parts and reserved the first call, so the
 *  read has started (a refusal, like "busy", never opens). */
export function readPoints(lectureId: string, on: (line: PointsLine) => void, opts?: StreamOpts): Promise<void> {
  return stream<PointsLine>({ action: "points", lectureId }, on, opts);
}

/** The lecture's study_point_parts as a member reads them (RLS: the group's):
 *  which parts the read in progress took (pointsRead.ts). */
export async function pointParts(lectureId: string): Promise<PointPartRow[]> {
  const read = (cols: string) => client().from("study_point_parts").select(cols).eq("lecture_id", lectureId);
  // ahead_at is section B's (the read ahead): a database without it answers 42703, and the rows are read without it.
  let { data, error } = await read("part_idx, status, error, attempts, updated_at, ahead_at");
  if (error && error.code === "42703") ({ data, error } = await read("part_idx, status, error, attempts, updated_at"));
  if (error) fail(error);
  return ((data ?? []) as unknown as PointPartRow[]).map((r) => ({ ...r, part_idx: Number(r.part_idx), attempts: Number(r.attempts) }));
}

/** An example read back ("ככה השאלות ייכתבו: …"): text, a photo, or both. */
export function readStyle(lectureId: string, example: { text?: string; image?: { mediaType: string; data: string } }): Promise<StyleAnswer> {
  return action<StyleAnswer>({ action: "style", lectureId, ...example });
}

/** "ליצור N שאלות": the request and its batches (nothing written yet). */
export function createRequest(lectureId: string, options: Options): Promise<CreateAnswer> {
  return action<CreateAnswer>({ action: "create", lectureId, options });
}

/** Writes one batch of a request: its drafts stream as they are saved, then the blind solver's verdicts. */
export function writeBatch(lectureId: string, batchId: string, on: (line: WriteLine) => void): Promise<void> {
  return stream<WriteLine>({ lectureId, batchId }, on);
}

/** "↻ לנסח מחדש" on a pending draft, with the member's words (at most 200 characters). */
export function rewordDraft(lectureId: string, draftId: string, note: string, on: (line: WriteLine) => void = () => undefined): Promise<void> {
  const n = note.trim();
  return stream<WriteLine>({ action: "reword", lectureId, draftId, ...(n ? { note: n } : {}) }, on);
}

/* ─────────────────────────── the drafts ─────────────────────────── */

export type Request = {
  id: string;
  lecture_id: string;
  round: number;
  level: Level;
  count: number;
  parts: number[];
  styles: Style[];
  difficulty: Difficulty;
  focus: string;
  created_by: string | null;
  created_at: string;
};
export type DraftRow = Draft & { lease_until: string | null };
export type RequestBatch = { id: string; request_id: string; part_idx: number; seq: number; heading: string; wanted: number; made: number; status: "pending" | "writing" | "ready" | "failed"; error: string | null; attempts: number; updated_at: string };
export type PartProgress = { part_idx: number; title: string; points: number; covered: number; wanted: number; made: number; kept: number; pending: number; checking: number; failed: number; open: boolean };

const REQUEST_COLUMNS = "id, lecture_id, round, level, count, parts, styles, difficulty, focus, created_by, created_at";
const QDRAFT_COLUMNS =
  "id, request_id, batch_id, lecture_id, part_idx, style, points, kind, difficulty, vignette, question, options, slides, topic, aspect, anchor, teaser, figure, option_tags, status, check_state, rewrites, replaces, question_id, lease_until, created_at, updated_at";
const RBATCH_COLUMNS = "id, request_id, part_idx, seq, heading, wanted, made, status, error, attempts, updated_at";
/** With the question types (section Q at 3): a draft's form, what it draws and its staged case. */
const QDRAFT_TYPES_COLUMNS = `${QDRAFT_COLUMNS}, form, layout, series, step`;

/** A lecture's requests, newest first. */
export async function listRequests(lectureId: string): Promise<Request[]> {
  const { data, error } = await client().from("study_question_requests").select(REQUEST_COLUMNS).eq("lecture_id", lectureId).order("created_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as unknown as Request[];
}

/** A request's drafts, every status, in part order. */
export async function listDrafts(requestId: string): Promise<DraftRow[]> {
  const columns = flags.qtypes ? QDRAFT_TYPES_COLUMNS : QDRAFT_COLUMNS;
  const { data, error } = await client()
    .from("study_question_drafts")
    .select(columns)
    .eq("request_id", requestId)
    .order("part_idx", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) fail(error);
  return (data ?? []) as unknown as DraftRow[];
}

/** A lecture's pending drafts (the practice page's "הבנק נבנה" card). */
export async function pendingDrafts(lectureId: string): Promise<Array<Pick<DraftRow, "id" | "request_id" | "check_state">>> {
  const { data, error } = await client().from("study_question_drafts").select("id, request_id, check_state").eq("lecture_id", lectureId).eq("status", "pending");
  if (error) fail(error);
  return (data ?? []) as Array<Pick<DraftRow, "id" | "request_id" | "check_state">>;
}

/** A request's batches. */
export async function requestBatches(requestId: string): Promise<RequestBatch[]> {
  const { data, error } = await client().from("study_question_batches").select(RBATCH_COLUMNS).eq("request_id", requestId).order("seq", { ascending: true });
  if (error) fail(error);
  return (data ?? []) as unknown as RequestBatch[];
}

/** "הבנק נבנה": per part of the request, its coverage and its drafts' counts. */
export async function requestProgress(requestId: string): Promise<PartProgress[]> {
  const { data, error } = await client().rpc("study_request_progress", { p_request: requestId });
  if (error) fail(error);
  return ((data ?? []) as PartProgress[]).map((r) => ({
    ...r,
    points: Number(r.points),
    covered: Number(r.covered),
    wanted: Number(r.wanted),
    made: Number(r.made),
    kept: Number(r.kept),
    pending: Number(r.pending),
    checking: Number(r.checking),
    failed: Number(r.failed),
    open: Boolean(r.open),
  }));
}

/** "✓ להשאיר": the draft enters the group's bank; the new question's id. */
export async function keepDraft(draftId: string): Promise<string> {
  const { data, error } = await client().rpc("study_draft_keep", { p_draft: draftId });
  if (error) fail(error);
  return String(data ?? "");
}

/** "להוסיף הכול": every draft the solver passed (or could not check). */
export async function keepAll(requestId: string): Promise<number> {
  const { data, error } = await client().rpc("study_draft_keep_all", { p_request: requestId });
  if (error) fail(error);
  return Array.isArray(data) ? data.length : 0;
}

/** "✕": the draft never enters the bank. */
export async function removeDraft(draftId: string): Promise<void> {
  const { error } = await client().rpc("study_draft_remove", { p_draft: draftId });
  if (error) fail(error);
}

/** סבב חדש: the caller's own counts per lecture, part, style and state. */
export async function sessionCounts(lectureIds: string[]): Promise<SessionCount[]> {
  const { data, error } = await client().rpc("study_session_counts", { p_lectures: lectureIds });
  if (error) fail(error);
  return ((data ?? []) as SessionCount[]).map((r) => ({ ...r, part_idx: Number(r.part_idx), n: Number(r.n), flagged: Boolean(r.flagged) }));
}

/* ─────────────────────────── two flags: the fix sheet ───────────────────────────
 * Two different members' flags of reasons wrong_key, not_in_slides,
 * two_answers or unclear hide a question from everyone's practice
 * (hidden_at). Any member then checks it against the slide: keeps it with
 * the slides that show the key is right, or retires it. */

export type FixView = { answer: number; explanations: string[]; takeaway: string; whens: string[]; flags: Array<{ reason: FlagReason; note: string; at: string }> };

/** The key, explanations and flags of a hidden question (study_question_for_fix). */
export async function questionForFix(id: string): Promise<FixView> {
  const { data, error } = await client().rpc("study_question_for_fix", { p_question: id });
  if (error) fail(error);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { answer: number; explanations: string[] | null; takeaway: string | null; whens: string[] | null; flags: FixView["flags"] | null }
    | undefined;
  if (!row) throw new Error("question not found");
  return { answer: Number(row.answer), explanations: row.explanations ?? [], takeaway: row.takeaway ?? "", whens: row.whens ?? [], flags: row.flags ?? [] };
}

/** "להשאיר" with 1-6 of the lecture's slides that show the key is right, or "להוציא מהתרגול". */
export async function fixQuestion(id: string, verdict: "keep" | "retire", slides: number[], note: string): Promise<void> {
  const { error } = await client().rpc("study_question_fix", { p_question: id, p_verdict: verdict, p_slides: slides, p_note: note.trim().slice(0, 300) });
  if (error) fail(error);
}

let watchSeq = 0;

/** The bank being built, on every phone: the lecture's drafts, batches,
 *  requests and the reading of its points (Realtime; RLS keeps them to the group). */
export function watchBank(lectureId: string, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const on = () => onChange();
  const filter = `lecture_id=eq.${lectureId}`;
  const ch: RealtimeChannel = sb
    .channel(`study-bank-${lectureId}-${++watchSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_question_drafts", filter }, on)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_question_batches", filter }, on)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_question_requests", filter }, on)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_point_parts", filter }, on);
  ch.subscribe();
  return () => void sb?.removeChannel(ch);
}

/* ─────────────────────────── writing a request on this phone ─────────────────────────── */

/** The key of a request's writing in rounds.ts's store. */
export const requestKey = (requestId: string): string => `request:${requestId}`;

export type LocalRequest = {
  /** Batches this phone is writing now. */
  writing: string[];
  /** Batches another phone turned out to hold (409 busy). */
  elsewhere: string[];
  /** The code that ended this phone's writing early (a fatal one), if any. */
  error?: string;
};
const EMPTY: LocalRequest = { writing: [], elsewhere: [] };
const local = new Map<string, LocalRequest>();
const listeners = new Set<() => void>();
const setLocal = (id: string, f: (r: LocalRequest) => LocalRequest) => {
  local.set(id, f(local.get(id) ?? EMPTY));
  listeners.forEach((l) => l());
};

/** This phone's view of a request's writing. */
export function useLocalRequest(requestId: string): LocalRequest {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => local.get(requestId) ?? EMPTY,
  );
}

const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

/** Writes a request's batches from this phone, outside any screen (rounds.ts):
 *  it goes on when "הבנק נבנה" unmounts, and while the page is hidden it waits. */
export function writeRequest(lectureId: string, requestId: string, batchIds: string[], onLine?: (line: WriteLine) => void): Promise<RoundResult> {
  setLocal(requestId, (r) => ({ ...r, error: undefined, elsewhere: r.elsewhere.filter((id) => !batchIds.includes(id)) }));
  return startRound(requestKey(requestId), batchIds, async (id, onStart) => {
    setLocal(requestId, (r) => ({ ...r, writing: [...r.writing.filter((x) => x !== id), id] }));
    try {
      await writeBatch(lectureId, id, (line) => {
        if (line.t === "start") onStart();
        onLine?.(line);
      });
    } catch (e) {
      if (codeOf(e) === "busy") setLocal(requestId, (r) => ({ ...r, elsewhere: [...new Set([...r.elsewhere, id])] }));
      throw e;
    } finally {
      setLocal(requestId, (r) => ({ ...r, writing: r.writing.filter((x) => x !== id) }));
    }
  }).then((res) => {
    if (res.error) setLocal(requestId, (r) => ({ ...r, error: res.error }));
    return res;
  });
}

const SIX_MINUTES = 6 * 60_000;

/** A batch this phone may write: pending, failed (not given up), or stuck writing. */
export function writable(b: Pick<RequestBatch, "status" | "error" | "attempts" | "updated_at">, now = Date.now()): boolean {
  if (b.status === "pending") return true;
  if (b.status === "failed") return !(b.error === "gave up" || b.attempts >= 3);
  return b.status === "writing" && now - Date.parse(b.updated_at) > SIX_MINUTES;
}

/** Someone is writing the request now (a batch claimed within six minutes). */
export const writingSomewhere = (batches: readonly Pick<RequestBatch, "status" | "updated_at">[], now = Date.now()): boolean =>
  batches.some((b) => b.status === "writing" && now - Date.parse(b.updated_at) <= SIX_MINUTES);

/* ─────────────────────────── the choices between מה ליצור and דוגמה ומיקוד ───────────────────────────
 * Kept on the device for this tab (sessionStorage), so the two screens and a
 * reload share them; every access in try/catch. */

export type Choices = {
  level: Level;
  count: number;
  /** null: every part with points. */
  parts: number[] | null;
  styles: Style[];
  difficulty: Difficulty;
  focus: string;
  /** The pasted example as typed (the read is `style`). */
  exampleText: string;
  style: StyleRead | null;
};

export const DEFAULT_CHOICES: Choices = {
  level: DEFAULT_LEVEL,
  count: 10,
  parts: null,
  styles: [...DEFAULT_STYLES],
  difficulty: DEFAULT_DIFFICULTY,
  focus: "",
  exampleText: "",
  style: null,
};

const choicesKey = (user: string, lectureId: string) => `study-p2:${user}:${lectureId}`;

export function loadChoices(user: string, lectureId: string): Choices {
  try {
    const raw = sessionStorage.getItem(choicesKey(user, lectureId));
    const x = raw ? (JSON.parse(raw) as Partial<Choices>) : null;
    return x && typeof x === "object" ? { ...DEFAULT_CHOICES, ...x } : { ...DEFAULT_CHOICES };
  } catch {
    return { ...DEFAULT_CHOICES };
  }
}

export function saveChoices(user: string, lectureId: string, c: Choices): void {
  try {
    sessionStorage.setItem(choicesKey(user, lectureId), JSON.stringify(c));
  } catch {
    // without storage the choices last while the screen is open
  }
}

export function dropChoices(user: string, lectureId: string): void {
  try {
    sessionStorage.removeItem(choicesKey(user, lectureId));
  } catch {
    // nothing kept
  }
}

/** The options a request sends, from the choices on screen. */
export function optionsOf(c: Choices, o: { withExample?: boolean } = {}): Options {
  return {
    level: c.level,
    ...(c.level === "custom" ? { count: Math.max(1, Math.min(40, Math.round(c.count) || 1)) } : {}),
    ...(c.parts && c.parts.length ? { parts: [...c.parts].sort((a, b) => a - b) } : {}),
    styles: c.styles.length ? c.styles : [...DEFAULT_STYLES],
    difficulty: c.difficulty,
    focus: o.withExample === false ? "" : c.focus.trim(),
    ...(o.withExample !== false && c.style ? { style: c.style } : {}),
  };
}

/** A request this phone just created: הבנק נבנה's back arrow returns past
 *  the two screens that made it (one entry, per request, for this tab). */
const madeKey = (requestId: string) => `study-p2-made:${requestId}`;
export function markMade(requestId: string): void {
  try {
    sessionStorage.setItem(madeKey(requestId), "1");
  } catch {
    /* Back then goes one screen back */
  }
}
export function takeMade(requestId: string): boolean {
  try {
    const made = sessionStorage.getItem(madeKey(requestId)) === "1";
    sessionStorage.removeItem(madeKey(requestId));
    return made;
  } catch {
    return false;
  }
}

/** "$0.60", "$1", "$12.40". */
export function usd(dollars: number): string {
  const cents = Math.round(dollars * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
