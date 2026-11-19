import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from "react";
import { flags } from "../lib/flags";
import type { Ctx, LectureCtx, LectureExt } from "./types";

/* ── Package M's slot (§12.2.3, §12.4.M): the day's meeting ──
 *
 * The meeting screen (the opening "שאלות פתיחה", the pre-guess, the agenda, the
 * closing), planning, catch-up, the meeting's card on "יחד" and its band,
 * and in the lecture: the reader's card (one line in the reader's bar, its
 * callouts after the paragraphs they are about), and "לא
 * ברור לי" first in the follower's bar (with the guess that lights up). Every
 * piece loads lazily from its own file (review F-8: "יחד", the lecture and
 * the shell import this module statically, so only these few lines are in
 * the entry chunk). Behind VITE_STUDY_MEETING (M-1) and VITE_STUDY_GUESS
 * (M-2: the pre-guess and catch-up), against section M. */

/** The meeting screen (?v=meeting): the opening, the guesses, the agenda, planning. */
export const MeetingScreen = lazy(() => import("../components/MeetingScreen"));

/** Catch-up of a missed meeting (?v=catchup), M-2. */
export const CatchupScreen = lazy(() => import("../components/Catchup"));

const Band = lazy(() => import("../components/MeetingBand"));
const Reader = lazy(() => import("../components/ReaderCard"));
const Follow = lazy(() => import("../components/FollowBar"));
const ReaderBlock = lazy(() => import("../components/ReaderCard").then((m) => ({ default: m.ReaderBlock })));

/** The meeting card on "יחד" (after the live line): the band, or "אין פגישה מתוכננת." */
export function MeetingCard({ ctx }: { ctx: Ctx }) {
  if (!flags.meeting) return null;
  return (
    <Suspense fallback={null}>
      <Band ctx={ctx} card />
    </Suspense>
  );
}

/** The meeting's band (Today's top, T's), or nothing when there is no meeting. */
export function MeetingBand({ ctx, compact }: { ctx: Ctx; compact?: boolean }) {
  if (!flags.meeting) return null;
  return (
    <Suspense fallback={null}>
      <Band ctx={ctx} compact={compact} />
    </Suspense>
  );
}

/* ── How many others follow this phone's reading, as the reader's card last
 *    read it (study_meeting_reader_view). K's "אישור בקול" shows only from 2
 *    (decision 5: approved aloud with two others following; the database
 *    checks the same, study_private.meeting_reads_live). ── */
const followers = { n: 0, subs: new Set<() => void>() };
export function setReaderFollowers(n: number): void {
  if (followers.n === n) return;
  followers.n = n;
  followers.subs.forEach((f) => f());
}
export function useReaderFollowers(): number {
  return useSyncExternalStore(
    (f) => {
      followers.subs.add(f);
      return () => void followers.subs.delete(f);
    },
    () => followers.n,
  );
}

/* ── The paragraphs after which the reader's card draws its body half (the
 *    taps' callout, the guess warning), as the reader's bar last read them:
 *    "part.anchor" keys (review M-READER-CARD-COVERS). ── */
const spots = { keys: new Set<string>(), subs: new Set<() => void>() };
export function setReaderSpots(keys: string[]): void {
  const next = new Set(keys);
  if (next.size === spots.keys.size && keys.every((k) => spots.keys.has(k))) return;
  spots.keys = next;
  spots.subs.forEach((f) => f());
}
function useReaderSpots(): Set<string> {
  return useSyncExternalStore(
    (f) => {
      spots.subs.add(f);
      return () => void spots.subs.delete(f);
    },
    () => spots.keys,
  );
}

/** M's additions to the lecture: the reader's card while reading aloud, "לא
 *  ברור לי" in the follower's bar. */
export function useLectureM(lc: LectureCtx): LectureExt {
  // The reading itself lives with the reader's bar: study_meeting_reading on
  // when reading starts, off when it stops or the lecture closes, the place
  // in between (components/ReaderCard's session, loaded on first use).
  const reading = flags.meeting && lc.reading;
  const session = useRef<{ place: (part: number, anchor: number) => void; stop: () => void } | null>(null);
  const placeRef = useRef(lc.place);
  placeRef.current = lc.place;
  const lcRef = useRef(lc);
  lcRef.current = lc;
  useEffect(() => {
    if (!reading) return;
    let alive = true;
    import("../components/ReaderCard")
      .then((m) => {
        if (alive) session.current = m.startReaderSession(lcRef.current, placeRef.current);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      session.current?.stop();
      session.current = null;
    };
  }, [reading, lc.lecture.id]);
  const at = reading ? lc.place : null;
  const marked = useReaderSpots();
  useEffect(() => {
    if (at) session.current?.place(at.part, at.anchor);
  }, [at?.part, at?.anchor]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!flags.meeting) return {};
  return {
    // The reader's card in the reading flow, right after the paragraph it is about (meeting.html s3).
    part:
      lc.reading && marked.size
        ? (s) => ({
            blockExtras: (anchor: number) =>
              marked.has(`${s.idx}.${anchor}`) ? (
                <Suspense fallback={null}>
                  <ReaderBlock lc={lc} part={s.idx} anchor={anchor} />
                </Suspense>
              ) : null,
          })
        : undefined,
    readerBar: lc.reading ? (
      <Suspense fallback={null}>
        <Reader lc={lc} />
      </Suspense>
    ) : undefined,
    followBar: lc.following ? (
      <Suspense fallback={null}>
        <Follow lc={lc} />
      </Suspense>
    ) : undefined,
  };
}
