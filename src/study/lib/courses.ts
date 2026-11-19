import { courseKey as sharedCourseKey } from "../../../shared/study/courseKey";
import { postStudy, readLines, sb } from "./api";

/* ── Courses: the data (sources.md, phase 1; section S 1) ──
 *
 * A course is the lectures' shared course text, matched by lower(btrim()),
 * with a row of its own (study_courses) for an id, the exam's date and its
 * length. Members read it through the RPCs below; nothing writes the table
 * directly. "לשאול על כל הקורס" is op "ask" with scope "course": the server
 * picks the paragraphs (at most 12 from at most 4 lectures) and its first
 * NDJSON line says which ("נבחרו 12 מתוך 340 פסקאות").
 *
 * Every wrapper throws Error(code) with the server's code, which the screens
 * turn into words with failText(code, "course") or failText(code, "ask").
 * Nothing here is in the entry chunk: the slot module (features/courses.tsx)
 * loads it with import() when VITE_STUDY_COURSES is on. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}

/** A course as the library lists it (study_courses_of). */
export type CourseRow = {
  id: string;
  name: string;
  name_key: string;
  exam_date: string | null;
  exam_minutes: number | null;
  exam_n: number | null;
  lectures: number;
  exams: number;
};

/** The course page's numbers (study_course_overview). */
export type CourseOverview = {
  id: string;
  name: string;
  exam_date: string | null;
  days_left: number | null;
  exam_minutes: number | null;
  exam_n: number | null;
  lectures: number;
  ready: number;
  exams: Array<{ id: string; title: string; year: number | null; status: string }>;
  /** Questions of its lectures that can be practised now ("(184)"). */
  questions: number;
};

/** The key a course is matched by (shared/study/courseKey.ts, the SQL's study_private.course_key). */
export const courseKey = (name: string) => sharedCourseKey(name);

/** Every course of the group, by name. */
export async function coursesOf(groupId: string): Promise<CourseRow[]> {
  const { data, error } = await client().rpc("study_courses_of", { p_group: groupId });
  if (error) fail(error);
  return (data ?? []) as CourseRow[];
}

export async function courseOverview(courseId: string): Promise<CourseOverview> {
  const { data, error } = await client().rpc("study_course_overview", { p_course: courseId });
  if (error) fail(error);
  return data as CourseOverview;
}

/** The exam's date, minutes and number of questions; null clears one. */
export async function courseSet(courseId: string, s: { examDate: string | null; minutes: number | null; n: number | null }): Promise<void> {
  const { error } = await client().rpc("study_course_set", { p_course: courseId, p_exam_date: s.examDate, p_minutes: s.minutes, p_n: s.n });
  if (error) fail(error);
}

/** "לשנות שם": the course and the text of every lecture of it. "exists" when another course has the name. */
export async function courseRename(courseId: string, name: string): Promise<void> {
  const { error } = await client().rpc("study_course_rename", { p_course: courseId, p_name: name });
  if (error) fail(error);
}

/** "לאחד קורסים": `from`'s lectures move to `into`'s name, and `from` goes. */
export async function courseMerge(from: string, into: string): Promise<void> {
  const { error } = await client().rpc("study_course_merge", { p_from: from, p_into: into });
  if (error) fail(error);
}

/** The group's course of this name, made when missing; its id. */
export async function courseUpsert(groupId: string, name: string): Promise<string> {
  const { data, error } = await client().rpc("study_course_upsert", { p_group: groupId, p_name: name });
  if (error) fail(error);
  return String(data);
}

/* ── "לשאול על כל הקורס" ── */

/** The cut the answer read, as the server's first line gives it. */
export type CourseContext = {
  chosen: number;
  total: number;
  lectures: Array<{ n: number; id: string; title: string }>;
  paragraphs: Array<{ lecture: number; part: number; anchor: number; slides: number[] }>;
};
export type CourseAskLine =
  | ({ t: "context" } & CourseContext)
  | { t: "turn"; u: string }
  | { t: "a"; d: string }
  | { t: "done"; stop: string | null; badCites?: string[]; left: number | null; sig: string };

/** One answered question about a course, as this phone keeps it. */
export type CourseTurn = { q: string; u: string; a: string; sig: string; at: string; stop: string | null; ctx: CourseContext | null; badCites: string[] };

/** POST /api/study/ai { op: "ask", scope: "course" } and its NDJSON lines; throws Error(code). */
export async function askCourseStream(
  body: { courseId: string; question: string; history: Array<{ u: string; a: string; sig: string; lectures?: Array<{ n: number; id: string }> }> },
  onLine: (l: CourseAskLine) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await postStudy("/api/study/ai", { op: "ask", scope: "course", ...body }, { signal });
  await readLines(res, (l) => onLine(l as CourseAskLine));
}

/** "נבחרו 12 מתוך 340 פסקאות" (one: "נבחרה פסקה אחת מתוך 340"). */
export function chosenLine(c: Pick<CourseContext, "chosen" | "total">): string {
  return c.chosen === 1 ? `נבחרה פסקה אחת מתוך ${c.total}` : `נבחרו ${c.chosen} מתוך ${c.total} פסקאות`;
}

/** A citation of a course answer: [הרצאה 7 · ש׳ 14] (ש' too, and ranges). */
const CITE = /\[הרצאה\s*(\d{1,3})\s*·\s*ש['׳]\s?([\d\s,–-]+)\]/g;

/** "14-16, 20" → [14, 15, 16, 20] (a range is at most 60 slides). */
function slidesIn(spec: string): number[] {
  const out: number[] = [];
  for (const piece of spec.split(",")) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(piece);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = a; n <= Math.min(b, a + 60); n++) out.push(n);
  }
  return out;
}

/** A source of a course answer: the lecture's number and slide it cites, and
 *  where that is (the chosen paragraph that cites the slide, else the lecture
 *  at the slide). Citations the chosen paragraphs do not have are left out. */
export type CourseSource = { key: string; lecture: number; slide: number; lectureId: string; title: string; at: { part: number; anchor: number } | null };
export function courseSources(answer: string, ctx: CourseContext | null): CourseSource[] {
  if (!ctx) return [];
  const out: CourseSource[] = [];
  for (const m of answer.matchAll(CITE)) {
    const lecture = Number(m[1]);
    const l = ctx.lectures.find((x) => x.n === lecture);
    if (!l) continue;
    for (const slide of slidesIn(m[2])) {
      const key = `${lecture}·${slide}`;
      if (out.some((s) => s.key === key)) continue;
      const p = ctx.paragraphs.find((x) => x.lecture === lecture && x.slides.includes(slide));
      if (!p) continue;
      out.push({ key, lecture, slide, lectureId: l.id, title: l.title, at: { part: p.part, anchor: p.anchor } });
    }
  }
  return out;
}

/* ── The conversation, on this phone only (as a lecture's) ── */
const THREAD_DAYS = 14;
const THREAD_TURNS = 30;
export const courseThreadKey = (courseId: string) => `study-ask-v1:course:${courseId}`;
export function loadCourseThread(key: string): CourseTurn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]") as CourseTurn[];
    const since = Date.now() - THREAD_DAYS * 86_400_000;
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.u === "string" && typeof t.a === "string" && Date.parse(t.at) >= since).slice(-THREAD_TURNS) : [];
  } catch {
    return [];
  }
}
export function saveCourseThread(key: string, turns: CourseTurn[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(turns.slice(-THREAD_TURNS)));
  } catch {
    /* private mode or full: the conversation stays on screen */
  }
}
export function clearCourseThread(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing kept */
  }
}

/* ── The exam's date and length, in words ── */

/** "12.2" from "2027-02-12". */
export function dayMonth(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)}.${Number(m)}`;
}

/** "המבחן ב-12.2" · "עוד 23 ימים" (the day itself, tomorrow, past). */
export function examWhen(date: string | null, daysLeft: number | null): { when: string; left: string } | null {
  if (!date || daysLeft === null) return null;
  const dm = dayMonth(date);
  if (daysLeft < 0) return { when: `המבחן היה ב-${dm}`, left: "" };
  if (daysLeft === 0) return { when: `המבחן ב-${dm}`, left: "המבחן היום" };
  if (daysLeft === 1) return { when: `המבחן ב-${dm}`, left: "מחר" };
  return { when: `המבחן ב-${dm}`, left: `עוד ${daysLeft} ימים` };
}

/** "100 שאלות · 3 שעות" (minutes not in whole hours: "2.5 שעות", under an hour: "45 דקות"). */
export function examLength(n: number | null, minutes: number | null): string {
  const parts: string[] = [];
  if (n) parts.push(`${n} שאלות`);
  if (minutes) {
    if (minutes < 60) parts.push(`${minutes} דקות`);
    else if (minutes === 60) parts.push("שעה");
    else if (minutes === 120) parts.push("שעתיים");
    else if (minutes % 60 === 0) parts.push(`${minutes / 60} שעות`);
    else if (minutes % 30 === 0) parts.push(`${minutes / 60} שעות`);
    else parts.push(`${minutes} דקות`);
  }
  return parts.join(" · ");
}

/** "25 הרצאות" (one: "הרצאה אחת"). */
export const lecturesWord = (n: number) => (n === 1 ? "הרצאה אחת" : `${n} הרצאות`);
