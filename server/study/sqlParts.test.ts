import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

// The tool itself, loaded at run time (not bundled into the test, where it
// would take the test's file for its own command line).
const tool = (): Promise<{ PART_MAX_BYTES: number; sqlParts: (text: string) => string[] }> =>
  import(pathToFileURL(join(process.cwd(), "tools", "sql-parts.mjs")).href);

// supabase/parts/1.sql … 12.sql are study-schema.sql cut for the SQL Editor
// (tools/sql-parts.mjs). A schema change without `npm run sql:parts` would
// leave someone running the old SQL in parts.
test("supabase/parts is study-schema.sql as it is now, in 12 parts", () => {
  const r = spawnSync(process.execPath, [join(process.cwd(), "tools", "sql-parts.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /\(12 parts\)/);
});

// Supabase's SQL Editor does not run a much bigger paste: every part,
// as made now and as written in supabase/parts, is at most 170 KB.
test("every part is at most 170 KB", async () => {
  const { PART_MAX_BYTES, sqlParts } = await tool();
  assert.equal(PART_MAX_BYTES, 170_000, "the smaller reading of 170 KB");
  const parts = sqlParts(readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8"));
  assert.equal(parts.length, 12);
  parts.forEach((p, k) => {
    const made = Buffer.byteLength(p);
    const written = readFileSync(join(process.cwd(), "supabase", "parts", `${k + 1}.sql`)).length;
    assert.ok(made <= PART_MAX_BYTES, `part ${k + 1} is ${made} bytes`);
    assert.ok(written <= PART_MAX_BYTES, `parts/${k + 1}.sql is ${written} bytes`);
  });
  assert.match(parts[7], /^-- ═══ study-schema\.sql, part 8 of 12 \(section S\) ═══/);
  // Part 9: the personal code, then notifications (R), which ship before the
  // wave's other sections (Yoad, 26 Nov 2026).
  assert.match(parts[8], /^-- ═══ study-schema\.sql, part 9 of 12 \(sections I, R\) ═══/);
  // Part 10: practice sets (L), which would take part 9 past 170 KB.
  assert.match(parts[9], /^-- ═══ study-schema\.sql, part 10 of 12 \(section L\) ═══/);
  // Part 11: uploaded sheets (O). O 1 followed L in part 10; O 2 (the sheet
  // reader, open and numeric forms) would take part 10 past 170 KB.
  assert.match(parts[10], /^-- ═══ study-schema\.sql, part 11 of 12 \(section O\) ═══/);
  // Part 12: section O goes on at O 3 (similar questions), which would take
  // part 11 past 170 KB; the cut is O's own "SECTION O CONTINUES · O 3" line.
  assert.match(parts[11], /^-- ═══ study-schema\.sql, part 12 of 12 \(section O, continued: O 3\) ═══/);
  assert.match(parts[11], /^-- ════ SECTION O CONTINUES · O 3 /m);
  assert.match(parts[11], /insert into study_private\.schema_sections \(section, version\) values \('O', 3\)/);
  assert.match(parts[11], /^-- ════ END SECTION O ════$/m);
});

// Section L (practice sets, OD14) redefines study_private.kind_on so the
// question-writing kinds obey the switch questions_paid, and section F
// carries the same text: running part 1 again after part 10 keeps it.
test("kind_on: section F and section L define it with the same text", () => {
  const text = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  const defs = [...text.matchAll(/create or replace function study_private\.kind_on\(p_kind text\)\n[\s\S]*?\n\$\$;/g)].map((m) => m[0]);
  assert.equal(defs.length, 2, "one in F, one in L");
  assert.equal(defs[0], defs[1]);
  assert.match(defs[0], /'practice', 'solver', 'reword', 'style', 'points', 'bank'\) then study_private\.feature_on\('questions_paid'\)/);
  // Section O 3: the similar questions' kind obeys the switch similar (D22), in both texts.
  assert.match(defs[0], /when p_kind = 'similar' then study_private\.feature_on\('similar'\)/);
  const f = text.indexOf("-- ════ BEGIN SECTION F");
  const l = text.indexOf("-- ════ BEGIN SECTION L ");
  assert.ok(f >= 0 && l > f && text.indexOf(defs[0]) < l && text.lastIndexOf(defs[0]) > l);
});
