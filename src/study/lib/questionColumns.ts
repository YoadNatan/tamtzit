import { isChoiceForm, isNewStyle } from "../../../shared/study/forms";
import { flags } from "./flags";

/* ── The columns a build reads of study_questions (practice.ts's lists) ──
 * Pure (no client), so the unit tests read it. The question types' columns
 * (section Q at 3) only with VITE_STUDY_QTYPES: a build without the flag
 * works on any schema, and never asks a question of a new type (its style
 * says so, a column since Q 2). tools/study-contract.mjs checks every Q_*
 * constant here against study_questions. */

const FLAG_COLUMNS = "id, question_id, user_id, reason, note, created_at";
const Q_BASE = `id, group_id, lecture_id, exam_id, exam_no, ref_lecture, source, part_idx, kind, difficulty, vignette, question, options, slides, topic, aspect, has_key, created_by, created_at, retired_at, retired_by, retire_note, anchor, quote, part_gen, hidden_at, stale_at, style, figure`;
const Q_COLUMNS = `${Q_BASE}, study_question_flags(${FLAG_COLUMNS})`;
/** With the question types (section Q at 3): their columns too. */
const Q_TYPES_COLUMNS = `${Q_BASE}, form, layout, series, step, study_question_flags(${FLAG_COLUMNS})`;
/** The columns a build reads: the question types' only with their flag, so a build without it works on any schema. */
export const qColumns = (f: { qtypes: boolean } = flags): string => (f.qtypes ? Q_TYPES_COLUMNS : Q_COLUMNS);
/** A build without the question types never asks one (its style says it, a column since Q 2). */
export const visibleQuestions = <T extends { style?: string | null }>(rows: T[], f: { qtypes: boolean } = flags): T[] => (f.qtypes ? rows : rows.filter((q) => !isNewStyle(q.style)));
/** A group-wide list (a topic's session, t.<topic>) draws only the choice forms and never a
 *  similar question (uploaded sheets, release A1, design D15: study_private.q_plain's rule on the
 *  server): an open or numeric item belongs to its sheet's practice, a twin to its set. Whatever the flag. */
export const plainOnly = <T extends { form?: string | null; source?: string | null }>(rows: T[]): T[] =>
  rows.filter((q) => isChoiceForm(q.form ?? "one") && q.source !== "twin");
