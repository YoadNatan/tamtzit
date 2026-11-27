/* ── A notice's route as a link, and the object a screen "sees" ──
 * Section R stores each notice's route as a Route object of
 * src/study/lib/route.ts ({"v":"lecture","l":"…"}). The push needs it as a
 * link ("/?v=quiz&q=…"), written on the server, which does not import src/:
 * routeQuery() writes exactly what routeUrl() writes (a test compares them for
 * every kind of screen, Today included), and only from the keys each screen
 * has, so a stored route can never put anything else into a link.
 *
 * objOf() names what a screen shows, as the notices' obj column does
 * ('lec:<id>'): opening that screen marks its notices seen. */

/** The app's home ("/": Today), as route.ts's APP_PATH. */
export const HOME_PATH = "/";

/** Each screen's query keys, in routeUrl's order ("isNew" is written "new").
 *  "today" writes v only with run; "lecture" writes no v. A screen not listed
 *  writes only its v. */
const KEYS: Record<string, readonly string[]> = {
  today: ["run"],
  lecture: ["l", "at", "slide", "mk", "read", "follow"],
  practice: ["l", "s", "n", "x", "r"],
  exams: ["e", "c", "isNew"],
  quiz: ["q", "l", "c", "isNew", "mk", "m", "preset", "pf", "pt"],
  cards: ["l", "s"],
  ask: ["l", "at", "first", "c"],
  upload: ["c", "many"],
  course: ["c", "seg"],
  mock: ["c", "e"],
  marathon: ["m", "isNew", "edit"],
  progress: ["t", "x"],
  plan: ["edit", "lane", "d"],
  meeting: ["m", "isNew", "edit"],
  catchup: ["l", "m"],
  log: ["l"],
  eve: ["l"],
  dispute: ["d"],
  pulse: ["l"],
  museum: ["l"],
  wall: ["l", "d", "t", "at", "x"],
  boss: ["isNew", "l"],
  trap: ["l", "at", "d"],
  try: ["s"],
  notify: ["x"],
  sets: ["k", "l"],
  models: ["x", "r", "k"],
};

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

/** One value as routeUrl writes it, or undefined when it is not one a route holds. */
function value(x: unknown): string | undefined {
  if (x === true) return "1";
  if (typeof x === "string") return x.length > 0 && x.length <= 500 ? x : undefined;
  if (typeof x === "number") return Number.isFinite(x) ? String(x) : undefined;
  if (isObj(x) && Number.isSafeInteger(x.part) && Number.isSafeInteger(x.anchor)) return `${x.part}.${x.anchor}`;
  return undefined;
}

/** "/?v=…" for a stored route; "/" for Today, or for anything that is not a route. */
export function routeQuery(route: unknown): string {
  if (!isObj(route) || typeof route.v !== "string" || !/^[a-z]{2,20}$/.test(route.v)) return HOME_PATH;
  const v = route.v;
  const q = new URLSearchParams();
  if (v === "today") {
    if (route.run === true) {
      q.set("v", v);
      q.set("run", "1");
    }
  } else {
    if (v !== "lecture") q.set("v", v);
    for (const k of KEYS[v] ?? []) {
      const s = value(route[k]);
      if (s !== undefined) q.set(k === "isNew" ? "new" : k, s);
    }
  }
  const s = q.toString();
  return s ? `${HOME_PATH}?${s}` : HOME_PATH;
}

/** The object a screen shows, as section R's obj: 'lec:<id>', 'quiz:<id>',
 *  'exam:<id>', 'meet:<id>', 'disp:<id>', 'wall:<lecture>', a set's 'qset:<id>'
 *  and the group's shelf 'qsets' (section L), the list of comparisons to rate 'labs'
 *  (section Y's lab_new) and a run's 'lab:<run>'; null for any other screen. */
export function objOf(route: unknown): string | null {
  if (!isObj(route)) return null;
  const id = (k: string) => (typeof route[k] === "string" && /^[0-9a-f-]{36}$/.test(route[k] as string) ? (route[k] as string) : null);
  switch (route.v) {
    case "lecture":
      return id("l") ? `lec:${id("l")}` : null;
    case "quiz":
      return id("q") ? `quiz:${id("q")}` : null;
    case "exams":
      return id("e") ? `exam:${id("e")}` : null;
    case "meeting":
      return id("m") ? `meet:${id("m")}` : null;
    case "dispute":
      return id("d") ? `disp:${id("d")}` : null;
    case "wall":
      return id("l") && route.x === undefined ? `wall:${id("l")}` : null;
    case "sets":
      // A set's page sees its set_solved; the group's shelf sees set_shared.
      return id("k") ? `qset:${id("k")}` : route.l === undefined && route.k === undefined ? "qsets" : null;
    case "models":
      // The list of runs to rate sees lab_new (section Y's obj 'labs'; one
      // notice for several runs opens them all); a run's own 'lab:<run>' is
      // kept for a notice made before that.
      return id("r") ? `lab:${id("r")}` : route.x === undefined && route.k === undefined ? "labs" : null;
    default:
      return null;
  }
}
