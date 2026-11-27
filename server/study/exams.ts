import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { examPriceUsd as sharedExamPriceUsd, readUnits as sharedReadUnits } from "../../shared/study/examPrice.js";
import { capPageLines } from "../../shared/study/sheetPrice.js";
import { estimateUsd, imageTokens, reserve } from "./budget.js";
import { cleanSchema, JsonArrayItems, run, settleFor, type Effort, type Spend } from "./claude.js";
import {
  EXAM_KEY_SYSTEM,
  EXAM_READ_SYSTEM,
  EXAM_SOLVE_SYSTEM,
  examKeyRequest,
  examPageText,
  examReadRequest,
  examSolveRequest,
} from "./prompts/questions.js";
import { ExamItem, ExamItems, ExamKey, ExamKeys, ExamSolved, ExamSolvedItem, SheetItem, SheetKey, SheetSolvedItem } from "./questions.js";
import { sheetCall, toSheetItems, toSheetKeyRows, toSolvedRows, type SheetSolveItem } from "./sheets.js";
import { anthropic, errorText, HttpError, keyed, MODEL } from "./study.js";
import { figureOk } from "./writer.js";
import { fallbackReserve, modelFor } from "./routes.js";
import type { RouteKey } from "../../shared/study/models.js";

/* ── Past exams on the server (docs/study/sources.md B6.2, B7) ──
 *
 * The phone uploads an exam's pages (1500 px pictures, and a PDF's text lines
 * when its text layer passed the phone's check) and hands them over (op
 * exam_read, ops/practice.ts). Section S queues units of work in
 * study_private.exam_jobs and kicks /api/study/work {exam}; this module runs
 * one claimed unit:
 *   read   up to 4 pages as pictures (their lines a hint), the next page as
 *          context only, so a question split over two pages is copied whole
 *          by the unit it starts in, and the page before as context for a
 *          case shared with the questions on its pages; the numbers already
 *          saved are skipped; saved by number (an upsert: a unit read again
 *          changes the same rows; a number another page had is a repeat);
 *          marks count only when the uploader said they are in the exam
 *   key    a key sheet uploaded apart, merged by number ('sheet'; "בוטלה"
 *          retires the item; a sheet of several versions keys nothing)
 *   solve  up to 20 items left without a key, answered with a confidence
 *          ('solved', "תשובה מוצעת · לא נבדקה"; under 3 it counts in no score)
 * Each unit reserves its worst case (kind "exam", ref "unit", no daily check:
 * the 3 a day count exams started, ref "read"), settles what it spent, saves
 * through the server-key RPCs under its lease and finishes the unit. A
 * timeout, a refusal or an answer that cannot be read gets one retry; a
 * passing API error is retried with backoff (study_finish_exam_job). When the
 * server cannot write (no pg_net), the phone drives the same units through
 * op exam_read {action:"unit"} with the member's token. */

export const READ_PAGES = 4;
export const READ_TOKENS = 12_000;
export const KEY_TOKENS = 4_000;
/** Thinking counts in max_tokens: 20 medical questions think more than they write. */
export const SOLVE_TOKENS = 16_000;
/** A unit stops at 200 s (B6.2), well inside the 330-second lease. */
export const UNIT_STOP_MS = 200_000;
/** Exam pages are stored at most 1,500 px on the long side (the phone's pdf.ts and images.ts). */
export const EXAM_PAGE_SIDE = 1500;

export type ExamPage = { n: number; path: string; w: number; h: number; lines?: string[] | null; url?: string | null };
export type SolveInput = { id: string; no: number; form: string; vignette: string; question: string; options: string[]; prompts: string[] };
/** study_claim_exam's answer. */
export type ExamClaim = {
  job: string;
  kind: "read" | "key" | "solve";
  /** A page read again ("לקרוא שוב את עמוד 7"): its numbers are saved already, and it replaces them. */
  reread?: boolean;
  /** Section O 2: who reads the unit. "exam" (or absent: a database before
   *  O 2) is this module's reader; "sheet" and "open" are the sheet
   *  reader's (sheets.ts). */
  reader?: "exam" | "sheet" | "open";
  /** An open-add unit (OD15): the upload stays ready. */
  extra?: boolean;
  /** A key unit that reads the sheet's own printed solutions. */
  printed?: boolean;
  lease: string;
  attempt: number;
  last_error: string | null;
  exam: { id: string; group_id: string; title: string; key_source: string; kind?: string; lecture_id?: string | null; course?: string };
  pages: ExamPage[];
  next: ExamPage | null;
  /** The page before the unit's first (a read unit), context for a shared case. */
  prev?: ExamPage | null;
  seen: number[];
  /** The labels saved already (the sheet reader's read units). */
  seen_labels?: Array<{ label: string; page: number | null }> | null;
  items: Array<SolveInput & Partial<SheetSolveItem>> | null;
};
/** The reader of a claimed unit: the sheet reader for "sheet" and "open". */
export const isSheetUnit = (c: Pick<ExamClaim, "reader">) => c.reader === "sheet" || c.reader === "open";
/** One item as study_exam_save_items takes it. */
export type SaveItem = {
  no: number;
  kind: "mcq" | "case";
  form: "one" | "tf" | "match";
  vignette: string;
  question: string;
  options: string[];
  prompts: string[];
  answer: number;
  seq: number[];
  /** "handwritten": a student's own mark, saved as a suggested answer (section S). */
  marked_by: "key_page" | "printed" | "handwritten" | "none";
  figure: string;
  parse_conf: number;
  page: number;
};
export type SaveKey = { no: number; answer: number; seq: number[]; conf?: number; state?: "cancelled" | "several" };
export type UnitResult = { status: "done" | "failed"; error: string | null; saved: number; costUsd: number };

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** A read unit's items as they may be saved (pure): numbers 1-500; a
 *  question 5-600 characters; 2-6 options of 1-400 characters, in their
 *  printed order ("א+ב נכונות" stays where it is); a match needs 2-6
 *  prompts. A key that does not fit its item is dropped (the item stays,
 *  unkeyed), and so is every mark unless the uploader said the answers are
 *  marked in the exam; a figure box is kept only on a page the unit saw. An
 *  item that starts on the next page is the next unit's. A number already
 *  saved is skipped unless it starts on the unit's own pages (section S
 *  then keeps the longer copy of a question over two pages, or counts a
 *  repeated number) or the unit reads a page again (it then replaces it).
 *  Within the unit, a number copied twice from one page keeps its longer copy. */
export function toSaveItems(
  raw: readonly ExamItem[],
  unit: { pages: number[]; next: number | null; prev?: number | null; seen: readonly number[]; reread?: boolean; keySource?: string },
): { items: SaveItem[]; rejected: number } {
  const byNo = new Map<string, SaveItem>();
  let rejected = 0;
  const seen = new Set(unit.seen);
  const marks = unit.keySource === undefined || unit.keySource === "marked";
  const onPage = new Set([...unit.pages, ...(unit.next !== null ? [unit.next] : []), ...(unit.prev ? [unit.prev] : [])]);
  for (const r of raw) {
    const no = int(r.no);
    const question = tidy(r.question ?? "");
    const options = (r.options ?? []).map((o) => tidy(String(o ?? "")));
    const form = r.form === "tf" || r.form === "match" ? r.form : "one";
    const prompts = form === "match" ? (r.prompts ?? []).map((p) => tidy(String(p ?? ""))) : [];
    const startsOn = int(r.page);
    if (
      no === null ||
      no < 1 ||
      no > 500 ||
      question.length < 5 ||
      question.length > 600 ||
      options.length < 2 ||
      options.length > 6 ||
      options.some((o) => o.length < 1 || o.length > 400) ||
      (form === "match" && (prompts.length < 2 || prompts.length > 6 || prompts.some((p) => p.length < 1 || p.length > 300)))
    ) {
      rejected += 1;
      continue;
    }
    if (startsOn !== null && unit.next !== null && startsOn === unit.next && !unit.pages.includes(startsOn)) continue; // the next unit's
    const own = startsOn !== null && unit.pages.includes(startsOn);
    if (seen.has(no) && !unit.reread && !own) continue;
    const n = options.length;
    const ans = int(r.answer);
    const seq = (r.seq ?? []).map((v) => int(v));
    const seqOk =
      form === "tf"
        ? seq.length === n && seq.every((v) => v === 0 || v === 1)
        : form === "match"
          ? seq.length === prompts.length && seq.every((v) => v !== null && v >= 0 && v < n) && new Set(seq).size === seq.length
          : false;
    const f = r.figure;
    const fp = f ? int(f.page) : null;
    const box = f && fp !== null && fp > 0 && onPage.has(fp) ? [f.x, f.y, f.w, f.h].map((v) => clampInt(Number(v) || 0, 0, 1000)) : null;
    const item: SaveItem = {
      no,
      kind: r.kind === "case" || tidy(r.vignette ?? "") !== "" ? "case" : "mcq",
      form,
      vignette: tidy(r.vignette ?? "").slice(0, 2500),
      question,
      options,
      prompts,
      answer: marks && form === "one" && ans !== null && ans >= 0 && ans < n ? ans : -1,
      seq: marks && seqOk ? (seq as number[]) : [],
      marked_by: r.marked_by === "handwritten" || r.marked_by === "printed" || r.marked_by === "key_page" ? r.marked_by : "none",
      figure: box && box[2] > 0 && box[3] > 0 ? `pg:${fp}:${box.join(",")}` : "",
      parse_conf: clampInt(int(r.parse_conf) ?? 2, 1, 3),
      page: own ? startsOn : unit.pages[0],
    };
    const at = `${no}:${item.page}`;
    const had = byNo.get(at);
    if (!had || item.question.length + item.options.join("").length > had.question.length + had.options.join("").length) byNo.set(at, item);
  }
  return { items: [...byNo.values()].sort((a, b) => a.no - b.no || a.page - b.page), rejected };
}

/** A key sheet's answers as they may be merged (pure): a number 1-500, and
 *  an option index 0-5 or a list of 2-6 values; a cancelled question ("בוטלה")
 *  with neither; several answers accepted: the first, marked "several". */
export function toSheetKeys(raw: readonly ExamKey[]): SaveKey[] {
  const out = new Map<number, SaveKey>();
  for (const k of raw) {
    const no = int(k.no);
    const ans = int(k.answer);
    const seq = (k.seq ?? []).map((v) => int(v));
    if (no === null || no < 1 || no > 500) continue;
    if (k.state === "cancelled") out.set(no, { no, answer: -1, seq: [], state: "cancelled" });
    else if (ans !== null && ans >= 0 && ans <= 5) out.set(no, { no, answer: ans, seq: [], ...(k.state === "several" ? { state: "several" as const } : {}) });
    else if (seq.length >= 2 && seq.length <= 6 && seq.every((v) => v !== null && v >= 0 && v <= 5)) out.set(no, { no, answer: -1, seq: seq as number[] });
  }
  return [...out.values()].sort((a, b) => a.no - b.no);
}

/** Solved answers checked against the items asked (pure): only their
 *  numbers, a fitting answer for the item's form, a confidence of 1-3. */
export function toSolvedKeys(asked: readonly SolveInput[], raw: readonly ExamSolvedItem[]): SaveKey[] {
  const byNo = new Map(asked.map((q) => [q.no, q]));
  const out = new Map<number, SaveKey>();
  for (const a of raw) {
    const q = byNo.get(int(a.no) ?? -1);
    const conf = int(a.conf);
    if (!q || conf === null || conf < 1 || conf > 3) continue;
    const n = q.options.length;
    const ans = int(a.answer);
    const seq = (a.seq ?? []).map((v) => int(v));
    if (q.form === "one") {
      if (ans !== null && ans >= 0 && ans < n) out.set(q.no, { no: q.no, answer: ans, seq: [], conf });
    } else if (q.form === "tf") {
      if (seq.length === n && seq.every((v) => v === 0 || v === 1)) out.set(q.no, { no: q.no, answer: -1, seq: seq as number[], conf });
    } else if (seq.length === q.prompts.length && seq.every((v) => v !== null && v >= 0 && v < n) && new Set(seq).size === seq.length) {
      out.set(q.no, { no: q.no, answer: -1, seq: seq as number[], conf });
    }
  }
  return [...out.values()].sort((a, b) => a.no - b.no);
}

/** The read units of an exam's pages, as section S queues them (pure; shared/study/examPrice.ts). */
export const readUnits = sharedReadUnits;

const pageTokens = (p: Pick<ExamPage, "w" | "h">) => imageTokens(p.w, p.h);

/** "להעלות ולהעתיק את השאלות · כ-$1.40": what reading an exam usually costs
 *  (pure): shared/study/examPrice.ts's sum, which the phone shows before the
 *  upload, with these prompts' real lengths (exams.test.ts checks that the
 *  phone's copy of them is the same). */
export function examPriceUsd(o: { pages: number; keyPages?: number; keySource?: string }): number {
  return sharedExamPriceUsd(o, examPrompts());
}
/** The read, key and solve prompts' lengths (the sheets' worst case counts with them too). */
export const examPrompts = () => ({ read: EXAM_READ_SYSTEM.length, key: EXAM_KEY_SYSTEM.length, solve: EXAM_SOLVE_SYSTEM.length });

type Call = {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: Effort;
  inputChars: number;
  imageTokens: number;
};

const schemaOf = (wrapper: Parameters<typeof zodOutputFormat>[0]) => cleanSchema(zodOutputFormat(wrapper).schema as Record<string, unknown>);

/** A page's picture, when its link is this project's own, signed for that
 *  page and good for 10 more minutes; null otherwise (the unit fails as
 *  "pages_expired" and "לנסות שוב" signs fresh links). */
function picture(p: ExamPage): Anthropic.Beta.BetaContentBlockParam | null {
  return p.url && figureOk(p.url, p.path) ? { type: "image", source: { type: "url", url: p.url } } : null;
}

/** The unit's request (exported for the tests): its system (cached), the
 *  user turn and its sizes. Null: a page's link is missing or expired. */
export function unitCall(c: ExamClaim): Call | null {
  if (c.kind === "solve") {
    const items = c.items ?? [];
    const text = examSolveRequest(items);
    return {
      system: EXAM_SOLVE_SYSTEM,
      content: [{ type: "text", text }],
      schema: schemaOf(ExamSolved),
      maxTokens: SOLVE_TOKENS,
      effort: "medium",
      inputChars: EXAM_SOLVE_SYSTEM.length + text.length,
      imageTokens: 0,
    };
  }
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  let chars = 0;
  let tokens = 0;
  const lead =
    c.kind === "read"
      ? examReadRequest({ pages: c.pages.map((p) => p.n), next: c.next?.n ?? null, prev: c.prev?.n ?? null, seen: c.seen, keySource: c.exam.key_source })
      : examKeyRequest(c.pages.map((p) => p.n));
  content.push({ type: "text", text: lead });
  chars += lead.length;
  const shown: Array<{ p: ExamPage; context: boolean | "before" }> = [
    ...(c.kind === "read" && c.prev ? [{ p: c.prev, context: "before" as const }] : []),
    ...c.pages.map((p) => ({ p, context: false })),
    ...(c.kind === "read" && c.next ? [{ p: c.next, context: true }] : []),
  ];
  for (const { p, context } of shown) {
    const img = picture(p);
    if (!img) return null;
    // A sheet's page sends at most the worst case's lines (its hold counts no more); a past exam's as before.
    const label = examPageText(p.n, c.exam.kind === "sheet" ? capPageLines(p.lines ?? []) : (p.lines ?? []), context);
    content.push({ type: "text", text: label }, img);
    chars += label.length;
    tokens += pageTokens(p);
  }
  const system = c.kind === "read" ? EXAM_READ_SYSTEM : EXAM_KEY_SYSTEM;
  return {
    system,
    content,
    schema: schemaOf(c.kind === "read" ? ExamItems : ExamKeys),
    maxTokens: c.kind === "read" ? READ_TOKENS : KEY_TOKENS,
    effort: "low",
    inputChars: system.length + chars,
    imageTokens: tokens,
  };
}

/** One unit's worst case: its input and all of max_tokens (estimateUsd). */
export function unitEstimate(call: Call, model: string = MODEL): number {
  return estimateUsd(model, call.inputChars, call.maxTokens, call.imageTokens);
}

/** Takes the exam's next unit (the worker with the key alone; the phone's op
 *  with the member's token too), or null: nothing to take now. */
export async function claimExam(sb: SupabaseClient, examId: string): Promise<ExamClaim | null> {
  const { data, error } = await sb.rpc("study_claim_exam", keyed({ p_exam: examId }));
  if (error) throw new HttpError(error.message === "forbidden" ? 403 : 500, error.message);
  if (!data || typeof data !== "object") return null;
  const c = data as ExamClaim;
  return { ...c, pages: c.pages ?? [], seen: c.seen ?? [], items: c.items ?? null, next: c.next ?? null, prev: c.prev ?? null };
}

const log = (c: ExamClaim, what: string, e: unknown) =>
  console.error(`study exam ${c.exam.id} ${c.kind} ${c.job}: ${what}: ${e instanceof Error ? e.message : String(e)}`);

async function finishUnit(sb: SupabaseClient, c: ExamClaim, status: "done" | "failed", error: string | null, cost: number): Promise<boolean> {
  const { data, error: e } = await sb.rpc(
    "study_finish_exam_job",
    keyed({ p_job: c.job, p_lease: c.lease, p_status: status, p_error: error, p_cost: Math.round(cost * 1e5) / 1e5 }),
  );
  if (e) throw new HttpError(500, e.message);
  return data === true;
}

/** A sheet unit's save (section O 2, sheets.ts): a read unit's items by
 *  label (after moving the sheet's own printed solutions to a key unit), an
 *  answers file's lines by label, or a solve unit's answers and worked
 *  solutions by item. Throws the RPC's error (409 lease lost). */
async function saveSheetUnit(
  sb: SupabaseClient,
  c: ExamClaim,
  doc: Record<string, unknown> | null,
  list: (name: string) => unknown[],
): Promise<{ saved: number; error: string | null }> {
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error: e } = await sb.rpc(name, keyed({ p_job: c.job, p_lease: c.lease, ...args }));
    if (e) throw new HttpError(e.message === "lease lost" ? 409 : 500, e.message);
    return data;
  };
  if (c.kind === "read") {
    const raw = list("questions").flatMap((x) => {
      const r = SheetItem.safeParse(x);
      return r.success ? [r.data] : [];
    });
    let solutionsFrom = 0;
    const from = doc ? Number(doc.solutions_from_page) || 0 : 0;
    const known = new Set([...c.pages.map((p) => p.n), ...(c.next ? [c.next.n] : [])]);
    if (c.reader === "sheet" && from > 0 && known.has(from)) {
      // The sheet's own answers start on a page of this unit or the next: they become its answers file.
      const moved = Number(await rpc("study_sheet_queue_key", { p_from_page: from })) || 0;
      if (moved > 0) solutionsFrom = from;
    }
    const lines: Record<number, readonly string[]> = {};
    for (const p of [...c.pages, ...(c.next ? [c.next] : [])]) lines[p.n] = p.lines ?? [];
    const { items } = toSheetItems(raw, {
      pages: c.pages.map((p) => p.n),
      next: c.next?.n ?? null,
      prev: c.prev?.n ?? null,
      keySource: c.exam.key_source,
      mode: c.reader === "open" ? "open" : "sheet",
      lines,
      solutionsFrom,
    });
    const skipped = doc ? clampInt(Number(doc.skipped) || 0, 0, 500) : 0;
    if (!items.length && !doc) return { saved: 0, error: null };
    const r = (await rpc("study_sheet_save_items", { p_items: items, p_skipped: skipped })) as { saved?: number; updated?: number } | null;
    return { saved: (r?.saved ?? 0) + (r?.updated ?? 0), error: null };
  }
  if (c.kind === "key" && doc && Array.isArray(doc.versions) && doc.versions.length > 1) return { saved: 0, error: "versions" };
  const rows =
    c.kind === "key"
      ? toSheetKeyRows(list("keys").flatMap((x) => (SheetKey.safeParse(x).success ? [SheetKey.parse(x)] : [])))
      : toSolvedRows((c.items ?? []) as SheetSolveItem[], list("answers").flatMap((x) => (SheetSolvedItem.safeParse(x).success ? [SheetSolvedItem.parse(x)] : [])));
  if (!rows.length) return { saved: 0, error: null };
  return { saved: Number(await rpc("study_sheet_save_keys", { p_rows: rows })) || 0, error: null };
}

/** The refusals of study_reserve: the unit ends with the code, no model call. */
const isRefusal = (e: unknown): e is HttpError => e instanceof HttpError && e.status !== 500;

/** Runs one claimed unit to its end: the request, its reservation, the
 *  model, the save under the lease, the finish. Never throws: an RPC that
 *  fails leaves the unit to its lease (330 s), and the next claim counts it. */
export async function runExamUnit(sb: SupabaseClient, c: ExamClaim, opts: { stopAt: number }): Promise<UnitResult> {
  const sheet = isSheetUnit(c);
  const call: (Call & { ref?: string }) | null = sheet ? sheetCall(c) : unitCall(c);
  const ref = sheet && call?.ref ? call.ref : "unit";
  try {
    if (!call) {
      await finishUnit(sb, c, "failed", "pages_expired", 0);
      return { status: "failed", error: "pages_expired", saved: 0, costUsd: 0 };
    }
    if (c.kind === "solve" && !(c.items ?? []).length) {
      await finishUnit(sb, c, "done", null, 0); // keyed meanwhile (a member, the sheet): nothing to solve
      return { status: "done", error: null, saved: 0, costUsd: 0 };
    }
  } catch (e) {
    log(c, "left to its lease", e);
    return { status: "failed", error: "writer", saved: 0, costUsd: 0 };
  }

  // A sheet's unit carries its key as its ref; a past exam's is its kind's.
  const key: RouteKey = sheet && call.ref ? (call.ref as RouteKey) : c.kind === "key" ? "exam_key" : c.kind === "solve" ? "exam_solve" : "exam_read";
  const model = await modelFor(sb, c.exam.group_id, key, { pictures: call.imageTokens > 0 });
  let reservation: number;
  try {
    reservation = await reserve(sb, { groupId: c.exam.group_id, kind: "exam", ref, estimateUsd: unitEstimate(call, model), daily: false });
  } catch (e) {
    if (!isRefusal(e)) {
      log(c, "left to its lease", e);
      return { status: "failed", error: "writer", saved: 0, costUsd: 0 };
    }
    try {
      await finishUnit(sb, c, "failed", e.message, 0);
    } catch (f) {
      log(c, "left to its lease", f);
    }
    return { status: "failed", error: e.message, saved: 0, costUsd: 0 };
  }

  let text = "";
  const scan = new JsonArrayItems();
  const raw: unknown[] = [];
  let spent: Spend | null = null;
  let thrown: unknown = null;
  let res: Awaited<ReturnType<typeof run>> | null = null;
  const settleIt = settleFor(sb, reservation);
  let rerunCost = 0;
  try {
    res = await run({
      client: anthropic(),
      model,
      reserveFallback: fallbackReserve(sb, { groupId: c.exam.group_id, kind: "exam", ref }, undefined, (sp) => (rerunCost += sp.costUsd)),
      kind: "exam",
      ref,
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: call.content }],
      effort: call.effort,
      maxTokens: call.maxTokens,
      stopAt: opts.stopAt,
      format: { type: "json_schema", schema: call.schema },
      ledger: async (s) => {
        spent = s;
        return settleIt(s);
      },
      onText: (delta) => {
        text += delta;
        raw.push(...scan.push(delta));
      },
    });
  } catch (e) {
    thrown = e;
  }
  const cost = ((spent as Spend | null)?.costUsd ?? 0) + rerunCost;

  // What arrived: the whole document, or the items that closed before a stop.
  let doc: Record<string, unknown> | null = null;
  try {
    const d = JSON.parse(text) as unknown;
    if (d && typeof d === "object" && !Array.isArray(d)) doc = d as Record<string, unknown>;
  } catch {
    /* cut off: the items that closed */
  }
  const list = (name: string): unknown[] => (doc && Array.isArray(doc[name]) ? (doc[name] as unknown[]) : raw);

  let error: string | null = null;
  if (thrown) error = errorText(thrown);
  else if (res?.timedOut) error = "timeout";
  else if (res?.stop === "refusal") error = "refusal";
  else if (!doc) error = res?.stop === "max_tokens" ? "truncated" : "unreadable";

  let saved = 0;
  try {
    if (sheet) {
      const r = await saveSheetUnit(sb, c, doc, list);
      saved = r.saved;
      if (r.error && !error) error = r.error;
    } else if (c.kind === "read") {
      const items = list("questions")
        .map((x) => ExamItem.safeParse(x))
        .filter((r) => r.success)
        .map((r) => r.data);
      const skipped = doc ? clampInt(Number(doc.skipped_open) || 0, 0, 500) : 0;
      const { items: save } = toSaveItems(items, {
        pages: c.pages.map((p) => p.n),
        next: c.next?.n ?? null,
        prev: c.prev?.n ?? null,
        seen: c.seen,
        reread: c.reread === true,
        keySource: c.exam.key_source,
      });
      if (save.length || doc) {
        const { data, error: e } = await sb.rpc("study_exam_save_items", keyed({ p_job: c.job, p_lease: c.lease, p_items: save, p_skipped: skipped }));
        if (e) throw new HttpError(e.message === "lease lost" ? 409 : 500, e.message);
        const r = data as { saved?: number; updated?: number } | null;
        saved = (r?.saved ?? 0) + (r?.updated ?? 0);
      }
    } else if (c.kind === "key" && doc && Array.isArray(doc.versions) && doc.versions.length > 1) {
      // A column per version: which one is this exam's cannot be told, so nothing is keyed from it.
      if (!error) error = "versions";
    } else {
      const keys =
        c.kind === "key"
          ? toSheetKeys(
              list("keys").flatMap((x) => {
                const k = ExamKey.safeParse(x && typeof x === "object" ? { state: "", ...x } : x); // a line without its state is a plain answer
                return k.success ? [k.data] : [];
              }),
            )
          : toSolvedKeys(c.items ?? [], list("answers").flatMap((x) => (ExamSolvedItem.safeParse(x).success ? [ExamSolvedItem.parse(x)] : [])));
      if (keys.length) {
        const { data, error: e } = await sb.rpc("study_exam_save_keys", keyed({ p_job: c.job, p_lease: c.lease, p_keys: keys }));
        if (e) throw new HttpError(e.message === "lease lost" ? 409 : 500, e.message);
        saved = Number(data) || 0;
      }
    }
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return { status: "failed", error: "lease_lost", saved: 0, costUsd: cost };
    log(c, "left to its lease", e);
    return { status: "failed", error: "writer", saved: 0, costUsd: cost };
  }

  const status = error ? "failed" : "done";
  try {
    const ok = await finishUnit(sb, c, status, error, cost);
    if (!ok) return { status: "failed", error: "lease_lost", saved, costUsd: cost };
  } catch (e) {
    log(c, "left to its lease", e);
    return { status: "failed", error: "writer", saved, costUsd: cost };
  }
  return { status, error, saved, costUsd: cost };
}
