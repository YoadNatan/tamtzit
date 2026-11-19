import { useEffect, useState } from "react";
import { REASONS } from "../../../shared/study/aspects";
import { failText } from "../lib/failText";
import type { PublicQuestion } from "../lib/practice";
import { fixQuestion, questionForFix, type FixView } from "../lib/practice2";
import { richText } from "../lib/rich";
import { LETTERS } from "../lib/questionText";
import { Sheet } from "./Shell";

/* ── "לבדוק מול השקף": the fix sheet of a question two flags hid (Q's end) ──
 *
 * Two different members' flags (a wrong key, not in the slides, two answers,
 * unclear) took the question out of everyone's practice. Any member opens
 * this sheet: the question with its key and every explanation
 * (study_question_for_fix, the one place a key shows before an answer), the
 * flags without names, and two ways out: "להשאיר בתרגול" with 1-6 of the
 * lecture's slides that show the key is right (a citation is required), or
 * "להוציא מהתרגול" for good. The note says why, for the group. */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

export default function FixSheet({ q, slideCount, onClose, onDone }: { q: PublicQuestion; slideCount: number; onClose: () => void; onDone: (verdict: "keep" | "retire") => void }) {
  const [view, setView] = useState<FixView | null>(null);
  const [error, setError] = useState("");
  const [slides, setSlides] = useState<number[]>(() => [...new Set(q.slides)].filter((n) => n >= 1 && n <= slideCount).slice(0, 6));
  const [extra, setExtra] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    questionForFix(q.id)
      .then((v) => alive && setView(v))
      .catch((e: unknown) => alive && setError(failText(codeOf(e), "practice")));
    return () => {
      alive = false;
    };
  }, [q.id]);

  const toggle = (n: number) => setSlides((s) => (s.includes(n) ? s.filter((x) => x !== n) : s.length >= 6 ? s : [...s, n].sort((a, b) => a - b)));
  const addExtra = () => {
    const n = Math.round(Number(extra));
    if (Number.isFinite(n) && n >= 1 && n <= slideCount && !slides.includes(n) && slides.length < 6) setSlides((s) => [...s, n].sort((a, b) => a - b));
    setExtra("");
  };
  const shown = [...new Set([...q.slides.filter((n) => n >= 1 && n <= slideCount), ...slides])].sort((a, b) => a - b);

  return (
    <Sheet label="לבדוק מול השקף" className="fix-sheet" onClose={onClose} head={<h2>לבדוק מול השקף</h2>}>
      {(sheet) => {
        const run = async (verdict: "keep" | "retire") => {
          setBusy(true);
          setError("");
          try {
            await fixQuestion(q.id, verdict, verdict === "keep" ? slides : [], note);
            sheet.closeThen(() => onDone(verdict));
          } catch (e) {
            setError(failText(codeOf(e), "practice"));
            setBusy(false);
          }
        };
        return (
          <>
            <p className="a-small a-muted">שניים מהקבוצה סימנו את השאלה, ולכן היא יצאה מהתרגול של כולם. אחרי הבדיקה היא חוזרת, או יוצאת לגמרי.</p>
            {q.vignette.trim() ? (
              <p className="a-para" dir="rtl">
                {richText(q.vignette, "fv")}
              </p>
            ) : null}
            <p className="a-q" dir="rtl">
              {richText(q.question, "fq")}
            </p>
            {view ? (
              <>
                <ol className="a-opts fix-options" aria-label="התשובות וההסברים">
                  {q.options.map((o, i) => (
                    <li key={i} className={`a-opt${i === view.answer ? " correct" : ""}`}>
                      <span className="l">{LETTERS[i]}</span>
                      <span dir="rtl">{richText(o, `fo${i}`)}</span>
                      <span className="x" dir="rtl">
                        {i === view.answer ? <b>✓ המפתח. </b> : null}
                        {richText(view.explanations[i] ?? "", `fw${i}`)}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="a-sec">
                  <h3>הסימונים</h3>
                </div>
                <ul className="a-stack fix-flags">
                  {view.flags.map((f, i) => (
                    <li key={i} className="a-small" dir="rtl">
                      {REASONS[f.reason] ?? REASONS.other}
                      {f.note.trim() ? <> · ״{richText(f.note.trim(), `fn${i}`)}״</> : null}
                    </li>
                  ))}
                </ul>
                <div className="a-sec">
                  <h3 id="fix-slides-h">השקפים שמראים שהמפתח נכון</h3>
                </div>
                <div className="a-wrap" role="group" aria-labelledby="fix-slides-h">
                  {shown.map((n) => {
                    const on = slides.includes(n);
                    return (
                      <button key={n} type="button" className={`a-chip${on ? " busy" : ""}`} aria-pressed={on} onClick={() => toggle(n)}>
                        {on ? "✓ " : ""}ש׳ <bdi dir="ltr">{n}</bdi>
                      </button>
                    );
                  })}
                </div>
                <div className="a-row fix-extra">
                  <label className="sr-only" htmlFor="fix-extra">
                    שקף נוסף
                  </label>
                  <input id="fix-extra" className="a-input" type="number" inputMode="numeric" min={1} max={slideCount} placeholder="שקף נוסף" value={extra} onChange={(e) => setExtra(e.target.value)} />
                  <button type="button" className="a-btn" disabled={!extra} onClick={addExtra}>
                    להוסיף
                  </button>
                </div>
                <label className="a-field">
                  <span>למה (לא חובה)</span>
                  <textarea className="a-input" rows={2} maxLength={300} dir="rtl" placeholder="למשל: שקף 23 אומר במפורש שרק Primaquine" value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              </>
            ) : error ? null : (
              <p className="a-muted">טוען…</p>
            )}
            {error ? (
              <p className="a-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="a-row sheet-actions">
              <button type="button" className="a-btn primary" disabled={!view || busy || !slides.length} onClick={() => void run("keep")}>
                להשאיר בתרגול
              </button>
              <button type="button" className="a-btn danger" disabled={!view || busy} onClick={() => void run("retire")}>
                להוציא מהתרגול
              </button>
            </div>
          </>
        );
      }}
    </Sheet>
  );
}
