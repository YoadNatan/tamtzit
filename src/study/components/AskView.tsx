import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { tidy } from "../../../shared/study/blocks";
import { blockSources, citedSlides } from "../../../shared/study/edits";
import { getLecture, getSections, listLectures, type Lecture, type LectureRow, type Section } from "../lib/api";
import { answerSpots, askStream, askTheGroup, asksLeft, clearThread, loadThread, plainQuote, recordingReady, saveThread, shareAnswer, threadKey, type AskLine, type Turn } from "../lib/collab";
import { clip } from "../lib/clip";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import type { Ctx, LectureCtx, ScreenProps, Spot } from "../features/types";
import { Icon } from "./Icon";
import { BackLink, Head, Loading, Sheet, StickyActions } from "./Shell";
import SummaryView, { isolateLatin } from "./SummaryView";

/* ── "לשאול" (spec §4.8, §12.3.K; ask.html s1) ──
 *
 * Questions about a lecture, answered from its slides, the group's summary,
 * the recording's notes when there are some and the questions the group
 * already answered (without names); or about the whole library, routed first
 * to a lecture. Two ways in: the screen ?v=ask (a lecture, a paragraph of it,
 * or the library's ask bar), and AskSheet, "לשאול" on a paragraph, over the
 * reader: it changes no route, so a member who follows the reader keeps
 * following under it and after it (review UX-12).
 *
 * The conversation stays on this phone (localStorage, 14 days); the server
 * stores no question. Under an answer: "לפסקה", "לשתף עם הקבוצה" (the answer
 * on a paragraph, "שותפה ע״י …") and "עדיין לא ברור? לשאול את הקבוצה": the
 * question goes onto the paragraph with this answer attached as Claude's
 * attempt, through the op, which checks the answer's signature (K2, review
 * SEC-9). */

const INTRO = "שואלים בשפה חופשית ומקבלים תשובה מתוך השקפים והסיכום של ההרצאה, עם מספרי השקפים. כשההרצאה לא עוסקת במשהו, התשובה אומרת את זה.";
const NO_RECORDING = "מה נאמר בהרצאה? עוד אין הקלטה להרצאה הזו";
const TO_GROUP_NOTE = flags.meeting
  ? "השאלה עולה לפסקה, עם התשובה הזו. אם תישאר פתוחה 24 שעות, היא תעלה בפגישה."
  : "השאלה עולה לפסקה, עם התשובה הזו, וכל הקבוצה רואה אותה.";

/** A failure's words (B7): the op's codes, a dropped connection, the rest. */
function askError(code: string): string {
  if (!code || code === "Failed to fetch" || code === "network" || code === "TypeError") return "אין חיבור. השאלה לא נשלחה.";
  return failText(code, "ask");
}

type Scope = { lecture: Lecture | null; sections: Section[] };
type Live = { q: string; a: string; routed?: { id: string; title: string } };

/** The conversation and its state (screen and sheet share it). */
function useAsk(ctx: Ctx, lectureId: string | null, initialFocus: Spot | null, scopeLecture?: Lecture, scopeSections?: Section[]) {
  const key = threadKey(lectureId);
  const [turns, setTurns] = useState<Turn[]>(() => loadThread(key));
  const [focus, setFocus] = useState<Spot | null>(initialFocus);
  const [text, setText] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [pick, setPick] = useState<{ ok: boolean; lectures: Array<{ id: string; title: string }> } | null>(null);
  const [also, setAlso] = useState<Array<{ id: string; title: string }>>([]);
  const [error, setError] = useState("");
  const [left, setLeft] = useState<number | null>(null);
  const [course, setCourse] = useState<string | null>(null);
  const [courses, setCourses] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>({ lecture: scopeLecture ?? null, sections: scopeSections ?? [] });
  const [recording, setRecording] = useState<boolean | null>(null);
  const abort = useRef<AbortController | null>(null);
  const liveRef = useRef("");

  useEffect(() => setFocus(initialFocus), [initialFocus]);
  useEffect(() => {
    if (scopeLecture) setScope({ lecture: scopeLecture, sections: scopeSections ?? [] });
  }, [scopeLecture, scopeSections]);
  useEffect(() => {
    if (!lectureId || scopeLecture) return;
    let alive = true;
    Promise.all([getLecture(lectureId), getSections(lectureId)])
      .then(([l, s]) => alive && setScope({ lecture: l, sections: s }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lectureId, scopeLecture]);
  useEffect(() => {
    if (lectureId) return;
    let alive = true;
    listLectures(ctx.group.id)
      .then((ls: LectureRow[]) => alive && setCourses([...new Set(ls.map((l) => (l.course ?? "").trim()).filter(Boolean))]))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lectureId, ctx.group.id]);
  useEffect(() => {
    if (!lectureId) return;
    let alive = true;
    (flags.recordings ? recordingReady(lectureId) : Promise.resolve(false)).then((r) => alive && setRecording(r)).catch(() => alive && setRecording(false));
    return () => {
      alive = false;
    };
  }, [lectureId]);
  useEffect(() => {
    let alive = true;
    asksLeft(ctx.group.id)
      .then((n) => alive && setLeft(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  useEffect(() => () => abort.current?.abort(), []);

  const commit = (list: Turn[]) => {
    setTurns(list);
    saveThread(key, list);
  };

  const ask = async (q: string, on: string | null = lectureId) => {
    const question = q.trim();
    if (!question || live) return;
    setError("");
    setPick(null);
    setAlso([]);
    setText("");
    liveRef.current = "";
    setLive({ q: question, a: "" });
    const ctl = new AbortController();
    abort.current = ctl;
    let u = "";
    let routed: { id: string; title: string } | undefined;
    let done: Extract<AskLine, { t: "done" }> | null = null;
    const here = on && focus && on === lectureId ? focus : null;
    try {
      await askStream(
        {
          lectureId: on,
          course: on ? null : course,
          question,
          focus: here ? { part: here.part, anchor: here.anchor } : null,
          history: on ? turns.filter((t) => t.lectureId === on && t.sig).slice(-3).map((t) => ({ u: t.u, a: t.a, sig: t.sig })) : [],
        },
        (l) => {
          if (l.t === "lecture") {
            routed = { id: l.id, title: l.title };
            setAlso(l.also);
            setLive((x) => (x ? { ...x, routed } : x));
          } else if (l.t === "nolecture") setPick({ ok: l.ok, lectures: l.lectures });
          else if (l.t === "turn") u = l.u;
          else if (l.t === "a") {
            liveRef.current += l.d;
            setLive((x) => (x ? { ...x, a: liveRef.current } : x));
          } else if (l.t === "done") done = l;
        },
        ctl.signal,
      );
      const d = done as Extract<AskLine, { t: "done" }> | null;
      if (d) {
        if (typeof d.left === "number") setLeft(d.left);
        commit([
          ...turns,
          { q: question, u, a: liveRef.current, sig: d.sig, at: new Date().toISOString(), lectureId: routed?.id ?? on ?? "", badTags: d.badTags ?? [], stop: d.stop, focus: here },
        ]);
      }
    } catch (e) {
      const code = e instanceof Error ? (e.name === "AbortError" ? "aborted" : e.message) : "";
      if (code === "aborted" || code === "timeout") {
        // "עצירה", or the deadline: what arrived stays, with its notice (no signature: it cannot be shared).
        if (liveRef.current)
          commit([...turns, { q: question, u, a: liveRef.current, sig: "", at: new Date().toISOString(), lectureId: routed?.id ?? on ?? "", badTags: [], stop: "timeout", focus: null }]);
      } else setError(askError(code)); // a refusal drops the partial text
    } finally {
      abort.current = null;
      setLive(null);
    }
  };

  const headings = useMemo(
    () =>
      scope.sections
        .filter((s) => s.status === "ready")
        .flatMap((s) => [...s.markdown.matchAll(/^###\s+(.+)$/gm)].map((m) => m[1].replace(/[*_`]/g, "").trim()))
        .slice(0, 3),
    [scope.sections],
  );

  return {
    key,
    turns,
    newChat: () => {
      clearThread(key);
      setTurns([]);
    },
    focus,
    setFocus,
    text,
    setText,
    live,
    stop: () => abort.current?.abort(),
    pick,
    also,
    error,
    left,
    course,
    setCourse,
    courses,
    scope,
    recording,
    ask,
    headings,
  };
}
type AskState = ReturnType<typeof useAsk>;

/** The answer's card head (ask.html s1): "תשובה מההרצאה" · "רק שקפים וסיכום". */
const AnswerHead = () => (
  <div className="a-row between">
    <b className="a-small">תשובה מההרצאה</b>
    <span className="a-small a-muted">רק שקפים וסיכום</span>
  </div>
);

/** The conversation: the questions as bubbles, the answers as cards, their actions. */
function Conversation({ ctx, s, lectureId, onParagraph, onThread }: { ctx: Ctx; s: AskState; lectureId: string | null; onParagraph: (lectureId: string, spot: Spot) => void; onThread: (lectureId: string, spot: Spot) => void }) {
  return (
    <div className="a-stack k-ask">
      {!lectureId ? (
        <div className="a-wrap" role="group" aria-label="היקף">
          <button type="button" className={`a-chip${s.course === null ? " busy" : ""}`} aria-pressed={s.course === null} onClick={() => s.setCourse(null)}>
            {s.course === null ? "✓ כל ההרצאות" : "כל ההרצאות"}
          </button>
          {s.courses.map((c) => (
            <button key={c} type="button" className={`a-chip${s.course === c ? " busy" : ""}`} aria-pressed={s.course === c} onClick={() => s.setCourse(c)}>
              {s.course === c ? "✓ " : ""}
              <bdi>{c}</bdi>
            </button>
          ))}
        </div>
      ) : null}
      {s.focus ? (
        <div className="a-row between k-focus">
          <span className="a-small a-muted">
            על הפסקה: <bdi>״{s.focus.quote}…״</bdi>
          </span>
          <button type="button" className="a-btn ghost small" onClick={() => s.setFocus(null)}>
            בלי הפסקה ✕
          </button>
        </div>
      ) : null}
      {!s.turns.length && !s.live ? (
        <>
          <p className="a-para a-muted">{INTRO}</p>
          {s.headings.length ? (
            <div className="a-wrap">
              {s.headings.map((h) => (
                <button key={h} type="button" className="a-chip" onClick={() => void s.ask(`מה נאמר על ${h}?`)}>
                  מה נאמר על {isolateLatin(h, "h")}?
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {s.turns.map((t, i) => (
        <AnswerTurn key={`${t.at}-${i}`} ctx={ctx} turn={t} scope={s.scope} lectureId={lectureId} onParagraph={onParagraph} onThread={onThread} />
      ))}
      {s.live ? (
        <>
          <div className="a-stack">
            <div className="a-bubble me" dir="auto">
              {isolateLatin(s.live.q, "lq")}
            </div>
          </div>
          <div className="a-card k-answer" aria-busy="true">
            <AnswerHead />
            {s.live.routed ? (
              <p className="a-small a-muted">
                מתוך: <bdi>{s.live.routed.title}</bdi>
              </p>
            ) : !lectureId ? (
              <p className="a-small a-muted">מחפשים את ההרצאה המתאימה…</p>
            ) : null}
            {s.live.a ? <SummaryView markdown={s.live.a} compact /> : null}
            <p className="a-small a-muted">
              התשובה נכתבת…{" "}
              <button type="button" className="a-link" onClick={s.stop}>
                עצירה
              </button>
            </p>
          </div>
        </>
      ) : null}
      {s.also.length && !s.live ? (
        <div className="a-wrap">
          {s.also.map((l) => (
            <button key={l.id} type="button" className="a-chip" onClick={() => void s.ask(s.turns[s.turns.length - 1]?.q ?? "", l.id)}>
              לשאול גם על: <bdi>{l.title}</bdi>
            </button>
          ))}
        </div>
      ) : null}
      {s.pick ? (
        <div className="a-stack">
          <p className="a-para">{s.pick.ok ? "לא נמצאה הרצאה של הקבוצה שעוסקת בזה. אפשר לבחור הרצאה ולשאול עליה:" : "לא הצלחנו לבחור הרצאה. אפשר לבחור אותה כאן:"}</p>
          <div className="a-list">
            {s.pick.lectures.map((l) => (
              <button key={l.id} type="button" className="a-li" onClick={() => ctx.go({ v: "ask", l: l.id })}>
                <div>
                  <b>
                    <bdi>{l.title}</bdi>
                  </b>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {s.error ? (
        <p className="a-error" role="alert">
          {s.error}
        </p>
      ) : null}
      {s.turns.length && !s.live ? (
        <div className="a-row">
          <button type="button" className="a-btn ghost small" onClick={s.newChat}>
            שיחה חדשה
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** One answered question: the bubble, the answer's card, "עדיין לא ברור? לשאול את הקבוצה". */
function AnswerTurn({
  ctx,
  turn: t,
  scope,
  lectureId,
  onParagraph,
  onThread,
}: {
  ctx: Ctx;
  turn: Turn;
  scope: Scope;
  lectureId: string | null;
  onParagraph: (lectureId: string, spot: Spot) => void;
  onThread: (lectureId: string, spot: Spot) => void;
}) {
  const same = scope.lecture?.id === t.lectureId;
  const [sections, setSections] = useState<Section[] | null>(same ? scope.sections : null);
  const [lecture, setLecture] = useState<Lecture | null>(same ? scope.lecture : null);
  const [sharing, setSharing] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (scope.lecture?.id === t.lectureId) {
      setSections(scope.sections);
      setLecture(scope.lecture);
      return;
    }
    if (!t.lectureId) return;
    let alive = true;
    Promise.all([getLecture(t.lectureId), getSections(t.lectureId)])
      .then(([l, s]) => {
        if (!alive) return;
        setLecture(l);
        setSections(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [t.lectureId, scope.lecture, scope.sections]);
  const spots = useMemo(() => (sections ? answerSpots(sections, t.a, t.focus) : []), [sections, t.a, t.focus]);
  const home = spots[0] ?? null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t.a);
      ctx.say("התשובה הועתקה.");
    } catch {
      /* no clipboard here */
    }
  };
  const share = async (spot: Spot) => {
    setBusy("share");
    setError("");
    try {
      await shareAnswer({ lectureId: t.lectureId, part: spot.part, anchor: spot.anchor, quote: spot.quote, q: t.q, a: t.a });
      setSharing(null);
      ctx.say("התשובה צורפה לפסקה, וכל הקבוצה רואה אותה.");
    } catch (e) {
      setError(askError(e instanceof Error ? e.message : ""));
    } finally {
      setBusy("");
    }
  };
  const toGroup = async () => {
    if (!home) return;
    setBusy("group");
    setError("");
    try {
      await askTheGroup({ lectureId: t.lectureId, part: home.part, anchor: home.anchor, quote: home.quote, question: t.q, turn: t });
      setAsked(true);
      ctx.say("השאלה עלתה לפסקה.", { label: "לשרשור", run: () => onThread(t.lectureId, home) });
    } catch (e) {
      setError(askError(e instanceof Error ? e.message : ""));
    } finally {
      setBusy("");
    }
  };

  const routedTitle = !lectureId && lecture ? lecture.title : null;
  return (
    <>
      <div className="a-stack">
        <div className="a-bubble me" dir="auto">
          {isolateLatin(t.q, "q")}
        </div>
      </div>
      <div className="a-card k-answer">
        <AnswerHead />
        {routedTitle ? (
          <p className="a-small a-muted">
            מתוך: <bdi>{routedTitle}</bdi>
          </p>
        ) : null}
        <SummaryView markdown={t.a} compact badSlides={t.badTags} />
        {t.stop === "max_tokens" ? <p className="a-small a-muted">התשובה ארוכה מדי ונקטעה. אפשר לבקש אותה בקצרה.</p> : null}
        {t.stop === "timeout" ? <p className="a-small a-muted">התשובה נעצרה באמצע. אפשר לשאול שוב.</p> : null}
        <div className="a-wrap">
          {home && t.lectureId ? (
            <button type="button" className="a-btn" onClick={() => onParagraph(t.lectureId, home)}>
              <Icon name="book" size={14} />
              <span className="k-to-para">
                לפסקה: <bdi>{clip(home.quote, 40)}</bdi>
              </span>
            </button>
          ) : null}
          {spots.length && t.lectureId ? (
            <button type="button" className="a-btn ghost small" onClick={() => setSharing((x) => (x === null ? 0 : null))} aria-expanded={sharing !== null}>
              לשתף עם הקבוצה
            </button>
          ) : null}
          <button type="button" className="a-btn ghost small" onClick={() => void copy()}>
            העתקה
          </button>
        </div>
        {sharing !== null && spots[sharing] ? (
          <div className="a-card flat a-stack k-share">
            <p className="a-small">לצרף את התשובה לפסקה:</p>
            <p className="a-small a-muted">
              <bdi>״{spots[sharing].quote}…״</bdi>
            </p>
            <div className="a-row sheet-actions">
              <button type="button" className="a-btn small" disabled={busy === "share"} onClick={() => void share(spots[sharing])}>
                לשתף
              </button>
              {spots.length > 1 ? (
                <button type="button" className="a-btn ghost small" onClick={() => setSharing((x) => ((x ?? 0) + 1) % spots.length)}>
                  פסקה אחרת
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {t.sig && home && t.lectureId && !asked ? (
        <>
          <div className="a-row">
            <button type="button" className="a-btn wide k-to-group" disabled={busy === "group"} onClick={() => void toGroup()}>
              <Icon name="users" size={14} />
              עדיין לא ברור? לשאול את הקבוצה
            </button>
          </div>
          <p className="a-small a-muted">{TO_GROUP_NOTE}</p>
        </>
      ) : null}
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** The question's field and its send button (the screen's bottom bar, or the sheet's last row). */
function Composer({ s, lectureId }: { s: AskState; lectureId: string | null }) {
  return (
    <form
      className="a-row k-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void s.ask(s.text);
      }}
    >
      <input
        className="a-input"
        dir={s.text ? "auto" : "rtl"}
        maxLength={500}
        value={s.text}
        enterKeyHint="send"
        aria-label="השאלה"
        placeholder={lectureId ? "לשאול על ההרצאה…" : "לשאול על כל ההרצאות…"}
        onChange={(e) => s.setText(e.target.value)}
      />
      <button type="submit" className="a-btn primary icon" disabled={!s.text.trim() || Boolean(s.live)} aria-label="לשאול">
        <Icon name="send" size={16} />
      </button>
    </form>
  );
}

const leftLine = (left: number | null) => (left !== null ? `נשארו היום ${left} שאלות · השאלות נשמרות רק במכשיר הזה` : "השאלות נשמרות רק במכשיר הזה");

/** "לשאול על כל הקורס" (?v=ask&c=<course id>; sources.md, phase 1): its own chunk. */
const CourseAsk = lazy(() => import("./CourseAsk"));

/** ?v=ask: a lecture (from its chip or a paragraph), the library, or a whole course. */
export default function AskView(p: ScreenProps<"ask">) {
  if (p.route.c)
    return (
      <Suspense fallback={<Loading />}>
        <CourseAsk key={p.route.c} route={p.route} ctx={p.ctx} />
      </Suspense>
    );
  return <LectureAsk {...p} />;
}

function LectureAsk({ route, ctx }: ScreenProps<"ask">) {
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  useEffect(() => {
    if (!route.l) return;
    let alive = true;
    Promise.all([getLecture(route.l), getSections(route.l)])
      .then(([l, s]) => {
        if (!alive) return;
        setLecture(l);
        setSections(s);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [route.l]);
  const focus = useMemo<Spot | null>(() => {
    if (!route.at) return null;
    const sec = sections.find((x) => x.idx === route.at!.part);
    const b = sec ? blockSources(tidy(sec.markdown))[route.at.anchor] : undefined;
    return { part: route.at.part, anchor: route.at.anchor, quote: b ? plainQuote(b.text) : "" };
  }, [route.at, sections]);
  const s = useAsk(ctx, route.l ?? null, focus, lecture ?? undefined, sections);
  const sentFirst = useRef(false);
  // The library ask bar's text is asked once (?first=…).
  useEffect(() => {
    if (!route.first || sentFirst.current) return;
    sentFirst.current = true;
    void s.ask(route.first);
    // s.ask reads this render's state; the bar's text is sent once.
  }, [route.first]);

  let sub: ReactNode = null;
  if (route.l && s.recording === false)
    sub = (
      <p className="ph-sub">
        <Icon name="mic" size={12} />
        <span>{NO_RECORDING}</span>
      </p>
    );
  else if (!route.l) sub = <p className="ph-sub">כל ההרצאות של הקבוצה</p>;
  return (
    <main className="k-ask-screen">
      <Head back={<BackLink go={ctx.go} fallback={route.l ? { v: "lecture", l: route.l } : { v: "library" }} label={route.l ? "→ להרצאה" : "→ לספרייה"} />}>
        <h1 className="t">
          לשאול{lecture ? (
            <>
              {" "}
              · <bdi>{lecture.title}</bdi>
            </>
          ) : null}
        </h1>
      </Head>
      {sub}
      <Conversation
        ctx={ctx}
        s={s}
        lectureId={route.l ?? null}
        onParagraph={(l, spot) => ctx.go({ v: "lecture", l, at: { part: spot.part, anchor: spot.anchor } })}
        onThread={(l, spot) => ctx.go({ v: "lecture", l, at: { part: spot.part, anchor: spot.anchor } })}
      />
      <p className="a-small a-muted k-left">{leftLine(s.left)}</p>
      <StickyActions>
        <Composer s={s} lectureId={route.l ?? null} />
      </StickyActions>
    </main>
  );
}

/** "לשאול" on a paragraph, over the reader (review UX-12): no new route, so
 *  following and reading aloud go on under it; closing it returns to the
 *  reader where it was. Its touches do not pause the following. */
export function AskSheet({ lc, spot, onClose }: { lc: LectureCtx; spot: Spot; onClose: () => void }) {
  const s = useAsk(lc.ctx, lc.lecture.id, spot, lc.lecture, lc.sections);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <div onTouchMove={stop} onWheel={stop} onKeyDown={stop}>
      <Sheet
        label="לשאול"
        className="k-ask-sheet"
        head={
          <h2>
            לשאול · <bdi>{lc.lecture.title}</bdi>
          </h2>
        }
        onClose={onClose}
      >
        {(sheet) => (
          <>
            {s.recording === false ? (
              <p className="a-small a-muted a-row">
                <Icon name="mic" size={12} />
                <span>{NO_RECORDING}</span>
              </p>
            ) : null}
            <Conversation
              ctx={lc.ctx}
              s={s}
              lectureId={lc.lecture.id}
              onParagraph={(_l, at) =>
                sheet.closeThen(() => {
                  // The paragraph is on the page under the sheet: scroll to it (its first slide marks it, as a tag does).
                  const first = citedSlides(blockSources(tidy(lc.sections.find((x) => x.idx === at.part)?.markdown ?? ""))[at.anchor]?.text ?? "")[0];
                  if (first !== undefined) lc.toSlide(first);
                  else document.querySelector(`[data-part="${at.part}"] [data-blk="${at.anchor}"]`)?.scrollIntoView({ block: "center" });
                })
              }
              onThread={(_l, at) => sheet.closeThen(() => lc.openParagraph(at, "comments"))}
            />
            <Composer s={s} lectureId={lc.lecture.id} />
            <p className="a-small a-muted">{leftLine(s.left)}</p>
          </>
        )}
      </Sheet>
    </div>
  );
}
