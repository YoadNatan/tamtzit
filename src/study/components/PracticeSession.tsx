import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrapChip } from "../features/extras";
import { ASPECTS } from "../../../shared/study/aspects";
import { studyDay } from "../../../shared/study/day";
import type { ScreenProps } from "../features/types";
import { paragraphPractice, practiceable } from "../lib/anchorTab";
import { getLecture, getSections, lectureTitles, listLectures, partTitles, type Lecture } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { guideMark } from "../lib/guideMark";
import {
  answerQuestion,
  deleteFlag,
  flagQuestion,
  isActive,
  listCourseQuestions,
  listGroupQuestions,
  listLectureQuestions,
  listQuestionsByIds,
  myLatest,
  myMistakes,
  type Feedback,
  type Flag,
  type Latest,
  type Mistake,
  type PublicQuestion,
} from "../lib/practice";
import * as S from "../lib/practiceSession";
import { answerAny } from "../lib/answering";
import { isSetForm, toShownSet } from "../../../shared/study/forms";
import { getSignals, pulseReady } from "../lib/pulse";
import { shortName } from "../lib/questionText";
import { myDangerDue, myRewordings } from "../lib/progress";
import type { Route } from "../lib/route";
import FlagSheet from "./FlagSheet";
import PracticeQuestion from "./PracticeQuestion";
import { backTarget, Head, Loading, StickyActions } from "./Shell";
import SlideSheet from "./SlideSheet";

/* ── A practice session, as approved (proposal/mockups/practice.html) ──
 *
 * ?v=practice&s=<key>&n=5|10|20|all: the questions pickQueue chooses for the
 * key (l.<lecture>, c.<course>, t.<topic>, m, m.<lecture>), within סבב חדש's
 * choice when it started one (from where, parts, style), one at a time. The
 * top bar says where it is ("תרגול · <lecture>", "4/15") over the progress
 * bar. A tap picks an option; the bet (ניחוש · נראה לי · על בטוח) comes
 * before "לבדוק", which sends both (p_confidence). The answer is the autopsy
 * (PracticeQuestion): the choice, the key, the rest, each with "מתי כן";
 * the bottom bar then has "לפסקה" (the paragraph in the summary), the flag
 * and "לשאלה הבאה". Each showing gets its own option order (review UX-2),
 * kept in sessionStorage with the session, so a reload comes back to the
 * same question in the same order. "מצב מבחן" holds the autopsies to the
 * end and gives each question a clock (review UX-22). Two flags hide a
 * question from everyone's practice: the toast says so when this flag was
 * the second. Slide tags open SlideSheet over the session (review UX-4). */

/** The part's name on "לפסקה": at most this many characters, cut at a word. */
const PART_LABEL_MAX = 24;

type Data = {
  byId: Record<string, PublicQuestion>;
  /** The scope's questions as loaded (for "סבב נוסף" and the end's count). */
  candidates: PublicQuestion[];
  latest: Latest;
  /** Open mistakes, plus this screen's own wrong answers. */
  mistakes: Mistake[];
  hidden: Set<string>;
  /** Q-2: what is due again and what is asked instead (sessions m and r.). */
  again: S.Again[];
  /** The danger list's questions among them (two right "על בטוח" to leave it). */
  danger: Set<string>;
};
const NO_AGAIN = { again: [] as S.Again[], danger: new Set<string>() };

/** Q-2 (§12.3.Q): for "הטעויות שלי" (m, m.<lecture>) the open mistakes from an
 *  earlier study day, each with the question to ask instead
 *  (study_my_rewordings: another question on its paragraph, else itself; a
 *  card on the paragraph is Today's, so a session asks the question); for
 *  r.<group> the danger list's rows due today first (ask_id), then those.
 *  Nothing without "הטעויות שלי" (release 1's m is the open mistakes alone). */
async function againOf(scope: S.Scope, groupId: string): Promise<{ again: S.Again[]; danger: Set<string> }> {
  if (!flags.mistakes || (scope.kind !== "mistakes" && scope.kind !== "again")) return NO_AGAIN;
  const [rew, due] = await Promise.all([myRewordings(groupId), scope.kind === "again" ? myDangerDue(groupId) : Promise.resolve([])]);
  const fromDanger = due.map((d) => ({ question_id: d.question_id, ask: d.ask_id || d.question_id, wrong_at: d.wrong_at }));
  const fromRew = rew.map((r) => ({ question_id: r.question_id, ask: r.ask_kind === "question" && r.ask_question ? r.ask_question : r.question_id, wrong_at: r.wrong_at }));
  return { again: [...fromDanger, ...fromRew], danger: new Set(due.map((d) => d.question_id)) };
}

const lectureOfQ = (q: Pick<PublicQuestion, "lecture_id" | "ref_lecture">) => q.lecture_id ?? q.ref_lecture;
const firstWords = (text: string, n = 8) => {
  const words = text.replace(/\*\*/g, "").trim().split(/\s+/);
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ");
};
const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

/** The scope's questions: every one, active or not (pickQueue takes the active ones). */
async function scopeQuestions(scope: S.Scope, groupId: string): Promise<PublicQuestion[]> {
  switch (scope.kind) {
    case "lecture":
      return listLectureQuestions(scope.lecture);
    case "course": {
      const lectures = await listLectures(groupId);
      return listCourseQuestions(lectures.filter((l) => l.course.trim() === scope.course).map((l) => l.id));
    }
    case "topic":
      return listGroupQuestions(groupId);
    case "mistakes": {
      const [open, more] = await Promise.all([myMistakes(groupId, scope.lecture ?? undefined), againOf(scope, groupId)]);
      const ids = [...new Set([...open.map((m) => m.question_id), ...more.again.map((a) => a.ask)])];
      return ids.length ? listQuestionsByIds(ids) : [];
    }
    case "again": {
      const { again } = await againOf(scope, groupId);
      const ids = [...new Set(again.flatMap((a) => [a.ask, a.question_id]))];
      return ids.length ? listQuestionsByIds(ids) : [];
    }
    case "paragraph": {
      // "לתרגל את הפסקה" (N): the questions section N places on the paragraph.
      const tab = await paragraphPractice(scope.lecture, scope.part, scope.anchor);
      const ids = practiceable(tab.questions).map((q) => q.id);
      return ids.length ? listQuestionsByIds(ids) : [];
    }
    default:
      // e.<exam> (past exams) and q.<quiz> (a live quiz's questions) come with their packages.
      return [];
  }
}

/** Where the back arrow and "חזרה לתרגול" lead: a lecture's practice, else the hub. */
function parentOf(scope: S.Scope | null): Route {
  if (scope?.kind === "lecture") return { v: "practice", l: scope.lecture };
  if (scope?.kind === "mistakes" && scope.lecture) return { v: "practice", l: scope.lecture };
  if (scope?.kind === "paragraph") return { v: "lecture", l: scope.lecture, at: { part: scope.part, anchor: scope.anchor } };
  if (scope?.kind === "again") return { v: "progress" };
  return { v: "practice" };
}

export default function PracticeSession({ route, ctx }: ScreenProps<"practice">) {
  const key = route.s ?? "";
  const size = route.n ?? "10";
  const scope = useMemo(() => S.parseScope(key), [key]);
  const storeKey = S.sessionKey(ctx.userId, route);
  const groupId = ctx.group.id;

  const [data, setData] = useState<Data | null>(null);
  const [s, setS] = useState<S.SessionState | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [sending, setSending] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  /** A set question's answer so far (shown order). */
  const [pickedSet, setPickedSet] = useState<Array<number | null>>([]);
  const [bet, setBet] = useState<S.Bet | null>(null);
  const [flagFor, setFlagFor] = useState<string | null>(null);
  const [slide, setSlide] = useState<{ l: string; n: number } | null>(null);
  const [lectures, setLectures] = useState<Record<string, Lecture>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [parts, setParts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [, setTick] = useState(0);
  const sRef = useRef(s);
  sRef.current = s;
  const timedOut = useRef<string | null>(null);

  const save = useCallback(
    (next: S.SessionState) => {
      setS(next);
      S.saveSession(storeKey, next);
    },
    [storeKey],
  );

  /** A new round over the scope's questions as they are now (within the pick, if any). */
  const newRound = useCallback(
    async (timed: boolean, pick?: S.SessionPick): Promise<{ data: Data; state: S.SessionState | null }> => {
      if (!scope) return { data: { byId: {}, candidates: [], latest: new Map(), mistakes: [], hidden: new Set(), ...NO_AGAIN }, state: null };
      const [candidates, latest, mistakes, more, signals] = await Promise.all([
        scopeQuestions(scope, groupId),
        myLatest(groupId),
        myMistakes(groupId),
        againOf(scope, groupId),
        // The group's signal (section U, Q10), for a member the night counted; none without the pulse.
        flags.pulse ? pulseReady(groupId).then((cut) => (cut ? getSignals(groupId) : undefined)).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      const hidden = S.loadHidden(ctx.userId);
      const byId = Object.fromEntries(candidates.map((q) => [q.id, q]));
      const ids = S.pickQueue({
        key,
        questions: candidates.filter(isActive),
        latest,
        mistakes,
        hidden,
        size: size === "all" ? "all" : Number(size),
        random: S.cryptoRandom,
        pick,
        me: ctx.userId,
        again: more.again,
        signals,
      });
      const state = ids.length ? S.startSession({ key, timed, queue: ids.map((id) => byId[id]), now: Date.now(), pick }) : null;
      return { data: { byId, candidates, latest, mistakes, hidden, ...more }, state };
    },
    [scope, groupId, ctx.userId, key, size],
  );

  // Load: סבב חדש's "להתחיל" (or the lecture's) starts a fresh session; otherwise the saved one resumes.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!scope) return setPhase("empty");
      const start = S.peekStart(ctx.userId, route);
      const saved = start ? null : S.loadSession(storeKey);
      if (saved && saved.key === key) {
        const [candidates, latest, mistakes, more] = await Promise.all([scopeQuestions(scope, groupId), myLatest(groupId), myMistakes(groupId), againOf(scope, groupId)]);
        const byId: Record<string, PublicQuestion> = Object.fromEntries(candidates.map((q) => [q.id, q]));
        const missing = saved.ids.filter((id) => !byId[id]);
        if (missing.length) for (const q of await listQuestionsByIds(missing)) byId[q.id] = q;
        if (!alive) return;
        setData({ byId, candidates, latest, mistakes, hidden: S.loadHidden(ctx.userId), ...more });
        setS(saved);
        setPhase("ready");
        return;
      }
      const r = await newRound(start?.timed ?? false, start?.pick);
      if (!alive) return;
      setData(r.data);
      S.dropStart(ctx.userId);
      if (!r.state) return setPhase("empty");
      save(r.state);
      setPhase("ready");
    })().catch(() => alive && setPhase("error"));
    return () => {
      alive = false;
    };
    // Once per session screen (the route's key and size make storeKey).
  }, [storeKey]);

  const id = s && !S.isOver(s) ? S.currentId(s) : null;
  const q = id && data ? data.byId[id] : undefined;
  const over = s ? S.isOver(s) : false;

  // A new question: nothing picked, no bet.
  const slots = q ? (q.layout?.kind === "match" ? q.layout.prompts.length : q.options.length) : 0;
  useEffect(() => {
    setPicked(null);
    setPickedSet(Array.from({ length: slots }, () => null));
    setBet(null);
  }, [id, s?.i, slots]);
  const setForm = q && flags.qtypes && isSetForm(q.form) ? q.form : null;
  const ready = setForm ? pickedSet.length > 0 && pickedSet.every((v) => v !== null) : picked !== null;

  // A question that is gone (its lecture deleted) is skipped.
  useEffect(() => {
    if (phase === "ready" && s && id && data && !q) save(S.next(s, Date.now()));
  }, [phase, s, id, data, q, save]);

  // The lectures' titles (the top bar, and each question's lecture in a course
  // session), their parts' titles ("לפסקה: …") and the current question's
  // slides, so a tag opens at once.
  const lectureIds = useMemo(() => [...new Set(Object.values(data?.byId ?? {}).map(lectureOfQ).filter((x): x is string => Boolean(x)))], [data]);
  useEffect(() => {
    if (!lectureIds.length) return;
    lectureTitles(lectureIds)
      .then(setTitles)
      .catch(() => undefined);
    partTitles(lectureIds)
      .then((rows) => setParts(Object.fromEntries(rows.map((r) => [`${r.lecture_id}:${r.idx}`, r.title]))))
      .catch(() => undefined);
  }, [lectureIds.join(",")]);
  const lectureNow = q ? lectureOfQ(q) : null;
  const asked = useRef(new Set<string>());
  const loadLecture = useCallback((l: string) => {
    if (asked.current.has(l)) return;
    asked.current.add(l);
    getLecture(l)
      .then((x) => x && setLectures((m) => ({ ...m, [l]: x })))
      .catch(() => asked.current.delete(l));
  }, []);
  useEffect(() => {
    if (lectureNow) loadLecture(lectureNow);
  }, [lectureNow, loadLecture]);

  // The end: how many of the scope's questions were never answered.
  useEffect(() => {
    if (!over || !s || !data) return;
    let alive = true;
    myLatest(groupId)
      .then((latest) => {
        if (!alive) return;
        setLeft(S.unpracticed({ key, questions: data.candidates.filter(isActive), latest, answered: s.results.map((r) => r.id), hidden: data.hidden }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [over, s?.results.length, data, groupId, key]);

  const close = useCallback(() => {
    const parent = parentOf(scope);
    if (backTarget(parent).inApp) history.back();
    else ctx.go(parent, { replace: true });
  }, [scope, ctx]);

  /** Answers the question on screen with the option shown at `shown` (a set
   *  question: its shown choices; null: "לא יודעים"), with the bet. */
  const choose = useCallback(
    async (shown: number | number[] | null, withBet: S.Bet | null) => {
      const cur = sRef.current;
      if (!cur || sending || S.isOver(cur) || S.answered(cur)) return;
      const qid = S.currentId(cur);
      if (!qid) return;
      const qq = data?.byId[qid];
      const ms = Date.now() - cur.shownAt;
      setSending(true);
      try {
        const bet = shown === null ? null : withBet;
        const { feedback: fb, choice } =
          flags.qtypes && qq && isSetForm(qq.form)
            ? await answerAny(qq, cur.orders[cur.i], shown, cur.mode, ms, bet)
            : await (async () => {
                const args = S.answerArgs(cur, typeof shown === "number" ? shown : null, Date.now(), withBet);
                return { feedback: await answerQuestion(args.p_question, args.p_choice, args.p_mode, args.p_ms, args.p_confidence), choice: args.p_choice };
              })();
        const now = S.currentId(sRef.current ?? cur) === qid ? (sRef.current ?? cur) : cur;
        save(S.recordAnswer(now, choice, fb, Date.now(), bet));
        if (withBet !== null) guideMark("bet"); // the guide's first step "לענות על שאלה ולהמר" (nothing without VITE_STUDY_GUIDE)
        if (!(fb.correct ?? choice === fb.answer))
          setData((d) => (d ? { ...d, mistakes: [...d.mistakes.filter((m) => m.question_id !== qid), { question_id: qid, wrong_at: new Date().toISOString() }] } : d));
      } catch (e) {
        const code = codeOf(e);
        if (["retired", "in quiz", "question not found", "no key", "hidden"].includes(code)) {
          ctx.say(failText(code, "practice"));
          const now = sRef.current ?? cur;
          if (S.currentId(now) === qid) save(S.next(now, Date.now()));
        } else ctx.say("התשובה לא נשמרה. כדאי לבדוק את החיבור ולנסות שוב.");
      } finally {
        setSending(false);
      }
    },
    [sending, save, ctx, data],
  );
  const check = useCallback(() => {
    if (!ready || bet === null) return;
    void choose(setForm ? pickedSet.map((v) => v ?? 0) : picked, bet);
  }, [picked, pickedSet, setForm, ready, bet, choose]);

  const goNext = useCallback(() => {
    const cur = sRef.current;
    if (!cur || S.isOver(cur)) return;
    save(S.next(cur, Date.now()));
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [save]);

  // "מצב מבחן": each question's clock; at zero it is "לא יודעים".
  const timed = Boolean(s?.timed);
  useEffect(() => {
    if (!timed || over || phase !== "ready") return;
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [timed, over, phase]);
  const remaining = s && timed && !over ? Math.max(0, Math.ceil(s.seconds[s.i] - (Date.now() - s.shownAt) / 1000)) : 0;
  useEffect(() => {
    if (!timed || over || !id || sending || remaining > 0 || timedOut.current === id) return;
    timedOut.current = id;
    void choose(null, null);
  }, [timed, over, id, sending, remaining, choose]);

  // Desktop keys: 1-6 pick an option, Enter checks (with a bet) or goes on.
  const answeredNow = s ? S.answered(s) : false;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flagFor || slide || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (/^[1-6]$/.test(e.key) && q && !setForm && !answeredNow && !sending) {
        const i = Number(e.key) - 1;
        if (i < q.options.length) {
          e.preventDefault();
          setPicked(i);
        }
      } else if (e.key === "Enter" && !(t && t.closest("button, a"))) {
        if (answeredNow) {
          e.preventDefault();
          goNext();
        } else if (ready && bet !== null) {
          e.preventDefault();
          check();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flagFor, slide, q, answeredNow, sending, goNext, check, ready, setForm, bet]);

  const openSlide = (n: number, lectureId: string | null) => {
    if (!lectureId) return;
    loadLecture(lectureId);
    setSlide({ l: lectureId, n });
  };

  /** "לפסקה": the question's paragraph in the summary (re-anchored when the
   *  part was written again since), else its first slide. */
  const toParagraph = async (qq: PublicQuestion) => {
    const l = lectureOfQ(qq);
    if (!l) return;
    let at: { part: number; anchor: number } | null = null;
    if (qq.anchor !== null && qq.part_idx !== null) {
      at = { part: qq.part_idx, anchor: qq.anchor };
      try {
        const sec = (await getSections(l)).find((x) => x.idx === qq.part_idx);
        if (sec && qq.part_gen !== null && (sec.gen ?? null) !== qq.part_gen && sec.markdown) {
          const { numberBlocks, reanchor } = await import("../../../shared/study/blocks");
          const a = reanchor(numberBlocks(sec.markdown), qq.anchor, qq.quote ?? "");
          at = a >= 0 ? { part: qq.part_idx, anchor: a } : null;
        }
      } catch {
        // offline: the paragraph as the question names it
      }
    } else if (scope?.kind === "paragraph" && scope.lecture === l && scope.part === qq.part_idx) {
      // A paragraph's session (N): a question placed there by its points has no anchor of its own.
      at = { part: scope.part, anchor: scope.anchor };
    }
    ctx.go(at ? { v: "lecture", l, at } : { v: "lecture", l, slide: qq.slides[0] ?? 1 });
    // N: from a question answered wrong, straight to its paragraph.
    if (flags.anchor && at && s?.results.some((r) => r.id === qq.id && !r.correct)) ctx.say("מהשאלה שטעית בה, ישר לפסקה");
  };

  /* ── flags ── */
  const flagQ = flagFor && data ? data.byId[flagFor] : undefined;
  const myFlag: Flag | null = flagQ?.study_question_flags?.find((f) => f.user_id === ctx.userId) ?? null;
  const patchQuestion = (qid: string, f: (q: PublicQuestion) => PublicQuestion) =>
    setData((d) => (d && d.byId[qid] ? { ...d, byId: { ...d.byId, [qid]: f(d.byId[qid]) } } : d));

  if (phase === "loading" || (phase === "ready" && (!s || !data))) return <Loading />;
  const back = (
    <button type="button" className="back" onClick={close}>
      {backTarget(parentOf(scope)).label}
    </button>
  );
  const lectureTitle = scope?.kind === "lecture" || scope?.kind === "paragraph" ? titles[scope.lecture] : undefined;
  const title =
    scope?.kind === "mistakes" ? (
      "הטעויות שלי"
    ) : scope?.kind === "again" ? (
      "חוזרות היום"
    ) : (
      <>
        תרגול
        {lectureTitle || scope?.kind === "course" ? (
          <>
            {" · "}
            <bdi>{lectureTitle ?? (scope?.kind === "course" ? scope.course : "")}</bdi>
          </>
        ) : null}
      </>
    );
  if (phase === "error" || phase === "empty") {
    return (
      <main className="practice-session">
        <Head back={back} title={title} />
        <p className={phase === "error" ? "a-error" : "a-muted loading"}>
          {phase === "error"
            ? "התרגול לא נטען. כדאי לבדוק את החיבור ולנסות שוב."
            : scope?.kind === "again"
              ? "היום אין שאלות שחוזרות. טעות חוזרת ביום שאחרי, בניסוח אחר."
              : scope?.kind === "mistakes" && flags.mistakes
                ? "אין טעויות פתוחות. שאלה שטועים בה נכנסת לכאן, וחוזרת למחרת בניסוח אחר."
                : "אין כאן שאלות לתרגל כרגע."}
        </p>
        <button type="button" className="a-btn" onClick={phase === "error" ? () => location.reload() : close}>
          {phase === "error" ? "לנסות שוב" : "חזרה לתרגול"}
        </button>
      </main>
    );
  }
  if (!s || !data) return <Loading />;

  const total = s.ids.length;
  /** A question as shown: before the answer, or its autopsy (read: on the end screen). */
  const showQuestion = (qq: PublicQuestion, i: number, read: boolean) => {
    const order = s.orders[i] ?? [];
    const sameLength = order.length === qq.options.length;
    const shown = sameLength ? S.shownOptions(qq.options, order) : qq.options;
    const result = s.results.find((r) => r.id === qq.id);
    const fb: Feedback | null = read || !s.timed ? (sameLength ? S.visibleFeedback(s, qq.id, qq.form) : (s.feedback[qq.id] ?? null)) : null;
    const chosen = result
      ? result.choice === null
        ? null
        : Array.isArray(result.choice)
          ? isSetForm(qq.form)
            ? toShownSet(qq.form, order, result.choice)
            : result.choice
          : sameLength
            ? order.indexOf(result.choice)
            : result.choice
      : undefined;
    // A staged case: the step before this one answered just now folds the story so far.
    const prevStep = i > 0 ? data.byId[s.ids[i - 1]] : undefined;
    const stepFolded = Boolean(qq.series && prevStep && prevStep.series === qq.series && s.results.some((r) => r.id === prevStep.id));
    let note: string | undefined;
    // Q-2: the question this one stands in for (asked in another wording).
    const origin = data.again.find((a) => a.ask === qq.id && a.question_id !== qq.id)?.question_id ?? (data.again.some((a) => a.question_id === qq.id) ? qq.id : null);
    if (flags.mistakes && fb && result && !read) {
      if (result.correct) {
        const m = data.mistakes.find((x) => x.question_id === (origin ?? qq.id) && Date.parse(x.wrong_at) < s.shownAt + 1);
        const said = S.mistakeNote({ wrongAt: m?.wrong_at ?? null, wrongHere: false, now: Date.now(), day: studyDay });
        if (said === "tomorrow") note = "השאלה תחזור מחר, כדי לבדוק שזה נשאר";
        if (said === "cleared") note = "יצאה מרשימת הטעויות";
        if (origin && data.danger.has(origin)) note = "חוזרת אליך עד פעמיים נכון ׳על בטוח׳, בימים שונים";
      } else {
        // Another question on the same paragraph is what "בניסוח אחר" will ask (study_my_rewordings).
        const other = qq.anchor !== null && Object.values(data.byId).some((x) => x.id !== qq.id && isActive(x) && x.lecture_id === qq.lecture_id && x.part_idx === qq.part_idx && x.anchor === qq.anchor);
        note = other ? "חוזרת מחר בניסוח אחר" : "חוזרת מחר";
      }
    }
    const l = lectureOfQ(qq);
    return (
      <PracticeQuestion
        key={qq.id}
        q={{ ...qq, options: shown }}
        position={{ index: i + 1, total }}
        picked={read ? undefined : picked}
        pickedSet={read ? undefined : pickedSet}
        onPickSet={read ? undefined : setPickedSet}
        stepFolded={stepFolded}
        bet={read ? undefined : bet}
        chosen={chosen}
        feedback={fb}
        answeredBet={result?.bet ?? null}
        busy={!read && sending}
        nameOf={ctx.nameOf}
        me={ctx.userId}
        onPick={read ? undefined : setPicked}
        onBet={read ? undefined : setBet}
        onDontKnow={read ? undefined : () => void choose(null, null)}
        onSlide={(n) => openSlide(n, l)}
        chips={
          <>
            {scope?.kind !== "lecture" && scope?.kind !== "paragraph" && l && titles[l] ? (
              <span className="a-chip pq-source">
                <bdi>{titles[l]}</bdi>
              </span>
            ) : null}
            {origin && origin !== qq.id ? <span className="a-chip busy pq-again">בניסוח אחר</span> : null}
            {/* E: a member's trap ("שאלה של מישהו מהקבוצה"), named once a live quiz unmasked it. */}
            <TrapChip ctx={ctx} questionId={qq.id} source={qq.source} />
          </>
        }
        note={note}
        dangerList={flags.progress}
        autoFocus={!read}
      />
    );
  };
  const paragraphLabel = (qq: PublicQuestion) => {
    const l = lectureOfQ(qq);
    const full = l && qq.part_idx !== null ? parts[`${l}:${qq.part_idx}`] : undefined;
    // Cut here, at a word, never by a CSS ellipsis (in a right-to-left line it
    // cuts an English title from its start); the label then wraps to two lines.
    const part = full ? shortName(full, PART_LABEL_MAX) : full;
    return (
      <span className="pq-label">
        {part ? (
          <>
            לפסקה: <bdi>{part}</bdi>
          </>
        ) : (
          "לפסקה"
        )}
      </span>
    );
  };

  const sheets = (
    <>
      {flagQ ? (
        <FlagSheet
          myFlag={myFlag}
          onClose={() => setFlagFor(null)}
          onDelete={async (f) => {
            await deleteFlag(f.id);
            patchQuestion(flagQ.id, (x) => ({ ...x, study_question_flags: (x.study_question_flags ?? []).filter((y) => y.id !== f.id) }));
          }}
          onSend={async (reason, note) => {
            // The row as stored, with its real id: "מחיקת הסימון" can take it back at once (finding Q5).
            const mine = await flagQuestion(flagQ.id, reason, note);
            patchQuestion(flagQ.id, (x) => ({ ...x, study_question_flags: [...(x.study_question_flags ?? []).filter((y) => y.id !== mine.id), mine] }));
            // A second member's counting flag hides it from everyone until it is checked against the slide.
            const [now] = await listQuestionsByIds([flagQ.id]).catch(() => [] as PublicQuestion[]);
            if (now?.hidden_at) {
              patchQuestion(flagQ.id, (x) => ({ ...x, hidden_at: now.hidden_at }));
              ctx.say("נשלח לקבוצה. זה הדגל השני, אז השאלה יצאה מהתרגול של כולם עד שתיבדק מול השקף.");
            } else ctx.say("נשלח לקבוצה.");
          }}
          onHide={() => {
            const qid = flagQ.id;
            const hidden = S.setHidden(ctx.userId, qid, true);
            setData((d) => (d ? { ...d, hidden } : d));
            ctx.say("השאלה הוסתרה אצלך.", {
              label: "ביטול",
              run: () => {
                const back2 = S.setHidden(ctx.userId, qid, false);
                setData((d) => (d ? { ...d, hidden: back2 } : d));
              },
            });
          }}
        />
      ) : null}
      {slide && lectures[slide.l] ? <SlideSheet lecture={lectures[slide.l]} slide={slide.n} go={ctx.go} onClose={() => setSlide(null)} /> : null}
    </>
  );

  /* ── The end of a round ── */
  if (over) {
    const sc = S.score(s);
    const wrong = s.results.filter((r) => !r.correct && data.byId[r.id]);
    // "רק הטעויות מהסבב" asks them again, except the ones this person hid since
    // ("להסתיר ממני") and any that left practice (finding Q6).
    const wrongAgain = wrong.filter((r) => !data.hidden.has(r.id) && isActive(data.byId[r.id]));
    const again = async () => {
      setPhase("loading");
      setOpen(null);
      try {
        const r = await newRound(s.timed, s.pick);
        setData(r.data);
        if (!r.state) return setPhase("empty");
        save(r.state);
        setPhase("ready");
        window.scrollTo({ top: 0 });
      } catch {
        setPhase("error");
      }
    };
    const onlyWrong = () => {
      setOpen(null);
      if (!wrongAgain.length) return;
      save(S.startSession({ key, timed: s.timed, queue: wrongAgain.map((r) => data.byId[r.id]), now: Date.now(), pick: s.pick }));
      window.scrollTo({ top: 0 });
    };
    const readLink = (qq: PublicQuestion) =>
      lectureOfQ(qq) ? (
        <button type="button" className="a-btn small pq-read" onClick={() => void toParagraph(qq)}>
          {paragraphLabel(qq)}
        </button>
      ) : null;
    const reviewRow = (r: S.Result) => {
      const qq = data.byId[r.id];
      const i = s.ids.indexOf(r.id);
      const expanded = open === r.id;
      return (
        <li key={r.id} className="pq-review">
          <button
            type="button"
            className="a-li pq-review-row"
            aria-expanded={s.timed ? undefined : expanded}
            onClick={() => (s.timed ? document.getElementById(`rq-${r.id}`)?.scrollIntoView({ block: "start" }) : setOpen(expanded ? null : r.id))}
          >
            <div>
              <b className="pq-review-topic">
                <bdi>{qq.topic || "שאלה"}</bdi> · {ASPECTS[qq.aspect] ?? ASPECTS.other}
              </b>
              <span className="m" dir="rtl">
                {firstWords(qq.question)}
              </span>
            </div>
          </button>
          {expanded && !s.timed ? (
            <div className="a-stack pq-review-body">
              {showQuestion(qq, i, true)}
              {readLink(qq)}
            </div>
          ) : null}
        </li>
      );
    };
    return (
      <main className="practice-session is-end">
        <Head back={back} title={title}>
          <span className="a-chip busy">
            {total}/{total}
          </span>
        </Head>
        <div className="a-bar" aria-hidden="true">
          <i style={{ width: "100%" }} />
        </div>
        <section className="a-stack pq-end" aria-labelledby="end-h" data-good={sc.of > 0 && sc.right * 5 >= sc.of * 4 ? "" : undefined}>
          <h2 id="end-h" className="a-h1">
            סוף הסבב
          </h2>
          <p className="pq-score">
            <b>
              {sc.right} מתוך {sc.of}
            </b>{" "}
            <span>נכונות</span> <span className="a-chip">רק לך</span>
          </p>
          {wrong.length ? (
            <>
              <div className="a-sec">
                <h3>לחזור על</h3>
              </div>
              <ul className="a-list pq-review-list">{wrong.map(reviewRow)}</ul>
            </>
          ) : null}
          {s.timed ? (
            <div className="a-stack pq-exam-review">
              {s.results
                .filter((r) => data.byId[r.id])
                .map((r) => {
                  const qq = data.byId[r.id];
                  return (
                    <div key={r.id} id={`rq-${r.id}`} className="a-card pq-exam-item">
                      {showQuestion(qq, s.ids.indexOf(r.id), true)}
                      {readLink(qq)}
                      <button type="button" className="a-link pq-flag-link" onClick={() => setFlagFor(qq.id)}>
                        משהו לא בסדר בשאלה?
                      </button>
                    </div>
                  );
                })}
            </div>
          ) : null}
          {left > 0 ? <p className="a-muted">{left === 1 ? "נשארה שאלה אחת שעוד לא תורגלה." : `נשארו ${left} שאלות שעוד לא תורגלו.`}</p> : null}
          <button type="button" className="a-btn ghost pq-back" onClick={close}>
            חזרה לתרגול
          </button>
        </section>
        <StickyActions>
          <button type="button" className="a-btn primary wide" onClick={() => void again()}>
            סבב נוסף
          </button>
          {wrongAgain.length ? (
            <button type="button" className="a-btn" onClick={onlyWrong}>
              רק הטעויות מהסבב
            </button>
          ) : null}
        </StickyActions>
        {sheets}
      </main>
    );
  }

  /* ── A question, then its autopsy ── */
  const shownFb = q && !s.timed ? S.visibleFeedback(s, q.id, q.form) : null;
  const last = s.i >= total - 1;
  return (
    <main className={`practice-session${shownFb ? " has-feedback" : ""}`}>
      <Head back={back} title={title}>
        {timed ? (
          <span className={`a-chip ${remaining <= 10 ? "warn" : ""} pq-clock`.replace("  ", " ")} role="timer" aria-label={`נשארו ${remaining} שניות`}>
            <bdi dir="ltr">
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
            </bdi>
          </span>
        ) : null}
        <span className="a-chip busy pq-pos" aria-label={`שאלה ${s.i + 1} מתוך ${total}`}>
          <bdi dir="ltr">
            {s.i + 1}/{total}
          </bdi>
        </span>
      </Head>
      <div className="a-bar" role="progressbar" aria-label="ההתקדמות בסבב" aria-valuemin={0} aria-valuemax={total} aria-valuenow={s.results.length}>
        <i style={{ width: `${Math.round((100 * (s.i + (shownFb ? 1 : 0))) / Math.max(1, total))}%` }} />
      </div>
      {q ? showQuestion(q, s.i, false) : <Loading />}
      {q ? (
        <StickyActions>
          {shownFb ? (
            <>
              {lectureOfQ(q) ? (
                <button type="button" className="a-btn pq-paragraph" onClick={() => void toParagraph(q)}>
                  {paragraphLabel(q)}
                </button>
              ) : null}
              <button type="button" className="a-btn icon pq-flag" aria-label="משהו לא בסדר בשאלה?" onClick={() => setFlagFor(q.id)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
              </button>
              <button type="button" className="a-btn primary pq-next" onClick={goNext}>
                {last ? "לסיכום הסבב" : "לשאלה הבאה"}
              </button>
            </>
          ) : (
            <button type="button" className="a-btn primary wide" disabled={!ready || bet === null || sending} onClick={check}>
              {sending ? "בודקים…" : "לבדוק"}
            </button>
          )}
        </StickyActions>
      ) : null}
      {sheets}
    </main>
  );
}
