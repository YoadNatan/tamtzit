// The synthetic exercise sheet as files (docs/study/sheets.md, the uploaded
// sheets package O): its 6 pages (sheet/sheet6.json: a cover page, fictional
// drugs and patients, no real course text) printed by Chromium into a text
// PDF, its 2-page answers file into a PDF of its own, and each page
// photographed (a JPEG screenshot, slightly grey, as a phone's photo would
// be), with one page turned on its side and one blurred, for the camera
// checks. Made at test time, never committed. Real course material never
// goes into git: e2e/study/fixtures/real/ is ignored (.gitignore).
//   const { makeSheetFiles, SHEET } = require("./fixtures/make-sheet.cjs");
//   const f = await makeSheetFiles(browser, outDir);
//   // { pdf, answersPdf, photos: [6 paths], turned, blurred, boxes: { "6": "pg:5:x,y,w,h" }, ms: {...} }
//   const clean = await pageShots(browser, outDir);   // each page as the upload draws it: white, straight, sharp
// Page lines: "| a | b |" rows are drawn as a table (header first) and
// "[[figure:curve]]" as a concentration-time graph with a point marked X.
// boxes are the drawn figures' boxes in thousandths of the page, measured,
// so a test can compare the reader's box with the real one. ms holds how
// long each step took (the O0 time measurement, fixtures only).
const fs = require("fs");
const path = require("path");

const SHEET = JSON.parse(fs.readFileSync(path.join(__dirname, "sheet", "sheet6.json"), "utf8"));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A concentration-time curve (one dose, a peak marked X), drawn, with its axes' words as text. */
const CURVE = `<svg class="fig" data-fig="curve" viewBox="0 0 400 190" width="560" height="266" role="img" aria-label="graph">
  <line x1="40" y1="160" x2="390" y2="160" stroke="#111" stroke-width="2"/>
  <line x1="40" y1="160" x2="40" y2="10" stroke="#111" stroke-width="2"/>
  <path d="M40 160 C 80 40, 100 30, 120 32 S 250 120, 380 150" fill="none" stroke="#2a4d8f" stroke-width="3"/>
  <text x="112" y="24" font-size="18" font-weight="700">X</text>
  <text x="300" y="182" font-size="13">זמן (שעות)</text>
  <text x="46" y="16" font-size="13">ריכוז</text>
</svg>`;

function linesHtml(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === "[[figure:curve]]") {
      out.push(CURVE);
    } else if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++].split("|").slice(1, -1).map((c) => c.trim()));
      i -= 1;
      out.push(
        `<table><thead><tr>${rows[0].map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .slice(1)
          .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
    } else {
      out.push(`<p class="${i === 0 ? "head" : ""}">${esc(l)}</p>`);
    }
  }
  return out.join("");
}

function pageHtml(p, o = {}) {
  const style = [o.photo ? "background:#ecebe6" : "", o.blur ? "filter:blur(2.5px)" : ""].filter(Boolean).join(";");
  return `<section class="pg${p.cover ? " cover" : ""}" data-n="${p.n}"${style ? ` style="${style}"` : ""}>${linesHtml(p.lines)}</section>`;
}

function doc(pages, o = {}) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0 }
    body { margin: 0; font: 21px/1.6 "DejaVu Sans", Arial, sans-serif; color: #111 }
    .pg { box-sizing: border-box; width: 210mm; height: 297mm; padding: 24mm 20mm; page-break-after: always; background: #fff; overflow: hidden }
    .pg:last-child { page-break-after: auto }
    .cover p { font-size: 26px; margin-bottom: 28px }
    .head { color: #555; font-size: 16px; margin-bottom: 18px }
    p { margin: 0 0 10px }
    table { border-collapse: collapse; margin: 6px 0 14px }
    th, td { border: 1px solid #333; padding: 4px 14px; text-align: center }
    .fig { display: block; margin: 8px auto 12px }
  </style></head><body>${pages.map((p) => pageHtml(p, o)).join("")}</body></html>`;
}

/** The drawn figures' boxes, in thousandths of their page (as "pg:<page>:x,y,w,h"; x from the left). */
async function figureBoxes(page) {
  return page.evaluate(() => {
    const out = {};
    for (const svg of document.querySelectorAll("svg.fig")) {
      const pg = svg.closest(".pg");
      const a = pg.getBoundingClientRect();
      const b = svg.getBoundingClientRect();
      const t = (v, s) => Math.max(0, Math.min(1000, Math.round((v / s) * 1000)));
      const box = [t(b.left - a.left, a.width), t(b.top - a.top, a.height), t(b.width, a.width), t(b.height, a.height)];
      out[pg.dataset.n] = `pg:${pg.dataset.n}:${box.join(",")}`;
    }
    return out;
  });
}

async function makeSheetFiles(browser, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ms = {};
  const t0 = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  let t = Date.now();
  const pdf = path.join(outDir, "sheet-3.pdf");
  await page.setContent(doc(SHEET.pages));
  const drawn = await figureBoxes(page);
  await page.pdf({ path: pdf, format: "A4", printBackground: true });
  ms.pdf = Date.now() - t;
  t = Date.now();
  const answersPdf = path.join(outDir, "sheet-3-answers.pdf");
  await page.setContent(doc(SHEET.answers.pages));
  await page.pdf({ path: answersPdf, format: "A4", printBackground: true });
  ms.answersPdf = Date.now() - t;
  // The figure of item 6 is the drawn graph on its page (item → box).
  const boxes = {};
  for (const it of SHEET.truth) if (it.figures && drawn[String(it.page)]) boxes[it.label] = drawn[String(it.page)];
  t = Date.now();
  const photos = [];
  const turnedN = 3;
  const blurredN = 4;
  for (const p of SHEET.pages) {
    await page.setContent(doc([p], { photo: true, blur: p.n === blurredN }));
    const file = path.join(outDir, `sheet-photo-${String(p.n).padStart(2, "0")}.jpg`);
    await page.locator(".pg").screenshot({ path: file, type: "jpeg", quality: 70 });
    photos.push(file);
  }
  // One page photographed on its side (a quarter turn), as the upload's "turn" fixes.
  const flat = fs.readFileSync(photos[turnedN - 1]).toString("base64");
  await page.setViewportSize({ width: 1123, height: 794 });
  await page.setContent(
    `<!doctype html><body style="margin:0;background:#ecebe6"><div id="t" style="width:1123px;height:794px;position:relative;overflow:hidden">` +
      `<img src="data:image/jpeg;base64,${flat}" style="position:absolute;left:${(1123 - 794) / 2}px;top:${(794 - 1123) / 2}px;width:794px;height:1123px;transform:rotate(90deg)"></div></body>`,
  );
  await page.locator("#t").screenshot({ path: photos[turnedN - 1], type: "jpeg", quality: 70 });
  ms.photos = Date.now() - t;
  await ctx.close();
  ms.total = Date.now() - t0;
  return { pdf, answersPdf, photos, turned: turnedN, blurred: blurredN, boxes, ms };
}

/** Each page of the sheet as a clean JPEG (white, straight, sharp: what the upload
 *  draws from the PDF), for the scripts that seed a ready sheet (mocks/sheets.cjs)
 *  and show its pages beside the copy. Returns the paths, page 1 (the cover) first. */
async function pageShots(browser, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const out = [];
  for (const p of SHEET.pages) {
    await page.setContent(doc([p]));
    const file = path.join(outDir, `sheet-page-${String(p.n).padStart(2, "0")}.jpg`);
    await page.locator(".pg").screenshot({ path: file, type: "jpeg", quality: 75 });
    out.push(file);
  }
  await ctx.close();
  return out;
}

module.exports = { makeSheetFiles, pageShots, SHEET };

// node e2e/study/fixtures/make-sheet.cjs <out dir>: writes the files and prints what it made (NODE_PATH=$(npm root -g)).
if (require.main === module) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("usage: node e2e/study/fixtures/make-sheet.cjs <out dir>");
    process.exit(2);
  }
  (async () => {
    const { chromium } = require("playwright");
    const browser = await chromium.launch();
    try {
      const f = await makeSheetFiles(browser, outDir);
      console.log(JSON.stringify({ ...f, photos: f.photos.map((p) => path.basename(p)), pdf: path.basename(f.pdf), answersPdf: path.basename(f.answersPdf) }, null, 1));
    } finally {
      await browser.close();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
