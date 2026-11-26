import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_PREFS, quietUntil, SHABBAT } from "./notifyQuiet.js";

const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
const u = (iso: string) => Date.parse(iso);
const q = (p: Partial<typeof DEFAULT_PREFS>, at: string) => {
  const r = quietUntil({ ...DEFAULT_PREFS, ...p }, u(at));
  return r === null ? null : new Date(r).toISOString();
};

test("the defaults are study_notify_prefs's column defaults (section R)", () => {
  const table = /create table if not exists public\.study_notify_prefs \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? "";
  assert.ok(table, "the table");
  const found: Record<string, unknown> = {};
  for (const m of table.matchAll(/^\s+(\w+)\s+(boolean|time)\s+not null default (true|false|'(\d\d:\d\d)')/gm)) {
    found[m[1]] = m[2] === "boolean" ? m[3] === "true" : m[4];
  }
  assert.deepEqual(found, DEFAULT_PREFS);
  // And the row notify_prefs_of() answers when there is none.
  assert.match(sql, /row\(p_user, true, true, false, time '19:30', true, time '23:00', time '07:30', false, null::timestamptz\)/);
});

test("Shabbat's window is the SQL's", () => {
  assert.ok(sql.includes(`(dw = 5 and tm >= time '${SHABBAT.from}') or (dw = 6 and tm < time '${SHABBAT.to}')`));
});

test("the default night, 23:00 to 07:30 Israel time (the same instants as study.sql's R16b)", () => {
  assert.equal(q({}, "2026-11-26T21:30:00Z"), "2026-11-27T05:30:00.000Z", "23:30: until 07:30");
  assert.equal(q({}, "2026-11-27T04:00:00Z"), "2026-11-27T05:30:00.000Z", "06:00");
  assert.equal(q({}, "2026-11-27T05:30:00Z"), null, "07:30: open");
  assert.equal(q({}, "2026-11-26T20:59:00Z"), null, "22:59");
  assert.equal(q({}, "2026-11-26T21:00:00Z"), "2026-11-27T05:30:00.000Z", "23:00 sharp: quiet");
  assert.equal(q({}, "2026-11-27T05:29:59.500Z"), "2026-11-27T05:30:00.000Z", "a moment before 07:30");
});

test("on both clock changes of 2026", () => {
  assert.equal(q({}, "2026-03-27T00:30:00Z"), "2026-03-27T04:30:00.000Z", "summer time starts that night: 07:30 is UTC+3");
  assert.equal(q({}, "2026-10-24T21:30:00Z"), "2026-10-25T05:30:00.000Z", "it ends that night: 07:30 is UTC+2");
  assert.equal(q({}, "2027-03-26T01:00:00Z"), "2027-03-26T04:30:00.000Z", "2027's start");
});

test("Shabbat, Friday 16:00 to Saturday 20:30, and a night that ends inside it (R16c)", () => {
  const s = { shabbat: true };
  assert.equal(q(s, "2026-11-27T14:30:00Z"), "2026-11-28T18:30:00.000Z", "Friday 16:30");
  assert.equal(q(s, "2026-11-28T03:00:00Z"), "2026-11-28T18:30:00.000Z", "Saturday 05:00");
  assert.equal(q(s, "2026-11-27T13:59:00Z"), null, "Friday 15:59");
  assert.equal(q(s, "2026-11-28T18:30:00Z"), null, "Saturday 20:30");
  assert.equal(q({ ...s, quiet: false }, "2026-11-27T22:00:00Z"), "2026-11-28T18:30:00.000Z", "Shabbat alone");
  assert.equal(q({ shabbat: false }, "2026-11-27T14:30:00Z"), null, "off by default");
  assert.equal(q(s, "2026-06-12T13:30:00Z"), "2026-06-13T17:30:00.000Z", "in summer, 20:30 is UTC+3");
});

test("other windows: inside one day, off, empty", () => {
  assert.equal(q({ quiet_from: "07:00", quiet_to: "09:00" }, "2026-11-26T06:00:00Z"), "2026-11-26T07:00:00.000Z");
  assert.equal(q({ quiet_from: "07:00", quiet_to: "09:00" }, "2026-11-26T07:00:00Z"), null);
  assert.equal(q({ quiet: false }, "2026-11-26T21:30:00Z"), null);
  assert.equal(q({ quiet_from: "22:00", quiet_to: "22:00" }, "2026-11-26T20:30:00Z"), null, "from = to: no window");
});
