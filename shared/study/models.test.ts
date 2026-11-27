import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MODEL, labelOf, modelInfo, MODELS, priceOf, priceRowOn, providerOf, ROUTE_KEYS, ROUTE_RULES, scopeAllows, type ModelInfo } from "./models.js";
import { ANTHROPIC_PRICES, anthropicId, CHARS_PER_TOKEN, priceOf as phonePriceOf, rateOf, UNKNOWN_PRICE } from "./prices.js";

/* The model registry and the phone's price rows (design-models §7.2, §12.1;
 * WP1). Prices as Anthropic's model notes give them, checked 2026-11-26. */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

test("every row is complete, ids unique and namespaced, the default listed and verified", () => {
  const ids = MODELS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "unique ids");
  for (const m of MODELS) {
    if (m.provider === "anthropic") assert.match(m.id, /^claude-[a-z]+-\d+(-\d+)?$/, `${m.id}: Anthropic ids stay bare`);
    else assert.ok(m.id.startsWith(`${m.provider}:`) && m.id.length <= 80, `${m.id}: "<provider>:<model>", at most 80 characters`);
    assert.ok(m.apiId && m.label && m.source.startsWith("https://"), `${m.id}: apiId, label, source`);
    assert.match(m.checked, DAY, `${m.id}: checked`);
    assert.ok(m.prices.length >= 1, `${m.id}: a price row`);
    for (const r of m.prices) for (const k of ["in", "out", "w5m", "w1h", "hit"] as const) assert.ok(r[k] > 0 && Number.isFinite(r[k]), `${m.id}.${k}`);
    assert.ok(m.maxOut > 0 && m.charsPerToken > 0, `${m.id}: maxOut, charsPerToken`);
    assert.ok(["top", "mid", "small"].includes(m.tier), `${m.id}: tier`);
  }
  const def = modelInfo(DEFAULT_MODEL);
  assert.ok(def && def.verified && def.provider === "anthropic" && !def.expensive, "the default is listed, verified, Anthropic's");
  // Every current Claude API model (Anthropic's model list, checked 2026-11-27).
  assert.deepEqual(
    ids,
    [
      "claude-fable-5-2", "claude-mythos-5-2", "claude-fable-5-1", "claude-mythos-5-1", "claude-fable-5", "claude-mythos-5",
      "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
      "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-5-5", "claude-haiku-4-5",
    ],
    "Claude only, every current model",
  );
  for (const m of MODELS) assert.ok(m.context >= 200_000 && m.maxOut <= 128_000, `${m.id}: context, maxOut`);
});

test("dated rows are in order: the first has no date, each later one starts after the one before", () => {
  for (const m of MODELS) {
    assert.equal(m.prices[0].from, undefined, `${m.id}: the first row is in force from the start`);
    for (let i = 1; i < m.prices.length; i++) {
      const from = m.prices[i].from;
      assert.ok(from && DAY.test(from), `${m.id}: row ${i} has a date`);
      assert.ok(i === 1 || from > (m.prices[i - 1].from ?? ""), `${m.id}: row ${i} after row ${i - 1}`);
    }
  }
  // The switch on a date, on a made-up row pair (no listed model has one yet).
  const promo: ModelInfo = { ...modelInfo(DEFAULT_MODEL)!, id: "claude-test-1", prices: [{ in: 1, out: 2, w5m: 1.25, w1h: 2, hit: 0.1 }, { from: "2027-01-01", in: 3, out: 6, w5m: 3.75, w1h: 6, hit: 0.3 }] };
  assert.equal(priceRowOn(promo, "2026-12-31").in, 1);
  assert.equal(priceRowOn(promo, "2027-01-01").in, 3);
  assert.equal(priceRowOn(promo, "2027-06-01").in, 3);
});

test("the registry's Claude rows are prices.ts's rows (one place)", () => {
  for (const m of MODELS.filter((x) => x.provider === "anthropic")) {
    assert.equal(m.prices.length, 1, m.id);
    assert.equal(m.prices[0], ANTHROPIC_PRICES[m.id], m.id);
    assert.deepEqual(priceOf(m.id), phonePriceOf(m.id), m.id);
  }
});

test("the prices as checked: Fable 5.2 $8/$40, Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 up to 100k", () => {
  assert.deepEqual(priceOf("claude-fable-5-2"), { in: 8, out: 40, w5m: 10, w1h: 16, hit: 0.2 });
  assert.deepEqual(priceOf("claude-opus-5-5"), { in: 4, out: 20, w5m: 5, w1h: 8, hit: 0.2 });
  assert.deepEqual(priceOf("claude-sonnet-5-5"), { in: 2, out: 10, w5m: 2.5, w1h: 4, hit: 0.1 });
  assert.deepEqual(priceOf("claude-haiku-5-5"), { in: 0.1, out: 0.5, w5m: 0.125, w1h: 0.2, hit: 0.01 });
  assert.deepEqual(priceOf("claude-haiku-5-5", 100_000), { in: 0.1, out: 0.5, w5m: 0.125, w1h: 0.2, hit: 0.01 }, "100k exactly");
  assert.deepEqual(priceOf("claude-haiku-5-5", 100_001), { in: 0.5, out: 2.5, w5m: 0.625, w1h: 1, hit: 0.05 }, "above 100k");
  // Pricing only (a fallback's, or an older id in the ledger).
  assert.deepEqual(priceOf("claude-sonnet-5"), { in: 2, out: 10, w5m: 2.5, w1h: 4, hit: 0.2 });
  assert.deepEqual(priceOf("claude-haiku-4-5"), { in: 1, out: 5, w5m: 1.25, w1h: 2, hit: 0.1 });
  assert.deepEqual(priceOf("claude-haiku-4-5", 150_000), { in: 1, out: 5, w5m: 1.25, w1h: 2, hit: 0.1 }, "one card at any length");
  assert.deepEqual(priceOf("claude-opus-5"), { in: 5, out: 25, w5m: 6.25, w1h: 10, hit: 0.5 });
  assert.deepEqual(priceOf("claude-mythos-5-1"), { in: 10, out: 50, w5m: 12.5, w1h: 20, hit: 0.25 });
  // Every row: writes at 1.25 × and 2 × input; hits at 0.1 × except where the notes say otherwise.
  const hit: Record<string, number> = { "claude-fable-5-2": 0.025, "claude-mythos-5-2": 0.025, "claude-fable-5-1": 0.025, "claude-mythos-5-1": 0.025, "claude-fable-5": 0.1, "claude-mythos-5": 0.1, "claude-opus-5-5": 0.05, "claude-sonnet-5-5": 0.05 };
  const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-12, `${what}: ${a} vs ${b}`);
  for (const [id, row] of Object.entries(ANTHROPIC_PRICES)) {
    for (const p of row.upTo ? [rateOf(row), row.upTo.then] : [rateOf(row)]) {
      close(p.w5m, p.in * 1.25, `${id} 5-minute write`);
      close(p.w1h, p.in * 2, `${id} 1-hour write`);
      close(p.hit, p.in * (hit[id] ?? 0.1), `${id} hit`);
    }
  }
});

test("ids: a dated id is its model; anything else is unknown, at the dearest rates", () => {
  assert.equal(anthropicId("claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(anthropicId("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
  assert.equal(anthropicId("claude-opus-5-5-fast"), null, "fast mode is billed at twice the rate: never under-count it");
  assert.equal(anthropicId("claude-opus-5-5-2026"), null);
  assert.equal(anthropicId("toString"), null, "not a property of every object");
  assert.equal(anthropicId(null), null);
  for (const m of ["claude-someday-9", "openai:gpt-x", "", null, undefined]) assert.deepEqual(priceOf(m), UNKNOWN_PRICE, String(m));
  assert.deepEqual(UNKNOWN_PRICE, { in: 10, out: 50, w5m: 12.5, w1h: 20, hit: 1 });
  assert.equal(modelInfo("claude-opus-5-5-20260101")?.id, "claude-opus-5-5");
  assert.equal(modelInfo("claude-sonnet-5")?.id, "claude-sonnet-5");
  assert.equal(modelInfo("claude-sonnet-4-5"), null, "pricing only (deprecated), not a model to route to");
  assert.deepEqual(priceOf("claude-sonnet-4-5"), { in: 3, out: 15, w5m: 3.75, w1h: 6, hit: 0.3 });
  assert.equal(CHARS_PER_TOKEN, 2.5);
});

test("labels and providers", () => {
  assert.equal(labelOf("claude-haiku-5-5"), "Claude Haiku 5.5");
  assert.equal(labelOf("claude-sonnet-5"), "Claude Sonnet 5");
  assert.equal(labelOf("claude-opus-4-5"), "claude-opus-4-5", "an unlisted id is its own label");
  assert.equal(providerOf("claude-opus-5-5"), "anthropic");
  assert.equal(providerOf("claude-haiku-4-5-20251001"), "anthropic");
  assert.equal(providerOf("openai:gpt-x"), "openai");
  assert.equal(providerOf("openrouter:qwen/qwen-x"), "openrouter");
  assert.equal(providerOf("acme:model"), null);
  assert.equal(providerOf("claude-someday-9"), null);
});

test("Haiku 5.5's capabilities: no server-side fallback, thinking inside max_tokens, at least 2,000 of it", () => {
  const h = modelInfo("claude-haiku-5-5")!;
  assert.equal(h.serverFallback, false);
  assert.equal(h.thinkingInMax, true);
  assert.equal(h.minMaxTokens, 2_000);
  assert.equal(h.charsPerToken, 1.9);
  assert.equal(modelInfo("claude-fable-5-2")!.expensive, true);
  for (const id of ["claude-opus-5-5", "claude-sonnet-5-5"]) assert.equal(modelInfo(id)!.serverFallback, true, id);
});

test("every current Claude model's prices, capabilities and limits as Anthropic's notes give them", () => {
  const io = (id: string) => [priceOf(id).in, priceOf(id).out];
  assert.deepEqual(io("claude-mythos-5-2"), [8, 40]);
  assert.deepEqual(io("claude-fable-5-1"), [10, 50]);
  assert.deepEqual(io("claude-fable-5"), [10, 50]);
  assert.equal(priceOf("claude-fable-5").hit, 1);
  assert.equal(priceOf("claude-mythos-5").hit, 1);
  for (const id of ["claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6"]) assert.deepEqual(io(id), [5, 25], id);
  assert.deepEqual(io("claude-sonnet-5"), [2, 10]);
  assert.deepEqual(io("claude-sonnet-4-6"), [3, 15]);
  assert.deepEqual(io("claude-haiku-4-5"), [1, 5]);
  // Server-side fallback: Fable and Mythos 5.2 and 5.1, Opus 5.5 and 5, Sonnet 5.5 only.
  const fallback = MODELS.filter((m) => m.serverFallback).map((m) => m.id);
  assert.deepEqual(fallback, ["claude-fable-5-2", "claude-mythos-5-2", "claude-fable-5-1", "claude-mythos-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
  // Mythos: verified organizations only; never the default.
  assert.deepEqual(MODELS.filter((m) => m.verifiedOrgsOnly).map((m) => m.id), ["claude-mythos-5-2", "claude-mythos-5-1", "claude-mythos-5"]);
  // Twice the default's price or more: a production route needs a second confirmation (OD14).
  assert.deepEqual(MODELS.filter((m) => m.expensive).map((m) => m.id), ["claude-fable-5-2", "claude-mythos-5-2", "claude-fable-5-1", "claude-mythos-5-1", "claude-fable-5", "claude-mythos-5"]);
  for (const m of MODELS.filter((x) => x.expensive)) assert.ok(priceOf(m.id).out >= 2 * priceOf(DEFAULT_MODEL).out, m.id);
  const h45 = modelInfo("claude-haiku-4-5")!;
  assert.equal(h45.context, 200_000);
  assert.equal(h45.maxOut, 64_000);
  assert.equal(h45.effort, null, "no effort control");
  assert.equal(modelInfo("claude-opus-4-6")!.effort !== null, true);
});

test("route keys: every key has its rules", () => {
  assert.equal(new Set(ROUTE_KEYS).size, ROUTE_KEYS.length);
  for (const k of ROUTE_KEYS) assert.match(k, /^[a-z][a-z_]{1,23}$/, k);
  assert.deepEqual(Object.keys(ROUTE_RULES).sort(), [...ROUTE_KEYS].sort());
  // Uploaded sheets and similar questions (section O) and the practice-set generator have keys of their own.
  for (const k of ["sheet_read", "sheet_key", "sheet_solve", "similar", "set_write"] as const) assert.ok(ROUTE_KEYS.includes(k), k);
  // The outline and the ask route are not made through run() (D5).
  assert.deepEqual(ROUTE_KEYS.filter((k) => ROUTE_RULES[k].anthropicOnly), ["outline", "ask_route"]);
  // Scope "text" takes only keys without pictures, members' wording, or exam and sheet pages; "all" takes every key.
  assert.deepEqual(ROUTE_KEYS.filter((k) => scopeAllows("text", k)), ["outline", "notes", "points", "cards", "judge"]);
  assert.ok(ROUTE_KEYS.every((k) => scopeAllows("all", k)));
});
