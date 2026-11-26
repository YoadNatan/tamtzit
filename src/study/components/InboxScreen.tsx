import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { render } from "../../../shared/study/notifyCopy";
import { routeQuery } from "../../../shared/study/notifyRoute";
import type { ScreenProps } from "../features/types";
import { flags } from "../lib/flags";
import { markAllSeen, markSeen, noticesMine, useNotices, type Notice } from "../lib/notices";
import { israelDate, NT, rowTime } from "../lib/notifyText";
import { parseRoute, type Route } from "../lib/route";
import { NotifyOffBar } from "./NotifyParts";
import { BackLink, Head, Loading, RouteLink } from "./Shell";
import "../styles/notify.css";

/* ── "התראות" (?v=notify; section R, the design's §5.5) ──
 * The member's notices in this group (and the group-less ones), last changed
 * first, 30 days back, 50 a page. Opening it marks every one seen (the bell
 * goes to 0); the dots stay for this visit. A tap goes where the notice
 * points. A live notice that is over says so: a group quiz's links to its
 * results, any other has no link. A notice that comes while the inbox is
 * open joins the top of the list, seen at once. A gear opens the settings
 * (x=set, NotifyScreen.tsx) when pushes are offered to this member. */

const PAGE = 50;

/** The screen a notice points to, read through routeQuery (only each screen's own keys). */
function targetOf(n: Notice): Route {
  return parseRoute(new URL(routeQuery(n.route), "https://x.invalid").search);
}

/** A live notice whose time is over (a quiz ended, a meeting done). */
const isOver = (n: Notice, now: number) => n.cat === "live" && n.ends_at !== null && Date.parse(n.ends_at) < now;
const QUIZ_KINDS = new Set(["quiz_open", "boss_open"]);

/** A small icon by the notice's category (decoration: the words say it all). */
function Icon({ cat }: { cat: Notice["cat"] }) {
  const path: Record<Notice["cat"], ReactNode> = {
    live: (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
      </>
    ),
    mine: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    digest: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
    security: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
    inapp: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </>
    ),
  };
  return (
    <svg className="inbox-ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path[n2cat(cat)]}
    </svg>
  );
}
const n2cat = (c: string): Notice["cat"] => (["live", "mine", "digest", "security", "inapp"].includes(c) ? (c as Notice["cat"]) : "inapp");

function Row({ n, fresh, now, go }: { n: Notice; fresh: boolean; now: number; go: ScreenProps<"notify">["ctx"]["go"] }) {
  const over = isOver(n, now);
  const quiz = QUIZ_KINDS.has(n.kind);
  const r = render(n.kind, n.args, n.count, "inbox", now);
  // An ended quiz: "מבחן קבוצתי נפתח", and its results.
  const title = over ? r.title.replace(/\s*עכשיו$/, "") : r.title;
  const sub = over ? (quiz ? `${NT.inbox.ended} · ${NT.inbox.results}` : NT.inbox.ended) : r.body;
  const body = (
    <>
      {fresh ? <span className="inbox-dot" aria-hidden="true" /> : null}
      <Icon cat={n.cat} />
      <span className="inbox-main">
        <span className="inbox-t">
          {title}
          {fresh ? <span className="sr-only"> · {NT.inbox.new}</span> : null}
        </span>
        {sub ? <span className="inbox-b">{sub}</span> : null}
      </span>
      <bdi dir="ltr" className="inbox-time">
        {rowTime(Date.parse(n.updated_at), now)}
      </bdi>
    </>
  );
  const cls = `inbox-row${fresh ? " unseen" : ""}`;
  return <li>{over && !quiz ? <div className={cls}>{body}</div> : <RouteLink to={targetOf(n)} go={go} className={cls}>{body}</RouteLink>}</li>;
}

export default function InboxScreen({ ctx }: ScreenProps<"notify">) {
  const group = ctx.group.id;
  const [rows, setRows] = useState<Notice[] | null>(null);
  // What failed to load, so "לנסות שוב" asks for it again; the list shown stays.
  const [failed, setFailed] = useState<"" | "first" | "more">("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  // Unseen when this visit began (or when it came during it): their dots stay.
  const fresh = useRef(new Set<number>());
  const opened = useRef(false);
  const inflight = useRef(false);
  const { unseen } = useNotices();
  const now = Date.now();

  // The settings' gear, when pushes are offered to this member (health at most daily).
  const [gear, setGear] = useState(false);
  useEffect(() => {
    let alive = true;
    import("../lib/notify")
      .then((m) => m.available(false))
      .then((a) => alive && setGear(a.ok))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /** The first page; rows already shown from later pages stay below it. Opening
   *  the inbox marks every notice seen; a later read marks the new rows it shows. */
  const loadFirst = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    try {
      const page = await noticesMine(group);
      const added = page.filter((n) => !n.seen_at && !fresh.current.has(n.id)).map((n) => n.id);
      for (const id of added) fresh.current.add(id);
      setRows((old) => {
        const ids = new Set(page.map((n) => n.id));
        const oldest = page.length ? Date.parse(page[page.length - 1].updated_at) : 0;
        return [...page, ...(old ?? []).filter((n) => !ids.has(n.id) && Date.parse(n.updated_at) < oldest)];
      });
      setMore((m) => m || page.length === PAGE);
      setFailed("");
      if (!opened.current) {
        opened.current = true;
        await markAllSeen(group).catch(() => undefined);
      } else if (added.length) await markSeen(group, added).catch(() => undefined);
    } catch {
      setFailed("first");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, [group]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  // A notice that comes while the list is open: read the first page again (and see it).
  const loaded = rows !== null;
  useEffect(() => {
    if (loaded && opened.current && unseen.n > 0) void loadFirst();
  }, [loaded, unseen.n, loadFirst]);

  const loadMore = async () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    setBusy(true);
    try {
      const page = await noticesMine(group, last.id);
      setRows((old) => [...(old ?? []), ...page.filter((n) => !(old ?? []).some((o) => o.id === n.id))]);
      setMore(page.length === PAGE);
      setFailed("");
    } catch {
      setFailed("more");
    } finally {
      setBusy(false);
    }
  };

  const today = israelDate(now);
  const groups: Array<{ key: string; label: string; rows: Notice[] }> = [];
  for (const n of rows ?? []) {
    const key = israelDate(Date.parse(n.updated_at)) === today ? "today" : "earlier";
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(n);
    else groups.push({ key, label: key === "today" ? NT.inbox.today : NT.inbox.earlier, rows: [n] });
  }

  return (
    <main className="notify-inbox">
      <Head back={<BackLink go={ctx.go} fallback={flags.today ? { v: "today" } : { v: "library" }} />} title={NT.inbox.title}>
        {gear ? (
          <RouteLink to={{ v: "notify", x: "set" }} go={ctx.go} className="ntf-gear" label={NT.inbox.gearAria}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </RouteLink>
        ) : null}
      </Head>
      {/* Once ever, and only where this device can turn notifications on. */}
      {gear ? <NotifyOffBar ctx={ctx} /> : null}
      {failed ? (
        <div className="a-card inbox-fail" role="alert">
          <p>{NT.inbox.fail}</p>
          <button type="button" className="a-btn small" disabled={busy} onClick={() => void (failed === "more" ? loadMore() : loadFirst())}>
            {NT.inbox.retry}
          </button>
        </div>
      ) : null}
      {rows === null ? (
        failed ? null : <Loading />
      ) : rows.length === 0 ? (
        failed ? null : <p className="a-card dashed empty inbox-empty">{NT.inbox.empty}</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="inbox-day" aria-labelledby={`inbox-${g.key}`}>
            <div className="a-sec">
              <h2 id={`inbox-${g.key}`}>{g.label}</h2>
            </div>
            <ul className="a-list inbox-list">
              {g.rows.map((n) => (
                <Row key={n.id} n={n} fresh={fresh.current.has(n.id)} now={now} go={ctx.go} />
              ))}
            </ul>
          </section>
        ))
      )}
      {rows && rows.length > 0 && more && !failed ? (
        <button type="button" className="a-btn inbox-more" disabled={busy} onClick={() => void loadMore()}>
          {NT.inbox.more}
        </button>
      ) : null}
    </main>
  );
}
