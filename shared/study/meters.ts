/* ── Every meter's thresholds, in one place (Yoad's decision 3 of 17 Nov 2026) ──
 *
 * Decision 3: the end-of-semester extras open early, each with what there is
 * and a meter of what more needs. The meters are computed from real counts
 * (the database's, or the member's own reads), never invented, and the
 * numbers they count against live here, once. Each package's module
 * (pulse.ts, museum.ts, boss.ts, lane.ts, today.ts, extras.ts,
 * progress.ts) re-exports its own and keeps only its words and functions.
 *
 * The privacy floor: anything the group sees anonymously (the pulse, hot
 * spots, the museum's traps and exhibits, the boss's heads and players, the
 * plan's lecture buckets) counts only once FLOOR different members are behind
 * it; below that the meter says how many more ("עוד אדם אחד וזה נפתח"). A
 * member always sees their own data.
 *
 * The SQL enforces the same numbers in its own functions
 * (study_private.pulse_floor(), boss_players(), plan_floor() and the rest);
 * meters.test.ts reads supabase/study-schema.sql and fails when any of them
 * differs from this file, when the SQL gains a threshold this file does not
 * name, or when another module defines a floor of its own. No React and no
 * Supabase, so the tests run in Node. */

/** The privacy floor: different members behind any number the group sees anonymously. */
export const FLOOR = 3;

/* ── U-1, U-2: the pulse (section U: study_private.pulse_*) ── */
export const PULSE = {
  /** Members behind any word the group sees (the privacy floor). */
  FLOOR,
  /** Days in the group before a member is counted (decision 1: no accounts,
   *  so the week is what keeps a member from counting twice by joining again today). */
  JOIN_DAYS: 7,
  /** The evidence's window, in study days. */
  WINDOW_DAYS: 28,
  /** "this week" (a topic's closed hole, a question missed this week). */
  WEEK_DAYS: 7,
  /** A topic nobody touched for this long is forgotten. */
  FORGET_DAYS: 60,
} as const;

/* ── U-3: traps and the museum (section U: study_private.museum_*) ── */
export const MUSEUM = {
  /** Members who chose the same wrong option before it is a trap; "על בטוח" for an exhibit (the privacy floor). */
  FLOOR,
  /** Retired ("נסגרה") when everyone active answered right on this many different study days. */
  RETIRE_DAYS: 2,
  /** "Everyone active" means members with practice in this many days. */
  ACTIVE_DAYS: 14,
  /** An exhibit is "חדש" this many days after it opens. */
  NEW_DAYS: 3,
} as const;

/* ── H-1: the boss battle (section H: study_private.boss_*) ── */
export const BOSS = {
  /** A battle opens from this many heads (hot topics or museum exhibits). */
  MIN_HEADS: 2,
  /** A hydra has at most this many heads. */
  MAX_HEADS: 4,
  /** Questions per head. */
  HEAD_QUESTIONS: 3,
  /** Players a battle needs, and answers a round needs to count (below three, a hit would tell who missed). */
  PLAYERS: FLOOR,
  /** What the trap costs the team when half the answers fall for it. */
  TRAP_HP: 20,
  /** Relapses per head at most. */
  RELAPSES: 2,
  /** Right answers, in percent, for a full hit ("עברנו"). */
  HIT_PCT: 80,
  /** The loot spreads over this many study days. */
  LOOT_DAYS: 3,
} as const;

/* ── G: the group's marathon plan (section G: study_private.plan_*) ── */
/** Decision 3's meter: a lecture "has data" from LECTURE_ANSWERS answers by
 *  FLOOR different members in the last WINDOW_DAYS days; its bucket: below
 *  HOT_BELOW% right hot, from OK_FROM% it sits well (section G). */
export const PLAN = { LECTURE_ANSWERS: 20, FLOOR, WINDOW_DAYS: 28, HOT_BELOW: 60, OK_FROM: 80 } as const;

/* ── T-2: "הקבוצה צריכה אותך" (section T's end: study_private.needs_me_*).
 * Opt-in, off by default. An open question of another member, WAIT_HOURS to
 * WINDOW_DAYS old, goes to one opted-in member who mastered its topic: at
 * least MIN_ANSWERS of its questions answered, MASTER_PCT% of them right
 * (her latest answer to each). ── */
export const NEEDS_ME = { MIN_ANSWERS: 3, MASTER_PCT: 80, WINDOW_DAYS: 14, WAIT_HOURS: 2 } as const;

/* ── E: a member's own trap (P11) and the blank table (P10) (section E;
 * server/study/limits.ts's POLICY.trap_check). What E shows the group is
 * content, never a count of members: the trap meter is the author's own, and
 * the table meter counts tables, not people. ── */
export const TRAPS = {
  /** study_trap_submit: new drafts per member in a rolling day. */
  DRAFTS_A_DAY: 10,
  /** POLICY.trap_check.daily: paid checks per member per day (Israel time). */
  CHECKS_A_DAY: 5,
  OPTIONS_MIN: 4,
  OPTIONS_MAX: 5,
  QUESTION_MIN: 8,
  QUESTION_MAX: 400,
  OPTION_MAX: 220,
  VIGNETTE_MAX: 1200,
  NOTE_MAX: 300,
  SLIDES_MIN: 1,
  SLIDES_MAX: 6,
  /** What one check costs, as the button says ("כ-$0.03"). */
  CHECK_USD: 0.03,
} as const;

export const BLANK = {
  /** A table is offered from this many rows under its header. */
  MIN_BODY_ROWS: 2,
  /** … up to this many (a longer one is a list, not a table to fill on a phone). */
  MAX_BODY_ROWS: 15,
  /** A row label and at least one column to fill … */
  MIN_COLS: 2,
  /** … and at most this many columns at 360 px. */
  MAX_COLS: 6,
  /** A table with a longer cell is prose, not a table. */
  MAX_CELL: 80,
  /** A column is filled with chips only when its values are few and short;
   *  otherwise it is shown, as on the slide. */
  CHIP_VALUES: 8,
  CHIP_CHARS: 40,
} as const;

/* ── A2: progress (section P's end). Below a threshold a screen says how
 * many more answers it needs, counted from the member's own rows. ── */
/** PR2: a part's readiness becomes a range from this many first-answers-a-day (28 days). */
export const READINESS_MIN = 20;
/** PR5: calibration shows a percentage from this many "על בטוח" first-answers-a-day (60 days). */
export const CALIBRATION_MIN = 20;
/** PR4: an aspect gets a bucket (קשה · בינוני · יושב טוב) from this many questions answered. */
export const ASPECT_MIN = 4;
/** PR3: the danger list's second return, this many days after the first right "על בטוח". */
export const DANGER_SECOND_DAYS = 3;
/** PR3: a danger row leaves the list after this many right "על בטוח" answers on different later days. */
export const DANGER_RIGHTS = 2;
