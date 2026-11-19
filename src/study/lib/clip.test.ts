import assert from "node:assert/strict";
import { test } from "node:test";
import { cardsWord, clip } from "./clip";

test("clip: a text that fits stays whole", () => {
  assert.equal(clip("  מעכבות את NKCC2 ", 40), "מעכבות את NKCC2");
});

test("clip: a longer text is cut at its last whole word, with an ellipsis, never inside a word", () => {
  const quote = "מנגנון פעולה: מעכבות את ה-NKCC2 ב-thick ascending limb, ולכן הן המשתנים החזקים";
  const cut = clip(quote, 40);
  assert.equal(cut, "מנגנון פעולה: מעכבות את ה-NKCC2…");
  assert.ok(cut.length <= 40 && quote.startsWith(cut.slice(0, -1)));
  assert.equal(clip(quote, 70), "מנגנון פעולה: מעכבות את ה-NKCC2 ב-thick ascending limb, ולכן הן…");
});

test("cardsWord: the deck page's word for a count", () => {
  assert.equal(cardsWord(1), "כרטיס אחד");
  assert.equal(cardsWord(0), "0 כרטיסים");
  assert.equal(cardsWord(5), "5 כרטיסים");
});
