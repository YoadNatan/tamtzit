import { lazy, useEffect, useState } from "react";
import { mistakesLine, progressLine, type ProgressCounts } from "../../../shared/study/progress";
import { RouteLink } from "../components/Shell";
import { flags } from "../lib/flags";
import type { Route } from "../lib/route";
import type { Ctx, LectureCtx, LectureExt } from "./types";

/* ── Package A's progress slot (spec §5.3; §12.2.3): progress, marathons ──
 * Package A (A2) owns this file. The plan moved to G's features/plan.tsx: A2
 * builds no private plan (review F-7). A keeps its screens in files it loads
 * lazily (review F-8): "ההתקדמות שלי" is components/Progress.tsx; the rows on
 * "שלי" read one count call (lib/progress.ts, itself loaded lazily).
 * Yoad's decision 1 (17 Nov 2026): everything here is the device's member's,
 * with no account. */

/** "ההתקדמות שלי" (?v=progress; progress-pulse.html s1). */
export const ProgressScreen = lazy(() => import("../components/Progress"));

/** The exam-eve view (?v=eve&l=; A2, phase 3). */
export const EveScreen = lazy(() => import("../components/EveScreen"));

/** Marathons (?v=marathon: the list, m one marathon, new / edit; section P's).
 *  Wave 5's package G built them with the group's plan, whose days they are. */
export const MarathonScreen = lazy(() => import("../components/Marathon"));

/** The marathons card on "יחד": the next marathon, or a new one. With the
 *  group's plan on, G's PlanCard takes its place (its days are marathons). */
export function MarathonsCard({ ctx }: { ctx: Ctx }) {
  const on = flags.marathons && !flags.groupPlan;
  const [next, setNext] = useState<{ id: string; title: string; line: string; inN: number } | null | undefined>(undefined);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void import("../lib/marathons")
      .then(async (m) => {
        const x = (await m.upcoming(ctx.group.id))[0];
        if (!alive) return;
        if (!x) return setNext(null);
        const at = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(x.starts_at));
        setNext({ id: x.id, title: x.title, line: x.state === "live" ? "עכשיו" : at, inN: x.people.filter((p) => p.answer === "in").length });
      })
      .catch(() => alive && setNext(null));
    return () => {
      alive = false;
    };
  }, [ctx.group.id, on]);
  if (!on || next === undefined) return null;
  return (
    <section className="a-card flat pl-card" aria-label="מפגשי למידה">
      <div className="a-row between">
        <b dir="rtl">{next ? `מפגש למידה · ${next.title}` : "מפגשי למידה"}</b>
        <RouteLink to={next ? { v: "marathon", m: next.id } : { v: "marathon", isNew: true }} go={ctx.go} className="a-btn small">
          {next ? "למפגש הלמידה" : "מפגש למידה חדש"}
        </RouteLink>
      </div>
      <p className="a-small a-muted">{next ? `${next.line} · ${next.inN} בפנים` : "קובעים מפגש למידה, בוחרים הרצאות, ומסמנים מי בפנים."}</p>
    </section>
  );
}

/** The live banner's marathon line (lowest priority), or null. */
export function MarathonBannerLine(_p: { ctx: Ctx; route: Route }) {
  return null;
}

/** The counts behind "שלי"'s rows (study_my_progress_counts), or null while they load or fail. */
function useCounts(groupId: string, on: boolean): ProgressCounts | null {
  const [c, setC] = useState<ProgressCounts | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void import("../lib/progress")
      .then((lib) => lib.myProgressCounts(groupId))
      .then((x) => alive && setC(x))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId, on]);
  return c;
}

/** "ההתקדמות שלי" and "הטעויות שלי" on "שלי", each with its line and count
 *  (Q-2: what comes back today in another wording), or null without
 *  progress. Me.tsx leaves out F's own "הטעויות שלי" link while these show. */
export function MeRows({ ctx }: { ctx: Ctx }) {
  const c = useCounts(ctx.group.id, flags.progress);
  if (!flags.progress) return null;
  const again = c ? c.again_due : 0;
  return (
    <nav className="a-list links-card pr-me-rows" aria-label="ההתקדמות">
      <RouteLink to={{ v: "progress" }} go={ctx.go} className="a-li row-link pr-me-progress">
        <div>
          <b>ההתקדמות שלי</b>
          <span className="m">{c ? progressLine(c) : "רק לך"}</span>
        </div>
      </RouteLink>
      {flags.mistakes ? (
        <RouteLink to={{ v: "practice", s: "m" }} go={ctx.go} className="a-li row-link pr-me-mistakes">
          <div>
            <b>הטעויות שלי</b>
            <span className="m">{c ? mistakesLine(c) : "רק לך"}</span>
          </div>
          {c?.mistakes ? <span className="a-chip">{c.mistakes}</span> : null}
        </RouteLink>
      ) : null}
      {flags.mistakes && again ? (
        <RouteLink to={{ v: "practice", s: `r.${ctx.group.id}` }} go={ctx.go} className="a-li row-link pr-me-again">
          <div>
            <b>חוזרות היום בניסוח אחר</b>
            <span className="m">מטעויות ׳על בטוח׳ ומטעויות של ימים קודמים</span>
          </div>
          <span className="a-chip busy">{again}</span>
        </RouteLink>
      ) : null}
    </nav>
  );
}

/** A2's additions to the lecture ("להמשיך מהמקום שבו עצרת"). */
export function useLectureA(_lc: LectureCtx): LectureExt {
  return {};
}
