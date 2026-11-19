import { grow, isFigureGeo, isLabelText, normLabel, r4, relTo, roundBox, union, type Box, type FigureGeo } from "../../../shared/study/figureGeo";

/* ── A PDF page's diagram labels, from pdf.js's own geometry (no AI) ──
 *
 * A PDF page is stored as one picture. When the page has an image region
 * with short text items over it (a labelled diagram exported to PDF), those
 * items are its labels. imageBoxes walks the page's operator list keeping
 * the transformation matrix, and records where each image is painted;
 * pdfFigureGeo keeps the labels inside the largest image region. The label
 * text is in the page's pixels (baked), so the screen masks it.
 * docs/study/question-types.md. Pure; unit-tested (pdfGeo.test.ts). */

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The operator codes imageBoxes needs (pdf.js's OPS). */
export type Ops = {
  save: number;
  restore: number;
  transform: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
  paintFormXObjectBegin?: number;
  paintFormXObjectEnd?: number;
};

/** Where each image is painted, in the page's user space: [x0, y0, x1, y1]. */
export function imageBoxes(opList: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }, OPS: Ops): Array<[number, number, number, number]> {
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const out: Array<[number, number, number, number]> = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) ctm = mul(ctm, args.slice(0, 6).map(Number) as M);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = Array.isArray(args) ? args[0] : null;
      if (Array.isArray(m) && m.length >= 6) ctm = mul(ctm, m.slice(0, 6).map(Number) as M);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      const pts = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  }
  return out;
}

/** A text item as pdf.js gives it (TextItem). */
export type PdfItem = { str: string; transform: number[]; width: number; height: number };
/** What pdfFigureGeo needs of a viewport (pdf.js's PageViewport). */
export type Viewport = { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] };

/** The page's labelled diagram, or null: the largest image region of
 *  10-90% of the page, the short text items inside it (grown by 5%), at
 *  least 3 different ones. The stage is the region with its labels, padded
 *  2%; `img` is the whole page (what is stored) relative to it. */
export function pdfFigureGeo(items: readonly PdfItem[], boxes: ReadonlyArray<[number, number, number, number]>, viewport: Viewport): FigureGeo | null {
  const W = viewport.width;
  const H = viewport.height;
  if (!(W > 0) || !(H > 0)) return null;
  const toBox = (x0: number, y0: number, x1: number, y1: number): Box => {
    const [a, b] = viewport.convertToViewportPoint(x0, y0);
    const [c, d] = viewport.convertToViewportPoint(x1, y1);
    return { x: Math.min(a, c) / W, y: Math.min(b, d) / H, w: Math.abs(c - a) / W, h: Math.abs(d - b) / H };
  };
  const regions = boxes.map((b) => toBox(b[0], b[1], b[2], b[3])).filter((b) => b.w * b.h >= 0.1 && b.w * b.h <= 0.9);
  if (!regions.length) return null;
  const region = regions.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  const near = grow(region, 0.05);
  const labels: Array<{ t: string; b: Box }> = [];
  const seen = new Set<string>();
  for (const it of items) {
    const text = (it.str ?? "").replace(/\s+/g, " ").trim();
    if (!isLabelText(text) || !Array.isArray(it.transform) || it.transform.length < 6) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = it.height || Math.hypot(it.transform[2], it.transform[3]) || 1;
    const b = toBox(x, y, x + (it.width || 0), y + h);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    if (cx < near.x || cx > near.x + near.w || cy < near.y || cy > near.y + near.h) continue;
    const key = normLabel(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push({ t: text.slice(0, 60), b });
  }
  if (labels.length < 3) return null;
  let stage = region;
  for (const l of labels) stage = union(stage, l.b);
  stage = grow(stage, 0.02);
  const geo: FigureGeo = {
    v: 1,
    src: "pdf",
    stage: { w: r4(stage.w * W), h: r4(stage.h * H) },
    img: roundBox(relTo({ x: 0, y: 0, w: 1, h: 1 }, stage)),
    labels: labels.slice(0, 40).map((l) => ({ t: l.t, b: roundBox(relTo(l.b, stage)) })),
    lines: [],
    baked: true,
  };
  return isFigureGeo(geo) ? geo : null;
}
