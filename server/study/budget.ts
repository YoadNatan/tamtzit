import type { SupabaseClient } from "@supabase/supabase-js";
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

/** USD per million tokens: base input, output, 5-minute and 1-hour cache
 *  writes, cache hits. From https://platform.claude.com/docs/en/about-claude/pricing. */
type Price = { in: number; out: number; w5m: number; w1h: number; hit: number };

const PRICES: Array<[RegExp, Price]> = [
  [/^claude-(fable|mythos)-5-2/, { in: 8, out: 40, w5m: 10, w1h: 16, hit: 0.2 }],
  [/^claude-(fable|mythos)-5-1/, { in: 10, out: 50, w5m: 12.5, w1h: 20, hit: 0.25 }],
  [/^claude-opus-5-5/, { in: 4, out: 20, w5m: 5, w1h: 8, hit: 0.2 }],
  [/^claude-opus-(5|4-[5-8])(\b|-)/, { in: 5, out: 25, w5m: 6.25, w1h: 10, hit: 0.5 }],
  [/^claude-sonnet-5-5/, { in: 2, out: 10, w5m: 2.5, w1h: 4, hit: 0.1 }],
  [/^claude-sonnet-4-[56]/, { in: 3, out: 15, w5m: 3.75, w1h: 6, hit: 0.3 }],
  [/^claude-haiku-5-5/, { in: 0.5, out: 2.5, w5m: 0.625, w1h: 1, hit: 0.05 }], // the over-100k-token rate: never under-count
];
/** A model not listed above (a fallback we don't know): the dearest rates a
 *  fallback can have, so it is never under-counted (review FE-14). */
const UNKNOWN: Price = { in: 10, out: 50, w5m: 12.5, w1h: 20, hit: 1 };

function priceOf(model: string | null | undefined): Price {
  const m = model ?? "";
  return PRICES.find(([re]) => re.test(m))?.[1] ?? UNKNOWN;
}

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

function partCost(u: TokenCounts, model: string | null | undefined): number {
  const p = priceOf(model);
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

/** Input characters per token assumed by every estimate (§2.4; calibrated
 *  against the stored usage by §8.5's query, not measured here). */
const CHARS_PER_TOKEN = 2.5;
/** The app stores pictures at most 1,400 px on the long side (images.ts) and
 *  PDF pages at 1,200 px (pdf.ts). */
const MAX_PICTURE_SIDE = 1400;

/** A picture's input tokens: about width × height / 750, Claude's documented
 *  image cost; a picture of unknown size counts as the largest the app stores. */
export function imageTokens(w?: number | null, h?: number | null): number {
  const width = w && w > 0 ? w : MAX_PICTURE_SIDE;
  const height = h && h > 0 ? h : MAX_PICTURE_SIDE;
  return Math.ceil((width * height) / 750);
}

/** One attempt's worst case, which is what a call reserves: its input
 *  (characters ÷ 2.5, plus any pictures' tokens) and all of max_tokens as
 *  output (thinking is output, and max_tokens bounds it), at the model's
 *  prices. Input is priced at the 5-minute cache write rate, 1.25 times the
 *  uncached rate, because a call that writes its prefix to the cache pays
 *  that; at the uncached rate a call that wrote its whole prefix and used all
 *  of max_tokens would cost more than its reservation. No call here writes
 *  the 1-hour cache. A call that the model declines and a server-side
 *  fallback finishes can cost more: see fallbackUsd. A request sent through
 *  Message Batches (`opts.batch`, the bank's worker) is priced at half
 *  (§12.2.4: the fifth argument, so F0's four keep their meaning). */
export function estimateUsd(model: string, inputChars: number, maxTokens: number, extraInputTokens = 0, opts: { batch?: boolean } = {}): number {
  const p = priceOf(model);
  const input = Math.max(0, inputChars) / CHARS_PER_TOKEN + Math.max(0, extraInputTokens);
  return ((input * Math.max(p.in, p.w5m) + Math.max(0, maxTokens) * p.out) / 1_000_000) * (opts.batch ? 0.5 : 1);
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
  return (input * Math.max(UNKNOWN.in, UNKNOWN.w5m) + out * UNKNOWN.out) / 1_000_000;
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
  exam: { share: 0.8, memberShare: 0.4, daily: 15 },
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

/** STUDY_MONTHLY_USD: the group's monthly cap in USD. */
export const monthlyCap = (): number => Number(process.env.STUDY_MONTHLY_USD || 40);
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
