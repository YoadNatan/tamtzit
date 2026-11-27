import { failText } from "./failText";

/* ── Similar questions' refusals in words (SQL section O 3, op "similar";
 *    docs/study/sheets.md, design-exams §6) ──
 *
 * What study_similar_plan, study_similar_begin and the op "similar" can
 * refuse with, worded for the screens that offer similar questions (the
 * client's package, O11: after a wrong answer and at the end of a sheet).
 * A lazy module, as practice sets' setsCopy.ts: nothing in the entry chunk
 * imports it, so its words cost the entry nothing. Every budget refusal
 * reads as the one line of design §6 (err.budget). Impersonal and
 * gender-neutral throughout. */

export const SIMILAR_FAIL: Readonly<Record<string, string>> = {
  off: "שאלות דומות עוד לא פתוחות בקבוצה.",
  "not eligible": "לשאלה הזאת אי אפשר ליצור שאלות דומות: היא פתוחה, או שאין לה עדיין תשובה בדוקה.",
  max: "לשאלה הזאת יש כבר 6 שאלות דומות.",
  today: "היום כבר נוצרו שאלות דומות לדף הזה · לתרגל אותן",
  "nothing to make": "לכל השאלות בדף כבר יש שאלות דומות.",
  similar_cap: "התקציב לשאלות דומות נגמר החודש. מתחדש ב-1 בחודש.",
  budget: "התקציב לשאלות דומות נגמר החודש. מתחדש ב-1 בחודש.",
  reserve: "התקציב לשאלות דומות נגמר החודש. מתחדש ב-1 בחודש.",
  member_share: "התקציב לשאלות דומות נגמר החודש. מתחדש ב-1 בחודש.",
  daily_limit: "היום כבר נוצרו הרבה שאלות דומות. אפשר שוב מחר.",
  "exam not found": "הדף הזה נמחק או לא נמצא.",
  "question not found": "השאלה הזאת כבר לא בדף.",
  // the op's and the worker's own checks: a screen that sends them is a bug, so one plain line
  "bad reserve": "משהו השתבש בדרך. אפשר לנסות שוב.",
  "bad twins": "משהו השתבש בדרך. אפשר לנסות שוב.",
  "bad scope": "משהו השתבש בדרך. אפשר לנסות שוב.",
};

/** The codes worded here (failText.test.ts counts them as having words). */
export const SIMILAR_FAIL_CODES: readonly string[] = Object.keys(SIMILAR_FAIL);

/** A refusal of similar questions in words; anything else as practice words it. */
export function similarFail(code: string): string {
  return Object.hasOwn(SIMILAR_FAIL, code) ? SIMILAR_FAIL[code] : failText(code, "practice");
}
