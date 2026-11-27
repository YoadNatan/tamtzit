import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { modelInfo } from "../../../shared/study/models.js";
import { costUsd } from "../budget.js";
import { generateItems, run, type RunOpts, type Spend } from "../claude.js";
import { geminiBody, GEMINI_BASE } from "./gemini.js";
import { providerReady, providersConfigured } from "./index.js";
import { openaiBody, OPENAI_URL, strictSchema } from "./openai.js";
import { maxTokensFor, turnsOf } from "./request.js";
import { sseEvents } from "./sse.js";
import { setAdapterFetch } from "./stream.js";
import { normalizeGemini, normalizeOpenAI, settled } from "./usage.js";

/* The OpenAI and Gemini adapters (design-models §7.4, §12.1; WP9). No
 * network, no paid call: every provider answer below is a synthetic SSE
 * stream in the shape the vendors document, served by a fake fetch. The keys
 * are made-up strings, set only in this process. */

const OPENAI_KEY = "sk-test-0123456789abcdefFAKE";
const GEMINI_KEY = "AIza-test-0123456789FAKE";
process.env.OPENAI_API_KEY = OPENAI_KEY;
process.env.GEMINI_API_KEY = GEMINI_KEY;
process.env.VITE_STUDY_SUPABASE_URL = "https://proj.supabase.test";
delete process.env.OPENROUTER_API_KEY;

const SOL = "openai:gpt-6.2-sol";
const FLASH = "google:gemini-3.8-flash";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

type Call = { url: string; headers: Headers; body: Record<string, any> | null; redirect?: RequestRedirect };
type Reply = { status?: number; events?: Array<{ event?: string; data: unknown }>; raw?: string; hang?: boolean; json?: unknown; noHeaders?: boolean };

/** A fake fetch: the study's storage answers pictures; the provider answers `replies` in turn. */
function fake(replies: Reply[]) {
  const calls: Call[] = [];
  const enc = new TextEncoder();
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null, redirect: init?.redirect });
    if (u.startsWith("https://proj.supabase.test/")) return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
    const r = replies.shift() ?? { status: 500, json: { error: { message: "no reply left" } } };
    // The request went out, but no headers came back before the abort.
    if (r.noHeaders) return new Promise<Response>((_, no) => init?.signal?.addEventListener("abort", () => no(new DOMException("aborted", "AbortError"))));
    if (r.status && r.status >= 400) return new Response(JSON.stringify(r.json ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
    const text = r.raw ?? (r.events ?? []).map((e) => `${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`).join("");
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        // In small pieces, so events are split across reads.
        for (let i = 0; i < text.length; i += 37) c.enqueue(enc.encode(text.slice(i, i + 37)));
        if (!r.hang) c.close();
        init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  setAdapterFetch(f as typeof globalThis.fetch);
  return calls;
}

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
    kind: "practice",
    ref: "b1",
    system,
    messages: user,
    effort: "high",
    maxTokens: 6000,
    stopAt: Date.now() + 60_000,
    ledger: async (s) => {
      spends.push(s);
    },
    onText: (d, by) => {
      assert.equal(by, model, "the serving model is the ledger's id");
      text.push(d);
    },
    spends,
    text,
    ...more,
  };
}

/* ── OpenAI's stream ── */
const oaDelta = (delta: string) => ({ event: "response.output_text.delta", data: { type: "response.output_text.delta", delta } });
const oaDone = (usage: object, type = "response.completed", extra: object = {}) => ({ event: type, data: { type, response: { status: type === "response.completed" ? "completed" : "incomplete", usage, ...extra } } });
const oaUsage = { input_tokens: 12_000, input_tokens_details: { cached_tokens: 10_000 }, output_tokens: 3_000, output_tokens_details: { reasoning_tokens: 2_400 } };

/* ── Gemini's stream ── */
const gmChunk = (parts: object[], more: object = {}) => ({ data: { candidates: [{ content: { role: "model", parts }, ...more }] } });
const gmUsage = { promptTokenCount: 9_000, cachedContentTokenCount: 4_000, candidatesTokenCount: 800, thoughtsTokenCount: 1_200, totalTokenCount: 11_000 };

test("sse: events across split reads, CRLF and CR, several data lines, comments, a last event without its blank line", async () => {
  const text = ": keep-alive\r\nevent: a\r\ndata: 1\r\n\r\ndata: x\ndata: y\n\n: c\rdata: {\"z\":2}\r\rdata: last";
  for (const step of [1, 3, 7, 1000]) {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < text.length; i += step) c.enqueue(enc.encode(text.slice(i, i + step)));
        c.close();
      },
    });
    const got = [];
    for await (const ev of sseEvents(body)) got.push(ev);
    assert.deepEqual(got, [{ event: "a", data: "1" }, { event: null, data: "x\ny" }, { event: null, data: '{"z":2}' }, { event: null, data: "last" }], `step ${step}`);
  }
});

test("usage in Anthropic's shape: cached input out of the input, thinking in the output", () => {
  const o = normalizeOpenAI(oaUsage);
  assert.equal(o.input_tokens, 2_000);
  assert.equal(o.cache_read_input_tokens, 10_000);
  assert.equal(o.output_tokens, 3_000, "reasoning is a part of output_tokens already");
  assert.equal((o as { provider?: string }).provider, "openai");
  assert.deepEqual((o as { raw?: unknown }).raw, oaUsage);
  const g = normalizeGemini(gmUsage);
  assert.equal(g.input_tokens, 5_000);
  assert.equal(g.cache_read_input_tokens, 4_000);
  assert.equal(g.output_tokens, 2_000, "thoughtsTokenCount is reported apart and billed as output");
  // Priced at the registry's rows: Sol $2 in, $0.10 cached, $10 out.
  assert.ok(Math.abs(costUsd(o, SOL) - (2_000 * 2 + 10_000 * 0.1 + 3_000 * 10) / 1e6) < 1e-12);
  // Flash: $0.75 in, $0.075 cached, $3.75 out until 31 December 2026.
  assert.ok(Math.abs(costUsd(g, FLASH) - (5_000 * 0.75 + 4_000 * 0.075 + 2_000 * 3.75) / 1e6) < 1e-12 || Date.now() >= Date.parse("2027-01-01"));
});

test("settling (D4, D16): final usage at max(registry × fee, reported); no final usage after the stream opened: at least the reservation; refused before it: $0", () => {
  const m = { id: SOL, fee: 1.055 };
  const u = normalizeOpenAI(oaUsage);
  const list = costUsd(u, SOL);
  assert.ok(Math.abs(settled({ m, usage: u, final: true, chars: 10, opened: true, floorUsd: 9 }).costUsd - list * 1.055) < 1e-12, "the fee, and the floor does not apply to a final count");
  assert.ok(Math.abs(settled({ m, usage: u, final: true, chars: 10, opened: true, floorUsd: 9, reportedUsd: 5 }).costUsd - 5 * 1.055) < 1e-12, "the provider's own cost when it is more, × the fee on its credits");
  const early = settled({ m: { id: SOL }, usage: null, final: false, chars: 200, opened: true, floorUsd: 0.25 });
  assert.equal(early.costUsd, 0.25, "not ≈ $0: the reservation");
  assert.equal(early.estimated, true);
  assert.equal(early.usage?.output_tokens, 100, "the streamed text is still counted");
  assert.equal(settled({ m: { id: SOL }, usage: null, final: false, chars: 0, opened: false, floorUsd: 0.25 }).costUsd, 0, "an HTTP refusal before the stream costs nothing");
  // D16: an unverified registry row (the price not read on the vendor's page) settles × 1.5, as it was reserved; a reported cost replaces it.
  const unchecked = { id: SOL, verified: false };
  assert.ok(Math.abs(settled({ m: unchecked, usage: u, final: true, chars: 10, opened: true, floorUsd: 0 }).costUsd - list * 1.5) < 1e-12, "OpenAI's final usage on an unverified row: × 1.5");
  assert.ok(Math.abs(settled({ m: { ...unchecked, verified: true }, usage: u, final: true, chars: 10, opened: true, floorUsd: 0 }).costUsd - list) < 1e-12, "verified: the registry's");
  assert.ok(Math.abs(settled({ m: unchecked, usage: u, final: true, chars: 10, opened: true, floorUsd: 0, reportedUsd: list * 1.2 }).costUsd - list * 1.2) < 1e-12, "a reported cost is the provider's own figure");
});

test("OpenAI's request: instructions, input, pictures inline from the study's storage only, store false, effort, the output floor, a strict schema", async () => {
  const calls = fake([]);
  const m = modelInfo(SOL)!;
  const msgs: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "שאלה על השקף:" },
        { type: "image", source: { type: "url", url: "https://proj.supabase.test/storage/v1/object/sign/study/a.jpg?token=t" } },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
      ],
    },
    { role: "assistant", content: "תשובה קודמת" },
  ];
  const viaFake = await turnsOf(msgs, { fetch: fetchOf(calls), signal: new AbortController().signal });
  const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { questions: { type: "array", items: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } }, required: ["questions"], additionalProperties: false };
  const body = openaiBody({ system, effort: "medium", maxTokens: 800, format: { type: "json_schema", schema } }, m, viaFake);
  assert.equal(body.model, "gpt-6.2-sol");
  assert.equal(body.instructions, "You write practice questions.\n\n[שקף 5] Fakeomycin: a made-up drug.");
  assert.equal(body.store, false, "OpenAI keeps no copy");
  assert.equal(body.stream, true);
  assert.equal(body.max_output_tokens, 4_000, "thinking shares the cap: at least 4,000");
  assert.deepEqual(body.reasoning, { effort: "medium" });
  const input = body.input as Array<{ role: string; content: Array<Record<string, string>> }>;
  assert.equal(input[0].content[0].type, "input_text");
  assert.equal(input[0].content[1].image_url, `data:image/jpeg;base64,${btoa(String.fromCharCode(...JPEG))}`, "the picture's bytes, never its link");
  assert.equal(input[0].content[2].image_url, "data:image/png;base64,iVBORw0KGgo=");
  assert.deepEqual(input[1], { role: "assistant", content: [{ type: "output_text", text: "תשובה קודמת" }] });
  assert.ok(!JSON.stringify(body).includes("supabase"), "no storage link goes to the provider");
  const fmt = (body.text as { format: Record<string, unknown> }).format;
  assert.equal(fmt.strict, true);
  assert.equal((fmt.schema as Record<string, unknown>).$schema, undefined);
  assert.equal(((fmt.schema as any).properties.questions.items as Record<string, unknown>).additionalProperties, false, "every object closed");
  // A schema with an optional field cannot be strict: best effort, the schema as it is.
  assert.equal(strictSchema({ type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a"] }), null);
  assert.equal(strictSchema({ type: "object", properties: { a: { type: "string", default: "x" } }, required: ["a"] }), null);
  // Pictures from anywhere else are refused before anything is sent.
  await assert.rejects(
    turnsOf([{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://evil.example/a.jpg" } }] }], { fetch: fetchOf(calls), signal: new AbortController().signal }),
    /not the study's storage/,
  );
  await assert.rejects(
    turnsOf([{ role: "user", content: [{ type: "image", source: { type: "url", url: "http://proj.supabase.test/a.jpg" } }] }], { fetch: fetchOf(calls), signal: new AbortController().signal }),
    /not the study's storage/,
    "https only",
  );
  assert.equal(maxTokensFor({ maxTokens: 300_000 }, m), 128_000, "at most the model's cap");
});

/** The fake fetch installed for the adapters (fake() sets it); this reads it back for direct use. */
function fetchOf(_calls: Call[]): typeof fetch {
  return (async (u: string | URL | Request, i?: RequestInit) => {
    const s = String(u);
    if (s.startsWith("https://proj.supabase.test/")) return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
    void i;
    return new Response("not here", { status: 404 });
  }) as typeof fetch;
}

test("OpenAI's stream: text to onText as it comes, usage at the end, one settle at the registry's price, the key only in a header", async () => {
  const calls = fake([{ events: [{ event: "response.created", data: { type: "response.created" } }, oaDelta("שלום "), oaDelta("עולם"), oaDone(oaUsage)] }]);
  const o = opts(SOL);
  let started = 0;
  const res = await run({ ...o, onStart: () => (started += 1) });
  assert.equal(o.text.join(""), "שלום עולם");
  assert.equal(started, 1);
  assert.deepEqual({ stop: res.stop, model: res.model, timedOut: res.timedOut, estimated: res.estimated, chars: res.chars }, { stop: "end_turn", model: SOL, timedOut: false, estimated: false, chars: 9 });
  assert.equal(o.spends.length, 1);
  const s = o.spends[0];
  assert.equal(s.model, SOL);
  assert.equal(s.kind, "practice");
  // GPT-6.2 Sol's price is not verified: the ledger counts it × 1.5, as its reservation did (D16).
  assert.ok(Math.abs(s.costUsd - costUsd(normalizeOpenAI(oaUsage), SOL) * 1.5) < 1e-12);
  assert.equal(res.costUsd, s.costUsd);
  const sent = calls.find((c) => c.url === OPENAI_URL)!;
  assert.equal(sent.headers.get("authorization"), `Bearer ${OPENAI_KEY}`);
  assert.equal(sent.redirect, "error", "a redirect is never followed (it would carry a key header to another host)");
  assert.ok(!sent.url.includes(OPENAI_KEY) && !JSON.stringify(sent.body).includes(OPENAI_KEY), "the key is in the header only");
  assert.equal(sent.body?.max_output_tokens, 6_000);
});

test("OpenAI: max_output_tokens is a cut answer, content_filter and a refusal part are refusals", async () => {
  fake([{ events: [oaDelta("חצי"), oaDone(oaUsage, "response.incomplete", { incomplete_details: { reason: "max_output_tokens" } })] }]);
  assert.equal((await run({ ...opts(SOL), appFallback: false })).stop, "max_tokens");
  fake([{ events: [oaDone(oaUsage, "response.incomplete", { incomplete_details: { reason: "content_filter" } })] }]);
  assert.equal((await run({ ...opts(SOL), appFallback: false })).stop, "refusal");
  fake([{ events: [{ event: "response.refusal.delta", data: { type: "response.refusal.delta", delta: "I can't" } }, oaDone(oaUsage)] }]);
  const r = await run({ ...opts(SOL), appFallback: false });
  assert.equal(r.stop, "refusal");
  assert.equal(r.chars, 0, "a refusal's words are not the answer");
});

test("D4: an abort or a timeout before the final usage settles at the reservation, not at $0", async () => {
  fake([{ events: [oaDelta("מתחיל")], hang: true }]);
  const ctl = new AbortController();
  const o = opts(SOL, { reservedUsd: 0.42, signal: ctl.signal, onText: () => ctl.abort() });
  const r = await run(o);
  assert.equal(r.stop, "aborted");
  assert.equal(o.spends.length, 1);
  assert.equal(o.spends[0].costUsd, 0.42);
  assert.equal(o.spends[0].estimated, true);
  // A timeout: the reservation too; with no reservation given, the request's own worst case.
  fake([{ events: [], hang: true }]);
  const t = opts(FLASH, { stopAt: Date.now() - 1 });
  const started = Date.now();
  const rt = await run({ ...t, appFallback: false });
  assert.ok(Date.now() - started >= 4_500, "at least 5 s, as Claude's calls");
  assert.equal(rt.stop, "timeout");
  assert.equal(rt.timedOut, true);
  assert.ok(t.spends[0].costUsd > 0, "not $0");
  // A stream cut before the end (no completed event): an error, at the reservation.
  fake([{ events: [oaDelta("abc")] }]);
  const c = opts(SOL, { reservedUsd: 0.3 });
  await assert.rejects(run({ ...c, appFallback: false }), /ended before the model finished/);
  assert.equal(c.spends[0].costUsd, 0.3);
  // Stopped after the request went out but before its headers: the provider may bill the input already, so the reservation.
  fake([{ noHeaders: true }]);
  const pre = new AbortController();
  const p = opts(SOL, { reservedUsd: 0.21, signal: pre.signal });
  setTimeout(() => pre.abort(), 30);
  const rp = await run(p);
  assert.equal(rp.stop, "aborted");
  assert.equal(p.spends[0].costUsd, 0.21);
});

test("errors: an HTTP refusal costs $0 and its words never hold the key; a 429 is tried once more", async () => {
  fake([{ status: 401, json: { error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } } }]);
  const o = opts(SOL, { reservedUsd: 0.5 });
  const err = await run({ ...o, appFallback: false }).then(
    () => null,
    (e: unknown) => e as Error,
  );
  assert.ok(err && /openai 401/.test(err.message), String(err));
  assert.ok(!err!.message.includes(OPENAI_KEY), "the key is scrubbed from the error");
  assert.equal(o.spends[0].costUsd, 0);
  const calls = fake([{ status: 429, json: { error: { message: "slow down" } } }, { events: [oaDelta("ok"), oaDone(oaUsage)] }]);
  const r = await run(opts(SOL));
  assert.equal(r.stop, "end_turn");
  assert.equal(calls.filter((c) => c.url === OPENAI_URL).length, 2);
  // No key: the call fails before anything is sent.
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "  ";
  const none = fake([]);
  await assert.rejects(run({ ...opts(SOL), appFallback: false }), /no key/);
  assert.equal(none.length, 0);
  process.env.OPENAI_API_KEY = saved;
});

test("D8 through an adapter: a refusal before any text reruns once on the default under its own reservation", async () => {
  fake([{ events: [oaDone(oaUsage, "response.incomplete", { incomplete_details: { reason: "content_filter" } })] }]);
  const enc = new TextEncoder();
  const events = [
    { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "תשובה" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ];
  const opus = new Anthropic({
    apiKey: "test-anthropic",
    maxRetries: 0,
    fetch: (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
            c.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as unknown as typeof globalThis.fetch,
  });
  const reserved: number[] = [];
  const rerun: Spend[] = [];
  const o = opts(SOL, {
    client: opus,
    onText: () => undefined,
    reserveFallback: async (usd) => {
      reserved.push(usd);
      return async (s) => {
        rerun.push(s);
      };
    },
  });
  const r = await run(o);
  assert.equal(r.stop, "end_turn");
  assert.equal(r.model, "claude-opus-5-5");
  assert.equal(reserved.length, 1);
  assert.equal(o.spends.length, 1, "the refused call settled on its own ledger");
  assert.equal(o.spends[0].model, SOL);
  assert.equal(rerun[0].model, "claude-opus-5-5");
});

test("Gemini's request: the key in a header, systemInstruction, model turns, inline pictures, thinkingLevel, the JSON schema", async () => {
  const calls = fake([{ events: [gmChunk([{ text: "a" }], { finishReason: "STOP" })] }]);
  const m = modelInfo(FLASH)!;
  const msgs: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: [{ type: "text", text: "מה בתמונה?" }, { type: "image", source: { type: "url", url: "https://proj.supabase.test/x.jpg" } }] },
    { role: "assistant", content: [{ type: "text", text: "קודם" }] },
  ];
  await run({ ...opts(FLASH, { messages: msgs, effort: "low", format: { type: "json_schema", schema: { $schema: "x", type: "object", properties: {} } } }), appFallback: false }).catch(() => undefined);
  const sent = calls.find((c) => c.url.startsWith(GEMINI_BASE))!;
  assert.equal(sent.url, `${GEMINI_BASE}gemini-3.8-flash:streamGenerateContent?alt=sse`);
  assert.equal(sent.headers.get("x-goog-api-key"), GEMINI_KEY);
  assert.ok(!sent.url.includes(GEMINI_KEY), "never in the URL");
  const b = sent.body!;
  assert.deepEqual(b.systemInstruction, { parts: [{ text: "You write practice questions.\n\n[שקף 5] Fakeomycin: a made-up drug." }] });
  assert.equal(b.contents[0].role, "user");
  assert.deepEqual(b.contents[0].parts[1], { inlineData: { mimeType: "image/jpeg", data: btoa(String.fromCharCode(...JPEG)) } });
  assert.deepEqual(b.contents[1], { role: "model", parts: [{ text: "קודם" }] });
  assert.deepEqual(b.generationConfig, { maxOutputTokens: 6_000, thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: {} } });
  // The body builder is pure: no format, no responseMimeType.
  const plain = geminiBody({ system: [], effort: "high", maxTokens: 100 }, m, [{ role: "user", parts: [{ kind: "text", text: "x" }] }]);
  assert.equal(plain.systemInstruction, undefined);
  assert.deepEqual(plain.generationConfig, { maxOutputTokens: 4_000, thinkingConfig: { thinkingLevel: "high" } });
});

test("Gemini's stream: thought parts skipped, the last usage counts with thinking as output, the finish reasons", async () => {
  fake([
    {
      events: [
        gmChunk([{ text: "חושב…", thought: true }]),
        { data: { candidates: [{ content: { parts: [{ text: "שלום " }] } }], usageMetadata: { promptTokenCount: 9_000 } } },
        { data: { candidates: [{ content: { parts: [{ text: "עולם" }] }, finishReason: "STOP" }], usageMetadata: gmUsage } },
      ],
    },
  ]);
  const o = opts(FLASH);
  const r = await run(o);
  assert.equal(o.text.join(""), "שלום עולם");
  assert.equal(r.stop, "end_turn");
  assert.equal(r.estimated, false);
  assert.ok(Math.abs(o.spends[0].costUsd - costUsd(normalizeGemini(gmUsage), FLASH) * 1.5) < 1e-12, "unverified: × 1.5");
  assert.equal((o.spends[0].usage as { provider?: string }).provider, "google");
  for (const [reason, stop] of [["MAX_TOKENS", "max_tokens"], ["SAFETY", "refusal"], ["PROHIBITED_CONTENT", "refusal"], ["RECITATION", "refusal"]] as const) {
    fake([{ events: [gmChunk([], { finishReason: reason })] }]);
    assert.equal((await run({ ...opts(FLASH), appFallback: false })).stop, stop, reason);
  }
  fake([{ events: [{ data: { promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 50 } } }] }]);
  assert.equal((await run({ ...opts(FLASH), appFallback: false })).stop, "refusal", "a blocked prompt");
  fake([{ events: [{ data: { error: { code: 500, message: "internal" } } }] }]);
  await assert.rejects(run({ ...opts(FLASH), appFallback: false }), /google: internal/);
});

test("structured items stream through an adapter as through Claude (generateItems)", async () => {
  const doc = JSON.stringify({ items: [{ q: "שאלה 1" }, { q: "שאלה 2" }] });
  fake([{ events: [...doc.match(/.{1,5}/gsu)!.map((d) => oaDelta(d)), oaDone(oaUsage)] }]);
  const got: string[] = [];
  const o = opts(SOL);
  const r = await generateItems({
    ...o,
    wrapper: z.object({ items: z.array(z.object({ q: z.string() })) }),
    item: z.object({ q: z.string() }),
    onItem: (it, _i, by) => {
      assert.equal(by, SOL);
      got.push(it.q);
    },
  });
  assert.deepEqual(got, ["שאלה 1", "שאלה 2"]);
  assert.equal(r.rejected, 0);
});

test("readiness: OpenAI and Google are ready with their keys (an adapter in this build); OpenRouter without its key is not; health booleans only", () => {
  assert.equal(providerReady("openai"), true);
  assert.equal(providerReady("google"), true);
  assert.equal(providerReady("openrouter"), false, "its adapter is in this build (compat.ts), its key is not set here");
  assert.equal(providerReady("openrouter", { OPENROUTER_API_KEY: "sk-or-test" }), true);
  assert.equal(providerReady("deepseek", { OPENROUTER_API_KEY: "sk-or-test" }), false, "never a direct endpoint (OD22)");
  assert.equal(providerReady("openai", {}), false, "no key, not ready");
  const h = providersConfigured();
  assert.deepEqual(h, { anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()), openai: true, google: true, openrouter: false });
  assert.ok(Object.values(h).every((v) => typeof v === "boolean"));
});

test("the registry's other providers: unverified, dated, '<provider>:<id>', Argon only at $4/$20", () => {
  for (const id of ["openai:gpt-6.2-astra", SOL, "openai:gpt-6.1-terra", "openai:gpt-6-luna", "google:gemini-4-argon", FLASH]) {
    const m = modelInfo(id)!;
    assert.ok(m, id);
    assert.equal(m.verified, false, `${id}: never routed until its price is checked on the vendor's page`);
    assert.equal(m.checked, "2026-11-27");
    assert.equal(m.serverFallback, false);
    assert.ok(m.minMaxTokens && m.minMaxTokens >= 4_000 && m.thinkingInMax);
  }
  assert.deepEqual([modelInfo("google:gemini-4-argon")!.prices[0].in, modelInfo("google:gemini-4-argon")!.prices[0].out], [4, 20]);
  assert.equal(modelInfo("openai:gpt-6.2-astra")!.expensive, true);
});

test.after(() => setAdapterFetch(null));
