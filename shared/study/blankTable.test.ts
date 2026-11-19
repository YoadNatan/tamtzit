import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankKey,
  blankTableOf,
  cardOf,
  cellText,
  EMPTY,
  fillColumns,
  firstBlankTable,
  lectureBlankTables,
  parseBlankKey,
  sameCell,
  savedLabel,
  shapeOk,
  tableName,
  wrongCells,
  wrongLine,
  wrongParts,
} from "./blankTable.js";

/* E-3 (spec §12.6.E, P10): the blank table is the slide's own table, $0.
 * Slide 23 of the malaria deck, as the approved mockup draws it
 * (proposal/mockups/practice.html s3). */

const S23 = {
  n: 23,
  title: "לפי שלב",
  tables: [
    [
      ["תרופה", "כבד ראשוני", "Hypnozoite", "דם א-מיני", "Gametocytes"],
      ["Chloroquine, quinine", "-", "", "כן", "מוגבלת, לא falciparum"],
      ["Mefloquine", "—", "—", "כן", "—"],
      ["Artemisinins", "—", "—", "כן", "שלבים מוקדמים"],
      ["Atovaquone-proguanil", "כן", "—", "כן", "—"],
      ["Antifolates (SP)", "חלשה", "—", "כן", "—"],
      ["Primaquine, tafenoquine", "כן", "כן", "חלשה", "כן"],
    ],
  ],
};

test("the slide's table: the header, the rows, empty cells as the slide's dash, chips of each column's values", () => {
  const t = blankTableOf(S23)!;
  assert.equal(t.slide, 23);
  assert.equal(tableName(t), "לפי שלב");
  assert.deepEqual(t.header, ["תרופה", "כבד ראשוני", "Hypnozoite", "דם א-מיני", "Gametocytes"]);
  assert.equal(t.rows.length, 6);
  assert.deepEqual(t.rows[0], ["Chloroquine, quinine", EMPTY, EMPTY, "כן", "מוגבלת, לא falciparum"], "'-' and '' read as the dash");
  assert.deepEqual(t.chips[1], [EMPTY, "כן", "חלשה"]);
  assert.deepEqual(t.chips[2], [EMPTY, "כן"]);
  assert.deepEqual(t.chips[4], ["מוגבלת, לא falciparum", EMPTY, "שלבים מוקדמים", "כן"]);
  assert.deepEqual(t.fill, [false, true, true, true, true], "the label column is shown; every other column is filled");
  assert.deepEqual(fillColumns(t), [1, 2, 3, 4]);
});

test("a row is checked against the slide: case, spaces and dashes aside; an empty cell is wrong", () => {
  const t = blankTableOf(S23)!;
  assert.deepEqual(wrongCells(t, 3, { 1: "כן", 2: "—", 3: "כן", 4: "-" }), [], "Atovaquone-proguanil, as on the slide");
  assert.deepEqual(wrongCells(t, 3, { 1: "כן", 2: "כן", 3: "כן", 4: "—" }), [2], "the mockup's wrong cell: hypnozoite");
  assert.deepEqual(wrongCells(t, 3, { 1: "כן", 3: "כן", 4: "—" }), [2], "an empty cell is wrong");
  assert.ok(sameCell(" כן ", "כן") && sameCell("—", "–") && sameCell("", "-") && sameCell("Falciparum", "falciparum"));
  assert.ok(!sameCell("כן", "חלשה"));
  assert.equal(cellText("  a   b "), "a b");
});

test("a wrong cell's private card and line: the row, the column, the slide's value and its tag", () => {
  const t = blankTableOf(S23)!;
  assert.deepEqual(cardOf(t, 3, 2, "כן"), { front: "טבלה ריקה · לפי שלב: Atovaquone-proguanil, Hypnozoite?", back: "—, לא ׳כן׳. [ש׳ 23]" });
  assert.deepEqual(cardOf(t, 3, 2, undefined), { front: "טבלה ריקה · לפי שלב: Atovaquone-proguanil, Hypnozoite?", back: "—. [ש׳ 23]" });
  const c = cardOf(t, 3, 2, "כן");
  assert.ok(c.front.length >= 3 && c.front.length <= 400 && c.back.length >= 1 && c.back.length <= 300, "section C's limits");
  assert.deepEqual(wrongParts(t, 3, [2]), [{ row: "Atovaquone-proguanil", col: "Hypnozoite", value: "—" }]);
  assert.equal(wrongLine(t, 3, [2]), "בשקף: Atovaquone-proguanil · Hypnozoite: ׳—׳. [ש׳ 23]");
  assert.equal(wrongLine(t, 3, [1, 2]), "בשקף: Atovaquone-proguanil · כבד ראשוני: ׳כן׳; Atovaquone-proguanil · Hypnozoite: ׳—׳. [ש׳ 23]");
});

test("which tables are offered: the shape rule, and columns with too many or too long values are shown, not filled", () => {
  assert.ok(shapeOk({ n_rows: 3, n_cols: 2, max_cell: 10 }));
  assert.ok(!shapeOk({ n_rows: 2, n_cols: 3, max_cell: 10 }), "a header and one row is no table to fill");
  assert.ok(!shapeOk({ n_rows: 17, n_cols: 3, max_cell: 10 }), "more than 15 rows");
  assert.ok(!shapeOk({ n_rows: 4, n_cols: 7, max_cell: 10 }), "more than 6 columns");
  assert.ok(!shapeOk({ n_rows: 4, n_cols: 3, max_cell: 81 }), "a cell of prose");
  assert.equal(blankTableOf({ n: 1, tables: [[["a", "b"], ["c", "d"]]] }), null);
  // A column whose values are all different and many: a list of names, shown.
  const names = Array.from({ length: 9 }, (_, i) => [`Drug ${i}`, `use ${i}`, i % 2 ? "כן" : "לא"]);
  const t = blankTableOf({ n: 4, tables: [[["תרופה", "שימוש", "בהיריון"], ...names]] })!;
  assert.deepEqual(t.fill, [false, false, true], "nine different uses are shown; yes/no is filled");
  // Nothing to fill: no table.
  assert.equal(blankTableOf({ n: 5, tables: [[["a", "b"], ["1", "x"], ["2", "x"]]] }), null, "a column of one value leaves nothing to choose");
  // Ragged rows are padded.
  assert.deepEqual(blankTableOf({ n: 6, tables: [[["a", "b", "c"], ["1", "כן"], ["2", "לא", "כן"]]] })!.rows[0], ["1", "כן", EMPTY]);
});

test("a slide's first fillable table, the lecture's tables in slide order, and junk ignored", () => {
  const broken = { n: 9, tables: [[["only"]], "not a table", [["a", "b"], ["1", "כן"], ["2", "לא"]]] };
  assert.equal(firstBlankTable(broken)!.tbl, 2);
  assert.equal(firstBlankTable({ n: 3 }), null, "a PDF's slide has no tables");
  assert.deepEqual(
    lectureBlankTables([S23, { n: 2, tables: [] }, broken]).map((t) => t.slide),
    [23, 9],
  );
});

test("the session key: s=b.<lecture>.<slide> (§12.2.1), and only that", () => {
  const L = "eeeeeeee-0000-4000-8000-000000000005";
  assert.equal(blankKey(L, 23), `b.${L}.23`);
  assert.deepEqual(parseBlankKey(blankKey(L, 23)), { lecture: L, slide: 23 });
  assert.equal(parseBlankKey(`b.${L}.0`), null);
  assert.equal(parseBlankKey(`p.${L}.1.2`), null);
  assert.equal(parseBlankKey("b.x.3"), null);
});

test("a wrong row's line says the card is in only once it is saved (review UI-1)", () => {
  assert.equal(savedLabel("pending", 1), "נשמרת ככרטיסייה…");
  assert.equal(savedLabel("pending", 2), "נשמרות ככרטיסיות…");
  assert.equal(savedLabel("yes", 1), "נכנסה לכרטיסיות");
  assert.equal(savedLabel("yes", 3), "נכנסו לכרטיסיות");
  assert.equal(savedLabel("failed", 1), "לא נשמרה ככרטיסייה");
  assert.equal(savedLabel("failed", 2), "לא נשמרו ככרטיסיות");
  for (const s of ["pending", "failed"] as const) assert.ok(!/נכנס/.test(savedLabel(s, 1)) && !/נכנס/.test(savedLabel(s, 2)), `${s}: never "in the cards"`);
});
