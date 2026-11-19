import assert from "node:assert/strict";
import { test } from "node:test";
import type { MergedRow } from "./pulse.js";
import { cutQueue } from "./today.js";
import { againCount, againItems, practiceSize, pulseItems, runOf } from "./todaySlots.js";

/* Wave 5's integration: Today's rows 3b (Q-2, from A2's counts) and 8 (U-2's
 * "רק אצלך חם"), built from the packages' own reads. */

const G = "11111111-1111-4111-8111-111111111111";

test("again: A2's again_due less Today's own danger row, one item a question, each opening r.<group>", () => {
  assert.equal(againCount({ again_due: 0, danger_due: 0 }), 0);
  assert.equal(againCount({ again_due: 3, danger_due: 0 }), 3, "no danger row today: every one");
  assert.equal(againCount({ again_due: 3, danger_due: 2 }), 2, "Today holds the danger list's first due row only");
  assert.equal(againCount({ again_due: 1, danger_due: 1 }), 0, "the danger row alone: nothing more");
  const xs = againItems(G, { again_due: 4, danger_due: 1 });
  assert.deepEqual(
    xs.map((x) => x.key),
    ["again:0", "again:1", "again:2"],
  );
  for (const x of xs) {
    assert.equal(x.kind, "again");
    assert.equal(x.seconds, 0, "the table's 75 s");
    assert.deepEqual(x.ref?.route, { v: "practice", s: `r.${G}`, n: "5" });
  }
  // The cut keeps them in order with the table's priority (after the danger row).
  const cut = cutQueue([...xs, { key: "danger:q", kind: "danger", seconds: 0, at: "2026-11-10" }], 3, () => true);
  assert.deepEqual(
    cut.items.map((i) => i.key),
    ["danger:q", "again:0"],
    "3 minutes: the danger row and one of them (75 s each)",
  );
});

test("practiceSize: the smallest session that holds them; runOf: a run of one kind", () => {
  assert.deepEqual([1, 5, 6, 10, 11, 20, 21].map(practiceSize), ["5", "5", "10", "10", "20", "20", "all"]);
  const items = [{ kind: "danger" }, { kind: "again" }, { kind: "again" }, { kind: "card" }] as const;
  assert.equal(runOf(items, 1), 2);
  assert.equal(runOf(items, 0), 1);
  assert.equal(runOf(items, 4), 0);
});

const row = (topic_key: string, aspect: string, bucket: MergedRow["bucket"], mine: MergedRow["mine"]): MergedRow => ({
  lecture_id: "l",
  topic_key,
  topic: topic_key === "primaquine" ? "Primaquine" : "מלריה",
  aspect,
  bucket,
  slides: [37],
  closed_week: false,
  cutoff: "2026-11-17T02:00:00Z",
  mine,
  alone: bucket !== "hot" && mine === "hot",
  closedNote: false,
});

test("pulse: only topics hot for the member and not for the group, once each, opening the topic for 5", () => {
  const xs = pulseItems([
    row("primaquine", "monitoring", "cool", "hot"),
    row("primaquine", "mechanism", "warm", "hot"),
    row("malaria", "mechanism", "hot", "hot"),
    row("malaria", "adverse", "warm", "warm"),
  ]);
  assert.equal(xs.length, 1, "the group's hot row and a warm-for-her row are not hers alone; a topic once");
  assert.equal(xs[0].kind, "practice");
  assert.equal(xs[0].key, "practice:primaquine.monitoring");
  assert.ok(xs[0].example?.startsWith("Primaquine"), xs[0].example);
  assert.deepEqual(xs[0].slides, [37]);
  assert.deepEqual(xs[0].ref?.route, { v: "practice", s: "t.primaquine", n: "5" });
  assert.deepEqual(pulseItems([]), [], "no pulse (below the floor, or not counted): no row");
});
