import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { POLICY } from "../../server/study/budget.js";
import { DAILY_TRAP_CHECKS } from "../../server/study/limits.js";
import { BLANK, blankMeter, trapMeter, TRAPS, type MyTrap } from "./extras.js";

/* Package E's numbers are one set (decision 3: thresholds in one place, with
 * a unit test): what the screens and meters say is what section E's SQL and
 * the server's POLICY enforce. The meters are read from real rows only. */

const ROOT = process.cwd();
const SQL = readFileSync(join(ROOT, "supabase", "study-schema.sql"), "utf8");
const E = SQL.slice(SQL.indexOf("-- ════ BEGIN SECTION E"), SQL.indexOf("-- ════ END SECTION E"));

test("the trap's numbers are section E's SQL and the server's POLICY", () => {
  assert.ok(E.length > 1000, "section E is in the file");
  assert.match(E, new RegExp(`interval '1 day'\\) >= ${TRAPS.DRAFTS_A_DAY}\\b`), "new drafts a day");
  assert.equal(POLICY.trap_check.daily, TRAPS.CHECKS_A_DAY, "paid checks a day");
  assert.equal(DAILY_TRAP_CHECKS, TRAPS.CHECKS_A_DAY);
  assert.match(E, new RegExp(`cardinality\\(coalesce\\(p_options, '\\{\\}'\\)\\) not between ${TRAPS.OPTIONS_MIN} and ${TRAPS.OPTIONS_MAX}`));
  assert.match(E, new RegExp(`not between ${TRAPS.QUESTION_MIN} and ${TRAPS.QUESTION_MAX} or btrim\\(p_question\\)`));
  assert.match(E, new RegExp(`not between 1 and ${TRAPS.OPTION_MAX}\\)`));
  assert.match(E, new RegExp(`cardinality\\(coalesce\\(p_slides, '\\{\\}'\\)\\) not between ${TRAPS.SLIDES_MIN} and ${TRAPS.SLIDES_MAX}`));
  assert.match(E, new RegExp(`char_length\\(vignette\\) <= ${TRAPS.VIGNETTE_MAX}\\)`));
  assert.match(E, new RegExp(`char_length\\(note\\) <= ${TRAPS.NOTE_MAX}\\)`));
});

test("the blank table's numbers: a header and 2-15 rows, 2-6 columns, cells of at most 80, chips of 8 short values", () => {
  assert.deepEqual(
    { ...BLANK },
    { MIN_BODY_ROWS: 2, MAX_BODY_ROWS: 15, MIN_COLS: 2, MAX_COLS: 6, MAX_CELL: 80, CHIP_VALUES: 8, CHIP_CHARS: 40 },
  );
  // The meter's SQL only reports shapes; the rule that reads them is shapeOk (blankTable.ts), never SQL.
  assert.match(E, /function public\.study_slide_tables\(p_group uuid\)/);
  assert.doesNotMatch(E.slice(E.indexOf("study_slide_tables")), /n_rows\s*>=|>= 3/, "no threshold in the SQL");
});

const day = 24 * 3600 * 1000;
const NOW = Date.parse("2026-11-17T20:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const t = (state: MyTrap["state"], ago: number, unmasked = false): MyTrap => ({ state, created_at: at(ago), unmasked });

test("trapMeter: nothing yet says what a trap does, not a lock", () => {
  assert.deepEqual(trapMeter([], NOW), {
    inBank: 0,
    named: 0,
    waiting: 0,
    toFix: 0,
    leftToday: 10,
    line: "",
    next: "שאלה שעוברת את הבדיקה נכנסת לבנק של כולם, בלי שם.",
  });
});

test("trapMeter: in the bank, named by a live quiz, waiting for one, to fix, and what is left today", () => {
  const one = trapMeter([t("ok", 3 * day)], NOW);
  assert.equal(one.line, "שאלה אחת שלך בבנק");
  assert.equal(one.next, "השם יופיע אחרי שתישאל במבחן קבוצתי.");
  const mixed = trapMeter([t("ok", 3 * day, true), t("ok", 2 * day), t("ok", 2 * day), t("rejected", 3600_000), t("draft", 7200_000)], NOW);
  assert.deepEqual([mixed.inBank, mixed.named, mixed.waiting, mixed.toFix, mixed.leftToday], [3, 1, 2, 1, 8]);
  assert.equal(mixed.line, "3 שאלות שלך בבנק · אחת כבר עם השם שלך · אחת מחכה לתיקון");
  assert.equal(mixed.next, "2 עוד מחכות למבחן קבוצתי, ואז יופיע השם. נשארו היום 8 שאלות חדשות.");
  const all = trapMeter([t("ok", 3 * day, true), t("ok", 4 * day, true)], NOW);
  assert.equal(all.line, "2 שאלות שלך בבנק · כולן כבר עם השם שלך");
  assert.equal(all.next, "", "nothing more to wait for, and nothing written today");
  const fix = trapMeter([t("rejected", 3 * day), t("rejected", 3 * day)], NOW);
  assert.equal(fix.line, "2 שאלות שלך מחכות לתיקון");
});

test("trapMeter: the day's ten new drafts, counted from her own rows of the last 24 hours", () => {
  const ten = Array.from({ length: 10 }, (_, i) => t("draft", i * 3600_000));
  assert.equal(trapMeter(ten, NOW).leftToday, 0);
  assert.equal(trapMeter(ten, NOW).next, "שאלה שעוברת את הבדיקה נכנסת לבנק של כולם, בלי שם. להיום נגמרו השאלות החדשות; מחר אפשר שוב.");
  assert.equal(trapMeter([...ten.slice(1), t("draft", day + 1)], NOW).leftToday, 1, "a draft older than a day no longer counts");
  assert.match(trapMeter(ten.slice(0, 9), NOW).next, /נשארו היום שאלה חדשה אחת\./);
});

test("blankMeter: tables here, else the empty state with what is needed and where the group's other tables are", () => {
  assert.deepEqual(blankMeter(3, { tables: 0, lectures: 0 }), { here: 3, empty: false, line: "3 טבלאות בשקפים של ההרצאה", next: "" });
  assert.deepEqual(blankMeter(1, { tables: 4, lectures: 2 }), { here: 1, empty: false, line: "טבלה אחת בשקפים של ההרצאה", next: "ב-2 הרצאות אחרות יש 4 טבלאות בשקפים." });
  const none = blankMeter(0, { tables: 1, lectures: 1 });
  assert.equal(none.empty, true);
  assert.equal(none.line, "בשקפים של ההרצאה הזו אין טבלה למילוי.");
  assert.equal(none.next, "טבלה ריקה נפתחת על טבלה בשקף עם 2 שורות לפחות מתחת לכותרת, ממצגת PowerPoint. בהרצאה אחרת יש טבלה אחת בשקפים.");
  assert.match(blankMeter(0, { tables: 0, lectures: 0 }).next, /עוד אין טבלה כזו גם בהרצאות האחרות\.$/);
});
