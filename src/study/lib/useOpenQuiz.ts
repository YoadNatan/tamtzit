import { useEffect, useSyncExternalStore } from "react";
import { flags } from "./flags";
import { openQuiz, recentQuizzes, watchOpenQuiz, type OpenQuiz, type RecentQuiz } from "./quizOpen";

/* ── The group's quiz for the banner and "יחד" (package Z; design-quiz §4.1) ──
 * study_quiz_open, and for "יחד" the last ended quizzes (study_quiz_recent),
 * read on the first use and after every change to the group's quiz rows
 * (Postgres Changes on study_quizzes by group_id, debounced 300 ms). The
 * banner and "יחד" show at the same time, and realtime-js gives one channel
 * per topic, so they share one store and one channel per group, opened by
 * the first screen that needs it and closed with the last. Nothing while the
 * quiz flag is off. */

type Snap = { open: OpenQuiz | null; recent: RecentQuiz[] | null };
type Store = { snap: Snap; users: number; recentUsers: number; listeners: Set<() => void>; stop: () => void; timer?: ReturnType<typeof setTimeout>; load: () => void };

const EMPTY: Snap = { open: null, recent: null };
const stores = new Map<string, Store>();

function storeOf(groupId: string): Store {
  let s = stores.get(groupId);
  if (s) return s;
  const store: Store = {
    snap: EMPTY,
    users: 0,
    recentUsers: 0,
    listeners: new Set(),
    stop: () => undefined,
    load: () => {
      const set = (patch: Partial<Snap>) => {
        store.snap = { ...store.snap, ...patch };
        store.listeners.forEach((l) => l());
      };
      openQuiz(groupId)
        .then((open) => set({ open }))
        .catch(() => undefined); // the banner is an extra: a failure leaves it as it was
      if (store.recentUsers > 0)
        recentQuizzes(groupId, 3)
          .then((recent) => set({ recent }))
          .catch(() => set({ recent: store.snap.recent ?? [] }));
    },
  };
  stores.set(groupId, store);
  return store;
}

function use(groupId: string, recent: boolean): () => void {
  const s = storeOf(groupId);
  s.users += 1;
  if (recent) s.recentUsers += 1;
  if (s.users === 1) {
    s.stop = watchOpenQuiz(groupId, () => {
      clearTimeout(s.timer);
      s.timer = setTimeout(s.load, 300);
    });
  }
  s.load();
  return () => {
    s.users -= 1;
    if (recent) s.recentUsers -= 1;
    if (s.users === 0) {
      // The channel closes with its last screen; the store (a few rows) stays,
      // so a screen still subscribed to it never holds a store nobody updates.
      clearTimeout(s.timer);
      s.stop();
      s.stop = () => undefined;
    }
  };
}

export function useOpenQuiz(groupId: string, withRecent = false): Snap {
  useEffect(() => (flags.quiz ? use(groupId, withRecent) : undefined), [groupId, withRecent]);
  return useSyncExternalStore(
    (l) => {
      const s = storeOf(groupId);
      s.listeners.add(l);
      return () => s.listeners.delete(l);
    },
    () => storeOf(groupId).snap,
  );
}
