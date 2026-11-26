import assert from "node:assert/strict";
import { test } from "node:test";
import { charsPerToken, estimateUsd, imageTokens } from "./estimate.js";

/* estimate.ts (design-models WP1): estimateUsd moved out of budget.ts. For
 * the default model it must give exactly today's numbers, bit for bit: the
 * function below is budget.ts's body before the move, with its own copy of
 * the Opus 5.5 row and the 2.5 factor. */

const OPUS = { in: 4, out: 20, w5m: 5, w1h: 8, hit: 0.2 };
function before(inputChars: number, maxTokens: number, extraInputTokens = 0, opts: { batch?: boolean } = {}): number {
  const p = OPUS;
  const input = Math.max(0, inputChars) / 2.5 + Math.max(0, extraInputTokens);
  return ((input * Math.max(p.in, p.w5m) + Math.max(0, maxTokens) * p.out) / 1_000_000) * (opts.batch ? 0.5 : 1);
}

test("Opus 5.5: the same number as before the move, for every shape a call site sends", () => {
  // A deterministic spread: small and large inputs, odd character counts, pictures, batch.
  let seed = 7;
  const next = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };
  const fixed: Array<[number, number, number, boolean]> = [
    [0, 0, 0, false],
    [25_000, 48_000, 0, false],
    [63_900, 48_000, 7_839, false],
    [40_600, 8_000, 0, false],
    [12_001, 800, 0, false],
    [3, 1, 1, true],
    [-5, -1, -2, false],
    [1_234_567, 128_000, 26_140, true],
  ];
  for (let i = 0; i < 2_000; i++) fixed.push([next(400_000), next(130_000), next(3) ? 0 : next(40_000), next(4) === 0]);
  for (const [chars, max, extra, batch] of fixed) {
    const opts = batch ? { batch: true } : {};
    assert.equal(estimateUsd("claude-opus-5-5", chars, max, extra, opts), before(chars, max, extra, opts), `${chars}, ${max}, ${extra}, ${batch}`);
    assert.equal(estimateUsd("claude-opus-5-5-20260101", chars, max, extra, opts), before(chars, max, extra, opts), "a dated id");
  }
  assert.equal(estimateUsd("claude-opus-5-5", 25_000, 48_000), before(25_000, 48_000), "F0's three arguments");
  assert.equal(estimateUsd.length, 3, "the three without a default come first");
});

test("characters a token: 2.5 for Claude, 1.9 for Haiku 5.5 (about 30% more tokens), 2.5 for a model nobody lists", () => {
  for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-sonnet-5", "claude-haiku-4-5"]) assert.equal(charsPerToken(m), 2.5, m);
  assert.equal(charsPerToken("claude-haiku-5-5"), 1.9);
  assert.equal(charsPerToken("claude-someday-9"), 2.5);
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
  near(estimateUsd("claude-haiku-5-5", 1_900, 0), (1_000 * 0.125) / 1_000_000);
  near(estimateUsd("claude-sonnet-5-5", 2_500, 1_000), (1_000 * 2.5 + 1_000 * 10) / 1_000_000);
});

test("a reservation never takes the cheaper card for a prompt estimated just under the dearer card's line", () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
  // About 95k tokens estimated (Haiku 5.5's line is 100k): reserved at the dearer card.
  near(estimateUsd("claude-haiku-5-5", 95_000 * 1.9, 0), (95_000 * 0.625) / 1_000_000);
  // About 80k: well under the line, the usual card.
  near(estimateUsd("claude-haiku-5-5", 80_000 * 1.9, 0), (80_000 * 0.125) / 1_000_000);
});

test("imageTokens: width × height / 750, unknown sizes at the largest picture stored", () => {
  assert.equal(imageTokens(1200, 800), 1280);
  assert.equal(imageTokens(0, 0), 2614);
  assert.equal(imageTokens(null, 1400), 2614);
  assert.equal(imageTokens(1061, 1500), Math.ceil((1061 * 1500) / 750));
});
