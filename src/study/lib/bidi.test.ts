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
  for (const lang of ["he-IL", "he", "iw", "ar-EG", "fa"]) assert.equal(pickerDir(lang), "rtl", lang);
  assert.equal(pickerDir(""), "ltr");
  assert.equal(pickerDir("hr-HR"), "ltr", "Croatian is not Hebrew");
});
