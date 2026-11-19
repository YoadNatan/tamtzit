import type { Box, FigureGeo } from "../../../shared/study/figureGeo";
import { useState } from "react";
import { createLecture, type Group, type Lecture } from "../lib/api";
import { BankAfterUpload } from "../features/bank";
import { afterUpload, uploadNote } from "../features/writing";
import type { Ctx } from "../features/types";
import { BackLink, Head } from "./Shell";
import { guideMark } from "../lib/guideMark";
import { mimeFor, shrinkImage } from "../lib/images";
import { readPdf, ReadError, type PdfDeck } from "../lib/pdf";
import { readPptx, type Deck, type Slide } from "../lib/pptx";

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
};

type Parsed =
  | { kind: "pptx"; name: string; deck: Deck; slides: Slide[] }
  | { kind: "pdf"; name: string; deck: PdfDeck; slides: Slide[] };

const MAX_BYTES = 80 * 1024 * 1024;

/** The build, the file and the error, in one line a screenshot can carry. */
function readDetail(e: unknown, file: File | null): string {
  const build = document.querySelector<HTMLMetaElement>('meta[name="build"]')?.content.slice(0, 7) || "dev";
  const what = e instanceof ReadError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const mb = file ? ` · ${(file.size / 1048576).toFixed(1)} MB` : "";
  return `${build}${mb} · ${what}`.slice(0, 300);
}

const today = () => new Date().toISOString().slice(0, 10);

export default function Upload({ group, courses, ctx }: Props) {
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
    if (file.size > MAX_BYTES) return setError("הקובץ גדול מדי (יותר מ-80MB).");
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".ppt")) return setError("זה קובץ PowerPoint ישן (.ppt). צריך לשמור אותו כ-.pptx או לייצא ל-PDF ולהעלות שוב.");
    if (!lower.endsWith(".pptx") && !lower.endsWith(".pdf")) return setError("אפשר להעלות מצגת PowerPoint (.pptx) או PDF.");
    setReading(true);
    try {
      const buf = await file.arrayBuffer().catch((e: unknown) => {
        throw new ReadError("file", e);
      });
      const base = file.name.replace(/\.(pptx|pdf)$/i, "");
      if (lower.endsWith(".pptx")) {
        const deck = await readPptx(buf);
        if (!deck.slides.length) throw new Error("empty");
        setParsed({ kind: "pptx", name: file.name, deck, slides: deck.slides });
        setTitle(deck.slides[0]?.title || base);
      } else {
        const deck = await readPdf(buf);
        if (!deck.slides.length) throw new Error("empty");
        setParsed({ kind: "pdf", name: file.name, deck, slides: deck.slides });
        setTitle(base);
      }
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
      const figures =
        parsed.kind === "pptx"
          ? async (s: Slide) => {
              const out: Array<{ k: number; blob: Blob; width: number; height: number; geo?: FigureGeo; crop?: Box }> = [];
              for (const [i, path] of s.images.entries()) {
                try {
                  const bytes = await parsed.deck.image(path);
                  if (!bytes) continue;
                  const img = await shrinkImage(bytes, mimeFor(path));
                  if (img.width < 40 || img.height < 40) continue; // bullets and icons
                  const geo = s.geo?.[i];
                  const crop = s.crops?.[i];
                  // The labels' geometry and the slide's crop of the picture (question types).
                  out.push({ k: i + 1, ...img, ...(geo ? { geo } : {}), ...(crop ? { crop } : {}) });
                } catch {
                  // A picture the browser cannot decode (old EMF/WMF art) is skipped, not fatal.
                }
              }
              return out;
            }
          : async (s: Slide) => [{ k: 0, ...(await parsed.deck.pageImage(s.n)) }];
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
            <input className="a-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
