import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import ai from "../../api/study/ai.js";
import { blockSources } from "../../shared/study/edits.js";
import {
  askMessages,
  askSystem,
  badTags,
  checkAskInput,
  currentCorrections,
  lectureIndex,
  readAskInput,
  Route,
  routeQuestion,
  signTurn,
  streamAnswer,
  verifiedHistory,
  verifyTurn,
  type EditRow,
} from "./ask.js";
import { POLICY } from "./budget.js";
import { cleanSchema, type Spend } from "./claude.js";
import { ASK_LIMITS, DAILY_ASKS } from "./limits.js";
import {
  ASK_SYSTEM,
  askTurnText,
  askUserText,
  COURSE_ASK_NOTE,
  clockOf,
  correctionsBlock,
  NO_RECORDING,
  recordingNotesBlock,
  ROUTE_SYSTEM,
  summaryBlock,
  SUMMARY_LIMIT,
  threadsBlock,
} from "./prompts/collab.js";
import { deckText, HttpError, lectureBlock, MODEL, REQUIRED_SCHEMA, tidyMarkdown, type Lecture, type StoredSlide } from "./study.js";

/* K-3 (spec §7.K), "לשאול": design-collab §6.2's checks of the ask code
 * (test/run.ts, moved), with the review's changes: the history's signatures
 * (a wrong sig dropped, a 4th turn refused), the recording's notes after the
 * deck, and the ledger's reserve/settle; and KS-2 (§12.3.K): the group's
 * summary cached after the deck (K1, byte-stable), the answered threads
 * without names (K5), REC5's line in the user turn. First the prompts and
 * the schema against the spec's own text (ASK_SYSTEM with §12.3.K's
 * amendments); then the pieces against SDK 1.3.0 with a
 * fetch that replays SSE built from the documented event shapes; then the op
 * in Node, through /api/study/ai, against local mocks of PostgREST, Auth and
 * Anthropic. The lecture, the answers and the summary are made for the tests
 * (two drugs that do not exist). No key, no network. */

// tools/study-tests.mjs runs the tests from the repo's root.
const ROOT = process.cwd();
const SPEC = readFileSync(join(ROOT, "docs/study/spec/spec-final.md"), "utf8");
const PROMPTS_TS = readFileSync(join(ROOT, "server/study/prompts/collab.ts"), "utf8");
const SECTION_TS = readFileSync(join(ROOT, "api/study/section.ts"), "utf8");
// Since W1, section.ts (and the server writer, work.ts) write a part through
// the shared writer, which builds the summary's request.
const WRITER_TS = readFileSync(join(ROOT, "server/study/writer.ts"), "utf8");
const between = (s: string, from: string, to: string) => {
  const i = s.indexOf(from);
  assert.ok(i >= 0, `not found: ${from}`);
  const j = s.indexOf(to, i + from.length);
  assert.ok(j >= 0, `not found: ${to}`);
  return s.slice(i, j);
};
const SPEC_ASK = between(SPEC, '### 4.8 `op: "ask"` (package K)', "### 4.9");
const ADDENDUM = readFileSync(join(ROOT, "docs/study/spec/addendum/addendum.md"), "utf8");
const SPEC_K = between(ADDENDUM, "#### 12.3.K", "#### 12.3.A");
/** The fenced block that follows a line starting with `marker`. */
const fenced = (s: string, marker: string, lang: string) => {
  const m = new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\n\\n\`\`\`${lang}\\n([\\s\\S]*?)\\n\`\`\``, "m").exec(s);
  assert.ok(m, `the ${lang} block after ${marker}`);
  return m[1];
};

// ── The fixtures ──

const KEY = "k-0123456789abcdef0123456789abcdef";
const GROUP = "22222222-0000-4000-8000-000000000002";
const USER = "33333333-0000-4000-8000-000000000003";
const LECTURE_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const LECTURE_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const LECTURE_C = "cccccccc-0000-4000-8000-00000000000c";
const COURSE = "c0c0c0c0-0000-4000-8000-0000000000c0";

const slide = (n: number, title: string, lines: string[], extra: Partial<StoredSlide> = {}): StoredSlide => ({
  n,
  title,
  lines: [title, ...lines],
  tables: [],
  notes: "",
  figures: [],
  ...extra,
});
const slidesA: StoredSlide[] = [
  slide(1, "מבוא", ["שתי תרופות לדוגמה: Fabrimycin ו-Placebozole"]),
  slide(2, "Fabrimycin: מנגנון", ["Prodrug", "משופעלת על ידי Examplase בתנאים אנאירוביים"], { notes: "להדגיש: רק בתאים אנאירוביים" }),
  slide(3, "Fabrimycin: פרמקוקינטיקה", ["Bioavailability 90%", "t½ 8 שעות"], { tables: [[["תכונה", "ערך"], ["פינוי", "כליות"]]] }),
  slide(4, "Fabrimycin: שימושים", ["זיהומים אנאירוביים", "Giardia fictiva"], { figures: [{ k: 1, path: `${GROUP}/${LECTURE_A}/s4-1.jpg`, w: 800, h: 600 }] }),
  slide(5, "Placebozole", ["פעילה רק בחלל המעי", "מנה אחת"]),
  slide(6, "Placebozole: אינטראקציות", ["Phenytoin מוריד את רמתה"]),
  slide(7, "Fabrimycin: תופעות לוואי", ["Metallic taste", "Peripheral neuropathy בטיפול מעל 4 שבועות", "תגובה דמוית Disulfiram עם אלכוהול עד 72 שעות אחרי המנה האחרונה"]),
  slide(8, "Placebozole: תופעות לוואי", ["שלשול", "פריחה", "Photosensitivity"]),
];
const lectureA: Lecture = {
  id: LECTURE_A,
  group_id: GROUP,
  course: "פרמקולוגיה לדוגמה",
  title: "Fabrimycin ו-Placebozole",
  lecturer: "ד״ר דוגמה",
  lecture_date: "2026-11-01",
  source_kind: "pptx",
  slides: slidesA,
};
const lectureB: Lecture = {
  ...lectureA,
  id: LECTURE_B,
  title: "Examplazole",
  lecturer: "",
  lecture_date: "2026-11-08",
  slides: [slide(1, "Examplazole", ["אנטי-פטרייתי לדוגמה", "מעכב Fakease"]), slide(2, "תופעות לוואי", ["כאבי ראש"])],
};
const lectureC: Lecture = { ...lectureB, id: LECTURE_C, course: "קורס אחר", title: "Sampleomycin", lecture_date: null };

const PART0 = `## Fabrimycin: מנגנון ותופעות לוואי

### מנגנון

**מנגנון פעולה:** Fabrimycin היא prodrug שמשופעלת על ידי Examplase בתנאים אנאירוביים. [ש' 2]

### תופעות לוואי

**תופעות לוואי:** Metallic taste, Peripheral neuropathy בטיפול מעל 4 שבועות, ותגובה דמוית Disulfiram עם אלכוהול עד 72 שעות אחרי המנה האחרונה. [ש' 7]

- **Placebozole:** שלשול ופריחה. [ש' 8]`;

// Stand-in answers, written by following ASK_SYSTEM on the fixture deck.
const ANSWER_1 =
  "Fabrimycin אסורה עם אלכוהול: היא גורמת לתגובה דמוית Disulfiram, עד 72 שעות אחרי המנה האחרונה. [ש' 7]\n\nכדאי לזכור שגם Metallic taste מופיעה באותו שקף כתופעת לוואי. [ש' 7]";
const ANSWER_2 = "ההרצאה עוסקת בזה רק בחלקו: Fabrimycin משופעלת על ידי Examplase רק בתנאים אנאירוביים. [ש' 2]";
const ANSWER_3 = "ההרצאה לא עוסקת בזה.\n\n> **הרחבה (לא מהשקפים):** תרופות מסוג prodrug דורשות שפעול בתוך התא.";
const ANSWER_4 = "כי בתאים אירוביים אין שפעול על ידי Examplase. [ש' 2]";
const ANSWER_BAD = "Placebozole ניתנת במנה אחת [ש' 5], וההשפעה נמשכת שבוע. [ש' 45]";

// ── SSE, as the API streams it ──

type Ev = Record<string, unknown>;
const startEv = (model = MODEL, usage: object = { input_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 6200, output_tokens: 1 }): Ev => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage },
});
const thinking = (index = 0): Ev[] => [
  { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index, delta: { type: "signature_delta", signature: "sig" } },
  { type: "content_block_stop", index },
];
const textEvs = (index: number, text: string, size = 7): Ev[] => {
  const ev: Ev[] = [{ type: "content_block_start", index, content_block: { type: "text", text: "" } }];
  for (let i = 0; i < text.length; i += size) ev.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: text.slice(i, i + size) } });
  ev.push({ type: "content_block_stop", index });
  return ev;
};
const endEvs = (stop: string, usage: object): Ev[] => [
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, stop_details: null }, usage },
  { type: "message_stop" },
];
const sse = (events: Ev[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const routeJson = (text: string, stop = "end_turn") => ({
  id: "msg_r",
  type: "message",
  role: "assistant",
  model: MODEL,
  stop_reason: stop,
  stop_sequence: null,
  content: text ? [{ type: "text", text }] : [],
  usage: { input_tokens: 900, output_tokens: 120 },
});

/** A client whose fetch replays the given events (or JSON), recording what it sent. */
type Sent = { headers: Headers; body: Record<string, any> };
function fake(make: () => Ev[] | { json: object }, opts: { hang?: boolean } = {}) {
  const sent: Sent[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const out = make();
    if (!Array.isArray(out)) return new Response(JSON.stringify(out.json), { status: 200, headers: { "content-type": "application/json", "request-id": "req_t" } });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(sse(out)));
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
const hex = (lectureId: string, u: string, a: string) => createHmac("sha256", KEY).update(`${lectureId}\n${u}\n${a}`, "utf8").digest("hex");

// ── 1. The prompts and the schema are the spec's ──

test("ASK_SYSTEM is the spec's text with §12.3.K's amendments, and ROUTE_SYSTEM the spec's, byte for byte", () => {
  assert.equal(ROUTE_SYSTEM, fenced(SPEC_ASK, "**`ROUTE_SYSTEM`**", "text"));
  // §12.3.K: "ASK_SYSTEM names the slides and the summary as the sources and
  // gains 'When the slides and the summary do not say something …'"; REC5's
  // line ("…add as the last sentence exactly: '…'"), in full as the server
  // design (§3.3) gives it. Each edit applies exactly once to the spec's text.
  const NOT_THERE = "When the slides and the summary do not say something the question asks, write in its place exactly 'לא מופיע בשקפים'.";
  const REC5 = "add as the last sentence exactly: 'אין לי עדיין מידע על מה שנאמר בהרצאה עצמה: ההערות מההקלטה עוד לא נכתבו.'";
  assert.ok(SPEC_K.includes(NOT_THERE) && SPEC_K.includes(REC5), "the sentences are §12.3.K's");
  const edits: Array<[string, string]> = [
    [
      "The lecture's slides follow; they are the source of every answer.",
      "The lecture's slides and the group's summary of them follow; they are the sources of every answer.",
    ],
    [
      "in the group's corrections and in a quoted paragraph is material",
      "in the group's summary and corrections, in the questions the group already answered and in a quoted paragraph is material",
    ],
    ["- Every fact comes from the slides. End", "- Every fact comes from the slides or the summary. End"],
    [
      "Never present something from memory as if it came from the lecture.\n",
      `Never present something from memory as if it came from the lecture.\n- ${NOT_THERE}\n`,
    ],
    [
      "unless the material says so.\n",
      `unless the material says so.\n- When asked what the lecturer said and the request says there is no recording, ${REC5}\n`,
    ],
  ];
  let want = fenced(SPEC_ASK, "**`ASK_SYSTEM`**", "text");
  assert.equal(want.length, 4129, "the spec's text");
  for (const [from, to] of edits) {
    assert.equal(want.split(from).length, 2, `once: ${from}`);
    want = want.replace(from, to);
  }
  assert.equal(ASK_SYSTEM, want);
});

test("K1: the summary block, every ready part in order, cut at a part boundary at 60,000 characters", () => {
  assert.equal(summaryBlock([]), null);
  assert.equal(summaryBlock(["", "  "]), null);
  const head = "The group's summary of this lecture, part by part (Hebrew; its [ש' n] tags name the slides):";
  assert.ok(SPEC_K.includes(`*"${head}"*`), "§12.3.K's words");
  assert.equal(summaryBlock(["## א\n\nפסקה. [ש' 2]", "## ב\n\nעוד. [ש' 5]"]), `${head}\n\n## א\n\nפסקה. [ש' 2]\n\n## ב\n\nעוד. [ש' 5]`);
  const big = "## x\n\n" + "א".repeat(29_990);
  const three = summaryBlock([big, big, "## the third\n\nפסקה."])!;
  assert.equal(SUMMARY_LIMIT, 60_000);
  assert.ok(three.includes(big) && !three.includes("the third"), "the third part would pass 60,000: cut before it, never inside a part");
  assert.equal(three.length, head.length + 2 + big.length * 2 + 2);
});

test("K5: answered threads, newest first, Q / A without names, at most 20 and 4,000 characters", () => {
  assert.equal(threadsBlock([]), null);
  assert.equal(threadsBlock([{ q: "שאלה בלי תשובה?", a: [] }]), null, "a thread without a member's answer is left out");
  const block = threadsBlock([
    { q: "למה Fabrimycin\nלא פועלת באוויר?", a: ["כי Examplase עובדת רק בלי חמצן. [ש' 2]", "  ומספיק מעט חמצן.  "] },
    { q: "מה עם אלכוהול?", a: ["72 שעות. [ש' 7]"] },
  ])!;
  assert.equal(
    block,
    [
      "Questions the group already answered about this lecture (members' words, not the slides):",
      "Q: למה Fabrimycin לא פועלת באוויר? / A: כי Examplase עובדת רק בלי חמצן. [ש' 2] · ומספיק מעט חמצן.",
      "Q: מה עם אלכוהול? / A: 72 שעות. [ש' 7]",
      "You may use them, saying 'לפי תשובה בקבוצה', never as a slide fact; when they contradict the slides, give the slides.",
    ].join("\n"),
  );
  assert.ok(SPEC_K.includes("Questions the group already answered about this lecture (members' words, not the slides):"));
  assert.ok(SPEC_K.includes("You may use them, saying 'לפי תשובה בקבוצה', never as a slide fact; when they contradict the slides, give the slides."));
  const many = Array.from({ length: 30 }, (_, i) => ({ q: `שאלה ${i}?`, a: [`תשובה ${i}`] }));
  const twenty = threadsBlock(many)!;
  assert.equal(twenty.split("\n").length, 22, "a header, 20 threads, the rule");
  assert.ok(twenty.includes("שאלה 19?") && !twenty.includes("שאלה 20?"));
  const long = Array.from({ length: 10 }, (_, i) => ({ q: `q${i}`, a: ["א".repeat(900)] }));
  const cut = threadsBlock(long)!;
  const lines = cut.split("\n").slice(1, -1);
  assert.equal(lines.length, 4, "4,000 characters of threads at most");
  assert.ok(lines.join("").length <= 4000);
});

test("REC5: without a ready recording the user turn ends with the line §12.3.K gives", () => {
  assert.equal(NO_RECORDING, "There is no recording of this lecture yet.");
  assert.ok(SPEC_K.includes(`*"${NO_RECORDING}"*`));
  assert.equal(askTurnText(" שאלה? ", null, true), "שאלה?");
  assert.equal(askTurnText(" שאלה? ", null, false), "שאלה?\n\nThere is no recording of this lecture yet.");
  const focus = { heading: "x", text: "פסקה" };
  assert.equal(askTurnText("שאלה?", focus, false), `${askUserText("שאלה?", focus)}\n\n${NO_RECORDING}`);
});

test("correctionsBlock() and askUserText() are the spec's code, byte for byte", () => {
  const code = fenced(SPEC_ASK, "**The other blocks**", "ts");
  assert.ok(PROMPTS_TS.includes(code), "server/study/prompts/collab.ts holds the spec's block unchanged");
});

test("the routing schema sent is the spec's (cleanSchema drops only the root $schema note)", () => {
  const spec = JSON.parse(fenced(SPEC_ASK, "**The routing schema, exactly as sent:**", "json")) as Record<string, unknown>;
  assert.equal(spec.description, '{$schema: "https://json-schema.org/draft/2020-12/schema"}');
  const { description: _note, ...want } = spec;
  const sent = cleanSchema(zodOutputFormat(Route).schema as Record<string, unknown>);
  assert.equal(JSON.stringify(sent), JSON.stringify(want));
  assert.ok(!/"anyOf"|"type":\[|"enum"|"additionalProperties":true|\$schema/.test(JSON.stringify(sent)));
});

// ── 2. The pieces, against SDK 1.3.0 ──

test("the deck block is byte-identical to section.ts's: one lectureBlock", () => {
  assert.ok(SECTION_TS.includes('from "../../server/study/writer.js";'), "section.ts writes a part through the shared writer");
  assert.ok(WRITER_TS.includes("const deck = lectureBlock(lecture);"), "the writer sends lectureBlock(lecture)");
  const sys = askSystem(lectureA, []);
  assert.equal(sys[1].text, lectureBlock(lectureA));
  assert.equal(sys[1].text, `The full lecture (lecturer: ${lectureA.lecturer}), for context:\n\n${deckText(lectureA)}`);
  assert.equal(askSystem(lectureB, [])[1].text, `The full lecture, for context:\n\n${deckText(lectureB)}`);
});

test("ask system: the cached prefix is the same whatever changes after it; breakpoints on the deck and the summary", () => {
  const corr = [{ before: "a", after: "b", note: "" }];
  const notes = recordingNotesBlock([{ heading: "x", notes: [{ at_s: 70, text: "נאמר משהו" }] }]);
  const summary = summaryBlock([PART0])!;
  const threads = threadsBlock([{ q: "שאלה?", a: ["תשובה."] }])!;
  const s1 = askSystem(lectureA, []);
  const s2 = askSystem(lectureA, corr);
  const s3 = askSystem(lectureA, corr, notes);
  const s4 = askSystem(lectureA, corr, notes, summary, threads);
  const s5 = askSystem(lectureA, [], null, summary);
  assert.deepEqual([s1.length, s2.length, s3.length, s4.length, s5.length], [2, 3, 4, 6, 3]);
  assert.equal(JSON.stringify(s2.slice(0, 2)), JSON.stringify(s1));
  assert.equal(JSON.stringify(s3.slice(0, 2)), JSON.stringify(s1));
  assert.equal(JSON.stringify(s4.slice(0, 3)), JSON.stringify(s5), "the summary's prefix whatever the notes, corrections and threads");
  assert.ok(!("cache_control" in s1[0]));
  assert.deepEqual(s1[1].cache_control, { type: "ephemeral" });
  // K1: the summary right after the deck, cached (breakpoint 2; the automatic one makes 3 of 4)
  assert.equal(s4[2].text, summary);
  assert.deepEqual(s4[2].cache_control, { type: "ephemeral" });
  for (const b of s4.slice(3)) assert.ok(!("cache_control" in b));
  // then the recording's notes, the corrections and the answered threads, uncached
  assert.equal(s3[2].text, notes);
  assert.equal(s3[3].text, correctionsBlock(corr));
  assert.deepEqual(s4.slice(3).map((b) => b.text), [notes, correctionsBlock(corr), threads]);
  assert.equal(JSON.stringify(askSystem(lectureA, [], null, summaryBlock([PART0]))), JSON.stringify(s5), "byte-stable while no part changes");
  assert.ok(!/\d{4}-\d\d-\d\d|Date|שוהם|נועה/.test(ASK_SYSTEM), "no date, name or id in the frozen text");
});

test("one answer: the request, the NDJSON lines (batched), and one settle at the final usage", async () => {
  spends.length = 0;
  const f = fake(() => [startEv(), ...thinking(0), ...textEvs(1, ANSWER_1), ...endEvs("end_turn", { output_tokens: 420 })]);
  const out: string[] = [];
  const userText = askUserText("מה נאמר בהרצאה על Fabrimycin ואלכוהול?", null);
  const r = await streamAnswer({ client: f.client, system: askSystem(lectureA, []), messages: askMessages([], userText), stopAt: Date.now() + 60_000, write: (l) => out.push(l), ledger });
  const b = f.sent[0].body;
  assert.equal(b.model, "claude-opus-5-5");
  assert.equal(b.max_tokens, 3000);
  assert.deepEqual(b.output_config, { effort: "low" }, "effort low, no format");
  assert.ok((f.sent[0].headers.get("anthropic-beta") ?? "").includes("server-side-fallback-2026-07-01"));
  assert.equal(b.fallbacks, "default");
  assert.deepEqual(b.cache_control, { type: "ephemeral" }, "top-level automatic caching");
  assert.deepEqual(b.system[1].cache_control, { type: "ephemeral" }, "and the deck's breakpoint");
  assert.ok(!("thinking" in b), "no thinking parameter");
  assert.equal(b.stream, true);
  const lines = parseLines(out);
  assert.ok(lines.every((l) => l.t === "a"));
  assert.equal(lines.map((l) => l.d).join(""), ANSWER_1);
  assert.ok(lines.length < ANSWER_1.length / 7, `batched: ${lines.length} lines for ${Math.ceil(ANSWER_1.length / 7)} deltas`);
  assert.equal(r.stop, "end_turn");
  assert.equal(r.text, ANSWER_1);
  assert.equal(spends.length, 1);
  assert.equal(spends[0].estimated, false);
  assert.equal(spends[0].kind, "ask");
  assert.equal(spends[0].ref, "answer");
  assert.ok(Math.abs(spends[0].costUsd - (60 * 4 + 6200 * 0.2 + 420 * 20) / 1e6) < 1e-12, String(spends[0].costUsd));
});

test("a follow-up: the earlier turn goes back byte for byte, after the same system", async () => {
  const f1 = fake(() => [startEv(), ...textEvs(0, ANSWER_1), ...endEvs("end_turn", { output_tokens: 300 })]);
  const u1 = askUserText("מה נאמר בהרצאה על Fabrimycin ואלכוהול?", null);
  const r1 = await streamAnswer({ client: f1.client, system: askSystem(lectureA, []), messages: askMessages([], u1), stopAt: Date.now() + 60_000, write: () => undefined, ledger });
  const f2 = fake(() => [startEv(), ...textEvs(0, ANSWER_4), ...endEvs("end_turn", { output_tokens: 200 })]);
  const u2 = askUserText("ולמה היא לא פועלת בתאים אירוביים?", null);
  await streamAnswer({ client: f2.client, system: askSystem(lectureA, []), messages: askMessages([{ u: u1, a: r1.text }], u2), stopAt: Date.now() + 60_000, write: () => undefined, ledger });
  const b1 = f1.sent[0].body;
  const b2 = f2.sent[0].body;
  assert.equal(JSON.stringify(b2.system), JSON.stringify(b1.system));
  assert.equal(b2.messages.length, 3);
  assert.equal(JSON.stringify(b2.messages[0]), JSON.stringify(b1.messages[0]), "the earlier user turn, byte for byte");
  assert.deepEqual(b2.messages[1], { role: "assistant", content: ANSWER_1 });
  assert.deepEqual(b2.messages[2], { role: "user", content: u2 });
});

test("a focus paragraph goes in the user turn, delimited, after the deck's breakpoint", () => {
  const focus = blockSources(tidyMarkdown(PART0)).find((b) => b.text.startsWith("**תופעות לוואי:**"))!;
  const ut = askUserText("  מה הכי חשוב לזכור כאן?  ", { heading: "Fabrimycin: מנגנון ותופעות לוואי", text: focus.text });
  assert.equal(
    ut,
    `The question is about this paragraph of the group's summary (part «Fabrimycin: מנגנון ותופעות לוואי»):\n<<<\n${focus.text}\n>>>\n\nמה הכי חשוב לזכור כאן?`,
  );
  assert.equal(askUserText(" שאלה? ", null), "שאלה?");
});

test("a refusal is settled; streamAnswer reports it and the op throws it (below)", async () => {
  spends.length = 0;
  const f = fake(() => [startEv(), ...textEvs(0, "ההרצאה"), ...endEvs("refusal", { output_tokens: 30 })]);
  const r = await streamAnswer({ client: f.client, system: askSystem(lectureA, []), messages: askMessages([], "x"), stopAt: Date.now() + 60_000, write: () => undefined, ledger });
  assert.equal(r.stop, "refusal");
  assert.equal(spends.length, 1);
});

test("a mid-stream fallback: the text continues; each attempt is priced at its own model", async () => {
  spends.length = 0;
  const fb: Ev = { type: "content_block_start", index: 1, content_block: { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-5" } } };
  const f = fake(() => [
    startEv(),
    ...textEvs(0, "בתאים אירוביים "),
    fb,
    { type: "content_block_stop", index: 1 },
    ...textEvs(2, "אין שפעול על ידי Examplase. [ש' 2]"),
    ...endEvs("end_turn", {
      output_tokens: 300,
      iterations: [
        { type: "message", model: "claude-opus-5-5", input_tokens: 60, cache_read_input_tokens: 6200, output_tokens: 40 },
        { type: "fallback_message", model: "claude-opus-5", input_tokens: 6300, output_tokens: 300 },
      ],
    }),
  ]);
  const out: string[] = [];
  const r = await streamAnswer({ client: f.client, system: askSystem(lectureA, []), messages: askMessages([], "x"), stopAt: Date.now() + 60_000, write: (l) => out.push(l), ledger });
  assert.equal(parseLines(out).map((l) => l.d).join(""), "בתאים אירוביים אין שפעול על ידי Examplase. [ש' 2]");
  assert.equal(r.model, "claude-opus-5");
  const want = (60 * 4 + 6200 * 0.2 + 40 * 20) / 1e6 + (6300 * 5 + 300 * 25) / 1e6;
  assert.ok(Math.abs(spends[0].costUsd - want) < 1e-12, String(spends[0].costUsd));
});

test("the deadline: stop timeout, the text kept, the settle estimated", async () => {
  spends.length = 0;
  const f = fake(() => [startEv(), ...textEvs(0, "תשובה חלקית")], { hang: true });
  const r = await streamAnswer({ client: f.client, system: askSystem(lectureA, []), messages: askMessages([], "x"), stopAt: Date.now() + 5_000, write: () => undefined, ledger });
  assert.equal(r.stop, "timeout");
  assert.equal(r.text, "תשובה חלקית");
  assert.equal(spends[0].estimated, true);
  assert.equal(spends[0].usage?.estimated, true);
});

test("stand-in answers: tags name slides of the lecture; a missing slide is caught; the uncovered sentence", () => {
  const nums = slidesA.map((s) => s.n);
  for (const a of [ANSWER_1, ANSWER_2, ANSWER_3, ANSWER_4]) assert.deepEqual(badTags(a, nums), [], a);
  assert.deepEqual(badTags(ANSWER_BAD, nums), [45]);
  assert.deepEqual(badTags("[ש' 7-9] [ש׳ 2, 26]", nums), [9, 26]);
  assert.ok(ANSWER_3.startsWith("ההרצאה לא עוסקת בזה."));
  assert.ok(ANSWER_2.startsWith("ההרצאה עוסקת בזה רק בחלקו:"));
});

test("input limits: question, history of at most 3 turns, sizes", () => {
  const t = { u: "a", a: "b", sig: "c" };
  assert.equal(checkAskInput("", []), "question required");
  assert.equal(checkAskInput("   ", []), "question required");
  assert.equal(checkAskInput(7, []), "question required");
  assert.equal(checkAskInput("x".repeat(500), []), null);
  assert.equal(checkAskInput("x".repeat(501), []), "too long");
  assert.equal(checkAskInput("מה?", [t, t, t]), null);
  assert.equal(checkAskInput("מה?", [t, t, t, t]), "bad history", "a 4th turn is refused");
  assert.equal(checkAskInput("מה?", "x"), "bad history");
  assert.equal(checkAskInput("מה?", [{ u: "a" }]), "bad history");
  assert.equal(checkAskInput("מה?", [{ u: "a", a: "b", sig: 5 }]), "bad history");
  assert.equal(checkAskInput("מה?", [{ u: "x".repeat(ASK_LIMITS.turnU + 1), a: "b" }]), "too long");
  assert.equal(checkAskInput("מה?", [{ u: "a", a: "x".repeat(ASK_LIMITS.turnA + 1) }]), "too long");
  const bad = (body: Record<string, unknown>) => {
    try {
      readAskInput(body);
      return "accepted";
    } catch (e) {
      return e instanceof HttpError ? `${e.status} ${e.message}` : String(e);
    }
  };
  assert.equal(bad({ question: "מה?", focus: { part: 0, anchor: 1 } }), "400 bad scope", "a focus needs a lecture");
  assert.equal(bad({ question: "מה?", lectureId: "not-a-uuid" }), "400 bad scope");
  assert.equal(bad({ question: "מה?", lectureId: LECTURE_A, focus: { part: -1, anchor: 1 } }), "400 bad scope");
  assert.equal(bad({ question: "מה?", lectureId: LECTURE_A, focus: { part: 0, anchor: 2 }, history: null }), "accepted");
  assert.deepEqual(readAskInput({ question: "מה?", lectureId: LECTURE_A.toUpperCase() }).lectureId, LECTURE_A);
});

test("the corrections block, and the lecture's current corrections netted per paragraph", () => {
  assert.ok(correctionsBlock([{ before: "7-21", after: "7-31", note: "בשקף 3" }]).includes("«7-21» → «7-31» (the student's note: «בשקף 3»)"));
  const at = (m: number) => `2026-11-10T10:${String(m).padStart(2, "0")}:00Z`;
  const e = (part_idx: number, anchor: number, gen: number, rev: number, before_text: string, after_text: string, m: number, note = ""): EditRow => ({
    part_idx,
    anchor,
    gen,
    rev,
    before_text,
    after_text,
    note,
    created_at: at(m),
  });
  const edits = [
    e(0, 2, 1, 2, "a", "b", 1, "בשקף 2"),
    e(0, 2, 1, 3, "b", "c", 2),
    e(0, 4, 1, 4, "x", "y", 3),
    e(0, 4, 1, 5, "y", "x", 4), // put back: drops out
    e(1, 1, 0, 1, "old gen", "z", 5), // part 1 was rewritten since (gen 2)
    e(1, 3, 2, 1, "p", "q", 6),
  ];
  const got = currentCorrections(edits, [
    { idx: 0, gen: 1 },
    { idx: 1, gen: 2 },
  ]);
  assert.deepEqual(got, [
    { before: "a", after: "c", note: "בשקף 2" },
    { before: "p", after: "q", note: "" },
  ]);
  // the 20 most recent, in the summary's order
  const many = Array.from({ length: 25 }, (_, i) => e(0, i, 1, i + 1, `b${i}`, `a${i}`, i));
  const kept = currentCorrections(many, [{ idx: 0, gen: 1 }]);
  assert.equal(kept.length, 20);
  assert.deepEqual(kept[0], { before: "b5", after: "a5", note: "" });
});

test("the recording's notes block: by part, times as the transcript writes them", () => {
  assert.deepEqual([clockOf(0), clockOf(70), clockOf(2470), clockOf(3725)], ["0:00", "1:10", "41:10", "1:02:05"]);
  const block = recordingNotesBlock([
    { heading: "מנגנון", notes: [{ at_s: 2470, text: "בהרצאה הוסבר ש-Examplase קיים רק בחיידקים אנאירוביים." }, { at_s: null, text: "נאמר שזה יופיע במבחן." }] },
    { heading: "ריק", notes: [] },
  ]);
  const lines = block.split("\n");
  assert.ok(lines[0].startsWith("Notes from the recording of this lecture:"));
  assert.deepEqual(lines.slice(2), ["Part «מנגנון»:", "- [41:10] בהרצאה הוסבר ש-Examplase קיים רק בחיידקים אנאירוביים.", "- נאמר שזה יופיע במבחן."]);
  assert.ok(!block.includes("ריק"), "a part without notes is left out");
});

test("routing: the index is sorted by date then id; labels map back to ids", () => {
  const idx = lectureIndex([
    { id: "b", title: "Examplazole", course: "פרמקולוגיה", lecture_date: "2026-11-08", parts: ["מנגנון", "תופעות לוואי"] },
    { id: "a", title: "Fabrimycin", course: "פרמקולוגיה", lecture_date: "2026-11-01", parts: ["מבוא"] },
    { id: "c", title: "Sampleomycin", course: "", lecture_date: null, parts: [] },
  ]);
  assert.deepEqual(idx.text.split("\n"), [
    "The lectures:",
    "L1 | Sampleomycin | - | - | ",
    "L2 | Fabrimycin | פרמקולוגיה | 2026-11-01 | מבוא",
    "L3 | Examplazole | פרמקולוגיה | 2026-11-08 | מנגנון; תופעות לוואי",
  ]);
  assert.deepEqual([...idx.labels], [["L1", "c"], ["L2", "a"], ["L3", "b"]]);
});

test("routing: json_schema, effort low, the index cached; labels to ids; a refusal or bad JSON is not 'no lecture'", async () => {
  const idx = lectureIndex([
    { id: "b", title: "Examplazole", course: "x", lecture_date: "2026-11-08", parts: [] },
    { id: "a", title: "Fabrimycin", course: "x", lecture_date: "2026-11-01", parts: [] },
  ]);
  spends.length = 0;
  const f1 = fake(() => ({ json: routeJson('{"lectures":["L1","L9","l2"]}') }));
  const stopAt = Date.now() + 60_000;
  const r1 = await routeQuestion({ client: f1.client, index: idx, question: "מה נאמר על Fabrimycin?", ledger, stopAt });
  const b = f1.sent[0].body;
  assert.equal(b.stream, undefined, "not streamed");
  assert.equal(b.max_tokens, 1500);
  assert.equal(b.output_config.effort, "low");
  assert.equal(b.output_config.format.type, "json_schema");
  assert.deepEqual(b.output_config.format.schema, cleanSchema(zodOutputFormat(Route).schema as Record<string, unknown>));
  assert.equal(b.fallbacks, "default");
  assert.deepEqual(b.system, [
    { type: "text", text: ROUTE_SYSTEM },
    { type: "text", text: idx.text, cache_control: { type: "ephemeral" } },
  ]);
  assert.deepEqual(b.messages, [{ role: "user", content: "The question:\nמה נאמר על Fabrimycin?" }]);
  assert.deepEqual(r1, { ids: ["a", "b"], ok: true, model: MODEL }, "unknown L9 dropped, l2 read as L2");
  const f2 = fake(() => ({ json: routeJson("", "refusal") }));
  assert.deepEqual(await routeQuestion({ client: f2.client, index: idx, question: "x", ledger, stopAt }), { ids: [], ok: false, model: MODEL });
  const f3 = fake(() => ({ json: routeJson('{"lectures":["L1"') }));
  assert.equal((await routeQuestion({ client: f3.client, index: idx, question: "x", ledger, stopAt })).ok, false);
  const f4 = fake(() => ({ json: routeJson('{"lectures":[]}') }));
  assert.deepEqual(await routeQuestion({ client: f4.client, index: idx, question: "x", ledger, stopAt }), { ids: [], ok: true, model: MODEL });
  assert.equal(spends.length, 4, "each routing call settled once");
  assert.ok(spends.every((s) => s.kind === "ask" && s.ref === "route" && !s.estimated));
  assert.ok(Math.abs(spends[0].costUsd - (900 * 4 + 120 * 20) / 1e6) < 1e-12);
});

test("routing: a hung call stops at its deadline, retries included: 504 timeout, its reservation settled then", async () => {
  const idx = lectureIndex([
    { id: "b", title: "Examplazole", course: "x", lecture_date: "2026-11-08", parts: [] },
    { id: "a", title: "Fabrimycin", course: "x", lecture_date: "2026-11-01", parts: [] },
  ]);
  spends.length = 0;
  // A server that never answers: each request waits until it is aborted.
  const sent: Headers[] = [];
  const fetch = (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_ok, fail) => {
      sent.push(new Headers(init?.headers));
      const abort = () => fail(new DOMException("aborted", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  // Retries as anthropic() makes the client: a request that timed out would be tried again.
  const client = new Anthropic({ apiKey: "test-key", fetch: fetch as typeof globalThis.fetch, maxRetries: 3 });
  const t0 = Date.now();
  await assert.rejects(
    routeQuestion({ client, index: idx, question: "x", ledger, stopAt: Date.now() + 1 }),
    (e: unknown) => e instanceof HttpError && e.status === 504 && e.message === "timeout",
  );
  const took = Date.now() - t0;
  assert.ok(took >= 4_900 && took < 8_000, `stopped at the 5 s floor, not after four tries: ${took} ms`);
  assert.equal(sent.length, 1, "no retry past the deadline");
  assert.equal(sent[0].get("x-stainless-timeout"), "5", "the request's own timeout is the deadline");
  assert.equal(spends.length, 1, "settled once, at the deadline");
  assert.deepEqual([spends[0].kind, spends[0].ref, spends[0].estimated], ["ask", "route", true]);
});

test("the history's signatures: HMAC-SHA256 of lecture, user text and answer; anything else is dropped", async () => {
  const sig = await signTurn(KEY, LECTURE_A, "שאלה", "תשובה");
  assert.equal(sig, hex(LECTURE_A, "שאלה", "תשובה"));
  assert.ok(await verifyTurn(KEY, LECTURE_A, { u: "שאלה", a: "תשובה", sig }));
  assert.ok(await verifyTurn(KEY, LECTURE_A, { u: "שאלה", a: "תשובה", sig: sig.toUpperCase() }));
  assert.ok(!(await verifyTurn(KEY, LECTURE_B, { u: "שאלה", a: "תשובה", sig })), "another lecture");
  assert.ok(!(await verifyTurn(KEY, LECTURE_A, { u: "שאלה", a: "תשובה אחרת", sig })), "an edited answer");
  assert.ok(!(await verifyTurn("another key", LECTURE_A, { u: "שאלה", a: "תשובה", sig })));
  assert.ok(!(await verifyTurn(KEY, LECTURE_A, { u: "שאלה", a: "תשובה" })), "no sig");
  assert.ok(!(await verifyTurn(KEY, LECTURE_A, { u: "שאלה", a: "תשובה", sig: "zz" + sig.slice(2) })));
  const kept = await verifiedHistory(KEY, LECTURE_A, [
    { u: "1", a: "x", sig: hex(LECTURE_A, "1", "x") },
    { u: "2", a: "y", sig: hex(LECTURE_A, "2", "fake") },
    { u: "3", a: "z", sig: hex(LECTURE_A, "3", "z") },
  ]);
  assert.deepEqual(
    kept.map((t) => t.u),
    ["1", "3"],
  );
});

// ── 3. The op, through /api/study/ai, against local mocks ──

type Logged = { who: "rest" | "anthropic"; method: string; path: string; query: URLSearchParams; auth: string | null; body: string };
let log: Logged[] = [];
type SectionRow = { idx: number; title: string; gen: number; markdown: string; status: string };
type CommentRow = { id: string; lecture_id: string; kind: string; body: string; parent_id: string | null; resolved: boolean; resolved_at: string | null; created_at: string; ask_attempt: boolean; author_id: string };
/** Every section the code needs (§2.11), with K's end: op "ask" needs K 2 (§12.2.2). */
const SCHEMA_K2 = { ...REQUIRED_SCHEMA, K: 2 };
const db = {
  schema: { ...SCHEMA_K2 } as unknown,
  comments: [] as CommentRow[],
  lectures: [lectureA, lectureB, lectureC] as Lecture[],
  outlines: { [LECTURE_A]: [{ heading: "מבוא ומנגנון", from: 1, to: 4 }], [LECTURE_B]: [{ heading: "Examplazole", from: 1, to: 2 }] } as Record<string, unknown>,
  sections: [] as SectionRow[],
  edits: [] as EditRow[],
  recording: null as null | "missing" | { status: string },
  notes: [] as Array<{ part_idx: number; items: unknown }>,
  members: [{ group_id: GROUP }] as Array<{ group_id: string }>,
  reserve: [] as Array<{ status: number; body: unknown }>,
  nextId: 41,
  uses: 3,
  // Courses (sources.md B6.9): the course rows the member can read, the switch, B's parts and the points.
  courses: [] as Array<{ id: string; group_id: string; name: string; name_key: string; deleted_at: string | null }>,
  coursesOn: true,
  sectionsB: [] as SectionRow[],
  points: [] as Array<{ lecture_id: string; part_idx: number; subject: string; text: string }>,
};
const anthropicReplies: Array<{ sse?: Ev[]; json?: object }> = [];

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
const eq = (q: URLSearchParams, k: string) => q.get(k)?.replace(/^eq\./, "");

const rest = createServer(async (req, res) => {
  const body = await readAll(req);
  const url = new URL(req.url ?? "/", "http://x");
  const q = url.searchParams;
  log.push({ who: "rest", method: req.method ?? "", path: url.pathname, query: q, auth: req.headers.authorization ?? null, body });
  const p = url.pathname;
  if (p === "/auth/v1/user") return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated" });
  if (p === "/rest/v1/rpc/study_schema") return send(res, 200, db.schema);
  if (p === "/rest/v1/rpc/study_reserve") {
    const r = db.reserve.shift();
    return r ? send(res, r.status, r.body) : send(res, 200, db.nextId++);
  }
  if (p === "/rest/v1/rpc/study_settle") return send(res, 200, true);
  if (p === "/rest/v1/rpc/study_my_uses_today") return send(res, 200, db.uses);
  if (p === "/rest/v1/study_members") return send(res, 200, eq(q, "user_id") === USER ? db.members : []);
  if (p === "/rest/v1/study_lectures") {
    const id = eq(q, "id");
    if (id) return send(res, 200, db.lectures.filter((l) => l.id === id));
    const course = eq(q, "course");
    const rows = db.lectures
      .filter((l) => l.group_id === eq(q, "group_id") && (!course || l.course === course))
      .map((l) => ({ id: l.id, title: l.title, course: l.course, lecture_date: l.lecture_date, created_at: "2026-11-01T00:00:00Z", outline: db.outlines[l.id] ?? null }));
    return send(res, 200, rows);
  }
  if (p === "/rest/v1/rpc/study_feature_on") return send(res, 200, JSON.parse(body).p_name === "courses" ? db.coursesOn : true);
  if (p === "/rest/v1/study_courses") {
    const rows = db.courses.filter((c) => c.id === eq(q, "id") && c.group_id === GROUP && (q.get("deleted_at") !== "is.null" || c.deleted_at === null));
    return send(res, 200, rows);
  }
  const inList = (k: string) => q.get(k)?.match(/^in\.\((.*)\)$/)?.[1].split(",").map((x) => x.replace(/"/g, ""));
  if (p === "/rest/v1/study_points") return send(res, 200, db.points.filter((x) => inList("lecture_id")?.includes(x.lecture_id)));
  if (p === "/rest/v1/study_sections" && inList("lecture_id")) {
    const all = [...db.sections.map((x) => ({ ...x, lecture_id: LECTURE_A })), ...db.sectionsB.map((x) => ({ ...x, lecture_id: LECTURE_B }))];
    return send(res, 200, all.filter((x) => inList("lecture_id")!.includes(x.lecture_id) && (!eq(q, "status") || x.status === eq(q, "status"))));
  }
  if (p === "/rest/v1/study_sections") {
    const idx = eq(q, "idx");
    const rows = db.sections.filter((s) => eq(q, "lecture_id") === LECTURE_A && (idx === undefined || String(s.idx) === idx));
    return send(res, 200, rows);
  }
  if (p === "/rest/v1/study_edits") return send(res, 200, eq(q, "lecture_id") === LECTURE_A ? db.edits : []);
  if (p === "/rest/v1/study_recordings") {
    if (db.recording === "missing")
      return send(res, 404, { code: "PGRST205", details: null, hint: null, message: "Could not find the table 'public.study_recordings' in the schema cache" });
    return send(res, 200, db.recording && eq(q, "lecture_id") === LECTURE_A ? [db.recording] : []);
  }
  if (p === "/rest/v1/study_recording_notes") return send(res, 200, db.notes);
  if (p === "/rest/v1/study_comments") {
    // K5's two reads: the answered questions (newest mark first), then their members' replies.
    const ins = q.get("parent_id")?.match(/^in\.\((.*)\)$/)?.[1].split(",").map((x) => x.replace(/"/g, ""));
    let rows = db.comments.filter((c) => (ins ? c.parent_id !== null && ins.includes(c.parent_id) : c.lecture_id === eq(q, "lecture_id")));
    if (eq(q, "kind")) rows = rows.filter((c) => c.kind === eq(q, "kind"));
    if (eq(q, "resolved")) rows = rows.filter((c) => String(c.resolved) === eq(q, "resolved"));
    if (q.get("parent_id") === "is.null") rows = rows.filter((c) => c.parent_id === null);
    if (eq(q, "ask_attempt")) rows = rows.filter((c) => String(c.ask_attempt) === eq(q, "ask_attempt"));
    const by = (k: "resolved_at" | "created_at", dir: number) => (a: CommentRow, b: CommentRow) => ((a[k] ?? "") < (b[k] ?? "") ? -dir : (a[k] ?? "") > (b[k] ?? "") ? dir : 0);
    rows = ins ? [...rows].sort(by("created_at", 1)) : [...rows].sort((a, b) => by("resolved_at", -1)(a, b) || by("created_at", -1)(a, b));
    const cols = (q.get("select") ?? "*").split(",").map((c) => c.trim());
    return send(res, 200, rows.slice(0, Number(q.get("limit") ?? 1000)).map((c) => Object.fromEntries(cols.map((k) => [k, c[k as keyof CommentRow]]))));
  }
  send(res, 404, { message: `unmocked ${req.method} ${p}` });
});
const anthropicServer = createServer(async (req, res) => {
  const body = await readAll(req);
  log.push({ who: "anthropic", method: req.method ?? "", path: req.url ?? "", query: new URLSearchParams(), auth: null, body });
  const reply = anthropicReplies.shift();
  if (!reply) return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "no reply queued" } });
  if (reply.json) return send(res, 200, reply.json);
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(sse(reply.sse ?? []));
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
  db.schema = { ...SCHEMA_K2 };
  db.comments = [];
  db.sections = [
    { idx: 0, title: "Fabrimycin: מנגנון ותופעות לוואי", gen: 1, markdown: PART0, status: "ready" },
    { idx: 1, title: "Placebozole", gen: 2, markdown: "## Placebozole\n\nפעילה רק בחלל המעי. [ש' 5]", status: "ready" },
  ];
  db.edits = [];
  db.recording = null;
  db.notes = [];
  db.members = [{ group_id: GROUP }];
  db.reserve = [];
  db.uses = 3;
  db.courses = [{ id: COURSE, group_id: GROUP, name: "פרמקולוגיה לדוגמה", name_key: "פרמקולוגיה לדוגמה", deleted_at: null }];
  db.coursesOn = true;
  db.sectionsB = [{ idx: 0, title: "Examplazole", gen: 1, markdown: "## Examplazole\n\nExamplazole מעכב Fakease. [ש' 1]\n\n- כאבי ראש. [ש' 2]", status: "ready" }];
  db.points = [];
  anthropicReplies.length = 0;
});

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const ask = (body: Record<string, unknown>) =>
  ai.fetch(
    new Request("http://localhost/api/study/ai", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ op: "ask", ...body }),
    }),
  );
/** The NDJSON lines of a stream (after the U+200B first byte), and its error tail. */
const readStream = async (res: Response) => {
  const text = await res.text();
  const [head, error] = text.split("\n\u0000ERROR ");
  assert.equal(head[0], "​");
  return { lines: head.slice(1).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>), error: error ?? null };
};
const restCalls = (path: string) => log.filter((l) => l.who === "rest" && l.path === path);
const modelCalls = () => log.filter((l) => l.who === "anthropic");
const sentBody = (i = 0) => JSON.parse(modelCalls()[i].body) as Record<string, any>;
const answerReply = (text: string, stop = "end_turn") => ({ sse: [startEv(), ...thinking(0), ...textEvs(1, text), ...endEvs(stop, { output_tokens: 300 })] });
const QUESTION = "מה נאמר בהרצאה על Fabrimycin ואלכוהול?";

test("op: without section K's end in the database (K missing, or at 1), 503 schema, and nothing reserved or asked", async () => {
  for (const schema of [Object.fromEntries(Object.entries(REQUIRED_SCHEMA).filter(([k]) => k !== "K")), { ...REQUIRED_SCHEMA, K: 1 }]) {
    db.schema = schema;
    const res = await ask({ lectureId: LECTURE_A, question: QUESTION });
    assert.deepEqual([res.status, await res.json()], [503, { error: "schema" }], JSON.stringify(schema));
  }
  assert.equal(restCalls("/rest/v1/rpc/study_reserve").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("op: input errors answer 400 before anything is read; a 4th history turn is refused", async () => {
  const turn = { u: "a", a: "b", sig: hex(LECTURE_A, "a", "b") };
  for (const [body, error] of [
    [{ lectureId: LECTURE_A, question: "" }, "question required"],
    [{ lectureId: LECTURE_A, question: "x".repeat(501) }, "too long"],
    [{ lectureId: LECTURE_A, question: QUESTION, history: [turn, turn, turn, turn] }, "bad history"],
    [{ lectureId: null, question: QUESTION, focus: { part: 0, anchor: 4 } }, "bad scope"],
  ] as const) {
    const res = await ask(body);
    assert.deepEqual([res.status, await res.json()], [400, { error }], error);
  }
  assert.equal(log.filter((l) => l.path !== "/rest/v1/rpc/study_schema").length, 0, "nothing read, nothing reserved");
});

test("op, one lecture: reserved (ask/answer, the key) before the call, settled after; turn, answer, done with its sig", async () => {
  anthropicReplies.push(answerReply(ANSWER_1));
  const res = await ask({ lectureId: LECTURE_A, course: null, question: QUESTION, focus: null, history: [] });
  assert.equal(res.status, 200);
  const { lines, error } = await readStream(res);
  assert.equal(error, null);
  const u = askTurnText(QUESTION, null, false); // REC5: no recording yet
  assert.deepEqual(lines[0], { t: "turn", u });
  assert.equal(
    lines
      .filter((l) => l.t === "a")
      .map((l) => l.d)
      .join(""),
    ANSWER_1,
  );
  const done = lines[lines.length - 1];
  assert.deepEqual(done, { t: "done", stop: "end_turn", badTags: [], model: MODEL, left: DAILY_ASKS - 3, sig: hex(LECTURE_A, u, ANSWER_1), unsettled: 0 });
  // The ledger: one reservation before the model call, one settle after it.
  const order = log.filter((l) => l.path === "/rest/v1/rpc/study_reserve" || l.who === "anthropic" || l.path === "/rest/v1/rpc/study_settle").map((l) => l.who === "anthropic" ? "model" : l.path.split("_").pop());
  assert.deepEqual(order, ["reserve", "model", "settle"]);
  const r = JSON.parse(restCalls("/rest/v1/rpc/study_reserve")[0].body);
  assert.deepEqual(
    { ...r, p_estimate: typeof r.p_estimate },
    {
      p_group: GROUP,
      p_lecture: LECTURE_A,
      p_kind: "ask",
      p_ref: "answer",
      p_estimate: "number",
      p_cap: 33,
      p_share: POLICY.ask.share,
      p_member_share: POLICY.ask.memberShare,
      p_daily: 20,
      p_daily_ref: "answer",
      p_key: KEY,
    },
  );
  assert.ok(r.p_estimate > 0.05 && r.p_estimate < 1, String(r.p_estimate));
  const s = JSON.parse(restCalls("/rest/v1/rpc/study_settle")[0].body);
  assert.equal(s.p_id, 41);
  assert.equal(s.p_key, KEY);
  assert.equal(s.p_model, MODEL);
  assert.ok(restCalls("/rest/v1/rpc/study_settle")[0].auth?.endsWith(TOKEN), "with the member's token");
  // The request: the deck as section.ts sends it, the summary (K1), each with a breakpoint, plus the automatic one.
  const b = sentBody();
  assert.equal(b.system[1].text, lectureBlock(lectureA));
  assert.equal(b.system[2].text, summaryBlock(db.sections.map((x) => tidyMarkdown(x.markdown))));
  assert.deepEqual(b.system[2].cache_control, { type: "ephemeral" });
  assert.equal(b.system.length, 3, "no corrections, no recording, no answered thread");
  assert.deepEqual(b.cache_control, { type: "ephemeral" });
  assert.deepEqual(b.messages, [{ role: "user", content: u }]);
  // K-6: no REST call carries the question.
  assert.ok(!log.some((l) => l.who === "rest" && (l.body.includes("Fabrimycin ואלכוהול") || decodeURIComponent(l.query.toString()).includes("ואלכוהול"))));
});

test("op: a follow-up's prefix is byte-identical; a turn with a wrong sig or another lecture's is dropped", async () => {
  anthropicReplies.push(answerReply(ANSWER_1));
  const first = await readStream(await ask({ lectureId: LECTURE_A, question: QUESTION }));
  const u1 = first.lines[0].u as string;
  const a1 = first.lines.filter((l) => l.t === "a").map((l) => l.d).join("");
  const sig1 = first.lines[first.lines.length - 1].sig as string;
  const body1 = sentBody(0);
  log = [];
  anthropicReplies.push(answerReply(ANSWER_4));
  const forged = { u: "שאלה אחרת", a: "תשובה שלא נכתבה כאן", sig: hex(LECTURE_A, "שאלה אחרת", "תשובה אחרת") };
  const otherLecture = { u: "x", a: "y", sig: hex(LECTURE_B, "x", "y") };
  const second = await readStream(
    await ask({ lectureId: LECTURE_A, question: "ולמה היא לא פועלת בתאים אירוביים?", history: [forged, { u: u1, a: a1, sig: sig1 }, otherLecture] }),
  );
  assert.equal(second.error, null);
  const body2 = sentBody(0);
  assert.equal(JSON.stringify(body2.system), JSON.stringify(body1.system));
  assert.deepEqual(body2.messages, [
    body1.messages[0],
    { role: "assistant", content: ANSWER_1 },
    { role: "user", content: askTurnText("ולמה היא לא פועלת בתאים אירוביים?", null, false) },
  ]);
  assert.ok(!modelCalls()[0].body.includes("תשובה שלא נכתבה כאן"), "the forged answer never reaches the model");
});

test("op: the focus paragraph comes from the part's markdown; one that does not exist is 400 bad scope", async () => {
  anthropicReplies.push(answerReply(ANSWER_1));
  const md = tidyMarkdown(PART0);
  const anchor = blockSources(md).findIndex((b) => b.text.startsWith("**תופעות לוואי:**"));
  const res = await readStream(await ask({ lectureId: LECTURE_A, question: "מה הכי חשוב כאן?", focus: { part: 0, anchor } }));
  assert.equal(res.error, null);
  const want = askTurnText("מה הכי חשוב כאן?", { heading: "Fabrimycin: מנגנון ותופעות לוואי", text: blockSources(md)[anchor].text }, false);
  assert.equal(res.lines[0].u, want);
  assert.deepEqual(sentBody().messages, [{ role: "user", content: want }]);
  const gone = await ask({ lectureId: LECTURE_A, question: "x", focus: { part: 0, anchor: 99 } });
  assert.deepEqual([gone.status, await gone.json()], [400, { error: "bad scope" }]);
  const noPart = await ask({ lectureId: LECTURE_A, question: "x", focus: { part: 7, anchor: 0 } });
  assert.deepEqual([noPart.status, await noPart.json()], [400, { error: "bad scope" }]);
});

test("op: the current corrections are one block after the deck; an older generation's are not", async () => {
  db.edits = [
    { part_idx: 0, anchor: 4, gen: 1, rev: 2, before_text: "x 72 שעות", after_text: "x 48 שעות", note: "בשקף 7 כתוב 72", created_at: "2026-11-10T10:00:00Z" },
    { part_idx: 1, anchor: 1, gen: 1, rev: 2, before_text: "old", after_text: "older", note: "", created_at: "2026-11-10T10:01:00Z" },
  ];
  anthropicReplies.push(answerReply(ANSWER_1));
  await readStream(await ask({ lectureId: LECTURE_A, question: QUESTION }));
  const b = sentBody();
  assert.equal(b.system.length, 4);
  assert.equal(b.system[1].text, lectureBlock(lectureA));
  assert.ok(b.system[2].text.startsWith("The group's summary"), "the summary right after the deck");
  assert.equal(b.system[3].text, correctionsBlock([{ before: "x 72 שעות", after: "x 48 שעות", note: "בשקף 7 כתוב 72" }]));
  assert.ok(!("cache_control" in b.system[3]));
});

test("op: a lecture with a ready recording adds its notes after the deck; without section W, none", async () => {
  db.recording = { status: "ready" };
  db.notes = [
    { part_idx: 0, items: [{ anchor: 4, quote: "תופעות", at_s: 2470, text: "בהרצאה נאמר שהטעם המתכתי חולף אחרי הטיפול." }, { anchor: -1, at_s: null, text: "נאמר שזה יופיע במבחן." }] },
    { part_idx: 1, items: [] },
  ];
  anthropicReplies.push(answerReply(ANSWER_1));
  const ready = await readStream(await ask({ lectureId: LECTURE_A, question: QUESTION }));
  assert.equal(ready.lines[0].u, askTurnText(QUESTION, null, true), "REC5: with a ready recording, no line about it");
  const b = sentBody();
  assert.equal(b.system.length, 4);
  assert.equal(b.system[1].text, lectureBlock(lectureA), "the deck and its breakpoint unchanged");
  assert.ok(b.system[2].text.startsWith("The group's summary"), "then the summary");
  assert.equal(
    b.system[3].text,
    recordingNotesBlock([
      { heading: "Fabrimycin: מנגנון ותופעות לוואי", notes: [{ at_s: 2470, text: "בהרצאה נאמר שהטעם המתכתי חולף אחרי הטיפול." }, { at_s: null, text: "נאמר שזה יופיע במבחן." }] },
    ]),
  );
  assert.ok(b.system[3].text.includes("- [41:10] בהרצאה נאמר"));
  assert.ok(!("cache_control" in b.system[3]));
  // Not ready yet, and section W not loaded: no block, and REC5's line ends the user turn.
  for (const rec of [{ status: "transcribing" }, "missing" as const]) {
    log = [];
    db.recording = rec;
    anthropicReplies.push(answerReply(ANSWER_1));
    const r = await readStream(await ask({ lectureId: LECTURE_A, question: QUESTION }));
    assert.equal(r.error, null);
    assert.equal(sentBody().system.length, 3, JSON.stringify(rec));
    assert.equal(r.lines[0].u, askTurnText(QUESTION, null, false));
    assert.ok((r.lines[0].u as string).endsWith(`\n\n${NO_RECORDING}`));
  }
});

test("op, K1: the group's summary is the ready parts, cached after the deck, byte-stable while no part changes", async () => {
  db.sections.push({ idx: 2, title: "בכתיבה", gen: 1, markdown: "## בכתיבה\n\nחלקי", status: "writing" });
  anthropicReplies.push(answerReply(ANSWER_1), answerReply(ANSWER_4));
  await readStream(await ask({ lectureId: LECTURE_A, question: QUESTION }));
  await readStream(await ask({ lectureId: LECTURE_A, question: "ולמה?" }));
  const [b1, b2] = [sentBody(0), sentBody(1)];
  assert.equal(b1.system[2].text, summaryBlock([tidyMarkdown(PART0), "## Placebozole\n\nפעילה רק בחלל המעי. [ש' 5]"]));
  assert.ok(!b1.system[2].text.includes("חלקי"), "a part being written is not in it");
  assert.equal(JSON.stringify(b2.system.slice(0, 3)), JSON.stringify(b1.system.slice(0, 3)), "the same bytes for the next question");
  // A part changes (a correction): the block changes with it, the deck does not.
  log = [];
  db.sections[1].markdown = "## Placebozole\n\nפעילה רק בחלל המעי, במנה אחת. [ש' 5]";
  anthropicReplies.push(answerReply(ANSWER_1));
  await readStream(await ask({ lectureId: LECTURE_A, question: QUESTION }));
  const b3 = sentBody(0);
  assert.equal(JSON.stringify(b3.system.slice(0, 2)), JSON.stringify(b1.system.slice(0, 2)));
  assert.notEqual(b3.system[2].text, b1.system[2].text);
  assert.ok(b3.system[2].text.includes("במנה אחת"));
});

test("op, K5: the answered threads, newest mark first, the members' replies only, and no names", async () => {
  const at = (m: number) => new Date(Date.UTC(2026, 10, 14, 10, m)).toISOString();
  const row = (id: string, o: Partial<CommentRow>): CommentRow => ({
    id, lecture_id: LECTURE_A, kind: "comment", body: "", parent_id: null, resolved: false, resolved_at: null, created_at: at(0), ask_attempt: false, author_id: USER, ...o,
  });
  db.comments = [
    row("q1", { kind: "question", body: "למה Fabrimycin לא פועלת באוויר?", resolved: true, resolved_at: at(30), created_at: at(1) }),
    row("r1", { parent_id: "q1", body: "ניסיון: לא מופיע בשקפים.", ask_attempt: true, created_at: at(2) }),
    row("r2", { parent_id: "q1", body: "כי Examplase עובדת רק בלי חמצן. [ש' 2]", created_at: at(3) }),
    row("q2", { kind: "question", body: "מה עם אלכוהול?", resolved: true, resolved_at: at(40), created_at: at(5) }),
    row("r3", { parent_id: "q2", body: "72 שעות. [ש' 7]", created_at: at(6) }),
    row("q3", { kind: "question", body: "שאלה פתוחה?", created_at: at(7) }),
    row("r4", { parent_id: "q3", body: "עוד לא ברור", created_at: at(8) }),
  ];
  anthropicReplies.push(answerReply(ANSWER_1));
  const r = await readStream(await ask({ lectureId: LECTURE_A, question: QUESTION }));
  assert.equal(r.error, null);
  const b = sentBody();
  const last = b.system[b.system.length - 1];
  assert.equal(
    last.text,
    threadsBlock([
      { q: "מה עם אלכוהול?", a: ["72 שעות. [ש' 7]"] },
      { q: "למה Fabrimycin לא פועלת באוויר?", a: ["כי Examplase עובדת רק בלי חמצן. [ש' 2]"] },
    ]),
  );
  assert.ok(!("cache_control" in last), "uncached: it changes with every thread");
  assert.ok(!last.text.includes("שאלה פתוחה") && !last.text.includes("ניסיון"), "an open question and Claude's attempt stay out");
  // No names: neither the reads nor the block ask who wrote what.
  for (const l of restCalls("/rest/v1/study_comments")) assert.ok(!/author|name/.test(l.query.get("select") ?? ""), l.query.toString());
  assert.ok(!/שוהם|נועה|33333333/.test(last.text));
});

test("op: the budget's refusals answer before the stream, and no model is called", async () => {
  for (const [code, status] of [
    ["daily_limit", 429],
    ["budget", 402],
    ["reserve", 402],
    ["member_share", 402],
    ["off", 403],
  ] as const) {
    log = [];
    db.reserve = [pgError(code)];
    const res = await ask({ lectureId: LECTURE_A, question: QUESTION });
    assert.deepEqual([res.status, await res.json()], [status, { error: code }], code);
    assert.equal(modelCalls().length, 0, code);
  }
});

test("op: a refusal is settled, then thrown; the phone gets no done line", async () => {
  anthropicReplies.push(answerReply("ההרצאה", "refusal"));
  const r = await readStream(await ask({ lectureId: LECTURE_A, question: QUESTION }));
  assert.equal(r.error, "refusal");
  assert.ok(!r.lines.some((l) => l.t === "done"));
  const order = log.filter((l) => l.who === "anthropic" || l.path === "/rest/v1/rpc/study_settle").map((l) => l.who);
  assert.deepEqual(order, ["anthropic", "rest"], "settled after the call");
});

test("op, the library: routed first (ask/route), then answered (ask/answer), each reserved and settled", async () => {
  anthropicReplies.push({ json: routeJson('{"lectures":["L2","L1"]}') }, answerReply(ANSWER_1));
  const r = await readStream(await ask({ lectureId: null, course: null, question: QUESTION, history: [] }));
  assert.equal(r.error, null);
  // index: C (no date) first, then A (11-01), then B (11-08): L2 is A, L1 is C.
  assert.deepEqual(r.lines[0], { t: "lecture", id: LECTURE_A, title: lectureA.title, also: [{ id: LECTURE_C, title: lectureC.title }] });
  assert.deepEqual(r.lines[1], { t: "turn", u: askTurnText(QUESTION, null, false) });
  assert.equal(r.lines[r.lines.length - 1].t, "done");
  const refs = restCalls("/rest/v1/rpc/study_reserve").map((l) => JSON.parse(l.body) as Record<string, unknown>);
  assert.deepEqual(
    refs.map((x) => [x.p_kind, x.p_ref, x.p_lecture]),
    [
      ["ask", "route", null],
      ["ask", "answer", LECTURE_A],
    ],
  );
  const order = log
    .filter((l) => l.who === "anthropic" || l.path === "/rest/v1/rpc/study_reserve" || l.path === "/rest/v1/rpc/study_settle")
    .map((l) => (l.who === "anthropic" ? "model" : l.path.split("_").pop()));
  assert.deepEqual(order, ["reserve", "model", "settle", "reserve", "model", "settle"]);
  const route = sentBody(0);
  assert.equal(route.system[1].text.split("\n").length, 4, "the index: a header and three lectures");
  assert.ok(route.system[1].text.includes("| מבוא ומנגנון"), "the parts' headings from the outline");
  assert.equal(sentBody(1).system[1].text, lectureBlock(lectureA));
});

test("op, the library: no lecture fits, or routing fails: the list, and no answer is reserved", async () => {
  for (const [reply, ok] of [
    [routeJson('{"lectures":[]}'), true],
    [routeJson("", "refusal"), false],
  ] as const) {
    log = [];
    anthropicReplies.push({ json: reply });
    const r = await readStream(await ask({ lectureId: null, question: QUESTION }));
    assert.equal(r.error, null);
    assert.deepEqual(r.lines, [
      {
        t: "nolecture",
        ok,
        lectures: [
          { id: LECTURE_C, title: lectureC.title },
          { id: LECTURE_A, title: lectureA.title },
          { id: LECTURE_B, title: lectureB.title },
        ],
      },
    ]);
    assert.deepEqual(
      restCalls("/rest/v1/rpc/study_reserve").map((l) => JSON.parse(l.body).p_ref),
      ["route"],
    );
    assert.equal(restCalls("/rest/v1/rpc/study_settle").length, 1);
  }
});

test("op, the library: one course with one lecture needs no routing; no lectures is 404", async () => {
  anthropicReplies.push(answerReply(ANSWER_2));
  const r = await readStream(await ask({ lectureId: null, course: "קורס אחר", question: QUESTION }));
  assert.deepEqual(r.lines[0], { t: "lecture", id: LECTURE_C, title: lectureC.title, also: [] });
  assert.deepEqual(
    restCalls("/rest/v1/rpc/study_reserve").map((l) => JSON.parse(l.body).p_ref),
    ["answer"],
  );
  log = [];
  const none = await ask({ lectureId: null, course: "אין כזה", question: QUESTION });
  assert.deepEqual([none.status, await none.json()], [404, { error: "no lectures" }]);
  db.members = [];
  const alone = await ask({ lectureId: null, question: QUESTION });
  assert.deepEqual([alone.status, await alone.json()], [404, { error: "no lectures" }]);
  assert.equal(modelCalls().length, 0);
});

test("op: a lecture of another group (or hidden) is 404 lecture not found", async () => {
  const res = await ask({ lectureId: "dddddddd-0000-4000-8000-00000000000d", question: QUESTION });
  assert.deepEqual([res.status, await res.json()], [404, { error: "lecture not found" }]);
  assert.equal(restCalls("/rest/v1/rpc/study_reserve").length, 0);
});

// ── 4. "לשאול על כל הקורס" (sources.md B6.9): scope "course" ──

const COURSE_ANSWER =
  "Fabrimycin אסורה עם אלכוהול: היא גורמת לתגובה דמוית Disulfiram, עד 72 שעות אחרי המנה האחרונה. [הרצאה 1 · ש׳ 7]\n\nבהרצאה 2 מופיע רק Examplazole. [הרצאה 2 · ש׳ 9]";
const askCourse = (body: Record<string, unknown> = {}) => ask({ scope: "course", courseId: COURSE, question: QUESTION, history: [], ...body });
/** Every section, with K's end and section S at 1. */
const SCHEMA_S1 = { ...SCHEMA_K2, S: 1 };

test("op, course: without section S (or with the switch off) nothing is read, reserved or asked", async () => {
  // First, before any passing check of the same needs is remembered.
  db.schema = { ...SCHEMA_K2 };
  const res = await askCourse();
  assert.deepEqual([res.status, await res.json()], [503, { error: "schema" }]);
  db.schema = { ...SCHEMA_S1 };
  db.coursesOn = false;
  const off = await askCourse();
  assert.deepEqual([off.status, await off.json()], [403, { error: "off" }]);
  assert.equal(restCalls("/rest/v1/rpc/study_reserve").length, 0);
  assert.equal(restCalls("/rest/v1/study_sections").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("op, course: the body's scope is checked before anything is read", async () => {
  db.schema = { ...SCHEMA_S1 };
  for (const bad of [
    { courseId: "not-an-id" },
    { courseId: null },
    { lectureId: LECTURE_A },
    { course: "פרמקולוגיה לדוגמה" },
    { focus: { part: 0, anchor: 1 } },
    { scope: "library" },
  ]) {
    log = [];
    const res = await askCourse(bad);
    assert.deepEqual([res.status, await res.json()], [400, { error: "bad scope" }], JSON.stringify(bad));
    assert.equal(log.filter((l) => l.path !== "/rest/v1/rpc/study_schema").length, 0);
  }
});

test("op, course: no route call; the context line first, then one answer reserved (ask/answer, no lecture) and settled", async () => {
  db.schema = { ...SCHEMA_S1 };
  anthropicReplies.push(answerReply(COURSE_ANSWER));
  const res = await askCourse();
  assert.equal(res.status, 200);
  const { lines, error } = await readStream(res);
  assert.equal(error, null);
  // The cut: lecture A is 1 (1 Nov), B is 2 (8 Nov); C is another course's.
  const ctx = lines[0];
  assert.equal(ctx.t, "context");
  assert.equal(ctx.total, 6, "A's four paragraphs and B's two, headings left out");
  assert.ok(ctx.chosen >= 1 && ctx.chosen <= 12);
  assert.deepEqual(ctx.lectures[0], { n: 1, id: LECTURE_A, title: lectureA.title });
  assert.ok(ctx.lectures.length <= 4 && ctx.lectures.every((l: { id: string }) => l.id !== LECTURE_C));
  assert.ok(
    ctx.paragraphs.some((p: { lecture: number; part: number; slides: number[] }) => p.lecture === 1 && p.part === 0 && p.slides.includes(7)),
    "the paragraph on Disulfiram and alcohol is chosen",
  );
  const u = QUESTION.trim();
  assert.deepEqual(lines[1], { t: "turn", u }, "no recording line: a course has none");
  assert.equal(
    lines
      .filter((l) => l.t === "a")
      .map((l) => l.d)
      .join(""),
    COURSE_ANSWER,
  );
  assert.deepEqual(lines[lines.length - 1], {
    t: "done",
    stop: "end_turn",
    badTags: [],
    badCites: ["2·9"],
    model: MODEL,
    left: DAILY_ASKS - 3,
    sig: hex(`course:${COURSE}`, u, COURSE_ANSWER),
    unsettled: 0,
  });
  // One model call, no routing: reserve, model, settle.
  const order = log
    .filter((l) => l.who === "anthropic" || l.path === "/rest/v1/rpc/study_reserve" || l.path === "/rest/v1/rpc/study_settle")
    .map((l) => (l.who === "anthropic" ? "model" : l.path.split("_").pop()));
  assert.deepEqual(order, ["reserve", "model", "settle"]);
  const r = JSON.parse(restCalls("/rest/v1/rpc/study_reserve")[0].body);
  assert.deepEqual([r.p_group, r.p_lecture, r.p_kind, r.p_ref, r.p_daily, r.p_key], [GROUP, null, "ask", "answer", 20, KEY]);
  assert.ok(r.p_estimate > 0.05 && r.p_estimate < 1, String(r.p_estimate));
  const settled = JSON.parse(restCalls("/rest/v1/rpc/study_settle")[0].body);
  assert.deepEqual([typeof settled.p_id, settled.p_model, settled.p_key], ["number", MODEL, KEY]);
  // What the model read: the frozen prompt, the course note, the paragraphs with their addresses; no deck.
  const b = sentBody();
  assert.equal(b.system.length, 3);
  assert.equal(b.system[0].text, ASK_SYSTEM);
  assert.equal(b.system[1].text, COURSE_ASK_NOTE);
  assert.match(b.system[2].text, /^The course «פרמקולוגיה לדוגמה»: .* \(\d+ of 6\)\./);
  assert.ok(b.system[2].text.includes(`[הרצאה 1 · «${lectureA.title}» · «Fabrimycin: מנגנון ותופעות לוואי»]`));
  assert.ok(!b.system.some((x: { text: string }) => x.text === lectureBlock(lectureA)), "no slides");
  assert.deepEqual(b.messages, [{ role: "user", content: u }]);
  // The question goes to no REST call.
  assert.ok(!log.some((l) => l.who === "rest" && (l.body.includes("ואלכוהול") || decodeURIComponent(l.query.toString()).includes("ואלכוהול"))));
});

test("op, course: a follow-up keeps only turns signed for this course, and chooses with them", async () => {
  db.schema = { ...SCHEMA_S1 };
  anthropicReplies.push(answerReply(COURSE_ANSWER));
  const u0 = "מה נאמר על Examplazole?";
  const mine = { u: u0, a: "Examplazole מעכב Fakease. [הרצאה 2 · ש׳ 1]", sig: hex(`course:${COURSE}`, u0, "Examplazole מעכב Fakease. [הרצאה 2 · ש׳ 1]") };
  const lectures = { u: "x", a: "y", sig: hex(LECTURE_A, "x", "y") };
  await readStream(await askCourse({ question: "ולמה?", history: [lectures, mine] }));
  const b = sentBody();
  assert.deepEqual(
    b.messages.map((m: { role: string; content: string }) => m.content),
    [mine.u, mine.a, "ולמה?"],
    "the lecture's turn is dropped",
  );
  assert.ok(b.system[2].text.includes("Examplazole מעכב Fakease"), "the earlier question chose B's paragraph");
});

test("op, course: another group's (or a merged) course is 404; no lectures 404; no summary yet 409; the budget's refusal before the stream", async () => {
  db.schema = { ...SCHEMA_S1 };
  db.courses = [];
  const gone = await askCourse();
  assert.deepEqual([gone.status, await gone.json()], [404, { error: "course not found" }]);
  db.courses = [{ id: COURSE, group_id: GROUP, name: "אין כזה", name_key: "אין כזה", deleted_at: null }];
  const empty = await askCourse();
  assert.deepEqual([empty.status, await empty.json()], [404, { error: "no lectures" }]);
  db.courses = [{ id: COURSE, group_id: GROUP, name: "פרמקולוגיה לדוגמה", name_key: "פרמקולוגיה לדוגמה", deleted_at: null }];
  db.sections = db.sections.map((x) => ({ ...x, status: "writing" }));
  db.sectionsB = [];
  const unready = await askCourse();
  assert.deepEqual([unready.status, await unready.json()], [409, { error: "no summaries" }]);
  db.sectionsB = [{ idx: 0, title: "Examplazole", gen: 1, markdown: "Examplazole מעכב Fakease. [ש' 1]", status: "ready" }];
  db.reserve = [pgError("daily_limit")];
  const limited = await askCourse();
  assert.deepEqual([limited.status, await limited.json()], [429, { error: "daily_limit" }]);
  assert.equal(modelCalls().length, 0);
});
