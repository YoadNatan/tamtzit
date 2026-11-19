import JSZip from "jszip";
import type { FigureGeo } from "../../../shared/study/figureGeo";
import { hasWords, metafileText } from "./metafile";
import { picturesGeo, slideSize } from "./pptxGeo";

/* ── Reading a PowerPoint deck ──
 *
 * Claude cannot read .pptx, so we unzip the deck and read the slide XML
 * ourselves: the slide order, every text run, tables, the pictures on each
 * slide and the speaker notes. Plain string parsing, no DOM, so the same code
 * runs in the browser and in a serverless function.
 *
 * Two traps found in a real 3rd-year pharmacology deck:
 *  - Equation boxes keep their text in <mc:AlternateContent>/<mc:Choice> as
 *    Office Math runs (<m:t>). Common tools skip them and lose whole slides
 *    (PK and side effects). <mc:Fallback> repeats the same content, so it is
 *    dropped to avoid reading it twice.
 *  - Math text comes out as Unicode math italics with doubled minus signs
 *    ("𝑡1/2≈7−−31"); normalising those letters and fixing the dashes turns it
 *    back into "t1/2≈7-31". A plain hyphen, not an en dash: inside Hebrew an
 *    en dash lets the bidi algorithm display the range backwards.
 *  - Drawings embedded as OLE objects (ChemDraw, old Word drawings) show only a
 *    WMF/EMF preview, which browsers cannot display. Their labels are read
 *    from the metafile (metafile.ts) and added to the slide's text, marked
 *    "מתוך שרטוט בשקף:". Drawings with no real words (chemical structures)
 *    are left out.
 */

/** Prefix of a line read from inside a drawing; the summary prompt knows it. */
export const DRAWING_PREFIX = "מתוך שרטוט בשקף:";

export type Slide = {
  /** 1-based position in the deck as presented (hidden slides are skipped). */
  n: number;
  title: string;
  lines: string[];
  /** Each table as rows of cell texts. */
  tables: string[][][];
  /** Zip paths of the pictures on this slide, in document order. */
  images: string[];
  notes: string;
  /** Question types: each picture's label geometry (aligned with images),
   *  null where it has none (pptxGeo.ts). PPTX only; never in the summary. */
  geo?: (FigureGeo | null)[];
};

export type Deck = {
  slides: Slide[];
  /** The bytes of a picture referenced by a slide, or null if it is missing. */
  image(path: string): Promise<Uint8Array | null>;
};

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

// Only the math-italic letters are normalised: a global NFKC would also turn
// "t½" into "t1⁄2" and "Ca²⁺" into "Ca2+".
export const cleanText = (s: string) =>
  s
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => c.normalize("NFKC"))
    .replace(/[−-]{2,}/g, "-")
    .replace(/\s+/g, " ")
    .trim();

type Rel = { target: string; type: string };

function readRels(xml: string): Record<string, Rel> {
  const out: Record<string, Rel> = {};
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    const type = /\bType="([^"]+)"/.exec(m[0])?.[1] ?? "";
    if (id && target) out[id] = { target, type };
  }
  return out;
}

function resolvePath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function paragraphs(xml: string): string[] {
  const lines: string[] = [];
  for (const p of xml.split(/<\/a:p>/)) {
    const runs = [...p.matchAll(/<(?:a|m):t(?:\s[^>]*)?>([^<]*)<\/(?:a|m):t>/g)].map((m) => decode(m[1]));
    const line = cleanText(runs.join(""));
    if (line) lines.push(line);
  }
  return lines;
}

function readSlide(xml: string) {
  let body = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  const tables: string[][][] = [];
  body = body.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, (tbl) => {
    tables.push(
      [...tbl.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((tr) =>
        [...tr[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((tc) => paragraphs(tc[0]).join(" / ")),
      ),
    );
    return "";
  });
  let title = "";
  for (const sp of body.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    if (/<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(sp[0])) {
      title = paragraphs(sp[0]).join(" ");
      break;
    }
  }
  const imageRels = [...body.matchAll(/<p:pic>[\s\S]*?r:embed="([^"]+)"[\s\S]*?<\/p:pic>/g)].map((m) => m[1]);
  return { title, lines: paragraphs(body), tables, imageRels };
}

export async function readPptx(data: ArrayBuffer | Uint8Array | Blob): Promise<Deck> {
  const zip = await JSZip.loadAsync(data);
  const text = async (path: string) => (await zip.file(path)?.async("string")) ?? "";
  const pres = await text("ppt/presentation.xml");
  if (!pres) throw new Error("not-a-pptx");
  const sldSz = slideSize(pres);
  const presRels = readRels(await text("ppt/_rels/presentation.xml.rels"));
  const ids = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => m[1]);

  const slides: Slide[] = [];
  let n = 0;
  for (const rid of ids) {
    const rel = presRels[rid];
    if (!rel) continue;
    const path = resolvePath("ppt/presentation.xml", rel.target);
    const xml = await text(path);
    if (!xml || /<p:sld\b[^>]*\bshow="0"/.test(xml)) continue;
    n += 1;
    const rels = readRels(await text(path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels")));
    const s = readSlide(xml);
    const notesRel = Object.values(rels).find((r) => r.type.endsWith("/notesSlide"));
    let notes = "";
    if (notesRel) {
      // The notes page repeats the slide number in its own placeholder; drop it.
      const notesXml = (await text(resolvePath(path, notesRel.target))).replace(
        /<p:sp>(?:(?!<\/p:sp>)[\s\S])*?type="sldNum"[\s\S]*?<\/p:sp>/g,
        "",
      );
      notes = paragraphs(notesXml).join(" ");
    }
    const geoAll = picturesGeo(xml, sldSz, s.imageRels);
    const kept = s.imageRels
      .map((id, i) => ({ path: rels[id] && resolvePath(path, rels[id].target), geo: geoAll[i] ?? null }))
      .filter((x): x is { path: string; geo: FigureGeo | null } => Boolean(x.path) && /\.(png|jpe?g|gif|bmp|webp)$/i.test(x.path));
    const images = kept.map((x) => x.path);
    const geo = kept.map((x) => x.geo);
    const lines = [...s.lines];
    const drawings = Object.values(rels).filter((r) => r.type.endsWith("/image") && /\.(wmf|emf)$/i.test(r.target));
    for (const d of drawings) {
      const bytes = await zip.file(resolvePath(path, d.target))?.async("uint8array");
      const labels = bytes ? metafileText(bytes).map(cleanText).filter(Boolean) : [];
      if (hasWords(labels)) lines.push(`${DRAWING_PREFIX} ${labels.join(" | ")}`);
    }
    slides.push({ n, title: s.title, lines, tables: s.tables, images, notes, ...(geo.some(Boolean) ? { geo } : {}) });
  }

  return {
    slides,
    image: async (path) => (await zip.file(path)?.async("uint8array")) ?? null,
  };
}

/** One slide as compact text for the prompt, numbered so the summary can cite it. */
export function slideToText(s: Slide): string {
  const out = [`[שקף ${s.n}]${s.title ? " " + s.title : ""}`];
  for (const line of s.lines) if (line !== s.title) out.push(line);
  for (const t of s.tables) {
    out.push("טבלה:");
    for (const row of t) out.push("| " + row.join(" | ") + " |");
  }
  if (s.images.length) out.push(`(${s.images.length === 1 ? "תמונה אחת" : s.images.length + " תמונות"} בשקף)`);
  if (s.notes) out.push("הערות המרצה: " + s.notes);
  return out.join("\n");
}
