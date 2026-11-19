import assert from "node:assert/strict";
import { test } from "node:test";
import { numberBlocks } from "../../shared/study/blocks.js";
import {
  allRows,
  badCites,
  CONTEXT_CHARS,
  CONTEXT_LECTURES,
  CONTEXT_PARAGRAPHS,
  contextBlock,
  courseCites,
  courseLectures,
  pickParagraphs,
  queryText,
  scoreParts,
  type LectureRow,
  type PartRow,
} from "./context.js";
import { coverage } from "./similar.js";

/* "לשאול על כל הקורס" (sources.md B6.9): the pure parts of the context
 * builder. The lectures and parts are made for the tests (drugs that do not
 * exist), never a real lecture. */

const id = (k: number) => `aaaaaaaa-0000-4000-8000-${String(k).padStart(12, "0")}`;
const lecture = (k: number, course: string, date: string | null, at = `2026-11-0${k % 9}T10:00:00Z`): LectureRow => ({
  id: id(k),
  title: `הרצאה לדוגמה ${k}`,
  course,
  lecture_date: date,
  created_at: at,
});

test("the course's lectures: matched by lower(btrim), numbered by date (undated last), then upload time", () => {
  const rows = [
    lecture(1, "פרמקו", "2026-11-08"),
    lecture(2, " פרמקו ", "2026-11-01"),
    lecture(3, "פרמקו", null, "2026-11-01T09:00:00Z"),
    lecture(4, "אחר", "2026-10-01"),
    lecture(5, "Pharma", null),
    lecture(6, "פרמקו", null, "2026-11-01T08:00:00Z"),
  ];
  assert.deepEqual(
    courseLectures(rows, "פרמקו").map((l) => [l.n, l.id]),
    [
      [1, id(2)],
      [2, id(1)],
      [3, id(6)],
      [4, id(3)],
    ],
  );
  assert.deepEqual(
    courseLectures(rows, "pharma").map((l) => l.id),
    [id(5)],
  );
});

test("the question loses the words that match every paragraph; a question of only such words stays as it is", () => {
  assert.equal(queryText("מה נאמר בהרצאה על Fabrimycin ואלכוהול?"), "Fabrimycin ואלכוהול");
  assert.equal(queryText("מה ההבדל בין Fabrimycin ל-Placebozole?"), "Fabrimycin ל-Placebozole");
  assert.equal(queryText("מה זה?"), "מה זה?");
  // Coverage: how much of the question a text holds.
  assert.equal(coverage("Fabrimycin", "Fabrimycin היא prodrug"), 1);
  assert.equal(coverage("Fabrimycin", "שלשול ופריחה"), 0);
  assert.equal(coverage("", "x"), 0);
});

const md = (drug: string, n: number) => `## ${drug}\n\n${drug} פועלת על Fakease. [ש' ${n}]\n\n- שלשול. [ש' ${n + 1}]`;

test("paragraphs: at most 4 lectures and at most 12 paragraphs, in the course's order; headings are not paragraphs", () => {
  const ls = courseLectures(
    Array.from({ length: 6 }, (_, k) => lecture(k + 1, "פרמקו", `2026-11-0${k + 1}`)),
    "פרמקו",
  );
  // Six lectures, two parts each, one paragraph of each part names Exampline.
  const parts: PartRow[] = ls.flatMap((l) => [0, 1].map((idx) => ({ lecture_id: l.id, idx, title: `חלק ${idx}`, markdown: md("Exampline", 1 + idx * 2) })));
  const { paragraphs, total } = pickParagraphs({ query: "Exampline", lectures: ls, parts, partScore: scoreParts("Exampline", parts, []) });
  assert.equal(total, 6 * 2 * 2, "every paragraph of the course, headings left out");
  assert.equal(new Set(paragraphs.map((p) => p.lectureId)).size, CONTEXT_LECTURES);
  assert.equal(paragraphs.length, 2 * CONTEXT_LECTURES, "the matching paragraphs of the first four lectures");
  assert.ok(paragraphs.every((p) => p.text.startsWith("Exampline")));
  const order = paragraphs.map((p) => [p.lecture, p.part, p.anchor]);
  assert.deepEqual(order, [...order].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]), "in the course's order");
  // Each paragraph's address is the anchor SummaryView numbers.
  const first = paragraphs[0];
  const blocks = numberBlocks(parts.find((p) => p.lecture_id === first.lectureId && p.idx === first.part)!.markdown!);
  assert.equal(blocks.find((b) => b.n === first.anchor)?.text, first.text);
  assert.deepEqual([first.lecture, first.part, first.anchor, first.slides], [1, 0, 1, [1]]);
  // One lecture with twenty matching paragraphs: twelve.
  const many: PartRow[] = [{ lecture_id: ls[0].id, idx: 0, title: "t", markdown: Array.from({ length: 20 }, (_, k) => `Exampline ${k}. [ש' ${k + 1}]`).join("\n\n") }];
  assert.equal(pickParagraphs({ query: "Exampline", lectures: ls, parts: many, partScore: new Map() }).paragraphs.length, CONTEXT_PARAGRAPHS);
});

test("paragraphs: the better match wins, the part's points help, the budget of characters holds", () => {
  const ls = courseLectures([lecture(1, "c", "2026-11-01"), lecture(2, "c", "2026-11-02")], "c");
  const parts: PartRow[] = [
    { lecture_id: id(1), idx: 0, title: "מנגנון", markdown: "Fabrimycin משופעלת על ידי Examplase. [ש' 2]\n\nPlacebozole פעילה במעי. [ש' 5]" },
    { lecture_id: id(2), idx: 0, title: "תופעות", markdown: "תגובה דמוית Disulfiram עם אלכוהול. [ש' 7]" },
    { lecture_id: id(2), idx: 1, title: "לא מוכן", markdown: null },
  ];
  const q = queryText("מה נאמר על Disulfiram ואלכוהול?");
  const withPoints = scoreParts(q, parts, [{ lecture_id: id(2), part_idx: 0, subject: "Disulfiram", text: "אסור אלכוהול עד 72 שעות" }]);
  assert.ok((withPoints.get(`${id(2)}:0`) ?? 0) > (withPoints.get(`${id(1)}:0`) ?? 0));
  const one = pickParagraphs({ query: q, lectures: ls, parts, partScore: withPoints, maxParagraphs: 1 });
  assert.equal(one.total, 3);
  assert.deepEqual(
    one.paragraphs.map((p) => [p.lecture, p.anchor, p.slides]),
    [[2, 0, [7]]],
  );
  // Nothing scores above zero: nothing is chosen (the answer says so).
  assert.equal(pickParagraphs({ query: "zzzz qqqq", lectures: ls, parts, partScore: new Map() }).paragraphs.length, 0);
  // The budget: a long table is cut at 1,500 characters, and the total stays under the cap.
  const long = Array.from({ length: 40 }, (_, k) => `Exampline ${"מילה ".repeat(400)} [ש' ${k + 1}]`).join("\n\n");
  const big = pickParagraphs({ query: "Exampline", lectures: ls, parts: [{ lecture_id: id(1), idx: 0, title: "t", markdown: long }], partScore: new Map() });
  assert.ok(big.paragraphs.every((p) => p.text.length === 1501 && p.text.endsWith("…")));
  assert.ok(big.paragraphs.reduce((n, p) => n + p.text.length, 0) <= CONTEXT_CHARS);
  const small = pickParagraphs({ query: "Exampline", lectures: ls, parts: [{ lecture_id: id(1), idx: 0, title: "t", markdown: long }], partScore: new Map(), budgetChars: 5000 });
  assert.equal(small.paragraphs.length, 3, "the budget stops it before 12");
});

test("the context block: one address per paragraph, and the honest cut", () => {
  const ls = courseLectures([lecture(1, "c", "2026-11-01")], "c");
  const parts: PartRow[] = [{ lecture_id: id(1), idx: 0, title: "מנגנון", markdown: "## מנגנון\n\nFabrimycin היא prodrug. [ש' 2]" }];
  const { paragraphs, total } = pickParagraphs({ query: "Fabrimycin", lectures: ls, parts, partScore: new Map() });
  const text = contextBlock("פרמקולוגיה לדוגמה", { paragraphs, chosen: paragraphs.length, total, lectures: ls, all: ls });
  assert.equal(
    text,
    "The course «פרמקולוגיה לדוגמה»: paragraphs of the group's summaries of its lectures, chosen for this question (1 of 1). Each paragraph follows its address: the lecture's number in the course, its title and the part's heading. Its [ש' n] tags name that lecture's slides.\n\n" +
      "[הרצאה 1 · «הרצאה לדוגמה 1» · «מנגנון»]\nFabrimycin היא prodrug. [ש' 2]",
  );
});

test("citations [הרצאה 7 · ש׳ 14]: read with either mark and ranges; a lecture, slide or plain tag not in the paragraphs is bad", () => {
  assert.deepEqual(courseCites("א. [הרצאה 7 · ש׳ 14] ב. [הרצאה 2 · ש' 3-4, 9]"), [
    { lecture: 7, slides: [14] },
    { lecture: 2, slides: [3, 4, 9] },
  ]);
  const ctx = {
    paragraphs: [
      { lecture: 1, lectureId: id(1), part: 0, heading: "", anchor: 1, slides: [2, 7], text: "", score: 1 },
      { lecture: 3, lectureId: id(3), part: 1, heading: "", anchor: 4, slides: [5], text: "", score: 1 },
    ],
  };
  assert.deepEqual(badCites("כך. [הרצאה 1 · ש׳ 7] וגם [הרצאה 3 · ש' 5].", ctx), []);
  assert.deepEqual(badCites("כך. [הרצאה 1 · ש׳ 8] וגם [הרצאה 2 · ש׳ 5] ו-[ש' 2].", ctx), ["1·8", "2·5", "?·2"]);
});

test("every page of a read: 2,500 points come in three pages, none twice (PostgREST answers at most 1,000)", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ i }));
  const asked: Array<[number, number]> = [];
  const got = await allRows<{ i: number }>(async (from, to) => {
    asked.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
  });
  assert.equal(got.length, 2500);
  assert.equal(new Set(got.map((r) => r.i)).size, 2500);
  assert.deepEqual(asked, [[0, 999], [1000, 1999], [2000, 2999]]);
  await assert.rejects(allRows(async () => ({ data: null, error: { message: "boom" } })), /boom/);
});
