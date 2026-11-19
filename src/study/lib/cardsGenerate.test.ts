import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/* K3's estimate (cardsGenerate.ts) does study_card_round's arithmetic on the
 * phone, so the sheet says how many cards a round will write, and what it
 * costs, without planning a round nobody asked for. The expected numbers were
 * read from study_card_round itself on a throwaway Postgres 16, loaded with
 * this repo's study-schema.sql and the fixture lecture (e2e/study/fixtures):
 * round 1 on the outline's parts 6 parts and 6 cards (one each for parts 0-4
 * and 7), round 1 before an outline 4 six-slide chunks and 6 cards (2, 2, 1,
 * 1), and round 2 one part and one card. */

// cards.ts reads Vite's import.meta.env through api.ts; bundled here it shares this module's.
(import.meta as unknown as { env: Record<string, string> }).env = {};
const { claimable, estimateRound, estimateUsd, slideChars } = await import("./cardsGenerate");

type FixtureSlide = { n: number; title: string; lines: string[]; tables: string[][][]; notes: string };
const FX = join(process.cwd(), "e2e", "study", "fixtures");
const slides = (JSON.parse(readFileSync(join(FX, "slides.json"), "utf8")) as FixtureSlide[]).map((s) => ({ n: s.n, lines: s.lines, tables: s.tables, notes: s.notes }));
const outline = JSON.parse(readFileSync(join(FX, "outline.json"), "utf8")) as { parts: Array<{ from: number; to: number }> };
const sections = outline.parts.map((p, idx) => ({ idx, slide_from: p.from, slide_to: p.to }));

test("the estimate equals study_card_round on the fixture lecture: round 1, before an outline, round 2", () => {
  assert.deepEqual(estimateRound(slides, sections, 1), { parts: 6, wanted: 6 });
  assert.deepEqual(estimateRound(slides, [], 1), { parts: 4, wanted: 6 });
  assert.deepEqual(estimateRound(slides, sections, 2), { parts: 1, wanted: 1 });
});

test("characters: lines, notes and a table as Postgres prints its jsonb (\", \" between items)", () => {
  assert.equal(slideChars({ lines: ["אבג", "de"], notes: "xy", tables: [] }), 7);
  // [["a", "b"]] is 12 characters as jsonb text; the emoji is one character, as char_length counts.
  assert.equal(slideChars({ lines: [], notes: "", tables: [[["a", "b"]]] }), 14);
  assert.equal(slideChars({ lines: ["😀"], notes: "", tables: [[["a \"b\" \\ c", "עברית"], ["😀", "x\ny"], []]] }), 1 + 48);
});

test("a big lecture: at most 8 cards a part in round 1 and 4 in round 2, and a round of more than 60 scaled down", () => {
  const big = Array.from({ length: 100 }, (_, i) => ({ n: i + 1, lines: ["א".repeat(600)], tables: [], notes: "" }));
  const parts = Array.from({ length: 20 }, (_, i) => ({ idx: i, slide_from: i * 5 + 1, slide_to: i * 5 + 5 }));
  // 3,000 characters a part: 12 → 8 each, 160 in all → floor(8 · 60 / 160) = 3 each.
  assert.deepEqual(estimateRound(big, parts, 1), { parts: 20, wanted: 60 });
  assert.deepEqual(estimateRound(big, parts.slice(0, 5), 1), { parts: 5, wanted: 40 });
  assert.deepEqual(estimateRound(big, parts.slice(0, 5), 2), { parts: 5, wanted: 20 });
  assert.deepEqual(estimateRound([{ n: 1, lines: ["קצר"], tables: [], notes: "" }], [], 1), { parts: 0, wanted: 0 }, "too little text: no part");
});

test("the cost line: $0.0045 a card, up to the next 5 cents", () => {
  assert.equal(estimateUsd(54).toFixed(2), "0.25");
  assert.equal(estimateUsd(25).toFixed(2), "0.15");
  assert.equal(estimateUsd(6).toFixed(2), "0.05");
  assert.equal(estimateUsd(1).toFixed(2), "0.05");
});

test("a part may be written when pending, failed, or stuck for six minutes, and never after 3 tries", () => {
  const t = Date.parse("2026-11-16T10:00:00Z");
  const at = (min: number) => new Date(t - min * 60_000).toISOString();
  assert.equal(claimable({ status: "pending", attempts: 0, updated_at: at(0) }, t), true);
  assert.equal(claimable({ status: "failed", attempts: 2, updated_at: at(0) }, t), true);
  assert.equal(claimable({ status: "failed", attempts: 3, updated_at: at(0) }, t), false);
  assert.equal(claimable({ status: "writing", attempts: 1, updated_at: at(2) }, t), false);
  assert.equal(claimable({ status: "writing", attempts: 1, updated_at: at(7) }, t), true);
  assert.equal(claimable({ status: "ready", attempts: 1, updated_at: at(60) }, t), false);
});
