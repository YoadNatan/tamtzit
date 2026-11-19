import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BOSS, bossBar, bossMeterLine, bossOf, headChip, headsChip, headsNeedLine, lootDay, lootDays, lootTitle, momentText, studyDayIso } from "./boss.js";
import { PULSE } from "./pulse.js";

/* H's thresholds are one set of numbers: section H's SQL functions
 * (study_private.boss_min_heads() and the rest) and BOSS here. */

const SQL = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
const H = SQL.slice(SQL.indexOf("-- ════ BEGIN SECTION H"), SQL.indexOf("-- ════ END SECTION H ════"));
const sqlConst = (fn: string): number => {
  const m = new RegExp(`function study_private\\.${fn}\\(\\) returns int language sql immutable as \\$\\$ select (\\d+) \\$\\$`).exec(H);
  assert.ok(m, `section H defines study_private.${fn}()`);
  return Number(m[1]);
};

test("the thresholds: the app's constants are section H's (one place, read by both)", () => {
  assert.deepEqual(
    {
      MIN_HEADS: sqlConst("boss_min_heads"),
      MAX_HEADS: sqlConst("boss_max_heads"),
      HEAD_QUESTIONS: sqlConst("boss_head_questions"),
      PLAYERS: sqlConst("boss_players"),
      TRAP_HP: sqlConst("boss_trap_hp"),
      RELAPSES: sqlConst("boss_relapses"),
      HIT_PCT: sqlConst("boss_hit_pct"),
      LOOT_DAYS: sqlConst("boss_loot_days"),
    },
    { ...BOSS },
  );
  assert.equal(BOSS.PLAYERS, PULSE.FLOOR, "a battle's floor is the pulse's: 3");
  // The battle reads its numbers from those functions, never literals.
  const after = H.slice(H.indexOf("create or replace function public.study_quiz__after_reveal("), H.indexOf("create or replace function public.study_quiz__boss_state("));
  assert.ok(after.includes("study_private.boss_players()") && after.includes("study_private.boss_trap_hp()") && after.includes("study_private.boss_relapses()"));
  assert.ok(!/answered < 3|>= 20\b|< 2 and/.test(after), "no literal floor, trap or relapse in the hook");
  assert.ok(H.includes("insert into study_private.schema_sections (section, version) values ('H', 2)"), "section H registers H 2 (the mock's and route.test.ts's registry read this line)");
  // H 2 (review H-BATTLE-ROW-READ): members read a battle's plain facts only, never its heads, rounds or log.
  const grant = /grant select \(([^)]*)\)\s+on public\.study_boss_battles to authenticated;/.exec(H);
  assert.ok(grant, "a column grant on study_boss_battles");
  for (const col of ["heads", "rounds", "log"]) assert.ok(!grant[1].split(",").map((c) => c.trim()).includes(col), `members never read ${col}`);
  assert.ok(!/grant select on public\.study_boss_battles\b/.test(H), "no table-wide grant on the battles");
});

test("decision 3: the boss's meter, from the counts", () => {
  assert.equal(bossMeterLine({ hot: 3, topics: 8, answers_next: 20 }), "3 מתוך 8 נושאים חמים · עוד כ-20 תשובות לנושא הבא", "Yoad's approved example");
  assert.equal(bossMeterLine({ hot: 1, topics: 5, answers_next: 1 }), "1 מתוך 5 נושאים חמים · עוד תשובה אחת לנושא הבא");
  assert.equal(bossMeterLine({ hot: 4, topics: 4, answers_next: null }), "4 מתוך 4 נושאים חמים", "every topic weighed: no next");
  assert.equal(headsNeedLine(0), "הקרב נפתח משני נושאים חמים: עוד 2 נושאים.");
  assert.equal(headsNeedLine(1), "הקרב נפתח משני נושאים חמים: עוד נושא אחד.");
  assert.equal(headsNeedLine(2), "");
});

test("the meter's bar says what its line says (review UI-2)", () => {
  // Yoad's example: "3 מתוך 8 נושאים חמים" fills 3/8, and the bar's label is the line.
  const open = { hot: 3, topics: 8, answers_next: 20, group_need: 0 };
  assert.deepEqual(bossBar(open), { pct: 38, label: bossMeterLine(open) });
  for (const [hot, topics] of [[1, 8], [0, 5], [4, 4], [2, 3], [7, 12]]) {
    const o = { hot, topics, answers_next: null };
    const m = /^(\d+) מתוך (\d+) /.exec(bossMeterLine(o))!;
    assert.equal(bossBar(o).pct, Math.round((100 * Number(m[1])) / Number(m[2])), `${hot}/${topics}: the bar is the line's ratio`);
  }
  assert.equal(bossBar({ hot: 0, topics: 0, answers_next: null }).pct, 0, "nothing weighed yet: an empty bar, not NaN");
  // Below the floor the line is the group's need, and so is the bar (as the pulse's: 2 of 3 counted).
  const young = { hot: 0, topics: 0, answers_next: null, group_need: 1 };
  assert.deepEqual(bossBar(young), { pct: 67, label: `2 מתוך ${PULSE.FLOOR} נספרים` });
  assert.deepEqual(bossBar({ ...young, group_need: 2 }), { pct: 33, label: `1 מתוך ${PULSE.FLOOR} נספרים` });
});

test("the battle's words: heads, moments without names, the loot's days", () => {
  assert.equal(headChip({ head: 2, heads: [{}, {}, {}, {}] as never }), "ראש 3/4");
  assert.equal(headChip({ head: null, heads: [{}, {}] as never }), "2 ראשים");
  // The count reads as Hebrew counts do (review UI-4): no "0 ראשים", no "1 ראשים".
  assert.equal(headsChip(0), "");
  assert.equal(headsChip(1), "ראש אחד");
  assert.equal(headsChip(3), "3 ראשים");
  assert.equal(headChip({ head: null, heads: [{}] as never }), "ראש אחד");
  assert.deepEqual(momentText({ t: "trap", head: "Primaquine", hp: -20 }), { title: "המלכודת של Primaquine", chip: "−20 HP", tone: "bad", line: "עלתה לקבוצה 20 HP." });
  assert.equal(momentText({ t: "down", head: "Hypnozoite", relapses: 2 })?.line, "אחרי שחזר פעמיים.");
  assert.equal(momentText({ t: "down", head: "Hypnozoite", relapses: 0 })?.line, "בלי לחזור.");
  for (const t of ["trap", "relapse", "down", "last", "fall"] as const) {
    const m = momentText({ t, head: "X" });
    assert.ok(m && !/את |אתה |שלך/.test(m.title + m.line), `${t}: no one is addressed or named`);
  }
  assert.equal(lootDay(1), "מחר");
  assert.equal(lootDay(2), "מחרתיים");
  assert.equal(lootDay(3), "בעוד 3 ימים");
  assert.equal(lootTitle(4, 3), "השלל שלך: 4 טעויות, 3 ימים");
  assert.equal(lootTitle(1, 1), "השלל שלך: טעות אחת, יום אחד");
  const days = lootDays(
    [
      { question_id: "a", topic: "איזו תרופה על איזה שלב", question: "q", slides: [23], due_on: "2026-11-18" },
      { question_id: "b", topic: "איזו תרופה על איזה שלב", question: "q", slides: [23], due_on: "2026-11-18" },
      { question_id: "c", topic: "Primaquine", question: "q", slides: [37], due_on: "2026-11-20" },
    ],
    "2026-11-17",
  );
  assert.deepEqual(days.map((d) => [d.ahead, d.topics.map((t) => `${t.topic}×${t.n}`).join()]), [[1, "איזו תרופה על איזה שלב×2"], [3, "Primaquine×1"]]);
  assert.match(studyDayIso(Date.parse("2026-11-17T01:30:00Z")), /^2026-11-16$/, "03:30 in Jerusalem is still the day before");
  assert.match(studyDayIso(Date.parse("2026-11-17T03:00:00Z")), /^2026-11-17$/);
  assert.equal(bossOf({ boss: null }), null);
  assert.equal(bossOf({ boss: { heads: [] } })?.heads.length, 0);
});
