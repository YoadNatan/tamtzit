import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import work from "../../api/study/work.js";
import { type AheadClaim, aheadParts, AHEAD_REF } from "./bank.js";
import { POLICY } from "./budget.js";
import { MODEL } from "./claude.js";
import { POINTS_SYSTEM } from "./prompts/points.js";
import { OP_SCHEMA, REQUIRED_SCHEMA } from "./study.js";

/* Package B as Yoad's decision 2 (17 Nov 2026) redefines it: the points to
 * know read ahead once server writing finishes a summary (server/study/bank.ts,
 * api/study/work.ts's {"points": lecture}). Through work.ts, bundled, with
 * @vercel/functions' request context stubbed, against a local PostgREST and a
 * local Anthropic replaying SSE: no network, no key, no database. The SQL
 * side (the kick, the claim of only untried texts, the release, the worker
 * path of the save) is supabase/tests/study.sql's BA checks. Synthetic text. */

const KEY = "k-0123456789abcdef0123456789abcdef";
const LECTURE = "11111111-0000-4000-8000-000000000001";
const GROUP = "22222222-0000-4000-8000-000000000002";
const OLD_ID = "88888888-0000-4000-8000-000000000001";

/* ── The request context @vercel/functions reads ── */
let pending: Promise<unknown>[] = [];
(globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] = {
  get: () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p), deadline: Date.now() + 300_000 }),
};
const settleAll = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

const MD = [
  ["## מחזור החיים", "ה-dormozoite ישן בכבד, ורק Mockaquine פועלת עליו. [ש' 5]", "לפני Mockaquine בודקים FXR. [ש' 7]"].join("\n\n"),
  ["## מנגנונים", "Testoquine מצטברת בוואקואולה של הטפיל. [ש' 15]"].join("\n\n"),
];
const claimOf = (): AheadClaim => ({
  group_id: GROUP,
  slides: Array.from({ length: 24 }, (_, i) => i + 1),
  parts: [
    {
      part_idx: 0,
      heading: "מחזור החיים",
      slide_from: 1,
      slide_to: 12,
      md5: "a".repeat(32),
      markdown: MD[0],
      old: [{ id: OLD_ID, kind: "indication", subject: "Mockaquine", text: "רק Mockaquine פועלת על ה-dormozoite." }],
    },
    { part_idx: 1, heading: "מנגנונים", slide_from: 13, slide_to: 24, md5: "b".repeat(32), markdown: MD[1], old: [] },
  ],
});
const P0 = { part: 0, para: 1, kind: "indication", subject: "Mockaquine", text: "רק Mockaquine פועלת על ה-dormozoite בכבד.", slides: [5], red_flag: false, weight: 3 };
const P0B = { part: 0, para: 2, kind: "contra", subject: "Mockaquine", text: "לפני Mockaquine בודקים FXR.", slides: [7], red_flag: true, weight: 3 };
const P1 = { part: 1, para: 1, kind: "mechanism", subject: "Testoquine", text: "Testoquine מצטברת בוואקואולה של הטפיל.", slides: [15], red_flag: false, weight: 2 };

/* ── PostgREST, scripted ── */
type Logged = { who: "rest" | "anthropic"; path: string; auth: string | null; body: any };
let log: Logged[] = [];
let REST = "";
let ANTHROPIC = "";
let schemaAnswer: unknown = {};
let claim: AheadClaim | null = null;
let reserveRefusal: string | null = null;
let nextReservation = 500;
type Reply = { points?: unknown[]; stop?: string };
let replies = new Map<number, Reply>();

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

const rest = createServer(async (req, res) => {
  const raw = await readAll(req);
  const p = new URL(req.url ?? "/", "http://x").pathname;
  const a = raw ? JSON.parse(raw) : {};
  log.push({ who: "rest", path: p, auth: req.headers.authorization ?? null, body: a });
  if (p === "/rest/v1/rpc/study_schema") return send(res, 200, schemaAnswer);
  if (p === "/rest/v1/rpc/study_points_ahead_claim") return send(res, 200, claim);
  if (p === "/rest/v1/rpc/study_reserve") return reserveRefusal ? send(res, 400, pgError(reserveRefusal)) : send(res, 200, nextReservation++);
  if (p === "/rest/v1/rpc/study_settle") return send(res, 200, true);
  if (p === "/rest/v1/rpc/study_points_save") return send(res, 200, (a.p_points as unknown[]).length);
  if (p === "/rest/v1/rpc/study_points_fail") return send(res, 200, null);
  if (p === "/rest/v1/rpc/study_points_ahead_release") return send(res, 200, (a.p_parts as unknown[]).length);
  if (p === "/rest/v1/rpc/study_claim") return send(res, 200, []);
  send(res, 404, { message: `unmocked ${req.method} ${p}` });
});

/* ── Anthropic, replaying the points' event streams ── */
const sse = (e: { type: string }) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const stream = (text: string, stop: string) => {
  let deltas = "";
  for (let i = 0; i < text.length; i += 17) deltas += sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 17) } } as { type: string });
  return [
    sse({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } } } as { type: string }),
    sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } as { type: string }),
    deltas,
    sse({ type: "content_block_stop", index: 0 }),
    sse({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 400 } } as { type: string }),
    sse({ type: "message_stop" }),
  ].join("");
};
const anthropic = createServer(async (req, res) => {
  const raw = await readAll(req);
  const body = JSON.parse(raw) as { system: Array<{ text: string }>; messages: Array<{ content: Array<{ text: string }> }> };
  log.push({ who: "anthropic", path: req.url ?? "", auth: null, body });
  assert.equal(body.system[0].text, POINTS_SYSTEM, "only the points are read: no question or card is written");
  const part = Number(/\n\nPart (\d+)/.exec(body.messages[0].content[0].text)?.[1] ?? -1);
  const r = replies.get(part) ?? { points: [] };
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(stream(JSON.stringify({ points: r.points ?? [] }), r.stop ?? "end_turn"));
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
beforeEach(() => {
  Object.assign(process.env, {
    VITE_SUPABASE_URL: REST,
    VITE_SUPABASE_ANON_KEY: "anon-key",
    ANTHROPIC_BASE_URL: ANTHROPIC,
    ANTHROPIC_API_KEY: "test-key",
    STUDY_WORKER_KEY: KEY,
    STUDY_MONTHLY_USD: "33",
  });
  log = [];
  pending = [];
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 2, B: 1 };
  claim = claimOf();
  reserveRefusal = null;
  nextReservation = 500;
  replies = new Map([
    [0, { points: [P0, P0B] }],
    [1, { points: [P1] }],
  ]);
});

const kick = (body: unknown, auth = `Bearer ${KEY}`) =>
  work.fetch(new Request("http://localhost/api/study/work", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) }));
const rpcs = (name: string) => log.filter((l) => l.who === "rest" && l.path === `/rest/v1/rpc/${name}`);
const modelCalls = () => log.filter((l) => l.who === "anthropic");

test("work.ts's bank branch needs section B (OP_SCHEMA.bank), the points' kind is optional (80% of the cap)", () => {
  assert.deepEqual(OP_SCHEMA.bank, { B: 1 });
  assert.equal(POLICY.points.share, 0.8);
  assert.equal(AHEAD_REF, "ahead");
});

// First: assertSchema remembers a database that passed, for the life of the instance.
test("a database without section B answers 503 schema and claims nothing; a bad body 400; a wrong key 401", async () => {
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 2 };
  const res = await kick({ points: LECTURE });
  assert.equal(res.status, 503);
  assert.deepEqual(rpcs("study_points_ahead_claim"), []);
  log = [];
  assert.equal((await kick({ points: "nope" })).status, 400);
  assert.equal((await kick({ points: LECTURE }, `Bearer ${KEY}x`)).status, 401);
  assert.deepEqual(log, [], "the database is never asked");
});

test("a written lecture's points are read ahead: claimed with the key alone, reserved (kind points), read part by part, each part saved", async () => {
  const res = await kick({ points: LECTURE });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { claimed: true, parts: 2 });
  await settleAll();
  // The worker has no member: every request carries the anon key only, and every RPC the server key.
  for (const l of log.filter((x) => x.who === "rest")) assert.equal(l.auth, "Bearer anon-key", l.path);
  for (const l of log.filter((x) => x.who === "rest" && x.path !== "/rest/v1/rpc/study_schema")) assert.equal(l.body.p_key, KEY, l.path);
  assert.deepEqual(rpcs("study_points_ahead_claim").map((l) => l.body), [{ p_lecture: LECTURE, p_key: KEY }]);
  const reserves = rpcs("study_reserve").map((l) => l.body);
  assert.equal(reserves.length, 2, "one reservation per call");
  assert.ok(reserves.every((r) => r.p_kind === "points" && r.p_group === GROUP && r.p_lecture === LECTURE && r.p_cap === 33 && r.p_share === 0.8), JSON.stringify(reserves));
  assert.equal(reserves[0].p_ref, AHEAD_REF, "the read's first call");
  assert.equal(reserves[1].p_ref, "part 1");
  assert.equal(rpcs("study_settle").length, 2, "each call settled");
  assert.equal(modelCalls().length, 2, "one call per part");
  const saves = rpcs("study_points_save").map((l) => l.body).sort((a, b) => a.p_part - b.p_part);
  assert.deepEqual(
    saves.map((s) => [s.p_part, s.p_md5, s.p_points.length]),
    [
      [0, "a".repeat(32), 2],
      [1, "b".repeat(32), 1],
    ],
  );
  assert.equal(saves[0].p_points.find((p: { kind: string }) => p.kind === "indication").id, OLD_ID, "the point read again keeps its id");
  assert.deepEqual(rpcs("study_points_fail"), []);
  assert.deepEqual(rpcs("study_points_ahead_release"), []);
});

test("nothing to read ahead (the switch, a live read, nothing new): 200, nothing reserved, no model call", async () => {
  claim = null;
  const res = await kick({ points: LECTURE });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { claimed: false });
  await settleAll();
  assert.deepEqual(rpcs("study_reserve"), []);
  assert.equal(modelCalls().length, 0);
});

test("at the optional features' line the ledger refuses: the claim is given back quietly, nothing fails, no model call", async () => {
  for (const code of ["reserve", "budget", "off"]) {
    log = [];
    reserveRefusal = code;
    const res = await kick({ points: LECTURE });
    assert.equal(res.status, 200, code);
    assert.deepEqual(await res.json(), { claimed: false, skipped: code });
    await settleAll();
    assert.deepEqual(rpcs("study_points_ahead_release").map((l) => l.body), [{ p_lecture: LECTURE, p_parts: [0, 1], p_key: KEY }]);
    assert.deepEqual(rpcs("study_points_fail"), [], "nothing shown as failed");
    assert.equal(modelCalls().length, 0);
  }
});

test("a part the reply did not finish fails with its reason (the setup screen offers it again); the other is saved", async () => {
  replies.set(1, { points: [P1], stop: "max_tokens" });
  const res = await kick({ points: LECTURE });
  assert.equal(res.status, 202);
  await settleAll();
  assert.deepEqual(rpcs("study_points_save").map((l) => l.body.p_part), [0]);
  const fails = rpcs("study_points_fail").map((l) => l.body);
  assert.deepEqual(
    fails.map((f) => [f.p_parts, f.p_error]),
    [[[1], "truncated"]],
  );
});

test("a writer's kick ({lectureId}) still goes to the writer, not to the read ahead", async () => {
  const res = await kick({ lectureId: LECTURE });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { claimed: false });
  assert.equal(rpcs("study_claim").length, 1);
  assert.deepEqual(rpcs("study_points_ahead_claim"), []);
});

test("aheadParts: the claim's text numbered as SummaryView numbers it, the slides' numbers, the earlier points by part", () => {
  const { parts, old, lecture } = aheadParts(claimOf(), LECTURE);
  assert.deepEqual(
    parts.map((p) => [p.part_idx, p.blocks.length, p.md5]),
    [
      [0, 3, "a".repeat(32)],
      [1, 2, "b".repeat(32)],
    ],
  );
  assert.equal(lecture.id, LECTURE);
  assert.equal(lecture.group_id, GROUP);
  assert.deepEqual(
    lecture.slides.map((s) => s.n),
    Array.from({ length: 24 }, (_, i) => i + 1),
  );
  assert.equal(old.get(0)?.[0].id, OLD_ID);
  assert.deepEqual(old.get(1), []);
});
