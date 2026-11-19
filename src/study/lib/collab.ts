import type { RealtimeChannel } from "@supabase/supabase-js";
import { tidy } from "../../../shared/study/blocks";
import { blockSources, citedSlides } from "../../../shared/study/edits";
import type { Spot } from "../features/types";
import { addComment, postStudy, readLines, sb, type Comment, type Section } from "./api";
import { clip } from "./clip";

/* ── Corrections and "לשאול": the data (package K; spec §5.4, §12.3.K) ──
 *
 * Supabase and /api/study/ai calls for K's screens, kept out of the long
 * api.ts. Nothing here is imported statically by the entry chunk: the slot
 * module (features/collab.tsx) loads it with import() when a flag is on, and
 * the sheet, the ask screen and "יחד"'s card import it inside their own lazy
 * chunks. Every wrapper throws Error(code) with the database's or the op's
 * code (§4.11); the screens turn codes into words with failText().
 *
 * A correction is a proposal with a source (decision 5): study_propose_edit,
 * then another member's study_approve_edit (or the reader's, aloud, in a live
 * reading); study_undo_edit puts the paragraph's latest correction back in
 * one tap. Questions to "לשאול" stay on this phone (localStorage, 14 days);
 * the server stores none of them. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}

/* ─────────────────────────── corrections ─────────────────────────── */

export type SourceKind = "slide" | "recording" | "external";
/** One applied correction (an undo is one too, source "undo"). */
export type Edit = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number;
  gen: number;
  rev: number;
  kind: string;
  before_text: string;
  after_text: string;
  note: string;
  undo_of: string | null;
  author_id: string | null;
  approved_by: string | null;
  aloud: boolean;
  proposal_id: string | null;
  source_kind: SourceKind | "undo" | null;
  source_slides: number[];
  source_at: number | null;
  source_note: string;
  created_at: string;
};
const EDIT_COLUMNS =
  "id, lecture_id, part_idx, anchor, gen, rev, kind, before_text, after_text, note, undo_of, author_id, approved_by, aloud, proposal_id, source_kind, source_slides, source_at, source_note, created_at";

/** "הצעת תיקון": one block for one block, with its source, waiting for a second member. */
export type Proposal = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number;
  gen: number;
  base_rev: number;
  occurrence: number;
  kind: string;
  before_text: string;
  after_text: string;
  note: string;
  source_kind: SourceKind;
  source_slides: number[];
  source_at: number | null;
  source_note: string;
  state: "pending" | "applied" | "withdrawn" | "conflict" | "disputed";
  proposed_by: string | null;
  approved_by: string | null;
  aloud: boolean;
  edit_id: string | null;
  created_at: string;
  decided_at: string | null;
  check_ok: boolean | null;
  check_note: string | null;
};
const PROPOSAL_COLUMNS =
  "id, lecture_id, part_idx, anchor, gen, base_rev, occurrence, kind, before_text, after_text, note, source_kind, source_slides, source_at, source_note, state, proposed_by, approved_by, aloud, edit_id, created_at, decided_at, check_ok, check_note";

/** Every correction of a lecture, oldest first (a lecture has a few dozen). */
export async function listEdits(lectureId: string): Promise<Edit[]> {
  const { data, error } = await client().from("study_edits").select(EDIT_COLUMNS).eq("lecture_id", lectureId).order("created_at");
  if (error) fail(error);
  return (data ?? []) as Edit[];
}

/** A lecture's proposals that still matter: waiting, disputed, or stopped by a change. */
export async function listProposals(lectureId: string): Promise<Proposal[]> {
  const { data, error } = await client()
    .from("study_edit_proposals")
    .select(PROPOSAL_COLUMNS)
    .eq("lecture_id", lectureId)
    .in("state", ["pending", "disputed", "conflict"])
    .order("created_at");
  if (error) fail(error);
  return (data ?? []) as Proposal[];
}

/** Live: a new correction or a proposal's change on this lecture. */
export function watchCorrections(lectureId: string, onChange: (table: string) => void): () => void {
  if (!sb) return () => undefined;
  const ch: RealtimeChannel = sb
    .channel(`study-corrections-${lectureId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_edits", filter: `lecture_id=eq.${lectureId}` }, () => onChange("study_edits"))
    .on("postgres_changes", { event: "*", schema: "public", table: "study_edit_proposals", filter: `lecture_id=eq.${lectureId}` }, () =>
      onChange("study_edit_proposals"),
    )
    .subscribe();
  return () => void sb?.removeChannel(ch);
}

export type ProposalInput = {
  lectureId: string;
  part: number;
  anchor: number;
  before: string;
  after: string;
  baseRev: number;
  baseGen: number;
  occurrence: number;
  note: string;
  source: { kind: "slide"; slides: number[] } | { kind: "recording"; at: number } | { kind: "external"; note: string };
};

/** "להציע לקבוצה": the proposal's id. Errors as section K's, and "bad source", "pending exists". */
export async function proposeEdit(p: ProposalInput): Promise<string> {
  const { data, error } = await client().rpc("study_propose_edit", {
    p_lecture: p.lectureId,
    p_part: p.part,
    p_anchor: p.anchor,
    p_before: p.before,
    p_after: p.after,
    p_base_rev: p.baseRev,
    p_base_gen: p.baseGen,
    p_occurrence: p.occurrence,
    p_note: p.note,
    p_source_kind: p.source.kind,
    p_source_slides: p.source.kind === "slide" ? p.source.slides : [],
    p_source_at: p.source.kind === "recording" ? p.source.at : null,
    p_source_note: p.source.kind === "external" ? p.source.note : "",
  });
  if (error) fail(error);
  return String(data);
}

export type Applied = { edit_id?: string; rev?: number; gen?: number; merged?: boolean; conflict?: boolean; reason?: string; proposal_id?: string };

/** "לאשר" (another member), or "אישור בקול" (the reader of a live reading). A
 *  paragraph that changed meanwhile comes back as { conflict: true }. */
export async function approveEdit(proposalId: string, aloud = false): Promise<Applied> {
  const { data, error } = await client().rpc("study_approve_edit", { p_proposal: proposalId, p_aloud: aloud });
  if (error) fail(error);
  return (data ?? {}) as Applied;
}

/** "לבטל את ההצעה" (the proposer). */
export async function withdrawEdit(proposalId: string): Promise<void> {
  const { error } = await client().rpc("study_withdraw_edit", { p_proposal: proposalId });
  if (error) fail(error);
}

/** "ביטול": the paragraph's latest correction, back to its own text, at once. */
export async function undoEdit(editId: string): Promise<Applied> {
  const { data, error } = await client().rpc("study_undo_edit", { p_edit: editId });
  if (error) fail(error);
  return (data ?? {}) as Applied;
}

/** The paragraph's latest correction, the only one "ביטול" is offered on
 *  (review SEC-1; the log's "ביטול" too, §12.4.V): per paragraph of the
 *  part's current generation, the edit with the highest rev, unless it is an
 *  undo itself. Returns those edits' ids. */
/** The cited slide's lines, as quoted under the source: at most 280
 *  characters, cut at a line's last whole word. */
export function quoteLines(s: { title?: string | null; lines?: readonly string[] | null }): string[] {
  const out: string[] = [];
  let left = 280;
  for (const l of [s.title ?? "", ...(s.lines ?? []).filter((x) => x !== s.title)].map((x) => x.trim()).filter(Boolean)) {
    if (left <= 0) break;
    out.push(l.length > left ? clip(l, left) : l);
    left -= l.length + 3; // " · "
  }
  return out;
}

/** An undo: source "undo", or, written by K's first version, only undo_of. */
export const isUndo = (e: Pick<Edit, "source_kind" | "undo_of">): boolean => e.source_kind === "undo" || Boolean(e.undo_of);

export function undoable(edits: ReadonlyArray<Pick<Edit, "id" | "part_idx" | "anchor" | "gen" | "rev" | "source_kind" | "undo_of">>, genOf: (part: number) => number): Set<string> {
  const top = new Map<string, (typeof edits)[number]>();
  for (const e of edits) {
    if (e.gen !== genOf(e.part_idx)) continue;
    const k = `${e.part_idx}:${e.anchor}`;
    const have = top.get(k);
    if (!have || e.rev > have.rev) top.set(k, e);
  }
  return new Set([...top.values()].filter((e) => !isUndo(e)).map((e) => e.id));
}

/** "41:10" (or "1:02:03" from an hour on), as the recording's notes write times. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** "41" (minutes), "41:10" or "1:02:03" → seconds; null when it is not a time
 *  or is past ten hours (the database's limit). */
export function parseMinute(t: string): number | null {
  const parts = t.trim().split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.slice(1).some((x) => x > 59)) return null; // minutes and seconds after the first number
  const secs = n.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n.length === 2 ? n[0] * 60 + n[1] : n[0] * 60;
  return secs <= 36000 ? secs : null;
}

/** A correction in a few words, for a list ("יחד", the library): a table's
 *  changed cell with its row's first cell ("Bumetanide · 1-1.5 h"), else the
 *  new text's first words, without tags or Markdown. */
export function editGist(before: string, after: string): string {
  const plain = (t: string) =>
    t
      .replace(/\[ש['׳][^\]]*\]/g, "")
      .replace(/[*#>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (/^\s{0,3}\|/.test(after)) {
    const rows = (t: string) => t.split("\n").map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.replace(/\*\*/g, "").trim()));
    const a = rows(before);
    const b = rows(after);
    for (let r = 0; r < b.length; r++)
      for (let k = 0; k < b[r].length; k++)
        if (b[r][k] !== (a[r]?.[k] ?? "")) return clip(k > 0 && b[r][0] ? `${b[r][0]} · ${b[r][k]}` : b[r][k], 70);
  }
  return clip(plain(after), 70);
}

/** Slide numbers as a tag writes them: runs joined ("19-20,37-38"). */
export function slideSpec(nums: readonly number[]): string {
  const all = [...new Set(nums)].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1] === all[j] + 1) j++;
    out.push(j > i ? `${all[i]}-${all[j]}` : String(all[i]));
    i = j + 1;
  }
  return out.join(",");
}

/** A correction's or a proposal's source, in words ("מקור: שקף 33"). */
export function sourceLine(x: { source_kind: string | null; source_slides: number[] | null; source_at: number | null; source_note: string | null }): string {
  if (x.source_kind === "slide") return `מקור: שקף ${(x.source_slides ?? []).join(", ")}`;
  if (x.source_kind === "recording") return `מקור: מההקלטה, ${clock(x.source_at ?? 0)}`;
  if (x.source_kind === "external") return `מקור: ${x.source_note ?? ""}`;
  return "";
}

/** "לבדוק מול השקף" (op fix_check, ≈ $0.01): the result is also written on the proposal. */
export async function fixCheck(proposalId: string): Promise<{ ok: boolean; note: string }> {
  const res = await postStudy("/api/study/ai", { op: "fix_check", proposalId });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; note?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `http_${res.status}`);
  return { ok: Boolean(body.ok), note: String(body.note ?? "") };
}

/** "לא מסכימים" (section V's study_dispute_open, with the waiting
 *  proposal, which then waits for the card's verdict, or on the paragraph
 *  itself with none). */
export async function openDispute(p: { lectureId: string; part: number; anchor: number; quote: string; claim: string; slides: number[]; proposalId: string | null }): Promise<string> {
  const { data, error } = await client().rpc("study_dispute_open", {
    p_lecture: p.lectureId,
    p_part: p.part,
    p_anchor: p.anchor,
    p_quote: p.quote.slice(0, 200),
    p_claim: p.claim,
    p_slides: p.slides,
    p_proposal: p.proposalId,
  });
  if (error) fail(error);
  return String(data);
}

/** The group's corrections and proposals of the last days, for "יחד" and the
 *  library's chip (RLS: only the member's groups). */
export type RecentEdit = Pick<
  Edit,
  "id" | "lecture_id" | "part_idx" | "anchor" | "author_id" | "approved_by" | "aloud" | "source_kind" | "source_slides" | "source_at" | "source_note" | "undo_of" | "before_text" | "after_text" | "created_at"
>;
export async function recentEdits(days = 7): Promise<RecentEdit[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await client()
    .from("study_edits")
    .select("id, lecture_id, part_idx, anchor, author_id, approved_by, aloud, source_kind, source_slides, source_at, source_note, undo_of, before_text, after_text, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) fail(error);
  return (data ?? []) as RecentEdit[];
}
export type WaitingProposal = Pick<Proposal, "id" | "lecture_id" | "part_idx" | "anchor" | "proposed_by" | "before_text" | "after_text" | "created_at">;
export async function waitingProposals(): Promise<WaitingProposal[]> {
  const { data, error } = await client()
    .from("study_edit_proposals")
    .select("id, lecture_id, part_idx, anchor, proposed_by, before_text, after_text, created_at")
    .eq("state", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) fail(error);
  return (data ?? []) as WaitingProposal[];
}
/** Live, for "יחד": any correction or proposal the member may see. */
export function watchGroupCorrections(groupId: string, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const ch: RealtimeChannel = sb
    .channel(`study-corrections-group-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_edits" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_edit_proposals" }, onChange)
    .subscribe();
  return () => void sb?.removeChannel(ch);
}

/* ─────────────────────────── the thread's extras ─────────────────────────── */

/** What section K's end adds to a comment: Claude's attempt (attached only by
 *  the op) and who marked a question answered. Read beside F's comments. */
export type CommentExtra = { id: string; ask_attempt: boolean; resolved_by: string | null };
export async function commentExtras(ids: string[]): Promise<CommentExtra[]> {
  if (!ids.length) return [];
  const { data, error } = await client().from("study_comments").select("id, ask_attempt, resolved_by").in("id", ids);
  if (error) fail(error);
  return (data ?? []) as CommentExtra[];
}

/** "להוסיף לתור שלי": the asker's private card from her answered question
 *  (section C's study_my_card_add, origin "answer"; with flags.cards). */
export async function addAnswerCard(c: { lectureId: string; part: number; anchor: number; front: string; back: string; slides: number[]; commentId: string }): Promise<string> {
  const { data, error } = await client().rpc("study_my_card_add", {
    p_lecture: c.lectureId,
    p_origin: "answer",
    p_part: c.part,
    p_anchor: c.anchor,
    p_front: c.front,
    p_back: c.back,
    p_slides: c.slides,
    p_comment: c.commentId,
  });
  if (error) fail(error);
  return String(data);
}

/* ─────────────────────────── "לשאול" ─────────────────────────── */

/** One answered question, as this phone keeps it: the exact user text the
 *  server sent (`u`, the next request's prefix), the answer and its signature. */
export type Turn = { q: string; u: string; a: string; sig: string; at: string; lectureId: string; badTags: number[]; stop: string | null; focus: { part: number; anchor: number; quote: string } | null };
export type AskLine =
  | { t: "lecture"; id: string; title: string; also: Array<{ id: string; title: string }> }
  | { t: "nolecture"; ok: boolean; lectures: Array<{ id: string; title: string }> }
  | { t: "turn"; u: string }
  | { t: "a"; d: string }
  | { t: "done"; stop: string | null; badTags: number[]; model: string; left: number | null; sig: string };

/** POST /api/study/ai { op: "ask" } and its NDJSON lines; throws Error(code). */
export async function askStream(
  body: { lectureId: string | null; course: string | null; question: string; focus: { part: number; anchor: number } | null; history: Array<{ u: string; a: string; sig: string }> },
  onLine: (l: AskLine) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetchAsk({ op: "ask", ...body }, signal);
  await readLines(res, (l) => onLine(l as AskLine));
}
async function fetchAsk(body: unknown, signal?: AbortSignal): Promise<Response> {
  // "עצירה" aborts this fetch (the op stops the model too).
  return postStudy("/api/study/ai", body, { signal });
}

/** "עדיין לא ברור? לשאול את הקבוצה" (the share path, K2): the question goes
 *  onto the paragraph with the answer attached as Claude's attempt; the op
 *  checks the turn's signature. Returns the question's comment id. */
export async function askTheGroup(s: { lectureId: string; part: number; anchor: number; quote: string; question: string; turn: Pick<Turn, "u" | "a" | "sig"> }): Promise<string> {
  const res = await postStudy("/api/study/ai", {
    op: "ask",
    share: { lectureId: s.lectureId, part: s.part, anchor: s.anchor, quote: s.quote.slice(0, 200), question: s.question, turn: { u: s.turn.u, a: s.turn.a, sig: s.turn.sig } },
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error ?? `http_${res.status}`);
  return body.id;
}

/** "לשתף עם הקבוצה": the answer on a paragraph as a comment of kind "answer",
 *  written by the member's token ("שותפה ע״י …"). */
export function shareAnswer(c: { lectureId: string; part: number; anchor: number; quote: string; q: string; a: string }): Promise<Comment> {
  return addComment({ lecture_id: c.lectureId, part_idx: c.part, anchor: c.anchor, quote: c.quote, kind: "answer", body: `**שאלה:** ${c.q}\n\n${c.a}`.slice(0, 4000) });
}

/** How many questions to "לשאול" the member has left today (20 a day). */
export async function asksLeft(groupId: string): Promise<number> {
  const { data, error } = await client().rpc("study_my_uses_today", { p_group: groupId, p_kind: "ask", p_ref: "answer" });
  if (error) fail(error);
  return Math.max(0, 20 - Number(data ?? 0));
}

/** The lecture's recording, when section W has one ready (else none, also
 *  while W's tables are not there: REC5's line). */
export async function recordingReady(lectureId: string): Promise<boolean> {
  const { data, error } = await client().from("study_recordings").select("status").eq("lecture_id", lectureId).maybeSingle();
  if (error) return false;
  return (data as { status?: string } | null)?.status === "ready";
}

/** A paragraph's first words for a quote: no tags, no Markdown. */
export const plainQuote = (t: string) =>
  t
    .replace(/\[ש['׳][^\]]*\]/g, "")
    .replace(/[*#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

/** Every paragraph an answer belongs on: the paragraph asked about first,
 *  then each paragraph citing one of the answer's slides, else the start of
 *  the part whose slides hold its first one ("לפסקה", "לשתף", the group). */
export function answerSpots(sections: Section[], answer: string, focus: Spot | null): Spot[] {
  const cited = citedSlides(answer);
  const slides = new Set(cited);
  const out: Spot[] = focus ? [focus] : [];
  const ready = sections.filter((x) => x.status === "ready");
  for (const s of ready)
    for (const b of blockSources(tidy(s.markdown)))
      if (b.kind && citedSlides(b.text).some((n) => slides.has(n)) && !out.some((o) => o.part === s.idx && o.anchor === b.n))
        out.push({ part: s.idx, anchor: b.n, quote: plainQuote(b.text) });
  if (!out.length && cited.length) {
    const s = ready.find((x) => x.slide_from <= cited[0] && cited[0] <= x.slide_to);
    if (s) out.push({ part: s.idx, anchor: 0, quote: s.title });
  }
  return out;
}

/* ── The conversation, on this phone only ── */
const THREAD_DAYS = 14;
const THREAD_TURNS = 30;
export const threadKey = (lectureId: string | null) => `study-ask-v1:${lectureId ?? "all"}`;
export function loadThread(key: string): Turn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]") as Turn[];
    const since = Date.now() - THREAD_DAYS * 86_400_000;
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.u === "string" && typeof t.a === "string" && Date.parse(t.at) >= since).slice(-THREAD_TURNS) : [];
  } catch {
    return [];
  }
}
export function saveThread(key: string, turns: Turn[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(turns.slice(-THREAD_TURNS)));
  } catch {
    /* private mode or full: the conversation stays on screen */
  }
}
export function clearThread(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing kept */
  }
}
