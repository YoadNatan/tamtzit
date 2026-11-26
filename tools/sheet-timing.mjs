#!/usr/bin/env node
// The O0 time measurement for uploaded sheets (docs/study/sheets.md, "How
// long a unit takes"), on the synthetic fixture only: no model call, no
// network, $0. It measures how much a reader, a solver and a similar job
// write for e2e/study/fixtures/sheet/sheet6.json (the items as printed, their
// answers, worked solutions and model answers), and turns that into seconds
// at an output speed in tokens a second. The speed is the owner's to measure
// from production's ledger, read only (the query is in sheets.md); until
// then the table shows three speeds.
//
//   node tools/sheet-timing.mjs              the table at 30, 50 and 80 tokens a second
//   node tools/sheet-timing.mjs --tps 42     at the measured speed
//   node tools/sheet-timing.mjs --json       the numbers, for a test
//
// The rule (design-exams.md §8.5): a unit's worst output finishes within 60%
// of the 200 s a unit may run (UNIT_STOP_MS), so 120 s. The worst case is the
// fixture's output doubled (a dense sheet) plus a thinking allowance.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** shared/study/prices.ts's CHARS_PER_TOKEN (the project's one factor), read from the file. */
export function charsPerToken() {
  const m = /export const CHARS_PER_TOKEN = ([0-9.]+);/.exec(readFileSync(join(root, "shared", "study", "prices.ts"), "utf8"));
  if (!m) throw new Error("shared/study/prices.ts has no CHARS_PER_TOKEN");
  return Number(m[1]);
}

/** Hebrew is denser in tokens than English: the conservative factor for a sheet's output (characters a token). */
export const HEBREW_CHARS_PER_TOKEN = 1.5;
export const UNIT_STOP_S = 200;
export const BUDGET_S = 0.6 * UNIT_STOP_S;
/** Thinking per item when solving (design-exams.md §5: 1-2k output tokens a question with thinking). */
export const THINK_PER_ITEM = 1500;
/** Thinking per read unit (copying needs little). */
export const THINK_PER_READ = 1000;
export const SHEET_READ_PAGES = 3;
export const SHEET_SOLVE_ITEMS = 8;

export function loadSheet() {
  return JSON.parse(readFileSync(join(root, "e2e", "study", "fixtures", "sheet", "sheet6.json"), "utf8"));
}

/** What the sheet reader writes for one item (its JSON, as the reply carries it). */
function readOut(it) {
  const { answer, seq, num, num_tol, num_unit, model_answer, rubric, solution, ...copy } = it;
  return JSON.stringify({ ...copy, parse_conf: 3 });
}
/** What the solver writes for one item (answer, worked solution, model answer and rubric). */
function solveOut(it) {
  return JSON.stringify({
    label: it.label, conf: 3, answer: it.answer ?? -1, seq: it.seq ?? [], num: it.num ?? null, unit: it.num_unit ?? "",
    model_answer: it.model_answer ?? "", rubric: it.rubric ?? [], solution: it.solution ?? "פתרון קצר בשני משפטים, בסגנון הקבוצה.",
  });
}

export function measure(sheet = loadSheet()) {
  const pages = sheet.pages.filter((p) => !p.cover).length;
  const readChars = sheet.truth.reduce((s, it) => s + readOut(it).length, 0);
  const solveChars = sheet.truth.reduce((s, it) => s + solveOut(it).length, 0);
  const items = sheet.truth.length;
  const cpt = charsPerToken();
  const tok = (chars, f) => Math.ceil(chars / f);
  const perPage = { project: tok(readChars, cpt) / pages, hebrew: tok(readChars, HEBREW_CHARS_PER_TOKEN) / pages };
  const perItem = { project: tok(solveChars, cpt) / items, hebrew: tok(solveChars, HEBREW_CHARS_PER_TOKEN) / items };
  // Worst: a dense sheet writes twice the fixture, in Hebrew-heavy tokens, plus thinking.
  const readWorst = Math.ceil(2 * perPage.hebrew * SHEET_READ_PAGES + THINK_PER_READ);
  const solveWorstPerItem = Math.ceil(2 * perItem.hebrew + THINK_PER_ITEM);
  return { pages, items, readChars, solveChars, charsPerToken: cpt, perPage, perItem, readWorst, solveWorstPerItem };
}

/** Seconds per unit at a speed, and the most solve items (and read pages) a unit may take under the rule. */
export function timing(tps, m = measure()) {
  const readS = m.readWorst / tps;
  const solveS = (SHEET_SOLVE_ITEMS * m.solveWorstPerItem) / tps;
  const maxItems = Math.max(1, Math.floor((BUDGET_S * tps) / m.solveWorstPerItem));
  const maxPages = Math.max(1, Math.floor((BUDGET_S * tps - THINK_PER_READ) / (2 * m.perPage.hebrew)));
  return { tps, readS: Math.round(readS), solveS: Math.round(solveS), readFits: readS <= BUDGET_S, solveFits: solveS <= BUDGET_S, maxItems, maxPages };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--tps");
  const speeds = at >= 0 ? [Number(args[at + 1])] : [30, 50, 80];
  if (speeds.some((s) => !(s > 0))) {
    console.error("usage: node tools/sheet-timing.mjs [--tps <tokens a second>] [--json]");
    process.exit(2);
  }
  const m = measure();
  const rows = speeds.map((s) => timing(s, m));
  if (args.includes("--json")) {
    console.log(JSON.stringify({ measure: m, rows }, null, 1));
  } else {
    console.log(`fixture: ${m.pages} pages (cover left out), ${m.items} items; read output ${m.readChars} chars, solve output ${m.solveChars} chars`);
    console.log(`per page read: ${m.perPage.project.toFixed(0)} tokens (project factor ${m.charsPerToken}), ${m.perPage.hebrew.toFixed(0)} (Hebrew ${HEBREW_CHARS_PER_TOKEN})`);
    console.log(`per item solved: ${m.perItem.project.toFixed(0)} tokens, ${m.perItem.hebrew.toFixed(0)} (Hebrew); worst with thinking ${m.solveWorstPerItem}`);
    console.log(`worst read unit (${SHEET_READ_PAGES} pages, dense, thinking): ${m.readWorst} tokens; budget ${BUDGET_S} s of ${UNIT_STOP_S} s`);
    console.log("tokens/s | read unit s | fits | solve unit (8) s | fits | most items a solve unit | most pages a read unit");
    for (const r of rows)
      console.log(`${String(r.tps).padStart(8)} | ${String(r.readS).padStart(11)} | ${r.readFits ? " yes" : "  no"} | ${String(r.solveS).padStart(16)} | ${r.solveFits ? " yes" : "  no"} | ${String(r.maxItems).padStart(23)} | ${String(r.maxPages).padStart(22)}`);
  }
}
