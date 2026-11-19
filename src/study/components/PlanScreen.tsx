import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dateOfDay, dayOfDate } from "../../../shared/study/day";
import {
  allRead,
  buildLane,
  dayEnd,
  eveOpen,
  kmOn,
  missedOf,
  pendingSlip,
  phaseOn,
  planMeter,
  shortDate,
  type GroupPlan,
  type LaneDay as Day,
  type LectureFact,
  type MeterRow,
  type MyRow,
} from "../../../shared/study/lane";
import type { ScreenProps } from "../features/types";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { activePlan, lectureFacts, planDayRows, planMeterRows, saveLaneDays, todayIso, type PlanDayRow } from "../lib/groupPlan";
import { myLaneRows } from "../lib/laneMine";
import { isolateLatin } from "../lib/rich";
import type { Route } from "../lib/route";
import { Icon } from "./Icon";
import LaneDay from "./LaneDay";
import PlanSetup, { SlipCard } from "./PlanSetup";
import { Avatar, BackLink, Head, Loading, RouteLink } from "./Shell";
import "../styles/plan.css";

/* ── The group's marathon plan (?v=plan; package G; plan.html s1, spec
 *    §12.6.G; Yoad's decision 3 of 17 Nov 2026) ──
 *
 * One day of the plan: the head "מפגש למידה · {title}" with "יום {d}/{n}", the
 * phase and the exam under it; the way to the exam ("אמצע הדרך ✓ כל
 * הסיכומים נקראו" · "בסוף: המבחן") with decision 3's line "התוכנית מדייקת ככל
 * שמתרגלים: N מתוך M הרצאות עם נתונים" and how far the next lecture is;
 * "המסלול הקבוצתי" with the last change's name and the day's blocks ("בעוד
 * 20 דק׳", "הוזז מאתמול"); "המסלול שלך" with "רק לך". A day that slipped
 * shows its two prices (SlipCard). lane=mine is the private lane alone
 * (from "שלי"); edit is the setup (PlanSetup, plan.html s2). Without a plan:
 * "עוד אין תוכנית…" and "לבנות תוכנית", never a dead end.
 *
 * The plan opens at once, from the exam and the lectures: the group lane is
 * computed on the phone (shared/study/lane.ts) and the next 7 days are saved
 * as marathons of the plan (PL2), which any member may edit; a saved day is
 * shown as the group left it. */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");
const israelClock = (now = Date.now()): number => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now)).split(":").map(Number);
  return h * 60 + m;
};

type Data = {
  plan: GroupPlan | null;
  facts: Record<string, LectureFact>;
  members: number;
  meter: MeterRow[];
  saved: PlanDayRow[];
  lectures: Array<{ id: string; title: string }>;
};

/** The plan's data, read once a screen opens it (and again after a change). */
function usePlanData(groupId: string, userId: string): { data: Data | null; error: string; reload: () => void } {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    (async () => {
      const plan = await activePlan(groupId);
      const facts = await lectureFacts(groupId, userId, plan?.lecture_ids ?? []);
      if (!plan) return { plan: null, facts: {}, members: facts.members, meter: [], saved: [], lectures: facts.all };
      const [meter, saved] = await Promise.all([planMeterRows(plan.id).catch(() => [] as MeterRow[]), planDayRows(plan.id)]);
      return { plan, facts: facts.facts, members: facts.members, meter, saved, lectures: facts.all };
    })()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(failText(codeOf(e), "plan")));
    const again = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    document.addEventListener("visibilitychange", again);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", again);
    };
  }, [groupId, userId, tick]);
  return { data, error, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export default function PlanScreen({ route, ctx }: ScreenProps<"plan">) {
  const { data, error, reload } = usePlanData(ctx.group.id, ctx.userId);
  const plan = data?.plan ?? null;
  const today = todayIso();
  const nowMin = israelClock();

  // The group lane, on the phone; a saved day (a marathon of the plan) as the group left it.
  const lane = useMemo<Day[]>(() => {
    if (!data?.plan) return [];
    const draft = buildLane(data.plan, data.facts, data.meter, []);
    const t = draft.find((d) => d.day === today);
    const cut = t && nowMin > dayEnd(t.blocks, data.plan.day_start) ? dateOfDay(dayOfDate(today) + 1) : today;
    return buildLane(data.plan, data.facts, data.meter, missedOf(data.saved, cut));
  }, [data, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const missed = useMemo(() => {
    if (!data?.plan) return null;
    const t = lane.find((d) => d.day === today);
    const cut = t && nowMin > dayEnd(t.blocks, data.plan.day_start) ? dateOfDay(dayOfDate(today) + 1) : today;
    return pendingSlip(data.plan, missedOf(data.saved, cut));
  }, [data, lane, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // PL2: the next 7 days are saved as marathons of the plan, once a screen sees one missing.
  const saving = useRef(false);
  useEffect(() => {
    if (!data?.plan || saving.current) return;
    const p = data.plan;
    const have = new Set(data.saved.map((s) => s.plan_day));
    const last = dateOfDay(dayOfDate(today) + 6);
    if (!lane.some((d) => d.day >= today && d.day <= last && d.blocks.length && !have.has(d.day))) return;
    saving.current = true;
    void saveLaneDays(p, lane, data.saved, (l) => data.facts[l]?.title ?? "")
      .then((n) => n > 0 && reload())
      .catch(() => undefined);
  }, [data, lane, today, reload]);

  if (route.edit)
    return data ? (
      <PlanSetup ctx={ctx} plan={plan} lectures={data.lectures} facts={data.facts} missed={missed} onSaved={reload} />
    ) : error ? (
      <main className="plan">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "plan" }} />} title="תוכנית עד המבחן" />
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    ) : (
      <main className="plan">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "plan" }} />} title="תוכנית עד המבחן" />
        <Loading />
      </main>
    );

  if (error && !data)
    return (
      <main className="plan">
        <Head title="תוכנית עד המבחן" />
        <p className="a-error" role="alert">
          {error}
        </p>
        <button type="button" className="a-btn" onClick={reload}>
          לנסות שוב
        </button>
      </main>
    );
  if (!data)
    return (
      <main className="plan">
        <Head title="תוכנית עד המבחן" />
        <Loading />
      </main>
    );

  if (!plan || phaseOn(plan, today) === "after")
    return (
      <main className="plan">
        <Head title="תוכנית עד המבחן" />
        <section className="a-card dashed empty pl-empty">
          <Icon name="cal" size={22} />
          <p className="a-para">{plan ? "המבחן של התוכנית הזו עבר. אפשר לבנות תוכנית למבחן הבא." : "עוד אין תוכנית. מזינים את מבחן הבלוק פעם אחת, והתוכנית נבנית לבד."}</p>
          <RouteLink to={{ v: "plan", edit: true }} go={ctx.go} className="a-btn primary">
            לבנות תוכנית
          </RouteLink>
        </section>
        <p className="a-small a-muted">כולם יכולים לערוך, ועל כל שינוי יש שם.</p>
      </main>
    );

  const first = lane[0]?.day ?? plan.shared_from;
  const lastDay = lane[lane.length - 1]?.day ?? plan.exam_date;
  const want = route.d ?? (today < first ? first : today > lastDay ? lastDay : today);
  const day = lane.find((d) => d.day === want) ?? lane[0];
  const saved = day ? data.saved.find((s) => s.plan_day === day.day) : undefined;
  const blocks = saved && saved.agenda.length ? saved.agenda : day?.blocks ?? [];
  const startClock = saved ? clockIn(saved.starts_at) : plan.day_start;
  const phase = phaseOn(plan, day?.day ?? today);
  const km = kmOn(plan, day?.day ?? today);
  const meter = planMeter(data.meter);
  const lecFacts = plan.lecture_ids.map((l) => data.facts[l]).filter(Boolean);
  const read = allRead(lecFacts, data.members);
  const changedBy = saved && saved.updated_at > plan.updated_at ? saved.updated_by : plan.updated_by;
  const changedName = changedBy ? ctx.nameOf(changedBy) : "";
  const idx = day ? lane.indexOf(day) : -1;
  const prev = idx > 0 ? lane[idx - 1] : null;
  const next = idx >= 0 && idx < lane.length - 1 ? lane[idx + 1] : null;
  const dayRoute = (d: Day): Route => ({ v: "plan", d: d.day, ...(route.lane === "mine" ? { lane: "mine" as const } : {}) });

  const head = (
    <>
      <Head back={route.lane === "mine" ? <BackLink go={ctx.go} fallback={{ v: "me" }} /> : undefined}>
        <h1 className="t">
          {route.lane === "mine" ? "המסלול שלך" : <>תוכנית · {isolateLatin(plan.title, "pt")}</>}
        </h1>
        {day ? <span className="a-chip">{`יום ${day.n}/${day.total}`}</span> : null}
      </Head>
      <p className="ph-sub">
        <span>{phase === "before" ? `מתחיל ב-${shortDate(first)}` : phase === "leave" ? "חופש למידה" : "סבב משותף"}</span>
        <span aria-hidden="true">·</span>
        <span>{`המבחן ב-${shortDate(plan.exam_date)}`}</span>
        {route.lane === "mine" ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="a-chip">רק לך</span>
          </>
        ) : null}
      </p>
    </>
  );

  const dayNav = (
    <nav className="a-row between pl-days" aria-label="ימי התוכנית">
      {prev ? (
        <RouteLink to={dayRoute(prev)} go={ctx.go} className="a-btn ghost small" label={`יום ${prev.n}`}>
          → יום {prev.n}
        </RouteLink>
      ) : (
        <span />
      )}
      {day && day.day !== today && today >= first && today <= lastDay ? (
        <RouteLink to={{ v: "plan", ...(route.lane === "mine" ? { lane: "mine" as const } : {}) }} go={ctx.go} className="a-btn ghost small">
          להיום
        </RouteLink>
      ) : null}
      {next ? (
        <RouteLink to={dayRoute(next)} go={ctx.go} className="a-btn ghost small" label={`יום ${next.n}`}>
          יום {next.n} ←
        </RouteLink>
      ) : (
        <span />
      )}
    </nav>
  );

  const mine = day && day.day === today ? <MyLane ctx={ctx} plan={plan} data={data} groupEnd={dayEnd(blocks, startClock)} /> : <p className="a-small a-muted pl-mine-later">המסלול שלך נבנה בכל בוקר מחדש, ממה שחוזר אליך באותו יום.</p>;

  if (route.lane === "mine")
    return (
      <main className="plan">
        {head}
        {mine}
        {dayNav}
      </main>
    );

  return (
    <main className="plan">
      {head}
      <div className="a-meter pl-km">
        <div className="a-row between">
          <span className="a-small">
            <b>{read ? "אמצע הדרך ✓" : "אמצע הדרך:"}</b> כל הסיכומים נקראו
          </span>
          <span className="a-small a-muted">בסוף: המבחן</span>
        </div>
        <div className="a-bar group" role="img" aria-label={`${Math.round((km / 42) * 100)}% מהדרך למבחן`}>
          <i style={{ width: `${Math.round((km / 42) * 100)}%` }} />
        </div>
        <p className="a-small pl-meter-line">{meter.head}</p>
        {meter.next ? <p className="a-small a-muted pl-meter-next">{meter.next}</p> : null}
      </div>
      {missed ? <SlipCard ctx={ctx} plan={plan} missed={missed} facts={data.facts} onPriced={reload} /> : null}

      <div className="a-sec">
        <h2 className="a-h2">המסלול הקבוצתי</h2>
        {changedBy ? (
          <span className="a-row">
            <Avatar id={changedBy} name={changedName || "?"} />
            <span className="a-small a-muted">שינוי אחרון: {changedName || "ללא שם"}</span>
          </span>
        ) : null}
      </div>
      {blocks.length ? (
        <LaneDay
          blocks={blocks}
          start={startClock}
          facts={data.facts}
          nowMin={day?.day === today ? nowMin : null}
          current={saved && saved.state === "live" ? saved.step : undefined}
          label="המסלול הקבוצתי"
          movedLabel={day?.movedFrom && dayOfDate(day.day) - dayOfDate(day.movedFrom) === 1 ? "הוזז מאתמול" : "הוזז"}
        />
      ) : (
        <p className="a-card flat a-muted">{day?.dropped ? "על יום החזרה הזה ויתרנו. נשארו השחזורים." : "אין בלוקים ביום הזה."}</p>
      )}
      {saved ? (
        <RouteLink to={{ v: "marathon", m: saved.id }} go={ctx.go} className="a-btn ghost small pl-open-day">
          למפגש הלמידה של היום הזה
        </RouteLink>
      ) : null}

      <div className="a-sec">
        <h2 className="a-h2">המסלול שלך</h2>
        <span className="a-chip">רק לך</span>
      </div>
      {mine}
      {dayNav}
      {flags.eve && eveOpen(plan, today) ? (
        <section className="a-card flat pl-eve" aria-label="הלילה שלפני">
          <b>הלילה שלפני</b>
          <div className="a-wrap">
            {plan.lecture_ids
              .filter((l) => data.facts[l])
              .map((l) => (
                <RouteLink key={l} to={{ v: "eve", l }} go={ctx.go} className="a-chip busy">
                  <bdi>{data.facts[l].title}</bdi>
                </RouteLink>
              ))}
          </div>
        </section>
      ) : null}
      <RouteLink to={{ v: "plan", edit: true }} go={ctx.go} className="a-btn ghost pl-edit">
        <Icon name="pen" size={14} />
        לערוך את התוכנית
      </RouteLink>
    </main>
  );
}

/** "HH:MM" of an instant, Israel time. */
function clockIn(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** "המסלול שלך" (PL3): the member's own rows, from the group's day's end on. */
function MyLane({ ctx, plan, data, groupEnd }: { ctx: ScreenProps<"plan">["ctx"]; plan: GroupPlan; data: Data; groupEnd: number }) {
  const [rows, setRows] = useState<MyRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    myLaneRows(ctx.group.id, ctx.userId, plan, data.facts, data.meter, data.saved)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [ctx.group.id, ctx.userId, plan, data]);
  if (!rows) return <Loading />;
  if (!rows.length) return <p className="a-card flat a-muted pl-mine-empty">אין כרגע כלום במסלול שלך. כשמתרגלים, הוא מתמלא.</p>;
  let t = Math.ceil((groupEnd + 30) / 30) * 30;
  return (
    <ul className="a-list pl-day pl-mine" aria-label="המסלול שלך">
      {rows.map((r) => {
        const at = `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
        t += r.minutes;
        return (
          <li key={r.key} className="a-li pl-row">
            <b className="a-small pl-time">{at}</b>
            <RouteLink to={r.route as Route} go={ctx.go} className="pl-body pl-link">
              <b dir="rtl">{isolateLatin(r.title, `pm${r.key}`)}</b>
              <span className="m" dir="rtl">
                {r.slides?.length ? <span className="a-tag">{`ש׳ ${r.slides.slice(0, 2).join(",")}`}</span> : null}
                {r.slides?.length ? " " : ""}
                {r.line}
              </span>
            </RouteLink>
          </li>
        );
      })}
    </ul>
  );
}
