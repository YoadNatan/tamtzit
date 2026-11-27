import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod/v4";
import { DEFAULT_MODEL, modelInfo, type ModelInfo } from "../../shared/study/models.js";
import { costUsd, estimateUsd, floorUsage, imageTokens, settle, type UsageLike } from "./budget.js";
import { adapterFor } from "./llm/index.js";
import { HttpError, MODEL } from "./study.js";

/* ── Calling Claude: the one helper every feature uses (spec §2.6, §4.2) ──
 *
 * Same conventions as the summary's section.ts: the beta stream with
 * server-side fallback, an explicit effort, a deadline before Vercel ends the
 * function, and usage kept up to date from the stream's events, so a stopped
 * call still reaches the ledger. The call's reservation is settled in
 * `finally` through `ledger` (settleFor), also when it failed or stopped.
 *
 * Structured output is JSON in the text (output_config.format with a plain
 * json_schema), never the SDK's parse helper: SDK 1.3.0 parses every text
 * block at message_stop and throws on one that is not complete JSON, which a
 * mid-stream fallback (two text blocks) or a max_tokens cut produces. Items
 * are scanned from the stream as each one closes (JsonArrayItems).
 */

export { MODEL };
export type Effort = "low" | "medium" | "high";
export type Spend = { kind: string; ref?: string | null; model: string; usage: UsageLike | null; costUsd: number; estimated: boolean };
/** Settles the call's reservation (settleFor). */
export type Ledger = (s: Spend) => Promise<unknown>;
/** D8's own reservation for the rerun on the default model: reserves
 *  `estimateUsd` (the rerun's worst case, worked out by run()) and returns
 *  the ledger that settles it (routes.ts's fallbackReserve). A refusal is
 *  thrown, as the op's own reservations are. */
export type FallbackReserve = (estimateUsd: number) => Promise<Ledger>;
export type RunOpts = {
  client: Anthropic;
  kind: string;
  ref?: string | null;
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  effort: Effort;
  maxTokens: number;
  /** Epoch ms: the call is aborted then, before Vercel ends the function. */
  stopAt: number;
  format?: { type: "json_schema"; schema: Record<string, unknown> };
  /** Top-level automatic caching (a growing conversation). */
  cacheTail?: boolean;
  ledger: Ledger;
  /** message_start: the next part may start now and read this call's cache entry. */
  onStart?: () => void;
  onText: (delta: string, servedBy: string) => void;
  /** The phone closed the stream: stop the model too. */
  signal?: AbortSignal;
  /* ── Routing (design-models §7.4, a documented signature change) ── */
  /** The model the call's route key resolved to (routes.ts's modelFor);
   *  left out: DEFAULT_MODEL, and the request is exactly today's. */
  model?: string;
  /** Anthropic's server-side fallback, sent only where the model has it
   *  (the registry's serverFallback); false: never (comparisons, D15). */
  fallbacks?: boolean;
  /** D8: a model without server-side fallback that refuses, or fails,
   *  before its first text is run once more on DEFAULT_MODEL under its own
   *  reservation (reserveFallback). On by default; false in comparisons. */
  appFallback?: boolean;
  reserveFallback?: FallbackReserve;
  /** The call's reservation: the least a non-Anthropic call that ends
   *  without its final usage settles at (D4; the adapters). */
  reservedUsd?: number;
};
export type RunResult = {
  stop: string | null;
  model: string;
  timedOut: boolean;
  costUsd: number;
  estimated: boolean;
  /** Characters of text that streamed. */
  chars: number;
};
/** A call's end inside run(): `cause` is the error of a call that failed
 *  before its first text, kept for D8 and never in RunResult. */
type Outcome = RunResult & { cause?: unknown };

/** Copies the counts that are present: message_delta omits or nulls the ones that don't apply. */
function merge(into: UsageLike | null, from: object): UsageLike {
  const out: Record<string, unknown> = { ...(into ?? {}) };
  for (const [k, v] of Object.entries(from)) if (v != null) out[k] = v;
  return out as UsageLike;
}

/** The registry's entry for a call's model (the default when none is given). */
function infoOf(model: string | undefined): ModelInfo {
  const m = modelInfo(model ?? DEFAULT_MODEL);
  if (!m) throw new HttpError(500, `unknown model ${String(model).slice(0, 80)}`);
  return m;
}

/** Whether a call that refused or failed before its first text is run again on the default (D8). */
function appFallbackOn(o: RunOpts, m: ModelInfo): boolean {
  return o.appFallback !== false && !m.serverFallback && m.id !== DEFAULT_MODEL && typeof o.reserveFallback === "function";
}

/** The worst case of the request on `model`, as a reservation counts it:
 *  every text block's characters, each picture at the largest size the app
 *  stores, all of max_tokens. D8's rerun reserves this. */
export function requestEstimate(model: string, o: Pick<RunOpts, "system" | "messages" | "maxTokens" | "format">): number {
  let chars = o.system.reduce((n, b) => n + b.text.length, 0) + (o.format ? JSON.stringify(o.format.schema).length : 0);
  let pictures = 0;
  for (const msg of o.messages) {
    if (typeof msg.content === "string") chars += msg.content.length;
    else
      for (const b of msg.content ?? []) {
        if (b.type === "text") chars += b.text.length;
        else if (b.type === "image") pictures += 1;
      }
  }
  return estimateUsd(model, chars, o.maxTokens, pictures * imageTokens());
}

/** A Claude model's fields for a call made outside run(), the outline's
 *  messages.parse and the ask route's messages.create (D5: they only take a
 *  model): its API id, max_tokens within its floor and cap, the effort
 *  where it has effort control, and whether it has server-side fallback.
 *  Left out, the default, so those requests stay exactly today's. A model
 *  that is not Claude's is the default (their keys take Claude only). */
export function claudeFields(model: string | undefined, maxTokens: number, effort: Effort): { model: string; max_tokens: number; effort?: Effort; serverFallback: boolean } {
  const found = modelInfo(model ?? DEFAULT_MODEL);
  const m = found && found.provider === "anthropic" ? found : infoOf(DEFAULT_MODEL);
  return {
    model: m.apiId,
    max_tokens: Math.min(m.maxOut, Math.max(maxTokens, m.minMaxTokens ?? 0)),
    ...(m.effort ? { effort: m.effort[effort] as Effort } : {}),
    serverFallback: m.serverFallback,
  };
}

/** One streamed call. Text arrives through onText with the model serving it
 *  at that moment (message_start's model, then a fallback block's). A timeout
 *  or a closed phone keeps what arrived; any other error is the caller's.
 *
 *  `model` picks the routed model (left out: DEFAULT_MODEL, today's request
 *  byte for byte). A Claude model is called here; any other provider through
 *  its adapter (llm/index.ts). D8: a model with no server-side fallback that
 *  refuses or fails before its first text is run once more on the default,
 *  under the reservation reserveFallback makes. */
export async function run(o: RunOpts): Promise<RunResult> {
  const m = infoOf(o.model);
  let started = false;
  const onStart = o.onStart
    ? () => {
        if (started) return;
        started = true;
        o.onStart?.();
      }
    : undefined;
  const first = m.provider === "anthropic" ? await runAnthropic({ ...o, onStart }, m) : await runAdapter({ ...o, onStart }, m);
  if (first.chars === 0 && (first.stop === "refusal" || first.stop === "error") && appFallbackOn(o, m)) {
    const def = infoOf(DEFAULT_MODEL);
    const ledger = await o.reserveFallback!(requestEstimate(def.id, o));
    const again = await runAnthropic({ ...o, onStart, ledger, model: def.id, reserveFallback: undefined, appFallback: false }, def);
    return result(again);
  }
  if (first.stop === "error") throw first.cause;
  return result(first);
}

const result = (r: Outcome): RunResult => ({ stop: r.stop, model: r.model, timedOut: r.timedOut, costUsd: r.costUsd, estimated: r.estimated, chars: r.chars });

/** A Claude model: today's call, with the routed model's id, its effort
 *  control, its output floor and cap, and server-side fallback only where
 *  the model has it. With D8 on, an error before the first text is
 *  returned (stop "error") instead of thrown. */
async function runAnthropic(o: RunOpts, m: ModelInfo): Promise<Outcome> {
  let model: string = m.apiId;
  let usage: UsageLike | null = null;
  let finalUsage = false;
  let chars = 0;
  let stop: string | null = null;
  let timedOut = false;
  let started = false;
  let cost = 0;
  let cause: unknown;
  const serverFallback = m.serverFallback && o.fallbacks !== false;
  const effort = m.effort ? (m.effort[o.effort] as Effort) : undefined;
  const outputConfig = effort !== undefined ? (o.format ? { effort, format: o.format } : { effort }) : o.format ? { format: o.format } : undefined;
  const stream = o.client.beta.messages.stream({
    model: m.apiId,
    max_tokens: Math.min(m.maxOut, Math.max(o.maxTokens, m.minMaxTokens ?? 0)),
    ...(serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    ...(outputConfig ? { output_config: outputConfig } : {}),
    ...(o.cacheTail ? { cache_control: { type: "ephemeral" as const } } : {}),
    system: o.system,
    messages: o.messages,
  });
  const timer = setTimeout(
    () => {
      timedOut = true;
      stream.abort();
    },
    Math.max(5_000, o.stopAt - Date.now()),
  );
  const onAbort = () => stream.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  if (o.signal?.aborted) stream.abort();
  try {
    for await (const ev of stream) {
      if (ev.type === "message_start") {
        model = ev.message.model;
        usage = merge(null, ev.message.usage);
        if (!started) {
          started = true;
          o.onStart?.();
        }
      } else if (ev.type === "message_delta") {
        usage = merge(usage, ev.usage);
        finalUsage = true;
      } else if (ev.type === "content_block_start" && ev.content_block.type === "fallback") {
        model = ev.content_block.to.model; // the rest is written by the fallback model
      } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        chars += ev.delta.text.length;
        o.onText(ev.delta.text, model);
      }
    }
    const final = await stream.finalMessage();
    model = final.model;
    usage = merge(null, final.usage);
    finalUsage = true;
    stop = final.stop_reason;
  } catch (e) {
    if (!timedOut && !o.signal?.aborted) {
      // D8: nothing streamed yet, so the default may answer instead.
      if (chars > 0 || !appFallbackOn(o, m)) throw e;
      stop = "error";
      cause = e;
    } else stop = timedOut ? "timeout" : "aborted"; // a timeout or a closed phone keeps what arrived
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
    // A stopped stream never got its final usage: at least the text that arrived counts.
    const settled = finalUsage ? usage : floorUsage(usage, chars);
    cost = costUsd(settled, model);
    await o
      .ledger({ kind: o.kind, ref: o.ref, model, usage: settled, costUsd: cost, estimated: !finalUsage })
      .catch(() => undefined);
  }
  return { stop, model, timedOut, costUsd: cost, estimated: !finalUsage, chars, cause };
}

/** Any other provider: its adapter (llm/index.ts), which streams, settles
 *  through o.ledger in its own `finally` and never throws (stop "error"
 *  with its cause). A provider without an adapter in this build settles $0
 *  and fails before any text, so D8 can still answer on the default. */
async function runAdapter(o: RunOpts, m: ModelInfo): Promise<Outcome> {
  const adapter = adapterFor(m.provider);
  if (adapter) return adapter(o, m);
  await o.ledger({ kind: o.kind, ref: o.ref, model: m.id, usage: null, costUsd: 0, estimated: false }).catch(() => undefined);
  return { stop: "error", model: m.id, timedOut: false, costUsd: 0, estimated: false, chars: 0, cause: new Error(`no adapter for ${m.provider}`) };
}

/** Structured generation: streams one {"<list>": [...]} document and hands
 *  over each item as soon as it is complete and valid, with the model that
 *  wrote it. Malformed or refused items count as rejected. The plain
 *  json_schema goes to the API, never a parse helper. */
export async function generateItems<W extends z.ZodType, I extends z.ZodType>(
  o: Omit<RunOpts, "format" | "onText" | "cacheTail"> & {
    wrapper: W; // z.object({ <list>: z.array(item) }), used only for the JSON schema
    item: I; // validates one item
    accept?: (item: z.infer<I>) => boolean; // checks no schema can express
    onItem: (item: z.infer<I>, index: number, servedBy: string) => void;
  },
): Promise<RunResult & { items: z.infer<I>[]; rejected: number }> {
  const { wrapper, item, accept, onItem, ...rest } = o;
  const schema = cleanSchema(zodOutputFormat(wrapper).schema as Record<string, unknown>);
  const items: z.infer<I>[] = [];
  let rejected = 0;
  const scan = new JsonArrayItems();
  const res = await run({
    ...rest,
    format: { type: "json_schema", schema },
    onText: (delta, servedBy) => {
      for (const raw of scan.push(delta)) {
        const r = item.safeParse(raw);
        if (r.success && (!accept || accept(r.data))) {
          items.push(r.data);
          onItem(r.data, items.length - 1, servedBy);
        } else rejected += 1;
      }
    },
  });
  return { ...res, items, rejected: rejected + scan.bad };
}

/** Plain text (לשאול): writes the deltas as they come and returns the text. */
export async function streamText(
  o: Omit<RunOpts, "format" | "onText"> & { write: (delta: string) => void },
): Promise<RunResult & { text: string }> {
  const { write, ...rest } = o;
  let text = "";
  const res = await run({
    ...rest,
    onText: (delta) => {
      text += delta;
      write(delta);
    },
  });
  return { ...res, text };
}

/** zodOutputFormat(…).schema without the SDK's hints that say nothing: zod's
 *  safe-integer bounds on every .int() and the root "$schema". Types and
 *  required fields are untouched, so the grammar enforces exactly the same. */
export function cleanSchema<T>(schema: T): T {
  const NOISE = [/\s*\{minimum: -9007199254740991, maximum: 9007199254740991\}/g, /\s*\{\$schema: "[^"]*"\}/g];
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "description" && typeof v === "string") {
        const d = NOISE.reduce((s, re) => s.replace(re, ""), v).trim();
        if (d) out[k] = d;
      } else out[k] = walk(v);
    }
    return out;
  };
  return walk(schema) as T;
}

/** Pulls the items out of a streamed JSON document shaped {"<list>": [ {...}, {...} ]}
 *  while it is still being written. Feed it every text delta in order (across
 *  text blocks: after a mid-stream fallback the next model continues the same
 *  text). It is string-aware (quotes, escapes, braces inside strings, a
 *  backslash split across two deltas), keeps only the current item in memory,
 *  and never throws: an item that is not valid JSON is counted in `bad`. */
export class JsonArrayItems {
  private stack: string[] = [];
  private inString = false;
  private escaped = false;
  private capturing = false;
  private buf = "";
  bad = 0;

  push(chunk: string): unknown[] {
    const out: unknown[] = [];
    for (const ch of chunk) {
      if (this.inString) {
        if (this.capturing) this.buf += ch;
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') this.inString = false;
        continue;
      }
      if (ch === "{" || ch === "[") {
        this.stack.push(ch);
        // depth 1 = the wrapper object, 2 = its array, 3 = one item
        if (ch === "{" && this.stack.length === 3 && this.stack[0] === "{" && this.stack[1] === "[") {
          this.capturing = true;
          this.buf = "";
        }
      }
      if (this.capturing) this.buf += ch;
      if (ch === '"') {
        this.inString = true;
      } else if (ch === "}" || ch === "]") {
        if (this.capturing && this.stack.length === 3) {
          this.capturing = false;
          try {
            out.push(JSON.parse(this.buf));
          } catch {
            this.bad += 1;
          }
          this.buf = "";
        }
        this.stack.pop();
      }
    }
    return out;
  }
}

/** The ledger of one call: settles reservation `reservationId` with the call's
 *  real cost. `onFail` counts a settle that failed (the op's `done` line
 *  reports them as `unsettled`). */
export function settleFor(sb: SupabaseClient, reservationId: number, onFail?: () => void): Ledger {
  return async (s) => {
    const ok = await settle(sb, reservationId, { model: s.model, usage: s.usage });
    if (!ok) onFail?.();
    return ok;
  };
}
