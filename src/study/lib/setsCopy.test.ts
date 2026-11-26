import assert from "node:assert/strict";
import { test } from "node:test";
import * as C from "./setsCopy";

/* Practice sets' words (design §6.1): pinned, impersonal, no model's name,
 * never "נקודות" (coverage is a percentage). */

/** Second person and gendered verbs the copy never uses (design §6.1). */
const FORBIDDEN = /שלך|טעית|ענית|אליך|יצרה|יצר |שביקשת|העלית|פתר /;
const MODELS = /claude|opus|sonnet|haiku|gpt|gemini|deepseek|qwen|kimi|glm|openai|anthropic/i;

function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (x && typeof x === "object") for (const v of Object.values(x)) strings(v, out);
  return out;
}

const LINES = [
  ...strings(C.SETS),
  C.makeGo(10),
  C.makeGo(1),
  C.previewHead(10, "משתנים"),
  C.previewCover(89),
  C.previewFree(14),
  C.previewFree(1),
  C.previewDaily(1),
  C.previewDaily(2),
  C.makeBig("$1.10"),
  C.makeOpen("שוהם", 6, 10),
  C.makeRecent("אתמול", 10, "נועה"),
  C.genTitle("משתנים"),
  C.genCount(6, 4),
  C.genCount(1, 9),
  C.genCount(0, 10),
  C.genCount(10, 0),
  C.genStart(6),
  C.genFailed(3),
  C.genBudgetStop(4),
  C.genBudgetStop(0),
  C.genCount(6, 4, true),
  C.genCount(0, 1, true),
  C.genDoneTitle("משתנים"),
  C.statsCounted(3),
  C.todaySolve("משתנים", 10),
  C.makeRecent("12.11", 1, ""),
  C.setFail("set not reading"),
  C.setFail("attempt finished"),
  C.genTileLabel(4, "coming"),
  C.genAddReady(2),
  C.genAdded(1),
  C.genResumeMine("משתנים"),
  C.setBy("שוהם", "היום 14:20"),
  C.setLinkText(10, "https://x.test/?v=sets"),
  C.setUnchecked(1),
  C.statsSolvers(4),
  C.statsAvg(7.1, 10),
  C.statsMine(7, 10),
  C.statsNames(["נועה", "עומר"]),
  C.todayRow(2),
  C.lectureSets(3),
  C.mistakesNew("$0.40"),
];

test("no second person, no gendered verb, no model's name, never 'נקודות'", () => {
  assert.ok(LINES.length > 100);
  for (const s of LINES) {
    assert.doesNotMatch(s, FORBIDDEN, s);
    assert.doesNotMatch(s, MODELS, s);
    assert.doesNotMatch(s, /נקודות|נקודה/, s);
    assert.doesNotMatch(s, /פותר עיוור/, `${s}: "הבדיקה"`);
  }
  assert.match("שאלות שלך", FORBIDDEN, "the pattern is not empty");
});

test("the design's strings, pinned", () => {
  assert.equal(C.SETS.entry, "סט חדש");
  assert.equal(C.SETS.make.title, "סט חדש");
  assert.equal(C.SETS.make.howMany, "כמה שאלות");
  assert.equal(C.SETS.make.more, "עוד אפשרויות");
  assert.equal(C.SETS.make.offline, "אין חיבור כרגע. התצוגה תתעדכן כשהחיבור יחזור.");
  assert.equal(C.SETS.make.loadFail, "המסך לא נטען. כדאי לבדוק את החיבור ולנסות שוב.");
  assert.equal(C.SETS.make.cap, "תקציב השאלות של הקבוצה לחודש הזה נגמר · אפשר לפתור סטים קיימים · מתחדש ב-1 בחודש");
  assert.equal(C.SETS.make.capMine, "החלק האישי בתקציב החודשי נוצל · אפשר לפתור סטים של הקבוצה");
  assert.equal(C.SETS.make.tooBig, "לסט בגודל הזה לא נשאר מספיק תקציב החודש · אפשר סט קטן יותר");
  assert.equal(C.SETS.make.daily, "המכסה היומית של סטים חדשים נוצלה · אפשר שוב מחר");
  assert.equal(C.SETS.make.off, "יצירת שאלות כבויה זמנית · אפשר לפתור סטים קיימים");
  assert.equal(C.SETS.preview.check, "כל שאלה נבדקת לפני שהיא נכנסת לבנק");
  assert.equal(C.SETS.preview.read, "כולל קריאת ההרצאה (פעם אחת לכל הקבוצה)");
  assert.equal(C.SETS.gen.reading, "קוראים את ההרצאה · כ-2 דקות, פעם אחת לכל הקבוצה");
  assert.equal(C.SETS.gen.styleFail, "הדוגמה לא נקראה · השאלות נכתבות בסגנון הרגיל");
  assert.equal(C.SETS.gen.keepOpen, "היצירה רצה מהמכשיר הזה. סגירת האפליקציה עוצרת אותה, ואפשר להמשיך כשחוזרים.");
  assert.equal(C.SETS.gen.offline, "אין חיבור. מה שכבר נטען נשאר כאן.");
  assert.equal(C.SETS.gen.resumeCost, "העלות נרשמת על מי שממשיך");
  assert.equal(C.makeGo(10), "ליצור 10 שאלות");
  assert.equal(C.makeGo(1), "ליצור שאלה אחת");
  assert.equal(C.about("$0.40"), "כ-$0.40");
  assert.equal(C.previewCover(89), "אחרי הסט: 89% מההרצאה מכוסים בבנק");
  assert.equal(C.previewDaily(1), "אפשר ליצור עוד סט אחד היום");
  assert.equal(C.previewDaily(2), "אפשר ליצור עוד 2 סטים היום");
  assert.equal(C.genTitle("משתנים"), "סט בהכנה · משתנים");
  assert.equal(C.genCount(6, 4), "6 מוכנות · עוד 4 בדרך");
  assert.equal(C.genCount(1, 9), "שאלה אחת מוכנה · עוד 9 בדרך");
  assert.equal(C.genCount(9, 1), "9 מוכנות · עוד אחת בדרך");
  assert.equal(C.genCount(0, 10), "10 שאלות בדרך");
  assert.equal(C.genCount(10, 0), "10 שאלות מוכנות");
  assert.equal(C.genStart(6), "להתחיל לפתור (6)");
  assert.equal(C.genFailed(3), "3 שאלות לא יצאו");
  assert.equal(C.genBudgetStop(4), "הסט נעצר כי התקציב נגמר · 4 שאלות מוכנות");
  assert.equal(C.genTileLabel(4, "coming"), "שאלה 4: בדרך");
  assert.equal(C.slideWord(12), "שקף 12");
  assert.equal(C.setLinkText(10, "U"), "סט תרגול בתמצית · 10 שאלות U", "no title, no lecture");
  assert.equal(C.statsSolvers(1), "פותרים: 1");
  // The entry points (WP14).
  assert.equal(C.todayRow(2), "סטים חדשים בקבוצה (2)");
  assert.equal(C.SETS.today.solveNew, "לפתור סט חדש");
  assert.equal(C.genResumeMine("משתנים"), "הסט על ״משתנים״ נעצר באמצע · להמשיך ליצור");
  // The review's fixes: a stopped set never says "בדרך"; a budget stop at 0 says only that; the done title.
  assert.equal(C.genCount(6, 4, true), "6 מוכנות · 4 עוד לא נכתבו");
  assert.equal(C.genCount(0, 5, true), "5 שאלות עוד לא נכתבו");
  assert.equal(C.genBudgetStop(0), "הסט נעצר כי התקציב נגמר");
  assert.equal(C.genDoneTitle("משתנים"), "הסט מוכן · משתנים");
  assert.equal(C.makeRecent("אתמול", 10, "נועה"), "יש סט מאתמול על ההרצאה · 10 שאלות · מאת נועה");
  assert.equal(C.makeRecent("12.11", 10, "נועה"), "יש סט מ-12.11 על ההרצאה · 10 שאלות · מאת נועה");
  assert.equal(C.todaySolve("משתנים", 10), "לפתור: משתנים · 10 שאלות");
  assert.equal(C.SETS.make.custom, "מספר אחר (עד 40)");
  assert.equal(C.setFail("set not found"), "הסט לא נמצא. אולי נמחק.");
  assert.equal(C.lectureSets(3), "סטים על ההרצאה (3)");
  assert.equal(C.mistakesNew("$0.40"), "שאלות חדשות על הטעויות · כ-$0.40");
  assert.equal(C.SETS.me.names, C.SETS.stats.optin, "the same words in שלי as at the round's end");
});
