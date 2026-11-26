/* ── The words of the install flow (docs/study/install.md) ──
 * Gender-neutral (plural or impersonal), short, as docs/study/COPY.md asks.
 *
 * OS holds every label a phone's own menus show. NONE of them was checked on
 * a device: they are written from English-language sources. When the owner
 * sends Hebrew screenshots (iPhone on iOS 26, Android Chrome, Samsung
 * Internet), correct them here and nowhere else: every line below, help's
 * row and the guide's how-to are built from them. */

export const OS = {
  /** Apple's browser, as the app names it. */
  safari: "ספארי",
  /** iOS: Safari's share sheet ("Share"). */
  iosShare: "שיתוף",
  /** iOS 26: the button beside the address in Safari's compact bar ("⋯"). */
  iosMore: "⋯",
  /** iOS: the share sheet's row ("Add to Home Screen"). */
  iosAddToHome: "הוספה למסך הבית",
  /** iOS: the add sheet's button, top corner ("Add"). */
  iosAdd: "הוספה",
  /** Another app's built-in browser: its menu's way out ("Open in browser"). */
  openInBrowser: "פתיחה בדפדפן",
  /** Google's browser on Android. */
  chrome: "כרום",
  /** Android Chrome: the menu button and its two rows ("Install app", "Add to Home screen"). */
  androidMenu: "⋮",
  androidInstall: "התקנת אפליקציה",
  androidAddToHome: "הוספה למסך הבית",
  /** Samsung Internet: the menu button and its rows ("Add page to" → "Home screen"). */
  samsungMenu: "☰",
  samsungAddPageTo: "הוספת דף אל",
  samsungHome: "מסך הבית",
  /** Android: a Chrome Custom Tab's menu row (a link opened from Gmail or Telegram: "Open in Chrome"). */
  androidOpenInChrome: "פתיחה ב-Chrome",
  /** Notifications (section R): iOS's Settings app, its "Notifications" list, a web app's "Allow Notifications", */
  iosSettings: "הגדרות",
  iosNotifications: "עדכונים",
  iosAllow: "אפשר עדכונים",
  /** …and the way to a newer iOS ("General" → "Software Update"). */
  iosGeneral: "כללי",
  iosUpdate: "עדכון תוכנה",
  /** Chrome: the page's site settings (from the icon beside the address) and their "Notifications" row. */
  chromeSiteSettings: "הגדרות אתר",
  chromeNotifications: "התראות",
} as const;

/** The app's own entry on the join screen (components/Join.tsx). */
export const CODE_ENTRY = "כניסה עם הקוד האישי";

const q = (s: string) => `״${s}״`;

export const INSTALL = {
  title: "תמצית במסך הבית",
  intro: "ככה תמצית נפתחת מאייקון, כמו אפליקציה. לוקח חצי דקה.",

  // Step 1 on an iPhone: the code, because the icon starts without this sign-in.
  codeTitle: "1. מעתיקים את הקוד האישי",
  codeLine: "האייקון נפתח בלי הכניסה מכאן. הקוד מחזיר לקבוצה עם כל ההתקדמות.",
  codeCopy: "העתקת הקוד",
  codeCopied: "הקוד הועתק ✓",
  codeByHand: "לא הצלחנו להעתיק. זה הקוד, אפשר לרשום אותו:",
  codeNone: "עוד אין קוד אישי. יוצרים אותו כאן, ואז מעתיקים.",
  codeMake: "יצירת קוד אישי",
  codeElsewhere: "הקוד האישי לא שמור במכשיר הזה. מעתיקים אותו מההודעה שנשמרה, או יוצרים קוד חדש.",
  codeNew: "קוד חדש",
  codeNewAsk: "ליצור קוד חדש? הקוד הקודם יפסיק לעבוד. מכשירים שכבר מחוברים יישארו מחוברים.",
  codeNewYes: "יצירה",
  cancel: "ביטול",
  codeOff: "באייפון האייקון נפתח בלי הכניסה מכאן, ושם נכנסים שוב לקבוצה.",
  codeOffTitle: "1. לפני ההוספה",
  codeLabel: "הקוד האישי",

  // Step 2 on an iPhone: Safari's share sheet.
  shareTitle: `2. ${OS.iosShare} ← ${OS.iosAddToHome}`,
  // "בפס של ספארי נוגעים ב־[⋯] ואז ב״שיתוף״.": the picture of "⋯" sits between the two.
  shareMoreBefore: `בפס של ${OS.safari} נוגעים ב־`,
  shareMoreAfter: ` ואז ב${q(OS.iosShare)}.`,
  shareIconAlso: "הסמל כבר בפס? נוגעים בו ישר:",
  shareIcon: `נוגעים בסמל ה${OS.iosShare} בפס של ${OS.safari}:`,
  shareScroll: `גוללים מטה ובוחרים ${q(OS.iosAddToHome)}.`,
  shareMissing: `אין ${q(OS.iosAddToHome)}? כנראה זה לא ${OS.safari}. פותחים ב${OS.safari} (סמל המצפן) ומנסים שוב.`,
  shareOther: `נוגעים בסמל ה${OS.iosShare} (בשורת הכתובת או בתפריט) ובוחרים ${q(OS.iosAddToHome)}. לא מוצאים? פותחים ב${OS.safari}.`,

  // Step 3 on an iPhone: add, then the icon.
  addTitle: `3. ${q(OS.iosAdd)}, ואז פותחים מהאייקון`,
  // iOS 26 (and a browser whose version is unknown) may show an "Open as Web App" switch; older iOS has none.
  addSwitch: "אם בחלון יש מתג, משאירים אותו דלוק.",
  addLine: `באייקון בוחרים ${q(CODE_ENTRY)} ומדביקים את הקוד.`,
  addLineOff: `נוגעים ב${q(OS.iosAdd)} ופותחים מהאייקון.`,
  said: "הוספתי",
  saidDone: `מעכשיו נכנסים מהאייקון. אפשר לסגור את הלשונית ב${OS.safari}.`,
  saidDoneAndroid: "מעכשיו נכנסים מהאייקון.",

  // Another app's built-in browser.
  inAppTitle: (browser: string) => `פותחים ב${browser}`,
  inAppLine: "כאן, בתוך אפליקציה אחרת, אי אפשר להוסיף למסך הבית.",
  inAppMember: (browser: string) => `ב${browser} מדביקים את הקוד שהועתק ב${q(CODE_ENTRY)}, ומשם מוסיפים למסך הבית.`,
  openIn: (browser: string) => `פתיחה ב${browser}`,
  copyLink: "העתקת הקישור",
  linkCopied: (browser: string) => `הקישור הועתק. מדביקים אותו ב${browser}.`,
  linkByHand: "לא הצלחנו להעתיק. אפשר לסמן את הקישור ולהעתיק:",
  inAppFallback: (ios: boolean) => `לא נפתח? בתפריט של האפליקציה (${ios ? OS.iosMore : OS.androidMenu}) בוחרים ${q(OS.openInBrowser)}.`,

  // Android and computers.
  promptTitle: "התקנה בלחיצה",
  promptLine: "תמצית תופיע במסך הבית. נשארים מחוברים, בלי קוד.",
  install: "התקנה",
  accepted: "הותקנה ✓ אפשר לפתוח מהאייקון.",
  dismissed: "אפשר להתקין גם אחר כך, מכאן.",
  menuTitle: "מהתפריט של הדפדפן",
  chromeMenu: `בתפריט ${OS.androidMenu} בוחרים ${q(OS.androidInstall)} או ${q(OS.androidAddToHome)}.`,
  // A link opened from Gmail or Telegram runs in a Custom Tab: plain Chrome to detect(), with no install rows.
  chromeTab: `אין את זה בתפריט? בוחרים קודם ${q(OS.androidOpenInChrome)}.`,
  samsungMenu: `בתפריט ${OS.samsungMenu} בוחרים ${q(OS.samsungAddPageTo)} ← ${q(OS.samsungHome)}. או נוגעים בסמל ההתקנה שבשורת הכתובת.`,
  otherMenu: `בתפריט של הדפדפן בוחרים ${q(OS.androidAddToHome)} או ${q("התקנה")}.`,
  androidSafety: `נפתח מסך הצטרפות באייקון? בוחרים ${q(CODE_ENTRY)}. הקוד נמצא ב״שלי״, כאן בדפדפן.`,
  desktopTitle: "התקנה במחשב",
  desktopLine: "תמצית נפתחת בחלון משלה, כמו תוכנה.",
  desktopNone: "במחשב אפשר פשוט להמשיך בדפדפן.",

  // In the app itself.
  standalone: "תמצית כבר פתוחה מהאייקון ✓",

  // "שלי".
  rowTitle: "להוסיף את תמצית למסך הבית",
  rowSub: "נפתחת מאייקון, כמו אפליקציה.",
  rowStandalone: "תמצית פתוחה מהאייקון ✓",
  rowDone: "נוסף ✓",

  // The home's card.
  cardTitle: "תמצית במסך הבית",
  cardLine: "פותחים מאייקון, כמו אפליקציה. חצי דקה.",
  cardHow: "איך מוסיפים",
  cardLater: "לא עכשיו",
  cardLaterSaid: "אפשר להוסיף מתי שרוצים: ״שלי״ ← להוסיף את תמצית למסך הבית.",

  // The join screen.
  joinInApp: (browser: string, app: string) => `הקישור נפתח בתוך ${app}. עדיף לפתוח ב${browser} ולהצטרף שם.`,
  /** The other app, by name when the browser says it. */
  appName: (app: "facebook" | "instagram" | "other") => (app === "instagram" ? "אינסטגרם" : app === "facebook" ? "פייסבוק" : "אפליקציה אחרת"),
  joinIos: "אחרי ההצטרפות אפשר להוסיף את תמצית למסך הבית. מסבירים בפנים.",

  // What a screen reader hears for the pictures.
  ariaShare: `סמל ה${OS.iosShare}`,
  ariaMore: "כפתור שלוש הנקודות",
  ariaAddToHome: `${OS.iosAddToHome}`,
} as const;

/** Help's row: where it is, and the iPhone's steps. */
export function installHelp(codes: boolean): string {
  return [
    `שלי ← ${q(INSTALL.rowTitle)}: ההסבר מותאם לטלפון.`,
    codes
      ? `באייפון: מעתיקים את הקוד האישי, ${OS.iosShare} ← ${OS.iosAddToHome}, ובאייקון ${q(CODE_ENTRY)} ומדביקים את הקוד.`
      : `באייפון: ${OS.iosShare} ← ${OS.iosAddToHome}.`,
    "באנדרואיד ובמחשב: ״התקנה״, ונשארים מחוברים.",
    "הבחירה כאן (נוסף או לא עכשיו) נשמרת רק במכשיר הזה, ושום דבר לא נשלח.",
  ].join(" ");
}

/** The guide's how-to answer. */
export function installHowTo(): string {
  return `שלי ← ${q(INSTALL.rowTitle)}. באייפון: מעתיקים את הקוד האישי, ${OS.iosShare} ← ${OS.iosAddToHome}, ובאייקון מדביקים את הקוד.`;
}
