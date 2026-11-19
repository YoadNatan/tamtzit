import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { studyDay as dayTsStudyDay } from "./day.js";
import {
  answer,
  DEFAULT_CONFIG,
  forgettingCurve,
  FSRS6_W,
  fuzzFactor,
  fuzzRange,
  intervalLabel,
  intervalModifier,
  NEW_CARD,
  preview,
  recallNow,
  studyDay,
  utcDay,
  type Config,
  type Mem,
  type Rating,
} from "./fsrs.js";

/* C-3 (spec §7.C): the scheduler against ts-fsrs 5.4.2, the reference FSRS-6
 * implementation, without ts-fsrs in the repo. The recorded table
 * e2e/study/fixtures/fsrs-oracle.json (F1, made by make-fsrs-oracle.mjs from
 * the design's oracle generator) holds 180 random histories of 14 answers at
 * retention 0.90, 0.85 and 0.95: every outcome must be equal, to the last
 * decimal. The fuzz ranges are ts-fsrs 5.4.2's get_fuzz_range, recorded below.
 * studyDay is F's (shared/study/day.ts). Plus the design's worked example, the
 * interval labels and the rest of design-cards §6.2's scheduler checks. */

type Step = [at: number, grade: Rating, state: number, step: number, stability: number, difficulty: number, due: number, reps: number, lapses: number];
type Oracle = { source: string; weights: number[]; histories: Array<[retention: number, start: number, steps: Step[]]> };
const oracle = JSON.parse(readFileSync(join(process.cwd(), "e2e", "study", "fixtures", "fsrs-oracle.json"), "utf8")) as Oracle;

/** ts-fsrs's day count (UTC calendar days), no fuzz: what the oracle ran. */
const utc = (retention: number): Config => ({ ...DEFAULT_CONFIG, retention, fuzz: false, dayOf: utcDay });

test("the oracle: every recorded ts-fsrs 5.4.2 outcome is equal (state, step, S, D, due, reps, lapses)", () => {
  assert.equal(oracle.source, "ts-fsrs 5.4.2");
  assert.deepEqual(oracle.weights, [...FSRS6_W], "the table was made with FSRS-6's default weights");
  let reviews = 0;
  const differ: string[] = [];
  for (const [h, [retention, start, steps]] of oracle.histories.entries()) {
    let mine: Mem = { ...NEW_CARD, due: start };
    for (const [k, [at, g, state, step, stability, difficulty, due, reps, lapses]] of steps.entries()) {
      mine = answer(mine, at, g, null, utc(retention)).card;
      reviews += 1;
      const got = [mine.state, mine.step, mine.stability, mine.difficulty, mine.due, mine.reps, mine.lapses];
      const want = [state, step, stability, difficulty, due, reps, lapses];
      if (got.some((v, i) => v !== want[i])) differ.push(`history ${h} answer ${k}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    }
  }
  assert.equal(oracle.histories.length, 180);
  assert.equal(reviews, 2520);
  assert.deepEqual(differ.slice(0, 5), [], `${differ.length} of ${reviews} outcomes differ`);
  const retentions = new Set(oracle.histories.map((x) => x[0]));
  assert.deepEqual([...retentions].sort(), [0.85, 0.9, 0.95]);
});

test("preview gives exactly what answering gives, for every button", () => {
  const c0 = answer({ ...NEW_CARD }, Date.UTC(2026, 10, 1, 8), 3, "card-x").card;
  const c1 = answer(c0, Date.UTC(2026, 10, 1, 8, 12), 3, "card-x").card;
  const later = c1.due + 2 * 86_400_000;
  const p = preview(c1, later, "card-x");
  for (const g of [1, 2, 3, 4] as Rating[]) assert.deepEqual(p[g], answer(c1, later, g, "card-x"));
});

test("studyDay is shared/study/day.ts's: the scheduler counts Israel study days from 04:00", () => {
  assert.equal(studyDay, dayTsStudyDay);
  assert.equal(DEFAULT_CONFIG.dayOf, dayTsStudyDay);
  // 01:59 and 02:00 UTC on a winter day are 03:59 and 04:00 in Israel.
  assert.equal(DEFAULT_CONFIG.dayOf(Date.parse("2026-01-10T01:59:00Z")), 20462);
  assert.equal(DEFAULT_CONFIG.dayOf(Date.parse("2026-01-10T02:00:00Z")), 20463);
  // A review card answered at 03:30 counts as the previous day: 0 days elapsed since 22:00.
  const c = { ...NEW_CARD, state: 2 as const, stability: 3, difficulty: 5, due: Date.parse("2026-11-17T01:30:00Z"), lastReview: Date.parse("2026-11-16T20:00:00Z"), reps: 3 };
  assert.equal(answer(c, Date.parse("2026-11-17T01:30:00Z"), 3, null, { ...DEFAULT_CONFIG, fuzz: false }).elapsedDays, 0);
  assert.equal(answer(c, Date.parse("2026-11-17T02:30:00Z"), 3, null, { ...DEFAULT_CONFIG, fuzz: false }).elapsedDays, 1);
});

/** ts-fsrs 5.4.2's get_fuzz_range(interval, elapsed, 36500) → [interval, elapsed, min, max]:
 *  every interval from 2.5 to 40 at five elapsed counts, then random ones up to 36,500 (recorded). */
const FUZZ_RANGES: Array<[number, number, number, number]> = [
  [2.5,0,2,4],[2.5,1,2,4],[2.5,3,2,4],[2.5,9,2,4],[2.5,30,2,4],[3,0,2,4],[3,1,2,4],[3,3,2,4],[3,9,2,4],[3,30,2,4],[4,0,3,5],[4,1,3,5],
  [4,3,4,5],[4,9,3,5],[4,30,3,5],[5,0,4,6],[5,1,4,6],[5,3,4,6],[5,9,4,6],[5,30,4,6],[6,0,4,8],[6,1,4,8],[6,3,4,8],[6,9,4,8],
  [6,30,4,8],[7,0,5,9],[7,1,5,9],[7,3,5,9],[7,9,5,9],[7,30,5,9],[8,0,6,10],[8,1,6,10],[8,3,6,10],[8,9,6,10],[8,30,6,10],[10,0,8,12],
  [10,1,8,12],[10,3,8,12],[10,9,10,12],[10,30,8,12],[13,0,11,15],[13,1,11,15],[13,3,11,15],[13,9,11,15],[13,30,11,15],[19,0,16,22],[19,1,16,22],[19,3,16,22],
  [19,9,16,22],[19,30,16,22],[20,0,17,23],[20,1,17,23],[20,3,17,23],[20,9,17,23],[20,30,17,23],[21,0,18,24],[21,1,18,24],[21,3,18,24],[21,9,18,24],[21,30,18,24],
  [25,0,22,28],[25,1,22,28],[25,3,22,28],[25,9,22,28],[25,30,22,28],[30,0,27,33],[30,1,27,33],[30,3,27,33],[30,9,27,33],[30,30,27,33],[40,0,36,44],[40,1,36,44],
  [40,3,36,44],[40,9,36,44],[40,30,36,44],[365,29,345,385],[319,29,301,337],[209,10,197,221],[40,6,36,44],[173,8,162,184],[401,23,379,423],[100,5,93,107],[108,3,101,115],[145,1,136,154],
  [60,28,55,65],[251,19,236,266],[19,17,18,22],[287,6,271,303],[130,5,122,138],[398,28,376,420],[185,19,174,196],[211,9,198,224],[228,6,215,241],[231,0,217,245],[384,4,363,405],[282,15,266,298],
  [116,1,108,124],[127,20,119,135],[203,10,191,215],[124,27,116,132],[225,15,212,238],[43,0,39,47],[258,23,243,273],[108,21,101,115],[165,3,155,175],[191,21,179,203],[185,12,174,196],[213,1,200,226],
  [3,23,2,4],[289,25,273,305],[208,29,196,220],[265,15,250,280],[319,5,301,337],[186,21,175,197],[283,7,267,299],[346,6,327,365],[237,27,223,251],[257,21,242,272],[18,26,15,21],[182,25,171,193],
  [231,28,217,245],[382,25,361,403],[159,2,149,169],[306,4,289,323],[104,13,97,111],[292,23,275,309],[66,23,61,71],[192,6,180,204],[143,15,134,152],[95,25,88,102],[351,20,331,371],[168,9,158,178],
  [253,7,238,268],[174,14,163,185],[299,23,282,316],[303,21,286,320],[259,4,244,274],[62,13,57,67],[57,29,52,62],[269,26,254,284],[186,7,175,197],[292,23,275,309],[6,20,4,8],[178,13,167,189],
  [118,1,110,126],[18,10,15,21],[103,27,96,110],[390,0,369,411],[26,1,23,29],[19,5,16,22],[396,12,374,418],[306,12,289,323],[374,27,353,395],[268,13,253,283],[322,28,304,340],[125,29,117,133],
  [298,17,281,315],[87,2,81,93],[371,26,350,392],[381,29,360,402],[166,20,156,176],[65,3,60,70],[129,26,121,137],[58,12,53,63],[101,29,94,108],[161,24,151,171],[299,20,282,316],[73,27,67,79],
  [95,7,88,102],[380,9,359,401],[292,12,275,309],[140,16,131,149],[84,2,78,90],[17,0,14,20],[195,19,183,207],[205,16,193,217],[402,2,380,424],[285,22,269,301],[313,29,295,331],[60,6,55,65],
  [218,4,205,231],[313,18,295,331],[290,19,274,306],[328,2,310,346],[336,29,317,355],[121,6,113,129],[198,9,186,210],[24,6,21,27],[378,20,357,399],[167,4,157,177],[8,6,7,10],[295,20,278,312],
  [336,21,317,355],[275,16,259,291],[233,6,219,247],[327,11,309,345],[110,26,103,117],[330,27,312,348],[144,9,135,153],[237,22,223,251],[203,21,191,215],[357,1,337,377],[363,5,343,383],[131,27,122,140],
  [11,18,9,13],[364,5,344,384],[233,28,219,247],[140,28,131,149],[73,24,67,79],[373,13,352,394],[360,3,340,380],[236,11,222,250],[303,25,286,320],[213,9,200,226],[331,25,312,350],[214,19,201,227],
  [196,25,184,208],[300,9,283,317],[6,1,4,8],[258,2,243,273],[207,14,195,219],[181,0,170,192],[387,5,366,408],[75,24,69,81],[308,13,291,325],[62,2,57,67],[60,23,55,65],[205,3,193,217],
  [118,29,110,126],[105,14,98,112],[16,10,13,19],[314,14,296,332],[209,17,197,221],[304,7,287,321],[39,16,35,43],[48,17,44,52],[183,2,172,194],[133,20,124,142],[279,12,263,295],[76,19,70,82],
  [30786,183,29245,32327],[33966,273,32266,35666],[35972,314,34171,36500],[9647,328,9163,10131],[7143,190,6784,7502],[27248,152,25884,28612],[23727,9,22539,24915],[21899,318,20802,22996],[30477,382,28951,32003],[24948,276,23699,26197],[24956,310,23706,26206],[17373,240,16502,18244],
  [32364,212,30744,33984],[7882,179,7486,8278],[2142,12,2033,2251],[15629,303,14846,16412],[3789,204,3598,3980],[24489,101,23263,25715],[10334,129,9815,10853],[2839,98,2695,2983],[36500,0,34673,36500],[36499,10,34672,36500],[36400,36450,34578,36500],
];

test("fuzz: the range is ts-fsrs 5.4.2's get_fuzz_range on the recorded inputs", () => {
  assert.equal(FUZZ_RANGES.length, 263);
  for (const [ivl, el, min, max] of FUZZ_RANGES) assert.deepEqual(fuzzRange(ivl, el, 36500), { min, max }, `interval ${ivl}, elapsed ${el}`);
  // The rule's edges, as recorded: never below 2, above the days already elapsed, never past the maximum.
  for (const [ivl, el, min, max] of FUZZ_RANGES) {
    assert.ok(min >= 2 && max <= 36500 && min <= max);
    if (ivl > el && ivl <= max) assert.ok(min >= Math.min(el + 1, max), `interval ${ivl}, elapsed ${el}`);
  }
});

test("fuzz: deterministic per card and repetition, inside the range, and it spreads a lecture's cards", () => {
  assert.equal(fuzzFactor("a:1"), fuzzFactor("a:1"));
  assert.notEqual(fuzzFactor("a:1"), fuzzFactor("a:2"));
  const days = new Set<number>();
  for (let i = 0; i < 40; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    let c = answer({ ...NEW_CARD }, Date.UTC(2026, 10, 1, 8), 3, id).card;
    c = answer(c, Date.UTC(2026, 10, 1, 8, 11), 3, id).card; // graduates: about 2 days
    const t = Date.UTC(2026, 10, 3, 9);
    const o = answer(c, t, 3, id);
    const plain = answer(c, t, 3, null);
    const r = fuzzRange(plain.scheduledDays, o.elapsedDays, 36500);
    assert.ok(o.scheduledDays >= r.min && o.scheduledDays <= r.max, `card ${i}: ${o.scheduledDays} outside ${r.min}-${r.max}`);
    assert.equal(answer(c, t, 3, id).scheduledDays, o.scheduledDays, "the same card answered the same way gets the same day");
    days.add(o.scheduledDays);
  }
  assert.ok(days.size >= 3, `40 cards answered alike land on ${days.size} different days`);
});

test("the design's worked example (a new card at 18:00 in Israel, fuzz off) gives the design's numbers", () => {
  const cfg = { ...DEFAULT_CONFIG, fuzz: false };
  let now = Date.parse("2026-11-16T18:00:00+02:00");
  let c: Mem = { ...NEW_CARD };
  const labels = () => {
    const p = preview(c, now, null, cfg);
    return ([1, 2, 3, 4] as Rating[]).map((g) => intervalLabel(now, p[g].card.due)).join(" | ");
  };
  const rate = (g: Rating) => {
    const o = answer(c, now, g, null, cfg);
    c = o.card;
    return `state ${c.state} step ${c.step} S=${c.stability} D=${c.difficulty} due ${new Date(c.due).toISOString()} (+${o.scheduledDays} d)`;
  };
  assert.equal(labels(), "1 דק׳ | 6 דק׳ | 10 דק׳ | 8 ימים");
  assert.equal(rate(3), "state 1 step 1 S=2.3065 D=2.11810397 due 2026-11-16T16:10:00.000Z (+0 d)");
  now += 10 * 60_000;
  assert.equal(labels(), "1 דק׳ | 6 דק׳ | 2 ימים | 4 ימים");
  assert.equal(rate(3), "state 2 step 0 S=2.3065 D=2.11121424 due 2026-11-18T16:10:00.000Z (+2 d)");
  now = c.due + 3 * 3_600_000;
  assert.equal(labels(), "10 דק׳ | 8 ימים | 11 ימים | 19 ימים");
  assert.equal(rate(3), "state 2 step 0 S=10.97104786 D=2.1043314 due 2026-11-29T19:10:00.000Z (+11 d)");
  now = c.due;
  assert.equal(labels(), "10 דק׳ | 1 חוד׳ | 2 חוד׳ | 3 חוד׳");
  assert.equal(rate(1), "state 3 step 0 S=1.5390125 D=7.38997579 due 2026-11-29T19:20:00.000Z (+0 d)");
  now = c.due + 2 * 60_000;
  assert.equal(labels(), "10 דק׳ | 15 דק׳ | 2 ימים | 3 ימים");
  assert.equal(rate(3), "state 2 step 0 S=1.57184156 D=7.37781418 due 2026-12-01T19:22:00.000Z (+2 d)");
  now = c.due;
  assert.equal(labels(), "10 דק׳ | 4 ימים | 5 ימים | 8 ימים");
});

test("labels: minutes, hours, a day, days, months, years", () => {
  const T = Date.UTC(2026, 10, 16, 16, 0);
  const got = [60_000, 6 * 60_000, 3 * 3_600_000, 86_400_000, 8 * 86_400_000, 65 * 86_400_000, 548 * 86_400_000].map((d) => intervalLabel(T, T + d));
  assert.equal(got.join(" | "), "1 דק׳ | 6 דק׳ | 3 שע׳ | יום | 8 ימים | 2 חוד׳ | 1.5 שנים");
  assert.equal(intervalLabel(T, T), "1 דק׳", "never 0");
});

test("first טוב on a new card: learning step 2, due in 10 minutes, S = w2", () => {
  const T = Date.UTC(2026, 10, 16, 16, 0);
  const g = answer(NEW_CARD, T, 3, null, utc(0.9));
  assert.equal(g.card.state, 1);
  assert.equal(g.card.step, 1);
  assert.equal(g.card.due, T + 600_000);
  assert.equal(g.card.stability, 2.3065);
  assert.equal(g.card.reps, 1);
  assert.equal(g.card.lastReview, T);
});

test("the curve: R(S, S) = 0.9; the interval at 90% is S; recall now is null for a new card", () => {
  assert.equal(forgettingCurve(FSRS6_W, 10, 10), 0.9);
  assert.equal(forgettingCurve(FSRS6_W, 0, 10), 1);
  assert.equal(intervalModifier(FSRS6_W, 0.9), 1);
  assert.ok(intervalModifier(FSRS6_W, 0.95) < 1 && intervalModifier(FSRS6_W, 0.85) > 1, "higher retention, shorter intervals");
  assert.throws(() => intervalModifier(FSRS6_W, 0));
  assert.equal(recallNow(NEW_CARD, Date.now()), null);
  const T = Date.UTC(2026, 10, 16, 10, 0);
  const c: Mem = { ...NEW_CARD, state: 2, stability: 10, difficulty: 5, due: T + 10 * 86_400_000, lastReview: T, reps: 2 };
  assert.equal(recallNow(c, T + 10 * 86_400_000), 0.9);
});

test("retention changes the intervals: 95% schedules sooner than 90%, 85% later", () => {
  const T = Date.UTC(2026, 10, 16, 10, 0);
  const c: Mem = { ...NEW_CARD, state: 2, stability: 20, difficulty: 5, due: T, lastReview: T - 20 * 86_400_000, reps: 4 };
  const at = (retention: number) => answer(c, T, 3, null, { ...DEFAULT_CONFIG, retention, fuzz: false }).scheduledDays;
  assert.ok(at(0.95) < at(0.9) && at(0.9) < at(0.85), `${at(0.95)} < ${at(0.9)} < ${at(0.85)}`);
});

test("a lapse: שוב on a review card relearns in 10 minutes and counts one lapse; a new card's שוב counts none", () => {
  const T = Date.UTC(2026, 10, 16, 10, 0);
  const review: Mem = { ...NEW_CARD, state: 2, stability: 8, difficulty: 5, due: T, lastReview: T - 8 * 86_400_000, reps: 3, lapses: 0 };
  const o = answer(review, T, 1, "id");
  assert.equal(o.card.state, 3);
  assert.equal(o.card.due, T + 10 * 60_000);
  assert.equal(o.card.lapses, 1);
  assert.equal(answer(NEW_CARD, T, 1, "id").card.lapses, 0);
  // Hard ≤ Good − 1 < Easy − 1 on a review card.
  const p = preview(review, T, "id");
  assert.ok(p[2].scheduledDays < p[3].scheduledDays && p[3].scheduledDays < p[4].scheduledDays);
});
