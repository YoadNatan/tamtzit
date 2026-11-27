import { DEFAULT_MODEL } from "../../../shared/study/models";
import { health, postStudy, readLines, sb } from "./api";
import type { BoardModel, LabSettings, ModelsState, Price, Usage } from "./modelsPure";

export * from "./modelsPure";

/* ── "השוואת מודלים" on the phone (docs/study/models.md; VITE_STUDY_MODELS, section Y) ──
 *
 * The reads of section Y (study_models, study_lab_*), the op "lab"
 * (/api/study/ai: price, run, resume, retry, check, judge, route, cancel),
 * the blind rating (study_lab_rate, study_lab_reveal); the pure
 * helpers are lib/modelsPure.ts's, re-exported here. A lazy module: nothing in the entry
 * chunk imports it (tools/study-bundle.mjs, package Y). Blindness is the
 * server's (D12): nothing here ever learns which label is which model before
 * the caller's own reveal, because study_lab_run does not say. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw new Error(error.message || "network");
  return data as T;
}

/* ── Section Y's reads ── */

const num = (x: unknown, d = 0): number => (Number.isFinite(Number(x)) ? Number(x) : d);

/** study_models: the routes, the providers' consent, the switches and the month's line. */
export async function readState(group: string): Promise<ModelsState> {
  const d = (await rpc<Partial<ModelsState> | null>("study_models", { p_group: group })) ?? {};
  const l = (d.lab ?? {}) as Partial<LabSettings>;
  return {
    routes: d.routes ?? {},
    providers: d.providers ?? {},
    switches: { lab: d.switches?.lab !== false, routes: d.switches?.routes !== false },
    lab: {
      line_usd: num(l.line_usd, 3.3),
      run_cap: num(l.run_cap, 1.5),
      daily_runs: num(l.daily_runs, 3),
      member_kinds: Array.isArray(l.member_kinds) ? l.member_kinds : [],
      todo_days: num(l.todo_days, 7),
      spent_usd: num(l.spent_usd),
      runs_today: num(l.runs_today),
    },
  };
}

/** Whether the caller runs comparisons (the group's creator, or a lab admin); the server checks again. */
export const isOwner = async (group: string): Promise<boolean> => (await rpc<boolean>("study_lab_owner", { p_group: group })) === true;

export type RunRow = { id: string; route: string; title: string; status: string; created_at: string; ready: number; total: number; member_rate: boolean; mine: "todo" | "rated" | "skipped" | "old" | null; cost_usd: number | null };
export const listRuns = (group: string, limit = 50): Promise<RunRow[]> => rpc<RunRow[]>("study_lab_list", { p_group: group, p_limit: limit }).then((r) => r ?? []);
export const todoCount = (group: string): Promise<number> => rpc<number>("study_lab_todo", { p_group: group }).then((n) => num(n));

export type Checks = { pass?: boolean; items?: number; match?: number; false_rejects?: number; missing?: number; agrees?: boolean } & Record<string, unknown>;
export type Output = {
  id?: string;
  label: string;
  status?: string;
  reason?: string | null;
  tries?: number;
  text?: string | null;
  checks?: Checks;
  check_status?: string;
  model?: string | null;
  provider?: string | null;
  cost_usd?: number | null;
  usage?: Record<string, unknown> | null;
  latency_ms?: number | null;
  first_ms?: number | null;
  /** The caller's own rating (any time; never another member's). */
  my?: { overall: number; accuracy: number | null; hebrew: number | null; structure: number | null; error: boolean; note: string } | null;
  /** After the caller's reveal: the AI score (D13, its own column) and the group's ratings. */
  ai?: { overall?: number; accuracy?: number; hebrew?: number; structure?: number; errors?: Array<{ quote: string; why: string }> } | null;
  group?: { n: number; mean: number | null; errors: number } | null;
};
export type Run = {
  id: string;
  title: string;
  route: string;
  status: "running" | "done" | "cancelled";
  ready: number;
  total: number;
  source: Record<string, unknown>;
  differs: string;
  member_rate: boolean;
  created_at: string;
  estimate_usd: number | null;
  owner: boolean;
  can_rate: boolean;
  mine: { rated: boolean; best: string | null } | null;
  /** The AI score's state, after the caller's reveal: none, running, done, error. */
  judge?: string | null;
  outputs: Output[];
};
export const readRun = (run: string): Promise<Run> => rpc<Run>("study_lab_run", { p_run: run });
export type Source = { source: Record<string, unknown>; material: unknown; kept: boolean };
export const readSource = (run: string): Promise<Source> => rpc<Source>("study_lab_source", { p_run: run });
/** One answer's blind rating (one score 1-5, the error tick and its note; the owner's detail): saved when tapped. */
export const rate = (output: string, r: { overall: number; error: boolean; note: string; accuracy?: number | null; hebrew?: number | null; structure?: number | null }): Promise<void> =>
  rpc<void>("study_lab_rate", {
    p_output: output,
    p_overall: r.overall,
    p_accuracy: r.accuracy ?? null,
    p_hebrew: r.hebrew ?? null,
    p_structure: r.structure ?? null,
    p_error: r.error,
    p_note: r.note.slice(0, 300),
  });
/** The caller's reveal: after rating (with the best pick), or a skip; a kind members do not rate: the owner reveals without ratings. */
export const reveal = (run: string, best: string | null = null, skip = false): Promise<void> => rpc<void>("study_lab_reveal", { p_run: run, p_best: best, p_skip: skip });

export type Board = { route: string; today: string; models: BoardModel[]; usage30: Usage | null };
export async function readBoard(group: string, route: string): Promise<Board> {
  const b = await rpc<Board>("study_lab_board", { p_group: group, p_route: route });
  return { route: b?.route ?? route, today: b?.today ?? DEFAULT_MODEL, models: (b?.models ?? []).map(numbers), usage30: b?.usage30 ?? null };
}
function numbers(m: BoardModel): BoardModel {
  const out = { ...m } as Record<string, unknown>;
  for (const [k, v] of Object.entries(m)) if (k !== "model" && k !== "today" && v !== null && typeof v !== "boolean") out[k] = num(v);
  return out as BoardModel;
}

/** "לאשר שליחה" (or its undo) for a provider: scope all (Yoad's OD19), recorded per provider. */
export const setProvider = (group: string, provider: string, allowed: boolean): Promise<void> =>
  rpc<void>("study_model_provider_set", { p_group: group, p_provider: provider, p_allowed: allowed, p_scope: "all" });

/** Which providers' keys are set on the server (health: booleans only); null when health does not answer. */
export async function providersSet(): Promise<Record<string, boolean> | null> {
  const h = (await health()) as { providers?: Record<string, boolean>; stalePrices?: string[] } | null;
  return h?.providers ?? null;
}

/* ── The op "lab" ── */

async function op<T>(body: Record<string, unknown>): Promise<T> {
  const res = await postStudy("/api/study/ai", { op: "lab", ...body });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* not json */
    }
    throw new Error(code);
  }
  return (await res.json()) as T;
}

/** The material a run would take and each model's worst case (nothing planned or spent). */
export const price = (group: string, route: string, models?: string[], source?: Record<string, unknown>): Promise<Price> =>
  op<Price>({ action: "price", group, route, ...(models ? { models } : {}), ...(source ? { source } : {}) });

/** Sets a kind's model (null: back to the default). */
export const setRoute = (group: string, route: string, model: string | null, confirmExpensive = false): Promise<{ route: string; model: string | null }> =>
  op({ action: "route", group, route, model, note: "", ...(confirmExpensive ? { confirmExpensive: true } : {}) });

export const cancelRun = (run: string): Promise<{ cancelled: boolean }> => op({ action: "cancel", run });

/* ── A run's progress, kept while this tab lives ──
 * The run goes on on the server without the phone (D10): this is only the
 * count the stream gave last, so a screen opened again shows it at once. */
type Live = { ready: number; total: number; done: boolean };
const live = new Map<string, Live>();
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());
export const liveOf = (run: string): Live | undefined => live.get(run);
export function onLive(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Reads a run's NDJSON ({t:"run"}, {t:"progress"}, {t:"done"}) into `live`; the first line's run id resolves `started`. */
async function follow(res: Response, started?: (run: string, total: number) => void): Promise<void> {
  let id = "";
  await readLines(res, (l) => {
    const line = l as { t?: string; run?: string; ready?: number; total?: number };
    if (line.t === "run" && line.run) {
      id = line.run;
      live.set(id, { ready: 0, total: num(line.total), done: false });
      started?.(id, num(line.total));
    } else if (line.t === "progress" && id) live.set(id, { ready: num(line.ready), total: num(line.total), done: false });
    else if (line.t === "done" && id) live.set(id, { ...(live.get(id) ?? { ready: 0, total: 0 }), done: true });
    tell();
  });
}

/** Starts a run: resolves with its id once the server planned it; the count keeps coming into `live`. */
export function startRun(o: { group: string; route: string; models: string[]; source?: Record<string, unknown>; judge?: boolean }): Promise<string> {
  return new Promise((ok, fail) => {
    let given = false;
    postStudy("/api/study/ai", { op: "lab", action: "run", ...o })
      .then((res) =>
        follow(res, (run) => {
          given = true;
          ok(run);
        }),
      )
      .catch((e: unknown) => {
        if (!given) fail(e instanceof Error ? e : new Error("network"));
      })
      .finally(() => {
        if (!given) fail(new Error("network"));
      });
  });
}

/** Resume (the slots still waiting) or retry (one label that timed out or failed): the count into `live`. */
export async function continueRun(action: "resume" | "retry", run: string, label?: string): Promise<void> {
  await follow(await postStudy("/api/study/ai", { op: "lab", action, run, ...(label ? { label } : {}) }));
}

/** "לבדוק עכשיו" (the paid checks left pending) or the AI score, after the run: resolves when the server has run them. */
export async function runSteps(action: "check" | "judge", run: string): Promise<void> {
  const res = await postStudy("/api/study/ai", { op: "lab", action, run });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* not json */
    }
    throw new Error(code);
  }
  await readLines(res, () => undefined);
}
