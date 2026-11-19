/* ── The pulse's rules and words, pure (package U; spec §12.5.U, the fun
 * design §5.5-§5.6, Yoad's decisions 1 and 3 of 17 Nov 2026) ──
 *
 * The thresholds live in one place, shared/study/meters.ts (re-exported
 * here): section U of supabase/study-schema.sql reads the same numbers from
 * its functions (study_private.pulse_floor() and the rest). pulse.test.ts
 * reads them from the SQL file and fails when the two disagree. Nothing here
 * counts people: the counts come from the database's night, and these
 * functions only choose the words ("עוד אדם אחד וזה נפתח") from what it sent.
 * No React and no Supabase, so the tests run in Node. */

import { ASPECT_HE, aspectOf } from "./aspects";
import { FLOOR, PULSE } from "./meters";

export { PULSE };

export type Bucket = "hot" | "warm" | "cool";
export const BUCKET_HE: Record<Bucket, string> = { hot: "חם", warm: "פושר", cool: "יושב טוב" };
/** The chip's look per bucket (never colour alone: the word is the chip). */
export const BUCKET_CHIP: Record<Bucket, string> = { hot: "warn", warm: "", cool: "ok" };
export const BUCKETS: Bucket[] = ["hot", "warm", "cool"];

/** study_pulse(): one row the group sees. */
export type PulseRow = {
  lecture_id: string;
  topic_key: string;
  topic: string;
  aspect: string;
  bucket: Bucket;
  slides: number[];
  closed_week: boolean;
  cutoff: string;
};
/** study_my_pulse(): the member's own bucket ("אצלך"). */
export type MyRow = { lecture_id: string; topic_key: string; aspect: string; items: number; wrong: number; mine: Bucket; topic: string };

/** study_pulse_meter() (decision 3). */
export type LectureMeter = { lecture_id: string; open: number; waiting: number; need: number | null };
export type Meter =
  | { state: "off"; floor: number }
  | { state: "out"; floor: number }
  | { state: "waiting"; floor: number; join_days: number; join_days_left: number }
  | { state: "open"; floor: number; cutoff: string; group_need: number; lectures: LectureMeter[] };

/** "{topic} · {aspect}" ("אחר" adds nothing). */
export function pulseLabel(topic: string, aspect: string): string {
  const a = aspectOf(aspect);
  return a === "other" ? topic : `${topic} · ${ASPECT_HE[a]}`;
}

export type MergedRow = PulseRow & {
  /** The member's own bucket, when they have evidence there. */
  mine?: Bucket;
  /** P-5: the group's is not hot, the member's is. */
  alone: boolean;
  /** P-6: the one row that shows "החור שנסגר השבוע". */
  closedNote: boolean;
};

/** The group's rows with the member's own beside each (P-3 … P-6): at most
 *  one row carries "החור שנסגר השבוע". */
export function mergePulse(group: readonly PulseRow[], mine: readonly MyRow[]): MergedRow[] {
  const own = new Map(mine.map((m) => [`${m.lecture_id}|${m.topic_key}|${m.aspect}`, m.mine]));
  let closed = false;
  return group.map((g) => {
    const m = own.get(`${g.lecture_id}|${g.topic_key}|${g.aspect}`);
    const closedNote = !closed && g.closed_week && g.bucket === "cool";
    if (closedNote) closed = true;
    return { ...g, mine: m, alone: g.bucket !== "hot" && m === "hot", closedNote };
  });
}

/** The rows by bucket, only the non-empty sections, hot first. */
export function sections<T extends { bucket: Bucket }>(rows: readonly T[]): Array<{ bucket: Bucket; rows: T[] }> {
  return BUCKETS.map((bucket) => ({ bucket, rows: rows.filter((r) => r.bucket === bucket) })).filter((s) => s.rows.length);
}

/** P-10: a lecture's line in the list. */
export function lectureLine(rows: readonly PulseRow[]): string {
  const hot = rows.filter((r) => r.bucket === "hot").map((r) => r.topic);
  const uniq = [...new Set(hot)];
  return uniq.length ? `נקודות חמות: ${uniq.slice(0, 2).join(", ")}` : "הכול יושב טוב";
}

/** Decision 3's meter line: how many more people open the next row. */
export function needLine(need: number): string {
  if (need <= 1) return "עוד אדם אחד וזה נפתח";
  return `עוד ${need} אנשים וזה נפתח`;
}

/** A lecture's meter under its rows: "2 מתוך 3 נושאים פתוחים · עוד אדם אחד לנושא הבא". */
export function lectureMeterLine(m: LectureMeter | undefined): string {
  if (!m || !m.waiting || m.need == null) return "";
  const of = `${m.open} מתוך ${m.open + m.waiting} נושאים פתוחים`;
  const next = m.need <= 1 ? "עוד אדם אחד לנושא הבא" : `עוד ${m.need} אנשים לנושא הבא`;
  return m.open ? `${of} · ${next}` : needLine(m.need);
}

/** The group is below the floor: how many more counted members open it. */
export function groupNeedLine(need: number): string {
  return need <= 1 ? `הדופק נפתח מ-${FLOOR} מתרגלים: עוד אדם אחד וזה נפתח.` : `הדופק נפתח מ-${FLOOR} מתרגלים: עוד ${need} אנשים וזה נפתח.`;
}

/** P-14 with its meter: a member the night has not counted yet. */
export function waitingLine(daysLeft: number): string {
  const when = daysLeft <= 1 ? "מחר" : daysLeft === 2 ? "בעוד יומיים" : `בעוד ${daysLeft} ימים`;
  return `הדופק מוצג למי שנספרים בו: שבוע בקבוצה, והספירה בלילה. הדופק ייפתח לך ${when}.`;
}

/** P-8's opted-out line (§12.5.U's version). */
export const OUT_LINE = "התשובות שלך לא נספרות בדופק, ולכן גם הדופק לא מוצג. אפשר לחזור לספירה ב׳שלי׳, והדופק יחזור אחרי הספירה של הלילה.";
/** P-9: a lecture with no row yet. */
export const EMPTY_LINE = `עוד אין דופק להרצאה הזו. הוא מופיע כשלפחות ${FLOOR} מכם מתרגלים אותה, ומתעדכן בלילה.`;
/** P-12, with §12.5.U's last sentence. */
export const SETTING_LINE =
  "התשובות, ההימורים, השכחות וסימוני ׳לא ברור׳ שלך לא ייספרו בדופק, ב׳דרושה אסוציאציה׳ ובבחירת השאלות, מהלילה הבא. אפשר לחזור בכל רגע. מי שיוצאים מהספירה לא רואים את הדופק.";

/** P-7's opening: tomorrow's meeting, or the next one. */
export function briefHead(nextMeetingDay: string | null, today: string): string {
  if (!nextMeetingDay) return "בפגישה הבאה:";
  const t = new Date(`${today}T12:00:00Z`).getTime();
  const d = new Date(`${nextMeetingDay}T12:00:00Z`).getTime();
  return Math.round((d - t) / 86_400_000) === 1 ? "מחר בפגישה:" : "בפגישה הבאה:";
}

/** Q10 in practice: a question's group signal as a weight (3 sure · 2 missed · 1 split). */
export const SIGNAL_WEIGHT: Record<"sure" | "missed" | "split", number> = { sure: 3, missed: 2, split: 1 };
