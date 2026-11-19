import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { answer, DEFAULT_CONFIG, intervalLabel, NEW_CARD, preview, studyDay, type Rating } from "../../../shared/study/fsrs";
import { getLecture, listLectures, type Lecture, type LectureRow } from "../lib/api";
import {
  DEFAULT_SETTINGS,
  deleteCard,
  hideCard,
  listCardsByIds,
  listGroupCardsLite,
  loadCardSettings,
  myCardDays,
  myStatesAll,
  toWire,
  watchCards,
  type Card,
  type CardSettings,
} from "../lib/cards";
import {
  listMyCards,
  myAdoptions,
  myCardAsCard,
  myCardState,
  setMyCard,
} from "../lib/cardsDeck";
import { addExtraToday, extraToday, outboxFor, withWaiting, type Outbox } from "../lib/cardsOutbox";
import { scopeCards } from "../lib/cardsScope";
import { buildQueue, dueTomorrow, LEARN_AHEAD_MS, newBeyondLimit, newLeftToday, partKey, requeue, waitingLearning, type QCard, type QState } from "../lib/cardsQueue";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { isolateLatin } from "../lib/rich";
import type { Route } from "../lib/route";
import type { Ctx } from "../features/types";
import { CardBadge as TrapBadge, VaccineWhy } from "../features/pulse";
import { CardBackLine, CardHint } from "../features/wall";
import CardFace, { CardBadge, ORIGIN_WORDS } from "./CardFace";
import { CardEditSheet, ReviewHomeSheet, useHomeAsk } from "./CardSheets";
import CardSource from "./CardSource";
import { Icon } from "./Icon";
import { BackLink, Head, openSheets, RouteLink, StickyActions } from "./Shell";

const SlideSheet = lazy(() => import("./SlideSheet"));

/* ── K4 and K5: a review session (?v=cards&s=…; design-cards §1.3, §4.4) ──
 * The queue (cardsQueue.ts) over the scope's cards: today (every lecture),
 * l.<lecture> or c.<course>. Each answer is scheduled on the phone (FSRS-6,
 * shared/study/fsrs.ts), shown at once, and sent through the outbox, so
 * leaving (✕, Back, closing the app) or losing the connection loses nothing;
 * the session itself is kept in sessionStorage, so the reader at a slide and
 * Back return to the same card. Four buttons right to left (שוב קשה טוב קל)
 * with the next interval under each, in the sticky bar at the bottom; a
 * swipe answers toward a button's side (right שוב, left טוב), never from
 * within 24 px of the screen's edges (the system's back gesture, review
 * UX-27); keys Space/Enter, 1-4, Ctrl/⌘+Z. A card fixed or deleted by someone
 * meanwhile changes in place or leaves.
 *
 * C's end, as the approved review screen has it (cards.html s1, s2): the
 * top bar "כרטיסיות להיום" with the session's count, "לוח החזרות שלך, בקצב
 * שלך · רק לך"; on the card, its one chip (the group's deck, a trap card, or
 * a private card and where it came from) and when it was last seen;
 * "מאיפה זה?" with the card's paragraph under the answer; the next private
 * card announced ("הבא בתור · מטעות שלך"); and what is left, in minutes, with
 * tomorrow's count. The deck's rules (decision 8): new cards only from the
 * member's deck, trap and private cards first among them, a card a
 * correction marked out of review until "עדיין נכון". */

type Phase = "loading" | "front" | "back" | "gone" | "done" | "empty" | "error";
type Answered = { reviewId: string; cardId: string; prev: QState | null; rating: Rating; at: number; ms: number };
type Stats = { answers: number; again: number; ms: number };
type Saved = { day: number; at: number; queue: string[]; answered: Answered[]; stats: Stats };

const RATINGS: Array<{ g: Rating; word: string; cls: string }> = [
  { g: 1, word: "שוב", cls: "again" },
  { g: 2, word: "קשה", cls: "hard" },
  { g: 3, word: "טוב", cls: "good" },
  { g: 4, word: "קל", cls: "easy" },
];
const EDGE = 24;
const HINT_KEY = "study-cards-swipe-hint";
const errText = (e: unknown) => failText(e instanceof Error ? e.message : String(e ?? ""), "cards");

/** "10 דקות", "יומיים", "8 ימים": the interval in words, for a button's aria-label. */
export function intervalWords(fromMs: number, dueMs: number): string {
  const min = Math.max(1, Math.round((dueMs - fromMs) / 60_000));
  const word = (n: number, one: string, two: string, many: string) => (n === 1 ? one : n === 2 ? two : `${n} ${many}`);
  if (min < 60) return word(min, "דקה", "שתי דקות", "דקות");
  if (min < 1440) return word(Math.round(min / 60), "שעה", "שעתיים", "שעות");
  const days = Math.round(min / 1440);
  if (days < 30) return word(days, "יום", "יומיים", "ימים");
  if (days < 365) return word(Math.round(days / 30), "חודש", "חודשיים", "חודשים");
  const years = Number((days / 365).toFixed(1));
  return years === 1 ? "שנה" : years === 2 ? "שנתיים" : `${years} שנים`;
}

const sessionKey = (userId: string, scope: string) => `study-session:${userId}:cards.${scope}`;
function readSaved(key: string): Saved | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null") as Saved | null;
  } catch {
    return null;
  }
}
function writeSaved(key: string, s: Saved | null): void {
  try {
    if (s) sessionStorage.setItem(key, JSON.stringify(s));
    else sessionStorage.removeItem(key);
  } catch {
    /* private mode: the session lives on this screen only */
  }
}
function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}
function markHint(): void {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* private mode */
  }
}

/** "כדקה", "כ-2 דקות", "כ-6 דקות": the rest of a session at about 30 s a card. */
function aboutMinutes(cards: number): string {
  const min = Math.max(1, Math.round(cards / 2));
  return min === 1 ? "כדקה" : `כ-${min} דקות`;
}

/** "ראית אתמול", "ראית לפני 3 ימים", "חדש": when the member last saw the card. */
function seenWords(s: QState | undefined, now: number): string {
  if (!s || s.state === 0 || s.lastReview === null) return "חדש";
  const days = studyDay(now) - studyDay(s.lastReview);
  return days <= 0 ? "ראית היום" : days === 1 ? "ראית אתמול" : days === 2 ? "ראית שלשום" : `ראית לפני ${days} ימים`;
}

export default function CardReview({ scope, ctx, limit, onEnd }: { scope: string; ctx: Ctx; limit?: number; onEnd?: () => void }) {
  // Inside Today's session (T-1): at most `limit` cards, then onEnd (its own kept session).
  const key = sessionKey(ctx.userId, onEnd ? `${scope}.run` : scope);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [lectures, setLectures] = useState<LectureRow[]>([]);
  const [scopeQ, setScopeQ] = useState<QCard[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [states, setStates] = useState<Map<string, QState>>(new Map());
  const [contents, setContents] = useState<Map<string, Card>>(new Map());
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [stats, setStats] = useState<Stats>({ answers: 0, again: 0, ms: 0 });
  const [settings, setSettings] = useState<CardSettings>(DEFAULT_SETTINGS);
  const [firstSeen, setFirstSeen] = useState(0);
  const [extra, setExtra] = useState(0);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [revealAt, setRevealAt] = useState(() => Date.now());
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const [slide, setSlide] = useState<number | null>(null);
  const [lecturesFull, setLecturesFull] = useState<Map<string, Lecture>>(new Map());
  const [figs, setFigs] = useState<Record<string, string>>({});
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [pending, setPending] = useState(0);
  const [dx, setDx] = useState(0);
  const [settle, setSettle] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [ended, setEnded] = useState(false);
  const [waitTimer, setWaitTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  /** Private cards in this session (C's end): their answers and menu are their own. */
  const [mineIds, setMineIds] = useState<Set<string>>(new Set());
  const homeAsk = useHomeAsk(settings, phase !== "loading" && phase !== "error");
  const goodRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const box = useRef<Outbox | null>(null);
  const live = useRef({ queue, states, answered, stats, settings, phase, mineIds });
  live.current = { queue, states, answered, stats, settings, phase, mineIds };

  const multi = scope === "today" || scope.startsWith("c.");
  const current = queue[0];
  const card = current ? contents.get(current) : undefined;
  const retention = settings.retention;

  /* ── the outbox ── */
  useEffect(() => {
    const b = outboxFor(ctx.userId, {
      retention: () => live.current.settings.retention,
      onDrop: (n) => {
        if (n.code === "stale") ctx.say(failText("stale", "cards"));
        else if (n.code === "unsaved") ctx.say("התשובה לא נשמרה. כדאי לבדוק את החיבור.");
      },
    });
    box.current = b;
    setPending(b.pending());
    const off = b.subscribe(setPending);
    const on = () => setOffline(false);
    const offl = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", offl);
    void b.flush();
    return () => {
      off();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", offl);
    };
  }, [ctx.userId, ctx.say]);

  /* ── loading: the scope, the member's states, settings and today's first-seen count ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      const [ls, lite, st0, conf, days, adoptions, mine] = await Promise.all([
        listLectures(ctx.group.id),
        listGroupCardsLite(ctx.group.id),
        myStatesAll(),
        loadCardSettings().catch(() => DEFAULT_SETTINGS),
        myCardDays(ctx.group.id, 1).catch(() => []),
        myAdoptions(),
        listMyCards(),
      ]);
      if (!alive) return;
      const sc = scopeCards(scope, ls, lite, { adopted: new Set(adoptions.map((a) => partKey(a.lecture_id, a.part_idx))), userId: ctx.userId, mine });
      // A private card's memory is on its own row; its contents are here already.
      const st = new Map(st0);
      for (const m of mine) st.set(m.id, myCardState(m));
      setMineIds(new Set(mine.map((m) => m.id)));
      setContents((cur) => {
        const next = new Map(cur);
        for (const m of mine) next.set(m.id, myCardAsCard(m, ctx.group.id));
        return next;
      });
      if (!sc) {
        setPhase("empty");
        return;
      }
      const now = Date.now();
      const day = studyDay(now);
      const waiting = box.current?.list() ?? [];
      const merged = withWaiting(st, waiting);
      const todayIso = new Date(day * 86_400_000).toISOString().slice(0, 10);
      const seen =
        days.filter((d) => String(d.day).slice(0, 10) === todayIso).reduce((n, d) => n + Number(d.first_seen), 0) +
        waiting.filter((r) => r.prevReps === 0 && studyDay(r.at) === day && !st.has(r.card)).length;
      const ext = extraToday(ctx.userId, day);
      const saved = readSaved(key);
      const alive2 = new Set(sc.cards.filter((c) => !c.deleted && !merged.get(c.id)?.suspended).map((c) => c.id));
      let q: string[];
      let ans: Answered[] = [];
      let sts: Stats = { answers: 0, again: 0, ms: 0 };
      if (saved && saved.day === day && now - saved.at < 2 * 3_600_000 && saved.queue.some((id) => alive2.has(id))) {
        // Back from the reader, or a reload: the same session, at the same card.
        q = saved.queue.filter((id) => alive2.has(id));
        ans = saved.answered;
        sts = saved.stats;
      } else {
        q = buildQueue({ cards: sc.cards, states: merged, now, newLeft: newLeftToday(conf.new_per_day, seen, ext) }).ids;
        if (limit !== undefined) q = q.slice(0, Math.max(0, limit));
      }
      setLectures(ls);
      setScopeQ(sc.cards);
      setStates(merged);
      setSettings(conf);
      setFirstSeen(seen);
      setExtra(ext);
      setQueue(q);
      setAnswered(ans);
      setStats(sts);
      setShownAt(Date.now());
      setPhase(q.length ? "front" : sc.cards.length || onEnd ? "done" : "empty");
    })().catch((e) => {
      if (!alive) return;
      setError(errText(e));
      setPhase("error");
    });
    return () => {
      alive = false;
    };
    // Once per scope.
  }, [scope, ctx.group.id, ctx.userId, key]);

  /* ── the session, kept for Back and reloads; an ended one is not resumed ── */
  useEffect(() => {
    if (phase === "front" || phase === "back" || phase === "gone") writeSaved(key, { day: studyDay(Date.now()), at: Date.now(), queue, answered, stats });
    else if (phase === "done") writeSaved(key, null);
  }, [key, phase, queue, answered, stats]);

  /* ── card contents: the next 20, ahead of the session ── */
  useEffect(() => {
    const want = [...new Set(queue.slice(0, 20))].filter((id) => !contents.has(id));
    if (!want.length) return;
    let alive = true;
    listCardsByIds(want)
      .then((cs) => {
        if (!alive) return;
        setContents((cur) => {
          const next = new Map(cur);
          for (const c of cs) next.set(c.id, c);
          return next;
        });
        // A card deleted before the session loaded it leaves the queue.
        const gone = new Set(cs.filter((c) => c.deleted_at).map((c) => c.id));
        const missing = want.filter((id) => !cs.some((c) => c.id === id));
        for (const id of missing) gone.add(id);
        if (gone.size) setQueue((q) => q.filter((id) => !gone.has(id)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [queue, contents]);

  /* ── the lecture of the current card (its pictures, its slides) ── */
  const lectureOf = useCallback(
    async (id: string) => {
      const have = lecturesFull.get(id);
      if (have) return have;
      const l = await getLecture(id);
      if (l) setLecturesFull((m) => new Map(m).set(id, l));
      return l;
    },
    [lecturesFull],
  );
  useEffect(() => {
    if (!card || phase !== "back" || !card.figure) return;
    let alive = true;
    void lectureOf(card.lecture_id)
      .then(async (l) => {
        const m = /^fig:(\d+)-(\d+)$/.exec(card.figure);
        const path = m ? l?.slides.find((s) => s.n === Number(m[1]))?.figures?.find((f) => f.k === Number(m[2]))?.path : undefined;
        if (!path || figs[`${card.lecture_id}:${card.figure}`]) return;
        const { figureUrls } = await import("../lib/api");
        const u = await figureUrls([path]);
        if (alive && u[path]) setFigs((f) => ({ ...f, [`${card.lecture_id}:${card.figure}`]: u[path] }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [card, phase, lectureOf, figs]);

  /* ── someone fixed or deleted a card meanwhile ── */
  useEffect(() => {
    const scopeArg = scope.startsWith("l.") ? { lectureId: scope.slice(2) } : { groupId: ctx.group.id };
    return watchCards(scopeArg, (table, row) => {
      if (table !== "study_cards" || typeof row.id !== "string") return;
      const c = row as unknown as Card;
      if (c.deleted_at) {
        const { queue: q, phase: p } = live.current;
        if (q[0] === c.id && (p === "front" || p === "back")) setPhase("gone");
        else setQueue((cur) => cur.filter((id) => id !== c.id));
      } else {
        setContents((cur) => (cur.has(c.id) ? new Map(cur).set(c.id, c) : cur));
      }
    });
  }, [scope, ctx.group.id]);

  /* ── answering ── */
  const show = useCallback(() => {
    if (live.current.phase !== "front") return;
    setPhase("back");
    setRevealAt(Date.now());
    setShowHint(!hintSeen());
  }, []);

  const next = useCallback((q: string[]) => {
    setQueue(q);
    setDx(0);
    setSettle(false);
    setMenu(false);
    setShownAt(Date.now());
    setPhase(q.length ? "front" : "done");
  }, []);

  const rate = useCallback(
    (g: Rating) => {
      const { queue: q, states: st, phase: p, settings: conf } = live.current;
      if (p !== "back" || !q[0]) return;
      const id = q[0];
      const now = Date.now();
      const prev = st.get(id) ?? null;
      const base = prev ?? { ...NEW_CARD, suspended: false };
      const o = answer(base, now, g, id, { ...DEFAULT_CONFIG, retention: conf.retention });
      const ms = Math.min(Math.max(0, now - shownAt), 3_600_000);
      const reviewId = crypto.randomUUID();
      setStates((cur) => new Map(cur).set(id, { ...o.card, suspended: base.suspended }));
      setAnswered((a) => [...a, { reviewId, cardId: id, prev, rating: g, at: now, ms }]);
      setStats((s) => ({ answers: s.answers + 1, again: s.again + (g === 1 ? 1 : 0), ms: s.ms + ms }));
      if (!hintSeen()) markHint();
      setShowHint(false);
      void box.current?.enqueue({ id: reviewId, card: id, rating: g, at: now, ms, prevReps: base.reps, next: toWire(o.card), ...(live.current.mineIds.has(id) ? { mine: true as const } : {}) });
      next(requeue(q.slice(1), id, g, o.card, now));
    },
    [shownAt, next],
  );

  const undo = useCallback(async () => {
    const last = live.current.answered[live.current.answered.length - 1];
    if (!last || !box.current) return;
    try {
      await box.current.takeBack(last.reviewId);
    } catch (e) {
      ctx.say(errText(e));
      return;
    }
    setAnswered((a) => a.slice(0, -1));
    setStats((s) => ({ answers: Math.max(0, s.answers - 1), again: Math.max(0, s.again - (last.rating === 1 ? 1 : 0)), ms: Math.max(0, s.ms - last.ms) }));
    setStates((cur) => {
      const n = new Map(cur);
      if (last.prev) n.set(last.cardId, last.prev);
      else n.delete(last.cardId);
      return n;
    });
    setEnded(false);
    next([last.cardId, ...live.current.queue.filter((id) => id !== last.cardId)]);
    ctx.say("התשובה בוטלה.");
  }, [ctx, next]);

  /* ── keys (a laptop): Space/Enter shows, then 1-4 or Space/Enter for טוב; Ctrl/⌘+Z undoes ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (openSheets().length || editing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const p = live.current.phase;
      // Space or Enter on another control (✕, ⋯, a rating) does what that control does.
      const other = Boolean(t && t.closest("button, a") && t !== showRef.current && t !== goodRef.current);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void undo();
      } else if (p === "front" && (e.key === " " || e.key === "Enter") && !other) {
        e.preventDefault();
        show();
      } else if (p === "back" && ["1", "2", "3", "4"].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        rate(Number(e.key) as Rating);
      } else if (p === "back" && (e.key === " " || e.key === "Enter") && !other) {
        e.preventDefault();
        rate(3);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, rate, undo, editing]);

  // Focus: "הצגת התשובה" before, "טוב" after (design-cards K4).
  useEffect(() => {
    if (phase === "back") goodRef.current?.focus({ preventScroll: true });
    if (phase === "front") showRef.current?.focus({ preventScroll: true });
  }, [phase, current]);

  /* ── the swipe ── */
  const drag = useRef<{ id: number; x0: number; y0: number; on: boolean; off: boolean; samples: Array<[number, number]> } | null>(null);
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The whole card area takes the swipe (the card follows the finger), edge to edge of the screen.
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "back" || e.button > 0) return;
    // The system's back gesture owns the screen's edges (review UX-27).
    if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, off: false, samples: [[e.timeStamp, e.clientX]] };
    setSettle(false);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.off || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x0;
    const my = e.clientY - d.y0;
    if (!d.on) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > 1.5 * Math.abs(my)) {
        d.on = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } else if (Math.abs(my) > 8) {
        d.off = true; // a vertical move scrolls; it never answers
        return;
      } else return;
    }
    d.samples.push([e.timeStamp, e.clientX]);
    if (d.samples.length > 12) d.samples.shift();
    setDx(mx);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.on) return;
    const width = panelRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const mx = e.clientX - d.x0;
    // The speed over the last 100 ms: a flick, not a slow drag that stopped.
    const recent = d.samples.filter(([t]) => t >= e.timeStamp - 100);
    const [t0, x0] = recent[0] ?? [e.timeStamp, e.clientX];
    const v = e.timeStamp > t0 ? Math.abs(e.clientX - x0) / (e.timeStamp - t0) : 0;
    if (Math.abs(mx) > 0.3 * width || v > 0.5) rate(mx > 0 ? 1 : 3);
    else {
      setSettle(true);
      setDx(0);
    }
  };
  const onCancel = () => {
    drag.current = null;
    setSettle(true);
    setDx(0);
  };

  /* ── the ⋯ menu ── */
  const hideCurrent = async () => {
    setMenu(false);
    if (!current) return;
    try {
      await (mineIds.has(current) ? setMyCard(current, "hide") : hideCard(current, true));
      setStates((cur) => {
        const s = cur.get(current);
        return new Map(cur).set(current, s ? { ...s, suspended: true } : { ...NEW_CARD, suspended: true });
      });
      next(live.current.queue.filter((id) => id !== current));
    } catch (e) {
      ctx.say(errText(e));
    }
  };
  const deleteCurrent = async () => {
    setMenu(false);
    const id = current;
    if (!id) return;
    if (mineIds.has(id)) {
      // A private card is hers alone: it goes from her cards, with "ביטול".
      try {
        await setMyCard(id, "delete");
        next(live.current.queue.filter((x) => x !== id));
        ctx.say("הכרטיסייה הפרטית נמחקה.", {
          label: "ביטול",
          run: () =>
            void setMyCard(id, "restore")
              .then(() => next([id, ...live.current.queue.filter((x) => x !== id)]))
              .catch((e) => ctx.say(errText(e))),
        });
      } catch (e) {
        ctx.say(errText(e));
      }
      return;
    }
    try {
      await deleteCard(id, true);
      next(live.current.queue.filter((x) => x !== id));
      ctx.say("הכרטיסייה נמחקה לכל הקבוצה.", {
        label: "ביטול",
        run: () =>
          void deleteCard(id, false)
            .then(() => next([id, ...live.current.queue.filter((x) => x !== id)]))
            .catch((e) => ctx.say(errText(e))),
      });
    } catch (e) {
      ctx.say(errText(e));
    }
  };
  const editCurrent = async () => {
    setMenu(false);
    if (!card) return;
    await lectureOf(card.lecture_id).catch(() => null);
    setEditing(card);
  };

  /* ── Today's session: the cut's cards are done, its next step (T-1) ── */
  const ended1 = useRef(false);
  useEffect(() => {
    if (phase !== "done" || !onEnd || ended1.current) return;
    ended1.current = true;
    onEnd();
  }, [phase, onEnd]);

  /* ── The wall's hint after two own lapses (J-2): the sub-line says why (cards.html s2) ── */
  const [hinted, setHinted] = useState(false);
  useEffect(() => {
    const el = panelRef.current;
    if (!el || phase === "loading") {
      setHinted(false);
      return;
    }
    const look = () => setHinted(Boolean(el.querySelector(".wall-hint")));
    look();
    const mo = new MutationObserver(look);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
    // The panel is drawn once the card's contents are here.
  }, [current, phase, Boolean(card)]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── K5's numbers ── */
  const now = Date.now();
  const end = useMemo(() => {
    if (phase !== "done") return null;
    const t = Date.now();
    const queued = new Set(queue);
    return {
      tomorrow: dueTomorrow(scopeQ, states, t),
      waiting: waitingLearning(scopeQ, states, queued, t),
      beyond: newBeyondLimit(scopeQ, states, queued),
      newLeft: newLeftToday(settings.new_per_day, firstSeen + answered.filter((a) => !a.prev || a.prev.state === 0).filter((a, i, all) => all.findIndex((x) => x.cardId === a.cardId) === i).length, extra),
    };
  }, [phase, queue, scopeQ, states, settings, firstSeen, answered, extra]);

  const learnAhead = () => {
    if (!end) return;
    const t = Date.now();
    const queued = new Set(queue);
    const waitingIds = scopeQ
      .filter((c) => !c.deleted && !queued.has(c.id))
      .map((c) => ({ id: c.id, s: states.get(c.id) }))
      .filter((x) => x.s && !x.s.suspended && (x.s.state === 1 || x.s.state === 3) && x.s.due > t)
      .sort((a, b) => a.s!.due - b.s!.due);
    if (!waitingIds.length) return;
    const first = waitingIds[0].s!.due;
    const resume = () => {
      setWaitTimer(null);
      setEnded(false);
      next(waitingIds.map((x) => x.id));
    };
    // Within the learn-ahead limit they are shown at once, as Anki does; otherwise when the first is due.
    if (first - t <= LEARN_AHEAD_MS) resume();
    else setWaitTimer(setTimeout(resume, first - t));
  };
  useEffect(() => () => void (waitTimer && clearTimeout(waitTimer)), [waitTimer]);

  const moreNew = () => {
    const day = studyDay(Date.now());
    const ext = addExtraToday(ctx.userId, day, 10, extra);
    setExtra(ext);
    const queued = new Set(queue);
    // New only from her deck (C's end), trap and private cards first.
    const fresh = scopeQ
      .filter((c) => !c.deleted && !queued.has(c.id) && c.newOk !== false && (!states.get(c.id) || (states.get(c.id)!.state === 0 && !states.get(c.id)!.suspended)))
      .sort((a, b) => Number(Boolean(b.first)) - Number(Boolean(a.first)) || a.order - b.order);
    const take = fresh.slice(0, 10).map((c) => c.id);
    if (take.length) {
      setEnded(false);
      next(take);
    }
  };

  const backTo = scope.startsWith("l.") ? { v: "cards" as const, l: scope.slice(2) } : { v: "cards" as const };
  // cards.html s1: "→ להיום" once Today is the home (and always from Today's session).
  const backFallback: Route = onEnd || (flags.today && scope === "today") ? { v: "today" } : backTo;
  const lectureTitle = (id: string) => lectures.find((l) => l.id === id)?.title ?? "";
  const minutes = Math.max(stats.answers ? 1 : 0, Math.round(stats.ms / 60_000));

  /* ── rendering ── */
  if (phase === "loading")
    return (
      <main className="cards review">
        <p className="a-muted loading">טוען…</p>
      </main>
    );
  if (phase === "error" || phase === "empty")
    return (
      <main className="cards review">
        <Head back={<BackLink go={ctx.go} fallback={backFallback} />} />
        <p className={phase === "error" ? "a-error" : "a-muted"} role={phase === "error" ? "alert" : undefined}>
          {phase === "error" ? error : "עוד אין כרטיסיות. בכל הרצאה אפשר ליצור כרטיסיות מהשקפים: עובדה אחת בכל כרטיסייה, לחזרה של כמה דקות ביום."}
        </p>
      </main>
    );

  // In Today's session the end is Today's next step (onEnd above), not this screen.
  if (phase === "done" && onEnd)
    return (
      <main className="cards review">
        <p className="a-muted loading">טוען…</p>
      </main>
    );
  if (phase === "done" && end) {
    const nothingLeft = end.waiting.count === 0 && !(end.beyond > 0 && end.newLeft === 0) && !ended;
    return (
      <main className="cards review">
        <section className="a-card review-end" aria-live="polite">
          <h1 className="a-h1">{nothingLeft ? "סיום להיום" : "סיום החזרה"}</h1>
          {stats.answers ? (
            <p>
              {stats.answers} כרטיסיות · {stats.answers - stats.again} נזכרו · {stats.again} ״שוב״ · {minutes} דק׳
            </p>
          ) : null}
          <p className="a-small a-muted">גלוי רק לך.</p>
          <p>מחר: {end.tomorrow} לחזרה.</p>
          {end.waiting.count > 0 && end.waiting.firstDue !== null ? (
            <>
              <p>
                עוד {end.waiting.count} כרטיסיות בלמידה חוזרות בעוד {Math.max(1, Math.ceil((end.waiting.firstDue - now) / 60_000))} דק׳.
              </p>
              <div className="a-row">
                <button className="a-btn primary" disabled={waitTimer !== null} onClick={learnAhead}>
                  לחכות כאן
                </button>
                <RouteLink to={backTo} go={ctx.go} className="a-btn">
                  סיום
                </RouteLink>
              </div>
            </>
          ) : null}
          {end.beyond > 0 && end.newLeft === 0 ? (
            <>
              <p>
                נשארו {end.beyond} חדשות. המגבלה היא {settings.new_per_day} חדשות ביום.
              </p>
              <div className="a-row">
                <button className="a-btn" onClick={moreNew}>
                  עוד 10 חדשות להיום
                </button>
              </div>
            </>
          ) : null}
          <div className="a-row">
            <RouteLink to={backTo} go={ctx.go} className="a-btn">
              חזרה לכרטיסיות
            </RouteLink>
            {flags.today ? (
              <RouteLink to={{ v: "today" }} go={ctx.go} className="a-btn ghost">
                להיום
              </RouteLink>
            ) : (
              <RouteLink to={{ v: "library" }} go={ctx.go} className="a-btn ghost">
                לספרייה
              </RouteLink>
            )}
          </div>
        </section>
      </main>
    );
  }

  const prev = current ? (states.get(current) ?? { ...NEW_CARD, suspended: false }) : null;
  const p = prev && phase === "back" ? preview(prev, revealAt, current!, { ...DEFAULT_CONFIG, retention }) : null;
  const total = stats.answers + queue.length;
  const swipeWord = dx > 20 ? "שוב" : dx < -20 ? "טוב" : "";
  const scopeTitle = scope.startsWith("l.") ? lectureTitle(scope.slice(2)) : scope.startsWith("c.") ? scope.slice(2) : "";
  const left = Math.max(0, queue.length - (phase === "gone" ? 0 : 1));
  const tomorrowN = dueTomorrow(scopeQ, states, now);
  // The next card, announced when it is one of her own mistakes (cards.html s2).
  const nextMine = queue[1] && queue[1] !== current && mineIds.has(queue[1]) ? contents.get(queue[1]) : undefined;
  const lapses = current ? (states.get(current)?.lapses ?? 0) : 0;

  return (
    <main className="cards review">
      <div className="ph-top review-top">
        <Head
          back={<BackLink go={ctx.go} fallback={backFallback} />}
          title={scopeTitle ? "כרטיסיות" : "כרטיסיות להיום"}
        >
          <div className="a-row review-tools">
            <span className="a-chip busy review-progress" aria-label={`${stats.answers} מתוך ${total}`}>
              {stats.answers}/{total}
            </span>
            {answered.length ? (
              <button type="button" className="a-btn ghost icon" aria-label="ביטול התשובה האחרונה" onClick={() => void undo()}>
                ↶
              </button>
            ) : null}
            <div className="review-menu">
              <button type="button" className="a-btn ghost icon" aria-label="עוד פעולות" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                ⋯
              </button>
              {menu ? (
                <ul>
                  {card && card.source !== "mine" ? (
                    <li>
                      <button onClick={() => void editCurrent()}>עריכת הכרטיסייה</button>
                    </li>
                  ) : null}
                  {card ? (
                    <li>
                      <button onClick={() => void hideCurrent()}>להסתיר ממני</button>
                    </li>
                  ) : null}
                  {card ? (
                    <li>
                      <button className="danger-text" onClick={() => void deleteCurrent()}>
                        {card.source === "mine" ? "למחוק את הכרטיסייה הפרטית" : "מחיקה לכל הקבוצה"}
                      </button>
                    </li>
                  ) : null}
                  {card && card.slides.length ? (
                    <li>
                      <RouteLink to={{ v: "lecture", l: card.lecture_id, slide: card.slides[0] }} go={ctx.go}>
                        לקריאה בסיכום
                      </RouteLink>
                    </li>
                  ) : null}
                  <li>
                    <button onClick={() => (setMenu(false), setEnded(true), setPhase("done"))}>סיום החזרה</button>
                  </li>
                </ul>
              ) : null}
            </div>
          </div>
        </Head>
        <p className="ph-sub">
          {scopeTitle ? (
            <>
              <bdi className="review-scope">{isolateLatin(scopeTitle, "st")}</bdi>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span>
            {hinted && lapses >= 2
              ? lapses === 2
                ? "שכחת את הכרטיסייה הזו פעמיים, אז מגיע רמז"
                : `שכחת את הכרטיסייה הזו ${lapses} פעמים, אז מגיע רמז`
              : "לוח החזרות שלך, בקצב שלך"}
          </span>
          <span className="a-chip">רק לך</span>
        </p>
        <div className="a-bar review-bar" role="progressbar" aria-label="התקדמות" aria-valuemin={0} aria-valuemax={total} aria-valuenow={stats.answers}>
          <i style={{ width: `${total ? (100 * stats.answers) / total : 0}%` }} />
        </div>
        {offline ? (
          <p className="a-callout warn offline-line" role="status">
            <span>אין חיבור. התשובות נשמרות במכשיר ויישלחו כשהחיבור יחזור.</span>
            {pending ? <span className="a-chip">{pending} ממתינות לשליחה</span> : null}
          </p>
        ) : null}
      </div>

      <div className="card-stage swipe-area" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
        {phase === "gone" ? (
          <div className="a-flash card-panel card-gone" role="region" aria-live="polite">
            <p>הכרטיסייה נמחקה עכשיו לכל הקבוצה.</p>
          </div>
        ) : card ? (
          <div
            ref={panelRef}
            className={`a-flash card-panel${phase === "front" ? " front-side" : ""}${dx ? " dragging" : ""}${settle ? " settle" : ""}`}
            role="region"
            aria-live="polite"
            aria-label="כרטיסייה"
            style={dx ? { transform: `translateX(${dx}px)${reduced ? "" : ` rotate(${dx * 0.03}deg)`}` } : undefined}
            onClick={() => phase === "front" && show()}
          >
            {swipeWord ? (
              <span className={`card-swipe-label ${dx > 0 ? "again" : "good"}`} style={{ opacity: Math.min(1, Math.abs(dx) / 120) }}>
                {swipeWord}
              </span>
            ) : null}
            <CardFace
              card={card}
              revealed={phase === "back"}
              lectureTitle={multi ? lectureTitle(card.lecture_id) : undefined}
              figureUrl={(f) => figs[`${card.lecture_id}:${f}`]}
              nameOf={ctx.nameOf}
              onSlide={(n) => void lectureOf(card.lecture_id).then(() => setSlide(n))}
              go={ctx.go}
              top={
                <div className="a-row between card-top">
                  {/* U-3: a trap card's one chip says whether it is a museum exhibit's vaccine */}
                  {card.source === "trap" && flags.museum ? <TrapBadge ctx={ctx} cardId={card.id} /> : <CardBadge card={card} />}
                  {lapses >= 2 ? <span className="a-chip bad">{lapses === 2 ? "נשכח פעמיים" : `נשכח ${lapses} פעמים`}</span> : <span className="a-small a-muted">{seenWords(states.get(card.id), now)}</span>}
                </div>
              }
            />
            {/* J-2: after two own lapses, the wall's hint (cards.html s2). */}
            <CardHint ctx={ctx} cardId={card.id} lapses={lapses} />
            {card.source === "trap" && phase === "back" ? <VaccineWhy ctx={ctx} cardId={card.id} /> : null}
          </div>
        ) : (
          <p className="a-muted loading">טוען…</p>
        )}
        {phase === "back" && showHint ? (
          <div>
            <p className="hint-line">אפשר גם להחליק: ימינה ״שוב״, שמאלה ״טוב״.</p>
            <p className="hint-line">״קשה״ זה נזכרתי, במאמץ. לא נזכרתי: ״שוב״.</p>
          </div>
        ) : null}
      </div>

      {/* Under the card, outside the swipe: "מאיפה זה?", the next private card, what is left. */}
      <div className="a-stack review-below">
        {phase === "back" && card ? <CardSource card={card} go={ctx.go} topic /> : null}
        {phase === "back" && card ? <CardBackLine lectureId={card.lecture_id} cardId={card.id} /> : null}
        {nextMine ? (
          <section className="a-card flat next-mine" aria-label="הבא בתור">
            <div className="a-row between">
              <span className="a-small a-muted">הבא בתור · מטעות שלך</span>
              {nextMine.origin ? <span className="a-chip group">{ORIGIN_WORDS[nextMine.origin]}</span> : null}
            </div>
            <b dir="rtl">{isolateLatin(nextMine.front, `nm${nextMine.id}`)}</b>
            {nextMine.extra ? (
              <p className="a-small a-muted" dir="rtl">
                {isolateLatin(nextMine.extra, `nx${nextMine.id}`)}
              </p>
            ) : null}
          </section>
        ) : null}
        <p className="a-row a-small a-muted review-left">
          <Icon name="clock" size={14} />
          <span>
            {left ? `נשארו עוד ${left}, ${aboutMinutes(left)}.` : "זו הכרטיסייה האחרונה בסבב."} מחר: {tomorrowN === 1 ? "כרטיסייה אחת" : `${tomorrowN} כרטיסיות`}.
          </span>
        </p>
      </div>

      <StickyActions>
        {phase === "gone" ? (
          <button className="a-btn primary wide" onClick={() => next(queue.slice(1))}>
            לכרטיסייה הבאה
          </button>
        ) : phase === "back" && p ? (
          <div className="a-grade card-buttons" role="group" aria-label="כמה זכרת?">
            {RATINGS.map((r) => (
              <button
                key={r.g}
                ref={r.g === 3 ? goodRef : undefined}
                type="button"
                className={`card-btn ${r.cls}`}
                aria-label={`${r.word}: הכרטיסייה תחזור בעוד ${intervalWords(revealAt, p[r.g].card.due)}`}
                onClick={() => rate(r.g)}
              >
                <span>{r.word}</span>
                <span className="ivl">{intervalLabel(revealAt, p[r.g].card.due)}</span>
              </button>
            ))}
          </div>
        ) : (
          <button ref={showRef} className="a-btn primary wide" disabled={!card} onClick={show}>
            להציג תשובה
          </button>
        )}
      </StickyActions>

      {editing && lecturesFull.get(editing.lecture_id) ? (
        <CardEditSheet
          lecture={lecturesFull.get(editing.lecture_id)!}
          card={editing}
          say={ctx.say}
          onClose={() => setEditing(null)}
          onSaved={(id) =>
            void listCardsByIds([id])
              .then(([c]) => c && setContents((cur) => new Map(cur).set(c.id, c)))
              .catch(() => undefined)
          }
        />
      ) : null}
      {homeAsk.open ? <ReviewHomeSheet settings={settings} onSaved={(s) => setSettings(s)} onClose={homeAsk.close} say={ctx.say} /> : null}
      {slide !== null && card && lecturesFull.get(card.lecture_id) ? (
        <Suspense fallback={null}>
          <SlideSheet lecture={lecturesFull.get(card.lecture_id)!} slide={slide} go={ctx.go} onClose={() => setSlide(null)} />
        </Suspense>
      ) : null}
    </main>
  );
}
