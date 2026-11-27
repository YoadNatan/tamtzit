import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import ai from "../../api/study/ai.js";
import { readShare } from "./ask.js";
import { POLICY } from "./budget.js";
import { cleanSchema } from "./claude.js";
import { citedSlidesText, FixCheck, fixCheckOpts } from "./ops/fixcheck.js";
import { FIX_CHECK_MAX_TOKENS } from "./limits.js";
import { askTurnText, FIX_CHECK_SYSTEM, fixCheckRequest } from "./prompts/collab.js";
import { MODEL, REQUIRED_SCHEMA, slideText, type Lecture, type StoredSlide } from "./study.js";

/* KS-2 (spec §12.3.K), the server lines of K's end, in Node through
 * /api/study/ai, against local mocks of PostgREST, Auth and Anthropic:
 *
 *  - the share path ("עדיין לא ברור? לשאול את הקבוצה", K2, review SEC-9):
 *    a turn this server signed for this lecture, whose user text holds the
 *    question, goes to study_ask_to_group with the member's token and the
 *    server key, the answer as Claude's attempt; a wrong signature, another
 *    lecture's turn or a question the turn does not hold → 400 "bad turn"
 *    and no call at all; no model call and no reservation either way;
 *  - op "fix_check" (X2): the proposal read with the member's token, the
 *    cited slides' text, one reservation (kind fix_check, ref the proposal),
 *    one call (effort low, max_tokens 800, the { ok, note } schema), one
 *    settle, the result written with the key; a proposal that no longer
 *    waits or cites no slide is refused before anything is reserved; a
 *    refusal is settled, then 502.
 *
 * The lecture is made for the tests (a drug that does not exist). No key, no
 * network. */

const ROOT = process.cwd();
const ADDENDUM = readFileSync(join(ROOT, "docs/study/spec/addendum/addendum.md"), "utf8");

const KEY = "k-0123456789abcdef0123456789abcdef";
const GROUP = "22222222-0000-4000-8000-000000000002";
const USER = "33333333-0000-4000-8000-000000000003";
const LECTURE = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER = "bbbbbbbb-0000-4000-8000-00000000000b";
const PROPOSAL = "cccccccc-0000-4000-8000-00000000000c";

const slide = (n: number, title: string, lines: string[]): StoredSlide => ({ n, title, lines: [title, ...lines], tables: [], notes: "", figures: [] });
const slides: StoredSlide[] = [
  slide(2, "Fabrimycin: מנגנון", ["Prodrug", "משופעלת על ידי Examplase בתנאים אנאירוביים"]),
  slide(7, "Fabrimycin: תופעות לוואי", ["Metallic taste", "תגובה דמוית Disulfiram עם אלכוהול עד 72 שעות אחרי המנה האחרונה"]),
  slide(8, "Placebozole", ["שלשול ופריחה"]),
];
const lecture: Lecture = {
  id: LECTURE,
  group_id: GROUP,
  course: "פתוגן מאכסן",
  title: "Fabrimycin",
  lecturer: "",
  lecture_date: "2026-11-01",
  source_kind: "pptx",
  slides,
};

/* ── SSE, as the API streams it ── */
type Ev = Record<string, unknown>;
const startEv = (): Ev => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 700, output_tokens: 1 } },
});
const textEvs = (index: number, text: string, size = 9): Ev[] => {
  const ev: Ev[] = [{ type: "content_block_start", index, content_block: { type: "text", text: "" } }];
  for (let i = 0; i < text.length; i += size) ev.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: text.slice(i, i + size) } });
  ev.push({ type: "content_block_stop", index });
  return ev;
};
const endEvs = (stop: string): Ev[] => [
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, stop_details: null }, usage: { output_tokens: 90 } },
  { type: "message_stop" },
];
const sse = (events: Ev[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const checkReply = (text: string, stop = "end_turn") => [startEv(), ...textEvs(0, text), ...endEvs(stop)];

/* ── The mocks ── */
type Logged = { who: "rest" | "anthropic"; method: string; path: string; query: URLSearchParams; auth: string | null; body: string };
let log: Logged[] = [];
type Proposal = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number;
  before_text: string;
  after_text: string;
  source_kind: string;
  source_slides: number[];
  state: string;
};
const db = {
  schema: { ...REQUIRED_SCHEMA, K: 2 } as unknown,
  proposal: null as Proposal | null,
  reserve: [] as Array<{ status: number; body: unknown }>,
  rpcError: null as null | string,
};
const replies: Ev[][] = [];

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
const pgError = (message: string) => ({ code: "P0001", details: null, hint: null, message });
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
    return r ? send(res, r.status, r.body) : send(res, 200, 51);
  }
  if (p === "/rest/v1/rpc/study_settle") return send(res, 200, true);
  if (p === "/rest/v1/rpc/study_ask_to_group") return db.rpcError ? send(res, 400, pgError(db.rpcError)) : send(res, 200, "dddddddd-0000-4000-8000-00000000000d");
  if (p === "/rest/v1/rpc/study_edit_proposal_checked") return db.rpcError ? send(res, 400, pgError(db.rpcError)) : send(res, 204, null);
  if (p === "/rest/v1/study_edit_proposals") return send(res, 200, db.proposal && eq(q, "id") === db.proposal.id ? [db.proposal] : []);
  if (p === "/rest/v1/study_lectures") return send(res, 200, eq(q, "id") === LECTURE ? [lecture] : []);
  send(res, 404, { message: `unmocked ${req.method} ${p}` });
});
const anthropicServer = createServer(async (req, res) => {
  const body = await readAll(req);
  log.push({ who: "anthropic", method: req.method ?? "", path: req.url ?? "", query: new URLSearchParams(), auth: null, body });
  const reply = replies.shift();
  if (!reply) return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "no reply queued" } });
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(sse(reply));
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
  db.schema = { ...REQUIRED_SCHEMA, K: 2 };
  db.reserve = [];
  db.rpcError = null;
  db.proposal = {
    id: PROPOSAL,
    lecture_id: LECTURE,
    part_idx: 0,
    anchor: 4,
    before_text: "**תופעות לוואי:** Metallic taste ותגובה דמוית Disulfiram עם אלכוהול עד 48 שעות. [ש' 7]",
    after_text: "**תופעות לוואי:** Metallic taste ותגובה דמוית Disulfiram עם אלכוהול עד 72 שעות אחרי המנה האחרונה. [ש' 7]",
    source_kind: "slide",
    source_slides: [7],
    state: "pending",
  };
  replies.length = 0;
});

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const post = (body: Record<string, unknown>) =>
  ai.fetch(
    new Request("http://localhost/api/study/ai", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const answer = async (res: Response) => ({ status: res.status, body: await res.json() });
const restCalls = (path: string) => log.filter((l) => l.who === "rest" && l.path === path);
const modelCalls = () => log.filter((l) => l.who === "anthropic");
const hex = (lectureId: string, u: string, a: string) => createHmac("sha256", KEY).update(`${lectureId}\n${u}\n${a}`, "utf8").digest("hex");

/* ── The share path ── */

const QUESTION = "למה Fabrimycin אסורה עם אלכוהול?";
const U = askTurnText(QUESTION, { heading: "Fabrimycin: מנגנון ותופעות לוואי", text: "**תופעות לוואי:** …" }, false);
const A = "בגלל תגובה דמוית Disulfiram, עד 72 שעות אחרי המנה האחרונה. [ש' 7] איזה שותף בדיוק: לא מופיע בשקפים.";
const share = (o: Record<string, unknown> = {}) => ({
  op: "ask",
  share: { lectureId: LECTURE, part: 0, anchor: 4, quote: "תופעות לוואי", question: QUESTION, turn: { u: U, a: A, sig: hex(LECTURE, U, A) }, ...o },
});

test("the share path is §12.3.K's: its body and its call are the ones the addendum names", () => {
  assert.ok(ADDENDUM.includes('`{ "op": "ask", "share": { lectureId, part, anchor, quote, question, turn: { u, a, sig } } }`'));
  assert.ok(ADDENDUM.includes('`rpc("study_ask_to_group", { …, p_attempt: turn.a, p_key })` with the member\'s token; no Claude call, no reservation.'));
  assert.deepEqual(readShare(share().share), { lectureId: LECTURE, part: 0, anchor: 4, quote: "תופעות לוואי", question: QUESTION, turn: { u: U, a: A, sig: hex(LECTURE, U, A) } });
  for (const bad of [null, {}, { ...share().share, lectureId: "x" }, { ...share().share, part: -1 }, { ...share().share, turn: { u: U, a: A } }, { ...share().share, question: " " }])
    assert.throws(() => readShare(bad), (e: Error) => e.message === "bad turn", JSON.stringify(bad));
  assert.throws(() => readShare({ ...share().share, question: "x".repeat(2001) }), (e: Error) => e.message === "too long");
});

// The schema check is remembered once it passes (per instance), so this comes first.
test("share and fix_check: without K's end in the database, 503 schema and no call", async () => {
  db.schema = { ...REQUIRED_SCHEMA, K: 1 };
  assert.deepEqual(await answer(await post(share())), { status: 503, body: { error: "schema" } });
  assert.deepEqual(await answer(await post({ op: "fix_check", proposalId: PROPOSAL })), { status: 503, body: { error: "schema" } });
  assert.equal(restCalls("/rest/v1/rpc/study_ask_to_group").length, 0);
  assert.equal(restCalls("/rest/v1/rpc/study_reserve").length, 0);
});

test("share: a signed turn goes to study_ask_to_group with the member's token and the key; no model, no reservation", async () => {
  const res = await answer(await post(share()));
  assert.deepEqual(res, { status: 200, body: { id: "dddddddd-0000-4000-8000-00000000000d" } });
  const calls = restCalls("/rest/v1/rpc/study_ask_to_group");
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), {
    p_lecture: LECTURE,
    p_part: 0,
    p_anchor: 4,
    p_quote: "תופעות לוואי",
    p_question: QUESTION,
    p_attempt: A,
    p_key: KEY,
  });
  assert.ok(calls[0].auth?.endsWith(TOKEN), "with the member's token");
  assert.equal(restCalls("/rest/v1/rpc/study_reserve").length, 0, "no reservation");
  assert.equal(modelCalls().length, 0, "no model call");
});

test("share: a wrong sig, another lecture's turn, an edited answer or a question the turn does not hold → 400 bad turn, and no call at all", async () => {
  const forged = [
    share({ turn: { u: U, a: A, sig: "0".repeat(64) } }),
    share({ turn: { u: U, a: A, sig: hex(OTHER, U, A) } }),
    share({ turn: { u: U, a: `${A} ועוד משפט שלא נכתב כאן.`, sig: hex(LECTURE, U, A) } }),
    share({ question: "שאלה אחרת לגמרי?" }),
    share({ lectureId: OTHER }),
  ];
  for (const body of forged) {
    log = [];
    assert.deepEqual(await answer(await post(body)), { status: 400, body: { error: "bad turn" } }, JSON.stringify(body.share).slice(0, 120));
    assert.deepEqual(log, [], "nothing asked of the database, Auth or the model");
  }
});

test("share: the database's refusals keep their codes", async () => {
  for (const [code, status] of [
    ["lecture not found", 404],
    ["bad parts", 400],
    ["too long", 400],
    ["forbidden", 403],
  ] as const) {
    db.rpcError = code;
    assert.deepEqual(await answer(await post(share())), { status, body: { error: code } }, code);
  }
});

/* ── fix_check ── */

const fix = (o: Record<string, unknown> = {}) => post({ op: "fix_check", proposalId: PROPOSAL, ...o });

test("fix_check: the prompt carries §12.3.K's question; the request is the before, the after and the cited slides", () => {
  const q = "Does the corrected text say only what the cited slides say? note: one Hebrew line naming a mismatch, '' when none.";
  assert.ok(ADDENDUM.includes(`*"${q}"*`), "§12.3.K's words");
  assert.ok(FIX_CHECK_SYSTEM.includes(q));
  assert.ok(!/שוהם|נועה|\d{4}-\d\d-\d\d/.test(FIX_CHECK_SYSTEM), "no name or date in the frozen text");
  assert.equal(
    fixCheckRequest({ before: "לפני", after: "אחרי", slides: "[ש' 7] שקף" }),
    "The paragraph before the correction:\n<<<\nלפני\n>>>\n\nThe paragraph after the correction:\n<<<\nאחרי\n>>>\n\nThe cited slides:\n<<<\n[ש' 7] שקף\n>>>",
  );
  assert.equal(citedSlidesText(lecture, [7, 99, 2]), `[ש' 7] ${slideText(slides[1])}\n\n[ש' 2] ${slideText(slides[0])}`, "in the order cited; a slide the deck lacks is skipped");
});

test("fix_check: one reservation, one call (effort low, 800 tokens, { ok, note }), one settle; the result written with the key", async () => {
  replies.push(checkReply('{"ok":false,"note":"  בשקף 7 כתוב 72 שעות, אבל לא כתוב \'אחרי המנה האחרונה\'.  "}'));
  const res = await answer(await fix());
  assert.deepEqual(res, { status: 200, body: { ok: false, note: "בשקף 7 כתוב 72 שעות, אבל לא כתוב 'אחרי המנה האחרונה'." } });
  // the ledger: reserve → model → settle → the result
  const order = log
    .filter((l) => l.who === "anthropic" || ["/rest/v1/rpc/study_reserve", "/rest/v1/rpc/study_settle", "/rest/v1/rpc/study_edit_proposal_checked"].includes(l.path))
    .map((l) => (l.who === "anthropic" ? "model" : l.path.replace("/rest/v1/rpc/study_", "")));
  assert.deepEqual(order, ["reserve", "model", "settle", "edit_proposal_checked"]);
  const r = JSON.parse(restCalls("/rest/v1/rpc/study_reserve")[0].body);
  assert.deepEqual(
    { kind: r.p_kind, ref: r.p_ref, lecture: r.p_lecture, group: r.p_group, daily: r.p_daily, share: r.p_share, key: r.p_key },
    { kind: "fix_check", ref: PROPOSAL, lecture: LECTURE, group: GROUP, daily: POLICY.fix_check.daily, share: POLICY.fix_check.share, key: KEY },
  );
  assert.ok(r.p_estimate > 0 && r.p_estimate < 0.05, `about a cent: ${r.p_estimate}`);
  const body = JSON.parse(modelCalls()[0].body) as Record<string, any>;
  assert.equal(body.model, MODEL);
  assert.equal(body.max_tokens, FIX_CHECK_MAX_TOKENS);
  assert.equal(FIX_CHECK_MAX_TOKENS, 800);
  assert.deepEqual(body.output_config, { effort: "low", format: { type: "json_schema", schema: cleanSchema(zodOutputFormat(FixCheck).schema as Record<string, unknown>) } });
  assert.deepEqual(body.system, [{ type: "text", text: FIX_CHECK_SYSTEM }]);
  assert.deepEqual(body.messages, [
    { role: "user", content: fixCheckRequest({ before: db.proposal!.before_text, after: db.proposal!.after_text, slides: citedSlidesText(lecture, [7]) }) },
  ]);
  const checked = restCalls("/rest/v1/rpc/study_edit_proposal_checked")[0];
  assert.deepEqual(JSON.parse(checked.body), { p_proposal: PROPOSAL, p_ok: false, p_note: "בשקף 7 כתוב 72 שעות, אבל לא כתוב 'אחרי המנה האחרונה'.", p_key: KEY });
  assert.ok(checked.auth?.endsWith(TOKEN), "with the member's token");
  // the proposal was read with the member's token too
  assert.ok(restCalls("/rest/v1/study_edit_proposals")[0].auth?.endsWith(TOKEN));
});

test("fixCheckOpts (design-models §7.6): the check's request, pure, as checkCall sends it", () => {
  const request = fixCheckRequest({ before: "a [ש' 7]", after: "b [ש' 7]", slides: "[ש' 7] שקף" });
  assert.deepEqual(fixCheckOpts(request), {
    kind: "fix_check",
    system: [{ type: "text", text: FIX_CHECK_SYSTEM }],
    messages: [{ role: "user", content: request }],
    effort: "low",
    maxTokens: FIX_CHECK_MAX_TOKENS,
    format: { type: "json_schema", schema: cleanSchema(zodOutputFormat(FixCheck).schema as Record<string, unknown>) },
  });
  assert.deepEqual(fixCheckOpts(request), fixCheckOpts(request), "the same every time");
});

test("fix_check: a proposal that no longer waits, another group's, or one without a slide is refused before any reservation", async () => {
  const cases: Array<[() => void, string]> = [
    [() => (db.proposal!.state = "applied"), "not pending"],
    [() => (db.proposal = null), "not pending"],
    [() => Object.assign(db.proposal!, { source_kind: "external", source_slides: [] }), "bad source"],
    [() => Object.assign(db.proposal!, { source_kind: "slide", source_slides: [99] }), "bad source"],
  ];
  for (const [arrange, error] of cases) {
    log = [];
    db.proposal = {
      id: PROPOSAL, lecture_id: LECTURE, part_idx: 0, anchor: 4, before_text: "a [ש' 7]", after_text: "b [ש' 7]", source_kind: "slide", source_slides: [7], state: "pending",
    };
    arrange();
    assert.deepEqual(await answer(await fix()), { status: 400, body: { error } }, error);
    assert.equal(restCalls("/rest/v1/rpc/study_reserve").length, 0);
    assert.equal(modelCalls().length, 0);
  }
  assert.deepEqual(await answer(await fix({ proposalId: "not-a-uuid" })), { status: 400, body: { error: "not pending" } });
});

test("fix_check: a refusal is settled, then 502; the budget's refusals answer before any call", async () => {
  replies.push(checkReply("", "refusal"));
  assert.deepEqual(await answer(await fix()), { status: 502, body: { error: "refusal" } });
  assert.equal(restCalls("/rest/v1/rpc/study_settle").length, 1, "settled");
  assert.equal(restCalls("/rest/v1/rpc/study_edit_proposal_checked").length, 0, "nothing written");
  for (const [code, status] of [
    ["daily_limit", 429],
    ["reserve", 402],
  ] as const) {
    log = [];
    db.reserve = [{ status: 400, body: pgError(code) }];
    assert.deepEqual(await answer(await fix()), { status, body: { error: code } }, code);
    assert.equal(modelCalls().length, 0);
  }
});
