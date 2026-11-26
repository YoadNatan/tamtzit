/* ── The words of practice sets (docs/study/sets.md; design §6.1) ──
 * One name for the action, "סט חדש", and one for the thing, "סט". Buttons
 * are infinitives (ליצור, לפתור, לשלוח קישור); group facts are impersonal or
 * third-person plural ("פותרים: 4", "מאת נועה"); the member's own things say
 * "שלי", never the second person. No model's name, and never "נקודות" (it
 * reads as score points: coverage is a percentage). Pinned by
 * setsCopy.test.ts, which also rejects second-person and gendered forms.
 *
 * Imported only by the lazy screens (MakeScreen, MakeParts, MakeProgress,
 * and slice B's set screens), never by the slot module features/qsets.tsx:
 * the words stay out of the study entry chunk (design §10). Prices come in
 * as text ("$0.40", practice2.ts usd()) and the screens put them in an LTR
 * <bdi>. The notices' words are section R's (shared/study/notifyCopy.ts). */

/** "שאלה אחת", "10 שאלות". */
export const questionsWord = (n: number): string => (n === 1 ? "שאלה אחת" : `${n} שאלות`);

/** "כ-$0.40" (the price inside the screen's own LTR bdi). */
export const about = (usd: string): string => `כ-${usd}`;

export const SETS = {
  entry: "סט חדש",
  entryMistakesNew: "שאלות חדשות על הטעויות",

  make: {
    title: "סט חדש",
    lectureChange: "להחליף",
    lectureSheet: "איזו הרצאה",
    lectureSearch: "חיפוש הרצאה",
    lectureNone: "אין שאלות עדיין",
    lectureNotFound: "אין הרצאה בשם הזה",
    lectureEmpty: "עוד אין הרצאות בקבוצה. סט נוצר מהרצאה שהועלתה.",
    lectureNoSummary: "הסיכום עוד לא נכתב",
    howMany: "כמה שאלות",
    more: "עוד אפשרויות",
    level: "רמה",
    levels: { easy: "קלה", exam: "כמו במבחן", hard: "קשה" },
    types: "סוגי שאלות",
    typesDefault: "ברירת מחדל",
    typesLast: "מהפעם הקודמת",
    typesReset: "לחזור לברירת המחדל",
    parts: "חלקים",
    partsAll: "כל החלקים",
    example: "דוגמה לסגנון",
    examplePaste: "להדביק טקסט",
    examplePhoto: "לצלם",
    examplePhotoHint: "לצלם רק את השאלה, בלי שם או מספר זהות",
    examplePlaceholder: "להדביק כאן שאלה ממבחן קודם, עם האפשרויות",
    exampleAdded: "התמונה צורפה",
    exampleRemove: "להסיר",
    exampleNote: "הדוגמה נקראת בתחילת היצירה",
    focus: "מיקוד",
    focusPlaceholder: "למשל: תופעות לוואי ומינונים",
    custom: "מספר אחר (1–40)",
    computing: "מחשבים…",
    creating: "יוצרים…",
    offline: "אין חיבור כרגע. התצוגה תתעדכן כשהחיבור יחזור.",
    loadFail: "המסך לא נטען. כדאי לבדוק את החיבור ולנסות שוב.",
    retry: "לנסות שוב",
    bigGo: "ליצור",
    bigNo: "לא עכשיו",
    openGo: "לפתוח את הסט",
    openForce: "ליצור סט נוסף בכל זאת",
    notReady: "הסיכום עוד נכתב · אפשר ליצור סט כשהוא מוכן",
    full: "בהרצאה כבר יש 150 שאלות · אפשר לפתור מהבנק בחינם",
    fullGo: "לפתור מהבנק",
    cap: "תקציב השאלות של הקבוצה לחודש הזה נגמר · אפשר לפתור סטים קיימים · מתחדש ב-1 בחודש",
    capMine: "החלק האישי בתקציב החודשי נוצל · אפשר לפתור סטים של הקבוצה",
    line: "הסטים של החודש הגיעו לתקרה שנקבעה · אפשר לפתור סטים קיימים · מתחדש ב-1 בחודש",
    tooBig: "לסט בגודל הזה לא נשאר מספיק תקציב החודש · אפשר סט קטן יותר",
    daily: "המכסה היומית של סטים חדשים נוצלה · אפשר שוב מחר",
    off: "יצירת שאלות כבויה זמנית · אפשר לפתור סטים קיימים",
    noTypes: "צריך לבחור לפחות סוג שאלה אחד",
    noPoints: "בחלקים שנבחרו אין עוד חומר לשאלות",
    keys: "חיצים: כמה שאלות · Enter: ליצור",
  },

  preview: {
    label: "מה ייווצר",
    check: "כל שאלה נבדקת לפני שהיא נכנסת לבנק",
    coverFull: "הבנק כבר מכסה את כל ההרצאה · הסט יחזור על נושאים",
    read: "כולל קריאת ההרצאה (פעם אחת לכל הקבוצה)",
    example: "כולל קריאת הדוגמה",
    shared: "הסט ישותף עם הקבוצה",
    sharedMistakes: "הסט ישותף עם הקבוצה כמו כל סט, בלי לציין שהוא על טעויות",
    bank: "השאלות נכנסות לבנק של הקבוצה",
    low: "נשאר מעט מהתקציב החודשי",
    freeGo: "לפתור בחינם",
  },

  gen: {
    title: "סט בהכנה",
    reading: "קוראים את ההרצאה · כ-2 דקות, פעם אחת לכל הקבוצה",
    readingElsewhere: "ההרצאה נקראת במכשיר אחר · כ-2 דקות",
    readFail: "חלק מההרצאה לא נקרא · אפשר לנסות שוב",
    styleRead: "קוראים את הדוגמה…",
    styleFail: "הדוגמה לא נקראה · השאלות נכתבות בסגנון הרגיל",
    starting: "מכינים את הסט…",
    details: "פרטים",
    tile: { coming: "בדרך", ready: "מוכנה", failed: "לא יצאה" },
    readyList: "השאלות המוכנות",
    readyNone: "השאלות יופיעו כאן כשהן מוכנות",
    keepOpen: "היצירה רצה מהמכשיר הזה. סגירת האפליקציה עוצרת אותה, ואפשר להמשיך כשחוזרים.",
    startNote: "השאלות שנבדקו נכנסות לבנק של הקבוצה",
    review: "לעבור על השאלות אחת-אחת",
    done: "הסט מוכן",
    budgetStopLine: "אפשר לפתור את מה שכבר מוכן",
    offline: "אין חיבור. מה שכבר נטען נשאר כאן.",
    offlineGoesOn: "הכתיבה תמשיך כשהחיבור יחזור",
    paused: "היצירה נעצרה באמצע",
    resume: "להמשיך ליצור",
    resumeCost: "העלות נרשמת על מי שממשיך",
    notFound: "הסט לא נמצא. אולי נמחק.",
    loadFail: "המסך לא נטען. כדאי לבדוק את החיבור ולנסות שוב.",
    slide: "שקף",
  },

  set: {
    solve: "לפתור",
    how: "איך",
    howPlain: "רגיל",
    howExam: "מצב מבחן: שעון, ההסברים בסוף",
    link: "לשלוח קישור",
    linkCopied: "הקישור הועתק",
    menu: { rename: "לשנות שם", hide: "להסתיר אצלי", unhide: "להחזיר", delete: "למחוק את הסט" },
    menuLabel: "פעולות על הסט",
    save: "לשמור",
    deleteConfirm: "למחוק את הסט? השאלות נשארות בבנק של הקבוצה.",
    notFound: "הסט לא נמצא · אולי נמחק",
    signedOut: "הסט נמצא בקבוצה. מי שכבר בקבוצה: כניסה עם הקוד האישי, או פתיחה מהאייקון ← סטים של הקבוצה",
  },

  stats: {
    perQ: "איך הלך לקבוצה בכל שאלה",
    bands: { most: "רוב צדקו", some: "חלק צדקו", few: "רוב טעו" },
    hard: "קשה לקבוצה",
    wait: "הממוצע והתוצאות לפי שאלה מופיעים מ-3 פותרים נוספים",
    privacy: "רק מספרים של הקבוצה · שמות רק של מי שבחרו",
    optin: "להציג את השם שלי ברשימת מי פתרו",
    mineNotYet: "שלי: עוד לא",
    onlyMe: "רק אצלי",
    optinYes: "להציג",
    optinNo: "לא עכשיו",
  },

  shelf: {
    title: "סטים של הקבוצה",
    newHead: "חדשים",
    newBadge: "חדש",
    mine: "שלי",
    empty: "עוד אין סטים בקבוצה",
  },

  hub: { sets: "סטים של הקבוצה", all: "לכל הסטים" },
  today: { card: "תרגול", solveNew: "לפתור סט חדש" },
  err: { alreadyMaking: "יש כבר סט בהכנה על ההרצאה הזאת" },
  help: { row: "איך יוצרים סט ופותרים עם הקבוצה?" },
} as const;

/* ── Lines with numbers and names ── */

/** "ליצור 10 שאלות" (the price follows in its own bdi: "· כ-$0.40"). */
export const makeGo = (n: number): string => `ליצור ${questionsWord(n)}`;
/** The preview's head: "10 שאלות · משתנים". */
export const previewHead = (n: number, lecture: string): string => `${questionsWord(n)} · ${lecture}`;
/** "אחרי הסט: 89% מההרצאה מכוסים בבנק". */
export const previewCover = (percent: number): string => `אחרי הסט: ${percent}% מההרצאה מכוסים בבנק`;
/** "בבנק יש 14 שאלות שעוד לא נענו". */
export const previewFree = (n: number): string => (n === 1 ? "בבנק יש שאלה אחת שעוד לא נענתה" : `בבנק יש ${n} שאלות שעוד לא נענו`);
/** "אפשר ליצור עוד 2 סטים היום" (shown only when k ≤ 2). */
export const previewDaily = (k: number): string => (k === 1 ? "אפשר ליצור עוד סט אחד היום" : `אפשר ליצור עוד ${k} סטים היום`);
/** "סט גדול · כ-$1.10 מתקציב הקבוצה" (the price inside the screen's bdi). */
export const makeBig = (usd: string): string => `סט גדול · כ-${usd} מתקציב הקבוצה`;
/** The open set on the lecture (D6): "יש סט בהכנה על ההרצאה · מאת שוהם · 6/10". */
export const makeOpen = (name: string, made: number, want: number): string => `יש סט בהכנה על ההרצאה · מאת ${name} · ${made}/${want}`;
/** A recent set on the lecture (≤ 7 days): "יש סט מאתמול על ההרצאה · 10 שאלות · מאת נועה". */
export const makeRecent = (when: string, n: number, name: string): string => `יש סט מ${when} על ההרצאה · ${questionsWord(n)} · מאת ${name}`;

/** The generating screen's head: "סט בהכנה · משתנים". */
export const genTitle = (lecture: string): string => (lecture ? `${SETS.gen.title} · ${lecture}` : SETS.gen.title);
/** "6 מוכנות · עוד 4 בדרך"; one: "שאלה אחת מוכנה · עוד 9 בדרך"; all ready: "10 שאלות מוכנות". */
export function genCount(ready: number, coming: number): string {
  const rest = coming === 1 ? "עוד אחת בדרך" : `עוד ${coming} בדרך`;
  if (coming <= 0) return ready === 1 ? "שאלה אחת מוכנה" : `${ready} שאלות מוכנות`;
  if (ready === 0) return coming === 1 ? "שאלה אחת בדרך" : `${coming} שאלות בדרך`;
  return ready === 1 ? `שאלה אחת מוכנה · ${rest}` : `${ready} מוכנות · ${rest}`;
}
/** "להתחיל לפתור (6)". */
export const genStart = (k: number): string => `להתחיל לפתור (${k})`;
/** "3 שאלות לא יצאו" (the button beside it: "לנסות שוב"). */
export const genFailed = (n: number): string => (n === 1 ? "שאלה אחת לא יצאה" : `${n} שאלות לא יצאו`);
/** A 402 in the middle: "הסט נעצר כי התקציב נגמר · 4 שאלות מוכנות". */
export const genBudgetStop = (k: number): string => `הסט נעצר כי התקציב נגמר · ${k === 1 ? "שאלה אחת מוכנה" : `${k} שאלות מוכנות`}`;
/** A tile's name for screen readers: "שאלה 4: בדרך". */
export const genTileLabel = (n: number, state: keyof typeof SETS.gen.tile): string => `שאלה ${n}: ${SETS.gen.tile[state]}`;
/** The ring's live line at each 25%: "6 מתוך 10 מוכנות". */
export const genProgressSaid = (ready: number, total: number): string => `${ready} מתוך ${total} מוכנות`;
/** "6 שאלות חדשות מוכנות · להוסיף לסט" (slice B's toast while solving). */
export const genAddReady = (n: number): string => `${n === 1 ? "שאלה חדשה אחת מוכנה" : `${n} שאלות חדשות מוכנות`} · להוסיף לסט`;
/** "נוספו 4 שאלות לסט". */
export const genAdded = (n: number): string => (n === 1 ? "נוספה שאלה אחת לסט" : `נוספו ${n} שאלות לסט`);
/** "הסט משתנים נעצר באמצע · להמשיך ליצור" (Today's row for the member's own paused set). */
export const genResumeMine = (lecture: string): string => `הסט ${lecture} נעצר באמצע · להמשיך ליצור`;
/** "שקף 12" (a list's slide: never the short "ש׳"). */
export const slideWord = (n: number | string): string => `${SETS.gen.slide} ${n}`;

/** "מאת שוהם · היום 14:20". */
export const setBy = (name: string, when: string): string => `מאת ${name} · ${when}`;
/** The shared link's text: no title, no lecture. */
export const setLinkText = (n: number, url: string): string => `סט תרגול בתמצית · ${questionsWord(n)} ${url}`;
/** "לעבור על השאלות (10)". */
export const setReview = (n: number): string => `לעבור על השאלות (${n})`;
/** "3 שאלות לא נבדקו · לאשר או להסיר". */
export const setUnchecked = (n: number): string => `${n === 1 ? "שאלה אחת לא נבדקה" : `${n} שאלות לא נבדקו`} · לאשר או להסיר`;

/** "פותרים: 4" (works for every k). */
export const statsSolvers = (k: number): string => `פותרים: ${k}`;
/** "ממוצע הקבוצה 7.1/10" (only with at least 3 others). */
export const statsAvg = (x: number, n: number): string => `ממוצע הקבוצה ${x}/${n}`;
/** "שלי: 7/10". */
export const statsMine = (r: number, n: number): string => `שלי: ${r}/${n}`;
/** "מי פתרו: נועה · עומר" (opted-in names, never with scores). */
export const statsNames = (names: readonly string[]): string => `מי פתרו: ${names.join(" · ")}`;

/** A question's place in the set: "שאלה 4". */
export const statsQuestion = (pos: number): string => `שאלה ${pos}`;

/** "בהכנה 6/10". */
export const shelfMaking = (k: number, n: number): string => `בהכנה ${k}/${n}`;
/** "הוסתרו (2)". */
export const shelfHidden = (n: number): string => `הוסתרו (${n})`;
/** "סטים חדשים בקבוצה (2)". */
export const todayRow = (n: number): string => `סטים חדשים בקבוצה (${n})`;
