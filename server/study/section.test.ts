import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import outline from "../../api/study/outline.js";
import section from "../../api/study/section.js";
import { costUsd } from "./budget.js";
import { correctionsForRewrite } from "./prompts/summary.js";
import { MODEL, REQUIRED_SCHEMA, type Lecture } from "./study.js";
import { writerTiming } from "./writer.js";

/* F-8, then W-3 (spec §7.F, §7.W): outline.ts and section.ts, the device
 * path, in Node, against local mocks of PostgREST, Auth and Storage and of
 * Anthropic's SSE. A unit is claimed through study_claim with the member's
 * token and the server key (nothing claimed: 409 "busy"); its worst case is
 * reserved before the model call and the reservation is settled by
 * study_finish / study_outline_done (p_charge); the requests are
 * byte-identical to the ones these functions sent before F0 (BEFORE_F0
 * below), and a rewrite's corrections are one more block at the end. */

const KEY = "k-0123456789abcdef0123456789abcdef";
const LECTURE = "11111111-0000-4000-8000-000000000001";
const GROUP = "22222222-0000-4000-8000-000000000002";
const USER = "33333333-0000-4000-8000-000000000003";
const LEASE = "44444444-0000-4000-8000-000000000004";

// A lecture made for the tests: Hebrew with English terms, a table, pictures (one a thumbnail).
const lecture: Lecture = {
  id: LECTURE,
  group_id: GROUP,
  course: "קורס לדוגמה",
  title: "הרצאה לדוגמה",
  lecturer: "ד״ר דוגמה",
  lecture_date: null,
  source_kind: "pptx",
  slides: [
    { n: 1, title: "מבוא: Examplomycin", lines: ["מבוא: Examplomycin", "תרופה לדוגמה (Examplomycin) מעכבת אנזים דמיוני", "מינון: 5-10 mg/kg"], tables: [], notes: "", figures: [] },
    {
      n: 2,
      title: "מנגנון פעולה",
      lines: ["מנגנון פעולה", "Examplase inhibition", "פעילה רק בתנאים אנאירוביים"],
      tables: [[["תכונה", "ערך"], ["זמן מחצית", "8 h"], ["פינוי", "כליות"]]],
      notes: "להדגיש את המנגנון",
      figures: [{ k: 1, path: `${GROUP}/${LECTURE}/s2-1.jpg`, w: 1200, h: 800 }],
    },
    {
      n: 3,
      title: "תופעות לוואי",
      lines: ["תופעות לוואי", "בחילה, טעם מתכתי", "Disulfiram-like reaction"],
      tables: [],
      notes: "",
      figures: [
        { k: 1, path: `${GROUP}/${LECTURE}/s3-1.jpg`, w: 90, h: 60 },
        { k: 2, path: `${GROUP}/${LECTURE}/s3-2.jpg`, w: 640, h: 480 },
      ],
    },
    { n: 4, title: "התוויות", lines: ["התוויות", "זיהום לדוגמה A", "זיהום לדוגמה B"], tables: [], notes: "", figures: [] },
    { n: 5, title: "Examplomycin B", lines: ["Examplomycin B", "נגזרת ארוכת טווח"], tables: [], notes: "", figures: [{ k: 1, path: `${GROUP}/${LECTURE}/s5-1.jpg`, w: 1400, h: 1050 }] },
    { n: 6, title: "השוואה", lines: ["השוואה"], tables: [[["", "A", "B"], ["מינון", "פעם ביום", "פעמיים ביום"]]], notes: "", figures: [] },
    { n: 7, title: "עמידות", lines: ["עמידות", "מוטציה באנזים המטרה"], tables: [], notes: "", figures: [] },
    { n: 8, title: "סיכום", lines: ["סיכום", "שלוש נקודות לזכור"], tables: [], notes: "", figures: [] },
  ],
};
type Row = { idx: number; title: string; slide_from: number; slide_to: number; error: string | null; status: string; markdown: string };
const baseSections = (): Row[] => [
  { idx: 0, title: "מבוא ומנגנון", slide_from: 1, slide_to: 2, error: null, status: "ready", markdown: "## מבוא ומנגנון\n\nהתרופה מעכבת את Examplase [ש' 1].\n\nפעילה רק בתנאים אנאירוביים [ש' 2]." },
  { idx: 1, title: "תופעות לוואי והתוויות", slide_from: 3, slide_to: 5, error: null, status: "writing", markdown: "" },
  { idx: 2, title: "השוואה, עמידות וסיכום", slide_from: 6, slide_to: 8, error: "timeout", status: "writing", markdown: "" },
];

// ── The mocks: one log for both servers, in the order requests arrive ──
type Logged = { seq: number; who: "rest" | "anthropic"; method: string; path: string; query: URLSearchParams; auth: string | null; body: string };
let log: Logged[] = [];
let seq = 0;
let hidden = false;
let sections: Row[] = baseSections();
let claimRows: object[] = [];
let jobFigures: Record<string, string> = {};
let partCorrections: unknown = [];
let recording: object | null = null;
let transcript: string | null = null;
let reserveAnswer: { status: number; body: unknown } = { status: 200, body: 41 };
let claimAnswer: { status: number; body: unknown } | null = null;
// Every section the code needs (§2.11): F and the merged packages' sections, W's included.
let schemaAnswer: { status: number; body: unknown } = { status: 200, body: { ...REQUIRED_SCHEMA } };
let anthropicMode: "ok" | "bad_request" | "drop" | "hang" | "notes" = "ok";
let REST = "";

// The bytes are joined before they are decoded, so a Hebrew letter split
// between two chunks stays whole and a request's hash never depends on chunking.
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
// Storage signs with a JWT whose payload carries its expiry.
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (expIn: number) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ url: "study/x", iat: 1, exp: Math.floor(Date.now() / 1000) + expIn })}.sig`;

const rest = createServer(async (req, res) => {
  const body = await readAll(req);
  const url = new URL(req.url ?? "/", "http://x");
  log.push({ seq: ++seq, who: "rest", method: req.method ?? "", path: url.pathname, query: url.searchParams, auth: req.headers.authorization ?? null, body });
  const p = url.pathname;
  if (p === "/auth/v1/user") return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated" });
  if (p === "/rest/v1/rpc/study_schema") return send(res, schemaAnswer.status, schemaAnswer.body);
  if (p === "/rest/v1/rpc/study_claim") return claimAnswer ? send(res, claimAnswer.status, claimAnswer.body) : send(res, 200, claimRows);
  if (p === "/rest/v1/rpc/study_writing_input")
    return send(res, 200, {
      lecture,
      sections: sections.map((s) => ({ ...s, corrections: [] })),
      figures: jobFigures,
      figures_until: null,
      recording,
      transcript: JSON.parse(body).p_with_transcript ? transcript : null,
    });
  if (p === "/rest/v1/rpc/study_part_corrections") return send(res, 200, partCorrections);
  if (p === "/rest/v1/rpc/study_reserve") return send(res, reserveAnswer.status, reserveAnswer.body);
  if (p === "/rest/v1/rpc/study_progress" || p === "/rest/v1/rpc/study_finish" || p === "/rest/v1/rpc/study_outline_done") return send(res, 200, true);
  if (p === "/rest/v1/study_lectures" && req.method === "GET") return send(res, 200, hidden && url.searchParams.get("deleted_at") === "is.null" ? [] : [lecture]);
  if (p === "/rest/v1/study_sections" && req.method === "GET") return send(res, 200, sections.map(({ idx, title, slide_from, slide_to }) => ({ idx, title, slide_from, slide_to })));
  if (p === "/storage/v1/object/sign/study") {
    const { paths, expiresIn } = JSON.parse(body) as { paths: string[]; expiresIn: number };
    return send(res, 200, paths.map((path) => ({ path, signedURL: `/object/sign/study/${path}?token=${jwt(expiresIn)}`, error: null })));
  }
  send(res, 404, { message: `unmocked ${req.method} ${p}` });
});

const usageStart = { input_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 9000, output_tokens: 1 };
const events = (text: string, final = true) => {
  const ev: object[] = [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: usageStart } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  ];
  for (let i = 0; i < text.length; i += 7) ev.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 7) } });
  if (final) {
    ev.push(
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 900 } },
      { type: "message_stop" },
    );
  }
  return ev.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
};
const PART_TEXT = "## תופעות לוואי\n\nבחילה וטעם מתכתי [ש' 3]. תגובה דמוית Disulfiram.";
const NOTES_DOC = JSON.stringify({ notes: [{ para: 1, at: "41:10", text: "בהרצאה הוסבר שהאנזים פעיל רק בתנאים אנאירוביים." }] });
const outlineParts = [
  { heading: "מבוא ומנגנון", from: 1, to: 4 },
  { heading: "המשך – השוואה", from: 5, to: 8 },
];

const anthropic = createServer(async (req, res) => {
  const raw = await readAll(req);
  // The mock's port changes from run to run: bodies are kept with REST in its place.
  log.push({ seq: ++seq, who: "anthropic", method: req.method ?? "", path: req.url ?? "", query: new URLSearchParams(), auth: null, body: raw.split(REST).join("REST") });
  const body = JSON.parse(raw) as { stream?: boolean };
  if (anthropicMode === "bad_request") return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "nope" } });
  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (anthropicMode === "drop") {
      res.write(events(PART_TEXT, false));
      setTimeout(() => res.destroy(), 20); // the connection breaks before the final usage
      return;
    }
    if (anthropicMode === "hang") return res.write(events(PART_TEXT, false)); // never finishes
    return res.end(events(anthropicMode === "notes" ? NOTES_DOC : PART_TEXT));
  }
  send(res, 200, {
    id: "msg_2",
    type: "message",
    role: "assistant",
    model: MODEL,
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [{ type: "text", text: JSON.stringify({ title: "הרצאה", parts: outlineParts }) }],
    usage: { input_tokens: 2500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
});

const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as AddressInfo).port)));
before(async () => {
  const [r, a] = await Promise.all([listen(rest), listen(anthropic)]);
  REST = `http://127.0.0.1:${r}`;
  delete process.env.VITE_STUDY_SUPABASE_URL;
  delete process.env.VITE_STUDY_SUPABASE_ANON_KEY;
  Object.assign(process.env, {
    VITE_SUPABASE_URL: REST,
    VITE_SUPABASE_ANON_KEY: "anon-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${a}`,
    ANTHROPIC_API_KEY: "test-key",
    STUDY_WORKER_KEY: KEY,
    STUDY_MONTHLY_USD: "33",
  });
});
after(() => {
  for (const s of [rest, anthropic]) {
    s.closeAllConnections();
    s.close();
  }
});
beforeEach(() => {
  log = [];
  hidden = false;
  sections = baseSections();
  claimRows = [];
  claimAnswer = null;
  jobFigures = {};
  partCorrections = [];
  recording = null;
  transcript = null;
  reserveAnswer = { status: 200, body: 41 };
  schemaAnswer = { status: 200, body: { ...REQUIRED_SCHEMA } };
  anthropicMode = "ok";
  writerTiming.deviceMs = 270_000;
  process.env.STUDY_WORKER_KEY = KEY;
});

// A member's token: only its payload is read (Supabase Auth, mocked here, verifies it).
const tokenFor = (secondsLeft: number) => `${b64({ alg: "HS256" })}.${b64({ sub: USER, exp: Math.floor(Date.now() / 1000) + secondsLeft })}.sig`;
const TOKEN = tokenFor(3600);
const post = (fn: { fetch: (r: Request) => Promise<Response> }, path: string, body: unknown, token = TOKEN) =>
  fn.fetch(
    new Request(`http://localhost/api/study/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const rpcs = (name: string) => log.filter((l) => l.who === "rest" && l.path === `/rest/v1/rpc/${name}`);
const modelCalls = () => log.filter((l) => l.who === "anthropic");
const args = (l: Logged) => JSON.parse(l.body) as Record<string, any>;
/** study_claim's answer for a part, at the effort the database gives (medium after a timeout). */
const claimPart = (idx: number) => (claimRows = [{ kind: "part", idx, lease: LEASE, effort: sections[idx]?.error === "timeout" ? "medium" : "high" }]);
const claimOutline = () => (claimRows = [{ kind: "outline", idx: null, lease: LEASE, effort: "low" }]);

/* ── The requests these functions sent before F0 ──
 * SHA-256 of each request body that bc01207's own api/study/section.ts and
 * outline.ts sent through F's mocks of this file (the mock's port written as
 * REST), and of the deck block alone. They were computed once by running
 * that commit's code. F's mock signed pictures with "?token=t-<length of the
 * path>"; this mock signs with real-shaped tokens (W checks every link's
 * expiry), so the sent body is compared with each picture's token written
 * back as F's mock wrote it: everything else must be the same bytes. */
const BEFORE_F0 = {
  part1: "54ec57e60e981d2602823f448d8aaef192be86fdd72c019ea3320a7188c05eca",
  part2: "7cdd5ef4767b8a7a74af985efb8991c76e50ac7f1ee6aff3fe272953c476a2b1",
  outline: "e28f173afe91150a439a0da0170f757f3f58123e34d1be28b54ec7af64e4fef2",
  deck: "279e901defa4fb73c3299588902fdcd6685ca28a38e112839b2f852d65d15427",
};
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const asF0Mock = (body: string) => body.replace(/(\/storage\/v1\/object\/sign\/study\/([^"?]+))\?token=[A-Za-z0-9._-]+/g, (_m, head: string, path: string) => `${head}?token=t-${path.length}`);

// ── The cases ──
test("a database older than the code (no section W) answers 503 schema, before any claim or spend", async () => {
  // Release 1's registry: every section but W.
  schemaAnswer = { status: 200, body: { F: 1, Q: 1, C: 1, K: 1 } };
  const res = await post(section, "section", { lectureId: LECTURE, idx: 1 });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "schema" });
  assert.equal(rpcs("study_claim").length, 0);
  assert.equal(rpcs("study_reserve").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("a part: claimed with the member's token and the key, reserved before the model, settled by study_finish", async () => {
  claimPart(1);
  const res = await post(section, "section", { lectureId: LECTURE, idx: 1 });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), `​${PART_TEXT}`);
  const [claim] = rpcs("study_claim");
  assert.deepEqual(args(claim), { p_lecture: LECTURE, p_kind: "part", p_idx: 1, p_key: KEY });
  assert.equal(claim.auth, `Bearer ${TOKEN}`, "the member's token: the database checks she belongs to the group");
  const [corr] = rpcs("study_part_corrections");
  assert.deepEqual(args(corr), { p_lecture: LECTURE, p_part: 1 });
  assert.ok(corr.seq > claim.seq, "corrections are read after the claim (the new generation)");
  const [reserve] = rpcs("study_reserve");
  const [call] = modelCalls();
  const [fin] = rpcs("study_finish");
  assert.equal(rpcs("study_reserve").length, 1);
  assert.equal(modelCalls().length, 1);
  assert.ok(claim.seq < reserve.seq && reserve.seq < call.seq && call.seq < fin.seq, "claim, reserve, the model, then finish");
  const r = args(reserve);
  assert.deepEqual([r.p_key, r.p_kind, r.p_ref, r.p_group, r.p_lecture, r.p_cap, r.p_share], [KEY, "part", "1", GROUP, LECTURE, 33, 1]);
  assert.ok(r.p_estimate > 0.96, "max_tokens alone is $0.96 at the summary model's output rate");
  assert.equal(reserve.auth, `Bearer ${TOKEN}`, "the row names its member");
  const f = args(fin);
  assert.deepEqual([f.p_kind, f.p_idx, f.p_lease, f.p_status, f.p_error, f.p_text, f.p_charge, f.p_key], ["part", 1, LEASE, "ready", null, PART_TEXT, 41, KEY]);
  assert.deepEqual(f.p_usage, { ...usageStart, output_tokens: 900 });
  assert.ok(Math.abs(f.p_cost - costUsd({ ...usageStart, output_tokens: 900 }, MODEL)) < 1e-12);
  assert.ok(f.p_cost <= r.p_estimate, "the real cost is within the reservation");
  assert.equal(rpcs("study_settle").length, 0, "p_charge settles it");
  assert.equal(log.filter((l) => l.method === "PATCH" || l.method === "DELETE").length, 0, "no direct writes to the tables any more");
  // A hidden lecture is never loaded.
  const read = log.find((l) => l.path === "/rest/v1/study_lectures");
  assert.equal(read?.query.get("deleted_at"), "is.null");
});

test("the part's request is byte-identical to today's (bc01207), deck block included; medium after a timeout", async () => {
  for (const idx of [1, 2] as const) {
    log = [];
    claimPart(idx);
    await (await post(section, "section", { lectureId: LECTURE, idx })).text();
    const sent = modelCalls()[0].body;
    const body = JSON.parse(sent);
    const deck = body.messages[0].content[0];
    assert.ok(deck.text.startsWith(`The full lecture (lecturer: ${lecture.lecturer}), for context:\n\n[שקף 1] מבוא: Examplomycin\n`));
    assert.equal(sha256(deck.text), BEFORE_F0.deck, `part ${idx}: the deck block differs from bc01207's`);
    assert.deepEqual(deck.cache_control, { type: "ephemeral" });
    assert.equal(body.output_config.effort, idx === 2 ? "medium" : "high", "medium after a timeout, as today");
    assert.equal(sha256(asF0Mock(sent)), BEFORE_F0[`part${idx}`], `part ${idx}: the request differs from bc01207's (its sha256 is now ${sha256(asF0Mock(sent))})`);
    if (idx === 1) {
      // Part 1 sends two pictures (the thumbnail is left out), each signed here for 30 minutes.
      const [sign] = log.filter((l) => l.path === "/storage/v1/object/sign/study");
      assert.deepEqual(JSON.parse(sign.body), { expiresIn: 1800, paths: [`${GROUP}/${LECTURE}/s3-2.jpg`, `${GROUP}/${LECTURE}/s5-1.jpg`] });
      assert.equal(body.messages[0].content.filter((b: { type: string }) => b.type === "image").length, 2);
    }
  }
});

test("pictures the server signed when the lecture was queued are used as they are; only the missing are signed here", async () => {
  claimPart(1);
  const path = `${GROUP}/${LECTURE}/s3-2.jpg`;
  const queued = `${REST}/storage/v1/object/sign/study/${path}?token=${jwt(40 * 3600)}`;
  jobFigures = { [path]: queued };
  await (await post(section, "section", { lectureId: LECTURE, idx: 1 })).text();
  const [sign] = log.filter((l) => l.path === "/storage/v1/object/sign/study");
  assert.deepEqual(JSON.parse(sign.body).paths, [`${GROUP}/${LECTURE}/s5-1.jpg`]);
  const urls = JSON.parse(modelCalls()[0].body).messages[0].content.filter((b: { type: string }) => b.type === "image").map((b: { source: { url: string } }) => b.source.url);
  assert.equal(urls[0], queued.split(REST).join("REST"));
  assert.equal(urls.length, 2);
});

test("a part another writer holds: 409 busy, nothing reserved, no model call", async () => {
  claimRows = [];
  const res = await post(section, "section", { lectureId: LECTURE, idx: 1 });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "busy" });
  assert.equal(rpcs("study_claim").length, 1);
  assert.deepEqual([rpcs("study_reserve").length, modelCalls().length, rpcs("study_finish").length], [0, 0, 0]);
});

test('kind "notes": the part\'s notes are claimed as notes, written from the transcript and saved checked', async () => {
  claimRows = [{ kind: "notes", idx: 0, lease: LEASE, effort: "medium" }];
  sections = baseSections().map((s) => ({ ...s, status: "ready" }));
  recording = { has_times: true, duration_s: 3000, status: "ready" };
  transcript = "[41:10] האנזים פעיל רק בלי חמצן";
  anthropicMode = "notes";
  const res = await post(section, "section", { lectureId: LECTURE, idx: 0, kind: "notes" });
  assert.equal(res.status, 200);
  await res.text();
  assert.deepEqual(args(rpcs("study_claim")[0]), { p_lecture: LECTURE, p_kind: "notes", p_idx: 0, p_key: KEY });
  assert.equal(args(rpcs("study_writing_input")[0]).p_with_transcript, true);
  const body = JSON.parse(modelCalls()[0].body);
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(args(rpcs("study_reserve")[0]).p_kind, "notes");
  const f = args(rpcs("study_finish")[0]);
  assert.deepEqual([f.p_kind, f.p_idx, f.p_status, f.p_charge], ["notes", 0, "ready", 41]);
  assert.deepEqual(f.p_items, [{ anchor: 1, quote: "התרופה מעכבת את Examplase [ש' 1].", at_s: 2470, text: "בהרצאה הוסבר שהאנזים פעיל רק בתנאים אנאירוביים." }]);
  assert.equal((await post(section, "section", { lectureId: LECTURE, idx: 0, kind: "summary" })).status, 400, "only part and notes");
});

test("a part still running at the time limit: saved as failed timeout, and the stream ends with \\u0000ERROR timeout", async () => {
  claimPart(1);
  writerTiming.deviceMs = 1; // the model is stopped as soon as it may be (5 s)
  anthropicMode = "hang";
  const res = await post(section, "section", { lectureId: LECTURE, idx: 1 });
  const text = await res.text();
  assert.ok(text.startsWith(`​${PART_TEXT}`), "what streamed reached the phone");
  assert.ok(text.endsWith("\n\u0000ERROR timeout"), JSON.stringify(text.slice(-30)));
  const f = args(rpcs("study_finish")[0]);
  assert.deepEqual([f.p_status, f.p_error, f.p_charge], ["failed", "timeout", 41]);
  assert.equal(f.p_text, PART_TEXT, "the text so far is kept");
  assert.equal(f.p_usage.estimated, true);
});

test("a rewrite of a corrected part: the request's last block is correctionsForRewrite(), and everything before it is unchanged", async () => {
  claimPart(1);
  await (await post(section, "section", { lectureId: LECTURE, idx: 1 })).text();
  const plain = JSON.parse(asF0Mock(modelCalls()[0].body));
  log = [];
  const c = [{ before: "בחילה, טעם מתכתי", after: "בחילה וטעם מתכתי", note: "כך נאמר בהרצאה" }];
  partCorrections = c;
  claimPart(1);
  await (await post(section, "section", { lectureId: LECTURE, idx: 1 })).text();
  const fixed = JSON.parse(asF0Mock(modelCalls()[0].body));
  const content = fixed.messages[0].content;
  assert.deepEqual(content.at(-1), { type: "text", text: correctionsForRewrite(c) });
  assert.deepEqual({ ...fixed, messages: [{ ...fixed.messages[0], content: content.slice(0, -1) }] }, plain, "everything before it is the same");
  assert.ok(args(rpcs("study_reserve")[0]).p_estimate > 0);
});

test("the outline: claimed, reserved before messages.parse, saved through study_outline_done with its charge; its request is today's", async () => {
  claimOutline();
  const res = await post(outline, "outline", { lectureId: LECTURE });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse((await res.text()).replace(/^​/, "")), {
    parts: [
      { heading: "מבוא ומנגנון", from: 1, to: 4 },
      { heading: "המשך: השוואה", from: 5, to: 8 },
    ],
  });
  const [claim] = rpcs("study_claim");
  assert.deepEqual(args(claim), { p_lecture: LECTURE, p_kind: "outline", p_idx: null, p_key: KEY });
  const [reserve] = rpcs("study_reserve");
  const [call] = modelCalls();
  const [done] = rpcs("study_outline_done");
  assert.ok(claim.seq < reserve.seq && reserve.seq < call.seq && call.seq < done.seq);
  const r = args(reserve);
  assert.deepEqual([r.p_kind, r.p_ref, r.p_key], ["outline", null, KEY]);
  const d = args(done);
  assert.deepEqual([d.p_lease, d.p_charge, d.p_error, d.p_key], [LEASE, 41, null, KEY]);
  assert.deepEqual(d.p_parts, [
    { heading: "מבוא ומנגנון", from: 1, to: 4 },
    { heading: "המשך: השוואה", from: 5, to: 8 },
  ]);
  assert.ok(Math.abs(d.p_cost - (2500 * 4 + 300 * 20) / 1e6) < 1e-12);
  assert.equal(sha256(call.body), BEFORE_F0.outline, `the outline's request differs from bc01207's (its sha256 is now ${sha256(call.body)})`);
});

test("a thrown parse leaves the outline's reservation unsettled (p_charge null), and fixed chunks still come back", async () => {
  claimOutline();
  anthropicMode = "bad_request";
  const res = await post(outline, "outline", { lectureId: LECTURE });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse((await res.text()).replace(/^​/, "")), {
    parts: [
      { heading: "מבוא: Examplomycin", from: 1, to: 6 },
      { heading: "עמידות", from: 7, to: 8 },
    ],
  });
  assert.ok(rpcs("study_reserve")[0].seq < modelCalls()[0].seq, "reserved before messages.parse");
  const d = args(rpcs("study_outline_done")[0]);
  assert.deepEqual([d.p_charge, d.p_cost], [null, 0], "the estimate stays");
});

test("an outline nobody can claim: the parts that exist (an old phone carries on), else 409 busy", async () => {
  claimRows = [];
  const res = await post(outline, "outline", { lectureId: LECTURE });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse((await res.text()).replace(/^​/, "")).parts, [
    { heading: "מבוא ומנגנון", from: 1, to: 2 },
    { heading: "תופעות לוואי והתוויות", from: 3, to: 5 },
    { heading: "השוואה, עמידות וסיכום", from: 6, to: 8 },
  ]);
  sections = [];
  const busy = await post(outline, "outline", { lectureId: LECTURE });
  assert.equal(busy.status, 409);
  assert.deepEqual(await busy.json(), { error: "busy" });
  assert.equal(rpcs("study_reserve").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("at the cap: 402 budget before the stream, no model call, and the claimed unit ends as budget", async () => {
  reserveAnswer = pgError("budget");
  for (const [fn, path, body, claim] of [
    [section, "section", { lectureId: LECTURE, idx: 1 }, () => claimPart(1)],
    [outline, "outline", { lectureId: LECTURE }, claimOutline],
  ] as const) {
    claim();
    const res = await post(fn, path, body);
    assert.equal(res.status, 402, path);
    assert.deepEqual(await res.json(), { error: "budget" });
  }
  assert.equal(modelCalls().length, 0);
  const f = args(rpcs("study_finish")[0]);
  assert.deepEqual([f.p_status, f.p_error, f.p_charge, f.p_cost], ["failed", "budget", null, 0]);
  const d = args(rpcs("study_outline_done")[0]);
  assert.deepEqual([d.p_parts, d.p_error, d.p_charge], [null, "budget", null]);
});

test("the server key missing from Vault: 403 forbidden at the claim; missing on Vercel: 500, before any RPC", async () => {
  claimAnswer = pgError("forbidden");
  const res = await post(section, "section", { lectureId: LECTURE, idx: 1 });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "forbidden" });
  log = [];
  delete process.env.STUDY_WORKER_KEY;
  const res2 = await post(section, "section", { lectureId: LECTURE, idx: 1 });
  assert.equal(res2.status, 500);
  assert.deepEqual(await res2.json(), { error: "missing STUDY_WORKER_KEY" });
  assert.equal(rpcs("study_claim").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("a token with under 300 s left: 401 session expiring, nothing claimed", async () => {
  claimPart(1);
  for (const [fn, path, body] of [
    [section, "section", { lectureId: LECTURE, idx: 1 }],
    [outline, "outline", { lectureId: LECTURE }],
  ] as const) {
    const res = await post(fn, path, body, tokenFor(240));
    assert.equal(res.status, 401, path);
    assert.deepEqual(await res.json(), { error: "session expiring" });
  }
  assert.equal(rpcs("study_claim").length, 0);
  assert.equal(modelCalls().length, 0);
  // Over five minutes left is enough.
  assert.equal((await post(section, "section", { lectureId: LECTURE, idx: 1 }, tokenFor(330))).status, 200);
});

test("a hidden lecture: 404 lecture not found, nothing claimed", async () => {
  hidden = true;
  claimPart(1);
  const res = await post(section, "section", { lectureId: LECTURE, idx: 1 });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "lecture not found" });
  assert.equal(rpcs("study_claim").length, 0);
});

test("a stream cut before its final usage: the finish records its floor, marked estimated, and the stream ends with the error", async () => {
  claimPart(1);
  anthropicMode = "drop";
  const res = await post(section, "section", { lectureId: LECTURE, idx: 1 });
  const text = await res.text();
  assert.ok(text.startsWith(`​${PART_TEXT}`), "what arrived was streamed");
  assert.ok(text.includes("\u0000ERROR"), "and the failure follows it");
  const f = args(rpcs("study_finish")[0]);
  assert.equal(f.p_status, "failed");
  assert.equal(f.p_usage.estimated, true);
  assert.equal(f.p_usage.output_tokens, Math.ceil(PART_TEXT.length / 2), "characters ÷ 2");
  assert.ok(Math.abs(f.p_cost - costUsd(f.p_usage, MODEL)) < 1e-12);
  assert.equal(f.p_charge, 41);
});
