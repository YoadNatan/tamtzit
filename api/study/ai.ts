import { cardsOp } from "../../server/study/ops/cards.js"; // package C
import { askOp } from "../../server/study/ops/collab.js"; // package K (op "mnemonic" moved to J, §12.1.4)
import { trapCheckOp, whoamiOp } from "../../server/study/ops/extras.js"; // package E (F seeds 501)
import { fixCheckOp } from "../../server/study/ops/fixcheck.js"; // package K-2 (F seeds 501)
import { labOp } from "../../server/study/ops/lab.js"; // package Y (section Y: "השוואת מודלים")
import { examExplainOp, examReadOp, questionsOp } from "../../server/study/ops/practice.js"; // package Q
import { plaqueOp } from "../../server/study/ops/pulse.js"; // package U-3 (F seeds 501)
import { similarOp } from "../../server/study/ops/similar.js"; // package O (section O 3: similar questions)
import type { AiBody, Op } from "../../server/study/ops/types.js";
import { varOp } from "../../server/study/ops/var.js"; // package V
import { mnemonicOp, wallCheckOp } from "../../server/study/ops/wall.js"; // package J (F seeds 501)
import { assertSchema, errorText, HttpError, json, readBody, serverClient } from "../../server/study/study.js";

/* POST /api/study/ai  { op, ... }
 * One function for every generator but the summary, so the project stays
 * within Hobby's 12 functions: practice questions and past exams (Q),
 * flashcards (C), "לשאול" and the check of a correction (K), the wall's
 * drafts and its check (J), VAR (V), the museum's plaque (U), a member's
 * trap and "מי אני?" (E), an uploaded sheet's similar questions (O), the
 * models' comparison and routes (Y, op lab: the owner only). Each op checks the member, reserves before each
 * model call and settles after it (spec §4.2). The router answers 400 for an
 * unknown op and 503 "schema" while the database is older than the op needs
 * (assertSchema's per-op needs, §12.2.2); an op its package has not built
 * answers 501. */

// Node.js runtime (see health.ts): up to 300 s with Fluid compute, also on Hobby.
export const config = { maxDuration: 300 };

const OPS: Record<string, Op> = {
  questions: questionsOp,
  exam_read: examReadOp,
  exam_explain: examExplainOp,
  cards: cardsOp,
  ask: askOp,
  fix_check: fixCheckOp,
  mnemonic: mnemonicOp,
  wall_check: wallCheckOp,
  plaque: plaqueOp,
  var: varOp,
  trap_check: trapCheckOp,
  whoami: whoamiOp,
  similar: similarOp,
  lab: labOp,
};

/** The 401s a member's session answers: logged, so the Vercel log tells a
 *  session that cannot refresh from a server that fails. */
const SESSION_CODES = new Set(["session expiring", "session expired"]);

/** One line in the function's log for a failure the member cannot fix: a
 *  status of 500 or more, or a session refused. The op, its action, the
 *  status and the code only: never the token, the body or a member's data. */
function logFailure(op: string, action: unknown, status: number, error: string): void {
  if (status < 500 && !(status === 401 && SESSION_CODES.has(error))) return;
  const act = typeof action === "string" && /^[a-z_]{1,32}$/.test(action) ? action : "-";
  console.error("ai", op || "-", act, status, error.slice(0, 200));
}

async function handler(req: Request): Promise<Response> {
  const started = Date.now();
  let name = "";
  let action: unknown;
  try {
    const body = await readBody<AiBody>(req);
    name = body && typeof body === "object" ? String(body.op ?? "") : "";
    const op = Object.hasOwn(OPS, name) ? OPS[name] : undefined;
    if (!op) throw new HttpError(400, "unknown op");
    action = body.action;
    await assertSchema(serverClient(), name);
    return await op(req, body, started);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const error = errorText(e);
    logFailure(name, action, status, error);
    return json(status, { error });
  }
}

export default { fetch: handler };
