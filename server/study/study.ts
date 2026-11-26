/// <reference path="./env.d.ts" />
import type { Box, FigureGeo } from "../../shared/study/figureGeo.js";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { flagsFrom, requiredSchema } from "../../shared/study/flags.js";

/* ── Shared by the /api/study/* functions ──
 *
 * Every call carries the member's Supabase access token. The functions talk to
 * Supabase AS that member (anon key + their token), so Row Level Security
 * decides what they may read and write: a function can never touch a group the
 * caller does not belong to, and there is no service-role key anywhere.
 *
 * What spends the budget or writes Claude's output also needs the server key
 * (STUDY_WORKER_KEY on Vercel, the same value as the Vault secret
 * study_worker_key): the functions pass it as p_key with the member's token,
 * so a ledger row names its member and a member's token alone cannot spend.
 *
 * The Anthropic key lives only here, in ANTHROPIC_API_KEY on Vercel.
 */

export const MODEL = "claude-opus-5-5";
/** The sheet reader's model (section O 2; OD17: the current default, not
 *  pinned to a provider, OD5). The models package (Y, not built) will route
 *  the keys "sheet_read" and "similar" here. */
export const SHEET_MODEL = MODEL;

/** geo: the picture's label geometry, when the upload (or the backfill) found labels (question types);
 *  crop: a PPTX picture's visible frame (its srcRect), 0..1 of the stored, uncropped picture. */
export type SlideFigure = { k: number; path: string; w: number; h: number; geo?: FigureGeo; crop?: Box };
export type StoredSlide = {
  n: number;
  title: string;
  lines: string[];
  tables: string[][][];
  notes: string;
  figures: SlideFigure[];
};
export type Lecture = {
  id: string;
  group_id: string;
  course: string;
  title: string;
  lecturer: string;
  lecture_date: string | null;
  source_kind: "pptx" | "pdf";
  slides: StoredSlide[];
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new HttpError(500, `missing ${name}`);
  return v;
}

// Same project as the browser uses: the study project if one is configured.
export const supabaseUrl = () => process.env.VITE_STUDY_SUPABASE_URL || env("VITE_SUPABASE_URL");
export const supabaseAnonKey = () => process.env.VITE_STUDY_SUPABASE_ANON_KEY || env("VITE_SUPABASE_ANON_KEY");
const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** A member's token must outlive the call it opens: a function stops its model
 *  call at 270 s and then saves and settles with that token (review FE-5). */
const TOKEN_MIN_SECONDS = 300;

/** The token's expiry (seconds since the epoch), read from its payload. Only
 *  read after Supabase Auth has verified the token. */
function tokenExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const bin = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
}

/** The margin of a call that makes no model call and ends in a few seconds
 *  (practice 2.0's plan and create, sharing an answer): its token only
 *  has to outlive a few reads and one RPC. */
export const QUICK_TOKEN_SECONDS = 30;

/** The caller's Supabase client, or a 401: "session expired" for a token Supabase
 *  Auth refuses, "session expiring" for one with under `minSeconds` left (5
 *  minutes by default; the phone refreshes its session and repeats the call
 *  once). A quick call (no model call, one write at most) passes QUICK_TOKEN_SECONDS. */
export async function memberClient(req: Request, { minSeconds = TOKEN_MIN_SECONDS }: { minSeconds?: number } = {}): Promise<{ sb: SupabaseClient; userId: string }> {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new HttpError(401, "not signed in");
  const sb = createClient(supabaseUrl(), supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: NO_SESSION,
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "session expired");
  const exp = tokenExpiry(token);
  if (exp !== null && exp * 1000 - Date.now() < minSeconds * 1000) throw new HttpError(401, "session expiring");
  return { sb, userId: data.user.id };
}

/** The anon key and no member: for calls made by the server itself (health,
 *  the router's schema check, later the worker and the Send Email hook), which
 *  carry the server key wherever one is needed. */
export function serverClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), { auth: NO_SESSION });
}

/** A client that calls as the holder of `token` (a session the server has
 *  just been given, e.g. by /api/study/code's sign-in), without checking it:
 *  PostgREST and the SQL do. memberClient is for a caller's token. */
export function tokenClient(token: string): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: NO_SESSION,
  });
}

/** STUDY_WORKER_KEY without the spaces or line break a paste can leave
 *  around it ("" when it is not set). Vercel keeps what was pasted, and
 *  Vault's study_worker_key has none of it, so an untrimmed key would be
 *  refused by every call that needs it. */
export function workerKey(): string {
  return (process.env.STUDY_WORKER_KEY ?? "").trim();
}

/** The server key. Without it nothing can reserve or settle the budget. */
export function serverKey(): string {
  const k = workerKey();
  if (!k) throw new HttpError(500, "missing STUDY_WORKER_KEY");
  return k;
}

/** An RPC's arguments with the server key added as p_key. */
export function keyed<T extends Record<string, unknown>>(args: T): T & { p_key: string } {
  return { ...args, p_key: serverKey() };
}

/* ── The schema registry (§2.11; §12.2.2) ──
 * Each SQL section records its version in study_private.schema_sections, and
 * study_schema() returns them ({"F":1,…}). Every call needs at least
 * REQUIRED_SCHEMA: F, and the section of each package whose server code is
 * merged (W: outline.ts and section.ts claim through section W, and work.ts
 * writes; version 2 is W2's hardening, after which members write parts only
 * through the writer's functions, as corrections rely on; Q, C and K: their
 * ops are in /api/study/ai whatever the app's flags say). Every function checks it once per instance, and
 * /api/study/health's schemaOk reports it, so a merge that came before its
 * SQL shows there. A package adds its letter here when its code starts to
 * need its section. Each op of /api/study/ai (and work.ts's bank step) needs
 * its own sections as well, OP_SCHEMA (§12.2.2). */
export const REQUIRED_SCHEMA: Readonly<Record<string, number>> = { F: 1, W: 2, Q: 1, C: 1, K: 1 };

/** Each op's sections (§12.2.2). The ops their packages have not built need
 *  what §12.2.2 gives them; "questions" needs Q 2 (Q's end and practice
 *  2.0, every action of the op); "cards" needs C 2 (C's end: a card is
 *  saved on its paragraph); "ask" and "fix_check" need K's end (version 2),
 *  merged with K-1 and K-2. Never B for
 *  "questions" (review F-5). */
export const OP_SCHEMA: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  questions: { Q: 2 }, // Q's end and practice 2.0
  exam_read: { Q: 2 },
  exam_explain: { Q: 2 },
  cards: { C: 2 }, // C's end: a card on its paragraph
  ask: { K: 2 }, // K's end: the share path (study_ask_to_group), the answered threads
  fix_check: { K: 2 },
  mnemonic: { J: 1 },
  wall_check: { J: 1 },
  var: { V: 1 },
  plaque: { U: 2 }, // U-3's study_trap_plaque_begin and study_trap_plaque (section U at 2)
  trap_check: { E: 1 },
  whoami: { E: 1 },
  bank: { B: 1 }, // work.ts's bank branch: the points read ahead (package B, decision 2 of 17 Nov 2026)
};

/** The needs of an op's variant that the op's name does not carry
 *  (OP_SCHEMA lists §12.2.2's ops and only those). Courses
 *  (docs/study/sources.md B8): op "ask" with scope "course" reads
 *  study_courses (S 1) besides K's end, and op "questions" in a round over
 *  several lectures (a planId) writes plan_id (S 1) besides Q's end. The op
 *  checks its variant with assertSchema(sb, "<variant>") after the router's
 *  check of the op. */
export const VARIANT_SCHEMA: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  ask_course: { K: 2, S: 1 },
  questions_plan: { Q: 2, S: 1 },
  // Past exams (sources.md phase 2): op "exam_read" (its start and the
  // phone's unit) and work.ts's {exam} branch read and save through S 2.
  exams: { Q: 2, S: 2 },
  // Uploaded sheets, release A0 (docs/study/sheets.md): op "exam_read"'s
  // start of a sheet reads its kind and the sheets line (section O 1).
  sheets: { Q: 2, S: 2, O: 1 },
  // Uploaded sheets, release A1 (docs/study/sheets.md): the sheet reader's
  // start (study_sheet_pages_done), "copy the open questions too"
  // (study_sheet_open_add) and the budget pause's resume (section O 2).
  sheet_forms: { Q: 2, S: 2, O: 2 },
  // Notifications (section R, docs/study/DECISIONS-2026-11-26.md): work.ts's
  // {notify} branch claims pushes and reports them through R 1.
  notify: { R: 1 },
};

/** What a call of `op` (or of a variant, VARIANT_SCHEMA) needs of the
 *  schema: every call's sections and the op's. */
export function schemaFor(op?: string): Record<string, number> {
  const own = op && Object.hasOwn(OP_SCHEMA, op) ? OP_SCHEMA[op] : op && Object.hasOwn(VARIANT_SCHEMA, op) ? VARIANT_SCHEMA[op] : {};
  return { ...REQUIRED_SCHEMA, ...own };
}

/** What /api/study/health's schemaOk asks of the database: the server
 *  code's sections (REQUIRED_SCHEMA) and what the app built from these
 *  variables needs (the VITE_STUDY_* flags, which Vercel gives its functions
 *  too; shared/study/flags.ts), each at the higher version. So health
 *  matches the app's schema gate: Q 2 with questions or practice on (Q's
 *  end and practice 2.0), C 2 with the cards (C's end), Z 2 with the quiz,
 *  W 1 always. */
export function healthSchema(env: Record<string, unknown>): Record<string, number> {
  const need: Record<string, number> = { ...REQUIRED_SCHEMA };
  for (const [section, version] of Object.entries(requiredSchema(flagsFrom(env)))) need[section] = Math.max(need[section] ?? 0, version);
  return need;
}

/** Every required section is loaded, at its version or later. */
export function schemaOk(loaded: unknown, required: Readonly<Record<string, number>> = REQUIRED_SCHEMA): boolean {
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return false;
  const have = loaded as Record<string, unknown>;
  return Object.entries(required).every(([section, version]) => {
    const v = have[section];
    return typeof v === "number" && v >= version;
  });
}

/** The needs that passed in this instance, one key per set of sections. */
const schemaPassed = new Set<string>();

/** Once per instance and op: a database older than the code (a merge that
 *  came before its SQL) answers 503 "schema" instead of failing call by call.
 *  Only a passing check is remembered, so the instance recovers once the SQL
 *  ran. */
export async function assertSchema(sb: SupabaseClient, op?: string): Promise<void> {
  const need = schemaFor(op);
  const key = JSON.stringify(Object.entries(need).sort(([a], [b]) => a.localeCompare(b)));
  if (schemaPassed.has(key)) return;
  const { data, error } = await sb.rpc("study_schema");
  if (error) {
    // No study_schema() at all: the database predates section F.
    if (error.code === "PGRST202" || error.code === "42883") throw new HttpError(503, "schema");
    throw new HttpError(500, error.message);
  }
  if (!schemaOk(data, need)) throw new HttpError(503, "schema");
  schemaPassed.add(key);
}

/** Whether the database has these sections, without failing: for a
 *  feature that reads a newer section when it is there and falls back
 *  otherwise (courseStyle reads section S 2's exam items). A yes is
 *  remembered per instance; a no or an error is asked again next time. */
export async function schemaHas(sb: SupabaseClient, need: Readonly<Record<string, number>>): Promise<boolean> {
  const key = JSON.stringify(Object.entries(need).sort(([a], [b]) => a.localeCompare(b)));
  if (schemaPassed.has(key)) return true;
  const { data, error } = await sb.rpc("study_schema");
  if (error || !schemaOk(data, need)) return false;
  schemaPassed.add(key);
  return true;
}

export async function loadLecture(sb: SupabaseClient, id: string): Promise<Lecture> {
  const { data, error } = await sb
    .from("study_lectures")
    .select("id, group_id, course, title, lecturer, lecture_date, source_kind, slides")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  // RLS returns nothing for a lecture of another group, and a deleted lecture
  // waits hidden for 30 days: the same answer as "no such lecture".
  if (!data) throw new HttpError(404, "lecture not found");
  return data as Lecture;
}

export function anthropic(): Anthropic {
  return new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), maxRetries: 3 });
}

/** One slide as text, numbered so the summary can cite it ([ש' n]). */
export function slideText(s: StoredSlide): string {
  const out = [`[שקף ${s.n}]${s.title ? " " + s.title : ""}`];
  for (const line of s.lines) if (line !== s.title) out.push(line);
  for (const t of s.tables) {
    out.push("טבלה:");
    for (const row of t) out.push("| " + row.join(" | ") + " |");
  }
  const pics = s.figures.filter((f) => f.k > 0).length;
  if (pics) out.push(`(${pics === 1 ? "תמונה אחת" : pics + " תמונות"} בשקף)`);
  if (s.notes) out.push("הערות הדובר: " + s.notes);
  return out.join("\n");
}

export function deckText(l: Pick<Lecture, "slides">): string {
  return l.slides.map(slideText).join("\n\n");
}

/** The whole lecture as context, the same bytes for every feature, so their
 *  calls share one cache entry per lecture (§2.2). */
export function lectureBlock(l: Pick<Lecture, "lecturer" | "slides">): string {
  return `The full lecture${l.lecturer ? ` (lecturer: ${l.lecturer})` : ""}, for context:\n\n${deckText(l)}`;
}

/** Streams text to the client and keeps the connection open from the first
 *  millisecond: edge functions must start answering within seconds, while the
 *  model may think for longer before its first word. */
export function textStream(run: (write: (s: string) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (s: string) => controller.enqueue(enc.encode(s));
      write("​"); // first byte now; the client drops it
      try {
        await run(write);
      } catch (e) {
        write(`\n\u0000ERROR ${errorText(e)}`);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

/** A stream whose work does not depend on anyone reading it: `run` starts
 *  at once and goes on to its end when the phone closes the stream, sleeps
 *  or loses the connection (its writes then go nowhere), and `keepAlive`
 *  (waitUntil on Vercel) keeps the function running until it ends. Lines as
 *  textStream's: a zero-width first byte, and "\u0000ERROR <code>" when
 *  `run` throws. */
export function detachedStream(run: (write: (s: string) => void) => Promise<void>, keepAlive: (p: Promise<unknown>) => void): Response {
  const enc = new TextEncoder();
  const box: { c: ReadableStreamDefaultController<Uint8Array> | null } = { c: null };
  let open = true;
  const write = (s: string) => {
    if (!open || !box.c) return;
    try {
      box.c.enqueue(enc.encode(s));
    } catch {
      open = false; // cancelled: the rest goes nowhere
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      box.c = c; // start runs inside the constructor: set before `run` below
    },
    cancel() {
      open = false;
    },
  });
  write("\u200b"); // first byte now; the client drops it
  const work = (async () => {
    try {
      await run(write);
    } catch (e) {
      write(`\n\u0000ERROR ${errorText(e)}`);
    } finally {
      if (open) {
        open = false;
        try {
          box.c?.close();
        } catch {
          /* already closed */
        }
      }
    }
  })();
  keepAlive(work);
  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

/** Deterministic clean-up before a part is saved: a range written with an en
 *  dash between digits gets a hyphen (an en dash can display reversed inside
 *  Hebrew), and invisible direction marks are removed. */
export function tidyMarkdown(md: string): string {
  return md.replace(/(\d)\s*\u2013\s*(\d)/g, "$1-$2").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

export function errorText(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return "rate_limited";
  if (e instanceof Anthropic.AuthenticationError) return "bad_api_key";
  // A subclass of APIError in the TypeScript SDK, so it is checked first.
  if (e instanceof Anthropic.APIConnectionError) return "network";
  if (e instanceof Anthropic.APIError) return e.status === 529 ? "overloaded" : `api_${e.status ?? "error"}`;
  if (e instanceof HttpError) return e.message;
  return e instanceof Error ? e.message : "unknown";
}

export async function readBody<T>(req: Request): Promise<T> {
  if (req.method !== "POST") throw new HttpError(405, "POST only");
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "bad json");
  }
}
