import assert from "node:assert/strict";
import { before, test } from "node:test";
import { examPriceUsd, priceText } from "../../../shared/study/examPrice";
import { photoSize, reversedHebrew, usableLines } from "./examPages";
import type { KeyLog, UnitRow } from "./exams";
import { orderFor, parseScope, pickQueue, modeOf, startSession, type SessionQuestion } from "./practiceSession";

/* Past exams on the phone (docs/study/sources.md, phase 2): what the screens
 * say and count, pure. The SQL behind them is supabase/tests/study.sql's S 2
 * checks; the e2e is e2e/study/exams.cjs. */

// exams.ts imports api.ts, which reads Vite's import.meta.env; bundled into this
// file it shares this module's import.meta, set before the first evaluation.
(import.meta as unknown as { env: Record<string, string> }).env = {};
let X: typeof import("./exams");
before(async () => {
  X = await import("./exams");
});

const plain = (t: string) => t.replace(/[\u2066-\u2069]/g, "");
const unit = (pages: number[] | null, status: UnitRow["status"], kind = "read", items = 0): UnitRow => ({ kind, pages, items, status, error: null, reread: false });

test("the upload: the title, the pages' rows (the key file's after the exam's), the price on the button", () => {
  assert.equal(X.examTitle("2025", "א׳"), "מועד א׳ 2025");
  assert.equal(X.examTitle("", "ב׳"), "מועד ב׳");
  assert.equal(X.examTitle("2024", ""), "מבחן 2024");
  const rows = X.pageRows("g/exams/e/", [
    { w: 1060, h: 1500, lines: ["שורה"], key: false },
    { w: 1500, h: 1060, lines: [], key: false },
    { w: 1060, h: 1500, lines: [], key: true },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.n, r.path, r.key]),
    [
      [1, "g/exams/e/p1.jpg", false],
      [2, "g/exams/e/p2.jpg", false],
      [3, "g/exams/e/p3.jpg", true],
    ],
  );
  const price = examPriceUsd({ pages: 28 });
  assert.ok(price > 1 && price < 2.5, `28 pages: about $1.40-2 (${price})`);
  assert.equal(priceText(1.4), "כ-$1.40");
  assert.equal(priceText(0.02), "כ-$0.10", "never reads as free");
});

test("a PDF's text lines are a hint only when the page has text and its Hebrew is in reading order", () => {
  const good = ["1. מהו מנגנון הפעולה של Examplomycin?", "א. עיכוב תת-היחידה 30S", "ב. עיכוב תת-היחידה 50S", "ג. א+ב נכונות", "ד. אף תשובה אינה נכונה"];
  assert.deepEqual(usableLines(good), good);
  assert.deepEqual(usableLines(["עמוד 3"]), [], "under 80 characters: a scan");
  // The same words in visual order: final letters start the words.
  const reversed = ["םילוחה לכ ןיב הלועפה םונגנמ והמ ךיא םיקדוב ןמזה לכ", "םינמסתה ןיב לדבהה והמ םיאפור םיכירצ ךיא"];
  assert.equal(reversedHebrew(reversed), true);
  assert.equal(reversedHebrew(["כל החולים בין הפעולה מנגנון מהו איך בודקים כל הזמן", "התסמינים בין ההבדל מהו רופאים צריכים איך"]), false);
  assert.deepEqual(usableLines(reversed), [], "reversed Hebrew: read as a scan");
});

test("a photo is drawn at 1,500 px at most, a quarter turn swaps its sides", () => {
  assert.deepEqual(photoSize(4000, 3000, 0), { w: 1500, h: 1125 });
  assert.deepEqual(photoSize(4000, 3000, 1), { w: 1125, h: 1500 });
  assert.deepEqual(photoSize(800, 600, 2), { w: 800, h: 600 }, "never larger");
  assert.deepEqual(photoSize(0, 600, 0), { w: 0, h: 0 });
});

test("the reading: a row per 4 pages in page order, the key sheet, the suggested answers; the line says what runs", () => {
  const units = [unit([5, 6, 7, 8], "running"), unit([1, 2, 3, 4], "done"), unit([9, 10, 11, 12], "pending"), unit([13], "pending", "key"), unit(null, "pending", "solve", 4)];
  assert.deepEqual(
    X.unitLines(units).map((l) => [plain(l.title), l.state]),
    [
      ["עמודים 1–4", "done"],
      ["עמודים 5–8", "running"],
      ["עמודים 9–12", "pending"],
      ["דף התשובות", "pending"],
      ["תשובות מוצעות ל-4 שאלות", "pending"],
    ],
  );
  assert.equal(X.readingLine({ units, pages: 12 }), "מעתיקים עמודים \u20665–8\u2069 מתוך 12…", "the range isolated left to right");
  assert.equal(X.readingLine({ units: [unit([1, 2, 3, 4], "done"), unit(null, "running", "solve", 3)], pages: 4 }), "מציעים תשובות לשאלות בלי תשובה…");
  assert.equal(X.readingLine({ units: [unit([1], "done")], pages: 1 }), "");
  assert.equal(X.readingLine({ units: [unit([1, 2, 3, 4], "pending"), unit([5, 6, 7, 8], "pending")], pages: 8 }), "עמודים \u20661–4\u2069 בתור…", "nothing reads yet: waiting, not copying");
  assert.equal(X.repeatsLine(3), "3 שאלות לא נשמרו: המספר שלהן כבר הופיע בעמוד אחר.");
  assert.equal(X.repeatsLine(0), "");
  assert.equal(X.cancelledLine(1), "שאלה אחת בוטלה לפי דף התשובות, ולא נכללת.");
  assert.equal(X.pagesText([7]), "עמוד 7");
});

test("the review's numbers: 98 found · 91 with an answer · 7 to check; suggested keys, badly read items and items without a key are to check", () => {
  const item = (o: Partial<{ parse_conf: number | null; origin: string | null; answer: number | null; seq: number[] | null; retired: boolean }>) => ({
    parse_conf: 3,
    origin: "exam",
    answer: 0,
    seq: null,
    retired: false,
    ...o,
  });
  const items = [
    ...Array.from({ length: 91 }, () => item({})),
    ...Array.from({ length: 5 }, () => item({ origin: "solved", answer: 1 })),
    item({ origin: null, answer: null }),
    item({ parse_conf: 1 }),
    item({ retired: true }),
  ] as Parameters<typeof X.reviewCounts>[0];
  const c = X.reviewCounts(items);
  assert.deepEqual([c.found, c.withAnswer, c.toCheck, c.suggested, c.nokey, c.unclear], [98, 91, 7, 5, 1, 1]);
  assert.equal(X.foundLine(c), "נמצאו 98 שאלות · 91 עם תשובה · 7 לבדיקה");
  assert.equal(X.foundLine({ found: 1, withAnswer: 1, toCheck: 0 }), "נמצאה שאלה אחת · 1 עם תשובה");
  assert.equal(X.skippedLine(2), "2 שאלות פתוחות דולגו.");
  assert.equal(X.skippedLine(1), "שאלה פתוחה אחת דולגה.");
  assert.equal(X.skippedLine(0), "");
  assert.equal(X.itemState({ parse_conf: 3, origin: "member", answer: 2, seq: null }), "ok");
  assert.equal(X.itemState({ parse_conf: 3, origin: "solved", answer: null, seq: [1, 0, 1] }), "suggested", "a set item's suggested key");
  assert.equal(X.keyByLine({ origin: "member", key_by: "נועה", answer: 2 }), "סומנה ע״י נועה: ג׳");
  assert.equal(X.keyByLine({ origin: "exam", key_by: null, answer: 2 }), "");
  assert.equal(X.examLengthLine({ found: 100, minutes: 180 }), "100 שאלות · 3 שעות");
});

test("the key log: the last change not undone is the one ״לבטל״ takes back", () => {
  const log: KeyLog[] = [
    { id: 1, question_id: "q", old: null, new: 1, origin_old: "solved", origin_new: "member", undo_of: null, by: "נועה", at: "" },
    { id: 2, question_id: "q", old: 1, new: 2, origin_old: "member", origin_new: "member", undo_of: null, by: "שוהם", at: "" },
    { id: 3, question_id: "q", old: 2, new: 1, origin_old: "member", origin_new: "member", undo_of: 2, by: "שוהם", at: "" },
  ];
  assert.equal(X.lastUndoable(log, "q")?.id, 1, "2 was undone by 3");
  assert.equal(X.lastUndoable(log.slice(0, 2), "q")?.id, 2);
  assert.equal(X.lastUndoable(log, "other"), null);
});

test("a page box: pg:<page>:<x>,<y>,<w>,<h> in thousandths, cut by CSS", () => {
  assert.deepEqual(X.parsePageBox("pg:14:100,250,800,400"), { page: 14, x: 100, y: 250, w: 800, h: 400 });
  assert.equal(X.parsePageBox("fig:3-1"), null);
  assert.equal(X.parsePageBox("pg:1:500,0,600,100"), null, "outside the page");
  assert.equal(X.parsePageBox(""), null);
  const c = X.cropStyle({ x: 100, y: 250, w: 500, h: 250 }, { w: 1000, h: 1400 });
  assert.equal(c.width, "200%");
  assert.equal(c.left, "-20%");
  assert.equal(c.top, "-100%");
  assert.equal(c.ratio, "500000 / 350000");
});

test("the simulation's lengths follow the exam, short first; minutes at the exam's pace", () => {
  const full = X.lengthsFor({ questions: 100, minutes: 180 });
  assert.deepEqual(
    full.map((l) => [l.label, l.n, l.minutes]),
    [
      ["קצר", 20, 36],
      ["חצי", 50, 90],
      ["מלא", 100, 180],
    ],
  );
  assert.equal(`${full[0].label} · ${full[0].n} שאלות · ${X.minutesText(full[0].minutes)}`, "קצר · 20 שאלות · 36 דקות");
  assert.equal(X.minutesText(180), "3 שעות");
  assert.equal(X.minutesText(90), "90 דקות");
  assert.deepEqual(
    X.lengthsFor({ questions: 30, minutes: null }, { exam_minutes: 120, exam_n: 60 }).map((l) => [l.key, l.n, l.minutes]),
    [
      ["short", 20, 40],
      ["full", 30, 60],
    ],
    "no half for 30; the course's pace",
  );
  assert.deepEqual(
    X.lengthsFor({ questions: 12, minutes: null }).map((l) => [l.key, l.n, l.minutes]),
    [["full", 12, 22]],
    "1.8 a question",
  );
  assert.deepEqual(X.lengthsFor({ questions: 4, minutes: 10 }), [], "under 5: no simulation");
  assert.equal(X.lengthsFor({ questions: 200, minutes: 300 }).at(-1)?.n, 150, "at most 150");
  assert.deepEqual(
    X.lengthsFor({ questions: 90, minutes: 180, printed: 100 }).map((l) => [l.key, l.n, l.minutes]),
    [
      ["short", 20, 36],
      ["half", 50, 90],
      ["full", 90, 162],
    ],
    "10 open questions skipped: the whole exam's 180 minutes were for 100",
  );
});

test("one clock: counted from the server's now, so a phone whose clock is off, or that was locked, keeps the same deadline", () => {
  const deadline = "2026-11-19T12:00:00.000Z";
  const serverNow = "2026-11-19T10:17:50.000Z"; // 1:42:10 left
  const fetchedAt = Date.parse("2026-11-19T10:20:00.000Z"); // the phone's clock is 2:10 ahead
  assert.equal(X.clockText(X.remainingMs({ deadline, serverNow, fetchedAt, now: fetchedAt })), "1:42:10");
  // Locked for 5 minutes: the phone's clock moved 5 minutes, the deadline did not.
  assert.equal(X.clockText(X.remainingMs({ deadline, serverNow, fetchedAt, now: fetchedAt + 5 * 60_000 })), "1:37:10");
  assert.equal(X.remainingMs({ deadline, serverNow, fetchedAt, now: fetchedAt + 3 * 3600_000 }), 0, "never below zero");
  assert.equal(X.clockText(14 * 60_000 + 5_000), "0:14:05");
  assert.equal(X.clockWords(102 * 60_000), "נשארו שעה ו-42 דקות");
  assert.equal(X.clockWords(30_000), "נשארה פחות מדקה");
});

test("the grid and the submit line; the result's words", () => {
  const cells = X.gridCells({ question_ids: ["a", "b", "c"], picks: { a: { c: 1 }, c: { cs: [1, 0] } }, flagged: [1] });
  assert.deepEqual(
    cells.map((c) => [c.answered, c.flagged]),
    [
      [true, false],
      [false, true],
      [true, false],
    ],
  );
  assert.equal(X.submitLine(6), "להגיש עכשיו? נשארו 6 שאלות בלי תשובה.");
  assert.equal(X.submitLine(1), "להגיש עכשיו? נשארה שאלה אחת בלי תשובה.");
  assert.equal(X.submitLine(0), "להגיש עכשיו?");
  assert.deepEqual(X.scoreLines({ right: 71, counted: 97, suggested: 3, not_counted: 3 }), { big: "71 מתוך 97", note: "3 שאלות עם תשובה מוצעת · 3 לא נספרו" });
  assert.equal(X.scoreLines({ right: 5, counted: 5, suggested: 0, not_counted: 0 }).note, "");
  assert.equal(X.wrongLine({ form: "one", choice: 0, choices: null, answer: 2 }), "בחרת א׳, הנכונה ג׳");
  assert.equal(X.wrongLine({ form: "one", choice: null, choices: null, answer: 2 }), "לא ענית. הנכונה ג׳");
  assert.equal(X.usedLine("2026-11-19T10:00:00Z", "2026-11-19T12:41:00Z", 180), "זמן: שעתיים ו-41 דקות מתוך 3 שעות");
  assert.equal(X.usedLine("2026-11-19T10:00:00Z", "2026-11-19T10:12:00Z", 36), "זמן: 12 דקות מתוך 36 דקות");
  assert.equal(X.usedLine("2026-11-19T10:00:00Z", "2026-11-19T10:00:20Z", 30), "זמן: פחות מדקה מתוך 30 דקות");
  const item = (topic: string | null, correct: boolean, counted = true) => ({ id: "", pos: 1, no: 1, form: "one", answer: 0, seq: null, choice: 0, choices: null, correct, counted, origin: null, ref_lecture: null, topic });
  assert.deepEqual(X.byTopic([item("לב", true), item("לב", false), item("כליה", true), item(null, false), item("כליה", false, false)]), [
    { topic: "לב", right: 1, of: 2 },
    { topic: "כליה", right: 1, of: 1 },
  ]);
  assert.deepEqual(X.byTopic([item(null, true)]), [], "phase 2's exam items have no topic: no section");
  assert.equal(X.notCounted({ origin: "solved", conf: 2 }), true, "a suggested key under confidence 3 counts in no score");
  assert.equal(X.notCounted({ origin: "solved", conf: 3 }), false);
  assert.equal(X.notCounted({ origin: "member", conf: null }), false);
});

test("replaying a past exam: its order, and its options as printed (\"א+ב נכונות\" still points at א and ב)", () => {
  const q = (id: string, no: number, options = ["עיכוב 30S", "עיכוב 50S", "א+ב נכונות", "אף תשובה אינה נכונה"]): SessionQuestion & { source: string } => ({
    id,
    lecture_id: null,
    ref_lecture: null,
    exam_no: no,
    part_idx: null,
    created_at: "2026-11-19T10:00:00Z",
    topic: "",
    vignette: "",
    question: `שאלה ${no}`,
    options,
    source: "exam",
  });
  const items = [q("c", 3), q("a", 1), q("b", 2)];
  const scope = parseScope("e.aaaaaaaa-0000-4000-8000-000000000001");
  assert.equal(scope?.kind, "exam");
  assert.equal(modeOf(scope!), "exam");
  assert.deepEqual(pickQueue({ key: "e.aaaaaaaa-0000-4000-8000-000000000001", questions: items, latest: new Map(), size: "all", random: Math.random }), ["a", "b", "c"]);
  for (let i = 0; i < 20; i++) assert.deepEqual(orderFor(items[0], Math.random), [0, 1, 2, 3], "the exam's order, every showing");
  assert.notDeepEqual(
    Array.from({ length: 20 }, () => orderFor({ options: items[0].options }, Math.random).join("")).filter((x) => x !== "0123").length,
    0,
    "a generated question still gets a fresh order",
  );
  const s = startSession({ key: "e.aaaaaaaa-0000-4000-8000-000000000001", timed: false, queue: items, now: 0 });
  assert.deepEqual(s.orders, [
    [0, 1, 2, 3],
    [0, 1, 2, 3],
    [0, 1, 2, 3],
  ]);
  const w = parseScope("w.aaaaaaaa-0000-4000-8000-000000000001");
  assert.equal(w?.kind, "mockWrong");
  assert.equal(modeOf(w!), "exam");
  assert.deepEqual(pickQueue({ key: "w.aaaaaaaa-0000-4000-8000-000000000001", questions: items, latest: new Map(), size: "all", random: Math.random }), ["c", "a", "b"], "a simulation's mistakes in its order");
});

test("a key log of no one: the screens still name someone", () => {
  assert.equal(X.keyByLine({ origin: "member", key_by: null, answer: 0 }), "סומנה ע״י מישהו מהקבוצה: א׳");
});
