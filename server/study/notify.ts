import { getDeadline, waitUntil } from "@vercel/functions"; // 3.10.5, pinned
import { utf8 } from "../../shared/study/b64url.js";
import { render } from "../../shared/study/notifyCopy.js";
import { routeQuery } from "../../shared/study/notifyRoute.js";
import { send, sha256b64, vapidFromEnv, vapidPairOk, type Sub, type Urgency, type Vapid } from "./push.js";
import { assertSchema, errorText, HttpError, json, keyed, serverClient } from "./study.js";

/* ── Sending the pushes (notifications, section R; POST /api/study/work {notify:true}) ──
 * docs/study/DECISIONS-2026-11-26.md. pg_cron's study-notify job (and a
 * notice that cannot wait, such as a group quiz or a test) kicks
 * /api/study/work with {notify:true} and the server key. One kick:
 *
 *   1. section R must be loaded (503 "schema" otherwise);
 *   2. the VAPID keys must be set and be a pair: otherwise 200
 *      {claimed:false, reason:"vapid"} and nothing is claimed, so the kicks
 *      without a claim pile up and section R's breaker stops them;
 *   3. study_notify_claim hands over up to 20 due pushes with their devices
 *      (200 {claimed:false} when there is none and none is due within 20 s);
 *   4. the answer is 202 at once, and the pushes go out in waitUntil(): 8
 *      devices at a time, study_notify_done after each batch, no batch
 *      started in the last 30 s before the invocation's deadline (a push
 *      left claimed goes back to due when its 180-s lease runs out). When the
 *      claim says another push is due within 20 s (a quiz held 15 s), it
 *      waits that long and claims again, at most 3 more times.
 *
 * Every payload is Declarative Web Push (iOS 18.4+ and Safari 18.5 show it
 * without running the service worker; public/sw.js reads the same JSON):
 * the notice's words from shared/study/notifyCopy.ts for the lock screen,
 * and its link with nt=<id>, which the app marks seen. Logs carry notice
 * ids, device ids and statuses only: never an endpoint, a key, args or words. */

export type ClaimedNotice = {
  id: number;
  kind: string;
  cat: string;
  args: Record<string, unknown>;
  route: Record<string, unknown>;
  count: number;
  dedupe: string;
  expires_at: string;
  silent: boolean;
};
export type Claimed = { notice: ClaimedNotice; subs: Array<Sub & { id: number }> };
export type Claim = { rows: Claimed[]; more: boolean; wait_ms: number | null };
export type Result = { notice: number; sub: number; status: number; retry_after?: number };

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
/** What a test replaces: the RPCs, the push services, the clock and the invocation. */
export type NotifyDeps = {
  rpc?: Rpc;
  checkSchema?: () => Promise<void>;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  deadline?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitUntil?: (p: Promise<unknown>) => void;
};

/** Pushes claimed at once, devices per batch, claims after the first, the most the claim may ask to wait. */
export const CLAIM_LIMIT = 20;
export const BATCH = 8;
export const RECLAIMS = 3;
const MAX_WAIT_MS = 20_000;
/** No batch starts this close to the invocation's deadline. */
export const STOP_BEFORE_MS = 30_000;
/** A payload's most bytes (the push services allow about 4 KB, encrypted). */
export const PAYLOAD_MAX = 3072;

/** Urgency by category: something live and the security notice now; the rest as the phone sees fit. */
const URGENCY: Record<string, Urgency> = { live: "high", security: "high", mine: "normal", digest: "low" };

/** The notice's link: its screen with nt=<id> (URLSearchParams, so the screen's own keys stay as they were). */
export function withMarker(origin: string, route: unknown, id: number): string {
  const u = new URL(routeQuery(route), origin);
  u.searchParams.set("nt", String(id));
  return u.href;
}

/** The Declarative Web Push payload of one notice (the same for each of its devices). */
export function dwp(row: Claimed, origin: string, tag: string, now = Date.now()): string {
  const n = row.notice;
  const { title, body } = render(n.kind, n.args, n.count, "lock", now);
  const make = (navigate: string) =>
    JSON.stringify({
      web_push: 8030,
      notification: { title, body, navigate, lang: "he", dir: "rtl", tag, silent: n.silent === true },
      mutable: false,
      n: n.id,
    });
  let out = make(withMarker(origin, n.route, n.id));
  // A route too long for a push opens the home instead (still marked seen).
  if (utf8(out).length > PAYLOAD_MAX) out = make(withMarker(origin, { v: "today" }, n.id));
  if (utf8(out).length > PAYLOAD_MAX) throw new Error("payload");
  return out;
}

/** The push service's topic and the notification's tag: 22 characters of sha256(dedupe). */
export async function topicOf(dedupe: string): Promise<string> {
  return (await sha256b64(dedupe)).slice(0, 22);
}

/** Seconds the push service may keep it: until the notice expires, at least a minute. */
export function ttlOf(expiresAt: string, now: number): number {
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) ? Math.max(60, Math.floor((at - now) / 1000)) : 60;
}

/** Whole notices into batches of about 8 devices; a notice's devices are never
 *  split (its result is settled in one study_notify_done). */
export function batches(rows: Claimed[], size = BATCH): Claimed[][] {
  const out: Claimed[][] = [];
  let cur: Claimed[] = [];
  let n = 0;
  for (const r of rows) {
    if (cur.length && n + r.subs.length > size) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(r);
    n += r.subs.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A claim's answer read defensively (it comes from the database). */
export function readClaim(x: unknown): Claim {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const rows = Array.isArray(o.rows) ? (o.rows as Claimed[]).filter((r) => r && r.notice && Number.isSafeInteger(r.notice.id) && Array.isArray(r.subs)) : [];
  const wait = typeof o.wait_ms === "number" && Number.isFinite(o.wait_ms) ? o.wait_ms : null;
  return { rows, more: o.more === true, wait_ms: wait };
}

function defaultRpc(): Rpc {
  const sb = serverClient();
  return async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new HttpError(500, error.message);
    return data;
  };
}

let pairChecked: { key: string; ok: boolean } | null = null;
/** The keys from the environment when they are a pair (checked once per instance and keys). */
async function vapidReady(env: Record<string, string | undefined>): Promise<Vapid | null> {
  const v = vapidFromEnv(env);
  if (!v) return null;
  const key = `${v.publicKey} ${v.privateKey}`;
  if (pairChecked?.key !== key) pairChecked = { key, ok: await vapidPairOk(v) };
  return pairChecked.ok ? v : null;
}

/** One kick: the checks and the first claim; the sending goes on in waitUntil. */
export async function notifyStep(origin: string, deps: NotifyDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const rpc = deps.rpc ?? defaultRpc();
  try {
    await (deps.checkSchema ?? (() => assertSchema(serverClient(), "notify")))();
  } catch (e) {
    return json(e instanceof HttpError && e.status === 503 ? 503 : 500, { error: errorText(e) });
  }
  const vapid = await vapidReady(env);
  if (!vapid) return json(200, { claimed: false, reason: "vapid" });
  const claim = () => rpc("study_notify_claim", keyed({ p_limit: CLAIM_LIMIT })).then(readClaim);
  let first: Claim;
  try {
    first = await claim();
  } catch (e) {
    return json(500, { error: errorText(e) });
  }
  if (!first.rows.length && !first.more) return json(200, { claimed: false });
  const now = deps.now ?? Date.now;
  const deadline = deps.deadline ?? getDeadline()?.getTime() ?? now() + 300_000;
  const work = notifyRun(first, { rpc, claim, vapid, origin, deadline, now, sleep: deps.sleep, fetchImpl: deps.fetchImpl }).catch((e) =>
    console.error(`study notify: ${errorText(e)}`),
  );
  (deps.waitUntil ?? waitUntil)(work);
  return json(202, { claimed: true, n: first.rows.length });
}

type RunOpts = {
  rpc: Rpc;
  claim: () => Promise<Claim>;
  vapid: Vapid;
  origin: string;
  deadline: number;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
};

/** What a run did, for the tests. */
export type RunReport = { claims: number; batches: number; sent: number; stopped: boolean };

/** Sends the claimed pushes, batch by batch, and claims again while more are due soon. */
export async function notifyRun(first: Claim, o: RunOpts): Promise<RunReport> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const stopAt = o.deadline - STOP_BEFORE_MS;
  const report: RunReport = { claims: 1, batches: 0, sent: 0, stopped: false };
  let r = first;
  for (;;) {
    for (const batch of batches(r.rows)) {
      if (o.now() > stopAt) {
        report.stopped = true;
        break;
      }
      const results = await sendBatch(batch, o);
      report.batches++;
      report.sent += results.length;
      try {
        await o.rpc("study_notify_done", keyed({ p_results: results }));
      } catch (e) {
        // Left 'sending': the lease runs out and the push is claimed again.
        console.error(`study notify done: ${errorText(e)}`);
      }
    }
    if (report.stopped || !r.more || report.claims > RECLAIMS) break;
    const wait = Math.min(Math.max(r.wait_ms ?? 0, 0), MAX_WAIT_MS) + 250;
    if (o.now() + wait > stopAt) break;
    await sleep(wait);
    try {
      r = await o.claim();
    } catch (e) {
      console.error(`study notify claim: ${errorText(e)}`);
      break;
    }
    report.claims++;
  }
  return report;
}

/** One batch: every device of these notices at once; each answer as section R's done() reads it. */
async function sendBatch(batch: Claimed[], o: RunOpts): Promise<Result[]> {
  const jobs: Array<Promise<Result>> = [];
  for (const row of batch) {
    const n = row.notice;
    let payload: string | null = null;
    let topic = "";
    try {
      topic = await topicOf(String(n.dedupe ?? n.id));
      payload = dwp(row, o.origin, topic); // wall-clock time: the words say "today" or "yesterday"
    } catch {
      payload = null;
    }
    for (const s of row.subs) {
      jobs.push(
        (async (): Promise<Result> => {
          const r = payload === null ? { status: 413 } : await send(s, payload, { ttl: ttlOf(n.expires_at, Date.now()), urgency: URGENCY[n.cat] ?? "normal", topic, vapid: o.vapid, fetchImpl: o.fetchImpl });
          if (r.status < 200 || r.status > 299) console.error(`study notify ${n.id} ${s.id} ${r.status}`);
          const out: Result = { notice: n.id, sub: s.id, status: r.status };
          if ("retryAfter" in r && typeof r.retryAfter === "number") out.retry_after = r.retryAfter;
          return out;
        })(),
      );
    }
  }
  return Promise.all(jobs);
}

/** For the tests: the instance's memory of the key pair. */
export function _resetVapidMemo(): void {
  pairChecked = null;
}

