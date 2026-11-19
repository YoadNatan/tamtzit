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
 *   features  the server-side switches (study_features()) */

/// <reference path="../../server/study/env.d.ts" />
import { monthlyCap } from "../../server/study/budget.js";
import { healthSchema, keyed, schemaOk, serverClient, workerKey } from "../../server/study/study.js";

// Node.js runtime: the Anthropic SDK imports @opentelemetry/api, which Vercel's
// edge bundler refuses outside Next.js, so every study function runs on Node.
export const config = { maxDuration: 10 };

const TIMEOUT_MS = 4_000;

/** A read-only RPC's answer, or null when it fails or takes over 4 s. */
async function read(fn: "study_schema" | "study_features"): Promise<unknown> {
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

async function handler(): Promise<Response> {
  const supabase = Boolean(process.env.VITE_STUDY_SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const [schema, features, workerOk] = supabase
    ? await Promise.all([read("study_schema"), read("study_features"), workerMatches()])
    : [null, null, false];
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
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default { fetch: handler };
