import {
  openAddPriceUsd,
  openAddWorstUsd,
  SHEET_CONFIRM_USD,
  SHEET_SOLVE_PER_UNIT,
  SHEET_UNIT_TOKENS,
  sheetReaderPriceUsd,
  sheetSizeProblem,
  sheetHoldUsd,
  sheetSolveTokens,
  solveUnitWorstUsd,
} from "../../../shared/study/sheetPrice.js";
import { estimateUsd, monthlyCap, POLICY, reserve, settle, sheetsMonthlyCap } from "../budget.js";
import { claimExam, examPriceUsd, examPrompts, runExamUnit, UNIT_STOP_MS } from "../exams.js";
import { sheetPrompts } from "../sheets.js";
import { assertSchema, HttpError, json, keyed, memberClient, MODEL, schemaHas, SHEET_MODEL, VARIANT_SCHEMA } from "../study.js";
import type { Op } from "./types.js";
import { EXAM_KEYS, holdModel, SHEET_KEYS } from "../routes.js";

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
 *   An uploaded sheet (kind 'sheet', section O 1, docs/study/sheets.md;
 *   release A0 reads it with this same reader) has its own bounds first
 *   (design-exams OD13): at most 40 pages and an answers file of at most 10
 *   (400 too many pages); the switch 'sheets' (403 off); a usual price above
 *   $3 needs the body's confirmBig: true (409 confirm: the phone asked
 *   "הדף ארוך … להמשיך?" first); and its hold (sheetHoldUsd: the read and
 *   key units at their worst case, the usual item count solved at its worst)
 *   must fit both the sheets line, STUDY_SHEETS_MONTHLY_USD less what sheets
 *   cost this month and the holds of sheets still reading (402 sheets_cap),
 *   and the room under the group's 80% line (402 budget). The hold is then
 *   taken under the group's budget lock (study_sheet_hold, section O 1), so
 *   two sheets started at once never both pass, and dropped again if the
 *   start fails after it. Before solve units run, the line is checked again
 *   with the real item count (O 2's exam_advance, with the hold's solve
 *   prices, solveUnitWorstUsd); a sheet that spent its hold runs no more
 *   units (O 2's claim). Either waits as the budget would hold it (D23).
 *
 *   With forms: true (the client's VITE_STUDY_SHEETS_FORMS) a sheet is read
 *   by the sheet reader (section O 2, server/study/sheets.ts): its price and
 *   hold are the sheet reader's (sheetReaderPriceUsd, sheetHoldUsd), the
 *   same bounds apply, and
 *   study_sheet_pages_done queues 3-page units. 503 schema without O 2.
 *   Without it (a release A0 client) a sheet is read as before.
 *
 * {op:"exam_read", action:"open_add", examId, urls?, until?, dry?}
 *   "להעתיק גם N שאלות פתוחות" (OD15, section O 2): a ready past exam (or a
 *   sheet read by the exam reader) with open questions skipped. dry: 200
 *   {units, pages, skipped, priceUsd} and nothing else. Otherwise with fresh
 *   links: its worst case must fit the room under the 80% line (a sheet's,
 *   the sheets line too, and is its hold); reserved as a start (ref "read", 3 a day) and
 *   settled at $0; the units run beside the ready upload. 200 {units,
 *   priceUsd}. 409 nothing to copy | already, 402 sheets_cap | budget.
 *
 * {op:"exam_read", action:"resume", examId, skipSolve?, dry?}
 *   dry: 200 {read, key, solve, fits} (would it go on now) and nothing else.
 *   "להמשיך" / "לסיים בלי תשובות מוצעות" (D23): the units the budget held
 *   go on (with skipSolve, the held solve units are dropped) once their
 *   worst case fits the sheets line and the room under the 80% line again
 *   (a sheet's: its hold now).
 *   200 {read, key, solve, skipped}. 409 nothing to resume, 402 as above.
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
  "not a sheet": 400,
  "nothing to copy": 409,
  already: 409,
  "nothing to resume": 409,
  sheets_cap: 402,
  "bad hold": 500,
};
const rpcError = (e: { message: string }) => new HttpError(STATUS[e.message] ?? 500, e.message);

type Page = { n?: unknown; key?: unknown };

export const examReadOp: Op = async (req, body, started) => {
  const action = body.action === undefined ? "start" : body.action;
  if (action !== "start" && action !== "unit" && action !== "open_add" && action !== "resume") throw new HttpError(400, "bad action");
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

  if (action === "open_add") return openAdd(sb, examId, body);
  if (action === "resume") return resume(sb, examId, body);

  // The exam, as the member sees it (RLS): its group, key mode and state.
  const { data: exam, error: readError } = await sb.from("study_exams").select("id, group_id, key_source, status").eq("id", examId).maybeSingle();
  if (readError) throw new HttpError(500, readError.message);
  if (!exam) throw new HttpError(404, "exam not found");
  const e = exam as { id: string; group_id: string; key_source: string; status: string };
  if (e.status !== "uploading") throw new HttpError(409, "already started");
  const pages = body.pages as Page[];
  const keyPages = pages.filter((p) => p && p.key === true).length;
  let priceUsd = examPriceUsd({ pages: pages.length - keyPages, keyPages, keySource: e.key_source });
  let reader: "exam" | "sheet" = "exam";
  let hold: number | null = null;
  let models: { exam: string; sheet: string } | undefined;
  // An uploaded sheet's bounds (section O 1): the kind is read only where it exists.
  if (await schemaHas(sb, VARIANT_SCHEMA.sheets)) {
    const { data: k, error: kindError } = await sb.from("study_exams").select("kind").eq("id", examId).maybeSingle();
    if (kindError) throw new HttpError(500, kindError.message);
    if ((k as { kind?: string } | null)?.kind === "sheet") {
      // The sheet reader (section O 2) when the client draws its forms.
      if (body.forms === true) {
        await assertSchema(sb, "sheet_forms");
        reader = "sheet";
        priceUsd = sheetReaderPriceUsd({ pages: pages.length - keyPages, keyPages, keySource: e.key_source }, sheetPrompts());
      }
      models = await holdModels(sb, e.group_id);
      hold = (await sheetGate(sb, e, { pages: pages.length - keyPages, keyPages, priceUsd, confirmed: body.confirmBig === true, reader, models })).worstUsd;
    }
  }

  if (hold !== null) await takeHold(sb, examId, hold, models);
  let r: { units?: number; server?: boolean };
  try {
    const id = await reserve(sb, { groupId: e.group_id, kind: "exam", ref: "read", estimateUsd: priceUsd });
    await settle(sb, id, { model: MODEL, usage: null }); // the gate only: the units pay for themselves

    const until = typeof body.until === "string" && !Number.isNaN(Date.parse(body.until)) ? body.until : null;
    const { data, error } = await sb.rpc(reader === "sheet" ? "study_sheet_pages_done" : "study_exam_pages_done", keyed({ p_exam: examId, p_pages: body.pages, p_urls: body.urls, p_until: until }));
    if (error) throw rpcError(error);
    r = (data ?? {}) as { units?: number; server?: boolean };
  } catch (e) {
    if (hold !== null) await dropHold(sb, examId);
    throw e;
  }
  return json(200, { units: r.units ?? 0, server: r.server === true, priceUsd, ...(reader === "sheet" ? { reader } : {}) });
};

type Sb = Awaited<ReturnType<typeof memberClient>>["sb"];

/** The upload as the member sees it (RLS), with its kind (section O 1). */
async function uploadRow(sb: Sb, examId: string): Promise<{ id: string; group_id: string; key_source: string; status: string; kind: string; skipped_open: number }> {
  const { data, error } = await sb.from("study_exams").select("id, group_id, key_source, status, kind, skipped_open").eq("id", examId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "exam not found");
  return data as { id: string; group_id: string; key_source: string; status: string; kind: string; skipped_open: number };
}

/** The room a sheet's (or an exam's) extra work must fit: the sheets line
 *  less what sheets cost this month (a sheet only), and the room under the
 *  group's 80% line. Throws 403 off, 402 sheets_cap or budget. */
async function roomFor(sb: Sb, e: { group_id: string; kind: string }, worstUsd: number): Promise<void> {
  const { data, error } = await sb.rpc("study_sheet_room", { p_group: e.group_id });
  if (error) throw new HttpError(error.message === "forbidden" ? 403 : 500, error.message);
  const room = (Array.isArray(data) ? data[0] : data) as { sheets_on?: boolean; sheets_usd?: unknown; spent_usd?: unknown } | null;
  if (!room) throw new HttpError(500, "no room");
  if (e.kind === "sheet") {
    if (room.sheets_on !== true) throw new HttpError(403, "off");
    if (worstUsd > sheetsMonthlyCap() - Number(room.sheets_usd ?? 0)) throw new HttpError(402, "sheets_cap");
  }
  if (worstUsd > monthlyCap() * POLICY.exam.share - Number(room.spent_usd ?? 0)) throw new HttpError(402, "budget");
}

/** One solve unit's worst case by reader: the hold's prices for O 2's check
 *  before solve units run, at each reader's hold model (holdModels). */
export const holdSolvePrices = (m: { exam: string; sheet: string } = { exam: MODEL, sheet: SHEET_MODEL }) => ({
  exam: solveUnitWorstUsd("exam", m.exam, examPrompts()),
  sheet: solveUnitWorstUsd("sheet", m.sheet, sheetPrompts()),
});

/** The models a group's holds count: per reader, the dearest of its keys'
 *  routes (routes.ts; the default when nothing is set), so a hold covers
 *  what its units will reserve. */
export async function holdModels(sb: Sb, groupId: string): Promise<{ exam: string; sheet: string }> {
  const [exam, sheet] = await Promise.all([holdModel(sb, groupId, EXAM_KEYS), holdModel(sb, groupId, SHEET_KEYS)]);
  return { exam, sheet };
}

/** A sheet's hold on the sheets line, decided under the group's budget lock
 *  (section O 1's study_sheet_hold). Throws 402 sheets_cap, 403 off. */
async function takeHold(sb: Sb, examId: string, worstUsd: number, models?: { exam: string; sheet: string }): Promise<void> {
  const { error } = await sb.rpc("study_sheet_hold", keyed({ p_exam: examId, p_worst: Math.ceil(worstUsd * 100) / 100, p_cap: sheetsMonthlyCap(), p_solve: holdSolvePrices(models) }));
  if (error) throw rpcError(error);
}
/** The hold of a start that failed after it was taken goes (best effort: it lapses in 30 minutes anyway). */
async function dropHold(sb: Sb, examId: string): Promise<void> {
  try {
    await sb.rpc("study_sheet_hold", keyed({ p_exam: examId, p_worst: 0, p_cap: sheetsMonthlyCap(), p_solve: null }));
  } catch {
    /* it lapses */
  }
}

/** "להעתיק גם N שאלות פתוחות" (OD15). */
async function openAdd(sb: Sb, examId: string, body: Record<string, unknown>): Promise<Response> {
  await assertSchema(sb, "sheet_forms");
  const e = await uploadRow(sb, examId);
  const dry = await sb.rpc("study_sheet_open_add", keyed({ p_exam: examId, p_urls: null, p_until: null, p_dry: true }));
  if (dry.error) throw rpcError(dry.error);
  const plan = (dry.data ?? {}) as { units?: number; pages?: number; skipped?: number };
  const size = { pages: plan.pages ?? 0, skipped: plan.skipped ?? e.skipped_open ?? 0 };
  const priceUsd = openAddPriceUsd(size, sheetPrompts());
  if (body.dry === true) return json(200, { units: plan.units ?? 0, pages: size.pages, skipped: size.skipped, priceUsd });
  if (!body.urls || typeof body.urls !== "object" || Array.isArray(body.urls)) throw new HttpError(400, "bad request");
  const models = await holdModels(sb, e.group_id);
  const worst = openAddWorstUsd(size, models.sheet, sheetPrompts());
  await roomFor(sb, e, worst);
  const held = e.kind === "sheet";
  if (held) await takeHold(sb, examId, worst, models);
  try {
    const id = await reserve(sb, { groupId: e.group_id, kind: "exam", ref: "read", estimateUsd: priceUsd });
    await settle(sb, id, { model: MODEL, usage: null }); // the gate only: the units pay for themselves
    const until = typeof body.until === "string" && !Number.isNaN(Date.parse(body.until)) ? body.until : null;
    const { data, error } = await sb.rpc("study_sheet_open_add", keyed({ p_exam: examId, p_urls: body.urls, p_until: until, p_dry: false }));
    if (error) throw rpcError(error);
    return json(200, { units: (data as { units?: number } | null)?.units ?? 0, priceUsd });
  } catch (x) {
    if (held) await dropHold(sb, examId);
    throw x;
  }
}

/** The worst case of the units the budget held: their pages read again and
 *  their items solved, each at all of max_tokens (pure; exported for the tests). */
export function heldWorstUsd(h: { read: number; key: number; solve: number }, model: string = SHEET_MODEL): number {
  const p = sheetPrompts();
  const page = Math.ceil((1061 * 1500) / 750);
  let usd = 0;
  for (let left = Math.max(0, h.read); left > 0; left -= 3) usd += estimateUsd(model, p.read + 600 + 5 * 4_120, SHEET_UNIT_TOKENS.read, 5 * page);
  if (h.key > 0) usd += estimateUsd(model, p.key + 200 + h.key * 4_120, SHEET_UNIT_TOKENS.key, h.key * page);
  for (let left = Math.max(0, h.solve); left > 0; left -= SHEET_SOLVE_PER_UNIT) {
    const n = Math.min(SHEET_SOLVE_PER_UNIT, left);
    usd += estimateUsd(model, p.solve + n * 1_660, sheetSolveTokens(n), n * page);
  }
  return Math.ceil(usd * 100) / 100;
}

/** "להמשיך" / "לסיים בלי תשובות מוצעות" (D23). */
async function resume(sb: Sb, examId: string, body: Record<string, unknown>): Promise<Response> {
  await assertSchema(sb, "sheet_forms");
  const e = await uploadRow(sb, examId);
  const skip = body.skipSolve === true;
  const dry = await sb.rpc("study_sheet_resume", keyed({ p_exam: examId, p_skip_solve: skip, p_dry: true }));
  if (dry.error) throw rpcError(dry.error);
  const held = (dry.data ?? {}) as {
    read?: number;
    key?: number;
    solve?: number;
  };
  const models = await holdModels(sb, e.group_id);
  const worst = heldWorstUsd(
    {
      read: held.read ?? 0,
      key: held.key ?? 0,
      solve: held.solve ?? 0,
    },
    models.sheet,
  );
  // dry: whether it would go on now (the card offers "להמשיך" only then); nothing changes.
  if (body.dry === true) {
    const fits =
      worst <= 0 ||
      (await roomFor(sb, e, worst).then(
        () => true,
        (x) => (x instanceof HttpError && x.status === 402 ? false : Promise.reject(x)),
      ));
    return json(200, { ...held, fits });
  }
  if (worst > 0) await roomFor(sb, e, worst);
  // A sheet's held work is its hold now (a skipped solve is not); it lapses with the sheet's last unit.
  if (worst > 0 && e.kind === "sheet") await takeHold(sb, examId, worst, models);
  const { data, error } = await sb.rpc("study_sheet_resume", keyed({ p_exam: examId, p_skip_solve: skip, p_dry: false }));
  if (error) throw rpcError(error);
  return json(200, data ?? {});
}

/** A sheet's bounds before it is read (OD13; docs/study/sheets.md): what its hold will be. Throws the refusal. */
export async function sheetGate(
  sb: Awaited<ReturnType<typeof memberClient>>["sb"],
  e: { group_id: string; key_source: string },
  o: { pages: number; keyPages: number; priceUsd: number; confirmed: boolean; reader?: "exam" | "sheet"; models?: { exam: string; sheet: string } },
): Promise<{ worstUsd: number }> {
  if (sheetSizeProblem(o)) throw new HttpError(400, "too many pages");
  const { data, error } = await sb.rpc("study_sheet_room", { p_group: e.group_id });
  if (error) throw new HttpError(error.message === "forbidden" ? 403 : 500, error.message);
  const room = (Array.isArray(data) ? data[0] : data) as { sheets_on?: boolean; sheets_usd?: unknown; spent_usd?: unknown } | null;
  if (!room || room.sheets_on !== true) throw new HttpError(403, "off");
  if (o.priceUsd > SHEET_CONFIRM_USD && !o.confirmed) throw new HttpError(409, "confirm");
  const size = { pages: o.pages, keyPages: o.keyPages, keySource: e.key_source };
  const worstUsd = o.reader === "sheet" ? sheetHoldUsd(size, "sheet", o.models?.sheet ?? SHEET_MODEL, sheetPrompts()) : sheetHoldUsd(size, "exam", o.models?.exam ?? MODEL, examPrompts());
  if (worstUsd > sheetsMonthlyCap() - Number(room.sheets_usd ?? 0)) throw new HttpError(402, "sheets_cap");
  if (worstUsd > monthlyCap() * POLICY.exam.share - Number(room.spent_usd ?? 0)) throw new HttpError(402, "budget");
  return { worstUsd };
}
