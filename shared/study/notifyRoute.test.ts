import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseRoute, routeUrl, type Route } from "../../src/study/lib/route";
import { objOf, routeQuery } from "./notifyRoute.js";

const L = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";
const E = "33333333-3333-4333-8333-333333333333";
const M = "44444444-4444-4444-8444-444444444444";
const D = "55555555-5555-4555-8555-555555555555";

/** One route of every kind of screen, with every key set where it can be. */
const ROUTES: Route[] = [
  { v: "today" },
  { v: "today", run: true },
  { v: "library" },
  { v: "upload", c: L, many: true },
  { v: "help" },
  { v: "lecture", l: L },
  { v: "lecture", l: L, at: { part: 2, anchor: 4 }, slide: 7, mk: Q, read: true, follow: true },
  { v: "practice", l: L, n: "10" },
  { v: "practice", l: L, x: "bank", r: Q },
  { v: "practice", s: `p.${L}.1.2`, n: "all" },
  { v: "exams", e: E, c: "קורס בדוי", isNew: true },
  { v: "quiz", q: Q },
  { v: "quiz", l: L, c: "c", isNew: true, mk: Q, m: M, preset: "stop", pf: 1, pt: 3 },
  { v: "cards", l: L, s: "today" },
  { v: "ask", l: L, at: { part: 0, anchor: 1 }, first: "שאלה בדויה", c: Q },
  { v: "course", c: L, seg: "exams" },
  { v: "mock", c: L, e: E },
  { v: "group" },
  { v: "marathon", m: M, isNew: true, edit: true },
  { v: "me" },
  { v: "progress", t: "נושא", x: "danger" },
  { v: "plan", edit: true, lane: "mine", d: "2026-11-26" },
  { v: "meeting", m: M, isNew: true, edit: true },
  { v: "catchup", l: L, m: M },
  { v: "log", l: L },
  { v: "dispute", d: D },
  { v: "pulse", l: L },
  { v: "museum", l: L },
  { v: "wall", l: L, d: "x", t: "top", at: { part: 1, anchor: 0 }, x: "post" },
  { v: "boss", isNew: true, l: L },
  { v: "eve", l: L },
  { v: "trap", l: L, at: { part: 3, anchor: 2 }, d: D },
  { v: "try", s: "b" },
  { v: "install" },
  { v: "notify" },
  { v: "notify", x: "set" },
];

test("routeQuery writes exactly what routeUrl writes, for every kind of screen", () => {
  for (const r of ROUTES) {
    // As section R stores it: JSON, so the route has been through JSON.stringify.
    const stored = JSON.parse(JSON.stringify(r));
    assert.equal(routeQuery(stored), routeUrl(r), JSON.stringify(r));
    assert.deepEqual(parseRoute(new URL(routeQuery(stored), "https://x.test").search), r, `round trip ${JSON.stringify(r)}`);
  }
});

test("the routes section R's hooks write (Today included)", () => {
  assert.equal(routeQuery({ v: "today" }), "/");
  assert.equal(routeQuery({ v: "me" }), "/?v=me");
  assert.equal(routeQuery({ v: "quiz", q: Q }), `/?v=quiz&q=${Q}`);
  assert.equal(routeQuery({ v: "lecture", l: L }), `/?l=${L}`);
  assert.equal(routeQuery({ v: "lecture", l: L, at: { part: 2, anchor: 4 } }), `/?l=${L}&at=2.4`);
  assert.equal(routeQuery({ v: "practice", l: L, n: "10" }), `/?v=practice&l=${L}&n=10`);
  // R 2
  assert.equal(routeQuery({ v: "meeting", m: M }), `/?v=meeting&m=${M}`);
  assert.equal(routeQuery({ v: "marathon", m: M }), `/?v=marathon&m=${M}`);
  assert.equal(routeQuery({ v: "wall", l: L }), `/?v=wall&l=${L}`);
  assert.equal(routeQuery({ v: "dispute", d: D }), `/?v=dispute&d=${D}`);
  assert.equal(routeQuery({ v: "exams", e: E }), `/?v=exams&e=${E}`);
});

test("the hooks' routes in study-schema.sql are all kinds routeQuery knows", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  // Section R's own hooks. Section L's set_solved (route {v:"sets",k}) writes
  // nothing until R registers that kind (WP17), which adds "sets" here.
  const r = sql.slice(sql.indexOf("-- ════ BEGIN SECTION R "), sql.indexOf("-- ════ END SECTION R ════"));
  const kinds = new Set([...r.matchAll(/jsonb_build_object\('v', '([a-z]+)'/g)].map((m) => m[1]));
  assert.ok(kinds.size >= 3, [...kinds].join(","));
  for (const v of kinds) assert.notEqual(parseRoute(new URL(routeQuery({ v, l: L, q: Q }), "https://x.test").search).v, undefined, v);
  for (const v of kinds) assert.ok(ROUTES.some((x) => x.v === v), `${v}: add it to ROUTES above`);
  // R 2's hooks link to these screens too (a meeting, a study day, the wall, a dispute, a past exam, Today).
  for (const v of ["meeting", "marathon", "wall", "dispute", "exams", "today"]) assert.ok(kinds.has(v), v);
});

test("a stored route is data: unknown keys, bad values and non-routes write nothing more", () => {
  assert.equal(routeQuery({ v: "lecture", l: L, evil: "x" }), `/?l=${L}`);
  assert.equal(routeQuery({ v: "quiz", q: { $ne: 1 } }), "/?v=quiz");
  assert.equal(routeQuery({ v: "quiz", q: Q, l: ["a"] }), `/?v=quiz&q=${Q}`);
  assert.equal(routeQuery({ v: "<script>" }), "/");
  assert.equal(routeQuery({ v: "javascript:alert(1)" }), "/");
  assert.equal(routeQuery(null), "/");
  assert.equal(routeQuery("?v=me"), "/");
  assert.equal(routeQuery([]), "/");
  assert.equal(routeQuery({}), "/");
  // A screen this build does not know yet writes only its v: the app's allowed() sends it home.
  assert.equal(routeQuery({ v: "sets", x: "y" }), "/?v=sets");
  assert.equal(routeQuery({ v: "lecture", l: "a&b=c" }), "/?l=a%26b%3Dc");
});

test("objOf: what each screen sees", () => {
  assert.equal(objOf({ v: "lecture", l: L, at: { part: 1, anchor: 2 } }), `lec:${L}`);
  assert.equal(objOf({ v: "quiz", q: Q }), `quiz:${Q}`);
  assert.equal(objOf({ v: "exams", e: E }), `exam:${E}`);
  assert.equal(objOf({ v: "meeting", m: M }), `meet:${M}`);
  assert.equal(objOf({ v: "dispute", d: D }), `disp:${D}`);
  assert.equal(objOf({ v: "wall", l: L }), `wall:${L}`);
  assert.equal(objOf({ v: "wall", l: L, x: "drafts" }), null, "the wall's drafts are not the wall");
  for (const r of [{ v: "today" }, { v: "me" }, { v: "library" }, { v: "quiz" }, { v: "quiz", isNew: true }, { v: "exams" }, { v: "lecture", l: "x" }, null, "lec"])
    assert.equal(objOf(r), null, JSON.stringify(r));
});

test("objOf agrees with the obj section R's hooks store", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  const r = sql.slice(sql.indexOf("-- ════ BEGIN SECTION R "));
  assert.match(r, /jsonb_build_object\('v', 'quiz', 'q', new\.id\), 'quiz:' \|\| new\.id/);
  assert.match(r, /jsonb_build_object\('v', 'lecture', 'l', new\.id\), 'lec:' \|\| new\.id/);
  assert.equal(objOf({ v: "quiz", q: Q }), `quiz:${Q}`);
  assert.equal(objOf({ v: "lecture", l: L }), `lec:${L}`);
});
