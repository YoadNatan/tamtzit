import type { PointsPart } from "../../../shared/study/practice2";
import { failText } from "./failText";

/* ── Reading the points to know, as מה ליצור shows it ──
 *
 * The server reads each stale part in its own call, up to six at once, and
 * saves each part as soon as its call ends (server/study/points.ts). The
 * reading goes on when the phone leaves the screen or sleeps, so the screen
 * never trusts its own stream for the progress: it reads the state of every
 * part from the database (study_points_state through action "plan", and
 * study_point_parts' rows for which parts this read took), live through
 * Realtime and a short poll, on this phone, on a phone that comes back, and
 * on another member's. */

/** A row of study_point_parts as a member reads it. `ahead_at`: the claim's
 *  time when the server read it ahead after the summary (package B, section
 *  B; absent on a database without it). */
export type PointPartRow = {
  part_idx: number;
  status: "pending" | "writing" | "ready" | "failed";
  error: string | null;
  attempts: number;
  updated_at: string;
  ahead_at?: string | null;
};

export type PartState = "waiting" | "reading" | "ready" | "failed" | "stopped";
export type PartView = { part_idx: number; title: string; state: PartState; points: number; error: string | null };
export type ReadProgress = {
  /** Something is being read now (on the server, or this phone just asked). */
  active: boolean;
  /** A claimed part's lease is alive: the server is reading now. */
  live: boolean;
  /** The read's parts whose lease ran out without a result: offer to read again. */
  stopped: boolean;
  /** The read is the server's read ahead, started when the summary was
   *  written (package B), not a member's tap on this or another phone. */
  ahead: boolean;
  parts: PartView[];
  done: number;
  failed: number;
  /** Parts not read, failed or stopped: the status line's "N לא נקראו". */
  missed: number;
  total: number;
};

/** Calls in flight at once on the server (points.ts, POINTS_CONCURRENCY). */
export const READ_AT_ONCE = 6;

/**
 * The read in progress, from the database. Every part a read claims is
 * marked "writing" in one statement, so they share one updated_at; a part it
 * saves or fails gets a later one. The read is the parts touched at or after
 * the latest claim; a "writing" part whose lease is alive (`busy`) is being
 * read, or waits its turn: the server reads the claimed parts in order,
 * READ_AT_ONCE calls at a time, so only the first READ_AT_ONCE of them show
 * "reading". One whose lease ran out was dropped (the server stopped).
 * `asked`: the stale parts when this phone asked, until the claim shows.
 * `claimed`: this phone has seen its read's claim (a live part, or rows read
 * after its stream opened), so rows with nothing "writing" mean the read is
 * over, whatever its stream says: the parts as they ended, and not active.
 */
export function readProgress(parts: readonly PointsPart[], rows: readonly PointPartRow[] | null, asked: readonly number[] | null, claimed = false): ReadProgress {
  const byIdx = new Map(parts.map((p) => [p.part_idx, p]));
  const title = (i: number) => byIdx.get(i)?.title || `חלק ${i + 1}`;
  // Without the rows (a failed read of them), the parts' own status is enough to follow the parts being read.
  const all: PointPartRow[] = rows ? [...rows] : parts.map((p) => ({ part_idx: p.part_idx, status: p.status, error: p.error, attempts: 0, updated_at: p.status === "writing" ? "1970-01-01T00:00:00Z" : "1960-01-01T00:00:00Z" }));
  const at = (r: PointPartRow) => Date.parse(r.updated_at) || 0;
  const writing = all.filter((r) => r.status === "writing");
  const since = writing.length ? Math.max(...writing.map(at)) : null;
  let views: PartView[];
  let live = false;
  let ahead = false;
  if (since !== null) {
    const mine = all.filter((r) => r.status !== "pending" && at(r) >= since && byIdx.has(r.part_idx)).sort((a, b) => a.part_idx - b.part_idx);
    // A read ahead's claim marks its parts' ahead_at with the claim's own time; a member's claim leaves it.
    ahead = writing.some((r) => at(r) === since && r.ahead_at != null && (Date.parse(r.ahead_at) || 0) === since);
    // The parts the server is calling now: the first READ_AT_ONCE still writing, in claim order.
    const now = new Set(
      mine
        .filter((r) => r.status === "writing" && byIdx.get(r.part_idx)!.busy)
        .slice(0, READ_AT_ONCE)
        .map((r) => r.part_idx),
    );
    live = now.size > 0;
    views = mine.map((r) => {
      const p = byIdx.get(r.part_idx)!;
      const state: PartState = r.status === "writing" ? (!p.busy ? "stopped" : now.has(r.part_idx) ? "reading" : "waiting") : r.status === "ready" ? "ready" : "failed";
      return { part_idx: r.part_idx, title: title(r.part_idx), state, points: p.points, error: state === "failed" ? r.error : null };
    });
  } else if (asked) {
    // Asked on this phone: before the claim shows, its parts wait; once it showed and nothing is writing, the read is over.
    views = [...asked]
      .sort((a, b) => a - b)
      .map((i) => {
        const p = byIdx.get(i);
        const state: PartState = p?.current ? "ready" : claimed && p?.status === "failed" ? "failed" : "waiting";
        return { part_idx: i, title: title(i), state, points: p?.points ?? 0, error: state === "failed" ? (p?.error ?? null) : null };
      });
  } else views = [];
  const stopped = views.filter((v) => v.state === "stopped").length;
  const failed = views.filter((v) => v.state === "failed").length;
  return {
    active: live || (asked !== null && !claimed && since === null),
    live,
    stopped: !live && stopped > 0,
    ahead,
    parts: views,
    done: views.filter((v) => v.state === "ready").length,
    failed,
    missed: failed + stopped,
    total: views.length,
  };
}

/** The parts whose last read failed and that are still not read: the reason, and "לנסות שוב". */
export const failedParts = (parts: readonly PointsPart[]): PointsPart[] => parts.filter((p) => p.summary === "ready" && !p.current && p.status === "failed");

/** "בערך דקה": six parts are read at once, each in about a minute. */
export function readTime(parts: number): string {
  const m = Math.max(1, Math.ceil(parts / READ_AT_ONCE));
  return m === 1 ? "בערך דקה" : `בערך ${m} דקות`;
}

/** Why a part's points were not read, in Hebrew (the server's code). */
export function pointsReason(code: string | null | undefined): string {
  const c = (code ?? "").trim();
  if (c === "timeout") return "הקריאה של החלק לקחה יותר מדי זמן.";
  if (c === "refusal") return "המודל סירב לקרוא את החלק הזה.";
  if (c === "truncated") return "הקריאה של החלק נקטעה באמצע.";
  if (c === "stopped") return "הקריאה נעצרה באמצע, לפני שהחלק נשמר.";
  if (c === "part not writing" || c === "bad points") return "החלק השתנה בזמן הקריאה.";
  if (c === "daily_limit") return "אפשר לקרוא את הנקודות של עד 20 הרצאות ביום. מתחדש בחצות.";
  if (!c) return "הקריאה של החלק נכשלה.";
  return failText(c, "practice");
}

/* This phone asked for the read (sessionStorage, for this tab): the screen
 * says "קוראים" and not "במכשיר אחר" when the member comes back to it. Every
 * access in try/catch; without storage it reads as another phone's. */
const mineKey = (lectureId: string) => `study-p2-points:${lectureId}`;
/** A read lasts at most the function's 300 s; its claim's lease six minutes. */
const MINE_MS = 6 * 60_000;

export function markReading(lectureId: string, now = Date.now()): void {
  try {
    sessionStorage.setItem(mineKey(lectureId), String(now));
  } catch {
    /* read as another phone's */
  }
}
export function readingHere(lectureId: string, now = Date.now()): boolean {
  try {
    const t = Number(sessionStorage.getItem(mineKey(lectureId)) ?? "");
    return Number.isFinite(t) && t > 0 && now - t < MINE_MS;
  } catch {
    return false;
  }
}
export function dropReading(lectureId: string): void {
  try {
    sessionStorage.removeItem(mineKey(lectureId));
  } catch {
    /* nothing kept */
  }
}
