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
import { VAR_MAX_TOKENS } from "./limits.js";
import { VAR_SYSTEM, varRequest } from "./prompts/var.js";
import { MODEL, REQUIRED_SCHEMA, slideText, type Lecture, type StoredSlide } from "./study.js";
import { checkVerdict, normalizeQuote, trapOk, Verdict, varSlides, type VerdictRaw } from "./var.js";

/* V-2 (spec §12.4.V), op "var" of /api/study/ai, in Node against local
 * mocks of PostgREST, Auth, Storage and Anthropic:
 *
 *  - the dispute read with the member's token; not open or one side only →
 *    409 "not ready" before anything else;
 *  - study_dispute_judge_begin with the member's token and the server key
 *    BEFORE the reservation (review SEC-15): its "busy" answers 409 with no
 *    reservation and no Anthropic request;
 *  - one reservation (kind var, ref the dispute), one call (effort medium,
 *    max_tokens 4000, the verdict's schema), one settle, the verdict checked
 *    (checkVerdict) and saved with the key; the members' names never reach
 *    the model;
 *  - a refusal is settled, then 422; an answer that is no verdict 502.
 *
 * The lecture is the corrections fixture's (slides 20 and 23 of the
 * malaria deck, as the approved mockup quotes them). No key, no network. */

const ROOT = process.cwd();
const ADDENDUM = readFileSync(join(ROOT, "docs/study/spec/addendum/addendum.md"), "utf8");

const KEY = "k-0123456789abcdef0123456789abcdef";
const GROUP = "22222222-0000-4000-8000-000000000002";
const USER = "33333333-0000-4000-8000-000000000003";
const LECTURE = "aaaaaaaa-0000-4000-8000-00000000000a";
const DISPUTE = "dddddddd-0000-4000-8000-00000000000d";

const slide = (n: number, title: string, lines: string[], figures: StoredSlide["figures"] = []): StoredSlide => ({
  n,
  title,
  lines: [title, ...lines],
  tables: [],
  notes: "",
  figures,
});
const slides: StoredSlide[] = [
  slide(20, "Drugs by stage", ["No single drug clears both liver and blood stages"]),
  slide(23, "Atovaquone-proguanil", ["Primary liver stage: Yes", "Asexual blood stage: Yes", "Hypnozoites: No"], [
    { k: 0, path: `${GROUP}/${LECTURE}/s23-0.jpg`, w: 1400, h: 1050 },
    { k: 1, path: `${GROUP}/${LECTURE}/s23-1.jpg`, w: 800, h: 600 },
  ]),
  slide(31, "Primaquine", ["Hypnozoites: Yes", "weak on blood stages"]),
];
const lecture: Lecture = { id: LECTURE, group_id: GROUP, course: "פתוגן מאכסן", title: "Anti parasite", lecturer: "", lecture_date: "2026-11-01", source_kind: "pptx", slides };
const PART = "## תרופות לפי שלב\n\nאף תרופה אחת לא מסלקת גם את שלב הכבד וגם את שלב הדם. [ש' 20, 31]\n\nAtovaquone-proguanil פועלת בכבד ובדם. [ש' 23]";

/* ── SSE, as the API streams it ── */
type Ev = Record<string, unknown>;
const startEv = (): Ev => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2400, output_tokens: 1 } },
});
const textEvs = (index: number, text: string, size = 11): Ev[] => {
  const ev: Ev[] = [{ type: "content_block_start", index, content_block: { type: "text", text: "" } }];
  for (let i = 0; i < text.length; i += size) ev.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: text.slice(i, i + size) } });
  ev.push({ type: "content_block_stop", index });
  return ev;
};
const endEvs = (stop: string): Ev[] => [
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, stop_details: null }, usage: { output_tokens: 600 } },
  { type: "message_stop" },
];
const sse = (events: Ev[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const reply = (text: string, stop = "end_turn") => [startEv(), ...textEvs(0, text), ...endEvs(stop)];

const GOOD: VerdictRaw = {
  certainty: "interpretation",
  summary: "שתי הטענות כתובות בשקפים, כל אחת בשקף שלה; היישוב ביניהן הוא פרשנות.",
  on_slides: [
    { text: "No single drug clears both liver and blood stages", slides: [20] },
    { text: "Primary liver stage: Yes", slides: [23] },
  ],
  interpretation: [{ text: "אם 'שלב הכבד' כולל hypnozoites, אין סתירה.", slides: [23] }],
  listen: true,
  trap: { front: "למה Malarone לא סותרת את שקף 20?", back: "כבד ראשוני ודם כן, hypnozoites לא. [ש' 23]", slides: [23, 31] },
};

/* ── The mocks ── */
type Logged = { who: "rest" | "anthropic"; method: string; path: string; auth: string | null; body: string };
let log: Logged[] = [];
type DisputeRow = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number;
  quote: string;
  claim_a: string;
  slides_a: number[];
  claim_b: string | null;
  slides_b: number[];
  state: string;
};
const fresh = (): DisputeRow => ({
  id: DISPUTE,
  lecture_id: LECTURE,
  part_idx: 0,
  anchor: 1,
  quote: "אף תרופה אחת",
  claim_a: "אף תרופה אחת לא מסלקת גם את שלב הכבד וגם את שלב הדם.",
  slides_a: [20],
  claim_b: "אבל Atovaquone-proguanil מסומנת 'כן' גם בכבד וגם בדם.",
  slides_b: [23],
  state: "open",
});
const db = {
  schema: { ...REQUIRED_SCHEMA, V: 1 } as unknown,
  dispute: fresh() as DisputeRow | null,
  hold: null as null | string,
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
    return r ? send(res, r.status, r.body) : send(res, 200, 77);
  }
  if (p === "/rest/v1/rpc/study_settle") return send(res, 200, true);
  if (p === "/rest/v1/rpc/study_dispute_judge_begin") return db.hold ? send(res, 400, pgError(db.hold)) : send(res, 204, null);
  if (p === "/rest/v1/rpc/study_dispute_verdict") return db.save ? send(res, 400, pgError(db.save)) : send(res, 204, null);
  if (p === "/rest/v1/study_disputes") return send(res, 200, db.dispute && eq(q, "id") === db.dispute.id ? [db.dispute] : []);
  if (p === "/rest/v1/study_lectures") return send(res, 200, eq(q, "id") === LECTURE ? [lecture] : []);
  if (p === "/rest/v1/study_sections") return send(res, 200, eq(q, "lecture_id") === LECTURE && eq(q, "idx") === "0" ? [{ markdown: PART }] : []);
  if (p === "/storage/v1/object/sign/study") {
    const { paths } = JSON.parse(body) as { paths: string[] };
    return send(res, 200, paths.map((x) => ({ path: x, signedURL: `/object/sign/study/${x}?token=t`, error: null })));
  }
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
  db.schema = { ...REQUIRED_SCHEMA, V: 1 };
  db.dispute = fresh();
  db.hold = null;
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
const varOf = (o: Record<string, unknown> = {}) => post({ op: "var", disputeId: DISPUTE, ...o });
const answer = async (res: Response) => ({ status: res.status, body: await res.json() });
const restCalls = (path: string) => log.filter((l) => l.who === "rest" && l.path === path);
const modelCalls = () => log.filter((l) => l.who === "anthropic");
const order = () =>
  log
    .filter((l) => l.who === "anthropic" || /study_(reserve|settle|dispute_judge_begin|dispute_verdict)$|study_disputes$/.test(l.path))
    .map((l) => (l.who === "anthropic" ? "model" : l.path.replace("/rest/v1/rpc/study_", "").replace("/rest/v1/", "read ")));

/* ── The prompt and the schema are §12.4.V's ── */

test("VAR_SYSTEM is §12.4.V's text verbatim, and names nobody", () => {
  const at = ADDENDUM.indexOf("**`VAR_SYSTEM`** (`server/study/prompts/var.ts`):");
  assert.ok(at > 0);
  const fence = ADDENDUM.indexOf("```text\n", at) + "```text\n".length;
  const text = ADDENDUM.slice(fence, ADDENDUM.indexOf("\n```", fence));
  assert.equal(VAR_SYSTEM, text);
  assert.ok(!/נועה|איתי|מאיה|שוהם/.test(VAR_SYSTEM));
});

test("the verdict's schema is §12.4.V's: no enum for certainty, a nullable trap", () => {
  const schema = cleanSchema(zodOutputFormat(Verdict).schema as Record<string, any>);
  assert.deepEqual(Object.keys(schema.properties).sort(), ["certainty", "interpretation", "listen", "on_slides", "summary", "trap"]);
  assert.equal(schema.properties.certainty.type, "string");
  assert.equal(schema.properties.certainty.enum, undefined);
  assert.ok(ADDENDUM.includes("export const Verdict = z.object({"));
});

test("the slides VAR reads: both claims', then the paragraph's own tags, the deck's only, at most 6", () => {
  const deck = Array.from({ length: 40 }, (_, i) => ({ n: i + 1 }));
  assert.deepEqual(varSlides(deck, [20], [23], "x [ש' 23, 31]"), [20, 23, 31]);
  assert.deepEqual(varSlides(deck, [20, 99], [20], "[ש' 1-9]"), [20, 1, 2, 3, 4, 5]);
  assert.deepEqual(varSlides(deck, [], [], "no tags"), []);
});

test("the user turn: the part, the paragraph, the slides, the claims with their tags and no names", () => {
  const { head, tail } = varRequest({
    part: "## P",
    paragraph: "פסקה [ש' 20]",
    slides: [{ n: 20, text: "[שקף 20] x" }],
    a: { claim: "טענה א", slides: [20] },
    b: { claim: "טענה ב", slides: [23, 31] },
  });
  assert.equal(head, "This part of the booklet:\n<<<\n## P\n>>>\n\nThe disputed paragraph:\n<<<\nפסקה [ש' 20]\n>>>\n\nThe slides:\nשקף 20: [שקף 20] x");
  assert.equal(tail, "Claim A ({ש׳ 20}): טענה א\nClaim B ({ש׳ 23, 31}): טענה ב");
});

/* ── checkVerdict ── */

test("checkVerdict: a quote that is on its slide stays; one that is not moves to interpretation, and certainty follows", () => {
  const v = checkVerdict({ ...GOOD, certainty: "slide" }, slides)!;
  assert.equal(v.on_slides.length, 2, "both quotes are on their slides (case and punctuation aside)");
  assert.equal(v.certainty, "interpretation", "slide only with no interpretation");
  const forged = checkVerdict(
    { ...GOOD, certainty: "slide", on_slides: [{ text: "Atovaquone clears hypnozoites", slides: [23] }], interpretation: [] },
    slides,
  )!;
  assert.deepEqual(forged.on_slides, []);
  assert.deepEqual(forged.interpretation, [{ text: "Atovaquone clears hypnozoites", slides: [23] }]);
  assert.equal(forged.certainty, "interpretation", "no quote left: never 'slide'");
  const clean = checkVerdict({ ...GOOD, certainty: "slide", on_slides: [{ text: "no single drug clears BOTH liver, and blood stages!", slides: [20] }], interpretation: [] }, slides)!;
  assert.equal(clean.certainty, "slide", "a quote that settles it alone");
  assert.equal(normalizeQuote("  A,  b! "), "a b");
});

test("checkVerdict: slides it did not read are dropped, lists are capped, the trap follows the cards' rules", () => {
  const v = checkVerdict(
    {
      ...GOOD,
      certainty: "maybe",
      on_slides: [{ text: "No single drug clears both liver and blood stages", slides: [20, 99] }],
      interpretation: Array.from({ length: 5 }, (_, i) => ({ text: `נימוק מספר ${i}`, slides: [31, 5] })),
      trap: { front: "בלי סימן שאלה", back: "x", slides: [23] },
    },
    slides,
  )!;
  assert.deepEqual(v.on_slides[0].slides, [20]);
  assert.equal(v.interpretation.length, 3);
  assert.deepEqual(v.interpretation[0].slides, [31]);
  assert.equal(v.certainty, "unclear", "an unknown certainty is 'unclear'");
  assert.equal(v.trap, null, "a front without a question mark is no card");
  assert.ok(trapOk({ front: "למה לא?", back: "כי" }));
  assert.ok(!trapOk({ front: "מה {{c1::x}}?", back: "y" }), "no cloze");
  assert.deepEqual(checkVerdict({ ...GOOD, trap: { ...GOOD.trap!, slides: [] } }, slides)!.trap!.slides, [23], "a trap with no slides takes its answer's tag");
  assert.equal(checkVerdict({ ...GOOD, summary: "קצר" }, slides), null, "no summary: no verdict");
});

/* ── The op ── */

// The schema check is remembered once it passes (per instance), so this comes first.
test("var: without section V, 503 schema and no call", async () => {
  db.schema = { ...REQUIRED_SCHEMA };
  assert.deepEqual(await answer(await varOf()), { status: 503, body: { error: "schema" } });
  assert.equal(restCalls("/rest/v1/rpc/study_dispute_judge_begin").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("var: the hold, then one reservation, one call, one settle; the verdict checked and saved with the key", async () => {
  replies.push(reply(JSON.stringify(GOOD)));
  const res = await answer(await varOf());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(order(), ["read study_disputes", "dispute_judge_begin", "reserve", "model", "settle", "dispute_verdict"]);
  const hold = restCalls("/rest/v1/rpc/study_dispute_judge_begin")[0];
  assert.deepEqual(JSON.parse(hold.body), { p_dispute: DISPUTE, p_key: KEY });
  assert.ok(hold.auth?.endsWith(TOKEN), "with the member's token");
  const r = JSON.parse(restCalls("/rest/v1/rpc/study_reserve")[0].body);
  assert.deepEqual(
    { kind: r.p_kind, ref: r.p_ref, lecture: r.p_lecture, group: r.p_group, daily: r.p_daily, share: r.p_share, member: r.p_member_share, key: r.p_key },
    { kind: "var", ref: DISPUTE, lecture: LECTURE, group: GROUP, daily: POLICY.var.daily, share: 0.8, member: 0.4, key: KEY },
  );
  assert.ok(r.p_estimate > 0.03 && r.p_estimate < 0.2, `about the approved ≈ $0.08-0.13: ${r.p_estimate}`);
  const body = JSON.parse(modelCalls()[0].body) as Record<string, any>;
  assert.equal(body.model, MODEL);
  assert.equal(body.max_tokens, VAR_MAX_TOKENS);
  assert.equal(VAR_MAX_TOKENS, 4000);
  assert.deepEqual(body.output_config, { effort: "medium", format: { type: "json_schema", schema: cleanSchema(zodOutputFormat(Verdict).schema as Record<string, unknown>) } });
  assert.equal(body.system[0].text, VAR_SYSTEM);
  const content = body.messages[0].content as Array<Record<string, any>>;
  const text = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  assert.ok(text.includes(`שקף 20: ${slideText(slides[0])}`) && text.includes(`שקף 23: ${slideText(slides[1])}`) && text.includes(`שקף 31: ${slideText(slides[2])}`), "both claims' slides and the paragraph's own tag");
  assert.ok(text.includes("The disputed paragraph:\n<<<\nאף תרופה אחת לא מסלקת גם את שלב הכבד וגם את שלב הדם. [ש' 20, 31]\n>>>"), "the paragraph at its anchor");
  assert.ok(text.includes("Claim A ({ש׳ 20}): אף תרופה") && text.includes("Claim B ({ש׳ 23}): אבל"));
  // The picture of slide 23 (k 1; k 0 is the slide's own render), signed with the member's token.
  const images = content.filter((c) => c.type === "image");
  assert.equal(images.length, 1);
  assert.match(images[0].source.url, /\/storage\/v1\/object\/sign\/study\/.*s23-1\.jpg\?token=t$/);
  assert.ok(restCalls("/storage/v1/object/sign/study")[0].auth?.endsWith(TOKEN));
  const saved = restCalls("/rest/v1/rpc/study_dispute_verdict")[0];
  const sent = JSON.parse(saved.body);
  assert.equal(sent.p_dispute, DISPUTE);
  assert.equal(sent.p_key, KEY);
  assert.equal(sent.p_model, MODEL);
  assert.deepEqual(sent.p_verdict, checkVerdict(GOOD, slides));
  assert.deepEqual(res.body, { verdict: checkVerdict(GOOD, slides) });
  assert.ok(saved.auth?.endsWith(TOKEN));
});

test("var: the members' names never reach the model", async () => {
  replies.push(reply(JSON.stringify(GOOD)));
  await varOf();
  const turn = JSON.stringify(JSON.parse(modelCalls()[0].body).messages);
  assert.ok(!/נועה|איתי|author/.test(turn), "no names, no author ids");
  assert.ok(!modelCalls()[0].body.includes(USER));
});

test("var: busy answers 409 with no reservation and no Anthropic request (review SEC-15)", async () => {
  db.hold = "busy";
  assert.deepEqual(await answer(await varOf()), { status: 409, body: { error: "busy" } });
  assert.equal(restCalls("/rest/v1/rpc/study_reserve").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("var: not ready, not found and a missing id answer before the hold", async () => {
  const cases: Array<[() => void, number, string]> = [
    [() => (db.dispute!.claim_b = null), 409, "not ready"],
    [() => (db.dispute!.state = "judged"), 409, "not ready"],
    [() => (db.dispute = null), 404, "dispute not found"],
  ];
  for (const [arrange, status, error] of cases) {
    log = [];
    db.dispute = fresh();
    arrange();
    assert.deepEqual(await answer(await varOf()), { status, body: { error } }, error);
    assert.equal(restCalls("/rest/v1/rpc/study_dispute_judge_begin").length, 0);
    assert.equal(modelCalls().length, 0);
  }
  log = [];
  assert.deepEqual(await answer(await varOf({ disputeId: "not-a-uuid" })), { status: 400, body: { error: "disputeId required" } });
  assert.deepEqual(log.filter((l) => !l.path.includes("study_schema")), [], "nothing asked");
  db.dispute = fresh();
  db.hold = "not ready";
  assert.deepEqual(await answer(await varOf()), { status: 409, body: { error: "not ready" } }, "the database's own word");
});

test("var: the budget's refusals answer before any call; a refusal is settled, then 422; no verdict, 502", async () => {
  for (const [code, status] of [
    ["daily_limit", 429],
    ["budget", 402],
    ["member_share", 402],
  ] as const) {
    log = [];
    db.reserve = [{ status: 400, body: pgError(code) }];
    assert.deepEqual(await answer(await varOf()), { status, body: { error: code } }, code);
    assert.equal(modelCalls().length, 0);
  }
  log = [];
  replies.push(reply("", "refusal"));
  assert.deepEqual(await answer(await varOf()), { status: 422, body: { error: "refusal" } });
  assert.equal(restCalls("/rest/v1/rpc/study_settle").length, 1, "settled");
  assert.equal(restCalls("/rest/v1/rpc/study_dispute_verdict").length, 0, "nothing saved");
  for (const text of ['{"certainty":"slide"', JSON.stringify({ ...GOOD, summary: "x" })]) {
    log = [];
    replies.push(reply(text, text.endsWith("}") ? "end_turn" : "max_tokens"));
    assert.deepEqual(await answer(await varOf()), { status: 502, body: { error: "truncated" } }, text.slice(0, 30));
    assert.equal(restCalls("/rest/v1/rpc/study_settle").length, 1);
    assert.equal(restCalls("/rest/v1/rpc/study_dispute_verdict").length, 0);
  }
  log = [];
  replies.push(reply(JSON.stringify(GOOD)));
  db.save = "bad verdict";
  assert.deepEqual(await answer(await varOf()), { status: 502, body: { error: "truncated" } }, "the database's second check");
});
