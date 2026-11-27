import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MODEL, modelInfo, priceOf, ROUTE_KEYS, ROUTE_RULES, scopeAllows, type ModelInfo, type Provider, type RouteKey } from "../../shared/study/models.js";
import { reserve } from "./budget.js";
import { settleFor, type FallbackReserve, type Spend } from "./claude.js";
import { providerReady } from "./llm/index.js";
import { workerKey } from "./study.js";

/* ── Routing in production (design-models §7.3, D7, D22, D23; WP4) ──
 *
 * Every paid call asks modelFor which model its route key (a kind of work,
 * shared/study/models.ts's ROUTE_KEYS) runs on in its group. With nothing
 * set, or anything wrong, the answer is DEFAULT_MODEL, and the call is
 * exactly today's:
 *   1. study_models (section Y) once per instance and group every 60 s.
 *      Any error (Y not loaded, PGRST202, a network failure) is the default,
 *      with one log line per instance (D22): Y is optional for every path.
 *   2. The switch `routes` off: the default for every key (D23).
 *   3. outline and part, for a lecture made less than 48 hours ago: the
 *      model the key had when the lecture was made (study_model_at), so one
 *      summary is never written by two models (D7). The same error rule.
 *   4. The default, with one log line, when the model is not in the
 *      registry, its price is unverified, it serves only organizations
 *      Anthropic verified, its provider has no key or adapter here, the
 *      group did not approve the provider or its scope does not take the
 *      key, it cannot read pictures the key sends, or the key takes Claude
 *      models only (outline, ask_route: not made through run(), D5).
 *
 * fallbackReserve is D8's reservation for the rerun on the default
 * (claude.ts's run() asks for it only when it is needed).
 */

export const ROUTES_TTL_MS = 60_000;
/** outline and part keep the model of their lecture's first 48 hours (D7). */
export const AS_OF_MS = 48 * 3_600_000;

export type ProviderState = { allowed?: boolean; scope?: "text" | "all" };
/** study_models' answer, the parts modelFor reads. */
export type ModelsState = {
  routes: Record<string, { model?: string | null; set_at?: string } | undefined>;
  providers: Record<string, ProviderState | undefined>;
  switches: { lab?: boolean; routes?: boolean };
};

/** Why a model cannot take a key (the op lab's route action words each one, MODELS_FAIL). */
export type RouteRefusal = "bad route" | "bad model" | "unverified price" | "not for this kind" | "not configured" | "not allowed" | "no vision" | "expensive";

/** May `model` take `key` in a group whose providers are these? null: yes.
 *  `confirmExpensive` (the route action): false refuses a model about twice
 *  the default's price (OD14); left out, the price is not asked about. */
export function routeRefusal(
  model: string,
  key: string,
  o: {
    providers: ModelsState["providers"];
    pictures?: boolean;
    confirmExpensive?: boolean;
    env?: Record<string, string | undefined>;
    /** The registry and the providers' readiness (tests give their own). */
    info?: (model: string) => ModelInfo | null;
    ready?: (p: Provider) => boolean;
  },
): RouteRefusal | null {
  if (!(ROUTE_KEYS as readonly string[]).includes(key)) return "bad route";
  const rule = ROUTE_RULES[key as RouteKey];
  const m = (o.info ?? modelInfo)(model);
  if (!m || m.verifiedOrgsOnly) return "bad model";
  if (!m.verified) return "unverified price";
  if (rule.anthropicOnly && m.provider !== "anthropic") return "not for this kind";
  if (m.provider !== "anthropic") {
    if (!(o.ready ? o.ready(m.provider) : providerReady(m.provider, o.env))) return "not configured";
    const p = o.providers[m.provider];
    if (p?.allowed !== true) return "not allowed";
    if (!scopeAllows(p.scope === "text" ? "text" : "all", key as RouteKey)) return "not for this kind";
  }
  if ((o.pictures ?? Boolean(rule.pictures)) && !m.vision) return "no vision";
  if (o.confirmExpensive === false && m.expensive) return "expensive";
  return null;
}

type Cached = { at: number; state: Promise<ModelsState | null> };
const states = new Map<string, Cached>();
const asOf = new Map<string, { at: number; model: Promise<string | null | undefined> }>();
const logged = new Set<string>();

/** One log line per instance for each reason. */
function logOnce(key: string, line: string): void {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(line);
}

/** For tests: forget the cached answers and the lines already logged. */
export function resetRoutes(): void {
  states.clear();
  asOf.clear();
  made.clear();
  logged.clear();
}

/** The key goes along when the server has it (the worker's anon client
 *  needs it; a member's client is answered as a member either way). */
const withKey = <T extends Record<string, unknown>>(args: T) => ({ ...args, p_key: workerKey() || null });

function readState(sb: SupabaseClient, groupId: string): Promise<ModelsState | null> {
  return (async () => {
    try {
      const { data, error } = await sb.rpc("study_models", withKey({ p_group: groupId }));
      if (error) {
        logOnce(`models:${error.code ?? error.message}`, `routes: study_models failed (${error.code ?? ""} ${error.message}); every key uses ${DEFAULT_MODEL}`);
        return null;
      }
      const d = (data ?? {}) as Partial<ModelsState>;
      return { routes: d.routes ?? {}, providers: d.providers ?? {}, switches: d.switches ?? {} };
    } catch (e) {
      logOnce("models:throw", `routes: study_models failed (${e instanceof Error ? e.message : String(e)}); every key uses ${DEFAULT_MODEL}`);
      return null;
    }
  })();
}

/** The group's routes, providers and switches, cached 60 s (null: unknown, so the default). */
export function modelsState(sb: SupabaseClient, groupId: string, now = Date.now()): Promise<ModelsState | null> {
  const c = states.get(groupId);
  if (c && now - c.at < ROUTES_TTL_MS) return c.state;
  const state = readState(sb, groupId);
  states.set(groupId, { at: now, state });
  return state;
}

/** The model a key had at a moment (null: the default; undefined: unknown). */
function modelAt(sb: SupabaseClient, groupId: string, key: string, at: Date, now: number): Promise<string | null | undefined> {
  const id = `${groupId} ${key} ${at.toISOString()}`;
  const c = asOf.get(id);
  if (c && now - c.at < ROUTES_TTL_MS) return c.model;
  const model = (async () => {
    try {
      const { data, error } = await sb.rpc("study_model_at", withKey({ p_group: groupId, p_route: key, p_at: at.toISOString() }));
      if (error) {
        logOnce(`at:${error.code ?? error.message}`, `routes: study_model_at failed (${error.code ?? ""} ${error.message}); ${key} uses ${DEFAULT_MODEL}`);
        return undefined;
      }
      return typeof data === "string" && data ? data : null;
    } catch (e) {
      logOnce("at:throw", `routes: study_model_at failed (${e instanceof Error ? e.message : String(e)}); ${key} uses ${DEFAULT_MODEL}`);
      return undefined;
    }
  })();
  asOf.set(id, { at: now, model });
  return model;
}

const made = new Map<string, { at: number; made: Promise<Date | null | undefined> }>();

/** When a lecture was made (study_lecture_made; undefined: unknown). A
 *  lecture's moment never changes, so an answer is kept for the instance;
 *  a failure is asked again after 60 s. */
function lectureMade(sb: SupabaseClient, lectureId: string, now: number): Promise<Date | null | undefined> {
  const c = made.get(lectureId);
  if (c && now - c.at < ROUTES_TTL_MS) return c.made;
  const p = (async () => {
    try {
      const { data, error } = await sb.rpc("study_lecture_made", withKey({ p_lecture: lectureId }));
      if (error) {
        logOnce(`made:${error.code ?? error.message}`, `routes: study_lecture_made failed (${error.code ?? ""} ${error.message}); summaries use ${DEFAULT_MODEL}`);
        return undefined;
      }
      return dateOf(data as string | null);
    } catch (e) {
      logOnce("made:throw", `routes: study_lecture_made failed (${e instanceof Error ? e.message : String(e)}); summaries use ${DEFAULT_MODEL}`);
      return undefined;
    }
  })();
  made.set(lectureId, { at: now, made: p });
  void p.then((d) => {
    if (d !== undefined) made.set(lectureId, { at: Infinity, made: p }); // an answer is never stale
  });
  return p;
}

/** A lecture's created_at as a date, or null. */
function dateOf(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** The model a call of `key` runs on in the group (see the file's head).
 *  Never throws: anything it cannot read is DEFAULT_MODEL. */
export async function modelFor(
  sb: SupabaseClient,
  groupId: string,
  key: RouteKey,
  o: { lectureId?: string | null; lectureCreatedAt?: string | number | Date | null; pictures?: boolean; now?: number } = {},
): Promise<string> {
  try {
    const now = o.now ?? Date.now();
    const state = await modelsState(sb, groupId, now);
    if (!state || state.switches.routes === false) return DEFAULT_MODEL;
    let model: string | null | undefined = state.routes[key]?.model ?? null;
    if (key === "outline" || key === "part") {
      // D7: the lecture's moment (given, or read when only its id is), then the key's model then.
      let at: Date | null | undefined = dateOf(o.lectureCreatedAt);
      if (!at && o.lectureId) at = await lectureMade(sb, o.lectureId, now);
      if (at === undefined) return DEFAULT_MODEL;
      if (at && now - at.getTime() < AS_OF_MS) {
        model = await modelAt(sb, groupId, key, at, now);
        if (model === undefined) return DEFAULT_MODEL;
      }
    }
    if (!model) return DEFAULT_MODEL;
    const refused = routeRefusal(model, key, { providers: state.providers, pictures: o.pictures });
    if (refused) {
      logOnce(`route:${key}:${model}:${refused}`, `routes: ${key} is set to ${model.slice(0, 80)} (${refused}); it uses ${DEFAULT_MODEL}`);
      return DEFAULT_MODEL;
    }
    return modelInfo(model)!.id;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** The dearest of these models (its output, then its input price): what a
 *  budget hold over several keys counts, so a hold is never smaller than
 *  what its units reserve. */
export function dearest(models: readonly string[]): string {
  let best = DEFAULT_MODEL;
  for (const m of models) {
    const a = priceOf(m);
    const b = priceOf(best);
    if (a.out > b.out || (a.out === b.out && a.in > b.in)) best = m;
  }
  return best;
}

/** The model a hold over these keys counts (dearest of their routes; the default when nothing is set). */
export async function holdModel(sb: SupabaseClient, groupId: string, keys: readonly RouteKey[]): Promise<string> {
  return dearest(await Promise.all(keys.map((k) => modelFor(sb, groupId, k))));
}

/** A past exam's keys, and an uploaded sheet's. */
export const EXAM_KEYS = ["exam_read", "exam_key", "exam_solve"] as const satisfies readonly RouteKey[];
export const SHEET_KEYS = ["sheet_read", "sheet_key", "sheet_solve"] as const satisfies readonly RouteKey[];

/** A price checked this many days ago or more is flagged (D16). */
export const STALE_PRICE_DAYS = 45;

/** The routed models whose registry price was checked STALE_PRICE_DAYS or
 *  more days ago (/api/study/health's stalePrices); ids only, sorted. */
export function stalePrices(routed: readonly string[], now: number = Date.now()): string[] {
  const out = new Set<string>();
  for (const id of routed) {
    const m = modelInfo(id);
    if (!m) continue;
    const checked = Date.parse(`${m.checked}T00:00:00Z`);
    if (Number.isFinite(checked) && now - checked >= STALE_PRICE_DAYS * 86_400_000) out.add(m.id);
  }
  return [...out].sort();
}

/** D8's own reservation for a rerun on the default: the same group,
 *  lecture, kind and ref as the call, without the daily count (the call
 *  already counted), settled through settleFor. `onFail` counts a settle
 *  that failed, as the call's own ledger does; `onSpend` sees the rerun's
 *  spend (a batch's cost, its serving model). */
export function fallbackReserve(
  sb: SupabaseClient,
  r: { groupId: string; lectureId?: string | null; kind: string; ref?: string | null },
  onFail?: () => void,
  onSpend?: (s: Spend) => void,
): FallbackReserve {
  return async (estimateUsd) => {
    const id = await reserve(sb, { groupId: r.groupId, lectureId: r.lectureId ?? null, kind: r.kind, ref: r.ref ?? null, estimateUsd, daily: false });
    const settle = settleFor(sb, id, onFail);
    return onSpend
      ? async (s) => {
          onSpend(s);
          return settle(s);
        }
      : settle;
  };
}

/** The route key of a ledger row (kind and ref), or null for a kind that
 *  makes no model call of its own (transcribe, pdf) or is a 501 stub
 *  (plaque, whoami), and for a comparison's rows (kind lab: the run's own
 *  key is study_lab_runs.route). The bank's write batch (kind bank) is
 *  practice's writing; a past exam's read and key units share the ref
 *  "unit", counted as exam_read; a sheet's units carry their key as ref. */
export function routeKeyFor(kind: string, ref?: string | null): RouteKey | null {
  switch (kind) {
    case "outline":
    case "part":
    case "notes":
    case "practice":
    case "solver":
    case "reword":
    case "style":
    case "points":
    case "cards":
    case "mnemonic":
    case "wall_check":
    case "fix_check":
    case "var":
    case "trap_check":
    case "similar":
      return kind;
    case "ask":
      return ref === "route" ? "ask_route" : "ask";
    case "bank":
      return "practice";
    case "exam":
      if (ref === "sheet_read" || ref === "sheet_key" || ref === "sheet_solve") return ref;
      if (ref === "key") return "exam_key";
      if (ref === "solve") return "exam_solve";
      return "exam_read";
    default: // lab: a comparison's calls are of the run's own key (study_lab_runs.route)
      return null;
  }
}
