import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import ai from "../../api/study/ai.js";
import {
  SIMILAR_ITEM_PER,
  SIMILAR_JOB_ROOTS,
  SIMILAR_PROMPT_CHARS,
  similarCheckTokens,
  similarGenTokens,
  similarJobs,
  similarPriceUsd,
  similarWorstUsd,
} from "../../shared/study/sheetPrice.js";
import { monthlyCap, POLICY, similarMonthlyCap } from "./budget.js";
import { perOf, shapesOf, type SimilarPlan } from "./ops/similar.js";
import { BLIND_SYSTEM, SIMILAR_SYSTEM } from "./prompts/sheets.js";
import type { SimilarTwinOut } from "./questions.js";
import { blindCall, blindVerdicts, keyText, runSimilarJob, similarCall, toTwins, type SimilarClaim, type SimilarClaimRoot, type Twin } from "./similarGen.js";
import { MODEL, OP_SCHEMA, REQUIRED_SCHEMA, schemaFor, serverClient, SIMILAR_MODEL, VARIANT_SCHEMA } from "./study.js";

/* Similar questions on the server (section O 3; docs/study/sheets.md):
 * the prompts' and the job's numbers pinned to the shared price and the
 * SQL, the pure checks a twin passes before it is saved, the blind check,
 * the price and the worst case, the budget's policy and line, and the
 * worker's job and the op against local mocks of Supabase and the API.
 * Synthetic text only. */

const GROUP = "22222222-0000-4000-8000-000000000002";
const SHEET = "55555555-0000-4000-8000-000000000005";
const USER = "11111111-0000-4000-8000-0000000000aa";
const KEY = "k-0123456789abcdef0123456789abcdef";

const part = (o: Partial<SimilarClaimRoot["parts"][number]> = {}): SimilarClaimRoot["parts"][number] => ({
  id: "p1",
  step: null,
  label: "1",
  form: "one",
  question: "מה נפח ההפצה של תרופה X במטופל שמשקלו 70 ק״ג (בדוי)?",
  options: ["5 ל", "10 ל", "20 ל", "40 ל"],
  prompts: [],
  answer: 2,
  seq: null,
  num: null,
  num_unit: null,
  num_tol: null,
  explanations: [],
  takeaway: "",
  solution: "Vd = dose / C (בדוי)",
  figures: [],
  ...o,
});
const root = (o: Partial<SimilarClaimRoot> = {}): SimilarClaimRoot => ({
  id: "r1",
  label: "1",
  kind: "mcq",
  vignette: "",
  topic: "",
  aspect: "pk",
  difficulty: 2,
  parts: [part()],
  pages: [],
  twins: [],
  ...o,
});
const twinPart = (o: Partial<SimilarTwinOut["parts"][number]> = {}): SimilarTwinOut["parts"][number] => ({
  question: "מטופלת בדויה קיבלה מנה של 300 מ״ג ותרופה Y הגיעה לריכוז 15 מ״ג/ל. מה נפח ההפצה?",
  options: ["2 ל", "20 ל", "200 ל", "0.2 ל"],
  prompts: [],
  answer: 1,
  seq: [],
  has_num: false,
  num: 0,
  unit: "",
  tol: 0,
  calc: { inputs: [], formula: "" },
  whys: ["קטן מדי", "נכון: 300/15", "גדול מדי", "קטן מדי"],
  solution: "300/15 = 20 ל",
  ...o,
});
const twin = (o: Partial<SimilarTwinOut> = {}): SimilarTwinOut => ({ ref: 1, vignette: "", reuse_figure: false, takeaway: "Vd = מנה חלקי ריכוז", parts: [twinPart()], ...o });

// ── The numbers the phone, the op and the SQL share ──

test("the prompts' lengths, the job's size and the caps are the shared ones (and the SQL's)", () => {
  assert.deepEqual({ gen: SIMILAR_SYSTEM.length, blind: BLIND_SYSTEM.length }, SIMILAR_PROMPT_CHARS);
  const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  const fn = /create or replace function study_private\.similar_job_roots\(\)\nreturns int language sql immutable as \$\$ select (\d+) \$\$;/.exec(sql);
  assert.equal(Number(fn?.[1]), SIMILAR_JOB_ROOTS, "study_private.similar_job_roots() is SIMILAR_JOB_ROOTS");
  assert.equal(SIMILAR_JOB_ROOTS, 4, "the sheet solver's measured unit (sheets.md)");
  assert.deepEqual(similarJobs([1, 2, 3, 4, 5, 6, 7, 8, 9], "sheet"), [[1, 2, 3, 4], [5, 6, 7, 8], [9]]);
  assert.deepEqual(similarJobs([1], "item"), [[1]]);
  assert.equal(SIMILAR_MODEL, MODEL, "the current default model (OD17; Y routes the key similar later)");
  assert.deepEqual(VARIANT_SCHEMA.similar, { O: 3, L: 1 });
  assert.ok(!Object.hasOwn(OP_SCHEMA, "similar"), "not one of §12.2.2's ops");
  assert.deepEqual(schemaFor("similar"), { ...REQUIRED_SCHEMA, O: 3, L: 1 }, "the router asks for it by the op's name");
});

test("the budget: POLICY.similar (80% line, 40% a member, 10 taps a day by ref ask); the similar line from STUDY_SIMILAR_MONTHLY_USD, 5 by default", () => {
  assert.deepEqual(POLICY.similar, { share: 0.8, memberShare: 0.4, daily: 10, dailyRef: "ask" });
  const was = process.env.STUDY_SIMILAR_MONTHLY_USD;
  delete process.env.STUDY_SIMILAR_MONTHLY_USD;
  assert.equal(similarMonthlyCap(), 5);
  process.env.STUDY_SIMILAR_MONTHLY_USD = "3.5";
  assert.equal(similarMonthlyCap(), 3.5);
  process.env.STUDY_SIMILAR_MONTHLY_USD = "nonsense";
  assert.equal(similarMonthlyCap(), 5);
  if (was === undefined) delete process.env.STUDY_SIMILAR_MONTHLY_USD;
  else process.env.STUDY_SIMILAR_MONTHLY_USD = was;
});

test("the price: about $0.08 for 2 twins of an item, about $0.5 for 14 roots; the worst case above it and inside the $5 line for the 24-root cap", () => {
  const item = similarPriceUsd({ roots: [{ parts: 1, numeric: 0, pages: 0 }], per: SIMILAR_ITEM_PER, scope: "item" });
  assert.ok(item >= 0.05 && item <= 0.12, `item ${item}`);
  const fourteen = similarPriceUsd({ roots: Array.from({ length: 14 }, () => ({ parts: 1, numeric: 0, pages: 0 })), per: 1, scope: "sheet" });
  assert.ok(fourteen >= 0.3 && fourteen <= 0.8, `14 roots ${fourteen}`);
  const numeric = similarPriceUsd({ roots: [{ parts: 1, numeric: 1, pages: 0 }], per: 2, scope: "item" });
  assert.ok(numeric < item, "a numeric root needs no check call");
  const shapes = Array.from({ length: 24 }, () => ({ parts: 1, numeric: 0, pages: 1 }));
  const worst24 = similarWorstUsd({ roots: shapes, per: 1, scope: "sheet" }, MODEL);
  assert.ok(worst24 > similarPriceUsd({ roots: shapes, per: 1, scope: "sheet" }) && worst24 < 5, `24 roots worst ${worst24}`);
  assert.ok(similarWorstUsd({ roots: shapes, per: 1, scope: "sheet", deckChars: 60_000 }, MODEL) > worst24, "the slides are in the worst case");
  assert.equal(similarGenTokens(2), 5_500);
  assert.equal(similarCheckTokens(4), 2_600);
  assert.ok(similarGenTokens(40) <= 14_000 && similarCheckTokens(40) <= 6_000);
});

test("the plan's shapes and the twins a root on a tap", () => {
  const item: SimilarPlan = { scope: "item", root: "r", parts: 2, numeric: 1, pages: [3], room: 1, joined: null };
  assert.deepEqual(shapesOf(item), [{ parts: 2, numeric: 1, pages: 1 }]);
  assert.equal(perOf(item), 1, "only one fits under the 6");
  assert.equal(perOf({ ...item, room: 6 }), 2);
  const sheet: SimilarPlan = { scope: "sheet", roots: [{ id: "a", parts: 1, numeric: 0, pages: [] }, { id: "b", parts: 3, numeric: 0, pages: [1, 2] }], joined: null };
  assert.deepEqual(shapesOf(sheet), [{ parts: 1, numeric: 0, pages: 0 }, { parts: 3, numeric: 0, pages: 2 }]);
  assert.equal(perOf(sheet), 1);
});

// ── The pure checks ──

test("toTwins: the root's form, option count and key kept; too close to the root or another twin, or past per: dropped", () => {
  const roots = [root()];
  const good = twin();
  const r = toTwins(roots, [good, twin({ parts: [twinPart({ options: ["א", "ב", "ג"] })] }), twin({ parts: [twinPart({ answer: 7 })] })], 2);
  assert.equal(r.twins.length, 1);
  assert.equal(r.dropped, 2, "three options for four, and an answer out of range");
  assert.deepEqual([r.twins[0].check, r.twins[0].parts[0].answer, r.twins[0].parts[0].explanations.length], ["blind", 1, 4]);
  // A copy of the root's stem is not a new question.
  const copy = toTwins(roots, [twin({ parts: [twinPart({ question: roots[0].parts[0].question })] })], 2);
  assert.deepEqual([copy.twins.length, copy.dropped], [0, 1]);
  // Two near copies of each other: the second goes; and an existing twin counts too.
  const again = toTwins(roots, [good, twin({ parts: [twinPart({ question: good.parts[0].question + " " })] })], 2);
  assert.deepEqual([again.twins.length, again.dropped], [1, 1]);
  const old = toTwins([root({ twins: [good.parts[0].question] })], [good], 2);
  assert.deepEqual([old.twins.length, old.dropped], [0, 1]);
  // At most per a root; a ref the call did not have is dropped.
  const many = toTwins(roots, [good, twin({ parts: [twinPart({ question: "שאלה אחרת לגמרי על פינוי של תרופה בדויה בכליה, במטופל אחר" })] }), twin({ ref: 3 })], 1);
  assert.deepEqual([many.twins.length, many.dropped], [1, 2]);
});

test("toTwins: true/false, match and order keep their sizes and a key that fits; a figure reused only when the root has one", () => {
  const tf = root({ parts: [part({ form: "tf", options: ["משפט א", "משפט ב", "משפט ג"], answer: null, seq: [1, 0, 1] })] });
  const okTf = toTwins([tf], [twin({ parts: [twinPart({ options: ["חדש א", "חדש ב", "חדש ג"], answer: -1, seq: [0, 0, 1], whys: [] })] })], 2);
  assert.deepEqual([okTf.twins.length, okTf.twins[0].parts[0].seq], [1, [0, 0, 1]]);
  assert.equal(toTwins([tf], [twin({ parts: [twinPart({ options: ["חדש א", "חדש ב", "חדש ג"], answer: -1, seq: [0, 2, 1] })] })], 2).dropped, 1);
  const match = root({ parts: [part({ form: "match", options: ["A", "B", "C"], prompts: ["1", "2"], answer: null, seq: [2, 0] })] });
  const m = (seq: number[], prompts = ["פריט א", "פריט ב"]) => toTwins([match], [twin({ parts: [twinPart({ options: ["X", "Y", "Z"], prompts, answer: -1, seq })] })], 2);
  assert.equal(m([1, 0]).twins.length, 1);
  assert.equal(m([1, 1]).dropped, 1, "an option twice");
  assert.equal(m([1, 0], ["רק אחד"]).dropped, 1, "fewer prompts");
  const order = root({ parts: [part({ form: "order", options: ["s1", "s2", "s3"], answer: null, seq: [2, 0, 1] })] });
  const o = (seq: number[]) => toTwins([order], [twin({ parts: [twinPart({ options: ["שלב א", "שלב ב", "שלב ג"], answer: -1, seq })] })], 2);
  assert.equal(o([1, 2, 0]).twins.length, 1);
  assert.equal(o([1, 2, 2]).dropped, 1);
  const noFig = toTwins([root()], [twin({ reuse_figure: true })], 2);
  assert.equal(noFig.twins[0].reuse_figure, false);
  const withFig = toTwins([root({ parts: [part({ figures: ["pg:1:1,1,10,10"] })] })], [twin({ reuse_figure: true })], 2);
  assert.equal(withFig.twins[0].reuse_figure, true);
});

test("toTwins: a numeric part is recomputed from its working; a mismatch drops the twin; a twin with parts needs every part", () => {
  const num = root({ parts: [part({ form: "numeric", options: [], answer: null, num: 6.93, num_unit: "ל/ש" })] });
  const n = (num: number, formula: string) =>
    twinPart({ question: "חשבו את הפינוי של תרופה Z בדויה: k = 0.1 לשעה, Vd = 50 ל", options: [], answer: -1, has_num: true, num, unit: "ל/ש", tol: 1, whys: [], calc: { inputs: [{ name: "k", value: 0.1 }, { name: "vd", value: 50 }], formula } });
  const good = toTwins([num], [twin({ parts: [n(5, "k * vd")] })], 2);
  assert.deepEqual([good.twins.length, good.twins[0].check, good.twins[0].parts[0].num, good.twins[0].parts[0].num_unit], [1, "recalc", 5, "ל/ש"]);
  assert.equal(toTwins([num], [twin({ parts: [n(7, "k * vd")] })], 2).dropped, 1, "the working gives 5, not 7");
  assert.equal(toTwins([num], [twin({ parts: [n(5, "process.exit()")] })], 2).dropped, 1, "never evaluated as code");
  const two = root({ parts: [part(), part({ id: "p2", step: 2, form: "numeric", options: [], answer: null, num: 250 })] });
  const both = toTwins([two], [twin({ vignette: "מטופל בדוי חדש", parts: [twinPart(), n(5, "k * vd")] })], 2);
  assert.deepEqual([both.twins.length, both.twins[0].check, both.twins[0].parts.length], [1, "blind", 2]);
  assert.equal(toTwins([two], [twin({ parts: [twinPart()] })], 2).dropped, 1, "one part for two");
  assert.equal(toTwins([two], [twin({ parts: [twinPart(), n(9, "k * vd")] })], 2).dropped, 1, "a part that does not recompute");
});

test("the blind check: every choice part with its key and a confidence of 2 or more; numeric parts are not asked", () => {
  const roots = [root(), root({ id: "r2", parts: [part(), part({ id: "p2", form: "numeric", options: [], answer: null, num: 1 })] })];
  const t1: Twin = { root: "r1", check: "blind", reuse_figure: false, vignette: "", parts: [{ form: "one", question: "ש1", options: ["a", "b"], prompts: [], answer: 1, seq: [], explanations: [], takeaway: "", solution: "" }] };
  const t2: Twin = {
    root: "r2",
    check: "blind",
    reuse_figure: false,
    vignette: "מקרה",
    parts: [
      { form: "tf", question: "ש2", options: ["a", "b"], prompts: [], answer: -1, seq: [1, 0], explanations: [], takeaway: "", solution: "" },
      { form: "numeric", question: "ש3", options: [], prompts: [], answer: -1, seq: [], num: 1, explanations: [], takeaway: "", solution: "" },
    ],
  };
  const { call, asked } = blindCall([t1, t2], roots);
  assert.deepEqual(asked.map((a) => `${a.ref}.${a.part}`), ["1.1", "2.1"]);
  assert.equal(call.system, BLIND_SYSTEM);
  assert.equal(call.maxTokens, similarCheckTokens(2));
  const text = (call.content[0] as { text: string }).text;
  assert.ok(text.includes("Ref 2, part 1 (form tf):\nמקרה\nש2") && !text.includes("ש3"), text);
  assert.ok(!/answer|key/i.test(text.replace(/form \w+/g, "")), "no key in the request");
  const a = (ref: number, part: number, answer: number, seq: number[], conf: number) => ({ ref, part, answer, seq, conf });
  assert.deepEqual(blindVerdicts([t1, t2], [a(1, 1, 1, [], 3), a(2, 1, -1, [1, 0], 2)]), [true, true]);
  assert.deepEqual(blindVerdicts([t1, t2], [a(1, 1, 0, [], 3), a(2, 1, -1, [1, 0], 1)]), [false, false], "another answer; too unsure");
  assert.deepEqual(blindVerdicts([t1, t2], []), [false, false], "unanswered");
});

test("the writing call: each root with its key and solution; a root whose figure has no fresh link is left out; its pictures when it has", () => {
  const claimLike = (items: SimilarClaimRoot[]) => ({ exam: { id: SHEET, group_id: GROUP, title: "תרגיל 4", course: "פרמקו", lecture_id: null }, run: claimRun(), items });
  const fig = root({ id: "r2", label: "2", parts: [part({ figures: ["pg:3:1,1,10,10"] })], pages: [{ n: 3, path: `${GROUP}/exams/${SHEET}/p3.jpg`, w: 1061, h: 1500, url: null }] });
  const a = similarCall(claimLike([root(), fig]));
  assert.deepEqual([a.roots.map((r) => r.id), a.skipped], [["r1"], 1]);
  const text = (a.call!.content[0] as { text: string }).text;
  assert.ok(text.includes("Write 2 new questions for each source") && text.includes("Key: ג") && text.includes("Solution: Vd = dose / C (בדוי)"), text);
  assert.equal(a.call!.maxTokens, similarGenTokens(2));
  assert.equal(a.call!.system, SIMILAR_SYSTEM);
  const none = similarCall(claimLike([fig]));
  assert.equal(none.call, null);
  assert.equal(keyText(part({ form: "tf", seq: [1, 0] })), "1: נכון, 2: לא נכון");
  assert.equal(keyText(part({ form: "numeric", num: 4.5, num_unit: "mg" })), "4.5 mg");
});

// ── The worker's job and the op, against local mocks ──

type Logged = { who: "rest" | "anthropic"; path: string; body: any };
let log: Logged[] = [];
let replies: unknown[] = [];
let REST = "";
let ANTHROPIC = "";
let chargeFits: boolean[] = [];
let rpcAnswers: Record<string, unknown> = {};
let schemaBody: unknown = {};
const rpcs = (name: string) => log.filter((l) => l.who === "rest" && l.path === `/rest/v1/rpc/${name}`);
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
const rest = createServer(async (req, res) => {
  const raw = await readAll(req);
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const body = raw ? JSON.parse(raw) : null;
  log.push({ who: "rest", path, body });
  if (path === "/auth/v1/user") return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated" });
  if (path === "/rest/v1/rpc/study_schema") return send(res, 200, schemaBody);
  if (path === "/rest/v1/rpc/study_similar_charge") return send(res, 200, chargeFits.length ? chargeFits.shift() : true);
  if (path === "/rest/v1/study_exams") return send(res, 200, [{ group_id: GROUP, lecture_id: null }]);
  const name = path.replace("/rest/v1/rpc/", "");
  if (Object.hasOwn(rpcAnswers, name)) {
    const a = rpcAnswers[name];
    return a instanceof Error ? send(res, 400, { code: "P0001", message: a.message, details: null, hint: null }) : send(res, 200, a);
  }
  send(res, 404, { message: `unmocked ${path}` });
});
const ev = (e: object & { type: string }) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const anthropic = createServer(async (req, res) => {
  const body = JSON.parse(await readAll(req));
  log.push({ who: "anthropic", path: req.url ?? "", body });
  res.writeHead(200, { "content-type": "text/event-stream" });
  const text = JSON.stringify(replies.shift() ?? {});
  const usage = { input_tokens: 3000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 };
  res.write(ev({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage } }));
  res.write(ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  for (let i = 0; i < text.length; i += 200) res.write(ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 200) } }));
  res.write(ev({ type: "content_block_stop", index: 0 }));
  res.write(ev({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 800 } }));
  res.end(ev({ type: "message_stop" }));
});
const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as AddressInfo).port)));
before(async () => {
  const [r, a] = await Promise.all([listen(rest), listen(anthropic)]);
  REST = `http://127.0.0.1:${r}`;
  ANTHROPIC = `http://127.0.0.1:${a}`;
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
  delete process.env.STUDY_SIMILAR_MONTHLY_USD;
  log = [];
  replies = [];
  chargeFits = [];
  schemaBody = { ...REQUIRED_SCHEMA, O: 3, L: 1 };
  rpcAnswers = {
    study_similar_save: { saved: 1, dropped: 1 },
    study_finish_similar_job: true,
    study_reserve: 41,
    study_settle: true,
  };
});

const claimRun = (): SimilarClaim["run"] => ({ id: "run-1", scope: "item", per: 2, requester: USER, reserved_usd: 0.3, charged_usd: 0, left_usd: 0.3, set_id: "set-1" });
const claim = (o: Partial<SimilarClaim> = {}): SimilarClaim => ({
  job: "job-1",
  lease: "44444444-0000-4000-8000-000000000001",
  attempt: 1,
  last_error: null,
  run: claimRun(),
  exam: { id: SHEET, group_id: GROUP, title: "תרגיל 4", course: "פרמקו", lecture_id: null },
  lecture: null,
  items: [root()],
  ...o,
});
const other = twinPart({ question: "מטופל בדוי אחר קיבל 1000 מ״ג וריכוז התרופה W היה 25 מ״ג/ל. מה נפח ההפצה שלה?", options: ["4 ל", "40 ל", "400 ל", "0.4 ל"] });

test("a job: one writing call and one blind check, each charged to the run; the twin that passed is saved, the other dropped; the job is done", async () => {
  replies = [{ twins: [twin(), twin({ parts: [other] })] }, { answers: [{ ref: 1, part: 1, answer: 1, seq: [], conf: 3 }, { ref: 2, part: 1, answer: 0, seq: [], conf: 3 }] }];
  const r = await runSimilarJob(serverClient(), claim(), { stopAt: Date.now() + 60_000 });
  assert.equal(r.status, "done", String(r.error));
  const calls = log.filter((l) => l.who === "anthropic");
  assert.deepEqual(calls.map((c) => c.body.system[0].text), [SIMILAR_SYSTEM, BLIND_SYSTEM]);
  const charges = rpcs("study_similar_charge");
  assert.equal(charges.length, 2);
  assert.ok(charges[0].body.p_next_worst > 0 && charges[1].body.p_next_worst === 0, "the writing call's charge asks whether the check still fits");
  assert.ok(charges.every((c) => c.body.p_key === KEY && c.body.p_cost > 0 && c.body.p_job === "job-1"));
  const save = rpcs("study_similar_save")[0].body;
  assert.deepEqual([save.p_twins.length, save.p_twins[0].check, save.p_twins[0].root, save.p_dropped, save.p_model], [1, "blind", "r1", 1, MODEL]);
  assert.equal(rpcs("study_finish_similar_job")[0].body.p_status, "done");
  assert.equal(rpcs("study_reserve").length, 0, "the worker reserves nothing: the run is reserved already");
});

test("a job whose run is spent after the writing call: numeric twins are saved, the rest dropped unchecked; it stops as reserve_used", async () => {
  const num = root({ id: "r1", parts: [part({ form: "numeric", options: [], answer: null, num: 6.93 })] });
  const ch = root({ id: "r2", label: "2" });
  const n = twinPart({ question: "חשבו את הפינוי של תרופה Z בדויה: k = 0.1 לשעה, Vd = 50 ל", options: [], answer: -1, has_num: true, num: 5, unit: "ל/ש", tol: 1, whys: [], calc: { inputs: [{ name: "k", value: 0.1 }, { name: "vd", value: 50 }], formula: "k * vd" } });
  replies = [{ twins: [twin({ parts: [n] }), twin({ ref: 2 })] }];
  chargeFits = [false];
  const r = await runSimilarJob(serverClient(), claim({ run: { ...claimRun(), scope: "sheet", per: 1 }, items: [num, ch] }), { stopAt: Date.now() + 60_000 });
  assert.deepEqual([r.status, r.error], ["failed", "reserve_used"]);
  assert.equal(log.filter((l) => l.who === "anthropic").length, 1, "no check call");
  const save = rpcs("study_similar_save")[0].body;
  assert.deepEqual([save.p_twins.map((t: Twin) => t.check), save.p_dropped], [["recalc"], 1]);
});

test("a job whose first call would not fit what is left: nothing is called", async () => {
  const r = await runSimilarJob(serverClient(), claim({ run: { ...claimRun(), left_usd: 0.001 } }), { stopAt: Date.now() + 60_000 });
  assert.deepEqual([r.status, r.error], ["failed", "reserve_used"]);
  assert.equal(log.filter((l) => l.who === "anthropic").length, 0);
});

test("a sheet with a lecture: the check is the slides' solver, made as kind similar, and the twin is saved as checked by the slides", async () => {
  const lecture = { id: "l1", title: "פרמקוקינטיקה (בדוי)", lecturer: "", slides: [{ n: 1, title: "נפח הפצה", lines: ["Vd = dose / C"], tables: [], notes: "", figures: [] }] };
  replies = [{ twins: [twin()] }, { answers: [{ id: "q1", choice: 1, ambiguous: false, seq: [] }] }];
  const r = await runSimilarJob(serverClient(), claim({ lecture, exam: { ...claim().exam, lecture_id: "l1" } }), { stopAt: Date.now() + 60_000 });
  assert.equal(r.status, "done", String(r.error));
  const calls = log.filter((l) => l.who === "anthropic");
  assert.ok(calls[1].body.system.some((b: { text: string }) => b.text.includes("Vd = dose / C")), "the slides go with the check");
  assert.equal(rpcs("study_similar_save")[0].body.p_twins[0].check, "slides");
});

const post = (body: unknown) =>
  ai.fetch(new Request("http://localhost/api/study/ai", { method: "POST", headers: { authorization: "Bearer x.y.z", "content-type": "application/json" }, body: JSON.stringify(body) }));
const itemPlan = { scope: "item", root: "r1", parts: 1, numeric: 0, count: 0, room: 6, twins: [], pages: [], joined: null };

test("op similar on a database without O 3: 503 schema, nothing reserved", async () => {
  // First of the op's tests: study.ts caches a passed schema check for the process.
  schemaBody = { ...REQUIRED_SCHEMA, O: 2, L: 1 };
  const res = await post({ op: "similar", examId: SHEET, scope: "item", questionId: SHEET });
  assert.equal(res.status, 503);
  assert.equal(rpcs("study_reserve").length, 0);
});

test("op similar: the worst case reserved under the member (kind similar, ref ask), the run begun with it and the similar line; 202", async () => {
  rpcAnswers.study_similar_plan = itemPlan;
  rpcAnswers.study_similar_begin = { run_id: "run-9", set_id: "set-9", jobs: 1, items: 1, per: 2, server: true };
  process.env.STUDY_SIMILAR_MONTHLY_USD = "4";
  const res = await post({ op: "similar", examId: SHEET, scope: "item", questionId: SHEET });
  assert.equal(res.status, 202, await res.clone().text());
  const b = (await res.json()) as { runId: string; priceUsd: number; worstUsd: number };
  const worst = similarWorstUsd({ roots: [{ parts: 1, numeric: 0, pages: 0 }], per: 2, scope: "item" }, MODEL);
  assert.deepEqual([b.runId, b.worstUsd, b.priceUsd], ["run-9", worst, similarPriceUsd({ roots: [{ parts: 1, numeric: 0, pages: 0 }], per: 2, scope: "item" })]);
  const rs = rpcs("study_reserve")[0].body;
  assert.deepEqual([rs.p_kind, rs.p_ref, rs.p_estimate, rs.p_member_share, rs.p_daily, rs.p_daily_ref, rs.p_share], ["similar", "ask", worst, 0.4, 10, "ask", 0.8]);
  const bg = rpcs("study_similar_begin")[0].body;
  assert.deepEqual([bg.p_reserve, bg.p_worst, bg.p_cap, bg.p_per, bg.p_scope, bg.p_key], [41, worst, 4, 2, "item", KEY]);
  assert.equal(rpcs("study_settle").length, 0, "the reservation stays with the run");
  assert.ok(monthlyCap() > 0);
});

test("op similar: twins already there are offered first ($0); a run making them: joined; a refusal at the start lets the reservation go", async () => {
  rpcAnswers.study_similar_plan = { ...itemPlan, twins: ["t1", "t2"], count: 2, room: 4 };
  const free = await post({ op: "similar", examId: SHEET, scope: "item", questionId: SHEET });
  assert.deepEqual([free.status, await free.json()], [200, { twins: ["t1", "t2"] }]);
  rpcAnswers.study_similar_plan = { ...itemPlan, joined: "run-7" };
  const joined = await post({ op: "similar", examId: SHEET, scope: "item", questionId: SHEET, make: true });
  assert.deepEqual([joined.status, await joined.json()], [200, { joined: "run-7" }]);
  assert.equal(rpcs("study_reserve").length, 0);
  rpcAnswers.study_similar_plan = itemPlan;
  rpcAnswers.study_similar_begin = new Error("similar_cap");
  const cap = await post({ op: "similar", examId: SHEET, scope: "item", questionId: SHEET });
  assert.deepEqual([cap.status, ((await cap.json()) as { error: string }).error], [402, "similar_cap"]);
  assert.deepEqual([rpcs("study_settle").length, rpcs("study_settle")[0].body.p_cost], [1, 0], "settled at $0");
  rpcAnswers.study_similar_plan = { scope: "sheet", items: [], roots: [], today: true, joined: null };
  const today = await post({ op: "similar", examId: SHEET, scope: "sheet" });
  assert.equal(today.status, 409);
  rpcAnswers.study_similar_plan = new Error("off");
  assert.equal((await post({ op: "similar", examId: SHEET, scope: "sheet" })).status, 403);
  assert.equal((await post({ op: "similar", examId: "nope", scope: "sheet" })).status, 400);
});
