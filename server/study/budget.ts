import type { SupabaseClient } from "@supabase/supabase-js";
import { priceOf } from "../../shared/study/models.js";
import { CHARS_PER_TOKEN, UNKNOWN_PRICE } from "../../shared/study/prices.js";
import { HttpError, keyed } from "./study.js";

/* ── One ledger, one budget (decision 14; spec §2.4) ──
 *
 * public.study_usage holds one row per Claude call. Before a call the function
 * reserves the worst case of one attempt (estimateUsd; study_reserve, under
 * the group's lock: the monthly cap, the 80% line, one member's share, the
 * daily limits), and after it, failed or stopped ones too, settles the real
 * cost once (study_settle). A call that never settles keeps its estimate,
 * which errs on the safe side. A call finished by a server-side fallback can
 * cost more than its reservation (fallbackUsd). Both RPCs need the server
 * key; members cannot read or write the rows.
 */

/* Prices live in one registry (design-models D2, WP1): shared/study/prices.ts
 * holds every Claude row, shared/study/models.ts the routable models; a
 * model nobody lists is priced at UNKNOWN_PRICE, the dearest rates a
 * fallback can have, so it is never under-counted (review FE-14).
 * estimateUsd and imageTokens moved to shared/study/estimate.ts and are
 * re-exported here, so every call site stays as it was. */
export { charsPerToken, estimateUsd, imageTokens } from "../../shared/study/estimate.js";

export type TokenCounts = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
};
/** A response's usage as the API reports it, plus `estimated` when the call
 *  stopped before its final usage arrived. `service_tier` is "batch" for a
 *  Message Batches result (SDK 1.3.0's Usage: 'standard' | 'priority' |
 *  'batch' | null), billed at half the price (§12.2.4). */
export type UsageLike = TokenCounts & {
  iterations?: Array<TokenCounts & { model?: string | null; type?: string | null }> | null;
  estimated?: boolean;
  service_tier?: string | null;
};

/** The attempt's whole prompt in tokens (input, cache writes, cache hits):
 *  what picks a rate card that depends on prompt length (Haiku 5.5's 100k). */
function promptTokens(u: TokenCounts): number {
  const c = u.cache_creation;
  const writes = Math.max(u.cache_creation_input_tokens ?? 0, (c?.ephemeral_5m_input_tokens ?? 0) + (c?.ephemeral_1h_input_tokens ?? 0));
  return (u.input_tokens ?? 0) + writes + (u.cache_read_input_tokens ?? 0);
}

function partCost(u: TokenCounts, model: string | null | undefined): number {
  const p = priceOf(model, promptTokens(u));
  const c = u.cache_creation;
  // usage.cache_creation breaks the cache writes down by TTL; without it every write is a 5-minute one.
  const writes =
    c && (c.ephemeral_5m_input_tokens != null || c.ephemeral_1h_input_tokens != null)
      ? (c.ephemeral_5m_input_tokens ?? 0) * p.w5m + (c.ephemeral_1h_input_tokens ?? 0) * p.w1h
      : (u.cache_creation_input_tokens ?? 0) * p.w5m;
  return ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + writes + (u.cache_read_input_tokens ?? 0) * p.hit) / 1_000_000;
}

/** What one response cost. With a server-side fallback the top-level usage
 *  covers only the attempt that answered, so every entry of usage.iterations
 *  is priced at its own model's rates (a declined attempt that was not billed
 *  is counted too: over-counting is the safe side). Otherwise the top-level
 *  usage at the serving model's rates. A Message Batches result
 *  (service_tier "batch") costs half of every rate (§12.2.4). */
export function costUsd(usage: UsageLike | null | undefined, servedBy: string): number {
  if (!usage) return 0;
  const its = usage.iterations;
  const cost = Array.isArray(its) && its.length ? its.reduce((sum, it) => sum + partCost(it, it.model ?? servedBy), 0) : partCost(usage, servedBy);
  return usage.service_tier === "batch" ? cost / 2 : cost;
}

/** The usage to settle for a stream that stopped before its final usage came
 *  (a timeout, a closed phone): at least the text that streamed, as characters
 *  ÷ 2 output tokens, marked estimated (§2.4). */
export function floorUsage(usage: UsageLike | null, streamedChars: number): UsageLike {
  const out: UsageLike = { ...(usage ?? {}), estimated: true };
  if (streamedChars > 0) out.output_tokens = Math.max(usage?.output_tokens ?? 0, Math.ceil(streamedChars / 2));
  return out;
}

/** The most a server-side fallback (fallbacks: "default") can add to a call
 *  beyond estimateUsd. When the model declines part-way, the API runs the
 *  request again on another model, which reads the input and the text
 *  written so far (at most max_tokens) and writes up to max_tokens; both
 *  attempts are billed (the refusals-and-fallback page, "Billing and rate
 *  limits"). Which model takes over is decided by the API, so the attempt is
 *  priced at the dearest rates. Reservations do not include it: holding
 *  about four times a part's estimate on every call would stop the
 *  month's summaries several dollars before the cap, for a case that needs
 *  a decline. So the cap can be passed by up to this much per call in
 *  flight, and the Console's spend limit is set above the cap by more than
 *  that (README, "Setting it up"). */
export function fallbackUsd(inputChars: number, maxTokens: number, extraInputTokens = 0): number {
  const out = Math.max(0, maxTokens);
  const input = Math.max(0, inputChars) / CHARS_PER_TOKEN + Math.max(0, extraInputTokens) + out;
  return (input * Math.max(UNKNOWN_PRICE.in, UNKNOWN_PRICE.w5m) + out * UNKNOWN_PRICE.out) / 1_000_000;
}

/** §2.4's table with §12.2.4's rows: where each kind stops. `share` × the
 *  cap is the line the group's spend may not cross (0.8 for every optional
 *  kind, so the last 20% stays for summaries); `memberShare` × the cap
 *  bounds one member's optional spend this month; `daily` counts one
 *  member's calls of the kind per day (only those with `ref = dailyRef` when
 *  set); `noCap` kinds cost nothing and obey only their daily limit. */
export type Policy = { share: number; memberShare: number | null; daily: number | null; dailyRef?: string; noCap?: true };
export const POLICY: Record<string, Policy> = {
  outline: { share: 1, memberShare: null, daily: null },
  part: { share: 1, memberShare: null, daily: null },
  notes: { share: 0.8, memberShare: null, daily: null },
  practice: { share: 0.8, memberShare: 0.4, daily: null },
  cards: { share: 0.8, memberShare: 0.4, daily: null },
  // Past exams (sources.md B8): group work like the bank, so no member's
  // share; the daily limit counts exams started (ref "read", one per upload),
  // not the worker's units (ref "unit", reserved without the daily check).
  exam: { share: 0.8, memberShare: null, daily: 3, dailyRef: "read" },
  transcribe: { share: 0.8, memberShare: 0.4, daily: null },
  ask: { share: 0.8, memberShare: 0.4, daily: 20, dailyRef: "answer" },
  mnemonic: { share: 0.8, memberShare: 0.4, daily: 5 }, // J's drafts: 5 paid requests a day (review F-19)
  pdf: { share: 1, memberShare: null, daily: 10, noCap: true },
  bank: { share: 0.8, memberShare: null, daily: null }, // B: the worker's write batch, half price, no member
  solver: { share: 0.8, memberShare: 0.4, daily: null }, // P7: batched by B, or inside op questions on a tap
  var: { share: 0.8, memberShare: 0.4, daily: 3 },
  wall_check: { share: 0.8, memberShare: 0.4, daily: 20 },
  plaque: { share: 0.8, memberShare: 0.4, daily: 10 },
  fix_check: { share: 0.8, memberShare: 0.4, daily: 10 },
  trap_check: { share: 0.8, memberShare: 0.4, daily: 5 },
  whoami: { share: 0.8, memberShare: 0.4, daily: 3 },
  // Practice 2.0 (docs/study/practice-2-api.md): reading a lecture's points to
  // know (once for the group, again only for a part whose text changed), an
  // example read back as the style, and a member's "↻ לנסח מחדש". The writing
  // is "practice" and the blind solver "solver", as above.
  // Points: one call per part (points.ts); the daily limit counts reads, not
  // calls: a read's first call has ref "read", its other calls skip the check.
  points: { share: 0.8, memberShare: 0.4, daily: 20, dailyRef: "read" },
  style: { share: 0.8, memberShare: 0.4, daily: 10 },
  reword: { share: 0.8, memberShare: 0.4, daily: 40 },
};

/** STUDY_MONTHLY_USD: the group's monthly cap in USD; 33 when it is not set
 *  (the approved cap, ₪20 a person; design-models OD16). */
export const monthlyCap = (): number => Number(process.env.STUDY_MONTHLY_USD || 33);
/** STUDY_SETS_MONTHLY_USD: the monthly line for practice sets in USD, the
 *  group's spend of kinds practice, solver, reword and style (SETS_LINE_KINDS);
 *  12 when it is not set (Yoad's sub-cap, practice sets OD12). Checked when a
 *  set starts, so a started set finishes (docs/study/sets.md). */
export const setsMonthlyCap = (): number => {
  const v = Number(process.env.STUDY_SETS_MONTHLY_USD || 12);
  return Number.isFinite(v) && v >= 0 ? v : 12;
};
/** The kinds the sets line counts. */
export const SETS_LINE_KINDS = ["practice", "solver", "reword", "style"] as const;
/** New paid sets a member may start a day, Israel time (practice sets OD13;
 *  the design's POLICY.qsets.daily). Not a ledger kind, so it is not in
 *  POLICY: nothing can reserve a call as "qsets". */
export const SETS_DAILY = 5;
/** The cap passed for a kind that costs nothing (the PDF's $0 rows). */
const NO_CAP = 1_000_000;

/** study_reserve's refusals, as HTTP statuses (before any stream starts). */
const REFUSAL_STATUS: Record<string, number> = {
  budget: 402,
  reserve: 402,
  member_share: 402,
  daily_limit: 429,
  off: 403,
  forbidden: 403,
};

/** Reserves the call's estimate, with the member's client (`sb`) or
 *  serverClient(), and returns the reservation's id. Refusals throw
 *  HttpError: budget, reserve and member_share 402; daily_limit 429; off and
 *  forbidden 403 (no server key in Vault, or not the lecture's group). */
export async function reserve(
  sb: SupabaseClient,
  r: {
    groupId: string;
    lectureId?: string | null;
    kind: string;
    ref?: string | null;
    estimateUsd: number;
    /** false: the call continues work its first call already counted toward
     *  the daily limit (the points of a lecture, read part by part): no daily
     *  check. The caps still apply. */
    daily?: boolean;
  },
): Promise<number> {
  const policy = POLICY[r.kind];
  if (!policy) throw new HttpError(500, `no budget policy for ${r.kind}`);
  const { data, error } = await sb.rpc(
    "study_reserve",
    keyed({
      p_group: r.groupId,
      p_lecture: r.lectureId ?? null,
      p_kind: r.kind,
      p_ref: r.ref ?? null,
      p_estimate: r.estimateUsd,
      p_cap: policy.noCap ? NO_CAP : monthlyCap(),
      p_share: policy.share,
      p_member_share: policy.memberShare,
      p_daily: r.daily === false ? null : policy.daily,
      p_daily_ref: r.daily === false ? null : (policy.dailyRef ?? null),
    }),
  );
  if (error) throw new HttpError(REFUSAL_STATUS[error.message] ?? 500, error.message);
  const id = Number(data);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(500, "no reservation");
  return id;
}

let unsettled = 0;
/** How many settles failed in this instance (each left its estimate in the ledger). */
export const unsettledCount = (): number => unsettled;

/** Writes the call's real cost over its reservation, once. Never throws: a
 *  settle that fails is logged and counted, and the reservation keeps its
 *  estimate. False when it did not settle (an error, or no open reservation). */
export async function settle(sb: SupabaseClient, id: number, s: { model: string; usage: UsageLike | null }): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc(
      "study_settle",
      keyed({ p_id: id, p_model: s.model, p_usage: s.usage, p_cost: costUsd(s.usage, s.model) }),
    );
    if (error || data !== true) {
      unsettled += 1;
      console.error(`study_settle ${id}: ${error ? error.message : "no open reservation"}`);
      return false;
    }
    return true;
  } catch (e) {
    unsettled += 1;
    console.error(`study_settle ${id}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
