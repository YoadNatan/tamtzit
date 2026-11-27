import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SIMILAR_JOB_ROOTS, similarCheckTokens, similarGenTokens } from "../../shared/study/sheetPrice.js";
import { estimateUsd, imageTokens } from "./budget.js";
import { recompute } from "./calc.js";
import { cleanSchema, JsonArrayItems, run, type Spend } from "./claude.js";
import { BLIND_SYSTEM, blindRequest, SIMILAR_SYSTEM, similarRequest, type BlindPart, type SimilarSource } from "./prompts/sheets.js";
import { BlindAnswer, BlindOut, SimilarOut, SimilarTwinOut } from "./questions.js";
import { normalize, similarity } from "./similar.js";
import { solveQuestions, solverEstimate, type SolverItem } from "./solver.js";
import { anthropic, errorText, HttpError, keyed, lectureBlock, SIMILAR_MODEL, type StoredSlide } from "./study.js";
import { figureOk } from "./writer.js";

/* ── Similar questions on the server (section O 3; docs/study/sheets.md,
 *    design-exams §8.1, D16-D20, D24) ──
 *
 * A run (op "similar") is reserved whole under the member and queued as
 * jobs; /api/study/work {similar} claims one (study_claim_similar) and runs
 * it here:
 *   1. one call writes the twins of the job's roots (SIMILAR_SYSTEM; a
 *      root whose figure has no fresh link is left out and counted);
 *   2. pure checks (toTwins): the root's form, option and prompt counts
 *      and parts kept, a key that fits, a numeric part's number recomputed
 *      from its working ($0, calc.ts), not too close to the root (0.8) or
 *      to another twin of it (0.7);
 *   3. one call answers every twin with a choice part again without its
 *      key: the slides' solver (solver.ts, kind "similar") when the sheet
 *      has a lecture and no twin reuses a figure, else BLIND_SYSTEM with
 *      the figures' pages. A twin is kept only when every part passes;
 *   4. study_similar_save, then study_similar_finish_job.
 * Every call is charged to the run through study_similar_charge (a settled
 * "similar" row in the requester's name; the reservation drops by as
 * much). Before each call its worst case must fit what the run has left;
 * when the charge says the next call no longer fits, the job saves what
 * passed and stops ("reserve_used"). The model is the current default
 * (SIMILAR_MODEL = MODEL; OD17, the models package routes the key
 * "similar" later). Never throws: an RPC that fails leaves the job to its
 * lease (330 s), and the next claim counts it. */

/** A root's part as the claim gives it. */
export type SimilarClaimPart = {
  id: string;
  step: number | null;
  label: string;
  form: string;
  question: string;
  options: string[];
  prompts: string[];
  answer: number | null;
  seq: number[] | null;
  num: number | null;
  num_unit: string | null;
  num_tol: number | null;
  explanations: string[] | null;
  takeaway: string | null;
  solution: string | null;
  figures: string[];
};
export type SimilarClaimRoot = {
  id: string;
  label: string;
  kind: string;
  vignette: string;
  topic: string;
  aspect: string;
  difficulty: number;
  parts: SimilarClaimPart[];
  pages: Array<{ n: number; path: string; w: number; h: number; url: string | null }>;
  twins: string[];
};
/** study_claim_similar's answer. */
export type SimilarClaim = {
  job: string;
  lease: string;
  attempt: number;
  last_error: string | null;
  run: { id: string; scope: "item" | "sheet"; per: number; requester: string; reserved_usd: number; charged_usd: number; left_usd: number; set_id: string | null };
  exam: { id: string; group_id: string; title: string; course: string; lecture_id: string | null };
  lecture: { id: string; title: string; lecturer: string; slides: StoredSlide[] } | null;
  items: SimilarClaimRoot[];
};

/** One checked twin as study_similar_save takes it. */
export type TwinPart = {
  form: string;
  question: string;
  options: string[];
  prompts: string[];
  answer: number;
  seq: number[];
  num?: number;
  num_unit?: string;
  num_tol?: number;
  explanations: string[];
  takeaway: string;
  solution: string;
};
export type Twin = { root: string; check: "recalc" | "blind" | "slides"; reuse_figure: boolean; vignette: string; parts: TwinPart[] };
export type JobResult = { status: "done" | "failed"; error: string | null; saved: number; dropped: number; costUsd: number };

/** Too close to its root, or to another twin of it (trigram Jaccard, similar.ts). */
export const TWIN_ROOT_MAX = 0.8;
export const TWIN_TWIN_MAX = 0.7;

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
/** As printed: runs of spaces and tabs made one, at most two blank lines, the ends trimmed. */
const keepLines = (s: string) =>
  String(s ?? "")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const one = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();
const textOf = (vignette: string, parts: ReadonlyArray<{ question: string }>) => [vignette, ...parts.map((p) => p.question)].join(" ");
const isPerm = (seq: readonly number[], n: number) => seq.length === n && new Set(seq).size === n && seq.every((v) => Number.isInteger(v) && v >= 0 && v < n);

/** A root's key in words for the request (pure). */
export function keyText(p: SimilarClaimPart): string {
  const letters = ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י"];
  if (p.form === "numeric") return `${p.num ?? "?"}${p.num_unit ? ` ${p.num_unit}` : ""}`;
  if (p.form === "one") return p.answer !== null && p.answer >= 0 ? letters[p.answer] ?? String(p.answer + 1) : "?";
  if (p.form === "tf") return (p.seq ?? []).map((v, k) => `${k + 1}: ${v === 1 ? "נכון" : "לא נכון"}`).join(", ");
  if (p.form === "match") return (p.seq ?? []).map((v, k) => `${k + 1}→${letters[v] ?? v + 1}`).join(", ");
  return (p.seq ?? []).map((v) => letters[v] ?? String(v + 1)).join(" ");
}

/** A root's figure pages with fresh links of this project, or null: a figure
 *  without one (the root is then left out of the job and counted). */
export function rootPages(r: SimilarClaimRoot): Array<{ n: number; url: string; w: number; h: number }> | null {
  const needed = [...new Set(r.parts.flatMap((p) => p.figures.map((f) => Number(f.split(":")[1]))).filter((n) => n > 0))].sort((a, b) => a - b);
  const out: Array<{ n: number; url: string; w: number; h: number }> = [];
  for (const n of needed) {
    const pg = r.pages.find((x) => x.n === n);
    if (!pg || !pg.url || !figureOk(pg.url, pg.path)) return null;
    out.push({ n, url: pg.url, w: pg.w, h: pg.h });
  }
  return out;
}
/** The pages as pictures after the text, each named for its ref. */
function pictureBlocks(ref: number, pages: ReadonlyArray<{ n: number; url: string }>): Anthropic.Beta.BetaContentBlockParam[] {
  return pages.flatMap((p) => [
    { type: "text" as const, text: `Ref ${ref}, page ${p.n}:` },
    { type: "image" as const, source: { type: "url" as const, url: p.url } },
  ]);
}

const schemaOf = (wrapper: Parameters<typeof zodOutputFormat>[0]) => cleanSchema(zodOutputFormat(wrapper).schema as Record<string, unknown>);
export const SIMILAR_SCHEMA = schemaOf(SimilarOut);
export const BLIND_SCHEMA = schemaOf(BlindOut);

type Call = { system: string; content: Anthropic.Beta.BetaContentBlockParam[]; maxTokens: number; inputChars: number; imageTokens: number };

/** The writing call for the roots that can be asked (exported for the
 *  tests): the request, its sizes, the roots in ref order, and how many
 *  were left out for a figure without a fresh link. */
export function similarCall(c: Pick<SimilarClaim, "exam" | "run" | "items">): { call: Call | null; roots: SimilarClaimRoot[]; skipped: number } {
  const roots: SimilarClaimRoot[] = [];
  const pictures: Anthropic.Beta.BetaContentBlockParam[] = [];
  let skipped = 0;
  let tokens = 0;
  for (const r of c.items) {
    const pages = rootPages(r);
    if (!pages) {
      skipped += 1;
      continue;
    }
    roots.push(r);
    pictures.push(...pictureBlocks(roots.length, pages));
    for (const p of pages) tokens += imageTokens(p.w, p.h);
  }
  if (!roots.length) return { call: null, roots, skipped };
  const sources: SimilarSource[] = roots.map((r, i) => ({
    ref: i + 1,
    label: r.label,
    vignette: r.vignette,
    figurePage: rootPages(r)?.[0]?.n ?? null,
    existing: r.twins.slice(0, 6),
    parts: r.parts.map((p) => ({ form: p.form, question: p.question, options: p.options, prompts: p.prompts, key: keyText(p), unit: p.num_unit, solution: p.solution })),
  }));
  const text = similarRequest({ course: c.exam.course, per: c.run.per, sources });
  const parts = roots.reduce((n, r) => n + r.parts.length, 0) * c.run.per;
  return {
    call: {
      system: SIMILAR_SYSTEM,
      content: [{ type: "text", text }, ...pictures],
      maxTokens: similarGenTokens(parts),
      inputChars: SIMILAR_SYSTEM.length + text.length,
      imageTokens: tokens,
    },
    roots,
    skipped,
  };
}

/** The twins as they may be checked and saved (pure). Each must name a
 *  root of the call, keep its parts, forms and sizes, carry a key that
 *  fits its form, recompute (a numeric part: its working gives its number
 *  within the tolerance, at least 0.5%) and differ from its root and from
 *  its root's other twins. At most `per` a root. `dropped` counts the rest. */
export function toTwins(roots: readonly SimilarClaimRoot[], raw: readonly SimilarTwinOut[], per: number): { twins: Twin[]; dropped: number } {
  const twins: Twin[] = [];
  let dropped = 0;
  const made = new Map<string, number>();
  const seen = new Map<string, string[]>(roots.map((r) => [r.id, [...r.twins]]));
  for (const t of raw) {
    const ref = int(t.ref);
    const r = ref !== null && ref >= 1 && ref <= roots.length ? roots[ref - 1] : null;
    if (!r || (made.get(r.id) ?? 0) >= per || !Array.isArray(t.parts) || t.parts.length !== r.parts.length) {
      dropped += 1;
      continue;
    }
    const vignette = keepLines(t.vignette ?? "");
    const parts: TwinPart[] = [];
    let ok = vignette.length <= 8000;
    for (let i = 0; ok && i < r.parts.length; i++) {
      const rp = r.parts[i];
      const p = t.parts[i];
      const question = keepLines(p.question ?? "");
      const options = rp.form === "numeric" ? [] : (p.options ?? []).map((o) => one(String(o ?? "")));
      const prompts = rp.form === "match" ? (p.prompts ?? []).map((o) => one(String(o ?? ""))) : [];
      const n = options.length;
      ok =
        question.length >= 5 &&
        question.length <= 4000 &&
        n === rp.options.length &&
        options.every((o) => o.length >= 1 && o.length <= 400) &&
        new Set(options.map(normalize)).size === n &&
        (rp.form !== "match" || (prompts.length === rp.prompts.length && prompts.every((o) => o.length >= 1 && o.length <= 300)));
      if (!ok) break;
      const answer = int(p.answer) ?? -1;
      const seq = (p.seq ?? []).map((v) => int(v) ?? -1);
      const whys = (p.whys ?? []).map((w) => one(String(w ?? "")).slice(0, 600));
      const base: TwinPart = {
        form: rp.form,
        question,
        options,
        prompts,
        answer: -1,
        seq: [],
        explanations: n > 0 && whys.length === n && whys.every((w) => w.length > 0) ? whys : [],
        takeaway: one(t.takeaway ?? "").slice(0, 600),
        solution: keepLines(p.solution ?? "").slice(0, 6000),
      };
      if (rp.form === "one") {
        ok = answer >= 0 && answer < n;
        base.answer = answer;
      } else if (rp.form === "tf") {
        ok = seq.length === n && seq.every((v) => v === 0 || v === 1);
        base.seq = seq;
      } else if (rp.form === "match") {
        ok = seq.length === prompts.length && new Set(seq).size === seq.length && seq.every((v) => v >= 0 && v < n);
        base.seq = seq;
      } else if (rp.form === "order") {
        ok = isPerm(seq, n);
        base.seq = seq;
      } else if (rp.form === "numeric") {
        const tol = Math.min(5, Math.max(0.5, Number(p.tol) || 1));
        const num = Number(p.num);
        ok = p.has_num === true && Number.isFinite(num) && Math.abs(num) < 1e12 && recompute(num, p.calc ?? { inputs: [], formula: "" }, tol).ok;
        Object.assign(base, { num, num_unit: one(p.unit ?? rp.num_unit ?? "").slice(0, 30), num_tol: Math.round(tol * 100) / 100 });
      } else {
        ok = false;
      }
      parts.push(base);
    }
    if (!ok) {
      dropped += 1;
      continue;
    }
    // Not the root again, nor another twin of it.
    const text = textOf(vignette, parts);
    const others = seen.get(r.id) ?? [];
    if (similarity(text, textOf(r.vignette, r.parts)) > TWIN_ROOT_MAX || others.some((o) => similarity(text, o) > TWIN_TWIN_MAX)) {
      dropped += 1;
      continue;
    }
    others.push(text);
    seen.set(r.id, others);
    made.set(r.id, (made.get(r.id) ?? 0) + 1);
    const hasFigure = r.parts.some((x) => x.figures.length > 0);
    twins.push({
      root: r.id,
      check: parts.every((x) => x.form === "numeric") ? "recalc" : "blind",
      reuse_figure: hasFigure && t.reuse_figure === true,
      vignette,
      parts,
    });
  }
  return { twins, dropped };
}

/** The blind check's request for the twins that need one (pure; exported for the tests). */
export function blindCall(twins: readonly Twin[], roots: readonly SimilarClaimRoot[]): { call: Call; asked: BlindPart[] } {
  const asked: BlindPart[] = [];
  const pictures: Anthropic.Beta.BetaContentBlockParam[] = [];
  let tokens = 0;
  twins.forEach((t, k) => {
    t.parts.forEach((p, i) => {
      if (p.form === "numeric") return;
      asked.push({ ref: k + 1, part: i + 1, form: p.form, vignette: i === 0 ? t.vignette : "", question: p.question, options: p.options, prompts: p.prompts });
    });
    if (t.reuse_figure) {
      const r = roots.find((x) => x.id === t.root);
      const pages = (r && rootPages(r)) || [];
      pictures.push(...pictureBlocks(k + 1, pages));
      for (const p of pages) tokens += imageTokens(p.w, p.h);
    }
  });
  const text = blindRequest(asked);
  return {
    call: { system: BLIND_SYSTEM, content: [{ type: "text", text }, ...pictures], maxTokens: similarCheckTokens(asked.length), inputChars: BLIND_SYSTEM.length + text.length, imageTokens: tokens },
    asked,
  };
}

/** Which twins pass the blind check (pure): every choice part answered
 *  with its key and a confidence of 2 or more. */
export function blindVerdicts(twins: readonly Twin[], answers: readonly BlindAnswer[]): boolean[] {
  const by = new Map<string, BlindAnswer>();
  for (const a of answers) {
    const k = `${a.ref}.${a.part}`;
    if (!by.has(k)) by.set(k, a);
  }
  return twins.map((t, k) =>
    t.parts.every((p, i) => {
      if (p.form === "numeric") return true;
      const a = by.get(`${k + 1}.${i + 1}`);
      if (!a || (int(a.conf) ?? 0) < 2) return false;
      if (p.form === "one") return a.answer === p.answer;
      const seq = (a.seq ?? []).map((v) => int(v));
      return seq.length === p.seq.length && seq.every((v, j) => v === p.seq[j]);
    }),
  );
}

/** One call's worst case, as its reservation share. */
export const callEstimate = (call: Call) => estimateUsd(SIMILAR_MODEL, call.inputChars, call.maxTokens, call.imageTokens);

/** The slides' solver's items for the twins' choice parts, and which twin each part is. */
function solverItems(twins: readonly Twin[]): { items: SolverItem[]; of: number[] } {
  const items: SolverItem[] = [];
  const of: number[] = [];
  twins.forEach((t, k) =>
    t.parts.forEach((p, i) => {
      if (p.form === "numeric") return;
      items.push({
        vignette: i === 0 ? t.vignette : "",
        question: p.question,
        options: p.options,
        ...(p.form !== "one" ? { form: p.form, seq: p.seq } : {}),
        ...(p.form === "match" ? { prompts: p.prompts } : {}),
        answer: p.form === "one" ? p.answer : null,
      });
      of.push(k);
    }),
  );
  return { items, of };
}

/** Takes the run's next job (the worker with the key alone; the phone's op with the member's token too), or null. */
export async function claimSimilar(sb: SupabaseClient, runId: string): Promise<SimilarClaim | null> {
  const { data, error } = await sb.rpc("study_claim_similar", keyed({ p_run: runId }));
  if (error) throw new HttpError(error.message === "forbidden" ? 403 : 500, error.message);
  if (!data || typeof data !== "object") return null;
  const c = data as SimilarClaim;
  const run = c.run;
  return {
    ...c,
    run: { ...run, per: Number(run.per) || 1, reserved_usd: Number(run.reserved_usd) || 0, charged_usd: Number(run.charged_usd) || 0, left_usd: Number(run.left_usd) || 0 },
    items: (c.items ?? []).map((r) => ({
      ...r,
      vignette: r.vignette ?? "",
      twins: r.twins ?? [],
      pages: r.pages ?? [],
      parts: (r.parts ?? []).map((p) => ({ ...p, options: p.options ?? [], prompts: p.prompts ?? [], figures: p.figures ?? [], seq: p.seq ?? null })),
    })),
  };
}

const log = (c: SimilarClaim, what: string, e: unknown) =>
  console.error(`study similar ${c.run.id} ${c.job}: ${what}: ${e instanceof Error ? e.message : String(e)}`);

/** The run's ledger for one call: charges it, and says whether the next
 *  call's worst case still fits (study_similar_charge). A charge that
 *  fails is tried once more; then the job stops (its reservation keeps
 *  the cost until the run ends). */
function charger(sb: SupabaseClient, c: SimilarClaim) {
  const state = { fits: true, failed: false, costUsd: 0, nextWorst: 0 };
  const ledger = async (s: Spend) => {
    state.costUsd += s.costUsd;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await sb.rpc(
        "study_similar_charge",
        keyed({ p_job: c.job, p_lease: c.lease, p_model: s.model, p_usage: s.usage, p_cost: Math.round(s.costUsd * 1e5) / 1e5, p_next_worst: state.nextWorst }),
      );
      if (!error) {
        state.fits = data === true;
        return true;
      }
      if (error.message === "lease lost") break;
    }
    state.failed = true;
    state.fits = false;
    return false;
  };
  return { state, ledger };
}

async function finishJob(sb: SupabaseClient, c: SimilarClaim, status: "done" | "failed", error: string | null): Promise<boolean> {
  const { data, error: e } = await sb.rpc("study_finish_similar_job", keyed({ p_job: c.job, p_lease: c.lease, p_status: status, p_error: error }));
  if (e) throw new HttpError(500, e.message);
  return data === true;
}

/** Reads a streamed {"<list>": [...]} reply: the whole document, or the items that closed. */
async function call<T>(
  o: { system: string; content: Anthropic.Beta.BetaContentBlockParam[]; maxTokens: number; stopAt: number; schema: Record<string, unknown>; ledger: (s: Spend) => Promise<unknown> },
  list: string,
  parse: (x: unknown) => T | null,
): Promise<{ items: T[]; error: string | null }> {
  let text = "";
  const scan = new JsonArrayItems();
  const raw: unknown[] = [];
  let res: Awaited<ReturnType<typeof run>> | null = null;
  try {
    res = await run({
      client: anthropic(),
      kind: "similar",
      ref: "unit",
      system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: o.content }],
      effort: "medium",
      maxTokens: o.maxTokens,
      stopAt: o.stopAt,
      format: { type: "json_schema", schema: o.schema },
      ledger: o.ledger,
      onText: (delta) => {
        text += delta;
        raw.push(...scan.push(delta));
      },
    });
  } catch (e) {
    return { items: raw.map(parse).filter((x): x is T => x !== null), error: errorText(e) };
  }
  let doc: Record<string, unknown> | null = null;
  try {
    const d = JSON.parse(text) as unknown;
    if (d && typeof d === "object" && !Array.isArray(d)) doc = d as Record<string, unknown>;
  } catch {
    /* cut off: the items that closed */
  }
  const items = (doc && Array.isArray(doc[list]) ? (doc[list] as unknown[]) : raw).map(parse).filter((x): x is T => x !== null);
  const error = res?.timedOut ? "timeout" : res?.stop === "refusal" ? "refusal" : !doc ? (res?.stop === "max_tokens" ? "truncated" : "unreadable") : null;
  return { items, error };
}

/** Runs one claimed job to its end (see the top of this file). */
export async function runSimilarJob(sb: SupabaseClient, c: SimilarClaim, opts: { stopAt: number }): Promise<JobResult> {
  const { call: gen, roots, skipped } = similarCall(c);
  const { state, ledger } = charger(sb, c);
  let left = c.run.left_usd;
  const end = async (status: "done" | "failed", error: string | null, twins: Twin[], dropped: number): Promise<JobResult> => {
    let saved = 0;
    try {
      if (twins.length || dropped || skipped) {
        const { data, error: e } = await sb.rpc(
          "study_similar_save",
          keyed({ p_job: c.job, p_lease: c.lease, p_twins: twins, p_dropped: dropped, p_skipped: skipped, p_model: SIMILAR_MODEL }),
        );
        if (e) throw new HttpError(e.message === "lease lost" ? 409 : 500, e.message);
        const r = (data ?? {}) as { saved?: number; dropped?: number };
        saved = r.saved ?? 0;
        dropped = r.dropped ?? dropped;
      }
      await finishJob(sb, c, status, error);
    } catch (e) {
      log(c, "left to its lease", e);
      return { status: "failed", error: e instanceof HttpError && e.status === 409 ? "lease_lost" : "writer", saved, dropped, costUsd: state.costUsd };
    }
    return { status, error, saved, dropped, costUsd: state.costUsd };
  };

  if (!gen) return end("done", null, [], 0); // every root needs a figure without a fresh link
  // The check's worst case, so the charge of the writing call says whether it still fits.
  const checkWorst = (twinParts: number, deck: number) =>
    estimateUsd(SIMILAR_MODEL, BLIND_SYSTEM.length + twinParts * 3_500 + deck, similarCheckTokens(twinParts), roots.reduce((n, r) => n + r.pages.reduce((k, p) => k + imageTokens(p.w, p.h), 0), 0));
  const choiceParts = roots.reduce((n, r) => n + r.parts.filter((p) => p.form !== "numeric").length, 0) * c.run.per;
  const deck = c.lecture && c.lecture.slides?.length ? lectureBlock(c.lecture).length : 0;
  const genWorst = callEstimate(gen);
  if (genWorst > left) return end("failed", "reserve_used", [], 0);
  state.nextWorst = choiceParts ? checkWorst(choiceParts, deck) : 0;
  const out = await call(
    { system: gen.system, content: gen.content, maxTokens: gen.maxTokens, stopAt: opts.stopAt, schema: SIMILAR_SCHEMA, ledger },
    "twins",
    (x) => {
      const r = SimilarTwinOut.safeParse(x);
      return r.success ? r.data : null;
    },
  );
  left -= state.costUsd;
  const { twins: candidates, dropped: badShape } = toTwins(roots, out.items, c.run.per);
  let dropped = badShape;
  const numericOnly = candidates.filter((t) => t.check === "recalc");
  const toCheck = candidates.filter((t) => t.check !== "recalc");
  if (out.error && !candidates.length) return end("failed", out.error, [], dropped);
  if (!toCheck.length || state.failed || !state.fits) {
    dropped += toCheck.length;
    return end(state.failed || !state.fits ? "failed" : "done", state.failed ? "unsettled" : !state.fits ? "reserve_used" : null, numericOnly, dropped);
  }

  // The check: the slides' solver when the sheet has a lecture and no twin leans on a figure; else blind.
  state.nextWorst = 0;
  let passed: boolean[] = toCheck.map(() => false);
  let check: "slides" | "blind" = "blind";
  try {
    if (deck > 0 && c.lecture && !toCheck.some((t) => t.reuse_figure)) {
      const { items, of } = solverItems(toCheck);
      if (solverEstimate(c.lecture, items) > left) return end("failed", "reserve_used", numericOnly, dropped + toCheck.length);
      check = "slides";
      const res = await solveQuestions({ client: anthropic(), lecture: c.lecture, items, ledger, stopAt: opts.stopAt, ref: "unit", kind: "similar" });
      passed = toCheck.map((_, k) => of.every((t, j) => t !== k || res.verdicts[j]?.ok === true) && of.includes(k));
    } else {
      const { call: bc } = blindCall(toCheck, roots);
      if (callEstimate(bc) > left) return end("failed", "reserve_used", numericOnly, dropped + toCheck.length);
      const ans = await call({ ...bc, stopAt: opts.stopAt, schema: BLIND_SCHEMA, ledger }, "answers", (x) => {
        const r = BlindAnswer.safeParse(x);
        return r.success ? r.data : null;
      });
      passed = blindVerdicts(toCheck, ans.items);
    }
  } catch (e) {
    log(c, "check", e); // unchecked twins are dropped, never saved
  }
  const kept = toCheck.filter((_, k) => passed[k]).map((t) => ({ ...t, check }));
  dropped += toCheck.length - kept.length;
  return end(state.failed ? "failed" : "done", state.failed ? "unsettled" : null, [...numericOnly, ...kept], dropped);
}

/** The worker's loop for one run (work.ts {similar}): jobs one after
 *  another while at least `minLeftMs` remain before stopAt. */
export async function runSimilar(sb: SupabaseClient, first: SimilarClaim, opts: { stopAt: number; minLeftMs?: number }): Promise<JobResult[]> {
  const results: JobResult[] = [];
  let c: SimilarClaim | null = first;
  while (c) {
    results.push(await runSimilarJob(sb, c, opts));
    if (Date.now() > opts.stopAt - (opts.minLeftMs ?? 120_000)) break;
    try {
      c = await claimSimilar(sb, c.run.id);
    } catch (e) {
      console.error(`study similar ${first.run.id}: next claim: ${errorText(e)}`);
      c = null;
    }
  }
  return results;
}

/** Re-exported for the op's worst case and the tests. */
export { SIMILAR_JOB_ROOTS };
