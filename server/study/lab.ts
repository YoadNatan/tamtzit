import type Anthropic from "@anthropic-ai/sdk";
import { modelInfo, scopeAllows, type ModelInfo, type Provider, type RouteKey } from "../../shared/study/models.js";
import { estimateUsd, imageTokens } from "./budget.js";
import type { Effort } from "./claude.js";
import { unitCall, type ExamClaim, type ExamPage } from "./exams.js";
import { FixCheck, fixCheckOpts } from "./ops/fixcheck.js";
import { fixCheckRequest } from "./prompts/collab.js";
import { ExamItem, ExamItems, SheetItem, SheetItems } from "./questions.js";
import { sheetCall } from "./sheets.js";
import { judgeItems, solverCall, SolverAnswerIn, withTwins, type SolverAnswer, type SolverItem } from "./solver.js";
import { LAB_UNVERIFIED_FACTOR } from "./limits.js";
import { providerReady } from "./llm/index.js";
import type { Lecture } from "./study.js";

/* ── "השוואת מודלים" on the server: frozen requests, estimates, checks
 *    (design-models §7.5-§7.6, D11, D12, D15, D16; WP5) ──
 *
 * A comparison sends one frozen request to 2-4 models. The request is
 * built once by the production builders and kept in study_lab_runs.request
 * (only the server reads it back, through study_lab_slot): for the kinds
 * with an answer key it is production's request exactly (no differences),
 * pictures stored as their paths and signed again for each call (D11).
 * Next to it, the request keeps `material` (what the phone may show,
 * study_lab_source: never a key) and `key` (what the $0 checks compare an
 * answer with: the bank's keys, the group's decision, the reviewed items).
 *
 * The comparable kinds of this package (slice 2, the answer-key kinds):
 *   solver      the question check, on bank questions with their keys
 *   fix_check   a decided correction, against the group's decision
 *   exam_read   a past exam's pages, against the items the group reviewed
 *   sheet_read  an uploaded sheet's pages, against its saved items
 * Everything here is pure; ops/lab.ts reads the material and runs the slots.
 */

export const LAB_ROUTES = ["solver", "fix_check", "exam_read", "sheet_read"] as const satisfies readonly RouteKey[];
export type LabRoute = (typeof LAB_ROUTES)[number];
export const isLabRoute = (r: unknown): r is LabRoute => typeof r === "string" && (LAB_ROUTES as readonly string[]).includes(r);
/** The routes whose requests send pictures (a model without vision cannot take them). */
export const LAB_PICTURES: Readonly<Record<LabRoute, boolean>> = { solver: false, fix_check: false, exam_read: true, sheet_read: true };

/** A picture of a frozen request: its storage path behind this prefix, signed per call. */
export const PATH_URL = "study-path:";

type TextBlock = Anthropic.Beta.BetaTextBlockParam;
type Message = Anthropic.Beta.BetaMessageParam;
type Format = { type: "json_schema"; schema: Record<string, unknown> };

/** One reference item of a read (exam_read, sheet_read): its number or label, text, option count, figure. */
export type RefItem = { id: string; question: string; options: number; figure: boolean; page: number | null };
export type LabKey =
  | { route: "solver"; items: Array<{ answer: number | null; seq: number[] | null; options: number; image: boolean; without: boolean }>; asked: number }
  | { route: "fix_check"; expected: boolean; decision: "applied" | "withdrawn" }
  | { route: "exam_read" | "sheet_read"; items: RefItem[] };

/** The frozen request, as study_lab_runs.request keeps it. */
export type Frozen = {
  v: 1;
  route: LabRoute;
  /** The ledger's kind of the production call (the request is the same; a comparison reserves as kind lab). */
  kind: string;
  system: TextBlock[];
  messages: Message[];
  effort: Effort;
  maxTokens: number;
  format?: Format;
  /** The pictures' tokens at their stored size, for the estimate. */
  imageTokens: number;
  /** What the phone may show ("החומר"): never a key. */
  material: Record<string, unknown>;
  key: LabKey;
};

/** How a frozen request of this package differs from production: in nothing
 *  (D15's smaller caps are for the long kinds of WP8). */
export const DIFFERS: Readonly<Record<LabRoute, string>> = { solver: "", fix_check: "", exam_read: "", sheet_read: "" };

/** The run's title: the kind's one Hebrew name (design-models §9.1) and its material. */
export const LAB_NAMES: Readonly<Record<LabRoute, string>> = {
  solver: "הבדיקה של השאלות",
  fix_check: "בדיקת תיקון",
  exam_read: "קריאת מבחן",
  sheet_read: "קריאת דף תרגילים",
};

/** May `model` answer a comparison of `route`? null: yes. Unlike a
 *  production route (routes.ts's routeRefusal), an unverified price is
 *  allowed (estimated × 1.5, D16) and so is an expensive model (OD14);
 *  Mythos and any id the registry does not list are not. A provider other
 *  than Anthropic needs its key and an adapter in this build, the group's
 *  "לאשר שליחה" and a scope that takes the kind. */
export function labRefusal(
  model: string,
  route: LabRoute,
  o: {
    providers: Record<string, { allowed?: boolean; scope?: "text" | "all" } | undefined>;
    pictures: boolean;
    info?: (m: string) => ModelInfo | null;
    ready?: (p: Provider) => boolean;
  },
): "bad model" | "not configured" | "not allowed" | "not for this kind" | "no vision" | null {
  const m = (o.info ?? modelInfo)(model);
  if (!m || m.verifiedOrgsOnly) return "bad model";
  if (m.provider !== "anthropic") {
    if (!(o.ready ?? providerReady)(m.provider)) return "not configured";
    const p = o.providers[m.provider];
    if (p?.allowed !== true) return "not allowed";
    if (!scopeAllows(p.scope === "text" ? "text" : "all", route)) return "not for this kind";
  }
  if (o.pictures && !m.vision) return "no vision";
  return null;
}

/* ── Pictures: stored as paths, signed per call ── */

/** Every path a frozen request's pictures name. */
export function picturePaths(f: Pick<Frozen, "messages">): string[] {
  const out = new Set<string>();
  for (const m of f.messages)
    if (Array.isArray(m.content))
      for (const b of m.content) if (b.type === "image" && b.source.type === "url" && b.source.url.startsWith(PATH_URL)) out.add(b.source.url.slice(PATH_URL.length));
  return [...out];
}

/** The messages with each signed picture URL swapped for its path (freezing). */
function toPaths(messages: Message[], pathOfUrl: ReadonlyMap<string, string>): Message[] {
  return messages.map((m): Message =>
    Array.isArray(m.content)
      ? ({
          ...m,
          content: m.content.map((b) =>
            b.type === "image" && b.source.type === "url" && pathOfUrl.has(b.source.url) ? { ...b, source: { type: "url" as const, url: PATH_URL + pathOfUrl.get(b.source.url)! } } : b,
          ),
        } as Message)
      : m,
  );
}

/** The request as a call sends it: each path signed (`urls`, path → URL).
 *  Null when a picture has no URL (the slot fails as "pictures"). */
export function thaw(f: Frozen, urls: ReadonlyMap<string, string>): Pick<Frozen, "system" | "messages" | "effort" | "maxTokens" | "format"> | null {
  let missing = false;
  const messages = f.messages.map((m): Message =>
    Array.isArray(m.content)
      ? ({
          ...m,
          content: m.content.map((b) => {
            if (b.type !== "image" || b.source.type !== "url" || !b.source.url.startsWith(PATH_URL)) return b;
            const url = urls.get(b.source.url.slice(PATH_URL.length));
            if (!url) missing = true;
            return { ...b, source: { type: "url" as const, url: url ?? "" } };
          }),
        } as Message)
      : m,
  );
  if (missing) return null;
  return { system: f.system, messages, effort: f.effort, maxTokens: f.maxTokens, ...(f.format ? { format: f.format } : {}) };
}

/** The hash a run keeps of its request (study_lab_runs.request_hash): the parts a model reads. */
export async function requestHash(f: Pick<Frozen, "system" | "messages" | "effort" | "maxTokens" | "format">): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ system: f.system, messages: f.messages, effort: f.effort, maxTokens: f.maxTokens, format: f.format ?? null }));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── The builders (production's own, §7.6) ── */

/** A bank question as study_lab_bank gives it, with its key. */
export type BankItem = {
  id: string;
  vignette: string;
  question: string;
  options: string[];
  form?: string | null;
  prompts?: string[] | null;
  style?: string | null;
  figure?: string | null;
  answer: number | null;
  seq: number[] | null;
};
const SET_FORMS = new Set(["tf", "match", "order"]);

/** A picture's storage path in the lecture (fig:N-K), or null. */
export function figurePath(lecture: Pick<Lecture, "slides">, figure: string | null | undefined): string | null {
  const m = /^fig:(\d+)-(\d+)$/.exec(figure ?? "");
  if (!m) return null;
  const f = lecture.slides.find((s) => s.n === Number(m[1]))?.figures?.find((x) => x.k === Number(m[2]));
  return f?.path || null;
}

/** A bank question as the blind solver sees it (practice.ts's solverItemOf): its
 *  public text, a set question's form, an image item's picture by its path. */
export function bankSolverItem(lecture: Pick<Lecture, "slides">, q: BankItem): SolverItem {
  const form = q.form && SET_FORMS.has(q.form) ? q.form : undefined;
  const path = q.style === "image" ? figurePath(lecture, q.figure) : null;
  return {
    vignette: q.vignette ?? "",
    question: q.question,
    options: q.options,
    answer: q.answer,
    ...(form ? { form, seq: q.seq ?? [] } : {}),
    ...(form === "match" && q.prompts?.length ? { prompts: q.prompts } : {}),
    ...(q.style === "image" ? (path ? { image: PATH_URL + path } : { withoutPicture: true }) : {}),
  };
}

/** The question check's frozen request: solverCall over the questions (and
 *  each image question again without its picture), exactly as solveQuestions
 *  sends it; the keys stay in `key`. */
export function solverFrozen(lecture: Pick<Lecture, "id" | "title" | "lecturer" | "slides">, bank: readonly BankItem[]): Frozen {
  const items = bank.map((q) => bankSolverItem(lecture, q));
  const { all } = withTwins(items);
  const call = solverCall({ lecture, items: all });
  return {
    v: 1,
    route: "solver",
    kind: "solver",
    system: call.system,
    messages: call.messages,
    effort: call.output_config.effort,
    maxTokens: call.max_tokens,
    format: call.output_config.format,
    imageTokens: items.filter((it) => it.image).length * imageTokens(),
    material: {
      lecture: lecture.id,
      title: lecture.title,
      items: bank.map((q) => ({
        vignette: q.vignette ?? "",
        question: q.question,
        options: q.options,
        ...(q.form && SET_FORMS.has(q.form) ? { form: q.form } : {}),
        ...(q.prompts?.length ? { prompts: q.prompts } : {}),
        ...(q.style === "image" && q.figure ? { figure: q.figure } : {}),
      })),
    },
    key: {
      route: "solver",
      items: all.map((it) => ({ answer: it.answer, seq: it.seq ? [...it.seq] : null, options: it.options.length, image: Boolean(it.image), without: Boolean(it.withoutPicture) })),
      asked: items.length,
    },
  };
}

/** A decided correction, as study_edit_proposals has it. */
export type DecidedProposal = { id: string; lecture_id: string; part_idx: number; before_text: string; after_text: string; source_slides: number[]; state: "applied" | "withdrawn" };

/** fix_check's frozen request: fixCheckOpts(fixCheckRequest(...)), as op
 *  fix_check sends it; the group's decision (applied: the check should say
 *  ok; withdrawn: it should not) stays in `key`. */
export function fixCheckFrozen(lecture: Pick<Lecture, "id" | "title">, p: DecidedProposal, slidesText: string): Frozen {
  const opts = fixCheckOpts(fixCheckRequest({ before: p.before_text, after: p.after_text, slides: slidesText }));
  return {
    v: 1,
    route: "fix_check",
    kind: opts.kind,
    system: opts.system,
    messages: opts.messages,
    effort: opts.effort,
    maxTokens: opts.maxTokens,
    ...(opts.format ? { format: opts.format } : {}),
    imageTokens: 0,
    material: { lecture: lecture.id, title: lecture.title, proposal: p.id, part: p.part_idx, before: p.before_text, after: p.after_text, slides: p.source_slides },
    key: { route: "fix_check", expected: p.state === "applied", decision: p.state },
  };
}

/** The read unit of a comparison: the exam (or sheet), its unit's pages
 *  signed (url), the page before and after, what was saved before them. */
export type ReadUnit = {
  exam: { id: string; group_id: string; title: string; key_source: string; kind: "exam" | "sheet"; lecture_id?: string | null; course?: string };
  pages: ExamPage[];
  prev: ExamPage | null;
  next: ExamPage | null;
  /** Numbers (exam) or labels (sheet) saved from pages before the unit. */
  seen: number[];
  seenLabels: Array<{ label: string; page: number | null }>;
  /** The reviewed items that start on the unit's pages. */
  reference: RefItem[];
};

/** exam_read's and sheet_read's frozen request: unitCall or sheetCall over
 *  a read claim of the unit, exactly as the reader sends it; the signed
 *  pages are kept as paths. Null: a page's link is missing or expired. */
export function readFrozen(route: "exam_read" | "sheet_read", u: ReadUnit): Frozen | null {
  const sheet = route === "sheet_read";
  const claim: ExamClaim = {
    job: "lab",
    kind: "read",
    reader: sheet ? "sheet" : "exam",
    lease: "lab",
    attempt: 1,
    last_error: null,
    exam: { ...u.exam },
    pages: u.pages,
    next: u.next,
    prev: u.prev,
    seen: u.seen,
    seen_labels: sheet ? u.seenLabels : null,
    items: null,
  };
  const call = sheet ? sheetCall(claim) : unitCall(claim);
  if (!call) return null;
  const pathOfUrl = new Map<string, string>();
  for (const p of [...u.pages, ...(u.prev ? [u.prev] : []), ...(u.next ? [u.next] : [])]) if (p.url) pathOfUrl.set(p.url, p.path);
  return {
    v: 1,
    route,
    kind: "exam",
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: toPaths([{ role: "user", content: call.content }], pathOfUrl),
    effort: call.effort,
    maxTokens: call.maxTokens,
    format: { type: "json_schema", schema: call.schema },
    imageTokens: call.imageTokens,
    material: {
      exam: u.exam.id,
      title: u.exam.title,
      pages: u.pages.map((p) => ({ n: p.n, path: p.path })),
      ...(u.prev ? { prev: u.prev.n } : {}),
      ...(u.next ? { next: u.next.n } : {}),
    },
    key: { route, items: u.reference },
  };
}

/* ── Estimates (D14, D16) ── */

/** The worst case of the frozen request on `model`: every character of its
 *  system, text and schema, its pictures, all of max_tokens; an unverified
 *  price × LAB_UNVERIFIED_FACTOR. */
export function labEstimate(f: Pick<Frozen, "system" | "messages" | "maxTokens" | "format" | "imageTokens">, model: string, info: (m: string) => ModelInfo | null = modelInfo): number {
  let chars = f.system.reduce((n, b) => n + b.text.length, 0) + (f.format ? JSON.stringify(f.format.schema).length : 0);
  for (const m of f.messages) {
    if (typeof m.content === "string") chars += m.content.length;
    else for (const b of m.content ?? []) if (b.type === "text") chars += b.text.length;
  }
  const usd = estimateUsd(model, chars, f.maxTokens, f.imageTokens);
  const m = info(model);
  return m && !m.verified ? usd * LAB_UNVERIFIED_FACTOR : usd;
}

/** A run's worst case: every model's, summed (the run's cap holds it). */
export function runEstimate(f: Frozen, models: readonly string[]): { total: number; perModel: number[] } {
  const perModel = models.map((m) => labEstimate(f, m));
  return { total: perModel.reduce((a, b) => a + b, 0), perModel };
}

/** Labels in a random order (study_lab_plan shuffles its own; the judge's order, WP8, uses this). */
export function shuffled<T>(xs: readonly T[], random: () => number = Math.random): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ── The $0 checks (checksFor, §7.5) ──
 * Keys the results table reads (study_lab_board): pass (boolean: the
 * answer could be read and judged), items, match, false_rejects (numbers);
 * the rest are kept as they are. */
export type Checks = { pass: boolean; items: number; match: number; false_rejects?: number } & Record<string, unknown>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** How alike two texts are, 0..1 (1 - edit distance / longer length), on
 *  their first 1,500 characters with spaces collapsed. */
export function similarity(a: string, b: string): number {
  const x = squash(a).slice(0, 1500);
  const y = squash(b).slice(0, 1500);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}
/** A read's text counts as copied right at this similarity or more. */
export const COPY_SIMILAR = 0.9;

/** The checks of one answer of a run: `complete` is false when the answer
 *  stopped early (cut, timed out), so an item it did not reach is not judged. */
export function checksFor(key: LabKey, text: string, complete: boolean): Checks {
  switch (key.route) {
    case "solver": {
      const doc = parseJson(text) as { answers?: unknown } | null;
      const answers: SolverAnswer[] = [];
      for (const a of Array.isArray(doc?.answers) ? doc.answers : []) {
        const r = SolverAnswerIn.safeParse(a);
        if (r.success) answers.push(r.data);
      }
      const all: SolverItem[] = key.items.map((k) => ({
        vignette: "",
        question: "",
        options: Array.from({ length: k.options }, () => ""),
        answer: k.answer,
        ...(k.seq ? { seq: k.seq } : {}),
        ...(k.image ? { image: "x" } : {}),
        ...(k.without ? { withoutPicture: true } : {}),
      }));
      const items = all.slice(0, key.asked);
      const twin = new Map<number, number>();
      let next = key.asked;
      items.forEach((it, i) => {
        if (it.image) twin.set(i, next++);
      });
      const v = judgeItems(items, all, twin, answers, complete && doc !== null);
      const judged = v.filter((x) => x !== null).length;
      const match = v.filter((x) => x?.ok).length;
      return {
        pass: doc !== null && judged === items.filter((it) => !it.withoutPicture).length,
        items: judged,
        match,
        // Every bank question's key is the group's: a question it got wrong is a good question rejected.
        false_rejects: judged - match,
        ambiguous: v.filter((x) => x && x.ambiguous).length,
        blind: v.filter((x) => x?.blind).length,
        missing: items.length - judged,
      };
    }
    case "fix_check": {
      const r = FixCheck.safeParse(parseJson(text));
      if (!r.success) return { pass: false, items: 1, match: 0, false_rejects: 0, agrees: false };
      const agrees = r.data.ok === key.expected;
      return { pass: true, items: 1, match: agrees ? 1 : 0, false_rejects: key.expected && !r.data.ok ? 1 : 0, agrees, ok: r.data.ok };
    }
    case "exam_read":
    case "sheet_read": {
      const sheet = key.route === "sheet_read";
      const doc = parseJson(text);
      const parsed = (sheet ? SheetItems : ExamItems).safeParse(doc);
      // A cut answer: the items that are whole still count.
      const raw: unknown[] = parsed.success
        ? (parsed.data.questions as unknown[])
        : Array.isArray((doc as { questions?: unknown } | null)?.questions)
          ? ((doc as { questions: unknown[] }).questions ?? [])
          : [];
      const got = new Map<string, { question: string; options: number; figure: boolean }>();
      for (const x of raw) {
        if (sheet) {
          const r = SheetItem.safeParse(x);
          if (r.success && !got.has(squash(r.data.label)))
            got.set(squash(r.data.label), { question: `${r.data.stem} ${r.data.question}`, options: r.data.options.length, figure: r.data.figures.length > 0 });
        } else {
          const r = ExamItem.safeParse(x);
          if (r.success && !got.has(String(r.data.no)))
            got.set(String(r.data.no), { question: `${r.data.vignette} ${r.data.question}`, options: r.data.options.length, figure: r.data.figure.page > 0 });
        }
      }
      let numbered = 0;
      let optionsOk = 0;
      let copied = 0;
      let figures = 0;
      let match = 0;
      for (const ref of key.items) {
        const g = got.get(sheet ? squash(ref.id) : ref.id);
        if (!g) continue;
        numbered += 1;
        const sameOptions = g.options === ref.options;
        const sim = similarity(g.question, ref.question) >= COPY_SIMILAR;
        if (sameOptions) optionsOk += 1;
        if (sim) copied += 1;
        if (g.figure === ref.figure) figures += 1;
        if (sameOptions && sim) match += 1;
      }
      const ids = new Set(key.items.map((r) => (sheet ? squash(r.id) : r.id)));
      return {
        pass: parsed.success && complete,
        items: key.items.length,
        match,
        numbered,
        options: optionsOk,
        copied,
        figures,
        extra: [...got.keys()].filter((k) => !ids.has(k)).length,
      };
    }
  }
}

/** The answer's status from how its call ended (study_lab_outputs.status). */
export function statusOf(r: { stop: string | null; timedOut: boolean } | null, cancelled: boolean): { status: "done" | "truncated" | "refused" | "timeout" | "error"; reason: string | null } {
  if (cancelled) return { status: "error", reason: "cancelled" };
  if (!r) return { status: "error", reason: null };
  if (r.timedOut) return { status: "timeout", reason: null };
  if (r.stop === "refusal") return { status: "refused", reason: null };
  if (r.stop === "max_tokens") return { status: "truncated", reason: null };
  if (r.stop === "aborted" || r.stop === "error") return { status: "error", reason: null };
  return { status: "done", reason: null };
}
