import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hasText } from "./failText";
import { MODELS_FAIL, MODELS_FAIL_CODES, modelsFail } from "./modelsCopy";

/* "השוואת מודלים": section Y's refusals in words (design-models §6.2, §8.2):
 * every code section Y raises has words here or in failText, or is the
 * server's own; impersonal, no model's name in a refusal. */

const FORBIDDEN = /שלך|טעית|ענית|אליך|יצרת|ביקשת|העלית|פתרת|לחצת|תוכל|תוכלי|דירגת|בחרת/;
const MODELS = /claude|opus|sonnet|haiku|gpt|gemini|deepseek|qwen|kimi|glm|openai|anthropic/i;
/** The server's own (the worker and the op send them, a screen never meets them). */
const SERVER_ONLY = new Set(["bad status"]);

test("every code section Y raises has words", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  const y = sql.slice(sql.indexOf("-- ════ BEGIN SECTION Y "), sql.indexOf("-- ════ END SECTION Y ════"));
  const codes = new Set([...y.matchAll(/raise exception '([^'%]+)'/g)].map((m) => m[1]));
  assert.ok(codes.size >= 15, `${codes.size} codes`);
  for (const c of codes) assert.ok(MODELS_FAIL_CODES.includes(c) || hasText(c) || SERVER_ONLY.has(c), `${c} has words`);
  for (const c of ["bad slots", "run_cap", "daily_runs", "lab_budget", "closed", "not waiting", "not rated here", "seen", "not done", "not rated"]) {
    assert.ok(codes.has(c), `section Y raises ${c}`);
    assert.ok(MODELS_FAIL_CODES.includes(c), `${c} is worded here`);
  }
});

test("the words: impersonal, no model's name; the rest falls through to failText", () => {
  for (const [code, line] of Object.entries(MODELS_FAIL)) {
    assert.doesNotMatch(line, FORBIDDEN, code);
    assert.doesNotMatch(line, MODELS, code);
    assert.ok(line.endsWith("."), code);
  }
  assert.equal(modelsFail("lab_budget"), "התקציב להשוואות החודש נגמר. אפשר שוב מה-1 בחודש.");
  assert.equal(modelsFail("off"), "השוואות כבויות כרגע.");
  assert.equal(modelsFail("not the creator"), "רק מי שפתחו את הקבוצה יכולים לעשות את זה.");
});

test("the server's route refusals (routes.ts's routeRefusal) have words", () => {
  const src = readFileSync(join(process.cwd(), "server", "study", "routes.ts"), "utf8");
  const type = /export type RouteRefusal = ([^;]+);/.exec(src)?.[1] ?? "";
  const codes = [...type.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 8, codes.join(", "));
  for (const c of codes) assert.ok(MODELS_FAIL_CODES.includes(c), `${c} is worded here`);
});
