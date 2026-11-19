import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import work from "../../api/study/work.js";
import { costUsd } from "./budget.js";
import { POINTS_SYSTEM } from "./prompts/points.js";
import { MODEL, REQUIRED_SCHEMA, type Lecture } from "./study.js";
import { figureOk, writerTiming } from "./writer.js";

/* W-2 (spec §7.W): api/study/work.ts in Node, bundled with esbuild, the
 * request context of @vercel/functions stubbed (waitUntil collects the
 * unit's promise, deadline = now + D), against a local mock of PostgREST and
 * a local Anthropic serving recorded event streams. design-platform §6.2's
 * thirteen cases, then the review's: a picture link from another host or
 * with an expired token, every RPC with p_key, one reservation per unit
 * settled through p_charge, a thrown RPC leaving the unit to its lease, an
 * older database. Last, a local loop: the real SQL in a throwaway local
 * Postgres (run as postgres, like §3.6), a small PostgREST over psql, and
 * the kicks pg_net would send (net.calls) replayed into work.ts until a
 * three-part lecture is written to the end (review FE-7). No network, no key. */

const KEY = "k-0123456789abcdef0123456789abcdef";
const LECTURE = "11111111-0000-4000-8000-000000000001";
const GROUP = "22222222-0000-4000-8000-000000000002";
const LEASE = "44444444-0000-4000-8000-000000000004";
const ROOT = join(process.cwd());

/* ── The request context @vercel/functions reads (§8.3) ── */
let pending: Promise<unknown>[] = [];
let deadlineIn = 300_000;
(globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] = {
  get: () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p), deadline: Date.now() + deadlineIn }),
};
const settle = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

/* ── A lecture made for the tests (Hebrew with English terms, pictures) ── */
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (expIn: number) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ url: "study/x", iat: 1, exp: Math.floor(Date.now() / 1000) + expIn })}.sig`;
const lecture = (): Lecture => ({
  id: LECTURE,
  group_id: GROUP,
  course: "קורס לדוגמה",
  title: "הרצאה לדוגמה",
  lecturer: "ד״ר דוגמה",
  lecture_date: null,
  source_kind: "pptx",
  slides: Array.from({ length: 8 }, (_, i) => ({
    n: i + 1,
    title: i === 0 ? "מבוא: Examplomycin" : `נושא ${i + 1}`,
    lines: [i === 0 ? "מבוא: Examplomycin" : `נושא ${i + 1}`, `תוכן של שקף ${i + 1} עם Examplase`],
    tables: [],
    notes: "",
    figures: i === 1 ? [{ k: 1, path: `${GROUP}/${LECTURE}/s2-1.jpg`, w: 1200, h: 800 }] : [],
  })),
});
const sections = () => [
  { idx: 0, title: "מבוא ומנגנון", slide_from: 1, slide_to: 2, status: "writing", error: null, markdown: "", corrections: [] },
  { idx: 1, title: "תופעות לוואי", slide_from: 3, slide_to: 5, status: "pending", error: null, markdown: "", corrections: [] },
  { idx: 2, title: "השוואה וסיכום", slide_from: 6, slide_to: 8, status: "pending", error: null, markdown: "", corrections: [] },
];

/* ── PostgREST, scripted ── */
type Logged = { seq: number; who: "rest" | "anthropic"; path: string; body: any; raw: string; at: number };
let log: Logged[] = [];
let seq = 0;
let REST = "";
// Every section the code needs (§2.11): F and the merged packages' sections, W's included.
let schemaBody: unknown = { ...REQUIRED_SCHEMA };
let claimRows: object[] = [];
let input: any = null;
let reserveAnswer: { status: number; body: unknown } = { status: 200, body: 41 };
let progressAnswer = true;
let finishStatus = 200;
let inputStatus = 200;

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
  const raw = await readAll(req);
  const path = new URL(req.url ?? "/", "http://x").pathname;
  log.push({ seq: ++seq, who: "rest", path, body: raw ? JSON.parse(raw) : null, raw, at: Date.now() });
  switch (path) {
    case "/rest/v1/rpc/study_schema":
      return send(res, 200, schemaBody);
    case "/rest/v1/rpc/study_claim":
      return send(res, 200, claimRows);
    case "/rest/v1/rpc/study_writing_input":
      return inputStatus === 200 ? send(res, 200, input) : send(res, inputStatus, { code: "XX000", message: "boom" });
    case "/rest/v1/rpc/study_reserve":
      return send(res, reserveAnswer.status, reserveAnswer.body);
    case "/rest/v1/rpc/study_progress":
      return send(res, 200, progressAnswer);
    case "/rest/v1/rpc/study_finish":
    case "/rest/v1/rpc/study_outline_done":
      return finishStatus === 200 ? send(res, 200, true) : send(res, finishStatus, { code: "XX000", message: "boom" });
  }
  send(res, 404, { message: `unmocked ${req.method} ${path}` });
});

/* ── Anthropic, replaying event streams ── */
type Mode = "part" | "slow" | "hang" | "429" | "fallback" | "notes" | "outline";
let mode: Mode = "part";
let ANTHROPIC = "";
const PART_TEXT = "## תופעות לוואי\n\nבחילה וטעם מתכתי [ש' 3]. תגובה דמוית Disulfiram. ";
const usageStart = { input_tokens: 1200, cache_creation_input_tokens: 15000, cache_read_input_tokens: 0, output_tokens: 1 };
const ev = (e: { type: string }) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const startEv = (model = MODEL) => ev({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: usageStart } } as never);
const textEvs = (index: number, text: string, size = 9) => {
  const out = [ev({ type: "content_block_start", index, content_block: { type: "text", text: "" } } as never)];
  for (let i = 0; i < text.length; i += size) out.push(ev({ type: "content_block_delta", index, delta: { type: "text_delta", text: text.slice(i, i + size) } } as never));
  out.push(ev({ type: "content_block_stop", index } as never));
  return out;
};
const endEvs = (stop: string, usage: object) => [
  ev({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, stop_details: null }, usage } as never),
  ev({ type: "message_stop" }),
];
const NOTES_DOC = JSON.stringify({
  notes: [
    { para: 1, at: "41:10", text: "בהרצאה הוסבר שהאנזים פעיל רק בתנאים אנאירוביים, ולכן התרופה לא פועלת בתאים אחרים." },
    { para: 99, at: "42:00", text: "הערה על פסקה שאין בחלק, שצריכה לרדת מהרשימה." },
    { para: 2, at: "1:59:59", text: "בהרצאה נאמר שזה יופיע במבחן, וזה הוזכר פעמיים בסוף השיעור." },
    { para: -1, at: "", text: "בהרצאה הודגש שהחלק הזה הוא הבסיס לשאר ההרצאה כולה." },
    { para: 1, at: "10:00", text: "שימו לב: זה חשוב." },
  ],
});
const OUTLINE_PARTS = [
  { heading: "מבוא ומנגנון", from: 1, to: 3 },
  { heading: "תופעות – לוואי", from: 4, to: 6 },
  { heading: "סיכום", from: 7, to: 8 },
];
const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** "slow": about 1.5 s of text in small pieces, so saves of the text so far happen while it streams. */
const SLOW_REPEAT = 12;
const anthropic = createServer(async (req, res) => {
  const raw = await readAll(req);
  const body = JSON.parse(raw) as { stream?: boolean };
  log.push({ seq: ++seq, who: "anthropic", path: req.url ?? "", body, raw, at: Date.now() });
  if (!body.stream) {
    return send(res, 200, {
      id: "msg_2",
      type: "message",
      role: "assistant",
      model: MODEL,
      stop_reason: "end_turn",
      stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify({ title: "הרצאה", parts: OUTLINE_PARTS }) }],
      usage: { input_tokens: 2500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
  }
  if (mode === "429") {
    res.writeHead(429, { "content-type": "application/json", "retry-after-ms": "5" });
    return res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }));
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  // Package B's read ahead (bank.ts) after the last part: the points to know, as JSON.
  if ((body as { system?: Array<{ text?: string }> }).system?.[0]?.text === POINTS_SYSTEM) {
    return res.end([startEv(), ...textEvs(0, JSON.stringify({ points: [] })), ...endEvs("end_turn", { output_tokens: 300 })].join(""));
  }
  if (mode === "hang") {
    res.write(startEv() + textEvs(0, PART_TEXT).slice(0, 3).join(""));
    return; // never finishes: the writer must stop itself (its abort closes the connection)
  }
  if (mode === "fallback") {
    const cut = 20;
    res.write(startEv() + textEvs(0, PART_TEXT.slice(0, cut)).join(""));
    res.write(ev({ type: "content_block_start", index: 1, content_block: { type: "fallback", from: { model: MODEL }, to: { model: "claude-sonnet-5-5" }, trigger: { type: "refusal", category: "bio" } } } as never));
    res.write(ev({ type: "content_block_stop", index: 1 } as never));
    const iterations = [
      { type: "message", model: MODEL, input_tokens: 1200, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 15000 },
      { type: "fallback_message", model: "claude-sonnet-5-5", input_tokens: 16600, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ];
    return res.end(textEvs(2, PART_TEXT.slice(cut)).join("") + endEvs("end_turn", { input_tokens: 16600, output_tokens: 900, iterations }).join(""));
  }
  const text = mode === "notes" ? NOTES_DOC : PART_TEXT.repeat(mode === "slow" ? SLOW_REPEAT : 3);
  const evs = [startEv(), ...textEvs(0, text, mode === "slow" ? 6 : 12)];
  for (const e of evs) {
    if (res.destroyed) return; // the writer stopped reading
    res.write(e);
    await pause(mode === "slow" ? 10 : 8);
  }
  res.end(endEvs("end_turn", { output_tokens: 900 }).join(""));
});

const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as AddressInfo).port)));
before(async () => {
  const [r, a] = await Promise.all([listen(rest), listen(anthropic)]);
  REST = `http://127.0.0.1:${r}`;
  ANTHROPIC = `http://127.0.0.1:${a}`;
  delete process.env.VITE_STUDY_SUPABASE_URL;
  delete process.env.VITE_STUDY_SUPABASE_ANON_KEY;
});
after(() => {
  for (const s of [rest, anthropic]) {
    s.closeAllConnections();
    s.close();
  }
});
const useScriptedRest = () =>
  Object.assign(process.env, {
    VITE_SUPABASE_URL: REST,
    VITE_SUPABASE_ANON_KEY: "anon-key",
    ANTHROPIC_BASE_URL: ANTHROPIC,
    ANTHROPIC_API_KEY: "test-key",
    STUDY_WORKER_KEY: KEY,
    STUDY_MONTHLY_USD: "33",
  });
beforeEach(() => {
  useScriptedRest();
  log = [];
  pending = [];
  deadlineIn = 300_000;
  schemaBody = { ...REQUIRED_SCHEMA };
  claimRows = [];
  input = { lecture: lecture(), sections: sections(), figures: {}, figures_until: null, recording: null, transcript: null };
  reserveAnswer = { status: 200, body: 41 };
  progressAnswer = true;
  finishStatus = 200;
  inputStatus = 200;
  mode = "part";
  writerTiming.progressMs = 15_000;
});

const kick = (lectureId: unknown = LECTURE, auth = `Bearer ${KEY}`) =>
  work.fetch(new Request("http://localhost/api/study/work", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ lectureId }) }));
const rpcs = (name: string) => log.filter((l) => l.who === "rest" && l.path === `/rest/v1/rpc/${name}`);
const modelCalls = () => log.filter((l) => l.who === "anthropic");
const signed = (path: string, expIn = 48 * 3600) => `${REST}/storage/v1/object/sign/study/${path}?token=${token(expIn)}`;
const claimPart = (idx: number, effort = "high") => (claimRows = [{ kind: "part", idx, lease: LEASE, effort }]);

// ── design-platform §6.2's cases ──
test("1. GET says whether the key is set and how long the invocation has", async () => {
  deadlineIn = 299_000;
  const res = await work.fetch(new Request("http://localhost/api/study/work"));
  const body = (await res.json()) as { worker: boolean; secondsLeft: number };
  assert.equal(res.status, 200);
  assert.equal(body.worker, true);
  assert.ok(Math.abs(body.secondsLeft - 299) <= 1, `secondsLeft ${body.secondsLeft}`);
  assert.ok(!JSON.stringify(body).includes(KEY.slice(2, 12)), "never the key itself");
});

test("2. a wrong key, no key on Vercel, or a short one: 401, and the database is never asked", async () => {
  assert.equal((await kick(LECTURE, `Bearer ${KEY}x`)).status, 401);
  assert.equal((await kick(LECTURE, `Bearer ${KEY.slice(0, -1)}X`)).status, 401);
  assert.equal((await kick(LECTURE, "")).status, 401);
  process.env.STUDY_WORKER_KEY = "";
  assert.equal((await kick(LECTURE, "Bearer ")).status, 401);
  process.env.STUDY_WORKER_KEY = "short";
  assert.equal((await kick(LECTURE, "Bearer short")).status, 401);
  assert.deepEqual(log, []);
});

test("a bad body answers 400 lectureId", async () => {
  for (const id of ["", "x", 7, null, `${LECTURE}x`]) assert.deepEqual([(await kick(id)).status], [400], String(id));
  assert.equal(rpcs("study_claim").length, 0);
});

test("a database older than the code (no section W, or W without W2's hardening): 503 schema, and nothing is claimed", async () => {
  // release 1's registry (every section but W), then release 2's (W1 without its hardening)
  for (const older of [{ F: 1, Q: 1, C: 1, K: 1 }, { ...REQUIRED_SCHEMA, W: 1 }]) {
    schemaBody = older;
    const res = await kick();
    assert.equal(res.status, 503, JSON.stringify(older));
    assert.deepEqual(await res.json(), { error: "schema" });
  }
  assert.equal(rpcs("study_claim").length, 0);
  schemaBody = { ...REQUIRED_SCHEMA }; // the check passes from now on, once per instance
});

test("3. nothing to claim (a duplicate kick): 200 {claimed:false}, with the key alone", async () => {
  const res = await kick();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { claimed: false });
  const [claim] = rpcs("study_claim");
  assert.deepEqual(claim.body, { p_lecture: LECTURE, p_kind: null, p_idx: null, p_key: KEY });
  assert.equal(pending.length, 0);
});

test("4. the outline: one messages.parse call at effort low, then study_outline_done with consecutive parts and its charge", async () => {
  claimRows = [{ kind: "outline", idx: null, lease: LEASE, effort: "low" }];
  const res = await kick();
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { claimed: true, kind: "outline", idx: null });
  await settle();
  const calls = modelCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.stream, undefined, "messages.parse, not a stream");
  assert.equal(calls[0].body.output_config.effort, "low");
  assert.equal(calls[0].body.output_config.format.type, "json_schema");
  const [r] = rpcs("study_reserve");
  assert.equal(r.body.p_kind, "outline");
  assert.equal(r.body.p_ref, null);
  assert.ok(r.seq < calls[0].seq, "reserved before the call");
  const [done] = rpcs("study_outline_done");
  assert.deepEqual(done.body.p_parts, [
    { heading: "מבוא ומנגנון", from: 1, to: 3 },
    { heading: "תופעות: לוואי", from: 4, to: 6 },
    { heading: "סיכום", from: 7, to: 8 },
  ]);
  assert.equal(done.body.p_charge, 41);
  assert.equal(done.body.p_lease, LEASE);
  assert.ok(Math.abs(done.body.p_cost - (2500 * 4 + 300 * 20) / 1e6) < 1e-12);
  assert.equal(done.body.p_key, KEY);
});

test("5. a part: cached system and deck, the fallback beta, effort high, progress while it grows, finish ready with its cost and charge", async () => {
  claimPart(1);
  writerTiming.progressMs = 60;
  mode = "slow";
  const res = await kick();
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { claimed: true, kind: "part", idx: 1 });
  await settle();
  const [call] = modelCalls();
  const b = call.body;
  assert.equal(b.model, MODEL);
  assert.equal(b.max_tokens, 48000);
  assert.equal(b.fallbacks, "default");
  assert.deepEqual(b.output_config, { effort: "high" });
  assert.deepEqual(b.system[0].cache_control, { type: "ephemeral" });
  assert.ok(b.system[0].text.startsWith("You write one part of a Hebrew study booklet"));
  const content = b.messages[0].content;
  assert.ok(content[0].text.startsWith(`The full lecture (lecturer: ${input.lecture.lecturer}), for context:`));
  assert.deepEqual(content[0].cache_control, { type: "ephemeral" });
  assert.ok(content[1].text.startsWith('Write part 2 of 3: "תופעות לוואי", covering slides 3-5.'));
  assert.equal(content.length, 2, "no pictures in slides 3-5, no corrections");
  const progress = rpcs("study_progress");
  assert.ok(progress.length >= 2, `progress saved ${progress.length} times`);
  for (const p of progress) assert.deepEqual([p.body.p_idx, p.body.p_lease, p.body.p_key], [1, LEASE, KEY]);
  const lens = progress.map((p) => p.body.p_text.length);
  assert.deepEqual(lens, [...lens].sort((x, y) => x - y), "the text only grows");
  const [r] = rpcs("study_reserve");
  assert.deepEqual([r.body.p_kind, r.body.p_ref, r.body.p_group, r.body.p_lecture, r.body.p_share, r.body.p_cap], ["part", "1", GROUP, LECTURE, 1, 33]);
  assert.ok(r.seq < call.seq, "reserved before the call");
  const [fin] = rpcs("study_finish");
  assert.equal(fin.body.p_status, "ready");
  assert.equal(fin.body.p_error, null);
  assert.equal(fin.body.p_kind, "part");
  assert.equal(fin.body.p_text, PART_TEXT.repeat(SLOW_REPEAT));
  assert.equal(fin.body.p_charge, 41, "the reservation is settled by the finish");
  assert.deepEqual(fin.body.p_usage, { ...usageStart, output_tokens: 900 });
  assert.ok(Math.abs(fin.body.p_cost - costUsd({ ...usageStart, output_tokens: 900 }, MODEL)) < 1e-12);
  assert.ok(fin.body.p_cost <= r.body.p_estimate, "within the reservation");
  assert.equal(rpcs("study_settle").length, 0, "no separate settle: p_charge does it");
});

test("6. a part that timed out before is written at medium effort", async () => {
  claimPart(2, "medium");
  await kick();
  await settle();
  assert.deepEqual(modelCalls()[0].body.output_config, { effort: "medium" });
});

test("7. a short deadline (30 s): the model is stopped 25 s before it, and the part fails timeout with what streamed counted", async () => {
  claimPart(1);
  deadlineIn = 30_000;
  mode = "hang";
  const t0 = Date.now();
  await kick();
  await settle();
  const took = Date.now() - t0;
  assert.ok(took >= 4_500 && took < 9_000, `stopped after ${took} ms (stopAt = deadline − 25 s)`);
  const [fin] = rpcs("study_finish");
  assert.equal(fin.body.p_status, "failed");
  assert.equal(fin.body.p_error, "timeout");
  assert.equal(fin.body.p_usage.estimated, true, "no final usage: the streamed text's floor");
  assert.ok(fin.body.p_cost > 0);
  assert.equal(fin.body.p_charge, 41);
});

test("8. a 429: the part fails rate_limited (the database retries it in 2^n minutes)", async () => {
  claimPart(1);
  mode = "429";
  await kick();
  await settle();
  const [fin] = rpcs("study_finish");
  assert.equal(fin.body.p_status, "failed");
  assert.equal(fin.body.p_error, "rate_limited");
  assert.equal(fin.body.p_charge, 41);
  assert.equal(fin.body.p_cost, 0, "a refused request is not billed");
});

test("9. progress answers false (another writer took the part): the stream stops, and the finish still records the cost", async () => {
  claimPart(1);
  writerTiming.progressMs = 40;
  progressAnswer = false;
  mode = "slow";
  const t0 = Date.now();
  await kick();
  await settle();
  assert.ok(Date.now() - t0 < 3_000, "stopped long before the whole stream");
  const [fin] = rpcs("study_finish");
  assert.equal(fin.body.p_error, "lease_lost");
  assert.equal(fin.body.p_charge, 41);
  assert.ok(fin.body.p_cost > 0, "what streamed is paid for");
  assert.equal(rpcs("study_progress").length, 1, "no save after the refusal");
});

test("10. the budget: study_reserve refuses, no Anthropic request, the part fails budget", async () => {
  claimPart(1);
  reserveAnswer = pgError("budget");
  await kick();
  await settle();
  assert.equal(modelCalls().length, 0);
  const [fin] = rpcs("study_finish");
  assert.deepEqual([fin.body.p_status, fin.body.p_error, fin.body.p_charge, fin.body.p_cost], ["failed", "budget", null, 0]);
});

test("11. picture links: expired, about to expire, from another host or for another path → figures_expired, no model call", async () => {
  const path = `${GROUP}/${LECTURE}/s2-1.jpg`;
  const bad = [
    signed(path, -60), // expired
    signed(path, 5 * 60), // under 10 minutes left
    signed(path).replace(REST, "https://attacker.example"), // another host
    signed(`${GROUP}/${LECTURE}/s9-9.jpg`), // signed for another path
    `${REST}/storage/v1/object/sign/study/${path}?token=not-a-token`,
  ];
  for (const url of bad) {
    log = [];
    claimPart(0);
    input.figures = { [path]: url };
    await kick();
    await settle();
    const [fin] = rpcs("study_finish");
    assert.deepEqual([fin?.body.p_status, fin?.body.p_error], ["failed", "figures_expired"], url);
    assert.equal(modelCalls().length, 0, url);
    assert.equal(rpcs("study_reserve").length, 0, "nothing reserved");
  }
  // A good link: the picture goes with the part, after its label.
  log = [];
  claimPart(0);
  const good = signed(path);
  input.figures = { [path]: good };
  await kick();
  await settle();
  const content = modelCalls()[0].body.messages[0].content;
  assert.deepEqual(content.slice(2), [
    { type: "text", text: "fig:2-1 (שקף 2)" },
    { type: "image", source: { type: "url", url: good } },
  ]);
  assert.ok(figureOk(good, path));
  assert.equal(figureOk(good, `${GROUP}/${LECTURE}/s2-2.jpg`), false, "another path");
});

test("12. notes: the plain JSON schema, the transcript cached, the paragraphs checked and the times read", async () => {
  claimRows = [{ kind: "notes", idx: 0, lease: LEASE, effort: "medium" }];
  input = {
    ...input,
    sections: sections().map((s, i) => ({ ...s, status: "ready", markdown: i === 0 ? "## מבוא ומנגנון\n\nהתרופה מעכבת את Examplase [ש' 1].\n\nפעילה רק בתנאים אנאירוביים [ש' 2]." : "## x\n\ny" })),
    recording: { has_times: true, duration_s: 3000, status: "ready" },
    transcript: "[00:01] שלום\n[41:10] האנזים פעיל רק בלי חמצן",
  };
  mode = "notes";
  await kick();
  await settle();
  assert.deepEqual(rpcs("study_writing_input")[0].body, { p_lecture: LECTURE, p_with_transcript: true, p_key: KEY });
  const b = modelCalls()[0].body;
  assert.equal(b.output_config.effort, "medium");
  assert.equal(b.output_config.format.type, "json_schema");
  assert.ok(!JSON.stringify(b.output_config.format.schema).includes("$schema"), "the plain schema");
  assert.equal(b.fallbacks, "default");
  assert.ok(b.system[0].text.startsWith("You add notes from a lecture's recording"));
  const [deck, transcript, request] = b.messages[0].content;
  assert.deepEqual([deck.cache_control, transcript.cache_control, request.cache_control], [{ type: "ephemeral" }, { type: "ephemeral" }, undefined]);
  assert.ok(transcript.text.startsWith("The lecture's transcript:\n\n[00:01]"));
  assert.ok(request.text.includes("¶0 מבוא ומנגנון\n¶1 התרופה מעכבת את Examplase [ש' 1].\n¶2 פעילה"));
  const [r] = rpcs("study_reserve");
  assert.deepEqual([r.body.p_kind, r.body.p_ref, r.body.p_share], ["notes", "0", 0.8]);
  const [fin] = rpcs("study_finish");
  assert.equal(fin.body.p_kind, "notes");
  assert.equal(fin.body.p_status, "ready");
  assert.deepEqual(fin.body.p_items, [
    { anchor: 1, quote: "התרופה מעכבת את Examplase [ש' 1].", at_s: 2470, text: "בהרצאה הוסבר שהאנזים פעיל רק בתנאים אנאירוביים, ולכן התרופה לא פועלת בתאים אחרים." },
    { anchor: 2, quote: "פעילה רק בתנאים אנאירוביים [ש' 2].", at_s: null, text: "בהרצאה נאמר שזה יופיע במבחן, וזה הוזכר פעמיים בסוף השיעור." },
    { anchor: -1, quote: "", at_s: null, text: "בהרצאה הודגש שהחלק הזה הוא הבסיס לשאר ההרצאה כולה." },
  ], "¶99 dropped; 1:59:59 is past the recording's end; an imperative dropped");
  assert.equal(fin.body.p_charge, 41);
});

test("13. a fallback mid-part: the cost sums every model's iteration, and the finish names the model that answered", async () => {
  claimPart(1);
  mode = "fallback";
  await kick();
  await settle();
  const [fin] = rpcs("study_finish");
  assert.equal(fin.body.p_status, "ready");
  assert.equal(fin.body.p_text, PART_TEXT, "both models' text, in order");
  assert.equal(fin.body.p_model, "claude-sonnet-5-5");
  const expect = (1200 * 4 + 400 * 20 + 15000 * 5) / 1e6 + (16600 * 2 + 900 * 10) / 1e6;
  assert.ok(Math.abs(fin.body.p_cost - expect) < 1e-9, `${fin.body.p_cost} vs ${expect}`);
  assert.ok(Math.abs(fin.body.p_cost - costUsd(fin.body.p_usage, "claude-sonnet-5-5")) < 1e-12);
});

// ── the review's additions ──
test("every RPC the worker sends carries the server key, and it never goes to Anthropic", async () => {
  claimPart(1);
  writerTiming.progressMs = 60;
  mode = "slow";
  await kick();
  await settle();
  const rpcCalls = log.filter((l) => l.who === "rest" && l.path !== "/rest/v1/rpc/study_schema");
  assert.ok(rpcCalls.length >= 5);
  for (const c of rpcCalls) assert.equal(c.body?.p_key, KEY, c.path);
  for (const c of modelCalls()) assert.ok(!c.raw.includes(KEY), "the key stays out of the model call");
});

test("a key pasted on Vercel with a line break after it: pg_net's kick, with Vault's value, writes the part, and every RPC carries the key itself", async () => {
  // pg_net sends "Bearer <Vault's study_worker_key>", which has no line break.
  process.env.STUDY_WORKER_KEY = `${KEY}\n`;
  const get = (await (await work.fetch(new Request("http://localhost/api/study/work"))).json()) as { worker: boolean };
  assert.equal(get.worker, true);
  claimPart(1);
  const res = await kick();
  assert.equal(res.status, 202);
  await settle();
  const rpcCalls = log.filter((l) => l.who === "rest" && l.path !== "/rest/v1/rpc/study_schema");
  assert.ok(rpcs("study_finish").length === 1 && rpcCalls.length >= 4, rpcCalls.map((c) => c.path).join(" "));
  for (const c of rpcCalls) assert.equal(c.body?.p_key, KEY, c.path);
  // Only spaces and line breaks: no key at all, and nothing is asked.
  process.env.STUDY_WORKER_KEY = " \n";
  log = [];
  assert.equal((await kick(LECTURE, "Bearer ")).status, 401);
  assert.deepEqual(log, []);
});

test("a thrown RPC leaves the unit to its lease: the writer stops quietly, nothing is called twice", async () => {
  claimPart(1);
  finishStatus = 500;
  await kick();
  await settle(); // resolves: no throw escapes waitUntil
  assert.equal(rpcs("study_finish").length, 1);
  assert.equal(rpcs("study_claim").length, 1);
  // The input itself failing: no reservation, no model call, no finish.
  log = [];
  finishStatus = 200;
  inputStatus = 500;
  claimPart(2);
  await kick();
  await settle();
  assert.deepEqual([rpcs("study_reserve").length, modelCalls().length, rpcs("study_finish").length], [0, 0, 0]);
});

test("a rewrite of a corrected part: the corrections are the request's last block, the rest is unchanged", async () => {
  claimPart(1);
  await kick();
  await settle();
  const plain = modelCalls()[0].body.messages[0].content;
  log = [];
  input.sections[1].corrections = [{ before: "בחילה", after: "בחילה והקאה", note: "לפי ההרצאה" }];
  claimPart(1);
  await kick();
  await settle();
  const fixed = modelCalls()[0].body.messages[0].content;
  assert.equal(fixed.length, plain.length + 1);
  assert.deepEqual(fixed.slice(0, -1), plain);
  assert.equal(
    fixed.at(-1).text,
    "The study group corrected the previous version of this part. Students made each correction after checking the lecture. Keep what each correction says in your new version wherever the slides support it. If a correction contradicts the slides, follow the slides and add a one-line \"> **שימו לב:**\" that gives both.\n1. Before: «בחילה»\n   After: «בחילה והקאה»\n   The student's note: «לפי ההרצאה»",
  );
});

/* ── The local loop (review FE-7): the real SQL, kicks replayed from net.calls ──
 * Needs the local Postgres of §3.6 (run as postgres). A database
 * w_work_loop_<pid> is made for it and dropped at the end. */
const PG_DB = `w_work_loop_${process.pid}`;
const sh = (cmd: string, stdin = "") =>
  new Promise<{ code: number; out: string; err: string }>((ok) => {
    const child = execFile("su", ["postgres", "-c", cmd], { maxBuffer: 64 << 20 }, (error, out, err) =>
      ok({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, out: String(out), err: String(err) }),
    );
    child.stdin?.end(stdin);
  });
const psql = (sql: string) => sh(`psql -X -q -tA -v ON_ERROR_STOP=1 -d ${PG_DB} -f -`, sql);
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
};
async function pgAvailable(): Promise<boolean> {
  const r = await sh("psql -X -tAc 'select 1'");
  return r.code === 0 && r.out.trim() === "1";
}

/** A PostgREST for RPCs only, over psql: anon (the worker) when no member's
 *  claims are known, as Supabase runs the anon key without a session. */
function pgRest(retset: Map<string, boolean>, calls: string[], errors: string[]) {
  return createServer(async (req, res) => {
    const raw = await readAll(req);
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const m = /^\/rest\/v1\/rpc\/(study_[a-z_]+)$/.exec(path);
    if (!m || !retset.has(m[1])) return send(res, 404, { message: `unmocked ${path}` });
    const fn = m[1];
    calls.push(fn);
    const args = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
    const sql = retset.get(fn)
      ? `set role anon;\nselect coalesce(json_agg(r), '[]'::json) from public.${fn}(${named}) r;\n`
      : `set role anon;\nselect to_json(public.${fn}(${named}));\n`;
    const r = await psql(sql);
    if (r.code !== 0) {
      const message = /ERROR:\s+(.*)/.exec(r.err)?.[1]?.trim() ?? "error";
      errors.push(`${fn}: ${message}`);
      return send(res, 400, { code: "P0001", details: null, hint: null, message });
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(r.out.trim() || "null");
  });
}

test("the local loop: kicks replayed from net.calls into work.ts write a three-part lecture to the end, on the real SQL", async (t) => {
  if (!(await pgAvailable())) {
    t.skip("no local Postgres (spec §3.6): run as root with postgresql started");
    return;
  }
  await sh(`dropdb --if-exists ${PG_DB}; createdb ${PG_DB}`);
  const calls: string[] = [];
  const errors: string[] = [];
  let server: Server | null = null;
  try {
    const files = ["supabase/tests/stubs.sql", "supabase/tests/board-schema.sql", "supabase/study-schema.sql"].map((f) => readFileSync(join(ROOT, f), "utf8"));
    const load = await psql(files.join("\n"));
    assert.equal(load.code, 0, load.err.split("\n").filter((l) => l.includes("ERROR")).join("\n"));
    // The group, a member and an eight-slide lecture with no pictures (the mock's
    // outline splits it in three); the two Vault secrets.
    const L = "f9000000-0000-4000-8000-000000000009";
    const slides = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, title: `שקף ${i + 1}`, lines: [`שקף ${i + 1}`, `Examplomycin ${i + 1}`], tables: [], notes: "", figures: [] }));
    const setup = await psql(`
      insert into auth.users (id, raw_user_meta_data) values ('bbbbbbbb-0000-4000-8000-000000000002', '{"app":"study","full_name":"שוהם"}');
      set role authenticated;
      set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
      select id from public.study_create_group('קבוצה', 'שוהם') \\gset
      insert into public.study_lectures (id, group_id, title, source_kind, slides) values ('${L}', :'id', 'לולאה', 'pptx', ${lit(slides)});
      reset role;
      insert into vault.decrypted_secrets (name, decrypted_secret) values ('study_worker_key', '${KEY}'), ('study_site_url', 'https://study.example');
      set role authenticated;
      set request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002';
      select public.study_queue('${L}');
    `);
    assert.equal(setup.code, 0, setup.err);
    assert.equal(setup.out.trim().split("\n").pop(), "t", "study_queue: the server writes");
    const fns = await psql("select p.proname || ' ' || case when p.proretset then 't' else 'f' end from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'study\\_%';");
    const retset = new Map(fns.out.trim().split("\n").map((l) => [l.split(" ")[0], l.split(" ")[1] === "t"] as [string, boolean]));
    server = pgRest(retset, calls, errors);
    const port = await listen(server);
    process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${port}`;
    writerTiming.progressMs = 40;
    mode = "part";

    // pg_net's queue, replayed: each kick as pg_net would send it, until none is left.
    let seen = 0;
    const kicks: Array<{ status: number; body: unknown }> = [];
    for (let round = 0; round < 20; round++) {
      const rows = await psql(`select coalesce(json_agg(c order by c.id), '[]'::json) from net.calls c where c.id > ${seen};`);
      const list = JSON.parse(rows.out.trim()) as Array<{ id: number; url: string; body: unknown; headers: Record<string, string> }>;
      if (!list.length && !pending.length) break;
      for (const c of list) {
        seen = Math.max(seen, c.id);
        assert.equal(c.url, "https://study.example/api/study/work");
        const res = await work.fetch(new Request(c.url, { method: "POST", headers: c.headers, body: JSON.stringify(c.body) }));
        kicks.push({ status: res.status, body: await res.json() });
      }
      await settle();
    }
    const state = await psql(`
      select json_build_object(
        'lecture', (select status from public.study_lectures where id = '${L}'),
        'parts', (select json_agg(json_build_object('idx', idx, 'status', status, 'attempts', attempts, 'lease', lease_id, 'text', markdown) order by idx) from public.study_sections where lecture_id = '${L}'),
        'usage', (select json_agg(json_build_object('kind', kind, 'ref', ref, 'settled', settled_at is not null, 'cost', cost_usd) order by id) from public.study_usage where lecture_id = '${L}'),
        'points', (select json_agg(json_build_object('idx', pp.part_idx, 'status', pp.status, 'current', pp.src_md5 = md5(s.markdown), 'ahead', pp.ahead_at is not null) order by pp.part_idx)
                     from public.study_point_parts pp join public.study_sections s on s.lecture_id = pp.lecture_id and s.idx = pp.part_idx where pp.lecture_id = '${L}'),
        'job', exists (select 1 from study_private.jobs where lecture_id = '${L}'));`);
    const s = JSON.parse(state.out.trim()) as {
      lecture: string;
      parts: Array<{ idx: number; status: string; attempts: number; lease: string | null; text: string }>;
      usage: Array<{ kind: string; ref: string | null; settled: boolean; cost: number }>;
      points: Array<{ idx: number; status: string; current: boolean; ahead: boolean }> | null;
      job: boolean;
    };
    assert.equal(s.lecture, "ready", `kicks ${JSON.stringify(kicks)}; rpc calls ${calls.join(" ")}; errors ${errors.join(" | ")}`);
    assert.deepEqual(
      s.parts.map((p) => [p.idx, p.status, p.attempts, p.lease]),
      [
        [0, "ready", 1, null],
        [1, "ready", 1, null],
        [2, "ready", 1, null],
      ],
    );
    for (const p of s.parts) assert.equal(p.text, PART_TEXT.repeat(3));
    // Parts 1 and 2 of the read ahead are read at once, so their reservations
    // land in either order: compare them sorted by part, everything else in order.
    const usage = s.usage.map((u) => [u.kind, u.ref, u.settled] as [string, string | null, boolean]);
    const parallel = usage.slice(5).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    assert.deepEqual(
      [...usage.slice(0, 5), ...parallel],
      [
        ["outline", null, true],
        ["part", "0", true],
        ["part", "1", true],
        ["part", "2", true],
        // Package B (decision 2 of 17 Nov 2026): the summary done, its points are read ahead, one call per part.
        ["points", "ahead", true],
        ["points", "part 1", true],
        ["points", "part 2", true],
      ],
      "one reservation per unit, each settled by its finish; then the read ahead's, each settled",
    );
    assert.equal(s.job, false, "the lecture left the queue");
    assert.deepEqual(
      s.points,
      [0, 1, 2].map((idx) => ({ idx, status: "ready", current: true, ahead: true })),
      "every part's points read ahead from its final text",
    );
    // Part 0 alone first (it fills the prompt cache), then two at once.
    const claimed = kicks.filter((k) => k.status === 202).map((k) => k.body as { kind?: string; idx?: number | null; parts?: number });
    assert.deepEqual(claimed.slice(0, 2), [
      { claimed: true, kind: "outline", idx: null },
      { claimed: true, kind: "part", idx: 0 },
    ]);
    assert.equal(claimed.filter((c) => c.kind).length, 4, "outline + three parts, each claimed once");
    assert.deepEqual(claimed.at(-1), { claimed: true, parts: 3 }, "then one read ahead, after the last part");
    assert.equal(claimed.length, 5, "and nothing more: the read ahead never comes back to a text it read");
    assert.ok(calls.includes("study_progress"), "the group saw the text grow");
  } finally {
    server?.close();
    useScriptedRest();
    await sh(`dropdb --if-exists ${PG_DB}`);
  }
});
