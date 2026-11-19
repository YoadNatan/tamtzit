import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import ai from "../../api/study/ai.js";
import work from "../../api/study/work.js";
import { costUsd, POLICY } from "./budget.js";
import { EXAM_PROMPT_CHARS, examPriceUsd as phonePriceUsd } from "../../shared/study/examPrice.js";
import { examPriceUsd, readUnits, toSaveItems, toSheetKeys, toSolvedKeys, unitCall, type ExamClaim, type SaveItem } from "./exams.js";
import { courseStyle } from "./practice.js";
import { EXAM_KEY_SYSTEM, EXAM_READ_SYSTEM, EXAM_SOLVE_SYSTEM } from "./prompts/questions.js";
import type { ExamItem } from "./questions.js";
import { MODEL, REQUIRED_SCHEMA } from "./study.js";

/* Past exams on the server (docs/study/sources.md phase 2, B6.2, B7):
 * api/study/work.ts's {exam} branch and op exam_read, bundled and run in Node
 * against a local PostgREST stand-in that keeps one exam's units and items
 * (the queue's rules are section S's, checked in supabase/tests/study.sql),
 * and a local Anthropic serving the replies of a synthetic 12-page Hebrew
 * exam (e2e/study/fixtures/exam/exam12.json: fictional drugs, no real exam
 * text). No network, no key, no paid call. */

const KEY = "k-0123456789abcdef0123456789abcdef";
const GROUP = "22222222-0000-4000-8000-000000000002";
const EXAM = "33333333-0000-4000-8000-000000000003";
const USER = "11111111-0000-4000-8000-0000000000aa";
const FIX = JSON.parse(readFileSync(join(process.cwd(), "e2e", "study", "fixtures", "exam", "exam12.json"), "utf8")) as {
  pages: Array<{ n: number; lines: string[] }>;
  units: Array<{ pages: number[]; next: number | null; reply: { questions: ExamItem[]; skipped_open: number } }>;
  key: { pages: number[]; lines: string[]; reply: { keys: unknown[] } };
  solve: { reply: { answers: unknown[] } };
  open_questions: number;
};

/* ── The request context @vercel/functions reads ── */
let pending: Promise<unknown>[] = [];
let deadlineIn = 300_000;
(globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] = {
  get: () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p), deadline: Date.now() + deadlineIn }),
};
const drain = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (expIn: number) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ url: "study/x", iat: 1, exp: Math.floor(Date.now() / 1000) + expIn })}.sig`;
const pathOf = (n: number) => `${GROUP}/exams/${EXAM}/p${n}.jpg`;

/* ── One exam's queue and items, kept as section S keeps them ── */
type Job = { id: string; kind: "read" | "key" | "solve"; pages: number[]; next: number | null; items?: string[]; status: string; lease?: string; error?: string | null; cost?: number };
type Stored = SaveItem & { id: string; key: { answer: number | null; seq: number[] | null; origin: string | null; conf: number | null } };
let jobs: Job[] = [];
let items = new Map<number, Stored>();
let sheet = new Map<number, { answer: number; seq: number[] }>();
let skipped = 0;
let scan = false;
let urlExpIn = 48 * 3600;
let REST = "";
let schemaBody: unknown = { ...REQUIRED_SCHEMA, S: 2 };
let reserveAnswer: { status: number; body: unknown } | null = null;
let nextReservation = 100;
let examRow: unknown = { id: EXAM, group_id: GROUP, key_source: "separate", status: "uploading" };
let doneJobs = 0;

type Logged = { seq: number; who: "rest" | "anthropic"; path: string; body: any; auth: string | null };
let log: Logged[] = [];
let seq = 0;
const rpcs = (name: string) => log.filter((l) => l.who === "rest" && l.path === `/rest/v1/rpc/${name}`);
const modelCalls = () => log.filter((l) => l.who === "anthropic");

const signed = (n: number) => `${REST}/storage/v1/object/sign/study/${pathOf(n)}?token=${token(urlExpIn)}`;
const pageOf = (n: number) => ({
  n,
  path: pathOf(n),
  w: 1500,
  h: 2121,
  lines: scan ? [] : n === 13 ? FIX.key.lines : (FIX.pages[n - 1]?.lines ?? []),
  url: signed(n),
});
const unkeyed = () => [...items.values()].filter((i) => i.key.answer === null && i.key.seq === null);
function claimOf(j: Job): ExamClaim {
  return {
    job: j.id,
    kind: j.kind,
    lease: j.lease!,
    attempt: 1,
    last_error: null,
    exam: { id: EXAM, group_id: GROUP, title: "מועד א׳ 2025", key_source: "separate" },
    pages: j.pages.map(pageOf),
    next: j.next !== null ? pageOf(j.next) : null,
    prev: j.kind === "read" && j.pages[0] > 1 ? pageOf(j.pages[0] - 1) : null,
    seen: [...items.keys()].sort((a, b) => a - b),
    items:
      j.kind === "solve"
        ? (j.items ?? []).flatMap((id) => {
            const i = [...items.values()].find((x) => x.id === id && x.key.answer === null && x.key.seq === null);
            return i ? [{ id: i.id, no: i.no, form: i.form, vignette: i.vignette, question: i.question, options: i.options, prompts: i.prompts }] : [];
          })
        : null,
  };
}
function queueExam() {
  jobs = [
    { id: "j-key", kind: "key", pages: [13], next: null, status: "pending" },
    ...FIX.units.map((u, k) => ({ id: `j-read-${k + 1}`, kind: "read" as const, pages: u.pages, next: u.next, status: "pending" })),
  ];
}
function claimNext(): ExamClaim | null {
  let j = jobs.find((x) => x.status === "pending");
  if (!j && !jobs.some((x) => x.kind === "solve") && jobs.every((x) => x.status === "done") && unkeyed().length) {
    j = { id: "j-solve", kind: "solve", pages: [], next: null, items: unkeyed().map((i) => i.id), status: "pending" };
    jobs.push(j);
  }
  if (!j) return null;
  j.status = "running";
  j.lease = `44444444-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  return claimOf(j);
}
const held = (body: any) => jobs.find((j) => j.id === body.p_job && j.lease === body.p_lease && j.status === "running");
function putKey(i: Stored, k: { answer: number; seq: number[] }, origin: string, conf: number | null) {
  const fitsOne = i.form === "one" && k.answer >= 0 && k.answer < i.options.length;
  const fitsSet = i.form !== "one" && k.seq.length === (i.form === "match" ? i.prompts.length : i.options.length);
  if (!fitsOne && !fitsSet) return false;
  i.key = { answer: fitsOne ? k.answer : null, seq: fitsSet ? k.seq : null, origin, conf };
  return true;
}

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
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  const body = raw ? JSON.parse(raw) : null;
  log.push({ seq: ++seq, who: "rest", path, body, auth: req.headers.authorization ?? null });
  switch (path) {
    case "/auth/v1/user":
      return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated" });
    case "/rest/v1/rpc/study_schema":
      return send(res, 200, schemaBody);
    case "/rest/v1/study_exams":
      return send(res, 200, examRow ? [examRow] : []);
    case "/rest/v1/rpc/study_reserve":
      return reserveAnswer ? send(res, reserveAnswer.status, reserveAnswer.body) : send(res, 200, ++nextReservation);
    case "/rest/v1/rpc/study_settle":
      return send(res, 200, true);
    case "/rest/v1/rpc/study_exam_pages_done":
      return send(res, 200, { units: 4, server: true });
    case "/rest/v1/rpc/study_exam_status":
      return send(res, 200, { status: jobs.every((j) => j.status === "done") ? "ready" : "reading" });
    case "/rest/v1/rpc/study_claim_exam":
      return send(res, 200, claimNext());
    case "/rest/v1/rpc/study_exam_save_items": {
      const j = held(body);
      if (!j) return send(res, 400, pgError("lease lost"));
      let saved = 0;
      let updated = 0;
      let repeats = 0;
      const len = (x: SaveItem) => x.vignette.length + x.question.length + x.options.join("").length;
      for (const it of body.p_items as SaveItem[]) {
        const had = items.get(it.no);
        // As section S: a number from another page is the same question over two pages (the longer copy stays) or a repeat.
        if (had && had.page !== it.page) {
          if (Math.abs(had.page - it.page) !== 1) {
            repeats += 1;
            continue;
          }
          if (len(it) <= len(had)) {
            updated += 1;
            continue;
          }
        }
        const row: Stored = { ...it, id: had?.id ?? `q-${it.no}`, key: had?.key ?? { answer: null, seq: null, origin: null, conf: null } };
        if (had) updated += 1;
        else saved += 1;
        if ((row.key.origin === null || row.key.origin === "exam") && (it.answer >= 0 || it.seq.length))
          putKey(row, it, it.marked_by === "handwritten" ? "solved" : "exam", it.marked_by === "handwritten" ? 2 : null);
        const s = sheet.get(it.no);
        if (s) putKey(row, s, "sheet", null);
        items.set(it.no, row);
      }
      skipped += body.p_skipped;
      return send(res, 200, { saved, updated, skipped: 0, repeats });
    }
    case "/rest/v1/rpc/study_exam_save_keys": {
      const j = held(body);
      if (!j) return send(res, 400, pgError("lease lost"));
      let n = 0;
      for (const k of body.p_keys as Array<{ no: number; answer: number; seq: number[]; conf?: number }>) {
        const i = items.get(k.no);
        if (j.kind === "key") {
          sheet.set(k.no, k);
          if (i && putKey(i, k, "sheet", null)) n += 1;
        } else if (i && i.key.answer === null && i.key.seq === null && putKey(i, k, "solved", k.conf ?? null)) n += 1;
      }
      return send(res, 200, n);
    }
    case "/rest/v1/rpc/study_finish_exam_job": {
      const j = held(body);
      if (!j) return send(res, 200, false);
      j.status = body.p_status === "done" ? "done" : "failed";
      j.error = body.p_error;
      j.cost = body.p_cost;
      doneJobs += 1;
      return send(res, 200, true);
    }
  }
  send(res, 404, { message: `unmocked ${req.method} ${path}` });
});

/* ── Anthropic: the fixture's replies, chosen by the unit's system and pages ── */
type Mode = "ok" | "hang" | "refusal" | "garbled" | "versions";
let mode: Mode = "ok";
let ANTHROPIC = "";
const usage = { input_tokens: 9000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0, output_tokens: 1 };
const ev = (e: object & { type: string }) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
function replyFor(body: any): unknown {
  const system = body.system?.[0]?.text;
  if (system === EXAM_KEY_SYSTEM) return mode === "versions" ? { versions: ["א", "ב"], keys: [] } : FIX.key.reply;
  if (system === EXAM_SOLVE_SYSTEM) return FIX.solve.reply;
  const lead = String(body.messages?.[0]?.content?.[0]?.text ?? "");
  const first = Number(/start on pages? (\d+)/.exec(lead)?.[1]);
  return FIX.units.find((u) => u.pages[0] === first)?.reply ?? { questions: [], skipped_open: 0 };
}
const anthropic = createServer(async (req, res) => {
  const raw = await readAll(req);
  const body = JSON.parse(raw);
  log.push({ seq: ++seq, who: "anthropic", path: req.url ?? "", body, auth: null });
  res.writeHead(200, { "content-type": "text/event-stream" });
  const text = mode === "garbled" ? '{"questions": [{"no": 1, "kind"' : JSON.stringify(replyFor(body));
  res.write(ev({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage } }));
  res.write(ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  if (mode === "hang") {
    res.write(ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, 40) } }));
    return; // never ends: the unit stops itself
  }
  for (let i = 0; i < text.length; i += 200) res.write(ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 200) } }));
  res.write(ev({ type: "content_block_stop", index: 0 }));
  res.write(ev({ type: "message_delta", delta: { stop_reason: mode === "refusal" ? "refusal" : mode === "garbled" ? "end_turn" : "end_turn", stop_sequence: null }, usage: { output_tokens: 2400 } }));
  res.end(ev({ type: "message_stop" }));
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
  deadlineIn = 300_000;
  schemaBody = { ...REQUIRED_SCHEMA, Q: 2, S: 2 };
  reserveAnswer = null;
  items = new Map();
  sheet = new Map();
  skipped = 0;
  scan = false;
  urlExpIn = 48 * 3600;
  mode = "ok";
  doneJobs = 0;
  examRow = { id: EXAM, group_id: GROUP, key_source: "separate", status: "uploading" };
  queueExam();
});

const kick = (exam: unknown = EXAM, auth = `Bearer ${KEY}`) =>
  work.fetch(new Request("http://localhost/api/study/work", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ exam }) }));
/** Kicks the worker until nothing is left to claim, as pg_net and the sweeper would. */
async function runAll(): Promise<number> {
  let units = 0;
  for (let i = 0; i < 20; i++) {
    const res = await kick();
    const b = (await res.json()) as { claimed?: boolean };
    if (res.status !== 202 || !b.claimed) return units;
    units += 1;
    await drain();
  }
  return units;
}
const sortedNos = () => [...items.keys()].sort((a, b) => a - b);

// ── The pure parts ──
test("read units: 4 pages each, the next page as context, the last unit with none", () => {
  assert.deepEqual(readUnits(Array.from({ length: 12 }, (_, i) => i + 1)), [
    { pages: [1, 2, 3, 4], next: 5 },
    { pages: [5, 6, 7, 8], next: 9 },
    { pages: [9, 10, 11, 12], next: null },
  ]);
  assert.deepEqual(readUnits([3, 1, 2, 9, 7]), [{ pages: [1, 2, 3, 7], next: 9 }, { pages: [9], next: null }], "in page order, gaps kept");
});

test("toSaveItems: whole items in their order; a question that starts on the context page or was saved already from another unit's pages is skipped; bad keys and boxes dropped", () => {
  const u2 = FIX.units[1];
  const { items: got, rejected } = toSaveItems(u2.reply.questions, { pages: u2.pages, next: u2.next, seen: [1, 2, 3, 4] });
  assert.deepEqual(got.map((i) => `${i.no}:${i.page}`), ["4:5", "5:5", "6:6", "7:7", "8:8"], "the end of question 4 at the top of page 5 goes on: section S keeps the longer copy");
  assert.equal(rejected, 0);
  const tf = got.find((i) => i.no === 5)!;
  assert.deepEqual([tf.form, tf.seq, tf.answer], ["tf", [1, 1, 0], -1]);
  const match = got.find((i) => i.no === 6)!;
  assert.deepEqual([match.form, match.prompts, match.seq], ["match", ["Mockacillin", "Examplomycin", "Fictazole"], []]);
  assert.equal(got.find((i) => i.no === 7)!.figure, "pg:7:120,300,760,250");
  // "א+ב נכונות" stays third; its answer, the exam's circle, points at it.
  const [first] = toSaveItems(FIX.units[0].reply.questions, { pages: [1, 2, 3, 4], next: 5, seen: [] }).items;
  assert.deepEqual([first.options[2], first.answer], ["א+ב נכונות", 2]);
  const bad = toSaveItems(
    [
      { ...first, no: 0 } as never,
      { ...first, no: 30, options: ["רק אחת"] } as never,
      { ...first, no: 31, question: "קצר" } as never,
      { ...first, no: 32, answer: 7, figure: { page: 40, x: 1, y: 1, w: 9, h: 9 } } as never,
      { ...first, no: 33, page: 5 } as never,
      { ...first, no: 34, form: "match", prompts: ["רק אחד"] } as never,
      { ...first, no: 35, form: "tf", seq: [1, 2, 0, 1] } as never,
    ],
    { pages: [1, 2, 3, 4], next: 5, seen: [] },
  );
  assert.equal(bad.rejected, 4, "no number, one option, a short question, a match of one prompt");
  assert.deepEqual(bad.items.map((i) => [i.no, i.answer, i.figure, i.seq.length]), [[32, -1, "", 0], [35, -1, "", 0]], "an answer out of range and a box on a page not shown are dropped; the next unit's item 33 is left to it");
  const again = toSaveItems([{ ...first, no: 1, question: first.question + " (תוקן)" } as never], { pages: [1], next: 2, seen: [1, 2, 3], reread: true });
  assert.equal(again.items.length, 1, "a page read again replaces its numbers");
  // Marks only when the uploader said the answers are marked in the exam; a student's own marks say so.
  const raw0 = FIX.units[0].reply.questions;
  const none = toSaveItems(raw0, { pages: [1, 2, 3, 4], next: 5, seen: [], keySource: "none" }).items;
  assert.ok(none.every((i) => i.answer === -1 && i.seq.length === 0), "no answers in an exam without them");
  const marked = toSaveItems([{ ...raw0[0], marked_by: "handwritten" }, { ...raw0[2], marked_by: "circle" }], { pages: [1, 2, 3, 4], next: 5, seen: [], keySource: "marked" }).items;
  assert.deepEqual(marked.map((i) => [i.answer, i.marked_by]), [[2, "handwritten"], [1, "none"]]);
  // The page before as context: a shared case's picture may sit on it. One number on two far pages: both go on (a repeat, counted by section S).
  const ctx = toSaveItems(
    [{ ...raw0[0], no: 13, page: 6, figure: { page: 4, x: 100, y: 100, w: 500, h: 300 } }, { ...raw0[0], no: 1, page: 7 }] as never,
    { pages: [5, 6, 7, 8], next: 9, prev: 4, seen: [1] },
  ).items;
  assert.deepEqual(ctx.map((i) => `${i.no}:${i.page}:${i.figure}`), ["1:7:", "13:6:pg:4:100,100,500,300"]);
});

test("toSheetKeys and toSolvedKeys: by number, fitting each item's form, with a confidence", () => {
  assert.deepEqual(toSheetKeys(FIX.key.reply.keys as never).map((k) => `${k.no}:${k.answer}`), ["1:2", "2:0", "4:3", "8:1", "11:0", "12:3", "40:1"]);
  assert.deepEqual(toSheetKeys([{ no: 3, answer: -1, seq: [1, 0, 1] }, { no: 4, answer: 9, seq: [] }, { no: 0, answer: 1, seq: [] }]), [{ no: 3, answer: -1, seq: [1, 0, 1] }]);
  const asked = [
    { id: "a", no: 6, form: "match", vignette: "", question: "התאימו", options: ["x", "y", "z"], prompts: ["p", "q", "r"] },
    { id: "b", no: 7, form: "one", vignette: "", question: "מה מוצג", options: ["x", "y", "z"], prompts: [] },
    { id: "c", no: 9, form: "one", vignette: "", question: "זמן", options: ["x", "y", "z", "w"], prompts: [] },
  ];
  assert.deepEqual(
    toSolvedKeys(asked, FIX.solve.reply.answers as never).map((k) => `${k.no}:${k.answer}:${k.seq.join("")}:${k.conf}`),
    ["6:-1:012:3", "7:0::2", "9:1::1"],
    "question 3 was not asked: dropped",
  );
  assert.deepEqual(toSolvedKeys(asked, [{ no: 6, answer: -1, seq: [0, 0, 1], conf: 3 }, { no: 7, answer: 1, seq: [], conf: 4 }]), [], "a match with a repeat, a confidence of 4");
});

test("the price before an upload: the read units at a usual length, the key sheet, solving an exam without answers", () => {
  const twelve = examPriceUsd({ pages: 12 });
  const thirty = examPriceUsd({ pages: 30 });
  assert.ok(twelve > 0.3 && twelve < 1.2, String(twelve));
  assert.ok(thirty > 1 && thirty < 2.6, `about $1.40-2 for 30 pages: ${thirty}`);
  assert.ok(examPriceUsd({ pages: 12, keyPages: 1 }) > twelve);
  assert.ok(examPriceUsd({ pages: 12, keySource: "none" }) > twelve, "solving costs a little more");
  assert.equal(examPriceUsd({ pages: 0 }), 0);
});

test("the read request: the same cached system for every exam, no lecture list, pictures first and lines only as a hint, the context page, the numbers saved", () => {
  const job: ExamClaim = {
    job: "j",
    kind: "read",
    lease: "l",
    attempt: 1,
    last_error: null,
    exam: { id: EXAM, group_id: GROUP, title: "x", key_source: "marked" },
    pages: [1, 2, 3, 4].map(pageOf),
    next: pageOf(5),
    seen: [1, 2],
    items: null,
  };
  process.env.VITE_SUPABASE_URL = REST;
  const call = unitCall(job)!;
  assert.equal(call.system, EXAM_READ_SYSTEM);
  assert.ok(!/lecture/i.test(EXAM_READ_SYSTEM), "no lecture list or course map in the read prompt");
  for (const rule of ["picture is the truth", "START on the pages", "context only", "א+ב נכונות", "skipped_open", "parse_conf", "Never answer a question yourself"]) {
    assert.ok(EXAM_READ_SYSTEM.includes(rule), rule);
  }
  const texts = call.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
  assert.equal(
    texts[0],
    "Copy the questions that start on pages 1-4. Page 5 follows them as context only.\nThe uploader says the correct answers are marked in this exam.\nAlready copied (skip them): 1, 2.",
  );
  assert.ok(texts[1].startsWith("Page 1. Its extracted lines, a hint only:\nעמוד 1 מתוך 12"));
  assert.ok(texts[5].startsWith("Page 5 (context only: finish a question that continues here; copy nothing that starts here)"));
  const images = call.content.filter((b) => b.type === "image") as Array<{ source: { url: string } }>;
  assert.deepEqual(images.map((i) => i.source.url.split("?")[0].slice(-7)), ["/p1.jpg", "/p2.jpg", "/p3.jpg", "/p4.jpg", "/p5.jpg"]);
  assert.equal(call.imageTokens, 5 * Math.ceil((1500 * 2121) / 750));
  // The page before as context; an exam without answers says so in the user turn (the system stays the same).
  const mid = unitCall({ ...job, pages: [5, 6, 7, 8].map(pageOf), next: pageOf(9), prev: pageOf(4), exam: { ...job.exam, key_source: "none" } })!;
  const midTexts = mid.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
  assert.ok(midTexts[0].includes("Page 4 comes before them as context only.") && midTexts[0].includes("no answers marked"), midTexts[0]);
  assert.ok(midTexts[1].startsWith("Page 4 (context only: copy nothing from it but a shared case"));
  assert.equal(mid.content.filter((b) => b.type === "image").length, 6);
  assert.equal(mid.system, EXAM_READ_SYSTEM);
  // A scan: no lines, the same pictures.
  scan = true;
  const s = unitCall({ ...job, pages: [1, 2, 3, 4].map(pageOf), next: pageOf(5) })!;
  assert.ok(s.content.every((b) => b.type !== "text" || !(b as { text: string }).text.includes("extracted lines")));
  assert.equal(s.content.filter((b) => b.type === "image").length, 5);
  // An expired link: no request at all.
  urlExpIn = 60;
  assert.equal(unitCall({ ...job, pages: [1].map(pageOf), next: null }), null);
});

// ── The worker (work.ts {exam}) ──
test("work.ts {exam}: a bad id 400; nothing to claim 200; a database without S 2 503 and nothing claimed", async () => {
  for (const id of ["", "x", 7, null]) assert.equal((await kick(id)).status, 400, String(id));
  assert.equal((await kick(EXAM, "Bearer nope")).status, 401);
  schemaBody = { ...REQUIRED_SCHEMA, Q: 2, S: 1 };
  const old = await kick();
  assert.equal(old.status, 503);
  assert.deepEqual(await old.json(), { error: "schema" });
  assert.equal(rpcs("study_claim_exam").length, 0);
  schemaBody = { ...REQUIRED_SCHEMA, Q: 2, S: 2 };
  jobs = [];
  const none = await kick();
  assert.deepEqual([none.status, await none.json()], [200, { claimed: false }]);
  assert.deepEqual(rpcs("study_claim_exam")[0].body, { p_exam: EXAM, p_key: KEY });
});

async function wholeExam(label: string) {
  const units = await runAll();
  assert.equal(units, 5, `${label}: the key sheet, 3 read units, one solve unit`);
  // Every question once, split ones whole.
  assert.deepEqual(sortedNos(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], label);
  const q4 = items.get(4)!;
  assert.deepEqual([q4.page, q4.options.length, q4.options[3]], [4, 4, "כל התשובות נכונות"], `${label}: question 4, split over pages 4 and 5, is whole and saved once`);
  assert.equal(items.get(1)!.options[2], "א+ב נכונות");
  // The key sheet by number, over the exam's marks; then solved keys for the rest.
  const keys = sortedNos().map((n) => {
    const k = items.get(n)!.key;
    return `${n}:${k.answer ?? k.seq?.join("") ?? "-"}:${k.origin}${k.conf ? k.conf : ""}`;
  });
  // A key sheet apart: the marks on the exam's pages are not its key (a student's copy); the items the sheet lacks are solved.
  assert.deepEqual(keys, ["1:2:sheet", "2:0:sheet", "3:0:solved3", "4:3:sheet", "5:110:solved2", "6:012:solved3", "7:0:solved2", "8:1:sheet", "9:1:solved1", "10:0:solved3", "11:0:sheet", "12:3:sheet"], label);
  assert.equal(skipped, FIX.open_questions, `${label}: the open questions skipped, counted`);
  // One reservation per unit (kind exam, ref unit, no daily check), settled once, finished with its cost.
  const reserves = rpcs("study_reserve");
  assert.equal(reserves.length, 5);
  for (const r of reserves) {
    assert.deepEqual([r.body.p_kind, r.body.p_ref, r.body.p_daily, r.body.p_daily_ref, r.body.p_member_share, r.body.p_group, r.body.p_lecture], ["exam", "unit", null, null, null, GROUP, null]);
    assert.equal(r.body.p_key, KEY);
    assert.ok(r.body.p_estimate > 0 && r.body.p_estimate < 1, String(r.body.p_estimate));
  }
  assert.equal(rpcs("study_settle").length, 5);
  const cost = costUsd({ ...usage, output_tokens: 2400 }, MODEL);
  for (const s of rpcs("study_settle")) assert.ok(Math.abs(s.body.p_cost - cost) < 1e-9);
  assert.deepEqual(jobs.map((j) => [j.kind, j.status, j.error ?? null]), [
    ["key", "done", null],
    ["read", "done", null],
    ["read", "done", null],
    ["read", "done", null],
    ["solve", "done", null],
  ]);
  for (const j of jobs) assert.ok(Math.abs((j.cost ?? 0) - Math.round(cost * 1e5) / 1e5) < 1e-9, "the finish carries the unit's cost");
  const calls = modelCalls();
  assert.equal(calls.length, 5);
  for (const c of calls) {
    assert.equal(c.body.system[0].cache_control.type, "ephemeral");
    assert.equal(c.body.output_config.format.type, "json_schema");
    assert.equal(c.body.model, MODEL);
  }
  const reads = calls.filter((c) => c.body.system[0].text === EXAM_READ_SYSTEM);
  assert.equal(new Set(reads.map((c) => c.body.system[0].text)).size, 1, "one cache-stable system for every read unit");
  assert.ok(reads.every((c) => c.body.output_config.effort === "low"));
  return calls;
}

test("a 12-page text PDF: the key sheet, three read units and a solve unit yield every question once; keys by number; open questions counted", async () => {
  const calls = await wholeExam("text PDF");
  const read2 = calls.find((c) => /start on pages 5-8/.test(c.body.messages[0].content[0].text))!;
  const lead = read2.body.messages[0].content[0].text as string;
  assert.ok(lead.includes("Already copied (skip them): 1, 2, 3, 4."), lead);
  assert.ok(read2.body.messages[0].content.some((b: any) => b.type === "text" && b.text.includes("extracted lines") && b.text.includes("עמוד 5 מתוך 12")));
  const solve = calls.find((c) => c.body.system[0].text === EXAM_SOLVE_SYSTEM)!;
  assert.deepEqual([...solve.body.messages[0].content[0].text.matchAll(/Question (\d+) \(form (\w+)\)/g)].map((m) => `${m[1]}${m[2]}`), ["3one", "5tf", "6match", "7one", "9one", "10one"], "only the items left without a key");
  assert.ok(lead.includes("Page 4 comes before them as context only.") && lead.includes("separate key sheet"), lead);
  assert.equal(solve.body.output_config.effort, "medium");
});

test("a 12-photo scan: no text lines anywhere, the same pictures, the same items", async () => {
  scan = true;
  const calls = await wholeExam("scan");
  for (const c of calls.filter((x) => x.body.system[0].text !== EXAM_SOLVE_SYSTEM)) {
    const content = c.body.messages[0].content as Array<{ type: string; text?: string }>;
    assert.ok(content.every((b) => b.type !== "text" || !b.text!.includes("extracted lines")));
    assert.ok(content.some((b) => b.type === "image"));
  }
});

test("a key sheet with a column per version keys nothing: the unit fails as versions (no retry), and the items are solved", async () => {
  jobs = [{ id: "j-key", kind: "key", pages: [13], next: null, status: "pending" }];
  mode = "versions";
  assert.equal((await kick()).status, 202);
  await drain();
  assert.deepEqual([jobs[0].status, jobs[0].error], ["failed", "versions"]);
  assert.equal(rpcs("study_exam_save_keys").length, 0);
});

test("a timeout keeps what arrived and fails the unit as timeout (section S retries it once); a refusal, an unreadable answer", async () => {
  jobs = [{ id: "j-read-1", kind: "read", pages: [1, 2, 3, 4], next: 5, status: "pending" }];
  mode = "hang";
  deadlineIn = 30_000; // the unit stops 25 s before the deadline: in about 5 s
  assert.equal((await kick()).status, 202);
  await drain();
  assert.deepEqual([jobs[0].status, jobs[0].error], ["failed", "timeout"]);
  assert.equal(rpcs("study_settle").length, 1, "a stopped call is settled too");
  for (const [m, code] of [["refusal", "refusal"], ["garbled", "unreadable"]] as const) {
    jobs = [{ id: `j-${m}`, kind: "read", pages: [1, 2, 3, 4], next: 5, status: "pending" }];
    mode = m;
    deadlineIn = 300_000;
    assert.equal((await kick()).status, 202);
    await drain();
    assert.deepEqual([jobs[0].status, jobs[0].error], ["failed", code], m);
  }
});

test("pages whose links expired: the unit fails before any reservation or model call; a budget refusal ends it with the code", async () => {
  jobs = [{ id: "j-read-1", kind: "read", pages: [1, 2, 3, 4], next: 5, status: "pending" }];
  urlExpIn = 120;
  await kick();
  await drain();
  assert.deepEqual([jobs[0].status, jobs[0].error], ["failed", "pages_expired"]);
  assert.equal(rpcs("study_reserve").length + modelCalls().length, 0);
  urlExpIn = 48 * 3600;
  jobs = [{ id: "j-read-2", kind: "read", pages: [1, 2, 3, 4], next: 5, status: "pending" }];
  reserveAnswer = { status: 400, body: pgError("reserve") };
  await kick();
  await drain();
  assert.deepEqual([jobs[0].status, jobs[0].error], ["failed", "reserve"]);
  assert.equal(modelCalls().length, 0);
});

test("a lease lost meanwhile: nothing is saved over the new holder, and the unit is not finished", async () => {
  jobs = [{ id: "j-read-1", kind: "read", pages: [1, 2, 3, 4], next: 5, status: "pending" }];
  const res = await kick();
  assert.equal(res.status, 202);
  jobs[0].lease = "another"; // taken by another worker while this one wrote
  await drain();
  assert.equal(items.size, 0);
  assert.equal(doneJobs, 0);
});

// ── Op exam_read ──
const post = (body: unknown) =>
  ai.fetch(new Request("http://localhost/api/study/ai", { method: "POST", headers: { authorization: "Bearer x.y.z", "content-type": "application/json" }, body: JSON.stringify(body) }));
const startBody = () => ({
  op: "exam_read",
  examId: EXAM,
  pages: [...Array.from({ length: 12 }, (_, i) => ({ n: i + 1, path: pathOf(i + 1), w: 1500, h: 2121, lines: FIX.pages[i].lines })), { n: 13, path: pathOf(13), w: 1500, h: 2121, key: true }],
  urls: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [pathOf(i + 1), signed(i + 1)])),
});

test("op exam_read: the usual price reserved as an exam started (3 a day, no member's share) and settled at $0, then the pages handed over with the key", async () => {
  const res = await post(startBody());
  assert.equal(res.status, 200);
  const b = (await res.json()) as { units: number; server: boolean; priceUsd: number };
  assert.deepEqual([b.units, b.server], [4, true]);
  assert.equal(b.priceUsd, examPriceUsd({ pages: 12, keyPages: 1, keySource: "separate" }));
  const [r] = rpcs("study_reserve");
  assert.deepEqual([r.body.p_kind, r.body.p_ref, r.body.p_daily, r.body.p_daily_ref, r.body.p_member_share, r.body.p_share], ["exam", "read", 3, "read", null, 0.8]);
  assert.equal(r.body.p_estimate, b.priceUsd);
  const [s] = rpcs("study_settle");
  assert.equal(s.body.p_cost, 0);
  assert.ok(s.seq > r.seq);
  const [done] = rpcs("study_exam_pages_done");
  assert.ok(done.seq > s.seq);
  assert.deepEqual(Object.keys(done.body).sort(), ["p_exam", "p_key", "p_pages", "p_until", "p_urls"]);
  assert.equal(done.body.p_key, KEY);
  assert.equal(done.auth, "Bearer x.y.z", "with the member's token");
  assert.equal(modelCalls().length, 0, "no model call: the units read the exam");
  assert.deepEqual(POLICY.exam, { share: 0.8, memberShare: null, daily: 3, dailyRef: "read" });
});

test("op exam_read: a fourth exam today 429; an exam already started 409; another's 404; too many pages and bad bodies 400", async () => {
  reserveAnswer = { status: 400, body: pgError("daily_limit") };
  const limited = await post(startBody());
  assert.deepEqual([limited.status, await limited.json()], [429, { error: "daily_limit" }]);
  assert.equal(rpcs("study_exam_pages_done").length, 0);
  reserveAnswer = null;
  examRow = { id: EXAM, group_id: GROUP, key_source: "marked", status: "reading" };
  assert.equal((await post(startBody())).status, 409);
  examRow = null;
  assert.equal((await post(startBody())).status, 404);
  const many = { ...startBody(), pages: Array.from({ length: 121 }, (_, i) => ({ n: i + 1 })) };
  assert.deepEqual(await (await post(many)).json(), { error: "too many pages" });
  for (const bad of [{ op: "exam_read" }, { op: "exam_read", examId: "x", pages: [], urls: {} }, { ...startBody(), urls: [] }, { ...startBody(), action: "read" }]) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(rpcs("study_reserve").length, 1, "only the first call reserved");
});

test('op exam_read {action:"unit"}: the phone drives a unit with the member\'s token and the key, until nothing is left', async () => {
  jobs = [{ id: "j-read-1", kind: "read", pages: [1, 2, 3, 4], next: 5, status: "pending" }];
  const res = await post({ op: "exam_read", action: "unit", examId: EXAM });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { claimed: true, kind: "read", status: "done", error: null, saved: 4 });
  const [claim] = rpcs("study_claim_exam");
  assert.deepEqual([claim.body.p_key, claim.auth], [KEY, "Bearer x.y.z"]);
  assert.ok(rpcs("study_exam_save_items").every((c) => c.auth === "Bearer x.y.z"));
  assert.equal(rpcs("study_reserve")[0].body.p_daily, null, "a unit is not an exam started");
  // Then the solve unit of its two items without a key, then nothing.
  const solve = (await (await post({ op: "exam_read", action: "unit", examId: EXAM })).json()) as { kind: string };
  assert.equal(solve.kind, "solve");
  const last = await post({ op: "exam_read", action: "unit", examId: EXAM });
  assert.deepEqual(await last.json(), { claimed: false, status: "ready" });
});

// ── The question writer's style (courseStyle) ──
test("courseStyle with S 2: the course's items through study_course_style_items (any spelling, keys from the exam, its sheet or a member); without S 2 the exact text as before", async () => {
  const calls: string[] = [];
  const rows = Array.from({ length: 6 }, (_, i) => ({
    id: `x${i}`,
    exam_id: i < 3 ? "e1" : "e2",
    exam_no: i + 1,
    kind: "mcq",
    vignette: "",
    question: `שאלה ${i + 1} (synthetic)?`,
    options: ["א", "ב", "ג", "ד"],
    has_key: i % 2 === 0,
    exam_created_at: i < 3 ? "2026-01-01T00:00:00Z" : "2026-06-01T00:00:00Z",
  }));
  const sb = (schema: Record<string, number>) =>
    ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push(`${name} ${JSON.stringify(args ?? {})}`);
        return name === "study_schema" ? { data: schema, error: null } : { data: rows, error: null };
      },
      from: (t: string) => {
        calls.push(`from ${t}`);
        const q: any = { select: () => q, eq: () => q, is: () => q, in: () => q, then: (ok: (v: unknown) => void) => ok({ data: [], error: null }) };
        return q;
      },
    }) as never;
  // Without S 2 first (a yes is remembered per instance).
  assert.equal(await courseStyle(sb({ S: 1 }), { group_id: GROUP, course: "פרמקו" }), null);
  assert.ok(calls.includes("from study_exams"), "the old query");
  calls.length = 0;
  const style = await courseStyle(sb({ S: 2 }), { group_id: GROUP, course: " פרמקו " });
  assert.ok(style && style.examples.length === 3, "the keyed items only");
  assert.ok(calls.some((c) => c.startsWith('study_course_style_items {"p_group":"' + GROUP + '","p_course":" פרמקו "}')));
  assert.ok(!calls.includes("from study_exams"));
});

test("the phone's price before an upload is the server's (shared/study/examPrice.ts)", () => {
  assert.deepEqual(EXAM_PROMPT_CHARS, { read: EXAM_READ_SYSTEM.length, key: EXAM_KEY_SYSTEM.length, solve: EXAM_SOLVE_SYSTEM.length }, "the prompts' lengths the phone counts with");
  for (const o of [{ pages: 1 }, { pages: 12 }, { pages: 28 }, { pages: 120 }, { pages: 12, keyPages: 2, keySource: "separate" }, { pages: 30, keySource: "none" }]) {
    assert.equal(phonePriceUsd(o), examPriceUsd(o), JSON.stringify(o));
  }
});
