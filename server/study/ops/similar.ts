import { SIMILAR_ITEM_PER, similarPriceUsd, similarWorstUsd, type SimilarRootShape } from "../../../shared/study/sheetPrice.js";
import { reserve, settle, similarMonthlyCap } from "../budget.js";
import { UNIT_STOP_MS } from "../exams.js";
import { claimSimilar, runSimilarJob } from "../similarGen.js";
import { HttpError, json, keyed, lectureBlock, loadLecture, memberClient, QUICK_TOKEN_SECONDS, SIMILAR_MODEL } from "../study.js";
import type { Op } from "./types.js";

/* Op "similar" (section O 3, docs/study/sheets.md; design-exams §8.2, D19,
 * D20, D24). The router checks section O at 3 and L at 1 (VARIANT_SCHEMA.similar,
 * read by the op's name).
 *
 * {op:"similar", examId, scope:"item", questionId, make?, urls?, until?}   (action "start", the default)
 * {op:"similar", examId, scope:"sheet", urls?, until?}
 *   "ליצור 2 כמוה" after a wrong answer (an item of a sheet, a part of
 *   one, or one of its twins: its root counts), or "שאלות דומות לכל הדף"
 *   at the end of a sheet. study_similar_plan first:
 *     - a run making these now: 200 {joined: runId}, nothing reserved;
 *     - an item with twins already and no make: true: 200 {twins} ($0:
 *       practise those first);
 *   then the run's worst case (similarWorstUsd: every job's calls at all of
 *   their max_tokens, with the lecture's slides when the sheet has one) is
 *   reserved under the member (kind "similar", ref "ask": the 80% line, the
 *   member's 40%, 10 taps a day), and study_similar_begin starts it under
 *   one lock a sheet and the similar line (STUDY_SIMILAR_MONTHLY_USD, $5).
 *   Any refusal there settles the reservation at $0. 202 {runId, setId,
 *   jobs, items, per, priceUsd, worstUsd, server}; server false: no
 *   pg_net, the phone drives the jobs (action "unit"). The pages' fresh
 *   links (urls, until; D24) let roots with a figure have twins; without
 *   them those roots are left out and counted (skipped_figs).
 *   400 bad request | bad scope | bad urls, 403 off | forbidden, 404 exam
 *   not found | question not found, 409 not eligible | max | today |
 *   nothing to make, 402 budget | reserve | member_share | similar_cap,
 *   429 daily_limit.
 *
 * {op:"similar", action:"plan", examId, scope, questionId?}
 *   What a tap would make and cost, nothing reserved: 200 {plan, priceUsd, worstUsd}.
 *
 * {op:"similar", action:"unit", runId}
 *   The phone's fallback when the server does not write: takes the run's
 *   next job with the member's token and the key, runs it here (stops at
 *   200 s), 200 {claimed:true, status, error, saved, dropped} or
 *   {claimed:false, status: the run's}. The phone calls it again until
 *   claimed is false. The screens poll study_similar_runs (members read it). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, number> = {
  "not signed in": 401,
  forbidden: 403,
  off: 403,
  "exam not found": 404,
  "question not found": 404,
  "not eligible": 409,
  max: 409,
  today: 409,
  "nothing to make": 409,
  similar_cap: 402,
  "bad scope": 400,
  "bad urls": 400,
  "bad request": 400,
  "bad reserve": 500,
};
const rpcError = (e: { message: string }) => new HttpError(STATUS[e.message] ?? 500, e.message);
const uuidOf = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);

/** study_similar_plan's answer. */
export type SimilarPlan = {
  scope: "item" | "sheet";
  root?: string;
  parts?: number;
  numeric?: number;
  count?: number;
  room?: number;
  twins?: string[];
  pages?: number[];
  items?: string[];
  roots?: Array<{ id: string; parts: number; numeric: number; pages: number[] }>;
  more?: number;
  today?: boolean;
  joined: string | null;
};

/** The roots' shapes as the price takes them (pure; exported for the tests). */
export function shapesOf(plan: SimilarPlan): SimilarRootShape[] {
  if (plan.scope === "item") return [{ parts: Math.max(1, plan.parts ?? 1), numeric: plan.numeric ?? 0, pages: (plan.pages ?? []).length }];
  return (plan.roots ?? []).map((r) => ({ parts: Math.max(1, r.parts), numeric: r.numeric, pages: (r.pages ?? []).length }));
}
/** Twins a root on this tap: 2 for an item (less when fewer than 2 fit under its 6), 1 each for the whole sheet. */
export const perOf = (plan: SimilarPlan): number => (plan.scope === "item" ? Math.max(1, Math.min(SIMILAR_ITEM_PER, plan.room ?? SIMILAR_ITEM_PER)) : 1);

export const similarOp: Op = async (req, body, started) => {
  const action = body.action === undefined ? "start" : body.action;
  if (action !== "start" && action !== "plan" && action !== "unit") throw new HttpError(400, "bad action");

  if (action === "unit") {
    const runId = uuidOf(body.runId);
    if (!runId) throw new HttpError(400, "bad request");
    const { sb } = await memberClient(req);
    const claim = await claimSimilar(sb, runId);
    if (!claim) {
      const { data, error } = await sb.from("study_similar_runs").select("status").eq("id", runId).maybeSingle();
      if (error) throw new HttpError(500, error.message);
      return json(200, { claimed: false, status: (data as { status?: string } | null)?.status ?? null });
    }
    const r = await runSimilarJob(sb, claim, { stopAt: started + UNIT_STOP_MS });
    return json(200, { claimed: true, status: r.status, error: r.error, saved: r.saved, dropped: r.dropped });
  }

  const examId = uuidOf(body.examId);
  const scope = body.scope === "sheet" ? "sheet" : body.scope === "item" ? "item" : null;
  const questionId = uuidOf(body.questionId);
  if (!examId || !scope || (scope === "item" && !questionId)) throw new HttpError(400, "bad request");
  if (body.urls !== undefined && body.urls !== null && (typeof body.urls !== "object" || Array.isArray(body.urls))) throw new HttpError(400, "bad urls");
  // No model call here: the start reserves, starts the run and returns.
  const { sb } = await memberClient(req, { minSeconds: QUICK_TOKEN_SECONDS });

  const { data: p, error: planError } = await sb.rpc("study_similar_plan", { p_exam: examId, p_question: questionId, p_scope: scope });
  if (planError) throw rpcError(planError);
  const plan = (p ?? {}) as SimilarPlan;
  const per = perOf(plan);
  // The sheet's lecture, whose slides the check may read (its size is in the worst case).
  const { data: ex, error: exError } = await sb.from("study_exams").select("group_id, lecture_id").eq("id", examId).maybeSingle();
  if (exError) throw new HttpError(500, exError.message);
  if (!ex) throw new HttpError(404, "exam not found");
  const e = ex as { group_id: string; lecture_id: string | null };
  let deckChars = 0;
  if (e.lecture_id) {
    try {
      const l = await loadLecture(sb, e.lecture_id);
      if (Array.isArray(l.slides) && l.slides.length) deckChars = lectureBlock(l).length;
    } catch {
      deckChars = 0; // a deleted lecture: the blind check only
    }
  }
  const shapes = shapesOf(plan);
  const priceUsd = similarPriceUsd({ roots: shapes, per, scope });
  const worstUsd = similarWorstUsd({ roots: shapes, per, scope, deckChars }, SIMILAR_MODEL);
  if (action === "plan") return json(200, { plan, priceUsd, worstUsd });

  if (plan.joined) return json(200, { joined: plan.joined });
  if (scope === "item") {
    if ((plan.twins ?? []).length && body.make !== true) return json(200, { twins: plan.twins });
    if ((plan.room ?? 0) <= 0) throw new HttpError(409, "max");
  } else {
    if (plan.today) throw new HttpError(409, "today");
    if (!(plan.items ?? []).length) throw new HttpError(409, "nothing to make");
  }

  const id = await reserve(sb, { groupId: e.group_id, kind: "similar", ref: "ask", estimateUsd: worstUsd });
  const release = () => settle(sb, id, { model: SIMILAR_MODEL, usage: null }); // $0: nothing ran
  const until = typeof body.until === "string" && !Number.isNaN(Date.parse(body.until)) ? body.until : null;
  const { data, error } = await sb.rpc(
    "study_similar_begin",
    keyed({
      p_exam: examId,
      p_items: scope === "item" ? [questionId] : (plan.items ?? []),
      p_scope: scope,
      p_per: per,
      p_reserve: id,
      p_worst: worstUsd,
      p_cap: similarMonthlyCap(),
      p_urls: body.urls ?? null,
      p_until: until,
    }),
  );
  if (error) {
    await release();
    throw rpcError(error);
  }
  const r = (data ?? {}) as { joined?: string; run_id?: string; set_id?: string | null; jobs?: number; items?: number; per?: number; server?: boolean };
  if (r.joined) {
    await release();
    return json(200, { joined: r.joined });
  }
  return json(202, { runId: r.run_id, setId: r.set_id ?? null, jobs: r.jobs ?? 0, items: r.items ?? 0, per: r.per ?? per, priceUsd, worstUsd, server: r.server === true });
};
