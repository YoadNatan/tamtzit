/* ── The group's marathon plan, as lanes (package G; spec §12.6.G, plan.html;
 *    Yoad's decision 3 of 17 Nov 2026) ──
 *
 * Pure, so the plan screen, "שלי", Today's row 9 and the tests read one
 * set of rules:
 *
 *  - buildLane(plan, facts, meter, missed): the group lane, one LaneDay per
 *    study day from the shared pass (PL1, about 3 weeks out) to the day
 *    before the exam: the shared pass gives every part of every lecture a
 *    read block and a 5-question quiz; study leave brings each lecture back
 *    rounds − 1 more times, in passes that grow longer towards the exam
 *    (PL4: the gaps grow), with "שחזורים" and what did not sit well each day.
 *    A lecture the group finds hard (its bucket, decision 3's meter, from 3
 *    members) gets more minutes, one that sits well fewer (PL6). Blocks a day
 *    did not reach move to the next day, marked "moved" (PL5); the price the
 *    group chose (plan.slips) makes the following days longer or drops one
 *    review day. Nothing is ever "late" and nothing is counted as late.
 *  - planMeter(rows): "התוכנית מדייקת ככל שמתרגלים: N מתוך M הרצאות עם
 *    נתונים", and how far the nearest lecture is ("עוד כ-12 תשובות ועוד אדם
 *    אחד להרצאה הבאה"), from section G's study_group_plan_meter counts only.
 *  - myLane(…): the private lane (PL3, "המסלול שלך · רק לך"), from the
 *    member's own reads: due cards and open mistakes, relearning rounds that
 *    are due, a lecture the group read without her, topics hot only for her.
 *
 * Every threshold is here, except decision 3's meter (PLAN), which lives
 * with every other meter's in shared/study/meters.ts. PLAN mirrors section G's functions
 * (study_private.plan_lecture_answers() and the rest) and LANE's defaults
 * mirror study_group_plan_save's; lane.test.ts reads the SQL and fails if
 * they differ. */

import { dateOfDay, dayOfDate, weekday } from "./day";
import { PLAN } from "./meters";

export { PLAN };

/** The lane's shape. SHARED_DAYS and LEAVE_DAYS before the exam, the minutes
 *  a day and the rounds are study_group_plan_save's defaults. */
export const LANE = {
  SHARED_DAYS: 21,
  LEAVE_DAYS: 14,
  SHARED_MINUTES: 180,
  LEAVE_MINUTES: 600,
  ROUNDS: 3,
  INTRO_MIN: 5,
  /** A block of reading (PL2: about 50 minutes); a longer read is several, "שני בלוקים, עד 12:40". */
  BLOCK_MIN: 50,
  QUIZ_N: 5,
  QUIZ_MIN: 10,
  BREAK_MIN: 10,
  PAST_EXAMS_MIN: 60,
  QUESTIONS_MIN: 30,
  /** The longest step a marathon's run-of-show takes (section P: 1-240). */
  MAX_BLOCK_MIN: 240,
  /** A marathon's minutes (section P: 30-720) and its steps (at most 40). */
  MAX_DAY_MIN: 720,
  MAX_STEPS: 40,
  /** Days of the group lane saved as marathons ahead (PL2). */
  SAVE_DAYS: 7,
  /** The price "עוד שעה ביום": minutes added to each day until the date chosen. */
  LONGER_MIN: 60,
  /** "עד {day}": this many days after the day the blocks moved to, at most the day before the exam. */
  LONGER_DAYS: 3,
  /** The private lane starts this long after the group's day ends. */
  PRIVATE_GAP_MIN: 30,
  /** The exam-eve view is offered this many days before the exam. */
  EVE_DAYS: 2,
  /** "בעוד 20 דק׳" only for a block this close; further off, its time says when. */
  SOON_MIN: 90,
} as const;

export type Slip = { day: string; choice: "longer" | "drop_review"; until?: string | null; by?: string | null; at?: string };
export type GroupPlan = {
  id: string;
  group_id: string;
  title: string;
  exam_date: string;
  lecture_ids: string[];
  shared_from: string;
  leave_from: string;
  shared_minutes: number;
  leave_minutes: number;
  rounds: number;
  day_start: string;
  slips: Slip[];
  version: number;
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
};
/** What the phone knows of a lecture of the plan. */
export type LectureFact = { id: string; title: string; parts: number; slides?: Array<[number, number]>; readers: number; readByMe: boolean };
/** section G's study_group_plan_meter, one row a lecture. */
export type MeterRow = { lecture_id: string; answers: number; answers_short: number; members_short: number; bucket: "hot" | "warm" | "ok" | null };
export type BlockKind = "intro" | "read" | "quiz" | "break" | "questions" | "free" | "wrap";
/** One step of a day: section P's run-of-show step (k, l, from, to, min, n, title, moved). */
export type Block = { k: BlockKind; l?: string; from?: number; to?: number; min: number; n?: number; title?: string; moved?: boolean };
export type LaneDay = {
  day: string;
  /** 1-based, of total ("יום 6/14"). */
  n: number;
  total: number;
  phase: "shared" | "leave";
  minutes: number;
  blocks: Block[];
  lectures: string[];
  /** Blocks moved here from the day before ("הוזז מאתמול"). */
  movedFrom?: string;
  /** The review day the group gave up (the price "לוותר על יום חזרה אחד"). */
  dropped?: boolean;
};
/** A past day of the lane whose blocks were not reached. */
export type Missed = { day: string; blocks: Block[] };

const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);
const clampMin = (m: number) => Math.max(5, Math.min(LANE.MAX_BLOCK_MIN, round5(m)));
const addDays = (iso: string, n: number) => dateOfDay(dayOfDate(iso) + n);
const days = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = dayOfDate(from); d <= dayOfDate(to); d++) out.push(dateOfDay(d));
  return out;
};

/** A part's weight in minutes: a hot lecture more, one that sits well less (PL6). */
export function weightOf(bucket: MeterRow["bucket"] | undefined): number {
  return bucket === "hot" ? 1.5 : bucket === "warm" ? 1.2 : bucket === "ok" ? 0.8 : 1;
}

/** The plan's study days: from the shared pass to the day before the exam. */
export function planDays(plan: Pick<GroupPlan, "shared_from" | "exam_date">): string[] {
  return dayOfDate(plan.shared_from) < dayOfDate(plan.exam_date) ? days(plan.shared_from, addDays(plan.exam_date, -1)) : [];
}

/** Read blocks fill the day's minutes left after the fixed ones, by weight. */
function fill(blocks: Block[], dayMinutes: number, weights: Map<Block, number>): void {
  const fixed = blocks.filter((b) => !weights.has(b)).reduce((s, b) => s + b.min, 0);
  const total = [...weights.values()].reduce((s, w) => s + w, 0);
  const left = Math.max(weights.size * 10, dayMinutes - fixed);
  for (const [b, w] of weights) b.min = clampMin((left * w) / (total || 1));
}

/** Breaks between read blocks: never two in a row, never first or last. */
function withBreaks(runs: Block[][]): Block[] {
  const out: Block[] = [];
  runs.forEach((r, i) => {
    if (i > 0) out.push({ k: "break", min: LANE.BREAK_MIN });
    out.push(...r);
  });
  return out;
}

/** The group lane (see the top of the file). */
export function buildLane(plan: GroupPlan, facts: Record<string, LectureFact>, meter: readonly MeterRow[] | null = null, missed: readonly Missed[] = []): LaneDay[] {
  const all = planDays(plan);
  const lectures = plan.lecture_ids.filter((l) => facts[l]);
  const bucket = new Map((meter ?? []).map((r) => [r.lecture_id, r.bucket]));
  const shared = all.filter((d) => d < plan.leave_from);
  const leave = all.filter((d) => d >= plan.leave_from);
  const byDay = new Map<string, LaneDay>(
    all.map((d, i) => [
      d,
      { day: d, n: i + 1, total: all.length, phase: d < plan.leave_from ? "shared" : "leave", minutes: d < plan.leave_from ? plan.shared_minutes : plan.leave_minutes, blocks: [], lectures: [] },
    ]),
  );

  // The shared pass: every part once, in the plan's order, spread by weight.
  if (shared.length) {
    const units = lectures.flatMap((l) => Array.from({ length: Math.max(1, facts[l].parts) }, (_, p) => ({ l, p, w: weightOf(bucket.get(l)) })));
    const sum = units.reduce((s, u) => s + u.w, 0);
    const per = sum / shared.length;
    const at: Array<Array<{ l: string; p: number; w: number }>> = shared.map(() => []);
    let cum = 0;
    for (const u of units) {
      at[Math.min(shared.length - 1, Math.floor((cum + u.w / 2) / (per || 1)))].push(u);
      cum += u.w;
    }
    at.forEach((us, i) => {
      const day = byDay.get(shared[i])!;
      const runs: Block[][] = [];
      const weights = new Map<Block, number>();
      for (const u of us) {
        const last = runs[runs.length - 1];
        const read = last?.[0];
        if (read && read.l === u.l && read.to === u.p - 1) {
          read.to = u.p;
          weights.set(read, (weights.get(read) ?? 0) + u.w);
          continue;
        }
        const r: Block = { k: "read", l: u.l, from: u.p, to: u.p, min: 0 };
        weights.set(r, u.w);
        runs.push([r, { k: "quiz", l: u.l, n: LANE.QUIZ_N, min: LANE.QUIZ_MIN }]);
      }
      if (!runs.length) return;
      day.blocks = [{ k: "intro", min: LANE.INTRO_MIN, title: "שאלות פתיחה" }, ...withBreaks(runs)];
      fill(day.blocks, day.minutes, weights);
    });
  }

  // Study leave: rounds − 1 passes over every lecture, each longer than the last (PL4).
  if (leave.length) {
    const passes = Math.max(1, plan.rounds - 1);
    const grow = Array.from({ length: passes }, (_, i) => 2 ** i);
    const sumG = grow.reduce((s, g) => s + g, 0);
    let acc = 0;
    const bounds = grow.map((g) => {
      const from = Math.round((leave.length * acc) / sumG);
      acc += g;
      return [Math.min(from, leave.length - 1), Math.max(Math.min(from, leave.length - 1) + 1, Math.round((leave.length * acc) / sumG))] as const;
    });
    const reviews: Array<Array<{ l: string; r: number }>> = leave.map(() => []);
    bounds.forEach(([a, b], pass) => {
      const len = b - a;
      lectures.forEach((l, i) => reviews[Math.min(leave.length - 1, a + Math.floor((i * len) / Math.max(1, lectures.length)))].push({ l, r: pass + 2 }));
    });
    reviews.forEach((rs, i) => {
      const day = byDay.get(leave[i])!;
      const weights = new Map<Block, number>();
      const runs: Block[][] = rs.map(({ l, r }) => {
        const b: Block = { k: "read", l, from: 0, to: Math.max(0, facts[l].parts - 1), min: 0, title: `סבב ${r}` };
        weights.set(b, weightOf(bucket.get(l)));
        return [b, { k: "quiz", l, n: LANE.QUIZ_N, min: LANE.QUIZ_MIN }];
      });
      runs.unshift([{ k: "free", min: LANE.PAST_EXAMS_MIN, title: "שחזורים" }]);
      runs.push([{ k: "questions", min: LANE.QUESTIONS_MIN, title: "מה שלא ישב טוב" }]);
      day.blocks = [{ k: "intro", min: LANE.INTRO_MIN, title: "שאלות פתיחה" }, ...withBreaks(runs)];
      if (weights.size) fill(day.blocks, day.minutes, weights);
    });
  }

  // A day that slipped: its blocks move to the next day (PL5), and the price chosen applies.
  for (const m of [...missed].sort((a, b) => (a.day < b.day ? -1 : 1))) {
    const next = all.find((d) => d > m.day);
    if (!next) continue;
    const day = byDay.get(next)!;
    const moved = m.blocks.filter((b) => b.k === "read" || b.k === "quiz" || b.k === "questions").map((b) => ({ ...b, moved: true }));
    if (!moved.length) continue;
    const head = day.blocks[0]?.k === "intro" ? [day.blocks[0]] : [{ k: "intro" as const, min: LANE.INTRO_MIN, title: "שאלות פתיחה" }];
    const rest = day.blocks[0]?.k === "intro" ? day.blocks.slice(1) : day.blocks;
    day.blocks = [...head, ...moved, ...(rest.length ? [{ k: "break" as const, min: LANE.BREAK_MIN }, ...rest] : [])];
    day.movedFrom = m.day;
    const slip = [...(plan.slips ?? [])].reverse().find((s) => s.day === m.day);
    if (slip?.choice === "longer") {
      const until = slip.until ?? next;
      for (const d of all) if (d >= next && d <= until) byDay.get(d)!.minutes += LANE.LONGER_MIN;
    } else if (slip?.choice === "drop_review") {
      const last = [...leave].reverse().map((d) => byDay.get(d)!).find((x) => !x.dropped && x.blocks.some((b) => b.k === "read"));
      if (last) {
        last.blocks = last.blocks.filter((b) => b.k !== "read" && b.k !== "quiz" && !(b.k === "break"));
        last.dropped = true;
      }
    } else {
      day.minutes += moved.reduce((s, b) => s + b.min, 0);
    }
  }

  for (const d of byDay.values()) {
    if (d.blocks.length > LANE.MAX_STEPS) d.blocks = d.blocks.slice(0, LANE.MAX_STEPS);
    d.lectures = [...new Set(d.blocks.map((b) => b.l).filter((l): l is string => Boolean(l)))];
  }
  return all.map((d) => byDay.get(d)!);
}

/** The day's minutes for its marathon (section P: 30-720). */
export const marathonMinutes = (d: Pick<LaneDay, "blocks" | "minutes">): number =>
  Math.max(30, Math.min(LANE.MAX_DAY_MIN, Math.max(d.minutes, d.blocks.reduce((s, b) => s + b.min, 0))));

/** "HH:MM" → minutes after midnight. */
export const minutesOfClock = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
/** Minutes after midnight → "HH:MM". */
export const clockOf = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Each block's start, from the day's start ("09:00"). */
export function blockTimes(blocks: readonly Pick<Block, "min">[], start: string): string[] {
  let t = minutesOfClock(start);
  return blocks.map((b) => {
    const s = clockOf(t);
    t += b.min;
    return s;
  });
}
/** When the group's day ends. */
export const dayEnd = (blocks: readonly Pick<Block, "min">[], start: string): number => minutesOfClock(start) + blocks.reduce((s, b) => s + b.min, 0);

/** The chip of the block that comes next today: "בעוד 20 דק׳" (within SOON_MIN) or "עכשיו"; null for none. */
export function nextBlock(blocks: readonly Pick<Block, "min">[], start: string, nowMin: number): { i: number; chip: string } | null {
  let t = minutesOfClock(start);
  for (let i = 0; i < blocks.length; i++) {
    const end = t + blocks[i].min;
    if (nowMin < t) return t - nowMin <= LANE.SOON_MIN ? { i, chip: `בעוד ${t - nowMin} דק׳` } : null;
    if (nowMin < end) return { i, chip: "עכשיו" };
    t = end;
  }
  return null;
}

/** The marathon metaphor (plan.html s1): the shared pass is the first 21 km, study leave the rest, the exam at 42. */
export function kmOn(plan: Pick<GroupPlan, "shared_from" | "leave_from" | "exam_date">, day: string): number {
  const d = dayOfDate(day);
  const s = dayOfDate(plan.shared_from);
  const l = dayOfDate(plan.leave_from);
  const e = dayOfDate(plan.exam_date);
  if (d <= s) return 0;
  if (d >= e) return 42;
  if (d < l) return Math.round((21 * (d - s)) / Math.max(1, l - s));
  return 21 + Math.round((21 * (d - l)) / Math.max(1, e - l));
}

/** The plan's phase on a day. */
export function phaseOn(plan: Pick<GroupPlan, "shared_from" | "leave_from" | "exam_date">, day: string): "before" | "shared" | "leave" | "exam" | "after" {
  if (day < plan.shared_from) return "before";
  if (day < plan.leave_from) return "shared";
  if (day < plan.exam_date) return "leave";
  return day === plan.exam_date ? "exam" : "after";
}

/** "אמצע הדרך ✓ כל הסיכומים נקראו": every lecture read by at least half the members. */
export function allRead(facts: readonly Pick<LectureFact, "readers">[], members: number): boolean {
  return facts.length > 0 && facts.every((f) => f.readers * 2 >= Math.max(1, members));
}

/** "עוד אדם אחד" · "עוד 2 אנשים". */
export const morePeople = (n: number): string => (n === 1 ? "עוד אדם אחד" : `עוד ${n} אנשים`);

/** Decision 3's meter: the head and how far the nearest lecture is, from the counts alone. */
export function planMeter(rows: readonly MeterRow[]): { head: string; next: string; have: number; total: number } {
  const have = rows.filter((r) => r.answers_short === 0 && r.members_short === 0).length;
  const total = rows.length;
  const head = `התוכנית מדייקת ככל שמתרגלים: ${have} מתוך ${total} הרצאות עם נתונים`;
  const wait = rows.filter((r) => r.answers_short > 0 || r.members_short > 0);
  if (!wait.length) return { head, next: "", have, total };
  const best = [...wait].sort((a, b) => a.answers_short + 10 * a.members_short - (b.answers_short + 10 * b.members_short))[0];
  const parts = [best.answers_short > 0 ? `עוד כ-${best.answers_short} תשובות` : "", best.members_short > 0 ? morePeople(best.members_short) : ""].filter(Boolean);
  return { head, next: `${parts.join(" ו")} להרצאה הבאה`, have, total };
}

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
/** "שישי" for a date. */
export const dayName = (iso: string): string => DAY_NAMES[weekday(dayOfDate(iso))];
/** "ה-5.1" for a date (the exam's line). */
export const shortDate = (iso: string): string => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}.${m}`;
};

/** A past day of the lane whose run-of-show was not finished: the steps after
 *  the last one reached (none started: all of them). A day the group ended
 *  ("סיום") is done; a cancelled day moves nothing. */
export function missedOf(
  days: ReadonlyArray<{ plan_day: string | null; agenda: Block[]; step: number; state: string }>,
  today: string,
): Missed[] {
  return days
    .filter((m) => m.plan_day && m.plan_day < today && m.state !== "ended" && m.state !== "cancelled")
    .map((m) => ({ day: m.plan_day!, blocks: m.agenda.slice(Math.max(0, m.step + 1)).filter((b) => b.k === "read" || b.k === "quiz" || b.k === "questions") }))
    .filter((m) => m.blocks.length > 0);
}

/** The slip the group has not priced yet: the latest missed day without a choice. */
export function pendingSlip(plan: Pick<GroupPlan, "slips">, missed: readonly Missed[]): Missed | null {
  const priced = new Set((plan.slips ?? []).map((s) => s.day));
  return [...missed].reverse().find((m) => !priced.has(m.day)) ?? null;
}

/** "עוד שעה ביום עד {day}": the date the longer days last until. */
export function longerUntil(plan: Pick<GroupPlan, "exam_date">, missedDay: string): string {
  const next = addDays(missedDay, 1);
  const last = addDays(plan.exam_date, -1);
  const until = addDays(next, LANE.LONGER_DAYS);
  return until < last ? until : last > next ? last : addDays(next, 1);
}

/** The two prices of a slip, in plan.html s2's words. */
export function slipPrices(plan: Pick<GroupPlan, "exam_date">, missedDay: string): { longer: string; drop: string; until: string } {
  const until = longerUntil(plan, missedDay);
  return { longer: `עוד שעה ביום עד ${dayName(until)}`, drop: "לוותר על יום חזרה אחד", until };
}

/** A block as a row of the day (plan.html s1): the title, the line, the slides. */
/** How many ≈50-minute blocks a read of these minutes is. */
export const blocksIn = (min: number): number => Math.max(1, Math.round(min / LANE.BLOCK_MIN));

/** "שני בלוקים, עד 12:40" for a long read (plan.html s1), or "". */
export function blocksLine(min: number, end?: string): string {
  const n = blocksIn(min);
  if (n < 2) return "";
  return `${n === 2 ? "שני בלוקים" : `${n} בלוקים`}${end ? `, עד ${end}` : ""}`;
}

export function blockRow(b: Block, facts: Record<string, LectureFact>, next?: Block, end?: string): { title: string; line: string; slides: [number, number] | null } {
  const f = b.l ? facts[b.l] : undefined;
  const slides = (() => {
    if (!f?.slides?.length || b.from === undefined) return null;
    const a = f.slides[Math.min(f.slides.length - 1, b.from)];
    const z = f.slides[Math.min(f.slides.length - 1, b.to ?? b.from)];
    return a && z ? ([a[0], z[1]] as [number, number]) : null;
  })();
  const quiz = next?.k === "quiz" && next.l === b.l ? next.n ?? LANE.QUIZ_N : 0;
  switch (b.k) {
    case "intro":
      return { title: b.title || "פתיחה", line: "", slides: null };
    case "read": {
      const many = blocksLine(b.min, end);
      const base = b.title ? `${b.title}: חזרה${quiz ? ` ומבחן קבוצתי, ${quiz} שאלות` : ""}` : `הקראה${quiz ? ` ומבחן קבוצתי, ${quiz} שאלות` : ""}`;
      return { title: f?.title ?? "הרצאה", line: many ? `${base} · ${many}` : base, slides };
    }
    case "quiz":
      return { title: f?.title ?? "מבחן קבוצתי", line: `מבחן קבוצתי, ${b.n ?? LANE.QUIZ_N} שאלות`, slides: null };
    case "break":
      return { title: "הפסקה", line: `${b.min} דק׳`, slides: null };
    case "free":
      return { title: b.title || "זמן חופשי", line: "מבחנים קודמים, יחד", slides: null };
    case "questions":
      return { title: b.title || "שאלות", line: "שאלות פתוחות וטעויות שחוזרות בקבוצה", slides: null };
    case "wrap":
      return { title: b.title || "סיכום", line: "", slides: null };
  }
}

/** The day's rows: a read block and the quiz after it on the same lecture are one row. */
export function dayRows(blocks: readonly Block[]): Array<{ i: number; block: Block; next?: Block }> {
  const out: Array<{ i: number; block: Block; next?: Block }> = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const n = blocks[i + 1];
    if (b.k === "read" && n?.k === "quiz" && n.l === b.l) {
      out.push({ i, block: b, next: n });
      i++;
      continue;
    }
    out.push({ i, block: b });
  }
  return out;
}

/* ── The private lane (PL3) ── */

export type RelearnRow = { lecture_id: string; rounds: number; key_total: number; key_left: number; last_day: string | null; next_day: string | null };
export type LaneRoute = { v: string; [k: string]: unknown };
export type MyRow = { key: string; title: string; line: string; minutes: number; route: LaneRoute; slides?: number[] };

/** The private lane's rows, in order (each the member's own). */
export function myLane(o: {
  plan: Pick<GroupPlan, "rounds" | "lecture_ids" | "leave_from" | "shared_from" | "exam_date">;
  today: string;
  facts: Record<string, LectureFact>;
  /** The shared pass's day of each lecture (its first read block). */
  sharedDay: Record<string, string>;
  relearning: readonly RelearnRow[];
  cardsDue: number;
  mistakes: number;
  /** Topics hot for the member and not for the group (U's merged pulse). */
  alone: ReadonlyArray<{ key: string; label: string; slides?: number[] }>;
  cardsRoute: LaneRoute | null;
  mistakesRoute: LaneRoute | null;
}): MyRow[] {
  const out: MyRow[] = [];
  const { cardsDue: c, mistakes: m } = o;
  if ((c && o.cardsRoute) || (m && o.mistakesRoute)) {
    const cards = c && o.cardsRoute ? (c === 1 ? "כרטיסייה אחת" : `${c} כרטיסיות`) : "";
    const errs = m && o.mistakesRoute ? (m === 1 ? "טעות פתוחה אחת" : `${m} טעויות פתוחות`) : "";
    out.push({
      key: "cards",
      title: [cards, errs].filter(Boolean).join(" ו-"),
      line: errs ? "הטעויות שלך חוזרות בניסוח אחר" : "הכרטיסיות שהגיע זמנן",
      minutes: Math.max(5, Math.ceil(((cards ? c * 30 : 0) + (errs ? m * 75 : 0)) / 60)),
      route: (errs ? o.mistakesRoute : o.cardsRoute)!,
    });
  }
  for (const r of o.relearning) {
    const f = o.facts[r.lecture_id];
    if (!f || r.rounds < 1 || r.rounds >= o.plan.rounds || !r.next_day || r.next_day > o.today || r.key_left <= 0) continue;
    out.push({
      key: `round:${r.lecture_id}`,
      title: `${f.title} · סבב ${r.rounds + 1}`,
      line: r.key_left === 1 ? "שאלת מפתח אחת עד סוף הסבב" : `${r.key_left} שאלות מפתח עד סוף הסבב`,
      minutes: Math.max(5, Math.ceil((r.key_left * 75) / 60)),
      route: { v: "practice", l: r.lecture_id },
    });
  }
  for (const l of o.plan.lecture_ids) {
    const f = o.facts[l];
    const d = o.sharedDay[l];
    // "הקבוצה כבר קראה": its shared day passed and someone read it, but not she.
    if (!f || f.readByMe || f.readers < 1 || !d || d >= o.today) continue;
    out.push({ key: `catchup:${l}`, title: `השלמה · ${f.title}`, line: "הקבוצה כבר קראה. לקרוא בקצב שלך", minutes: 30, route: { v: "lecture", l } });
  }
  for (const t of o.alone) out.push({ key: `topic:${t.key}`, title: t.label, line: "חלש אצלך, ולא אצל הקבוצה", minutes: 3, route: { v: "practice", s: `t.${t.key}`, n: "5" }, slides: t.slides });
  return out;
}

/** The lane's day for a lecture's shared read (the private lane's catch-up). */
export function sharedDays(lane: readonly LaneDay[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of lane) if (d.phase === "shared") for (const b of d.blocks) if (b.k === "read" && b.l && !out[b.l]) out[b.l] = d.day;
  return out;
}

/** The exam-eve view is offered from EVE_DAYS before the exam to its day. */
export function eveOpen(plan: Pick<GroupPlan, "exam_date">, today: string): boolean {
  const d = dayOfDate(plan.exam_date) - dayOfDate(today);
  return d >= 0 && d <= LANE.EVE_DAYS;
}

/** A marathon of its own (not a day of the plan): an opening, then each
 *  lecture read whole with its 5-question quiz, breaks between, the reading
 *  filling the minutes (section P's run-of-show). */
export function marathonAgenda(lectures: readonly Pick<LectureFact, "id" | "parts">[], minutes: number): Block[] {
  const weights = new Map<Block, number>();
  const runs: Block[][] = lectures.map((l) => {
    const r: Block = { k: "read", l: l.id, from: 0, to: Math.max(0, l.parts - 1), min: 0 };
    weights.set(r, Math.max(1, l.parts));
    return [r, { k: "quiz", l: l.id, n: LANE.QUIZ_N, min: LANE.QUIZ_MIN }];
  });
  if (!runs.length) return [];
  const blocks: Block[] = [{ k: "intro", min: LANE.INTRO_MIN, title: "שאלות פתיחה" }, ...withBreaks(runs)];
  fill(blocks, minutes, weights);
  return blocks.slice(0, LANE.MAX_STEPS);
}
