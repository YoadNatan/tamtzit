import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { ALL_MODELS, modelInfo, OPENROUTER_MODELS, providerOf } from "../../../shared/study/models.js";
import { estimateUsd } from "../../../shared/study/estimate.js";
import { costUsd } from "../budget.js";
import { run, type RunOpts, type Spend } from "../claude.js";
import { labRefusal } from "../lab.js";
import { routeRefusal } from "../routes.js";
import { CHINA_HOSTS, compatBody, finishOfChat, hostsOf, OPENROUTER_URL } from "./compat.js";
import { providerReady } from "./index.js";
import { turnsOf } from "./request.js";
import { setAdapterFetch } from "./stream.js";
import { normalizeChat, settled } from "./usage.js";

/* OpenRouter's adapter, Chat Completions (design-models §7.4, §12.1; WP10;
 * OD22, D4, D16). No network, no paid call: every answer below is a
 * synthetic SSE stream in the shape OpenRouter documents for Chat
 * Completions (choices[].delta, finish_reason, a last chunk with usage and
 * usage.cost, ": OPENROUTER PROCESSING" comments, "[DONE]"), served by a
 * fake fetch. The key is a made-up string, set only in this process. */

const KEY = "sk-or-v1-test-0123456789abcdefFAKE";
process.env.OPENROUTER_API_KEY = KEY;
process.env.VITE_STUDY_SUPABASE_URL = "https://proj.supabase.test";

const PRO = "openrouter:deepseek/deepseek-v4-pro";
const KIMI = "openrouter:moonshotai/kimi-k3";
const QMAX = "openrouter:qwen/qwen4-max-20261115";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

type Call = { url: string; headers: Headers; body: Record<string, any> | null };
type Reply = { status?: number; chunks?: unknown[]; raw?: string; hang?: boolean; json?: unknown };

/** A fake fetch: the study's storage answers pictures; OpenRouter answers `replies` in turn. */
function fake(replies: Reply[]) {
  const calls: Call[] = [];
  const enc = new TextEncoder();
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.startsWith("https://proj.supabase.test/")) return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
    const r = replies.shift() ?? { status: 500, json: { error: { message: "no reply left" } } };
    if (r.status && r.status >= 400) return new Response(JSON.stringify(r.json ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
    const text = r.raw ?? ": OPENROUTER PROCESSING\n\n" + (r.chunks ?? []).map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("");
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < text.length; i += 29) c.enqueue(enc.encode(text.slice(i, i + 29)));
        if (!r.hang) c.close();
        init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  setAdapterFetch(f as typeof globalThis.fetch);
  return calls;
}

const delta = (content: string, more: object = {}) => ({ id: "gen-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content, ...more }, finish_reason: null }] });
const finish = (reason: string) => ({ id: "gen-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "" }, finish_reason: reason, native_finish_reason: reason }] });
const USAGE = { prompt_tokens: 12_000, prompt_tokens_details: { cached_tokens: 8_000 }, completion_tokens: 3_000, completion_tokens_details: { reasoning_tokens: 2_000 }, total_tokens: 15_000, cost: 0.004 };
const usageChunk = (u: object = USAGE) => ({ id: "gen-1", object: "chat.completion.chunk", choices: [], usage: u });

const system: Anthropic.Beta.BetaTextBlockParam[] = [
  { type: "text", text: "You write practice questions." },
  { type: "text", text: "[שקף 5] Fakeomycin: a made-up drug.", cache_control: { type: "ephemeral" } },
];
const user: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: "Write 2 questions on slides 3-9." }];
const client = new Anthropic({ apiKey: "test-anthropic", fetch: (async () => new Response("no", { status: 500 })) as unknown as typeof globalThis.fetch, maxRetries: 0 });

function opts(model: string, more: Partial<RunOpts> = {}): RunOpts & { spends: Spend[]; text: string[] } {
  const spends: Spend[] = [];
  const text: string[] = [];
  return {
    client,
    model,
    kind: "lab",
    ref: "r1",
    system,
    messages: user,
    effort: "high",
    maxTokens: 6000,
    stopAt: Date.now() + 60_000,
    appFallback: false,
    ledger: async (s) => {
      spends.push(s);
    },
    onText: (d) => {
      text.push(d);
    },
    spends,
    text,
    ...more,
  };
}

const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-12, `${what}: ${a} vs ${b}`);

test("the registry's OpenRouter rows: 'openrouter:<slug>', the fee, the reported cost, unverified and dated, never a direct endpoint", () => {
  assert.deepEqual(
    OPENROUTER_MODELS.map((m) => m.id),
    [PRO, "openrouter:deepseek/deepseek-v4-flash", "openrouter:qwen/qwen3.8-2.4t-a95b-20260812", QMAX, KIMI, "openrouter:z-ai/glm-5.3"],
  );
  for (const m of OPENROUTER_MODELS) {
    assert.equal(m.provider, "openrouter", m.id);
    assert.equal(m.id, `openrouter:${m.apiId}`, m.id);
    assert.ok(m.id.length <= 80);
    assert.equal(m.fee, 1.055, `${m.id}: OpenRouter's 5.5% on credits`);
    assert.equal(m.reportsCost, true);
    assert.equal(m.verified, false, `${m.id}: never routed until its price is checked on its page`);
    assert.equal(m.checked, "2026-11-27");
    assert.equal(m.source, `https://openrouter.ai/${m.apiId}`, `${m.id}: the model's own page`);
    assert.equal(m.serverFallback, false);
    assert.equal(providerOf(m.id), "openrouter");
    assert.ok(m.minMaxTokens && m.minMaxTokens >= 4_000 && m.thinkingInMax);
    assert.equal(Boolean(m.host), Boolean(m.china), `${m.id}: a China-only model names who processes it (C43)`);
    for (const r of m.prices) assert.ok(r.hit <= r.in && r.w5m >= r.in, m.id);
  }
  assert.deepEqual(
    ALL_MODELS.filter((m) => m.china).map((m) => [m.id, m.host]),
    [[QMAX, "Alibaba Cloud"]],
  );
  assert.equal(modelInfo(KIMI)!.vision, true);
  assert.equal(modelInfo(PRO)!.vision, false);
  assert.ok(!ALL_MODELS.some((m) => ["deepseek", "dashscope", "moonshot", "zai"].includes(m.provider)), "no direct endpoint is listed (OD22)");
});

test("a reservation holds the fee too (D16); Claude's are unchanged", () => {
  const plain = ((10_000 / 2) * 0.66 * 1.25 + 5_000 * 2.7) / 1e6;
  close(estimateUsd(PRO, 10_000, 5_000), plain * 1.055, "DeepSeek V4 Pro");
  close(estimateUsd("claude-opus-5-5", 10_000, 5_000), ((10_000 / 2.5) * 5 + 5_000 * 20) / 1e6, "Opus, no fee");
});

test("Chat Completions usage in Anthropic's shape: cached and written input out of the input, reasoning in the output", () => {
  const u = normalizeChat(USAGE);
  assert.equal(u.input_tokens, 4_000);
  assert.equal(u.cache_read_input_tokens, 8_000);
  assert.equal(u.cache_creation_input_tokens, 0);
  assert.equal(u.output_tokens, 3_000, "reasoning is a part of completion_tokens");
  assert.equal((u as { provider?: string }).provider, "openrouter");
  const w = normalizeChat({ prompt_tokens: 1_000, prompt_tokens_details: { cached_tokens: 300, cache_write_tokens: 500 }, completion_tokens: 10 });
  assert.deepEqual([w.input_tokens, w.cache_read_input_tokens, w.cache_creation_input_tokens], [200, 300, 500]);
  const odd = normalizeChat({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 900 }, completion_tokens: -5 });
  assert.deepEqual([odd.input_tokens, odd.cache_read_input_tokens, odd.output_tokens], [0, 100, 0], "never negative");
});

test("settling: max(registry, reported) × the fee; the reported cost alone when the stream was cut", () => {
  const m = modelInfo(PRO)!;
  const u = normalizeChat(USAGE);
  const list = costUsd(u, PRO);
  close(settled({ m, usage: u, final: true, chars: 1, opened: true, floorUsd: 1, reportedUsd: 0 }).costUsd, list * 1.055, "registry, the floor not applied to a final count");
  close(settled({ m, usage: u, final: true, chars: 1, opened: true, floorUsd: 1, reportedUsd: list * 3 }).costUsd, list * 3 * 1.055, "reported, when more");
  close(settled({ m, usage: null, final: false, chars: 0, opened: true, floorUsd: 0.01, reportedUsd: 0.5 }).costUsd, 0.5 * 1.055, "a reported cost above the reservation");
  assert.equal(settled({ m, usage: null, final: false, chars: 0, opened: false, floorUsd: 0.3 }).costUsd, 0, "refused before the stream: $0");
});

test("the request: OD22's provider preferences on every request, the China-only model without the exclusion, include_usage, reasoning hidden", async () => {
  const calls = fake([{ chunks: [delta("x"), finish("stop"), usageChunk(), "[DONE]"] }]);
  await run(opts(PRO, { effort: "medium" }));
  const sent = calls.find((c) => c.url === OPENROUTER_URL)!;
  const b = sent.body!;
  assert.equal(b.model, "deepseek/deepseek-v4-pro");
  assert.equal(b.stream, true);
  assert.deepEqual(b.stream_options, { include_usage: true }, "without it a stream reports no usage (D4)");
  assert.deepEqual(b.usage, { include: true });
  assert.deepEqual(b.provider, { data_collection: "deny", zdr: true, ignore: [...CHINA_HOSTS] });
  assert.ok(CHINA_HOSTS.includes("deepseek") && CHINA_HOSTS.includes("alibaba") && CHINA_HOSTS.includes("moonshotai") && CHINA_HOSTS.includes("z-ai"), "each maker's own endpoint is left out");
  assert.deepEqual(b.reasoning, { effort: "medium", exclude: true });
  assert.equal(b.max_tokens, 6_000);
  assert.deepEqual(b.messages, [
    { role: "system", content: "You write practice questions.\n\n[שקף 5] Fakeomycin: a made-up drug." },
    { role: "user", content: "Write 2 questions on slides 3-9." },
  ]);
  assert.equal(sent.headers.get("authorization"), `Bearer ${KEY}`);
  assert.ok(!sent.url.includes(KEY) && !JSON.stringify(b).includes(KEY), "the key is in the header only");
  assert.equal(sent.headers.get("http-referer"), null, "no attribution headers: nothing names the app");
  assert.equal(sent.headers.get("x-title"), null);
  // Qwen's own closed model: only its maker serves it; still zero retention and no data collection.
  assert.deepEqual(hostsOf(modelInfo(QMAX)!), { data_collection: "deny", zdr: true });
  for (const m of OPENROUTER_MODELS) {
    const p = hostsOf(m) as { data_collection: string; zdr: boolean; ignore?: string[] };
    assert.equal(p.data_collection, "deny", m.id);
    assert.equal(p.zdr, true, m.id);
    assert.equal(Boolean(p.ignore), !m.china, m.id);
  }
});

test("the request: pictures as data URLs (never a link), a JSON schema strict and in the system text, a model without vision fails before sending", async () => {
  const kimi = modelInfo(KIMI)!;
  const msgs: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: [{ type: "text", text: "מה בשקף?" }, { type: "image", source: { type: "url", url: "https://proj.supabase.test/storage/v1/object/sign/study/a.jpg?token=t" } }] },
    { role: "assistant", content: "קודם" },
  ];
  const fetchPic = (async () => new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
  const turns = await turnsOf(msgs, { fetch: fetchPic, signal: new AbortController().signal });
  const schema = { $schema: "x", type: "object", properties: { q: { type: "string" } }, required: ["q"] };
  const b = compatBody({ system, effort: "low", maxTokens: 100, format: { type: "json_schema", schema } }, kimi, turns);
  const m = b.messages as Array<{ role: string; content: any }>;
  assert.equal(m[1].content[1].type, "image_url");
  assert.equal(m[1].content[1].image_url.url, `data:image/jpeg;base64,${btoa(String.fromCharCode(...JPEG))}`);
  assert.deepEqual(m[2], { role: "assistant", content: "קודם" });
  assert.ok(!JSON.stringify(b).includes("supabase"), "no storage link goes to the provider");
  assert.equal(b.max_tokens, 4_000, "thinking shares the cap: at least 4,000");
  const rf = b.response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } };
  assert.equal(rf.type, "json_schema");
  assert.equal(rf.json_schema.strict, true);
  assert.equal(rf.json_schema.schema.$schema, undefined);
  assert.equal(rf.json_schema.schema.additionalProperties, false);
  assert.ok(String(m[0].content).endsWith(`matching this JSON schema:\n${JSON.stringify({ type: "object", properties: { q: { type: "string" } }, required: ["q"] })}`), "a host may ignore response_format");
  // A model that cannot read pictures: nothing is sent, $0.
  const calls = fake([]);
  const o = opts(PRO, { messages: msgs, reservedUsd: 0.4 });
  await assert.rejects(run(o), /no vision/);
  assert.equal(calls.filter((c) => c.url === OPENROUTER_URL).length, 0);
  assert.equal(o.spends[0].costUsd, 0);
});

test("the stream: text as it comes (comments, reasoning and [DONE] skipped), one settle at max(registry, reported) × 1.055", async () => {
  fake([{ chunks: [delta("", { reasoning: "חושב…" }), delta("שלום "), delta("עולם"), finish("stop"), usageChunk(), "[DONE]"] }]);
  const o = opts(PRO);
  let started = 0;
  const r = await run({ ...o, onStart: () => (started += 1) });
  assert.equal(o.text.join(""), "שלום עולם");
  assert.equal(started, 1);
  assert.deepEqual({ stop: r.stop, model: r.model, estimated: r.estimated, chars: r.chars }, { stop: "end_turn", model: PRO, estimated: false, chars: 9 });
  assert.equal(o.spends.length, 1);
  const list = costUsd(normalizeChat(USAGE), PRO);
  assert.ok(list > USAGE.cost, "the registry's high figure is more than this cost");
  close(o.spends[0].costUsd, list * 1.055, "the registry, × the fee");
  assert.equal((o.spends[0].usage as { provider?: string }).provider, "openrouter");
  // A host dearer than the registry: OpenRouter's own figure, × the fee.
  fake([{ chunks: [delta("a"), finish("stop"), usageChunk({ ...USAGE, cost: 0.2 }), "[DONE]"] }]);
  const d = opts(PRO);
  await run(d);
  close(d.spends[0].costUsd, 0.2 * 1.055, "reported, × the fee");
});

test("the ends: length is a cut answer; content_filter and a refusal are refusals; an error inside the stream fails", async () => {
  fake([{ chunks: [delta("חצי"), finish("length"), usageChunk()] }]);
  assert.equal((await run(opts(PRO))).stop, "max_tokens");
  fake([{ chunks: [finish("content_filter"), usageChunk()] }]);
  assert.equal((await run(opts(PRO))).stop, "refusal");
  fake([{ chunks: [delta("", { refusal: "I can't help" }), finish("stop"), usageChunk()] }]);
  const r = await run(opts(PRO));
  assert.equal(r.stop, "refusal");
  assert.equal(r.chars, 0);
  fake([{ chunks: [delta("abc"), { error: { code: 502, message: "Provider returned error" }, choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }] }] }]);
  const e = opts(PRO, { reservedUsd: 0.3 });
  await assert.rejects(run(e), /openrouter: Provider returned error/);
  assert.equal(e.spends[0].costUsd, 0.3, "begun and cut before its usage: the reservation (D4)");
  assert.equal(finishOfChat("stop"), "end_turn");
  assert.equal(finishOfChat("tool_calls"), "end_turn");
});

test("D4: an abort, or a finish without the usage chunk, settles at no less than the reservation", async () => {
  fake([{ chunks: [delta("מתחיל")], hang: true }]);
  const ctl = new AbortController();
  const o = opts(KIMI, { reservedUsd: 0.42, signal: ctl.signal, onText: () => ctl.abort() });
  const r = await run(o);
  assert.equal(r.stop, "aborted");
  assert.equal(o.spends[0].costUsd, 0.42);
  assert.equal(o.spends[0].estimated, true);
  fake([{ chunks: [delta("גמור"), finish("stop"), "[DONE]"] }]);
  const n = opts(PRO, { reservedUsd: 0.25 });
  const rn = await run(n);
  assert.equal(rn.stop, "end_turn");
  assert.equal(n.spends[0].costUsd, 0.25, "no usage came: not ≈ $0");
  assert.equal(n.spends[0].estimated, true);
});

test("errors before the stream cost $0 and never hold the key: no ZDR host (404), a bad key (401)", async () => {
  fake([{ status: 404, json: { error: { code: 404, message: "No endpoints found matching your data policy (Zero data retention)" } } }]);
  const o = opts(QMAX, { reservedUsd: 0.5 });
  await assert.rejects(run(o), /openrouter 404: No endpoints found/);
  assert.equal(o.spends[0].costUsd, 0);
  fake([{ status: 401, json: { error: { code: 401, message: `Invalid key ${KEY}` } } }]);
  const err = await run(opts(PRO)).then(
    () => null,
    (e: unknown) => e as Error,
  );
  assert.ok(err && /openrouter 401/.test(err.message));
  assert.ok(!err!.message.includes(KEY), "scrubbed");
});

test("readiness and gates: the key and the adapter make it ready; comparisons need the group's approval and its scope; production needs a verified price", () => {
  assert.equal(providerReady("openrouter"), true);
  assert.equal(providerReady("openrouter", {}), false);
  const ready = () => true;
  const providers = { openrouter: { allowed: true, scope: "all" as const } };
  assert.equal(labRefusal(PRO, "points", { providers, pictures: false, ready }), null);
  assert.equal(labRefusal(PRO, "practice", { providers, pictures: true, ready }), "no vision");
  assert.equal(labRefusal(KIMI, "practice", { providers, pictures: true, ready }), null);
  assert.equal(labRefusal(KIMI, "practice", { providers: { openrouter: { allowed: true, scope: "text" } }, pictures: true, ready }), "not for this kind");
  assert.equal(labRefusal(PRO, "points", { providers: {}, pictures: false, ready }), "not allowed");
  assert.equal(labRefusal(PRO, "points", { providers, pictures: false, ready: () => false }), "not configured");
  assert.equal(routeRefusal(PRO, "points", { providers, ready }), "unverified price");
});

test.after(() => setAdapterFetch(null));
