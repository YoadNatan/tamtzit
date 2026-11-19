import { useEffect, useSyncExternalStore } from "react";
import { setReaderFollowers, setReaderSpots, useReaderFollowers } from "../features/meeting";
import type { LectureCtx } from "../features/types";
import { addComment } from "../lib/api";
import { quoteAt, slidesAt } from "../lib/anchor";
import { flags } from "../lib/flags";
import {
  CARD_MS,
  lastAnchorOf,
  meetingQuiz,
  meetingWords,
  PlaceReporter,
  readerStop,
  readerView,
  reportPlace,
  startReading,
  type ReaderView,
  type Tap,
} from "../lib/meeting";
import { isolateLatin } from "../lib/rich";
import { routeUrl } from "../lib/route";
import "../styles/meeting.css";

/* ── The reader's card (package M; meeting.html s3, spec §12.4.M) ──
 *
 * In the reader's bar while this phone reads aloud, one line: how many
 * others follow (the room bar under it says "ההקראה שלך משותפת", once); every 6 s study_meeting_reader_view, which
 * answers only the meeting's current reader, only while the place is
 * reported, and counts other members' "לא ברור" from 3 (no names, no
 * text: the phone shows the paragraph's own first words); for each such
 * paragraph, in the reading flow right after it (ReaderBlock), "לעצור
 * ולהסביר" · "להמשיך" · "לשאלה פתוחה למחר" (a question on
 * the paragraph, "לא ברור בהקראה: …", for tomorrow's agenda); at a part's
 * last paragraph "עצירה: שאלה אחת על החלק" (decision 7's one-question
 * stop); with M-2 and the switch 'pulse', "בפסקה הבאה: ניחוש 2 · כדאי
 * להאט". "not live" hides the card quietly; "not the reader" closes it with
 * "ההקראה עברה לטלפון אחר.".
 *
 * The reading itself (study_meeting_reading on and off, the place at most
 * once in 5 s with a trailing call and a heartbeat every 20 s) is the
 * session below, which features/meeting.tsx starts and stops with the
 * reader's bar (not with this card: the bar's other items may re-mount it). */

type SessionState = { lectureId: string; meetingId: string | null; status: "starting" | "live" | "elsewhere" | "moved" };
const store = { s: null as SessionState | null, subs: new Set<() => void>() };
function publish(s: SessionState | null) {
  store.s = s;
  store.subs.forEach((f) => f());
}
function useSession(): SessionState | null {
  return useSyncExternalStore(
    (f) => {
      store.subs.add(f);
      return () => void store.subs.delete(f);
    },
    () => store.s,
  );
}

/** Starts reading aloud in the day's meeting on this lecture; returns the
 *  session's place() and stop(). */
export function startReaderSession(lc: LectureCtx, at: { part: number; anchor: number } | null): { place: (part: number, anchor: number) => void; stop: () => void } {
  const lectureId = lc.lecture.id;
  let alive = true;
  let meetingId: string | null = null;
  const state = (status: SessionState["status"]) => alive && publish({ lectureId, meetingId, status });
  const reporter = new PlaceReporter((part, anchor) => {
    if (!meetingId) return;
    reportPlace(meetingId, part, anchor).catch((e) => {
      if (!alive) return;
      const code = e instanceof Error ? e.message : "";
      if (code === "not the reader") {
        state("moved");
        reporter.stop();
      }
    });
  });
  let first = at;
  state("starting");
  startReading(lectureId, true, at?.part ?? 0, at?.anchor ?? 0)
    .then((id) => {
      if (!alive) return void (id && startReading(lectureId, false, 0, 0).catch(() => undefined));
      meetingId = id;
      state("live");
      if (first) reporter.place(first.part, first.anchor);
    })
    .catch((e) => {
      if (!alive) return;
      const code = e instanceof Error ? e.message : "";
      if (code === "reading") {
        state("elsewhere");
        lc.ctx.say(meetingWords(e), {
          label: "לעקוב",
          // The reader's own toggle is the lecture's; a fresh page follows instead.
          run: () => location.replace(routeUrl({ v: "lecture", l: lectureId, follow: true })),
        });
      } else state("starting");
    });
  return {
    place: (part, anchor) => {
      first = { part, anchor };
      if (meetingId) reporter.place(part, anchor);
    },
    stop: () => {
      alive = false;
      reporter.stop();
      setReaderFollowers(0);
      publish(null);
      if (meetingId) startReading(lectureId, false, 0, 0).catch(() => undefined);
    },
  };
}

const IDLE: ReaderView = { taps: [], guess_warn: null, followers: 0 };

/* ── The card's state, shared by its two halves (review M-READER-CARD-COVERS) ──
 * The sticky half (ReaderCard, in the reader's bar) reads the view every 6 s
 * and keeps one line: how many follow, a pointer per paragraph with taps
 * ("3 ׳לא ברור׳ · ש׳ 2", which scrolls to it), the part's stop. The body
 * half (ReaderBlock, after the paragraph the taps name, as meeting.html s3)
 * holds the callout with its three answers and the guess warning, in the
 * reading flow, so the reader keeps the screen for the text. */
type Card = {
  meetingId: string | null;
  view: ReaderView;
  live: boolean;
  handled: Set<string>;
  asking: Tap | null;
  draft: string;
  busy: boolean;
  error: string;
  /** Where the error shows: "bar" (the part's stop) or the paragraph's key. */
  errorAt: string;
};
const EMPTY: Card = { meetingId: null, view: IDLE, live: false, handled: new Set(), asking: null, draft: "", busy: false, error: "", errorAt: "" };
const card = { s: EMPTY, subs: new Set<() => void>() };
function setCard(patch: Partial<Card> | ((c: Card) => Partial<Card>)) {
  const p = typeof patch === "function" ? patch(card.s) : patch;
  card.s = { ...card.s, ...p };
  card.subs.forEach((f) => f());
}
function useCard(): Card {
  return useSyncExternalStore(
    (f) => {
      card.subs.add(f);
      return () => void card.subs.delete(f);
    },
    () => card.s,
  );
}
const keyOf = (t: Pick<Tap, "part" | "anchor">) => `${t.part}.${t.anchor}`;
/** The taps the reader still has to answer (from 3, never handled here). */
function openTaps(c: Card): Tap[] {
  return c.live ? c.view.taps.filter((t) => !c.handled.has(keyOf(t))) : [];
}
function warnOf(c: Card) {
  return flags.guess && c.live ? c.view.guess_warn : null;
}
const tapLine = (t: Tap) => {
  const slides = slidesAt(t.part, t.anchor);
  return `${t.n} ׳לא ברור׳${slides ? ` · ${slides}` : ""}`;
};

/** The reader's bar: one line while reading aloud. */
export default function ReaderCard({ lc }: { lc: LectureCtx }) {
  const session = useSession();
  const mine = session && session.lectureId === lc.lecture.id ? session : null;
  const meetingId = mine?.status === "live" ? mine.meetingId : null;
  const c = useCard();
  const followersNow = useReaderFollowers();

  // Every 6 s while the page is visible: the card the database lets the reader see.
  useEffect(() => {
    if (!meetingId) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    setCard({ ...EMPTY, meetingId });
    const read = () => {
      if (document.visibilityState === "hidden") return void (t = setTimeout(read, CARD_MS));
      readerView(meetingId)
        .then((v) => {
          if (!alive) return;
          setCard({ view: { taps: v.taps ?? [], guess_warn: v.guess_warn ?? null, followers: v.followers ?? 0 }, live: true });
          setReaderFollowers(v.followers ?? 0);
        })
        .catch((e) => {
          if (!alive) return;
          const code = e instanceof Error ? e.message : "";
          setCard({ live: false });
          setReaderFollowers(0);
          if (code === "not the reader") publish(store.s ? { ...store.s, status: "moved" } : null);
        })
        .finally(() => alive && (t = setTimeout(read, CARD_MS)));
    };
    // The first read waits for the first place to arrive (the card answers only a reported place).
    t = setTimeout(read, 1200);
    return () => {
      alive = false;
      clearTimeout(t);
      setCard(EMPTY);
    };
  }, [meetingId]);

  // Where the body half shows: each paragraph with open taps, and the warning after the place.
  const taps = meetingId ? openTaps(c) : [];
  const warn = meetingId ? warnOf(c) : null;
  const place = lc.place;
  const spots = [...taps.map(keyOf), ...(warn && place ? [keyOf(place)] : [])].join(" ");
  useEffect(() => {
    setReaderSpots(spots ? spots.split(" ") : []);
  }, [spots]);
  useEffect(() => () => setReaderSpots([]), []);

  if (mine?.status === "moved") {
    return (
      <p className="m-reader-note a-small a-muted" role="status">
        ההקראה עברה לטלפון אחר.
      </p>
    );
  }
  if (!meetingId) return null;

  const n = followersNow;
  const atPartEnd = flags.quiz && place && lastAnchorOf(place.part) === place.anchor && place.anchor > 0;
  const stopQuiz = async () => {
    if (!place) return;
    setCard({ busy: true, error: "" });
    try {
      const q = await meetingQuiz(meetingId, "stop", place.part);
      lc.ctx.go({ v: "quiz", q });
    } catch (e) {
      setCard({ error: meetingWords(e), errorAt: "bar" });
    } finally {
      setCard({ busy: false });
    }
  };
  const toTap = (t: Tap) => {
    const el = document.querySelector<HTMLElement>(`.m-callout[data-tap="${keyOf(t)}"]`);
    if (!el) return;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    el.scrollIntoView({ behavior, block: "center" });
    el.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  };

  return (
    <>
      <span className="a-chip group m-followers">{n === 1 ? "עוקב אחד" : `${n} עוקבים`}</span>
      {taps.map((t) => (
        <button key={keyOf(t)} type="button" className="a-chip warn m-tap-link" onClick={() => toTap(t)}>
          {tapLine(t)}
        </button>
      ))}
      {atPartEnd ? (
        <button type="button" className="a-chip busy m-part-stop" disabled={c.busy} onClick={() => void stopQuiz()}>
          עצירה: שאלה אחת על החלק
        </button>
      ) : null}
      {c.error && c.errorAt === "bar" ? (
        <p className="m-reader-note a-error a-small" role="alert">
          {c.error}
        </p>
      ) : null}
    </>
  );
}

/** After a paragraph in the reader's own summary (meeting.html s3): its taps'
 *  callout, with "לעצור ולהסביר" · "להמשיך" · "לשאלה פתוחה למחר", and, after
 *  the paragraph being read, "בפסקה הבאה: ניחוש N · כדאי להאט". */
export function ReaderBlock({ lc, part, anchor }: { lc: LectureCtx; part: number; anchor: number }) {
  const c = useCard();
  const meetingId = c.meetingId;
  if (!meetingId) return null;
  const here = `${part}.${anchor}`;
  const t = openTaps(c).find((x) => keyOf(x) === here);
  const warn = warnOf(c);
  const place = lc.place;
  const showWarn = warn && place && keyOf(place) === here;
  if (!t && !showWarn) return null;

  const act = async (tap: Tap, kind: "explain" | "continue") => {
    setCard({ busy: true, error: "" });
    try {
      await readerStop(meetingId, kind, tap.part, tap.anchor);
      setCard((s) => ({ handled: new Set(s.handled).add(keyOf(tap)) }));
    } catch (e) {
      setCard({ error: meetingWords(e), errorAt: here });
    } finally {
      setCard({ busy: false });
    }
  };
  const ask = async () => {
    const asking = card.s.asking;
    if (!asking || !card.s.draft.trim()) return;
    setCard({ busy: true, error: "" });
    try {
      const cm = await addComment({ lecture_id: lc.lecture.id, part_idx: asking.part, anchor: asking.anchor, quote: quoteAt(asking.part, asking.anchor), kind: "question", body: card.s.draft });
      await readerStop(meetingId, "question", asking.part, asking.anchor, cm.id);
      setCard((s) => ({ handled: new Set(s.handled).add(keyOf(asking)), asking: null }));
      lc.ctx.say("השאלה נשמרה לסדר היום של מחר.");
    } catch (e) {
      setCard({ error: meetingWords(e), errorAt: here });
    } finally {
      setCard({ busy: false });
    }
  };
  const busy = c.busy;
  const asking = t && c.asking && keyOf(c.asking) === here;

  return (
    <div className="m-reader a-stack" role="group" aria-label="ההקראה שלך">
      {t ? (
        asking ? (
          <div className="a-callout warn m-callout" data-tap={here}>
            <label className="a-field">
              <span>שאלה פתוחה למחר, על הפסקה</span>
              <textarea className="a-input" rows={2} value={c.draft} onChange={(e) => setCard({ draft: e.target.value })} dir="auto" maxLength={2000} />
            </label>
            <div className="a-row">
              <button type="button" className="a-btn small" disabled={busy || !c.draft.trim()} onClick={() => void ask()}>
                לשלוח לסדר היום
              </button>
              <button type="button" className="a-btn ghost small" onClick={() => setCard({ asking: null })}>
                ביטול
              </button>
            </div>
          </div>
        ) : (
          <div className="a-callout warn m-callout" data-tap={here} role="status">
            <div className="a-stack">
              <div className="a-row between">
                <b>{t.n} ׳לא ברור׳ · בלי שמות</b>
                {slidesAt(t.part, t.anchor) ? <span className="a-tag">{slidesAt(t.part, t.anchor)}</span> : null}
              </div>
              <button type="button" className="a-btn primary m-stop" disabled={busy} onClick={() => void act(t, "explain")}>
                לעצור ולהסביר
              </button>
              <div className="a-row">
                <button type="button" className="a-btn small" disabled={busy} onClick={() => void act(t, "continue")}>
                  להמשיך
                </button>
                <button type="button" className="a-btn small" disabled={busy} onClick={() => setCard({ draft: "לא ברור בהקראה: ", asking: t })}>
                  לשאלה פתוחה למחר
                </button>
              </div>
            </div>
          </div>
        )
      ) : null}
      {showWarn && warn ? (
        <div className="a-card flat m-warn">
          <div className="a-row between">
            <b className="a-small">בפסקה הבאה: ניחוש {warn.guess}</b>
            <span className="a-chip warn">כדאי להאט</span>
          </div>
          <span className="a-small" dir="rtl">
            {isolateLatin(warn.question, "gw")}
          </span>
          <span className="a-small a-muted">רוב הקבוצה ניחשה לא נכון</span>
        </div>
      ) : null}
      {t ? <p className="a-small a-muted">הספירה מופיעה רק במסך ההקראה, ורק מ-3 לחיצות.</p> : null}
      {c.error && c.errorAt === here ? (
        <p className="a-error a-small" role="alert">
          {c.error}
        </p>
      ) : null}
    </div>
  );
}
