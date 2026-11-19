/* ── A picture's labels, read from the slide's own geometry (no AI) ──
 *
 * What "סימון על תמונה" is built from (docs/study/question-types.md): the
 * client reads it at upload (PPTX text boxes and connectors over a picture,
 * src/study/lib/pptxGeo.ts; PDF text positions over an image region,
 * src/study/lib/pdfGeo.ts) and stores it per figure in
 * study_lectures.slides[].figures[].geo. The server builds a label item from
 * it (server/study/labels.ts); the screen draws it (QuestionFigure.tsx).
 * Every box is in 0..1 of the stage. Pure; imports end in ".js". */

export type Box = { x: number; y: number; w: number; h: number };

export type FigureGeo = {
  v: 1;
  src: "pptx" | "pdf";
  /** The stage's aspect (any unit; only w/h matters). */
  stage: { w: number; h: number };
  /** The whole stored picture, placed in the stage. */
  img: Box;
  /** PPTX srcRect: the visible frame of the picture (the rest is cropped away). */
  clip?: Box;
  /** The labels, each with its box. Never sent to a member before an answer. */
  labels: Array<{ t: string; b: Box }>;
  /** Connectors drawn on the slide (PPTX), x1,y1,x2,y2 in the stage. */
  lines: Array<[number, number, number, number]>;
  /** PDF: the label text is inside the pixels, so masks are needed. */
  baked: boolean;
};

export const GEO_LABELS_MIN = 3;
export const GEO_LABELS_MAX = 40;
export const GEO_LINES_MAX = 40;
export const GEO_LABEL_CHARS = 60;
/** The stored JSON of one figure's geometry, at most (the SQL checks the same). */
export const GEO_BYTES_MAX = 8000;

const num = (v: unknown, lo = -0.5, hi = 1.5) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
export const isBox = (b: unknown): b is Box => {
  const x = b as Box;
  return !!x && typeof x === "object" && num(x.x) && num(x.y) && num(x.w, 0, 2) && num(x.h, 0, 2);
};

/** Whether a value is a figure's geometry as stored (the SQL's shape check, study_lecture_set_geo). */
export function isFigureGeo(g: unknown): g is FigureGeo {
  const x = g as FigureGeo;
  if (!x || typeof x !== "object" || x.v !== 1 || (x.src !== "pptx" && x.src !== "pdf")) return false;
  if (!x.stage || !(x.stage.w > 0) || !(x.stage.h > 0)) return false;
  if (!isBox(x.img) || (x.clip !== undefined && !isBox(x.clip))) return false;
  if (!Array.isArray(x.labels) || x.labels.length < GEO_LABELS_MIN || x.labels.length > GEO_LABELS_MAX) return false;
  if (!x.labels.every((l) => l && typeof l.t === "string" && l.t.trim().length > 0 && l.t.length <= GEO_LABEL_CHARS && isBox(l.b))) return false;
  if (!Array.isArray(x.lines) || x.lines.length > GEO_LINES_MAX) return false;
  if (!x.lines.every((l) => Array.isArray(l) && l.length === 4 && l.every((v) => num(v)))) return false;
  if (typeof x.baked !== "boolean") return false;
  return JSON.stringify(x).length <= GEO_BYTES_MAX;
}

/** Rounds every coordinate to 4 places (what is stored: small and stable). */
export const r4 = (v: number) => Math.round(v * 10000) / 10000;
export const roundBox = (b: Box): Box => ({ x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h) });

/** A label's text as compared (the key against the labels): lower case, one space, no punctuation at the ends. */
export const normLabel = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—•·.,:;()[\]0-9]+|[\s\-–—•·.,:;()[\]]+$/g, "")
    .trim();

/** The label candidate rule shared by PPTX and PDF: 1-2 lines, at most 40
 *  characters and 5 words, not only digits or punctuation. */
export function isLabelText(t: string, lines = 1): boolean {
  const s = t.replace(/\s+/g, " ").trim();
  if (!s || lines > 2 || s.length > 40) return false;
  if (s.split(" ").length > 5) return false;
  if (!/[A-Za-zא-ת]/.test(s)) return false;
  return true;
}

export const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
export const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inside = (p: [number, number], b: Box) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
/** A box re-expressed relative to `stage` (both in the same space), 0..1 of the stage. */
export const relTo = (b: Box, stage: Box): Box => ({ x: (b.x - stage.x) / stage.w, y: (b.y - stage.y) / stage.h, w: b.w / stage.w, h: b.h / stage.h });
