/* ── What a question tests, and why a question was flagged ──
 * Fixed lists, so weak points add up across lectures (design-questions §4.1;
 * design-me's ASPECT_HE is the same labels). Keys are what the database
 * stores (section Q's check constraints); labels are what the screens show
 * (the copy deck, §6.4 Q). No zod here: this file is in the browser bundle. */

export const ASPECTS = {
  mechanism: "מנגנון פעולה",
  uses: "שימושים",
  pk: "פרמקוקינטיקה",
  adverse: "תופעות לוואי",
  contra: "התוויות נגד וזהירות",
  interactions: "אינטראקציות",
  resistance: "עמידות",
  dosing: "מתן ומינון",
  classification: "סיווג ומורפולוגיה",
  epidemiology: "אפידמיולוגיה והעברה",
  lifecycle: "מחזור החיים",
  pathogenesis: "פתוגנזה",
  clinical: "תמונה קלינית",
  diagnosis: "אבחנה",
  treatment: "טיפול",
  prevention: "מניעה",
  anatomy: "אנטומיה",
  histology: "היסטולוגיה",
  physiology: "פיזיולוגיה",
  imaging: "הדמיה",
  other: "אחר",
} as const;
export type Aspect = keyof typeof ASPECTS;

/** The Hebrew label of an aspect (design-me's name for the same map). */
export const ASPECT_HE: Record<Aspect, string> = ASPECTS;

/** An aspect key as stored, or "other" for anything not on the list. */
export function aspectOf(key: string): Aspect {
  const k = key.trim().toLowerCase();
  return (Object.keys(ASPECTS) as Aspect[]).find((a) => a === k) ?? "other";
}

/** Why a member flagged a question → the flag sheet's label (P6). */
export const REASONS = {
  wrong_key: "התשובה המסומנת שגויה",
  two_answers: "יש יותר מתשובה נכונה אחת",
  not_in_slides: "השאלה לא מבוססת על השקפים",
  unclear: "השאלה לא ברורה",
  duplicate: "השאלה חוזרת על שאלה אחרת",
  other: "משהו אחר",
} as const;
export type FlagReason = keyof typeof REASONS;
