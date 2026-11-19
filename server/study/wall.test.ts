import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { blockSources } from "../../shared/study/edits.js";
import { POLICY } from "./budget.js";
import { type Spend } from "./claude.js";
import { mnemonicSource } from "./mnemonic.js";
import { mnemonicOp, wallCheckOp } from "./ops/wall.js";
import { checkRequest, draftsRequest, WALL_CHECK_SYSTEM, WALL_DRAFTS_SYSTEM } from "./prompts/wall.js";
import { deckText, errorText, HttpError, json, MODEL, OP_SCHEMA, slideText, tidyMarkdown, type Lecture, type StoredSlide } from "./study.js";
import { CHECK_SCHEMA, checkDraft, checkFact, DRAFTS_SCHEMA, draftSlides, paragraphHash, streamDrafts, TECHNIQUES, type DraftItem } from "./wall.js";

/* J-2 (spec §12.5.J; the fun design's J-2, J-5 and J-6): the wall's server
 * code in Node. The prompts against the addendum's own text; the schemas
 * sent; checkDraft and checkFact on stand-ins (a repeated technique, a
 * 250-character hook, a number not in the paragraph, "דמיין" → dropped);
 * the stream through 40 random chunkings; and both ops as the router calls
 * them, against local mocks of PostgREST, Auth and Anthropic: a second
 * request for the same text answers "saved" with NO Anthropic request and
 * no reservation; a corrected paragraph (another hash) asks again; one
 * reserve before and one settle after a paid call (kind "mnemonic", 5 a
 * day; kind "wall_check", 20 a day), the save and the check with the server
 * key; wall_check's request bytes, its hold before the reservation, and a
 * failed call giving the entry back unchecked. The drugs do not exist. No
 * key, no network. */

const ADDENDUM = readFileSync(join(process.cwd(), "docs/study/spec/addendum/addendum.md"), "utf8");
const J = ADDENDUM.slice(ADDENDUM.indexOf("#### 12.5.J"), ADDENDUM.indexOf("#### 12.5.H"));
const fenced = (after: string, lang: string) => {
  const i = J.indexOf(after);
  assert.ok(i >= 0, `not found: ${after}`);
  const m = new RegExp("```" + lang + "\\n([\\s\\S]*?)\\n```").exec(J.slice(i));
  assert.ok(m, `the ${lang} block after ${after}`);
  return m[1];
};

// ── The fixtures ──

const KEY = "k-0123456789abcdef0123456789abcdef";
const GROUP = "22222222-0000-4000-8000-000000000002";
const USER = "33333333-0000-4000-8000-000000000003";
const LECTURE = "aaaaaaaa-0000-4000-8000-00000000000a";
const AID = "bbbbbbbb-0000-4000-8000-00000000000b";
const slide = (n: number, title: string, lines: string[]): StoredSlide => ({ n, title, lines: [title, ...lines], tables: [], notes: "", figures: [] });
const slides: StoredSlide[] = [
  slide(1, "מבוא", ["שתי תרופות לדוגמה: Fabrimycin ו-Placebozole"]),
  slide(16, "Fabrimycin: בטיחות", ["Teratogenic (Black Box)", "אמצעי מניעה בטיפול ועוד 5 חודשים אחריו", "t½ 7-31 ימים"]),
  slide(17, "Placebozole", ["פעילה רק בחלל המעי"]),
];
const lecture: Lecture = { id: LECTURE, group_id: GROUP, course: "פרמקולוגיה לדוגמה", title: "Fabrimycin ו-Placebozole", lecturer: "", lecture_date: "2026-11-01", source_kind: "pptx", slides };
const deck = deckText(lecture);
const PARAGRAPH = "**Fabrimycin:** טרטוגנית (Black Box): אמצעי מניעה בטיפול ועוד 5 חודשים אחריו. ה-t½ שלה 7-31 ימים. [ש' 16]";
const PART = `## Fabrimycin

${PARAGRAPH}

- **Placebozole:** פעילה רק בחלל המעי. [ש' 17]

---`;
const blocks = blockSources(tidyMarkdown(PART));
const PARA = blocks.findIndex((b) => b.text.startsWith("**Fabrimycin:**"));
const src = mnemonicSource(blocks, PARA, slides, slideText)!;
const SOURCE = src.target + "\n" + src.slides;

const d = (technique: string, hook: string, decode: string): DraftItem => ({ technique, hook, decode });
const GOOD = [
  d("משחק מילים", "Fabrimycin = מילואים: אמצעי מניעה עוד 5 חודשים אחרי השחרור.", "מילואים · 5 חודשים אחרי הטיפול"),
  d("חרוז", "Fabrimycin בהיריון? אין דיון! וחמישה חודשים אחרי הסיום.", "היריון · חמישה חודשים אחרי"),
  d("סצנה הזויה", "Fabrimycin היא אורחת שלא הולכת: המסיבה נגמרה, והיא עוד על הספה.", "t½ ארוך 7-31 ימים · נשארת בגוף"),
];
const FACT = "אמצעי מניעה בטיפול ועוד 5 חודשים אחריו [ש' 16]";

// ── SSE ──
type Ev = Record<string, unknown>;
const startEv = (): Ev => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1500, output_tokens: 1 } },
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
const endEvs = (stop: string): Ev[] => [
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, stop_details: null }, usage: { output_tokens: 900 } },
  { type: "message_stop" },
];
const sse = (events: Ev[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
function fake(events: () => Ev[]) {
  const sent: Array<Record<string, any>> = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(sse(events()), { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_t" } });
  };
  return { client: new Anthropic({ apiKey: "test-key", fetch: fetch as typeof globalThis.fetch, maxRetries: 0 }), sent };
}
const spends: Spend[] = [];
const ledger = async (s: Spend) => void spends.push(s);
const lines = (out: string[]) =>
  out
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, any>);

// ── 1. The prompts and the schemas are the addendum's ──

test("WALL_DRAFTS_SYSTEM, draftsRequest() and WALL_CHECK_SYSTEM are the addendum's text, byte for byte", () => {
  assert.equal(WALL_DRAFTS_SYSTEM, fenced("**`WALL_DRAFTS_SYSTEM`**", "text"));
  assert.equal(WALL_CHECK_SYSTEM, fenced("**`WALL_CHECK_SYSTEM`**", "text"));
  const code = readFileSync(join(process.cwd(), "server/study/prompts/wall.ts"), "utf8");
  assert.ok(code.includes(fenced("**`WALL_DRAFTS_SYSTEM`**", "ts")), "draftsRequest as printed");
});

test("the schemas sent: {fact, drafts:[{technique, hook, decode}]} and {ok, problem}; nothing optional, no unions or enums", () => {
  const s = DRAFTS_SCHEMA as any;
  assert.deepEqual(s.required, ["fact", "drafts"]);
  assert.deepEqual(s.properties.drafts.items.required, ["technique", "hook", "decode"]);
  assert.deepEqual((CHECK_SCHEMA as any).required, ["ok", "problem"]);
  assert.equal((CHECK_SCHEMA as any).properties.ok.type, "boolean");
  for (const x of [DRAFTS_SCHEMA, CHECK_SCHEMA]) assert.ok(!/"anyOf"|"type":\[|"enum"|\$schema|minimum|maximum/.test(JSON.stringify(x)));
  assert.deepEqual([...TECHNIQUES], ["משחק מילים", "חרוז", "סצנה הזויה"]);
});

test("the request: the lecture, the part, the paragraph and its slide, and nothing more", () => {
  const req = draftsRequest({ lectureTitle: lecture.title, course: lecture.course, partHeading: "Fabrimycin", target: src.target, slides: src.slides });
  assert.ok(req.startsWith(`The lecture: «${lecture.title}» (${lecture.course}). From the part «Fabrimycin».\n\nThe paragraph:\n\n<<<\n${PARAGRAPH}\n>>>`));
  assert.ok(req.includes("[שקף 16]") && !req.includes("פעילה רק בחלל המעי"), "no slide the paragraph does not cite");
  assert.ok(req.endsWith("Give the deciding fact and the three drafts."));
  const c = checkRequest({ paragraph: "p", slides: "", aid: "a", fact: "f" });
  assert.equal(c, "The paragraph:\n\n<<<\np\n>>>\n\nIt cites no slide.\n\nThe aid:\n\n<<<\na\n>>>\n\nThe fact it says it encodes:\n\n<<<\nf\n>>>\n\nIs the aid ok?");
});

// ── 2. The checks ──

test("checkDraft: the three stand-ins pass; a 250-character hook, a number not in the paragraph, \"דמיין\", another technique fail", () => {
  for (const g of GOOD) assert.deepEqual(checkDraft(g, SOURCE, deck), { ok: true, item: g }, g.hook);
  const why = (x: DraftItem) => {
    const r = checkDraft(x, SOURCE, deck);
    return r.ok ? "ok" : r.why;
  };
  assert.equal(why({ ...GOOD[0], hook: "א".repeat(250) }), "hook length");
  assert.equal(why({ ...GOOD[0], hook: "Fabrimycin: 6 חודשים אחרי" }), "number 6 not in the paragraph");
  assert.equal(why({ ...GOOD[2], hook: "דמיין את Fabrimycin על הספה" }), "gendered");
  assert.equal(why({ ...GOOD[2], hook: "דמיינו את Fabrimycin על הספה" }), "ok", "the plural passes");
  assert.equal(why({ ...GOOD[0], technique: "ראשי תיבות" }), "technique");
  assert.equal(why({ ...GOOD[0], decode: "קצר" }), "decode length");
  assert.equal(why({ ...GOOD[0], decode: GOOD[0].decode + " · Placebozole במעי" }), "term Placebozole is from another part of the lecture");
  assert.equal(why({ ...GOOD[0], hook: "<b>Fabrimycin</b> מילואים" }), "markup");
  assert.equal(why({ ...GOOD[0], hook: "Fabrimycin מילואים 💊" }), "emoji");
});

test("checkFact: in the material, with the paragraph's slide tag (added when left out); a foreign term or number fails", () => {
  assert.deepEqual(checkFact(FACT, src.target, SOURCE), { ok: true, fact: FACT });
  assert.deepEqual(checkFact("אמצעי מניעה ועוד 5 חודשים", src.target, SOURCE), { ok: true, fact: "אמצעי מניעה ועוד 5 חודשים [ש׳ 16]" });
  assert.deepEqual(checkFact("Tinidazole טרטוגנית [ש' 16]", src.target, SOURCE), { ok: false, why: "term Tinidazole not in the paragraph" });
  assert.deepEqual(checkFact("6 חודשים [ש' 16]", src.target, SOURCE), { ok: false, why: "number 6 not in the paragraph" });
  assert.deepEqual(checkFact("קצר", src.target, SOURCE), { ok: false, why: "fact length" });
  assert.deepEqual(draftSlides(FACT, src.target, [1, 16, 17]), [16]);
  assert.deepEqual(draftSlides("בלי תג", "שורה [ש' 16-17]", [16]), [16], "only the lecture's own slides");
});

test("paragraphHash: sha256 of the trimmed text, so a corrected paragraph has another", async () => {
  assert.equal(await paragraphHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await paragraphHash("  abc\n"), await paragraphHash("abc"));
  assert.notEqual(await paragraphHash(PARAGRAPH), await paragraphHash(PARAGRAPH.replace("5 חודשים", "6 חודשים")));
});

// ── 3. The stream ──

test("the stream: three drafts shown, a repeated technique and a bad one skipped, through 40 random chunkings; one settle each", async () => {
  const doc = JSON.stringify({ fact: FACT, drafts: [GOOD[0], { ...GOOD[0], hook: "שוב משחק מילים על Fabrimycin" }, GOOD[1], { ...GOOD[2], hook: "דמיין" }, GOOD[2]] });
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  spends.length = 0;
  for (let trial = 0; trial < 40; trial++) {
    const f = fake(() => [startEv(), ...textEvs(doc, () => 1 + Math.floor(rnd() * 17)), ...endEvs("end_turn")]);
    const out: string[] = [];
    const r = await streamDrafts({ client: f.client, ref: "0.1", request: "x", target: src.target, source: SOURCE, lectureText: deck, stopAt: Date.now() + 60_000, write: (l) => out.push(l), ledger });
    assert.deepEqual(lines(out).map((l) => l.t), ["d", "skip", "d", "skip", "d"]);
    assert.deepEqual(r.drafts, GOOD);
    assert.equal(r.fact, FACT);
    assert.equal(r.rejected, 2);
  }
  assert.equal(spends.length, 40);
});

test("the call: json_schema, effort medium, max_tokens 3000, the plain system, the fallback", async () => {
  const f = fake(() => [startEv(), ...textEvs(JSON.stringify({ fact: FACT, drafts: GOOD }), () => 9), ...endEvs("end_turn")]);
  await streamDrafts({ client: f.client, ref: "0.1", request: "req", target: src.target, source: SOURCE, lectureText: deck, stopAt: Date.now() + 60_000, write: () => undefined, ledger });
  const b = f.sent[0];
  assert.equal(b.model, "claude-opus-5-5");
  assert.equal(b.max_tokens, 3000);
  assert.deepEqual(b.output_config, { effort: "medium", format: { type: "json_schema", schema: DRAFTS_SCHEMA } });
  assert.deepEqual(b.system, [{ type: "text", text: WALL_DRAFTS_SYSTEM }]);
  assert.deepEqual(b.messages, [{ role: "user", content: "req" }]);
  assert.equal(b.fallbacks, "default");
});

// ── 4. The ops, as the router calls them, against local mocks ──

type Logged = { who: "rest" | "anthropic"; path: string; body: string };
let log: Logged[] = [];
const db = {
  part: { idx: 0, title: "Fabrimycin", markdown: PART, status: "ready", gen: 2 } as Record<string, unknown>,
  drafts: [] as Array<Record<string, unknown>>,
  reserve: [] as Array<{ status: number; body: unknown }>,
  uses: 1,
  begin: null as null | { status: number; body: unknown },
  done: [] as Array<Record<string, unknown>>,
  /** study_aid_drafts_begin's holds, by "<anchor>:<hash>" (review SEC4-3). */
  holds: new Set<string>(),
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
const BEGUN = { lecture_id: LECTURE, part: 0, anchor: PARA, kind: "line", body: "Fabrimycin = מילואים: 5 חודשים אחרי.", fact: FACT, slides: [16], group_id: GROUP };
const rest = createServer(async (req, res) => {
  const body = await readAll(req);
  const url = new URL(req.url ?? "/", "http://x");
  const q = url.searchParams;
  const p = url.pathname;
  log.push({ who: "rest", path: p, body: p === "/rest/v1/study_aid_drafts" ? url.search : body });
  if (p === "/auth/v1/user") return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated" });
  if (p === "/rest/v1/rpc/study_reserve") return db.reserve.length ? send(res, db.reserve[0].status, db.reserve.shift()!.body) : send(res, 200, 77);
  if (p === "/rest/v1/rpc/study_settle") return send(res, 200, true);
  if (p === "/rest/v1/rpc/study_my_uses_today") return send(res, 200, db.uses);
  if (p === "/rest/v1/study_lectures") return send(res, 200, q.get("id") === `eq.${LECTURE}` ? [lecture] : []);
  if (p === "/rest/v1/study_sections") return send(res, 200, q.get("idx") === `eq.${db.part.idx}` && q.get("lecture_id") === `eq.${LECTURE}` ? [db.part] : []);
  if (p === "/rest/v1/study_aid_drafts")
    return send(
      res,
      200,
      db.drafts.filter((r) => q.get("src_hash") === `eq.${r.src_hash}` && q.get("anchor") === `eq.${r.anchor}`),
    );
  if (p === "/rest/v1/rpc/study_aid_drafts_save") {
    const a = JSON.parse(body);
    const row = { id: "dddddddd-0000-4000-8000-0000000000d1", src_hash: a.p_hash, anchor: a.p_anchor, fact: a.p_fact, slides: a.p_slides, drafts: a.p_drafts };
    db.drafts.push(row);
    db.holds.delete(`${a.p_anchor}:${a.p_hash}`);
    return send(res, 200, row.id);
  }
  if (p === "/rest/v1/rpc/study_aid_drafts_begin") {
    const a = JSON.parse(body);
    const k = `${a.p_anchor}:${a.p_hash}`;
    if (db.drafts.some((r) => r.anchor === a.p_anchor && r.src_hash === a.p_hash)) return send(res, 200, "saved");
    if (db.holds.has(k)) return send(res, pgError("busy").status, pgError("busy").body);
    db.holds.add(k);
    return send(res, 200, "held");
  }
  if (p === "/rest/v1/rpc/study_aid_drafts_end") {
    const a = JSON.parse(body);
    db.holds.delete(`${a.p_anchor}:${a.p_hash}`);
    return send(res, 200, null);
  }
  if (p === "/rest/v1/rpc/study_aid_check_begin") return db.begin ? send(res, db.begin.status, db.begin.body) : send(res, 200, BEGUN);
  if (p === "/rest/v1/rpc/study_aid_check_done") {
    db.done.push(JSON.parse(body));
    return send(res, 200, null);
  }
  send(res, 404, { message: `unmocked ${req.method} ${p}` });
});
const anthropicServer = createServer(async (req, res) => {
  log.push({ who: "anthropic", path: req.url ?? "", body: await readAll(req) });
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
  db.part = { idx: 0, title: "Fabrimycin", markdown: PART, status: "ready", gen: 2 };
  db.drafts = [];
  db.reserve = [];
  db.uses = 1;
  db.begin = null;
  db.done = [];
  db.holds = new Set();
  anthropicReplies.length = 0;
});
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const call = async (op: "mnemonic" | "wall_check", body: Record<string, unknown>) => {
  const req = new Request("http://localhost/api/study/ai", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ op, ...body }),
  });
  try {
    return await (op === "mnemonic" ? mnemonicOp : wallCheckOp)(req, { op, ...body }, Date.now());
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
const reply = (doc: object, stop = "end_turn") => [startEv(), ...textEvs(JSON.stringify(doc), () => 13), ...endEvs(stop)];

test("op mnemonic: both ops need section J (OP_SCHEMA)", () => {
  assert.deepEqual(OP_SCHEMA.mnemonic, { J: 1 });
  assert.deepEqual(OP_SCHEMA.wall_check, { J: 1 });
});

test("op mnemonic: reserved (mnemonic, <part>.<anchor>, 5 a day, the key) before the call, settled after; drafts saved with the key; done", async () => {
  anthropicReplies.push(reply({ fact: FACT, drafts: GOOD }));
  const res = await call("mnemonic", { lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 });
  assert.equal(res.status, 200);
  const { lines: ls, error } = await readStream(res);
  assert.equal(error, null);
  assert.deepEqual(ls.map((l) => l.t), ["d", "d", "d", "done"]);
  assert.deepEqual(ls[3], { t: "done", id: "dddddddd-0000-4000-8000-0000000000d1", fact: FACT, slides: [16], made: 3, rejected: 0, left: POLICY.mnemonic.daily! - 1, unsettled: 0 });
  const order = log
    .filter((l) => l.who === "anthropic" || ["/rest/v1/rpc/study_aid_drafts_begin", "/rest/v1/rpc/study_reserve", "/rest/v1/rpc/study_settle", "/rest/v1/rpc/study_aid_drafts_save"].includes(l.path))
    .map((l) => (l.who === "anthropic" ? "model" : l.path.split("study_").pop()));
  assert.deepEqual(order, ["aid_drafts_begin", "reserve", "model", "settle", "aid_drafts_save"], "the hold before the reservation (review SEC4-3)");
  const h = JSON.parse(calls("/rest/v1/rpc/study_aid_drafts_begin")[0].body);
  assert.deepEqual({ ...h, p_hash: h.p_hash.length }, { p_lecture: LECTURE, p_part: 0, p_anchor: PARA, p_hash: 64, p_key: KEY });
  assert.equal(db.holds.size, 0, "saving clears the hold");
  const r = JSON.parse(calls("/rest/v1/rpc/study_reserve")[0].body);
  assert.deepEqual(
    { ...r, p_estimate: typeof r.p_estimate },
    { p_group: GROUP, p_lecture: LECTURE, p_kind: "mnemonic", p_ref: `0.${PARA}`, p_estimate: "number", p_cap: 33, p_share: 0.8, p_member_share: 0.4, p_daily: 5, p_daily_ref: null, p_key: KEY },
  );
  assert.ok(r.p_estimate > 0.05 && r.p_estimate < 0.12, String(r.p_estimate));
  const s = JSON.parse(calls("/rest/v1/rpc/study_aid_drafts_save")[0].body);
  assert.deepEqual(
    { ...s, p_hash: s.p_hash.length },
    { p_lecture: LECTURE, p_part: 0, p_anchor: PARA, p_hash: 64, p_fact: FACT, p_slides: [16], p_drafts: GOOD, p_model: MODEL, p_key: KEY },
  );
  assert.equal(s.p_hash, await paragraphHash(blocks[PARA].text));
  const b = JSON.parse(modelCalls()[0].body);
  assert.equal(b.messages[0].content, draftsRequest({ lectureTitle: lecture.title, course: lecture.course, partHeading: "Fabrimycin", target: src.target, slides: src.slides }));
});

test("op mnemonic: a second request for the same text answers saved, with no Anthropic request and no reservation; a corrected paragraph asks again", async () => {
  anthropicReplies.push(reply({ fact: FACT, drafts: GOOD }));
  await (await call("mnemonic", { lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 })).text();
  log = [];
  const again = await readStream(await call("mnemonic", { lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 }));
  assert.equal(again.error, null);
  assert.deepEqual(again.lines, [{ t: "saved", id: "dddddddd-0000-4000-8000-0000000000d1", fact: FACT, slides: [16], drafts: GOOD, left: POLICY.mnemonic.daily! - 1 }]);
  assert.equal(modelCalls().length, 0, "no Anthropic request");
  assert.equal(calls("/rest/v1/rpc/study_reserve").length, 0, "no reservation: $0, and the day's 5 untouched");
  // The paragraph was corrected: another hash, so new drafts are paid for.
  log = [];
  db.part = { ...db.part, markdown: PART.replace("5 חודשים", "חמישה חודשים"), gen: 3 };
  anthropicReplies.push(reply({ fact: "אמצעי מניעה בטיפול ועוד חמישה חודשים אחריו [ש' 16]", drafts: GOOD.slice(1) }));
  const fresh = await readStream(await call("mnemonic", { lectureId: LECTURE, part: 0, anchor: PARA, gen: 3 }));
  assert.equal(fresh.error, null);
  assert.equal(calls("/rest/v1/rpc/study_reserve").length, 1);
  assert.equal(modelCalls().length, 1);
  assert.equal(db.drafts.length, 2);
});

test("op mnemonic: two phones at once on the same text: one reservation, one model call; the other answers 409 busy (review SEC4-3)", async () => {
  anthropicReplies.push(reply({ fact: FACT, drafts: GOOD }), reply({ fact: FACT, drafts: GOOD }));
  const body = { lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 };
  const [a, b] = await Promise.all([call("mnemonic", body), call("mnemonic", body)]);
  const [ok, busy] = a.status === 200 ? [a, b] : [b, a];
  assert.deepEqual([busy.status, await busy.json()], [409, { error: "busy" }]);
  const { lines: ls, error } = await readStream(ok);
  assert.equal(error, null);
  assert.equal(ls.at(-1)?.t, "done");
  assert.equal(calls("/rest/v1/rpc/study_reserve").length, 1, "one reservation");
  assert.equal(modelCalls().length, 1, "one model call");
  assert.equal(anthropicReplies.length, 1, "the second reply was never asked for");
  // Once saved, a third phone gets the drafts free.
  log = [];
  const third = await readStream(await call("mnemonic", body));
  assert.equal(third.lines[0].t, "saved");
  assert.equal(calls("/rest/v1/rpc/study_reserve").length, 0);
});

test("op mnemonic: drafts saved by another phone between the read and the hold are answered saved, $0", async () => {
  const hash = await paragraphHash(blocks[PARA].text);
  // The first read finds nothing; by the hold, another phone's drafts are saved.
  const realDrafts = db.drafts;
  let reads = 0;
  db.drafts = new Proxy(realDrafts, {
    get(t, k, r) {
      if (k === "filter" && reads++ === 0) return () => [];
      return Reflect.get(t, k, r);
    },
  });
  realDrafts.push({ id: "dddddddd-0000-4000-8000-0000000000d2", src_hash: hash, anchor: PARA, fact: FACT, slides: [16], drafts: GOOD });
  const r = await readStream(await call("mnemonic", { lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 }));
  assert.deepEqual(r.lines.map((l) => [l.t, l.id]), [["saved", "dddddddd-0000-4000-8000-0000000000d2"]]);
  assert.equal(calls("/rest/v1/rpc/study_aid_drafts_begin").length, 1);
  assert.equal(calls("/rest/v1/rpc/study_reserve").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("op mnemonic: the part must be ready, of the same generation, and the block one drafts can be made of", async () => {
  const cases: Array<[() => void, Record<string, unknown>, number, string]> = [
    [() => (db.part.status = "writing"), { part: 0, anchor: PARA, gen: 2 }, 409, "part busy"],
    [() => undefined, { part: 0, anchor: PARA, gen: 1 }, 409, "part rewritten"],
    [() => undefined, { part: 0, anchor: blocks.findIndex((b) => b.text === "---"), gen: 2 }, 400, "bad block"],
    [() => undefined, { part: 0, anchor: 99, gen: 2 }, 400, "bad block"],
    [() => undefined, { part: 3, anchor: 1, gen: 2 }, 404, "part not found"],
    [() => undefined, { part: 0, anchor: -1, gen: 2 }, 400, "bad request"],
    [() => undefined, { part: 0, anchor: PARA }, 400, "bad request"],
  ];
  for (const [setup, body, status, error] of cases) {
    db.part = { idx: 0, title: "Fabrimycin", markdown: PART, status: "ready", gen: 2 };
    setup();
    const res = await call("mnemonic", { lectureId: LECTURE, ...body });
    assert.deepEqual([res.status, await res.json()], [status, { error }], error);
  }
  const other = await call("mnemonic", { lectureId: "dddddddd-0000-4000-8000-00000000000d", part: 0, anchor: PARA, gen: 2 });
  assert.deepEqual([other.status, await other.json()], [404, { error: "lecture not found" }]);
  assert.equal(calls("/rest/v1/rpc/study_reserve").length, 0);
  assert.equal(modelCalls().length, 0);
});

test("op mnemonic: the budget's refusals answer before the stream (daily_limit 429 after 5)", async () => {
  for (const [code, status] of [
    ["daily_limit", 429],
    ["reserve", 402],
    ["member_share", 402],
    ["budget", 402],
  ] as const) {
    db.reserve = [pgError(code)];
    const res = await call("mnemonic", { lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 });
    assert.deepEqual([res.status, await res.json()], [status, { error: code }], code);
    assert.equal(db.holds.size, 0, `a refused reservation gives the hold back (${code})`);
  }
  assert.equal(calls("/rest/v1/rpc/study_aid_drafts_end").length, 4);
  assert.equal(modelCalls().length, 0);
});

test("op mnemonic: no draft that passes, or no fact, is settled and ends empty; nothing saved", async () => {
  anthropicReplies.push(reply({ fact: FACT, drafts: [{ ...GOOD[0], hook: "דמיין" }] }));
  const r1 = await readStream(await call("mnemonic", { lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 }));
  assert.equal(r1.error, "empty");
  anthropicReplies.push(reply({ fact: "Tinidazole [ש' 16]", drafts: GOOD }));
  const r2 = await readStream(await call("mnemonic", { lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 }));
  assert.equal(r2.error, "empty");
  assert.equal(calls("/rest/v1/rpc/study_settle").length, 2);
  assert.equal(calls("/rest/v1/rpc/study_aid_drafts_save").length, 0);
  anthropicReplies.push(reply({ fact: "", drafts: [] }, "refusal"));
  assert.equal((await readStream(await call("mnemonic", { lectureId: LECTURE, part: 0, anchor: PARA, gen: 2 }))).error, "refusal");
  assert.equal(db.holds.size, 0, "a failed call gives the hold back, so a retry is not busy");
  assert.equal(calls("/rest/v1/rpc/study_aid_drafts_end").length, 3);
});

test("op wall_check: the hold before the reservation; the request's bytes; ok saved with the key; { ok, problem, next }", async () => {
  anthropicReplies.push(reply({ ok: true, problem: "" }));
  const res = await call("wall_check", { aidId: AID });
  assert.deepEqual([res.status, await res.json()], [200, { ok: true, problem: "", next: null }]);
  const order = log
    .filter((l) => l.who === "anthropic" || l.path.startsWith("/rest/v1/rpc/"))
    .map((l) => (l.who === "anthropic" ? "model" : l.path.replace("/rest/v1/rpc/study_", "")));
  assert.deepEqual(order, ["aid_check_begin", "reserve", "model", "settle", "aid_check_done"]);
  assert.deepEqual(JSON.parse(calls("/rest/v1/rpc/study_aid_check_begin")[0].body), { p_aid: AID, p_key: KEY });
  const r = JSON.parse(calls("/rest/v1/rpc/study_reserve")[0].body);
  assert.deepEqual([r.p_kind, r.p_ref, r.p_daily, r.p_share, r.p_member_share], ["wall_check", AID, POLICY.wall_check.daily, 0.8, 0.4]);
  assert.equal(POLICY.wall_check.daily, 20);
  assert.deepEqual(JSON.parse(calls("/rest/v1/rpc/study_aid_check_done")[0].body), { p_aid: AID, p_ok: true, p_note: "", p_key: KEY });
  const b = JSON.parse(modelCalls()[0].body);
  assert.equal(b.max_tokens, 1000);
  assert.deepEqual(b.output_config, { effort: "low", format: { type: "json_schema", schema: CHECK_SCHEMA } });
  assert.deepEqual(b.system, [{ type: "text", text: WALL_CHECK_SYSTEM }]);
  assert.equal(b.messages[0].content, checkRequest({ paragraph: blocks[PARA].text, slides: slideText(slides[1]), aid: BEGUN.body, fact: FACT }));
  assert.ok(!JSON.stringify(b).includes(USER), "no member is named");
});

test("op wall_check: not ok marks it with the problem; busy and checked pay nothing; a failed call gives the entry back unchecked", async () => {
  anthropicReplies.push(reply({ ok: false, problem: "  בשקף כתוב 5 חודשים, לא 6.\n" }));
  const res = await call("wall_check", { aidId: AID });
  assert.deepEqual([res.status, await res.json()], [200, { ok: false, problem: "בשקף כתוב 5 חודשים, לא 6.", next: null }]);
  assert.deepEqual(db.done[0], { p_aid: AID, p_ok: false, p_note: "בשקף כתוב 5 חודשים, לא 6.", p_key: KEY });
  for (const [code, status] of [
    ["busy", 409],
    ["checked", 409],
    ["aid not found", 404],
  ] as const) {
    log = [];
    db.begin = pgError(code);
    const r = await call("wall_check", { aidId: AID });
    assert.deepEqual([r.status, await r.json()], [status, { error: code }], code);
    assert.equal(calls("/rest/v1/rpc/study_reserve").length, 0, code);
  }
  db.begin = null;
  db.done = [];
  anthropicReplies.push(reply({ ok: true }, "refusal"));
  const failed = await call("wall_check", { aidId: AID });
  assert.equal(failed.status, 502);
  assert.deepEqual(db.done, [{ p_aid: AID, p_ok: null, p_note: "", p_key: KEY }], "back to unchecked");
  db.done = [];
  db.reserve = [pgError("daily_limit")];
  const limited = await call("wall_check", { aidId: AID });
  assert.deepEqual([limited.status, await limited.json()], [429, { error: "daily_limit" }]);
  assert.deepEqual(db.done, [{ p_aid: AID, p_ok: null, p_note: "", p_key: KEY }], "a refused reservation gives the entry back too");
  assert.deepEqual([(await call("wall_check", { aidId: "nope" })).status], [400]);
});
