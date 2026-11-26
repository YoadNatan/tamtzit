import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Head, Loading, RouteLink } from "../components/Shell";
import { flags } from "../lib/flags";
import { BlankTableSession } from "./extras";
import { MakeProgress, MakeScreen } from "./qsets";
import { SheetUpload } from "./sheets";
import "../styles/practice.css";
import type { Ctx, ScreenProps } from "./types";

/* ── Package Q's slot (spec §5.3): practice and past exams ──
 * The screens load lazily, each in its own chunk (review FE-9): the hub
 * (P1, ?v=practice), a lecture's practice (?v=practice&l=…), practice 2.0's
 * screens of a lecture (?v=practice&l=…&x=: מה ליצור and דוגמה ומיקוד in one
 * chunk, הבנק נבנה, סבב חדש), and a session (?v=practice&s=…). The library's
 * chip stays here, small: a lecture's question count, linking to its practice.
 * Past exams (sources.md, phase 2; VITE_STUDY_EXAMS, section S at 2): the
 * upload (?v=exams&new=1&c=), one exam's reading and review (?v=exams&e=),
 * the simulation's setup (?v=mock&c=) and the simulation itself
 * (?v=practice&s=x.<attempt>), each a lazy chunk. They replace the seed's
 * "בקרוב" screen; ?v=exams with neither goes to the course pages.
 * Practice sets (flags.make, features/qsets.tsx): "סט חדש" (x=new, also
 * without a lecture) and "סט בהכנה" (x=bank&r=) take the place of practice
 * 2.0's screens; a request's drafts one by one stay at x=review&r=. */

const PracticeHome = lazy(() => import("../components/PracticeHome"));
const LecturePractice = lazy(() => import("../components/LecturePractice"));
const PracticeSession = lazy(() => import("../components/PracticeSession"));
const PracticeCreate = lazy(() => import("../components/PracticeCreate"));
const PracticeBank = lazy(() => import("../components/PracticeBank"));
const PracticeRound = lazy(() => import("../components/PracticeRound"));
const ExamUpload = lazy(() => import("../components/ExamUpload"));
const ExamView = lazy(() => import("../components/ExamView"));
const MockSetup = lazy(() => import("../components/MockSetup"));
const MockRun = lazy(() => import("../components/MockRun"));

/** A simulation's key (?v=practice&s=x.<attempt>). */
const MOCK_KEY = /^x\.([0-9a-f-]{36})$/;

/** A blank table's session key (§12.2.1, route.ts's KEYED): b.<lecture>.<slide>. */
const BLANK_KEY = /^b\.([0-9a-f-]{36})\.([1-9]\d{0,2})$/;

export function PracticeScreen({ route, ctx }: ScreenProps<"practice">) {
  const blank = route.s ? BLANK_KEY.exec(route.s) : null;
  const mock = route.s ? MOCK_KEY.exec(route.s) : null;
  return (
    <Suspense fallback={<Loading />}>
      {mock ? (
        <MockRun key={mock[1]} ctx={ctx} attemptId={mock[1]} />
      ) : blank ? (
        // E's "טבלה ריקה" (s=b.<lecture>.<slide>): its own screen, $0 (allowed() checks its flag).
        <BlankTableSession ctx={ctx} lectureId={blank[1]} slide={Number(blank[2])} />
      ) : route.s ? (
        <PracticeSession key={`${route.s}|${route.n ?? "10"}`} route={route} ctx={ctx} />
      ) : flags.make && route.x === "new" ? (
        // One screen whatever the lecture: choosing another keeps the member's choices.
        <MakeScreen key={`make|${route.from ?? ""}`} route={route} ctx={ctx} />
      ) : flags.make && route.l && route.x === "bank" && route.r ? (
        <MakeProgress key={route.r} route={route} ctx={ctx} />
      ) : route.l && (route.x === "bank" || route.x === "review") ? (
        <PracticeBank key={`${route.l}|${route.r ?? ""}`} route={route} ctx={ctx} />
      ) : route.l && (route.x === "new" || route.x === "example") ? (
        <PracticeCreate key={`${route.l}|${route.x}`} route={route} ctx={ctx} />
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

export function ExamsScreen({ route, ctx }: ScreenProps<"exams">) {
  return (
    <Suspense fallback={<Loading />}>
      {route.e ? (
        <ExamView key={route.e} route={route} ctx={ctx} />
      ) : route.isNew && route.c ? (
        flags.sheets ? (
          <SheetUpload key={route.c} route={route} ctx={ctx} />
        ) : (
          <ExamUpload key={route.c} route={route} ctx={ctx} />
        )
      ) : (
        <ExamsHome ctx={ctx} />
      )}
    </Suspense>
  );
}

/** "סימולציה": its setup (?v=mock&c=<course>). */
export function MockScreen({ route, ctx }: ScreenProps<"mock">) {
  return (
    <Suspense fallback={<Loading />}>
      <MockSetup key={`${route.c}|${route.e ?? ""}`} route={route} ctx={ctx} />
    </Suspense>
  );
}

/** ?v=exams on its own: past exams live in their courses, so the courses that have them. */
function ExamsHome({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; exams: number }> | null>(null);
  useEffect(() => {
    let alive = true;
    import("../lib/courses")
      .then(({ coursesOf }) => coursesOf(ctx.group.id))
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  if (!rows) return <Loading />;
  return (
    <main className="exams-home">
      <Head title="מבחנים קודמים" />
      <p className="a-para a-muted">מבחנים קודמים נמצאים בעמוד של כל קורס.</p>
      <ul className="a-list">
        {rows.map((c) => (
          <li key={c.id}>
            <RouteLink to={{ v: "course", c: c.id, seg: "exams" }} go={ctx.go} className="a-li c-row">
              <div>
                <b dir="auto">{c.name}</b>
                <span className="m">{c.exams === 1 ? "מבחן קודם אחד" : `${c.exams} מבחנים קודמים`}</span>
              </div>
            </RouteLink>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** The library card's practice chip for a lecture ("15 שאלות"), or null; with
 *  practice sets (flags.make) also "+ סט" for a lecture whose summary is ready,
 *  even with no questions yet (design-practice §5.1). */
export function usePracticeChip(ctx: Ctx): (lectureId: string, ready?: boolean) => ReactNode {
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
    (lectureId: string, ready?: boolean) => {
      const n = counts[lectureId] ?? 0;
      const count =
        flags.questions && n > 0 ? (
          <RouteLink key="practice" to={{ v: "practice", l: lectureId }} go={go} className="a-chip busy">
            {n === 1 ? "שאלה אחת" : `${n} שאלות`}
          </RouteLink>
        ) : null;
      if (!flags.make || !ready) return count;
      return [
        count,
        <RouteLink key="set" to={{ v: "practice", l: lectureId, x: "new" }} go={go} className="a-chip lc-set" label="סט חדש">
          + סט
        </RouteLink>,
      ];
    },
    [counts, go],
  );
}
