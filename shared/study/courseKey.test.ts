import assert from "node:assert/strict";
import { test } from "node:test";
import { courseKey } from "./courseKey.js";

// The same cases as supabase/tests/study.sql's S1a2 (study_private.course_key).
test("a course's key: spaces of every kind, direction marks, capitals (as the SQL's)", () => {
  const got = [
    "פרמקו ",
    "\tפרמקו",
    "פרמקו  ב",
    "‏פרמקו‎",
    "ÉCOLE",
    "Pharma B　",
    "​⁠⁦x⁩",
    "  ",
    null,
  ].map((x) => `[${courseKey(x)}]`);
  assert.equal(got.join(" "), "[פרמקו] [פרמקו] [פרמקו ב] [פרמקו] [école] [pharma b] [x] [] []");
});

test("the SQL's white space is JavaScript's \\s", () => {
  // study_private.course_key's class: \t \n \v \f \r, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
  const sql = [9, 10, 11, 12, 13, 32, 0xa0, 0x1680, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
  const js: number[] = [];
  for (let c = 0; c <= 0xffff; c++) if (/\s/.test(String.fromCharCode(c))) js.push(c);
  assert.deepEqual(js, sql);
});
