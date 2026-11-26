import { useCallback, useEffect, useMemo, useState } from "react";
import { listLectures, watchGroup, type LectureRow } from "../lib/api";
import { pickerDir } from "../lib/bidi";
import { courseKey, courseMerge, courseOverview, courseRename, coursesOf, courseSet, examLength, examWhen, lecturesWord, type CourseOverview, type CourseRow } from "../lib/courses";
import { examLengthLine, type CourseExam } from "../lib/exams";
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
 * "לתרגל מה שכבר יש · 184 שאלות · בחינם" (s=c.<course>, the questions its lectures
 * already have, $0) and "לשאול על כל הקורס". Under them, its lectures, and
 * "העלאה של כמה קבצים". Past exams (phase 2) are a segment of their own only
 * with VITE_STUDY_EXAMS; "נוצר בקבוצה" waits for its phase. */

const STATUS: Record<LectureRow["status"], { label: string; cls: string }> = {
  new: { label: "ממתינה לכתיבה", cls: "a-chip" },
  outlining: { label: "מתכנן את הסיכום", cls: "a-chip busy" },
  writing: { label: "נכתב עכשיו", cls: "a-chip busy" },
  ready: { label: "מוכן", cls: "a-chip ok" },
  failed: { label: "נתקע", cls: "a-chip bad" },
};

const EXAM_STATUS: Record<string, { label: string; cls: string }> = {
  ready: { label: "מוכן", cls: "a-chip ok" },
  failed: { label: "נתקע", cls: "a-chip bad" },
  uploading: { label: "לא עלה עד הסוף", cls: "a-chip" },
  new: { label: "לא עלה עד הסוף", cls: "a-chip" },
};

function formatDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${Number(day)}.${Number(m)}.${y}`;
}

/** The lectures of a course, in its order: by date (undated last), then by upload. */
/** A title that carries its own lecture number ("הרצאה 3 - משתנים", "שיעור 10", "Lecture 2"). */
const OWN_NUMBER = /(הרצאה|שיעור|lecture|lec)[\s_.\-]*\d/i;

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
  // Uploaded sheets (section O 1) are listed only with their flag; a build without it lists past exams only.
  const uploads = (course.exams as CourseExam[]).filter((e) => flags.sheets || e.kind !== "sheet");
  const examRows = uploads.filter((e) => e.kind !== "sheet");
  const sheetRows = uploads.filter((e) => e.kind === "sheet");
  const exams = examRows.length;
  // Past exams (phase 2): the newest ready exam is the simulation's and the replay's default (never a sheet: OD9).
  const readyAll = flags.exams ? uploads.filter((e) => e.status === "ready" && (e.questions ?? 0) > 0).sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1)) : [];
  const ready = readyAll.filter((e) => e.kind !== "sheet");
  const simulation = ready.some((e) => (e.questions ?? 0) >= 5);
  // "184 שאלות": what a course session may ask, the uploads' items too once they are on (s=c includes them).
  const free = course.questions + readyAll.reduce((n, e) => n + (e.questions ?? 0), 0);
  const lectureTitle = new Map((list ?? []).map((l) => [l.id, l.title]));
  const uploadRow = (e: CourseExam) => {
    const st = EXAM_STATUS[e.status] ?? { label: "בקריאה", cls: "a-chip busy" };
    const meta = e.status === "ready" ? examLengthLine(e) : e.status === "reading" || e.status === "linking" ? "מעתיקים את השאלות…" : "";
    const lec = e.lecture_id ? lectureTitle.get(e.lecture_id) : undefined;
    return (
      <li key={e.id}>
        <RouteLink to={{ v: "exams", e: e.id, c: course.id }} go={ctx.go} className="a-li c-row c-exam-row">
          <div>
            <b>
              <bdi>{e.title}</bdi>
            </b>
            {meta ? <span className="m">{meta}</span> : null}
            {lec ? (
              <span className="m">
                <bdi>{lec}</bdi>
              </span>
            ) : null}
          </div>
          <span className={st.cls}>{st.label}</span>
        </RouteLink>
      </li>
    );
  };
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
        {/* No past exam yet: the head says nothing of them ("מבחנים קודמים" below says it). */}
        {flags.exams && exams > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{exams === 1 ? "מבחן קודם אחד" : `${exams} מבחנים קודמים`}</span>
          </>
        ) : null}
        {sheetRows.length ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{sheetRows.length === 1 ? "דף תרגילים אחד" : `${sheetRows.length} דפי תרגילים`}</span>
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
        {simulation ? (
          <>
            <RouteLink to={{ v: "mock", c: course.id }} go={ctx.go} className="a-btn primary wide">
              סימולציה
            </RouteLink>
            <RouteLink to={{ v: "practice", s: `e.${ready[0].id}`, n: "all" }} go={ctx.go} className="a-btn wide">
              לתרגל מבחן קודם
            </RouteLink>
          </>
        ) : null}
        {flags.practice ? (
          free > 0 ? (
            <RouteLink to={{ v: "practice", s: `c.${course.name}` }} go={ctx.go} className={simulation ? "a-link c-free" : "a-btn primary wide c-free"}>
              {`לתרגל מה שכבר יש · ${free === 1 ? "שאלה אחת" : `${free} שאלות`} · בחינם`}
            </RouteLink>
          ) : (
            <p className="a-small a-muted c-free-none">עוד אין שאלות בהרצאות של הקורס. בתרגול של כל הרצאה, ״שאלות חדשות״ כותב אותן לכל הקבוצה, מהתקציב החודשי.</p>
          )
        ) : null}
        {flags.ask ? (
          noSummary ? (
            <>
              <button type="button" className="a-btn wide c-ask" disabled aria-describedby="c-ask-why">
                לשאול על כל הקורס
              </button>
              <p id="c-ask-why" className="a-small a-muted c-free-none">
                אפשר לשאול כשיהיה סיכום ראשון.
              </p>
            </>
          ) : (
            <RouteLink to={{ v: "ask", c: course.id }} go={ctx.go} className={`a-btn wide c-ask${(flags.practice && free > 0) || simulation ? "" : " primary"}`}>
              לשאול על כל הקורס
            </RouteLink>
          )
        ) : null}
        {/* No ready past exam yet: where the simulation and the replay come from. */}
        {flags.exams && !simulation ? <p className="a-small a-muted c-sim-none">״סימולציה״ ו״לתרגל מבחן קודם״ נפתחים אחרי שמבחן קודם מועתק, ב״מבחנים קודמים״ למטה.</p> : null}
      </div>

      {flags.exams ? (
        <div className="a-seg c-seg" role="tablist" aria-label="מה בקורס">
          <button type="button" className="a-btn small" role="tab" aria-selected={seg === "exams"} onClick={() => ctx.go({ v: "course", c: course.id, seg: "exams" }, { replace: true })}>
            {flags.sheets ? "מבחנים ותרגילים" : "מבחנים קודמים"}
          </button>
          <button type="button" className="a-btn small" role="tab" aria-selected={seg === "lectures"} onClick={() => ctx.go({ v: "course", c: course.id, seg: "lectures" }, { replace: true })}>
            הרצאות
          </button>
        </div>
      ) : null}

      {seg === "exams" && flags.sheets ? (
        // Uploaded sheets (design-exams §5.1): one segment for both kinds, the upload first, then each kind under its heading.
        <section className="a-stack c-uploads" aria-label="מבחנים ותרגילים">
          <RouteLink to={{ v: "exams", isNew: true, c: course.id }} go={ctx.go} className="a-btn primary wide">
            העלאת מבחן או דף תרגילים
          </RouteLink>
          {uploads.length ? (
            <>
              {examRows.length ? (
                <>
                  <div className="a-sec">
                    <h2>מבחנים קודמים</h2>
                  </div>
                  <ul className="a-list">{examRows.map(uploadRow)}</ul>
                </>
              ) : null}
              {sheetRows.length ? (
                <>
                  <div className="a-sec">
                    <h2>דפי תרגילים</h2>
                  </div>
                  <ul className="a-list">{sheetRows.map(uploadRow)}</ul>
                </>
              ) : null}
            </>
          ) : (
            <p className="a-para a-muted">עוד אין כאן מבחנים או דפי תרגילים. מעלים PDF או צילום, ואז אפשר לתרגל אותם כמו בדף.</p>
          )}
        </section>
      ) : seg === "exams" ? (
        <section className="a-stack" aria-label="מבחנים קודמים">
          {examRows.length ? (
            <ul className="a-list">{examRows.map(uploadRow)}</ul>
          ) : (
            <p className="a-para a-muted">עוד אין מבחנים קודמים בקורס. מעלים PDF או צילום של מבחן משנים קודמות, ואז אפשר לתרגל אותו או לעשות סימולציה עם שעון.</p>
          )}
          <RouteLink to={{ v: "exams", isNew: true, c: course.id }} go={ctx.go} className="a-btn">
            העלאת מבחן קודם
          </RouteLink>
        </section>
      ) : (
        <section className="a-stack" aria-labelledby="c-lectures-h">
          <div className="a-sec">
            <h2 id="c-lectures-h">הרצאות</h2>
            <RouteLink to={{ v: "upload", many: true, c: course.id }} go={ctx.go} className="a-link c-many">
              העלאה של כמה קבצים
            </RouteLink>
          </div>
          {list === null ? (
            <Loading />
          ) : list.length ? (
            <ul className="a-list">
              {list.map((l, i) => {
                const status = l.status === "new" && l.queued_at ? { label: "ממתינה לשרת", cls: "a-chip" } : STATUS[l.status];
                return (
                  <li key={l.id}>
                    <RouteLink to={{ v: "lecture", l: l.id }} go={ctx.go} className="a-li c-row">
                      <div>
                        <b dir="auto">{l.title}</b>
                        {/* Its place in the course; left out when the title has its own number ("הרצאה 3 - משתנים" is not "הרצאה 2"). */}
                        <span className="m">{[!OWN_NUMBER.test(l.title) && `הרצאה ${i + 1}`, formatDate(l.lecture_date), l.lecturer].filter(Boolean).join(" · ")}</span>
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
          <p className="a-small a-muted">מה שמשנים כאן משתנה לכל הקבוצה.</p>
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
            <p className="a-small a-muted">השם משתנה בכל ההרצאות של הקורס.</p>
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
