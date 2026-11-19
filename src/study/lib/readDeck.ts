import type { Box, FigureGeo } from "../../../shared/study/figureGeo";
import { mimeFor, shrinkImage } from "./images";
import { readPdf, ReadError, type PdfDeck } from "./pdf";
import { readPptx, type Deck, type Slide } from "./pptx";

/* ── A lecture file, read on the phone (the upload's first step) ──
 * One lecture ("הרצאה חדשה") and the batch ("העלאה של כמה קבצים") read a
 * file the same way: a PowerPoint (.pptx) or a PDF of at most 80 MB, its
 * slides' text here in the browser, and its pictures shrunk one slide at a
 * time while the slides are saved. */

export type Parsed =
  | { kind: "pptx"; name: string; deck: Deck; slides: Slide[] }
  | { kind: "pdf"; name: string; deck: PdfDeck; slides: Slide[] };

export type Figure = { k: number; blob: Blob; width: number; height: number; geo?: FigureGeo; crop?: Box };

export const MAX_BYTES = 80 * 1024 * 1024;

/** Why a file cannot be a lecture, before it is read; "" when it can. */
export function fileProblem(file: { name: string; size: number }): string {
  if (file.size > MAX_BYTES) return "הקובץ גדול מדי (יותר מ-80MB).";
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".ppt")) return "זה קובץ PowerPoint ישן (.ppt). צריך לשמור אותו כ-.pptx או לייצא ל-PDF ולהעלות שוב.";
  if (!lower.endsWith(".pptx") && !lower.endsWith(".pdf")) return "אפשר להעלות מצגת PowerPoint (.pptx) או PDF.";
  return "";
}

/** The file's name without .pptx or .pdf. */
export const baseName = (name: string) => name.replace(/\.(pptx|pdf)$/i, "");

/** Reads a .pptx or a PDF (throws ReadError, or Error("empty") for a deck with no slides). */
export async function readDeck(file: File): Promise<Parsed> {
  const buf = await file.arrayBuffer().catch((e: unknown) => {
    throw new ReadError("file", e);
  });
  if (file.name.toLowerCase().endsWith(".pptx")) {
    const deck = await readPptx(buf);
    if (!deck.slides.length) throw new Error("empty");
    return { kind: "pptx", name: file.name, deck, slides: deck.slides };
  }
  const deck = await readPdf(buf);
  if (!deck.slides.length) throw new Error("empty");
  return { kind: "pdf", name: file.name, deck, slides: deck.slides };
}

/** The pictures to store for one slide: a PowerPoint's own pictures (bullets
 *  and icons left out, art the browser cannot decode skipped), or a PDF's
 *  page as one picture. */
export function figuresOf(parsed: Parsed): (s: Slide) => Promise<Figure[]> {
  if (parsed.kind === "pdf") return async (s: Slide) => [{ k: 0, ...(await parsed.deck.pageImage(s.n)) }];
  return async (s: Slide) => {
    const out: Figure[] = [];
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
  };
}

/** What the batch's price card needs of a deck: slides, characters and
 *  pictures (a PDF page with almost no text is read as its picture). */
export function deckSize(parsed: Parsed): { slides: number; chars: number; pictures: number } {
  const chars = parsed.slides.reduce((n, s) => n + s.lines.join(" ").length + s.notes.length, 0);
  const pictures =
    parsed.kind === "pptx" ? parsed.slides.reduce((n, s) => n + s.images.length, 0) : parsed.slides.filter((s) => s.lines.join(" ").length < 50).length;
  return { slides: parsed.slides.length, chars, pictures };
}
