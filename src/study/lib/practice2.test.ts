import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

/* practice2.ts's action() (plan, style, create) against a local mock of
 * Supabase Auth and of /api/study/ai: whatever the way to the server answers
 * (a platform's text page, a firewall's HTML, the database's raw message, an
 * empty 200), the screen gets a code with words of its own in "practice",
 * never the generic line, and the answer's own code travels as `raw` for the
 * small line under it (failText.ts failCode). */

type Reply = { status: number; body?: string; type?: string };
let reply: Reply = { status: 200, body: "{}" };

const USER = { id: "33333333-0000-4000-8000-000000000003", aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} };
const session = { access_token: "first", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r-first", user: USER };

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  for await (const _ of req) void _;
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const send = (r: Reply) => {
    res.writeHead(r.status, r.type ? { "content-type": r.type } : {});
    res.end(r.body ?? "");
  };
  if (path === "/auth/v1/signup") return send({ status: 200, body: JSON.stringify(session), type: "application/json" });
  if (path === "/auth/v1/user") return send({ status: 200, body: JSON.stringify(USER), type: "application/json" });
  if (path === "/rest/v1/rpc/study_join") return send({ status: 200, body: JSON.stringify([{ id: "g1", name: "g" }]), type: "application/json" });
  if (path === "/api/study/ai") return send(reply);
  send({ status: 404, body: JSON.stringify({ message: `unmocked ${path}` }), type: "application/json" });
});

let P: typeof import("./practice2");
let F: typeof import("./failText");
before(async () => {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // api.ts reads Vite's import.meta.env; bundled into this file it shares this module's import.meta.
  (import.meta as unknown as { env: Record<string, string> }).env = { VITE_SUPABASE_URL: base, VITE_SUPABASE_ANON_KEY: "anon-key" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === "string" && input.startsWith("/") ? base + input : input, init)) as typeof fetch;
  const api = await import("./api");
  P = await import("./practice2");
  F = await import("./failText");
  await api.joinGroup("ABC123", "שוהם");
});
after(() => server.close());

const LECTURE = "eeeeeeee-0000-4000-8000-000000000005";
const caught = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof Error);
    return e;
  }
  assert.fail("expected a rejection");
};
const OTHER = "לא הצלחנו. אפשר לנסות שוב.";

test("plan: every failure on the way has a line of its own in practice, and its own code under it", async () => {
  const cases: Array<[Reply, string, string]> = [
    [{ status: 504, body: "An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT", type: "text/plain" }, "server", "http_504"],
    [{ status: 500, body: "Internal Server Error" }, "server", "http_500"],
    [{ status: 403, body: "<!doctype html><title>Vercel Security Checkpoint</title>", type: "text/html" }, "blocked", "http_403"],
    [{ status: 429, body: "Too Many Requests", type: "text/plain" }, "blocked", "http_429"],
    [{ status: 500, body: JSON.stringify({ error: "permission denied for table study_points" }), type: "application/json" }, "server", "permission denied for table study_points"],
    [{ status: 500, body: JSON.stringify({ error: "no request" }), type: "application/json" }, "server", "no request"],
    [{ status: 200, body: "" }, "bad reply", "http_200"],
    [{ status: 200, body: "null", type: "application/json" }, "bad reply", "http_200"],
  ];
  for (const [r, code, raw] of cases) {
    reply = r;
    const e = await caught(P.askPlan(LECTURE));
    assert.equal(e.message, code, `${r.status} ${r.body?.slice(0, 30)}`);
    assert.equal(F.failCode(e), raw, "the answer's own code, for the line under the words");
    assert.notEqual(F.failText(e.message, "practice"), OTHER, `${code}: not the generic line`);
    assert.ok(F.hasText(e.message, "practice"), code);
  }
});

test("plan: a code the screen has words for keeps them (a 5xx with words, a 4xx), and a 200 is the answer", async () => {
  reply = { status: 500, body: JSON.stringify({ error: "missing ANTHROPIC_API_KEY" }), type: "application/json" };
  let e = await caught(P.askPlan(LECTURE));
  assert.equal(e.message, "missing ANTHROPIC_API_KEY");
  assert.equal(F.failCode(e), "missing ANTHROPIC_API_KEY");
  reply = { status: 409, body: JSON.stringify({ error: "points stale" }), type: "application/json" };
  e = await caught(P.createRequest(LECTURE, {} as never));
  assert.equal(e.message, "points stale");
  reply = { status: 401, body: JSON.stringify({ error: "session expired" }), type: "application/json" };
  e = await caught(P.askPlan(LECTURE));
  assert.equal(F.failText(e.message, "practice"), F.failText("not signed in", "practice"), "the signed-out line");
  reply = { status: 200, body: JSON.stringify({ parts: [] }), type: "application/json" };
  assert.deepEqual(await P.askPlan(LECTURE), { parts: [] });
});
