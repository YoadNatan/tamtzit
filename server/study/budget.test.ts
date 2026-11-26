import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MODEL } from "../../shared/study/models.js";
import { costUsd, estimateUsd, fallbackUsd, floorUsage, imageTokens, monthlyCap, POLICY, reserve, settle, unsettledCount, type UsageLike } from "./budget.js";
import { HttpError, MODEL, serverKey } from "./study.js";

/* F-4 (spec §7.F): prices, usage.iterations, cache writes by TTL, an unknown
 * model, estimateUsd against the real cost of the summary's calls, how far a
 * server-side fallback can pass a reservation (fallbackUsd), and the
 * reservation RPCs (mapped refusals, a settle that never throws). F-14
 * (§12.2.7): a Message Batches result (service_tier "batch") costs half;
 * estimateUsd's fifth argument { batch: true } halves the estimate; POLICY
 * holds §12.2.4's rows. */

const KEY = "k-0123456789abcdef0123456789abcdef";
process.env.STUDY_WORKER_KEY = KEY;
process.env.STUDY_MONTHLY_USD = "33";

const M = 1_000_000;
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);

test("the summary model's rates: $4 input, $20 output, $5 5-minute write, $8 1-hour write, $0.20 hit", () => {
  near(costUsd({ input_tokens: M }, "claude-opus-5-5"), 4, "input");
  near(costUsd({ output_tokens: M }, "claude-opus-5-5"), 20, "output");
  near(costUsd({ cache_read_input_tokens: M }, "claude-opus-5-5"), 0.2, "hit");
  near(costUsd({ cache_creation_input_tokens: M }, "claude-opus-5-5"), 5, "write, no TTL breakdown");
  near(
    costUsd({ cache_creation_input_tokens: M, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: M } }, "claude-opus-5-5"),
    8,
    "1-hour write",
  );
  // A dated id is the same model.
  near(costUsd({ input_tokens: M, output_tokens: M }, "claude-opus-5-5-20260101"), 24, "dated id");
  near(costUsd({ input_tokens: 1500, cache_read_input_tokens: 13000, output_tokens: 5000 }, "claude-opus-5-5"), 0.1086, "a plain call");
});

test("5-minute and 1-hour cache writes are priced by TTL when usage.cache_creation breaks them down", () => {
  const u: UsageLike = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 30_000,
    cache_creation: { ephemeral_5m_input_tokens: 20_000, ephemeral_1h_input_tokens: 10_000 },
  };
  near(costUsd(u, "claude-opus-5-5"), (20_000 * 5 + 10_000 * 8) / M, "the summary model");
  near(costUsd(u, "claude-sonnet-5-5"), (20_000 * 2.5 + 10_000 * 4) / M, "a cheaper model");
  // Without the breakdown every write counts at the 5-minute rate.
  near(costUsd({ cache_creation_input_tokens: 30_000 }, "claude-opus-5-5"), (30_000 * 5) / M, "no breakdown");
});

test("usage.iterations: every attempt at its own model's rates, the top-level usage ignored", () => {
  const usage: UsageLike = {
    input_tokens: 14600,
    output_tokens: 900,
    iterations: [
      { type: "message", model: "claude-opus-5-5", input_tokens: 1500, output_tokens: 600, cache_read_input_tokens: 13000 },
      { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 14600, output_tokens: 900 },
    ],
  };
  const want = (1500 * 4 + 600 * 20 + 13000 * 0.2) / M + (14600 * 5 + 900 * 25) / M;
  near(costUsd(usage, "claude-opus-4-8"), want, "fallback");
  // An iteration without a model is the serving model's.
  near(costUsd({ iterations: [{ input_tokens: M }] }, "claude-sonnet-4-6"), 3, "iteration without a model");
});

test("every listed model at its rates; an unknown model at the dearest rate a fallback can have", () => {
  const u: UsageLike = { input_tokens: M, output_tokens: M, cache_read_input_tokens: M, cache_creation_input_tokens: M };
  const rates: Array<[string, number]> = [
    ["claude-fable-5-2", 8 + 40 + 0.2 + 10],
    ["claude-mythos-5-2", 8 + 40 + 0.2 + 10],
    ["claude-fable-5-1", 10 + 50 + 0.25 + 12.5],
    ["claude-mythos-5-1", 10 + 50 + 0.25 + 12.5],
    ["claude-opus-5", 5 + 25 + 0.5 + 6.25],
    ["claude-opus-4-8", 5 + 25 + 0.5 + 6.25],
    ["claude-opus-4-5-20251101", 5 + 25 + 0.5 + 6.25],
    ["claude-sonnet-5-5", 2 + 10 + 0.1 + 2.5],
    ["claude-sonnet-4-6", 3 + 15 + 0.3 + 3.75],
    ["claude-fable-5", 10 + 50 + 1 + 12.5],
    ["claude-mythos-5", 10 + 50 + 1 + 12.5],
    ["claude-sonnet-5", 2 + 10 + 0.2 + 2.5],
    ["claude-sonnet-4-5-20250929", 3 + 15 + 0.3 + 3.75],
    ["claude-haiku-4-5", 1 + 5 + 0.1 + 1.25],
    ["claude-haiku-4-5-20251001", 1 + 5 + 0.1 + 1.25],
    // A 3M-token prompt: Haiku 5.5's card above 100k tokens.
    ["claude-haiku-5-5", 0.5 + 2.5 + 0.05 + 0.625],
  ];
  for (const [model, want] of rates) near(costUsd(u, model), want, model);
  const dearest = 10 + 50 + 1 + 12.5;
  for (const model of ["claude-someday-9", "claude-opus-50", "claude-opus-5-5-fast", "claude-haiku-5-5x", ""]) near(costUsd(u, model), dearest, model || "(empty)");
  assert.equal(costUsd(null, "claude-opus-5-5"), 0);
});

test("Haiku 5.5: $0.10 / $0.50 for a prompt of 100k tokens or fewer, $0.50 / $2.50 above (input, writes and hits together)", () => {
  near(costUsd({ input_tokens: 100_000, output_tokens: 1_000 }, "claude-haiku-5-5"), (100_000 * 0.1 + 1_000 * 0.5) / M, "100k exactly: the low card");
  near(costUsd({ input_tokens: 100_001, output_tokens: 1_000 }, "claude-haiku-5-5"), (100_001 * 0.5 + 1_000 * 2.5) / M, "one more: the high card");
  // The whole prompt decides: 40k uncached + 50k hits + 20k written is 110k.
  near(
    costUsd({ input_tokens: 40_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 20_000, output_tokens: 500 }, "claude-haiku-5-5"),
    (40_000 * 0.5 + 50_000 * 0.05 + 20_000 * 0.625 + 500 * 2.5) / M,
    "writes and hits count toward the 100k",
  );
  near(
    costUsd({ input_tokens: 4_000, cache_read_input_tokens: 5_000, output_tokens: 800, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000 } }, "claude-haiku-5-5"),
    (4_000 * 0.1 + 5_000 * 0.01 + 1_000 * 0.2 + 800 * 0.5) / M,
    "a small call at the low card, a 1-hour write at $0.20",
  );
  near(costUsd({ input_tokens: 2_000, output_tokens: 300 }, "claude-haiku-5-5-20261101"), (2_000 * 0.1 + 300 * 0.5) / M, "a dated id");
  // Each attempt of a fallback picks its own card.
  near(
    costUsd({ iterations: [{ model: "claude-haiku-5-5", input_tokens: 1_000, output_tokens: 100 }, { model: "claude-haiku-5-5", input_tokens: 200_000, output_tokens: 100 }] }, "claude-haiku-5-5"),
    (1_000 * 0.1 + 100 * 0.5) / M + (200_000 * 0.5 + 100 * 2.5) / M,
    "per attempt",
  );
  // Its estimate: characters ÷ 1.9 (its tokenizer counts about 30% more tokens), the card for that prompt.
  near(estimateUsd("claude-haiku-5-5", 19_000, 2_000), (10_000 * 0.125 + 2_000 * 0.5) / M, "a short call");
  near(estimateUsd("claude-haiku-5-5", 190_000, 2_000, 5_000), (105_000 * 0.625 + 2_000 * 2.5) / M, "a prompt over 100k tokens");
});

test("Sonnet 5 and Haiku 4.5 are priced as themselves, no longer at the dearest rates", () => {
  near(costUsd({ input_tokens: M, output_tokens: M }, "claude-sonnet-5"), 12, "Sonnet 5: $2 + $10");
  near(costUsd({ cache_read_input_tokens: M }, "claude-sonnet-5"), 0.2, "Sonnet 5's hit: twice Sonnet 5.5's");
  near(costUsd({ input_tokens: M, output_tokens: M }, "claude-haiku-4-5"), 6, "Haiku 4.5: $1 + $5 at any length");
  near(costUsd({ input_tokens: 150_000 }, "claude-haiku-4-5"), 0.15, "no long-prompt card");
  near(estimateUsd("claude-sonnet-5", 25_000, 1_000), (10_000 * 2.5 + 1_000 * 10) / M, "Sonnet 5's estimate at 2.5 characters a token");
});

test("the default model is Opus 5.5, the one study.ts calls", () => {
  assert.equal(DEFAULT_MODEL, "claude-opus-5-5");
  assert.equal(MODEL, DEFAULT_MODEL);
});

test("the monthly cap defaults to $33 when STUDY_MONTHLY_USD is not set", () => {
  const was = process.env.STUDY_MONTHLY_USD;
  try {
    delete process.env.STUDY_MONTHLY_USD;
    assert.equal(monthlyCap(), 33, "not set");
    process.env.STUDY_MONTHLY_USD = "";
    assert.equal(monthlyCap(), 33, "empty");
    process.env.STUDY_MONTHLY_USD = "36";
    assert.equal(monthlyCap(), 36, "set");
  } finally {
    process.env.STUDY_MONTHLY_USD = was;
  }
});

test("estimateUsd: characters ÷ 2.5 plus pictures' tokens as input, all of max_tokens as output", () => {
  near(estimateUsd("claude-opus-5-5", 25_000, 48_000), (10_000 * 5 + 48_000 * 20) / M, "a part");
  near(estimateUsd("claude-opus-5-5", 0, 0, 2614), (2614 * 5) / M, "a picture");
  near(estimateUsd("claude-someday-9", 2_500, 1_000), (1_000 * 12.5 + 1_000 * 50) / M, "an unknown model at the dearest rates");
  assert.equal(imageTokens(1200, 800), 1280);
  assert.equal(imageTokens(0, 0), 2614, "unknown size: the largest picture the app stores (1,400 × 1,400)");
});

test("estimateUsd is never below the real cost of the summary's calls", () => {
  // The calls outline.ts and section.ts make, at the shapes the replays record:
  // input characters and pictures as sent, max_tokens as set, the usage as billed.
  const deck = 38_000;
  const system = 23_400; // SUMMARY_SYSTEM
  const request = 2_500;
  const pictures = 3 * imageTokens(1400, 1050);
  const calls: Array<{ what: string; chars: number; maxTokens: number; pictures?: number; usage: UsageLike; model: string }> = [
    {
      what: "a part read from a warm cache",
      chars: system + deck + request,
      maxTokens: 48_000,
      pictures,
      usage: { input_tokens: 7_400, cache_read_input_tokens: 21_000, cache_creation_input_tokens: 0, output_tokens: 14_500 },
      model: "claude-opus-5-5",
    },
    {
      what: "the first part: it writes the cache and is cut at max_tokens",
      chars: system + deck + request,
      maxTokens: 48_000,
      pictures,
      usage: { input_tokens: 7_400, cache_read_input_tokens: 0, cache_creation_input_tokens: 21_000, output_tokens: 48_000 },
      model: "claude-opus-5-5",
    },
    {
      what: "a part with a mid-stream fallback (two attempts)",
      chars: system + deck + request,
      maxTokens: 48_000,
      pictures,
      usage: {
        input_tokens: 28_400,
        output_tokens: 9_000,
        iterations: [
          { type: "message", model: "claude-opus-5-5", input_tokens: 7_400, cache_read_input_tokens: 21_000, output_tokens: 6_000 },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 28_400, output_tokens: 9_000 },
        ],
      },
      model: "claude-opus-4-8",
    },
    {
      what: "a part stopped at 270 s, settled at its floor",
      chars: system + deck + request,
      maxTokens: 48_000,
      pictures,
      usage: floorUsage({ input_tokens: 7_400, cache_read_input_tokens: 21_000, output_tokens: 1 }, 31_000),
      model: "claude-opus-5-5",
    },
    {
      what: "the outline",
      chars: 40_000 + 600,
      maxTokens: 8_000,
      usage: { input_tokens: 15_500, output_tokens: 2_600, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      model: "claude-opus-5-5",
    },
  ];
  for (const c of calls) {
    const est = estimateUsd("claude-opus-5-5", c.chars, c.maxTokens, c.pictures ?? 0);
    const real = costUsd(c.usage, c.model);
    assert.ok(est >= real, `${c.what}: estimate $${est.toFixed(4)} < real $${real.toFixed(4)}`);
  }
});

test("a server-side fallback can pass a part's reservation, by at most fallbackUsd: one more attempt at the dearest rates", () => {
  // A part as section.ts sends it (the shapes of the test above). The worst a
  // decline can do: the requested model writes all but one token of
  // max_tokens and declines; the model the API picks reads the request and
  // that text, and writes all of max_tokens again. Both attempts are billed.
  const chars = 23_400 + 38_000 + 2_500;
  const pictures = 3 * imageTokens(1400, 1050);
  const maxTokens = 48_000;
  const input = Math.ceil(chars / 2.5) + pictures;
  const reserved = estimateUsd("claude-opus-5-5", chars, maxTokens, pictures);
  const extra = fallbackUsd(chars, maxTokens, pictures);
  const declinedThenFinished = (fallback: string): UsageLike => ({
    iterations: [
      { type: "message", model: "claude-opus-5-5", cache_creation_input_tokens: input, output_tokens: maxTokens - 1 },
      { type: "fallback_message", model: fallback, cache_creation_input_tokens: input + maxTokens - 1, output_tokens: maxTokens },
    ],
  });
  for (const fallback of ["claude-opus-4-8", "claude-opus-5", "claude-sonnet-5-5", "claude-someday-9"]) {
    const real = costUsd(declinedThenFinished(fallback), fallback);
    assert.ok(real > reserved, `${fallback}: one attempt's reservation does not cover two (${real.toFixed(4)})`);
    assert.ok(real <= reserved + extra, `${fallback}: ${real.toFixed(4)} > ${reserved.toFixed(4)} + ${extra.toFixed(4)}`);
  }
  // The README's figures: a part reserves about $1.12, and a fallback can add up to about $3.40.
  near(Math.round(reserved * 100) / 100, 1.12, "a part's reservation");
  near(Math.round(extra * 100) / 100, 3.39, "the most a fallback adds to a part");
  near(fallbackUsd(0, 1_000), (1_000 * 12.5 + 1_000 * 50) / M, "max_tokens of context and of output, at the dearest rates");
});

test('F-14: a Message Batches result (service_tier "batch") costs half of every rate', () => {
  const usage: UsageLike = { input_tokens: 10_000, output_tokens: 5_000, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 30_000 };
  const full = costUsd(usage, "claude-opus-5-5");
  near(full, (10_000 * 4 + 5_000 * 20 + 2_000 * 5 + 30_000 * 0.2) / M, "the standard tier");
  near(costUsd({ ...usage, service_tier: "batch" }, "claude-opus-5-5"), full / 2, "batch");
  near(costUsd({ ...usage, service_tier: "standard" }, "claude-opus-5-5"), full, "standard");
  near(costUsd({ ...usage, service_tier: null }, "claude-opus-5-5"), full, "null (SDK 1.3.0's Usage when the API leaves it out)");
  near(costUsd({ ...usage, service_tier: "priority" }, "claude-opus-5-5"), full, "priority is not discounted here");
  // With a fallback's iterations, every attempt at its own rates, then half.
  const its: UsageLike = {
    service_tier: "batch",
    iterations: [
      { model: "claude-opus-5-5", input_tokens: 1_000, output_tokens: 1_000 },
      { model: "claude-opus-4-8", input_tokens: 2_000, output_tokens: 500 },
    ],
  };
  near(costUsd(its, "claude-opus-5-5"), ((1_000 * 4 + 1_000 * 20) / M + (2_000 * 5 + 500 * 25) / M) / 2, "iterations, batch");
  assert.equal(costUsd(null, "claude-opus-5-5"), 0);
});

test("F-14: estimateUsd(model, chars, maxTokens, 0, { batch: true }) is half; the flag is the fifth argument", () => {
  const full = estimateUsd("claude-opus-5-5", 25_000, 48_000);
  near(estimateUsd("claude-opus-5-5", 25_000, 48_000, 0, { batch: true }), full / 2, "batch");
  near(estimateUsd("claude-opus-5-5", 25_000, 48_000, 0, { batch: false }), full, "batch: false");
  near(estimateUsd("claude-opus-5-5", 25_000, 48_000, 0, {}), full, "no options");
  near(estimateUsd("claude-opus-5-5", 25_000, 48_000, 2614, { batch: true }), estimateUsd("claude-opus-5-5", 25_000, 48_000, 2614) / 2, "with pictures");
  // F0's arguments keep their meaning: the three without a default come first.
  assert.equal(estimateUsd.length, 3);
});

test("F-14: POLICY holds §12.2.4's rows, F0's beside them (mnemonic 5 a day)", () => {
  const md = readFileSync(join(process.cwd(), "docs", "study", "spec", "addendum", "addendum.md"), "utf8");
  const block = md.slice(md.indexOf("// server/study/budget.ts (F0's file; F1Δ's change"), md.indexOf("#### 12.2.5"));
  const rows = [...block.matchAll(/^\s*(?:…F0's rows…, )?([a-z_]+):\s*\{ share: ([\d.]+), memberShare: (null|[\d.]+),\s*daily: (null|\d+) \}/gm)];
  assert.ok(rows.length >= 9, `${rows.length} rows in §12.2.4`);
  for (const [, kind, share, memberShare, daily] of rows) {
    assert.ok(POLICY[kind], `POLICY.${kind}`);
    assert.equal(POLICY[kind].share, Number(share), `${kind}.share`);
    assert.equal(POLICY[kind].memberShare, memberShare === "null" ? null : Number(memberShare), `${kind}.memberShare`);
    assert.equal(POLICY[kind].daily, daily === "null" ? null : Number(daily), `${kind}.daily`);
  }
  assert.deepEqual(
    rows.map((r) => r[1]).sort(),
    ["bank", "fix_check", "mnemonic", "plaque", "solver", "trap_check", "var", "wall_check", "whoami"],
    "the rows §12.2.4 prints",
  );
  // F0's rows stay (§2.4), and every new kind is optional: never the summaries' last 20%.
  for (const kind of ["outline", "part", "notes", "practice", "cards", "exam", "transcribe", "ask", "pdf"]) assert.ok(POLICY[kind], kind);
  for (const kind of ["bank", "solver", "var", "wall_check", "plaque", "fix_check", "trap_check", "whoami"]) assert.equal(POLICY[kind].share, 0.8, kind);
  assert.equal(POLICY.bank.memberShare, null, "the bank's worker has no member");
});

test("floorUsage: a stopped stream counts at least its text, marked estimated", () => {
  assert.deepEqual(floorUsage({ input_tokens: 100, output_tokens: 1 }, 3001), { input_tokens: 100, output_tokens: 1501, estimated: true });
  assert.deepEqual(floorUsage({ output_tokens: 5000 }, 10), { output_tokens: 5000, estimated: true }, "never less than reported");
  assert.deepEqual(floorUsage(null, 0), { estimated: true });
});

type Call = { fn: string; args: Record<string, unknown> };
function fakeSb(answer: (fn: string, args: Record<string, unknown>) => unknown): { sb: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return answer(fn, args);
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

test("reserve: the kind's policy and the server key go to study_reserve; the id comes back", async () => {
  const { sb, calls } = fakeSb(() => ({ data: 77, error: null }));
  const id = await reserve(sb, { groupId: "g", lectureId: "l", kind: "ask", ref: "answer", estimateUsd: 0.04 });
  assert.equal(id, 77);
  assert.deepEqual(calls, [
    {
      fn: "study_reserve",
      args: {
        p_group: "g",
        p_lecture: "l",
        p_kind: "ask",
        p_ref: "answer",
        p_estimate: 0.04,
        p_cap: 33,
        p_share: 0.8,
        p_member_share: 0.4,
        p_daily: 20,
        p_daily_ref: "answer",
        p_key: KEY,
      },
    },
  ]);
  await reserve(sb, { groupId: "g", kind: "part", ref: "3", estimateUsd: 1 });
  assert.equal(calls[1].args.p_share, 1);
  assert.equal(calls[1].args.p_member_share, null);
  assert.equal(calls[1].args.p_lecture, null);
  await reserve(sb, { groupId: "g", kind: "pdf", estimateUsd: 0 });
  assert.equal(calls[2].args.p_cap, 1_000_000, "a $0 kind: only its daily limit applies");
  assert.equal(calls[2].args.p_daily, 10);
  assert.equal(POLICY.notes.share, 0.8);
});

test("reserve maps budget/reserve/member_share to 402, daily_limit to 429, off and forbidden to 403", async () => {
  const cases: Array<[string, number]> = [
    ["budget", 402],
    ["reserve", 402],
    ["member_share", 402],
    ["daily_limit", 429],
    ["off", 403],
    ["forbidden", 403],
    ["something else", 500],
  ];
  for (const [message, status] of cases) {
    const { sb } = fakeSb(() => ({ data: null, error: { message } }));
    await assert.rejects(
      reserve(sb, { groupId: "g", kind: "practice", ref: "b1", estimateUsd: 0.3 }),
      (e: unknown) => e instanceof HttpError && e.status === status && e.message === message,
      message,
    );
  }
});

test("reserve without the server key: 500 before any call", async () => {
  const { sb, calls } = fakeSb(() => ({ data: 1, error: null }));
  delete process.env.STUDY_WORKER_KEY;
  try {
    await assert.rejects(reserve(sb, { groupId: "g", kind: "part", estimateUsd: 1 }), (e: unknown) => e instanceof HttpError && e.status === 500 && e.message === "missing STUDY_WORKER_KEY");
    assert.equal(calls.length, 0);
  } finally {
    process.env.STUDY_WORKER_KEY = KEY;
  }
});

test("the server key is read without the spaces or line break a paste leaves around it", async () => {
  try {
    for (const pasted of [`${KEY}\n`, ` ${KEY} `, `${KEY}\r\n`, `\t${KEY}`]) {
      process.env.STUDY_WORKER_KEY = pasted;
      assert.equal(serverKey(), KEY, JSON.stringify(pasted));
      const { sb, calls } = fakeSb(() => ({ data: 7, error: null }));
      assert.equal(await reserve(sb, { groupId: "g", kind: "part", estimateUsd: 1 }), 7);
      assert.equal(calls[0].args.p_key, KEY, "the RPC gets the key itself, as Vault holds it");
    }
    // Only spaces and line breaks: the key is missing, before any call.
    process.env.STUDY_WORKER_KEY = " \n ";
    assert.throws(() => serverKey(), (e: unknown) => e instanceof HttpError && e.status === 500 && e.message === "missing STUDY_WORKER_KEY");
    const { sb, calls } = fakeSb(() => ({ data: 1, error: null }));
    await assert.rejects(reserve(sb, { groupId: "g", kind: "part", estimateUsd: 1 }), (e: unknown) => e instanceof HttpError && e.status === 500 && e.message === "missing STUDY_WORKER_KEY");
    assert.equal(calls.length, 0);
  } finally {
    process.env.STUDY_WORKER_KEY = KEY;
  }
});

test("settle writes the real cost with the key, and never throws", async () => {
  const usage: UsageLike = { input_tokens: 1200, cache_read_input_tokens: 9000, output_tokens: 900 };
  const ok = fakeSb(() => ({ data: true, error: null }));
  assert.equal(await settle(ok.sb, 41, { model: "claude-opus-5-5", usage }), true);
  assert.deepEqual(ok.calls[0], {
    fn: "study_settle",
    args: { p_id: 41, p_model: "claude-opus-5-5", p_usage: usage, p_cost: costUsd(usage, "claude-opus-5-5"), p_key: KEY },
  });
  const before = unsettledCount();
  const quiet = console.error;
  console.error = () => undefined;
  try {
    assert.equal(await settle(fakeSb(() => ({ data: false, error: null })).sb, 41, { model: "m", usage }), false, "already settled");
    assert.equal(await settle(fakeSb(() => ({ data: null, error: { message: "JWT expired" } })).sb, 41, { model: "m", usage }), false, "an error");
    const throws = fakeSb(() => {
      throw new Error("fetch failed");
    });
    assert.equal(await settle(throws.sb, 41, { model: "m", usage: null }), false, "a thrown error");
    delete process.env.STUDY_WORKER_KEY;
    assert.equal(await settle(ok.sb, 41, { model: "m", usage }), false, "no server key");
  } finally {
    console.error = quiet;
    process.env.STUDY_WORKER_KEY = KEY;
  }
  assert.equal(unsettledCount() - before, 4, "each failed settle is counted");
});
