import assert from "node:assert/strict";
import { test } from "node:test";
import { HUES, hueOf } from "./hue";

test("a lecture's hue is one of the four, and always the same for its id", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `eeeeeeee-0000-4000-8000-${String(i).padStart(12, "0")}`);
  for (const id of ids) {
    const h = hueOf(id);
    assert.ok(Number.isInteger(h) && h >= 1 && h <= HUES, `${id} → ${h}`);
    assert.equal(hueOf(id), h);
  }
  // Spread: forty ids use every hue.
  assert.equal(new Set(ids.map(hueOf)).size, HUES);
  assert.equal(hueOf(""), 1);
});
