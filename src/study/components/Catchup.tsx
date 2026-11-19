import { useEffect, useMemo, useState } from "react";
import { numberBlocks } from "../../../shared/study/blocks";
import type { ScreenProps } from "../features/types";
import { getSections, type Section } from "../lib/api";
import { flags } from "../lib/flags";
import { catchupDone, catchupEmpty, catchupOf, meetingWords, myMissed, slideRange, type CatchupPack } from "../lib/meeting";
import { answerAny } from "../lib/answering";
import { listQuestionsByIds, type Bet, type Feedback, type PublicQuestion } from "../lib/practice";
import { isolateLatin, richText } from "../lib/rich";
import { Icon } from "./Icon";
import PracticeQuestion from "./PracticeQuestion";
import { Avatar, BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";
import "../styles/meeting.css";

/* ── Catch-up of a missed meeting (package M, M-2; today.html s2, the
 * meeting design §4.3 item 9) ──
 *
 * Only what the group made in that meeting, private: "התעכבנו על" (each
 * stop to explain: the paragraph's first words, from the summary this phone
 * has), "שאלה שנפתרה" (a question answered in the meeting's hours, with its
 * answer and who answered), "אסוציאציה שננעצה" (the wall's moment, section
 * J; hidden without it), and "בדיקה קצרה": the questions the group found
 * hardest in the meeting's quizzes, then those on the stopped paragraphs,
 * alone and with no clock (practice's question, mode "lecture"). "{n} דק׳".
 * Finishing records it privately; "קראו" lists the member from the next
 * study day, at the meeting's time (review SEC-12). Decision 1 (17 Nov
 * 2026): open without an account, behind VITE_STUDY_GUESS (M-2). */

const DONE_LINE = "ההשלמה הושלמה. מחר ההרצאה תסומן כנקראה, בשעת הפגישה.";

export default function CatchupScreen({ route, ctx }: ScreenProps<"catchup">) {
  const [meetingId, setMeetingId] = useState<string | null | undefined>(route.m);
  const [pack, setPack] = useState<CatchupPack | null>(null);
  const [parts, setParts] = useState<Section[]>([]);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"intro" | "check" | "done">("intro");
  const [qs, setQs] = useState<PublicQuestion[]>([]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [bet, setBet] = useState<Bet | null>(null);
  const [fb, setFb] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [t0, setT0] = useState(Date.now());

  // ?v=catchup&l=: that lecture's latest missed meeting.
  useEffect(() => {
    if (route.m || !route.l) return;
    let alive = true;
    myMissed(ctx.group.id)
      .then((rows) => alive && setMeetingId(rows.find((x) => x.lecture_id === route.l)?.meeting_id ?? null))
      .catch(() => alive && setMeetingId(null));
    return () => {
      alive = false;
    };
  }, [route.m, route.l, ctx.group.id]);

  useEffect(() => {
    if (!meetingId) return;
    let alive = true;
    catchupOf(meetingId)
      .then(async (p) => {
        if (!alive) return;
        setPack(p);
        if (p.done) setStep("done");
        const [s, q] = await Promise.all([getSections(p.meeting.lecture_id).catch(() => []), p.questions.length ? listQuestionsByIds(p.questions).catch(() => []) : Promise.resolve([])]);
        if (!alive) return;
        setParts(s);
        const order = new Map(p.questions.map((id, k) => [id, k]));
        setQs([...q].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
      })
      .catch((e) => alive && setError(meetingWords(e)));
    return () => {
      alive = false;
    };
  }, [meetingId]);

  const firstWords = useMemo(() => {
    const out = new Map<string, string>();
    for (const s of parts) for (const b of numberBlocks(s.markdown ?? "")) out.set(`${s.idx}.${b.n}`, b.text.replace(/\[ש['׳][^\]]*\]/g, "").trim());
    return out;
  }, [parts]);
  const slidesOf = (part: number, anchor: number) => {
    const text = (parts.find((s) => s.idx === part) && firstWords.get(`${part}.${anchor}`)) || "";
    const raw = numberBlocks(parts.find((s) => s.idx === part)?.markdown ?? "").find((b) => b.n === anchor)?.text ?? "";
    const m = /\[ש['׳]\s?([\d\s,–-]+)\]/.exec(raw);
    return text && m ? `ש׳ ${m[1].trim()}` : "";
  };

  const back = <BackLink go={ctx.go} fallback={flags.today ? { v: "today" } : { v: "group" }} />;
  if (meetingId === null) {
    return (
      <main className="m-screen m-catchup">
        <Head back={back} title="השלמה" />
        <p className="a-card dashed empty">אין פגישה להשלים.</p>
      </main>
    );
  }
  if (error) {
    return (
      <main className="m-screen m-catchup">
        <Head back={back} title="השלמה" />
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!pack) return <Loading />;

  // today.html s2: the parts read ("השלמה · Leishmaniasis: טיפול"), else the lecture.
  const title = pack.meeting.title || pack.meeting.lecture_title;
  const head = (
    <>
      <Head back={back}>
        <h1 className="t" dir="rtl">
          השלמה · {isolateLatin(title, "ct")}
        </h1>
      </Head>
      <p className="ph-sub">
        <span>מה היה בפגישה</span>
        <span aria-hidden="true">·</span>
        <span>{pack.minutes} דק׳</span>
        <span className="a-chip">רק לך</span>
      </p>
    </>
  );

  const finish = async () => {
    setBusy(true);
    try {
      await catchupDone(pack.meeting.id);
      setStep("done");
    } catch (e) {
      setError(meetingWords(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <main className="m-screen m-catchup">
        {head}
        <div className="a-card m-done" role="status">
          <b>{DONE_LINE}</b>
        </div>
        <RouteLink to={{ v: "lecture", l: pack.meeting.lecture_id }} go={ctx.go} className="a-btn">
          להרצאה
        </RouteLink>
      </main>
    );
  }

  if (step === "check" && qs[i]) {
    const q = qs[i];
    const check = async () => {
      if (picked === null) return;
      setBusy(true);
      try {
        // answering.ts, as every screen (the catch-up asks text questions only: section M 3).
        setFb((await answerAny(q, q.options.map((_, k) => k), picked, "lecture", Date.now() - t0, bet)).feedback);
      } catch (e) {
        setError(meetingWords(e));
      } finally {
        setBusy(false);
      }
    };
    const next = () => {
      setFb(null);
      setPicked(null);
      setBet(null);
      setT0(Date.now());
      if (i + 1 < qs.length) setI(i + 1);
      else void finish();
    };
    return (
      <main className="m-screen m-catchup">
        {head}
        <p className="a-small a-muted">
          בדיקה קצרה · {i + 1} מתוך {qs.length} · לבד, בלי שעון
        </p>
        <PracticeQuestion
          q={q}
          position={{ index: i + 1, total: qs.length }}
          picked={picked}
          bet={bet}
          chosen={fb ? picked : undefined}
          feedback={fb}
          busy={busy}
          nameOf={ctx.nameOf}
          me={ctx.userId}
          onPick={(k) => !fb && setPicked(k)}
          onBet={(b) => !fb && setBet(b)}
          onSlide={(n) => ctx.go({ v: "lecture", l: pack.meeting.lecture_id, slide: n })}
        />
        <StickyActions>
          {fb ? (
            <button type="button" className="a-btn primary wide" disabled={busy} onClick={next}>
              {i + 1 < qs.length ? "לשאלה הבאה" : "לסיים את ההשלמה"}
            </button>
          ) : (
            <button type="button" className="a-btn primary wide" disabled={busy || picked === null} onClick={() => void check()}>
              לבדוק
            </button>
          )}
        </StickyActions>
      </main>
    );
  }

  const empty = catchupEmpty(pack);
  const readers = pack.readers.filter(Boolean);
  return (
    <main className="m-screen m-catchup">
      {head}
      {empty ? (
        <p className="a-card flat">
          בפגישה הזו לא נשמר דבר מעבר לקריאה. אפשר לקרוא את החלקים: {slideRange(parts.find((s) => s.idx === pack.meeting.part_from)?.slide_from, parts.find((s) => s.idx === pack.meeting.part_to)?.slide_to) || "בהרצאה"}.
        </p>
      ) : null}
      {pack.stops.map((s) => (
        <div key={`${s.part}.${s.anchor}`} className="a-card flat m-piece">
          <div className="a-row between">
            <b>התעכבנו על</b>
            <span className="a-chip group">עצרנו להסביר</span>
          </div>
          <p className="a-para" dir="rtl">
            {richText((firstWords.get(`${s.part}.${s.anchor}`) ?? "").slice(0, 160) || "פסקה בהרצאה", `cs${s.part}.${s.anchor}`)}{" "}
            {slidesOf(s.part, s.anchor) ? <span className="a-tag">{slidesOf(s.part, s.anchor)}</span> : null}
          </p>
        </div>
      ))}
      {pack.resolved.map((r) => (
        <div key={r.id} className="a-card flat m-piece">
          <div className="a-row between">
            <b>שאלה שנפתרה</b>
            <span className="a-chip ok">נענתה</span>
          </div>
          <p className="a-para" dir="rtl">
            {isolateLatin(r.question, `rq${r.id}`)}
          </p>
          <div className="a-row">
            {r.answer_by ? <Avatar id={r.answer_by} name={r.answer_by} /> : null}
            <span className="a-small" dir="rtl">
              {richText(r.answer, `ra${r.id}`)}
            </span>
          </div>
        </div>
      ))}
      {pack.pins.map((p) => (
        <div key={p.id} className="a-card flat m-piece">
          <div className="a-row between">
            <b>אסוציאציה שננעצה</b>
            {p.by ? (
              <span className="a-row">
                <Avatar id={p.by} name={p.by} />
                <span className="a-small">{p.by}</span>
              </span>
            ) : null}
          </div>
          <p className="a-para" dir="rtl">
            {richText(p.body, `pb${p.id}`)}
          </p>
        </div>
      ))}
      {qs.length ? (
        <div className="a-row m-check-line">
          <Icon name="check" size={14} />
          <span className="a-small">
            <b>בדיקה קצרה:</b> {qs.length === 1 ? "שאלה אחת" : `${qs.length} שאלות`} שהקבוצה התקשתה בהן. לבד, בלי שעון.
          </span>
        </div>
      ) : null}
      <p className="a-small a-muted">
        {readers.length ? `קראו: ${readers.join(", ")}. ` : ""}בסוף ההשלמה מצטרפים לרשימה, בלי שעה ובלי ׳באיחור׳.
      </p>
      <StickyActions>
        {qs.length ? (
          <button
            type="button"
            className="a-btn primary wide"
            onClick={() => {
              setT0(Date.now());
              setStep("check");
            }}
          >
            להתחיל השלמה
          </button>
        ) : (
          <button type="button" className="a-btn primary wide" disabled={busy} onClick={() => void finish()}>
            לסיים את ההשלמה
          </button>
        )}
      </StickyActions>
    </main>
  );
}
