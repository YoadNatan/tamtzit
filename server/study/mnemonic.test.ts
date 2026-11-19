import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { blockSources } from "../../shared/study/edits.js";
import { POLICY } from "./budget.js";
import { cleanSchema, type Spend } from "./claude.js";
import { DAILY_MNEMONICS } from "./limits.js";
import { checkMnemonic, KINDS, MNEMONIC_SYSTEM, mnemonicOp, mnemonicRequest, mnemonicSource, MnemonicSet, streamMnemonics, type MnemonicItem } from "./mnemonic.js";
import { deckText, errorText, HttpError, json, MODEL, REQUIRED_SCHEMA, slideText, tidyMarkdown, type Lecture, type StoredSlide } from "./study.js";

/* K-3 (spec §7.K), memory aids: design-collab §6.2's checks of the aid code
 * (test/run.ts, moved): the source of an aid, the checks on stand-in aids
 * (three good ones pass; five hostile ones fail, each for its own reason),
 * the request and the stream through 50 random chunkings; the prompt, the
 * request builder and the schema against the spec's own text; and the op in
 * Node, called as /api/study/ai called it (op "mnemonic" now routes to J's
 * ops/wall.ts, §12.1.4; J imports this module), against local mocks of
 * PostgREST, Auth and
 * Anthropic: the part's checks (busy, rewritten, an uneditable block), one
 * study_reserve before and one study_settle after the call (kind
 * "mnemonic", ref "<part>.<anchor>", the key), and a refusal settled then
 * thrown. The lecture and the aids are made for the tests (drugs that do not
 * exist). No key, no network. */

const ROOT = process.cwd();
const SPEC = readFileSync(join(ROOT, "docs/study/spec/spec-final.md"), "utf8");
const PROMPTS_TS = readFileSync(join(ROOT, "server/study/mnemonic.ts"), "utf8"); // the prompt moved here from prompts/collab.ts (§12.1.4)
const between = (s: string, from: string, to: string) => {
  const i = s.indexOf(from);
  assert.ok(i >= 0, `not found: ${from}`);
  const j = s.indexOf(to, i + from.length);
  assert.ok(j >= 0, `not found: ${to}`);
  return s.slice(i, j);
};
const SPEC_AIDS = between(SPEC, '### 4.9 `op: "mnemonic"` (package K)', "### 4.10");
const fenced = (s: string, marker: string, lang: string) => {
  const m = new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\n\\n\`\`\`${lang}\\n([\\s\\S]*?)\\n\`\`\``, "m").exec(s);
  assert.ok(m, `the ${lang} block after ${marker}`);
  return m[1];
};

// ── The fixtures ──

const KEY = "k-0123456789abcdef0123456789abcdef";
const GROUP = "22222222-0000-4000-8000-000000000002";
const USER = "33333333-0000-4000-8000-000000000003";
const LECTURE = "aaaaaaaa-0000-4000-8000-00000000000a";
const slide = (n: number, title: string, lines: string[]): StoredSlide => ({ n, title, lines: [title, ...lines], tables: [], notes: "", figures: [] });
const slides: StoredSlide[] = [
  slide(1, "מבוא", ["שתי תרופות לדוגמה: Fabrimycin ו-Placebozole"]),
  slide(2, "Fabrimycin: מנגנון", ["Prodrug", "משופעלת על ידי Examplase בתנאים אנאירוביים"]),
  slide(5, "Placebozole", ["פעילה רק בחלל המעי", "מנה אחת"]),
  slide(6, "Placebozole: אינטראקציות", ["Phenytoin מוריד את רמתה"]),
  slide(7, "Fabrimycin: תופעות לוואי", ["Metallic taste", "Peripheral neuropathy בטיפול מעל 4 שבועות", "תגובה דמוית Disulfiram עם אלכוהול עד 72 שעות אחרי המנה האחרונה"]),
  slide(8, "Placebozole: תופעות לוואי", ["שלשול", "פריחה", "Photosensitivity"]),
];
const lecture: Lecture = {
  id: LECTURE,
  group_id: GROUP,
  course: "פרמקולוגיה לדוגמה",
  title: "Fabrimycin ו-Placebozole",
  lecturer: "",
  lecture_date: "2026-11-01",
  source_kind: "pptx",
  slides,
};
const deck = deckText(lecture);
const PART = `## Fabrimycin: מנגנון ותופעות לוואי

### מנגנון

**מנגנון פעולה:** Fabrimycin היא prodrug שמשופעלת על ידי Examplase בתנאים אנאירוביים. [ש' 2]

### תופעות לוואי

**תופעות לוואי:** Metallic taste, Peripheral neuropathy בטיפול מעל 4 שבועות, ותגובה דמוית Disulfiram עם אלכוהול עד 72 שעות אחרי המנה האחרונה. [ש' 7]

- **Placebozole:** שלשול ופריחה. [ש' 8]

---

### בלי פסקאות`;
const blocks = blockSources(tidyMarkdown(PART));
const at = (start: string) => blocks.findIndex((b) => b.text.startsWith(start));
const PARA = at("**תופעות לוואי:**");
const TOPIC = at("### תופעות לוואי");

// Stand-in aids, written by following MNEMONIC_SYSTEM on the paragraph.
const aid = (kind: string, hook: string, decode: string, facts: string[]): MnemonicItem => ({ kind, hook, decode, facts });
const GOOD = [
  aid("ראשי תיבות", "MPD: מתכת, פריפריה, דיסולפירם", "M - Metallic taste · P - Peripheral neuropathy · D - Disulfiram", [
    "Metallic taste [ש' 7]",
    "Peripheral neuropathy מעל 4 שבועות [ש' 7]",
    "תגובה דמוית Disulfiram עד 72 שעות [ש' 7]",
  ]),
  aid("תמונה", "דמיינו מטבע מתכת על הלשון ליד כוסית שמפניה אסורה", "מטבע מתכת - Metallic taste · כוסית אסורה - תגובה דמוית Disulfiram עם אלכוהול", [
    "Metallic taste [ש' 7]",
    "תגובה דמוית Disulfiram עם אלכוהול [ש' 7]",
  ]),
  aid("חרוז", "ארבעה שבועות ומעלה, העצבים בחופשה ארוכה", "ארבעה שבועות ומעלה - Peripheral neuropathy בטיפול מעל 4 שבועות", [
    "Peripheral neuropathy בטיפול מעל 4 שבועות [ש' 7]",
  ]),
];
const HOSTILE: Array<[MnemonicItem, string]> = [
  [aid("תמונה", "48 שעות של שמפניה אסורה", "48 שעות - תגובה דמוית Disulfiram", ["תגובה דמוית Disulfiram עד 48 שעות [ש' 7]"]), "number 48 not in the paragraph"],
  [aid("משחק מילים", "פלסבו בלי טעם", "Placebozole - בלי טעם מתכתי · Metallic taste - רק ב-Fabrimycin", ["Metallic taste [ש' 7]"]), "term Placebozole is from another part of the lecture"],
  [aid("סיפור", "דמיין שאתה בספרייה ופתאום טעם של מתכת", "טעם של מתכת - Metallic taste בזמן הטיפול", ["Metallic taste [ש' 7]"]), "gendered"],
  [aid("ראשי תיבות", "TMT: טעם מתכתי", "T - Tinidazole · M - Metallic taste", ["Tinidazole גם גורמת לטעם מתכתי [ש' 7]"]), "term Tinidazole not in the paragraph"],
  [aid("שיר", "שיר על Metallic taste", "שיר קצר על Metallic taste", ["Metallic taste [ש' 7]"]), "kind"],
];
const TOPIC_AID = aid(
  "חרוז",
  "פריחה ושלשול לפלסבו, מתכת ועצבים לפבריקו",
  "פלסבו - Placebozole: שלשול ופריחה · פבריקו - Fabrimycin: Metallic taste ו-Peripheral neuropathy",
  ["Placebozole: שלשול ופריחה [ש' 8]", "Fabrimycin: Metallic taste [ש' 7]"],
);

// ── SSE ──

type Ev = Record<string, unknown>;
const startEv = (usage: object = { input_tokens: 1700, output_tokens: 1 }): Ev => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage },
});
const textEvs = (text: string, size: () => number): Ev[] => {
  const ev: Ev[] = [{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }];
  for (let i = 0; i < text.length; ) {
    const n = size();
    ev.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + n) } });
    i += n;
  }
  ev.push({ type: "content_block_stop", index: 0 });
  return ev;
};
const endEvs = (stop: string, usage: object = { output_tokens: 1500 }): Ev[] => [
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, stop_details: null }, usage },
  { type: "message_stop" },
];
const sse = (events: Ev[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
type Sent = { headers: Headers; body: Record<string, any> };
function fake(events: () => Ev[], opts: { hang?: boolean } = {}) {
  const sent: Sent[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(sse(events())));
        if (!opts.hang) c.close();
        init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_t" } });
  };
  return { client: new Anthropic({ apiKey: "test-key", fetch: fetch as typeof globalThis.fetch, maxRetries: 0 }), sent };
}
const spends: Spend[] = [];
const ledger = async (s: Spend) => void spends.push(s);
const parseLines = (out: string[]) =>
  out
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, any>);

// ── 1. The prompt, the request builder and the schema are the spec's ──

test("MNEMONIC_SYSTEM is the spec's text, and mnemonicRequest() the spec's code, byte for byte", () => {
  assert.equal(MNEMONIC_SYSTEM, fenced(SPEC_AIDS, "**`MNEMONIC_SYSTEM`**", "text"));
  assert.equal(MNEMONIC_SYSTEM.length, 3081);
  assert.ok(PROMPTS_TS.includes(fenced(SPEC_AIDS, "**`mnemonicRequest`**", "ts")));
});

test("the JSON schema sent is the spec's (cleanSchema drops only the root $schema note); nothing optional, no unions or enums", () => {
  const spec = JSON.parse(fenced(SPEC_AIDS, "**The JSON schema, exactly as sent:**", "json")) as Record<string, unknown>;
  assert.equal(spec.description, '{$schema: "https://json-schema.org/draft/2020-12/schema"}');
  const { description: _note, ...want } = spec;
  const sent = cleanSchema(zodOutputFormat(MnemonicSet).schema as Record<string, unknown>);
  assert.equal(JSON.stringify(sent), JSON.stringify(want));
  assert.ok(!/"anyOf"|"type":\[|"enum"|"additionalProperties":true|\$schema|minimum|maximum/.test(JSON.stringify(sent)));
  assert.equal(JSON.stringify(KINDS), JSON.stringify(["ראשי תיבות", "תמונה", "סיפור", "חרוז", "משחק מילים"]));
});

// ── 2. The source of an aid ──

test("the source: the paragraph and the slide it cites, nothing else", () => {
  const src = mnemonicSource(blocks, PARA, slides, slideText)!;
  assert.equal(src.target, blocks[PARA].text);
  assert.equal(src.topic, false);
  assert.equal(src.slides, slideText(slides[4]));
  assert.ok(src.slides.startsWith("[שקף 7]") && !src.slides.includes("[שקף 8]"));
});

test("the source: a ### heading takes its whole topic, up to the next heading of its level", () => {
  const topic = mnemonicSource(blocks, TOPIC, slides, slideText)!;
  assert.equal(topic.topic, true);
  assert.ok(topic.target.startsWith("### תופעות לוואי\n\n**תופעות לוואי:**"));
  assert.ok(topic.target.includes("- **Placebozole:**") && !topic.target.includes("### בלי פסקאות"));
  assert.equal(topic.slides, [slides[4], slides[5]].map(slideText).join("\n\n"));
  // The part's own ## heading takes the whole part; a heading with nothing under it is itself only.
  assert.ok(mnemonicSource(blocks, 0, slides, slideText)!.target.includes("### בלי פסקאות"));
  const lone = mnemonicSource(blocks, at("### בלי פסקאות"), slides, slideText)!;
  assert.deepEqual([lone.target, lone.topic, lone.slides], ["### בלי פסקאות", false, ""]);
  // A rule, or an anchor the part does not have: no source (the op answers 400 "bad block").
  assert.equal(mnemonicSource(blocks, at("---"), slides, slideText), null);
  assert.equal(mnemonicSource(blocks, 99, slides, slideText), null);
});

test("the source is capped: 6,000 characters of text and 8,000 of slides", () => {
  const long = Array.from({ length: 40 }, (_, i) => `**נקודה ${i}:** ${"מילה ".repeat(40)}[ש' ${(i % 6) + 1}]`).join("\n\n");
  const big = Array.from({ length: 6 }, (_, i) => slide(i + 1, `שקף ${i + 1}`, ["שורה ארוכה ".repeat(300)]));
  const src = mnemonicSource(blockSources(`## חלק\n\n${long}`), 0, big, slideText)!;
  assert.equal(src.target.length, 6000);
  assert.equal(src.slides.length, 8000);
});

test("the request: the lecture, the part, the target and its slides, and nothing more", () => {
  const src = mnemonicSource(blocks, PARA, slides, slideText)!;
  const req = mnemonicRequest({ lectureTitle: lecture.title, course: lecture.course, partHeading: "Fabrimycin: מנגנון ותופעות לוואי", ...src });
  assert.ok(req.startsWith(`The lecture: «${lecture.title}» (${lecture.course}). From the part «Fabrimycin: מנגנון ותופעות לוואי».\n\nMake memory aids for this paragraph of the summary:\n\n<<<\n${src.target}\n>>>`));
  assert.ok(req.endsWith("Give 1 to 3 memory aids."));
  assert.ok(!req.includes("פעילה רק בחלל המעי"), "no slide the paragraph does not cite");
  const noSlides = mnemonicRequest({ lectureTitle: "x", course: "", partHeading: "y", target: "z", slides: "", topic: true });
  assert.equal(noSlides, "The lecture: «x». From the part «y».\n\nMake memory aids for this topic of the summary (its heading and paragraphs):\n\n<<<\nz\n>>>\n\nIt cites no slide.\n\nGive 1 to 3 memory aids.");
});

// ── 3. The checks on every aid ──

const src = mnemonicSource(blocks, PARA, slides, slideText)!;
const SOURCE = src.target + "\n" + src.slides;

test("checks: the three stand-in aids pass", () => {
  for (const m of GOOD) assert.deepEqual(checkMnemonic(m, SOURCE, deck), { ok: true, item: m }, m.hook);
});

test("checks: the five hostile aids fail, each for its own reason", () => {
  assert.deepEqual(
    HOSTILE.map(([m]) => {
      const r = checkMnemonic(m, SOURCE, deck);
      return r.ok ? "PASSED" : r.why;
    }),
    HOSTILE.map(([, why]) => why),
  );
});

test("checks: the topic aid passes against its topic; markup, emoji, lengths and plural address", () => {
  const topic = mnemonicSource(blocks, TOPIC, slides, slideText)!;
  assert.equal(checkMnemonic(TOPIC_AID, topic.target + "\n" + topic.slides, deck).ok, true);
  assert.equal(checkMnemonic(TOPIC_AID, SOURCE, deck).ok, false, "the same aid on the paragraph alone pairs Placebozole from elsewhere");
  const why = (m: MnemonicItem) => {
    const r = checkMnemonic(m, SOURCE, deck);
    return r.ok ? "ok" : r.why;
  };
  const g = GOOD[0];
  assert.equal(why({ ...g, hook: "<b>MPD</b>" }), "markup");
  assert.equal(why({ ...g, decode: g.decode + " https://x.example" }), "markup");
  assert.equal(why({ ...g, hook: "MPD 💊" }), "emoji");
  assert.equal(why({ ...g, hook: "MP" }), "hook length");
  assert.equal(why({ ...g, decode: "M - x" }), "decode length");
  assert.equal(why({ ...g, facts: [] }), "facts");
  assert.equal(why({ ...g, facts: Array(9).fill("Metallic taste") }), "facts");
  assert.equal(why({ ...g, hook: "תזכרי: MPD" }), "gendered");
  assert.equal(why({ ...g, hook: "דמיינו MPD" }), "ok", "the plural passes");
  assert.equal(why({ ...g, hook: "**MPD**: מתכת" }), "ok", "asterisks are stripped");
  assert.deepEqual(checkMnemonic({ ...g, hook: " **MPD**  מתכת " }, SOURCE, deck), { ok: true, item: { ...g, hook: "MPD מתכת" } });
});

// ── 4. The stream ──

test("the request: json_schema, effort medium, the plain system without cache, fallback", async () => {
  const doc = JSON.stringify({ mnemonics: GOOD });
  const f = fake(() => [startEv(), ...textEvs(doc, () => 9), ...endEvs("end_turn")]);
  const req = mnemonicRequest({ lectureTitle: lecture.title, course: lecture.course, partHeading: "x", ...src });
  await streamMnemonics({ client: f.client, ref: "0.4", request: req, source: SOURCE, lectureText: deck, stopAt: Date.now() + 60_000, write: () => undefined, ledger });
  const b = f.sent[0].body;
  assert.equal(b.model, "claude-opus-5-5");
  assert.equal(b.max_tokens, 5000);
  assert.deepEqual(b.output_config, { effort: "medium", format: { type: "json_schema", schema: cleanSchema(zodOutputFormat(MnemonicSet).schema as Record<string, unknown>) } });
  assert.deepEqual(b.system, [{ type: "text", text: MNEMONIC_SYSTEM }], "MNEMONIC_SYSTEM alone, no breakpoint");
  assert.ok(!("cache_control" in b), "no automatic caching either");
  assert.deepEqual(b.messages, [{ role: "user", content: req }]);
  assert.equal(b.fallbacks, "default");
  assert.ok((f.sent[0].headers.get("anthropic-beta") ?? "").includes("server-side-fallback-2026-07-01"));
  assert.ok(!JSON.stringify(b).includes("פעילה רק בחלל המעי"), "no deck");
});

test("the stream: 3 aids shown and 2 skipped, through 50 random chunkings; one settle each", async () => {
  const doc = JSON.stringify({ mnemonics: [GOOD[0], HOSTILE[0][0], GOOD[1], GOOD[2], HOSTILE[2][0]] });
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  spends.length = 0;
  for (let trial = 0; trial < 50; trial++) {
    const f = fake(() => [startEv(), ...textEvs(doc, () => 1 + Math.floor(rnd() * 15)), ...endEvs("end_turn")]);
    const out: string[] = [];
    const r = await streamMnemonics({ client: f.client, ref: "0.4", request: "x", source: SOURCE, lectureText: deck, stopAt: Date.now() + 60_000, write: (l) => out.push(l), ledger });
    const lines = parseLines(out);
    assert.deepEqual([r.made, r.rejected, r.stop], [3, 2, "end_turn"], `trial ${trial}`);
    assert.deepEqual(
      lines.map((l) => l.t),
      ["m", "skip", "m", "m", "skip"],
      `trial ${trial}`,
    );
    assert.deepEqual(
      lines.filter((l) => l.t === "m").map((l) => l.m),
      GOOD,
    );
    assert.deepEqual(
      lines.filter((l) => l.t === "skip").map((l) => l.why),
      ["number 48 not in the paragraph", "gendered"],
    );
  }
  assert.equal(spends.length, 50);
  assert.ok(spends.every((s) => s.kind === "mnemonic" && s.ref === "0.4" && !s.estimated));
});

test("the stream: at most three, a repeated hook dropped, a malformed item counted", async () => {
  const doc = `{"mnemonics":[${JSON.stringify(GOOD[0])},${JSON.stringify(GOOD[0])},{"kind":"תמונה","hook":5},${JSON.stringify(GOOD[1])},${JSON.stringify(GOOD[2])},${JSON.stringify({ ...GOOD[2], hook: "חרוז נוסף על ארבעה שבועות" })}]}`;
  const f = fake(() => [startEv(), ...textEvs(doc, () => 11), ...endEvs("end_turn")]);
  const out: string[] = [];
  const r = await streamMnemonics({ client: f.client, ref: "0.4", request: "x", source: SOURCE, lectureText: deck, stopAt: Date.now() + 60_000, write: (l) => out.push(l), ledger });
  assert.deepEqual([r.made, r.rejected], [3, 3]);
  assert.deepEqual(
    parseLines(out).map((l) => (l.t === "m" ? l.m.hook : l.why)),
    [GOOD[0].hook, "more than three, or a repeat", "shape", GOOD[1].hook, GOOD[2].hook, "more than three, or a repeat"],
  );
});

test("the stream: the deadline stops it, keeps what was shown, and settles an estimate", async () => {
  spends.length = 0;
  const doc = JSON.stringify({ mnemonics: GOOD }).slice(0, 400);
  const f = fake(() => [startEv(), ...textEvs(doc, () => 50)], { hang: true });
  const out: string[] = [];
  const r = await streamMnemonics({ client: f.client, ref: "0.4", request: "x", source: SOURCE, lectureText: deck, stopAt: Date.now() + 5_000, write: (l) => out.push(l), ledger });
  assert.equal(r.timedOut, true);
  assert.equal(r.stop, "timeout");
  assert.equal(r.made, parseLines(out).filter((l) => l.t === "m").length);
  assert.equal(spends.length, 1);
  assert.equal(spends[0].estimated, true);
});

// ── 5. The op, as the router called it, against local mocks ──

type Logged = { who: "rest" | "anthropic"; path: string; auth: string | null; body: string };
let log: Logged[] = [];
const db = {
  schema: { ...REQUIRED_SCHEMA } as unknown, // every section the code needs (§2.11)
  part: { idx: 0, title: "Fabrimycin: מנגנון ותופעות לוואי", markdown: PART, status: "ready", gen: 2 } as Record<string, unknown> | null,
  reserve: [] as Array<{ status: number; body: unknown }>,
  uses: 4,
};
const anthropicReplies: Ev[][] = [];
const readAll = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
  });
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const pgError = (message: string) => ({ status: 400, body: { code: "P0001", details: null, hint: null, message } });
const rest = createServer(async (req, res) => {
  const body = await readAll(req);
  const url = new URL(req.url ?? "/", "http://x");
  const q = url.searchParams;
  log.push({ who: "rest", path: url.pathname, auth: req.headers.authorization ?? null, body });
  const p = url.pathname;
  if (p === "/auth/v1/user") return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated" });
  if (p === "/rest/v1/rpc/study_schema") return send(res, 200, db.schema);
  if (p === "/rest/v1/rpc/study_reserve") return db.reserve.length ? send(res, db.reserve[0].status, db.reserve.shift()!.body) : send(res, 200, 77);
  if (p === "/rest/v1/rpc/study_settle") return send(res, 200, true);
  if (p === "/rest/v1/rpc/study_my_uses_today") return send(res, 200, db.uses);
  if (p === "/rest/v1/study_lectures") return send(res, 200, q.get("id") === `eq.${LECTURE}` ? [lecture] : []);
  if (p === "/rest/v1/study_sections") return send(res, 200, db.part && q.get("idx") === `eq.${db.part.idx}` && q.get("lecture_id") === `eq.${LECTURE}` ? [db.part] : []);
  send(res, 404, { message: `unmocked ${req.method} ${p}` });
});
const anthropicServer = createServer(async (req, res) => {
  log.push({ who: "anthropic", path: req.url ?? "", auth: null, body: await readAll(req) });
  const events = anthropicReplies.shift();
  if (!events) return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "no reply queued" } });
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(sse(events));
});
const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as AddressInfo).port)));
before(async () => {
  const [r, a] = await Promise.all([listen(rest), listen(anthropicServer)]);
  delete process.env.VITE_STUDY_SUPABASE_URL;
  delete process.env.VITE_STUDY_SUPABASE_ANON_KEY;
  Object.assign(process.env, {
    VITE_SUPABASE_URL: `http://127.0.0.1:${r}`,
    VITE_SUPABASE_ANON_KEY: "anon-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${a}`,
    ANTHROPIC_API_KEY: "test-key",
    STUDY_WORKER_KEY: KEY,
    STUDY_MONTHLY_USD: "33",
  });
});
after(() => {
  rest.close();
  anthropicServer.close();
});
beforeEach(() => {
  log = [];
  db.schema = { ...REQUIRED_SCHEMA };
  db.part = { idx: 0, title: "Fabrimycin: מנגנון ותופעות לוואי", markdown: PART, status: "ready", gen: 2 };
  db.reserve = [];
  db.uses = 4;
  anthropicReplies.length = 0;
});
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
/** The op with the router's error handling (api/study/ai.ts): a refusal is
 *  its JSON error. The op checks section K itself. */
const aids = async (body: Record<string, unknown>) => {
  const req = new Request("http://localhost/api/study/ai", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ op: "mnemonic", ...body }),
  });
  try {
    return await mnemonicOp(req, { op: "mnemonic", ...body }, Date.now());
  } catch (e) {
    return json(e instanceof HttpError ? e.status : 500, { error: errorText(e) });
  }
};
const readStream = async (res: Response) => {
  const text = await res.text();
  const [head, error] = text.split("\n\u0000ERROR ");
  assert.equal(head[0], "​");
  return { lines: head.slice(1).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>), error: error ?? null };
};
const calls = (path: string) => log.filter((l) => l.who === "rest" && l.path === path);
const modelCalls = () => log.filter((l) => l.who === "anthropic");
const reply = (items: unknown[], stop = "end_turn") => [startEv(), ...textEvs(JSON.stringify({ mnemonics: items }), () => 13), ...endEvs(stop)];

test("op: without section K in the database, 503 schema, and nothing reserved or asked", async () => {
  db.schema = Object.fromEntries(Object.entries(REQUIRED_SCHEMA).filter(([k]) => k !== "K"));
  const res = await aids({ lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 });
  assert.deepEqual([res.status, await res.json()], [503, { error: "schema" }]);
  assert.equal(calls("/rest/v1/rpc/study_reserve").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("op: reserved (mnemonic, <part>.<anchor>, the key) before the call, settled after; the aids, then done", async () => {
  anthropicReplies.push(reply([GOOD[0], HOSTILE[0][0], GOOD[1], GOOD[2], HOSTILE[2][0]]));
  const res = await aids({ lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 });
  assert.equal(res.status, 200);
  const { lines, error } = await readStream(res);
  assert.equal(error, null);
  assert.deepEqual(
    lines.map((l) => l.t),
    ["m", "skip", "m", "m", "skip", "done"],
  );
  assert.deepEqual(lines[lines.length - 1], { t: "done", made: 3, rejected: 2, left: DAILY_MNEMONICS - 4, stop: "end_turn", unsettled: 0 });
  const order = log
    .filter((l) => l.who === "anthropic" || l.path === "/rest/v1/rpc/study_reserve" || l.path === "/rest/v1/rpc/study_settle")
    .map((l) => (l.who === "anthropic" ? "model" : l.path.split("_").pop()));
  assert.deepEqual(order, ["reserve", "model", "settle"]);
  const r = JSON.parse(calls("/rest/v1/rpc/study_reserve")[0].body);
  assert.deepEqual(
    { ...r, p_estimate: typeof r.p_estimate },
    {
      p_group: GROUP,
      p_lecture: LECTURE,
      p_kind: "mnemonic",
      p_ref: `0.${PARA}`,
      p_estimate: "number",
      p_cap: 33,
      p_share: POLICY.mnemonic.share,
      p_member_share: POLICY.mnemonic.memberShare,
      p_daily: POLICY.mnemonic.daily, // 5 a day (review F-19)
      p_daily_ref: null,
      p_key: KEY,
    },
  );
  assert.ok(r.p_estimate > 0.09 && r.p_estimate < 0.2, String(r.p_estimate));
  const s = JSON.parse(calls("/rest/v1/rpc/study_settle")[0].body);
  assert.deepEqual([s.p_id, s.p_key, s.p_model], [77, KEY, MODEL]);
  const uses = JSON.parse(calls("/rest/v1/rpc/study_my_uses_today")[0].body);
  assert.deepEqual(uses, { p_group: GROUP, p_kind: "mnemonic", p_ref: null });
  // The request: the paragraph and its slide only.
  const b = JSON.parse(modelCalls()[0].body);
  assert.deepEqual(b.system, [{ type: "text", text: MNEMONIC_SYSTEM }]);
  assert.equal(
    b.messages[0].content,
    mnemonicRequest({ lectureTitle: lecture.title, course: lecture.course, partHeading: "Fabrimycin: מנגנון ותופעות לוואי", ...mnemonicSource(blocks, PARA, slides, slideText)! }),
  );
});

test("op: the part must be ready, of the same generation, and the block one an aid can be made of", async () => {
  const cases: Array<[() => void, Record<string, unknown>, number, string]> = [
    [() => (db.part!.status = "writing"), { part: 0, anchor: PARA, gen: 2 }, 409, "part busy"],
    [() => undefined, { part: 0, anchor: PARA, gen: 1 }, 409, "part rewritten"],
    [() => undefined, { part: 0, anchor: at("---"), gen: 2 }, 400, "bad block"],
    [() => undefined, { part: 0, anchor: 99, gen: 2 }, 400, "bad block"],
    [() => undefined, { part: 3, anchor: 1, gen: 2 }, 404, "part not found"],
    [() => undefined, { part: 0, anchor: -1, gen: 2 }, 400, "bad request"],
    [() => undefined, { part: "0", anchor: PARA, gen: 2 }, 400, "bad request"],
    [() => undefined, { part: 0, anchor: PARA }, 400, "bad request"],
  ];
  for (const [setup, body, status, error] of cases) {
    db.part = { idx: 0, title: "Fabrimycin: מנגנון ותופעות לוואי", markdown: PART, status: "ready", gen: 2 };
    setup();
    const res = await aids({ lectureId: LECTURE, ...body });
    assert.deepEqual([res.status, await res.json()], [status, { error }], error);
  }
  const other = await aids({ lectureId: "dddddddd-0000-4000-8000-00000000000d", part: 0, anchor: PARA, gen: 2 });
  assert.deepEqual([other.status, await other.json()], [404, { error: "lecture not found" }]);
  assert.equal(calls("/rest/v1/rpc/study_reserve").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("op: the budget's refusals answer before the stream; POLICY's daily limit", async () => {
  for (const [code, status] of [
    ["daily_limit", 429],
    ["reserve", 402],
    ["member_share", 402],
    ["budget", 402],
  ] as const) {
    db.reserve = [pgError(code)];
    const res = await aids({ lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 });
    assert.deepEqual([res.status, await res.json()], [status, { error: code }], code);
  }
  assert.equal(modelCalls().length, 0);
});

test("op: a refusal with no aid shown is settled, then thrown; with aids shown it ends with done", async () => {
  anthropicReplies.push(reply([], "refusal"));
  const r1 = await readStream(await aids({ lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 }));
  assert.equal(r1.error, "refusal");
  assert.deepEqual(r1.lines, []);
  const order = log.filter((l) => l.who === "anthropic" || l.path === "/rest/v1/rpc/study_settle").map((l) => l.who);
  assert.deepEqual(order, ["anthropic", "rest"]);
  log = [];
  anthropicReplies.push(reply([GOOD[0]], "refusal"));
  const r2 = await readStream(await aids({ lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 }));
  assert.equal(r2.error, null);
  assert.deepEqual(r2.lines[r2.lines.length - 1], { t: "done", made: 1, rejected: 0, left: DAILY_MNEMONICS - 4, stop: "refusal", unsettled: 0 });
});

test("op: every aid refused by the checks still ends with done (made 0) and is settled", async () => {
  anthropicReplies.push(reply(HOSTILE.map(([m]) => m)));
  const r = await readStream(await aids({ lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 }));
  assert.equal(r.error, null);
  assert.deepEqual(r.lines[r.lines.length - 1], { t: "done", made: 0, rejected: 5, left: DAILY_MNEMONICS - 4, stop: "end_turn", unsettled: 0 });
  assert.equal(JSON.parse(calls("/rest/v1/rpc/study_reserve")[0].body).p_ref, `0.${PARA}`);
  assert.equal(calls("/rest/v1/rpc/study_settle").length, 1);
});
