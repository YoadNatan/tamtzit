import assert from "node:assert/strict";
import { test } from "node:test";
import type { PointsPart } from "../../../shared/study/practice2";
import { dropReading, failedParts, markReading, type PointPartRow, pointsReason, READ_AT_ONCE, readingHere, readProgress, readTime } from "./pointsRead";

/* מה ליצור while the points are read: the progress comes from the database
 * (study_points_state's parts and study_point_parts' rows), so a phone that
 * left and came back, or another member's, sees the same parts move. */

const part = (i: number, o: Partial<PointsPart> = {}): PointsPart => ({
  part_idx: i,
  title: `חלק ${i}`,
  slide_from: 1,
  slide_to: 2,
  summary: "ready",
  points: 0,
  red_flags: 0,
  status: "pending",
  current: false,
  busy: false,
  error: null,
  ...o,
});
const row = (i: number, status: PointPartRow["status"], at: string, error: string | null = null): PointPartRow => ({ part_idx: i, status, error, attempts: 1, updated_at: at });
const CLAIM = "2026-11-16T10:00:00.123456+00:00";
const LATER = "2026-11-16T10:00:41.5+00:00";
const OLD = "2026-11-10T08:00:00+00:00";

test("readProgress: the parts the latest claim took, each with its state; earlier reads' parts are not in it", () => {
  const parts = [
    part(0, { status: "ready", current: true, points: 6 }), // read last week: not this read
    part(1, { status: "ready", current: true, points: 4 }),
    part(2, { status: "writing", busy: true }),
    part(3, { status: "failed", error: "truncated" }),
    part(4, { status: "writing", busy: true }),
  ];
  const rows = [row(0, "ready", OLD), row(1, "ready", LATER), row(2, "writing", CLAIM), row(3, "failed", LATER, "truncated"), row(4, "writing", CLAIM)];
  const p = readProgress(parts, rows, null);
  assert.deepEqual(
    p.parts.map((v) => [v.part_idx, v.state, v.points, v.error]),
    [
      [1, "ready", 4, null],
      [2, "reading", 0, null],
      [3, "failed", 0, "truncated"],
      [4, "reading", 0, null],
    ],
  );
  assert.deepEqual([p.active, p.stopped, p.done, p.failed, p.total], [true, false, 1, 1, 4]);
});

test("readProgress: a member who comes back mid-read sees the same count as the phone that asked (no stream needed)", () => {
  const parts = [0, 1, 2, 3, 4].map((i) => part(i, i < 2 ? { status: "ready", current: true, points: 5 } : { status: "writing", busy: true }));
  const rows = [0, 1, 2, 3, 4].map((i) => row(i, i < 2 ? "ready" : "writing", i < 2 ? LATER : CLAIM));
  const back = readProgress(parts, rows, null);
  const asker = readProgress(parts, rows, [0, 1, 2, 3, 4]);
  assert.deepEqual([back.done, back.total, back.active], [2, 5, true]);
  assert.deepEqual(asker, back);
});

test("readProgress: a claim whose lease ran out without a result is stopped (offer to read again), never reading forever", () => {
  const parts = [part(0, { status: "ready", current: true, points: 3 }), part(1, { status: "writing", busy: false }), part(2, { status: "writing", busy: false })];
  const rows = [row(0, "ready", LATER), row(1, "writing", CLAIM), row(2, "writing", CLAIM)];
  const p = readProgress(parts, rows, null);
  assert.deepEqual(p.parts.map((v) => v.state), ["ready", "stopped", "stopped"]);
  assert.deepEqual([p.active, p.stopped], [false, true]);
  // Even while this phone still waits on its stream, a dead read is not shown as reading.
  assert.equal(readProgress(parts, rows, [0, 1, 2]).active, false);
});

test("readProgress: just asked on this phone, before the claim shows: the stale parts wait; nothing asked and nothing writing: no read", () => {
  const parts = [part(0, { status: "ready", current: true, points: 3 }), part(1), part(2, { status: "failed", error: "timeout" })];
  const rows = [row(0, "ready", OLD), row(2, "failed", OLD, "timeout")];
  const p = readProgress(parts, rows, [1, 2]);
  assert.deepEqual(p.parts.map((v) => [v.part_idx, v.state]), [
    [1, "waiting"],
    [2, "waiting"],
  ]);
  assert.deepEqual([p.active, p.total, p.done], [true, 2, 0]);
  const none = readProgress(parts, rows, null);
  assert.deepEqual([none.active, none.stopped, none.total], [false, false, 0]);
  // Without the rows, the parts' own status still shows what is being read.
  const live = readProgress([part(0, { status: "writing", busy: true }), part(1, { status: "ready", current: true })], null, null);
  assert.deepEqual(live.parts.map((v) => [v.part_idx, v.state]), [[0, "reading"]]);
});

test("readProgress: once this phone saw its read's claim, nothing writing means the read is over, whatever its stream says: the parts as they ended, not active", () => {
  // The server saved six parts, failed part 2 and part 5; the phone's stream never ended (it slept, the connection died).
  const parts = [0, 1, 2, 3, 4, 5].map((i) => (i === 2 || i === 5 ? part(i, { status: "failed", error: i === 2 ? "timeout" : "refusal" }) : part(i, { status: "ready", current: true, points: 4 })));
  const rows = parts.map((p) => row(p.part_idx, p.status, LATER, p.error));
  const over = readProgress(parts, rows, [0, 1, 2, 3, 4, 5], true);
  assert.deepEqual([over.active, over.live, over.stopped], [false, false, false]);
  assert.deepEqual(over.parts.map((v) => [v.part_idx, v.state, v.error]), [
    [0, "ready", null],
    [1, "ready", null],
    [2, "failed", "timeout"],
    [3, "ready", null],
    [4, "ready", null],
    [5, "failed", "refusal"],
  ]);
  assert.deepEqual([over.done, over.failed, over.missed, over.total], [4, 2, 2, 6]);
  // Before the claim showed, the same parts (a part that failed last time, asked again) wait: the phone just asked.
  const asking = readProgress(parts, rows, [2, 5], false);
  assert.deepEqual(asking.parts.map((v) => v.state), ["waiting", "waiting"]);
  assert.deepEqual([asking.active, asking.live], [true, false]);
});

test("readProgress: the server calls six parts at once, in order; the parts after them wait their turn (ממתין), and the count of parts left includes them", () => {
  const parts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => part(i, { status: "writing", busy: true }));
  const rows = parts.map((p) => row(p.part_idx, "writing", CLAIM));
  const p = readProgress(parts, rows, null);
  assert.deepEqual(p.parts.map((v) => v.state), ["reading", "reading", "reading", "reading", "reading", "reading", "waiting", "waiting"]);
  assert.deepEqual([p.active, p.live, p.stopped, p.done, p.total], [true, true, false, 0, 8]);
  // Parts 1 and 3 are saved: the next two in line are called.
  const parts2 = parts.map((x) => (x.part_idx === 1 || x.part_idx === 3 ? { ...x, status: "ready" as const, busy: false, current: true, points: 5 } : x));
  const rows2 = rows.map((r) => (r.part_idx === 1 || r.part_idx === 3 ? row(r.part_idx, "ready", LATER) : r));
  assert.deepEqual(
    readProgress(parts2, rows2, null).parts.map((v) => v.state),
    ["reading", "ready", "reading", "ready", "reading", "reading", "reading", "reading"],
  );
  assert.equal(READ_AT_ONCE, 6);
});

test("readProgress: a stopped read counts the parts not read, failed and stopped alike (2 לא נקראו, not one)", () => {
  const parts = [0, 1, 2, 3].map((i) => (i === 1 ? part(i, { status: "failed", error: "timeout" }) : i === 3 ? part(i, { status: "writing", busy: false }) : part(i, { status: "ready", current: true, points: 4 })));
  const rows = [row(0, "ready", LATER), row(1, "failed", LATER, "timeout"), row(2, "ready", LATER), row(3, "writing", CLAIM)];
  const p = readProgress(parts, rows, null);
  assert.deepEqual(p.parts.map((v) => v.state), ["ready", "failed", "ready", "stopped"]);
  assert.deepEqual([p.active, p.stopped, p.done, p.failed, p.missed, p.total], [false, true, 2, 1, 2, 4]);
});

test("failedParts, readTime and pointsReason: the reason in Hebrew; about a minute for up to six parts", () => {
  const parts = [part(0, { status: "failed", error: "timeout" }), part(1, { status: "failed", current: true }), part(2, { status: "ready", current: true }), part(3, { status: "failed", summary: "writing" })];
  assert.deepEqual(failedParts(parts).map((p) => p.part_idx), [0]);
  assert.equal(readTime(1), "בערך דקה");
  assert.equal(readTime(6), "בערך דקה");
  assert.equal(readTime(7), "בערך 2 דקות");
  assert.equal(pointsReason("timeout"), "הקריאה של החלק לקחה יותר מדי זמן.");
  assert.equal(pointsReason("refusal"), "המודל סירב לקרוא את החלק הזה.");
  assert.equal(pointsReason("truncated"), "הקריאה של החלק נקטעה באמצע.");
  assert.equal(pointsReason(null), "הקריאה של החלק נכשלה.");
  assert.ok(pointsReason("member_share").includes("40%"));
  for (const c of ["timeout", "refusal", "truncated", "stopped", "overloaded", "api_500", "rate_limited", "member_share", "daily_limit", "", "x"]) {
    assert.match(pointsReason(c), /[א-ת]/, c);
    assert.doesNotMatch(pointsReason(c), /שאלות|כתיבה/, `${c}: about reading points, not writing questions`);
  }
});

test("markReading: this tab remembers it asked, for six minutes; no storage reads as another phone's", () => {
  const store = new Map<string, string>();
  const g = globalThis as { sessionStorage?: unknown };
  const before = g.sessionStorage;
  g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    markReading("L", 1_000_000);
    assert.equal(readingHere("L", 1_000_000 + 5 * 60_000), true);
    assert.equal(readingHere("L", 1_000_000 + 7 * 60_000), false);
    assert.equal(readingHere("other", 1_000_000), false);
    dropReading("L");
    assert.equal(readingHere("L", 1_000_000), false);
    g.sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    markReading("L");
    assert.equal(readingHere("L"), false);
  } finally {
    g.sessionStorage = before;
  }
});

/* Package B (decision 2 of 17 Nov 2026): once the server writes a summary it
 * reads the points ahead; the claim marks its parts' ahead_at with its own
 * time. מה ליצור shows that read as the server's, not "במכשיר אחר". */
test("readProgress: the server's read ahead is told apart from a member's read (ahead_at is the claim's own time)", () => {
  const parts = [0, 1, 2].map((i) => part(i, i === 0 ? { status: "ready", current: true, points: 6 } : { status: "writing", busy: true }));
  const ahead = (r: PointPartRow, t: string | null): PointPartRow => ({ ...r, ahead_at: t });
  const rows = [ahead(row(0, "ready", LATER), CLAIM), ahead(row(1, "writing", CLAIM), CLAIM), ahead(row(2, "writing", CLAIM), CLAIM)];
  const p = readProgress(parts, rows, null);
  assert.deepEqual([p.ahead, p.active, p.done, p.total], [true, true, 1, 3], "the server reads ahead: its progress, as any read's");
  // A member's later claim (a new time) of parts the read ahead once took is the member's.
  const tap = [ahead(row(0, "ready", OLD), CLAIM), ahead(row(1, "writing", LATER), CLAIM), ahead(row(2, "writing", LATER), null)];
  assert.equal(readProgress(parts, tap, null).ahead, false, "a member's tap after a read ahead");
  // A database without section B: no ahead_at at all.
  assert.equal(readProgress(parts, [row(1, "writing", CLAIM), row(2, "writing", CLAIM)], null).ahead, false);
  // Nothing being read: not a read ahead, whatever the rows remember.
  const over = [ahead(row(1, "ready", LATER), CLAIM), ahead(row(2, "failed", LATER, "timeout"), CLAIM)];
  const done = readProgress([part(1, { status: "ready", current: true, points: 4 }), part(2, { status: "failed", error: "timeout" })], over, null);
  assert.deepEqual([done.ahead, done.active], [false, false]);
  // A read ahead the server dropped (its lease ran out): stopped, and still the server's.
  const dropped = readProgress([part(1, { status: "writing", busy: false }), part(2, { status: "writing", busy: false })], [ahead(row(1, "writing", CLAIM), CLAIM), ahead(row(2, "writing", CLAIM), CLAIM)], null);
  assert.deepEqual([dropped.ahead, dropped.stopped, dropped.active], [true, true, false]);
});
