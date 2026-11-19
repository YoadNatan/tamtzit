import assert from "node:assert/strict";
import { test } from "node:test";
import { figureGeo, picturesGeo, slideGeometry, slideSize } from "./pptxGeo";

/* A PPTX picture's labels from the slide's shapes (docs/study/question-types.md):
 * groups composed through chOff/chExt, the srcRect crop, labels joined by
 * connectors, placeholders left out, at least 3 labels, rotation skipped.
 * Synthetic slide XML only. */

const SZ = { cx: 1000000, cy: 1000000 }; // a square slide: EMU = 1e-6 of the side
const xfrm = (x: number, y: number, cx: number, cy: number, extra = "") => `<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
const pic = (rel: string, x: number, y: number, cx: number, cy: number, src = "", rot = "") =>
  `<p:pic><p:nvPicPr><p:cNvPr id="9" name="p"/></p:nvPicPr><p:blipFill><a:blip r:embed="${rel}"/>${src}<a:stretch/></p:blipFill><p:spPr>${xfrm(x, y, cx, cy, rot)}</p:spPr></p:pic>`;
const text = (t: string, x: number, y: number, cx = 120000, cy = 40000, ph = "") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(x, y, cx, cy)}</p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`;
const cxn = (x: number, y: number, cx: number, cy: number, flip = "") => `<p:cxnSp><p:nvCxnSpPr/><p:spPr>${xfrm(x, y, cx, cy, flip)}<a:prstGeom prst="straightConnector1"/></p:spPr></p:cxnSp>`;
const slide = (inner: string) => `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${inner}</p:spTree></p:cSld></p:sld>`;
const near = (a: number, b: number, d = 1e-3) => Math.abs(a - b) <= d;

test("slideGeometry: a group's children are placed through chOff and chExt", () => {
  // The group sits at (100000, 200000), 400000 wide, its child space 0..800000 (half scale).
  const grp = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="100000" y="200000"/><a:ext cx="400000" cy="400000"/><a:chOff x="0" y="0"/><a:chExt cx="800000" cy="800000"/></a:xfrm></p:grpSpPr>${text("Loop of Henle", 400000, 400000, 200000, 80000)}</p:grpSp>`;
  const g = slideGeometry(slide(grp), SZ);
  assert.equal(g.texts.length, 1);
  const b = g.texts[0].box;
  assert.ok(near(b.x, 0.3) && near(b.y, 0.4) && near(b.w, 0.1) && near(b.h, 0.04), JSON.stringify(b));
});

test("slideGeometry: nested groups compose", () => {
  const inner = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="500000" cy="500000"/><a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="1000000"/></a:xfrm></p:grpSpPr>${text("A", 200000, 200000, 100000, 100000)}</p:grpSp>`;
  const outer = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="500000" y="500000"/><a:ext cx="500000" cy="500000"/><a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="1000000"/></a:xfrm></p:grpSpPr>${inner}</p:grpSp>`;
  const b = slideGeometry(slide(outer), SZ).texts[0].box;
  // inner: 200000 → 100000; outer: 500000 + 100000·0.5 = 550000
  assert.ok(near(b.x, 0.55) && near(b.w, 0.025), JSON.stringify(b));
});

test("slideGeometry: srcRect, connectors with flips, placeholders, a placeholder without xfrm", () => {
  const xml = slide(
    pic("rId2", 200000, 200000, 400000, 400000, `<a:srcRect l="5000" r="5000"/>`) +
      cxn(600000, 300000, 200000, 100000, ` flipH="1"`) +
      text("Title here", 0, 0, 1000000, 100000, `<p:ph type="title"/>`) +
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:r><a:t>inherits</a:t></a:r></a:p></p:txBody></p:sp>`,
  );
  const g = slideGeometry(xml, SZ);
  assert.deepEqual(g.pics[0].crop, { l: 0.05, t: 0, r: 0.05, b: 0 });
  assert.equal(g.pics[0].rel, "rId2");
  assert.deepEqual(g.lines[0].map((v) => Math.round(v * 100) / 100), [0.8, 0.3, 0.6, 0.4], "flipH swaps the x ends");
  assert.equal(g.texts.length, 1, "the body placeholder without its own xfrm is skipped");
  assert.equal(g.texts[0].ph, "title");
});

/** The fixture's diagram: a picture, three labels on it, two outside joined by connectors. */
function nephronSlide(extra = "") {
  return slide(
    text("Nephron segments", 0, 0, 1000000, 80000, `<p:ph type="title"/>`) +
      pic("rId2", 300000, 200000, 400000, 600000, `<a:srcRect l="5000"/>`) +
      text("Glomerulus", 320000, 250000) +
      text("Proximal tubule", 450000, 400000) +
      text("Loop of Henle", 400000, 650000) +
      text("Distal convoluted tubule", 780000, 300000, 180000) +
      cxn(700000, 320000, 80000, 0) +
      text("Collecting duct", 60000, 700000, 160000) +
      cxn(220000, 700000, 120000, 20000) +
      text("This long sentence is a paragraph of the slide, not a label at all", 0, 900000, 1000000, 80000) +
      extra,
  );
}

test("figureGeo: labels on the picture and joined by connectors; the title and a long sentence left out", () => {
  const g = slideGeometry(nephronSlide(), SZ);
  const geo = figureGeo(g.pics[0], g.texts, g.lines, SZ);
  assert.ok(geo);
  assert.deepEqual(geo.labels.map((l) => l.t).sort(), ["Collecting duct", "Distal convoluted tubule", "Glomerulus", "Loop of Henle", "Proximal tubule"]);
  assert.equal(geo.src, "pptx");
  assert.equal(geo.baked, false);
  assert.ok(geo.clip, "a cropped picture has its visible frame");
  // img is the uncropped picture: 5% of its width was cut on the left, so it starts left of the frame.
  assert.ok(geo.img.x < geo.clip.x && near(geo.img.w * 0.95, geo.clip.w, 1e-3), JSON.stringify([geo.img, geo.clip]));
  // Every box is inside the stage.
  for (const l of geo.labels) assert.ok(l.b.x >= 0 && l.b.y >= 0 && l.b.x + l.b.w <= 1 && l.b.y + l.b.h <= 1, l.t);
  assert.equal(geo.lines.length, 2);
  assert.ok(geo.stage.w > 0 && geo.stage.h > 0);
});

test("figureGeo: fewer than 3 labels is no geometry; a rotated picture is skipped; duplicates count once", () => {
  const few = slideGeometry(slide(pic("rId2", 300000, 200000, 400000, 600000) + text("A one", 320000, 250000) + text("B two", 450000, 400000) + text("a one", 400000, 650000)), SZ);
  assert.equal(figureGeo(few.pics[0], few.texts, few.lines, SZ), null, "A one and a one are one label");
  const rot = slideGeometry(nephronSlide().replace(`<a:xfrm><a:off x="300000"`, `<a:xfrm rot="5400000"><a:off x="300000"`), SZ);
  assert.equal(figureGeo(rot.pics[0], rot.texts, rot.lines, SZ), null);
});

test("picturesGeo: aligned with the slide's pictures; slideSize reads p:sldSz", () => {
  const xml = nephronSlide(pic("rId3", 0, 850000, 50000, 50000));
  const list = picturesGeo(xml, SZ, ["rId2", "rId3"]);
  assert.equal(list.length, 2);
  assert.ok(list[0] && list[0].labels.length === 5);
  assert.equal(list[1], null, "an icon without labels");
  assert.deepEqual(picturesGeo("<not xml", SZ, ["rId9"]), [null]);
  assert.deepEqual(slideSize(`<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`), { cx: 12192000, cy: 6858000 });
});

test("the e2e fixture deck: slide 3's nephron has its 5 labels, and no other slide any", async () => {
  const { createRequire } = await import("node:module");
  const { join } = await import("node:path");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const req = createRequire(join(process.cwd(), "package.json"));
  const { makePptx } = req("./e2e/study/fixtures/make-pptx.cjs") as { makePptx: (out: string) => Promise<unknown> };
  const out = join(mkdtempSync(join(tmpdir(), "pptx-")), "deck.pptx");
  await makePptx(out);
  const { readPptx } = await import("./pptx");
  const deck = await readPptx(readFileSync(out));
  const s3 = deck.slides[2];
  assert.equal(s3.images.length, 1);
  const geo = s3.geo?.[0];
  assert.ok(geo, "slide 3's picture has geometry");
  assert.deepEqual(geo.labels.map((l) => l.t).sort(), ["Collecting duct", "Distal convoluted tubule", "Glomerulus", "Loop of Henle", "Proximal tubule"]);
  assert.ok(geo.clip && geo.lines.length === 2);
  assert.equal(deck.slides.filter((s) => s.geo).length, 1, "no other slide has a labelled picture");
});
