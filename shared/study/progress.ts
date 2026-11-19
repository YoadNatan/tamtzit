/* ── Package A2's numbers and words, pure (spec §12.3.A; Yoad's decisions of
 *    17 Nov 2026) ──
 *
 * The thresholds live once, in shared/study/meters.ts with every other
 * meter's (re-exported here): section P's end (supabase/study-schema.sql)
 * uses the same numbers, and progress.test.ts reads the SQL to check that it
 * does. Below a threshold a screen never hides the place: it says how many
 * more answers it needs (a meter, counted from the member's own rows), as
 * decision 3 asks of every screen that grows with use. Nothing here invents a
 * number: every meter is a threshold minus a count the database returned. */

import { ASPECT_MIN, CALIBRATION_MIN, DANGER_RIGHTS, DANGER_SECOND_DAYS, READINESS_MIN } from "./meters";

export { ASPECT_MIN, CALIBRATION_MIN, DANGER_RIGHTS, DANGER_SECOND_DAYS, READINESS_MIN };

/** One row of study_my_readiness. */
export type ReadinessRow = { lecture_id: string; part_idx: number; heading: string; answers: number; right_n: number; lo: number | null; hi: number | null };
/** One row of study_my_danger_list. */
export type DangerRow = {
  question_id: string;
  lecture_id: string | null;
  wrong_at: string;
  chosen: string;
  right_text: string;
  slides: number[];
  rights: number;
  due_day: string; // YYYY-MM-DD
  ask_id: string;
};
/** One row of study_my_aspects (bucket null below ASPECT_MIN). */
export type AspectRow = { aspect: string; questions: number; wrong_now: number; bucket: "hot" | "warm" | "cool" | null };
/** One row of study_my_calibration. */
export type CalibrationRow = { scope: "part" | "lecture" | "all"; lecture_id: string | null; part_idx: number | null; sure: number; sure_right: number; pct: number | null };
/** study_my_progress_counts: the counts around progress in one call. */
export type ProgressCounts = {
  answers: number;
  parts: number;
  parts_ranged: number;
  sure: number;
  sure_right: number;
  danger: number;
  danger_due: number;
  mistakes: number;
  rewordings_due: number;
  /** What is due again today all told, each question once (the danger list's due rows and the rewordings). */
  again_due: number;
};

/** How many more there must be before a threshold is met (0 once it is). */
export const more = (have: number, need: number): number => Math.max(0, Math.ceil(need) - Math.max(0, Math.floor(have)));

/** "תשובה אחת" / "2 תשובות" (and the like for any noun pair). */
export function count(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** The readiness rows as the screen lists them: ranged parts first, weakest
 *  (lowest lower end) first; then the parts still under the threshold, the
 *  nearest to a range first. */
export function readinessOrder(rows: readonly ReadinessRow[]): ReadinessRow[] {
  const ranged = rows.filter((r) => r.lo !== null && r.hi !== null).sort((a, b) => (a.lo ?? 0) - (b.lo ?? 0) || (a.hi ?? 0) - (b.hi ?? 0) || a.heading.localeCompare(b.heading));
  const waiting = rows.filter((r) => r.lo === null || r.hi === null).sort((a, b) => b.answers - a.answers || a.heading.localeCompare(b.heading));
  return [...ranged, ...waiting];
}

/** A ranged row's end text: "70–85%". */
export const rangeText = (r: Pick<ReadinessRow, "lo" | "hi">): string => (r.lo === null || r.hi === null ? "" : `${r.lo}–${r.hi}%`);

/** The readiness meter under the bars, or null when every part has its
 *  range: the part nearest to a range and how many answers it still needs. */
export function readinessMeter(rows: readonly ReadinessRow[]): { heading: string; left: number } | null {
  const waiting = rows.filter((r) => r.lo === null).sort((a, b) => b.answers - a.answers || a.heading.localeCompare(b.heading));
  if (!waiting.length) return null;
  return { heading: waiting[0].heading, left: more(waiting[0].answers, READINESS_MIN) };
}

/** A danger row's chip: "היום" when due (or overdue), "מחר", else "עוד N ימים". */
export function dueChip(dueDay: string, today: string): string {
  const d = Math.round((Date.parse(`${dueDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(d) || d <= 0) return "היום";
  if (d === 1) return "מחר";
  return `עוד ${d} ימים`;
}

/** The rows due today or before (the "על בטוח" row of Today is the first). */
export const dueToday = (rows: readonly DangerRow[], today: string): DangerRow[] => rows.filter((r) => r.due_day <= today);

/** An aspect's bucket as the chip says it. */
export const BUCKET_TEXT = { hot: "קשה", warm: "בינוני", cool: "יושב טוב" } as const;
export const BUCKET_CHIP = { hot: "warn", warm: "", cool: "ok" } as const;

/** The aspect meter: the aspect nearest to a bucket and how many more
 *  questions it needs, or null when none is waiting. */
export function aspectMeter(rows: readonly AspectRow[]): { aspect: string; left: number } | null {
  const waiting = rows.filter((r) => r.bucket === null).sort((a, b) => b.questions - a.questions || a.aspect.localeCompare(b.aspect));
  return waiting.length ? { aspect: waiting[0].aspect, left: more(waiting[0].questions, ASPECT_MIN) } : null;
}

/** Which calibration line to say (the approved screen names a topic: "במלריה,
 *  כשסימנת ׳על בטוח׳…"): the part with the most "על בטוח" answers that has
 *  its percentage, else such a lecture, else the overall row; or, while none
 *  has one, how many more "על בטוח" answers the overall row needs. */
export function calibrationPick(rows: readonly CalibrationRow[]): { row: CalibrationRow } | { left: number } {
  for (const scope of ["part", "lecture", "all"] as const) {
    const r = rows.filter((x) => x.scope === scope && x.pct !== null).sort((a, b) => b.sure - a.sure)[0];
    if (r) return { row: r };
  }
  const all = rows.find((x) => x.scope === "all");
  return { left: more(all?.sure ?? 0, CALIBRATION_MIN) };
}

/** "Me"'s progress row's line: what there is so far, from the counts. */
export function progressLine(c: ProgressCounts | null): string {
  if (!c || c.answers === 0) return `עוד אין תשובות. טווח מוכנות מופיע מ-${READINESS_MIN} תשובות לנושא.`;
  const parts: string[] = [`${count(c.answers, "תשובה אחת", "תשובות")} ב-28 הימים האחרונים`];
  if (c.danger_due) parts.push(c.danger_due === 1 ? "טעות ׳על בטוח׳ אחת להיום" : `${c.danger_due} טעויות ׳על בטוח׳ להיום`);
  else if (c.danger) parts.push(c.danger === 1 ? "טעות ׳על בטוח׳ אחת" : `${c.danger} טעויות ׳על בטוח׳`);
  return parts.join(" · ");
}

/** "Me"'s mistakes row's line, from the counts. */
export function mistakesLine(c: ProgressCounts | null): string {
  if (!c || c.mistakes === 0) return "אין כרגע טעויות פתוחות.";
  const open = c.mistakes === 1 ? "טעות פתוחה אחת" : `${c.mistakes} טעויות פתוחות`;
  if (!c.rewordings_due) return open;
  return `${open} · ${c.rewordings_due === 1 ? "אחת חוזרת היום" : `${c.rewordings_due} חוזרות היום`} בניסוח אחר`;
}
