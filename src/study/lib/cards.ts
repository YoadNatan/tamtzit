import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Aspect } from "../../../shared/study/aspects";
import type { Mem, Phase } from "../../../shared/study/fsrs";
import { postStudy, readLines, sb } from "./api";

/* ── Flashcards: the client's data (spec §5.4; design-cards §4.1) ──
 * The shared deck (cards, generation rounds, every card's history) is read
 * through Row Level Security as the member and changed only through the
 * section C functions; a member's own memory of each card, their review log
 * and their settings are readable only by them and never published to
 * Realtime. Every wrapper throws Error(code) with the database's or the
 * op's code (spec §4.11), which the screens turn into words with
 * failText(code, "cards"). */

export type Card = {
  id: string;
  group_id: string;
  lecture_id: string;
  batch_id: string | null;
  /** "trap": the group's trap card (C's end); "mine": a private card shown
   *  in a session (study_my_cards, never a row of study_cards). */
  source: "ai" | "member" | "trap" | "mine";
  part_idx: number | null;
  kind: "qa" | "cloze";
  front: string;
  back: string;
  extra: string;
  figure: string;
  slides: number[];
  topic: string;
  aspect: Aspect;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  /* C's end (§12.3.C); absent on a card a stream line just brought */
  /** The paragraph (data-blk) of its part the card sits on, and its first words. */
  anchor?: number | null;
  quote?: string;
  trap_key?: string | null;
  /** A correction approved on its paragraph marked it (section V) until "עדיין נכון" or an edit. */
  stale_at?: string | null;
  checked_by?: string | null;
  checked_at?: string | null;
  /** A trap card waits until then (members never read it before). */
  opens_at?: string | null;
  /** A private card's origin (source "mine"): its chip. */
  origin?: MyCardOrigin;
};
/** For queues and counts: with C's end, what makes a card new for the member
 *  (its part in her deck, a trap card, her own card). */
export type CardLite = Pick<Card, "id" | "lecture_id" | "part_idx" | "created_at" | "deleted_at" | "source" | "created_by" | "stale_at">;
export type CardBatch = {
  id: string;
  lecture_id: string;
  round: number;
  part_idx: number;
  heading: string;
  slide_from: number;
  slide_to: number;
  wanted: number;
  status: "pending" | "writing" | "ready" | "failed";
  made: number;
  rejected: number;
  error: string | null;
  attempts: number;
  updated_at: string;
};
export type CardEdit = {
  id: string;
  card_id: string;
  action: "edit" | "delete" | "restore" | "revert";
  version: number;
  before: Partial<Pick<Card, "kind" | "front" | "back" | "extra" | "figure" | "slides">>;
  after: Partial<Pick<Card, "kind" | "front" | "back" | "extra" | "figure" | "slides">>;
  edited_by: string | null;
  edited_at: string;
};
/** One member's memory of one card: Mem (shared/study/fsrs.ts), times in ms. */
export type CardState = Mem & { card_id: string; suspended: boolean };
export type CardCounts = {
  lecture_id: string;
  cards: number;
  new_cards: number;
  learning_due: number;
  review_due: number;
  studied: number;
  hidden: number;
  next_due: string | null;
};
export type CardDay = { day: string; reviews: number; first_seen: number; again: number; seconds: number };
export type CardTopic = { lecture_id: string; course: string; topic: string; aspect: string; cards: number; studied: number; lapses: number; again_30d: number; recall: number | null };
/** Where a private card came from (C's end). */
export type MyCardOrigin = "quiz" | "practice" | "answer" | "table";
/** C6: where the member reviews, the app or Anki; null until she chooses. */
export type ReviewHome = "app" | "anki";
export type CardSettings = { new_per_day: number; retention: number; home?: ReviewHome | null };
/** What a member writes on a card (K6). */
export type NewCard = Pick<Card, "kind" | "front" | "back" | "extra" | "figure" | "slides" | "topic" | "aspect">;

export const DEFAULT_SETTINGS: CardSettings = { new_per_day: 20, retention: 0.9, home: null };

const CARD_COLUMNS =
  "id, group_id, lecture_id, batch_id, source, part_idx, kind, front, back, extra, figure, slides, topic, aspect, version, created_by, created_at, updated_by, updated_at, deleted_at, deleted_by, anchor, quote, trap_key, stale_at, checked_by, checked_at, opens_at";
const BATCH_COLUMNS = "id, lecture_id, round, part_idx, heading, slide_from, slide_to, wanted, status, made, rejected, error, attempts, updated_at";
const EDIT_COLUMNS = "id, card_id, action, version, before, after, edited_by, edited_at";
const STATE_COLUMNS = "card_id, state, step, stability, difficulty, due, last_review, reps, lapses, suspended";

/** The configured client (cardsDeck.ts shares it). */
export function client(): SupabaseClient {
  if (!sb) throw new Error("not-configured");
  return sb;
}

/** A refusal as Error(code): the database's exception text ("conflict"…). */
export function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}

/** Every row of a query, a page at a time (PostgREST returns at most 1000). */
export async function pages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<T[]> {
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

export const chunks = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/* ─────────────── the shared deck ─────────────── */

/** A lecture's cards, deleted ones included (K2 lists them under "נמחקו"), in deck order. */
export async function listCards(lectureId: string): Promise<Card[]> {
  return pages<Card>((from, to) =>
    client().from("study_cards").select(CARD_COLUMNS).eq("lecture_id", lectureId).order("part_idx").order("created_at").order("id").range(from, to),
  );
}

/** Cards by id (a review session's contents), 50 per request. */
export async function listCardsByIds(ids: string[]): Promise<Card[]> {
  const out: Card[] = [];
  for (const part of chunks([...new Set(ids)], 50)) {
    const { data, error } = await client().from("study_cards").select(CARD_COLUMNS).in("id", part);
    if (error) fail(error);
    out.push(...((data ?? []) as Card[]));
  }
  return out;
}

/** The group's active cards, light (for queues and counts). */
export async function listGroupCardsLite(groupId: string): Promise<CardLite[]> {
  return pages<CardLite>((from, to) =>
    client()
      .from("study_cards")
      .select("id, lecture_id, part_idx, created_at, deleted_at, source, created_by, stale_at")
      .eq("group_id", groupId)
      .is("deleted_at", null)
      .order("lecture_id")
      .order("part_idx")
      .order("created_at")
      .order("id")
      .range(from, to),
  );
}

/** A lecture's generation parts, every round. */
export async function listCardBatches(lectureId: string): Promise<CardBatch[]> {
  const { data, error } = await client().from("study_card_batches").select(BATCH_COLUMNS).eq("lecture_id", lectureId).order("round").order("part_idx");
  if (error) fail(error);
  return (data ?? []) as CardBatch[];
}

/** A card's history, newest first (K7). */
export async function listCardEdits(cardId: string): Promise<CardEdit[]> {
  const { data, error } = await client().from("study_card_edits").select(EDIT_COLUMNS).eq("card_id", cardId).order("edited_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as CardEdit[];
}

/** Plans the lecture's next round, or returns the one still open (fresh: false). */
export async function planCardRound(lectureId: string): Promise<{ round: number; batches: number; wanted: number; fresh: boolean }> {
  const { data, error } = await client().rpc("study_card_round", { p_lecture: lectureId });
  if (error) fail(error);
  const row = (Array.isArray(data) ? data[0] : data) as { round: number; batches: number; wanted: number; fresh: boolean } | null;
  if (!row) throw new Error("no slides");
  return row;
}

/** A card as the op's stream line carries it (spec §4.7; C's end adds its paragraph). */
export type CardLine = Pick<Card, "id" | "part_idx" | "version" | "kind" | "front" | "back" | "extra" | "figure" | "slides" | "topic" | "aspect"> & {
  para?: number | null;
  quote?: string;
};

/** Writes one part through op "cards": its lines as they arrive; a refusal
 *  before the stream (409 busy, 402 budget…) or after it (\0ERROR) throws
 *  Error(code). */
export async function runCardBatch(
  lectureId: string,
  batchId: string,
  on: { start(): void; card(c: CardLine): void; skip?(why: string): void },
): Promise<{ made: number; rejected: number; costUsd: number }> {
  const res = await postStudy("/api/study/ai", { op: "cards", lectureId, batchId });
  const done = { made: 0, rejected: 0, costUsd: 0 };
  await readLines(res, (line) => {
    const l = line as { t?: string; c?: CardLine; why?: string; made?: number; rejected?: number; costUsd?: number };
    if (l.t === "start") on.start();
    else if (l.t === "c" && l.c) on.card(l.c);
    else if (l.t === "skip") on.skip?.(String(l.why ?? ""));
    else if (l.t === "done") Object.assign(done, { made: Number(l.made ?? 0), rejected: Number(l.rejected ?? 0), costUsd: Number(l.costUsd ?? 0) });
  });
  return done;
}

/** "הוספת כרטיסייה": a member's own card. Returns its id. From a paragraph
 *  (C's end) it also carries the part, the paragraph and its first words. */
export async function addCard(lectureId: string, c: NewCard & { part?: number; para?: number; quote?: string }): Promise<string> {
  const { data, error } = await client().rpc("study_add_card", { p_lecture: lectureId, p_card: c });
  if (error) fail(error);
  return String(data);
}

/** Fixes a card for the group; `version` is the one the member edited
 *  ("conflict" when someone changed it meanwhile). Returns the new version. */
export async function editCard(id: string, version: number, patch: Partial<NewCard>): Promise<number> {
  const { data, error } = await client().rpc("study_edit_card", { p_card: id, p_version: version, p_new: patch });
  if (error) fail(error);
  return Number(data);
}

/** Deletes a card for the group (soft), or restores it. */
export async function deleteCard(id: string, del: boolean): Promise<void> {
  const { error } = await client().rpc("study_delete_card", { p_card: id, p_delete: del });
  if (error) fail(error);
}

/** Puts back the text a card had before one edit. Returns the new version. */
export async function revertCardEdit(editId: string): Promise<number> {
  const { data, error } = await client().rpc("study_revert_card", { p_edit: editId });
  if (error) fail(error);
  return Number(data);
}

/* ─────────────── the member's own (private) ─────────────── */

export type StateRow = {
  card_id: string;
  state: number;
  step: number;
  stability: number;
  difficulty: number;
  due: string | null;
  last_review: string | null;
  reps: number;
  lapses: number;
  suspended: boolean;
};

export const fromRow = (r: StateRow): CardState => ({
  card_id: r.card_id,
  state: Math.max(0, Math.min(3, Number(r.state))) as Phase,
  step: Number(r.step),
  stability: Number(r.stability),
  difficulty: Number(r.difficulty),
  due: r.due ? Date.parse(r.due) : 0,
  lastReview: r.last_review ? Date.parse(r.last_review) : null,
  reps: Number(r.reps),
  lapses: Number(r.lapses),
  suspended: Boolean(r.suspended),
});

/** The member's memory of every card they have studied (their own rows only:
 *  RLS), a page at a time: one request where a list of ids would take many. */
export async function myStatesAll(): Promise<Map<string, CardState>> {
  const rows = await pages<StateRow>((from, to) => client().from("study_card_states").select(STATE_COLUMNS).order("card_id").range(from, to));
  return new Map(rows.map((r) => [r.card_id, fromRow(r)]));
}

/** The member's memory of these cards (their own rows only: RLS). */
export async function myStates(cardIds: string[]): Promise<Map<string, CardState>> {
  const out = new Map<string, CardState>();
  for (const part of chunks([...new Set(cardIds)], 50)) {
    const { data, error } = await client().from("study_card_states").select(STATE_COLUMNS).in("card_id", part);
    if (error) fail(error);
    for (const r of (data ?? []) as StateRow[]) out.set(r.card_id, fromRow(r));
  }
  return out;
}

/** The state study_card_review stores, as the phone computed it. */
export type WireState = { state: number; step: number; stability: number; difficulty: number; due: string; lapses: number };
export const toWire = (m: Mem): WireState => ({ state: m.state, step: m.step, stability: m.stability, difficulty: m.difficulty, due: new Date(m.due).toISOString(), lapses: m.lapses });

/** One answer, as the outbox keeps it until the database has it. */
export type OutboxReview = {
  id: string;
  card: string;
  /** A private card (C's end): sent with study_my_card_review. */
  mine?: true;
  rating: 1 | 2 | 3 | 4;
  /** When it was answered (ms). */
  at: number;
  ms: number;
  prevReps: number;
  next: WireState;
};

/** Records one answer: "ok", or "dup" when the database has it already. */
export async function sendReview(r: OutboxReview): Promise<"ok" | "dup"> {
  const { data, error } = await client().rpc("study_card_review", {
    p_review: r.id,
    p_card: r.card,
    p_rating: r.rating,
    p_reviewed_at: new Date(r.at).toISOString(),
    p_ms: r.ms,
    p_prev_reps: r.prevReps,
    p_next: r.next,
  });
  if (error) fail(error);
  return data === "dup" ? "dup" : "ok";
}

/** Takes back the member's latest answer to a card. */
export async function undoReview(reviewId: string): Promise<void> {
  const { error } = await client().rpc("study_card_undo", { p_review: reviewId });
  if (error) fail(error);
}

/** "להסתיר ממני" / "להציג שוב": this member's reviews only. */
export async function hideCard(id: string, hide: boolean): Promise<void> {
  const { error } = await client().rpc("study_card_hide", { p_card: id, p_hide: hide });
  if (error) fail(error);
}

/** "להתחיל מחדש": the member's states for the lecture go (the log stays). */
export async function resetLecture(lectureId: string): Promise<number> {
  const { data, error } = await client().rpc("study_card_reset", { p_lecture: lectureId });
  if (error) fail(error);
  return Number(data ?? 0);
}

/** Per lecture: the member's own due counts (library chips, K1, K2, the hub). */
export async function myCardCounts(groupId: string): Promise<CardCounts[]> {
  const { data, error } = await client().rpc("study_my_card_counts", { p_group: groupId });
  if (error) fail(error);
  return ((data ?? []) as CardCounts[]).map((c) => ({
    ...c,
    cards: Number(c.cards),
    new_cards: Number(c.new_cards),
    learning_due: Number(c.learning_due),
    review_due: Number(c.review_due),
    studied: Number(c.studied),
    hidden: Number(c.hidden),
  }));
}

/** Per study day: answers, first seen (today's new-card limit), שוב, seconds. */
export async function myCardDays(groupId: string, days = 30): Promise<CardDay[]> {
  const { data, error } = await client().rpc("study_my_card_days", { p_group: groupId, p_days: days });
  if (error) fail(error);
  return (data ?? []) as CardDay[];
}

/** Weak points per lecture, topic and aspect (for progress, item 7). */
export async function myCardTopics(groupId: string): Promise<CardTopic[]> {
  const { data, error } = await client().rpc("study_my_card_topics", { p_group: groupId });
  if (error) fail(error);
  return (data ?? []) as CardTopic[];
}

/** The member's settings, or the defaults (20 new a day, 90%, no home yet). */
export async function loadCardSettings(): Promise<CardSettings> {
  const { data, error } = await client().from("study_card_settings").select("new_per_day, retention, home").maybeSingle();
  if (error) fail(error);
  const row = data as { new_per_day: number; retention: number | string; home: ReviewHome | null } | null;
  return row ? { new_per_day: Number(row.new_per_day), retention: Number(row.retention), home: row.home ?? null } : { ...DEFAULT_SETTINGS };
}

/** Saves the member's settings (their own row; user_id is always its default). */
export async function saveCardSettings(s: CardSettings): Promise<void> {
  const row: Record<string, unknown> = { new_per_day: s.new_per_day, retention: s.retention };
  if (s.home) row.home = s.home;
  const { error } = await client().from("study_card_settings").upsert(row, { onConflict: "user_id" });
  if (error) fail(error);
}

/* ─────────────── live ─────────────── */

let watchSeq = 0;

/** Live changes to the shared deck: a lecture's cards, its rounds and the
 *  history, or a whole group's cards (the library's chips). Never the
 *  private tables, which are not published anyway. A deleted row carries only
 *  its key, so every DELETE is listened to without a filter. */
export function watchCards(scope: { lectureId: string } | { groupId: string }, onChange: (table: string, row: Record<string, unknown>) => void): () => void {
  if (!sb) return () => undefined;
  const call = (p: { table: string; new?: Record<string, unknown> }) => onChange(p.table, p.new ?? {});
  const key = "lectureId" in scope ? `l-${scope.lectureId}` : `g-${scope.groupId}`;
  // A topic of its own per watcher: two screens (the library's chip and a sheet over it) never share one.
  let ch: RealtimeChannel = sb.channel(`study-cards-${key}-${++watchSeq}`);
  if ("lectureId" in scope) {
    ch = ch
      .on("postgres_changes", { event: "*", schema: "public", table: "study_cards", filter: `lecture_id=eq.${scope.lectureId}` }, call)
      .on("postgres_changes", { event: "*", schema: "public", table: "study_card_batches", filter: `lecture_id=eq.${scope.lectureId}` }, call)
      .on("postgres_changes", { event: "*", schema: "public", table: "study_card_edits" }, call)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "study_card_batches" }, call);
  } else {
    ch = ch.on("postgres_changes", { event: "*", schema: "public", table: "study_cards", filter: `group_id=eq.${scope.groupId}` }, call);
  }
  ch = ch.on("postgres_changes", { event: "DELETE", schema: "public", table: "study_cards" }, call).subscribe();
  return () => void sb?.removeChannel(ch);
}
