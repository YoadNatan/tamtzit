import { postStudy, sb } from "./api";
import type { Review, ReviewItem } from "./exams";
import type { SheetFormName, SolutionOrigin } from "./sheetPure";

export * from "./sheetPure";

/* ── Uploaded sheets, release A1: the data and the pure helpers (docs/study/sheets.md) ──
 *
 * VITE_STUDY_SHEETS_FORMS (flags.sheetForms), section O 2. The sheet reader
 * copies open questions, calculations, multi-part questions and tables as
 * printed; here are the member's RPCs O 2 adds (the review with what S's has
 * no place for, "לתקן את השאלה", "+ להוסיף שאלה שלא הועתקה", "להוציא את
 * השאלה", "לתקן תשובה" beyond a choice, a numeric answer checked at $0, an
 * open answer shown and self-marked, a worked solution after answering, the
 * member's own progress), the op's actions (open-add, resume after a budget
 * pause), and what the screens decide without the server (a typed number, a
 * printed table, a part's letter, the typed draft of an open answer kept on
 * the device). Nothing here is in the entry chunk. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error((error as { message?: string }).message || "unknown");
  return data as T;
}

export type SheetItem = ReviewItem;
export type SheetReview = Review;
export type Paused = NonNullable<Review["paused"]>;

/** The review of an upload with the sheet reader's fields (study_sheet_review). */
export async function sheetReview(examId: string): Promise<Review> {
  const r = await rpc<Review & { items_extra?: Record<string, Partial<ReviewItem>> }>("study_sheet_review", { p_exam: examId });
  const extra = r.items_extra ?? {};
  const items = (r.items ?? []).map((q) => {
    const x = extra[q.id] ?? {};
    return { ...q, ...x, label: x.label || String(q.no), figures: x.figures ?? (q.figure ? [q.figure] : []), form: x.form ?? q.form, rubric: x.rubric ?? [] } as ReviewItem;
  });
  const { items_extra: _drop, ...rest } = r;
  void _drop;
  return { ...rest, items, kind: r.kind === "sheet" ? "sheet" : "exam", reader: r.reader === "sheet" ? "sheet" : "exam", paused: r.paused ?? null, extra: r.extra ?? null, lecture: r.lecture ?? null };
}

/* ── Fixing an item (any member; logged) ── */

export type ItemPatch = { label?: string; form?: SheetFormName; vignette?: string; question?: string; options?: string[]; prompts?: string[]; figures?: string[] };
/** "לתקן את השאלה": once anyone answered or marked it, only its text (`answered`). */
export const itemFix = (questionId: string, patch: ItemPatch) => rpc<Record<string, unknown>>("study_exam_item_fix", { p_question: questionId, p_patch: patch });
/** "+ להוסיף שאלה שלא הועתקה": after its page's last item. Returns its id. */
export const itemAdd = (examId: string, item: ItemPatch & { label: string; form: SheetFormName; question: string; page: number }) =>
  rpc<string>("study_exam_item_add", { p_exam: examId, p_item: item });
/** "להוציא את השאלה" and its undo (by whoever took it out, or anyone within 24 hours). */
export const itemRetire = (questionId: string, note = "") => rpc<null>("study_exam_item_retire", { p_question: questionId, p_note: note });
export const itemUnretire = (questionId: string) => rpc<null>("study_exam_item_unretire", { p_question: questionId });

export type SolutionPatch = { num?: number; num_unit?: string; num_tol?: number; model_answer?: string; rubric?: string[]; solution?: string };
/** "לתקן תשובה" beyond a choice: a number with its unit and tolerance, a model answer and rubric, a worked solution. */
export const itemSolution = (questionId: string, patch: SolutionPatch) => rpc<Record<string, unknown>>("study_item_solution", { p_question: questionId, p_patch: patch });

/* ── Practice ── */

export type ValueResult = { correct: boolean; num: number; unit: string | null; tol: number; solution: string | null; origin: SolutionOrigin; conf: number | null; solution_origin: SolutionOrigin };
/** A numeric answer, checked at $0 within the item's tolerance (null: "לא יודעים"). */
export const answerValue = (questionId: string, value: number | null, mode: string, ms: number) =>
  rpc<ValueResult>("study_answer_value", { p_question: questionId, p_value: value, p_mode: mode, p_ms: Math.max(0, Math.round(ms)) });
export type OpenShown = { model_answer: string | null; rubric: string[]; solution: string | null; origin: SolutionOrigin; conf: number | null; solution_origin: SolutionOrigin };
/** "להראות פתרון": the model answer, its rubric and the worked solution (a row in the member's own marks). */
export const openShow = (questionId: string) => rpc<OpenShown>("study_open_show", { p_question: questionId });
/** "איך הלך?": 0 טעיתי · 1 חלקית · 2 צדקתי. */
export const openMark = (questionId: string, mark: 0 | 1 | 2) => rpc<null>("study_open_mark", { p_question: questionId, p_mark: mark });
export type Solution = {
  solution: string | null;
  solution_origin: SolutionOrigin;
  solution_conf: number | null;
  answer: number | null;
  seq: number[] | null;
  num: number | null;
  num_unit: string | null;
  num_tol: number | null;
  model_answer: string | null;
  rubric: string[];
  origin: SolutionOrigin;
  conf: number | null;
};
/** "פתרון מלא": once the member answered the item (null before). */
export const questionSolution = (questionId: string) => rpc<Solution | null>("study_question_solution", { p_question: questionId });
export type Progress = { items: number; open: number; answered: number; right: number; shown: number; self: { right: number; partly: number; wrong: number } };
/** The member's own counts on an upload. */
export const sheetProgress = (examId: string) => rpc<Progress>("study_sheet_progress", { p_exam: examId });

/* ── The op's actions (the budget's gates) ── */

async function op<T>(body: Record<string, unknown>): Promise<T> {
  const res = await postStudy("/api/study/ai", { op: "exam_read", ...body });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* not json */
    }
    throw new Error(code);
  }
  return (await res.json()) as T;
}
/** "להעתיק גם N שאלות פתוחות · כ-$…": dry gives the button's price only. */
export const openAdd = (examId: string, o: { dry: true } | { dry?: false; urls: Record<string, string>; until: string }) =>
  op<{ units: number; pages?: number; skipped?: number; priceUsd: number }>({ action: "open_add", examId, ...o });
/** "להמשיך" / "לסיים בלי תשובות מוצעות" after a budget pause (D23). */
export const sheetResume = (examId: string, skipSolve: boolean) => op<{ read: number; key: number; solve: number; skipped: number }>({ action: "resume", examId, skipSolve });

/** A session's uploaded items (release A1): where each key came from, the uploads' titles, and each
 *  item's printed label and a numeric item's unit (the review's, as lib/exams.ts keyOrigins reads it). */
export async function sheetInfo(examIds: string[]): Promise<{
  origins: Map<string, { origin: "exam" | "sheet" | "solved" | "member" | null; conf: number | null }>;
  titles: Record<string, string>;
  extras: Record<string, { label: string; unit: string | null }>;
}> {
  const origins = new Map<string, { origin: "exam" | "sheet" | "solved" | "member" | null; conf: number | null }>();
  const titles: Record<string, string> = {};
  const extras: Record<string, { label: string; unit: string | null }> = {};
  for (const id of [...new Set(examIds)].slice(0, 12)) {
    const r = await sheetReview(id);
    titles[id] = r.exam.title;
    for (const q of r.items) {
      origins.set(q.id, { origin: q.origin, conf: q.conf });
      extras[q.id] = { label: q.label ?? String(q.no), unit: q.num_unit ?? null };
    }
  }
  return { origins, titles, extras };
}
