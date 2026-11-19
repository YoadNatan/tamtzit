import type { SupabaseClient } from "@supabase/supabase-js";
import { numberBlocks } from "../../shared/study/blocks.js";
import { citedSlides } from "../../shared/study/edits.js";
import { coverage } from "./similar.js";
import { HttpError, tidyMarkdown } from "./study.js";

/* ── A course's context: paragraphs chosen for one question (sources.md B6.9) ──
 *
 * "לשאול על כל הקורס" cannot send every lecture: a course of 25 lectures is
 * far over any call worth paying for. selectContext() picks what the answer
 * reads, at $0 and with no stored index (an index would drift from the
 * corrections):
 *
 *   1. The course's lectures (its text matched by lower(btrim)), their ready
 *      parts and points to know. Each part is scored by how much of the
 *      question its heading and its points' subjects hold (similar.ts's
 *      trigrams; English drug and receptor names carry most of it).
 *   2. Every ready part is split into its numbered blocks, the anchors every
 *      feature points at (shared/study/blocks.ts), and each paragraph is
 *      scored by the question and its part's score.
 *   3. The best paragraphs, at most 12, from at most 4 lectures and about
 *      8,000 tokens, each with its address (the lecture's number in the
 *      course, its part and anchor, the slides it cites).
 *
 * The phone shows the cut honestly: "נבחרו 12 מתוך 340 פסקאות". */

/** At most this many paragraphs, from at most this many lectures. */
export const CONTEXT_PARAGRAPHS = 12;
export const CONTEXT_LECTURES = 4;
/** About 8,000 tokens of paragraphs (2.5 Hebrew characters a token). */
export const CONTEXT_CHARS = 20_000;
/** A table or a long list item is cut here; its address still leads to all of it. */
export const PARAGRAPH_CHARS = 1_500;

export type CourseRow = { id: string; group_id: string; name: string; name_key: string };
export type LectureRow = { id: string; title: string; course: string; lecture_date: string | null; created_at: string };
export type PartRow = { lecture_id: string; idx: number; title: string; markdown: string | null };
export type PointRow = { lecture_id: string; part_idx: number; subject: string; text: string };

/** A lecture of the course, numbered in the course's order ("הרצאה 7"). */
export type CourseLecture = { n: number; id: string; title: string };
/** One chosen paragraph and where it is. */
export type Paragraph = {
  lecture: number; // the lecture's number in the course
  lectureId: string;
  part: number;
  heading: string;
  anchor: number;
  slides: number[];
  text: string;
  score: number;
};
export type CourseContext = {
  paragraphs: Paragraph[];
  /** Paragraphs chosen, and every paragraph of the course's ready parts. */
  chosen: number;
  total: number;
  /** The lectures the chosen paragraphs come from, in the course's order. */
  lectures: CourseLecture[];
  /** Every lecture of the course (with or without a summary). */
  all: CourseLecture[];
};

const keyOf = (course: string) => course.trim().toLowerCase();

/** The course's lectures, in its order: by date (undated last), then when
 *  they were uploaded; numbered from 1. */
export function courseLectures(rows: LectureRow[], nameKey: string): CourseLecture[] {
  return rows
    .filter((l) => keyOf(l.course) === nameKey)
    .sort(
      (a, b) =>
        (a.lecture_date === null ? 1 : 0) - (b.lecture_date === null ? 1 : 0) ||
        (a.lecture_date ?? "").localeCompare(b.lecture_date ?? "") ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    )
    .map((l, i) => ({ n: i + 1, id: l.id, title: l.title }));
}

/** Words that say nothing about the subject: dropped from the question
 *  before it is scored, so "מה נאמר על" does not match every paragraph. */
const FILLER = new Set(
  "מה מהו מהי מהם מהן מי איך למה מדוע האם כמה איזה איזו אילו על של את עם בין או גם זה זו זאת אלה הוא היא הם הן יש אין לא כן כל נאמר אמר אמרה כתוב בהרצאה בהרצאות בקורס בסיכום ההבדל הבדל להסביר תסביר תסבירי לי אפשר צריך what is are the of and or in on about how why does do".split(
    " ",
  ),
);
export function queryText(q: string): string {
  const kept = q
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w && !FILLER.has(w.toLowerCase()));
  return kept.length ? kept.join(" ") : q;
}

const partKey = (lectureId: string, idx: number) => `${lectureId}:${idx}`;

/** Each part's score: how much of the question its heading and its points
 *  (subjects and text) hold, 0 to 1. */
export function scoreParts(query: string, parts: Array<Pick<PartRow, "lecture_id" | "idx" | "title">>, points: PointRow[]): Map<string, number> {
  const byPart = new Map<string, string[]>();
  for (const p of points) {
    const k = partKey(p.lecture_id, p.part_idx);
    const list = byPart.get(k) ?? [];
    list.push(p.subject, p.text);
    byPart.set(k, list);
  }
  const out = new Map<string, number>();
  for (const p of parts) {
    const k = partKey(p.lecture_id, p.idx);
    out.set(k, coverage(query, [p.title, ...(byPart.get(k) ?? [])].join(" ")));
  }
  return out;
}

const HEADING = /^h[1-6]$/;

/** The paragraphs of the course's ready parts, scored, and the best of
 *  them under the caps: at most `maxParagraphs`, from at most `maxLectures`
 *  lectures, at most `budgetChars` of text. A paragraph's score is mostly
 *  its own match with the question, plus its part's. Headings are not
 *  paragraphs (they are counted in neither number). The chosen ones come
 *  back in the course's order: lecture, part, anchor. */
export function pickParagraphs(o: {
  query: string;
  lectures: CourseLecture[];
  parts: PartRow[];
  partScore: Map<string, number>;
  maxParagraphs?: number;
  maxLectures?: number;
  budgetChars?: number;
}): { paragraphs: Paragraph[]; total: number } {
  const maxParagraphs = o.maxParagraphs ?? CONTEXT_PARAGRAPHS;
  const maxLectures = o.maxLectures ?? CONTEXT_LECTURES;
  const budget = o.budgetChars ?? CONTEXT_CHARS;
  const n = new Map(o.lectures.map((l) => [l.id, l.n]));
  const all: Paragraph[] = [];
  for (const p of o.parts) {
    const lecture = n.get(p.lecture_id);
    if (lecture === undefined || !p.markdown) continue;
    const ps = o.partScore.get(partKey(p.lecture_id, p.idx)) ?? 0;
    for (const b of numberBlocks(tidyMarkdown(p.markdown))) {
      if (HEADING.test(b.tag) || !b.text) continue;
      const text = b.text.length > PARAGRAPH_CHARS ? `${b.text.slice(0, PARAGRAPH_CHARS)}…` : b.text;
      all.push({
        lecture,
        lectureId: p.lecture_id,
        part: p.idx,
        heading: p.title,
        anchor: b.n,
        slides: citedSlides(b.text),
        text,
        score: 0.7 * coverage(o.query, b.text) + 0.3 * ps,
      });
    }
  }
  const ranked = all
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score || a.lecture - b.lecture || a.part - b.part || a.anchor - b.anchor);
  const chosen: Paragraph[] = [];
  const lectures = new Set<string>();
  let size = 0;
  for (const p of ranked) {
    if (chosen.length >= maxParagraphs) break;
    if (!lectures.has(p.lectureId) && lectures.size >= maxLectures) continue;
    if (size + p.text.length > budget) continue;
    chosen.push(p);
    lectures.add(p.lectureId);
    size += p.text.length;
  }
  chosen.sort((a, b) => a.lecture - b.lecture || a.part - b.part || a.anchor - b.anchor);
  return { paragraphs: chosen, total: all.length };
}

/** Reads the course's lectures, ready parts and points with the member's
 *  client (RLS: her group only) and picks the paragraphs for `query`. */
export async function selectContext(sb: SupabaseClient, course: CourseRow, query: string): Promise<CourseContext> {
  const ls = await sb
    .from("study_lectures")
    .select("id, title, course, lecture_date, created_at")
    .eq("group_id", course.group_id)
    .is("deleted_at", null);
  if (ls.error) throw new HttpError(500, ls.error.message);
  const all = courseLectures((ls.data ?? []) as LectureRow[], course.name_key);
  if (!all.length) return { paragraphs: [], chosen: 0, total: 0, lectures: [], all };
  const ids = all.map((l) => l.id);
  const [parts, points] = await Promise.all([
    sb.from("study_sections").select("lecture_id, idx, title, markdown").in("lecture_id", ids).eq("status", "ready"),
    sb.from("study_points").select("lecture_id, part_idx, subject, text").in("lecture_id", ids),
  ]);
  if (parts.error) throw new HttpError(500, parts.error.message);
  if (points.error) throw new HttpError(500, points.error.message);
  const rows = ((parts.data ?? []) as PartRow[]).sort((a, b) => a.lecture_id.localeCompare(b.lecture_id) || a.idx - b.idx);
  const q = queryText(query);
  const partScore = scoreParts(q, rows, (points.data ?? []) as PointRow[]);
  const { paragraphs, total } = pickParagraphs({ query: q, lectures: all, parts: rows, partScore });
  const used = new Set(paragraphs.map((p) => p.lectureId));
  return { paragraphs, chosen: paragraphs.length, total, lectures: all.filter((l) => used.has(l.id)), all };
}

/** The context as the model reads it: each paragraph under its address. */
export function contextBlock(courseName: string, ctx: CourseContext): string {
  const title = new Map(ctx.all.map((l) => [l.n, l.title]));
  const lines = [
    `The course «${courseName}»: paragraphs of the group's summaries of its lectures, chosen for this question (${ctx.chosen} of ${ctx.total}). Each paragraph follows its address: the lecture's number in the course, its title and the part's heading. Its [ש' n] tags name that lecture's slides.`,
  ];
  for (const p of ctx.paragraphs) lines.push(`[הרצאה ${p.lecture} · «${title.get(p.lecture) ?? ""}» · «${p.heading}»]\n${p.text}`);
  return lines.join("\n\n");
}

/** A citation of the course scope: [הרצאה 7 · ש׳ 14] (also ש' and ranges). */
const CITE = /\[הרצאה\s*(\d{1,3})\s*·\s*ש['׳]\s?([\d\s,–-]+)\]/g;
export type Cite = { lecture: number; slides: number[] };
export function courseCites(text: string): Cite[] {
  return [...text.matchAll(CITE)].map((m) => ({ lecture: Number(m[1]), slides: citedSlides(`[ש' ${m[2]}]`) }));
}

/** Citations that name a lecture or a slide the chosen paragraphs do not
 *  have, as "7·14"; a plain [ש' n] (no lecture) is "?·n". */
export function badCites(answer: string, ctx: Pick<CourseContext, "paragraphs">): string[] {
  const have = new Map<number, Set<number>>();
  for (const p of ctx.paragraphs) {
    const s = have.get(p.lecture) ?? new Set<number>();
    for (const n of p.slides) s.add(n);
    have.set(p.lecture, s);
  }
  const bad: string[] = [];
  for (const c of courseCites(answer)) for (const n of c.slides) if (!have.get(c.lecture)?.has(n)) bad.push(`${c.lecture}·${n}`);
  for (const n of citedSlides(answer.replace(CITE, ""))) bad.push(`?·${n}`);
  return [...new Set(bad)];
}
