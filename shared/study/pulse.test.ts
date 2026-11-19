import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  briefHead,
  groupNeedLine,
  lectureLine,
  lectureMeterLine,
  mergePulse,
  needLine,
  PULSE,
  pulseLabel,
  sections,
  waitingLine,
  type MyRow,
  type PulseRow,
} from "./pulse.js";

/* The pulse's thresholds are one set of numbers: section U's SQL functions
 * (study_private.pulse_floor() and the rest) and PULSE here. The words of the
 * meter (decision 3 of 17 Nov 2026) come only from the database's counts. */

const SQL = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
const sqlConst = (fn: string): number => {
  const m = new RegExp(`function study_private\\.${fn}\\(\\) returns int language sql immutable as \\$\\$ select (\\d+) \\$\\$`).exec(SQL);
  assert.ok(m, `section U defines study_private.${fn}()`);
  return Number(m[1]);
};

test("the thresholds: the app's constants are section U's (one place, read by both)", () => {
  assert.deepEqual(
    { FLOOR: sqlConst("pulse_floor"), JOIN_DAYS: sqlConst("pulse_join_days"), WINDOW_DAYS: sqlConst("pulse_window_days"), WEEK_DAYS: sqlConst("pulse_week_days"), FORGET_DAYS: sqlConst("pulse_forget_days") },
    { ...PULSE },
  );
  assert.equal(PULSE.FLOOR, 3, "the privacy floor of the addendum and decision 3: 3 different members");
  // The night reads the floor from its function, never a literal (so the two cannot drift apart).
  const night = SQL.slice(SQL.indexOf("create or replace function study_private.pulse_night("), SQL.indexOf("create or replace function public.study_pulse_ready("));
  assert.ok(night.includes("fl     int  := study_private.pulse_floor();"), "the night takes its floor from pulse_floor()");
  assert.ok(!/>= 3\b/.test(night), "no literal 3 for the floor in the night");
});

test("decision 3: the meter's words, from the counts", () => {
  assert.equal(needLine(1), "עוד אדם אחד וזה נפתח");
  assert.equal(needLine(2), "עוד 2 אנשים וזה נפתח");
  assert.equal(lectureMeterLine({ lecture_id: "l", open: 0, waiting: 2, need: 1 }), "עוד אדם אחד וזה נפתח");
  assert.equal(lectureMeterLine({ lecture_id: "l", open: 5, waiting: 1, need: 1 }), "5 מתוך 6 נושאים פתוחים · עוד אדם אחד לנושא הבא");
  assert.equal(lectureMeterLine({ lecture_id: "l", open: 2, waiting: 3, need: 2 }), "2 מתוך 5 נושאים פתוחים · עוד 2 אנשים לנושא הבא");
  assert.equal(lectureMeterLine({ lecture_id: "l", open: 4, waiting: 0, need: null }), "", "nothing waits: no meter");
  assert.equal(lectureMeterLine(undefined), "");
  assert.equal(groupNeedLine(1), "הדופק נפתח מ-3 מתרגלים: עוד אדם אחד וזה נפתח.");
  assert.equal(groupNeedLine(3), "הדופק נפתח מ-3 מתרגלים: עוד 3 אנשים וזה נפתח.");
  assert.match(waitingLine(1), /הדופק ייפתח לך מחר\.$/);
  assert.match(waitingLine(2), /בעוד יומיים\.$/);
  assert.match(waitingLine(5), /בעוד 5 ימים\.$/);
  assert.ok(!/חשבון/.test(waitingLine(5)), "decision 1: no saved account in P-14");
});

const row = (topic: string, aspect: string, bucket: PulseRow["bucket"], closed = false): PulseRow => ({
  lecture_id: "L",
  topic_key: topic.toLowerCase(),
  topic,
  aspect,
  bucket,
  slides: [16],
  closed_week: closed,
  cutoff: "2026-11-17T02:00:00Z",
});

test("P-3 … P-6: the group's rows with the member's own, one closed hole at most", () => {
  const group = [row("Miltefosine", "contra", "hot"), row("Metronidazole", "interactions", "warm"), row("Luminal", "classification", "cool", true), row("Paromomycin", "uses", "cool", true)];
  const mine: MyRow[] = [
    { lecture_id: "L", topic_key: "metronidazole", aspect: "interactions", items: 2, wrong: 2, mine: "hot", topic: "Metronidazole" },
    { lecture_id: "L", topic_key: "miltefosine", aspect: "contra", items: 2, wrong: 0, mine: "cool", topic: "Miltefosine" },
  ];
  const m = mergePulse(group, mine);
  assert.deepEqual(
    m.map((r) => [r.topic, r.mine ?? "-", r.alone, r.closedNote]),
    [
      ["Miltefosine", "cool", false, false],
      ["Metronidazole", "hot", true, false],
      ["Luminal", "-", false, true],
      ["Paromomycin", "-", false, false],
    ],
  );
  assert.deepEqual(sections(m).map((s) => [s.bucket, s.rows.length]), [["hot", 1], ["warm", 1], ["cool", 2]]);
  assert.deepEqual(sections([row("A", "uses", "cool")]).map((s) => s.bucket), ["cool"], "only non-empty sections");
  assert.equal(lectureLine(group), "נקודות חמות: Miltefosine");
  assert.equal(lectureLine([row("A", "uses", "cool")]), "הכול יושב טוב");
  assert.equal(pulseLabel("Primaquine", "contra"), "Primaquine · התוויות נגד וזהירות");
  assert.equal(pulseLabel("Primaquine", "other"), "Primaquine");
});

test("P-7: tomorrow's meeting, or the next one", () => {
  assert.equal(briefHead("2026-11-18", "2026-11-17"), "מחר בפגישה:");
  assert.equal(briefHead("2026-11-20", "2026-11-17"), "בפגישה הבאה:");
  assert.equal(briefHead("2026-11-17", "2026-11-17"), "בפגישה הבאה:");
  assert.equal(briefHead(null, "2026-11-17"), "בפגישה הבאה:");
});
