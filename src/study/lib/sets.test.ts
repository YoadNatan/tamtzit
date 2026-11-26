import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { ShelfRow } from "./sets";
import { setLinkText } from "./setsCopy";

// sets.ts imports api.ts, which reads Vite's import.meta.env; bundled into
// this one file it shares this module's import.meta, set before the import.
(import.meta as unknown as { env: Record<string, string> }).env = {};
let avgOutOf: typeof import("./sets").avgOutOf;
let bandKey: typeof import("./sets").bandKey;
let isPaused: typeof import("./sets").isPaused;
let PAUSE_MS: number;
let setWhen: typeof import("./sets").setWhen;
let shelfGroups: typeof import("./sets").shelfGroups;
let toRow: typeof import("./sets").toRow;
let entriesOf: typeof import("./sets").entriesOf;
let mostLecture: typeof import("./sets").mostLecture;
before(async () => {
  ({ avgOutOf, bandKey, entriesOf, isPaused, mostLecture, PAUSE_MS, setWhen, shelfGroups, toRow } = await import("./sets"));
});

/* Practice sets, slice B (docs/study/sets.md): the pure rules of the set
 * screens. Synthetic rows only. */

const L1 = "11111111-0000-4000-8000-000000000001";
const L2 = "11111111-0000-4000-8000-000000000002";
const row = (id: string, o: Partial<ShelfRow> = {}): ShelfRow =>
  toRow({
    id,
    kind: "lecture",
    title: `סט ${id}`,
    lecture_id: L1,
    lecture_title: "משתנים",
    course: "פרמקולוגיה",
    author_id: "u1",
    author_name: "שוהם",
    created_at: "2026-11-20T10:00:00Z",
    updated_at: "2026-11-20T10:00:00Z",
    want: 10,
    size: "10",
    made: 10,
    state: "ready",
    paused: false,
    solvers: "2",
    my_score: null,
    my_total: null,
    my_open_attempt: null,
    is_new: false,
    is_mine: false,
    is_hidden: false,
    ...o,
  });

test("toRow: numbers that come as text are numbers; a missing score stays null", () => {
  const r = row("a", { my_score: "7" as unknown as number, my_total: 10 });
  assert.equal(r.size, 10);
  assert.equal(r.solvers, 2);
  assert.equal(r.my_score, 7);
  assert.equal(row("b").my_score, null);
});

test("the shelf: unopened sets first, then by lecture (latest activity first), the hidden folded at the end", () => {
  const rows = [
    row("old", { created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z" }),
    row("other", { lecture_id: L2, lecture_title: "אנטיביוטיקה", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-24T10:00:00Z" }),
    row("new1", { is_new: true, created_at: "2026-11-22T10:00:00Z" }),
    row("new2", { is_new: true, created_at: "2026-11-25T10:00:00Z", lecture_id: L2 }),
    row("mine", { is_mine: true, created_at: "2026-11-21T10:00:00Z", updated_at: "2026-11-21T10:00:00Z" }),
    row("gone", { is_hidden: true, is_new: true }),
  ];
  const g = shelfGroups(rows);
  assert.deepEqual(
    g.fresh.map((r) => r.id),
    ["new2", "new1"],
    "new, newest first; a hidden one is not new on the shelf",
  );
  assert.deepEqual(
    g.lectures.map((l) => [l.lecture_id, l.rows.map((r) => r.id)]),
    [
      [L2, ["other"]],
      [L1, ["mine", "old"]],
    ],
    "the lecture last active first, each newest first",
  );
  assert.equal(g.lectures[0].title, "אנטיביוטיקה");
  assert.deepEqual(
    g.hidden.map((r) => r.id),
    ["gone"],
  );
  assert.deepEqual(shelfGroups([]), { fresh: [], lectures: [], hidden: [] });
});

test("paused mirrors section L's rule: 6 minutes without a move", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(isPaused({ state: "making", updatedAt: ago(0), busy: 2, lastAt: ago(PAUSE_MS + 1000) }, now), true);
  assert.equal(isPaused({ state: "making", updatedAt: ago(0), busy: 2, lastAt: ago(PAUSE_MS - 1000) }, now), false);
  assert.equal(isPaused({ state: "making", updatedAt: ago(PAUSE_MS * 3), busy: 0, lastAt: ago(PAUSE_MS * 3) }, now), false, "nothing open: not paused");
  assert.equal(isPaused({ state: "reading", updatedAt: ago(7 * 60_000), busy: 0, lastAt: null }, now), true);
  assert.equal(isPaused({ state: "reading", updatedAt: ago(60_000), busy: 0, lastAt: null }, now), false);
  assert.equal(isPaused({ state: "ready", updatedAt: ago(PAUSE_MS * 9), busy: 3, lastAt: ago(PAUSE_MS * 9) }, now), false);
});

test("the group's numbers as shown: x/n with one decimal, the bands' words", () => {
  assert.equal(avgOutOf(0.71, 10), 7.1);
  assert.equal(avgOutOf(0.666, 3), 2);
  assert.equal(avgOutOf(null, 10), null, "under 3 others: no average");
  assert.equal(avgOutOf(0.5, 0), null);
  assert.deepEqual([bandKey(1), bandKey(2), bandKey(3)], ["few", "some", "most"]);
});

test("the shared link's text carries no title and no lecture; a set's date in words", () => {
  const t = setLinkText(10, "https://example.test/?v=sets&k=x");
  assert.equal(t, "סט תרגול בתמצית · 10 שאלות https://example.test/?v=sets&k=x");
  assert.ok(!t.includes("משתנים"));
  const now = new Date("2026-11-26T12:00:00Z");
  assert.equal(setWhen("2026-11-26T08:05:00Z", now), "היום 10:05", "Israel time");
  assert.equal(setWhen("2026-11-25T08:05:00Z", now), "אתמול");
  assert.equal(setWhen("2026-11-12T08:05:00Z", now), "12.11");
  assert.equal(setWhen("nope", now), "");
});

test("the entry points: fresh sets of others, the newest unsolved ready one, the member's own paused ones (WP14)", () => {
  const rows = [
    row("a", { created_at: "2026-11-20T10:00:00Z", is_new: true }),
    row("b", { created_at: "2026-11-21T10:00:00Z", is_new: true, is_hidden: true }),
    row("c", { created_at: "2026-11-22T10:00:00Z", is_new: true, state: "making", size: 3 }),
    row("d", { created_at: "2026-11-23T10:00:00Z", is_mine: true, state: "making", paused: true, size: 2 }),
    row("e", { created_at: "2026-11-24T10:00:00Z", is_mine: true }),
    row("f", { created_at: "2026-11-19T10:00:00Z", my_score: "7", my_total: "10" }),
    row("g", { created_at: "2026-11-18T10:00:00Z", size: 0 }),
  ];
  const e = entriesOf(rows);
  assert.deepEqual(e.fresh.map((r) => r.id), ["c", "a"], "not the hidden one, newest first");
  assert.equal(e.solve?.id, "a", "ready, someone else's, not solved, not hidden; a set still made waits");
  assert.deepEqual(e.resume.map((r) => r.id), ["d"]);
  assert.equal(entriesOf([row("x", { is_mine: true })]).solve, null, "never the member's own");
  assert.equal(entriesOf([row("y", { my_score: "3", my_total: "10" })]).solve, null, "never one already solved");
  assert.deepEqual(entriesOf([]), { fresh: [], solve: null, resume: [] });
});

test("the mistakes' lecture: the one holding most of the round, the first on a tie", () => {
  assert.equal(mostLecture([L1, L2, L2, null, L1, L2]), L2);
  assert.equal(mostLecture([L1, L2]), L1);
  assert.equal(mostLecture([null, undefined]), null);
  assert.equal(mostLecture([]), null);
});

