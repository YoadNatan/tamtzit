import assert from "node:assert/strict";
import { test } from "node:test";
import { installPdfPolyfills, resetPdfPolyfillsForTests } from "./polyfills";

/* iPhone browsers lack some of what pdf.js 6 calls; polyfills.ts adds each
 * one only when missing. Here they are removed first, as on such a phone. */

const removed: Array<[object, string]> = [
  [Map.prototype, "getOrInsertComputed"],
  [Map.prototype, "getOrInsert"],
  [WeakMap.prototype, "getOrInsertComputed"],
  [WeakMap.prototype, "getOrInsert"],
  [Math, "sumPrecise"],
  [Uint8Array.prototype, "toBase64"],
  [Uint8Array.prototype, "toHex"],
  [Uint8Array, "fromBase64"],
];

test("pdf.js's missing features are added only when missing, and work (iPhone upload fix)", () => {
  const saved = removed.map(([o, k]) => [o, k, Object.getOwnPropertyDescriptor(o, k)] as const);
  for (const [o, k] of removed) delete (o as Record<string, unknown>)[k];
  try {
    installPdfPolyfills();
    const m = new Map<string, number[]>() as Map<string, number[]> & {
      getOrInsertComputed(k: string, f: (k: string) => number[]): number[];
      getOrInsert(k: string, v: number[]): number[];
    };
    let calls = 0;
    m.getOrInsertComputed("a", () => (calls++, [])).push(1);
    m.getOrInsertComputed("a", () => (calls++, [])).push(2);
    assert.deepEqual(m.get("a"), [1, 2]);
    assert.equal(calls, 1);
    assert.deepEqual(m.getOrInsert("b", [7]), [7]);
    assert.deepEqual(m.getOrInsert("b", [8]), [7]);
    assert.throws(() => m.getOrInsertComputed("c", null as never), TypeError);

    const w = new WeakMap<object, string>() as WeakMap<object, string> & { getOrInsertComputed(k: object, f: () => string): string };
    const key = {};
    assert.equal(w.getOrInsertComputed(key, () => "x"), "x");
    assert.equal(w.getOrInsertComputed(key, () => "y"), "x");

    const sum = (Math as unknown as { sumPrecise(x: Iterable<number>): number }).sumPrecise;
    assert.equal(sum([1e20, 0.1, -1e20]), 0.1);
    assert.equal(sum([0.1, 0.2, 0.3]), 0.6);
    assert.equal(sum([3, 4]), 7);
    assert.ok(Object.is(sum([]), -0));
    assert.throws(() => sum(["1" as unknown as number]), TypeError);

    const bytes = new Uint8Array([0, 1, 254, 255, 72, 105]);
    const b64 = (bytes as unknown as { toBase64(): string }).toBase64();
    assert.equal(b64, Buffer.from(bytes).toString("base64"));
    assert.equal((bytes as unknown as { toHex(): string }).toHex(), "0001feff4869");
    assert.deepEqual([...(Uint8Array as unknown as { fromBase64(s: string): Uint8Array }).fromBase64(b64)], [...bytes]);
    for (const [o, k] of removed) assert.equal(Object.getOwnPropertyDescriptor(o, k)?.enumerable, false, k);
  } finally {
    for (const [o, k, d] of saved) {
      delete (o as Record<string, unknown>)[k];
      if (d) Object.defineProperty(o, k, d);
    }
  }
});

test("a ReadableStream can be read with for await after the polyfill (Safari cannot: 'text 1: undefined is not a function')", async () => {
  const proto = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
  const saved = [Symbol.asyncIterator, "values"].map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const);
  for (const [k] of saved) delete proto[k];
  try {
    assert.ok(!(Symbol.asyncIterator in proto));
    installPolyfillsAgain();
    const got: number[] = [];
    for await (const x of new ReadableStream<number>({ start(c) { c.enqueue(1); c.enqueue(2); c.enqueue(3); c.close(); } }) as unknown as AsyncIterable<number>) got.push(x);
    assert.deepEqual(got, [1, 2, 3]);

    // Leaving the loop early cancels the stream and frees it.
    let cancelled = false;
    const s = new ReadableStream<number>({ pull(c) { c.enqueue(7); }, cancel() { cancelled = true; } });
    for await (const x of s as unknown as AsyncIterable<number>) {
      assert.equal(x, 7);
      break;
    }
    assert.ok(cancelled);
    assert.equal(s.locked, false);

    // An error inside the stream reaches the loop.
    const bad = new ReadableStream({ start(c) { c.error(new Error("boom")); } });
    await assert.rejects(async () => {
      for await (const _ of bad as unknown as AsyncIterable<unknown>) void _;
    }, /boom/);
  } finally {
    for (const [k, d] of saved) {
      delete proto[k];
      if (d) Object.defineProperty(proto, k, d);
    }
  }
});

/** installPdfPolyfills runs once per page; a test that removed features again needs a fresh copy. */
function installPolyfillsAgain(): void {
  resetPdfPolyfillsForTests();
  installPdfPolyfills();
}
