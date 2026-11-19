import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  byTopic,
  clockText,
  clockWords,
  examStatus,
  gridCells,
  letter,
  LETTERS,
  listQuestionsAll,
  mockAnswer,
  mockFinish,
  mockGet,
  mockProgress,
  picked,
  rememberAttempt,
  remainingMs,
  scoreLines,
  submitLine,
  usedLine,
  wrongLine,
  type MockAttempt,
  type MockScore,
  type MockScoreItem,
} from "../lib/exams";
import { failText } from "../lib/failText";
import type { PublicQuestion } from "../lib/practice";
import { richText } from "../lib/rich";
import type { ScreenProps } from "../features/types";
import { PageCrop } from "./ExamParts";
import { BackLink, Head, Loading, RouteLink, Sheet, StickyActions } from "./Shell";
import "../styles/exams.css";

const TfAnswer = lazy(() => import("./QuestionTypes").then((m) => ({ default: m.TfAnswer })));
const MatchAnswer = lazy(() => import("./QuestionTypes").then((m) => ({ default: m.MatchAnswer })));

/* ── A simulation running, and its result (sources.md B5, B7, B11 phase 2;
 *    mockups sim-running.html, sim-grid.html, sim-result.html) ──
 *
 * ?v=practice&s=x.<attempt>. One clock for the whole simulation ("נשארו
 * 1:42:10"), counted from the attempt's deadline on the server against the
 * server's own now, so a phone locked for 5 minutes comes back to the same
 * deadline (the screen asks again whenever it is shown). "שאלה 37 מתוך
 * 100", "לסמן לחזרה", the options in the exam's own order and no feedback: a
 * pick is kept on the server (it can change until the end) and nothing says
 * whether it was right. "מפת השאלות" shows every question (answered, to come
 * back to, empty) and "להגיש עכשיו? נשארו 6 שאלות בלי תשובה". At zero the
 * simulation is submitted by itself (and by the server on the next load if
 * the phone was away). The result: "71 מתוך 97", the suggested answers and
 * the ones not counted, by topic when the items have topics, the mistakes,
 * "רק הטעויות" (a practice session of them, w.<attempt>) and "סימולציה חדשה". */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

export default function MockRun({ ctx, attemptId }: { ctx: ScreenProps<"practice">["ctx"]; attemptId: string }) {
  const [a, setA] = useState<MockAttempt | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [qs, setQs] = useState<Record<string, PublicQuestion>>({});
  const [pos, setPos] = useState(0);
  const [flagged, setFlagged] = useState<number[]>([]);
  const [picks, setPicks] = useState<MockAttempt["picks"]>({});
  const [partial, setPartial] = useState<Record<string, Array<number | null>>>({});
  const [grid, setGrid] = useState(false);
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [title, setTitle] = useState("");
  const [, setTick] = useState(0);
  const shownAt = useRef(Date.now());
  const ended = useRef(false);

  /** The attempt as the server has it (a past deadline is submitted there first). */
  const load = useCallback(async () => {
    try {
      const x = await mockGet(attemptId);
      setA(x);
      setFetchedAt(Date.now());
      setFlagged(x.flagged);
      setPicks(x.picks);
      if (x.finished_at) rememberAttempt(ctx.userId, null);
      else rememberAttempt(ctx.userId, x.attempt);
      return x;
    } catch (e) {
      setError(failText(codeOf(e), "exam") || "הסימולציה לא נטענה. כדאי לבדוק את החיבור.");
      return null;
    }
  }, [attemptId, ctx.userId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const x = await load();
      if (!x || !alive) return;
      setPos(Math.min(x.position, x.question_ids.length - 1));
      const rows = await listQuestionsAll(x.question_ids).catch(() => [] as PublicQuestion[]);
      if (alive) setQs(Object.fromEntries(rows.map((q) => [q.id, q])));
      if (x.exam_id) void examStatus(x.exam_id).then((s) => alive && setTitle(s.title)).catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  // Back on screen (the phone was locked, the tab hidden): the server's clock and picks again.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
    };
  }, [load]);

  const running = Boolean(a && !a.finished_at);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const left = a && running ? remainingMs({ deadline: a.deadline, serverNow: a.now, fetchedAt, now: Date.now() }) : 0;

  const finish = useCallback(
    async (auto: boolean) => {
      if (ended.current) return;
      ended.current = true;
      setFinishing(true);
      setGrid(false);
      try {
        await mockFinish(attemptId);
        await load();
        rememberAttempt(ctx.userId, null);
        if (auto) ctx.say("הזמן נגמר, והסימולציה הוגשה.");
        window.scrollTo({ top: 0 });
      } catch (e) {
        ended.current = false;
        ctx.say(failText(codeOf(e), "exam") || "ההגשה לא עברה. כדאי לבדוק את החיבור ולנסות שוב.");
      } finally {
        setFinishing(false);
      }
    },
    [attemptId, load, ctx],
  );
  // The clock at zero: submitted by itself.
  useEffect(() => {
    if (running && fetchedAt && left <= 0) void finish(true);
  }, [running, left, fetchedAt, finish]);

  // Where the student is and what is flagged, kept on the server (a second phone, a reload).
  const saveProgress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keep = useCallback(
    (p: number, f: number[]) => {
      clearTimeout(saveProgress.current);
      saveProgress.current = setTimeout(() => {
        mockProgress(attemptId, p, f)
          .then((ok) => {
            if (!ok) void load();
          })
          .catch(() => undefined);
      }, 300);
    },
    [attemptId, load],
  );
  const goTo = (p: number) => {
    if (!a) return;
    const n = Math.max(0, Math.min(a.question_ids.length - 1, p));
    setPos(n);
    shownAt.current = Date.now();
    keep(n, flagged);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };
  const toggleFlag = () => {
    const f = flagged.includes(pos) ? flagged.filter((x) => x !== pos) : [...flagged, pos].sort((x, y) => x - y);
    setFlagged(f);
    keep(pos, f);
  };
  const send = (qid: string, choice: number | null, choices: number[] | null) => {
    setPicks((m) => {
      const out = { ...m };
      if (choice === null && choices === null) delete out[qid];
      else out[qid] = choice !== null ? { c: choice } : { cs: choices ?? [] };
      return out;
    });
    mockAnswer(attemptId, qid, choice, choices, Math.max(0, Math.round(Date.now() - shownAt.current)))
      .then((ok) => {
        if (!ok) void load(); // the time is up: the server submitted it
      })
      .catch(() => ctx.say("הבחירה לא נשמרה. כדאי לבדוק את החיבור ולבחור שוב."));
  };

  if (error && !a)
    return (
      <main className="practice-session">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "library" }} />} title="סימולציה" />
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!a) return <Loading />;
  if (a.finished_at && a.score) return <MockResult ctx={ctx} a={a} score={a.score} qs={qs} title={title} />;
  if (a.finished_at || finishing) return <Loading />;

  const total = a.question_ids.length;
  const qid = a.question_ids[pos];
  const q = qs[qid];
  const cells = gridCells({ question_ids: a.question_ids, picks, flagged });
  const answered = cells.filter((c) => c.answered).length;
  const empty = total - answered;
  const isFlagged = flagged.includes(pos);
  const back = <BackLink go={ctx.go} fallback={a.course_id ? { v: "course", c: a.course_id } : { v: "library" }} label="→ יציאה" />;
  const low = left <= 5 * 60_000;

  return (
    <main className="practice-session sim-run">
      <Head back={back} title="סימולציה">
        <span className={`a-chip m-clock${low ? " warn" : ""}`} role="timer" aria-label={clockWords(left)}>
          נשארו{" "}
          <bdi dir="ltr" className="m-time">
            {clockText(left)}
          </bdi>
        </span>
      </Head>
      <div className="a-bar" role="progressbar" aria-label="שאלות שענית" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
        <i style={{ width: `${Math.round((100 * answered) / Math.max(1, total))}%` }} />
      </div>
      <div className="m-meta">
        <span className="m-pos" aria-live="polite">
          שאלה {pos + 1} מתוך {total}
        </span>
        <button type="button" className="a-btn small m-flag" aria-pressed={isFlagged} onClick={toggleFlag}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          <span>{isFlagged ? "מסומנת לחזרה" : "לסמן לחזרה"}</span>
        </button>
      </div>
      {q ? (
        <MockQuestion
          key={qid}
          q={q}
          groupId={ctx.group.id}
          pick={picks[qid]}
          partial={partial[qid]}
          onPick={(i) => send(qid, picks[qid]?.c === i ? null : i, null)}
          onSet={(v) => {
            setPartial((m) => ({ ...m, [qid]: v }));
            if (v.every((x) => x !== null)) send(qid, null, v as number[]);
          }}
        />
      ) : (
        <Loading />
      )}
      <StickyActions>
        <button type="button" className="a-btn" onClick={() => setGrid(true)}>
          מפת השאלות
        </button>
        {pos > 0 ? (
          <button type="button" className="a-btn icon m-prev" aria-label="לשאלה הקודמת" onClick={() => goTo(pos - 1)}>
            →
          </button>
        ) : null}
        {pos < total - 1 ? (
          <button type="button" className="a-btn primary wide m-next" onClick={() => goTo(pos + 1)}>
            לשאלה הבאה
          </button>
        ) : (
          <button type="button" className="a-btn primary wide" onClick={() => setGrid(true)}>
            להגיש
          </button>
        )}
      </StickyActions>
      {grid ? (
        <Sheet label="מפת השאלות" className="m-sheet" head={<h2>מפת השאלות</h2>} onClose={() => setGrid(false)}>
          {(sheet) => (
            <>
              <div className="m-legend">
                <span>
                  <i aria-hidden="true" />
                  ענית ({answered})
                </span>
                <span>
                  <i className="f" aria-hidden="true" />
                  לחזרה ({flagged.length})
                </span>
                <span>
                  <i className="e" aria-hidden="true" />
                  בלי תשובה ({empty})
                </span>
              </div>
              <ol className="m-grid" aria-label="השאלות">
                {cells.map((c) => (
                  <li key={c.i}>
                    <button
                      type="button"
                      className={[c.answered ? "" : "e", c.flagged ? "f" : "", c.i === pos ? "now" : ""].filter(Boolean).join(" ")}
                      aria-label={`שאלה ${c.i + 1}${c.answered ? " · ענית" : " · בלי תשובה"}${c.flagged ? " · לחזרה" : ""}`}
                      aria-current={c.i === pos ? "true" : undefined}
                      onClick={() => {
                        goTo(c.i);
                        sheet.close();
                      }}
                    >
                      {c.i + 1}
                    </button>
                  </li>
                ))}
              </ol>
              <section className="a-callout warn m-submit">
                <b>{submitLine(empty)}</b>
                <div className="a-row">
                  <button type="button" className="a-btn primary small" disabled={finishing} onClick={() => void finish(false)}>
                    להגיש
                  </button>
                  {empty ? (
                    <button
                      type="button"
                      className="a-btn small"
                      onClick={() => {
                        const first = cells.find((c) => !c.answered);
                        if (first) goTo(first.i);
                        sheet.close();
                      }}
                    >
                      לשאלות בלי תשובה
                    </button>
                  ) : null}
                </div>
              </section>
            </>
          )}
        </Sheet>
      ) : null}
    </main>
  );
}

/** One question of a simulation: the exam's own order, no feedback. */
function MockQuestion(p: {
  q: PublicQuestion;
  groupId: string;
  pick: { c?: number; cs?: number[] } | undefined;
  partial: Array<number | null> | undefined;
  onPick: (i: number) => void;
  onSet: (v: Array<number | null>) => void;
}) {
  const { q } = p;
  const form = q.form ?? "one";
  const prompts = q.layout?.kind === "match" ? q.layout.prompts : undefined;
  const slots = form === "match" ? (prompts?.length ?? 0) : q.options.length;
  const setValue = p.partial ?? (p.pick?.cs ? p.pick.cs : Array.from({ length: slots }, () => null));
  return (
    <article className="pq" aria-labelledby={`mq-${q.id}`}>
      {q.vignette.trim() ? (
        <p className="a-para pq-vignette" dir="rtl">
          {richText(q.vignette, "v")}
        </p>
      ) : null}
      <p className="a-q pq-lead" id={`mq-${q.id}`} dir="rtl">
        {richText(q.question, "l")}
      </p>
      {q.figure && q.exam_id ? <PageCrop groupId={p.groupId} examId={q.exam_id} figure={q.figure} /> : null}
      {form === "tf" || form === "match" ? (
        <Suspense fallback={<p className="a-small a-muted">רגע…</p>}>
          {form === "tf" ? (
            <TfAnswer qid={q.id} options={q.options} value={setValue} onChange={p.onSet} />
          ) : (
            <MatchAnswer qid={q.id} options={q.options} prompts={prompts} value={setValue} onChange={p.onSet} />
          )}
        </Suspense>
      ) : (
        <div className="a-opts pq-options" role="radiogroup" aria-labelledby={`mq-${q.id}`}>
          {q.options.map((o, i) => {
            const on = p.pick?.c === i;
            return (
              <button key={i} type="button" className={`a-opt${on ? " picked" : ""}`} role="radio" aria-checked={on} onClick={() => p.onPick(i)}>
                <span className="l">{LETTERS[i]}</span>
                <span className="pq-text" dir="rtl">
                  {richText(o, `o${i}-`)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {picked(p.pick) ? <p className="a-small a-muted m-kept">הבחירה נשמרה. אפשר לשנות עד ההגשה.</p> : null}
    </article>
  );
}

/** The result (mockup sim-result.html). */
function MockResult({ ctx, a, score, qs, title }: { ctx: ScreenProps<"practice">["ctx"]; a: MockAttempt; score: MockScore; qs: Record<string, PublicQuestion>; title: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const lines = scoreLines(score);
  const topics = useMemo(() => byTopic(score.items), [score.items]);
  const wrong = score.items.filter((it) => it.counted && !it.correct);
  const notCounted = score.items.filter((it) => !it.counted);
  const back = <BackLink go={ctx.go} fallback={a.course_id ? { v: "course", c: a.course_id } : { v: "library" }} />;
  const row = (it: MockScoreItem, line: string) => {
    const q = qs[it.id];
    const expanded = open === it.id;
    return (
      <li key={it.id} className="e-row">
        <button type="button" className="a-li" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : it.id)}>
          <div>
            {/* Its place in this simulation, as the running screen said it ("שאלה 5 מתוך 20"); the exam's own number beside. */}
            <b>שאלה {it.pos}</b>
            <span className="m">{it.no && it.no !== it.pos ? `${line} · שאלה ${it.no} במבחן` : line}</span>
          </div>
        </button>
        {expanded && q ? (
          <div className="a-card flat e-item">
            {q.vignette.trim() ? (
              <p className="a-para" dir="rtl">
                {richText(q.vignette, "v")}
              </p>
            ) : null}
            <p className="a-para" dir="rtl">
              {richText(q.question, "q")}
            </p>
            {it.form === "one" ? (
              <ol className="a-opts r-opts">
                {q.options.map((o, i) => (
                  <li key={i} className={`a-opt${i === it.answer ? " correct" : i === it.choice ? " wrong" : ""}`}>
                    <span className="l">{LETTERS[i]}</span>
                    <span dir="rtl">
                      {richText(o, `o${i}`)}
                      {i === it.answer ? " · ✓ הנכונה" : i === it.choice ? " · ✗ הבחירה שלך" : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            {it.origin === "solved" ? <span className="a-chip warn">תשובה מוצעת · לא נבדקה</span> : null}
          </div>
        ) : null}
      </li>
    );
  };
  return (
    <main className="practice-session is-end sim-result">
      <Head back={back} title="סימולציה">
        <span className="a-chip">רק לך</span>
      </Head>
      {/* The exam's name on a line of its own: beside the title it wraps on a 320 px phone. */}
      {title ? (
        <p className="ph-sub">
          <span>
            <bdi>{title}</bdi>
          </span>
        </p>
      ) : null}
      <section className="e-score" aria-labelledby="e-score-h">
        <div className="big" id="e-score-h">
          <b>{lines.big}</b>
          <span>נכונות</span>
        </div>
        {lines.note ? <span className="a-small">{lines.note}</span> : null}
        <span className="a-small a-muted">{[score.auto ? "הוגשה כשהזמן נגמר" : "", usedLine(a.started_at, a.finished_at, a.minutes)].filter(Boolean).join(" · ")}</span>
      </section>
      {topics.length ? (
        <>
          <div className="a-sec">
            <h2>לפי נושאים</h2>
          </div>
          <section className="a-card e-topics">
            {topics.map((t) => (
              <div key={t.topic} className="e-t">
                <div className="top">
                  <b>
                    <bdi>{t.topic}</bdi>
                  </b>
                  <span>
                    <bdi dir="ltr">
                      {t.right}/{t.of}
                    </bdi>
                  </span>
                </div>
                <div className="a-bar" aria-hidden="true">
                  <i style={{ width: `${Math.round((100 * t.right) / t.of)}%` }} />
                </div>
                <span className="m">
                  {t.right} מתוך {t.of}
                </span>
              </div>
            ))}
          </section>
        </>
      ) : null}
      {wrong.length ? (
        <>
          <div className="a-sec">
            <h2>הטעויות ({wrong.length})</h2>
          </div>
          <ul className="a-list e-wrong">{wrong.map((it) => row(it, wrongLine(it)))}</ul>
        </>
      ) : (
        <p className="a-para">אין טעויות בשאלות שנספרו.</p>
      )}
      {notCounted.length ? (
        <>
          <div className="a-sec">
            <h2>לא נספרו ({notCounted.length})</h2>
          </div>
          <p className="a-small a-muted">לשאלות האלה אין תשובה בטוחה, אז הן לא בציון.</p>
          <ul className="a-list e-uncounted">{notCounted.map((it) => row(it, it.choice !== null ? `בחרת ${letter(it.choice)}` : "לא ענית"))}</ul>
        </>
      ) : null}
      <StickyActions>
        {a.course_id ? (
          <RouteLink to={{ v: "mock", c: a.course_id, ...(a.exam_id ? { e: a.exam_id } : {}) }} go={ctx.go} className="a-btn">
            סימולציה חדשה
          </RouteLink>
        ) : null}
        {wrong.length ? (
          <RouteLink to={{ v: "practice", s: `w.${a.attempt}`, n: "all" }} go={ctx.go} className="a-btn primary wide">
            רק הטעויות
          </RouteLink>
        ) : null}
      </StickyActions>
    </main>
  );
}
