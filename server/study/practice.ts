import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type NumberedBlock, numberBlocks } from "../../shared/study/blocks.js";
import { type Box, isBox } from "../../shared/study/figureGeo.js";
import { isSetForm, weightOf } from "../../shared/study/forms.js";
import type { Difficulty, Style, WriteLine } from "../../shared/study/practice2.js";
import { estimateUsd, imageTokens, reserve } from "./budget.js";
import { figureList, type Figure } from "./cards.js";
import { cleanSchema, type Effort, generateItems, settleFor } from "./claude.js";
import type { AiBody } from "./ops/types.js";
import {
  type Correction,
  CORRECTIONS_MAX,
  correctionsBlock,
  type PartView,
  QUESTIONS_SYSTEM,
  questionsRequest,
  type RequestExtras,
  type RequestPoint,
  rewriteRequest,
  type StyleInput,
  styleBlock,
  styleExampleBlock,
  styleExamples,
} from "./prompts/questions.js";
import { labelledFigures, type LabelledFigure } from "./labels.js";
import { casesFor, checkQuestion, type Ctx, type Known, QuestionIn, QuestionSet, type SaveItem, toDraftPublic, toPublic } from "./questions.js";
import { solveQuestions, solverEstimate, type SolverItem, type Verdict } from "./solver.js";
import {
  anthropic,
  deckText,
  errorText,
  HttpError,
  keyed,
  type Lecture,
  lectureBlock,
  loadLecture,
  memberClient,
  MODEL,
  REQUIRED_SCHEMA,
  schemaHas,
  schemaOk,
  serverClient,
  serverKey,
  textStream,
} from "./study.js";
import { fallbackReserve, modelFor } from "./routes.js";

/* ── op "questions": one part of a practice round (spec §4.6; §12.3.Q; practice 2.0) ──
 *
 *   POST /api/study/ai  { op: "questions", lectureId, batchId }
 *
 * The member's token and the server key claim the batch (study_question_claim:
 * busy → 409, three paid tries used → 409 "gave up"); the lecture's active
 * questions (public columns, and a request's pending drafts), the course's
 * past-exam style, the part's text (its paragraphs and the pictures it
 * captioned, Q's end) and its current corrections are read with the
 * member's token (RLS decides); one call is reserved (kind "practice", ref
 * the batch id) before the stream starts, so a refusal is an HTTP status.
 * Each item is checked as it arrives (checkQuestion). Then the blind solver
 * answers the call's items without their keys (solver.ts; its own
 * reservation, kind "solver"), and those it got wrong are written again once
 * and solved again. A release-1 round's batch saves into the bank what the
 * solver agreed with (study_save_question, server key) and streams it with
 * its public fields; a practice 2.0 request's batch saves each item as a
 * draft at once (study_draft_save), streams it, then its verdict. With fewer
 * valid items than wanted and over 120 s left, a second call, with its own
 * reservation. Always study_question_finish (server key), and every call's
 * reservation settled (claude.ts, settleFor). The other actions of the op
 * (points, plan, create, style, reword) are practice2.ts's; ops/practice.ts
 * routes them.
 *
 * Lines: {"t":"start"} · {"t":"q","q":{…public…}} (a release-1 batch) ·
 * {"t":"draft","d":{…public…},"replaces"?} · {"t":"check","id","state"} ·
 * {"t":"drop","id"} (a request's batch) · {"t":"skip","why"} ·
 * {"t":"done","made","rejected","solverRejected","costUsd","unsettled"}; a
 * failure after the start ends the stream with "\u0000ERROR <code>"
 * (textStream). */

/** Vercel ends the function at 300 s; the model call stops at 270 s. */
const TIME_LIMIT_MS = 270_000;
/** A second call only with more than this left. */
const SECOND_CALL_MS = 120_000;
/** The "already asked" list: at most 25 lines of 160 characters. */
const ASKED_MAX = 25;
const ASKED_LINE = 160;
/** Past-exam items a course needs before its style is used, and examples sent. */
const STYLE_MIN_ITEMS = 5;
const STYLE_EXAMPLES = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What study_question_claim returns: the part, how many questions it still
 *  wants, and the effort (medium after a timeout). */
export type Claim = {
  lecture_id: string;
  round: number;
  part_idx: number;
  heading: string;
  slide_from: number;
  slide_to: number;
  wanted: number;
  effort: "high" | "medium";
};

/* ── Inputs ── */

/** The lecture's active questions, public columns only, oldest first (a
 *  stable order, so the request's bytes depend only on the data). */
export async function knownQuestions(sb: SupabaseClient, lectureId: string): Promise<Known[]> {
  const { data, error } = await sb
    .from("study_questions")
    .select("id, part_idx, vignette, question, options, slides, topic, aspect")
    .eq("lecture_id", lectureId)
    .is("retired_at", null)
    .order("created_at")
    .order("id");
  if (error) throw new HttpError(500, error.message);
  return ((data ?? []) as Known[]).map((k) => ({
    id: k.id,
    part_idx: k.part_idx ?? null,
    vignette: k.vignette ?? "",
    question: k.question ?? "",
    options: k.options ?? [],
    slides: k.slides ?? [],
    topic: k.topic ?? "",
    aspect: k.aspect ?? "other",
  }));
}

/** The "already asked" list of a part: its active questions (the part's index,
 *  or a slide in its range) and those accepted earlier in this run, the 25
 *  newest, each `topic: <first 80 characters of the vignette> … <lead-in>`
 *  in a line of at most 160 characters. */
export function askedFor(
  known: Known[],
  claim: Pick<Claim, "part_idx" | "slide_from" | "slide_to">,
): Array<{ topic: string; text: string }> {
  const inPart = known.filter(
    (k) => k.part_idx === claim.part_idx || (k.slides ?? []).some((n) => n >= claim.slide_from && n <= claim.slide_to),
  );
  return inPart.slice(-ASKED_MAX).map((k) => {
    const topic = k.topic.trim().slice(0, 60);
    const vignette = k.vignette.trim();
    const lead = vignette ? `${vignette.slice(0, 80).trimEnd()} … ${k.question.trim()}` : k.question.trim();
    const room = ASKED_LINE - 2 - (topic ? topic.length + 2 : 0); // "- " and "topic: "
    return { topic, text: lead.length > room ? lead.slice(0, room - 1) + "…" : lead };
  });
}

type ExamRow = { id: string; created_at: string };
type ExamItemRow = { id: string; exam_id: string; exam_no: number | null; kind: string; vignette: string; question: string; options: string[]; has_key: boolean };

/** The course's style from its past-exam items (pure; courseStyle reads the
 *  rows): null under 5 items; else the most common option count, the share
 *  of cases rounded to 10, the median stem length in words, and 6 keyed
 *  examples, newest exam first, then by number, alternating case and direct,
 *  so the same exams always give the same bytes. */
export function styleInput(course: string, exams: ExamRow[], items: ExamItemRow[]): StyleInput | null {
  if (items.length < STYLE_MIN_ITEMS) return null;
  const isCase = (i: ExamItemRow) => i.kind === "case" || i.vignette.trim() !== "";
  const counts = new Map<number, number>();
  for (const i of items) counts.set(i.options.length, (counts.get(i.options.length) ?? 0) + 1);
  const optionCount = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const casePercent = Math.round((100 * items.filter(isCase).length) / items.length / 10) * 10;
  const words = items
    .map((i) => `${i.vignette} ${i.question}`.trim().split(/\s+/).filter(Boolean).length)
    .sort((a, b) => a - b);
  const mid = words.length >> 1;
  const stemWords = words.length % 2 ? words[mid] : Math.round((words[mid - 1] + words[mid]) / 2);

  const rank = new Map(
    [...exams]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id.localeCompare(b.id)))
      .map((e, n) => [e.id, n]),
  );
  const keyedItems = items
    .filter((i) => i.has_key && rank.has(i.exam_id))
    .sort((a, b) => rank.get(a.exam_id)! - rank.get(b.exam_id)! || (a.exam_no ?? 0) - (b.exam_no ?? 0) || a.id.localeCompare(b.id));
  const queues = [keyedItems.filter(isCase), keyedItems.filter((i) => !isCase(i))];
  const picked: ExamItemRow[] = [];
  for (let turn = 0; picked.length < STYLE_EXAMPLES && (queues[0].length || queues[1].length); turn ^= 1) {
    const next = queues[turn].shift() ?? queues[turn ^ 1].shift();
    if (next) picked.push(next);
  }
  return {
    course,
    optionCount,
    casePercent,
    stemWords,
    examples: picked.map((i) => ({ vignette: i.vignette.trim(), question: i.question.trim(), options: i.options })),
  };
}

/** The course's past exams as a style input, or null: no course, or fewer
 *  than 5 items. Only items exam_read saved (source "exam", through the key).
 *  With section S at 2 (sources.md B5, phase 2) through
 *  study_course_style_items: the course by its key (any spelling of it),
 *  no deleted exam and none hidden from the profile ("לא לכלול בחישוב
 *  הנושאים"), and an item counts as keyed only when its key came from the
 *  exam, its key sheet or a member (a solved key is no example). Without
 *  S 2, the exams of exactly this course text, as before. */
export async function courseStyle(sb: SupabaseClient, lecture: Pick<Lecture, "group_id" | "course">): Promise<StyleInput | null> {
  const course = lecture.course.trim();
  if (!course) return null;
  if (await schemaHas(sb, { S: 2 })) {
    const { data, error } = await sb.rpc("study_course_style_items", { p_group: lecture.group_id, p_course: lecture.course });
    if (error) throw new HttpError(500, error.message);
    const rows = (data ?? []) as Array<ExamItemRow & { exam_created_at: string }>;
    const exams = new Map<string, ExamRow>();
    for (const r of rows) exams.set(r.exam_id, { id: r.exam_id, created_at: r.exam_created_at });
    if (!exams.size) return null;
    return styleInput(course, [...exams.values()], rows.map(({ exam_created_at: _, ...r }) => r));
  }
  const exams = await sb.from("study_exams").select("id, created_at").eq("group_id", lecture.group_id).eq("course", lecture.course);
  if (exams.error) throw new HttpError(500, exams.error.message);
  const rows = (exams.data ?? []) as ExamRow[];
  if (!rows.length) return null;
  const items = await sb
    .from("study_questions")
    .select("id, exam_id, exam_no, kind, vignette, question, options, has_key")
    .eq("source", "exam")
    .is("retired_at", null)
    .in(
      "exam_id",
      rows.map((r) => r.id),
    );
  if (items.error) throw new HttpError(500, items.error.message);
  return styleInput(course, rows, (items.data ?? []) as ExamItemRow[]);
}

type EditRow = { anchor: number; rev: number; before_text: string; after_text: string; note: string };

/** Corrections of one generation of a part, netted per paragraph: the first
 *  text before, the last text after, the notes in order; a paragraph put back
 *  as it was drops out; the 20 most recent are kept, in the part's order. */
export function netCorrections(rows: EditRow[]): Correction[] {
  const by = new Map<number, EditRow[]>();
  for (const r of [...rows].sort((a, b) => a.rev - b.rev)) by.set(r.anchor, [...(by.get(r.anchor) ?? []), r]);
  return [...by]
    .map(([anchor, rs]) => ({
      anchor,
      last: rs[rs.length - 1].rev,
      before: rs[0].before_text,
      after: rs[rs.length - 1].after_text,
      note: rs
        .map((r) => r.note.trim())
        .filter(Boolean)
        .join(" · "),
    }))
    .filter((c) => c.before !== c.after)
    .sort((a, b) => b.last - a.last)
    .slice(0, CORRECTIONS_MAX)
    .sort((a, b) => a.anchor - b.anchor)
    .map(({ before, after, note }) => ({ before, after, note }));
}

/** No such table: section K (corrections) is not loaded yet. */
const missingTable = (e: { code?: string }) => e.code === "PGRST205" || e.code === "42P01";

/** The part as the summary has it: its generation, its text numbered as
 *  SummaryView numbers it (Q's end: the paragraph that answers a question),
 *  the pictures it captioned in the claim's slides, and whether the claim's
 *  slides are the summary part's (a round planned in six-slide chunks has
 *  no paragraphs and no corrections). */
export type PartText = { gen: number | null; inPart: boolean; blocks: NumberedBlock[]; figures: Figure[]; labelled?: LabelledFigure[] };

export async function readPart(
  sb: SupabaseClient,
  lectureId: string,
  claim: Pick<Claim, "part_idx" | "slide_from" | "slide_to">,
  lecture?: Pick<Lecture, "slides">,
): Promise<PartText> {
  const sec = await sb
    .from("study_sections")
    .select("gen, slide_from, slide_to, markdown")
    .eq("lecture_id", lectureId)
    .eq("idx", claim.part_idx)
    .maybeSingle();
  if (sec.error) throw new HttpError(500, sec.error.message);
  const part = sec.data as { gen: number; slide_from: number; slide_to: number; markdown?: string | null } | null;
  if (!part || part.slide_to < claim.slide_from || part.slide_from > claim.slide_to) return { gen: null, inPart: false, blocks: [], figures: [] };
  const md = part.markdown ?? "";
  const figures = md ? figureList([md], claim.slide_from, claim.slide_to) : [];
  return {
    gen: part.gen,
    inPart: true,
    blocks: md.trim() ? numberBlocks(md) : [],
    figures,
    // Question types: the part's pictures with label geometry (labels.ts), captioned where the summary captions them.
    labelled: lecture ? labelledFigures(lecture.slides, claim.slide_from, claim.slide_to, new Map(figures.map((f) => [f.id, f.caption]))) : [],
  };
}

/** The part's current corrections (study_edits of the part's current
 *  generation, section K), read with the member's token. None before section
 *  K, or when the claim's slides are not the summary part's. */
export async function partCorrections(sb: SupabaseClient, lectureId: string, claim: Pick<Claim, "part_idx">, part: Pick<PartText, "gen" | "inPart">): Promise<Correction[]> {
  if (!part.inPart || part.gen === null) return [];
  const edits = await sb
    .from("study_edits")
    .select("anchor, rev, before_text, after_text, note")
    .eq("lecture_id", lectureId)
    .eq("part_idx", claim.part_idx)
    .eq("gen", part.gen)
    .order("rev");
  if (edits.error) {
    if (missingTable(edits.error)) return [];
    throw new HttpError(500, edits.error.message);
  }
  return netCorrections((edits.data ?? []) as EditRow[]);
}

/* ── The request ── */

type TextBlock = Anthropic.Beta.BetaTextBlockParam;
type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

/** The system: fixed per lecture (and course), so every part of a round reads
 *  one cache entry: QUESTIONS_SYSTEM · [the course's style counts] · the
 *  lecture (breakpoints after the style and the lecture). */
export function questionsSystem(lecture: Pick<Lecture, "lecturer" | "slides">, style: StyleInput | null): TextBlock[] {
  return [
    { type: "text", text: QUESTIONS_SYSTEM },
    ...(style ? [{ type: "text" as const, text: styleBlock(style), cache_control: { type: "ephemeral" as const } }] : []),
    { type: "text", text: lectureBlock(lecture), cache_control: { type: "ephemeral" } },
  ];
}

/** The user turn of one call: [the past-exam examples] · [the group's own
 *  example] · the request · [the part's corrections]. A part without them
 *  gets exactly the request; each adds one block, and everything before the
 *  request is the same bytes for every part of a round (review UX-23). */
export function questionsUser(o: {
  claim: Pick<Claim, "heading" | "slide_from" | "slide_to" | "part_idx">;
  want: number;
  optionCount: number;
  known: Known[];
  style: StyleInput | null;
  corrections: Correction[];
  part?: PartView;
  extras?: RequestExtras;
  memberStyle?: { description: string; example: string } | null;
  /** Image items: the part's pictures, seen by the writer (only when the request asks for one). */
  pictures?: readonly Picture[];
}): ContentBlock[] {
  const request = questionsRequest({
    heading: o.claim.heading,
    from: o.claim.slide_from,
    to: o.claim.slide_to,
    count: o.want,
    options: o.optionCount,
    cases: o.extras ? o.extras.styles.filter((s) => s === "case").length : casesFor(o.want),
    asked: askedFor(o.known, o.claim),
    blocks: o.part?.blocks,
    figures: o.part?.figures,
    labelled: o.part?.labelled,
    extras: o.extras,
  });
  const pictures = o.extras?.styles.includes("image") ? (o.pictures ?? []) : [];
  return [
    ...(o.style?.examples.length ? [{ type: "text" as const, text: styleExamples(o.style.examples) }] : []),
    ...(o.memberStyle ? [{ type: "text" as const, text: styleExampleBlock(o.memberStyle) }] : []),
    { type: "text", text: request },
    ...pictureBlocks(pictures),
    ...(o.corrections.length ? [{ type: "text" as const, text: correctionsBlock(o.corrections) }] : []),
  ];
}

/** max_tokens of a call for `want` questions (thinking included); with the
 *  planned styles, their weight (a staged case writes 2-3 questions), never
 *  less than `want` plain questions. */
export const maxTokensFor = (want: number, styles?: readonly string[]): number => 4_000 + Math.ceil(2_500 * Math.max(want, styles ? weightOf(styles) : 0));

/** The blind solver's view of an item: its public text, a set question's
 *  form (and a match's prompts), an image item's picture (its signed URL;
 *  never the caption, which can name the answer). An image item without a
 *  URL is marked so: it is not judged. The key to judge by stays on the
 *  server. */
export function solverItemOf(item: SaveItem, pictures: ReadonlyMap<string, Picture>): SolverItem {
  const layout = item.layout;
  const pic = item.style === "image" && item.figure ? pictures.get(item.figure) : undefined;
  return {
    vignette: item.vignette,
    question: item.question,
    options: item.options,
    answer: item.answer,
    ...(isSetForm(item.form) ? { form: item.form, seq: item.seq } : {}),
    ...(layout?.kind === "match" ? { prompts: layout.prompts } : {}),
    ...(item.style === "image" ? (pic ? { image: pic.url } : { withoutPicture: true }) : {}),
  };
}

/* ── Image items: the pictures themselves ──
 * "שאלה על תמונה" is written and checked by looking at the picture: the
 * writer gets the part's captioned pictures as image blocks after the
 * request, and the solver gets an image item's picture (and the same item
 * without it, which must not be answerable). Each is signed for 30 minutes
 * with the member's token (the bucket is the group's). */
export type Picture = { id: string; slide: number; url: string; w: number; h: number };
/** At most this many pictures go with one writer call. */
export const PICTURES_MAX = 6;
const PICTURE_SECONDS = 1800;

/** Signs the pictures `ids` names (fig:N-K) of the lecture; a picture that
 *  cannot be signed is left out. */
export async function signPictures(sb: SupabaseClient, lecture: Pick<Lecture, "slides">, ids: readonly string[]): Promise<Map<string, Picture>> {
  const byId = new Map<string, { slide: number; path: string; w: number; h: number }>();
  for (const s of lecture.slides) for (const f of s.figures ?? []) byId.set(`fig:${s.n}-${f.k}`, { slide: s.n, path: f.path, w: f.w, h: f.h });
  const want = [...new Set(ids)].map((id) => ({ id, f: byId.get(id) })).filter((x): x is { id: string; f: { slide: number; path: string; w: number; h: number } } => Boolean(x.f?.path));
  const out = new Map<string, Picture>();
  if (!want.length) return out;
  try {
    const { data } = await sb.storage.from("study").createSignedUrls(want.map((x) => x.f.path), PICTURE_SECONDS);
    const urls = new Map((data ?? []).filter((d) => d.path && d.signedUrl).map((d) => [d.path as string, d.signedUrl]));
    for (const x of want) {
      const url = urls.get(x.f.path);
      if (url) out.set(x.id, { id: x.id, slide: x.f.slide, url, w: x.f.w, h: x.f.h });
    }
  } catch (e) {
    console.error(`sign pictures: ${errorText(e)}`);
  }
  return out;
}

/** The pictures as content blocks: each picture's id, then the picture. */
export function pictureBlocks(pictures: readonly Picture[]): ContentBlock[] {
  return pictures.flatMap((p) => [
    { type: "text" as const, text: `${p.id} (שקף ${p.slide})` },
    { type: "image" as const, source: { type: "url" as const, url: p.url } },
  ]);
}

/** The pictures' input tokens, for a call's estimate. */
export const picturesTokens = (pictures: readonly Picture[]): number => pictures.reduce((n, p) => n + imageTokens(p.w, p.h), 0);

/** A label item never goes to the blind solver: the slide's geometry keys it. */
export const solverFree = (item: Pick<SaveItem, "style">): boolean => item.style === "label";

/** The verdict's call: study_draft_check_set for a set question, study_draft_check otherwise. */
export function checkCall(id: string, item: Pick<SaveItem, "form">, v: Verdict | null): { fn: string; args: Record<string, unknown> } {
  return isSetForm(item.form)
    ? { fn: "study_draft_check_set", args: { p_draft: id, p_seq: v ? (v.seq ?? []) : null, p_ambiguous: v ? v.ambiguous : null } }
    : { fn: "study_draft_check", args: { p_draft: id, p_choice: v ? v.choice : null, p_ambiguous: v ? v.ambiguous : null } };
}

/** The writer's checks' context for a part: the labelled pictures, the slides' text, whether the lecture is a PDF. */
export function typesCtx(lecture: Pick<Lecture, "slides" | "source_kind">, part: Pick<PartText, "labelled"> | undefined): Pick<Ctx, "labelled" | "slideText" | "pdf" | "crops"> {
  const crops = new Map<string, Box>();
  for (const s of lecture.slides) for (const f of s.figures ?? []) if (f.crop && isBox(f.crop)) crops.set(`fig:${s.n}-${f.k}`, f.crop);
  return {
    labelled: new Map((part?.labelled ?? []).map((f) => [f.id, { geo: f.geo }])),
    slideText: new Map(lecture.slides.map((s) => [s.n, [s.title, ...s.lines].join(" ").toLowerCase()])),
    pdf: lecture.source_kind === "pdf",
    crops,
  };
}

/** One call's worst case, which is what it reserves (budget.ts): its text,
 *  and the pictures' tokens (image items). */
export function callEstimate(system: TextBlock[], user: readonly ContentBlock[], maxTokens: number, pictureTokens = 0, model: string = MODEL): number {
  const chars = [...system, ...user].reduce((n, b) => n + ("text" in b && typeof b.text === "string" ? b.text.length : 0), 0);
  return estimateUsd(model, chars, maxTokens, pictureTokens);
}

/** The schema of the questions' format, as sent (cleanSchema of the zod). */
export const QUESTIONS_SCHEMA = cleanSchema(zodOutputFormat(QuestionSet).schema as Record<string, unknown>);

/** The one request of a part (§12.3.Q: questionsCall): what the stream
 *  sends through generateItems, and what section B's batch sends. */
export function questionsCall(o: Parameters<typeof questionsUser>[0] & { lecture: Pick<Lecture, "lecturer" | "slides">; effort: Effort }): {
  system: TextBlock[];
  messages: Anthropic.Beta.BetaMessageParam[];
  maxTokens: number;
  effort: Effort;
  schema: Record<string, unknown>;
} {
  const user = questionsUser(o);
  return {
    system: questionsSystem(o.lecture, o.style),
    messages: [{ role: "user", content: user }],
    maxTokens: maxTokensFor(o.want, o.extras?.styles),
    effort: o.effort,
    schema: QUESTIONS_SCHEMA,
  };
}

/** The effort of a practice 2.0 batch: medium for קל, high otherwise; a part
 *  whose last try timed out is written at medium (the claim says so). */
export function effortFor(difficulty: Difficulty | null, claimEffort: "high" | "medium"): "high" | "medium" {
  if (claimEffort === "medium") return "medium";
  return difficulty === "easy" ? "medium" : "high";
}

/* ── Writing the batch ── */

export type BatchResult = { made: number; rejected: number; solverRejected: number; costUsd: number; unsettled: number };

/** Ends a claimed batch (server key). Never throws: a batch that could not be
 *  finished stays "writing" and is free again after six minutes. */
export async function finishBatch(
  sb: SupabaseClient,
  batchId: string,
  f: { status: "ready" | "failed"; rejected: number; model: string | null; cost: number; error: string | null; solverRejected?: number },
): Promise<void> {
  try {
    const { error } = await sb.rpc(
      "study_question_finish",
      keyed({
        p_batch: batchId,
        p_status: f.status,
        p_rejected: f.rejected,
        p_model: f.model,
        p_cost: f.cost,
        p_error: f.error,
        p_solver_rejected: f.solverRejected ?? 0,
      }),
    );
    if (error) console.error(`study_question_finish ${batchId}: ${error.message}`);
  } catch (e) {
    console.error(`study_question_finish ${batchId}: ${errorText(e)}`);
  }
}

/** A practice 2.0 batch: its request's options and the points it covers. */
export type DraftMode = {
  requestId: string;
  difficulty: Difficulty;
  focus: string;
  /** The styles of the questions still to write (one each). */
  styles: Style[];
  /** The batch's points to know, in its order: "points" numbers them from 1. */
  points: Array<{ id: string } & RequestPoint>;
  memberStyle: { description: string; example: string } | null;
};

/** The solver runs only with this much time left, and a rewrite with this much. */
export const SOLVER_MIN_MS = 30_000;
export const REWRITE_MIN_MS = 100_000;
/** study_draft_replace's rule for the server's automatic rewrite (p_auto): a
 *  version that already has this many rewrites in its history (member's
 *  rewords included) is not rewritten automatically ('rewrite limit'). */
export const AUTO_REWRITE_LIMIT = 2;
/** study_draft_check's refusals for a draft that is no longer waiting (a
 *  member removed it, or kept it, while the solver read it). */
export const DRAFT_GONE: ReadonlySet<string> = new Set(["not pending", "draft not found"]);

/** One question that passed the checks in this run: its item, the model that
 *  wrote it, and its draft's id once saved (drafts mode). A staged case's
 *  later steps ride on its step 1 (`more`, their draft ids in `moreIds`). */
type Fresh = { item: SaveItem; servedBy: string; draftId?: string; more?: SaveItem[]; moreIds?: string[] };

/** The body study_save_question / study_draft_save receive: the item, the
 *  model, and its points as the points' ids. */
function saveBody(f: Fresh, pointIds: readonly string[]): Record<string, unknown> {
  return { ...f.item, model: f.servedBy, points: f.item.points.map((n) => pointIds[n - 1]).filter(Boolean) };
}

/** Writes the batch's questions. Two modes:
 *   bank (a release-1 round, no request): the questions of a call are
 *     checked, then answered by the blind solver; those it agrees with (or
 *     could not check) are saved into the bank and streamed ({"t":"q"});
 *   drafts (a practice 2.0 request): each question is saved as a draft as
 *     soon as it is checked ({"t":"draft"}), then the solver's verdict is
 *     stored with it ({"t":"check"}).
 *  In both, the questions the solver got wrong are written again once, in
 *  one call, and solved again: a rewrite it agrees with takes the place of
 *  the old one (a new draft that replaces it, or a question saved), any
 *  other is dropped ({"t":"drop"} for a draft; the batch counts it as the
 *  solver's). One model call for the wanted number, a second for the rest if
 *  fewer were valid and over 120 s remain. Every call is reserved first (the
 *  first by the op, before its stream, as `reserved`) and settled after it;
 *  the batch is always finished. A model error is rethrown after that, and
 *  so is the reason a part that made nothing stopped. */
export async function writeBatch(o: {
  client: Anthropic;
  sb: SupabaseClient;
  lecture: Lecture;
  batchId: string;
  claim: Claim;
  known: Known[];
  style: StyleInput | null;
  corrections: Correction[];
  stopAt: number;
  write: (line: string) => void;
  /** The first call's reservation, made before the stream started. */
  reserved?: number;
  part?: PartText;
  /** A practice 2.0 batch; absent: a release-1 round, into the bank. */
  drafts?: DraftMode;
  /** Image items: the part's pictures, signed (the writer and the solver see them). */
  pictures?: ReadonlyMap<string, Picture>;
  /** The writing's model (key practice, or set_write for a request's batch)
   *  and the blind solver's (key solver); left out: the default (routes.ts). */
  model?: string;
  solverModel?: string;
}): Promise<BatchResult> {
  const routed = o.model ?? MODEL;
  const solverModel = o.solverModel ?? MODEL;
  const optionCount = o.style?.optionCount ?? 5;
  const system = questionsSystem(o.lecture, o.style);
  const lectureSlides = new Set(o.lecture.slides.map((s) => s.n));
  const lectureText = deckText(o.lecture).toLowerCase();
  const blocks: NumberedBlock[] = o.part?.blocks ?? [];
  const part: PartView = { blocks, figures: o.part?.figures ?? [], labelled: o.part?.labelled ?? [] };
  const figures = new Set((o.part?.figures ?? []).map((f) => f.id));
  const pictures = o.pictures ?? new Map<string, Picture>();
  const pictureList = [...pictures.values()].slice(0, PICTURES_MAX);
  const types = typesCtx(o.lecture, o.part);
  let labels = 0; // label items made so far (name and tap in turn)
  const d = o.drafts;
  const pointIds = d ? d.points.map((p) => p.id) : [];
  const effort: Effort = d ? effortFor(d.difficulty, o.claim.effort) : o.claim.effort;
  const known = [...o.known];
  const warned = new Map<string, number>();
  const ref = o.batchId;
  let made = 0;
  let rejected = 0;
  let solverRejected = 0;
  let costUsd = 0;
  let unsettled = 0;
  let model: string | null = null;
  let error: string | null = null;
  let rewrote = false;
  /** The drafts a rewrite call was actually made for (only these are rejected
   *  when no rewrite of theirs comes back). */
  const tried = new Set<Fresh>();
  let styles = d ? [...d.styles] : [];

  const ctxFor = (k: Known[]) => ({
    optionCount,
    lectureSlides,
    from: o.claim.slide_from,
    to: o.claim.slide_to,
    known: k,
    blocks,
    figures,
    lectureText,
    styles: d ? [...new Set(d.styles)] : undefined,
    points: d ? d.points : undefined,
    ...types,
    labelIndex: labels,
  });
  const note = (r: { warnings: string[] }) => r.warnings.forEach((w) => warned.set(w, (warned.get(w) ?? 0) + 1));
  const extras = (st: Style[]): RequestExtras | undefined => (d ? { styles: st, difficulty: d.difficulty, points: d.points, focus: d.focus } : undefined);
  const timeLeft = () => o.stopAt - Date.now();

  /** Reserves a call (kind practice or solver), or null when refused (the
   *  80% line, the member's share): what was made so far stays. */
  const reserveOr = async (kind: "practice" | "solver", estimate: number): Promise<number | null> => {
    try {
      return await reserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind, ref, estimateUsd: estimate });
    } catch (e) {
      if (e instanceof HttpError) {
        error = e.message;
        return null;
      }
      throw e;
    }
  };

  /** Saves a checked question into the bank; true when it was saved. */
  const saveToBank = async (f: Fresh): Promise<boolean> => {
    const { data, error: e } = await o.sb.rpc("study_save_question", keyed({ p_batch: o.batchId, p_exam: null, p_q: saveBody(f, pointIds) }));
    if (e || typeof data !== "string") {
      rejected += 1;
      if (e) console.error(`study_save_question ${o.batchId}: ${e.message}`);
      return false;
    }
    made += 1;
    o.write(JSON.stringify(toPublic(data, o.claim.part_idx, f.item) satisfies WriteLine) + "\n");
    return true;
  };

  /** Saves a checked question as a draft of the request (or as the new
   *  version of `replaces`); its id, or null when the save failed. A staged
   *  case's later steps are saved after it, with its series. */
  const saveDraft = async (f: Fresh, replaces: { id: string; rewrites: number } | null): Promise<string | null> => {
    const id = await saveOneDraft(f, f.item, replaces);
    if (id && f.more?.length) {
      f.moreIds = [];
      for (const step of f.more) {
        const sid = await saveOneDraft(f, step, null);
        if (!sid) {
          // A step that cannot be saved leaves the case incomplete: it goes whole.
          await o.sb.rpc("study_draft_remove", { p_draft: id });
          o.write(JSON.stringify({ t: "drop", id } satisfies WriteLine) + "\n");
          return null;
        }
        f.moreIds.push(sid);
      }
    }
    return id;
  };
  const saveOneDraft = async (f: Fresh, item: SaveItem, replaces: { id: string; rewrites: number } | null): Promise<string | null> => {
    const body = saveBody({ ...f, item }, pointIds);
    const { data, error: e } = replaces
      ? await o.sb.rpc("study_draft_replace", keyed({ p_draft: replaces.id, p_q: body, p_auto: true }))
      : await o.sb.rpc("study_draft_save", keyed({ p_batch: o.batchId, p_q: body }));
    if (e || typeof data !== "string") {
      if (e) console.error(`${replaces ? "study_draft_replace" : "study_draft_save"} ${o.batchId}: ${e.message}`);
      return null;
    }
    const line = toDraftPublic(
      {
        id: data,
        requestId: d!.requestId,
        batchId: o.batchId,
        partIdx: o.claim.part_idx,
        style: item.style ?? d!.styles[0],
        points: body.points as string[],
        rewrites: replaces ? replaces.rewrites + 1 : 0,
        replaces: replaces?.id ?? null,
      },
      item,
    );
    o.write(JSON.stringify((replaces ? { ...line, replaces: replaces.id } : line) satisfies WriteLine) + "\n");
    return data;
  };

  /** Stores the solver's verdict on a draft ("check" line): the state the
   *  database judged. "gone": a member removed the draft while it was being
   *  checked (no line, never rewritten). */
  const checkDraft = async (id: string, v: Verdict | null, item?: Pick<SaveItem, "form">): Promise<"ok" | "failed" | "unchecked" | "gone"> => {
    const call = checkCall(id, item ?? { form: "one" }, v);
    const { data, error: e } = await o.sb.rpc(call.fn, keyed(call.args));
    if (e && DRAFT_GONE.has(e.message)) return "gone";
    const state = e || typeof data !== "string" ? (v ? (v.ok ? "ok" : "failed") : "unchecked") : (data as "ok" | "failed" | "unchecked");
    if (e) console.error(`${call.fn} ${id}: ${e.message}`);
    o.write(JSON.stringify({ t: "check", id, state } satisfies WriteLine) + "\n");
    return state;
  };

  /** The blind solver over these questions: a verdict each, or null for each
   *  when there is no time, the reservation is refused or the call fails
   *  (then they are "unchecked"). */
  const solve = async (fresh: Fresh[]): Promise<Array<Verdict | null>> => {
    if (!fresh.length) return [];
    if (timeLeft() < SOLVER_MIN_MS) return fresh.map(() => null);
    const items = fresh.map((f) => solverItemOf(f.item, pictures));
    const rid = await reserveOr("solver", solverEstimate(o.lecture, items, solverModel));
    if (rid === null) return fresh.map(() => null);
    try {
      const res = await solveQuestions({
        client: o.client,
        model: solverModel,
        reserveFallback: fallbackReserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "solver", ref }, () => (unsettled += 1), (sp) => (costUsd += sp.costUsd)),
        lecture: o.lecture,
        items,
        ref,
        stopAt: o.stopAt,
        ledger: async (s) => {
          costUsd += s.costUsd;
          return settleFor(o.sb, rid, () => (unsettled += 1))(s);
        },
      });
      return res.verdicts;
    } catch (e) {
      console.error(`solver ${o.batchId}: ${errorText(e)}`);
      return fresh.map(() => null);
    }
  };

  /** Writes again, in one call, the questions the solver got wrong; each
   *  rewrite checked as its own question. Returns them in order (null: not
   *  rewritten, or the rewrite failed its checks). */
  const rewrite = async (failed: Array<{ f: Fresh; v: Verdict }>): Promise<Array<Fresh | null>> => {
    const none = failed.map(() => null);
    if (!failed.length || rewrote || timeLeft() < REWRITE_MIN_MS) return none;
    rewrote = true;
    const user: TextBlock[] = [
      ...(d?.memberStyle ? [{ type: "text" as const, text: styleExampleBlock(d.memberStyle) }] : []),
      {
        type: "text",
        text: rewriteRequest({
          heading: o.claim.heading,
          from: o.claim.slide_from,
          to: o.claim.slide_to,
          options: optionCount,
          reason: "solver",
          items: failed.map(({ f, v }) => ({
            // A release-1 question may have no style: the writer keeps what it was.
            style: d ? (f.item.style ?? d.styles[0]) : f.item.style,
            points: f.item.points,
            vignette: f.item.vignette,
            question: f.item.question,
            options: f.item.options,
            answer: f.item.answer,
            form: f.item.form,
            seq: f.item.seq,
            prompts: f.item.layout?.kind === "match" ? f.item.layout.prompts : undefined,
            takeaway: f.item.takeaway,
            chose: v.choice >= 0 ? v.choice : null,
            ambiguous: v.ambiguous,
            blind: v.blind,
          })),
          blocks: part.blocks,
          figures: part.figures,
          extras: d ? extras(failed.map(({ f }) => f.item.style ?? d.styles[0])) : undefined,
        }),
      },
    ];
    // An image item is written again looking at the pictures, as it was first written.
    const seen = failed.some(({ f }) => f.item.style === "image") ? pictureList : [];
    const content: ContentBlock[] = [...user, ...pictureBlocks(seen)];
    const maxTokens = maxTokensFor(
      failed.length,
      failed.map(({ f }) => f.item.style ?? "case"),
    );
    const rid = await reserveOr("practice", callEstimate(system, content, maxTokens, picturesTokens(seen), routed));
    if (rid === null) return none;
    for (const { f } of failed) tried.add(f);
    // The originals are not duplicates of their own rewrites.
    const originals = new Set(failed.map(({ f }) => f.item.question));
    const others = known.filter((k) => !originals.has(k.question));
    const out: Array<Fresh | null> = [...none];
    let i = 0;
    try {
      await generateItems({
        client: o.client,
        model: routed,
        reserveFallback: fallbackReserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "practice", ref }, () => (unsettled += 1), (sp) => (costUsd += sp.costUsd)),
        kind: "practice",
        ref,
        system,
        messages: [{ role: "user", content }],
        effort,
        maxTokens,
        stopAt: o.stopAt,
        wrapper: QuestionSet,
        item: QuestionIn,
        onItem: (q, _index, servedBy) => {
          const at = i++;
          if (at >= failed.length) return;
          // A draft's rewrite keeps its style; a release-1 question's is read as written.
          const r = checkQuestion(q, { ...ctxFor(others), styles: d ? [failed[at].f.item.style ?? d.styles[0]] : undefined });
          if (!r.ok) {
            rejected += 1;
            o.write(JSON.stringify({ t: "skip", why: r.reasons[0] } satisfies WriteLine) + "\n");
            return;
          }
          note(r);
          out[at] = { item: r.item, servedBy };
        },
        ledger: async (s) => {
          costUsd += s.costUsd;
          return settleFor(o.sb, rid, () => (unsettled += 1))(s);
        },
      });
    } catch (e) {
      console.error(`rewrite ${o.batchId}: ${errorText(e)}`);
    }
    return out;
  };

  /** After a call: the solver over its questions, then one rewrite of those
   *  it got wrong, solved again. */
  const verify = async (all: Fresh[]): Promise<void> => {
    // A label item is keyed by the geometry (its draft is already "ok"): never solved.
    const fresh = all.filter((f) => !solverFree(f.item));
    // A staged case: every step solved; one failed step rejects the case, never rewritten.
    const staged = fresh.filter((f) => f.more?.length && f.moreIds?.length === f.more.length);
    const steps = staged.flatMap((f) => f.more!.map((item, k) => ({ f, item, id: f.moreIds![k] })));
    const single = fresh.filter((f) => !staged.includes(f) && !f.more?.length);
    const verdicts = await solve([...single, ...staged, ...steps.map((s) => ({ item: s.item, servedBy: s.f.servedBy }))]);
    // study_draft_reject takes a failed step and rejects its whole case: the first failed step of each.
    const caseFailed = new Map<Fresh, string>();
    for (let i = 0; i < staged.length; i++) {
      const v = verdicts[single.length + i] ?? null;
      if ((await checkDraft(staged[i].draftId!, v, staged[i].item)) === "failed" && !caseFailed.has(staged[i])) caseFailed.set(staged[i], staged[i].draftId!);
    }
    for (let i = 0; i < steps.length; i++) {
      const v = verdicts[single.length + staged.length + i] ?? null;
      if ((await checkDraft(steps[i].id, v, steps[i].item)) === "failed" && !caseFailed.has(steps[i].f)) caseFailed.set(steps[i].f, steps[i].id);
    }
    for (const id of caseFailed.values()) await rejectDraft(id);
    const failed: Array<{ f: Fresh; v: Verdict }> = [];
    for (let i = 0; i < single.length; i++) {
      const f = single[i];
      const v = verdicts[i] ?? null;
      if (d) {
        const state = await checkDraft(f.draftId!, v, f.item);
        if (state === "failed") failed.push({ f, v: v ?? { choice: -1, ambiguous: true, ok: false } });
      } else if (!v || v.ok) {
        await saveToBank(f);
      } else failed.push({ f, v });
    }
    if (!failed.length) return;
    const again = await rewrite(failed);
    const ready: Array<{ old: { f: Fresh; v: Verdict }; f: Fresh }> = [];
    for (let i = 0; i < failed.length; i++) {
      const f = again[i];
      if (!f) continue;
      if (d) {
        const id = await saveDraft(f, { id: failed[i].f.draftId!, rewrites: 0 });
        if (!id) continue;
        f.draftId = id;
      }
      known.push({ id: "new", part_idx: o.claim.part_idx, slides: f.item.slides, vignette: f.item.vignette, question: f.item.question, options: f.item.options, topic: f.item.topic, aspect: f.item.aspect });
      ready.push({ old: failed[i], f });
    }
    const second = await solve(ready.map((r) => r.f));
    const replaced = new Set(ready.map((r) => r.old));
    for (let i = 0; i < ready.length; i++) {
      const v = second[i] ?? null;
      if (d) {
        const state = await checkDraft(ready[i].f.draftId!, v, ready[i].f.item);
        if (state === "failed") await rejectDraft(ready[i].f.draftId!);
      } else if (!v || v.ok) {
        await saveToBank(ready[i].f);
      } else solverRejected += 1;
    }
    // Not rewritten (no time, refused, or the rewrite failed its checks).
    for (const old of failed) {
      if (replaced.has(old)) continue;
      if (d) {
        // Still the solver's failure: left for a member to reword or remove,
        // unless a rewrite of this draft was tried and failed, which rejects it.
        if (tried.has(old.f)) await rejectDraft(old.f.draftId!);
      } else solverRejected += 1;
    }
  };

  /** A draft the solver still got wrong: rejected ("drop" line). */
  const rejectDraft = async (id: string): Promise<void> => {
    const { error: e } = await o.sb.rpc("study_draft_reject", keyed({ p_draft: id }));
    if (e) {
      console.error(`study_draft_reject ${id}: ${e.message}`);
      return;
    }
    made -= 1;
    solverRejected += 1;
    o.write(JSON.stringify({ t: "drop", id } satisfies WriteLine) + "\n");
  };

  try {
    for (let call = 0; call < 2; call++) {
      const want = o.claim.wanted - made;
      if (want <= 0 || (call > 0 && timeLeft() < SECOND_CALL_MS)) break;
      // The styles still to write, one a question (the batch's in turn when a style was mapped to another).
      const callStyles = d ? Array.from({ length: want }, (_, i) => styles[i] ?? d.styles[i % d.styles.length]) : [];
      const user = questionsUser({
        claim: o.claim,
        want,
        optionCount,
        known,
        style: o.style,
        corrections: o.corrections,
        part,
        extras: extras(callStyles),
        memberStyle: d?.memberStyle ?? null,
        pictures: pictureList,
      });
      const maxTokens = maxTokensFor(want, d ? callStyles : undefined);
      let rid: number;
      if (call === 0 && o.reserved !== undefined) rid = o.reserved;
      else {
        const r = await reserveOr("practice", callEstimate(system, user, maxTokens, callStyles.includes("image") ? picturesTokens(pictureList) : 0, routed));
        if (r === null) break; // a refused second call keeps what the first made
        rid = r;
      }
      const settleIt = settleFor(o.sb, rid, () => (unsettled += 1));
      const fresh: Fresh[] = [];
      let saving: Promise<void> = Promise.resolve();
      const res = await generateItems({
        client: o.client,
        model: routed,
        reserveFallback: fallbackReserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "practice", ref }, () => (unsettled += 1), (sp) => (costUsd += sp.costUsd)),
        kind: "practice",
        ref,
        system,
        messages: [{ role: "user", content: user }],
        effort,
        maxTokens,
        stopAt: o.stopAt,
        wrapper: QuestionSet,
        item: QuestionIn,
        onStart: () => o.write('{"t":"start"}\n'),
        onItem: (q, _index, servedBy) => {
          const r = checkQuestion(q, ctxFor(known));
          if (!r.ok || fresh.length >= want) {
            rejected += 1;
            o.write(JSON.stringify({ t: "skip", why: r.ok ? "more than asked" : r.reasons[0] } satisfies WriteLine) + "\n");
            return;
          }
          note(r);
          const f: Fresh = { item: r.item, servedBy, ...(r.more?.length ? { more: r.more } : {}) };
          fresh.push(f);
          if (r.item.style === "label") labels += 1;
          for (const it of [r.item, ...(r.more ?? [])]) {
            known.push({ id: "new", part_idx: o.claim.part_idx, slides: it.slides, vignette: it.vignette, question: it.question, options: it.options, topic: it.topic, aspect: it.aspect });
          }
          if (d) {
            // A draft is saved as soon as it is checked: the group sees it at once.
            saving = saving.then(async () => {
              const id = await saveDraft(f, null);
              if (id) {
                f.draftId = id;
                made += 1;
                if (f.item.style) {
                  const k = styles.indexOf(f.item.style);
                  if (k >= 0) styles.splice(k, 1);
                }
              } else rejected += 1;
            });
          }
        },
        ledger: async (s) => {
          costUsd += s.costUsd;
          return settleIt(s);
        },
      });
      model = res.model;
      rejected += res.rejected; // items that were not valid JSON or failed the schema
      await saving;
      await verify(d ? fresh.filter((f) => f.draftId) : fresh);
      if (res.stop === "refusal") {
        error = "refusal";
        break;
      }
      if (res.timedOut) {
        error = "timeout";
        break;
      }
    }
    // Nothing made, and stopped for a reason (a refusal, the deadline, a refused
    // second reservation): the stream ends with that code (§4.6), as section.ts
    // ends a part that timed out. With questions made, the part is ready.
    if (made <= 0 && error) throw new HttpError(error === "timeout" ? 504 : 502, error);
  } catch (e) {
    error = errorText(e);
    throw e;
  } finally {
    if (warned.size) console.info(`questions ${o.batchId} warnings: ${JSON.stringify(Object.fromEntries(warned))}`);
    await finishBatch(o.sb, o.batchId, {
      status: made > 0 ? "ready" : "failed",
      rejected,
      model,
      cost: costUsd,
      error: made > 0 ? null : (error ?? "empty"),
      // A draft's rejection is counted by study_draft_reject itself.
      solverRejected: d ? 0 : solverRejected,
    });
  }
  return { made, rejected, solverRejected, costUsd, unsettled };
}

/* ── The op ── */

/** HTTP statuses of study_question_claim's refusals. */
const CLAIM_STATUS: Record<string, number> = { busy: 409, "gave up": 409, "batch not found": 404, forbidden: 403, "not signed in": 401 };

/** What this op needs of the schema: section Q at version 2 (Q's end and
 *  practice 2.0). The router has checked it (OP_SCHEMA); once found it is
 *  remembered for the instance. */
const NEEDS: Readonly<Record<string, number>> = { ...REQUIRED_SCHEMA, Q: 2 };
let sectionQ = false;
export async function assertSectionQ(): Promise<void> {
  if (sectionQ) return;
  const { data, error } = await serverClient().rpc("study_schema");
  if (error) throw new HttpError(500, error.message);
  if (!schemaOk(data, NEEDS)) throw new HttpError(503, "schema");
  sectionQ = true;
}

async function claimBatch(sb: SupabaseClient, batchId: string): Promise<Claim> {
  const { data, error } = await sb.rpc("study_question_claim", keyed({ p_batch: batchId }));
  if (error) throw new HttpError(CLAIM_STATUS[error.message] ?? 500, error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Claim | undefined;
  if (!row) throw new HttpError(500, "no claim");
  return { ...row, wanted: Number(row.wanted), effort: row.effort === "medium" ? "medium" : "high" };
}

/** Writes and never throws: once the phone has gone the batch is still
 *  written and saved (the group sees it through Realtime). */
export function safe(write: (s: string) => void): (s: string) => void {
  let gone = false;
  return (s) => {
    if (gone) return;
    try {
      write(s);
    } catch {
      gone = true;
    }
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const doneLine = (r: BatchResult) =>
  JSON.stringify({ t: "done", made: r.made, rejected: r.rejected, solverRejected: r.solverRejected, costUsd: round6(r.costUsd), unsettled: r.unsettled } satisfies WriteLine) + "\n";

type BatchRow = { lecture_id: string; request_id: string | null; points: string[] | null; styles: string[] | null };
type RequestRow = { id: string; difficulty: Difficulty; focus: string; style_note: string; style_example: string };

/** A request's batch: its options, its points (in the batch's order) and
 *  the styles of the questions it still has to write. */
async function draftMode(sb: SupabaseClient, batchId: string, batch: BatchRow): Promise<DraftMode> {
  const ids = batch.points ?? [];
  const [req, pts, mine] = await Promise.all([
    sb.from("study_question_requests").select("id, difficulty, focus, style_note, style_example").eq("id", batch.request_id!).maybeSingle(),
    ids.length
      ? sb.from("study_points").select("id, kind, subject, text, red_flag, anchor").in("id", ids)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    sb.from("study_question_drafts").select("style").eq("batch_id", batchId).in("status", ["pending", "kept"]),
  ]);
  for (const r of [req, pts, mine]) if (r.error) throw new HttpError(500, r.error.message);
  if (!req.data) throw new HttpError(404, "batch not found");
  const rq = req.data as RequestRow;
  const byId = new Map(((pts.data ?? []) as Array<{ id: string } & RequestPoint>).map((p) => [p.id, p]));
  // The batch's styles less those its drafts already have, one per question still to write.
  const styles = [...((batch.styles ?? []) as Style[])];
  for (const m of (mine.data ?? []) as Array<{ style: Style }>) {
    const k = styles.indexOf(m.style);
    if (k >= 0) styles.splice(k, 1);
  }
  return {
    requestId: rq.id,
    difficulty: rq.difficulty,
    focus: rq.focus ?? "",
    styles: styles.length ? styles : [...((batch.styles ?? ["case"]) as Style[])],
    points: ids.map((id) => byId.get(id)).filter((p): p is { id: string } & RequestPoint => !!p),
    memberStyle: rq.style_note ? { description: rq.style_note, example: rq.style_example ?? "" } : null,
  };
}

/** The lecture's pending drafts, public text only: a new request must not
 *  repeat what waits for review either. */
export async function knownDrafts(sb: SupabaseClient, lectureId: string): Promise<Known[]> {
  const { data, error } = await sb
    .from("study_question_drafts")
    .select("id, part_idx, vignette, question, options, slides, topic, aspect")
    .eq("lecture_id", lectureId)
    .eq("status", "pending")
    .order("created_at")
    .order("id");
  if (error) throw new HttpError(500, error.message);
  return ((data ?? []) as Known[]).map((k) => ({ ...k, part_idx: k.part_idx ?? null, slides: k.slides ?? [] }));
}

/** op "questions", writing one batch: { lectureId, batchId } (release 1's call, and each batch of a practice 2.0 request). */
export async function questionsWriteOp(req: Request, body: AiBody, started: number): Promise<Response> {
  // Ids as the database writes them, so the batch's lecture compares as text.
  const lectureId = typeof body.lectureId === "string" ? body.lectureId.toLowerCase() : "";
  const batchId = typeof body.batchId === "string" ? body.batchId.toLowerCase() : "";
  if (!UUID.test(lectureId) || !UUID.test(batchId)) throw new HttpError(400, "lectureId and batchId required");
  const { sb } = await memberClient(req);
  const client = anthropic(); // 500 "missing ANTHROPIC_API_KEY" before anything is claimed
  serverKey(); // 500 "missing STUDY_WORKER_KEY", likewise
  await assertSectionQ();
  const lecture = await loadLecture(sb, lectureId);

  // The batch must be this lecture's. Asked before the claim, which takes one of its three tries.
  const batch = await sb.from("study_question_batches").select("lecture_id, request_id, points, styles").eq("id", batchId).maybeSingle();
  if (batch.error) throw new HttpError(500, batch.error.message);
  if (!batch.data) throw new HttpError(404, "batch not found");
  const row = batch.data as BatchRow;
  if (row.lecture_id !== lectureId) throw new HttpError(400, "batch of another lecture");

  const claim = await claimBatch(sb, batchId);
  let known: Known[];
  let style: StyleInput | null;
  let corrections: Correction[];
  let part: PartText;
  let drafts: DraftMode | undefined;
  let reserved: number;
  let model: string;
  let solverModel: string;
  let pictures = new Map<string, Picture>();
  try {
    let pending: Known[];
    [known, style, part, drafts, pending] = await Promise.all([
      knownQuestions(sb, lectureId),
      courseStyle(sb, lecture),
      // A request's batch also reads the pictures' labels (question types); a release-1 round never writes them.
      readPart(sb, lectureId, claim, row.request_id ? lecture : undefined),
      row.request_id ? draftMode(sb, batchId, row) : Promise.resolve(undefined),
      row.request_id ? knownDrafts(sb, lectureId) : Promise.resolve([] as Known[]),
    ]);
    known = [...known, ...pending];
    corrections = await partCorrections(sb, lectureId, claim, part);
    if (claim.wanted <= 0) {
      // Every question of the part is already saved (a run whose finish was lost).
      await finishBatch(sb, batchId, { status: "ready", rejected: 0, model: null, cost: 0, error: null });
      return textStream(async (write) => write(doneLine({ made: 0, rejected: 0, solverRejected: 0, costUsd: 0, unsettled: 0 })));
    }
    // Image items: the writer and the solver look at the part's pictures.
    if (drafts?.styles.includes("image") && part.figures.length) pictures = await signPictures(sb, lecture, part.figures.slice(0, PICTURES_MAX).map((f) => f.id));
    const call = questionsCall({
      lecture,
      pictures: [...pictures.values()],
      effort: drafts ? effortFor(drafts.difficulty, claim.effort) : claim.effort,
      claim,
      want: claim.wanted,
      optionCount: style?.optionCount ?? 5,
      known,
      style,
      corrections,
      part,
      extras: drafts ? { styles: drafts.styles.slice(0, claim.wanted), difficulty: drafts.difficulty, points: drafts.points, focus: drafts.focus } : undefined,
      memberStyle: drafts?.memberStyle ?? null,
    });
    // A practice 2.0 request's batch (a practice set) is the set generator's key; a release-1 round, practice's.
    [model, solverModel] = await Promise.all([modelFor(sb, lecture.group_id, row.request_id ? "set_write" : "practice"), modelFor(sb, lecture.group_id, "solver")]);
    reserved = await reserve(sb, {
      groupId: lecture.group_id,
      lectureId,
      kind: "practice",
      ref: batchId,
      estimateUsd: callEstimate(call.system, call.messages[0].content as ContentBlock[], call.maxTokens, drafts?.styles.slice(0, claim.wanted).includes("image") ? picturesTokens([...pictures.values()]) : 0, model),
    });
  } catch (e) {
    await finishBatch(sb, batchId, { status: "failed", rejected: 0, model: null, cost: 0, error: errorText(e) });
    throw e;
  }

  return textStream(async (raw) => {
    const write = safe(raw);
    const res = await writeBatch({
      client,
      sb,
      lecture,
      batchId,
      claim,
      known,
      style,
      corrections,
      stopAt: started + TIME_LIMIT_MS,
      write,
      reserved,
      part,
      drafts,
      pictures,
      model,
      solverModel,
    });
    write(doneLine(res));
  });
}
