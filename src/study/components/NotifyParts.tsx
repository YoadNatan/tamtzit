import { useEffect, type MouseEvent } from "react";
import type { Ctx } from "../features/types";
import { flags } from "../lib/flags";
import { markSeen, seenFor, setShell, useNotices, watchNotices } from "../lib/notices";
import { bellCount, bellLabel } from "../lib/notifyText";
import { routeUrl, tabOf, type Route } from "../lib/route";
import "../styles/notify.css";

/* ── The notifications' pieces in the shell (section R; lazy) ──
 * NotifyCore, mounted once by the shell on every screen: it starts the
 * bell's count for the member and the group, tells the bell which screen is
 * shown, marks seen what the screen shows (seenFor) and a notice opened from
 * outside (?nt=<id>, a push's link). Bell: the link to the inbox at the end
 * of a tab screen's top bar, with the count. */

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
