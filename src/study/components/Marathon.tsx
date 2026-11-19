import { useCallback, useEffect, useMemo, useState } from "react";
import { dateOfDay, dayOfDate, dayStart, studyDay } from "../../../shared/study/day";
import { dayName, marathonAgenda, minutesOfClock, shortDate, type LectureFact } from "../../../shared/study/lane";
import type { ScreenProps } from "../features/types";
import { getSections, listLectures } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { answerMarathon, isOver, oneMarathon, saveMarathon, stepMarathon, upcoming, type Answer, type Marathon } from "../lib/marathons";
import { isolateLatin } from "../lib/rich";
import LaneDay from "./LaneDay";
import { Avatar, BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";
import "../styles/plan.css";
import { pickerDir } from "../lib/bidi";

/* ── Marathons (?v=marathon; spec §6.4 A R1-R6, section P; the run-of-show
 *    as plan.html s1 lists a day) ──
 *
 * The list: the group's marathons that are not over, with who is in. One
 * marathon: its run-of-show (the time, the block, "עכשיו" on the step on
 * screen), "אני בפנים · אולי · לא הפעם", who is in by name (marathons and
 * who is in are the group's), and "להתחיל" / "הבלוק
 * הבא" while it is on (any member moves it; two taps at once move it once).
 * new / edit: a title, a day and an hour, how long, the lectures; the
 * run-of-show is built from them. A day of the group's plan (package G)
 * links back to the plan. Never "מאחרים", never red. */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");
const clockIn = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const dayIn = (iso: string) => dateOfDay(studyDay(Date.parse(iso)));
const ANSWERS: Array<[Answer, string]> = [
  ["in", "אני בפנים"],
  ["maybe", "אולי"],
  ["out", "לא הפעם"],
];

export default function MarathonScreen({ route, ctx }: ScreenProps<"marathon">) {
  if (route.isNew || route.edit) return <MarathonEdit ctx={ctx} id={route.edit ? route.m : undefined} />;
  if (route.m) return <OneMarathon ctx={ctx} id={route.m} />;
  return <MarathonList ctx={ctx} />;
}

function whenLine(m: Pick<Marathon, "starts_at" | "minutes">): string {
  const d = dayIn(m.starts_at);
  const today = dateOfDay(studyDay(Date.now()));
  const day = d === today ? "היום" : dayOfDate(d) - dayOfDate(today) === 1 ? "מחר" : `${dayName(d)} ${shortDate(d)}`;
  return `${day} · ${clockIn(m.starts_at)} · ${Math.round((m.minutes / 60) * 10) / 10} שעות`;
}

function MarathonList({ ctx }: { ctx: ScreenProps<"marathon">["ctx"] }) {
  const [rows, setRows] = useState<Marathon[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    upcoming(ctx.group.id)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(failText(codeOf(e), "marathon")));
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  return (
    <main className="plan">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title="מפגשי למידה" />
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : !rows ? (
        <Loading />
      ) : rows.length ? (
        <ul className="a-list">
          {rows.map((m) => (
            <li key={m.id}>
              <RouteLink to={{ v: "marathon", m: m.id }} go={ctx.go} className="a-li row-link">
                <div>
                  <b dir="rtl">{isolateLatin(m.title, `mt${m.id}`)}</b>
                  <span className="m">{whenLine(m)}</span>
                </div>
                <span className={`a-chip${m.state === "live" ? " busy" : ""}`}>{m.state === "live" ? "עכשיו" : `${m.people.filter((p) => p.answer === "in").length} בפנים`}</span>
              </RouteLink>
            </li>
          ))}
        </ul>
      ) : (
        <section className="a-card dashed empty pl-empty">
          <p className="a-para">עוד אין מפגש למידה. קובעים מועד, בוחרים הרצאות, ומסמנים מי בפנים.</p>
        </section>
      )}
      <div className="a-row pl-days">
        <RouteLink to={{ v: "marathon", isNew: true }} go={ctx.go} className="a-btn primary">
          מפגש למידה חדש
        </RouteLink>
        {flags.groupPlan ? (
          <RouteLink to={{ v: "plan" }} go={ctx.go} className="a-btn ghost">
            לתוכנית עד המבחן
          </RouteLink>
        ) : null}
      </div>
    </main>
  );
}

function OneMarathon({ ctx, id }: { ctx: ScreenProps<"marathon">["ctx"]; id: string }) {
  const [m, setM] = useState<Marathon | null | undefined>(undefined);
  const [facts, setFacts] = useState<Record<string, LectureFact>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    oneMarathon(id)
      .then(async (x) => {
        if (!alive) return;
        setM(x);
        if (!x) return;
        const lectures = await listLectures(ctx.group.id);
        const f: Record<string, LectureFact> = {};
        await Promise.all(
          lectures
            .filter((l) => x.lecture_ids.includes(l.id))
            .map(async (l) => {
              const parts = await getSections(l.id).catch(() => []);
              f[l.id] = { id: l.id, title: l.title, parts: parts.length || 1, slides: parts.map((p) => [Number(p.slide_from), Number(p.slide_to)] as [number, number]), readers: 0, readByMe: false };
            }),
        );
        if (alive) setFacts(f);
      })
      .catch((e) => alive && setError(failText(codeOf(e), "marathon")));
    return () => {
      alive = false;
    };
  }, [id, ctx.group.id, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  if (m === undefined && !error)
    return (
      <main className="plan">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "marathon" }} />} title="מפגש למידה" />
        <Loading />
      </main>
    );
  if (!m)
    return (
      <main className="plan">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "marathon" }} />} title="מפגש למידה" />
        <p className="a-error" role="alert">
          {error || failText("marathon not found", "marathon")}
        </p>
      </main>
    );
  const over = isOver(m);
  const mine = m.people.find((p) => p.user_id === ctx.userId)?.answer;
  const inNames = m.people.filter((p) => p.answer === "in");
  const today = dateOfDay(studyDay(Date.now()));
  const nowMin = minutesOfClock(clockIn(new Date().toISOString()));
  const act = async (f: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await f();
      reload();
    } catch (e) {
      setError(failText(codeOf(e), "marathon"));
    } finally {
      setBusy(false);
    }
  };
  const n = m.agenda.length;
  return (
    <main className="plan">
      <Head back={<BackLink go={ctx.go} fallback={m.plan_id && flags.groupPlan ? { v: "plan" } : { v: "marathon" }} />}>
        <h1 className="t">מפגש למידה · {isolateLatin(m.title, "mh")}</h1>
        {m.state === "live" ? <span className="a-chip busy">עכשיו</span> : null}
      </Head>
      <p className="ph-sub">
        <span>{whenLine(m)}</span>
        <span aria-hidden="true">·</span>
        <span>{over ? "הסתיים" : `${inNames.length} בפנים`}</span>
      </p>
      {n ? (
        <LaneDay blocks={m.agenda} start={clockIn(m.starts_at)} facts={facts} nowMin={!over && dayIn(m.starts_at) === today && m.state !== "live" ? nowMin : null} current={m.state === "live" ? m.step : undefined} label="סדר היום" />
      ) : (
        <p className="a-card flat a-muted">אין עדיין סדר יום.</p>
      )}
      {!over ? (
        <div className="a-seg" role="radiogroup" aria-label="מי בפנים">
          {ANSWERS.map(([a, label]) => (
            <button key={a} type="button" className="a-btn small" role="radio" aria-checked={mine === a} disabled={busy} onClick={() => void act(() => answerMarathon(m.id, a))}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {inNames.length ? (
        <div className="a-wrap" aria-label="בפנים">
          {inNames.map((p) => (
            <span key={p.user_id} className="a-row">
              <Avatar id={p.user_id} name={ctx.nameOf(p.user_id) || "?"} />
              <span className="a-small">{ctx.nameOf(p.user_id) || "ללא שם"}</span>
            </span>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="a-row pl-days">
        {m.plan_id && flags.groupPlan ? (
          <RouteLink to={{ v: "plan" }} go={ctx.go} className="a-btn ghost small">
            לתוכנית
          </RouteLink>
        ) : null}
        {!over && m.state !== "live" ? (
          <RouteLink to={{ v: "marathon", m: m.id, edit: true }} go={ctx.go} className="a-btn ghost small">
            עריכה
          </RouteLink>
        ) : null}
      </div>
      {!over && n ? (
        <StickyActions>
          <button
            type="button"
            className="a-btn primary wide"
            disabled={busy}
            onClick={() => void act(() => stepMarathon(m.id, m.step, m.step < 0 ? 0 : m.step + 1 >= n ? n : m.step + 1))}
          >
            {m.step < 0 ? "להתחיל" : m.step + 1 >= n ? "סיום" : "הבלוק הבא"}
          </button>
        </StickyActions>
      ) : null}
    </main>
  );
}

function MarathonEdit({ ctx, id }: { ctx: ScreenProps<"marathon">["ctx"]; id?: string }) {
  const today = dateOfDay(studyDay(Date.now()));
  const [have, setHave] = useState<Marathon | null>(null);
  const [lectures, setLectures] = useState<Array<{ id: string; title: string }> | null>(null);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(today);
  const [clock, setClock] = useState("18:00");
  const [hours, setHours] = useState(3);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ls = await listLectures(ctx.group.id);
      if (!alive) return;
      setLectures(ls.map((l) => ({ id: l.id, title: l.title })));
      if (id) {
        const m = await oneMarathon(id);
        if (!alive || !m) return;
        setHave(m);
        setTitle(m.title);
        setDay(dayIn(m.starts_at));
        setClock(clockIn(m.starts_at));
        setHours(Math.max(1, Math.round(m.minutes / 60)));
        setChosen(m.lecture_ids);
      }
    })().catch((e) => alive && setError(failText(codeOf(e), "marathon")));
    return () => {
      alive = false;
    };
  }, [ctx.group.id, id]);
  const ok = title.trim().length > 0 && chosen.length > 0 && chosen.length <= 20 && /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= today && /^\d{2}:\d{2}$/.test(clock);
  const order = useMemo(() => (lectures ? [...lectures].reverse() : []), [lectures]);
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError("");
    try {
      const parts = await Promise.all(chosen.map(async (l) => ({ id: l, parts: (await getSections(l).catch(() => [])).length || 1 })));
      const minutes = hours * 60;
      const starts = new Date(dayStart(dayOfDate(day)) + (minutesOfClock(clock) - 240) * 60_000).toISOString();
      const mid = await saveMarathon(ctx.group.id, { id: have?.id ?? null, version: have?.version ?? null, title: title.trim(), starts_at: starts, minutes, lecture_ids: chosen, agenda: marathonAgenda(parts, minutes) });
      ctx.say(have ? "מפגש הלמידה עודכן, עם השם שלך." : "מפגש הלמידה נקבע. כולם רואים אותו ב״יחד״.");
      ctx.go({ v: "marathon", m: mid || have?.id }, { replace: true });
    } catch (e) {
      setError(failText(codeOf(e), "marathon"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="plan pl-setup">
      <Head back={<BackLink go={ctx.go} fallback={id ? { v: "marathon", m: id } : { v: "marathon" }} />} title={id ? "עריכת מפגש למידה" : "מפגש למידה חדש"} />
      {!lectures ? (
        <Loading />
      ) : (
        <section className="a-card flat a-stack">
          <label className="a-field">
            <span>שם</span>
            <input className="a-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} dir="auto" placeholder="ערב מלריה" />
          </label>
          <label className="a-field">
            <span>יום</span>
            <input className="a-input" type="date" dir={pickerDir()} value={day} min={today} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="a-field">
            <span>שעה</span>
            <input className="a-input" type="time" dir={pickerDir()} value={clock} onChange={(e) => setClock(e.target.value)} />
          </label>
          <div className="a-seg" role="radiogroup" aria-label="כמה זמן">
            {[2, 3, 4, 6].map((h) => (
              <button key={h} type="button" className="a-btn small" role="radio" aria-checked={hours === h} onClick={() => setHours(h)}>
                {h} שעות
              </button>
            ))}
          </div>
          <fieldset className="pl-lectures">
            <legend className="a-small">הרצאות</legend>
            {order.map((l) => (
              <label key={l.id} className="a-choice">
                <input type="checkbox" checked={chosen.includes(l.id)} onChange={() => setChosen((c) => (c.includes(l.id) ? c.filter((x) => x !== l.id) : [...c, l.id]))} />
                <span dir="rtl">{isolateLatin(l.title, `ml${l.id}`)}</span>
              </label>
            ))}
            {!order.length ? <p className="a-small a-muted">עוד אין הרצאות בספרייה.</p> : null}
          </fieldset>
          <p className="a-small a-muted">סדר היום נבנה מההרצאות: הקראה ומבחן קבוצתי על כל אחת, והפסקות ביניהן. כולם יכולים לערוך, ועל כל שינוי יש שם.</p>
        </section>
      )}
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      <StickyActions>
        <button type="button" className="a-btn primary wide" disabled={!ok || busy} onClick={() => void save()}>
          {id ? "לשמור" : "לקבוע מפגש למידה"}
        </button>
      </StickyActions>
    </main>
  );
}
