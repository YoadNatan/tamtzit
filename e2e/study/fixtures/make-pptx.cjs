#!/usr/bin/env node
// Builds the e2e's small synthetic PowerPoint deck from slides.json: one
// title and its lines per slide, a table where slides.json has one, speaker
// notes, and a generated PNG picture on the slides that ask for one. No course
// content: everything here was written for the tests (spec review FE-10).
//
//   node e2e/study/fixtures/make-pptx.cjs <out.pptx>
//
// The deck is what src/study/lib/pptx.ts reads (presentation.xml, its rels,
// slides with <p:sp> text, <a:tbl> tables and <p:pic> pictures) and opens in
// PowerPoint and LibreOffice as a plain deck.
//
// A slide with "diagram" (slide 3, question types) gets a generated drawing of
// a nephron (a circle and tube lines drawn into the pixels, nothing taken from
// a course) cropped with a:srcRect, and its labels as text boxes: on the
// picture, inside a group with a child scale, and outside it joined by
// p:cxnSp connectors. pptxGeo.ts reads them back as the figure's labels. The
// same drawing is e2e/study/fixtures/nephron.png (the mock's storage).
//
//   node e2e/study/fixtures/make-pptx.cjs --nephron   writes nephron.png again
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const JSZip = require("jszip");

const slides = JSON.parse(fs.readFileSync(path.join(__dirname, "slides.json"), "utf8"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* A PNG of w×h pixels: a light ground with a few coloured bars, so the
 * browser decodes a real picture (crc32 and zlib from Node). */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const bar = Math.floor((x / w) * 4);
      const on = y > h * (0.2 + 0.15 * ((bar + seed) % 4)) && y < h * 0.9 && x % Math.floor(w / 4) > 6;
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = on ? 13 + bar * 40 : 246;
      raw[i + 1] = on ? 92 : 244;
      raw[i + 2] = on ? 99 + seed * 20 : 239;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/* The nephron drawing: white paper, a dark circle (the glomerulus) and
 * thick tube polylines, w×h pixels. */
function nephronPng(w = 480, h = 288) {
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const dot = (x, y, r, c) => {
    for (let j = Math.floor(y - r); j <= y + r; j++)
      for (let i = Math.floor(x - r); i <= x + r; i++) {
        if (i < 0 || j < 0 || i >= w || j >= h || (i - x) ** 2 + (j - y) ** 2 > r * r) continue;
        const k = j * (w * 3 + 1) + 1 + i * 3;
        raw[k] = c[0];
        raw[k + 1] = c[1];
        raw[k + 2] = c[2];
      }
  };
  const path = (pts, r, c) => {
    for (let p = 1; p < pts.length; p++) {
      const [x0, y0] = pts[p - 1];
      const [x1, y1] = pts[p];
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let s = 0; s <= steps; s++) dot(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, r, c);
    }
  };
  dot(w * 0.18, h * 0.22, h * 0.12, [120, 40, 60]); // the glomerulus
  dot(w * 0.18, h * 0.22, h * 0.07, [230, 170, 180]);
  const tube = [70, 110, 160];
  path([[w * 0.26, h * 0.25], [w * 0.45, h * 0.2], [w * 0.55, h * 0.32], [w * 0.5, h * 0.45]], 5, tube); // proximal
  path([[w * 0.5, h * 0.45], [w * 0.52, h * 0.9], [w * 0.6, h * 0.9], [w * 0.62, h * 0.45]], 5, [60, 140, 90]); // the loop
  path([[w * 0.62, h * 0.45], [w * 0.75, h * 0.35], [w * 0.9, h * 0.38]], 5, [180, 120, 40]); // distal
  path([[w * 0.9, h * 0.38], [w * 0.92, h * 0.95]], 7, [90, 90, 90]); // collecting duct
  path([[w * 0.08, h * 0.85], [w * 0.92, h * 0.85]], 2, [180, 180, 180]); // a guide line
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const para = (t) => `<a:p><a:r><a:rPr lang="he-IL"/><a:t>${esc(t)}</a:t></a:r></a:p>`;
const shape = (id, name, ph, paras) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>`;
const table = (rows) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="457200" y="2743200"/><a:ext cx="8229600" cy="1828800"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid>${rows[0]
    .map(() => '<a:gridCol w="2743200"/>')
    .join("")}</a:tblGrid>${rows
    .map((r) => `<a:tr h="370840">${r.map((c) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(c)}</a:txBody><a:tcPr/></a:tc>`).join("")}</a:tr>`)
    .join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
const picture = (i) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${20 + i}" name="Picture ${i}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg${i}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="1828800" y="3200400"/><a:ext cx="5486400" cy="3291840"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

const labelBox = (id, l) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Label ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${l.x}" y="${l.y}"/><a:ext cx="${l.w}" cy="${l.h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${para(l.t)}</p:txBody></p:sp>`;
/** The diagram's picture (cropped 5% on the left), its labels and connectors. */
function diagram(d) {
  const out = [
    `<p:pic><p:nvPicPr><p:cNvPr id="20" name="Nephron"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg1"/><a:srcRect l="${d.crop_l || 0}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="1828800" y="3200400"/><a:ext cx="5486400" cy="3291840"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
  ];
  d.labels.forEach((l, i) => {
    const id = 40 + i;
    if (l.group) {
      // A group with a child space twice as large: the label's own xfrm is in that space.
      out.push(
        `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${60 + i}" name="Group ${i}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${l.x}" y="${l.y}"/><a:ext cx="${l.w}" cy="${l.h}"/><a:chOff x="0" y="0"/><a:chExt cx="${l.w * 2}" cy="${l.h * 2}"/></a:xfrm></p:grpSpPr>${labelBox(id, { ...l, x: 0, y: 0, w: l.w * 2, h: l.h * 2 })}</p:grpSp>`,
      );
    } else out.push(labelBox(id, l));
    if (l.line) {
      const [x1, y1, x2, y2] = l.line;
      const flipH = x2 < x1 ? ' flipH="1"' : "";
      const flipV = y2 < y1 ? ' flipV="1"' : "";
      out.push(
        `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${80 + i}" name="Connector ${i}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flipH}${flipV}><a:off x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}"/><a:ext cx="${Math.abs(x2 - x1)}" cy="${Math.abs(y2 - y1)}"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>`,
      );
    }
  });
  return out.join("");
}

async function main(out) {
  const zip = new JSZip();
  const n = slides.length;
  let media = 0;
  const types = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
  ];
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  const presRels = [];
  const ids = [];
  slides.forEach((s, i) => {
    const k = i + 1;
    const rels = [];
    const pics = [];
    for (let p = 1; p <= (s.pictures || 0); p++) {
      media += 1;
      zip.file(`ppt/media/image${media}.png`, s.diagram && p === 1 ? nephronPng() : png(240, 150, (k + p) % 4));
      rels.push(`<Relationship Id="rIdImg${p}" Type="${REL}/image" Target="../media/image${media}.png"/>`);
      pics.push(s.diagram && p === 1 ? diagram(s.diagram) : picture(p));
    }
    if (s.notes) {
      zip.file(`ppt/notesSlides/notesSlide${k}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${NS}><p:cSld><p:spTree>${shape(2, "Notes", '<p:ph type="body"/>', para(s.notes))}</p:spTree></p:cSld></p:notes>`);
      rels.push(`<Relationship Id="rIdNotes" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${k}.xml"/>`);
      types.push(`<Override PartName="/ppt/notesSlides/notesSlide${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`);
    }
    const body = s.lines.slice(1).map(para).join("") || para("");
    const tree = [
      shape(2, "Title", '<p:ph type="title"/>', para(s.title)),
      shape(3, "Content", '<p:ph idx="1"/>', body),
      ...(s.tables || []).length ? [table(s.tables)] : [],
      ...pics,
    ].join("");
    zip.file(`ppt/slides/slide${k}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${tree}</p:spTree></p:cSld></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${k}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
    types.push(`<Override PartName="/ppt/slides/slide${k}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    presRels.push(`<Relationship Id="rId${k + 1}" Type="${REL}/slide" Target="slides/slide${k}.xml"/>`);
    ids.push(`<p:sldId id="${255 + k}" r:id="rId${k + 1}"/>`);
  });
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldIdLst>${ids.join("")}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join("")}</Relationships>`);
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types.join("")}</Types>`);
  fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return { slides: n, pictures: media, bytes: fs.statSync(out).size };
}

if (require.main === module && process.argv[2] === "--nephron") {
  fs.writeFileSync(path.join(__dirname, "nephron.png"), nephronPng());
  console.log("nephron.png written");
} else if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node e2e/study/fixtures/make-pptx.cjs <out.pptx>");
    process.exit(2);
  }
  main(out).then((r) => console.log(JSON.stringify(r)));
}
module.exports = { makePptx: main, nephronPng };
