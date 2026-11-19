import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import ai from "../../api/study/ai.js";
import { POLICY } from "./budget.js";
import { cleanSchema } from "./claude.js";
import { DAILY_TRAP_CHECKS, TRAP_CHECK_MAX_TOKENS } from "./limits.js";
import { TRAP_CHECK_SYSTEM, TRAP_CHECK_TEXT, TRAP_LANGUAGE, trapRequest } from "./prompts/extras.js";
import { QUESTIONS_SYSTEM } from "./prompts/questions.js";
import { MODEL, REQUIRED_SCHEMA, type Lecture, type StoredSlide } from "./study.js";
import { checkTrap, TrapVerdict, type TrapVerdictRaw } from "./traps.js";

/* E-2 (spec §12.6.E), op "trap_check" of /api/study/ai, in Node against
 * local mocks of PostgREST, Auth and Anthropic:
 *
 *  - the draft read with the member's token (RLS: her own); another's or
 *    none → 404 "draft not found"; a passed one → 409 "checked", before any
 *    reservation;
 *  - one reservation (kind trap_check, ref the draft, 5 a day), one call
 *    (effort medium, max_tokens 2,500, system TRAP_CHECK_SYSTEM then the
 *    lecture, cached; the verdict's schema), one settle; checkTrap; then
 *    study_trap_checked with the member's token and the server key;
 *  - a rejection saves its problem; a refusal 422; an answer that breaks the
 *    bank's rules 502 with nothing saved; the daily limit 429 with no call;
 *  - the model never sees a member's name.
 *
 * The lecture is the malaria deck's slide 7 (G6PD before Primaquine). No
 * key, no network. */

const ROOT = process.cwd();
const ADDENDUM = readFileSync(join(ROOT, "docs/study/spec/addendum/addendum.md"), "utf8");

const KEY = "k-0123456789abcdef0123456789abcdef";
const GROUP = "22222222-0000-4000-8000-000000000002";
const USER = "33333333-0000-4000-8000-000000000003";
const LECTURE = "aaaaaaaa-0000-4000-8000-00000000000a";
const DRAFT = "dddddddd-0000-4000-8000-00000000000e";
const QID = "eeeeeeee-0000-4000-8000-00000000000e";

const slide = (n: number, title: string, lines: string[]): StoredSlide => ({ n, title, lines: [title, ...lines], tables: [], notes: "", figures: [] });
const slides: StoredSlide[] = [
  slide(7, "Primaquine", ["Before Primaquine: test G6PD (hemolysis)", "Acts on hypnozoites"]),
  slide(15, "Chloroquine", ["Accumulates in the parasite's food vacuole"]),
];
const lecture: Lecture = { id: LECTURE, group_id: GROUP, course: "פתוגן מאכסן", title: "Anti parasite", lecturer: "", lecture_date: "2026-11-01", source_kind: "pptx", slides };
const PART = "## טיפול\n\nלפני Primaquine בודקים G6PD, בגלל סכנת המוליזה. [ש' 7]\n\nChloroquine מצטברת בוואקואולה. [ש' 15]";

type Draft = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number | null;
  quote: string;
  vignette: string;
  question: string;
  options: string[];
  answer: number;
  note: string;
  slides: number[];
  state: string;
};
const fresh = (): Draft => ({
  id: DRAFT,
  lecture_id: LECTURE,
  part_idx: 0,
  anchor: 1,
  quote: "לפני Primaquine בודקים G6PD",
  vignette: "מטייל חזר עם P. vivax.",
  question: "מה חייבים לבדוק לפני Primaquine?",
  options: ["G6PD", "ECG", "ספירת דם", "תפקודי כבד"],
  answer: 0,
  note: "רוב האנשים בוחרים ECG",
  slides: [7],
  state: "draft",
});

const GOOD: TrapVerdictRaw = {
  ok: true,
  problem: "",
  options: [
    { why: "לפני Primaquine בודקים G6PD בגלל סכנת המוליזה. [ש' 7]", when: "מתי כן: לעולם לא" },
    { why: "ECG לא נדרש לפני Primaquine לפי השקף. [ש' 7]", when: "מתי כן: לפני Pentostam [ש' 15]" },
    { why: "ספירת דם לא מוזכרת כתנאי לפני Primaquine. [ש' 7]", when: "" },
    { why: "תפקודי כבד לא מוזכרים כאן. [ש' 7]", when: "לפעמים" },
  ],
  takeaway: "לפני Primaquine בודקים G6PD. [ש' 7]",
  topic: "Primaquine",
  aspect: "contra",
};
const REJECT: TrapVerdictRaw = { ok: false, problem: "לפי ש׳ 15 היא מצטברת בוואקואולה, לא בגרעין", options: [], takeaway: "", topic: "Chloroquine", aspect: "pk" };

/* ── SSE, as the API streams it ── */
type Ev = Record<string, unknown>;
const startEv = (): Ev => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2400, output_tokens: 1 } },
});
const textEvs = (index: number, text: string, size = 13): Ev[] => {
  const ev: Ev[] = [{ type: "content_block_start", index, content_block: { type: "text", text: "" } }];
  for (let i = 0; i < text.length; i += size) ev.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: text.slice(i, i + size) } });
  ev.push({ type: "content_block_stop", index });
  return ev;
};
const endEvs = (stop: string): Ev[] => [
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, stop_details: null }, usage: { output_tokens: 500 } },
  { type: "message_stop" },
];
const sse = (events: Ev[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const reply = (text: string, stop = "end_turn") => [startEv(), ...textEvs(0, text), ...endEvs(stop)];

/* ── The mocks ── */
type Logged = { who: "rest" | "anthropic"; method: string; path: string; auth: string | null; body: string };
let log: Logged[] = [];
const db = {
  schema: { ...REQUIRED_SCHEMA, Q: 2, E: 1 } as unknown,
  draft: fresh() as Draft | null,
  save: null as null | string,
  reserve: [] as Array<{ status: number; body: unknown }>,
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
  log.push({ who: "rest", method: req.method ?? "", path: url.pathname, auth: req.headers.authorization ?? null, body });
  const p = url.pathname;
  if (p === "/auth/v1/user") return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated" });
  if (p === "/rest/v1/rpc/study_schema") return send(res, 200, db.schema);
  if (p === "/rest/v1/rpc/study_reserve") {
    const r = db.reserve.shift();
    return r ? send(res, r.status, r.body) : send(res, 200, 91);
  }
  if (p === "/rest/v1/rpc/study_settle") return send(res, 200, true);
  if (p === "/rest/v1/rpc/study_trap_checked") {
    if (db.save) return send(res, 400, pgError(db.save));
    return send(res, 200, JSON.parse(body).p_ok ? QID : null);
  }
  if (p === "/rest/v1/study_trap_drafts") return send(res, 200, db.draft && eq(q, "id") === db.draft.id ? [db.draft] : []);
  if (p === "/rest/v1/study_lectures") return send(res, 200, eq(q, "id") === LECTURE ? [lecture] : []);
  if (p === "/rest/v1/study_sections") return send(res, 200, eq(q, "lecture_id") === LECTURE && eq(q, "idx") === "0" ? [{ markdown: PART }] : []);
  send(res, 404, { message: `unmocked ${req.method} ${p}` });
});
const anthropicServer = createServer(async (req, res) => {
  const body = await readAll(req);
  log.push({ who: "anthropic", method: req.method ?? "", path: req.url ?? "", auth: null, body });
  const r = replies.shift();
  if (!r) return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "no reply queued" } });
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(sse(r));
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
  db.schema = { ...REQUIRED_SCHEMA, Q: 2, E: 1 };
  db.draft = fresh();
  db.save = null;
  db.reserve = [];
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
const check = (o: Record<string, unknown> = {}) => post({ op: "trap_check", draftId: DRAFT, ...o });
const answer = async (res: Response) => ({ status: res.status, body: await res.json() });
const restCalls = (path: string) => log.filter((l) => l.who === "rest" && l.path === path);
const modelCalls = () => log.filter((l) => l.who === "anthropic");
const order = () =>
  log
    .filter((l) => l.who === "anthropic" || /study_(reserve|settle|trap_checked)$|study_trap_drafts$/.test(l.path))
    .map((l) => (l.who === "anthropic" ? "model" : l.path.replace("/rest/v1/rpc/study_", "").replace("/rest/v1/", "read ")));
const LECTURE_SLIDES = new Set([7, 15]);

/* ── The prompt and the schema are §12.6.E's ── */

test("TRAP_CHECK_SYSTEM is §12.6.E's text verbatim, then QUESTIONS_SYSTEM's language rules in the same words, and names nobody", () => {
  const at = ADDENDUM.indexOf("**Op `trap_check`**");
  assert.ok(at > 0);
  const fence = ADDENDUM.indexOf("```text\n", at) + "```text\n".length;
  assert.equal(TRAP_CHECK_TEXT, ADDENDUM.slice(fence, ADDENDUM.indexOf("\n```", fence)));
  assert.ok(TRAP_CHECK_SYSTEM.startsWith(TRAP_CHECK_TEXT + "\n\n"));
  assert.ok(TRAP_LANGUAGE.startsWith("LANGUAGE (the style sheet") && QUESTIONS_SYSTEM.includes(TRAP_LANGUAGE) && TRAP_CHECK_SYSTEM.endsWith(TRAP_LANGUAGE));
  assert.ok(!/OUTPUT/.test(TRAP_LANGUAGE), "only the language rules, not the bank's output format");
  assert.ok(!/רוני|נועה|מאיה|שוהם/.test(TRAP_CHECK_SYSTEM));
});

test("the verdict's schema is §12.6.E's: { ok, problem, options: [{ why, when }], takeaway, topic, aspect }, no enum", () => {
  const schema = cleanSchema(zodOutputFormat(TrapVerdict).schema as Record<string, any>);
  assert.deepEqual(Object.keys(schema.properties).sort(), ["aspect", "ok", "options", "problem", "takeaway", "topic"]);
  assert.deepEqual(Object.keys(schema.properties.options.items.properties).sort(), ["when", "why"]);
  assert.equal(schema.properties.aspect.enum, undefined);
  assert.ok(ADDENDUM.includes("schema `{ ok, problem, options: [{ why, when }], takeaway, topic, aspect }`"));
});

test("the user turn: the paragraph, the question as written, numbered, the key, the note, the slides; no name", () => {
  const u = trapRequest({ lectureTitle: "Anti parasite", paragraph: "פסקה [ש' 7]", vignette: "", question: "מה?", options: ["א", "ב", "ג", "ד"], answer: 2, note: "", slides: [7, 15] });
  assert.equal(
    u,
    "The lecture: Anti parasite\n\nThe paragraph of the booklet the question is about:\n<<<\nפסקה [ש' 7]\n>>>\n\nThe question, as the member wrote it:\n<<<\nLead-in: מה?\nOptions:\n1. א\n2. ב\n3. ג\n4. ד\n>>>\nThe option the member marks correct: 3\nWhat the member says the trap is: (not given)\nThe slides the member cites: 7, 15\n\nJudge it. When \"ok\" is true, give \"options\" in the order above, one entry per option.",
  );
  assert.match(trapRequest({ lectureTitle: "x", paragraph: "", vignette: "בת 28.", question: "מה?", options: ["a", "b", "c", "d"], answer: 0, note: "ECG", slides: [7] }), /Case: בת 28\.\nLead-in/);
});

/* ── checkTrap ── */

test("checkTrap: a passed trap keeps its explanations in order, 'מתי כן' by section Q's rule, the takeaway with its tag", () => {
  const v = checkTrap(GOOD, fresh(), LECTURE_SLIDES);
  assert.ok(v && v.ok);
  assert.equal(v.whys.length, 4);
  assert.equal(v.whys[1], "ECG לא נדרש לפני Primaquine לפי השקף. [ש' 7]");
  assert.deepEqual(v.whens, ["", "מתי כן: לפני Pentostam [ש' 15]", "", ""], "'' for the key; a line that does not open with מתי כן: is dropped");
  assert.equal(v.takeaway, "לפני Primaquine בודקים G6PD. [ש' 7]");
  assert.deepEqual([v.topic, v.aspect], ["Primaquine", "contra"]);
  assert.equal((checkTrap({ ...GOOD, aspect: "vibes", takeaway: "בלי תג" }, fresh(), LECTURE_SLIDES) as { aspect: string; takeaway: string }).aspect, "other");
  assert.equal((checkTrap({ ...GOOD, takeaway: "בלי תג" }, fresh(), LECTURE_SLIDES) as { takeaway: string }).takeaway, "", "a takeaway with no tag is left out");
});

test("checkTrap: explanations that break the bank's rules make no verdict (502, nothing saved)", () => {
  const swap = (i: number, why: string) => ({ ...GOOD, options: GOOD.options.map((o, j) => (j === i ? { ...o, why } : o)) });
  assert.equal(checkTrap({ ...GOOD, options: GOOD.options.slice(0, 3) }, fresh(), LECTURE_SLIDES), null, "one explanation per option");
  assert.equal(checkTrap(swap(1, "ECG לא נדרש לפני Primaquine."), fresh(), LECTURE_SLIDES), null, "every why ends with a tag");
  assert.equal(checkTrap(swap(1, "ECG לא נדרש. [ש' 99]"), fresh(), LECTURE_SLIDES), null, "a tag of the lecture's slides");
  assert.equal(checkTrap(swap(1, "כמו תשובה ג, ECG לא נדרש. [ש' 7]"), fresh(), LECTURE_SLIDES), null, "no other option by its letter: the bank shuffles");
  assert.equal(checkTrap({ ...REJECT, problem: " " }, fresh(), LECTURE_SLIDES), null, "a rejection names its problem");
});

test("checkTrap: a rejection keeps its problem on one line", () => {
  assert.deepEqual(checkTrap({ ...REJECT, problem: "לפי ש׳ 15\nהיא מצטברת בוואקואולה" }, fresh(), LECTURE_SLIDES), { ok: false, problem: "לפי ש׳ 15 היא מצטברת בוואקואולה" });
});

/* ── The op ── */

// The schema check is remembered once it passes (per instance), so this comes first.
test("trap_check: without section E, 503 schema and no call", async () => {
  db.schema = { ...REQUIRED_SCHEMA, Q: 2 };
  assert.deepEqual(await answer(await check()), { status: 503, body: { error: "schema" } });
  assert.equal(restCalls("/rest/v1/study_trap_drafts").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("trap_check: the draft, one reservation, one call, one settle; checked and saved with the key; the trap is in the bank", async () => {
  replies.push(reply(JSON.stringify(GOOD)));
  const res = await answer(await check());
  assert.deepEqual(res, { status: 200, body: { ok: true, problem: "", questionId: QID } });
  assert.deepEqual(order(), ["read study_trap_drafts", "reserve", "model", "settle", "trap_checked"]);
  const read = restCalls("/rest/v1/study_trap_drafts")[0];
  assert.ok(read.auth?.endsWith(TOKEN), "the draft is read with the member's token");
  const r = JSON.parse(restCalls("/rest/v1/rpc/study_reserve")[0].body);
  assert.deepEqual(
    { kind: r.p_kind, ref: r.p_ref, lecture: r.p_lecture, group: r.p_group, daily: r.p_daily, share: r.p_share, member: r.p_member_share, key: r.p_key },
    { kind: "trap_check", ref: DRAFT, lecture: LECTURE, group: GROUP, daily: POLICY.trap_check.daily, share: 0.8, member: 0.4, key: KEY },
  );
  assert.equal(DAILY_TRAP_CHECKS, 5);
  assert.ok(r.p_estimate > 0.01 && r.p_estimate < 0.1, `about the screen's ≈ $0.03: ${r.p_estimate}`);
  const body = JSON.parse(modelCalls()[0].body) as Record<string, any>;
  assert.equal(body.model, MODEL);
  assert.equal(body.max_tokens, TRAP_CHECK_MAX_TOKENS);
  assert.equal(TRAP_CHECK_MAX_TOKENS, 2500);
  assert.deepEqual(body.output_config, { effort: "medium", format: { type: "json_schema", schema: cleanSchema(zodOutputFormat(TrapVerdict).schema as Record<string, unknown>) } });
  assert.equal(body.system.length, 2);
  assert.equal(body.system[0].text, TRAP_CHECK_SYSTEM);
  assert.equal(body.system[0].cache_control, undefined);
  assert.match(body.system[1].text, /^The full lecture, for context:\n\n\[שקף 7\] Primaquine/);
  assert.deepEqual(body.system[1].cache_control, { type: "ephemeral" }, "the lecture is cached");
  const user = body.messages[0].content[0].text as string;
  assert.match(user, /לפני Primaquine בודקים G6PD, בגלל סכנת המוליזה\. \[ש' 7\]/, "the paragraph at the draft's anchor, from the part");
  assert.match(user, /Case: מטייל חזר עם P\. vivax\.\nLead-in: מה חייבים לבדוק לפני Primaquine\?\nOptions:\n1\. G6PD\n2\. ECG/);
  assert.match(user, /The option the member marks correct: 1\nWhat the member says the trap is: רוב האנשים בוחרים ECG\nThe slides the member cites: 7/);
  assert.ok(!JSON.stringify(body).includes(USER), "no member's id or name reaches the model");
  const saved = restCalls("/rest/v1/rpc/study_trap_checked")[0];
  assert.ok(saved.auth?.endsWith(TOKEN), "saved with the member's token");
  assert.deepEqual(JSON.parse(saved.body), {
    p_draft: DRAFT,
    p_ok: true,
    p_problem: "",
    p_whys: GOOD.options.map((o) => o.why),
    p_whens: ["", "מתי כן: לפני Pentostam [ש' 15]", "", ""],
    p_takeaway: "לפני Primaquine בודקים G6PD. [ש' 7]",
    p_topic: "Primaquine",
    p_aspect: "contra",
    p_key: KEY,
  });
});

test("trap_check: not right by the slides: the problem is saved on the draft for 'לתקן'", async () => {
  replies.push(reply(JSON.stringify(REJECT)));
  const res = await answer(await check());
  assert.deepEqual(res, { status: 200, body: { ok: false, problem: REJECT.problem, questionId: null } });
  const saved = JSON.parse(restCalls("/rest/v1/rpc/study_trap_checked")[0].body);
  assert.deepEqual([saved.p_ok, saved.p_problem, saved.p_whys], [false, REJECT.problem, []]);
});

test("trap_check: another member's draft or none is 404, a passed one 409, both before any reservation", async () => {
  db.draft = null;
  assert.deepEqual(await answer(await check()), { status: 404, body: { error: "draft not found" } });
  db.draft = { ...fresh(), state: "ok" };
  assert.deepEqual(await answer(await check()), { status: 409, body: { error: "checked" } });
  assert.deepEqual(await answer(await check({ draftId: "nope" })), { status: 400, body: { error: "draftId required" } });
  assert.equal(restCalls("/rest/v1/rpc/study_reserve").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("trap_check: the day's 5 checks (429) and the budget (402) refuse before the call", async () => {
  db.reserve.push({ status: 400, body: pgError("daily_limit") });
  assert.deepEqual(await answer(await check()), { status: 429, body: { error: "daily_limit" } });
  db.reserve.push({ status: 400, body: pgError("member_share") });
  assert.deepEqual(await answer(await check()), { status: 402, body: { error: "member_share" } });
  assert.equal(modelCalls().length, 0);
  assert.equal(restCalls("/rest/v1/rpc/study_trap_checked").length, 0);
});

test("trap_check: a refusal is settled, then 422; an answer that is no verdict 502; nothing saved either way", async () => {
  replies.push(reply("", "refusal"));
  assert.deepEqual(await answer(await check()), { status: 422, body: { error: "refusal" } });
  assert.equal(restCalls("/rest/v1/rpc/study_settle").length, 1, "the refused call is paid for");
  replies.push(reply('{"ok": true, "problem": ""'));
  assert.deepEqual(await answer(await check()), { status: 502, body: { error: "truncated" } });
  replies.push(reply(JSON.stringify({ ...GOOD, options: GOOD.options.map((o) => ({ ...o, why: "בלי תג" })) })));
  assert.deepEqual(await answer(await check()), { status: 502, body: { error: "truncated" } });
  assert.equal(restCalls("/rest/v1/rpc/study_settle").length, 3);
  assert.equal(restCalls("/rest/v1/rpc/study_trap_checked").length, 0);
});

test("trap_check: the database's 'checked' (a second phone of hers saved it first) is 409", async () => {
  replies.push(reply(JSON.stringify(GOOD)));
  db.save = "checked";
  assert.deepEqual(await answer(await check()), { status: 409, body: { error: "checked" } });
});
