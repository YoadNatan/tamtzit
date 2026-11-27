import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";
import { assertCollabSchema } from "../ask.js";
import { estimateUsd, reserve } from "../budget.js";
import { cleanSchema, run, settleFor, type FallbackReserve, type Ledger, type RunOpts } from "../claude.js";
import { fallbackReserve, modelFor } from "../routes.js";
import { COLLAB_TIME_LIMIT_MS, FIX_CHECK_EFFORT, FIX_CHECK_MAX_TOKENS, FIX_CHECK_SLIDES_CHARS } from "../limits.js";
import type { Op } from "./types.js";
import { FIX_CHECK_SYSTEM, fixCheckRequest } from "../prompts/collab.js";
import { anthropic, HttpError, json, keyed, loadLecture, memberClient, slideText, type Lecture } from "../study.js";

/* ── "לבדוק מול השקף": a proposed correction against its slides (package K) ──
 *
 * Package K's second server slot, seeded by F (F1Δ, §12.2.4), built by K-2:
 * op "fix_check" of /api/study/ai (spec §12.3.K, X2; optional, on a tap,
 * "כ-$0.01"): { op: "fix_check", proposalId } → the proposal, read with the
 * member's token (RLS: her group's only); the text of the slides it cites;
 * one reservation (kind "fix_check", ref the proposal), one structured call
 * (effort low, max_tokens 800, { ok, note }), settled in `finally`; the
 * result written on the proposal by study_edit_proposal_checked with the
 * member's token and the server key; the answer { ok, note }. A proposal
 * that no longer waits (or an id that is none) answers 400 "not pending", one
 * without a slide as its source 400 "bad source", before anything is
 * reserved; a refusal is settled, then 502 "refusal"; a check cut short
 * (its deadline, max_tokens or unreadable JSON) 502/504 "truncated" or
 * "timeout". */

export const FixCheck = z.object({
  ok: z.boolean().describe("Whether the corrected text says only what the cited slides say"),
  note: z.string().describe("One Hebrew line naming a mismatch; empty when none"),
});
export type FixCheckResult = z.infer<typeof FixCheck>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProposalRow = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number;
  before_text: string;
  after_text: string;
  source_kind: string;
  source_slides: number[] | null;
  state: string;
};

/** The cited slides' text, in the order cited, each with its tag. */
export function citedSlidesText(lecture: Pick<Lecture, "slides">, cited: number[]): string {
  const out: string[] = [];
  let size = 0;
  for (const n of cited) {
    const s = lecture.slides.find((x) => x.n === n);
    if (!s) continue;
    const t = `[ש' ${n}] ${slideText(s)}`;
    if (size + t.length > FIX_CHECK_SLIDES_CHARS) break;
    out.push(t);
    size += t.length;
  }
  return out.join("\n\n");
}

/** A check's request, pure: what checkCall sends and what a comparison
 *  freezes (design-models §7.6), everything but the call's own plumbing. */
export function fixCheckOpts(request: string): Pick<RunOpts, "kind" | "system" | "messages" | "effort" | "maxTokens" | "format"> {
  return {
    kind: "fix_check",
    system: [{ type: "text", text: FIX_CHECK_SYSTEM }],
    messages: [{ role: "user", content: request }],
    effort: FIX_CHECK_EFFORT,
    maxTokens: FIX_CHECK_MAX_TOKENS,
    format: { type: "json_schema", schema: cleanSchema(zodOutputFormat(FixCheck).schema as Record<string, unknown>) },
  };
}

/** The structured call: JSON text through claude.ts's run(), settled in its
 *  `finally`, on the key's model (the default when none is given). A
 *  refusal or an answer that is not { ok, note } is null. */
export async function checkCall(o: {
  client: Anthropic;
  request: string;
  stopAt: number;
  ledger: Ledger;
  signal?: AbortSignal;
  model?: string;
  reserveFallback?: FallbackReserve;
}): Promise<{
  result: FixCheckResult | null;
  stop: string | null;
}> {
  let text = "";
  const r = await run({
    ...fixCheckOpts(o.request),
    client: o.client,
    stopAt: o.stopAt,
    ledger: o.ledger,
    signal: o.signal,
    model: o.model,
    reserveFallback: o.reserveFallback,
    onText: (d) => {
      text += d;
    },
  });
  if (r.stop === "refusal") return { result: null, stop: r.stop };
  try {
    const parsed = FixCheck.safeParse(JSON.parse(text));
    return { result: parsed.success ? { ok: parsed.data.ok, note: parsed.data.note.replace(/\s+/g, " ").trim().slice(0, 200) } : null, stop: r.stop };
  } catch {
    return { result: null, stop: r.stop };
  }
}

async function readProposal(sb: SupabaseClient, id: string): Promise<ProposalRow> {
  const { data, error } = await sb
    .from("study_edit_proposals")
    .select("id, lecture_id, part_idx, anchor, before_text, after_text, source_kind, source_slides, state")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  const p = data as ProposalRow | null;
  // Another group's proposal is invisible (RLS): the same answer as one that no longer waits.
  if (!p || p.state !== "pending") throw new HttpError(400, "not pending");
  return p;
}

/** POST /api/study/ai { op: "fix_check", proposalId } */
export const fixCheckOp: Op = async (req, body, started) => {
  const id = typeof body.proposalId === "string" && UUID.test(body.proposalId) ? body.proposalId.toLowerCase() : null;
  if (!id) throw new HttpError(400, "not pending"); // the app sends only a proposal's own id
  const { sb } = await memberClient(req);
  await assertCollabSchema(sb);
  const p = await readProposal(sb, id);
  const cited = (p.source_slides ?? []).filter((n) => Number.isInteger(n));
  if (p.source_kind !== "slide" || !cited.length) throw new HttpError(400, "bad source");
  const lecture = await loadLecture(sb, p.lecture_id);
  const slides = citedSlidesText(lecture, cited);
  if (!slides) throw new HttpError(400, "bad source");
  const request = fixCheckRequest({ before: p.before_text, after: p.after_text, slides });
  const model = await modelFor(sb, lecture.group_id, "fix_check");
  const reservation = await reserve(sb, {
    groupId: lecture.group_id,
    lectureId: lecture.id,
    kind: "fix_check",
    ref: p.id,
    estimateUsd: estimateUsd(model, FIX_CHECK_SYSTEM.length + request.length, FIX_CHECK_MAX_TOKENS),
  });
  const { result, stop } = await checkCall({
    client: anthropic(),
    request,
    model,
    reserveFallback: fallbackReserve(sb, { groupId: lecture.group_id, lectureId: lecture.id, kind: "fix_check", ref: p.id }),
    stopAt: started + COLLAB_TIME_LIMIT_MS,
    ledger: settleFor(sb, reservation),
    signal: req.signal,
  });
  if (stop === "refusal") throw new HttpError(502, "refusal");
  if (stop === "timeout") throw new HttpError(504, "timeout");
  if (!result) throw new HttpError(502, "truncated"); // max_tokens, or JSON that is not { ok, note }
  const { error } = await sb.rpc("study_edit_proposal_checked", keyed({ p_proposal: p.id, p_ok: result.ok, p_note: result.note }));
  if (error) throw new HttpError(error.message === "forbidden" ? 403 : 400, error.message);
  return json(200, result);
};
