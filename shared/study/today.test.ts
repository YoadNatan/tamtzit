import assert from "node:assert/strict";
import { test } from "node:test";
import { flagsFrom } from "./flags.js";
import {
  asMinutes,
  cutQueue,
  dayKey,
  dayTitle,
  DEFAULT_MINUTES,
  flameChip,
  flameLine,
  flameLit,
  groupQuestion,
  FLAME_LIT,
  FLAME_WINDOW,
  MINUTES,
  minutesOf,
  ordered,
  ROWS,
  rowLabel,
  rowLines,
  rowOf,
  secondsOf,
  TRAP_CHIP,
  type KindFlag,
  type QueueItem,
} from "./today.js";

/* T-2 (spec §12.4.T): cutQueue keeps the table's priority, skips greedily,
 * always gives at least one item, honours 10/20/45; a row whose flag is off
 * never appears; the day's key. And the words today.html s1 shows. */

const all = () => true;
const item = (kind: QueueItem["kind"], n: number, o: Partial<QueueItem> = {}): QueueItem => ({ key: `${kind}:${n}`, kind, seconds: 0, at: `2026-11-1${n % 10}T08:00:00Z`, ...o });

test("the table: nine rows in the approved order, with their flags and estimates", () => {
  assert.deepEqual(
    ROWS.map((r) => `${r.kind}${r.step ?? ""}`),
    ["update", "quiz1", "danger", "again", "unclear", "card", "quiz2", "loot", "practice", "lane"],
  );
  assert.deepEqual(
    ROWS.map((r) => r.flag),
    ["var", "quiz", "progress", "mistakes", "meeting", "cardsReview", "quiz", "boss", "pulse", "groupPlan"],
  );
  assert.deepEqual(
    ROWS.map((r) => r.seconds),
    [30, 75, 75, 75, 90, 30, 75, 75, 180, 0],
  );
  // Every flag a row names is a real flag of the build.
  const f = flagsFrom({});
  for (const r of ROWS) assert.ok(r.flag in f, r.flag);
});

test("the order: by row, oldest first inside it; quiz step 2 after the cards", () => {
  const items = [
    item("card", 1, { at: "2026-11-17T09:00:00Z" }),
    item("quiz", 2, { step: 2 }),
    item("update", 3),
    item("card", 4, { at: "2026-11-17T08:00:00Z" }),
    item("quiz", 5, { step: 1 }),
    item("unclear", 6),
    item("danger", 7),
    item("practice", 8),
  ];
  assert.deepEqual(
    ordered(items, all).map((i) => i.key),
    ["update:3", "quiz:5", "danger:7", "unclear:6", "card:4", "card:1", "quiz:2", "practice:8"],
  );
  assert.equal(rowOf({ kind: "quiz" }), 1, "a quiz return without a step is step 1");
  assert.equal(rowOf({ kind: "quiz", step: 2 }), 6);
});

test("cutQueue: greedy skip, at least one, the 10/20/45 boundaries", () => {
  // 30 cards of 30 s = 15 min; one practice topic of 3 min.
  const cards = Array.from({ length: 30 }, (_, i) => item("card", i, { at: `2026-11-17T08:${String(i).padStart(2, "0")}:00Z` }));
  const ten = cutQueue(cards, 10, all);
  assert.equal(ten.items.length, 20, "10 minutes: exactly 20 cards of 30 s");
  assert.equal(ten.seconds, 600);
  assert.equal(ten.rest, 10, "the rest rolls over");
  assert.equal(cutQueue(cards, 20, all).items.length, 30);
  assert.equal(cutQueue(cards, 45, all).rest, 0);
  // Greedy skip: a 3-min topic that does not fit is skipped, a 30-s card after it still goes.
  const mixed = [item("unclear", 1), item("practice", 2), item("lane", 3, { seconds: 600 }), ...cards.slice(0, 2)];
  const cut = cutQueue(mixed, 2, all); // 120 s: unclear 90 + one card 30
  assert.deepEqual(cut.items.map((i) => i.key), ["unclear:1", "card:0"]);
  assert.equal(cut.seconds, 120);
  // At least one item, even when the first is longer than the budget.
  const one = cutQueue([item("lane", 1, { seconds: 1800 }), item("lane", 2, { seconds: 1700 })], 10, all);
  assert.deepEqual(one.items.map((i) => i.key), ["lane:1"], "nothing fits: the first item still goes");
  assert.equal(cutQueue([], 20, all).items.length, 0, "an empty queue stays empty");
  // A lane row keeps its own estimate; a case question its 120 s.
  assert.equal(secondsOf({ kind: "lane", seconds: 1200 }), 1200);
  assert.equal(secondsOf({ kind: "quiz", step: 1, seconds: 0 }), 75);
});

test("a row whose flag is off never appears", () => {
  const items = [item("update", 1), item("quiz", 2), item("danger", 3), item("again", 4), item("unclear", 5), item("card", 6), item("loot", 7), item("practice", 8), item("lane", 9, { seconds: 60 })];
  for (const off of ["var", "quiz", "progress", "mistakes", "meeting", "cardsReview", "boss", "pulse", "groupPlan"] as KindFlag[]) {
    const on = (f: KindFlag) => f !== off;
    const got = cutQueue(items, 45, on).items;
    for (const i of got) assert.notEqual(ROWS[rowOf(i)].flag, off, `${off} off: ${i.key} must not appear`);
    assert.equal(got.length, items.length - 1, `${off} off: only its row leaves`);
  }
  // From a build's flags: with only VITE_STUDY_TODAY and the cards, only cards are queued.
  const f = flagsFrom({ VITE_STUDY_TODAY: "1", VITE_STUDY_CARDS: "1", VITE_STUDY_CARDS_REVIEW: "1" });
  const kinds = cutQueue(items, 45, (k) => Boolean(f[k])).items.map((i) => i.kind);
  assert.deepEqual(kinds, ["card"]);
});

test("the minute chips and the day's key", () => {
  assert.deepEqual([...MINUTES], [10, 20, 45]);
  assert.equal(DEFAULT_MINUTES, 20);
  assert.equal(asMinutes("45"), 45);
  assert.equal(asMinutes("30"), 20, "a value no chip has is the default");
  assert.equal(asMinutes(null), 20);
  assert.equal(minutesOf(0), 1);
  assert.equal(minutesOf(61), 2);
  assert.equal(minutesOf(1200), 20);
  assert.equal(dayKey("u1", 20409), "study-today:u1:20409");
  assert.ok(dayKey("u1", 20409).startsWith("study-"), "under F's study- prefix (another user's is forgotten)");
  // 2026-11-17 is a Tuesday: "יום ג׳" (today.html s1).
  assert.equal(dayTitle(Date.UTC(2026, 10, 17) / 86_400_000), "היום · יום ג׳");
  assert.equal(dayTitle(Date.UTC(2026, 10, 21) / 86_400_000), "היום · שבת");
  assert.equal(dayTitle(Date.UTC(2026, 10, 22) / 86_400_000), "היום · יום א׳");
});

test("the flame: lit from 4 of the last 7, its words", () => {
  assert.equal(FLAME_LIT, 4);
  assert.equal(FLAME_WINDOW, 7);
  assert.equal(flameLit(3), false);
  assert.equal(flameLit(4), true);
  assert.equal(flameChip(4), "ימי למידה 4/7");
  assert.equal(flameChip(9), "ימי למידה 7/7", "never more than the window");
  assert.equal(flameLine(4), "למדת 4 מתוך 7 הימים האחרונים. מ-4 ימים זה מסומן, ויום אחד בלי לימוד לא מוחק את זה. גלוי רק לך.");
});

test("the lines of התור שלי, in today.html s1's words", () => {
  const cut = [
    item("quiz", 1, { step: 1, example: "Miltefosine: עד מתי אמצעי מניעה?", slides: [16] }),
    item("quiz", 2, { step: 1 }),
    item("danger", 3, { otherWording: true, example: "Paromomycin: luminal או tissue?" }),
    item("unclear", 4, { example: "איך Miltefosine נכנסת לטפיל?" }),
    ...Array.from({ length: 7 }, (_, i) => item("card", 10 + i, { example: i === 0 ? "Pentostam: איך היא הופכת לפעילה?" : undefined })),
    item("quiz", 20, { step: 2 }),
    item("practice", 21, { example: "Primaquine · התוויות נגד" }),
  ];
  const lines = rowLines(cut);
  assert.deepEqual(
    lines.map((l) => `${l.label} | ${l.chip}`),
    [
      "2 מהמבחן הקבוצתי | טעית אתמול",
      "1 מטעויות ׳על בטוח׳, בניסוח חדש | על בטוח",
      "פסקה שסימנת ׳לא ברור׳ | מהפגישה",
      "7 כרטיסים | הגיע הזמן",
      "1 מהמבחן הקבוצתי | טעית לפני 3 ימים",
      "תרגול קצר · Primaquine · התוויות נגד | חלש אצלך, ולא אצל הקבוצה",
    ],
  );
  assert.equal(lines[0].example, "Miltefosine: עד מתי אמצעי מניעה?", "the first item's example");
  assert.deepEqual(lines[0].slides, [16]);
  assert.equal(lines[5].example, undefined, "a topic's line is its label");
  // Trap cards only: the trap's chip.
  assert.equal(rowLines([item("card", 1, { trap: true })])[0].chip, TRAP_CHIP);
  assert.equal(rowLabel("card", 1), "כרטיס אחד");
  assert.equal(rowLabel("unclear", 2), "2 פסקאות שסימנת ׳לא ברור׳");
  assert.equal(rowLabel("update", 3), "3 עדכונים בסיכום");
  assert.equal(rowLabel("again", 1), "טעות אחת בניסוח אחר");
});

test("Today shows an open question once: not in \"בקבוצה\" when \"הקבוצה צריכה אותך\" has it (review UI-3)", () => {
  const open = { id: "c1", body: "למה Furosemide עובדת גם כשה-GFR נמוך?" };
  const needs = [{ kind: "question", comment_id: "c1" }, { kind: "approval", proposal_id: "p1" }];
  assert.equal(groupQuestion(open, needs, true), null, "the same question: only under \"הקבוצה צריכה אותך\"");
  assert.equal(groupQuestion(open, needs, false), open, "the needs-me card is off: \"בקבוצה\" keeps it");
  assert.equal(groupQuestion(open, [{ kind: "question", comment_id: "c2" }], true), open, "another question: both show");
  assert.equal(groupQuestion(open, [], true), open);
  assert.equal(groupQuestion(null, needs, true), null);
});
