import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ENDS, flagsFrom, requiredSchema, type Ends, type Flags } from "./flags";
import { helpRows } from "./helpCopy";
import { afterReading, allowed, BACK_LABEL, lectureChips, meLinks, NOTICE, parseRoute, practiceTab, routeUrl, screenKey, tabLinks, tabOf, type Route } from "./route";

/* F-3: routes (spec §5.2; §12.2.1). Every URL in §1 of every design, in the
 * spec's §5.2 and in the addendum (§12) round-trips; every route of §12.2.1
 * round-trips; old and bad links land somewhere sane (bad ids, dates, slides
 * and values dropped); and under each release's flag set (§12.7.6) allowed()
 * replaces exactly the routes that are off, always with a notice, except the
 * home (Today → the library, with none) and the plan (→ the marathons until
 * the group's plan); no control of F's screens links to a route it would
 * replace; and F's words promise a return tomorrow only where something
 * brings it back (decision 1 of 17 Nov 2026 lifts §12.7.6's gating rule). */

const ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ID2 = "bbbbbbbb-0000-4000-8000-000000000002";
const docs = join(process.cwd(), "docs", "study", "spec");

/* ── the URLs the designs, the spec and the addendum write ── */
function urlsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\?(?:v|l)=[^\s`)"'*|,\]]+/g)) {
    out.push(
      m[0]
        .replace(/<part>\.<anchor>/g, "1.3")
        .replace(/<n>/g, "7")
        .replace(/<slide>/g, "12")
        .replace(/<[^>]+>/g, ID)
        .replace(/[.:;]+$/, ""),
    );
  }
  return out;
}
const designUrls = readdirSync(join(docs, "sources"))
  .filter((f) => /^design-.*\.md$/.test(f))
  .flatMap((f) => {
    const md = readFileSync(join(docs, "sources", f), "utf8");
    const s1 = md.slice(md.indexOf("\n## 1."), md.indexOf("\n## 2."));
    return urlsIn(s1).map((u) => ({ from: f, url: u }));
  });
const spec = readFileSync(join(docs, "spec-final.md"), "utf8");
const s52 = spec.slice(spec.indexOf("### 5.2 Routes"), spec.indexOf("### 5.3 The slot contract"));
const specUrls = urlsIn(s52).map((u) => ({ from: "spec §5.2", url: u }));
const addendum = readFileSync(join(docs, "addendum", "addendum.md"), "utf8");
const addendumUrls = urlsIn(addendum).map((u) => ({ from: "addendum", url: u }));

const UUID = (x: string) => /^[0-9a-f-]{36}$/.test(x);
/** What a parameter must look like to be kept (the parsing rules of §5.2 and §12.2.1). */
const VALID: Record<string, (x: string, v: string) => boolean> = {
  l: UUID,
  q: UUID,
  e: UUID,
  m: UUID,
  mk: UUID,
  at: (x) => /^\d+\.\d+$/.test(x),
  slide: (x) => /^\d{1,3}$/.test(x) && Number(x) >= 1,
  n: (x) => ["5", "10", "20", "all"].includes(x),
  c: (x, v) => (v === "course" || v === "upload" || v === "ask" || v === "mock" ? UUID(x) : x.length <= 200),
  many: (x) => x === "1",
  seg: (x) => ["exams", "lectures", "made"].includes(x),
  s: (x) => x.length <= 200 && (!/^[pbrxwk]\./.test(x) || /^p\.[0-9a-f-]{36}\.\d+\.\d+$|^b\.[0-9a-f-]{36}\.[1-9]\d{0,2}$|^[rxwk]\.[0-9a-f-]{36}$/.test(x)),
  t: (x, v) => (v === "wall" ? ["top", "new", "needed", "mine"].includes(x) : x.length <= 200),
  first: (x) => x.length <= 500,
  new: (x) => x === "1",
  edit: (x) => x === "1",
  read: (x) => x === "1",
  follow: (x) => x === "1",
  run: (x) => x === "1",
  preset: (x) => ["end", "coffee", "stop"].includes(x),
  pf: (x) => /^\d{1,3}$/.test(x) && Number(x) <= 199,
  pt: (x) => /^\d{1,3}$/.test(x) && Number(x) <= 199,
  x: (x, v) =>
    v === "wall" ? ["drafts", "post", "moment"].includes(x) : v === "practice" ? ["new", "example", "bank", "round", "review"].includes(x) : v === "notify" ? x === "set" : v === "models" ? ["new", "board", "routes"].includes(x) : x === "danger",
  r: UUID,
  k: (x, v) => (v === "models" ? /^[a-z][a-z_]{1,23}$/.test(x) : UUID(x)),
  from: (x) => x === "m",
  lane: (x) => ["group", "mine"].includes(x),
  d: (x, v) => (v === "wall" ? x.length <= 60 : v === "plan" ? /^\d{4}-\d{2}-\d{2}$/.test(x) : UUID(x)),
};
/** The parameters each screen reads (Route of §5.2 and §12.2.1). */
const PARAMS: Record<string, string[]> = {
  today: ["run"],
  lecture: ["l", "at", "slide", "mk", "read", "follow"],
  practice: ["l", "s", "n", "x", "r", "from"],
  exams: ["e", "c", "new"],
  mock: ["c", "e"],
  quiz: ["q", "l", "c", "new", "mk", "m", "preset", "pf", "pt"],
  cards: ["l", "s"],
  ask: ["l", "at", "first", "c"],
  course: ["c", "seg"],
  upload: ["c", "many"],
  marathon: ["m", "new", "edit"],
  progress: ["t", "x"],
  plan: ["edit", "lane", "d"],
  meeting: ["m", "new", "edit"],
  catchup: ["l", "m"],
  log: ["l"],
  dispute: ["d"],
  pulse: ["l"],
  museum: ["l"],
  wall: ["l", "d", "t", "at", "x"],
  boss: ["new", "l"],
  eve: ["l"],
  trap: ["l", "at", "d"],
  notify: ["x"],
  sets: ["k", "l"],
  models: ["x", "r", "k"],
};

/** The plain copy pass (docs/study/COPY.md) rewords some of the spec's sentences:
 *  its table "| where | the spec said | now |", as a map from the old to the new. */
const COPY_NOW = new Map(
  [...readFileSync(join(process.cwd(), "docs", "study", "COPY.md"), "utf8").matchAll(/^\| [^|]+ \| "([^"]+)" \| "([^"]+)" \|$/gm)].map((m) => [m[1], m[2]] as const),
);

test("the designs, §5.2 and the addendum write enough URLs to check", () => {
  assert.ok(designUrls.length >= 25, `${designUrls.length} URLs in §1 of the designs`);
  assert.ok(specUrls.length >= 1, `${specUrls.length} URLs in §5.2 (its routes are the type, checked below)`);
  assert.ok(addendumUrls.length >= 12, `${addendumUrls.length} URLs in the addendum`);
  const vs = new Set([...designUrls, ...specUrls, ...addendumUrls].map(({ url }) => parseRoute(url.slice(url.indexOf("?"))).v));
  // The addendum writes its new screens' links with their ids left out ("?v=log&l="),
  // which parse as dropped; every new route is in ALL_ROUTES below.
  for (const v of ["lecture", "practice", "quiz", "cards", "ask", "group", "me", "help", "today", "library", "progress", "plan"]) {
    assert.ok(vs.has(v as Route["v"]), v);
  }
});

test("every URL of §1 of every design, of §5.2 and of the addendum round-trips, keeping every valid parameter", () => {
  for (const { from, url } of [...designUrls, ...specUrls, ...addendumUrls]) {
    const search = url.slice(url.indexOf("?")).split("#")[0];
    const r = parseRoute(search);
    const again = routeUrl(r);
    assert.deepEqual(parseRoute(again.slice(again.indexOf("?") + 1 || again.length)), r, `${from}: ${url}`);
    const asked = new URLSearchParams(search);
    const v = asked.get("v") === "plan" && asked.get("m") ? "marathon" : (asked.get("v") ?? (r.v === "lecture" ? "lecture" : ""));
    if (!PARAMS[v] || r.v !== v) continue;
    const kept = new URLSearchParams(again.split("?")[1] ?? "");
    for (const p of PARAMS[v]) {
      const x = asked.get(p);
      if (x !== null && VALID[p](x, v)) assert.equal(kept.get(p), x, `${from}: ${url} keeps ${p}`);
    }
  }
});

/** Every route of §5.2 and §12.2.1, each with every parameter it takes. */
/** The words COPY.md's "New words" tables give (docs/study/COPY.md: "| concept | words |"). */
const COPY_WORDS = [...readFileSync(join(process.cwd(), "docs", "study", "COPY.md"), "utf8").matchAll(/^\| [^|]+ \| ([^|]+) \|$/gm)].flatMap((m) => m[1].split(/;|\(/)[0].trim());

const ALL_ROUTES: Route[] = [
  { v: "today" },
  { v: "today", run: true },
  { v: "library" },
  { v: "upload" },
  { v: "upload", c: ID, many: true }, // sources.md: the batch upload of a course
  { v: "upload", many: true },
  { v: "course", c: ID },
  { v: "course", c: ID, seg: "lectures" },
  { v: "mock", c: ID },
  { v: "mock", c: ID, e: ID2 },
  { v: "practice", s: `x.${ID}` },
  { v: "practice", s: `w.${ID}`, n: "all" },
  { v: "help" },
  { v: "lecture", l: ID },
  { v: "lecture", l: ID, at: { part: 1, anchor: 3 }, slide: 23, mk: ID2, read: true, follow: true },
  { v: "practice" },
  { v: "practice", l: ID, s: `l.${ID}`, n: "all" },
  { v: "practice", s: "m" },
  { v: "practice", s: "t.antimalarials" },
  { v: "practice", l: ID, s: `p.${ID}.2.14`, n: "10" },
  { v: "practice", s: `b.${ID}.23` },
  { v: "practice", s: `r.${ID2}` },
  { v: "practice", l: ID, x: "new" },
  { v: "practice", l: ID, x: "example" },
  { v: "practice", l: ID, x: "bank", r: ID2 },
  { v: "practice", l: ID, x: "review", r: ID2 }, // the drafts one by one (practice sets keep it)
  { v: "practice", x: "new" }, // practice sets: "סט חדש" picks the lecture
  { v: "practice", l: ID, x: "new", from: "m" }, // and from the mistakes
  { v: "practice", l: ID, x: "round" },
  { v: "practice", l: ID, s: `l.${ID}`, n: "5" },
  { v: "exams", e: ID, c: "פרמקולוגיה", isNew: true },
  { v: "quiz", q: ID, l: ID2, c: "קורס", isNew: true, mk: ID },
  { v: "quiz", isNew: true, l: ID, m: ID2, preset: "end", pf: 0, pt: 199 },
  { v: "quiz", m: ID, preset: "coffee" },
  { v: "quiz", l: ID, preset: "stop", pf: 3, pt: 3 },
  { v: "cards", l: ID, s: "today" },
  { v: "ask", l: ID, at: { part: 0, anchor: 0 }, first: "מה נאמר על Primaquine בהיריון?" },
  { v: "ask", c: ID }, // "לשאול על כל הקורס"
  { v: "group" },
  { v: "marathon", m: ID, isNew: true, edit: true },
  { v: "me" },
  { v: "progress", t: "mechanism" },
  { v: "progress", x: "danger" },
  { v: "plan" },
  { v: "plan", edit: true, lane: "mine", d: "2026-12-07" },
  { v: "plan", lane: "group" },
  { v: "meeting" },
  { v: "meeting", m: ID, isNew: true, edit: true },
  { v: "catchup" },
  { v: "catchup", l: ID, m: ID2 },
  { v: "log", l: ID },
  { v: "dispute", d: ID },
  { v: "pulse" },
  { v: "pulse", l: ID },
  { v: "museum", l: ID },
  { v: "wall" },
  { v: "wall", l: ID, t: "needed" },
  { v: "wall", d: "Miltefosine", t: "mine" },
  { v: "wall", l: ID, at: { part: 2, anchor: 5 }, x: "drafts" },
  { v: "wall", l: ID, x: "moment", at: { part: 0, anchor: 1 }, t: "new" },
  { v: "boss" },
  { v: "boss", isNew: true, l: ID },
  { v: "eve", l: ID },
  { v: "trap", l: ID },
  { v: "trap", l: ID, at: { part: 1, anchor: 2 }, d: ID2 },
  { v: "try" }, // the guide's sandbox (docs/study/guide.md)
  { v: "try", s: "b" },
  { v: "install" }, // adding the app to the home screen (docs/study/install.md)
  { v: "notify" }, // notifications (section R): the inbox
  { v: "notify", x: "set" }, // and its settings
  { v: "sets" }, // practice sets (flags.sets): the shelf
  { v: "sets", l: ID }, // the sets on a lecture
  { v: "sets", k: ID2 }, // a set: being made, then its page
  { v: "practice", s: `k.${ID2}` }, // solving a set
  { v: "models" }, // "השוואת מודלים" (flags.models): the comparisons
  { v: "models", x: "new", k: "solver" }, // a new one, its kind chosen
  { v: "models", x: "board", k: "fix_check" }, // a kind's results
  { v: "models", x: "routes" }, // "מי כותב מה"
  { v: "models", r: ID }, // one run
];

test("routeUrl writes every route of §5.2 and §12.2.1 so parseRoute reads it back exactly", () => {
  const vs = new Set(ALL_ROUTES.map((r) => r.v));
  for (const v of Object.keys(PARAMS)) assert.ok(vs.has(v as Route["v"]), `a route ${v} is checked`);
  for (const r of ALL_ROUTES) {
    const url = routeUrl(r);
    assert.match(url, /^\/(\?|$)/);
    assert.deepEqual(parseRoute(url.includes("?") ? url.slice(url.indexOf("?")) : ""), r, url);
  }
  assert.equal(routeUrl({ v: "today" }), "/", "the home is /");
  assert.equal(routeUrl({ v: "library" }), "/?v=library", "the library is explicit (§12.2.1)");
  assert.equal(routeUrl({ v: "today", run: true }), "/?v=today&run=1");
  assert.equal(routeUrl({ v: "lecture", l: ID }), `/?l=${ID}`, "a lecture link stays ?l=, as WhatsApp links are today");
});

test("old forms, bad ids, dates, slides and values are dropped, and land somewhere sane", () => {
  // the home and its aliases
  assert.deepEqual(parseRoute(""), { v: "today" }, "/ is the home");
  assert.deepEqual(parseRoute("?v=today"), { v: "today" });
  assert.deepEqual(parseRoute("?v=today&run=yes"), { v: "today" });
  assert.deepEqual(parseRoute("?v=library"), { v: "library" });
  assert.deepEqual(parseRoute("?l=not-a-uuid"), { v: "today" }, "a bad lecture id is dropped: the home");
  assert.deepEqual(parseRoute("?join=ABC123"), { v: "today" }, "an invite link's route is the home");
  assert.deepEqual(parseRoute("?%E0%A4%A"), { v: "today" }, "a broken escape never throws");
  // the spec's
  assert.deepEqual(parseRoute(`?v=plan&m=${ID}`), { v: "marathon", m: ID }, "design-platform's marathon link");
  assert.deepEqual(parseRoute(`?v=quiz&q=12345`), { v: "quiz" });
  assert.deepEqual(parseRoute(`?l=${ID}&at=1.x&slide=0`), { v: "lecture", l: ID });
  assert.deepEqual(parseRoute(`?l=${ID}&slide=1000`), { v: "lecture", l: ID });
  assert.deepEqual(parseRoute("?v=nowhere"), { v: "library" }, "unknown v");
  assert.deepEqual(parseRoute(`?v=nowhere&l=${ID}`), { v: "library" });
  assert.deepEqual(parseRoute("?v=help", "#howto"), { v: "help" });
  assert.deepEqual(parseRoute(`?v=ask&first=${"א".repeat(501)}`), { v: "ask" }, "first is at most 500 characters");
  assert.deepEqual(parseRoute(`?v=practice&s=${"x".repeat(201)}`), { v: "practice" }, "s is at most 200 characters");
  assert.deepEqual(parseRoute(`?v=practice&n=15`), { v: "practice" });
  // practice 2.0's steps (x): one of four, only with a lecture and without a session; r only on the bank
  assert.deepEqual(parseRoute(`?v=practice&x=bank`), { v: "practice" }, "a step needs its lecture");
  assert.deepEqual(parseRoute(`?v=practice&x=new`), { v: "practice", x: "new" }, "but practice sets' create screen picks one");
  assert.deepEqual(parseRoute(`?v=practice&l=${ID}&x=review&r=${ID2}`), { v: "practice", l: ID, x: "review", r: ID2 }, "the drafts one by one");
  assert.deepEqual(parseRoute(`?v=practice&l=${ID}&x=round&from=m`), { v: "practice", l: ID, x: "round" }, "from is only the create screen's");
  assert.deepEqual(parseRoute(`?v=practice&l=${ID}&x=new&from=x`), { v: "practice", l: ID, x: "new" }, "from is only m");
  assert.deepEqual(parseRoute(`?v=practice&l=${ID}&x=later`), { v: "practice", l: ID });
  assert.deepEqual(parseRoute(`?v=practice&l=${ID}&x=round&s=l.${ID}`), { v: "practice", l: ID, s: `l.${ID}` }, "a session wins over a step");
  assert.deepEqual(parseRoute(`?v=practice&l=${ID}&x=new&r=${ID2}`), { v: "practice", l: ID, x: "new" }, "r is the bank's request");
  assert.deepEqual(parseRoute(`?v=practice&l=${ID}&x=bank&r=12`), { v: "practice", l: ID, x: "bank" }, "a request is a uuid");
  assert.deepEqual(parseRoute(`?v=marathon&new=yes`), { v: "marathon" }, "flags are '1'");
  // §12.2.1's
  assert.deepEqual(parseRoute(`?v=meeting&m=12`), { v: "meeting" }, "m is a uuid");
  assert.deepEqual(parseRoute(`?v=catchup&l=${ID}&m=x`), { v: "catchup", l: ID });
  assert.deepEqual(parseRoute(`?v=dispute&d=abc`), { v: "library" }, "a yellow card needs its uuid");
  assert.deepEqual(parseRoute(`?v=dispute`), { v: "library" });
  assert.deepEqual(parseRoute(`?v=log`), { v: "library" }, "the log needs its lecture");
  assert.deepEqual(parseRoute(`?v=eve&l=`), { v: "library" }, "the eve view needs its lecture");
  assert.deepEqual(parseRoute(`?v=trap&at=1.2`), { v: "library" }, "a trap needs its lecture");
  assert.deepEqual(parseRoute(`?v=trap&l=${ID}&d=draft-1`), { v: "trap", l: ID }, "a trap's draft is a uuid");
  assert.deepEqual(parseRoute(`?v=wall&d=${"M".repeat(61)}`), { v: "wall" }, "a drug key is at most 60 characters");
  assert.deepEqual(parseRoute(`?v=wall&d=${"M".repeat(60)}`), { v: "wall", d: "M".repeat(60) });
  assert.deepEqual(parseRoute(`?v=wall&t=best&x=photo`), { v: "wall" }, "t and x are one of their values");
  assert.deepEqual(parseRoute(`?v=plan&d=2026-13-40&lane=both`), { v: "plan" }, "a plan's day is a real date; lane one of two");
  assert.deepEqual(parseRoute(`?v=plan&d=2026-12-7`), { v: "plan" }, "YYYY-MM-DD");
  assert.deepEqual(parseRoute(`?v=quiz&preset=lunch&pf=200&pt=-1`), { v: "quiz" }, "preset one of three; pf, pt 0-199");
  assert.deepEqual(parseRoute(`?v=quiz&pf=0&pt=199`), { v: "quiz", pf: 0, pt: 199 });
  assert.deepEqual(parseRoute(`?v=progress&x=all`), { v: "progress" });
  assert.deepEqual(parseRoute(`?v=boss&new=true`), { v: "boss" });
  assert.deepEqual(parseRoute(`?v=practice&s=b.${ID}.0`), { v: "practice" }, "a blank table's slide is 1-999");
  assert.deepEqual(parseRoute(`?v=practice&s=b.${ID}.1000`), { v: "practice" });
  assert.deepEqual(parseRoute(`?v=practice&s=b.lecture.12`), { v: "practice" }, "a blank table's lecture is a uuid");
  assert.deepEqual(parseRoute(`?v=practice&s=p.${ID}.x.3`), { v: "practice" }, "a paragraph is <lecture>.<part>.<anchor>");
  assert.deepEqual(parseRoute(`?v=practice&s=r.me`), { v: "practice" }, "another wording names a group's uuid");
});

test("tabOf: the spec's four tabs, Today's set, and immersive screens with none", () => {
  const off = flagSet([]);
  const today = flagSet(RELEASES.find(([r]) => r === "8")![1]);
  const cases: Array<[Route, ReturnType<typeof tabOf>, ReturnType<typeof tabOf>]> = [
    // route, without flags.today, with it
    [{ v: "today" }, "today", "today"],
    [{ v: "today", run: true }, null, null], // T-1: the day's session is immersive, as every session is
    [{ v: "library" }, "library", "library"],
    [{ v: "ask" }, "library", "library"],
    [{ v: "ask", l: ID }, null, null],
    [{ v: "practice" }, "practice", "today"],
    [{ v: "practice", l: ID }, "practice", "today"],
    [{ v: "practice", s: "m" }, null, null],
    [{ v: "practice", l: ID, x: "new" }, null, null],
    [{ v: "practice", l: ID, x: "bank", r: ID2 }, null, null],
    [{ v: "practice", l: ID, x: "review", r: ID2 }, null, null],
    [{ v: "practice", x: "new" }, null, null],
    [{ v: "practice", l: ID, x: "round" }, null, null],
    [{ v: "exams" }, "practice", "today"],
    [{ v: "exams", isNew: true }, null, null],
    [{ v: "mock", c: ID }, null, null], // the simulation's setup (sources.md, phase 2)
    [{ v: "practice", s: `x.${ID}` }, null, null], // a simulation running
    [{ v: "cards", l: ID }, "practice", "today"],
    [{ v: "cards", s: "today" }, null, null],
    [{ v: "group" }, "group", "group"],
    [{ v: "pulse" }, "group", "group"],
    [{ v: "museum", l: ID }, "group", "group"],
    [{ v: "wall", l: ID }, "group", "group"],
    [{ v: "wall", l: ID, x: "drafts" }, null, null],
    [{ v: "boss" }, "group", "group"],
    [{ v: "boss", isNew: true }, null, null],
    [{ v: "marathon", m: ID }, "group", "group"],
    [{ v: "marathon", isNew: true }, null, null],
    [{ v: "plan" }, "group", "group"],
    [{ v: "plan", lane: "group" }, "group", "group"],
    [{ v: "plan", lane: "mine" }, "me", "me"],
    [{ v: "plan", edit: true }, null, null],
    [{ v: "me" }, "me", "me"],
    [{ v: "progress" }, "me", "me"],
    [{ v: "progress", x: "danger" }, "me", "me"],
    [{ v: "help" }, "me", "me"],
    [{ v: "meeting" }, null, null],
    [{ v: "meeting", m: ID, edit: true }, null, null],
    [{ v: "catchup", l: ID }, null, null],
    [{ v: "log", l: ID }, null, null],
    [{ v: "dispute", d: ID }, null, null],
    [{ v: "eve", l: ID }, null, null],
    [{ v: "trap", l: ID }, null, null],
    [{ v: "lecture", l: ID }, null, null],
    [{ v: "upload" }, null, null],
    [{ v: "upload", c: ID, many: true }, null, null],
    [{ v: "course", c: ID }, "library", "library"],
    [{ v: "ask", c: ID }, null, null],
    [{ v: "quiz", q: ID }, null, null],
    [{ v: "notify" }, null, null], // the inbox: a screen with a back arrow
    [{ v: "notify", x: "set" }, null, null],
    [{ v: "sets" }, "practice", "today"], // the shelf: where the hub is (OD1, no tab of its own)
    [{ v: "sets", l: ID }, "practice", "today"],
    [{ v: "sets", k: ID2 }, null, null], // a set's page: a back arrow
    [{ v: "practice", s: `k.${ID2}` }, null, null],
    [{ v: "models" }, "me", "me"], // "השוואת מודלים" opens from "שלי"
    [{ v: "models", x: "routes" }, "me", "me"],
    [{ v: "models", x: "board", k: "solver" }, "me", "me"],
    [{ v: "models", x: "new" }, null, null], // a new comparison: a back arrow
    [{ v: "models", r: ID }, null, null], // a run: a back arrow
  ];
  for (const [r, without, withToday] of cases) {
    assert.equal(tabOf(r, off), without, `${routeUrl(r)} without Today`);
    assert.equal(tabOf(r, today), withToday, `${routeUrl(r)} with Today`);
  }
});

/* ── releases (§12.7.6: the approved phases; each adds to the one before) ── */
/** Release 1 (docs/study/RELEASE-1.md): practice and the flashcards, before the rest. */
const R1 = ["QUESTIONS", "PRACTICE", "CARDS"];
/** Release 2 (docs/study/quiz.md): release 1 and the group quiz. */
const R2 = [...R1, "QUIZ"];
/** Every end of §12.3 built, as the approved releases have them. */
const ALL_ENDS: Ends = { Q: true, C: true, B: true };
const R4 = ["QUESTIONS", "PRACTICE", "QUIZ", "MEETING", "ANCHOR"];
const R5 = [...R4, "CARDS"];
const R6 = [...R5, "CORRECTIONS", "VAR", "ASK", "WALL"];
/** The withdrawn release 7 (A1, accounts with an email code): decision 1 of
 *  17 Nov 2026 leaves VITE_STUDY_ACCOUNT unset. The set stays, to show the
 *  flag alone opens nothing else. */
const R7 = [...R6, "ACCOUNT"];
/** Release 8 needs no account (decision 1): release 6's set and its own flags. */
const R8 = [...R6, "PROGRESS", "CARDS_REVIEW", "TODAY", "GUESS", "PULSE"];
const R9 = [...R8, "MARATHONS", "GROUP_PLAN", "BOSS", "MUSEUM", "TRAPS", "BLANK_TABLE", "NEEDS_ME", "EVE"];
const R12 = [...R9, "PDF", "RECORDINGS", "EXAMS"];
const RELEASES: Array<[string, string[]]> = [
  ["1-2", []],
  ["release 1 (practice and cards)", R1],
  ["release 2 (and the group quiz)", R2],
  ["4", R4],
  ["5", R5],
  ["6", R6],
  ["7 (withdrawn: the account)", R7],
  ["8", R8],
  ["9", R9],
  ["10", [...R9, "PDF"]],
  ["11", [...R9, "PDF", "RECORDINGS"]],
  ["12", R12],
  ["courses (sources.md, phase 1)", [...R12, "COURSES"]],
  ["courses without ask", ["COURSES", "QUESTIONS", "PRACTICE"]],
  ["every flag (QUIZ_ROUNDS too)", [...R12, "QUIZ_ROUNDS", "FAKE_ASR"]],
  ["every flag but TODAY", [...R12, "QUIZ_ROUNDS"].filter((f) => f !== "TODAY")],
  ["cards only", ["CARDS"]],
  ["questions without practice", ["QUESTIONS"]],
  ["corrections without VAR", ["CORRECTIONS"]],
  ["the wall without the pulse", ["WALL"]],
  ["marathons without the group's plan", ["MARATHONS"]],
  ["the plan without marathons", ["GROUP_PLAN"]],
  // T-1 (wave 5): Today waits only for its own flag (decision 1 of 17 Nov 2026).
  ["Today alone", ["TODAY"]],
  ["Today on production's set", [...R1, "TODAY"]],
  ["Today and the in-app review on production's set", [...R1, "TODAY", "CARDS_REVIEW"]],
];
function flagSet(names: string[]): Flags {
  return flagsFrom(Object.fromEntries(names.map((n) => [`VITE_STUDY_${n}`, "1"])));
}

/** When a route is on, written from §5.2's and §12.2.1's flag rules independently of allowed(). */
const SAMPLES: Array<[Route, (f: Flags) => boolean]> = [
  [{ v: "library" }, () => true],
  [{ v: "upload" }, () => true],
  [{ v: "help" }, () => true],
  [{ v: "group" }, () => true],
  [{ v: "me" }, () => true],
  [{ v: "lecture", l: ID, at: { part: 1, anchor: 3 } }, () => true],
  [{ v: "lecture", l: ID, slide: 7, read: true }, () => true],
  [{ v: "practice" }, (f) => f.questions],
  [{ v: "practice", l: ID }, (f) => f.questions],
  [{ v: "practice", s: `l.${ID}` }, (f) => f.practice],
  [{ v: "practice", l: ID, s: `l.${ID}`, n: "10" }, (f) => f.practice],
  [{ v: "practice", s: "c.פרמקולוגיה" }, (f) => f.practice],
  [{ v: "practice", s: "t.mechanism" }, (f) => f.practice],
  [{ v: "practice", s: "m" }, (f) => f.practice && f.progress],
  [{ v: "practice", s: `m.${ID}` }, (f) => f.practice && f.progress],
  [{ v: "practice", s: `e.${ID}` }, (f) => f.practice && f.exams],
  [{ v: "practice", s: `q.${ID}` }, (f) => f.practice && f.quiz],
  [{ v: "practice", s: `p.${ID}.1.3` }, (f) => f.practice && f.anchor],
  [{ v: "practice", s: `b.${ID}.12` }, (f) => f.practice && f.cards && f.blankTable],
  [{ v: "practice", s: `r.${ID2}` }, (f) => f.practice && f.progress],
  [{ v: "practice", l: ID, x: "new" }, (f) => f.questions],
  [{ v: "practice", l: ID, x: "example" }, (f) => f.questions],
  [{ v: "practice", l: ID, x: "bank", r: ID2 }, (f) => f.questions],
  [{ v: "practice", l: ID, x: "review", r: ID2 }, (f) => f.questions && f.make],
  [{ v: "practice", x: "new" }, (f) => f.make],
  [{ v: "practice", l: ID, x: "new", from: "m" }, (f) => f.make],
  [{ v: "practice", l: ID, x: "round" }, (f) => f.practice],
  [{ v: "exams" }, (f) => f.exams],
  [{ v: "exams", e: ID }, (f) => f.exams],
  [{ v: "exams", isNew: true }, (f) => f.exams],
  [{ v: "mock", c: ID }, (f) => f.exams],
  [{ v: "practice", s: `x.${ID}` }, (f) => f.practice && f.exams],
  [{ v: "practice", s: `w.${ID}` }, (f) => f.practice && f.exams],
  [{ v: "quiz", q: ID }, (f) => f.quiz],
  [{ v: "quiz", isNew: true, l: ID }, (f) => f.quiz],
  [{ v: "quiz", isNew: true, l: ID, m: ID2, preset: "end", pf: 0, pt: 3 }, (f) => f.quiz],
  [{ v: "cards" }, (f) => f.cards],
  [{ v: "cards", l: ID }, (f) => f.cards],
  [{ v: "cards", s: "today" }, (f) => f.cardsReview],
  [{ v: "cards", s: `l.${ID}` }, (f) => f.cardsReview],
  [{ v: "ask" }, (f) => f.ask],
  [{ v: "ask", l: ID, at: { part: 2, anchor: 4 } }, (f) => f.ask],
  [{ v: "ask", first: "שאלה" }, (f) => f.ask],
  [{ v: "ask", c: ID }, (f) => f.ask && f.courses],
  [{ v: "course", c: ID }, (f) => f.courses],
  [{ v: "course", c: ID, seg: "lectures" }, (f) => f.courses],
  [{ v: "upload", c: ID, many: true }, (f) => f.courses],
  [{ v: "upload", many: true }, (f) => f.courses],
  [{ v: "progress" }, (f) => f.progress],
  [{ v: "progress", t: "mechanism" }, (f) => f.progress],
  [{ v: "progress", x: "danger" }, (f) => f.progress],
  [{ v: "marathon", m: ID }, (f) => f.marathons],
  [{ v: "marathon", isNew: true }, (f) => f.marathons],
  [{ v: "plan" }, (f) => f.marathons && f.groupPlan],
  [{ v: "plan", edit: true }, (f) => f.marathons && f.groupPlan],
  [{ v: "plan", lane: "mine", d: "2026-12-07" }, (f) => f.marathons && f.groupPlan],
  [{ v: "meeting" }, (f) => f.quiz && f.meeting],
  [{ v: "meeting", m: ID, edit: true }, (f) => f.quiz && f.meeting],
  [{ v: "catchup", l: ID }, (f) => f.quiz && f.meeting && f.guess],
  [{ v: "catchup", m: ID }, (f) => f.quiz && f.meeting && f.guess],
  [{ v: "log", l: ID }, (f) => f.corrections && f.var],
  [{ v: "dispute", d: ID }, (f) => f.corrections && f.var],
  [{ v: "pulse" }, (f) => f.progress && f.pulse],
  [{ v: "pulse", l: ID }, (f) => f.progress && f.pulse],
  [{ v: "museum", l: ID }, (f) => f.pulse && f.cards && f.museum],
  [{ v: "wall", l: ID }, (f) => f.wall],
  [{ v: "wall", d: "Miltefosine", t: "top" }, (f) => f.wall],
  [{ v: "wall", l: ID, t: "needed" }, (f) => f.wall && f.pulse],
  [{ v: "wall", l: ID, at: { part: 1, anchor: 2 }, x: "drafts" }, (f) => f.wall],
  [{ v: "boss" }, (f) => f.pulse && f.quiz && f.boss],
  [{ v: "boss", isNew: true, l: ID }, (f) => f.pulse && f.quiz && f.boss],
  [{ v: "eve", l: ID }, (f) => f.progress && f.eve],
  [{ v: "trap", l: ID, at: { part: 1, anchor: 2 } }, (f) => f.questions && f.traps],
  [{ v: "sets" }, (f) => f.sets],
  [{ v: "sets", l: ID }, (f) => f.sets],
  [{ v: "sets", k: ID2 }, (f) => f.sets],
  [{ v: "practice", s: `k.${ID2}` }, (f) => f.sets],
];

test("under every release's flags, allowed() replaces exactly the routes that are off, always with a notice", () => {
  for (const [release, names] of RELEASES) {
    const f = flagSet(names);
    for (const [r, on] of SAMPLES) {
      const got = allowed(r, f);
      const where = `release ${release}: ${routeUrl(r)}`;
      if (on(f)) {
        assert.deepEqual(got.route, r, `${where} is on`);
        assert.equal(got.notice, undefined, `${where} has no notice`);
      } else {
        assert.notDeepEqual(got.route, r, `${where} is replaced`);
        assert.ok(got.notice && Object.values(NOTICE).includes(got.notice as never), `${where} says why`);
        assert.deepEqual(allowed(got.route, f), { route: got.route }, `${where} → ${routeUrl(got.route)}, which is on`);
      }
    }
  }
});

test("the home: Today with flags.today, else the library with no notice (decision 6 with decision 12)", () => {
  for (const [release, names] of RELEASES) {
    const f = flagSet(names);
    for (const home of [{ v: "today" } as Route, { v: "today", run: true } as Route]) {
      const got = allowed(home, f);
      if (f.today) assert.deepEqual(got, { route: home }, `release ${release}: ${routeUrl(home)}`);
      else assert.deepEqual(got, { route: { v: "library" } }, `release ${release}: ${routeUrl(home)} is the library, and says nothing`);
    }
    // Decision 1 (17 Nov 2026): Today waits only for VITE_STUDY_TODAY; its rows wait for theirs.
    assert.equal(f.today, names.includes("TODAY"), `release ${release}: Today is its own flag's`);
  }
});

test("the replacements say the right thing and stay near (§5.2, §12.2.1)", () => {
  const r4 = flagSet(R4);
  assert.deepEqual(allowed({ v: "practice", s: `m.${ID}` }, r4), { route: { v: "practice", l: ID }, notice: NOTICE.mistakes });
  assert.deepEqual(allowed({ v: "practice", s: "m" }, r4), { route: { v: "practice" }, notice: NOTICE.mistakes });
  assert.deepEqual(allowed({ v: "practice", s: `r.${ID2}` }, r4), { route: { v: "practice" }, notice: NOTICE.mistakes }, "another wording waits for progress (A2), not for an account");
  assert.deepEqual(allowed({ v: "practice", s: `b.${ID}.12` }, r4), { route: { v: "practice", l: ID }, notice: NOTICE.off }, "a blank table: the lecture's practice");
  const r5 = flagSet(R5);
  assert.deepEqual(allowed({ v: "cards", s: "today" }, r5), { route: { v: "cards" }, notice: NOTICE.cardsReview });
  assert.deepEqual(allowed({ v: "cards", s: `l.${ID}` }, r5), { route: { v: "cards", l: ID }, notice: NOTICE.cardsReview });
  assert.deepEqual(allowed({ v: "log", l: ID }, r5), { route: { v: "lecture", l: ID }, notice: NOTICE.off }, "the log: its lecture");
  assert.deepEqual(allowed({ v: "wall", l: ID, x: "drafts" }, r5), { route: { v: "lecture", l: ID }, notice: NOTICE.off }, "the wall: its lecture");
  assert.deepEqual(allowed({ v: "trap", l: ID, at: { part: 1, anchor: 2 } }, r5), { route: { v: "lecture", l: ID, at: { part: 1, anchor: 2 } }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "eve", l: ID }, r5), { route: { v: "lecture", l: ID }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "catchup", l: ID }, r5), { route: { v: "lecture", l: ID }, notice: NOTICE.off }, "catch-up waits for M-2's flag (GUESS)");
  const r6 = flagSet(R6);
  assert.deepEqual(allowed({ v: "wall", l: ID, t: "needed" }, r6), { route: { v: "wall", l: ID, t: "top" }, notice: NOTICE.off }, "דרושות needs the pulse: הכי טובות");
  assert.deepEqual(allowed({ v: "pulse", l: ID }, r6), { route: { v: "group" }, notice: NOTICE.off });
  // the plan: the group's (G), else the marathons (A2 builds no private plan, review F-7), else the library
  assert.deepEqual(allowed({ v: "plan" }, flagSet(R8)), { route: { v: "library" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "plan", lane: "mine" }, flagSet(["MARATHONS"])), { route: { v: "marathon" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "plan" }, flagSet(["GROUP_PLAN"])), { route: { v: "library" }, notice: NOTICE.off }, "the group's plan rides on the marathons");
  assert.deepEqual(allowed({ v: "plan", d: "2026-12-07" }, flagSet(R9)), { route: { v: "plan", d: "2026-12-07" } });
  const cardsOnly = flagSet(["CARDS"]);
  assert.deepEqual(allowed({ v: "practice", l: ID }, cardsOnly), { route: { v: "cards", l: ID }, notice: NOTICE.off }, "practice → cards when only cards are on");
  const none = flagSet([]);
  assert.deepEqual(allowed({ v: "quiz", q: ID }, none), { route: { v: "library" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "ask", l: ID, at: { part: 1, anchor: 2 } }, none), { route: { v: "lecture", l: ID, at: { part: 1, anchor: 2 } }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "marathon", m: ID }, none), { route: { v: "group" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "meeting", m: ID }, none), { route: { v: "group" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "dispute", d: ID }, none), { route: { v: "group" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "progress", x: "danger" }, none), { route: { v: "me" }, notice: NOTICE.off });
  // Courses (sources.md, phase 1): without the course pages, the library, one lecture's upload, the library's question.
  assert.deepEqual(allowed({ v: "course", c: ID }, none), { route: { v: "library" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "upload", c: ID, many: true }, none), { route: { v: "upload" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "ask", c: ID }, flagSet(["ASK"])), { route: { v: "ask" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "ask", c: ID }, flagSet(["COURSES"])), { route: { v: "course", c: ID }, notice: NOTICE.off }, "the course page, without לשאול");
});

/** Every link F's own screens make under a flag set. */
function fLinks(f: Flags): Route[] {
  return [
    ...tabLinks(f).map((t) => t.route),
    ...lectureChips(ID, f).map((c) => c.route),
    ...[afterReading(ID, f)].filter((r): r is Route => r !== null),
    ...meLinks(f).map((m) => m.route),
    { v: "help" },
    { v: "upload" },
    { v: "group" },
    { v: "lecture", l: ID, at: { part: 0, anchor: 2 } },
    { v: "lecture", l: ID, follow: true },
  ];
}

test("no control of F's screens links to a route allowed() replaces, under any release's flags", () => {
  for (const [release, names] of RELEASES) {
    const f = flagSet(names);
    for (const r of fLinks(f)) assert.deepEqual(allowed(r, f), { route: r }, `release ${release}: ${routeUrl(r)}`);
  }
});

test("the tab bar (F-2): the spec's four tabs until Today, then היום · ספרייה · יחד · שלי with no תרגול", () => {
  assert.deepEqual(tabLinks(flagSet([])).map((t) => t.label), ["ספרייה", "יחד", "שלי"]);
  assert.deepEqual(tabLinks(flagSet(["QUESTIONS"])).map((t) => t.label), ["ספרייה", "תרגול", "יחד", "שלי"]);
  for (const [release, names] of RELEASES) {
    const f = flagSet(names);
    const tabs = tabLinks(f);
    if (f.today) {
      assert.deepEqual(tabs.map((t) => t.label), ["היום", "ספרייה", "יחד", "שלי"], `release ${release}`);
      assert.deepEqual(tabs.map((t) => routeUrl(t.route)), ["/", "/?v=library", "/?v=group", "/?v=me"], `release ${release}: היום is /, ספרייה ?v=library`);
    } else {
      assert.deepEqual(tabs.map((t) => t.label), ["ספרייה", ...(f.questions || f.cards ? ["תרגול"] : []), "יחד", "שלי"], `release ${release}`);
    }
    // Every tab marks itself: the screen it opens belongs to it.
    for (const t of tabs) assert.equal(tabOf(allowed(t.route, f).route, f), t.tab, `release ${release}: the ${t.label} tab`);
  }
  assert.deepEqual(practiceTab(flagSet(["CARDS"])), { v: "cards" });
  assert.deepEqual(practiceTab(flagSet(["QUESTIONS", "CARDS"])), { v: "practice" });
  assert.deepEqual(lectureChips(ID, flagSet([])), []);
  assert.deepEqual(lectureChips(ID, flagSet(R6)).map((c) => c.label), ["תרגול", "כרטיסיות", "מבחן קבוצתי", "לשאול"]);
});

test("the schema a build needs follows its flags (§2.11, §12.2.2): F and W always, the ends at 2, never B", () => {
  assert.deepEqual(requiredSchema(flagSet([]), ALL_ENDS), { F: 1, W: 1 }, "every build writes through section W (W1)");
  assert.deepEqual(requiredSchema(flagSet(R4), ALL_ENDS), { F: 1, W: 1, Q: 2, Z: 2, M: 2, N: 1 });
  // Corrections wait for W2's hardening (§3.7, review M1): W 2 with them.
  assert.deepEqual(requiredSchema(flagSet(R6), ALL_ENDS), { F: 1, W: 2, Q: 2, Z: 2, C: 2, K: 2, M: 2, N: 1, V: 1, J: 1 });
  // Decision 1 (17 Nov 2026): no account, so section A only for the withdrawn ACCOUNT flag.
  assert.deepEqual(requiredSchema(flagSet(R8), ALL_ENDS), { F: 1, W: 2, Q: 2, Z: 2, C: 2, K: 2, P: 2, M: 2, N: 1, V: 1, T: 1, U: 1, J: 1 });
  // Wave 5's phase 3 (decision 3: usable early): T-2 ("הקבוצה צריכה אותך", NEEDS_ME) is section T's end (T at 2);
  // the museum and the boss need U's traps (U at 2).
  // Its EXAMS flag: past exams (sources.md phase 2) need the course pages too, which R12 has not: no S.
  assert.deepEqual(requiredSchema(flagSet(R12), ALL_ENDS), { F: 1, Q: 2, Z: 2, C: 2, K: 2, P: 2, W: 2, M: 2, N: 1, V: 1, T: 3, U: 2, J: 1, H: 2, G: 2, E: 1 });
  assert.deepEqual(requiredSchema(flagSet([...R12, "COURSES"]), ALL_ENDS).S, 2, "with the course pages, section S at 2");
  assert.deepEqual(requiredSchema(flagSet([...R8, "MUSEUM"]), ALL_ENDS), { F: 1, W: 2, Q: 2, Z: 2, C: 2, K: 2, P: 2, M: 2, N: 1, V: 1, T: 1, U: 2, J: 1 });
  assert.deepEqual(requiredSchema(flagSet([...R8, "BOSS"]), ALL_ENDS), { F: 1, W: 2, Q: 2, Z: 2, C: 2, K: 2, P: 2, M: 2, N: 1, V: 1, T: 1, U: 2, J: 1, H: 2 });
  assert.deepEqual(requiredSchema(flagSet(["MUSEUM", "BOSS"]), ALL_ENDS), { F: 1, W: 1 }, "without the pulse the museum and the boss show nothing and need nothing");
  assert.deepEqual(requiredSchema(flagSet(["TODAY", "NEEDS_ME"]), ALL_ENDS), { F: 1, W: 1, T: 3 }, "T-2: section T's end, with one question shown once (T 3)");
  assert.deepEqual(requiredSchema(flagSet(["NEEDS_ME"]), ALL_ENDS), { F: 1, W: 1 }, "without Today, NEEDS_ME shows nothing and needs nothing");
  assert.deepEqual(requiredSchema(flagSet(["MARATHONS", "GROUP_PLAN"]), ALL_ENDS), { F: 1, W: 1, P: 2, G: 2 }, "the group's plan: section G at 2 (its meter counts to the study day's start), its days P's marathons");
  assert.deepEqual(requiredSchema(flagSet(["PROGRESS", "EVE"]), ALL_ENDS), { F: 1, W: 1, P: 2 }, "the exam-eve view reads P's danger list (and J's wall when it is on)");
  assert.deepEqual(requiredSchema(flagSet(["PROGRESS"]), ALL_ENDS), { F: 1, W: 1, P: 2 }, "progress: P's end, no section A");
  assert.deepEqual(requiredSchema(flagSet([...R1, "PROGRESS"]), ALL_ENDS), { F: 1, W: 1, Q: 2, C: 2, P: 2 }, "\"הטעויות שלי\" and another wording: Q's end and P's");
  assert.deepEqual(requiredSchema(flagSet(["ACCOUNT"]), ALL_ENDS), { F: 1, W: 1, A: 1 }, "the withdrawn account flag alone still asks for its section");
  assert.deepEqual(requiredSchema(flagSet(["ASK"]), ALL_ENDS), { F: 1, W: 1, K: 2 });
  assert.deepEqual(requiredSchema(flagSet(["CORRECTIONS"]), ALL_ENDS), { F: 1, W: 2, K: 2 }, "corrections: K's end and W2");
  assert.deepEqual(requiredSchema(flagSet(["CARDS", "BLANK_TABLE"]), ALL_ENDS), { F: 1, W: 1, C: 2 }, "a blank table needs practice");
  assert.deepEqual(requiredSchema(flagSet(["COURSES"]), ALL_ENDS), { F: 1, W: 1, S: 1 }, "courses: section S at 1 (sources.md B8)");
  // Past exams live in their course and are practised in sessions: COURSES and PRACTICE too.
  assert.deepEqual(requiredSchema(flagSet(["QUESTIONS", "PRACTICE", "COURSES", "EXAMS"]), ALL_ENDS), { F: 1, W: 1, Q: 2, S: 2 }, "past exams and their simulation: section S at 2, which has S 1 in it (sources.md B8)");
  assert.deepEqual(requiredSchema(flagSet(["QUESTIONS", "EXAMS"]), ALL_ENDS), { F: 1, W: 1, Q: 2 }, "past exams without the course pages and practice show nothing and need nothing more");
  assert.deepEqual(requiredSchema(flagSet(["EXAMS"]), ALL_ENDS), { F: 1, W: 1 }, "past exams without questions show nothing and need nothing");
  for (const [release, names] of RELEASES) {
    assert.ok(!("B" in requiredSchema(flagSet(names), ALL_ENDS)), `release ${release}: never B (review F-5)`);
    assert.ok(!("B" in requiredSchema(flagSet(names))), `release ${release}: never B (review F-5)`);
  }
});

/** The registry the SQL of this branch writes (every section's
 *  "insert into study_private.schema_sections … values ('Q', 1)"): what
 *  production's study_schema() answers once the release's SQL has run. */
function sqlRegistry(): Record<string, number> {
  const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  const out: Record<string, number> = {};
  for (const m of sql.matchAll(/insert into study_private\.schema_sections \(section, version\) values \('([A-Z])', (\d+)\)/g)) out[m[1]] = Math.max(out[m[1]] ?? 0, Number(m[2]));
  return out;
}

test("releases 1 and 2 on this branch: with Q's and C's ends questions and practice need section Q at 2, cards C at 2, the quiz Z at 2 (its end), every build W at 1, all of which this branch's SQL registers (no schema gate)", () => {
  assert.deepEqual(ENDS, { Q: true, C: true, B: true }, "this branch has Q's end (practice 2.0), C's end and B as decision 2 of 17 Nov 2026 redefines it");
  assert.deepEqual(requiredSchema(flagSet(R1)), { F: 1, W: 1, Q: 2, C: 2 });
  assert.deepEqual(requiredSchema(flagSet(R2)), { F: 1, W: 1, Q: 2, Z: 2, C: 2 }, "release 2's flags: the quiz needs section Z with its end, the cards section C with its end");
  // Release 2 as it shipped (Q's end only): C at 1; release 1 as it shipped (no ends): Q at 1.
  assert.deepEqual(requiredSchema(flagSet(R2), { Q: true, C: false, B: false }), { F: 1, W: 1, Q: 2, Z: 2, C: 1 });
  assert.deepEqual(requiredSchema(flagSet(R1), { Q: false, C: false, B: false }), { F: 1, W: 1, Q: 1, C: 1 });
  // The cards' review flag (decision 1: no account) needs nothing more than the cards.
  assert.deepEqual(requiredSchema(flagSet([...R2, "CARDS_REVIEW"])), requiredSchema(flagSet(R2)));
  // Today needs section T alone (its other sources are read by name, section T §12.4.T).
  assert.deepEqual(requiredSchema(flagSet(["TODAY"])), { F: 1, W: 1, T: 1 });
  const have = sqlRegistry();
  assert.deepEqual(
    have,
    { F: 1, W: 2, Q: 3, Z: 4, C: 3, K: 2, P: 2, M: 3, N: 1, B: 1, V: 1, J: 1, U: 5, H: 4, G: 2, E: 1, T: 3, X: 2, S: 2, I: 1, R: 2, L: 1, O: 3, Y: 1 },
    "section F at version 1, W at 2 (W1 with W2's hardening), Q at 3 (Q's end, practice 2.0 and the question types' columns), Z at 4 (section Z with its end, one-answer questions only, the opening called שאלות פתיחה), C at 3 (C's end, the question types' cards), K at 2 (K's end), P at 2 (A2: P's end), M at 3 (the day's meeting, no reader planned ahead, text-only guesses), N at 1 (the paragraph anchor), B at 1 (the points read ahead), V at 1 (disputes and VAR), J at 1 (the association wall), U at 5 (the anonymous counts, the pulse, and U-3's traps and museum, of text questions, a common mistake's card in plain words, old cards too), H at 4 (the boss battle, its heads and rounds unreadable from the table, one-answer questions, named אתגר קבוצתי), G at 2 (the group's marathon plan, its meter counting to the study day's start), E at 1 (a member's own trap, the blank table's tables), T at 3 (Today with T-2's end, one question shown once), X at 2 (the question types, the geometry's numbers checked), S at 2 (courses and past exams, sources.md) I at 1 (the personal code, which no flag asks for: the app shows it only when health says codes), R at 2 (notifications and the inbox, with R 2's hooks; the app asks for R 1), L at 1 (practice sets, part 10) O at 3 (uploaded sheets, releases A0 and A1 in part 11, and B's similar questions in part 12) and Y at 1 (models: routes and the comparison, after O 3 in part 12, which no flag asks for yet)",
  );
  // Package U: the pulse needs section U at 1, which this SQL registers. Its flag
  // depends on PROGRESS (flags.ts: the pulse's "אצלך" sits with progress), whose
  // section P (at 2) is package A2's: wave 5's integration joins them.
  const u = requiredSchema(flagSet([...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS", "PROGRESS", "PULSE"]));
  assert.equal(u.U, 1, "the pulse needs U 1 (U 2 with the museum or the boss)");
  assert.ok((have.U ?? 0) >= u.U, "and the SQL has it");
  assert.deepEqual(requiredSchema(flagSet(["PULSE"])), { F: 1, W: 1 }, "without PROGRESS the pulse flag shows nothing and needs nothing");
  // Package N's flag on release 1's or release 2's set: section N is in the SQL too; V's with
  // corrections, J's, and package M's two flags on release 2's set (the meeting needs the quiz),
  // with wave 3's, and all of wave 4's together: their sections are in it.
  for (const names of [
    R1,
    R2,
    [...R1, "ANCHOR"],
    [...R2, "ANCHOR"],
    [...R2, "CORRECTIONS", "VAR"],
    [...R2, "WALL"],
    [...R2, "MEETING"],
    [...R2, "MEETING", "GUESS"],
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "MEETING", "GUESS"],
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS"],
    // A2 and Q-2 (wave 5): progress and "הטעויות שלי" on production's set and on wave 4's.
    [...R1, "PROGRESS"],
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS", "PROGRESS"],
    // Package T-1 and C's review (wave 5): Today and the in-app review on production's set and on
    // wave 4's: section T (the cards' review needs nothing more than section C).
    [...R1, "TODAY", "CARDS_REVIEW"],
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS", "TODAY", "CARDS_REVIEW"],
    // Wave 5 together: release 8's flags (PROGRESS, CARDS_REVIEW, TODAY, GUESS, PULSE) on
    // production's set and on wave 4's: sections P, U and T with the rest.
    [...R1, "PROGRESS", "CARDS_REVIEW", "TODAY", "GUESS", "PULSE"],
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS", "PROGRESS", "CARDS_REVIEW", "TODAY", "PULSE"],
    // U-3's museum and H's boss (wave 5, phase 3 usable early, decision 3) on production's set and
    // on wave 5's: sections U at 2 and H with the rest.
    [...R2, "PROGRESS", "PULSE", "MUSEUM", "BOSS"],
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS", "PROGRESS", "CARDS_REVIEW", "TODAY", "PULSE", "MUSEUM", "BOSS"],
    // Package G and T-2 (wave 5, decision 3: usable early): the plan and marathons, "הקבוצה צריכה
    // אותך" and the exam-eve view, on production's set, on wave 4's and on release 8's: sections G
    // and T at 2 with the rest.
    [...R1, "MARATHONS", "GROUP_PLAN", "TODAY", "NEEDS_ME", "PROGRESS", "EVE"],
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS", "MARATHONS", "GROUP_PLAN", "TODAY", "NEEDS_ME", "PROGRESS", "EVE"],
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS", "PROGRESS", "CARDS_REVIEW", "TODAY", "PULSE", "MARATHONS", "GROUP_PLAN", "NEEDS_ME", "EVE"],
    // Package E (wave 5, phase 3 usable early by decision 3): a member's own trap and the blank
    // table on production's set and on wave 5's: section E with the rest.
    [...R1, "TRAPS", "BLANK_TABLE"],
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS", "PROGRESS", "CARDS_REVIEW", "TODAY", "PULSE", "TRAPS", "BLANK_TABLE"],
    // Wave 5 with every phase-3 extra (decision 3; the e2e set "w5x"): release 8's flags with
    // H's, U-3's, G's, T-2's, the eve's and E's: sections U at 2, H, G, E and T at 2 with the rest.
    [...R2, "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS", "PROGRESS", "CARDS_REVIEW", "TODAY", "PULSE", "MUSEUM", "BOSS", "MARATHONS", "GROUP_PLAN", "NEEDS_ME", "EVE", "TRAPS", "BLANK_TABLE", "QUIZ_ROUNDS"],
  ]) {
    for (const [section, version] of Object.entries(requiredSchema(flagSet(names)))) assert.ok((have[section] ?? 0) >= version, `${section} ${version}: the SQL has ${have[section]}`);
    // Each flag alone, too: what a build with any of them needs is in the SQL.
    for (const name of names) for (const [section, version] of Object.entries(requiredSchema(flagSet([name])))) assert.ok((have[section] ?? 0) >= version, `${name}: ${section} ${version}`);
  }
});

test("Back's words name where it goes, in the spec's or the approved screens' words (§5.1, §6.4)", () => {
  assert.equal(screenKey({ v: "ask" }), "library", "the library's ask bar is the library");
  assert.equal(screenKey({ v: "ask", l: ID }), "ask");
  assert.equal(screenKey({ v: "lecture", l: ID }), "lecture");
  assert.equal(BACK_LABEL.library, "→ לספרייה");
  assert.equal(BACK_LABEL.today, "→ להיום");
  assert.equal(BACK_LABEL.group, "→ יחד");
  assert.equal(BACK_LABEL.me, "→ שלי");
  assert.equal(screenKey({ v: "course", c: ID }), "course");
  assert.equal(BACK_LABEL.course, "→ לקורס", "the course page (sources.md's mockups)");
  assert.equal(BACK_LABEL.exams, "→ למבחן", "one past exam (sources.md, phase 2; shorter in the guidance pass, COPY.md)");
  assert.equal(BACK_LABEL.mock, "→ לסימולציה", "the simulation's setup");
  const s6 = spec.slice(spec.indexOf("## 6. The Hebrew copy deck"), spec.indexOf("## 7. Work packages"));
  const s51 = spec.slice(spec.indexOf("### 5.1 The shell"), spec.indexOf("### 5.2 Routes"));
  const mockups = join(process.cwd(), "docs", "study", "proposal", "mockups");
  const approved = readdirSync(mockups)
    .filter((f) => f.endsWith(".html"))
    .map((f) => readFileSync(join(mockups, f), "utf8"))
    .join("\n");
  for (const words of Object.values(BACK_LABEL)) {
    const plain = [...COPY_NOW.values()].includes(words) || COPY_WORDS.includes(words); // the plain copy pass (docs/study/COPY.md)
    assert.ok(s6.includes(`- ${words}\n`) || s51.includes(`"${words}"`) || approved.includes(`>${words}<`) || plain, `${words} is the spec's, an approved screen's or the plain copy's`);
  }
  // Every screen a tab opens has its own words, so a screen opened from a tab says where Back goes.
  for (const [release, names] of RELEASES) {
    for (const t of tabLinks(flagSet(names))) assert.ok(BACK_LABEL[screenKey(t.route)], `release ${release}: the ${t.label} tab`);
  }
});

test("F's words promise a return tomorrow only where something brings it back (decision 1 lifts §12.7.6's gating rule)", () => {
  // A return promise: something comes back to you tomorrow ("חוזרת מחר", "תחזור אליך מחר").
  const PROMISE = /(?:חוזר|חוזרת|חוזרים|תחזור|יחזור|יחזרו)(?:\s+\S+){0,3}\s+מחר(?![א-ת])/;
  // Decision 1 (17 Nov 2026): no screen waits for an account, and a chip may
  // promise "מחר" when something really brings the item back: "הטעויות שלי"
  // with another wording (Q-2, with progress), Today, or the anchor's chip.
  // Without any of them, nothing brings a thing back, so nothing may say so.
  const bringsBack = (f: Flags) => f.mistakes || f.today || f.anchor;
  for (const [release, names, ends] of [
    ...RELEASES.map(([r, n]) => [r, n, ALL_ENDS] as const),
    ["release 1 (practice and cards)", R1, ENDS] as const,
    ["release 2 (and the group quiz)", R2, ENDS] as const,
  ]) {
    const f = flagSet([...names]);
    const words = [
      ...helpRows(f, { serverWrites: true, devicePrint: true }, ends).flatMap((r) => [r.title, r.text]),
      ...tabLinks(f).map((t) => t.label),
      ...lectureChips(ID, f).map((c) => c.label),
      ...meLinks(f).map((m) => m.label),
      ...Object.values(NOTICE),
    ];
    if (!bringsBack(f)) for (const w of words) assert.ok(!PROMISE.test(w), `${release}: "${w}"`);
    // The notices are said when a screen is off: they never promise.
    for (const w of Object.values(NOTICE)) assert.ok(!PROMISE.test(w), `${release}: the notice "${w}"`);
  }
  // With "הטעויות שלי" on, help says a mistake comes back tomorrow in another wording.
  for (const names of [R8, [...R1, "PROGRESS"]]) {
    const f = flagSet(names);
    assert.ok(f.mistakes);
    assert.ok(helpRows(f, { serverWrites: true, devicePrint: true }, ALL_ENDS).some((r) => PROMISE.test(r.text)), `${names.join(",")}: help promises the return`);
  }
  // The pattern is not empty.
  assert.ok(PROMISE.test("השאלה חוזרת אליך מחר.") && PROMISE.test("טעות · ׳נראה לי׳ חוזרת מחר בניסוח אחר"));
});

test("VITE_STUDY_NOTIFY: its own flag, which needs section R at 1 and changes nothing else", () => {
  const off = flagsFrom({ VITE_STUDY_GUIDE: "1", VITE_STUDY_INSTALL: "1" });
  const on = flagsFrom({ VITE_STUDY_GUIDE: "1", VITE_STUDY_INSTALL: "1", VITE_STUDY_NOTIFY: "1" });
  assert.equal(off.notify, false);
  assert.equal(on.notify, true);
  assert.deepEqual({ ...on, notify: false }, off);
  assert.deepEqual(requiredSchema(on), { ...requiredSchema(off), R: 1 });
  assert.equal(requiredSchema(off).R, undefined);
});

test("?v=notify: the inbox and its settings with the flag; without it, the home, with no notice", () => {
  const on = flagsFrom({ VITE_STUDY_TODAY: "1", VITE_STUDY_NOTIFY: "1" });
  const offToday = flagsFrom({ VITE_STUDY_TODAY: "1" });
  const offNone = flagsFrom({});
  for (const r of [{ v: "notify" } as Route, { v: "notify", x: "set" } as Route]) {
    assert.deepEqual(allowed(r, on), { route: r });
    assert.deepEqual(allowed(r, offToday), { route: { v: "today" } }, "Today is the home");
    assert.deepEqual(allowed(r, offNone), { route: { v: "library" } }, "the library is the home until Today");
  }
  assert.deepEqual(parseRoute("?v=notify&x=other"), { v: "notify" }, "x is only set");
  assert.deepEqual(parseRoute("?v=notify&nt=7"), { v: "notify" }, "a push's marker is not part of the route");
  assert.deepEqual(parseRoute("?nt=7"), { v: "today" });
  assert.equal(routeUrl({ v: "notify", x: "set" }), "/?v=notify&x=set");
  assert.equal(BACK_LABEL.notify, "→ להתראות");
  assert.equal(tabOf({ v: "notify" }, on), null, "a screen with a back arrow");
});

test("VITE_STUDY_MODELS: its own flag, which needs section Y at 1 and changes nothing else", () => {
  const base = { VITE_STUDY_GUIDE: "1", VITE_STUDY_INSTALL: "1", VITE_STUDY_NOTIFY: "1" };
  const off = flagsFrom(base);
  const on = flagsFrom({ ...base, VITE_STUDY_MODELS: "1" });
  assert.equal(off.models, false);
  assert.equal(on.models, true);
  assert.deepEqual({ ...on, models: false }, off, "it changes nothing else");
  assert.deepEqual(requiredSchema(on), { ...requiredSchema(off), Y: 1 }, "section Y 1");
  assert.equal(requiredSchema(off).Y, undefined);
  assert.deepEqual(tabLinks(on), tabLinks(off), "no tab of its own");
});

test("?v=models: the owner's tabs, a run and a kind with the flag; without it, the home, with no notice", () => {
  const on = flagsFrom({ VITE_STUDY_TODAY: "1", VITE_STUDY_MODELS: "1" });
  const offToday = flagsFrom({ VITE_STUDY_TODAY: "1" });
  const offNone = flagsFrom({});
  for (const r of [{ v: "models" }, { v: "models", r: ID }, { v: "models", x: "routes" }, { v: "models", x: "new", k: "solver" }] as Route[]) {
    assert.deepEqual(allowed(r, on), { route: r });
    assert.deepEqual(allowed(r, offToday), { route: { v: "today" } }, "Today is the home");
    assert.deepEqual(allowed(r, offNone), { route: { v: "library" } }, "the library is the home until Today");
  }
  assert.deepEqual(parseRoute(`?v=models&r=${ID}&x=new&k=solver`), { v: "models", r: ID }, "a run is its own screen");
  assert.deepEqual(parseRoute("?v=models&x=other"), { v: "models" });
  assert.deepEqual(parseRoute("?v=models&x=board&k=Bad-Key"), { v: "models", x: "board" }, "a kind is a route key");
  assert.deepEqual(parseRoute("?v=models&x=routes&k=part"), { v: "models", x: "routes" }, "the routes tab takes no kind");
  assert.deepEqual(parseRoute("?v=models&r=nope"), { v: "models" }, "a run's id is an id");
  assert.equal(routeUrl({ v: "models", x: "board", k: "solver" }), "/?v=models&x=board&k=solver");
  assert.equal(BACK_LABEL.models, "→ להשוואות");
});

test("VITE_STUDY_MAKE: practice sets' generator, on practice, with no SQL section of its own", () => {
  const base = { VITE_STUDY_QUESTIONS: "1", VITE_STUDY_PRACTICE: "1", VITE_STUDY_NOTIFY: "1" };
  const off = flagsFrom(base);
  const on = flagsFrom({ ...base, VITE_STUDY_MAKE: "1" });
  assert.equal(off.make, false);
  assert.equal(on.make, true);
  assert.deepEqual({ ...on, make: false }, off, "it changes nothing else");
  assert.deepEqual(requiredSchema(on), requiredSchema(off), "no SQL: practice 2.0's actions");
  assert.equal(flagsFrom({ VITE_STUDY_MAKE: "1" }).make, false, "it needs practice");
  assert.equal(flagsFrom({ VITE_STUDY_QUESTIONS: "1", VITE_STUDY_MAKE: "1" }).make, false);
  // "סט חדש" without a lecture, and from the mistakes: only with the flag.
  assert.deepEqual(allowed({ v: "practice", x: "new" }, on), { route: { v: "practice", x: "new" } });
  assert.deepEqual(allowed({ v: "practice", l: ID, x: "new", from: "m" }, on), { route: { v: "practice", l: ID, x: "new", from: "m" } });
  assert.deepEqual(allowed({ v: "practice", x: "new" }, off), { route: { v: "practice" }, notice: NOTICE.off }, "the hub");
  assert.deepEqual(allowed({ v: "practice", l: ID, x: "new", from: "m" }, off), { route: { v: "practice", l: ID, x: "new" }, notice: NOTICE.off }, "the old setup");
  assert.deepEqual(allowed({ v: "practice", l: ID, x: "review", r: ID2 }, off), { route: { v: "practice", l: ID }, notice: NOTICE.off }, "the drafts one by one are practice sets': the lecture's practice");
  assert.deepEqual(allowed({ v: "practice", l: ID, x: "review", r: ID2 }, on), { route: { v: "practice", l: ID, x: "review", r: ID2 } });
  assert.deepEqual(allowed({ v: "practice", l: ID, x: "new" }, off), { route: { v: "practice", l: ID, x: "new" } }, "a lecture's setup is today's");
  assert.equal(routeUrl({ v: "practice", l: ID, x: "new", from: "m" }), `/?v=practice&l=${ID}&x=new&from=m`);
  assert.equal(routeUrl({ v: "practice", x: "new" }), "/?v=practice&x=new");
  // No tab of its own (OD1): the tab bar is the same with the flag.
  const today = flagsFrom({ ...base, VITE_STUDY_TODAY: "1" });
  assert.deepEqual(tabLinks(flagsFrom({ ...base, VITE_STUDY_TODAY: "1", VITE_STUDY_MAKE: "1" })), tabLinks(today));
  assert.equal(tabOf({ v: "practice", x: "new" }, on), null, "an immersive screen");
});

test("VITE_STUDY_SETS: practice sets' shelf, set page and set sessions, on make, with section L 1", () => {
  const base = { VITE_STUDY_QUESTIONS: "1", VITE_STUDY_PRACTICE: "1", VITE_STUDY_NOTIFY: "1", VITE_STUDY_MAKE: "1" };
  const off = flagsFrom(base);
  const on = flagsFrom({ ...base, VITE_STUDY_SETS: "1" });
  assert.equal(off.sets, false);
  assert.equal(on.sets, true);
  assert.deepEqual({ ...on, sets: false }, off, "it changes nothing else");
  assert.deepEqual(requiredSchema(on), { ...requiredSchema(off), L: 1 }, "section L 1");
  assert.equal(flagsFrom({ ...base, VITE_STUDY_MAKE: "", VITE_STUDY_SETS: "1" }).sets, false, "it needs make");
  assert.equal(flagsFrom({ VITE_STUDY_QUESTIONS: "1", VITE_STUDY_MAKE: "1", VITE_STUDY_SETS: "1" }).sets, false, "and practice");
  // The routes: the shelf (with a lecture), a set, and solving it.
  assert.deepEqual(parseRoute(`?v=sets&k=${ID}`), { v: "sets", k: ID });
  assert.deepEqual(parseRoute(`?v=sets&k=${ID}&l=${ID2}`), { v: "sets", k: ID }, "a set's own page needs no lecture");
  assert.deepEqual(parseRoute(`?v=sets&l=${ID2}`), { v: "sets", l: ID2 });
  assert.deepEqual(parseRoute("?v=sets&k=nope"), { v: "sets" }, "a set's id is an id");
  assert.deepEqual(parseRoute(`?v=practice&s=k.${ID}`), { v: "practice", s: `k.${ID}` });
  assert.deepEqual(parseRoute("?v=practice&s=k.nope"), { v: "practice" }, "k. is a keyed session");
  assert.equal(routeUrl({ v: "sets", k: ID }), `/?v=sets&k=${ID}`);
  // Without the flag: the practice hub (or a lecture's practice), with the usual line.
  assert.deepEqual(allowed({ v: "sets", k: ID }, off), { route: { v: "practice" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "sets", l: ID2 }, off), { route: { v: "practice", l: ID2 }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "practice", s: `k.${ID}` }, off), { route: { v: "practice" }, notice: NOTICE.off });
  assert.deepEqual(allowed({ v: "sets", k: ID }, on), { route: { v: "sets", k: ID } });
  // No tab of its own (OD1): the tab bar is the same with the flag.
  const today = { ...base, VITE_STUDY_TODAY: "1" };
  assert.deepEqual(tabLinks(flagsFrom({ ...today, VITE_STUDY_SETS: "1" })), tabLinks(flagsFrom(today)));
  assert.equal(BACK_LABEL.sets, "→ סטים של הקבוצה");
});

test("VITE_STUDY_SHEETS: uploaded sheets (release A0) on past exams, with section O 1; new=sheet and its lecture", () => {
  const base = { VITE_STUDY_QUESTIONS: "1", VITE_STUDY_PRACTICE: "1", VITE_STUDY_COURSES: "1", VITE_STUDY_EXAMS: "1" };
  const off = flagsFrom(base);
  const on = flagsFrom({ ...base, VITE_STUDY_SHEETS: "1" });
  assert.equal(off.sheets, false);
  assert.equal(on.sheets, true);
  assert.deepEqual({ ...on, sheets: false }, off, "it changes nothing else");
  assert.deepEqual(requiredSchema(on), { ...requiredSchema(off), O: 1 }, "section O 1");
  assert.equal(flagsFrom({ ...base, VITE_STUDY_EXAMS: "", VITE_STUDY_SHEETS: "1" }).sheets, false, "it needs past exams");
  assert.equal(flagsFrom({ VITE_STUDY_QUESTIONS: "1", VITE_STUDY_PRACTICE: "1", VITE_STUDY_SHEETS: "1" }).sheets, false, "and the course pages");
  // The upload's address: a past exam (new=1) or a sheet (new=sheet), from a lecture's page with its lecture (l).
  assert.deepEqual(parseRoute(`?v=exams&new=sheet&c=${ID}&l=${ID2}`), { v: "exams", c: ID, isNew: "sheet", l: ID2 });
  assert.deepEqual(parseRoute(`?v=exams&new=1&c=${ID}`), { v: "exams", c: ID, isNew: true });
  assert.deepEqual(parseRoute(`?v=exams&new=other&c=${ID}&l=nope`), { v: "exams", c: ID }, "new is 1 or sheet; l is an id");
  assert.equal(routeUrl({ v: "exams", c: ID, isNew: "sheet", l: ID2 }), `/?v=exams&c=${ID}&new=sheet&l=${ID2}`);
  assert.deepEqual(allowed({ v: "exams", c: ID, isNew: "sheet" }, on), { route: { v: "exams", c: ID, isNew: "sheet" } });
  // No tab of its own: the tab bar is the same with the flag.
  assert.deepEqual(tabLinks(on), tabLinks(off));
});

test("VITE_STUDY_SHEETS_FORMS: uploaded sheets' release A1 on release A0, with section O 2", () => {
  const base = { VITE_STUDY_QUESTIONS: "1", VITE_STUDY_PRACTICE: "1", VITE_STUDY_COURSES: "1", VITE_STUDY_EXAMS: "1", VITE_STUDY_SHEETS: "1" };
  const off = flagsFrom(base);
  const on = flagsFrom({ ...base, VITE_STUDY_SHEETS_FORMS: "1" });
  assert.equal(off.sheetForms, false);
  assert.equal(on.sheetForms, true);
  assert.deepEqual({ ...on, sheetForms: false }, off, "it changes nothing else");
  assert.deepEqual(requiredSchema(on), { ...requiredSchema(off), O: 2 }, "section O 2");
  assert.equal(flagsFrom({ ...base, VITE_STUDY_SHEETS: "", VITE_STUDY_SHEETS_FORMS: "1" }).sheetForms, false, "it needs release A0");
  assert.deepEqual(tabLinks(on), tabLinks(off), "no tab of its own");
});

test("VITE_STUDY_SIMILAR: uploaded sheets' release B on release A1 and practice sets, with section O 3 and L 1", () => {
  const base = {
    VITE_STUDY_QUESTIONS: "1", VITE_STUDY_PRACTICE: "1", VITE_STUDY_COURSES: "1", VITE_STUDY_EXAMS: "1", VITE_STUDY_SHEETS: "1",
    VITE_STUDY_SHEETS_FORMS: "1", VITE_STUDY_MAKE: "1", VITE_STUDY_SETS: "1",
  };
  const off = flagsFrom(base);
  const on = flagsFrom({ ...base, VITE_STUDY_SIMILAR: "1" });
  assert.equal(off.similar, false);
  assert.equal(on.similar, true);
  assert.deepEqual({ ...on, similar: false }, off, "it changes nothing else");
  assert.deepEqual(requiredSchema(on), { ...requiredSchema(off), O: 3, L: 1 }, "section O 3, and L 1 for the sheet's set");
  assert.equal(flagsFrom({ ...base, VITE_STUDY_SHEETS_FORMS: "", VITE_STUDY_SIMILAR: "1" }).similar, false, "it needs release A1");
  assert.equal(flagsFrom({ ...base, VITE_STUDY_SETS: "", VITE_STUDY_SIMILAR: "1" }).similar, false, "and practice sets' shelf");
  assert.deepEqual(tabLinks(on), tabLinks(off), "no tab of its own");
});
