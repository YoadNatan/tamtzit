import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ScreenProps } from "../features/types";
import { getLecture, groupSpent, health, listLectures, type LectureRow } from "../lib/api";
import { failText } from "../lib/failText";
import { estimateCents, generateRound, roundSize, usd } from "../lib/practiceGenerate";
import { createQuiz, MODE_NAME, openQuiz, quizCounts, quizErrorText, quizPool, quizRecord, type Kinds, type Mode, type PoolRow } from "../lib/quiz";
import { isolateLatin } from "../lib/rich";
import type { Route } from "../lib/route";
import { Icon } from "./Icon";
import { BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";
import { flags } from "../lib/flags";

/** "להודיע לקבוצה" (notifications, section R; lazy, nothing without VITE_STUDY_NOTIFY). */
const NotifyQuizBox = lazy(() => import("./NotifyParts").then((m) => ({ default: m.NotifyQuizBox })));

/* ── "מבחן קבוצתי חדש" (package Z; design-quiz §1.3 S, the approved lobby's
 * modes, spec §5.5 and §12.3.Z) ──
 *
 * The mode first, "כולנו נגד המבחן" by default (decision 2) with the group's
 * record, or "מירוץ"; the lectures by course with their ready questions
 * (study_quiz_pool), "כל הקורס"; how many, how long, which kinds; the
 * summary line and who sees what. "פתיחת המבחן" opens the lobby with this
 * phone as its host. The quiz costs nothing: its questions are written
 * already.
 *
 * A lecture without enough questions (review UX-5): with one lecture chosen
 * and fewer than 5 of its questions ready, the primary action is "ליצור
 * שאלות ולפתוח את המבחן" with practice's estimate line. It opens the lobby
 * at once, and this phone writes the lecture's round as practice does
 * (package Q's round, through F1's rounds.ts: it goes on when the screen
 * changes); the lobby starts when 5 are ready. The setup's last choices stay
 * on this device (study-quiz-setup). */

const COUNTS = [5, 10, 15, 20];
const SECONDS = [20, 30, 45, 60, 90];
const KINDS: Array<{ k: Kinds; label: string }> = [
  { k: "all", label: "הכול" },
  { k: "mcq", label: "רק אמריקאיות" },
  { k: "case", label: "רק מקרים קליניים" },
];
const STORE = "study-quiz-setup";
type Choice = { mode: Mode; count: number; seconds: number; kinds: Kinds };
const DEFAULTS: Record<"coop" | "race", Choice> = {
  coop: { mode: "coop", count: 10, seconds: 60, kinds: "all" },
  race: { mode: "race", count: 10, seconds: 30, kinds: "all" },
};

function loadChoice(): Choice {
  try {
    const c = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<Choice> | null;
    if (c && (c.mode === "coop" || c.mode === "race") && COUNTS.includes(Number(c.count)) && SECONDS.includes(Number(c.seconds)) && KINDS.some((k) => k.k === c.kinds))
      return { mode: c.mode, count: Number(c.count), seconds: Number(c.seconds), kinds: c.kinds as Kinds };
  } catch {
    /* private mode: the defaults */
  }
  return DEFAULTS.coop;
}
function saveChoice(c: Choice): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(c));
  } catch {
    /* nothing kept */
  }
}

const ready = (p: PoolRow | undefined, kinds: Kinds) => (p ? (kinds === "mcq" ? p.mcq : kinds === "case" ? p.cases : p.mcq + p.cases) : 0);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

export default function QuizSetup({ route, ctx }: ScreenProps<"quiz">) {
  const groupId = ctx.group.id;
  const [lectures, setLectures] = useState<LectureRow[] | null>(null);
  const [pool, setPool] = useState<Record<string, PoolRow>>({});
  const [record, setRecord] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<Choice>(loadChoice);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** "להודיע לקבוצה": on by default (notifications, OD14). */
  const [tell, setTell] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  // The one lecture chosen without enough questions: its round's size and the month's spend.
  const [gen, setGen] = useState<{ lecture: string; count: number; spent: number | null; budget: number | null } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listLectures(groupId), quizPool(groupId)])
      .then(([ls, rows]) => {
        if (!alive) return;
        setLectures(ls.filter((l) => l.status === "ready" || l.status === "writing"));
        setPool(Object.fromEntries(rows.map((r) => [r.lecture_id, r])));
        // Preselected from the lecture (l) or the course (c) the setup was opened from.
        const pre = route.l ? ls.filter((l) => l.id === route.l) : route.c ? ls.filter((l) => l.course.trim() === route.c) : [];
        setPicked(new Set(pre.map((l) => l.id)));
      })
      .catch(() => alive && setError("הרשימה לא נטענה. כדאי לבדוק את החיבור ולנסות שוב."));
    quizRecord(groupId)
      .then((r) => alive && setRecord(typeof r === "number" ? r : null))
      .catch(() => undefined);
    openQuiz(groupId)
      .then((q) => alive && setOpenId(q?.id ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId, route.l, route.c]);

  const set = (patch: Partial<Choice>) =>
    setChoice((c) => {
      const next = { ...c, ...patch };
      saveChoice(next);
      return next;
    });
  const pickMode = (mode: "coop" | "race") => set(mode === choice.mode ? {} : { ...DEFAULTS[mode], kinds: choice.kinds });

  const chosen = useMemo(() => (lectures ?? []).filter((l) => picked.has(l.id)), [lectures, picked]);
  const readyN = chosen.reduce((n, l) => n + ready(pool[l.id], choice.kinds), 0);
  // Review UX-5: one lecture, fewer than 5 of its questions ready: write them, then play.
  const thin = chosen.length === 1 && readyN < 5 ? chosen[0] : null;

  useEffect(() => {
    if (!thin) {
      setGen(null);
      return;
    }
    let alive = true;
    Promise.all([getLecture(thin.id), groupSpent(groupId).catch(() => null), health().catch(() => null)])
      .then(([l, spent, h]) => alive && setGen({ lecture: thin.id, count: roundSize(l?.slides.length ?? 0), spent, budget: typeof h?.budgetUsd === "number" ? h.budgetUsd : null }))
      .catch(() => alive && setGen({ lecture: thin.id, count: 0, spent: null, budget: null }));
    return () => {
      alive = false;
    };
  }, [thin?.id, groupId]);

  // Lectures by course, in the library's order (newest first; a course where its newest lecture is).
  const courses = useMemo(() => {
    const out: Array<{ course: string; lectures: LectureRow[] }> = [];
    for (const l of lectures ?? []) {
      const c = l.course.trim();
      const at = out.find((x) => x.course === c);
      if (at) at.lectures.push(l);
      else out.push({ course: c, lectures: [l] });
    }
    return out;
  }, [lectures]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const wholeCourse = (ls: LectureRow[]) => setPicked(new Set(ls.filter((l) => ready(pool[l.id], choice.kinds) > 0).map((l) => l.id)));

  const capped = gen !== null && gen.spent !== null && gen.budget !== null && gen.spent >= gen.budget;
  // What the quiz asks for: the count chosen, or what is ready when that is less (3 at least,
  // the database's floor); a lecture whose questions are being written asks for the count chosen.
  const { count, choices: countChoices } = quizCounts(COUNTS, choice.count, readyN, Boolean(thin));
  const minutes = Math.max(1, Math.round((count * (choice.seconds + (choice.mode === "race" ? 10 : 30))) / 60));

  const open = async (write: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const lectureIds = chosen.map((l) => l.id);
      const id = await createQuiz({ groupId, mode: choice.mode, lectures: lectureIds, count, seconds: choice.seconds, kinds: choice.kinds });
      // "להודיע לקבוצה" unchecked: the quiz's push (held 15 s) is dropped; the inbox keeps it.
      if (flags.notify && !tell) void import("../lib/notices").then((m) => m.quizQuiet(id)).catch(() => undefined);
      if (write && thin) {
        // Q's round, from this phone's app-level store: it goes on in the lobby (review UX-5, UX-6).
        void generateRound(thin.id).catch((e) => ctx.say(failText(codeOf(e), "practice")));
      }
      ctx.go({ v: "quiz", q: id }, { replace: true });
    } catch (e) {
      const code = codeOf(e);
      if (code === "quiz open") {
        const q = await openQuiz(groupId).catch(() => null);
        setOpenId(q?.id ?? null);
      }
      setError(quizErrorText(code) ?? quizErrorText("network") ?? "");
      setBusy(false);
    }
  };

  const back: Route = route.l ? { v: "lecture", l: route.l } : { v: "group" };
  if (lectures === null && !error) return <Loading />;

  return (
    <main className="quiz-setup">
      <Head back={<BackLink go={ctx.go} fallback={back} />} title="מבחן קבוצתי חדש">
        {chosen.length ? <span className="a-chip busy">{count} שאלות</span> : null}
      </Head>

      {openId ? (
        <p className="a-callout warn quiz-open-note" role="status">
          <span>יש כבר מבחן פתוח בקבוצה.</span>
          <RouteLink to={{ v: "quiz", q: openId }} go={ctx.go} className="a-btn small">
            להצטרף אליו
          </RouteLink>
        </p>
      ) : null}

      <section className="a-stack" aria-labelledby="qs-mode">
        <div className="a-sec">
          <h2 id="qs-mode">מצב</h2>
        </div>
        <div className="a-opts" role="radiogroup" aria-labelledby="qs-mode">
          {(["coop", "race"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={choice.mode === m} className={`a-opt quiz-mode${choice.mode === m ? " picked" : ""}`} onClick={() => pickMode(m)}>
              <span className="l">
                <Icon name={m === "coop" ? "users" : "bolt"} size={14} />
              </span>
              <span className="a-row between">
                <b>{MODE_NAME[m]}</b>
                {m === "coop" && record !== null ? <span className="a-chip busy">השיא: {record}%</span> : null}
              </span>
              <span className="x">{m === "coop" ? "בלי טבלה: הניקוד שלך רק לך. 80% זה ׳עברנו׳." : "נקודות וטבלה לשחקני המירוץ, רק במשחק."}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="a-stack" aria-labelledby="qs-what">
        <div className="a-sec">
          <h2 id="qs-what">על מה</h2>
        </div>
        {courses.map(({ course, lectures: ls }) => (
          <div key={course || "-"} className="a-stack quiz-course">
            <div className="a-row between quiz-course-head">
              <b dir="rtl">{course ? isolateLatin(course, `c${course}`) : "בלי קורס"}</b>
              {ls.length > 1 ? (
                <button type="button" className="a-btn ghost small" onClick={() => wholeCourse(ls)}>
                  כל הקורס
                </button>
              ) : null}
            </div>
            <ul className="a-list quiz-lectures">
              {ls.map((l) => {
                const n = ready(pool[l.id], choice.kinds);
                return (
                  <li key={l.id} className="a-li quiz-lecture">
                    <label className="a-choice">
                      <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
                      <span dir="rtl" className="quiz-lecture-title">
                        {isolateLatin(l.title, `t${l.id}`)}
                      </span>
                    </label>
                    {n > 0 ? (
                      <span className="a-chip">{plural(n, "שאלה אחת", "שאלות")}</span>
                    ) : (
                      <span className="a-small a-muted quiz-none">
                        אין עדיין שאלות ·{" "}
                        <RouteLink to={{ v: "practice", l: l.id }} go={ctx.go} className="a-link">
                          ליצירת שאלות
                        </RouteLink>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <section className="a-stack" aria-labelledby="qs-count">
        <div className="a-sec">
          <h2 id="qs-count">כמה שאלות</h2>
        </div>
        <div className="a-seg" role="radiogroup" aria-labelledby="qs-count">
          {countChoices.map((c) => (
            <button key={c.label} type="button" className="a-btn small" role="radio" aria-checked={c.checked} aria-label={c.all ? `הכול (${c.n})` : undefined} disabled={c.disabled} onClick={() => set({ count: c.pick })}>
              {c.label}
            </button>
          ))}
        </div>
        {chosen.length ? <p className="a-small a-muted">מוכנות {readyN} שאלות בהרצאות שנבחרו.</p> : null}
      </section>

      <section className="a-stack" aria-labelledby="qs-time">
        <div className="a-sec">
          <h2 id="qs-time">זמן לשאלה</h2>
          <span className="a-small a-muted">שניות</span>
        </div>
        <div className="a-seg" role="radiogroup" aria-labelledby="qs-time">
          {SECONDS.map((n) => (
            <button key={n} type="button" className="a-btn small" role="radio" aria-checked={choice.seconds === n} onClick={() => set({ seconds: n })}>
              {n}
            </button>
          ))}
        </div>
        <p className="a-small a-muted">שאלות ארוכות ומקרים קליניים מקבלים יותר זמן, לפי האורך.</p>
      </section>

      <section className="a-stack" aria-labelledby="qs-kinds">
        <div className="a-sec">
          <h2 id="qs-kinds">אילו שאלות</h2>
        </div>
        <div className="a-seg" role="radiogroup" aria-labelledby="qs-kinds">
          {KINDS.map((k) => (
            <button key={k.k} type="button" className="a-btn small" role="radio" aria-checked={choice.kinds === k.k} onClick={() => set({ kinds: k.k })}>
              {k.label}
            </button>
          ))}
        </div>
      </section>

      {flags.notify ? (
        <Suspense fallback={null}>
          <NotifyQuizBox checked={tell} onChange={setTell} />
        </Suspense>
      ) : null}

      <section className="a-card flat quiz-summary" aria-label="סיכום">
        <div className="a-row">
          <Icon name="clock" size={16} />
          <b>
            {count} שאלות · בערך {minutes} דקות
          </b>
        </div>
        {thin ? (
          capped ? (
            <p className="a-error" role="alert">
              הקבוצה הגיעה לתקרת התקציב של החודש.
            </p>
          ) : gen && gen.count ? (
            <p className="a-small" dir="rtl">
              כ-{gen.count} שאלות אמריקאיות ומקרים קליניים, רק ממה שכתוב בשקפים, עם הסבר לכל תשובה, גם לשגויות. השאלות נשמרות לכל הקבוצה. עלות משוערת: כ-
              <bdi dir="ltr">{usd(estimateCents(gen.count) / 100)}</bdi> מהתקציב החודשי של הקבוצה.
              {gen.spent !== null && gen.budget !== null ? (
                <>
                  {" "}
                  נוצלו החודש <bdi dir="ltr">{usd(gen.spent)}</bdi> מתוך <bdi dir="ltr">{usd(gen.budget)}</bdi>.
                </>
              ) : null}
            </p>
          ) : null
        ) : (
          <p className="a-small">המבחן לא עולה מהתקציב: השאלות כבר כתובות.</p>
        )}
        <p className="a-small a-muted">
          {choice.mode === "race" ? "במירוץ: נקודות וטבלה לשחקני המירוץ, רק במשחק." : "רואים רק כמה בחרו בכל תשובה, בלי שמות. התשובות שלך נשמרות בתרגול שלך, גלויות רק לך."}
        </p>
        {error ? (
          <p className="a-error" role="alert">
            {error}
          </p>
        ) : null}
        {!chosen.length || (!thin && readyN === 0) ? <p className="a-small a-muted">צריך לבחור הרצאה שיש לה שאלות.</p> : null}
      </section>

      <StickyActions>
        {thin ? (
          <button type="button" className="a-btn primary wide" disabled={busy || capped || !gen || !gen.count} onClick={() => void open(true)}>
            ליצור שאלות ולפתוח את המבחן
          </button>
        ) : (
          <button type="button" className="a-btn primary wide" disabled={busy || !chosen.length || readyN === 0} onClick={() => void open(false)}>
            פתיחת המבחן
          </button>
        )}
      </StickyActions>
    </main>
  );
}
