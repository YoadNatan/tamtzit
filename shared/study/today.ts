/* ── Today's queue: one table, one priority order (package T; spec §12.4.T) ──
 *
 * Pure, so the screen, the session and the tests read one table (review
 * F-9: the three designs' rows, one source each). `cutQueue` takes every
 * source's items, keeps the ones whose flag is on, sorts them by the table's
 * priority (oldest first inside a row) and fills the chosen minutes greedily:
 * an item that does not fit is skipped and a smaller one after it may still
 * go in; at least one item always goes; the rest rolls over silently. Every
 * number Today shows is computed here from real counts, and its constants
 * (the minute chips, each kind's estimate, the flame's 4 of 7) are in this
 * one place, with today.test.ts. */

import { NEEDS_ME } from "./meters";

/** A row of the table. `again` is Q-2's: due mistakes in another wording
 *  ("הטעויות שלי", study_my_rewordings), beside the danger row. */
export type Kind = "update" | "quiz" | "danger" | "again" | "unclear" | "card" | "loot" | "practice" | "lane";

/** The flag a kind waits for (shared/study/flags.ts's names). */
export type KindFlag = "var" | "quiz" | "progress" | "mistakes" | "meeting" | "cardsReview" | "boss" | "pulse" | "groupPlan";

export type QueueItem = {
  /** Unique in a day's queue ("card:<id>", "quiz:<question>"). */
  key: string;
  kind: Kind;
  /** Quiz returns: 1 the next study day, 2 the third. */
  step?: 1 | 2;
  /** Estimated seconds (the table's, or the item's own for a lane row). */
  seconds: number;
  /** For "oldest first inside a row": an ISO time or any sortable string. */
  at: string;
  /** What the row's example line shows (a card's front, a question, a quote). */
  example?: string;
  /** The slides the example cites ("ש׳ 17"). */
  slides?: number[];
  /** A trap card ("טעות נפוצה בקבוצה" instead of "הגיע הזמן"). */
  trap?: boolean;
  /** The danger row asked in another wording. */
  otherWording?: boolean;
  /** The source's own row, for the session (an update, a tap, a question id …). */
  ref?: Record<string, unknown>;
};

/** The table (spec §12.4.T), in priority order. Seconds are the estimate. */
export const ROWS: ReadonlyArray<{ kind: Kind; step?: 1 | 2; flag: KindFlag; seconds: number; chip: string; tone: "" | "busy" | "bad" | "warn" | "group" | "ok" | "fun" }> = [
  { kind: "update", flag: "var", seconds: 30, chip: "תוקן אחרי שלמדת", tone: "busy" },
  { kind: "quiz", step: 1, flag: "quiz", seconds: 75, chip: "טעית אתמול", tone: "bad" },
  { kind: "danger", flag: "progress", seconds: 75, chip: "על בטוח", tone: "warn" },
  { kind: "again", flag: "mistakes", seconds: 75, chip: "בניסוח אחר", tone: "warn" },
  { kind: "unclear", flag: "meeting", seconds: 90, chip: "מהפגישה", tone: "group" },
  { kind: "card", flag: "cardsReview", seconds: 30, chip: "הגיע הזמן", tone: "busy" },
  { kind: "quiz", step: 2, flag: "quiz", seconds: 75, chip: "טעית לפני 3 ימים", tone: "bad" },
  { kind: "loot", flag: "boss", seconds: 75, chip: "מהאתגר", tone: "fun" },
  { kind: "practice", flag: "pulse", seconds: 180, chip: "חלש אצלך, ולא אצל הקבוצה", tone: "warn" },
  { kind: "lane", flag: "groupPlan", seconds: 0, chip: "מהמסלול שלך", tone: "busy" },
];

/** A case question takes longer (the table's "75 s (case 120)"). */
export const CASE_SECONDS = 120;
/** The trap card's chip (one chip: U's CardBadge words, review F-11). */
export const TRAP_CHIP = "טעות נפוצה בקבוצה";

/** The minute chips, "10 · 20 דק׳ · 45" (per device). */
export const MINUTES = [10, 20, 45] as const;
export type Minutes = (typeof MINUTES)[number];
export const DEFAULT_MINUTES: Minutes = 20;
export const MINUTES_KEY = "study-today-minutes";
export const asMinutes = (v: unknown): Minutes => (MINUTES as readonly number[]).includes(Number(v)) ? (Number(v) as Minutes) : DEFAULT_MINUTES;

/** The flame (T5): active days among the last FLAME_WINDOW, lit from FLAME_LIT. */
export const FLAME_WINDOW = 7;
export const FLAME_LIT = 4;

/** The row of the table an item belongs to (its priority), or -1. */
export function rowOf(item: Pick<QueueItem, "kind" | "step">): number {
  return ROWS.findIndex((r) => r.kind === item.kind && (r.step === undefined || r.step === (item.step ?? 1)));
}

/** The seconds an item is estimated at: its own when it has one (a lane row), else its row's. */
export function secondsOf(item: Pick<QueueItem, "kind" | "step" | "seconds">): number {
  if (item.seconds > 0) return item.seconds;
  const r = ROWS[rowOf(item)];
  return r ? r.seconds : 60;
}

/** The items in the table's order: by row, oldest first inside it, then by key. */
export function ordered(items: readonly QueueItem[], on: (flag: KindFlag) => boolean): QueueItem[] {
  return items
    .filter((i) => rowOf(i) >= 0 && on(ROWS[rowOf(i)].flag))
    .sort((a, b) => rowOf(a) - rowOf(b) || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The day's cut (spec §12.4.T): priority order, greedy skip, at least one
 *  item. Items whose flag is off never appear. `rest` is what rolls over. */
export function cutQueue(items: readonly QueueItem[], minutes: number, on: (flag: KindFlag) => boolean): { items: QueueItem[]; seconds: number; rest: number } {
  const all = ordered(items, on);
  const budget = Math.max(0, minutes) * 60;
  const out: QueueItem[] = [];
  let used = 0;
  for (const i of all) {
    const s = secondsOf(i);
    if (used + s <= budget) {
      out.push(i);
      used += s;
    }
  }
  if (!out.length && all.length) {
    out.push(all[0]);
    used = secondsOf(all[0]);
  }
  return { items: out, seconds: used, rest: all.length - out.length };
}

/** "להתחיל · {n} דק׳": the cut's minutes, rounded up (at least 1). */
export const minutesOf = (seconds: number): number => Math.max(1, Math.ceil(seconds / 60));

/** One line of "התור שלי": consecutive items of one row, with its words. */
export type RowLine = { kind: Kind; step?: 1 | 2; n: number; label: string; chip: string; tone: string; example?: string; slides?: number[]; keys: string[] };

const count = (n: number, one: string, many: (n: number) => string) => (n === 1 ? one : many(n));

/** The row's title as today.html s1 words it. */
export function rowLabel(kind: Kind, n: number, o: { otherWording?: boolean; topic?: string } = {}): string {
  switch (kind) {
    case "card":
      return count(n, "כרטיסייה אחת", (k) => `${k} כרטיסיות`);
    case "quiz":
      return `${n} מהמבחן הקבוצתי`;
    case "danger":
      return o.otherWording ? `${n} מטעויות ׳על בטוח׳, בניסוח חדש` : `${n} מטעויות ׳על בטוח׳`;
    case "again":
      return count(n, "טעות אחת בניסוח אחר", (k) => `${k} טעויות בניסוח אחר`);
    case "unclear":
      return count(n, "פסקה שסימנת ׳לא ברור׳", (k) => `${k} פסקאות שסימנת ׳לא ברור׳`);
    case "update":
      return count(n, "עדכון בסיכום", (k) => `${k} עדכונים בסיכום`);
    case "loot":
      return count(n, "שאלה אחת מהאתגר", (k) => `${k} שאלות מהאתגר`);
    case "practice":
      return o.topic ? `תרגול קצר · ${o.topic}` : "תרגול קצר";
    case "lane":
      return o.topic || "מהמסלול שלך";
  }
}

/** The cut, grouped into its lines (each row's items together, in order). */
export function rowLines(items: readonly QueueItem[]): RowLine[] {
  const out: RowLine[] = [];
  for (const i of items) {
    const row = ROWS[rowOf(i)];
    if (!row) continue;
    const last = out[out.length - 1];
    // A pulse topic or a lane row is a line of its own; the others gather.
    if (last && last.kind === i.kind && last.step === row.step && i.kind !== "practice" && i.kind !== "lane") {
      last.n += 1;
      last.keys.push(i.key);
      continue;
    }
    out.push({ kind: i.kind, step: row.step, n: 1, label: "", chip: row.chip, tone: row.tone, example: i.example, slides: i.slides, keys: [i.key] });
  }
  for (const l of out) {
    const its = items.filter((i) => l.keys.includes(i.key));
    l.label = rowLabel(l.kind, l.n, { otherWording: its.some((i) => i.otherWording), topic: l.kind === "practice" || l.kind === "lane" ? its[0]?.example : undefined });
    if (l.kind === "card" && its.length && its.every((i) => i.trap)) {
      l.chip = TRAP_CHIP;
      l.tone = "group";
    }
    if (l.kind === "practice" || l.kind === "lane") l.example = undefined;
  }
  return out;
}

/** The flame's chip and line ("ימי למידה 4/7"; T5: private, never reset by one missed day). */
export function flameChip(days: number): string {
  return `ימי למידה ${Math.max(0, Math.min(FLAME_WINDOW, days))}/${FLAME_WINDOW}`;
}
export function flameLine(days: number): string {
  const d = Math.max(0, Math.min(FLAME_WINDOW, days));
  return `למדת ${d} מתוך ${FLAME_WINDOW} הימים האחרונים. מ-${FLAME_LIT} ימים זה מסומן, ויום אחד בלי לימוד לא מוחק את זה. גלוי רק לך.`;
}
export const flameLit = (days: number): boolean => days >= FLAME_LIT;

/** The session's key for the day's order (sessionStorage; F's study- prefix). */
export const dayKey = (userId: string, day: number): string => `study-today:${userId}:${day}`;

/** "היום · יום ג׳" for a study day (days since 1970-01-01, a Thursday). */
export function dayTitle(day: number): string {
  const names = ["יום א׳", "יום ב׳", "יום ג׳", "יום ד׳", "יום ה׳", "יום ו׳", "שבת"];
  return `היום · ${names[(((day + 4) % 7) + 7) % 7]}`;
}

/** The end of the session and the empty queue, in the spec's words. */
export const DONE_LINE = "התור של היום הושלם. מה שנשאר עובר למחר.";
export const EMPTY_LINE = "אין כלום בתור כרגע.";

/* ── T-2: "הקבוצה צריכה אותך" (spec §12.4.T's D11; decision 3) ──
 * Opt-in, off by default. An open question of another member, 2 hours to
 * 14 days old, goes to one opted-in member who mastered its topic: at least
 * MIN_ANSWERS of its questions answered, MASTER_PCT% of them right (her
 * latest answer to each). Section T's end mirrors these numbers
 * (study_private.needs_me_*); today.test.ts reads the SQL and fails if they
 * differ. */
export { NEEDS_ME };

/** study_needs_me's rows (only the chosen member gets a question; any opted-in member but its author the approval). */
export type NeedsMeRow =
  | { kind: "question"; comment_id: string; lecture_id: string; lecture_title: string; part: number; anchor: number; quote: string; body: string; topic: string; right: number; of: number }
  | { kind: "approval"; proposal_id: string; lecture_id: string; lecture_title: string; part: number; anchor: number; note: string; by: string | null };

/** study_needs_me_meter: the member's own counts. */
export type NeedsMeMeter = { on: boolean; topics: number; next: { topic: string; lecture_id: string; short: number } | null; open: number };

/** "בקבוצה"'s open question, unless "הקבוצה צריכה אותך" already shows it
 *  (review UI-3): one question, once on Today. Section T at 3 already leaves
 *  needs_me's question out of open_question; this keeps the screen right on
 *  T 2 too. `shown`: whether the needs-me card is on (its flag). */
export function groupQuestion<Q extends { id: string }>(open: Q | null | undefined, needs: ReadonlyArray<Record<string, unknown>> | null | undefined, shown: boolean): Q | null {
  if (!open) return null;
  if (shown && (needs ?? []).some((r) => r.kind === "question" && r.comment_id === open.id)) return null;
  return open;
}

/** "4 מתוך 5": the mastery rule in words, from MASTER_PCT. */
export function masteryWords(pct: number = NEEDS_ME.MASTER_PCT): string {
  for (const of of [5, 4, 10, 3, 2]) if ((pct * of) % 100 === 0) return `${(pct * of) / 100} מתוך ${of}`;
  return `${pct}%`;
}

/** Why the question came to her (only she sees it). */
export const whyLine = (r: { topic: string; right: number; of: number }): string => `הגיעה אליך כי ענית נכון על ${r.right} מתוך ${r.of} שאלות על ${r.topic}. גלוי רק לך.`;

/** Decision 3's meter, when nothing waits for her: never a dead end, from her own counts. */
export function needsMeLines(m: NeedsMeMeter): { head: string; line: string } {
  const head =
    m.topics === 0 ? "עוד אין שאלה בשבילך" : m.topics === 1 ? "נושא אחד שבו אפשר לעזור · אין עכשיו שאלה פתוחה בו" : `${m.topics} נושאים שבהם אפשר לעזור · אין עכשיו שאלה פתוחה בהם`;
  const rule = `שאלה פתוחה מגיעה למי שענו נכון על ${masteryWords()} לפחות בנושא שלה (${NEEDS_ME.MIN_ANSWERS} שאלות ומעלה).`;
  const next = m.next ? ` עוד כ-${m.next.short} ${m.next.short === 1 ? "תשובה נכונה" : "תשובות נכונות"} על ${m.next.topic} לנושא הבא.` : "";
  return { head, line: rule + next };
}
