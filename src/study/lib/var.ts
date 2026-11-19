import type { RealtimeChannel } from "@supabase/supabase-js";
import { wordDiff } from "../../../shared/study/edits";
import type { UpdateRow } from "../features/types";
import { postStudy, sb } from "./api";
import { clip } from "./clip";

/* ── Disputes, VAR, the lecture's log and "עדכון": the data (package V; spec §12.4.V) ──
 *
 * Supabase and /api/study/ai calls for V's screens. Nothing here is imported
 * statically by the entry chunk: the slot module (features/var.tsx) loads it
 * with import() when VITE_STUDY_VAR is on, and V's screens import it inside
 * their own lazy chunks. Every wrapper throws Error(code) with the
 * database's or the op's code; the screens turn codes into words with
 * failText(code, "dispute").
 *
 * What a member sees of a yellow card comes from study_dispute_state: the
 * sides with their names (what one publishes carries the name), the total
 * of backers while backing is open, the split by side only after VAR was
 * asked or the card was decided and only from three others (review SEC-10),
 * her own side, the verdict. Backing rows and "עדכון" rows are private: they
 * are read only through these functions and are never published. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}

export type Certainty = "slide" | "interpretation" | "unclear";
export type VerdictItem = { text: string; slides: number[] };
export type Verdict = {
  certainty: Certainty;
  summary: string;
  on_slides: VerdictItem[];
  interpretation: VerdictItem[];
  listen: boolean;
  trap: { front: string; back: string; slides: number[] } | null;
};
export type Side = { claim: string; slides: number[]; author_id: string | null; name: string | null };
export type DisputeStateName = "open" | "judged" | "accepted" | "overridden" | "closed";
/** study_dispute_state's answer. */
export type DisputeState = {
  id: string;
  lecture_id: string;
  part: number;
  anchor: number;
  quote: string;
  state: DisputeStateName;
  proposal_id: string | null;
  a: Side;
  b: Side | null;
  /** The split by side: only once backing closed, from three others. */
  backs: { a: number; b: number } | null;
  backing_open: boolean;
  backers: number;
  mine: "a" | "b" | null;
  verdict: Verdict | null;
  judged_at: string | null;
  decided_by: string | null;
  decision_note: string;
  trap_card: string | null;
};
/** A published row of study_disputes (the reader's chips and box, "יחד"'s list). */
export type DisputeRow = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number;
  quote: string;
  claim_a: string;
  claim_b: string | null;
  author_a: string | null;
  author_b: string | null;
  slides_a: number[];
  slides_b: number[];
  state: DisputeStateName;
  verdict: Verdict | null;
  judging_until: string | null;
  var_asked_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  trap_card: string | null;
  created_at: string;
  updated_at: string;
};
const ROW_COLUMNS =
  "id, lecture_id, part_idx, anchor, quote, claim_a, claim_b, author_a, author_b, slides_a, slides_b, state, verdict, judging_until, var_asked_at, decided_by, decided_at, trap_card, created_at, updated_at";

/* ─────────────────────────── one yellow card ─────────────────────────── */

export async function disputeState(id: string): Promise<DisputeState> {
  const { data, error } = await client().rpc("study_dispute_state", { p_dispute: id });
  if (error) fail(error);
  return data as DisputeState;
}

/** The card's published row: whether op var holds it now (judging_until). */
export async function disputeRow(id: string): Promise<DisputeRow | null> {
  const { data, error } = await client().from("study_disputes").select(ROW_COLUMNS).eq("id", id).maybeSingle();
  if (error) fail(error);
  return (data as DisputeRow | null) ?? null;
}

/** "לא מסכימים", from a paragraph or from a waiting correction
 *  (which then waits for the card). The opener's claim is side a. */
export async function openDispute(p: { lectureId: string; part: number; anchor: number; quote: string; claim: string; slides: number[]; proposalId?: string | null }): Promise<string> {
  const { data, error } = await client().rpc("study_dispute_open", {
    p_lecture: p.lectureId,
    p_part: p.part,
    p_anchor: p.anchor,
    p_quote: p.quote.slice(0, 200),
    p_claim: p.claim,
    p_slides: p.slides,
    p_proposal: p.proposalId ?? null,
  });
  if (error) fail(error);
  return String(data);
}

/** "לכתוב את הצד השני" (or a side's own line again, before the verdict). */
export async function writeClaim(id: string, claim: string, slides: number[]): Promise<void> {
  const { error } = await client().rpc("study_dispute_claim", { p_dispute: id, p_claim: claim, p_slides: slides });
  if (error) fail(error);
}

/** "לגבות את {שם}" (null: take it back). Refused once VAR was asked ("not open"). */
export async function backSide(id: string, side: "a" | "b" | null): Promise<void> {
  const { error } = await client().rpc("study_dispute_back", { p_dispute: id, p_side: side });
  if (error) fail(error);
}

/** "VAR" (op var, ≈ $0.08): the verdict, also saved on the card. */
export async function askVar(id: string): Promise<Verdict> {
  const res = await postStudy("/api/study/ai", { op: "var", disputeId: id });
  const body = (await res.json().catch(() => ({}))) as { verdict?: Verdict; error?: string };
  if (!res.ok || !body.verdict) throw new Error(body.error ?? `http_${res.status}`);
  return body.verdict;
}

/** "לקבל" (the box is pinned, the trap card joins everyone's deck) or "בהרצאה נאמר אחרת". */
export async function decide(id: string, decision: "accept" | "override", note = ""): Promise<string | null> {
  const { data, error } = await client().rpc("study_dispute_decide", { p_dispute: id, p_decision: decision, p_note: note });
  if (error) fail(error);
  return data ? String(data) : null;
}

/** "לבטל את המחלוקת" (the opener, while it is open). */
export async function closeDispute(id: string): Promise<void> {
  const { error } = await client().rpc("study_dispute_close", { p_dispute: id });
  if (error) fail(error);
}

/** Live: the card's own row changed (a side, VAR asked, the verdict, the decision). Backs never publish. */
export function watchDispute(row: { id: string; lecture_id: string }, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const ch: RealtimeChannel = sb
    .channel(`study-dispute-${row.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_disputes", filter: `id=eq.${row.id}` }, () => onChange())
    .subscribe();
  return () => void sb?.removeChannel(ch);
}

/* ─────────────────────────── a lecture's cards, the group's ─────────────────────────── */

/** A lecture's yellow cards that the reader shows: open and judged ones (a
 *  chip under the paragraph) and accepted ones (the pinned box). */
export async function lectureDisputes(lectureId: string): Promise<DisputeRow[]> {
  const { data, error } = await client()
    .from("study_disputes")
    .select(ROW_COLUMNS)
    .eq("lecture_id", lectureId)
    .in("state", ["open", "judged", "accepted"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) fail(error);
  return (data ?? []) as DisputeRow[];
}

/** Open and judged yellow cards in the member's groups (RLS), newest first, for "יחד". */
export async function openDisputes(): Promise<DisputeRow[]> {
  const { data, error } = await client().from("study_disputes").select(ROW_COLUMNS).in("state", ["open", "judged"]).order("updated_at", { ascending: false }).limit(10);
  if (error) fail(error);
  return (data ?? []) as DisputeRow[];
}

/** Live: study-disputes-<lecture> (study_disputes and study_slide_flags by lecture, §12.7.1). */
export function watchLectureDisputes(lectureId: string, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const ch: RealtimeChannel = sb
    .channel(`study-disputes-${lectureId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_disputes", filter: `lecture_id=eq.${lectureId}` }, () => onChange())
    .on("postgres_changes", { event: "*", schema: "public", table: "study_slide_flags", filter: `lecture_id=eq.${lectureId}` }, () => onChange())
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "study_disputes" }, () => onChange())
    .subscribe();
  return () => void sb?.removeChannel(ch);
}

/** Live, for "יחד": any yellow card in the group. */
export function watchGroupDisputes(groupId: string, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const ch: RealtimeChannel = sb
    .channel(`study-disputes-group-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_disputes" }, () => onChange())
    .subscribe();
  return () => void sb?.removeChannel(ch);
}

/* ─────────────────────────── the lecture's log ─────────────────────────── */

export type LogEdit = {
  kind: "edit";
  id: string;
  at: string;
  part: number;
  anchor: number;
  block: string;
  before: string;
  after: string;
  note: string;
  undo_of: string | null;
  undone: boolean;
  source_kind: string | null;
  source_slides: number[] | null;
  source_at: number | null;
  source_note: string | null;
  author: string | null;
  approver: string | null;
  aloud: boolean;
};
export type LogVerdict = {
  kind: "verdict";
  id: string;
  at: string;
  part: number;
  anchor: number;
  state: "judged" | "accepted" | "overridden";
  claim_a: string;
  claim_b: string | null;
  slides: number[];
  name_a: string | null;
  name_b: string | null;
  certainty: Certainty | null;
  summary: string | null;
  decided_by: string | null;
  decision_note: string;
};
export type LogSlide = { kind: "slide"; id: string; at: string; slides: number[]; note: string; by: string | null; removed: boolean; removed_by: string | null };
export type LogEntry = LogEdit | LogVerdict | LogSlide;

/** "יומן התיקונים": corrections, verdicts and slide flags, newest first (at most 100). */
export async function lectureLog(lectureId: string): Promise<LogEntry[]> {
  const { data, error } = await client().rpc("study_lecture_log", { p_lecture: lectureId });
  if (error) fail(error);
  return (data ?? []) as LogEntry[];
}

/** "טעות בשקף": a slip in the deck itself (1-4 slides, a note of 5-300 characters). */
export async function flagSlide(lectureId: string, slides: number[], note: string): Promise<string> {
  const { data, error } = await client().rpc("study_slide_flag", { p_lecture: lectureId, p_slides: slides, p_note: note });
  if (error) fail(error);
  return String(data);
}

/** One-tap undo of a slide flag (any member; the log keeps who), or putting it back. */
export async function removeSlideFlag(id: string, remove = true): Promise<void> {
  const { error } = await client().rpc("study_slide_flag_remove", { p_flag: id, p_remove: remove });
  if (error) fail(error);
}

/* ─────────────────────────── "עדכון" ─────────────────────────── */

/** The member's unseen "עדכון" rows: a correction to a line she had studied (private). */
export async function myUpdates(groupId: string): Promise<UpdateRow[]> {
  const { data, error } = await client().rpc("study_my_updates", { p_group: groupId });
  if (error) fail(error);
  return (data ?? []) as UpdateRow[];
}

/** "הבנתי". */
export async function updateSeen(id: string): Promise<void> {
  const { error } = await client().rpc("study_update_seen", { p_update: id });
  if (error) fail(error);
}

/* ─────────────────────────── pure rules (lib/var.test.ts) ─────────────────────────── */

/** The words of a certainty, with its chip's colour (corrections.html s2: "ודאות: פרשנות"). */
export const CERTAINTY: Record<Certainty, { label: string; chip: string; short: string }> = {
  slide: { label: "ודאות: כתוב בשקף", chip: "ok", short: "כתוב בשקף" },
  interpretation: { label: "ודאות: פרשנות", chip: "warn", short: "פרשנות" },
  unclear: { label: "ודאות: לא חד-משמעי", chip: "", short: "לא חד-משמעי" },
};

/** What the backing part of a card shows (review SEC-10): while open, the
 *  total only; once closed, the split, or the "from 3" line. */
export function backingView(s: Pick<DisputeState, "backing_open" | "backers" | "backs">):
  | { kind: "open"; line: string }
  | { kind: "bars"; a: number; b: number }
  | { kind: "hidden"; line: string } {
  if (s.backing_open) {
    const n = s.backers === 0 ? "עוד אין גיבויים" : s.backers === 1 ? "גיבוי אחד" : `${s.backers} גיבו`;
    return { kind: "open", line: `${n} · הגיבוי יוצג אחרי הבדיקה, מ-3` };
  }
  if (s.backs) return { kind: "bars", a: s.backs.a, b: s.backs.b };
  return { kind: "hidden", line: "הגיבוי יוצג מ-3" };
}

/** A bar's width in percent of the two sides' backers. */
export const share = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

const plain = (t: string) =>
  t
    .replace(/\[ש['׳][^\]]*\]/g, "")
    .replace(/\*\*|__|[*#>|`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** An update's two lines ("היה" and "עכשיו"): the changed words with a few
 *  words around them, plain (no tags, no markdown), at most 140 characters
 *  each. A table row starts with its first cell. */
export function changeLines(before: string, after: string): { was: string; now: string } {
  const b = plain(before);
  const a = plain(after);
  const parts = wordDiff(b, a);
  if (!parts) return { was: clip(b, 140), now: clip(a, 140) };
  const side = (keep: "del" | "ins") => {
    const words = parts.filter((p) => p.op === "same" || p.op === keep);
    const firstIdx = words.findIndex((p) => p.op === keep);
    if (firstIdx < 0) return "—";
    let last = firstIdx;
    words.forEach((p, i) => p.op === keep && (last = i));
    const head = words.slice(0, firstIdx).map((p) => p.text).join("").split(/\s+/).filter(Boolean).slice(-3).join(" ");
    const body = words.slice(firstIdx, last + 1).map((p) => p.text).join("");
    const tail = words.slice(last + 1).map((p) => p.text).join("").split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
    return clip(`${head ? "… " + head + " " : ""}${body.trim()}${tail ? " " + tail + " …" : ""}`.replace(/\s+/g, " ").trim(), 140);
  };
  return { was: side("del"), now: side("ins") };
}

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
/** "היום", "אתמול" or "ביום ראשון" (Israel time), for "הגיע אליך כי …". */
export function dayWords(at: string, now = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const key = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const today = key(now);
  const yesterday = key(new Date(now.getTime() - 86_400_000));
  if (key(d) === today) return "היום";
  if (key(d) === yesterday) return "אתמול";
  const wd = new Date(key(d) + "T12:00:00Z").getUTCDay();
  return `ביום ${DAYS[wd]}`;
}

/** Why an update reached her (corrections.html s3). */
export function reasonLine(u: Pick<UpdateRow, "reason" | "reason_at">, now = new Date()): string {
  const when = u.reason_at ? dayWords(u.reason_at, now) : "";
  const what = u.reason === "card" ? "חזרת על כרטיסייה שנשענה" : "ענית על שאלה שנשענה";
  return `הגיע אליך כי ${when ? when + " " : ""}${what} על השורה הישנה.`;
}
