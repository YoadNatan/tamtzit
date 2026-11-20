import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Ctx } from "../features/types";
import { flags } from "../lib/flags";
import {
  appTour,
  COPY,
  hintFlags,
  MISSING_LINE,
  nextHint,
  readMemory,
  recordEvent,
  routeEvent,
  screenGuide,
  STOP_LINE,
  walkOf,
  writeMemory,
  type DoneEvent,
  type Hint,
  type MiniStep,
  type Target,
  type Walk,
  type WalkId,
} from "../lib/guide";
import { guideFacts } from "../lib/guideFacts";
import { GUIDE_EVENT, guideSend, takePending, type GuideCommand } from "../lib/guideMark";
import { APP_PATH, routeUrl, screenKey, type Route } from "../lib/route";
import { openSheets, pushUrl } from "./Shell";
import "../styles/guide.css";

/* ── The guide's layer (docs/study/guide.md §2.2-2.3) ──
 * Mounted once in the shell. No scrim, no catcher, no focus trap: the page
 * stays fully usable, and a tap on a ringed element does what it always
 * does. It draws two things, in one slot, at most one at a time:
 *
 *  - the ring: a separate fixed box around the element a step points at
 *    (never a class on the app's own nodes), which no tap can hit;
 *  - the bubble: a docked card at the top or the bottom of the screen,
 *    whichever is away from the ring, with the step's words, "הבא" /
 *    "הקודם" / "הבנתי", and ✕. Escape closes it too.
 *
 * It runs three things: a walk (the first steps' "להראות", help's "הראו
 * לי"), which follows the member's own taps from screen to screen and ends
 * at a STOP without passing it; a screen's "?" mini-guide, or the app tour
 * (the same kind of run, over the tab bar); and one "חדש" hint a day for a
 * feature turned on since the member last looked. Both
 * hide while a sheet is open, while the cards' swipe hint shows, and while
 * the member types. The layer never clicks, sends or writes anything but
 * its own memory on the device. */

type Run =
  | { kind: "walk"; walk: Walk; i: number; opener: HTMLElement | null; missing: boolean }
  | { kind: "mini"; screen: string; steps: MiniStep[]; i: number; opener: HTMLElement | null; at: string; tryIt?: Route; /** where the page was when it started */ y: number }
  | { kind: "hint"; hint: Hint };

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
};

/** The bars a target can sit in (never scrolled, never clipped by the top bar). */
const BARS = ".shell-stack, .ph-head, .ph-top, .ph-tabs, .ph-foot";

/** The top of the free screen: under the live banner and the sticky top bar. */
function topLimit(): number {
  let top = 0;
  for (const el of document.querySelectorAll(".shell-stack, main > .ph-head, main > .ph-top")) {
    const b = el.getBoundingClientRect().bottom;
    if (b > top && b < innerHeight / 2) top = b;
  }
  return top;
}

/** How much of the bottom is taken: the tab bar, a bottom bar, the toast. */
function bottomTaken(): number {
  let taken = 0;
  for (const el of document.querySelectorAll(".ph-tabs, main > .ph-foot, .shell > .a-toast")) {
    const t = el.getBoundingClientRect().top;
    if (t > innerHeight / 2) taken = Math.max(taken, innerHeight - t);
  }
  return taken;
}

/** The element a target names, as the page shows it now. */
export function findTarget(t: Target): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(t.sel)].filter((el) => !el.closest(".g-bubble") && visible(el));
  if (!all.length) return null;
  if (t.pick === "ready") return all.find((el) => el.querySelector(".a-chip.ok")) ?? null;
  if (t.pick === "inView") {
    const top = topLimit();
    const bottom = innerHeight - bottomTaken();
    const whole = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.top >= top && r.bottom <= bottom && r.height < (bottom - top) / 2;
    };
    // A paragraph of text rather than a heading, wholly on screen if one is.
    const text = (el: HTMLElement) => el.tagName === "P" || el.tagName === "LI";
    return all.find((el) => text(el) && whole(el)) ?? all.find(whole) ?? all.find((el) => el.getBoundingClientRect().top >= top) ?? all[0];
  }
  return all[0];
}

/** The one slot is free: no sheet, no swipe hint, no typing. */
function slotFree(): boolean {
  if (openSheets().length) return false;
  if (document.querySelector(".a-scrim, .a-sheet")) return false;
  const hint = document.querySelector(".hint-line");
  if (hint && visible(hint)) return false;
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === "TEXTAREA" || a.isContentEditable)) return false;
  if (a && a.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes((a as HTMLInputElement).type)) return false;
  return true;
}

const reduced = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** The reader is live: this member reads aloud (every follower's screen
 *  follows their scroll) or follows someone (the reader's scroll drives
 *  theirs). The guide then never scrolls the page. */
export function roomLive(): boolean {
  const bar = document.querySelector(".room-bar");
  return Boolean(bar?.querySelector(".room-status") && !bar.querySelector(".room-action .a-btn.primary"));
}

/** Brings an element where the bubble can leave it in sight: nothing when
 *  it is already wholly on screen above a bubble at the bottom or below one
 *  at the top; otherwise centred in the room above a bottom bubble, or, when
 *  it is taller than the room beside the bubble (`bubbleH`), with its top
 *  just under a bubble docked at the top. Says whether it scrolled. */
function bringIntoView(el: HTMLElement, bubbleH: number): boolean {
  if (getComputedStyle(el).position === "fixed" || el.closest(".ph-tabs, .ph-foot, .ph-head, .ph-top")) return false;
  if (roomLive()) return false;
  const r = el.getBoundingClientRect();
  const top = topLimit();
  const bottom = innerHeight - bottomTaken();
  const gap = 8 + bubbleH + 12;
  const behavior: ScrollBehavior = reduced() ? "auto" : "smooth";
  if (bubbleH && r.height > bottom - top - gap - 8) {
    const want = top + gap;
    if (Math.abs(r.top - want) < 2) return false;
    window.scrollBy({ top: r.top - want, behavior });
    return true;
  }
  const inSight = (lo: number, hi: number) => r.top >= lo && r.bottom <= hi;
  if (inSight(top, bottom - gap) || inSight(top + gap, bottom)) return false;
  const want = top + Math.max(0, (bottom - gap - top - r.height) / 2);
  if (Math.abs(r.top - want) < 2) return false;
  window.scrollBy({ top: r.top - want, behavior });
  return true;
}

const dayOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const isHome = (r: Route) => (flags.today ? r.v === "today" && !r.run : r.v === "library");

/** Which screen a route is, for "the member went somewhere else" (a reader's place is not another screen). */
const screenId = (r: Route) => {
  const o = r as Record<string, unknown>;
  return [o.v, o.l, o.s, o.x, o.run, o.isNew].join("|");
};

export default function GuideLayer({ route, ctx }: { route: Route; ctx: Ctx }) {
  const [run, setRun] = useState<Run | null>(null);
  const [free, setFree] = useState(true);
  const [found, setFound] = useState(false);
  const [announce, setAnnounce] = useState("");
  const runRef = useRef(run);
  runRef.current = run;
  const routeRef = useRef(route);
  routeRef.current = route;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const ring = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLElement>(null);
  const focusNext = useRef(false);
  /** The text the bubble said when it took focus (the live region stays quiet for it). */
  const focusedSay = useRef<string | null>(null);
  /** When a bubble button was last pressed: if that button goes away, focus stays in the bubble. */
  const pressed = useRef(0);
  const miss = useRef<{ key: string; since: number }>({ key: "", since: 0 });
  const scrolled = useRef("");
  /** Since when the step's target has been out of sight after its scroll, when the guide last scrolled, and how often again. */
  const away = useRef({ since: 0, at: 0, tries: 0 });
  /** The mini-guide scrolled the page (it puts it back when it ends). */
  const moved = useRef(false);
  /** "קחו אותי" was pressed: the next screen is the walk's own. */
  const took = useRef(false);
  /** When the browser's Back (or Forward) last moved: the walk re-syncs to that screen's step. */
  const popAt = useRef(0);
  const lastScreen = useRef(screenId(route));

  /* ── the memory: real actions tick the first steps off ── */
  const mark = useCallback((ev: DoneEvent) => {
    const c = ctxRef.current;
    const old = readMemory(c.userId);
    const { m, tick } = recordEvent(old, ev, Date.now());
    if (m === old) return;
    writeMemory(c.userId, m);
    if (tick) c.say(tick);
    guideSend({ type: "changed" });
  }, []);

  /** Ends the run. A mini-guide that scrolled the page puts it back where
   *  the member was (not when the member left the screen: `left`). */
  const end = useCallback((left = false) => {
    const r = runRef.current;
    setRun(null);
    setFound(false);
    if (r?.kind === "mini" && moved.current && !left && !roomLive()) window.scrollTo({ top: r.y, behavior: "auto" });
    moved.current = false;
    const opener = r && r.kind !== "hint" ? r.opener : null;
    if (opener?.isConnected && (document.activeElement === document.body || bubble.current?.contains(document.activeElement))) opener.focus({ preventScroll: true });
  }, []);
  const close = useCallback(() => end(), [end]);
  /** A bubble button's handler: remembers the press, so focus never drops to the page. */
  const press = (fn: () => void) => () => {
    pressed.current = Date.now();
    fn();
  };

  const startWalk = useCallback(async (id: WalkId, opener: HTMLElement | null) => {
    const c = ctxRef.current;
    let walk: Walk | null = null;
    try {
      walk = walkOf(id, flags, await guideFacts(c));
    } catch {
      walk = null;
    }
    if (!walk) {
      c.say(MISSING_LINE);
      return;
    }
    const r = routeRef.current;
    const i = Math.max(0, walk.steps.findIndex((s) => s.at(r)));
    focusNext.current = true;
    miss.current = { key: "", since: 0 };
    took.current = false;
    lastScreen.current = screenId(r);
    setRun({ kind: "walk", walk, i, opener, missing: false });
  }, []);

  /** A mini-guide's run: a screen's "?" or the app tour (`tour`). */
  const startScreen = useCallback((opener: HTMLElement | null, tour = false) => {
    const r = routeRef.current;
    const g = tour ? appTour(flags) : screenGuide(r, flags);
    // While the reader is live the page is never scrolled: only what is on screen.
    const live = roomLive();
    const steps = (g?.steps ?? []).filter((s) => {
      const el = findTarget(s.target);
      if (!el || !live) return Boolean(el);
      const b = el.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= innerHeight;
    });
    if (!g || !steps.length) {
      ctxRef.current.say("אין כאן מה להראות כרגע. ״כל העזרה״ ב״שלי״.");
      return;
    }
    focusNext.current = true;
    moved.current = false;
    setRun({ kind: "mini", screen: g.screen, steps, i: 0, opener, at: routeUrl(r), tryIt: g.tryIt, y: window.scrollY });
  }, []);

  /** The app tour points at the tab bar. Its entries (the home's offer,
   *  "שלי", help) all have one; from anywhere else it first goes home (a
   *  navigation, never a tap), and starts once the tab bar is there. */
  const startTour = useCallback(
    (opener: HTMLElement | null) => {
      const tabs = () => [...document.querySelectorAll(".ph-tabs")].some(visible);
      if (tabs()) return startScreen(opener, true);
      ctxRef.current.go(flags.today ? { v: "today" } : { v: "library" });
      let n = 0;
      const wait = () => {
        if (tabs()) startScreen(null, true);
        else if (++n < 30) setTimeout(wait, 100);
      };
      setTimeout(wait, 100);
    },
    [startScreen],
  );

  /* ── commands from the app's screens ── */
  useEffect(() => {
    const on = (e: Event) => {
      const cmd = (e as CustomEvent<GuideCommand>).detail;
      if (!cmd) return;
      if (cmd.type === "mark") {
        takePending();
        mark(cmd.ev);
      } else if (cmd.type === "screen") startScreen(cmd.opener ?? null);
      else if (cmd.type === "tour") startTour(cmd.opener ?? null);
      else if (cmd.type === "walk") void startWalk(cmd.walk as WalkId, cmd.opener ?? null);
      else if (cmd.type === "stop") end(true);
    };
    window.addEventListener(GUIDE_EVENT, on);
    for (const ev of takePending()) mark(ev);
    return () => window.removeEventListener(GUIDE_EVENT, on);
  }, [mark, startScreen, startTour, startWalk, end]);

  /* ── routes that tick a step off, and a ready summary on screen ("open") ── */
  useEffect(() => {
    const ev = routeEvent(route);
    if (ev) mark(ev);
    if (route.v !== "lecture") return;
    let n = 0;
    const t = setInterval(() => {
      if (document.querySelector(".lecture-body [data-part] [data-blk]")) {
        clearInterval(t);
        mark("open");
      } else if (++n > 40) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [route, mark]);

  /* ── a mini-guide is one screen's: leaving it ends it. A walk ends
   *  quietly when the member goes, on their own, to a screen that is none
   *  of its steps, or to one that does not move it on (another tab instead
   *  of the ringed one): it never follows them around. Back re-syncs it,
   *  and "קחו אותי" is the walk's own move. ── */
  useEffect(() => {
    const r = runRef.current;
    const id = screenId(route);
    const changed = id !== lastScreen.current;
    lastScreen.current = id;
    if (r?.kind === "mini" && r.at !== routeUrl(route)) end(true);
    if (r?.kind === "hint" && !isHome(route)) setRun(null);
    if (r?.kind === "walk" && changed) {
      if (took.current) took.current = false;
      else {
        // Each screen's step: on along the walk, the step it was on (unless it
        // waited for this very screen change), or, with Back, an earlier one.
        const here = r.walk.steps.map((s, k) => (s.at(route) ? k : -1)).filter((k) => k >= 0);
        const ahead = here.some((k) => k > r.i);
        const stays = here.includes(r.i) && r.walk.steps[r.i].until !== "route";
        if (ahead) {
          // On to this screen's step now, not on the next frame: no "קודם" flashes in between.
          const next = stepWalk(r, route, miss.current);
          if (next !== r) setRun(next);
        }
        if (!here.length) end(true);
        else if (!ahead && !stays) {
          // Decided once this popstate's listeners have all run (the app's own
          // listener renders the new screen before the guide's hears it).
          const t = setTimeout(() => {
            const now = runRef.current;
            if (now?.kind === "walk" && now.walk === r.walk && Date.now() - popAt.current > 1500) end(true);
          }, 0);
          return () => clearTimeout(t);
        }
      }
    }
  }, [route, end]);
  useEffect(() => {
    // Only the browser's own Back or Forward (an in-app pushUrl dispatches a made-up one).
    const on = (e: PopStateEvent) => {
      if (e.isTrusted) popAt.current = Date.now();
    };
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);

  /* ── "חדש": one hint a day, on the home, for a feature turned on since ── */
  useEffect(() => {
    if (!isHome(route) || runRef.current) return;
    const t = setTimeout(() => {
      if (runRef.current || !slotFree()) return;
      const now = Date.now();
      const m = readMemory(ctx.userId);
      if (!m.known) {
        // The first look: what is on now is what this member knows.
        writeMemory(ctx.userId, { ...m, known: hintFlags(flags) });
        return;
      }
      const hint = nextHint(m, flags, dayOf(now), now);
      if (!hint) return;
      writeMemory(ctx.userId, { ...m, hintDay: dayOf(now), known: [...m.known, hint.flag] });
      setRun({ kind: "hint", hint });
    }, 1200);
    return () => clearTimeout(t);
  }, [route, ctx.userId]);

  /* ── a walk's "until": the member's own tap on the ringed control ── */
  useEffect(() => {
    if (run?.kind !== "walk") return;
    const s = run.walk.steps[run.i];
    if (s.until !== "click") return;
    const on = (e: MouseEvent) => {
      const el = findTarget(s.target);
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
      if (run.i + 1 < run.walk.steps.length) setRun({ ...run, i: run.i + 1 });
      else setTimeout(close, 300);
    };
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  }, [run, close]);

  /* ── Escape always closes it (a sheet's own Escape comes first) ── */
  useEffect(() => {
    if (!run) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !openSheets().length && !document.querySelector(".a-sheet")) end();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [run, end]);

  /* ── each frame while running: the walk's step, the ring and the dock ── */
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const cur = runRef.current;
      if (!cur) return;
      const isFree = slotFree();
      setFree((f) => (f === isFree ? f : isFree));
      let target: Target | null = null;
      if (cur.kind === "walk") {
        if (t - last > 150) {
          last = t;
          const next = stepWalk(cur, routeRef.current, miss.current);
          if (next !== cur) setRun(next);
        }
        const s = cur.walk.steps[cur.i];
        target = s.at(routeRef.current) && !cur.missing ? s.target : null;
      } else if (cur.kind === "mini") target = cur.steps[cur.i].target;
      const el = target && isFree ? findTarget(target) : null;
      setFound((f) => (f === Boolean(el) ? f : Boolean(el)));
      const key = cur.kind === "walk" ? `w${cur.i}|${routeUrl(routeRef.current)}` : cur.kind === "mini" ? `m${cur.i}` : "h";
      if (el && scrolled.current !== key) {
        scrolled.current = key;
        away.current = { since: 0, at: t, tries: 0 };
        const b = bubble.current;
        if (bringIntoView(el, b && !b.hidden ? b.offsetHeight : 0) && cur.kind === "mini") moved.current = true;
      } else if (el && !roomLive() && !el.closest(BARS)) {
        // Something else scrolled the page after the step's one scroll (an
        // item's own smooth scroll as it opened): a target left under the top
        // bar or below the screen for 400 ms is brought back, twice at most.
        const r = el.getBoundingClientRect();
        const out = r.top < topLimit() - 4 || r.top >= innerHeight - bottomTaken();
        const a = away.current;
        if (!out) a.since = 0;
        else if (!a.since) a.since = t;
        else if (t - a.since > 400 && t - a.at > 700 && a.tries < 2) {
          a.since = 0;
          a.at = t;
          a.tries += 1;
          const b = bubble.current;
          if (bringIntoView(el, b && !b.hidden ? b.offsetHeight : 0) && cur.kind === "mini") moved.current = true;
        }
      }
      place(el, ring.current, bubble.current);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [run]);

  /* ── the words the screen reader hears, and focus when a person started it ── */
  const words = run ? bubbleWords(run, route) : null;
  useLayoutEffect(() => {
    const b = bubble.current;
    if (!run || !b || b.hidden) return;
    if (focusNext.current) {
      // A person started it: the bubble takes focus, and its dialog reads the words.
      focusNext.current = false;
      focusedSay.current = words?.text ?? null;
      b.focus({ preventScroll: true });
    } else if (Date.now() - pressed.current < 1500 && (!document.activeElement || document.activeElement === document.body)) {
      // The pressed button went away with the step: focus stays in the bubble.
      pressed.current = 0;
      (b.querySelector<HTMLElement>(".g-actions .a-btn.primary") ?? b).focus({ preventScroll: true });
    }
  });
  // The live region (always in the page, so it is there before its words)
  // says each new step, except the one the focused bubble already reads.
  useEffect(() => {
    const t = words?.text ?? "";
    if (t && t === focusedSay.current) {
      focusedSay.current = null;
      setAnnounce("");
    } else setAnnounce(t);
  }, [words?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = (
    <div key="status" className="sr-only" role="status" aria-live="polite">
      {run && words && free ? announce : ""}
    </div>
  );
  if (!run || !words) return <>{[null, status]}</>;

  const go = (r: Route) => ctx.go(r);
  const buttons: ReactNode[] = [];
  if (run.kind === "walk") {
    const s = run.walk.steps[run.i];
    const here = s.at(route);
    // One key for the main action in every state, so a focused button stays focused when its step changes.
    const primary = (label: string, fn: () => void) => (
      <button key="primary" type="button" className="a-btn primary small" onClick={press(fn)}>
        {label}
      </button>
    );
    if (!here)
      buttons.push(
        primary(COPY.takeMe, () => {
          took.current = true;
          go(s.go);
        }),
      );
    else if (run.missing || s.stop) buttons.push(primary(COPY.done, close));
    else if (s.until === "next") buttons.push(primary(COPY.next, () => setRun({ ...run, i: run.i + 1 })));
    else if (s.until === "end") buttons.push(primary(COPY.gotIt, close));
  } else if (run.kind === "mini") {
    const last = run.i === run.steps.length - 1;
    if (run.i > 0) buttons.push(<button key="prev" type="button" className="a-btn small" onClick={press(() => setRun({ ...run, i: run.i - 1 }))}>{COPY.prev}</button>);
    buttons.push(
      <button key="primary" type="button" className="a-btn primary small" onClick={press(last ? close : () => setRun({ ...run, i: run.i + 1 }))}>
        {last ? COPY.done : COPY.next}
      </button>,
    );
    if (last && run.tryIt) {
      const to = run.tryIt;
      buttons.push(<button key="try" type="button" className="a-btn small" onClick={() => (end(true), go(to))}>לנסות שאלה לדוגמה</button>);
    }
    buttons.push(
      <button key="help" type="button" className="a-link g-all-help" onClick={() => (end(true), pushUrl(`${APP_PATH}?v=help#howto`, screenKey(route)))}>
        {COPY.allHelp}
      </button>,
    );
  } else {
    const h = run.hint;
    if (h.walk) {
      const id = h.walk;
      buttons.push(<button key="show" type="button" className="a-btn primary small" onClick={(e) => void startWalk(id, e.currentTarget)}>{COPY.showMe}</button>);
    } else if (h.go) {
      const to = h.go;
      buttons.push(<button key="show" type="button" className="a-btn primary small" onClick={() => (setRun(null), go(to))}>{COPY.showMe}</button>);
    }
    buttons.push(<button key="ok" type="button" className={`a-btn small${h.walk || h.go ? "" : " primary"}`} onClick={close}>{COPY.gotIt}</button>);
  }

  return (
    <>
      {[
        <Fragment key="layer">
      <div ref={ring} className="g-ring" aria-hidden="true" hidden={!found || !free} data-stop={run.kind === "walk" && run.walk.steps[run.i].stop ? "1" : undefined} />
      <section
        ref={bubble}
        className={`a-card g-bubble${run.kind === "hint" ? " g-hint" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="g-bubble-k"
        aria-describedby="g-bubble-t"
        tabIndex={-1}
        hidden={!free}
      >
        <div className="g-bubble-head">
          <span id="g-bubble-k" className="a-small g-kicker">
            {words.kicker}
          </span>
          <button type="button" className="a-btn ghost icon g-close" aria-label="סגירת המדריך" onClick={close}>
            ✕
          </button>
        </div>
        <p id="g-bubble-t" className="g-say">
          {words.text}
        </p>
        <div className="a-row g-actions">{buttons}</div>
      </section>
        </Fragment>,
        status,
      ]}
    </>
  );
}

/** The kicker and words of the bubble for this run on this screen. */
function bubbleWords(run: Run, route: Route): { kicker: string; text: string } {
  if (run.kind === "hint") return { kicker: COPY.newKicker(run.hint.title), text: run.hint.say };
  if (run.kind === "mini") return { kicker: `${run.i + 1} מתוך ${run.steps.length} · ${run.screen}`, text: run.steps[run.i].say };
  const steps = run.walk.steps;
  const s = steps[run.i];
  const kicker = `${run.i + 1} מתוך ${steps.length} · ${run.walk.title}`;
  if (!s.at(route)) return { kicker, text: COPY.first(s.place) };
  if (run.missing) return { kicker, text: s.empty ?? MISSING_LINE };
  return { kicker, text: s.stop ? `${s.say} ${STOP_LINE[s.stop]}` : s.say };
}

/** A walk's next state on this screen: re-synced to the step this screen
 *  belongs to (Back included; no history entry is ever pushed), on to the
 *  next step when what it waited for appeared, back one when the element
 *  of a "select" step went away (the paragraph closed), and "missing" when
 *  the element is not there after 2.5 s. */
export function stepWalk(run: Extract<Run, { kind: "walk" }>, r: Route, miss: { key: string; since: number }): Run {
  const steps = run.walk.steps;
  let i = run.i;
  if (!steps[i].at(r)) {
    let j = steps.findIndex((s, k) => k > i && s.at(r));
    if (j < 0) for (let k = i - 1; k >= 0 && j < 0; k--) if (steps[k].at(r)) j = k;
    if (j >= 0) i = j;
  }
  const s = steps[i];
  if (s.at(r) && s.until === "select" && s.select && document.querySelector(s.select) && i + 1 < steps.length) i += 1;
  const cur = steps[i];
  let missing = false;
  if (cur.at(r)) {
    const key = `${i}|${routeUrl(r)}`;
    const el = findTarget(cur.target);
    if (el) miss.key = "";
    else {
      if (miss.key !== key) Object.assign(miss, { key, since: Date.now() });
      const prev = steps[i - 1];
      if (prev && prev.until === "select" && prev.at(r) && Date.now() - miss.since > 400) {
        i -= 1;
        miss.key = "";
      } else missing = Date.now() - miss.since > 2500;
    }
  }
  if (i === run.i && missing === run.missing) return run;
  return { ...run, i, missing: missing || (i === run.i && run.missing) };
}

/** Places the ring around the element and docks the bubble away from it.
 *  An element taller than the room the bubble leaves (a whole card at
 *  360×640) gets the bubble at the top and a ring around only its part
 *  below the bubble: the bubble never covers what the ring shows. */
function place(el: HTMLElement | null, ring: HTMLDivElement | null, bubble: HTMLElement | null): void {
  const box = el?.getBoundingClientRect() ?? null;
  const shown = Boolean(bubble && !bubble.hidden);
  const h = shown ? bubble!.offsetHeight : 0;
  const top = topLimit() + 8;
  const bottomGap = bottomTaken() + 8;
  const bottomTop = innerHeight - bottomGap - h;
  const pad = 4;
  let r: { top: number; bottom: number; left: number; width: number } | null = box ? { top: box.top, bottom: box.bottom, left: box.left, width: box.width } : null;
  let dock: "top" | "bottom" = "bottom";
  // The same measure as bringIntoView's "taller than the room" (free height − bubble − 28).
  if (r && shown && r.bottom - r.top > innerHeight - bottomGap - top - h - 12) {
    dock = "top";
    r = { ...r, top: Math.max(r.top, top + h + 2 * pad), bottom: Math.min(r.bottom, innerHeight - bottomGap) };
    if (r.bottom < r.top) r.bottom = r.top;
  } else if (r) {
    const overBottom = r.bottom > bottomTop - 4 && r.top < innerHeight - bottomGap;
    const overTop = r.top < top + h + 4 && r.bottom > top;
    if (overBottom && !overTop) dock = "top";
    else if (overBottom && overTop) dock = r.top - top > bottomTop - r.bottom ? "top" : "bottom";
  }
  if (ring && r) {
    // Clipped, never shifted: a target partly above the screen (or under the
    // top bar) gets a ring around its visible part only, never one drawn over
    // whatever is below it; wholly under the bar, no ring.
    // (A target in a bar itself, the "?" or "⋯" in the top bar, is never clipped by it.)
    const limit = el && !el.closest(BARS) ? topLimit() : 0;
    const t = Math.max(2, limit, r.top - pad);
    ring.style.left = `${Math.max(2, r.left - pad)}px`;
    ring.style.top = `${t}px`;
    ring.style.width = `${Math.min(innerWidth - 4, r.width + 2 * pad)}px`;
    ring.style.height = `${Math.max(0, r.bottom + pad - t)}px`;
    ring.style.visibility = limit && r.bottom <= limit ? "hidden" : "";
  }
  if (!bubble || !shown) return;
  if (dock === "bottom") {
    bubble.style.top = "";
    bubble.style.bottom = `${bottomGap}px`;
  } else {
    bubble.style.bottom = "";
    bubble.style.top = `${top}px`;
  }
  bubble.dataset.dock = dock;
}
