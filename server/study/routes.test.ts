import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MODEL, modelInfo, ROUTE_KEYS, type ModelInfo } from "../../shared/study/models.js";
import { POLICY } from "./budget.js";
import { AS_OF_MS, fallbackReserve, modelFor, resetRoutes, ROUTES_TTL_MS, routeKeyFor, routeRefusal, type ModelsState } from "./routes.js";

/* routes.ts (design-models §7.3, §12.1): the default when nothing is set or
 * anything fails, the 60 s cache, the switch, the as-of rule of summaries,
 * and what a model may take. A mock PostgREST client, no network. */

process.env.STUDY_WORKER_KEY = "k-0123456789abcdef0123456789abcdef";
const G = "0f000000-0000-4000-8000-0000000000a1";
const L = "0f000000-0000-4000-8000-0000000000b1";
const T0 = Date.parse("2026-11-27T10:00:00Z");

type Call = { fn: string; args: Record<string, unknown> };
type Answer = { data?: unknown; error?: { code?: string; message: string } | null } | Error;
function mock(answers: Record<string, Answer | ((args: Record<string, unknown>) => Answer)>) {
  const calls: Call[] = [];
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const a = answers[fn];
      const r = typeof a === "function" ? a(args) : a;
      if (r instanceof Error) throw r;
      if (!r) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } };
      return { data: r.data ?? null, error: r.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}
const state = (s: Partial<ModelsState> = {}): Answer => ({ data: { routes: {}, providers: {}, switches: { lab: false, routes: true }, ...s } });

beforeEach(() => resetRoutes());

test("nothing set: the default, one read, kept 60 s; the key goes along", async () => {
  const { sb, calls } = mock({ study_models: state() });
  for (const key of ROUTE_KEYS) assert.equal(await modelFor(sb, G, key, { now: T0 }), DEFAULT_MODEL, key);
  assert.equal(calls.filter((c) => c.fn === "study_models").length, 1, "one read for every key within 60 s");
  assert.deepEqual(calls[0].args, { p_group: G, p_key: process.env.STUDY_WORKER_KEY });
  await modelFor(sb, G, "solver", { now: T0 + ROUTES_TTL_MS - 1 });
  assert.equal(calls.filter((c) => c.fn === "study_models").length, 1);
  await modelFor(sb, G, "solver", { now: T0 + ROUTES_TTL_MS });
  assert.equal(calls.filter((c) => c.fn === "study_models").length, 2, "read again after 60 s");
});

test("any error is the default and the call goes on: Y not loaded (PGRST202), a refusal, a throw", async () => {
  for (const answer of [undefined, { error: { code: "P0001", message: "forbidden" } }, new Error("fetch failed")]) {
    resetRoutes();
    const { sb } = mock(answer === undefined ? {} : { study_models: answer });
    assert.equal(await modelFor(sb, G, "solver", { now: T0 }), DEFAULT_MODEL);
    assert.equal(await modelFor(sb, G, "part", { now: T0, lectureId: L }), DEFAULT_MODEL);
  }
  // A failure is kept for 60 s too: a missing Y costs one read a minute, not one a call.
  resetRoutes();
  const { sb, calls } = mock({});
  await modelFor(sb, G, "solver", { now: T0 });
  await modelFor(sb, G, "points", { now: T0 + 1000 });
  assert.equal(calls.length, 1);
});

test("a route set: its model; another group or key: the default; a dated id is its model", async () => {
  const { sb } = mock({
    study_models: (a) => (a.p_group === G ? state({ routes: { solver: { model: "claude-haiku-5-5" }, points: { model: "claude-sonnet-5-5-20261101" } } }) : state()),
  });
  assert.equal(await modelFor(sb, G, "solver", { now: T0 }), "claude-haiku-5-5");
  assert.equal(await modelFor(sb, G, "points", { now: T0 }), "claude-sonnet-5-5");
  assert.equal(await modelFor(sb, G, "cards", { now: T0 }), DEFAULT_MODEL);
  assert.equal(await modelFor(sb, "0f000000-0000-4000-8000-0000000000a2", "solver", { now: T0 }), DEFAULT_MODEL);
});

test("the switch routes off: the default for every key, the as-of rule ignored", async () => {
  const { sb, calls } = mock({
    study_models: state({ routes: { solver: { model: "claude-haiku-5-5" }, part: { model: "claude-sonnet-5-5" } }, switches: { lab: false, routes: false } }),
    study_model_at: { data: "claude-sonnet-5-5" },
  });
  assert.equal(await modelFor(sb, G, "solver", { now: T0 }), DEFAULT_MODEL);
  assert.equal(await modelFor(sb, G, "part", { now: T0, lectureCreatedAt: new Date(T0 - 3_600_000) }), DEFAULT_MODEL);
  assert.deepEqual(
    calls.map((c) => c.fn),
    ["study_models"],
  );
});

test("as of the lecture: outline and part within 48 hours take the model they had then; after, and every other key, today's", async () => {
  const at: Call[] = [];
  const { sb } = mock({
    study_models: state({ routes: { part: { model: "claude-sonnet-5-5" }, outline: { model: "claude-sonnet-5-5" }, solver: { model: "claude-haiku-5-5" } } }),
    study_model_at: (a) => {
      at.push({ fn: "study_model_at", args: a });
      return { data: null }; // nothing was set then: the default
    },
    study_lecture_made: { data: new Date(T0 - 10 * 3_600_000).toISOString() },
  });
  const recent = new Date(T0 - 3_600_000).toISOString();
  assert.equal(await modelFor(sb, G, "part", { now: T0, lectureCreatedAt: recent }), DEFAULT_MODEL, "made before the route: the default");
  assert.equal(at[0].args.p_route, "part");
  assert.equal(at[0].args.p_at, recent);
  assert.equal(await modelFor(sb, G, "outline", { now: T0, lectureCreatedAt: recent }), DEFAULT_MODEL);
  assert.equal(await modelFor(sb, G, "part", { now: T0, lectureCreatedAt: new Date(T0 - AS_OF_MS) }), "claude-sonnet-5-5", "48 hours on: today's route");
  assert.equal(await modelFor(sb, G, "solver", { now: T0, lectureCreatedAt: recent }), "claude-haiku-5-5", "only outline and part");
  // Only the lecture's id: its moment is read once and kept.
  assert.equal(await modelFor(sb, G, "part", { now: T0, lectureId: L }), DEFAULT_MODEL);
  assert.equal(await modelFor(sb, G, "part", { now: T0 + 2 * ROUTES_TTL_MS, lectureId: L }), DEFAULT_MODEL);
  // The model at the moment is routed like any other.
  resetRoutes();
  const { sb: sb2 } = mock({ study_models: state(), study_model_at: { data: "claude-haiku-5-5" } });
  assert.equal(await modelFor(sb2, G, "part", { now: T0, lectureCreatedAt: recent }), "claude-haiku-5-5", "set then, deleted since: still the lecture's model");
  // The moment's read fails: the default.
  resetRoutes();
  const { sb: sb3 } = mock({ study_models: state({ routes: { part: { model: "claude-sonnet-5-5" } } }) });
  assert.equal(await modelFor(sb3, G, "part", { now: T0, lectureCreatedAt: recent }), DEFAULT_MODEL);
  assert.equal(await modelFor(sb3, G, "part", { now: T0, lectureId: L }), DEFAULT_MODEL, "no study_lecture_made: the default");
});

test("a route the server would not take is the default: unknown, unverified, verified organizations only", async () => {
  const { sb } = mock({
    study_models: state({ routes: { solver: { model: "claude-someday-9" }, points: { model: "openai:gpt-x" }, cards: { model: "claude-mythos-5-2" }, reword: { model: "claude-fable-5-2" } } }),
  });
  assert.equal(await modelFor(sb, G, "solver", { now: T0 }), DEFAULT_MODEL);
  assert.equal(await modelFor(sb, G, "points", { now: T0 }), DEFAULT_MODEL);
  assert.equal(await modelFor(sb, G, "cards", { now: T0 }), DEFAULT_MODEL);
  assert.equal(await modelFor(sb, G, "reword", { now: T0 }), "claude-fable-5-2", "the expensive model was confirmed when it was set");
});

test("routeRefusal: scope text, pictures, Claude-only keys, keys, approval and the price confirmation", () => {
  const opus = modelInfo(DEFAULT_MODEL)!;
  const other: ModelInfo = { ...opus, id: "openai:test-1", provider: "openai", apiId: "test-1", vision: false, serverFallback: false };
  const info = (id: string) => (id === other.id ? other : modelInfo(id));
  const ready = () => true;
  const all = { openai: { allowed: true, scope: "all" as const } };
  const text = { openai: { allowed: true, scope: "text" as const } };
  assert.equal(routeRefusal(other.id, "points", { providers: text, info, ready }), null, "text-only key, scope text");
  assert.equal(routeRefusal(other.id, "ask", { providers: text, info, ready }), "not for this kind", "members' wording");
  assert.equal(routeRefusal(other.id, "exam_solve", { providers: text, info, ready }), "not for this kind", "exam pages");
  assert.equal(routeRefusal(other.id, "notes", { providers: all, info, ready }), null, "scope all");
  assert.equal(routeRefusal(other.id, "part", { providers: all, info, ready }), "no vision", "part sends pictures");
  assert.equal(routeRefusal(other.id, "part", { providers: all, info, ready, pictures: false }), null, "a request without pictures");
  assert.equal(routeRefusal(other.id, "outline", { providers: all, info, ready }), "not for this kind", "outline: Claude only");
  assert.equal(routeRefusal(other.id, "ask_route", { providers: all, info, ready }), "not for this kind");
  assert.equal(routeRefusal(other.id, "points", { providers: {}, info, ready }), "not allowed", "not approved");
  assert.equal(routeRefusal(other.id, "points", { providers: { openai: { allowed: false, scope: "all" } }, info, ready }), "not allowed");
  assert.equal(routeRefusal(other.id, "points", { providers: all, info, ready: () => false }), "not configured");
  assert.equal(routeRefusal(other.id, "points", { providers: all, info }), "not configured", "this build has no adapter for it");
  assert.equal(routeRefusal({ ...other, verified: false }.id, "points", { providers: all, info: () => ({ ...other, verified: false }), ready }), "unverified price");
  assert.equal(routeRefusal("claude-haiku-5-5", "outline", { providers: {} }), null, "a Claude model takes every key");
  assert.equal(routeRefusal("claude-haiku-5-5", "nonsense", { providers: {} }), "bad route");
  assert.equal(routeRefusal("claude-mythos-5", "points", { providers: {} }), "bad model");
  assert.equal(routeRefusal("claude-fable-5-2", "points", { providers: {}, confirmExpensive: false }), "expensive");
  assert.equal(routeRefusal("claude-fable-5-2", "points", { providers: {}, confirmExpensive: true }), null);
});

test("routeKeyFor: every budget kind has its key, except those that call no model", () => {
  // lab: a comparison's calls are of its run's own key (study_lab_runs.route).
  const EXCLUDED = ["transcribe", "pdf", "plaque", "whoami", "lab"];
  for (const kind of Object.keys(POLICY)) {
    const key = routeKeyFor(kind, kind === "ask" ? "answer" : null);
    if (EXCLUDED.includes(kind)) assert.equal(key, null, kind);
    else assert.ok(key && (ROUTE_KEYS as readonly string[]).includes(key), `${kind} → ${key}`);
  }
  assert.equal(routeKeyFor("ask", "route"), "ask_route");
  assert.equal(routeKeyFor("bank"), "practice");
  assert.equal(routeKeyFor("exam", "unit"), "exam_read");
  assert.equal(routeKeyFor("exam", "sheet_key"), "sheet_key");
  assert.equal(routeKeyFor("lab", "run:x:0:answer"), null);
});

test("fallbackReserve: its own reservation, same kind and ref, no daily count, settled through study_settle", async () => {
  const { sb, calls } = mock({ study_reserve: { data: 41 }, study_settle: { data: true } });
  const ledger = await fallbackReserve(sb, { groupId: G, lectureId: L, kind: "solver", ref: "b1" })(0.12);
  const r = calls[0];
  assert.equal(r.fn, "study_reserve");
  assert.equal(r.args.p_kind, "solver");
  assert.equal(r.args.p_ref, "b1");
  assert.equal(r.args.p_estimate, 0.12);
  assert.equal(r.args.p_daily, null);
  await ledger({ kind: "solver", model: DEFAULT_MODEL, usage: { input_tokens: 10, output_tokens: 10 }, costUsd: 0, estimated: false });
  assert.equal(calls[1].fn, "study_settle");
  assert.equal(calls[1].args.p_id, 41);
});

test("stalePrices: a routed model checked 45 days ago or more; unknown ids left out; each once, sorted", async () => {
  const { stalePrices, STALE_PRICE_DAYS } = await import("./routes.js");
  const checked = Date.parse(`${modelInfo("claude-haiku-5-5")!.checked}T00:00:00Z`);
  assert.deepEqual(stalePrices(["claude-haiku-5-5"], checked + (STALE_PRICE_DAYS - 1) * 86_400_000), []);
  assert.deepEqual(stalePrices(["claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-5-5", "openai:x"], checked + STALE_PRICE_DAYS * 86_400_000), ["claude-haiku-5-5", "claude-sonnet-5-5"]);
});
