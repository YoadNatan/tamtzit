import { cardsOp } from "../../server/study/ops/cards.js"; // package C
import { askOp } from "../../server/study/ops/collab.js"; // package K (op "mnemonic" moved to J, §12.1.4)
import { trapCheckOp, whoamiOp } from "../../server/study/ops/extras.js"; // package E (F seeds 501)
import { fixCheckOp } from "../../server/study/ops/fixcheck.js"; // package K-2 (F seeds 501)
import { examExplainOp, examReadOp, questionsOp } from "../../server/study/ops/practice.js"; // package Q
import { plaqueOp } from "../../server/study/ops/pulse.js"; // package U-3 (F seeds 501)
import type { AiBody, Op } from "../../server/study/ops/types.js";
import { varOp } from "../../server/study/ops/var.js"; // package V
import { mnemonicOp, wallCheckOp } from "../../server/study/ops/wall.js"; // package J (F seeds 501)
import { assertSchema, errorText, HttpError, json, readBody, serverClient } from "../../server/study/study.js";

/* POST /api/study/ai  { op, ... }
 * One function for every generator but the summary, so the project stays
 * within Hobby's 12 functions: practice questions and past exams (Q),
 * flashcards (C), "לשאול" and the check of a correction (K), the wall's
 * drafts and its check (J), VAR (V), the museum's plaque (U), a member's
 * trap and "מי אני?" (E). Each op checks the member, reserves before each
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
};

async function handler(req: Request): Promise<Response> {
  const started = Date.now();
  try {
    const body = await readBody<AiBody>(req);
    const name = body && typeof body === "object" ? String(body.op ?? "") : "";
    const op = Object.hasOwn(OPS, name) ? OPS[name] : undefined;
    if (!op) throw new HttpError(400, "unknown op");
    await assertSchema(serverClient(), name);
    return await op(req, body, started);
  } catch (e) {
    return json(e instanceof HttpError ? e.status : 500, { error: errorText(e) });
  }
}

export default { fetch: handler };
