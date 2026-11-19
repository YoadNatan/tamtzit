import { useEffect, useMemo, useState } from "react";
import { studyDay } from "../../../shared/study/day";
import { listLectures, type LectureRow } from "../lib/api";
import { DEFAULT_SETTINGS, listGroupCardsLite, loadCardSettings, myCardDays, myStatesAll, watchCards, type CardLite, type CardSettings } from "../lib/cards";
import { listMyCards, myAdoptions, myCardState, type MyCard } from "../lib/cardsDeck";
import { addExtraToday, extraToday, waitingReviews, withWaiting } from "../lib/cardsOutbox";
import { buildQueue, deckCards, dueForToday, dueTomorrow, newLeftToday, partKey, waitingLearning, type QCard, type QState } from "../lib/cardsQueue";
import { flags } from "../lib/flags";
import { openAccount } from "../features/account";
import type { Ctx } from "../features/types";
import { AnkiExportSheet, CardSettingsSheet, ReviewHomeSheet, useHomeAsk } from "./CardSheets";
import { Head, RouteLink } from "./Shell";

/* ── K1: the cards of the day (?v=cards; design-cards §1.3) ──
 * With in-app review on: today's numbers from the member's own states (the
 * same queue a session builds, so "להתחיל (54)" is what the session shows),
 * one row per lecture with a deck, a course's "לחזור על כל הקורס", settings
 * and export. With it off (release 5): the decks and the export only, and
 * nothing private is written. C's end: the numbers follow the member's deck
 * (new cards only from the parts she added, trap and private cards first),
 * her private cards join the day's queue, the review home is asked once,
 * and with Anki as her home nothing waits here for review. */

type Row = { lecture: LectureRow; total: number; due: number; fresh: number };

/** The first-seen count of today's study day, from study_my_card_days. */
function seenToday(days: Array<{ day: string; first_seen: number }>, now: number): number {
  const today = new Date(studyDay(now) * 86_400_000).toISOString().slice(0, 10);
  return days.filter((d) => String(d.day).slice(0, 10) === today).reduce((n, d) => n + Number(d.first_seen), 0);
}

export default function CardsToday({ ctx }: { ctx: Ctx }) {
  const review = flags.cardsReview;
  const [lectures, setLectures] = useState<LectureRow[] | null>(null);
  const [cards, setCards] = useState<CardLite[]>([]);
  const [states, setStates] = useState<Map<string, QState>>(new Map());
  const [settings, setSettings] = useState<CardSettings>(DEFAULT_SETTINGS);
  const [firstSeen, setFirstSeen] = useState(0);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<"export" | "settings" | null>(null);
  const [nudge, setNudge] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const day = studyDay(now);
  const [extra, setExtra] = useState(() => extraToday(ctx.userId, studyDay(Date.now())));
  const [adopted, setAdopted] = useState<Set<string>>(new Set());
  const [mine, setMine] = useState<MyCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const homeAsk = useHomeAsk(settings, review && loaded);

  useEffect(() => {
    let alive = true;
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      try {
        const [ls, cs] = await Promise.all([listLectures(ctx.group.id), listGroupCardsLite(ctx.group.id)]);
        let st = new Map<string, QState>();
        let set = DEFAULT_SETTINGS;
        let seen = 0;
        let ad = new Set<string>();
        let own: MyCard[] = [];
        if (review) {
          const [s, conf, days, adoptions, ms] = await Promise.all([
            myStatesAll(),
            loadCardSettings().catch(() => DEFAULT_SETTINGS),
            myCardDays(ctx.group.id, 1).catch(() => []),
            myAdoptions(),
            listMyCards(),
          ]);
          const waiting = waitingReviews(ctx.userId);
          const all = new Map(s);
          for (const m of ms) all.set(m.id, myCardState(m));
          st = withWaiting(all, waiting);
          ad = new Set(adoptions.map((a) => partKey(a.lecture_id, a.part_idx)));
          own = ms;
          set = conf;
          const t = Date.now();
          seen = seenToday(days, t) + waiting.filter((r) => r.prevReps === 0 && studyDay(r.at) === studyDay(t) && !s.has(r.card)).length;
        }
        if (!alive || mine !== seq) return;
        setLectures(ls);
        setCards(cs);
        setStates(st);
        setSettings(set);
        setFirstSeen(seen);
        setAdopted(ad);
        setMine(own);
        setLoaded(true);
        setNow(Date.now());
        setError("");
      } catch {
        if (alive && mine === seq) setError("הכרטיסיות לא נטענו. כדאי לבדוק את החיבור ולנסות שוב.");
      }
    };
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchCards({ groupId: ctx.group.id }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 500);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [ctx.group.id, ctx.userId, review]);

  // The deck's rules (C's end): new only from her deck, trap and private cards first.
  const qcards: QCard[] = useMemo(
    () => deckCards({ cards, lectureOrder: new Map((lectures ?? []).map((l, i) => [l.id, i])), adopted, userId: ctx.userId, mine }),
    [cards, lectures, adopted, ctx.userId, mine],
  );

  const newLeft = newLeftToday(settings.new_per_day, firstSeen, extra);
  const today = useMemo(() => buildQueue({ cards: qcards, states, now, newLeft }), [qcards, states, now, newLeft]);
  const allNew = useMemo(() => buildQueue({ cards: qcards, states, now, newLeft: 1e9 }).counts.fresh, [qcards, states, now]);
  const waiting = useMemo(() => waitingLearning(qcards, states, new Set(today.ids), now), [qcards, states, today, now]);
  const tomorrow = useMemo(() => dueTomorrow(qcards, states, now), [qcards, states, now]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const l of lectures ?? []) {
      const of = qcards.filter((c) => c.lectureId === l.id);
      const shared = of.filter((c) => !c.mine);
      if (!shared.length) continue;
      const q = buildQueue({ cards: of, states, now, newLeft: 1e9 });
      out.push({ lecture: l, total: shared.length, due: q.counts.learning + q.counts.review, fresh: q.counts.fresh });
    }
    return out;
  }, [lectures, qcards, states, now]);
  const byCourse = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const key = r.lecture.course.trim();
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [rows]);
  const counts = useMemo(() => Object.fromEntries(rows.map((r) => [r.lecture.id, r.total])), [rows]);

  const anki = settings.home === "anki";
  const dueNow = dueForToday(settings.home, today.counts.learning + today.counts.review);
  const anonymous = Boolean((ctx.session.user as { is_anonymous?: boolean }).is_anonymous);

  return (
    <main className="cards cards-today">
      <Head title="כרטיסיות" />
      {review ? <p className="ph-sub">החזרות וההתקדמות שלך גלויות רק לך.</p> : null}
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}

      {review && flags.account && anonymous && nudge ? (
        <div className="a-callout warn nudge">
          <p>כדאי לשמור את החשבון עם מייל לפני שמתחילים לחזור: כך ההתקדמות נשמרת גם בטלפון חדש.</p>
          <div className="a-row">
            <button className="a-btn primary small" onClick={() => openAccount("save")}>
              שמירת החשבון
            </button>
            <button className="a-btn ghost small" onClick={() => setNudge(false)}>
              אחר כך
            </button>
          </div>
        </div>
      ) : null}

      {lectures === null && !error ? <p className="a-muted loading">טוען…</p> : null}

      {lectures !== null && rows.length === 0 ? (
        <section className="a-card dashed empty-deck">
          <p className="a-para">עוד אין כרטיסיות. בכל הרצאה אפשר ליצור כרטיסיות מהשקפים: עובדה אחת בכל כרטיסייה, לחזרה של כמה דקות ביום.</p>
          <div className="a-row">
            <RouteLink to={{ v: "library" }} go={ctx.go} className="a-btn">
              לספרייה
            </RouteLink>
          </div>
        </section>
      ) : null}

      {review && rows.length > 0 && anki ? (
        <section className="a-card today-box" aria-label="להיום">
          <p className="a-para">החזרות שלך ב-<bdi dir="ltr">Anki</bdi>, ולכן כאן אין כרטיסיות לחזרה. מייצאים את החפיסה שלך אחרי כל הוספה או תיקון.</p>
          <div className="a-row">
            <button className="a-btn primary" onClick={() => setSheet("export")}>
              ייצוא ל-Anki
            </button>
            <button className="a-btn ghost" onClick={() => setSheet("settings")}>
              לשנות בהגדרות
            </button>
          </div>
        </section>
      ) : null}

      {review && rows.length > 0 && !anki ? (
        <section className="a-card today-box" aria-label="להיום">
          <div className="today-nums">
            <div className="today-num">
              <b>{dueNow}</b>
              <span>לחזרה היום</span>
            </div>
            <div className="today-num">
              <b>{today.counts.fresh}</b>
              <span>חדשות היום, מתוך {settings.new_per_day}</span>
            </div>
          </div>
          {today.ids.length > 0 ? (
            <RouteLink to={{ v: "cards", s: "today" }} go={ctx.go} className="a-btn primary wide">
              להתחיל ({today.ids.length})
            </RouteLink>
          ) : (
            <p>אין כרטיסיות לחזרה עכשיו. מחר: {tomorrow}.</p>
          )}
          {waiting.count > 0 && waiting.firstDue !== null ? (
            <p className="a-small a-muted">
              עוד {waiting.count} בלמידה, בעוד {Math.max(1, Math.ceil((waiting.firstDue - now) / 60_000))} דק׳.
            </p>
          ) : null}
          {newLeft === 0 && allNew > 0 ? (
            <p>
              החדשות של היום נגמרו.{" "}
              <button className="a-link" onClick={() => setExtra(addExtraToday(ctx.userId, day, 10, extra))}>
                עוד 10 חדשות להיום
              </button>
            </p>
          ) : null}
        </section>
      ) : null}

      {byCourse.map(([course, list]) => (
        <section key={course || "-"} className="a-stack">
          <div className="a-sec">
            <h2 dir="auto">{course || "בלי קורס"}</h2>
            {review && course ? (
              <RouteLink to={{ v: "cards", s: `c.${course}` }} go={ctx.go} className="a-btn small">
                לחזור על כל הקורס
              </RouteLink>
            ) : null}
          </div>
          <ul className="a-list deck-list">
            {list.map((r) => (
              <li key={r.lecture.id} className="a-li deck-row">
                <RouteLink to={{ v: "cards", l: r.lecture.id }} go={ctx.go} className="deck-link">
                  <b dir="auto">{r.lecture.title}</b>
                  <span className="m">{review && !anki ? `${r.due} לחזרה · ${r.fresh} חדשות · ${r.total} בסך הכול` : `${r.total} כרטיסיות`}</span>
                </RouteLink>
                {review && !anki ? (
                  <RouteLink to={{ v: "cards", s: `l.${r.lecture.id}` }} go={ctx.go} className="a-btn small">
                    לחזור
                  </RouteLink>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {rows.length > 0 ? (
        <div className="a-row cards-foot">
          {review ? (
            <button className="a-btn" onClick={() => setSheet("settings")}>
              הגדרות
            </button>
          ) : null}
          <button className="a-btn" onClick={() => setSheet("export")}>
            ייצוא ל-Anki
          </button>
        </div>
      ) : null}

      {sheet === "export" && lectures ? (
        <AnkiExportSheet groupId={ctx.group.id} lectures={lectures} counts={counts} say={ctx.say} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === "settings" ? <CardSettingsSheet settings={settings} onChange={setSettings} say={ctx.say} onClose={() => setSheet(null)} /> : null}
      {homeAsk.open && !sheet ? <ReviewHomeSheet settings={settings} onSaved={setSettings} onClose={homeAsk.close} say={ctx.say} /> : null}
    </main>
  );
}
