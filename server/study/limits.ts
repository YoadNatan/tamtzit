import { POLICY } from "./budget.js";

/* ── Package K's numbers, in one place (design-collab §4.1, spec §4.8-§4.9) ──
 *
 * Where "לשאול" and the memory aids stop is POLICY's (budget.ts, spec §2.4):
 * 80% of the month's cap, 40% for one member, 20 answers and 10 aid requests
 * a day per person. study_reserve() checks them; these are what the ops show
 * ("נשארו היום 18") and how big each call may be. */

/** Effort is fixed per op: an effort change invalidates the prompt cache, and
 *  every member's questions on a lecture should read one cache entry. */
export const ASK_EFFORT = "low" as const;
export const ROUTE_EFFORT = "low" as const;
export const MNEMONIC_EFFORT = "medium" as const;

/** max_tokens bounds thinking and the answer together. */
export const ASK_MAX_TOKENS = 3000;
export const ROUTE_MAX_TOKENS = 1500;
export const MNEMONIC_MAX_TOKENS = 5000;

/** Both ops stop their model call this long after the function started
 *  (answers are short; Vercel would end the function at 300 s). */
export const COLLAB_TIME_LIMIT_MS = 120_000;

/** What a "לשאול" request may carry (larger: 400). The history is the phone's
 *  copy of the conversation, at most 3 earlier turns of the same lecture, each
 *  signed by this server (review m10). */
export const ASK_LIMITS = { question: 500, turns: 3, turnU: 3000, turnA: 4000 } as const;

/** The answer streams in lines at most this often, not one line per token. */
export const ASK_LINE_MS = 80;

/** A library question is routed to at most this many lectures (the first is
 *  answered; the second is offered as "לשאול גם על"). */
export const ROUTE_MAX_LECTURES = 2;

/** Memory aids: at most 3 shown; the source is the block (or a heading's
 *  topic) and the slides it cites. */
export const MAX_AIDS = 3;
export const AID_TARGET_CHARS = 6000;
export const AID_SLIDES_CHARS = 8000;

/** The daily limits as POLICY sets them, for the "left" of each done line. */
export const DAILY_ASKS = POLICY.ask.daily ?? 0;
export const DAILY_MNEMONICS = POLICY.mnemonic.daily ?? 0;

/** fix_check (§12.3.K, X2): one short structured call per tap, effort low. */
export const FIX_CHECK_EFFORT = "low" as const;
export const FIX_CHECK_MAX_TOKENS = 800;
/** What the check reads of the cited slides (at most 6 slides, §12.3.K's source rule). */
export const FIX_CHECK_SLIDES_CHARS = 12_000;

/** VAR (§12.4.V, op "var"): one structured call per yellow card, effort
 *  medium, at most 4,000 tokens, stopped 120 s after the function started;
 *  at most 6 slides (both claims' and the paragraph's own tags) and 4 of
 *  their pictures. "≈ $0.08" a dispute; the worst reservation ≈ $0.13. */
export const VAR_EFFORT = "medium" as const;
export const VAR_MAX_TOKENS = 4000;
export const VAR_TIME_LIMIT_MS = 120_000;
export const VAR_MAX_SLIDES = 6;
export const VAR_MAX_PICTURES = 4;
/** What the call reads of the booklet's part (the paragraph is always sent whole). */
export const VAR_PART_CHARS = 12_000;

/* ── Package J: the association wall (spec §12.5.J) ── */
/** "תנו לי 3": the drafts' call (effort medium, max_tokens 3,000). */
export const WALL_DRAFTS_EFFORT = "medium" as const;
export const WALL_DRAFTS_MAX_TOKENS = 3000;
/** The check of a would-be winner: one short call (effort low, 1,000). */
export const WALL_CHECK_EFFORT = "low" as const;
export const WALL_CHECK_MAX_TOKENS = 1000;
/** What the check reads: the paragraph and the entry's slides, at most 4,000 characters. */
export const WALL_CHECK_CHARS = 4000;
/** Both ops stop their call this long after the function started. */
export const WALL_TIME_LIMIT_MS = 120_000;
/** "נשארו היום {n}": paid draft requests a day per person (POLICY, review F-19). */
export const DAILY_DRAFTS = POLICY.mnemonic.daily ?? 0;

/* ── Package E: a member's own trap (spec §12.6.E, op "trap_check") ── */
/** One structured call per check (effort medium, max_tokens 2,500), stopped
 *  120 s after the function started; the system is TRAP_CHECK_SYSTEM and the
 *  lecture (cached). "≈ $0.03" a check, as the trap screen says. */
export const TRAP_CHECK_EFFORT = "medium" as const;
export const TRAP_CHECK_MAX_TOKENS = 2500;
export const TRAP_CHECK_TIME_LIMIT_MS = 120_000;
/** What the call reads of the paragraph the trap is on. */
export const TRAP_PARAGRAPH_CHARS = 2000;
/** Paid checks a day per person (POLICY; shared/study/extras.ts TRAP_CHECKS_A_DAY says the same). */
export const DAILY_TRAP_CHECKS = POLICY.trap_check.daily ?? 0;
