import assert from "node:assert/strict";
import { test } from "node:test";
import { LATIN_RUN, pickerDir, trimRun } from "./bidi.js";

const runs = (text: string) => {
  LATIN_RUN.lastIndex = 0;
  return [...text.matchAll(LATIN_RUN)].map((m) => trimRun(m[0])).filter(Boolean);
};

test("a Latin run ends before the separator: \"Loop diuretics · מנגנון\" keeps its dot outside the English", () => {
  assert.deepEqual(runs("תרגול קצר · Loop diuretics · מנגנון פעולה"), ["Loop diuretics"]);
  assert.deepEqual(runs("Primaquine · מה בודקים"), ["Primaquine"]);
  // Inside the English the dot stays (a run that goes on in Latin).
  assert.deepEqual(runs("מנגנון של Na · K pump בכליה"), ["Na · K pump"]);
  // What the trim already did is unchanged: spaces, punctuation, a bracket it did not open.
  assert.deepEqual(runs("כמו IV (לאט)."), ["IV"]);
  assert.deepEqual(runs("(K⁺-sparing) משתנים"), ["(K⁺-sparing)"]);
  assert.deepEqual(runs("ענית ׳NCC׳, אבל"), ["NCC"]);
});

test("a date or time field takes the phone language's direction, so \"19 Nov 2026\" never reads \"Nov 2026 19\"", () => {
  for (const lang of ["en-US", "en-IL", "en", "ru-RU", "de"]) assert.equal(pickerDir(lang), "ltr", lang);
  for (const lang of ["he-IL", "he", "iw", "ar-EG", "fa", "ckb-IQ", "ps", "sd", "ug", "dv", "syr"]) assert.equal(pickerDir(lang), "rtl", lang);
  assert.equal(pickerDir(""), "ltr");
  assert.equal(pickerDir("hr-HR"), "ltr", "Croatian is not Hebrew");
});

test("a spaced operator after the English stays outside its run: \"NKCC2 = שני\" isolates \"NKCC2\" only", () => {
  assert.deepEqual(runs("NKCC2 = שני כ׳ ושני סודיום"), ["NKCC2"]);
  assert.deepEqual(runs("Furosemide → מגביר הפרשה"), ["Furosemide"]);
  assert.deepEqual(runs("ADH / וזופרסין"), ["ADH"]);
  assert.deepEqual(runs("GFR ≈ פינוי קראטינין"), ["GFR"]);
  assert.deepEqual(runs("Loop – לולאה"), ["Loop"]);
  // An unspaced sign is the run's own: "Na+", "K⁺", "pH<7".
  assert.deepEqual(runs("יון Na+ נכנס"), ["Na+"]);
  assert.deepEqual(runs("ריכוז K⁺ בדם"), ["K⁺"]);
  assert.deepEqual(runs("כש-pH<7 בשתן"), ["pH<7"]);
  // Inside the English an operator stays ("a = b" is the run's own sentence).
  assert.deepEqual(runs("הנוסחה C = U × V / P בשתן"), ["C = U × V / P"]);
});
