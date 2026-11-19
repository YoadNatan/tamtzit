import type { FigureGeo } from "../../../shared/study/figureGeo";
import { imageBoxes, pdfFigureGeo, type Ops, type PdfItem } from "./pdfGeo";
import type { Slide } from "./pptx";
import { cleanText } from "./pptx";
import { installPdfPolyfills } from "./polyfills";

/* ── Reading a PDF deck ──
 *
 * Each page becomes a "slide": its text (as pdf.js reads it) plus a picture of
 * the whole page. The picture matters more than the text here: Hebrew in PDFs
 * often comes out in visual order, and diagrams are only pixels, so the model
 * reads every page as an image too (figure k = 0).
 *
 * pdf.js is big, so it loads only when someone actually uploads a PDF.
 */

// Every page of a PDF is stored as a picture, so they are kept modest: a
// 100-page deck at this size is about 8-12 MB, which the free storage tier
// (1 GB, shared with the other apps) can hold for a block of lectures.
const PAGE_LONG_SIDE = 1200;
const QUALITY = 0.78;

export type PdfDeck = {
  slides: Slide[];
  /** A JPEG of page n (1-based), sized for reading on a phone and for the
   *  model, and the page's labelled diagram when it has one (pdfGeo.ts). */
  pageImage(n: number): Promise<{ blob: Blob; width: number; height: number; geo?: FigureGeo }>;
};

/** A failure while reading a deck, with the step it happened in (shown in
 *  small print under the upload's error, for a screenshot). */
export class ReadError extends Error {
  constructor(
    readonly step: string,
    readonly cause: unknown,
  ) {
    super(`${step}: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`.slice(0, 240));
  }
}

export async function readPdf(data: ArrayBuffer): Promise<PdfDeck> {
  // pdf.js 6 uses browser features iPhones do not all have yet: every PDF
  // failed there ("לא הצלחתי לקרוא את הקובץ"). The page gets them from
  // polyfills.ts; the worker loads the legacy build, which carries its own.
  // Each step names itself in the error, so a phone's failure says where.
  const step = async <T,>(name: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (e) {
      throw new ReadError(name, e);
    }
  };
  await step("polyfills", async () => installPdfPolyfills());
  const pdfjs = await step("load", () => import("pdfjs-dist"));
  const worker = await step("worker", () => import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"));
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await step("open", () => pdfjs.getDocument({ data: new Uint8Array(data) }).promise);

  const slides: Slide[] = [];
  // Each page's text items with their positions, for the diagram labels (the lines above stay as they were).
  const placed = new Map<number, PdfItem[]>();
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await step(`page ${n}`, () => doc.getPage(n));
    const content = await step(`text ${n}`, () => page.getTextContent());
    const lines: string[] = [];
    let current = "";
    const own: PdfItem[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      own.push({ str: item.str, transform: item.transform, width: item.width, height: item.height });
      current += item.str;
      if (item.hasEOL) {
        const line = cleanText(current);
        if (line) lines.push(line);
        current = "";
      }
    }
    const tail = cleanText(current);
    if (tail) lines.push(tail);
    placed.set(n, own);
    slides.push({ n, title: lines[0] ?? "", lines, tables: [], images: [], notes: "" });
    page.cleanup();
  }

  return {
    slides,
    async pageImage(n) {
      try {
        return await pageImageOf(n);
      } catch (e) {
        throw e instanceof ReadError ? e : new ReadError(`image ${n}`, e);
      }
    },
  };

  async function pageImageOf(n: number): Promise<{ blob: Blob; width: number; height: number; geo?: FigureGeo }> {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, PAGE_LONG_SIDE / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode-failed"))), "image/jpeg", QUALITY),
    );
    // The geometry is optional: any failure leaves the page without labels.
    let geo: FigureGeo | null = null;
    try {
      const ops = await page.getOperatorList();
      geo = pdfFigureGeo(placed.get(n) ?? [], imageBoxes(ops, pdfjs.OPS as unknown as Ops), viewport);
    } catch {
      geo = null;
    }
    page.cleanup();
    return { blob, width: canvas.width, height: canvas.height, ...(geo ? { geo } : {}) };
  }
}
