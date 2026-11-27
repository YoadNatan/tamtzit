import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { estimateUsd, imageTokens } from "./budget.js";
import { cleanSchema, generateItems, type Ledger } from "./claude.js";
import { SOLVER_SYSTEM, solverRequest, type SolverText } from "./prompts/solver.js";
import { type Lecture, lectureBlock, MODEL } from "./study.js";

/* ── The blind solver (spec §12.3.Q, P7; practice 2.0) ──
 *
 * After a part's questions pass checkQuestion, a careful student answers them
 * from the slides alone: the request carries each question's vignette,
 * lead-in and options in their stored order, never the key, an explanation,
 * "מתי כן" or the takeaway. A question is kept only when the solver chose the
 * key and called no other option defensible; a missing answer in a finished
 * reply is a disagreement. One request shape for both paths (solverCall): on
 * a tap it runs inside op "questions" with its own reservation (kind
 * "solver", ref the batch or the draft), and section B batches the same
 * request. Effort low: the solver reads, it does not write. */

export const SolverAnswer = z.object({
  id: z.string().describe("The question's label, q1, q2 …"),
  choice: z.number().int().describe("0-based index of the option the slides support"),
  ambiguous: z.boolean().describe("true when another option is also defensible from the slides"),
  seq: z
    .array(z.number().int())
    .describe("A question with several parts: tf 1 or 0 per statement; match the option's index per prompt; order the steps' indexes in their order. An empty array for a one-answer question"),
});
export const SolverSet = z.object({ answers: z.array(SolverAnswer) });
/** As the reply is read back: "seq" defaulted (a one-answer question's reply from before the question types). */
const SolverAnswerIn = SolverAnswer.extend({ seq: z.array(z.number().int()).default([]) });
export type SolverAnswer = z.infer<typeof SolverAnswer>;

/** The schema sent: the addendum's JSON (cleanSchema drops only the SDK's integer bounds). */
export const SOLVER_SCHEMA = cleanSchema(zodOutputFormat(SolverSet).schema as Record<string, unknown>);
export const SOLVER_EFFORT = "low" as const;
/** max_tokens of a call for n questions (§12.3.Q). */
export const solverMaxTokens = (n: number): number => 1_000 + 250 * n;

/** A question the solver answers: its public text, and the key the server
 *  holds to judge the reply (never sent): the answer, or a set question's seq. */
export type SolverItem = SolverText & { answer: number | null; seq?: readonly number[] | null };
/** The solver's reply to one question: its choice (-1: none, or out of
 *  range), whether it found another option defensible, and whether that
 *  keeps the question; for a set question the order it gave. */
export type Verdict = { choice: number; ambiguous: boolean; ok: boolean; seq?: number[]; blind?: boolean };

type TextBlock = Anthropic.Beta.BetaTextBlockParam;
export type SolverRequest = {
  system: TextBlock[];
  messages: Anthropic.Beta.BetaMessageParam[];
  max_tokens: number;
  output_config: { effort: typeof SOLVER_EFFORT; format: { type: "json_schema"; schema: Record<string, unknown> } };
};

/** The one request of the solver: [SOLVER_SYSTEM, the lecture (cached)] and
 *  the questions as q1 … qN, without their keys. */
export function solverCall(o: { lecture: Pick<Lecture, "lecturer" | "slides">; items: readonly SolverText[] }): SolverRequest {
  // Only the public text travels (and an image item's picture): whatever else an item carries stays here.
  const items = o.items.map((it) => ({
    vignette: it.vignette,
    question: it.question,
    options: [...it.options],
    ...(it.form ? { form: it.form } : {}),
    ...(it.prompts ? { prompts: [...it.prompts] } : {}),
    ...(it.image ? { image: it.image } : {}),
    ...(it.withoutPicture ? { withoutPicture: true } : {}),
  }));
  const pictures: Anthropic.Beta.BetaContentBlockParam[] = items.flatMap((it, i) =>
    it.image
      ? [
          { type: "text" as const, text: `q${i + 1}:` },
          { type: "image" as const, source: { type: "url" as const, url: it.image } },
        ]
      : [],
  );
  return {
    system: [
      { type: "text", text: SOLVER_SYSTEM },
      { type: "text", text: lectureBlock(o.lecture), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: [{ type: "text", text: solverRequest(items) }, ...pictures] }],
    max_tokens: solverMaxTokens(items.length),
    output_config: { effort: SOLVER_EFFORT, format: { type: "json_schema", schema: SOLVER_SCHEMA } },
  };
}

/** The call's worst case, which its reservation holds (an image item is
 *  asked twice, with and without its picture, and a picture is at most
 *  MAX_PICTURE_SIDE square). */
export function solverEstimate(lecture: Pick<Lecture, "lecturer" | "slides">, items: readonly SolverText[]): number {
  const c = solverCall({ lecture, items: withTwins(items).all });
  const chars =
    c.system.reduce((n, b) => n + b.text.length, 0) +
    c.messages.reduce((n, m) => n + (Array.isArray(m.content) ? m.content.reduce((k, b) => k + ("text" in b ? b.text.length : 0), 0) : 0), 0);
  return estimateUsd(MODEL, chars, c.max_tokens, items.filter((it) => it.image).length * imageTokens());
}

/** The items as asked: each, then (after all of them, so q1 … qN stay the
 *  items) every image item again without its picture. `twin[i]` is the
 *  index of item i's twin. */
export function withTwins<T extends SolverText>(items: readonly T[]): { all: T[]; twin: Map<number, number> } {
  const all = [...items];
  const twin = new Map<number, number>();
  items.forEach((it, i) => {
    if (!it.image) return;
    twin.set(i, all.length);
    all.push({ ...it, image: undefined, withoutPicture: true } as T);
  });
  return { all, twin };
}

/** The verdict on each item, from the solver's answers (labels matched in
 *  any case; the first answer to a label counts). `complete` is false when
 *  the reply stopped early: an item it did not reach is not judged (null). */
export function verdictsOf(
  items: readonly { answer: number | null; options: readonly string[]; seq?: readonly number[] | null }[],
  answers: readonly SolverAnswer[],
  complete: boolean,
): Array<Verdict | null> {
  const by = new Map<string, SolverAnswer>();
  for (const a of answers) {
    const id = a.id.trim().toLowerCase();
    if (!by.has(id)) by.set(id, a);
  }
  return items.map((it, i) => {
    const a = by.get(`q${i + 1}`);
    if (!a) return complete ? { choice: -1, ambiguous: true, ok: false, ...(it.seq ? { seq: [] } : {}) } : null;
    if (it.seq) {
      // A set question: its order must be the key's, element by element.
      const seq = (a.seq ?? []).filter((v) => Number.isInteger(v));
      const same = seq.length === it.seq.length && seq.every((v, k) => v === it.seq![k]);
      return { choice: -1, ambiguous: a.ambiguous, ok: same && !a.ambiguous, seq };
    }
    const inRange = Number.isInteger(a.choice) && a.choice >= 0 && a.choice < it.options.length;
    return { choice: inRange ? a.choice : -1, ambiguous: a.ambiguous, ok: inRange && a.choice === it.answer && !a.ambiguous };
  });
}

/** Answers the items without their keys, through `ledger` (the caller's
 *  reservation, kind "solver" unless `kind` says otherwise). Returns each item's verdict (null: not
 *  judged, the reply stopped before it), the items kept, how many the
 *  solver rejected, and the call's cost. A model error is the caller's: a
 *  question it could not check is "unchecked", never rejected. */
export async function solveQuestions<T extends SolverItem>(o: {
  client: Anthropic;
  lecture: Pick<Lecture, "lecturer" | "slides">;
  items: readonly T[];
  ledger: Ledger;
  stopAt: number;
  ref?: string | null;
  /** The ledger kind the call is made as: "solver" (practice), or "similar"
   *  when it checks a sheet's similar questions inside their run's
   *  reservation (section O 3; the ledger itself is the caller's). */
  kind?: string;
}): Promise<{ verdicts: Array<Verdict | null>; kept: T[]; rejected: number; costUsd: number }> {
  if (!o.items.length) return { verdicts: [], kept: [], rejected: 0, costUsd: 0 };
  const { all, twin } = withTwins(o.items);
  const call = solverCall({ lecture: o.lecture, items: all });
  const answers: SolverAnswer[] = [];
  let costUsd = 0;
  const res = await generateItems({
    client: o.client,
    kind: o.kind ?? "solver",
    ref: o.ref ?? null,
    system: call.system,
    messages: call.messages,
    effort: call.output_config.effort,
    maxTokens: call.max_tokens,
    stopAt: o.stopAt,
    wrapper: SolverSet,
    item: SolverAnswerIn,
    onItem: (a) => answers.push(a),
    ledger: async (s) => {
      costUsd += s.costUsd;
      return o.ledger(s);
    },
  });
  const complete = !res.timedOut && res.stop !== "refusal" && res.stop !== "aborted" && res.stop !== "max_tokens";
  const asked = verdictsOf(all, answers, complete);
  const verdicts = o.items.map((it, i): Verdict | null => {
    // An image item whose picture could not be signed is not judged ("unchecked"), never passed blind.
    if (it.withoutPicture) return null;
    const v = asked[i];
    const t = twin.has(i) ? asked[twin.get(i)!] : null;
    if (!v) return null;
    // Solved without the picture, the key and nothing else: the picture adds nothing.
    if (v.ok && t && t.choice === it.answer && !t.ambiguous) return { ...v, ok: false, blind: true };
    return v;
  });
  return {
    verdicts,
    kept: o.items.filter((_, i) => verdicts[i]?.ok),
    rejected: verdicts.filter((v) => v && !v.ok).length,
    costUsd,
  };
}
