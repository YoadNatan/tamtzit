import { isSetForm } from "../../../shared/study/forms";
import { answerQuestion, answerSet, type Bet, type Feedback, type Mode } from "./practice";
import { toStored } from "./practiceSession";
import { toStoredSet } from "../../../shared/study/forms";

/* ── Answering any question type (docs/study/question-types.md) ──
 *
 * One call for every screen that asks a question (a practice session, Today,
 * the meeting's catch-up): a one-answer question (form one, or tap) goes to
 * study_answer_question with the stored index of the option shown; a set
 * question (tf, match, order) to study_answer_set with its choices put back
 * in the stored order. null is "לא יודעים" (and then no bet). */

export type Response = number | number[] | null;

export async function answerAny(
  q: { id: string; form?: string },
  order: readonly number[],
  response: Response,
  mode: Mode,
  ms: number,
  bet: Bet | null,
  /** A practice set's attempt: the answer goes through its wrapper and is stamped with it. */
  attempt?: string,
): Promise<{ feedback: Feedback; choice: number | number[] | null }> {
  if (isSetForm(q.form)) {
    const shown = Array.isArray(response) ? response : null;
    const choices = shown ? toStoredSet(q.form, order, shown) : null;
    const feedback = await answerSet(q.id, choices, mode, ms, shown ? bet : null, attempt);
    return { feedback, choice: choices };
  }
  const shown = typeof response === "number" ? response : null;
  const choice = toStored(order, shown);
  const feedback = await answerQuestion(q.id, choice, mode, ms, shown === null ? null : bet, attempt);
  return { feedback, choice };
}
