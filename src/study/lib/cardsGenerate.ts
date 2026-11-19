import { useSyncExternalStore } from "react";
import type { Section, StoredSlide } from "./api";
import { listCardBatches, planCardRound, runCardBatch, type CardBatch, type CardLine } from "./cards";
import { FATAL_CODES, startRound, type RoundResult } from "./rounds";

/* ── Writing a lecture's deck (design-cards §4.4; spec §5.4) ──
 * A round is planned by the database (study_card_round: one part per summary
 * part, about one card per 250 characters of slide text, at most 8 a part;
 * a second round half that, at most 4), then written part by part through
 * F1's rounds.ts: the first part alone until its "start" line, then two at a
 * time, from an app-level store, so it goes on when the deck's screen is
 * left. A part another phone holds ("busy") is skipped; the budget, a key,
 * the session and "enough cards" end the round. */

export const roundKey = (lectureId: string) => `cards:${lectureId}`;

/** Codes that end a cards round instead of failing part after part. */
export const CARDS_FATAL: ReadonlySet<string> = new Set([...FATAL_CODES, "enough cards", "no slides", "lecture not found"]);

/** Whether a part may be written now, by the SQL claim's rule: pending,
 *  failed, or "writing" with no sign of life for six minutes; at most 3 tries. */
export function claimable(b: Pick<CardBatch, "status" | "attempts" | "updated_at">, now = Date.now()): boolean {
  if (b.attempts >= 3) return false;
  if (b.status === "pending" || b.status === "failed") return true;
  return b.status === "writing" && now - Date.parse(b.updated_at) > 6 * 60_000;
}

/* ── what this phone is writing (K2's "נכתב עכשיו…" against "נכתב במכשיר אחר…") ── */

// Parts in flight from this phone, and parts whose response started here
// (this phone's function writes them, even after its stream ends and before
// the part's new status arrives by Realtime). A part answered "busy" never
// started here: it is another phone's.
const inFlight = new Map<string, ReadonlySet<string>>();
const started = new Map<string, Set<string>>();
const writing = new Map<string, ReadonlySet<string>>();
const cardListeners = new Map<string, Set<(c: CardLine) => void>>();
const listeners = new Set<() => void>();
const NONE: ReadonlySet<string> = new Set();
const emit = () => listeners.forEach((l) => l());
const publish = (lectureId: string) => {
  writing.set(lectureId, new Set([...(inFlight.get(lectureId) ?? []), ...(started.get(lectureId) ?? [])]));
  emit();
};

function mark(lectureId: string, batchId: string, on: boolean): void {
  const cur = new Set(inFlight.get(lectureId) ?? []);
  if (on) cur.add(batchId);
  else cur.delete(batchId);
  inFlight.set(lectureId, cur);
  publish(lectureId);
}
function startedHere(lectureId: string, batchId: string): void {
  const cur = started.get(lectureId) ?? new Set<string>();
  cur.add(batchId);
  started.set(lectureId, cur);
  publish(lectureId);
}

/** The parts of a lecture this phone is writing: in flight, or started here. */
export function useWritingHere(lectureId: string): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => writing.get(lectureId) ?? NONE);
}

/** The parts of a lecture with a request in flight from this phone now
 *  (a failed part offers "לנסות שוב" only when none is). */
export function useInFlight(lectureId: string): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => inFlight.get(lectureId) ?? NONE);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Cards as this phone's stream writes them (they also arrive by Realtime). */
export function onCardWritten(lectureId: string, cb: (c: CardLine) => void): () => void {
  const set = cardListeners.get(lectureId) ?? new Set();
  set.add(cb);
  cardListeners.set(lectureId, set);
  return () => set.delete(cb);
}

function writePart(lectureId: string) {
  return async (batchId: string, onStart: () => void): Promise<void> => {
    mark(lectureId, batchId, true);
    try {
      await runCardBatch(lectureId, batchId, {
        start: () => {
          startedHere(lectureId, batchId);
          onStart();
        },
        card: (c) => cardListeners.get(lectureId)?.forEach((cb) => cb(c)),
      });
    } finally {
      mark(lectureId, batchId, false);
    }
  };
}

/** "ליצור": plans the next round (or joins the open one) and writes its parts. */
export async function generateDeck(lectureId: string): Promise<RoundResult & { round: number; wanted: number }> {
  const plan = await planCardRound(lectureId);
  const parts = (await listCardBatches(lectureId)).filter((b) => b.round === plan.round && claimable(b)).map((b) => b.id);
  const r = await startRound(roundKey(lectureId), parts, writePart(lectureId), { fatal: CARDS_FATAL });
  return { ...r, round: plan.round, wanted: plan.wanted };
}

/** "לנסות שוב" on failed or stuck parts: those parts only. */
export function retryParts(lectureId: string, batchIds: string[]): Promise<RoundResult> {
  return startRound(roundKey(lectureId), batchIds, writePart(lectureId), { fatal: CARDS_FATAL });
}

/* ── K3's estimate, before anything is planned ──
 * The same arithmetic as study_card_round, on the slides and parts the phone
 * already has, so the sheet can say "כ-54 כרטיסיות" and its cost without
 * opening a round nobody asked for (a cancelled sheet plans nothing). */

/** char_length() of a value as Postgres prints jsonb (", " and ": " between items). */
function jsonbLength(v: unknown): number {
  if (Array.isArray(v)) return v.length ? 2 + v.reduce((n: number, x) => n + jsonbLength(x), 0) + 2 * (v.length - 1) : 2;
  if (v && typeof v === "object") {
    const e = Object.entries(v as Record<string, unknown>);
    return e.length ? 2 + e.reduce((n, [k, x]) => n + [...JSON.stringify(k)].length + 2 + jsonbLength(x), 0) + 2 * (e.length - 1) : 2;
  }
  return [...JSON.stringify(v ?? null)].length;
}

/** The characters study_card_round counts on a slide: its lines, its notes and its tables. */
export function slideChars(s: Pick<StoredSlide, "lines" | "notes" | "tables">): number {
  const lines = (s.lines ?? []).reduce((n, l) => n + [...l].length, 0);
  const notes = [...(s.notes ?? "")].length;
  const tables = Array.isArray(s.tables) && s.tables.length ? jsonbLength(s.tables) : 0;
  return lines + notes + tables;
}

/** How many cards each part of a round would ask for, as study_card_round
 *  plans them: the summary's parts, or six-slide chunks before an outline. */
export function estimateRound(slides: Array<Pick<StoredSlide, "n" | "lines" | "notes" | "tables">>, sections: Array<Pick<Section, "idx" | "slide_from" | "slide_to">>, round: number): { parts: number; wanted: number } {
  const chars = new Map(slides.map((s) => [s.n, slideChars(s)]));
  const ordered = [...slides].sort((a, b) => a.n - b.n);
  const parts = sections.length
    ? sections.map((p) => ({ from: p.slide_from, to: p.slide_to }))
    : Array.from({ length: Math.ceil(ordered.length / 6) }, (_, i) => {
        const chunk = ordered.slice(i * 6, i * 6 + 6);
        return { from: chunk[0].n, to: chunk[chunk.length - 1].n };
      });
  const cap = round === 1 ? 8 : 4;
  const per = round === 1 ? 250 : 500;
  const want = parts.map((p) => {
    let sum = 0;
    for (const [n, c] of chars) if (n >= p.from && n <= p.to) sum += c;
    return Math.min(cap, Math.round(sum / per));
  });
  const total = want.reduce((a, b) => a + b, 0);
  const kept = want.filter((w) => w >= 1).map((w) => (total > 60 ? Math.max(1, Math.floor((w * 60) / total)) : w));
  return { parts: kept.length, wanted: kept.reduce((a, b) => a + b, 0) };
}

/** K3's cost line: $0.0045 a card, rounded up to the next $0.05 (design-cards §1.3). */
export function estimateUsd(wanted: number): number {
  return Math.max(0.05, Math.ceil(Math.round(0.0045 * wanted * 1e6) / 1e6 / 0.05) * 0.05);
}
