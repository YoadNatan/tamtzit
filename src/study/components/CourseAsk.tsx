import { useEffect, useRef, useState } from "react";
import { asksLeft } from "../lib/collab";
import {
  askCourseStream,
  chosenLine,
  clearCourseThread,
  courseSources,
  coursesOf,
  courseThreadKey,
  loadCourseThread,
  saveCourseThread,
  type CourseAskLine,
  type CourseContext,
  type CourseTurn,
} from "../lib/courses";
import { failText } from "../lib/failText";
import type { Ctx, ScreenProps } from "../features/types";
import { Icon } from "./Icon";
import { BackLink, Head, RouteLink, StickyActions } from "./Shell";
import SummaryView, { isolateLatin } from "./SummaryView";
import "../styles/courses.css";

/* ── "לשאול על כל הקורס" (sources.md B6.9, phase 1) ──
 *
 * ?v=ask&c=<course id>: a question about every lecture of a course. The
 * server picks the paragraphs that answer it (at most 12, from at most 4
 * lectures, $0) and says so first: "נבחרו 12 מתוך 340 פסקאות · מ-4
 * הרצאות". The answer cites [הרצאה 7 · ש׳ 14], and each citation is a link
 * to its paragraph in that lecture ("מקורות"). One answer is one of the day's
 * questions, as a lecture's. The conversation stays on this phone (14 days). */

const INTRO = "שואלים על כל הקורס. לכל שאלה נבחרות הפסקאות הכי קרובות מהסיכומים של ההרצאות, והתשובה מפנה להרצאה ולשקף.";

function askError(code: string): string {
  if (!code || code === "Failed to fetch" || code === "network" || code === "TypeError") return "אין חיבור. השאלה לא נשלחה.";
  return failText(code, "ask");
}

type Live = { q: string; a: string; ctx: CourseContext | null };

const leftLine = (left: number | null) => (left !== null ? `נשארו היום ${left} שאלות · השאלות נשמרות רק במכשיר הזה` : "השאלות נשמרות רק במכשיר הזה");

export default function CourseAsk({ route, ctx }: ScreenProps<"ask">) {
  const courseId = route.c!;
  const key = courseThreadKey(courseId);
  const [name, setName] = useState("");
  const [turns, setTurns] = useState<CourseTurn[]>(() => loadCourseThread(key));
  const [text, setText] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState("");
  const [left, setLeft] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const liveRef = useRef("");

  useEffect(() => {
    let alive = true;
    coursesOf(ctx.group.id)
      .then((rows) => alive && setName(rows.find((r) => r.id === courseId)?.name ?? ""))
      .catch(() => undefined);
    asksLeft(ctx.group.id)
      .then((n) => alive && setLeft(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, courseId]);
  useEffect(() => () => abort.current?.abort(), []);

  const commit = (list: CourseTurn[]) => {
    setTurns(list);
    saveCourseThread(key, list);
  };

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || live) return;
    setError("");
    setText("");
    liveRef.current = "";
    setLive({ q: question, a: "", ctx: null });
    const ctl = new AbortController();
    abort.current = ctl;
    let u = "";
    let cut: CourseContext | null = null;
    let done: Extract<CourseAskLine, { t: "done" }> | null = null;
    try {
      await askCourseStream(
        {
          courseId,
          question,
          // Each turn with its lectures' numbers then, so the server renumbers
          // them if a lecture came in or was re-dated since (ask.ts courseHistory).
          history: turns
            .filter((t) => t.sig)
            .slice(-3)
            .map((t) => ({ u: t.u, a: t.a, sig: t.sig, ...(t.ctx?.lectures.length ? { lectures: t.ctx.lectures.map(({ n, id }) => ({ n, id })) } : {}) })),
        },
        (l) => {
          if (l.t === "context") {
            cut = { chosen: l.chosen, total: l.total, lectures: l.lectures, paragraphs: l.paragraphs };
            setLive((x) => (x ? { ...x, ctx: cut } : x));
          } else if (l.t === "turn") u = l.u;
          else if (l.t === "a") {
            liveRef.current += l.d;
            setLive((x) => (x ? { ...x, a: liveRef.current } : x));
          } else if (l.t === "done") done = l;
        },
        ctl.signal,
      );
      const d = done as Extract<CourseAskLine, { t: "done" }> | null;
      if (d) {
        if (typeof d.left === "number") setLeft(d.left);
        commit([...turns, { q: question, u, a: liveRef.current, sig: d.sig, at: new Date().toISOString(), stop: d.stop, ctx: cut, badCites: d.badCites ?? [] }]);
      }
    } catch (e) {
      const code = e instanceof Error ? (e.name === "AbortError" ? "aborted" : e.message) : "";
      if (code === "aborted" || code === "timeout") {
        if (liveRef.current) commit([...turns, { q: question, u, a: liveRef.current, sig: "", at: new Date().toISOString(), stop: "timeout", ctx: cut, badCites: [] }]);
      } else {
        setError(askError(code));
        // Not sent (offline, refused): the question goes back in the field, unless something was typed since.
        if (!liveRef.current) setText((now) => (now.trim() ? now : question));
      }
    } finally {
      abort.current = null;
      setLive(null);
    }
  };

  return (
    <main className="k-ask-screen course-ask">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "course", c: courseId }} label="→ לקורס" />} title="לשאול על כל הקורס" />
      {name ? (
        <p className="ph-sub">
          <bdi>{name}</bdi>
        </p>
      ) : null}
      <div className="a-stack k-ask">
        {!turns.length && !live ? <p className="a-para a-muted">{INTRO}</p> : null}
        {turns.map((t, i) => (
          <CourseAnswer key={`${t.at}-${i}`} ctx={ctx} turn={t} />
        ))}
        {live ? (
          <>
            <div className="a-stack">
              <div className="a-bubble me" dir="auto">
                {isolateLatin(live.q, "lq")}
              </div>
            </div>
            <div className="a-card k-answer" aria-busy="true">
              <AnswerHead />
              <p className="a-small a-muted ca-cut">{live.ctx ? cutLine(live.ctx) : "בוחרים פסקאות מהקורס…"}</p>
              {live.a ? <SummaryView markdown={keepCites(live.a)} compact /> : null}
              <p className="a-small a-muted">
                התשובה נכתבת…{" "}
                <button type="button" className="a-link" onClick={() => abort.current?.abort()}>
                  עצירה
                </button>
              </p>
            </div>
          </>
        ) : null}
        {error ? (
          <p className="a-error" role="alert">
            {error}
          </p>
        ) : null}
        {turns.length && !live ? (
          <div className="a-row">
            <button
              type="button"
              className="a-btn ghost small"
              onClick={() => {
                clearCourseThread(key);
                setTurns([]);
              }}
            >
              שיחה חדשה
            </button>
          </div>
        ) : null}
      </div>
      <p className="a-small a-muted k-left">{leftLine(left)}</p>
      <StickyActions>
        <form
          className="a-row k-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(text);
          }}
        >
          <input
            className="a-input"
            dir={text ? "auto" : "rtl"}
            maxLength={500}
            value={text}
            enterKeyHint="send"
            aria-label="השאלה"
            placeholder="לשאול על כל הקורס…"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="a-btn primary icon" disabled={!text.trim() || Boolean(live)} aria-label="לשאול">
            <Icon name="send" size={16} />
          </button>
        </form>
      </StickyActions>
    </main>
  );
}

const AnswerHead = () => (
  <div className="a-row between">
    <b className="a-small">תשובה מהקורס</b>
    <span className="a-small a-muted">רק מהסיכומים</span>
  </div>
);

/** A citation, [הרצאה 7 · ש׳ 14], never breaks across lines. */
const keepCites = (a: string) => a.replace(/\[הרצאה[^\]]{1,40}\]/g, (m) => m.replace(/ /g, "\u00a0"));

/** "נבחרו 12 מתוך 340 פסקאות · מ-4 הרצאות". */
function cutLine(c: CourseContext): string {
  const from = c.lectures.length === 1 ? "מהרצאה אחת" : `מ-${c.lectures.length} הרצאות`;
  return `${chosenLine(c)} · ${from}`;
}

/** One answered question: the bubble, the answer with its cut, and its sources as links. */
function CourseAnswer({ ctx, turn: t }: { ctx: Ctx; turn: CourseTurn }) {
  const sources = courseSources(t.a, t.ctx);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t.a);
      ctx.say("התשובה הועתקה.");
    } catch {
      /* no clipboard here */
    }
  };
  return (
    <>
      <div className="a-stack">
        <div className="a-bubble me" dir="auto">
          {isolateLatin(t.q, "q")}
        </div>
      </div>
      <div className="a-card k-answer">
        <AnswerHead />
        {t.ctx ? <p className="a-small a-muted ca-cut">{cutLine(t.ctx)}</p> : null}
        <SummaryView markdown={keepCites(t.a)} compact />
        {t.stop === "max_tokens" ? <p className="a-small a-muted">התשובה ארוכה מדי ונקטעה. אפשר לבקש אותה בקצרה.</p> : null}
        {t.stop === "timeout" ? <p className="a-small a-muted">התשובה נעצרה באמצע. אפשר לשאול שוב.</p> : null}
        {sources.length ? (
          <div className="ca-sources">
            <b>מקורות</b>
            <ul className="a-list">
              {sources.map((s) => (
                <li key={s.key}>
                  <RouteLink to={s.at ? { v: "lecture", l: s.lectureId, at: s.at } : { v: "lecture", l: s.lectureId, slide: s.slide }} go={ctx.go} className="a-li ca-src">
                    <div>
                      <b>{`הרצאה ${s.lecture} · ש׳ ${s.slide}`}</b>
                      <span className="m">
                        <bdi>{s.title}</bdi>
                      </span>
                    </div>
                    <Icon name="book" size={14} />
                  </RouteLink>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="a-wrap">
          <button type="button" className="a-btn ghost small" onClick={() => void copy()}>
            העתקה
          </button>
        </div>
      </div>
    </>
  );
}
