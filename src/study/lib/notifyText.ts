/* ── The words of the notifications' screens (section R; DECISIONS-2026-11-26.md) ──
 * The bell, the inbox ("התראות", ?v=notify) and the settings
 * ("הגדרות התראות", ?v=notify&x=set). A notice's own title and body are not
 * here: shared/study/notifyCopy.ts writes them, for the lock screen and the
 * inbox alike. Impersonal or plural throughout (docs/study/COPY.md); only
 * lazy modules import this file, so none of it is in the study entry chunk.
 * notifyText.test.ts pins every line. The phones' own menu words come from
 * installCopy.ts OS (unchecked on a device until the owner's screenshots). */

import { OS } from "./installCopy";

export const NT = {
  me: {
    row: "הגדרות התראות",
    state: { on: "פועלות ✓", off: "כבויות", denied: "חסומות", here: "לא במכשיר הזה" },
  },
  set: { title: "הגדרות התראות", back: "→ להתראות" },
  device: {
    h: "במכשיר הזה",
    on: "ההתראות פועלות במכשיר הזה ✓",
    ask: "אפשר לקבל התראה כשמבחן קבוצתי נפתח, כשהפגישה מתחילה וכשמה שהעלית מוכן. רק מה שמסומן כאן למטה.",
    enable: "להפעיל התראות במכשיר הזה",
    enabling: "מפעילים…",
    enabledToast: "ההתראות פועלות: ",
    test: "שליחת התראת ניסיון",
    testToast: "ההתראה תגיע בעוד כמה שניות. אפשר לנעול את המסך או לצאת מהאפליקציה.",
    testDesktop: "לא הגיעה? כדאי לבדוק שההתראות של הדפדפן מותרות בהגדרות המחשב.",
    iosInstall: "באייפון, התראות מגיעות רק כשפותחים את תמצית מהאייקון במסך הבית.",
    iosInstallBtn: "להוספה למסך הבית",
    iosInstallHas: "כבר יש אייקון? פותחים ממנו ומפעילים כאן.",
    unsupported: "הדפדפן הזה לא תומך בהתראות. הכל מופיע ברשימת ההתראות.",
    denied: "ההתראות חסומות במכשיר הזה.",
    broken: "ההרשמה להתראות לא הצליחה.",
    retry: "לנסות שוב",
    offline: "אין חיבור. אפשר לנסות שוב כשהחיבור חוזר.",
    testMany: "אפשר לשלוח עד 3 התראות ניסיון בשעה. אפשר לנסות שוב מאוחר יותר.",
  },
  cats: {
    h: "מה שולחים",
    live: { title: "עכשיו בקבוצה", desc: "מבחן קבוצתי שנפתח, פגישה שמתחילה, מפגש למידה" },
    mine: { title: "בשבילך", desc: "תשובות אליך, תרגול ששיתפו איתך, ומה שהעלית כשהוא מוכן" },
    digest: { title: "תזכורת יומית", desc: "פעם ביום: מה מחכה לחזרה היום" },
    digestAt: "בשעה",
    security: "כניסה עם הקוד האישי תמיד שולחת התראה.",
    disabled: "יחולו כשההתראות יופעלו באחד המכשירים.",
    all: "ההגדרות חלות על כל המכשירים שלך.",
  },
  quiet: {
    h: "מתי לא לשלוח",
    night: "לא לשלוח בלילה",
    from: "מ-",
    to: "עד",
    note: "מה שמגיע בשעות האלה מחכה ברשימת ההתראות.",
    change: "לשנות שעות",
    fromAria: "תחילת שעות השקט",
    toAria: "סוף שעות השקט",
    shabbat: "לא לשלוח בשבת",
    shabbatNote: "משישי 16:00 עד מוצאי שבת 20:30",
  },
  devices: { h: "המכשירים שמקבלים התראות", this: "המכשיר הזה", remove: "להסיר" },
  inbox: {
    title: "התראות",
    gearAria: "הגדרות התראות",
    new: "חדש",
    today: "היום",
    earlier: "קודם",
    empty: "אין התראות חדשות. כשמשהו יקרה בקבוצה, הוא יופיע כאן.",
    fail: "לא הצלחנו לטעון את ההתראות.",
    retry: "לנסות שוב",
    more: "עוד",
    ended: "הסתיים",
    results: "לתוצאות",
    offBar: "ההתראות לא פועלות במכשיר הזה.",
    offBarBtn: "להפעיל",
    now: "עכשיו",
  },
  ask: {
    homeH: "תמצית פתוחה מהאייקון ✓",
    home: "עכשיו אפשר גם לקבל התראות: כשמבחן קבוצתי נפתח, כשעונים בשרשור שלך וכשהסיכום מוכן.",
    upload: "להודיע כשהסיכום מוכן?",
    uploadMore: "אפשר לבחור מה מקבלים בשלי ← הגדרות התראות.",
    yes: "להפעיל התראות",
    no: "לא עכשיו",
  },
  quiz: { notify: "להודיע לקבוצה", desc: "התראה לחברי הקבוצה כשהמבחן נפתח" },
  guideS10: "לקבל התראות",
  help: { row: "התראות", text: "מה שולחים, איך מפעילים, ולמה באייפון רק מהאייקון", howto: "להפעיל התראות" },
  errSave: "לא הצלחנו לשמור. אפשר לנסות שוב.",
} as const;

/** iOS before 16.4 in the home-screen app: the way to a newer iOS. */
export function iosOld(): string {
  return `צריך iOS 16.4 ומעלה כדי לקבל התראות (${OS.iosSettings} ← ${OS.iosGeneral} ← ${OS.iosUpdate}). עד אז הכל מופיע ברשימת ההתראות.`;
}

/** Another app's built-in browser: the real browser to open תמצית in. */
export function inApp(app: "facebook" | "instagram" | "other", ios: boolean): string {
  const name = app === "facebook" ? "פייסבוק" : app === "instagram" ? "אינסטגרם" : "האפליקציה הזאת";
  return `בדפדפן של ${name} אין התראות. פותחים את תמצית ב${ios ? OS.safari : OS.chrome}.`;
}

/** Blocked: where to allow them again, on an iPhone and in Chrome. */
export function deniedIos(): string {
  return `באייפון: ${OS.iosSettings} ← ${OS.iosNotifications} ← תמצית ← ${OS.iosAllow}. אחר כך חוזרים לכאן.`;
}
export function deniedChrome(): string {
  return `ב${OS.chrome}: הסמל שליד הכתובת ← ${OS.chromeSiteSettings} ← ${OS.chromeNotifications} ← לאפשר. אחר כך חוזרים לכאן.`;
}

/** The toast after turning pushes on: what this device will get, from the switches. */
export function enabledToast(p: { live: boolean; mine: boolean; digest: boolean }): string {
  const parts = [p.live && "מבחן קבוצתי", p.mine && "תשובות אליך", p.mine && "מה שהעלית כשהוא מוכן", p.digest && "תזכורת יומית"].filter(Boolean) as string[];
  if (!parts.length) return "ההתראות פועלות במכשיר הזה. כל הסוגים כבויים כרגע.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, ו${parts[parts.length - 1]}`;
  return `${NT.device.enabledToast}${list}.`;
}

const KIND: Record<string, string> = { iphone: "אייפון", ipad: "אייפד", android: "אנדרואיד" };
const BROWSER: Record<string, string> = { Chrome: OS.chrome, Safari: OS.safari, Firefox: "פיירפוקס", Edge: "אדג׳", Samsung: "סמסונג", Opera: "אופרה" };

/** A device in the list: "אייפון", or "מחשב · כרום" (a computer says its browser). */
export function deviceName(device: string, browser: string): string {
  if (KIND[device]) return KIND[device];
  const b = BROWSER[browser];
  return b ? `מחשב · ${b}` : "מחשב";
}

/** "d.m" of an instant, in Israel. */
export function dayMonth(ms: number): string {
  const [, m, d] = israelDate(ms).split("-").map(Number);
  return `${d}.${m}`;
}

/** The half hours from `from` to `to` ("HH:MM", both included). */
export function halfHours(from = "00:00", to = "23:30"): string[] {
  const out: string[] = [];
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  for (let m = min(from); m <= min(to); m += 30) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
}

/** The bell's name for a screen reader, with the count of new notices. */
export function bellLabel(n: number): string {
  if (n <= 0) return "התראות";
  if (n === 1) return "התראות, אחת חדשה";
  return `התראות, ${n} חדשות`;
}

/** The count on the bell: 1-9, then "9+"; nothing at 0. */
export function bellCount(n: number): string {
  return n <= 0 ? "" : n > 9 ? "9+" : String(n);
}

/** "לא לשלוח בלילה (23:00–07:30)": the times are left to right in the screen (bdi). */
export function quietRow(from: string, to: string): string {
  return `${NT.quiet.night} (${from}–${to})`;
}

/** "מאז 26.11" (a device's first day). */
export function since(dm: string): string {
  return `מאז ${dm}`;
}

const TZ = "Asia/Jerusalem";
const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DATE = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** An instant's day in Israel, "YYYY-MM-DD". */
export function israelDate(ms: number): string {
  return DATE.format(new Date(ms));
}

/** A row's time: "עכשיו" in the first minute, "לפני {m} ד׳" within the hour,
 *  "HH:MM" earlier today, "d.m" before today (Israel time). */
export function rowTime(ms: number, now: number): string {
  const ago = now - ms;
  if (ago < 60_000) return NT.inbox.now;
  if (ago < 3_600_000) return `לפני ${Math.floor(ago / 60_000)} ד׳`;
  if (israelDate(ms) === israelDate(now)) return CLOCK.format(new Date(ms));
  const [, m, d] = israelDate(ms).split("-").map(Number);
  return `${d}.${m}`;
}
