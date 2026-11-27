import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";
import { numberBlocks } from "../../shared/study/blocks.js";
import { costUsd, estimateUsd, imageTokens, reserve, settle, type UsageLike } from "./budget.js";
import { claudeFields, cleanSchema, run, type FallbackReserve, type RunOpts, type Spend } from "./claude.js";
import { modelFor } from "./routes.js";
import { checkNotes, Notes, parseNotes, type RecNoteItem } from "./notes.js";
import { RECORDING_SYSTEM, recordingRequest } from "./prompts/recording.js";
import { correctionsForRewrite, OUTLINE_INSTRUCTIONS, sectionRequest, SUMMARY_SYSTEM, targetWords } from "./prompts/summary.js";
import { anthropic, deckText, errorText, HttpError, lectureBlock, MODEL, slideText, tidyMarkdown, type Lecture, type StoredSlide } from "./study.js";

/* ── The writer both paths share (spec §2.3, §4.3.2) ──
 *
 * A lecture is written in units: its outline, then each part, then (with a
 * recording) each part's notes. A writer first claims a unit through
 * study_claim, which hands out leases (330 s) under a per-group lock, so two
 * writers never write one part: the server worker (api/study/work.ts, kicked
 * by pg_net, with the server key alone) and a member's phone (outline.ts and
 * section.ts, with the member's token and the key) take units from the same
 * queue. This file writes one claimed unit to the end and saves it through
 * the RPCs, every one of which carries the server key (review B1).
 *
 * Each model call reserves its worst case first (study_reserve; a refusal
 * finishes the unit with its code and never calls the model), and the
 * reservation's id goes to study_finish / study_outline_done as p_charge,
 * which settle it with the real cost, also when the lease was lost (that
 * writer still spent the money). A unit whose function dies keeps its
 * estimate in the ledger and its lease runs out; the next claim counts it as
 * an attempt (§2.3).
 *
 * Errors from the model become a failed unit, never a throw: the database
 * decides when it is tried again (retry_at). A thrown RPC leaves the unit to
 * its lease, and is logged with the lecture's id only. */

export type UnitKind = "outline" | "part" | "notes";
export type Effort = "low" | "medium" | "high";
export type Unit = { kind: UnitKind; idx: number | null; lease: string; effort: Effort };
export type Part = { heading: string; from: number; to: number };
export type Correction = { before: string; after: string; note: string };
export type InputSection = {
  idx: number;
  title: string;
  slide_from: number;
  slide_to: number;
  status: string;
  error: string | null;
  markdown: string;
  /** The group's corrections of the part's earlier generation (study_corrections_of). */
  corrections?: unknown;
};
/** Everything a writer needs (study_writing_input), for the worker, which
 *  cannot read the tables, and the device path alike. */
export type WritingInput = {
  lecture: Lecture;
  sections: InputSection[];
  /** Storage path → URL signed for 48 h when the lecture was queued ({} without a job). */
  figures: Record<string, string>;
  figures_until: string | null;
  recording: { has_times: boolean; duration_s: number | null; status: string } | null;
  /** "[41:10] …" lines, only when asked for. */
  transcript: string | null;
};
export type FinishArgs = {
  lectureId: string;
  kind: "part" | "notes";
  idx: number;
  lease: string;
  status: "ready" | "failed";
  error: string | null;
  text?: string;
  items?: RecNoteItem[];
  model: string | null;
  usage: unknown;
  cost: number;
  /** The call's reservation, settled by the finish (null: no model call, or a reservation that keeps its estimate). */
  charge: number | null;
};
export type OutlineArgs = {
  lectureId: string;
  lease: string;
  parts: Part[] | null;
  error: string | null;
  model: string | null;
  usage: unknown;
  cost: number;
  charge: number | null;
};
export type Store = {
  /** The client the RPCs and the reservations go through: anon for the
   *  worker, the member's own for the device path (a ledger row then names
   *  its member and the database checks they belong to the lecture's group). */
  sb: SupabaseClient;
  claim(lectureId: string, want?: { kind?: UnitKind; idx?: number }): Promise<Unit | null>;
  input(lectureId: string, withTranscript?: boolean): Promise<WritingInput>;
  /** The text so far; false when the lease is gone (another writer took the unit). */
  progress(lectureId: string, idx: number, lease: string, markdown: string): Promise<boolean>;
  finish(f: FinishArgs): Promise<boolean>;
  outlineDone(o: OutlineArgs): Promise<boolean>;
};

/** The writing RPCs, each with the server key (review B1): the worker's
 *  store has no member token; the device path's has the member's token and
 *  the key. Without the key the database answers "forbidden". */
export function rpcStore(sb: SupabaseClient, key: string): Store {
  const fail = (error: { message?: string }): never => {
    throw new HttpError(error.message === "forbidden" ? 403 : 500, error.message || "rpc");
  };
  return {
    sb,
    async claim(lectureId, want) {
      const { data, error } = await sb.rpc("study_claim", {
        p_lecture: lectureId,
        p_kind: want?.kind ?? null,
        p_idx: want?.idx ?? null,
        p_key: key,
      });
      if (error) fail(error);
      const row = (Array.isArray(data) ? data[0] : null) as { kind: UnitKind; idx: number | null; lease: string; effort: Effort } | null | undefined;
      return row && row.lease ? { kind: row.kind, idx: row.idx, lease: row.lease, effort: row.effort } : null;
    },
    async input(lectureId, withTranscript = false) {
      const { data, error } = await sb.rpc("study_writing_input", { p_lecture: lectureId, p_with_transcript: withTranscript, p_key: key });
      if (error) fail(error);
      if (!data) throw new HttpError(404, "lecture not found");
      return data as WritingInput;
    },
    async progress(lectureId, idx, lease, markdown) {
      const { data, error } = await sb.rpc("study_progress", { p_lecture: lectureId, p_idx: idx, p_lease: lease, p_text: markdown, p_key: key });
      if (error) fail(error);
      return data === true;
    },
    async finish(f) {
      const { data, error } = await sb.rpc("study_finish", {
        p_lecture: f.lectureId,
        p_kind: f.kind,
        p_idx: f.idx,
        p_lease: f.lease,
        p_status: f.status,
        p_error: f.error,
        p_text: f.text ?? null,
        p_items: f.items ?? null,
        p_model: f.model,
        p_usage: f.usage ?? null,
        p_cost: f.cost,
        p_key: key,
        p_charge: f.charge,
      });
      if (error) fail(error);
      return data === true;
    },
    async outlineDone(o) {
      const { data, error } = await sb.rpc("study_outline_done", {
        p_lecture: o.lectureId,
        p_lease: o.lease,
        p_parts: o.parts,
        p_error: o.error,
        p_model: o.model,
        p_usage: o.usage ?? null,
        p_cost: o.cost,
        p_key: key,
        p_charge: o.charge,
      });
      if (error) fail(error);
      return data === true;
    },
  };
}

/* ── Timing (the tests shorten them) ── */
export const writerTiming = {
  /** How often the text so far is saved for the group while it grows (§1.A: "every ~15 s"). */
  progressMs: 15_000,
  /** The device path's model call stops this long after its function started:
   *  Vercel ends a function at 300 s, and 30 s are left to save. */
  deviceMs: 270_000,
};

/* ── Limits, as section.ts had them ── */
const MAX_IMAGES = 24;
/** Pictures smaller than this on their longer side are thumbnails. */
const MIN_FIGURE_SIDE = 100;
export const PART_TOKENS = 48_000;
const OUTLINE_TOKENS = 8_000;
const NOTES_TOKENS = 16_000;
const MAX_SLIDES = 250;
const MAX_PART = 10;
/** A picture's link must still be good this long after the call starts. */
const FIGURE_MARGIN_MS = 10 * 60_000;

/* ── The outline's schema and fixed chunks (moved from outline.ts, unchanged) ── */
const Outline = z.object({
  title: z.string(),
  parts: z.array(z.object({ heading: z.string(), from: z.number().int(), to: z.number().int() })),
});

/** A dash between words reads badly in a Hebrew heading: it becomes a colon, or a
 *  comma when the heading already has one ("Leishmaniasis: טיפול, Paromomycin ..."). */
function tidyHeading(h: string): string {
  const t = h.trim();
  return t.replace(/\s+[–—-]\s+/g, t.includes(":") ? ", " : ": ").slice(0, 120);
}

/** The model's split if it covers every slide in order, else fixed chunks of six. */
export function sanePartition(raw: Part[] | undefined, slides: StoredSlide[]): Part[] {
  const first = slides[0].n;
  const last = slides[slides.length - 1].n;
  if (raw && raw.length) {
    let expect = first;
    let ok = true;
    for (const p of raw) {
      if (p.from !== expect || p.to < p.from || p.to - p.from + 1 > MAX_PART || !p.heading.trim()) {
        ok = false;
        break;
      }
      expect = p.to + 1;
    }
    if (ok && expect === last + 1) return raw.map((p) => ({ ...p, heading: tidyHeading(p.heading) }));
  }
  const parts: Part[] = [];
  for (let i = 0; i < slides.length; i += 6) {
    const chunk = slides.slice(i, i + 6);
    const title = chunk.find((s) => s.title)?.title ?? "";
    parts.push({
      heading: title ? title.slice(0, 120) : `שקפים ${chunk[0].n}-${chunk[chunk.length - 1].n}`,
      from: chunk[0].n,
      to: chunk[chunk.length - 1].n,
    });
  }
  return parts;
}

/* ── Pictures (review M7) ── */

/** The pictures a part sends: whole-page renders for a PDF, embedded pictures
 *  (not thumbnails) for PowerPoint, at most 24. */
export function partFigures(lecture: Pick<Lecture, "source_kind" | "slides">, from: number, to: number) {
  const wantPage = lecture.source_kind === "pdf";
  return lecture.slides
    .filter((s) => s.n >= from && s.n <= to)
    .flatMap((s) =>
      s.figures
        .filter((f) => (wantPage ? f.k === 0 : f.k >= 1 && (!f.w || Math.max(f.w, f.h) >= MIN_FIGURE_SIDE)))
        .map((f) => ({ ...f, n: s.n })),
    )
    .slice(0, MAX_IMAGES);
}

/** The project's own address, the only host a picture may come from. */
function projectUrl(): string {
  return (process.env.VITE_STUDY_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
}

/** A signed link's expiry (seconds since the epoch), read from its token's
 *  payload rather than trusted from the queue's p_until. */
function tokenExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const bin = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
}

/** Whether `url` is this project's Storage link signed for exactly `path`,
 *  good for at least 10 more minutes (review M7: an outside picture could
 *  carry instructions to the model). */
export function figureOk(url: string | undefined, path: string, now = Date.now()): boolean {
  const base = projectUrl();
  if (!url || !base) return false;
  const prefix = `${base}/storage/v1/object/sign/study/${path}?token=`;
  if (!url.startsWith(prefix)) return false;
  const exp = tokenExpiry(url.slice(prefix.length).split("&")[0]);
  return exp !== null && exp * 1000 >= now + FIGURE_MARGIN_MS;
}

/* ── One unit ── */

export type WriteOpts = {
  /** Epoch ms: the model is stopped then, with time left to save. */
  stopAt: number;
  /** The device path: signs the pictures the queue did not sign (30 minutes,
   *  with the member's token). The worker has no Storage access of its own:
   *  a picture without a good link fails the part as "figures_expired". */
  signFigures?: (paths: string[]) => Promise<Record<string, string>>;
  /** The device path reads a part's corrections itself (study_part_corrections,
   *  after its claim); the worker takes them from study_writing_input. */
  corrections?: (idx: number) => Promise<unknown>;
};
export type WriteResult = {
  status: "ready" | "failed";
  error: string | null;
  /** The outline's parts (outline.ts answers with them). */
  parts?: Part[];
  /** study_reserve refused before any model call: the device path answers its status. */
  refused?: HttpError;
};
/** A unit ready to call the model (its reservation is made), or one that
 *  ended before any model call. */
export type Prepared = { done: WriteResult } | { run: (onText?: (all: string) => void) => Promise<WriteResult> };

const log = (lectureId: string, unit: Unit, what: string, e: unknown) =>
  console.error(`study writer ${lectureId} ${unit.kind}${unit.idx ?? ""}: ${what}: ${e instanceof Error ? e.message : String(e)}`);

/** A refusal of study_reserve (budget, reserve, member_share, daily_limit,
 *  off, forbidden): the unit ends with that code and no model call. */
function refusalOf(e: unknown): HttpError | null {
  return e instanceof HttpError && e.status !== 500 ? e : null;
}

/** Everything up to the model call: the input, the pictures, the request and
 *  its reservation. The device path calls it before its stream starts, so a
 *  refusal still answers 402/429/403 there. Never throws: a thrown RPC leaves
 *  the unit to its lease. */
export async function prepareUnit(store: Store, lectureId: string, unit: Unit, opts: WriteOpts): Promise<Prepared> {
  try {
    const input = await store.input(lectureId, unit.kind === "notes");
    if (unit.kind === "outline") return await prepareOutline(store, lectureId, unit, input, opts);
    if (unit.kind === "part") return await preparePart(store, lectureId, unit, input, opts);
    return await prepareNotes(store, lectureId, unit, input, opts);
  } catch (e) {
    log(lectureId, unit, "left to its lease", e);
    return { done: { status: "failed", error: "writer" } };
  }
}

/** Writes one claimed unit to the end and saves it. Never throws for model
 *  errors: they become a failed unit. */
export async function writeUnit(store: Store, lectureId: string, unit: Unit, opts: WriteOpts & { onText?: (all: string) => void }): Promise<WriteResult> {
  const p = await prepareUnit(store, lectureId, unit, opts);
  return "done" in p ? p.done : p.run(opts.onText);
}

/** Ends a unit before any model call, with its reason. */
async function endEarly(store: Store, lectureId: string, unit: Unit, error: string, refused?: HttpError): Promise<{ done: WriteResult }> {
  try {
    if (unit.kind === "outline") await store.outlineDone({ lectureId, lease: unit.lease, parts: null, error, model: null, usage: null, cost: 0, charge: null });
    else await store.finish({ lectureId, kind: unit.kind, idx: unit.idx ?? 0, lease: unit.lease, status: "failed", error, model: null, usage: null, cost: 0, charge: null });
  } catch (e) {
    log(lectureId, unit, "left to its lease", e);
  }
  return { done: { status: "failed", error, refused } };
}

/** The reservation for a call, or a refusal that ends the unit. */
async function reserveFor(
  store: Store,
  lectureId: string,
  unit: Unit,
  lecture: Lecture,
  estimate: number,
): Promise<{ id: number } | { done: WriteResult }> {
  try {
    const id = await reserve(store.sb, {
      groupId: lecture.group_id,
      lectureId,
      kind: unit.kind,
      ref: unit.kind === "outline" ? null : String(unit.idx),
      estimateUsd: estimate,
    });
    return { id };
  } catch (e) {
    const refused = refusalOf(e);
    if (!refused) throw e; // the RPC failed: the unit waits for its lease
    return endEarly(store, lectureId, unit, refused.message, refused);
  }
}

/* ── The outline: today's call (messages.parse, effort low), then study_outline_done ── */
async function prepareOutline(store: Store, lectureId: string, unit: Unit, input: WritingInput, opts: WriteOpts): Promise<Prepared> {
  const lecture = input.lecture;
  if (!lecture.slides?.length) return endEarly(store, lectureId, unit, "no slides", new HttpError(400, "no slides"));
  if (lecture.slides.length > MAX_SLIDES) return endEarly(store, lectureId, unit, "too many slides", new HttpError(413, "too many slides"));
  const prompt = `${OUTLINE_INSTRUCTIONS}\n\n${deckText(lecture)}`;
  const format = zodOutputFormat(Outline);
  // The outline key takes Claude models only and stays outside run() (D5): only its model is routed.
  const model = await modelFor(store.sb, lecture.group_id, "outline", { lectureId });
  const f = claudeFields(model, OUTLINE_TOKENS, unit.effort);
  const r = await reserveFor(store, lectureId, unit, lecture, estimateUsd(model, prompt.length + JSON.stringify(format.schema).length, OUTLINE_TOKENS));
  if ("done" in r) return r;
  return {
    run: async () => {
      let raw: Part[] | undefined;
      let spent: { model: string; usage: UsageLike; cost: number } | null = null;
      try {
        const res = await anthropic().messages.parse(
          {
            model: f.model,
            max_tokens: f.max_tokens,
            output_config: f.effort ? { effort: f.effort, format } : { format },
            messages: [{ role: "user", content: prompt }],
          },
          { signal: AbortSignal.timeout(Math.max(5_000, opts.stopAt - Date.now())) },
        );
        spent = { model: res.model, usage: res.usage as UsageLike, cost: costUsd(res.usage as UsageLike, res.model) };
        if (res.stop_reason !== "refusal" && res.parsed_output) raw = res.parsed_output.parts;
      } catch {
        // A failed split is not fatal: fixed chunks of six slides still work.
        // The reservation is not settled and keeps its estimate.
      }
      const parts = sanePartition(raw, lecture.slides);
      try {
        const ok = await store.outlineDone({
          lectureId,
          lease: unit.lease,
          parts,
          error: null,
          model: spent?.model ?? null,
          usage: spent?.usage ?? null,
          cost: spent?.cost ?? 0,
          charge: spent ? r.id : null,
        });
        return ok ? { status: "ready", error: null, parts } : { status: "failed", error: "lease_lost" };
      } catch (e) {
        log(lectureId, unit, "left to its lease", e);
        return { status: "failed", error: "writer" };
      }
    },
  };
}

/** A part's corrections in the form correctionsForRewrite takes; anything else is dropped. */
function asCorrections(v: unknown): Correction[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c) => ({ before: String(c.before ?? ""), after: String(c.after ?? ""), note: String(c.note ?? "") }))
    .filter((c) => c.before !== c.after);
}

/* ── A part's request, pure (design-models §7.6, WP4): extracted from
 * preparePart, which calls it once the pictures are signed and the
 * corrections read; a comparison freezes the same request. ── */
export type PartFigure = { n: number; k: number; w: number; h: number; url: string };
export function partRequest(o: { lecture: Lecture; sections: InputSection[]; idx: number; figures: PartFigure[]; corrections: Correction[] }): {
  request: Pick<RunOpts, "kind" | "ref" | "system" | "messages" | "maxTokens">;
  inputChars: number;
  imageTokens: number;
} {
  const { lecture, sections, idx } = o;
  const sec = sections.find((s) => s.idx === idx);
  if (!sec) throw new HttpError(400, "section not found");
  const sent = o.figures;
  // Pictures that carry content of their own (diagrams, life cycles) raise the
  // word target. Small ones (often chemical structures, which the summary
  // leaves out) and PDF page renders (they repeat the slide's text) do not.
  const contentPictures = lecture.source_kind === "pdf" ? 0 : sent.filter((f) => !f.w || Math.max(f.w, f.h) >= 300).length;
  const deck = lectureBlock(lecture);
  const request = sectionRequest({
    index: idx,
    count: sections.length,
    heading: sec.title,
    from: sec.slide_from,
    to: sec.slide_to,
    others: sections.filter((s) => s.idx !== idx).map((s) => ({ heading: s.title, from: s.slide_from, to: s.slide_to })),
    hasFigures: sent.length > 0,
    isLast: idx === sections.length - 1,
    targetWords: targetWords(lecture.slides.filter((s) => s.n >= sec.slide_from && s.n <= sec.slide_to).map(slideText).join("\n"), contentPictures),
  });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: deck, cache_control: { type: "ephemeral" } },
    { type: "text", text: request },
  ];
  for (const f of sent) {
    content.push({ type: "text", text: `fig:${f.n}-${f.k} (שקף ${f.n})` });
    content.push({ type: "image", source: { type: "url", url: f.url } });
  }
  // One more block after everything else, so the rest is byte-identical with or without corrections (W-3).
  const rewrite = correctionsForRewrite(o.corrections);
  if (rewrite) content.push({ type: "text", text: rewrite });
  const labels = sent.reduce((n, f) => n + `fig:${f.n}-${f.k} (שקף ${f.n})`.length, 0);
  return {
    request: {
      kind: "part",
      ref: String(idx),
      system: [{ type: "text", text: SUMMARY_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      maxTokens: PART_TOKENS,
    },
    inputChars: SUMMARY_SYSTEM.length + deck.length + request.length + labels + rewrite.length,
    imageTokens: sent.reduce((n, f) => n + imageTokens(f.w, f.h), 0),
  };
}

/* ── D8 in the writer: a routed model without server-side fallback that
 * refuses or fails before any text is run once more on the default under
 * its own reservation (kind and ref of the unit, no daily count). The
 * finish then charges the rerun (the model that wrote the text), and the
 * first call's reservation is settled on its own. ── */
type Rerun = { charge: number | null; spent: Spend | null };
function rerunReserve(store: Store, lectureId: string, unit: Unit, lecture: Lecture, rerun: Rerun): FallbackReserve {
  return async (estimateUsd) => {
    const id = await reserve(store.sb, {
      groupId: lecture.group_id,
      lectureId,
      kind: unit.kind,
      ref: unit.kind === "outline" ? null : String(unit.idx),
      estimateUsd,
      daily: false,
    });
    rerun.charge = id;
    return async (s) => {
      rerun.spent = s;
    };
  };
}
async function chargesOf(store: Store, lectureId: string, unit: Unit, first: number, spent: Spend | null, rerun: Rerun) {
  if (rerun.charge === null) return { charge: first, model: spent?.model ?? null, usage: spent?.usage ?? null, cost: spent?.costUsd ?? 0 };
  if (!(await settle(store.sb, first, { model: spent?.model ?? MODEL, usage: spent?.usage ?? null }))) log(lectureId, unit, "settle", "the first call kept its estimate");
  const s = rerun.spent;
  return { charge: rerun.charge, model: s?.model ?? null, usage: s?.usage ?? null, cost: s?.costUsd ?? 0 };
}

/* ── A part: today's request (section.ts), its pictures checked, plus the corrections block ── */
async function preparePart(store: Store, lectureId: string, unit: Unit, input: WritingInput, opts: WriteOpts): Promise<Prepared> {
  const lecture = input.lecture;
  const sections = input.sections;
  const idx = unit.idx ?? -1;
  const sec = sections.find((s) => s.idx === idx);
  if (!sec) return endEarly(store, lectureId, unit, "section not found");

  // Pictures: the queue's 48-hour links, checked; on the device path the ones
  // missing or about to expire are signed now for 30 minutes, and a picture
  // that cannot be signed is left out, as before. The worker cannot sign: a
  // picture without a good link fails the part, and "המשך כתיבה" signs fresh ones.
  const figs = partFigures(lecture, sec.slide_from, sec.slide_to);
  const urls: Record<string, string> = {};
  for (const f of figs) if (figureOk(input.figures?.[f.path], f.path)) urls[f.path] = input.figures[f.path];
  const missing = figs.filter((f) => !urls[f.path]).map((f) => f.path);
  if (missing.length && opts.signFigures) {
    const signed = await opts.signFigures(missing);
    for (const p of missing) if (figureOk(signed[p], p)) urls[p] = signed[p];
  } else if (missing.length) {
    return endEarly(store, lectureId, unit, "figures_expired");
  }
  const sent = figs.filter((f) => urls[f.path]);

  // The corrections of the part's earlier generation, read after the claim (which started the new one).
  const corrections = asCorrections(opts.corrections ? await opts.corrections(idx) : sec.corrections);
  const req = partRequest({ lecture, sections, idx, figures: sent.map((f) => ({ ...f, url: urls[f.path] })), corrections });
  const model = await modelFor(store.sb, lecture.group_id, "part", { lectureId, pictures: sent.length > 0 });
  const estimate = estimateUsd(model, req.inputChars, req.request.maxTokens, req.imageTokens);
  const r = await reserveFor(store, lectureId, unit, lecture, estimate);
  if ("done" in r) return r;

  return {
    run: async (onText) => {
      let text = "";
      let spent: Spend | null = null;
      let leaseLost = false;
      let thrown: unknown = null;
      // D8: a routed model without server-side fallback that refuses before any text is written again on the default.
      const rerun: Rerun = { charge: null, spent: null };
      const fallback = rerunReserve(store, lectureId, unit, lecture, rerun);
      const stop = new AbortController();
      // The text so far, every ~15 s while it grows, one save at a time; a
      // refused save means another writer took the part: stop.
      let saved = 0;
      let saving = false;
      const tick = setInterval(() => {
        if (saving || stop.signal.aborted || text.length === saved) return;
        saving = true;
        const at = text.length;
        store
          .progress(lectureId, idx, unit.lease, tidyMarkdown(text))
          .then((ok) => {
            if (ok) saved = at;
            else {
              leaseLost = true;
              stop.abort();
            }
          })
          .catch((e) => log(lectureId, unit, "progress", e))
          .finally(() => {
            saving = false;
          });
      }, writerTiming.progressMs);
      let res: Awaited<ReturnType<typeof run>> | null = null;
      try {
        res = await run({
          ...req.request,
          client: anthropic(),
          model,
          reserveFallback: fallback,
          // Completeness is what the students judge: high effort; a part that
          // ran out of time before is written at medium (study_claim decides).
          effort: unit.effort,
          stopAt: opts.stopAt,
          ledger: async (s) => {
            spent = s;
          },
          onText: (delta) => {
            text += delta;
            onText?.(text);
          },
          signal: stop.signal,
        });
      } catch (e) {
        thrown = e;
      } finally {
        clearInterval(tick);
      }
      let status: "ready" | "failed" = "failed";
      let error: string | null;
      if (leaseLost) error = "lease_lost";
      else if (thrown) error = errorText(thrown);
      else if (res?.timedOut) error = "timeout";
      else if (res?.stop === "refusal") error = "refusal";
      else if (!text.trim()) error = "empty";
      else {
        status = "ready";
        error = res?.stop === "max_tokens" ? "truncated" : null;
      }
      const fin = await chargesOf(store, lectureId, unit, r.id, spent as Spend | null, rerun);
      try {
        const ok = await store.finish({
          lectureId,
          kind: "part",
          idx,
          lease: unit.lease,
          status,
          error,
          text: tidyMarkdown(text),
          model: fin.model ?? model,
          usage: fin.usage,
          cost: fin.cost,
          charge: fin.charge,
        });
        if (!ok && status === "ready") return { status: "failed", error: "lease_lost" };
      } catch (e) {
        log(lectureId, unit, "left to its lease", e);
        return { status: "failed", error: "writer" };
      }
      return { status, error: status === "ready" ? null : error };
    },
  };
}

/* ── A part's notes from the recording (§4.4): one JSON document through run() ── */
async function prepareNotes(store: Store, lectureId: string, unit: Unit, input: WritingInput, opts: WriteOpts): Promise<Prepared> {
  const lecture = input.lecture;
  const sections = input.sections;
  const idx = unit.idx ?? -1;
  const sec = sections.find((s) => s.idx === idx);
  if (!sec || sec.status !== "ready" || !input.transcript || !input.recording) return endEarly(store, lectureId, unit, "no transcript");
  const deck = lectureBlock(lecture);
  const transcriptBlock = `The lecture's transcript:\n\n${input.transcript}`;
  const blocks = numberBlocks(sec.markdown);
  const request = recordingRequest({
    index: idx,
    count: sections.length,
    heading: sec.title,
    from: sec.slide_from,
    to: sec.slide_to,
    others: sections.filter((s) => s.idx !== idx).map((s) => ({ heading: s.title, from: s.slide_from, to: s.slide_to })),
    isLast: idx === sections.length - 1,
    hasTimes: Boolean(input.recording.has_times),
    numbered: blocks.map((b) => ({ n: b.n, text: b.text })),
  });
  const schema = cleanSchema(zodOutputFormat(Notes).schema as Record<string, unknown>);
  const model = await modelFor(store.sb, lecture.group_id, "notes");
  const estimate = estimateUsd(
    model,
    RECORDING_SYSTEM.length + deck.length + transcriptBlock.length + request.length + JSON.stringify(schema).length,
    NOTES_TOKENS,
  );
  const r = await reserveFor(store, lectureId, unit, lecture, estimate);
  if ("done" in r) return r;

  return {
    run: async (onText) => {
      const byModel = new Map<string, string>(); // text per serving model: after a fallback the last model's counts
      let all = "";
      let spent: Spend | null = null;
      let thrown: unknown = null;
      const rerun: Rerun = { charge: null, spent: null };
      let res: Awaited<ReturnType<typeof run>> | null = null;
      try {
        res = await run({
          client: anthropic(),
          model,
          reserveFallback: rerunReserve(store, lectureId, unit, lecture, rerun),
          kind: "notes",
          ref: String(idx),
          system: [{ type: "text", text: RECORDING_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: deck, cache_control: { type: "ephemeral" } },
                { type: "text", text: transcriptBlock, cache_control: { type: "ephemeral" } },
                { type: "text", text: request },
              ],
            },
          ],
          effort: unit.effort,
          maxTokens: NOTES_TOKENS,
          stopAt: opts.stopAt,
          format: { type: "json_schema", schema },
          ledger: async (s) => {
            spent = s;
          },
          onText: (delta, servedBy) => {
            byModel.set(servedBy, (byModel.get(servedBy) ?? "") + delta);
            all += delta;
            onText?.(all);
          },
        });
      } catch (e) {
        thrown = e;
      }
      let status: "ready" | "failed" = "failed";
      let error: string | null = null;
      let items: RecNoteItem[] = [];
      if (thrown) error = errorText(thrown);
      else if (res?.timedOut) error = "timeout"; // tried again after a minute, at low effort (study_claim)
      else if (res?.stop === "refusal") error = "refusal";
      else {
        const drafts = res?.stop === "max_tokens" ? null : parseNotes(byModel, res?.model ?? model);
        if (!drafts) error = "truncated";
        else {
          status = "ready";
          items = checkNotes(drafts, blocks, { hasTimes: Boolean(input.recording?.has_times), durationS: input.recording?.duration_s ?? null });
        }
      }
      const fin = await chargesOf(store, lectureId, unit, r.id, spent as Spend | null, rerun);
      try {
        const ok = await store.finish({
          lectureId,
          kind: "notes",
          idx,
          lease: unit.lease,
          status,
          error,
          items,
          model: fin.model ?? model,
          usage: fin.usage,
          cost: fin.cost,
          charge: fin.charge,
        });
        if (!ok && status === "ready") return { status: "failed", error: "lease_lost" };
      } catch (e) {
        log(lectureId, unit, "left to its lease", e);
        return { status: "failed", error: "writer" };
      }
      return { status, error };
    },
  };
}
