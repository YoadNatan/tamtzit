import { answer, DEFAULT_CONFIG, NEW_CARD, type Rating } from "../../../shared/study/fsrs";
import { myStates, sendReview, toWire, undoReview, type OutboxReview } from "./cards";
import { myPrivateStates, sendMyReview, undoMyReview } from "./cardsDeck";
import type { QState } from "./cardsQueue";

/* ── Answers on their way to the database (design-cards §4.4) ──
 * Every answer goes here first and is sent in order: after each answer, when
 * the phone is back online, when the page becomes visible, and every 30 s
 * while something waits. So leaving a session (✕, Back, closing the app) and
 * a dead connection lose nothing. Kept in localStorage under
 * study-cards-outbox:<user> (every access in try/catch); without storage the
 * answers wait in memory and a failed one is said out loud.
 *
 * Per answer: "ok" or "dup" → done; "stale" (another device of the member
 * answered the card in between) → the card's state is read again and, when
 * this answer is not older than the stored one, the same rating at the same
 * time is computed on it and sent once more, else it is dropped with
 * "התשובה לכרטיסייה הזו נשמרה כבר ממכשיר אחר."; "card deleted", "card not
 * found", "bad time" and the other refusals → dropped; no connection → kept,
 * and the rest wait behind it, so a card's answers arrive in order. A
 * private card's answer (C's end, `mine`) goes the same way through
 * study_my_card_review and study_my_card_undo. */

/** The send, undo and state read of an answer's kind of card. */
const sendOf = (r: OutboxReview) => (r.mine ? sendMyReview(r) : sendReview(r));
const statesOf = (r: OutboxReview) => (r.mine ? myPrivateStates([r.card]) : myStates([r.card]));

const KEY = "study-cards-outbox:";
const RETRY_MS = 30_000;
const DROP_CODES = new Set(["card deleted", "card not found", "bad time", "bad state", "bad rating", "bad review", "review not found"]);
/** Codes that mean "not now" (the session), kept like a dead connection. */
const KEEP_CODES = new Set(["not signed in", "session expired", "session expiring", "not-configured"]);

export type OutboxNotice = { code: string; cardId: string };
export type OutboxHooks = {
  /** The member's retention, for a recomputed stale answer. */
  retention: () => number;
  /** An answer that will not reach the database, with why. */
  onDrop?: (n: OutboxNotice) => void;
};
type Listener = (pending: number) => void;

export class Outbox {
  private memory: OutboxReview[] = [];
  private listeners = new Set<Listener>();
  private flushing: Promise<void> | null = null;
  private inFlight: string | null = null;
  /** Answers already said to be unsaved (private mode), so it is said once. */
  private told = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Private cards' answers sent from this page, so "↶" undoes them with their own function. */
  private sentMine = new Set<string>();
  /** Whether localStorage holds the queue (false in a private window). */
  readonly stored: boolean;

  constructor(
    readonly userId: string,
    private o: OutboxHooks,
  ) {
    let ok = false;
    try {
      const probe = `${KEY}probe`;
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      ok = true;
    } catch {
      ok = false;
    }
    this.stored = ok;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.kick);
      document.addEventListener("visibilitychange", this.onVisible);
    }
  }

  private kick = () => void this.flush();
  private onVisible = () => {
    if (document.visibilityState === "visible") void this.flush();
  };

  /** The screen showing the session now: its retention and its words. The
   *  outbox itself lives as long as the page, so answers keep going out
   *  after the session's screen is gone. */
  setHooks(o: OutboxHooks): void {
    this.o = o;
  }

  private read(): OutboxReview[] {
    if (!this.stored) return [...this.memory];
    try {
      const v = JSON.parse(localStorage.getItem(KEY + this.userId) ?? "[]") as unknown;
      return Array.isArray(v) ? (v as OutboxReview[]) : [];
    } catch {
      return [...this.memory];
    }
  }

  private write(list: OutboxReview[]): void {
    this.memory = [...list];
    if (this.stored) {
      try {
        if (list.length) localStorage.setItem(KEY + this.userId, JSON.stringify(list));
        else localStorage.removeItem(KEY + this.userId);
      } catch {
        /* storage full or gone: the memory copy goes on */
      }
    }
    for (const l of this.listeners) l(list.length);
    if (list.length && !this.timer) this.timer = setInterval(this.kick, RETRY_MS);
    if (!list.length && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** How many answers wait ("3 ממתינות לשליחה"). */
  pending(): number {
    return this.read().length;
  }

  /** The answers waiting, oldest first. */
  list(): OutboxReview[] {
    return this.read();
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Adds an answer and starts sending. */
  enqueue(r: OutboxReview): Promise<void> {
    this.write([...this.read().filter((x) => x.id !== r.id), r]);
    return this.flush();
  }

  /** Forgets a card's waiting answers (a card deleted for the group). */
  dropFor(cardId: string): void {
    this.write(this.read().filter((x) => x.card !== cardId));
  }

  /** Sends what waits, in order; one flush at a time. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.run().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async run(): Promise<void> {
    for (;;) {
      const head = this.read()[0];
      if (!head) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      this.inFlight = head.id;
      const outcome = await this.send(head);
      this.inFlight = null;
      if (outcome === "keep") return;
      if (head.mine) this.sentMine.add(head.id);
      this.write(this.read().filter((x) => x.id !== head.id));
    }
  }

  /** "done" (sent, or dropped for good) or "keep" (try again later). */
  private async send(r: OutboxReview): Promise<"done" | "keep"> {
    try {
      await sendOf(r);
      return "done";
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      if (code === "stale") return this.stale(r);
      if (DROP_CODES.has(code)) {
        this.o.onDrop?.({ code, cardId: r.card });
        return "done";
      }
      if (KEEP_CODES.has(code)) return "keep";
      // No connection (a fetch that never arrived), or a server error: kept.
      if (!this.stored && !this.told.has(r.id)) {
        this.told.add(r.id);
        this.o.onDrop?.({ code: "unsaved", cardId: r.card });
      }
      return "keep";
    }
  }

  /** Another device answered the card in between: answer again on its state,
   *  once, when this answer is not older; else drop it and say so. */
  private async stale(r: OutboxReview): Promise<"done" | "keep"> {
    let s;
    try {
      s = (await statesOf(r)).get(r.card);
    } catch {
      return "keep";
    }
    const stored = s ?? { ...NEW_CARD, card_id: r.card, suspended: false };
    if (stored.lastReview !== null && r.at < stored.lastReview) {
      this.o.onDrop?.({ code: "stale", cardId: r.card });
      return "done";
    }
    const o = answer(stored, r.at, r.rating as Rating, r.card, { ...DEFAULT_CONFIG, retention: this.o.retention() });
    const again: OutboxReview = { ...r, id: crypto.randomUUID(), prevReps: stored.reps, next: toWire(o.card) };
    try {
      await sendOf(again);
      return "done";
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      if (code === "stale" || DROP_CODES.has(code)) {
        this.o.onDrop?.({ code: code === "stale" ? "stale" : code, cardId: r.card });
        return "done";
      }
      return "keep";
    }
  }

  /** "↶": takes back an answer. Still waiting here → it simply goes; already
   *  sent → study_card_undo. Throws Error("not the latest") when the card was
   *  answered again on another device. */
  async takeBack(reviewId: string): Promise<"removed" | "undone"> {
    if (this.flushing && this.inFlight === reviewId) await this.flushing;
    const list = this.read();
    if (list.some((x) => x.id === reviewId) && this.inFlight !== reviewId) {
      this.write(list.filter((x) => x.id !== reviewId));
      return "removed";
    }
    const mine = list.some((x) => x.id === reviewId && x.mine) || this.sentMine.has(reviewId);
    await (mine ? undoMyReview(reviewId) : undoReview(reviewId));
    return "undone";
  }
}

const boxes = new Map<string, Outbox>();

/** The member's outbox (one per user on this page), with the caller's hooks. */
export function outboxFor(userId: string, o: OutboxHooks): Outbox {
  let box = boxes.get(userId);
  if (!box) {
    box = new Outbox(userId, o);
    boxes.set(userId, box);
  } else box.setHooks(o);
  return box;
}

/** Answers waiting on this device for a user, without opening the outbox
 *  (K1's and the library's counts stay right while some are unsent). */
export function waitingReviews(userId: string): OutboxReview[] {
  const open = boxes.get(userId);
  if (open) return open.list();
  try {
    const v = JSON.parse(localStorage.getItem(KEY + userId) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as OutboxReview[]) : [];
  } catch {
    return [];
  }
}

/* ── what waits, applied to what the database said ── */

/** The member's states with this device's unsent answers applied, in order,
 *  so a reload while offline shows the same queue. */
export function withWaiting(states: ReadonlyMap<string, QState>, waiting: OutboxReview[]): Map<string, QState> {
  const out = new Map<string, QState>(states);
  for (const r of waiting) {
    const prev = out.get(r.card);
    if ((prev?.reps ?? 0) !== r.prevReps) continue; // the database is past this answer
    out.set(r.card, {
      suspended: prev?.suspended ?? false,
      state: Math.max(1, Math.min(3, r.next.state)) as 1 | 2 | 3,
      step: r.next.step,
      stability: r.next.stability,
      difficulty: r.next.difficulty,
      due: Date.parse(r.next.due),
      lastReview: r.at,
      reps: r.prevReps + 1,
      lapses: r.next.lapses,
    });
  }
  return out;
}

/* ── "עוד 10 חדשות להיום": extra new cards for today, on this device ── */

const EXTRA = "study-cards-extra:";

/** The extra new cards granted today (by study day). */
export function extraToday(userId: string, day: number): number {
  try {
    const v = JSON.parse(localStorage.getItem(EXTRA + userId) ?? "null") as { day?: number; n?: number } | null;
    return v && v.day === day && typeof v.n === "number" ? v.n : 0;
  } catch {
    return 0;
  }
}

/** Adds to today's extra new cards; returns the new total. */
export function addExtraToday(userId: string, day: number, n: number, current = extraToday(userId, day)): number {
  const total = current + n;
  try {
    localStorage.setItem(EXTRA + userId, JSON.stringify({ day, n: total }));
  } catch {
    /* private mode: it holds for this page only */
  }
  return total;
}
