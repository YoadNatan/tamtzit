import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { dateOfDay, dayOfDate } from "./day.js";
import { eveAids, EVE_EMPTY, summarySlide } from "./eve.js";
import {
  allRead,
  blockRow,
  blockTimes,
  buildLane,
  dayRows,
  eveOpen,
  kmOn,
  LANE,
  longerUntil,
  marathonAgenda,
  marathonMinutes,
  missedOf,
  myLane,
  nextBlock,
  pendingSlip,
  phaseOn,
  PLAN,
  planDays,
  planMeter,
  sharedDays,
  slipPrices,
  type GroupPlan,
  type LectureFact,
  type MeterRow,
} from "./lane.js";
import { masteryWords, NEEDS_ME, needsMeLines, whyLine } from "./today.js";

/* Package G's lanes (spec §12.6.G's G-2) and decision 3's meters (17 Nov
 * 2026): every number is computed from counts, and every threshold is one
 * set of numbers with the SQL that uses it. */

const SQL = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
const sqlConst = (fn: string): number => {
  const m = new RegExp(`function study_private\\.${fn}\\(\\) returns int language sql immutable as \\$\\$ select (\\d+) \\$\\$`).exec(SQL);
  assert.ok(m, `the SQL defines study_private.${fn}()`);
  return Number(m[1]);
};
const sectionG = SQL.slice(SQL.indexOf("-- ════ BEGIN SECTION G"), SQL.indexOf("-- ════ END SECTION G ════"));

test("the thresholds: PLAN is section G's, NEEDS_ME is section T's end, LANE's defaults are study_group_plan_save's", () => {
  assert.deepEqual(
    { LECTURE_ANSWERS: sqlConst("plan_lecture_answers"), FLOOR: sqlConst("plan_floor"), WINDOW_DAYS: sqlConst("plan_window_days"), HOT_BELOW: sqlConst("plan_hot_below"), OK_FROM: sqlConst("plan_ok_from") },
    { ...PLAN },
  );
  assert.equal(PLAN.FLOOR, 3, "decision 3's floor: 3 different members behind any group number");
  assert.equal(sqlConst("pulse_floor"), PLAN.FLOOR, "one floor for the pulse and the plan");
  // The meter reads its numbers from the functions, never literals.
  const meter = sectionG.slice(sectionG.indexOf("create or replace function public.study_group_plan_meter("), sectionG.indexOf("create or replace function public.study_exam_marks("));
  for (const fn of ["plan_lecture_answers", "plan_floor", "plan_window_days", "plan_hot_below", "plan_ok_from"]) assert.ok(meter.includes(`study_private.${fn}()`), `the meter reads ${fn}()`);
  assert.ok(!/\b(20|28|60|80)\b/.test(meter.replace(/--[^\n]*/g, "")), "no literal threshold in the meter");
  assert.deepEqual(
    { MIN_ANSWERS: sqlConst("needs_me_min_answers"), MASTER_PCT: sqlConst("needs_me_master_pct"), WINDOW_DAYS: sqlConst("needs_me_window_days"), WAIT_HOURS: sqlConst("needs_me_wait_hours") },
    { ...NEEDS_ME },
  );
  const save = sectionG.slice(sectionG.indexOf("create or replace function public.study_group_plan_save("), sectionG.indexOf("-- PL2:"));
  assert.ok(save.includes(`coalesce(p_shared_from, p_exam_date - ${LANE.SHARED_DAYS})`) && save.includes(`coalesce(p_leave_from, p_exam_date - ${LANE.LEAVE_DAYS})`), "3 weeks and 2 weeks before the exam");
  assert.ok(save.includes(`p_shared_minutes int default ${LANE.SHARED_MINUTES}`) && save.includes(`p_leave_minutes int default ${LANE.LEAVE_MINUTES}`) && save.includes(`p_rounds int default ${LANE.ROUNDS}`));
  assert.ok(SQL.includes(`check (minutes between 30 and ${LANE.MAX_DAY_MIN})`) && SQL.includes(`(s ->> 'min')::int not between 1 and ${LANE.MAX_BLOCK_MIN}`) && SQL.includes(`jsonb_array_length(agenda) <= ${LANE.MAX_STEPS}`), "a day fits section P's run-of-show");
});

/* ── a plan: the exam 30 days from "today", three lectures ── */
const T0 = "2026-12-01";
const plus = (n: number) => dateOfDay(dayOfDate(T0) + n);
const plan = (o: Partial<GroupPlan> = {}): GroupPlan => ({
  id: "p",
  group_id: "g",
  title: "מבחן בלוק פתוגן-מאכסן",
  exam_date: plus(30),
  lecture_ids: ["a", "b", "c"],
  shared_from: plus(30 - LANE.SHARED_DAYS),
  leave_from: plus(30 - LANE.LEAVE_DAYS),
  shared_minutes: 180,
  leave_minutes: 600,
  rounds: 3,
  day_start: "09:00",
  slips: [],
  version: 1,
  created_by: "u1",
  updated_by: "u2",
  updated_at: "2026-11-30T10:00:00Z",
  ...o,
});
const facts: Record<string, LectureFact> = {
  a: { id: "a", title: "Amebiasis", parts: 4, slides: [[1, 3], [3, 7], [8, 12], [13, 18]], readers: 4, readByMe: true },
  b: { id: "b", title: "Leishmaniasis", parts: 3, slides: [[1, 5], [6, 10], [11, 18]], readers: 1, readByMe: false },
  c: { id: "c", title: "מלריה", parts: 5, readers: 6, readByMe: true },
};

test("G-2: the lane covers every study day, the shared pass reads every part once, study leave brings each lecture back rounds − 1 times", () => {
  const lane = buildLane(plan(), facts);
  assert.equal(lane.length, 21, "from 3 weeks out to the day before the exam");
  assert.deepEqual([lane[0].day, lane[20].day], [plus(9), plus(29)]);
  assert.deepEqual([lane[0].n, lane[0].total, lane[6].phase, lane[7].phase], [1, 21, "shared", "leave"]);
  // The shared pass: every part of every lecture read once, in the plan's order.
  const read = lane.filter((d) => d.phase === "shared").flatMap((d) => d.blocks.filter((b) => b.k === "read"));
  const parts = read.flatMap((b) => Array.from({ length: b.to! - b.from! + 1 }, (_, i) => `${b.l}${b.from! + i}`));
  assert.deepEqual(parts, ["a0", "a1", "a2", "a3", "b0", "b1", "b2", "c0", "c1", "c2", "c3", "c4"]);
  // Each read is followed by its 5-question quiz; each day opens with "פתיחה: 3 לקפה".
  for (const d of lane.filter((x) => x.blocks.length)) {
    assert.equal(d.blocks[0].k, "intro");
    assert.equal(d.blocks[0].title, "פתיחה: 3 לקפה");
    d.blocks.forEach((b, i) => b.k === "read" && assert.deepEqual([d.blocks[i + 1].k, d.blocks[i + 1].l, d.blocks[i + 1].n], ["quiz", b.l, LANE.QUIZ_N]));
    assert.ok(d.blocks.length <= LANE.MAX_STEPS && d.blocks.every((b) => b.min >= 1 && b.min <= LANE.MAX_BLOCK_MIN));
    assert.ok(marathonMinutes(d) >= 30 && marathonMinutes(d) <= LANE.MAX_DAY_MIN);
  }
  // Study leave: rounds 2 and 3 of every lecture, the second pass longer than the first (PL4).
  const leave = lane.filter((d) => d.phase === "leave");
  const at = (l: string, r: number) => leave.findIndex((d) => d.blocks.some((b) => b.k === "read" && b.l === l && b.title === `סבב ${r}`));
  for (const l of ["a", "b", "c"]) {
    assert.ok(at(l, 2) >= 0 && at(l, 3) > at(l, 2), `${l}: round 2 then round 3`);
  }
  assert.ok(at("a", 3) - at("a", 2) >= 3, "the gap grows towards the exam");
  for (const d of leave) {
    assert.ok(d.blocks.some((b) => b.k === "free" && b.title === "שחזורים"), "שחזורים every leave day");
    assert.ok(d.blocks.some((b) => b.k === "questions" && b.title === "מה שלא ישב טוב"));
  }
  // Four rounds: three passes.
  const four = buildLane(plan({ rounds: 4 }), facts).flatMap((d) => d.blocks.filter((b) => b.k === "read" && b.l === "a" && b.title));
  assert.deepEqual(four.map((b) => b.title), ["סבב 2", "סבב 3", "סבב 4"]);
  assert.deepEqual(sharedDays(lane), { a: plus(9), b: lane.find((d) => d.blocks.some((x) => x.l === "b"))!.day, c: lane.find((d) => d.blocks.some((x) => x.l === "c"))!.day });
});

test("PL6 and decision 3: a hot lecture (from 3 members) gets more minutes, one that sits well fewer; without data every part weighs the same", () => {
  const only = plan({ lecture_ids: ["a", "b"], shared_from: plus(29), leave_from: plus(30) });
  const mins = (meter: MeterRow[] | null) => {
    const d = buildLane(only, facts, meter)[0];
    return Object.fromEntries(d.blocks.filter((b) => b.k === "read").map((b) => [b.l, b.min]));
  };
  const even = mins(null);
  assert.ok(Math.abs(even.a / 4 - even.b / 3) <= 5, "the minutes follow the parts");
  const row = (l: string, bucket: MeterRow["bucket"]): MeterRow => ({ lecture_id: l, answers: 30, answers_short: 0, members_short: 0, bucket });
  const hot = mins([row("a", "ok"), row("b", "hot")]);
  assert.ok(hot.b > even.b && hot.a < even.a, "hot b gains, a that sits well gives");
});

test("PL5: a day that slipped moves its blocks to the next day, marked moved; the price makes days longer or drops one review day; nothing is late", () => {
  const p = plan();
  const lane = buildLane(p, facts);
  const d1 = lane[0];
  const saved = [{ plan_day: d1.day, agenda: d1.blocks, step: 1, state: "live" }];
  const missed = missedOf(saved, plus(10));
  assert.equal(missed.length, 1);
  assert.deepEqual(missed[0].blocks.map((b) => b.k), d1.blocks.slice(2).filter((b) => ["read", "quiz", "questions"].includes(b.k)).map((b) => b.k), "what was not reached");
  assert.deepEqual(missedOf([{ ...saved[0], state: "ended" }], plus(10)), [], "a day the group ended is done");
  assert.deepEqual(missedOf(saved, d1.day), [], "today is not over yet");
  const moved = buildLane(p, facts, null, missed);
  const next = moved[1];
  assert.equal(next.movedFrom, d1.day);
  assert.ok(next.blocks.some((b) => b.moved) && next.blocks[0].k === "intro");
  assert.equal(next.minutes, lane[1].minutes + missed[0].blocks.reduce((s, b) => s + b.min, 0), "before a price: the day is longer by what moved");
  assert.deepEqual(pendingSlip(p, missed)?.day, d1.day);
  // "עוד שעה ביום עד …"
  const prices = slipPrices(p, d1.day);
  assert.equal(prices.until, longerUntil(p, d1.day));
  assert.equal(prices.until, dateOfDay(dayOfDate(d1.day) + 1 + LANE.LONGER_DAYS));
  assert.match(prices.longer, /^עוד שעה ביום עד (ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)$/);
  assert.equal(prices.drop, "לוותר על יום חזרה אחד");
  const longer = buildLane({ ...p, slips: [{ day: d1.day, choice: "longer", until: prices.until }] }, facts, null, missed);
  assert.equal(pendingSlip({ slips: [{ day: d1.day, choice: "longer", until: prices.until }] }, missed), null, "priced");
  for (let i = 1; i <= 1 + LANE.LONGER_DAYS; i++) assert.equal(longer[i].minutes, lane[i].minutes + LANE.LONGER_MIN, `day ${i + 1}: an hour more`);
  assert.equal(longer[2 + LANE.LONGER_DAYS].minutes, lane[2 + LANE.LONGER_DAYS].minutes);
  const drop = buildLane({ ...p, slips: [{ day: d1.day, choice: "drop_review" }] }, facts, null, missed);
  const lastReview = [...lane].reverse().find((d) => d.phase === "leave" && d.blocks.some((b) => b.k === "read"))!;
  const dropped = drop.filter((d) => d.dropped);
  assert.deepEqual(dropped.map((d) => d.day), [lastReview.day], "one review day: the last one");
  assert.ok(!dropped[0].blocks.some((b) => b.k === "read") && dropped[0].blocks.some((b) => b.title === "שחזורים"), "it gives up its reviews, keeps שחזורים");
  // No word of lateness anywhere a row says.
  const words = moved.flatMap((d) => dayRows(d.blocks).map((r) => Object.values(blockRow(r.block, facts, r.next)).join(" ")));
  assert.ok(!words.some((w) => /מאחר|באיחור|פיגור/.test(w)));
});

test("plan.html s1's words: times, the next block's chip, read-and-quiz as one row, slides, the marathon's kilometres", () => {
  const blocks = buildLane(plan(), facts)[0].blocks;
  const times = blockTimes(blocks, "09:00");
  assert.equal(times[0], "09:00");
  assert.equal(times[1], "09:05");
  assert.deepEqual(nextBlock(blocks, "09:00", 8 * 60 + 40), { i: 0, chip: "בעוד 20 דק׳" });
  assert.deepEqual(nextBlock(blocks, "09:00", 9 * 60 + 2), { i: 0, chip: "עכשיו" });
  assert.equal(nextBlock(blocks, "09:00", 23 * 60), null);
  assert.equal(nextBlock(blocks, "09:00", 9 * 60 - LANE.SOON_MIN - 1), null, "further off than SOON_MIN: its time says when");
  const rows = dayRows(blocks);
  assert.equal(rows[1].block.k, "read");
  assert.equal(rows[1].next?.k, "quiz");
  const r = blockRow(rows[1].block, facts, rows[1].next);
  assert.equal(r.title, "Amebiasis");
  assert.ok(r.line.startsWith("הקראה ומבחן קבוצתי, 5 שאלות"), r.line);
  assert.equal(r.line.includes("בלוקים"), rows[1].block.min >= 1.5 * LANE.BLOCK_MIN, "a long read says its blocks");
  assert.deepEqual(r.slides, [1, facts.a.slides![rows[1].block.to!][1]]);
  assert.equal(blockRow({ k: "read", l: "a", from: 0, to: 1, min: 100 }, facts, { k: "quiz", l: "a", n: 5, min: 10 }, "12:40").line, "הקראה ומבחן קבוצתי, 5 שאלות · שני בלוקים, עד 12:40", "a long read is ≈50-minute blocks (PL2)");
  assert.equal(blockRow({ k: "read", l: "a", from: 0, to: 1, min: 160 }, facts).line, "הקראה · 3 בלוקים");
  assert.deepEqual(blockRow({ k: "read", l: "a", from: 0, to: 3, min: 50, title: "סבב 2" }, facts, { k: "quiz", l: "a", n: 5, min: 10 }).line, "סבב 2: חזרה ומבחן קבוצתי, 5 שאלות");
  const p = plan();
  assert.deepEqual([kmOn(p, p.shared_from), kmOn(p, p.leave_from), kmOn(p, p.exam_date), kmOn(p, plus(0))], [0, 21, 42, 0]);
  assert.deepEqual([phaseOn(p, plus(0)), phaseOn(p, plus(9)), phaseOn(p, plus(20)), phaseOn(p, plus(30)), phaseOn(p, plus(31))], ["before", "shared", "leave", "exam", "after"]);
  assert.equal(allRead([facts.a, facts.c], 6), true);
  assert.equal(allRead([facts.a, facts.b], 6), false, "b: 1 of 6 read");
  assert.deepEqual(planDays({ shared_from: plus(3), exam_date: plus(3) }), [], "a plan with no study day before the exam");
});

test("decision 3: the plan's meter, from the counts only", () => {
  const r = (answers_short: number, members_short: number): MeterRow => ({ lecture_id: "x", answers: 20 - answers_short, answers_short, members_short, bucket: answers_short || members_short ? null : "warm" });
  assert.deepEqual(planMeter([r(0, 0), r(12, 1), r(20, 3)]), {
    head: "התוכנית מדייקת ככל שמתרגלים: 1 מתוך 3 הרצאות עם נתונים",
    next: "עוד כ-12 תשובות ועוד אדם אחד להרצאה הבאה",
    have: 1,
    total: 3,
  });
  assert.equal(planMeter([r(0, 2), r(20, 3)]).next, "עוד 2 אנשים להרצאה הבאה");
  assert.equal(planMeter([r(5, 0)]).next, "עוד כ-5 תשובות להרצאה הבאה");
  assert.deepEqual(planMeter([r(0, 0)]), { head: "התוכנית מדייקת ככל שמתרגלים: 1 מתוך 1 הרצאות עם נתונים", next: "", have: 1, total: 1 });
  assert.equal(planMeter([]).head, "התוכנית מדייקת ככל שמתרגלים: 0 מתוך 0 הרצאות עם נתונים");
});

test("PL3: the private lane is the member's own: cards and mistakes, due rounds, a lecture the group read without her, her hot topics", () => {
  const p = plan();
  const lane = buildLane(p, facts);
  const today = plus(20);
  const rows = myLane({
    plan: p,
    today,
    facts,
    sharedDay: sharedDays(lane),
    relearning: [
      { lecture_id: "a", rounds: 1, key_total: 6, key_left: 4, last_day: plus(9), next_day: plus(10) },
      { lecture_id: "c", rounds: 3, key_total: 6, key_left: 0, last_day: plus(19), next_day: null },
      { lecture_id: "b", rounds: 0, key_total: 3, key_left: 3, last_day: null, next_day: null },
    ],
    cardsDue: 12,
    mistakes: 3,
    alone: [{ key: "k1", label: "מנגנוני התרופות במלריה", slides: [24] }],
    cardsRoute: { v: "cards", s: "today" },
    mistakesRoute: { v: "practice", s: "m" },
  });
  assert.deepEqual(
    rows.map((r) => [r.title, r.line]),
    [
      ["12 כרטיסים ו-3 טעויות פתוחות", "הטעויות שלך חוזרות בניסוח אחר"],
      ["Amebiasis · סבב 2", "4 שאלות מפתח עד סוף הסבב"],
      ["השלמה · Leishmaniasis", "הקבוצה כבר קראה. לקרוא בקצב שלך"],
      ["מנגנוני התרופות במלריה", "חלש אצלך, ולא אצל הקבוצה"],
    ],
  );
  assert.deepEqual(rows[1].route, { v: "practice", l: "a" });
  assert.deepEqual(rows[2].route, { v: "lecture", l: "b" });
  const nobody = myLane({ plan: p, today, facts: { ...facts, b: { ...facts.b, readers: 0 } }, sharedDay: sharedDays(lane), relearning: [], cardsDue: 0, mistakes: 0, alone: [], cardsRoute: null, mistakesRoute: null });
  assert.ok(!nobody.some((r) => r.key === "catchup:b"), "no catch-up for a lecture nobody read: \"הקבוצה כבר קראה\" would not be true");
  const off = myLane({ plan: p, today, facts, sharedDay: {}, relearning: [], cardsDue: 12, mistakes: 3, alone: [], cardsRoute: null, mistakesRoute: null });
  assert.deepEqual(off, [], "rows wait for their flags");
});

test("the exam-eve view: offered two days before the exam; the lecture's own summary slide; pinned, winners, then her own", () => {
  const p = plan();
  assert.deepEqual([eveOpen(p, plus(27)), eveOpen(p, plus(28)), eveOpen(p, plus(30)), eveOpen(p, plus(31))], [false, true, true, false]);
  const slides = [
    { n: 1, title: "Malaria", lines: [] },
    { n: 36, title: "סיכום ביניים", lines: ["א"] },
    { n: 37, title: "Summary: take-home", lines: ["G6PD לפני Primaquine"] },
    { n: 38, title: "Questions?", lines: [] },
  ];
  assert.equal(summarySlide(slides)?.n, 37);
  assert.equal(summarySlide([{ n: 1, title: "Life cycle", lines: [] }]), null, "none found: never invented");
  assert.equal(summarySlide([{ n: 4, title: "לסיכום", lines: [] }])?.n, 4);
  const aid = (id: string, o: Partial<{ pinned: boolean; on_cards: boolean; mine: boolean; flag: string | null }>) => ({ id, pinned: false, on_cards: false, mine: false, flag: null, ...o });
  assert.deepEqual(
    eveAids([aid("m", { mine: true }), aid("w", { on_cards: true }), aid("p", { pinned: true, mine: true }), aid("x", { pinned: true, flag: "inaccurate" })]).map((a) => a.id),
    ["p", "w", "m"],
  );
  assert.ok(Object.values(EVE_EMPTY).every((t) => t.length > 20), "each empty part says what fills it");
});

test("T-2's words: why the question came (hers alone), and the meter when nothing waits", () => {
  assert.equal(masteryWords(80), "4 מתוך 5");
  assert.equal(masteryWords(75), "3 מתוך 4");
  assert.equal(whyLine({ topic: "Miltefosine", right: 3, of: 3 }), "הגיעה אליך כי ענית נכון על 3 מתוך 3 שאלות על Miltefosine. גלוי רק לך.");
  assert.deepEqual(needsMeLines({ on: true, topics: 0, next: { topic: "Miltefosine", lecture_id: "l", short: 2 }, open: 1 }), {
    head: "עוד אין שאלה בשבילך",
    line: "שאלה פתוחה מגיעה למי שענו נכון על 4 מתוך 5 לפחות בנושא שלה (3 שאלות ומעלה). עוד כ-2 תשובות נכונות על Miltefosine לנושא הבא.",
  });
  assert.equal(needsMeLines({ on: true, topics: 1, next: null, open: 0 }).head, "נושא אחד שבו אפשר לעזור · אין עכשיו שאלה פתוחה בו");
  assert.equal(needsMeLines({ on: true, topics: 2, next: { topic: "X", lecture_id: "l", short: 1 }, open: 0 }).line.endsWith("עוד כ-1 תשובה נכונה על X לנושא הבא."), true);
});

test("a marathon of its own: an opening, each lecture read whole with its quiz, the reading fills the minutes", () => {
  const ag = marathonAgenda([facts.a, facts.b], 180);
  assert.deepEqual(ag.map((b) => b.k), ["intro", "read", "quiz", "break", "read", "quiz"]);
  assert.deepEqual([ag[1].from, ag[1].to, ag[4].to], [0, 3, 2]);
  const total = ag.reduce((s, b) => s + b.min, 0);
  assert.ok(Math.abs(total - 180) <= 10, `${total} ≈ 180`);
  assert.deepEqual(marathonAgenda([], 120), []);
});
