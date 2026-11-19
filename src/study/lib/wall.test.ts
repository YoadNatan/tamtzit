import assert from "node:assert/strict";
import { before, test } from "node:test";
import { withAssociations, type CardRow } from "./anki";
import { helpRows } from "./helpCopy";
import { flagsFrom, requiredSchema } from "./flags";
import { failText } from "./failText";
import { fitSize, MAX_BYTES, MAX_SIDE } from "./photo";
import { allowed, parseRoute, routeUrl, tabOf } from "./route";
import type { Aid } from "./wall";
import type { Section } from "./api";

// api.ts (which wall.ts imports) reads Vite's import.meta.env; bundled into
// this one file it shares this module's import.meta, set before the first
// evaluation: no Supabase here (nothing in these tests calls it).
(import.meta as unknown as { env: Record<string, string> }).env = {};
let W: typeof import("./wall");
before(async () => {
  W = await import("./wall");
});

/* J-3 (spec §12.5.J; the fun design's J-3): the wall's pure rules on the
 * phone. The tabs' order (votes, then "נתקע לי", then the older; new by
 * time; "שלי" the caller's); the composer refuses an empty fact; the photo's
 * size rule (a 4,000 × 3,000 photo → 1280 px on its long side; the bytes
 * are checked by shrinkPhoto in the browser, e2e/study/wall.cjs); the
 * chips' and marks' words; the card's back and Anki's Extra (W-24); the
 * paragraph hash matching the op's; the flag, its route and its schema. */

const aid = (o: Partial<Aid>): Aid => ({
  id: "a",
  lecture_id: "l",
  lecture_title: "T",
  part_idx: 0,
  anchor: 1,
  quote: "",
  drug: "",
  kind: "line",
  body: "שורה",
  fact: "עובדה",
  slides: [],
  photo: null,
  figure: null,
  author: null,
  credit: null,
  funny_n: 0,
  stuck_n: 0,
  my_funny: false,
  my_stuck: false,
  mine: false,
  pinned: false,
  on_cards: false,
  week: false,
  flag: null,
  flagged_by: null,
  check_note: "",
  remix_of: null,
  draft_id: null,
  draft_no: null,
  created_at: "2026-11-10T10:00:00Z",
  ...o,
});

test("the tabs: הכי טובות by votes, then נתקע לי, then the older; חדשות newest first; שלי the caller's own and pins", () => {
  const rows = [
    aid({ id: "a", funny_n: 2, stuck_n: 1, created_at: "2026-11-10T10:00:00Z" }),
    aid({ id: "b", funny_n: 1, stuck_n: 2, created_at: "2026-11-11T10:00:00Z" }),
    aid({ id: "c", funny_n: 5, stuck_n: 0, created_at: "2026-11-12T10:00:00Z", mine: true }),
    aid({ id: "d", funny_n: 1, stuck_n: 2, created_at: "2026-11-09T10:00:00Z", pinned: true }),
  ];
  assert.deepEqual(W.tabRows(rows, "top").map((a) => a.id), ["c", "d", "b", "a"]);
  assert.deepEqual(W.tabRows(rows, "new").map((a) => a.id), ["c", "b", "a", "d"]);
  assert.deepEqual(W.tabRows(rows, "mine").map((a) => a.id), ["c", "d"]);
  assert.deepEqual(W.tabRows(rows, "needed"), [], "דרושות waits for U's pulse");
});

test("the composer refuses an empty fact, a short body, a photo where none belongs; the codes have words", () => {
  assert.equal(W.composerError({ body: "Quinine = Queen", fact: "", photo: false, kind: "line" }), "bad fact");
  assert.equal(W.composerError({ body: "Qu", fact: "טינטון [ש׳ 27]", photo: false, kind: "line" }), "bad body");
  assert.equal(W.composerError({ body: "שרבוט של Queen", fact: "טינטון [ש׳ 27]", photo: false, kind: "sketch" }), "bad photo");
  assert.equal(W.composerError({ body: "Quinine = Queen", fact: "טינטון [ש׳ 27]", photo: false, kind: "line" }), null);
  for (const code of ["bad fact", "bad body", "bad photo", "too big", "own aid", "daily_limit"]) assert.ok(!failText(code, "wall").includes("משהו השתבש"), code);
  assert.equal(failText("bad fact", "wall"), "חסרה שורת ׳על מה זה?׳: העובדה והשקף, שיהיה מובן גם למי שלא היה.");
  assert.equal(failText("daily_limit", "mnemonic"), "אפשר ליצור אסוציאציות עד 5 פעמים ביום. מתחדש בחצות.");
});

test("the photo: a 4,000 × 3,000 photo is drawn at 1280 × 960; never upscaled; the limits are the slides' (1280 px, 600 kB)", () => {
  assert.deepEqual(fitSize(4000, 3000), { w: 1280, h: 960 });
  assert.deepEqual(fitSize(3000, 4000), { w: 960, h: 1280 });
  assert.deepEqual(fitSize(800, 600), { w: 800, h: 600 });
  assert.deepEqual(fitSize(0, 600), { w: 0, h: 0 });
  assert.deepEqual([MAX_SIDE, MAX_BYTES], [1280, 600_000]);
});

test("the words: kinds, marks (by name, by the check, hidden for the author only), drugs, the card's back and Anki's Extra", () => {
  assert.equal(W.kindChip(aid({ kind: "sketch" })), "שרבוט");
  assert.equal(W.kindChip(aid({ kind: "remix", draft_id: "d" })), "רמיקס לטיוטה של Claude");
  assert.equal(W.kindChip(aid({ kind: "remix" })), "רמיקס");
  assert.equal(W.kindChip(aid({ kind: "moment" })), "מהפגישה");
  assert.equal(W.kindChip(aid({ kind: "draft", draft_id: "d" })), "טיוטה של Claude");
  assert.equal(W.kindChip(aid({ kind: "line" })), null);
  assert.equal(W.markLine(aid({ flag: "inaccurate", flagged_by: "מאיה" })), "סומן ׳לא מדויק׳ · מאיה");
  assert.equal(W.markLine(aid({ flag: "inaccurate", check_note: "ה-t½ הוא 7-31 ימים" })), "לא מדויק לפי הבדיקה: ה-t½ הוא 7-31 ימים");
  assert.equal(W.markLine(aid({ flag: "not_ok", mine: true })), "מוסתר מהקיר: סומן ׳לא מתאים׳. אפשר לתקן או למחוק.");
  assert.equal(W.markLine(aid({ flag: "not_ok" })), null);
  assert.deepEqual(W.drugChips("Miltefosine טרטוגנית (Black Box): t½ של Miltefosine [ש' 16]. Pentostam ו-Sb"), ["Miltefosine", "Black", "Pentostam"]);
  assert.equal(W.backLine({ body: "Quinine = Queen", author: "דניאל" }), "בגב: ׳Quinine = Queen׳ · דניאל");
  assert.equal(W.backLine({ body: "Quinine = Queen", author: null }), "בגב: ׳Quinine = Queen׳ · בלי שם");
  assert.equal(W.ankiExtra({ body: "Quinine = Queen", author: "דניאל" }), "אסוציאציה: Quinine = Queen (דניאל)");
  assert.equal(W.ankiExtra({ body: "Quinine = Queen", author: null }), "אסוציאציה: Quinine = Queen");
  assert.equal(W.firstWords("**Miltefosine** טרטוגנית: אמצעי מניעה בטיפול ועוד 5 חודשים אחריו, וה-t½ שלה ארוך מאוד. [ש' 16]", 40), "Miltefosine טרטוגנית: אמצעי מניעה…");
});

test("Anki's Extra gains the association after the card's own, and the note's time moves with it (W-24)", () => {
  const card = (o: Partial<CardRow>): CardRow => ({ id: "c1", lecture_id: "l", kind: "qa", front: "f", back: "b", extra: "", figure: "", slides: [], topic: "", aspect: "other", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-02T00:00:00Z", deleted_at: null, ...o });
  const out = withAssociations(
    [card({}), card({ id: "c2", extra: "הסבר" }), card({ id: "c3" }), card({ id: "c4", deleted_at: "2026-11-03T00:00:00Z" })],
    [
      { card_id: "c1", body: "Quinine = Queen", author: "דניאל", since: "2026-11-05T00:00:00Z" },
      { card_id: "c2", body: "רמז", author: null, since: "2026-11-01T00:00:00Z" },
      { card_id: "c4", body: "x", author: null, since: "2026-11-05T00:00:00Z" },
    ],
  );
  assert.deepEqual(
    out.map((c) => [c.id, c.extra, c.updated_at]),
    [
      ["c1", "אסוציאציה: Quinine = Queen (דניאל)", "2026-11-05T00:00:00.000Z"],
      ["c2", "הסבר\nאסוציאציה: רמז", "2026-11-02T00:00:00Z"],
      ["c3", "", "2026-11-02T00:00:00Z"],
      ["c4", "", "2026-11-02T00:00:00Z"],
    ],
  );
});

const section = (idx: number, markdown: string, status: Section["status"] = "ready"): Section => ({
  lecture_id: "l",
  idx,
  title: `חלק ${idx}`,
  slide_from: 1,
  slide_to: 20,
  markdown,
  status,
  error: null,
  updated_at: "",
});

test("the paragraphs: by part, headings left out, first words; the hash is the op's sha256 of the trimmed text", async () => {
  const s = [section(0, "## Leishmania\n\nMiltefosine טרטוגנית (Black Box). [ש' 16]\n\n- Pentostam: Sb(V). [ש' 17]"), section(1, "## עוד", "writing")];
  assert.deepEqual(
    W.paragraphs(s).map((p) => [p.part, p.anchor, p.quote, p.slides]),
    [
      [0, 1, "Miltefosine טרטוגנית (Black Box).", [16]],
      [0, 2, "Pentostam: Sb(V).", [17]],
    ],
  );
  assert.equal(W.paragraphOf(s, 1, 0), null, "a part being written has none");
  assert.equal(await W.paragraphHash(" abc\n"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("the flag: VITE_STUDY_WALL alone; it needs section J at 1; ?v=wall is יחד's, its drafts and composer immersive; without the flag the lecture", () => {
  const on = flagsFrom({ VITE_STUDY_WALL: "1" });
  const off = flagsFrom({});
  assert.equal(on.wall, true);
  assert.equal(requiredSchema(on).J, 1);
  assert.equal(requiredSchema(off).J, undefined);
  const L = "eeeeeeee-0000-4000-8000-000000000005";
  const r = parseRoute(`?v=wall&l=${L}&at=1.4&x=drafts`);
  assert.deepEqual(r, { v: "wall", l: L, at: { part: 1, anchor: 4 }, x: "drafts" });
  assert.deepEqual(parseRoute(routeUrl(r).replace("/", "")), r);
  assert.equal(tabOf({ v: "wall", l: L }, on), "group");
  assert.equal(tabOf(r, on), null);
  assert.equal(allowed({ v: "wall", l: L }, off).route.v, "lecture");
  assert.deepEqual(allowed({ v: "wall", l: L, t: "needed" }, on).route, { v: "wall", l: L, t: "top" }, "דרושות needs the pulse");
});

test("help: the wall's row shows with the flag", () => {
  const on = flagsFrom({ VITE_STUDY_WALL: "1" });
  const W = { serverWrites: true, devicePrint: true };
  const row = helpRows(on, W).find((r) => r.title === "קיר האסוציאציות");
  assert.ok(row && row.text.includes("נשארו היום") && row.text.includes("בלי עלות"), "the drafts' daily 5, and a saved paragraph's free");
  assert.ok(!helpRows(flagsFrom({}), W).some((r) => r.title === "קיר האסוציאציות"));
});
