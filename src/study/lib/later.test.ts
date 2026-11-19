import assert from "node:assert/strict";
import { test } from "node:test";
import { addLater, dueLater, isLater, laterKey, monthOf, releaseLater } from "./later";

const GROUP = "22222222-2222-4222-8222-222222222222";
const NOV = Date.parse("2026-11-19T10:00:00Z");
const DEC = Date.parse("2026-12-01T00:30:00Z");

function storage(broken = false) {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => {
      if (broken) throw new Error("SecurityError");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("QuotaExceededError");
      store.set(k, v);
    },
    removeItem: (k: string) => store.delete(k),
  };
  return store;
}

test("a waiting summary: kept with its month (UTC, the ledger's), due from the 1st of the next", () => {
  const store = storage();
  assert.equal(monthOf(NOV), "2026-11");
  assert.equal(monthOf(Date.parse("2026-11-30T23:30:00Z")), "2026-11", "the ledger's month is UTC");
  addLater(GROUP, "a", NOV);
  addLater(GROUP, "b", NOV);
  addLater(GROUP, "a", NOV); // once each
  assert.equal(JSON.parse(store.get(laterKey(GROUP))!).length, 2);
  assert.equal(isLater(GROUP, "a", NOV), true);
  assert.equal(isLater(GROUP, "c", NOV), false);
  assert.deepEqual(dueLater(GROUP, NOV), []);
  assert.deepEqual(dueLater(GROUP, DEC), ["a", "b"]);
  assert.equal(isLater(GROUP, "a", DEC), false, "next month the phone may start it by itself");
});

test("releaseLater: each due one handed over once; one that fails stays for the next time", async () => {
  const store = storage();
  addLater(GROUP, "a", NOV);
  addLater(GROUP, "b", NOV);
  addLater(GROUP, "c", DEC);
  const asked: string[] = [];
  assert.equal(await releaseLater(GROUP, async () => true, NOV), 0, "nothing due in its own month");
  const n = await releaseLater(
    GROUP,
    async (id) => {
      asked.push(id);
      if (id === "b") throw new Error("network");
      return true;
    },
    DEC,
  );
  assert.equal(n, 1);
  assert.deepEqual(asked, ["a", "b"]);
  assert.deepEqual(JSON.parse(store.get(laterKey(GROUP))!).map((x: { id: string }) => x.id), ["b", "c"]);
  await releaseLater(GROUP, async () => true, DEC);
  assert.deepEqual(JSON.parse(store.get(laterKey(GROUP))!).map((x: { id: string }) => x.id), ["c"]);
});

test("no storage: nothing waits, nothing throws", async () => {
  storage(true);
  addLater(GROUP, "a", NOV);
  assert.equal(isLater(GROUP, "a", NOV), false);
  assert.equal(await releaseLater(GROUP, async () => true, DEC), 0);
});
