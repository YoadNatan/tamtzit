import { lazy, Suspense } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import { Loading } from "../components/Shell";
import { flags } from "../lib/flags";
import type { Ctx, ScreenProps } from "./types";

/* ── Practice sets' slot (docs/study/sets.md; VITE_STUDY_MAKE) ──
 * Only these stubs are in the study entry chunk (bundle owner QS, capped at
 * 2,000 B): no words, no data module. The screens load lazily, each in its
 * own chunk, and bring their words (lib/setsCopy.ts), their planning
 * (lib/make.ts) and their styles (styles/sets.css). Package Q's slot
 * (features/practice.tsx) routes to them while flags.make is on:
 *   ?v=practice&x=new[&l=…][&from=m]   "סט חדש": one screen, the price on its button
 *   ?v=practice&l=…&x=bank&r=…         "סט בהכנה": the set being written, then "להתחיל לפתור"
 * Without the flag the same routes are practice 2.0's (PracticeCreate,
 * PracticeBank), kept one release (OD22). The lecture page's row after
 * reading ("סט חדש" · "לפתור") is a lazy part too, with its own boundary: a
 * chunk that cannot load costs the row, never the lecture.
 * Slice B (flags.sets): ?v=sets, the group's shelf (SetsShelf), and
 * ?v=sets&k=<set>, a set being made and then its page (SetPage), each a lazy
 * chunk; and, on the join screen opened from a set's link, the line that
 * says how to reach it (a home-screen app keeps its own storage, so a link
 * that opens in the browser starts signed out). */

export const MakeScreen = lazy(() => import("../components/MakeScreen"));
export const MakeProgress = lazy(() => import("../components/MakeProgress"));
const Entry = lazy(() => import("../components/MakeEntry"));

/** The lecture page's row after reading; nothing without the flag. */
export function MakeLectureRow(p: { ctx: Ctx; lectureId: string }) {
  return flags.make ? (
    <ErrorBoundary reset="make-row" fallback="none">
      <Suspense fallback={null}>
        <Entry {...p} />
      </Suspense>
    </ErrorBoundary>
  ) : null;
}

const Sets = lazy(() => import("../components/SetsScreen"));
const JoinNote = lazy(() => import("../components/SetJoinNote"));

/** ?v=sets[&l=…] and ?v=sets&k=… (allowed() sends them to the hub without the flag). */
export function SetsRoute(p: ScreenProps<"sets">) {
  return (
    <Suspense fallback={<Loading />}>
      <Sets {...p} />
    </Suspense>
  );
}

/** Above Join when the address is a set's link; nothing otherwise. */
export function SetJoinNote() {
  return flags.sets && /[?&]v=sets\b/.test(location.search) && /[?&]k=/.test(location.search) ? (
    <ErrorBoundary reset="set-join" fallback="none">
      <Suspense fallback={null}>
        <JoinNote />
      </Suspense>
    </ErrorBoundary>
  ) : null;
}
