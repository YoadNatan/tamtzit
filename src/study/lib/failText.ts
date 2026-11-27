import { flags } from "./flags";
import { codesKnownOn } from "./personalCode";

/* ── Error codes → Hebrew (spec §6.3; §12.7.4) ──
 * One map for every feature (replacing LectureView's FAIL_TEXT). A wrapper
 * throws Error(code) with the code of §4.11 (an RPC's exception text, an
 * endpoint's JSON `error`, or a stream's "\u0000ERROR <code>"); a screen turns
 * it into words here. The group quiz's codes stay in QUIZ_ERROR_TEXT (Z's
 * quiz.ts) and Auth's in authErrorText (A's account.ts). failText.test.ts
 * checks that every `raise exception` of §3's and §12's SQL is in one of the
 * three maps or in INTERNAL_CODES (review FE-19), that each of §12's has
 * words in every area that calls it (F-13), and that every code an op of
 * /api/study/ai can answer has words in its area or is internal. */

export type Area =
  | "writing"
  | "practice"
  | "exam"
  | "cards"
  | "ask"
  | "mnemonic"
  | "corrections"
  | "plan"
  | "marathon"
  | "pdf"
  | "group"
  // §12.2.5
  | "meeting"
  | "today"
  | "dispute"
  | "wall"
  | "museum"
  | "boss"
  | "bank"
  | "traps"
  | "pulse"
  // Courses (docs/study/sources.md): the course page and its sheets.
  | "course";

/** The paid features beside the summary: Claude's own failures read the
 *  same in each (§6.3; the museum's plaque as the memory aids, fun §5.7;
 *  VAR, a member's trap and the check of a correction likewise). */
const OPTIONAL: Area[] = ["practice", "exam", "cards", "ask", "mnemonic", "museum", "dispute", "traps", "corrections"];
const each = (areas: Area[], code: string, text: string) => Object.fromEntries(areas.map((a) => [`${a}:${code}`, text]));

// Without accounts (decision 1), the way back is the personal code (SQL
// section I, docs/study/personal-code.md) once the server offers it
// (health's "codes", known this session: codesKnownOn), or joining again.
const SIGNED_OUT = flags.account
  ? "הכניסה במכשיר הזה פגה. נכנסים שוב עם המייל: ״כניסה עם מייל״."
  : "הכניסה במכשיר הזה פגה. צריך להצטרף מחדש עם קוד הקבוצה.";
const SIGNED_OUT_CODE = "הכניסה במכשיר הזה פגה. נכנסים שוב עם הקוד האישי, או מצטרפים מחדש עם קוד הקבוצה.";
const SIGNED_OUT_KEYS = new Set(["not signed in", "session expired"]);

/** `code` for any area, `area:code` for one area. */
const TEXT: Record<string, string> = {
  // any call
  "not signed in": SIGNED_OUT,
  "session expired": SIGNED_OUT,
  // Answered by a refresh and one more try (api.ts postStudy). A second one comes after a refresh that
  // worked (one that fails is "session expired" or "network": authHeader), so the session is alive.
  "session expiring": "הכניסה מתחדשת. אפשר לרענן את העמוד ולנסות שוב.",
  schema: "העדכון של האפליקציה עוד לא הושלם. כדאי לנסות שוב בעוד כמה דקות.",
  off: "התכונה הזו כבויה כרגע בשרת.",
  forbidden: "אין גישה להרצאה הזו מהחשבון הזה.",
  network: "אין חיבור כרגע. כדאי לבדוק את החיבור ולנסות שוב.",
  // A wrapper's own codes for an answer that is no JSON (practice2.ts action()):
  // a 5xx or an empty 200 (bad reply), a 403 or 429 from the way to the server.
  server: "השרת לא הצליח לענות כרגע. אפשר לנסות שוב בעוד דקה.",
  "bad reply": "השרת לא הצליח לענות כרגע. אפשר לנסות שוב בעוד דקה.",
  blocked: "הבקשה נחסמה בדרך לשרת. אפשר לנסות שוב בעוד דקה, או מרשת אחרת.",
  "unknown op": "משהו השתבש בבקשה. כדאי לרענן את העמוד ולנסות שוב.",
  "bad json": "משהו השתבש בבקשה. כדאי לרענן את העמוד ולנסות שוב.",
  "bad request": "משהו השתבש בבקשה. כדאי לרענן את העמוד ולנסות שוב.",
  bad_api_key: "מפתח ה-API של Claude לא מוגדר נכון בשרת.",
  "missing ANTHROPIC_API_KEY": "מפתח ה-API של Claude עוד לא הוגדר בשרת (ANTHROPIC_API_KEY ב-Vercel).",
  // Not in §6.3; worded as the API key's line (the server key of F0).
  "missing STUDY_WORKER_KEY": "מפתח השרת עוד לא הוגדר (STUDY_WORKER_KEY ב-Vercel).",

  // lectures, members, joining
  "lecture not found": "ההרצאה הזו נמחקה או לא נמצאה. אפשר לבדוק ב״נמחקו לאחרונה״.",
  "too old": "עברו יותר מ-30 יום מהמחיקה, ואי אפשר לשחזר.",
  "name taken": "השם הזה כבר בשימוש בקבוצה. אפשר להוסיף אות או שם משפחה.",
  "not the creator": "רק מי שפתחו את הקבוצה יכולים לעשות את זה.",
  "not yourself": "רק מי שפתחו את הקבוצה יכולים לעשות את זה.",
  "member not found": "רק מי שפתחו את הקבוצה יכולים לעשות את זה.",
  "wrong code": "הקוד לא נמצא. כדאי לבדוק אותו שוב, אות אחרי אות.",
  // meeting design §8.1 (area today), and the same words wherever a group is gone
  "group not found": "הקבוצה לא נמצאה. כדאי לרענן.",
  // The personal code (section I; /api/study/code and api.ts redeemPersonalCode).
  "code not found": "הקוד הזה לא נמצא. כדאי לבדוק אותו שוב, או לבקש קוד חדש ממי שפתחו את הקבוצה.",
  "too many tries": "היו יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה.",
  "codes off": "כניסה עם קוד אישי לא זמינה כרגע. אפשר לנסות שוב מאוחר יותר.",
  // A token of a session that "ניתוק המכשירים האחרים" ended (section I's session check).
  "session ended": "הכניסה במכשיר הזה נותקה. נכנסים שוב עם הקוד האישי.",
  "sign-in failed": "הכניסה לא הושלמה. אפשר לנסות שוב.",
  "no code here": "אי אפשר ליצור כאן קוד אישי.",
  "groups closed": "כבר נפתחה קבוצה. כדי להצטרף צריך את קוד ההזמנה של הקבוצה.",
  "link host": "אפשר לקשר רק להקלטה באתר של האוניברסיטה.",

  // the budget
  member_share: "השימוש שלך החודש הגיע לחלק האישי בתקציב (40%). אפשר להמשיך בחודש הבא, וכל השאר בקבוצה ממשיכים כרגיל.",
  "writing:budget": "הקבוצה הגיעה לתקרת התקציב של החודש. אפשר להעלות אותה ב-Vercel (STUDY_MONTHLY_USD).",
  budget: "הקבוצה הגיעה לתקרת התקציב של החודש.",
  reserve: "זה נעצר עד סוף החודש, כדי שיישאר תקציב לסיכומים של ההרצאות הבאות.",

  // writing the summary
  "writing:retry limit": "״המשך כתיבה״ הופעל כבר שלוש פעמים היום בהרצאה הזו. אפשר לנסות שוב מחר.",
  "writing:lost": "הכתיבה של החלק נקטעה ארבע פעמים. אפשר ללחוץ ״המשך כתיבה״.",
  "writing:bad figures": "התמונות של ההרצאה לא אומתו. ״המשך כתיבה״ ירענן אותן.",
  "writing:rate_limited": "יותר מדי בקשות בבת אחת. אפשר להמשיך בעוד דקה.",
  "writing:overloaded": "Claude עמוס כרגע. אפשר ללחוץ ״המשך כתיבה״ בעוד דקה.",
  "writing:api_<status>": "Claude עמוס כרגע. אפשר ללחוץ ״המשך כתיבה״ בעוד דקה.",
  "writing:empty": "Claude עמוס כרגע. אפשר ללחוץ ״המשך כתיבה״ בעוד דקה.",
  "writing:timeout": "החלק לקח יותר מדי זמן לשרת. ״המשך כתיבה״ יכתוב אותו שוב, מהר יותר.",
  "writing:refusal": "המודל סירב לכתוב את החלק הזה.",
  "writing:truncated": "החלק נקטע באמצע.",
  "writing:busy": "נכתב עכשיו במכשיר אחר…",
  // Not in §6.3: another writer holds the part, as with busy.
  "writing:lease_lost": "נכתב עכשיו במכשיר אחר…",
  "writing:figures_expired": "התמונות של ההרצאה צריכות רענון. ״המשך כתיבה״ ירענן אותן.",
  "writing:no slides": "לא נמצא טקסט בשקפים.",
  "writing:too many slides": "יותר מ-250 שקפים: כדאי לפצל את המצגת.",
  "writing:outline": "תכנון מבנה הסיכום נכשל. ״המשך כתיבה״ ינסה שוב.",

  // the optional features (questions, past exams, cards, לשאול, memory aids)
  ...each(OPTIONAL, "rate_limited", "יותר מדי בקשות בבת אחת. אפשר לנסות שוב בעוד דקה."),
  ...each(OPTIONAL, "overloaded", "יותר מדי בקשות בבת אחת. אפשר לנסות שוב בעוד דקה."),
  ...each(OPTIONAL, "api_<status>", "יותר מדי בקשות בבת אחת. אפשר לנסות שוב בעוד דקה."),
  ...each(["practice", "exam", "cards"], "timeout", "החלק לקח יותר מדי זמן. ״לנסות שוב״ יכתוב אותו מהר יותר."),
  "ask:timeout": "התשובה נעצרה באמצע. אפשר לשאול שוב.",
  "ask:network": "התשובה נעצרה באמצע. אפשר לשאול שוב.",
  ...each(["mnemonic", "museum"], "timeout", "לא הצלחנו ליצור עכשיו. אפשר לנסות שוב."),
  ...each(["mnemonic", "museum"], "network", "לא הצלחנו ליצור עכשיו. אפשר לנסות שוב."),
  "ask:daily_limit": "אפשר לשאול עד 20 שאלות ביום. השאלות מתחדשות בחצות.",
  // Past exams (sources.md B8): 3 exams started a day per member (POLICY.exam).
  "exam:daily_limit": "אפשר להתחיל עד 3 מבחנים ביום. מתחדש בחצות.",
  // J's drafts: 5 paid requests a day (POLICY, review F-19); the line says the number POLICY sets.
  "mnemonic:daily_limit": "אפשר ליצור אסוציאציות עד 5 פעמים ביום. מתחדש בחצות.",
  "practice:refusal": "המודל סירב לכתוב שאלות על החלק הזה.",
  "exam:refusal": "המודל סירב לקרוא את הדפים האלה.",
  "cards:refusal": "המודל סירב לכתוב כרטיסיות על החלק הזה.",
  "ask:refusal": "לא התקבלה תשובה לשאלה הזאת. אפשר לנסח אותה אחרת.",
  "mnemonic:refusal": "לא התקבלו אסוציאציות לפסקה הזאת.",
  // J's drafts: none passed the checks, so nothing was saved (the call was paid).
  "mnemonic:empty": "הפעם לא יצאו טיוטות מדויקות לפסקה הזאת. אפשר לכתוב אחת משלך.",
  // J's drafts: another phone's request holds this paragraph's text (review SEC4-3); its drafts follow here.
  "mnemonic:busy": "הטיוטות לפסקה הזאת נכתבות עכשיו בטלפון אחר. הן יופיעו כאן בעוד רגע.",
  ...each(["practice", "cards"], "gave up", "החלק הזה נכשל שלוש פעמים, ולכן הוא נעצר. אפשר ליצור סבב חדש."),
  ...each(["practice", "cards"], "busy", "נכתב במכשיר אחר…"),
  "practice:empty": "לא נכתבו שאלות תקינות לחלק הזה.",
  "cards:empty": "לא נכתבו כרטיסיות תקינות לחלק הזה.",
  "practice:no slides": "אין בהרצאה שקפים לשאול עליהם.",
  "cards:no slides": "אין בהרצאה שקפים לכתוב מהם כרטיסיות.",
  // Not in §6.3: a part of a cards round that is gone, worded as practice's "batch not found".
  "cards:batch not found": "החלק הזה לא נמצא. כדאי לרענן.",

  // לשאול (the op's own 400 and 404; not in §6.3)
  "ask:question required": "צריך לכתוב שאלה.",
  "ask:too long": "השאלה ארוכה מדי (עד 500 תווים).", // §6.4, K's B7
  // The paragraph asked about was written again meanwhile (its anchor is gone), or the course is unknown.
  "ask:bad scope": "ההרצאה או הפסקה השתנו בינתיים. כדאי לרענן ולשאול שוב.",
  // A library question in a group (or a course) with no lectures.
  "ask:no lectures": "אין עדיין הרצאות לשאול עליהן. אפשר להעלות הרצאה בספרייה.",
  // "לשאול על כל הקורס" (sources.md B6.9).
  "ask:course not found": "הקורס הזה לא נמצא. אולי הוא אוחד עם קורס אחר. כדאי לרענן.",
  "ask:no summaries": "עוד אין סיכום לאף הרצאה בקורס. אפשר לשאול כשיהיה סיכום ראשון.",
  // No paragraph of the course matches the question (nothing was charged).
  "ask:no match": "לא מצאנו בסיכומים של הקורס פסקה על זה. אפשר לנסח אחרת, למשל עם שם התרופה או המושג.",
  // Courses (sources.md B2): the course page's sheets.
  "course:course not found": "הקורס הזה לא נמצא. אולי הוא אוחד עם קורס אחר. כדאי לרענן.",
  "course:group not found": "הקבוצה לא נמצאה. כדאי לרענן.",
  "course:bad name": "שם הקורס צריך להיות באורך של 1 עד 120 תווים.",
  "course:exists": "כבר יש קורס בשם הזה. אפשר לאחד את שני הקורסים.",
  "course:same course": "בוחרים קורס אחר לאחד איתו.",
  "course:bad date": "התאריך לא תקין.",
  "course:bad minutes": "משך המבחן הוא בין 10 ל-600 דקות.",
  "course:bad questions": "מספר השאלות במבחן הוא בין 5 ל-300.",
  "course:off": "עמודי הקורסים כבויים כרגע בשרת.",

  // memory aids (not in §6.3: the corrections' words name a correction)
  "mnemonic:part not found": "החלק הזה לא נמצא בסיכום. כדאי לרענן.",
  "mnemonic:bad block": "אי אפשר ליצור אסוציאציות לקטע הזה. אפשר לבחור פסקה אחרת.",

  // practice and past exams
  "practice:retired": "השאלה הוצאה מהתרגול.",
  // server design §9.1, with §12.7.4's rows
  "practice:bad bet": "אפשר לסמן ניחוש, נראה לי או על בטוח.",
  "practice:hidden": "השאלה הוסתרה מהתרגול אחרי שני דגלים, עד שתיבדק מול השקף.",
  "practice:not flagged": "השאלה הזו לא הוסתרה, אז אין מה לבדוק. שאלה נכנסת לבדיקה אחרי שני דגלים.",
  "practice:bad source": "כדי להשאיר את השאלה צריך לבחור שקף שמראה שהמפתח נכון.",
  "practice:too long": "עד 300 תווים.",
  "practice:question not found": "השאלה לא נמצאה. כדאי לרענן.",
  "practice:batch not found": "השאלה לא נמצאה. כדאי לרענן.",
  // Release 1's rounds stop at 80 active questions; practice 2.0's bank at 150 (and 400 drafts a lecture).
  "practice:enough questions": "להרצאה הזו יש כבר את מספר השאלות המרבי.",
  ...each(["practice", "exam"], "no key", "עוד אין תשובה לשאלה הזו."),
  "practice:in quiz": "השאלה הזו נמצאת עכשיו במבחן קבוצתי. אפשר לחזור אליה אחרי החשיפה.",
  "exam:too many pages": "אפשר להעלות מבחן של עד 120 עמודים.",
  // Past exams, phase 2 (sources.md B2, B7): the upload, its units, the review and the simulation.
  "exam:bad exam": "כדאי לבדוק את השנה, המועד ומשך המבחן.",
  "exam:course not found": "הקורס הזה לא נמצא. כדאי לרענן.",
  "exam:already started": "המבחן הזה כבר נשלח להעתקה.",
  "exam:bad pages": "משהו השתבש בעמודים שהועלו. כדאי להעלות את המבחן שוב.",
  "exam:missing pages": "חלק מהעמודים לא עלו. כדאי לנסות שוב.",
  "exam:bad urls": "הקישורים לעמודים לא תקינים. כדאי לרענן ולנסות שוב.",
  "exam:pages_expired": "הקישורים לעמודים פגו. ״לנסות שוב״ ירענן אותם.",
  "exam:unreadable": "לא הצלחנו לקרוא את העמודים האלה. אפשר לנסות שוב.",
  "exam:truncated": "ההעתקה נקטעה באמצע. אפשר לנסות שוב.",
  "exam:lost": "ההעתקה נקטעה כמה פעמים. אפשר לנסות שוב.",
  "exam:retry limit": "אפשר לנסות שוב עד 3 פעמים ביום בכל מבחן. אפשר לחזור לזה מחר.",
  "exam:nothing to retry": "אין עמודים שצריך לנסות שוב.",
  "exam:question not found": "השאלה לא נמצאה. כדאי לרענן.",
  "exam:in quiz": "השאלה הזו נמצאת עכשיו במבחן קבוצתי. אפשר לחזור אליה אחרי החשיפה.",
  "exam:bad text": "שאלה היא באורך 5 עד 600 תווים, ותשובה עד 400.",
  "exam:set question": "בשאלת נכון או לא נכון ובשאלת התאמה עוד אי אפשר לסמן תשובה ביד.",
  // Uploaded sheets (section O 1, docs/study/sheets.md): a sheet's name, a key that does not fit its question.
  "exam:bad sheet": "כדאי לבדוק את שם הדף: עד 120 תווים.",
  "exam:bad answer": "התשובה לא מתאימה לשאלה הזו. כדאי לרענן ולסמן שוב.",
  "exam:nothing to undo": "אין שינוי לבטל.",
  "exam:changed": "התשובה השתנתה מאז, אז אי אפשר לבטל. אפשר לסמן את התשובה הנכונה.",
  "exam:nothing to confirm": "אין כאן תשובה מוצעת לאשר.",
  "exam:versions": "בדף התשובות יש כמה נוסחים של המבחן, ולא ברור איזה מהם שלו. אפשר לסמן את התשובות ביד.",
  "exam:exam not ready": "המבחן עוד מועתק. אפשר להתחיל סימולציה כשההעתקה תסתיים.",
  "exam:too few questions": "במבחן הזה יש פחות מ-5 שאלות, אז אי אפשר לבנות ממנו סימולציה.",
  "exam:bad questions": "אורך הסימולציה הוא בין 5 ל-150 שאלות.",
  "exam:bad minutes": "הזמן הוא בין דקה אחת ל-600 דקות.",
  "exam:attempt not found": "הסימולציה הזו לא נמצאה. כדאי לרענן.",
  "exam:mock not found": "הסימולציה הזו לא נמצאה. כדאי לרענן.",
  "exam:bad choices": "צריך לענות על כל החלקים של השאלה.",
  // Uploaded sheets, release A1 (section O 2): fixing, adding and resuming.
  "exam:answered": "כבר ענו על השאלה: אפשר לתקן רק טקסט.",
  "exam:label taken": "יש כבר שאלה עם המספור הזה.",
  "exam:bad item": "משהו בשאלה לא תקין. כדאי לבדוק את הטקסט והאפשרויות.",
  "exam:nothing to resume": "אין מה להמשיך: ההעתקה כבר ממשיכה.",
  "exam:nothing to copy": "אין שאלות פתוחות להעתיק.",
  // The review's fixes: the sheets line held per sheet, a held sheet's retry, a sheet's hiding.
  "exam:sheets_cap": "התקציב לדפי תרגילים נגמר החודש. מתחדש ב-1 בחודש.",
  "exam:paused": "ההעתקה מחכה לתקציב. ״להמשיך״ שבכרטיס למעלה ימשיך אותה כשיש מקום.",
  "exam:not an exam": "דף תרגילים לא נכנס לחישוב הנושאים של הקורס.",

  // practice 2.0 (docs/study/practice-2-api.md): the points to know, a request's
  // options, the example read back, the drafts reviewed before the bank
  "practice:no summary": "עוד אין סיכום להרצאה הזו. הנקודות שצריך לדעת נקראות מהסיכום, אז קודם יוצרים אותו.",
  "practice:summary not ready": "הסיכום עוד נכתב. הנקודות שצריך לדעת ייקראו כשהוא יסתיים.",
  "practice:points stale": "הסיכום תוקן מאז שהנקודות נקראו. קוראים אותן שוב, ואז יוצרים.",
  "practice:no points": "בחלקים שנבחרו אין נקודות שצריך לדעת. אפשר לבחור חלקים אחרים.",
  "practice:count out of range": "בוחרים בין 1 ל-40 שאלות.",
  "practice:bad parts": "החלקים שנבחרו לא נמצאו בסיכום. כדאי לרענן.",
  "practice:bad styles": "בוחרים לפחות סגנון אחד.",
  "practice:focus too long": "שורת המיקוד ארוכה מדי (עד 200 תווים).",
  "practice:note too long": "עד 200 תווים.",
  "practice:bad example": "אפשר להדביק טקסט של עד 3,000 תווים, או לצרף תמונה אחת (JPG, PNG, WebP).",
  "practice:no example": "לא נמצאה שאלה בדוגמה. אפשר להדביק אותה כטקסט, או לצלם שוב.",
  "practice:truncated": "הקריאה נקטעה באמצע. אפשר לנסות שוב.",
  "practice:draft not found": "השאלה הזו לא נמצאה. כדאי לרענן.",
  "practice:not pending": "השאלה כבר לא ממתינה: היא נוספה לבנק, הורדה או נוסחה מחדש. כדאי לרענן.",
  "practice:not checked": "אפשר להוסיף לבנק רק שאלה שעברה בדיקה. שאלה שהבדיקה ענתה בה אחרת אפשר לנסח מחדש או להוריד.",
  "practice:reword limit": "השאלה הזו כבר נוסחה מחדש ארבע פעמים. אפשר להשאיר אותה או להוריד.",
  // question types (docs/study/question-types.md)
  "practice:not for steps": "מקרה בשלבים לא מנסחים מחדש. אפשר להשאיר אותו או להוריד.",
  "practice:not a set question": "השאלה הזו לא נתמכת עדיין בגרסה שלך. כדאי לרענן.",
  "practice:bad choices": "צריך לענות על כל החלקים של השאלה.",
  // A round over several lectures (sources.md B6.7).
  "practice:round full": "בסבב אחד אפשר לבחור עד 5 הרצאות.",
  "practice:too few questions": "בסבב על כמה הרצאות בוחרים לפחות 4 שאלות מכל הרצאה.",
  "practice:bad plan": "הסבב הזה לא נמצא. כדאי להתחיל אותו שוב.",
  "practice:schema": "סוגי השאלות החדשים עוד לא הופעלו במסד הנתונים. אפשר לבחור שאלות אמריקאיות בינתיים.",
  "practice:bad geometry": "לא הצלחנו לקרוא את הסימונים מהקובץ. אפשר לנסות קובץ אחר.",
  "practice:request not found": "הבקשה הזו לא נמצאה. כדאי לרענן.",
  // Practice sets (section L 1): the sets line also stops the older generator
  // screens (OD22). The set screens' own codes are worded in setsCopy.ts
  // (setFail), a lazy chunk, so they stay out of the entry chunk.
  "practice:sets_line": "הסטים של החודש הגיעו לתקרה שנקבעה. אפשר לפתור סטים קיימים, ומתחדש ב-1 בחודש.",
  // Not in §6.3: worded as "question not found".
  "exam:exam not found": "המבחן לא נמצא. כדאי לרענן.",

  // cards
  "cards:card not found": "הכרטיסייה לא נמצאה. כדאי לרענן.",
  // server design §9.1: the deck part by part, private cards
  "cards:bad parts": "החלקים שנבחרו לא נמצאו בהרצאה.",
  "cards:already": "כבר נוסף כרטיס מהשאלה הזו.",
  "cards:not yours": "אפשר להוסיף כרטיס רק מהשאלה שלך.",
  "cards:comment not found": "השאלה הזו כבר לא בשרשור. כדאי לרענן.",
  "cards:nothing to revert": "אין גרסה קודמת לחזור אליה.",
  "cards:enough cards": "להרצאה הזו יש כבר 150 כרטיסיות.",
  "cards:bad cloze": "במשפט להשלמה צריך בדיוק חלק אחד בתוך {{ }}.",
  "cards:bad answer": "חסרה תשובה.",
  "cards:unknown slide": "אין שקף כזה בהרצאה.",
  "cards:front length": "השאלה קצרה או ארוכה מדי.",
  "cards:too long": "התשובה או ההסבר ארוכים מדי.",
  "cards:conflict": "הכרטיסייה נערכה בינתיים במכשיר אחר. הגרסה החדשה מוצגת עכשיו, ואפשר לערוך שוב.",
  "cards:card deleted": "הכרטיסייה נמחקה בינתיים.",
  "cards:stale": "התשובה לכרטיסייה הזו נשמרה כבר ממכשיר אחר.",
  "cards:not the latest": "אי אפשר לבטל: הכרטיסייה נענתה כבר שוב.",

  // corrections (§12.7.4: a proposal with a source and a second approval, the undo of the latest)
  "corrections:link": "אי אפשר להוסיף קישור בתיקון. אפשר לכתוב את שם האתר במילים.",
  "corrections:bad undo": "אפשר לבטל רק את התיקון האחרון של הפסקה. נוסח ישן יותר מציעים מחדש, עם מקור.",
  // Not in §6.3: undoing an edit that is gone.
  "corrections:edit not found": "אי אפשר לבטל את התיקון הזה. כדאי לרענן.",
  ...each(["corrections", "dispute"], "bad source", "צריך מקור: שקף מההרצאה, דקה בהקלטה, או מקור חיצוני עם הסבר."),
  "corrections:pending exists": "לפסקה הזו כבר יש הצעת תיקון שממתינה. אפשר לאשר אותה או לפתוח מחלוקת.",
  "corrections:own proposal": "אי אפשר לאשר הצעה שלך. אישור מגיע מחבר או חברה אחרים בקבוצה, בלחיצה או בקול בפגישה.",
  ...each(["corrections", "dispute"], "not pending", "ההצעה כבר לא ממתינה. כדאי לרענן."),
  ...each(["meeting", "corrections"], "not the reader", "רק במסך ההקראה, בזמן הפגישה."),
  "corrections:not live": "אישור בקול נשמר רק בזמן הקראה חיה בפגישה, כשעוד שניים מהקבוצה עוקבים.",
  // the check of a correction (K-2's fix_check), server design §9.1
  "corrections:refusal": "לא התקבלה בדיקה הפעם. אפשר לנסח אחרת.",
  // Not in the designs' tables: the check cut short, in VAR's words for its own check (meeting §8.1).
  ...each(["corrections"], "timeout", "הבדיקה נעצרה באמצע. אפשר לנסות שוב."),
  ...each(["corrections"], "truncated", "הבדיקה נעצרה באמצע. אפשר לנסות שוב."),

  // "לשאול" (server design §9.1 "collab"; §12.7.4). Its "too long" for the
  // group's question (2,000 characters) is the op's line above: the question
  // the app sends to the group is the one it asked, at most 500.
  "ask:bad parts": "הפסקה הזו לא נמצאה. כדאי לרענן.",
  "ask:bad turn": "התשובה הזו כבר לא נמצאת. אפשר לשאול שוב ואז לשתף.",
  "corrections:bad block": "התיקון משנה את מבנה הסיכום (כותרת, רשימה או טבלה חדשה). אפשר לשנות רק את הטקסט של החלק הזה.",
  "corrections:no change": "לא שונה דבר.",
  "corrections:too long": "התיקון ארוך מדי.",
  ...each(["corrections", "mnemonic"], "part busy", "החלק הזה נכתב מחדש עכשיו. אפשר לתקן אחרי שהכתיבה תסתיים."),
  ...each(["corrections", "mnemonic"], "part rewritten", "החלק נכתב מחדש מאז שהעריכה התחילה, ולכן התיקון לא נשמר. הנוסח שלך נשאר כאן להעתקה."),
  "corrections:part not found": "לא נשמר. כדאי לבדוק את החיבור ולנסות שוב.",

  // the PDF
  "pdf:daily_limit": "אפשר ליצור עד 10 קובצי PDF ביום. אפשר להדפיס מהמכשיר.",
  "pdf:too long": "הסיכום ארוך מדי לקובץ אחד. אפשר להדפיס מהמכשיר.",
  "pdf:pdf": "לא הצלחנו להכין PDF. אפשר לנסות שוב, או להשתמש בהדפסה מהמכשיר.",

  // the group's marathon plan (G, server design §9.1; A2 builds no private plan) and marathons
  "plan:plan not found": "התוכנית הזו לא נמצאה. כדאי לרענן.",
  "marathon:plan not found": "לא נמצא. כדאי לרענן.",
  ...each(["plan", "marathon"], "marathon not found", "לא נמצא. כדאי לרענן."),
  ...each(["plan", "marathon"], "no agenda", "לא נמצא. כדאי לרענן."),
  "plan:bad date": "התאריך מחוץ לתוכנית, או שהמבחן כבר עבר.",
  "plan:bad title": "מה שם המבחן?",
  "plan:lecture not found": "אחת ההרצאות כבר לא קיימת. כדאי לרענן.",
  "plan:bad minutes": "אפשר 30 עד 600 דקות ביום בסבב המשותף, ועד 840 בחופש הלמידה.",
  "plan:bad rounds": "כל הרצאה חוזרת 2 עד 4 פעמים.",
  "plan:conflict": "התוכנית השתנתה בינתיים. הגרסה החדשה נטענה, ואפשר לערוך שוב.",
  "plan:bad choice": "אפשר להוסיף זמן ביום, או לוותר על יום חזרה אחד.",
  "marathon:conflict": "מפגש הלמידה השתנה בינתיים. הגרסה החדשה נטענה, ואפשר לערוך שוב.",
  "marathon:bad time": "מועד מפגש הלמידה כבר עבר.",
  "marathon:bad agenda": "משהו בסדר היום לא תקין. כדאי לבנות אותו מחדש.",
  "marathon:marathon over": "מפגש הלמידה כבר הסתיים.",

  // the day's meeting (meeting design §8.1; §12.7.4)
  "meeting:bad parts": "החלקים שנבחרו לא נמצאו בהרצאה.",
  "meeting:meeting not found": "הפגישה הזו לא נמצאה. כדאי לרענן.",
  "meeting:meeting exists": "להרצאה הזו כבר יש פגישה ביום הזה.",
  "meeting:question not found": "השאלה הזו כבר לא בניחושים של הפגישה. כדאי לרענן.",
  "meeting:bad time": "אפשר לקבוע פגישה עד שבועיים קדימה.",
  "meeting:bad title": "הכותרת ארוכה מדי (עד 120 תווים).",
  "meeting:conflict": "הפגישה השתנתה בינתיים. הגרסה החדשה נטענה, ואפשר לערוך שוב.",
  "meeting:meeting started": "הפגישה כבר התחילה, ולכן אי אפשר לבטל אותה או להחליף את היום, ההרצאה או החלקים.",
  "meeting:not live": "אין עכשיו הקראה בפגישה.",
  "meeting:reading": "ההקראה פעילה בטלפון אחר. אפשר לעקוב אחריה.",
  "meeting:released": "התשובה לניחוש כבר נדלקה.",
  "meeting:bad choice": "צריך לבחור אחת מהתשובות.",
  "meeting:not over": "ההשלמה נפתחת אחרי הפגישה.",

  // yellow cards and VAR (meeting design §8.1; §12.7.4)
  "dispute:bad claim": "טענה בשורה אחת: 5 עד 240 תווים.",
  "dispute:dispute open": "על הפסקה הזו כבר פתוחה מחלוקת.",
  "dispute:not open": "הגיבוי נסגר כשביקשו בדיקה מול השקפים, או שהמחלוקת כבר נסגרה. כדאי לרענן.",
  "dispute:too long": "עד 200 תווים.",
  "dispute:sides taken": "למחלוקת הזו כבר יש שני צדדים. אפשר לגבות אחד מהם.",
  "dispute:a side cannot back": "צד במחלוקת לא מגבה. הגיבוי הוא של שאר הקבוצה.",
  "dispute:not ready": "בדיקה מול השקפים צריכה שני צדדים, ורק פעם אחת למחלוקת.",
  "dispute:not judged": "עוד אין הכרעה, או שכבר הוחלט.",
  ...each(["dispute", "today"], "dispute not found", "לא נמצא. כדאי לרענן."),
  ...each(["dispute", "today"], "flag not found", "לא נמצא. כדאי לרענן."),
  ...each(["dispute", "today"], "not found", "לא נמצא. כדאי לרענן."),
  "dispute:bad note": "צריך לכתוב מה לא תקין בשקף (5 עד 300 תווים).",
  "dispute:daily_limit": "אפשר לבקש בדיקה מול השקפים עד 3 פעמים ביום.",
  "dispute:refusal": "לא התקבלה הכרעה במחלוקת הזאת. אפשר לנסח את הטענות אחרת.",
  ...each(["dispute"], "truncated", "הבדיקה נעצרה באמצע. אפשר לנסות שוב."),
  ...each(["dispute"], "timeout", "הבדיקה נעצרה באמצע. אפשר לנסות שוב."),
  ...each(["dispute"], "network", "הבדיקה נעצרה באמצע. אפשר לנסות שוב."),
  "dispute:busy": "נבדק עכשיו במכשיר אחר. התוצאה תופיע כאן.",
  // A correction's paragraph that is gone (the collab line of server design §9.1, for the same moment).
  ...each(["dispute", "wall", "traps"], "part not found", "הפסקה הזו לא נמצאה. כדאי לרענן."),

  // the association wall (fun design §5.7; §12.7.4)
  "wall:bad body": "האסוציאציה צריכה להיות בין 3 ל-500 תווים.",
  "wall:bad fact": "חסרה שורת ׳על מה זה?׳: העובדה והשקף, שיהיה מובן גם למי שלא היה.",
  "wall:unknown slide": "אין שקף כזה בהרצאה.",
  "wall:bad photo": "אפשר לצרף רק תמונה שהועלתה מהחשבון הזה, ולאסוציאציה אחת בלבד.",
  "wall:bad figure": "התמונה מהשקף לא נמצאה. אפשר לנעוץ בלי התמונה.",
  "wall:bad credit": "קרדיט אפשר לתת רק למי שבקבוצה, ולא לעצמך.",
  "wall:aid not found": "האסוציאציה לא נמצאה, או שאינה שלך. כדאי לרענן.",
  "wall:own aid": "על אסוציאציה שלך אי אפשר להצביע.",
  "wall:not yours": "את הסימון מסירים מי שסימנו אותו או מי שכתבו את האסוציאציה. סימון של הבדיקה יורד כשמתקנים.",
  "wall:credit not found": "בקשת הקרדיט כבר נענתה.",
  "wall:daily_limit": "אפשר להעלות עד 30 אסוציאציות ביום. מתחדש בחצות.",
  "wall:busy": "נבדקת עכשיו במכשיר אחר…",
  // W-20: the phone's resize could not bring the photo under 600 kB
  "wall:too big": "התמונה גדולה מדי גם אחרי הקטנה. אפשר לצלם שוב.",

  // the museum (fun design §5.7; §12.7.4); Claude's own failures as the memory aids'
  "museum:exhibit not found": "הטעות הזו כבר לא ברשימה. כדאי לרענן.",
  "museum:busy": "ההסבר נכתב עכשיו במכשיר אחר.",
  "museum:checked": "לטעות הזו כבר יש הסבר.",

  // the boss (fun design §5.7; for a member the pulse does not count, H adds BOSS_NOT_COUNTED)
  "boss:no heads": "עוד אין מספיק נושאים קשים לאתגר: צריך לפחות שני נושאים שלפחות 3 מכם מתקשים בהם. זה מתעדכן בלילה.",
  "boss:revenge not yet": "הסבב החוזר נפתח מחר.",

  // the bank written ahead (server design §9.1, its "upload" line)
  "bank:server off": "הכתיבה בשרת עוד לא פועלת, אז השאלות ייכתבו מהטלפון אחרי הסיכום.",

  // a member's own trap (server design §9.1)
  "traps:bad source": "צריך לבחור 1 עד 6 שקפים מההרצאה.",
  "traps:bad question": "השאלה צריכה להסתיים בסימן שאלה (8 עד 400 תווים).",
  "traps:bad options": "4 או 5 תשובות, שונות זו מזו, עד 220 תווים כל אחת.",
  "traps:bad answer": "צריך לסמן את התשובה הנכונה.",
  "traps:daily_limit": "אפשר לכתוב עד 10 שאלות משלך ביום, ולבדוק עד 5.",
  "traps:draft not found": "הטיוטה הזו לא נמצאה. כדאי לרענן.",
  "traps:refusal": "לא התקבלה בדיקה הפעם. אפשר לנסח אחרת.",
  ...each(["traps"], "truncated", "הבדיקה נעצרה באמצע. אפשר לנסות שוב."),
  ...each(["traps"], "timeout", "הבדיקה נעצרה באמצע. אפשר לנסות שוב."),
  // The paragraph of the trap is gone (the collab line of server design §9.1, for the same moment).
  "traps:bad parts": "הפסקה הזו לא נמצאה. כדאי לרענן.",
};

/** §12.7.4's second line for "no heads": H adds it after failText("no heads",
 *  "boss") for a member the night did not count (study_pulse_ready is null). */
export const BOSS_NOT_COUNTED = "האתגר נבנה מ״מה קשה לקבוצה״, שמוצג רק למי שנספרים בו.";

const FALLBACK: Partial<Record<Area, string>> = {
  writing: "הכתיבה נעצרה. אפשר ללחוץ ״המשך כתיבה״.",
  corrections: "לא נשמר. כדאי לבדוק את החיבור ולנסות שוב.",
  plan: "התוכנית לא נשמרה. אפשר לנסות שוב.",
  practice: "משהו השתבש בתרגול. אפשר לנסות שוב.",
};
const OTHER_FALLBACK = "לא הצלחנו. אפשר לנסות שוב.";

/** Codes the screens never show as words: either no screen can meet them
 *  (input the app never sends, the server's own bookkeeping), or a screen
 *  answers them itself (`confirm name` makes A1's sheet ask again, `edit conflict` opens K's A6 with
 *  the name). An entry "area:code" is internal in that area only (the code
 *  has words elsewhere). failText() gives them the area's fallback all the
 *  same. */
export const INTERNAL_CODES: readonly string[] = [
  // uploaded sheets (section O 2): the worker's and the op's own checks, and answers the screens never send
  "not a sheet",
  "bad page",
  "bad hold",
  "not retired",
  "not a numeric question",
  "not an open question",
  "bad mark",
  "not shown",
  // a writer's item of a question type the server's checks already passed (server key only)
  "bad form",
  "confirm name",
  "edit conflict",
  // the writer's and the batches' own bookkeeping (server key only)
  "bad finish",
  "bad status",
  "bad state",
  "batch not writing",
  "batch or exam",
  "part full",
  "outside the part",
  "bad part",
  "explanations do not match options",
  "bad count",
  "bad kinds",
  "bad mode",
  "bad seconds",
  // §12: the server's and the worker's own bookkeeping (server design §9.1, meeting §8.1, fun §4.8)
  "whens do not match options",
  "tags do not match options",
  "bad verdict",
  "bad origin",
  "bad action",
  "job not found",
  "lease lost",
  "bad event",
  "bad plaque",
  "bad drafts",
  "practice:bad options",
  "practice:bad answer",
  // practice sets: a set the phone sends malformed, a second attach of one set, a begin with no id (server key only)
  "practice:bad set",
  "practice:no set",
  "set has a request",
  "practice:unknown slide",
  "practice:exam not found",
  "bank:batch not found",
  "wall:checked",
  "plan:checked",
  "traps:checked",
  // input the screens never send: their controls bound it
  "bad kind",
  "unknown figure",
  "bad review",
  "review not found",
  "bad rating",
  "bad days",
  "bad courses",
  "too many lectures",
  "bad step",
  // past exams (S 2): the worker's saves (server key only) and what the screens bound
  "bad unit",
  "bad items",
  "bad keys",
  "bad field",
  "bad progress",
  // §12: a direct edit (the app proposes), a side, a decision, a tap by the reader,
  // a remix, a draft, a vote or a flag the composer bounds (meeting §8.1, fun §4.8, §12.7.4)
  "needs approval",
  "bad side",
  "bad decision",
  "is reader",
  "bad remix",
  "bad draft",
  "bad vote",
  "bad flag",
  "practice:bad choice",
  "cards:bad time",
  "cards:too many slides",
  "cards:bad figure",
  "meeting:bad preset",
  // the ops of /api/study/ai (Q, C, K): what the app sends is its own rows'
  // ids and only the turns the server signed; an op not built yet has its
  // screens off; the app always posts
  "lectureId and batchId required",
  "batch of another lecture",
  "bad history",
  "not built",
  "POST only",
  // the ops' bookkeeping: a claim or a reservation with no row
  "no claim",
  "no reservation",
  // practice 2.0: the server's own bookkeeping (server key only), and input
  // the screens never send (their chips bound the level and difficulty; a
  // style the server read back travels signed; drafts and requests are the
  // app's own rows)
  "part not writing",
  "bad points",
  "bad style",
  "rewrite limit",
  "not failed",
  "bad batch",
  "no request",
  "bad action",
  "bad level",
  "bad difficulty",
  "lectureId required",
  "lectureId and draftId required",
  "draft of another lecture",
  // op "var": the app always sends the yellow card's own id
  "dispute:disputeId required",
  "traps:draftId required",
  // notifications (section R): the worker's report (server key only); the
  // settings screen words its own failures (notifyText: a device that did
  // not sign up, a setting not saved, a test push too soon)
  "bad results",
  "bad endpoint",
  "bad prefs",
  "too many",
];

/** Whether a code is internal: in every area, or in this one. */
export function isInternal(code: string, area?: Area): boolean {
  const k = keyOf(code.trim());
  return INTERNAL_CODES.includes(k) || (area !== undefined && INTERNAL_CODES.includes(`${area}:${k}`));
}

/** `api_529` → `api_<status>`, as the table names it. */
const keyOf = (code: string) => (/^api_\d+$/.test(code) ? "api_<status>" : code);

/** The Hebrew line for a code: `area:code`, then `code`, then the area's fallback. */
export function failText(code: string, area: Area = "writing"): string {
  const k = keyOf(code.trim());
  if (!flags.account && SIGNED_OUT_KEYS.has(k) && codesKnownOn()) return SIGNED_OUT_CODE;
  return TEXT[`${area}:${k}`] ?? TEXT[k] ?? FALLBACK[area] ?? OTHER_FALLBACK;
}

/** Whether a code has words of its own: in this area (its own row or an
 *  any-area row), or in any area when none is given. */
export function hasText(code: string, area?: Area): boolean {
  const k = keyOf(code.trim());
  if (area !== undefined) return `${area}:${k}` in TEXT || k in TEXT;
  return k in TEXT || Object.keys(TEXT).some((key) => key.endsWith(`:${k}`));
}

/** Codes whose one line covers several causes (the sign-in's). */
const SIGN_IN_CODES = ["not signed in", "session expired", "session expiring"];

/** The code a screen prints small under its error line, so a member's
 *  screenshot names a failure the line does not: the server's own code when
 *  a wrapper put a line of its own on it (`raw`, as practice2.ts action()
 *  does); else the code when the line is a generic one (no words in this
 *  area, or internal: the area's fallback) or the sign-in's. Nothing for a
 *  code with a line of its own, and nothing for "network" (no answer came
 *  from the server). Takes an Error or a code. */
export function failCode(e: unknown, area: Area): string {
  const raw = e instanceof Error ? (e as Error & { raw?: unknown }).raw : undefined;
  if (typeof raw === "string" && raw) return raw.slice(0, 120);
  const code = (e instanceof Error ? e.message : typeof e === "string" ? e : "").trim();
  if (!code || code === "network") return "";
  const generic = !hasText(code, area) || isInternal(code, area) || SIGN_IN_CODES.includes(code);
  return generic ? code.slice(0, 120) : "";
}

/** The "{סיבה}" of a part that will be retried by itself (design-platform §1.A). */
export function failShort(code: string): string {
  const k = keyOf(code.trim());
  if (k === "timeout") return "לקח יותר מדי זמן";
  if (["rate_limited", "overloaded", "api_<status>", "network", "empty"].includes(k)) return "Claude עמוס";
  return "תקלה";
}
