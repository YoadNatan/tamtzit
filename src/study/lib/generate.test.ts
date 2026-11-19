import assert from "node:assert/strict";
import { test } from "node:test";

/* The phone's writing run (generate.ts's writeRound), as W2 hardens it: a
 * lecture deleted while it is written cancels the run at once. The device
 * path answers "lecture not found" for a deleted lecture (loadLecture), and
 * the server claims nothing of it, so every later part would only fail the
 * same way: the run stops after the parts already in flight and throws, and
 * the reader says why. Other failures still fail part by part. */

// api.ts reads Vite's import.meta.env; bundled here it shares this module's.
(import.meta as unknown as { env: Record<string, string> }).env = {};
const { writeRound } = await import("./generate");

const never = async () => [] as number[];

test("a deleted lecture stops the run: no part after the one that was refused", async () => {
  const tried: number[] = [];
  const one = async (idx: number) => {
    tried.push(idx);
    if (idx === 2) throw new Error("lecture not found");
  };
  await assert.rejects(writeRound([1, 2, 3, 4, 5, 6], one, never, () => undefined, 1), /lecture not found/);
  assert.deepEqual(tried, [1, 2], "the parts after the refusal are never asked for");
});

test("two at a time: the part beside the refused one finishes, nothing new starts", async () => {
  const tried: number[] = [];
  const one = async (idx: number) => {
    tried.push(idx);
    await new Promise((ok) => setTimeout(ok, idx === 3 ? 30 : 5));
    if (idx === 2) throw new Error("lecture not found");
  };
  await assert.rejects(writeRound([1, 2, 3, 4, 5, 6], one, never, () => undefined, 2), /lecture not found/);
  assert.deepEqual(tried, [1, 2, 3], "part 1 alone, then 2 and 3 together; 4-6 never start");
});

test("a part that fails for its own reason does not stop the others", async () => {
  const tried: number[] = [];
  const one = async (idx: number) => {
    tried.push(idx);
    if (idx === 2) throw new Error("refusal");
  };
  assert.deepEqual(await writeRound([1, 2, 3], one, never, () => undefined, 2), { failed: 1, busy: 0 });
  assert.deepEqual(tried.sort(), [1, 2, 3]);
});
