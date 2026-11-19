import { Suspense, useState } from "react";
import { createLecture, type Group, type Lecture } from "../lib/api";
import { BankAfterUpload } from "../features/bank";
import { UploadManyScreen } from "../features/courses";
import { afterUpload, uploadNote } from "../features/writing";
import type { Ctx } from "../features/types";
import { BackLink, Head, Loading, RouteLink } from "./Shell";
import { flags } from "../lib/flags";
import { guideMark } from "../lib/guideMark";
import { ReadError } from "../lib/pdf";
import { baseName, figuresOf, fileProblem, readDeck, type Parsed } from "../lib/readDeck";
import type { Route } from "../lib/route";
import { pickerDir } from "../lib/bidi";

/* ── Adding a lecture ──
 * The deck is read right here in the browser (nothing big leaves the phone
 * except shrunken pictures), then the slides and pictures are saved for the
 * group and the summary starts. W's slot words the saving line and queues the
 * server writer once the slides are saved; then B's slot opens the lecture
 * (§12.2.3). It asks nothing: Yoad's decision 2 of 17 Nov 2026 removed
 * "להכין גם שאלות וכרטיסיות?" (no question or card is written automatically;
 * the points to know are read after the summary, on the server). */

type Props = {
  group: Group;
  courses: string[];
  ctx: Ctx;
  route?: Extract<Route, { v: "upload" }>;
};

/** The build, the file and the error, in one line a screenshot can carry. */
function readDetail(e: unknown, file: File | null): string {
  const build = document.querySelector<HTMLMetaElement>('meta[name="build"]')?.content.slice(0, 7) || "dev";
  const what = e instanceof ReadError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const mb = file ? ` · ${(file.size / 1048576).toFixed(1)} MB` : "";
  return `${build}${mb} · ${what}`.slice(0, 300);
}

const today = () => new Date().toISOString().slice(0, 10);

export default function Upload(p: Props) {
  // "העלאה של כמה קבצים" (sources.md, phase 1): its own screen, lazily (allowed() keeps it to the course pages' flag).
  if (p.route?.many)
    return (
      <Suspense fallback={<Loading />}>
        <UploadManyScreen ctx={p.ctx} courses={p.courses} courseId={p.route.c ?? null} />
      </Suspense>
    );
  return <UploadOne {...p} />;
}

function UploadOne({ group, courses, ctx }: Props) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [reading, setReading] = useState(false);
  const [title, setTitle] = useState("");
  const [lecturer, setLecturer] = useState("");
  const [course, setCourse] = useState(courses[0] ?? "");
  const [date, setDate] = useState(today);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  /** Small print under a reading error: the build and where it failed, for a screenshot. */
  const [detail, setDetail] = useState("");
  const [saved, setSaved] = useState<Lecture | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setDetail("");
    setParsed(null);
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    setReading(true);
    try {
      const deck = await readDeck(file);
      setParsed(deck);
      setTitle((deck.kind === "pptx" && deck.slides[0]?.title) || baseName(file.name));
    } catch (e) {
      setError("לא הצלחנו לקרוא את הקובץ. אם הוא נפתח כרגיל במחשב, אפשר לייצא אותו ל-PDF ולנסות שוב.");
      setDetail(readDetail(e, file));
    } finally {
      setReading(false);
    }
  };

  const start = async () => {
    if (!parsed) return;
    setError("");
    setDetail("");
    setProgress({ done: 0, total: parsed.slides.length });
    try {
      const figures = figuresOf(parsed);
      const { id, lecture, figurePaths } = await createLecture(
        {
          groupId: group.id,
          title,
          lecturer,
          course,
          date,
          sourceName: parsed.name,
          kind: parsed.kind,
          slides: parsed.slides,
          figures,
        },
        (done, total) => setProgress({ done, total }),
      );
      guideMark("upload"); // the guide's first step "להעלות הרצאה ראשונה" (nothing without VITE_STUDY_GUIDE)
      await afterUpload(lecture, figurePaths).catch(() => undefined);
      setSaved({ ...lecture, id });
    } catch (e) {
      setProgress(null);
      setError("השמירה נכשלה באמצע. כדאי לבדוק את החיבור ולנסות שוב.");
      setDetail(readDetail(e, null));
    }
  };

  const textCount = parsed ? parsed.slides.reduce((n, s) => n + s.lines.join(" ").length, 0) : 0;

  return (
    <main className="upload">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "library" }} disabled={!!progress} />} title="הרצאה חדשה" />

      <label className={`a-card dashed drop${parsed ? " has-file" : ""}`}>
        <input
          type="file"
          accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={(e) => void pick(e.target.files?.[0])}
          disabled={reading || !!progress}
        />
        {reading ? (
          <span>קורא את המצגת…</span>
        ) : parsed ? (
          <span>
            <strong dir="auto">{parsed.name}</strong>
            <br />
            {parsed.slides.length} שקפים
            {parsed.kind === "pptx" ? `, ${parsed.slides.reduce((n, s) => n + s.images.length, 0)} תמונות` : ""}
            {textCount < 50 * parsed.slides.length && parsed.kind === "pdf"
              ? " · כמעט בלי טקסט, הסיכום ייעזר בתמונות העמודים"
              : ""}
          </span>
        ) : (
          <span>
            <strong>בחירת קובץ</strong>
            <br />
            מצגת PowerPoint ‏(.pptx) או PDF
          </span>
        )}
      </label>
      {flags.courses && !parsed && !reading ? (
        <p className="a-small up-many">
          <RouteLink to={{ v: "upload", many: true }} go={ctx.go} className="a-link">
            להעלות כמה קבצים יחד
          </RouteLink>
        </p>
      ) : null}
      {saved ? (
        // The finished form is replaced in history: Back from the lecture goes where Upload came from.
        <BankAfterUpload ctx={ctx} lecture={saved} onDone={() => ctx.go({ v: "lecture", l: saved.id }, { replace: true })} />
      ) : null}

      {parsed ? (
        <div className="a-stack upload-form">
          <label className="a-field">
            <span>שם ההרצאה</span>
            <input className="a-input" value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" maxLength={200} />
          </label>
          <label className="a-field">
            <span>מרצה</span>
            <input className="a-input" value={lecturer} onChange={(e) => setLecturer(e.target.value)} dir="auto" maxLength={120} placeholder="למשל: ד״ר כהן" />
          </label>
          <label className="a-field">
            <span>קורס או בלוק</span>
            <input
              className="a-input"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              list="study-courses"
              dir="auto"
              maxLength={120}
              placeholder="למשל: פתוגן-מאכסן"
            />
            <datalist id="study-courses">
              {courses.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="a-field">
            <span>תאריך ההרצאה</span>
            <input className="a-input" type="date" dir={pickerDir()} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      {error && detail ? (
        <p className="a-small a-muted upload-detail" dir="ltr">
          {detail}
        </p>
      ) : null}

      {progress ? (
        <div className="a-stack upload-progress" role="status">
          <div className="a-bar">
            <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
          <span className="a-small a-muted">{uploadNote(progress.done, progress.total)}</span>
        </div>
      ) : parsed ? (
        <div className="ph-foot">
          <button className="a-btn primary wide" onClick={() => void start()} disabled={!title.trim()}>
            יצירת סיכום
          </button>
        </div>
      ) : null}
    </main>
  );
}
