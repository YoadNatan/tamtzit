import { getDeadline, waitUntil } from "@vercel/functions"; // 3.10.5, pinned
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_MODELS, modelInfo, ROUTE_KEYS, type RouteKey } from "../../../shared/study/models.js";
import { SHEET_READ_PAGES } from "../../../shared/study/sheetPrice.js";
import { monthlyCap } from "../budget.js";
import { run, settleFor, type RunResult, type Spend } from "../claude.js";
import { READ_PAGES, type ExamPage } from "../exams.js";
import {
  checksFor,
  DIFFERS,
  fixCheckFrozen,
  isLabRoute,
  LAB_NAMES,
  labEstimate,
  labRefusal,
  picturePaths,
  readFrozen,
  requestHash,
  runEstimate,
  solverFrozen,
  statusOf,
  thaw,
  type BankItem,
  type DecidedProposal,
  type Frozen,
  type LabRoute,
  type ReadUnit,
  type RefItem,
} from "../lab.js";
import { CHECKED_ROUTES, isRatedRoute } from "../labRated.js";
import { LAB_ANSWER_MS, LAB_CHECKED_ANSWER_MS, LAB_POLL_MS, LAB_RUN_CAP_USD, LAB_SAVE_MS, LAB_SIGN_SECONDS, LAB_SIGN_SECONDS_OTHER, LAB_SOLVER_ITEMS, LAB_SOLVER_MAX } from "../limits.js";
import { resetRoutes, routeRefusal, type ModelsState } from "../routes.js";
import { anthropic, detachedStream, errorText, HttpError, json, keyed, loadLecture, memberClient, serverClient, type Lecture } from "../study.js";
import { citedSlidesText } from "./fixcheck.js";
import { needsCheck, ratedMaterial, runCheck, runJudge, stepModel, stepsEstimate } from "./labRated.js";
import type { AiBody, Op } from "./types.js";

/* ── Op "lab": "השוואת מודלים" on the server (design-models §7.5, D10,
 *    D12, D14, D15; WP5, slice 2: the kinds with an answer key) ──
 *
 *   {op:"lab", action:"run", group, route, models:[ids], source?}  → NDJSON
 *   {op:"lab", action:"resume", run}                                → NDJSON
 *   {op:"lab", action:"retry", run, label}                          → NDJSON
 *   {op:"lab", action:"route", group, route, model|null, note?, confirmExpensive?} → {route, model}
 *   {op:"lab", action:"cancel", run}                                → {cancelled: true}
 *   {op:"lab", action:"price", group, route, source?, models?}       → the material and each model's worst case
 *   {op:"lab", action:"check", run}                                 → NDJSON: the paid checks left pending
 *   {op:"lab", action:"judge", run}                                 → NDJSON: the AI score, once
 * The short kinds members rate (practice, a set's batch, points, cards,
 * "לשאול", a summary part; WP8) read their material in ./labRated.ts; after
 * their answers, the same invocation runs their paid steps (the solver's
 * check of practice questions, the AI score when asked for: `judge: true`).
 *
 * Only the group's owner (its creator, or a lab admin) runs comparisons
 * and sets routes; section Y checks it again in every function.
 *
 * `run`: reads the material with the owner's token (the bank's keys through
 * study_lab_bank), freezes production's request (lab.ts), checks every
 * model (the registry, the provider's key and the group's consent and scope,
 * pictures), estimates the worst case (an unverified price × 1.5) and plans
 * the run (study_lab_plan: the switch, the owner, the run's cap, 3 a day,
 * the month's line of $3.30, the group's 80% line). Then, before the
 * stream, it reads each slot's model (study_lab_slot, the owner's token and
 * the key) and claims it (study_lab_claim, the worker: one claim, one
 * reservation with no user, OD5). A first claim refused is the HTTP status
 * (402, 403, 409); a later one ends its slot with the reason
 * (study_lab_skip). Every claimed slot then runs in one detached invocation
 * (detachedStream + waitUntil: the phone can lock or leave; no request
 * signal reaches the model calls), in parallel, with no server-side or app
 * fallback (D15), its reservation as the settle floor, and a stop 270 s
 * after the function started or 25 s before its deadline. The run's status
 * is read every 10 s: "cancelled" stops the calls. Each answer gets its $0
 * checks (checksFor) and is saved by the worker; the last one closes the run.
 *
 * Blindness (D12): the response never names a model, a label's status, its
 * text, cost or time. Its lines are {t:"run", run, total}, then
 * {t:"progress", ready, total} as answers end (a count only), then
 * {t:"done"}. Everything else the phone reads from study_lab_run, which
 * shows a label's model only after the caller's own reveal.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABELS = ["א", "ב", "ג", "ד"] as const;
const uuidOf = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);

/** A refusal as its HTTP status (the code is the body's `error`, worded by modelsCopy.ts). */
const STATUS: Record<string, number> = {
  off: 403,
  forbidden: 403,
  "not the creator": 403,
  run_cap: 402,
  lab_budget: 402,
  reserve: 402,
  budget: 402,
  member_share: 402,
  daily_runs: 429,
  closed: 409,
  "not waiting": 409,
  expensive: 409,
};
const refusal = (code: string): HttpError => new HttpError(STATUS[code] ?? (code.startsWith("bad ") || code.startsWith("no ") || code.startsWith("not ") || code === "unverified price" ? 400 : 500), code);
const rpcFail = (e: { message: string }): HttpError => refusal(e.message);

/** The owner's gate before anything is read (section Y checks it again). */
async function assertOwner(sb: SupabaseClient, group: string): Promise<void> {
  const { data, error } = await sb.rpc("study_lab_owner", { p_group: group });
  if (error) throw rpcFail(error);
  if (data !== true) throw new HttpError(403, "not the creator");
}

/** study_models as the owner reads it, fresh (never routes.ts's 60 s cache). */
type LabState = ModelsState & { lab?: { run_cap?: number | string } };
async function readModels(sb: SupabaseClient, group: string): Promise<LabState> {
  const { data, error } = await sb.rpc("study_models", { p_group: group });
  if (error) throw rpcFail(error);
  const d = (data ?? {}) as Partial<LabState>;
  return { routes: d.routes ?? {}, providers: d.providers ?? {}, switches: d.switches ?? {}, lab: d.lab };
}

/** The models asked for: 2-4 distinct ids of the registry (its own ids). */
function modelsOf(v: unknown): string[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > 4) throw new HttpError(400, "bad slots");
  const ids = v.map((m) => (typeof m === "string" ? modelInfo(m)?.id : undefined));
  if (ids.some((m) => !m) || new Set(ids).size !== ids.length) throw new HttpError(400, "bad slots");
  return ids as string[];
}

/* ── The material, read with the owner's token ── */

type Material = { frozen: Frozen; lectureId: string | null; title: string; source: Record<string, unknown>; lecture?: Lecture };
const title = (route: LabRoute, what: string) => `${LAB_NAMES[route]} · ${what}`.slice(0, 160);

/** Signs storage paths for a call; a path that cannot be signed is left out. */
export async function signPaths(sb: SupabaseClient, paths: readonly string[], seconds: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  try {
    const { data } = await sb.storage.from("study").createSignedUrls([...paths], seconds);
    for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  } catch {
    /* left out: the call fails as "pictures" */
  }
  return out;
}

async function bankMaterial(sb: SupabaseClient, group: string, source: Record<string, unknown>): Promise<Material> {
  const n = Number.isInteger(source.n) ? Math.min(Math.max(Number(source.n), 2), LAB_SOLVER_MAX) : LAB_SOLVER_ITEMS;
  const { data, error } = await sb.rpc("study_lab_bank", keyed({ p_group: group, p_lecture: uuidOf(source.lecture), p_n: n }));
  if (error) throw rpcFail(error);
  const bank = data as { lecture: string | null; items: BankItem[] } | null;
  if (!bank?.lecture || (bank.items ?? []).length < 2) throw new HttpError(400, "no material");
  const lecture = await loadLecture(sb, bank.lecture);
  if (lecture.group_id !== group) throw new HttpError(403, "forbidden");
  return {
    frozen: solverFrozen(lecture, bank.items),
    lectureId: lecture.id,
    title: title("solver", `${bank.items.length} שאלות מהבנק`),
    source: { lecture: lecture.id, questions: bank.items.map((q) => q.id) },
  };
}

async function proposalMaterial(sb: SupabaseClient, group: string, source: Record<string, unknown>): Promise<Material> {
  let q = sb
    .from("study_edit_proposals")
    .select("id, lecture_id, part_idx, before_text, after_text, source_kind, source_slides, state, decided_at")
    .in("state", ["applied", "withdrawn"])
    .eq("source_kind", "slide");
  const want = uuidOf(source.proposal);
  if (want) q = q.eq("id", want);
  const { data, error } = await q.order("decided_at", { ascending: false, nullsFirst: false }).limit(20);
  if (error) throw new HttpError(500, error.message);
  const lectures = new Map<string, Lecture | null>();
  for (const p of (data ?? []) as Array<DecidedProposal & { source_kind: string }>) {
    const cited = (p.source_slides ?? []).filter((x) => Number.isInteger(x));
    if (!cited.length) continue;
    if (!lectures.has(p.lecture_id)) lectures.set(p.lecture_id, await loadLecture(sb, p.lecture_id).catch(() => null));
    const lecture = lectures.get(p.lecture_id);
    if (!lecture || lecture.group_id !== group) continue;
    const slides = citedSlidesText(lecture, cited);
    if (!slides) continue;
    return {
      frozen: fixCheckFrozen(lecture, { ...p, source_slides: cited }, slides),
      lectureId: lecture.id,
      title: title("fix_check", lecture.title),
      source: { lecture: lecture.id, proposal: p.id },
    };
  }
  throw new HttpError(400, "no material");
}

type ExamRow = { id: string; group_id: string; title: string; key_source: string; kind?: string; lecture_id?: string | null; course?: string };
type PageRow = { n: number; path: string; w: number; h: number; lines: string[] | null; is_key: boolean };
type ItemRow = { exam_no: number | null; no_label: string | null; vignette: string | null; question: string; options: string[]; figure: string | null; figures: string[] | null; page: number | null };

async function readMaterial(sb: SupabaseClient, group: string, route: "exam_read" | "sheet_read", source: Record<string, unknown>): Promise<Material> {
  const sheet = route === "sheet_read";
  let q = sb.from("study_exams").select("id, group_id, title, key_source, kind, lecture_id, course").eq("group_id", group).eq("status", "ready").eq("kind", sheet ? "sheet" : "exam");
  const want = uuidOf(source.exam);
  if (want) q = q.eq("id", want);
  const { data: exams, error } = await q.order("created_at", { ascending: false }).limit(1);
  if (error) throw new HttpError(500, error.message);
  const exam = (exams ?? [])[0] as ExamRow | undefined;
  if (!exam) throw new HttpError(400, "no material");
  const [{ data: pageRows, error: pe }, { data: itemRows, error: ie }] = await Promise.all([
    sb.from("study_exam_pages").select("n, path, w, h, lines, is_key").eq("exam_id", exam.id).order("n"),
    sb.from("study_questions").select("exam_no, no_label, vignette, question, options, figure, figures, page").eq("exam_id", exam.id).is("retired_at", null),
  ]);
  if (pe || ie) throw new HttpError(500, (pe ?? ie)!.message);
  const content = ((pageRows ?? []) as PageRow[]).filter((p) => !p.is_key).sort((a, b) => a.n - b.n);
  const per = sheet ? SHEET_READ_PAGES : READ_PAGES;
  const asked = Array.isArray(source.pages) ? new Set(source.pages.filter((n) => Number.isInteger(n)) as number[]) : null;
  const unit = (asked ? content.filter((p) => asked.has(p.n)) : content).slice(0, per);
  if (!unit.length) throw new HttpError(400, "no material");
  const at = content.indexOf(unit[0]);
  const last = content.indexOf(unit[unit.length - 1]);
  const prevRow = at > 0 ? content[at - 1] : null;
  const nextRow = last + 1 < content.length ? content[last + 1] : null;
  const shown = [...(prevRow ? [prevRow] : []), ...unit, ...(nextRow ? [nextRow] : [])];
  const urls = await signPaths(sb, shown.map((p) => p.path), LAB_SIGN_SECONDS);
  const page = (p: PageRow): ExamPage => ({ n: p.n, path: p.path, w: p.w, h: p.h, lines: p.lines ?? [], url: urls.get(p.path) ?? null });
  const nums = new Set(unit.map((p) => p.n));
  const items = (itemRows ?? []) as ItemRow[];
  const before = items.filter((i) => i.page !== null && i.page < unit[0].n);
  const reference: RefItem[] = items
    .filter((i) => i.page !== null && nums.has(i.page))
    .map((i) => ({
      id: sheet ? (i.no_label ?? String(i.exam_no ?? "")) : String(i.exam_no ?? ""),
      question: `${i.vignette ?? ""} ${i.question}`.trim(),
      options: (i.options ?? []).length,
      figure: sheet ? (i.figures ?? []).length > 0 : (i.figure ?? "").startsWith("pg:"),
      page: i.page,
    }))
    .filter((r) => r.id !== "");
  if (!reference.length) throw new HttpError(400, "no material");
  const u: ReadUnit = {
    exam: { id: exam.id, group_id: exam.group_id, title: exam.title, key_source: exam.key_source, kind: sheet ? "sheet" : "exam", lecture_id: exam.lecture_id ?? null, course: exam.course ?? "" },
    pages: unit.map(page),
    prev: prevRow ? page(prevRow) : null,
    next: nextRow ? page(nextRow) : null,
    seen: before.map((i) => i.exam_no).filter((n): n is number => Number.isInteger(n)),
    seenLabels: before.filter((i) => i.no_label).map((i) => ({ label: i.no_label!, page: i.page })),
    reference,
  };
  const frozen = readFrozen(route, u);
  if (!frozen) throw new HttpError(503, "pictures");
  const range = unit.length > 1 ? `עמודים ${unit[0].n}-${unit[unit.length - 1].n}` : `עמוד ${unit[0].n}`;
  return { frozen, lectureId: exam.lecture_id ?? null, title: title(route, `${exam.title} · ${range}`), source: { exam: exam.id, pages: unit.map((p) => p.n) } };
}

function material(sb: SupabaseClient, group: string, route: LabRoute, source: Record<string, unknown>, forPrice = false): Promise<Material> {
  if (isRatedRoute(route)) return ratedMaterial(sb, group, route, source, forPrice);
  if (route === "solver") return bankMaterial(sb, group, source);
  if (route === "fix_check") return proposalMaterial(sb, group, source);
  return readMaterial(sb, group, route, source);
}

/* ── Slots: read, claimed, run ── */

type Slot = {
  label: string;
  slot: number;
  output: string;
  model: string;
  provider: string;
  status: string;
  tries: number;
  run_status: string;
  request: Frozen | null;
  group: string;
  lecture?: string | null;
  check_status?: string;
  judge_model?: string | null;
};
type Claimed = Slot & { reservation: number; estimate: number; part: "answer" | "retry" };

async function readSlot(sb: SupabaseClient, runId: string, label: string): Promise<Slot> {
  const { data, error } = await sb.rpc("study_lab_slot", keyed({ p_run: runId, p_label: label }));
  if (error) throw rpcFail(error);
  return { ...(data as Omit<Slot, "label">), label };
}

/** Claims a slot (the worker: no user). Returns its reservation, or the refusal's code. */
async function claim(worker: SupabaseClient, runId: string, label: string, part: "answer" | "retry", estimate: number): Promise<number | string> {
  const { data, error } = await worker.rpc("study_lab_claim", keyed({ p_run: runId, p_label: label, p_part: part, p_estimate: estimate, p_cap: monthlyCap() }));
  if (error) return error.message;
  const id = Number(data);
  return Number.isSafeInteger(id) && id > 0 ? id : "no reservation";
}

/** Ends a slot that could not start, with its reason; never fails the caller. */
async function skip(worker: SupabaseClient, runId: string, label: string, reason: string): Promise<void> {
  const { error } = await worker.rpc("study_lab_skip", keyed({ p_run: runId, p_label: label, p_reason: reason.slice(0, 40) }));
  if (error) console.error(`lab skip ${runId}: ${error.message}`);
}

/** Claims the slots that wait (answer) or the one to retry. `strict`: the
 *  first refusal is the request's (the slots left are skipped); otherwise a
 *  refused slot is skipped with its reason and the others go on. */
async function claimAll(
  worker: SupabaseClient,
  runId: string,
  slots: Slot[],
  frozen: Frozen,
  part: "answer" | "retry",
  strict: boolean,
): Promise<Claimed[]> {
  const out: Claimed[] = [];
  for (const [i, s] of slots.entries()) {
    const estimate = labEstimate(frozen, s.model);
    const got = await claim(worker, runId, s.label, part, estimate);
    if (typeof got === "number") {
      out.push({ ...s, reservation: got, estimate, part });
      continue;
    }
    if (got === "not waiting") continue; // a second tab or a double tap claimed it: nothing to pay twice
    if (strict && !out.length) {
      if (part === "answer") for (const rest of slots.slice(i)) await skip(worker, runId, rest.label, got);
      throw refusal(got);
    }
    if (part === "answer") await skip(worker, runId, s.label, got);
  }
  return out;
}

const line = (o: unknown) => JSON.stringify(o) + "\n";

/** What a slot's call left: its status and text (the paid steps after the answers read them). */
type Ended = { slot: Claimed; status: string; text: string };
/** The paid steps after the answers (./labRated.ts), with the same stop and cancel. */
type After = (o: { ended: Ended[]; stopAt: number; signal: AbortSignal }) => Promise<void>;

/** The run's slots in one detached invocation (see the file's head). With
 *  paid steps after them (`after`), the answers stop at 200 s so the steps
 *  have time; the steps stop at 270 s (or 25 s before the deadline). */
function runSlots(o: { sb: SupabaseClient; worker: SupabaseClient; client: Anthropic; runId: string; frozen: Frozen; slots: Claimed[]; total: number; ready: number; started: number; after?: After }): Response {
  const deadline = getDeadline()?.getTime() ?? o.started + 300_000;
  const stepsAt = Math.min(o.started + LAB_ANSWER_MS, deadline - LAB_SAVE_MS);
  const stopAt = o.after ? Math.min(o.started + LAB_CHECKED_ANSWER_MS, stepsAt) : stepsAt;
  return detachedStream(async (write) => {
    let ready = o.ready;
    write(line({ t: "run", run: o.runId, total: o.total }));
    write(line({ t: "progress", ready, total: o.total }));
    const stop = new AbortController();
    let cancelled = false;
    const poll = setInterval(() => {
      void (async () => {
        try {
          const { data } = await o.worker.rpc("study_lab_status", keyed({ p_run: o.runId }));
          if (data === "cancelled") {
            cancelled = true;
            stop.abort();
          }
        } catch {
          /* the next poll asks again */
        }
      })();
    }, LAB_POLL_MS);
    try {
      const ended = await Promise.all(
        o.slots.map(async (s) => {
          const e = await runSlot({ ...o, slot: s, stopAt, signal: stop.signal, cancelled: () => cancelled });
          ready += 1;
          write(line({ t: "progress", ready, total: o.total }));
          return e;
        }),
      );
      // The answers are in: the phone may show them while the paid steps go on.
      write(line({ t: "done" }));
      if (o.after && !cancelled) {
        try {
          await o.after({ ended, stopAt: stepsAt, signal: stop.signal });
        } catch (e) {
          console.error(`lab steps ${o.runId}: ${errorText(e).slice(0, 200)}`);
        }
      }
    } finally {
      clearInterval(poll);
    }
  }, waitUntil);
}

/** One answer: its pictures signed for this call, the model with no
 *  fallback, its checks, the worker's save. Never throws. */
async function runSlot(o: { sb: SupabaseClient; worker: SupabaseClient; client: Anthropic; runId: string; frozen: Frozen; slot: Claimed; stopAt: number; signal: AbortSignal; cancelled: () => boolean }): Promise<Ended> {
  const s = o.slot;
  const ref = `run:${o.runId}:${s.slot}:${s.part}`;
  const settle = settleFor(o.worker, s.reservation);
  const info = modelInfo(s.model);
  const save = async (r: { status: string; reason: string | null; text: string; spend: Spend | null; latency: number; first: number | null; servedBy: string | null; checks: Record<string, unknown>; checkStatus?: "pending" }) => {
    try {
      const { error } = await o.worker.rpc(
        "study_lab_output_save",
        keyed({
          p_output: s.output,
          p_status: r.status,
          p_reason: r.reason,
          p_text: r.text || null,
          p_usage: r.spend?.usage ?? null,
          p_cost: r.spend?.costUsd ?? 0,
          p_latency: r.latency,
          p_first: r.first,
          p_served_by: r.servedBy,
          p_checks: r.checks,
          p_check_status: r.checkStatus ?? null,
        }),
      );
      if (error) console.error(`lab save ${o.runId}: ${error.message}`); // the sweep ends it
    } catch (e) {
      console.error(`lab save ${o.runId}: ${errorText(e)}`);
    }
  };
  const urls = await signPaths(o.sb, picturePaths(o.frozen), info?.provider === "anthropic" ? LAB_SIGN_SECONDS : LAB_SIGN_SECONDS_OTHER);
  const req = info ? thaw(o.frozen, urls) : null;
  if (!req) {
    await settle({ kind: "lab", ref, model: s.model, usage: null, costUsd: 0, estimated: false }).catch(() => undefined);
    await save({ status: "error", reason: info ? "pictures" : "bad model", text: "", spend: null, latency: 0, first: null, servedBy: null, checks: {} });
    return { slot: s, status: "error", text: "" };
  }
  const t0 = Date.now();
  let text = "";
  let first: number | null = null;
  let spend: Spend | null = null;
  let res: RunResult | null = null;
  try {
    res = await run({
      client: o.client,
      model: s.model,
      kind: "lab",
      ref,
      system: req.system,
      messages: req.messages,
      effort: req.effort,
      maxTokens: req.maxTokens,
      ...(req.format ? { format: req.format } : {}),
      ...(req.cacheTail ? { cacheTail: true } : {}),
      stopAt: o.stopAt,
      fallbacks: false,
      appFallback: false,
      reservedUsd: s.estimate,
      signal: o.signal,
      ledger: async (sp) => {
        spend = sp;
        return settle(sp);
      },
      onText: (d) => {
        if (first === null) first = Date.now() - t0;
        text += d;
      },
    });
  } catch (e) {
    console.error(`lab call ${o.runId}: ${errorText(e).slice(0, 200)}`);
  }
  const { status, reason } = statusOf(res, o.cancelled() && (!res || res.stop === "aborted"));
  const finished = status === "done" || status === "truncated";
  await save({
    status,
    reason,
    text,
    spend,
    latency: Date.now() - t0,
    first,
    servedBy: res?.model ?? (spend as Spend | null)?.model ?? null,
    checks: finished ? checksFor(o.frozen.key, text, status === "done") : {},
    ...(finished && needsCheck(o.frozen, text) ? { checkStatus: "pending" as const } : {}),
  });
  return { slot: s, status, text };
}

/* ── The paid steps after the answers (./labRated.ts) ── */

/** A worker's claim of a paid step (solve, judge): its reservation, or the refusal's code. */
const stepClaim = (worker: SupabaseClient, runId: string) => async (label: string, part: "solve" | "judge", estimate: number) => {
  const { data, error } = await worker.rpc("study_lab_claim", keyed({ p_run: runId, p_label: label, p_part: part, p_estimate: estimate, p_cap: monthlyCap() }));
  if (error) return error.message;
  const id = Number(data);
  return Number.isSafeInteger(id) && id > 0 ? id : "no reservation";
};

/** The steps of a run: the solver's check of each finished answer that waits
 *  for it, then the AI score if the run asked for one. */
function stepsOf(o: { sb: SupabaseClient; worker: SupabaseClient; client: Anthropic; runId: string; frozen: Frozen; lecture: Lecture; solver: string; judge: string | null }): After | undefined {
  const checked = CHECKED_ROUTES.has(o.frozen.route);
  if (!checked && !o.judge) return undefined;
  return async ({ ended, stopAt, signal }) => {
    const ctx = { sb: o.sb, worker: o.worker, client: o.client, runId: o.runId, frozen: o.frozen, lecture: o.lecture, stopAt, signal, claim: stepClaim(o.worker, o.runId) };
    if (checked)
      await Promise.all(
        ended
          .filter((e) => (e.status === "done" || e.status === "truncated") && needsCheck(o.frozen, e.text))
          .map((e) => runCheck({ ...ctx, label: e.slot.label, slot: e.slot.slot, output: e.slot.output, text: e.text, model: o.solver })),
      );
    if (o.judge) await runJudge({ ...ctx, model: o.judge });
  };
}

/* ── The actions ── */

async function runAction(req: Request, body: AiBody, started: number): Promise<Response> {
  const group = uuidOf(body.group);
  if (!group) throw new HttpError(403, "forbidden");
  if (!isLabRoute(body.route)) throw new HttpError(400, "bad route");
  const route = body.route;
  const models = modelsOf(body.models);
  const { sb } = await memberClient(req);
  await assertOwner(sb, group);
  const state = await readModels(sb, group);
  if (state.switches.lab === false) throw new HttpError(403, "off");
  const source = body.source && typeof body.source === "object" && !Array.isArray(body.source) ? (body.source as Record<string, unknown>) : {};
  const m = await material(sb, group, route, source);
  const pictures = picturePaths(m.frozen).length > 0;
  for (const id of models) {
    const why = labRefusal(id, route, { providers: state.providers, pictures });
    if (why) throw refusal(why);
  }
  // The paid steps of a rated kind: the solver's check (practice), the AI score when asked for (OD12, off by default).
  const judge = body.judge === true && isRatedRoute(route) && m.lecture ? stepModel(state.routes, "judge") : null;
  const solver = stepModel(state.routes, "solver");
  const steps = m.lecture ? stepsEstimate({ frozen: m.frozen, lecture: m.lecture, models: models.length, solver, judge }) : { check: 0, judge: 0 };
  const total = runEstimate(m.frozen, models).total + steps.check + steps.judge;
  const cap = Number(state.lab?.run_cap ?? LAB_RUN_CAP_USD);
  if (total > (Number.isFinite(cap) ? cap : LAB_RUN_CAP_USD)) throw new HttpError(402, "run_cap");
  const { data: plan, error } = await sb.rpc(
    "study_lab_plan",
    keyed({
      p_group: group,
      p_lecture: m.lectureId,
      p_route: route,
      p_title: m.title,
      p_source: m.source,
      p_request: m.frozen,
      p_hash: await requestHash(m.frozen),
      p_differs: DIFFERS[route],
      p_models: models.map((id) => ({ model: id, provider: modelInfo(id)!.provider })),
      p_judge: judge,
      p_estimate: Number(total.toFixed(5)),
      p_cap: monthlyCap(),
    }),
  );
  if (error) throw rpcFail(error);
  const p = plan as { run: string; labels: string[] };
  const worker = serverClient();
  const slots = await Promise.all(p.labels.map((l) => readSlot(sb, p.run, l)));
  const claimed = await claimAll(worker, p.run, slots, m.frozen, "answer", true);
  const client = anthropic();
  const after = m.lecture ? stepsOf({ sb, worker, client, runId: p.run, frozen: m.frozen, lecture: m.lecture, solver, judge }) : undefined;
  return runSlots({ sb, worker, client, runId: p.run, frozen: m.frozen, slots: claimed, total: slots.length, ready: slots.length - claimed.length, started, after });
}

/** The steps of a run read back (resume, retry, check, judge): its lecture, the solver's model, the AI score's model if asked. */
async function stepsFor(sb: SupabaseClient, worker: SupabaseClient, client: Anthropic, runId: string, slot: Slot & { lecture?: string | null; judge_model?: string | null }): Promise<After | undefined> {
  if (!slot.request || !isRatedRoute(slot.request.route) || !slot.lecture) return undefined;
  const [lecture, state] = await Promise.all([loadLecture(sb, slot.lecture), readModels(sb, slot.group)]);
  return stepsOf({ sb, worker, client, runId, frozen: slot.request, lecture, solver: stepModel(state.routes, "solver"), judge: slot.judge_model ?? null });
}

/** The run as the owner reads it (study_lab_run): its labels, status and counts. */
async function readRun(sb: SupabaseClient, runId: string): Promise<{ status: string; owner: boolean; ready: number; total: number; labels: string[] }> {
  const { data, error } = await sb.rpc("study_lab_run", { p_run: runId });
  if (error) throw rpcFail(error);
  const r = data as { status: string; owner: boolean; ready: number; total: number; outputs: Array<{ label: string }> };
  if (!r.owner) throw new HttpError(403, "not the creator");
  return { status: r.status, owner: r.owner, ready: Number(r.ready) || 0, total: Number(r.total) || 0, labels: (r.outputs ?? []).map((o) => o.label) };
}

async function resumeAction(req: Request, body: AiBody, started: number): Promise<Response> {
  const runId = uuidOf(body.run);
  if (!runId) throw new HttpError(403, "forbidden");
  const { sb } = await memberClient(req);
  const r = await readRun(sb, runId);
  if (r.status !== "running") throw new HttpError(409, "closed");
  const slots = (await Promise.all(r.labels.map((l) => readSlot(sb, runId, l)))).filter((s) => s.status === "waiting");
  const frozen = slots[0]?.request ?? null;
  const worker = serverClient();
  const claimed = frozen ? await claimAll(worker, runId, slots, frozen, "answer", false) : [];
  const client = anthropic();
  const after = slots[0] ? await stepsFor(sb, worker, client, runId, slots[0]) : undefined;
  return runSlots({ sb, worker, client, runId, frozen: frozen as Frozen, slots: claimed, total: r.total, ready: r.total - slots.length, started, after });
}

async function retryAction(req: Request, body: AiBody, started: number): Promise<Response> {
  const runId = uuidOf(body.run);
  if (!runId) throw new HttpError(403, "forbidden");
  const label = typeof body.label === "string" && (LABELS as readonly string[]).includes(body.label) ? body.label : null;
  if (!label) throw new HttpError(400, "bad slots");
  const { sb } = await memberClient(req);
  const r = await readRun(sb, runId);
  const slot = await readSlot(sb, runId, label);
  if (!slot.request || !["timeout", "error"].includes(slot.status) || slot.tries >= 1) throw new HttpError(409, "not waiting");
  const worker = serverClient();
  const claimed = await claimAll(worker, runId, [slot], slot.request, "retry", true);
  if (!claimed.length) throw new HttpError(409, "not waiting");
  const client = anthropic();
  const after = await stepsFor(sb, worker, client, runId, slot);
  return runSlots({ sb, worker, client, runId, frozen: slot.request, slots: claimed, total: r.total, ready: r.total - 1, started, after });
}

/** "לבדוק עכשיו" (check) and the AI score (judge), after the run: what is
 *  left of its paid steps, in its own detached invocation. Each step is
 *  claimed again (study_lab_claim), so a second tap or a step that already
 *  ran pays nothing. NDJSON: {t:"check", pending}, then {t:"done"}. */
async function stepsAction(req: Request, body: AiBody, started: number, which: "check" | "judge"): Promise<Response> {
  const runId = uuidOf(body.run);
  if (!runId) throw new HttpError(403, "forbidden");
  const { sb } = await memberClient(req);
  const r = await readRun(sb, runId);
  if (r.status !== "done") throw new HttpError(409, r.status === "running" ? "not done" : "closed");
  const slots = await Promise.all(r.labels.map((l) => readSlot(sb, runId, l)));
  const first = slots[0];
  if (!first?.request || !isRatedRoute(first.request.route) || !first.lecture) throw new HttpError(400, "bad route");
  if (which === "judge" && !first.judge_model) throw new HttpError(409, "not waiting");
  const pending = which === "check" ? slots.filter((s) => s.check_status === "pending") : [];
  const worker = serverClient();
  const client = anthropic();
  const [lecture, state] = await Promise.all([loadLecture(sb, first.lecture), readModels(sb, first.group)]);
  const frozen = first.request;
  const texts = new Map<string, string>();
  if (pending.length) {
    const { data, error } = await sb.rpc("study_lab_judge_input", keyed({ p_run: runId }));
    if (error) throw rpcFail(error);
    for (const x of (data as { outputs?: Array<{ label: string; text: string | null }> } | null)?.outputs ?? []) texts.set(x.label, x.text ?? "");
  }
  const deadline = getDeadline()?.getTime() ?? started + 300_000;
  const stopAt = Math.min(started + LAB_ANSWER_MS, deadline - LAB_SAVE_MS);
  return detachedStream(async (write) => {
    write(line({ t: "check", pending: pending.length + (which === "judge" ? 1 : 0) }));
    const ctx = { sb, worker, client, runId, frozen, lecture, stopAt, claim: stepClaim(worker, runId) };
    if (which === "check") {
      const solver = stepModel(state.routes, "solver");
      await Promise.all(pending.map((s) => runCheck({ ...ctx, label: s.label, slot: s.slot, output: s.output, text: texts.get(s.label) ?? "", model: solver })));
    } else await runJudge({ ...ctx, model: first.judge_model! });
    write(line({ t: "done" }));
  }, waitUntil);
}

async function routeAction(req: Request, body: AiBody): Promise<Response> {
  const group = uuidOf(body.group);
  if (!group) throw new HttpError(403, "forbidden");
  const key = typeof body.route === "string" && (ROUTE_KEYS as readonly string[]).includes(body.route) ? (body.route as RouteKey) : null;
  if (!key) throw new HttpError(400, "bad route");
  const { sb } = await memberClient(req);
  await assertOwner(sb, group);
  let model: string | null = null;
  if (body.model !== null && body.model !== undefined) {
    const info = typeof body.model === "string" ? modelInfo(body.model) : null;
    if (!info) throw new HttpError(400, "bad model");
    const state = await readModels(sb, group);
    const why = routeRefusal(info.id, key, { providers: state.providers, confirmExpensive: body.confirmExpensive === true });
    if (why) throw refusal(why);
    model = info.id;
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 200) : "";
  const { error } = await sb.rpc("study_model_set", keyed({ p_group: group, p_route: key, p_model: model, p_note: note }));
  if (error) throw rpcFail(error);
  resetRoutes(); // this instance reads the new route at once
  return json(200, { route: key, model });
}

async function cancelAction(req: Request, body: AiBody): Promise<Response> {
  const runId = uuidOf(body.run);
  if (!runId) throw new HttpError(403, "forbidden");
  const { sb } = await memberClient(req);
  const { error } = await sb.rpc("study_lab_cancel", { p_run: runId });
  if (error) throw rpcFail(error);
  return json(200, { cancelled: true });
}

/** "השוואה חדשה" before the run (design-models §5.3): the material the run
 *  would take (its title and source, read with the owner's token exactly as
 *  `run` reads it), each model's worst case on it (× 1.5 for an unverified
 *  price) or why it may not answer, the run's cap and the month's line.
 *  Nothing is planned, reserved or spent; no model is called. The models'
 *  prices exist only before a run, so they say nothing about its labels. */
async function priceAction(req: Request, body: AiBody): Promise<Response> {
  const group = uuidOf(body.group);
  if (!group) throw new HttpError(403, "forbidden");
  if (!isLabRoute(body.route)) throw new HttpError(400, "bad route");
  const route = body.route;
  const { sb } = await memberClient(req);
  await assertOwner(sb, group);
  const state = await readModels(sb, group);
  const source = body.source && typeof body.source === "object" && !Array.isArray(body.source) ? (body.source as Record<string, unknown>) : {};
  const m = await material(sb, group, route, source, true);
  const pictures = picturePaths(m.frozen).length > 0;
  const asked = Array.isArray(body.models) ? body.models.filter((x): x is string => typeof x === "string").slice(0, ALL_MODELS.length) : ALL_MODELS.map((x) => x.id);
  const models: Record<string, { usd: number } | { refused: string }> = {};
  for (const id of asked) {
    const info = modelInfo(id);
    if (!info) continue;
    const why = labRefusal(info.id, route, { providers: state.providers, pictures });
    models[info.id] = why ? { refused: why } : { usd: Number(labEstimate(m.frozen, info.id).toFixed(5)) };
  }
  const cap = Number(state.lab?.run_cap ?? LAB_RUN_CAP_USD);
  // A solver run picks its questions at random again: the price's source keeps the lecture and the count only.
  const again = route === "solver" ? { lecture: m.source.lecture, n: Array.isArray(m.source.questions) ? m.source.questions.length : undefined } : m.source;
  // The paid steps (rated kinds): the solver's check of each answer (practice), the AI score by the number of answers (index 0-4).
  const steps = m.lecture
    ? {
        check: Number(stepsEstimate({ frozen: m.frozen, lecture: m.lecture, models: 1, solver: stepModel(state.routes, "solver"), judge: null }).check.toFixed(5)),
        judge: [0, 1, 2, 3, 4].map((n) => (n < 2 ? 0 : Number(stepsEstimate({ frozen: m.frozen, lecture: m.lecture!, models: n, solver: null, judge: stepModel(state.routes, "judge") }).judge.toFixed(5)))),
      }
    : null;
  return json(200, { route, title: m.title, source: again, pictures, models, runCap: Number.isFinite(cap) ? cap : LAB_RUN_CAP_USD, ...(steps ? { steps } : {}) });
}

/** POST /api/study/ai {op:"lab", action, …} */
export const labOp: Op = async (req, body, started) => {
  switch (body.action) {
    case "run":
      return runAction(req, body, started);
    case "resume":
      return resumeAction(req, body, started);
    case "retry":
      return retryAction(req, body, started);
    case "route":
      return routeAction(req, body);
    case "cancel":
      return cancelAction(req, body);
    case "price":
      return priceAction(req, body);
    case "check":
      return stepsAction(req, body, started, "check");
    case "judge":
      return stepsAction(req, body, started, "judge");
    default:
      throw new HttpError(400, "bad action");
  }
};
