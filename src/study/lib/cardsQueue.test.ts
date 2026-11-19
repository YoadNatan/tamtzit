import assert from "node:assert/strict";
import { test } from "node:test";
import { answer, DEFAULT_CONFIG, NEW_CARD, studyDay, utcDay, type Mem } from "../../../shared/study/fsrs";
import { buildQueue, dueForToday, dueTomorrow, inMyDeck, LEARN_AHEAD_MS, newBeyondLimit, newLeftToday, partKey, remainingCounts, requeue, waitingLearning, type QCard, type QState } from "./cardsQueue";

/* C-2 (spec §7.C): the session queue of design-cards §6.2 (its five queue
 * checks, moved), plus the end screen's numbers (K5). */

const T = Date.UTC(2026, 10, 16, 8, 0);
const cards: QCard[] = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => ({ id, lectureId: "L", order: i, deleted: id === "g" }));
const mk = (state: 0 | 1 | 2 | 3, dueOffsetMin: number, suspended = false): QState => ({
  ...NEW_CARD,
  state,
  stability: state ? 3 : 0,
  difficulty: state ? 5 : 0,
  due: T + dueOffsetMin * 60_000,
  lastReview: T - 86_400_000,
  reps: 2,
  suspended,
});
const states = new Map<string, QState>([
  ["a", mk(2, -3 * 1440)], // review, 3 days overdue
  ["b", mk(1, -5)], // learning, due 5 min ago
  ["c", mk(2, 600)], // review, due later today (UTC day)
  ["d", mk(2, 2 * 1440)], // review, due in 2 days
  ["e", mk(2, -60, true)], // hidden for me
]);

test("queue: learning, then reviews due today, then new up to the limit; hidden, deleted and future cards left out", () => {
  const q = buildQueue({ cards, states, now: T, newLeft: 1, dayOf: utcDay });
  assert.equal(q.ids.join(), "b,a,c,f");
  assert.deepEqual(q.counts, { fresh: 1, learning: 1, review: 2 });
  assert.equal(buildQueue({ cards, states, now: T, newLeft: 0, dayOf: utcDay }).ids.join(), "b,a,c", "a limit of 0 shows no new card");
  assert.equal(buildQueue({ cards, states, now: T, newLeft: -3, dayOf: utcDay }).ids.join(), "b,a,c", "a negative left is none");
});

test("queue: new cards keep the deck's order; reviews due at the same time keep a stable order", () => {
  const deck: QCard[] = ["z", "y", "x"].map((id, i) => ({ id, lectureId: "L", order: i, deleted: false }));
  assert.equal(buildQueue({ cards: deck, states: new Map(), now: T, newLeft: 10 }).ids.join(), "z,y,x");
  const same = new Map<string, QState>(deck.map((c) => [c.id, mk(2, -60)]));
  const once = buildQueue({ cards: deck, states: same, now: T, newLeft: 0, dayOf: utcDay }).ids.join();
  assert.equal(buildQueue({ cards: [...deck].reverse(), states: same, now: T, newLeft: 0, dayOf: utcDay }).ids.join(), once);
});

test("queue: a review is due by its study day in Israel, from 04:00", () => {
  // 23:30 on the 16th in Israel (21:30 UTC): a card due at 03:00 on the 17th (01:00 UTC) is still today's.
  const now = Date.parse("2026-11-16T21:30:00Z");
  const one: QCard[] = [{ id: "r", lectureId: "L", order: 0, deleted: false }];
  const due = (iso: string) => new Map<string, QState>([["r", { ...mk(2, 0), due: Date.parse(iso) }]]);
  assert.equal(studyDay(Date.parse("2026-11-17T01:00:00Z")), studyDay(now));
  assert.equal(buildQueue({ cards: one, states: due("2026-11-17T01:00:00Z"), now, newLeft: 0 }).ids.join(), "r");
  assert.equal(buildQueue({ cards: one, states: due("2026-11-17T02:30:00Z"), now, newLeft: 0 }).ids.join(), "", "04:30 in Israel is tomorrow");
});

test("requeue: שוב comes back after 4 cards", () => {
  const learn: Mem = { ...NEW_CARD, state: 1, due: T + 60_000 };
  assert.equal(requeue(["x1", "x2", "x3", "x4", "x5", "x6"], "b", 1, learn, T).join(), "x1,x2,x3,x4,b,x5,x6");
  assert.equal(requeue(["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"], "b", 2, { ...learn, due: T + 6 * 60_000 }, T).join(), "x1,x2,x3,x4,x5,x6,b,x7,x8", "קשה after 6");
  assert.equal(requeue(["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "x9"], "b", 3, { ...learn, due: T + 10 * 60_000 }, T).join(), "x1,x2,x3,x4,x5,x6,x7,x8,b,x9", "טוב after 8");
});

test("requeue: within 20 minutes, at the end when fewer remain", () => {
  const learn: Mem = { ...NEW_CARD, state: 1, due: T + 10 * 60_000 };
  assert.equal(requeue(["x1"], "b", 3, learn, T).join(), "x1,b");
  assert.equal(requeue([], "b", 3, learn, T).join(), "b", "the last card comes back at once");
  assert.equal(requeue(["x1"], "b", 3, { ...learn, due: T + LEARN_AHEAD_MS + 1 }, T).join(), "x1", "beyond the learn-ahead limit it waits");
});

test("requeue: a graduated card leaves the session; the card is never in the queue twice", () => {
  const learn: Mem = { ...NEW_CARD, state: 1, due: T + 60_000 };
  assert.equal(requeue(["x1"], "b", 3, { ...learn, state: 2, due: T + 2 * 86_400_000 }, T).join(), "x1");
  assert.equal(requeue(["b", "x1", "b"], "b", 1, learn, T).join(), "x1,b");
});

test("new cards left today: limit, first-seen and 'עוד 10'", () => {
  assert.equal(newLeftToday(20, 25), 0);
  assert.equal(newLeftToday(20, 5), 15);
  assert.equal(newLeftToday(20, 25, 10), 5);
  assert.equal(newLeftToday(0, 0), 0);
});

test("a real session: שוב then טוב on a new card keeps it in the session until it graduates", () => {
  const deck: QCard[] = ["n1", "n2"].map((id, i) => ({ id, lectureId: "L", order: i, deleted: false }));
  const st = new Map<string, QState>();
  let q = buildQueue({ cards: deck, states: st, now: T, newLeft: 20 }).ids;
  let now = T;
  const shown: string[] = [];
  const cfg = { ...DEFAULT_CONFIG, fuzz: false };
  const rate = (g: 1 | 3) => {
    const id = q[0];
    shown.push(id);
    const prev = st.get(id) ?? { ...NEW_CARD, suspended: false };
    const o = answer(prev, now, g, id, cfg);
    st.set(id, { ...o.card, suspended: false });
    q = requeue(q.slice(1), id, g, o.card, now);
    now += 30_000;
  };
  rate(1); // n1: שוב → back after the rest
  rate(3); // n2: טוב → learning step 2, back at the end
  rate(3); // n1 again
  rate(3); // n2: graduates
  rate(3); // n1: graduates
  assert.deepEqual(shown, ["n1", "n2", "n1", "n2", "n1"]);
  assert.deepEqual(q, []);
  assert.equal(st.get("n1")!.state, 2);
  assert.equal(st.get("n2")!.state, 2);
});

test("the end screen's numbers: learning cards waiting, new cards past the limit, tomorrow's reviews", () => {
  const deck: QCard[] = ["l1", "l2", "n1", "n2", "r1", "r2", "h1"].map((id, i) => ({ id, lectureId: "L", order: i, deleted: false }));
  const now = Date.parse("2026-11-16T16:00:00Z"); // 18:00 in Israel
  const st = new Map<string, QState>([
    ["l1", { ...mk(1, 0), due: now + 7 * 60_000 }],
    ["l2", { ...mk(3, 0), due: now + 30 * 60_000 }],
    ["r1", { ...mk(2, 0), due: Date.parse("2026-11-17T08:00:00Z") }], // tomorrow
    ["r2", { ...mk(2, 0), due: Date.parse("2026-11-18T08:00:00Z") }],
    ["h1", { ...mk(2, 0, true), due: Date.parse("2026-11-17T08:00:00Z") }], // hidden
  ]);
  assert.deepEqual(waitingLearning(deck, st, new Set(), now), { count: 2, firstDue: now + 7 * 60_000 });
  assert.deepEqual(waitingLearning(deck, st, new Set(["l1"]), now), { count: 1, firstDue: now + 30 * 60_000 }, "a card still queued is not waiting");
  assert.equal(newBeyondLimit(deck, st, new Set(["n1"])), 1);
  assert.equal(dueTomorrow(deck, st, now), 1);
  assert.deepEqual(remainingCounts(["l1", "n1", "n2", "r1", "l1"], st), { fresh: 2, learning: 1, review: 1 });
});

/* ── CS-3 (C's end, §12.3.C): decision 8's deck part by part, review F-11's
 * one rule for new cards (trap and private cards first, all inside the day's
 * limit), and C6's review home. ── */

const ME = "u-me";
const group = [
  { id: "p0a", lecture_id: "L", part_idx: 0, source: "ai", created_by: "u-other" },
  { id: "p0b", lecture_id: "L", part_idx: 0, source: "ai", created_by: ME }, // Claude wrote it on her tap: not hers
  { id: "p1a", lecture_id: "L", part_idx: 1, source: "ai", created_by: null },
  { id: "own", lecture_id: "L", part_idx: 1, source: "member", created_by: ME },
  { id: "trap", lecture_id: "L", part_idx: 2, source: "trap", created_by: null },
  { id: "loose", lecture_id: "L", part_idx: null, source: "member", created_by: "u-other" },
];

test("C's end: a card is new for the member only in an added part, as a trap card or as her own card", () => {
  const none = new Set<string>();
  assert.deepEqual(group.filter((c) => inMyDeck(c, none, ME)).map((c) => c.id), ["own", "trap"]);
  const part0 = new Set([partKey("L", 0)]);
  assert.deepEqual(group.filter((c) => inMyDeck(c, part0, ME)).map((c) => c.id), ["p0a", "p0b", "own", "trap"]);
  assert.equal(inMyDeck(group[0], part0, "u-other"), true, "the part's key, not the person, decides");
  assert.equal(inMyDeck(group[5], new Set([partKey("L", 0), partKey("L", 1)]), ME), false, "a card on no part is new only for its writer");
});

test("C's end: new cards only from the deck; trap and private cards first among them, all inside the day's limit", () => {
  const adopted = new Set([partKey("L", 0)]);
  const deck: QCard[] = group.map((c, i) => ({ id: c.id, lectureId: "L", order: i, deleted: false, newOk: inMyDeck(c, adopted, ME), first: c.source === "trap" }));
  deck.push({ id: "mine1", lectureId: "L", order: 99, deleted: false, newOk: true, first: true, mine: true });
  const q = buildQueue({ cards: deck, states: new Map(), now: T, newLeft: 20 });
  assert.equal(q.ids.join(), "trap,mine1,p0a,p0b,own", "first the trap and the private card, then the deck's order; part 1's Claude card and a card on no part are not new");
  assert.equal(q.counts.fresh, 5);
  const three = buildQueue({ cards: deck, states: new Map(), now: T, newLeft: 3 });
  assert.equal(three.ids.join(), "trap,mine1,p0a", "the limit counts trap and private cards too");
  // A card out of the deck that she already studied is reviewed as usual.
  const studied = new Map<string, QState>([["p1a", mk(2, -60)]]);
  assert.equal(buildQueue({ cards: deck, states: studied, now: T, newLeft: 0, dayOf: utcDay }).ids.join(), "p1a");
  // K5's "נשארו … חדשות" counts only cards that may be new.
  assert.equal(newBeyondLimit(deck, new Map(), new Set(three.ids)), 2, "p0b and own; never p1a or loose");
  // A deck before C's end (no newOk): every unstudied card is new, as before.
  assert.equal(buildQueue({ cards: deck.map(({ newOk: _n, first: _f, ...c }) => c), states: new Map(), now: T, newLeft: 20 }).ids.length, 7);
});

test("C6: with Anki as her review home, Today shows no cards to review; with the app, or no choice yet, it does", () => {
  assert.equal(dueForToday("anki", 12), 0);
  assert.equal(dueForToday("app", 12), 12);
  assert.equal(dueForToday(null, 12), 12);
  assert.equal(dueForToday(undefined, 0), 0);
});

test("C's end: a session's cards: deck order, the deck's rules, a marked card out of review, private cards after the group's (not hidden ones)", async () => {
  const { deckCards } = await import("./cardsQueue");
  const cards = [
    { id: "b1", lecture_id: "B", part_idx: 0, created_at: "2026-11-01", deleted_at: null, source: "ai", created_by: null },
    { id: "a2", lecture_id: "A", part_idx: 1, created_at: "2026-11-01", deleted_at: null, source: "ai", created_by: null },
    { id: "a1", lecture_id: "A", part_idx: 0, created_at: "2026-11-02", deleted_at: null, source: "ai", created_by: null },
    { id: "a0", lecture_id: "A", part_idx: 0, created_at: "2026-11-01", deleted_at: null, source: "trap", created_by: null, stale_at: null },
    { id: "ax", lecture_id: "A", part_idx: 0, created_at: "2026-11-03", deleted_at: null, source: "ai", created_by: null, stale_at: "2026-11-05" },
  ];
  const mine = [
    { id: "m2", lecture_id: "B", part_idx: 0, created_at: "2026-11-01", suspended: false },
    { id: "m1", lecture_id: "A", part_idx: 0, created_at: "2026-11-04", suspended: false },
    { id: "mh", lecture_id: "A", part_idx: 0, created_at: "2026-11-04", suspended: true },
  ];
  const q = deckCards({ cards, lectureOrder: new Map([["A", 0], ["B", 1]]), adopted: new Set([partKey("A", 0)]), userId: ME, mine });
  assert.deepEqual(q.map((c) => c.id), ["a0", "a1", "a2", "b1", "m1", "m2"]);
  assert.deepEqual(q.filter((c) => c.newOk).map((c) => c.id), ["a0", "a1", "m1", "m2"]);
  assert.deepEqual(q.filter((c) => c.first).map((c) => c.id), ["a0", "m1", "m2"]);
  assert.ok(q.find((c) => c.id === "m1")?.mine);
  assert.equal(buildQueue({ cards: q, states: new Map(), now: T, newLeft: 20 }).ids.join(), "a0,m1,m2,a1");
});
