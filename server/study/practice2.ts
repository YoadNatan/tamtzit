import type Anthropic from "@anthropic-ai/sdk";
import { getDeadline, waitUntil } from "@vercel/functions"; // 3.10.5, pinned
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";
import {
  type AlreadyMaking,
  type CreateAnswer,
  type CreatePhase,
  EXPECTED_USD,
  expectedQuestionUsd,
  levelCounts,
  type MakingSet,
  type Options,
  planRequest,
  type PlanAnswer,
  type PlanInputs,
  type PlanPoint,
  type PointsLine,
  pointsUsd,
  type PointsPart,
  plannedStyles,
  readOptions,
  type RecentSet,
  SET_TITLE_MAX,
  SET_WANT_MAX,
  type SetBody,
  requestUsd,
  ROUND_MAX_LECTURES,
  ROUND_MIN_PER_LECTURE,
  solverUsd,
  styleCounts,
  type Style,
  type StyleAnswer,
  type WriteLine,
} from "../../shared/study/practice2.js";
import { addFacts, defaultStylesFor, emptyFacts, isNewStyle, type PartFacts } from "../../shared/study/forms.js";
import { estimateUsd, imageTokens, monthlyCap, POLICY, reserve, SETS_DAILY, setsMonthlyCap } from "./budget.js";
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
  type Picture,
  pictureBlocks,
  PICTURES_MAX,
  picturesTokens,
  questionsSystem,
  readPart,
  signPictures,
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
  assertSchema,
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
  QUICK_TOKEN_SECONDS,
  schemaHas,
  serverKey,
  textStream,
  tidyMarkdown,
} from "./study.js";
import { fallbackReserve, modelFor } from "./routes.js";

/* ── Practice 2.0: op "questions"'s actions besides writing a batch ──
 * (docs/study/proposal/practice-2/DECISIONS.md; the API in docs/study/practice-2-api.md)
 *
 *   { op: "questions", action: "points", lectureId }           reads the lecture's points to know (paid once for the group)
 *   { op: "questions", action: "plan", lectureId, options?, inputs? }   what the setup screen shows: points, counts,
 *                                                               estimates; with inputs, "סט חדש"'s planning inputs (free)
 *   { op: "questions", action: "create", lectureId, options }  a request and its batches (free; the batches are then
 *                                                               written one by one: { op: "questions", lectureId, batchId })
 *   { op: "questions", action: "create", lectureId, options, set, force? }   the same as a practice set (section L 1):
 *                                                               begun, read first when needed, then its request
 *   { op: "questions", action: "style", lectureId, text?, image?, setId? }  an example read back as the style (paid,
 *                                                               small); with setId its signature is kept on the set
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
  let model: string;
  try {
    [{ parts, old }, model] = await Promise.all([claimedParts(sb, lectureId, claim), modelFor(sb, lecture.group_id, "points")]);
    const first = pointPieces(parts)[0];
    reserved = await reserve(sb, { groupId: lecture.group_id, lectureId, kind: "points", ref: POINTS_READ_REF, estimateUsd: pieceEstimate(first, model) });
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
    const res = await readPoints({ client, sb, lecture, parts, old, stopAt, write, reserved, model });
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

/** The lecture's bank as planning sees it (fresh first, practice sets D5):
 *  the point ids its active questions test (not retired, not hidden by two
 *  flags), and how many questions are active (the 150 cap counts the
 *  retired_at is null ones, hidden or not). A point read again has a new
 *  id, so a re-read part counts as uncovered. */
export async function bankCoverage(sb: SupabaseClient, lectureId: string): Promise<{ covered: Set<string>; active: number }> {
  const { data, error } = await sb.from("study_questions").select("points, hidden_at").eq("lecture_id", lectureId).is("retired_at", null);
  if (error) throw new HttpError(500, error.message);
  const rows = (data ?? []) as Array<{ points: string[] | null; hidden_at: string | null }>;
  const covered = new Set<string>();
  for (const r of rows) if (!r.hidden_at) for (const id of r.points ?? []) covered.add(id);
  return { covered, active: rows.length };
}

/** Whole cents left to a line, never below 0. */
const room = (line: number, spent: number) => Math.max(0, Math.floor((line - spent) * 100 + 1e-9) / 100);

/** "סט חדש"'s planning inputs (PlanInputs; docs/study/sets.md): the points
 *  and their coverage, the bank's size, what the member can solve for free,
 *  the headroom to the 80% line and the member's 40% share, and the prices;
 *  with section L 1, the open and recent sets on the lecture, the headroom
 *  to the sets line and the day's sets left. A figure that cannot be read
 *  is null: the screen decides without it. */
async function planInputs(
  sb: SupabaseClient,
  o: {
    lecture: Lecture;
    points: PlanPoint[];
    covered: ReadonlySet<string>;
    active: number;
    groupUsd: number | null;
    mineUsd: number | null;
    readUsd: number;
  },
): Promise<PlanInputs> {
  const lectureId = o.lecture.id;
  const groupId = o.lecture.group_id;
  const [overview, sets, writeModel] = await Promise.all([
    sb.rpc("study_practice_overview", { p_group: groupId }),
    // Section L 1 (practice sets): without it, no open or recent sets and no sets line.
    schemaHas(sb, { L: 1 }).then((has) =>
      has
        ? Promise.all([
            sb.rpc("study_lecture_making", { p_lecture: lectureId }),
            sb.rpc("study_qsets_shelf", { p_group: groupId, p_lecture: lectureId, p_limit: 40 }),
            sb.rpc("study_qset_room", { p_group: groupId }),
          ])
        : null,
    ),
    // A set's batches reserve at set_write's routed model: its price is shown at that model too.
    modelFor(sb, groupId, "set_write"),
  ]);
  const row = overview.error
    ? null
    : ((overview.data ?? []) as Array<{ lecture_id: string | null; questions: number; answered: number }>).find((r) => r.lecture_id === lectureId);
  const free = overview.error ? null : row ? Math.max(0, Number(row.questions) - Number(row.answered)) : 0;
  let making: MakingSet[] | null = null;
  let recent: RecentSet[] | null = null;
  let line: number | null = null;
  let dailyLeft: number | null = null;
  if (sets) {
    const [mk, shelf, roomRes] = sets;
    if (!mk.error)
      making = ((mk.data ?? []) as MakingSet[]).map((m) => ({
        set_id: m.set_id,
        author_name: m.author_name ?? "",
        made: Number(m.made),
        want: Number(m.want),
        state: m.state,
        updated_at: m.updated_at,
      }));
    if (!shelf.error) {
      const since = Date.now() - 7 * 86_400_000;
      recent = ((shelf.data ?? []) as Array<RecentSet & { is_hidden?: boolean }>)
        .filter((x) => !x.is_hidden && Date.parse(x.created_at) >= since)
        .map((x) => ({ id: x.id, title: x.title, author_name: x.author_name ?? "", created_at: x.created_at, size: Number(x.size), want: Number(x.want), state: x.state }));
    }
    const r = roomOf(roomRes);
    if (r) {
      line = room(setsMonthlyCap(), r.setsUsd);
      dailyLeft = Math.max(0, SETS_DAILY - r.today);
    }
  }
  const cap = monthlyCap();
  return {
    points: o.points.map((p) => ({ id: p.id, part_idx: Number(p.part_idx), n: Number(p.n), kind: p.kind, red_flag: !!p.red_flag, weight: p.weight })),
    covered: o.points.filter((p) => o.covered.has(p.id)).map((p) => p.id),
    active: o.active,
    free,
    making,
    recent,
    headroom: {
      group80: o.groupUsd === null ? null : room(cap * POLICY.practice.share, o.groupUsd),
      member40: o.mineUsd === null ? null : room(cap * (POLICY.practice.memberShare ?? 0), o.mineUsd),
      line,
    },
    dailyLeft,
    perQuestionUsd: expectedQuestionUsd(writeModel),
    readUsd: o.readUsd,
    styleUsd: EXPECTED_USD.style,
  };
}

/** study_qset_room's row (the sets line's spend this month and the sets the
 *  member began today), or null when it could not be read. */
function roomOf(res: { data: unknown; error: unknown }): { setsUsd: number; today: number } | null {
  if (res.error) return null;
  const r = (Array.isArray(res.data) ? res.data[0] : res.data) as { sets_usd?: unknown; today?: unknown } | null | undefined;
  const setsUsd = Number(r?.sets_usd);
  const today = Number(r?.today);
  return r && Number.isFinite(setsUsd) && Number.isFinite(today) ? { setsUsd, today } : null;
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
    for (const sl of slidesOf(lecture)) {
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

/** The lecture's slides as objects: a row whose slides are not an array (or
 *  hold a null) plans with what there is instead of a TypeError (a 500). */
const slidesOf = (lecture: Pick<Lecture, "slides">): Lecture["slides"] =>
  (Array.isArray(lecture.slides) ? lecture.slides : []).filter((s) => s !== null && typeof s === "object");

/** The parts whose slides show a table (a blank table needs one). A slide
 *  saved without `tables` has none. */
export function tableParts(lecture: Pick<Lecture, "slides">, parts: ReadonlyArray<Pick<StateRow, "part_idx" | "slide_from" | "slide_to">>): Set<number> {
  const tables = new Set(slidesOf(lecture).filter((s) => Array.isArray(s.tables) && s.tables.length > 0).map((s) => s.n));
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

/** { lectureId, options?, inputs? }: the parts with their points
 *  (study_points_state), which are stale, the three levels' counts and the
 *  plan of these options (fresh first: the bank's coverage), the estimates
 *  (reading the points when any is stale, the questions, a reword, reading
 *  an example) and the month's spend; with `inputs: true`, "סט חדש"'s
 *  planning inputs (planInputs). No model, no spend. */
export const planAction: Op = async (req, body) => {
  const lectureId = lectureIdOf(body);
  const options = optionsOf(body.options);
  // No model call and about a second of reads: a token near its end still serves.
  const { sb } = await memberClient(req, { minSeconds: QUICK_TOKEN_SECONDS });
  const lecture = await loadLecture(sb, lectureId);
  const [state, points, sections, spent, mine, bank, writeModel] = await Promise.all([
    pointsState(sb, lectureId),
    planPoints(sb, lectureId),
    sb.from("study_sections").select("idx, markdown").eq("lecture_id", lectureId),
    sb.rpc("study_spent", { p_group: lecture.group_id }),
    sb.rpc("study_my_spent", { p_group: lecture.group_id }),
    bankCoverage(sb, lectureId),
    // The price at the model the batches will reserve at (sets are the screen's flow: set_write).
    modelFor(sb, lecture.group_id, "set_write"),
  ]);
  if (sections.error) throw new HttpError(500, sections.error.message);
  const stale = state.filter((s) => s.summary === "ready" && !s.current).map((s) => s.part_idx);
  const chars = ((sections.data ?? []) as Array<{ idx: number; markdown: string }>)
    .filter((s) => stale.includes(s.idx))
    .reduce((n, s) => n + (s.markdown ?? "").length, 0);
  const parts = chosenParts(state, options);
  const facts = partFacts(lecture, state, (sections.data ?? []) as Array<{ idx: number; markdown: string | null }>, points);
  const plan = planRequest({ points, level: options.level, count: options.count, parts, styles: options.styles, partFacts: facts, covered: bank.covered });
  const levels = levelCounts(points, parts);
  const readUsd = stale.length ? pointsUsd(chars, stale.length) : 0;
  const planned = plannedStyles(plan);
  const groupUsd = spent.error ? null : Number(spent.data);
  const mineUsd = mine.error ? null : Number(mine.data);
  const answer: PlanAnswer = {
    lecture: { slides: slidesOf(lecture).length },
    parts: state,
    points: {
      total: state.reduce((n, s) => n + s.points, 0),
      current: stale.length === 0 && state.some((s) => s.summary === "ready"),
      stale,
      busy: state.some((s) => s.busy),
    },
    levels,
    plan: { level: options.level, total: plan.total, parts: plan.parts, batches: plan.batches.length, styles: styleCounts(plan) },
    // Question types: what each part offers, and the types checked first for the chosen parts.
    facts: Object.fromEntries([...facts].map(([k, v]) => [String(k), v])),
    defaults: defaultStylesFor(factsOf(facts, parts)) as Style[],
    estimate: {
      readUsd,
      // Weighted by the planned types (a label item half, a staged case 2.5).
      questionsUsd: requestUsd(planned, writeModel),
      // The blind solver's part of questionsUsd, shown apart ("כל שאלה נבדקת בידי פותר עיוור").
      solverUsd: solverUsd(planned),
      totalUsd: Math.round((readUsd + requestUsd(planned, writeModel)) * 100) / 100,
      perQuestionUsd: expectedQuestionUsd(writeModel),
      levels: { focused: requestUsd(levels.focused, writeModel), full: requestUsd(levels.full, writeModel), deep: requestUsd(levels.deep, writeModel) },
      rewordUsd: EXPECTED_USD.reword,
      styleUsd: EXPECTED_USD.style,
    },
    spent: {
      groupUsd,
      mineUsd,
      capUsd: monthlyCap(),
      share: POLICY.practice.share,
      memberShare: POLICY.practice.memberShare,
    },
  };
  if (body.inputs === true) answer.inputs = await planInputs(sb, { lecture, points, covered: bank.covered, active: bank.active, groupUsd, mineUsd, readUsd });
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

/** study_request_plan's refusals, as HTTP statuses. */
const ROUND_STATUS: Record<string, number> = {
  "round full": 409,
  "too few questions": 400,
  "bad plan": 400,
  "request not found": 404,
  forbidden: 403,
  "not signed in": 401,
};

/** The body's planId: absent or null is a lecture's own request; anything
 *  but an id is 400 "bad plan". */
function planIdOf(body: Record<string, unknown>): string | null {
  if (body.planId === undefined || body.planId === null) return null;
  const id = idOf(body.planId);
  if (!id) throw new HttpError(400, "bad plan");
  return id;
}

/** study_qset_begin's and study_qset_attach's refusals, and the set's own
 *  budget lines, as HTTP statuses: every budget line is 402 (the create
 *  screen's words for each, docs/study/sets.md). */
const SET_STATUS: Record<string, number> = {
  daily_limit: 402,
  sets_line: 402,
  too_big: 402,
  reserve: 402,
  member_share: 402,
  off: 402,
  "set not found": 404,
  "set has a request": 409,
  "set not reading": 409,
};

/** The body's set: absent is a request as before (D12: no set, nothing of
 *  section L); anything malformed is 400 "bad set". */
function setBodyOf(raw: unknown): SetBody | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "bad set");
  const o = raw as Record<string, unknown>;
  const want = o.want;
  if (typeof want !== "number" || !Number.isInteger(want) || want < 1 || want > SET_WANT_MAX) throw new HttpError(400, "bad set");
  if (o.title !== undefined && o.title !== null && typeof o.title !== "string") throw new HttpError(400, "bad set");
  const title = typeof o.title === "string" ? o.title.replace(/\s+/g, " ").trim() : "";
  if (title.length > SET_TITLE_MAX) throw new HttpError(400, "bad set");
  if (o.phase !== undefined && o.phase !== null && o.phase !== "style" && o.phase !== "read") throw new HttpError(400, "bad set");
  const id = o.id === undefined || o.id === null ? null : idOf(o.id);
  if (o.id !== undefined && o.id !== null && !id) throw new HttpError(400, "bad set");
  const phase = o.phase === "style" || o.phase === "read" ? o.phase : null;
  return { want, ...(title ? { title } : {}), ...(phase ? { phase } : {}), ...(id ? { id } : {}) };
}

/** A set's default title (design §8.3): "{lecture} · {n} שאלות", the
 *  lecture's title cut to fit 80 characters. */
export function setTitle(lectureTitle: string, n: number): string {
  const tail = ` · ${n} שאלות`;
  const head = lectureTitle.replace(/\s+/g, " ").trim();
  return (head.length + tail.length <= SET_TITLE_MAX ? head : `${head.slice(0, SET_TITLE_MAX - tail.length - 1).trimEnd()}…`) + tail;
}

/** Before a set begins: each line it would cross, first reason first (the
 *  create screen's order), then whether what is left holds the set's
 *  expected cost plus $1.00 (402 too_big). The day's sets are read here too,
 *  so a member at the limit hears that and not "too big"; study_qset_begin
 *  checks the day and the sets line again under its lock. A figure that
 *  cannot be read checks nothing. */
async function setHeadroom(sb: SupabaseClient, groupId: string, expectedUsd: number, daily = true): Promise<void> {
  const [spent, mine, roomRes] = await Promise.all([
    sb.rpc("study_spent", { p_group: groupId }),
    sb.rpc("study_my_spent", { p_group: groupId }),
    sb.rpc("study_qset_room", { p_group: groupId }),
  ]);
  const cap = monthlyCap();
  const r = roomOf(roomRes);
  const group80 = spent.error ? null : room(cap * POLICY.practice.share, Number(spent.data));
  const member40 = mine.error ? null : room(cap * (POLICY.practice.memberShare ?? 0), Number(mine.data));
  const line = r ? room(setsMonthlyCap(), r.setsUsd) : null;
  if (group80 !== null && group80 <= 0) throw new HttpError(402, "reserve");
  if (member40 !== null && member40 <= 0) throw new HttpError(402, "member_share");
  if (line !== null && line <= 0) throw new HttpError(402, "sets_line");
  if (daily && r && r.today >= SETS_DAILY) throw new HttpError(402, "daily_limit");
  const known = [group80, member40, line].filter((x): x is number => x !== null);
  if (known.length && Math.min(...known) < expectedUsd + SET_MARGIN_USD) throw new HttpError(402, "too_big");
}
/** What must stay free beyond a set's expected cost when it begins (design §8.3). */
export const SET_MARGIN_USD = 1;

/** A set's reading phase lasts at most this long (the points' lease and a
 *  style read fit in it); a later second call is 409 "set not reading". */
export const SET_READING_MS = 10 * 60_000;

/** The set a second call continues (after its reading phase): the member's
 *  group's, on this lecture, still reading and begun (or last moved) in the
 *  last 10 minutes (else 409 "set not reading"); a style other than the one
 *  its phase signed is 400 "bad style". Answers what the set wants: the
 *  request may not plan more (the size checked when it began).
 *  study_qset_attach checks the author again. */
async function setToContinue(sb: SupabaseClient, setId: string, lectureId: string, options: Options, now = Date.now()): Promise<number> {
  const { data, error } = await sb.from("study_qsets").select("id, lecture_id, state, want, updated_at, options").eq("id", setId);
  if (error) throw new HttpError(500, error.message);
  const row = (
    (data ?? []) as Array<{ id: string; lecture_id: string | null; state: string; want?: number; updated_at?: string; options: { style_sig?: string } | null }>
  )[0];
  if (!row) throw new HttpError(404, "set not found");
  if (row.lecture_id !== lectureId) throw new HttpError(400, "bad set");
  const moved = row.updated_at ? Date.parse(row.updated_at) : NaN;
  if (row.state !== "reading" || !(now - moved <= SET_READING_MS)) throw new HttpError(409, "set not reading");
  const kept = row.options?.style_sig;
  if (kept && options.style && options.style.sig.toLowerCase() !== kept) throw new HttpError(400, "bad style");
  return Math.max(1, Math.min(SET_WANT_MAX, Number(row.want) || SET_WANT_MAX));
}

/** Any "create" without a set once section L 1 is installed (the old
 *  generator screens, kept one release, OD22, and rounds over several
 *  lectures): the sets line (OD12) holds there too, since it counts the same
 *  kinds (practice, solver, reword, style). One read; a figure that cannot
 *  be read checks nothing. */
async function lineHolds(sb: SupabaseClient, groupId: string): Promise<void> {
  if (!(await schemaHas(sb, { L: 1 }))) return;
  const r = roomOf(await sb.rpc("study_qset_room", { p_group: groupId }));
  if (r && room(setsMonthlyCap(), r.setsUsd) <= 0) throw new HttpError(402, "sets_line");
}

/** { lectureId, options, set?, force? }: checks the options (400), the
 *  style's signature (400 "bad style"), that every chosen part is written
 *  (409 "summary not ready") and its points current (409 "points stale":
 *  action "points" reads them first), plans the request from the points,
 *  fresh first (planRequest with the bank's coverage), and saves it with its
 *  batches (study_request_create). The batches are then written one by one.
 *
 *  With `set` (practice sets, section L 1; without it nothing of L is
 *  called, D12): the lines a set may not cross (402 reserve, member_share,
 *  sets_line, daily_limit, too_big), then study_qset_begin (409 "already
 *  making" with the open set unless `force`; 402 off). When the points are
 *  stale or an example is to be read, it answers { set, phase } and the
 *  phone reads them on the generating screen, then calls again with
 *  `set.id`. Otherwise (or on that second call) the request is made through
 *  study_qset_attach; a refusal there abandons the set and keeps Q's code. */
export const createAction: Op = async (req, body) => {
  const lectureId = lectureIdOf(body);
  let options = optionsOf(body.options);
  const planId = planIdOf(body);
  const set = setBodyOf(body.set);
  // Sets over several lectures are course sets (WP20, not in v1).
  if (set && planId) throw new HttpError(400, "bad set");
  // No model call: reads and one RPC. Each batch's write checks its own token.
  const { sb } = await memberClient(req, { minSeconds: QUICK_TOKEN_SECONDS });
  const key = serverKey();
  // A round over several lectures writes plan_id (section S at 1).
  if (planId) await assertSchema(sb, "questions_plan");
  // A set needs section L 1.
  if (set && !(await schemaHas(sb, { L: 1 }))) throw new HttpError(503, "schema");
  const lecture = await loadLecture(sb, lectureId);
  if (options.style && !(await verifyStyle(key, lectureId, options.style))) throw new HttpError(400, "bad style");
  await needTypes(sb, options.styles);
  // A second call continues its set (still reading, at most its size).
  const continued = set?.id ? await setToContinue(sb, set.id, lectureId, options) : null;
  if (continued !== null && options.count !== undefined) options = { ...options, count: Math.min(options.count, continued) };
  // Without a set, the sets line still holds (once L 1 is installed).
  if (!set) await lineHolds(sb, lecture.group_id);
  const [state, points, sections, bank] = await Promise.all([
    pointsState(sb, lectureId),
    planPoints(sb, lectureId),
    sb.from("study_sections").select("idx, markdown").eq("lecture_id", lectureId),
    bankCoverage(sb, lectureId),
  ]);
  if (sections.error) throw new HttpError(500, sections.error.message);
  const parts = chosenParts(state, options);
  const chosen = state.filter((s) => parts.includes(s.part_idx));
  // A part still being written has no points yet; one whose text changed is read again first.
  if (chosen.some((s) => s.summary !== "ready")) throw new HttpError(409, "summary not ready");
  const stale = chosen.filter((s) => !s.current).map((s) => s.part_idx);
  // A set begun now reads them as its first phase only when the phone asks
  // for that (set.phase "read"); anything else needs them current, so a part
  // gone stale after "plan" is 409 and the screen reads it first (MakeJob).
  const phaseRead = stale.length > 0 && set !== null && !set.id && set.phase === "read";
  if (stale.length && !phaseRead) throw new HttpError(409, "points stale");
  const facts = partFacts(lecture, state, (sections.data ?? []) as Array<{ idx: number; markdown: string | null }>, points);
  // Fresh first, as plan showed it (practice sets D5).
  const plan = planRequest({ points, level: options.level, count: options.count, parts, styles: options.styles, partFacts: facts, covered: bank.covered });
  if (plan.total === 0 && !phaseRead) throw new HttpError(400, "no points");
  if (continued !== null && plan.total > continued) throw new HttpError(400, "bad set");
  const used = plan.parts.filter((p) => p.questions > 0).map((p) => p.part_idx);
  // The batches reserve at their key's routed model: the headroom checks and the price use it too.
  const writeModel = await modelFor(sb, lecture.group_id, set ? "set_write" : "practice");
  if (planId) {
    // Checked first, to answer at once; study_request_create_in_plan checks
    // again under the round's lock, and a refusal there undoes the request.
    if (plan.total < ROUND_MIN_PER_LECTURE) throw new HttpError(400, "too few questions");
    const others = await sb.from("study_question_requests").select("lecture_id").eq("plan_id", planId);
    if (others.error) throw new HttpError(500, others.error.message);
    const lectures = new Set(((others.data ?? []) as Array<{ lecture_id: string }>).map((r) => r.lecture_id).filter((l) => l !== lectureId));
    if (lectures.size >= ROUND_MAX_LECTURES) throw new HttpError(409, "round full");
  }
  const request = {
    level: options.level,
    count: plan.total,
    parts: used,
    styles: options.styles,
    difficulty: options.difficulty,
    style_note: options.style?.description ?? "",
    style_example: options.style?.example ?? "",
    focus: options.focus,
  };
  let setId: string | null = null;
  if (set?.id) {
    // The lines again with the real plan (the day's count already has this set).
    await setHeadroom(sb, lecture.group_id, requestUsd(plannedStyles(plan), writeModel), false);
    setId = set.id;
  } else if (set) {
    const phase: CreatePhase["phase"] | null = phaseRead ? "read" : set.phase === "style" ? "style" : null;
    const chars = ((sections.data ?? []) as Array<{ idx: number; markdown: string }>)
      .filter((x) => stale.includes(x.idx))
      .reduce((n, x) => n + (x.markdown ?? "").length, 0);
    const questionsUsd = plan.total > 0 ? requestUsd(plannedStyles(plan), writeModel) : set.want * expectedQuestionUsd(writeModel);
    const expected = questionsUsd + (stale.length ? pointsUsd(chars, stale.length) : 0) + (phase === "style" ? EXPECTED_USD.style : 0);
    await setHeadroom(sb, lecture.group_id, expected);
    // Never the member's points or a focus (design §7.1): the set page shows these again.
    const setRow = {
      title: set.title || setTitle(lecture.title, set.want),
      want: set.want,
      options: { level: options.level, difficulty: options.difficulty, types: options.styles, parts },
    };
    const begun = await sb.rpc(
      "study_qset_begin",
      keyed({ p_lecture: lectureId, p_set: setRow, p_phase: phase, p_force: body.force === true, p_daily: SETS_DAILY, p_line: setsMonthlyCap() }),
    );
    if (begun.error) throw new HttpError(SET_STATUS[begun.error.message] ?? CREATE_STATUS[begun.error.message] ?? 500, begun.error.message);
    const b = (begun.data ?? {}) as { set_id?: string; open?: Omit<AlreadyMaking, "error"> };
    if (b.open) {
      const open: AlreadyMaking = {
        error: "already making",
        set_id: b.open.set_id,
        author_name: b.open.author_name ?? null,
        made: Number(b.open.made),
        want: Number(b.open.want),
        state: b.open.state,
        mine: b.open.mine === true,
      };
      return json(409, open);
    }
    if (!b.set_id) throw new HttpError(500, "no set");
    if (phase) return json(200, { set: { id: b.set_id, state: "reading" }, phase } satisfies CreatePhase);
    setId = b.set_id;
  }
  // In a round, the request and its link to the round are one call (one
  // transaction): a link refused there ("round full" when two phones add the
  // 5th and 6th lecture at once) leaves no request or batches behind. A set's
  // request is linked the same way (study_qset_attach).
  const { data, error } = setId
    ? await sb.rpc("study_qset_attach", keyed({ p_set: setId, p_request: request, p_batches: plan.batches }))
    : await sb.rpc(
        planId ? "study_request_create_in_plan" : "study_request_create",
        keyed({ p_lecture: lectureId, ...(planId ? { p_plan: planId } : {}), p_request: request, p_batches: plan.batches }),
      );
  if (error) {
    // Q refused (or the set was not the member's): a set with no request goes.
    if (setId) await sb.rpc("study_qset_abandon", { p_set: setId }).then(() => undefined, () => undefined);
    throw new HttpError(CREATE_STATUS[error.message] ?? ROUND_STATUS[error.message] ?? SET_STATUS[error.message] ?? 500, error.message);
  }
  const rows = (data ?? []) as Array<{ request_id: string; round: number; batch_id: string; part_idx: number; seq: number; wanted: number; lectures?: number }>;
  if (!rows.length) {
    if (setId) await sb.rpc("study_qset_abandon", { p_set: setId }).then(() => undefined, () => undefined);
    throw new HttpError(500, "no request");
  }
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
    estimate: { questionsUsd: requestUsd(plannedStyles(plan), writeModel) },
  };
  if (planId) answer.round = { planId, lectures: Number(rows[0].lectures) };
  if (setId) answer.set = { id: setId, state: "making" };
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
  // A set's reading phase (section L 1): its signature is kept on the set.
  const setId = body.setId === undefined || body.setId === null ? null : idOf(body.setId);
  if (body.setId !== undefined && body.setId !== null && !setId) throw new HttpError(400, "bad set");
  const { sb } = await memberClient(req);
  const client = anthropic();
  const key = serverKey();
  const lecture = await loadLecture(sb, lectureId);
  // Only a set on this lecture (study_qset_style takes only the author's own), before the paid read.
  if (setId) {
    const own = await sb.from("study_qsets").select("id, lecture_id").eq("id", setId);
    const row = ((own.data ?? []) as Array<{ lecture_id: string | null }>)[0];
    if (own.error || !row || row.lecture_id !== lectureId) throw new HttpError(400, "bad set");
  }
  const user: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(example.image ? [{ type: "image" as const, source: { type: "base64" as const, media_type: example.image.media_type, data: example.image.data } }] : []),
    { type: "text", text: styleReadRequest({ text: example.text, image: example.image !== null }) },
  ];
  const chars = STYLE_READ_SYSTEM.length + example.text.length + 200;
  const model = await modelFor(sb, lecture.group_id, "style", { pictures: example.image !== null });
  const rid = await reserve(sb, {
    groupId: lecture.group_id,
    lectureId,
    kind: "style",
    ref: lectureId,
    estimateUsd: estimateUsd(model, chars, STYLE_MAX_TOKENS, example.image ? STYLE_IMAGE_TOKENS : 0),
  });
  let costUsd = 0;
  let unsettled = 0;
  const items: Array<z.infer<typeof StyleRead>> = [];
  const res = await generateItems({
    client,
    model,
    reserveFallback: fallbackReserve(sb, { groupId: lecture.group_id, lectureId, kind: "style", ref: lectureId }, () => (unsettled += 1), (sp) => (costUsd += sp.costUsd)),
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
  // Kept on the set while it reads (study_qset_style), so a second "create"
  // with another style is refused. Never worth failing the paid read over.
  if (setId) await sb.rpc("study_qset_style", keyed({ p_set: setId, p_sig: answer.sig })).then(() => undefined, () => undefined);
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
  let model: string;
  let solverModel: string;
  try {
    [ctx, model, solverModel] = await Promise.all([
      rewordContext(sb, lecture, draft),
      modelFor(sb, lecture.group_id, "reword", { pictures: draft.style === "image" }),
      modelFor(sb, lecture.group_id, "solver"),
    ]);
    const user = rewordUser(ctx, draft, key, note);
    reserved = await reserve(sb, {
      groupId: lecture.group_id,
      lectureId,
      kind: "reword",
      ref: draftId,
      // An image draft is written again looking at up to PICTURES_MAX pictures of the part.
      estimateUsd: estimateUsd(model, questionsSystem(lecture, null).reduce((n, b) => n + b.text.length, 0) + user.length, maxTokensFor(1), draft.style === "image" ? PICTURES_MAX * imageTokens() : 0),
    });
  } catch (e) {
    await releaseDraft(sb, draftId);
    throw e;
  }
  return textStream(async (raw) => {
    const write = safe(raw);
    const res = await rewordDraft({ client, sb, lecture, draft, key, note, ctx, reserved, stopAt: started + TIME_LIMIT_MS, write, model, solverModel });
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
  /** The reword key's model and the solver's (routes.ts; left out: the default). */
  model?: string;
  solverModel?: string;
}): Promise<{ made: number; rejected: number; solverRejected: number; costUsd: number; unsettled: number }> {
  const out = { made: 0, rejected: 0, solverRejected: 0, costUsd: 0, unsettled: 0 };
  const routed = o.model ?? MODEL;
  const solverModel = o.solverModel ?? MODEL;
  const system = questionsSystem(o.lecture, null);
  const lectureSlides = new Set(o.lecture.slides.map((s) => s.n));
  const lectureText = deckText(o.lecture).toLowerCase();
  const figures = new Set(o.ctx.part.figures.map((f) => f.id));
  const effort = o.ctx.mode.difficulty === "easy" ? "medium" : "high";
  const pointIds = o.ctx.points.map((p) => p.id);
  // An image item is written again, and checked, looking at the part's pictures (its own first).
  const own = o.draft.layout && (o.draft.layout as { kind?: string }).kind === "image" ? String((o.draft.layout as { fig?: string }).fig ?? "") : "";
  const pictures =
    o.draft.style === "image" ? await signPictures(o.sb, o.lecture, [...new Set([own, ...o.ctx.part.figures.map((f) => f.id)].filter(Boolean))].slice(0, PICTURES_MAX)) : new Map<string, Picture>();
  const seen = [...pictures.values()];
  const ledgerFor = (rid: number) => async (s: { costUsd: number } & Parameters<ReturnType<typeof settleFor>>[0]) => {
    out.costUsd += s.costUsd;
    return settleFor(o.sb, rid, () => (out.unsettled += 1))(s);
  };

  /** One generation call of one question; the checked item, or null. */
  const writeOne = async (user: string, rid: number, onStart?: () => void): Promise<{ item: SaveItem; servedBy: string } | null> => {
    let got: { item: SaveItem; servedBy: string } | null = null;
    const res = await generateItems({
      client: o.client,
      model: routed,
      reserveFallback: fallbackReserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "reword", ref: o.draft.id }, () => (out.unsettled += 1), (sp) => (out.costUsd += sp.costUsd)),
      kind: "reword",
      ref: o.draft.id,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: user }, ...pictureBlocks(seen)] }],
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

  const solveOne = async (id: string, item: SaveItem): Promise<{ v: Verdict | null; state: string }> => {
    // A label item is keyed by the picture's geometry: saved "ok", never solved.
    if (solverFree(item)) {
      o.write(JSON.stringify({ t: "check", id, state: "ok" } satisfies WriteLine) + "\n");
      return { v: null, state: "ok" };
    }
    let v: Verdict | null = null;
    if (o.stopAt - Date.now() >= SOLVER_MIN_MS) {
      const items = [solverItemOf(item, pictures)];
      try {
        const rid = await reserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "solver", ref: id, estimateUsd: solverEstimate(o.lecture, items, solverModel) });
        const res = await solveQuestions({
          client: o.client,
          lecture: o.lecture,
          items,
          ref: id,
          stopAt: o.stopAt,
          ledger: ledgerFor(rid),
          model: solverModel,
          reserveFallback: fallbackReserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "solver", ref: id }, () => (out.unsettled += 1), (sp) => (out.costUsd += sp.costUsd)),
        });
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
        const rid = await reserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "reword", ref: id, estimateUsd: estimateUsd(routed, system.reduce((n, b) => n + b.text.length, 0) + user.length, maxTokensFor(1), picturesTokens(seen)) });
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
