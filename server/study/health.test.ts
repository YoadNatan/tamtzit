import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import health from "../../api/study/health.js";

/* GET /api/study/health in Node, against a local mock of PostgREST whose
 * study_spent behaves as section F's: with the server key it answers 0 for a
 * group that does not exist, with any other key "forbidden". The setup check
 * (§9.1 step 2.3) reads "worker" (the key is set on Vercel) and "workerOk"
 * (it is also Vault's study_worker_key); the key itself never leaves. */

const KEY = "k-0123456789abcdef0123456789abcdef";
let vaultKey: string | null = KEY;
/** A database with every section this code needs: F and the merged packages' W (with W2's hardening), Q, C, K. */
const CURRENT = { F: 1, W: 2, Q: 1, C: 1, K: 1 };
let schema: { status: number; body: unknown } = { status: 200, body: CURRENT };
/** study_features() and Auth's public settings, for "codes" (section I). */
let features: Record<string, boolean> = { exams: false, recordings: false };
let authSettings: { status: number; body: unknown } = { status: 200, body: { external: { email: true, anonymous_users: true } } };
let calls: Array<{ path: string; body: string }> = [];
/** Section R's study_notify_ok() (notifications), or a failure. */
let notifyOk: { status: number; body: unknown } = { status: 200, body: { wired: true, on: false, pilot: true, stuck: false } };
let base = "";

const readAll = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
  });
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const forbidden = { code: "P0001", details: null, hint: null, message: "forbidden" };
const rest = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const body = await readAll(req);
  calls.push({ path, body });
  if (path === "/rest/v1/rpc/study_schema") return send(res, schema.status, schema.body);
  if (path === "/rest/v1/rpc/study_features") return send(res, 200, features);
  if (path === "/rest/v1/rpc/study_notify_ok") return send(res, notifyOk.status, notifyOk.body);
  if (path === "/auth/v1/settings") {
    if (req.headers.apikey !== "anon-key") return send(res, 401, { message: "no apikey" });
    return send(res, authSettings.status, authSettings.body);
  }
  if (path === "/rest/v1/rpc/study_spent") {
    const a = JSON.parse(body) as { p_group?: string; p_key?: string };
    const worker = vaultKey !== null && vaultKey.length >= 32 && a.p_key === vaultKey;
    return worker ? send(res, 200, 0) : send(res, 400, forbidden);
  }
  send(res, 404, { message: `unmocked ${path}` });
});

before(async () => {
  await new Promise<void>((ok) => rest.listen(0, "127.0.0.1", () => ok()));
  base = `http://127.0.0.1:${(rest.address() as AddressInfo).port}`;
  delete process.env.VITE_STUDY_SUPABASE_URL;
  delete process.env.VITE_STUDY_SUPABASE_ANON_KEY;
});
after(() => rest.close());
beforeEach(() => {
  Object.assign(process.env, { VITE_SUPABASE_URL: base, VITE_SUPABASE_ANON_KEY: "anon-key", STUDY_WORKER_KEY: KEY, STUDY_MONTHLY_USD: "33", ANTHROPIC_API_KEY: "test-key" });
  vaultKey = KEY;
  schema = { status: 200, body: CURRENT };
  features = { exams: false, recordings: false };
  authSettings = { status: 200, body: { external: { email: true, anonymous_users: true } } };
  notifyOk = { status: 200, body: { wired: true, on: false, pilot: true, stuck: false } };
  calls = [];
  for (const k of ["STUDY_VAPID_PUBLIC", "STUDY_VAPID_PRIVATE", "STUDY_VAPID_SUBJECT"]) delete process.env[k];
});

const check = async () => {
  const res = await health.fetch();
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes(KEY) && !text.includes(KEY.slice(2, 18)), "the key never appears in the answer");
  return JSON.parse(text) as Record<string, unknown>;
};

test("wired: the key is set on Vercel and is Vault's, the schema has F and the merged packages' sections (W with W2's hardening)", async () => {
  assert.deepEqual(await check(), {
    ok: true,
    anthropicKey: true,
    supabase: true,
    project: "shared",
    worker: true,
    workerOk: true,
    budgetUsd: 33,
    schema: CURRENT,
    schemaOk: true,
    features: { exams: false, recordings: false },
    codes: false,
    notify: false,
    vapid: null,
    notifyOn: false,
    notifyStuck: false,
  });
  assert.equal(calls.filter((c) => c.path === "/auth/v1/settings").length, 0, "Auth is not asked without section I");
  assert.equal(calls.filter((c) => c.path === "/rest/v1/rpc/study_notify_ok").length, 0, "section R is not asked without it");
  const spent = calls.filter((c) => c.path === "/rest/v1/rpc/study_spent");
  assert.equal(spent.length, 1);
  assert.deepEqual(JSON.parse(spent[0].body), { p_group: "00000000-0000-0000-0000-000000000000", p_key: KEY });
});

test('the key is set on Vercel but Vault holds another value, or none: "worker" true, "workerOk" false', async () => {
  vaultKey = `${KEY.slice(0, -1)}X`;
  let h = await check();
  assert.equal(h.worker, true);
  assert.equal(h.workerOk, false, "one character off");
  vaultKey = null;
  h = await check();
  assert.equal(h.workerOk, false, "no Vault secret");
  assert.equal(h.schemaOk, true, "the rest is still reported");
});

test("a key pasted with a space or a line break around it: trimmed, so worker and workerOk are true", async () => {
  // Vercel keeps what was pasted; Vault's study_worker_key has none of it.
  for (const pasted of [`${KEY}\n`, `${KEY} `, `  ${KEY}\r\n`, `\t${KEY}\n\n`]) {
    process.env.STUDY_WORKER_KEY = pasted;
    calls = [];
    const h = await check();
    assert.deepEqual([h.worker, h.workerOk], [true, true], JSON.stringify(pasted));
    const spent = calls.filter((c) => c.path === "/rest/v1/rpc/study_spent");
    assert.deepEqual(JSON.parse(spent[0].body), { p_group: "00000000-0000-0000-0000-000000000000", p_key: KEY }, "the RPC gets the key itself");
  }
  // Only spaces and line breaks: no key at all.
  process.env.STUDY_WORKER_KEY = " \n";
  calls = [];
  const h = await check();
  assert.deepEqual([h.worker, h.workerOk], [false, false]);
  assert.equal(calls.filter((c) => c.path === "/rest/v1/rpc/study_spent").length, 0);
});

test("no key on Vercel: worker and workerOk false, and study_spent is not called", async () => {
  delete process.env.STUDY_WORKER_KEY;
  const h = await check();
  assert.equal(h.worker, false);
  assert.equal(h.workerOk, false);
  assert.equal(calls.filter((c) => c.path === "/rest/v1/rpc/study_spent").length, 0);
});

test("a database older than the code: schemaOk false; no study_schema at all: schema null", async () => {
  schema = { status: 200, body: {} };
  let h = await check();
  assert.deepEqual([h.schema, h.schemaOk], [{}, false]);
  // Section F alone, or one merged package's section missing or older: the gate shows it (§2.11, §7).
  // Release 1's registry without section W (its SQL not run yet) is one of them.
  for (const body of [{ F: 1 }, { F: 1, Q: 1, C: 1 }, { F: 1, Q: 1, K: 1 }, { F: 1, C: 1, K: 1 }, { ...CURRENT, K: 0 }, { F: 1, Q: 1, C: 1, K: 1 }, { ...CURRENT, W: 0 }]) {
    schema = { status: 200, body };
    h = await check();
    assert.deepEqual([h.schema, h.schemaOk], [body, false], JSON.stringify(body));
  }
  // Later and other sections do not matter.
  schema = { status: 200, body: { ...CURRENT, Q: 2, W: 2, Z: 1 } };
  assert.equal((await check()).schemaOk, true);
  schema = { status: 404, body: { code: "PGRST202", details: null, hint: null, message: "Could not find the function public.study_schema without parameters in the schema cache" } };
  h = await check();
  assert.deepEqual([h.schema, h.schemaOk], [null, false]);
});

test("no Supabase configured: nothing is asked, and nothing is ok", async () => {
  delete process.env.VITE_SUPABASE_URL;
  const h = await check();
  assert.deepEqual([h.supabase, h.worker, h.workerOk, h.schema, h.schemaOk, h.features], [false, true, false, null, false, null]);
  assert.equal(calls.length, 0);
});

test('"codes": section I, the server key, the switch not off, and Auth\'s email sign-in on', async () => {
  schema = { status: 200, body: { ...CURRENT, I: 1 } };
  assert.equal((await check()).codes, true);
  assert.equal(calls.filter((c) => c.path === "/auth/v1/settings").length, 1);
  features = { exams: false, codes: true };
  assert.equal((await check()).codes, true, "the switch on");
  features = { exams: false, codes: false };
  assert.equal((await check()).codes, false, "the switch off");
  features = { exams: false };
  authSettings = { status: 200, body: { external: { email: false, anonymous_users: true } } };
  assert.equal((await check()).codes, false, "Auth's email sign-in off");
  authSettings = { status: 500, body: { message: "down" } };
  assert.equal((await check()).codes, false, "Auth's settings unreadable");
  authSettings = { status: 200, body: { external: { email: true } } };
  vaultKey = null;
  assert.equal((await check()).codes, false, "the server key not Vault's");
  vaultKey = KEY;
  schema = { status: 200, body: { ...CURRENT, I: 0 } };
  assert.equal((await check()).codes, false, "section I not loaded");
  schema = { status: 200, body: { ...CURRENT, I: 2 } };
  assert.equal((await check()).codes, true, "a later version of I");
});

/* ── Notifications (section R): notify, vapid, notifyOn, notifyStuck ── */
async function vapidPair(): Promise<{ pub: string; priv: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    pub: Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url"),
    priv: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!,
  };
}

test('"notify": section R, a VAPID pair, the server key and a wired database; "vapid" is the public key whenever the pair is set; the private key never appears', async () => {
  const k = await vapidPair();
  Object.assign(process.env, { STUDY_VAPID_PUBLIC: k.pub, STUDY_VAPID_PRIVATE: k.priv, STUDY_VAPID_SUBJECT: "https://study.example" });
  schema = { status: 200, body: { ...CURRENT, R: 1 } };
  const text = async () => {
    const t = await (await health.fetch()).text();
    assert.ok(!t.includes(k.priv), "the private key never appears");
    return JSON.parse(t) as Record<string, unknown>;
  };
  let h = await text();
  assert.deepEqual([h.notify, h.vapid, h.notifyOn, h.notifyStuck], [true, k.pub, false, false]);
  notifyOk = { status: 200, body: { wired: true, on: true, pilot: false, stuck: true } };
  h = await text();
  assert.deepEqual([h.notify, h.notifyOn, h.notifyStuck], [true, true, true]);
  // The database cannot kick the worker (pg_net, Vault's key or site missing).
  notifyOk = { status: 200, body: { wired: false, on: true, pilot: false, stuck: false } };
  h = await text();
  assert.deepEqual([h.notify, h.vapid], [false, k.pub]);
  // study_notify_ok() fails: notify false, the public key still given (only removed keys remove the worker).
  notifyOk = { status: 500, body: { message: "down" } };
  h = await text();
  assert.deepEqual([h.notify, h.vapid, h.notifyOn, h.notifyStuck], [false, k.pub, false, false]);
  notifyOk = { status: 200, body: { wired: true, on: false, pilot: true, stuck: false } };
  // The server key is not Vault's.
  vaultKey = null;
  h = await text();
  assert.deepEqual([h.notify, h.vapid], [false, k.pub]);
  vaultKey = KEY;
  // Section R not loaded: not asked.
  schema = { status: 200, body: CURRENT };
  calls = [];
  h = await text();
  assert.deepEqual([h.notify, h.vapid], [false, k.pub]);
  assert.equal(calls.filter((c) => c.path === "/rest/v1/rpc/study_notify_ok").length, 0);
  // Keys that are not a pair, or one of them missing: vapid null (the devices' kill path).
  schema = { status: 200, body: { ...CURRENT, R: 1 } };
  const other = await vapidPair();
  process.env.STUDY_VAPID_PRIVATE = other.priv;
  h = await text();
  assert.deepEqual([h.notify, h.vapid], [false, null]);
  delete process.env.STUDY_VAPID_SUBJECT;
  process.env.STUDY_VAPID_PRIVATE = k.priv;
  h = await text();
  assert.deepEqual([h.notify, h.vapid], [false, null]);
});
