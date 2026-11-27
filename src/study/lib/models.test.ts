import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MODEL, MODELS, modelInfo, ROUTE_KEYS } from "../../../shared/study/models";
import { KNOWN_KEYS, MC, ROUTE_NAMES, routeName, usd } from "./modelsCopy";
import { MODELS_HELP, providersLine } from "./helpCopy";
import {
  CANDIDATE,
  differsOf,
  dropDraft,
  loadDraft,
  mergeDraft,
  missingScore,
  RATED_KINDS,
  saveDraft,
  shownOf,
  FIRST_MODELS,
  kindsOf,
  LAB_KINDS,
  month,
  offered,
  preselect,
  projection,
  recommend,
  routable,
  staleDate,
  times,
  tooFew,
  totalOf,
  typicalCall,
  type BoardModel,
} from "./modelsPure";

/* "השוואת מודלים" on the phone (docs/study/models.md): the pure helpers
 * behind the owner's screens (what a new comparison offers, the monthly
 * projection of design-models §6.6, the recommendation's rule of §6.5) and
 * the screens' words (one name a kind, impersonal, no model's name in the
 * kinds' names). */

const row = (model: string, o: Partial<BoardModel> = {}): BoardModel => ({
  model,
  today: model === DEFAULT_MODEL,
  runs: 0,
  answers: 0,
  score: null,
  rated: 0,
  flags: 0,
  ai: null,
  ai_n: 0,
  best: 0,
  shared: 0,
  same_or_better: 0,
  refused: 0,
  truncated: 0,
  failed: 0,
  checked: 0,
  passed: 0,
  items: 0,
  match: 0,
  false_rejects: 0,
  mean_usd: null,
  median_usd: null,
  p50_ms: null,
  ...o,
});

test("every route key has one Hebrew name; the kinds members know come first; the comparison's kinds are named", () => {
  for (const k of ROUTE_KEYS) assert.ok(ROUTE_NAMES[k], `${k} has a name`);
  assert.deepEqual(Object.keys(ROUTE_NAMES).sort(), [...ROUTE_KEYS].sort(), "no name for a key that does not exist");
  assert.equal(new Set(Object.values(ROUTE_NAMES)).size, ROUTE_KEYS.length, "one name a kind, never two kinds with one name");
  for (const k of KNOWN_KEYS) assert.ok((ROUTE_KEYS as readonly string[]).includes(k), k);
  for (const k of LAB_KINDS) assert.ok(ROUTE_NAMES[k], k);
  assert.equal(routeName("solver"), "הבדיקה של השאלות");
  assert.equal(routeName("nothing"), "nothing");
  for (const n of Object.values(ROUTE_NAMES)) assert.doesNotMatch(n, /claude|opus|sonnet|haiku|מעבדה/i, n);
});

test("the screens' words: impersonal, the feature's one name, the owner as COPY.md says", () => {
  const FORBIDDEN = /שלך|טעית|ענית|אליך|יצרת|ביקשת|העלית|פתרת|לחצת|תוכל|תוכלי|דירגת|בחרת|מעבדה/;
  const lines: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") lines.push(v);
    else if (typeof v === "function") lines.push(String((v as (...a: unknown[]) => unknown)("X", "Y", 3, 5, 7)));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(MC);
  assert.ok(lines.length > 100, `${lines.length} lines`);
  for (const l of lines) assert.doesNotMatch(l, FORBIDDEN, l);
  assert.equal(MC.title, "השוואת מודלים");
  assert.equal(MC.ownerRow, "השוואת מודלים");
  assert.equal(MC.todoRow(2), "השוואות לדירוג · 2 מחכות");
  assert.equal(MC.todoRow(1), "השוואות לדירוג · אחת מחכה");
  assert.equal(MC.ready(2, 3), "2 מתוך 3 תשובות מוכנות");
  assert.equal(MC.runButton("$0.04"), "להריץ (עד $0.04)");
});

test("usd(): cents from 10 cents, tenths of a cent below, never a long fraction", () => {
  assert.equal(usd(1.5), "$1.50");
  assert.equal(usd(0.84), "$0.84");
  assert.equal(usd(0.06), "$0.06");
  assert.equal(usd(0.0071), "$0.007");
  assert.equal(usd(0.0004), "פחות מ-$0.001");
  assert.equal(usd(0), "$0");
  assert.equal(usd(null), "$0");
  assert.equal(times(4.27), "4.3");
  assert.equal(times(38.6), "39");
});

test("a new comparison offers Claude's models but Mythos, the newest four first; today's model and the kind's candidate preselected", () => {
  const ids = offered({ providers: {}, keys: null }).map((m) => m.id);
  assert.ok(ids.includes(DEFAULT_MODEL) && ids.includes("claude-haiku-5-5"));
  assert.ok(!ids.some((id) => modelInfo(id)?.verifiedOrgsOnly), "Mythos is listed, never offered");
  assert.ok(ids.every((id) => modelInfo(id)?.provider === "anthropic"), "no other provider without its key and the group's consent");
  for (const id of FIRST_MODELS) assert.ok(ids.includes(id), id);
  assert.deepEqual(preselect("solver", DEFAULT_MODEL), [DEFAULT_MODEL, "claude-haiku-5-5"]);
  assert.deepEqual(preselect("exam_read", DEFAULT_MODEL), [DEFAULT_MODEL, "claude-sonnet-5-5"]);
  assert.deepEqual(preselect("solver", "claude-haiku-5-5"), ["claude-haiku-5-5", DEFAULT_MODEL], "routed to the candidate already: the default beside it");
  for (const k of LAB_KINDS) assert.ok(CANDIDATE[k], k);
  assert.equal(totalOf(["a", "b", "c"], { a: { usd: 0.03 }, b: { usd: 0.001 }, c: { refused: "bad model" } }), 0.031);
  // Another provider shows once its key is set and the group approved it.
  const other = { ...MODELS[0], id: "openai:test-model", provider: "openai" as const, verifiedOrgsOnly: undefined };
  assert.equal(offered({ providers: {}, keys: { openai: true }, models: [other] }).length, 0, "not approved");
  assert.equal(offered({ providers: { openai: { allowed: true, scope: "all" } }, keys: { openai: false }, models: [other] }).length, 0, "no key");
  assert.equal(offered({ providers: { openai: { allowed: true, scope: "all" } }, keys: { openai: true }, models: [other] }).length, 1);
});

test("routable(): verified Claude models for every key; a provider's scope text keeps pictures, members' words and exams", () => {
  const haiku = modelInfo("claude-haiku-5-5")!;
  for (const k of ROUTE_KEYS) assert.equal(routable(k, haiku, { providers: {}, keys: null }), true, k);
  assert.equal(routable("part", modelInfo("claude-mythos-5-2")!, { providers: {}, keys: null }), false);
  const other = { ...haiku, id: "openai:x", provider: "openai" as const };
  const ok = { providers: { openai: { allowed: true, scope: "text" as const } }, keys: { openai: true } };
  assert.equal(routable("points", other, ok), true);
  assert.equal(routable("part", other, ok), false, "pictures");
  assert.equal(routable("ask", other, ok), false, "members' words");
  assert.equal(routable("outline", other, { ...ok, providers: { openai: { allowed: true, scope: "all" } } }), false, "Claude only");
  assert.equal(routable("points", { ...other, verified: false }, ok), false, "an unverified price is never routed");
});

test("a key's month: its ledger kinds; keys that share a kind are marked rough", () => {
  const usage = { solver: { calls: 100, usd: 2.7 }, practice: { calls: 10, usd: 4 }, bank: { calls: 2, usd: 1 }, exam: { calls: 8, usd: 1.6 } };
  assert.deepEqual(month(usage, "solver"), { calls: 100, usd: 2.7, shared: false });
  assert.deepEqual(month(usage, "practice"), { calls: 12, usd: 5, shared: true });
  assert.deepEqual(month(usage, "exam_read"), { calls: 8, usd: 1.6, shared: true });
  assert.deepEqual(month(null, "points"), { calls: 0, usd: 0, shared: false });
  assert.deepEqual(kindsOf("judge").kinds, []);
});

test("projection (§6.6): today30 × the cost ratio, plus refusals rerun and the question check's false rejects; rough without a comparison", () => {
  const usage = { solver: { calls: 100, usd: 2.7 } };
  const board = [
    row(DEFAULT_MODEL, { answers: 10, mean_usd: 0.027, items: 100, match: 92 }),
    row("claude-haiku-5-5", { answers: 10, mean_usd: 0.0007, refused: 1, items: 100, match: 91, false_rejects: 2 }),
  ];
  const p = projection({ key: "solver", model: "claude-haiku-5-5", today: DEFAULT_MODEL, usage, board });
  // 2.70 × 0.0007/0.027 + 0.1 × 100 × 0.027 + 0.02 × 100 × 0.20
  assert.ok(Math.abs(p.usd - (2.7 * (0.0007 / 0.027) + 0.1 * 100 * 0.027 + 0.02 * 100 * 0.2)) < 1e-9, String(p.usd));
  assert.equal(p.rough, false);
  assert.equal(p.base, 2.7);
  assert.deepEqual(projection({ key: "solver", model: DEFAULT_MODEL, today: DEFAULT_MODEL, usage, board }), { usd: 2.7, rough: false, base: 2.7 });
  const rough = projection({ key: "points", model: "claude-sonnet-5-5", today: DEFAULT_MODEL, usage: { points: { calls: 40, usd: 3.72 } } });
  assert.equal(rough.rough, true);
  assert.ok(Math.abs(rough.usd - (3.72 * typicalCall("claude-sonnet-5-5")) / typicalCall(DEFAULT_MODEL)) < 1e-9);
  assert.ok(rough.usd < 3.72 && rough.usd > 1, "Sonnet is about half of Opus");
});

test("recommend (§6.5): an answer-key kind at 20 checked items each, the match within 2 points, no more false rejects, 20% cheaper", () => {
  const usage = { solver: { calls: 100, usd: 2.7 } };
  const opus = row(DEFAULT_MODEL, { runs: 3, answers: 3, mean_usd: 0.027, items: 30, match: 27, false_rejects: 1 });
  const haiku = row("claude-haiku-5-5", { runs: 3, answers: 3, mean_usd: 0.0007, items: 30, match: 27, false_rejects: 1 });
  const r = recommend({ route: "solver", today: DEFAULT_MODEL, models: [opus, haiku], usage });
  assert.ok(r);
  assert.equal(r.model, "claude-haiku-5-5");
  assert.equal(r.keyed, true);
  assert.deepEqual([r.a, r.b, r.n, r.small], [90, 90, 30, true]);
  assert.ok(r.times > 30);
  // Too few items, a match rate 3 points lower, more false rejects: nothing.
  assert.equal(recommend({ route: "solver", today: DEFAULT_MODEL, models: [opus, { ...haiku, items: 19 }], usage }), null);
  assert.equal(recommend({ route: "solver", today: DEFAULT_MODEL, models: [{ ...opus, match: 28 }, { ...haiku, match: 27 }], usage }), null);
  assert.equal(recommend({ route: "solver", today: DEFAULT_MODEL, models: [opus, { ...haiku, false_rejects: 2 }], usage }), null);
  // Not cheaper by 20%: nothing.
  assert.equal(recommend({ route: "solver", today: DEFAULT_MODEL, models: [opus, { ...haiku, mean_usd: 0.025 }], usage }), null);
  assert.equal(tooFew("solver", haiku), false);
  assert.equal(tooFew("solver", { ...haiku, items: 10 }), true);
});

test("recommend (§6.5): a rated kind at 5 shared runs, same or better in 80%, no more flagged errors", () => {
  const usage = { points: { calls: 40, usd: 3.72 } };
  const opus = row(DEFAULT_MODEL, { runs: 6, answers: 6, mean_usd: 0.093, flags: 1 });
  const sonnet = row("claude-sonnet-5-5", { runs: 6, answers: 6, mean_usd: 0.047, shared: 6, same_or_better: 5, flags: 1 });
  const r = recommend({ route: "points", today: DEFAULT_MODEL, models: [opus, sonnet], usage });
  assert.ok(r);
  assert.deepEqual([r.model, r.keyed, r.a, r.b, r.small], ["claude-sonnet-5-5", false, 5, 6, true]);
  assert.equal(recommend({ route: "points", today: DEFAULT_MODEL, models: [opus, { ...sonnet, shared: 4, same_or_better: 4 }], usage }), null, "fewer than 5 shared runs");
  assert.equal(recommend({ route: "points", today: DEFAULT_MODEL, models: [opus, { ...sonnet, same_or_better: 4 }], usage }), null, "4 of 6 is under 80%");
  assert.equal(recommend({ route: "points", today: DEFAULT_MODEL, models: [opus, { ...sonnet, flags: 2 }], usage }), null, "more flagged errors");
  assert.equal(tooFew("points", { ...sonnet, runs: 4 }), true);
});

test("a price checked 45 days ago or more is stale", () => {
  assert.equal(staleDate("2026-11-27", "2026-11-27"), false);
  assert.equal(staleDate("2026-10-13", "2026-11-27"), true);
  assert.equal(staleDate("2026-10-14", "2026-11-27"), false);
});

test("the kinds rated by people (WP8): every comparable kind is either keyed or rated; Sonnet is their candidate; the steps join the price", () => {
  for (const k of LAB_KINDS) assert.ok(RATED_KINDS.has(k) !== ["solver", "fix_check", "exam_read", "sheet_read"].includes(k), k);
  for (const k of ["practice", "set_write", "points", "cards", "ask", "part"]) {
    assert.ok(RATED_KINDS.has(k), k);
    assert.equal(CANDIDATE[k], "claude-sonnet-5-5", k);
    assert.ok(ROUTE_NAMES[k], k);
  }
  const models = { a: { usd: 0.2 }, b: { usd: 0.1 } };
  const steps = { check: 0.01, judge: [0, 0, 0.05, 0.07, 0.09] };
  assert.equal(totalOf(["a", "b"], models).toFixed(3), "0.300");
  assert.equal(totalOf(["a", "b"], models, steps).toFixed(3), "0.320", "practice's check of each answer");
  assert.equal(totalOf(["a", "b"], models, steps, true).toFixed(3), "0.370", "and the AI score of 2 answers");
  assert.deepEqual(differsOf("count, no threads"), ["count", "no threads"]);
  assert.deepEqual(differsOf(""), []);
  for (const d of ["count", "max_tokens", "no threads"]) assert.ok(MC.differsWords[d], d);
});

test("an answer as the app shows it: questions with the right option, points, cards, text", () => {
  const q = shownOf("practice", JSON.stringify({ questions: [{ vignette: "", question: "מה?", options: [{ text: "א", correct: false }, { text: "ב", correct: true }], takeaway: "כי." }] }));
  assert.deepEqual(q, { kind: "questions", items: [{ vignette: "", question: "מה?", options: [{ text: "א", correct: false }, { text: "ב", correct: true }], takeaway: "כי." }] });
  assert.deepEqual(shownOf("points", JSON.stringify({ points: [{ subject: "X", text: "עובדה.", red_flag: true }] })), { kind: "points", items: [{ subject: "X", text: "עובדה.", red: true }] });
  assert.deepEqual(shownOf("cards", JSON.stringify({ cards: [{ front: "X פועל על {{הכליה}}.", back: "" }] })), { kind: "cards", items: [{ front: "X פועל על ___.", back: "הכליה" }] });
  assert.deepEqual(shownOf("ask", "לפי השקפים [ש' 3]."), { kind: "text", text: "לפי השקפים [ש' 3]." });
  assert.equal(shownOf("practice", "not json").kind, "text");
});

test("the rating's draft: kept on the device (private mode too), joined with the server's, the first answer without a score", () => {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  try {
    assert.deepEqual(loadDraft("r1"), { by: {}, best: null });
    saveDraft("r1", { by: { o1: { overall: 4, error: false, note: "", sent: false } }, best: "א" });
    assert.deepEqual(loadDraft("r1"), { by: { o1: { overall: 4, error: false, note: "", sent: false } }, best: "א" });
    const merged = mergeDraft(loadDraft("r1"), [
      { id: "o1", my: { overall: 2, error: true, note: "x" } },
      { id: "o2", my: { overall: 5, error: false, note: "" } },
      { id: "o3", my: null },
    ]);
    assert.equal(merged.by.o1.overall, 4, "an unsent tap on this device wins");
    assert.equal(merged.by.o2.overall, 5);
    assert.equal(merged.by.o2.sent, true);
    assert.equal(missingScore([{ id: "o1", label: "א" }, { id: "o2", label: "ב" }, { id: "o3", label: "ג" }], merged), "ג");
    assert.equal(missingScore([{ id: "o1", label: "א" }, { id: "o2", label: "ב" }], merged), null);
    dropDraft("r1");
    assert.deepEqual(loadDraft("r1"), { by: {}, best: null });
  } finally {
    delete g.localStorage;
  }
  // Private mode: no storage at all, and nothing throws.
  assert.deepEqual(loadDraft("r2"), { by: {}, best: null });
  saveDraft("r2", { by: {}, best: null });
});

test("the rating's words: impersonal, one score of five labels, no model's name", () => {
  const FORBIDDEN = /שלך|טעית|ענית|אליך|יצרת|ביקשת|העלית|פתרת|לחצת|תוכל|תוכלי|דירגת|בחרת|מעבדה/;
  const lines = [
    ...Object.values(MC.rate).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : typeof v === "function" ? [String((v as (x: string) => string)("ב"))] : Object.values(v as Record<string, string>))),
    MC.share, MC.shareText("https://x/?v=models&r=1"), MC.shareNote, MC.checkNote, MC.aiTitle, MC.aiText, MC.yours(4), MC.groupScore("4.1", 4), MC.skippedNote, MC.bestMine("א"), MC.bestSame,
    MODELS_HELP.text,
  ];
  for (const l of lines) {
    assert.doesNotMatch(l, FORBIDDEN, l);
    assert.doesNotMatch(l, /claude|opus|sonnet|haiku/i, l);
  }
  assert.equal(MC.rate.scale.length, 5);
  assert.equal(MC.shareText("L"), "יש השוואה חדשה לדירוג בתמצית (בערך 2 דקות): L");
});

test("help's line on where the material goes (OD21): Anthropic, the routed providers, those approved for comparisons", () => {
  assert.equal(providersLine({ inUse: [], approved: [] }), "החומר של הקבוצה נשלח לכתיבה ל-Anthropic (Claude). אף אחד מהם לא מקבל שמות של חברי הקבוצה.");
  assert.equal(
    providersLine({ inUse: ["openai"], approved: ["openai", "google", "openrouter"] }),
    "החומר של הקבוצה נשלח לכתיבה ל-Anthropic (Claude) ו-OpenAI, ובהשוואת מודלים גם ל-Google ו-OpenRouter. אף אחד מהם לא מקבל שמות של חברי הקבוצה.",
  );
  assert.ok(!providersLine({ inUse: [], approved: ["google"] }).includes("לאן החומר הולך"), "not the privacy note Yoad removed");
});
