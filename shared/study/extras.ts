/* ── Package E's numbers and meters (spec §12.6.E; Yoad's decision 3 of 17 Nov 2026) ──
 *
 * Decision 3: the phase-3 extras open early, each with what there is, and a
 * meter of what more needs; a hard lock only where nothing at all can be
 * shown, and then an empty state with the meter, never a dead end. Every
 * threshold of package E is in shared/study/meters.ts with every other
 * meter's (TRAPS and BLANK, re-exported here; extras.test.ts checks each
 * against the SQL that enforces it and the server's POLICY), and every meter
 * is computed from real counts the screens read: the member's own drafts and
 * their questions (study_trap_drafts, study_questions), the lecture's slides,
 * and the group's tables by shape (study_slide_tables). Nothing is invented.
 *
 * What E shows the group is content, never a count of members: a passed
 * trap is a question in the bank, without its author until a live quiz
 * reveals it; a blank table is the slide's own table. So the floor of three
 * (§12.5.U) has nothing to count here: the trap meter is the author's own,
 * and the table meter counts tables, not people. */

import { BLANK, TRAPS } from "./meters";

export { BLANK, TRAPS };

const count = (n: number, one: string, many: string): string => (n === 1 ? one : `${n} ${many}`);

/* ── P11: the author's own meter ── */

/** One of the member's drafts, with whether its question has been unmasked. */
export type MyTrap = { state: "draft" | "ok" | "rejected"; created_at: string; unmasked: boolean };

export type TrapMeter = {
  inBank: number;
  named: number;
  waiting: number;
  toFix: number;
  leftToday: number;
  /** What there is ("2 שאלות שלך בבנק · אחת כבר עם השם שלך"), or "" for none. */
  line: string;
  /** What more needs ("השם יופיע אחרי שתישאל במבחן קבוצתי"), or "". */
  next: string;
};

/** The author's meter, from her own drafts (RLS: hers alone). `now` in ms. */
export function trapMeter(mine: readonly MyTrap[], now: number): TrapMeter {
  const ok = mine.filter((t) => t.state === "ok");
  const named = ok.filter((t) => t.unmasked).length;
  const waiting = ok.length - named;
  const toFix = mine.filter((t) => t.state === "rejected").length;
  const today = mine.filter((t) => now - Date.parse(t.created_at) < 24 * 3600 * 1000).length;
  const leftToday = Math.max(0, TRAPS.DRAFTS_A_DAY - today);
  const parts: string[] = [];
  if (ok.length) parts.push(`${count(ok.length, "שאלה אחת", "שאלות")} שלך בבנק`);
  if (named) parts.push(named === ok.length ? (named === 1 ? "כבר עם השם שלך" : "כולן כבר עם השם שלך") : named === 1 ? "אחת כבר עם השם שלך" : `${named} כבר עם השם שלך`);
  if (toFix && ok.length) parts.push(toFix === 1 ? "אחת מחכה לתיקון" : `${toFix} מחכות לתיקון`);
  else if (toFix) parts.push(toFix === 1 ? "שאלה אחת שלך מחכה לתיקון" : `${toFix} שאלות שלך מחכות לתיקון`);
  let next = "";
  if (!ok.length && !toFix) next = "שאלה שעוברת את הבדיקה נכנסת לבנק של כולם, בלי שם.";
  else if (waiting === 1) next = ok.length === 1 ? "השם יופיע אחרי שתישאל במבחן קבוצתי." : "אחת עוד מחכה למבחן קבוצתי, ואז יופיע השם.";
  else if (waiting > 1) next = `${waiting} עוד מחכות למבחן קבוצתי, ואז יופיע השם.`;
  if (leftToday < TRAPS.DRAFTS_A_DAY) next = [next, leftToday ? `נשארו היום ${count(leftToday, "שאלה חדשה אחת", "שאלות חדשות")}.` : "להיום נגמרו השאלות החדשות; מחר אפשר שוב."].filter(Boolean).join(" ");
  return { inBank: ok.length, named, waiting, toFix, leftToday, line: parts.join(" · "), next };
}

/* ── P10: the blank table's meter ── */

export type BlankMeter = {
  /** Fillable tables on this lecture's slides. */
  here: number;
  line: string;
  next: string;
  /** No table here: the empty state (never a dead end: `next` says where there are). */
  empty: boolean;
};

/** The lecture's fillable tables, and the tables on the group's other
 *  lectures (study_slide_tables, by shape: `others.tables` in
 *  `others.lectures` lectures). */
export function blankMeter(here: number, others: { tables: number; lectures: number }): BlankMeter {
  const need = `טבלה ריקה נפתחת על טבלה בשקף עם ${BLANK.MIN_BODY_ROWS} שורות לפחות מתחת לכותרת, ממצגת PowerPoint.`;
  const elsewhere = others.tables
    ? `ב${others.lectures === 1 ? "הרצאה אחרת" : `-${others.lectures} הרצאות אחרות`} יש ${count(others.tables, "טבלה אחת", "טבלאות")} בשקפים.`
    : "";
  if (here) return { here, empty: false, line: `${count(here, "טבלה אחת", "טבלאות")} בשקפים של ההרצאה`, next: elsewhere };
  return { here, empty: true, line: "בשקפים של ההרצאה הזו אין טבלה למילוי.", next: [need, elsewhere || "עוד אין טבלה כזו גם בהרצאות האחרות."].join(" ") };
}
