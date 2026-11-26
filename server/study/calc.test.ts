import assert from "node:assert/strict";
import { test } from "node:test";
import { CALC_MAX_TOKENS, evaluate, recompute, tokens, within } from "./calc.js";

/* The numeric answers' calculator (server/study/calc.ts; design-exams D17):
 * a model's working is recomputed here, never run as code. */

test("calc: numbers, names, precedence, the right-associative power, a unary minus", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("2 ^ 3 ^ 2"), 512);
  assert.equal(evaluate("-2 ^ 2"), -4);
  assert.equal(evaluate("2 ^ -1"), 0.5);
  assert.equal(evaluate("1.2e-3 * 1000"), 1.2);
  assert.equal(evaluate(".5 + .5"), 1);
  assert.equal(evaluate("dose / vd", { dose: 500, vd: 40 }), 12.5);
  assert.equal(evaluate("vd × target", { vd: 40, target: 5 }), 200, "× is *");
  assert.equal(evaluate("10 − 4 ÷ 2"), 8, "− and ÷ as printed");
});

test("calc: ln, log10, exp, sqrt, abs, min, max", () => {
  assert.ok(Math.abs((evaluate("ln(2) / k", { k: 0.231 }) ?? 0) - 3.0006) < 1e-3);
  assert.equal(evaluate("log10(1000)"), 3);
  assert.equal(evaluate("exp(0)"), 1);
  assert.equal(evaluate("sqrt(16) + abs(-2)"), 6);
  assert.equal(evaluate("min(3, 1, 2) + max(4, 9)"), 10);
});

test("calc: anything else is refused (null), never run", () => {
  for (const bad of [
    "",
    "1 +",
    "(1 + 2",
    "1 + 2)",
    "foo(1)",
    "constructor",
    "x.y",
    "a[0]",
    "process.exit(1)",
    "1; 2",
    "'1'",
    "sqrt()",
    "sqrt(1, 2)",
    "unknown + 1",
    "1 / 0",
    "ln(-1)",
    "2 2",
  ]) {
    assert.equal(evaluate(bad, { a: 1, x: 1 }), null, bad);
  }
  assert.equal(tokens("1 + " + "1 + ".repeat(CALC_MAX_TOKENS)), null, "at most 200 tokens");
  assert.equal(evaluate("toString", {}), null, "no property of an object, by any name");
  assert.equal(evaluate("__proto__", {}), null);
});

test("within: a tolerance in percent of the answer; an answer of 0 only by 0", () => {
  assert.ok(within(12.6, 12.5, 1));
  assert.ok(!within(13, 12.5, 1));
  assert.ok(within(-3.01, -3, 1));
  assert.ok(within(0, 0, 1));
  assert.ok(!within(0.001, 0, 1));
  assert.ok(!within(Number.NaN, 1, 1));
});

test("recompute: the model's number kept only when its working gives it (at least 0.5%: rounding is not a mismatch)", () => {
  assert.deepEqual(recompute(200, { inputs: [{ name: "vd", value: 40 }, { name: "target", value: 5 }], formula: "vd * target" }), { ok: true, value: 200 });
  assert.equal(recompute(3, { inputs: [{ name: "t", value: 6 }, { name: "n", value: 2 }], formula: "t / n" }).ok, true);
  assert.equal(recompute(3.01, { inputs: { t: 6, n: 2 }, formula: "t / n" }).ok, true, "within 0.5%");
  assert.equal(recompute(4, { inputs: { t: 6, n: 2 }, formula: "t / n" }).ok, false, "the working gives 3");
  assert.equal(recompute(3, { inputs: [{ name: "bad name", value: 6 }], formula: "6 / 2" }).ok, true, "a bad name is left out, the formula still computes");
  assert.deepEqual(recompute(3, { inputs: [], formula: "" }), { ok: false, value: null }, "no working: not checked");
});
