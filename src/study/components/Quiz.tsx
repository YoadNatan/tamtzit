import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { TrapChip } from "../features/extras";
import { BossEnd, BossHud } from "../features/boss";
import type { ScreenProps } from "../features/types";
import { getLecture, members, type Lecture, type Member } from "../lib/api";
import { flagQuestion, deleteFlag, type Flag } from "../lib/practice";
import { setHidden } from "../lib/practiceSession";
import {
  answerRound,
  autoBet,
  BET_SCALE,
  BET_WORDS,
  clearPending,
  clock as clockText,
  endQuiz,
  firstVote,
  joinQuiz,
  leaveQuiz,
  loadPending,
  ltr,
  MODE_NAME,
  nextRound,
  quizErrorText,
  quizPool,
  revealRound,
  savePending,
  signed,
  takeHost,
  voidRound,
  writingFor,
  type Bet,
} from "../lib/quiz";
import { KEEP_SCREEN_ON } from "../lib/rounds";
import { reveal } from "../lib/reveal";
import { isolateLatin } from "../lib/rich";
import { shareUrl, type Route } from "../lib/route";
import { useQuiz } from "../lib/useQuiz";
import FlagSheet from "./FlagSheet";
import { Icon } from "./Icon";
import QuizMedia from "./QuizMedia";
import QuizQuestion, { LETTERS } from "./QuizQuestion";
import { Bars, ModeLine, QuizEnd, RaceTable, revoteChip, Rules, VoteBlock } from "./QuizParts";
import { Avatar, BackLink, Head, Loading, RouteLink, Sheet, StickyActions } from "./Shell";
import SlideSheet from "./SlideSheet";

/* ── The room: lobby, countdown, question, argument, reveal, end (package Z;
 * design-quiz §1.3 L-H with the approved screens and §12.3.Z) ──
 *
 * Everything comes from study_quiz_state through useQuiz: what this phone
 * may see, at the server's time. A player answers alone with a bet ("ניחוש
 * · נראה לי · על בטוח": choosing an option selects it, choosing a bet sends
 * both; with 3 s left a chosen option goes as "ניחוש"). In "כולנו נגד
 * המבחן" a split group (30-70% right, 3 answers or more) gets 90 seconds to
 * argue with vote 1's bars and no key, then votes again without a bet; the
 * reveal shows both rounds' bars, "83%, היה 33%", the round's trap, and on
 * this phone only the bet's points. Fewer than 3 answers: "2 ענו", no bars
 * (the database sends no counts). A round most of the group got wrong
 * (under 30%) opens the question's slide on every phone (the paragraph is
 * N's, with Q's end: spec §12.3.Z), and the next countdown closes it, as it
 * closes any slide or sheet. "מירוץ": the bet is the score, time only
 * breaks ties, and the table (top three and one's own place) is for the
 * race's players, in the game only. A member who did not join watches. */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** The "online" event, or 3 s. */
const online = () =>
  new Promise<void>((ok) => {
    const t = setTimeout(done, 3000);
    function done() {
      clearTimeout(t);
      window.removeEventListener("online", done);
      ok();
    }
    window.addEventListener("online", done);
  });

type Sheet_ = { kind: "leave" } | { kind: "void" } | { kind: "flag"; qid: string } | null;

export default function Quiz({ quizId, ctx }: ScreenProps<"quiz"> & { quizId: string }) {
  const { state, view, live, error, clock, refresh } = useQuiz(quizId);
  const me = ctx.userId;
  const [selected, setSelected] = useState<number | null>(null);
  const betRef = useRef<HTMLElement>(null);
  const [pending, setPending] = useState<{ idx: number; vote: 1 | 2; choice: number | null } | null>(null);
  const [sheet, setSheet] = useState<Sheet_>(null);
  const [slide, setSlide] = useState<{ l: string; n: number } | null>(null);
  const [lectures, setLectures] = useState<Record<string, Lecture>>({});
  const [people, setPeople] = useState<Member[]>([]);
  const [flags, setFlags] = useState<Record<string, Flag>>({});
  const [ready, setReady] = useState<number | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>("");
  const places = useRef<Record<string, number>>({});
  const [placesBefore, setPlacesBefore] = useState<Record<string, number>>({});

  const z = state?.quiz;
  const r = state?.round ?? null;
  const playing = Boolean(state?.me?.playing);
  const host = z?.host_id === me;
  const race = z?.mode === "race";
  const vote: 1 | 2 = (r?.vote ?? z?.vote ?? 1) === 2 ? 2 : 1;
  const roundKey = r ? `${r.idx}:${vote}` : "";
  const hostName = (z?.host_id && (state?.players.find((p) => p.user_id === z.host_id)?.name || ctx.nameOf(z.host_id))) || "ללא שם";

  /* ── the members (who is in, who the lobby waits for) and the lectures (slides) ── */
  useEffect(() => {
    members(ctx.group.id).then(setPeople).catch(() => undefined);
  }, [ctx.group.id]);
  const lectureId = r?.q?.lecture_id ?? null;
  useEffect(() => {
    if (!lectureId || lectures[lectureId]) return;
    let alive = true;
    getLecture(lectureId)
      .then((l) => alive && l && setLectures((m) => ({ ...m, [l.id]: l })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lectureId, lectures]);

  /* ── a new round (or vote): the choice resets; the next countdown closes any slide or sheet ── */
  useEffect(() => {
    setSelected(null);
    if (view?.v === "countdown") {
      setSlide(null);
      setSheet((s) => (s?.kind === "leave" ? s : null));
    }
  }, [roundKey, view?.v]);

  /* ── the lobby: questions ready for the quiz's lectures, and whether they are being written (review UX-5) ── */
  const inLobby = z?.state === "lobby";
  const lectureIds = z?.lecture_ids.join(",") ?? "";
  useEffect(() => {
    if (!inLobby || !z) return;
    let alive = true;
    const ids = lectureIds.split(",").filter(Boolean);
    const load = () =>
      Promise.all([quizPool(ctx.group.id), writingFor(ids).catch(() => false)])
        .then(([rows, w]) => {
          if (!alive) return;
          const k = z.kinds;
          setReady(rows.filter((x) => ids.includes(x.lecture_id)).reduce((n, x) => n + (k === "mcq" ? x.mcq : k === "case" ? x.cases : x.mcq + x.cases), 0));
          setWriting(w);
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [inLobby, lectureIds, z?.kinds, ctx.group.id]);

  /* ── the race's places before this reveal, for the arrows ── */
  useEffect(() => {
    if (!state || !race) return;
    if (state.quiz.state === "reveal") setPlacesBefore({ ...places.current });
    const now: Record<string, number> = {};
    const scored = state.players.filter((p) => typeof p.score === "number");
    for (const p of scored) now[p.user_id] = 1 + scored.filter((o) => (o.score ?? 0) > (p.score ?? 0) || ((o.score ?? 0) === (p.score ?? 0) && (o.ms ?? 0) < (p.ms ?? 0))).length;
    if (state.quiz.state === "reveal") places.current = now;
  }, [state?.quiz.version]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── lines a screen reader hears once: the last 10 seconds, the time's end ── */
  const [heard, setHeard] = useState("");
  useEffect(() => {
    if (view?.v === "question" && view.leftMs <= 10_000 && heard !== `${roundKey}:10`) setHeard(`${roundKey}:10`);
    else if (view?.v === "waiting" && heard !== `${roundKey}:0`) setHeard(`${roundKey}:0`);
  }, [view, roundKey, heard]);

  /* ── the host changed: who manages now ── */
  const hostWas = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!z) return;
    const before = hostWas.current;
    hostWas.current = z.host_id;
    if (before === undefined || before === z.host_id || !z.host_id) return;
    const name = state?.players.find((p) => p.user_id === z.host_id)?.name || ctx.nameOf(z.host_id) || "ללא שם";
    if (z.host_id === me) ctx.say("הניהול עבר לטלפון הזה.");
    else if (before === me) ctx.say(`ניהול המבחן עבר ל${name} בזמן שלא היה חיבור.`);
    else ctx.say(`ניהול המבחן עבר ל${name}.`);
  }, [z?.host_id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── joining in the middle ── */
  const joinedSaid = useRef(false);
  useEffect(() => {
    if (!state?.me || joinedSaid.current) return;
    joinedSaid.current = true;
    if (state.me.joined_idx >= 0 && state.quiz.state !== "lobby") ctx.say("מצטרפים באמצע: השאלות הקודמות לא נספרות.");
  }, [state?.me]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── the connection: a thin bar after 2 s without Realtime, a toast when it is back ── */
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (live) {
      if (offline) {
        setOffline(false);
        ctx.say("החיבור חזר.");
      }
      return;
    }
    const t = setTimeout(() => setOffline(true), 2000);
    return () => clearTimeout(t);
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── answering ── */
  const send = useCallback(
    async (choice: number | null, bet: Bet | null) => {
      if (!state || !r || pending || r.mine) return;
      const idx = r.idx;
      const v = vote;
      setPending({ idx, vote: v, choice });
      savePending(me, quizId, { idx, vote: v, choice, bet });
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await answerRound(quizId, idx, choice, bet, v);
            break;
          } catch (e) {
            const code = codeOf(e);
            if (code === "not open") {
              await sleep(Math.max(200, Date.parse(r.opens_at) - clock.now() + 200));
              continue;
            }
            if (code === "network" && clock.now() < Date.parse(r.closes_at) + 1500) {
              setSaid("אין חיבור כרגע. התשובה תישלח כשהחיבור יחזור, אם עוד יהיה זמן.");
              await online();
              continue;
            }
            const text = quizErrorText(code);
            if (text) ctx.say(text);
            break;
          }
        }
      } finally {
        clearPending(me, quizId);
        setPending(null);
        setSaid("");
        void refresh();
      }
    },
    [state, r, pending, vote, me, quizId, clock, ctx, refresh],
  );

  // An answer sent before a reload or an app switch: once more, if its round is still open.
  const resent = useRef(false);
  useEffect(() => {
    if (!state || !r || resent.current || view?.v !== "question") return;
    resent.current = true;
    const p = loadPending(me, quizId);
    if (p && p.idx === r.idx && p.vote === vote && !r.mine && playing) void send(p.choice, p.bet);
    else if (p) clearPending(me, quizId);
  }, [state, r, view?.v]); // eslint-disable-line react-hooks/exhaustive-deps

  // With 3 s left, an option chosen without a bet goes as "ניחוש".
  useEffect(() => {
    if (!view) return;
    const bet = autoBet(view, selected, Boolean(pending) || Boolean(r?.mine));
    if (bet !== null && selected !== null) void send(selected, bet);
  }, [view, selected, pending, r?.mine, send]);

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const text = quizErrorText(codeOf(e));
      if (text) ctx.say(text);
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  /* ── the round's question, for the slide sheet and the flag sheet ── */
  const lecture = lectureId ? lectures[lectureId] : undefined;
  const sourceKey = r && r.next_step === "source" && z?.state === "reveal" ? `${r.idx}:${r.vote ?? 1}` : "";
  const sourceShown = useRef("");
  useEffect(() => {
    // A round most of the group got wrong: every player's phone opens its slide.
    if (!sourceKey || sourceShown.current === sourceKey || !lecture || !r?.q?.slides.length || !playing) return;
    sourceShown.current = sourceKey;
    setSlide({ l: lecture.id, n: r.q.slides[0] });
  }, [sourceKey, lecture, r?.q?.slides, playing]);

  if (!state || !z || !view) {
    if (error === "quiz not found" || error === "group not found") {
      return (
        <main className="quiz-room quiz-gone">
          <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title="מבחן קבוצתי" />
          <p className="a-card dashed" role="alert">
            המבחן לא נמצא.
          </p>
          <RouteLink to={{ v: "library" }} go={ctx.go} className="a-btn primary">
            חזרה לספרייה
          </RouteLink>
        </main>
      );
    }
    return <Loading />;
  }

  const total = Math.max(z.n_total, 1);
  const position = `שאלה ${(r?.idx ?? z.idx) + 1} מתוך ${total}`;
  const modeChip = <span className="a-chip busy">{MODE_NAME[z.mode]}</span>;
  const nameOf = (id: string) => state.players.find((p) => p.user_id === id)?.name || ctx.nameOf(id);
  const leave = () => (playing ? setSheet({ kind: "leave" }) : ctx.go({ v: "group" }));
  const watchingBar =
    !playing && z.state !== "ended" && z.state !== "cancelled" ? (
      <div className="a-callout quiet a-row between quiz-watch" role="status">
        <b>צופים במבחן</b>
        <button type="button" className="a-btn small" onClick={() => void act(() => joinQuiz(quizId))}>
          להצטרף
        </button>
      </div>
    ) : null;
  const hostAway =
    playing && !host && !state.host_here && (z.state === "lobby" || z.state === "reveal") ? (
      <div className="a-callout warn a-row between quiz-away" role="status">
        <span>ל{hostName} אין חיבור כרגע.</span>
        <button type="button" className="a-btn small" disabled={busy} onClick={() => void act(() => takeHost(quizId))}>
          לקחת את ניהול המבחן
        </button>
      </div>
    ) : null;
  const offlineBar = offline ? (
    <div className="a-callout warn quiz-offline" role="status">
      <span className="dot" aria-hidden="true" />
      מתחברים מחדש…
    </div>
  ) : null;
  // The room's top bar (the approved screens): ✕, where the quiz is, the mode.
  const top = (title: string) => (
    <Head
      back={
        <button type="button" className="a-btn ghost icon quiz-close" aria-label="יציאה מהמבחן" onClick={leave}>
          ✕
        </button>
      }
      title={title}
    >
      {modeChip}
    </Head>
  );
  const sheets = (
    <>
      {sheet?.kind === "leave" ? (
        <Sheet label="יציאה מהמבחן" onClose={() => setSheet(null)} head={<h2>יציאה מהמבחן</h2>}>
          {(s) => {
            const heir = state.players.filter((p) => p.user_id !== me && !p.left).sort((a, b) => Number(b.here) - Number(a.here))[0];
            return (
              <>
                <p>{host && heir ? `לצאת? ניהול המבחן יעבור ל${heir.name || "ללא שם"}.` : "לצאת מהמבחן? אפשר לחזור דרך הבאנר."}</p>
                <div className="a-row sheet-actions">
                  <button
                    type="button"
                    className="a-btn primary"
                    onClick={() =>
                      s.closeThen(() => {
                        void leaveQuiz(quizId).catch(() => undefined);
                        ctx.go({ v: "group" });
                      })
                    }
                  >
                    לצאת
                  </button>
                  <button type="button" className="a-btn ghost" onClick={s.close}>
                    להישאר
                  </button>
                </div>
              </>
            );
          }}
        </Sheet>
      ) : null}
      {sheet?.kind === "void" && r ? (
        <Sheet label="ביטול השאלה" onClose={() => setSheet(null)} head={<h2>ביטול השאלה</h2>}>
          {(s) => (
            <>
              <p>לבטל את השאלה? היא לא תיספר לאף אחד, גם לא בתרגול.</p>
              <div className="a-row sheet-actions">
                <button type="button" className="a-btn danger" onClick={() => s.closeThen(() => void act(() => voidRound(quizId, r.idx)))}>
                  ביטול השאלה
                </button>
                <button type="button" className="a-btn ghost" onClick={s.close}>
                  חזרה
                </button>
              </div>
            </>
          )}
        </Sheet>
      ) : null}
      {sheet?.kind === "flag" ? (
        <FlagSheet
          myFlag={flags[sheet.qid] ?? null}
          onClose={() => setSheet(null)}
          onDelete={async (f) => {
            await deleteFlag(f.id);
            setFlags((m) => {
              const n = { ...m };
              delete n[f.question_id];
              return n;
            });
          }}
          onSend={async (reason, note) => {
            const mine = await flagQuestion(sheet.qid, reason, note);
            setFlags((m) => ({ ...m, [mine.question_id]: mine }));
            ctx.say("נשלח לקבוצה.");
          }}
          onHide={() => {
            const qid = sheet.qid;
            setHidden(me, qid, true);
            ctx.say("השאלה הוסתרה אצלך.", { label: "ביטול", run: () => void setHidden(me, qid, false) });
          }}
        />
      ) : null}
      {slide && lectures[slide.l] ? (
        <SlideSheet lecture={lectures[slide.l]} slide={slide.n} go={ctx.go} inQuiz={z.state === "question" || (z.state === "reveal" && (host || z.stage === "argue"))} onClose={() => setSlide(null)} />
      ) : null}
    </>
  );

  /* ── cancelled; ended for someone who did not play ── */
  if (z.state === "cancelled") {
    return (
      <main className="quiz-room quiz-gone">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title="מבחן קבוצתי" />
        <p className="a-card dashed" role="status">
          המבחן בוטל.
        </p>
        <RouteLink to={{ v: "library" }} go={ctx.go} className="a-btn primary">
          חזרה לספרייה
        </RouteLink>
      </main>
    );
  }
  if (z.state === "ended") {
    if (!state.summary) {
      return (
        <main className="quiz-room quiz-gone">
          <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title="מבחן קבוצתי" />
          <p className="a-card dashed" role="status">
            המבחן הסתיים.
          </p>
          <RouteLink to={{ v: "quiz", isNew: true }} go={ctx.go} className="a-btn primary">
            מבחן חדש
          </RouteLink>
        </main>
      );
    }
    const again: Route = z.lecture_ids.length === 1 ? { v: "quiz", isNew: true, l: z.lecture_ids[0] } : { v: "quiz", isNew: true };
    // H: a battle's end is the boss's own (boss.html s2): the group's result, the moments, one's loot.
    if (z.mode === "boss")
      return (
        <main className="quiz-room quiz-ended boss-ended">
          <BossEnd ctx={ctx} state={state} />
          <StickyActions>
            <RouteLink to={{ v: "group" }} go={ctx.go} className="a-btn">
              חזרה ליחד
            </RouteLink>
          </StickyActions>
          {sheets}
        </main>
      );
    return (
      <main className="quiz-room quiz-ended">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title={race ? "מירוץ" : "מבחן קבוצתי"}>
          {modeChip}
        </Head>
        <p className="ph-sub" dir="rtl">
          <span>{isolateLatin(z.title, "et")}</span>
        </p>
        <QuizEnd state={state} me={me} />
        <StickyActions>
          <RouteLink to={{ v: "library" }} go={ctx.go} className="a-btn">
            חזרה לספרייה
          </RouteLink>
          <RouteLink to={again} go={ctx.go} className="a-btn primary wide">
            {race ? "עוד סיבוב" : "מבחן נוסף"}
          </RouteLink>
        </StickyActions>
        {sheets}
      </main>
    );
  }

  /* ── the lobby ── */
  if (view.v === "lobby") {
    const inGroup = people.length || state.players.length;
    const inside = state.players.filter((p) => !p.left);
    const waiting = people.filter((p) => !state.players.some((x) => x.user_id === p.user_id && !x.left));
    const need = Math.min(z.n_wanted, 5);
    const startable = ready === null ? true : writing ? ready >= need : ready > 0;
    return (
      <main className="quiz-room quiz-lobby">
        <Head
          back={
            playing ? (
              <button type="button" className="back" onClick={leave}>
                → יציאה
              </button>
            ) : (
              <BackLink go={ctx.go} fallback={{ v: "group" }} />
            )
          }
          title={race ? "מירוץ" : z.mode === "boss" ? "אתגר קבוצתי" : "מבחן קבוצתי"}
        >
          <span className="a-chip busy">{z.n_wanted} שאלות</span>
        </Head>
        <p className="ph-sub" dir="rtl">
          <span>{isolateLatin(z.title, "lt")}</span>
        </p>
        {watchingBar}
        {hostAway}
        {offlineBar}
        <ModeLine mode={z.mode} record={z.record} />
        {z.mode === "boss" ? <BossHud ctx={ctx} state={state} /> : null}
        <section className="a-stack" aria-labelledby="quiz-wait-h">
          <div className="a-sec">
            <h2 id="quiz-wait-h">ממתינים להתחלה</h2>
            <span className="a-small a-muted">
              {z.n_wanted} שאלות · {z.seconds} שניות לשאלה
            </span>
          </div>
          {writing && ready !== null ? (
            <div className="a-card flat quiz-writing" role="status">
              <div className="a-row between">
                <b className="a-small">
                  נכתבות שאלות: {ready} מתוך {z.n_wanted}
                </b>
                <span className="a-chip busy">
                  <span className="dot" aria-hidden="true" />
                  נכתבות
                </span>
              </div>
              <div className="a-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, Math.round((100 * ready) / Math.max(1, z.n_wanted)))}%` }} />
              </div>
              {host ? <p className="a-small a-muted">{KEEP_SCREEN_ON}</p> : null}
            </div>
          ) : null}
          {!writing && ready !== null && ready > 0 && ready < z.n_wanted ? (
            <p className="a-small a-muted">
              יש רק {ready} שאלות מוכנות, אז המבחן יהיה של {ready}.
            </p>
          ) : null}
          {!writing && ready === 0 ? <p className="a-error">{quizErrorText("no questions")}</p> : null}
        </section>
        <section className="a-stack" aria-labelledby="quiz-who-h">
          <div className="a-sec">
            <h2 id="quiz-who-h">מי בפנים</h2>
            {inGroup ? (
              <span className="a-small a-muted">
                {inside.length} מתוך {Math.max(people.length, inside.length)}
              </span>
            ) : null}
          </div>
          <ul className="a-wrap quiz-people">
            {inside.map((p) => (
              <li key={p.user_id} className={`quiz-person${p.here ? "" : " is-away"}`}>
                <Avatar id={p.user_id} name={p.name || "ללא שם"} />
                <span className="quiz-person-name">{p.name || "ללא שם"}</span>
                {p.here ? null : <span className="a-small a-muted">· לא מחובר</span>}
                {p.host ? <span className="a-chip">ניהול</span> : null}
              </li>
            ))}
          </ul>
          {waiting.length ? (
            <p className="a-small a-muted">
              מחכים ל{waiting[0].name || "ללא שם"}
              {waiting.length > 1 ? (
                <>
                  {" "}
                  <bdi dir="ltr">+{waiting.length - 1}</bdi>
                </>
              ) : null}
            </p>
          ) : null}
        </section>
        <Rules mode={z.mode} seconds={z.seconds} />
        {!playing ? <p className="a-small a-muted">אפשר גם רק לצפות.</p> : null}
        {playing && !host ? <p className="a-small a-muted">המבחן יתחיל אחרי לחיצה על ״להתחיל״ בטלפון של {hostName}.</p> : null}
        {host ? (
          <button type="button" className="a-link danger quiz-cancel" disabled={busy} onClick={() => void act(() => endQuiz(quizId))}>
            ביטול המבחן
          </button>
        ) : null}
        <StickyActions>
          <button type="button" className="a-btn" onClick={() => void shareLink(z.title, quizId, ctx.say)}>
            <Icon name="send" size={16} />
            קישור לוואטסאפ
          </button>
          {!playing ? (
            <button type="button" className="a-btn primary wide" disabled={busy} onClick={() => void act(() => joinQuiz(quizId))}>
              להצטרף למבחן
            </button>
          ) : host ? (
            <button type="button" className="a-btn primary wide" disabled={busy || !startable} onClick={() => void act(() => nextRound(quizId, -1))}>
              להתחיל
            </button>
          ) : null}
        </StickyActions>
        {sheets}
      </main>
    );
  }

  /* ── the countdown ── */
  if (view.v === "countdown") {
    return (
      <main className="quiz-room quiz-countdown">
        {top(position)}
        <div className="quiz-count" role="timer" aria-live="off">
          {vote === 2 ? <span className="a-chip warn">סבב 2 · אחרי הוויכוח</span> : null}
          <div className="a-ring quiz-count-ring" style={{ "--p": `${Math.min(100, Math.round((100 * view.secs) / 3))}%` } as CSSProperties}>
            <span className="quiz-count-n">{view.secs}</span>
          </div>
          <p className="a-muted">מתחילים…</p>
          {race ? <p className="a-small a-muted">{BET_SCALE} מהירות רק שוברת שוויון.</p> : null}
        </div>
        {z.mode === "boss" ? <BossHud ctx={ctx} state={state} /> : null}
        {sheets}
      </main>
    );
  }

  const q = r?.q ?? null;
  const card = (fb: Parameters<typeof QuizQuestion>[0]["feedback"], chosen: number | null | undefined, extra: Partial<Parameters<typeof QuizQuestion>[0]> = {}) =>
    q ? (
      <QuizQuestion
        q={{ id: q.id, kind: q.kind, vignette: q.vignette, question: q.question, options: q.options }}
        position={{ index: (r?.idx ?? 0) + 1, total }}
        chosen={chosen}
        feedback={fb}
        onChoose={() => undefined}
        onSlide={(n) => (q.lecture_id ? setSlide({ l: q.lecture_id, n }) : undefined)}
        chips={z.lecture_ids.length > 1 && q.lecture_title ? <span className="a-chip quiz-source-chip"><bdi>{q.lecture_title}</bdi></span> : null}
        media={<QuizMedia questionId={q.id} revealed={fb !== null} />}
        {...extra}
      />
    ) : (
      <p className="a-card dashed a-muted">השאלה הזו נמחקה עם ההרצאה שלה.</p>
    );

  /* ── a question (vote 1 or 2) and the wait for its reveal ── */
  if (view.v === "question" || view.v === "waiting") {
    const sent = r?.mine ?? null;
    const left = view.v === "question" ? view.leftMs : 0;
    const timeUp = view.v === "waiting";
    const canAnswer = view.v === "question" && view.canAnswer && !pending;
    const mineChoice = sent ? sent.choice : pending ? pending.choice : undefined;
    const answered = z.answered_n;
    return (
      <main className="quiz-room quiz-question">
        {top(position)}
        {watchingBar}
        {offlineBar}
        <p className="sr-only" aria-live="polite">
          {heard.endsWith(":10") ? "נשארו 10 שניות" : heard.endsWith(":0") ? "הזמן נגמר." : ""}
        </p>
        {/* boss.html s1: the battle's HUD sits above the clock and the question */}
        {z.mode === "boss" ? <BossHud ctx={ctx} state={state} /> : null}
        <div className="a-row between">
          <span className={`a-chip ${left <= 10_000 ? "warn" : "group"} quiz-clock`} role="timer" aria-label="הזמן שנשאר">
            <Icon name="clock" size={13} />
            <bdi dir="ltr">{clockText(left)}</bdi>
          </span>
          <span className="a-small a-muted">
            ענו {answered} מתוך {z.players_n}
          </span>
        </div>
        <div className="a-timer" aria-hidden="true">
          <i style={{ width: `${r ? Math.min(100, Math.round((100 * left) / Math.max(1, Date.parse(r.closes_at) - Date.parse(r.opens_at)))) : 0}%` }} />
        </div>
        {card(null, mineChoice, {
          busy: Boolean(pending),
          picked: selected,
          aside: <span className="a-small a-muted">{vote === 2 ? "סבב 2 · אחרי הוויכוח" : q && q.slides.length ? `מבוסס על ש׳ ${q.slides.join(", ")}` : ""}</span>,
          onChoose: (i) => {
            if (!canAnswer) return;
            if (i === null) return void send(null, null);
            if (vote === 2) return void send(i, null);
            setSelected(i);
            reveal(betRef.current); // the answer goes only with "כמה בטוחים?": never under the fold
          },
          noDontKnow: race || !canAnswer,
        })}
        {vote === 1 && playing && !sent && !pending && !timeUp ? (
          <section ref={betRef} className="a-stack quiz-bet" aria-labelledby="quiz-bet-h">
            <div className="a-sec">
              <h2 id="quiz-bet-h">כמה בטוחים?</h2>
              {!race ? <span className="a-chip">רק לך</span> : null}
            </div>
            <div className="a-row quiz-bets" role="group" aria-labelledby="quiz-bet-h">
              {([1, 2, 3] as const).map((b) => (
                <button key={b} type="button" className={`a-btn wide${b === 3 ? " quiz-sure" : ""}`} disabled={selected === null || !canAnswer} onClick={() => selected !== null && void send(selected, b)}>
                  {BET_WORDS[b]}
                </button>
              ))}
            </div>
            <p className="a-small a-muted">{BET_SCALE}</p>
          </section>
        ) : null}
        {vote === 2 && playing && !sent ? <p className="a-small a-muted">בסבב 2 לא מסמנים שוב: נספר מה שסימנת בסבב הראשון.</p> : null}
        {!race && vote === 1 && !timeUp ? (
          <p className="a-callout quiz-note">
            <b>בלי שמות.</b> בחשיפה רואים רק כמה בחרו כל תשובה, ורק אם ענו לפחות 3.
          </p>
        ) : null}
        <p className="quiz-status" role="status">
          {said ||
            (pending
              ? "שולחים…"
              : sent
                ? race
                  ? `התשובה נקלטה אחרי ${Math.max(1, Math.round(sent.ms / 1000))} שניות.`
                  : "התשובה נקלטה."
                : timeUp
                  ? "הזמן נגמר."
                  : "")}
          {timeUp ? <span className="a-muted"> חושפים את התשובה…</span> : null}
        </p>
        <StickyActions>
          {host && !race && z.mode !== "boss" ? (
            <button type="button" className="a-btn primary wide" disabled={busy} onClick={() => void act(() => revealRound(quizId, r?.idx ?? z.idx))}>
              לחשוף עכשיו
            </button>
          ) : sent ? (
            <p className="a-btn wide quiz-locked" role="status">
              <Icon name="check" size={16} />
              התשובה נעולה עד החשיפה
            </p>
          ) : null}
        </StickyActions>
        {sheets}
      </main>
    );
  }

  /* ── the argument: vote 1's bars, no key, 90 seconds; the host may open vote 2 ── */
  if (view.v === "argue") {
    const first = firstVote(r);
    return (
      <main className="quiz-room quiz-argue">
        {top(`שאלה ${(r?.idx ?? 0) + 1} · החשיפה`)}
        {watchingBar}
        {hostAway}
        {offlineBar}
        <VoteBlock title="סבב 1 · עונים לבד" chip="חצויה: 90 שניות לשכנע" chipTone="warn">
          <Bars counts={r?.counts1} options={q?.options ?? []} label="סבב 1" />
        </VoteBlock>
        <p className="a-callout warn quiz-argue-line" role="timer">
          <Icon name="chat" size={15} /> <b>מתווכחים בקול.</b> הסבב השני נפתח בעוד <bdi dir="ltr">{clockText(view.leftMs)}</bdi>
        </p>
        {card(null, first ? first.choice : undefined, { noDontKnow: true, busy: true })}
        <StickyActions>
          {host ? (
            <button type="button" className="a-btn primary wide" disabled={busy} onClick={() => void act(() => nextRound(quizId, r?.idx ?? z.idx))}>
              לסבב 2
            </button>
          ) : null}
        </StickyActions>
        {sheets}
      </main>
    );
  }

  /* ── the reveal ── */
  const revoted = (r?.vote ?? 1) === 2;
  const key = r?.answer ?? null;
  const mine1 = firstVote(r);
  const finalChoice = r?.mine ? r.mine.choice : undefined;
  const correct = revoted ? (r?.correct2 ?? null) : (r?.correct ?? null);
  const letter = key !== null ? LETTERS[key] : "";
  const pts = r?.points ?? null;
  let headline: string | undefined;
  if (r && !r.voided && key !== null && playing) {
    if (finalChoice === undefined) headline = race ? "לא נשלחה תשובה · 0 נקודות" : `לא נשלחה תשובה. התשובה הנכונה: ${letter}`;
    else if (race) headline = correct ? `✓ תשובה נכונה · ${ltr(signed(pts ?? 0))}` : `✗ ${ltr(signed(pts ?? 0))} נקודות · התשובה הנכונה: ${letter}`;
  }
  const answeredN = r?.answered ?? 0;
  const counted = typeof r?.right === "number";
  const isLast = (r?.idx ?? 0) + 1 >= z.n_total;
  const source = r?.next_step === "source";
  return (
    <main className="quiz-room quiz-reveal">
      {top(`שאלה ${(r?.idx ?? 0) + 1} · החשיפה`)}
      {watchingBar}
      {hostAway}
      {offlineBar}
      {z.mode === "boss" ? <BossHud ctx={ctx} state={state} /> : null}
      {r?.voided ? (
        <p className="a-callout warn quiz-voided" role="status">
          <b>השאלה בוטלה{r.voided_by ? ` · ${nameOf(r.voided_by) || "ללא שם"}` : ""}</b>
        </p>
      ) : null}
      {revoted && r ? (
        <>
          <VoteBlock title="סבב 1 · עונים לבד" chip="חצויה: 90 שניות לשכנע" chipTone="warn">
            <Bars counts={r.counts1} options={q?.options ?? []} answer={key} label="סבב 1" />
          </VoteBlock>
          <VoteBlock
            title="סבב 2 · אחרי הוויכוח"
            chip={counted && typeof r.right1 === "number" && r.answered1 ? revoteChip(r.right ?? 0, answeredN, r.right1, r.answered1) : `${answeredN} ענו`}
            chipTone="ok"
          >
            <Bars counts={r.counts} options={q?.options ?? []} answer={key} label="סבב 2" />
          </VoteBlock>
        </>
      ) : r && !r.voided ? (
        <section className="a-stack quiz-vote">
          <div className="a-row between">
            <b className="a-small">
              {counted ? `${r.right} מתוך ${answeredN} ענו נכון` : `${answeredN} ענו`}
              {counted && r.dont_know ? ` · ״לא יודעים״: ${r.dont_know}` : ""}
            </b>
            {counted && answeredN ? <span className={`a-chip ${(r.right ?? 0) * 10 >= answeredN * 8 ? "ok" : ""}`}>{Math.round((100 * (r.right ?? 0)) / answeredN)}%</span> : null}
          </div>
          <Bars counts={r.counts} options={q?.options ?? []} answer={key} label="כמה בחרו בכל תשובה" />
        </section>
      ) : null}
      {source && !r?.voided ? (
        <p className="a-callout warn a-row between quiz-source" role="status">
          <span>רוב הקבוצה טעתה: פותחים את השקף.</span>
          {lecture && q?.slides.length ? (
            <button type="button" className="a-btn small" onClick={() => setSlide({ l: lecture.id, n: q.slides[0] })}>
              ש׳ <bdi dir="ltr">{q.slides[0]}</bdi>
            </button>
          ) : null}
        </p>
      ) : null}
      {card(
        key !== null ? { answer: key, explanations: r?.explanations ?? [], takeaway: r?.takeaway ?? "", correct: correct ?? undefined } : null,
        playing ? finalChoice ?? (finalChoice === undefined ? undefined : null) : undefined,
        {
          headline,
          foldWhy: race,
          noDontKnow: true,
          optionExtra: (i) => (r?.trap === i ? <span className="a-chip bad quiz-trap">הטעות הנפוצה בסבב</span> : null),
          onFlag: playing && q ? () => setSheet({ kind: "flag", qid: q.id }) : undefined,
        },
      )}
      {!race && playing && mine1 && mine1.choice !== null && key !== null && !r?.voided ? (
        <section className="a-card flat quiz-private" aria-label="רק לך">
          <div className="a-row between">
            <span className="a-small">
              <b>
                ׳{BET_WORDS[(mine1.bet === 2 || mine1.bet === 3 ? mine1.bet : 1) as Bet]}׳: <bdi dir="ltr">{signed(pts ?? 0)}</bdi>
              </b>{" "}
              · נשמר רק אצלך.
            </span>
            <span className="a-chip">רק לך</span>
          </div>
          {revoted && r?.correct2 && !r?.correct ? <p className="a-muted a-small">בסבב 2: נכון · הבנתי בדיון</p> : null}
        </section>
      ) : null}
      {/* E: a member's trap is named at its reveal (study_quiz__revealed, review SEC-7). */}
      {q && key !== null && !r?.voided ? <TrapChip ctx={ctx} questionId={q.id} chip={false} /> : null}
      {race && playing ? <RaceTable players={state.players} me={me} before={placesBefore} /> : null}
      {!race && !revoted && !source && !r?.voided ? <p className="a-small a-muted">זה הזמן לדבר על השאלה: למה כל תשובה נראתה נכונה, ומה כתוב בשקף.</p> : null}
      {host && !r?.voided && (!race || z.idx === r?.idx) ? (
        <button type="button" className="a-link danger quiz-void" onClick={() => setSheet({ kind: "void" })}>
          ביטול השאלה
        </button>
      ) : null}
      <StickyActions>
        {host ? (
          <button type="button" className="a-btn primary wide" disabled={busy} onClick={() => void act(() => nextRound(quizId, r?.idx ?? z.idx))}>
            {isLast ? "לסיום המבחן" : "לשאלה הבאה"}
          </button>
        ) : (
          <p className="a-btn wide quiz-locked" role="status">
            ממתינים לשאלה הבאה · ניהול: {hostName}
          </p>
        )}
      </StickyActions>
      {sheets}
    </main>
  );
}

/** "קישור לוואטסאפ": the system's share sheet, else the clipboard. */
async function shareLink(title: string, quizId: string, say: (t: string) => void): Promise<void> {
  const url = shareUrl(`?v=quiz&q=${quizId}`);
  const text = `מבחן קבוצתי בתמצית: ${title}. מצטרפים כאן: ${url}`;
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    say("הקישור הועתק.");
  } catch {
    /* the share sheet was closed */
  }
}
