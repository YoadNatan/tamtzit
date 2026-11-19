import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { badgeText, betsNeedWord, claimOf, exhibitsWord, groupNeedPct, meterPct, MUSEUM, museumGroupNeedLine, museumMeterLine, museumTitle, plaqueLine, STATE_CHIP } from "./museum.js";
import { PULSE } from "./pulse.js";

/* U-3's thresholds are one set of numbers: section U's SQL functions
 * (study_private.museum_retire_days() and the rest, with pulse_floor()) and
 * MUSEUM here. The meter's words (decision 3 of 17 Nov 2026) come only from
 * the database's counts. */

const SQL = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
const sqlConst = (fn: string): number => {
  const m = new RegExp(`function study_private\\.${fn}\\(\\) returns int language sql immutable as \\$\\$ select (\\d+) \\$\\$`).exec(SQL);
  assert.ok(m, `section U defines study_private.${fn}()`);
  return Number(m[1]);
};

test("the thresholds: the app's constants are section U's (one place, read by both)", () => {
  assert.deepEqual(
    { FLOOR: sqlConst("pulse_floor"), RETIRE_DAYS: sqlConst("museum_retire_days"), ACTIVE_DAYS: sqlConst("museum_active_days"), NEW_DAYS: sqlConst("museum_new_days") },
    { ...MUSEUM },
  );
  assert.equal(MUSEUM.FLOOR, PULSE.FLOOR, "the museum's floor is the pulse's: 3 different members");
  // The night's trap hook reads its numbers from those functions, never literals.
  const hook = SQL.slice(SQL.indexOf("create or replace function study_private.pulse_night__traps(p_group uuid, p_cut timestamptz)\nreturns jsonb language plpgsql"), SQL.indexOf("create or replace function public.study_museum(p_group uuid"));
  assert.ok(hook.length > 1000, "U-3 replaces the night's hook");
  assert.ok(hook.includes("fl   int := study_private.pulse_floor();"), "the hook takes its floor from pulse_floor()");
  assert.ok(hook.includes("study_private.museum_retire_days()") && hook.includes("study_private.museum_active_days()"), "retirement reads its functions");
  assert.ok(!/>= 3\b|< 3\b/.test(hook), "no literal 3 in the hook");
  assert.ok(SQL.includes("insert into study_private.schema_sections (section, version) values ('U', 2)"), "U-3 registers section U at 2");
});

test("decision 3: the museum's meter, from the counts", () => {
  const m = (o: Partial<{ exhibits: number; soon: number; need: number; retired: number }>) =>
    ({ state: "open", floor: 3, cutoff: "c", group_need: 0, exhibits: 0, retired: 0, soon: 0, traps: 0, need: 3, ...o }) as const;
  assert.equal(museumMeterLine(m({ exhibits: 2, need: 1 })), "2 מוצגים · עוד הימור ׳על בטוח׳ שגוי אחד למוצג הבא");
  assert.equal(museumMeterLine(m({ exhibits: 2, need: 2 })), "2 מוצגים · עוד 2 הימורי ׳על בטוח׳ שגויים למוצג הבא");
  assert.equal(museumMeterLine(m({ exhibits: 1, need: 3 })), "מוצג אחד · עוד 3 הימורי ׳על בטוח׳ שגויים למוצג הבא");
  assert.equal(museumMeterLine(m({ exhibits: 0, need: 3 })), "אין עדיין מוצגים · עוד 3 הימורי ׳על בטוח׳ שגויים למוצג הבא");
  assert.equal(museumMeterLine(m({ exhibits: 2, soon: 1, need: 2 })), "2 מוצגים · מוצג חדש נפתח מחר", "found tonight: it opens tomorrow, never today (so nobody can guess who)");
  assert.equal(museumMeterLine(m({ exhibits: 0, soon: 2 })), "אין עדיין מוצגים · 2 מוצגים חדשים נפתחים מחר");
  assert.equal(meterPct(m({ need: 3 })), 0);
  assert.equal(meterPct(m({ need: 1 })), 67);
  assert.equal(meterPct(m({ soon: 1 })), 100);
  assert.equal(museumGroupNeedLine(1), "המוזיאון נפתח מ-3 מתרגלים: עוד אדם אחד וזה נפתח.");
  assert.equal(museumGroupNeedLine(2), "המוזיאון נפתח מ-3 מתרגלים: עוד 2 אנשים וזה נפתח.");
  assert.equal(exhibitsWord(1), "מוצג אחד");
  assert.equal(betsNeedWord(0), "עוד הימור ׳על בטוח׳ שגוי אחד למוצג הבא", "never zero: a candidate at the floor is an exhibit already");
});

test("an exhibit's words: the plaque when the op wrote one, the exhibit's own text otherwise", () => {
  assert.equal(claimOf({ plaque: null, claim: " מניעת מלריה " }), "׳מניעת מלריה׳");
  assert.equal(claimOf({ plaque: { claim: "Quinine משמשת למניעת מלריה", line: "x" }, claim: "מניעת מלריה" }), "׳Quinine משמשת למניעת מלריה׳");
  assert.equal(plaqueLine({ plaque: null, slides: [27, 33] }), "אמנים: כמה מכם. חומרים: ביטחון עצמי, שקף 27.");
  assert.equal(plaqueLine({ plaque: null, slides: [] }), "אמנים: כמה מכם. חומרים: ביטחון עצמי.");
  assert.equal(plaqueLine({ plaque: { claim: "c", line: "שלט" }, slides: [1] }), "שלט");
  assert.equal(museumTitle([{ course: "Anti parasite", lecture_title: "a" }, { course: "Anti parasite ", lecture_title: "b" }]), "Anti parasite");
  assert.equal(museumTitle([{ course: "A", lecture_title: "a" }, { course: "B", lecture_title: "b" }]), "");
  assert.equal(museumTitle([], "Malaria"), "Malaria");
  assert.deepEqual(Object.values(STATE_CHIP).map((c) => c.text), ["חדש", "עוד נופלים", "עדיין תלוי", "בפנסיה"], "museum.html's four words");
});

test("the one chip on a trap card (review F-11)", () => {
  assert.deepEqual(badgeText({ kind: "trap", exhibit_no: null }), { chip: "מלכודת של הקבוצה", tone: "group", aside: "" });
  assert.deepEqual(badgeText({ kind: "museum", exhibit_no: 3 }), { chip: "חיסון · ממוזיאון המלכודות", tone: "fun", aside: "מוצג מס׳ 3" });
});

test("below the floor the bar counts against the floor itself, as its line does (review UI-5)", () => {
  assert.equal(groupNeedPct(1), Math.round((100 * (MUSEUM.FLOOR - 1)) / MUSEUM.FLOOR));
  assert.equal(groupNeedPct(MUSEUM.FLOOR), 0);
  assert.equal(groupNeedPct(0), 100);
  assert.match(museumGroupNeedLine(1), new RegExp(`מ-${MUSEUM.FLOOR} מתרגלים`));
});
