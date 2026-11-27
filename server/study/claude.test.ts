import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";
import { costUsd } from "./budget.js";
import { cleanSchema, generateItems, JsonArrayItems, MODEL, run, settleFor, streamText, type Spend } from "./claude.js";

/* F-5 (spec §7.F): research-claude's replay tests, moved, plus what §4.2 adds
 * (onStart, the serving model per item, an AbortSignal, settleFor). No
 * network: the SDK gets a fetch that answers with an SSE stream built from the
 * event shapes of the streaming and fallback docs. */

process.env.STUDY_WORKER_KEY = "k-0123456789abcdef0123456789abcdef";

// ── A sample schema that follows §2.6's rules: every field required, no enum, no union ──
const Option = z.object({
  text: z.string().describe("The option, Hebrew, English terms as the lecture writes them"),
  correct: z.boolean(),
  why: z.string().describe("One or two sentences: why this option is right or wrong, from the slides"),
});
const Question = z
  .object({
    case: z.boolean().describe("true for a clinical case vignette, false for a direct question"),
    part: z.number().int().describe("Index of the lecture part the question tests, from the list given"),
    stem: z.string().describe("The question; for a case, the vignette and then the question"),
    options: z.array(Option).length(5),
    takeaway: z.string().describe("One sentence: the fact this question tests"),
    slides: z.array(z.number().int()).describe("Slide numbers the question and its answers come from"),
  })
  .refine((q) => q.options.filter((o) => o.correct).length === 1, "exactly one correct option");
const QuestionSet = z.object({ questions: z.array(Question) });
const inRange = (slides: number[], from: number, to: number) => slides.length > 0 && slides.every((n) => n >= from && n <= to);

// Sample items: Hebrew, quotes, braces, a backslash and a "]" inside strings.
const q = (n: number) => ({
  case: n % 2 === 1,
  part: 1,
  stem: `שאלה ${n}: מטופלת עם "מורסה" בכבד {CT} ו-\\ סימן; מהו המנגנון של Examplomycin]?`,
  options: [0, 1, 2, 3, 4].map((k) => ({
    text: `אפשרות ${k} עם "ציטוט" ו-}`,
    correct: k === n % 5,
    why: k === n % 5 ? "נכון: האנזים מעוכב [ש' 5]" : "שגוי: זה לא המנגנון [ש' 5]",
  })),
  takeaway: "התרופה פעילה רק בתנאים אנאירוביים.",
  slides: [5],
});
const items = [1, 2, 3, 4].map(q);
const doc = JSON.stringify({ questions: items });

// ── The fake API ──
type Sent = { url: string; headers: Headers; body: Record<string, any> };
function sse(events: object[], opts: { hang?: boolean; status?: number } = {}) {
  const sent: Sent[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    if (opts.status && opts.status >= 400) {
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), {
        status: opts.status,
        headers: { "content-type": "application/json" },
      });
    }
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`));
        if (!opts.hang) c.close();
        init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
  };
  const client = new Anthropic({ apiKey: "test-key", fetch: fetch as unknown as typeof globalThis.fetch, maxRetries: 0 });
  return { client, sent };
}
const start = (model = "claude-opus-5-5") => ({
  type: "message_start",
  message: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 13000, output_tokens: 1 },
  },
});
const thinking = [
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
  { type: "content_block_stop", index: 0 },
];
const textBlock = (index: number, text: string, size = 9) => {
  const ev: object[] = [{ type: "content_block_start", index, content_block: { type: "text", text: "" } }];
  for (let i = 0; i < text.length; i += size) ev.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: text.slice(i, i + size) } });
  ev.push({ type: "content_block_stop", index });
  return ev;
};
const fallbackBlock = (index: number) => [
  {
    type: "content_block_start",
    index,
    content_block: { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" }, trigger: { type: "refusal", category: "bio" } },
  },
  { type: "content_block_stop", index },
];
const end = (stop: string, usage: object) => [
  { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, stop_details: null }, usage },
  { type: "message_stop" },
];
const system: Anthropic.Beta.BetaTextBlockParam[] = [
  { type: "text", text: "You write practice questions ..." },
  { type: "text", text: "The full lecture, for context:\n\n[שקף 5] Examplomycin: mechanism of action ...", cache_control: { type: "ephemeral" } },
];
const user: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: "Write 4 questions on slides 3-9." }];
const base = { kind: "practice", ref: "b1", system, messages: user, effort: "high" as const, maxTokens: 32000 };

// ── 1. The item scanner ──
test("scanner: the 4 items from 300 random chunkings", () => {
  for (let trial = 0; trial < 300; trial++) {
    const scan = new JsonArrayItems();
    const got: unknown[] = [];
    for (let i = 0; i < doc.length; ) {
      const n = 1 + Math.floor(Math.random() * 13);
      got.push(...scan.push(doc.slice(i, i + n)));
      i += n;
    }
    assert.deepEqual(got, items);
    assert.equal(scan.bad, 0);
  }
});

test("scanner: a cut inside item 3 yields items 1-2; a malformed item is skipped, not fatal", () => {
  const cut = doc.indexOf('"stem":"שאלה 3');
  assert.equal(new JsonArrayItems().push(doc.slice(0, cut + 20)).length, 2);
  const s = new JsonArrayItems();
  assert.deepEqual(s.push('{"questions":[{"a":1},{"a":tru},{"a":3}]}'), [{ a: 1 }, { a: 3 }]);
  assert.equal(s.bad, 1);
});

// ── 2. What the API receives as the schema ──
test("the plain schema: every field required, no union, no enum, no bounds, no $schema", () => {
  const schema = cleanSchema(zodOutputFormat(QuestionSet).schema as Record<string, unknown>);
  const text = JSON.stringify(schema);
  const optional = (s: any): number => {
    if (!s || typeof s !== "object") return 0;
    let n = 0;
    if (s.type === "object" && s.properties) n += Object.keys(s.properties).filter((k) => !(s.required ?? []).includes(k)).length;
    for (const v of Object.values(s)) n += typeof v === "object" ? optional(v) : 0;
    return n;
  };
  assert.equal(optional(schema), 0, "no optional properties");
  assert.equal((text.match(/"anyOf"|"type":\[/g) ?? []).length, 0, "no unions");
  assert.ok(!/"additionalProperties":true/.test(text), "additionalProperties false everywhere");
  assert.ok(!/enum/.test(text), "no enum, neither a keyword nor the SDK's description hint");
  assert.ok(!text.includes("9007199254740991") && !/"minimum"|"maximum"/.test(text), "no numeric bounds");
  assert.ok(!text.includes("$schema"), "no root $schema");
  assert.ok(text.includes("{maxItems: 5, minItems: 5}"), "the 5-option hint stays");
  assert.ok(text.includes("Index of the lecture part"), "descriptions stay");
});

// ── 3. The helpers against the SDK, with replayed streams ──
test("a mid-JSON fallback yields every complete item, in order, each with the model that wrote it", async () => {
  const split = doc.indexOf('"stem":"שאלה 3') + 25;
  const iterations = [
    { type: "message", model: "claude-opus-5-5", input_tokens: 1500, output_tokens: 600, cache_read_input_tokens: 13000, cache_creation_input_tokens: 0, cache_creation: null },
    { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 14600, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
  ];
  const { client, sent } = sse([
    start(),
    ...thinking,
    ...textBlock(1, doc.slice(0, split)),
    ...fallbackBlock(2),
    ...textBlock(3, doc.slice(split)),
    ...end("end_turn", { input_tokens: 14600, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations }),
  ]);
  const spends: Spend[] = [];
  const seen: Array<[number, string]> = [];
  let starts = 0;
  const res = await generateItems({
    ...base,
    client,
    stopAt: Date.now() + 60_000,
    wrapper: QuestionSet,
    item: Question,
    accept: (x) => inRange(x.slides, 3, 9),
    onStart: () => (starts += 1),
    onItem: (_x, i, servedBy) => seen.push([i, servedBy]),
    ledger: async (s) => void spends.push(s),
  });
  assert.equal(res.items.length, 4);
  assert.equal(res.rejected, 0);
  assert.deepEqual(seen, [
    [0, "claude-opus-5-5"],
    [1, "claude-opus-5-5"],
    [2, "claude-opus-4-8"],
    [3, "claude-opus-4-8"],
  ]);
  assert.equal(res.model, "claude-opus-4-8", "the serving model");
  assert.equal(starts, 1, "onStart fires once, at message_start");
  const want = (1500 * 4 + 600 * 20 + 13000 * 0.2) / 1e6 + (14600 * 5 + 900 * 25) / 1e6;
  assert.equal(spends.length, 1, "one settle per call");
  assert.ok(Math.abs(spends[0].costUsd - want) < 1e-9, "both attempts at their own rates");
  assert.equal(spends[0].estimated, false);
  assert.equal(spends[0].kind, "practice");
  assert.equal(spends[0].ref, "b1");
  // The request.
  const body = sent[0].body;
  assert.ok(sent[0].url.endsWith("/v1/messages"), sent[0].url);
  assert.ok((sent[0].headers.get("anthropic-beta") ?? "").includes("server-side-fallback-2026-07-01"));
  assert.equal(body.model, MODEL);
  assert.equal(body.fallbacks, "default");
  assert.equal(body.output_config.effort, "high");
  assert.deepEqual(body.output_config.format, { type: "json_schema", schema: cleanSchema(zodOutputFormat(QuestionSet).schema) }, "the plain schema, no parse helper");
  assert.equal(body.system[1].cache_control?.type, "ephemeral");
  assert.equal(body.system[0].cache_control, undefined);
  assert.equal(body.cache_control, undefined, "no top-level caching unless cacheTail");
  assert.equal(body.max_tokens, 32000);
});

test("max_tokens keeps the complete items and reports the stop", async () => {
  const cut = doc.indexOf('"stem":"שאלה 3') + 10;
  const { client } = sse([start(), ...thinking, ...textBlock(1, doc.slice(0, cut)), ...end("max_tokens", { output_tokens: 32000 })]);
  const spends: Spend[] = [];
  const res = await generateItems({
    ...base,
    client,
    stopAt: Date.now() + 60_000,
    wrapper: QuestionSet,
    item: Question,
    onItem: () => undefined,
    ledger: async (s) => void spends.push(s),
  });
  assert.equal(res.items.length, 2);
  assert.equal(res.stop, "max_tokens");
  assert.equal(spends[0].estimated, false);
  assert.ok(Math.abs(spends[0].costUsd - costUsd({ input_tokens: 1500, cache_read_input_tokens: 13000, output_tokens: 32000 }, MODEL)) < 1e-9);
});

test("the SDK's own parser throws on a split answer (why the plain format)", async () => {
  const split = doc.indexOf('"stem":"שאלה 3') + 25;
  const { client } = sse([start(), ...textBlock(0, doc.slice(0, split)), ...fallbackBlock(1), ...textBlock(2, doc.slice(split)), ...end("end_turn", { output_tokens: 900 })]);
  await assert.rejects(async () => {
    const s = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { format: zodOutputFormat(QuestionSet) },
      messages: user,
    });
    for await (const ev of s) void ev;
    await s.finalMessage();
  }, /Failed to parse structured output/);
});

test("the deadline aborts, keeps what arrived and settles the floor with estimated: true", async () => {
  const cut = doc.indexOf('"stem":"שאלה 2');
  const { client } = sse([start(), ...thinking, ...textBlock(1, doc.slice(0, cut))], { hang: true });
  const spends: Spend[] = [];
  const t0 = Date.now();
  const res = await generateItems({
    ...base,
    client,
    stopAt: Date.now() + 1, // the helper waits at least 5 s
    wrapper: QuestionSet,
    item: Question,
    onItem: () => undefined,
    ledger: async (s) => void spends.push(s),
  });
  const waited = Date.now() - t0;
  assert.ok(waited >= 4_900 && waited < 15_000, `${waited} ms`);
  assert.equal(res.timedOut, true);
  assert.equal(res.stop, "timeout");
  assert.equal(res.items.length, 1);
  assert.equal(res.estimated, true);
  assert.equal(spends[0].estimated, true);
  assert.equal(spends[0].usage?.estimated, true);
  assert.ok((spends[0].usage?.output_tokens ?? 0) >= Math.ceil(cut / 2), "output floor: characters ÷ 2");
  assert.ok(spends[0].costUsd > 0);
});

test("an aborted signal stops the stream and still settles", async () => {
  const cut = doc.indexOf('"stem":"שאלה 2');
  const { client } = sse([start(), ...thinking, ...textBlock(1, doc.slice(0, cut))], { hang: true });
  const spends: Spend[] = [];
  const phone = new AbortController();
  const t0 = Date.now();
  const res = await generateItems({
    ...base,
    client,
    stopAt: Date.now() + 60_000,
    wrapper: QuestionSet,
    item: Question,
    signal: phone.signal,
    onItem: () => phone.abort(), // the phone closes the stream after the first question
    ledger: async (s) => void spends.push(s),
  });
  assert.ok(Date.now() - t0 < 4_000, "stopped at once, not at the deadline");
  assert.equal(res.stop, "aborted");
  assert.equal(res.timedOut, false);
  assert.equal(res.items.length, 1);
  assert.equal(spends.length, 1, "settled");
  assert.equal(spends[0].estimated, true);

  // A phone already gone before the call: it stops before any text, and still settles.
  const early = sse([start(), ...thinking], { hang: true });
  const gone = new AbortController();
  gone.abort();
  const spends2: Spend[] = [];
  const res2 = await run({ ...base, client: early.client, stopAt: Date.now() + 60_000, signal: gone.signal, onText: () => undefined, ledger: async (s) => void spends2.push(s) });
  assert.equal(res2.stop, "aborted");
  assert.equal(spends2.length, 1);
});

test("an API error is the caller's, and the call still settles", async () => {
  const { client } = sse([], { status: 500 });
  const spends: Spend[] = [];
  await assert.rejects(
    run({ ...base, client, stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async (s) => void spends.push(s) }),
    (e: unknown) => e instanceof Anthropic.APIError && e.status === 500,
  );
  assert.equal(spends.length, 1);
  assert.equal(spends[0].costUsd, 0, "nothing arrived: nothing to count");
});

test("streamText: plain text, top-level automatic caching for a conversation, no format", async () => {
  const answer = "לפי ההרצאה, התרופה פעילה רק בתנאים אנאירוביים. [ש' 5]";
  const { client, sent } = sse([start(), ...thinking, ...textBlock(1, answer), ...end("end_turn", { output_tokens: 300 })]);
  let streamed = "";
  const res = await streamText({
    client,
    kind: "ask",
    ref: "answer",
    system,
    messages: [
      { role: "user", content: "מה המנגנון?" },
      { role: "assistant", content: "עיכוב של האנזים. [ש' 5]" },
      { role: "user", content: "ולמה לא בתנאים אירוביים?" },
    ],
    effort: "low",
    maxTokens: 3000,
    stopAt: Date.now() + 60_000,
    cacheTail: true,
    write: (d) => (streamed += d),
    ledger: async () => undefined,
  });
  const body = sent[0].body;
  assert.equal(res.text, answer);
  assert.equal(streamed, answer);
  assert.equal(body.cache_control?.type, "ephemeral");
  assert.equal(body.system[1].cache_control?.type, "ephemeral");
  assert.equal(body.messages.length, 3);
  assert.equal(body.output_config.format, undefined);
  assert.equal(body.output_config.effort, "low");
});

test("settleFor settles the reservation through study_settle and counts a failure", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let answer: { data: unknown; error: unknown } = { data: true, error: null };
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return answer;
    },
  } as unknown as SupabaseClient;
  let failed = 0;
  const ledger = settleFor(sb, 41, () => (failed += 1));
  const usage = { input_tokens: 1500, cache_read_input_tokens: 13000, output_tokens: 5000 };
  assert.equal(await ledger({ kind: "practice", model: MODEL, usage, costUsd: 0.1086, estimated: false }), true);
  assert.equal(calls[0].fn, "study_settle");
  assert.equal(calls[0].args.p_id, 41);
  assert.equal(calls[0].args.p_model, MODEL);
  assert.deepEqual(calls[0].args.p_usage, usage);
  assert.ok(Math.abs((calls[0].args.p_cost as number) - 0.1086) < 1e-9);
  assert.equal(calls[0].args.p_key, process.env.STUDY_WORKER_KEY);
  assert.equal(failed, 0);
  answer = { data: null, error: { message: "JWT expired" } };
  const quiet = console.error;
  console.error = () => undefined;
  try {
    assert.equal(await ledger({ kind: "practice", model: MODEL, usage, costUsd: 0.1086, estimated: false }), false);
  } finally {
    console.error = quiet;
  }
  assert.equal(failed, 1);
});

// ── 4. Routing (design-models §7.4, D8): run({ model }) ──
const refusalEnd = end("refusal", { output_tokens: 3 });
const okText = "תשובה קצרה [ש' 5]";
/** Answers each request in turn with the next stream (the last one repeats). */
function sseSeq(streams: Array<{ events: object[]; status?: number }>) {
  const sent: Sent[] = [];
  let i = 0;
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const s = streams[Math.min(i++, streams.length - 1)];
    if (s.status && s.status >= 400) {
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), { status: s.status, headers: { "content-type": "application/json" } });
    }
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of s.events) c.enqueue(enc.encode(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
  };
  const client = new Anthropic({ apiKey: "test-key", fetch: fetch as unknown as typeof globalThis.fetch, maxRetries: 0 });
  return { client, sent };
}

test("no model, or the default by name: today's request exactly (the snapshot), and chars in the result", async () => {
  const format = { type: "json_schema" as const, schema: cleanSchema(zodOutputFormat(QuestionSet).schema as Record<string, unknown>) };
  const bodies: Array<Record<string, unknown>> = [];
  const betas: string[] = [];
  for (const model of [undefined, "claude-opus-5-5"]) {
    const { client, sent } = sse([start(), ...textBlock(0, okText), ...end("end_turn", { output_tokens: 20 })]);
    const res = await run({ ...base, client, model, format, cacheTail: false, stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined });
    assert.equal(res.chars, okText.length);
    assert.equal(res.model, "claude-opus-5-5");
    bodies.push(sent[0].body);
    betas.push(sent[0].headers.get("anthropic-beta") ?? "");
  }
  // Today's request (claude.ts before the routing seam), field by field.
  const today = {
    model: MODEL,
    max_tokens: 32000,
    fallbacks: "default",
    output_config: { effort: "high", format },
    system,
    messages: user,
    stream: true,
  };
  assert.deepEqual(bodies[0], today);
  assert.deepEqual(bodies[1], today);
  for (const b of betas) assert.ok(b.includes("server-side-fallback-2026-07-01"));
});

test("a routed Claude model: its id; no server-side fallback where it has none; the output floor; no effort where there is none", async () => {
  const haiku = sse([start("claude-haiku-5-5"), ...textBlock(0, okText), ...end("end_turn", { output_tokens: 20 })]);
  await run({ ...base, maxTokens: 800, client: haiku.client, model: "claude-haiku-5-5", stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined });
  const b = haiku.sent[0].body;
  assert.equal(b.model, "claude-haiku-5-5");
  assert.equal(b.fallbacks, undefined, "Haiku 5.5 has no server-side fallback");
  assert.ok(!(haiku.sent[0].headers.get("anthropic-beta") ?? "").includes("server-side-fallback"));
  assert.equal(b.max_tokens, 2000, "at least 2,000: thinking shares max_tokens");
  assert.deepEqual(b.output_config, { effort: "high" });

  const h45 = sse([start("claude-haiku-4-5"), ...textBlock(0, okText), ...end("end_turn", { output_tokens: 20 })]);
  await run({ ...base, maxTokens: 100_000, client: h45.client, model: "claude-haiku-4-5", stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined });
  assert.equal(h45.sent[0].body.output_config, undefined, "no effort control, no format: no output_config");
  assert.equal(h45.sent[0].body.max_tokens, 64_000, "capped at the model's output limit");

  const sonnet = sse([start("claude-sonnet-5-5"), ...textBlock(0, okText), ...end("end_turn", { output_tokens: 20 })]);
  await run({ ...base, client: sonnet.client, model: "claude-sonnet-5-5", fallbacks: false, stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined });
  assert.equal(sonnet.sent[0].body.fallbacks, undefined, "fallbacks: false is honoured (comparisons)");
  assert.equal(sonnet.sent[0].body.model, "claude-sonnet-5-5");
  await assert.rejects(run({ ...base, client: sonnet.client, model: "claude-someday-9", stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined }), /unknown model/);
});

test("D8: a refusal before any text runs once more on the default, under its own reservation", async () => {
  const { client, sent } = sseSeq([
    { events: [start("claude-haiku-5-5"), ...thinking, ...refusalEnd] },
    { events: [start(), ...textBlock(0, okText), ...end("end_turn", { output_tokens: 20 })] },
  ]);
  const first: Spend[] = [];
  const second: Spend[] = [];
  const reserved: number[] = [];
  let starts = 0;
  let text = "";
  const res = await run({
    ...base,
    client,
    model: "claude-haiku-5-5",
    stopAt: Date.now() + 60_000,
    onStart: () => (starts += 1),
    onText: (d, by) => (text += `${by}:${d}`),
    ledger: async (s) => void first.push(s),
    reserveFallback: async (usd) => {
      reserved.push(usd);
      return async (s) => void second.push(s);
    },
  });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.model, "claude-opus-5-5");
  assert.equal(sent[1].body.fallbacks, "default", "the rerun is today's request");
  assert.equal(res.model, "claude-opus-5-5");
  assert.equal(res.stop, "end_turn");
  assert.equal(res.chars, okText.length);
  assert.ok(text.startsWith("claude-opus-5-5:"));
  assert.equal(first.length, 1, "the refused call settles on its own reservation");
  assert.equal(first[0].model, "claude-haiku-5-5");
  assert.equal(second.length, 1, "the rerun on its own");
  assert.equal(reserved.length, 1);
  assert.ok(reserved[0] > 0.6 && reserved[0] < 0.8, `the rerun's worst case on the default: ${reserved[0]}`);
  assert.equal(starts, 1, "onStart once");
});

test("D8: an error before any text reruns too; after text, a refusal stays; without reserveFallback or with appFallback off, as today", async () => {
  const errThenOk = sseSeq([{ events: [], status: 500 }, { events: [start(), ...textBlock(0, okText), ...end("end_turn", { output_tokens: 20 })] }]);
  const res = await run({ ...base, client: errThenOk.client, model: "claude-haiku-5-5", stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined, reserveFallback: async () => async () => undefined });
  assert.equal(res.model, "claude-opus-5-5");
  assert.equal(errThenOk.sent.length, 2);

  const late = sseSeq([{ events: [start("claude-haiku-5-5"), ...textBlock(0, "חלק"), ...refusalEnd] }]);
  const r2 = await run({ ...base, client: late.client, model: "claude-haiku-5-5", stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined, reserveFallback: async () => async () => undefined });
  assert.equal(r2.stop, "refusal");
  assert.equal(late.sent.length, 1, "text had streamed: the op's refusal path, as today");

  const none = sseSeq([{ events: [start("claude-haiku-5-5"), ...refusalEnd] }]);
  const r3 = await run({ ...base, client: none.client, model: "claude-haiku-5-5", stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined });
  assert.equal(r3.stop, "refusal");
  assert.equal(none.sent.length, 1);

  const off = sseSeq([{ events: [], status: 500 }]);
  await assert.rejects(
    run({ ...base, client: off.client, model: "claude-haiku-5-5", appFallback: false, stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined, reserveFallback: async () => async () => undefined }),
    (e: unknown) => e instanceof Anthropic.APIError,
  );
  // The default never reruns on itself (it has server-side fallback).
  const opus = sseSeq([{ events: [start(), ...refusalEnd] }]);
  const r4 = await run({ ...base, client: opus.client, stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined, reserveFallback: async () => async () => undefined });
  assert.equal(r4.stop, "refusal");
  assert.equal(opus.sent.length, 1);
});

test("an id the registry does not list is refused before any request", async () => {
  const { client, sent } = sseSeq([{ events: [start(), ...textBlock(0, okText), ...end("end_turn", { output_tokens: 20 })] }]);
  await assert.rejects(run({ ...base, client, model: "openai:gpt-x", stopAt: Date.now() + 60_000, onText: () => undefined, ledger: async () => undefined }), /unknown model/);
  assert.equal(sent.length, 0);
});
