import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchCost,
  cardUsd,
  LOW_LEFT_USD,
  PART_RESERVE_TOKENS,
  partReserveUsd,
  POINTS_AHEAD_USD,
  SUMMARY_PRICES,
  summaryUsd,
  WRITERS_AT_ONCE,
  type DeckSize,
} from "../../shared/study/batch.js";
import { DEFAULT_MODEL } from "../../shared/study/prices.js";
import { costUsd, estimateUsd, POLICY } from "./budget.js";
import { MODEL } from "./study.js";
import { PART_TOKENS } from "./writer.js";

/* The batch upload's price card (sources.md B8, B9): the usual cost of a
 * lecture's summary, and which summaries wait for next month, from the
 * ledger's spend and the cap. Decks are sizes only (no lecture text). */

const deck = (slides: number, chars: number, pictures: number): DeckSize => ({ slides, chars, pictures });

test("the writer's prices are budget.ts's for the model that writes", () => {
  // The registry's default row (shared/study/prices.ts), the same numbers as before the registry.
  assert.equal(MODEL, DEFAULT_MODEL);
  assert.deepEqual({ ...SUMMARY_PRICES }, { in: 4, out: 20, w5m: 5, hit: 0.2 });
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
  // $2.10 left: less than the writers' reservations hold at once, so all wait; little is left.
  const tight = batchCost(files, { spentUsd: 30.9, capUsd: 33 });
  assert.ok(tight.headroomUsd > 2.1, String(tight.headroomUsd));
  assert.equal(tight.waiting, 8);
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

test("the card counts against the writers' worst-case reservations, not the usual cost alone; and the points read ahead", () => {
  const d = deck(40, 30_000, 20);
  const each = summaryUsd(d);
  // A part reserves what the writer reserves: estimateUsd with PART_TOKENS of output.
  assert.equal(PART_RESERVE_TOKENS, PART_TOKENS);
  const reserve = partReserveUsd(d);
  const writerWay = estimateUsd(MODEL, 30_000 + 3_000 * 2.5, PART_TOKENS, (20 * 1_600) / 5);
  assert.ok(Math.abs(reserve - writerWay) < 0.02, `${reserve} vs ${writerWay}`);
  assert.ok(reserve > 0.9 && reserve < 1.3, String(reserve));
  // $13 left and 12 lectures (about $10 by the usual cost): one waits, for the 3 parts' room.
  const files = Array.from({ length: 12 }, () => d);
  const c = batchCost(files, { spentUsd: 20, capUsd: 33 });
  assert.ok(12 * each < 13, "the usual cost alone would fit them all");
  assert.equal(c.headroomUsd.toFixed(4), (WRITERS_AT_ONCE * reserve).toFixed(4));
  assert.equal(c.waiting, 12 - Math.floor((13 - c.headroomUsd) / each));
  assert.ok(c.waiting >= 1);
  // With the points read ahead, each lecture costs POINTS_AHEAD_USD more.
  const ahead = batchCost(files, { spentUsd: 20, capUsd: 33, ahead: true });
  assert.equal(ahead.waiting, 12 - Math.floor((13 - c.headroomUsd) / (each + POINTS_AHEAD_USD)));
  assert.ok(ahead.waiting >= c.waiting);
  assert.equal(POLICY.points.share, 0.8, "the points stop at the 80% line, so they never take the cap's last fifth");
  assert.equal(batchCost([], { spentUsd: 0, capUsd: 33 }).headroomUsd, 0);
});

test("dollars on the card: whole from $5, else up to the next 10 cents", () => {
  assert.deepEqual([7.4, 24, 0.81, 0.8, 0.01, 0, 4.96].map(cardUsd), ["$7", "$24", "$0.90", "$0.80", "$0.10", "$0.10", "$5"]);
});
