import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import ai from "../../api/study/ai.js";
import { REQUIRED_SCHEMA } from "./study.js";

/* Op "lab" through /api/study/ai (design-models §7.5, §12.1: "the run
 * response never contains a model id or a per-label status before done"):
 * the owner's gate, the material read with the owner's token, the plan, the
 * claims on the worker's path (no user), the detached slots with their $0
 * checks and the worker's saves, the refusals before and after the plan,
 * retry, resume, route, cancel. Supabase and Anthropic are local stand-ins;
 * every question and exam is synthetic. */

const KEY = "k-0123456789abcdef0123456789abcdef";
const GROUP = "0f000000-0000-4000-8000-0000000000a1";
const LECTURE = "0f000000-0000-4000-8000-0000000000b1";
const RUN = "0f000000-0000-4000-8000-0000000000d1";
const EXAM = "0f000000-0000-4000-8000-0000000000e1";
const USER = "0f000000-0000-4000-8000-000000000001";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (expIn: number) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER, iat: 1, exp: Math.floor(Date.now() / 1000) + expIn })}.sig`;
const TOKEN = jwt(3600);

/* ── The request context @vercel/functions reads ── */
let pending: Promise<unknown>[] = [];
(globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] = {
  get: () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p), deadline: Date.now() + 300_000 }),
};
const drain = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

const FX = join(process.cwd(), "e2e", "study", "fixtures");
const SLIDES = JSON.parse(readFileSync(join(FX, "slides.json"), "utf8")) as Array<{ n: number; title: string; lines: string[] }>;
const EXAM12 = JSON.parse(readFileSync(join(FX, "exam", "exam12.json"), "utf8")) as {
  pages: Array<{ n: number; lines: string[] }>;
  units: Array<{ pages: number[]; next: number | null; reply: { questions: Array<Record<string, unknown>>; skipped_open: number } }>;
};
const lecture = { id: LECTURE, group_id: GROUP, course: "קורס בדוי", title: "משתנים (בדוי)", lecturer: "", lecture_date: null, source_kind: "pptx", slides: SLIDES.map((s) => ({ ...s, tables: [], notes: "", figures: [] })) };
const bank = [
  { id: "q1", vignette: "", question: "מהו אתר הפעולה של משתן בדוי?", options: ["Proximal tubule", "Thick ascending limb", "Collecting duct"], form: "one", prompts: [], style: null, figure: "", answer: 1, seq: null },
  { id: "q2", vignette: "", question: "איזו תופעה צפויה (בדוי)?", options: ["היפוקלמיה", "היפרקלמיה", "היפרנתרמיה"], form: "one", prompts: [], style: null, figure: "", answer: 0, seq: null },
  { id: "q3", vignette: "", question: "מה מעכב המשתן הבדוי?", options: ["NKCC2", "NCC", "ENaC"], form: "one", prompts: [], style: null, figure: "", answer: 0, seq: null },
];

/** A practice question that passes checkQuestion (questions.test.ts's PART1[0], an invented drug). */
const opt = (t: string, why: string, correct = false) => ({ text: t, correct, why, when: "", tag: "", left: "" });
const QUESTION = {
  topic: "Examplomycin", aspect: "mechanism", style: "mechanism", points: [], difficulty: 2, case: false, vignette: "",
  takeaway: "הרגישות של אורגניזם ל-Examplomycin תואמת את פעילות ה-XRD שלו. [ש' 5]",
  question: "מה קובע את מידת הרגישות של אורגניזם ל-Examplomycin?",
  options: [
    opt("פעילות האנזים XRD שלו", "Examplomycin משופעלת בתא על ידי חיזור, והרגישות של אורגניזם לתרופה תואמת את פעילות ה-XRD שלו. [ש' 5]", true),
    opt("פעילות האנזים FHR שלו", "FHR הוא המטרה של Shamtrexate, ולא קשור להפעלת Examplomycin. [ש' 31-32]"),
    opt("כמות ה-Q-tubulin שלו", "Q-tubulin הוא המטרה של ה-Mockazoles, שנקשרות אליו וגורמות לאובדן microtubules בתולעים. [ש' 35]"),
    opt("כמות ה-fictosterol בממברנה שלו", "ל-fictosterol נקשרת Placebrin ויוצרת נקבוביות בממברנה של Fakeomonas. [ש' 13]"),
    opt("פעילות האנזים examplothione reductase שלו", "את examplothione reductase מעכבת Stubamide, וזו מטרה של התרופות נגד Fakeomonas. [ש' 17]"),
  ],
  slides: [5, 13, 17, 31, 32, 35], para: 0, teaser: "", figure: "", resolved: "", stages: [],
};
const lecture38 = { ...lecture, course: "", slides: Array.from({ length: 38 }, (_, i) => ({ n: i + 1, title: `שקף בדוי ${i + 1}`, lines: ["טקסט בדוי"], tables: [], notes: "", figures: [] })) };

/* ── Supabase, as section Y and its neighbours answer ── */
type Logged = { path: string; body: any; auth: string | null; query: string };
let log: Logged[] = [];
let owner = true;
let labOn = true;
let runCap = 1.5;
let claimFail: Record<string, string> = {};
/** study_lab_claim_slots' whole-run check (strict): the line or the 80% line refused before any slot. */
let lineFail = "";
let routesNow: Record<string, { model: string }> = {};
let providersNow: Record<string, { allowed: boolean; scope: string }> = {};
let slotOf: Record<string, { model: string; status: string; tries: number }> = {};
let planned: any = null;
let labels = ["א", "ב"];
let runStatus = "running";
/** The rated kinds' lecture (38 slides, so the stand-in question's tags are real) and what the judge reads. */
let lectureRow: any = null;
let checkOf: Record<string, string> = {};
let texts: Record<string, string> = {};
const SECTION = { idx: 0, title: "חלק בדוי", slide_from: 5, slide_to: 7, status: "ready", gen: 1, error: null, markdown: "## חלק בדוי\n\nExamplomycin משופעלת בתא על ידי חיזור [ש' 5].\n\nהמינון 500 mg [ש' 6]." };
const calls = (name: string) => log.filter((l) => l.path === `/rest/v1/rpc/${name}`);
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const pgError = (message: string) => ({ code: "P0001", details: null, hint: null, message });
const readAll = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
  });
let REST = "";
let ANTHROPIC = "";
const page = (n: number) => ({ n, path: `${GROUP}/exams/${EXAM}/p${n}.jpg`, w: 1500, h: 2121, lines: EXAM12.pages[n - 1].lines, is_key: false });
const examItems = EXAM12.units[0].reply.questions.map((q) => ({
  exam_no: q.no,
  no_label: null,
  vignette: q.vignette,
  question: q.question,
  options: q.options,
  figure: "",
  figures: [],
  page: q.page,
}));

const rest = createServer(async (req, res) => {
  const raw = await readAll(req);
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  const body = raw ? JSON.parse(raw) : null;
  log.push({ path, body, auth: req.headers.authorization ?? null, query: url.search });
  switch (path) {
    case "/auth/v1/user":
      return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated" });
    case "/rest/v1/rpc/study_schema":
      return send(res, 200, { ...REQUIRED_SCHEMA, O: 3, Y: 1 });
    case "/rest/v1/rpc/study_lab_owner":
      return send(res, 200, owner);
    case "/rest/v1/rpc/study_models":
      return send(res, 200, { routes: routesNow, providers: providersNow, switches: { lab: labOn, routes: true }, lab: { line_usd: 3.3, run_cap: runCap, daily_runs: 3 } });
    case "/rest/v1/rpc/study_lab_bank":
      return send(res, 200, { lecture: LECTURE, items: bank });
    case "/rest/v1/study_lectures":
      return send(res, 200, [lectureRow ?? lecture]);
    case "/rest/v1/study_sections":
      return send(res, 200, [SECTION]);
    case "/rest/v1/study_edits":
    case "/rest/v1/rpc/study_course_style_items":
      return send(res, 200, []);
    case "/rest/v1/rpc/study_lab_judge_input":
      return send(res, 200, { route: planned?.p_route, outputs: labels.map((l, i) => ({ label: l, output: `out-${i}`, text: texts[`out-${i}`] ?? "" })) });
    case "/rest/v1/rpc/study_lab_check_save":
    case "/rest/v1/rpc/study_lab_judged":
      return send(res, 200, true);
    case "/rest/v1/study_exams":
      return send(res, 200, [{ id: EXAM, group_id: GROUP, title: "מועד א׳ בדוי", key_source: "separate", kind: "exam", lecture_id: null, course: "" }]);
    case "/rest/v1/study_exam_pages":
      return send(res, 200, [1, 2, 3, 4, 5, 6].map(page));
    case "/rest/v1/study_questions":
      return send(res, 200, url.search.includes("lecture_id") ? [] : examItems);
    case "/storage/v1/object/sign/study": {
      const paths = (body?.paths ?? []) as string[];
      return send(res, 200, paths.map((p) => ({ path: p, signedURL: `/object/sign/study/${p}?token=${jwt(Number(body?.expiresIn) || 60)}`, error: null })));
    }
    case "/rest/v1/rpc/study_lab_plan":
      planned = body;
      return send(res, 200, { run: RUN, labels });
    case "/rest/v1/rpc/study_lab_slot": {
      const s = slotOf[body.p_label];
      if (!s) return send(res, 400, pgError("not waiting"));
      return send(res, 200, {
        slot: labels.indexOf(body.p_label),
        model: s.model,
        provider: "anthropic",
        status: s.status,
        tries: s.tries,
        check_status: checkOf[body.p_label] ?? "none",
        judge_model: planned?.p_judge ?? null,
        output: `out-${labels.indexOf(body.p_label)}`,
        run_status: runStatus,
        route: planned?.p_route ?? "solver",
        group: GROUP,
        lecture: LECTURE,
        request: planned?.p_request ?? null,
        source: {},
      });
    }
    case "/rest/v1/rpc/study_lab_claim":
      if (claimFail[body.p_label]) return send(res, 400, pgError(claimFail[body.p_label]));
      return send(res, 200, 500 + labels.indexOf(body.p_label));
    case "/rest/v1/rpc/study_lab_claim_slots": {
      // As section Y: strict and the run's line refused, nothing is claimed and the empty run is dropped; else each slot alone.
      if (body.p_strict && lineFail) return send(res, 200, { claimed: {}, refused: {}, error: lineFail, dropped: true });
      const claimed: Record<string, number> = {};
      const refused: Record<string, string> = {};
      for (const x of body.p_slots as Array<{ label: string }>) {
        if (claimFail[x.label]) refused[x.label] = claimFail[x.label];
        else claimed[x.label] = 500 + labels.indexOf(x.label);
      }
      return send(res, 200, { claimed, refused, error: null });
    }
    case "/rest/v1/rpc/study_lab_output_save":
      texts[body.p_output] = body.p_text ?? "";
      return send(res, 200, true);
    case "/rest/v1/rpc/study_lab_skip":
    case "/rest/v1/rpc/study_settle":
      return send(res, 200, true);
    case "/rest/v1/rpc/study_lab_status":
      return send(res, 200, runStatus);
    case "/rest/v1/rpc/study_lab_run":
      return send(res, 200, { id: RUN, status: runStatus, owner, ready: 1, total: labels.length, outputs: labels.map((l) => ({ label: l })) });
    case "/rest/v1/rpc/study_model_set":
    case "/rest/v1/rpc/study_lab_cancel":
      return owner ? send(res, 200, null) : send(res, 400, pgError("not the creator"));
  }
  send(res, 404, { message: `unmocked ${req.method} ${path}` });
});

/* ── Anthropic: by model, the question check's answers, or the exam's unit ── */
const ev = (e: object & { type: string }) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const sent: any[] = [];
const anthropicServer = createServer(async (req, res) => {
  const body = JSON.parse(await readAll(req));
  sent.push(body);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const schema = JSON.stringify(body.output_config?.format?.schema ?? {});
  const exam = !schema.includes("takeaway") && !schema.includes('"outputs"') && String(body.system?.[0]?.text ?? "").includes("exam");
  const solver = { answers: [{ id: "q1", choice: 1, ambiguous: false, seq: [] }, { id: "q2", choice: body.model === "claude-haiku-5-5" ? 2 : 0, ambiguous: false, seq: [] }, { id: "q3", choice: 0, ambiguous: false, seq: [] }] };
  const text = schema.includes("takeaway")
    ? JSON.stringify({ questions: [QUESTION] })
    : schema.includes('"outputs"')
      ? JSON.stringify({ outputs: labels.map((label, i) => ({ label, overall: 4 - i, accuracy: 4, hebrew: 5, structure: 4, errors: [] })) })
      : JSON.stringify(exam ? EXAM12.units[0].reply : solver);
  const refuse = body.model === "claude-sonnet-5-5";
  res.write(ev({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 1 } } }));
  res.write(ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  if (!refuse) for (let i = 0; i < text.length; i += 100) res.write(ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 100) } }));
  res.write(ev({ type: "content_block_stop", index: 0 }));
  res.write(ev({ type: "message_delta", delta: { stop_reason: refuse ? "refusal" : "end_turn", stop_sequence: null }, usage: { output_tokens: 400 } }));
  res.end(ev({ type: "message_stop" }));
});

const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as AddressInfo).port)));
before(async () => {
  const [r, a] = await Promise.all([listen(rest), listen(anthropicServer)]);
  REST = `http://127.0.0.1:${r}`;
  ANTHROPIC = `http://127.0.0.1:${a}`;
  delete process.env.VITE_STUDY_SUPABASE_URL;
  delete process.env.VITE_STUDY_SUPABASE_ANON_KEY;
});
after(() => {
  for (const s of [rest, anthropicServer]) {
    s.closeAllConnections();
    s.close();
  }
});
beforeEach(() => {
  Object.assign(process.env, { VITE_SUPABASE_URL: REST, VITE_SUPABASE_ANON_KEY: "anon-key", ANTHROPIC_BASE_URL: ANTHROPIC, ANTHROPIC_API_KEY: "test-key", STUDY_WORKER_KEY: KEY, STUDY_MONTHLY_USD: "33" });
  log = [];
  sent.length = 0;
  pending = [];
  owner = true;
  labOn = true;
  runCap = 1.5;
  claimFail = {};
  lineFail = "";
  routesNow = {};
  providersNow = {};
  delete process.env.OPENAI_API_KEY;
  planned = null;
  labels = ["א", "ב"];
  runStatus = "running";
  lectureRow = null;
  checkOf = {};
  texts = {};
  slotOf = { א: { model: "claude-haiku-5-5", status: "waiting", tries: 0 }, ב: { model: "claude-opus-5-5", status: "waiting", tries: 0 } };
});

const call = (body: object) =>
  ai.fetch(new Request("http://x/api/study/ai", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ op: "lab", ...body }) }));
const lines = (text: string) =>
  text
    .replace(/^​/, "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const saves = () => new Map(calls("study_lab_output_save").map((c) => [c.body.p_output, c.body]));

test("run: the owner's question check, blind: the response is counts only; each answer saved with its checks", async () => {
  const res = await call({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5"] });
  assert.equal(res.status, 200);
  const text = await res.text();
  await drain();
  // Blindness (D12): no model, label, status, text, cost or time in what the phone gets.
  assert.doesNotMatch(text, /claude|opus|haiku|sonnet|[אבגד]"|status|cost|latency|usd|label/i, text);
  const got = lines(text);
  assert.deepEqual(got[0], { t: "run", run: RUN, total: 2 });
  assert.deepEqual(got.at(-1), { t: "done" });
  assert.deepEqual(
    got.filter((l) => l.t === "progress").map((l) => l.ready),
    [0, 1, 2],
  );
  // The plan: production's request, no signed link, the keys inside (members read only its material), the models and the estimate.
  assert.ok(planned, "planned");
  assert.equal(planned.p_key, KEY);
  assert.equal(planned.p_route, "solver");
  assert.deepEqual(planned.p_models, [{ model: "claude-opus-5-5", provider: "anthropic" }, { model: "claude-haiku-5-5", provider: "anthropic" }]);
  assert.match(planned.p_hash, /^[0-9a-f]{64}$/);
  assert.equal(planned.p_differs, "");
  assert.ok(planned.p_estimate > 0 && planned.p_estimate < 0.1, String(planned.p_estimate));
  assert.equal(planned.p_cap, 33);
  assert.ok(!JSON.stringify(planned.p_request.material).includes('"answer"'), "no key in the material");
  assert.equal(planned.p_request.key.items[0].answer, 1);
  assert.equal(planned.p_title, "הבדיקה של השאלות · 3 שאלות מהבנק");
  // The owner's token reads the bank and the slots; the claims and the saves are the worker's (no user, OD5).
  assert.equal(calls("study_lab_bank")[0].auth, `Bearer ${TOKEN}`);
  assert.equal(calls("study_lab_slot")[0].auth, `Bearer ${TOKEN}`);
  for (const c of [...calls("study_lab_claim_slots"), ...calls("study_lab_output_save"), ...calls("study_settle")]) assert.notEqual(c.auth, `Bearer ${TOKEN}`, c.path);
  // Every slot claimed in one call (one transaction: the group's spend never shows one label's estimate alone, D12).
  assert.equal(calls("study_lab_claim_slots").length, 1);
  assert.equal(calls("study_lab_claim").length, 0);
  assert.deepEqual(calls("study_lab_claim_slots")[0].body.p_slots.map((x: any) => x.label), ["א", "ב"]);
  assert.equal(calls("study_lab_claim_slots")[0].body.p_strict, true);
  // Each model got the frozen request: no server-side fallback, no app fallback (D15).
  assert.deepEqual(sent.map((b) => b.model).sort(), ["claude-haiku-5-5", "claude-opus-5-5"]);
  for (const b of sent) assert.equal(b.fallbacks, undefined, "no server-side fallback in a comparison");
  assert.deepEqual(sent[0].system, sent[1].system);
  assert.deepEqual(sent[0].messages, sent[1].messages);
  // The saves: Haiku got q2 wrong (a good question rejected), Opus matched the keys.
  const s = saves();
  const haiku = s.get("out-0");
  const opus = s.get("out-1");
  assert.equal(haiku.p_status, "done");
  assert.deepEqual({ items: haiku.p_checks.items, match: haiku.p_checks.match, false_rejects: haiku.p_checks.false_rejects }, { items: 3, match: 2, false_rejects: 1 });
  assert.deepEqual({ items: opus.p_checks.items, match: opus.p_checks.match, false_rejects: opus.p_checks.false_rejects }, { items: 3, match: 3, false_rejects: 0 });
  assert.ok(opus.p_cost > 0 && opus.p_latency >= 0 && opus.p_served_by === "claude-opus-5-5");
  assert.equal(calls("study_settle").length, 2, "each reservation settled once");
});

test("run: a refusal is saved as refused; an exam unit is read from the owner's pages, signed per call", async () => {
  slotOf = { א: { model: "claude-sonnet-5-5", status: "waiting", tries: 0 }, ב: { model: "claude-opus-5-5", status: "waiting", tries: 0 } };
  const res = await call({ action: "run", group: GROUP, route: "exam_read", models: ["claude-opus-5-5", "claude-sonnet-5-5"] });
  assert.equal(res.status, 200);
  await res.text();
  await drain();
  assert.ok(!JSON.stringify(planned.p_request).includes("token="), "no signed link is frozen");
  assert.deepEqual(planned.p_source, { exam: EXAM, pages: [1, 2, 3, 4] });
  assert.equal(planned.p_request.key.items.length, examItems.filter((i) => [1, 2, 3, 4].includes(Number(i.page))).length);
  const s = saves();
  assert.equal(s.get("out-0").p_status, "refused");
  assert.deepEqual(s.get("out-0").p_checks, {});
  const opus = s.get("out-1");
  assert.equal(opus.p_status, "done");
  assert.equal(opus.p_checks.match, opus.p_checks.items, JSON.stringify(opus.p_checks));
  // The pages went to the model as freshly signed links (30 minutes for Claude).
  const pics = sent[0].messages[0].content.filter((b: any) => b.type === "image").map((b: any) => b.source.url);
  assert.ok(pics.length >= 4 && pics.every((u: string) => u.startsWith(`${REST}/storage/v1/object/sign/study/`)), pics.join(" "));
  const signs = log.filter((l) => l.path === "/storage/v1/object/sign/study");
  assert.ok(signs.length >= 3 && signs.every((l) => l.body.expiresIn === 1800 && l.auth === `Bearer ${TOKEN}`));
});

test("refusals before the plan: not the owner, the switch, the models, the run's cap, a kind with no comparison", async () => {
  const status = async (body: object) => {
    const r = await call(body);
    return `${r.status} ${(await r.json()).error}`;
  };
  owner = false;
  assert.equal(await status({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5"] }), "403 not the creator");
  owner = true;
  labOn = false;
  assert.equal(await status({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5"] }), "403 off");
  labOn = true;
  assert.equal(await status({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5"] }), "400 bad slots");
  assert.equal(await status({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-opus-5-5"] }), "400 bad slots");
  assert.equal(await status({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "gpt-nothing"] }), "400 bad slots");
  assert.equal(await status({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-mythos-5-2"] }), "400 bad model");
  assert.equal(await status({ action: "run", group: GROUP, route: "outline", models: ["claude-opus-5-5", "claude-haiku-5-5"] }), "400 bad route");
  runCap = 0.0001;
  assert.equal(await status({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5"] }), "402 run_cap");
  assert.equal(calls("study_lab_plan").length, 0, "nothing planned");
  assert.equal(sent.length, 0, "no model called");
  assert.equal(await status({ action: "check", run: RUN }), "409 not done", "the paid check waits for the run to end");
  assert.equal(await status({ action: "nonsense" }), "400 bad action");
});

test("the run's line refused at the claim is the request's status (the empty run is dropped); a later slot's refusal only its own", async () => {
  lineFail = "lab_budget";
  let r = await call({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5"] });
  assert.equal(r.status, 402);
  assert.equal((await r.json()).error, "lab_budget");
  assert.equal(calls("study_lab_skip").length, 0, "the run is dropped in SQL: no slot to end, no daily run used");
  assert.equal(sent.length, 0);
  log = [];
  lineFail = "";
  claimFail = { ב: "budget" };
  r = await call({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5"] });
  assert.equal(r.status, 200);
  const got = lines(await r.text());
  await drain();
  assert.equal(calls("study_lab_skip").length, 0, "a refused slot ends with its reason in study_lab_claim_slots");
  assert.equal(sent.length, 1, "the claimed slot runs");
  assert.deepEqual(got.filter((l) => l.t === "progress").map((l) => l.ready), [1, 2], "the skipped slot counts as ended");
});

test("retry: one slot that timed out, once, on a new claim; resume: only the slots still waiting", async () => {
  planned = { p_route: "solver", p_request: null };
  await call({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5"] }).then((r) => r.text());
  await drain();
  log = [];
  sent.length = 0;
  runStatus = "done";
  slotOf.א = { model: "claude-haiku-5-5", status: "timeout", tries: 0 };
  const r = await call({ action: "retry", run: RUN, label: "א" });
  assert.equal(r.status, 200);
  const text = await r.text();
  await drain();
  assert.doesNotMatch(text, /claude|haiku/i);
  assert.deepEqual(calls("study_lab_claim").map((c) => [c.body.p_label, c.body.p_part]), [["א", "retry"]]);
  // The retry reserves the run's dearest model's worst case (Opus here, though א is Haiku): the spend does not tell the label's model.
  const { labEstimate } = await import("./lab.js");
  const frozen = planned.p_request;
  assert.equal(calls("study_lab_claim")[0].body.p_estimate, Number(labEstimate(frozen, "claude-opus-5-5").toFixed(5)));
  assert.ok(labEstimate(frozen, "claude-opus-5-5") > labEstimate(frozen, "claude-haiku-5-5"));
  assert.equal(saves().get("out-0").p_status, "done");
  slotOf.א = { model: "claude-haiku-5-5", status: "timeout", tries: 1 };
  const again = await call({ action: "retry", run: RUN, label: "א" });
  assert.equal(`${again.status} ${(await again.json()).error}`, "409 not waiting");
  assert.equal((await call({ action: "retry", run: RUN, label: "x" })).status, 400);

  log = [];
  sent.length = 0;
  runStatus = "running";
  slotOf = { א: { model: "claude-haiku-5-5", status: "done", tries: 0 }, ב: { model: "claude-opus-5-5", status: "waiting", tries: 0 } };
  const res = await call({ action: "resume", run: RUN });
  assert.equal(res.status, 200);
  await res.text();
  await drain();
  assert.deepEqual(calls("study_lab_claim_slots")[0].body.p_slots.map((x: any) => x.label), ["ב"]);
  assert.equal(calls("study_lab_claim_slots")[0].body.p_strict, false);
  assert.deepEqual(sent.map((b) => b.model), ["claude-opus-5-5"]);
  runStatus = "done";
  const closed = await call({ action: "resume", run: RUN });
  assert.equal(`${closed.status} ${(await closed.json()).error}`, "409 closed");
});

test("route: the owner sets a kind's model through study_model_set; the refusals of routeRefusal; back to the default", async () => {
  let r = await call({ action: "route", group: GROUP, route: "solver", model: "claude-haiku-5-5", note: "השוואה 27.11" });
  assert.deepEqual(await r.json(), { route: "solver", model: "claude-haiku-5-5" });
  const set = calls("study_model_set")[0];
  assert.deepEqual({ g: set.body.p_group, r: set.body.p_route, m: set.body.p_model, k: set.body.p_key, a: set.auth }, { g: GROUP, r: "solver", m: "claude-haiku-5-5", k: KEY, a: `Bearer ${TOKEN}` });
  r = await call({ action: "route", group: GROUP, route: "points", model: "claude-fable-5-2" });
  assert.equal(`${r.status} ${(await r.json()).error}`, "409 expensive");
  r = await call({ action: "route", group: GROUP, route: "points", model: "claude-fable-5-2", confirmExpensive: true });
  assert.equal(r.status, 200);
  r = await call({ action: "route", group: GROUP, route: "solver", model: "claude-mythos-5-2" });
  assert.equal(`${r.status} ${(await r.json()).error}`, "400 bad model");
  r = await call({ action: "route", group: GROUP, route: "nonsense", model: "claude-haiku-5-5" });
  assert.equal(`${r.status} ${(await r.json()).error}`, "400 bad route");
  r = await call({ action: "route", group: GROUP, route: "solver", model: null });
  assert.deepEqual(await r.json(), { route: "solver", model: null });
  assert.equal(calls("study_model_set").at(-1)!.body.p_model, null);
  owner = false;
  r = await call({ action: "route", group: GROUP, route: "solver", model: "claude-haiku-5-5" });
  assert.equal(`${r.status} ${(await r.json()).error}`, "403 not the creator");
});

test("cancel: study_lab_cancel with the owner's token; a member is refused", async () => {
  let r = await call({ action: "cancel", run: RUN });
  assert.deepEqual(await r.json(), { cancelled: true });
  assert.equal(calls("study_lab_cancel")[0].auth, `Bearer ${TOKEN}`);
  owner = false;
  r = await call({ action: "cancel", run: RUN });
  assert.equal(`${r.status} ${(await r.json()).error}`, "403 not the creator");
});

test("price: the material and each model's worst case, read as run reads it; nothing planned, reserved or called", async () => {
  const r = await call({ action: "price", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5", "claude-mythos-5-2", "gpt-nothing"] });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.route, "solver");
  assert.match(p.title, /^הבדיקה של השאלות · 3 שאלות מהבנק$/);
  assert.deepEqual(p.source, { lecture: LECTURE, n: 3 }, "a solver run picks its questions again: the lecture and the count only");
  assert.equal(p.pictures, false);
  assert.ok(p.models["claude-opus-5-5"].usd > p.models["claude-haiku-5-5"].usd, "Haiku costs less than Opus");
  assert.ok(p.models["claude-haiku-5-5"].usd > 0);
  assert.deepEqual(p.models["claude-mythos-5-2"], { refused: "bad model" }, "Mythos is listed, never offered");
  assert.equal(p.models["gpt-nothing"], undefined, "an id the registry does not list is left out");
  assert.equal(p.runCap, 1.5);
  // Every listed model when none is named; an exam's read unit with pictures.
  const all = await (await call({ action: "price", group: GROUP, route: "exam_read" })).json();
  assert.equal(all.pictures, true);
  assert.ok(Object.keys(all.models).length >= 10, Object.keys(all.models).join(","));
  assert.deepEqual(all.source, { exam: EXAM, pages: [1, 2, 3, 4] });
  for (const name of ["study_lab_plan", "study_lab_claim", "study_lab_claim_slots", "study_reserve"]) assert.equal(calls(name).length, 0, `${name} is not called`);
  assert.equal(sent.length, 0, "no model called");
  // The owner's gate and an unknown kind.
  owner = false;
  const refused = await call({ action: "price", group: GROUP, route: "solver" });
  assert.equal(`${refused.status} ${(await refused.json()).error}`, "403 not the creator");
  owner = true;
  const bad = await call({ action: "price", group: GROUP, route: "outline" });
  assert.equal(`${bad.status} ${(await bad.json()).error}`, "400 bad route");
});

test("run, a kind members rate: practice with the AI score; after the answers the solver's check of each and the judge, each claimed on the worker's path, the response still counts only", async () => {
  lectureRow = lecture38;
  const res = await call({ action: "run", group: GROUP, route: "practice", models: ["claude-opus-5-5", "claude-haiku-5-5"], judge: true });
  assert.equal(res.status, 200);
  const text = await res.text();
  await drain();
  assert.doesNotMatch(text, /claude|opus|haiku|sonnet|[אבגד]"|status|cost|latency|usd|label/i, text);
  assert.deepEqual(lines(text).at(-1), { t: "done" });
  assert.equal(planned.p_route, "practice");
  assert.equal(planned.p_differs, "count");
  assert.equal(planned.p_judge, "claude-opus-5-5", "the AI score's model: the judge route's, Opus by default");
  assert.deepEqual(planned.p_source, { lecture: LECTURE, part: 0 });
  assert.equal(planned.p_title, "שאלות תרגול · משתנים (בדוי) · חלק 1");
  assert.equal(planned.p_request.material.count, 3);
  // The answers, then a paid check of each and the AI score, every one a worker's claim (no user, OD5).
  assert.deepEqual(calls("study_lab_claim_slots")[0].body.p_slots.map((x: any) => x.label), ["א", "ב"]);
  assert.deepEqual(
    calls("study_lab_claim").map((c) => `${c.body.p_label}:${c.body.p_part}`).sort(),
    ["j:judge", "א:solve", "ב:solve"],
  );
  for (const c of [...calls("study_lab_claim"), ...calls("study_lab_claim_slots")]) assert.notEqual(c.auth, `Bearer ${TOKEN}`);
  const s = saves();
  for (const k of ["out-0", "out-1"]) {
    assert.equal(s.get(k).p_status, "done");
    assert.equal(s.get(k).p_check_status, "pending", "it waits for the solver");
    assert.deepEqual({ items: s.get(k).p_checks.items, ok: s.get(k).p_checks.ok }, { items: 1, ok: 1 });
  }
  const checks = calls("study_lab_check_save");
  assert.equal(checks.length, 2);
  for (const c of checks) {
    assert.equal(c.body.p_status, "done");
    assert.equal(c.body.p_checks.solved, 1);
  }
  const judged = calls("study_lab_judged");
  assert.equal(judged.length, 2);
  for (const j of judged) {
    assert.equal(j.body.p_judge, "claude-opus-5-5");
    assert.ok(j.body.p_scores.overall >= 1 && Number.isInteger(j.body.p_scores.order));
  }
  // The judge read the slides' text and the answers under their labels: no model's name.
  const judge = sent.find((b) => JSON.stringify(b.output_config?.format?.schema ?? {}).includes('"outputs"'));
  assert.ok(judge, "the judge was called");
  assert.doesNotMatch(JSON.stringify(judge.messages), /claude|opus|haiku/i);
  // The run's estimate held the answers, the checks and the AI score.
  assert.ok(planned.p_estimate > 0.2, String(planned.p_estimate));
});

test("check: a done run's pending checks only, claimed again (a step that ran is not paid twice); judge needs a run that asked for it", async () => {
  lectureRow = lecture38;
  const first = await call({ action: "run", group: GROUP, route: "practice", models: ["claude-opus-5-5", "claude-haiku-5-5"] });
  await first.text();
  await drain();
  assert.equal(planned.p_judge, null, "the AI score is off by default (OD12)");
  log = [];
  runStatus = "done";
  checkOf = { א: "pending", ב: "done" };
  const res = await call({ action: "check", run: RUN });
  assert.equal(res.status, 200);
  const got = lines(await res.text());
  await drain();
  assert.deepEqual(got[0], { t: "check", pending: 1 });
  assert.deepEqual(calls("study_lab_claim").map((c) => `${c.body.p_label}:${c.body.p_part}`), ["א:solve"]);
  assert.equal(calls("study_lab_check_save").length, 1);
  const judge = await call({ action: "judge", run: RUN });
  assert.equal(`${judge.status} ${(await judge.json()).error}`, "409 not waiting");
});

test("price, a kind members rate: the paid steps' worst cases beside the models'; לשאול needs its typed question to run", async () => {
  lectureRow = lecture38;
  const res = await call({ action: "price", group: GROUP, route: "practice", models: ["claude-opus-5-5", "claude-haiku-5-5"] });
  assert.equal(res.status, 200);
  const p = await res.json();
  assert.ok(p.steps.check > 0, "the solver's check of one answer");
  assert.equal(p.steps.judge.length, 5);
  assert.ok(p.steps.judge[2] > 0 && p.steps.judge[4] > p.steps.judge[2]);
  const ask = await call({ action: "price", group: GROUP, route: "ask" });
  assert.equal(ask.status, 200, "a price without the question takes the longest one");
  assert.equal((await ask.json()).steps.check, 0);
  const run = await call({ action: "run", group: GROUP, route: "ask", models: ["claude-opus-5-5", "claude-haiku-5-5"] });
  assert.equal(`${run.status} ${(await run.json()).error}`, "400 no question");
  assert.equal(calls("study_lab_plan").length, 0);
});

test("consent again after the run began (D17): a retry or resume on a provider no longer approved sends nothing; a step's route there falls back to the default", async () => {
  process.env.OPENAI_API_KEY = "FAKE-test-key-not-real";
  const GPT = "openai:gpt-6.2-sol";
  planned = { p_route: "solver", p_request: null };
  await call({ action: "run", group: GROUP, route: "solver", models: ["claude-opus-5-5", "claude-haiku-5-5"] }).then((r) => r.text());
  await drain();
  // The slot's model is OpenAI's; the group's "לאשר שליחה" was withdrawn since.
  log = [];
  sent.length = 0;
  runStatus = "done";
  providersNow = { openai: { allowed: false, scope: "all" } };
  slotOf.א = { model: GPT, status: "timeout", tries: 0 };
  const r = await call({ action: "retry", run: RUN, label: "א" });
  assert.equal(`${r.status} ${(await r.json()).error}`, "400 not allowed");
  assert.equal(calls("study_lab_claim").length, 0, "nothing claimed");
  assert.equal(sent.length, 0, "nothing sent");
  // Resume: that slot ends with the reason, the Claude one runs.
  log = [];
  runStatus = "running";
  slotOf = { א: { model: GPT, status: "waiting", tries: 0 }, ב: { model: "claude-opus-5-5", status: "waiting", tries: 0 } };
  const res = await call({ action: "resume", run: RUN });
  assert.equal(res.status, 200);
  await res.text();
  await drain();
  assert.deepEqual(calls("study_lab_skip").map((c) => [c.body.p_label, c.body.p_reason]), [["א", "not allowed"]]);
  assert.deepEqual(calls("study_lab_claim_slots")[0].body.p_slots.map((x: any) => x.label), ["ב"]);
  assert.deepEqual(sent.map((b) => b.model), ["claude-opus-5-5"]);
});

test("a step's model: the solver route on a provider that is not approved runs the check on the default, never there", async () => {
  process.env.OPENAI_API_KEY = "FAKE-test-key-not-real";
  routesNow = { solver: { model: "openai:gpt-6.2-sol" } };
  providersNow = { openai: { allowed: false, scope: "all" } };
  lectureRow = lecture38;
  const first = await call({ action: "run", group: GROUP, route: "practice", models: ["claude-opus-5-5", "claude-haiku-5-5"] });
  await first.text();
  await drain();
  const solves = sent.filter((b) => JSON.stringify(b.output_config?.format?.schema ?? {}).includes('"answers"'));
  assert.ok(solves.length >= 1, "the solver's check ran");
  for (const b of solves) assert.equal(b.model, "claude-opus-5-5");
});
