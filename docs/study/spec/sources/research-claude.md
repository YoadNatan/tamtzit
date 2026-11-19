# Research: structured content from Claude (questions, flashcards, chat, mnemonics)

Scope: how the study app should generate structured content with `claude-opus-5-5` through `@anthropic-ai/sdk` 1.3.0 (as installed), how to cache the lecture, what each feature costs, and how every call counts toward `STUDY_MONTHLY_USD`. Design only. Nothing in the repo was changed.

**What was verified.** No API key exists here. The helpers below:
- compile under the repo's API compiler options;
- run against the installed SDK, which is given a fake `fetch` that replays SSE streams built from the documented event shapes.

The ledger SQL runs on the local Postgres. `spec/_claude-proto/run-all.sh` re-runs all 37 checks.

**Runtime.** The task says "edge functions", but the repo now runs the study API on Vercel's Node.js runtime. See `api/study/health.ts`, `maxDuration: 300`, the README, and `section.ts`'s 270 s guard. Vercel's docs could not be checked: the sandbox proxy blocks vercel.com.

## 1. Recommendation

1. **JSON outputs, not tools.**
   - Call `client.beta.messages.stream()` with `output_config: { effort, format: { type: "json_schema", schema } }`.
   - Keep `section.ts`'s `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`.
   - Derive `schema` with `zodOutputFormat(Wrapper).schema`, then pass only that plain object, not the helper with its `parse` function.
   - Why: SDK 1.3.0 parses every text block at `message_stop` and throws when one is not complete JSON. A mid-stream fallback (two text blocks) or a `max_tokens` cut produces exactly that. The stream then rejects after items were shown, and the final usage is lost. This was tested.
   - Why not tools: forced `tool_choice` returns a 400 on Opus 5.5, and `auto` does not guarantee a call. Tool definitions also sit at cache position 0 and add 286 system-prompt tokens. Their streamed input skips server validation once `eager_input_streaming` is on.
2. **Stream finished items, not characters.**
   - A 40-line string-aware scanner (`JsonArrayItems`) receives every `text_delta`, across text blocks. It returns each array item as soon as the item's closing brace arrives.
   - Each item is validated with Zod and code checks, then sent to the phone as one NDJSON line.
   - Delivered items survive a fallback, a `max_tokens` cut and the deadline.
3. **Five questions per call**, about the output of one summary part, which already needs `section.ts`'s timeout retry.
   - Each call covers one outline slide range.
   - Start the first call. Start the rest once its response has begun, so they read its cache entry.
   - Run at most two at a time, like `generate.ts`.
4. **One cache entry per feature.**
   - `system: [frozen feature prompt, lecture block]`, with the only explicit breakpoint on the lecture block.
   - Per-request text goes in the user turn.
   - Each feature has one fixed effort level and uses the 5-minute TTL.
   - All six members then share one entry per feature per lecture. Different output formats cannot share (§4).
5. **Effort:** questions `high`. Flashcards, chat and mnemonics `medium`, the default.
6. **One ledger.**
   - Every call appends to `study_usage`, the table `research-background.md` also proposes. That includes the outline call, which today records nothing.
   - Cost is priced per `usage.iterations` entry, at the serving model's rates.
   - `assertBudget` asks `study_spent()`.
   - Set `STUDY_MONTHLY_USD=33` (₪120).
7. **Generate once per lecture for the group, and only when asked.**
   - Mid estimates: about $0.52 per 20 questions and $0.24 per 40 cards.
   - With the summary under $1 (README), generating everything costs about $1.75 a lecture. About 19 lectures a month use up $33 before any chat.
   - The live quiz reuses stored questions, so it costs nothing.

## 2. Code patterns (`spec/_claude-proto/src/`)

`claude.ts` `run()`, shared by both helpers:

```ts
const stream = o.client.beta.messages.stream({
  model: "claude-opus-5-5",
  max_tokens: o.maxTokens,                       // thinking counts toward it
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  output_config: o.format ? { effort: o.effort, format: o.format } : { effort: o.effort },
  ...(o.cacheTail ? { cache_control: { type: "ephemeral" as const } } : {}), // chat only
  system: o.system,                              // deckSystem(featurePrompt, lectureBlock)
  messages: o.messages,
});
// message_start: model, usage · content_block_start "fallback": model = to.model
// text_delta: onText · message_delta: usage (cumulative) · finalMessage(): final usage
// deadline: setTimeout -> stream.abort(); a timeout keeps what was delivered (stop "timeout")
// finally: no final usage -> output floor = streamed chars / 2, estimated = true; ledger row
```

`generateItems`:

```ts
const { schema } = zodOutputFormat(o.wrapper);           // { questions: Question[] }
const scan = new JsonArrayItems();
const res = await run({ ...o, format: { type: "json_schema", schema },
  onText: (d) => { for (const raw of scan.push(d)) {
    const r = o.item.safeParse(raw);
    if (r.success && (!o.accept || o.accept(r.data))) { items.push(r.data); o.onItem(r.data, items.length - 1); }
    else rejected += 1;
  } } });
```

**Endpoint** (`api/study/questions.ts`):
- It reuses `textStream`. `onItem` saves the row and writes `{"i":n,"q":…}\n`; the stream ends with `{"done":true,…}`. Errors keep the `\u0000ERROR code` tail.
- The helpers take a client, callbacks and a ledger function, so `research-background.md`'s server queue can call them unchanged.

**`streamChat`:**
- History is plain `user`/`assistant` text turns, appended only. Thinking blocks are never replayed; removing all of them keeps preserved thinking valid.
- Top-level `cache_control: {type: "ephemeral"}` caches the growing conversation. The deck breakpoint stays the shared read point.
- No format is sent.

**Mnemonics:** `generateItems` with `MnemonicSet`, given only the paragraph and its tagged slides' lines, not the deck.

## 3. Schemas (`src/schemas.ts`)

```text
Option   { text: string, correct: boolean, why: string }
Question { case: boolean, part: int, stem: string, options: Option[5], takeaway: string, slides: int[] }
         + refine: exactly one correct, no empty text/why;  accept(): slides inside the call's range
Card     { part: int, front: string, back: string, extra: string, figure: string, slides: int[] }
Mnemonic { hook: string, decode: string }
```

- **All fields required, no nulls or unions.** The API limits a request to 24 optional and 16 union parameters, and nullable counts as a union.
- **No `enum`.** SDK 1.3.0's transform moves `enum` (and `minimum`/`maximum`) into the description, so the API does not enforce it. The printed schema shows `"kind":{"type":"string","description":"{enum: [...]}"}`. A boolean (`case`) is enforced.
- **Counts are code checks.** The API supports `minItems` 0 or 1 only, so it cannot enforce "5 options, one correct". The SDK writes `{maxItems: 5, minItems: 5}` into the description as a hint.
- **No reasoning or thinking field.** Such a field risks `reasoning_extraction` refusals, so `why` is one or two sentences.
- **`Card` matches the Anki research's fixed fields.** `figure` must be an id from a list the prompt gives.
- **Shuffle options on the server.** In the competitive quiz, clients must not read `correct` before the reveal.

## 4. Caching the lecture

A hit needs all of these to match:
- the workspace (the one server key, so all members share it);
- the model, tools (none), thinking config and top-level effort;
- the output format;
- byte-identical text up to the breakpoint.

The minimum cacheable prefix on Opus 5.5 is 512 tokens. The lifetime counts from each request's start.

| 12k-token deck | Uncached | 5-minute write | 1-hour write | Read |
|---|---|---|---|---|
| Cost | $0.048 | $0.060 | $0.096 | $0.0024 |

- **One `lectureBlock(lecture)`:** today's header plus `deckText`, used by every feature, so its bytes never differ.
- **TTL:** 5 minutes first. Move chat to `ttl: "1h"` only if the ledger shows a lecture's deck written more than about once an hour. A 1-hour write costs $0.036 more, and each avoided re-write saves $0.058.
- **No sharing across features.** The docs say changing `output_config.format` invalidates the prompt cache, so questions, flashcards and mnemonics each keep their own entry. Chat and the summary rarely run within 5 minutes of each other. Don't bend the tuned summary prompt for sharing.
- **The summary may be missing its cache.** Its deck sits in the user turn and its parts add pictures. The docs list images "anywhere in the prompt" as invalidating the message-level cache. Run the §8 query first. If parts with pictures show no cache reads, move the deck into `system` after `SUMMARY_SYSTEM`.
- **Fixed effort per feature.** The summary's medium-effort timeout retry already writes a fresh entry. Per-message effort (beta `mid-conversation-output-config-2026-07-01`) avoids that if needed.
- **Later blocks:** past exams go before the deck and transcripts after it, each with its own breakpoint (at most 4).

## 5. Effort

- **Docs:**
  - Opus 5.5 defaults to `medium`, and thinking cannot be turned off.
  - Thinking tokens bill as output and count toward `max_tokens`.
  - Grammars don't constrain thinking.
- **Proposed:** `high` for questions (distractors and explanations are the hard part); `medium` for the rest.
- **To settle it:** agent tests can't vary effort. Run one live sweep with Yoad's key: three levels on two lectures, about $5.

## 6. Cost per use (40 slides, deck 12k tokens)

| Use | low | **mid** | high |
|---|---|---|---|
| 20 questions (4 calls of 5, `high`) | $0.35 | **$0.52** | $0.81 |
| 40 flashcards (2 calls of 20, `medium`) | $0.18 | **$0.24** | $0.33 |
| 1 chat answer, deck cached | $0.014 | **$0.030** | $0.071 |
| 1 chat answer, cold deck | $0.075 | **$0.091** | $0.133 |
| 1 mnemonic (no deck) | $0.013 | **$0.024** | $0.049 |

Prices: $4 input, $5 5-minute write, $8 1-hour write, $0.20 read, $20 output, per million tokens.

Assumptions (`test/estimate.mjs`):

| Assumption | Mid value (low–high) | Basis |
|---|---|---|
| Characters per token, Hebrew–English mix | 2.5 (3.5–2.0) | Not measured: no tokenizer here |
| Characters per word | 6.5 | Measured on the test summary |
| JSON per question | ~1,780 characters | Estimate |
| Thinking at `high` | 50% of output (25–100%) | Estimate |
| Thinking per chat answer | 1,000 tokens (300–3,000) | Estimate |
| Format overhead per call | 600 tokens | Estimate |

Output is 80–90% of every cost. Shorter `why`s are the main lever: one sentence cuts a question set by about a third. The real 38-slide deck is 15,214 characters, so 12k tokens is likely high.

## 7. Budget and ledger

**Gaps today, from the code:**
- `outline.ts` records nothing.
- A rewrite overwrites `study_sections.usage`.
- Re-outlining or deleting a lecture deletes the parts, and their spend with them.
- Any member can zero `usage`.
- `usageCostUsd` prices only the top-level usage, which after a fallback covers just the serving attempt, at Opus 5.5 rates.
- A 1-hour write would be priced at $5 instead of $8.

**Design (`sql/ledger.sql`, tested):**
- **Table:** `study_usage(group_id, lecture_id on delete set null, kind, model, usage, cost_usd ≥ 0, estimated, created_by on delete set null, created_at)`.
- **Grants and RLS:** members may only INSERT (column grants, plus RLS: member of the group, lecture in the group). There is no SELECT, UPDATE or DELETE.
- **`study_spent(p_group)`:** a security definer function that returns this UTC month's sum to members only.
- **Seed:** filled once from `study_sections` while the ledger is empty.
- **Pricing (`src/cost.ts`):** each iteration is priced at its model's rates; an unlisted model at Opus 5 rates. 5-minute and 1-hour writes come from `cache_creation`.
- **Writes:** every call writes in `finally`. A stopped stream records a floor with `estimated=true`.
- **Optional:** a per-member cap on chat and mnemonics.

## 8. Testing (same methods as today)

- **SQL:** `ledger-test-pre.sql`, then `ledger.sql` twice, then `ledger-test-post.sql`, after stubs, board and study. Ten checks:
  - the seed is counted once;
  - a member can add, but cannot read, update or delete;
  - a negative cost is refused;
  - an outsider is refused;
  - last month's rows don't count;
  - a deleted lecture keeps its spend.

  Port them to `supabase/tests/study.sql`.
- **TypeScript:** `npm run build` plus `node dist/test/run.js`, 26 checks:
  - the scanner: 300 random chunkings, cuts, malformed items;
  - pricing;
  - the exact schema sent;
  - the helpers against SDK 1.3.0 via `new Anthropic({ fetch, maxRetries: 0 })`: a mid-JSON fallback, `max_tokens`, the deadline, and request shapes.

  `pretty.mjs` adds a 27th check.
- **E2E:** endpoints keep `textStream`'s protocol (U+200B first byte, NDJSON, `\u0000ERROR code`), so Playwright route mocks stay as they are.
- **Quality:** agents answer each exported prompt with the deck and schema pasted in. A judge checks for one correct option, same-lecture distractors, a faithful `why`, right tags and the Hebrew style.
- **Live (Yoad, read-only, Supabase SQL editor):** gives the real characters per token, the thinking share, and whether parts with pictures read the cache.

  ```sql
  select idx, length(markdown) chars, usage->>'output_tokens' out_tok,
    usage->'output_tokens_details'->>'thinking_tokens' think,
    usage->>'cache_read_input_tokens' cread, usage->>'cache_creation_input_tokens' cwrite
  from study_sections where status = 'ready' order by updated_at desc limit 30;
  ```

## 9. Evidence

**Anthropic docs** (fetched 2026-11-14; copies in `spec/_claude-docs/`):
- https://platform.claude.com/docs/en/about-claude/pricing
  - Opus 5.5 rates: $4, $5, $8, $0.20, $20.
  - Tool-use prompt: 286 tokens.
  - Batch: $2/$10.
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
  - An injected system prompt; "Changing the `output_config.format` parameter invalidates any prompt cache".
  - Grammars are cached for 24 h.
  - Limits: 24 optional and 16 union parameters; `minItems` 0 or 1 only.
  - Enum casing is not guaranteed, and a reasoning field risks `reasoning_extraction`.
  - Streaming works and grammars skip thinking; prefill is incompatible.
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
  - A 512-token minimum and lifetime from the request start.
  - Workspace isolation and exact matching.
  - The invalidation table (images, effort, thinking).
  - An entry is readable "after the first response starts".
  - The 1-hour TTL.
- https://platform.claude.com/docs/en/build-with-claude/thinking
  - Thinking bills as output.
  - "Treat any thinking or top-level effort change as invalidating the whole cache".
- https://platform.claude.com/docs/en/build-with-claude/effort: Opus 5.5 defaults to `medium`, with thinking always on.
- https://platform.claude.com/docs/en/build-with-claude/effort-per-message: the beta header and models.
- https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
  - Default routing, the `fallback` block, and "continues from the partial output".
  - `usage.iterations` is the billing record.
  - `bio` declines are billed even before output.
  - Sticky routing lasts about 1 h.
- https://platform.claude.com/docs/en/build-with-claude/streaming: fallback blocks arrive whole, and `message_delta` usage is cumulative.
- https://platform.claude.com/docs/en/build-with-claude/batch-processing: 50% off, most batches within an hour, no `fallbacks`.

**Bundled skill docs:**
- `typescript/claude-api/tool-use.md`: forced `tool_choice` returns a 400 on Opus 5.5.
- `shared/tool-use-concepts.md`: eager input streaming drops validation.
- `shared/model-migration.md`, Opus 5.5 section: the `bio` classifier, and removing all thinking blocks keeps them valid.

**SDK 1.3.0** (`node_modules/@anthropic-ai/sdk`):
- `resources/beta/messages/messages.d.ts`: `BetaOutputConfig{effort, format, task_budget}`, `BetaFallbacksParam`, top-level `cache_control`, and `BetaUsage.iterations`, `cache_creation` and `output_tokens_details.thinking_tokens`.
- `lib/BetaMessageStream.js`: parses at `message_stop`.
- `lib/beta-parser.js`: throws on an unparseable text block.
- `lib/transform-json-schema.js`: moves unhandled keys, `enum` included, into the description.

**Repo:** `api/study/*.ts`, `api/_lib/study.ts`, `src/study/lib/generate.ts`, `supabase/study-schema.sql`, README.

## 10. Risks and open questions

1. **JSON outputs and fallback.** The docs say a fallback "continues from the partial output", and also that prefill is incompatible with JSON outputs. How the two combine is undocumented. The scanner tolerates both: broken items are dropped, and the endpoint asks for the missing number again. This cannot be forced offline.
2. **The `bio` classifier** is new on Opus 5.5, and microbiology may trip it. Declines are billed, and sticky routing can move a lecture's later batches to the fallback model. Store `model` per set.
3. **Hebrew density and the thinking share are guesses.** Costs can move by ±50% until the §8 query is run.
4. **Enum demotion is SDK-version behaviour.** The schema test catches it on upgrade.
5. **The summary's picture-cache issue is unverified.** The §8 query settles it.
6. **Effort needs one live sweep.**
7. **Budget.** Automatic generation for every lecture exceeds ₪120 at about 19 lectures a month, so this is a product decision. The Batch API (50% off, no `fallbacks`, needs a poller) could suit pre-generation at upload later.
8. **Billing of aborted streams** is not documented in the pages read. The ledger records a flagged floor.
9. **Vercel limits** come from the repo, not from Vercel's docs.
