import type Anthropic from "@anthropic-ai/sdk";
import { getDeadline, waitUntil } from "@vercel/functions"; // 3.10.5, pinned
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";
import {
  type CreateAnswer,
  EXPECTED_USD,
  levelCounts,
  type Options,
  planRequest,
  type PlanAnswer,
  type PlanPoint,
  type PointsLine,
  pointsUsd,
  type PointsPart,
  plannedStyles,
  readOptions,
  requestUsd,
  solverUsd,
  type Style,
  type StyleAnswer,
  type WriteLine,
} from "../../shared/study/practice2.js";
import { addFacts, defaultStylesFor, emptyFacts, isNewStyle, type PartFacts } from "../../shared/study/forms.js";
import { estimateUsd, imageTokens, monthlyCap, POLICY, reserve } from "./budget.js";
import { figureList } from "./cards.js";
import { generateItems, settleFor } from "./claude.js";
import type { Op } from "./ops/types.js";
import { claimedParts, claimPoints, failParts, pieceEstimate, pointPieces, POINTS_READ_REF, readPoints } from "./points.js";
import {
  AUTO_REWRITE_LIMIT,
  DRAFT_GONE,
  type DraftMode,
  knownDrafts,
  knownQuestions,
  checkCall,
  maxTokensFor,
  questionsSystem,
  readPart,
  solverFree,
  solverItemOf,
  typesCtx,
  REWRITE_MIN_MS,
  safe,
  SOLVER_MIN_MS,
} from "./practice.js";
import { type RequestPoint, rewriteRequest, STYLE_READ_SYSTEM, styleExampleBlock, styleReadRequest } from "./prompts/questions.js";
import { checkQuestion, type Known, QuestionIn, QuestionSet, type SaveItem, tidy, toDraftPublic } from "./questions.js";
import { solveQuestions, solverEstimate, type Verdict } from "./solver.js";
import {
  anthropic,
  deckText,
  detachedStream,
  errorText,
  HttpError,
  json,
  keyed,
  type Lecture,
  loadLecture,
  memberClient,
  MODEL,
  serverKey,
  textStream,
  tidyMarkdown,
} from "./study.js";

/* ── Practice 2.0: op "questions"'s actions besides writing a batch ──
 * (docs/study/proposal/practice-2/DECISIONS.md; the API in docs/study/practice-2-api.md)
 *
 *   { op: "questions", action: "points", lectureId }           reads the lecture's points to know (paid once for the group)
 *   { op: "questions", action: "plan", lectureId, options? }   what the setup screen shows: points, counts, estimates (free)
 *   { op: "questions", action: "create", lectureId, options }  a request and its batches (free; the batches are then
 *                                                               written one by one: { op: "questions", lectureId, batchId })
 *   { op: "questions", action: "style", lectureId, text?, image? }  an example read back as the style (paid, small)
 *   { op: "questions", action: "reword", lectureId, draftId, note? } one pending draft written again (paid)
 *
 * Each checks the member (their token: RLS decides what they read) and the
 * server key; each model call is reserved first with its kind (points,
 * style, reword, solver) and settled after it. Keeping, keeping all and
 * removing drafts are the members' own RPCs (study_draft_keep,
 * study_draft_keep_all, study_draft_remove): no model, no op. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The model call of an action stops this long after the function started. */
const TIME_LIMIT_MS = 270_000;

const idOf = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);
function lectureIdOf(body: Record<string, unknown>): string {
  const id = idOf(body.lectureId);
  if (!id) throw new HttpError(400, "lectureId required");
  return id;
}

/* ── points: read the lecture's points to know ── */

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Claims the stale parts (none: a done line, nothing spent), reserves the
 *  read's first call before the stream (a refusal is its HTTP status, as
 *  402 member_share), then reads part by part in parallel (points.ts),
 *  saving each part as its call ends. The reading does not depend on the
 *  phone: it runs in waitUntil and goes on when the stream is closed or
 *  dropped (a locked phone, another screen); phones follow it through
 *  study_point_parts. It stops in time: 270 s after the function started,
 *  and 25 s before Vercel's deadline. Lines: start · part · fail · done. */
export const pointsAction: Op = async (req, body, started) => {
  const lectureId = lectureIdOf(body);
  const { sb } = await memberClient(req);
  const client = anthropic();
  serverKey();
  const lecture = await loadLecture(sb, lectureId);
  const claim = await claimPoints(sb, lectureId);
  if (!claim.length) return textStream(async (write) => write(JSON.stringify({ t: "done", parts: 0, points: 0, costUsd: 0, unsettled: 0 } satisfies PointsLine) + "\n"));
  let parts: Awaited<ReturnType<typeof claimedParts>>["parts"];
  let old: Awaited<ReturnType<typeof claimedParts>>["old"];
  let reserved: number;
  try {
    ({ parts, old } = await claimedParts(sb, lectureId, claim));
    const first = pointPieces(parts)[0];
    reserved = await reserve(sb, { groupId: lecture.group_id, lectureId, kind: "points", ref: POINTS_READ_REF, estimateUsd: pieceEstimate(first) });
  } catch (e) {
    await failParts(
      sb,
      lectureId,
      claim.map((c) => c.part_idx),
      errorText(e),
      0,
      true, // nothing was asked of the model: the try is given back
    );
    throw e;
  }
  const deadline = getDeadline()?.getTime();
  const stopAt = Math.min(started + TIME_LIMIT_MS, deadline ? deadline - 25_000 : Infinity);
  return detachedStream(async (write) => {
    const res = await readPoints({ client, sb, lecture, parts, old, stopAt, write, reserved });
    write(JSON.stringify({ t: "done", parts: res.parts, points: res.points, costUsd: round6(res.costUsd), unsettled: res.unsettled } satisfies PointsLine) + "\n");
  }, waitUntil);
};

/* ── plan: the setup screen's numbers (free) ── */

type StateRow = PointsPart;

async function pointsState(sb: SupabaseClient, lectureId: string): Promise<StateRow[]> {
  const { data, error } = await sb.rpc("study_points_state", { p_lecture: lectureId });
  if (error) throw new HttpError(error.message === "lecture not found" ? 404 : 500, error.message);
  return ((data ?? []) as StateRow[]).map((r) => ({ ...r, part_idx: Number(r.part_idx), points: Number(r.points), red_flags: Number(r.red_flags) }));
}

async function planPoints(sb: SupabaseClient, lectureId: string): Promise<PlanPoint[]> {
  const { data, error } = await sb
    .from("study_points")
    .select("id, part_idx, n, kind, red_flag, weight")
    .eq("lecture_id", lectureId)
    .order("part_idx")
    .order("n");
  if (error) throw new HttpError(500, error.message);
  return (data ?? []) as PlanPoint[];
}

/** What each part offers the question types (forms.ts canStyle): a table on
 *  its slides, the pictures its summary captions (fig:N-K), those with label
 *  geometry, its points by kind. */
export function partFacts(
  lecture: Pick<Lecture, "slides">,
  parts: ReadonlyArray<Pick<StateRow, "part_idx" | "slide_from" | "slide_to">>,
  sections: ReadonlyArray<{ idx: number; markdown: string | null }>,
  points: ReadonlyArray<Pick<PlanPoint, "part_idx" | "kind">>,
): Map<number, PartFacts> {
  const tables = tableParts(lecture, parts);
  const out = new Map<number, PartFacts>();
  for (const p of parts) {
    const md = sections.find((s) => s.idx === p.part_idx)?.markdown ?? "";
    const captioned = md ? figureList([md], p.slide_from, p.slide_to) : [];
    let labelled = 0;
    for (const sl of lecture.slides) {
      if (sl.n < p.slide_from || sl.n > p.slide_to) continue;
      labelled += (sl.figures ?? []).filter((f) => f.geo && Array.isArray(f.geo.labels) && f.geo.labels.length >= 3).length;
    }
    const kinds: Record<string, number> = {};
    for (const pt of points) if (pt.part_idx === p.part_idx) kinds[pt.kind] = (kinds[pt.kind] ?? 0) + 1;
    out.set(p.part_idx, { tables: tables.has(p.part_idx), figures: captioned.length, labelled, points: kinds });
  }
  return out;
}

/** The facts of the chosen parts together (the defaults of the type chips). */
export const factsOf = (facts: ReadonlyMap<number, PartFacts>, parts: readonly number[]): PartFacts =>
  parts.reduce((a, p) => addFacts(a, facts.get(p) ?? emptyFacts()), emptyFacts());

/** A request with a question type needs section X (Q 3 and X 1, docs/study/question-types.md): 409 "schema" before. */
export async function needTypes(sb: SupabaseClient, styles: readonly string[]): Promise<void> {
  if (!styles.some((s) => isNewStyle(s))) return;
  const { data, error } = await sb.rpc("study_schema");
  const have = !error && data && typeof data === "object" ? (data as Record<string, number>) : {};
  if ((have.X ?? 0) < 1 || (have.Q ?? 0) < 3) throw new HttpError(409, "schema");
}

/** The parts whose slides show a table (a blank table needs one). */
export function tableParts(lecture: Pick<Lecture, "slides">, parts: ReadonlyArray<Pick<StateRow, "part_idx" | "slide_from" | "slide_to">>): Set<number> {
  const tables = new Set(lecture.slides.filter((s) => s.tables.length > 0).map((s) => s.n));
  return new Set(parts.filter((p) => [...tables].some((n) => n >= p.slide_from && n <= p.slide_to)).map((p) => p.part_idx));
}

function optionsOf(raw: unknown): Options {
  const r = readOptions(raw ?? {});
  if (!r.ok) throw new HttpError(400, r.code);
  return r.options;
}

/** The parts a request takes: the ones the member chose, else every part
 *  with points; each must be one of the summary's parts. */
function chosenParts(state: readonly StateRow[], options: Options): number[] {
  const known = new Set(state.map((s) => s.part_idx));
  if (options.parts) {
    if (options.parts.some((p) => !known.has(p))) throw new HttpError(400, "bad parts");
    return options.parts;
  }
  return state.filter((s) => s.points > 0).map((s) => s.part_idx);
}

/** { lectureId, options? }: the parts with their points (study_points_state),
 *  which are stale, the three levels' counts and the plan of these options,
 *  the estimates (reading the points when any is stale, the questions, a
 *  reword, reading an example) and the month's spend. No model, no spend. */
export const planAction: Op = async (req, body) => {
  const lectureId = lectureIdOf(body);
  const options = optionsOf(body.options);
  const { sb } = await memberClient(req);
  const lecture = await loadLecture(sb, lectureId);
  const [state, points, sections, spent, mine] = await Promise.all([
    pointsState(sb, lectureId),
    planPoints(sb, lectureId),
    sb.from("study_sections").select("idx, markdown").eq("lecture_id", lectureId),
    sb.rpc("study_spent", { p_group: lecture.group_id }),
    sb.rpc("study_my_spent", { p_group: lecture.group_id }),
  ]);
  if (sections.error) throw new HttpError(500, sections.error.message);
  const stale = state.filter((s) => s.summary === "ready" && !s.current).map((s) => s.part_idx);
  const chars = ((sections.data ?? []) as Array<{ idx: number; markdown: string }>)
    .filter((s) => stale.includes(s.idx))
    .reduce((n, s) => n + (s.markdown ?? "").length, 0);
  const parts = chosenParts(state, options);
  const facts = partFacts(lecture, state, (sections.data ?? []) as Array<{ idx: number; markdown: string | null }>, points);
  const plan = planRequest({ points, level: options.level, count: options.count, parts, styles: options.styles, partFacts: facts });
  const levels = levelCounts(points, parts);
  const readUsd = stale.length ? pointsUsd(chars, stale.length) : 0;
  const planned = plannedStyles(plan);
  const answer: PlanAnswer = {
    lecture: { slides: lecture.slides.length },
    parts: state,
    points: {
      total: state.reduce((n, s) => n + s.points, 0),
      current: stale.length === 0 && state.some((s) => s.summary === "ready"),
      stale,
      busy: state.some((s) => s.busy),
    },
    levels,
    plan: { level: options.level, total: plan.total, parts: plan.parts, batches: plan.batches.length },
    // Question types: what each part offers, and the types checked first for the chosen parts.
    facts: Object.fromEntries([...facts].map(([k, v]) => [String(k), v])),
    defaults: defaultStylesFor(factsOf(facts, parts)) as Style[],
    estimate: {
      readUsd,
      // Weighted by the planned types (a label item half, a staged case 2.5).
      questionsUsd: requestUsd(planned),
      // The blind solver's part of questionsUsd, shown apart ("כל שאלה נבדקת בידי פותר עיוור").
      solverUsd: solverUsd(planned),
      totalUsd: Math.round((readUsd + requestUsd(planned)) * 100) / 100,
      perQuestionUsd: EXPECTED_USD.question,
      levels: { focused: requestUsd(levels.focused), full: requestUsd(levels.full), deep: requestUsd(levels.deep) },
      rewordUsd: EXPECTED_USD.reword,
      styleUsd: EXPECTED_USD.style,
    },
    spent: {
      groupUsd: spent.error ? null : Number(spent.data),
      mineUsd: mine.error ? null : Number(mine.data),
      capUsd: monthlyCap(),
      share: POLICY.practice.share,
      memberShare: POLICY.practice.memberShare,
    },
  };
  return json(200, answer);
};

/* ── create: a request and its batches (free) ── */

const enc = new TextEncoder();
const hmacKey = (key: string, use: "sign" | "verify") => crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, [use]);
const styleBytes = (lectureId: string, description: string, example: string) => enc.encode(`style\n${lectureId}\n${description}\n${example}`);

/** HMAC-SHA256(STUDY_WORKER_KEY, "style", lectureId, description, example), hex. */
export async function signStyle(key: string, lectureId: string, description: string, example: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(key, "sign"), styleBytes(lectureId, description, example));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function verifyStyle(key: string, lectureId: string, s: { description: string; example: string; sig: string }): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(s.sig)) return false;
  const mac = new Uint8Array(32);
  for (let i = 0; i < 32; i++) mac[i] = parseInt(s.sig.slice(2 * i, 2 * i + 2), 16);
  return crypto.subtle.verify("HMAC", await hmacKey(key, "verify"), mac, styleBytes(lectureId, s.description, s.example));
}

/** study_request_create's refusals, as HTTP statuses. */
const CREATE_STATUS: Record<string, number> = {
  "enough questions": 409,
  "bad parts": 400,
  "bad request": 400,
  "lecture not found": 404,
  forbidden: 403,
  "not signed in": 401,
};

/** { lectureId, options }: checks the options (400), the style's signature
 *  (400 "bad style"), that every chosen part is written (409 "summary not
 *  ready") and its points current (409 "points stale": action "points"
 *  reads them first), plans the request
 *  from the points (planRequest) and saves it with its batches
 *  (study_request_create). The batches are then written one by one. */
export const createAction: Op = async (req, body) => {
  const lectureId = lectureIdOf(body);
  const options = optionsOf(body.options);
  const { sb } = await memberClient(req);
  const key = serverKey();
  const lecture = await loadLecture(sb, lectureId);
  if (options.style && !(await verifyStyle(key, lectureId, options.style))) throw new HttpError(400, "bad style");
  await needTypes(sb, options.styles);
  const [state, points, sections] = await Promise.all([
    pointsState(sb, lectureId),
    planPoints(sb, lectureId),
    sb.from("study_sections").select("idx, markdown").eq("lecture_id", lectureId),
  ]);
  if (sections.error) throw new HttpError(500, sections.error.message);
  const parts = chosenParts(state, options);
  const chosen = state.filter((s) => parts.includes(s.part_idx));
  // A part still being written has no points yet; one whose text changed is read again first.
  if (chosen.some((s) => s.summary !== "ready")) throw new HttpError(409, "summary not ready");
  if (chosen.some((s) => !s.current)) throw new HttpError(409, "points stale");
  const facts = partFacts(lecture, state, (sections.data ?? []) as Array<{ idx: number; markdown: string | null }>, points);
  const plan = planRequest({ points, level: options.level, count: options.count, parts, styles: options.styles, partFacts: facts });
  if (plan.total === 0) throw new HttpError(400, "no points");
  const used = plan.parts.filter((p) => p.questions > 0).map((p) => p.part_idx);
  const { data, error } = await sb.rpc(
    "study_request_create",
    keyed({
      p_lecture: lectureId,
      p_request: {
        level: options.level,
        count: plan.total,
        parts: used,
        styles: options.styles,
        difficulty: options.difficulty,
        style_note: options.style?.description ?? "",
        style_example: options.style?.example ?? "",
        focus: options.focus,
      },
      p_batches: plan.batches,
    }),
  );
  if (error) throw new HttpError(CREATE_STATUS[error.message] ?? 500, error.message);
  const rows = (data ?? []) as Array<{ request_id: string; round: number; batch_id: string; part_idx: number; seq: number; wanted: number }>;
  if (!rows.length) throw new HttpError(500, "no request");
  const answer: CreateAnswer = {
    request: {
      id: rows[0].request_id,
      round: Number(rows[0].round),
      level: options.level,
      count: plan.total,
      parts: used,
      styles: options.styles,
      difficulty: options.difficulty,
    },
    batches: rows.map((r) => ({ id: r.batch_id, part_idx: Number(r.part_idx), seq: Number(r.seq), wanted: Number(r.wanted) })),
    plan: plan.parts,
    estimate: { questionsUsd: requestUsd(plannedStyles(plan)) },
  };
  return json(200, answer);
};

/* ── style: an example read back ── */

export const StyleRead = z.object({
  description: z.string().describe("The style in one or two short Hebrew sentences, starting from its shape"),
  example: z.string().describe("The question as text, exactly as it reads, each option on its own line with its letter"),
  options: z.number().int().describe("How many options it has; 0 when none can be seen"),
  case: z.boolean().describe("true when it opens with a patient story"),
  readable: z.boolean().describe("false when there is no exam question in what was received"),
});
export const StyleReadSet = z.object({ styles: z.array(StyleRead) });

/** What action "style" accepts: a pasted text, a picture, or both. */
export const STYLE_TEXT_MAX = 3000;
/** Base64 characters of the picture (about 2 MB; the app sends at most 1,400 px). */
export const STYLE_IMAGE_MAX = 2_800_000;
const MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type Media = (typeof MEDIA)[number];
export const STYLE_MAX_TOKENS = 2_000;
/** The API reads a picture at most about 1,600 px on its long side: its
 *  reservation assumes that many tokens, whatever the phone sent. */
const STYLE_IMAGE_TOKENS = imageTokens(1600, 1600);

/** The example a style request carries, or the code that refuses it (400 "bad example"). */
export function readExample(body: Record<string, unknown>): { text: string; image: { media_type: Media; data: string } | null } {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (body.text !== undefined && typeof body.text !== "string") throw new HttpError(400, "bad example");
  if (text.length > STYLE_TEXT_MAX) throw new HttpError(400, "bad example");
  let image: { media_type: Media; data: string } | null = null;
  if (body.image !== undefined && body.image !== null) {
    const im = body.image as Record<string, unknown>;
    const media = im && typeof im === "object" ? im.mediaType : undefined;
    const data = im && typeof im === "object" ? im.data : undefined;
    if (
      typeof media !== "string" ||
      !(MEDIA as readonly string[]).includes(media) ||
      typeof data !== "string" ||
      !data.length ||
      data.length > STYLE_IMAGE_MAX ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    ) {
      throw new HttpError(400, "bad example");
    }
    image = { media_type: media as Media, data };
  }
  if (!text && !image) throw new HttpError(400, "bad example");
  return { text, image };
}

/** One line per row, whitespace collapsed (the example keeps its lines). */
const tidyLines = (s: string) =>
  tidyMarkdown(s)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

/** { lectureId, text?, image? }: reads the example back as the style the
 *  questions will be written in, "ככה השאלות ייכתבו: …" (kind "style", one
 *  small call). Answers { description, example, optionCount, case, sig,
 *  costUsd }; `sig` lets "create" carry them back unchanged. 422 "no
 *  example" when there is no question in it. */
export const styleAction: Op = async (req, body, started) => {
  const lectureId = lectureIdOf(body);
  const example = readExample(body);
  const { sb } = await memberClient(req);
  const client = anthropic();
  const key = serverKey();
  const lecture = await loadLecture(sb, lectureId);
  const user: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(example.image ? [{ type: "image" as const, source: { type: "base64" as const, media_type: example.image.media_type, data: example.image.data } }] : []),
    { type: "text", text: styleReadRequest({ text: example.text, image: example.image !== null }) },
  ];
  const chars = STYLE_READ_SYSTEM.length + example.text.length + 200;
  const rid = await reserve(sb, {
    groupId: lecture.group_id,
    lectureId,
    kind: "style",
    ref: lectureId,
    estimateUsd: estimateUsd(MODEL, chars, STYLE_MAX_TOKENS, example.image ? STYLE_IMAGE_TOKENS : 0),
  });
  let costUsd = 0;
  let unsettled = 0;
  const items: Array<z.infer<typeof StyleRead>> = [];
  const res = await generateItems({
    client,
    kind: "style",
    ref: lectureId,
    system: [{ type: "text", text: STYLE_READ_SYSTEM }],
    messages: [{ role: "user", content: user }],
    effort: "low",
    maxTokens: STYLE_MAX_TOKENS,
    stopAt: started + 120_000,
    wrapper: StyleReadSet,
    item: StyleRead,
    onItem: (it) => items.push(it),
    ledger: async (s) => {
      costUsd += s.costUsd;
      return settleFor(sb, rid, () => (unsettled += 1))(s);
    },
  });
  if (res.stop === "refusal") throw new HttpError(422, "refusal");
  if (res.timedOut) throw new HttpError(504, "timeout");
  const it = items[0];
  const description = it ? tidy(it.description).slice(0, 400) : "";
  const text = it ? tidyLines(it.example).slice(0, 2000) : "";
  if (!it || !it.readable || !description || !text) throw new HttpError(422, "no example");
  const answer: StyleAnswer = {
    description,
    example: text,
    optionCount: Math.max(0, Math.min(6, Math.round(it.options))),
    case: it.case,
    sig: await signStyle(key, lectureId, description, text),
    costUsd: round6(costUsd),
    unsettled,
  };
  return json(200, answer);
};

/* ── reword: one draft written again ── */

type DraftRow = {
  id: string;
  lecture_id: string;
  request_id: string;
  batch_id: string | null;
  part_idx: number;
  style: Style;
  points: string[];
  vignette: string;
  question: string;
  options: string[];
  status: string;
  /** Question types (absent before section Q 3). */
  form?: string;
  layout?: { kind?: string; prompts?: string[] } | null;
  series?: string | null;
};
/** answer null: a set question (its key stays on the server and is not needed to write it again). */
type KeyRow = { answer: number | null; explanations: string[]; takeaway: string; whens: string[]; rewrites: number };

/** study_draft_reword's refusals, as HTTP statuses. */
const REWORD_STATUS: Record<string, number> = {
  busy: 409,
  "not pending": 409,
  "reword limit": 409,
  "not for steps": 409,
  "draft not found": 404,
  forbidden: 403,
  "not signed in": 401,
};

const NOTE_MAX = 200;

/** Frees a draft whose reword wrote nothing (keep and remove may go on). */
async function releaseDraft(sb: SupabaseClient, draftId: string): Promise<void> {
  try {
    const { error } = await sb.rpc("study_draft_release", keyed({ p_draft: draftId }));
    if (error) console.error(`study_draft_release ${draftId}: ${error.message}`);
  } catch (e) {
    console.error(`study_draft_release ${draftId}: ${errorText(e)}`);
  }
}

/** { lectureId, draftId, note? }: "↻ לנסח מחדש". Claims the draft (four
 *  minutes; another phone's reword is 409 "busy"), writes it again with its
 *  key, points and style (kind "reword", ref the draft), checks it, saves it
 *  as the draft's new version (study_draft_replace) and has the blind solver
 *  answer it (kind "solver"); a version the solver gets wrong is written
 *  again once more, and then rejected if it still fails. Lines: start ·
 *  draft (replaces) · check · drop · skip · done {made, rejected,
 *  solverRejected, costUsd, unsettled}. */
export const rewordAction: Op = async (req, body, started) => {
  const lectureId = lectureIdOf(body);
  const draftId = idOf(body.draftId);
  if (!draftId) throw new HttpError(400, "lectureId and draftId required");
  if (body.note !== undefined && typeof body.note !== "string") throw new HttpError(400, "bad request");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > NOTE_MAX) throw new HttpError(400, "note too long");
  const { sb } = await memberClient(req);
  const client = anthropic();
  serverKey();
  const lecture = await loadLecture(sb, lectureId);
  let dr = await sb
    .from("study_question_drafts")
    .select("id, lecture_id, request_id, batch_id, part_idx, style, points, vignette, question, options, status, form, layout, series")
    .eq("id", draftId)
    .maybeSingle();
  // A database before section Q 3 has no question types' columns: the draft is a plain one.
  if (dr.error && /column/.test(dr.error.message)) {
    dr = await sb
      .from("study_question_drafts")
      .select("id, lecture_id, request_id, batch_id, part_idx, style, points, vignette, question, options, status")
      .eq("id", draftId)
      .maybeSingle();
  }
  if (dr.error) throw new HttpError(500, dr.error.message);
  if (!dr.data) throw new HttpError(404, "draft not found");
  const draft = dr.data as DraftRow;
  if (draft.lecture_id !== lectureId) throw new HttpError(400, "draft of another lecture");
  if (draft.status !== "pending") throw new HttpError(409, "not pending");
  if (!draft.batch_id) throw new HttpError(404, "draft not found");
  // A staged case is kept or removed whole; version 1 never rewrites one.
  if (draft.series || draft.style === "steps") throw new HttpError(409, "not for steps");
  await needTypes(sb, [draft.style]);

  const keyRes = await sb.rpc("study_draft_reword", keyed({ p_draft: draftId }));
  if (keyRes.error) throw new HttpError(REWORD_STATUS[keyRes.error.message] ?? 500, keyRes.error.message);
  const key = ((Array.isArray(keyRes.data) ? keyRes.data[0] : keyRes.data) ?? null) as KeyRow | null;
  if (!key) throw new HttpError(404, "draft not found");

  let ctx: RewordCtx;
  let reserved: number;
  try {
    ctx = await rewordContext(sb, lecture, draft);
    const user = rewordUser(ctx, draft, key, note);
    reserved = await reserve(sb, {
      groupId: lecture.group_id,
      lectureId,
      kind: "reword",
      ref: draftId,
      estimateUsd: estimateUsd(MODEL, questionsSystem(lecture, null).reduce((n, b) => n + b.text.length, 0) + user.length, maxTokensFor(1)),
    });
  } catch (e) {
    await releaseDraft(sb, draftId);
    throw e;
  }
  return textStream(async (raw) => {
    const write = safe(raw);
    const res = await rewordDraft({ client, sb, lecture, draft, key, note, ctx, reserved, stopAt: started + TIME_LIMIT_MS, write });
    write(JSON.stringify({ t: "done", ...res, costUsd: round6(res.costUsd) } satisfies WriteLine) + "\n");
  });
};

/** What a reword needs besides the draft: its batch's part and slides, the
 *  request's level and focus and the group's style, the batch's points (the
 *  draft's points as their numbers), the part's text, and what is already
 *  asked (the draft itself excluded). */
type RewordCtx = {
  claim: { part_idx: number; heading: string; slide_from: number; slide_to: number };
  mode: DraftMode;
  points: Array<{ id: string } & RequestPoint>;
  part: Awaited<ReturnType<typeof readPart>>;
  known: Known[];
};

async function rewordContext(sb: SupabaseClient, lecture: Lecture, draft: DraftRow): Promise<RewordCtx> {
  const [batch, req] = await Promise.all([
    sb.from("study_question_batches").select("part_idx, heading, slide_from, slide_to, points").eq("id", draft.batch_id!).maybeSingle(),
    sb.from("study_question_requests").select("id, difficulty, focus, style_note, style_example").eq("id", draft.request_id).maybeSingle(),
  ]);
  if (batch.error) throw new HttpError(500, batch.error.message);
  if (req.error) throw new HttpError(500, req.error.message);
  if (!batch.data || !req.data) throw new HttpError(404, "draft not found");
  const b = batch.data as { part_idx: number; heading: string; slide_from: number; slide_to: number; points: string[] };
  const rq = req.data as { id: string; difficulty: DraftMode["difficulty"]; focus: string; style_note: string; style_example: string };
  const ids = b.points ?? [];
  const pts = ids.length ? await sb.from("study_points").select("id, kind, subject, text, red_flag, anchor").in("id", ids) : { data: [], error: null };
  if (pts.error) throw new HttpError(500, pts.error.message);
  const byId = new Map(((pts.data ?? []) as Array<{ id: string } & RequestPoint>).map((p) => [p.id, p]));
  const points = ids.map((id) => byId.get(id)).filter((p): p is { id: string } & RequestPoint => !!p);
  const claim = { part_idx: b.part_idx, heading: b.heading, slide_from: b.slide_from, slide_to: b.slide_to };
  const [part, bank, pending] = await Promise.all([readPart(sb, lecture.id, claim, lecture), knownQuestions(sb, lecture.id), knownDrafts(sb, lecture.id)]);
  return {
    claim,
    points,
    part,
    known: [...bank, ...pending.filter((k) => k.id !== draft.id)],
    mode: {
      requestId: rq.id,
      difficulty: rq.difficulty,
      focus: rq.focus ?? "",
      styles: [draft.style],
      points,
      memberStyle: rq.style_note ? { description: rq.style_note, example: rq.style_example ?? "" } : null,
    },
  };
}

/** The user text of a member's reword (and of the solver's rewrite after it). */
function rewordUser(
  c: RewordCtx,
  draft: Pick<DraftRow, "style" | "points" | "vignette" | "question" | "options" | "form" | "layout">,
  key: KeyRow,
  note: string,
  chose?: Verdict | null,
): string {
  const numbers = draft.points.map((id) => c.points.findIndex((p) => p.id === id) + 1).filter((n) => n > 0);
  const request = rewriteRequest({
    heading: c.claim.heading,
    from: c.claim.slide_from,
    to: c.claim.slide_to,
    options: draft.options.length,
    reason: chose === undefined ? "member" : "solver",
    items: [
      {
        style: draft.style,
        points: numbers,
        vignette: draft.vignette,
        question: draft.question,
        options: draft.options,
        answer: key.answer,
        form: draft.form,
        prompts: draft.layout?.kind === "match" ? draft.layout.prompts : undefined,
        takeaway: key.takeaway,
        chose: chose && chose.choice >= 0 ? chose.choice : null,
        ambiguous: chose ? chose.ambiguous : false,
      },
    ],
    note: chose === undefined ? note : undefined,
    blocks: c.part.blocks,
    figures: c.part.figures,
    labelled: c.part.labelled,
    extras: { styles: [draft.style], difficulty: c.mode.difficulty, points: c.points, focus: c.mode.focus },
  });
  return c.mode.memberStyle ? `${styleExampleBlock(c.mode.memberStyle)}\n\n${request}` : request;
}

/** The reword's calls: one question written again, checked, saved as the
 *  draft's new version, solved; a version the solver got wrong is written
 *  again once (with the solver's answer, if time allows) and solved again,
 *  and rejected if it still fails. The draft's claim is released when
 *  nothing replaced it. */
async function rewordDraft(o: {
  client: Anthropic;
  sb: SupabaseClient;
  lecture: Lecture;
  draft: DraftRow;
  key: KeyRow;
  note: string;
  ctx: RewordCtx;
  reserved: number;
  stopAt: number;
  write: (line: string) => void;
}): Promise<{ made: number; rejected: number; solverRejected: number; costUsd: number; unsettled: number }> {
  const out = { made: 0, rejected: 0, solverRejected: 0, costUsd: 0, unsettled: 0 };
  const system = questionsSystem(o.lecture, null);
  const lectureSlides = new Set(o.lecture.slides.map((s) => s.n));
  const lectureText = deckText(o.lecture).toLowerCase();
  const figures = new Set(o.ctx.part.figures.map((f) => f.id));
  const effort = o.ctx.mode.difficulty === "easy" ? "medium" : "high";
  const pointIds = o.ctx.points.map((p) => p.id);
  const ledgerFor = (rid: number) => async (s: { costUsd: number } & Parameters<ReturnType<typeof settleFor>>[0]) => {
    out.costUsd += s.costUsd;
    return settleFor(o.sb, rid, () => (out.unsettled += 1))(s);
  };

  /** One generation call of one question; the checked item, or null. */
  const writeOne = async (user: string, rid: number, onStart?: () => void): Promise<{ item: SaveItem; servedBy: string } | null> => {
    let got: { item: SaveItem; servedBy: string } | null = null;
    const res = await generateItems({
      client: o.client,
      kind: "reword",
      ref: o.draft.id,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
      effort,
      maxTokens: maxTokensFor(1),
      stopAt: o.stopAt,
      wrapper: QuestionSet,
      item: QuestionIn,
      onStart,
      onItem: (q, _i, servedBy) => {
        if (got) return;
        const r = checkQuestion(q, {
          optionCount: o.draft.options.length,
          lectureSlides,
          from: o.ctx.claim.slide_from,
          to: o.ctx.claim.slide_to,
          known: o.ctx.known,
          blocks: o.ctx.part.blocks,
          figures,
          lectureText,
          styles: [o.draft.style],
          points: o.ctx.points,
          ...typesCtx(o.lecture, o.ctx.part),
          // A label is written again in the mode it had.
          labelIndex: o.draft.form === "tap" ? 1 : 0,
        });
        if (!r.ok) {
          out.rejected += 1;
          o.write(JSON.stringify({ t: "skip", why: r.reasons[0] } satisfies WriteLine) + "\n");
          return;
        }
        got = { item: r.item, servedBy };
      },
      ledger: ledgerFor(rid),
    });
    if (!got && res.stop === "refusal") throw new HttpError(502, "refusal");
    if (!got && res.timedOut) throw new HttpError(504, "timeout");
    return got;
  };

  const replace = async (oldId: string, got: { item: SaveItem; servedBy: string }, auto: boolean, rewrites: number): Promise<string | null> => {
    const points = got.item.points.map((n) => pointIds[n - 1]).filter(Boolean);
    const { data, error } = await o.sb.rpc("study_draft_replace", keyed({ p_draft: oldId, p_q: { ...got.item, model: got.servedBy, points }, p_auto: auto }));
    if (error || typeof data !== "string") {
      if (error) console.error(`study_draft_replace ${oldId}: ${error.message}`);
      out.rejected += 1;
      return null;
    }
    const line = toDraftPublic(
      { id: data, requestId: o.draft.request_id, batchId: o.draft.batch_id!, partIdx: o.draft.part_idx, style: o.draft.style, points, rewrites, replaces: oldId },
      got.item,
    );
    o.write(JSON.stringify({ ...line, replaces: oldId } satisfies WriteLine) + "\n");
    return data;
  };

  const captions = new Map(o.ctx.part.figures.map((f) => [f.id, f.caption]));
  const solveOne = async (id: string, item: SaveItem): Promise<{ v: Verdict | null; state: string }> => {
    // A label item is keyed by the picture's geometry: saved "ok", never solved.
    if (solverFree(item)) {
      o.write(JSON.stringify({ t: "check", id, state: "ok" } satisfies WriteLine) + "\n");
      return { v: null, state: "ok" };
    }
    let v: Verdict | null = null;
    if (o.stopAt - Date.now() >= SOLVER_MIN_MS) {
      const items = [solverItemOf(item, captions)];
      try {
        const rid = await reserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "solver", ref: id, estimateUsd: solverEstimate(o.lecture, items) });
        const res = await solveQuestions({ client: o.client, lecture: o.lecture, items, ref: id, stopAt: o.stopAt, ledger: ledgerFor(rid) });
        v = res.verdicts[0] ?? null;
      } catch (e) {
        console.error(`solver ${id}: ${errorText(e)}`);
      }
    }
    const call = checkCall(id, item, v);
    const { data, error } = await o.sb.rpc(call.fn, keyed(call.args));
    // Removed or kept by a member while the solver read it: nothing more to do.
    if (error && DRAFT_GONE.has(error.message)) return { v, state: "gone" };
    const state = error || typeof data !== "string" ? (v ? (v.ok ? "ok" : "failed") : "unchecked") : data;
    o.write(JSON.stringify({ t: "check", id, state: state as "ok" | "failed" | "unchecked" } satisfies WriteLine) + "\n");
    return { v, state };
  };

  let replaced = false;
  try {
    const first = await writeOne(rewordUser(o.ctx, o.draft, o.key, o.note), o.reserved, () => o.write('{"t":"start"}\n'));
    if (!first) return out;
    const id = await replace(o.draft.id, first, false, o.key.rewrites + 1);
    if (!id) return out;
    replaced = true;
    out.made = 1;
    const check = await solveOne(id, first.item);
    if (check.state !== "failed") return out;
    // The solver got the new version wrong: once more, with its answer, if time
    // allows and the draft's history still allows an automatic rewrite (the
    // database's rule: else the paid call would be refused as 'rewrite limit').
    let again: { item: SaveItem; servedBy: string } | null = null;
    let againId: string | null = null;
    if (o.key.rewrites + 1 < AUTO_REWRITE_LIMIT && o.stopAt - Date.now() >= REWRITE_MIN_MS) {
      const asDraft = {
        style: o.draft.style,
        points: first.item.points.map((n) => pointIds[n - 1]).filter(Boolean),
        vignette: first.item.vignette,
        question: first.item.question,
        options: first.item.options,
        form: first.item.form,
        layout: first.item.layout?.kind === "match" ? { kind: "match", prompts: first.item.layout.prompts } : null,
      };
      const user = rewordUser(o.ctx, asDraft, { ...o.key, answer: first.item.answer, takeaway: first.item.takeaway }, "", check.v ?? { choice: -1, ambiguous: true, ok: false });
      try {
        const rid = await reserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "reword", ref: id, estimateUsd: estimateUsd(MODEL, system.reduce((n, b) => n + b.text.length, 0) + user.length, maxTokensFor(1)) });
        again = await writeOne(user, rid);
      } catch (e) {
        console.error(`reword rewrite ${id}: ${errorText(e)}`);
      }
      if (again) againId = await replace(id, again, true, o.key.rewrites + 2);
    }
    // Written again and still wrong: rejected. Not written again (no time, the
    // history's limit, a refused reservation, a rewrite that failed its
    // checks): the version stays, marked failed, for a member to reword again
    // or remove.
    if (again && againId) {
      const second = await solveOne(againId, again.item);
      if (second.state === "failed") await reject(againId);
    }
    return out;
  } finally {
    if (!replaced) await releaseDraft(o.sb, o.draft.id);
  }

  async function reject(id: string): Promise<void> {
    const { error } = await o.sb.rpc("study_draft_reject", keyed({ p_draft: id }));
    if (error) {
      console.error(`study_draft_reject ${id}: ${error.message}`);
      return;
    }
    out.made = 0;
    out.solverRejected += 1;
    o.write(JSON.stringify({ t: "drop", id } satisfies WriteLine) + "\n");
  }
}

/** The actions of op "questions" besides writing a batch (ops/practice.ts routes them). */
export const PRACTICE2_ACTIONS: Record<string, Op> = {
  points: pointsAction,
  plan: planAction,
  create: createAction,
  style: styleAction,
  reword: rewordAction,
};
