// The synthetic past exam as files (docs/study/sources.md, phase 2): its 12
// pages (exam/exam12.json, fictional drugs, no real exam text) printed by
// Chromium into a text PDF, its key sheet into a PDF of its own, and each
// page photographed: a JPEG screenshot of the page, slightly grey, as a
// phone's photo would be. Made at test time, never committed.
//   const { makeExamFiles } = require("./fixtures/make-exam.cjs");
//   const f = await makeExamFiles(browser, outDir); // { pdf, keyPdf, photos: [12 paths] }
const fs = require("fs");
const path = require("path");

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "exam", "exam12.json"), "utf8"));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** One page's HTML: its lines, right to left, as an exam prints them. */
function pageHtml(lines, o = {}) {
  return `<section class="pg"${o.photo ? ' style="background:#ecebe6"' : ""}>${lines.map((l, i) => `<p class="${i === 0 ? "head" : ""}">${esc(l)}</p>`).join("")}</section>`;
}

function doc(pages, o = {}) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0 }
    body { margin: 0; font: 22px/1.6 "DejaVu Sans", Arial, sans-serif; color: #111 }
    .pg { box-sizing: border-box; width: 210mm; height: 297mm; padding: 24mm 20mm; page-break-after: always; background: #fff }
    .pg:last-child { page-break-after: auto }
    .head { color: #555; font-size: 16px; margin-bottom: 18px }
    p { margin: 0 0 12px }
  </style></head><body>${pages.map((p) => pageHtml(p, o)).join("")}</body></html>`;
}

async function makeExamFiles(browser, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pdf = path.join(outDir, "exam-2025-a.pdf");
  await page.setContent(doc(FIXTURE.pages.map((p) => p.lines)));
  await page.pdf({ path: pdf, format: "A4", printBackground: true });
  const keyPdf = path.join(outDir, "exam-2025-a-key.pdf");
  await page.setContent(doc([FIXTURE.key.lines]));
  await page.pdf({ path: keyPdf, format: "A4", printBackground: true });
  const photos = [];
  for (const p of FIXTURE.pages) {
    await page.setContent(doc([p.lines], { photo: true }));
    const file = path.join(outDir, `exam-photo-${String(p.n).padStart(2, "0")}.jpg`);
    await page.locator(".pg").screenshot({ path: file, type: "jpeg", quality: 70 });
    photos.push(file);
  }
  await ctx.close();
  return { pdf, keyPdf, photos };
}

module.exports = { makeExamFiles, FIXTURE };
