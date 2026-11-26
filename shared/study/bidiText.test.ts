import assert from "node:assert/strict";
import { test } from "node:test";
import { LATIN_RUN as APP_RUN, trimRun as appTrim } from "../../src/study/lib/bidi";
import { FSI, isolate, PDI, trimRun } from "./bidiText.js";

// Invented titles only.
const SAMPLES = [
  "הרצאה בדויה על Invented Kinetics",
  "Loop diuretics · מנגנון",
  "NKCC2 = שני",
  "Furosemide → פעולה",
  "IV (לאט) ואז PO",
  "Na+ ו-K⁺ בדם",
  "סיכום (Part 2) של הקורס",
  "מבחן 2026 מועד א",
  "β-blockers: מה זוכרים",
  "[Draft] טיוטה",
  "plain English only",
  "רק עברית",
];

test("the same runs as the app's own rule (src/study/lib/bidi.ts)", () => {
  for (const s of SAMPLES) {
    const re = new RegExp(APP_RUN.source, "g");
    for (const m of s.matchAll(re)) assert.equal(trimRun(m[0]), appTrim(m[0]), `${s}: "${m[0]}"`);
  }
});

test("isolate: each English run inside Hebrew between FSI and PDI", () => {
  assert.equal(isolate("הרצאה בדויה על Invented Kinetics"), `הרצאה בדויה על ${FSI}Invented Kinetics${PDI}`);
  assert.equal(isolate("Loop diuretics · מנגנון"), `${FSI}Loop diuretics${PDI} · מנגנון`);
  // A bracket the run opens and closes stays with it, as in the app.
  assert.equal(isolate("סיכום (Part 2) של הקורס"), `סיכום ${FSI}(Part 2)${PDI} של הקורס`);
  assert.equal(isolate("IV (לאט) ואז PO"), `${FSI}IV${PDI} (לאט) ואז ${FSI}PO${PDI}`);
});

test("isolate leaves alone: no Hebrew, bare numbers, text already isolated", () => {
  assert.equal(isolate("plain English only"), "plain English only");
  assert.equal(isolate("מבחן 2026 מועד א"), "מבחן 2026 מועד א");
  assert.equal(isolate("רק עברית"), "רק עברית");
  const once = isolate("על Invented Kinetics");
  assert.equal(isolate(once), once);
  assert.equal(isolate(""), "");
});

test("isolates always pair up", () => {
  for (const s of SAMPLES) {
    const out = isolate(s);
    assert.equal(out.split(FSI).length, out.split(PDI).length, s);
    assert.equal(out.replace(/[⁨⁩]/g, ""), s, `${s}: nothing but the isolates added`);
  }
});
