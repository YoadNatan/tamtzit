import { Children, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { groupCode, groupLive, lectureTitles, schemaReady, type LiveReader } from "../lib/api";
import { flags } from "../lib/flags";
import { guideMark } from "../lib/guideMark";
import { BACK_LABEL, routeUrl, shareUrl, tabLinks, tabOf, type Route, type Tab } from "../lib/route";
import { GuideButton, GuideSlot } from "../features/guide";
import { MarathonBannerLine } from "../features/progress";
import { QuizBannerLine } from "../features/quiz";
import type { Ctx, Go } from "../features/types";
import ErrorBoundary from "./ErrorBoundary";

/* ── The app shell (spec §5.1; §12.2.1) ──
 * Around every routed screen: one line of live news at the top (who is
 * reading aloud, an open quiz, a marathon), four tabs at the bottom on the
 * tab screens, the toast, and the schema gate. Immersive screens (the reader,
 * upload, a session, a quiz, an editor) have no tab bar and one sticky
 * action bar of their own (StickyActions). With flags.today the tabs are
 * היום · ספרייה · יחד · שלי (decision 6), and the live line is hidden on
 * Today and the meeting, whose band shows the same lines. */

/* ── The text size: the whole app's (the shell's root sets --reading-size, review UX-15) ── */
export const SIZE_KEY = "study-font-size";
export const SIZES = [15, 17, 19, 21];

/** The size a member chose ("שלי", the reader's א- א+), or null. */
export function storedSize(): number | null {
  try {
    const v = Number(localStorage.getItem(SIZE_KEY));
    return SIZES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

/** The size until a member chooses one: 19 px on a tablet or a desktop
 *  (768 px and up, read from further away), 17 on a phone (P2). tokens.css
 *  says the same, so a window that changes width follows it. */
export function defaultSize(): number {
  try {
    return matchMedia("(min-width: 768px)").matches ? 19 : 17;
  } catch {
    return 17;
  }
}

export function readSize(): number {
  return storedSize() ?? defaultSize();
}

/** Applies a text size to the whole app (--reading-size on the root, review UX-15). */
export function applySize(px: number): void {
  document.documentElement.style.setProperty("--reading-size", `${px}px`);
}

export function saveSize(px: number): void {
  applySize(px);
  try {
    localStorage.setItem(SIZE_KEY, String(px));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent("study-font-size", { detail: px }));
}

/** Invites by the share sheet, or copies the link (Library and Me). */
export async function shareInvite(groupId: string, groupName: string, say: (t: string) => void): Promise<void> {
  try {
    const code = await groupCode(groupId);
    const link = shareUrl(`?join=${code}`);
    const text = `מצטרפים ל"${groupName}" בתמצית: ${link} (קוד: ${code})`;
    if (navigator.share) await navigator.share({ text }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(text);
      say("הקישור הועתק. אפשר להדביק בוואטסאפ של הקבוצה.");
    }
    guideMark("invite"); // the guide's first step "להזמין את הקבוצה" (nothing without VITE_STUDY_GUIDE)
  } catch {
    say("לא הצלחנו להכין קישור הזמנה.");
  }
}

/* ── icons (the approved kit's set: home, book, target, users, user) ── */
const ICON: Record<Tab, ReactNode> = {
  today: (
    <>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </>
  ),
  library: (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
  practice: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  group: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  me: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
};

/** A real link (long-press and new tabs work) whose tap stays in the app. */
export function RouteLink({ to, go, className, children, label, current }: { to: Route; go: Go; className?: string; children: ReactNode; label?: string; current?: boolean }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(to);
  };
  return (
    <a href={routeUrl(to)} className={className} onClick={onClick} aria-label={label} aria-current={current ? "page" : undefined}>
      {children}
    </a>
  );
}

export function TabBar({ active, go }: { active: Tab; go: Go }) {
  return (
    <nav className="ph-tabs" aria-label="ניווט ראשי">
      {tabLinks(flags).map((t) => (
        <RouteLink key={t.tab} to={t.route} go={go} className="ph-tab" current={t.tab === active}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICON[t.tab]}
          </svg>
          <span>{t.label}</span>
        </RouteLink>
      ))}
    </nav>
  );
}

/* ── Back ──
 * In-app pushes carry history.state.study and history.state.from (where they
 * came from). A back arrow goes back when the previous entry is ours, else it
 * replaces this entry with the screen's parent; its words name where it goes
 * (review UX-11). */
export function backTarget(fallback: Route, label?: string): { label: string; inApp: boolean } {
  const state = (typeof history !== "undefined" ? history.state : null) as { study?: boolean; from?: string } | null;
  const inApp = state?.study === true;
  const parentKey = fallback.v === "lecture" ? "lecture" : fallback.v;
  const key = inApp ? (state?.from ?? "library") : parentKey;
  return { label: label ?? BACK_LABEL[key] ?? (key === "lecture" ? "→ להרצאה" : inApp ? "→ חזרה" : "→ לספרייה"), inApp };
}

export function BackLink({ go, fallback = { v: "library" }, label, disabled, onLeave }: { go: Go; fallback?: Route; label?: string; disabled?: boolean; /** Said or done as the member leaves (a running simulation: "השעון ממשיך"). */ onLeave?: () => void }) {
  const { label: words, inApp } = backTarget(fallback, label);
  return (
    <button
      type="button"
      className="back"
      disabled={disabled}
      onClick={() => {
        onLeave?.();
        if (inApp) history.back();
        else go(fallback, { replace: true });
      }}
    >
      {words}
    </button>
  );
}

/** A screen's top bar (the kit's ph-head): the back arrow, the screen's
 *  title (its h1), then whatever goes at the end: a chip, tools. */
export function Head({ back, title, children }: { back?: ReactNode; title?: ReactNode; children?: ReactNode }) {
  return (
    <header className="ph-head">
      {back}
      {title !== undefined ? <h1 className="t">{title}</h1> : null}
      {children}
      {flags.guide ? <GuideButton /> : null}
    </header>
  );
}

/* ── Places: where a screen was scrolled to, kept on its history entry ── */
export type Place = { scrollY: number; anchor?: string; top?: number };

/** Where the screen is scrolled to: the first [data-anchor] (a library card)
 *  that starts on screen, its distance from the top, and scrollY. Whatever
 *  grows above that card later (read marks, chips) then cannot move what the
 *  person was looking at. */
export function placeNow(): Place {
  const top = document.querySelector(".shell-stack")?.getBoundingClientRect().bottom ?? 0;
  const el = [...document.querySelectorAll<HTMLElement>("[data-anchor]")].find((e) => e.getBoundingClientRect().top >= top);
  return { scrollY: window.scrollY, anchor: el?.dataset.anchor, top: el?.getBoundingClientRect().top };
}

/** An in-app push to a URL the router reads back (help's #howto, which a
 *  Route cannot carry): the screen being left keeps its place, as go() keeps
 *  it, and Back returns to it. */
export function pushUrl(url: string, from: string): void {
  history.replaceState({ ...(history.state ?? {}), place: placeNow() }, "");
  history.pushState({ study: true, from }, "", url);
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

/* ── Sheets (§5.1: sheets keep today's { studySheet: true } history entries) ──
 * A bottom sheet over the screen. Back, Escape, ✕ and a tap on the backdrop
 * close it; focus moves into it, stays in it, and returns to what opened it.
 * Its entry copies the screen's (so the screen's back arrow keeps its words)
 * without the screen's place, and lists the open sheets, innermost last, so
 * Back closes only the sheet on top and a popstate that closes a sheet is not
 * a move between screens. */
type SheetEntry = { sheets?: string[] } & Record<string, unknown>;
let sheetSeq = 0;
/** This page load's mark on its sheets' ids: a reload keeps history.state, so
 *  an entry may still list "sheet-1" from before it, and the next load's
 *  first sheet must not share that id (Back would then leave it open). */
const SHEET_LOAD = Date.now().toString(36);

/** The sheets open on the current history entry, innermost last. */
export function openSheets(): string[] {
  return (history.state as SheetEntry | null)?.sheets ?? [];
}

/** Pushes a sheet's own history entry; returns its id. */
export function pushSheet(): string {
  const id = `sheet-${SHEET_LOAD}-${++sheetSeq}`;
  const { place: _place, ...screen } = (history.state ?? {}) as SheetEntry;
  history.pushState({ ...screen, studySheet: true, sheets: [...openSheets(), id] }, "");
  return id;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab go round the sheet's controls, never behind it. */
function keepFocusIn(e: KeyboardEvent, box: HTMLElement): void {
  const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  const active = document.activeElement;
  if (!items.length) {
    e.preventDefault();
    box.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!(active instanceof Node) || !box.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (active === first || active === box)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

export type SheetControl = {
  /** Closes the sheet through Back: its entry goes with it. */
  close: () => void;
  /** Closes the sheet, then runs `then` (a move from there starts at the
   *  screen under the sheet, so Back from it returns to that screen). */
  closeThen: (then: () => void) => void;
};

/** A sheet's history entry, Escape, and its focus. `onClose` hides it. */
export function useSheet(box: RefObject<HTMLElement>, onClose: () => void): SheetControl {
  const latest = useRef(onClose);
  latest.current = onClose;
  const me = useRef<{ id: string; live: boolean; closing: boolean; closed: boolean; then?: () => void; opener: HTMLElement | null }>({
    id: "",
    live: false,
    closing: false,
    closed: false,
    opener: null,
  });
  const control = useRef<SheetControl>({
    close: () => {
      const s = me.current;
      if (s.closing || s.closed) return; // a second tap must not go back past the screen
      s.closing = true;
      history.back(); // the popstate below hides the sheet
    },
    closeThen: (then) => {
      const s = me.current;
      if (s.closing || s.closed) return;
      s.then = then;
      s.closing = true;
      history.back();
    },
  });

  useEffect(() => {
    const s = me.current;
    s.live = true;
    if (!s.id) {
      // Once per sheet (React's development re-run of effects keeps the entry).
      s.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      s.id = pushSheet();
      box.current?.focus({ preventScroll: true });
    }
    const onTop = () => {
      const open = openSheets();
      return open[open.length - 1] === s.id;
    };
    const onPop = () => {
      if (s.closed || openSheets().includes(s.id)) return; // a sheet over this one closed
      s.closed = true;
      latest.current();
      const then = s.then;
      s.then = undefined;
      then?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!onTop() || s.closed) return;
      if (e.key === "Escape") {
        e.preventDefault();
        control.current.close();
      } else if (e.key === "Tab" && box.current) keepFocusIn(e, box.current);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      s.live = false;
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      // Hidden by its screen (the quiz's next countdown): its entry goes too.
      // Checked a moment later, after a development re-run that keeps it open.
      setTimeout(() => {
        if (s.live) return;
        if (!s.closed && !s.closing && onTop()) history.back();
        s.closed = true;
        if (s.opener?.isConnected) s.opener.focus({ preventScroll: true });
      }, 0);
    };
    // Once per sheet: box and onClose are read through refs.
  }, []);

  return control.current;
}

/** A bottom sheet: its head (a title and ✕), its body. The body may be a
 *  function of the sheet's control, for buttons that close it first. */
export function Sheet({
  label,
  head,
  className,
  onClose,
  children,
}: {
  label: string;
  head: ReactNode;
  className?: string;
  onClose: () => void;
  children: ReactNode | ((sheet: SheetControl) => ReactNode);
}) {
  const box = useRef<HTMLElement>(null);
  const sheet = useSheet(box, onClose);
  return (
    <div className="a-scrim" onClick={sheet.close}>
      <section
        ref={box}
        tabIndex={-1}
        className={`a-sheet${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="a-sheet-head">
          {head}
          <SheetClose onClick={sheet.close} />
        </header>
        {typeof children === "function" ? children(sheet) : children}
      </section>
    </div>
  );
}

/** A member's initial in a coloured circle (the kit's a-avatar): the same
 *  colour for the same member everywhere. Decorative: the name is beside it. */
export function Avatar({ id, name }: { id: string; name: string }) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={`a-avatar c${(h % 6) + 1}`} aria-hidden="true">
      {[...name.trim()][0] ?? "?"}
    </span>
  );
}

/** A sheet's ✕. */
export function SheetClose({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="a-btn ghost icon" onClick={onClick} aria-label="סגירה">
      ✕
    </button>
  );
}

/** One sticky bar at the bottom of an immersive screen, for its primary action
 *  (review UX-3): the kit's ph-foot. */
export function StickyActions({ children }: { children: ReactNode }) {
  // Nothing to put in it (a quiz member before answering): no empty bar.
  if (Children.toArray(children).length === 0) return null;
  return <div className="ph-foot">{children}</div>;
}

/** A screen whose package has not shipped yet (the slots' seeds). */
export function Soon({ title }: { title: string }) {
  return (
    <main className="soon">
      <Head title={title} />
      <p className="a-muted">בקרוב.</p>
    </main>
  );
}

export function Loading({ text = "טוען…" }: { text?: string } = {}) {
  return <p className="a-muted loading">{text}</p>;
}

/* ── The live banner: one line, highest priority first (review UX-19) ──
 * The quiz (Z), then reading aloud (here, from the group channel), then a
 * marathon (A2). The first line that has something shows; the others make
 * "+1"/"+2", which opens "יחד". Never on the screen it points to. */
function ReadingLine({ ctx, route, readers }: { ctx: Ctx; route: Route; readers: LiveReader[] }) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const other = readers.find((r) => r.user_id !== ctx.userId && !(route.v === "lecture" && route.l === r.reading));
  const lecture = other?.reading;
  useEffect(() => {
    if (!lecture || titles[lecture] !== undefined) return;
    let alive = true;
    lectureTitles([lecture])
      .then((t) => alive && setTitles((m) => ({ ...m, ...t, [lecture]: t[lecture] ?? "" })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lecture, titles]);
  if (!other || !lecture) return null;
  const name = ctx.nameOf(other.user_id) || "ללא שם";
  const title = titles[lecture];
  return (
    <>
      <span className="live-text">
        הקראה עכשיו: {name}
        {title ? <> · <bdi>{title}</bdi></> : null}
      </span>
      <RouteLink to={{ v: "lecture", l: lecture, follow: true }} go={ctx.go} className="a-btn primary small live-act">
        לעקוב
      </RouteLink>
    </>
  );
}

export function LiveBanner({ ctx, route, readers }: { ctx: Ctx; route: Route; readers: LiveReader[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState({ first: -1, more: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const slots = [...el.querySelectorAll<HTMLElement>(":scope > .live-slot")];
      const full = slots.map((s, i) => (s.childNodes.length > 0 ? i : -1)).filter((i) => i >= 0);
      const next = { first: full[0] ?? -1, more: Math.max(0, full.length - 1) };
      setShown((cur) => (cur.first === next.first && cur.more === next.more ? cur : next));
    };
    measure();
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  });
  return (
    <div ref={box} className={`live-banner${shown.first < 0 ? " is-empty" : ""}`} role="status" aria-live="polite">
      <div className={`live-slot${shown.first === 0 ? " is-shown" : ""}`}>
        <QuizBannerLine ctx={ctx} route={route} />
      </div>
      <div className={`live-slot${shown.first === 1 ? " is-shown" : ""}`}>
        <ReadingLine ctx={ctx} route={route} readers={readers} />
      </div>
      <div className={`live-slot${shown.first === 2 ? " is-shown" : ""}`}>
        <MarathonBannerLine ctx={ctx} route={route} />
      </div>
      {shown.more > 0 ? (
        <RouteLink to={{ v: "group" }} go={ctx.go} className="live-more" label={`עוד ${shown.more} ב״יחד״`}>
          +{shown.more}
        </RouteLink>
      ) : null}
    </div>
  );
}

/* ── The schema gate (review FE-2) ── */
const GATE_TEXT = "העדכון של האפליקציה עוד לא הושלם. כדאי לנסות שוב בעוד כמה דקות.";

function SchemaGate({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="gate">
      <div className="a-card gate-card">
        <p role="alert">{GATE_TEXT}</p>
        <button className="a-btn primary" onClick={onRetry}>
          לנסות שוב
        </button>
      </div>
    </main>
  );
}

/* ── No connection (docs/study/ux-p1.md, WP1) ──
 * The member's groups could not be read (the API down, no signal): the
 * member is still signed in here, so the join screen would be wrong. The
 * connection's return tries again by itself. */
export const OFFLINE_TEXT = "אין חיבור כרגע. כדאי לבדוק את החיבור ולנסות שוב.";
export const OFFLINE_AUTO = "הקבוצה תיפתח מעצמה כשהחיבור יחזור.";
export const OFFLINE_LINE = "אין חיבור. מה שכבר נטען נשאר כאן.";

export function ConnectionGate({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [onRetry]);
  return (
    <main className="gate connection-gate">
      <div className="a-card gate-card">
        <p role="alert">{OFFLINE_TEXT}</p>
        <p className="a-small a-muted">{OFFLINE_AUTO}</p>
        <button type="button" className="a-btn primary" onClick={onRetry}>
          לנסות שוב
        </button>
      </div>
    </main>
  );
}

/** Whether the browser says it is online (its online/offline events). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** iOS's keyboard covers the page instead of resizing it: --kb on the root
 *  is how much of the layout viewport it hides (0 at any zoom other than 1,
 *  and under 80 px: the browser's own bars), so a sheet's composer sits
 *  above it (kit.css .a-scrim; WP5). Android resizes the page: 0 there. */
function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const set = () => {
      const hidden = Math.abs(vv.scale - 1) < 0.01 ? Math.round(window.innerHeight - vv.height - vv.offsetTop) : 0;
      if (hidden > 80) root.style.setProperty("--kb", `${hidden}px`);
      else root.style.removeProperty("--kb");
    };
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    return () => {
      vv.removeEventListener("resize", set);
      vv.removeEventListener("scroll", set);
      root.style.removeProperty("--kb");
    };
  }, []);
}

/** One line at the top while the browser is offline. */
function OfflineLine() {
  const online = useOnline();
  if (online) return null;
  return (
    <p className="offline-line" role="status">
      {OFFLINE_LINE}
    </p>
  );
}

type ShellProps = {
  route: Route;
  ctx: Ctx;
  toast: { text: string; action?: { label: string; run: () => void } } | null;
  children: ReactNode;
};

export default function Shell({ route, ctx, toast, children }: ShellProps) {
  const tab = tabOf(route, flags);
  // Today and the meeting show the same lines in their band (§12.2.1).
  const banner = route.v !== "today" && route.v !== "meeting";
  const [schema, setSchema] = useState<"checking" | "ok" | "old">("checking");
  const [readers, setReaders] = useState<LiveReader[]>([]);
  const stack = useRef<HTMLDivElement>(null);
  useKeyboardInset();

  const check = () => {
    setSchema("checking");
    void schemaReady().then((ok) => setSchema(ok ? "ok" : "old"));
  };
  useEffect(check, []);

  // The group channel: who is reading aloud (the banner and "יחד").
  useEffect(() => {
    const live = groupLive(ctx.group.id, { id: ctx.userId }, setReaders);
    return () => live.leave();
  }, [ctx.group.id, ctx.userId]);

  // body.has-tabs moves the reader's fab, the bottom bars and the toast up.
  useEffect(() => {
    document.body.classList.toggle("has-tabs", tab !== null);
    return () => document.body.classList.remove("has-tabs");
  }, [tab]);

  // The banner's height, so a screen's own sticky head sits under it.
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--study-banner-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--study-banner-h");
    };
  }, [schema]);

  if (schema === "old") return <SchemaGate onRetry={check} />;

  return (
    <div className="shell">
      <div className="shell-stack" ref={stack}>
        <OfflineLine />
        {banner ? <LiveBanner ctx={ctx} route={route} readers={readers} /> : null}
      </div>
      <ErrorBoundary reset={routeUrl(route)}>{children}</ErrorBoundary>
      {tab ? <TabBar active={tab} go={ctx.go} /> : null}
      {flags.guide ? (
        <ErrorBoundary reset={routeUrl(route)} fallback="none">
          <GuideSlot route={route} ctx={ctx} />
        </ErrorBoundary>
      ) : null}
      {toast ? (
        <div className="a-toast" role="status">
          <span>{toast.text}</span>
          {toast.action ? (
            <button className="toast-act" onClick={toast.action.run}>
              {toast.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export { GATE_TEXT };
