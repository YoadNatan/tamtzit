import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { coverage } from "../../shared/study/coverage.js";
import { SHEET_UNIT_TOKENS, sheetSolveTokens as solveTokens } from "../../shared/study/sheetPrice.js";
import { recompute } from "./calc.js";
import { cleanSchema, type Effort } from "./claude.js";
import type { ExamClaim, ExamPage } from "./exams.js";
import { imageTokens } from "./budget.js";
import {
  SHEET_KEY_SYSTEM,
  SHEET_READ_SYSTEM,
  SHEET_SOLVE_SYSTEM,
  sheetKeyRequest,
  sheetPageText,
  sheetReadRequest,
  sheetSolveRequest,
  type SheetSolveInput,
} from "./prompts/sheets.js";
import { SheetItems, SheetKeys, SheetSolved, type SheetItem, type SheetKey, type SheetSolvedItem } from "./questions.js";
import { figureOk } from "./writer.js";

/* ── Uploaded sheets on the server: the sheet reader (section O 2;
 *    docs/study/sheets.md, design-exams §8) ──
 *
 * A sheet queued for the sheet reader (study_sheet_pages_done) has units
 * whose claim says reader "sheet"; an exam's "copy the open questions too"
 * (study_sheet_open_add) has read units with reader "open". exams.ts's
 * runExamUnit sends both here for the request and the save, and keeps the
 * rest (the reservation, the stream, the lease, the finish) shared with the
 * past exams' reader:
 *   read   3 pages as pictures (their lines a hint), the page before and
 *          after as context; items by printed label, exact text (line
 *          breaks, tables as pipe rows, up to 4 boxes), multi-part
 *          questions one row a part; the sheet's own printed solutions
 *          become its answers file (study_sheet_queue_key)
 *   key    the answers file by label: answers, numbers with units, answers
 *          in words, worked solutions
 *   solve  SHEET_SOLVE_ITEMS-or-fewer items without an answer, with their
 *          figures' pages: a suggested answer, a worked solution, a
 *          numeric answer's working recomputed here ($0, calc.ts)
 * Units reserve under kind "exam" with refs sheet_read, sheet_key and
 * sheet_solve (the ledger tells sheets from exams; the models package, Y,
 * routes them by the keys "sheet_read" and later "similar"). Pure helpers
 * first, then the unit's request and save. */

/** Read units of 3 pages (design §8.1; section O 2 queues them). Thinking
 *  counts in max_tokens. A solve unit has at most SHEET_SOLVE_ITEMS items
 *  (study_private.sheet_solve_items() queues SHEET_SOLVE_PER_UNIT, 4, until
 *  the speed is measured: docs/study/sheets.md) and max_tokens by its size
 *  (sheetSolveTokens). The numbers live in shared/study/sheetPrice.ts, so
 *  the phone's price and the server's reservations agree. */
export { SHEET_READ_PAGES, SHEET_SOLVE_PER_UNIT, sheetSolveTokens } from "../../shared/study/sheetPrice.js";
export const SHEET_READ_TOKENS = SHEET_UNIT_TOKENS.read;
export const SHEET_KEY_TOKENS = SHEET_UNIT_TOKENS.key;
export const SHEET_SOLVE_ITEMS = 8;
export const SHEET_SOLVE_TOKENS = SHEET_UNIT_TOKENS.solveMax;
/** The exactness check's line (design D9): under it an item is "לבדיקה". */
export const EXACT_MIN = 0.55;
/** Text lengths a sheet item may have (section O 2's checks). */
export const SHEET_TEXT_MAX = { question: 4000, vignette: 8000, option: 1000, prompt: 300, label: 20 } as const;

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** Exact text kept as printed (design D8): runs of spaces and tabs become
 *  one, each line is trimmed, at most two blank lines in a row; line breaks
 *  and pipe rows stay. */
export function keepLines(s: string): string {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
/** A text over its limit is cut visibly, never silently: "[…]" at its end. */
export function cutVisible(s: string, max: number): { text: string; cut: boolean } {
  return s.length <= max ? { text: s, cut: false } : { text: s.slice(0, max - 4).trimEnd() + " […]", cut: true };
}
/** A printed label's normal form, as section O 2's study_private.label_key
 *  makes it ("שאלה 3 (א)" → "3א", "2.1." → "2.1"): one item per label. */
export function labelKey(label: string): string {
  return String(label ?? "")
    .toLowerCase()
    .replace(/(שאלה|סעיף|question|part)/g, "")
    .replace(/[\s()[\]{}"'׳״`:,;]/g, "")
    .replace(/^[.\-–—]+|[.\-–—]+$/g, "")
    .slice(0, 20);
}

/** One item as study_sheet_save_items takes it. */
export type SheetSaveItem = {
  label: string;
  main?: string;
  part?: number;
  form: "one" | "tf" | "match" | "open" | "numeric";
  kind: "mcq" | "case";
  vignette: string;
  question: string;
  options: string[];
  prompts: string[];
  figures: string[];
  answer: number;
  seq: number[];
  num?: number;
  unit?: string;
  marked_by: "printed" | "handwritten" | "none";
  parse_conf: number;
  page: number;
  idx: number;
  exact: number | null;
};

/** A read unit's items as they may be saved (pure). Labels as printed
 *  (1-20 characters); forms one (2-10 options), tf and match (2-6), open
 *  and numeric (none); the text kept with its lines, cut visibly over its
 *  limit (the item is then parse_conf 1); a question with parts keeps its
 *  stem on every part (series and step in SQL); up to 4 boxes on pages the
 *  unit saw; marks only when the uploader said the answers are marked; an
 *  item that starts on the next page is the next unit's; exactness against
 *  the page's PDF text (and the next page's) when it has one. mode "open"
 *  (an exam's open questions): open and numeric items only, each under an
 *  integer label, a question's parts folded into one open item. */
export function toSheetItems(
  raw: readonly SheetItem[],
  unit: {
    pages: number[];
    next: number | null;
    prev?: number | null;
    keySource?: string;
    mode?: "sheet" | "open";
    /** Each page's PDF lines, for the exactness check. */
    lines?: Readonly<Record<number, readonly string[]>>;
    solutionsFrom?: number;
  },
): { items: SheetSaveItem[]; rejected: number } {
  const marks = unit.keySource === "marked";
  const onPage = new Set([...unit.pages, ...(unit.next !== null ? [unit.next] : []), ...(unit.prev ? [unit.prev] : [])]);
  const out: SheetSaveItem[] = [];
  let rejected = 0;
  // The stem of a question with parts, from whichever part carries it.
  const stems = new Map<string, string>();
  for (const r of raw) {
    const parent = keepLines(r.parent ?? "");
    if (parent && keepLines(r.stem ?? "")) stems.set(labelKey(parent), keepLines(r.stem));
  }
  const parts = new Map<string, number>();
  for (const r of raw) {
    const parent = labelKey(keepLines(r.parent ?? ""));
    if (parent) parts.set(parent, (parts.get(parent) ?? 0) + 1);
  }
  for (const r of raw) {
    const label = keepLines(r.label ?? "").replace(/\n/g, " ");
    const form = (["one", "tf", "match", "open", "numeric"] as const).find((f) => f === r.form);
    const startsOn = int(r.page);
    if (!form || !label || label.length > SHEET_TEXT_MAX.label || !labelKey(label)) {
      rejected += 1;
      continue;
    }
    if (startsOn !== null && unit.next !== null && startsOn === unit.next && !unit.pages.includes(startsOn)) continue; // the next unit's
    if (unit.solutionsFrom && startsOn !== null && startsOn >= unit.solutionsFrom) continue; // a page of the sheet's own answers
    const own = startsOn !== null && unit.pages.includes(startsOn);
    const parentRaw = keepLines(r.parent ?? "").replace(/\n/g, " ");
    const parent = labelKey(parentRaw);
    const multi = !!parent && (parts.get(parent) ?? 0) >= 2 && int(r.part) !== null && (r.part as number) >= 1 && (r.part as number) <= 12;
    let q = cutVisible(keepLines(r.question ?? ""), SHEET_TEXT_MAX.question);
    let v = cutVisible(parent ? (stems.get(parent) ?? keepLines(r.stem ?? "")) : keepLines(r.stem ?? ""), SHEET_TEXT_MAX.vignette);
    const choice = form === "one" || form === "tf" || form === "match";
    const options = choice ? (r.options ?? []).map((o) => cutVisible(keepLines(String(o ?? "")), SHEET_TEXT_MAX.option)) : [];
    const prompts = form === "match" ? (r.prompts ?? []).map((p) => keepLines(String(p ?? "")).replace(/\n/g, " ")) : [];
    const maxOpts = form === "one" ? 10 : 6;
    if (
      q.text.length < 2 ||
      (choice && (options.length < 2 || options.length > maxOpts || options.some((o) => o.text.length < 1))) ||
      (form === "match" && (prompts.length < 2 || prompts.length > 6 || prompts.some((p) => p.length < 1 || p.length > SHEET_TEXT_MAX.prompt)))
    ) {
      rejected += 1;
      continue;
    }
    if (unit.mode === "open" && (form !== "open" && form !== "numeric")) continue; // a choice item is the exam reader's
    const figures = (r.figures ?? [])
      .flatMap((f) => {
        const fp = int(f.page);
        if (fp === null || fp <= 0 || !onPage.has(fp)) return [];
        const box = [f.x, f.y, f.w, f.h].map((x) => clampInt(Number(x) || 0, 0, 1000));
        return box[2] > 0 && box[3] > 0 ? [`pg:${fp}:${box.join(",")}`] : [];
      })
      .filter((f, k, a) => a.indexOf(f) === k)
      .slice(0, 4);
    const n = options.length;
    const ans = int(r.answer);
    const seq = (r.seq ?? []).map((x) => int(x));
    const seqOk =
      form === "tf"
        ? seq.length === n && seq.every((x) => x === 0 || x === 1)
        : form === "match"
          ? seq.length === prompts.length && seq.every((x) => x !== null && x >= 0 && x < n) && new Set(seq).size === seq.length
          : false;
    const page = own ? (startsOn as number) : unit.pages[0];
    const text = [v.text, q.text, ...options.map((o) => o.text), ...prompts].filter(Boolean).join("\n");
    const pageText = [...(unit.lines?.[page] ?? []), ...(unit.next !== null ? (unit.lines?.[unit.next] ?? []) : [])].join("\n");
    const anyCut = q.cut || v.cut || options.some((o) => o.cut);
    const item: SheetSaveItem = {
      label,
      ...(multi && unit.mode !== "open" ? { main: parentRaw, part: r.part as number } : {}),
      form,
      kind: v.text ? "case" : "mcq",
      vignette: v.text,
      question: q.text,
      options: options.map((o) => o.text),
      prompts,
      figures,
      answer: marks && form === "one" && ans !== null && ans >= 0 && ans < n ? ans : -1,
      seq: marks && seqOk ? (seq as number[]) : [],
      ...(marks && form === "numeric" && r.has_num && Number.isFinite(r.num) ? { num: r.num } : {}),
      ...(form === "numeric" && keepLines(r.unit_hint ?? "") ? { unit: keepLines(r.unit_hint).slice(0, 30) } : {}),
      marked_by: r.marked_by === "handwritten" || r.marked_by === "printed" ? r.marked_by : "none",
      parse_conf: anyCut ? 1 : clampInt(int(r.parse_conf) ?? 2, 1, 3),
      page,
      idx: clampInt(int(r.idx) ?? 0, 0, 99),
      exact: pageText.trim() ? Math.round(coverage(text, pageText) * 1000) / 1000 : null,
    };
    out.push(item);
  }
  if (unit.mode === "open") return { items: foldParts(out, raw), rejected };
  // Within the unit, a label copied twice from one page keeps its longer copy.
  const byKey = new Map<string, SheetSaveItem>();
  const size = (x: SheetSaveItem) => x.vignette.length + x.question.length + x.options.join("").length;
  for (const it of out) {
    const k = `${labelKey(it.label)}:${it.page}`;
    const had = byKey.get(k);
    if (!had || size(it) > size(had)) byKey.set(k, it);
  }
  return { items: [...byKey.values()].sort((a, b) => a.page - b.page || a.idx - b.idx), rejected };
}

/** A past exam's open questions (mode "open"): each under an integer label;
 *  a question with parts becomes one open item, its parts on their own
 *  lines with their letters. */
function foldParts(items: SheetSaveItem[], raw: readonly SheetItem[]): SheetSaveItem[] {
  const out = new Map<string, SheetSaveItem>();
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const r = raw.find((x) => keepLines(x.label ?? "").replace(/\n/g, " ") === it.label);
    const main = keepLines(r?.parent ?? "") || it.label;
    const no = /^\d{1,3}$/.exec(labelKey(main))?.[0];
    if (!no) continue;
    const had = out.get(no);
    if (!had) {
      out.set(no, { ...it, label: no, main: undefined, part: undefined, ...(it.label !== no ? { form: "open", num: undefined, unit: undefined, question: `${it.label.replace(no, "")}. ${it.question}` } : {}) });
    } else {
      had.form = "open";
      delete had.num;
      delete had.unit;
      had.question = `${had.question}\n${it.label.replace(no, "")}. ${it.question}`.slice(0, SHEET_TEXT_MAX.question);
      had.figures = [...new Set([...had.figures, ...it.figures])].slice(0, 4);
      had.parse_conf = Math.min(had.parse_conf, it.parse_conf);
    }
  }
  return [...out.values()].map((x) => {
    const { main: _m, part: _p, ...rest } = x;
    return rest as SheetSaveItem;
  });
}

/** An answers file's lines as study_sheet_save_keys takes them (pure): a
 *  label, and whatever the line gives: an answer index 0-9 or 2-6 values,
 *  a number with its unit and tolerance, an answer in words, a solution;
 *  a cancelled question; several answers (the first). */
export type SheetKeyRow = {
  label: string;
  answer: number;
  seq: number[];
  num?: number;
  unit?: string;
  tol?: number;
  answer_text?: string;
  solution?: string;
  state?: "cancelled" | "several";
};
export function toSheetKeyRows(raw: readonly SheetKey[]): SheetKeyRow[] {
  const out = new Map<string, SheetKeyRow>();
  for (const k of raw) {
    const label = keepLines(k.label ?? "").replace(/\n/g, " ");
    if (!label || label.length > SHEET_TEXT_MAX.label || !labelKey(label)) continue;
    if (k.state === "cancelled") {
      out.set(labelKey(label), { label, answer: -1, seq: [], state: "cancelled" });
      continue;
    }
    const ans = int(k.answer);
    const seq = (k.seq ?? []).map((x) => int(x));
    const row: SheetKeyRow = {
      label,
      answer: ans !== null && ans >= 0 && ans <= 9 ? ans : -1,
      seq: seq.length >= 2 && seq.length <= 6 && seq.every((x) => x !== null && x >= 0 && x <= 9) ? (seq as number[]) : [],
      ...(k.has_num && Number.isFinite(k.num) ? { num: k.num } : {}),
      ...(k.has_num && keepLines(k.unit ?? "") ? { unit: keepLines(k.unit).slice(0, 30) } : {}),
      ...(k.has_num && Number(k.tol) > 0 ? { tol: Math.min(50, Number(k.tol)) } : {}),
      ...(keepLines(k.answer_text ?? "") ? { answer_text: keepLines(k.answer_text).slice(0, 2000) } : {}),
      ...(keepLines(k.solution ?? "") ? { solution: cutVisible(keepLines(k.solution), 6000).text } : {}),
      ...(k.state === "several" && ans !== null && ans >= 0 ? { state: "several" as const } : {}),
    };
    if (row.answer < 0 && !row.seq.length && row.num === undefined && !row.answer_text && !row.solution) continue;
    out.set(labelKey(label), row);
  }
  return [...out.values()];
}

/** A solve unit's item as the claim gives it. */
export type SheetSolveItem = {
  id: string;
  no: number | null;
  form: string;
  vignette: string;
  question: string;
  options: string[];
  prompts: string[];
  label?: string;
  series?: string | null;
  step?: number | null;
  figures?: string[];
  page?: number | null;
  page_url?: string | null;
  page_path?: string | null;
  num_unit?: string | null;
};
/** A solve unit's answers as study_sheet_save_keys takes them (pure): only
 *  the items asked; a fitting answer for each form; a confidence 1-3; a
 *  numeric answer whose working does not give its number (calc.ts) is kept
 *  at confidence 1; a solution of at most 6,000 characters. */
export type SolvedRow = {
  id: string;
  answer: number;
  seq: number[];
  num?: number;
  unit?: string;
  tol?: number;
  model_answer?: string;
  rubric?: string[];
  solution?: string;
  conf: number;
};
export function toSolvedRows(asked: readonly SheetSolveItem[], raw: readonly SheetSolvedItem[]): SolvedRow[] {
  const out = new Map<string, SolvedRow>();
  for (const a of raw) {
    const ref = int(a.ref);
    const q = ref !== null && ref >= 1 ? asked[ref - 1] : undefined;
    let conf = int(a.conf);
    if (!q || conf === null || conf < 1 || conf > 3) continue;
    const n = q.options.length;
    const ans = int(a.answer);
    const seq = (a.seq ?? []).map((x) => int(x));
    const solution = keepLines(a.solution ?? "") ? cutVisible(keepLines(a.solution), 6000).text : undefined;
    let row: SolvedRow | null = null;
    if (q.form === "one") {
      if (ans !== null && ans >= 0 && ans < n) row = { id: q.id, answer: ans, seq: [], conf };
    } else if (q.form === "tf") {
      if (seq.length === n && seq.every((x) => x === 0 || x === 1)) row = { id: q.id, answer: -1, seq: seq as number[], conf };
    } else if (q.form === "match") {
      if (seq.length === q.prompts.length && seq.every((x) => x !== null && x >= 0 && x < n) && new Set(seq).size === seq.length)
        row = { id: q.id, answer: -1, seq: seq as number[], conf };
    } else if (q.form === "numeric") {
      if (a.has_num && Number.isFinite(a.num)) {
        const tol = Math.min(5, Math.max(0.5, Number(a.tol) || 1));
        if (!recompute(a.num, a.calc ?? { inputs: [], formula: "" }, tol).ok) conf = 1;
        row = { id: q.id, answer: -1, seq: [], num: a.num, unit: keepLines(a.unit ?? "").slice(0, 30) || q.num_unit || undefined, tol, conf };
      }
    } else if (q.form === "open") {
      const ma = keepLines(a.model_answer ?? "").slice(0, 2000);
      const rubric = (a.rubric ?? []).map((x) => keepLines(String(x ?? "")).slice(0, 300)).filter(Boolean).slice(0, 6);
      if (ma) row = { id: q.id, answer: -1, seq: [], model_answer: ma, rubric, conf };
    }
    if (!row) continue;
    if (solution) row.solution = solution;
    out.set(q.id, row);
  }
  return [...out.values()];
}

/* ── The unit's request ── */

export type SheetCall = {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: Record<string, unknown>;
  maxTokens: number;
  effort: Effort;
  inputChars: number;
  imageTokens: number;
  ref: "sheet_read" | "sheet_key" | "sheet_solve";
};

const schemaOf = (wrapper: Parameters<typeof zodOutputFormat>[0]) => cleanSchema(zodOutputFormat(wrapper).schema as Record<string, unknown>);
const picture = (url: string | null | undefined, path: string): Anthropic.Beta.BetaContentBlockParam | null =>
  url && figureOk(url, path) ? { type: "image", source: { type: "url", url } } : null;
const pageTokens = (p: Pick<ExamPage, "w" | "h">) => imageTokens(p.w, p.h);
/** A figure page's picture is about an A4 page at 1,500 px. */
const FIGURE_PAGE = { w: 1061, h: 1500 };

/** The items of a solve unit as the request numbers them (ref 1, 2…). */
export function solveInputs(items: readonly SheetSolveItem[]): SheetSolveInput[] {
  return items.map((q, k) => ({
    ref: k + 1,
    label: q.label || String(q.no ?? k + 1),
    form: q.form,
    vignette: q.vignette,
    question: q.question,
    options: q.options,
    prompts: q.prompts,
    unit: q.num_unit ?? null,
    figurePage: q.page_url && q.page_path && figureOk(q.page_url, q.page_path) ? (q.page ?? null) : null,
  }));
}

/** A sheet unit's request (exported for the tests): its cached system, the
 *  user turn and its sizes. Null: a page's link is missing or expired (a
 *  solve unit's figure page only drops the picture). */
export function sheetCall(c: ExamClaim): SheetCall | null {
  if (c.kind === "solve") {
    const items = (c.items ?? []) as SheetSolveItem[];
    const inputs = solveInputs(items);
    const text = sheetSolveRequest(inputs);
    const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text }];
    let tokens = 0;
    const seen = new Set<string>();
    for (const [k, q] of items.entries()) {
      if (!inputs[k].figurePage || !q.page_path || seen.has(q.page_path)) continue;
      const img = picture(q.page_url, q.page_path);
      if (!img) continue;
      seen.add(q.page_path);
      content.push({ type: "text", text: `Page ${q.page} (the figure of question ${inputs[k].label}):` }, img);
      tokens += pageTokens(FIGURE_PAGE);
    }
    return {
      system: SHEET_SOLVE_SYSTEM,
      content,
      schema: schemaOf(SheetSolved),
      maxTokens: solveTokens(items.length),
      effort: "medium",
      inputChars: SHEET_SOLVE_SYSTEM.length + text.length + seen.size * 60,
      imageTokens: tokens,
      ref: "sheet_solve",
    };
  }
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  let chars = 0;
  let tokens = 0;
  const lead =
    c.kind === "read"
      ? sheetReadRequest({
          pages: c.pages.map((p) => p.n),
          next: c.next?.n ?? null,
          prev: c.prev?.n ?? null,
          seen: (c.seen_labels ?? []).map((s) => ({ label: s.label, page: s.page ?? null })),
          keySource: c.exam.key_source,
          mode: c.reader === "open" ? "open" : "sheet",
        })
      : sheetKeyRequest(
          c.pages.map((p) => p.n),
          c.printed === true,
        );
  content.push({ type: "text", text: lead });
  chars += lead.length;
  const shown: Array<{ p: ExamPage; context: boolean | "before" }> = [
    ...(c.kind === "read" && c.prev ? [{ p: c.prev, context: "before" as const }] : []),
    ...c.pages.map((p) => ({ p, context: false })),
    ...(c.kind === "read" && c.next ? [{ p: c.next, context: true }] : []),
  ];
  for (const { p, context } of shown) {
    const img = picture(p.url, p.path);
    if (!img) return null;
    const label = sheetPageText(p.n, p.lines ?? [], context);
    content.push({ type: "text", text: label }, img);
    chars += label.length;
    tokens += pageTokens(p);
  }
  const system = c.kind === "read" ? SHEET_READ_SYSTEM : SHEET_KEY_SYSTEM;
  return {
    system,
    content,
    schema: schemaOf(c.kind === "read" ? SheetItems : SheetKeys),
    maxTokens: c.kind === "read" ? SHEET_READ_TOKENS : SHEET_KEY_TOKENS,
    effort: "low",
    inputChars: system.length + chars,
    imageTokens: tokens,
    ref: c.kind === "read" ? "sheet_read" : "sheet_key",
  };
}

/** The sheet prompts' lengths (shared/study/sheetPrice.ts pins them for the phone's price). */
export const sheetPrompts = () => ({ read: SHEET_READ_SYSTEM.length, key: SHEET_KEY_SYSTEM.length, solve: SHEET_SOLVE_SYSTEM.length });
