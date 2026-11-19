/* ── The boss battle's rules and words, pure (package H, H-1; spec §12.5.H,
 * the fun design B1-B3, mockup boss.html; Yoad's decisions 1 and 3 of 17
 * Nov 2026) ──
 *
 * The thresholds live in one place, shared/study/meters.ts (BOSS,
 * re-exported here): section H of supabase/study-schema.sql reads the same
 * numbers from its functions (study_private.boss_min_heads() and the rest).
 * boss.test.ts and meters.test.ts read them from the SQL file and fails when the two
 * disagree. The battle's numbers (hit points, the moments) are the
 * database's; these functions only choose the words. No React, no Supabase. */

import { BOSS, FLOOR } from "./meters";

export { BOSS };

/** study_boss_open(): the card's heads, the revenge round and the meter. */
export type BossOpen = {
  state: "off" | "out" | "waiting" | "open";
  floor: number;
  join_days_left?: number;
  group_need?: number;
  heads: string[];
  hot: number;
  topics: number;
  min_heads: number;
  answers_next: number | null;
  revenge?: { battle: string; name: string; heads: string[] | null; open: boolean } | null;
};

/** study_quiz_state().boss: the battle as every phone shows it. */
export type BossHead = { name: string; hp: number; max: number; down: boolean; relapses: number; slides: number[] };
export type Moment = { t: "trap" | "down" | "relapse" | "last" | "fall"; head?: string; hp?: number; relapses?: number; slides?: number[] | null };
export type BossState = {
  id: string;
  name: string;
  team_hp: number;
  boss_hp: number;
  planned: number;
  heads: BossHead[];
  head: number | null;
  relapse: boolean | null;
  trap: boolean;
  last_round: { h: number; dmg?: number; loss?: number; few?: boolean } | null;
  moments: Moment[];
  outcome: "won" | "lost" | null;
  revenge_of: string | null;
  revenge_on: string | null;
};

/** The boss state from Z's quiz state (null outside a battle or before H). */
export function bossOf(state: unknown): BossState | null {
  const b = (state as { boss?: unknown } | null)?.boss;
  if (!b || typeof b !== "object" || !Array.isArray((b as BossState).heads)) return null;
  return b as BossState;
}

const count = (n: number, one: string, many: (n: number) => string) => (n === 1 ? one : many(n));

/** Decision 3's meter: "3 מתוך 8 נושאים קשים · עוד כ-20 תשובות לנושא הבא". */
export function bossMeterLine(o: Pick<BossOpen, "hot" | "topics" | "answers_next">): string {
  const head = `${o.hot} מתוך ${o.topics} נושאים קשים`;
  if (o.answers_next == null) return head;
  return `${head} · ${count(o.answers_next, "עוד תשובה אחת לנושא הבא", (n) => `עוד כ-${n} תשובות לנושא הבא`)}`;
}

/** Below MIN_HEADS: what the battle still needs, never a dead end. */
export function headsNeedLine(hot: number): string {
  const need = Math.max(0, BOSS.MIN_HEADS - hot);
  if (!need) return "";
  return need === 1 ? "האתגר נפתח משני נושאים קשים: עוד נושא אחד." : `האתגר נפתח משני נושאים קשים: עוד ${need} נושאים.`;
}

/** The meter's bar, on the same counts as the line above it (review UI-2):
 *  below the floor, the counted members against FLOOR (as the pulse's and
 *  the museum's bars); otherwise the hot topics against the topics weighed,
 *  "3 מתוך 8 נושאים קשים" fills 3/8. Its label is the line's own numbers. */
export function bossBar(o: Pick<BossOpen, "hot" | "topics" | "answers_next" | "group_need">): { pct: number; label: string } {
  const need = Math.max(0, Math.min(FLOOR, o.group_need ?? 0));
  if (need > 0) return { pct: Math.round((100 * (FLOOR - need)) / FLOOR), label: `${FLOOR - need} מתוך ${FLOOR} נספרים` };
  const pct = o.topics > 0 ? Math.round((100 * Math.min(o.hot, o.topics)) / o.topics) : 0;
  return { pct, label: bossMeterLine(o) };
}

/** The heads' chip: "נושא אחד", "3 נושאים"; none at 0 (review UI-4). */
export function headsChip(n: number): string {
  return n <= 0 ? "" : n === 1 ? "נושא אחד" : `${n} נושאים`;
}

/** boss.html's lines. */
export const SUB_LINE = `באתגר רק נושאים שלפחות ${FLOOR} מכם מתקשים בהם`;
export const NO_HEADS_LINE = `עוד אין נושא קשה. האתגר בנוי מנושאים שלפחות ${FLOOR} מכם מתקשים בהם, וזה מתעדכן בלילה.`;
export const RULE_LINE = "תשובה נכונה מקרבת לסגירת הנושא. טעות מורידה נקודות לקבוצה, אף פעם לא לאדם אחד.";
export const LOST_LINE = "ואם לא מצליחים? למחרת נפתח ׳סבב חוזר׳, בלי מסך הפסד.";
export const PLAYERS_LINE = `אתגר צריך לפחות ${BOSS.PLAYERS} משתתפים: עם פחות, כל טעות הייתה מגלה מי טעה.`;

/** "נושא 3/4": the head on screen. */
export function headChip(b: Pick<BossState, "head" | "heads">): string {
  return b.head == null ? headsChip(b.heads.length) : `נושא ${b.head + 1}/${b.heads.length}`;
}

/** The head's relapse line on the HUD. */
export function relapseLine(name: string): string {
  return `${name} חוזר עד שעונים נכון.`;
}
/** The trap round's callout. */
export function trapLine(name: string): string {
  return `${name}: אם חצי מכם בוחרים באותה תשובה שגויה, הקבוצה מאבדת ${BOSS.TRAP_HP} נקודות.`;
}

/** A moment of the battle, without names (boss.html s2's "רגעים מהאתגר"). */
export function momentText(m: Moment): { title: string; chip: string; tone: string; line: string } | null {
  const h = m.head ?? "";
  switch (m.t) {
    case "trap":
      return { title: `טעות נפוצה: ${h}`, chip: `−${Math.abs(m.hp ?? BOSS.TRAP_HP)}`, tone: "bad", line: `עלתה לקבוצה ${Math.abs(m.hp ?? BOSS.TRAP_HP)} נקודות.` };
    case "relapse":
      return { title: `${h} חזר`, chip: "חוזר", tone: "warn", line: "השאלה המרכזית שלו חזרה לסבב נוסף." };
    case "down":
      return {
        title: `${h} נסגר`,
        chip: "✓",
        tone: "ok",
        line: m.relapses ? count(m.relapses, "אחרי שחזר פעם אחת.", (n) => (n === 2 ? "אחרי שחזר פעמיים." : `אחרי שחזר ${n} פעמים.`)) : "בלי לחזור.",
      };
    case "last":
      return { title: `הנושא האחרון: ${h}`, chip: "ניצחון", tone: "ok", line: "כל הנושאים נסגרו." };
    case "fall":
      return { title: "לקבוצה נגמרו הנקודות", chip: "0 נקודות", tone: "bad", line: "האתגר נגמר כאן. מחר נפתח ׳סבב חוזר׳." };
  }
  return null;
}

/** The loot's day word: "מחר" · "מחרתיים" · "בעוד 3 ימים". */
export function lootDay(daysAhead: number): string {
  if (daysAhead <= 0) return "היום";
  if (daysAhead === 1) return "מחר";
  if (daysAhead === 2) return "מחרתיים";
  return `בעוד ${daysAhead} ימים`;
}

/** "לחזרה שלך: 4 טעויות, 3 ימים". */
export function lootTitle(mistakes: number, days: number): string {
  return `לחזרה שלך: ${count(mistakes, "טעות אחת", (n) => `${n} טעויות`)}, ${count(days, "יום אחד", (n) => `${n} ימים`)}`;
}

/** The loot by day: each day's topics, a topic's count beside it ("×2"). */
export type LootRow = { question_id: string; topic: string; question: string; slides: number[] | null; due_on: string };
export function lootDays(rows: readonly LootRow[], today: string): Array<{ day: string; ahead: number; topics: Array<{ topic: string; n: number; slides: number[] }> }> {
  const t = Date.parse(`${today}T12:00:00Z`);
  const by = new Map<string, Map<string, { n: number; slides: number[] }>>();
  for (const r of rows) {
    const d = by.get(r.due_on) ?? new Map();
    const k = r.topic || r.question;
    const e = d.get(k) ?? { n: 0, slides: [] };
    e.n += 1;
    for (const s of r.slides ?? []) if (!e.slides.includes(s) && e.slides.length < 2) e.slides.push(s);
    d.set(k, e);
    by.set(r.due_on, d);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, m]) => ({
      day,
      ahead: Math.round((Date.parse(`${day}T12:00:00Z`) - t) / 86_400_000),
      topics: [...m.entries()].map(([topic, e]) => ({ topic, n: e.n, slides: e.slides })),
    }));
}

/** The study day (04:00 Israel) as YYYY-MM-DD, for the loot's days. */
export function studyDayIso(now = Date.now()): string {
  const shifted = new Date(now - 4 * 3_600_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
}

/** P-14 for the boss (decision 1: a week in the group, no account). */
export function waitingLine(daysLeft: number): string {
  const when = daysLeft <= 1 ? "מחר" : daysLeft === 2 ? "בעוד יומיים" : `בעוד ${daysLeft} ימים`;
  return `האתגר נבנה מ״מה קשה לקבוצה״, שמוצג למי שנספרים בו: שבוע בקבוצה, והספירה בלילה. הנושאים ייפתחו לך ${when}.`;
}
/** A group below the floor: the pulse's own meter. */
export function groupNeedLine(need: number): string {
  return need <= 1 ? `האתגר נבנה מ-${FLOOR} מתרגלים: עוד אדם אחד וזה נפתח.` : `האתגר נבנה מ-${FLOOR} מתרגלים: עוד ${need} אנשים וזה נפתח.`;
}
