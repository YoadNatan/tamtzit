import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Aspect, FlagReason } from "../../../shared/study/aspects";
import { postStudy, readLines, sb } from "./api";

/* ── Practice questions: the data (package Q; spec §5.4, design-questions §4.1) ──
 *
 * The questions are shared inside the group: their text, options, slides,
 * topic, who wrote them, the generation rounds and the flags. The answer key
 * and the explanations are hidden from every client (study_question_keys has
 * no grants); they come back only from study_answer_question, which records
 * the answer, and study_question_feedback, for questions the caller has
 * already answered. Answers are private: study_answers is never read here,
 * only the caller's own results through the security-invoker functions.
 *
 * Every wrapper throws Error(code) with the server's code (spec §4.11), which
 * the screens turn into words with failText(code, "practice"). The live quiz
 * (package Z) imports the types of this file and nothing else (review FE-17). */

export type { Aspect, FlagReason } from "../../../shared/study/aspects";

export type Flag = { id: string; question_id: string; user_id: string; reason: FlagReason; note: string; created_at: string };

/** A question as every member of the group may read it: never its key. */
export type PublicQuestion = {
  id: string;
  group_id: string;
  lecture_id: string | null;
  exam_id: string | null;
  exam_no: number | null;
  ref_lecture: string | null;
  source: "ai" | "exam" | "member"; // member: a member's own trap (section E)
  part_idx: number | null;
  kind: "mcq" | "case";
  difficulty: 1 | 2 | 3;
  vignette: string;
  question: string;
  /** In the stored order; a practice session shows them in a fresh order each time. */
  options: string[];
  slides: number[];
  topic: string;
  aspect: Aspect;
  has_key: boolean;
  created_by: string | null;
  created_at: string;
  retired_at: string | null;
  retired_by: string | null;
  retire_note: string;
  /** Q's end: the paragraph that states it ("לפסקה"), its first words and the part's generation then. */
  anchor: number | null;
  quote: string;
  part_gen: number | null;
  /** Two members' counting flags hid it from everyone's practice until a member fixes it. */
  hidden_at: string | null;
  /** A correction of its part marked it (it waits for "עדיין נכון"). */
  stale_at: string | null;
  /** Practice 2.0: one of the seven styles; null for release 1's questions. */
  style: string | null;
  study_question_flags?: Flag[];
};

/** The key and every option's explanation, in the stored order (study_answer_question),
 *  with "מתי כן" per option ("" for the key and where the lecture gives no case). */
export type Feedback = { answer: number; explanations: string[]; takeaway: string; correct?: boolean; whens?: string[] };
/** The bet before "לבדוק": ניחוש 1 · נראה לי 2 · על בטוח 3. */
export type Bet = 1 | 2 | 3;

export type BatchStatus = "pending" | "writing" | "ready" | "failed";
/** One part of a generation round (study_question_batches). */
export type Batch = {
  id: string;
  lecture_id: string;
  round: number;
  part_idx: number;
  heading: string;
  slide_from: number;
  slide_to: number;
  wanted: number;
  status: BatchStatus;
  made: number;
  rejected: number;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  /** Practice 2.0: the request this batch writes drafts for (null: a release-1 round). */
  request_id: string | null;
};

export type Mode = "lecture" | "course" | "mistakes" | "exam";
export type TopicStat = {
  lecture_id: string | null;
  course: string;
  topic: string;
  aspect: Aspect;
  questions: number;
  answered: number;
  correct_now: number;
  last_at: string | null;
};
/** Per lecture (or past exam): the group's active questions, and the caller's own counts. */
export type Overview = { lecture_id: string | null; exam_id: string | null; questions: number; answered: number; wrong_now: number; last_at: string | null };
/** The caller's latest answer per question (study_my_latest). */
export type Latest = Map<string, { correct: boolean; at: string; times: number }>;
/** The caller's open mistakes (study_my_mistakes): wrong until answered right on a later study day. */
export type Mistake = { question_id: string; wrong_at: string };

/** What a {"t":"q"} line of op "questions" carries: public fields only (§4.6). */
export type StreamedQuestion = Pick<PublicQuestion, "id" | "part_idx" | "kind" | "difficulty" | "vignette" | "question" | "options" | "slides" | "topic" | "aspect">;

const FLAG_COLUMNS = "id, question_id, user_id, reason, note, created_at";
const Q_COLUMNS = `id, group_id, lecture_id, exam_id, exam_no, ref_lecture, source, part_idx, kind, difficulty, vignette, question, options, slides, topic, aspect, has_key, created_by, created_at, retired_at, retired_by, retire_note, anchor, quote, part_gen, hidden_at, stale_at, style, study_question_flags(${FLAG_COLUMNS})`;
const BATCH_COLUMNS = "id, lecture_id, round, part_idx, heading, slide_from, slide_to, wanted, status, made, rejected, error, attempts, created_at, updated_at, created_by, request_id";
/** Ids per request: a URL stays well under PostgREST's limits. */
const CHUNK = 50;

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
/** supabase-js hands refusals over as plain objects: the code is their message. */
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}
function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
/** The questions a session may ask: in practice, keyed, not hidden by two
 *  flags and not marked by a correction (study_session_counts' rule). */
export const isActive = (q: Pick<PublicQuestion, "retired_at" | "has_key"> & Partial<Pick<PublicQuestion, "hidden_at" | "stale_at">>): boolean =>
  q.retired_at === null && q.has_key && !q.hidden_at && !q.stale_at;

/* ─────────────────────────── the questions ─────────────────────────── */

/** A lecture's questions, retired ones included (P2 lists them), in part order. */
export async function listLectureQuestions(lectureId: string): Promise<PublicQuestion[]> {
  const { data, error } = await client()
    .from("study_questions")
    .select(Q_COLUMNS)
    .eq("lecture_id", lectureId)
    .order("part_idx", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) fail(error);
  return (data ?? []) as unknown as PublicQuestion[];
}

export async function listQuestionsByIds(ids: string[]): Promise<PublicQuestion[]> {
  const out: PublicQuestion[] = [];
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await client().from("study_questions").select(Q_COLUMNS).in("id", part);
    if (error) fail(error);
    out.push(...((data ?? []) as unknown as PublicQuestion[]));
  }
  return out;
}

/** The questions of several lectures (a course session). */
export async function listCourseQuestions(lectureIds: string[]): Promise<PublicQuestion[]> {
  const out: PublicQuestion[] = [];
  for (const part of chunks([...new Set(lectureIds)])) {
    const { data, error } = await client().from("study_questions").select(Q_COLUMNS).in("lecture_id", part).order("created_at", { ascending: true });
    if (error) fail(error);
    out.push(...((data ?? []) as unknown as PublicQuestion[]));
  }
  return out;
}

/** Every question of the group (a topic's session, t.<topic>). */
export async function listGroupQuestions(groupId: string): Promise<PublicQuestion[]> {
  const { data, error } = await client().from("study_questions").select(Q_COLUMNS).eq("group_id", groupId).order("created_at", { ascending: true });
  if (error) fail(error);
  return (data ?? []) as unknown as PublicQuestion[];
}

/* ─────────────────────────── generation ─────────────────────────── */

export async function listBatches(lectureId: string): Promise<Batch[]> {
  const { data, error } = await client()
    .from("study_question_batches")
    .select(BATCH_COLUMNS)
    .eq("lecture_id", lectureId)
    .order("round", { ascending: true })
    .order("part_idx", { ascending: true });
  if (error) fail(error);
  return (data ?? []) as unknown as Batch[];
}

/** The lectures of the group with a round being written (P1's "נכתבות שאלות…"). */
export async function openBatches(): Promise<Array<Pick<Batch, "lecture_id" | "status" | "updated_at">>> {
  const { data, error } = await client().from("study_question_batches").select("lecture_id, status, updated_at").in("status", ["pending", "writing"]);
  if (error) fail(error);
  return (data ?? []) as Array<Pick<Batch, "lecture_id" | "status" | "updated_at">>;
}

/** Plans the lecture's next round, or returns the one still open (fresh: false). */
export async function planRound(lectureId: string): Promise<{ round: number; batches: number; fresh: boolean }> {
  const { data, error } = await client().rpc("study_question_round", { p_lecture: lectureId });
  if (error) fail(error);
  const row = (Array.isArray(data) ? data[0] : data) as { round: number; batches: number; fresh: boolean } | undefined;
  if (!row) throw new Error("no slides");
  return { round: Number(row.round), batches: Number(row.batches), fresh: Boolean(row.fresh) };
}

/** Writes one part of a round (op "questions"): the server claims it, writes
 *  its questions and streams each one with its public fields only. 409 is
 *  Error("busy") (another phone holds the part) or Error("gave up"). */
export async function runBatch(
  lectureId: string,
  batchId: string,
  on: { start(): void; question(q: StreamedQuestion): void; skip(why: string): void },
): Promise<{ made: number; rejected: number; costUsd: number }> {
  let done = { made: 0, rejected: 0, costUsd: 0 };
  try {
    const res = await postStudy("/api/study/ai", { op: "questions", lectureId, batchId });
    await readLines(res, (line) => {
      const l = (line ?? {}) as { t?: string; q?: StreamedQuestion; why?: string; made?: number; rejected?: number; costUsd?: number };
      if (l.t === "start") on.start();
      else if (l.t === "q" && l.q && typeof l.q.id === "string") on.question(l.q);
      else if (l.t === "skip") on.skip(String(l.why ?? ""));
      else if (l.t === "done") done = { made: Number(l.made ?? 0), rejected: Number(l.rejected ?? 0), costUsd: Number(l.costUsd ?? 0) };
    });
  } catch (e) {
    // fetch's own failures (a dropped connection, a locked phone) are TypeErrors: "network".
    if (e instanceof TypeError) throw new Error("network");
    throw e;
  }
  return done;
}

/* ─────────────────────────── answering ─────────────────────────── */

/** Records the caller's answer (null: "לא יודעים") with the bet made before
 *  "לבדוק" (null: none), and returns the key with every explanation and
 *  "מתי כן", in the stored order. The bet is stored with the answer and shown
 *  to nobody else. */
export async function answerQuestion(id: string, choice: number | null, mode: Mode, ms: number, bet: Bet | null = null): Promise<Feedback> {
  const { data, error } = await client().rpc("study_answer_question", {
    p_question: id,
    p_choice: choice,
    p_mode: mode,
    p_ms: Math.max(0, Math.min(3_600_000, Math.round(ms))),
    p_confidence: bet,
  });
  if (error) fail(error);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { answer: number; explanations: string[] | null; takeaway: string | null; correct: boolean; whens?: string[] | null }
    | undefined;
  if (!row) throw new Error("question not found");
  return { answer: Number(row.answer), explanations: row.explanations ?? [], takeaway: row.takeaway ?? "", correct: Boolean(row.correct), whens: row.whens ?? [] };
}

/** The key and explanations of questions the caller has already answered. */
export async function feedbackFor(ids: string[]): Promise<Record<string, Feedback>> {
  const out: Record<string, Feedback> = {};
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await client().rpc("study_question_feedback", { p_ids: part });
    if (error) fail(error);
    for (const r of (data ?? []) as Array<{ question_id: string; answer: number; explanations: string[] | null; takeaway: string | null }>)
      out[r.question_id] = { answer: Number(r.answer), explanations: r.explanations ?? [], takeaway: r.takeaway ?? "" };
  }
  return out;
}

/* ─────────────────────────── the caller's own results ─────────────────────────── */

export async function practiceOverview(groupId: string): Promise<Overview[]> {
  const { data, error } = await client().rpc("study_practice_overview", { p_group: groupId });
  if (error) fail(error);
  return ((data ?? []) as Overview[]).map((o) => ({ ...o, questions: Number(o.questions), answered: Number(o.answered), wrong_now: Number(o.wrong_now) }));
}

export async function myMistakes(groupId: string, lectureId?: string): Promise<Mistake[]> {
  const { data, error } = await client().rpc("study_my_mistakes", { p_group: groupId, ...(lectureId ? { p_lecture: lectureId } : {}) });
  if (error) fail(error);
  return (data ?? []) as Mistake[];
}

export async function myLatest(groupId: string): Promise<Latest> {
  const { data, error } = await client().rpc("study_my_latest", { p_group: groupId });
  if (error) fail(error);
  const out: Latest = new Map();
  for (const r of (data ?? []) as Array<{ question_id: string; correct: boolean; answered_at: string; times: number }>)
    out.set(r.question_id, { correct: Boolean(r.correct), at: r.answered_at, times: Number(r.times) });
  return out;
}

/** For progress and weak points (package A2 reads its own copy of the same function). */
export async function myTopicStats(groupId: string): Promise<TopicStat[]> {
  const { data, error } = await client().rpc("study_my_topic_stats", { p_group: groupId });
  if (error) fail(error);
  return (data ?? []) as TopicStat[];
}

/* ─────────────────────────── flags ───────────────────────────
 * A flag tells the group what is wrong with a question; it takes nothing out
 * of anyone's practice. No member retires a question for everyone (package
 * Q's review, finding Q2; SEC-13): study_retire_question is the owner's. */

/** Sends the caller's flag and returns the row as stored, with its real id,
 *  so "מחיקת הסימון" can delete it in the same session (finding Q5). */
export async function flagQuestion(questionId: string, reason: FlagReason, note: string): Promise<Flag> {
  const { data, error } = await client()
    .from("study_question_flags")
    .insert({ question_id: questionId, reason, note: note.trim().slice(0, 500) })
    .select(FLAG_COLUMNS)
    .single();
  if (error) fail(error);
  if (!data) throw new Error("unknown");
  return data as unknown as Flag;
}

export async function deleteFlag(flagId: string): Promise<void> {
  const { error } = await client().from("study_question_flags").delete().eq("id", flagId);
  if (error) fail(error);
}

/* ─────────────────────────── live ─────────────────────────── */

let watchSeq = 0;

/** Questions, rounds and flags as they change on any phone: a lecture's, or
 *  the group's questions (the library's chips), with every round's parts
 *  when `rounds` is asked (P1's "נכתבות שאלות…"). Flags have no lecture
 *  column; Row Level Security keeps their events to the member's group, and
 *  a deleted row carries only its key, so every flag event is passed on.
 *  Never answers or keys (they are not published). */
export function watchPractice(scope: { lectureId: string } | { groupId: string; rounds?: boolean }, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const on = () => onChange();
  const id = "lectureId" in scope ? scope.lectureId : scope.groupId;
  let ch: RealtimeChannel = sb.channel(`study-practice-${id}-${++watchSeq}`);
  if ("lectureId" in scope) {
    ch = ch
      .on("postgres_changes", { event: "*", schema: "public", table: "study_question_batches", filter: `lecture_id=eq.${scope.lectureId}` }, on)
      .on("postgres_changes", { event: "*", schema: "public", table: "study_questions", filter: `lecture_id=eq.${scope.lectureId}` }, on)
      .on("postgres_changes", { event: "*", schema: "public", table: "study_question_flags" }, on);
  } else {
    ch = ch.on("postgres_changes", { event: "*", schema: "public", table: "study_questions", filter: `group_id=eq.${scope.groupId}` }, on);
    if (scope.rounds) ch = ch.on("postgres_changes", { event: "*", schema: "public", table: "study_question_batches" }, on);
  }
  ch.subscribe();
  return () => void sb?.removeChannel(ch);
}
