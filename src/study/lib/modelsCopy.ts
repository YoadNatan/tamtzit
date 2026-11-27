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
  // The op lab's own (server/study/ops/lab.ts): no material for the kind yet, pages that could not be signed.
  "no material": "אין עדיין חומר מתאים להשוואה מהסוג הזה.",
  pictures: "התמונות של החומר לא נטענו. אפשר לנסות שוב.",
};

export const MODELS_FAIL_CODES: readonly string[] = Object.keys(MODELS_FAIL);

/** A refusal of the models package in words; anything else as failText words it for the group. */
export function modelsFail(code: string): string {
  return Object.prototype.hasOwnProperty.call(MODELS_FAIL, code) ? MODELS_FAIL[code] : failText(code, "group");
}

/* ── The screens' words (design-models §9; docs/study/COPY.md, "השוואת מודלים") ──
 * One Hebrew name per route key (§9.1), the same in the kind chips, the
 * results' picker, "מי כותב מה" and every sheet. Model names are never
 * translated: the screens put them in <bdi dir="ltr">. */

export const ROUTE_NAMES: Readonly<Record<string, string>> = {
  part: "סיכומים",
  practice: "שאלות תרגול",
  set_write: "שאלות בסט חדש",
  points: "נקודות שצריך לדעת",
  cards: "כרטיסיות",
  ask: "לשאול",
  solver: "הבדיקה של השאלות",
  exam_read: "קריאת מבחן",
  sheet_read: "קריאת דף תרגילים",
  similar: "שאלות דומות",
  mnemonic: "אסוציאציות",
  outline: "חלוקה לחלקים",
  notes: "הערות מהקלטה",
  reword: "ניסוח מחדש של שאלה",
  style: "קריאת סגנון מדוגמה",
  ask_route: "בחירת הרצאה לשאלה",
  wall_check: "בדיקת אסוציאציה",
  fix_check: "בדיקת תיקון",
  var: "בדיקה מול השקפים",
  trap_check: "בדיקת שאלות שנכתבו בקבוצה",
  exam_key: "קריאת מפתח של מבחן",
  exam_solve: "פתרון מבחן",
  sheet_key: "קריאת מפתח של דף",
  sheet_solve: "פתרון דף תרגילים",
  judge: "ציון AI בהשוואות",
};

/** The kinds members know, in "מי כותב מה"'s first list; the rest fold under "בדיקות ופעולות פנימיות". */
export const KNOWN_KEYS = ["part", "practice", "set_write", "points", "cards", "ask", "solver", "exam_read", "sheet_read", "similar", "mnemonic"] as const;

/** A line under a kind's name, where its name alone does not say what it is. */
export const ROUTE_SUBLINE: Readonly<Record<string, string>> = {
  solver: "כל שאלה נפתרת שוב בלי המפתח",
  fix_check: "תיקון שהוצע נבדק מול השקפים",
  exam_read: "העמודים של מבחן קודם מועתקים לשאלות",
  sheet_read: "העמודים של דף תרגילים מועתקים לשאלות",
};

/** A kind's one name; the key itself for a key this build does not name. */
export const routeName = (key: string): string => ROUTE_NAMES[key] ?? key;

/** Dollars as the screens show them: cents from $0.10, a tenth of a cent below, "פחות מ-$0.001" below that. */
export function usd(x: number | null | undefined): string {
  const v = Number(x);
  if (!Number.isFinite(v) || v <= 0) return "$0";
  if (v < 0.001) return "פחות מ-$0.001";
  if (v < 0.1) return `$${v.toFixed(v < 0.01 ? 3 : 2)}`;
  return `$${v.toFixed(2)}`;
}

export const MC = {
  // שלי (C1, C2)
  ownerRow: "השוואת מודלים",
  ownerSub: "איזה מודל כותב כל דבר, ובכמה",
  todoRow: (n: number) => `השוואות לדירוג · ${n === 1 ? "אחת מחכה" : `${n} מחכות`}`,
  todoSub: "לדרג תשובות בלי לדעת מי כתב",
  // Tabs and the budget line (C3, C4)
  title: "השוואת מודלים",
  tabs: { runs: "השוואות", board: "תוצאות", routes: "מי כותב מה" },
  tabsLabel: "מה בהשוואת מודלים",
  budget: (spent: string, line: string, left: number) => `השוואות החודש: ${spent} מתוך ${line} · ${left === 0 ? "היום כבר לא" : left === 1 ? "עוד אחת היום" : `עוד ${left} היום`}`,
  budgetAria: (spent: string, line: string) => `נוצלו ${spent} מתוך ${line} להשוואות החודש`,
  // The owner's home (C5, C6, C50)
  empty: "עוד אין השוואות. השוואה שולחת את אותו חומר לכמה מודלים ומציגה את התשובות בלי שמות, כדי לדרג אותן בלי לדעת מי כתב.",
  newRun: "השוואה חדשה",
  firstTitle: "השוואה ראשונה מומלצת",
  firstText: (what: string, a: string, b: string) => `${what}, ${a} מול ${b}`,
  firstUpTo: (x: string) => `עד ${x}`,
  start: "להתחיל",
  toResults: "לתוצאות",
  runModels: (n: number) => `${n} מודלים`,
  runChecked: "נבדק מול המפתח",
  runStatus: { running: "רצה עכשיו", done: "הסתיימה", cancelled: "נעצרה" } as Record<string, string>,
  seen: "השמות כבר הוצגו",
  notSeen: "השמות עוד לא הוצגו",
  // Switch off, offline (C18, C57, C59)
  off: "השוואות כבויות כרגע.",
  offline: "צריך חיבור כדי להריץ השוואה.",
  routesOff: "המעבר בין מודלים כבוי כרגע: הכול נכתב ב-Claude Opus 5.5.",
  // A new comparison (C7, C10, C12, C13, C14, C55)
  newTitle: "השוואה חדשה",
  step1: "מה להשוות?",
  step2: "על איזה חומר?",
  step3: "אילו מודלים? (2 עד 4)",
  other: "להחליף",
  againRandom: "שאלות אחרות",
  tagToday: "היום",
  tagUnverified: "מחיר לא נבדק",
  tagNoVision: "בלי תמונות",
  tagExpensive: "יקר",
  moreModels: (n: number) => `עוד ${n} מודלים`,
  fewerModels: "פחות מודלים",
  otherProviders: "ספקים נוספים: ב״מי כותב מה״",
  pickTwo: "צריך לבחור לפחות 2 מודלים.",
  pickMax: "אפשר לבחור עד 4 מודלים.",
  runButton: (x: string) => `להריץ (עד ${x})`,
  left: (x: string) => `נשארו ${x} להשוואות החודש`,
  overCap: (x: string, y: string) => `ההשוואה הזאת עלולה לעלות ${x}, יותר מ-${y}. אפשר להוריד מודל או לבחור חומר קצר יותר.`,
  overLine: (x: string) => `נשארו ${x} להשוואות החודש, פחות מההשוואה הזאת. אפשר להוריד מודל.`,
  dailyDone: (n: number) => `היום כבר היו ${n} השוואות. אפשר שוב מחר.`,
  pricing: "בודקים את החומר והמחיר…",
  noMaterial: {
    solver: "אין עדיין שאלות בבנק עם מפתח",
    fix_check: "אין עדיין תיקון שהוחלט",
    exam_read: "אין עדיין מבחן שנבדק",
    sheet_read: "אין עדיין דף תרגילים שנבדק",
  } as Record<string, string>,
  priceNote: "≈ המחיר הגבוה ביותר של כל מודל על החומר הזה. בפועל לרוב פחות.",
  starting: "מתחילים…",
  // A run (C20, C21, C22, C47, C48, C53)
  material: "החומר",
  materialTitle: "החומר של ההשוואה",
  materialGone: "החומר כבר לא נשמר (נשמר 60 יום).",
  ready: (k: number, n: number) => `${k} מתוך ${n} תשובות מוכנות`,
  leave: "אפשר לצאת מהמסך: ההשוואה ממשיכה גם בלי הטלפון.",
  status: { done: "מוכנה", truncated: "נקטעה באמצע", refused: "המודל סירב", timeout: "לא הספיקה בזמן", error: "משהו השתבש", waiting: "לא התחילה", running: "נכתבת" } as Record<string, string>,
  notStarted: "לא התחילה",
  blind: "התשובות בלי שמות. השמות, הזמן והעלות יופיעו אחרי שמציגים אותם.",
  blindRated: "התשובות בלי שמות. השמות, הזמן והעלות יופיעו אחרי הדירוג.",
  answer: (l: string) => `תשובה ${l}`,
  showText: "להציג את התשובה",
  hideText: "להסתיר את התשובה",
  reveal: "הצגת השמות והעלות",
  revealNote: "אחרי ההצגה התוצאות נכנסות ל״תוצאות״. בסוג הזה אין דירוג של הקבוצה: הבדיקה מול המפתח היא התוצאה.",
  cancel: "לעצור את ההשוואה",
  cancelConfirm: "תשובות שעוד נכתבות ייעצרו, ומה שכבר נוצל ייספר.",
  cancelYes: "לעצור",
  cancelNo: "ביטול",
  cancelled: "ההשוואה נעצרה.",
  retry: "לנסות שוב",
  oneAnswer: "רק תשובה אחת הגיעה, אין מה להשוות.",
  noAnswer: "אף תשובה לא הגיעה.",
  differs: "בהשוואה הזאת המודלים לא קיבלו את השאלות הקודמות של הקבוצה ואת התיקונים.",
  // Automatic checks (C29)
  checks: {
    match: (a: number, b: number) => `${a}/${b} תואמות למפתח`,
    falseRejects: (n: number) => (n === 1 ? "שאלה נכונה אחת נפסלה" : `${n} שאלות נכונות נפסלו`),
    copied: (a: number, b: number) => `${a}/${b} שאלות הועתקו נכון`,
    agrees: "מסכים עם ההחלטה של הקבוצה",
    disagrees: "לא מסכים עם ההחלטה של הקבוצה",
    unreadable: "התשובה לא נקראה",
    pending: "הבדיקה בתשלום עוד לא רצה",
    missing: (n: number) => (n === 1 ? "שאלה אחת לא נענתה" : `${n} שאלות לא נענו`),
  },
  // After the reveal (C30, C30b, C31)
  seconds: (s: number) => `${s} שניות`,
  tokens: (n: number) => `${n.toLocaleString("en")} טוקנים`,
  perMonth: (x: string) => `בחודש בקצב הנוכחי: בערך ${x}`,
  toBoard: (name: string) => `לתוצאות של ״${name}״`,
  rough: "הערכה גסה",
  side: "איכות מול מחיר בהשוואה הזאת",
  quality: "איכות",
  price: "מחיר",
  cheaper: (k: string) => `זול פי ${k}`,
  dearer: (k: string) => `יקר פי ${k}`,
  // Results (C32, C33, C34, C34b, C35, C52)
  boardKinds: "של איזה סוג?",
  boardLabel: "התוצאות לפי מודל",
  col: {
    quality: "איכות",
    groupScore: "דירוג הקבוצה",
    ai: "ציון AI",
    checks: "בדיקות",
    match: "תאימות למפתח",
    falseRejects: "נפסלו בטעות",
    refusals: "סירובים",
    perCall: "לקריאה",
    perMonth: "בחודש",
    runs: "השוואות",
    flags: "טעויות שסומנו",
    speed: "זמן",
  },
  items: (n: number) => (n === 1 ? "שאלה אחת" : `${n} שאלות`),
  runsN: (n: number) => (n === 1 ? "השוואה אחת" : `${n} השוואות`),
  small: "בסיס קטן",
  tooFew: (n: number) => `עוד מעט השוואות (${n}): מוקדם להחליט`,
  tooFewItems: (n: number, need: number) => `נבדקו רק ${n} שאלות מתוך ${need} שצריך כדי להמליץ: מוקדם להחליט`,
  recRated: (m: string, k: string, a: number, b: number) => `${m} זול פי ${k}, והקבוצה דירגה אותו דומה או טוב יותר ב-${a} מתוך ${b} השוואות.`,
  recKey: (m: string, k: string, a: number, n: number, b: number) => `${m} זול פי ${k}, ותאם למפתח ב-${a}% מתוך ${n} שאלות (היום: ${b}%).`,
  use: (name: string) => `להשתמש בו ל״${name}״`,
  boardEmpty: (name: string) => `עוד אין השוואות של ״${name}״.`,
  boardEmptyNew: (name: string) => `השוואה חדשה של ״${name}״`,
  boardHidden: "תוצאות של השוואה נכנסות לכאן אחרי שמציגים בה את השמות.",
  monthNote: "״בחודש״: מה הסוג הזה עלה ב-30 הימים האחרונים, אילו נכתב כולו במודל הזה, כולל הרצות חוזרות אחרי סירוב.",
  // מי כותב מה (C36-C41, C59)
  routesLead: "כל סוג עבודה נכתב במודל אחד. מה שלא שונה נכתב ב-Claude Opus 5.5.",
  inside: "בדיקות ופעולות פנימיות",
  chipDefault: "ברירת מחדל",
  chipChanged: (d: string) => `שונה ב-${d}`,
  month: (x: string) => `${x} בחודש`,
  sheetTitle: (name: string) => `מי כותב ״${name}״`,
  sheetLead: "המחיר לחודש לפי 30 הימים האחרונים.",
  routeSay: (name: string, model: string, now: string, before: string) =>
    `״${name}״: מעכשיו ב-${model}. לפי 30 הימים האחרונים: בערך ${now} בחודש במקום ${before}. אפשר לחזור לברירת המחדל מכאן בכל רגע.`,
  routeNoUse: (name: string, model: string) => `״${name}״: מעכשיו ב-${model}. ב-30 הימים האחרונים לא נכתב כאן כלום, אז אין עדיין מחיר לחודש. אפשר לחזור לברירת המחדל מכאן בכל רגע.`,
  nextPrice: (date: string, model: string, x: string) => `מ-${date} המחיר של ${model} עולה: בערך ${x} בחודש.`,
  summaries: "הרצאות שנכתבות עכשיו ימשיכו במודל הקודם עד שהכתיבה תסתיים.",
  expensive: (model: string, k: string, x: string) => `${model} יקר בערך פי ${k} מהמודל של היום: בערך ${x} בחודש. להחליף בכל זאת?`,
  change: "החלפה",
  changeAnyway: "להחליף",
  back: "חזרה לברירת המחדל",
  backSay: (name: string) => `״${name}״ חוזר ל-Claude Opus 5.5.`,
  changed: (name: string) => `המודל של ״${name}״ הוחלף.`,
  noBoard: "בלי השוואות של הסוג הזה המחיר הוא הערכה גסה, לפי מחירי המודלים בלבד.",
  sheetNo: "ביטול",
  otherProvider: (name: string, p: string) => `החומר של ״${name}״ יישלח ל-${p} במקום ל-Anthropic, והקבוצה תראה את זה ב״פרטיות״.`,
  // Providers (C41, C42, C42b)
  onlyClaude: "כרגע רק Claude",
  providers: "ספקים",
  configured: "מוגדר",
  noKey: "אין מפתח ב-Vercel",
  approved: "מאושר",
  approve: "לאשר שליחה",
  unapprove: "לבטל את האישור",
  approveTitle: (p: string) => `לאשר שליחה ל-${p}?`,
  approveText: (p: string) =>
    `בהשוואות, ובכל פעולה שתועבר ל-${p}, יישלחו לשם חומרים מההרצאות (גם תמונות), מבחנים ודפים שהועלו, ונוסח שחברי הקבוצה כתבו, בלי שמות של חברי הקבוצה.`,
  approveYes: "לאשר",
  keyTitle: (p: string) => `להוסיף את ${p}`,
  keyText: (p: string, env: string) =>
    `ב-Vercel, Settings ← Environment Variables, משתנה בשם ${env}, בסביבת Production בלבד. לפני כן כדאי לקבוע אצל ${p} מגבלת הוצאה (קרדיט מראש, בלי טעינה אוטומטית). אחרי ההוספה צריך Redeploy. הערך לא מוצג ולא מוזן באפליקציה.`,
  pricesChecked: (d: string) => `המחירים נבדקו ב-${d}`,
  stale: "המחיר נבדק לפני יותר מ-45 יום",
  // A member's list (C51)
  memberTitle: "השוואות לדירוג",
  memberEmpty: "אין כרגע השוואות לדירוג.",
  rated: "דורגו",
  skipped: "דולגו",
  toRate: "לדרג",
  // Loading and failure
  loading: "טוען…",
  failed: "לא הצליח לטעון. אפשר לנסות שוב.",
  again: "לנסות שוב",
} as const;
