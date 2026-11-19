import assert from "node:assert/strict";
import { test } from "node:test";
import { BATCH_DAYS, batchKey, clearBatch, markFile, newBatch, pickAgain, readBatch, remaining, resumeLine, settle, uploaded, writeBatch } from "./batch";

const F = (name: string, size: number) => ({ name, size, lastModified: 1_700_000_000_000 });
const FILES = [F("שיעור 1.pptx", 100), F("שיעור 2.pptx", 200), F("שיעור 3.pdf", 300), F("שיעור 4.pptx", 400)];
const GROUP = "22222222-2222-4222-8222-222222222222";

/** A localStorage for node (the browser's, in memory). */
function withStorage(run: (store: Map<string, string>) => void, broken = false) {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const before = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => {
      if (broken) throw new Error("SecurityError");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("QuotaExceededError");
      store.set(k, v);
    },
    removeItem: (k: string) => {
      if (broken) throw new Error("SecurityError");
      store.delete(k);
    },
  };
  try {
    run(store);
  } finally {
    g.localStorage = before;
  }
}

test("a new batch lists every file, none done, under the group's key", () => {
  const b = newBatch("פרמקולוגיה", null, FILES, 1000);
  assert.equal(b.files.length, 4);
  assert.ok(b.files.every((f) => !f.done && f.type === "lecture"));
  assert.equal(batchKey(GROUP), `study.batch.${GROUP}`);
  assert.equal(resumeLine(b), "נשארו 4 קבצים");
});

test("marking files done: the line counts what is up and what is left", () => {
  let b = newBatch("פרמקולוגיה", null, FILES);
  b = markFile(b, FILES[0], { done: true });
  b = markFile(b, FILES[1], { done: true });
  b = markFile(b, FILES[2], { done: true });
  assert.equal(uploaded(b).length, 3);
  assert.deepEqual(remaining(b).map((f) => f.name), ["שיעור 4.pptx"]);
  assert.equal(resumeLine(b), "הועלו 3. נשאר קובץ אחד");
  assert.equal(resumeLine(markFile(newBatch("x", null, FILES), FILES[0], { done: true })), "הועלה קובץ אחד. נשארו 3 קבצים");
});

test("picking again: a file matches by name and size; the ones up are skipped, new ones are extra", () => {
  let b = newBatch("פרמקולוגיה", null, FILES);
  b = markFile(b, FILES[0], { done: true });
  const renamedSize = F("שיעור 2.pptx", 201); // same name, another file
  const got = pickAgain(b, [...FILES, FILES[3], renamedSize, F("שיעור 9.pptx", 9)]);
  assert.deepEqual(got.already.map((f) => f.name), ["שיעור 1.pptx"]);
  assert.deepEqual(got.todo.map((f) => f.name), ["שיעור 2.pptx", "שיעור 3.pdf", "שיעור 4.pptx"], "each once, in the order picked");
  assert.deepEqual(got.extra.map((f) => `${f.name}:${f.size}`), ["שיעור 2.pptx:201", "שיעור 9.pptx:9"]);
});

test("a lecture that got there while the tab was closing is done (its id is among the group's lectures)", () => {
  let b = newBatch("פרמקולוגיה", null, FILES);
  b = markFile(b, FILES[0], { done: true, id: "a" });
  b = markFile(b, FILES[1], { id: "b" }); // the insert was on its way
  b = markFile(b, FILES[2], { id: "c" }); // the tab died before it
  const { batch, landed } = settle(b, new Set(["a", "b"]));
  assert.deepEqual(landed.map((f) => f.name), ["שיעור 2.pptx"]);
  assert.equal(resumeLine(batch), "הועלו 2. נשארו 2 קבצים");
  assert.equal(settle(batch, new Set(["a", "b"])).landed.length, 0, "a second look changes nothing");
});

test("storage: written, read back, forgotten after two weeks, cleared; a broken storage never throws", () => {
  withStorage(() => {
    const b = newBatch("פרמקולוגיה", "c1", FILES, Date.now());
    writeBatch(GROUP, b);
    assert.deepEqual(readBatch(GROUP), b);
    assert.equal(readBatch(GROUP, Date.now() + (BATCH_DAYS + 1) * 86_400_000), null, "an old batch is forgotten");
    clearBatch(GROUP);
    assert.equal(readBatch(GROUP), null);
  });
  withStorage((store) => {
    store.set(batchKey(GROUP), "{not json");
    assert.equal(readBatch(GROUP), null, "a broken entry reads as none");
    store.set(batchKey(GROUP), JSON.stringify({ v: 1, course: "x", at: Date.now(), files: [{ name: 3 }] }));
    assert.equal(readBatch(GROUP), null, "a malformed entry reads as none");
  });
  withStorage(() => {
    assert.doesNotThrow(() => writeBatch(GROUP, newBatch("x", null, FILES)));
    assert.equal(readBatch(GROUP), null);
    assert.doesNotThrow(() => clearBatch(GROUP));
  }, true);
});
