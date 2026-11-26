import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { bellCount, bellLabel, dayMonth, deniedAndroidApp, deniedChrome, deniedIos, deniedOther, deniedWords, deviceName, enabledToast, halfHours, inApp, iosOld, israelDate, NT, quietRow, rowTime, since } from "./notifyText";

/* The notifications' screen words (section R, the design's §6.2), pinned:
 * a change to a line is a change to this test too. */

const flat = (o: unknown, at = ""): Array<[string, string]> =>
  typeof o === "string" ? [[at, o]] : Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, at ? `${at}.${k}` : k));

test("every line, as the design's table writes it", () => {
  assert.deepEqual(Object.fromEntries(flat(NT)), {
    "me.row": "הגדרות התראות",
    "me.state.on": "פועלות ✓",
    "me.state.off": "כבויות",
    "me.state.denied": "חסומות",
    "me.state.here": "לא במכשיר הזה",
    "set.title": "הגדרות התראות",
    "set.back": "→ להתראות",
    "device.h": "במכשיר הזה",
    "device.on": "ההתראות פועלות במכשיר הזה ✓",
    "device.ask": "אפשר לקבל התראה כשמבחן קבוצתי נפתח, כשהפגישה מתחילה וכשמה שהעלית מוכן. רק מה שמסומן כאן למטה.",
    "device.enable": "להפעיל התראות במכשיר הזה",
    "device.enabling": "מפעילים…",
    "device.enabledToast": "ההתראות פועלות: ",
    "device.test": "שליחת התראת ניסיון",
    "device.testToast": "ההתראה תגיע בעוד כמה שניות. אפשר לנעול את המסך או לצאת מהאפליקציה.",
    "device.testDesktop": "לא הגיעה? כדאי לבדוק שההתראות של הדפדפן מותרות בהגדרות המחשב.",
    "device.iosInstall": "באייפון, התראות מגיעות רק כשפותחים את תמצית מהאייקון במסך הבית.",
    "device.iosInstallIpad": "באייפד, התראות מגיעות רק כשפותחים את תמצית מהאייקון במסך הבית.",
    "device.iosInstallBtn": "להוספה למסך הבית",
    "device.iosInstallHas": "כבר יש אייקון? פותחים ממנו ומפעילים כאן.",
    "device.unsupported": "הדפדפן הזה לא תומך בהתראות. הכל מופיע ברשימת ההתראות.",
    "device.denied": "ההתראות חסומות במכשיר הזה.",
    "device.broken": "ההרשמה להתראות לא הצליחה.",
    "device.retry": "לנסות שוב",
    "device.offline": "אין חיבור. אפשר לנסות שוב כשהחיבור חוזר.",
    "device.testMany": "אפשר לשלוח עד 3 התראות ניסיון בשעה. אפשר לנסות שוב מאוחר יותר.",
    "device.testWait": "אפשר לשלוח שוב בעוד כמה שניות.",
    "cats.h": "מה שולחים",
    "cats.live.title": "עכשיו בקבוצה",
    "cats.live.desc": "מבחן קבוצתי שנפתח, פגישה שמתחילה, מפגש למידה",
    "cats.mine.title": "בשבילך",
    "cats.mine.desc": "תשובות בשרשורים שלך, תרגול ששיתפו איתך ומה שהעלית כשהוא מוכן",
    "cats.digest.title": "תזכורת יומית",
    "cats.digest.desc": "פעם ביום: מה מחכה לחזרה היום",
    "cats.digestAt": "בשעה",
    "cats.security": "כניסה עם הקוד האישי תמיד שולחת התראה למכשירים שבהם ההתראות פועלות.",
    "cats.disabled": "יחולו כשההתראות יופעלו באחד המכשירים.",
    "cats.all": "ההגדרות חלות על כל המכשירים שלך.",
    "quiet.h": "מתי לא לשלוח",
    "quiet.night": "לא לשלוח בלילה",
    "quiet.from": "מ-",
    "quiet.to": "עד",
    "quiet.note": "מה שמגיע בשעות האלה מחכה ברשימת ההתראות.",
    "quiet.change": "לשנות שעות",
    "quiet.fromAria": "תחילת שעות השקט",
    "quiet.toAria": "סוף שעות השקט",
    "quiet.shabbat": "לא לשלוח בשבת",
    "quiet.shabbatNote": "משישי 16:00 עד מוצאי שבת 20:30",
    "devices.h": "המכשירים שמקבלים התראות",
    "devices.this": "המכשיר הזה",
    "devices.remove": "להסיר",
    "devices.removeAria": "להסיר: ",
    "inbox.title": "התראות",
    "inbox.gearAria": "הגדרות התראות",
    "inbox.new": "חדש",
    "inbox.today": "היום",
    "inbox.earlier": "קודם",
    "inbox.empty": "אין התראות חדשות. כשמשהו יקרה בקבוצה, הוא יופיע כאן.",
    "inbox.fail": "לא הצלחנו לטעון את ההתראות.",
    "inbox.retry": "לנסות שוב",
    "inbox.more": "עוד",
    "inbox.ended": "הסתיים",
    "inbox.results": "לתוצאות",
    "inbox.offBar": "ההתראות לא פועלות במכשיר הזה.",
    "inbox.offBarBtn": "להפעיל",
    "inbox.now": "עכשיו",
    "ask.homeH": "תמצית פתוחה מהאייקון ✓",
    "ask.home": "עכשיו אפשר גם לקבל התראות: כשמבחן קבוצתי נפתח, כשעונים בשרשור שלך וכשהסיכום מוכן.",
    "ask.upload": "להודיע כשהסיכום מוכן?",
    "ask.uploadMore": "אפשר לבחור מה מקבלים בשלי ← הגדרות התראות.",
    "ask.yes": "להפעיל התראות",
    "ask.no": "לא עכשיו",
    "quiz.notify": "להודיע לקבוצה",
    "quiz.desc": "התראה לחברי הקבוצה כשהמבחן נפתח",
    guideS10: "לקבל התראות",
    "help.row": "התראות",
    "help.text": "מה שולחים, איך מפעילים ולמה באייפון רק מהאייקון",
    "help.howto": "להפעיל התראות",
    errSave: "לא הצלחנו לשמור. אפשר לנסות שוב.",
  });
});

test("the bell: its name for a screen reader and its count", () => {
  assert.equal(bellLabel(0), "התראות");
  assert.equal(bellLabel(1), "התראות, אחת חדשה");
  assert.equal(bellLabel(2), "התראות, 2 חדשות");
  assert.equal(bellLabel(11), "התראות, 11 חדשות");
  assert.equal(bellCount(0), "");
  assert.equal(bellCount(1), "1");
  assert.equal(bellCount(9), "9");
  assert.equal(bellCount(10), "9+");
  assert.equal(bellCount(99), "9+");
  assert.equal(quietRow("23:00", "07:30"), "לא לשלוח בלילה (מ-23:00 עד 07:30)");
  assert.equal(since("26.11"), "מאז 26.11");
});

test("a row's time: now, minutes, today's clock, an earlier day (Israel time)", () => {
  const now = Date.parse("2026-11-26T10:00:00Z"); // 12:00 in Israel
  assert.equal(rowTime(now - 10_000, now), "עכשיו");
  assert.equal(rowTime(now - 70_000, now), "לפני דקה");
  assert.equal(rowTime(now - 20 * 60_000, now), "לפני 20 דק׳");
  assert.equal(rowTime(now - 59 * 60_000, now), "לפני 59 דק׳");
  assert.equal(rowTime(Date.parse("2026-11-26T07:12:00Z"), now), "09:12");
  assert.equal(rowTime(Date.parse("2026-11-25T21:30:00Z"), now), "25.11", "23:30 on the 25th in Israel is yesterday");
  assert.equal(rowTime(Date.parse("2026-11-25T22:30:00Z"), now), "00:30", "00:30 on the 26th in Israel is today");
  assert.equal(rowTime(Date.parse("2026-11-24T08:00:00Z"), now), "24.11");
  assert.equal(israelDate(Date.parse("2026-11-25T22:30:00Z")), "2026-11-26");
});

test("the settings' built lines: an old iOS, another app's browser, blocked, the toast, the devices, the hours", () => {
  assert.equal(iosOld(), "צריך iOS 16.4 ומעלה כדי לקבל התראות (הגדרות ← כללי ← עדכון תוכנה). עד אז הכל מופיע ברשימת ההתראות.");
  assert.equal(inApp("instagram", true), "בדפדפן של אינסטגרם אין התראות. פותחים את תמצית בספארי.");
  assert.equal(inApp("facebook", false), "בדפדפן של פייסבוק אין התראות. פותחים את תמצית בכרום.");
  assert.equal(inApp("other", false), "בדפדפן של האפליקציה הזאת אין התראות. פותחים את תמצית בכרום.");
  assert.equal(deniedIos(), "באייפון: הגדרות ← עדכונים ← תמצית ← אפשר עדכונים. אחר כך חוזרים לכאן.");
  assert.equal(deniedIos(true), "באייפד: הגדרות ← עדכונים ← תמצית ← אפשר עדכונים. אחר כך חוזרים לכאן.");
  assert.equal(deniedChrome(), "בכרום: הסמל שליד הכתובת ← הגדרות אתר ← התראות ← לאפשר. אחר כך חוזרים לכאן.");
  assert.equal(deniedAndroidApp(), "באנדרואיד: לחיצה ארוכה על האייקון של תמצית ← פרטי האפליקציה ← התראות ← לאפשר. אחר כך חוזרים לכאן.");
  assert.equal(deniedOther(), "בהגדרות האתר בדפדפן ← התראות ← לאפשר. אחר כך חוזרים לכאן.");
  // Which one, by device and browser (deviceOf's names) and whether it is the home-screen app.
  assert.equal(deniedWords({ device: "iphone", browser: "Safari", app: true }), deniedIos());
  assert.equal(deniedWords({ device: "ipad", browser: "Safari", app: true }), deniedIos(true), "the iPad's app (a Mac's user agent, with touch)");
  assert.equal(deniedWords({ device: "android", browser: "Chrome", app: true }), deniedAndroidApp(), "no address bar in the app");
  assert.equal(deniedWords({ device: "android", browser: "Chrome", app: false }), deniedChrome());
  assert.equal(deniedWords({ device: "windows", browser: "Chrome", app: false }), deniedChrome());
  for (const b of ["Safari", "Firefox", "Edge", "Samsung", ""]) assert.equal(deniedWords({ device: b === "Samsung" ? "android" : "mac", browser: b, app: false }), deniedOther(), b);
  assert.equal(deniedWords({ device: "windows", browser: "Chrome", app: true }), deniedOther(), "a computer's installed app: the browser's own settings");
  assert.equal(enabledToast({ live: true, mine: true, digest: false }), "ההתראות פועלות: מבחן קבוצתי, תשובות בשרשורים שלך ומה שהעלית כשהוא מוכן.");
  assert.equal(enabledToast({ live: true, mine: true, digest: true }), "ההתראות פועלות: מבחן קבוצתי, תשובות בשרשורים שלך, מה שהעלית כשהוא מוכן ותזכורת יומית.");
  assert.equal(enabledToast({ live: true, mine: false, digest: false }), "ההתראות פועלות: מבחן קבוצתי.");
  assert.equal(enabledToast({ live: false, mine: false, digest: false }), "ההתראות פועלות במכשיר הזה. כל הסוגים כבויים כרגע.");
  assert.equal(deviceName("iphone", "Safari"), "אייפון");
  assert.equal(deviceName("android", "Chrome"), "אנדרואיד");
  assert.equal(deviceName("mac", "Chrome"), "מחשב · כרום");
  assert.equal(deviceName("windows", "Edge"), "מחשב · אדג׳");
  assert.equal(deviceName("other", ""), "מחשב");
  assert.equal(dayMonth(Date.parse("2026-11-25T22:30:00Z")), "26.11");
  assert.equal(quietRow("23:00", "07:30"), "לא לשלוח בלילה (מ-23:00 עד 07:30)");
  const day = halfHours("06:00", "22:00");
  assert.equal(day.length, 33);
  assert.deepEqual([day[0], day[1], day[day.length - 1]], ["06:00", "06:30", "22:00"]);
  assert.equal(halfHours().length, 48);
});

test("no gendered forms; the words COPY.md gives the inbox", () => {
  const built = [iosOld(), inApp("instagram", true), deniedIos(), deniedIos(true), deniedChrome(), deniedAndroidApp(), deniedOther(), enabledToast({ live: true, mine: true, digest: true })];
  const text = [...flat(NT).map(([, v]) => v), ...built].join(" ");
  // "אליך" reads as masculine in full spelling: neither form.
  assert.ok(!/אליך|אלייך/.test(text), "אליך");
  // No comma before the last item's ו.
  assert.ok(!/, ו/.test(text), "a comma before ו");
  for (const w of [/(^|\s)אתה(\s|$)/, /לחצי|לחץ(\s|$)/, /תוכלי|תוכל(\s|$)/, /היכנסי|היכנס(\s|$)/, /מוזמנ/, /(^|\s)בואי?(\s|$)/, /הפעילי|הפעל(\s|$)/]) {
    assert.ok(!w.test(text), `${w}`);
  }
  const copy = readFileSync(join(process.cwd(), "docs", "study", "COPY.md"), "utf8");
  const notify = copy.slice(copy.indexOf("### New words: notifications"));
  for (const w of [NT.inbox.title, NT.set.back, NT.inbox.empty, NT.inbox.fail, NT.inbox.ended, NT.inbox.results, NT.inbox.new, NT.inbox.more])
    assert.ok(notify.includes(w), `COPY.md has "${w}"`);
});
