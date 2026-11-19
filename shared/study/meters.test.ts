import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import * as meters from "./meters.js";
import { ASPECT_MIN, BLANK, BOSS, CALIBRATION_MIN, DANGER_RIGHTS, DANGER_SECOND_DAYS, FLOOR, MUSEUM, NEEDS_ME, PLAN, PULSE, READINESS_MIN, TRAPS } from "./meters.js";
import { bossMeterLine, groupNeedLine as bossGroupNeedLine, PLAYERS_LINE, SUB_LINE as BOSS_SUB_LINE } from "./boss.js";
import { planMeter, type MeterRow } from "./lane.js";
import { EMPTY_LINE as MUSEUM_EMPTY_LINE, museumGroupNeedLine, museumMeterLine, SUB_LINE as MUSEUM_SUB_LINE } from "./museum.js";
import { EMPTY_LINE as PULSE_EMPTY_LINE, groupNeedLine as pulseGroupNeedLine, needLine } from "./pulse.js";

/* Yoad's decision 3 (17 Nov 2026): the extras open early with a meter of what
 * more is needed; the meters count real rows, and "the numbers' thresholds
 * are constants in one place with a unit test". That place is meters.ts; this
 * file holds it to the SQL that enforces the same numbers, to the privacy
 * floor of 3 different members, and to the meters Yoad approved. */

const root = process.cwd();
const SQL = readFileSync(join(root, "supabase", "study-schema.sql"), "utf8");

/** Every threshold function of the SQL's meters, and the constant it must equal. */
const SQL_THRESHOLDS: Record<string, number> = {
  pulse_floor: PULSE.FLOOR,
  pulse_join_days: PULSE.JOIN_DAYS,
  pulse_window_days: PULSE.WINDOW_DAYS,
  pulse_week_days: PULSE.WEEK_DAYS,
  pulse_forget_days: PULSE.FORGET_DAYS,
  museum_retire_days: MUSEUM.RETIRE_DAYS,
  museum_active_days: MUSEUM.ACTIVE_DAYS,
  museum_new_days: MUSEUM.NEW_DAYS,
  boss_min_heads: BOSS.MIN_HEADS,
  boss_max_heads: BOSS.MAX_HEADS,
  boss_head_questions: BOSS.HEAD_QUESTIONS,
  boss_players: BOSS.PLAYERS,
  boss_trap_hp: BOSS.TRAP_HP,
  boss_relapses: BOSS.RELAPSES,
  boss_hit_pct: BOSS.HIT_PCT,
  boss_loot_days: BOSS.LOOT_DAYS,
  plan_lecture_answers: PLAN.LECTURE_ANSWERS,
  plan_floor: PLAN.FLOOR,
  plan_window_days: PLAN.WINDOW_DAYS,
  plan_hot_below: PLAN.HOT_BELOW,
  plan_ok_from: PLAN.OK_FROM,
  needs_me_min_answers: NEEDS_ME.MIN_ANSWERS,
  needs_me_master_pct: NEEDS_ME.MASTER_PCT,
  needs_me_window_days: NEEDS_ME.WINDOW_DAYS,
  needs_me_wait_hours: NEEDS_ME.WAIT_HOURS,
};

const fnBody = (name: string): string => {
  const at = SQL.indexOf(`create or replace function ${name}(`);
  assert.ok(at >= 0, `the SQL defines ${name}`);
  const end = SQL.indexOf("\n$$;", at);
  return SQL.slice(at, end);
};

test("the privacy floor is one number, 3, and every group-level floor is it", () => {
  assert.equal(FLOOR, 3, "decision 3 and §12.5.U: 3 different members");
  assert.equal(PULSE.FLOOR, FLOOR, "the pulse and its hot spots");
  assert.equal(MUSEUM.FLOOR, FLOOR, "traps and the museum's exhibits");
  assert.equal(BOSS.PLAYERS, FLOOR, "the boss's players and a round's answers");
  assert.equal(PLAN.FLOOR, FLOOR, "the plan's lecture buckets");
});

test("every meter threshold of the SQL is a constant here, with the same value", () => {
  const found = new Map<string, number>();
  const re = /create or replace function study_private\.((?:pulse|museum|boss|plan|needs_me)_[a-z_]+)\(\) returns int language sql immutable as \$\$ select (\d+) \$\$/g;
  for (const m of SQL.matchAll(re)) found.set(m[1], Number(m[2]));
  assert.deepEqual([...found.keys()].sort(), Object.keys(SQL_THRESHOLDS).sort(), "the SQL's thresholds and meters.ts name the same set");
  for (const [fn, want] of Object.entries(SQL_THRESHOLDS)) assert.equal(found.get(fn), want, `study_private.${fn}() = meters.ts`);
  // E: the drafts a day are enforced by study_trap_submit itself.
  assert.ok(fnBody("public.study_trap_submit").includes(`>= ${TRAPS.DRAFTS_A_DAY}`), "study_trap_submit: TRAPS.DRAFTS_A_DAY a rolling day");
});

test("the SQL's group-level numbers take their floor from its function, never a literal", () => {
  const plan = fnBody("public.study_group_plan_meter");
  assert.ok(plan.includes("fl int := study_private.plan_floor();"), "the plan meter's floor");
  assert.ok(plan.includes("coalesce(c.people, 0) < fl then null"), "a lecture's bucket only from the floor (below it: only the meter)");
  const boss = fnBody("public.study_boss_open");
  assert.ok(boss.includes("fl    int := study_private.pulse_floor();"), "the boss's heads and meter");
  assert.ok(boss.includes("if m ->> 'state' <> 'open' then"), "no heads while the group is below the floor (the pulse's meter instead)");
  const museum = fnBody("public.study_museum_meter");
  assert.ok(museum.includes("public.study_pulse_meter(p_group)") && museum.includes("if m ->> 'state' <> 'open' then return"), "no exhibits counted while the group is below the floor");
  for (const [name, body] of [["study_group_plan_meter", plan], ["study_boss_open", boss], ["study_museum_meter", museum]] as const) {
    assert.ok(!/(people|members|n_people)\)?\s*(<|>=)\s*3\b/.test(body), `${name}: no literal 3 for the floor`);
  }
});

test("the thresholds are defined here only: no other module keeps a copy", () => {
  const names = Object.keys(meters);
  assert.deepEqual(
    names.sort(),
    ["ASPECT_MIN", "BLANK", "BOSS", "CALIBRATION_MIN", "DANGER_RIGHTS", "DANGER_SECOND_DAYS", "FLOOR", "MUSEUM", "NEEDS_ME", "PLAN", "PULSE", "READINESS_MIN", "TRAPS"],
  );
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== "meters.ts") files.push(p);
    }
  };
  for (const d of ["shared/study", "src/study", "server/study"]) walk(join(root, d));
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    // A table of numbers or a number under a meter's name (server/study/questions.ts's cloze BLANK, "___", is another thing).
    for (const n of names) assert.ok(!new RegExp(`\\bconst ${n}\\s*(?::[^=]+)?=\\s*[{\\d]`).test(s), `${relative(root, f)} defines ${n} again`);
    assert.ok(!/\bFLOOR\s*:\s*\d/.test(s), `${relative(root, f)} keeps a floor of its own`);
    // A bar or a count against the floor takes it from here, never a literal 3 (review UI-5).
    assert.ok(!/\(\s*3\s*-\s*[\w.?]*(group_need|need)\b|(group_need|need)\)?\s*\)?\s*\/\s*3\b/.test(s), `${relative(root, f)} counts against a literal floor`);
  }
});

test("the meters Yoad approved, from real counts", () => {
  assert.equal(bossMeterLine({ hot: 3, topics: 8, answers_next: 20 }), "3 מתוך 8 נושאים קשים · עוד כ-20 תשובות לנושא הבא");
  assert.equal(
    museumMeterLine({ state: "open", floor: FLOOR, cutoff: "2026-11-17", group_need: 0, exhibits: 2, retired: 0, soon: 0, traps: 2, need: 4 }),
    "2 טעויות נפוצות · עוד 4 תשובות שגויות ׳על בטוח׳ לטעות הנפוצה הבאה",
  );
  const row = (i: number, ready: boolean): MeterRow => ({
    lecture_id: `l${i}`,
    answers: ready ? PLAN.LECTURE_ANSWERS : 5,
    answers_short: ready ? 0 : PLAN.LECTURE_ANSWERS - 5,
    members_short: ready ? 0 : 1,
    bucket: ready ? "warm" : null,
  });
  const rows = Array.from({ length: 30 }, (_, i) => row(i, i < 12));
  assert.equal(planMeter(rows).head, "התוכנית מדייקת ככל שמתרגלים: 12 מתוך 30 הרצאות עם נתונים");
});

test("below the floor the meter says how many more people, in the floor's own number", () => {
  assert.equal(needLine(1), "עוד אדם אחד וזה נפתח");
  assert.equal(needLine(2), "עוד 2 אנשים וזה נפתח");
  for (const line of [pulseGroupNeedLine, bossGroupNeedLine, museumGroupNeedLine]) {
    assert.ok(line(1).includes(`מ-${FLOOR} מתרגלים`) && line(1).includes("עוד אדם אחד וזה נפתח"), line(1));
    assert.ok(line(2).includes("עוד 2 אנשים וזה נפתח"), line(2));
  }
  for (const line of [PULSE_EMPTY_LINE, BOSS_SUB_LINE, MUSEUM_EMPTY_LINE, MUSEUM_SUB_LINE]) assert.ok(line.includes(`${FLOOR} מכם`), line);
  assert.ok(PLAYERS_LINE.includes(`לפחות ${FLOOR} משתתפים`));
  // A lecture with enough answers but fewer than FLOOR people is not "with data": only its meter shows.
  const short: MeterRow = { lecture_id: "x", answers: 40, answers_short: 0, members_short: 1, bucket: null };
  const m = planMeter([short]);
  assert.equal(m.have, 0);
  assert.equal(m.next, "עוד אדם אחד להרצאה הבאה");
});

test("A2's and E's meters count the member's own rows against these numbers", () => {
  assert.deepEqual({ READINESS_MIN, CALIBRATION_MIN, ASPECT_MIN, DANGER_SECOND_DAYS, DANGER_RIGHTS }, { READINESS_MIN: 20, CALIBRATION_MIN: 20, ASPECT_MIN: 4, DANGER_SECOND_DAYS: 3, DANGER_RIGHTS: 2 });
  assert.ok(BLANK.MIN_BODY_ROWS <= BLANK.MAX_BODY_ROWS && BLANK.MIN_COLS <= BLANK.MAX_COLS);
  assert.ok(TRAPS.OPTIONS_MIN <= TRAPS.OPTIONS_MAX && TRAPS.SLIDES_MIN <= TRAPS.SLIDES_MAX);
});
