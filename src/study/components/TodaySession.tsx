import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cutQueue, DONE_LINE, ROWS, rowLabel, rowOf, type QueueItem } from "../../../shared/study/today";
import { practiceSize, runOf } from "../../../shared/study/todaySlots";
import { UpdateCard } from "../features/var";
import type { Ctx, UpdateRow } from "../features/types";
import { getLecture, type Lecture } from "../lib/api";
import { lootDone } from "../lib/boss";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { isSetForm, toShownSet } from "../../../shared/study/forms";
import { answerAny } from "../lib/answering";
import { listQuestionsByIds, type Feedback, type PublicQuestion } from "../lib/practice";
import { orderFor, shownOptions, toShown, type Bet } from "../lib/practiceSession";
import { isolateLatin } from "../lib/rich";
import type { Route } from "../lib/route";
import { readMinutes, readPlan, savePlan, unclearDone, type DayPlan, type UnclearRow } from "../lib/today";
import { rowOn, useTodayQueue } from "../lib/useToday";
import PracticeQuestion from "./PracticeQuestion";
import { BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";

const CardReview = lazy(() => import("./CardReview"));
const SlideSheet = lazy(() => import("./SlideSheet"));

/* ── Today's session, ?v=today&run=1 (package T, T-1; spec §12.4.T) ──
 *
 * One session runs the day's cut in its order, each kind through its
 * owner's component: "עדכון" through V's UpdateCard, the quiz returns and
 * the danger row through practice's question (in another wording when it has
 * one; mode "mistakes"), "לא ברור" as the paragraph with "לפסקה" and
 * "הבנתי" (section M's study_unclear_done), the cards through C's review
 * session (the cut's number of cards, then back here), and the other
 * packages' rows (Q-2's mistakes, U's topics, G's lane) through the route
 * each carries. The order is kept for the day in sessionStorage
 * (study-today:<user>:<day>), so Back from the reader returns to the same
 * step. The end: "התור של היום הושלם. מה שנשאר עובר למחר." */

const errText = (e: unknown) => failText(e instanceof Error ? e.message : String(e ?? ""), "today");

/** The top of a step: "→ להיום", "התור שלי", where the session is, the row's reason, "רק לך". */
function Top({ ctx, done, total, chip }: { ctx: Ctx; done: number; total: number; chip?: string }) {
  return (
    <div className="ph-top t-top">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "today" }} />} title="התור שלי">
        <span className="a-chip busy t-progress" aria-label={`${done} מתוך ${total}`}>
          {done}/{total}
        </span>
      </Head>
      <p className="ph-sub">
        {chip ? <span>{chip}</span> : null}
        <span className="a-chip">רק לך</span>
      </p>
      <div className="a-bar" role="progressbar" aria-label="התקדמות" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <i style={{ width: `${total ? (100 * done) / total : 0}%` }} />
      </div>
    </div>
  );
}

/** A quiz return or the danger row: practice's question, asked again (the danger row in its other wording). */
function TodayQuestion({ ctx, item, onDone }: { ctx: Ctx; item: QueueItem; onDone: () => void }) {
  const id = String(item.ref?.ask ?? item.ref?.question ?? "");
  const [q, setQ] = useState<PublicQuestion | null | undefined>(undefined);
  const [order, setOrder] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  /** A set question's answer so far (question types). */
  const [pickedSet, setPickedSet] = useState<Array<number | null>>([]);
  const [bet, setBet] = useState<Bet | null>(null);
  const [chosen, setChosen] = useState<number | number[] | null | undefined>(undefined);
  const [fb, setFb] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [t0] = useState(() => Date.now());
  const [slide, setSlide] = useState<number | null>(null);
  const [lecture, setLecture] = useState<Lecture | null>(null);
  useEffect(() => {
    let alive = true;
    listQuestionsByIds([id])
      .then(([x]) => {
        if (!alive) return;
        // A question that left practice (hidden, retired, marked) is skipped.
        const ok = x && !x.retired_at && !x.hidden_at && !x.stale_at && x.has_key;
        setQ(ok ? x : null);
        if (ok) {
          setOrder(orderFor(x));
          setPickedSet(Array.from({ length: x.layout?.kind === "match" ? x.layout.prompts.length : x.options.length }, () => null));
        }
      })
      .catch(() => alive && setQ(null));
    return () => {
      alive = false;
    };
  }, [id]);
  if (q === undefined) return <Loading />;
  if (q === null)
    return (
      <>
        <p className="a-card flat a-muted">השאלה הזו כבר לא בתרגול.</p>
        <StickyActions>
          <button type="button" className="a-btn primary wide" onClick={onDone}>
            להמשיך
          </button>
        </StickyActions>
      </>
    );
  const set = flags.qtypes && isSetForm(q.form) ? q.form : null;
  const ready = set ? pickedSet.length > 0 && pickedSet.every((v) => v !== null) : picked !== null;
  const check = async (shown: number | number[] | null) => {
    setBusy(true);
    try {
      // Any question type: a set question's choices, or one option (answering.ts).
      const got = await answerAny(q, order, shown, "mistakes", Date.now() - t0, bet);
      setFb(toShown(order, got.feedback, q.form));
      setChosen(Array.isArray(got.choice) && set ? toShownSet(set, order, got.choice) : shown);
    } catch (e) {
      ctx.say(errText(e) || "התשובה לא נשמרה. כדאי לבדוק את החיבור ולנסות שוב.");
    } finally {
      setBusy(false);
    }
  };
  const lectureId = q.lecture_id ?? q.ref_lecture;
  const openSlide = (n: number) => {
    if (!lectureId) return;
    if (lecture) return setSlide(n);
    void getLecture(lectureId)
      .then((l) => {
        if (l) {
          setLecture(l);
          setSlide(n);
        }
      })
      .catch(() => undefined);
  };
  return (
    <>
      {item.kind === "danger" && item.otherWording ? <p className="a-small a-muted t-why">טעית כאן ׳על בטוח׳. עכשיו בניסוח חדש.</p> : null}
      {item.kind === "quiz" && item.ref?.fixed ? <p className="a-small a-muted t-why">במבחן הקבוצתי הבנת בדיון. עכשיו לבד.</p> : null}
      <PracticeQuestion
        q={{ ...q, options: order.length === q.options.length ? shownOptions(q.options, order) : q.options }}
        picked={picked}
        pickedSet={pickedSet}
        onPickSet={(v) => !fb && setPickedSet(v)}
        bet={bet}
        chosen={chosen}
        feedback={fb}
        answeredBet={fb ? bet : null}
        busy={busy}
        nameOf={ctx.nameOf}
        me={ctx.userId}
        onPick={(k) => !fb && setPicked(k)}
        onBet={(b) => !fb && setBet(b)}
        onDontKnow={fb ? undefined : () => void check(null)}
        onSlide={openSlide}
        dangerList={flags.progress}
      />
      <StickyActions>
        {fb ? (
          <button type="button" className="a-btn primary wide" onClick={onDone}>
            להמשיך
          </button>
        ) : (
          <button
            type="button"
            className="a-btn primary wide"
            disabled={busy || !ready || bet === null}
            onClick={() => void check(set ? pickedSet.map((v) => v ?? 0) : picked)}
          >
            לבדוק
          </button>
        )}
      </StickyActions>
      {slide !== null && lecture ? (
        <Suspense fallback={null}>
          <SlideSheet lecture={lecture} slide={slide} go={ctx.go} onClose={() => setSlide(null)} />
        </Suspense>
      ) : null}
    </>
  );
}

/** A "לא ברור" paragraph from the meeting: its words, where it is, "לפסקה" and "הבנתי". */
function TodayUnclear({ ctx, row, onDone }: { ctx: Ctx; row: UnclearRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const done = async () => {
    setBusy(true);
    try {
      await unclearDone(row.tap_id);
      onDone();
    } catch (e) {
      ctx.say(errText(e));
      setBusy(false);
    }
  };
  return (
    <>
      <section className="a-card t-unclear" aria-label="פסקה שסימנת ׳לא ברור׳">
        <div className="a-row between">
          <b>פסקה שסימנת ׳לא ברור׳</b>
          <span className="a-chip group">מהפגישה</span>
        </div>
        <p className="a-para marked" dir="rtl">
          {isolateLatin(row.quote || "פסקה בהרצאה", `uq${row.tap_id}`)}
        </p>
        <p className="a-small a-muted" dir="rtl">
          <bdi>{row.lecture_title}</bdi>
          {row.explained ? " · עצרנו להסביר אותה בפגישה" : ""}
          {row.thread === "answered" ? " · השאלה עליה נענתה" : row.thread === "open" ? " · יש עליה שאלה פתוחה" : ""}
        </p>
        <div className="a-row">
          <RouteLink to={{ v: "lecture", l: row.lecture_id, at: { part: row.part_idx, anchor: row.anchor } }} go={ctx.go} className="a-btn">
            לפסקה
          </RouteLink>
        </div>
      </section>
      <StickyActions>
        <button type="button" className="a-btn primary wide" disabled={busy} onClick={() => void done()}>
          הבנתי
        </button>
      </StickyActions>
    </>
  );
}

/** Another package's row (Q-2's mistakes, U's topic, G's lane): its route, or a plain step.
 *  `run` items of Q-2's row in a row are one session of that many questions. */
function TodayOther({ ctx, item, run = 1, onDone }: { ctx: Ctx; item: QueueItem; run?: number; onDone: () => void }) {
  const given = item.ref?.route as Route | undefined;
  const route: Route | undefined = given && given.v === "practice" && item.kind === "again" ? { ...given, n: practiceSize(run) } : given;
  const row = ROWS[rowOf(item)];
  return (
    <>
      <section className="a-card t-other">
        <div className="a-row between">
          <b dir="rtl">{isolateLatin(item.example || (item.kind === "again" ? rowLabel("again", run) : row?.chip) || "", `to${item.key}`)}</b>
          {row ? <span className={`a-chip${row.tone ? ` ${row.tone}` : ""}`}>{row.chip}</span> : null}
        </div>
      </section>
      <StickyActions>
        <button
          type="button"
          className="a-btn primary wide"
          onClick={() => {
            onDone();
            if (route) ctx.go(route);
          }}
        >
          {route ? "לתרגל" : "להמשיך"}
        </button>
      </StickyActions>
    </>
  );
}

export default function TodaySession({ ctx }: { ctx: Ctx }) {
  const [plan, setPlan] = useState<DayPlan | null>(() => readPlan(ctx.userId));
  // Opened by a link (no plan for today yet): the day's cut at the device's minutes.
  const { items, ready, error } = useTodayQueue(ctx, plan === null);
  useEffect(() => {
    if (plan || !ready) return;
    const minutes = readMinutes();
    const p = { minutes, items: cutQueue(items, minutes, rowOn).items, i: 0 };
    savePlan(ctx.userId, p);
    setPlan(p);
  }, [plan, ready, items, ctx.userId]);

  // The step is saved at once, not in a state updater: a row that opens its
  // route (Q-2's mistakes, U's topic) leaves this screen in the same tap, and
  // an unmounted screen never runs its updaters, so Back would repeat the step.
  const planRef = useRef(plan);
  planRef.current = plan;
  const advance = useCallback(
    (n = 1) => {
      const p = planRef.current;
      if (!p) return;
      const next = { ...p, i: Math.min(p.items.length, p.i + n) };
      planRef.current = next;
      savePlan(ctx.userId, next);
      setPlan(next);
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    },
    [ctx.userId],
  );

  // A row whose flag is off now (a build changed mid-day) is passed.
  const item = plan?.items[plan.i];
  useEffect(() => {
    if (item && (rowOf(item) < 0 || !rowOn(ROWS[rowOf(item)].flag))) advance();
  }, [item, advance]);
  const cardRun = useMemo(() => {
    if (!plan || !item || item.kind !== "card") return 0;
    let n = 0;
    while (plan.items[plan.i + n]?.kind === "card") n++;
    return n;
  }, [plan, item]);

  // Q-2's row: its items in a row are one practice session (r.<group>), passed together.
  const otherRun = plan && item?.kind === "again" ? runOf(plan.items, plan.i) : 1;

  if (!plan)
    return (
      <main className="today t-session">
        <Top ctx={ctx} done={0} total={0} />
        {error ? (
          <p className="a-error" role="alert">
            התור לא נטען. כדאי לבדוק את החיבור ולנסות שוב.
          </p>
        ) : (
          <Loading />
        )}
      </main>
    );

  const total = plan.items.length;
  if (!item)
    return (
      <main className="today t-session">
        <Top ctx={ctx} done={total} total={total} />
        <section className="a-card t-done" role="status">
          <h1 className="a-h1">סיום להיום</h1>
          <p>{DONE_LINE}</p>
          <p className="a-small a-muted">גלוי רק לך.</p>
        </section>
        {flags.questions ? (
          <RouteLink to={{ v: "practice" }} go={ctx.go} className="a-btn ghost t-free">
            תרגול חופשי
          </RouteLink>
        ) : null}
        <StickyActions>
          <RouteLink to={{ v: "today" }} go={ctx.go} className="a-btn primary wide">
            להיום
          </RouteLink>
        </StickyActions>
      </main>
    );

  // The cards: C's review session for the cut's number, then back to the next step.
  if (item.kind === "card")
    return (
      <Suspense fallback={<Loading />}>
        <CardReview key={`run${plan.i}`} scope="today" ctx={ctx} limit={cardRun} onEnd={() => advance(cardRun)} />
      </Suspense>
    );

  const chip = ROWS[rowOf(item)]?.chip;
  return (
    <main className="today t-session" data-kind={item.kind}>
      <Top ctx={ctx} done={plan.i} total={total} chip={chip} />
      {item.kind === "update" ? (
        <>
          {/* V's card holds the step's one action, "הבנתי". */}
          <UpdateCard key={item.key} ctx={ctx} update={item.ref?.update as UpdateRow} onDone={() => advance()} />
        </>
      ) : item.kind === "quiz" || item.kind === "danger" ? (
        <TodayQuestion key={item.key} ctx={ctx} item={item} onDone={() => advance()} />
      ) : item.kind === "loot" ? (
        // H's loot: the question again, alone; answered, it leaves the loot (study_loot_done).
        <TodayQuestion
          key={item.key}
          ctx={ctx}
          item={item}
          onDone={() => {
            const qid = typeof item.ref?.question === "string" ? item.ref.question : "";
            if (qid) void lootDone(qid).catch(() => undefined);
            advance();
          }}
        />
      ) : item.kind === "unclear" ? (
        <TodayUnclear key={item.key} ctx={ctx} row={item.ref?.unclear as UnclearRow} onDone={() => advance()} />
      ) : (
        <TodayOther key={item.key} ctx={ctx} item={item} run={otherRun} onDone={() => advance(otherRun)} />
      )}
    </main>
  );
}
