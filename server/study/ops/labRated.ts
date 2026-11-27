import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { numberBlocks } from "../../../shared/study/blocks.js";
import { DEFAULT_MODEL, modelInfo } from "../../../shared/study/models.js";
import { estimateUsd } from "../budget.js";
import { readInputs } from "../cards.js";
import { run, settleFor, type Spend } from "../claude.js";
import { LAB_NAMES, PATH_URL, shuffled, type Frozen } from "../lab.js";
import {
  askFrozen,
  cardsFrozen,
  CHECKED_ROUTES,
  checkedQuestions,
  judgeCall,
  judgeEstimate,
  judgeScores,
  partFrozen,
  pointsFrozen,
  practiceFrozen,
  practiceSolve,
  solveChecks,
  solveEstimate,
  type RatedKey,
  type RatedRoute,
} from "../labRated.js";
import { LAB_ASK_CHARS } from "../limits.js";
import { courseStyle, knownDrafts, knownQuestions, partCorrections, readPart } from "../practice.js";
import { errorText, HttpError, keyed, loadLecture, tidyMarkdown, type Lecture } from "../study.js";
import { partFigures, type InputSection } from "../writer.js";

/* ── Op "lab", the short kinds members rate (WP8): their material, read with
 *    the owner's token, and the paid steps after the answers ──
 *
 * The material: the group's newest lecture with a written part (or the one
 * asked for), its first written part (or the one asked for). "לשאול" also
 * takes the owner's typed question (at most LAB_ASK_CHARS characters).
 *
 * After the answers, in the same detached invocation (ops/lab.ts's
 * runSlots), two optional paid steps, each claimed on the worker's path
 * (study_lab_claim: one claim, one reservation with no user) so a second tab
 * or a later "check" pays nothing twice:
 *   solve  practice and a set's batch: the solver answers each answer's
 *          questions without their key; its agreement is merged into the
 *          answer's checks. A check that cannot start in time is left
 *          pending, for the "check" action ("לבדוק עכשיו").
 *   judge  the AI score (OD12), when the owner asked for it: one call over
 *          every finished answer under its label, in a random order (kept
 *          with each score), the slides' text only. Kept apart from the
 *          group's score (D13). */

type SectionRow = { idx: number; title: string; slide_from: number; slide_to: number; status: string; markdown: string | null; gen: number; error?: string | null };
export type RatedMaterial = { frozen: Frozen; lectureId: string; lecture: Lecture; title: string; source: Record<string, unknown> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ready = (s: SectionRow) => s.status === "ready" && Boolean((s.markdown ?? "").trim());

/** The lecture and its parts: the one asked for, or the group's newest with a written part. */
async function pickLecture(sb: SupabaseClient, group: string, want: unknown): Promise<{ lecture: Lecture; sections: SectionRow[] }> {
  let ids: string[];
  if (typeof want === "string" && UUID.test(want)) ids = [want.toLowerCase()];
  else {
    const { data, error } = await sb.from("study_lectures").select("id").eq("group_id", group).is("deleted_at", null).order("created_at", { ascending: false }).limit(12);
    if (error) throw new HttpError(500, error.message);
    ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }
  for (const id of ids) {
    const { data, error } = await sb.from("study_sections").select("idx, title, slide_from, slide_to, status, markdown, gen, error").eq("lecture_id", id).order("idx");
    if (error) throw new HttpError(500, error.message);
    const sections = (data ?? []) as SectionRow[];
    if (!sections.some(ready)) continue;
    const lecture = await loadLecture(sb, id).catch(() => null);
    if (!lecture || lecture.group_id !== group) continue;
    return { lecture, sections };
  }
  throw new HttpError(400, "no material");
}

/** The owner's typed question for "לשאול": 1 to LAB_ASK_CHARS characters. For a price only, a stand-in of the longest. */
export function askQuestion(v: unknown, forPrice: boolean): string {
  const q = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (q && q.length <= LAB_ASK_CHARS) return q;
  if (forPrice && !q) return "ש".repeat(LAB_ASK_CHARS);
  throw new HttpError(400, "no question");
}

/** A rated kind's material, read as production reads it (the owner's token). */
export async function ratedMaterial(sb: SupabaseClient, group: string, route: RatedRoute, source: Record<string, unknown>, forPrice = false): Promise<RatedMaterial> {
  const { lecture, sections } = await pickLecture(sb, group, source.lecture);
  const want = Number.isInteger(source.part) ? Number(source.part) : null;
  const sec = sections.find((s) => ready(s) && (want === null || s.idx === want)) ?? (want === null ? undefined : sections.find(ready));
  if (!sec) throw new HttpError(400, "no material");
  const part = { idx: sec.idx, heading: sec.title, from: sec.slide_from, to: sec.slide_to };
  const named = `${LAB_NAMES[route]} · ${lecture.title} · חלק ${sec.idx + 1}`;
  const base = { lectureId: lecture.id, lecture, title: named.slice(0, 160), source: { lecture: lecture.id, part: sec.idx } };
  switch (route) {
    case "practice":
    case "set_write": {
      const claim = { part_idx: sec.idx, slide_from: sec.slide_from, slide_to: sec.slide_to };
      const set = route === "set_write";
      const [text, known, pending, style] = await Promise.all([
        readPart(sb, lecture.id, claim, set ? lecture : undefined),
        knownQuestions(sb, lecture.id),
        set ? knownDrafts(sb, lecture.id) : Promise.resolve([]),
        courseStyle(sb, lecture),
      ]);
      const corrections = await partCorrections(sb, lecture.id, claim, text);
      return { ...base, frozen: practiceFrozen(route, lecture, part, { text, known: [...known, ...pending], style, corrections }) as Frozen };
    }
    case "points":
      return {
        ...base,
        frozen: pointsFrozen(lecture, { part_idx: sec.idx, heading: sec.title, slide_from: sec.slide_from, slide_to: sec.slide_to, md5: "", blocks: numberBlocks(sec.markdown ?? "") }) as Frozen,
      };
    case "cards": {
      const inputs = await readInputs(sb, lecture, { lecture_id: lecture.id, round: 0, part_idx: sec.idx, heading: sec.title, slide_from: sec.slide_from, slide_to: sec.slide_to, wanted: 0, effort: "medium" });
      return { ...base, frozen: cardsFrozen(lecture, part, inputs) as Frozen };
    }
    case "ask": {
      const question = askQuestion(source.question, forPrice);
      const summary = sections.filter(ready).map((s) => tidyMarkdown(s.markdown ?? ""));
      return { ...base, title: `${LAB_NAMES.ask} · ${lecture.title}`.slice(0, 160), source: { lecture: lecture.id }, frozen: askFrozen(lecture, summary, question) as Frozen };
    }
    case "part": {
      const input: InputSection[] = sections.map((s) => ({ idx: s.idx, title: s.title, slide_from: s.slide_from, slide_to: s.slide_to, status: s.status, error: s.error ?? null, markdown: s.markdown ?? "" }));
      const figures = partFigures(lecture, sec.slide_from, sec.slide_to).map((f) => ({ n: f.n, k: f.k, w: f.w ?? 0, h: f.h ?? 0, url: PATH_URL + f.path }));
      return { ...base, frozen: partFrozen(lecture, input, sec.idx, figures) as Frozen };
    }
  }
}

/** The model of a paid step: the key's route (study_models), the default when unset or not in the registry. */
export function stepModel(routes: Record<string, { model?: string | null } | undefined>, key: "solver" | "judge"): string {
  return modelInfo(routes[key]?.model ?? "")?.id ?? DEFAULT_MODEL;
}

/** The paid steps' worst case before a run: the solver per answer (practice), the AI score over every answer. */
export function stepsEstimate(o: { frozen: Frozen; lecture: Lecture; models: number; solver: string | null; judge: string | null }): { check: number; judge: number } {
  return {
    check: o.solver && CHECKED_ROUTES.has(o.frozen.route) ? solveEstimate(o.lecture, o.solver) * o.models : 0,
    judge: o.judge ? judgeEstimate(o.frozen, o.lecture, o.models, o.judge) : 0,
  };
}

/** Whether an answer waits for the paid check (it has a question the solver can answer). */
export function needsCheck(frozen: Pick<Frozen, "route" | "key">, text: string): boolean {
  if (!CHECKED_ROUTES.has(frozen.route)) return false;
  return checkedQuestions(frozen.key as Extract<RatedKey, { route: "practice" | "set_write" }>, text).some((q) => q.answer !== null);
}

type Claim = (label: string, part: "solve" | "judge", estimate: number) => Promise<number | string>;
type StepCtx = { sb: SupabaseClient; worker: SupabaseClient; client: Anthropic; runId: string; frozen: Frozen; lecture: Lecture; stopAt: number; claim: Claim; signal?: AbortSignal };

/** The time a paid step needs left to start (it is left pending otherwise). */
export const STEP_MIN_MS = 60_000;

/** One answer's paid check: claimed, the solver run on its questions, the
 *  agreement merged into its checks. Never throws; false when it was not run
 *  (no time, refused, nothing to check). */
export async function runCheck(o: StepCtx & { label: string; slot: number; output: string; text: string; model: string }): Promise<boolean> {
  if (Date.now() > o.stopAt - STEP_MIN_MS) return false;
  const solve = practiceSolve(o.lecture, o.frozen.key as Extract<RatedKey, { route: "practice" | "set_write" }>, o.text);
  if (!solve) return false;
  const c = solve.call;
  const chars = c.system.reduce((k, b) => k + b.text.length, 0) + c.messages.reduce((k, m) => k + (Array.isArray(m.content) ? m.content.reduce((j, b) => j + ("text" in b ? b.text.length : 0), 0) : 0), 0);
  const estimate = estimateUsd(o.model, chars, c.max_tokens);
  const id = await o.claim(o.label, "solve", estimate);
  if (typeof id !== "number") return false;
  let text = "";
  let status: "done" | "error" = "error";
  let checks: Record<string, unknown> = {};
  try {
    const res = await run({
      client: o.client,
      model: o.model,
      kind: "lab",
      ref: `run:${o.runId}:${o.slot}:solve`,
      system: c.system,
      messages: c.messages,
      effort: c.output_config.effort,
      maxTokens: c.max_tokens,
      format: c.output_config.format,
      stopAt: o.stopAt,
      fallbacks: false,
      appFallback: false,
      reservedUsd: estimate,
      ...(o.signal ? { signal: o.signal } : {}),
      ledger: settleFor(o.worker, id),
      onText: (d) => {
        text += d;
      },
    });
    if (res.stop !== "refusal" && !res.timedOut) {
      checks = solveChecks(solve.items, text, res.stop !== "max_tokens" && res.stop !== "aborted");
      status = "done";
    }
  } catch (e) {
    console.error(`lab check ${o.runId}: ${errorText(e).slice(0, 200)}`);
  }
  const { error } = await o.worker.rpc("study_lab_check_save", keyed({ p_output: o.output, p_checks: checks, p_status: status }));
  if (error) console.error(`lab check save ${o.runId}: ${error.message}`);
  return status === "done";
}

/** The AI score: claimed once for the run (label j), the judge over every
 *  finished answer (study_lab_judge_input, the owner's token and the key) in
 *  a random order, each answer's score saved by the worker; a reply that
 *  could not be read marks the AI score failed. Never throws. */
export async function runJudge(o: StepCtx & { model: string; random?: () => number }): Promise<boolean> {
  if (Date.now() > o.stopAt - STEP_MIN_MS) return false;
  const { data, error } = await o.sb.rpc("study_lab_judge_input", keyed({ p_run: o.runId }));
  if (error) {
    console.error(`lab judge input ${o.runId}: ${error.message}`);
    return false;
  }
  const outputs = ((data as { outputs?: Array<{ label: string; output: string; text: string | null }> } | null)?.outputs ?? []).filter((x) => (x.text ?? "").trim());
  if (outputs.length < 2) return false;
  const order = shuffled(outputs, o.random);
  const call = judgeCall({ lecture: o.lecture, route: o.frozen.route, material: o.frozen.material, answers: order.map((x) => ({ label: x.label, text: x.text ?? "" })) });
  const chars = call.system.reduce((k, b) => k + b.text.length, 0) + String(call.messages[0].content).length + JSON.stringify(call.format.schema).length;
  const estimate = estimateUsd(o.model, chars, call.maxTokens);
  const id = await o.claim("j", "judge", estimate);
  if (typeof id !== "number") return false;
  let text = "";
  let spend: Spend | null = null;
  let finished = false;
  try {
    const res = await run({
      client: o.client,
      model: o.model,
      kind: "lab",
      ref: `run:${o.runId}:j:judge`,
      system: call.system,
      messages: call.messages,
      effort: call.effort,
      maxTokens: call.maxTokens,
      format: call.format,
      stopAt: o.stopAt,
      fallbacks: false,
      appFallback: false,
      reservedUsd: estimate,
      ...(o.signal ? { signal: o.signal } : {}),
      ledger: async (sp) => {
        spend = sp;
        return settleFor(o.worker, id)(sp);
      },
      onText: (d) => {
        text += d;
      },
    });
    finished = res.stop !== "refusal" && !res.timedOut;
  } catch (e) {
    console.error(`lab judge ${o.runId}: ${errorText(e).slice(0, 200)}`);
  }
  const scores = finished ? judgeScores(text, outputs.map((x) => x.label)) : new Map();
  const cost = ((spend as Spend | null)?.costUsd ?? 0) / outputs.length;
  const save = async (output: string, s: Record<string, unknown> | null, usd: number) => {
    const { error: e } = await o.worker.rpc("study_lab_judged", keyed({ p_output: output, p_judge: o.model, p_scores: s, p_cost: usd }));
    if (e) console.error(`lab judged ${o.runId}: ${e.message}`);
  };
  for (const x of outputs) {
    const s = scores.get(x.label);
    if (s) await save(x.output, { ...s, order: order.findIndex((y) => y.label === x.label) }, cost);
  }
  const missing = outputs.find((x) => !scores.has(x.label));
  if (missing) await save(missing.output, null, 0);
  return !missing;
}
