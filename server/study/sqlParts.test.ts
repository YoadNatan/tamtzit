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

// supabase/parts/1.sql … 8.sql are study-schema.sql cut for the SQL Editor
// (tools/sql-parts.mjs). A schema change without `npm run sql:parts` would
// leave someone running the old SQL in parts.
test("supabase/parts is study-schema.sql as it is now, in 8 parts", () => {
  const r = spawnSync(process.execPath, [join(process.cwd(), "tools", "sql-parts.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /\(8 parts\)/);
});

// Supabase's SQL Editor does not run a much bigger paste: every part,
// as made now and as written in supabase/parts, is at most 170 KB.
test("every part is at most 170 KB", async () => {
  const { PART_MAX_BYTES, sqlParts } = await tool();
  assert.equal(PART_MAX_BYTES, 170 * 1024);
  const parts = sqlParts(readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8"));
  assert.equal(parts.length, 8);
  parts.forEach((p, k) => {
    const made = Buffer.byteLength(p);
    const written = readFileSync(join(process.cwd(), "supabase", "parts", `${k + 1}.sql`)).length;
    assert.ok(made <= PART_MAX_BYTES, `part ${k + 1} is ${made} bytes`);
    assert.ok(written <= PART_MAX_BYTES, `parts/${k + 1}.sql is ${written} bytes`);
  });
  assert.match(parts[7], /^-- ═══ study-schema\.sql, part 8 of 8 \(section S\) ═══/);
});
