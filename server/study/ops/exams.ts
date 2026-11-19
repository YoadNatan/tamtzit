import { reserve, settle } from "../budget.js";
import { claimExam, examPriceUsd, runExamUnit, UNIT_STOP_MS } from "../exams.js";
import { assertSchema, HttpError, json, keyed, memberClient, MODEL } from "../study.js";
import type { Op } from "./types.js";

/* Op "exam_read" (docs/study/sources.md B2, B6.2, and its "Built so far"
 * block for phase 2). Behind the switch 'exams' and section S at 2 (VARIANT_SCHEMA
 * "exams"; the router checks Q 2, the op's §12.2.2 need).
 *
 * {op:"exam_read", examId, pages, urls, until?}       (action "start", the default)
 *   After the phone uploaded the pages of an exam it created
 *   (study_exam_create): reserves the exam's usual price (kind "exam", ref
 *   "read": the group's 80% line and 3 exams started a day per member) and
 *   settles it at $0 at once, since each unit reserves and pays its own;
 *   then study_exam_pages_done saves the pages, queues the units and kicks
 *   the worker. 200 {units, server, priceUsd}; server false: no pg_net, the
 *   phone drives the units (below).
 *   400 bad request | too many pages | bad pages | missing pages | bad urls,
 *   403 off, 404 exam not found, 409 already started, 402/429 the budget's.
 *
 * {op:"exam_read", action:"unit", examId}
 *   The phone's fallback when the server does not write: takes the next
 *   unit with the member's token and the key, runs it here (stops at 200 s),
 *   and answers 200 {claimed:true, kind, status, error} or {claimed:false,
 *   status: the exam's}. The phone calls it again until claimed is false
 *   and the status is no longer "reading". */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, number> = {
  "not signed in": 401,
  forbidden: 403,
  off: 403,
  "exam not found": 404,
  "already started": 409,
  "too many pages": 400,
  "bad pages": 400,
  "missing pages": 400,
  "bad urls": 400,
};
const rpcError = (e: { message: string }) => new HttpError(STATUS[e.message] ?? 500, e.message);

type Page = { n?: unknown; key?: unknown };

export const examReadOp: Op = async (req, body, started) => {
  const action = body.action === undefined ? "start" : body.action;
  if (action !== "start" && action !== "unit") throw new HttpError(400, "bad action");
  const examId = typeof body.examId === "string" && UUID.test(body.examId) ? body.examId.toLowerCase() : null;
  if (!examId) throw new HttpError(400, "bad request");
  if (action === "start") {
    if (!Array.isArray(body.pages) || !body.pages.length || !body.urls || typeof body.urls !== "object" || Array.isArray(body.urls)) {
      throw new HttpError(400, "bad request");
    }
    if (body.pages.length > 120) throw new HttpError(400, "too many pages");
  }
  const { sb } = await memberClient(req);
  await assertSchema(sb, "exams");

  if (action === "unit") {
    const claim = await claimExam(sb, examId);
    if (!claim) {
      const { data, error } = await sb.rpc("study_exam_status", { p_exam: examId });
      if (error) throw rpcError(error);
      return json(200, { claimed: false, status: (data as { status?: string } | null)?.status ?? null });
    }
    const r = await runExamUnit(sb, claim, { stopAt: started + UNIT_STOP_MS });
    return json(200, { claimed: true, kind: claim.kind, status: r.status, error: r.error, saved: r.saved });
  }

  // The exam, as the member sees it (RLS): its group, key mode and state.
  const { data: exam, error: readError } = await sb.from("study_exams").select("id, group_id, key_source, status").eq("id", examId).maybeSingle();
  if (readError) throw new HttpError(500, readError.message);
  if (!exam) throw new HttpError(404, "exam not found");
  const e = exam as { id: string; group_id: string; key_source: string; status: string };
  if (e.status !== "uploading") throw new HttpError(409, "already started");
  const pages = body.pages as Page[];
  const keyPages = pages.filter((p) => p && p.key === true).length;
  const priceUsd = examPriceUsd({ pages: pages.length - keyPages, keyPages, keySource: e.key_source });

  const id = await reserve(sb, { groupId: e.group_id, kind: "exam", ref: "read", estimateUsd: priceUsd });
  await settle(sb, id, { model: MODEL, usage: null }); // the gate only: the units pay for themselves

  const until = typeof body.until === "string" && !Number.isNaN(Date.parse(body.until)) ? body.until : null;
  const { data, error } = await sb.rpc("study_exam_pages_done", keyed({ p_exam: examId, p_pages: body.pages, p_urls: body.urls, p_until: until }));
  if (error) throw rpcError(error);
  const r = (data ?? {}) as { units?: number; server?: boolean };
  return json(200, { units: r.units ?? 0, server: r.server === true, priceUsd });
};
