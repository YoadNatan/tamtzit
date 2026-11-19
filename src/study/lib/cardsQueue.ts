import { studyDay, type Mem, type Rating } from "../../../shared/study/fsrs";

/* ── What a review session shows, in what order (design-cards §4.1, §4.4) ──
 * Pure, so it is unit-tested with fixed clocks (cardsQueue.test.ts). The
 * design's tested queue, unchanged, plus what the end screen counts.
 *
 *  1. Cards in (re)learning that are due now, most overdue first.
 *  2. Review cards due today (their study day is today or earlier), oldest
 *     due first; ties broken by a hash of the card id, so the order is stable
 *     but not the deck's.
 *  3. New cards, in the deck's order (the lecture's order), up to what is
 *     left of today's new-card limit.
 *  Suspended ("להסתיר ממני") and deleted cards never appear.
 *
 * A card answered during the session comes back in the same session when its
 * next due time is less than 20 minutes away (Anki's default "learn ahead
 * limit" is 20 minutes): after 4 cards for שוב, 6 for קשה and 8 for טוב on a
 * learning step, or at once when nothing else is left.
 *
 * C's end (§12.3.C, decision 8 and review F-11): a card never studied is new
 * only when it is in the member's deck (`newOk`: its part added, a trap card,
 * her own card, a private card); trap cards and private cards come first
 * among the new ones (`first`), and all of them stay inside the day's limit.
 * With Anki as her review home, Today shows no cards to review
 * (`dueForToday`). */

export type QCard = {
  id: string;
  lectureId: string;
  order: number;
  deleted: boolean;
  /** May be shown as new (C's end); absent: yes (a deck before C's end). */
  newOk?: boolean;
  /** First among the new: the group's trap card or a private card. */
  first?: boolean;
  /** A private card (study_my_cards). */
  mine?: boolean;
};

/** Whether a group card is new material for the member (study_private.card_in_my_deck):
 *  its part is in her deck, it is a trap card, or she wrote it. */
export function inMyDeck(c: { lecture_id: string; part_idx: number | null; source: string; created_by: string | null }, adopted: ReadonlySet<string>, userId: string): boolean {
  return c.source === "trap" || (c.source === "member" && c.created_by === userId) || (c.part_idx !== null && adopted.has(`${c.lecture_id}:${c.part_idx}`));
}

/** The key of an added part in `adopted`. */
export const partKey = (lectureId: string, partIdx: number): string => `${lectureId}:${partIdx}`;

/** A session's or a count's cards in deck order (the lectures' order, then
 *  parts, then when written), with C's end's rules: new only in the
 *  member's deck, trap and private cards first among the new, a card a
 *  correction marked (stale) out of review until "עדיין נכון", and her
 *  private cards that are not hidden after the group's. */
export function deckCards(o: {
  cards: ReadonlyArray<{ id: string; lecture_id: string; part_idx: number | null; created_at: string; deleted_at: string | null; source: string; created_by: string | null; stale_at?: string | null }>;
  lectureOrder: ReadonlyMap<string, number>;
  adopted: ReadonlySet<string>;
  userId: string;
  mine?: ReadonlyArray<{ id: string; lecture_id: string; part_idx: number | null; created_at: string; suspended: boolean }>;
}): QCard[] {
  const at = (l: string) => o.lectureOrder.get(l) ?? 1e9;
  const group = [...o.cards]
    .filter((c) => !c.stale_at)
    .sort((a, b) => at(a.lecture_id) - at(b.lecture_id) || (a.part_idx ?? 1e9) - (b.part_idx ?? 1e9) || a.created_at.localeCompare(b.created_at));
  const out: QCard[] = group.map((c, i) => ({
    id: c.id,
    lectureId: c.lecture_id,
    order: i,
    deleted: c.deleted_at !== null,
    newOk: inMyDeck(c, o.adopted, o.userId),
    first: c.source === "trap",
  }));
  // Her private cards in the deck's order too: lecture, part, then when made.
  for (const m of [...(o.mine ?? [])]
    .filter((x) => !x.suspended)
    .sort((a, b) => at(a.lecture_id) - at(b.lecture_id) || (a.part_idx ?? 1e9) - (b.part_idx ?? 1e9) || a.created_at.localeCompare(b.created_at))) {
    out.push({ id: m.id, lectureId: m.lecture_id, order: out.length, deleted: false, newOk: true, first: true, mine: true });
  }
  return out;
}

/** C6: Today's count of cards to review: none when the member's home is Anki. */
export function dueForToday(home: "app" | "anki" | null | undefined, due: number): number {
  return home === "anki" ? 0 : due;
}
export type QState = Mem & { suspended: boolean };

export const LEARN_AHEAD_MS = 20 * 60_000;

function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export type Queue = { ids: string[]; counts: { fresh: number; learning: number; review: number } };

export function buildQueue(o: {
  cards: QCard[];
  states: ReadonlyMap<string, QState>;
  now: number;
  newLeft: number;
  dayOf?: (ms: number) => number;
}): Queue {
  const dayOf = o.dayOf ?? studyDay;
  const today = dayOf(o.now);
  const learning: Array<{ id: string; due: number }> = [];
  const review: Array<{ id: string; due: number }> = [];
  const fresh: QCard[] = [];
  for (const c of o.cards) {
    if (c.deleted) continue;
    const s = o.states.get(c.id);
    if (s?.suspended) continue;
    if (!s || s.state === 0) {
      if (c.newOk !== false) fresh.push(c);
    }
    else if (s.state === 1 || s.state === 3) {
      if (s.due <= o.now) learning.push({ id: c.id, due: s.due });
    } else if (dayOf(s.due) <= today) review.push({ id: c.id, due: s.due });
  }
  learning.sort((a, b) => a.due - b.due);
  review.sort((a, b) => a.due - b.due || hash(a.id) - hash(b.id));
  fresh.sort((a, b) => Number(Boolean(b.first)) - Number(Boolean(a.first)) || a.order - b.order);
  const newOnes = fresh.slice(0, Math.max(0, o.newLeft)).map((c) => c.id);
  return {
    ids: [...learning.map((x) => x.id), ...review.map((x) => x.id), ...newOnes],
    counts: { fresh: newOnes.length, learning: learning.length, review: review.length },
  };
}

/** After an answer: the queue without the card, and the card again later in
 *  the session if it is due within the learn-ahead limit. */
export function requeue(rest: string[], cardId: string, rating: Rating, next: Mem, now: number): string[] {
  const out = rest.filter((id) => id !== cardId);
  if (next.state !== 1 && next.state !== 3) return out;
  if (next.due - now > LEARN_AHEAD_MS) return out;
  const gap = rating === 1 ? 4 : rating === 2 ? 6 : 8;
  out.splice(Math.min(gap, out.length), 0, cardId);
  return out;
}

/** "New cards left today": the member's limit minus new cards first seen today
 *  (reviews whose state_before was new), plus any "עוד 10" taps today. */
export function newLeftToday(limit: number, firstSeenToday: number, extra = 0): number {
  return Math.max(0, limit + extra - firstSeenToday);
}

/* ── The end of a session (K5) and the counts above the card (K4) ── */

/** Cards of the scope still in (re)learning but not in the queue: due later
 *  (another session's, or a step longer than the learn-ahead limit). K5's
 *  "עוד 2 כרטיסיות בלמידה חוזרות בעוד 7 דק׳." */
export function waitingLearning(cards: QCard[], states: ReadonlyMap<string, QState>, queued: ReadonlySet<string>, now: number): { count: number; firstDue: number | null } {
  let count = 0;
  let firstDue: number | null = null;
  for (const c of cards) {
    if (c.deleted || queued.has(c.id)) continue;
    const s = states.get(c.id);
    if (!s || s.suspended || (s.state !== 1 && s.state !== 3) || s.due <= now) continue;
    count += 1;
    firstDue = firstDue === null ? s.due : Math.min(firstDue, s.due);
  }
  return { count, firstDue };
}

/** New cards of the scope the daily limit left out (K5's "נשארו 30 חדשות."). */
export function newBeyondLimit(cards: QCard[], states: ReadonlyMap<string, QState>, queued: ReadonlySet<string>): number {
  let n = 0;
  for (const c of cards) {
    if (c.deleted || queued.has(c.id) || c.newOk === false) continue;
    const s = states.get(c.id);
    if (!s || (s.state === 0 && !s.suspended)) n += 1;
  }
  return n;
}

/** Review cards whose study day of due is tomorrow (K5's "מחר: 18 לחזרה."). */
export function dueTomorrow(cards: QCard[], states: ReadonlyMap<string, QState>, now: number, dayOf: (ms: number) => number = studyDay): number {
  const tomorrow = dayOf(now) + 1;
  let n = 0;
  for (const c of cards) {
    if (c.deleted) continue;
    const s = states.get(c.id);
    if (s && !s.suspended && s.state !== 0 && dayOf(s.due) === tomorrow) n += 1;
  }
  return n;
}

/** The three counts above the card (K4: "חדשות 8 · בלמידה 2 · לחזרה 12"):
 *  what is left in the queue, by the state each card is in now. */
export function remainingCounts(queue: string[], states: ReadonlyMap<string, QState>): { fresh: number; learning: number; review: number } {
  const out = { fresh: 0, learning: 0, review: 0 };
  for (const id of new Set(queue)) {
    const s = states.get(id);
    if (!s || s.state === 0) out.fresh += 1;
    else if (s.state === 2) out.review += 1;
    else out.learning += 1;
  }
  return out;
}
