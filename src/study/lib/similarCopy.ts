import { priceText } from "../../../shared/study/examPrice";
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
  return Object.prototype.hasOwnProperty.call(SIMILAR_FAIL, code) ? SIMILAR_FAIL[code] : failText(code, "practice");
}

/* ── The screens' words (design §5.10, §5.11, §6; one term a concept: a
 *    "שאלה דומה" is a twin, the set is practice sets' "סט", the shelf is
 *    "סטים של הקבוצה"; "נבדקה" is the only label a twin has, D17) ── */

/** A price as the app's buttons say it ("כ-$0.47", never below 10 cents). */
const PRICE = priceText;
const many = (n: number, one: string, more: (n: number) => string) => (n === 1 ? one : more(n));

export const SIM = {
  /** After a wrong answer: the row that opens the sheet. */
  more: "עוד שאלות כמוה",
  rule: "אותו נושא ואותה רמה, מקרה חדש.",
  close: "סגירה",
  joined: "כבר מכינים שאלות כמו זו · יופיעו כאן בעוד כחצי דקה",
  max: "לשאלה הזאת יש כבר 6 שאלות דומות",
  stopped: "יצירת השאלות נעצרה. מה שכבר נוצר נשמר.",
  practiceNow: "לתרגל עכשיו",
  added: "השאלות הדומות נוספו לסבב, מיד אחרי השאלה הזאת.",
  /** The twin's peek (its source, read only). */
  peekHead: "השאלה המקורית",
  checked: "נבדקה",
  /** The whole sheet (end of a sheet's round, the review's "⋯"). */
  sheetHint: "הן יופיעו ב״סטים של הקבוצה״, לכל הקבוצה.",
  sheetToday: "היום כבר נוצרו שאלות דומות לדף הזה · לתרגל אותן",
  sheetAll: "לכל השאלות בדף כבר יש שאלות דומות.",
  sheetMaking: "יוצרים שאלות דומות לדף · זה לוקח כמה דקות, ואפשר לסגור.",
  sheetStarted: "מתחילים ליצור שאלות דומות לדף. הן יופיעו ב״סטים של הקבוצה״.",
  sheetSolve: "לפתור",
  menuLabel: "עוד פעולות לדף",
} as const;

/** "שאלות כמו שאלה 3א" (the sheet's head). */
export const simTitle = (label: string) => `שאלות כמו שאלה ${label}`;
/** "ליצור 2 כמוה · כ-$0.10" (one when only one more fits under the 6). */
export const simButton = (per: number, usd: number) => `${per === 1 ? "ליצור עוד אחת כמוה" : `ליצור ${per} כמוה`} · ${PRICE(usd)}`;
/** The twins it has already, free to practise. */
export const simHave = (n: number) => `${many(n, "שאלה דומה אחת", (k) => `${k} שאלות דומות`)} · לתרגל`;
/** While a run makes them (said once, not announced). */
export const simRunning = (n: number) => `${many(n, "יוצרים שאלה אחת ובודקים אותה…", (k) => `יוצרים ${k} שאלות ובודקים אותן…`)} · אפשר להמשיך לתרגל`;
/** D24: roots with a figure left out (the pages' links had run out). */
export const simFigs = (k: number) => `${many(k, "שאלה אחת עם איור דולגה", (n) => `${n} שאלות עם איור דולגו`)} (הקישורים לעמודים פגו)`;
/** A run's end, in one line (the polite live region's only line). */
export function simResult(r: { made: number; dropped: number; skipped_figs: number; charged_usd: number; status: string }): string {
  if (r.made === 0) {
    if (r.status === "stopped") return SIM.stopped;
    return `הפעם אף שאלה לא עברה בדיקה. אפשר לנסות שוב מחר. · עלה ${PRICE(r.charged_usd)}`;
  }
  const made = many(r.made, "נוצרה שאלה אחת", (k) => `נוצרו ${k}`);
  const dropped = r.dropped ? ` · ${many(r.dropped, "אחת לא עברה בדיקה", (k) => `${k} לא עברו בדיקה`)}` : "";
  const figs = r.skipped_figs ? ` · ${simFigs(r.skipped_figs)}` : "";
  return `${made}${dropped}${figs}`;
}
/** The twin's chip: "דומה לשאלה 3א בתרגיל 3 · נבדקה". */
export const twinOf = (label: string, title: string) => `דומה לשאלה ${label}${title ? ` ב${title}` : ""} · ${SIM.checked}`;
/** "שאלות דומות לכל הדף · כ-$0.50". */
export const sheetButton = (usd: number) => `שאלות דומות לכל הדף · ${PRICE(usd)}`;
/** Under it: one each, or the first 24 without one. */
export const sheetOne = (n: number, more: number) =>
  more > 0 ? "שאלה דומה ל-24 השאלות הראשונות שאין להן עדיין דומה. זה לוקח כמה דקות; אפשר לסגור." : `שאלה דומה אחת לכל שאלה (${n}). זה לוקח כמה דקות; אפשר לסגור.`;
/** A whole sheet's run that made some: to its set. */
export const sheetMade = (n: number) => `${many(n, "נוצרה שאלה דומה אחת", (k) => `נוצרו ${k} שאלות דומות`)} · ${SIM.sheetSolve}`;
