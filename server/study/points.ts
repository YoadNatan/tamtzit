import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";
import { numberBlocks, type NumberedBlock } from "../../shared/study/blocks.js";
import { POINT_KINDS, type PointKind, type PointsLine } from "../../shared/study/practice2.js";
import { estimateUsd, reserve } from "./budget.js";
import { generateItems, settleFor } from "./claude.js";
import { POINTS_SYSTEM, pointsRequest, type PointsPartText } from "./prompts/points.js";
import { placePara, tagSlides, tidy } from "./questions.js";
import { similarity } from "./similar.js";
import { errorText, HttpError, keyed, type Lecture, MODEL } from "./study.js";

/* ── Points to know: read once per lecture for the whole group (practice 2.0) ──
 *
 * Op "questions", action "points" (practice.ts routes it): the member's token
 * and the server key claim the summary's parts whose points are not current
 * (study_points_claim: a part is current while its Markdown is the text its
 * points were read from; a rewrite or a correction makes it stale). Nothing
 * stale: nothing is spent. Otherwise each stale part is read in its own call
 * (a part over POINT_CALL_CHARS in a few), up to POINTS_CONCURRENCY calls at
 * once, so a normal lecture takes about as long as its longest part (about a
 * minute), not the sum of them. Each call is reserved first (kind "points";
 * the read's first call with ref "read", which the daily limit counts) and
 * settled after; each point is checked (checkPoint), placed on its
 * paragraph, deduplicated, matched to the part's earlier points so the ids
 * that stay keep their coverage (matchPoints), and the part is saved
 * (study_points_save) as soon as its call ends. A part the reply did not
 * finish fails with the reason (study_points_fail) and is read again on the
 * next call. The reading runs on the server whether or not anyone reads the
 * stream (practice2.ts: detachedStream); phones follow study_point_parts.
 *
 * Lines: {"t":"start"} · {"t":"part","part":i,"points":n} ·
 * {"t":"fail","part":i,"why"} · {"t":"done","parts","points","costUsd","unsettled"},
 * a part's line as soon as it is saved or failed; a refused reservation or a
 * model error ends the stream with "\u0000ERROR <code>" after the parts' lines. */

export const PointItem = z.object({
  part: z.number().int().describe("The part's number as the request gives it"),
  para: z.number().int().describe("The number of the paragraph (¶) that states the point; never 0"),
  kind: z.string().describe("One key: drug, mechanism, indication, adverse, contra, number, structure, process, finding"),
  subject: z.string().describe("The drug, organism, disease or process it is about, in English exactly as the summary writes it; an empty string when none"),
  text: z.string().describe("The fact as one Hebrew sentence of at most 160 characters, without a slide tag"),
  slides: z.array(z.number().int()).describe("The slide numbers of the paragraph's tags that support it"),
  red_flag: z.boolean().describe("true only for a fact whose ignorance could harm a patient"),
  weight: z.number().int().describe("3 a core fact, 2 a standard fact, 1 a detail"),
});
export const PointSet = z.object({ points: z.array(PointItem) });
export type PointItem = z.infer<typeof PointItem>;

/** A claimed part of the summary, with its text numbered as SummaryView numbers it. */
export type ClaimedPart = {
  part_idx: number;
  heading: string;
  slide_from: number;
  slide_to: number;
  /** The md5 of the text the claim saw (study_points_save checks it). */
  md5: string;
  blocks: NumberedBlock[];
};

/** What study_points_save receives for one point. */
export type SavePoint = {
  id?: string;
  kind: PointKind;
  subject: string;
  text: string;
  anchor: number | null;
  quote: string;
  slides: number[];
  red_flag: boolean;
  weight: 1 | 2 | 3;
};

export const POINT_TEXT_MAX = 300;
export const POINTS_PER_PART = 60;
/** Two points of a part this similar (same kind) are one point. */
const SAME_POINT = 0.8;
/** An earlier point keeps its id for a new one this similar (same kind). */
const KEEP_ID = 0.55;
const HEBREW = /[א-ת]/;

/** One point as the model wrote it, checked: its part is a claimed one, its
 *  kind one of the nine, its text a Hebrew sentence (slide tags removed), its
 *  paragraph one of the part's (placed by similarity when the model's
 *  number is not), its slides real ones (the paragraph's tags when it gives
 *  none). */
export function checkPoint(
  p: PointItem,
  parts: ReadonlyMap<number, Pick<ClaimedPart, "blocks">>,
  lectureSlides: ReadonlySet<number>,
): { ok: true; part: number; point: SavePoint; warnings: string[] } | { ok: false; reason: string } {
  const part = parts.get(p.part);
  if (!part) return { ok: false, reason: "unknown part" };
  const kind = POINT_KINDS.find((k) => k === p.kind.trim().toLowerCase());
  if (!kind) return { ok: false, reason: `kind "${p.kind}"` };
  const text = tidy(p.text.replace(/\[ש['׳][^\]]*\]/g, " "));
  if (text.length < 3 || text.length > POINT_TEXT_MAX || !HEBREW.test(text)) return { ok: false, reason: "text length or language" };
  const warnings: string[] = [];
  const anchor = placePara(p.para, part.blocks, text);
  if (anchor !== p.para) warnings.push(anchor === null ? "paragraph not placed" : "paragraph placed by similarity");
  const block = anchor === null ? undefined : part.blocks.find((b) => b.n === anchor);
  let slides = [...new Set(p.slides)].filter((n) => lectureSlides.has(n)).sort((a, b) => a - b);
  if (!slides.length && block) slides = [...new Set(tagSlides(block.text))].filter((n) => lectureSlides.has(n)).sort((a, b) => a - b);
  if (!slides.length) return { ok: false, reason: "no slides" };
  const weight = Math.min(3, Math.max(1, Math.round(p.weight))) as 1 | 2 | 3;
  if (weight !== p.weight) warnings.push("weight clamped");
  return {
    ok: true,
    part: p.part,
    warnings,
    point: {
      kind,
      subject: tidy(p.subject).slice(0, 120),
      text,
      anchor,
      quote: block ? block.text.slice(0, 80) : "",
      slides: slides.slice(0, 20),
      red_flag: p.red_flag,
      weight,
    },
  };
}

/** A part's points without repeats (the same kind and nearly the same
 *  text), at most POINTS_PER_PART, in the paragraphs' order. */
export function dedupePoints(points: readonly SavePoint[]): SavePoint[] {
  const out: SavePoint[] = [];
  for (const p of points) {
    if (out.some((q) => q.kind === p.kind && similarity(q.text, p.text) >= SAME_POINT)) continue;
    out.push(p);
  }
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.anchor ?? 1e9) - (b.p.anchor ?? 1e9) || a.i - b.i)
    .slice(0, POINTS_PER_PART)
    .map(({ p }) => p);
}

/** Gives a new point the id of the part's earlier point it restates (the
 *  same kind, a similar text; the same subject helps), each earlier point
 *  to at most one new one, the closest pairs first. A question that covered
 *  that point still covers it after a correction or a rewrite. */
export function matchPoints(old: ReadonlyArray<{ id: string; kind: string; subject: string; text: string }>, fresh: readonly SavePoint[]): SavePoint[] {
  const pairs: Array<{ i: number; j: number; score: number }> = [];
  fresh.forEach((p, i) =>
    old.forEach((o, j) => {
      if (o.kind !== p.kind) return;
      const score = similarity(p.text, o.text) + (p.subject && p.subject.toLowerCase() === o.subject.toLowerCase() ? 0.15 : 0);
      if (score >= KEEP_ID) pairs.push({ i, j, score });
    }),
  );
  pairs.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
  const ids = new Map<number, string>();
  const used = new Set<number>();
  for (const { i, j } of pairs) {
    if (ids.has(i) || used.has(j)) continue;
    ids.set(i, old[j].id);
    used.add(j);
  }
  return fresh.map((p, i) => (ids.has(i) ? { ...p, id: ids.get(i) } : { ...p }));
}

/* ── The request ── */

export const POINTS_EFFORT = "medium" as const;
/** At most this much paragraph text in one call. A part is one call (a
 *  normal part is 2,000-8,000 characters, read in about a minute); a longer
 *  one is read in pieces of about equal size. */
export const POINT_CALL_CHARS = 12_000;
/** A part is read in at most this many pieces (beyond that, larger pieces). */
export const POINT_PIECES_MAX = 4;
/** Calls in flight at once for one read. */
export const POINTS_CONCURRENCY = 6;
/** The ledger's ref of a read's first call: the daily limit counts reads (POLICY.points.dailyRef). */
export const POINTS_READ_REF = "read";

/** max_tokens of a call reading `chars` characters of paragraphs: about one
 *  point per 250 characters at 90 tokens each, with room to think. Opus 5.5
 *  always thinks (adaptive; effort medium), and its thinking counts here, so
 *  even a short part keeps 8,000. */
export const pointsMaxTokens = (chars: number): number => Math.min(24_000, Math.max(8_000, 4_000 + Math.ceil(Math.max(0, chars) / 250) * 90));

const blockChars = (b: Pick<NumberedBlock, "text">) => Math.min(b.text.length, 700) + 8;
const partChars = (p: Pick<ClaimedPart, "blocks">) => p.blocks.reduce((n, b) => n + blockChars(b), 0);

/** One call's share of a part: some of its paragraphs (all of them for a
 *  normal part), with their own numbers. */
export type PointPiece<T extends Pick<ClaimedPart, "blocks"> = ClaimedPart> = { part: T; blocks: NumberedBlock[]; piece: number; pieces: number };

/** Each part as one call, in the parts' order; a part over POINT_CALL_CHARS
 *  in pieces of about equal size, paragraph by paragraph, at most
 *  POINT_PIECES_MAX of them. */
export function pointPieces<T extends Pick<ClaimedPart, "blocks">>(parts: readonly T[]): Array<PointPiece<T>> {
  const out: Array<PointPiece<T>> = [];
  for (const p of parts) {
    const total = partChars(p);
    const n = Math.min(POINT_PIECES_MAX, Math.max(1, Math.ceil(total / POINT_CALL_CHARS)));
    const budget = Math.ceil(total / n);
    const groups: NumberedBlock[][] = [];
    let cur: NumberedBlock[] = [];
    let size = 0;
    for (const b of p.blocks) {
      const c = blockChars(b);
      if (cur.length && size + c > budget && groups.length < n - 1) {
        groups.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(b);
      size += c;
    }
    if (cur.length || !groups.length) groups.push(cur);
    groups.forEach((blocks, i) => out.push({ part: p, blocks, piece: i, pieces: groups.length }));
  }
  return out;
}

type TextBlock = Anthropic.Beta.BetaTextBlockParam;

/** One call's request: the system, and the parts paragraph by paragraph. */
export function pointsCall(parts: readonly ClaimedPart[]): { system: TextBlock[]; user: string; maxTokens: number } {
  const texts: PointsPartText[] = parts.map((p) => ({ part: p.part_idx, heading: p.heading, from: p.slide_from, to: p.slide_to, blocks: p.blocks }));
  return {
    system: [{ type: "text", text: POINTS_SYSTEM }],
    user: pointsRequest(texts),
    maxTokens: pointsMaxTokens(parts.reduce((n, p) => n + partChars(p), 0)),
  };
}

/** A piece's call: its part with only the piece's paragraphs. */
export const pieceCall = (pc: PointPiece): ReturnType<typeof pointsCall> => pointsCall([{ ...pc.part, blocks: pc.blocks }]);

/** The ledger's ref of a piece's call: "part 3", or "part 3 (2/3)". */
export const pointsRef = (pc: Pick<PointPiece<Pick<ClaimedPart, "part_idx" | "blocks">>, "piece" | "pieces"> & { part: Pick<ClaimedPart, "part_idx"> }): string =>
  `part ${pc.part.part_idx}${pc.pieces > 1 ? ` (${pc.piece + 1}/${pc.pieces})` : ""}`;

/** A call's worst case, which it reserves. */
export function pointsEstimate(parts: readonly ClaimedPart[]): number {
  const c = pointsCall(parts);
  return estimateUsd(MODEL, c.system.reduce((n, b) => n + b.text.length, 0) + c.user.length, c.maxTokens);
}
export const pieceEstimate = (pc: PointPiece): number => pointsEstimate([{ ...pc.part, blocks: pc.blocks }]);

/* ── Reading the stale parts ── */

type ClaimRow = { part_idx: number; heading: string; slide_from: number; slide_to: number; md5: string };

/** study_points_claim's refusals, as HTTP statuses. */
const CLAIM_STATUS: Record<string, number> = {
  busy: 409,
  "gave up": 409,
  "no summary": 409,
  "summary not ready": 409,
  "lecture not found": 404,
  forbidden: 403,
  "not signed in": 401,
};

/** Claims the lecture's stale parts (none: every point is current). */
export async function claimPoints(sb: SupabaseClient, lectureId: string): Promise<ClaimRow[]> {
  const { data, error } = await sb.rpc("study_points_claim", keyed({ p_lecture: lectureId }));
  if (error) throw new HttpError(CLAIM_STATUS[error.message] ?? 500, error.message);
  return ((data ?? []) as ClaimRow[]).map((r) => ({ ...r, part_idx: Number(r.part_idx) }));
}

/** The claimed parts' text, numbered, and their earlier points (for the ids). */
export async function claimedParts(
  sb: SupabaseClient,
  lectureId: string,
  claim: readonly ClaimRow[],
): Promise<{ parts: ClaimedPart[]; old: Map<number, Array<{ id: string; kind: string; subject: string; text: string }>> }> {
  const idx = claim.map((c) => c.part_idx);
  const [secs, pts] = await Promise.all([
    sb.from("study_sections").select("idx, markdown").eq("lecture_id", lectureId).in("idx", idx),
    sb.from("study_points").select("id, part_idx, kind, subject, text").eq("lecture_id", lectureId).in("part_idx", idx).order("n"),
  ]);
  if (secs.error) throw new HttpError(500, secs.error.message);
  if (pts.error) throw new HttpError(500, pts.error.message);
  const md = new Map(((secs.data ?? []) as Array<{ idx: number; markdown: string }>).map((s) => [s.idx, s.markdown ?? ""]));
  const old = new Map<number, Array<{ id: string; kind: string; subject: string; text: string }>>();
  for (const p of (pts.data ?? []) as Array<{ id: string; part_idx: number; kind: string; subject: string; text: string }>) {
    old.set(p.part_idx, [...(old.get(p.part_idx) ?? []), p]);
  }
  return {
    parts: claim.map((c) => ({ ...c, blocks: numberBlocks(md.get(c.part_idx) ?? "") })),
    old,
  };
}

/** Fails claimed parts with the reason (never throws). `refused`: the model
 *  was never called for them (a refused reservation, parts the deadline never
 *  reached), so the claim's try does not count toward 'gave up'. */
export async function failParts(sb: SupabaseClient, lectureId: string, parts: number[], why: string, cost: number, refused = false): Promise<void> {
  if (!parts.length) return;
  try {
    const { error } = await sb.rpc(
      "study_points_fail",
      keyed({ p_lecture: lectureId, p_parts: parts, p_error: why, p_cost: cost, ...(refused ? { p_refused: true } : {}) }),
    );
    if (error) console.error(`study_points_fail ${lectureId}: ${error.message}`);
  } catch (e) {
    console.error(`study_points_fail ${lectureId}: ${errorText(e)}`);
  }
}

export type PointsResult = { parts: number; points: number; costUsd: number; unsettled: number };

/** A piece is not started with less than this left before stopAt: it could not finish. */
export const PIECE_MIN_MS = 45_000;

type Old = ReadonlyMap<number, ReadonlyArray<{ id: string; kind: string; subject: string; text: string }>>;

/** Reads the claimed parts' points, each part in its own call (a long part
 *  in a few), POINTS_CONCURRENCY calls at once, each reserved before and
 *  settled after. A part is saved, or failed with the reason, as soon as its
 *  last call ends, and its line is written at once ({"t":"part"} or
 *  {"t":"fail"}), in the order the parts finish. Every claimed part ends
 *  saved or failed:
 *   - a reply that stopped early (timeout, refusal, truncated) fails its part
 *     as a try; the other parts go on;
 *   - a refused reservation or a model error stops new calls: the calls in
 *     flight finish and save, the parts never asked of the model fail with
 *     the reason given back as a try (p_refused), and the error is rethrown
 *     at the end (the stream's "\u0000ERROR <code>");
 *   - a part not started with less than PIECE_MIN_MS before stopAt fails
 *     "timeout", given back.
 *  `write` may go nowhere (the phone left): nothing here waits for it. */
export async function readPoints(o: {
  client: Anthropic;
  sb: SupabaseClient;
  lecture: Pick<Lecture, "id" | "group_id" | "slides">;
  parts: ClaimedPart[];
  old: Old;
  stopAt: number;
  write: (line: string) => void;
  /** The first call's reservation (ref POINTS_READ_REF), made before the stream started. */
  reserved?: number;
  concurrency?: number;
  /** PIECE_MIN_MS unless a test says otherwise. */
  pieceMinMs?: number;
}): Promise<PointsResult> {
  const lectureSlides = new Set(o.lecture.slides.map((s) => s.n));
  const out: PointsResult = { parts: 0, points: 0, costUsd: 0, unsettled: 0 };
  const line = (l: PointsLine) => o.write(JSON.stringify(l) + "\n");
  const pieces = pointPieces(o.parts);
  type Run = { part: ClaimedPart; left: number; called: number; found: SavePoint[]; cost: number; model: string; why: string | null; warned: Map<string, number> };
  const runs = new Map<number, Run>(o.parts.map((p) => [p.part_idx, { part: p, left: 0, called: 0, found: [], cost: 0, model: MODEL, why: null, warned: new Map() }]));
  for (const pc of pieces) runs.get(pc.part.part_idx)!.left += 1;
  let halt: unknown = null;
  let started = false;
  let firstRid = o.reserved;

  const finish = async (run: Run) => {
    const idx = run.part.part_idx;
    out.costUsd += run.cost;
    if (run.warned.size) console.info(`points ${o.lecture.id}/${idx} warnings: ${JSON.stringify(Object.fromEntries(run.warned))}`);
    if (run.why) {
      // Never asked of the model: the claim's try is given back.
      await failParts(o.sb, o.lecture.id, [idx], run.why, run.cost, run.called === 0);
      line({ t: "fail", part: idx, why: run.why });
      return;
    }
    const points = matchPoints(o.old.get(idx) ?? [], dedupePoints(run.found));
    const { data, error } = await o.sb.rpc(
      "study_points_save",
      keyed({ p_lecture: o.lecture.id, p_part: idx, p_md5: run.part.md5, p_points: points, p_model: run.model, p_cost: run.cost }),
    );
    if (error) {
      console.error(`study_points_save ${o.lecture.id}/${idx}: ${error.message}`);
      await failParts(o.sb, o.lecture.id, [idx], error.message, 0);
      line({ t: "fail", part: idx, why: error.message });
      return;
    }
    const n = Number(data ?? points.length);
    out.parts += 1;
    out.points += n;
    line({ t: "part", part: idx, points: n });
  };
  const done = async (run: Run) => {
    run.left -= 1;
    if (run.left === 0) await finish(run);
  };

  const readPiece = async (pc: PointPiece): Promise<void> => {
    const run = runs.get(pc.part.part_idx)!;
    // The read's first reservation goes to the first piece started.
    const pre = firstRid;
    firstRid = undefined;
    if (!run.why && halt) run.why = errorText(halt);
    if (!run.why && Date.now() > o.stopAt - (o.pieceMinMs ?? PIECE_MIN_MS)) run.why = "timeout";
    if (run.why) {
      if (pre !== undefined) await settleFor(o.sb, pre, () => (out.unsettled += 1))({ kind: "points", model: MODEL, usage: null, costUsd: 0, estimated: false });
      return done(run);
    }
    let rid: number;
    try {
      rid =
        pre ??
        (await reserve(o.sb, {
          groupId: o.lecture.group_id,
          lectureId: o.lecture.id,
          kind: "points",
          ref: pointsRef(pc),
          estimateUsd: pieceEstimate(pc),
          daily: false, // the read's first call counted it
        }));
    } catch (e) {
      halt ??= e;
      run.why = errorText(e);
      return done(run);
    }
    run.called += 1;
    const call = pieceCall(pc);
    const byPart = new Map([[pc.part.part_idx, { blocks: pc.blocks }]]);
    const found: SavePoint[] = [];
    let cost = 0;
    let res: Awaited<ReturnType<typeof generateItems>>;
    try {
      res = await generateItems({
        client: o.client,
        kind: "points",
        ref: pointsRef(pc),
        system: call.system,
        messages: [{ role: "user", content: [{ type: "text", text: call.user }] }],
        effort: POINTS_EFFORT,
        maxTokens: call.maxTokens,
        stopAt: o.stopAt,
        wrapper: PointSet,
        item: PointItem,
        onStart: () => {
          if (!started) line({ t: "start" });
          started = true;
        },
        onItem: (p) => {
          const r = checkPoint(p, byPart, lectureSlides);
          if (!r.ok) {
            run.warned.set(r.reason, (run.warned.get(r.reason) ?? 0) + 1);
            return;
          }
          for (const w of r.warnings) run.warned.set(w, (run.warned.get(w) ?? 0) + 1);
          found.push(r.point);
        },
        ledger: async (s) => {
          cost += s.costUsd;
          return settleFor(o.sb, rid, () => (out.unsettled += 1))(s);
        },
      });
    } catch (e) {
      run.cost += cost;
      halt ??= e;
      run.why ??= errorText(e);
      return done(run);
    }
    run.cost += cost;
    run.model = res.model;
    // A reply that stopped early did not finish its paragraphs: the part is read again.
    const stopped = res.timedOut ? "timeout" : res.stop === "refusal" ? "refusal" : res.stop === "max_tokens" ? "truncated" : null;
    if (stopped) run.why ??= stopped;
    else run.found.push(...found);
    return done(run);
  };

  let next = 0;
  const worker = async () => {
    while (next < pieces.length) await readPiece(pieces[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? POINTS_CONCURRENCY, pieces.length)) }, worker));
  if (firstRid !== undefined) await settleFor(o.sb, firstRid, () => (out.unsettled += 1))({ kind: "points", model: MODEL, usage: null, costUsd: 0, estimated: false });
  if (halt) throw halt;
  return out;
}
