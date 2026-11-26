/* GET /api/study/health
 * Says whether the server side is wired: never the values, only whether they
 * are set. The deploy smoke test reads it, and so can a person setting up.
 *   worker    STUDY_WORKER_KEY is set (the server key, without spaces or a
 *             line break pasted around it; its value never leaves)
 *   workerOk  it is also the value of the Vault secret study_worker_key; if
 *             not, every call to Claude is refused (403 "forbidden")
 *   budgetUsd STUDY_MONTHLY_USD, the group's monthly cap
 *   schema    each SQL section's version in the database (study_schema())
 *   schemaOk  the database has every section this code needs (spec §2.11):
 *             the server's, and what the app built with this deployment's
 *             VITE_STUDY_* flags needs (healthSchema)
 *   features  the server-side switches (study_features())
 *   codes     the personal code works end to end (docs/study/personal-code.md):
 *             section I is loaded, the server key matches, the switch
 *             "codes" is not off, and Auth's email sign-in is on (its
 *             public settings). The app shows the code only when it is true.
 *   notify    pushes can go out (notifications, docs/study/DECISIONS-2026-11-26.md):
 *             section R is loaded, the VAPID keys are set on Vercel and are a
 *             pair, the server key matches, and the database can kick the
 *             worker (pg_net, Vault's key and site). The app offers pushes
 *             only when it is true.
 *   vapid     the VAPID PUBLIC key whenever the keys are set and a pair (the
 *             browser subscribes with it), else null; a device that reads
 *             null removes its push-only service worker (the kill path).
 *             The private key never appears here.
 *   notifyOn  the switch "notify" (off: only the pilot's members get pushes)
 *   notifyStuck  the sender's breaker stopped the kicks (15 without a claim) */

/// <reference path="../../server/study/env.d.ts" />
import { monthlyCap } from "../../server/study/budget.js";
import { vapidFromEnv, vapidPairOk } from "../../server/study/push.js";
import { healthSchema, keyed, schemaOk, serverClient, supabaseAnonKey, supabaseUrl, workerKey } from "../../server/study/study.js";

// Node.js runtime: the Anthropic SDK imports @opentelemetry/api, which Vercel's
// edge bundler refuses outside Next.js, so every study function runs on Node.
export const config = { maxDuration: 10 };

const TIMEOUT_MS = 4_000;

/** A read-only RPC's answer, or null when it fails or takes over 4 s. */
async function read(fn: "study_schema" | "study_features" | "study_notify_ok"): Promise<unknown> {
  try {
    const { data, error } = await serverClient().rpc(fn).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    return error ? null : data;
  } catch {
    return null;
  }
}

/** No group has this id: with the server key study_spent answers 0 for it,
 *  and "forbidden" when the key is not Vault's (missing, shorter than 32
 *  characters, or another value). The key goes only into the RPC's body. */
const NO_GROUP = "00000000-0000-0000-0000-000000000000";

async function workerMatches(): Promise<boolean> {
  if (!workerKey()) return false;
  try {
    const { error } = await serverClient()
      .rpc("study_spent", keyed({ p_group: NO_GROUP }))
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    return !error;
  } catch {
    return false;
  }
}

/** Whether Auth's email (and password) sign-in is on: the personal code's
 *  sign-in needs it. Auth's public settings, read with the anon key. */
async function emailSignInOn(): Promise<boolean> {
  try {
    const res = await fetch(`${supabaseUrl()}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const s = (await res.json()) as { external?: { email?: unknown } };
    return s.external?.email === true;
  } catch {
    return false;
  }
}

/** The personal code's readiness (section I at 1 or later, the server key,
 *  the switch, Auth's email sign-in); Auth is asked only when the rest holds. */
async function codesOn(schema: unknown, features: unknown, workerOk: boolean): Promise<boolean> {
  const i = schema && typeof schema === "object" ? (schema as Record<string, unknown>).I : undefined;
  if (typeof i !== "number" || i < 1 || !workerOk) return false;
  if (features && typeof features === "object" && (features as Record<string, unknown>).codes === false) return false;
  return emailSignInOn();
}

/** The VAPID public key when the three keys are set and the private one is
 *  the public one's pair; null otherwise. Worked out here, without the
 *  database, so a slow database never reads as "keys removed". */
let pairMemo: { key: string; ok: Promise<boolean> } | null = null;
/** The public key when the keys are a pair; the check runs once per instance and keys (health is public). */
async function vapidPublic(): Promise<string | null> {
  const v = vapidFromEnv(process.env);
  if (!v) return null;
  const key = `${v.publicKey} ${v.privateKey}`;
  if (pairMemo?.key !== key) pairMemo = { key, ok: vapidPairOk(v).catch(() => false) };
  return (await pairMemo.ok) ? v.publicKey : null;
}

type NotifyOk = { wired?: unknown; on?: unknown; stuck?: unknown };

/** Section R's state (study_notify_ok()), asked only when R is loaded. */
async function notifyOk(schema: unknown): Promise<NotifyOk | null> {
  const r = schema && typeof schema === "object" ? (schema as Record<string, unknown>).R : undefined;
  if (typeof r !== "number" || r < 1) return null;
  const ok = await read("study_notify_ok");
  return ok && typeof ok === "object" ? (ok as NotifyOk) : null;
}

async function handler(): Promise<Response> {
  const supabase = Boolean(process.env.VITE_STUDY_SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const [schema, features, workerOk] = supabase
    ? await Promise.all([read("study_schema"), read("study_features"), workerMatches()])
    : [null, null, false];
  const [codes, vapid, rOk] = await Promise.all([supabase ? codesOn(schema, features, workerOk) : false, vapidPublic(), supabase ? notifyOk(schema) : null]);
  const body = {
    ok: true,
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    supabase,
    project: process.env.VITE_STUDY_SUPABASE_URL ? "study" : "shared",
    worker: Boolean(workerKey()), // spaces or a line break pasted around it do not count
    workerOk,
    budgetUsd: monthlyCap(),
    schema,
    schemaOk: schemaOk(schema, healthSchema(process.env)),
    features,
    codes,
    notify: Boolean(vapid && workerOk && rOk?.wired === true),
    vapid,
    notifyOn: rOk?.on === true,
    notifyStuck: rOk?.stuck === true,
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default { fetch: handler };
