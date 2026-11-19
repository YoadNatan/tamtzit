import { useEffect, useMemo, useState } from "react";
import { courseOverview, examWhen, type CourseOverview } from "../lib/courses";
import { lengthsFor, minutesText, mockCreate, mockGet, mockStart, openAttempt, rememberAttempt, type CourseExam, type MockAttempt } from "../lib/exams";
import { failText } from "../lib/failText";
import type { ScreenProps } from "../features/types";
import { BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";
import "../styles/exams.css";

/* ── "סימולציה": its setup (sources.md decisions 4 and 5; mockup sim-setup.html) ──
 *
 * ?v=mock&c=<course>(&e=<exam>). Phase 2 has one source, a past exam ("מבחן
 * קודם · בדיוק כמו שהיה"): the course's ready exams, the latest uploaded
 * first and chosen. The lengths follow that exam, short first: "קצר · 20
 * שאלות · 36 דקות", "חצי · 50 שאלות · 90 דקות", "מלא · 100 שאלות · 3 שעות"
 * (its own minutes, else the course's pace, else 1.8 a question). "רק שאלות
 * שעוד לא ראיתי" is on. "להתחיל" makes the simulation (study_mock_create, $0)
 * and starts its one clock (study_mock_start) on the server. A simulation
 * still open on this phone is offered first ("להמשיך"). The mixed and
 * exam-style sources are phase 4's and are not shown. */

const byNewest = (a: CourseExam, b: CourseExam) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 0);

export default function MockSetup({ route, ctx }: ScreenProps<"mock">) {
  const [course, setCourse] = useState<CourseOverview | null>(null);
  const [error, setError] = useState("");
  const [examId, setExamId] = useState<string | null>(route.e ?? null);
  const [len, setLen] = useState<string>("");
  const [unseen, setUnseen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<MockAttempt | null>(null);

  useEffect(() => {
    courseOverview(route.c)
      .then(setCourse)
      .catch((e: unknown) => setError(failText(e instanceof Error ? e.message : "", "course")));
    // A simulation left open on this phone (a reload, a lock): offered before a new one.
    const a = openAttempt(ctx.userId);
    if (a)
      mockGet(a)
        .then((x) => (x.finished_at ? rememberAttempt(ctx.userId, null) : setOpen(x)))
        .catch(() => rememberAttempt(ctx.userId, null));
  }, [route.c, ctx.userId]);

  const exams = useMemo(() => ((course?.exams ?? []) as CourseExam[]).filter((e) => e.status === "ready" && (e.questions ?? 0) >= 5).sort(byNewest), [course]);
  const exam = exams.find((e) => e.id === examId) ?? exams[0] ?? null;
  const lengths = useMemo(() => (exam ? lengthsFor({ questions: exam.questions ?? 0, minutes: exam.minutes ?? null }, course ?? undefined) : []), [exam, course]);
  const chosen = lengths.find((l) => l.key === len) ?? lengths[0] ?? null;

  const back = <BackLink go={ctx.go} fallback={{ v: "course", c: route.c }} />;
  if (error)
    return (
      <main className="sim-setup">
        <Head back={back} title="סימולציה" />
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!course) return <Loading />;
  const when = examWhen(course.exam_date, course.days_left);

  const start = async () => {
    if (!exam || !chosen) return;
    setBusy(true);
    try {
      const m = await mockCreate({ courseId: course.id, examId: exam.id, n: chosen.key === "full" ? null : chosen.n, minutes: chosen.minutes, unseenOnly: unseen });
      const a = await mockStart(m.mock);
      rememberAttempt(ctx.userId, a.attempt);
      ctx.go({ v: "practice", s: `x.${a.attempt}` });
    } catch (e) {
      ctx.say(failText(e instanceof Error ? e.message : "", "exam") || "הסימולציה לא נפתחה. כדאי לנסות שוב.");
      setBusy(false);
    }
  };

  return (
    <main className="sim-setup">
      <Head back={back} title="סימולציה" />
      <p className="ph-sub">
        <span>
          <bdi>{course.name}</bdi>
        </span>
        {when ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{when.when}</span>
          </>
        ) : null}
      </p>

      {open ? (
        <section className="a-callout s-open" aria-label="סימולציה פתוחה">
          <b>יש סימולציה שעוד לא הוגשה</b>
          <span className="a-small">השעון שלה ממשיך לרוץ גם כשהיא סגורה.</span>
          <RouteLink to={{ v: "practice", s: `x.${open.attempt}` }} go={ctx.go} className="a-btn small primary">
            להמשיך
          </RouteLink>
        </section>
      ) : null}

      {exams.length ? (
        <>
          <div className="a-sec">
            <h2 id="s-src-h">מה לתרגל</h2>
          </div>
          <div className="a-stack" role="radiogroup" aria-labelledby="s-src-h">
            {exams.map((e) => (
              <button
                key={e.id}
                type="button"
                className="a-card s-src"
                role="radio"
                aria-checked={exam?.id === e.id}
                onClick={() => {
                  setExamId(e.id);
                  setLen("");
                }}
              >
                <span className="s-dot" aria-hidden="true" />
                <b>
                  מבחן קודם · <bdi>{e.title}</bdi>
                </b>
                <span className="m">{[`${e.questions ?? 0} שאלות`, e.minutes ? minutesText(e.minutes) : "", "בדיוק כמו שהיה"].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>

          <div className="a-sec">
            <h2 id="s-len-h">אורך</h2>
          </div>
          <div className="a-grade s-len" role="radiogroup" aria-labelledby="s-len-h" data-n={lengths.length}>
            {lengths.map((l) => (
              <button key={l.key} type="button" role="radio" aria-checked={chosen?.key === l.key} onClick={() => setLen(l.key)}>
                {l.label}
                <small>{l.n} שאלות</small>
                <small>{minutesText(l.minutes)}</small>
              </button>
            ))}
          </div>
          <label className="a-li setting-row s-unseen">
            <span>רק שאלות שעוד לא ראיתי</span>
            <input type="checkbox" checked={unseen} onChange={(e) => setUnseen(e.target.checked)} />
          </label>
          <p className="a-small a-muted">שעון אחד לכל הסימולציה. התשובות נבדקות רק בסוף.</p>
        </>
      ) : (
        <section className="a-stack">
          <p className="a-para a-muted">עוד אין בקורס מבחן קודם מוכן. סימולציה נבנית ממבחן קודם שהשאלות שלו הועתקו.</p>
          <RouteLink to={{ v: "exams", isNew: true, c: course.id }} go={ctx.go} className="a-btn">
            העלאת מבחן קודם
          </RouteLink>
        </section>
      )}

      {exams.length ? (
        <StickyActions>
          <button type="button" className="a-btn primary wide" disabled={busy || !chosen} onClick={() => void start()}>
            {busy ? "פותחים…" : "להתחיל"}
          </button>
        </StickyActions>
      ) : null}
    </main>
  );
}
