import { lazy, useEffect, useState } from "react";
import { RouteLink } from "../components/Shell";
import { flags } from "../lib/flags";
import type { Ctx } from "./types";
import "../styles/plan.css";

/* ── Package G's slot (§12.2.3): the group's marathon plan ──
 * Package G owns this file. PlanScreen moved here from features/progress.tsx:
 * A2 builds no private plan (review F-7). Yoad's decision 3 (17 Nov 2026):
 * the plan opens at once, from the exam and its lectures, and grows more
 * exact as the group practises; nothing here waits for the end of the
 * semester. The cards below are small: each reads the plan through
 * lib/groupPlan.ts, loaded lazily, so the study entry carries none of it. */

/** The plan (?v=plan: the group's lane, lane=mine one's own, d one day, edit the setup). */
export const PlanScreen = lazy(() => import("../components/PlanScreen"));

type Brief = { title: string; exam_date: string; lecture_ids: string[]; next: string } | null;

/** The active plan in brief, or null (none, or the flag off). */
function usePlan(ctx: Ctx, on: boolean): Brief | undefined {
  const [p, setP] = useState<Brief | undefined>(undefined);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void import("../lib/planBrief")
      .then((m) => m.planBrief(ctx.group.id))
      .then((b) => alive && setP(b))
      .catch(() => alive && setP(null));
    return () => {
      alive = false;
    };
  }, [ctx.group.id, on]);
  return p;
}

/** "הבלוק הבא: …" on "יחד" (plan.html; §12.6.G's PlanCard), or the way to build one. */
export function PlanCard({ ctx }: { ctx: Ctx }) {
  const p = usePlan(ctx, flags.groupPlan);
  if (!flags.groupPlan || p === undefined) return null;
  if (!p)
    return (
      <section className="a-card flat pl-card" aria-label="תוכנית עד המבחן">
        <b>תוכנית עד המבחן</b>
        <p className="a-small a-muted">עוד אין תוכנית. מזינים את מבחן הבלוק פעם אחת, והתוכנית נבנית לבד.</p>
        <RouteLink to={{ v: "plan", edit: true }} go={ctx.go} className="a-btn small">
          לבנות תוכנית
        </RouteLink>
      </section>
    );
  return (
    <section className="a-card flat pl-card" aria-label="תוכנית עד המבחן">
      <div className="a-row between">
        <b dir="rtl">תוכנית · {p.title}</b>
        <RouteLink to={{ v: "plan" }} go={ctx.go} className="a-btn small">
          לתוכנית
        </RouteLink>
      </div>
      {p.next ? (
        <p className="a-small" dir="rtl">
          {p.next}
        </p>
      ) : null}
    </section>
  );
}

/** "המסלול שלך בתוכנית" on "שלי", or null without a plan. */
export function MyLaneRows({ ctx }: { ctx: Ctx }) {
  const p = usePlan(ctx, flags.groupPlan);
  if (!flags.groupPlan || !p) return null;
  return (
    <nav className="a-list links-card pl-me" aria-label="המסלול שלך">
      <RouteLink to={{ v: "plan", lane: "mine" }} go={ctx.go} className="a-li row-link">
        <div>
          <b>המסלול שלך בתוכנית</b>
          <span className="m">רק לך: מה שחוזר אליך היום, לצד המסלול של הקבוצה</span>
        </div>
      </RouteLink>
    </nav>
  );
}

/** The exam-eve view's way in on Today (T-2's exam-eve view; decision 3):
 *  from LANE.EVE_DAYS before the plan's exam, one link a lecture. */
export function EveCard({ ctx }: { ctx: Ctx }) {
  const on = flags.eve && flags.groupPlan;
  const [eve, setEve] = useState<{ when: string; lectures: Array<{ id: string; title: string }> } | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void import("../lib/planBrief")
      .then((m) => m.eveBrief(ctx.group.id))
      .then((e) => alive && setEve(e))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, on]);
  if (!on || !eve) return null;
  return (
    <section className="a-card flat pl-eve" aria-label="הלילה שלפני">
      <div className="a-row between">
        <b>הלילה שלפני</b>
        <span className="a-chip warn">{eve.when}</span>
      </div>
      <p className="a-small a-muted">השקף המסכם, האסוציאציות שלך והטעויות ׳על בטוח׳ שלך, הרצאה אחרי הרצאה.</p>
      <div className="a-wrap">
        {eve.lectures.map((l) => (
          <RouteLink key={l.id} to={{ v: "eve", l: l.id }} go={ctx.go} className="a-chip busy">
            <bdi>{l.title}</bdi>
          </RouteLink>
        ))}
      </div>
    </section>
  );
}
