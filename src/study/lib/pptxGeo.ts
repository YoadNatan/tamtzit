import { grow, inside, isFigureGeo, isLabelText, normLabel, overlaps, r4, relTo, roundBox, union, type Box, type FigureGeo } from "../../../shared/study/figureGeo";

/* ── A PPTX picture's labels, from the slide's own shapes (no AI) ──
 *
 * "סימון על תמונה" needs to know where each label of a diagram sits. In a
 * deck, a labelled diagram is usually a picture with text boxes over it or
 * beside it, joined by connector lines. slideGeometry reads every picture,
 * text box and line of a slide in slide coordinates (groups composed through
 * their child offsets and scales); figureGeo keeps the labels that belong to
 * one picture. Pure: plain string parsing, unit-tested
 * (pptxGeo.test.ts). docs/study/question-types.md. */

type El = { name: string; attrs: Record<string, string>; children: El[]; text: string };

/** A tiny XML reader: elements, attributes and text. Enough for slide XML. */
export function parseXml(xml: string): El {
  const root: El = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: El[] = [root];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[6] !== undefined) {
      top.text += m[6];
      continue;
    }
    if (m[5] !== undefined) {
      top.text += m[5];
      continue;
    }
    if (!m[2]) continue;
    if (m[1]) {
      // A closing tag: pop to its element (tolerates stray tags).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[2]) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3] ?? "";
    const el: El = { name: m[2], attrs, children: [], text: "" };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}

const kid = (e: El | undefined, name: string) => e?.children.find((c) => c.name === name);
const find = (e: El | undefined, name: string): El | undefined => {
  if (!e) return undefined;
  for (const c of e.children) {
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return undefined;
};
const all = (e: El, name: string, out: El[] = []): El[] => {
  for (const c of e.children) {
    if (c.name === name) out.push(c);
    all(c, name, out);
  }
  return out;
};
const n = (v: string | undefined) => (v === undefined || v === "" ? 0 : Number(v) || 0);

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** The text lines of a shape's text body. */
function textLines(e: El): string[] {
  const out: string[] = [];
  for (const p of all(e, "a:p")) {
    const line = all(p, "a:t")
      .map((t) => decode(t.text))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (line) out.push(line);
  }
  return out;
}

/** A transform from a shape's own (child) space to slide EMU. */
type T = { x: (v: number) => number; y: (v: number) => number; sx: number; sy: number };
const IDENT: T = { x: (v) => v, y: (v) => v, sx: 1, sy: 1 };

function xfrmOf(sp: El | undefined) {
  const x = sp ? find(sp, "a:xfrm") : undefined;
  if (!x) return null;
  const off = kid(x, "a:off");
  const ext = kid(x, "a:ext");
  if (!off || !ext) return null;
  return {
    x: n(off.attrs.x),
    y: n(off.attrs.y),
    cx: n(ext.attrs.cx),
    cy: n(ext.attrs.cy),
    flipH: x.attrs.flipH === "1",
    flipV: x.attrs.flipV === "1",
    rot: n(x.attrs.rot) !== 0,
    chOff: kid(x, "a:chOff"),
    chExt: kid(x, "a:chExt"),
  };
}

export type SlideGeometry = {
  pics: Array<{ rel: string; frame: Box; crop: { l: number; t: number; r: number; b: number }; rot: boolean }>;
  texts: Array<{ lines: string[]; box: Box; ph: string | null }>;
  lines: Array<[number, number, number, number]>;
};

const LINE_SHAPES = /^(line|straightConnector1|bentConnector[2-5]|curvedConnector[2-5])$/;

/** Every picture, text shape and line of a slide, in 0..1 of the slide
 *  (p:sldSz), groups composed (x' = off.x + (x − chOff.x)·ext.cx/chExt.cx). */
export function slideGeometry(slideXml: string, sldSz: { cx: number; cy: number }): SlideGeometry {
  const out: SlideGeometry = { pics: [], texts: [], lines: [] };
  const root = parseXml(slideXml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, ""));
  const tree = find(root, "p:spTree");
  if (!tree || !(sldSz.cx > 0) || !(sldSz.cy > 0)) return out;
  const W = sldSz.cx;
  const H = sldSz.cy;
  const box = (t: T, x: number, y: number, cx: number, cy: number): Box => {
    const x1 = t.x(x);
    const y1 = t.y(y);
    const x2 = t.x(x + cx);
    const y2 = t.y(y + cy);
    return { x: Math.min(x1, x2) / W, y: Math.min(y1, y2) / H, w: Math.abs(x2 - x1) / W, h: Math.abs(y2 - y1) / H };
  };
  const line = (t: T, f: NonNullable<ReturnType<typeof xfrmOf>>): [number, number, number, number] => {
    let [x1, x2] = [f.x, f.x + f.cx];
    let [y1, y2] = [f.y, f.y + f.cy];
    if (f.flipH) [x1, x2] = [x2, x1];
    if (f.flipV) [y1, y2] = [y2, y1];
    return [t.x(x1) / W, t.y(y1) / H, t.x(x2) / W, t.y(y2) / H];
  };
  const walk = (parent: El, t: T) => {
    for (const c of parent.children) {
      if (c.name === "mc:AlternateContent") {
        const choice = kid(c, "mc:Choice");
        if (choice) walk(choice, t);
      } else if (c.name === "p:grpSp") {
        const f = xfrmOf(kid(c, "p:grpSpPr"));
        if (!f) continue;
        const chOff = { x: n(f.chOff?.attrs.x), y: n(f.chOff?.attrs.y) };
        const chExt = { cx: n(f.chExt?.attrs.cx) || f.cx, cy: n(f.chExt?.attrs.cy) || f.cy };
        const kx = chExt.cx ? f.cx / chExt.cx : 1;
        const ky = chExt.cy ? f.cy / chExt.cy : 1;
        walk(c, { x: (v) => t.x(f.x + (v - chOff.x) * kx), y: (v) => t.y(f.y + (v - chOff.y) * ky), sx: t.sx * kx, sy: t.sy * ky });
      } else if (c.name === "p:sp") {
        const f = xfrmOf(kid(c, "p:spPr"));
        if (!f) continue; // a placeholder without its own position (it inherits the layout's): skipped
        const ph = find(kid(c, "p:nvSpPr"), "p:ph");
        const body = kid(c, "p:txBody");
        const lines = body ? textLines(body) : [];
        const geom = find(kid(c, "p:spPr"), "a:prstGeom")?.attrs.prst ?? "";
        if (!lines.length && (LINE_SHAPES.test(geom) || /Arrow$/.test(geom)) && (f.cx === 0 || f.cy === 0 || LINE_SHAPES.test(geom))) {
          out.lines.push(line(t, f));
          continue;
        }
        if (lines.length) out.texts.push({ lines, box: box(t, f.x, f.y, f.cx, f.cy), ph: ph ? (ph.attrs.type ?? "body") : null });
      } else if (c.name === "p:cxnSp") {
        const f = xfrmOf(kid(c, "p:spPr"));
        if (f) out.lines.push(line(t, f));
      } else if (c.name === "p:pic") {
        const f = xfrmOf(kid(c, "p:spPr"));
        const blip = find(kid(c, "p:blipFill"), "a:blip");
        const rel = blip?.attrs["r:embed"];
        if (!f || !rel) continue;
        const src = find(kid(c, "p:blipFill"), "a:srcRect");
        out.pics.push({
          rel,
          frame: box(t, f.x, f.y, f.cx, f.cy),
          crop: { l: n(src?.attrs.l) / 100000, t: n(src?.attrs.t) / 100000, r: n(src?.attrs.r) / 100000, b: n(src?.attrs.b) / 100000 },
          rot: f.rot,
        });
      }
    }
  };
  walk(tree, IDENT);
  return out;
}

const PAD = 0.02;

/** The labels of one picture, or null when it has fewer than 3: text shapes
 *  that are not placeholders, short (isLabelText), smaller than 15% of the
 *  slide, over the picture (its frame grown by 3% of the slide) or joined
 *  to it by a line (one end within 2% of the label, the other inside the
 *  frame). The stage is the frame, the labels and those lines, padded 2%;
 *  `img` is the whole stored picture (before its crop), `clip` the frame. */
export function figureGeo(pic: SlideGeometry["pics"][number], texts: SlideGeometry["texts"], lines: SlideGeometry["lines"], sldSz: { cx: number; cy: number }): FigureGeo | null {
  if (pic.rot || !(pic.frame.w > 0) || !(pic.frame.h > 0)) return null;
  const frame = pic.frame;
  const near = grow(frame, 0.03);
  const used: Array<[number, number, number, number]> = [];
  const labels: Array<{ t: string; b: Box }> = [];
  const seen = new Set<string>();
  for (const t of texts) {
    if (t.ph !== null) continue;
    const text = t.lines.join(" ").replace(/\s+/g, " ").trim();
    if (!isLabelText(text, t.lines.length) || t.box.w * t.box.h >= 0.15) continue;
    let ok = overlaps(near, t.box);
    if (!ok) {
      const end = grow(t.box, 0.02);
      for (const l of lines) {
        const a: [number, number] = [l[0], l[1]];
        const b: [number, number] = [l[2], l[3]];
        if ((inside(a, end) && inside(b, frame)) || (inside(b, end) && inside(a, frame))) {
          ok = true;
          used.push(l);
          break;
        }
      }
    }
    if (!ok) continue;
    const key = normLabel(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push({ t: text.slice(0, 60), b: t.box });
  }
  if (labels.length < 3) return null;
  // Lines drawn over the picture (inside the grown frame at either end) are part of the diagram too.
  for (const l of lines) if (!used.includes(l) && (inside([l[0], l[1]], near) || inside([l[2], l[3]], near))) used.push(l);
  let stage = frame;
  for (const l of labels) stage = union(stage, l.b);
  for (const l of used) stage = union(union(stage, { x: l[0], y: l[1], w: 0, h: 0 }), { x: l[2], y: l[3], w: 0, h: 0 });
  stage = grow(stage, PAD);
  const { l, t, r, b } = pic.crop;
  const keepW = 1 - l - r;
  const keepH = 1 - t - b;
  const img: Box = keepW > 0 && keepH > 0 ? { x: frame.x - (l * frame.w) / keepW, y: frame.y - (t * frame.h) / keepH, w: frame.w / keepW, h: frame.h / keepH } : frame;
  const cropped = l !== 0 || t !== 0 || r !== 0 || b !== 0;
  const pt = (x: number, y: number): [number, number] => [r4((x - stage.x) / stage.w), r4((y - stage.y) / stage.h)];
  const geo: FigureGeo = {
    v: 1,
    src: "pptx",
    stage: { w: r4((stage.w * sldSz.cx) / 12700), h: r4((stage.h * sldSz.cy) / 12700) },
    img: roundBox(relTo(img, stage)),
    ...(cropped ? { clip: roundBox(relTo(frame, stage)) } : {}),
    labels: labels.slice(0, 40).map((x) => ({ t: x.t, b: roundBox(relTo(x.b, stage)) })),
    lines: used.slice(0, 40).map((x) => [...pt(x[0], x[1]), ...pt(x[2], x[3])] as [number, number, number, number]),
    baked: false,
  };
  return isFigureGeo(geo) ? geo : null;
}

/** The slide size (p:sldSz) of presentation.xml, in EMU. */
export function slideSize(presXml: string): { cx: number; cy: number } {
  const m = /<p:sldSz\b[^>]*>/.exec(presXml)?.[0] ?? "";
  return { cx: n(/\bcx="(\d+)"/.exec(m)?.[1]) || 12192000, cy: n(/\bcy="(\d+)"/.exec(m)?.[1]) || 6858000 };
}

/** Each picture's geometry, for the pictures of a slide in document order
 *  (rel ids as the slide names them), null where it has no labels. */
export function picturesGeo(slideXml: string, sldSz: { cx: number; cy: number }, rels: readonly string[]): Array<FigureGeo | null> {
  try {
    const g = slideGeometry(slideXml, sldSz);
    const taken = new Set<number>();
    return rels.map((rel) => {
      const i = g.pics.findIndex((p, k) => p.rel === rel && !taken.has(k));
      if (i < 0) return null;
      taken.add(i);
      return figureGeo(g.pics[i], g.texts, g.lines, sldSz);
    });
  } catch {
    return rels.map(() => null); // geometry is optional: the summary never depends on it
  }
}

/** Each picture's crop (its srcRect: the part of the stored picture the
 *  slide shows), 0..1 of the uncropped picture, for the pictures of a slide
 *  in document order; null when it is shown whole (or padded, or unknown).
 *  An image question shows only that part: a lecturer often crops away a
 *  textbook figure's legend or labels. */
export function picturesCrop(slideXml: string, sldSz: { cx: number; cy: number }, rels: readonly string[]): Array<Box | null> {
  try {
    const g = slideGeometry(slideXml, sldSz);
    const taken = new Set<number>();
    return rels.map((rel) => {
      const i = g.pics.findIndex((p, k) => p.rel === rel && !taken.has(k));
      if (i < 0) return null;
      taken.add(i);
      const { l, t, r, b } = g.pics[i].crop;
      if (l < 0 || t < 0 || r < 0 || b < 0 || (l === 0 && t === 0 && r === 0 && b === 0)) return null;
      const w = 1 - l - r;
      const h = 1 - t - b;
      return w > 0.05 && h > 0.05 ? roundBox({ x: l, y: t, w, h }) : null;
    });
  } catch {
    return rels.map(() => null);
  }
}
