import { postStudy, sb } from "./api";
import { signPages } from "./exams";

/* ── Similar questions on the phone (release B; docs/study/sheets.md, design-exams §5.10, §5.11) ──
 *
 * VITE_STUDY_SIMILAR (flags.similar), section O 3 with L 1. The op
 * "similar" (/api/study/ai) prices a tap and starts a run under the
 * member's reservation; the members read the run's row
 * (study_similar_runs) to follow it, and an item's twins
 * (study_similar_of). When the server cannot write, the phone drives the
 * run's jobs (action "unit") while the screen is open, as past exams'
 * units. A lazy module: nothing in the entry chunk imports it. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}

async function op<T>(body: Record<string, unknown>): Promise<{ status: number; data: T }> {
  const res = await postStudy("/api/study/ai", { op: "similar", ...body });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* not json */
    }
    throw new Error(code);
  }
  return { status: res.status, data: (await res.json()) as T };
}

/** study_similar_plan's answer, as the op hands it back with the price. */
export type Plan = {
  scope: "item" | "sheet";
  root?: string;
  label?: string;
  form?: string;
  parts?: number;
  count?: number;
  room?: number;
  twins?: string[];
  items?: string[];
  more?: number;
  today?: boolean;
  joined: string | null;
  pages?: number[];
};
export type Priced = { plan: Plan; priceUsd: number; worstUsd: number };

/** What a tap would make and cost (nothing reserved). */
export const similarPlan = async (examId: string, scope: "item" | "sheet", questionId?: string): Promise<Priced> =>
  (await op<Priced>({ action: "plan", examId, scope, ...(questionId ? { questionId } : {}) })).data;

/** The op's start: a run (202), a run already making them (joined), or the item's twins first ($0). */
export type Started =
  | { kind: "run"; runId: string; setId: string | null; items: number; per: number; priceUsd: number; server: boolean }
  | { kind: "joined"; runId: string }
  | { kind: "twins"; twins: string[] };

/** The pages a run's roots draw their figures from, signed fresh (D24): without them those roots are left out. */
async function freshLinks(examId: string, pages: number[]): Promise<{ urls?: Record<string, string>; until?: string }> {
  if (!pages.length) return {};
  try {
    const { data, error } = await client().from("study_exam_pages").select("n, path").eq("exam_id", examId).in("n", pages);
    if (error || !data?.length) return {};
    return await signPages((data as Array<{ path: string }>).map((p) => p.path));
  } catch {
    return {}; // the run goes on without those roots, and says so (skipped_figs)
  }
}

export async function similarStart(o: { examId: string; scope: "item" | "sheet"; questionId?: string; make?: boolean; pages?: number[] }): Promise<Started> {
  const links = await freshLinks(o.examId, o.pages ?? []);
  const { data } = await op<Record<string, unknown>>({
    examId: o.examId,
    scope: o.scope,
    ...(o.questionId ? { questionId: o.questionId } : {}),
    ...(o.make ? { make: true } : {}),
    ...links,
  });
  if (typeof data.joined === "string") return { kind: "joined", runId: data.joined };
  if (Array.isArray(data.twins)) return { kind: "twins", twins: data.twins as string[] };
  return {
    kind: "run",
    runId: String(data.runId ?? ""),
    setId: typeof data.setId === "string" ? data.setId : null,
    items: Number(data.items ?? 0),
    per: Number(data.per ?? 1),
    priceUsd: Number(data.priceUsd ?? 0),
    server: data.server === true,
  };
}

/** A run as members read it (no links, no reservation's id). */
export type Run = {
  id: string;
  exam_id: string;
  scope: "item" | "sheet";
  items: string[];
  per: number;
  status: "running" | "done" | "failed" | "stopped";
  made: number;
  dropped: number;
  skipped_figs: number;
  error: string | null;
  charged_usd: number;
  set_id: string | null;
  created_at: string;
};
const RUN_COLUMNS = "id, exam_id, scope, items, per, status, made, dropped, skipped_figs, error, charged_usd, set_id, created_at";

export async function runOf(runId: string): Promise<Run | null> {
  const { data, error } = await client().from("study_similar_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle();
  if (error) throw new Error(error.message || "unknown");
  return (data as Run | null) ?? null;
}

/** The sheet's latest run of the whole sheet (today's, its set). */
export async function lastSheetRun(examId: string): Promise<Run | null> {
  const { data, error } = await client()
    .from("study_similar_runs")
    .select(RUN_COLUMNS)
    .eq("exam_id", examId)
    .eq("scope", "sheet")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message || "unknown");
  return ((data ?? [])[0] as Run | undefined) ?? null;
}

/** The sheet's practice set (L, kind sheet), when a run made one. */
export async function sheetSet(examId: string): Promise<string | null> {
  const { data, error } = await client()
    .from("study_similar_runs")
    .select("set_id, created_at")
    .eq("exam_id", examId)
    .not("set_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return ((data ?? [])[0] as { set_id?: string } | undefined)?.set_id ?? null;
}

/** study_similar_of: the twins of an item's root (no keys), its label and sheet, room left, a run making some. */
export type Twins = {
  root: string;
  exam_id: string;
  label: string;
  twins: Array<{ id: string; form: string; series: string | null; step: number | null; check: string | null; of: string | null }>;
  room: number;
  running: string | null;
};
export async function similarOf(questionId: string): Promise<Twins> {
  const { data, error } = await client().rpc("study_similar_of", { p_question: questionId });
  if (error) throw new Error((error as { message?: string }).message || "unknown");
  return data as Twins;
}

/** A sheet's title (members read study_exams), for a twin's chip. */
export async function sheetTitle(examId: string): Promise<string> {
  const { data, error } = await client().from("study_exams").select("title").eq("id", examId).maybeSingle();
  if (error) return "";
  return String((data as { title?: string } | null)?.title ?? "");
}

/** The phone's fallback (server false): the run's jobs one after another while the screen is open. */
export async function driveRun(runId: string, alive: () => boolean): Promise<void> {
  for (let i = 0; i < 12 && alive(); i++) {
    const { data } = await op<{ claimed: boolean; status: string | null }>({ action: "unit", runId });
    if (!data.claimed) return;
  }
}

/** A run's row kept per question on this device, so a lock or an app switch comes back to its result. */
const KEY = "study-similar-runs";
export function rememberRun(questionId: string, runId: string | null): void {
  try {
    const all = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, string>;
    if (runId) all[questionId] = runId;
    else delete all[questionId];
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage off: the result shows only while the screen stays */
  }
}
export function rememberedRun(questionId: string): string | null {
  try {
    return (JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, string>)[questionId] ?? null;
  } catch {
    return null;
  }
}
