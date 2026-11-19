import { studyDay } from "../../../shared/study/day";
import { sb } from "./api";
import { failText } from "./failText";
import { db, run } from "./quizOpen";

/* ── The day's meeting: data and the pure rules (package M; spec §12.4.M,
 * the meeting design §4) ──
 *
 * The database is the referee (section M of study-schema.sql): who reads,
 * where the reading is, what the reader's card may count, when a pre-guess
 * lights up, what catch-up holds. A phone only reports and reads:
 *
 *   - the reader's phone reports its place at most once in 5 s, with a
 *     trailing call for the last place, and at least every 20 s while
 *     reading even when it has not moved (the heartbeat that keeps a reading
 *     live: a reader who explains one paragraph for two minutes stays the
 *     reader) — PlaceReporter;
 *   - a follower's phone says it is here when following starts and every 3
 *     minutes while it follows (two others following make a reading live,
 *     review SEC-3, SEC-4) — HERE_MS;
 *   - the reader's card reads study_meeting_reader_view every 6 s — CARD_MS.
 *
 * Nothing here counts people: the counts come from the database, from 3, and
 * the words for them ("רובכם צדקו", "ניחשת …, כמו רוב הקבוצה") are chosen
 * here from its booleans. The pure half runs in Node (meeting.test.ts); the
 * rest calls the database as the signed-in member, each call naming its
 * function and arguments literally (npm run test:contract). */

/* ─────────────── what the database sends ─────────────── */

export type QuizRef = { id: string; state: "lobby" | "question" | "reveal" | "ended" | "cancelled" };

/** One meeting as study_meeting_band() lists it (today's, or the next one). */
export type BandMeeting = {
  id: string;
  day: string;
  starts_at: string;
  version: number;
  today: boolean;
  lecture_id: string;
  lecture_title: string;
  title: string | null;
  part_from: number;
  part_to: number;
  slide_from: number | null;
  slide_to: number | null;
  /** Who reads aloud now, or last did ("להקריא לקבוצה"); no reader is planned ahead (M 2). */
  reader_id: string | null;
  reading: boolean;
  started_at: string | null;
  over: boolean;
  guesses: number;
  guess_released: number;
  my_guesses: number;
  coffee: QuizRef | null;
  closing: QuizRef | null;
};

/** study_meetings as Realtime sends it (published, members only). */
export type MeetingRow = {
  id: string;
  group_id: string;
  day: string;
  starts_at: string;
  lecture_id: string;
  part_from: number;
  part_to: number;
  title: string;
  reader_id: string | null;
  reading: boolean;
  started_at: string | null;
  read_part: number | null;
  guess_ids: string[];
  guess_released: number;
  cancelled_at: string | null;
  version: number;
};

export type Agenda = {
  reading: {
    lecture_id: string;
    lecture_title: string;
    title: string | null;
    part_from: number;
    part_to: number;
    slide_from: number | null;
    slide_to: number | null;
    reader: string | null;
    reading: boolean;
  } | null;
  /** The pulse's hot spot (section U's study_private.meeting__hot_spot): the
   *  meeting lecture's hottest topic, for a member who reads the pulse; null
   *  without it, while the switch 'pulse' is off, or below the floor. */
  hot_spot: { title: string; aspect?: string; slides?: number[]; lecture_id?: string; part?: number; anchor?: number } | null;
  open_question: {
    id: string;
    body: string;
    lecture_id: string;
    lecture_title: string;
    part: number;
    anchor: number;
    quote: string;
    created_at: string;
    author: string | null;
    from_meeting: boolean;
  } | null;
};

export type Tap = { part: number; anchor: number; n: number };
export type GuessWarn = { guess: number; part: number; anchor: number; question: string; slides: number[] };
export type ReaderView = { taps: Tap[]; guess_warn: GuessWarn | null; followers: number };

export type Majority = { most_right: boolean; spread: boolean; with_most: boolean };
export type GuessItem = {
  n: number;
  released: boolean;
  mine: number | null;
  q: { id: string; kind: string; vignette: string; question: string; teaser: string; options: string[]; slides: number[]; part: number | null; anchor: number | null };
  answer?: number;
  explanation?: string;
  takeaway?: string;
  correct?: boolean | null;
  majority?: Majority | null;
};

export type CatchupPack = {
  meeting: { id: string; lecture_id: string; day: string; part_from: number; part_to: number; lecture_title: string; title: string | null };
  stops: Array<{ part: number; anchor: number; quote: string }>;
  resolved: Array<{ id: string; question: string; part: number; anchor: number; answer: string; answer_by: string | null }>;
  pins: Array<{ id: string; body: string; fact: string; part: number; anchor: number; by: string | null }>;
  questions: string[];
  readers: string[];
  minutes: number;
  done: boolean;
};

export type Missed = { meeting_id: string; lecture_id: string; lecture_title: string; title: string | null; day: string };

/* ─────────────── the calls ─────────────── */

export const meetingBand = (groupId: string) => run<BandMeeting[]>(db().rpc("study_meeting_band", { p_group: groupId })).then((r) => r ?? []);

export async function saveMeeting(m: {
  id: string | null;
  version: number | null;
  groupId: string;
  startsAt: string;
  lectureId: string;
  partFrom: number;
  partTo: number;
  title: string;
}): Promise<{ id: string; version: number }> {
  const rows = await run<Array<{ id: string; version: number }>>(
    db().rpc("study_meeting_save", {
      p_id: m.id,
      p_version: m.version,
      p_group: m.groupId,
      p_starts_at: m.startsAt,
      p_lecture: m.lectureId,
      p_part_from: m.partFrom,
      p_part_to: m.partTo,
      p_title: m.title,
    }),
  );
  return rows[0];
}
export const cancelMeeting = (id: string) => run<null>(db().rpc("study_meeting_cancel", { p_meeting: id }));
export const startReading = (lectureId: string, on: boolean, part: number, anchor: number) =>
  run<string | null>(db().rpc("study_meeting_reading", { p_lecture: lectureId, p_on: on, p_part: part, p_anchor: anchor }));
export const reportPlace = (id: string, part: number, anchor: number) => run<number>(db().rpc("study_meeting_place", { p_meeting: id, p_part: part, p_anchor: anchor }));
export const imHere = (id: string) => run<null>(db().rpc("study_meeting_here", { p_meeting: id }));
export const tapUnclear = (id: string, part: number, anchor: number, on: boolean) =>
  // review SEC-11: no text from the phone (the paragraph's first words stay on it)
  run<boolean>(db().rpc("study_meeting_unclear", { p_meeting: id, p_part: part, p_anchor: anchor, p_quote: "", p_on: on }));
export const readerView = (id: string) => run<ReaderView>(db().rpc("study_meeting_reader_view", { p_meeting: id }));
export const readerStop = (id: string, kind: "explain" | "continue" | "question", part: number, anchor: number, comment: string | null = null) =>
  run<null>(db().rpc("study_meeting_stop", { p_meeting: id, p_kind: kind, p_part: part, p_anchor: anchor, p_quote: "", p_comment: comment }));
export const meetingQuiz = (id: string, preset: "coffee" | "end" | "stop", part: number | null = null) =>
  run<string>(db().rpc("study_meeting_quiz", { p_meeting: id, p_preset: preset, p_mode: "coop", p_count: null, p_part: part }));
export const pickGuesses = (id: string) => run<string[]>(db().rpc("study_meeting_guess_pick", { p_meeting: id })).then((r) => r ?? []);
export const guess = (id: string, question: string, choice: number) => run<null>(db().rpc("study_meeting_guess", { p_meeting: id, p_question: question, p_choice: choice }));
export const guessState = (id: string) => run<GuessItem[]>(db().rpc("study_meeting_guess_state", { p_meeting: id })).then((r) => r ?? []);
export const agendaOf = (id: string) => run<Agenda>(db().rpc("study_meeting_agenda", { p_meeting: id }));
export const myMissed = (groupId: string) => run<Missed[]>(db().rpc("study_my_missed", { p_group: groupId })).then((r) => r ?? []);
export const catchupOf = (id: string) => run<CatchupPack>(db().rpc("study_meeting_catchup", { p_meeting: id }));
export const catchupDone = (id: string) => run<null>(db().rpc("study_meeting_catchup_done", { p_meeting: id }));

/** Today's meeting on a lecture (any member reads study_meetings; no taps, no presence). */
export async function meetingOn(groupId: string, lectureId: string, now = Date.now()): Promise<MeetingRow | null> {
  const { data, error } = await db()
    .from("study_meetings")
    .select("id, group_id, day, starts_at, lecture_id, part_from, part_to, title, reader_id, reading, started_at, read_part, guess_ids, guess_released, cancelled_at, version")
    .eq("group_id", groupId)
    .eq("lecture_id", lectureId)
    .eq("day", dayText(now))
    .is("cancelled_at", null)
    .limit(1);
  if (error) throw new Error(error.message || "network");
  return ((data ?? [])[0] as MeetingRow | undefined) ?? null;
}

/** The group's meetings, live: any change to one (a reading starting, a
 *  guess lighting up, a plan saved) calls onRow with the row (an empty
 *  object for a delete). */
let channelSeq = 0;
export function watchMeetings(groupId: string, onRow: (row: Partial<MeetingRow>) => void, onStatus?: (status: string) => void, o: { quizzes?: boolean } = {}): () => void {
  if (!sb) return () => undefined;
  const client = sb;
  // One channel per watcher (a channel's callbacks are fixed once it subscribed, and the band,
  // the meeting screen and the follower's bar may watch at once).
  let ch = client
    .channel(`study-meetings-${groupId}-${++channelSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_meetings", filter: `group_id=eq.${groupId}` }, (p) => onRow((p.new ?? {}) as Partial<MeetingRow>))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "study_meetings" }, () => onRow({}));
  // The opening's and the closing's quizzes move the band too.
  if (o.quizzes) ch = ch.on("postgres_changes", { event: "*", schema: "public", table: "study_quizzes", filter: `group_id=eq.${groupId}` }, () => onRow({}));
  ch.subscribe((status) => onStatus?.(status));
  return () => void client.removeChannel(ch);
}

/** A refusal in the meeting's words (failText's area "meeting"). */
export const meetingWords = (e: unknown) => failText(e instanceof Error ? e.message : String(e ?? ""), "meeting");

/* ─────────────── the pure rules ─────────────── */

export const PLACE_MS = 5_000;
export const HEARTBEAT_MS = 20_000;
export const HERE_MS = 180_000;
export const CARD_MS = 6_000;

/** The reader's place to the database: at most one call in PLACE_MS, the
 *  last place always sent (a trailing call), and a heartbeat every
 *  HEARTBEAT_MS while nothing moves. Time and the timer are injected, so a
 *  test drives it. */
export class PlaceReporter {
  private last = -Infinity;
  private sentKey = "";
  private pending: { part: number; anchor: number } | null = null;
  private current: { part: number; anchor: number } | null = null;
  private timer: unknown = null;
  private beat: unknown = null;
  constructor(
    private send: (part: number, anchor: number) => void,
    private clock: { now: () => number; set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void } = {
      now: () => Date.now(),
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    },
  ) {}
  /** A place on the screen (the same place twice sends nothing new). */
  place(part: number, anchor: number): void {
    this.current = { part, anchor };
    const key = `${part}.${anchor}`;
    if (key === this.sentKey && !this.pending) return;
    const wait = this.last + PLACE_MS - this.clock.now();
    if (wait <= 0 && !this.timer) return this.fire(part, anchor);
    this.pending = { part, anchor };
    if (!this.timer) this.timer = this.clock.set(() => this.flush(), Math.max(0, wait));
  }
  private flush(): void {
    this.timer = null;
    const p = this.pending;
    this.pending = null;
    if (p) this.fire(p.part, p.anchor);
  }
  private fire(part: number, anchor: number): void {
    this.last = this.clock.now();
    this.sentKey = `${part}.${anchor}`;
    this.send(part, anchor);
    if (this.beat) this.clock.clear(this.beat);
    this.beat = this.clock.set(() => {
      this.beat = null;
      const c = this.current;
      if (c) this.fire(c.part, c.anchor);
    }, HEARTBEAT_MS);
  }
  stop(): void {
    if (this.timer) this.clock.clear(this.timer);
    if (this.beat) this.clock.clear(this.beat);
    this.timer = this.beat = null;
    this.pending = null;
  }
}

/** The study day's date ("2026-11-17"), as section M's study_private.day_of. */
export function dayText(ms: number): string {
  return new Date(studyDay(ms) * 86_400_000).toISOString().slice(0, 10);
}

/** "רובכם צדקו" · "הקבוצה חלוקה" · "רובכם טעו": "שאלות פתיחה"'s word for a round
 *  (Z's majority from 3 answers), null below 3. */
export function coffeeChip(m: "most_right" | "split" | "most_wrong" | null | undefined): { text: string; tone: "ok" | "warn" | "bad" } | null {
  if (m === "most_right") return { text: "רובכם צדקו", tone: "ok" };
  if (m === "split") return { text: "הקבוצה חלוקה", tone: "warn" };
  if (m === "most_wrong") return { text: "רובכם טעו", tone: "bad" };
  return null;
}

/** A released guess's own line: "ניחשת X, כמו רוב הקבוצה" and the like; a
 *  word, never a number (M3). */
export function guessLine(g: Pick<GuessItem, "mine" | "majority" | "correct">, option: (i: number) => string): string {
  if (g.mine === null || g.mine === undefined) return g.majority ? (g.majority.most_right ? "לא ניחשת. רוב הקבוצה צדקה." : "לא ניחשת.") : "לא ניחשת.";
  const mine = `ניחשת ${option(g.mine)}`;
  const m = g.majority;
  if (!m) return `${mine}.`;
  if (m.with_most) return `${mine}, כמו רוב הקבוצה`;
  if (m.spread) return `${mine}. הקבוצה התפזרה בין התשובות.`;
  return g.correct ? `${mine}, נכון. רוב הקבוצה ניחשה אחרת.` : `${mine}. רוב הקבוצה ניחשה אחרת.`;
}

/** "{n} דק׳" of a catch-up (the database's minutes: 2 + a minute per stop
 *  and answered question + half per association + 1.5 per question). */
export function catchupMinutes(p: Pick<CatchupPack, "stops" | "resolved" | "pins" | "questions">): number {
  return 2 + p.stops.length + p.resolved.length + Math.ceil(p.pins.length * 0.5) + Math.ceil(p.questions.length * 1.5);
}

/** Nothing of the meeting was kept beyond the reading. */
export const catchupEmpty = (p: Pick<CatchupPack, "stops" | "resolved" | "pins" | "questions">) =>
  !p.stops.length && !p.resolved.length && !p.pins.length && !p.questions.length;

/** "ש׳ 19-33" (a single slide: "ש׳ 19"). */
export function slideRange(from: number | null | undefined, to: number | null | undefined): string {
  if (from === null || from === undefined) return "";
  return to === null || to === undefined || to === from ? `ש׳ ${from}` : `ש׳ ${from}-${to}`;
}

/** "09:00" in Israel time. */
export function clockOf(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

const WEEKDAY = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
/** "היום · 09:00", "מחר · 09:00", "יום ה׳ · 09:00" (the study day of the meeting). */
export function whenLine(m: Pick<BandMeeting, "day" | "starts_at">, now = Date.now()): string {
  const today = dayText(now);
  const tomorrow = dayText(now + 86_400_000);
  const at = clockOf(m.starts_at);
  const day = m.day === today ? "היום" : m.day === tomorrow ? "מחר" : `יום ${WEEKDAY[new Date(`${m.day}T12:00:00Z`).getUTCDay()]}`;
  return at ? `${day} · ${at}` : day;
}

/** The default time of a new meeting: the last one's, else 09:00, on the
 *  next day that has none (planning's "מתי"). Returns local date and time strings. */
export function defaultWhen(lastStartsAt: string | null, now = Date.now()): { date: string; time: string } {
  const time = lastStartsAt ? clockOf(lastStartsAt) || "09:00" : "09:00";
  return { date: dayText(now + 86_400_000), time };
}

const WALL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Israel's offset from UTC at an instant, in ms (2 or 3 hours). */
function israelOffset(ms: number): number {
  const w = WALL.formatToParts(new Date(ms)).reduce<Record<string, string>>((o, p) => ((o[p.type] = p.value), o), {});
  const shown = Date.UTC(Number(w.year), Number(w.month) - 1, Number(w.day), Number(w.hour) % 24, Number(w.minute));
  return shown - Math.floor(ms / 60_000) * 60_000;
}

/** "2026-11-18" and "09:00", Israel time → an ISO instant. */
export function israelInstant(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  const first = naive - israelOffset(naive);
  return new Date(naive - israelOffset(first)).toISOString();
}

/** An instant → its Israel date and time ("2026-11-18", "09:00"), for the planning form. */
export function israelParts(iso: string): { date: string; time: string } {
  const ms = Date.parse(iso);
  const local = new Date(ms + israelOffset(ms)).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** Whether a tap on "לא ברור לי" may promise "הפסקה תחזור אליך מחר": with
 *  Today or the paragraph's own chip (N), the tap does come back
 *  (decision 1, 17 Nov 2026: no account is needed for it). */
export function unclearToast(back: boolean): string {
  return back ? "סומן, בלי שם. הפסקה תחזור אליך מחר." : "סומן, בלי שם. הסימון נשמר רק אצלך.";
}

/** The rituals of a study day (decision 7): the opening and the closing, at
 *  most one of each. What the meeting screen offers now. */
export function ritualsNow(m: Pick<BandMeeting, "coffee" | "closing" | "started_at" | "reading" | "reader_id" | "over">, skipped: boolean): {
  coffee: "offer" | "live" | "done" | "none";
  closing: "offer" | "live" | "done" | "none";
} {
  const live = (q: QuizRef | null) => Boolean(q && ["lobby", "question", "reveal"].includes(q.state));
  // The opening comes before the reading (the opening itself starts the meeting); the closing once
  // someone read aloud (reader_id is set by the first reading and stays).
  const read = Boolean(m.reader_id);
  const coffee = live(m.coffee) ? "live" : m.coffee && m.coffee.state === "ended" ? "done" : skipped || read || m.started_at || m.over ? "none" : "offer";
  const closing = live(m.closing) ? "live" : m.closing && m.closing.state === "ended" ? "done" : read && !m.over && coffee !== "live" ? "offer" : "none";
  return { coffee, closing };
}

/** The last paragraph of a part on the page (the reader's "עצירה" chip). */
export function lastAnchorOf(part: number): number | null {
  if (typeof document === "undefined") return null;
  const blocks = [...document.querySelectorAll<HTMLElement>(`.lecture-body [data-part="${part}"] [data-blk]`)];
  const n = blocks.map((b) => Number(b.dataset.blk)).filter((x) => Number.isInteger(x));
  return n.length ? Math.max(...n) : null;
}
