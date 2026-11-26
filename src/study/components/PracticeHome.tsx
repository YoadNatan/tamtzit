import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { CardsHubCard } from "../features/cards";
import type { ScreenProps } from "../features/types";
import { listLectures, type LectureRow } from "../lib/api";
import { flags } from "../lib/flags";
import { courseKey } from "../../../shared/study/courseKey";
import { openBatches, practiceOverview, watchPractice, type Overview } from "../lib/practice";
import ErrorBoundary from "./ErrorBoundary";
import { Icon } from "./Icon";
import { Head, Loading, RouteLink } from "./Shell";

/** Practice sets (VITE_STUDY_SETS): "סטים של הקבוצה", the 3 newest (lazy, its own boundary). */
const HubSets = lazy(() => import("./SetsEntries").then((m) => ({ default: m.HubSets })));

/* ── The practice hub (P1; package Q, design-questions §1.3) ──
 *
 * "תרגול": the cards of today (package C's slot), the group quiz when it is on,
 * and per course (the library's grouping) its lectures with their questions
 * and this person's own counts ("15 שאלות · תורגלו 6 · 2 טעויות"), "יצירה"
 * where there are none yet, "נכתבות שאלות…" while a round is written, and
 * "לתרגל את כל הקורס". "הטעויות שלי" and past exams come with Q-2 (release 8
 * and 12). With practice sets (flags.make, docs/study/sets.md §5.2): the
 * "סט חדש" card first, then (flags.sets) "סטים של הקבוצה": the 3 newest
 * sets in a vertical list with "לכל הסטים ‹", the lectures under "תרגול
 * מהבנק" with "סט חדש" where a lecture has none, and the group quiz last. */

const SIX_MINUTES = 6 * 60_000;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

export default function PracticeHome({ ctx }: ScreenProps<"practice">) {
  const [lectures, setLectures] = useState<LectureRow[] | null>(null);
  const [overview, setOverview] = useState<Overview[]>([]);
  const [writing, setWriting] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const groupId = ctx.group.id;

  useEffect(() => {
    let alive = true;
    const extras = () =>
      Promise.all([practiceOverview(groupId).catch(() => null), openBatches().catch(() => null)]).then(([ov, open]) => {
        if (!alive) return;
        if (ov) setOverview(ov);
        if (open) setWriting(new Set(open.filter((b) => Date.now() - Date.parse(b.updated_at) < SIX_MINUTES).map((b) => b.lecture_id)));
      });
    listLectures(groupId)
      .then((l) => {
        if (!alive) return;
        setLectures(l);
        return extras();
      })
      .catch(() => alive && setError(true));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchPractice({ groupId, rounds: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void extras(), 400);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [groupId]);

  const byLecture = useMemo(() => new Map(overview.filter((o) => o.lecture_id).map((o) => [o.lecture_id as string, o])), [overview]);
  const courses = useMemo(() => {
    // With VITE_STUDY_COURSES a course is grouped by its key, as the course
    // page and s=c.<course> match it ("Micro" and "micro" are one heading,
    // named as first written); without it, by the exact text, as before.
    const map = new Map<string, { name: string; list: LectureRow[] }>();
    for (const l of lectures ?? []) {
      const name = l.course.trim() || "בלי קורס";
      const key = flags.courses && l.course.trim() ? `k:${courseKey(l.course)}` : name;
      const g = map.get(key) ?? { name, list: [] };
      g.list.push(l);
      map.set(key, g);
    }
    return [...map.values()].map((g) => [g.name, g.list] as const);
  }, [lectures]);

  return (
    <main className="practice-home">
      <Head title="תרגול" />
      <p className="ph-sub">התשובות והציונים שלך גלויים רק לך.</p>

      {flags.make ? (
        <section className="a-card practice-make-card" aria-labelledby="make-h">
          <h2 id="make-h" className="a-h2 a-row">
            <Icon name="star" size={16} />
            סט חדש
          </h2>
          <p className="a-small a-muted">שאלות חדשות על הרצאה, נבדקות לפני הבנק</p>
          <RouteLink to={{ v: "practice", x: "new" }} go={ctx.go} className="a-btn primary practice-make-go">
            סט חדש
          </RouteLink>
        </section>
      ) : null}

      {flags.sets ? (
        <ErrorBoundary reset="hub-sets" fallback="none">
          <Suspense fallback={null}>
            <HubSets ctx={ctx} />
          </Suspense>
        </ErrorBoundary>
      ) : null}

      <CardsHubCard ctx={ctx} />

      {flags.quiz && !flags.make ? (
        <section className="a-card practice-quiz-card" aria-labelledby="quiz-h">
          <h2 id="quiz-h" className="a-h2">
            מבחן קבוצתי
          </h2>
          <RouteLink to={{ v: "quiz", isNew: true }} go={ctx.go} className="a-btn">
            מבחן קבוצתי חדש
          </RouteLink>
        </section>
      ) : null}

      {error ? <p className="a-error">התרגול לא נטען. כדאי לבדוק את החיבור ולנסות שוב.</p> : null}
      {lectures === null && !error ? <Loading /> : null}

      {flags.make && courses.length ? <h2 className="a-h2 practice-bank-h">תרגול מהבנק</h2> : null}

      {courses.map(([course, list]) => {
        const withQ = list.filter((l) => (byLecture.get(l.id)?.questions ?? 0) > 0);
        const total = withQ.reduce((n, l) => n + (byLecture.get(l.id)?.questions ?? 0), 0);
        return (
          <section key={course} className="a-stack practice-course" aria-label={course}>
            <div className="a-sec">
              <h2 dir="auto">{course}</h2>
            </div>
            {total ? (
              <div className="a-row between practice-course-head">
                <span className="a-small a-muted">
                  {plural(total, "שאלה אחת", "שאלות")} {withQ.length === 1 ? "מהרצאה אחת" : `מ-${withQ.length} הרצאות`}
                </span>
                {flags.practice && course !== "בלי קורס" ? (
                  <RouteLink to={{ v: "practice", s: `c.${course}` }} go={ctx.go} className="a-btn small">
                    לתרגל את כל הקורס
                  </RouteLink>
                ) : null}
              </div>
            ) : null}
            <ul className="a-stack practice-lectures">
              {list.map((l) => {
                const o = byLecture.get(l.id);
                const n = o?.questions ?? 0;
                return (
                  <li key={l.id} className="a-card practice-row">
                    <RouteLink to={{ v: "practice", l: l.id }} go={ctx.go} className="practice-row-link">
                      <span className="lc-title" dir="auto">
                        {l.title}
                      </span>
                      <span className="lc-meta a-small a-muted">
                        {n
                          ? [
                              plural(n, "שאלה אחת", "שאלות"),
                              o?.answered === 1 ? "תורגלה אחת" : `תורגלו ${o?.answered ?? 0}`,
                              o?.wrong_now ? plural(o.wrong_now, "טעות אחת", "טעויות") : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "אין עדיין שאלות"}
                      </span>
                      {writing.has(l.id) ? <span className="a-chip busy">נכתבות שאלות…</span> : null}
                    </RouteLink>
                    {!n && !writing.has(l.id) ? (
                      <RouteLink to={{ v: "practice", l: l.id, x: "new" }} go={ctx.go} className="a-btn small practice-create">
                        {flags.make ? "סט חדש" : "יצירה"}
                      </RouteLink>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {flags.quiz && flags.make ? (
        <RouteLink to={{ v: "quiz", isNew: true }} go={ctx.go} className="a-btn practice-quiz-end">
          מבחן קבוצתי
        </RouteLink>
      ) : null}
    </main>
  );
}
