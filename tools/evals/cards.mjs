#!/usr/bin/env node
// C-6 (spec §8.4, design-cards §6.4): the flashcards' quality eval with
// stand-in output. No API key is used or needed: Claude agents play the model
// on the exact requests printed here, this tool runs the op's own checks
// (checkCard) on what they wrote, and a separate judge grades the cards with
// the rubric R1-R10 (bars: ≥ 95% pass R1-R3, ≥ 85% all ten, none fails R2).
//
//   node tools/evals/cards.mjs --print <dir>   one request per case, as op "cards" sends it:
//                                              <case>.request.json (system blocks, messages,
//                                              max_tokens, output_config with the JSON schema)
//   node tools/evals/cards.mjs --check <dir>   reads each <case>.out.json the writer left
//                                              ({"cards": […]}), runs checkCard, and prints
//                                              the rejects, fixes and warnings per case
//
// Inputs: STUDY_EVAL_FIXTURES, a folder Yoad gives with the group's lecture
// (slides.json, outline.json, parts/*.md; course material, never committed:
// spec §8.3), with the spec's cases: parts 1 (slides 5-7, 4 cards), 3 (13-18,
// 8), 4 (19-23, 7) and 7 (34-38, 7), then round 2 of part 1 with round 1's
// cards as its covered list (printed once part1.out.json exists). Unset, the
// synthetic fixture lecture of e2e/study/fixtures is used, so the tool itself
// can be tried here: its first three parts.
import { build } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const [mode, dir] = process.argv.slice(2);
if (!["--print", "--check"].includes(mode) || !dir) {
  console.error("usage: node tools/evals/cards.mjs --print <dir> | --check <dir>");
  process.exit(2);
}

/* ── the op's own code, bundled as the tests are (tools/study-tests.mjs) ── */
const cache = join(root, "node_modules", ".cache", "study-evals", String(process.pid));
mkdirSync(cache, { recursive: true });
const entry = `
export { cardsCall, checkCard, CardItem, CardSet, figureList } from ${JSON.stringify(join(root, "server/study/cards.ts"))};
export { cleanSchema } from ${JSON.stringify(join(root, "server/study/claude.ts"))};
export { numberBlocks } from ${JSON.stringify(join(root, "shared/study/blocks.ts"))};
export { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
`;
await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", outfile: join(cache, "cards.mjs"), logLevel: "error" });
const op = await import(pathToFileURL(join(cache, "cards.mjs")).href);
process.on("exit", () => rmSync(cache, { recursive: true, force: true }));

/* ── the lecture and its cases ── */
const given = process.env.STUDY_EVAL_FIXTURES;
const FX = given || join(root, "e2e", "study", "fixtures");
const read = (f) => JSON.parse(readFileSync(join(FX, f), "utf8"));
// A slide's tables are rows of cells per table; a file that keeps one table's rows directly is read as that one table.
const tablesOf = (t) => (Array.isArray(t) && t.length && Array.isArray(t[0]) && typeof t[0][0] === "string" ? [t] : (t ?? []));
const slides = read("slides.json").map((s) => ({ n: s.n, title: s.title, lines: s.lines ?? [], tables: tablesOf(s.tables), notes: s.notes ?? "", figures: s.figures ?? [] }));
const outline = existsSync(join(FX, "outline.json")) ? read("outline.json") : read("outline-r4.json");
const parts = existsSync(join(FX, "parts"))
  ? readdirSync(join(FX, "parts")).filter((f) => f.endsWith(".md")).sort().map((f) => readFileSync(join(FX, "parts", f), "utf8"))
  : [];
const lecture = { id: "eval", group_id: "eval", course: outline.course ?? "", title: outline.title ?? "", lecturer: outline.lecturer ?? "", lecture_date: null, source_kind: "pptx", slides };
const part = (i) => {
  const p = outline.parts[i];
  return { idx: i, heading: p.heading, slide_from: p.from, slide_to: p.to };
};
const CASES = given
  ? [
      { name: "part1", part: part(1), count: 4 },
      { name: "part3", part: part(3), count: 8 },
      { name: "part4", part: part(4), count: 7 },
      { name: "part7", part: part(7), count: 7 },
    ]
  : [
      { name: "part0", part: part(0), count: 3 },
      { name: "part1", part: part(1), count: 2 },
      { name: "part2", part: part(2), count: 3 },
    ];
const SECOND = "part1";
const lectureSlides = new Set(slides.map((s) => s.n));
const figuresOf = (p) => {
  const have = new Set(slides.flatMap((s) => s.figures.map((f) => `fig:${s.n}-${f.k}`)));
  return op.figureList(parts, p.slide_from, p.slide_to).filter((f) => have.has(f.id) || !given);
};
const outFile = (name) => join(dir, `${name}.out.json`);
const known = (name) => (existsSync(outFile(name)) ? JSON.parse(readFileSync(outFile(name), "utf8")).cards ?? [] : []);
// C's end: a case's part paragraph by paragraph, as the op sends it (the part's file, when there is one).
const blocksOf = (p) => (parts[p.idx] ? op.numberBlocks(parts[p.idx]) : []);
const asKnown = (cards) =>
  cards.map((c, i) => ({ id: `k${i}`, kind: c.cloze ? "cloze" : "qa", front: String(c.front ?? ""), back: String(c.back ?? ""), topic: String(c.topic ?? ""), aspect: String(c.aspect ?? ""), slides: c.slides ?? [] }));

mkdirSync(dir, { recursive: true });

if (mode === "--print") {
  const schema = op.cleanSchema(op.zodOutputFormat(op.CardSet).schema);
  const cases = [...CASES];
  // Round 2 of part 1, once round 1's cards exist: its covered list is what they say.
  if (existsSync(outFile(SECOND))) cases.push({ name: `${SECOND}-round2`, part: CASES.find((c) => c.name === SECOND).part, count: Math.max(2, Math.round(CASES.find((c) => c.name === SECOND).count / 2)), known: asKnown(known(SECOND)) });
  for (const c of cases) {
    const call = op.cardsCall({ lecture, claim: c.part, figures: figuresOf(c.part), corrections: [], known: c.known ?? [], blocks: blocksOf(c.part) }, c.count);
    const request = { system: call.system, messages: call.messages, max_tokens: call.maxTokens, output_config: { effort: "medium", format: { type: "json_schema", schema } } };
    writeFileSync(join(dir, `${c.name}.request.json`), JSON.stringify(request, null, 1) + "\n");
    console.log(`${c.name}: slides ${c.part.slide_from}-${c.part.slide_to}, ${c.count} cards, ${call.inputChars} characters of input → ${c.name}.request.json`);
  }
  console.log(`\nWriters: "You are the model behind this API call. Reply only with JSON valid against this schema." + the request; save the reply as <case>.out.json in ${dir}.`);
  process.exit(0);
}

// --check: the op's checks on every card the writers produced.
let total = 0;
let passed = 0;
let warned = 0;
const report = [];
for (const c of [...CASES, { name: `${SECOND}-round2`, part: CASES.find((x) => x.name === SECOND).part, known: asKnown(known(SECOND)) }]) {
  if (!existsSync(outFile(c.name))) continue;
  const raw = JSON.parse(readFileSync(outFile(c.name), "utf8"));
  const items = Array.isArray(raw.cards) ? raw.cards : [];
  const ctx = { lectureSlides, from: c.part.slide_from, to: c.part.slide_to, figures: new Set(figuresOf(c.part).map((f) => f.id)), known: [...(c.known ?? [])], blocks: blocksOf(c.part) };
  for (const [i, item] of items.entries()) {
    total += 1;
    const parsed = op.CardItem.safeParse(item);
    if (!parsed.success) {
      report.push(`${c.name} #${i + 1}: not the format (${parsed.error.issues[0]?.message ?? "invalid"})`);
      continue;
    }
    const r = op.checkCard(parsed.data, ctx);
    if (!r.ok) {
      report.push(`${c.name} #${i + 1}: REJECTED ${r.reasons.join("; ")} — ${String(item.front).slice(0, 60)}`);
      continue;
    }
    passed += 1;
    if (r.warnings.length) {
      warned += 1;
      report.push(`${c.name} #${i + 1}: warnings ${r.warnings.join("; ")}`);
    }
    ctx.known.push({ id: `n${i}`, ...r.item });
  }
}
for (const line of report) console.log(line);
console.log(`\n${passed} of ${total} cards pass every hard check; ${warned} with warnings. Next: the judge, with the rubric of design-cards §6.4.`);
process.exit(total && passed === total ? 0 : 1);
