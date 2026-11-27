import type { ModelInfo } from "../../../shared/study/models.js";
import type { UsageLike } from "../budget.js";
import type { RunOpts } from "../claude.js";
import { keyOf, scrub, type KeyedProvider } from "./keys.js";
import { requestUsd, turnsOf, type Fetch, type Turn } from "./request.js";
import { sseEvents, type SseEvent } from "./sse.js";
import { settled } from "./usage.js";
import type { AdapterOutcome } from "./index.js";

/* ── The streaming call every adapter shares (design-models §7.4, D4, D8) ──
 *
 * As claude.ts's runAnthropic: a deadline (stopAt) and the phone's signal
 * abort the call and keep what arrived; text goes to o.onText as it streams;
 * the reservation is settled once in `finally` through o.ledger (at no less
 * than the reservation when the provider began but its final usage never
 * came, D4). It never throws: a failure is stop "error" with its `cause`
 * (no key in its words), so run() can rerun on the default before any text
 * (D8). A 429 or 5xx before the stream is tried once more, if there is time.
 */

let fetchImpl: Fetch | null = null;
/** For tests: the fetch the adapters use (null: the global one). */
export function setAdapterFetch(f: Fetch | null): void {
  fetchImpl = f;
}
const theFetch = (): Fetch => fetchImpl ?? globalThis.fetch;

/** What an adapter's events report, one event at a time. */
export type Feed = {
  /** Visible text, in order. */
  text(delta: string): void;
  /** The provider's usage, in Anthropic's shape; final: its count for the whole call. */
  usage(u: UsageLike, final: boolean): void;
  /** What the provider says the call cost, before its fee (OpenRouter's
   *  usage.cost, in credits): the call settles at no less (D16). */
  reported(usd: number): void;
  /** How the call ended: end_turn, max_tokens, refusal, error. */
  stop(reason: string): void;
  /** The provider's error inside the stream. */
  fail(message: string): void;
  /** The end reported so far (a refusal part before the end, say). */
  stopped(): string | null;
  /** Characters of text so far. */
  chars(): number;
};

export type Adapter = {
  provider: KeyedProvider;
  /** The request to send (the key goes only into headers). */
  request(o: RunOpts, m: ModelInfo, turns: Turn[], key: string): { url: string; headers: Record<string, string>; body: unknown };
  /** One event of the stream. */
  read(ev: SseEvent, feed: Feed): void;
  /** An HTTP error body's message. */
  errorOf(body: string): string;
};

/** Statuses worth one more try before the stream (rate limit, overload). */
const RETRY = new Set([429, 500, 502, 503, 504, 529]);
export const RETRY_MS = 1_500;
/** No second try with less than this much time before the deadline. */
const RETRY_ROOM_MS = 20_000;

export async function streamCall(a: Adapter, o: RunOpts, m: ModelInfo): Promise<AdapterOutcome> {
  const key = keyOf(a.provider);
  const ctl = new AbortController();
  let timedOut = false;
  let chars = 0;
  let stop: string | null = null;
  let cause: unknown;
  let usage: UsageLike | null = null;
  let final = false;
  let reportedUsd: number | null = null;
  let opened = false;
  let sent = false;
  let started = false;
  let failed: string | null = null;
  let cost = 0;
  let estimated = true;
  const timer = setTimeout(
    () => {
      timedOut = true;
      ctl.abort();
    },
    Math.max(5_000, o.stopAt - Date.now()),
  );
  const onAbort = () => ctl.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  if (o.signal?.aborted) ctl.abort();
  const feed: Feed = {
    text(delta) {
      if (!delta) return;
      chars += delta.length;
      o.onText(delta, m.id);
    },
    usage(u, isFinal) {
      usage = u;
      if (isFinal) final = true;
    },
    reported(usd) {
      if (Number.isFinite(usd) && usd > 0) reportedUsd = Math.max(reportedUsd ?? 0, usd);
    },
    stop(reason) {
      stop = reason;
    },
    fail(message) {
      failed = message;
    },
    stopped: () => stop,
    chars: () => chars,
  };
  try {
    if (!key) throw new Error(`${a.provider}: no key`);
    const turns = await turnsOf(o.messages, { fetch: theFetch(), signal: ctl.signal });
    const req = a.request(o, m, turns, key);
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      sent = true;
      res = await theFetch()(req.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...req.headers },
        body: JSON.stringify(req.body),
        signal: ctl.signal,
        // Never followed: a redirect would carry a key header (x-goog-api-key) to another host.
        redirect: "error",
      });
      if (res.ok || attempt === 1 || !RETRY.has(res.status) || o.stopAt - Date.now() < RETRY_ROOM_MS) break;
      await res.body?.cancel().catch(() => undefined);
      await new Promise((r) => setTimeout(r, RETRY_MS));
      if (ctl.signal.aborted) break;
    }
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => "") : "";
      throw new Error(`${a.provider} ${res?.status ?? "?"}: ${scrub(a.errorOf(body), key)}`);
    }
    if (!res.body) throw new Error(`${a.provider}: no body`);
    opened = true; // from here the provider may bill, so an early end settles at the reservation (D4)
    for await (const ev of sseEvents(res.body)) {
      if (!started) {
        started = true;
        o.onStart?.();
      }
      a.read(ev, feed);
      if (failed) break;
    }
    if (failed) throw new Error(`${a.provider}: ${scrub(failed, key)}`);
    if (stop === null) throw new Error(`${a.provider}: the stream ended before the model finished`);
  } catch (e) {
    // Stopped (the deadline, the caller) after the request went out: the
    // provider may already bill its input and thinking, so it settles at the
    // reservation, as a stream that opened (D4).
    if ((timedOut || o.signal?.aborted) && sent) opened = true;
    if (timedOut) stop = "timeout";
    else if (o.signal?.aborted) stop = "aborted";
    else {
      stop = "error";
      cause = e instanceof Error ? new Error(scrub(e.message, key)) : new Error(`${a.provider}: failed`);
    }
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
    // A loop left early (an error in the stream) closes the connection now.
    if (!ctl.signal.aborted) ctl.abort();
    const s = settled({ m, usage, final, chars, opened, floorUsd: o.reservedUsd ?? requestUsd(o, m), reportedUsd });
    cost = s.costUsd;
    estimated = s.estimated;
    await o.ledger({ kind: o.kind, ref: o.ref, model: m.id, usage: s.usage, costUsd: cost, estimated }).catch(() => undefined);
  }
  return { stop, model: m.id, timedOut, costUsd: cost, estimated, chars, cause };
}
