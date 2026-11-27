import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateUsd } from "./budget.js";
import { correctionsForRewrite, SUMMARY_SYSTEM } from "./prompts/summary.js";
import { lectureBlock, MODEL, type Lecture } from "./study.js";
import { PART_TOKENS, partRequest, type InputSection } from "./writer.js";

/* partRequest (design-models §7.6, WP4): a part's request, pure, extracted
 * from preparePart. section.test.ts pins the bytes preparePart sends
 * against bc01207's; this checks the extraction itself on synthetic data. */

const lecture: Lecture = {
  id: "11111111-0000-4000-8000-000000000001",
  group_id: "22222222-0000-4000-8000-000000000002",
  course: "קורס בדוי",
  title: "הרצאה בדויה",
  lecturer: "",
  lecture_date: null,
  source_kind: "pptx",
  slides: [1, 2, 3, 4].map((n) => ({ n, title: `שקף ${n}`, lines: [`Examplomycin ${n}`], tables: [], notes: "", figures: [] })),
};
const sections: InputSection[] = [
  { idx: 0, title: "מבוא", slide_from: 1, slide_to: 2, status: "ready", error: null, markdown: "" },
  { idx: 1, title: "מנגנונים", slide_from: 3, slide_to: 4, status: "queued", error: null, markdown: "" },
];

test("partRequest: the deck (cached), the request, each picture with its label, the corrections last; the same every time", () => {
  const figures = [{ n: 3, k: 1, w: 800, h: 600, url: "https://x.supabase.co/storage/v1/object/sign/study/a.jpg?token=t" }];
  const corrections = [{ before: "א", after: "ב", note: "" }];
  const a = partRequest({ lecture, sections, idx: 1, figures, corrections });
  assert.deepEqual(partRequest({ lecture, sections, idx: 1, figures, corrections }), a, "pure");
  assert.equal(a.request.kind, "part");
  assert.equal(a.request.ref, "1");
  assert.equal(a.request.maxTokens, PART_TOKENS);
  assert.deepEqual(a.request.system, [{ type: "text", text: SUMMARY_SYSTEM, cache_control: { type: "ephemeral" } }]);
  const content = a.request.messages[0].content as Array<{ type: string; text?: string; cache_control?: unknown; source?: { url: string } }>;
  assert.equal(content[0].text, lectureBlock(lecture));
  assert.deepEqual(content[0].cache_control, { type: "ephemeral" });
  assert.equal(content[2].text, "fig:3-1 (שקף 3)");
  assert.equal(content[3].source?.url, figures[0].url);
  assert.equal(content[4].text, correctionsForRewrite(corrections), "the corrections block last (W-3)");
  assert.equal(content.length, 5);
  assert.equal(a.imageTokens, 640);
  // The estimate preparePart reserves, as before the extraction.
  const labels = "fig:3-1 (שקף 3)".length;
  assert.equal(a.inputChars, SUMMARY_SYSTEM.length + lectureBlock(lecture).length + (content[1].text ?? "").length + labels + correctionsForRewrite(corrections).length);
  assert.ok(estimateUsd(MODEL, a.inputChars, PART_TOKENS, a.imageTokens) > 0.9);
  // Without pictures or corrections: just the deck and the request.
  const b = partRequest({ lecture, sections, idx: 0, figures: [], corrections: [] });
  assert.equal((b.request.messages[0].content as unknown[]).length, 2);
  assert.equal(b.imageTokens, 0);
  assert.throws(() => partRequest({ lecture, sections, idx: 7, figures: [], corrections: [] }), /section not found/);
});
