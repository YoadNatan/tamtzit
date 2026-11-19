import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import {
  bdiHtml,
  buildAnkiText,
  buildApkg,
  CSS,
  deckName,
  mineDeckName,
  DELETED_TAG,
  exportAnki,
  EXTRA_CSS,
  exportable,
  FIELDS,
  fieldChecksum,
  guidFor,
  lastExport,
  mediaName,
  NOTETYPE_ID,
  NOTETYPE_MOD,
  packageInput,
  stripHtml,
  toAnki,
  type CardRow,
  type ExportInput,
} from "./anki";

/* C-2 and C-4 (spec §7.C): the Anki mapping checks of design-cards §6.2
 * (moved), research-anki's guard on the field list, and the structural checks
 * of a package built by this exporter, read back with sql.js and JSZip as
 * Anki's importer reads it (where Anki 26.9.4 is installed, the real import
 * runs outside the unit tests: docs/study/cards.md). The cards are synthetic:
 * the fixture lecture's diuretics, nothing from the group's own lectures. */

const GROUP = "22222222-2222-4222-8222-222222222222";
const LEC = "eeeeeeee-0000-4000-8000-000000000005";
const LEC2 = "eeeeeeee-0000-4000-8000-000000000006";
const T1 = "2026-11-10T10:00:00Z";
const T2 = "2026-11-12T10:00:00Z";
const row = (over: Partial<CardRow>): CardRow => ({
  id: "11111111-0000-4000-8000-000000000001",
  lecture_id: LEC,
  kind: "qa",
  front: "",
  back: "",
  extra: "",
  figure: "",
  slides: [6],
  topic: "Furosemide",
  aspect: "mechanism",
  created_at: T1,
  updated_at: T1,
  deleted_at: null,
  ...over,
});
const card = (n: number, over: Partial<CardRow>) => row({ id: `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`, ...over });

/** A tiny real JPEG. */
const JPEG = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  ),
);

/* ── the mapping (design-cards §6.2, moved) ── */

test("bdi: a whole Latin run with its bracket, as the reader isolates it", () => {
  assert.equal(bdiHtml("Sodium chloride (NaCl®) היא מלח"), "<bdi>Sodium chloride (NaCl®)</bdi> היא מלח");
  assert.equal(bdiHtml("Furosemide IV (לאט) בבצקת ריאות"), "<bdi>Furosemide IV</bdi> (לאט) בבצקת ריאות", "the run never takes the bracket that opens the Hebrew");
  assert.equal(bdiHtml("No Hebrew at all"), "No Hebrew at all", "an English line stays as it is");
});

test("bdi: text is HTML-escaped", () => {
  const h = bdiHtml('ה-NKCC2 ב-<x> & "y"');
  assert.ok(!/<x|"y"/.test(h), h);
  assert.ok(h.includes("&lt;") && h.includes("&gt;") && h.includes("&amp;"), h);
  assert.ok(h.startsWith("ה-<bdi>NKCC2</bdi>"), h);
});

test("anki: a cloze travels as front with […] and back with the whole sentence", () => {
  const cz = toAnki(row({ kind: "cloze", front: "Furosemide מעכבת את {{NKCC2}} בלולאה של Henle." }), { title: "משתנים (Diuretics)" }, () => null);
  assert.ok(cz.front.includes('<span class="cloze">[…]</span>'), cz.front);
  assert.ok(!cz.front.includes("NKCC2"), cz.front);
  assert.ok(cz.back.includes('<b class="cloze"><bdi>NKCC2</bdi></b>'), cz.back);
  const he = toAnki(row({ kind: "cloze", front: "Hydrochlorothiazide גורמת ל-{{היפרגליקמיה}} ולהיפראוריצמיה." }), { title: "L" }, () => null);
  assert.ok(he.back.includes('<b class="cloze">היפרגליקמיה</b>'), "a Hebrew hidden part is bold, without an extra isolate");
});

test("anki: a deleted card carries the tag and a visible mark", () => {
  const del = toAnki(row({ front: "שאלה?", back: "תשובה", deleted_at: "2026-11-03T10:00:00Z", updated_at: "2026-11-03T10:00:00Z" }), { title: "L" }, () => null);
  assert.ok(del.tags!.includes(DELETED_TAG));
  assert.ok(del.front.startsWith('<div class="del">נמחקה בקבוצה</div>'));
  assert.equal(DELETED_TAG, "tamtzit::נמחק");
});

test("anki: figure file name, tags, source, and note mod = updated_at", () => {
  const fig = toAnki(row({ front: "q?", back: "a", figure: "fig:17-1", slides: [17, 18], topic: "Loop diuretics", aspect: "adverse" }), { title: "Diuretics" }, (f) => mediaName(LEC, f));
  assert.equal(fig.image, `tz-${LEC}-s17-1.jpg`);
  assert.equal(fig.updatedAt, Date.parse(T1));
  assert.deepEqual(fig.tags, ["tamtzit", "tamtzit::adverse", "Loop_diuretics"]);
  assert.equal(fig.source, "<bdi>Diuretics</bdi> · ש׳ <bdi>17,18</bdi>");
  assert.equal(mediaName(LEC, "not a figure"), null);
});

test("anki: deleted cards go only to a device whose last export carried them", () => {
  const last = Date.parse("2026-11-02T12:00:00Z");
  const rows = [
    row({ id: "alive", created_at: "2026-11-01T10:00:00Z" }),
    row({ id: "gone-after", created_at: "2026-11-01T10:00:00Z", deleted_at: "2026-11-03T00:00:00Z" }),
    row({ id: "gone-before", created_at: "2026-11-01T10:00:00Z", deleted_at: "2026-11-02T11:00:00Z" }),
    row({ id: "born-and-gone-after", created_at: "2026-11-02T13:00:00Z", deleted_at: "2026-11-03T00:00:00Z" }),
  ];
  assert.equal(exportable(rows, last).map((r) => r.id).join(), "alive,gone-after");
  assert.equal(exportable(rows, null).map((r) => r.id).join(), "alive");
});

test("anki: deck name, :: inside a title replaced", () => {
  assert.equal(deckName("פרמקולוגיה לדוגמה", "Loop::diuretics"), "תמצית::פרמקולוגיה לדוגמה::Loop:diuretics");
  assert.equal(deckName("", "x"), "תמצית::בלי קורס::x");
});

test("the field list is permanent while the note type keeps its id (research-anki's guard)", () => {
  // Changing the fields with the same NOTETYPE_ID makes every student's notes "conflicting".
  if (NOTETYPE_ID === 1763164800001) assert.deepEqual([...FIELDS], ["Front", "Back", "Extra", "Image", "Source"]);
  assert.ok(Object.isFrozen(FIELDS));
  assert.ok(CSS.includes(EXTRA_CSS) && !/color\s*:/.test(CSS), "the CSS carries the cloze and deleted marks, and no colours (night mode)");
  assert.ok(NOTETYPE_MOD > 1763164800, "the note type's mod was raised with EXTRA_CSS");
});

/* ── a package, read back as Anki's importer reads it (C-4's structural checks) ── */

const lectures = (cards1: CardRow[], cards2: CardRow[] = []): ExportInput["lectures"] => [
  { id: LEC, title: "משתנים (Diuretics)", course: "פרמקולוגיה לדוגמה", figures: (f) => (f === "fig:6-1" ? `${GROUP}/${LEC}/s6-1.jpg` : null), cards: cards1 },
  { id: LEC2, title: "Loop diuretics: תרגול", course: "פרמקולוגיה לדוגמה", figures: () => null, cards: cards2 },
];
const deckCards = (): CardRow[] => [
  card(1, { front: "מה מנגנון הפעולה של Furosemide?", back: "עיכוב NKCC2 בלולאה העולה העבה.", extra: "לכן היא משתן חזק.", figure: "fig:6-1", slides: [6] }),
  card(2, { kind: "cloze", front: "Furosemide נותנים {{IV לאט}} בבצקת ריאות.", slides: [3], topic: "Furosemide", aspect: "dosing" }),
  card(3, { front: "איזו תופעת לוואי של Loop diuretics פוגעת בשמיעה?", back: "Ototoxicity.", slides: [8], aspect: "adverse" }),
];

async function readPackage(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const SQL = await initSqlJs();
  const db = new SQL.Database(await zip.file("collection.anki2")!.async("uint8array"));
  const all = (sql: string) => {
    const r = db.exec(sql)[0];
    return r ? r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) : [];
  };
  return { zip, db, all };
}

test("the package: a legacy zip with collection.anki2 (schema 11), the media map and the files under their index", async () => {
  const SQL = await initSqlJs();
  const input = await packageInput({ groupId: GROUP, lectures: lectures(deckCards()), pictures: true, format: "apkg", fetchPicture: async () => JPEG, now: Date.parse(T2) });
  assert.equal(input.count, 3);
  const bytes = await buildApkg(SQL, JSZip, input);
  const { zip, db, all } = await readPackage(bytes);
  assert.deepEqual(Object.keys(zip.files).sort(), ["0", "collection.anki2", "media"]);
  assert.deepEqual(JSON.parse(await zip.file("media")!.async("string")), { "0": `tz-${LEC}-s6-1.jpg` });
  assert.deepEqual(await zip.file("0")!.async("uint8array"), JPEG);
  assert.deepEqual(all("select name from sqlite_master where type = 'table' order by name").map((r) => r.name), ["cards", "col", "graves", "notes", "revlog"]);
  const col = all("select * from col");
  assert.equal(col.length, 1);
  assert.equal(col[0].ver, 11);
  const models = JSON.parse(String(col[0].models));
  const nt = models[String(NOTETYPE_ID)];
  assert.equal(nt.name, "תמצית (עברית)");
  assert.equal(nt.mod, NOTETYPE_MOD);
  assert.deepEqual(nt.flds.map((f: { name: string }) => f.name), [...FIELDS]);
  assert.deepEqual(nt.flds.map((f: { rtl: boolean }) => f.rtl), [true, true, true, false, true], "every field right to left but the picture");
  assert.ok(nt.tmpls[0].qfmt.includes('dir="rtl"') && nt.tmpls[0].afmt.includes("{{FrontSide}}"));
  const decks = JSON.parse(String(col[0].decks));
  assert.deepEqual(Object.values(decks).map((d) => (d as { name: string }).name).sort(), ["Default", "תמצית::פרמקולוגיה לדוגמה::משתנים (Diuretics)"].sort());
  db.close();
});

test("the package: one note per card with its GUID, fields, tags, checksum and mod; one new card each, in deck order", async () => {
  const SQL = await initSqlJs();
  const rows = deckCards();
  const bytes = await buildApkg(SQL, JSZip, await packageInput({ groupId: GROUP, lectures: lectures(rows), pictures: true, format: "apkg", fetchPicture: async () => JPEG, now: Date.parse(T2) }));
  const { db, all } = await readPackage(bytes);
  const notes = all("select * from notes order by id");
  assert.equal(notes.length, 3);
  for (const [i, n] of notes.entries()) {
    const c = rows[i];
    assert.equal(n.guid, await guidFor("tamtzit", GROUP, c.id), "the GUID is the card's, through every edit");
    assert.equal(n.mid, NOTETYPE_ID);
    assert.equal(n.mod, Math.floor(Date.parse(c.updated_at) / 1000), "the note's mod is the card's updated_at, not the export's time");
    const flds = String(n.flds).split("\u001f");
    assert.equal(flds.length, 5);
    assert.equal(n.sfld, stripHtml(flds[0]));
    assert.equal(n.csum, await fieldChecksum(flds[0]));
    assert.ok(String(n.tags).startsWith(" tamtzit tamtzit::") && String(n.tags).endsWith(" "));
  }
  assert.equal(new Set(notes.map((n) => n.guid)).size, 3);
  const first = String(notes[0].flds).split("\u001f");
  assert.equal(first[3], `<img src="tz-${LEC}-s6-1.jpg">`);
  assert.ok(first[0].includes("<bdi>Furosemide</bdi>") && first[1].includes("<bdi>NKCC2</bdi>"));
  const cloze = String(notes[1].flds).split("\u001f");
  assert.ok(cloze[0].includes('<span class="cloze">[…]</span>') && cloze[1].includes('<b class="cloze"><bdi>IV</bdi> לאט</b>'), cloze.join(" | "));
  const cards = all("select * from cards order by due");
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => [c.ord, c.type, c.queue, c.due, c.reps]), [[0, 0, 0, 1, 0], [0, 0, 0, 2, 0], [0, 0, 0, 3, 0]]);
  assert.deepEqual(cards.map((c) => c.nid), notes.map((n) => n.id));
  assert.equal(new Set(cards.map((c) => c.did)).size, 1);
  db.close();
});

test("a re-export after the group fixed one card and deleted another: same GUIDs, only those two notes newer, the deleted one tagged", async () => {
  const SQL = await initSqlJs();
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  try {
    const v1 = deckCards();
    store.set(`study-anki-exported:${LEC}`, String(Date.parse("2026-11-11T00:00:00Z"))); // the device's last export, between T1 and T2
    const v2 = v1.map((c, i) => (i === 0 ? { ...c, back: `${c.back} (תוקן בקבוצה)`, updated_at: T2 } : i === 2 ? { ...c, deleted_at: T2, updated_at: T2 } : c));
    const a = await readPackage(await buildApkg(SQL, JSZip, await packageInput({ groupId: GROUP, lectures: lectures(v1), pictures: false, format: "apkg" })));
    const b = await readPackage(await buildApkg(SQL, JSZip, await packageInput({ groupId: GROUP, lectures: lectures(v2), pictures: false, format: "apkg" })));
    const before = a.all("select guid, mod, tags from notes order by guid");
    const after = b.all("select guid, mod, tags, flds from notes order by guid");
    assert.deepEqual(after.map((n) => n.guid), before.map((n) => n.guid), "the same notes, no new one");
    const newer = after.filter((n, i) => Number(n.mod) > Number(before[i].mod));
    assert.equal(newer.length, 2);
    const gone = after.find((n) => String(n.tags).includes(DELETED_TAG));
    assert.ok(gone && String(gone.flds).startsWith('<div class="del">נמחקה בקבוצה</div>'));
    // A device that never exported the lecture gets only the live cards.
    store.clear();
    const fresh = await packageInput({ groupId: GROUP, lectures: lectures(v2), pictures: false, format: "apkg" });
    assert.equal(fresh.count, 2);
    a.db.close();
    b.db.close();
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("a share sheet closed without sharing is no export: nothing is remembered, and the next package still carries the deleted card (ANKI-CANCEL)", async () => {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const shared: File[] = [];
  let answer: "close" | "share" = "close";
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      canShare: (d: { files: File[] }) => d.files.length === 1,
      share: async (d: { files: File[] }) => {
        if (answer === "close") throw new DOMException("Share canceled", "AbortError");
        shared.push(...d.files);
      },
    },
  });
  try {
    const lastReal = Date.parse("2026-11-11T00:00:00Z"); // after the cards were made (T1), before the delete (T2)
    store.set(`study-anki-exported:${LEC}`, String(lastReal));
    const cards = deckCards().map((c, i) => (i === 2 ? { ...c, deleted_at: T2, updated_at: T2 } : c));
    const input = { groupId: GROUP, lectures: lectures(cards), pictures: false, format: "text" as const };
    const closed = await exportAnki({ ...input, now: Date.parse("2026-11-13T10:00:00Z") });
    assert.equal(closed.via, "cancelled");
    assert.equal(shared.length, 0);
    assert.equal(lastExport(LEC), lastReal, "the last export is still the last real one");
    const next = await packageInput(input);
    assert.equal(next.count, 3, "the next package: the two live cards and the deleted one");
    assert.equal(next.decks[0].cards.filter((c) => (c.tags ?? []).includes(DELETED_TAG)).length, 1, "the deleted card still travels, tagged");
    answer = "share";
    const sent = await exportAnki({ ...input, now: Date.parse("2026-11-14T10:00:00Z") });
    assert.equal(sent.via, "share");
    assert.equal(shared.length, 1);
    assert.equal(lastExport(LEC), Date.parse("2026-11-14T10:00:00Z"), "a real share is remembered");
    assert.equal((await packageInput(input)).count, 2, "after it, the deleted card is not sent again");
  } finally {
    if (nav) Object.defineProperty(globalThis, "navigator", nav);
    delete g.localStorage;
  }
});

test("pictures: only the ones the cards use, fetched once; off, or not fetched, the card goes without", async () => {
  const fetched: string[] = [];
  const rows = [...deckCards(), card(4, { front: "מה רואים בשקף?", back: "את הנפרון.", figure: "fig:6-1", slides: [6] }), card(5, { front: "ומה כאן?", back: "שום דבר.", figure: "fig:9-9", slides: [9] })];
  const withPics = await packageInput({ groupId: GROUP, lectures: lectures(rows), pictures: true, format: "apkg", fetchPicture: async (p) => (fetched.push(p), JPEG) });
  assert.deepEqual(fetched, [`${GROUP}/${LEC}/s6-1.jpg`], "one fetch for the one stored picture two cards use; an unknown figure is not fetched");
  assert.equal(withPics.media.length, 1);
  assert.equal(withPics.decks[0].cards.filter((c) => c.image).length, 2);
  const none = await packageInput({ groupId: GROUP, lectures: lectures(rows), pictures: false, format: "apkg", fetchPicture: async () => JPEG });
  assert.equal(none.media.length, 0);
  assert.equal(none.decks[0].cards.filter((c) => c.image).length, 0);
  const failed = await packageInput({ groupId: GROUP, lectures: lectures(rows), pictures: true, format: "apkg", fetchPicture: async () => null });
  assert.equal(failed.decks[0].cards.filter((c) => c.image).length, 0, "a picture that did not arrive leaves the field empty");
});

test("two lectures: one deck each, ids apart; a lecture with no cards adds no deck", async () => {
  const SQL = await initSqlJs();
  const second = [card(10, { lecture_id: LEC2, front: "מה מעכבות Loop diuretics?", back: "את NKCC2.", slides: [6] })];
  const input = await packageInput({ groupId: GROUP, lectures: lectures(deckCards(), second), pictures: false, format: "apkg" });
  assert.equal(input.decks.length, 2);
  const { db, all } = await readPackage(await buildApkg(SQL, JSZip, input));
  const decks = JSON.parse(String(all("select decks from col")[0].decks));
  assert.equal(Object.keys(decks).length, 3);
  assert.equal(new Set(all("select did from cards").map((c) => c.did)).size, 2);
  db.close();
  assert.equal((await packageInput({ groupId: GROUP, lectures: lectures([], second), pictures: false, format: "apkg" })).decks.length, 1);
});

test("the text file: Anki's headers, quoted fields, and the package's GUIDs", async () => {
  const input = await packageInput({ groupId: GROUP, lectures: lectures(deckCards()), pictures: false, format: "text" });
  const text = await buildAnkiText(GROUP, input.decks[0].cards, { deck: input.decks[0].name });
  const lines = text.trimEnd().split("\n");
  assert.deepEqual(lines.slice(0, 5), ["#separator:tab", "#html:true", "#tags column:3", "#guid column:4", "#deck:תמצית::פרמקולוגיה לדוגמה::משתנים (Diuretics)"]);
  assert.equal(lines.length, 5 + 3);
  const cols = lines[5].split("\t");
  assert.equal(cols.length, 4);
  assert.ok(cols.every((c) => c.startsWith('"') && c.endsWith('"')));
  assert.equal(cols[3], `"${await guidFor("tamtzit", GROUP, deckCards()[0].id)}"`);
  assert.ok(!text.includes("#notetype"), "no note type header: a Hebrew Anki has no Basic");
  const quoted = await buildAnkiText(GROUP, [{ key: "k", front: 'מה זה "Loop"?', back: "שורה\tעם\nטאב", updatedAt: 0 }]);
  const last = quoted.trimEnd().split("\n").pop()!;
  assert.ok(last.startsWith('"<div dir=""rtl"">מה זה ""Loop""?</div>"'), "inner quotes doubled");
  assert.equal(last.split("\t").length, 4, "a tab or a line break inside a field becomes a space");
});

test("the exporter refuses what Anki would choke on", async () => {
  const SQL = await initSqlJs();
  const base = { namespace: GROUP, media: [] as Array<{ name: string; data: Uint8Array }> };
  const one = (c: Partial<{ front: string; image: string }>) => ({ ...base, decks: [{ key: LEC, name: "x", cards: [{ key: "k", front: "f", back: "b", updatedAt: 0, ...c }] }] });
  await assert.rejects(buildApkg(SQL, JSZip, one({ front: " " })), /empty front/);
  await assert.rejects(buildApkg(SQL, JSZip, one({ image: "missing.jpg" })), /missing media/);
  await assert.rejects(buildApkg(SQL, JSZip, one({ front: "a\u001fb" })), /control character/);
  await assert.rejects(buildApkg(SQL, JSZip, { ...one({}), media: [{ name: "../evil.jpg", data: JPEG }] }), /bad media name/);
});

/* ── C's end (§12.3.C): the member's private cards travel in their own deck under the lecture's ── */

test("C's end: private cards export as …::הטעויות שלי, never their deleted ones, beside the lecture's own deck", async () => {
  assert.equal(mineDeckName("פרמקולוגיה לדוגמה", "משתנים (Diuretics)"), "תמצית::פרמקולוגיה לדוגמה::משתנים (Diuretics)::הטעויות שלי");
  const mine: CardRow[] = [
    card(91, { front: "שאלה 1?", back: "Hypnozoite: למה ב", extra: "ענית Schizont: למה ג", slides: [5], topic: "", aspect: "other" }),
    card(92, { front: "שאלה 2?", back: "x", slides: [5], deleted_at: T2 }),
  ];
  const [l1, l2] = lectures(deckCards());
  const input = await packageInput({ groupId: GROUP, lectures: [{ ...l1, mine }, l2], pictures: false, format: "apkg", now: Date.parse(T2) });
  assert.equal(input.count, 4, "three of the deck and one private card");
  assert.deepEqual(input.decks.map((d) => [d.name, d.cards.length]), [
    ["תמצית::פרמקולוגיה לדוגמה::משתנים (Diuretics)", 3],
    ["תמצית::פרמקולוגיה לדוגמה::משתנים (Diuretics)::הטעויות שלי", 1],
  ]);
  const own = input.decks[1].cards[0];
  assert.equal(own.key, mine[0].id);
  assert.ok(own.extra?.includes("ענית") && own.back.includes("Hypnozoite"));
  const SQL = await initSqlJs();
  const { all, db } = await readPackage(await buildApkg(SQL, JSZip, input));
  assert.equal(all("select count(*) as n from notes")[0].n, 4);
  assert.equal(new Set(all("select did from cards").map((r) => r.did)).size, 2, "two decks");
  db.close();
});
