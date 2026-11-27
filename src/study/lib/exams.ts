import { postStudy, sb } from "./api";
import type { ExamPageFile } from "./examPages";
import type { PublicQuestion } from "./practice";
import { qColumns } from "./questionColumns";
import { flags as appFlags } from "./flags";

/* ── Past exams and simulations: the data (sources.md B2, B6, B7; section S 2) ──
 *
 * An exam is made in its course (study_exam_create), its pages uploaded to
 * <group>/exams/<exam>/p<n>.jpg (3 at a time), signed for 48 hours and handed
 * to the server with op exam_read, which checks the budget and the 3 a day and
 * queues the reading. The server copies the questions while the phone may be
 * closed; the screens follow study_exam_status, then review with
 * study_exam_review (fixes, keys, the key log and its undo). A simulation
 * (study_mocks, kind 'exam' in phase 2) runs against one clock that lives on
 * the server (the attempt's deadline): the phone counts down from the
 * server's own now, so a phone locked for 5 minutes comes back to the same
 * deadline, and the server submits a late attempt itself.
 *
 * Every wrapper throws Error(code) with the server's code (failText(code,
 * "exam")). Nothing here is in the entry chunk: the screens load it. The
 * pure helpers below are what the screens say, tested in exams.test.ts. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) fail(error);
  return data as T;
}

/* ── Types (the RPCs' JSON) ── */

export type KeySource = "marked" | "separate" | "none";
export type ExamState = "new" | "uploading" | "reading" | "linking" | "ready" | "failed";
export type UnitRow = { kind: "read" | "key" | "solve" | string; pages: number[] | null; items: number; status: "pending" | "running" | "done" | "failed"; error: string | null; reread: boolean };
export type ExamStatus = {
  id: string;
  title: string;
  year: number | null;
  moed: string | null;
  minutes: number | null;
  key_source: KeySource | "unknown";
  status: ExamState;
  error: string | null;
  skipped_open: number;
  hidden: boolean;
  pages: number;
  key_pages: number;
  units: UnitRow[];
  found: number;
  keyed: number;
  suggested: number;
  unkeyed: number;
  unclear: number;
  /** Numbers another page had already: not saved (an exam whose parts restart at 1, a misread number). */
  repeats?: number;
  /** Items the key sheet says were cancelled ("בוטלה"): left out. */
  cancelled?: number;
};
export type KeyOrigin = "exam" | "sheet" | "solved" | "member";
export type ReviewItem = {
  id: string;
  no: number;
  kind: "mcq" | "case";
  /** open and numeric: an uploaded sheet's, read by the sheet reader (section O 2, release A1). */
  form: "one" | "tf" | "match" | "open" | "numeric";
  vignette: string;
  question: string;
  options: string[];
  prompts: string[];
  figure: string;
  page: number | null;
  parse_conf: number | null;
  retired: boolean;
  answer: number | null;
  seq: number[] | null;
  origin: KeyOrigin | null;
  conf: number | null;
  key_by: string | null;
  fixed: boolean;
  /** Someone answered it: a page read again keeps its text, as a fix does. */
  answered?: boolean;
  /* Uploaded sheets, release A1 (study_sheet_review, section O 2): the printed label, the
   * figure boxes, the copy's exactness, a multi-part question's series and step, a numeric
   * item's number, unit and tolerance, an open item's model answer and rubric, the worked
   * solution and where it came from, who took the item out, whether anyone answered or
   * self-marked it (locked: only its text may change). Absent from S's review. */
  label?: string;
  figures?: string[];
  exact?: number | null;
  series?: string | null;
  step?: number | null;
  retired_by?: string | null;
  retired_at?: string | null;
  num?: number | null;
  num_unit?: string | null;
  num_tol?: number | null;
  model_answer?: string | null;
  rubric?: string[];
  solution?: string | null;
  solution_origin?: KeyOrigin | null;
  solution_conf?: number | null;
  locked?: boolean;
};
export type ReviewPage = { n: number; path: string; w: number; h: number; key: boolean };
export type KeyLog = { id: number; question_id: string; old: number | null; new: number | null; origin_old: string | null; origin_new: string | null; undo_of: number | null; by: string | null; at: string };
export type ItemLog = { id: number; question_id: string; field: string; idx: number | null; old: string; new: string; by: string | null; at: string };
export type Review = {
  exam: { id: string; title: string; status: ExamState; key_source: string; hidden: boolean; by?: string | null };
  pages: ReviewPage[];
  items: ReviewItem[];
  key_log: KeyLog[];
  item_log: ItemLog[];
  /* Uploaded sheets, release A1 (study_sheet_review): the kind and lecture, who reads its units
   * (the sheet reader or the exam reader), the units the budget held (design D23), open-add's progress. */
  kind?: "exam" | "sheet";
  lecture?: { id: string; title: string } | null;
  reader?: "sheet" | "exam";
  skipped_open?: number;
  paused?: { read: number; key: number; solve: number } | null;
  extra?: { units: number; done: number; copied: number } | null;
};
/** A course's exam as its page lists it (study_course_overview at S 2). */
export type CourseExam = {
  id: string;
  title: string;
  year: number | null;
  status: string;
  moed?: string | null;
  minutes?: number | null;
  key_source?: string | null;
  hidden?: boolean;
  created_at?: string;
  questions?: number;
  /** All the exam printed as far as its reading knows (items, open questions skipped, numbers not saved): the clock's pace. */
  printed?: number;
  /** Section O 1: a past exam or an uploaded sheet (absent before O 1: a past exam), and its one lecture. */
  kind?: "exam" | "sheet";
  lecture_id?: string | null;
};

/* ── The upload ── */

/** "העלאת מבחן קודם": the exam's row; its pages go to `${prefix}p<n>.jpg`. */
export async function examCreate(courseId: string, meta: { year: string; moed: string; keySource: KeySource; minutes: string }): Promise<{ exam_id: string; prefix: string }> {
  return rpc("study_exam_create", { p_course: courseId, p_meta: { year: meta.year.trim(), moed: meta.moed.trim(), key_source: meta.keySource, minutes: meta.minutes.trim() } });
}

/** The pages as the server takes them: numbered from 1 in order, the key file's after the exam's. */
export function pageRows(prefix: string, pages: ReadonlyArray<Pick<ExamPageFile, "w" | "h" | "lines" | "key">>) {
  return pages.map((p, i) => ({ n: i + 1, path: `${prefix}p${i + 1}.jpg`, w: p.w, h: p.h, lines: p.lines, key: p.key }));
}

/** Uploads the pages, 3 at a time; onProgress(done, total). */
export async function uploadExamPages(prefix: string, pages: ReadonlyArray<ExamPageFile>, onProgress: (done: number, total: number) => void): Promise<void> {
  const c = client();
  const rows = pageRows(prefix, pages);
  const queue = rows.map((r, i) => ({ r, blob: pages[i].blob }));
  let done = 0;
  const workers = Array.from({ length: 3 }, async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      const up = await c.storage.from("study").upload(x.r.path, x.blob, { contentType: "image/jpeg", upsert: true });
      if (up.error) throw up.error;
      onProgress(++done, rows.length);
    }
  });
  await Promise.all(workers);
}

/** The pages' links for the worker, 48 hours (the worker has no Storage access of its own). */
export const LINK_HOURS = 48;
export async function signPages(paths: string[]): Promise<{ urls: Record<string, string>; until: string }> {
  const { data, error } = await client().storage.from("study").createSignedUrls(paths, LINK_HOURS * 3600);
  if (error) fail(error);
  const urls: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  if (Object.keys(urls).length !== paths.length) throw new Error("bad urls");
  // A little earlier than the links themselves: the server never hands out a link about to expire.
  return { urls, until: new Date(Date.now() + (LINK_HOURS - 1) * 3600_000).toISOString() };
}

async function refusal(res: Response): Promise<Error> {
  let code = `http_${res.status}`;
  try {
    code = ((await res.json()) as { error?: string }).error ?? code;
  } catch {
    /* not json */
  }
  return new Error(code);
}

/** Op exam_read: the budget's gate and the 3 a day, then the units are queued. server false: the phone drives them. */
export async function examReadStart(examId: string, pages: ReturnType<typeof pageRows>, urls: Record<string, string>, until: string): Promise<{ units: number; server: boolean; priceUsd: number }> {
  const res = await postStudy("/api/study/ai", { op: "exam_read", examId, pages, urls, until });
  if (!res.ok) throw await refusal(res);
  return (await res.json()) as { units: number; server: boolean; priceUsd: number };
}

/** One unit run from the phone (no pg_net on the server). */
export async function examUnit(examId: string): Promise<{ claimed: boolean; status: string | null; kind?: string; error?: string | null }> {
  const res = await postStudy("/api/study/ai", { op: "exam_read", action: "unit", examId });
  if (!res.ok) throw await refusal(res);
  return (await res.json()) as { claimed: boolean; status: string | null };
}

/* ── Reading and review ── */

export const examStatus = (examId: string) => rpc<ExamStatus>("study_exam_status", { p_exam: examId });
export const examReview = (examId: string) => rpc<Review>("study_exam_review", { p_exam: examId });
export const examItemEdit = (questionId: string, field: "question" | "vignette" | "option" | "prompt", idx: number | null, text: string) =>
  rpc<null>("study_exam_item_edit", { p_question: questionId, p_field: field, p_idx: idx, p_text: text });
/** "לאשר" (the suggested answer) or "לסמן תשובה אחרת": the stored index, logged. */
export const setExamKey = (questionId: string, answer: number | null) => rpc<null>("study_set_exam_key", { p_question: questionId, p_answer: answer });
/** "לאשר" a true/false or match item's suggested answer (set items are not keyed by hand). */
export const examKeyConfirm = (questionId: string) => rpc<null>("study_exam_key_confirm", { p_question: questionId });
export const examKeyUndo = (questionId: string) => rpc<{ answer: number | null; origin: string | null }>("study_exam_key_undo", { p_question: questionId });
export const examHide = (examId: string, hide: boolean) => rpc<null>("study_exam_hide", { p_exam: examId, p_hide: hide });

/** "לנסות שוב" (pages null: every unit that failed) or "לקרוא שוב את עמוד 7", with fresh links to every page. */
export async function examRetry(examId: string, pagePaths: string[], pages: number[] | null): Promise<number> {
  const { urls, until } = await signPages(pagePaths);
  return rpc<number>("study_exam_retry", { p_exam: examId, p_pages: pages, p_urls: urls, p_until: until });
}

/** A page's picture, signed for 6 hours (the review's crops). */
export async function pageUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data } = await client().storage.from("study").createSignedUrls(paths, 6 * 3600);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

/* ── Simulations ── */

export type MockAttempt = {
  attempt: string;
  mock: string;
  kind: string;
  exam_id: string | null;
  course_id: string | null;
  minutes: number;
  started_at: string;
  deadline: string;
  now: string;
  finished_at: string | null;
  position: number;
  flagged: number[];
  question_ids: string[];
  picks: Record<string, { c?: number; cs?: number[]; ms?: number }>;
  score: MockScore | null;
};
export type MockScoreItem = {
  id: string;
  pos: number;
  no: number | null;
  form: string;
  answer: number | null;
  seq: number[] | null;
  choice: number | null;
  choices: number[] | null;
  correct: boolean;
  counted: boolean;
  origin: KeyOrigin | null;
  ref_lecture: string | null;
  topic: string | null;
};
export type MockScore = { right: number; counted: number; total: number; answered: number; suggested: number; not_counted: number; auto: boolean; items: MockScoreItem[] };

export const mockCreate = (o: { courseId: string; examId: string; n: number | null; minutes: number | null; unseenOnly: boolean }) =>
  rpc<{ mock: string; questions: number; minutes: number; pool: number; missing: unknown[] }>("study_mock_create", {
    p_course: o.courseId,
    p_kind: "exam",
    p_exam: o.examId,
    p_n: o.n,
    p_minutes: o.minutes,
    p_unseen_only: o.unseenOnly,
  });
export const mockStart = (mockId: string) => rpc<MockAttempt>("study_mock_start", { p_mock: mockId });
export const mockGet = (attemptId: string) => rpc<MockAttempt>("study_mock_get", { p_attempt: attemptId });
export const mockProgress = (attemptId: string, position: number, flagged: number[]) => rpc<boolean>("study_mock_progress", { p_attempt: attemptId, p_position: position, p_flagged: flagged });
/** A pick (choice: a one-answer item; choices: a set item; both null clears it). False once the time is up. */
export const mockAnswer = (attemptId: string, questionId: string, choice: number | null, choices: number[] | null, ms: number | null) =>
  rpc<boolean>("study_mock_answer", { p_attempt: attemptId, p_question: questionId, p_choice: choice, p_choices: choices, p_ms: ms });
export const mockFinish = (attemptId: string) => rpc<MockScore>("study_mock_finish", { p_attempt: attemptId });

/* ── Words (pure) ── */

/** An option's letter: א ב ג ד ה ו. */
export const LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"];
export const letter = (i: number | null | undefined): string => (i !== null && i !== undefined && i >= 0 ? `${LETTERS[i] ?? String(i + 1)}׳` : "");

/** "מועד א׳ 2025" from the form. */
export function examTitle(year: string, moed: string): string {
  const y = year.trim();
  const m = moed.trim();
  return m ? `מועד ${m}${y ? ` ${y}` : ""}` : y ? `מבחן ${y}` : "מבחן קודם";
}

/** "100 שאלות · 3 שעות" of an exam (its questions found and its minutes), or "". */
export function examLengthLine(e: { found?: number; questions?: number; minutes?: number | null }): string {
  const n = e.found ?? e.questions ?? 0;
  return [...(n ? [n === 1 ? "שאלה אחת" : `${n} שאלות`] : []), ...(e.minutes ? [minutesText(e.minutes)] : [])].join(" · ");
}

/** "עמודים 9–12", or "עמוד 7". The range is isolated left to right (U+2066…U+2069),
 *  so a right-to-left line never shows it as "12–9". */
export function pagesText(pages: readonly number[]): string {
  if (!pages.length) return "";
  const a = Math.min(...pages);
  const b = Math.max(...pages);
  return a === b ? `עמוד ${a}` : `עמודים \u2066${a}–${b}\u2069`;
}

/** The reading's rows (mockup exam-reading.html): each read unit's pages in
 *  page order (a page read again is its own row), then the key sheet, then
 *  the suggested answers. */
export type UnitLine = { key: string; title: string; state: UnitRow["status"]; error: string | null; pages: number[]; kind: string };
export function unitLines(units: readonly UnitRow[]): UnitLine[] {
  const reads = units.filter((u) => u.kind === "read").map((u, i) => ({ u, i }));
  reads.sort((a, b) => (a.u.pages?.[0] ?? 0) - (b.u.pages?.[0] ?? 0) || a.i - b.i);
  const out: UnitLine[] = reads.map(({ u, i }) => ({ key: `r${i}`, title: pagesText(u.pages ?? []), state: u.status, error: u.error, pages: u.pages ?? [], kind: "read" }));
  units
    .filter((u) => u.kind === "key")
    .forEach((u, i) => out.push({ key: `k${i}`, title: "דף התשובות", state: u.status, error: u.error, pages: u.pages ?? [], kind: "key" }));
  const solve = units.filter((u) => u.kind === "solve");
  if (solve.length) {
    const items = solve.reduce((n, u) => n + u.items, 0);
    const state: UnitRow["status"] = solve.some((u) => u.status === "running")
      ? "running"
      : solve.some((u) => u.status === "pending")
        ? "pending"
        : solve.some((u) => u.status === "failed")
          ? "failed"
          : "done";
    out.push({ key: "s", title: items === 1 ? "תשובה מוצעת לשאלה אחת" : `תשובות מוצעות ל-${items} שאלות`, state, error: solve.find((u) => u.error)?.error ?? null, pages: [], kind: "solve" });
  }
  return out;
}

/** "מעתיקים עמודים 9–12 מתוך 28…" while a unit reads; "עמודים 1–4 בתור…" while
 *  the first waits its turn; "מציעים תשובות…" while solving; "" when nothing runs. */
export function readingLine(s: Pick<ExamStatus, "units" | "pages">): string {
  const reads = s.units.filter((u) => u.kind === "read");
  const live = reads.find((u) => u.status === "running");
  if (live) return `מעתיקים ${pagesText(live.pages ?? [])} מתוך ${s.pages}…`;
  const running = (kind: string) => s.units.some((u) => u.kind === kind && u.status === "running");
  if (running("key")) return "קוראים את דף התשובות…";
  if (running("solve")) return "מציעים תשובות לשאלות בלי תשובה…";
  // Nothing runs yet: what waits its turn, not "copying".
  const waiting = reads.find((u) => u.status === "pending");
  if (waiting) return `${pagesText(waiting.pages ?? [])} בתור…`;
  if (s.units.some((u) => u.kind === "key" && u.status === "pending")) return "דף התשובות בתור…";
  if (s.units.some((u) => u.kind === "solve" && u.status === "pending")) return "מציעים תשובות לשאלות בלי תשובה…";
  return "";
}

/** How far the reading is (0-100): the units done of all. */
export function readingPercent(units: readonly UnitRow[]): number {
  if (!units.length) return 0;
  return Math.round((100 * units.filter((u) => u.status === "done" || u.status === "failed").length) / units.length);
}

/** Where an item stands in the review: badly read, a suggested key, no key at all, or keyed. */
export type ItemState = "unclear" | "suggested" | "nokey" | "ok";
export function itemState(q: Pick<ReviewItem, "parse_conf" | "origin" | "answer" | "seq"> & Partial<Pick<ReviewItem, "form" | "num" | "model_answer">>): ItemState {
  if (q.parse_conf === 1) return "unclear";
  // A numeric item is keyed by its number, an open one by its model answer (study_private.exam_unkeyed, O 2).
  const keyed =
    q.form === "numeric" ? q.num !== null && q.num !== undefined : q.form === "open" ? Boolean(q.model_answer) : q.answer !== null || (q.seq !== null && q.seq.length > 0);
  if (!keyed) return "nokey";
  if (q.origin === "solved") return "suggested";
  return "ok";
}
/** An item needs a look ("לבדיקה"): anything but a key from the exam, its sheet or a member, read well. */
export const needsLook = (q: Parameters<typeof itemState>[0]) => itemState(q) !== "ok";

/** The review's numbers: found, with an answer (the exam's, the sheet's or a member's), to check, suggested. */
export function reviewCounts(items: ReadonlyArray<Parameters<typeof itemState>[0] & Pick<ReviewItem, "retired">>) {
  const live = items.filter((q) => !q.retired);
  const look = live.filter(needsLook).length;
  return {
    found: live.length,
    withAnswer: live.length - look,
    toCheck: look,
    suggested: live.filter((q) => itemState(q) === "suggested").length,
    nokey: live.filter((q) => itemState(q) === "nokey").length,
    unclear: live.filter((q) => itemState(q) === "unclear").length,
  };
}

/** "נמצאו 98 שאלות · 91 עם תשובה · 7 לבדיקה" (one: "נמצאה שאלה אחת"). */
export function foundLine(c: { found: number; withAnswer: number; toCheck: number }): string {
  const found = c.found === 1 ? "נמצאה שאלה אחת" : `נמצאו ${c.found} שאלות`;
  return [found, `${c.withAnswer} עם תשובה`, ...(c.toCheck ? [`${c.toCheck} לבדיקה`] : [])].join(" · ");
}

/** "3 שאלות לא נשמרו: המספר שלהן כבר הופיע בעמוד אחר." (one: "שאלה אחת לא נשמרה…"), or "". */
export function repeatsLine(n: number | undefined): string {
  if (!n) return "";
  return n === 1 ? "שאלה אחת לא נשמרה: המספר שלה כבר הופיע בעמוד אחר." : `${n} שאלות לא נשמרו: המספר שלהן כבר הופיע בעמוד אחר.`;
}
/** "2 שאלות בוטלו לפי דף התשובות, ולא נכללות." (one: "שאלה אחת בוטלה…"), or "". */
export function cancelledLine(n: number | undefined): string {
  if (!n) return "";
  return n === 1 ? "שאלה אחת בוטלה לפי דף התשובות, ולא נכללת." : `${n} שאלות בוטלו לפי דף התשובות, ולא נכללות.`;
}

/** "2 שאלות פתוחות דולגו." (one: "שאלה פתוחה אחת דולגה."), or "". */
export function skippedLine(n: number): string {
  if (!n) return "";
  return n === 1 ? "שאלה פתוחה אחת דולגה." : `${n} שאלות פתוחות דולגו.`;
}

/** An exam item's page box: pg:<page>:<x>,<y>,<w>,<h> in thousandths of the page. */
export type PageBox = { page: number; x: number; y: number; w: number; h: number };
export function parsePageBox(figure: string | null | undefined): PageBox | null {
  const m = /^pg:(\d{1,3}):(\d{1,4}),(\d{1,4}),(\d{1,4}),(\d{1,4})$/.exec(figure ?? "");
  if (!m) return null;
  const [page, x, y, w, h] = m.slice(1).map(Number);
  if (!(page >= 1 && w > 0 && h > 0 && x + w <= 1000 && y + h <= 1000)) return null;
  return { page, x, y, w, h };
}

/** The CSS of a crop: the frame's aspect ratio and where the page's picture
 *  sits in it (percentages of the frame), so the box fills the frame. */
export function cropStyle(box: Omit<PageBox, "page">, page: { w: number; h: number }) {
  return {
    ratio: `${Math.max(1, Math.round(page.w * box.w))} / ${Math.max(1, Math.round(page.h * box.h))}`,
    width: `${(1000 / box.w) * 100}%`,
    left: `${(-box.x / box.w) * 100}%`,
    top: `${(-box.y / box.h) * 100}%`,
  };
}

/** "סומנה ע״י נועה: ג׳" (a member's key; "אושרה" when the member confirmed the suggested one), or "". */
export function keyByLine(q: Pick<ReviewItem, "origin" | "key_by" | "answer"> & { seq?: number[] | null }, confirmed = false): string {
  if (q.origin !== "member") return "";
  const who = `${confirmed ? "אושרה" : "סומנה"} ע״י ${q.key_by || "מישהו מהקבוצה"}`;
  if (q.answer !== null) return `${who}: ${letter(q.answer)}`;
  // A true/false or match item keyed by hand (uploaded sheets, section O 1): who, without the statements.
  return q.seq?.length ? who : "";
}

/** The item's standing key is a confirmation of the suggested answer (its last change not undone kept the same key). */
export function wasConfirmed(log: readonly KeyLog[], questionId: string): boolean {
  const l = lastUndoable(log, questionId);
  return Boolean(l && l.old === l.new && l.origin_old === "solved");
}

/** "6 שאלות בלי תשובה לא נכנסות לתרגול עד שמסמנים להן תשובה." (a session asks only keyed items), or "". */
export function unkeyedLine(
  items: ReadonlyArray<Pick<ReviewItem, "answer" | "seq" | "retired"> & Partial<Pick<ReviewItem, "form" | "num" | "model_answer">>>,
): string {
  // itemState's rule: a numeric item is keyed by its number, an open one by its model answer.
  const n = items.filter((q) => !q.retired && itemState({ parse_conf: 3, origin: null, ...q }) === "nokey").length;
  if (!n) return "";
  return n === 1 ? "שאלה אחת בלי תשובה לא נכנסת לתרגול עד שמסמנים לה תשובה." : `${n} שאלות בלי תשובה לא נכנסות לתרגול עד שמסמנים להן תשובה.`;
}

/** The last change of an item's key that can still be undone (the log's newest not undone). */
export function lastUndoable(log: readonly KeyLog[], questionId: string): KeyLog | null {
  const undone = new Set(log.filter((l) => l.undo_of !== null).map((l) => l.undo_of));
  const own = log.filter((l) => l.question_id === questionId && l.undo_of === null && !undone.has(l.id));
  return own.length ? own[own.length - 1] : null;
}

/* ── The simulation's length and clock (pure) ── */

export type Length = { key: "short" | "half" | "full"; label: string; n: number; minutes: number };

/** Minutes for n questions: the exam's own pace, else the course's, else 1.8 a question (study_mock_create's rule). */
export function minutesFor(n: number, pace: { minutes?: number | null; questions?: number | null }, course?: { exam_minutes: number | null; exam_n: number | null }): number {
  if (pace.minutes && pace.questions) return Math.max(1, Math.ceil((pace.minutes * n) / pace.questions));
  if (course?.exam_minutes && course.exam_n) return Math.max(1, Math.ceil((course.exam_minutes * n) / course.exam_n));
  return Math.max(1, Math.ceil(n * 1.8));
}

/** The lengths offered, short first (decision 4): קצר 20, חצי 50, מלא (the
 *  whole exam, at most 150). A length the exam cannot fill is left out. */
export function lengthsFor(exam: { questions: number; minutes: number | null; printed?: number }, course?: { exam_minutes: number | null; exam_n: number | null }): Length[] {
  const pool = Math.min(150, Math.max(0, exam.questions));
  if (pool < 5) return [];
  // The exam's minutes were for everything it printed (open questions and items not saved too): study_mock_create's pace.
  const printed = Math.max(exam.questions, exam.printed ?? 0);
  const pace = { minutes: exam.minutes, questions: printed };
  const out: Length[] = [];
  if (pool > 20) out.push({ key: "short", label: "קצר", n: 20, minutes: minutesFor(20, pace, course) });
  if (pool > 50) out.push({ key: "half", label: "חצי", n: 50, minutes: minutesFor(50, pace, course) });
  out.push({ key: "full", label: "מלא", n: pool, minutes: exam.minutes && pool === printed ? exam.minutes : minutesFor(pool, pace, course) });
  return out;
}

/** Why the whole simulation's minutes are not the exam's own ("30 דקות" on the exam, "26 דקות" for מלא):
 *  "26 דקות למלא: הקצב של המבחן, בלי 2 השאלות שלא נכנסו לסימולציה.", or "" when they are the same. */
export function paceLine(exam: { questions: number; minutes: number | null; printed?: number }, lengths: readonly Length[]): string {
  const full = lengths.find((l) => l.key === "full");
  if (!full || !exam.minutes || full.minutes === exam.minutes) return "";
  const left = Math.max(exam.questions, exam.printed ?? 0) - full.n;
  if (left <= 0) return "";
  return `${minutesText(full.minutes)} למלא: הקצב של המבחן, בלי ${left === 1 ? "השאלה שלא נכנסה" : `${left} השאלות שלא נכנסו`} לסימולציה.`;
}

/** "36 דקות", "90 דקות", "שעה", "שעתיים", "3 שעות" (whole hours in hours, the rest in minutes, as the mockups). */
export function minutesText(m: number): string {
  if (m === 1) return "דקה";
  if (m === 60) return "שעה";
  if (m === 120) return "שעתיים";
  if (m > 120 && m % 60 === 0) return `${m / 60} שעות`;
  return `${m} דקות`;
}

/** The clock: what is left of the deadline, counted from the server's own now
 *  (the phone's clock may be off) plus the time since that answer came. */
export function remainingMs(o: { deadline: string; serverNow: string; fetchedAt: number; now: number }): number {
  const offset = Date.parse(o.serverNow) - o.fetchedAt;
  return Math.max(0, Date.parse(o.deadline) - (o.now + offset));
}

/** "1:42:10" (hours, minutes, seconds; under an hour "0:14:05"). */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
/** The clock in words for a screen reader: "נשארו שעה ו-42 דקות". */
export function clockWords(ms: number): string {
  const m = Math.ceil(ms / 60_000);
  if (m <= 1) return "נשארה פחות מדקה";
  const h = Math.floor(m / 60);
  const r = m % 60;
  const hours = h === 0 ? "" : h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
  const mins = r === 0 ? "" : r === 1 ? "דקה" : `${r} דקות`;
  return `נשארו ${[hours, mins].filter(Boolean).join(" ו-")}`;
}

/** A pick is there: a one-answer item's choice, or every element of a set item's. */
export function picked(p: { c?: number; cs?: number[] } | undefined): boolean {
  return Boolean(p && (typeof p.c === "number" || (Array.isArray(p.cs) && p.cs.length > 0)));
}

/** The grid's cells (mockup sim-grid.html): answered, flagged ("לחזרה"), empty. */
export function gridCells(a: Pick<MockAttempt, "question_ids" | "picks" | "flagged">): Array<{ i: number; answered: boolean; flagged: boolean }> {
  const flags = new Set(a.flagged);
  return a.question_ids.map((id, i) => ({ i, answered: picked(a.picks[id]), flagged: flags.has(i) }));
}

/** "להגיש עכשיו? נשארו 6 שאלות בלי תשובה." */
export function submitLine(empty: number): string {
  if (!empty) return "להגיש עכשיו?";
  return empty === 1 ? "להגיש עכשיו? נשארה שאלה אחת בלי תשובה." : `להגיש עכשיו? נשארו ${empty} שאלות בלי תשובה.`;
}

/** The result's head: "71 מתוך 97", and "3 לא נספרו: אין להן תשובה בטוחה · 3 מה-97 נבדקו מול תשובה מוצעת"
 *  (the suggested ones are among the counted; the not counted are outside them). */
export function scoreLines(s: Pick<MockScore, "right" | "counted" | "suggested" | "not_counted">): { big: string; note: string } {
  const parts: string[] = [];
  if (s.not_counted) parts.push(s.not_counted === 1 ? "שאלה אחת לא נספרה: אין לה תשובה בטוחה" : `${s.not_counted} לא נספרו: אין להן תשובה בטוחה`);
  if (s.suggested) parts.push(s.suggested === 1 ? `אחת מה-${s.counted} נבדקה מול תשובה מוצעת` : `${s.suggested} מה-${s.counted} נבדקו מול תשובה מוצעת`);
  return { big: `${s.right} מתוך ${s.counted}`, note: parts.join(" · ") };
}

/** The result by topic, when the items have topics (phase 3 gives exam items theirs): weakest first. */
export function byTopic(items: readonly MockScoreItem[]): Array<{ topic: string; right: number; of: number }> {
  const m = new Map<string, { right: number; of: number }>();
  for (const it of items) {
    const t = (it.topic ?? "").trim();
    if (!t || !it.counted) continue;
    const r = m.get(t) ?? { right: 0, of: 0 };
    r.of += 1;
    if (it.correct) r.right += 1;
    m.set(t, r);
  }
  return [...m].map(([topic, r]) => ({ topic, ...r })).sort((a, b) => a.right / a.of - b.right / b.of || b.of - a.of || (a.topic < b.topic ? -1 : 1));
}

/** A wrong item's line: "בחרת א׳, הנכונה ג׳" · "לא ענית. הנכונה ג׳" · a set item: "לא הכל נכון".
 *  A suggested answer (the app solved it, no member confirmed it yet) is "המוצעת", never "הנכונה". */
export function wrongLine(it: Pick<MockScoreItem, "form" | "choice" | "choices" | "answer"> & { origin?: MockScoreItem["origin"] }): string {
  if (it.form !== "one") return it.choices ? "לא הכל נכון" : "לא ענית";
  const key = it.origin === "solved" ? "המוצעת" : "הנכונה";
  if (it.choice === null) return `לא ענית. ${key} ${letter(it.answer)}`;
  return `בחרת ${letter(it.choice)}, ${key} ${letter(it.answer)}`;
}

/** "זמן: 12 דקות מתוך 36 דקות", "זמן: שעתיים ו-41 דקות מתוך 3 שעות", "זמן: פחות מדקה מתוך 30 דקות" (words, not h:mm beside "דקות"). */
export function usedLine(startedAt: string, finishedAt: string | null, minutes: number): string {
  if (!finishedAt) return "";
  const used = Math.max(0, Math.min(minutes * 60_000, Date.parse(finishedAt) - Date.parse(startedAt)));
  const m = Math.round(used / 60_000);
  const h = Math.floor(m / 60);
  const r = m % 60;
  const words = m < 1 ? "פחות מדקה" : h === 0 ? minutesText(m) : [minutesText(h * 60), r ? (r === 1 ? "דקה" : `${r} דקות`) : ""].filter(Boolean).join(" ו-");
  return `זמן: ${words} מתוך ${minutesText(minutes)}`;
}

/* ── The open simulation on this phone (a reload or a locked phone comes back to it) ── */
/** study-mock:<user>, forgotten with the person's other entries on a shared device (api.ts's PERSONAL). */
const openKey = (user: string) => `study-mock:${user}`;
export function rememberAttempt(user: string, attempt: string | null): void {
  try {
    if (attempt) localStorage.setItem(openKey(user), attempt);
    else localStorage.removeItem(openKey(user));
  } catch {
    /* without storage the route itself keeps the attempt */
  }
}
export function openAttempt(user: string): string | null {
  try {
    return localStorage.getItem(openKey(user));
  } catch {
    return null;
  }
}

/* ── Exam items in practice (s=e.<exam>, s=c.<course>, w.<attempt>) ── */

/** The group's exams (RLS: members read them), for a course session's exam items. */
export async function groupExams(groupId: string): Promise<Array<{ id: string; course: string; title: string; status: string }>> {
  type Row = {
    id: string;
    course: string;
    title: string;
    status: string;
    deleted_at: string | null;
    kind?: string;
  };
  // The kind where section O made it (a build without VITE_STUDY_SHEETS, a rollback, practises past exams only);
  // a database before O has no such column.
  const read = (cols: string) => client().from("study_exams").select(cols).eq("group_id", groupId);
  let res = await read("id, course, title, status, deleted_at, kind");
  if (res.error && /kind/.test(res.error.message)) res = await read("id, course, title, status, deleted_at");
  if (res.error) fail(res.error);
  return ((res.data ?? []) as unknown as Row[]).filter((e) => !e.deleted_at && (appFlags.sheets || (e.kind ?? "exam") === "exam"));
}

/** The uploads' kinds (section O 1: exam or sheet), by id. */
export async function examKindsOf(examIds: string[]): Promise<Record<string, "exam" | "sheet">> {
  const { data, error } = await client()
    .from("study_exams")
    .select("id, kind")
    .in("id", [...new Set(examIds)].slice(0, 50));
  if (error) fail(error);
  return Object.fromEntries(((data ?? []) as Array<{ id: string; kind: "exam" | "sheet" }>).map((r) => [r.id, r.kind]));
}

/** Every item of these exams, in each exam's order. The question types'
 *  columns always: section S at 2 comes after Q at 3 in the file, and an
 *  exam's true/false and match items must not be read as one-answer ones. */
export async function listExamQuestions(examIds: string[]): Promise<PublicQuestion[]> {
  const out: PublicQuestion[] = [];
  const columns = qColumns({ qtypes: true });
  for (let i = 0; i < examIds.length; i += 20) {
    const part = examIds.slice(i, i + 20);
    if (!part.length) continue;
    const { data, error } = await client().from("study_questions").select(columns).in("exam_id", part).order("exam_no", { ascending: true });
    if (error) fail(error);
    out.push(...((data ?? []) as unknown as PublicQuestion[]));
  }
  return out;
}

/** Where each exam item's key came from (the review's), for "תשובה מוצעת · לא נבדקה" in a session. */
export async function keyOrigins(examIds: string[]): Promise<{ origins: Map<string, { origin: KeyOrigin | null; conf: number | null }>; titles: Record<string, string> }> {
  const origins = new Map<string, { origin: KeyOrigin | null; conf: number | null }>();
  const titles: Record<string, string> = {};
  for (const id of [...new Set(examIds)].slice(0, 12)) {
    const r = await examReview(id);
    titles[id] = r.exam.title;
    for (const q of r.items) origins.set(q.id, { origin: q.origin, conf: q.conf });
  }
  return { origins, titles };
}

/** A suggested key the app is not sure of (key_conf under 3): left out of every score (decision 2, B7). */
export const notCounted = (k: { origin: KeyOrigin | null; conf: number | null } | undefined): boolean => Boolean(k && k.origin === "solved" && (k.conf ?? 0) < 3);

/** Questions by id with the question types' columns (a simulation's, its mistakes'), in the order asked. */
export async function listQuestionsAll(ids: string[]): Promise<PublicQuestion[]> {
  const out: PublicQuestion[] = [];
  const columns = qColumns({ qtypes: true });
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const { data, error } = await client().from("study_questions").select(columns).in("id", unique.slice(i, i + 50));
    if (error) fail(error);
    out.push(...((data ?? []) as unknown as PublicQuestion[]));
  }
  const at = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
}
