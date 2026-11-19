import { useCallback, useEffect, useState } from "react";
import { clozeQuestion } from "../../../shared/study/cloze";
import { setPracticeCount } from "../features/anchor";
import { AddTrap } from "../features/extras";
import type { LectureCtx, Spot } from "../features/types";
import { countWord } from "../lib/anchor";
import {
  cardState,
  groupLine,
  paragraphPractice,
  paragraphSession,
  practiceable,
  questionKind,
  questionState,
  questionStillTrue,
  tabCount,
  type ParagraphPractice,
} from "../lib/anchorTab";
import { flags } from "../lib/flags";
import { cardStillTrue } from "../lib/cardsDeck";
import { failText } from "../lib/failText";
import { isolateLatin } from "../lib/rich";

/* ── The paragraph sheet's "תרגול" tab (package N; proposal/mockups/anchor.html s2) ──
 *
 * The paragraph's questions and cards, the group's, each with the member's
 * own state: "טעית פעמיים" · "טעית" · "עוד לא ענית" · "ענית נכון", "בחפיסה"
 * · "עוד לא בחפיסה", and why one is out of practice ("בבדיקה אחרי תיקון
 * בפסקה", "הוסתרה עד בדיקה"). The states are hers only ("הסימונים" · "רק
 * לך"). "לתרגל את הפסקה · 2 שאלות" starts a session of exactly those
 * questions (?v=practice&s=p.<lecture>.<part>.<anchor>). A question or card
 * a correction marked ("בבדיקה אחרי תיקון בפסקה") offers "עדיין נכון", as the
 * deck does for cards: any member's tap puts it back for the whole group
 * (review SEC4-1: without it a marked question never came back). */

const plain = (t: string) => t.replace(/\*\*/g, "").trim();

export default function PracticeTab({ lc, spot }: { lc: LectureCtx; spot: Spot }) {
  const lectureId = lc.lecture.id;
  const [data, setData] = useState<ParagraphPractice | null>(null);
  const [error, setError] = useState(false);
  const [try_, setTry] = useState(0);
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(false);
    paragraphPractice(lectureId, spot.part, spot.anchor)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setPracticeCount(lectureId, spot, tabCount(d) - d.cards.length, d.cards.length);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [lectureId, spot.part, spot.anchor, try_]);

  const stillTrue = async (kind: "question" | "card", id: string) => {
    setChecking(id);
    try {
      await (kind === "question" ? questionStillTrue(id) : cardStillTrue(id));
      lc.ctx.say(kind === "question" ? "סומן כנכון. השאלה חוזרת לתרגול." : "סומן כנכון. הכרטיסייה חוזרת לחזרות.");
      setTry((n) => n + 1);
    } catch (e) {
      lc.ctx.say(failText(e instanceof Error ? e.message : "", kind === "question" ? "practice" : "cards"));
    } finally {
      setChecking(null);
    }
  };

  const start = useCallback(() => {
    lc.ctx.go({ v: "practice", s: paragraphSession(lectureId, spot.part, spot.anchor), n: "all" });
  }, [lc.ctx, lectureId, spot.part, spot.anchor]);

  if (error)
    return (
      <div className="a-stack n-tab">
        <p className="a-error" role="alert">
          התרגול של הפסקה לא נטען. כדאי לבדוק את החיבור ולנסות שוב.
        </p>
        <button type="button" className="a-btn" onClick={() => setTry((n) => n + 1)}>
          לנסות שוב
        </button>
      </div>
    );
  if (!data) return <p className="a-small a-muted loading">טוען…</p>;
  if (!data.questions.length && !data.cards.length)
    return (
      <div className="a-card dashed n-empty">
        <p className="a-small a-muted">עוד אין שאלות או כרטיסיות על הפסקה הזו.</p>
        <AddTrap lc={lc} spot={spot} />
      </div>
    );

  const ready = practiceable(data.questions);
  const line = groupLine(data);
  return (
    <div className="a-stack n-tab">
      <div className="a-row between n-tab-head">
        <span className="a-small a-muted">{line}</span>
        <span className="a-row n-marks">
          <span className="a-small a-muted">הסימונים</span>
          <span className="a-chip">רק לך</span>
        </span>
      </div>
      <ul className="a-list n-items" aria-label="השאלות והכרטיסיות של הפסקה">
        {data.questions.map((q) => {
          const st = questionState(q);
          return (
            <li key={q.id} className="a-li n-item" data-kind="question">
              <div>
                <span className="a-row between">
                  <span className="m">{questionKind(q)}</span>
                  <span className={`a-chip${st.tone ? ` ${st.tone}` : ""}`}>{st.label}</span>
                </span>
                <b dir="rtl">{isolateLatin(plain(q.question), `q${q.id}`)}</b>
                {q.stale && !q.hidden ? (
                  <div className="a-callout warn n-stale">
                    <span>הפסקה של השאלה הזו תוקנה. כדאי לבדוק שהיא עדיין נכונה; עד אז היא לא מופיעה בתרגול.</span>
                    <div className="a-row">
                      <button type="button" className="a-btn small" disabled={checking === q.id} onClick={() => void stillTrue("question", q.id)}>
                        עדיין נכון
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
        {data.cards.map((c) => {
          const st = cardState(c);
          return (
            <li key={c.id} className="a-li n-item" data-kind="card">
              <div>
                <span className="a-row between">
                  <span className="m">כרטיסייה</span>
                  <span className={`a-chip${st.tone ? ` ${st.tone}` : ""}`}>{st.label}</span>
                </span>
                <b dir="rtl">{isolateLatin(plain(c.kind === "cloze" ? clozeQuestion(c.front, "…") : c.front), `c${c.id}`)}</b>
                {c.stale ? (
                  <div className="a-callout warn n-stale">
                    <span>הפסקה של הכרטיסייה הזו תוקנה. כדאי לבדוק שהיא עדיין נכונה; עד אז היא לא מופיעה בחזרות.</span>
                    <div className="a-row">
                      <button type="button" className="a-btn small" disabled={checking === c.id} onClick={() => void stillTrue("card", c.id)}>
                        עדיין נכון
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {ready.length && flags.practice ? (
        <button type="button" className="a-btn primary wide n-start" onClick={start}>
          לתרגל את הפסקה · {countWord(ready.length, "שאלה אחת", "שאלות")}
        </button>
      ) : null}
      {/* E (P11): a trap of one's own on this paragraph. */}
      <AddTrap lc={lc} spot={spot} />
    </div>
  );
}
