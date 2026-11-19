import { studyDay } from "../../../shared/study/day";
import { asMinutes, CASE_SECONDS, dayKey, MINUTES_KEY, type Minutes, type QueueItem } from "../../../shared/study/today";
import type { UpdateRow } from "../features/types";
import { listLectures } from "./api";
import { DEFAULT_SETTINGS, listCardsByIds, listGroupCardsLite, loadCardSettings, myCardDays, myStatesAll } from "./cards";
import { listMyCards, myAdoptions, myCardState } from "./cardsDeck";
import { extraToday, waitingReviews, withWaiting } from "./cardsOutbox";
import { buildQueue, dueForToday, newLeftToday, partKey } from "./cardsQueue";
import { scopeCards } from "./cardsScope";
import { db, run } from "./quizOpen";

/* ── Today's data (package T, T-1; spec §12.4.T) ──
 * One call to the database (study_today: quiz returns, the danger row, "לא
 * ברור", "עדכון", a missed meeting, "בקבוצה" and the flame), the due cards
 * from section C's queue on the phone (the session's own rules: decision 8,
 * trap and private cards first among the new, the 20-a-day limit; none with
 * Anki as the review home), and the day's order kept in sessionStorage.
 * Loaded only by Today's own chunk. Everything here is the member's own
 * (decision 1 of 17 Nov 2026: the device's member, no account). */

export type QuizReturn = {
  question_id: string;
  lecture_id: string | null;
  wrong_at: string;
  step: 1 | 2;
  choice: number | null;
  bet: number | null;
  fixed_in_discussion: boolean;
  question: string;
  /** "mcq" or "case" (a case is estimated at 120 s). */
  kind: string;
  slides: number[];
  lecture_title: string | null;
};
export type DangerRow = { question_id: string; ask_id: string; lecture_id: string | null; wrong_at: string; other_wording: boolean; question: string; kind: string; slides: number[]; lecture_title: string | null };
export type UnclearRow = {
  tap_id: string;
  meeting_id: string;
  lecture_id: string;
  lecture_title: string;
  part_idx: number;
  anchor: number;
  quote: string;
  tapped_at: string;
  explained: boolean;
  thread: "none" | "open" | "answered";
  comment_id: string | null;
};
export type MissedRow = { meeting_id: string; lecture_id: string; lecture_title: string; title: string | null; day: string };
export type OpenQuestion = { id: string; lecture_id: string; lecture_title: string; part: number; anchor: number; quote: string; body: string; author_id: string; created_at: string };
export type Flame = { days: number; lit: boolean; list: string[] };
export type LootDue = { question_id: string; quiz_id: string; due_on: string; question?: string; topic?: string; slides?: number[] | null; kind?: string };
export type TodayData = {
  quiz_returns: QuizReturn[];
  danger: DangerRow[];
  unclear: UnclearRow[];
  updates: UpdateRow[];
  /** H's loot (section H's study_my_loot, when it is loaded): the caller's own battle mistakes due today. */
  loot: LootDue[];
  missed: MissedRow[];
  needs_me: Array<Record<string, unknown>>;
  open_question: OpenQuestion | null;
  flame: Flame;
  day: string;
};

/** Everything Today's queue needs from the database, in one call. */
export const loadToday = (groupId: string) => run<TodayData>(db().rpc("study_today", { p_group: groupId }));

/** "הבנתי" on a "לא ברור" paragraph (section M). */
export const unclearDone = (tapId: string) => run<null>(db().rpc("study_unclear_done", { p_tap: tapId }));

/** The due cards for Today, as the review session would build its queue. */
export type TodayCards = { ids: string[]; traps: Set<string>; example: { front: string; slides: number[] } | null; anki: boolean };

export async function loadTodayCards(groupId: string, userId: string): Promise<TodayCards> {
  const settings = await loadCardSettings().catch(() => DEFAULT_SETTINGS);
  if (dueForToday(settings.home, 1) === 0) return { ids: [], traps: new Set(), example: null, anki: true };
  const [lectures, lite, states, days, adoptions, mine] = await Promise.all([
    listLectures(groupId),
    listGroupCardsLite(groupId),
    myStatesAll(),
    myCardDays(groupId, 1).catch(() => []),
    myAdoptions(),
    listMyCards(),
  ]);
  const sc = scopeCards("today", lectures, lite, { adopted: new Set(adoptions.map((a) => partKey(a.lecture_id, a.part_idx))), userId, mine });
  if (!sc) return { ids: [], traps: new Set(), example: null, anki: false };
  const st = new Map(states);
  for (const m of mine) st.set(m.id, myCardState(m));
  const waiting = waitingReviews(userId);
  const merged = withWaiting(st, waiting);
  const now = Date.now();
  const day = studyDay(now);
  const todayIso = new Date(day * 86_400_000).toISOString().slice(0, 10);
  // First seen today: the database's count and this device's unsent first answers (CardReview's rule).
  const seen =
    days.filter((d) => String(d.day).slice(0, 10) === todayIso).reduce((n, d) => n + Number(d.first_seen), 0) +
    waiting.filter((r) => r.prevReps === 0 && studyDay(r.at) === day && !st.has(r.card)).length;
  const ids = buildQueue({ cards: sc.cards, states: merged, now, newLeft: newLeftToday(settings.new_per_day, seen, extraToday(userId, day)) }).ids;
  const traps = new Set(lite.filter((c) => c.source === "trap").map((c) => c.id));
  let example: TodayCards["example"] = null;
  if (ids.length) {
    const own = mine.find((m) => m.id === ids[0]);
    if (own) example = { front: own.front, slides: own.slides ?? [] };
    else {
      const [c] = await listCardsByIds([ids[0]]).catch(() => []);
      if (c) example = { front: c.front, slides: c.slides ?? [] };
    }
  }
  return { ids, traps, example, anki: false };
}

/** The database's and the cards' rows as queue items (the table's sources). */
export function todayItems(d: TodayData, cards: TodayCards | null): QueueItem[] {
  const out: QueueItem[] = [];
  for (const u of d.updates ?? [])
    out.push({ key: `update:${u.id}`, kind: "update", seconds: 0, at: u.created_at, example: u.lecture_title, ref: { update: u } });
  for (const q of d.quiz_returns ?? [])
    out.push({
      key: `quiz:${q.question_id}:${q.step}`,
      kind: "quiz",
      step: q.step === 2 ? 2 : 1,
      seconds: q.kind === "case" ? CASE_SECONDS : 0,
      at: q.wrong_at,
      example: q.question,
      slides: q.slides ?? [],
      ref: { question: q.question_id, ask: q.question_id, chosen: q.choice, fixed: q.fixed_in_discussion },
    });
  for (const x of d.danger ?? [])
    out.push({
      key: `danger:${x.question_id}`,
      kind: "danger",
      seconds: x.kind === "case" ? CASE_SECONDS : 0,
      at: x.wrong_at,
      example: x.question,
      slides: x.slides ?? [],
      otherWording: x.other_wording,
      ref: { question: x.question_id, ask: x.ask_id },
    });
  // H's loot (row 7, "מהקרב"): a battle's own mistakes, spread over three study days.
  for (const l of d.loot ?? [])
    out.push({
      key: `loot:${l.question_id}`,
      kind: "loot",
      seconds: l.kind === "case" ? CASE_SECONDS : 0,
      at: l.due_on,
      example: l.question ?? l.topic,
      slides: l.slides ?? [],
      ref: { question: l.question_id, loot: true },
    });
  for (const t of d.unclear ?? [])
    out.push({
      key: `unclear:${t.tap_id}`,
      kind: "unclear",
      seconds: 0,
      at: t.tapped_at,
      example: t.quote ? `${t.quote}${t.thread === "open" ? " · עוד פתוחה" : t.thread === "answered" ? " · נענתה" : ""}` : t.lecture_title,
      ref: { unclear: t },
    });
  if (cards)
    cards.ids.forEach((id, i) =>
      out.push({
        key: `card:${id}`,
        kind: "card",
        seconds: 0,
        // The session's own order: learning, review, then new (trap and private first).
        at: String(i).padStart(5, "0"),
        example: i === 0 ? cards.example?.front : undefined,
        slides: i === 0 ? cards.example?.slides : undefined,
        trap: cards.traps.has(id),
      }),
    );
  return out;
}

/* ── On the device ── */

/** The chosen minutes, per device ("study-today-minutes"). */
export function readMinutes(): Minutes {
  try {
    return asMinutes(localStorage.getItem(MINUTES_KEY));
  } catch {
    return asMinutes(null);
  }
}
export function saveMinutes(m: Minutes): void {
  try {
    localStorage.setItem(MINUTES_KEY, String(m));
  } catch {
    /* private mode: the chips still work on this screen */
  }
}

/** The day's queue as started: the items in order and where the session is. */
export type DayPlan = { minutes: Minutes; items: QueueItem[]; i: number };

export function readPlan(userId: string, now = Date.now()): DayPlan | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(dayKey(userId, studyDay(now))) ?? "null") as DayPlan | null;
    return p && Array.isArray(p.items) && typeof p.i === "number" ? p : null;
  } catch {
    return null;
  }
}
export function savePlan(userId: string, p: DayPlan, now = Date.now()): void {
  try {
    sessionStorage.setItem(dayKey(userId, studyDay(now)), JSON.stringify(p));
  } catch {
    /* private mode: the session lives on this screen only */
  }
}
export function dropPlan(userId: string, now = Date.now()): void {
  try {
    sessionStorage.removeItem(dayKey(userId, studyDay(now)));
  } catch {
    /* nothing kept */
  }
}
