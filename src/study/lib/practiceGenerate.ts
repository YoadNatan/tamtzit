import { useSyncExternalStore } from "react";
import { startRound, type RoundResult } from "./rounds";
import { listBatches, planRound, runBatch, type Batch, type StreamedQuestion } from "./practice";

/* ── Writing a lecture's questions (package Q; design-questions §4.3, spec §5.4) ──
 *
 * Any member taps "ליצור" once; the whole group gets the questions. A round
 * is planned in the database (study_question_round: about one question per
 * 2.5 slides, 6 to 25, at most 5 a part), and its parts are written by
 * op "questions" through F1's rounds.ts, from an app-level store: the first
 * part alone until its response starts (it writes the lecture into the
 * prompt cache), then two at a time; a part another phone is writing (409
 * busy) is skipped; a fatal code (the budget, the key, the session) ends the
 * round. The round keeps going when P2 unmounts ("להתחיל לתרגל" mid-round),
 * holds a wake lock, and resumes the parts it has not started as soon as the
 * page is visible again (review UX-6).
 *
 * What only this phone knows about its round (which parts it is writing
 * now, which turned out to be another phone's, the questions streamed to it)
 * is kept here per lecture for P2; everything else every phone reads from
 * the database and Realtime. */

/** The key of a lecture's round in rounds.ts's store. */
export const roundKey = (lectureId: string): string => `questions:${lectureId}`;

const SIX_MINUTES = 6 * 60_000;

/** A part that says "writing" but has not changed for 6 minutes: its phone
 *  slept or left, and the claim lets anyone take it (the SQL's rule). */
export const isStuckBatch = (b: Pick<Batch, "status" | "updated_at">, now = Date.now()): boolean =>
  b.status === "writing" && now - Date.parse(b.updated_at) > SIX_MINUTES;

/** A part nobody started for 6 minutes: the phone that planned the round left. */
export const isIdleBatch = (b: Pick<Batch, "status" | "updated_at">, now = Date.now()): boolean =>
  b.status === "pending" && now - Date.parse(b.updated_at) > SIX_MINUTES;

/** A part that will not be tried again: its three paid tries are used. */
export const gaveUp = (b: Pick<Batch, "status" | "error" | "attempts">): boolean => b.status === "failed" && (b.error === "gave up" || b.attempts >= 3);

/** The parts of a round this phone may write, in part order: pending,
 *  failed (unless given up), or stuck. */
export function writableParts(batches: readonly Batch[], round: number, now = Date.now()): string[] {
  return batches
    .filter((b) => b.round === round && (b.status === "pending" || (b.status === "failed" && !gaveUp(b)) || isStuckBatch(b, now)))
    .sort((a, b) => a.part_idx - b.part_idx)
    .map((b) => b.id);
}

/** The lecture's latest round: its parts, whether any is still to be
 *  written (pending or writing), and how many of its questions are written. */
export function latestRound(batches: readonly Batch[]): { round: number; parts: Batch[]; open: boolean; made: number; wanted: number; done: boolean } | null {
  if (!batches.length) return null;
  const round = Math.max(...batches.map((b) => b.round));
  const parts = batches.filter((b) => b.round === round).sort((a, b) => a.part_idx - b.part_idx);
  return {
    round,
    parts,
    open: parts.some((b) => b.status === "pending" || b.status === "writing"),
    made: parts.reduce((n, b) => n + b.made, 0),
    wanted: parts.reduce((n, b) => n + b.wanted, 0),
    done: parts.every((b) => b.status === "ready"),
  };
}

/** About how many questions a round writes for a lecture of `slides` slides:
 *  one per 2.5 slides, 6 to 25 (study_question_round's target). */
export function roundSize(slides: number): number {
  return Math.min(25, Math.max(6, Math.round(slides / 2.5)));
}

/** P3's estimate: $0.019 a question, rounded up to the next $0.05, in cents. */
export function estimateCents(count: number): number {
  return Math.ceil((19 * Math.max(0, count)) / 50) * 5;
}

/** "$0.30", "$12.40", "$33". */
export function usd(dollars: number): string {
  const cents = Math.round(dollars * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/* ── this phone's part of its rounds (per lecture), for P2 ── */

export type LocalRound = {
  /** Parts this phone is writing right now. */
  writing: string[];
  /** Parts another phone turned out to hold (409 busy). */
  elsewhere: string[];
  /** Questions streamed to this phone, newest last. */
  streamed: StreamedQuestion[];
  /** The code that ended this phone's last round early (a fatal one), if any. */
  error?: string;
};

const EMPTY: LocalRound = { writing: [], elsewhere: [], streamed: [] };
const local = new Map<string, LocalRound>();
const listeners = new Set<() => void>();
const set = (lectureId: string, f: (r: LocalRound) => LocalRound) => {
  local.set(lectureId, f(local.get(lectureId) ?? EMPTY));
  listeners.forEach((l) => l());
};

/** This phone's view of a lecture's round; re-renders as its parts move. */
export function useLocalRound(lectureId: string): LocalRound {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => local.get(lectureId) ?? EMPTY,
  );
}

const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

function run(lectureId: string, ids: string[]): Promise<RoundResult> {
  set(lectureId, (r) => ({ ...r, error: undefined, elsewhere: r.elsewhere.filter((id) => !ids.includes(id)) }));
  return startRound(roundKey(lectureId), ids, async (id, onStart) => {
    set(lectureId, (r) => ({ ...r, writing: [...r.writing.filter((x) => x !== id), id] }));
    try {
      await runBatch(lectureId, id, {
        start: onStart,
        question: (q) => set(lectureId, (r) => ({ ...r, streamed: [...r.streamed.filter((x) => x.id !== q.id), q] })),
        skip: () => undefined,
      });
    } catch (e) {
      if (codeOf(e) === "busy") set(lectureId, (r) => ({ ...r, elsewhere: [...new Set([...r.elsewhere, id])] }));
      throw e;
    } finally {
      set(lectureId, (r) => ({ ...r, writing: r.writing.filter((x) => x !== id) }));
    }
  }).then((res) => {
    if (res.error) set(lectureId, (r) => ({ ...r, error: res.error }));
    return res;
  });
}

/** "ליצור" (P3), or "עוד שאלות" while a round is open: plans the next round
 *  (or joins the open one) and writes every part this phone may write.
 *  Throws the planning's code ("enough questions", "lecture not found"…). */
export async function generateRound(lectureId: string): Promise<RoundResult & { round: number }> {
  const plan = await planRound(lectureId);
  const ids = writableParts(await listBatches(lectureId), plan.round);
  const res = await run(lectureId, ids);
  return { ...res, round: plan.round };
}

/** "לנסות שוב" on parts of a round: only those parts are written again. */
export function retryParts(lectureId: string, ids: string[]): Promise<RoundResult> {
  return run(lectureId, ids);
}
