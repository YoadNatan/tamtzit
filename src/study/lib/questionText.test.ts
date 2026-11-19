import assert from "node:assert/strict";
import { test } from "node:test";
import { shortName } from "./questionText";

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
