import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

// supabase/parts/1.sql … 7.sql are study-schema.sql cut for the SQL Editor
// (tools/sql-parts.mjs). A schema change without `npm run sql:parts` would
// leave someone running the old SQL in parts.
test("supabase/parts is study-schema.sql as it is now, in 7 parts", () => {
  const r = spawnSync(process.execPath, [join(process.cwd(), "tools", "sql-parts.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
