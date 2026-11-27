import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockSources } from "../../../shared/study/edits.js";
import { estimateUsd, imageTokens, reserve } from "../budget.js";
import { cleanSchema, run, settleFor, type FallbackReserve, type Ledger } from "../claude.js";
import { VAR_EFFORT, VAR_MAX_PICTURES, VAR_MAX_TOKENS, VAR_PART_CHARS, VAR_TIME_LIMIT_MS } from "../limits.js";
import { VAR_SYSTEM, varRequest } from "../prompts/var.js";
import { fallbackReserve, modelFor } from "../routes.js";
import { anthropic, HttpError, json, keyed, loadLecture, memberClient, slideText, tidyMarkdown, type StoredSlide } from "../study.js";
import { checkVerdict, Verdict, varSlides, type CheckedVerdict, type VerdictRaw } from "../var.js";
import type { Op } from "./types.js";

/* ── op "var": a yellow card's two claims against the slides (package V) ──
 *
 * Spec §12.4.V. POST /api/study/ai { op: "var", disputeId } →
 *  1. the dispute, read with the member's token (RLS: her group's only):
 *     none → 404 "dispute not found"; not open or no side b → 409 "not
 *     ready";
 *  2. study_dispute_judge_begin(dispute, key) with the member's token, which
 *     holds the dispute for 3 minutes BEFORE anything is reserved (review
 *     SEC-15): a second phone gets 409 "busy" and pays nothing; asking VAR
 *     closes backing (review SEC-10);
 *  3. the lecture (404 when hidden), the part's text and the paragraph's;
 *     both claims' slides and the paragraph's own [ש׳ n] tags (at most 6),
 *     their text from the deck and at most 4 of their pictures, signed with
 *     the member's token;
 *  4. one reservation (kind "var", ref the dispute), one structured call
 *     (effort medium, max_tokens 4000, the verdict's schema, stopped 120 s
 *     after the function started), settled in `finally`;
 *  5. checkVerdict, then study_dispute_verdict(dispute, verdict, model, key)
 *     with the member's token; the answer { verdict }.
 * The model never sees the members' names. A failed call leaves the hold to
 * expire (3 minutes), so a retry is possible. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DisputeRow = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number;
  quote: string;
  claim_a: string;
  slides_a: number[];
  claim_b: string | null;
  slides_b: number[];
  state: string;
};

/** The database's refusals of the hold and of the save, with their statuses. */
function refused(message: string): HttpError {
  switch (message) {
    case "busy":
      return new HttpError(409, "busy"); // another phone asked VAR within the last 3 minutes
    case "not ready":
      return new HttpError(409, "not ready");
    case "dispute not found":
      return new HttpError(404, "dispute not found");
    case "forbidden":
      return new HttpError(403, "forbidden");
    case "not signed in":
      return new HttpError(401, "not signed in");
    default:
      return new HttpError(400, message);
  }
}

async function readDispute(sb: SupabaseClient, id: string): Promise<DisputeRow> {
  const { data, error } = await sb
    .from("study_disputes")
    .select("id, lecture_id, part_idx, anchor, quote, claim_a, slides_a, claim_b, slides_b, state")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  // Another group's dispute is invisible (RLS): the same answer as none.
  if (!data) throw new HttpError(404, "dispute not found");
  return data as DisputeRow;
}

/** The part's text (at most VAR_PART_CHARS) and the disputed paragraph's. */
async function readPart(sb: SupabaseClient, d: DisputeRow): Promise<{ part: string; paragraph: string }> {
  const { data, error } = await sb.from("study_sections").select("markdown").eq("lecture_id", d.lecture_id).eq("idx", d.part_idx).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  const md = tidyMarkdown((data as { markdown: string | null } | null)?.markdown ?? "");
  if (!md.trim()) throw new HttpError(404, "part not found");
  const block = blockSources(md)[d.anchor];
  const paragraph = block?.text?.trim() || d.quote;
  const part = md.length > VAR_PART_CHARS ? md.slice(0, VAR_PART_CHARS) + "\n…" : md;
  return { part, paragraph };
}

/** At most VAR_MAX_PICTURES pictures of the slides sent, signed with the member's token. */
async function signPictures(sb: SupabaseClient, slides: StoredSlide[]): Promise<Array<{ n: number; k: number; url: string; w: number; h: number }>> {
  const figs = slides.flatMap((s) => (s.figures ?? []).filter((f) => f.k > 0).map((f) => ({ n: s.n, ...f }))).slice(0, VAR_MAX_PICTURES);
  if (!figs.length) return [];
  try {
    const { data } = await sb.storage.from("study").createSignedUrls(
      figs.map((f) => f.path),
      60 * 10,
    );
    const url = new Map((data ?? []).filter((d) => d.path && d.signedUrl).map((d) => [d.path as string, d.signedUrl]));
    return figs.filter((f) => url.has(f.path)).map((f) => ({ n: f.n, k: f.k, url: url.get(f.path) as string, w: f.w, h: f.h }));
  } catch {
    return []; // a picture that cannot be signed is left out
  }
}

/** The structured call, settled in run()'s `finally`. */
export async function verdictCall(o: {
  client: Anthropic;
  content: Anthropic.Beta.BetaContentBlockParam[];
  stopAt: number;
  ledger: Ledger;
  ref: string;
  signal?: AbortSignal;
  model?: string;
  reserveFallback?: FallbackReserve;
}): Promise<{ raw: VerdictRaw | null; stop: string | null; model: string }> {
  let text = "";
  const r = await run({
    client: o.client,
    model: o.model,
    reserveFallback: o.reserveFallback,
    kind: "var",
    ref: o.ref,
    system: [{ type: "text", text: VAR_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: o.content }],
    effort: VAR_EFFORT,
    maxTokens: VAR_MAX_TOKENS,
    stopAt: o.stopAt,
    format: { type: "json_schema", schema: cleanSchema(zodOutputFormat(Verdict).schema as Record<string, unknown>) },
    ledger: o.ledger,
    signal: o.signal,
    onText: (d) => {
      text += d;
    },
  });
  if (r.stop === "refusal") return { raw: null, stop: r.stop, model: r.model };
  try {
    const parsed = Verdict.safeParse(JSON.parse(text)); // parsed once
    return { raw: parsed.success ? parsed.data : null, stop: r.stop, model: r.model };
  } catch {
    return { raw: null, stop: r.stop, model: r.model };
  }
}

/** POST /api/study/ai { op: "var", disputeId } */
export const varOp: Op = async (req, body, started) => {
  const id = typeof body.disputeId === "string" && UUID.test(body.disputeId) ? body.disputeId.toLowerCase() : null;
  if (!id) throw new HttpError(400, "disputeId required");
  const { sb } = await memberClient(req);
  const d = await readDispute(sb, id);
  if (d.state !== "open" || !d.claim_b) throw new HttpError(409, "not ready");

  // The hold comes first: a second phone pays nothing (review SEC-15).
  const hold = await sb.rpc("study_dispute_judge_begin", keyed({ p_dispute: d.id }));
  if (hold.error) throw refused(hold.error.message);

  const lecture = await loadLecture(sb, d.lecture_id);
  const { part, paragraph } = await readPart(sb, d);
  const nums = varSlides(lecture.slides, d.slides_a ?? [], d.slides_b ?? [], paragraph);
  const sent = nums.map((n) => lecture.slides.find((s) => s.n === n) as StoredSlide);
  const pictures = await signPictures(sb, sent);
  const { head, tail } = varRequest({
    part,
    paragraph,
    slides: sent.map((s) => ({ n: s.n, text: slideText(s) })),
    a: { claim: d.claim_a, slides: d.slides_a ?? [] },
    b: { claim: d.claim_b, slides: d.slides_b ?? [] },
  });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: head }];
  for (const p of pictures) {
    content.push({ type: "text", text: `תמונה משקף ${p.n}` });
    content.push({ type: "image", source: { type: "url", url: p.url } });
  }
  content.push({ type: "text", text: tail });

  const chars = VAR_SYSTEM.length + head.length + tail.length + pictures.length * 16;
  const model = await modelFor(sb, lecture.group_id, "var", { pictures: pictures.length > 0 });
  const reservation = await reserve(sb, {
    groupId: lecture.group_id,
    lectureId: lecture.id,
    kind: "var",
    ref: d.id,
    estimateUsd: estimateUsd(
      model,
      chars,
      VAR_MAX_TOKENS,
      pictures.reduce((t, p) => t + imageTokens(p.w, p.h), 0),
    ),
  });
  const { raw, stop, model: servedBy } = await verdictCall({
    client: anthropic(),
    content,
    model,
    reserveFallback: fallbackReserve(sb, { groupId: lecture.group_id, lectureId: lecture.id, kind: "var", ref: d.id }),
    stopAt: started + VAR_TIME_LIMIT_MS,
    ledger: settleFor(sb, reservation),
    ref: d.id,
    signal: req.signal,
  });
  if (stop === "refusal") throw new HttpError(422, "refusal");
  if (stop === "timeout") throw new HttpError(504, "timeout");
  const verdict: CheckedVerdict | null = raw ? checkVerdict(raw, sent) : null;
  if (!verdict) throw new HttpError(502, "truncated"); // max_tokens, JSON that is not a verdict, or no summary

  const saved = await sb.rpc("study_dispute_verdict", keyed({ p_dispute: d.id, p_verdict: verdict, p_model: servedBy }));
  if (saved.error) {
    // The database checks the shape again: a verdict it refuses is one this code should not have sent.
    if (saved.error.message === "bad verdict") throw new HttpError(502, "truncated");
    throw refused(saved.error.message);
  }
  return json(200, { verdict });
};
