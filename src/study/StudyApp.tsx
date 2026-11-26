import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { claimDevice, configured, getSession, getSessionState, listLectures, members, myGroups, onAuthChange, redeemPersonalCode, type Group, type Member } from "./lib/api";
import { failText } from "./lib/failText";
import { cacheCode, cachedCode, takeLinkCode, takeWelcome, welcomeNext } from "./lib/personalCode";
import { flags } from "./lib/flags";
import { markRestored } from "./lib/guideMark";
import { retryImport } from "./lib/staleChunk";
import { allowed, APP_PATH, parseRoute, routeUrl, screenKey, type Route } from "./lib/route";
import { AccountLayer, accountStartup, openAccount, type PendingLink } from "./features/account";
import { BossScreen } from "./features/boss";
import { CardsScreen } from "./features/cards";
import { CourseScreen } from "./features/courses";
import { AskScreen } from "./features/collab";
import { TrapScreen } from "./features/extras";
import { GuideHowTo, TryScreen } from "./features/guide";
import { InstallScreen } from "./features/install";
import { NotifyRoute } from "./features/notify";
import { CatchupScreen, MeetingScreen } from "./features/meeting";
import { PlanScreen } from "./features/plan";
import { SetsRoute } from "./features/qsets";
import { ExamsScreen, MockScreen, PracticeScreen } from "./features/practice";
import { EveScreen, MarathonScreen, ProgressScreen } from "./features/progress";
import { MuseumScreen, PulseScreen } from "./features/pulse";
import { QuizScreen } from "./features/quiz";
import { TodayScreen } from "./features/today";
import { DisputeScreen, LogScreen } from "./features/var";
import { WallScreen } from "./features/wall";
import type { Ctx, Go, Say } from "./features/types";
import Join from "./components/Join";
import Library from "./components/Library";
import LectureView from "./components/LectureView";
import Shell, { applySize, BackLink, ConnectionGate, Loading, placeNow, storedSize, type Place } from "./components/Shell";

/* ── תמצית ──
 * /            the home: Today once flags.today is on, the group's
 *              library until then (or the join screen)
 * /?join=CODE  an invite link: the join screen with the code filled in
 * /?l=<id>     one lecture's summary, shareable on WhatsApp
 * /?v=…        every other screen (lib/route.ts, spec §5.2)
 *
 * /#k=CODE    a member's personal code (docs/study/personal-code.md): read
 *              and taken out of the address at once; without a member on
 *              this device it signs in as that member, with one it asks first
 *              (the code this device already holds: one line). A sign-in
 *              with the code ends with a fresh page, so nothing of the
 *              member before keeps running as the new one.
 *
 * Order of checks (spec §5.1): ?join= → Join; no session or no group → Join;
 * else the route, inside the shell. A route whose feature is off is replaced
 * by the nearest one that is on, with one line saying why. */

const GROUP_KEY = "study-group";

/** A #k= link this page was opened with, read once as the app loads (before
 *  anything renders, so the code never stays in the address bar). */
const LINK_AT_START = configured ? takeLinkCode() : null;
/** The page before this one signed in with the code: its toast, once in. */
const WELCOME_AT_START = takeWelcome();
const ALREADY_IN = "הכניסה כבר פעילה במכשיר הזה.";
const MALFORMED = "הקוד האישי הוא 16 תווים, אותיות ומספרים.";

function rememberGroup(id: string) {
  try {
    localStorage.setItem(GROUP_KEY, id);
  } catch {
    /* private mode */
  }
}

/* The packages' screens come from their slot modules, each lazy inside its
 * own module (review F-8: a lazy import here would not split a module that
 * the shell, "יחד", the library or the lecture also import statically).
 * F's own screens that nothing else imports load lazily here. */
const GroupScreen = lazy(retryImport(() => import("./components/Group")));
const MeScreen = lazy(retryImport(() => import("./components/Me")));
const UploadScreen = lazy(retryImport(() => import("./components/Upload")));
const HelpScreen = lazy(retryImport(() => import("./components/Help")));
const HelpFooter = lazy(retryImport(() => import("./components/Help").then((m) => ({ default: m.HelpSpend }))));

/** Back restores the place: the same card at the same height once it is on
 *  the page, held there for a moment while the screen's data arrives (read
 *  marks, chips) and grows the cards above it; else scrollY once the page is
 *  tall enough. A finger on the screen ends it. For up to 2 s. */
function restoreScroll(p: Place): void {
  const until = Date.now() + 2000;
  let stop = false;
  const end = () => (stop = true);
  for (const ev of ["wheel", "touchstart", "keydown"]) addEventListener(ev, end, { once: true, passive: true });
  const step = () => {
    if (stop) return;
    const el = p.anchor ? document.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(p.anchor)}"]`) : null;
    if (el && p.top !== undefined) {
      const d = el.getBoundingClientRect().top - p.top;
      if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: "instant" as ScrollBehavior });
    } else if (!p.anchor && document.documentElement.scrollHeight >= p.scrollY + innerHeight - 1) {
      window.scrollTo({ top: p.scrollY, behavior: "instant" as ScrollBehavior });
      return;
    }
    if (Date.now() < until) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function currentRoute(): Route {
  return parseRoute(location.search, location.hash);
}

export default function StudyApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [group, setGroup] = useState<(Group & { me: string }) | null>(null);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  // The member's groups (or the session itself) could not be read: no
  // connection. Join is only for a member with no group (WP1).
  const [offline, setOffline] = useState(false);
  const groupRef = useRef(group);
  groupRef.current = group;
  const [route, setRoute] = useState<Route>(currentRoute);
  const [courses, setCourses] = useState<string[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const started = useRef(false);
  // An invite link opened by someone who is already in a group (a home-screen
  // icon saved on the invite, or the link tapped again) goes straight in.
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.search).get("join") ?? "");
  // The personal code: a #k= link still to handle, a sign-in with it under
  // way, the join screen's code panel to open (with what failed), and the
  // toast once the member is back.
  const [link, setLink] = useState(LINK_AT_START);
  const [restoring, setRestoring] = useState(false);
  const [codePanel, setCodePanel] = useState<{ code: string; error: string } | null>(null);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const welcome = useRef(WELCOME_AT_START);

  // The text size is the whole app's (review UX-15).
  useEffect(() => {
    // A chosen size; without one, tokens.css's default (bigger on a tablet).
    const chosen = storedSize();
    if (chosen) applySize(chosen);
  }, []);

  const readSession = useCallback(() => {
    void getSessionState().then((r) => {
      setOffline(r.offline);
      if (!r.offline) setSession(r.session);
    });
  }, []);
  useEffect(() => {
    readSession();
    return onAuthChange(setSession);
  }, [readSession]);

  const loadGroups = useCallback(async (s: Session) => {
    const gs = await myGroups(s.user.id);
    let saved = "";
    try {
      saved = localStorage.getItem(GROUP_KEY) ?? "";
    } catch {
      /* private mode */
    }
    setGroup(gs.find((g) => g.id === saved) ?? gs[0] ?? null);
    setGroupsLoaded(true);
  }, []);

  useEffect(() => {
    if (session) {
      claimDevice(session.user.id); // another user's entries leave this device (§5.9)
      void loadGroups(session).catch(() => {
        // A group already on screen stays (a token refresh's re-read failed).
        if (!groupRef.current) setOffline(true);
        setGroupsLoaded(true);
      });
      if (!started.current) {
        started.current = true;
        void accountStartup().then((r) => r === "merged" && location.reload());
      }
    } else if (session === null) {
      setGroup(null);
      setGroupsLoaded(true);
    }
  }, [session, loadGroups]);

  const say: Say = useCallback((text, action) => {
    clearTimeout(toastTimer.current);
    setToast({ text, action: action && { label: action.label, run: () => (setToast(null), action.run()) } });
    toastTimer.current = setTimeout(() => setToast(null), action ? 6000 : 3500);
  }, []);

  /** Signs this device in as a personal code's member. The same member
   *  already here: one line. Anyone else, or no one: the code is kept on
   *  the device ("שלי" can show it again), and the page starts afresh as
   *  that member, with "חזרה לקבוצה בתור …" once their group is in. In-page
   *  state of the member before (the cards' outbox and its timer, channels)
   *  would otherwise keep running with the new member's session (review
   *  data-integrity 1). Throws the code's failure; after a switch it never
   *  settles (the page is going). */
  const restore = useCallback(
    async (code: string) => {
      const before = (await getSession())?.user.id;
      if (before && cachedCode(before)?.code === code) {
        say(ALREADY_IN);
        return;
      }
      const r = await redeemPersonalCode(code);
      cacheCode(r.userId, code);
      if (r.same) {
        say(ALREADY_IN);
        return;
      }
      markRestored(r.userId); // the guide: a member who knows the app, not a new one (no tour offer)
      setPendingLink(null);
      welcomeNext();
      // A set's link opened signed out (practice sets, §5.6): the sign-in lands on that set.
      const here = parseRoute(location.search);
      // An uploaded exam's or sheet's link too (VITE_STUDY_SHEETS, design-exams §5.12).
      location.replace((flags.sets && here.v === "sets" && here.k) || (flags.sheets && here.v === "exams" && here.e) ? routeUrl(here) : APP_PATH);
      await new Promise<never>(() => undefined);
    },
    [say],
  );

  // A #k= link: once it is known whether a member is signed in here.
  useEffect(() => {
    if (!link || session === undefined || (session && !groupsLoaded)) return;
    setLink(null);
    if (!link.code) {
      if (group) say(MALFORMED);
      else setCodePanel({ code: "", error: MALFORMED });
      return;
    }
    if (session && group) {
      // The code this device already holds (its own link, tapped to test it): nothing to ask.
      if (cachedCode(session.user.id)?.code === link.code) say(ALREADY_IN);
      else setPendingLink({ code: link.code, name: group.me });
      return;
    }
    const code = link.code;
    setRestoring(true);
    restore(code)
      .catch((e: unknown) => setCodePanel({ code, error: failText(e instanceof Error ? e.message : "", "group") }))
      .finally(() => setRestoring(false));
  }, [link, session, groupsLoaded, group, restore, say]);

  // A route whose feature is off is never shown: it is replaced while
  // rendering by the nearest one that is on (§5.2, review UX-1), so no screen
  // mounts, or runs its effects, with a route it must not open. allowed()
  // returns the route itself when it is on, so a screen's route keeps its
  // identity from one render to the next.
  const gate = useMemo(() => allowed(route, flags), [route]);
  const shown = gate.route;
  const routeRef = useRef(shown);
  routeRef.current = shown;

  // Back restores where the screen was scrolled to: each push remembers the
  // place, and a screen whose data arrives after the pop is put back there.
  // A popstate that leaves the screen as it was (a sheet closed by Back, or a
  // sheet's own entry) changes nothing: the screen stays where it is.
  useEffect(() => {
    try {
      history.scrollRestoration = "manual";
    } catch {
      /* old browsers */
    }
    const onPop = () => {
      const next = currentRoute();
      if (routeUrl(next) === routeUrl(routeRef.current)) return;
      setRoute(next);
      const place = (history.state as { place?: Place } | null)?.place;
      if (place && place.scrollY > 0) restoreScroll(place);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go: Go = useCallback(
    (r, o) => {
      const url = routeUrl(r);
      if (o?.replace) {
        // The entry before this one does not change, so neither does whether it is ours.
        const prev = (history.state ?? {}) as { study?: boolean; from?: string };
        history.replaceState({ study: prev.study, from: prev.from }, "", url);
      } else if (location.pathname + location.search !== url) {
        history.replaceState({ ...(history.state ?? {}), place: placeNow() }, "");
        // The screen being left as it is shown: "/" is the library until Today is on.
        history.pushState({ study: true, from: screenKey(allowed(currentRoute(), flags).route) }, "", url);
      }
      setRoute(parseRoute(url.slice(url.indexOf("?") + 1 || url.length)));
      window.scrollTo({ top: 0 });
    },
    [],
  );

  useEffect(() => {
    if (!group) return;
    listLectures(group.id)
      .then((ls) => setCourses([...new Set(ls.map((l) => l.course.trim()).filter(Boolean))]))
      .catch(() => undefined);
    members(group.id).then(setPeople).catch(() => undefined);
  }, [group, route.v]);

  const nameOf = useCallback((id: string) => people.find((p) => p.user_id === id)?.name ?? "", [people]);
  const ctx: Ctx | null = useMemo(
    () => (session && group ? { group, session, userId: session.user.id, go, say, nameOf } : null),
    [session, group, go, say, nameOf],
  );

  // Back with the personal code: the toast, once the member's group is in.
  useEffect(() => {
    if (!ctx || !welcome.current) return;
    welcome.current = false;
    say(`חזרה לקבוצה בתור ${ctx.group.me}.`);
  }, [ctx, say]);

  // The replaced route's URL and its one line saying why, once the shell is
  // there to show it (on Join the route waits: joining keeps where it pointed).
  useEffect(() => {
    if (!joinCode || !groupsLoaded || !group) return;
    const u = new URL(location.href);
    u.searchParams.delete("join");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    setJoinCode("");
  }, [joinCode, groupsLoaded, group]);

  const joining = Boolean(joinCode) && !group;
  const inShell = configured && ctx !== null && !joining;
  useEffect(() => {
    if (!inShell || !gate.notice) return;
    history.replaceState(history.state, "", routeUrl(gate.route));
    setRoute(gate.route);
    say(gate.notice);
  }, [gate, inShell, say]);

  if (!configured) {
    return (
      <main className="join">
        <div className="join-card">
          <h1 className="join-name">תמצית</h1>
          <p className="a-muted">האפליקציה עוד לא מחוברת למסד הנתונים (חסרים משתני הסביבה של Supabase).</p>
        </div>
      </main>
    );
  }

  if (restoring) return <Loading text="נכנסים עם הקוד האישי…" />;
  if (offline)
    return (
      <ConnectionGate
        onRetry={() => {
          if (!session) return readSession();
          setGroupsLoaded(false);
          setOffline(false);
          loadGroups(session).catch(() => {
            setOffline(true);
            setGroupsLoaded(true);
          });
        }}
      />
    );
  if (session === undefined || (session && !groupsLoaded) || link) return <Loading />;

  if (!session || !group || joining || !ctx) {
    return (
      <>
        <Join
          initialCode={joinCode}
          signedIn={Boolean(session)}
          codePanel={codePanel}
          restore={restore}
          onJoined={(g) => {
            rememberGroup(g.id);
            // Join keeps the route: a quiz or marathon link opened before joining lands where it pointed.
            // The entry before this one is wherever the link was opened from, not the app.
            history.replaceState({ study: (history.state as { study?: boolean } | null)?.study }, "", routeUrl(route));
            void getSession().then((s) => {
              setSession(s);
              if (s) void loadGroups(s);
            });
            // The member's personal code, to keep (only once codes work: health's "codes").
            openAccount("new");
          }}
        />
        <AccountLayer session={session ?? null} restore={restore} />
      </>
    );
  }

  return (
    <>
      <Shell route={shown} ctx={ctx} toast={toast}>
        <Suspense fallback={<Loading />}>{renderRoute(shown, ctx, courses)}</Suspense>
      </Shell>
      <AccountLayer session={session} restore={restore} link={pendingLink} onLinkDone={() => setPendingLink(null)} />
    </>
  );
}

function renderRoute(route: Route, ctx: Ctx, courses: string[]) {
  switch (route.v) {
    case "today":
      return <TodayScreen route={route} ctx={ctx} />;
    case "upload":
      return <UploadScreen key={route.many ? "many" : "one"} group={ctx.group} courses={courses} ctx={ctx} route={route} />;
    case "lecture":
      return <LectureView key={route.l} route={route} ctx={ctx} />;
    case "help":
      return (
        <HelpScreen
          back={<BackLink go={ctx.go} fallback={{ v: "me" }} />}
          footer={<HelpFooter ctx={ctx} />}
          howto={flags.guide ? (query, onQuery, rows) => <GuideHowTo ctx={ctx} query={query} onQuery={onQuery} rows={rows} /> : undefined}
        />
      );
    case "group":
      return <GroupScreen route={route} ctx={ctx} />;
    case "me":
      return <MeScreen route={route} ctx={ctx} />;
    case "practice":
      return <PracticeScreen route={route} ctx={ctx} />;
    case "exams":
      return <ExamsScreen route={route} ctx={ctx} />;
    case "mock":
      return <MockScreen route={route} ctx={ctx} />;
    case "quiz":
      return <QuizScreen route={route} ctx={ctx} />;
    case "cards":
      return <CardsScreen route={route} ctx={ctx} />;
    case "ask":
      return <AskScreen route={route} ctx={ctx} />;
    case "progress":
      return <ProgressScreen route={route} ctx={ctx} />;
    case "plan":
      return <PlanScreen route={route} ctx={ctx} />;
    case "marathon":
      return <MarathonScreen route={route} ctx={ctx} />;
    case "meeting":
      return <MeetingScreen route={route} ctx={ctx} />;
    case "catchup":
      return <CatchupScreen route={route} ctx={ctx} />;
    case "log":
      return <LogScreen route={route} ctx={ctx} />;
    case "dispute":
      return <DisputeScreen route={route} ctx={ctx} />;
    case "pulse":
      return <PulseScreen route={route} ctx={ctx} />;
    case "museum":
      return <MuseumScreen route={route} ctx={ctx} />;
    case "wall":
      return <WallScreen route={route} ctx={ctx} />;
    case "boss":
      return <BossScreen route={route} ctx={ctx} />;
    case "eve":
      return <EveScreen route={route} ctx={ctx} />;
    case "trap":
      return <TrapScreen route={route} ctx={ctx} />;
    case "try":
      return <TryScreen route={route} ctx={ctx} />;
    case "course":
      return <CourseScreen route={route} ctx={ctx} />;
    case "install":
      return <InstallScreen route={route} ctx={ctx} />;
    case "notify":
      return <NotifyRoute route={route} ctx={ctx} />;
    case "sets":
      return <SetsRoute route={route} ctx={ctx} />;
    case "library":
      return <Library ctx={ctx} />;
    default:
      return <Library ctx={ctx} />;
  }
}
