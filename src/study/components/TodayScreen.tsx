import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { studyDay } from "../../../shared/study/day";
import {
  cutQueue,
  dayTitle,
  EMPTY_LINE,
  flameChip,
  flameLine,
  flameLit,
  groupQuestion,
  MINUTES,
  minutesOf,
  rowLines,
  type Minutes,
} from "../../../shared/study/today";
import { MeetingBand } from "../features/meeting";
import { QuizBannerLine } from "../features/quiz";
import { GuideHome, guideOfferFirst } from "../features/guide";
import { AccountBanners } from "../features/account";
import { InstallHomeCard } from "../features/install";
import { EveCard } from "../features/plan";
import { NeedsMeCard } from "../features/today";
import type { Ctx, ScreenProps } from "../features/types";
import { flags } from "../lib/flags";
import { isolateLatin } from "../lib/rich";
import { readMinutes, saveMinutes, savePlan } from "../lib/today";
import { rowOn, useTodayQueue } from "../lib/useToday";
import { Icon } from "./Icon";
import { Avatar, Head, Loading, RouteLink } from "./Shell";
import { timeAgo } from "./Together";

/** Notifications' first-launch card (section R; lazy, nothing without VITE_STUDY_NOTIFY). */
const NotifyHome = lazy(() => import("./NotifyParts").then((m) => ({ default: m.NotifyHomeCard })));
import TodaySession from "./TodaySession";
import "../styles/today.css";
import ErrorBoundary from "./ErrorBoundary";

/* ── Today, "היום" (package T, T-1; today.html s1, spec §12.4.T) ──
 *
 * The home screen once VITE_STUDY_TODAY is on: "היום · יום ג׳"; the day's
 * meeting (M's band); a meeting this member missed with its catch-up
 * ("פגישה שפספסת · …", "השלמה · {n} דק׳", M-2); "התור שלי" with "רק לך",
 * the minute chips 10 · 20 · 45 (per device), the cut's rows grouped with
 * their chips and an example, "להתחיל · {n} דק׳" and the flame ("ימי למידה 4/7",
 * its line on a tap); "בקבוצה": the newest open question that is not hers;
 * T-2's "הקבוצה צריכה אותך" (opt-in; its meter when nothing waits) and,
 * from two days before the plan's exam, the exam-eve view's card (package
 * G's EveCard); and "תרגול חופשי" (with practice sets, the card "תרגול":
 * "תרגול מהבנק" and "סט חדש"). The queue is one table
 * (shared/study/today.ts): each row waits for its own flag, so the screen
 * opens with whatever this build has (decision 1 of 17 Nov 2026: no
 * account). Everything on it is hers alone, except the meeting and the
 * group's question. ?v=today&run=1 is the session (TodaySession). */

/** "למשל …" before a card's front (today.html s1); the others show their line as is. */
function Example({ kind, text, slides, k }: { kind: string; text?: string; slides?: number[]; k: string }) {
  if (!text) return null;
  const tag = slides?.length ? `ש׳ ${[...new Set(slides)].sort((a, b) => a - b).slice(0, 3).join(",")}` : "";
  return (
    <span className="m" dir="rtl">
      {kind === "card" ? "למשל " : ""}
      {isolateLatin(text.length > 140 ? `${text.slice(0, 139)}…` : text, k)}
      {tag ? (
        <>
          {" "}
          <span className="a-tag">{tag}</span>
        </>
      ) : null}
    </span>
  );
}

/** Practice sets on Today (flags.sets, design §5.1, WP14), from one short
 *  read of the group's shelf (its 6 newest), loaded lazily with its words so
 *  this screen's chunk holds none of the sets' code: the one row "סטים
 *  חדשים בקבוצה (n)" while someone else's sets are unopened, the free
 *  primary "לפתור סט חדש" on an empty queue (the newest ready set the member
 *  has not solved), and a row for each of the member's own sets paused in
 *  the middle ("הסט … נעצר באמצע · להמשיך ליצור"). Nothing offline. */
type TodaySets = { fresh: string | null; solve: { id: string; label: string } | null; resume: Array<{ id: string; label: string }> };
function useTodaySets(ctx: Ctx): TodaySets | null {
  const [t, setT] = useState<TodaySets | null>(null);
  const groupId = ctx.group.id;
  useEffect(() => {
    if (!flags.sets) return;
    let alive = true;
    Promise.all([import("../lib/sets"), import("../lib/setsCopy")])
      .then(async ([S, C]) => {
        const e = S.entriesOf(await S.shelf(groupId, undefined, 6));
        if (!alive) return;
        setT({
          fresh: e.fresh.length ? C.todayRow(e.fresh.length) : null,
          solve: e.solve ? { id: e.solve.id, label: C.SETS.today.solveNew } : null,
          resume: e.resume.map((r) => ({ id: r.id, label: C.genResumeMine(r.lecture_title || r.title) })),
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId]);
  return t;
}

/** "לפתור סט חדש": the set's session straight away, as a set's card starts it. */
function solveSet(ctx: Ctx, setId: string) {
  const r = { v: "practice" as const, s: `k.${setId}` };
  void import("../lib/practiceSession")
    .then((m) => m.requestStart(ctx.userId, r, false))
    .catch(() => undefined)
    .finally(() => ctx.go(r));
}

/** Practice sets (flags.make, design §5.1): the card "תרגול" in place of the
 *  ghost "תרגול חופשי". With an empty queue the free primary is the bar's
 *  "תרגול מהבנק" (the hub's lectures), or "לפתור סט חדש" when a new set
 *  waits (flags.sets; the bank is then a link here), and the card holds
 *  "סט חדש"; with a queue the card is quiet links, so the queue keeps the
 *  screen's one primary. "סט חדש" opens on the last lecture read (x=new
 *  without a lecture). With flags.sets the card also has "סטים חדשים בקבוצה
 *  (n) ‹" while someone else's sets are unopened. */
function PracticeCard({ ctx, queue, sets }: { ctx: Ctx; queue: boolean; sets: TodaySets | null }) {
  const fresh = sets?.fresh ? (
    <RouteLink to={{ v: "sets" }} go={ctx.go} className="a-link t-sets-new">
      {sets.fresh} ‹
    </RouteLink>
  ) : null;
  return (
    <section className="a-card flat t-practice" aria-labelledby="t-practice-h">
      <h2 id="t-practice-h" className="a-h2">
        תרגול
      </h2>
      {queue ? (
        <div className="a-row t-practice-go">
          <RouteLink to={{ v: "practice", x: "new" }} go={ctx.go} className="a-link t-make">
            סט חדש ‹
          </RouteLink>
          <RouteLink to={{ v: "practice" }} go={ctx.go} className="a-link t-free">
            תרגול מהבנק ‹
          </RouteLink>
          {fresh}
        </div>
      ) : (
        <>
          <p className="a-small a-muted">שאלות חדשות על הרצאה, נבדקות לפני הבנק</p>
          <div className="a-row t-practice-go">
            <RouteLink to={{ v: "practice", x: "new" }} go={ctx.go} className="a-btn t-make">
              סט חדש
            </RouteLink>
            {sets?.solve ? (
              <RouteLink to={{ v: "practice" }} go={ctx.go} className="a-link t-free">
                תרגול מהבנק ‹
              </RouteLink>
            ) : null}
          </div>
          {fresh ? <div className="a-row t-practice-go">{fresh}</div> : null}
        </>
      )}
    </section>
  );
}

function TodayHome({ ctx }: { ctx: Ctx }) {
  const { data, items, ready, error, reload } = useTodayQueue(ctx);
  const [minutes, setMinutes] = useState<Minutes>(() => readMinutes());
  const [flameOpen, setFlameOpen] = useState(false);
  // Where the guide's card goes, decided once per visit (the offer, once answered, stays put).
  const [offerBelow] = useState(() => guideOfferFirst(ctx));
  const [catchupMin, setCatchupMin] = useState<number | null>(null);
  const day = studyDay(Date.now());
  const cut = useMemo(() => cutQueue(items, minutes, rowOn), [items, minutes]);
  const lines = useMemo(() => rowLines(cut.items), [cut]);
  const missed = flags.guess ? (data?.missed ?? [])[0] : undefined;

  // The missed meeting's catch-up minutes (M's pack: only what the group made in it).
  useEffect(() => {
    if (!missed) return;
    let alive = true;
    void import("../lib/meeting")
      .then((m) => m.catchupOf(missed.meeting_id))
      .then((p) => alive && setCatchupMin(p.minutes))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [missed?.meeting_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (m: Minutes) => {
    setMinutes(m);
    saveMinutes(m);
  };
  const start = useCallback(() => {
    // The day's order is kept for the session (study-today:<user>:<day>).
    savePlan(ctx.userId, { minutes, items: cut.items, i: 0 });
    ctx.go({ v: "today", run: true });
  }, [ctx, minutes, cut.items]);

  const sets = useTodaySets(ctx);
  const q = groupQuestion(data?.open_question, data?.needs_me, flags.needsMe);
  const flame = data?.flame;
  return (
    <main className="today">
      <Head title={dayTitle(day)} />
      <MeetingBand ctx={ctx} compact />
      {/* The live banner is hidden on Today (§12.2.1); its quiz line is Today's own. */}
      <div className="a-card flat t-live" role="status" aria-live="polite">
        <QuizBannerLine ctx={ctx} route={{ v: "today" }} />
      </div>
      {missed ? (
        <RouteLink to={{ v: "catchup", m: missed.meeting_id }} go={ctx.go} className="a-card flat t-missed">
          <span className="a-row between">
            <b dir="rtl">פגישה שפספסת · {isolateLatin(missed.title ? `${missed.lecture_title}: ${missed.title}` : missed.lecture_title, "tm")}</b>
            <span className="a-chip">רק לך</span>
          </span>
          <span className="a-btn small t-catchup">{catchupMin ? `השלמה · ${catchupMin} דק׳` : "השלמה"}</span>
        </RouteLink>
      ) : null}
      {/* The guide's first steps (VITE_STUDY_GUIDE), before "התור שלי"; the tour's offer goes under the queue. */}
      {flags.guide && !offerBelow ? <GuideHome ctx={ctx} home="today" queue={ready ? cut.items.length : null} /> : null}
      {/* The personal code: the opener's notice, or the prompt for a member without one (the home is where everyone looks). */}
      <AccountBanners ctx={ctx} />
      {/* Adding the app to the home screen (VITE_STUDY_INSTALL): once, while the guide's card is not here. */}
      <InstallHomeCard ctx={ctx} />
      {/* Notifications: opened from the icon for the first time, once (the guide's card says it itself when it holds the home). */}
      {flags.notify ? (
        <ErrorBoundary reset="notify" fallback="none">
          <Suspense fallback={null}>
            <NotifyHome ctx={ctx} />
          </Suspense>
        </ErrorBoundary>
      ) : null}

      <div className="a-sec t-sec">
        <span className="a-row">
          <h2 className="a-h2">התור שלי</h2>
          <span className="a-chip">רק לך</span>
        </span>
        <span className="a-row t-minutes" role="group" aria-label="כמה זמן יש">
          {MINUTES.map((m) => (
            <button key={m} type="button" className={`a-chip${m === minutes ? " busy" : ""}`} aria-pressed={m === minutes} aria-label={`${m} דקות`} onClick={() => choose(m)}>
              {m === minutes ? `${m} דק׳` : m}
            </button>
          ))}
        </span>
      </div>

      {error && !data ? (
        <div className="a-card flat t-error">
          <p className="a-error" role="alert">
            התור לא נטען. כדאי לבדוק את החיבור ולנסות שוב.
          </p>
          <button type="button" className="a-btn small" onClick={reload}>
            לנסות שוב
          </button>
        </div>
      ) : !ready ? (
        <Loading />
      ) : lines.length ? (
        <ul className="a-list t-queue">
          {lines.map((l) => (
            <li key={l.keys[0]} className="a-li t-row" data-kind={l.kind}>
              <div className="t-row-body">
                <span className="a-row between">
                  <b dir="rtl">{isolateLatin(l.label, `tl${l.keys[0]}`)}</b>
                  <span className={`a-chip${l.tone ? ` ${l.tone}` : ""}`}>{l.chip}</span>
                </span>
                <Example kind={l.kind} text={l.example} slides={l.slides} k={`te${l.keys[0]}`} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="a-card flat a-muted t-empty">{EMPTY_LINE}</p>
      )}

      <div className="a-row t-start">
        {ready && cut.items.length ? (
          <button type="button" className="a-btn primary wide" onClick={start}>
            להתחיל · {minutesOf(cut.seconds)} דק׳
          </button>
        ) : ready && sets?.solve ? (
          <button type="button" className="a-btn primary wide t-solve-set" onClick={() => solveSet(ctx, sets.solve!.id)}>
            {sets.solve.label}
          </button>
        ) : ready && flags.questions ? (
          <RouteLink to={{ v: "practice" }} go={ctx.go} className="a-btn primary wide t-free">
            {flags.make ? "תרגול מהבנק" : "תרגול חופשי"}
          </RouteLink>
        ) : null}
        {flame ? (
          <button
            type="button"
            className={`a-btn ghost t-flame${flameLit(flame.days) ? " lit" : ""}`}
            aria-expanded={flameOpen}
            aria-controls="t-flame-line"
            onClick={() => setFlameOpen((o) => !o)}
          >
            <Icon name="bolt" size={14} />
            {flameChip(flame.days)}
          </button>
        ) : null}
      </div>
      {flame && flameOpen ? (
        <p id="t-flame-line" className="a-small a-muted t-flame-line">
          {flameLine(flame.days)}
        </p>
      ) : null}
      {/* The member's own sets paused in the middle (flags.sets): back to them in one tap. */}
      {sets?.resume.map((r) => (
        <RouteLink key={r.id} to={{ v: "sets", k: r.id }} go={ctx.go} className="a-card flat t-resume">
          {r.label} ‹
        </RouteLink>
      ))}
      {ready && !cut.items.length && flags.make ? <PracticeCard ctx={ctx} queue={false} sets={sets} /> : null}
      {flags.guide && offerBelow ? <GuideHome ctx={ctx} home="today" queue={ready ? cut.items.length : null} /> : null}

      {q ? (
        <section className="a-card flat t-group" aria-label="בקבוצה">
          <div className="a-row between">
            <span className="a-row">
              <Avatar id={q.author_id} name={ctx.nameOf(q.author_id) || "?"} />
              <span className="a-small">
                <b>שאלה פתוחה</b> · {ctx.nameOf(q.author_id) || "ללא שם"}, {timeAgo(q.created_at)}
              </span>
            </span>
            <RouteLink to={{ v: "lecture", l: q.lecture_id, at: { part: q.part, anchor: q.anchor } }} go={ctx.go} className="a-btn small">
              לענות
            </RouteLink>
          </div>
          <p className="a-small" dir="rtl">
            {isolateLatin(q.body, `tq${q.id}`)} <bdi className="a-small a-muted">· {q.lecture_title}</bdi>
          </p>
        </section>
      ) : null}

      <NeedsMeCard ctx={ctx} rows={data?.needs_me ?? []} />
      <EveCard ctx={ctx} />

      {cut.items.length && flags.make ? (
        <PracticeCard ctx={ctx} queue sets={sets} />
      ) : cut.items.length && flags.questions ? (
        <RouteLink to={{ v: "practice" }} go={ctx.go} className="a-btn ghost t-free">
          תרגול חופשי
        </RouteLink>
      ) : null}
    </main>
  );
}

export default function TodayScreen({ route, ctx }: ScreenProps<"today">) {
  return route.run ? <TodaySession ctx={ctx} /> : <TodayHome ctx={ctx} />;
}
