import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ExhibitCard, TopicLabel } from "../features/pulse";
import { QuizInline } from "../features/quiz";
import type { ScreenProps } from "../features/types";
import { flags } from "../lib/flags";
import { agendaOf, meetingQuiz, meetingWords, ritualsNow, slideRange, whenLine, clockOf, type Agenda, type BandMeeting } from "../lib/meeting";
import { isolateLatin } from "../lib/rich";
import { useBand } from "./MeetingBand";
import { Avatar, BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";
import "../styles/meeting.css";

/* ── The day's meeting (package M; meeting.html s1, spec §12.4.M, the meeting
 * design §4.3 items 5-7) ──
 *
 * Before the reading: the opening "שאלות פתיחה · מה קראנו בפעם הקודמת" (5 minutes,
 * three questions on what was read before, answered alone; any member opens
 * it and hosts, or "לדלג לסדר היום"), with M-2 the pre-guess on today's
 * first part, then the three-line agenda ("סדר היום": today's reading, and
 * who reads once someone tapped "להקריא לקבוצה" (no reader is planned ahead,
 * M 2); the pulse's hot spot when section U exists; the newest open
 * question), then "להתחיל להקריא" or "לעקוב אחרי ההקראה". After the reading
 * started: "מבחן קבוצתי על מה שנקרא · 5 שאלות" (the closing). At most two
 * rituals a study day (decision 7): one opening, one closing. ?v=meeting&new=1
 * and &edit=1 open planning over it. */

const Plan = lazy(() => import("./MeetingSheet"));
const Guesses = lazy(() => import("./GuessCards"));

const SKIP = "study-meeting-skip:";
const skippedOf = (id: string) => {
  try {
    return sessionStorage.getItem(SKIP + id) === "1";
  } catch {
    return false;
  }
};

export default function MeetingScreen({ route, ctx }: ScreenProps<"meeting">) {
  const { rows, error, reload } = useBand(ctx.group.id);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [coffeeAt, setCoffeeAt] = useState<{ idx: number; total: number } | null>(null);
  const planning = Boolean(route.isNew || route.edit);

  const m: BandMeeting | null = rows ? (rows.find((x) => x.id === route.m) ?? (route.m ? null : (rows.find((x) => x.today) ?? rows[0] ?? null))) : null;
  const id = m?.id ?? null;
  useEffect(() => {
    if (!id) return;
    setSkipped(skippedOf(id));
    let alive = true;
    agendaOf(id)
      .then((a) => alive && setAgenda(a))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, m?.version, m?.reading]);

  const closePlan = useCallback(() => ctx.go(id ? { v: "meeting", m: id } : { v: "meeting" }, { replace: true }), [ctx, id]);
  // The sheet closes itself (Back); the screen then shows today's meeting, or the next.
  const saved = () => reload();

  if (rows === null) return error ? <main className="m-screen"><Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title="הפגישה" /><p className="a-error" role="alert">הפגישה לא נטענה. כדאי לבדוק את החיבור ולנסות שוב.</p></main> : <Loading />;

  const plan = planning ? (
    <Suspense fallback={null}>
      <Plan ctx={ctx} meeting={route.edit ? m : null} lastStartsAt={rows.length ? rows[rows.length - 1].starts_at : null} onClose={closePlan} onSaved={saved} />
    </Suspense>
  ) : null;

  if (!m) {
    return (
      <main className="m-screen">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title="הפגישה" />
        <p className="a-card dashed empty">אין פגישה מתוכננת.</p>
        <StickyActions>
          <RouteLink to={{ v: "meeting", isNew: true }} go={ctx.go} className="a-btn primary wide">
            לקבוע את הפגישה הבאה
          </RouteLink>
        </StickyActions>
        {plan}
      </main>
    );
  }

  const rituals = ritualsNow(m, skipped);
  const coffeeLive = rituals.coffee === "live" && m.coffee;
  const reader = m.reader_id;
  const readerName = reader ? ctx.nameOf(reader) || "ללא שם" : "";
  const slides = slideRange(m.slide_from, m.slide_to);
  const othersRead = m.reading && m.reader_id !== ctx.userId;

  const open = async (preset: "coffee" | "end") => {
    setBusy(true);
    setSaid("");
    try {
      const q = await meetingQuiz(m.id, preset);
      reload();
      if (preset === "end") ctx.go({ v: "quiz", q });
    } catch (e) {
      setSaid(meetingWords(e));
      reload();
    } finally {
      setBusy(false);
    }
  };
  const skip = () => {
    try {
      sessionStorage.setItem(SKIP + m.id, "1");
    } catch {
      /* private mode: the skip lasts while the page is open */
    }
    setSkipped(true);
  };

  const showOpening = m.today && !m.over && (rituals.coffee === "offer" || rituals.coffee === "live");
  const title = showOpening ? "שאלות פתיחה · מה קראנו בפעם הקודמת" : m.today ? "הפגישה של היום" : "הפגישה הבאה";
  const sub = showOpening ? (
    <p className="ph-sub">
      <span>5 דק׳ · עונים לבד, בלי לפתוח את הסיכום</span>
      <span aria-hidden="true">·</span>
      <span>אפשר לדלג</span>
    </p>
  ) : (
    <p className="ph-sub">
      <span>{m.today ? `היום · ${clockOf(m.starts_at)}` : whenLine(m)}</span>
      {slides ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{slides}</span>
        </>
      ) : null}
    </p>
  );

  // The one primary action, in the bottom bar.
  let primary = null;
  if (m.over) primary = null;
  else if (rituals.coffee === "offer" && m.today)
    primary = (
      <button type="button" className="a-btn primary wide" disabled={busy} onClick={() => void open("coffee")}>
        לפתוח את שאלות הפתיחה
      </button>
    );
  else if (rituals.closing === "offer")
    primary = (
      <button type="button" className="a-btn primary wide" disabled={busy} onClick={() => void open("end")}>
        מבחן קבוצתי על מה שנקרא · 5 שאלות
      </button>
    );
  else if (rituals.closing === "live" && m.closing)
    primary = (
      <RouteLink to={{ v: "quiz", q: m.closing.id }} go={ctx.go} className="a-btn primary wide">
        למבחן הקבוצתי על מה שנקרא
      </RouteLink>
    );
  else if (!coffeeLive && m.today && othersRead)
    primary = (
      <RouteLink to={{ v: "lecture", l: m.lecture_id, follow: true }} go={ctx.go} className="a-btn primary wide">
        לעקוב אחרי ההקראה
      </RouteLink>
    );
  else if (!coffeeLive && m.today)
    primary = (
      <RouteLink to={{ v: "lecture", l: m.lecture_id, at: { part: m.part_from, anchor: 0 }, read: true }} go={ctx.go} className="a-btn primary wide">
        להתחיל להקריא
      </RouteLink>
    );

  const a = agenda;
  return (
    <main className="m-screen">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title={title}>
        {coffeeLive && coffeeAt ? <span className="a-chip busy">{`${Math.min(coffeeAt.idx + 1, coffeeAt.total)}/${coffeeAt.total}`}</span> : null}
      </Head>
      {sub}

      {showOpening && rituals.coffee === "offer" ? (
        <div className="a-card flat m-opening">
          <p className="a-small">שלוש שאלות על מה שקראו בפגישות הקודמות. כל אחד ואחת עונים לבד, עם הימור; בחשיפה רואים רק אם רוב הקבוצה צדקה.</p>
          <button type="button" className="a-btn ghost small m-skip" onClick={skip}>
            לדלג לסדר היום
          </button>
        </div>
      ) : null}
      {coffeeLive && m.coffee ? (
        <>
          <QuizInline ctx={ctx} quizId={m.coffee.id} layout="stack" onState={(s) => setCoffeeAt({ idx: s.idx, total: s.total })} />
          <button type="button" className="a-btn ghost small m-skip" onClick={skip}>
            לדלג לסדר היום
          </button>
        </>
      ) : null}
      {said ? (
        <p className="a-error" role="alert">
          {said}
        </p>
      ) : null}

      {/* U-3 (MU4): the meeting opens with one exhibit of its lecture, 30 seconds, then the reading */}
      {m.today && !m.over ? <ExhibitCard ctx={ctx} lectureId={m.lecture_id} /> : null}

      {flags.guess && m.today && !m.over ? (
        <Suspense fallback={null}>
          <Guesses meetingId={m.id} released={m.guess_released} canPick={!m.over} />
        </Suspense>
      ) : null}

      <div className="a-sec">
        <h2>סדר היום</h2>
      </div>
      <ul className="a-list m-agenda">
        <li className="a-li">
          <div>
            <b dir="rtl">
              {m.today ? "היום: " : `${whenLine(m)}: `}
              {isolateLatin(m.title ? `${m.lecture_title}: ${m.title}` : m.lecture_title, "ag1")} {slides ? <span className="a-tag">{slides}</span> : null}
            </b>
            {reader ? <span className="m">{`הקראה: ${readerName}`}</span> : null}
          </div>
          {reader ? <Avatar id={reader} name={readerName} /> : null}
        </li>
        {a?.hot_spot ? (
          <li className="a-li">
            <div>
              <b dir="rtl">
                נושא קשה: <TopicLabel topic={a.hot_spot.title} aspect={a.hot_spot.aspect ?? "other"} />
                {a.hot_spot.slides?.[0] ? (
                  <>
                    {" "}
                    <span className="a-tag">ש׳ {a.hot_spot.slides[0]}</span>
                  </>
                ) : null}
              </b>
            </div>
          </li>
        ) : null}
        {a?.open_question ? (
          <li>
            <RouteLink
              to={{ v: "lecture", l: a.open_question.lecture_id, at: { part: a.open_question.part, anchor: a.open_question.anchor } }}
              go={ctx.go}
              className="a-li m-open-q"
            >
              <div>
                <b dir="rtl">שאלה פתוחה: {isolateLatin(a.open_question.body, "ag3")}</b>
                <span className="m" dir="rtl">
                  {a.open_question.from_meeting ? "מהפגישה הקודמת · " : ""}
                  <bdi>{a.open_question.lecture_title}</bdi>
                </span>
              </div>
            </RouteLink>
          </li>
        ) : null}
      </ul>

      {m.over ? <p className="a-card flat a-muted">הפגישה של היום הסתיימה.</p> : null}
      {rituals.closing === "done" ? <p className="a-small a-muted">המבחן הקבוצתי של היום הסתיים. לכל היותר שני מבחנים קצרים ביום: שאלות הפתיחה ומבחן בסוף.</p> : null}

      <div className="a-row m-links">
        {!m.started_at ? (
          <RouteLink to={{ v: "meeting", m: m.id, edit: true }} go={ctx.go} className="a-link">
            לשנות את התכנון
          </RouteLink>
        ) : null}
        <RouteLink to={{ v: "meeting", m: m.id, isNew: true }} go={ctx.go} className="a-link">
          לקבוע את הפגישה הבאה
        </RouteLink>
      </div>

      <StickyActions>{primary}</StickyActions>
      {plan}
    </main>
  );
}
