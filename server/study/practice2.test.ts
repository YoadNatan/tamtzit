import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import ai from "../../api/study/ai.js";
import { MODEL } from "./claude.js";
import { claimedParts, PIECE_MIN_MS, readPoints } from "./points.js";
import { partFacts, signStyle, tableParts, verifyStyle } from "./practice2.js";
import { POINTS_SYSTEM } from "./prompts/points.js";
import { QUESTIONS_SYSTEM, STYLE_READ_SYSTEM } from "./prompts/questions.js";
import { SOLVER_SYSTEM } from "./prompts/solver.js";
import type { Question } from "./questions.js";
import { normalize } from "./similar.js";
import { anthropic as anthropicClient, memberClient, REQUIRED_SCHEMA, type Lecture } from "./study.js";

/* Practice 2.0 through /api/study/ai (op "questions"; docs/study/practice-2-api.md),
 * against a local PostgREST and a local Anthropic that replays SSE: no
 * network, no key, no database. The actions: "points" (the points to know,
 * read once for the group: claim, a reservation of kind points, the save
 * with the ids of the points that stayed), "plan" (the setup screen's
 * numbers: free), "create" (a request and its batches from the plan),
 * "style" (an example read back, signed), "reword" (a member's "↻ לנסח
 * מחדש"); and a request's batch written as drafts, each checked by the
 * blind solver, one it gets wrong written again once and rejected if it
 * still fails. The SQL side of the same rules (who may keep, what a stranger
 * sees, the counts) is supabase/tests/study.sql's P2 checks. A synthetic
 * lecture (Exemplaria, Mockaquine…), no course content. */

const KEY = "k-0123456789abcdef0123456789abcdef";
const LECTURE = "11111111-0000-4000-8000-000000000001";
const GROUP = "22222222-0000-4000-8000-000000000002";
const USER = "33333333-0000-4000-8000-000000000003";
const REQ = "66666666-0000-4000-8000-000000000001";
const B_REQ = "44444444-0000-4000-8000-0000000000a1";
const DRAFT = "77777777-0000-4000-8000-000000000001";
/** A staged case's step (question types): never reworded. */
const DRAFT_STEP = "77777777-0000-4000-8000-000000000002";
const pid = (n: number) => `88888888-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ── The lecture: 24 slides in two written parts; slide 20 has a table ──
const lecture: Lecture = {
  id: LECTURE,
  group_id: GROUP,
  course: "",
  title: "הרצאה לדוגמה",
  lecturer: "ד״ר דוגמה",
  lecture_date: null,
  source_kind: "pptx",
  slides: Array.from({ length: 24 }, (_, i) => ({
    n: i + 1,
    title: `נושא ${i + 1}`,
    lines: [`עובדה לדוגמה ${i + 1} על Mockaquine ו-Testoquine`],
    tables: i + 1 === 20 ? [[["תרופה", "שלב"], ["Mockaquine", "כבד"]]] : [],
    notes: "",
    figures: [],
  })),
};
const MD = [
  ["## מחזור החיים", "ה-dormozoite ישן בכבד, ורק Mockaquine פועלת עליו. [ש' 5]", "לפני Mockaquine בודקים FXR. [ש' 7]", "![מחזור החיים של Exemplaria (שקף 6)](fig:6-1)"].join("\n\n"),
  ["## מנגנונים", "Testoquine מצטברת בוואקואולה של הטפיל. [ש' 15]", "Fictemisinins לעולם לא ניתנות לבד. [ש' 20]"].join("\n\n"),
];
const SECTIONS = [
  { idx: 0, title: "מחזור החיים", slide_from: 1, slide_to: 12, gen: 1, markdown: MD[0] },
  { idx: 1, title: "מנגנונים", slide_from: 13, slide_to: 24, gen: 1, markdown: MD[1] },
];
/** The lecture's points: part 0 four (one red flag), part 1 two. */
const POINTS = [
  { id: pid(1), part_idx: 0, n: 1, kind: "indication", subject: "Mockaquine", text: "רק Mockaquine פועלת על ה-dormozoite.", red_flag: false, weight: 3, anchor: 1 },
  { id: pid(2), part_idx: 0, n: 2, kind: "contra", subject: "Mockaquine", text: "לפני Mockaquine בודקים FXR.", red_flag: true, weight: 3, anchor: 2 },
  { id: pid(3), part_idx: 0, n: 3, kind: "mechanism", subject: "Exemplaria", text: "ה-dormozoite ישן בכבד.", red_flag: false, weight: 2, anchor: 1 },
  { id: pid(4), part_idx: 0, n: 4, kind: "drug", subject: "Mockaquine", text: "Mockaquine שייכת לקבוצה לדוגמה.", red_flag: false, weight: 1, anchor: 1 },
  { id: pid(5), part_idx: 1, n: 1, kind: "mechanism", subject: "Testoquine", text: "Testoquine מצטברת בוואקואולה.", red_flag: false, weight: 3, anchor: 1 },
  { id: pid(6), part_idx: 1, n: 2, kind: "contra", subject: "Fictemisinins", text: "Fictemisinins לעולם לא ניתנות לבד.", red_flag: true, weight: 3, anchor: 2 },
];
const state = (current: boolean[]) =>
  SECTIONS.map((s, i) => ({
    part_idx: s.idx,
    title: s.title,
    slide_from: s.slide_from,
    slide_to: s.slide_to,
    summary: "ready",
    points: POINTS.filter((p) => p.part_idx === s.idx).length,
    red_flags: POINTS.filter((p) => p.part_idx === s.idx && p.red_flag).length,
    status: current[i] ? "ready" : "pending",
    current: current[i],
    busy: false,
    error: null,
  }));

// ── Stand-in questions for part 1 (slides 13-24) ──
const opt = (text: string, why: string, correct = false, when = "", tag = "", left = "") => ({ text, correct, why, when, tag, left });
const Q_CASE: Question = {
  topic: "Testoquine",
  aspect: "treatment",
  style: "case",
  points: [1],
  takeaway: "Testoquine מצטברת בוואקואולה של הטפיל. [ש' 15]",
  difficulty: 2,
  case: true,
  vignette: "גבר בן 40 חוזר מאי דמיוני עם חום, ובמשטח הדם נמצא Exemplaria. הרופאה שוקלת טיפול שפועל בתוך הוואקואולה של הטפיל.",
  question: "איזו תרופה מצטברת בוואקואולה של הטפיל?",
  options: [
    opt("Testoquine", "Testoquine מצטברת בוואקואולה של הטפיל. [ש' 15]", true, "", "Testoquine"),
    opt("Mockaquine", "Mockaquine פועלת על ה-dormozoite בכבד. [ש' 5]", false, "מתי כן: בשאלה על ה-dormozoite בכבד", "Mockaquine"),
    opt("Fictemisinins", "Fictemisinins ניתנות בשילוב בלבד. [ש' 20]"),
    opt("Placebrin", "Placebrin לא נזכרת בהקשר הזה בשקפים. [ש' 16]"),
    opt("Stubamide", "Stubamide לא נזכרת בהקשר הזה בשקפים. [ש' 17]"),
  ],
  para: 1,
  teaser: "Testoquine נתקעה בוואקואולה",
  figure: "",
  slides: [15, 16, 17],
  resolved: "",
  stages: [],
};
const Q_MECH: Question = {
  ...Q_CASE,
  style: "mechanism",
  points: [2],
  takeaway: "Fictemisinins לעולם לא ניתנות לבד. [ש' 20]",
  case: false,
  vignette: "",
  question: "מה נכון לגבי מתן Fictemisinins?",
  options: [
    opt("ניתנות תמיד בשילוב", "Fictemisinins לעולם לא ניתנות לבד. [ש' 20]", true),
    opt("ניתנות לבד בשבוע הראשון", "לפי השקף הן לעולם לא ניתנות לבד. [ש' 20]"),
    opt("ניתנות רק בהיריון", "השקפים לא מגבילים אותן להיריון. [ש' 21]"),
    opt("ניתנות רק לילדים", "השקפים לא מגבילים אותן לילדים. [ש' 22]"),
    opt("ניתנות רק בזריקה", "השקפים לא מזכירים דרך מתן כזו. [ש' 23]"),
  ],
  para: 2,
  teaser: "",
  slides: [20, 21, 22, 23],
};
/** The writer's second version of the case, after the solver chose otherwise. */
const Q_CASE2: Question = {
  ...Q_CASE,
  vignette: "אישה בת 35 חוזרת מאי דמיוני עם חום גבוה, ובמשטח נמצא Exemplaria. נדרשת תרופה שמצטברת בתוך הטפיל עצמו.",
  question: "לאיזו תרופה מתאים התיאור של הצטברות בוואקואולה?",
};

// ── The mocks: one log for both servers ──
type Logged = { seq: number; who: "rest" | "anthropic"; path: string; query: URLSearchParams; auth: string | null; body: string };
type GenReply = { items?: Question[]; status?: number; stop?: string };
type SolverReply = { wrong?: number[]; ambiguous?: number[] };
/** A points call's reply: for the call reading `part` (any call when unset),
 *  after `delay` ms; `hang` sends the start, then nothing for that long. */
type PointsReply = { part?: number; points?: unknown[]; stop?: string; status?: number; delay?: number; hang?: number };
type StyleReply = { styles?: unknown[]; stop?: string };
let log: Logged[] = [];
let seq = 0;
let schemaAnswer: unknown = { ...REQUIRED_SCHEMA, Q: 2 };
let claimRows: unknown[] | string = [];
let pointsState: unknown[] = state([true, true]);
let oldPoints: Array<Record<string, unknown>> = [];
/** The lecture's points as study_points answers them. */
let pointsList: Array<Record<string, unknown>> = POINTS;
let genReplies: GenReply[] = [];
let solverReplies: SolverReply[] = [];
let pointsReplies: PointsReply[] = [];
let styleReplies: StyleReply[] = [];
let served: Question[] = [];
let drafts: Map<string, { answer: number; status: string; batch_id: string; style: string }> = new Map();
let draftSeq = 0;
let reserveRefusal: string | null = null;
/** Reservations granted before reserveRefusal applies (null: it applies to all). */
let reservesGranted: number | null = null;
let nextReservation = 100;
let createRefusal: string | null = null;
let rewordRefusal: string | null = null;
/** The draft's rewrites as study_draft_reword reads them. */
let rewordRewrites = 0;
/** Drafts a member removed while the solver read them: study_draft_check answers 'not pending'. */
let goneDrafts = new Set<string>();
let createRows: (body: Record<string, unknown>) => unknown[] = () => [];
/** The request batch's styles (question types: a staged case). */
let batchStyles: string[] = ["case", "mechanism"];
// A round over several lectures (sources.md B6.7): the round's requests so far, and study_request_plan's answer.
let planRows: Array<{ lecture_id: string }> = [];
let planLink: number | string = 2;

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
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
const eqOf = (q: URLSearchParams, k: string) => /^eq\.(.*)$/.exec(q.get(k) ?? "")?.[1] ?? "";
const inOf = (q: URLSearchParams, k: string) => /^in\.\((.*)\)$/.exec(q.get(k) ?? "")?.[1].split(",").map((x) => x.replace(/^"|"$/g, "")) ?? null;
const newDraftId = () => `77777777-0000-4000-8000-${String(++draftSeq + 100).padStart(12, "0")}`;

const rest = createServer(async (req, res) => {
  const body = await readAll(req);
  const url = new URL(req.url ?? "/", "http://x");
  log.push({ seq: ++seq, who: "rest", path: url.pathname, query: url.searchParams, auth: req.headers.authorization ?? null, body });
  const p = url.pathname;
  const q = url.searchParams;
  const a = (body ? JSON.parse(body) : {}) as Record<string, any>;
  if (p === "/auth/v1/user") return send(res, 200, { id: USER, aud: "authenticated", role: "authenticated" });
  if (p === "/rest/v1/rpc/study_schema") return send(res, 200, schemaAnswer);
  if (p === "/rest/v1/study_lectures") return send(res, 200, eqOf(q, "id") === LECTURE ? [lecture] : []);
  if (p === "/rest/v1/study_sections") {
    const one = eqOf(q, "idx");
    const many = inOf(q, "idx");
    return send(res, 200, SECTIONS.filter((s) => (one ? String(s.idx) === one : many ? many.includes(String(s.idx)) : true)));
  }
  if (p === "/rest/v1/study_points") {
    const ids = inOf(q, "id");
    if (ids) return send(res, 200, POINTS.filter((x) => ids.includes(x.id)));
    const parts = inOf(q, "part_idx");
    if (parts) return send(res, 200, oldPoints.filter((x) => parts.includes(String(x.part_idx))));
    return send(res, 200, pointsList);
  }
  if (p === "/rest/v1/rpc/study_points_state") return send(res, 200, pointsState);
  if (p === "/rest/v1/rpc/study_points_claim") return typeof claimRows === "string" ? send(res, 400, pgError(claimRows)) : send(res, 200, claimRows);
  if (p === "/rest/v1/rpc/study_points_save") return send(res, 200, (a.p_points as unknown[]).length);
  if (p === "/rest/v1/rpc/study_points_fail") return send(res, 200, null);
  if (p === "/rest/v1/rpc/study_spent") return send(res, 200, 3.21);
  if (p === "/rest/v1/rpc/study_my_spent") return send(res, 200, 0.42);
  if (p === "/rest/v1/rpc/study_reserve") {
    if (reserveRefusal && (reservesGranted === null || nextReservation - 100 >= reservesGranted)) return send(res, 400, pgError(reserveRefusal));
    return send(res, 200, ++nextReservation);
  }
  if (p === "/rest/v1/rpc/study_settle") return send(res, 200, true);
  if (p === "/rest/v1/rpc/study_request_create") return createRefusal ? send(res, 400, pgError(createRefusal)) : send(res, 200, createRows(a));
  if (p === "/rest/v1/study_question_batches") {
    return send(res, 200, eqOf(q, "id") === B_REQ ? [{ lecture_id: LECTURE, request_id: REQ, points: [pid(5), pid(6)], styles: batchStyles, part_idx: 1, heading: "מנגנונים", slide_from: 13, slide_to: 24 }] : []);
  }
  if (p === "/rest/v1/rpc/study_question_claim") {
    return send(res, 200, [{ lecture_id: LECTURE, round: 3, part_idx: 1, heading: "מנגנונים", slide_from: 13, slide_to: 24, wanted: 2, effort: "high" }]);
  }
  if (p === "/rest/v1/rpc/study_request_plan") return typeof planLink === "string" ? send(res, 400, pgError(planLink)) : send(res, 200, planLink);
  // A round's request: made and linked in one call; a refused link makes nothing.
  if (p === "/rest/v1/rpc/study_request_create_in_plan") {
    if (createRefusal) return send(res, 400, pgError(createRefusal));
    if (typeof planLink === "string") return send(res, 400, pgError(planLink));
    return send(res, 200, (createRows(a) as Array<Record<string, unknown>>).map((r) => ({ ...r, lectures: planLink })));
  }
  if (p === "/rest/v1/study_question_requests" && eqOf(q, "plan_id")) return send(res, 200, planRows);
  if (p === "/rest/v1/study_question_requests") {
    return send(res, 200, [{ id: REQ, difficulty: "hard", focus: "רק מה שבודקים לפני טיפול", style_note: "מקרה קצר עם גיל ומין, חמש אפשרויות.", style_example: "אישה בת 28 עם חום. מה הצעד הבא?" }]);
  }
  if (p === "/rest/v1/study_question_drafts") {
    if (eqOf(q, "id") === DRAFT_STEP) {
      return send(res, 200, [{ id: DRAFT_STEP, lecture_id: LECTURE, request_id: REQ, batch_id: B_REQ, part_idx: 1, style: "steps", points: [pid(5)], vignette: Q_CASE.vignette, question: Q_CASE.question, options: Q_CASE.options.map((o) => o.text), status: "pending", form: "one", layout: { kind: "steps", of: 2, lead: 0 }, series: "77777777-0000-4000-8000-0000000000ff" }]);
    }
    if (eqOf(q, "id") === DRAFT) {
      return send(res, 200, [{ id: DRAFT, lecture_id: LECTURE, request_id: REQ, batch_id: B_REQ, part_idx: 1, style: "case", points: [pid(5)], vignette: Q_CASE.vignette, question: Q_CASE.question, options: Q_CASE.options.map((o) => o.text), status: "pending" }]);
    }
    return send(res, 200, []);
  }
  if (p === "/rest/v1/study_questions" || p === "/rest/v1/study_exams") return send(res, 200, []);
  if (p === "/rest/v1/study_edits") return send(res, 404, { code: "PGRST205", details: null, hint: null, message: "no study_edits" });
  if (p === "/rest/v1/rpc/study_draft_save" || p === "/rest/v1/rpc/study_draft_replace") {
    const id = newDraftId();
    drafts.set(id, { answer: a.p_q.answer, status: "pending", batch_id: B_REQ, style: a.p_q.style });
    if (a.p_draft) drafts.set(a.p_draft, { ...(drafts.get(a.p_draft) ?? { answer: 0, batch_id: B_REQ, style: "case" }), status: "replaced" });
    return send(res, 200, id);
  }
  if (p === "/rest/v1/rpc/study_draft_check") {
    if (goneDrafts.has(a.p_draft)) return send(res, 400, pgError("not pending"));
    const d = drafts.get(a.p_draft);
    const st = a.p_choice === null ? "unchecked" : d && a.p_choice === d.answer && a.p_ambiguous === false ? "ok" : "failed";
    return send(res, 200, st);
  }
  if (p === "/rest/v1/rpc/study_draft_reject" || p === "/rest/v1/rpc/study_draft_release") return send(res, 200, null);
  if (p === "/rest/v1/rpc/study_draft_reword") {
    if (rewordRefusal) return send(res, 400, pgError(rewordRefusal));
    return send(res, 200, [{ answer: 0, explanations: Q_CASE.options.map((o) => o.why), takeaway: Q_CASE.takeaway, whens: Q_CASE.options.map(() => ""), rewrites: rewordRewrites }]);
  }
  if (p === "/rest/v1/rpc/study_question_finish") {
    res.writeHead(204);
    return res.end();
  }
  send(res, 404, { message: `unmocked ${req.method} ${p}` });
});

const sse = (e: { type: string }) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const stream = (text: string, stop: string, usage = { input_tokens: 300, cache_creation_input_tokens: 1200, cache_read_input_tokens: 0, output_tokens: 1 }, out = 400) => {
  let deltas = "";
  for (let i = 0; i < text.length; i += 17) deltas += sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 17) } } as { type: string });
  return [
    sse({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage } } as { type: string }),
    sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } as { type: string }),
    deltas,
    sse({ type: "content_block_stop", index: 0 }),
    sse({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: out } } as { type: string }),
    sse({ type: "message_stop" }),
  ].join("");
};
const systemOf = (raw: string) => (JSON.parse(raw) as { system: Array<{ text: string }> }).system[0].text;
function solverAnswers(raw: string, r: SolverReply): string {
  const text = (JSON.parse(raw) as { messages: Array<{ content: Array<{ text: string }> }> }).messages[0].content[0].text;
  const answers = text
    .split("\n\n")
    .slice(1)
    .map((b, i) => {
      const lines = b.split("\n");
      const at = lines.findIndex((l) => /^[א-ו]\. /.test(l));
      const opts = lines.filter((l) => /^[א-ו]\. /.test(l)).map((l) => l.slice(3));
      const item = served.find((x) => normalize(x.question) === normalize(lines[at - 1]));
      const key = item ? opts.findIndex((o) => normalize(o) === normalize(item.options.find((x) => x.correct)!.text)) : 0;
      return { id: `q${i + 1}`, choice: r.wrong?.includes(i + 1) ? (key + 1) % opts.length : key, ambiguous: r.ambiguous?.includes(i + 1) ?? false };
    });
  return JSON.stringify({ answers });
}
const anthropic = createServer(async (req, res) => {
  const raw = await readAll(req);
  log.push({ seq: ++seq, who: "anthropic", path: req.url ?? "", query: new URLSearchParams(), auth: null, body: raw });
  const sys = systemOf(raw);
  const fail = (status: number) => send(res, status, { type: "error", error: { type: "api_error", message: "mock" } });
  if (sys === SOLVER_SYSTEM) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    return res.end(stream(solverAnswers(raw, solverReplies.shift() ?? {}), "end_turn"));
  }
  if (sys === POINTS_SYSTEM) {
    const part = Number(/\n\nPart (\d+)/.exec((JSON.parse(raw) as { messages: Array<{ content: Array<{ text: string }> }> }).messages[0].content[0].text)?.[1] ?? -1);
    const at = pointsReplies.findIndex((r) => r.part === undefined || r.part === part);
    const r = at >= 0 ? pointsReplies.splice(at, 1)[0] : { points: [] };
    if (r.delay) await pause(r.delay);
    if (r.status) return fail(r.status);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const all = stream(JSON.stringify({ points: r.points ?? [] }), r.stop ?? "end_turn");
    if (r.hang) {
      const cut = all.indexOf("event: content_block_delta");
      res.write(all.slice(0, cut));
      const t = setTimeout(() => res.end(all.slice(cut)), r.hang);
      res.on("close", () => clearTimeout(t));
      return;
    }
    return res.end(all);
  }
  if (sys === STYLE_READ_SYSTEM) {
    const r = styleReplies.shift() ?? { styles: [] };
    res.writeHead(200, { "content-type": "text/event-stream" });
    return res.end(stream(JSON.stringify({ styles: r.styles ?? [] }), r.stop ?? "end_turn"));
  }
  assert.equal(sys, QUESTIONS_SYSTEM);
  const r = genReplies.shift() ?? { items: [] };
  if (r.status) return fail(r.status);
  served.push(...(r.items ?? []));
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(stream(JSON.stringify({ questions: r.items ?? [] }, null, 1), r.stop ?? "end_turn", undefined, 2400));
});

const listen = (s: Server) => new Promise<number>((ok) => s.listen(0, "127.0.0.1", () => ok((s.address() as AddressInfo).port)));
before(async () => {
  const [r, a] = await Promise.all([listen(rest), listen(anthropic)]);
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
  rest.closeAllConnections();
  anthropic.closeAllConnections();
  rest.close();
  anthropic.close();
});
beforeEach(() => {
  log = [];
  batchStyles = ["case", "mechanism"];
  planRows = [];
  planLink = 2;
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 2 };
  claimRows = [];
  pointsState = state([true, true]);
  oldPoints = [];
  pointsList = POINTS;
  genReplies = [];
  solverReplies = [];
  pointsReplies = [];
  styleReplies = [];
  served = [];
  drafts = new Map([[DRAFT, { answer: 0, status: "pending", batch_id: B_REQ, style: "case" }]]);
  draftSeq = 0;
  reserveRefusal = null;
  reservesGranted = null;
  nextReservation = 100;
  createRefusal = null;
  rewordRefusal = null;
  rewordRewrites = 0;
  goneDrafts = new Set();
  createRows = (body) =>
    (body.p_batches as Array<{ part_idx: number; seq: number; wanted: number }>).map((b, i) => ({
      request_id: REQ,
      round: 3,
      batch_id: `44444444-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      part_idx: b.part_idx,
      seq: b.seq,
      wanted: b.wanted,
    }));
});

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const post = (body: unknown) =>
  ai.fetch(new Request("http://localhost/api/study/ai", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
type Line = Record<string, any> & { t: string };
async function call(body: Record<string, unknown>): Promise<{ status: number; json: any; lines: Line[]; error: string | null }> {
  const res = await post({ op: "questions", lectureId: LECTURE, ...body });
  if (res.headers.get("content-type")?.startsWith("application/json")) return { status: res.status, json: await res.json(), lines: [], error: null };
  const raw = await res.text();
  assert.ok(raw.startsWith("​"));
  const [text, err] = raw.slice(1).split("\n\u0000ERROR ");
  return { status: res.status, json: null, lines: text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line), error: err ?? null };
}
const rpcs = (name: string) => log.filter((l) => l.who === "rest" && l.path === `/rest/v1/rpc/${name}`);
const args = (l: Logged) => JSON.parse(l.body) as Record<string, any>;
const models = (system?: string) => log.filter((l) => l.who === "anthropic" && (!system || systemOf(l.body) === system));
const userText = (l: Logged) => (JSON.parse(l.body) as { messages: Array<{ content: Array<{ text?: string; type: string }> }> }).messages[0].content.map((c) => c.text ?? `[${c.type}]`).join("\n\n");

// ═══ the gate: first, before a passing check is remembered for the instance ═══

test("every action needs section Q at version 2 (Q's end and practice 2.0)", async () => {
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 1 };
  for (const action of ["points", "plan", "create", "style", "reword"]) {
    const r = await call({ action });
    assert.deepEqual([r.status, r.json], [503, { error: "schema" }], action);
  }
});

// ═══ points ═══

const pointItem = (part: number, para: number, kind: string, text: string, slides: number[], red = false, weight = 2) => ({ part, para, kind, subject: "Mockaquine", text, slides, red_flag: red, weight });

test("points: nothing stale, nothing spent: a done line, no reservation, no model call", async () => {
  claimRows = [];
  const r = await call({ action: "points" });
  assert.deepEqual(r.lines, [{ t: "done", parts: 0, points: 0, costUsd: 0, unsettled: 0 }]);
  assert.deepEqual(args(rpcs("study_points_claim")[0]), { p_lecture: LECTURE, p_key: KEY });
  assert.equal(rpcs("study_reserve").length + models().length, 0);
});

const CLAIM2 = [
  { part_idx: 0, heading: "מחזור החיים", slide_from: 1, slide_to: 12, md5: "a".repeat(32) },
  { part_idx: 1, heading: "מנגנונים", slide_from: 13, slide_to: 24, md5: "b".repeat(32) },
];
const P0_ITEM = pointItem(0, 1, "indication", "רק Mockaquine פועלת על ה-dormozoite בכבד.", [5]);
const P1_ITEM = pointItem(1, 1, "mechanism", "Testoquine מצטברת בוואקואולה.", [15]);
const partLines = (lines: Line[]) => lines.filter((l) => l.t === "part" || l.t === "fail").map((l) => [l.t, l.part, l.t === "part" ? l.points : l.why]);

test("points: each stale part read in its own call, the calls at once; each reserved (the read's first as ref read, counted daily) and settled; each part saved as its call ends, the ids that stayed kept", async () => {
  claimRows = CLAIM2;
  oldPoints = [{ id: pid(1), part_idx: 0, kind: "indication", subject: "Mockaquine", text: "רק Mockaquine פועלת על ה-dormozoite." }];
  pointsReplies = [
    {
      part: 0,
      delay: 400, // the longer part ends last
      points: [
        P0_ITEM,
        pointItem(0, 2, "contra", "לפני Mockaquine בודקים FXR.", [7], true, 3),
        pointItem(0, 1, "indication", "רק Mockaquine פועלת על ה-dormozoite בכבד!", [5]),
        pointItem(0, 9, "trivia", "נקודה עם סוג לא מוכר", [5]),
      ],
    },
    { part: 1, points: [P1_ITEM, pointItem(0, 1, "drug", "נקודה של חלק אחר בקריאה של חלק 1.", [5])] },
  ];
  const r = await call({ action: "points" });
  assert.equal(r.error, null);
  assert.deepEqual(r.lines.map((l) => l.t), ["start", "part", "part", "done"]);
  assert.deepEqual(
    partLines(r.lines),
    [
      ["part", 1, 1],
      ["part", 0, 2],
    ],
    "a part's line as soon as it is saved: part 1 first",
  );
  assert.deepEqual(r.lines.at(-1), { t: "done", parts: 2, points: 3, costUsd: r.lines.at(-1)!.costUsd, unsettled: 0 });
  assert.equal(models(POINTS_SYSTEM).length, 2, "one call per part");
  const calls = models(POINTS_SYSTEM);
  const texts = calls.map(userText);
  assert.ok(texts.some((t) => t.startsWith("The summary's part, paragraph by paragraph. List the points to know of it.\n\nPart 0: \"מחזור החיים\" (slides 1-12)\n¶0 מחזור החיים\n¶1 ה-dormozoite ישן בכבד") && !t.includes("Part 1")));
  assert.ok(texts.some((t) => t.includes('Part 1: "מנגנונים" (slides 13-24)') && !t.includes("Part 0")));
  const firstSave = rpcs("study_points_save")[0].seq;
  assert.ok(calls.every((m) => m.seq < firstSave), "both calls were made before either part was saved: in parallel");
  const reserves = rpcs("study_reserve").map(args);
  assert.deepEqual(
    reserves.map((x) => [x.p_kind, x.p_ref, x.p_daily, x.p_daily_ref, x.p_share, x.p_member_share, x.p_key, x.p_lecture]),
    [
      ["points", "read", 20, "read", 0.8, 0.4, KEY, LECTURE],
      ["points", "part 1", null, null, 0.8, 0.4, KEY, LECTURE],
    ],
    "the read's first call counts toward the daily limit (as a read), its other calls do not",
  );
  assert.ok(rpcs("study_reserve")[0].seq < calls[0].seq, "reserved before the stream");
  assert.ok(rpcs("study_reserve")[1].seq < calls[1].seq);
  assert.deepEqual(
    rpcs("study_settle").map((l) => args(l).p_id).sort(),
    [101, 102],
    "each call settled against its own reservation",
  );
  const saves = rpcs("study_points_save").map(args);
  assert.deepEqual(
    saves.map((x) => [x.p_part, x.p_md5, x.p_key]),
    [
      [1, "b".repeat(32), KEY],
      [0, "a".repeat(32), KEY],
    ],
  );
  const s0 = saves[1];
  assert.equal(s0.p_points.length, 2, "the repeat is one point, the unknown kind is dropped");
  assert.equal(s0.p_points[0].id, pid(1), "the point that stayed keeps its id");
  assert.equal(s0.p_points[1].id, undefined, "a new point gets a new id");
  assert.deepEqual([s0.p_points[1].kind, s0.p_points[1].red_flag, s0.p_points[1].anchor], ["contra", true, 2]);
  assert.deepEqual(saves[0].p_points.map((x: any) => x.text), ["Testoquine מצטברת בוואקואולה."], "part 1's call keeps only part 1's points");
  assert.equal(rpcs("study_points_fail").length, 0);
});

test("points: one part's reply cut short or refused fails that part with the reason, as a try; the other parts are saved", async () => {
  for (const stop of ["max_tokens", "refusal"] as const) {
    log = [];
    claimRows = CLAIM2;
    pointsReplies = [
      { part: 0, points: [P0_ITEM] },
      { part: 1, points: [P1_ITEM], stop, delay: 100 },
    ];
    const r = await call({ action: "points" });
    assert.equal(r.error, null);
    assert.deepEqual(partLines(r.lines), [
      ["part", 0, 1],
      ["fail", 1, stop === "max_tokens" ? "truncated" : "refusal"],
    ]);
    assert.equal(r.lines.at(-1)!.t, "done");
    assert.deepEqual(rpcs("study_points_save").map((l) => args(l).p_part), [0]);
    assert.deepEqual(args(rpcs("study_points_fail")[0]).p_parts, [1]);
    assert.equal(args(rpcs("study_points_fail")[0]).p_refused, undefined, "a paid try counts toward 'gave up'");
    assert.equal(rpcs("study_settle").length, 2);
  }
});

test("points: busy, no summary and a refused reservation answer before any model call; the claimed parts fail", async () => {
  for (const [code, status] of [
    ["busy", 409],
    ["no summary", 409],
    ["summary not ready", 409],
    ["gave up", 409],
  ] as const) {
    claimRows = code;
    const r = await call({ action: "points" });
    assert.deepEqual([r.status, r.json], [status, { error: code }]);
  }
  claimRows = [{ part_idx: 0, heading: "מחזור החיים", slide_from: 1, slide_to: 12, md5: "a".repeat(32) }];
  reserveRefusal = "member_share";
  const r = await call({ action: "points" });
  assert.deepEqual([r.status, r.json], [402, { error: "member_share" }]);
  assert.deepEqual(
    rpcs("study_points_fail").map((l) => [args(l).p_parts, args(l).p_error, args(l).p_refused]),
    [[[0], "member_share", true]],
    "a refused reservation gives the claim's try back (nothing was asked of the model)",
  );
  assert.equal(models().length, 0);
});

test("points: a reservation refused mid-read stops new calls: the call in flight is saved, the parts never asked fail given back with the reason (a line each), and the stream ends with the code", async () => {
  claimRows = [...CLAIM2, { part_idx: 2, heading: "עוד", slide_from: 13, slide_to: 24, md5: "c".repeat(32) }];
  SECTIONS.push({ idx: 2, title: "עוד", slide_from: 13, slide_to: 24, gen: 1, markdown: MD[1] });
  try {
    reserveRefusal = "member_share";
    reservesGranted = 1; // the read's first reservation, before the stream
    pointsReplies = [{ part: 0, points: [P0_ITEM], delay: 100 }];
    const r = await call({ action: "points" });
    assert.equal(r.status, 200);
    assert.equal(r.error, "member_share");
    assert.deepEqual(partLines(r.lines), [
      ["fail", 1, "member_share"],
      ["fail", 2, "member_share"],
      ["part", 0, 1],
    ]);
    assert.equal(models(POINTS_SYSTEM).length, 1, "nothing asked after the refusal");
    assert.deepEqual(
      rpcs("study_points_fail").map((l) => [args(l).p_parts, args(l).p_error, args(l).p_refused]),
      [
        [[1], "member_share", true],
        [[2], "member_share", true],
      ],
      "a refused reservation gives the claim's try back",
    );
    assert.equal(rpcs("study_settle").length, 1);
  } finally {
    SECTIONS.pop();
  }
});

test("points: a model error fails its own part as a try and stops new calls; a call already in flight is saved; the stream ends with the error", async () => {
  claimRows = CLAIM2;
  pointsReplies = [
    { part: 0, status: 400 },
    { part: 1, points: [P1_ITEM], delay: 150 },
  ];
  const r = await call({ action: "points" });
  assert.equal(r.error, "api_400", "the stream ends with the model's error");
  assert.deepEqual(partLines(r.lines), [
    ["fail", 0, "api_400"],
    ["part", 1, 1],
  ]);
  assert.deepEqual(
    rpcs("study_points_fail").map((l) => [args(l).p_parts, args(l).p_refused ?? false]),
    [[[0], false]],
  );
});

/** readPoints itself, with the action's clients: the time limit and the bound on calls. */
async function readDirect(o: { parts: number[]; stopIn: number; concurrency?: number; pieceMinMs?: number }) {
  const req = new Request("http://localhost/", { headers: { authorization: `Bearer ${TOKEN}` } });
  const { sb } = await memberClient(req);
  const claim = CLAIM2.filter((c) => o.parts.includes(c.part_idx));
  const { parts, old } = await claimedParts(sb, LECTURE, claim);
  const lines: Line[] = [];
  let error: string | null = null;
  try {
    await readPoints({
      client: anthropicClient(),
      sb,
      lecture,
      parts,
      old,
      stopAt: Date.now() + o.stopIn,
      write: (l) => lines.push(JSON.parse(l)),
      concurrency: o.concurrency,
      pieceMinMs: o.pieceMinMs,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { lines, error };
}

test("points: with one call at a time, a model error leaves the parts never asked failed and given back; the time limit fails a part not started in time, given back", async () => {
  pointsReplies = [{ part: 0, status: 400 }];
  const a = await readDirect({ parts: [0, 1], stopIn: 200_000, concurrency: 1 });
  assert.match(a.error ?? "", /400/);
  assert.deepEqual(partLines(a.lines), [
    ["fail", 0, "api_400"],
    ["fail", 1, "api_400"],
  ]);
  assert.deepEqual(
    rpcs("study_points_fail").map((l) => [args(l).p_parts, args(l).p_refused ?? false]),
    [
      [[0], false],
      [[1], true],
    ],
  );
  assert.equal(models(POINTS_SYSTEM).length, 1);
  // Part 0 takes 600 ms; then less than PIECE_MIN_MS is left before stopAt: part 1 is not started.
  log = [];
  pointsReplies = [{ part: 0, points: [P0_ITEM], delay: 600 }];
  const b = await readDirect({ parts: [0, 1], stopIn: PIECE_MIN_MS + 300, concurrency: 1 });
  assert.equal(b.error, null);
  assert.deepEqual(partLines(b.lines), [
    ["part", 0, 1],
    ["fail", 1, "timeout"],
  ]);
  assert.deepEqual(
    rpcs("study_points_fail").map((l) => [args(l).p_parts, args(l).p_error, args(l).p_refused]),
    [[[1], "timeout", true]],
  );
  assert.equal(models(POINTS_SYSTEM).length, 1);
  assert.equal(rpcs("study_reserve").length, 1, "no reservation for a part never started");
});

test("points: a call still running at the time limit is stopped; its part fails as a try (timeout), the others are saved", async () => {
  pointsReplies = [
    { part: 0, points: [P0_ITEM], hang: 8_000 },
    { part: 1, points: [P1_ITEM] },
  ];
  const t0 = Date.now();
  const r = await readDirect({ parts: [0, 1], stopIn: 5_000, pieceMinMs: 0 });
  assert.ok(Date.now() - t0 < 7_500, "stopped at the limit, not at the reply's end");
  assert.equal(r.error, null);
  assert.deepEqual(partLines(r.lines), [
    ["part", 1, 1],
    ["fail", 0, "timeout"],
  ]);
  assert.deepEqual(
    rpcs("study_points_fail").map((l) => [args(l).p_parts, args(l).p_error, args(l).p_refused]),
    [[[0], "timeout", undefined]],
  );
  assert.equal(rpcs("study_settle").length, 2, "the stopped call is settled too");
});

test("points: the reading goes on when the phone closes the stream (waitUntil keeps it): every part saved, every call settled", async () => {
  const CTX = Symbol.for("@vercel/request-context");
  const kept: Array<Promise<unknown>> = [];
  (globalThis as Record<symbol, unknown>)[CTX] = { get: () => ({ waitUntil: (p: Promise<unknown>) => kept.push(p) }) };
  try {
    claimRows = CLAIM2;
    pointsReplies = [
      { part: 0, points: [P0_ITEM], delay: 300 },
      { part: 1, points: [P1_ITEM], delay: 500 },
    ];
    const res = await post({ op: "questions", lectureId: LECTURE, action: "points" });
    const reader = res.body!.getReader();
    await reader.read(); // the first byte
    await reader.cancel(); // the phone is locked
    assert.equal(rpcs("study_points_save").length, 0, "nothing saved yet when the phone left");
    assert.equal(kept.length, 1, "the reading is handed to waitUntil");
    await Promise.all(kept);
    assert.deepEqual(rpcs("study_points_save").map((l) => args(l).p_part), [0, 1]);
    assert.equal(rpcs("study_settle").length, 2);
    assert.equal(rpcs("study_points_fail").length, 0);
  } finally {
    delete (globalThis as Record<symbol, unknown>)[CTX];
  }
});

// ═══ plan ═══

test("plan: the setup screen's numbers, free: parts and points, the three levels, the plan of the options, the estimates, the month", async () => {
  const r = await call({ action: "plan" });
  assert.equal(r.status, 200);
  const j = r.json;
  assert.deepEqual(j.lecture, { slides: 24 });
  assert.deepEqual(j.points, { total: 6, current: true, stale: [], busy: false });
  assert.deepEqual(j.levels, { focused: 2, full: 3, deep: 6 }, "ממוקד: a quarter, half up, every red flag; מלא: a half; מקיף: all");
  assert.deepEqual([j.plan.level, j.plan.total, j.plan.batches], ["full", 3, 2]);
  assert.deepEqual(j.estimate.readUsd, 0);
  assert.deepEqual([j.estimate.questionsUsd, j.estimate.solverUsd, j.estimate.totalUsd, j.estimate.perQuestionUsd, j.estimate.levels], [0.08, 0.02, 0.08, 0.025, { focused: 0.05, full: 0.08, deep: 0.15 }]);
  assert.deepEqual(j.spent, { groupUsd: 3.21, mineUsd: 0.42, capUsd: 33, share: 0.8, memberShare: 0.4 });
  assert.equal(rpcs("study_reserve").length + models().length, 0, "nothing spent");
  // A stale part: its reading's estimate, and the stale list.
  pointsState = state([true, false]);
  const s = await call({ action: "plan", options: { level: "custom", count: 2, parts: [1], styles: ["not_true"] } });
  assert.deepEqual([s.json.points.current, s.json.points.stale, s.json.plan.total, s.json.levels], [false, [1], 2, { focused: 1, full: 1, deep: 2 }]);
  assert.ok(s.json.estimate.readUsd > 0);
});

test("plan: bad options answer 400 with their code; a part not in the summary is bad parts", async () => {
  for (const [options, code] of [
    [{ level: "everything" }, "bad level"],
    [{ level: "custom", count: 0 }, "count out of range"],
    [{ styles: ["essay"] }, "bad styles"],
    [{ difficulty: "x" }, "bad difficulty"],
    [{ focus: "א".repeat(201) }, "focus too long"],
    [{ parts: [9] }, "bad parts"],
  ] as const) {
    const r = await call({ action: "plan", options });
    assert.deepEqual([r.status, r.json], [400, { error: code }], code);
  }
  assert.deepEqual((await call({ action: "nothing" })).json, { error: "bad action" });
  assert.deepEqual((await post({ op: "questions", action: "plan" }).then((r) => r.json())) as unknown, { error: "lectureId required" });
});

test("plan and create (no model call) serve a token with 2 minutes left; points and style still answer 401 session expiring, and under 30 s plan does too", async () => {
  const tokenFor = (secondsLeft: number) => `${b64({ alg: "HS256" })}.${b64({ sub: USER, exp: Math.floor(Date.now() / 1000) + secondsLeft })}.sig`;
  const send = (token: string, body: Record<string, unknown>) =>
    ai.fetch(
      new Request("http://localhost/api/study/ai", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ op: "questions", lectureId: LECTURE, ...body }),
      }),
    );
  const late = tokenFor(120);
  const plan = await send(late, { action: "plan" });
  assert.equal(plan.status, 200, "plan reads and answers in a second");
  const create = await send(late, { action: "create", options: { level: "full" } });
  assert.equal(create.status, 200, "create saves the request with one RPC");
  for (const body of [{ action: "points" }, { action: "style", text: "שאלה לדוגמה?" }]) {
    const r = await send(late, body);
    assert.deepEqual([r.status, await r.json()], [401, { error: "session expiring" }], `${body.action} calls the model and saves after it`);
  }
  assert.equal(models().length, 0, "no model call with a token about to end");
  const r = await send(tokenFor(20), { action: "plan" });
  assert.deepEqual([r.status, await r.json()], [401, { error: "session expiring" }], "under 30 s even plan refuses it");
});

test("plan: a slide saved without tables, a null slide or slides that are not a list plan with what there is (200, not a TypeError)", async () => {
  const slides = lecture.slides;
  try {
    lecture.slides = slides.map(({ tables: _t, ...s }, i) => (i === 19 ? { ...s, tables: [[["a"]]] } : s)) as unknown as Lecture["slides"];
    const r = await call({ action: "plan" });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.lecture, r.json.facts["0"].tables, r.json.facts["1"].tables], [{ slides: 24 }, false, true], "slide 20's table still counts");
    lecture.slides = [null, ...slides] as unknown as Lecture["slides"];
    assert.equal((await call({ action: "plan" })).status, 200);
    lecture.slides = null as unknown as Lecture["slides"];
    const n = await call({ action: "plan" });
    assert.deepEqual([n.status, n.json.lecture], [200, { slides: 0 }]);
  } finally {
    lecture.slides = slides;
  }
  const parts = [{ part_idx: 0, slide_from: 1, slide_to: 12 }];
  assert.deepEqual([...tableParts({ slides: [{ n: 3 }] as unknown as Lecture["slides"] }, parts)], []);
  assert.deepEqual([...tableParts({ slides: [{ n: 3, tables: [[["x"]]] }] as unknown as Lecture["slides"] }, parts)], [0]);
  assert.equal(partFacts({ slides: undefined } as unknown as Lecture, parts, [], []).get(0)?.tables, false);
});

// ═══ create ═══

test("create: the plan saved as a request and its batches (study_request_create, with the key)", async () => {
  const r = await call({ action: "create", options: { level: "deep", styles: ["case", "blank_table"], difficulty: "hard", focus: " מה בודקים לפני טיפול " } });
  assert.equal(r.status, 200);
  const [c] = rpcs("study_request_create").map(args);
  assert.equal(c.p_key, KEY);
  assert.deepEqual(c.p_request, {
    level: "deep",
    count: 6,
    parts: [0, 1],
    styles: ["case", "blank_table"],
    difficulty: "hard",
    style_note: "",
    style_example: "",
    focus: "מה בודקים לפני טיפול",
  });
  assert.deepEqual(
    c.p_batches.map((b: any) => [b.part_idx, b.seq, b.wanted, b.points.length]),
    [
      [0, 0, 4, 4],
      [1, 0, 2, 2],
    ],
  );
  // Part 0's slides have no table: its blank tables become cases; part 1 (slide 20) keeps its blank table.
  assert.deepEqual(c.p_batches[0].styles, ["case", "case", "case", "case"]);
  assert.deepEqual(c.p_batches[1].styles, ["case", "blank_table"]);
  assert.deepEqual(r.json.request, { id: REQ, round: 3, level: "deep", count: 6, parts: [0, 1], styles: ["case", "blank_table"], difficulty: "hard" });
  assert.equal(r.json.batches.length, 2);
  assert.deepEqual(r.json.estimate, { questionsUsd: 0.15 });
  assert.equal(models().length, 0, "no model: the batches are written one by one afterwards");
});

test("create: stale points are 409 points stale; no points in the parts is 400; a forged style is 400 bad style; a signed one travels", async () => {
  pointsState = state([false, true]);
  assert.deepEqual((await call({ action: "create", options: {} })).json, { error: "points stale" });
  pointsState = state([true, true]).map((p, i) => (i === 0 ? { ...p, summary: "writing", current: false } : p));
  assert.deepEqual((await call({ action: "create", options: {} })).json, { error: "summary not ready" }, "a part still being written: not stale, not yet");
  pointsState = state([false, true]);
  assert.equal((await call({ action: "create", options: { parts: [1] } })).status, 200, "only part 1 chosen: current");
  pointsState = state([true, true]);
  pointsList = POINTS.filter((p) => p.part_idx === 1);
  const none = await call({ action: "create", options: { parts: [0] } });
  assert.deepEqual([none.status, none.json], [400, { error: "no points" }], "part 0 is current, and has no points");
  pointsList = POINTS;
  const forged = await call({ action: "create", options: { style: { description: "מקרה", example: "שאלה?", sig: "0".repeat(64) } } });
  assert.deepEqual([forged.status, forged.json], [400, { error: "bad style" }]);
  const sig = await signStyle(KEY, LECTURE, "מקרה קצר", "שאלה?");
  const signed = await call({ action: "create", options: { style: { description: "מקרה קצר", example: "שאלה?", sig } } });
  assert.equal(signed.status, 200);
  const last = args(rpcs("study_request_create").at(-1)!);
  assert.deepEqual([last.p_request.style_note, last.p_request.style_example], ["מקרה קצר", "שאלה?"]);
});

// ═══ create in a round over several lectures (sources.md B6.7) ═══

const PLAN = "88888888-0000-4000-8000-000000000001";
const OTHER = (k: number) => `99999999-0000-4000-8000-${String(k).padStart(12, "0")}`;

test("create in a round: without section S, 503 schema and no request; a planId that is not an id, 400", async () => {
  // First, before a passing check of the same needs is remembered.
  const r = await call({ action: "create", options: { level: "deep" }, planId: PLAN });
  assert.deepEqual([r.status, r.json], [503, { error: "schema" }]);
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 2, S: 1 };
  const bad = await call({ action: "create", options: { level: "deep" }, planId: "round-1" });
  assert.deepEqual([bad.status, bad.json], [400, { error: "bad plan" }]);
  assert.equal(rpcs("study_request_create").length, 0);
  // Without a planId nothing of S is needed: the lecture's own request, as before.
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 2 };
  const own = await call({ action: "create", options: { level: "deep" } });
  assert.equal(own.status, 200);
  assert.equal(own.json.round, undefined);
  assert.equal(rpcs("study_request_plan").length, 0);
});

test("create in a round: the request is made as before and put in the round in one call (study_request_create_in_plan, with the key); caps unchanged", async () => {
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 2, S: 1 };
  planRows = [{ lecture_id: OTHER(1) }, { lecture_id: OTHER(1) }];
  const alone = await call({ action: "create", options: { level: "deep", styles: ["case", "blank_table"], difficulty: "hard" } });
  const [own] = rpcs("study_request_create").map(args);
  log = [];
  const r = await call({ action: "create", options: { level: "deep", styles: ["case", "blank_table"], difficulty: "hard" }, planId: PLAN });
  assert.equal(r.status, 200);
  // The request and its batches are exactly a lecture's own: the same plan, the same caps.
  const [c] = rpcs("study_request_create_in_plan").map(args);
  assert.deepEqual([c.p_request, c.p_batches, c.p_plan, c.p_key, c.p_lecture], [own.p_request, own.p_batches, PLAN, KEY, own.p_lecture]);
  assert.deepEqual({ ...r.json, round: undefined }, { ...alone.json, round: undefined });
  assert.deepEqual(r.json.round, { planId: PLAN, lectures: 2 });
  // One call: no request made apart from its link, nothing to undo when the link is refused.
  assert.equal(rpcs("study_request_create").length, 0);
  assert.equal(rpcs("study_request_plan").length, 0);
  assert.equal(models().length, 0, "no model");
});

test("create in a round: a sixth lecture, or fewer than 4 questions, is refused before any request; the RPC's refusals are their statuses", async () => {
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 2, S: 1 };
  planRows = [1, 2, 3, 4, 5].map((k) => ({ lecture_id: OTHER(k) }));
  const sixth = await call({ action: "create", options: { level: "deep" }, planId: PLAN });
  assert.deepEqual([sixth.status, sixth.json], [409, { error: "round full" }]);
  // This lecture already in the round counts once.
  planRows = [1, 2, 3, 4].map((k) => ({ lecture_id: OTHER(k) })).concat([{ lecture_id: LECTURE }]);
  assert.equal((await call({ action: "create", options: { level: "deep" }, planId: PLAN })).status, 200);
  planRows = [];
  log = [];
  const few = await call({ action: "create", options: { level: "custom", count: 3 }, planId: PLAN });
  assert.deepEqual([few.status, few.json], [400, { error: "too few questions" }]);
  assert.equal(rpcs("study_request_create").length, 0, "nothing made");
  for (const [code, status] of [
    ["round full", 409],
    ["bad plan", 400],
    ["request not found", 404],
  ] as const) {
    planLink = code;
    const res = await call({ action: "create", options: { level: "deep" }, planId: PLAN });
    assert.deepEqual([res.status, res.json], [status, { error: code }], code);
  }
});

test("the router logs a 500 and a refused session (op, action, status, code), never the token or the body; a 400 or 409 is not logged", async () => {
  const logged: unknown[][] = [];
  const real = console.error;
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    createRefusal = "enough questions";
    assert.equal((await call({ action: "create", options: { focus: "מה בודקים" } })).status, 409);
    createRefusal = null;
    assert.equal((await call({ action: "plan", options: { level: "everything" } })).status, 400);
    assert.deepEqual(logged, [], "a refusal the member can act on is not logged");
    createRows = () => [];
    assert.equal((await call({ action: "create", options: { focus: "מה בודקים" } })).status, 500);
    const late = `${b64({ alg: "HS256" })}.${b64({ sub: USER, exp: Math.floor(Date.now() / 1000) + 120 })}.sig`;
    const res = await ai.fetch(
      new Request("http://localhost/api/study/ai", {
        method: "POST",
        headers: { authorization: `Bearer ${late}`, "content-type": "application/json" },
        body: JSON.stringify({ op: "questions", action: "points", lectureId: LECTURE }),
      }),
    );
    assert.equal(res.status, 401);
  } finally {
    console.error = real;
  }
  assert.deepEqual(logged, [
    ["ai", "questions", "create", 500, "no request"],
    ["ai", "questions", "points", 401, "session expiring"],
  ]);
  const text = JSON.stringify(logged);
  for (const secret of [TOKEN, LECTURE, "מה בודקים", USER]) assert.ok(!text.includes(secret), "no token, id or input in the log");
});

test("POLICY: practice 2.0's kinds are optional (80%), 40% a member, with daily limits; the writer and the solver keep theirs", async () => {
  const { POLICY } = await import("./budget.js");
  assert.deepEqual(POLICY.points, { share: 0.8, memberShare: 0.4, daily: 20, dailyRef: "read" });
  assert.deepEqual(POLICY.style, { share: 0.8, memberShare: 0.4, daily: 10 });
  assert.deepEqual(POLICY.reword, { share: 0.8, memberShare: 0.4, daily: 40 });
  assert.deepEqual(POLICY.practice, { share: 0.8, memberShare: 0.4, daily: null });
  assert.deepEqual(POLICY.solver, { share: 0.8, memberShare: 0.4, daily: null });
});

test("create: the database's refusals keep their codes; an empty answer is no request", async () => {
  for (const [code, status] of [
    ["enough questions", 409],
    ["bad parts", 400],
    ["bad request", 400],
  ] as const) {
    createRefusal = code;
    const r = await call({ action: "create", options: {} });
    assert.deepEqual([r.status, r.json], [status, { error: code }], code);
  }
  createRefusal = null;
  createRows = () => [];
  const r = await call({ action: "create", options: {} });
  assert.deepEqual([r.status, r.json], [500, { error: "no request" }]);
});

// ═══ style ═══

test("style: a pasted example read back as the style, reserved as kind style, signed so create takes it back unchanged", async () => {
  styleReplies = [{ styles: [{ description: "מקרה של 2-3 שורות עם גיל, מין ונסיעה, חמש אפשרויות.", example: "אישה בת 28 עם חום.\nמה הצעד הבא?\nא. לבדוק FXR", options: 5, case: true, readable: true }] }];
  const r = await call({ action: "style", text: "אישה בת 28 עם חום. מה הצעד הבא? א. לבדוק FXR" });
  assert.equal(r.status, 200);
  assert.equal(r.json.description, "מקרה של 2-3 שורות עם גיל, מין ונסיעה, חמש אפשרויות.");
  assert.equal(r.json.example, "אישה בת 28 עם חום.\nמה הצעד הבא?\nא. לבדוק FXR", "the example keeps its lines");
  assert.deepEqual([r.json.optionCount, r.json.case], [5, true]);
  assert.ok(await verifyStyle(KEY, LECTURE, r.json));
  assert.ok(!(await verifyStyle(KEY, LECTURE, { ...r.json, description: "אחר" })), "another description is not this signature");
  const [reserve] = rpcs("study_reserve").map(args);
  assert.deepEqual([reserve.p_kind, reserve.p_key], ["style", KEY]);
  assert.equal(rpcs("study_settle").length, 1);
  assert.ok(userText(models(STYLE_READ_SYSTEM)[0]).includes('"אישה בת 28 עם חום. מה הצעד הבא? א. לבדוק FXR"'), "the pasted text, as a JSON string");
});

test("style: a photo goes as an image block; bad input is 400 bad example; nothing readable is 422 no example", async () => {
  styleReplies = [{ styles: [{ description: "שאלה ישירה קצרה, ארבע אפשרויות.", example: "מה המנגנון?\nא. x", options: 4, case: false, readable: true }] }];
  const r = await call({ action: "style", image: { mediaType: "image/jpeg", data: Buffer.from("not really a jpeg").toString("base64") } });
  assert.equal(r.status, 200);
  const sent = JSON.parse(models(STYLE_READ_SYSTEM)[0].body) as { messages: Array<{ content: Array<{ type: string }> }> };
  assert.deepEqual(
    sent.messages[0].content.map((c) => c.type),
    ["image", "text"],
  );
  for (const body of [{}, { text: "א".repeat(3001) }, { image: { mediaType: "image/tiff", data: "AAAA" } }, { image: { mediaType: "image/png", data: "not base64!" } }, { text: 5 }]) {
    const bad = await call({ action: "style", ...body });
    assert.deepEqual([bad.status, bad.json], [400, { error: "bad example" }], JSON.stringify(body).slice(0, 60));
  }
  styleReplies = [{ styles: [{ description: "", example: "", options: 0, case: false, readable: false }] }];
  const none = await call({ action: "style", text: "סתם טקסט בלי שאלה" });
  assert.deepEqual([none.status, none.json], [422, { error: "no example" }]);
});

// ═══ a request's batch: drafts, the solver, the automatic rewrite ═══

const write = () => call({ batchId: B_REQ });

test("drafts: each question saved as a draft at once with its points' ids and style, then the solver's verdict; nothing enters the bank", async () => {
  genReplies = [{ items: [Q_CASE, Q_MECH] }];
  const r = await write();
  assert.equal(r.error, null);
  assert.deepEqual(
    r.lines.map((l) => l.t),
    ["start", "draft", "draft", "check", "check", "done"],
  );
  const d = r.lines.filter((l) => l.t === "draft").map((l) => l.d);
  assert.deepEqual(
    d.map((x) => [x.style, x.points, x.check_state, x.request_id, x.batch_id]),
    [
      ["case", [pid(5)], "checking", REQ, B_REQ],
      ["mechanism", [pid(6)], "checking", REQ, B_REQ],
    ],
  );
  for (const l of r.lines.filter((x) => x.t === "draft")) assert.ok(!/"answer"|"explanations"|"takeaway"|"why"|"whens?"|"correct"/.test(JSON.stringify(l)), "no key in a draft line");
  assert.deepEqual(
    r.lines.filter((l) => l.t === "check").map((l) => l.state),
    ["ok", "ok"],
  );
  assert.equal(rpcs("study_save_question").length, 0, "a request's batch never writes the bank");
  const saves = rpcs("study_draft_save").map(args);
  assert.deepEqual(
    saves.map((s) => [s.p_batch, s.p_key, s.p_q.style, s.p_q.points]),
    [
      [B_REQ, KEY, "case", [pid(5)]],
      [B_REQ, KEY, "mechanism", [pid(6)]],
    ],
  );
  assert.equal(saves[0].p_q.whens.length, 5, "מתי כן per option, saved with the key");
  assert.equal(saves[0].p_q.anchor, undefined);
  assert.equal(saves[0].p_q.para, 1, "the paragraph that answers it");
  // The request: the batch's styles, the level, the points to know, the focus, the group's style example.
  const text = userText(models(QUESTIONS_SYSTEM)[0]);
  assert.ok(text.startsWith("The group gave an example of the style they want, for style only"));
  assert.ok(text.includes("Write the questions in these styles: 1 case, 1 mechanism."));
  assert.ok(text.includes("Level: hard."));
  assert.ok(text.includes("1. [mechanism · Testoquine] Testoquine מצטברת בוואקואולה. (¶1)"));
  assert.ok(text.includes("2. [contra · Fictemisinins · red flag] Fictemisinins לעולם לא ניתנות לבד. (¶2)"));
  assert.ok(text.includes("«רק מה שבודקים לפני טיפול»"));
  assert.ok(text.includes("¶1 Testoquine מצטברת בוואקואולה של הטפיל. [ש' 15]"), "the part, paragraph by paragraph");
  assert.equal((JSON.parse(models(QUESTIONS_SYSTEM)[0].body) as { output_config: { effort: string } }).output_config.effort, "high", "קשה");
  assert.deepEqual(
    rpcs("study_reserve").map((l) => args(l).p_kind),
    ["practice", "solver"],
  );
  const [finish] = rpcs("study_question_finish").map(args);
  assert.deepEqual([finish.p_status, finish.p_solver_rejected], ["ready", 0]);
  assert.deepEqual([r.lines.at(-1)!.made, r.lines.at(-1)!.solverRejected], [2, 0]);
});

test("drafts: one the solver gets wrong is written again once and solved again; the new version replaces it", async () => {
  genReplies = [{ items: [Q_CASE, Q_MECH] }, { items: [Q_CASE2] }];
  solverReplies = [{ wrong: [1] }];
  const r = await write();
  assert.equal(r.error, null);
  assert.deepEqual(
    r.lines.map((l) => (l.t === "check" ? `check:${l.state}` : l.t)),
    ["start", "draft", "draft", "check:failed", "check:ok", "draft", "check:ok", "done"],
  );
  const rewrite = r.lines.filter((l) => l.t === "draft")[2];
  const first = r.lines.filter((l) => l.t === "draft")[0].d.id;
  assert.equal(rewrite.replaces, first);
  assert.equal(rewrite.d.rewrites, 1);
  const [rep] = rpcs("study_draft_replace").map(args);
  assert.deepEqual([rep.p_draft, rep.p_auto, rep.p_key], [first, true, KEY]);
  // The rewrite's request: the question with its key, what the solver chose.
  const again = userText(models(QUESTIONS_SYSTEM)[1]);
  assert.ok(again.includes("Write again 1 question about slides 13-24"));
  assert.ok(again.includes("(the key)") && /The student chose [א-ה]\./.test(again));
  assert.deepEqual(
    rpcs("study_reserve").map((l) => args(l).p_kind),
    ["practice", "solver", "practice", "solver"],
  );
  assert.equal(rpcs("study_draft_reject").length, 0);
  assert.deepEqual(r.lines.at(-1)!.made, 2);
});

test("drafts: still wrong after the rewrite: rejected (a drop line); the batch counts it as the solver's", async () => {
  genReplies = [{ items: [Q_CASE, Q_MECH] }, { items: [Q_CASE2] }];
  solverReplies = [{ wrong: [1] }, { wrong: [1] }];
  const r = await write();
  const drop = r.lines.find((l) => l.t === "drop")!;
  const rewrite = r.lines.filter((l) => l.t === "draft")[2];
  assert.equal(drop.id, rewrite.d.id);
  assert.deepEqual(
    rpcs("study_draft_reject").map((l) => args(l).p_draft),
    [rewrite.d.id],
  );
  assert.deepEqual([r.lines.at(-1)!.made, r.lines.at(-1)!.solverRejected], [1, 1]);
  assert.equal(args(rpcs("study_question_finish")[0]).p_solver_rejected, 0, "a draft's rejection is counted by study_draft_reject itself");
});

test("drafts: the solver could not run (its reservation refused): unchecked, keepable, and no rewrite", async () => {
  genReplies = [{ items: [Q_CASE] }];
  reserveRefusal = "reserve";
  reservesGranted = 1; // the writer's, made by the op before the stream
  const r = await write();
  assert.deepEqual(
    r.lines.filter((l) => l.t === "check").map((l) => l.state),
    ["unchecked"],
  );
  assert.equal(models(SOLVER_SYSTEM).length, 0);
  assert.deepEqual([args(rpcs("study_draft_check")[0]).p_choice, args(rpcs("study_draft_check")[0]).p_ambiguous], [null, null]);
  assert.equal(models(QUESTIONS_SYSTEM).length, 1, "and no second call: its reservation is refused too");
  assert.deepEqual([r.lines.at(-1)!.made, args(rpcs("study_question_finish")[0]).p_status], [1, "ready"]);
});

test("drafts: a draft a member removes while the solver reads it gets no check line and no paid rewrite", async () => {
  genReplies = [{ items: [Q_CASE, Q_MECH] }, { items: [Q_CASE2] }];
  solverReplies = [{ wrong: [1] }];
  goneDrafts = new Set(["77777777-0000-4000-8000-000000000101"]); // the first draft saved
  const r = await write();
  assert.equal(r.error, null);
  assert.deepEqual(
    r.lines.map((l) => (l.t === "check" ? `check:${l.state}` : l.t)),
    ["start", "draft", "draft", "check:ok", "done"],
  );
  assert.equal(models(QUESTIONS_SYSTEM).length, 1, "no rewrite call for a removed draft");
  assert.deepEqual(
    rpcs("study_reserve").map((l) => args(l).p_kind),
    ["practice", "solver"],
  );
  assert.equal(rpcs("study_draft_replace").length + rpcs("study_draft_reject").length, 0);
});

test("drafts: the batch's one rewrite used by the first call: the second call's failures are left for a member, not rejected", async () => {
  // wanted 2: the first call writes one (wrong, rewritten, then right); the second writes the other, which the solver gets wrong.
  genReplies = [{ items: [Q_CASE] }, { items: [Q_CASE2] }, { items: [Q_MECH] }];
  solverReplies = [{ wrong: [1] }, {}, { wrong: [1] }];
  const r = await write();
  assert.equal(r.error, null);
  assert.deepEqual(
    r.lines.map((l) => (l.t === "check" ? `check:${l.state}` : l.t)),
    ["start", "draft", "check:failed", "draft", "check:ok", "start", "draft", "check:failed", "done"],
  );
  assert.equal(models(QUESTIONS_SYSTEM).length, 3, "one rewrite call a batch");
  assert.equal(rpcs("study_draft_reject").length, 0, "no rewrite was tried for the second call's draft");
  assert.deepEqual([r.lines.at(-1)!.made, r.lines.at(-1)!.solverRejected], [2, 0]);
});

// ═══ reword ═══

test("reword: claims the draft, writes it again with its key and the member's note, replaces it, has the solver check it", async () => {
  genReplies = [{ items: [Q_CASE2] }];
  const r = await call({ action: "reword", draftId: DRAFT, note: "פחות ארוך" });
  assert.equal(r.error, null);
  assert.deepEqual(
    r.lines.map((l) => (l.t === "check" ? `check:${l.state}` : l.t)),
    ["start", "draft", "check:ok", "done"],
  );
  assert.deepEqual(args(rpcs("study_draft_reword")[0]), { p_draft: DRAFT, p_key: KEY });
  const [rep] = rpcs("study_draft_replace").map(args);
  assert.deepEqual([rep.p_draft, rep.p_auto], [DRAFT, false]);
  assert.equal(r.lines[1].replaces, DRAFT);
  const reserves = rpcs("study_reserve").map(args);
  assert.deepEqual(
    reserves.map((x) => [x.p_kind, x.p_ref]),
    [
      ["reword", DRAFT],
      ["solver", r.lines[1].d.id],
    ],
  );
  const text = userText(models(QUESTIONS_SYSTEM)[0]);
  assert.ok(text.includes("The group asked for another wording"));
  assert.ok(text.includes("«פחות ארוך»"));
  assert.ok(text.includes("Testoquine (the key)"));
  assert.equal(rpcs("study_draft_release").length, 0);
  assert.deepEqual(r.lines.at(-1)!.made, 1);
});

test("reword: busy, the limit and a draft no longer waiting answer 409; a rewrite that fails its checks frees the draft", async () => {
  for (const code of ["busy", "reword limit", "not pending"]) {
    rewordRefusal = code;
    const r = await call({ action: "reword", draftId: DRAFT });
    assert.deepEqual([r.status, r.json], [409, { error: code }]);
  }
  rewordRefusal = null;
  assert.deepEqual((await call({ action: "reword", draftId: "x" })).json, { error: "lectureId and draftId required" });
  assert.deepEqual((await call({ action: "reword", draftId: DRAFT, note: "א".repeat(201) })).json, { error: "note too long" });
  log = [];
  const bad = structuredClone(Q_CASE2);
  bad.options[1].correct = true;
  genReplies = [{ items: [bad] }];
  const r = await call({ action: "reword", draftId: DRAFT });
  assert.deepEqual(
    r.lines.map((l) => l.t),
    ["start", "skip", "done"],
  );
  assert.deepEqual(r.lines.at(-1)!.made, 0);
  assert.deepEqual(
    rpcs("study_draft_release").map((l) => args(l).p_draft),
    [DRAFT],
  );
  assert.equal(rpcs("study_draft_replace").length, 0);
});

test("reword: a version the solver gets wrong is written again once only while the draft's history allows an automatic rewrite", async () => {
  const Q_CASE3 = { ...Q_CASE, vignette: "נער בן 16 חוזר מאי דמיוני עם צמרמורות, ובמשטח נמצא Exemplaria. נדרשת תרופה שנאגרת בתוך הוואקואולה.", question: "איזו תרופה נאגרת בוואקואולה של Exemplaria?" };
  // A draft with no rewrites yet: its reworded version may still be rewritten automatically.
  genReplies = [{ items: [Q_CASE2] }, { items: [Q_CASE3] }];
  solverReplies = [{ wrong: [1] }, {}];
  const fresh = await call({ action: "reword", draftId: DRAFT });
  assert.equal(fresh.error, null);
  assert.equal(models(QUESTIONS_SYSTEM).length, 2);
  assert.deepEqual(
    rpcs("study_draft_replace").map((l) => args(l).p_auto),
    [false, true],
  );
  // A draft the batch already rewrote once (rewrites 1): the new version has 2, which the database would refuse to rewrite automatically.
  log = [];
  served = [];
  rewordRewrites = 1;
  genReplies = [{ items: [Q_CASE2] }, { items: [Q_CASE3] }];
  solverReplies = [{ wrong: [1] }];
  const r = await call({ action: "reword", draftId: DRAFT });
  assert.equal(r.error, null);
  assert.deepEqual(
    r.lines.map((l) => (l.t === "check" ? `check:${l.state}` : l.t)),
    ["start", "draft", "check:failed", "done"],
  );
  assert.equal(r.lines[1].d.rewrites, 2);
  assert.equal(models(QUESTIONS_SYSTEM).length, 1, "no second, paid call the database would throw away");
  assert.deepEqual(
    rpcs("study_reserve").map((l) => args(l).p_kind),
    ["reword", "solver"],
  );
  assert.deepEqual(
    rpcs("study_draft_replace").map((l) => args(l).p_auto),
    [false],
  );
  assert.equal(rpcs("study_draft_reject").length, 0, "left failed, for a member to reword or remove");
  assert.deepEqual(r.lines.at(-1)!.made, 1);
});

test("reword: a version a member removes while the solver reads it is not rewritten", async () => {
  genReplies = [{ items: [Q_CASE2] }, { items: [Q_CASE] }];
  solverReplies = [{ wrong: [1] }];
  goneDrafts = new Set(["77777777-0000-4000-8000-000000000101"]); // the reworded version
  const r = await call({ action: "reword", draftId: DRAFT });
  assert.equal(r.error, null);
  assert.deepEqual(
    r.lines.map((l) => l.t),
    ["start", "draft", "done"],
  );
  assert.equal(models(QUESTIONS_SYSTEM).length, 1);
  assert.equal(rpcs("study_draft_replace").length, 1);
});

// ═══ Question types (docs/study/question-types.md) ═══

test("question types: plan answers each part's facts and the defaults, and weighs the estimate by the planned types", async () => {
  const r = await call({ action: "plan" });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.facts).sort(), ["0", "1"]);
  assert.equal(r.json.facts["1"].tables, true, "part 1's slide 20 has a table");
  assert.ok(Array.isArray(r.json.defaults) && r.json.defaults[0] === "case" && r.json.defaults.includes("tf"));
  const plain = r.json.estimate.questionsUsd;
  const steps = await call({ action: "plan", options: { level: "full", styles: ["steps"] } });
  assert.ok(steps.json.estimate.questionsUsd > plain, "a staged case weighs 2.5 questions");
});

test("question types: create with a new type answers 409 schema until the database has section X; then it plans them", async () => {
  const no = await call({ action: "create", options: { styles: ["case", "tf"] } });
  assert.deepEqual([no.status, no.json], [409, { error: "schema" }]);
  assert.equal(rpcs("study_request_create").length, 0);
  assert.equal((await call({ action: "create", options: { styles: ["case"] } })).status, 200, "plain types on an older database still work");
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 3, X: 1 };
  const ok = await call({ action: "create", options: { styles: ["case", "tf"] } });
  assert.equal(ok.status, 200);
  const last = args(rpcs("study_request_create").at(-1)!);
  assert.deepEqual(last.p_request.styles, ["case", "tf"]);
  assert.ok(last.p_batches.flatMap((b: { styles: string[] }) => b.styles).includes("tf"));
});

test("question types: a staged case is never reworded (409 not for steps), before anything is claimed or spent", async () => {
  schemaAnswer = { ...REQUIRED_SCHEMA, Q: 3, X: 1 };
  const r = await call({ action: "reword", draftId: DRAFT_STEP });
  assert.deepEqual([r.status, r.json], [409, { error: "not for steps" }]);
  assert.equal(rpcs("study_draft_reword").length + rpcs("study_reserve").length + models().length, 0);
});

const STAGED: Question = {
  ...({} as Question),
  topic: "Testoquine",
  aspect: "treatment",
  style: "steps",
  points: [1],
  takeaway: "Testoquine מצטברת בוואקואולה של הטפיל. [ש' 15]",
  difficulty: 3,
  case: true,
  vignette: "גבר בן 40 חוזר מאי דמיוני עם חום של שלושה ימים. במשטח הדם נמצאו טפילים בתוך תאי הדם האדומים.",
  question: "איזו תרופה מצטברת בוואקואולה של הטפיל?",
  options: [
    opt("Testoquine", "Testoquine מצטברת בוואקואולה של הטפיל. [ש' 15]", true),
    opt("Mockaquine", "Mockaquine פועלת על ה-dormozoite בכבד. [ש' 5]"),
    opt("Fictemisinins", "Fictemisinins ניתנות בשילוב בלבד. [ש' 20]"),
    opt("Placebrin", "Placebrin לא נזכרת בהקשר הזה בשקפים. [ש' 16]"),
    opt("Stubamide", "Stubamide לא נזכרת בהקשר הזה בשקפים. [ש' 17]"),
  ],
  para: 1,
  teaser: "",
  figure: "",
  slides: [15, 16, 17, 20],
  resolved: "הוחלט לתת Testoquine.",
  stages: [
    {
      update: "אחרי יומיים החום חוזר.",
      question: "מה ניתן בשילוב לפי השקפים?",
      options: [
        opt("Fictemisinins", "Fictemisinins ניתנות בשילוב בלבד. [ש' 20]", true),
        opt("Mockaquine", "Mockaquine פועלת בכבד. [ש' 5]"),
        opt("Placebrin", "לא נזכרת. [ש' 16]"),
        opt("Stubamide", "לא נזכרת. [ש' 17]"),
        opt("Examplomycin", "לא בהקשר הזה. [ש' 18]"),
      ],
      resolved: "ניתנו Fictemisinins בשילוב.",
    },
  ],
};

test("question types: a staged case is saved step by step in one series and counted once; a failed step rejects it whole, never rewritten", async () => {
  batchStyles = ["steps", "mechanism"];
  genReplies = [{ items: [STAGED, Q_MECH] }];
  solverReplies = [{ ambiguous: [3] }];
  const r = await write();
  assert.equal(r.error, null);
  const saves = rpcs("study_draft_save").map(args);
  assert.deepEqual(
    saves.map((s) => [s.p_q.style, s.p_q.step ?? null]),
    [
      ["steps", 1],
      ["steps", 2],
      ["mechanism", null],
    ],
  );
  assert.equal(saves[0].p_q.series, saves[1].p_q.series);
  assert.match(saves[1].p_q.vignette, /הוחלט לתת Testoquine\. אחרי יומיים החום חוזר\.$/);
  // The solver read all three; step 2 was ambiguous: the case is rejected through that step, the plain question kept.
  assert.equal(rpcs("study_draft_reject").length, 1);
  assert.equal(args(rpcs("study_draft_reject")[0]).p_draft, r.lines.filter((l) => l.t === "draft")[1].d.id);
  assert.ok(!models(QUESTIONS_SYSTEM).some((m) => userText(m).startsWith("Write again")), "no rewrite call for a staged case (a second call asks for the rest)");
  assert.deepEqual([r.lines.at(-1)!.made, r.lines.at(-1)!.solverRejected], [1, 1], "the case counted once, then dropped");
  // The writer's reservation scales with the case (2.5 questions): max_tokens of the call.
  assert.equal((JSON.parse(models(QUESTIONS_SYSTEM)[0].body) as { max_tokens: number }).max_tokens, 4_000 + Math.ceil(2_500 * 3.5));
});
