#!/usr/bin/env node
// The study app's offline unit tests (spec §8.2): every *.test.ts(x) under
// server/, shared/ and src/study/ is bundled with the repo's esbuild (the one
// Vite brings: bundle, platform node, ESM, packages external, so both the
// extensionless imports of src/ and the ".js" imports of server/ and shared/
// resolve) and run with node --test. No network, no API key, no database:
// the tests use local mocks only, and finish in well under 3 minutes.
//
//   npm run test:study                    every test
//   npm run test:study -- budget claude   only the files whose path contains a word
//   npm run test:study -- --list          the files it would run
//
// Each run bundles into its own folder, node_modules/.cache/study-tests/<pid>,
// and removes it at the end: several worktrees share one node_modules, so two
// runs at once must not delete each other's bundles.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const list = args.includes("--list");
const words = args.filter((a) => !a.startsWith("--"));
const out = join(root, "node_modules", ".cache", "study-tests", String(process.pid));

function find(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // a folder that does not exist yet
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) find(p, found);
    else if (/\.test\.tsx?$/.test(e.name)) found.push(p);
  }
  return found;
}

const tests = ["server", "shared", join("src", "study")]
  .flatMap((d) => find(join(root, d)))
  .filter((f) => !words.length || words.some((w) => relative(root, f).includes(w)))
  .sort();
if (!tests.length) {
  console.error(words.length ? `No study test matches ${words.join(", ")}.` : "No study tests found.");
  process.exit(1);
}
if (list) {
  for (const t of tests) console.log(relative(root, t));
  process.exit(0);
}

mkdirSync(out, { recursive: true });
let status = 1;
try {
  const bundles = [];
  for (const file of tests) {
    const name = relative(root, file).split(sep).join("__").replace(/\.tsx?$/, ".mjs");
    const outfile = join(out, name);
    await build({
      entryPoints: [file],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "external", // the SDKs load from node_modules, as on Vercel
      sourcemap: "inline",
      logLevel: "error",
      outfile,
    });
    bundles.push(outfile);
  }
  console.log(`${bundles.length} test files`);
  const run = spawnSync(process.execPath, ["--enable-source-maps", "--test", "--test-reporter=spec", "--test-timeout=180000", ...bundles], {
    stdio: "inherit",
    cwd: root,
  });
  status = run.status ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(status);
