import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { AuthApiError, AuthRefreshDiscardedError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

/* The app's own wrappers (src/study/lib/api.ts) in Node, against a local mock
 * of Supabase (Auth, PostgREST) and of /api/study: what F0 changed on the
 * phone. A refusal reaches the screens as Error(code); deleting hides through
 * study_delete_lecture; the library lists lectures with or without section F;
 * a session about to expire is refreshed before /api/study, and a call refused
 * with "session expiring" is made once more. */

type Logged = { method: string; path: string; query: URLSearchParams; auth: string | null; body: string };
type Reply = { status: number; body?: unknown; type?: string };
let log: Logged[] = [];
let routes: Record<string, (l: Logged) => Reply> = {};
let signupSeconds = 3600;
let refreshes = 0;
/** What /auth/v1/token answers instead of a fresh session (a refused refresh). */
let tokenReply: Reply | null = null;

const USER = { id: "33333333-0000-4000-8000-000000000003", aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} };
const session = (token: string, seconds: number) => ({
  access_token: token,
  token_type: "bearer",
  expires_in: seconds,
  expires_at: Math.floor(Date.now() / 1000) + seconds,
  refresh_token: `r-${token}`,
  user: USER,
});
const refusal = (message: string, code = "P0001"): Reply => ({ status: 400, body: { code, details: null, hint: null, message } });

const readAll = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
  });
const send = (res: ServerResponse, r: Reply) => {
  if (r.body === undefined) {
    res.writeHead(r.status);
    return res.end();
  }
  res.writeHead(r.status, { "content-type": r.type ?? "application/json" });
  res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const l: Logged = { method: req.method ?? "", path: url.pathname, query: url.searchParams, auth: req.headers.authorization ?? null, body: await readAll(req) };
  log.push(l);
  if (l.path === "/auth/v1/signup") return send(res, { status: 200, body: session("first", signupSeconds) });
  if (l.path === "/auth/v1/token") return send(res, tokenReply ?? { status: 200, body: session(`fresh${++refreshes}`, 3600) });
  if (l.path === "/auth/v1/logout") return send(res, { status: 204 });
  if (l.path === "/auth/v1/user") return send(res, { status: 200, body: USER });
  const route = routes[`${l.method} ${l.path}`];
  if (route) return send(res, route(l));
  send(res, { status: 404, body: { message: `unmocked ${l.method} ${l.path}` } });
});

type Api = typeof import("./api");
let api: Api;
let failText: typeof import("./failText").failText;
before(async () => {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // api.ts reads Vite's import.meta.env. Bundled into this one file, it shares
  // this module's import.meta, so the mock's address is set here, before the
  // module is first evaluated (the dynamic import below).
  (import.meta as unknown as { env: Record<string, string> }).env = { VITE_SUPABASE_URL: base, VITE_SUPABASE_ANON_KEY: "anon-key" };
  // In the browser /api/study/* is relative to the site: send it to the mock.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === "string" && input.startsWith("/") ? base + input : input, init)) as typeof fetch;
  api = await import("./api");
  ({ failText } = await import("./failText"));
});
after(() => server.close());
beforeEach(async () => {
  await api.signOut();
  log = [];
  routes = {};
  signupSeconds = 3600;
  tokenReply = null;
});

const rpcCalls = (name: string) => log.filter((l) => l.path === `/rest/v1/rpc/${name}`);
const isError = (message: string) => (e: unknown) => e instanceof Error && e.message === message;

test("a refusal from the database reaches the screen as Error(code): name taken, wrong code, groups closed", async () => {
  routes["POST /rest/v1/rpc/study_join"] = () => refusal("name taken");
  await assert.rejects(api.joinGroup(" abc123 ", " שוהם "), isError("name taken"), "Join shows the name-taken line");
  assert.deepEqual(JSON.parse(rpcCalls("study_join")[0].body), { p_code: "ABC123", p_member_name: "שוהם" });

  routes["POST /rest/v1/rpc/study_join"] = () => refusal("wrong code");
  await assert.rejects(api.joinGroup("XXXXXX", "שוהם"), isError("wrong code"));

  routes["POST /rest/v1/rpc/study_create_group"] = () => refusal("groups closed");
  await assert.rejects(api.createGroup("קבוצה שנייה", "נועה"), isError("groups closed"));

  routes["POST /rest/v1/rpc/study_join"] = () => ({ status: 200, body: [{ id: "g1", name: "קבוצת שנה ג" }] });
  assert.deepEqual(await api.joinGroup("ABC123", "שוהם 2"), { id: "g1", name: "קבוצת שנה ג" });
});

test("deleting a lecture hides it through study_delete_lecture and removes no file", async () => {
  const lecture = {
    id: "eeeeeeee-0000-4000-8000-000000000005",
    group_id: "aaaaaaaa-0000-4000-8000-000000000001",
    course: "",
    title: "הרצאה",
    lecturer: "",
    lecture_date: null,
    source_name: "x.pptx",
    source_kind: "pptx" as const,
    status: "ready" as const,
    error: null,
    created_by: USER.id,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
  };
  routes["POST /rest/v1/rpc/study_delete_lecture"] = () => ({ status: 200, body: JSON.stringify("2026-11-15T12:00:00+00:00") }); // a timestamptz, as JSON
  await api.deleteLecture(lecture);
  assert.equal(rpcCalls("study_delete_lecture").length, 1);
  assert.deepEqual(JSON.parse(rpcCalls("study_delete_lecture")[0].body), { p_lecture: lecture.id });
  assert.equal(log.filter((l) => l.path.startsWith("/storage/")).length, 0, "no file is listed or removed");
  assert.equal(log.filter((l) => l.path === "/rest/v1/study_lectures").length, 0, "the row is never deleted directly");

  routes["POST /rest/v1/rpc/study_delete_lecture"] = () => refusal("lecture not found");
  await assert.rejects(api.deleteLecture(lecture), isError("lecture not found"));
});

test("the library leaves hidden lectures out, and still lists every lecture on a database from before section F", async () => {
  const rows = [{ id: "l1", title: "א" }, { id: "l2", title: "ב" }];
  const lectureReads = () => log.filter((l) => l.method === "GET" && l.path === "/rest/v1/study_lectures");
  let sectionF = true;
  routes["GET /rest/v1/study_lectures"] = (l) =>
    !sectionF && l.query.has("deleted_at")
      ? refusal("column study_lectures.deleted_at does not exist", "42703")
      : { status: 200, body: rows };

  assert.deepEqual(await api.listLectures("g1"), rows);
  assert.equal(lectureReads().length, 1);
  assert.equal(lectureReads()[0].query.get("deleted_at"), "is.null", "hidden lectures are left out");
  assert.equal(lectureReads()[0].query.get("group_id"), "eq.g1");

  log = [];
  sectionF = false;
  assert.deepEqual(await api.listLectures("g1"), rows, "the deploy came before the SQL: reading still works");
  assert.equal(lectureReads().length, 2);
  assert.equal(lectureReads()[1].query.has("deleted_at"), false);
  assert.equal(lectureReads()[1].query.get("order"), "created_at.desc");

  log = [];
  routes["GET /rest/v1/study_lectures"] = () => ({ status: 500, body: { code: "XX000", message: "boom" } });
  await assert.rejects(api.listLectures("g1"), isError("boom"), "any other error is not retried");
  assert.equal(lectureReads().length, 1);
});

test("a session with under six minutes left is refreshed before /api/study, and the new token is sent", async () => {
  signupSeconds = 200;
  routes["POST /rest/v1/rpc/study_join"] = () => ({ status: 200, body: [{ id: "g1", name: "g" }] });
  await api.joinGroup("ABC123", "שוהם");
  routes["POST /api/study/outline"] = () => ({ status: 200, body: '​{"parts":[]}', type: "text/plain; charset=utf-8" });
  const before = refreshes;
  await api.runOutline("eeeeeeee-0000-4000-8000-000000000005");
  const calls = log.filter((l) => l.path === "/api/study/outline");
  assert.equal(calls.length, 1);
  assert.equal(refreshes, before + 1, "refreshed once before the call");
  assert.equal(calls[0].auth, `Bearer fresh${refreshes}`);
  assert.deepEqual(JSON.parse(calls[0].body), { lectureId: "eeeeeeee-0000-4000-8000-000000000005" });
});

test('a call refused with 401 "session expiring" is made once more with a refreshed session; other refusals are not', async () => {
  routes["POST /rest/v1/rpc/study_join"] = () => ({ status: 200, body: [{ id: "g1", name: "g" }] });
  await api.joinGroup("ABC123", "שוהם");
  let refused = 0;
  routes["POST /api/study/section"] = () =>
    refused++ === 0 ? { status: 401, body: { error: "session expiring" } } : { status: 200, body: "​טקסט", type: "text/plain; charset=utf-8" };
  let shown = "";
  await api.runSection("eeeeeeee-0000-4000-8000-000000000005", 1, (t) => (shown = t));
  const calls = log.filter((l) => l.path === "/api/study/section");
  assert.deepEqual(
    calls.map((c) => c.auth),
    ["Bearer first", `Bearer fresh${refreshes}`],
    "the first token, then a refreshed one",
  );
  assert.equal(shown, "טקסט");

  log = [];
  routes["POST /api/study/section"] = () => ({ status: 401, body: { error: "session expired" } });
  await assert.rejects(api.runSection("eeeeeeee-0000-4000-8000-000000000005", 1, () => undefined), isError("session expired"));
  assert.equal(log.filter((l) => l.path === "/api/study/section").length, 1, "made once");

  log = [];
  routes["POST /api/study/section"] = () => ({ status: 401, body: { error: "session expiring" } });
  await assert.rejects(api.runSection("eeeeeeee-0000-4000-8000-000000000005", 1, () => undefined), isError("session expiring"));
  assert.equal(log.filter((l) => l.path === "/api/study/section").length, 2, "repeated once, not in a loop");
  assert.notEqual(failText("session expiring", "practice"), failText("no such code", "group"), "the safety net: never the generic line");
});

test("a refused refresh after 401 session expiring never posts the same token again: session expired, the signed-out line", async () => {
  routes["POST /rest/v1/rpc/study_join"] = () => ({ status: 200, body: [{ id: "g1", name: "g" }] });
  await api.joinGroup("ABC123", "שוהם");
  routes["POST /api/study/section"] = () => ({ status: 401, body: { error: "session expiring" } });
  tokenReply = { status: 400, body: { error: "invalid_grant", error_description: "Invalid Refresh Token: Already Used" } };
  await assert.rejects(api.runSection("eeeeeeee-0000-4000-8000-000000000005", 1, () => undefined), isError("session expired"));
  const calls = log.filter((l) => l.path === "/api/study/section");
  assert.deepEqual(
    calls.map((c) => c.auth),
    ["Bearer first"],
    "posted once: the refused token is not sent again",
  );
  assert.equal(log.filter((l) => l.path === "/auth/v1/token").length, 1, "one refresh");
  assert.equal(log.filter((l) => l.path === "/auth/v1/logout").length, 1, "signed out on this device");
  assert.equal(await api.getSession(), null, "the session is gone, so the app shows Join (where the sign-in is)");
  const other = failText("no such code", "group");
  assert.notEqual(failText("session expired", "practice"), other, "a line of its own, not the generic one");
  assert.equal(failText("session expired", "practice"), failText("not signed in", "practice"), "the signed-out line");
});

test("a refresh Auth only held back (429) is server: the refused token is not sent again, and the session stays", async () => {
  routes["POST /rest/v1/rpc/study_join"] = () => ({ status: 200, body: [{ id: "g1", name: "g" }] });
  await api.joinGroup("ABC123", "שוהם");
  routes["POST /api/study/section"] = () => ({ status: 401, body: { error: "session expiring" } });
  tokenReply = { status: 429, body: { code: "over_request_rate_limit", msg: "Request rate limit reached" } };
  await assert.rejects(api.runSection("eeeeeeee-0000-4000-8000-000000000005", 1, () => undefined), isError("server"));
  assert.deepEqual(
    log.filter((l) => l.path === "/api/study/section").map((c) => c.auth),
    ["Bearer first"],
    "posted once",
  );
  assert.equal(log.filter((l) => l.path === "/auth/v1/logout").length, 0, "not signed out");
  assert.equal((await api.getSession())?.access_token, "first", "the session stays: a later refresh may work");
  assert.notEqual(failText("server", "practice"), failText("session expired", "practice"), "not the signed-out line");
});

test("a forced refresh: network when Auth cannot be reached, session expired only for a refusal for good, else server", () => {
  assert.equal(api.refreshFailure(new AuthRetryableFetchError("Failed to fetch", 0)), "network");
  assert.equal(api.refreshFailure(new AuthRetryableFetchError("Service Unavailable", 503)), "network");
  assert.equal(api.refreshFailure(new TypeError("Failed to fetch")), "network");
  assert.equal(api.refreshFailure(new AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used")), "session expired");
  assert.equal(api.refreshFailure(new AuthApiError("Session not found", 403, "session_not_found")), "session expired");
  assert.equal(api.refreshFailure(new AuthSessionMissingError()), "session expired");
  assert.equal(api.refreshFailure(new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit")), "server", "a rate limit: the token may still be good");
  assert.equal(api.refreshFailure(new AuthApiError("Internal error", 500, "unexpected_failure")), "server");
  assert.equal(api.refreshFailure(new AuthRefreshDiscardedError()), "server", "another tab replaced the session");
  assert.equal(api.refreshFailure(null), "server", "no error and no session: not a sure refusal");
});

/* F1 additions: readLines for the item ops (spec §2.11), the lease-aware isStuck, schemaOk. */

const streamOf = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const x of chunks) c.enqueue(enc.encode(x));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "application/x-ndjson" } },
  );

test("readLines hands over each NDJSON line as it completes, across chunks, and skips what is not JSON", async () => {
  const got: unknown[] = [];
  await api.readLines(streamOf(["​{\"t\":\"start\"}\n{\"t\":\"q\",\"q\":{\"id\":", "\"a\"}}\nnot json\n", "{\"t\":\"done\"}"]), (l) => got.push(l));
  assert.deepEqual(got, [{ t: "start" }, { t: "q", q: { id: "a" } }, { t: "done" }]);
});

test("readLines turns an in-stream failure into Error(code), and a refusal before the stream into its JSON error", async () => {
  const got: unknown[] = [];
  await assert.rejects(api.readLines(streamOf(["​{\"t\":\"q\"}\n", "\n\u0000ERROR budget"]), (l) => got.push(l)), isError("budget"));
  assert.deepEqual(got, [{ t: "q" }], "lines before the failure were delivered");
  await assert.rejects(api.readLines(new Response(JSON.stringify({ error: "reserve" }), { status: 402 }), () => undefined), isError("reserve"));
});

test("isStuck: a leased part is stuck 30 s after its lease, an unleased one after 6 minutes of silence", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const iso = (ms: number) => new Date(now + ms).toISOString();
  assert.equal(api.isStuck({ status: "writing", updated_at: iso(-60_000), lease_until: iso(-20_000) }, now), false, "inside the 30 s grace");
  assert.equal(api.isStuck({ status: "writing", updated_at: iso(-60_000), lease_until: iso(-40_000) }, now), true);
  assert.equal(api.isStuck({ status: "writing", updated_at: iso(-5 * 60_000), lease_until: null }, now), false);
  assert.equal(api.isStuck({ status: "writing", updated_at: iso(-7 * 60_000), lease_until: null }, now), true);
  assert.equal(api.isStuck({ status: "ready", updated_at: iso(-60 * 60_000), lease_until: null }, now), false);
});

test("schemaOk: every section the build needs, at its version or later", () => {
  assert.equal(api.schemaOk({ schema: { F: 1 } }, { F: 1 }), true);
  assert.equal(api.schemaOk({ schema: { F: 1, Q: 1 } }, { F: 1, Q: 1 }), true);
  assert.equal(api.schemaOk({ schema: { F: 1 } }, { F: 1, Q: 1 }), false, "a flag's section is missing");
  assert.equal(api.schemaOk({ schema: { F: 1, W: 1 } }, { F: 1, W: 2 }), false, "an older section");
  assert.equal(api.schemaOk(null, { F: 1 }), false);
});

/** A Storage in memory, as the browser's localStorage and sessionStorage. */
function memoryStorage(entries: Record<string, string>): Storage {
  const m = new Map(Object.entries(entries));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

test("another user's entries leave the device: also the wall's drafts and Today's queue (§5.9, §12.2.5)", () => {
  const ME = "11111111-0000-4000-8000-000000000001";
  const OTHER = "22222222-0000-4000-8000-000000000002";
  const local = memoryStorage({
    [`study-ask-v1:${OTHER}:all`]: "[]",
    [`study-wall-draft:${OTHER}:lecture-1`]: "an unsent association",
    [`study-wall-draft:${ME}:lecture-1`]: "mine",
    [`study-wall-tab:${OTHER}`]: "top", // a tab, not the person's material
    "study-today-minutes": "20", // the device's, not a person's
    "study-font-size": "17",
  });
  const session = memoryStorage({
    [`study-today:${OTHER}:2026-11-15`]: "[1,2,3]",
    [`study-today:${ME}:2026-11-15`]: "[4]",
    [`study-session:${OTHER}:l.x`]: "{}",
  });
  const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
  const before = { local: g.localStorage, session: g.sessionStorage };
  g.localStorage = local;
  g.sessionStorage = session;
  try {
    api.forgetOtherUsers(ME);
    const keys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i)).sort();
    assert.deepEqual(keys(local), [`study-wall-draft:${ME}:lecture-1`, `study-wall-tab:${OTHER}`, "study-device-user", "study-font-size", "study-today-minutes"].sort());
    assert.deepEqual(keys(session), [`study-today:${ME}:2026-11-15`]);
    assert.equal(local.getItem("study-device-user"), ME);
    api.forgetOtherUsers(null); // signing out: every person's entries go
    assert.deepEqual(keys(local), [`study-wall-tab:${OTHER}`, "study-font-size", "study-today-minutes"].sort());
    assert.deepEqual(keys(session), []);
  } finally {
    g.localStorage = before.local;
    g.sessionStorage = before.session;
  }
});

/** A token shaped as Auth's (setSession reads its expiry). */
const jwt = (exp: number) => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, exp, role: "authenticated" })}.c2ln`;
};

test("the personal code: /api/study/code's session goes in with setSession, without a member token on the call", async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const coded = jwt(exp);
  routes["POST /api/study/code"] = () => ({ status: 200, body: { access_token: coded, refresh_token: "r-coded", expires_at: exp, user_id: USER.id } });
  assert.equal(await api.getSession(), null);
  const r = await api.redeemPersonalCode("K7QM-3XRP-W9TD-H4NA");
  assert.deepEqual(r, { userId: USER.id, same: false });
  const call = log.find((l) => l.path === "/api/study/code")!;
  assert.deepEqual(JSON.parse(call.body), { code: "K7QM-3XRP-W9TD-H4NA" });
  assert.equal(call.auth, null, "no member token: a device without a session calls it");
  assert.ok(log.some((l) => l.path === "/auth/v1/user" && l.auth === `Bearer ${coded}`), "setSession checks the token with Auth");
  const s = await api.getSession();
  assert.equal(s?.access_token, coded);
  assert.equal(s?.refresh_token, "r-coded");
  // The same member again (another link tapped): replaced, not signed out first.
  log = [];
  const again = await api.redeemPersonalCode("K7QM3XRPW9TDH4NA");
  assert.equal(again.same, true);
  assert.equal(log.filter((l) => l.path === "/auth/v1/logout").length, 0);
});

test("the personal code's refusals: 401 code not found, 429 too many tries, 503 codes off, else sign-in failed", async () => {
  const cases: Array<[Reply, string]> = [
    [{ status: 401, body: { error: "code not found" } }, "code not found"],
    [{ status: 429, body: { error: "too many tries" } }, "too many tries"],
    [{ status: 503, body: { error: "codes off" } }, "codes off"],
    [{ status: 502, body: { error: "sign-in failed" } }, "sign-in failed"],
    [{ status: 500, body: "<html>", type: "text/html" }, "sign-in failed"],
    [{ status: 200, body: { access_token: jwt(Math.floor(Date.now() / 1000) + 3600) } }, "sign-in failed"],
  ];
  for (const [reply, code] of cases) {
    routes["POST /api/study/code"] = () => reply;
    await assert.rejects(api.redeemPersonalCode("K7QM-3XRP-W9TD-H4NA"), isError(code), code);
    assert.ok(failText(code) !== failText("something new"), `${code} has a line of its own`);
  }
  assert.equal(await api.getSession(), null, "a refusal leaves the device as it was");
});
