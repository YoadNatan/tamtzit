import type JSZipType from "jszip";
import type { SqlJsStatic } from "sql.js";
import { clozeParts } from "../../../shared/study/cloze";
import { HEBREW, LATIN_RUN, trimRun } from "./bidi";

/* ── Export to Anki (spec §4.7, §5.5; research-anki §1, design-cards §4.4) ──
 *
 * Loaded lazily, on "ייצוא ל-Anki" only (with sql.js and its wasm), so the
 * reader's bundle does not grow. Writes a deck package (.apkg) in the legacy
 * format every current Anki client imports: a zip with
 *   collection.anki2  a SQLite database, collection schema 11
 *   media             JSON {"0": "file.jpg", ...}
 *   0, 1, ...         the media files, stored under their index
 * (Anki 26.9.4's import_export.proto: VERSION_LEGACY_1 = "When `meta`
 * missing, and collection.anki2 file present"), or, for a student who imports
 * text, a tab-separated file with Anki's headers.
 *
 * Identity, so a re-export updates instead of duplicating:
 *   - note guid  = base91(first 8 bytes of SHA-256("tamtzit|<group>|<card>")),
 *                  so a card keeps its GUID through every edit;
 *   - note mod   = the card's own updated_at, so Anki's default "update notes:
 *                  if newer" rewrites only cards that changed in the group,
 *                  and a student's own edit in Anki survives until then;
 *   - notetype   = one fixed id with the fixed fields Front, Back, Extra,
 *                  Image, Source (forever: a new field list needs a new id);
 *                  its mod is raised only when the templates or CSS change;
 *   - deck       = תמצית::<course>::<lecture>, matched by name.
 * A card deleted in the group goes once more, tagged tamtzit::נמחק, to a
 * device whose last export of the lecture carried it alive.
 *
 * Every whole Latin run is isolated in <bdi> by the reader's own rule
 * (bidi.ts): a run split across a tag renders backwards. The CSS sets no
 * colours, so Anki's night mode keeps working. The research's exporter and
 * the design's card mapping, ported. */

/* ─────────────── the shared card as an Anki note ─────────────── */

/** The columns of a shared card the export reads (study_cards). */
export type CardRow = {
  id: string;
  lecture_id: string;
  kind: "qa" | "cloze";
  front: string;
  back: string;
  extra: string;
  figure: string;
  slides: number[];
  topic: string;
  aspect: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type AnkiCard = {
  /** The card's id in our database. Never reuse one for another card. */
  key: string;
  /** HTML. */
  front: string;
  /** HTML. */
  back: string;
  /** HTML: the card's explanation. */
  extra?: string;
  /** A media file name added in `media` (empty: no picture). */
  image?: string;
  /** HTML: the lecture and the slides. */
  source?: string;
  tags?: string[];
  /** ms since epoch: when the card last changed in the app. */
  updatedAt: number;
};
export type AnkiDeck = { key: string; name: string; cards: AnkiCard[] };
export type AnkiExport = {
  /** The group id: keeps GUIDs unique to this group. */
  namespace: string;
  decks: AnkiDeck[];
  media: Array<{ name: string; data: Uint8Array }>;
  now?: number;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → HTML with every whole Latin run in <bdi> (isolateLatin, as a string). */
export function bdiHtml(text: string): string {
  if (!HEBREW.test(text)) return esc(text);
  let out = "";
  let last = 0;
  LATIN_RUN.lastIndex = 0;
  for (let m = LATIN_RUN.exec(text); m; m = LATIN_RUN.exec(text)) {
    const run = trimRun(m[0]);
    if (!run) continue;
    const at = text.indexOf(run, m.index);
    const idx = at >= 0 ? at : m.index;
    if (idx > last) out += esc(text.slice(last, idx));
    out += `<bdi>${esc(run)}</bdi>`;
    last = idx + run.length;
    LATIN_RUN.lastIndex = last;
  }
  return out + esc(text.slice(last));
}

/** The hidden part of a cloze, isolated as one unit with its own direction. */
function clozeHtml(front: string, reveal: boolean): string {
  const p = clozeParts(front);
  if (!p) return bdiHtml(front);
  const hidden = reveal ? `<b class="cloze">${HEBREW.test(p.answer) ? bdiHtml(p.answer) : `<bdi>${esc(p.answer)}</bdi>`}</b>` : `<span class="cloze">[…]</span>`;
  return `${bdiHtml(p.before)}${hidden}${bdiHtml(p.after)}`;
}

export const DELETED_TAG = "tamtzit::נמחק";

/** One shared card as an Anki note. `media` names the figure's file in the
 *  package (tz-<lecture>-s<n>-<k>.jpg), or null when pictures are left out.
 *  A cloze travels as an ordinary note of the one note type: Front is the
 *  sentence with "[…]", Back the whole sentence with the hidden part bold. */
export function toAnki(c: CardRow, lecture: { title: string }, media: (fig: string) => string | null): AnkiCard {
  const deleted = c.deleted_at !== null;
  const front = (deleted ? `<div class="del">נמחקה בקבוצה</div>` : "") + (c.kind === "cloze" ? clozeHtml(c.front, false) : bdiHtml(c.front));
  const back = c.kind === "cloze" ? clozeHtml(c.front, true) : bdiHtml(c.back);
  const image = c.figure ? media(c.figure) : null;
  const tags = ["tamtzit", `tamtzit::${c.aspect}`, ...(c.topic ? [c.topic.trim().replace(/\s+/g, "_")] : []), ...(deleted ? [DELETED_TAG] : [])];
  return {
    key: c.id,
    front,
    back,
    extra: c.extra ? bdiHtml(c.extra) : "",
    ...(image ? { image } : {}),
    // The title and the slide list each isolated as one unit (an English
    // title next to Hebrew; "12,14" as a slide tag prints it).
    source: `<bdi>${bdiHtml(lecture.title)}</bdi> · ש׳ <bdi>${c.slides.join(",")}</bdi>`,
    tags,
    updatedAt: Date.parse(c.updated_at),
  };
}

/** J-2 (W-24): the wall's association on each card goes into its Extra,
 *  "אסוציאציה: {body}" (+ " ({name})" when posted by name), after the
 *  card's own explanation; the note's time is the later of the card's and
 *  the association's, so a re-export updates the note in Anki when the
 *  winner (or the member's own pin) changes. */
export type CardAssociation = { card_id: string; body: string; author: string | null; since: string };
export function withAssociations<C extends CardRow>(cards: C[], aids: CardAssociation[]): C[] {
  const by = new Map(aids.map((a) => [a.card_id, a]));
  return cards.map((c) => {
    const a = by.get(c.id);
    if (!a || c.deleted_at !== null) return c;
    const line = `אסוציאציה: ${a.body}${a.author ? ` (${a.author})` : ""}`;
    const since = Date.parse(a.since);
    const updated = Number.isFinite(since) && since > Date.parse(c.updated_at) ? new Date(since).toISOString() : c.updated_at;
    return { ...c, extra: c.extra ? `${c.extra}\n${line}` : line, updated_at: updated };
  });
}

/** Which cards a package carries: every active card, and a deleted card only
 *  when this device's last export of the lecture carried it alive (created
 *  before that export, deleted after it). Then Anki updates the note ("if
 *  newer": deletion raised updated_at) and it shows the tag; nobody who never
 *  had the card gets it. */
export function exportable<T extends Pick<CardRow, "created_at" | "deleted_at">>(cards: T[], lastExportMs: number | null): T[] {
  return cards.filter(
    (c) => c.deleted_at === null || (lastExportMs !== null && Date.parse(c.created_at) < lastExportMs && Date.parse(c.deleted_at) > lastExportMs),
  );
}

/** The media file name for a figure, unique in Anki's flat media folder. */
export const mediaName = (lectureId: string, fig: string): string | null => {
  const m = /^fig:(\d+)-(\d+)$/.exec(fig);
  return m ? `tz-${lectureId}-s${m[1]}-${m[2]}.jpg` : null;
};

/** Deck name: תמצית::<course>::<lecture>, with "::" inside a name replaced. */
export const deckName = (course: string, title: string): string =>
  ["תמצית", course.trim() || "בלי קורס", title.trim()].map((s) => s.replace(/::/g, ":").replace(/\s+/g, " ")).join("::");

/** C's end: the member's private cards of a lecture, a deck under it (…::הטעויות שלי). */
export const MINE_DECK = "הטעויות שלי";
export const mineDeckName = (course: string, title: string): string => `${deckName(course, title)}::${MINE_DECK}`;

/* ─────────────── the package (research-anki's exporter) ─────────────── */

/** One note type for every export, forever. Change FIELDS and it needs a new id. */
export const NOTETYPE_ID = 1763164800001;
/** Raised when TEMPLATE_* or CSS change, so a re-import picks up the new look
 *  (raised with EXTRA_CSS, the cloze and deleted marks). */
export const NOTETYPE_MOD = 1794700800;
export const FIELDS: readonly string[] = Object.freeze(["Front", "Back", "Extra", "Image", "Source"]);

const TEMPLATE_FRONT = `<div class="tz" dir="rtl" lang="he"><div class="q">{{Front}}</div></div>`;
const TEMPLATE_BACK = `{{FrontSide}}
<hr id="answer">
<div class="tz" dir="rtl" lang="he">
<div class="a">{{Back}}</div>
{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}
{{#Image}}<div class="fig">{{Image}}</div>{{/Image}}
{{#Source}}<div class="src">{{Source}}</div>{{/Source}}
</div>`;

/** The cloze and deleted marks: no colours, so Anki's night mode keeps working. */
export const EXTRA_CSS = `.tz .cloze { font-weight: 700; text-decoration: underline; }
.tz .del { font-size: 14px; opacity: 0.7; margin-bottom: 8px; }
`;

export const CSS = `.card {
  font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
  font-size: 20px;
  line-height: 1.55;
  text-align: right;
}
.tz { direction: rtl; text-align: right; max-width: 38em; margin: 0 auto; }
.tz bdi { unicode-bidi: isolate; }
.tz .q { font-weight: 600; }
.tz .fig img { max-width: 100%; height: auto; display: block; margin: 12px auto 0; }
.tz .extra { margin-top: 10px; font-size: 17px; }
.tz .src { margin-top: 14px; font-size: 14px; opacity: 0.7; }
${EXTRA_CSS}`;

const BASE91 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";

async function digest(algo: "SHA-1" | "SHA-256", text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algo, new TextEncoder().encode(text)));
}

/** Anki's own GUID shape (anki/utils.py guid64: base91 of a 64-bit number),
 *  from a hash instead of a random number, as genanki's guid_for does. */
export async function guidFor(...parts: string[]): Promise<string> {
  const b = await digest("SHA-256", parts.join("|"));
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(b[i]);
  let out = "";
  while (n > 0n) {
    out = BASE91[Number(n % 91n)] + out;
    n /= 91n;
  }
  return out || "a";
}

/** A positive id below 2^53 from a key (deck ids). */
async function idFor(...parts: string[]): Promise<number> {
  const b = await digest("SHA-256", parts.join("|"));
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + b[i];
  return 1_000_000_000 + (n % 2 ** 40);
}

/** What Anki stores in sfld/csum: field text without HTML (media names kept). */
export function stripHtml(html: string): string {
  return html
    .replace(/<img[^>]*src=["']?([^"'>]+)["']?[^>]*>/gi, " $1 ")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** anki/utils.py field_checksum: int of the first 8 hex digits of SHA-1. */
export async function fieldChecksum(html: string): Promise<number> {
  const b = await digest("SHA-1", stripHtml(html));
  return ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
}

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

function deckJson(id: number, name: string, mod: number) {
  return {
    id, name, mod, usn: -1, desc: "", dyn: 0, conf: 1, collapsed: false, browserCollapsed: false,
    extendNew: 0, extendRev: 0, newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
  };
}

function notetypeJson() {
  return {
    id: NOTETYPE_ID,
    name: "תמצית (עברית)",
    type: 0,
    mod: NOTETYPE_MOD,
    usn: -1,
    sortf: 0,
    did: null,
    tmpls: [{ name: "כרטיס", ord: 0, qfmt: TEMPLATE_FRONT, afmt: TEMPLATE_BACK, bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0 }],
    flds: FIELDS.map((name, ord) => ({ name, ord, sticky: false, rtl: name !== "Image", font: "Arial", size: 20, media: [] })),
    css: CSS,
    latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    latexsvg: false,
    req: [[0, "any", [0]]],
    tags: [],
    vers: [],
  };
}

const DCONF = {
  1: {
    id: 1, name: "Default", mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
    new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20 },
    rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
    lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
  },
};

function isMedia(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name);
}

/** Builds the .apkg bytes. SQL is an initialised sql.js module. */
export async function buildApkg(SQL: SqlJsStatic, JSZip: typeof JSZipType, input: AnkiExport): Promise<Uint8Array> {
  const now = input.now ?? Date.now();
  const nowSec = Math.floor(now / 1000);
  const db = new SQL.Database();
  try {
    db.run(SCHEMA);
    const decks: Record<string, unknown> = { 1: deckJson(1, "Default", nowSec) };
    let nextId = now;
    let due = 1;
    const mediaNames = new Set(input.media.map((m) => m.name));
    for (const m of input.media) if (!isMedia(m.name)) throw new Error(`bad media name: ${m.name}`);
    const noteSql = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const cardSql = db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    db.run("BEGIN");
    for (const deck of input.decks) {
      const did = await idFor("tamtzit-deck", input.namespace, deck.key);
      decks[did] = deckJson(did, deck.name, nowSec);
      for (const c of deck.cards) {
        if (!c.front.trim()) throw new Error(`empty front: ${c.key}`);
        if (c.image && !mediaNames.has(c.image)) throw new Error(`missing media: ${c.image}`);
        const image = c.image ? `<img src="${c.image}">` : "";
        const fields = [c.front, c.back, c.extra ?? "", image, c.source ?? ""];
        for (const f of fields) if (/[\u0000\u001f]/.test(f)) throw new Error(`control character in ${c.key}`);
        const nid = nextId++;
        const mod = Math.floor(c.updatedAt / 1000);
        const tags = (c.tags ?? []).map((t) => t.trim().replace(/\s+/g, "_")).filter(Boolean);
        noteSql.run([
          nid,
          await guidFor("tamtzit", input.namespace, c.key),
          NOTETYPE_ID,
          mod,
          -1,
          tags.length ? ` ${tags.join(" ")} ` : "",
          fields.join("\u001f"),
          stripHtml(c.front),
          await fieldChecksum(c.front),
          0,
          "",
        ]);
        // id, nid, did, ord, mod, usn, type=new, queue=new, due=position, ivl, factor, reps, lapses, left, odue, odid, flags, data
        cardSql.run([nextId++, nid, did, 0, mod, -1, 0, 0, due++, 0, 0, 0, 0, 0, 0, 0, 0, ""]);
      }
    }
    noteSql.free();
    cardSql.free();
    const conf = {
      activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true,
      dueCounts: true, curModel: null, nextPos: due, sortType: "noteFld", sortBackwards: false, addToCur: true,
    };
    db.run("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)", [
      nowSec, now, now, JSON.stringify(conf), JSON.stringify({ [NOTETYPE_ID]: notetypeJson() }),
      JSON.stringify(decks), JSON.stringify(DCONF), "{}",
    ]);
    db.run("COMMIT");
    const zip = new JSZip();
    zip.file("collection.anki2", db.export());
    const map: Record<string, string> = {};
    input.media.forEach((m, i) => {
      map[String(i)] = m.name;
      zip.file(String(i), m.data);
    });
    zip.file("media", JSON.stringify(map));
    return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  } finally {
    db.close();
  }
}

/* ── The text file ("קובץ טקסט"; Anki ≥ 2.1.54 file headers) ──
 * Tab-separated, HTML on, one note per line, for the stock two-field note
 * type. Columns: Front, Back (source and extra folded in), Tags, GUID. Every
 * field is quoted, with inner quotes doubled. The GUID column is the same
 * GUID the .apkg uses, so a re-import updates by GUID even when the question
 * was reworded. No notetype header: the import screen picks one (in a
 * Hebrew-language Anki the stock type is "בסיסי", not "Basic"). */
export async function buildAnkiText(namespace: string, cards: AnkiCard[], opts: { deck?: string; notetype?: string } = {}): Promise<string> {
  const q = (s: string) => `"${s.replace(/[\t\r\n]+/g, " ").trim().replace(/"/g, '""')}"`;
  const lines = ["#separator:tab", "#html:true", "#tags column:3", "#guid column:4"];
  if (opts.notetype) lines.push(`#notetype:${opts.notetype}`);
  if (opts.deck) lines.push(`#deck:${opts.deck}`);
  for (const c of cards) {
    const back =
      `<div dir="rtl">${c.back}</div>` +
      (c.extra ? `<div dir="rtl">${c.extra}</div>` : "") +
      (c.source ? `<div dir="rtl"><small>${c.source}</small></div>` : "");
    const tags = (c.tags ?? []).map((t) => t.trim().replace(/\s+/g, "_")).filter(Boolean).join(" ");
    lines.push([q(`<div dir="rtl">${c.front}</div>`), q(back), q(tags), q(await guidFor("tamtzit", namespace, c.key))].join("\t"));
  }
  return lines.join("\n") + "\n";
}

/* ─────────────── the export on the phone (K8) ─────────────── */

const EXPORTED = "study-anki-exported:";

/** When this device last exported a lecture (ms), or null. */
export function lastExport(lectureId: string): number | null {
  try {
    const v = Number(localStorage.getItem(EXPORTED + lectureId));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function rememberExport(lectureIds: string[], at: number): void {
  for (const id of lectureIds) {
    try {
      localStorage.setItem(EXPORTED + id, String(at));
    } catch {
      /* private mode: the next export sends no deleted card */
    }
  }
}

/** The file's date in Israel, "2026-11-16". */
function fileDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

export type ExportLecture = { id: string; title: string; course: string; figures: (fig: string) => string | null };
export type ExportInput = {
  groupId: string;
  /** The scope's lectures, each with its cards (deleted ones included) and
   *  where its pictures are stored; with C's end, the member's private
   *  cards of the lecture too (`mine`, their own deck). */
  lectures: Array<ExportLecture & { cards: CardRow[]; mine?: CardRow[] }>;
  pictures: boolean;
  format: "apkg" | "text";
  /** Fetches a stored picture (signed URLs), or null when it cannot. */
  fetchPicture?: (path: string) => Promise<Uint8Array | null>;
  now?: number;
};

/** What a package holds: per lecture, the exportable cards as notes, and the pictures they use. */
export async function packageInput(o: ExportInput): Promise<AnkiExport & { count: number }> {
  const media = new Map<string, Uint8Array>();
  const decks: AnkiDeck[] = [];
  let count = 0;
  for (const l of o.lectures) {
    const rows = exportable(l.cards, lastExport(l.id));
    const wanted = new Map<string, string>(); // media name → stored path
    if (o.pictures && o.fetchPicture) {
      for (const c of rows) {
        const name = c.figure ? mediaName(l.id, c.figure) : null;
        const path = c.figure ? l.figures(c.figure) : null;
        if (name && path) wanted.set(name, path);
      }
      for (const [name, path] of wanted) {
        if (media.has(name)) continue;
        const data = await o.fetchPicture(path).catch(() => null);
        if (data) media.set(name, data);
      }
    }
    const cards = rows.map((c) => toAnki(c, l, (fig) => {
      const name = mediaName(l.id, fig);
      return name && media.has(name) ? name : null;
    }));
    count += cards.length;
    if (cards.length) decks.push({ key: l.id, name: deckName(l.course, l.title), cards });
    const mine = (l.mine ?? []).filter((c) => c.deleted_at === null).map((c) => toAnki(c, l, () => null));
    count += mine.length;
    if (mine.length) decks.push({ key: `${l.id}:mine`, name: mineDeckName(l.course, l.title), cards: mine });
  }
  return { namespace: o.groupId, decks, media: [...media].map(([name, data]) => ({ name, data })), now: o.now, count };
}

/** Builds the file: the .apkg (sql.js and its wasm load here, never before) or the text. */
export async function buildExportFile(o: ExportInput): Promise<{ file: File; count: number }> {
  const now = o.now ?? Date.now();
  const input = await packageInput({ ...o, now });
  if (o.format === "text") {
    const one = o.lectures.length === 1 ? deckName(o.lectures[0].course, o.lectures[0].title) : undefined;
    const text = await buildAnkiText(o.groupId, input.decks.flatMap((d) => d.cards), one ? { deck: one } : {});
    return { file: new File([text], `tamtzit-${fileDate(now)}.txt`, { type: "text/plain" }), count: input.count };
  }
  const [{ default: initSqlJs }, wasm, { default: JSZip }] = await Promise.all([
    import("sql.js"),
    import("sql.js/dist/sql-wasm-browser.wasm?url"),
    import("jszip"),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasm.default });
  const bytes = await buildApkg(SQL, JSZip, input);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return { file: new File([copy.buffer], `tamtzit-${fileDate(now)}.apkg`, { type: "application/octet-stream" }), count: input.count };
}

/** Hands the file over: the share sheet where it takes files (the iPhone's
 *  home-screen app), else a download. "cancelled": the person closed the
 *  share sheet, so nothing left the phone. */
export async function deliverFile(file: File): Promise<"share" | "download" | "cancelled"> {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return "share";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled"; // closed by the person
      /* not allowed here (the tap's activation ran out): download instead */
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "download";
}

/** "ייצוא": builds the file for the scope, hands it over, and remembers the
 *  export per lecture (deleted cards then reach this device once). A share
 *  sheet closed without sharing is no export: nothing is remembered, so the
 *  next package still carries the cards the group deleted since the last
 *  real one, with their tag (review finding ANKI-CANCEL). */
export async function exportAnki(o: ExportInput): Promise<{ count: number; via: "share" | "download" | "cancelled" }> {
  const now = o.now ?? Date.now();
  const { file, count } = await buildExportFile({ ...o, now });
  const via = await deliverFile(file);
  if (via !== "cancelled") rememberExport(o.lectures.map((l) => l.id), now);
  return { count, via };
}
