import { useSyncExternalStore } from "react";

/* ── Rounds of paid parts, run from an app-level store (spec §5.4) ──
 * Questions (Q), cards (C) and a quiz's questions (Z) are written part by
 * part. runParts writes the first part alone until its response starts (the
 * prompt cache becomes readable then), then two at a time; a part another
 * phone is writing (`busy`) is skipped, and a code in `fatal` (the budget, a
 * key, the session) ends the round. Each part gets at most 3 paid tries on
 * the server (`gave up`).
 *
 * startRound runs it outside any screen (review UX-6): the round goes on when
 * its screen unmounts, holds a Screen Wake Lock while it runs where the
 * browser allows, and resumes the parts it has not started as soon as the
 * page is visible again, instead of waiting for a stuck part's 6 minutes.
 * Screens read it with useRound(key). */

/** The line P2, K2 and the quiz lobby show while a round runs. */
export const KEEP_SCREEN_ON = "כדאי להשאיר את המסך פתוח עד שהשאלות נכתבות.";

/** Codes that end a whole round instead of failing part after part. */
export const FATAL_CODES: ReadonlySet<string> = new Set([
  "budget",
  "reserve",
  "member_share",
  "daily_limit",
  "off",
  "schema",
  "forbidden",
  "bad_api_key",
  "missing ANTHROPIC_API_KEY",
  "missing STUDY_WORKER_KEY",
  "not signed in",
  "session expired",
]);

export type PartRun = (id: string, onStart: () => void) => Promise<void>;
export type RoundResult = { done: number; failed: number; busy: number; error?: string };

/** Errors that come from the page being hidden (a locked phone), not from the part. */
const isPause = (code: string) => code === "network" || code === "Failed to fetch" || code === "Load failed";

function codeOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "");
}

/** Waits until the page is visible (immediately when it is, or outside a browser). */
function visible(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((ok) => {
    const on = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", on);
      ok();
    };
    document.addEventListener("visibilitychange", on);
  });
}

/** Runs the parts: the first alone until it starts, then `width` at a time. */
export async function runParts(ids: string[], one: PartRun, o: { width?: number; fatal?: ReadonlySet<string>; onChange?: (r: RoundResult) => void } = {}): Promise<RoundResult> {
  const width = Math.max(1, o.width ?? 2);
  const fatal = o.fatal ?? FATAL_CODES;
  const queue = [...ids];
  const retried = new Set<string>();
  const result: RoundResult = { done: 0, failed: 0, busy: 0 };
  const changed = () => o.onChange?.({ ...result });

  const run = async (id: string, onStart: () => void) => {
    await visible();
    try {
      await one(id, onStart);
      result.done += 1;
    } catch (e) {
      const code = codeOf(e);
      if (code === "busy") result.busy += 1;
      else if (isPause(code) && !retried.has(id)) {
        // The phone slept mid-part: once visible again, it goes back in line (unpaid network errors only).
        retried.add(id);
        queue.push(id);
      } else {
        result.failed += 1;
        if (fatal.has(code) && !result.error) {
          result.error = code;
          queue.length = 0;
        }
      }
    } finally {
      onStart();
      changed();
    }
  };
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) await run(id, () => undefined);
  };

  const first = queue.shift();
  if (first !== undefined) {
    let started!: () => void;
    const startedP = new Promise<void>((ok) => (started = ok));
    const firstRun = run(first, () => started());
    await Promise.race([startedP, firstRun]);
    // The first part's worker joins the others once its part ends: at most `width` in flight.
    await Promise.all([firstRun.then(worker), ...Array.from({ length: width - 1 }, worker)]);
  }
  return result;
}

/* ── the app-level store ── */

export type RoundSnapshot = RoundResult & { key: string; total: number; running: boolean };

const rounds = new Map<string, RoundSnapshot>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let wakeLock: { release(): Promise<void> } | null = null;

async function holdScreen(on: boolean): Promise<void> {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } });
  try {
    if (on && !wakeLock && nav?.wakeLock && document.visibilityState === "visible") wakeLock = await nav.wakeLock.request("screen");
    if (!on && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release();
    }
  } catch {
    wakeLock = null; // not allowed here (no gesture, battery saver): the round runs anyway
  }
}
const anyRunning = () => [...rounds.values()].some((r) => r.running);
if (typeof document !== "undefined") {
  // A wake lock is released when the page is hidden: take it again on return.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && anyRunning()) {
      wakeLock = null;
      void holdScreen(true);
    }
  });
}

/** Starts a round under `key`, or returns the one already running with it. */
export function startRound(key: string, ids: string[], one: PartRun, o: { width?: number; fatal?: ReadonlySet<string> } = {}): Promise<RoundResult> {
  const cur = rounds.get(key);
  if (cur?.running) return new Promise((ok) => {
    const l = () => {
      const r = rounds.get(key);
      if (r && !r.running) {
        listeners.delete(l);
        ok(r);
      }
    };
    listeners.add(l);
  });
  rounds.set(key, { key, total: ids.length, running: true, done: 0, failed: 0, busy: 0 });
  emit();
  void holdScreen(true);
  return runParts(ids, one, {
    ...o,
    onChange: (r) => {
      rounds.set(key, { ...rounds.get(key)!, ...r });
      emit();
    },
  }).then((r) => {
    rounds.set(key, { key, total: ids.length, running: false, ...r });
    if (!anyRunning()) void holdScreen(false);
    emit();
    return r;
  });
}

/** The round under `key` (running or finished), or null. */
export function roundOf(key: string): RoundSnapshot | null {
  return rounds.get(key) ?? null;
}

/** A screen's view of a round; it re-renders as parts finish. */
export function useRound(key: string): RoundSnapshot | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => rounds.get(key) ?? null,
  );
}
