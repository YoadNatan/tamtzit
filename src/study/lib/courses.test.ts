import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { CourseContext } from "./courses";

// api.ts (which courses.ts imports) reads Vite's import.meta.env; bundled into
// this one file it shares this module's import.meta, set before the first
// evaluation: no Supabase here (nothing in these tests calls it).
(import.meta as unknown as { env: Record<string, string> }).env = {};
let C: typeof import("./courses");
before(async () => {
  C = await import("./courses");
});

const CTX: CourseContext = {
  chosen: 3,
  total: 340,
  lectures: [
    { n: 2, id: "l2", title: "משתנים" },
    { n: 7, id: "l7", title: "כולינרגיים" },
  ],
  paragraphs: [
    { lecture: 7, part: 1, anchor: 3, slides: [14, 15] },
    { lecture: 7, part: 2, anchor: 0, slides: [20] },
    { lecture: 2, part: 0, anchor: 4, slides: [3] },
  ],
};

test("the cut's line, as COPY.md words it", () => {
  assert.equal(C.chosenLine(CTX), "נבחרו 3 מתוך 340 פסקאות");
  assert.equal(C.chosenLine({ chosen: 1, total: 9 }), "נבחרה פסקה אחת מתוך 9");
});

test("sources: each cited slide once, at the chosen paragraph that cites it; what the paragraphs lack is left out", () => {
  const a = "אטרופין חוסם [הרצאה 7 · ש׳ 14]. גם [הרצאה 7 · ש' 14-15] ו-[הרצאה 2 · ש׳ 3]. לא קיים: [הרצאה 9 · ש׳ 1], [הרצאה 7 · ש׳ 99], [ש' 3].";
  const got = C.courseSources(a, CTX).map((s) => `${s.key}@${s.lectureId}:${s.at?.part}.${s.at?.anchor}`);
  assert.deepEqual(got, ["7·14@l7:1.3", "7·15@l7:1.3", "2·3@l2:0.4"]);
  assert.deepEqual(C.courseSources(a, null), [], "an answer without its cut has no sources");
});

test("the exam's date and length in words", () => {
  assert.deepEqual(C.examWhen("2027-02-12", 23), { when: "המבחן ב-12.2", left: "עוד 23 ימים" });
  assert.deepEqual(C.examWhen("2027-02-12", 1), { when: "המבחן ב-12.2", left: "מחר" });
  assert.deepEqual(C.examWhen("2027-02-12", 0), { when: "המבחן ב-12.2", left: "המבחן היום" });
  assert.deepEqual(C.examWhen("2026-02-12", -3), { when: "המבחן היה ב-12.2", left: "" });
  assert.equal(C.examWhen(null, null), null);
  assert.equal(C.examLength(100, 180), "100 שאלות · 3 שעות");
  assert.equal(C.examLength(50, 90), "50 שאלות · 1.5 שעות");
  assert.equal(C.examLength(null, 120), "שעתיים");
  assert.equal(C.examLength(20, 36), "20 שאלות · 36 דקות");
  assert.equal(C.examLength(null, null), "");
  assert.equal(C.lecturesWord(1), "הרצאה אחת");
  assert.equal(C.lecturesWord(25), "25 הרצאות");
});

test("a course's key is its text as the SQL matches it: trimmed, in lower case", () => {
  assert.equal(C.courseKey("  Micro "), "micro");
  assert.equal(C.courseKey("פרמקו "), C.courseKey("פרמקו"));
});
