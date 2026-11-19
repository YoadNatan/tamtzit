import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Loading, RouteLink, Soon } from "../components/Shell";
import { flags } from "../lib/flags";
import { BlankTableSession } from "./extras";
import "../styles/practice.css";
import type { Ctx, ScreenProps } from "./types";

/* ── Package Q's slot (spec §5.3): practice and past exams ──
 * The screens load lazily, each in its own chunk (review FE-9): the hub
 * (P1, ?v=practice), a lecture's practice (?v=practice&l=…), practice 2.0's
 * screens of a lecture (?v=practice&l=…&x=: מה ליצור and דוגמה ומיקוד in one
 * chunk, הבנק נבנה, סבב חדש), and a session (?v=practice&s=…). The library's
 * chip stays here, small: a lecture's question count, linking to its practice.
 * Past exams (?v=exams) are Q-2 (release 12): until then the screen is the
 * seed's placeholder, and nothing links to it. */

const PracticeHome = lazy(() => import("../components/PracticeHome"));
const LecturePractice = lazy(() => import("../components/LecturePractice"));
const PracticeSession = lazy(() => import("../components/PracticeSession"));
const PracticeCreate = lazy(() => import("../components/PracticeCreate"));
const PracticeBank = lazy(() => import("../components/PracticeBank"));
const PracticeRound = lazy(() => import("../components/PracticeRound"));

/** A blank table's session key (§12.2.1, route.ts's KEYED): b.<lecture>.<slide>. */
const BLANK_KEY = /^b\.([0-9a-f-]{36})\.([1-9]\d{0,2})$/;

export function PracticeScreen({ route, ctx }: ScreenProps<"practice">) {
  const blank = route.s ? BLANK_KEY.exec(route.s) : null;
  return (
    <Suspense fallback={<Loading />}>
      {blank ? (
        // E's "טבלה ריקה" (s=b.<lecture>.<slide>): its own screen, $0 (allowed() checks its flag).
        <BlankTableSession ctx={ctx} lectureId={blank[1]} slide={Number(blank[2])} />
      ) : route.s ? (
        <PracticeSession key={`${route.s}|${route.n ?? "10"}`} route={route} ctx={ctx} />
      ) : route.l && (route.x === "new" || route.x === "example") ? (
        <PracticeCreate key={`${route.l}|${route.x}`} route={route} ctx={ctx} />
      ) : route.l && route.x === "bank" ? (
        <PracticeBank key={`${route.l}|${route.r ?? ""}`} route={route} ctx={ctx} />
      ) : route.l && route.x === "round" ? (
        <PracticeRound key={route.l} route={route} ctx={ctx} />
      ) : route.l ? (
        <LecturePractice key={route.l} route={route} ctx={ctx} />
      ) : (
        <PracticeHome route={route} ctx={ctx} />
      )}
    </Suspense>
  );
}

export function ExamsScreen(_p: ScreenProps<"exams">) {
  return <Soon title="מבחנים קודמים" />;
}

/** The library card's practice chip for a lecture ("15 שאלות"), or null. */
export function usePracticeChip(ctx: Ctx): (lectureId: string) => ReactNode {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const groupId = ctx.group.id;
  useEffect(() => {
    if (!flags.questions) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = () => undefined as void;
    // The data module loads with the chip, not with the app: it stays out of the entry chunk.
    import("../lib/practice")
      .then(({ practiceOverview, watchPractice }) => {
        if (!alive) return;
        const load = () =>
          practiceOverview(groupId)
            .then((rows) => alive && setCounts(Object.fromEntries(rows.filter((r) => r.lecture_id).map((r) => [r.lecture_id as string, r.questions]))))
            .catch(() => undefined); // an extra: a failure only hides the chips
        void load();
        stop = watchPractice({ groupId }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => void load(), 600);
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [groupId]);
  const go = ctx.go;
  return useCallback(
    (lectureId: string) => {
      const n = counts[lectureId] ?? 0;
      if (!flags.questions || n < 1) return null;
      return (
        <RouteLink key="practice" to={{ v: "practice", l: lectureId }} go={go} className="a-chip busy">
          {n === 1 ? "שאלה אחת" : `${n} שאלות`}
        </RouteLink>
      );
    },
    [counts, go],
  );
}
