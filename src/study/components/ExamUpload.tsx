import { useEffect, useMemo, useRef, useState } from "react";
import { examPriceUsd, priceText } from "../../../shared/study/examPrice";
import { courseOverview, type CourseOverview } from "../lib/courses";
import { MAX_EXAM_PAGES, MAX_PHOTOS, openExamPdf, photoPage, type ExamPageFile, type ExamPdf } from "../lib/examPages";
import { examCreate, examReadStart, pageRows, signPages, uploadExamPages, type KeySource } from "../lib/exams";
import { failText } from "../lib/failText";
import { writingHelp } from "../features/writing";
import type { ScreenProps } from "../features/types";
import { holdScreen, setDrive } from "./ExamParts";
import { BackLink, Head, Loading, StickyActions } from "./Shell";
import "../styles/exams.css";

/* ── "העלאת מבחן קודם" (sources.md B6.1, mockup exam-upload.html) ──
 *
 * ?v=exams&new=1&c=<course>: a PDF ("קובץ PDF") or photographed pages ("לצלם
 * דפים": taken now or chosen from the phone's photos, a strip of thumbnails,
 * each moved earlier or later, turned or removed), the year (needed: two
 * exams of one מועד must be told apart) and the מועד, where the answers are ("מסומנות במבחן", "בקובץ
 * נפרד" with its own file, "אין תשובות") and, if known, the exam's minutes
 * (the simulation's clock). The button carries the usual price before
 * anything is sent ("להעלות ולהעתיק את השאלות · כ-$1.40"); no sentence about
 * where the exam goes (decision 1). Then the pages are drawn (1,500 px),
 * uploaded 3 at a time with the screen held on, handed to the server, and the
 * exam's own screen follows the reading: the phone may close. An upload that
 * stopped keeps its exam: "לנסות שוב" sends the same pages to it. */

type Photo = { id: number; file: File; turns: number; url: string };
type Source = { kind: "pdf"; pdf: ExamPdf } | { kind: "photos"; photos: Photo[] };
const MOEDS = ["א׳", "ב׳", "ג׳"];
const KEYS: Array<{ v: KeySource; label: string; hint?: string }> = [
  { v: "marked", label: "מסומנות במבחן", hint: "התשובה מוקפת או מסומנת על הדף." },
  { v: "separate", label: "בקובץ נפרד", hint: "דף תשובות בקובץ או בתמונות משלו." },
  { v: "none", label: "אין תשובות" },
];

let seq = 0;
const asPhotos = (files: FileList | null): Photo[] =>
  [...(files ?? [])].filter((f) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name)).map((file) => ({ id: ++seq, file, turns: 0, url: URL.createObjectURL(file) }));

export default function ExamUpload({ route, ctx }: ScreenProps<"exams">) {
  const courseId = route.c ?? "";
  const [course, setCourse] = useState<CourseOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"pdf" | "photos">("pdf");
  const [pdf, setPdf] = useState<ExamPdf | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [year, setYear] = useState("");
  const [moed, setMoed] = useState(MOEDS[0]);
  const [keySource, setKeySource] = useState<KeySource>("marked");
  const [keyFile, setKeyFile] = useState<Source | null>(null);
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; text: string } | null>(null);
  const [reading, setReading] = useState(false);
  const made = useRef<{ exam_id: string; prefix: string } | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const progRef = useRef<HTMLElement>(null);
  // The progress goes at the top while pages are drawn and sent: below, the sticky button would cover it on a small phone.
  const sendingNow = Boolean(busy);
  useEffect(() => {
    if (sendingNow) progRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [sendingNow]);

  useEffect(() => {
    courseOverview(courseId)
      .then(setCourse)
      .catch((e: unknown) => setLoadError(failText(e instanceof Error ? e.message : "", "course")));
  }, [courseId]);
  // Thumbnails' object URLs go with the screen.
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
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

  const pages = mode === "pdf" ? (pdf?.count ?? 0) : photos.length;
  const keyPages = keySource === "separate" && keyFile ? (keyFile.kind === "pdf" ? keyFile.pdf.count : keyFile.photos.length) : 0;
  const price = useMemo(() => examPriceUsd({ pages, keyPages, keySource }), [pages, keyPages, keySource]);

  const pickPdf = async (file: File | undefined, forKey = false) => {
    if (!file) return;
    setError("");
    setFieldError(null);
    setReading(true);
    try {
      const opened = await openExamPdf(file);
      if (opened.count > MAX_EXAM_PAGES) throw new Error("too many pages");
      if (forKey) setKeyFile({ kind: "pdf", pdf: opened });
      else setPdf(opened);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setFieldError({ field: forKey ? "key" : "file", text: code === "too many pages" ? failText(code, "exam") : "לא הצלחנו לקרוא את הקובץ. אפשר לנסות קובץ PDF אחר, או לצלם את הדפים." });
    } finally {
      setReading(false);
    }
  };
  const addPhotos = (files: FileList | null, forKey = false) => {
    const more = asPhotos(files);
    if (!more.length) return;
    setFieldError(null);
    if (forKey) {
      // Choosing the key's photos again replaces them (several can be chosen at once).
      setKeyFile((k) => {
        if (k?.kind === "photos") k.photos.forEach((ph) => URL.revokeObjectURL(ph.url));
        return { kind: "photos", photos: more.slice(0, MAX_PHOTOS) };
      });
      return;
    }
    setPhotos((ps) => {
      const all = [...ps, ...more];
      if (all.length > MAX_PHOTOS) setFieldError({ field: "file", text: `אפשר עד ${MAX_PHOTOS} תמונות במבחן אחד.` });
      return all.slice(0, MAX_PHOTOS);
    });
  };
  const movePhoto = (i: number, by: number) =>
    setPhotos((ps) => {
      const j = i + by;
      if (j < 0 || j >= ps.length) return ps;
      const out = [...ps];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  const turnPhoto = (i: number) => setPhotos((ps) => ps.map((p, k) => (k === i ? { ...p, turns: (p.turns + 1) % 4 } : p)));
  const dropPhoto = (i: number) =>
    setPhotos((ps) => {
      URL.revokeObjectURL(ps[i].url);
      return ps.filter((_, k) => k !== i);
    });

  /** The pages, drawn on the phone: the exam's, then the key file's. */
  const draw = async (): Promise<ExamPageFile[]> => {
    const out: ExamPageFile[] = [];
    const total = pages + keyPages;
    const say = () => setBusy(`מכינים עמוד ${Math.min(total, out.length + 1)} מתוך ${total}…`);
    say();
    const take = async (src: Source, key: boolean) => {
      if (src.kind === "pdf") {
        const drawn = await src.pdf.pages(key, () => {
          setBusy(`מכינים עמוד ${Math.min(total, out.length + 1)} מתוך ${total}…`);
        });
        out.push(...drawn);
      } else {
        for (const p of src.photos) {
          out.push(await photoPage(p.file, p.turns, key));
          say();
        }
      }
    };
    await take(mode === "pdf" && pdf ? { kind: "pdf", pdf } : { kind: "photos", photos }, false);
    if (keySource === "separate" && keyFile) await take(keyFile, true);
    return out;
  };

  const upload = async () => {
    setError("");
    if (!pages) {
      setFieldError({ field: "file", text: mode === "pdf" ? "צריך לבחור קובץ PDF של המבחן." : "צריך לצלם לפחות דף אחד." });
      return;
    }
    if (pages + keyPages > MAX_EXAM_PAGES) {
      setFieldError({ field: "file", text: failText("too many pages", "exam") });
      return;
    }
    if (keySource === "separate" && !keyPages) {
      setFieldError({ field: "key", text: "צריך לבחור את דף התשובות, או לסמן ׳אין תשובות׳." });
      return;
    }
    if (!/^\d{4}$/.test(year.trim())) {
      setFieldError({ field: "year", text: year.trim() ? "שנה בארבע ספרות, למשל 2025." : "צריך לכתוב את השנה של המבחן, למשל 2025." });
      return;
    }
    if (minutes.trim() && !(Number(minutes) >= 10 && Number(minutes) <= 600)) {
      setFieldError({ field: "minutes", text: "בין 10 ל-600 דקות." });
      return;
    }
    setFieldError(null);
    void holdScreen(true);
    try {
      const all = await draw();
      setBusy("פותחים את המבחן…");
      made.current = made.current ?? (await examCreate(courseId, { year, moed, keySource, minutes }));
      const { exam_id: examId, prefix } = made.current;
      await uploadExamPages(prefix, all, (done, total) => setBusy(`מעלים עמוד ${Math.min(total, done + 1)} מתוך ${total}…`));
      setBusy("שולחים להעתקה…");
      const rows = pageRows(prefix, all);
      const { urls, until } = await signPages(rows.map((r) => r.path));
      const r = await examReadStart(examId, rows, urls, until);
      setDrive(examId, !r.server);
      void holdScreen(false);
      setBusy("");
      ctx.go({ v: "exams", e: examId, c: courseId }, { replace: true });
    } catch (e) {
      void holdScreen(false);
      setBusy("");
      const code = e instanceof Error ? e.message : String(e ?? "");
      setError(failText(code, "exam") || "ההעלאה נעצרה. כדאי לבדוק את החיבור ולנסות שוב.");
    }
  };

  const back = <BackLink go={ctx.go} fallback={courseId ? { v: "course", c: courseId, seg: "exams" } : { v: "library" }} />;
  if (loadError)
    return (
      <main className="exam-new">
        <Head back={back} title="העלאת מבחן קודם" />
        <p className="a-error" role="alert">
          {loadError}
        </p>
      </main>
    );
  if (!course) return <Loading />;
  const fieldErr = (f: string) => (fieldError?.field === f ? fieldError.text : "");
  const err = (f: string) =>
    fieldErr(f) ? (
      <p id={`x-err-${f}`} className="a-error a-small" role="alert">
        {fieldErr(f)}
      </p>
    ) : null;
  const sending = Boolean(busy);

  return (
    <main className="exam-new">
      <Head back={back} title="העלאת מבחן קודם" />
      <p className="ph-sub">
        <span>
          <bdi>{course.name}</bdi>
        </span>
      </p>
      {busy ? (
        <section ref={progRef} className="a-card x-prog" aria-live="polite">
          <b>{busy}</b>
          <p className="a-small a-muted">כדאי להשאיר את המסך פתוח עד שכל הדפים עולים.</p>
        </section>
      ) : null}

      <div className="a-seg" role="radiogroup" aria-label="איך מעלים">
        <button type="button" className="a-btn" role="radio" aria-checked={mode === "pdf"} disabled={sending} onClick={() => setMode("pdf")}>
          קובץ PDF
        </button>
        <button type="button" className="a-btn" role="radio" aria-checked={mode === "photos"} disabled={sending} onClick={() => setMode("photos")}>
          לצלם דפים
        </button>
      </div>

      {mode === "pdf" ? (
        <div className="a-stack x-file">
          <input
            ref={pdfInput}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            id="x-pdf"
            aria-describedby={fieldErr("file") ? "x-err-file" : undefined}
            onChange={(e) => {
              void pickPdf(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {pdf ? (
            <div className="a-row between x-picked">
              <span className="x-name">
                <b dir="auto">{pdf.name}</b>
                <span className="a-small a-muted">{pdf.count === 1 ? "דף אחד" : `${pdf.count} דפים`}</span>
              </span>
              <button type="button" className="a-btn small" disabled={sending} onClick={() => pdfInput.current?.click()}>
                קובץ אחר
              </button>
            </div>
          ) : (
            <button type="button" className="a-btn wide" disabled={sending || reading} onClick={() => pdfInput.current?.click()}>
              {reading ? "קוראים את הקובץ…" : "לבחור קובץ PDF"}
            </button>
          )}
          {err("file")}
        </div>
      ) : (
        <div className="a-stack x-file">
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            id="x-photos"
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="a-row between">
            <b>{photos.length === 1 ? "דף אחד" : `${photos.length} דפים`}</b>
            <button type="button" className="a-btn small" disabled={sending || photos.length >= MAX_PHOTOS} onClick={() => photoInput.current?.click()}>
              {photos.length ? "+ להוסיף עוד" : "+ להוסיף דפים"}
            </button>
          </div>
          {photos.length ? (
            <ol className="x-strip" aria-label="הדפים, לפי הסדר">
              {photos.map((p, i) => (
                <li key={p.id} className="a-card flat x-th">
                  <div className="x-page">
                    <img src={p.url} alt={`דף ${i + 1}`} style={{ transform: `rotate(${p.turns * 90}deg)` }} />
                    <span className="n" aria-hidden="true">
                      {i + 1}
                    </span>
                  </div>
                  <div className="x-tools">
                    {/* The strip runs right to left: earlier is to the right. */}
                    <button type="button" className="a-btn" aria-label={`להקדים את דף ${i + 1}`} disabled={sending || i === 0} onClick={() => movePhoto(i, -1)}>
                      →
                    </button>
                    <button type="button" className="a-btn" aria-label={`לאחר את דף ${i + 1}`} disabled={sending || i === photos.length - 1} onClick={() => movePhoto(i, 1)}>
                      ←
                    </button>
                    <button type="button" className="a-btn" aria-label={`לסובב את דף ${i + 1}`} disabled={sending} onClick={() => turnPhoto(i)}>
                      ⟳
                    </button>
                    <button type="button" className="a-btn" aria-label={`למחוק את דף ${i + 1}`} disabled={sending} onClick={() => dropPhoto(i)}>
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          <p className="a-small a-muted">אפשר לצלם עכשיו או לבחור תמונות שכבר בטלפון. צילום ישר, באור טוב, עמוד אחד בכל תמונה.</p>
          {err("file")}
        </div>
      )}

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
            aria-describedby={fieldErr("year") ? "x-err-year" : undefined}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <div className="a-field">
          <span id="x-moed">מועד</span>
          <div className="a-seg" role="radiogroup" aria-labelledby="x-moed">
            {MOEDS.map((m) => (
              <button key={m} type="button" className="a-btn small" role="radio" aria-checked={moed === m} disabled={sending} onClick={() => setMoed(m)}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
      {err("year")}

      <fieldset className="a-card flat x-keys" disabled={sending}>
        <legend>
          <b>התשובות:</b>
        </legend>
        {KEYS.map((k) => (
          <label key={k.v} className="a-choice">
            <input type="radio" name="x-key" checked={keySource === k.v} onChange={() => setKeySource(k.v)} />
            <span className="x-keyopt">
              <span>{k.label}</span>
              {k.hint ? <small className="a-muted">{k.hint}</small> : null}
            </span>
          </label>
        ))}
        {keySource === "separate" ? (
          <div className="a-stack x-keyfile">
            <input
              type="file"
              accept="application/pdf,.pdf,image/*"
              multiple
              className="sr-only"
              id="x-keyfile"
              onChange={(e) => {
                const files = e.target.files;
                const first = files?.[0];
                if (first && /\.pdf$/i.test(first.name)) void pickPdf(first, true);
                else addPhotos(files, true);
                e.target.value = "";
              }}
            />
            <label htmlFor="x-keyfile" className="a-btn small x-keypick">
              {!keyFile ? "לבחור את דף התשובות" : keyFile.kind === "pdf" ? "קובץ אחר" : "תמונות אחרות"}
            </label>
            {keyFile ? (
              <span className="a-row x-keypicked">
                <span className="a-small a-muted">
                  {keyFile.kind === "pdf" ? `${keyFile.pdf.name} · ${keyFile.pdf.count === 1 ? "דף אחד" : `${keyFile.pdf.count} דפים`}` : keyFile.photos.length === 1 ? "תמונה אחת" : `${keyFile.photos.length} תמונות`}
                </span>
                <button
                  type="button"
                  className="a-btn ghost small"
                  disabled={sending}
                  onClick={() =>
                    setKeyFile((k) => {
                      if (k?.kind === "photos") k.photos.forEach((ph) => URL.revokeObjectURL(ph.url));
                      return null;
                    })
                  }
                >
                  להסיר
                </button>
              </span>
            ) : null}
            {keyFile?.kind === "photos" ? (
              <ol className="x-keystrip" aria-label="דף התשובות, לפי הסדר">
                {keyFile.photos.map((ph, i) => (
                  <li key={ph.id} className="x-page">
                    <img src={ph.url} alt={`דף תשובות ${i + 1}`} />
                  </li>
                ))}
              </ol>
            ) : null}
            {err("key")}
          </div>
        ) : keySource === "none" ? (
          <p className="a-small a-muted x-keynote">האפליקציה תציע תשובות, ויהיה כתוב לידן ״תשובה מוצעת · לא נבדקה״. לכן זה עולה קצת יותר.</p>
        ) : null}
      </fieldset>

      <label className="a-field">
        <span>כמה זמן היה המבחן? (דקות)</span>
        <input
          className="a-input x-minutes"
          value={minutes}
          inputMode="numeric"
          maxLength={3}
          disabled={sending}
          aria-invalid={Boolean(fieldErr("minutes")) || undefined}
          aria-describedby="x-min-help"
          onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))}
        />
        <small id="x-min-help">לא חובה. לפי זה נקבע השעון בסימולציה.</small>
      </label>
      {err("minutes")}

      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      {/* The price and the timing only (decision 1: nothing about where the exam goes). */}
      <p className="a-small a-muted x-cost-note">
        {`המחיר נספר בתקציב החודשי של הקבוצה, ואפשר להתחיל עד 3 מבחנים ביום. ההעתקה לוקחת לרוב 10–20 דקות${writingHelp().serverWrites ? ", ואפשר לסגור את הטלפון אחרי שכל הדפים עלו." : "."}`}
      </p>
      <StickyActions>
        <button type="button" className="a-btn primary wide" disabled={sending || reading} onClick={() => void upload()}>
          {sending ? (
            "מעלים…"
          ) : (
            <>
              {/* The approved words; on a narrow phone the short ones, so the price stays on the button's one line. */}
              <span className="x-go-long">להעלות ולהעתיק את השאלות</span>
              <span className="x-go-short">להעלות ולהעתיק</span>
              {pages ? ` · ${priceText(price)}` : null}
            </>
          )}
        </button>
      </StickyActions>
    </main>
  );
}
