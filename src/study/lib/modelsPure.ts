import { DEFAULT_MODEL, MODELS, modelInfo, priceRowOn, ROUTE_RULES, type ModelInfo, type RouteKey } from "../../../shared/study/models";
import { estimateUsd } from "../../../shared/study/estimate";

/* ── "השוואת מודלים": the pure part (docs/study/models.md) ──
 * The types of section Y's reads and the helpers the owner's screens share:
 * which models a new comparison offers, the monthly projection of a route
 * (design-models §6.6), the recommendation's rule (§6.5), quality against
 * price. No network: lib/models.ts reads, this decides, and
 * lib/models.test.ts tests it without a browser. A lazy module, as
 * lib/models.ts (tools/study-bundle.mjs, package Y). */

const num = (x: unknown, d = 0): number => (Number.isFinite(Number(x)) ? Number(x) : d);

export type LabSettings = { line_usd: number; run_cap: number; daily_runs: number; member_kinds: string[]; todo_days: number; spent_usd: number; runs_today: number };
export type ModelsState = {
  routes: Record<string, { model: string; set_at: string }>;
  providers: Record<string, { allowed: boolean; scope: "text" | "all"; set_at?: string }>;
  switches: { lab: boolean; routes: boolean };
  lab: LabSettings;
};
export type BoardModel = {
  model: string;
  today: boolean;
  runs: number;
  answers: number;
  score: number | null;
  rated: number;
  flags: number;
  ai: number | null;
  ai_n: number;
  best: number;
  shared: number;
  same_or_better: number;
  refused: number;
  truncated: number;
  failed: number;
  checked: number;
  passed: number;
  items: number;
  match: number;
  false_rejects: number;
  mean_usd: number | null;
  median_usd: number | null;
  p50_ms: number | null;
};
export type Usage = Record<string, { calls: number; usd: number }>;
/** The op's price: the material, each model's worst case, the run's cap; for
 *  a rated kind the paid steps' worst cases (the solver's check of one answer,
 *  the AI score by the number of answers, index 0-4). */
export type Price = {
  route: string;
  title: string;
  source: Record<string, unknown>;
  pictures: boolean;
  models: Record<string, { usd?: number; refused?: string }>;
  runCap: number;
  steps?: { check: number; judge: number[] };
};

/* ── Pure: what a new comparison offers ── */

/** The kinds the server compares (server/study/lab.ts's LAB_ROUTES): the
 *  answer-key kinds, then the short kinds members rate and the summaries
 *  (server/study/labRated.ts). */
export const LAB_KINDS = ["solver", "fix_check", "exam_read", "sheet_read", "practice", "set_write", "points", "cards", "ask", "part"] as const;
export type LabKind = (typeof LAB_KINDS)[number];
/** The kinds a comparison rates by people (not by an answer key): the AI score is offered only for these. */
export const RATED_KINDS: ReadonlySet<string> = new Set(["practice", "set_write", "points", "cards", "ask", "part"]);
/** The four models a comparison shows first (the newest of each tier); the rest fold. */
export const FIRST_MODELS = ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
/** The candidate preselected beside today's model (OD11): Haiku for the answer-key checks, Sonnet for reading. */
export const CANDIDATE: Readonly<Record<string, string>> = {
  solver: "claude-haiku-5-5",
  fix_check: "claude-haiku-5-5",
  exam_read: "claude-sonnet-5-5",
  sheet_read: "claude-sonnet-5-5",
  // OD11: Sonnet for points first; Opus stays for summaries, practice and "לשאול" until a comparison says otherwise: Sonnet is what they are compared with.
  practice: "claude-sonnet-5-5",
  set_write: "claude-sonnet-5-5",
  points: "claude-sonnet-5-5",
  cards: "claude-sonnet-5-5",
  ask: "claude-sonnet-5-5",
  part: "claude-sonnet-5-5",
};

/** The models a comparison may offer: listed, not Mythos, Claude or a provider whose key is set and the group approved. */
export function offered(o: { providers: ModelsState["providers"]; keys: Record<string, boolean> | null; models?: readonly ModelInfo[] }): ModelInfo[] {
  return (o.models ?? MODELS).filter((m) => !m.verifiedOrgsOnly && (m.provider === "anthropic" || (o.keys?.[m.provider] === true && o.providers[m.provider]?.allowed === true)));
}

/** The first selection: today's model and the kind's candidate. */
export function preselect(route: string, today: string): string[] {
  const c = CANDIDATE[route];
  return c && c !== today ? [today, c] : [today, today === DEFAULT_MODEL ? "claude-haiku-5-5" : DEFAULT_MODEL];
}

/** The run's worst case: the sum of the picked models' estimates, with a
 *  rated kind's paid steps (the solver's check of each answer; the AI score
 *  when it is on). */
export const totalOf = (picked: readonly string[], models: Price["models"], steps?: Price["steps"], judge = false): number =>
  picked.reduce((a, id) => a + (models[id]?.usd ?? 0), 0) + (steps ? steps.check * picked.length + (judge ? (steps.judge[picked.length] ?? 0) : 0) : 0);

/* ── Pure: quality, price and the month (design-models §6.4-§6.6) ── */

/** The kinds with an answer key: the match rate is their quality. */
export const KEYED_KINDS = new Set(["solver", "fix_check", "exam_read", "sheet_read"]);

/** A model's quality on a kind, 0-1, with its n: the match rate for an answer-key kind, the group's score (of 5) otherwise. */
export function qualityOf(m: BoardModel, route: string): { q: number | null; n: number } {
  if (KEYED_KINDS.has(route)) return m.items > 0 ? { q: m.match / m.items, n: m.items } : { q: null, n: 0 };
  return m.score !== null && m.rated > 0 ? { q: m.score / 5, n: m.rated } : { q: null, n: 0 };
}

/** The ledger kinds whose last 30 days a route key's month is read from
 *  (study_lab_board's usage30 is by kind). Keys that share a kind (practice
 *  and set_write; the exam's and the sheet's keys; ask and ask_route) see
 *  the whole kind: `shared` marks those, whose month is a rough figure. */
export function kindsOf(key: string): { kinds: string[]; shared: boolean } {
  switch (key) {
    case "practice":
    case "set_write":
      return { kinds: ["practice", "bank"], shared: true };
    case "ask":
    case "ask_route":
      return { kinds: ["ask"], shared: true };
    case "exam_read":
    case "exam_key":
    case "exam_solve":
    case "sheet_read":
    case "sheet_key":
    case "sheet_solve":
      return { kinds: ["exam"], shared: true };
    case "judge":
      return { kinds: [], shared: false };
    default:
      return { kinds: [key], shared: false };
  }
}

/** A key's last 30 days: calls and dollars. */
export function month(usage: Usage | null, key: string): { calls: number; usd: number; shared: boolean } {
  const { kinds, shared } = kindsOf(key);
  let calls = 0;
  let usdSum = 0;
  for (const k of kinds) {
    calls += num(usage?.[k]?.calls);
    usdSum += num(usage?.[k]?.usd);
  }
  return { calls, usd: usdSum, shared };
}

/** A typical call's cost on a model (for the rough projection with no comparison): 20k characters in, 3k tokens out. */
export const typicalCall = (model: string): number => estimateUsd(modelInfo(model)?.id ?? DEFAULT_MODEL, 20_000, 3_000);

/** How a model's price on a later day compares with today's (its output rate, which is most of a call). */
export function priceFactor(model: string, day: string): number {
  const info = modelInfo(model);
  if (!info) return 1;
  const now = priceRowOn(info);
  const then = priceRowOn(info, day);
  return now.out > 0 ? then.out / now.out : 1;
}

/** A later-dated price row, if one starts within 60 days (the route sheet's "next month's price"). */
export function nextPrice(model: string, today = new Date().toISOString().slice(0, 10)): string | null {
  const info = modelInfo(model);
  if (!info) return null;
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10);
  const row = info.prices.find((r) => r.from && r.from > today && r.from <= limit);
  return row?.from ?? null;
}

/** The monthly projection of key K on model M (design-models §6.6):
 *  today30 × (M's mean cost a call ÷ today's, over the comparisons) + M's
 *  refusals rerun on the default + (the question check only) its false
 *  rejects' rewrites. With no comparison of both: today30 × the price ratio
 *  of a typical call, marked rough. Today's own model: today30. A key that
 *  shares its ledger kind with another is rough too. */
export function projection(o: { key: string; model: string; today: string; usage: Usage | null; board?: BoardModel[] }): { usd: number; rough: boolean; base: number } {
  const m = month(o.usage, o.key);
  const base = m.usd;
  if (o.model === o.today) return { usd: base, rough: m.shared, base };
  const cand = o.board?.find((b) => b.model === o.model);
  const now = o.board?.find((b) => b.model === o.today);
  if (!cand || !now || !cand.mean_usd || !now.mean_usd || cand.answers === 0) return { usd: (base * typicalCall(o.model)) / Math.max(typicalCall(o.today), 1e-9), rough: true, base };
  const perCall = m.calls > 0 ? base / m.calls : now.mean_usd;
  const refusals = cand.refused / cand.answers;
  let usdOut = base * (cand.mean_usd / now.mean_usd) + refusals * m.calls * perCall;
  if (o.key === "solver" && cand.items > 0) usdOut += (cand.false_rejects / cand.items) * m.calls * REWRITE_USD;
  return { usd: usdOut, rough: m.shared, base };
}
/** A rewrite after a false reject (practice's automatic rewrite), when the ledger has none to average (§6.6). */
export const REWRITE_USD = 0.2;

/** "פי k": one decimal under 10, whole above. */
export const times = (k: number): string => (k >= 10 ? String(Math.round(k)) : (Math.round(k * 10) / 10).toString());

/** The recommendation's rule (design-models §6.5): a model that is cheaper
 *  by 20% or more and holds against today's. Answer-key kinds: 20 checked
 *  items each, the match rate at most 2 points under today's, no more false
 *  rejects a question. Rated kinds: 5 shared runs, "same or better" in 80%,
 *  no more flagged errors. null: nothing to recommend (yet). */
export type Recommendation = { model: string; times: number; keyed: boolean; a: number; b: number; n: number; small: boolean };
export function recommend(o: { route: string; today: string; models: BoardModel[]; usage: Usage | null }): Recommendation | null {
  const now = o.models.find((m) => m.model === o.today);
  if (!now || !now.mean_usd) return null;
  const keyed = KEYED_KINDS.has(o.route);
  let best: Recommendation | null = null;
  for (const m of o.models) {
    if (m.model === o.today || !m.mean_usd) continue;
    const p = projection({ key: o.route, model: m.model, today: o.today, usage: o.usage, board: o.models });
    const cheaper = p.base > 0 ? p.usd < 0.8 * p.base : m.mean_usd < 0.8 * now.mean_usd;
    if (!cheaper) continue;
    const k = now.mean_usd / m.mean_usd;
    if (keyed) {
      if (m.items < 20 || now.items < 20) continue;
      const rate = m.match / m.items;
      const was = now.match / now.items;
      if (rate < was - 0.02) continue;
      if (m.false_rejects / m.items > now.false_rejects / now.items) continue;
      const r: Recommendation = { model: m.model, times: k, keyed, a: Math.round(rate * 100), b: Math.round(was * 100), n: m.items, small: m.items < 50 };
      if (!best || r.times > best.times) best = r;
    } else {
      if (m.shared < 5 || m.same_or_better < 0.8 * m.shared) continue;
      if (m.flags > now.flags) continue;
      const r: Recommendation = { model: m.model, times: k, keyed, a: m.same_or_better, b: m.shared, n: m.shared, small: m.shared < 10 };
      if (!best || r.times > best.times) best = r;
    }
  }
  return best;
}

/** Too few to decide (C33): an answer-key kind under 20 checked items, a rated kind under 5 runs. */
export function tooFew(route: string, m: BoardModel): boolean {
  return KEYED_KINDS.has(route) ? m.items < 20 : m.runs < 5;
}

/** May a key take this model in production (the server's routeRefusal decides; this hides what it would refuse)? */
export function routable(key: string, m: ModelInfo, o: { providers: ModelsState["providers"]; keys: Record<string, boolean> | null }): boolean {
  if (!m.verified || m.verifiedOrgsOnly) return false;
  const rule = ROUTE_RULES[key as RouteKey];
  if (!rule) return false;
  if (rule.anthropicOnly && m.provider !== "anthropic") return false;
  if (rule.pictures && !m.vision) return false;
  if (m.provider !== "anthropic") {
    const p = o.providers[m.provider];
    if (o.keys?.[m.provider] !== true || p?.allowed !== true) return false;
    if (p.scope === "text" && (rule.pictures || rule.memberText || rule.exam)) return false;
  }
  return true;
}

/** The day a date shows as ("26.11"). */
export const dayOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" });
};

/** The providers this build knows, with their keys' variable names (C42b). */
export const PROVIDERS: ReadonlyArray<{ id: string; name: string; env: string }> = [
  { id: "openai", name: "OpenAI", env: "OPENAI_API_KEY" },
  { id: "google", name: "Google", env: "GEMINI_API_KEY" },
  { id: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY" },
];

/** The newest date any of a provider's models' prices were checked. */
export function checkedOf(provider: string, models: readonly ModelInfo[] = MODELS): string | null {
  const ds = models.filter((m) => m.provider === provider).map((m) => m.checked);
  return ds.length ? ds.sort()[ds.length - 1] : null;
}

/** A price checked 45 days ago or more (D16). */
export const staleDate = (checked: string, today = new Date().toISOString().slice(0, 10)): boolean =>
  Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checked}T00:00:00Z`) >= 45 * 86_400_000;

/* ── The draft of a new comparison's choice, per device (try/catch: private mode) ── */
const PICK_KEY = "study-models-pick";
export function savedPick(route: string): string[] | null {
  try {
    const all = JSON.parse(localStorage.getItem(PICK_KEY) ?? "{}") as Record<string, string[]>;
    return Array.isArray(all[route]) ? all[route].filter((x) => typeof x === "string").slice(0, 4) : null;
  } catch {
    return null;
  }
}
export function savePick(route: string, picked: string[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(PICK_KEY) ?? "{}") as Record<string, string[]>;
    all[route] = picked.slice(0, 4);
    localStorage.setItem(PICK_KEY, JSON.stringify(all));
  } catch {
    /* private mode: no draft */
  }
}

/* ── The blind rating (design-models §5.5, OD6) ── */

/** One answer's rating as the caller gives it: one score 1-5, the error
 *  tick and its note; the owner's optional detail. `sent`: the server has it. */
export type Rating = { overall: number | null; error: boolean; note: string; accuracy?: number | null; hebrew?: number | null; structure?: number | null; sent?: boolean };
/** The caller's rating of a run: by answer id, and the best pick (a label, "=" no difference). */
export type RateDraft = { by: Record<string, Rating>; best: string | null };

const DRAFT_KEY = (run: string) => `study-models-rate:${run}`;
/** The draft of a run's rating on this device (try/catch: private mode), or an empty one. */
export function loadDraft(run: string): RateDraft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY(run)) ?? "null") as RateDraft | null;
    if (d && typeof d === "object" && d.by && typeof d.by === "object") return { by: d.by, best: typeof d.best === "string" ? d.best : null };
  } catch {
    /* none */
  }
  return { by: {}, best: null };
}
export function saveDraft(run: string, d: RateDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY(run), JSON.stringify(d));
  } catch {
    /* private mode: no draft */
  }
}
export function dropDraft(run: string): void {
  try {
    localStorage.removeItem(DRAFT_KEY(run));
  } catch {
    /* nothing kept */
  }
}

/** The draft joined with what the server already has (study_lab_run's `my`): the server's wins where the device has nothing newer. */
export function mergeDraft(d: RateDraft, mine: ReadonlyArray<{ id?: string; my?: { overall: number; error: boolean; note: string; accuracy?: number | null; hebrew?: number | null; structure?: number | null } | null }>): RateDraft {
  const by = { ...d.by };
  for (const o of mine) {
    if (!o.id || !o.my) continue;
    const local = by[o.id];
    if (!local || local.sent) by[o.id] = { overall: o.my.overall, error: o.my.error, note: o.my.note ?? "", accuracy: o.my.accuracy ?? null, hebrew: o.my.hebrew ?? null, structure: o.my.structure ?? null, sent: true };
  }
  return { by, best: d.best };
}

/** The first answer (in label order) still without a score; null when every one has one. */
export const missingScore = (ids: ReadonlyArray<{ id?: string; label: string }>, d: RateDraft): string | null => ids.find((o) => !o.id || !d.by[o.id]?.overall)?.label ?? null;

/* ── An answer as the app shows it, for rating ── */

export type ShownQuestion = { vignette: string; question: string; options: Array<{ text: string; correct: boolean }>; takeaway: string };
export type Shown =
  | { kind: "questions"; items: ShownQuestion[] }
  | { kind: "points"; items: Array<{ subject: string; text: string; red: boolean }> }
  | { kind: "cards"; items: Array<{ front: string; back: string }> }
  | { kind: "text"; text: string };

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** An answer's text in the shape its kind shows: questions with their options, points, cards, or text. */
export function shownOf(route: string, text: string | null | undefined): Shown {
  const t = text ?? "";
  let doc: Record<string, unknown> | null = null;
  try {
    doc = rec(JSON.parse(t));
  } catch {
    doc = null;
  }
  if (doc && (route === "practice" || route === "set_write") && Array.isArray(doc.questions))
    return {
      kind: "questions",
      items: arr(doc.questions).map((q) => {
        const x = rec(q);
        return { vignette: str(x.vignette), question: str(x.question), options: arr(x.options).map((o) => ({ text: str(rec(o).text), correct: rec(o).correct === true })), takeaway: str(x.takeaway) };
      }),
    };
  if (doc && route === "points" && Array.isArray(doc.points))
    return { kind: "points", items: arr(doc.points).map((p) => ({ subject: str(rec(p).subject), text: str(rec(p).text), red: rec(p).red_flag === true })) };
  if (doc && route === "cards" && Array.isArray(doc.cards))
    return { kind: "cards", items: arr(doc.cards).map((c) => ({ front: str(rec(c).front).replace(/\{\{(.*?)\}\}/g, "___"), back: str(rec(c).back) || (str(rec(c).front).match(/\{\{(.*?)\}\}/)?.[1] ?? "") })) };
  if (doc) return { kind: "text", text: JSON.stringify(doc, null, 2) };
  return { kind: "text", text: t };
}

/** The codes of a run's `differs` (server/study/labRated.ts), one by one. */
export const differsOf = (d: string | null | undefined): string[] => (d ?? "").split(",").map((x) => x.trim()).filter(Boolean);
