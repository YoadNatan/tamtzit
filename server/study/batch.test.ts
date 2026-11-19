import assert from "node:assert/strict";
import { test } from "node:test";
import { batchCost, cardUsd, LOW_LEFT_USD, SUMMARY_PRICES, summaryUsd, type DeckSize } from "../../shared/study/batch.js";
import { costUsd, POLICY } from "./budget.js";
import { MODEL } from "./study.js";

/* The batch upload's price card (sources.md B8, B9): the usual cost of a
 * lecture's summary, and which summaries wait for next month, from the
 * ledger's spend and the cap. Decks are sizes only (no lecture text). */

const deck = (slides: number, chars: number, pictures: number): DeckSize => ({ slides, chars, pictures });

test("the writer's prices are budget.ts's for the model that writes", () => {
  const per = (u: object) => costUsd(u, MODEL) * 1_000_000;
  assert.equal(per({ input_tokens: 1 }), SUMMARY_PRICES.in);
  assert.equal(per({ output_tokens: 1 }), SUMMARY_PRICES.out);
  assert.equal(per({ cache_creation_input_tokens: 1 }), SUMMARY_PRICES.w5m);
  assert.equal(per({ cache_read_input_tokens: 1 }), SUMMARY_PRICES.hit);
});

test("a lecture's summary: under $1 for a usual deck, growing with slides, text and pictures", () => {
  const usual = summaryUsd(deck(40, 30_000, 20));
  assert.ok(usual > 0.6 && usual < 1, String(usual));
  assert.ok(summaryUsd(deck(80, 30_000, 20)) > usual);
  assert.ok(summaryUsd(deck(40, 60_000, 20)) > usual);
  assert.ok(summaryUsd(deck(40, 30_000, 60)) > usual);
  assert.ok(summaryUsd(deck(0, 0, 0)) > 0, "an empty deck still has an outline and a part");
  // 25 lectures: about B10's $22 a block.
  const block = 25 * usual;
  assert.ok(block > 15 && block < 25, String(block));
});

test("the card: what is left from the ledger, and the last summaries that do not fit wait", () => {
  const files = Array.from({ length: 8 }, () => deck(40, 30_000, 20));
  const each = summaryUsd(files[0]);
  const all = batchCost(files, { spentUsd: 9, capUsd: 33 });
  assert.equal(all.leftUsd, 24);
  assert.equal(all.waiting, 0);
  assert.equal(all.perFile.length, 8);
  assert.ok(Math.abs(all.summariesUsd - 8 * each) < 1e-9);
  assert.equal(all.low, false);
  // $2.10 left: two fit, six wait; little is left.
  const tight = batchCost(files, { spentUsd: 30.9, capUsd: 33 });
  assert.equal(tight.waiting, 8 - Math.floor(2.1 / each));
  assert.equal(tight.low, true);
  // Over the cap already: nothing fits, never a negative "left".
  assert.deepEqual([batchCost(files, { spentUsd: 40, capUsd: 33 }).leftUsd, batchCost(files, { spentUsd: 40, capUsd: 33 }).waiting], [0, 8]);
  // Summaries stop at the cap itself: their kinds have share 1.
  assert.equal(POLICY.outline.share, 1);
  assert.equal(POLICY.part.share, 1);
  assert.equal(batchCost(files, { spentUsd: 26.4, capUsd: 33 }).leftUsd.toFixed(2), "6.60");
  assert.equal(batchCost(files, { spentUsd: 0, capUsd: 33, share: 0.8 }).leftUsd.toFixed(2), "26.40");
  assert.equal(LOW_LEFT_USD, 10);
});

test("dollars on the card: whole from $5, else up to the next 10 cents", () => {
  assert.deepEqual([7.4, 24, 0.81, 0.8, 0.01, 0, 4.96].map(cardUsd), ["$7", "$24", "$0.90", "$0.80", "$0.10", "$0.10", "$5"]);
});
