import type { Flags } from "./flags";

/* ── Routes: query strings on the app's one page (spec §5.2; §12.2.1) ──
 * As ?l= and ?join= were before, so vercel.json needs no rewrite. The type is
 * complete with every package's parameters, the approved proposal's included
 * (§12.2.1), so no package edits it. parseRoute never throws, and
 * parseRoute(routeUrl(r)) deep-equals r.
 *
 * APP_PATH ("/") is the home: Today once flags.today is on (decision 6), and until
 * then the library, which allowed() puts in its place with no notice. The
 * library itself is ?v=library. */

/** Where the app is served: the root of its own domain. Every in-app link
 *  (routeUrl, the help links) and every shared link (shareUrl) starts here,
 *  so moving the app means changing this one line (and vercel.json). */
export const APP_PATH = "/";

/** A link to send to someone else (an invite, a lecture, a live quiz): this
 *  address's own origin, so a link made on any domain opens on that domain.
 *  `query` is "?…" or "". Browser only. */
export function shareUrl(query: string): string {
  return `${location.origin}${APP_PATH}${query}`;
}

export type At = { part: number; anchor: number };
export type Route =
  | { v: "today"; run?: true } // T: "/" once flags.today; ?v=today is its alias; run=1 the session
  | { v: "library" } // explicit from F1Δ on (?v=library)
  | { v: "upload"; c?: string; many?: true } // c: the course's id (sources.md, phase 1); many: "העלאה של כמה קבצים"
  | { v: "help" } // #howto scrolls to the guide's "איך עושים…?"
  | { v: "lecture"; l: string; at?: At; slide?: number; mk?: string; read?: true; follow?: true }
  | { v: "practice"; l?: string; s?: string; n?: "5" | "10" | "20" | "all"; x?: PracticeStep; r?: string; from?: "m" }
  //   s: l.<lecture> · c.<course> · m (my mistakes) · m.<lecture> · t.<topic key> · e.<exam> · q.<quiz> (a live quiz's questions)
  //      · p.<lecture>.<part>.<anchor> (N: a paragraph's questions) · b.<lecture>.<slide> (E: a blank table) · r.<group> (Q-2: another wording)
  //      · x.<attempt> (a simulation: its clock, its grid, its result) · w.<attempt> (a simulation's mistakes, asked again)
  //   x (practice 2.0, with l): new (מה ליצור) · example (דוגמה ומיקוד) · bank (הבנק נבנה, r: the request) · round (סבב חדש)
  //      · review (the request's drafts one by one, r: the request; practice sets keep it while bank is "סט בהכנה").
  //      Practice sets (flags.make): new is "סט חדש", also without l (the screen picks the lecture);
  //      from=m (with new): the member's mistakes' parts prefilled
  | { v: "exams"; e?: string; c?: string; isNew?: true }
  | { v: "quiz"; q?: string; l?: string; c?: string; isNew?: true; mk?: string; m?: string; preset?: "end" | "coffee" | "stop"; pf?: number; pt?: number } // m, preset, pf, pt: Z/M, from a meeting or a part range
  | { v: "cards"; l?: string; s?: string } // s: today · l.<lecture> · c.<course>
  | { v: "ask"; l?: string; at?: At; first?: string; c?: string } // first: the library ask bar's text, sent once; c: a course's id ("לשאול על כל הקורס")
  | { v: "course"; c: string; seg?: CourseSeg } // the course page (sources.md, phase 1): c is the course's id
  | { v: "mock"; c: string; e?: string } // "סימולציה" (sources.md, phase 2): the setup of a course's simulation; e: the exam chosen
  | { v: "group" }
  | { v: "marathon"; m?: string; isNew?: true; edit?: true }
  | { v: "me" }
  | { v: "progress"; t?: string; x?: "danger" } // A2
  | { v: "plan"; edit?: true; lane?: "group" | "mine"; d?: string } // G (d: YYYY-MM-DD)
  | { v: "meeting"; m?: string; isNew?: true; edit?: true } // M
  | { v: "catchup"; l?: string; m?: string } // M-2 (entered from T)
  | { v: "log"; l: string } // V
  | { v: "dispute"; d: string } // V
  | { v: "pulse"; l?: string } // U
  | { v: "museum"; l?: string } // U
  | { v: "wall"; l?: string; d?: string; t?: "top" | "new" | "needed" | "mine"; at?: At; x?: "drafts" | "post" | "moment" } // J
  | { v: "boss"; isNew?: true; l?: string } // H (a battle itself is ?v=quiz&q=)
  | { v: "eve"; l: string } // A2 (PR6)
  | { v: "trap"; l: string; at?: At; d?: string } // E (P11)
  | { v: "try"; s?: "b" } // the guide's sandbox (s=b: a question with a bet); nothing in it is saved
  | { v: "install" } // adding the app to the home screen (docs/study/install.md), its steps for this device
  | { v: "notify"; x?: "set" }; // notifications (section R): the inbox; x=set its settings

export type Tab = "today" | "library" | "practice" | "group" | "me";

/** The course page's segments (sources.md): its past exams, its lectures, what the group made. */
export const COURSE_SEGS = ["exams", "lectures", "made"] as const;
export type CourseSeg = (typeof COURSE_SEGS)[number];

/** Practice 2.0's screens of a lecture (docs/study/proposal/practice-2/mockups.html). */
export const PRACTICE_STEPS = ["new", "example", "bank", "round", "review"] as const;
export type PracticeStep = (typeof PRACTICE_STEPS)[number];

const UUID = "[0-9a-f-]{36}";
const ID = new RegExp(`^${UUID}$`);
const AT = /^(\d+)\.(\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The session keys whose parts are ids (§12.2.1): a paragraph's questions,
 *  a blank table, another wording. Other keys are free text (≤ 200). */
const KEYED = [
  { prefix: "p.", re: new RegExp(`^p\\.${UUID}\\.\\d{1,5}\\.\\d{1,5}$`) },
  { prefix: "b.", re: new RegExp(`^b\\.${UUID}\\.([1-9]\\d{0,2})$`) },
  { prefix: "r.", re: new RegExp(`^r\\.${UUID}$`) },
  { prefix: "x.", re: new RegExp(`^x\\.${UUID}$`) },
  { prefix: "w.", re: new RegExp(`^w\\.${UUID}$`) },
];

const id = (x: string | null): string | undefined => (x && ID.test(x) ? x : undefined);
const text = (x: string | null, max: number): string | undefined => (x && x.length <= max ? x : undefined);
const one = (x: string | null): true | undefined => (x === "1" ? true : undefined);
/** One of a parameter's values, or nothing. */
function oneOf<T extends string>(x: string | null, values: readonly T[]): T | undefined {
  return values.includes(x as T) ? (x as T) : undefined;
}
function at(x: string | null): At | undefined {
  const m = AT.exec(x ?? "");
  if (!m) return undefined;
  const part = Number(m[1]);
  const anchor = Number(m[2]);
  return Number.isSafeInteger(part) && Number.isSafeInteger(anchor) ? { part, anchor } : undefined;
}
function slide(x: string | null): number | undefined {
  if (!x || !/^\d{1,3}$/.test(x)) return undefined;
  const n = Number(x);
  return n >= 1 && n <= 999 ? n : undefined;
}
/** A part number of a range (pf, pt): 0-199. */
function partNo(x: string | null): number | undefined {
  if (!x || !/^\d{1,3}$/.test(x)) return undefined;
  const n = Number(x);
  return n <= 199 ? n : undefined;
}
/** A day (plan's d): YYYY-MM-DD, and a real date. */
function day(x: string | null): string | undefined {
  if (!x || !DATE.test(x)) return undefined;
  const t = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === x ? x : undefined;
}
/** A practice session's key: at most 200 characters, and the id keys well formed. */
function sessionKey(x: string | null): string | undefined {
  const s = text(x, 200);
  if (!s) return undefined;
  const keyed = KEYED.find((k) => s.startsWith(k.prefix));
  return !keyed || keyed.re.test(s) ? s : undefined;
}
/** Only the keys that are set, so a parsed route deep-equals the one written. */
function clean<T extends Record<string, unknown>>(r: T): T {
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
}

const HOME: Route = { v: "today" };

/** The route of a URL's query (and hash, kept for old links). Never throws. */
export function parseRoute(search: string, _hash?: string): Route {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return { ...HOME };
  }
  const g = (k: string) => q.get(k);
  switch (g("v")) {
    case "today":
      return clean({ v: "today", run: one(g("run")) });
    case "library":
      return { v: "library" };
    case "upload":
      return clean({ v: "upload", c: id(g("c")), many: one(g("many")) });
    case "help":
      return { v: "help" };
    case "group":
      return { v: "group" };
    case "me":
      return { v: "me" };
    case "lecture": {
      const l = id(g("l"));
      return l ? lecture(l, q) : { v: "library" };
    }
    case "practice": {
      const n = g("n");
      const l = id(g("l"));
      // A step names a lecture's screen: without the lecture it is dropped (but "new":
      // practice sets' create screen picks the lecture), and a session (s) wins.
      const step = g("s") ? undefined : oneOf(g("x"), PRACTICE_STEPS);
      const x = l ? step : step === "new" ? step : undefined;
      return clean({
        v: "practice",
        l,
        s: sessionKey(g("s")),
        n: n === "5" || n === "10" || n === "20" || n === "all" ? n : undefined,
        x,
        r: x === "bank" || x === "review" ? id(g("r")) : undefined,
        from: x === "new" ? oneOf(g("from"), ["m"] as const) : undefined,
      });
    }
    case "exams":
      return clean({ v: "exams", e: id(g("e")), c: text(g("c"), 200), isNew: one(g("new")) });
    case "quiz":
      return clean({
        v: "quiz",
        q: id(g("q")),
        l: id(g("l")),
        c: text(g("c"), 200),
        isNew: one(g("new")),
        mk: id(g("mk")),
        m: id(g("m")),
        preset: oneOf(g("preset"), ["end", "coffee", "stop"] as const),
        pf: partNo(g("pf")),
        pt: partNo(g("pt")),
      });
    case "cards":
      return clean({ v: "cards", l: id(g("l")), s: text(g("s"), 200) });
    case "ask":
      return clean({ v: "ask", l: id(g("l")), at: at(g("at")), first: text(g("first"), 500), c: id(g("c")) });
    case "course": {
      const c = id(g("c"));
      return c ? clean({ v: "course" as const, c, seg: oneOf(g("seg"), COURSE_SEGS) }) : { v: "library" };
    }
    case "mock": {
      const c = id(g("c"));
      return c ? clean({ v: "mock" as const, c, e: id(g("e")) }) : { v: "library" };
    }
    case "marathon":
      return clean({ v: "marathon", m: id(g("m")), isNew: one(g("new")), edit: one(g("edit")) });
    case "progress":
      return clean({ v: "progress", t: text(g("t"), 200), x: oneOf(g("x"), ["danger"] as const) });
    case "plan": {
      // design-platform's old form of a marathon link
      const m = id(g("m"));
      if (m) return { v: "marathon", m };
      return clean({ v: "plan", edit: one(g("edit")), lane: oneOf(g("lane"), ["group", "mine"] as const), d: day(g("d")) });
    }
    case "meeting":
      return clean({ v: "meeting", m: id(g("m")), isNew: one(g("new")), edit: one(g("edit")) });
    case "catchup":
      return clean({ v: "catchup", l: id(g("l")), m: id(g("m")) });
    case "log": {
      const l = id(g("l"));
      return l ? { v: "log", l } : { v: "library" };
    }
    case "dispute": {
      const d = id(g("d"));
      return d ? { v: "dispute", d } : { v: "library" };
    }
    case "pulse":
      return clean({ v: "pulse", l: id(g("l")) });
    case "museum":
      return clean({ v: "museum", l: id(g("l")) });
    case "wall":
      return clean({
        v: "wall",
        l: id(g("l")),
        d: text(g("d"), 60),
        t: oneOf(g("t"), ["top", "new", "needed", "mine"] as const),
        at: at(g("at")),
        x: oneOf(g("x"), ["drafts", "post", "moment"] as const),
      });
    case "boss":
      return clean({ v: "boss", isNew: one(g("new")), l: id(g("l")) });
    case "eve": {
      const l = id(g("l"));
      return l ? { v: "eve", l } : { v: "library" };
    }
    case "trap": {
      const l = id(g("l"));
      return l ? clean({ v: "trap" as const, l, at: at(g("at")), d: id(g("d")) }) : { v: "library" };
    }
    case "try":
      return clean({ v: "try" as const, s: oneOf(g("s"), ["b"] as const) });
    case "install":
      return { v: "install" };
    case "notify":
      return clean({ v: "notify" as const, x: oneOf(g("x"), ["set"] as const) });
    case null: {
      const l = id(g("l"));
      return l ? lecture(l, q) : { ...HOME };
    }
    default:
      return { v: "library" };
  }
}

function lecture(l: string, q: URLSearchParams): Route {
  return clean({ v: "lecture" as const, l, at: at(q.get("at")), slide: slide(q.get("slide")), mk: id(q.get("mk")), read: one(q.get("read")), follow: one(q.get("follow")) });
}

/** "/?v=…" for a route; the home (Today) is APP_PATH, "/". */
export function routeUrl(r: Route): string {
  const q = new URLSearchParams();
  const put = (k: string, v: string | number | boolean | undefined) => {
    if (v === undefined || v === false) return;
    q.set(k, v === true ? "1" : String(v));
  };
  const atText = (a?: At) => (a ? `${a.part}.${a.anchor}` : undefined);
  switch (r.v) {
    case "today":
      if (r.run) {
        put("v", r.v);
        put("run", r.run);
      }
      break;
    case "lecture":
      put("l", r.l);
      put("at", atText(r.at));
      put("slide", r.slide);
      put("mk", r.mk);
      put("read", r.read);
      put("follow", r.follow);
      break;
    case "practice":
      put("v", r.v);
      put("l", r.l);
      put("s", r.s);
      put("n", r.n);
      put("x", r.x);
      put("r", r.r);
      put("from", r.from);
      break;
    case "exams":
      put("v", r.v);
      put("e", r.e);
      put("c", r.c);
      put("new", r.isNew);
      break;
    case "quiz":
      put("v", r.v);
      put("q", r.q);
      put("l", r.l);
      put("c", r.c);
      put("new", r.isNew);
      put("mk", r.mk);
      put("m", r.m);
      put("preset", r.preset);
      put("pf", r.pf);
      put("pt", r.pt);
      break;
    case "cards":
      put("v", r.v);
      put("l", r.l);
      put("s", r.s);
      break;
    case "ask":
      put("v", r.v);
      put("l", r.l);
      put("at", atText(r.at));
      put("first", r.first);
      put("c", r.c);
      break;
    case "upload":
      put("v", r.v);
      put("c", r.c);
      put("many", r.many);
      break;
    case "course":
      put("v", r.v);
      put("c", r.c);
      put("seg", r.seg);
      break;
    case "mock":
      put("v", r.v);
      put("c", r.c);
      put("e", r.e);
      break;
    case "marathon":
      put("v", r.v);
      put("m", r.m);
      put("new", r.isNew);
      put("edit", r.edit);
      break;
    case "progress":
      put("v", r.v);
      put("t", r.t);
      put("x", r.x);
      break;
    case "plan":
      put("v", r.v);
      put("edit", r.edit);
      put("lane", r.lane);
      put("d", r.d);
      break;
    case "meeting":
      put("v", r.v);
      put("m", r.m);
      put("new", r.isNew);
      put("edit", r.edit);
      break;
    case "catchup":
      put("v", r.v);
      put("l", r.l);
      put("m", r.m);
      break;
    case "log":
    case "eve":
      put("v", r.v);
      put("l", r.l);
      break;
    case "dispute":
      put("v", r.v);
      put("d", r.d);
      break;
    case "pulse":
    case "museum":
      put("v", r.v);
      put("l", r.l);
      break;
    case "wall":
      put("v", r.v);
      put("l", r.l);
      put("d", r.d);
      put("t", r.t);
      put("at", atText(r.at));
      put("x", r.x);
      break;
    case "boss":
      put("v", r.v);
      put("new", r.isNew);
      put("l", r.l);
      break;
    case "trap":
      put("v", r.v);
      put("l", r.l);
      put("at", atText(r.at));
      put("d", r.d);
      break;
    case "try":
      put("v", r.v);
      put("s", r.s);
      break;
    case "notify":
      put("v", r.v);
      put("x", r.x);
      break;
    default:
      put("v", r.v);
  }
  const s = q.toString();
  return s ? `${APP_PATH}?${s}` : APP_PATH;
}

/** The tab a route belongs to; null for an immersive screen (no tab bar, a
 *  back arrow): the reader, upload, a session, a quiz, an editor, ask about a
 *  lecture, the meeting, catch-up, the log, a yellow card, the eve view, a
 *  trap, the wall's drafts and composer, a new battle, Today's session (T-1:
 *  ?v=today&run=1, a session like practice's and the cards'). With flags.today there
 *  is no "תרגול" tab: what was on it belongs to "היום" (§12.2.1). */
export function tabOf(r: Route, f: Flags): Tab | null {
  const practice: Tab = f.today ? "today" : "practice";
  switch (r.v) {
    case "today":
      return r.run ? null : "today";
    case "library":
      return "library";
    case "ask":
      return r.l || r.c ? null : "library";
    case "course":
      return "library";
    case "practice":
      return r.s || r.x ? null : practice;
    case "exams":
      // Past exams live in their course (sources.md): the library's tab once the course pages are on.
      return r.isNew ? null : f.courses ? "library" : practice;
    case "mock":
      return null;
    case "cards":
      return r.s ? null : practice;
    case "group":
    case "pulse":
    case "museum":
      return "group";
    case "wall":
      return r.x ? null : "group";
    case "boss":
      return r.isNew ? null : "group";
    case "marathon":
      return r.isNew || r.edit ? null : "group";
    case "plan":
      return r.edit ? null : r.lane === "mine" ? "me" : "group";
    case "me":
    case "progress":
    case "help":
    case "install":
      return "me";
    default:
      return null;
  }
}

/** The notices a replaced route shows (spec §5.2; the shell's toast). */
export const NOTICE = {
  mistakes: "״הטעויות שלי״ עוד לא פתוחות. בינתיים אפשר לתרגל את ההרצאה.",
  cardsReview: "החזרה על כרטיסיות באפליקציה תיפתח בקרוב. בינתיים: ״עיון בכרטיסיות״ או ייצוא ל-Anki.",
  off: "התכונה הזו עוד לא פתוחה.",
} as const;

/** The lecture a session key names (l.<id>, m.<id>, p.<id>.…, b.<id>.…), if any. */
function lectureOfKey(s: string | undefined): string | undefined {
  const m = /^[lmpb]\.([0-9a-f-]{36})(?:$|\.)/.exec(s ?? "");
  return m ? m[1] : undefined;
}

/** A route allowed under these flags: the route itself, or the nearest one
 *  that is on with one line saying why (never a silent jump: review UX-1).
 *  One exception: the home, Today, is the library until flags.today, with no
 *  notice (decision 6 with decision 12). */
export function allowed(r: Route, f: Flags): { route: Route; notice?: string } {
  const off = (route: Route, notice: string = NOTICE.off) => ({ route, notice });
  const ok = { route: r };
  // The nearest practice screen for a lecture: its practice page, else the lecture, else the library.
  const practiceOf = (l?: string): Route => (f.questions ? clean({ v: "practice" as const, l }) : l ? { v: "lecture", l } : { v: "library" });
  // A lecture's own screen that is off: the lecture.
  const lectureOr = (l: string | undefined, other: Route): Route => (l ? { v: "lecture", l } : other);
  switch (r.v) {
    case "today":
      return f.today ? ok : { route: { v: "library" } };
    case "practice": {
      if (!f.questions) {
        if (f.cards && !r.s) return off(clean({ v: "cards" as const, l: r.l }));
        return off(r.l ? { v: "lecture", l: r.l } : { v: "library" });
      }
      // סבב חדש starts a session: with practice off, the lecture's practice. Creating questions needs only `questions`.
      if (r.x === "round" && !f.practice) return off(practiceOf(r.l));
      // "סט חדש" without a lecture, or from the mistakes, is practice sets' (flags.make):
      // without them, the hub, or the lecture's old setup.
      if (r.x === "new" && !f.make && (!r.l || r.from)) return off(r.l ? { v: "practice", l: r.l, x: "new" } : { v: "practice" });
      if (!r.s) return ok;
      const l = r.l ?? lectureOfKey(r.s);
      if (!f.practice) return off(practiceOf(l));
      if (r.s === "m" || r.s.startsWith("m.") || r.s.startsWith("r.")) return f.mistakes ? ok : off(practiceOf(l), NOTICE.mistakes);
      if (r.s.startsWith("e.") || r.s.startsWith("x.") || r.s.startsWith("w.")) return f.exams ? ok : off(practiceOf(l));
      if (r.s.startsWith("q.")) return f.quiz ? ok : off(practiceOf(l));
      if (r.s.startsWith("p.")) return f.anchor ? ok : off(practiceOf(l));
      if (r.s.startsWith("b.")) return f.blankTable ? ok : off(practiceOf(l));
      return ok;
    }
    case "exams":
      return f.exams ? ok : off(practiceOf());
    case "mock":
      return f.exams ? ok : off(f.courses ? { v: "course", c: r.c } : practiceOf());
    case "quiz":
      if (f.quiz) return ok;
      return off(r.l && f.questions ? { v: "practice", l: r.l } : r.l ? { v: "lecture", l: r.l } : { v: "library" });
    case "cards":
      if (!f.cards) return off(r.l ? { v: "lecture", l: r.l } : { v: "library" });
      if (r.s && !f.cardsReview) return off(clean({ v: "cards" as const, l: r.l ?? lectureOfKey(r.s) }), NOTICE.cardsReview);
      return ok;
    case "ask":
      if (!f.ask) return off(r.l ? clean({ v: "lecture" as const, l: r.l, at: r.at }) : r.c && f.courses ? { v: "course", c: r.c } : { v: "library" });
      // "לשאול על כל הקורס" needs the course pages too: without them, the library's question.
      if (r.c && (!f.courses || r.l)) return off(r.l ? clean({ v: "ask" as const, l: r.l, at: r.at, first: r.first }) : clean({ v: "ask" as const, first: r.first }));
      return ok;
    case "course":
      return f.courses ? ok : off({ v: "library" });
    case "upload":
      // Several files at once, or a course's upload, come with the course pages; without them, one lecture.
      return f.courses || (!r.c && !r.many) ? ok : off({ v: "upload" });
    case "progress":
      return f.progress ? ok : off({ v: "me" });
    case "plan":
      // A2's private plan is not built (review F-7): the group's plan, else the marathons.
      if (f.groupPlan) return ok;
      return off(f.marathons ? { v: "marathon" } : { v: "library" });
    case "marathon":
      return f.marathons ? ok : off({ v: "group" });
    case "meeting":
      return f.meeting ? ok : off({ v: "group" });
    case "catchup":
      // M-2's (decision 1, 17 Nov 2026: open without the account, entered from "יחד" too)
      return f.guess ? ok : off(lectureOr(r.l, { v: "library" }));
    case "log":
      return f.var ? ok : off({ v: "lecture", l: r.l });
    case "dispute":
      return f.var ? ok : off({ v: "group" });
    case "pulse":
      return f.pulse ? ok : off({ v: "group" });
    case "museum":
      return f.museum ? ok : off({ v: "group" });
    case "wall":
      if (!f.wall) return off(lectureOr(r.l, { v: "group" }));
      if (r.t === "needed" && !f.pulse) return off({ ...r, t: "top" });
      return ok;
    case "boss":
      return f.boss ? ok : off({ v: "group" });
    case "eve":
      return f.eve ? ok : off({ v: "lecture", l: r.l });
    case "trap":
      return f.traps ? ok : off(clean({ v: "lecture" as const, l: r.l, at: r.at }));
    case "try":
      // Without the guide "?v=try" is what it always was, an unknown screen:
      // the library, with no notice (the build behaves as before the guide).
      return f.guide ? ok : { route: { v: "library" } };
    case "install":
      // Without its flag "?v=install" is an unknown screen, as before: the library, with no notice.
      return f.install ? ok : { route: { v: "library" } };
    case "notify":
      // Without its flag a notice's link goes home, with no notice.
      return f.notify ? ok : { route: f.today ? { v: "today" } : { v: "library" } };
    default:
      return ok;
  }
}

/* ── The links F's own screens make, as data, so route.test.ts can check
 * that no control links to a route allowed() replaces (spec §5.2). ── */

/** Where the "תרגול" tab leads: practice, else the cards, else nowhere (hidden). */
export function practiceTab(f: Flags): Route | null {
  return f.questions ? { v: "practice" } : f.cards ? { v: "cards" } : null;
}

/** The tab bar, right to left: with flags.today היום · ספרייה · יחד · שלי
 *  (decision 6: practice opens from Today and from every lecture); without
 *  it the spec's ספרייה · תרגול · יחד · שלי. */
export function tabLinks(f: Flags): Array<{ tab: Tab; label: string; route: Route }> {
  const library = { tab: "library" as const, label: "ספרייה", route: { v: "library" } as Route };
  const group = { tab: "group" as const, label: "יחד", route: { v: "group" } as Route };
  const me = { tab: "me" as const, label: "שלי", route: { v: "me" } as Route };
  if (f.today) return [{ tab: "today" as const, label: "היום", route: { v: "today" } as Route }, library, group, me];
  const practice = practiceTab(f);
  return [library, ...(practice ? [{ tab: "practice" as const, label: "תרגול", route: practice }] : []), group, me];
}

/** A lecture's route chips (LectureView's action row), each behind its flag. */
export function lectureChips(l: string, f: Flags): Array<{ key: "practice" | "cards" | "quiz" | "ask"; label: string; route: Route }> {
  const out: Array<{ key: "practice" | "cards" | "quiz" | "ask"; label: string; route: Route }> = [];
  if (f.questions) out.push({ key: "practice", label: "תרגול", route: { v: "practice", l } });
  if (f.cards) out.push({ key: "cards", label: "כרטיסיות", route: { v: "cards", l } });
  if (f.quiz) out.push({ key: "quiz", label: "מבחן קבוצתי", route: { v: "quiz", isNew: true, l } });
  if (f.ask) out.push({ key: "ask", label: "לשאול", route: { v: "ask", l } });
  return out;
}

/** F's rows on "שלי" that open a package's screen (§12.2.3): "הטעויות שלי"
 *  (Q's list), once it is open (with progress; decision 1 of 17 Nov 2026:
 *  no account). A2's MeRows (features/progress.tsx) shows the same row with
 *  its count when progress is on, so "שלי" renders this one only without it. */
export function meLinks(f: Flags): Array<{ label: string; route: Route }> {
  return f.mistakes ? [{ label: "הטעויות שלי", route: { v: "practice", s: "m" } }] : [];
}

/** The footer after reading: "אחרי הקריאה: תרגול על ההרצאה". */
export function afterReading(l: string, f: Flags): Route | null {
  return f.questions ? { v: "practice", l } : null;
}

/** The screen key an in-app push records as history.state.from (Back's words):
 *  the route's screen, and the library for its ask bar. */
export function screenKey(r: Route): string {
  return r.v === "ask" && !r.l ? "library" : r.v;
}

/** A back arrow's words, by the screen it returns to (§5.1; "→ יחד" and "→ שלי"
 *  as design-me's screens say them, §6.4 A; "→ להיום" and "→ לקיר" as the
 *  approved screens say them, proposal/mockups). */
export const BACK_LABEL: Record<string, string> = {
  today: "→ להיום",
  practice: "→ לתרגול",
  quiz: "→ למבחן",
  cards: "→ לכרטיסיות",
  ask: "→ לשאלה",
  plan: "→ לתוכנית",
  marathon: "→ למפגש הלמידה",
  wall: "→ לקיר",
  library: "→ לספרייה",
  course: "→ לקורס",
  exams: "→ למבחן",
  mock: "→ לסימולציה",
  group: "→ יחד",
  me: "→ שלי",
  notify: "→ להתראות",
};
