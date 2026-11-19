import { useCallback, useEffect, useRef, useState } from "react";
import { nextAction, onRowEvent, pingNeedsState, pingQuiz, quizState, revealRound, ServerClock, viewOf, watchQuiz, type QuizState, type View } from "./quiz";

/* ── One hook drives a quiz screen (package Z; design-quiz §4.3) ──
 * The state, the server's clock, the one timer, Realtime, the ping, coming
 * back from a locked phone, and keeping the screen on. The database decides
 * everything; this only reads it again at the right moments: a new version
 * on the quiz row (Realtime), every (re)subscribe, a ping that sees a missed
 * step, the page coming back, and the moments nextAction names (the opening,
 * the deadline's reveal, the end of an argument). */

export type UseQuiz = {
  state: QuizState | null;
  view: View | null;
  /** Realtime is subscribed and the last ping answered. */
  live: boolean;
  /** The last read's error code ("quiz not found", "network"…), or "". */
  error: string;
  clock: ServerClock;
  refresh: () => Promise<void>;
};

export function useQuiz(quizId: string): UseQuiz {
  const [state, setState] = useState<QuizState | null>(null);
  const [live, setLive] = useState(true);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);
  const clock = useRef(new ServerClock());
  const stateRef = useRef<QuizState | null>(null);
  stateRef.current = state;
  const lastPing = useRef(0);
  const jitter = useRef(Math.floor(Math.random() * 800));
  const seq = useRef(0);
  const asked = useRef({ key: "", at: 0 });
  // One instant per render: the screen and the timer read the same time. Read
  // twice, a screen drawn a hair before the opening could still show "1"
  // while the timer, a moment later, already waited for the next second.
  const now = clock.current.now();

  // Reads everything this member may see. Overlapping reads: only the newest is applied.
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    const t0 = Date.now();
    try {
      const s = await quizState(quizId);
      clock.current.add(s.now, t0, Date.now());
      if (mine === seq.current) {
        setState(s);
        setError("");
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : "network");
    }
  }, [quizId]);

  const ping = useCallback(async () => {
    const t0 = Date.now();
    try {
      const p = await pingQuiz(quizId);
      clock.current.add(p.server_now, t0, Date.now());
      setLive(true);
      if (pingNeedsState(stateRef.current, p)) void refresh();
    } catch {
      setLive(false);
    } finally {
      lastPing.current = clock.current.now();
      // The one timer is armed after a render: a ping that changed nothing must still arm the next.
      setTick((x) => x + 1);
    }
  }, [quizId, refresh]);

  // Realtime: apply a count, or re-read on a new step; re-read after every (re)subscribe.
  useEffect(
    () =>
      watchQuiz(
        quizId,
        (row) => {
          const r = onRowEvent(stateRef.current, row);
          if (r.kind === "apply") setState(r.state);
          else void refresh();
        },
        (status) => {
          setLive(status === "SUBSCRIBED");
          if (status === "SUBSCRIBED") void refresh();
        },
      ),
    [quizId, refresh],
  );

  // The one timer, armed again after every render: tick, ask for the reveal, or ping.
  // It wakes 2 ms after the moment the screen changes (never a hair before it);
  // a reveal asked for and not yet seen is asked for again at most once a second.
  useEffect(() => {
    if (!state || document.visibilityState === "hidden") return;
    if (!lastPing.current) lastPing.current = now;
    const n = nextAction(state, now, jitter.current, lastPing.current);
    const idx = state.quiz.idx;
    const key = `${idx}:${state.round?.vote ?? 1}`;
    const again = n.what === "reveal" && asked.current.key === key ? asked.current.at + 1000 - now : 0;
    const wait = Math.max(n.inMs, again) - (clock.current.now() - now) + 2;
    const t = window.setTimeout(() => {
      if (n.what === "tick") setTick((x) => x + 1);
      else if (n.what === "reveal") {
        asked.current = { key, at: clock.current.now() };
        void revealRound(quizId, idx)
          .catch(() => undefined)
          .finally(() => void refresh().finally(() => setTick((x) => x + 1)));
      } else void ping();
    }, Math.max(16, wait));
    return () => window.clearTimeout(t);
  });

  // Back from a locked phone, another app, a lost connection or the back-forward cache.
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== "visible") return;
      void ping();
      void refresh();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("pageshow", back);
    window.addEventListener("online", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("pageshow", back);
      window.removeEventListener("online", back);
    };
  }, [ping, refresh]);

  useWakeLock(Boolean(state && ["lobby", "question", "reveal"].includes(state.quiz.state)));

  return { state, view: state ? viewOf(state, now) : null, live, error, clock: clock.current, refresh };
}

/** Keeps the screen on while a quiz runs (released by the system when the
 *  page is hidden, so it is asked for again on return). Silently does
 *  nothing where unsupported (an iPhone Home Screen app before iOS 18.4). */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    if (!on || !nav.wakeLock) return;
    let lock: { release(): Promise<void> } | null = null;
    let alive = true;
    const get = async () => {
      if (document.visibilityState !== "visible" || !nav.wakeLock) return;
      try {
        const l = await nav.wakeLock.request("screen");
        if (alive) lock = l;
        else void l.release();
      } catch {
        /* battery saver, a policy, or a Home Screen app on iOS before 18.4 */
      }
    };
    void get();
    const onVis = () => void get();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => undefined);
    };
  }, [on]);
}
