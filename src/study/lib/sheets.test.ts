import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { coverage } from "../../../shared/study/coverage";
import { coverage as serverCoverage, normalize, similarity } from "../../../server/study/similar";

// sheets.ts imports api.ts, which reads Vite's import.meta.env; bundled into
// this one file it shares this module's import.meta, set before the import.
(import.meta as unknown as { env: Record<string, string> }).env = {};
let S: typeof import("./sheets");
before(async () => {
  S = await import("./sheets");
});

/* Uploaded sheets, release A0 (docs/study/sheets.md): what the upload and the
 * review decide on the phone, without the server. On the synthetic sheet
 * (e2e/study/fixtures/sheet/sheet6.json: fictional drugs, no course text). */

type Fixture = {
  pages: Array<{ n: number; cover?: boolean; lines: string[] }>;
  a0: { units: Array<{ reply: { questions: Array<{ no: number; vignette: string; question: string; options: string[]; prompts: string[]; page: number }> } }> };
};
const SHEET = JSON.parse(readFileSync(join(process.cwd(), "e2e", "study", "fixtures", "sheet", "sheet6.json"), "utf8")) as Fixture;

test("a file's name as a sheet's title; an empty name's fallback; Word, PDF and pictures told apart", () => {
  assert.equal(S.nameFromFile("tirgul_3-pharmaco.pdf"), "tirgul 3 pharmaco");
  assert.equal(S.nameFromFile("תרגיל 3 - פרמקוקינטיקה.PDF"), "תרגיל 3 - פרמקוקינטיקה", "a spaced dash stays");
  for (const f of [
    "IMG_2041.HEIC",
    "image.jpg",
    "PXL_20261127_101500.jpg",
    "WhatsApp Image 2026-11-27 at 10.15.00.jpeg",
    "Screenshot 2026-11-27.png",
    "scan0001.pdf",
    "DSC_0042.JPG",
  ])
    assert.equal(S.nameFromFile(f), "", `${f}: a device's own name is not a sheet's`);
  assert.equal(S.nameFromFile("Imaging review.pdf"), "Imaging review", "a word that only starts like one stays");
  assert.equal(S.nameFromFile(`${"א".repeat(130)}.pdf`).length, 120);
  assert.equal(S.fallbackName(new Date(2026, 10, 26)), "דף תרגילים 26.11");
  assert.ok(S.isWord({ name: "sheet.docx" }) && S.isWord({ name: "x", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  assert.ok(S.isPdf({ name: "a.PDF" }) && S.isPdf({ name: "x", type: "application/pdf" }) && !S.isPdf({ name: "a.docx" }));
  assert.ok(S.isImage({ name: "p.heic" }) && S.isImage({ name: "x", type: "image/png" }) && !S.isImage({ name: "a.pdf", type: "application/pdf" }));
});

test("a cover page: a name or an ID to fill in within its first lines (the synthetic sheet's page 1), never a page of questions", () => {
  assert.ok(SHEET.pages[0].cover);
  assert.equal(S.looksLikeCover(SHEET.pages[0].lines), true);
  for (const p of SHEET.pages.slice(1)) assert.equal(S.looksLikeCover(p.lines), false, `page ${p.n}`);
  assert.equal(S.looksLikeCover(["מבחן בפרמקולוגיה", "מספר סטודנט: ______"]), true);
  assert.equal(S.looksLikeCover(["תעודת זהות __________"]), true);
  assert.equal(S.looksLikeCover(["שם הסטודנט: ____"]), true);
  assert.equal(S.looksLikeCover(["שם התרופה שמופרשת בכליות היא…"]), false, "a question that begins with שם");
});

test("the camera's checks: a sharp page passes, a flat (blurred) one and a dark one are named", () => {
  const img = (w: number, h: number, f: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = f(x, y);
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    return { data, width: w, height: h };
  };
  const text = S.pageQuality(img(64, 64, (x, y) => (x % 4 === 0 || y % 7 === 0 ? 20 : 240)));
  const flat = S.pageQuality(img(64, 64, (x) => 200 + Math.round(x / 8)));
  const dark = S.pageQuality(img(64, 64, (x, y) => (x % 4 === 0 || y % 7 === 0 ? 5 : 50)));
  assert.ok(text.sharp > S.BLUR_BELOW * 10 && text.light > 150);
  assert.equal(S.qualityProblem(text), "");
  assert.equal(S.qualityProblem(flat), "blur");
  assert.equal(S.qualityProblem(dark), "dark");
  assert.equal(S.qualityProblem(null), "", "a photo the browser could not measure is not flagged");
  assert.equal(S.qualityLine("blur", 3), "עמוד 3 נראה מטושטש · כדאי לצלם שוב");
  assert.equal(S.qualityLine("dark", 4), "עמוד 4 חשוך מדי · כדאי לצלם שוב");
});

test("the course page by kind: a row from before section O 1 is a past exam", () => {
  const rows = [{ id: "a" }, { id: "b", kind: "sheet" }, { id: "c", kind: "exam" }, { id: "d", kind: null }];
  assert.deepEqual(rows.map(S.kindOf), ["exam", "sheet", "exam", "exam"]);
  const g = S.byKind(rows);
  assert.deepEqual([g.exams.map((r) => r.id), g.sheets.map((r) => r.id)], [["a", "c", "d"], ["b"]]);
});

test("the copy against the PDF's own text ($0, design D9): an exact item passes, a misread one is flagged, a scan's page flags nothing", () => {
  assert.equal(coverage, serverCoverage, "one function, shared with the server's context");
  assert.equal(normalize("**א**"), "א");
  assert.ok(similarity("abc def", "abc def") === 1);
  const lines = new Map(SHEET.pages.map((p) => [p.n, p.lines]));
  const items = SHEET.a0.units.flatMap((u) => u.reply.questions).map((q) => ({ ...q, id: `q${q.no}`, retired: false }));
  assert.ok(items.length >= 5);
  assert.deepEqual([...S.inexact(items, lines)], [], "the exam reader's copies of the synthetic sheet are its pages' text");
  const wrong = { ...items[0], id: "bad", question: "מה היה מזג האוויר בירושלים בשנת 1890 לפי היומנים של המושבה הגרמנית", options: ["חם מאוד", "קר", "גשום", "לא ידוע"] };
  assert.ok(coverage([wrong.question, ...wrong.options].join(" "), lines.get(wrong.page)!.join(" ")) < S.EXACT_BELOW);
  assert.deepEqual([...S.inexact([...items, wrong], lines)], ["bad"]);
  assert.deepEqual([...S.inexact([wrong], new Map([[wrong.page, []]]))], [], "a page with no text (a scan, a photo): nothing to compare");
  assert.deepEqual([...S.inexact([{ ...wrong, retired: true }], lines)], [], "a retired item is not checked");
});

test("the wide review's arrows stay within the list; a set item's statements are complete before they are sent", () => {
  const ids = ["a", "b", "c"];
  assert.equal(S.step(ids, null, 1), "a");
  assert.equal(S.step(ids, null, -1), "c");
  assert.equal(S.step(ids, "b", 1), "c");
  assert.equal(S.step(ids, "c", 1), "c", "the last stays the last");
  assert.equal(S.step(ids, "a", -1), "a");
  assert.equal(S.step([], "a", 1), null);
  assert.deepEqual(S.seqComplete("tf", [1, 0, 1], 3), [1, 0, 1]);
  assert.equal(S.seqComplete("tf", [1, null, 1], 3), null);
  assert.equal(S.seqComplete("tf", [1, 2], 2), null);
  assert.equal(S.seqComplete("tf", [1, 0], 3), null);
  assert.deepEqual(S.seqComplete("match", [2, 0, 1], 3), [2, 0, 1]);
});

test("a sheet's refusals and the size line", () => {
  assert.equal(S.sheetFail("sheets_cap", "sheet"), "התקציב לדפי תרגילים נגמר החודש. מתחדש ב-1 בחודש.");
  assert.match(S.sheetFail("too many pages", "sheet"), /עד 40 עמודים/);
  assert.match(S.sheetFail("too many pages", "exam"), /120/, "a past exam keeps its own words");
  assert.equal(S.sheetFail("daily_limit", "sheet"), S.sheetFail("daily_limit", "exam"));
  assert.equal(S.sizeLine(6, { from: 5, to: 10 }), "6 עמודים · לרוב ⁦5–10⁩ דקות");
  assert.equal(S.sizeLine(1, { from: 5, to: 10 }).startsWith("עמוד אחד"), true);
});
