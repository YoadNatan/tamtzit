import { getDeadline, waitUntil } from "@vercel/functions"; // 3.10.5, pinned
import type { SupabaseClient } from "@supabase/supabase-js";
import { numberBlocks } from "../../shared/study/blocks.js";
import { reserve } from "./budget.js";
import { type ClaimedPart, pieceEstimate, pointPieces, type PointsResult, readPoints } from "./points.js";
import { anthropic, assertSchema, errorText, HttpError, json, type Lecture, serverClient, serverKey } from "./study.js";

/* ── Package B: the points to know, read ahead (decision 2 of 17 Nov 2026) ──
 *
 * Yoad's decision 2 redefines package B: nothing writes questions or cards
 * ahead (the addendum's bank, §12.6.B, is not built). Instead, when server
 * writing finishes a lecture's summary, the lecture's points to know are read
 * at once, so practice 2.0's "מה ליצור" opens with its numbers
 * (docs/study/practice-2-api.md §10).
 *
 * Section B's trigger kicks the worker when study_finish leaves every part
 * written: pg_net posts {"points": <lecture>} to /api/study/work with the
 * server key, and work.ts hands it here. One step:
 *
 *   1. study_points_ahead_claim (the key alone): the parts never tried on
 *      their text, with their text and earlier points. Null: nothing to do
 *      (the switch `points_ahead` off, a part not written, a read with a live
 *      lease, nothing new): 200 {claimed:false}.
 *   2. The first call's reservation (kind "points", ref "ahead": the worker's
 *      rows name no member, so no member's share or daily limit counts it;
 *      the optional features' line, 80% of the cap, does). Refused: the claim
 *      is given back quietly (study_points_ahead_release) and the step
 *      answers 200 {claimed:false, skipped:<code>}; a member's "לקרוא את
 *      הנקודות" reads them later.
 *   3. readPoints (points.ts, as action "points"): part by part, six calls at
 *      once, each reserved before and settled after, each part saved as its
 *      call ends, in waitUntil, after the 202. A part that fails keeps its
 *      reason (the setup screen offers it again); a function that dies leaves
 *      its lease to run out, and the screen offers those parts too.
 *
 * Questions and cards are still written only on a member's tap. */

/** The ledger's ref of a read ahead's first call (its other calls: "part N"). */
export const AHEAD_REF = "ahead";
/** A read ahead stops this long after its function started (as the writer's units). */
const TIME_LIMIT_MS = 270_000;

type OldPoint = { id: string; kind: string; subject: string; text: string };
/** What study_points_ahead_claim answers (null: nothing to read ahead). */
export type AheadClaim = {
  group_id: string;
  slides: number[];
  parts: Array<{ part_idx: number; heading: string; slide_from: number; slide_to: number; md5: string; markdown: string; old: OldPoint[] }>;
};
export type AheadAnswer = { claimed: false; skipped?: string } | { claimed: true; parts: number };

/** The claim's parts as points.ts reads them: the text numbered as SummaryView numbers it. */
export function aheadParts(
  claim: AheadClaim,
  lectureId: string,
): { parts: ClaimedPart[]; old: Map<number, OldPoint[]>; lecture: Pick<Lecture, "id" | "group_id" | "slides"> } {
  const parts = claim.parts.map((p) => ({
    part_idx: Number(p.part_idx),
    heading: p.heading ?? "",
    slide_from: Number(p.slide_from),
    slide_to: Number(p.slide_to),
    md5: p.md5,
    blocks: numberBlocks(p.markdown ?? ""),
  }));
  const old = new Map(claim.parts.map((p) => [Number(p.part_idx), Array.isArray(p.old) ? p.old : []]));
  // readPoints reads only the slides' numbers (which slides a point may cite).
  const slides = (claim.slides ?? []).map((n) => ({ n: Number(n) })) as unknown as Lecture["slides"];
  return { parts, old, lecture: { id: lectureId, group_id: claim.group_id, slides } };
}

const rpcError = (error: { message?: string }) => new HttpError(error.message === "forbidden" ? 403 : 500, error.message || "rpc");

/** Gives the claim back without a trace (never throws: its lease would run out anyway). */
async function release(sb: SupabaseClient, key: string, lectureId: string, parts: number[]): Promise<void> {
  try {
    const { error } = await sb.rpc("study_points_ahead_release", { p_lecture: lectureId, p_parts: parts, p_key: key });
    if (error) throw rpcError(error);
  } catch (e) {
    console.error(`study_points_ahead_release ${lectureId}: ${errorText(e)}`);
  }
}

/** One read ahead of a lecture's points (work.ts's {"points": lecture}). The
 *  key was checked by work.ts. 202 once the read runs in waitUntil. */
export async function pointsAheadStep(lectureId: string, started: number): Promise<Response> {
  const sb = serverClient();
  const key = serverKey();
  let claim: AheadClaim | null;
  try {
    await assertSchema(sb, "bank"); // section B (OP_SCHEMA.bank): an older database claims nothing
    const { data, error } = await sb.rpc("study_points_ahead_claim", { p_lecture: lectureId, p_key: key });
    if (error) throw rpcError(error);
    claim = data as AheadClaim | null;
  } catch (e) {
    return json(e instanceof HttpError && (e.status === 503 || e.status === 403) ? e.status : 500, { error: errorText(e) });
  }
  if (!claim || !Array.isArray(claim.parts) || !claim.parts.length) return json(200, { claimed: false } satisfies AheadAnswer);

  const { parts, old, lecture } = aheadParts(claim, lectureId);
  const idx = parts.map((p) => p.part_idx);
  let reserved: number;
  try {
    reserved = await reserve(sb, { groupId: claim.group_id, lectureId, kind: "points", ref: AHEAD_REF, estimateUsd: pieceEstimate(pointPieces(parts)[0]) });
  } catch (e) {
    // The cap (402 reserve, budget), the switch of the kind (403 off), or the
    // database: nothing was asked of the model, so nothing is shown as failed.
    await release(sb, key, lectureId, idx);
    const code = errorText(e);
    if (e instanceof HttpError && e.status < 500) {
      console.info(`study points ahead ${lectureId}: skipped (${code})`);
      return json(200, { claimed: false, skipped: code } satisfies AheadAnswer);
    }
    return json(500, { error: code });
  }

  const deadline = getDeadline()?.getTime() ?? started + 300_000;
  const stopAt = Math.min(deadline - 25_000, started + TIME_LIMIT_MS);
  const client = anthropic();
  waitUntil(
    readPoints({ client, sb, lecture, parts, old, stopAt, reserved, write: () => undefined }).then(
      (r: PointsResult) => console.info(`study points ahead ${lectureId}: ${r.parts}/${idx.length} parts, ${r.points} points, $${r.costUsd.toFixed(4)}`),
      (e) => console.error(`study points ahead ${lectureId}: ${errorText(e)}`),
    ),
  );
  return json(202, { claimed: true, parts: idx.length } satisfies AheadAnswer);
}
