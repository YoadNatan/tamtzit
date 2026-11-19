import { sb } from "./api";
import { failText, hasText } from "./failText";
import { codeOf, db, run, type Mode, type QuizStateName } from "./quizOpen";

/* ── The group quiz's data and logic (package Z; design-quiz §3-§4, spec
 * §12.3.Z) ──
 *
 * "מבחן קבוצתי": "כולנו נגד המבחן" (mode coop, the default) and "מירוץ"
 * (mode race). The database is the referee (section Z of study-schema.sql):
 * it keeps the clock, the key, the votes and the scores, and
 * study_quiz_state() hands each phone what it may see. A phone only needs to
 * know what to show now, from the last state and the server's clock; when
 * to act by itself (re-read, ask for the reveal once the time and the grace
 * are over, move a finished argument on, ping every 15 s); and whether a
 * Realtime event on the quiz row can be applied as is (same version: only
 * the count of answers moved) or means "read the state again".
 *
 * The approved rules this file reflects (decision 2, review SEC-6): the bet
 * on every first vote, +1/+2/+3 when right and 0/−2/−6 when wrong ("לא
 * יודעים" and no answer: 0); in a race the bet is the score and time only
 * breaks ties; counts only from 3 answers; the race's table only to its
 * players, only in the game (top three and one's own place, review UX-24).
 *
 * The pure half (types, ServerClock, viewOf, nextAction, onRowEvent,
 * pingNeedsState, the table, the points, the words) runs in Node
 * (quiz.test.ts); the rest calls the database as the signed-in member. */

// The part the banner and "יחד" need lives in quizOpen.ts, in the study
// entry; everything else here loads with the quiz's screens.
export { joinQuiz, MODE_NAME, namesLine, openQuiz, recentQuizzes, watchOpenQuiz, type Mode, type OpenQuiz, type QuizStateName, type RecentQuiz } from "./quizOpen";

export type Preset = "free" | "end" | "coffee" | "stop";
export type Kinds = "all" | "mcq" | "case";
export type Stage = "final" | "argue";
export type NextStep = "explain" | "argue" | "source";
export type Bet = 1 | 2 | 3;

/** study_quizzes, as Realtime and study_quiz_state send it. */
export type QuizRow = {
  id: string;
  group_id: string;
  mode: Mode;
  title: string;
  lecture_ids: string[];
  kinds: Kinds;
  n_wanted: number;
  seconds: number;
  state: QuizStateName;
  idx: number;
  n_total: number;
  opens_at: string | null;
  closes_at: string | null;
  answered_n: number;
  players_n: number;
  version: number;
  host_id: string | null;
  created_at?: string;
  started_at?: string | null;
  ended_at?: string | null;
  preset?: Preset;
  meeting_id?: string | null;
  part_from?: number | null;
  part_to?: number | null;
  /** The vote on screen: 1, or 2 after the group argued. */
  vote?: 1 | 2;
  stage?: Stage;
  argue_until?: string | null;
  /** The group's best co-op score so far (study_quiz__record), co-op only. */
  record?: number | null;
};

export type QuizQuestion = {
  id: string;
  kind: "mcq" | "case";
  vignette: string;
  question: string;
  teaser?: string;
  options: string[];
  slides: number[];
  topic: string;
  aspect: string;
  lecture_id: string | null;
  part_idx?: number | null;
  anchor?: number | null;
  lecture_title?: string | null;
};

export type QuizRound = {
  idx: number;
  seconds: number;
  opens_at: string;
  closes_at: string;
  vote?: 1 | 2;
  stage?: Stage;
  voided: boolean;
  voided_by: string | null;
  q: QuizQuestion | null;
  /** This phone's answer to the vote on screen. */
  mine: { choice: number | null; ms: number; bet?: number | null } | null;
  /** This phone's first vote, with its bet. */
  mine1?: { choice: number | null; bet: number | null } | null;
  // the argue stage: vote 1's counts (from 3 answers), no key
  argue_until?: string | null;
  answered1?: number | null;
  counts1?: number[] | null;
  right1?: number | null;
  // the final reveal
  answer?: number | null;
  explanations?: string[];
  takeaway?: string;
  next_step?: NextStep | null;
  /** This phone's first vote's points (the bet's) and whether it was right. */
  points?: number | null;
  correct?: boolean | null;
  /** This phone's second vote was right. */
  correct2?: boolean | null;
  /** How many answered the last vote; counts, right and "לא יודעים" only from 3. */
  answered?: number;
  counts?: number[] | null;
  dont_know?: number | null;
  right?: number | null;
  /** The wrong option most chosen in vote 1 (unique, by 2 of at least 3). */
  trap?: number | null;
  jump?: { lecture_id: string; part: number; anchor: number; quote: string } | null;
  /** "שאלות פתיחה" (section M's opening): a majority word instead of numbers. */
  majority?: "most_right" | "split" | "most_wrong" | null;
};

export type QuizPlayer = {
  user_id: string;
  name: string;
  host: boolean;
  here: boolean;
  left: boolean;
  joined_idx: number;
  /** A race, to its players only. */
  score?: number;
  correct_n?: number;
  ms?: number;
  last_points?: number | null;
};

export type SummaryRound = {
  idx: number;
  voided: boolean;
  vote?: 1 | 2;
  trap?: number | null;
  q: QuizQuestion | null;
  answer: number | null;
  explanations: string[];
  takeaway: string;
  answered?: number;
  right?: number;
  counts?: number[];
  counts1?: number[] | null;
  right1?: number | null;
  majority?: QuizRound["majority"];
  mine: { choice: number | null; correct: boolean | null; points: number; bet: number | null; choice2: number | null; correct2: boolean | null } | null;
};

export type Team = { right_pct: number | null; passed: boolean; record_before: number | null; new_record: boolean };

export type QuizMe = { playing: boolean; score: number; correct_n: number; answered_n: number; joined_idx: number; ms_total?: number };

export type QuizState = {
  now: string;
  quiz: QuizRow;
  me: QuizMe | null;
  host_here: boolean;
  players: QuizPlayer[];
  round: QuizRound | null;
  summary: SummaryRound[] | null;
  team?: Team | null;
  boss?: unknown;
};

/* ─────────────── the server's clock ─────────────── */

/** Server time from round trips: offset = server − local, taken from the
 *  sample with the shortest round trip among the last five (a slow answer
 *  says least about when the server stamped it). */
export class ServerClock {
  private samples: Array<{ rtt: number; offset: number }> = [];
  constructor(private local: () => number = () => Date.now()) {}
  /** serverIso: the "now" of a reply; t0/t1: local time before sending and on receipt. */
  add(serverIso: string, t0: number, t1: number): void {
    const server = Date.parse(serverIso);
    if (!Number.isFinite(server) || t1 < t0) return;
    this.samples.push({ rtt: t1 - t0, offset: server - (t0 + t1) / 2 });
    if (this.samples.length > 5) this.samples.shift();
  }
  offset(): number {
    if (!this.samples.length) return 0;
    return [...this.samples].sort((a, b) => a.rtt - b.rtt)[0].offset;
  }
  now(): number {
    return this.local() + this.offset();
  }
}

/* ─────────────── what the screen shows ─────────────── */

/** Answers are taken until the deadline + 1.5 s (study_quiz_answer). */
export const GRACE_MS = 1500;
/** Any read of the state reveals a vote 4.5 s after its deadline (study_quiz__due). */
export const DUE_MS = 4500;
/** An argument that ran out moves on 1 s after its end, at any phone's ping. */
export const ARGUE_GRACE_MS = 1000;
export const PING_MS = 15_000;
/** With this little time left, an option chosen without a bet goes as "ניחוש". */
export const BET_DEADLINE_MS = 3000;

export type View =
  | { v: "lobby" }
  | { v: "countdown"; secs: number; vote: 1 | 2 } // "מתחילים בעוד 3"
  | { v: "question"; vote: 1 | 2; leftMs: number; answered: boolean; canAnswer: boolean }
  | { v: "waiting"; vote: 1 | 2; answered: boolean } // the time is up, the reveal is on its way
  | { v: "argue"; leftMs: number } // vote 1's counts, no key, 90 s to argue
  | { v: "reveal" }
  | { v: "ended" }
  | { v: "cancelled" };

const voteOf = (s: QuizState): 1 | 2 => (s.round?.vote ?? s.quiz.vote ?? 1) === 2 ? 2 : 1;
const arguing = (s: QuizState) => s.quiz.state === "reveal" && s.quiz.stage === "argue";

export function viewOf(s: QuizState, serverNow: number): View {
  const z = s.quiz;
  if (z.state === "lobby") return { v: "lobby" };
  if (z.state === "ended") return { v: "ended" };
  if (z.state === "cancelled") return { v: "cancelled" };
  if (arguing(s)) {
    const until = Date.parse(z.argue_until ?? s.round?.argue_until ?? "");
    return { v: "argue", leftMs: Number.isFinite(until) ? Math.max(0, until - serverNow) : 0 };
  }
  if (z.state === "reveal") return { v: "reveal" };
  const vote = voteOf(s);
  const r = s.round;
  if (!r) return { v: "waiting", vote, answered: false };
  const opens = Date.parse(r.opens_at);
  const closes = Date.parse(r.closes_at);
  const answered = r.mine !== null && r.mine !== undefined;
  if (serverNow < opens) return { v: "countdown", secs: Math.ceil((opens - serverNow) / 1000), vote };
  if (serverNow < closes) {
    return { v: "question", vote, leftMs: closes - serverNow, answered, canAnswer: !answered && Boolean(s.me?.playing) && r.q !== null };
  }
  return { v: "waiting", vote, answered };
}

/* ─────────────── acting on its own ─────────────── */

export type Next = { inMs: number; what: "tick" | "reveal" | "ping" };

/** How long until a time shown in whole seconds (rounded up: "3", "0:07")
 *  shows the next second; for the last second, the moment it runs out. */
export function toNextSecond(leftMs: number): number {
  return leftMs - (Math.ceil(leftMs / 1000) - 1) * 1000;
}

/** The next thing this phone does by itself, given the state and the server
 *  clock. jitter (0-800 ms, random per phone) spreads six phones' requests;
 *  the database reveals once and ignores the rest. A tick lands when the
 *  number on the screen changes ("3, 2, 1", the timer chip), and the last
 *  one exactly when the question opens or the time runs out. */
export function nextAction(s: QuizState, serverNow: number, jitter: number, lastPingAt: number): Next {
  const ping: Next = { inMs: Math.max(0, lastPingAt + PING_MS - serverNow), what: "ping" };
  const z = s.quiz;
  if (arguing(s)) {
    // The 90 seconds of argument: the countdown ticks, and when they are over
    // a ping (from any phone) opens vote 2 (study_quiz_ping → study_quiz__due).
    const until = Date.parse(z.argue_until ?? s.round?.argue_until ?? "");
    if (!Number.isFinite(until)) return ping;
    if (serverNow < until) return min(ping, { inMs: toNextSecond(until - serverNow), what: "tick" });
    return min(ping, { inMs: Math.max(0, until + ARGUE_GRACE_MS + 300 + jitter - serverNow), what: "ping" });
  }
  if (z.state !== "question" || !s.round) return ping;
  const opens = Date.parse(s.round.opens_at);
  const closes = Date.parse(s.round.closes_at);
  if (serverNow < opens) return min(ping, { inMs: toNextSecond(opens - serverNow), what: "tick" });
  if (serverNow < closes) return min(ping, { inMs: toNextSecond(closes - serverNow), what: "tick" });
  // Only players may ask for the reveal (study_quiz_reveal: 'not playing').
  if (!s.me?.playing) return min(ping, { inMs: Math.max(0, closes + GRACE_MS + 3000 + jitter - serverNow), what: "ping" });
  return min(ping, { inMs: Math.max(0, closes + GRACE_MS + jitter - serverNow), what: "reveal" });
}
function min(a: Next, b: Next): Next {
  return b.inMs < a.inMs ? b : a;
}

/** A Realtime event on the quiz row: apply it (only the counts moved) or
 *  read the whole state again (a step happened, or the payload is partial). */
export function onRowEvent(local: QuizState | null, row: Partial<QuizRow>): { kind: "refetch" } | { kind: "apply"; state: QuizState } {
  if (!local || typeof row.version !== "number" || typeof row.answered_n !== "number" || row.version !== local.quiz.version) {
    return { kind: "refetch" };
  }
  return {
    kind: "apply",
    state: { ...local, quiz: { ...local.quiz, answered_n: row.answered_n, players_n: row.players_n ?? local.quiz.players_n } },
  };
}

/** A ping's answer: read the state again if the version or the host's presence moved. */
export function pingNeedsState(local: QuizState | null, ping: { version: number; host_here: boolean }): boolean {
  return !local || ping.version !== local.quiz.version || ping.host_here !== local.host_here;
}

/* ─────────────── the bet, the race table, the counts ─────────────── */

/** The bet's words, 1-3 (the question screen's row). */
export const BET_WORDS: Record<Bet, string> = { 1: "ניחוש", 2: "נראה לי", 3: "על בטוח" };

/** The bet row (the approved question screen): choosing an option selects
 *  it, choosing a bet sends both; with BET_DEADLINE_MS left an option chosen
 *  without a bet goes as "ניחוש". Vote 2 has no bet: a tap sends. */
export function autoBet(view: View, selected: number | null | undefined, sending: boolean): Bet | null {
  if (view.v !== "question" || view.vote !== 1 || !view.canAnswer || sending) return null;
  if (selected === null || selected === undefined) return null;
  return view.leftMs <= BET_DEADLINE_MS ? 1 : null;
}

/** study_quiz_answer's arguments: a bet only on vote 1's option (none for
 *  "לא יודעים", none in vote 2), and the vote on screen. */
export function answerArgs(id: string, idx: number, choice: number | null, bet: Bet | null, vote: 1 | 2) {
  return { p_quiz: id, p_idx: idx, p_choice: choice, p_bet: vote === 1 && choice !== null ? (bet ?? 1) : null, p_vote: vote };
}

/** This phone's first vote of a round: kept apart once a second vote opens. */
export function firstVote(r: QuizRound | null | undefined): { choice: number | null; bet: number | null } | null {
  if (!r) return null;
  if (r.mine1) return r.mine1;
  return (r.vote ?? 1) === 1 && r.mine ? { choice: r.mine.choice, bet: r.mine.bet ?? null } : null;
}

/** "שאלות פתיחה"'s reveal (section M's opening): a majority word, never a number
 *  (none below 3 answers). Kept for M's QuizInline; no screen of this
 *  package shows a coffee quiz. */
export const MAJORITY_WORD: Record<NonNullable<QuizRound["majority"]>, string> = {
  most_right: "רובכם צדקו",
  split: "הקבוצה חלוקה",
  most_wrong: "רובכם טעו",
};

/** A first vote's points, as study_quiz__points gives them: right +bet; wrong
 *  0, −2, −6; "לא יודעים" or no answer 0. A vote without a bet is ניחוש. */
export function betPoints(choice: number | null | undefined, key: number | null | undefined, bet: number | null | undefined): number {
  if (choice === null || choice === undefined || key === null || key === undefined) return 0;
  const b = bet === 2 || bet === 3 ? bet : 1;
  if (choice === key) return b;
  return b === 1 ? 0 : b === 2 ? -2 : -6;
}

/** "+3", "−6", "0" (a real minus sign, isolated by the caller). */
/** Text set left to right inside a Hebrew line, as <bdi dir="ltr"> does
 *  (a left-to-right isolate): a sign stays before its number ("+3", "−6"). */
export function ltr(text: string): string {
  return `\u2066${text}\u2069`;
}

/** The bet's scale, its numbers isolated (the approved question screen and lobby). */
export const BET_SCALE = `צודקים: ${ltr("+1")} · ${ltr("+2")} · ${ltr("+3")}. טועים: 0 · ${ltr("−2")} · ${ltr("−6")}.`;

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

/** The race's order (decision 2): points, then the shorter total time; the
 *  same points and time share a place ("1, 2, 2, 4"), as study_quiz_recent's
 *  my_rank counts. Players without a score (a watcher's copy) are left out. */
export function rankRows(players: QuizPlayer[]): Array<QuizPlayer & { rank: number }> {
  const rows = players.filter((p) => typeof p.score === "number");
  const better = (o: QuizPlayer, p: QuizPlayer) => (o.score ?? 0) > (p.score ?? 0) || ((o.score ?? 0) === (p.score ?? 0) && (o.ms ?? 0) < (p.ms ?? 0));
  return rows
    .map((p) => ({ ...p, rank: 1 + rows.filter((o) => better(o, p)).length }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "he"));
}

/** What the race's table shows a player (review UX-24): the top three, and
 *  this player's own place when it is lower. */
export function tableRows(players: QuizPlayer[], me: string): Array<QuizPlayer & { rank: number; mine: boolean }> {
  const ranked = rankRows(players).map((p) => ({ ...p, mine: p.user_id === me }));
  const top = ranked.slice(0, 3);
  const own = ranked.find((p) => p.mine);
  return own && !top.includes(own) ? [...top, own] : top;
}

/** A share in whole percent (study_quiz_state's rounding). */
export function pct(right: number, of: number): number {
  return of > 0 ? Math.round((100 * right) / of) : 0;
}

/** The bars of one vote, as the approved reveal shows them: the options
 *  someone chose, most chosen first, the key marked. */
export function barRows(counts: readonly number[] | null | undefined, options: readonly string[], key?: number | null): Array<{ i: number; text: string; n: number; share: number; right: boolean }> {
  if (!counts) return [];
  const total = counts.reduce((a, b) => a + b, 0);
  return counts
    .map((n, i) => ({ i, text: options[i] ?? "", n, share: total ? n / total : 0, right: key !== null && key !== undefined && i === key }))
    .filter((b) => b.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i);
}

/** The question that broke the group: the lowest share right among the
 *  rounds whose counts the database gave (3 answers or more). */
export function hardest(summary: readonly SummaryRound[] | null): SummaryRound | null {
  let worst: SummaryRound | null = null;
  for (const r of summary ?? []) {
    if (r.voided || typeof r.right !== "number" || !r.answered) continue;
    if (!worst || r.right / r.answered < (worst.right ?? 0) / (worst.answered ?? 1)) worst = r;
  }
  return worst;
}

/** "0:07" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** About how long a quiz takes: each question's time (the setting, or more
 *  for a long one, study_quiz__seconds) and 30 s a reveal in co-op, 10 s in
 *  a race; whole minutes, at least one. */
export function quizMinutes(seconds: number[], mode: Mode): number {
  const reveal = mode === "race" ? 10 : 30;
  return Math.max(1, Math.round(seconds.reduce((t, s) => t + s + reveal, 0) / 60));
}

/** study_quiz__seconds: the setting, or ~15 characters a second + 10 s, at most 240. */
export function questionSeconds(setting: number, chars: number): number {
  return Math.min(240, Math.max(setting, Math.ceil(Math.max(0, chars) / 15) + 10));
}

/* ─────────────── what a failed call means ─────────────── */

export type QuizError =
  | "closed"
  | "not open"
  | "bad choice"
  | "not playing"
  | "quiz over"
  | "quiz not found"
  | "quiz open"
  | "not host"
  | "not revealed"
  | "no questions"
  | "host here"
  | "too early"
  | "too late"
  | "bad mode"
  | "bad kinds"
  | "bad count"
  | "bad seconds"
  | "bad preset"
  | "bad parts"
  | "bad bet"
  | "meeting not found"
  | "already"
  | "need 3"
  | "network";

const SETUP_WRONG = "משהו השתבש בהגדרת המבחן. כדאי לרענן ולנסות שוב.";

/** The Hebrew line for an error, or null when the screen simply re-reads
 *  the state (another phone moved on first). design-quiz §3.4, the meeting
 *  design's §8.1 and the fun design's "need 3"; the setup's own checks
 *  (mode, kinds, seconds) read as the preset's line. A session, a group or a
 *  lecture that is gone reads as everywhere else (failText). */
export const QUIZ_ERROR_TEXT: Record<QuizError, string | null> = {
  closed: "הזמן נגמר לפני שהתשובה הגיעה.",
  "not open": null, // the countdown was a hair early: the phone sends once more
  "bad choice": "התשובה לא נקלטה.",
  "not playing": "צריך להצטרף למבחן כדי לענות.",
  "quiz over": "המבחן הסתיים.",
  "quiz not found": "המבחן לא נמצא.",
  "quiz open": "יש כבר מבחן פתוח בקבוצה.",
  "not host": null,
  "not revealed": null,
  "no questions": "אין עדיין שאלות מוכנות בהרצאות שנבחרו.",
  "host here": "הטלפון שמנהל את המבחן מחובר, אז הניהול נשאר שם.",
  "too early": null,
  "too late": null, // a race's round is voided only while it is current: the screen moved on
  "bad mode": SETUP_WRONG,
  "bad kinds": SETUP_WRONG,
  "bad count": "אפשר 3 עד 30 שאלות, ובעצירה שאלה אחת.",
  "bad seconds": SETUP_WRONG,
  "bad preset": SETUP_WRONG,
  "bad parts": "החלקים שנבחרו לא נמצאו בהרצאה.",
  "bad bet": "ההימור הוא ניחוש, נראה לי או על בטוח.",
  "meeting not found": "הפגישה הזו לא נמצאה. כדאי לרענן.",
  already: "לפגישה הזו כבר יש מבחן כזה.",
  "need 3": "לאתגר קבוצתי צריך לפחות 3 משתתפים.",
  network: "אין חיבור כרגע. מנסים שוב…",
};

/** An error's line: its words here, null for "re-read", the app's own words
 *  for a code every screen shares (a session, a group or a lecture that is
 *  gone: failText), or the network's for anything unknown. */
export function quizErrorText(code: string): string | null {
  if (Object.prototype.hasOwnProperty.call(QUIZ_ERROR_TEXT, code)) return QUIZ_ERROR_TEXT[code as QuizError];
  return hasText(code) ? failText(code) : QUIZ_ERROR_TEXT.network;
}

/* ─────────────── the database, as the signed-in member ─────────────── */

export type Ping = { server_now: string; version: number; state: QuizStateName; idx: number; answered_n: number; host_here: boolean };
export type PoolRow = { lecture_id: string; mcq: number; cases: number };


export const createQuiz = (o: { groupId: string; mode: Mode; lectures: string[]; count: number; seconds: number; kinds: Kinds }) =>
  run<string>(db().rpc("study_quiz_create", { p_group: o.groupId, p_mode: o.mode, p_lectures: o.lectures, p_count: o.count, p_seconds: o.seconds, p_kinds: o.kinds }));
export const leaveQuiz = (id: string) => run<null>(db().rpc("study_quiz_leave", { p_quiz: id }));
/** The host: start (from -1), "לסבב 2" in the argue stage, the next question after a reveal. */
export const nextRound = (id: string, from: number) => run<null>(db().rpc("study_quiz_next", { p_quiz: id, p_from: from }));
export const revealRound = (id: string, idx: number) => run<null>(db().rpc("study_quiz_reveal", { p_quiz: id, p_idx: idx }));
export const endQuiz = (id: string) => run<null>(db().rpc("study_quiz_end", { p_quiz: id }));
export const takeHost = (id: string) => run<null>(db().rpc("study_quiz_take_host", { p_quiz: id }));
export const voidRound = (id: string, idx: number) => run<null>(db().rpc("study_quiz_void", { p_quiz: id, p_idx: idx }));
export const quizState = (id: string) => run<QuizState>(db().rpc("study_quiz_state", { p_quiz: id }));
export const quizPool = (groupId: string) => run<PoolRow[]>(db().rpc("study_quiz_pool", { p_group: groupId }));
/** The lobby's "השיא": the group's best co-op score, or null before the first. */
export const quizRecord = (groupId: string) => run<number | null>(db().rpc("study_quiz_record", { p_group: groupId }));

/** One answer: an option (null: "לא יודעים", co-op only) with a bet in vote
 *  1, and the vote it answers. Returns what the database kept (a retry gets
 *  the first answer back), never whether it is right. */
export async function answerRound(id: string, idx: number, choice: number | null, bet: Bet | null, vote: 1 | 2) {
  const a = answerArgs(id, idx, choice, bet, vote);
  const rows = await run<Array<{ idx: number; choice: number | null; ms: number; answered_at: string; vote: number; bet: number | null }>>(
    db().rpc("study_quiz_answer", { p_quiz: a.p_quiz, p_idx: a.p_idx, p_choice: a.p_choice, p_bet: a.p_bet, p_vote: a.p_vote }),
  );
  return rows[0];
}
export async function pingQuiz(id: string): Promise<Ping> {
  return (await run<Ping[]>(db().rpc("study_quiz_ping", { p_quiz: id })))[0];
}

/** Whether questions are being written for any of these lectures (a part
 *  pending or being written: the lobby's "נכתבות שאלות"). */
export async function writingFor(lectureIds: string[]): Promise<boolean> {
  if (!sb || !lectureIds.length) return false;
  const { data, error } = await sb.from("study_question_batches").select("lecture_id").in("lecture_id", lectureIds).in("status", ["pending", "writing"]).limit(1);
  if (error) throw new Error(codeOf(error));
  return (data ?? []).length > 0;
}

/** The quiz row of one quiz. Every step and every answer count arrives here;
 *  a new SUBSCRIBED (also after a reconnect) is the moment to re-read the state. */
export function watchQuiz(quizId: string, onRow: (row: Partial<QuizRow>) => void, onStatus: (status: string) => void): () => void {
  if (!sb) return () => undefined;
  const client = sb;
  const ch = client
    .channel(`study-quiz-${quizId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "study_quizzes", filter: `id=eq.${quizId}` }, (p) => onRow(p.new as Partial<QuizRow>))
    .subscribe((status) => onStatus(status));
  return () => void client.removeChannel(ch);
}


/* ─────────────── an answer not yet confirmed (spec §5.9) ─────────────── */

/** sessionStorage `study-quiz-pending:<user>:<quiz>`: sent once more after a
 *  reload or an app switch, if its round is still open. */
export type Pending = { idx: number; vote: 1 | 2; choice: number | null; bet: Bet | null };
const pendingKey = (user: string, quiz: string) => `study-quiz-pending:${user}:${quiz}`;
export function savePending(user: string, quiz: string, p: Pending): void {
  try {
    sessionStorage.setItem(pendingKey(user, quiz), JSON.stringify(p));
  } catch {
    /* no storage: the answer is only sent from here */
  }
}
export function loadPending(user: string, quiz: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(user, quiz));
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    return p && typeof p.idx === "number" && (p.vote === 1 || p.vote === 2) ? p : null;
  } catch {
    return null;
  }
}
export function clearPending(user: string, quiz: string): void {
  try {
    sessionStorage.removeItem(pendingKey(user, quiz));
  } catch {
    /* nothing kept */
  }
}

/** The setup's "כמה שאלות" (review LOOK-5). `wanted` is the count kept as
 *  the member's preference (5, 10, 15 or 20); `ready` the chosen lectures'
 *  ready questions; `thin` one lecture whose questions are written first (the
 *  count is then the preference). What the quiz asks for is the preference,
 *  or what is ready when that is less (3 at least, the database's floor), and
 *  the radios show exactly that: when the ready questions are fewer than the
 *  preference and not one of the counts, a "הכול" choice (as סבב חדש's "N ·
 *  הכול"; the line under the counts says how many are ready) is the selected one, and a count above what is ready is never selected. */
export type CountChoice = { n: number; label: string; checked: boolean; disabled: boolean; all: boolean; pick: number };
export function quizCounts(counts: readonly number[], wanted: number, ready: number, thin: boolean): { count: number; choices: CountChoice[] } {
  const count = thin ? wanted : Math.max(3, Math.min(wanted, ready || wanted));
  const top = counts[counts.length - 1];
  const allN = !thin && ready > 0 && ready < top && !counts.includes(ready) ? ready : null;
  const allChecked = allN !== null && count >= allN;
  const limit = allN ?? Math.max(ready, counts[0]);
  const choices: CountChoice[] = counts.map((n) => {
    const disabled = !thin && n > limit;
    return { n, label: String(n), disabled, checked: !disabled && !allChecked && n === count, all: false, pick: n };
  });
  if (allN !== null) {
    const pick = counts.find((c) => c >= allN) ?? top;
    choices.push({ n: allN, label: "הכול", disabled: false, checked: allChecked, all: true, pick });
    choices.sort((a, b) => a.n - b.n);
  }
  return { count, choices };
}
