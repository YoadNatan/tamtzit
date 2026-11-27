import assert from "node:assert/strict";
import { test } from "node:test";
import * as C from "./similarCopy";

/* Similar questions' words on the screens (design-exams §6, release B):
 * pinned, impersonal, no model's name, one word a concept. */

const FORBIDDEN = /שלך|טעית|ענית|אליך|יצרת|ביקשת|העלית|פתרת|לחצת|תוכל|תוכלי/;
const MODELS = /claude|opus|sonnet|haiku|gpt|gemini|deepseek|qwen|kimi|glm|openai|anthropic/i;

const LINES = [
  ...Object.values(C.SIM),
  ...Object.values(C.SIMILAR_FAIL),
  C.simTitle("3א"),
  C.simButton(2, 0.07),
  C.simButton(1, 0.04),
  C.simHave(1),
  C.simHave(3),
  C.simRunning(2),
  C.simRunning(1),
  C.simFigs(1),
  C.simFigs(2),
  C.simResult({ made: 2, dropped: 0, skipped_figs: 0, charged_usd: 0.06, status: "done" }),
  C.twinOf("3א", "תרגיל 3"),
  C.sheetButton(0.47),
  C.sheetOne(14, 0),
  C.sheetOne(24, 3),
  C.sheetMade(1),
  C.sheetMade(14),
];

test("the screens' words, pinned (design §5.10, §5.11, §6)", () => {
  assert.equal(C.SIM.more, "עוד שאלות כמוה");
  assert.equal(C.simTitle("3א"), "שאלות כמו שאלה 3א");
  assert.equal(C.SIM.rule, "אותו נושא ואותה רמה, מקרה חדש.");
  assert.equal(C.simButton(2, 0.07), "ליצור 2 כמוה · כ-$0.10", "never below 10 cents, as every price button");
  assert.equal(C.simButton(1, 0.04), "ליצור עוד אחת כמוה · כ-$0.10", "one more when only one fits under the 6");
  assert.equal(C.simHave(2), "2 שאלות דומות · לתרגל");
  assert.equal(C.simHave(1), "שאלה דומה אחת · לתרגל");
  assert.equal(C.simRunning(2), "יוצרים 2 שאלות ובודקים אותן… · אפשר להמשיך לתרגל");
  assert.equal(C.SIM.joined, "כבר מכינים שאלות כמו זו · יופיעו כאן בעוד כחצי דקה");
  assert.equal(C.twinOf("3א", "תרגיל 3"), "דומה לשאלה 3א בתרגיל 3 · נבדקה");
  assert.equal(C.twinOf("3א", ""), "דומה לשאלה 3א · נבדקה");
  assert.equal(C.sheetButton(0.47), "שאלות דומות לכל הדף · כ-$0.47");
  assert.equal(C.sheetOne(14, 0), "שאלה דומה אחת לכל שאלה (14). זה לוקח כמה דקות; אפשר לסגור.");
  assert.match(C.sheetOne(24, 3), /^שאלה דומה ל-24 השאלות הראשונות שאין להן עדיין דומה/);
  assert.equal(C.SIM.sheetToday, "היום כבר נוצרו שאלות דומות לדף הזה · לתרגל אותן");
  assert.equal(C.sheetMade(14), "נוצרו 14 שאלות דומות · לפתור", "practice sets' word for solving a set");
});

test("a run's end in one line", () => {
  const r = (o: Partial<Parameters<typeof C.simResult>[0]>) => C.simResult({ made: 0, dropped: 0, skipped_figs: 0, charged_usd: 0, status: "done", ...o });
  assert.equal(r({ made: 2 }), "נוצרו 2");
  assert.equal(r({ made: 1, dropped: 1 }), "נוצרה שאלה אחת · אחת לא עברה בדיקה");
  assert.equal(r({ made: 1, dropped: 3 }), "נוצרה שאלה אחת · 3 לא עברו בדיקה");
  assert.equal(r({ made: 2, skipped_figs: 1 }), "נוצרו 2 · שאלה אחת עם איור דולגה (הקישורים לעמודים פגו)");
  assert.equal(r({ made: 0, dropped: 2, charged_usd: 0.06, status: "failed" }), "הפעם אף שאלה לא עברה בדיקה. אפשר לנסות שוב מחר. · עלה כ-$0.10");
  assert.equal(r({ made: 0, status: "stopped" }), C.SIM.stopped, "a switch or the reservation stopped it");
});

test("impersonal and gender-neutral, no model's name", () => {
  for (const line of LINES) {
    assert.ok(!FORBIDDEN.test(line), `second person or a gendered verb: ${line}`);
    assert.ok(!MODELS.test(line), `a model's name: ${line}`);
    assert.ok(!/פתרון מוצע|פותר עיוור/.test(line), `the copy's vocabulary: ${line}`);
  }
});
