import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  ASPECT_MIN,
  aspectMeter,
  CALIBRATION_MIN,
  calibrationPick,
  DANGER_RIGHTS,
  DANGER_SECOND_DAYS,
  dueChip,
  dueToday,
  mistakesLine,
  more,
  progressLine,
  rangeText,
  READINESS_MIN,
  readinessMeter,
  readinessOrder,
  type CalibrationRow,
  type DangerRow,
  type ProgressCounts,
  type ReadinessRow,
} from "./progress.js";

/* PS-2 (§12.3.A): the labels, "עוד מעט תשובות"'s meter, calibration's scope;
 * and decision 3's rule that every threshold lives in one place: section P's
 * end uses exactly these numbers. */

const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
const pEnd = sql.slice(sql.indexOf("SECTION P, its end"), sql.indexOf("-- ════ END SECTION P ════"));
const fn = (name: string) => {
  const i = pEnd.indexOf(`create or replace function public.${name}(`);
  assert.ok(i >= 0, `${name} is in P's end`);
  return pEnd.slice(i, pEnd.indexOf("\n$$;", i));
};

test("the thresholds are the SQL's: one place for each number (decision 3)", () => {
  assert.equal(READINESS_MIN, 20);
  const ready = fn("study_my_readiness");
  assert.equal([...ready.matchAll(/w\.n >= (\d+)/g)].map((m) => Number(m[1])).join(","), `${READINESS_MIN},${READINESS_MIN}`, "a range from READINESS_MIN answers");
  assert.ok(ready.includes("interval '28 days'"));
  const cal = fn("study_my_calibration");
  assert.deepEqual([...cal.matchAll(/x\.n >= (\d+)/g)].map((m) => Number(m[1])), [CALIBRATION_MIN], "a percentage from CALIBRATION_MIN");
  const asp = fn("study_my_aspects");
  assert.deepEqual([...asp.matchAll(/count\(\*\) (?:<|>=) (\d+)/g)].map((m) => Number(m[1])), [ASPECT_MIN, ASPECT_MIN], "a bucket from ASPECT_MIN");
  const danger = fn("study_my_danger_list");
  assert.ok(danger.includes(`f.first_d + ${DANGER_SECOND_DAYS}`), "the second return after DANGER_SECOND_DAYS");
  assert.ok(danger.includes(`coalesce(f.rights, 0) < ${DANGER_RIGHTS}`), "out after DANGER_RIGHTS rights");
  assert.ok(danger.includes("hidden_at is null"), "a hidden question leaves the list (review F-6)");
});

const row = (heading: string, answers: number, lo: number | null, hi: number | null): ReadinessRow => ({ lecture_id: "l", part_idx: 0, heading, answers, right_n: 0, lo, hi });

test("readiness: ranged parts weakest first, then the ones nearest to a range; the meter counts what is missing", () => {
  const rows = [row("Amebiasis", 30, 70, 85), row("מלריה", 25, 40, 55), row("Leishmaniasis", 12, null, null), row("Giardia", 3, null, null)];
  assert.deepEqual(readinessOrder(rows).map((r) => r.heading), ["מלריה", "Amebiasis", "Leishmaniasis", "Giardia"]);
  assert.equal(rangeText(rows[0]), "70–85%");
  assert.equal(rangeText(rows[2]), "");
  assert.deepEqual(readinessMeter(rows), { heading: "Leishmaniasis", left: 8 });
  assert.equal(readinessMeter([row("x", 20, 50, 70)]), null, "no meter once every part has its range");
  assert.deepEqual(readinessMeter([row("x", 0, null, null)]), { heading: "x", left: READINESS_MIN });
  assert.equal(more(25, 20), 0);
  assert.equal(more(-3, 20), 20);
});

test("the danger list's chips: היום, מחר, עוד 3 ימים; what is due today", () => {
  assert.equal(dueChip("2026-11-15", "2026-11-15"), "היום");
  assert.equal(dueChip("2026-11-14", "2026-11-15"), "היום", "overdue is today");
  assert.equal(dueChip("2026-11-16", "2026-11-15"), "מחר");
  assert.equal(dueChip("2026-11-18", "2026-11-15"), "עוד 3 ימים");
  const d = (due_day: string): DangerRow => ({ question_id: due_day, lecture_id: null, wrong_at: "", chosen: "", right_text: "", slides: [], rights: 0, due_day, ask_id: due_day });
  assert.deepEqual(dueToday([d("2026-11-14"), d("2026-11-15"), d("2026-11-16")], "2026-11-15").map((x) => x.due_day), ["2026-11-14", "2026-11-15"]);
});

test("aspects: the meter names the aspect nearest to a bucket", () => {
  assert.deepEqual(aspectMeter([{ aspect: "mechanism", questions: 5, wrong_now: 3, bucket: "hot" }, { aspect: "pk", questions: 2, wrong_now: 0, bucket: null }, { aspect: "uses", questions: 3, wrong_now: 0, bucket: null }]), { aspect: "uses", left: 1 });
  assert.equal(aspectMeter([{ aspect: "mechanism", questions: 5, wrong_now: 3, bucket: "hot" }]), null);
});

test("calibration's scope: a part with its percentage, else a lecture, else overall, else how many more", () => {
  const c = (scope: CalibrationRow["scope"], sure: number, pct: number | null, part: number | null = null): CalibrationRow => ({ scope, lecture_id: scope === "all" ? null : "l", part_idx: part, sure, sure_right: 0, pct });
  assert.deepEqual(calibrationPick([c("part", 22, 71, 1), c("part", 30, 60, 2), c("lecture", 52, 65), c("all", 52, 65)]), { row: c("part", 30, 60, 2) });
  assert.deepEqual(calibrationPick([c("part", 12, null, 1), c("lecture", 25, 80), c("all", 25, 80)]), { row: c("lecture", 25, 80) });
  assert.deepEqual(calibrationPick([c("part", 12, null, 1), c("lecture", 12, null), c("all", 12, null)]), { left: CALIBRATION_MIN - 12 });
  assert.deepEqual(calibrationPick([]), { left: CALIBRATION_MIN });
});

test("\"שלי\"'s lines say what there is, from the counts", () => {
  const c = (o: Partial<ProgressCounts>): ProgressCounts => ({ answers: 0, parts: 0, parts_ranged: 0, sure: 0, sure_right: 0, danger: 0, danger_due: 0, mistakes: 0, rewordings_due: 0, again_due: 0, ...o });
  assert.equal(progressLine(null), "עוד אין תשובות. טווח מוכנות מופיע מ-20 תשובות לנושא.");
  assert.equal(progressLine(c({ answers: 1 })), "תשובה אחת ב-28 הימים האחרונים");
  assert.equal(progressLine(c({ answers: 34, danger: 3, danger_due: 1 })), "34 תשובות ב-28 הימים האחרונים · טעות ׳על בטוח׳ אחת להיום");
  assert.equal(progressLine(c({ answers: 34, danger: 3 })), "34 תשובות ב-28 הימים האחרונים · 3 טעויות ׳על בטוח׳");
  assert.equal(mistakesLine(c({})), "אין כרגע טעויות פתוחות.");
  assert.equal(mistakesLine(c({ mistakes: 1 })), "טעות פתוחה אחת");
  assert.equal(mistakesLine(c({ mistakes: 5, rewordings_due: 2 })), "5 טעויות פתוחות · 2 חוזרות היום בניסוח אחר");
  assert.equal(mistakesLine(c({ mistakes: 5, rewordings_due: 1 })), "5 טעויות פתוחות · אחת חוזרת היום בניסוח אחר");
});
