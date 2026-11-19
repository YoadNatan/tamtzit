import { useCallback, useEffect, useMemo, useState } from "react";
import { listLectures, watchGroup, type LectureRow } from "../lib/api";
import { pickerDir } from "../lib/bidi";
import { courseKey, courseMerge, courseOverview, courseRename, coursesOf, courseSet, examLength, examWhen, lecturesWord, type CourseOverview, type CourseRow } from "../lib/courses";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import type { ScreenProps } from "../features/types";
import { BackLink, Head, Loading, RouteLink, Sheet } from "./Shell";
import "../styles/courses.css";

/* ── A course's page (sources.md, phase 1; mockup course.html) ──
 *
 * ?v=course&c=<id>: the home of one course. Its head says how many lectures
 * (and, with past exams, how many exams) it has; a card says when the exam is
 * and how long ("המבחן ב-12.2 · עוד 23 ימים", "100 שאלות · 3 שעות"), set in
 * the course's sheet with its name and "לאחד קורסים". Then what to do now:
 * "לתרגל מה שכבר יש · בחינם (184)" (s=c.<course>, the questions its lectures
 * already have, $0) and "לשאול על כל הקורס". Under them, its lectures, and
 * "העלאה של כמה קבצים". Past exams (phase 2) are a segment of their own only
 * with VITE_STUDY_EXAMS; "נוצר בקבוצה" waits for its phase. */

const STATUS: Record<LectureRow["status"], { label: string; cls: string }> = {
  new: { label: "ממתין לכתיבה", cls: "a-chip" },
  outlining: { label: "מתכנן את הסיכום", cls: "a-chip busy" },
  writing: { label: "נכתב עכשיו", cls: "a-chip busy" },
  ready: { label: "מוכן", cls: "a-chip ok" },
  failed: { label: "נתקע", cls: "a-chip bad" },
};

const EXAM_STATUS: Record<string, { label: string; cls: string }> = {
  ready: { label: "מוכן", cls: "a-chip ok" },
  failed: { label: "נתקע", cls: "a-chip bad" },
};

function formatDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${Number(day)}.${Number(m)}.${y}`;
}

/** The lectures of a course, in its order: by date (undated last), then by upload. */
function inCourse(lectures: LectureRow[], key: string): LectureRow[] {
  return lectures
    .filter((l) => courseKey(l.course) === key)
    .sort((a, b) => {
      if (a.lecture_date && b.lecture_date && a.lecture_date !== b.lecture_date) return a.lecture_date < b.lecture_date ? -1 : 1;
      if (Boolean(a.lecture_date) !== Boolean(b.lecture_date)) return a.lecture_date ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    });
}

export default function CourseScreen({ route, ctx }: ScreenProps<"course">) {
  const [course, setCourse] = useState<CourseOverview | null>(null);
  const [lectures, setLectures] = useState<LectureRow[] | null>(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(false);
  const groupId = ctx.group.id;

  const load = useCallback(async () => {
    try {
      const [o, ls] = await Promise.all([courseOverview(route.c), listLectures(groupId)]);
      setCourse(o);
      setLectures(ls);
      setError("");
    } catch (e) {
      setError(failText(e instanceof Error ? e.message : "", "course"));
    }
  }, [route.c, groupId]);

  // Summaries a batch left for next month start once it has come (lib/later.ts).
  useEffect(() => {
    void import("../features/courses").then(({ releaseWaiting }) => releaseWaiting(groupId));
  }, [groupId]);

  useEffect(() => {
    void load();
    // A lecture uploaded or written meanwhile: the list and the counts follow.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchGroup(groupId, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 600);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [load, groupId]);

  const list = useMemo(() => (course && lectures ? inCourse(lectures, courseKey(course.name)) : null), [course, lectures]);
  const seg = flags.exams && route.seg === "exams" ? "exams" : "lectures";

  if (error && !course)
    return (
      <main className="course-page">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "library" }} />} title="קורס" />
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!course) return <Loading />;

  const when = examWhen(course.exam_date, course.days_left);
  const length = examLength(course.exam_n, course.exam_minutes);
  const exams = course.exams.length;
  // The course question reads ready parts: none while no lecture is ready or
  // being written (a lecture being written may have ready parts already).
  const noSummary = course.ready === 0 && list !== null && !list.some((l) => l.status === "writing");

  return (
    <main className="course-page">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "library" }} />} title={<bdi>{course.name}</bdi>}>
        <button type="button" className="a-btn ghost icon" aria-label="הגדרות הקורס" onClick={() => setSheet(true)}>
          ⋯
        </button>
      </Head>
      <p className="ph-sub">
        <span>{lecturesWord(course.lectures)}</span>
        {flags.exams ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{exams === 1 ? "מבחן קודם אחד" : `${exams} מבחנים קודמים`}</span>
          </>
        ) : null}
      </p>

      <section className="a-card c-exam" aria-label="המבחן">
        <div className="c-when">
          {when ? (
            <>
              <span className="a-small a-muted">{when.when}</span>
              {when.left ? <span className="c-days">{when.left}</span> : null}
            </>
          ) : (
            <>
              <span className="a-small a-muted">המבחן</span>
              <span className="c-none">עוד אין תאריך</span>
            </>
          )}
          {length ? <span className="a-chip group c-len">{length}</span> : null}
        </div>
        <button type="button" className="a-btn small" onClick={() => setSheet(true)}>
          {when ? "לשנות" : "להוסיף תאריך"}
        </button>
      </section>

      <div className="c-actions">
        {flags.practice ? (
          course.questions > 0 ? (
            <RouteLink to={{ v: "practice", s: `c.${course.name}` }} go={ctx.go} className="a-btn primary wide c-free">
              {`לתרגל מה שכבר יש · בחינם (${course.questions})`}
            </RouteLink>
          ) : (
            <p className="a-small a-muted c-free-none">עוד אין שאלות בהרצאות של הקורס. יוצרים אותן בתרגול של כל הרצאה.</p>
          )
        ) : null}
        {flags.ask ? (
          noSummary ? (
            <>
              <button type="button" className="a-btn wide" disabled aria-describedby="c-ask-why">
                לשאול על כל הקורס
              </button>
              <p id="c-ask-why" className="a-small a-muted c-free-none">
                אפשר לשאול כשיהיה סיכום ראשון.
              </p>
            </>
          ) : (
            <RouteLink to={{ v: "ask", c: course.id }} go={ctx.go} className={`a-btn wide${flags.practice && course.questions > 0 ? "" : " primary"}`}>
              לשאול על כל הקורס
            </RouteLink>
          )
        ) : null}
      </div>

      {flags.exams ? (
        <div className="a-seg c-seg" role="tablist" aria-label="מה בקורס">
          <button type="button" className="a-btn small" role="tab" aria-selected={seg === "exams"} onClick={() => ctx.go({ v: "course", c: course.id, seg: "exams" }, { replace: true })}>
            מבחנים קודמים
          </button>
          <button type="button" className="a-btn small" role="tab" aria-selected={seg === "lectures"} onClick={() => ctx.go({ v: "course", c: course.id, seg: "lectures" }, { replace: true })}>
            הרצאות
          </button>
        </div>
      ) : null}

      {seg === "exams" ? (
        <section className="a-stack" aria-label="מבחנים קודמים">
          {course.exams.length ? (
            <ul className="a-list">
              {course.exams.map((e) => {
                const st = EXAM_STATUS[e.status] ?? { label: "בקריאה", cls: "a-chip busy" };
                return (
                  <li key={e.id}>
                    <RouteLink to={{ v: "exams", e: e.id }} go={ctx.go} className="a-li c-row">
                      <div>
                        <b>
                          <bdi>{e.title}</bdi>
                        </b>
                      </div>
                      <span className={st.cls}>{st.label}</span>
                    </RouteLink>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="a-para a-muted">עוד אין מבחנים קודמים בקורס.</p>
          )}
          <RouteLink to={{ v: "exams", isNew: true, c: course.id }} go={ctx.go} className="a-btn">
            העלאת מבחן קודם
          </RouteLink>
        </section>
      ) : (
        <section className="a-stack" aria-labelledby="c-lectures-h">
          <div className="a-sec">
            <h2 id="c-lectures-h">הרצאות</h2>
            <RouteLink to={{ v: "upload", many: true, c: course.id }} go={ctx.go} className="a-link">
              העלאה של כמה קבצים
            </RouteLink>
          </div>
          {list === null ? (
            <Loading />
          ) : list.length ? (
            <ul className="a-list">
              {list.map((l, i) => {
                const status = l.status === "new" && l.queued_at ? { label: "ממתין לשרת", cls: "a-chip" } : STATUS[l.status];
                return (
                  <li key={l.id}>
                    <RouteLink to={{ v: "lecture", l: l.id }} go={ctx.go} className="a-li c-row">
                      <div>
                        <b dir="auto">{l.title}</b>
                        <span className="m">{[`הרצאה ${i + 1}`, formatDate(l.lecture_date), l.lecturer].filter(Boolean).join(" · ")}</span>
                      </div>
                      <span className={status.cls}>{status.label}</span>
                    </RouteLink>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="a-para a-muted">עוד אין הרצאות בקורס.</p>
          )}
        </section>
      )}

      {sheet ? <CourseSheet ctx={ctx} course={course} onClose={() => setSheet(false)} onSaved={() => void load()} /> : null}
    </main>
  );
}

const num = (s: string): number | null => (s.trim() ? Number(s) : null);

/** The course's sheet: the exam's date and length, its name, and "לאחד קורסים". */
function CourseSheet({ ctx, course, onClose, onSaved }: { ctx: ScreenProps<"course">["ctx"]; course: CourseOverview; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(course.exam_date ?? "");
  const [minutes, setMinutes] = useState(course.exam_minutes ? String(course.exam_minutes) : "");
  const [n, setN] = useState(course.exam_n ? String(course.exam_n) : "");
  const [name, setName] = useState(course.name);
  const [others, setOthers] = useState<CourseRow[]>([]);
  const [into, setInto] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    coursesOf(ctx.group.id)
      .then((rows) => alive && setOthers(rows.filter((r) => r.id !== course.id)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, course.id]);

  const run = async (what: string, act: () => Promise<void>, done: () => void) => {
    setBusy(what);
    setError("");
    try {
      await act();
      done();
    } catch (e) {
      setError(failText(e instanceof Error ? e.message : "", "course"));
    } finally {
      setBusy("");
    }
  };

  const badNumber = (s: string, lo: number, hi: number) => s.trim() !== "" && !(/^\d{1,3}$/.test(s.trim()) && Number(s) >= lo && Number(s) <= hi);
  const target = others.find((o) => o.id === into);

  return (
    <Sheet label="הגדרות הקורס" className="c-sheet" head={<h2>הגדרות הקורס</h2>} onClose={onClose}>
      {(s) => (
        <div className="a-stack">
          <form
            className="a-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run("exam", () => courseSet(course.id, { examDate: date || null, minutes: num(minutes), n: num(n) }), () => {
                onSaved();
                s.closeThen(() => ctx.say("נשמר."));
              });
            }}
          >
            <h3 className="c-h3">המבחן</h3>
            <label className="a-field">
              <span>תאריך המבחן</span>
              <input className="a-input" type="date" dir={pickerDir()} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="a-row c-nums">
              <label className="a-field">
                <span>כמה שאלות</span>
                <input className="a-input" inputMode="numeric" dir={n ? "ltr" : "rtl"} value={n} onChange={(e) => setN(e.target.value)} placeholder="למשל 100" maxLength={3} />
              </label>
              <label className="a-field">
                <span>כמה דקות</span>
                <input className="a-input" inputMode="numeric" dir={minutes ? "ltr" : "rtl"} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="למשל 180" maxLength={3} />
              </label>
            </div>
            {badNumber(n, 5, 300) ? <p className="a-small a-error">{failText("bad questions", "course")}</p> : null}
            {badNumber(minutes, 10, 600) ? <p className="a-small a-error">{failText("bad minutes", "course")}</p> : null}
            <button type="submit" className="a-btn primary" disabled={busy !== "" || badNumber(n, 5, 300) || badNumber(minutes, 10, 600)}>
              לשמור
            </button>
          </form>

          <form
            className="a-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run("name", () => courseRename(course.id, name), () => {
                onSaved();
                s.closeThen(() => ctx.say("השם השתנה בכל ההרצאות של הקורס."));
              });
            }}
          >
            <h3 className="c-h3">השם</h3>
            <label className="a-field">
              <span>שם הקורס</span>
              <input className="a-input" dir="auto" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" className="a-btn" disabled={busy !== "" || !name.trim() || name.trim() === course.name}>
              לשנות שם
            </button>
          </form>

          {others.length ? (
            <form
              className="a-stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (!target) return;
                void run("merge", () => courseMerge(course.id, target.id), () =>
                  s.closeThen(() => {
                    ctx.say("הקורסים אוחדו.");
                    ctx.go({ v: "course", c: target.id }, { replace: true });
                  }),
                );
              }}
            >
              <h3 className="c-h3">לאחד קורסים</h3>
              <label className="a-field">
                <span>זה אותו קורס כמו</span>
                <select className="a-input" value={into} onChange={(e) => setInto(e.target.value)}>
                  <option value="">לבחור קורס</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              {target ? (
                <p className="a-small a-muted">
                  כל ההרצאות של <bdi>״{course.name}״</bdi> יעברו ל<bdi>״{target.name}״</bdi>, והקורס <bdi>״{course.name}״</bdi> יימחק מהרשימה. אי אפשר לבטל את זה.
                </p>
              ) : null}
              <button type="submit" className="a-btn" disabled={busy !== "" || !target}>
                {target ? (
                  <>
                    לאחד עם <bdi>״{target.name}״</bdi>
                  </>
                ) : (
                  "לאחד"
                )}
              </button>
            </form>
          ) : null}

          {error ? (
            <p className="a-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
