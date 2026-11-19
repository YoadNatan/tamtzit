import { assertSectionQ, questionsWriteOp } from "../practice.js";
import { PRACTICE2_ACTIONS } from "../practice2.js";
import { HttpError } from "../study.js";
import type { Op } from "./types.js";

/* Package Q's server slot (spec §4.6): the ops "questions" (practice.ts and,
 * for practice 2.0's actions, practice2.ts), "exam_read" and "exam_explain".
 * Op "questions" picks by `action`: none (or "write") writes one batch
 * ({ lectureId, batchId }, release 1's call and each batch of a request);
 * "points", "plan", "create", "style" and "reword" are practice 2.0's
 * (docs/study/practice-2-api.md). Past exams are Q's second milestone (Q-2,
 * exams.ts); until it lands, their two ops answer 501 "not built" and call
 * no model. */
const notBuilt: Op = async () => {
  throw new HttpError(501, "not built");
};

export const questionsOp: Op = async (req, body, started) => {
  const action = body.action === undefined ? "write" : body.action;
  if (action === "write") return questionsWriteOp(req, body, started);
  const handler = typeof action === "string" && Object.hasOwn(PRACTICE2_ACTIONS, action) ? PRACTICE2_ACTIONS[action] : undefined;
  if (!handler) throw new HttpError(400, "bad action");
  await assertSectionQ();
  return handler(req, body, started);
};
export const examReadOp: Op = notBuilt;
export const examExplainOp: Op = notBuilt;
