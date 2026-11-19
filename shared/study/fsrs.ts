/* ── The in-app flashcard scheduler (spec §4.7, §5.5; design-cards §4.3) ──
 *
 * FSRS-6 with its 21 default parameters (FSRS wiki, "The Algorithm", FSRS-6),
 * plus the short-term rules of ts-fsrs 5.4.2's BasicScheduler: learning steps
 * 1m 10m, one relearning step 10m, and FSRS-5/6's same-day stability. Every
 * expression and every rounding (8 decimals) is written as ts-fsrs 5.4.2
 * writes it, so the oracle test (fsrs.test.ts, on the recorded table
 * e2e/study/fixtures/fsrs-oracle.json) can demand exact equality.
 *
 * Two deliberate differences from ts-fsrs:
 *  - The day. "Days since the last review" counts study days in Israel time
 *    that start at 04:00 (Anki's default "Next day starts at"), not UTC
 *    calendar days: studyDay() from shared/study/day.ts, the same rule as
 *    SQL's study_day() (spec §2.12 #9). It is a parameter (Config.dayOf); the
 *    oracle test passes UTC days and must match ts-fsrs exactly.
 *  - Fuzz. On, and deterministic per card and repetition: the factor comes from
 *    FNV-1a("<card id>:<reps>") through one Mulberry32 step, with ts-fsrs's own
 *    fuzz ranges. ts-fsrs 5.4.2 seeds from the review time instead. The same
 *    card answered the same way on two phones gets the same interval.
 *
 * Pure: no Date.now(), no storage, no network. Runs in the browser (review),
 * and in Node (tests). Ported from the design's tested prototype; the one
 * change is where studyDay comes from.
 */
import { studyDay } from "./day.js";

export { studyDay };

/** FSRS-6 default parameters w0..w20 (FSRS wiki; ts-fsrs 5.4.2 default_w). */
export const FSRS6_W: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014,
  1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);

/** 1 שוב (Again), 2 קשה (Hard), 3 טוב (Good), 4 קל (Easy). */
export type Rating = 1 | 2 | 3 | 4;
/** 0 new, 1 learning, 2 review, 3 relearning (ts-fsrs's State numbers). */
export type Phase = 0 | 1 | 2 | 3;

/** One member's memory of one card: study_card_states, in milliseconds. */
export type Mem = {
  state: Phase;
  /** Index into the learning (state 1) or relearning (state 3) steps. */
  step: number;
  /** Days for R to fall to 90%; 0 while new. */
  stability: number;
  /** 1..10; 0 while new. */
  difficulty: number;
  /** When it is due (ms). A new card's due is meaningless. */
  due: number;
  lastReview: number | null;
  reps: number;
  lapses: number;
};

export type Config = {
  w: readonly number[];
  /** Desired retention, 0.80..0.97 in the app (Anki manual: keep it under 97%). */
  retention: number;
  maxInterval: number;
  /** Minutes. */
  learningSteps: readonly number[];
  relearningSteps: readonly number[];
  fuzz: boolean;
  /** The study-day index of an instant. */
  dayOf: (ms: number) => number;
};

export const NEW_CARD: Mem = { state: 0, step: 0, stability: 0, difficulty: 0, due: 0, lastReview: null, reps: 0, lapses: 0 };

const S_MIN = 1e-3;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

const roundTo = (num: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
};
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** UTC calendar days: what ts-fsrs 5.4.2's dateDiffInDays counts (tests only). */
export const utcDay = (ms: number) => Math.floor(ms / DAY_MS);

export const DEFAULT_CONFIG: Config = Object.freeze({
  w: FSRS6_W,
  retention: 0.9,
  maxInterval: 36500,
  learningSteps: [1, 10],
  relearningSteps: [10],
  fuzz: true,
  dayOf: studyDay,
});

/* ─────────────── FSRS-6, as ts-fsrs 5.4.2 computes it ─────────────── */

export function decayFactor(w: readonly number[]): { decay: number; factor: number } {
  const decay = -w[20];
  const factor = Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1;
  return { decay, factor: roundTo(factor, 8) };
}

/** R(t, S) = (1 + factor·t/S)^(−w20): the chance of recall after t days. */
export function forgettingCurve(w: readonly number[], elapsedDays: number, stability: number): number {
  const { decay, factor } = decayFactor(w);
  return roundTo(Math.pow(1 + (factor * elapsedDays) / stability, decay), 8);
}

/** The interval, in units of S, at which R falls to the desired retention. */
export function intervalModifier(w: readonly number[], retention: number): number {
  if (retention <= 0 || retention > 1) throw new Error("retention out of range");
  const { decay, factor } = decayFactor(w);
  return roundTo((Math.pow(retention, 1 / decay) - 1) / factor, 8);
}

const initStability = (w: readonly number[], g: Rating) => Math.max(w[g - 1], 0.1);
const initDifficulty = (w: readonly number[], g: Rating) => roundTo(w[4] - Math.exp((g - 1) * w[5]) + 1, 8);

function nextDifficulty(w: readonly number[], d: number, g: Rating): number {
  const deltaD = -w[6] * (g - 3);
  const nextD = d + roundTo((deltaD * (10 - d)) / 9, 8); // linear damping
  const reverted = roundTo(w[7] * initDifficulty(w, 4) + (1 - w[7]) * nextD, 8); // mean reversion toward D0(Easy)
  return clamp(reverted, 1, 10);
}

function recallStability(w: readonly number[], d: number, s: number, r: number, g: Rating): number {
  const hardPenalty = g === 2 ? w[15] : 1;
  const easyBonus = g === 4 ? w[16] : 1;
  return roundTo(
    clamp(s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hardPenalty * easyBonus), S_MIN, 36500),
    8,
  );
}

function forgetStability(w: readonly number[], d: number, s: number, r: number): number {
  return roundTo(clamp(w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]), S_MIN, 36500), 8);
}

function shortTermStability(w: readonly number[], s: number, g: Rating): number {
  const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
  const masked = g >= 2 ? Math.max(sinc, 1) : sinc;
  return roundTo(clamp(s * masked, S_MIN, 36500), 8);
}

/** The memory after one rating: new (D = S = 0) → initial values; the same
 *  day → short-term stability; Again → post-lapse stability, at most
 *  S / e^(w17·w18); otherwise → stability after recall. */
export function nextMemory(
  w: readonly number[],
  mem: { difficulty: number; stability: number },
  t: number,
  g: Rating,
  r?: number,
): { difficulty: number; stability: number } {
  const { difficulty: d, stability: s } = mem;
  if (t < 0) throw new Error(`negative elapsed days ${t}`);
  if (d === 0 && s === 0) return { difficulty: clamp(initDifficulty(w, g), 1, 10), stability: initStability(w, g) };
  if (d < 1 || s < S_MIN) throw new Error(`bad memory state ${d}/${s}`);
  const rr = typeof r === "number" ? r : forgettingCurve(w, t, s);
  let newS: number;
  if (t === 0) newS = shortTermStability(w, s, g);
  else if (g === 1) {
    const afterFail = forgetStability(w, d, s, rr);
    newS = clamp(roundTo(s / Math.exp(w[17] * w[18]), 8), S_MIN, afterFail);
  } else newS = recallStability(w, d, s, rr, g);
  return { difficulty: nextDifficulty(w, d, g), stability: newS };
}

/* ─────────────── fuzz ─────────────── */

/** ts-fsrs 5.4.2's FUZZ_RANGES and get_fuzz_range. */
const FUZZ_RANGES = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Infinity, factor: 0.05 },
];
export function fuzzRange(interval: number, elapsedDays: number, maxInterval: number): { min: number; max: number } {
  let delta = 1;
  for (const range of FUZZ_RANGES) delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0);
  interval = Math.min(interval, maxInterval);
  let min = Math.max(2, Math.round(interval - delta));
  const max = Math.min(Math.round(interval + delta), maxInterval);
  if (interval > elapsedDays) min = Math.max(min, elapsedDays + 1);
  min = Math.min(min, max);
  return { min, max };
}

/** FNV-1a (32-bit) of a string, then one Mulberry32 step: a number in [0, 1). */
export function fuzzFactor(seed: string): number {
  let h = 0x811c9dc5;
  for (const ch of new TextEncoder().encode(seed)) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function nextInterval(cfg: Config, s: number, elapsedDays: number, seed: string | null): number {
  const ivl = Math.min(Math.max(1, Math.round(s * intervalModifier(cfg.w, cfg.retention))), cfg.maxInterval);
  if (!cfg.fuzz || seed === null || ivl < 2.5) return Math.round(ivl);
  const { min, max } = fuzzRange(ivl, elapsedDays, cfg.maxInterval);
  return Math.floor(fuzzFactor(seed) * (max - min + 1) + min);
}

/* ─────────────── the scheduler (ts-fsrs 5.4.2 BasicScheduler) ─────────────── */

type StepPlan = Partial<Record<Rating, { minutes: number; next: number }>>;

/** BasicLearningStepsStrategy: what Again, Hard and Good do on a step. Easy
 *  (and Good on the last step) are absent: the card graduates. */
function stepPlan(cfg: Config, state: Phase, cur: number): StepPlan {
  const steps = state === 3 || state === 2 ? cfg.relearningSteps : cfg.learningSteps;
  if (steps.length === 0 || cur >= steps.length) return {};
  const first = steps[0];
  if (state === 2) return { 1: { minutes: steps[Math.max(0, cur)], next: 0 } };
  const hard = steps.length === 1 ? Math.round(first * 1.5) : Math.round((first + steps[1]) / 2);
  const plan: StepPlan = { 1: { minutes: first, next: 0 }, 2: { minutes: hard, next: cur } };
  const nextStep = steps[cur + 1];
  if (nextStep) plan[3] = { minutes: Math.round(nextStep), next: cur + 1 };
  return plan;
}

export type Outcome = { card: Mem; elapsedDays: number; scheduledDays: number };

/** All four outcomes of answering `card` at `now` (for the labels under the
 *  buttons), computed exactly as answering would. `seed` is the card's id. */
export function preview(card: Mem, now: number, seed: string | null, cfg: Config = DEFAULT_CONFIG): Record<Rating, Outcome> {
  const elapsed = card.state !== 0 && card.lastReview !== null ? Math.max(0, cfg.dayOf(now) - cfg.dayOf(card.lastReview)) : 0;
  const base: Mem = { ...card, lastReview: now, reps: card.reps + 1 };
  const fuzzSeed = seed === null ? null : `${seed}:${base.reps}`;
  const mem = (g: Rating, r?: number) => ({ ...base, ...nextMemory(cfg.w, base, elapsed, g, r) });

  /** Learning steps, or graduation to review when the step plan has nothing. */
  const steps = (next: Mem, g: Rating, toState: Phase, planState: Phase): Outcome => {
    const p = stepPlan(cfg, planState, card.step)[g];
    const minutes = Math.max(0, p?.minutes ?? 0);
    if (minutes > 0 && minutes < 1440) {
      return { card: { ...next, state: toState, step: Math.max(0, p?.next ?? 0), due: now + Math.round(minutes) * MIN_MS }, elapsedDays: elapsed, scheduledDays: 0 };
    }
    if (minutes >= 1440) {
      return { card: { ...next, state: 2, step: Math.max(0, p?.next ?? 0), due: now + Math.round(minutes) * MIN_MS }, elapsedDays: elapsed, scheduledDays: Math.floor(minutes / 1440) };
    }
    const ivl = nextInterval(cfg, next.stability, elapsed, fuzzSeed);
    return { card: { ...next, state: 2, step: 0, due: now + ivl * DAY_MS }, elapsedDays: elapsed, scheduledDays: ivl };
  };

  const out = {} as Record<Rating, Outcome>;
  if (card.state === 0 || card.state === 1 || card.state === 3) {
    const to: Phase = card.state === 0 ? 1 : card.state;
    for (const g of [1, 2, 3, 4] as Rating[]) out[g] = steps(mem(g), g, to, card.state === 0 ? 0 : card.state);
    return out;
  }
  // Review: one retrievability for all four; Hard ≤ Good − 1 < Easy − 1.
  const r = forgettingCurve(cfg.w, elapsed, card.stability);
  const again = mem(1, r);
  const hard = mem(2, r);
  const good = mem(3, r);
  const easy = mem(4, r);
  let hardIvl = nextInterval(cfg, hard.stability, elapsed, fuzzSeed);
  let goodIvl = nextInterval(cfg, good.stability, elapsed, fuzzSeed);
  hardIvl = Math.min(hardIvl, goodIvl);
  goodIvl = Math.max(goodIvl, hardIvl + 1);
  const easyIvl = Math.max(nextInterval(cfg, easy.stability, elapsed, fuzzSeed), goodIvl + 1);
  const review = (m: Mem, ivl: number): Outcome => ({ card: { ...m, state: 2, step: 0, due: now + ivl * DAY_MS }, elapsedDays: elapsed, scheduledDays: ivl });
  const lapse = steps(again, 1, 3, 2);
  out[1] = { ...lapse, card: { ...lapse.card, lapses: card.lapses + 1 } };
  out[2] = review(hard, hardIvl);
  out[3] = review(good, goodIvl);
  out[4] = review(easy, easyIvl);
  return out;
}

/** Answering a card: the outcome of one rating. */
export function answer(card: Mem, now: number, g: Rating, seed: string | null, cfg: Config = DEFAULT_CONFIG): Outcome {
  return preview(card, now, seed, cfg)[g];
}

/** The chance of recall now (for weak points); null for a new card. */
export function recallNow(card: Mem, now: number, cfg: Config = DEFAULT_CONFIG): number | null {
  if (card.state === 0 || card.lastReview === null || card.stability <= 0) return null;
  return forgettingCurve(cfg.w, Math.max(0, cfg.dayOf(now) - cfg.dayOf(card.lastReview)), card.stability);
}

/** The label under a button: "1 דק׳", "6 דק׳", "3 ימים", "2 חוד׳", "1.5 שנים". */
export function intervalLabel(fromMs: number, dueMs: number): string {
  const min = Math.max(1, Math.round((dueMs - fromMs) / MIN_MS));
  if (min < 60) return `${min} דק׳`;
  const hours = Math.round(min / 60);
  if (min < 1440) return `${hours} שע׳`;
  const days = Math.round(min / 1440);
  if (days === 1) return "יום";
  if (days < 30) return `${days} ימים`;
  if (days < 365) return `${Math.round(days / 30)} חוד׳`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")} שנים`;
}
