import type { Card, CardEdit, CardSettings, CardState, MyCardOrigin, OutboxReview, ReviewHome } from "./cards";
import { chunks, client, fail, fromRow, pages, saveCardSettings } from "./cards";

/* ── Flashcards, C's end (§12.3.C): the client's data ──
 * Decision 8's deck part by part (study_my_deck, study_card_adopt and the
 * member's own study_card_adoptions), "עדיין נכון", the group's latest fix,
 * the review home, and private cards with their own reviews, undo, hide
 * and delete (study_my_cards: owner-only, never published). Read only by
 * the cards' lazy screens and the outbox, so none of it is in the entry
 * chunk. Every wrapper throws Error(code), as cards.ts's do. */

const EDIT_COLUMNS = "id, card_id, action, version, before, after, edited_by, edited_at";

/** The latest edit of any of these cards (the deck page's "תוקן לכולם", C's end), or null. */
export async function latestCardEdit(cardIds: string[]): Promise<CardEdit | null> {
  let best: CardEdit | null = null;
  for (const part of chunks([...new Set(cardIds)], 50)) {
    const { data, error } = await client().from("study_card_edits").select(EDIT_COLUMNS).in("card_id", part).eq("action", "edit").order("edited_at", { ascending: false }).limit(1);
    if (error) fail(error);
    const row = ((data ?? []) as CardEdit[])[0];
    if (row && (!best || row.edited_at > best.edited_at)) best = row;
  }
  return best;
}


/** One part of a lecture's deck page (cards.html s3). */
export type DeckPart = { part_idx: number; heading: string; slide_from: number; slide_to: number; cards: number; in_deck: boolean; studied: number };

/** The lecture's parts: their cards, whether each is in the member's deck, how many she studied. */
export async function myDeck(lectureId: string): Promise<DeckPart[]> {
  const { data, error } = await client().rpc("study_my_deck", { p_lecture: lectureId });
  if (error) fail(error);
  return ((data ?? []) as DeckPart[]).map((p) => ({ ...p, part_idx: Number(p.part_idx), cards: Number(p.cards), studied: Number(p.studied), in_deck: Boolean(p.in_deck) }));
}

/** "להוסיף" (on) or "להוציא מהחפיסה שלי" (off): parts, or every part (null). Returns the parts now in the deck. */
export async function adoptParts(lectureId: string, parts: number[] | null, on: boolean): Promise<number[]> {
  const { data, error } = await client().rpc("study_card_adopt", { p_lecture: lectureId, p_parts: parts, p_on: on });
  if (error) fail(error);
  return ((data ?? []) as number[]).map(Number);
}

/** The parts of the member's deck, every lecture (her own rows: RLS). */
export async function myAdoptions(): Promise<Array<{ lecture_id: string; part_idx: number }>> {
  return pages<{ lecture_id: string; part_idx: number }>((from, to) =>
    client().from("study_card_adoptions").select("lecture_id, part_idx").order("lecture_id").order("part_idx").range(from, to),
  );
}

/** "עדיין נכון" on a card a correction marked. */
export async function cardStillTrue(cardId: string): Promise<void> {
  const { error } = await client().rpc("study_card_still_true", { p_card: cardId });
  if (error) fail(error);
}

/** Saves where the member reviews (C6), on her own row. */
export async function saveReviewHome(s: CardSettings, home: ReviewHome): Promise<void> {
  await saveCardSettings({ ...s, home });
}

/** A private card (owner-only; its memory on the row). */
export type MyCard = {
  id: string;
  lecture_id: string;
  part_idx: number | null;
  anchor: number | null;
  origin: MyCardOrigin;
  question_id: string | null;
  front: string;
  back: string;
  extra: string;
  slides: number[];
  suspended: boolean;
  created_at: string;
  deleted_at: string | null;
} & StateRowCols;
type StateRowCols = { state: number; step: number; stability: number; difficulty: number; due: string | null; last_review: string | null; reps: number; lapses: number };

const MY_COLUMNS = "id, lecture_id, part_idx, anchor, origin, question_id, front, back, extra, slides, suspended, created_at, deleted_at, state, step, stability, difficulty, due, last_review, reps, lapses";

/** The member's private cards that are not deleted, every lecture (her own rows: RLS). */
export async function listMyCards(): Promise<MyCard[]> {
  return pages<MyCard>((from, to) => client().from("study_my_cards").select(MY_COLUMNS).is("deleted_at", null).order("created_at").order("id").range(from, to));
}

/** A private card's memory, as a shared card's state. */
export function myCardState(c: MyCard): CardState {
  return fromRow({ card_id: c.id, state: c.state, step: c.step, stability: c.stability, difficulty: c.difficulty, due: c.due, last_review: c.last_review, reps: c.reps, lapses: c.lapses, suspended: c.suspended });
}

/** A private card as a session shows it: a question card of its lecture, source "mine". */
export function myCardAsCard(c: MyCard, groupId: string): Card {
  return {
    id: c.id,
    group_id: groupId,
    lecture_id: c.lecture_id,
    batch_id: null,
    source: "mine",
    part_idx: c.part_idx,
    kind: "qa",
    front: c.front,
    back: c.back,
    extra: c.extra,
    figure: "",
    slides: c.slides ?? [],
    topic: "",
    aspect: "other",
    version: 1,
    created_by: null,
    created_at: c.created_at,
    updated_by: null,
    updated_at: c.created_at,
    deleted_at: c.deleted_at,
    deleted_by: null,
    anchor: c.anchor,
    origin: c.origin,
  };
}

/** The member's memory of these private cards. */
export async function myPrivateStates(ids: string[]): Promise<Map<string, CardState>> {
  const out = new Map<string, CardState>();
  for (const part of chunks([...new Set(ids)], 50)) {
    const { data, error } = await client().from("study_my_cards").select(MY_COLUMNS).in("id", part);
    if (error) fail(error);
    for (const r of (data ?? []) as MyCard[]) out.set(r.id, myCardState(r));
  }
  return out;
}

/** Records one answer to a private card: "ok" or "dup". */
export async function sendMyReview(r: OutboxReview): Promise<"ok" | "dup"> {
  const { data, error } = await client().rpc("study_my_card_review", {
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

/** Takes back the latest answer to a private card. */
export async function undoMyReview(reviewId: string): Promise<void> {
  const { error } = await client().rpc("study_my_card_undo", { p_review: reviewId });
  if (error) fail(error);
}

/** A private card hidden from one's reviews ("hide"/"show") or deleted ("delete"/"restore"). */
export async function setMyCard(id: string, action: "hide" | "show" | "delete" | "restore"): Promise<void> {
  const { error } = await client().rpc("study_my_card_set", { p_card: id, p_action: action });
  if (error) fail(error);
}

