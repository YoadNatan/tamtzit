import type { Box, FigureGeo } from "../../shared/study/figureGeo.js";
import { normLabel } from "../../shared/study/figureGeo.js";
import type { LabelLayout, Pin } from "../../shared/study/forms.js";
import type { StoredSlide } from "./study.js";

/* ── "סימון על תמונה": a label item from a picture's geometry (no AI) ──
 *
 * The upload read each labelled picture's labels and their boxes
 * (shared/study/figureGeo.ts). The writer only chooses the picture, the
 * label to ask about and the distractors; this file numbers the pins, writes
 * the lead-in and the per-pin explanations and the masks, all
 * deterministically. The layout never carries a label's text: the screen
 * learns the names only from the options (name mode) or after the answer.
 * docs/study/question-types.md. */

export type LabelledFigure = { id: string; slide: number; caption: string; geo: FigureGeo; labels: Array<{ n: number; text: string }> };

/** The pictures of slides from..to with label geometry, each label numbered
 *  1… in the geometry's order (the request lists them so). */
export function labelledFigures(slides: readonly StoredSlide[], from: number, to: number, captions: ReadonlyMap<string, string> = new Map()): LabelledFigure[] {
  const out: LabelledFigure[] = [];
  for (const s of slides) {
    if (s.n < from || s.n > to) continue;
    for (const f of s.figures ?? []) {
      if (!f.geo || !Array.isArray(f.geo.labels) || f.geo.labels.length < 3) continue;
      const id = `fig:${s.n}-${f.k}`;
      out.push({ id, slide: s.n, caption: captions.get(id) ?? "", geo: f.geo, labels: f.geo.labels.map((l, i) => ({ n: i + 1, text: l.t })) });
    }
  }
  return out;
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const ROW = 0.04;

/** Label indexes in reading order: top to bottom, and right to left within a
 *  row (labels whose centres are within 4% of the stage's height). */
export function pinOrder(boxes: readonly Box[]): number[] {
  const idx = boxes.map((_, i) => i).sort((a, b) => center(boxes[a]).y - center(boxes[b]).y || center(boxes[b]).x - center(boxes[a]).x);
  const rows: number[][] = [];
  for (const i of idx) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(center(boxes[i]).y - center(boxes[row[0]]).y) <= ROW) row.push(i);
    else rows.push([i]);
  }
  return rows.flatMap((r) => r.sort((a, b) => center(boxes[b]).x - center(boxes[a]).x || a - b));
}

/** Tap mode on a picture with 4 labels or more, every other label item;
 *  name mode otherwise. */
export const modeFor = (itemIndex: number, labelCount: number): "name" | "tap" => (labelCount >= 4 && itemIndex % 2 === 1 ? "tap" : "name");

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const pinAt = (n: number, b: Box): Pin => ({ n, x: r4(center(b).x), y: r4(center(b).y) });

export type LabelBuilt = {
  form: "one" | "tap";
  question: string;
  options: string[];
  answer: number;
  explanations: string[];
  layout: LabelLayout;
};

/** The item of a label question. `target` is the label asked about (its
 *  index in the geometry), `options` the checked options with their whys
 *  (the key first is not assumed), `optionCount` the request's.
 *  Name mode: up to 12 pins (the target and its nearest labels), "מה מסומן
 *  במספר n בשרטוט?", the names as options in `order`. Tap mode: the target
 *  and up to 5 nearest labels, preferring the writer's distractors, as pins
 *  1…m, "באיזה מספר מסומן X?", options '1'…'m', each explained by its label. */
export function buildLabelItem(o: {
  fig: string;
  geo: FigureGeo;
  target: number;
  mode: "name" | "tap";
  /** Name mode: the options in their stored order, with which is the key and why. */
  options: ReadonlyArray<{ text: string; correct: boolean; why: string }>;
  /** The writer's distractors that are labels of the picture (geometry indexes), preferred as pins in tap mode. */
  prefer?: readonly number[];
}): LabelBuilt {
  const { geo } = o;
  const boxes = geo.labels.map((l) => l.b);
  const dist = (i: number) => Math.hypot(center(boxes[i]).x - center(boxes[o.target]).x, center(boxes[i]).y - center(boxes[o.target]).y);
  const byNear = boxes.map((_, i) => i).filter((i) => i !== o.target).sort((a, b) => dist(a) - dist(b) || a - b);
  const masks = geo.baked ? boxes.map((b) => ({ x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h) })) : [];
  const base = { kind: "label" as const, fig: o.fig, stage: geo.stage, img: geo.img, ...(geo.clip ? { clip: geo.clip } : {}), lines: geo.lines, baked: geo.baked, masks };
  const key = o.options.find((x) => x.correct);
  if (o.mode === "name") {
    const chosen = [o.target, ...byNear].slice(0, 12);
    const order = pinOrder(chosen.map((i) => boxes[i]));
    const pins = order.map((k, j) => pinAt(j + 1, boxes[chosen[k]]));
    const ask = order.findIndex((k) => chosen[k] === o.target) + 1;
    return {
      form: "one",
      question: `מה מסומן במספר ${ask} בשרטוט?`,
      options: o.options.map((x) => x.text),
      answer: o.options.findIndex((x) => x.correct),
      explanations: o.options.map((x) => x.why),
      layout: { ...base, mode: "name", pins, ask },
    };
  }
  const want = Math.min(6, boxes.length);
  const prefer = (o.prefer ?? []).filter((i) => i !== o.target && i >= 0 && i < boxes.length);
  const rest = byNear.filter((i) => !prefer.includes(i));
  const chosen = [o.target, ...prefer, ...rest].slice(0, Math.max(3, want));
  const order = pinOrder(chosen.map((i) => boxes[i]));
  const pins = order.map((k, j) => pinAt(j + 1, boxes[chosen[k]]));
  const labelAt = order.map((k) => chosen[k]);
  const answer = labelAt.indexOf(o.target);
  const target = geo.labels[o.target].t;
  const dots = boxes
    .map((b, i) => ({ b, i }))
    .filter((x) => !chosen.includes(x.i))
    .map((x) => ({ x: r4(center(x.b).x), y: r4(center(x.b).y) }));
  return {
    form: "tap",
    question: `באיזה מספר מסומן ${target}?`,
    options: labelAt.map((_, j) => String(j + 1)),
    answer,
    explanations: labelAt.map((i, j) => {
      const own = `${j + 1} הוא ${geo.labels[i].t}.`;
      return i === o.target && key ? `${own} ${key.why}` : own;
    }),
    layout: { ...base, mode: "tap", pins, ...(dots.length ? { dots } : {}) },
  };
}

/** The geometry index of the label a text names (normalised), or -1; -2 when two labels match. */
export function labelIndex(geo: FigureGeo, text: string): number {
  const k = normLabel(text);
  if (!k) return -1;
  const hits = geo.labels.map((l, i) => (normLabel(l.t) === k ? i : -1)).filter((i) => i >= 0);
  return hits.length === 1 ? hits[0] : hits.length > 1 ? -2 : -1;
}

/** An image item's crop and masks on a PDF page with geometry: the stage as
 *  a part of the page, and every label's box on the page. */
export function pageCrop(geo: FigureGeo): { crop: Box; masks: Box[] } {
  const img = geo.img;
  const toPage = (b: Box): Box => ({ x: r4((b.x - img.x) / img.w), y: r4((b.y - img.y) / img.h), w: r4(b.w / img.w), h: r4(b.h / img.h) });
  return { crop: toPage({ x: 0, y: 0, w: 1, h: 1 }), masks: geo.labels.map((l) => toPage(l.b)) };
}
