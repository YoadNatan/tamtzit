import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL, modelInfo, type ModelInfo } from "../../shared/study/models.js";
import { estimateUsd, POLICY } from "./budget.js";
import { run } from "./claude.js";
import { unitCall, type ExamClaim, type ExamPage } from "./exams.js";
import {
  checksFor,
  DIFFERS,
  fixCheckFrozen,
  labEstimate,
  labRefusal,
  LAB_ROUTES,
  PATH_URL,
  picturePaths,
  readFrozen,
  requestHash,
  runEstimate,
  shuffled,
  similarity,
  solverFrozen,
  statusOf,
  thaw,
  type BankItem,
  type Frozen,
  type ReadUnit,
} from "./lab.js";
import { checkCall, citedSlidesText, fixCheckOpts } from "./ops/fixcheck.js";
import { fixCheckRequest } from "./prompts/collab.js";
import { sheetCall } from "./sheets.js";
import { solveQuestions, solverCall, withTwins } from "./solver.js";
import type { Lecture, StoredSlide } from "./study.js";

/* "השוואת מודלים" on the server, the pure part (design-models §7.5-§7.6,
 * §12.1 lab.test.ts): each frozen request is production's request exactly
 * (the comparisons of this package differ in nothing but the server-side
 * fallback they never send, D15), its pictures kept as paths; estimates and
 * the unverified factor; checksFor per kind; the statuses. Synthetic
 * fixtures only (e2e/study/fixtures). No network: the SDK's fetch is a
 * stand-in that records the request and answers an empty stream. */

process.env.STUDY_WORKER_KEY = "k-0123456789abcdef0123456789abcdef";
const REST = "https://lab.test";
process.env.VITE_STUDY_SUPABASE_URL = REST;
const FX = join(process.cwd(), "e2e", "study", "fixtures");
const raw = JSON.parse(readFileSync(join(FX, "slides.json"), "utf8")) as Array<{ n: number; title: string; lines: string[]; notes?: string }>;
const slides: StoredSlide[] = raw.map((s) => ({ n: s.n, title: s.title, lines: s.lines ?? [], tables: [], notes: s.notes ?? "", figures: [] }));
slides[2].figures = [{ k: 1, path: "g1/l1/s3-1.jpg", w: 800, h: 600 }];
const lecture: Lecture = { id: "l1", group_id: "g1", course: "קורס בדוי", title: "משתנים (בדוי)", lecturer: "", lecture_date: null, source_kind: "pptx", slides };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (expIn: number) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ url: "study/x", iat: 1, exp: Math.floor(Date.now() / 1000) + expIn })}.sig`;
const signedOf = (path: string) => `${REST}/storage/v1/object/sign/study/${path}?token=${token(3600)}`;

const bank: BankItem[] = [
  { id: "q1", vignette: "", question: "מהו אתר הפעולה של משתן לולאה בדוי?", options: ["Proximal tubule", "Thick ascending limb", "Collecting duct", "Glomerulus"], answer: 1, seq: null },
  { id: "q2", vignette: "מטופלת בת 60 (בדויה).", question: "איזו תופעה צפויה?", options: ["היפוקלמיה", "היפרקלמיה", "היפרנתרמיה"], answer: 0, seq: null },
  { id: "q3", vignette: "", question: "סמנו נכון או לא נכון (בדוי):", options: ["אמירה א", "אמירה ב", "אמירה ג"], form: "tf", answer: null, seq: [1, 0, 1] },
  { id: "q4", vignette: "", question: "מה מראה התמונה (בדוי)?", options: ["מקטע א", "מקטע ב", "מקטע ג", "מקטע ד"], style: "image", figure: "fig:3-1", answer: 2, seq: null },
];

/** An SDK whose fetch records each request body and answers an empty finished stream. */
function recorder() {
  const bodies: Array<Record<string, unknown>> = [];
  const enc = new TextEncoder();
  const ev = (e: { type: string }) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const events = [
      { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: DEFAULT_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "{}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(ev(e)));
        c.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { client: new Anthropic({ apiKey: "test-key", fetch: fetch as unknown as typeof globalThis.fetch, maxRetries: 0 }), bodies };
}
const noLedger = async () => true;
/** A comparison's call: the frozen request thawed, through run() with no fallback (as ops/lab.ts calls it). */
async function labBody(f: Frozen, urls: Map<string, string>) {
  const r = recorder();
  const req = thaw(f, urls)!;
  await run({ client: r.client, kind: "lab", ref: "run:x:0:answer", ...req, stopAt: Date.now() + 30_000, fallbacks: false, appFallback: false, ledger: noLedger, onText: () => undefined });
  return r.bodies[0];
}
/** Production's body without its server-side fallback (a comparison never sends it, D15). */
const withoutFallback = (b: Record<string, unknown>) => {
  const { betas: _b, fallbacks: _f, ...rest } = b;
  return rest;
};

test("the comparable kinds of this package: the answer-key kinds, none differing from production", () => {
  assert.deepEqual([...LAB_ROUTES], ["solver", "fix_check", "exam_read", "sheet_read"]);
  for (const r of LAB_ROUTES) assert.equal(DIFFERS[r], "", r);
  assert.deepEqual(POLICY.lab, { share: 0.8, memberShare: null, daily: null }, "kind lab: the group's 80% line, nobody's share (OD5)");
});

test("solver: the frozen request is solveQuestions' request exactly, pictures as paths, keys kept apart", async () => {
  const f = solverFrozen(lecture, bank);
  const json = JSON.stringify(f.messages);
  assert.ok(json.includes(`${PATH_URL}g1/l1/s3-1.jpg`), "the picture is its path");
  assert.ok(!json.includes("token="), "no signed link is frozen");
  assert.deepEqual(picturePaths(f), ["g1/l1/s3-1.jpg"]);
  // The material has no key: the answers live in `key` only.
  const material = JSON.stringify(f.material);
  assert.ok(!/"answer"|"seq"/.test(material), material);
  assert.equal(f.key.route, "solver");
  // solverCall over the same items with the picture signed.
  const url = signedOf("g1/l1/s3-1.jpg");
  const urls = new Map([["g1/l1/s3-1.jpg", url]]);
  const items = bank.map((q, i) =>
    i === 3
      ? { vignette: q.vignette, question: q.question, options: q.options, answer: q.answer, image: url }
      : { vignette: q.vignette, question: q.question, options: q.options, answer: q.answer, ...(q.form ? { form: q.form, seq: q.seq } : {}) },
  );
  const call = solverCall({ lecture, items: withTwins(items).all });
  const t = thaw(f, urls)!;
  assert.deepEqual(t.system, call.system);
  assert.deepEqual(t.messages, call.messages);
  assert.equal(t.maxTokens, call.max_tokens);
  assert.equal(t.effort, call.output_config.effort);
  assert.deepEqual(t.format, call.output_config.format);
  // And byte for byte what the production path sends (solveQuestions through generateItems), but for the fallback.
  const prod = recorder();
  await solveQuestions({ client: prod.client, lecture, items, ledger: noLedger, stopAt: Date.now() + 30_000 });
  assert.deepEqual(await labBody(f, urls), withoutFallback(prod.bodies[0]));
  assert.ok(prod.bodies[0].fallbacks, "production sends Opus's server-side fallback; the comparison does not");
});

test("fix_check: the frozen request is the check's request exactly; the group's decision is the key", async () => {
  const p = { id: "p1", lecture_id: "l1", part_idx: 0, before_text: "Furosemide פועל ב-Proximal tubule.", after_text: "Furosemide פועל ב-Thick ascending limb.", source_slides: [2, 3], state: "applied" as const };
  const slidesText = citedSlidesText(lecture, p.source_slides);
  const f = fixCheckFrozen(lecture, p, slidesText);
  const { kind, ...opts } = fixCheckOpts(fixCheckRequest({ before: p.before_text, after: p.after_text, slides: slidesText }));
  assert.equal(kind, f.kind);
  assert.deepEqual({ system: f.system, messages: f.messages, effort: f.effort, maxTokens: f.maxTokens, format: f.format }, opts);
  assert.deepEqual(f.key, { route: "fix_check", expected: true, decision: "applied" });
  assert.equal(fixCheckFrozen(lecture, { ...p, state: "withdrawn" }, slidesText).key.route === "fix_check" && (fixCheckFrozen(lecture, { ...p, state: "withdrawn" }, slidesText).key as { expected: boolean }).expected, false);
  const prod = recorder();
  await checkCall({ client: prod.client, request: fixCheckRequest({ before: p.before_text, after: p.after_text, slides: slidesText }), stopAt: Date.now() + 30_000, ledger: noLedger });
  assert.deepEqual(await labBody(f, new Map()), withoutFallback(prod.bodies[0]));
});

/* ── Reads: a synthetic exam (exam12.json) and a sheet ── */
const EXAM = JSON.parse(readFileSync(join(FX, "exam", "exam12.json"), "utf8")) as {
  pages: Array<{ n: number; lines: string[] }>;
  units: Array<{ pages: number[]; next: number | null; reply: { questions: Array<Record<string, unknown>>; skipped_open: number } }>;
};
const pathOf = (n: number) => `g1/exams/e1/p${n}.jpg`;
const pageOf = (n: number): ExamPage => ({ n, path: pathOf(n), w: 1500, h: 2121, lines: EXAM.pages[n - 1]?.lines ?? [], url: signedOf(pathOf(n)) });
const unit0 = EXAM.units[0];
const reference = unit0.reply.questions.map((q) => ({
  id: String(q.no),
  question: `${q.vignette ?? ""} ${q.question}`.trim(),
  options: (q.options as string[]).length,
  figure: Number((q.figure as { page?: number } | undefined)?.page ?? 0) > 0,
  page: Number(q.page),
}));
const readUnit = (kind: "exam" | "sheet"): ReadUnit => ({
  exam: { id: "e1", group_id: "g1", title: "מועד א׳ בדוי", key_source: "separate", kind, lecture_id: null, course: "" },
  pages: unit0.pages.map(pageOf),
  prev: null,
  next: unit0.next !== null ? pageOf(unit0.next) : null,
  seen: [],
  seenLabels: [],
  reference,
});
const urlsOf = (u: ReadUnit) => new Map([...u.pages, ...(u.next ? [u.next] : [])].map((p) => [p.path, p.url!]));

test("exam_read and sheet_read: the reader's own request (unitCall, sheetCall), the pages kept as paths", () => {
  for (const route of ["exam_read", "sheet_read"] as const) {
    const u = readUnit(route === "exam_read" ? "exam" : "sheet");
    const f = readFrozen(route, u)!;
    assert.ok(f, route);
    assert.ok(!JSON.stringify(f).includes("token="), `${route}: no signed link is frozen`);
    assert.deepEqual(picturePaths(f).sort(), [...u.pages, u.next!].map((p) => p.path).sort());
    const claim: ExamClaim = {
      job: "lab", kind: "read", reader: route === "exam_read" ? "exam" : "sheet", lease: "lab", attempt: 1, last_error: null,
      exam: u.exam, pages: u.pages, next: u.next, prev: null, seen: [], seen_labels: route === "sheet_read" ? [] : null, items: null,
    };
    const call = (route === "exam_read" ? unitCall(claim) : sheetCall(claim))!;
    const t = thaw(f, urlsOf(u))!;
    // As runExamUnit sends it: the system cached, the content as the user turn, the schema as the format.
    assert.deepEqual(t.system, [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }]);
    assert.deepEqual(t.messages, [{ role: "user", content: call.content }]);
    assert.equal(t.maxTokens, call.maxTokens);
    assert.equal(t.effort, call.effort);
    assert.deepEqual(t.format, { type: "json_schema", schema: call.schema });
    assert.equal(f.imageTokens, call.imageTokens);
    assert.equal(f.kind, "exam");
    assert.deepEqual(f.material.pages, u.pages.map((p) => ({ n: p.n, path: p.path })));
    // A page without a good link: no request (the op answers "pictures").
    assert.equal(readFrozen(route, { ...u, pages: u.pages.map((p, i) => (i === 0 ? { ...p, url: null } : p)) }), null);
    // A picture that cannot be signed at call time: no call.
    assert.equal(thaw(f, new Map()), null);
  }
});

test("estimates: the worst case per model; an unverified price × 1.5; the run is their sum", async () => {
  const f = solverFrozen(lecture, bank);
  const opus = labEstimate(f, DEFAULT_MODEL);
  const chars = f.system.reduce((n, b) => n + b.text.length, 0) + JSON.stringify(f.format!.schema).length + JSON.stringify(f.messages).length;
  assert.ok(opus > 0 && opus <= estimateUsd(DEFAULT_MODEL, chars, f.maxTokens, f.imageTokens) + 1e-9, String(opus));
  assert.ok(labEstimate(f, "claude-haiku-5-5") < opus / 5, "Haiku is far cheaper");
  const fake: ModelInfo = { ...modelInfo(DEFAULT_MODEL)!, id: "openai:test-model", provider: "openai", verified: false };
  assert.ok(Math.abs(labEstimate(f, DEFAULT_MODEL, (m) => (m === DEFAULT_MODEL ? fake : null)) - opus * 1.5) < 1e-9, "unverified: × 1.5");
  const r = runEstimate(f, [DEFAULT_MODEL, "claude-haiku-5-5"]);
  assert.ok(Math.abs(r.total - (r.perModel[0] + r.perModel[1])) < 1e-12);
  assert.ok(r.total < 0.1, `the question check on 4 questions, Opus and Haiku: ${r.total}`);
  // An exam unit with Fable on four slots goes past the run's $1.50.
  const exam = readFrozen("exam_read", readUnit("exam"))!;
  assert.ok(runEstimate(exam, ["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5"]).total > 0.5);
  const h1 = await requestHash(f);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(await requestHash(solverFrozen(lecture, bank)), h1, "the same request, the same hash");
  assert.notEqual(await requestHash(solverFrozen(lecture, bank.slice(1))), h1);
});

test("checksFor, the question check: matches the bank's keys; a wrong answer is a good question rejected; a picture it did not need is blind", () => {
  const f = solverFrozen(lecture, bank);
  // q1..q4, then q5: q4 again without its picture.
  const right = [
    { id: "q1", choice: 1, ambiguous: false, seq: [] },
    { id: "q2", choice: 0, ambiguous: false, seq: [] },
    { id: "q3", choice: -1, ambiguous: false, seq: [1, 0, 1] },
    { id: "q4", choice: 2, ambiguous: false, seq: [] },
    { id: "q5", choice: 0, ambiguous: true, seq: [] },
  ];
  const all = checksFor(f.key, JSON.stringify({ answers: right }), true);
  assert.deepEqual({ pass: all.pass, items: all.items, match: all.match, false_rejects: all.false_rejects, blind: all.blind }, { pass: true, items: 4, match: 4, false_rejects: 0, blind: 0 });
  const wrong = right.map((a) => (a.id === "q2" ? { ...a, choice: 2 } : a.id === "q5" ? { ...a, choice: 2, ambiguous: false } : a));
  const w = checksFor(f.key, JSON.stringify({ answers: wrong }), true);
  assert.deepEqual({ match: w.match, false_rejects: w.false_rejects, blind: w.blind }, { match: 2, false_rejects: 2, blind: 1 }, "q2 wrong; q4 solved without its picture too");
  const cut = checksFor(f.key, JSON.stringify({ answers: right.slice(0, 2) }).slice(0, -2), false);
  assert.equal(cut.pass, false, "an answer cut off cannot be read");
  const half = checksFor(f.key, JSON.stringify({ answers: right.slice(0, 2) }), false);
  assert.deepEqual({ items: half.items, match: half.match, missing: half.missing }, { items: 2, match: 2, missing: 2 }, "a stopped answer: what it did not reach is not judged");
  assert.equal(checksFor(f.key, "לא JSON", true).pass, false);
});

test("checksFor, fix_check: agreement with the group's decision", () => {
  const p = { id: "p1", lecture_id: "l1", part_idx: 0, before_text: "א", after_text: "ב", source_slides: [2], state: "applied" as const };
  const applied = fixCheckFrozen(lecture, p, "x").key;
  const withdrawn = fixCheckFrozen(lecture, { ...p, state: "withdrawn" }, "x").key;
  assert.deepEqual(checksFor(applied, '{"ok":true,"note":""}', true), { pass: true, items: 1, match: 1, false_rejects: 0, agrees: true, ok: true });
  assert.equal(checksFor(applied, '{"ok":false,"note":"לא תואם"}', true).false_rejects, 1);
  assert.equal(checksFor(withdrawn, '{"ok":false,"note":"לא תואם"}', true).match, 1);
  assert.equal(checksFor(withdrawn, '{"ok":true,"note":""}', true).match, 0);
  assert.equal(checksFor(applied, '{"ok":', false).pass, false);
});

test("checksFor, exam_read and sheet_read: numbering, options, the text copied (90% alike), figures", () => {
  const f = readFrozen("exam_read", readUnit("exam"))!;
  const exact = checksFor(f.key, JSON.stringify(unit0.reply), true);
  assert.equal(exact.pass, true);
  assert.equal(exact.items, reference.length);
  assert.equal(exact.match, reference.length);
  assert.equal(exact.extra, 0);
  const changed = { ...unit0.reply, questions: unit0.reply.questions.map((q, i) => (i === 0 ? { ...q, question: "שאלה אחרת לגמרי שלא הועתקה נכון מהעמוד" } : i === 1 ? { ...q, options: (q.options as string[]).slice(0, 2) } : q)) };
  const c = checksFor(f.key, JSON.stringify(changed), true);
  assert.equal(c.match, reference.length - 2);
  assert.equal(c.copied, reference.length - 1);
  assert.equal(c.options, reference.length - 1);
  assert.equal(checksFor(f.key, JSON.stringify({ ...unit0.reply, questions: unit0.reply.questions.slice(1) }), true).numbered, reference.length - 1);
  // A sheet's items by label.
  const s = readFrozen("sheet_read", { ...readUnit("sheet"), reference: [{ id: "3א", question: "מה הערך (בדוי)?", options: 0, figure: false, page: 1 }] })!;
  const sheetReply = {
    questions: [{ label: "3א", parent: "3", part: 1, form: "numeric", stem: "", question: "מה הערך (בדוי)?", options: [], prompts: [], answer: -1, seq: [], has_num: false, num: 0, unit_hint: "", marked_by: "none", figures: [], parse_conf: 3, page: 1, idx: 0, cut: false }],
    skipped: 0,
    solutions_from_page: 0,
  };
  const sc = checksFor(s.key, JSON.stringify(sheetReply), true);
  assert.deepEqual({ pass: sc.pass, items: sc.items, match: sc.match }, { pass: true, items: 1, match: 1 });
  assert.ok(similarity("אבגד הוזח", "אבגד הוזח ") === 1 && similarity("abc", "xyz") === 0 && similarity("", "") === 1);
});

test("labRefusal: what may answer a comparison (unverified and expensive may; Mythos and unknown ids may not)", () => {
  const none = { providers: {}, pictures: false };
  assert.equal(labRefusal(DEFAULT_MODEL, "solver", none), null);
  assert.equal(labRefusal("claude-fable-5-2", "exam_read", { ...none, pictures: true }), null, "expensive: in comparisons only (OD14)");
  assert.equal(labRefusal("claude-mythos-5-2", "solver", none), "bad model");
  assert.equal(labRefusal("nobody-1", "solver", none), "bad model");
  const gpt: ModelInfo = { ...modelInfo(DEFAULT_MODEL)!, id: "openai:t", provider: "openai", verified: false, vision: false };
  const info = (m: string) => (m === "openai:t" ? gpt : modelInfo(m));
  assert.equal(labRefusal("openai:t", "solver", { ...none, info, ready: () => false }), "not configured");
  assert.equal(labRefusal("openai:t", "solver", { ...none, info, ready: () => true }), "not allowed");
  assert.equal(labRefusal("openai:t", "solver", { providers: { openai: { allowed: true, scope: "all" } }, pictures: false, info, ready: () => true }), null, "unverified: allowed in comparisons, × 1.5");
  assert.equal(labRefusal("openai:t", "exam_read", { providers: { openai: { allowed: true, scope: "text" } }, pictures: true, info, ready: () => true }), "not for this kind");
  assert.equal(labRefusal("openai:t", "exam_read", { providers: { openai: { allowed: true, scope: "all" } }, pictures: true, info, ready: () => true }), "no vision");
});

test("statusOf and the labels", () => {
  assert.deepEqual(statusOf({ stop: "end_turn", timedOut: false }, false), { status: "done", reason: null });
  assert.deepEqual(statusOf({ stop: "max_tokens", timedOut: false }, false), { status: "truncated", reason: null });
  assert.deepEqual(statusOf({ stop: "refusal", timedOut: false }, false), { status: "refused", reason: null });
  assert.deepEqual(statusOf({ stop: "timeout", timedOut: true }, false), { status: "timeout", reason: null });
  assert.deepEqual(statusOf({ stop: "aborted", timedOut: false }, true), { status: "error", reason: "cancelled" });
  assert.deepEqual(statusOf(null, false), { status: "error", reason: null });
  const labels = ["א", "ב", "ג", "ד"];
  for (let i = 0; i < 20; i++) assert.deepEqual(shuffled(labels).sort(), [...labels].sort(), "a permutation");
});
