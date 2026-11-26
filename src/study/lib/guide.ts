import type { Flags } from "./flags";
import type { InstallFact } from "./installLazy";
import type { PushState } from "./notify";
import { installHowTo } from "./installCopy";
import { miniScreen, type MiniRoute } from "./guideScreens";
import { APP_PATH, tabOf, type Route } from "./route";

/* ── The guide, as data (docs/study/guide.md) ──
 * Pure: every word the guide says and every place it points at, each behind
 * the flags that show it, so guide.test.ts reads them under every release's
 * set. The components (GuideLayer, GuideSteps, HowTo, GuideMe, TryScreen)
 * only render what this file returns.
 *
 * The rules this file keeps (and its test checks):
 *  - the guide points, it never acts: a target is a selector for a ring
 *    drawn beside the element; nothing here clicks, sends or writes;
 *  - a control that is seen by the whole group or that spends the group's
 *    budget is a STOP: the walk rings it, says so, and ends there;
 *  - a step, a how-to or a hint whose feature is off is never returned;
 *  - every sentence is gender-neutral (plural verbs, "מי ש…ים") and short. */

/* ─────────────────────────── what the group has ─────────────────────────── */

/** What the guide knows of the group and the device, read only through the
 *  app's existing reads (lectures, members, the practice counts). */
export type Facts = {
  /** Lectures that are not deleted. */
  lectures: number;
  /** Lectures with a written summary, newest first (ids). */
  ready: string[];
  /** Lectures whose summary is being written. */
  writing: number;
  /** Members in the group. */
  members: number;
  /** A ready lecture with practice questions, if any. */
  practiceLecture: string | null;
  /** Today's queue length, when Today is the home and has loaded. */
  queue: number | null;
  /** The summary is written on the server (W's slot): the upload can be left. */
  serverWrites: boolean;
  /** Courses the library links to (distinct course texts of the lectures). */
  courses: number;
  /** How this device adds the app to the home screen (lib/install.ts): an
   *  iPhone's steps, an Android's menu, the browser's own prompt, or no way
   *  (a computer without the prompt). */
  install: InstallFact;
  /** The page runs as the home-screen app. */
  standalone: boolean;
  /** Where this device stands with notifications (lib/notify.ts): "ask" when
   *  pushes are offered to the member and this device can turn them on. */
  notify: PushState;
};

export const NO_FACTS: Facts = { lectures: 0, ready: [], writing: 0, members: 0, practiceLecture: null, queue: null, serverWrites: false, courses: 0, install: "none", standalone: false, notify: "off" };

/* ─────────────────────────── the device's memory ─────────────────────────── */

export type StepId = "S1" | "S2" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9" | "S10";
/** A real action the first steps count: the layer's marks and routes. */
export type DoneEvent = "upload" | "open" | "para" | "bet" | "run" | "invite" | "group" | "course" | "install" | "notify";

export type Memory = {
  v: 1;
  /** When "הצעדים הראשונים" started on this device (Join, or "שלי"'s restart). */
  born?: number;
  mode?: "join" | "create";
  /** Home views since born (the card collapses from the third). */
  views: number;
  /** The real actions seen. */
  did: DoneEvent[];
  /** The first steps shown so far (a step never leaves the list). */
  list: StepId[];
  hidden?: boolean;
  closed?: boolean;
  /** "טיפים על דברים חדשים" (on unless turned off in "שלי"). */
  tips: boolean;
  /** The flags this member already knew; a flag turned on later gets one "חדש" hint. */
  known?: string[];
  /** The day (YYYY-MM-DD) the last "חדש" hint showed: at most one a day. */
  hintDay?: string;
  /** The home's one-time offer of the app tour, for a member who never had
   *  the first steps (joined before the guide): answered by starting the
   *  tour ("taken") or by "לא עכשיו" ("dismissed"); never offered again. */
  offer?: "taken" | "dismissed";
};

export const MEMORY_PREFIX = "study-guide:";
export const memoryKey = (userId: string) => `${MEMORY_PREFIX}${userId}`;
export const RETIRE_MS = 14 * 86_400_000;

const blank = (): Memory => ({ v: 1, views: 0, did: [], list: [], tips: true });
/** This load's copy, for a browser whose storage throws (private mode). */
const held = new Map<string, Memory>();
/** Members whose last write did not reach storage (full, or refused): the
 *  value stored there is older than this load's copy, which wins. */
const unsaved = new Set<string>();

const DONE: readonly DoneEvent[] = ["upload", "open", "para", "bet", "run", "invite", "group", "course", "install", "notify"];
const STEPS: readonly StepId[] = ["S1", "S2", "S4", "S5", "S6", "S7", "S8", "S9", "S10"];

/** A stored value, cleaned: anything that is not the guide's shape is dropped. */
export function parseMemory(raw: string | null | undefined): Memory {
  const m = blank();
  if (!raw) return m;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return m;
  }
  if (!x || typeof x !== "object") return m;
  const o = x as Record<string, unknown>;
  if (typeof o.born === "number" && Number.isFinite(o.born)) m.born = o.born;
  if (o.mode === "join" || o.mode === "create") m.mode = o.mode;
  if (typeof o.views === "number" && o.views >= 0) m.views = Math.floor(o.views);
  if (Array.isArray(o.did)) m.did = o.did.filter((e): e is DoneEvent => DONE.includes(e as DoneEvent));
  if (Array.isArray(o.list)) m.list = o.list.filter((e): e is StepId => STEPS.includes(e as StepId));
  if (o.hidden === true) m.hidden = true;
  if (o.closed === true) m.closed = true;
  if (o.tips === false) m.tips = false;
  if (Array.isArray(o.known)) m.known = o.known.filter((e): e is string => typeof e === "string");
  if (typeof o.hintDay === "string") m.hintDay = o.hintDay;
  if (o.offer === "taken" || o.offer === "dismissed") m.offer = o.offer;
  return m;
}

export function readMemory(userId: string): Memory {
  const h = held.get(userId);
  // A write that storage refused (iOS Safari's quota): its older value must not undo it.
  if (h && unsaved.has(userId)) return h;
  try {
    const raw = localStorage.getItem(memoryKey(userId));
    if (raw !== null) return parseMemory(raw);
  } catch {
    /* private mode: this load's copy */
  }
  return h ?? blank();
}

export function writeMemory(userId: string, m: Memory): void {
  held.set(userId, m);
  try {
    localStorage.setItem(memoryKey(userId), JSON.stringify(m));
    unsaved.delete(userId);
  } catch {
    /* private mode or a full storage: kept for this load only */
    unsaved.add(userId);
    try {
      localStorage.removeItem(memoryKey(userId));
    } catch {
      /* no storage at all */
    }
  }
}

/* ─────────────────────────── the first steps ─────────────────────────── */

export type WalkId =
  | "read"
  | "upload"
  | "practice"
  | "invite"
  | "today"
  | "group"
  | "cards"
  | "correct"
  | "readaloud"
  | "quizopen"
  | "meeting"
  | "ask"
  | "readmark"
  | "course"
  | "install"
  | "notify";

export type FirstStep = {
  id: StepId;
  title: string;
  line: string;
  /** "להראות": the walk it starts; none for a step that is waiting (S1 while writing). */
  walk?: WalkId;
  /** A chip beside the title ("נכתב"). */
  chip?: string;
  /** The real actions that tick it off. */
  doneBy: DoneEvent[];
  /** Shown before, but what it needed is gone (a deleted lecture): "דולג". */
  skipped?: true;
};

/** "א, ב וג" of the parts that are on. */
function andList(parts: Array<string | false>): string {
  const on = parts.filter((p): p is string => Boolean(p));
  return on.length > 1 ? `${on.slice(0, -1).join(", ")} ו${on[on.length - 1]}` : (on[0] ?? "");
}

/** "תגובה או שאלה לקבוצה, תיקון, אסוציאציה": what a paragraph opens under these flags. */
export function paragraphActions(f: Flags): string {
  const more = [f.corrections && "תיקון", f.wall && "אסוציאציה", f.ask && "לשאול"].filter(Boolean) as string[];
  return ["תגובה או שאלה לקבוצה", ...more].join(", ");
}

/** Each first step under these flags and facts, or null when it does not apply now. */
function step(id: StepId, f: Flags, x: Facts, creator: boolean): FirstStep | null {
  switch (id) {
    case "S1":
      if (x.ready.length)
        return { id, title: "לפתוח סיכום", line: "כל הרצאה שהקבוצה העלתה, מסוכמת עם מספרי השקפים.", walk: "read", doneBy: DONE_BY.S1 };
      if (x.writing)
        return { id, title: "להעלות הרצאה ראשונה", chip: "נכתב", line: "הסיכום נכתב כמה דקות. אפשר להמשיך בינתיים, הוא יחכה בספרייה.", doneBy: DONE_BY.S1 };
      return {
        id,
        title: "להעלות הרצאה ראשונה",
        line: f.courses ? "מצגת או PDF, ותוך כמה דקות יש סיכום מלא לכולם. יש כמה מצגות? אפשר להעלות אותן יחד." : "מצגת או PDF, ותוך כמה דקות יש סיכום מלא לכולם.",
        walk: "upload",
        doneBy: DONE_BY.S1,
      };
    case "S2":
      return x.ready.length ? { id, title: "לגעת בפסקה", line: `כל פסקה נפתחת: ${paragraphActions(f)}.`, walk: "read", doneBy: DONE_BY.S2 } : null;
    case "S4":
      return f.practice && x.practiceLecture
        ? { id, title: "לענות ולסמן כמה בטוחים", line: "בוחרים תשובה, ואז כמה בטוחים. התשובות גלויות רק לך.", walk: "practice", doneBy: DONE_BY.S4 }
        : null;
    case "S5":
      return f.today && (x.queue ?? 0) > 0
        ? { id, title: "להתחיל את התור", line: "התור שלי לפי הזמן שיש: 10, 20 או 45 דקות.", walk: "today", doneBy: DONE_BY.S5 }
        : null;
    case "S6":
      return creator || x.members < 3
        ? { id, title: "להזמין את הקבוצה", line: "קישור אחד בוואטסאפ, וכולם בפנים. בלי הרשמה.", walk: "invite", doneBy: DONE_BY.S6 }
        : null;
    case "S7": {
      if (!f.meeting && !f.quiz) return null;
      const what = ["מי מקריאים עכשיו", f.meeting && "הפגישה הבאה", f.quiz && "מבחן קבוצתי"].filter(Boolean) as string[];
      return { id, title: "להציץ ב״יחד״", line: `${what.join(", ")} ושאלות פתוחות.`, walk: "group", doneBy: DONE_BY.S7 };
    }
    case "S8":
      // The course page (docs/study/sources.md): only once the library has a course to open.
      return f.courses && x.courses > 0
        ? {
            id,
            title: "להציץ בעמוד הקורס",
            line: f.exams ? "תאריך המבחן, מבחנים קודמים וסימולציה, לכל קורס." : f.practice ? "תאריך המבחן ותרגול של כל הקורס." : "תאריך המבחן וכל ההרצאות, לכל קורס.",
            walk: "course",
            doneBy: DONE_BY.S8,
          }
        : null;
    case "S9":
      // Adding the app to the home screen (docs/study/install.md): where there
      // is a way here, or in the app itself (a step kept from the browser,
      // ticked by the launch); firstSteps never adds it there.
      return f.install && (x.standalone || x.install !== "none")
        ? {
            id,
            title: "להוסיף למסך הבית",
            line:
              x.install === "ios"
                ? "תמצית נפתחת מאייקון, כמו אפליקציה. באייפון ההסבר מתחיל מהקוד האישי."
                : x.install === "prompt"
                  ? "תמצית נפתחת מאייקון, כמו אפליקציה. התקנה בלחיצה אחת."
                  : "תמצית נפתחת מאייקון, כמו אפליקציה. ההסבר מותאם לטלפון.",
            walk: "install",
            doneBy: DONE_BY.S9,
          }
        : null;
    case "S10":
      // Notifications (docs/study/notify.md): only where this device can turn them on now.
      return f.notify && x.notify === "ask"
        ? { id, title: "לקבל התראות", line: "התראה כשמבחן קבוצתי נפתח, כשעונים בשרשור שלך וכשהסיכום מוכן. רק מה שבוחרים.", walk: "notify", doneBy: DONE_BY.S10 }
        : null;
  }
}

export const MAX_STEPS = 5;

/** The first steps: those shown before (never dropped, so the counts only
 *  grow), then those that apply now, in order, at most five. A creator's
 *  invite is kept when the list is cut. The course page (S8) comes before
 *  the queue: with a ready lecture, practice and a queue, a joiner's invite
 *  (S6) and "יחד" (S7) give way to it (all six join from the creator's link,
 *  and the tour points at "יחד"). Adding the app to the home screen (S9)
 *  comes right after the first (the creator's: after the invite), so a cut
 *  never drops it; it is never added in the home-screen app itself. A card
 *  whose kept steps are all done takes no new step (it would reopen). */
export function firstSteps(f: Flags, x: Facts, m: Pick<Memory, "list" | "mode"> & Partial<Pick<Memory, "did">>): FirstStep[] {
  const creator = m.mode === "create";
  const kept = new Set(m.list);
  const base: StepId[] = creator ? ["S1", "S6", "S9", "S2", "S4", "S8", "S5", "S7", "S10"] : ["S1", "S9", "S2", "S4", "S8", "S5", "S6", "S7", "S10"];
  // Notifications (S10) come last; opened from the home-screen icon, where they can be turned on, first.
  const order: StepId[] = x.standalone && x.notify === "ask" ? ["S10", ...base.filter((id) => id !== "S10")] : base;
  // A card already finished stays finished ("סגירה"): no step is added on top, not even S9 on the deploy that
  // turns it on for everyone at once.
  const finished = m.list.length > 0 && m.list.every((id) => DONE_BY[id]?.some((e) => m.did?.includes(e)));
  const fresh = (id: StepId) => !finished && !(id === "S9" && x.standalone) && step(id, f, x, creator) !== null;
  const applies = order.filter((id) => kept.has(id) || fresh(id));
  const room = Math.max(MAX_STEPS, kept.size);
  const chosen: StepId[] = [];
  for (const id of applies) if (kept.has(id)) chosen.push(id);
  for (const id of applies) if (!kept.has(id) && chosen.length < room) chosen.push(id);
  const ordered = order.filter((id) => chosen.includes(id));
  // A kept step whose facts are gone (its lecture deleted) keeps its words,
  // without "להראות"; one whose feature was turned off since is dropped.
  return ordered.flatMap((id) => {
    const now = step(id, f, x, creator);
    if (now) return [now];
    const then = step(id, f, SOME_FACTS, true);
    return then ? [{ ...then, walk: undefined, skipped: true as const }] : [];
  });
}

/** Facts under which every step whose flags are on applies. */
const SOME_FACTS: Facts = { ...NO_FACTS, ready: ["-"], practiceLecture: "-", queue: 1, courses: 1, install: "ios", notify: "ask" };

/** Whether a step is done: one of its real actions was seen. */
export const isDone = (s: FirstStep, m: Pick<Memory, "did">) => s.doneBy.some((e) => m.did.includes(e));

export type CardState = "none" | "expanded" | "collapsed" | "done" | "hidden" | "retired";

/** What the home's card shows: nothing before "born", expanded on the first
 *  two home views, then one row; "done" once every step is; never after 14
 *  days, after "להסתיר" or after "סגירה". */
export function cardState(m: Memory, steps: FirstStep[], now: number): CardState {
  if (!m.born) return "none";
  if (m.closed) return "retired";
  if (now - m.born > RETIRE_MS) return "retired";
  if (m.hidden) return "hidden";
  if (steps.length && steps.every((s) => isDone(s, m))) return "done";
  return m.views <= 2 ? "expanded" : "collapsed";
}

/** The real actions that tick each step off. */
export const DONE_BY: Record<StepId, DoneEvent[]> = {
  S1: ["upload", "open"],
  S2: ["para"],
  S4: ["bet"],
  S5: ["run"],
  S6: ["invite"],
  S7: ["group"],
  S8: ["course"],
  S9: ["install"],
  S10: ["notify"],
};
const EVENT_TITLE: Record<DoneEvent, string> = {
  upload: "להעלות הרצאה ראשונה",
  open: "לפתוח סיכום",
  para: "לגעת בפסקה",
  bet: "לענות ולסמן כמה בטוחים",
  run: "להתחיל את התור",
  invite: "להזמין את הקבוצה",
  group: "להציץ ב״יחד״",
  course: "להציץ בעמוד הקורס",
  install: "להוסיף למסך הבית",
  notify: "לקבל התראות",
};

/** Whether the home offers the app tour: a member this device never started
 *  the first steps for (Join's fresh mark starts them at once, so a new
 *  member never sees both) who has not answered the offer yet. */
export const offerWanted = (m: Pick<Memory, "born" | "offer">) => !m.born && !m.offer;

/** Whether the home's card is live: started, not closed, hidden or retired. */
export const cardLive = (m: Memory, now: number) => Boolean(m.born && !m.closed && !m.hidden && now - m.born <= RETIRE_MS);

/** Whether the home's card is live and still takes new steps (not every kept
 *  step done): it then holds the home, and notifications' first-launch card
 *  gives way to its "לקבל התראות". */
export const cardTakesSteps = (m: Memory, now: number) =>
  cardLive(m, now) && !(m.list.length > 0 && m.list.every((id) => DONE_BY[id]?.some((e) => m.did.includes(e))));

/** A real action seen: the memory with it, and the toast that says which
 *  step it ticked ("✓ 2 מתוך 4: לגעת בפסקה"), when it ticked one of a live card. */
export function recordEvent(m: Memory, ev: DoneEvent, now: number): { m: Memory; tick: string | null } {
  if (m.did.includes(ev)) return { m, tick: null };
  const before = m.did;
  const next: Memory = { ...m, did: [...m.did, ev] };
  if (!cardLive(m, now)) return { m: next, tick: null };
  const ticked = m.list.find((id) => DONE_BY[id].includes(ev) && !DONE_BY[id].some((e) => before.includes(e)));
  if (!ticked) return { m: next, tick: null };
  const done = m.list.filter((id) => DONE_BY[id].some((e) => next.did.includes(e))).length;
  return { m: next, tick: COPY.tick(done, m.list.length, EVENT_TITLE[ev]) };
}

/** The route a real visit marks done ("open" a ready lecture is checked on the page). */
export function routeEvent(r: Route): DoneEvent | null {
  if (r.v === "today" && r.run) return "run";
  if (r.v === "group") return "group";
  if (r.v === "course") return "course";
  return null;
}

/* ─────────────────────────── walks ─────────────────────────── */

export type Target = {
  /** A selector of the app's own markup (every one is in TARGETS). */
  sel: string;
  /** Which match: the first shown; a lecture card whose summary is ready; a
   *  paragraph wholly on screen under the top bar. */
  pick?: "first" | "ready" | "inView";
};

export type Until = "route" | "select" | "click" | "next" | "end";

export type WalkStep = {
  /** The screen the step is on. */
  at: (r: Route) => boolean;
  /** Its name, for "קודם: {place}". */
  place: string;
  /** Where "קחו אותי" goes (a navigation, never a tap on anything). */
  go: Route;
  target: Target;
  say: string;
  /** How the step ends: the next screen, an element appearing, a tap the
   *  member makes on the ringed control, "הבא", or the last step's "הבנתי". */
  until: Until;
  select?: string;
  /** A control seen by the whole group, or one that spends the budget: rung,
   *  explained, and the walk ends there. */
  stop?: "group" | "cost";
  /** What the bubble says when the target is not there. */
  empty?: string;
};

export type Walk = { id: WalkId; title: string; steps: WalkStep[] };

export const STOP_LINE = {
  group: "לחיצה כאן נראית לכל הקבוצה, אז רק כשבאמת רוצים.",
  cost: "לחיצה כאן עולה מהתקציב של הקבוצה, אז רק כשבאמת רוצים.",
} as const;
export const MISSING_LINE = "לא מוצאים את זה כרגע. ננסה בפעם אחרת.";

/** The controls the guide never takes a member past: seen live by the whole
 *  group, or paid from the group's budget (docs/study/guide.md, "STOP"). */
export const STOP_SELECTORS = [
  ".practice-more", // "שאלות חדשות" (AI)
  ".practice-empty .a-btn.primary", // "שאלות חדשות" when the lecture has none yet (AI)
  ".room-action button", // "להקריא לקבוצה"
  ".m-unclear", // "לא ברור לי"
  ".read-mark .a-btn", // "סימון שקראתי"
  ".confirm .a-btn.danger", // delete
  ".quiz-setup .ph-foot .a-btn.primary", // opening a quiz, "לפתוח את שאלות הפתיחה"
  ".wall-screen .ph-foot", // "תנו לי 3 מצחיקות" (AI)
  ".ask-bar .ask-row", // "לשאול" (AI)
  // "יצירת סיכום" (AI), and the batch's "העלאה (N קבצים)": its <main> is "upload upload-many".
  ".upload .ph-foot .a-btn.primary",
  // Past exams and the course pages (docs/study/sources.md).
  ".exam-new .ph-foot .a-btn.primary", // the exam's upload (its price on the button)
  ".r-acts .a-btn.primary", // "לאשר" a suggested answer (for the whole group)
  ".r-optbtn", // marking an answer (for the whole group)
  ".r-seq + .a-row .a-btn.primary", // a true/false or match item keyed by hand (uploaded sheets; for the whole group)
  ".r-acts .r-reread", // "לקרוא שוב את עמוד N" (the budget)
  ".x-units .x-retry", // a unit's "לנסות שוב" (the budget)
  ".c-sheet button[type=submit]", // the course sheet's "לשמור", "לשנות שם", "לאחד" (for the whole group)
  ".course-ask .k-composer button[type=submit]", // a question on the whole course (AI)
] as const;

/** Every selector the guide may ring, in one place (guide.test.ts checks
 *  that each walk, mini-guide and how-to uses only these). */
export const TARGETS = {
  libraryTab: `a.ph-tab[href="${APP_PATH}?v=library"]`,
  groupTab: `a.ph-tab[href="${APP_PATH}?v=group"]`,
  lectureCard: "li.lc .lecture-card",
  uploadButton: ".a-card.dashed.empty .a-btn.primary, .lib-actions .a-btn.primary",
  inviteButton: ".lib-actions .a-btn:not(.primary)",
  paragraph: ".lecture-body [data-part] [data-blk]",
  paragraphActions: ".lecture-body .blk-actions, .lecture-body .note-add",
  drop: ".upload label.drop",
  uploadForm: ".upload .upload-form",
  uploadStart: ".upload .ph-foot .a-btn.primary",
  practiceChip: '.lecture-actions a[href*="v=practice"]',
  cardsChip: '.lecture-actions a[href*="v=cards"]',
  quizChip: '.lecture-actions a[href*="v=quiz"]',
  roundLink: ".practice-round-link",
  practiceEmpty: ".practice-empty",
  practiceEmptyMore: ".practice-empty .a-btn.primary",
  practiceMore: ".practice-more",
  bets: ".pq-bets",
  todayStart: ".t-start .a-btn.primary",
  todayMinutes: ".t-minutes",
  todayQueue: ".t-queue, .t-empty",
  meetingBand: ".m-band",
  nowHead: "#now-h",
  meetingCard: ".m-card, .m-bands",
  newMeeting: 'a[href*="v=meeting&new=1"]',
  quizCard: ".quiz-card",
  pulseCard: ".pulse-card",
  bossCard: ".boss-card",
  museumCard: ".museum-card",
  quizOpen: ".quiz-setup .ph-foot .a-btn.primary",
  roundStart: ".practice-round .ph-foot .a-btn.primary",
  headTools: ".head-tools",
  chipRow: ".n-anchor",
  roomBar: ".room-bar",
  readAloud: ".room-action button",
  readMark: ".read-mark .a-btn",
  libraryCards: "li.lc .lecture-card, .a-card.dashed.empty",
  lectureChips: ".lc-chips",
  askBar: ".ask-bar",
  libActions: ".lib-actions",
  practiceLead: ".practice-home .ph-sub",
  practiceRow: ".practice-home .practice-row",
  wallTabs: ".wall-tabs",
  wallFoot: ".wall-screen .ph-foot",
  settings: ".settings .size-ctl",
  guideRows: ".g-me",
  todayTab: `a.ph-tab[href="${APP_PATH}"]`, // the home: routeUrl({ v: "today" }) is APP_PATH
  practiceTab: `a.ph-tab[href="${APP_PATH}?v=practice"], a.ph-tab[href="${APP_PATH}?v=cards"]`,
  meTab: `a.ph-tab[href="${APP_PATH}?v=me"]`,
  screenHelp: ".ph-head .guide-btn",
  // The course pages, the batch upload, past exams and the simulation (docs/study/sources.md).
  courseLink: "a.lib-course",
  courseExam: ".course-page .c-exam",
  courseSim: '.course-page .c-actions a[href*="v=mock"]',
  courseReplay: '.course-page .c-actions a[href*="s=e."]',
  courseFree: ".course-page .c-free",
  courseAsk: ".course-page .c-ask",
  courseSeg: ".course-page .c-seg",
  courseMany: ".course-page .c-many",
  courseMenu: '.course-page .ph-head [aria-label="הגדרות הקורס"]',
  courseActions: ".course-page .c-actions",
  uploadMany: ".upload .up-many",
  batchCourse: ".upload-many .a-field",
  batchCost: ".upload-many .u-cost",
  batchResume: ".upload-many .u-resume",
  examMode: '.exam-new .a-seg[aria-label="איך מעלים"]',
  // Uploaded sheets (docs/study/sheets.md): the upload of a past exam or an exercise sheet, and the wide review.
  sheetZone: ".sheet-new .sx-zone",
  sheetKinds: ".sheet-new .sx-kinds",
  sheetPages: ".sheet-new .sx-pages",
  sheetSplit: ".exam-review .rw-page",
  examKeys: ".exam-new .x-keys",
  examGo: ".exam-new .ph-foot .a-btn.primary",
  examProg: ".exam-review .x-prog",
  examSum: ".exam-review .r-sum",
  examFilters: ".exam-review .r-filters",
  examActs: ".exam-review .r-acts",
  examSim: '.exam-review .r-sum a[href*="v=mock"]',
  examSuggested: ".exam-review .r-filters .r-f-suggested",
  examNokey: ".exam-review .r-filters .r-f-nokey",
  examStalled: ".exam-review .x-stalled",
  examError: ".exam-review .a-error",
  examUnits: ".exam-review .x-units",
  batchProgress: ".upload-many .x-prog",
  simOpen: ".sim-setup .s-open",
  simSource: ".sim-setup .s-src",
  simLength: ".sim-setup .s-len",
  simUnseen: ".sim-setup .s-unseen",
  simStart: ".sim-setup .ph-foot .a-btn.primary",
  simEmpty: '.sim-setup a[href*="v=exams"]',
  caComposer: ".course-ask .k-composer",
  caSources: ".course-ask .ca-sources",
  caLeft: ".course-ask .k-left",
  // Adding the app to the home screen (docs/study/install.md): its row in "שלי".
  installRow: "a.install-row",
  // Notifications (docs/study/notify.md): "הגדרות התראות" in "שלי".
  notifyRow: "a.ntf-me-row",
} as const;

const T = TARGETS;
const sel = (s: string, pick?: Target["pick"]): Target => (pick ? { sel: s, pick } : { sel: s });

/** The screens a walk names. */
const onLecture = (r: Route) => r.v === "lecture";
const onLibrary = (r: Route) => r.v === "library";
const onUpload = (r: Route) => r.v === "upload";
const onToday = (r: Route) => r.v === "today" && !r.run;
const onGroup = (r: Route) => r.v === "group";

/** "Any screen with the tab bar but this tab": the first step of a walk that starts on a tab. */
function tabbedBut(f: Flags, tab: string) {
  return (r: Route) => {
    const t = tabOf(r, f);
    return t !== null && t !== tab;
  };
}

function toLibrary(f: Flags, say: string): WalkStep {
  return { at: tabbedBut(f, "library"), place: "הספרייה", go: { v: "library" }, target: sel(T.libraryTab), say, until: "route" };
}

const LECTURE_EMPTY = "עוד אין הרצאה מוכנה. אפשר להעלות אחת.";

/** The read walk: the library, a lecture, a paragraph, its actions. `last`
 *  replaces the last step's words (a correction, an association). */
function readSteps(f: Flags, x: Facts, last: string): WalkStep[] {
  const lecture: Route = x.ready[0] ? { v: "lecture", l: x.ready[0] } : { v: "library" };
  return [
    toLibrary(f, f.today ? "הסיכומים גרים בספרייה." : "הסיכומים גרים כאן, בספרייה."),
    { at: onLibrary, place: "הספרייה", go: { v: "library" }, target: sel(T.lectureCard, "ready"), say: "נוגעים בהרצאה כדי לפתוח את הסיכום.", until: "route", empty: LECTURE_EMPTY },
    {
      at: onLecture,
      place: "ההרצאה",
      go: lecture,
      target: sel(T.paragraph, "inView"),
      say: "נוגעים בפסקה, והפעולות נפתחות מתחתיה. רק נגיעה, שום דבר לא נשלח.",
      until: "select",
      select: T.paragraphActions,
    },
    { at: onLecture, place: "ההרצאה", go: lecture, target: sel(T.paragraphActions), say: last, until: "end" },
  ];
}

/** A walk under these flags and facts; null when its feature is off or
 *  there is nothing to walk to yet (the how-to then has no "הראו לי"). */
export function walkOf(id: WalkId, f: Flags, x: Facts): Walk | null {
  const lecture: Route | null = x.ready[0] ? { v: "lecture", l: x.ready[0] } : null;
  switch (id) {
    case "read":
      return { id, title: "לקרוא הרצאה", steps: readSteps(f, x, "״תגובה או שאלה״ נראית לכל הקבוצה. שום דבר לא נשלח עד שלוחצים לשלוח.") };
    case "correct":
      return f.corrections
        ? { id, title: "לתקן טעות בסיכום", steps: readSteps(f, x, "״תיקון״ מחכה לאישור מהקבוצה, ואפשר לבטל אותו. שום דבר לא נשלח עד שלוחצים לשלוח.") }
        : null;
    case "upload":
      return {
        id,
        title: "להעלות הרצאה",
        steps: [
          toLibrary(f, "ההרצאות והעלאה בספרייה."),
          { at: onLibrary, place: "הספרייה", go: { v: "library" }, target: sel(T.uploadButton), say: "מכאן מעלים.", until: "route" },
          { at: onUpload, place: "העלאה", go: { v: "upload" }, target: sel(T.drop), say: "בוחרים pptx או PDF.", until: "select", select: T.uploadForm },
          { at: onUpload, place: "העלאה", go: { v: "upload" }, target: sel(T.uploadForm), say: "השם, המרצה והקורס הם מה שהקבוצה תראה בספרייה.", until: "next" },
          {
            at: onUpload,
            place: "העלאה",
            go: { v: "upload" },
            target: sel(T.uploadStart),
            say: x.serverWrites ? "״יצירת סיכום״: הסיכום נכתב כמה דקות, ואפשר לצאת בינתיים." : "״יצירת סיכום״: כדאי להשאיר פתוח עד שהסיכום נכתב.",
            until: "end",
            stop: "cost",
          },
        ],
      };
    case "practice": {
      if (!f.practice || !x.practiceLecture) return null;
      const l = x.practiceLecture;
      return {
        id,
        title: "לתרגל",
        steps: [
          { at: (r) => r.v === "lecture", place: "ההרצאה", go: { v: "lecture", l }, target: sel(T.practiceChip), say: "תרגול על ההרצאה הזו.", until: "route" },
          {
            at: (r) => r.v === "practice" && Boolean(r.l) && !r.s && !r.x,
            place: "התרגול של ההרצאה",
            go: { v: "practice", l },
            target: sel(T.roundLink),
            say: "״סבב חדש״: שאלות שכבר יש, בחינם.",
            until: "route",
            empty: "עוד אין שאלות להרצאה הזו. ״שאלות חדשות״ נכתבות בעזרת AI מהתקציב, אז זו החלטה של הקבוצה.",
          },
          {
            at: (r) => r.v === "practice" && r.x === "round",
            place: "סבב חדש",
            go: { v: "practice", l, x: "round" },
            target: sel(T.roundStart),
            say: "בוחרים מאיפה ומתחילים. הסבב רק שלך, ובחינם.",
            until: "route",
          },
          {
            at: (r) => r.v === "practice" && Boolean(r.s),
            place: "התרגול",
            go: { v: "practice", l },
            target: sel(T.bets),
            say: "לפני ״לבדוק״: כמה בטוחים? ׳ניחוש׳ לא נחשב טעות.",
            until: "end",
          },
        ],
      };
    }
    case "invite":
      return {
        id,
        title: "להזמין לקבוצה",
        steps: [
          toLibrary(f, "ההזמנה בספרייה."),
          { at: onLibrary, place: "הספרייה", go: { v: "library" }, target: sel(T.inviteButton), say: "שולחים לקבוצה. מי שפותחים את הקישור נכנסים ישר.", until: "click" },
        ],
      };
    case "today":
      return f.today
        ? {
            id,
            title: "להתחיל את התור",
            steps: [
              {
                at: onToday,
                place: "היום",
                go: { v: "today" },
                target: sel(T.todayStart),
                say: "כאן מתחילים. התור נחתך לפי הזמן שבחרתם, ומה שלא נכנס עובר למחר.",
                until: "route",
                empty: "התור ריק כרגע. הוא מתמלא כשמתרגלים וקוראים.",
              },
            ],
          }
        : null;
    case "group": {
      if (!f.meeting && !f.quiz) return null;
      return {
        id,
        title: "להציץ ב״יחד״",
        steps: [
          { at: tabbedBut(f, "group"), place: "יחד", go: { v: "group" }, target: sel(T.groupTab), say: "״יחד״ הוא מה שהקבוצה עושה עכשיו.", until: "route" },
          {
            at: onGroup,
            place: "יחד",
            go: { v: "group" },
            target: sel(T.nowHead),
            say: `מי מקריאים עכשיו, ו״לעקוב״. מתחת: ${andList([f.meeting && "הפגישה", f.quiz && "המבחן הקבוצתי", "השאלות הפתוחות"])}.`,
            until: "end",
          },
        ],
      };
    }
    case "cards":
      return f.cards && lecture
        ? {
            id,
            title: "לחזור על כרטיסיות",
            steps: [{ at: onLecture, place: "ההרצאה", go: lecture, target: sel(T.cardsChip), say: "״כרטיסיות״ של ההרצאה. נוגעים כדי להפוך, ומדרגים כמה קל היה.", until: "end" }],
          }
        : null;
    case "readaloud":
      return lecture
        ? {
            id,
            title: "להקריא לקבוצה",
            steps: [{ at: onLecture, place: "ההרצאה", go: lecture, target: sel(T.readAloud), say: "״להקריא לקבוצה״ מתחיל מיד אצל כולם.", until: "end", stop: "group" }],
          }
        : null;
    case "readmark":
      return lecture
        ? {
            id,
            title: "לסמן שקראתי",
            steps: [{ at: onLecture, place: "ההרצאה", go: lecture, target: sel(T.readMark), say: "״סימון שקראתי״ בסוף הסיכום. כל הקבוצה רואה מי קראו.", until: "end", stop: "group" }],
          }
        : null;
    case "quizopen":
      return f.quiz && lecture
        ? {
            id,
            title: "לפתוח מבחן קבוצתי",
            steps: [
              { at: onLecture, place: "ההרצאה", go: lecture, target: sel(T.quizChip), say: "״מבחן קבוצתי״ פותח קודם הגדרות. שום דבר עוד לא נפתח לקבוצה.", until: "route" },
              { at: (r) => r.v === "quiz" && Boolean(r.isNew), place: "מבחן חדש", go: { v: "quiz", isNew: true, l: lecture.l }, target: sel(T.quizOpen), say: "״לפתוח״ נפתח לכולם מיד.", until: "end", stop: "group" },
            ],
          }
        : null;
    case "meeting":
      return f.meeting
        ? {
            id,
            title: "לקבוע פגישה",
            steps: [
              { at: tabbedBut(f, "group"), place: "יחד", go: { v: "group" }, target: sel(T.groupTab), say: "הפגישות ב״יחד״.", until: "route" },
              {
                at: onGroup,
                place: "יחד",
                go: { v: "group" },
                target: sel(T.newMeeting),
                say: "קובעים מתי נפגשים ומה קוראים. הפגישה מופיעה אצל כל הקבוצה, ומי שלוחצים ״להקריא לקבוצה״ מקריאים.",
                until: "end",
              },
            ],
          }
        : null;
    case "ask":
      return f.ask
        ? {
            id,
            title: "לשאול את החומר",
            steps: [
              toLibrary(f, "״לשאול״ בספרייה."),
              { at: onLibrary, place: "הספרייה", go: { v: "library" }, target: sel(T.askBar), say: "חיפוש בכל ההרצאות בחינם. ״לשאול״ עונה מהשקפים ונספר ב״נשארו היום״.", until: "end" },
            ],
          }
        : null;
    case "course": {
      // The course page (docs/study/sources.md): only once the library has a course. No STOP on the way.
      if (!f.courses || x.courses === 0) return null;
      const acts = f.exams || f.practice || f.ask;
      // True with or without a past exam: a brand-new course has no simulation and often no question yet.
      const doHere = andList([f.ask && "שואלים", f.practice && "מתרגלים"]);
      return {
        id,
        title: "עמוד הקורס",
        steps: [
          toLibrary(f, "הקורסים בספרייה: כל קורס עם ההרצאות שלו."),
          {
            at: onLibrary,
            place: "הספרייה",
            go: { v: "library" },
            target: sel(T.courseLink),
            say: "נוגעים בשם הקורס.",
            until: "route",
            empty: "עוד אין קורס. קורס נוצר כשמעלים הרצאה עם שם של קורס.",
          },
          ...(acts
            ? [
                {
                  at: (r: Route) => r.v === "course",
                  place: "עמוד הקורס",
                  go: { v: "library" } as Route,
                  target: sel(T.courseExam),
                  say: "תאריך המבחן ואורכו, אחד לכל הקבוצה.",
                  until: "next" as const,
                },
              ]
            : []),
          {
            at: (r) => r.v === "course",
            place: "עמוד הקורס",
            go: { v: "library" },
            target: sel(acts ? T.courseActions : T.courseExam),
            say: f.exams
              ? `${doHere ? `כאן ${doHere} על כל הקורס. ` : ""}״סימולציה״ מופיעה כאן כשיש מבחן קודם מוכן, ב״מבחנים קודמים״ למטה.`
              : acts
                ? `כאן ${doHere} על כל הקורס.`
                : "כאן תאריך המבחן, וההרצאות של הקורס למטה.",
            until: "end",
            empty: f.practice ? "עוד אין כאן מה לתרגל. מתחילים בהרצאות שלמטה." : "עוד אין כאן כלום. מתחילים בהרצאות שלמטה.",
          },
        ],
      };
    }
    case "install":
      // Adding the app to the home screen (docs/study/install.md): its row in "שלי". No STOP: nothing there is seen or paid.
      return f.install
        ? {
            id,
            title: "להוסיף למסך הבית",
            steps: [
              { at: tabbedBut(f, "me"), place: "שלי", go: { v: "me" }, target: sel(T.meTab), say: "ההוספה למסך הבית נמצאת ב״שלי״.", until: "route" },
              {
                at: (r) => r.v === "me",
                place: "שלי",
                go: { v: "me" },
                target: sel(T.installRow),
                say: "כאן. ההסבר מותאם לטלפון שלך.",
                until: "click",
                empty: "כאן אין מה להוסיף: תמצית כבר פתוחה מהאייקון, או שהדפדפן הזה לא מציע התקנה.",
              },
            ],
          }
        : null;
    case "notify":
      // Notifications (docs/study/notify.md): "הגדרות התראות" in "שלי". No STOP: turning them on is the member's own.
      return f.notify
        ? {
            id,
            title: "לקבל התראות",
            steps: [
              { at: tabbedBut(f, "me"), place: "שלי", go: { v: "me" }, target: sel(T.meTab), say: "ההתראות נמצאות ב״שלי״.", until: "route" },
              {
                at: (r) => r.v === "me",
                place: "שלי",
                go: { v: "me" },
                target: sel(T.notifyRow),
                say: "כאן בוחרים מה מקבלים, ומפעילים במכשיר הזה.",
                until: "click",
                empty: "כאן אין עדיין הגדרות התראות: הן יופיעו כשההתראות יגיעו לקבוצה.",
              },
            ],
          }
        : null;
  }
}

/* ─────────────────────────── "?" on each screen ─────────────────────────── */

export type MiniStep = { target: Target; say: string };
export type MiniGuide = { screen: string; steps: MiniStep[]; /** the last step's extra: "לנסות שאלה לדוגמה" */ tryIt?: Route };

/** A screen's mini-guide; null when the screen has none. Steps whose
 *  element is not on the page are skipped when it runs. */
export function screenGuide(r: Route, f: Flags): MiniGuide | null {
  const m = (target: string, say: string, pick?: Target["pick"]): MiniStep => ({ target: sel(target, pick), say });
  if (!miniScreen(r as MiniRoute, f)) return null;
  switch (r.v) {
    case "today":
      return {
        screen: "היום",
        steps: [
          m(T.todayMinutes, "בוחרים כמה זמן יש היום, והתור נחתך בהתאם. התור גלוי רק לך."),
          m(T.todayQueue, "התור שלי: מה כדאי לחזור עליו עכשיו. כשהוא ריק, הוא מתמלא כשמתרגלים וקוראים."),
          ...(f.meeting ? [m(T.meetingBand, "הפגישה של היום: מתי ומה קוראים.")] : []),
          m(
            T.libraryTab,
            f.courses ? `ההרצאות בספרייה, לפי קורס. בעמוד של כל קורס: תאריך המבחן${f.exams ? ", מבחנים קודמים וסימולציה." : "."}` : "ההרצאות עצמן בספרייה.",
          ),
        ],
      };
    case "library":
      return {
        screen: "הספרייה",
        steps: [
          m(T.libraryCards, "כל הרצאה מסוכמת פעם אחת לכל הקבוצה. נוגעים כדי לקרוא, או מעלים מצגת ותוך כמה דקות יש סיכום."),
          ...(f.courses
            ? [
                m(
                  T.courseLink,
                  f.exams
                    ? "נוגעים בשם הקורס לעמוד שלו: תאריך המבחן, מבחנים קודמים, סימולציה ותרגול של כל הקורס."
                    : f.practice
                      ? "נוגעים בשם הקורס לעמוד שלו: תאריך המבחן ותרגול של כל הקורס."
                      : "נוגעים בשם הקורס לעמוד שלו: תאריך המבחן וכל ההרצאות שלו.",
                ),
              ]
            : []),
          ...(f.questions || f.cards || f.corrections ? [m(T.lectureChips, `מתחת להרצאה: ${andList([f.questions && "התרגול", f.cards && "הכרטיסיות", f.corrections && "התיקונים"])} שלה.`)] : []),
          ...(f.ask ? [m(T.askBar, "חיפוש בכל ההרצאות בחינם. ״לשאול״ עונה מהשקפים ונספר ב״נשארו היום״.")] : []),
          m(T.libActions, "״הזמנה לקבוצה״ שולח קישור. נכנסים בלי סיסמה, רק עם שם."),
        ],
      };
    case "lecture":
      return {
        screen: "ההרצאה",
        steps: [
          m(T.headTools, "׳תוכן׳ קופץ לחלק, ׳א-׳ ו׳א+׳ משנים את גודל הטקסט, רק אצלך."),
          m(T.paragraph, `נוגעים בפסקה: ${paragraphActions(f)}.`, "inView"),
          ...(f.anchor ? [m(T.chipRow, "הצ׳יפים מתחת לפסקה: שאלות, כרטיסיות ותגובות שכבר קשורות אליה.")] : []),
          m(T.roomBar, "רואים מי בהרצאה. ״להקריא לקבוצה״ מתחיל מיד אצל כולם, אז רק כשבאמת מקריאים."),
        ],
      };
    case "upload":
      // "העלאה של כמה קבצים": its own words, never the single upload's "יצירת סיכום".
      if (r.many)
        return {
          screen: "העלאה של כמה קבצים",
          steps: [
            m(T.batchResume, "ההעלאה נעצרה? בוחרים שוב את אותם קבצים, ומה שכבר עלה מדלגים עליו."),
            m(T.batchCourse, "הקורס שאליו נכנסים כל הקבצים."),
            m(T.drop, "בוחרים עד 30 מצגות או PDF. כל קובץ נהיה הרצאה, בשם של הקובץ."),
            m(T.batchCost, "המחיר מראש: כמה יעלו הסיכומים ומה נשאר החודש. מה שלא נכנס מחכה לחודש הבא."),
            m(T.uploadStart, "״העלאה״ מעלה את כל הקבצים לקבוצה. כדאי להשאיר את המסך פתוח עד שכל הקבצים עולים. הסיכומים נכתבים מהתקציב החודשי."),
            // While the files go up, and once they are up: the progress card (the steps above are gone then).
            m(T.batchProgress, "כאן רואים כמה קבצים כבר עלו. עד שכולם עולים, כדאי להשאיר את המסך פתוח. הסיכומים נכתבים לכל הקבוצה."),
          ],
        };
      return {
        screen: "העלאה",
        steps: [
          m(T.drop, "בוחרים pptx או PDF."),
          ...(f.courses ? [m(T.uploadMany, "יש כמה מצגות של אותו קורס? ״העלאה של כמה קבצים״ מעלה עד 30 יחד, עם המחיר מראש.")] : []),
          m(T.uploadForm, "השם, המרצה והקורס הם מה שהקבוצה תראה בספרייה."),
          m(T.uploadStart, "״יצירת סיכום״ כותב את הסיכום לכל הקבוצה, מהתקציב החודשי."),
        ],
      };
    case "practice":
      if (r.l)
        return {
          screen: "התרגול של ההרצאה",
          steps: [
            ...(f.practice ? [m(T.roundLink, "״סבב חדש״: שאלות שכבר יש, בחינם.")] : []),
            m(T.practiceMore, "״שאלות חדשות״ נכתבות בעזרת AI לכל הקבוצה, ונספרות בתקציב החודשי."),
            m(T.practiceEmptyMore, "עוד אין כאן שאלות. ״שאלות חדשות״ נכתבות בעזרת AI לכל הקבוצה, ונספרות בתקציב החודשי."),
          ],
          tryIt: f.practice ? { v: "try", s: "b" } : undefined,
        };
      return {
        screen: "תרגול",
        steps: [
          m(T.practiceLead, "התשובות והציונים כאן רק לך."),
          m(T.practiceRow, f.exams ? "בוחרים הרצאה או קורס שלם. מבחנים קודמים וסימולציה נמצאים בעמוד הקורס, בספרייה." : "בוחרים הרצאה או קורס שלם."),
        ],
        tryIt: f.practice ? { v: "try", s: "b" } : undefined,
      };
    case "group":
      return {
        screen: "יחד",
        steps: [
          m(T.nowHead, "מי מקריאים עכשיו, ו״לעקוב״."),
          ...(f.meeting ? [m(T.meetingCard, "קובעים פגישה, ובה שאלות פתיחה, סדר יום והקראה.")] : []),
          ...(f.quiz ? [m(T.quizCard, "׳כולנו נגד המבחן׳: בלי נקודות אישיות, ו-80% זה ׳עברנו׳.")] : []),
          ...(f.pulse ? [m(T.pulseCard, "מה קשה לקבוצה: הנושאים שהכי מכשילים עכשיו, בלי שמות.")] : []),
          ...(f.boss ? [m(T.bossCard, "אתגר קבוצתי: כל הקבוצה ביחד מול הנושאים שהכי מכשילים אותה.")] : []),
          ...(f.museum ? [m(T.museumCard, "טעויות נפוצות: התשובות השגויות שהכי הרבה בחרו, בלי שמות.")] : []),
        ],
      };
    case "wall":
      return {
        screen: "קיר האסוציאציות",
        steps: [m(T.wallTabs, "הכי טובות, חדשות, ושלי."), m(T.wallFoot, "״תנו לי 3 מצחיקות״ מציע טיוטות בעזרת AI, עד 5 ביום, ונספר בתקציב.")],
      };
    case "me":
      return {
        screen: "שלי",
        steps: [m(T.guideRows, "״מדריך לאפליקציה״: הסיור הקצר, הצעדים הראשונים והטיפים."), m(T.settings, "״א-״ ו״א+״ משנים את גודל הטקסט, רק במכשיר הזה.")],
      };
    case "course":
      return {
        screen: "עמוד הקורס",
        steps: [
          m(T.courseExam, "תאריך המבחן ואורכו, אחד לכל הקבוצה. ״להוסיף תאריך״ או ״לשנות״ משנים אותם לכולם."),
          ...(f.exams
            ? [
                m(T.courseSim, "״סימולציה״: מבחן קודם עם שעון, כמו במבחן האמיתי. בחינם, והציון רק לך."),
                m(T.courseReplay, "״לתרגל מבחן קודם״: אותו מבחן בלי שעון, בסדר המקורי. בחינם, והתשובות רק לך."),
              ]
            : []),
          ...(f.practice
            ? [
                m(
                  T.courseFree,
                  f.exams
                    ? "״לתרגל מה שכבר יש״: כל השאלות של ההרצאות והמבחנים הקודמים בקורס, בחינם. התשובות רק לך."
                    : "״לתרגל מה שכבר יש״: כל השאלות של ההרצאות בקורס, בחינם. התשובות רק לך.",
                ),
              ]
            : []),
          ...(f.ask ? [m(T.courseAsk, "״לשאול על כל הקורס״ עונה מהסיכומים של כל ההרצאות, עם הרצאה ושקף. כל שאלה נספרת ב״נשארו היום״ ובתקציב החודשי של הקבוצה.")] : []),
          ...(f.exams ? [m(T.courseSeg, "״מבחנים קודמים״: מעלים מבחן משנים קודמות, והשאלות שלו נכנסות לתרגול ולסימולציה של כל הקבוצה.")] : []),
          m(T.courseMany, "״העלאה של כמה קבצים״: עד 30 מצגות לקורס בבת אחת, עם המחיר מראש."),
          m(T.courseMenu, "⋯ הוא ״הגדרות הקורס״: לשנות את השם, או לאחד שני קורסים שהם אותו קורס. מה שמשנים שם משתנה לכל הקבוצה."),
        ],
      };
    case "exams":
      // Decision 1 (sources.md): the upload says nothing about where the exam goes.
      // The upload is on screen only with its course (ExamsScreen: isNew and c); miniScreen says the same.
      if (r.isNew && r.c && !r.e && f.sheets)
        return {
          screen: "העלאת מבחן או דף תרגילים",
          steps: [
            m(T.sheetZone, "קובץ PDF, או צילום של הדפים: עמוד אחד בכל תמונה, ישר ובאור טוב. במחשב אפשר גם לגרור לכאן קבצים, או להדביק. קובץ Word צריך קודם לשמור כ-PDF."),
            m(T.sheetPages, "הדפים לפי הסדר: מזיזים, מסובבים או מסירים. דף מטושטש או חשוך מסומן, ו״לצלם שוב״ מחליף אותו."),
            m(T.sheetKinds, "מבחן קודם (עם שנה ומועד, גם לסימולציה), או דף תרגילים (עם שם והרצאה, לא חובה). מאגר שאלות הוא דף תרגילים בלי הרצאה."),
            m(T.examKeys, "איפה התשובות: מסומנות על הדף, בקובץ נפרד, או אין. בלי תשובות, האפליקציה מציעה תשובה לרוב השאלות, והקבוצה בודקת אותן. זה עולה קצת יותר."),
            m(T.examGo, "המחיר על הכפתור, ומתחתיו כמה עמודים וכמה זמן זה לוקח. נספר בתקציב החודשי של הקבוצה. מעלים רק חומר מצוות הקורס או חומר של הקבוצה."),
          ],
        };
      if (r.isNew && r.c && !r.e)
        return {
          screen: "העלאת מבחן קודם",
          steps: [
            m(T.examMode, "קובץ PDF, או צילום של הדפים: עמוד אחד בכל תמונה, ישר ובאור טוב."),
            m(T.examKeys, "איפה התשובות: מסומנות על הדפים, בקובץ נפרד, או אין. בלי תשובות, האפליקציה מציעה תשובה לרוב השאלות, והקבוצה בודקת אותן. זה עולה קצת יותר."),
            m(T.examGo, "אחרי שבוחרים קובץ או דפים, המחיר מופיע על הכפתור, ונספר בתקציב החודשי של הקבוצה. עד 3 מבחנים ביום, לכל מי שבקבוצה בנפרד."),
          ],
        };
      // One exam: an upload that stopped, an error, its reading, then its review.
      // Each step is skipped when its element is not on screen (no simulation under 5 questions or without its course).
      return {
        screen: "מבחן קודם",
        steps: [
          m(T.examStalled, "ההעלאה נעצרה לפני שכל הדפים עלו. מעלים את המבחן שוב מעמוד הקורס."),
          m(T.examError, "כאן כתוב מה לא הצליח. מעמוד הקורס אפשר להעלות את המבחן שוב."),
          m(T.examProg, "כאן רואים כמה מהדפים כבר הועתקו. בסוף יופיע כאן כמה שאלות נמצאו."),
          m(T.examUnits, "כל שורה היא כמה דפים. דפים שלא נקראו: ״לנסות שוב״, מהתקציב החודשי של הקבוצה."),
          m(T.examSum, "״לתרגל את המבחן״: השאלות שיש להן תשובה, בסדר של המבחן. בחינם, והתשובות רק לך."),
          m(T.examSim, "״סימולציה מהמבחן״: אותו מבחן עם שעון. בחינם, והציון רק לך."),
          m(T.examFilters, "״לבדיקה״: שאלות שלא נקראו טוב, בלי תשובה, או עם תשובה מוצעת שעוד לא נבדקה. נוגעים בשאלה כדי לבדוק אותה מול הדף."),
          m(T.examSuggested, "״תשובה מוצעת״: האפליקציה פתרה, ועוד לא בדקו. פותחים שאלה, ו״לאשר״ אם התשובה נכונה."),
          m(T.examNokey, "״בלי תשובה״: אין תשובה, גם לא מוצעת, אז השאלה לא בתרגול. מסמנים לה תשובה ב״לסמן תשובה״."),
          m(T.examActs, "סימון או אישור של תשובה משנה אותה לכל הקבוצה, עם השם שלך. אפשר לבטל."),
          ...(f.sheets
            ? [m(T.sheetSplit, "העמוד עצמו, ליד ההעתקה. נוגעים באיור כדי לפתוח את השאלה שלו. חצים למעלה ולמטה עוברים בין השאלות, ו-E פותח ״לתקן טקסט״.")]
            : []),
        ],
      };
    case "mock":
      return {
        screen: "סימולציה",
        steps: [
          m(T.simOpen, "סימולציה שעוד לא הוגשה: השעון שלה ממשיך לרוץ. ״להמשיך״ חוזר אליה."),
          m(T.simSource, "בוחרים מבחן קודם. השאלות והתשובות כמו שהיו בו."),
          m(T.simLength, "מלא, וגם קצר (20 שאלות) וחצי (50) כשהמבחן ארוך מזה. הזמן לפי הקצב של המבחן."),
          m(T.simUnseen, "קודם שאלות שעוד לא עניתם עליהן, בתרגול או בסימולציה קודמת."),
          m(T.simStart, "״להתחיל״ מפעיל את השעון מיד, והוא ממשיך גם כשיוצאים מהמסך או נועלים את הטלפון. בחינם, והציון רק לך."),
          m(T.simEmpty, "סימולציה נבנית ממבחן קודם של הקורס. מכאן מעלים אחד."),
        ],
      };
    case "ask":
      // The course's own question ("לשאול על כל הקורס"); the library's has no mini-guide.
      return {
        screen: "לשאול על כל הקורס",
        steps: [
          m(T.caComposer, "כותבים שאלה על החומר של כל הקורס. כל שאלה נספרת ב״נשארו היום״ ובתקציב החודשי של הקבוצה."),
          m(T.caSources, "המקורות פותחים את הפסקה בהרצאה, כדי לבדוק את התשובה מול הסיכום."),
          m(T.caLeft, "השיחה רק במכשיר הזה, ונשמרת 14 יום. הקבוצה לא רואה אותה."),
        ],
      };
    default:
      return null;
  }
}

/** The app tour ("סיור קצר באפליקציה"): the tab bar, one tab at a time, then
 *  the screen's "?". It runs on any screen with the tab bar (the home's
 *  offer, "שלי", help) and, like a mini-guide, only points: a tab it rings
 *  works as always, and leaving the screen ends the tour. Steps whose
 *  element is not on the page (no "תרגול" tab with Today on, no "?" on help)
 *  are skipped when it runs. */
export function appTour(f: Flags, x: { codes?: boolean } = {}): MiniGuide {
  const m = (target: string, say: string): MiniStep => ({ target: sel(target), say });
  // A new group's first need is the upload: it stays in the line with the course pages too.
  const library = f.courses
    ? `בספרייה כל ההרצאות, מסוכמות, לפי קורס. מעלים מצגת או PDF ותוך כמה דקות יש סיכום לכולם. שם הקורס פותח את העמוד שלו${f.exams ? ", עם מבחנים קודמים." : "."}`
    : "בספרייה כל ההרצאות של הקבוצה, מסוכמות. מעלים מצגת או PDF, ותוך כמה דקות יש סיכום לכולם.";
  // "תרגול" is a tab only without Today (with Today its screens are under "היום").
  const practice = f.today ? "" : f.questions ? `בתרגול: ${andList(["שאלות", f.cards && "כרטיסיות"])} לכל הרצאה. התשובות גלויות רק לך.` : f.cards ? "כאן הכרטיסיות של כל הרצאה." : "";
  return {
    screen: COPY.tourTitle,
    steps: [
      ...(f.today ? [m(T.todayTab, "״היום״ הוא מסך הבית: מה כדאי לחזור עליו עכשיו, לפי הזמן שיש.")] : []),
      m(T.libraryTab, library),
      ...(practice ? [m(T.practiceTab, practice)] : []),
      m(T.groupTab, `ב״יחד״: ${andList(["מי מקריאים עכשיו", f.meeting && "הפגישה הבאה", f.quiz && "מבחן קבוצתי", "שאלות פתוחות"])}.`),
      m(T.meTab, `ב״שלי״: ${andList([x.codes === true && "הקוד האישי", f.progress && "ההתקדמות שלך", "גודל הטקסט", "העזרה"])}. שם גם ״מדריך לאפליקציה״, אם רוצים את הסיור שוב.`),
      m(T.screenHelp, "״?״ למעלה מסביר את המסך שפתוח. בהרצאה זה ״איך קוראים כאן?״."),
    ],
  };
}

/* ─────────────────────────── "איך עושים…?" ─────────────────────────── */

export type HowTo = {
  key: string;
  title: string;
  answer: string;
  /** More words a member might type. */
  words: string;
  walk?: WalkId;
  /** A button that opens a route instead of a walk ("לנסות"). */
  open?: { label: string; route: Route };
};

/** The how-tos under these flags, in order (the first six are "שאלות נפוצות").
 *  `codes`: the server offers the personal code (health's "codes"). */
export function howTos(f: Flags, x: { codes?: boolean } = {}): HowTo[] {
  const list: Array<HowTo & { on: boolean }> = [
    { on: true, key: "read", title: "לקרוא הרצאה", answer: "בספרייה נוגעים בהרצאה. כל פסקה נפתחת בנגיעה.", words: "סיכום קריאה לפתוח הרצאה", walk: "read" },
    { on: true, key: "upload", title: "להעלות הרצאה", answer: "ספרייה ← ״העלאת הרצאה״. pptx או PDF, והסיכום מוכן תוך כמה דקות.", words: "העלאה מצגת קובץ פאוורפוינט pptx pdf סיכום חדש", walk: "upload" },
    { on: true, key: "invite", title: "להזמין לקבוצה", answer: "ספרייה או שלי ← ״הזמנה לקבוצה״. נכנסים עם שם, בלי סיסמה.", words: "קישור קוד וואטסאפ חברים להצטרף", walk: "invite" },
    { on: true, key: "comment", title: "לשאול את הקבוצה על פסקה", answer: "נוגעים בפסקה ← ״תגובה או שאלה״. כל הקבוצה רואה.", words: "תגובה שאלה הערה פסקה", walk: "read" },
    { on: f.questions, key: "practice", title: "לתרגל", answer: f.practice ? "בהרצאה ← ״תרגול״ ← ״סבב חדש״. התשובות רק לך." : "בהרצאה ← ״תרגול״. התשובות רק לך.", words: "שאלות אמריקאיות מבחן תרגול", walk: "practice" },
    {
      on: f.practice,
      key: "bet",
      title: "מה זה ״על בטוח״",
      answer: "אחרי שבוחרים תשובה מהמרים כמה בטוחים. ככה רואים איפה הביטחון מטעה.",
      words: "כמה בטוחים ביטחון ניחוש נראה לי הימור",
      open: { label: "לנסות", route: { v: "try", s: "b" } },
    },
    { on: f.cards, key: "cards", title: "לחזור על כרטיסיות", answer: "בהרצאה ← ״כרטיסיות״. נוגעים כדי להפוך, ומדרגים כמה קל היה.", words: "כרטיסים anki חזרה", walk: "cards" },
    { on: true, key: "follow", title: "לעקוב אחרי ההקראה", answer: "כשמקריאים בקבוצה מופיע למעלה פס עם ״לעקוב״. גלילה עצמאית עוצרת את המעקב.", words: "מעקב הקראה ביחד" },
    { on: true, key: "readaloud", title: "להקריא לקבוצה", answer: "בהרצאה ← ״להקריא לקבוצה״. מתחיל מיד אצל כולם.", words: "הקראה להקריא ביחד", walk: "readaloud" },
    { on: f.corrections, key: "correct", title: "לתקן טעות בסיכום", answer: "נוגעים בפסקה ← ״תיקון״. התיקון מחכה לאישור מהקבוצה, ואפשר לבטל.", words: "טעות תיקון שגיאה", walk: "correct" },
    { on: f.quiz, key: "quiz", title: "לפתוח מבחן קבוצתי", answer: "בהרצאה ← ״מבחן קבוצתי״. נפתח לכולם רק כשלוחצים לפתוח.", words: "מבחן קבוצתי חידון ביחד", walk: "quizopen" },
    { on: f.meeting, key: "meeting", title: "לקבוע פגישה", answer: "יחד ← ״לקבוע פגישה״: מתי ומה קוראים. מי שלוחצים ״להקריא לקבוצה״ מקריאים.", words: "פגישה מפגש זום", walk: "meeting" },
    { on: f.ask, key: "ask", title: "לשאול את החומר", answer: "בספרייה כותבים בשורת החיפוש. ״לשאול״ עונה מהשקפים ונספר ב״נשארו היום״.", words: "חיפוש לחפש שאלה בינה", walk: "ask" },
    { on: f.today, key: "today", title: "התור של היום", answer: "היום ← בוחרים 10, 20 או 45 דקות ← ״להתחיל״. מה שלא נכנס עובר למחר.", words: "תור חזרה היום דקות", walk: "today" },
    { on: true, key: "readmark", title: "לסמן שקראתי", answer: "בסוף הסיכום ״סימון שקראתי״. כל הקבוצה רואה מי קראו.", words: "קראתי סימון קריאה", walk: "readmark" },
    {
      // The personal code (docs/study/personal-code.md), after "readmark" so the first six stay.
      on: x.codes === true,
      key: "code",
      title: "להיכנס מטלפון אחר",
      answer: "בכניסה ← ״כניסה עם הקוד האישי״, או נוגעים בקישור השמור. הקוד ב״שלי״.",
      words: "קוד אישי טלפון חדש מכשיר אחר דפדפן התנתקתי נמחק התחברות חשבון סיסמה מסך הבית",
    },
    {
      // Adding the app to the home screen (docs/study/install.md), after "code" so the first six stay.
      on: f.install,
      key: "install",
      title: "להוסיף את תמצית למסך הבית",
      answer: installHowTo(),
      words: "התקנה להתקין אייקון מסך הבית להוריד אפליקציה אייפון אנדרואיד ספארי כרום קיצור",
      open: { label: "להוסיף למסך הבית", route: { v: "install" } },
    },
    {
      // Notifications (docs/study/notify.md), after "install" so the first six stay.
      on: f.notify,
      key: "notify",
      title: "להפעיל התראות",
      answer: "שלי ← ״הגדרות התראות״ ← ״להפעיל התראות במכשיר הזה״. באייפון רק כשפותחים את תמצית מהאייקון במסך הבית.",
      words: "התראה התראות פעמון הודעה נוטיפיקציה להודיע תזכורת שקט לילה שבת",
      open: { label: "להגדרות ההתראות", route: { v: "notify", x: "set" } },
      walk: "notify",
    },
    { on: f.wall, key: "wall", title: "לכתוב אסוציאציה", answer: "נוגעים בפסקה ← ״אסוציאציה״, או ביחד ← ״קיר האסוציאציות״.", words: "אסוציאציה זכירה מצחיק קיר" },
    {
      on: f.courses,
      key: "course",
      title: "עמוד של קורס",
      answer: `בספרייה נוגעים בשם הקורס. בעמוד הקורס: ${andList(["תאריך המבחן ואורכו (״להוסיף תאריך״)", "כל ההרצאות שלו", f.practice && "תרגול של כל הקורס", f.ask && "שאלה על כל הקורס"])}.${f.exams ? " גם מבחנים קודמים וסימולציה." : ""}`,
      words: "קורס בלוק מבחן תאריך אורך שאלות דקות עמוד להוסיף לקבוע מתי",
      walk: "course",
    },
    {
      on: f.courses,
      key: "uploadmany",
      title: "להעלות כמה הרצאות יחד",
      answer: "בעמוד הקורס ← ״העלאה של כמה קבצים״. עד 30 קבצים, וכל קובץ נהיה הרצאה בשם של הקובץ. המחיר מופיע לפני ההעלאה.",
      words: "העלאה להעלות כמה קבצים הרבה מצגות יחד קורס שלם מחיר עולה כמה עולה תקציב",
    },
    {
      on: f.courses && f.practice,
      key: "coursepractice",
      title: "לתרגל את כל הקורס",
      answer: `בעמוד הקורס ← ״לתרגל מה שכבר יש״: השאלות של כל ההרצאות${f.exams ? " והמבחנים הקודמים" : ""} בקורס, בחינם. התשובות רק לך.`,
      words: "תרגול קורס שאלות כל ההרצאות בחינם בלוק",
      walk: "course",
    },
    {
      on: f.courses && f.ask,
      key: "courseask",
      title: "לשאול על כל הקורס",
      answer: "בעמוד הקורס ← ״לשאול על כל הקורס״. התשובה מהסיכומים של כל ההרצאות, עם הרצאה ושקף, ונספרת ב״נשארו היום״.",
      words: "שאלה קורס כל ההרצאות בינה בלוק",
      walk: "course",
    },
    {
      on: f.courses,
      key: "coursename",
      title: "לשנות שם של קורס או לאחד קורסים",
      answer: "בעמוד הקורס ← ⋯ ״הגדרות הקורס״. השם משתנה בכל ההרצאות, ואיחוד מעביר את כולן לקורס האחר. זה לכל הקבוצה, ואיחוד אי אפשר לבטל.",
      words: "שם קורס לאחד איחוד כפול פעמיים טעות הגדרות לשנות",
    },
    {
      on: f.courses,
      key: "uploadstopped",
      title: "ההעלאה נעצרה באמצע",
      answer: "נעצרה באמצע? בוחרים שוב את אותם קבצים, ומה שכבר עלה מדלגים עליו. מה שלא נכנס בתקציב מחכה לחודש הבא.",
      words: "העלאה נעצרה להמשיך נתקעה חודש הבא תקציב ממתינה ממתין לכתיבה מחכה",
    },
    {
      on: f.exams,
      key: "examupload",
      title: "להעלות מבחן קודם",
      answer: "ספרייה ← נוגעים בשם הקורס ← ״מבחנים קודמים״ ← ״העלאת מבחן קודם״. PDF או צילום של הדפים. המחיר על הכפתור, מהתקציב החודשי.",
      words: "להעלות העלאה מעלים מעלה מבחן מבחנים קודמים קודם ישנים שנים קודמות שנה שעברה מועד pdf צילום לצלם דפים סריקה תשובות דף תשובות",
      walk: "course",
    },
    {
      on: f.exams,
      key: "examcheck",
      title: "לאשר תשובה במבחן קודם",
      answer: "במבחן ← ״לבדיקה״ ← נוגעים בשאלה ← ״לאשר״ או ״לסמן תשובה אחרת״. התשובה משתנה לכל הקבוצה, עם השם שלך, ואפשר לבטל.",
      words: "לאשר אישור תשובה מוצעת לא נבדקה בדיקה לבדוק אחרת טעות שגויה שגוי נכונה מפתח לתקן טקסט לא נקראה טוב",
    },
    {
      on: f.exams,
      key: "examreplay",
      title: "לתרגל מבחן קודם",
      answer: "בעמוד הקורס ״לתרגל מבחן קודם״, או בתוך המבחן ״לתרגל את המבחן״. השאלות בסדר של המבחן, בלי שעון. בחינם, והתשובות רק לך.",
      words: "לתרגל תרגול מבחן מבחנים קודמים קודם שנים קודמות מועד לפתור",
      walk: "course",
    },
    {
      on: f.exams,
      key: "sim",
      title: "סימולציה של מבחן",
      answer: "בעמוד הקורס ← ״סימולציה״. מבחן קודם עם שעון אחד שלא עוצר, גם כשיוצאים. כשהזמן נגמר היא מוגשת לבד. בחינם, והציון רק לך.",
      words: "סימולציה סימולציות סימולציית מבחן אמיתי דמה שעון זמן להגיש הגשה לסמן לחזרה מפת השאלות מבחנים קודמים",
      walk: "course",
    },
    {
      on: f.qtypes,
      key: "qtypes",
      title: "איך עונים על סוגי השאלות",
      answer: `נכון / לא נכון: מסמנים כל משפט. התאמה: נוגעים במקום ואז בתשובה. סידור: נוגעים בשלבים מהראשון לאחרון.${f.practice ? " בוחרים סוג ב״סבב חדש״ ← ״סוג שאלה״." : ""}`,
      words: "נכון לא נכון התאמה סידור סדר שלבים סוגי שאלות סוג שאלה איפה",
    },
    {
      on: f.qtypes,
      key: "qimage",
      title: "שאלה על תמונה ומקרה בשלבים",
      answer: "סימון על תמונה: בוחרים מה מסומן במספר, או נוגעים במספר שבשרטוט. מקרה בשלבים: כל שלב הוא שאלה, והמקרה ממשיך.",
      words: "תמונה שרטוט סימון מספר מקרה קליני שלבים",
    },
    {
      on: true,
      key: "cost",
      title: "מה עולה מהתקציב",
      answer: `מהתקציב החודשי של הקבוצה: ${andList(["סיכום של הרצאה", f.questions && "״שאלות חדשות״", f.exams && "העלאת מבחן קודם", f.ask && "״לשאול״"])}. בחינם: ${andList(["קריאה", f.ask && "חיפוש", f.questions && "תרגול", f.exams && "סימולציה"])}. בהעלאה, המחיר מופיע לפני שמתחילים.`,
      words: "כמה עולה מחיר כסף תקציב חינם בחינם עלות דולר",
    },
    { on: f.progress, key: "progress", title: "לראות את ההתקדמות שלי", answer: "שלי ← ״ההתקדמות שלי״. גלוי רק לך.", words: "התקדמות ציונים טעויות" },
    { on: true, key: "size", title: "להגדיל את הטקסט", answer: "בהרצאה ׳א+׳, או שלי ← ״גודל הטקסט״. רק במכשיר הזה.", words: "גודל גופן טקסט קטן גדול" },
    { on: true, key: "try", title: "לנסות בלי לחץ", answer: "פסקה ושאלה לדוגמה. שום דבר לא נשמר ולא נשלח.", words: "ניסיון דוגמה לנסות", open: { label: "לנסות", route: { v: "try" } } },
  ];
  return list.filter((h) => h.on).map(({ on: _on, ...h }) => h);
}

/** A word as the search compares it: no niqqud or geresh, final letters
 *  folded, lower case. */
export function foldWord(w: string): string {
  return w
    .normalize("NFC")
    .replace(/[֑-ׇ]/g, "")
    .replace(/[״׳"'`.,:;!?()\-–—←]/g, "")
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ")
    .toLowerCase();
}

const PREFIX = /^[והבלמש]/;

/** A word and the word without one or two leading ו/ה/ב/ל/מ/ש ("לתרגל" also
 *  as "תרגל"; "מהשנים" also as "שנים"). */
export function wordForms(w: string): string[] {
  const f = foldWord(w);
  if (!f) return [];
  if (!(f.length > 3 && PREFIX.test(f))) return [f];
  const one = f.slice(1);
  return one.length > 3 && PREFIX.test(one) ? [f, one, one.slice(1)] : [f, one];
}

/** Words a question is asked with, that say nothing of what is asked
 *  ("איך מעלים מבחן", "כמה זה עולה"): left out of the query unless it is only them. */
const ASKING = new Set(["איכ", "מה", "זה", "של", "את", "לעשות", "אפשר", "רוצה", "רוצים"]);

const words = (s: string) => s.split(/\s+/).flatMap(wordForms);

/** Whether a text matches the query: every word of the query starts a word
 *  of the text (in either form). An empty query matches everything. */
export function matches(query: string, text: string): boolean {
  const all = query.split(/\s+/).map((w) => wordForms(w)).filter((f) => f.length);
  const meant = all.filter((forms) => !ASKING.has(forms[0]));
  const q = meant.length ? meant : all;
  if (!q.length) return true;
  const hay = words(text);
  return q.every((forms) => forms.some((qf) => qf.length >= 2 && hay.some((h) => h.startsWith(qf))));
}

export function searchHowTos(query: string, list: HowTo[]): HowTo[] {
  if (!query.trim()) return list.slice(0, 6);
  return list.filter((h) => matches(query, `${h.title} ${h.words} ${h.answer}`));
}

export const NO_HITS = "לא מצאנו. אפשר לנסות מילה אחרת, או לשאול בקבוצה.";
export const ROWS_ONLY = "אין תשובה קצרה. ההסבר המלא למטה, ב״כל ההסברים״.";

/** The search's status line: how many short answers, or, with none, whether
 *  help's own rows below ("כל ההסברים") found it. */
export function hitsLine(hits: number, rows: number): string {
  if (hits === 1) return "תשובה אחת";
  if (hits > 1) return `${hits} תשובות`;
  return rows > 0 ? ROWS_ONLY : NO_HITS;
}

/* ─────────────────────────── "חדש" ─────────────────────────── */

export type Hint = { flag: keyof Flags; title: string; say: string; walk?: WalkId; go?: Route };

/** One line for each feature a member may meet after it is turned on. */
export const HINTS: Hint[] = [
  { flag: "today", title: "היום", say: "המסך הראשון הוא עכשיו ״היום״: התור שלי לפי הזמן שיש.", go: { v: "today" } },
  { flag: "practice", title: "תרגול", say: "אפשר לתרגל כל הרצאה, ולסמן כמה בטוחים בכל תשובה. התשובות רק לך.", go: { v: "try", s: "b" } },
  { flag: "cards", title: "כרטיסיות", say: "לכל הרצאה יש כרטיסיות לחזרה.", walk: "cards" },
  { flag: "quiz", title: "מבחן קבוצתי", say: "״כולנו נגד המבחן״: מבחן לכל הקבוצה, בלי נקודות אישיות.", walk: "quizopen" },
  { flag: "meeting", title: "הפגישה היומית", say: "קובעים ב״יחד״ פגישה: מתי ומה קוראים.", walk: "meeting" },
  { flag: "anchor", title: "מה יושב על הפסקה", say: "מתחת לכל פסקה רואים את השאלות, הכרטיסיות והתגובות שלה.", walk: "read" },
  { flag: "corrections", title: "תיקון בסיכום", say: "מצאתם טעות? נוגעים בפסקה ← ״תיקון״.", walk: "correct" },
  { flag: "var", title: "מחלוקות", say: "על תיקון שלא מסכימים עליו אפשר לפתוח מחלוקת ולבדוק אותה מול השקפים.", go: { v: "group" } },
  { flag: "wall", title: "קיר האסוציאציות", say: "אסוציאציות של הקבוצה לכל מונח, ב״יחד״.", go: { v: "wall" } },
  { flag: "ask", title: "לשאול את החומר", say: "שאלה על החומר? בשורת החיפוש בספרייה.", walk: "ask" },
  { flag: "progress", title: "ההתקדמות שלי", say: "ב״שלי״: מה כבר יושב ומה עוד לא, גלוי רק לך.", go: { v: "progress" } },
  { flag: "pulse", title: "מה קשה לקבוצה", say: "ב״יחד״: מה הכי קשה לקבוצה עכשיו, בלי שמות.", go: { v: "pulse" } },
  { flag: "museum", title: "טעויות נפוצות", say: "התשובות השגויות שהכי הרבה בחרו, בלי שמות.", go: { v: "museum" } },
  { flag: "boss", title: "אתגר קבוצתי", say: "כל הקבוצה ביחד מול הנושאים שהכי מכשילים אותה, ב״יחד״.", go: { v: "boss" } },
  { flag: "groupPlan", title: "תוכנית עד המבחן", say: "תוכנית של הקבוצה עד המבחן, ב״יחד״.", go: { v: "plan" } },
  { flag: "traps", title: "שאלה משלי", say: "בפסקה אפשר לכתוב שאלה משלך ולבדוק אותה מול השקפים.", walk: "read" },
  { flag: "blankTable", title: "טבלה ריקה", say: "טבלה מהשקפים למילוי מהזיכרון, בתרגול.", go: { v: "practice" } },
  { flag: "courses", title: "עמוד לכל קורס", say: "בספרייה נוגעים בשם הקורס: תאריך המבחן, כל ההרצאות שלו, והעלאה של כמה קבצים יחד.", go: { v: "library" } },
  { flag: "exams", title: "מבחנים קודמים", say: "בעמוד הקורס מעלים מבחן משנים קודמות, מתרגלים אותו בסדר המקורי, ועושים סימולציה עם שעון.", go: { v: "library" } },
  { flag: "qtypes", title: "סוגי שאלות", say: "שאלות על תמונות מהשקפים, התאמה, סידור ונכון / לא נכון. בתרגול: ״סבב חדש״ ← ״סוג שאלה״.", go: { v: "practice" } },
];

/** The flags of a build that have a "חדש" line, on now. */
export function hintFlags(f: Flags): string[] {
  return HINTS.filter((h) => f[h.flag]).map((h) => h.flag);
}

/** Today's "חדש" hint, if any: a feature on now that this member did not know,
 *  tips on, not one already today, and never in the first steps' 14 days
 *  (a new member meets everything as new). */
export function nextHint(m: Memory, f: Flags, today: string, now: number): Hint | null {
  if (!m.tips || !m.known) return null;
  // One thing at a time: while the home offers the tour, no "חדש" hint.
  if (offerWanted(m)) return null;
  if (m.hintDay === today) return null;
  if (m.born && now - m.born <= RETIRE_MS) return null;
  return HINTS.find((h) => f[h.flag] && !m.known!.includes(h.flag)) ?? null;
}

/* ─────────────────────────── words ─────────────────────────── */

export const COPY = {
  cardTitle: "הצעדים הראשונים",
  joinLine: (name: string) => `${name}, ככה נכנסים לעניינים. כל צעד הוא משהו אמיתי באפליקציה.`,
  createLine: "הקבוצה מוכנה. קודם מעלים הרצאה ומזמינים את כולם.",
  show: "להראות",
  skipped: "דולג",
  tryIt: "לנסות בלי לחץ",
  hide: "להסתיר",
  hidden: "הצעדים הראשונים מחכים ב״שלי״.",
  undo: "ביטול",
  allDone: "כל הצעדים בוצעו.",
  close: "סגירה",
  tick: (done: number, total: number, title: string) => (done >= total ? "✓ כל הצעדים! מכאן זה שלכם." : `✓ ${done} מתוך ${total}: ${title}`),
  first: (place: string) => `קודם: ${place}`,
  takeMe: "קחו אותי",
  next: "הבא",
  prev: "הקודם",
  done: "סיום",
  gotIt: "הבנתי",
  allHelp: "כל העזרה",
  guideButton: "איך זה עובד? מדריך קצר למסך",
  readerChip: "איך קוראים כאן?",
  newKicker: (title: string) => `חדש · ${title}`,
  showMe: "הראו לי",
  guideTitle: "מדריך לאפליקציה",
  tourTitle: "סיור קצר באפליקציה",
  offerLine: "דקה-שתיים: מה יש בכל לשונית. רק מראים, שום דבר לא נלחץ ולא נשלח.",
  tourStart: "להתחיל סיור",
  offerLater: "לא עכשיו",
  offerWhere: "אפשר לחזור לסיור מתי שרוצים: ״שלי״ ← ״מדריך לאפליקציה״.",
  meTourLine: "דקה-שתיים, במסכים האמיתיים",
} as const;
