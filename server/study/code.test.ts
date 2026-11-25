import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, test } from "node:test";
import code from "../../api/study/code.js";
import { clientIp, handleCode, type CodeDeps } from "./code.js";

/* /api/study/code (server/study/code.ts) with injected Supabase clients: the
 * redeem RPC's answers, Auth's password sign-in and study_code_finish. */

const KEY = "k-0123456789abcdef0123456789abcdef";
const CODE = "K7QM-3XRP-W9TD-H4NA";
const ONE_TIME = { email: "c-0011223344556677aa@code.tamtzit.invalid", password: "ab".repeat(24) };
const SESSION = { access_token: "access.jwt.token", refresh_token: "refresh-token-1", expires_at: 1_900_000_000, user: { id: "u-dana" } };

type RpcAnswer = { data: unknown; error: { code?: string; message?: string } | null };
let redeemAnswers: RpcAnswer[];
let signIns: Array<{ data: { session: unknown }; error: { code?: string; status?: number; message: string } | null }>;
let finishAnswer: RpcAnswer | "throw";
let calls: Array<{ what: string; args?: unknown; token?: string }>;
let logs: string[];

const deps = (): CodeDeps => ({
  server: () =>
    ({
      rpc: async (fn: string, args: unknown) => {
        calls.push({ what: fn, args });
        return redeemAnswers.shift() ?? { data: { error: "code not found" }, error: null };
      },
      auth: {
        signInWithPassword: async (creds: unknown) => {
          calls.push({ what: "signIn", args: creds });
          return signIns.shift() ?? { data: { session: SESSION }, error: null };
        },
      },
    }) as unknown as ReturnType<CodeDeps["server"]>,
  as: (token) =>
    ({
      rpc: async (fn: string) => {
        calls.push({ what: fn, token });
        if (finishAnswer === "throw") throw new Error("fetch failed");
        return finishAnswer;
      },
    }) as unknown as ReturnType<CodeDeps["as"]>,
  log: (line) => logs.push(line),
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/study/code", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  process.env.STUDY_WORKER_KEY = KEY;
  redeemAnswers = [{ data: ONE_TIME, error: null }];
  signIns = [];
  finishAnswer = { data: null, error: null };
  calls = [];
  logs = [];
});

test("the address: x-real-ip (Vercel's own), else the first x-forwarded-for entry, else empty", () => {
  assert.equal(clientIp(new Headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "9.9.9.9");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" })), "1.2.3.4");
  assert.equal(clientIp(new Headers()), "");
});

test("a code in: the redeem with the key and the address, the sign-in, finish as the new session, the session out", async () => {
  const res = await handleCode(post({ code: CODE }, { "x-real-ip": "9.9.9.9", "x-forwarded-for": "6.6.6.6" }), deps());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { access_token: SESSION.access_token, refresh_token: SESSION.refresh_token, expires_at: SESSION.expires_at, user_id: "u-dana" });
  assert.deepEqual(calls, [
    { what: "study_code_redeem", args: { p_code: CODE, p_ip: "9.9.9.9", p_key: KEY } },
    { what: "signIn", args: ONE_TIME },
    { what: "study_code_finish", token: SESSION.access_token },
  ]);
});

test("the redeem's answers map to statuses", async () => {
  const cases: Array<[RpcAnswer, number, string]> = [
    [{ data: { error: "code not found" }, error: null }, 401, "code not found"],
    [{ data: { error: "too many tries" }, error: null }, 429, "too many tries"],
    [{ data: { error: "codes off" }, error: null }, 503, "codes off"],
    [{ data: null, error: { code: "PGRST202", message: "Could not find the function public.study_code_redeem" } }, 503, "codes off"],
    [{ data: null, error: { code: "P0001", message: "forbidden" } }, 500, "forbidden"],
    [{ data: null, error: { code: "57014", message: "canceling statement" } }, 500, "server"],
    [{ data: { surprise: true }, error: null }, 500, "server"],
  ];
  for (const [answer, status, error] of cases) {
    redeemAnswers = [answer];
    calls = [];
    const res = await handleCode(post({ code: CODE }), deps());
    assert.equal(res.status, status, error);
    assert.deepEqual(await res.json(), { error });
    assert.equal(calls.filter((c) => c.what === "signIn").length, 0, "no sign-in without one-time values");
  }
});

test("bad requests: 400 for no code, an empty one, one over 200 characters, or bad JSON; 405 for GET; 415 for a body not sent as JSON", async () => {
  for (const body of [{}, { code: "" }, { code: "   " }, { code: 5 }, { code: "x".repeat(201) }, "{"]) {
    const res = await handleCode(post(body), deps());
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await handleCode(new Request("http://x/api/study/code"), deps())).status, 405);
  // Not JSON (a cross-site "simple" POST needs no preflight): 415, and no redeem, so no try is counted.
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
    const res = await handleCode(new Request("http://x/api/study/code", { method: "POST", headers: type ? { "content-type": type } : {}, body: JSON.stringify({ code: CODE }) }), deps());
    assert.equal(res.status, 415, type);
    assert.deepEqual(await res.json(), { error: "json only" });
  }
  assert.equal(calls.length, 0);
  redeemAnswers = [{ data: ONE_TIME, error: null }];
  assert.equal((await handleCode(post({ code: CODE }, { "content-type": "application/json; charset=utf-8" }), deps())).status, 200);
  redeemAnswers = [{ data: ONE_TIME, error: null }];
  calls = [];
  for (const body of [{}, { code: "" }]) await handleCode(post(body), deps());
  assert.equal(calls.length, 0);
  // A whole WhatsApp message with the code in it still fits.
  const res = await handleCode(post({ code: `הקוד האישי שלי בתמצית: ${CODE}\nכניסה בנגיעה: https://tamtzit.vercel.app/#k=${CODE.replace(/-/g, "")}` }), deps());
  assert.equal(res.status, 200);
});

test("another device took the one-time password in between: one more round, then the session", async () => {
  redeemAnswers = [{ data: ONE_TIME, error: null }, { data: { ...ONE_TIME, password: "cd".repeat(24) }, error: null }];
  signIns = [{ data: { session: null }, error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" } }];
  const res = await handleCode(post({ code: CODE }), deps());
  assert.equal(res.status, 200);
  assert.equal(calls.filter((c) => c.what === "study_code_redeem").length, 2);
  assert.equal(calls.filter((c) => c.what === "signIn").length, 2);
  // Twice in a row: no third round.
  redeemAnswers = [{ data: ONE_TIME, error: null }, { data: ONE_TIME, error: null }, { data: ONE_TIME, error: null }];
  const bad = { data: { session: null }, error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" } };
  signIns = [bad, bad, bad];
  calls = [];
  const res2 = await handleCode(post({ code: CODE }), deps());
  assert.equal(res2.status, 502);
  assert.deepEqual(await res2.json(), { error: "sign-in failed" });
  assert.equal(calls.filter((c) => c.what === "study_code_redeem").length, 2);
});

test("Auth's email sign-in off: 503 codes off; Auth's own limit: 429", async () => {
  signIns = [{ data: { session: null }, error: { code: "email_provider_disabled", status: 400, message: "Email logins are disabled" } }];
  let res = await handleCode(post({ code: CODE }), deps());
  assert.deepEqual([res.status, await res.json()], [503, { error: "codes off" }]);
  redeemAnswers = [{ data: ONE_TIME, error: null }];
  signIns = [{ data: { session: null }, error: { code: "over_request_rate_limit", status: 429, message: "Request rate limit reached" } }];
  res = await handleCode(post({ code: CODE }), deps());
  assert.deepEqual([res.status, await res.json()], [429, { error: "too many tries" }]);
});

test("finish failing is not fatal: the session still comes back, and the failure is logged", async () => {
  finishAnswer = { data: null, error: { code: "PGRST301", message: "JWT expired" } };
  let res = await handleCode(post({ code: CODE }), deps());
  assert.equal(res.status, 200);
  assert.ok(logs.some((l) => l.includes("finish failed")));
  redeemAnswers = [{ data: ONE_TIME, error: null }];
  finishAnswer = "throw";
  res = await handleCode(post({ code: CODE }), deps());
  assert.equal(res.status, 200);
});

test("nothing secret is logged: not the code, the one-time values or the tokens (also through console.error)", async () => {
  const seen: string[] = [];
  const orig = { error: console.error, log: console.log, warn: console.warn };
  console.error = (...a: unknown[]) => void seen.push(a.map(String).join(" "));
  console.log = console.error;
  console.warn = console.error;
  try {
    const real = deps();
    const viaConsole: CodeDeps = { ...real, log: (line) => console.error(line) };
    redeemAnswers = [{ data: ONE_TIME, error: null }, { data: ONE_TIME, error: null }];
    signIns = [{ data: { session: null }, error: { code: "invalid_credentials", status: 400, message: "Invalid login credentials" } }];
    finishAnswer = { data: null, error: { code: "PGRST301", message: "JWT expired" } };
    await handleCode(post({ code: CODE }), viaConsole);
    redeemAnswers = [{ data: { error: "code not found" }, error: null }];
    await handleCode(post({ code: "WRNG-CODE-WRNG-CODE" }), viaConsole);
    redeemAnswers = [{ data: null, error: { code: "P0001", message: "forbidden" } }];
    await handleCode(post({ code: CODE }), viaConsole);
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(seen.length >= 3, "each request logs one line or more");
  const all = seen.join("\n") + logs.join("\n");
  for (const secret of [CODE, CODE.replace(/-/g, ""), "WRNG", ONE_TIME.email, ONE_TIME.password, SESSION.access_token, SESSION.refresh_token, KEY])
    assert.ok(!all.includes(secret), `the log has ${secret}`);
  assert.ok(seen.every((l) => /^study code: /.test(l)), seen.join("\n"));
});

test("no server key on Vercel: 500, and the RPC is not called", async () => {
  delete process.env.STUDY_WORKER_KEY;
  const res = await handleCode(post({ code: CODE }), deps());
  assert.deepEqual([res.status, await res.json()], [500, { error: "server" }]);
  assert.equal(calls.length, 0);
});

test("the function itself, with the real Supabase clients, against a local PostgREST and Auth", async () => {
  const seen: Array<{ path: string; auth: string; apikey: string; body: string }> = [];
  const readAll = (req: IncomingMessage) =>
    new Promise<string>((ok) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = await readAll(req);
    seen.push({ path: url.pathname + url.search, auth: String(req.headers.authorization ?? ""), apikey: String(req.headers.apikey ?? ""), body });
    const send = (status: number, b: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(b));
    };
    if (url.pathname === "/rest/v1/rpc/study_code_redeem") return send(200, ONE_TIME);
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const c = JSON.parse(body) as { email: string; password: string };
      if (c.email !== ONE_TIME.email || c.password !== ONE_TIME.password) return send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(200, { access_token: SESSION.access_token, refresh_token: SESSION.refresh_token, expires_in: 3600, expires_at: SESSION.expires_at, token_type: "bearer", user: { id: "u-dana", aud: "authenticated", is_anonymous: true } });
    }
    if (url.pathname === "/rest/v1/rpc/study_code_finish") return send(200, null);
    send(404, { message: "unmocked" });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const saved = { ...process.env };
  try {
    delete process.env.VITE_STUDY_SUPABASE_URL;
    delete process.env.VITE_STUDY_SUPABASE_ANON_KEY;
    process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
    const quiet = console.error;
    console.error = () => {};
    let res: Response;
    try {
      res = await code.fetch(post({ code: CODE }, { "x-real-ip": "9.9.9.9" }));
    } finally {
      console.error = quiet;
    }
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { access_token: SESSION.access_token, refresh_token: SESSION.refresh_token, expires_at: SESSION.expires_at, user_id: "u-dana" });
    assert.deepEqual(seen.map((s) => s.path), ["/rest/v1/rpc/study_code_redeem", "/auth/v1/token?grant_type=password", "/rest/v1/rpc/study_code_finish"]);
    assert.deepEqual(JSON.parse(seen[0].body), { p_code: CODE, p_ip: "9.9.9.9", p_key: KEY });
    assert.equal(seen[2].auth, `Bearer ${SESSION.access_token}`, "finish runs as the new session");
    assert.ok(seen.every((s) => s.apikey === "anon-key"));
  } finally {
    process.env = saved;
    server.close();
  }
});
