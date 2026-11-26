/* ── The words of every notice (section R) ──
 * The database stores no Hebrew: a notice keeps its kind, args, count and
 * route. render() writes its title and body, for the lock screen (the push)
 * and for the inbox inside the app, from this one table, so the sender
 * (server/study/notify.ts) and the bell's list say the same thing.
 *
 * The lock screen is seen by others: it shows lecture and course titles,
 * never a quiz's title (it can be a slide's section title), never a name,
 * never the text of a comment, question or summary. The inbox, inside the
 * app, adds the quiz's title and who opened it.
 *
 * Plain, impersonal or plural words (docs/study/COPY.md). Titles stay within
 * 60 characters and bodies within 120, cut with "…"; English runs inside
 * Hebrew are isolated (bidiText.ts). Another package adds its kinds here,
 * one block per package, beside its row in study_private.notice_kinds. */

import { WEEKDAY_HE } from "./day.js";
import { FSI, HEBREW, isolate, PDI } from "./bidiText.js";

export type Surface = "lock" | "inbox";
export type Cat = "live" | "mine" | "digest" | "security" | "inapp";
export type Rendered = { title: string; body: string };

export const TITLE_MAX = 60;
export const BODY_MAX = 120;
export const FALLBACK_TITLE = "משהו חדש בתמצית";

type Args = Record<string, unknown>;
type Ctx = { a: Args; n: number; surface: Surface; now: number };
type Kind = {
  cat: Cat;
  title: (c: Ctx) => string;
  body: (c: Ctx) => string;
  /** A live notice that is over, in the inbox: its title in the past tense
   *  (none: the title stays, with "הסתיים" under it, as a quiz's). */
  over?: (c: Ctx) => string;
};

/* ── Reading args (they come from the database: anything may be missing) ── */

/** A title from args, trimmed to 120 characters, its English kept in place:
 *  the runs of a Hebrew title isolated, an English title isolated whole (so
 *  "Kinetics · 18:00" keeps the title first, on the right). "" when absent. */
function str(a: Args, k: string): string {
  const v = a[k];
  if (typeof v !== "string") return "";
  // Direction marks a title may carry are dropped: only this module places them.
  const t = Array.from(v.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim()).slice(0, 120).join("");
  if (!t) return "";
  return HEBREW.test(t) ? isolate(t) : /[A-Za-z\u0370-\u03FF]/.test(t) ? FSI + t + PDI : t;
}
/** A code from args (no isolates: it is never shown), or "". */
const code = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
/** A whole number from args, or 0. */
function num(a: Args, k: string): number {
  const v = typeof a[k] === "string" ? Number(a[k]) : a[k];
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : 0;
}
/** The parts that are there, joined by the app's separator. */
const join = (...parts: Array<string | false | 0 | null | undefined>) => parts.filter(Boolean).join(" · ");

const TZ = "Asia/Jerusalem";
const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DATE = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** An instant from args: an ISO time, or null. */
function when(a: Args, k: string): Date | null {
  const v = a[k];
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}
/** "HH:MM", Israel time, kept left to right inside Hebrew. */
function clock(a: Args, k: string): string {
  const v = a[k];
  if (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return v;
  const d = when(a, k);
  return d ? CLOCK.format(d) : "";
}
/** Days since 1970 of an instant's Israel date. */
const israelDay = (ms: number) => Date.parse(`${DATE.format(new Date(ms))}T00:00:00Z`) / 86_400_000;
/** "היום", "אתמול" or "ב-26.11", for an instant seen at `now`. */
function dayWord(d: Date, now: number): string {
  const diff = israelDay(now) - israelDay(d.getTime());
  if (diff === 0) return "היום";
  if (diff === 1) return "אתמול";
  const [, m, day] = DATE.format(d).split("-").map(Number);
  return `ב-${day}.${m}`;
}
/** "יום ג׳" of an instant, Israel time. */
function weekdayOf(d: Date): string {
  const day = israelDay(d.getTime());
  return `יום ${WEEKDAY_HE[(((day + 4) % 7) + 7) % 7]}`;
}
/** "ב" before a Hebrew name, "ב-" before any other ("בפרמקולוגיה", "ב-Kinetics"). */
const inName = (name: string) => (HEBREW.test(name.replace(/[⁨⁩]/g, "").charAt(0)) ? `ב${name}` : `ב-${name}`);

/** The lecture, and how many more the quiz takes ("ועוד הרצאה", "ועוד 3 הרצאות"). */
function lectures(a: Args): string {
  const lec = str(a, "lecture");
  const more = num(a, "more");
  if (!lec) return "";
  return more === 0 ? lec : more === 1 ? `${lec} ועוד הרצאה` : `${lec} ועוד ${more} הרצאות`;
}
/** The budget's words for a stop with a reason ('budget', 'reserve', 'member_share', 'daily_limit'). */
function stopped(why: string): "budget" | "daily" | null {
  if (why === "budget" || why === "reserve" || why === "member_share") return "budget";
  if (why === "daily_limit") return "daily";
  return null;
}
const AGAIN_BUDGET = "אפשר להמשיך כשהתקציב מתחדש";
const AGAIN_TOMORROW = "אפשר להמשיך מחר";

/** A practice set's shelf, as the lock screen and a coalesced row say it. */
const SETS_SHELF = "אפשר לפתור מ״סטים של הקבוצה״";

/** "{course} {year} {moed}" of a past exam. */
const examName = (a: Args) => [str(a, "course"), num(a, "year") || str(a, "year"), str(a, "moed")].filter(Boolean).join(" ");

export const KINDS: Record<string, Kind> = {
  /* ── R: live in the group ("עכשיו בקבוצה") ── */
  quiz_open: {
    cat: "live",
    title: ({ a }) => (a.mode === "race" ? "מירוץ נפתח עכשיו" : "מבחן קבוצתי נפתח עכשיו"),
    body: ({ a, surface }) => {
      if (surface === "lock") return join(lectures(a), "להצטרף");
      const name = str(a, "name");
      const inside = num(a, "in");
      return join(str(a, "title") || lectures(a), name && (inside ? `${name} ועוד ${inside} בפנים` : `${name} בפנים`));
    },
  },
  boss_open: { cat: "live", title: () => "אתגר קבוצתי נפתח עכשיו", body: ({ a }) => join(str(a, "course"), "להצטרף") },
  meeting_soon: {
    cat: "live",
    title: () => "הפגישה מתחילה בעוד 15 דקות",
    body: ({ a }) => join(str(a, "lecture"), clock(a, "at")),
    // off: the minute job saw it cancelled.
    over: ({ a }) => (a.off === true ? "הפגישה בוטלה" : "הפגישה התקיימה"),
  },
  reading: {
    cat: "live",
    title: () => "ההקראה התחילה",
    over: () => "ההקראה הסתיימה",
    body: ({ a, surface }) => {
      const name = str(a, "name");
      return surface === "inbox" && name ? join(str(a, "lecture"), `מקריאים עכשיו: ${name}`) : join(str(a, "lecture"), "אפשר להצטרף");
    },
  },
  // The study day's title is written freely (it can hold a name): the lock screen shows only its time.
  session_soon: {
    cat: "live",
    title: () => "מפגש הלמידה מתחיל בעוד 30 דקות",
    body: ({ a, surface }) => (surface === "lock" ? clock(a, "at") : join(str(a, "title"), clock(a, "at"))),
    over: () => "מפגש הלמידה התקיים",
  },

  /* ── R: for this member ("בשבילך") ── */
  reply: {
    cat: "mine",
    title: ({ n }) => (n === 1 ? "תשובה חדשה בשרשור שלך" : `${n} תשובות חדשות בשרשור שלך`),
    body: ({ a }) => join(str(a, "lecture"), num(a, "part") && `חלק ${num(a, "part")}`),
  },
  answer: {
    cat: "mine",
    title: ({ n }) => (n === 1 ? "יש תשובה לשאלה שלך" : `יש ${n} תשובות לשאלה שלך`),
    body: ({ a }) => join(str(a, "lecture"), num(a, "part") && `חלק ${num(a, "part")}`),
  },
  credit_ask: { cat: "mine", title: () => "בקשה לקרדיט על דרך לזכור", body: ({ a }) => join(str(a, "lecture"), "לאשר או לדחות") },
  dispute: { cat: "mine", title: () => "נפתחה מחלוקת על תיקון שהצעת", body: ({ a }) => join(str(a, "lecture"), "אפשר להוסיף את הצד שלך") },
  dispute_done: { cat: "mine", title: () => "ההכרעה במחלוקת מוכנה", body: ({ a }) => str(a, "lecture") },
  needs_me: { cat: "mine", title: () => "שאלה פתוחה שאפשר לעזור בה", body: ({ a }) => str(a, "lecture") },
  summary_ready: { cat: "mine", title: () => "הסיכום מוכן", body: ({ a }) => str(a, "lecture") },
  summary_failed: {
    cat: "mine",
    title: ({ a }) => {
      const s = stopped(code(a, "why"));
      return s === "budget" ? "הכתיבה נעצרה: התקציב החודשי נגמר" : s === "daily" ? "הכתיבה נעצרה: המכסה היומית נגמרה" : "הכתיבה נעצרה";
    },
    body: ({ a }) => {
      const s = stopped(code(a, "why"));
      return join(str(a, "lecture"), s === "budget" ? AGAIN_BUDGET : s === "daily" ? AGAIN_TOMORROW : "אפשר ללחוץ ״המשך כתיבה״");
    },
  },
  exam_ready: {
    cat: "mine",
    title: ({ a }) => (a.kind === "sheet" ? "דף התרגילים מוכן לתרגול" : "המבחן הקודם מוכן לתרגול"),
    body: ({ a }) => examName(a),
  },
  exam_failed: {
    cat: "mine",
    title: () => "קריאת המבחן לא הצליחה",
    body: ({ a }) => {
      const s = stopped(code(a, "why"));
      const name = [str(a, "course"), num(a, "year") || str(a, "year")].filter(Boolean).join(" ");
      return join(name, s === "budget" ? AGAIN_BUDGET : s === "daily" ? AGAIN_TOMORROW : "אפשר לנסות שוב");
    },
  },

  /* ── R: the daily reminder (off by default) ── */
  digest: {
    cat: "digest",
    title: () => "היום בתמצית",
    body: ({ a }) => {
      const cards = num(a, "cards");
      const d = a.days;
      const days = typeof d === "number" && Number.isSafeInteger(d) && d >= 0 ? d : -1;
      const course = str(a, "course");
      const exam = course && days >= 0 ? `המבחן ${inName(course)} ${days === 0 ? "היום" : days === 1 ? "מחר" : `בעוד ${days} ימים`}` : "";
      return join(cards === 1 ? "כרטיסייה אחת לחזרה" : cards > 1 && `${cards} כרטיסיות לחזרה`, clock(a, "meet") && `הפגישה ב-${clock(a, "meet")}`, exam);
    },
  },

  /* ── R: the security notice and the test push ── */
  code_used: {
    cat: "security",
    title: ({ a, now }) => {
      const d = when(a, "at");
      return d ? `נכנסו עם הקוד האישי ${dayWord(d, now)}, בשעה ${CLOCK.format(d)}` : "נכנסו עם הקוד האישי";
    },
    body: () => "אם זה המכשיר שלך, אין מה לעשות. אם לא: שלי ← ניתוק המכשירים האחרים",
  },
  test: { cat: "security", title: () => "התראת ניסיון", body: () => "ככה ייראו ההתראות מתמצית" },

  /* ── L: practice sets (docs/study/sets.md; registered by section L) ──
   * set_shared: one row a member a day, coalesced ("3 סטים חדשים בקבוצה"),
   * at most one push a day. The lock screen names neither the lecture nor
   * the author; the inbox, inside the app, says the lecture, the size and
   * "מאת {name}" for one set, and the shelf for several. set_solved: the
   * author's inbox only ("הסט … נפתר פעם אחת", k: the others who solved it). */
  set_shared: {
    cat: "mine",
    title: ({ n }) => (n === 1 ? "סט תרגול חדש בקבוצה" : `${n} סטים חדשים בקבוצה`),
    body: ({ a, n, surface }) => {
      if (surface === "lock" || n > 1) return SETS_SHELF;
      const k = num(a, "k");
      const name = str(a, "name");
      return join(str(a, "lecture"), k === 1 ? "שאלה אחת" : k > 1 && `${k} שאלות`, name && `מאת ${name}`) || SETS_SHELF;
    },
  },
  set_solved: {
    cat: "inapp",
    title: ({ a, n, surface }) => {
      const k = num(a, "k") || n;
      // Inbox only (never pushed); a lock screen would still not show the set's title.
      const t = surface === "inbox" ? str(a, "title") : "";
      const set = t ? `הסט ״${t}״` : "הסט";
      return k === 1 ? `${set} נפתר פעם אחת` : `${set} נפתר ${k} פעמים`;
    },
    body: () => "אפשר לראות את המספרים של הקבוצה",
  },

  /* ── R: inbox only ── */
  update: { cat: "inapp", title: () => "תיקון הגיע לשורה שלמדת", body: ({ a }) => str(a, "lecture") },
  edit_wait: { cat: "inapp", title: () => "תיקון מחכה לאישור", body: ({ a }) => str(a, "lecture") },
  lecture_new: { cat: "inapp", title: () => "סיכום חדש בספרייה", body: ({ a }) => str(a, "lecture") },
  meeting_set: {
    cat: "inapp",
    title: () => "נקבעה פגישה",
    body: ({ a }) => {
      const d = when(a, "at");
      return join(str(a, "lecture"), d && `${weekdayOf(d)} ${CLOCK.format(d)}`);
    },
  },
};

/** Cut to `max` characters with "…", never leaving an English run's isolate open. */
export function cut(text: string, max: number): string {
  const cps = Array.from(text);
  if (cps.length <= max) return text;
  let out = cps.slice(0, max - 1).join("").trimEnd();
  const open = () => out.split(FSI).length - out.split(PDI).length;
  if (open() > 0) {
    out = Array.from(out).slice(0, max - 2).join("").trimEnd();
    if (out.endsWith(FSI)) out = out.slice(0, -1).trimEnd();
    if (open() > 0) out += PDI;
  }
  return `${out}…`;
}

/** A notice's title and body, for the lock screen or the inbox. An unknown
 *  kind (another package's, newer than this build) reads "משהו חדש בתמצית",
 *  with its args' title in the inbox only (never on the lock screen: it may
 *  be a slide's section title). */
export function render(kind: string, args: unknown, count = 1, surface: Surface = "inbox", now = Date.now()): Rendered {
  const a: Args = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Args) : {};
  const n = Number.isSafeInteger(count) && count > 0 ? count : 1;
  const k = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
  const c: Ctx = { a, n, surface, now };
  const title = k ? k.title(c) : FALLBACK_TITLE;
  const body = k ? k.body(c) : surface === "lock" ? "" : str(a, "title");
  return { title: cut(title, TITLE_MAX), body: cut(body, BODY_MAX) };
}

/** A live notice that is over, in the inbox: its past-tense title ("הפגישה
 *  התקיימה"), or null when the kind keeps its title (a quiz: "מבחן קבוצתי
 *  נפתח", with "הסתיים · לתוצאות" under it). */
export function overTitle(kind: string, args: unknown, now = Date.now()): string | null {
  const k = Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
  if (!k?.over) return null;
  const a: Args = typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Args) : {};
  return cut(k.over({ a, n: 1, surface: "inbox", now }), TITLE_MAX);
}

/** A kind's category, as study_private.notice_kinds has it (unknown: inbox only). */
export function catOf(kind: string): Cat {
  return Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind].cat : "inapp";
}
