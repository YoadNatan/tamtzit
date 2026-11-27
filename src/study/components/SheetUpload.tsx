import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { courseKey } from "../../../shared/study/courseKey";
import { examPriceUsd, priceText } from "../../../shared/study/examPrice";
import { SHEET_CONFIRM_USD, SHEET_KEY_MAX_PAGES, SHEET_MAX_PAGES, sheetMinutes, sheetReaderPriceUsd } from "../../../shared/study/sheetPrice";
import { listLectures, type LectureRow } from "../lib/api";
import { courseOverview, type CourseOverview } from "../lib/courses";
import { MAX_EXAM_PAGES, MAX_PHOTOS, openExamPdf, photoPage, type ExamPageFile, type ExamPdf } from "../lib/examPages";
import { examCreate, pageRows, signPages, uploadExamPages, type KeySource } from "../lib/exams";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import {
  fallbackName,
  isImage,
  isPdf,
  isWord,
  looksLikeCover,
  nameFromFile,
  pageQuality,
  QUALITY_SIDE,
  qualityLine,
  qualityProblem,
  sheetCreate,
  sheetFail,
  sheetReadStart,
  sizeLine,
  type UploadKind,
} from "../lib/sheets";
import { writingHelp } from "../features/writing";
import type { ScreenProps } from "../features/types";
import { holdScreen, setDrive } from "./ExamParts";
import { BackLink, Head, Loading, StickyActions } from "./Shell";
import "../styles/exams.css";
import "../styles/sheets.css";
import { radioProps } from "../lib/radios";

/* ── "העלאת מבחן או דף תרגילים" (uploaded sheets, release A0; design-exams
 *    §5.2-5.4, docs/study/sheets.md) ──
 *
 * ?v=exams&new=1&c=<course> (a past exam by default) or &new=sheet[&l=<lecture>]
 * (an exercise sheet, from a lecture's page). VITE_STUDY_SHEETS; without it
 * the past exams' own upload (ExamUpload) is on screen.
 *
 * Step 1 is the only thing on screen: two tiles, "קובץ PDF" and "לצלם דפים",
 * inside a drop zone (a computer drops or pastes PDFs and pictures there, and
 * several files become one upload's pages in order), and the Word line. Step
 * 2 appears under the pages once there is one: what it is ("מבחן קודם" /
 * "דף תרגילים"), a sheet's name (from the file's) and its one lecture (not
 * needed), a past exam's year, מועד and minutes, and where the answers are.
 * The pages are tiles in order (moved, turned, removed); a photo too blurred
 * or too dark says so under them with "לצלם שוב"; a PDF whose page 1 looks
 * like a cover (a name or an ID to fill in) offers to leave it out. The
 * button carries the usual price, and under it the pages and the minutes; a
 * sheet above $3 asks once more. From 760 px wide the pages and the details
 * are two columns. Then the pages are drawn (1,500 px), uploaded, signed and
 * handed over as a past exam's are, and the upload's own screen follows. */

type Quality = { sharp: number; light: number };
type Part =
  | {
      id: number;
      kind: "pdf";
      name: string;
      pdf: ExamPdf;
      skip: number;
      sig?: string;
      thumbs?: Array<string | null>;
    }
  | {
      id: number;
      kind: "photo";
      name: string;
      sig?: string;
      file: File;
      url: string;
      turns: number;
      quality: Quality | null;
    };
const MOEDS = ["א׳", "ב׳", "ג׳"];
const KEYS: Array<{ v: KeySource; label: string }> = [
  { v: "marked", label: "מסומנות על הדף" },
  { v: "separate", label: "בקובץ נפרד" },
  { v: "none", label: "אין תשובות" },
];
const KINDS: Array<{ v: UploadKind; label: string }> = [
  { v: "exam", label: "מבחן קודם" },
  { v: "sheet", label: "דף תרגילים" },
];
const WORD = "קובץ Word? צריך קודם לשמור אותו כ-PDF.";
/** The same file picked again: its name, size and time. */
const sigOf = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

let seq = 0;
const pagesOf = (parts: readonly Part[]) => parts.reduce((n, p) => n + (p.kind === "pdf" ? p.pdf.count - p.skip : 1), 0);
const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

/** A photo's sharpness and light on a small copy (the camera's checks, lib/sheets.ts). */
async function measure(file: File): Promise<Quality | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, QUALITY_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(3, Math.round(img.naturalWidth * k));
    const h = Math.max(3, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, w, h);
    const q = pageQuality(g.getImageData(0, 0, w, h));
    c.width = 0;
    return q;
  } catch {
    return null; // a picture the browser cannot decode here (HEIC on a computer): no check, it uploads as before
  } finally {
    URL.revokeObjectURL(url);
  }
}

function FileIcon() {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export default function SheetUpload({ route, ctx }: ScreenProps<"exams">) {
  const courseId = route.c ?? "";
  const [course, setCourse] = useState<CourseOverview | null>(null);
  const [lectures, setLectures] = useState<LectureRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState<UploadKind>(route.isNew === "sheet" || route.l ? "sheet" : "exam");
  const [parts, setParts] = useState<Part[]>([]);
  const [keyParts, setKeyParts] = useState<Part[]>([]);
  const [name, setName] = useState("");
  const named = useRef(false);
  const [lecture, setLecture] = useState(route.l ?? "");
  const [year, setYear] = useState("");
  const [moed, setMoed] = useState(MOEDS[0]);
  const [minutes, setMinutes] = useState("");
  const [keySource, setKeySource] = useState<KeySource>("marked");
  const [coverOff, setCoverOff] = useState(false);
  const [asking, setAsking] = useState<File[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  // An alertdialog has the focus (a screen reader says it): the confirmation's and the question's first button.
  const confirmRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);
  useEffect(() => {
    if (asking) askRef.current?.focus();
  }, [asking]);
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{
    field: string;
    text: string;
  } | null>(null);
  const made = useRef<{
    exam_id: string;
    prefix: string;
    kind: UploadKind;
  } | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const retake = useRef<{ input: HTMLInputElement | null; id: number | null }>({
    input: null,
    id: null,
  });
  const progRef = useRef<HTMLElement>(null);
  const groupId = ctx.group.id;
  const sending = Boolean(busy);

  useEffect(() => {
    courseOverview(courseId)
      .then(setCourse)
      .catch((e: unknown) => setLoadError(failText(codeOf(e), "course")));
  }, [courseId]);
  useEffect(() => {
    listLectures(groupId)
      .then(setLectures)
      .catch(() => setLectures([])); // the lecture is not needed: without the list there is no picker
  }, [groupId]);
  // Thumbnails' object URLs go with the screen.
  const all = useRef<Part[]>([]);
  all.current = [...parts, ...keyParts];
  const mounted = useRef(true);
  const urlsOf = (p: Part) => (p.kind === "photo" ? [p.url] : (p.thumbs ?? []).filter((u): u is string => Boolean(u)));
  useEffect(
    () => () => {
      mounted.current = false;
      all.current.forEach((p) => urlsOf(p).forEach((u) => URL.revokeObjectURL(u)));
    },
    [],
  );
  useEffect(() => {
    if (sending) progRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [sending]);
  // Leaving while pages are on their way asks first.
  useEffect(() => {
    if (!busy) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [busy]);

  const courseLectures = useMemo(() => (course ? lectures.filter((l) => courseKey(l.course) === courseKey(course.name)) : []), [course, lectures]);
  const pages = pagesOf(parts);
  const keyPages = keySource === "separate" ? pagesOf(keyParts) : 0;
  // Release A1 (VITE_STUDY_SHEETS_FORMS): a sheet is read by the sheet reader, at its price; a past exam as before.
  const forms = flags.sheetForms && kind === "sheet";
  const price = useMemo(() => (forms ? sheetReaderPriceUsd({ pages, keyPages, keySource }) : examPriceUsd({ pages, keyPages, keySource })), [forms, pages, keyPages, keySource]);
  const span = sheetMinutes({ pages, keyPages, keySource });
  const first = parts[0];
  const cover = first?.kind === "pdf" && first.skip === 0 && !coverOff && looksLikeCover(first.pdf.firstLines);
  const maxPages = kind === "sheet" ? SHEET_MAX_PAGES : MAX_EXAM_PAGES;
  const tooMany = pages > maxPages || (kind === "sheet" && keyPages > SHEET_KEY_MAX_PAGES) || pages + keyPages > MAX_EXAM_PAGES;

  /** Files into the pages (or the answers file), in the order given: PDFs opened, photos measured. */
  const addFiles = useCallback(async (files: File[], to: "main" | "key") => {
    setError("");
    setFieldError(null);
    const word = files.filter(isWord);
    const usable = files.filter((f) => isPdf(f) || isImage(f));
    if (word.length && !usable.length)
      return setFieldError({
        field: to === "key" ? "key" : "file",
        text: WORD,
      });
    if (usable.length < files.length - word.length || (word.length && usable.length))
      setFieldError({
        field: to === "key" ? "key" : "file",
        text: word.length ? WORD : "אפשר להעלות קובץ PDF או תמונות של הדפים.",
      });
    const set = to === "key" ? setKeyParts : setParts;
    const out: Part[] = [];
    // The same file picked twice (a double tap in Files): kept once, and said so.
    const have = new Set(all.current.map((p) => p.sig).filter(Boolean));
    const fresh = usable.filter((f) => !have.has(sigOf(f)));
    if (fresh.length < usable.length)
      setFieldError({
        field: to === "key" ? "key" : "file",
        text: fresh.length ? "קובץ שכבר בהעלאה לא נוסף שוב." : "הקובץ הזה כבר בהעלאה.",
      });
    setOpening((n) => n + 1);
    try {
      for (const f of fresh) {
        if (isPdf(f)) {
          try {
            out.push({
              id: ++seq,
              kind: "pdf",
              name: f.name,
              sig: sigOf(f),
              pdf: await openExamPdf(f),
              skip: 0,
            });
          } catch {
            setFieldError({
              field: to === "key" ? "key" : "file",
              text: `לא הצלחנו לקרוא את ${f.name}. אפשר לנסות קובץ PDF אחר, או לצלם את הדפים.`,
            });
          }
        } else
          out.push({
            id: ++seq,
            kind: "photo",
            name: f.name,
            sig: sigOf(f),
            file: f,
            url: URL.createObjectURL(f),
            turns: 0,
            quality: null,
          });
      }
    } finally {
      setOpening((n) => n - 1);
    }
    if (!out.length) return;
    set((ps) => {
      const photos = [...ps, ...out].filter((p) => p.kind === "photo").length;
      if (photos > MAX_PHOTOS)
        setFieldError({
          field: to === "key" ? "key" : "file",
          text: `אפשר עד ${MAX_PHOTOS} תמונות בהעלאה אחת.`,
        });
      let left = MAX_PHOTOS - ps.filter((p) => p.kind === "photo").length;
      return [...ps, ...out.filter((p) => p.kind === "pdf" || left-- > 0)];
    });
    // A PDF's first two pages drawn small: the tile shows the first page sent (the cover question's page 1).
    for (const p of out)
      if (p.kind === "pdf")
        void Promise.all([p.pdf.thumb(1), p.pdf.thumb(2)])
          .then((thumbs) => {
            if (!mounted.current) return thumbs.forEach((u) => u && URL.revokeObjectURL(u));
            set((ps) => ps.map((x) => (x.id === p.id && x.kind === "pdf" ? { ...x, thumbs } : x)));
          })
          .catch(() => undefined);
    // The first file names a sheet, until the name is typed.
    if (to === "main" && !named.current) {
      named.current = true;
      setName((n) => n || nameFromFile(out[0].name));
    }
    for (const p of out)
      if (p.kind === "photo") void measure(p.file).then((quality) => set((ps) => ps.map((x) => (x.id === p.id && x.kind === "photo" ? { ...x, quality } : x))));
  }, []);

  /** A drop or a paste: a second file while "בקובץ נפרד" is chosen asks whether it is the answers file. */
  const received = useCallback(
    (files: File[]) => {
      if (!files.length || sending) return;
      if (parts.length && keySource === "separate" && !keyParts.length) setAsking(files);
      else void addFiles(files, "main");
    },
    [addFiles, parts.length, keySource, keyParts.length, sending],
  );
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return; // text: the name field's own paste
      e.preventDefault();
      received(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [received]);

  const move = (set: typeof setParts, i: number, by: number) =>
    set((ps) => {
      const j = i + by;
      if (j < 0 || j >= ps.length) return ps;
      const out = [...ps];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  const turn = (set: typeof setParts, id: number) => set((ps) => ps.map((p) => (p.id === id && p.kind === "photo" ? { ...p, turns: (p.turns + 1) % 4 } : p)));
  const drop = (set: typeof setParts, id: number) =>
    set((ps) => {
      const gone = ps.find((p) => p.id === id);
      if (gone) urlsOf(gone).forEach((u) => URL.revokeObjectURL(u));
      return ps.filter((p) => p.id !== id);
    });
  /** "לצלם שוב": the new photo takes the old one's place. */
  const replace = async (id: number, file: File | undefined) => {
    if (!file || !isImage(file)) return;
    const fresh: Part = {
      id: ++seq,
      kind: "photo",
      name: file.name,
      file,
      url: URL.createObjectURL(file),
      turns: 0,
      quality: null,
    };
    setParts((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p;
        if (p.kind === "photo") URL.revokeObjectURL(p.url);
        return fresh;
      }),
    );
    const quality = await measure(file);
    setParts((ps) => ps.map((x) => (x.id === fresh.id && x.kind === "photo" ? { ...x, quality } : x)));
  };
  const setSkip = (skip: number) => setParts((ps) => ps.map((p, i) => (i === 0 && p.kind === "pdf" ? { ...p, skip } : p)));

  /** The pages, drawn on the phone: the upload's, then the answers file's. */
  const draw = async (): Promise<ExamPageFile[]> => {
    const out: ExamPageFile[] = [];
    const total = pages + keyPages;
    const say = () => setBusy(`מכינים עמוד ${Math.min(total, out.length + 1)} מתוך ${total}…`);
    say();
    const take = async (list: readonly Part[], key: boolean) => {
      for (const p of list) {
        if (p.kind === "pdf") {
          const before = out.length;
          out.push(...(await p.pdf.pages(key, (done) => setBusy(`מכינים עמוד ${Math.min(total, before + done + 1)} מתוך ${total}…`), p.skip)));
        } else {
          out.push(await photoPage(p.file, p.turns, key));
          say();
        }
      }
    };
    await take(parts, false);
    if (keySource === "separate") await take(keyParts, true);
    return out;
  };

  // A field the button found wrong gets the focus (its error is read with it), scrolled into view.
  const focusErr = useRef(false);
  useEffect(() => {
    if (!fieldError || !focusErr.current) return;
    focusErr.current = false;
    const f = fieldError.field;
    const el = document.querySelector<HTMLElement>(`[aria-describedby~="sx-err-${f}"]`) ?? document.getElementById(`sx-err-${f}`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "center" });
  }, [fieldError]);
  const check = (): boolean => {
    focusErr.current = true;
    if (!pages) {
      setFieldError({
        field: "file",
        text: "צריך לבחור קובץ PDF או לצלם לפחות דף אחד.",
      });
      return false;
    }
    if (tooMany) {
      setFieldError({
        field: "file",
        text: kind === "sheet" ? sheetFail("too many pages", "sheet") : failText("too many pages", "exam"),
      });
      return false;
    }
    if (keySource === "separate" && !keyPages) {
      setFieldError({
        field: "key",
        text: "צריך להוסיף את קובץ התשובות, או לבחור ״אין תשובות״.",
      });
      return false;
    }
    if (kind === "exam" && !/^\d{4}$/.test(year.trim())) {
      setFieldError({
        field: "year",
        text: year.trim() ? "שנה בארבע ספרות, למשל 2025." : "צריך לכתוב את השנה של המבחן, למשל 2025.",
      });
      return false;
    }
    if (kind === "exam" && minutes.trim() && !(Number(minutes) >= 10 && Number(minutes) <= 600)) {
      setFieldError({ field: "minutes", text: "בין 10 ל-600 דקות." });
      return false;
    }
    focusErr.current = false;
    setFieldError(null);
    return true;
  };

  const upload = async (confirmed: boolean) => {
    setError("");
    if (!check()) return;
    if (kind === "sheet" && price > SHEET_CONFIRM_USD && !confirmed) return setConfirm(true);
    setConfirm(false);
    void holdScreen(true);
    try {
      const drawn = await draw();
      setBusy(kind === "sheet" ? "פותחים את הדף…" : "פותחים את המבחן…");
      // A retry after a stop sends the same pages to the same row (unless the kind changed meanwhile).
      if (!made.current || made.current.kind !== kind)
        made.current = {
          kind,
          ...(kind === "sheet"
            ? await sheetCreate(courseId, {
                title: name.trim() || fallbackName(),
                lecture: lecture || null,
                keySource,
              })
            : await examCreate(courseId, { year, moed, keySource, minutes })),
        };
      const { exam_id: examId, prefix } = made.current;
      await uploadExamPages(prefix, drawn, (done, total) => setBusy(`מעלים עמוד ${Math.min(total, done + 1)} מתוך ${total}…`));
      setBusy("שולחים להעתקה…");
      const rows = pageRows(prefix, drawn);
      const { urls, until } = await signPages(rows.map((r) => r.path));
      const r = await sheetReadStart(examId, rows, urls, until, confirmed, forms);
      setDrive(examId, !r.server);
      void holdScreen(false);
      setBusy("");
      ctx.go({ v: "exams", e: examId, c: courseId }, { replace: true });
    } catch (e) {
      void holdScreen(false);
      setBusy("");
      const code = codeOf(e);
      if (code === "confirm") return setConfirm(true);
      setError(sheetFail(code, kind) || "ההעלאה נעצרה. כדאי לבדוק את החיבור ולנסות שוב.");
    }
  };

  const back = <BackLink go={ctx.go} fallback={courseId ? { v: "course", c: courseId, seg: "exams" } : { v: "library" }} />;
  const title = "העלאת מבחן או דף תרגילים";
  if (loadError)
    return (
      <main className="exam-new sheet-new">
        <Head back={back} title={title} />
        <p className="a-error" role="alert">
          {loadError}
        </p>
      </main>
    );
  if (!course) return <Loading />;

  const fieldErr = (f: string) => (fieldError?.field === f ? fieldError.text : "");
  const err = (f: string) =>
    fieldErr(f) ? (
      <p id={`sx-err-${f}`} className="a-error a-small" role="alert" tabIndex={-1}>
        {fieldErr(f)}
      </p>
    ) : null;
  const has = parts.length > 0;
  const warnings = parts.flatMap((p, i) => {
    const problem = p.kind === "photo" ? qualityProblem(p.quality) : "";
    const n = pagesOf(parts.slice(0, i)) + 1;
    return problem ? [{ id: p.id, line: qualityLine(problem, n) }] : [];
  });

  const inputs = (
    <>
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])], "main");
          e.target.value = "";
        }}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])], "main");
          e.target.value = "";
        }}
      />
      <input
        ref={keyInput}
        type="file"
        accept="application/pdf,.pdf,image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void addFiles([...(e.target.files ?? [])], "key");
          e.target.value = "";
        }}
      />
      <input
        ref={(el) => {
          retake.current.input = el;
        }}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const id = retake.current.id;
          if (id !== null) void replace(id, e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );

  /** The drop zone: the two tiles (step 1), or the smaller "add more" row once there are pages. */
  const zone = (
    <div
      className={`sx-zone${dragging ? " over" : ""}${has ? " small" : ""}`}
      onDragOver={(e) => {
        if (sending) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        received([...e.dataTransfer.files]);
      }}
    >
      {has ? (
        <div className="sx-more">
          <button type="button" className="a-btn small" disabled={sending} onClick={() => pdfInput.current?.click()}>
            <FileIcon /> עוד קובץ PDF
          </button>
          <button type="button" className="a-btn small" disabled={sending} onClick={() => photoInput.current?.click()}>
            <CameraIcon /> עוד דפים
          </button>
          <span className="a-small a-muted sx-drophint">או לגרור לכאן</span>
        </div>
      ) : (
        <>
          <div className="sx-tiles">
            <button type="button" className="sx-tile" disabled={sending || opening > 0} onClick={() => pdfInput.current?.click()}>
              <FileIcon />
              <b>קובץ PDF</b>
              <span className="a-small a-muted">מהטלפון או מהמחשב</span>
            </button>
            <button type="button" className="sx-tile" disabled={sending || opening > 0} onClick={() => photoInput.current?.click()}>
              <CameraIcon />
              <b>לצלם דפים</b>
              <span className="a-small a-muted">או לבחור תמונות</span>
            </button>
          </div>
          <p className="a-small a-muted sx-drophint">אפשר גם לגרור לכאן קבצי PDF או תמונות, או להדביק (<bdi dir="ltr">Ctrl+V / ⌘V</bdi>).</p>
          <p className="a-small a-muted sx-word">{WORD}</p>
        </>
      )}
    </div>
  );

  const tiles = (list: Part[], set: typeof setParts, what: string): ReactNode => {
    let at = 1;
    return (
      <ol className="sx-pages" aria-label={what}>
        {list.map((p, i) => {
          const n = p.kind === "pdf" ? p.pdf.count - p.skip : 1;
          const from = at;
          at += n;
          const label = n === 1 ? `עמוד ${from}` : `עמודים ${from}–${from + n - 1}`;
          const problem = p.kind === "photo" ? qualityProblem(p.quality) : "";
          return (
            <li key={p.id} className={`sx-page${problem ? " warn" : ""}`}>
              <div className="sx-thumb">
                {p.kind === "photo" ? (
                  <img src={p.url} alt={label} style={{ transform: `rotate(${p.turns * 90}deg)` }} />
                ) : p.thumbs?.[p.skip] ? (
                  <img src={p.thumbs[p.skip]!} alt={`${p.name}, עמוד ${p.skip + 1}`} />
                ) : (
                  <span className="sx-pdf">
                    <FileIcon />
                    <span className="sx-pdfname" dir="auto">
                      {p.name}
                    </span>
                  </span>
                )}
                <span className="n" aria-hidden="true">
                  {n === 1 ? from : `⁦${from}–${from + n - 1}⁩`}
                </span>
                {problem ? (
                  <span className="sx-bad" aria-hidden="true">
                    !
                  </span>
                ) : null}
              </div>
              {p.kind === "pdf" ? (
                <span className="a-small a-muted sx-cap">
                  {p.thumbs?.[p.skip] ? (
                    <>
                      <bdi>{p.name}</bdi> ·{" "}
                    </>
                  ) : null}
                  {n === 1 ? "עמוד אחד" : `${n} עמודים`}
                </span>
              ) : null}
              <div className="sx-tools">
                {/* The pages run right to left: earlier is to the right. */}
                <button
                  type="button"
                  className="a-btn ghost small"
                  aria-label={`להקדים: ${label}`}
                  disabled={sending || i === 0}
                  onClick={() => move(set, i, -1)}
                >
                  →
                </button>
                <button
                  type="button"
                  className="a-btn ghost small"
                  aria-label={`לאחר: ${label}`}
                  disabled={sending || i === list.length - 1}
                  onClick={() => move(set, i, 1)}
                >
                  ←
                </button>
                {p.kind === "photo" ? (
                  <button type="button" className="a-btn ghost small" aria-label={`לסובב: ${label}`} disabled={sending} onClick={() => turn(set, p.id)}>
                    ⟳
                  </button>
                ) : null}
                <button type="button" className="a-btn ghost small" aria-label={`להסיר: ${label}`} disabled={sending} onClick={() => drop(set, p.id)}>
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    );
  };

  const pagesCol = (
    <section className="a-stack sx-col sx-files" aria-label="הדפים">
      {zone}
      {opening > 0 ? (
        <p className="a-small a-muted" role="status">
          קוראים את הקובץ…
        </p>
      ) : null}
      {asking ? (
        <div className="a-callout sx-ask" role="alertdialog" aria-label="זה קובץ התשובות?">
          <span>זה קובץ התשובות?</span>
          <span className="a-row">
            <button
              ref={askRef}
              type="button"
              className="a-btn primary small"
              onClick={() => {
                void addFiles(asking, "key");
                setAsking(null);
              }}
            >
              כן
            </button>
            <button
              type="button"
              className="a-btn small"
              onClick={() => {
                void addFiles(asking, "main");
                setAsking(null);
              }}
            >
              לא, עוד עמודים
            </button>
          </span>
        </div>
      ) : null}
      {cover ? (
        <div className="a-callout quiet sx-cover">
          <span>עמוד 1 נראה כמו דף שער, עם שם או ת״ז.</span>
          <span className="a-row">
            <button type="button" className="a-btn small" disabled={sending} onClick={() => setSkip(1)}>
              להוריד אותו
            </button>
            <button type="button" className="a-btn ghost small" disabled={sending} onClick={() => setCoverOff(true)}>
              להשאיר
            </button>
          </span>
        </div>
      ) : first?.kind === "pdf" && first.skip ? (
        <p className="a-small a-muted sx-cover-off">
          דף השער לא יעלה.{" "}
          <button type="button" className="a-link" disabled={sending} onClick={() => setSkip(0)}>
            להחזיר אותו
          </button>
        </p>
      ) : null}
      {warnings.length ? (
        <ul className="a-stack sx-warn" aria-label="דפים לבדיקה">
          {warnings.map((w) => (
            <li key={w.id} className="a-row between">
              <span className="a-small">{w.line}</span>
              <button
                type="button"
                className="a-btn small"
                disabled={sending}
                onClick={() => {
                  retake.current.id = w.id;
                  retake.current.input?.click();
                }}
              >
                לצלם שוב
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {has ? (
        <>
          <div className="a-row between sx-count">
            <b>{pages === 1 ? "עמוד אחד" : `${pages} עמודים`}</b>
            {tooMany ? <span className="a-chip warn">{kind === "sheet" ? `עד ${SHEET_MAX_PAGES}` : `עד ${MAX_EXAM_PAGES}`}</span> : null}
          </div>
          {tiles(parts, setParts, "הדפים, לפי הסדר")}
        </>
      ) : null}
      {has && parts.some((p) => p.kind === "photo") ? (
        <p className="a-small a-muted">דף שלם, ישר, באור טוב, עמוד אחד בכל תמונה. בלי דף שער עם שם או ת״ז.</p>
      ) : null}
      {err("file")}
    </section>
  );

  const details = has ? (
    <section className="a-stack sx-col sx-details" aria-label="פרטים">
      <fieldset className="sx-field" disabled={sending}>
        <legend className="sx-label">מה זה?</legend>
        <div className="a-seg sx-kinds" role="radiogroup" aria-label="מה זה?">
          {KINDS.map((k, i) => (
            <button
              key={k.v}
              type="button"
              className="a-btn"
              {...radioProps(
                i,
                KINDS.findIndex((x) => x.v === kind),
                KINDS.length,
                (j) => setKind(KINDS[j].v),
              )}
              onClick={() => setKind(k.v)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </fieldset>
      {kind === "sheet" ? (
        <>
          <label className="a-field">
            <span>שם</span>
            <input
              className="a-input"
              dir="auto"
              value={name}
              maxLength={120}
              disabled={sending}
              placeholder={fallbackName()}
              onChange={(e) => {
                named.current = true;
                setName(e.target.value);
              }}
            />
          </label>
          {courseLectures.length ? (
            <label className="a-field">
              <span>הרצאה (לא חובה)</span>
              <select className="a-input" value={lecture} disabled={sending} onChange={(e) => setLecture(e.target.value)}>
                <option value="">בלי הרצאה</option>
                {courseLectures.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      ) : (
        <>
          <div className="x-years">
            <label className="a-field">
              <span>שנה</span>
              <input
                className="a-input"
                value={year}
                inputMode="numeric"
                maxLength={4}
                disabled={sending}
                aria-invalid={Boolean(fieldErr("year")) || undefined}
                aria-describedby={fieldErr("year") ? "sx-err-year" : undefined}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <div className="a-field">
              <span id="sx-moed">מועד</span>
              <div className="a-seg" role="radiogroup" aria-labelledby="sx-moed">
                {MOEDS.map((m) => (
                  <button key={m} type="button" className="a-btn small" role="radio" aria-checked={moed === m} disabled={sending} onClick={() => setMoed(m)}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {err("year")}
          <label className="a-field">
            <span>כמה זמן היה המבחן? (דקות, לא חובה)</span>
            <input
              className="a-input x-minutes"
              value={minutes}
              inputMode="numeric"
              maxLength={3}
              disabled={sending}
              aria-invalid={Boolean(fieldErr("minutes")) || undefined}
              aria-describedby={fieldErr("minutes") ? "sx-min-help sx-err-minutes" : "sx-min-help"}
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
            />
            <small id="sx-min-help">לפי זה נקבע השעון בסימולציה.</small>
          </label>
          {err("minutes")}
        </>
      )}
      <fieldset className="a-card flat x-keys sx-keys" disabled={sending}>
        <legend>
          <b>איפה התשובות?</b>
        </legend>
        {KEYS.map((k) => (
          <label key={k.v} className="a-choice">
            <input type="radio" name="sx-key" checked={keySource === k.v} onChange={() => setKeySource(k.v)} />
            <span>{k.label}</span>
          </label>
        ))}
        {keySource === "separate" ? (
          <div className="a-stack x-keyfile">
            {keyParts.length ? tiles(keyParts, setKeyParts, "קובץ התשובות, לפי הסדר") : null}
            <button type="button" className="a-btn small sx-keyadd" onClick={() => keyInput.current?.click()}>
              {keyParts.length ? "+ עוד עמודי תשובות" : "להוסיף קובץ"}
            </button>
            {err("key")}
          </div>
        ) : keySource === "none" ? (
          <p className="a-small a-muted x-keynote">האפליקציה תציע תשובות, מסומנות ״תשובה מוצעת · לא נבדקה״.</p>
        ) : null}
      </fieldset>
      {confirm ? (
        <div className="a-callout warn sx-big" role="alertdialog" aria-label="הדף ארוך">
          <span>{`הדף ארוך (${pages} עמודים) · ${priceText(price)} · להמשיך?`}</span>
          <span className="a-row">
            <button ref={confirmRef} type="button" className="a-btn primary small" onClick={() => void upload(true)}>
              להמשיך
            </button>
            <button type="button" className="a-btn small" onClick={() => setConfirm(false)}>
              ביטול
            </button>
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="a-small a-muted x-cost-note">
        {`${sizeLine(pages + keyPages, span)}. המחיר נספר בתקציב החודשי של הקבוצה. אפשר להתחיל עד 3 העלאות ביום, לכל מי שבקבוצה בנפרד${writingHelp().serverWrites ? ", ואפשר לסגור את הטלפון אחרי שכל הדפים עלו." : "."}`}
      </p>
    </section>
  ) : null;

  return (
    <main className={`exam-new sheet-new${has ? " has-pages" : ""}`}>
      <Head back={back} title={title} />
      <p className="ph-sub">
        <span>
          <bdi>{course.name}</bdi>
        </span>
      </p>
      {inputs}
      {busy ? (
        <section ref={progRef} className="a-card x-prog" aria-live="polite">
          <b>{busy}</b>
          <p className="a-small a-muted">כדאי להשאיר את המסך פתוח עד שכל הדפים עולים.</p>
        </section>
      ) : null}
      <div className="sx-grid">
        {pagesCol}
        {details}
      </div>
      <details className="sx-help">
        <summary className="a-small">מה אפשר להעלות?</summary>
        <ul className="a-stack a-small a-muted">
          <li>מעלים רק חומר מצוות הקורס או חומר של הקבוצה.</li>
          <li>קובץ מוואטסאפ: לשמור אותו בקבצים, ואז ״קובץ PDF״ כאן.</li>
          <li>{WORD}</li>
        </ul>
      </details>
      {has ? (
        <StickyActions>
          <button type="button" className="a-btn primary wide" disabled={sending || opening > 0} onClick={() => void upload(false)}>
            {sending ? (
              "מעלים…"
            ) : (
              <>
                <span>להעלות ולהעתיק</span>
                {pages ? ` · ${priceText(price)}` : null}
              </>
            )}
          </button>
        </StickyActions>
      ) : null}
    </main>
  );
}
