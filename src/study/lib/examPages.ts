import { EXAM_PAGE_SIDE } from "../../../shared/study/examPrice";
import { HEBREW } from "./bidi";
import { cleanText } from "./pptx";

/* ── A past exam's pages, made on the phone (sources.md B6.1) ──
 *
 * "קובץ PDF": each page is drawn at 1,500 px on its long side (JPEG 0.8,
 * about 2,100 picture tokens) one at a time, its canvas released before the
 * next, and its text lines kept as a hint for the reader when the PDF has a
 * usable text layer: a page with fewer than 80 characters is a scan, and so
 * is a page whose Hebrew came out in visual order (reversed words: final
 * letters at the start of words). "לצלם דפים": each photo shrunk to 1,500 px,
 * turned by the quarter turns its thumbnail asked for. A separate key file's
 * pages are added after the exam's and marked `key`. No OCR on the phone. */

export const MAX_EXAM_PAGES = 120;
export const MAX_PHOTOS = 60;
const QUALITY = 0.8;
/** Fewer characters than this on a page: a scan (its lines are dropped). */
export const SCAN_CHARS = 80;

/** One page ready to upload: its picture, its size and its lines (none for a scan). */
export type ExamPageFile = { blob: Blob; w: number; h: number; lines: string[]; key: boolean };

const FINAL = /[ךםןףץ]/;

/** Hebrew that came out reversed (visual order, as some PDFs keep it): more
 *  Hebrew words start with a final letter than end with one. Pure. */
export function reversedHebrew(lines: readonly string[]): boolean {
  let starts = 0;
  let ends = 0;
  for (const w of lines.join(" ").split(/[^֐-׿]+/)) {
    if (w.length < 2) continue;
    if (FINAL.test(w[0])) starts++;
    if (FINAL.test(w[w.length - 1])) ends++;
  }
  return starts >= 3 && starts > ends;
}

/** A page's text lines as a hint, or none when the page is a scan or its
 *  Hebrew is reversed (sources.md B6.1). Pure. */
export function usableLines(lines: readonly string[]): string[] {
  const clean = lines.map((l) => cleanText(l)).filter(Boolean);
  const chars = clean.join("").length;
  if (chars < SCAN_CHARS) return [];
  if (clean.some((l) => HEBREW.test(l)) && reversedHebrew(clean)) return [];
  return clean.slice(0, 400).map((l) => l.slice(0, 500));
}

/** An exam's PDF, opened once when picked: its page count at once (the price
 *  shows before anything is drawn), and its pages drawn one at a time on upload. */
export type ExamPdf = {
  name: string;
  count: number;
  /** Page 1's text lines (an uploaded sheet's cover check), cleaned. */
  firstLines: string[];
  /** The pages drawn, from page skip + 1 (a sheet's cover page left out). */
  pages(key: boolean, onPage?: (done: number, total: number) => void, skip?: number): Promise<ExamPageFile[]>;
};

export async function openExamPdf(file: File): Promise<ExamPdf> {
  const { readPdf } = await import("./pdf");
  const deck = await readPdf(await file.arrayBuffer());
  const count = deck.slides.length;
  if (!count) throw new Error("empty");
  return {
    name: file.name,
    count,
    firstLines: (deck.slides[0]?.lines ?? []).map((l) => cleanText(l)).filter(Boolean),
    async pages(key, onPage, skip = 0) {
      const out: ExamPageFile[] = [];
      for (const s of deck.slides.slice(skip)) {
        const img = await deck.pageImage(s.n, EXAM_PAGE_SIDE);
        out.push({ blob: img.blob, w: img.width, h: img.height, lines: usableLines(s.lines), key });
        onPage?.(out.length, count - skip);
      }
      return out;
    },
  };
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      no(new Error("bad photo"));
    };
    img.src = url;
  });
}

/** The size a photo is drawn at: its long side at most 1,500 px, never larger,
 *  sides swapped for a quarter turn. Pure. */
export function photoSize(w: number, h: number, turns: number): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, EXAM_PAGE_SIDE / Math.max(w, h));
  const a = Math.max(1, Math.round(w * k));
  const b = Math.max(1, Math.round(h * k));
  return turns % 2 ? { w: b, h: a } : { w: a, h: b };
}

/** A photo as an exam page: through an <img> (iPhone Safari decodes HEIC this
 *  way), turned by `turns` quarter turns clockwise, at most 1,500 px, JPEG. */
export async function photoPage(file: Blob, turns = 0, key = false): Promise<ExamPageFile> {
  const img = await loadImage(file);
  const t = ((turns % 4) + 4) % 4;
  const size = photoSize(img.naturalWidth, img.naturalHeight, t);
  if (!size.w) throw new Error("bad photo");
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("bad photo");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, size.w, size.h);
  g.translate(size.w / 2, size.h / 2);
  g.rotate((t * Math.PI) / 2);
  const dw = t % 2 ? size.h : size.w;
  const dh = t % 2 ? size.w : size.h;
  g.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  const blob = await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("bad photo"))), "image/jpeg", QUALITY));
  canvas.width = 0;
  canvas.height = 0;
  return { blob, w: size.w, h: size.h, lines: [], key };
}
