import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Loading, RouteLink } from "../components/Shell";
import { listLectures, type LectureRow } from "../lib/api";
import { DEFAULT_SETTINGS, loadCardSettings, myCardCounts, myCardDays, saveCardSettings, watchCards, type CardCounts, type CardSettings, type ReviewHome } from "../lib/cards";
import { studyDay } from "../../../shared/study/day";
import { flags } from "../lib/flags";
import type { Ctx, ScreenProps } from "./types";
import "../styles/cards.css";

/* ── Package C's slot (spec §5.3; §12.2.3): flashcards ──
 * The screens load lazily (each in its own chunk; the Anki exporter and
 * sql.js only on "ייצוא"): the cards of the day (K1), a lecture's deck (K2)
 * and a review session (K4, K5). The library's chip and the practice hub's
 * card stay here, small. Hooks check their own flag. */

const CardsToday = lazy(() => import("../components/CardsToday"));
const LectureCards = lazy(() => import("../components/LectureCards"));
const CardReview = lazy(() => import("../components/CardReview"));
const AnkiExportSheet = lazy(() => import("../components/CardSheets").then((m) => ({ default: m.AnkiExportSheet })));

export function CardsScreen({ route, ctx }: ScreenProps<"cards">) {
  return (
    <Suspense fallback={<Loading />}>
      {route.s ? (
        <CardReview key={route.s} scope={route.s} ctx={ctx} />
      ) : route.l ? (
        <LectureCards key={route.l} lectureId={route.l} ctx={ctx} />
      ) : (
        <CardsToday ctx={ctx} />
      )}
    </Suspense>
  );
}

/** Whether answers wait in this device's outbox (cardsOutbox.ts's key). */
function hasWaiting(userId: string): boolean {
  try {
    return (localStorage.getItem(`study-cards-outbox:${userId}`) ?? "[]") !== "[]";
  } catch {
    return false;
  }
}

/** The member's own counts per lecture, kept fresh: on mount (returning to
 *  the library), when the group's deck changes, and after unsent answers go. */
function useMyCounts(ctx: Ctx): Record<string, CardCounts> | null {
  const [counts, setCounts] = useState<Record<string, CardCounts> | null>(null);
  useEffect(() => {
    if (!flags.cards) return;
    let alive = true;
    const load = () =>
      myCardCounts(ctx.group.id)
        .then((cs) => alive && setCounts(Object.fromEntries(cs.map((c) => [c.lecture_id, c]))))
        .catch(() => undefined); // an extra: a failure only hides the chips
    // Answers still on their way would make the numbers old: send them first
    // (the outbox, with the scheduler, loads only then: the entry chunk stays small).
    if (flags.cardsReview && hasWaiting(ctx.userId)) {
      void import("../lib/cardsOutbox")
        .then((m) => m.outboxFor(ctx.userId, { retention: () => DEFAULT_SETTINGS.retention }).flush())
        .catch(() => undefined)
        .finally(load);
    } else void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchCards({ groupId: ctx.group.id }, () => {
      clearTimeout(timer);
      timer = setTimeout(load, 600);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [ctx.group.id, ctx.userId]);
  return counts;
}

/** The library card's cards chip for a lecture: with review on, the member's
 *  own "12 לחזרה" (to a session on the lecture) when any are due, else
 *  "54 כרטיסיות" (to the deck) when the lecture has one (design-cards K10). */
export function useCardsChip(ctx: Ctx): (lectureId: string) => ReactNode {
  const counts = useMyCounts(ctx);
  return (lectureId: string) => {
    const c = counts?.[lectureId];
    if (!flags.cards || !c || c.cards < 1) return null;
    const due = c.learning_due + c.review_due;
    if (flags.cardsReview && due > 0)
      return (
        <RouteLink to={{ v: "cards", s: `l.${lectureId}` }} go={ctx.go} className="a-chip busy">
          {due} לחזרה
        </RouteLink>
      );
    return (
      <RouteLink to={{ v: "cards", l: lectureId }} go={ctx.go} className="a-chip busy">
        {c.cards} כרטיסיות
      </RouteLink>
    );
  };
}

/** "כרטיסיות להיום" on the practice hub (Q's PracticeHome renders it):
 *  "34 לחזרה · 20 חדשות" and "לחזור עכשיו"; with review off, "ייצוא ל-Anki". */
export function CardsHubCard({ ctx }: { ctx: Ctx }) {
  const counts = useMyCounts(ctx);
  const [newLeft, setNewLeft] = useState<number | null>(null);
  const [lectures, setLectures] = useState<LectureRow[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [home, setHome] = useState<ReviewHome | null>(null);
  useEffect(() => {
    if (!flags.cards || !flags.cardsReview) return;
    let alive = true;
    Promise.all([loadCardSettings(), myCardDays(ctx.group.id, 1)])
      .then(([s, days]) => {
        const today = new Date(studyDay(Date.now()) * 86_400_000).toISOString().slice(0, 10);
        const seen = days.filter((d) => String(d.day).slice(0, 10) === today).reduce((n, d) => n + Number(d.first_seen), 0);
        if (alive) setNewLeft(Math.max(0, s.new_per_day - seen));
        if (alive) setHome(s.home ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  if (!flags.cards || !counts) return null;
  const all = Object.values(counts);
  const total = all.reduce((n, c) => n + c.cards, 0);
  if (!total) return null;
  const due = all.reduce((n, c) => n + c.learning_due + c.review_due, 0);
  const fresh = Math.min(all.reduce((n, c) => n + c.new_cards, 0), newLeft ?? 0);
  const openExport = () => {
    setExporting(true);
    if (!lectures) void listLectures(ctx.group.id).then(setLectures).catch(() => setExporting(false));
  };
  return (
    <section className="a-card cards-hub">
      <h2 className="a-h2">כרטיסיות להיום</h2>
      {flags.cardsReview && home !== "anki" ? (
        <div className="a-row between">
          <p>
            {due} לחזרה · {fresh} חדשות
          </p>
          <RouteLink to={{ v: "cards", s: "today" }} go={ctx.go} className="a-btn primary">
            לחזור עכשיו
          </RouteLink>
        </div>
      ) : (
        <div className="a-row">
          <button className="a-btn" onClick={openExport}>
            ייצוא ל-Anki
          </button>
        </div>
      )}
      {exporting && lectures ? (
        <Suspense fallback={null}>
          <AnkiExportSheet
            groupId={ctx.group.id}
            lectures={lectures}
            counts={Object.fromEntries(all.map((c) => [c.lecture_id, c.cards]))}
            say={ctx.say}
            onClose={() => setExporting(false)}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

/** "חזרה על כרטיסים: באפליקציה · ב-Anki" under "שלי" → הגדרות (§12.3.C, C6),
 *  with in-app review on; else null. Her own settings row, on every device. */
export function ReviewHomeSetting({ ctx }: { ctx: Ctx }) {
  const [s, setS] = useState<CardSettings | null>(null);
  useEffect(() => {
    if (!flags.cards || !flags.cardsReview) return;
    let alive = true;
    loadCardSettings()
      .then((x) => alive && setS(x))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!flags.cards || !flags.cardsReview || !s) return null;
  const choose = (home: ReviewHome) => {
    const next = { ...s, home };
    setS(next);
    void saveCardSettings(next).catch(() => ctx.say("ההגדרה לא נשמרה. כדאי לבדוק את החיבור."));
  };
  return (
    <div className="a-field review-home">
      <span>חזרה על כרטיסים</span>
      <div className="a-seg" role="radiogroup" aria-label="חזרה על כרטיסים">
        <button type="button" className="a-btn small" role="radio" aria-checked={s.home === "app"} onClick={() => choose("app")}>
          באפליקציה
        </button>
        <button type="button" className="a-btn small" role="radio" aria-checked={s.home === "anki"} onClick={() => choose("anki")}>
          ב-<bdi dir="ltr">Anki</bdi>
        </button>
      </div>
      <small>בית אחד לחזרות. ב-Anki כאן לא יופיעו כרטיסים לחזרה.</small>
    </div>
  );
}
