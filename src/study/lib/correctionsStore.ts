import { useEffect, useState } from "react";
import type { BlockState } from "../features/types";
import type { Section } from "./api";
import { listEdits, listProposals, watchCorrections, type Edit, type Proposal } from "./collab";

/* ── One lecture's corrections, shared by the reader's hook and the sheet ──
 * (package K; §12.3.K). Loaded lazily by features/collab.tsx when
 * VITE_STUDY_CORRECTIONS is on, so the entry chunk carries none of it. The
 * store loads a lecture's corrections and open proposals and keeps them live
 * (Realtime on study_edits and study_edit_proposals, debounced); every phone
 * part that reads them (the reader's chips, the "תיקון" tab, the reader's
 * "אישור בקול") shares one store per lecture, so nothing is fetched twice. A
 * correction that arrives while the lecture is open flashes its paragraph for
 * 2 s. */

export type Corrections = {
  edits: Edit[];
  proposals: Proposal[];
  /** Paragraphs changed while the lecture was open: "part:anchor" → until. */
  flash: Record<string, number>;
  loaded: boolean;
};
type Store = { data: Corrections; subs: Set<() => void>; users: number; reload: () => Promise<void>; stop: () => void };
const stores = new Map<string, Store>();
const EMPTY: Corrections = { edits: [], proposals: [], flash: {}, loaded: false };

function openStore(lectureId: string): Store {
  const have = stores.get(lectureId);
  if (have) {
    have.users += 1;
    return have;
  }
  const s: Store = { data: EMPTY, subs: new Set(), users: 1, reload: async () => undefined, stop: () => undefined };
  const emit = () => s.subs.forEach((f) => f());
  let alive = true;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  s.reload = async () => {
    const mine = ++seq;
    const [edits, proposals] = await Promise.all([listEdits(lectureId), listProposals(lectureId)]);
    if (!alive || mine !== seq) return;
    const known = new Set(s.data.edits.map((e) => e.id));
    const flash = { ...s.data.flash };
    const until = Date.now() + 2000;
    if (s.data.loaded) for (const e of edits) if (!known.has(e.id)) flash[`${e.part_idx}:${e.anchor}`] = until;
    s.data = { edits, proposals, flash, loaded: true };
    emit();
    if (Object.keys(flash).length) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const now = Date.now();
        s.data = { ...s.data, flash: Object.fromEntries(Object.entries(s.data.flash).filter(([, t]) => t > now)) };
        emit();
      }, 2100);
    }
  };
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const unwatch = watchCorrections(lectureId, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void s.reload().catch(() => undefined), 250);
  });
  void s.reload().catch(() => undefined);
  s.stop = () => {
    alive = false;
    clearTimeout(timer);
    clearTimeout(debounce);
    unwatch();
  };
  stores.set(lectureId, s);
  return s;
}

function closeStore(lectureId: string) {
  const s = stores.get(lectureId);
  if (!s || --s.users > 0) return;
  s.stop();
  stores.delete(lectureId);
}

/** Opens (or joins) a lecture's store and calls `onChange` on each change; returns the unsubscribe. */
export function subscribe(lectureId: string, onChange: () => void): () => void {
  const s = openStore(lectureId);
  s.subs.add(onChange);
  onChange();
  return () => {
    s.subs.delete(onChange);
    closeStore(lectureId);
  };
}

/** A lecture's corrections now (empty and not loaded while nobody holds its store). */
export function current(lectureId: string): Corrections {
  return stores.get(lectureId)?.data ?? EMPTY;
}

/** Loads a lecture's corrections again (after this phone's own change). */
export function reload(lectureId: string): Promise<void> {
  return stores.get(lectureId)?.reload() ?? Promise.resolve();
}

/** A lecture's corrections, live, for the lazy screens (the "תיקון" tab). */
export function useCorrections(lectureId: string): Corrections & { reload: () => Promise<void> } {
  const [, tick] = useState(0);
  useEffect(() => subscribe(lectureId, () => tick((n) => n + 1)), [lectureId]);
  return { ...current(lectureId), reload: () => reload(lectureId) };
}

/** The paragraph's state on the page: corrections of the part's current
 *  generation, a proposal waiting for approval, the 2-s flash. */
export function blockStateOf(c: Corrections, s: Section, now: number): (anchor: number) => BlockState {
  const gen = s.gen ?? 0;
  const counts = new Map<number, number>();
  for (const e of c.edits) if (e.part_idx === s.idx && e.gen === gen && e.source_kind !== "undo" && !e.undo_of) counts.set(e.anchor, (counts.get(e.anchor) ?? 0) + 1);
  const pending = new Set(c.proposals.filter((p) => p.part_idx === s.idx && p.gen === gen && (p.state === "pending" || p.state === "disputed")).map((p) => p.anchor));
  return (a) => {
    const st: BlockState = {};
    const n = counts.get(a);
    if (n) st.edited = n;
    if (pending.has(a)) st.pending = true;
    if ((c.flash[`${s.idx}:${a}`] ?? 0) > now) st.flash = true;
    return st;
  };
}
