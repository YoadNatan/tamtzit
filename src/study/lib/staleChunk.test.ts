import assert from "node:assert/strict";
import { test } from "node:test";
import { isChunkError, reloadDue } from "./staleChunk";

/* A screen's chunk gone after a deploy (lib/staleChunk.ts): which failures
 * reload the page, and that it reloads at most once a minute. */

test("a failed module load, as each browser words it, is a stale chunk; anything else is not", () => {
  for (const m of [
    "Failed to fetch dynamically imported module: https://x.app/assets/Me-abc.js",
    "error loading dynamically imported module: https://x.app/assets/Me-abc.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/today-abc.css",
    'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
  ]) {
    assert.ok(isChunkError(new Error(m)), m);
    assert.ok(isChunkError(m), m);
    assert.ok(isChunkError({ message: m }), m);
  }
  for (const x of [new Error("wrong code"), "TypeError: x is undefined", null, undefined, 42, {}]) assert.equal(isChunkError(x), false, String(x));
});

test("once a minute at most", () => {
  const now = 1_000_000_000;
  assert.equal(reloadDue(null, now), true);
  assert.equal(reloadDue(now - 5_000, now), false);
  assert.equal(reloadDue(now - 61_000, now), true);
});
