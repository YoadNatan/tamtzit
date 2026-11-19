import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Section } from "./api";
import type { Edit, Turn } from "./collab";
import type { Corrections } from "./correctionsStore";

// api.ts (which collab.ts imports) reads Vite's import.meta.env; bundled into
// this one file it shares this module's import.meta, set before the first
// evaluation: no Supabase here (nothing in these tests calls it).
(import.meta as unknown as { env: Record<string, string> }).env = {};
let K: typeof import("./collab");
let S: typeof import("./correctionsStore");
before(async () => {
  K = await import("./collab");
  S = await import("./correctionsStore");
});

/* Package K's client logic (§12.3.K): the sources' words, the undo rule
 * (review SEC-1), the paragraph's state on the page, where an answer
 * belongs, and the conversation kept on the phone. */

const edit = (o: Partial<Edit>): Edit => ({
  id: "e",
  lecture_id: "L",
  part_idx: 0,
  anchor: 1,
  gen: 0,
  rev: 1,
  kind: "paragraph",
  before_text: "a",
  after_text: "b",
  note: "",
  undo_of: null,
  author_id: "u1",
  approved_by: "u2",
  aloud: false,
  proposal_id: "p",
  source_kind: "slide",
  source_slides: [6],
  source_at: null,
  source_note: "",
  created_at: "2026-11-17T10:00:00Z",
  ...o,
});

test("a source in words, as the history and \"יחד\" write it (corrections.html)", () => {
  assert.equal(K.sourceLine({ source_kind: "slide", source_slides: [33], source_at: null, source_note: "" }), "מקור: שקף 33");
  assert.equal(K.sourceLine({ source_kind: "slide", source_slides: [20, 23], source_at: null, source_note: "" }), "מקור: שקף 20, 23");
  assert.equal(K.sourceLine({ source_kind: "recording", source_slides: [], source_at: 2470, source_note: "" }), "מקור: מההקלטה, 41:10");
  assert.equal(K.sourceLine({ source_kind: "external", source_slides: [], source_at: null, source_note: "הספר, פרק 15" }), "מקור: הספר, פרק 15");
  assert.equal(K.sourceLine({ source_kind: "undo", source_slides: [], source_at: null, source_note: "" }), "", "an undo has no source");
});

test("a minute of the recording: typed as the notes write it, at most ten hours (the SQL's limit)", () => {
  assert.equal(K.parseMinute("41"), 2460);
  assert.equal(K.parseMinute("41:10"), 2470);
  assert.equal(K.parseMinute(" 1:02:03 "), 3723);
  assert.equal(K.parseMinute("600"), 36000);
  assert.equal(K.parseMinute("601"), null);
  assert.equal(K.parseMinute("41:70"), null);
  assert.equal(K.parseMinute("ארבעים"), null);
  assert.equal(K.parseMinute(""), null);
  assert.equal(K.clock(2470), "41:10");
  assert.equal(K.clock(3723), "1:02:03");
  assert.equal(K.clock(-5), "0:00");
  for (const s of [0, 59, 61, 2470, 3600, 35999]) assert.equal(K.parseMinute(K.clock(s)), s, `round trip ${s}`);
});

test("slide tags as a tag writes them: runs joined", () => {
  assert.equal(K.slideSpec([20, 19, 37, 38]), "19-20,37-38");
  assert.equal(K.slideSpec([33]), "33");
  assert.equal(K.slideSpec([30, 30, 31, 33]), "30-31,33");
  assert.equal(K.slideSpec([]), "");
});

test("\"ביטול\" only on the paragraph's latest correction, never on an undo, never on an older generation (review SEC-1)", () => {
  const gen = (part: number) => (part === 0 ? 1 : 0);
  const edits = [
    edit({ id: "old", rev: 2, gen: 1 }),
    edit({ id: "new", rev: 3, gen: 1 }),
    edit({ id: "other", anchor: 4, rev: 4, gen: 1 }),
    edit({ id: "undone", anchor: 5, rev: 5, gen: 1 }),
    edit({ id: "undo", anchor: 5, rev: 6, gen: 1, source_kind: "undo", undo_of: "undone" }),
    edit({ id: "stale", anchor: 7, rev: 1, gen: 0 }),
    edit({ id: "p1", part_idx: 1, anchor: 1, rev: 1, gen: 0 }),
  ];
  assert.deepEqual([...K.undoable(edits, gen)].sort(), ["new", "other", "p1"]);
});

test("the paragraph on the page: its corrections, a waiting proposal, the 2-s flash", () => {
  const section = { idx: 0, gen: 1 } as Section;
  const c: Corrections = {
    edits: [edit({ id: "a", rev: 2, gen: 1 }), edit({ id: "b", rev: 3, gen: 1 }), edit({ id: "u", rev: 4, gen: 1, source_kind: "undo", undo_of: "b" }), edit({ id: "g0", anchor: 2, gen: 0 })],
    proposals: [
      { part_idx: 0, anchor: 3, gen: 1, state: "pending" },
      { part_idx: 0, anchor: 4, gen: 1, state: "conflict" },
      { part_idx: 0, anchor: 5, gen: 0, state: "pending" },
    ] as Corrections["proposals"],
    flash: { "0:1": 2000, "0:3": 500 },
    loaded: true,
  };
  const at = S.blockStateOf(c, section, 1000);
  assert.deepEqual(at(1), { edited: 2, flash: true }, "two corrections (the undo is not counted), flashing");
  assert.deepEqual(at(2), {}, "an earlier generation's correction is history only");
  assert.deepEqual(at(3), { pending: true }, "\"תיקון ממתין לאישור\"");
  assert.deepEqual(at(4), {}, "a proposal stopped by a change does not wait");
  assert.deepEqual(at(5), {}, "a proposal on an earlier generation does not wait");
});

test("a correction in a few words: a table's changed cell with its row, or the new text", () => {
  const before = "| Drug | t½ |\n|---|---|\n| Furosemide | 1.5 h |\n| Bumetanide | 1 h |";
  const after = "| Drug | t½ |\n|---|---|\n| Furosemide | 1.5 h |\n| Bumetanide | **1-1.5 h** |";
  assert.equal(K.editGist(before, after), "Bumetanide · 1-1.5 h");
  assert.equal(K.editGist("x", "**מנגנון פעולה:** מעכבות את ה-NKCC2. [ש' 6]"), "מנגנון פעולה: מעכבות את ה-NKCC2.");
  assert.equal(K.plainQuote("**שימושים:** בצקת ריאות [ש' 7]"), "שימושים: בצקת ריאות");
});

test("a long correction's gist ends at a whole word with an ellipsis (never \"…ולכן הן המשתני\")", () => {
  const gist = K.editGist("x", "**מנגנון פעולה:** מעכבות את ה-NKCC2 ב-thick ascending limb, ולכן הן המשתנים החזקים ביותר. [ש' 6]");
  assert.equal(gist, "מנגנון פעולה: מעכבות את ה-NKCC2 ב-thick ascending limb, ולכן הן…");
  const before = "| Drug | Note |\n|---|---|\n| Furosemide | x |";
  const after = "| Drug | Note |\n|---|---|\n| Furosemide | ניתנת פעמיים ביום, ובמינון גבוה יותר באי ספיקת כליות מתקדמת ובתסמונת נפרוטית |";
  const cell = K.editGist(before, after);
  assert.ok(cell.startsWith("Furosemide · ניתנת") && cell.endsWith("…") && cell.length <= 70, cell);
});

test("a slide's quote: its title and lines, each whole, in the slide's order, at most 280 characters", () => {
  assert.deepEqual(K.quoteLines({ title: "Loop diuretics", lines: ["Loop diuretics", "מעכבות NKCC2", "t½ 1-2 h"] }), ["Loop diuretics", "מעכבות NKCC2", "t½ 1-2 h"]);
  const long = K.quoteLines({ title: "T", lines: Array.from({ length: 30 }, (_, i) => `line ${i} of the slide`) });
  assert.ok(long.join(" · ").length <= 280, String(long.join(" · ").length));
  assert.ok(long.every((l) => l === "T" || /^line \d+ of the slide$/.test(l) || l.endsWith("…")));
  assert.deepEqual(K.quoteLines({ title: "", lines: [] }), []);
});

test("an undo is an undo with or without its source (K's first version wrote only undo_of)", () => {
  assert.equal(K.isUndo({ source_kind: "undo", undo_of: "e1" }), true);
  assert.equal(K.isUndo({ source_kind: null, undo_of: "e1" }), true);
  assert.equal(K.isUndo({ source_kind: null, undo_of: null }), false);
  assert.equal(K.isUndo({ source_kind: "slide", undo_of: null }), false);
  const edits = [
    { id: "a", part_idx: 0, anchor: 3, gen: 0, rev: 1, source_kind: null, undo_of: null },
    { id: "b", part_idx: 0, anchor: 3, gen: 0, rev: 2, source_kind: null, undo_of: "a" },
  ];
  assert.deepEqual([...K.undoable(edits, () => 0)], [], "a legacy undo is never offered 'ביטול'");
});

test("where an answer belongs: the paragraph asked about, then the paragraphs citing its slides, else its part", () => {
  const sections = [
    { idx: 0, status: "ready", slide_from: 1, slide_to: 5, title: "מבוא", markdown: "## מבוא\n\nפסקה ראשונה. [ש' 1]\n\nפסקה שנייה. [ש' 2]" },
    { idx: 1, status: "ready", slide_from: 6, slide_to: 9, title: "Loop", markdown: "## Loop\n\nמנגנון. [ש' 6]\n\nשימושים. [ש' 7]" },
    { idx: 2, status: "writing", slide_from: 10, slide_to: 12, title: "Thiazides", markdown: "" },
  ] as Section[];
  const spots = K.answerSpots(sections, "התשובה. [ש' 6] ועוד [ש' 2]", null);
  assert.deepEqual(
    spots.map((s) => [s.part, s.anchor, s.quote]),
    [
      [0, 2, "פסקה שנייה."],
      [1, 1, "מנגנון."],
    ],
  );
  const focus = { part: 1, anchor: 2, quote: "שימושים." };
  assert.deepEqual(K.answerSpots(sections, "[ש' 6]", focus)[0], focus, "the paragraph asked about comes first");
  assert.deepEqual(K.answerSpots(sections, "בלי שקף", null), [], "no slide, no paragraph");
  assert.deepEqual(K.answerSpots(sections, "[ש' 8]", null), [{ part: 1, anchor: 0, quote: "Loop" }], "no paragraph cites it: its part");
});

test("the conversation stays on this phone: 14 days, 30 turns, and nothing breaks without storage", () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const key = K.threadKey("L1");
  assert.equal(key, "study-ask-v1:L1");
  assert.equal(K.threadKey(null), "study-ask-v1:all");
  const turn = (i: number, daysAgo = 0): Turn => ({ q: `q${i}`, u: `u${i}`, a: `a${i}`, sig: "s", at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), lectureId: "L1", badTags: [], stop: null, focus: null });
  K.saveThread(key, [turn(0, 20), ...Array.from({ length: 34 }, (_, i) => turn(i + 1))]);
  const back = K.loadThread(key);
  assert.equal(back.length, 30);
  assert.equal(back[0].q, "q5", "the oldest go first");
  K.saveThread(key, [turn(1, 20), turn(2, 1)]);
  assert.deepEqual(K.loadThread(key).map((t) => t.q), ["q2"], "older than 14 days: gone");
  store.set(key, "not json");
  assert.deepEqual(K.loadThread(key), []);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => undefined,
  };
  assert.deepEqual(K.loadThread(key), [], "private mode: an empty conversation");
  assert.doesNotThrow(() => K.saveThread(key, [turn(1)]));
  delete (globalThis as { localStorage?: unknown }).localStorage;
});
