import { coverage } from "../../../shared/study/coverage";
import { postStudy, sb } from "./api";
import { failText } from "./failText";
import type { KeySource, ReviewItem } from "./exams";

/* ── Uploaded sheets, release A0: the data and the pure helpers (docs/study/sheets.md) ──
 *
 * A past exam ("מבחן קודם") or an exercise sheet ("דף תרגילים"; a question
 * bank is a sheet with no lecture) is uploaded on one screen (SheetUpload,
 * flags.sheets). A sheet is a study_exams row of kind 'sheet' (section O 1):
 * study_sheet_create makes it, then its pages go through past exams' path
 * (lib/exams.ts: upload, sign, op exam_read) and the exam reader copies its
 * choice questions. Here: the RPCs O 1 adds, the start with the second
 * confirmation, the words of a sheet's refusals, and what the screens decide
 * without the server (the name from the file, a cover page, a photo too blurred
 * or too dark, the course page by kind, the copy's exactness against the PDF's
 * text). Nothing here is in the entry chunk. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error((error as { message?: string }).message || "unknown");
  return data as T;
}

export type UploadKind = "exam" | "sheet";

/** "דף תרגילים": the sheet's row in its course; its pages go to `${prefix}p<n>.jpg`. */
export const sheetCreate = (courseId: string, meta: { title: string; lecture: string | null; keySource: KeySource }) =>
  rpc<{ exam_id: string; prefix: string }>("study_sheet_create", {
    p_course: courseId,
    p_meta: {
      title: meta.title,
      lecture: meta.lecture,
      key_source: meta.keySource,
    },
  });

/** "לסמן תשובה" on any choice item: a one-answer item's index, or a true/false or match item's statements (both null: no key). */
export const examKeySet = (questionId: string, answer: number | null, seq: number[] | null) =>
  rpc<{ answer: number | null; seq: number[] | null; origin: string | null }>("study_exam_key_set", { p_question: questionId, p_answer: answer, p_seq: seq });

/** Op exam_read's start with the second confirmation of a long sheet (confirmBig, 409 "confirm" without it). */
export async function sheetReadStart(
  examId: string,
  pages: unknown[],
  urls: Record<string, string>,
  until: string,
  confirmBig: boolean,
): Promise<{ units: number; server: boolean; priceUsd: number }> {
  const res = await postStudy("/api/study/ai", {
    op: "exam_read",
    examId,
    pages,
    urls,
    until,
    confirmBig,
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* not json */
    }
    throw new Error(code);
  }
  return (await res.json()) as {
    units: number;
    server: boolean;
    priceUsd: number;
  };
}

/** An upload's kind and lecture (section O 1; members read study_exams). */
export async function uploadMeta(examId: string): Promise<{ kind: UploadKind; lecture_id: string | null }> {
  const { data, error } = await client().from("study_exams").select("kind, lecture_id").eq("id", examId).maybeSingle();
  if (error) throw new Error(error.message || "unknown");
  const row = (data ?? {}) as { kind?: string; lecture_id?: string | null };
  return { kind: row.kind === "sheet" ? "sheet" : "exam", lecture_id: row.lecture_id ?? null };
}

/** The PDF text of an upload's pages (members read study_exam_pages): the exactness check's ground. */
export async function pageLines(examId: string): Promise<Map<number, string[]>> {
  const { data, error } = await client().from("study_exam_pages").select("n, lines").eq("exam_id", examId);
  if (error) throw new Error(error.message || "unknown");
  return new Map(((data ?? []) as Array<{ n: number; lines: string[] | null }>).map((p) => [p.n, p.lines ?? []]));
}

/** A sheet's refusals in words (the rest are past exams'). */
const SHEET_FAIL: Record<string, string> = {
  sheets_cap: "התקציב לדפי תרגילים נגמר החודש. מתחדש ב-1 בחודש.",
  "too many pages": "אפשר עד 40 עמודים בדף תרגילים, ועד 10 עמודים בקובץ התשובות.",
  off: "העלאת דפי תרגילים עוד לא פתוחה בקבוצה.",
  "lecture not found": "ההרצאה הזו כבר לא בקורס. אפשר לבחור אחרת, או בלי הרצאה.",
  budget: "אין מספיק תקציב החודש לדף ארוך כזה. אפשר להעלות חלק מהעמודים, או לחכות ל-1 בחודש.",
};
export function sheetFail(code: string, kind: UploadKind): string {
  return (kind === "sheet" ? SHEET_FAIL[code] : undefined) ?? failText(code, "exam");
}

/* ── The upload's words (pure) ── */

/** A file's name as a sheet's title: no extension, "_" and "-" as spaces, one space, at most 120 characters. */
export function nameFromFile(file: string): string {
  return file
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/_+/g, " ")
    .replace(/(\S)-(?=\S)/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
}
/** An empty name's fallback: "דף תרגילים 26.11". */
export function fallbackName(now = new Date()): string {
  return `דף תרגילים ${now.getDate()}.${now.getMonth() + 1}`;
}

/** Page 1 looks like a cover with a name or an ID to fill in (ת.ז, תעודת זהות, מספר סטודנט, "שם:") within its first lines. */
export function looksLikeCover(lines: readonly string[]): boolean {
  return lines
    .slice(0, 15)
    .some((l) => /ת[.״"׳']?\s?ז[.׳']?(?![א-ת])|תעודת\s+זהות|מס(?:פר|['׳])\s*(?:סטודנט|תלמיד)|^\s*שם(?:\s+(?:מלא|הסטודנט))?\s*[:：]/.test(l));
}

/** A Word document: the upload asks for a PDF first (OD16). */
export const isWord = (f: { name: string; type?: string }) => /\.(docx?|odt|rtf)$/i.test(f.name) || /wordprocessingml|msword/.test(f.type ?? "");
export const isPdf = (f: { name: string; type?: string }) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
export const isImage = (f: { name: string; type?: string }) => (f.type ?? "").startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name);

/** "6 עמודים · לרוב 5–10 דקות" under the button. */
export function sizeLine(pages: number, minutes: { from: number; to: number }): string {
  return `${pages === 1 ? "עמוד אחד" : `${pages} עמודים`} · לרוב ⁦${minutes.from}–${minutes.to}⁩ דקות`;
}

/* ── The camera's checks (pure, on a small grey copy of the photo) ── */

/** A photo's sharpness (the variance of a Laplacian over its grey pixels) and brightness (their mean, 0-255). */
export function pageQuality(img: { data: ArrayLike<number>; width: number; height: number }): { sharp: number; light: number } {
  const { data, width: w, height: h } = img;
  const grey = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    grey[i] = g;
    sum += g;
  }
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w] - 4 * grey[i];
      n += 1;
      const d = lap - mean;
      mean += d / n;
      m2 += d * (lap - mean);
    }
  return { sharp: n > 1 ? m2 / (n - 1) : 0, light: w * h ? sum / (w * h) : 0 };
}
/** The side the checks draw a photo at, and their lines, set on the synthetic sheet's photos (make-sheet.cjs:
 *  sharp pages 1,040-2,210, the blurred one 12; every page about 232 light) with room for a real phone's noise. */
export const QUALITY_SIDE = 640;
export const BLUR_BELOW = 80;
export const DARK_BELOW = 70;
export function qualityProblem(q: { sharp: number; light: number } | null | undefined): "" | "blur" | "dark" {
  if (!q) return "";
  if (q.light < DARK_BELOW) return "dark";
  return q.sharp < BLUR_BELOW ? "blur" : "";
}
export function qualityLine(problem: "blur" | "dark", n: number): string {
  return problem === "blur" ? `עמוד ${n} נראה מטושטש · כדאי לצלם שוב` : `עמוד ${n} חשוך מדי · כדאי לצלם שוב`;
}

/* ── The course page by kind ── */

export type Kinded = { kind?: string | null };
/** An upload's kind: a row from before section O 1 is a past exam. */
export const kindOf = (e: Kinded): UploadKind => (e.kind === "sheet" ? "sheet" : "exam");
/** Past exams first, then sheets, each in the server's order. */
export function byKind<T extends Kinded>(rows: readonly T[]): { exams: T[]; sheets: T[] } {
  return {
    exams: rows.filter((e) => kindOf(e) === "exam"),
    sheets: rows.filter((e) => kindOf(e) === "sheet"),
  };
}

/* ── The review: the copy against the PDF's own text (design D9) ── */

/** Under this share of its trigrams found in its page's text, an item is flagged "ההעתקה שונה מהטקסט בקובץ". */
export const EXACT_BELOW = 0.55;
/** An item's text as the copy has it: the case, the question, the options, the prompts. */
const itemText = (q: Pick<ReviewItem, "vignette" | "question" | "options" | "prompts">) => [q.vignette, q.question, ...q.options, ...q.prompts].join(" ");
/** The items whose copy is not in their page's text (and the next page's: an item may go on over the page).
 *  Pages with no text (a scan, a photo) flag nothing. */
export function inexact(
  items: ReadonlyArray<Pick<ReviewItem, "id" | "page" | "vignette" | "question" | "options" | "prompts" | "retired">>,
  lines: ReadonlyMap<number, readonly string[]>,
): Set<string> {
  const out = new Set<string>();
  for (const q of items) {
    if (q.retired || !q.page) continue;
    const own = lines.get(q.page) ?? [];
    if (!own.length) continue;
    const text = [...own, ...(lines.get(q.page + 1) ?? [])].join(" ");
    if (coverage(itemText(q), text) < EXACT_BELOW) out.add(q.id);
  }
  return out;
}

/** The review's next or previous item, kept within the list (the wide review's arrow keys). */
export function step(ids: readonly string[], current: string | null, by: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = current ? ids.indexOf(current) : -1;
  if (i < 0) return ids[by > 0 ? 0 : ids.length - 1];
  return ids[Math.max(0, Math.min(ids.length - 1, i + by))];
}

/** A true/false or match item's statements as the reviewer marks them: one per statement (0/1), or one option per prompt. */
export function seqComplete(form: string, seq: ReadonlyArray<number | null>, size: number): number[] | null {
  if (seq.length !== size || seq.some((v) => v === null || v === undefined)) return null;
  if (form === "tf" && seq.some((v) => v !== 0 && v !== 1)) return null;
  return seq as number[];
}
