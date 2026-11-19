import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScreenProps } from "../features/types";
import { getLecture, type Lecture } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { isActive, listBatches, listLectureQuestions, practiceOverview, watchPractice, type Batch, type Overview, type PublicQuestion } from "../lib/practice";
import { listRequests, pendingDrafts, watchBank, type Request } from "../lib/practice2";
import { loadHidden, setHidden } from "../lib/practiceSession";
import { richText } from "../lib/rich";
import FixSheet from "./FixSheet";
import { flagLine } from "../lib/questionText";
import { BackLink, Head, Loading, RouteLink } from "./Shell";
import { ExtrasCard } from "../features/extras";

/* ── A lecture's practice, practice 2.0 (proposal/practice-2) ──
 *
 * The bank of the lecture and the ways in: "סבב חדש" (the session's choices)
 * and "שאלות חדשות" (מה ליצור, then דוגמה ומיקוד; anyone in the group creates,
 * the bank is shared: decision 2). While a request's questions are written or
 * wait for review, "הבנק נבנה" with its count leads back to them. A question
 * two members flagged is out of everyone's practice: it waits here, with
 * "לבדוק מול השקף" (the fix sheet). One member's flags show read only (no
 * member takes a question out of practice alone: package Q's review, Q2),
 * and the questions this person hid on this device can come back. A round of
 * release 1 still being written (a quiz's, or a phone not yet updated) shows
 * its count. Live through watchPractice and watchBank. */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
const firstWords = (text: string, n = 9) => {
  const words = text.replace(/\*\*/g, "").trim().split(/\s+/);
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ");
};
/** The lecture's limit of active questions (study_draft_keep's). */
const BANK_MAX = 150;

export default function LecturePractice({ route, ctx }: ScreenProps<"practice">) {
  const lectureId = route.l ?? "";
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [questions, setQuestions] = useState<PublicQuestion[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [waiting, setWaiting] = useState<Array<{ request_id: string }>>([]);
  const [mine, setMine] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [fixFor, setFixFor] = useState<PublicQuestion | null>(null);
  const [hidden, setHiddenIds] = useState<Set<string>>(() => loadHidden(ctx.userId));

  const load = useCallback(async () => {
    const [qs, bs, ov, rq, pd] = await Promise.all([
      listLectureQuestions(lectureId),
      listBatches(lectureId),
      practiceOverview(ctx.group.id).catch(() => null),
      listRequests(lectureId).catch(() => [] as Request[]),
      pendingDrafts(lectureId).catch(() => []),
    ]);
    setQuestions(qs);
    setBatches(bs);
    setRequests(rq);
    setWaiting(pd);
    if (ov) setMine(ov.find((o) => o.lecture_id === lectureId) ?? null);
    setError("");
  }, [lectureId, ctx.group.id]);

  useEffect(() => {
    let alive = true;
    getLecture(lectureId)
      .then((l) => alive && (l ? setLecture(l) : setError(failText("lecture not found", "practice"))))
      .catch(() => alive && setError("התרגול לא נטען. כדאי לבדוק את החיבור ולנסות שוב."));
    void load().catch(() => alive && setError("התרגול לא נטען. כדאי לבדוק את החיבור ולנסות שוב."));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load().catch(() => undefined), 250);
    };
    const stopQ = watchPractice({ lectureId }, again);
    const stopB = watchBank(lectureId, again);
    return () => {
      alive = false;
      clearTimeout(timer);
      stopQ();
      stopB();
    };
  }, [lectureId, load]);

  const active = useMemo(() => (questions ?? []).filter(isActive), [questions]);
  const visible = active.filter((x) => !hidden.has(x.id));
  const cases = visible.filter((x) => x.kind === "case").length;
  const twoFlags = (questions ?? []).filter((x) => x.hidden_at && !x.retired_at);
  const flagged = (questions ?? []).filter((x) => !x.hidden_at && ((x.study_question_flags?.length ?? 0) > 0 || x.retired_at));
  const hiddenHere = (questions ?? []).filter((x) => hidden.has(x.id));

  // "הבנק נבנה": the newest request with drafts to decide on or batches still to write.
  const building = useMemo(() => {
    for (const r of requests) {
      const own = batches.filter((b) => b.request_id === r.id);
      const open = own.some((b) => b.status === "pending" || b.status === "writing");
      const pending = waiting.filter((d) => d.request_id === r.id).length;
      if (open || pending) return { r, open, pending, made: own.reduce((n, b) => n + b.made, 0), wanted: own.reduce((n, b) => n + b.wanted, 0) };
    }
    return null;
  }, [requests, batches, waiting]);
  // A release-1 round still being written (no request).
  const oldRound = useMemo(() => {
    const own = batches.filter((b) => !b.request_id);
    if (!own.length) return null;
    const last = Math.max(...own.map((b) => b.round));
    const parts = own.filter((b) => b.round === last);
    if (!parts.some((b) => b.status === "pending" || b.status === "writing")) return null;
    return { made: parts.reduce((n, b) => n + b.made, 0), wanted: parts.reduce((n, b) => n + b.wanted, 0) };
  }, [batches]);

  if (error && !lecture) {
    return (
      <main className="practice-lecture">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "practice" }} />} />
        <p className="a-error">{error}</p>
      </main>
    );
  }
  if (!lecture || questions === null) return <Loading />;

  const create = { v: "practice" as const, l: lectureId, x: "new" as const };
  const full = active.length >= BANK_MAX;

  return (
    <main className="practice-lecture">
      <Head
        back={<BackLink go={ctx.go} fallback={{ v: "lecture", l: lectureId }} />}
        title={
          <>
            תרגול · <bdi>{lecture.title}</bdi>
          </>
        }
      />
      {lecture.course || lecture.lecturer ? (
        <p className="ph-sub">
          <span>{[lecture.course, lecture.lecturer].filter(Boolean).join(" · ")}</span>
        </p>
      ) : null}

      {building ? (
        <section className="a-card practice-building" aria-labelledby="building-h">
          <div className="a-row between">
            <h2 id="building-h" className="a-h2">
              הבנק נבנה
            </h2>
            <span className="a-chip busy">
              <bdi dir="ltr">
                {building.made}/{building.wanted}
              </bdi>
            </span>
          </div>
          <div className="a-bar" aria-hidden="true">
            <i style={{ width: `${Math.round((100 * building.made) / Math.max(1, building.wanted))}%` }} />
          </div>
          <p className="a-small a-muted" role="status">
            {[building.open ? "שאלות עוד נכתבות" : "", building.pending ? plural(building.pending, "שאלה אחת מחכה להחלטה", "שאלות מחכות להחלטה") : ""].filter(Boolean).join(" · ")}
          </p>
          <RouteLink to={{ v: "practice", l: lectureId, x: "bank", r: building.r.id }} go={ctx.go} className="a-btn">
            לבנק שנבנה
          </RouteLink>
        </section>
      ) : null}

      {visible.length || active.length ? (
        <section className="a-card practice-ready" aria-labelledby="ready-h">
          <h2 id="ready-h" className="a-h2">
            {plural(visible.length, "שאלה אחת", "שאלות")}
            {cases ? ` · ${plural(cases, "מקרה קליני אחד", "מקרים קליניים")}` : ""}
          </h2>
          {mine ? (
            <p className="a-muted">
              {mine.answered === 1 ? "תורגלה 1" : `תורגלו ${mine.answered}`} מתוך {mine.questions}
              {mine.wrong_now ? ` · ${plural(mine.wrong_now, "טעות אחת", "טעויות")}` : ""}
              <span className="a-chip practice-mine">רק לך</span>
            </p>
          ) : null}
          {flags.practice ? (
            <RouteLink to={{ v: "practice", l: lectureId, x: "round" }} go={ctx.go} className="a-btn primary wide practice-round-link">
              סבב חדש
            </RouteLink>
          ) : null}
          {full ? (
            <p className="a-small a-muted">{failText("enough questions", "practice")}</p>
          ) : (
            <RouteLink to={create} go={ctx.go} className="a-btn wide practice-more">
              שאלות חדשות
            </RouteLink>
          )}
        </section>
      ) : building ? null : (
        <section className="a-card dashed practice-empty" aria-labelledby="empty-h">
          <h2 id="empty-h" className="a-h2">
            עוד אין שאלות תרגול להרצאה הזו.
          </h2>
          <p className="a-small a-muted">בוחרים כמה, על אילו חלקים ובאיזה סגנון. כל שאלה נבדקת לפני שהיא נכנסת לבנק, והבנק משותף לכל הקבוצה.</p>
          <RouteLink to={create} go={ctx.go} className="a-btn primary">
            שאלות חדשות
          </RouteLink>
        </section>
      )}

      {oldRound ? (
        <p className="a-small a-muted practice-old-round" role="status">
          נכתבות שאלות: {oldRound.made} מתוך {oldRound.wanted}.
        </p>
      ) : null}

      {flags.quiz && active.length ? (
        <RouteLink to={{ v: "quiz", isNew: true, l: lectureId }} go={ctx.go} className="a-btn practice-quiz">
          מבחן קבוצתי על ההרצאה
        </RouteLink>
      ) : null}

      {/* E (phase 3, usable early by decision 3): "טבלה ריקה" and "מלכודת משלי", each with its meter. */}
      <ExtrasCard ctx={ctx} lectureId={lectureId} slides={lecture.slides} />

      {twoFlags.length ? (
        <section className="a-stack practice-fix" aria-labelledby="fix-h">
          <div className="a-sec">
            <h2 id="fix-h">מחכות לבדיקה</h2>
            <span className="a-small a-muted">שני דגלים</span>
          </div>
          <ul className="a-list">
            {twoFlags.map((x) => (
              <li key={x.id} className="a-li fix-row">
                <div>
                  <b dir="rtl">{richText(firstWords(x.question), `x${x.id}`)}</b>
                  <span className="m">יצאה מהתרגול של כולם עד שתיבדק מול השקף.</span>
                </div>
                <button type="button" className="a-btn small" onClick={() => setFixFor(x)}>
                  לבדוק מול השקף
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {flagged.length ? (
        <details className="a-card practice-flagged">
          <summary>{flagged.length === 1 ? "שאלה אחת סומנה כבעייתית" : `${flagged.length} שאלות סומנו כבעייתיות`}</summary>
          <ul className="a-stack">
            {flagged.map((x) => (
              <li key={x.id} className="flagged-q">
                <p className="a-small" dir="rtl">
                  <b>{richText(firstWords(x.question), `t${x.id}`)}</b>
                </p>
                {(x.study_question_flags ?? []).map((f) => (
                  <p key={f.id} className="a-small a-muted" dir="rtl">
                    {richText(flagLine(f, ctx.nameOf), `f${f.id}`)}
                  </p>
                ))}
                {x.retired_at ? <p className="a-small a-muted">הוצאה מהתרגול ע״י {ctx.nameOf(x.retired_by ?? "") || "ללא שם"}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {hiddenHere.length ? (
        <details className="a-card practice-hidden">
          <summary>{hiddenHere.length === 1 ? "שאלה אחת מוסתרת אצלך" : `${hiddenHere.length} שאלות מוסתרות אצלך`}</summary>
          <ul className="a-stack">
            {hiddenHere.map((x) => (
              <li key={x.id} className="a-row between">
                <span dir="rtl">{richText(firstWords(x.question), `h${x.id}`)}</span>
                <button type="button" className="a-btn small" onClick={() => setHiddenIds(setHidden(ctx.userId, x.id, false))}>
                  להציג שוב
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {fixFor ? (
        <FixSheet
          q={fixFor}
          slideCount={lecture.slides.length}
          onClose={() => setFixFor(null)}
          onDone={(verdict) => {
            ctx.say(verdict === "keep" ? "השאלה חזרה לתרגול של כולם." : "השאלה יצאה מהתרגול.");
            void load().catch(() => undefined);
          }}
        />
      ) : null}
    </main>
  );
}
