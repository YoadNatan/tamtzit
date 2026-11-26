import assert from "node:assert/strict";
import { test } from "node:test";
import { boxFigure, keyedItem, labelOf, maxOptions, numericOk, numericParse, numText, originLine, parseTable, partLine, partOf, wholePage } from "./sheetPure";

/* Uploaded sheets, release A1 (docs/study/sheets.md): the client's pure helpers. */

test("numericParse: a comma or a point, a minus either way, e and ×10^ (design §5.9)", () => {
  assert.equal(numericParse("6.9"), 6.9);
  assert.equal(numericParse("6,9"), 6.9, "a comma is the decimal point");
  assert.equal(numericParse(" 200 "), 200);
  assert.equal(numericParse("-3"), -3);
  assert.equal(numericParse("−3"), -3, "the typographic minus (no minus on iOS's decimal pad)");
  assert.equal(numericParse("1.2e-3"), 0.0012);
  assert.equal(numericParse("1.2×10^-3"), 0.0012);
  assert.equal(numericParse("1,2x10^(−3)"), 0.0012);
  assert.equal(numericParse("3×10⁻²"), 0.03, "a superscript exponent");
  assert.equal(numericParse("⁦3⁩"), 3, "isolates around a pasted number");
  for (const bad of ["", "abc", "3 שעות", "1.2.3", "--3", "e5", "1,2,3"]) assert.equal(numericParse(bad), null, bad);
});

test("numericOk and numText: the server's tolerance, and the verdict's number", () => {
  assert.equal(numericOk(3.02, 3, 1), true, "within 1%");
  assert.equal(numericOk(3.05, 3, 1), false);
  assert.equal(numericOk(3.02, 3, null), true, "1% when not said");
  assert.equal(numericOk(0, 0, 1), true, "an answer of 0 only by 0");
  assert.equal(numericOk(0.0001, 0, 1), false);
  assert.equal(numText(200), "200");
  assert.equal(numText(6.900000001), "6.9");
  assert.equal(numText(0.00002), "2e-5");
});

test("parseTable: lines kept, pipe rows as a table, the --- row skipped", () => {
  const t = "לפי הטבלה, לאיזו תרופה?\n| תרופה | פינוי |\n|---|---|\n| Fictazole | 120 |\n| Placebrin | 300 |\nשורה אחרי";
  assert.deepEqual(parseTable(t), [
    { kind: "text", lines: ["לפי הטבלה, לאיזו תרופה?"] },
    { kind: "table", rows: [["תרופה", "פינוי"], ["Fictazole", "120"], ["Placebrin", "300"]] },
    { kind: "text", lines: ["שורה אחרי"] },
  ]);
  assert.deepEqual(parseTable("שורה 1\nשורה 2\n\n"), [{ kind: "text", lines: ["שורה 1", "שורה 2"] }], "lines as printed, trailing blanks dropped");
  assert.deepEqual(parseTable("| ריק |  |"), [{ kind: "table", rows: [["ריק", ""]] }], "an empty cell stays");
  assert.deepEqual(parseTable(""), []);
});

test("partOf: a multi-part question's letter and count; a lone item has none", () => {
  const all = [{ series: "s3", step: 1 }, { series: "s3", step: 2 }, { series: "s3", step: 3 }, { series: null, step: null }];
  assert.deepEqual(partOf(all[1], all), { letter: "ב׳", index: 2, total: 3 });
  assert.equal(partLine(partOf(all[0], all)!), "סעיף א׳ מתוך 3");
  assert.equal(partOf(all[3], all), null);
  assert.equal(partOf({ series: "x", step: 1 }, [{ series: "x", step: 1 }]), null, "a series of one is not parts");
});

test("labels, origins, forms and keys in the review's words", () => {
  assert.equal(labelOf({ label: "3א", no: 301 }), "3א");
  assert.equal(labelOf({ no: 7 }), "7", "an item from before O 2: its number");
  assert.equal(originLine("solved"), "תשובה מוצעת · לא נבדקה");
  assert.equal(originLine("sheet"), "מקובץ התשובות");
  assert.equal(originLine("member", "נועה"), "נבדקה ע״י נועה");
  assert.equal(maxOptions("one"), 10);
  assert.equal(maxOptions("tf"), 6);
  assert.equal(maxOptions("open"), 0);
  assert.equal(keyedItem({ form: "numeric", answer: null, seq: null, num: 0, model_answer: null }), true, "a key of 0 is a key");
  assert.equal(keyedItem({ form: "open", answer: null, seq: null, num: null, model_answer: "" }), false);
  assert.equal(keyedItem({ form: "tf", answer: null, seq: [1, 0], num: null, model_answer: null }), true);
});

test("boxFigure: a drawn box in thousandths, either corner first; too small is none", () => {
  assert.equal(boxFigure(2, { x: 600, y: 400 }, { x: 100.4, y: 100 }), "pg:2:100,100,500,300");
  assert.equal(boxFigure(2, { x: -50, y: 0 }, { x: 1200, y: 1000 }), "pg:2:0,0,1000,1000", "kept on the page");
  assert.equal(boxFigure(2, { x: 10, y: 10 }, { x: 15, y: 400 }), null);
  assert.equal(wholePage(3), "pg:3:0,0,1000,1000");
});

test("plainOnly: a group-wide list never gets an open, numeric or similar question (design D15)", async () => {
  const { plainOnly } = await import("./questionColumns");
  const rows = [
    { id: "a", form: "one", source: "ai" },
    { id: "b", form: "tf", source: "exam" },
    { id: "c", form: "open", source: "exam" },
    { id: "d", form: "numeric", source: "exam" },
    { id: "e", form: "one", source: "twin" },
    { id: "f", source: "member" },
  ];
  assert.deepEqual(plainOnly(rows).map((r) => r.id), ["a", "b", "f"]);
});

test("release A1's words: one term per concept (COPY.md: תשובה is the answer, פתרון the worked steps)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const files = ["SheetAnswer.tsx", "SheetText.tsx", "SheetEdit.tsx", "SheetsLecture.tsx", "ExamView.tsx"].map((f) => readFileSync(join(process.cwd(), "src", "study", "components", f), "utf8"));
  for (const text of files) {
    assert.ok(!text.includes("פתרון מוצע"), "never 'פתרון מוצע': a suggested answer is 'תשובה מוצעת · לא נבדקה'");
    assert.ok(!text.includes("פותר עיוור"));
  }
  assert.ok(files[0].includes("תשובה מוצעת · לא נבדקה") && files[4].includes("פתרון מלא"));
});
