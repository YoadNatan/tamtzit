import assert from "node:assert/strict";
import { test } from "node:test";
import { pinNames, shortName } from "./questionText";

/* LOOK-1: "לפסקה: <part>" names the part whole or cut at a word, never a
 * fragment ("…ydras…"). */
test("shortName: a name that fits stays whole", () => {
  assert.equal(shortName("Carbonic anhydrase inhibitors", 30), "Carbonic anhydrase inhibitors");
  assert.equal(shortName("  משתנים (Diuretics) ", 24), "משתנים (Diuretics)");
});

test("shortName: a longer name is cut at its last whole word, with an ellipsis at its end", () => {
  assert.equal(shortName("Carbonic anhydrase inhibitors", 24), "Carbonic anhydrase…");
  assert.equal(shortName("מבוא: הנפרון ועקרונות הפעולה של משתנים", 24), "מבוא: הנפרון ועקרונות…");
  for (const name of ["Carbonic anhydrase inhibitors", "מבוא: הנפרון ועקרונות הפעולה של משתנים", "משתנים חוסכי אשלגן (K⁺-sparing)"]) {
    const s = shortName(name, 24);
    assert.ok(s.length <= 24, s);
    assert.ok(name.startsWith(s.slice(0, -1)), `${s} keeps the name's start`);
  }
});

test("shortName: no trailing separator before the ellipsis; one long word is cut inside", () => {
  assert.equal(shortName("מבוא: הנפרון", 8), "מבוא…");
  assert.equal(shortName("Supercalifragilisticexpialidocious", 12), "Supercalifr…");
});

test("a label item's pin names after the answer: a name with a period stays whole, name mode names the pinned options (review QT-4, QT-5)", () => {
  const pins = [1, 2, 3, 4, 5].map((n) => ({ n, x: 0.1 * n, y: 0.5 }));
  const tap = { question: "באיזה מספר מסומן Glomerulus?", options: ["1", "2", "3", "4", "5"], layout: { kind: "label", mode: "tap", pins } };
  const fb = {
    answer: 1,
    explanations: ["1 הוא Proximal tubule.", "2 הוא Glomerulus. מסנן את הדם. [ש' 3]", "3 הוא Lig. teres.", "4 הוא N. vagus.", "5 הוא V. cava inf."],
  };
  assert.deepEqual(pinNames(tap, fb), ["Proximal tubule", "Glomerulus", "Lig. teres", "N. vagus", "V. cava inf"]);
  const name = { question: "מה מסומן במספר 3 בשרטוט?", options: ["Glomerulus", "Loop of Henle", "N. vagus", "Collecting duct"], layout: { kind: "label", mode: "name", pins, ask: 3 } };
  const fb2 = {
    answer: 1,
    explanations: ["מסומן במספר 2 בשרטוט. Glomerulus מסנן. [ש' 3]", "הלולאה. [ש' 3]", "מסומן במספר 5 בשרטוט. עצב. [ש' 3]", "לא מסומן כאן. [ש' 3]"],
  };
  assert.deepEqual(pinNames(name, fb2), ["", "Glomerulus", "Loop of Henle", "", "N. vagus"]);
  assert.deepEqual(pinNames({ question: "?", options: [], layout: null }, fb2), [], "not a label item");
});
