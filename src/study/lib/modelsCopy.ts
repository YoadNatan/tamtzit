import { failText } from "./failText";

/* ── "השוואת מודלים": its refusals in words (SQL section Y, design-models
 *    §6.2, §8.2; docs/study/models.md) ──
 *
 * What section Y's functions can refuse with, worded for the screens of the
 * models package (the owner's tabs, a run, the blind rating). A lazy module,
 * as similarCopy.ts: nothing in the entry chunk imports it, so its words
 * cost the entry nothing (failText.ts gains no static text). Codes failText
 * words already (off is the package's own line here; not the creator,
 * forbidden, budget, reserve, network) fall through to it. Impersonal and
 * gender-neutral throughout (docs/study/COPY.md). */

export const MODELS_FAIL: Readonly<Record<string, string>> = {
  off: "השוואות כבויות כרגע.",
  "bad slots": "צריך לבחור 2 עד 4 מודלים שונים.",
  run_cap: "ההשוואה הזאת עלולה לעלות יותר מהמותר להשוואה אחת. אפשר להוריד מודל או לבחור חומר קצר יותר.",
  daily_runs: "היום כבר רצו כל ההשוואות של היום. אפשר שוב מחר.",
  lab_budget: "התקציב להשוואות החודש נגמר. אפשר שוב מה-1 בחודש.",
  closed: "ההשוואה הזאת כבר נעצרה.",
  "not waiting": "התשובה הזאת כבר בדרך.",
  "not rated here": "בהשוואה מהסוג הזה אין דירוג של הקבוצה.",
  seen: "הדירוג בהשוואה הזאת כבר נשמר.",
  "not done": "ההשוואה עוד לא הסתיימה.",
  "not rated": "חסר דירוג לאחת התשובות.",
  "bad rating": "הדירוג לא נשמר. אפשר לבחור ציון מ-1 עד 5.",
  "bad route": "הסוג הזה לא מוכר.",
  "bad model": "המודל הזה לא מוכר.",
  "bad provider": "את הספק הזה אי אפשר לאשר מכאן.",
  // Why a model cannot take a kind of work (server/study/routes.ts's routeRefusal, the route action).
  "unverified price": "המחיר של המודל הזה עוד לא נבדק מול הספק, ולכן אי אפשר להעביר אליו עבודה.",
  "not for this kind": "המודל הזה לא יכול לקבל את הסוג הזה.",
  "not configured": "לספק של המודל הזה עוד אין מפתח בשרת.",
  "not allowed": "עוד לא אושרה שליחה לספק הזה.",
  "no vision": "המודל הזה לא קורא תמונות, והסוג הזה שולח תמונות.",
  expensive: "המודל הזה יקר בערך פי שניים. צריך לאשר שוב.",
};

export const MODELS_FAIL_CODES: readonly string[] = Object.keys(MODELS_FAIL);

/** A refusal of the models package in words; anything else as failText words it for the group. */
export function modelsFail(code: string): string {
  return Object.prototype.hasOwnProperty.call(MODELS_FAIL, code) ? MODELS_FAIL[code] : failText(code, "group");
}
