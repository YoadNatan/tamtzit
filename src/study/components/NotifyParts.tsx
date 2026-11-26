import { lazy, Suspense, useEffect, useState, type MouseEvent } from "react";
import type { Ctx, ScreenProps } from "../features/types";
import { flags } from "../lib/flags";
import { markSeen, seenFor, setShell, useNotices, watchNotices } from "../lib/notices";
import { bellCount, bellLabel, NT } from "../lib/notifyText";
import { parseRoute, routeUrl, tabOf, type Route } from "../lib/route";
import { Loading, RouteLink } from "./Shell";
import "../styles/notify.css";

/* ── The notifications' pieces in the shell (section R; lazy) ──
 * NotifyCore, mounted once by the shell on every screen: it starts the
 * bell's count for the member and the group, tells the bell which screen is
 * shown, marks seen what the screen shows (seenFor) and a notice opened from
 * outside (?nt=<id>, a push's link, or the service worker's message when a
 * push is tapped while the app is open), and, once the page is idle, keeps
 * this device's push subscription current (lib/notify.ts resync: only with
 * the permission given; health at most daily; the worker removed when the
 * keys are). Bell: the link to the inbox at the end of a tab screen's top
 * bar, with the count. NotifyMeRow: "הגדרות התראות" in "שלי", when pushes
 * are offered to this member. */

/** A push's link carries the notice's id as nt=<id>: seen, and the address
 *  loses it (the route itself never had it). */
function takeMarker(group: string): void {
  const q = new URLSearchParams(location.search);
  const nt = q.get("nt");
  if (nt === null) return;
  q.delete("nt");
  const rest = q.toString();
  history.replaceState(history.state, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
  if (/^[1-9]\d{0,15}$/.test(nt)) void markSeen(group, [Number(nt)]).catch(() => undefined);
}

export function NotifyCore({ route, ctx }: { route: Route; ctx: Ctx }) {
  const { unseen } = useNotices();
  const group = ctx.group.id;
  useEffect(() => watchNotices(group, ctx.userId), [group, ctx.userId]);
  useEffect(() => takeMarker(group), [group]);
  useEffect(() => setShell(tabOf(route, flags), ctx.go), [route, ctx.go]);
  // A push tapped while the app is open: the worker focuses this window and says which notice.
  useEffect(() => {
    const c = typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null;
    if (!c) return;
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; url?: unknown; id?: unknown } | null;
      if (!d || d.type !== "study-open" || typeof d.url !== "string") return;
      let u: URL;
      try {
        u = new URL(d.url, location.origin);
      } catch {
        return;
      }
      if (u.origin !== location.origin) return;
      if (typeof d.id === "number" && Number.isSafeInteger(d.id) && d.id > 0) void markSeen(group, [d.id]).catch(() => undefined);
      u.searchParams.delete("nt");
      ctx.go(parseRoute(u.search));
    };
    c.addEventListener("message", on);
    return () => c.removeEventListener("message", on);
  }, [group, ctx]);
  // Idle after the first paint, and again when the member on this device changes.
  useEffect(() => {
    let cancel = () => undefined as void;
    const run = () => void import("../lib/notify").then((m) => m.resync()).catch(() => undefined);
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(run, { timeout: 5000 });
      cancel = () => w.cancelIdleCallback?.(h);
    } else {
      const t = setTimeout(run, 2000);
      cancel = () => clearTimeout(t);
    }
    return cancel;
  }, [ctx.userId]);
  // The screen shown sees its own notices: on arriving, and when one comes while it is open.
  useEffect(() => {
    if (document.visibilityState === "visible") seenFor(route);
  }, [route, unseen]);
  return null;
}

/** The bell (the tab bar's icon style), on a tab's screen only. */
export function Bell() {
  const { tab, go, unseen } = useNotices();
  if (tab === null || !go) return null;
  const to: Route = { v: "notify" };
  const n = unseen.n;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(to);
  };
  return (
    <a href={routeUrl(to)} className="bell" aria-label={bellLabel(n)} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {n > 0 ? (
        <span className="bell-n" dir="ltr" aria-hidden="true">
          {bellCount(n)}
        </span>
      ) : null}
    </a>
  );
}

type MeWord = "on" | "off" | "denied" | "here";

/** "שלי": "הגדרות התראות" with this device's state, only when pushes are offered to this member. */
export function NotifyMeRow({ ctx }: { ctx: Ctx }) {
  const [word, setWord] = useState<MeWord | null>(null);
  useEffect(() => {
    let alive = true;
    void import("../lib/notify")
      .then(async (m) => {
        const a = await m.available(false);
        if (!a.ok) return null;
        return m.meState(await m.readState(true));
      })
      .then((w) => alive && setWord(w))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!word) return null;
  const chip = word === "on" ? "a-chip ok" : word === "denied" ? "a-chip warn" : "a-muted a-small";
  return (
    <div className="a-list links-card ntf-links">
      <RouteLink to={{ v: "notify", x: "set" }} go={ctx.go} className="a-li row-link ntf-me-row">
        <div>
          <b>{NT.me.row}</b>
        </div>
        <span className={chip}>{NT.me.state[word]}</span>
      </RouteLink>
    </div>
  );
}

const Inbox = lazy(() => import("./InboxScreen"));
const Settings = lazy(() => import("./NotifyScreen"));

/** ?v=notify: the inbox; ?v=notify&x=set: the settings (each loaded on its own). */
export function NotifyScreens({ route, ctx }: ScreenProps<"notify">) {
  const S = route.x === "set" ? Settings : Inbox;
  return (
    <Suspense fallback={<Loading />}>
      <S route={route} ctx={ctx} />
    </Suspense>
  );
}
