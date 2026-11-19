import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";
import { blockSources, citedSlides } from "../../shared/study/edits.js";
import { badCites, CONTEXT_LECTURES, contextBlock, selectContext, type CourseContext, type CourseRow } from "./context.js";
import { costUsd, estimateUsd, floorUsage, reserve, type UsageLike } from "./budget.js";
import { cleanSchema, settleFor, streamText, type Ledger } from "./claude.js";
import {
  ASK_EFFORT,
  ASK_LIMITS,
  ASK_LINE_MS,
  ASK_MAX_TOKENS,
  COLLAB_TIME_LIMIT_MS,
  DAILY_ASKS,
  ROUTE_EFFORT,
  ROUTE_MAX_LECTURES,
  ROUTE_MAX_TOKENS,
} from "./limits.js";
import type { Op } from "./ops/types.js";
import {
  ASK_SYSTEM,
  askTurnText,
  askUserText,
  COURSE_ASK_NOTE,
  correctionsBlock,
  recordingNotesBlock,
  ROUTE_SYSTEM,
  summaryBlock,
  threadsBlock,
  type AnsweredThread,
  type Correction,
  type RecordingNote,
} from "./prompts/collab.js";
import {
  anthropic,
  assertSchema,
  HttpError,
  json,
  lectureBlock,
  loadLecture,
  memberClient,
  MODEL,
  schemaOk,
  serverKey,
  textStream,
  tidyMarkdown,
  type Lecture,
} from "./study.js";

/* ── "לשאול": questions about a lecture, answered from its slides (package K) ──
 *
 * op "ask" of /api/study/ai (spec §4.8, design-collab §3.3). A member asks
 * about one lecture (from the reader, optionally about one paragraph) or about
 * the whole library or one course, which is first routed to a lecture. The
 * answer streams from the slides, the group's summary (K1, cached after the
 * deck), the recording's "מההקלטה" notes when the lecture has a ready
 * recording, the group's current corrections and the questions the group
 * already answered, without names (K5); without a ready recording the user
 * turn says so (REC5, §12.3.K).
 *
 * The share path (K2, review SEC-9): {"op":"ask","share":{…,"turn"}} posts
 * the member's question on the paragraph with the answer she got attached as
 * Claude's attempt, only when the turn's signature is this server's (the done
 * line's HMAC); it calls study_ask_to_group with her token and the server
 * key, and calls no model.
 *
 * Nothing about the question is stored on the server: the phone keeps its own
 * conversation and sends at most 3 earlier turns back, each signed by this
 * server (review m10), so the assistant's side is only what the server wrote.
 * The ledger records the cost: every model call is reserved before it
 * (kind "ask", ref "answer", or "route" for routing) and settled after it.
 *
 * The answer is textStream()'s NDJSON (spec §4.8):
 *   {"t":"lecture","id","title","also":[{id,title}]}   library scope, after routing
 *   {"t":"nolecture","ok","lectures":[{id,title}]}     library scope, no lecture; the end
 *   {"t":"turn","u"}                                   the exact user text to keep
 *   {"t":"a","d"}                                      answer text, at most every 80 ms
 *   {"t":"done","stop","badTags","model","left","sig","unsettled"}
 * A refusal is settled, then thrown ("\u0000ERROR refusal"): the phone drops
 * the partial text. */

/** Section K of the SQL at the version this code needs (spec §2.11):
 *  study_my_uses_today, study_edits, and K's end (§12.3.K): the comments'
 *  ask_attempt and resolved_at, study_ask_to_group. */
export const ASK_NEEDS: Readonly<Record<string, number>> = { K: 2 };
const schemaPassed = new Set<string>();

/** Once per instance and set of needs, like assertSchema(): a database
 *  without the section K this code reads (a merge that came before its SQL)
 *  answers 503 "schema". The memory aids' op (mnemonic.ts, J's) reads only
 *  section K's first version. */
export async function assertCollabSchema(sb: SupabaseClient, needs: Readonly<Record<string, number>> = ASK_NEEDS): Promise<void> {
  const key = JSON.stringify(needs);
  if (schemaPassed.has(key)) return;
  const { data, error } = await sb.rpc("study_schema");
  if (error) throw new HttpError(500, error.message);
  if (!schemaOk(data, needs)) throw new HttpError(503, "schema");
  schemaPassed.add(key);
}

/** How many of the member's daily calls of a kind are left, after this one
 *  (study_my_uses_today counts the caller's own ledger rows today, Israel
 *  time; the reservation of this call is one of them). null if unknown. */
export async function usesLeft(sb: SupabaseClient, groupId: string, kind: string, ref: string | null, daily: number): Promise<number | null> {
  try {
    const { data, error } = await sb.rpc("study_my_uses_today", { p_group: groupId, p_kind: kind, p_ref: ref });
    if (error || typeof data !== "number") return null;
    return Math.max(0, daily - data);
  } catch {
    return null;
  }
}

// ── The request ──

/** One earlier turn as the phone kept it: the exact user text the server sent
 *  in its "turn" line, the answer, and the done line's signature. */
export type Turn = {
  u: string;
  a: string;
  sig?: string;
  /** A course turn: the lectures its answer cited, by the numbers they had
   *  then (the context line's {n, id}), so a lecture uploaded or re-dated
   *  since does not move its citations (courseHistory). */
  lectures?: Array<{ n: number; id: string }>;
};
export type AskInput = {
  lectureId: string | null;
  course: string | null;
  /** scope "course" (sources.md B6.9): the course's id; every other field
   *  of the scope is null then. */
  courseId: string | null;
  question: string;
  focus: { part: number; anchor: number } | null;
  history: Turn[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const chars = (s: string) => [...s].length;

/** The question and the history's limits (400 with the code, else null). */
export function checkAskInput(question: unknown, history: unknown): string | null {
  if (typeof question !== "string" || !question.trim()) return "question required";
  if (chars(question) > ASK_LIMITS.question) return "too long";
  if (!Array.isArray(history) || history.length > ASK_LIMITS.turns) return "bad history";
  for (const t of history as unknown[]) {
    if (!t || typeof t !== "object") return "bad history";
    const { u, a, sig } = t as Record<string, unknown>;
    if (typeof u !== "string" || typeof a !== "string" || !u || !a) return "bad history";
    if (sig !== undefined && sig !== null && typeof sig !== "string") return "bad history";
    if (chars(u) > ASK_LIMITS.turnU || chars(a) > ASK_LIMITS.turnA) return "too long";
    const { lectures } = t as Record<string, unknown>;
    if (lectures !== undefined && lectures !== null) {
      if (!Array.isArray(lectures) || lectures.length > CONTEXT_LECTURES) return "bad history";
      for (const l of lectures as unknown[]) {
        const { n, id } = (l ?? {}) as Record<string, unknown>;
        if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 999 || typeof id !== "string" || !UUID.test(id)) return "bad history";
      }
    }
  }
  return null;
}

/** The body of op "ask", checked: 400 "question required" / "too long" /
 *  "bad history" / "bad scope" (a focus needs a lecture; scope "course"
 *  needs a course id and nothing else). */
export function readAskInput(body: Record<string, unknown>): AskInput {
  const history = body.history ?? [];
  const bad = checkAskInput(body.question, history);
  if (bad) throw new HttpError(400, bad);
  if (body.scope !== undefined && body.scope !== null && body.scope !== "course") throw new HttpError(400, "bad scope");
  if (body.scope === "course") {
    const id = body.courseId;
    const other = [body.lectureId, body.course, body.focus].some((x) => x !== undefined && x !== null);
    if (typeof id !== "string" || !UUID.test(id) || other) throw new HttpError(400, "bad scope");
    return {
      lectureId: null,
      course: null,
      courseId: id.toLowerCase(),
      question: body.question as string,
      focus: null,
      history: (history as Turn[]).map((t) => ({
        u: t.u,
        a: t.a,
        sig: typeof t.sig === "string" ? t.sig : undefined,
        ...(Array.isArray(t.lectures) ? { lectures: t.lectures.map((l) => ({ n: l.n, id: l.id.toLowerCase() })) } : {}),
      })),
    };
  }
  const lectureId = body.lectureId ?? null;
  if (lectureId !== null && (typeof lectureId !== "string" || !UUID.test(lectureId))) throw new HttpError(400, "bad scope");
  const course = body.course ?? null;
  if (course !== null && (typeof course !== "string" || chars(course) > 120)) throw new HttpError(400, "bad scope");
  let focus: AskInput["focus"] = null;
  if (body.focus !== undefined && body.focus !== null) {
    const f = body.focus as Record<string, unknown>;
    const ok =
      typeof f === "object" && Number.isInteger(f.part) && Number.isInteger(f.anchor) && (f.part as number) >= 0 && (f.anchor as number) >= 0 && (f.anchor as number) <= 9999;
    if (!ok || lectureId === null) throw new HttpError(400, "bad scope");
    focus = { part: f.part as number, anchor: f.anchor as number };
  }
  return {
    lectureId: lectureId === null ? null : (lectureId as string).toLowerCase(),
    course: course ? (course as string) : null,
    courseId: null,
    question: body.question as string,
    focus,
    history: (history as Turn[]).map((t) => ({ u: t.u, a: t.a, sig: typeof t.sig === "string" ? t.sig : undefined })),
  };
}

// ── The history's signatures (review m10) ──

const enc = new TextEncoder();
const hmacKey = (key: string, use: "sign" | "verify") =>
  crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, [use]);
const turnBytes = (lectureId: string, u: string, a: string) => enc.encode(`${lectureId}\n${u}\n${a}`);

/** HMAC-SHA256(STUDY_WORKER_KEY, lectureId + "\n" + u + "\n" + a), hex: the
 *  done line's "sig", which the phone sends back with the turn. */
export async function signTurn(key: string, lectureId: string, u: string, a: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(key, "sign"), turnBytes(lectureId, u, a));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether a turn was written by this server for this lecture (constant time). */
export async function verifyTurn(key: string, lectureId: string, t: Turn): Promise<boolean> {
  if (!t.sig || !/^[0-9a-f]{64}$/i.test(t.sig)) return false;
  const mac = new Uint8Array(32);
  for (let i = 0; i < 32; i++) mac[i] = parseInt(t.sig.slice(2 * i, 2 * i + 2), 16);
  return crypto.subtle.verify("HMAC", await hmacKey(key, "verify"), mac, turnBytes(lectureId, t.u, t.a));
}

/** The history the model sees: only the turns this server signed for this
 *  lecture; any other is dropped. */
export async function verifiedHistory(key: string, lectureId: string, history: Turn[]): Promise<Turn[]> {
  const ok = await Promise.all(history.map((t) => verifyTurn(key, lectureId, t)));
  return history.filter((_, i) => ok[i]);
}

// ── What the model reads ──

/** The system blocks: the frozen prompt, the deck (breakpoint 1, the same
 *  bytes as every other feature's), the group's summary (breakpoint 2, K1:
 *  it changes only when a part does), then the uncached blocks that change:
 *  the recording's notes, the group's corrections and the questions the
 *  group already answered (K5). */
export function askSystem(
  lecture: Pick<Lecture, "lecturer" | "slides">,
  corrections: Correction[],
  notes: string | null = null,
  summary: string | null = null,
  threads: string | null = null,
): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: "text", text: ASK_SYSTEM },
    { type: "text", text: lectureBlock(lecture), cache_control: { type: "ephemeral" } },
    ...(summary ? [{ type: "text" as const, text: summary, cache_control: { type: "ephemeral" as const } }] : []),
    ...(notes ? [{ type: "text" as const, text: notes }] : []),
    ...(corrections.length ? [{ type: "text" as const, text: correctionsBlock(corrections) }] : []),
    ...(threads ? [{ type: "text" as const, text: threads }] : []),
  ];
}

/** The conversation: earlier turns as they were (text only, byte for byte),
 *  then the new user text. */
export function askMessages(history: Turn[], userText: string): Anthropic.Beta.BetaMessageParam[] {
  return [
    ...history.flatMap((t): Anthropic.Beta.BetaMessageParam[] => [
      { role: "user", content: t.u },
      { role: "assistant", content: t.a },
    ]),
    { role: "user", content: userText },
  ];
}

export type EditRow = {
  part_idx: number;
  anchor: number;
  gen: number;
  rev: number;
  before_text: string;
  after_text: string;
  note: string | null;
  created_at: string;
};

/** The lecture's current corrections: edits of each part's current
 *  generation, netted per paragraph (the text before the first, after the
 *  last, the notes joined), a paragraph put back as it was dropped; the 20
 *  most recent, in the summary's order. */
export function currentCorrections(edits: EditRow[], sections: Array<{ idx: number; gen: number }>): Correction[] {
  const gen = new Map(sections.map((s) => [s.idx, s.gen]));
  const byBlock = new Map<string, EditRow[]>();
  for (const e of edits) {
    if (gen.get(e.part_idx) !== e.gen) continue;
    const k = `${e.part_idx}:${e.anchor}`;
    const list = byBlock.get(k);
    if (list) list.push(e);
    else byBlock.set(k, [e]);
  }
  const net = [...byBlock.values()].map((rows) => {
    rows.sort((a, b) => a.rev - b.rev);
    const last = rows[rows.length - 1];
    return {
      part: last.part_idx,
      anchor: last.anchor,
      at: Date.parse(last.created_at) || 0,
      rev: last.rev,
      before: rows[0].before_text,
      after: last.after_text,
      note: rows
        .map((r) => (r.note ?? "").trim())
        .filter(Boolean)
        .join(" · "),
    };
  });
  return net
    .filter((c) => c.before !== c.after)
    .sort((a, b) => b.at - a.at || b.rev - a.rev)
    .slice(0, 20)
    .sort((a, b) => a.part - b.part || a.anchor - b.anchor)
    .map((c) => ({ before: c.before.slice(0, 1500), after: c.after.slice(0, 1500), note: c.note.slice(0, 300) }));
}

/** Tags in an answer that name slides the lecture does not have. */
export function badTags(answer: string, slides: number[]): number[] {
  const have = new Set(slides);
  return citedSlides(answer).filter((n) => !have.has(n));
}

// ── Routing a library question ──

export const Route = z.object({
  lectures: z.array(z.string()).describe('Labels such as "L3", best first; at most two; empty when no lecture is about the question'),
});
export type IndexedLecture = { id: string; title: string; course: string; lecture_date: string | null; parts: string[] };
export type LectureIndex = { text: string; labels: Map<string, string>; order: IndexedLecture[] };

/** One line per lecture, sorted by date then id, so the text is stable and
 *  caches between questions; labels L1, L2, ... map back to ids here. */
export function lectureIndex(ls: IndexedLecture[]): LectureIndex {
  const order = [...ls].sort((a, b) => (a.lecture_date ?? "").localeCompare(b.lecture_date ?? "") || a.id.localeCompare(b.id));
  const labels = new Map<string, string>();
  const lines = order.map((l, i) => {
    labels.set(`L${i + 1}`, l.id);
    return `L${i + 1} | ${l.title} | ${l.course || "-"} | ${l.lecture_date ?? "-"} | ${l.parts.join("; ").slice(0, 600)}`;
  });
  return { text: "The lectures:\n" + lines.join("\n"), labels, order };
}

export type RouteResult = { ids: string[]; ok: boolean; model: string };

/** Which lectures answer a library question (at most 2, best first). Not
 *  streamed, so a mid-output decline leaves no partial JSON. ok is false for
 *  a refusal or unreadable output (the phone then offers the list rather
 *  than claiming that no lecture fits). The call is settled in `finally`.
 *
 *  It stops at `stopAt` (at least 5 s from now), as every streamed call does
 *  (claude.ts): the request's timeout bounds one attempt, and an abort at the
 *  same moment bounds the client's retries too (it retries a request that
 *  timed out), so a hung call is settled then, as 504 "timeout", instead of
 *  holding its reservation until Vercel ends the function. */
export async function routeQuestion(o: {
  client: Anthropic;
  index: LectureIndex;
  question: string;
  ledger: Ledger;
  stopAt: number;
  signal?: AbortSignal;
}): Promise<RouteResult> {
  let model: string = MODEL;
  let usage: UsageLike | null = null;
  let final = false;
  const timeout = Math.max(5_000, o.stopAt - Date.now());
  let timedOut = false;
  const stop = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    stop.abort();
  }, timeout);
  const onAbort = () => stop.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  if (o.signal?.aborted) stop.abort();
  try {
    const msg = await o.client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: ROUTE_MAX_TOKENS,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: ROUTE_EFFORT,
          format: { type: "json_schema", schema: cleanSchema(zodOutputFormat(Route).schema as Record<string, unknown>) },
        },
        system: [
          { type: "text", text: ROUTE_SYSTEM },
          { type: "text", text: o.index.text, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: `The question:\n${o.question}` }],
      },
      { signal: stop.signal, timeout },
    );
    model = msg.model;
    usage = msg.usage as unknown as UsageLike;
    final = true;
    let ids: string[] = [];
    let ok = false;
    const text = msg.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
    if (msg.stop_reason !== "refusal" && text) {
      try {
        const parsed = Route.safeParse(JSON.parse(text.text));
        if (parsed.success) {
          ok = true;
          ids = parsed.data.lectures.map((l) => o.index.labels.get(l.trim().toUpperCase())).filter((x): x is string => !!x);
        }
      } catch {
        ok = false;
      }
    }
    return { ids: [...new Set(ids)].slice(0, ROUTE_MAX_LECTURES), ok, model };
  } catch (e) {
    if (timedOut) throw new HttpError(504, "timeout");
    throw e;
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
    const settled = final ? usage : floorUsage(usage, 0);
    await o.ledger({ kind: "ask", ref: "route", model, usage: settled, costUsd: costUsd(settled, model), estimated: !final }).catch(() => undefined);
  }
}

// ── The answer ──

export type AnswerResult = { text: string; stop: string | null; model: string; costUsd: number; estimated: boolean; timedOut: boolean };

/** Writes {"t":"a","d"} lines at most every `ms`, not one line per token. */
function lineBatcher(write: (line: string) => void, ms: number) {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pending) write(JSON.stringify({ t: "a", d: pending }) + "\n");
    pending = "";
  };
  return {
    push: (d: string) => {
      pending += d;
      timer ??= setTimeout(flush, ms);
    },
    flush,
  };
}

/** One answer, streamed as {"t":"a"} lines, through claude.ts's run(): the
 *  deck's breakpoint plus top-level automatic caching of the conversation,
 *  effort low, no format. The call is settled in `finally` (also when it
 *  fails); a refusal is returned as stop "refusal", for the caller to throw. */
export async function streamAnswer(o: {
  client: Anthropic;
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  stopAt: number;
  write: (line: string) => void;
  ledger: Ledger;
  signal?: AbortSignal;
}): Promise<AnswerResult> {
  const lines = lineBatcher(o.write, ASK_LINE_MS);
  try {
    return await streamText({
      client: o.client,
      kind: "ask",
      ref: "answer",
      system: o.system,
      messages: o.messages,
      effort: ASK_EFFORT,
      maxTokens: ASK_MAX_TOKENS,
      stopAt: o.stopAt,
      cacheTail: true,
      ledger: o.ledger,
      signal: o.signal,
      write: lines.push,
    });
  } finally {
    lines.flush();
  }
}

// ── Reading the lecture's context ──

type SectionRow = { idx: number; title: string; gen: number; markdown: string | null; status: string };
/** PostgREST's answer for a table that does not exist: section W's recording
 *  tables before its SQL is loaded (newer and older PostgREST). */
const NO_TABLE = new Set(["PGRST205", "42P01"]);

/** Whether the lecture has a ready recording (section W), and its notes by
 *  part: none when W is not loaded or the recording is not ready (REC5). */
async function recordingNotes(sb: SupabaseClient, lectureId: string, sections: SectionRow[]): Promise<{ ready: boolean; notes: string | null }> {
  const rec = await sb.from("study_recordings").select("status").eq("lecture_id", lectureId).maybeSingle();
  if (rec.error) {
    if (NO_TABLE.has(rec.error.code)) return { ready: false, notes: null };
    throw new HttpError(500, rec.error.message);
  }
  if ((rec.data as { status?: string } | null)?.status !== "ready") return { ready: false, notes: null };
  const notes = await sb
    .from("study_recording_notes")
    .select("part_idx, items")
    .eq("lecture_id", lectureId)
    .eq("status", "ready")
    .order("part_idx");
  if (notes.error) throw new HttpError(500, notes.error.message);
  const title = new Map(sections.map((s) => [s.idx, s.title]));
  const parts = ((notes.data ?? []) as Array<{ part_idx: number; items: unknown }>).map((n) => ({
    heading: title.get(n.part_idx) ?? `${n.part_idx + 1}`,
    notes: (Array.isArray(n.items) ? n.items : [])
      .filter((x): x is { at_s?: unknown; text?: unknown } => !!x && typeof x === "object")
      .filter((x) => typeof x.text === "string" && x.text.trim() !== "")
      .map((x): RecordingNote => ({ at_s: typeof x.at_s === "number" && x.at_s >= 0 ? x.at_s : null, text: (x.text as string).trim() })),
  }));
  return { ready: true, notes: parts.some((p) => p.notes.length) ? recordingNotesBlock(parts) : null };
}

/** K5: the lecture's answered question threads, newest first (who marked
 *  them answered, then when they were asked), each with the members'
 *  replies in order; Claude's attempts (ask_attempt) are not members' words
 *  and stay out. No names are read. */
async function answeredThreads(sb: SupabaseClient, lectureId: string): Promise<AnsweredThread[]> {
  const qs = await sb
    .from("study_comments")
    .select("id, body")
    .eq("lecture_id", lectureId)
    .eq("kind", "question")
    .eq("resolved", true)
    .is("parent_id", null)
    .order("resolved_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (qs.error) throw new HttpError(500, qs.error.message);
  const questions = (qs.data ?? []) as Array<{ id: string; body: string }>;
  if (!questions.length) return [];
  const rs = await sb
    .from("study_comments")
    .select("parent_id, body")
    .in(
      "parent_id",
      questions.map((q) => q.id),
    )
    .eq("ask_attempt", false)
    .order("created_at");
  if (rs.error) throw new HttpError(500, rs.error.message);
  const replies = (rs.data ?? []) as Array<{ parent_id: string; body: string }>;
  return questions.map((q) => ({ q: q.body, a: replies.filter((r) => r.parent_id === q.id).map((r) => r.body) }));
}

/** Everything an answer about this lecture reads besides the deck: the
 *  group's summary, the current corrections, the recording's notes (and
 *  whether it has a ready recording), the answered threads and the focus
 *  paragraph. */
async function answerContext(
  sb: SupabaseClient,
  lecture: Lecture,
  focus: AskInput["focus"],
): Promise<{
  summary: string | null;
  corrections: Correction[];
  notes: string | null;
  recording: boolean;
  threads: string | null;
  focus: { heading: string; text: string } | null;
}> {
  const [sections, edits] = await Promise.all([
    sb.from("study_sections").select("idx, title, gen, markdown, status").eq("lecture_id", lecture.id).order("idx"),
    sb
      .from("study_edits")
      .select("part_idx, anchor, gen, rev, before_text, after_text, note, created_at")
      .eq("lecture_id", lecture.id)
      .order("created_at"),
  ]);
  if (sections.error) throw new HttpError(500, sections.error.message);
  if (edits.error) throw new HttpError(500, edits.error.message);
  const parts = (sections.data ?? []) as SectionRow[];
  const corrections = currentCorrections((edits.data ?? []) as EditRow[], parts);
  const summary = summaryBlock(parts.filter((p) => p.status === "ready").map((p) => tidyMarkdown(p.markdown ?? "")));
  const [rec, threads] = await Promise.all([recordingNotes(sb, lecture.id, parts), answeredThreads(sb, lecture.id)]);
  let paragraph: { heading: string; text: string } | null = null;
  if (focus) {
    const part = await sb.from("study_sections").select("title, markdown").eq("lecture_id", lecture.id).eq("idx", focus.part).maybeSingle();
    if (part.error) throw new HttpError(500, part.error.message);
    const row = part.data as { title: string; markdown: string } | null;
    const block = row ? blockSources(tidyMarkdown(row.markdown ?? ""))[focus.anchor] : undefined;
    if (!row || !block?.text) throw new HttpError(400, "bad scope");
    paragraph = { heading: row.title, text: block.text };
  }
  return { summary, corrections, notes: rec.notes, recording: rec.ready, threads: threadsBlock(threads), focus: paragraph };
}

/** One prepared answer call: what the model reads, and its worst case. */
type AnswerCall = { system: Anthropic.Beta.BetaTextBlockParam[]; messages: Anthropic.Beta.BetaMessageParam[]; userText: string; estimate: number };

async function prepareAnswer(sb: SupabaseClient, key: string, lecture: Lecture, input: AskInput): Promise<AnswerCall> {
  const [ctx, history] = await Promise.all([answerContext(sb, lecture, input.focus), verifiedHistory(key, lecture.id, input.history)]);
  const userText = askTurnText(input.question, ctx.focus, ctx.recording);
  const system = askSystem(lecture, ctx.corrections, ctx.notes, ctx.summary, ctx.threads);
  const messages = askMessages(history, userText);
  const inputChars =
    system.reduce((n, b) => n + b.text.length, 0) + history.reduce((n, t) => n + t.u.length + t.a.length, 0) + userText.length;
  return { system, messages, userText, estimate: estimateUsd(MODEL, inputChars, ASK_MAX_TOKENS) };
}

/** Streams one prepared answer: the "turn" line, the answer, the done line
 *  with this turn's signature. A refusal is thrown after the settle. */
async function answer(o: {
  client: Anthropic;
  sb: SupabaseClient;
  key: string;
  lecture: Lecture;
  call: AnswerCall;
  reservation: number;
  stopAt: number;
  signal?: AbortSignal;
  write: (line: string) => void;
  unsettled: { n: number };
}): Promise<void> {
  o.write(JSON.stringify({ t: "turn", u: o.call.userText }) + "\n");
  const res = await streamAnswer({
    client: o.client,
    system: o.call.system,
    messages: o.call.messages,
    stopAt: o.stopAt,
    write: o.write,
    signal: o.signal,
    ledger: settleFor(o.sb, o.reservation, () => {
      o.unsettled.n += 1;
    }),
  });
  if (res.stop === "refusal") throw new HttpError(502, "refusal"); // the phone drops the partial answer
  const [left, sig] = await Promise.all([
    usesLeft(o.sb, o.lecture.group_id, "ask", "answer", DAILY_ASKS),
    signTurn(o.key, o.lecture.id, o.call.userText, res.text),
  ]);
  o.write(
    JSON.stringify({
      t: "done",
      stop: res.stop,
      badTags: badTags(res.text, o.lecture.slides.map((s) => s.n)),
      model: res.model,
      left,
      sig,
      unsettled: o.unsettled.n,
    }) + "\n",
  );
}

// ── The share path: "עדיין לא ברור? לשאול את הקבוצה" (K2, review SEC-9) ──

export type ShareInput = { lectureId: string; part: number; anchor: number; quote: string; question: string; turn: Turn };

/** The share path's body, checked: 400 "bad turn" (the app sends only the
 *  turn it kept, so a body without one is a turn it cannot share), or "too long". */
export function readShare(v: unknown): ShareInput {
  if (!v || typeof v !== "object") throw new HttpError(400, "bad turn");
  const o = v as Record<string, unknown>;
  const int = (x: unknown, max: number) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max;
  const t = o.turn as Record<string, unknown> | null | undefined;
  if (
    typeof o.lectureId !== "string" ||
    !UUID.test(o.lectureId) ||
    !int(o.part, 999) ||
    !int(o.anchor, 9999) ||
    typeof o.question !== "string" ||
    !o.question.trim() ||
    (o.quote !== undefined && typeof o.quote !== "string") ||
    !t ||
    typeof t !== "object" ||
    typeof t.u !== "string" ||
    typeof t.a !== "string" ||
    typeof t.sig !== "string" ||
    !t.u ||
    !t.a
  )
    throw new HttpError(400, "bad turn");
  if (chars(o.question) > 2000 || chars(t.u) > ASK_LIMITS.turnU || chars(t.a) > ASK_LIMITS.turnA) throw new HttpError(400, "too long");
  return {
    lectureId: o.lectureId.toLowerCase(),
    part: o.part as number,
    anchor: o.anchor as number,
    quote: typeof o.quote === "string" ? o.quote.slice(0, 200) : "",
    question: o.question.trim(),
    turn: { u: t.u, a: t.a, sig: t.sig },
  };
}

/** The errors of study_ask_to_group, as HTTP statuses. */
const SHARE_STATUS: Record<string, number> = { "not signed in": 401, forbidden: 403, "lecture not found": 404 };

/** POST /api/study/ai { op: "ask", share: { lectureId, part, anchor, quote, question, turn: { u, a, sig } } }
 *  The turn must be one this server signed for this lecture, and its user
 *  text must hold the question: else 400 "bad turn", and no call at all. Then
 *  study_ask_to_group with the member's token and the server key: her
 *  question on the paragraph, the answer attached as Claude's attempt. No
 *  model call, no reservation. Answers { id } (the question's comment). */
export async function shareOp(req: Request, raw: unknown): Promise<Response> {
  const share = readShare(raw);
  const key = serverKey();
  if (!share.turn.u.includes(share.question) || !(await verifyTurn(key, share.lectureId, share.turn))) throw new HttpError(400, "bad turn");
  const { sb } = await memberClient(req);
  await assertCollabSchema(sb);
  const { data, error } = await sb.rpc("study_ask_to_group", {
    p_lecture: share.lectureId,
    p_part: share.part,
    p_anchor: share.anchor,
    p_quote: share.quote,
    p_question: share.question,
    p_attempt: share.turn.a,
    p_key: key,
  });
  if (error) throw new HttpError(SHARE_STATUS[error.message] ?? 400, error.message);
  return json(200, { id: data });
}

// ── "לשאול על כל הקורס" (sources.md B6.9) ──
//
// scope "course": no routing call. selectContext() picks at most 12
// paragraphs from at most 4 of the course's lectures ($0), and one answer
// reads them after ASK_SYSTEM and COURSE_ASK_NOTE, citing [הרצאה 7 · ש׳ 14].
// One reservation, kind "ask" ref "answer", as a lecture's answer. Its
// stream starts with the cut the phone shows ("נבחרו 12 מתוך 340 פסקאות"):
//   {"t":"context","chosen","total","lectures":[{n,id,title}],"paragraphs":[{lecture,part,anchor,slides}]}
// then "turn", "a" and "done" as for a lecture ("badCites" for tags that
// name a lecture or slide the paragraphs do not have; "badTags" stays []).
// The history's turns are signed for "course:<id>".

/** What a course-scope turn is signed for (never a lecture's id). */
export const courseSigScope = (courseId: string) => `course:${courseId}`;

/** The system blocks of a course question: the frozen prompt, the course
 *  note, then the chosen paragraphs (they change with every question). */
export function courseAskSystem(courseName: string, ctx: CourseContext): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: "text", text: ASK_SYSTEM },
    { type: "text", text: COURSE_ASK_NOTE },
    { type: "text", text: contextBlock(courseName, ctx) },
  ];
}

/** The history as the model reads it: each earlier answer's [הרצאה n · …]
 *  renumbered to the lecture's place in the course now (its {n, id} from
 *  the turn), so a lecture uploaded or re-dated during the conversation
 *  does not make an old number point at another lecture. A lecture no
 *  longer in the course loses its number ([ש׳ 14] is left). The text is
 *  changed only after its signature is checked. */
export function courseHistory(history: Turn[], all: Array<{ n: number; id: string }>): Turn[] {
  const now = new Map(all.map((l) => [l.id, l.n]));
  return history.map((t) => {
    if (!t.lectures?.length) return t;
    const then = new Map(t.lectures.map((l) => [l.n, l.id]));
    const a = t.a.replace(/\[הרצאה\s*(\d{1,3})\s*·\s*/g, (all0, n: string) => {
      const id = then.get(Number(n));
      if (!id) return all0;
      const m = now.get(id);
      return m === undefined ? "[" : `[הרצאה ${m} · `;
    });
    return { ...t, a };
  });
}

/** The context line: what was chosen, and where each paragraph is. */
export function contextLine(ctx: CourseContext): string {
  return (
    JSON.stringify({
      t: "context",
      chosen: ctx.chosen,
      total: ctx.total,
      lectures: ctx.lectures.map((l) => ({ n: l.n, id: l.id, title: l.title })),
      paragraphs: ctx.paragraphs.map((p) => ({ lecture: p.lecture, part: p.part, anchor: p.anchor, slides: p.slides })),
    }) + "\n"
  );
}

/** The course, read with the member's client (RLS: her group's), not deleted. */
async function loadCourse(sb: SupabaseClient, id: string): Promise<CourseRow> {
  const { data, error } = await sb.from("study_courses").select("id, group_id, name, name_key").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "course not found");
  return data as CourseRow;
}

/** op "ask" with scope "course": 404 "course not found" / "no lectures",
 *  409 "no summaries" (no ready part yet), 403 "off" (the switch `courses`),
 *  503 "schema" without section S. */
async function courseAsk(o: {
  req: Request;
  sb: SupabaseClient;
  key: string;
  input: AskInput & { courseId: string };
  started: number;
  safe: (write: (s: string) => void) => (line: string) => void;
}): Promise<Response> {
  const { sb, key, input } = o;
  await assertSchema(sb, "ask_course");
  const course = await loadCourse(sb, input.courseId);
  const on = await sb.rpc("study_feature_on", { p_name: "courses" });
  if (on.error) throw new HttpError(500, on.error.message);
  if (on.data === false) throw new HttpError(403, "off");
  const scope = courseSigScope(course.id);
  const history = await verifiedHistory(key, scope, input.history);
  // A follow-up ("ולמה?") is chosen for together with the turns before it.
  const query = [...history.map((t) => t.u), input.question].join("\n");
  const ctx = await selectContext(sb, course, query);
  if (!ctx.all.length) throw new HttpError(404, "no lectures");
  if (!ctx.total) throw new HttpError(409, "no summaries");
  // No paragraph of the course matches the question at all: refused before
  // anything is reserved, rather than a paid answer that says so.
  if (!ctx.chosen) throw new HttpError(409, "no match");
  const userText = askUserText(input.question, null);
  const system = courseAskSystem(course.name, ctx);
  const messages = askMessages(courseHistory(history, ctx.all), userText);
  const inputChars =
    system.reduce((n, b) => n + b.text.length, 0) + history.reduce((n, t) => n + t.u.length + t.a.length, 0) + userText.length;
  const reservation = await reserve(sb, {
    groupId: course.group_id,
    lectureId: null,
    kind: "ask",
    ref: "answer",
    estimateUsd: estimateUsd(MODEL, inputChars, ASK_MAX_TOKENS),
  });
  const client = anthropic();
  const unsettled = { n: 0 };
  return textStream(async (raw) => {
    const write = o.safe(raw);
    write(contextLine(ctx));
    write(JSON.stringify({ t: "turn", u: userText }) + "\n");
    const res = await streamAnswer({
      client,
      system,
      messages,
      stopAt: o.started + COLLAB_TIME_LIMIT_MS,
      write,
      signal: o.req.signal,
      ledger: settleFor(sb, reservation, () => {
        unsettled.n += 1;
      }),
    });
    if (res.stop === "refusal") throw new HttpError(502, "refusal");
    const [left, sig] = await Promise.all([usesLeft(sb, course.group_id, "ask", "answer", DAILY_ASKS), signTurn(key, scope, userText, res.text)]);
    write(
      JSON.stringify({ t: "done", stop: res.stop, badTags: [], badCites: badCites(res.text, ctx), model: res.model, left, sig, unsettled: unsettled.n }) + "\n",
    );
  });
}

// ── The op ──

type ScopeLecture = { id: string; title: string; course: string; lecture_date: string | null; outline: unknown };

/** The caller's group (a member has one; the first she joined otherwise). */
async function callerGroup(sb: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await sb.from("study_members").select("group_id").eq("user_id", userId).order("joined_at").limit(1);
  if (error) throw new HttpError(500, error.message);
  return ((data ?? []) as Array<{ group_id: string }>)[0]?.group_id ?? null;
}

/** The lectures of a library question: the group's (one course's, when
 *  given), hidden ones left out. */
async function lecturesInScope(sb: SupabaseClient, groupId: string, course: string | null): Promise<ScopeLecture[]> {
  let q = sb.from("study_lectures").select("id, title, course, lecture_date, outline").eq("group_id", groupId).is("deleted_at", null);
  if (course) q = q.eq("course", course);
  const { data, error } = await q.order("lecture_date").order("id");
  if (error) throw new HttpError(500, error.message);
  return (data ?? []) as ScopeLecture[];
}

const partHeadings = (outline: unknown): string[] =>
  Array.isArray(outline)
    ? outline
        .map((p) => (p && typeof p === "object" ? (p as { heading?: unknown }).heading : null))
        .filter((h): h is string => typeof h === "string" && h.trim() !== "")
    : [];

/** POST /api/study/ai { op: "ask", lectureId | null, course, question, focus, history }
 *  (or { op: "ask", scope: "course", courseId, question, history }: the
 *  course above; or { op: "ask", share }: the share path above). */
export const askOp: Op = async (req, body, started) => {
  if (body.share !== undefined) return shareOp(req, body.share);
  const input = readAskInput(body);
  const { sb, userId } = await memberClient(req);
  await assertCollabSchema(sb);
  const key = serverKey();
  // A phone that closed the stream stops reading; the call is still settled.
  const safe = (write: (s: string) => void) => (line: string) => {
    try {
      write(line);
    } catch {
      /* the stream is gone */
    }
  };
  if (input.courseId) return courseAsk({ req, sb, key, input: input as AskInput & { courseId: string }, started, safe });
  const client = anthropic();
  const stopAt = started + COLLAB_TIME_LIMIT_MS;
  const signal = req.signal;
  const unsettled = { n: 0 };

  if (input.lectureId) {
    const lecture = await loadLecture(sb, input.lectureId);
    const call = await prepareAnswer(sb, key, lecture, input);
    const reservation = await reserve(sb, { groupId: lecture.group_id, lectureId: lecture.id, kind: "ask", ref: "answer", estimateUsd: call.estimate });
    return textStream((write) => answer({ client, sb, key, lecture, call, reservation, stopAt, signal, write: safe(write), unsettled }));
  }

  // Library scope: the group's lectures (or one course's), then a route.
  const groupId = await callerGroup(sb, userId);
  const scope = groupId ? await lecturesInScope(sb, groupId, input.course) : [];
  if (!scope.length || !groupId) throw new HttpError(404, "no lectures");
  const question = input.question.trim();
  const listed = (ls: Array<{ id: string; title: string }>) => ls.map((l) => ({ id: l.id, title: l.title }));

  if (scope.length === 1) {
    const lecture = await loadLecture(sb, scope[0].id);
    const call = await prepareAnswer(sb, key, lecture, input);
    const reservation = await reserve(sb, { groupId, lectureId: lecture.id, kind: "ask", ref: "answer", estimateUsd: call.estimate });
    return textStream(async (raw) => {
      const write = safe(raw);
      write(JSON.stringify({ t: "lecture", id: lecture.id, title: lecture.title, also: [] }) + "\n");
      await answer({ client, sb, key, lecture, call, reservation, stopAt, signal, write, unsettled });
    });
  }

  const index = lectureIndex(scope.map((l) => ({ id: l.id, title: l.title, course: l.course, lecture_date: l.lecture_date, parts: partHeadings(l.outline) })));
  const routeReservation = await reserve(sb, {
    groupId,
    lectureId: null,
    kind: "ask",
    ref: "route",
    estimateUsd: estimateUsd(MODEL, ROUTE_SYSTEM.length + index.text.length + question.length + 20, ROUTE_MAX_TOKENS),
  });
  return textStream(async (raw) => {
    const write = safe(raw);
    const routed = await routeQuestion({
      client,
      index,
      question,
      stopAt,
      signal,
      ledger: settleFor(sb, routeReservation, () => {
        unsettled.n += 1;
      }),
    });
    if (!routed.ok || !routed.ids.length) {
      write(JSON.stringify({ t: "nolecture", ok: routed.ok, lectures: listed(index.order) }) + "\n");
      return; // no answer, no answer charge
    }
    const lecture = await loadLecture(sb, routed.ids[0]);
    const also = routed.ids.slice(1).map((id) => index.order.find((l) => l.id === id)!);
    write(JSON.stringify({ t: "lecture", id: lecture.id, title: lecture.title, also: listed(also) }) + "\n");
    const call = await prepareAnswer(sb, key, lecture, input);
    const reservation = await reserve(sb, { groupId, lectureId: lecture.id, kind: "ask", ref: "answer", estimateUsd: call.estimate });
    await answer({ client, sb, key, lecture, call, reservation, stopAt, signal, write, unsettled });
  });
};
