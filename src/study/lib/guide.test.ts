import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { flagsFrom, requiredSchema, type Flags } from "./flags";
import {
  appTour,
  cardState,
  COPY,
  DONE_BY,
  firstSteps,
  foldWord,
  HINTS,
  hintFlags,
  hitsLine,
  howTos,
  matches,
  NO_FACTS,
  NO_HITS,
  nextHint,
  offerWanted,
  paragraphActions,
  parseMemory,
  readMemory,
  recordEvent,
  RETIRE_MS,
  ROWS_ONLY,
  routeEvent,
  screenGuide,
  searchHowTos,
  STOP_LINE,
  STOP_SELECTORS,
  TARGETS,
  walkOf,
  writeMemory,
  type Facts,
  type Memory,
  type WalkId,
} from "./guide";
import { miniScreen } from "./guideScreens";
import { allowed, parseRoute, routeUrl, tabLinks, tabOf, type Route } from "./route";

/* ── The guide (docs/study/guide.md) ──
 * Its registry under every release's flags: nothing for a feature that is
 * off; every place it points at is in TARGETS; every STOP ends its walk;
 * the memory survives a broken or missing storage; the first steps only
 * grow; the search folds Hebrew; and its code never clicks, and reads the
 * group only through the three existing reads. */

const root = process.cwd();
const ID = "aaaaaaaa-0000-4000-8000-000000000001";

const R1 = ["QUESTIONS", "PRACTICE", "CARDS"];
const W4 = [...R1, "QUIZ", "ANCHOR", "CORRECTIONS", "ASK", "VAR", "WALL", "MEETING", "GUESS"];
const W5 = [...W4, "PROGRESS", "CARDS_REVIEW", "TODAY", "PULSE"];
const W5X = [...W5, "MUSEUM", "BOSS", "MARATHONS", "GROUP_PLAN", "NEEDS_ME", "EVE", "TRAPS", "BLANK_TABLE", "QUIZ_ROUNDS"];
/** Production's 27 flags (mock.cjs's "s2"; flagSet adds GUIDE, the 27th): the course pages, past exams and the question types on. */
const S2 = [
  "ANCHOR", "ASK", "BLANK_TABLE", "BOSS", "CARDS", "CARDS_REVIEW", "CORRECTIONS", "COURSES", "EVE", "EXAMS", "GROUP_PLAN", "GUESS", "MARATHONS",
  "MEETING", "MUSEUM", "NEEDS_ME", "PRACTICE", "PROGRESS", "PULSE", "QTYPES", "QUESTIONS", "QUIZ", "TODAY", "TRAPS", "VAR", "WALL",
];
/** Production before the course pages and past exams (what a member who joined then knew). */
const PROD = S2.filter((n) => n !== "COURSES" && n !== "EXAMS");
/** Every flag the guide speaks of. */
const ALL = [...new Set([...W5X, ...S2])];
const SETS: Array<[string, string[]]> = [
  ["off", []],
  ["rel1", R1],
  ["w4", W4],
  ["w5", W5],
  ["w5x", W5X],
  ["cards only", ["CARDS"]],
  ["today alone", ["TODAY"]],
  ["quiz without the meeting", ["QUESTIONS", "QUIZ"]],
  ["s2 (production, 27 flags)", S2],
  ["courses alone", ["COURSES"]],
  ["courses with practice", [...R1, "COURSES"]],
];
const flagSet = (names: string[]): Flags => flagsFrom(Object.fromEntries([...names, "GUIDE"].map((n) => [`VITE_STUDY_${n}`, "1"])));
const FULL: Facts = { lectures: 3, ready: [ID], writing: 1, members: 2, practiceLecture: ID, queue: 4, serverWrites: true, courses: 1 };
const WALKS: WalkId[] = ["read", "upload", "practice", "invite", "today", "group", "cards", "correct", "readaloud", "quizopen", "meeting", "ask", "readmark", "course"];
const ROUTES: Route[] = [
  { v: "today" },
  { v: "library" },
  { v: "lecture", l: ID },
  { v: "upload" },
  { v: "practice" },
  { v: "practice", l: ID },
  { v: "group" },
  { v: "wall" },
  { v: "me" },
  { v: "course", c: ID },
  { v: "upload", many: true },
  { v: "upload", many: true, c: ID },
  { v: "exams", isNew: true, c: ID },
  { v: "exams", e: ID, c: ID },
  { v: "mock", c: ID },
  { v: "ask", c: ID },
];

/** Every word the guide can say under a flag set, with all the facts there are. */
function allText(f: Flags): string {
  const blank: Memory = { v: 1, views: 0, did: [], list: [], tips: true };
  const steps = [...firstSteps(f, FULL, blank), ...firstSteps(f, FULL, { ...blank, mode: "create" })];
  const walks = WALKS.map((w) => walkOf(w, f, FULL)).filter((w) => w !== null);
  const minis = ROUTES.map((r) => screenGuide(r, f)).filter((g) => g !== null);
  return [
    ...steps.flatMap((s) => [s.title, s.line]),
    ...walks.flatMap((w) => [w.title, ...w.steps.flatMap((s) => [s.say, s.empty ?? ""])]),
    ...minis.flatMap((g) => [g.screen, ...g.steps.map((s) => s.say)]),
    appTour(f).screen,
    ...appTour(f).steps.map((s) => s.say),
    ...howTos(f).flatMap((h) => [h.title, h.answer]),
  ].join("\n");
}

test("VITE_STUDY_GUIDE: its own flag, and it needs no SQL section (requiredSchema is unchanged)", () => {
  for (const [name, names] of SETS) {
    const without = flagsFrom(Object.fromEntries(names.map((n) => [`VITE_STUDY_${n}`, "1"])));
    const withGuide = flagSet(names);
    assert.equal(without.guide, false, name);
    assert.equal(withGuide.guide, true, name);
    assert.deepEqual(requiredSchema(withGuide), requiredSchema(without), `${name}: the guide asks the database for nothing`);
    assert.deepEqual({ ...withGuide, guide: false }, without, `${name}: the guide changes no other flag`);
  }
});

test("the release sets: the first steps a joiner and a creator get, each only with its feature", () => {
  const ids = (names: string[], m: Partial<Memory> = {}, x: Facts = FULL) =>
    firstSteps(flagSet(names), x, { list: [], mode: "join", ...m }).map((s) => s.id);
  assert.deepEqual(ids([]), ["S1", "S2", "S6"], "off: open, a paragraph, the invite (two members)");
  assert.deepEqual(ids(R1), ["S1", "S2", "S4", "S6"], "production's: + practice with a bet");
  assert.deepEqual(ids(W4), ["S1", "S2", "S4", "S6", "S7"], "wave 4: + יחד");
  assert.deepEqual(ids(W5), ["S1", "S2", "S4", "S5", "S6"], "w5: + the queue; five at most, cut from the end");
  assert.deepEqual(ids(W5, { mode: "create" }), ["S1", "S6", "S2", "S4", "S5"], "a creator: upload first, the invite kept");
  assert.deepEqual(ids(W5, {}, { ...FULL, members: 6 }), ["S1", "S2", "S4", "S5", "S7"], "a full group: no invite step for a joiner");
  assert.deepEqual(ids(W5, {}, { ...NO_FACTS, members: 1 }), ["S1", "S6", "S7"], "an empty group: upload, invite, יחד");
  const s1 = (x: Facts) => firstSteps(flagSet(R1), x, { list: [], mode: "join" })[0];
  assert.equal(s1({ ...NO_FACTS }).walk, "upload", "no lecture: S1a upload");
  assert.equal(s1({ ...NO_FACTS, writing: 1 }).chip, "נכתב", "only writing: S1w waits");
  assert.equal(s1({ ...NO_FACTS, writing: 1 }).walk, undefined, "S1w has no button");
  assert.equal(s1(FULL).title, "לפתוח סיכום", "a ready lecture: S1b");
});

test("a step shown once never leaves the list (the counts only grow); one whose flag goes off does", () => {
  const f = flagSet(W5);
  const first = firstSteps(f, FULL, { list: [], mode: "join" }).map((s) => s.id);
  // The lecture was deleted and the queue emptied: the kept steps stay, without "להראות".
  const later = firstSteps(f, { ...NO_FACTS, members: 2 }, { list: first, mode: "join" });
  assert.deepEqual(later.map((s) => s.id), first);
  assert.ok(later.filter((s) => s.id === "S2" || s.id === "S4" || s.id === "S5").every((s) => s.skipped && !s.walk), "kept steps whose facts are gone say דולג");
  // Today was turned off since: its step goes, whatever was kept.
  const noToday = firstSteps(flagSet(W4), FULL, { list: first, mode: "join" }).map((s) => s.id);
  assert.ok(!noToday.includes("S5"), "a step whose flag is off is never shown");
});

test("never a step, a walk, a mini-guide, a how-to or a hint for a feature that is off", () => {
  for (const [name, names] of SETS) {
    const f = flagSet(names);
    const text = allText(f);
    const blank: Memory = { v: 1, views: 0, did: [], list: [], tips: true };
    const steps = firstSteps(f, FULL, blank).map((s) => s.id);
    if (!f.practice) assert.ok(!steps.includes("S4"), `${name}: S4`);
    if (!f.today) assert.ok(!steps.includes("S5"), `${name}: S5`);
    if (!f.meeting && !f.quiz) assert.ok(!steps.includes("S7"), `${name}: S7`);
    if (!f.quiz) assert.ok(!/מבחן קבוצתי|כולנו נגד/.test(text), `${name}: the quiz`);
    if (!f.meeting) assert.ok(!/פגישה|שאלות פתיחה/.test(text), `${name}: the meeting`);
    if (!f.corrections) assert.ok(!text.includes("תיקון"), `${name}: corrections`);
    if (!f.wall) assert.ok(!/אסוציאציה|קיר/.test(text), `${name}: the wall`);
    if (!f.ask) assert.ok(!text.includes("״לשאול״") && !text.includes(", לשאול"), `${name}: ask`);
    if (!f.today) assert.ok(!/התור|״היום״/.test(text), `${name}: Today`);
    if (!f.cards) assert.ok(!text.includes("כרטיסיות"), `${name}: cards`);
    if (!f.practice) assert.ok(!/על בטוח|הימור|סבב חדש/.test(text), `${name}: practice 2.0`);
    if (!f.questions) assert.ok(!/לתרגל|תרגול/.test(text), `${name}: practice`);
    if (!f.pulse) assert.ok(!text.includes("מה קשה לקבוצה"), `${name}: the pulse`);
    if (!f.boss) assert.ok(!text.includes("אתגר קבוצתי"), `${name}: the boss`);
    if (!f.museum) assert.ok(!text.includes("טעויות נפוצות"), `${name}: the museum`);
    for (const h of hintFlags(f)) assert.equal(f[h as keyof Flags], true, `${name}: a hint for ${h}`);
    // Every route a guide opens is one this build allows (no replaced screen, no notice).
    const routes: Route[] = [
      ...WALKS.flatMap((w) => walkOf(w, f, FULL)?.steps.map((s) => s.go) ?? []),
      ...howTos(f).flatMap((h) => (h.open ? [h.open.route] : [])),
      ...ROUTES.flatMap((r) => screenGuide(r, f)?.tryIt ?? []),
    ];
    for (const r of routes) assert.deepEqual(allowed(r, f), { route: r }, `${name}: ${routeUrl(r)} is on`);
  }
});

test("every place the guide points at is in TARGETS, and every STOP ends its walk there", () => {
  const known = new Set<string>(Object.values(TARGETS));
  const f = flagSet(ALL);
  // A target that is a STOP control, or inside one.
  const stops = (sel: string) => STOP_SELECTORS.some((s) => sel === s || sel.includes(s));
  for (const id of WALKS) {
    const w = walkOf(id, f, FULL);
    assert.ok(w, `${id} exists with every flag`);
    w!.steps.forEach((s, i) => {
      assert.ok(known.has(s.target.sel), `${id} step ${i + 1}: ${s.target.sel} is in TARGETS`);
      if (s.select) assert.ok(known.has(s.select), `${id} step ${i + 1}: ${s.select}`);
      if (stops(s.target.sel)) {
        assert.ok(s.stop, `${id} step ${i + 1}: ${s.target.sel} is a STOP`);
        assert.equal(i, w!.steps.length - 1, `${id}: the walk ends at its STOP`);
        assert.equal(s.until, "end", `${id}: a STOP waits for nothing`);
      }
      assert.ok(s.until !== "click" || !s.stop, `${id}: never waits for a tap on a STOP`);
    });
  }
  for (const r of ROUTES) for (const s of screenGuide(r, f)?.steps ?? []) assert.ok(known.has(s.target.sel), `${routeUrl(r)}: ${s.target.sel}`);
  for (const [name, names] of SETS)
    for (const s of appTour(flagSet(names)).steps) {
      assert.ok(known.has(s.target.sel), `the tour (${name}): ${s.target.sel}`);
      assert.ok(!stops(s.target.sel), `the tour (${name}) never points at a STOP: ${s.target.sel}`);
    }
  // The costs and the group's live actions named in the design are all STOPs.
  for (const sel of [".practice-more", ".practice-empty .a-btn.primary", ".room-action button", ".m-unclear", ".read-mark .a-btn", ".wall-screen .ph-foot", ".upload .ph-foot .a-btn.primary"]) assert.ok(STOP_SELECTORS.includes(sel as never), sel);
});

test("the guide's code never clicks, and reads the group only through the existing reads", () => {
  const files = [
    "src/study/lib/guide.ts",
    "src/study/lib/guideMark.ts",
    "src/study/lib/guideScreens.ts",
    "src/study/lib/guideFacts.ts",
    "src/study/features/guide.tsx",
    "src/study/components/GuideLayer.tsx",
    "src/study/components/GuideSteps.tsx",
    "src/study/components/HowTo.tsx",
    "src/study/components/GuideMe.tsx",
    "src/study/components/TryScreen.tsx",
  ];
  for (const f of files) {
    const code = readFileSync(join(root, f), "utf8");
    assert.ok(!/\.click\(\s*\)/.test(code), `${f}: no .click()`);
    assert.ok(!/new (Mouse|Pointer|Touch)Event/.test(code), `${f}: no made-up taps`);
    assert.ok(!/\b(fetch|XMLHttpRequest|postStudy|\.rpc\(|\.from\()/.test(code), `${f}: no request of its own`);
    for (const m of code.matchAll(/^import \{([^}]*)\} from "(?:\.\.\/lib\/|\.\/)api";$/gm)) {
      const names = m[1].split(",").map((x) => x.trim().replace(/^type /, "")).filter(Boolean);
      for (const n of names) assert.ok(["listLectures", "members"].includes(n), `${f}: imports ${n} from api`);
    }
    for (const m of code.matchAll(/^import \{([^}]*)\} from "(?:\.\.\/lib\/|\.\/)practice2";$/gm)) {
      assert.deepEqual(m[1].split(",").map((x) => x.trim()).filter(Boolean), ["sessionCounts"], `${f}: only the session counts`);
    }
  }
  const sandbox = readFileSync(join(root, "src/study/components/TryScreen.tsx"), "utf8");
  for (const m of sandbox.matchAll(/^import (?!type )(.*) from "([^"]+)";$/gm)) {
    assert.ok(!/lib\/(api|practice|practice2|collab|wall|quiz)"?$/.test(m[2]), `the sandbox imports nothing that talks to the group: ${m[2]}`);
  }
});

test("the memory: a broken value is cleaned, and the guide works with no storage at all", () => {
  assert.deepEqual(parseMemory("not json"), { v: 1, views: 0, did: [], list: [], tips: true });
  assert.deepEqual(parseMemory(JSON.stringify({ born: "x", did: ["para", "hack"], list: ["S2", "S9"], tips: false, views: -3 })), {
    v: 1,
    views: 0,
    did: ["para"],
    list: ["S2"],
    tips: false,
  });
  // node has no localStorage: every read and write throws, and this load's copy holds.
  const m: Memory = { v: 1, born: 5, mode: "join", views: 2, did: ["open"], list: ["S1", "S2"], tips: true };
  writeMemory("u1", m);
  assert.deepEqual(readMemory("u1"), m);
  assert.deepEqual(readMemory("u2"), { v: 1, views: 0, did: [], list: [], tips: true });
});

test("the memory: a storage that reads but refuses writes (full) never undoes a save", () => {
  const g = globalThis as { localStorage?: unknown };
  const had = Object.getOwnPropertyDescriptor(g, "localStorage");
  const store = new Map<string, string>();
  const old: Memory = { v: 1, born: 5, mode: "join", views: 0, did: [], list: ["S1"], tips: true };
  store.set("study-guide:u3", JSON.stringify(old));
  let full = true;
  Object.defineProperty(g, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
    },
  });
  try {
    assert.deepEqual(readMemory("u3"), old);
    const hidden: Memory = { ...old, hidden: true, tips: false };
    writeMemory("u3", hidden);
    assert.deepEqual(readMemory("u3"), hidden, "the save holds although storage kept the older value");
    assert.equal(store.has("study-guide:u3"), false, "the stale value is removed");
    // Storage works again: the next write lands there, and reads come from it.
    full = false;
    const shown: Memory = { ...hidden, hidden: undefined };
    delete shown.hidden;
    writeMemory("u3", shown);
    assert.deepEqual(readMemory("u3"), shown);
    assert.deepEqual(parseMemory(store.get("study-guide:u3")), shown);
  } finally {
    if (had) Object.defineProperty(g, "localStorage", had);
    else delete g.localStorage;
  }
});

test("the card: none before born, expanded on two home views, one row from the third, done, hidden, retired after 14 days", () => {
  const f = flagSet(R1);
  const now = 10 * RETIRE_MS;
  const m: Memory = { v: 1, born: now - 1000, mode: "join", views: 1, did: [], list: [], tips: true };
  const steps = firstSteps(f, FULL, m);
  assert.equal(cardState({ ...m, born: undefined }, steps, now), "none");
  assert.equal(cardState(m, steps, now), "expanded");
  assert.equal(cardState({ ...m, views: 2 }, steps, now), "expanded");
  assert.equal(cardState({ ...m, views: 3 }, steps, now), "collapsed");
  assert.equal(cardState({ ...m, hidden: true }, steps, now), "hidden");
  assert.equal(cardState({ ...m, did: ["open", "para", "bet", "invite"] }, steps, now), "done");
  assert.equal(cardState({ ...m, closed: true }, steps, now), "retired");
  assert.equal(cardState({ ...m, born: now - RETIRE_MS - 1 }, steps, now), "retired");
});

test("a real action ticks its step once, with the toast; nothing when the card is not live", () => {
  const now = 1_000_000;
  let m: Memory = { v: 1, born: now, mode: "join", views: 1, did: [], list: ["S1", "S2", "S6"], tips: true };
  let r = recordEvent(m, "open", now);
  assert.equal(r.tick, "✓ 1 מתוך 3: לפתוח סיכום");
  m = r.m;
  assert.equal(recordEvent(m, "open", now).m, m, "twice is once");
  assert.equal(recordEvent(m, "upload", now).tick, null, "S1 is done already");
  r = recordEvent(m, "para", now);
  assert.equal(r.tick, "✓ 2 מתוך 3: לגעת בפסקה");
  r = recordEvent(r.m, "invite", now);
  assert.equal(r.tick, COPY.tick(3, 3, ""), "the last one");
  assert.equal(r.tick, "✓ כל הצעדים! מכאן זה שלכם.");
  assert.equal(recordEvent({ ...m, hidden: true }, "para", now).tick, null, "hidden: recorded, no toast");
  assert.deepEqual(recordEvent({ ...m, hidden: true }, "para", now).m.did, ["open", "para"]);
  assert.equal(recordEvent({ ...m, list: ["S1"] }, "bet", now).tick, null, "a step not on the card");
  for (const [id, evs] of Object.entries(DONE_BY)) assert.ok(evs.length >= 1, id);
});

test("\"חדש\": one hint a day, for a flag turned on since, never in the first 14 days or with tips off", () => {
  const f = flagSet(W4);
  const now = 100 * RETIRE_MS;
  const knewR1 = hintFlags(flagSet(R1));
  const m: Memory = { v: 1, views: 0, did: [], list: [], tips: true, known: knewR1, offer: "dismissed" };
  const h = nextHint(m, f, "2026-11-18", now);
  assert.equal(nextHint({ ...m, offer: undefined }, f, "2026-11-18", now), null, "one thing at a time: no hint while the home offers the tour");
  assert.ok(nextHint({ ...m, offer: "taken" }, f, "2026-11-18", now), "the tour taken: hints as before");
  assert.ok(h && f[h.flag] && !knewR1.includes(h.flag), "a feature this member did not know");
  assert.equal(nextHint({ ...m, known: undefined }, f, "2026-11-18", now), null, "the first look records, says nothing");
  assert.equal(nextHint({ ...m, hintDay: "2026-11-18" }, f, "2026-11-18", now), null, "one a day");
  assert.equal(nextHint({ ...m, tips: false }, f, "2026-11-18", now), null, "tips off");
  assert.equal(nextHint({ ...m, born: now - 1000 }, f, "2026-11-18", now), null, "a new member meets everything as new");
  assert.equal(nextHint({ ...m, known: hintFlags(f) }, f, "2026-11-18", now), null, "nothing new");
  assert.equal(nextHint({ ...m, known: [] }, flagSet([]), "2026-11-18", now), null, "nothing on");
});

test("the search folds Hebrew: niqqud, final letters, a leading ו/ה/ב/ל/מ/ש", () => {
  assert.equal(foldWord("לְתַרְגֵּל"), "לתרגל");
  assert.equal(foldWord("קובץ"), "קובצ");
  assert.ok(matches("לתרגל", "תרגל שאלות"));
  assert.ok(matches("לְתַרְגֵּל", "לתרגל"));
  assert.ok(matches("בהרצאה", "הרצאה"), "one prefix letter dropped");
  assert.ok(matches("PDF", "מצגת או pdf"));
  assert.ok(!matches("פיצה", "לקרוא הרצאה"));
  const list = howTos(flagSet(W5X));
  const key = (q: string) => searchHowTos(q, list).map((h) => h.key);
  assert.equal(searchHowTos("", list).length, 6, "an empty query: the first six");
  assert.ok(key("לתרגל").includes("practice"));
  assert.ok(key("תרגול").includes("practice"));
  assert.ok(key("להעלות").includes("upload"));
  assert.ok(key("העלאה").includes("upload"));
  assert.ok(key("מצגת").includes("upload"));
  assert.ok(key("תגובה").includes("comment"));
  assert.ok(key("קוד").includes("invite"));
  assert.ok(key("טעות").includes("correct"));
  assert.ok(key("הימור").includes("bet"));
  assert.deepEqual(key("זברה"), []);
});

test("the sandbox route: on with the guide, and without it what it always was (the library, no notice)", () => {
  assert.deepEqual(parseRoute("?v=try"), { v: "try" });
  assert.deepEqual(parseRoute("?v=try&s=b"), { v: "try", s: "b" });
  assert.deepEqual(parseRoute("?v=try&s=zz"), { v: "try" });
  for (const r of [{ v: "try" }, { v: "try", s: "b" }] as Route[]) {
    const url = routeUrl(r);
    assert.deepEqual(parseRoute(url.slice(url.indexOf("?"))), r, url);
    assert.deepEqual(allowed(r, flagSet(R1)), { route: r });
    assert.deepEqual(allowed(r, flagsFrom({ VITE_STUDY_QUESTIONS: "1" })), { route: { v: "library" } }, "no notice: as before the guide");
    assert.equal(tabOf(r, flagSet(R1)), null, "immersive: no tab bar");
  }
});

test("the paragraph's actions are named as the build has them", () => {
  assert.equal(paragraphActions(flagSet([])), "תגובה או שאלה לקבוצה");
  assert.equal(paragraphActions(flagSet(W4)), "תגובה או שאלה לקבוצה, תיקון, אסוציאציה, לשאול");
});

test("every sentence is gender-neutral and short", () => {
  for (const names of [W5X, S2, ["COURSES"], [...R1, "COURSES"]]) {
    const text = [allText(flagSet(names)), ...HINTS.flatMap((h) => [h.title, h.say])].join("\n");
    for (const bad of ["מישהו", "מישהי", "לחץ ", "לחצי", "בחר ", "בחרי", "תוכל", "תוכלי", "את/ה", "/ת "]) assert.ok(!text.includes(bad), bad);
    for (const line of text.split("\n")) assert.ok(line.length <= 160, `short: ${line}`);
  }
  const copy = Object.values(COPY).filter((v): v is string => typeof v === "string");
  for (const c of copy) assert.ok(c.length <= 80, c);
});

test("the \"?\" shows only where a mini-guide has something to say (one check for the button and the registry)", () => {
  const more: Route[] = [
    ...ROUTES,
    { v: "today", run: true },
    { v: "practice", s: `l.${ID}` },
    { v: "practice", l: ID, x: "round" },
    { v: "wall", x: "drafts" },
    { v: "help" },
    { v: "cards" },
    { v: "quiz" },
    // A session never has a "?": the simulation's clock (x.), its mistakes (w.), an exam replayed (e.).
    { v: "practice", s: `x.${ID}` },
    { v: "practice", s: `e.${ID}` },
    { v: "practice", s: `w.${ID}` },
    { v: "exams", c: ID },
    // The upload without its course is the bare list on screen (ExamsScreen): no "?" there either.
    { v: "exams", isNew: true },
    { v: "exams", e: ID },
    { v: "ask" },
  ];
  for (const [name, names] of SETS) {
    const f = flagSet(names);
    for (const r of more) assert.equal(miniScreen(r, f), screenGuide(r, f) !== null, `${name}: ${routeUrl(r)}`);
  }
  const s2 = flagSet(S2);
  for (const s of [`x.${ID}`, `e.${ID}`, `w.${ID}`]) assert.equal(screenGuide({ v: "practice", s }, s2), null, `no "?" in a session (s=${s})`);
  assert.equal(screenGuide({ v: "exams", c: ID }, s2), null, "no \"?\" on the bare exams list");
  assert.equal(screenGuide({ v: "exams", isNew: true }, s2), null, "?v=exams&new=1 without a course shows the list: no \"?\"");
  assert.equal(screenGuide({ v: "ask" }, s2), null, "the library's question has no mini-guide");
  assert.ok(screenGuide({ v: "ask", c: ID }, s2), "the course's question has one");
  const f = flagSet(W5X);
  assert.equal(screenGuide({ v: "today", run: true }, f), null, "Today's run has no mini-guide (and so no \"?\")");
  // A lecture's practice with no question yet: the empty state's "שאלות חדשות", with its cost.
  const lp = screenGuide({ v: "practice", l: ID }, f)!;
  const empty = lp.steps.find((s) => s.target.sel === TARGETS.practiceEmptyMore);
  assert.ok(empty && /AI/.test(empty.say) && /תקציב/.test(empty.say), "the empty state's button and what it costs");
  // The reader's mini-guide never takes the member to the end of the summary.
  assert.ok(!screenGuide({ v: "lecture", l: ID }, f)!.steps.some((s) => s.target.sel === TARGETS.readMark), "no ״סימון שקראתי״ step in the reader's mini-guide");
});

test("the copy reads whole: no stray fragment, no dangling ending", () => {
  const text = [W5X, S2, ["COURSES"]].map((n) => allText(flagSet(n))).join("\n");
  assert.ok(!text.includes("כאן זה."), "no \"כאן זה.\"");
  for (const line of text.split("\n")) assert.ok(!/\. רק (לך|אצלך)\.$/.test(line), `no dangling "רק לך.": ${line}`);
  // The STOP lines and the hints are said as they are written.
  for (const line of Object.values(STOP_LINE)) assert.ok(!line.includes("כאן זה") && line.startsWith("לחיצה כאן"), line);
  const source = readFileSync(join(root, "src/study/lib/guide.ts"), "utf8");
  assert.ok(!/\. רק (לך|אצלך)\."/.test(source), "no sentence of the registry ends on a lone \"רק לך.\"");
});

test("the app tour: the tab bar one tab at a time, then the screen's \"?\"; offered once to a member who never had the first steps", () => {
  const sels = (names: string[]) => appTour(flagSet(names)).steps.map((s) => s.target.sel);
  assert.deepEqual(sels([]), [TARGETS.libraryTab, TARGETS.groupTab, TARGETS.meTab, TARGETS.screenHelp], "off: library, יחד, שלי, the ?");
  assert.deepEqual(sels(R1), [TARGETS.libraryTab, TARGETS.practiceTab, TARGETS.groupTab, TARGETS.meTab, TARGETS.screenHelp], "production's three: + תרגול");
  assert.deepEqual(sels(W5), [TARGETS.todayTab, TARGETS.libraryTab, TARGETS.groupTab, TARGETS.meTab, TARGETS.screenHelp], "with Today: היום first, no תרגול tab");
  for (const [name, names] of SETS) {
    const f = flagSet(names);
    const tour = appTour(f).steps.map((s) => s.target.sel).join(" ");
    for (const s of appTour(f).steps) assert.ok(s.say.length <= 160, `${name}: ${s.say}`);
    // Every tab the bar draws (its href is routeUrl of its route) is one the tour rings.
    for (const t of tabLinks(f)) assert.ok(tour.includes(`a.ph-tab[href="${routeUrl(t.route)}"]`), `${name}: the tour rings ${t.label} (${routeUrl(t.route)})`);
  }
  // The offer: a member this device never started the first steps for, until answered.
  assert.equal(offerWanted({}), true, "joined before the guide: offered");
  assert.equal(offerWanted({ born: 1 }), false, "a new member gets the first steps instead");
  assert.equal(offerWanted({ offer: "taken" }), false, "taken: never again");
  assert.equal(offerWanted({ offer: "dismissed" }), false, "״לא עכשיו״: never again");
  assert.equal(parseMemory(JSON.stringify({ offer: "dismissed" })).offer, "dismissed");
  assert.equal(parseMemory(JSON.stringify({ offer: "maybe" })).offer, undefined, "anything else is dropped");
  assert.equal(cardState(parseMemory(JSON.stringify({ offer: "taken" })), [], Date.now()), "none", "the tour does not start the first steps");
});

/* ── the course pages, past exams, the simulation and the question types (docs/study/guide.md §2.3) ── */

test("each new screen's mini-guide rings only its own screen, and a button it names is the one it rings", () => {
  const f = flagSet(S2);
  const ROOT: Array<[Route, string[]]> = [
    [{ v: "course", c: ID }, [".course-page"]],
    [{ v: "upload", many: true }, [".upload"]],
    [{ v: "exams", isNew: true, c: ID }, [".exam-new"]],
    [{ v: "exams", e: ID, c: ID }, [".exam-review"]],
    [{ v: "mock", c: ID }, [".sim-setup"]],
    [{ v: "ask", c: ID }, [".course-ask"]],
  ];
  for (const [r, roots] of ROOT) {
    const g = screenGuide(r, f);
    assert.ok(g && g.steps.length >= 3, routeUrl(r));
    for (const s of g!.steps) assert.ok(roots.some((root) => s.target.sel.startsWith(root)), `${routeUrl(r)}: ${s.target.sel} is on ${roots.join(" or ")}`);
  }
  // A step that names a button that is not always there rings that very button (and is skipped without it):
  // "סימולציה מהמבחן" needs 5 questions and the course; "סימולציה" on the course page a ready exam.
  const named: Array<[Route, string, string]> = [
    [{ v: "exams", e: ID, c: ID }, "״סימולציה מהמבחן״", TARGETS.examSim],
    [{ v: "course", c: ID }, "״סימולציה״:", TARGETS.courseSim],
    [{ v: "course", c: ID }, "״לתרגל מבחן קודם״", TARGETS.courseReplay],
  ];
  for (const [r, word, target] of named)
    for (const s of screenGuide(r, f)!.steps) if (s.say.includes(word)) assert.equal(s.target.sel, target, `${routeUrl(r)}: ${word} rings ${s.target.sel}`);
  // The states where a screen has little: a stopped exam upload, an error, the batch while its files go up.
  const exam = screenGuide({ v: "exams", e: ID }, f)!.steps.map((s) => s.target.sel);
  for (const t of [TARGETS.examStalled, TARGETS.examError, TARGETS.examUnits, TARGETS.examSuggested, TARGETS.examNokey]) assert.ok(exam.includes(t), t);
  assert.ok(screenGuide({ v: "upload", many: true }, f)!.steps.some((s) => s.target.sel === TARGETS.batchProgress), "the batch's progress card has its step");
  const batch = screenGuide({ v: "upload", many: true }, f)!;
  assert.ok(batch.steps.every((s) => !s.say.includes("יצירת סיכום")), "the batch never says ״יצירת סיכום״ (its button is ״העלאה״)");
  assert.ok(batch.steps.some((s) => s.say.includes("בשם של הקובץ")), "the batch says what each file becomes");
  assert.equal(batch.screen, "העלאה של כמה קבצים");
  // The single upload points at the batch only with the course pages.
  const one = (names: string[]) => screenGuide({ v: "upload" }, flagSet(names))!.steps.map((s) => s.target.sel);
  assert.ok(one(S2).includes(TARGETS.uploadMany));
  assert.ok(!one(PROD).includes(TARGETS.uploadMany));
  // The words the members will see first.
  const words = (r: Route) => screenGuide(r, f)!.steps.map((s) => s.say).join(" ");
  assert.ok(/בחינם/.test(words({ v: "course", c: ID })) && /נשארו היום/.test(words({ v: "course", c: ID })), "the course page: what is free, what counts");
  assert.ok(/תקציב/.test(words({ v: "exams", isNew: true, c: ID })), "the exam upload: its cost");
  assert.ok(/אחרי שבוחרים/.test(words({ v: "exams", isNew: true, c: ID })), "the price is on the button only once a file is picked");
  assert.ok(/לכל מי שבקבוצה בנפרד/.test(words({ v: "exams", isNew: true, c: ID })), "3 exams a day is each member's own limit");
  assert.ok(/בתקציב החודשי/.test(words({ v: "course", c: ID })) && /בתקציב החודשי/.test(words({ v: "ask", c: ID })), "a course question counts in the budget too");
  const review = screenGuide({ v: "exams", e: ID, c: ID }, f)!.steps;
  assert.ok(review[review.length - 1].say.includes("לכל הקבוצה"), "the review's last step: a mark is for the whole group");
  assert.ok(/בחינם/.test(words({ v: "mock", c: ID })) && /ממשיך/.test(words({ v: "mock", c: ID })), "the simulation: free, and the clock goes on");
});

test("decision 1 (sources.md): the exam upload's mini-guide says nothing of where the exam goes", () => {
  for (const names of [S2, ALL]) {
    const g = screenGuide({ v: "exams", isNew: true, c: ID }, flagSet(names))!;
    for (const s of g.steps) for (const word of ["לאן", "נשמר", "לא יוצא", "פרטיות"]) assert.ok(!s.say.includes(word), `${word}: ${s.say}`);
  }
});

test("the new places are all in TARGETS; the group's and the budget's controls are STOPs; the course walk has none", () => {
  const known = new Set<string>(Object.values(TARGETS));
  const f = flagSet(S2);
  for (const r of ROUTES) for (const s of screenGuide(r, f)?.steps ?? []) assert.ok(known.has(s.target.sel), `${routeUrl(r)}: ${s.target.sel}`);
  for (const sel of [
    ".exam-new .ph-foot .a-btn.primary",
    ".r-acts .a-btn.primary",
    ".r-optbtn",
    ".r-acts .r-reread",
    ".x-units .x-retry",
    ".c-sheet button[type=submit]",
    ".course-ask .k-composer button[type=submit]",
    ".upload .ph-foot .a-btn.primary", // the batch's "העלאה (N קבצים)" too: its <main> is "upload upload-many"
  ])
    assert.ok(STOP_SELECTORS.includes(sel as never), sel);
  assert.ok(!STOP_SELECTORS.includes(TARGETS.simStart as never), "the simulation's ״להתחיל״ is free and only the member's: not a STOP");
  const w = walkOf("course", f, FULL)!;
  assert.deepEqual(w.steps.map((s) => s.target.sel), [TARGETS.libraryTab, TARGETS.courseLink, TARGETS.courseExam, TARGETS.courseActions]);
  // The last bubble is true on a brand-new course too: no simulation there until a past exam is ready.
  const end = w.steps[w.steps.length - 1].say;
  assert.ok(!end.startsWith("כאן הסימולציה") && /כשיש מבחן קודם מוכן/.test(end), end);
  assert.ok(/שואלים/.test(end) && /מתרגלים/.test(end), `the course question and practice are named: ${end}`);
  assert.equal(w.steps[2].say, "תאריך המבחן ואורכו, אחד לכל הקבוצה.", "S8's ״תאריך המבחן״ is shown on the way");
  const plain = walkOf("course", flagSet(["COURSES"]), FULL)!;
  assert.deepEqual(plain.steps.map((s) => s.target.sel), [TARGETS.libraryTab, TARGETS.courseLink, TARGETS.courseExam], "courses alone: the walk ends on the exam's date");
  assert.ok(w.steps.every((s) => !s.stop), "no STOP on the way to a course page");
  assert.equal(w.steps[w.steps.length - 1].until, "end");
  assert.equal(walkOf("course", f, { ...FULL, courses: 0 }), null, "no course yet: no ״הראו לי״");
  assert.equal(walkOf("course", flagSet(PROD), FULL), null, "without the course pages: none");
  for (const s of appTour(f).steps) assert.ok(!STOP_SELECTORS.some((x) => s.target.sel.includes(x)), s.target.sel);
});

test("search under production's flags: each way a member asks finds its how-to; the six ״שאלות נפוצות״ stay", () => {
  const list = howTos(flagSet(S2));
  const keys = (q: string) => searchHowTos(q, list).map((h) => h.key);
  const ASKED: Array<[string, string]> = [
    ["לאחד קורסים", "coursename"],
    ["לשנות שם קורס", "coursename"],
    ["תאריך מבחן", "course"],
    ["אורך מבחן", "course"],
    ["העלאה נעצרה", "uploadstopped"],
    ["להעלות מבחן", "examupload"],
    ["שנים קודמות", "examupload"],
    ["מבחנים קודמים", "examupload"],
    ["צילום", "examupload"],
    ["דף תשובות", "examupload"],
    ["מועד", "examupload"],
    ["סימולציה", "sim"],
    ["להגיש", "sim"],
    ["שעון", "sim"],
    ["מפת השאלות", "sim"],
    ["לאשר תשובה", "examcheck"],
    ["תשובה מוצעת", "examcheck"],
    ["לתקן טקסט", "examcheck"],
    ["לתרגל מבחן", "examreplay"],
    ["לתרגל קורס", "coursepractice"],
    ["לשאול על הקורס", "courseask"],
    ["נכון לא נכון", "qtypes"],
    ["התאמה", "qtypes"],
    ["סידור", "qtypes"],
    ["שרטוט", "qimage"],
    ["מקרה בשלבים", "qimage"],
    ["כמה עולה", "uploadmany"],
    ["הרבה מצגות", "uploadmany"],
    // The second review's phrasings: the app's own plural, plurals and construct forms, two prefixes, question words.
    ["איך מעלים מבחן", "examupload"],
    ["מעלים מבחן", "examupload"],
    ["סימולציות", "sim"],
    ["לעשות סימולציה", "sim"],
    ["סימולציית מבחן", "sim"],
    ["מבחנים מהשנים הקודמות", "examupload"],
    ["תשובה שגויה", "examcheck"],
    ["תשובה לא נכונה", "examcheck"],
    ["כמה זה עולה", "cost"],
    ["עולה כסף", "cost"],
    ["מה בחינם", "cost"],
    ["איפה סוג שאלה", "qtypes"],
  ];
  assert.equal(ASKED.length, 40);
  for (const [q, key] of ASKED) assert.ok(keys(q).includes(key), `${q} → ${key} (found ${keys(q).join(", ")})`);
  assert.deepEqual(keys(""), ["read", "upload", "invite", "comment", "practice", "bet"], "the six ״שאלות נפוצות״");
  // A how-to with a walk has one only once there is a course to walk to.
  for (const h of list) if (h.walk === "course") assert.ok(walkOf(h.walk, flagSet(S2), FULL), h.key);
  // The status line: one answer, several, only help's rows, nothing.
  assert.equal(hitsLine(1, 0), "תשובה אחת");
  assert.equal(hitsLine(3, 2), "3 תשובות");
  assert.equal(hitsLine(0, 2), ROWS_ONLY);
  assert.equal(hitsLine(0, 0), NO_HITS);
});

test("the first steps under production's flags: ״להציץ בעמוד הקורס״ once there is a course", () => {
  const f = flagSet(S2);
  const ids = (m: Partial<Memory> = {}, x: Facts = FULL, g: Flags = f) => firstSteps(g, x, { list: [], mode: "join", ...m }).map((s) => s.id);
  assert.deepEqual(ids(), ["S1", "S2", "S4", "S8", "S5"], "a joiner: the course page before the queue");
  assert.deepEqual(ids({ mode: "create" }), ["S1", "S6", "S2", "S4", "S8"], "a creator: the invite kept");
  assert.ok(!ids({}, { ...FULL, courses: 0 }).includes("S8"), "no course yet: no S8");
  assert.ok(!ids({}, FULL, flagSet(PROD)).includes("S8"), "without the course pages: no S8");
  assert.equal(ids({}, { ...NO_FACTS, members: 1 })[0], "S1", "a brand-new group: the upload first");
  const s1 = firstSteps(f, { ...NO_FACTS, members: 1 }, { list: [], mode: "create" })[0];
  assert.ok(s1.line.includes("אפשר להעלות אותן יחד"), s1.line);
  const s8 = firstSteps(f, FULL, { list: [], mode: "join" }).find((s) => s.id === "S8")!;
  assert.equal(s8.title, "להציץ בעמוד הקורס");
  assert.equal(s8.walk, "course");
  // Lists already stored are kept as they were.
  assert.deepEqual(ids({ list: ["S1", "S2", "S4", "S5", "S6"] }), ["S1", "S2", "S4", "S5", "S6"], "a stored list of five stays five");
  assert.equal(routeEvent({ v: "course", c: ID }), "course");
  const now = 1_000_000;
  const m: Memory = { v: 1, born: now, mode: "join", views: 1, did: ["open"], list: ["S1", "S2", "S4", "S8", "S5"], tips: true };
  assert.equal(recordEvent(m, "course", now).tick, "✓ 2 מתוך 5: להציץ בעמוד הקורס");
  const parsed = parseMemory(JSON.stringify({ did: ["course"], list: ["S8"] }));
  assert.deepEqual([parsed.did, parsed.list], [["course"], ["S8"]]);
});

test("״חדש״: the course pages and past exams have their hints, in order, after what a member knew", () => {
  const f = flagSet(S2);
  for (const k of ["courses", "exams", "qtypes"]) assert.ok(hintFlags(f).includes(k), k);
  const say = (flag: string) => HINTS.find((h) => h.flag === flag)!.say;
  assert.ok(!say("qtypes").includes("שאלות חדשות") && say("qtypes").includes("״סבב חדש״ ← ״סוג שאלה״"), "the types are answered in a round, not bought in ״שאלות חדשות״");
  assert.ok(!say("courses").includes("תרגול"), "the courses hint holds without PRACTICE");
  for (const h of HINTS) assert.ok(!h.say.startsWith("חדש"), `the kicker says ״חדש״ already: ${h.say}`);
  const now = 100 * RETIRE_MS;
  const m: Memory = { v: 1, views: 0, did: [], list: [], tips: true, known: hintFlags(flagSet(PROD)), offer: "dismissed" };
  const first = nextHint(m, f, "2026-11-20", now);
  assert.equal(first?.flag, "courses");
  assert.equal(nextHint({ ...m, known: [...m.known!, "courses"] }, f, "2026-11-20", now)?.flag, "exams");
  assert.equal(nextHint({ ...m, born: now - 1000 }, f, "2026-11-20", now), null, "never in a member's first 14 days");
});
