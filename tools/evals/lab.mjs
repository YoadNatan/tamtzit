#!/usr/bin/env node
// "השוואת מודלים" offline (design-models §12.4): the comparison's frozen
// requests and its $0 checks, with no key and no model call.
//
//   node tools/evals/lab.mjs --print <dir>   one frozen request per kind with an answer key, as op lab
//                                            freezes it (server/study/lab.ts): <kind>.request.json (the
//                                            request, its pictures as storage paths) and <kind>.key.json
//   node tools/evals/lab.mjs --check <dir>   reads every <kind>.<name>.out.txt (a model's answer, as
//                                            text) next to them and prints checksFor's result for each
//
// <dir> must be outside the repository: course material never lands in git.
// Inputs: STUDY_EVAL_FIXTURES, a folder with the group's material (slides.json;
// lab.json with bank questions and a decided correction; exam/exam12.json-shaped
// pages and replies); unset, the synthetic fixtures of e2e/study/fixtures.
import { build } from "esbuild";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const [mode, given] = process.argv.slice(2);
if (!["--print", "--check"].includes(mode) || !given) {
  console.error("usage: node tools/evals/lab.mjs --print <dir> | --check <dir>   (<dir> outside the repository)");
  process.exit(2);
}

/** The real path of `p` (symbolic links resolved), through its nearest existing parent. */
function real(p) {
  let head = resolve(p);
  const tail = [];
  while (!existsSync(head) && dirname(head) !== head) {
    tail.unshift(basename(head));
    head = dirname(head);
  }
  return join(realpathSync(head), ...tail);
}
/** Whether `p` is the repository or inside it. */
function insideRepo(p, repo = realpathSync(root)) {
  const rel = relative(repo, real(p));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
if (insideRepo(given)) {
  console.error(`lab.mjs: ${given} is inside the repository; give a folder outside it (course material never lands in git).`);
  process.exit(2);
}
const dir = real(given);

/* ── the op's own code, bundled as the tests are (tools/study-tests.mjs) ── */
const cache = join(root, "node_modules", ".cache", "study-evals", `lab-${process.pid}`);
mkdirSync(cache, { recursive: true });
const entry = `export { solverFrozen, fixCheckFrozen, readFrozen, checksFor, labEstimate } from ${JSON.stringify(join(root, "server/study/lab.ts"))};
export { citedSlidesText } from ${JSON.stringify(join(root, "server/study/ops/fixcheck.ts"))};`;
await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", outfile: join(cache, "lab.mjs"), logLevel: "error" });
const op = await import(pathToFileURL(join(cache, "lab.mjs")).href);
process.on("exit", () => rmSync(cache, { recursive: true, force: true }));

/* ── the material ── */
const FX = process.env.STUDY_EVAL_FIXTURES || join(root, "e2e", "study", "fixtures");
const read = (f) => JSON.parse(readFileSync(join(FX, f), "utf8"));
const tablesOf = (t) => (Array.isArray(t) && t.length && Array.isArray(t[0]) && typeof t[0][0] === "string" ? [t] : (t ?? []));
const slides = read("slides.json").map((s) => ({ n: s.n, title: s.title, lines: s.lines ?? [], tables: tablesOf(s.tables), notes: s.notes ?? "", figures: s.figures ?? [] }));
const lecture = { id: "eval", group_id: "eval", course: "", title: "eval", lecturer: "", lecture_date: null, source_kind: "pptx", slides };
const lab = existsSync(join(FX, "lab.json")) ? read("lab.json") : read(join("lab", "lab.json"));
const exam = existsSync(join(FX, "exam", "exam12.json")) ? read(join("exam", "exam12.json")) : null;

function frozenOf() {
  const out = {
    solver: op.solverFrozen(lecture, lab.bank),
    fix_check: op.fixCheckFrozen(lecture, lab.proposal, op.citedSlidesText(lecture, lab.proposal.source_slides)),
  };
  if (exam?.units?.length) {
    // The first unit, its pages with stand-in links (the frozen request keeps their paths only).
    const u = exam.units[0];
    const base = "https://eval.invalid";
    process.env.VITE_STUDY_SUPABASE_URL = base;
    const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const token = `${part({ alg: "none" })}.${part({ exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
    const page = (n) => ({ n, path: `eval/exams/eval/p${n}.jpg`, w: 1500, h: 2121, lines: exam.pages[n - 1]?.lines ?? [], url: `${base}/storage/v1/object/sign/study/eval/exams/eval/p${n}.jpg?token=${token}` });
    const reference = u.reply.questions.map((q) => ({ id: String(q.no), question: `${q.vignette ?? ""} ${q.question}`.trim(), options: q.options.length, figure: Number(q.figure?.page ?? 0) > 0, page: q.page }));
    const f = op.readFrozen("exam_read", {
      exam: { id: "eval", group_id: "eval", title: "eval", key_source: "separate", kind: "exam", lecture_id: null, course: "" },
      pages: u.pages.map(page),
      prev: null,
      next: u.next !== null ? page(u.next) : null,
      seen: [],
      seenLabels: [],
      reference,
    });
    if (f) out.exam_read = f;
  }
  return out;
}

mkdirSync(dir, { recursive: true });

if (mode === "--print") {
  for (const [kind, f] of Object.entries(frozenOf())) {
    const { key, ...request } = f;
    writeFileSync(join(dir, `${kind}.request.json`), JSON.stringify(request, null, 1) + "\n");
    writeFileSync(join(dir, `${kind}.key.json`), JSON.stringify(key, null, 1) + "\n");
    console.log(`${kind}: worst case on the default model $${op.labEstimate(f, "claude-opus-5-5").toFixed(4)} → ${kind}.request.json, ${kind}.key.json`);
  }
  console.log(`\nAnswers: save each model's reply text as <kind>.<name>.out.txt in ${dir}, then --check.`);
  process.exit(0);
}

let n = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".out.txt")).sort()) {
  const kind = file.split(".")[0];
  const keyFile = join(dir, `${kind}.key.json`);
  if (!existsSync(keyFile)) {
    console.log(`${file}: no ${kind}.key.json (run --print first)`);
    continue;
  }
  const checks = op.checksFor(JSON.parse(readFileSync(keyFile, "utf8")), readFileSync(join(dir, file), "utf8"), true);
  n += 1;
  console.log(`${file}: ${JSON.stringify(checks)}`);
}
console.log(n ? `\n${n} answers checked.` : `No <kind>.<name>.out.txt in ${dir}.`);
process.exit(0);
