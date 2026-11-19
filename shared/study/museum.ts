/* ── The trap museum's rules and words, pure (package U, U-3; spec §12.5.U,
 * the fun design §2.3, mockup museum.html; Yoad's decisions 1 and 3 of 17
 * Nov 2026) ──
 *
 * The thresholds live in one place, shared/study/meters.ts (MUSEUM,
 * re-exported here): section U of supabase/study-schema.sql reads the same
 * numbers from its functions (study_private.pulse_floor(),
 * museum_retire_days(), museum_active_days(), museum_new_days()).
 * museum.test.ts and meters.test.ts read
 * them from the SQL file and fail when the two disagree. Nothing here
 * counts: the counts come from the night (study_museum_meter), and these
 * functions only choose the words. No React and no Supabase. */

import { MUSEUM } from "./meters";

export { MUSEUM };

/** study_museum(): one exhibit, open or retired. */
export type Exhibit = {
  trap_id: string;
  lecture_id: string;
  lecture_title: string;
  course: string;
  exhibit_no: number;
  state: ExhibitState;
  question_id: string;
  stem: string;
  claim: string;
  truth: string;
  takeaway: string;
  confused: string;
  slides: number[];
  plaque: { claim: string; line: string } | null;
  opened_at: string;
  card_id: string | null;
};
export type ExhibitState = "new" | "falling" | "hanging" | "retired";

/** The exhibit's chip (museum.html): the word is the chip, never colour alone. */
export const STATE_CHIP: Record<ExhibitState, { text: string; tone: string }> = {
  new: { text: "חדש", tone: "busy" },
  falling: { text: "עוד טועים בה", tone: "warn" },
  hanging: { text: "עדיין פתוחה", tone: "" },
  retired: { text: "נסגרה", tone: "ok" },
};

/** study_museum_meter() (decision 3). */
export type MuseumMeter =
  | { state: "off"; floor: number }
  | { state: "out"; floor: number }
  | { state: "waiting"; floor: number; join_days: number; join_days_left: number }
  | { state: "open"; floor: number; cutoff: string; group_need: number; exhibits: number; retired: number; soon: number; traps: number; need: number };

const count = (n: number, one: string, many: (n: number) => string) => (n === 1 ? one : many(n));

/** "2 טעויות נפוצות" · "טעות נפוצה אחת" · "עוד אין טעויות נפוצות". */
export function exhibitsWord(n: number): string {
  return n <= 0 ? "עוד אין טעויות נפוצות" : count(n, "טעות נפוצה אחת", (k) => `${k} טעויות נפוצות`);
}

/** How many more wrong "על בטוח" bets the closest candidate needs. */
export function betsNeedWord(need: number): string {
  return need <= 1 ? "עוד תשובה שגויה אחת ׳על בטוח׳ לטעות הנפוצה הבאה" : `עוד ${need} תשובות שגויות ׳על בטוח׳ לטעות הנפוצה הבאה`;
}

/** Decision 3's meter line: "2 טעויות נפוצות · עוד 4 תשובות שגויות ׳על בטוח׳ לטעות הנפוצה הבאה",
 *  or, when an exhibit was found and opens tomorrow, that instead of the bets. */
export function museumMeterLine(m: Extract<MuseumMeter, { state: "open" }>): string {
  const head = exhibitsWord(m.exhibits);
  if (m.soon > 0) return `${head} · ${count(m.soon, "טעות נפוצה חדשה נפתחת מחר", (k) => `${k} טעויות נפוצות חדשות נפתחות מחר`)}`;
  return `${head} · ${betsNeedWord(m.need)}`;
}

/** The bar beside the meter: how close the closest candidate is (0-100). */
export function meterPct(m: Extract<MuseumMeter, { state: "open" }>): number {
  if (m.soon > 0) return 100;
  const have = Math.max(0, MUSEUM.FLOOR - m.need);
  return Math.round((100 * have) / MUSEUM.FLOOR);
}

/** The group's bar below the floor: the counted members against MUSEUM.FLOOR,
 *  the number its line says (review UI-5: never a literal 3). */
export function groupNeedPct(need: number): number {
  const n = Math.max(0, Math.min(MUSEUM.FLOOR, need));
  return Math.round((100 * (MUSEUM.FLOOR - n)) / MUSEUM.FLOOR);
}

/** The group itself is below the floor (fewer than 3 counted members). */
export function museumGroupNeedLine(need: number): string {
  return need <= 1 ? `הטעויות הנפוצות נפתחות מ-${MUSEUM.FLOOR} מתרגלים: עוד אדם אחד וזה נפתח.` : `הטעויות הנפוצות נפתחות מ-${MUSEUM.FLOOR} מתרגלים: עוד ${need} אנשים וזה נפתח.`;
}

/** The empty museum: what makes an exhibit (never a dead end: the meter and practice beside it). */
export const EMPTY_LINE = `טעות נכנסת לכאן כש-${MUSEUM.FLOOR} מכם בוחרים ׳על בטוח׳ באותה תשובה שגויה. הרשימה מתעדכנת בלילה.`;
/** museum.html's sub line and footer. */
export const SUB_LINE = `רק טעויות ׳על בטוח׳ של לפחות ${MUSEUM.FLOOR} מכם`;
export const FOOT_LINE = "טעות חדשה מופיעה רק למחרת, כדי שאי אפשר יהיה לנחש מי.";
export const RETIRE_LINE = "נסגרו: כולם ענו נכון ביומיים שונים";

/** The exhibit's claim, as the plaque says it, or the trap option itself in quotes. */
export function claimOf(e: Pick<Exhibit, "plaque" | "claim">): string {
  return `׳${(e.plaque?.claim || e.claim).trim()}׳`;
}

/** The plaque's line: Claude's, when the op wrote one; else the museum's own,
 *  from the exhibit's first slide ("כמה מכם בחרו בזה ׳על בטוח׳ · שקף 27."). */
export function plaqueLine(e: Pick<Exhibit, "plaque" | "slides">): string {
  if (e.plaque?.line) return e.plaque.line;
  const s = e.slides[0];
  return s ? `כמה מכם בחרו בזה ׳על בטוח׳ · שקף ${s}.` : "כמה מכם בחרו בזה ׳על בטוח׳.";
}

/** The museum's title: one lecture's, or the exhibits' one course, else none. */
export function museumTitle(exhibits: readonly Pick<Exhibit, "course" | "lecture_title">[], lectureTitle?: string): string {
  if (lectureTitle) return lectureTitle;
  const courses = [...new Set(exhibits.map((e) => e.course.trim()).filter(Boolean))];
  return courses.length === 1 ? courses[0] : "";
}

/** The one chip on a trap card (C's review, Today; review F-11). */
export type TrapCardKind = { kind: "trap" | "museum"; exhibit_no: number | null };
export const TRAP_CHIP = "טעות נפוצה בקבוצה";
export function badgeText(k: TrapCardKind): { chip: string; tone: string; aside: string } {
  if (k.kind === "museum" && k.exhibit_no) return { chip: "טעות נפוצה · לחזרה", tone: "fun", aside: `טעות מס׳ ${k.exhibit_no}` };
  return { chip: TRAP_CHIP, tone: "group", aside: "" };
}
/** museum.html s2's "למה זה כאן?". */
export const VACCINE_WHY =
  "כמה מכם טעו בזה ׳על בטוח׳, אז הכרטיסייה מגיעה לכולם, גם אם לא טעית בזה. היא יוצאת מהחזרות כשכל הקבוצה עונה נכון ביומיים שונים.";

/** P-8's line, for the museum: an opted-out member reads no exhibit (reading is reciprocal, review SEC-8). */
export const OUT_LINE = "התשובות שלך לא נספרות, ולכן גם הטעויות הנפוצות לא מוצגות לך. אפשר לחזור לספירה ב׳שלי׳, והן יחזרו אחרי הספירה של הלילה.";
/** P-14 with its meter, for the museum (decision 1: a week in the group, no account). */
export function waitingLine(daysLeft: number): string {
  const when = daysLeft <= 1 ? "מחר" : daysLeft === 2 ? "בעוד יומיים" : `בעוד ${daysLeft} ימים`;
  return `הטעויות הנפוצות מוצגות למי שנספרים: שבוע בקבוצה, והספירה בלילה. הן ייפתחו לך ${when}.`;
}
