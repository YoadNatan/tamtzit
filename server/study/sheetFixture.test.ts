import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { toSaveItems, toSheetKeys } from "./exams.js";
import { ExamItems, ExamKeys } from "./questions.js";

/* The uploaded sheets package's synthetic fixture (O0, docs/study/sheets.md):
 * e2e/study/fixtures/sheet/sheet6.json, a 6-page exercise sheet with a cover
 * page and a 2-page answers file, fictional drugs and patients. It is the
 * ground truth for the exactness check and for the later slices' readers, so
 * it must be consistent with itself, and release A0's replies (the exam
 * reader as it is) must save as the design says. No network, no model. */

type Item = {
  label: string; page: number; idx: number; form: string; question: string; options?: string[]; prompts?: string[];
  stem?: string; parent?: string; part?: string; answer?: number; seq?: number[]; num?: number; num_unit?: string;
  model_answer?: string; rubric?: string[]; solution?: string; figures?: string[]; unit_hint?: string;
};
const SHEET = JSON.parse(readFileSync(join(process.cwd(), "e2e", "study", "fixtures", "sheet", "sheet6.json"), "utf8")) as {
  title: string; key_source: string; printed: number;
  pages: Array<{ n: number; cover?: boolean; lines: string[] }>;
  answers: { pages: Array<{ n: number; lines: string[] }> };
  truth: Item[];
  a0: { units: Array<{ pages: number[]; next: number | null; reply: unknown }>; key: { pages: number[]; reply: unknown } };
};
const pageText = (n: number) => (SHEET.pages.find((p) => p.n === n)?.lines ?? []).join("\n");

test("the sheet is synthetic: every page and the answers file say so, and the cover has no real name", () => {
  for (const p of [...SHEET.pages, ...SHEET.answers.pages]) assert.match(p.lines.join("\n"), /synthetic|בדוי/, `page ${p.n}`);
  const cover = SHEET.pages.find((p) => p.cover);
  assert.ok(cover, "a cover page (the reader skips it; the upload offers to leave it out)");
  assert.match(cover.lines.join("\n"), /שם: _+ +ת\.ז\.: _+/, "the name and ID fields are blank");
});

test("every item is on its page exactly as printed (the exactness check's ground truth)", () => {
  assert.equal(SHEET.truth.length, SHEET.printed);
  for (const it of SHEET.truth) {
    const text = pageText(it.page);
    assert.ok(text.includes(it.question), `${it.label}: question`);
    for (const o of it.options ?? []) assert.ok(text.includes(o), `${it.label}: option ${o}`);
    for (const p of it.prompts ?? []) assert.ok(text.includes(p), `${it.label}: prompt ${p}`);
    if (it.stem) assert.ok(text.includes(it.stem), `${it.label}: the shared stem, its line break kept`);
  }
  // Line breaks and a table are part of the copy.
  assert.ok(SHEET.truth.some((it) => it.question.includes("\n") && !it.question.includes("|")), "an item over two lines");
  assert.ok(SHEET.truth.some((it) => /\n\| .+ \|/.test(it.question)), "a table as pipe rows");
});

test("the forms the design needs: one (up to 10 options), tf, match, numeric, open, a 3-part question, a figure", () => {
  const forms = new Set(SHEET.truth.map((it) => it.form));
  for (const f of ["one", "tf", "match", "numeric", "open"]) assert.ok(forms.has(f), f);
  const parts = SHEET.truth.filter((it) => it.parent === "3");
  assert.deepEqual(parts.map((it) => it.label), ["3א", "3ב", "3ג"]);
  assert.deepEqual(parts.map((it) => it.form), ["one", "numeric", "open"], "one part each of choice, numeric and open");
  assert.ok(parts[0].stem && !parts[1].stem && !parts[2].stem, "the stem on the first part only");
  const many = SHEET.truth.find((it) => (it.options?.length ?? 0) > 6);
  assert.ok(many && many.form === "one" && many.options!.length <= 10, "a one-answer item with 7-10 options");
  const fig = SHEET.truth.filter((it) => it.figures?.length);
  assert.equal(fig.length, 1);
  assert.match(fig[0].figures![0], /^pg:[0-9]{1,3}:[0-9]{1,4},[0-9]{1,4},[0-9]{1,4},[0-9]{1,4}$/, "section S's figure box format");
  // Every item has its answer: a choice key, a number with its unit, or a model answer with a rubric.
  for (const it of SHEET.truth) {
    if (it.form === "one") assert.ok(Number.isInteger(it.answer) && it.answer! >= 0 && it.answer! < it.options!.length, it.label);
    else if (it.form === "tf") assert.equal(it.seq?.length, it.options?.length, it.label);
    else if (it.form === "match") assert.equal(it.seq?.length, it.prompts?.length, it.label);
    else if (it.form === "numeric") assert.ok(typeof it.num === "number" && it.num_unit && it.solution, it.label);
    else assert.ok(it.model_answer && (it.rubric?.length ?? 0) >= 2, it.label);
  }
});

test("the answers file has every label, by its printed label", () => {
  const text = SHEET.answers.pages.map((p) => p.lines.join("\n")).join("\n");
  for (const it of SHEET.truth) assert.match(text, new RegExp(`(^|\\n)${it.label}\\. `), it.label);
});

test("release A0: the exam reader's replies pass its schema and save as the design says", () => {
  let saved = 0;
  let rejected = 0;
  let skipped = 0;
  for (const u of SHEET.a0.units) {
    const reply = ExamItems.parse(u.reply);
    skipped += reply.skipped_open;
    const r = toSaveItems(reply.questions, { pages: u.pages, next: u.next, seen: [], keySource: SHEET.key_source });
    saved += r.items.length;
    rejected += r.rejected;
    for (const it of r.items) assert.equal(it.answer, -1, "a separate answers file: no marks taken from the sheet");
  }
  // 1, 2, 3 (3א), 5, 6, 7 saved; 9 (8 options) rejected; 3ב, 3ג, 4 and 8 counted as open.
  assert.deepEqual({ saved, rejected, skipped }, { saved: 6, rejected: 1, skipped: 4 });
  assert.equal(saved + rejected + skipped, SHEET.printed);
  const keys = toSheetKeys(ExamKeys.parse(SHEET.a0.key.reply).keys);
  assert.deepEqual(keys.map((k) => k.no), [1, 2, 3, 5, 6, 7, 9]);
});

test("the O0 time measurement (tools/sheet-timing.mjs) runs on the fixture and keeps the design's rule", async () => {
  const t = (await import(pathToFileURL(join(process.cwd(), "tools", "sheet-timing.mjs")).href)) as {
    BUDGET_S: number; measure: () => { pages: number; items: number; readWorst: number; solveWorstPerItem: number };
    timing: (tps: number) => { readFits: boolean; maxItems: number; solveFits: boolean };
  };
  assert.equal(t.BUDGET_S, 120, "60% of the 200 s a unit may run");
  const m = t.measure();
  assert.deepEqual({ pages: m.pages, items: m.items }, { pages: 5, items: 11 });
  assert.ok(m.readWorst > 0 && m.solveWorstPerItem > 0);
  // Faster output never allows fewer items, and the answer is always at least 1.
  const slow = t.timing(20);
  const fast = t.timing(120);
  assert.ok(slow.maxItems >= 1 && fast.maxItems >= slow.maxItems);
  assert.equal(fast.solveFits, fast.maxItems >= 8);
});
