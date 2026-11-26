import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { objOf } from "../../../shared/study/notifyRoute";
import type { Go } from "../features/types";
import { sb } from "./api";
import type { Route, Tab } from "./route";

/* ── The member's notices (section R; DECISIONS-2026-11-26.md) ──
 * Lazy (only NotifyParts.tsx and the inbox import it). Every one of section
 * R's member RPCs has its wrapper here, and one small store keeps what the
 * bell shows: how many notices are unseen and which objects they are about
 * ('lec:<id>'), read from study_notices_unseen and read again, 300 ms after
 * Realtime says the member's own rows changed. Opening a screen whose object
 * has unseen notices marks them seen (seenFor), so a summary ready while
 * its lecture is open never waits on the bell. */

export type Notice = {
  id: number;
  group_id: string | null;
  kind: string;
  cat: "live" | "mine" | "digest" | "security" | "inapp";
  args: Record<string, unknown>;
  route: Record<string, unknown>;
  obj: string | null;
  count: number;
  created_at: string;
  updated_at: string;
  seen_at: string | null;
  ends_at: string | null;
};
export type Unseen = { n: number; objs: string[] };
export type Prefs = { live: boolean; mine: boolean; digest: boolean; digest_at: string; quiet: boolean; quiet_from: string; quiet_to: string; shabbat: boolean };
export type Device = { id: number; device: string; browser: string; created_at: string; seen_at: string; ok_at: string | null; this: boolean };

/** An RPC of section R; throws an Error whose message is the refusal's code. */
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!sb) throw new Error("not-configured");
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error instanceof Error ? error : new Error((error as { message?: string }).message || "unknown");
  return data as T;
}

/* ── The member's RPCs ── */

/** The inbox: this group's notices and the group-less ones, last changed first (50 a page). */
export function noticesMine(group: string, before: number | null = null, limit = 50): Promise<Notice[]> {
  return rpc<Notice[]>("study_notices_mine", { p_group: group, p_before: before, p_limit: limit }).then((r) => r ?? []);
}
export function noticesUnseen(group: string): Promise<Unseen> {
  return rpc<Unseen>("study_notices_unseen", { p_group: group }).then((r) => ({ n: Number(r?.n) || 0, objs: Array.isArray(r?.objs) ? r.objs : [] }));
}
/** Marks these notices seen (null: every one); a push still waiting for them is dropped. */
export function noticesSeen(group: string, ids: number[] | null = null): Promise<number> {
  return rpc<number>("study_notices_seen", { p_group: group, p_ids: ids });
}
export function noticesSeenObj(group: string, obj: string): Promise<number> {
  return rpc<number>("study_notices_seen_obj", { p_group: group, p_obj: obj });
}
/** May this member turn pushes on (the switch "notify", or the pilot)? */
export function notifyState(): Promise<{ send: boolean }> {
  return rpc<{ send: boolean }>("study_notify_state");
}
export function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  return rpc<Prefs>("study_notify_prefs_set", { p: patch });
}
export function devices(endpoint: string | null = null): Promise<Device[]> {
  return rpc<Device[]>("study_push_devices", { p_endpoint: endpoint }).then((r) => r ?? []);
}
export function removeDevice(id: number): Promise<number> {
  return rpc<number>("study_push_remove", { p_id: id });
}
export function sendTest(): Promise<number> {
  return rpc<number>("study_notify_test");
}
/** The host's "להודיע לקבוצה" unchecked: the quiz's held push is dropped. */
export function quizQuiet(quiz: string): Promise<void> {
  return rpc<void>("study_quiz_quiet", { p_quiz: quiz });
}

/* ── The store the bell and the core share ── */

type State = { group: string; unseen: Unseen; tab: Tab | null; go: Go | null };
let state: State = { group: "", unseen: { n: 0, objs: [] }, tab: null, go: null };
const listeners = new Set<() => void>();
function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const snapshot = () => state;

/** What the bell shows, kept current. */
export function useNotices(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The shell's screen: its tab (the bell shows only on a tab's screen) and the app's go(). */
export function setShell(tab: Tab | null, go: Go): void {
  if (state.tab !== tab || state.go !== go) set({ tab, go });
}

let reading = 0;
/** Reads the bell's count again (a failure keeps the last one). */
export async function refreshUnseen(): Promise<void> {
  const group = state.group;
  if (!group) return;
  const mine = ++reading;
  try {
    const unseen = await noticesUnseen(group);
    if (mine === reading && group === state.group) set({ unseen });
  } catch {
    /* offline or refused: the bell keeps what it showed */
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
function soon(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void refreshUnseen(), 300);
}

let seq = 0;
/** Starts the bell for a member in a group: the count now, then again on
 *  each change Realtime reports for the member's own rows (an insert, or an
 *  update: coalesced or seen), on coming back to the page, and online. */
export function watchNotices(group: string, userId: string): () => void {
  set({ group, unseen: { n: 0, objs: [] } });
  void refreshUnseen();
  let ch: RealtimeChannel | null = null;
  if (sb) {
    const filter = `user_id=eq.${userId}`;
    ch = sb
      .channel(`study-notices-${++seq}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "study_notices", filter }, soon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "study_notices", filter }, soon)
      .subscribe();
  }
  const onShow = () => {
    if (document.visibilityState === "visible") soon();
  };
  document.addEventListener("visibilitychange", onShow);
  window.addEventListener("online", soon);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onShow);
    window.removeEventListener("online", soon);
    if (ch) void sb?.removeChannel(ch);
    if (state.group === group) set({ group: "", unseen: { n: 0, objs: [] } });
  };
}

/** The screen just shown: its object's unseen notices are seen. No call when it has none. */
export function seenFor(route: Route): void {
  const obj = objOf(route);
  const group = state.group;
  if (!obj || !group || !state.unseen.objs.includes(obj)) return;
  // Taken off at once, so the next change does not ask twice.
  set({ unseen: { ...state.unseen, objs: state.unseen.objs.filter((o) => o !== obj) } });
  noticesSeenObj(group, obj)
    .catch(() => undefined)
    .finally(() => void refreshUnseen());
}

/** The inbox opened: everything is seen, and the bell goes to 0 at once. */
export async function markAllSeen(group: string): Promise<void> {
  if (group === state.group) set({ unseen: { n: 0, objs: [] } });
  try {
    await noticesSeen(group, null);
  } finally {
    void refreshUnseen();
  }
}

/** A notice opened from outside the app (a push's link, ?nt=<id>): seen. */
export async function markSeen(group: string, ids: number[]): Promise<void> {
  if (!ids.length) return;
  try {
    await noticesSeen(group, ids);
  } finally {
    void refreshUnseen();
  }
}
