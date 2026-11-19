import assert from "node:assert/strict";
import { test } from "node:test";
import { roundOf, runParts, startRound } from "./rounds";

/* rounds.ts (spec §5.4): the first part alone until it starts, then two at a
 * time; busy parts skipped; a fatal code ends the round; and the store keeps
 * a round going with no screen attached. */

const tick = (ms = 5) => new Promise((ok) => setTimeout(ok, ms));

test("the first part runs alone until its response starts, then two at a time", async () => {
  let inFlight = 0;
  let most = 0;
  const log: string[] = [];
  const r = await runParts(["a", "b", "c", "d", "e"], async (id, onStart) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    log.push(`start ${id} (${inFlight} in flight)`);
    await tick(10);
    onStart();
    await tick(20);
    inFlight -= 1;
  });
  assert.deepEqual(r, { done: 5, failed: 0, busy: 0 });
  assert.equal(log[0], "start a (1 in flight)", "the first part starts alone");
  assert.equal(most, 2, "never more than two at once");
});

test("busy parts are skipped, failures counted, and a fatal code ends the round", async () => {
  const seen: string[] = [];
  const r = await runParts(["a", "b", "c", "d", "e", "f"], async (id) => {
    seen.push(id);
    if (id === "b") throw new Error("busy");
    if (id === "c") throw new Error("refusal");
    if (id === "d") throw new Error("budget");
    await tick();
  });
  assert.equal(r.busy, 1);
  assert.equal(r.error, "budget");
  assert.ok(r.failed >= 2);
  assert.ok(!seen.includes("f"), "nothing starts after the budget stops the round");
});

test("a part cut by a network error goes back in line once", async () => {
  const tries: Record<string, number> = {};
  const r = await runParts(["a", "b"], async (id) => {
    tries[id] = (tries[id] ?? 0) + 1;
    if (id === "b" && tries[id] === 1) throw new Error("network");
  });
  assert.deepEqual(tries, { a: 1, b: 2 });
  assert.deepEqual(r, { done: 2, failed: 0, busy: 0 });
});

test("the store runs a round without any screen, and a second start joins it", async () => {
  let runs = 0;
  const one = async () => {
    runs += 1;
    await tick(5);
  };
  const p1 = startRound("q:lecture-1", ["a", "b", "c"], one);
  assert.equal(roundOf("q:lecture-1")?.running, true);
  const p2 = startRound("q:lecture-1", ["a", "b", "c"], one);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(runs, 3, "the parts ran once");
  assert.equal(r1.done, 3);
  assert.equal(r2.done, 3);
  assert.deepEqual({ ...roundOf("q:lecture-1"), key: undefined }, { key: undefined, total: 3, running: false, done: 3, failed: 0, busy: 0 });
});
