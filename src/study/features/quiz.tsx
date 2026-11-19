import { lazy, Suspense } from "react";
import { Loading } from "../components/Shell";
import { QuizBanner, QuizGroupCard } from "../components/QuizBanner";
import { flags } from "../lib/flags";
import type { Route } from "../lib/route";
import { useOpenQuiz } from "../lib/useOpenQuiz";
import "../styles/quiz.css";
import type { Ctx, ScreenProps } from "./types";

/* ── Package Z's slot (spec §5.3; §12.2.3): the group quiz ──
 * "מבחן קבוצתי", its modes "כולנו נגד המבחן" (the default) and "מירוץ"
 * (§12.0.4). The setup (?v=quiz&new=1) and the room (?v=quiz&q=…: the
 * lobby, the questions, the reveals, the end) load lazily, each in its own
 * chunk (review F-8); the banner's line and the card on "יחד" stay here,
 * small, and read the group's quiz through one shared store.
 *
 * QuizInline is section M's opening ("שאלות פתיחה", stacked in the meeting
 * screen); the presets "שאלות פתיחה" and "עצירה" are opened only from M's
 * screens. Left for packages that are not built yet: a boss battle (mode "boss", section H) renders H's BossHud and
 * BossEnd in the room, which are empty until H. */

const QuizSetup = lazy(() => import("../components/QuizSetup"));
const QuizRoom = lazy(() => import("../components/Quiz"));

export function QuizScreen({ route, ctx }: ScreenProps<"quiz">) {
  return (
    <Suspense fallback={<Loading />}>
      {route.q ? <QuizRoom key={route.q} quizId={route.q} route={route} ctx={ctx} /> : <QuizSetup key={`${route.l ?? ""}|${route.c ?? ""}`} route={route} ctx={ctx} />}
    </Suspense>
  );
}

/** The live banner's quiz line (highest priority), or null: never on the
 *  quiz's own screens. */
export function QuizBannerLine({ ctx, route }: { ctx: Ctx; route: Route }) {
  const { open } = useOpenQuiz(ctx.group.id);
  if (!flags.quiz || !open || route.v === "quiz") return null;
  return <QuizBanner quiz={open} go={ctx.go} />;
}

/** The quiz card on "יחד": the open quiz's line, else "מבחן קבוצתי חדש",
 *  and the last three quizzes with the group's share (from 3 players) and
 *  this member's own line. */
export function QuizCard({ ctx }: { ctx: Ctx }) {
  const { open, recent } = useOpenQuiz(ctx.group.id, true);
  if (!flags.quiz) return null;
  return <QuizGroupCard open={open} recent={recent} go={ctx.go} />;
}

const Inline = lazy(() => import("../components/QuizInline"));

/** A quiz inside another screen (M's meeting: "שאלות פתיחה"), stacked in the
 *  page: answered rounds folded with the majority word, the current one
 *  open with the bet (components/QuizInline, built by package M on Z's
 *  engine, useQuiz). */
export function QuizInline(p: { ctx: Ctx; quizId: string; layout: "stack"; onState?: (s: { idx: number; total: number; state: string }) => void }) {
  if (!flags.quiz) return null;
  return (
    <Suspense fallback={<Loading />}>
      <Inline key={p.quizId} ctx={p.ctx} quizId={p.quizId} onState={p.onState} />
    </Suspense>
  );
}
