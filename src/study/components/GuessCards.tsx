import { useCallback, useEffect, useState } from "react";
import { guess, guessLine, guessState, meetingWords, pickGuesses, type GuessItem } from "../lib/meeting";
import { isolateLatin, richText } from "../lib/rich";

/* ── The pre-guess (package M, M-2; meeting.html s1, the meeting design §4.3
 * item 8) ──
 *
 * Two questions on the meeting's first part, answered privately before the
 * reading (never a mistake: not in study_answers, no bet, no key): "ניחוש על
 * היום · 1 מתוך 2" with the chip "יידלק בהקראה". The answer lights up when the
 * reading reaches its paragraph with two others following (the meeting row's
 * guess_released, live): the explanation, the slide and her own line
 * ("ניחשת …, כמו רוב הקבוצה" · "רק לך"), never a number. */

const LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"];

export default function GuessCards({ meetingId, released, canPick }: { meetingId: string; released: number; canPick: boolean }) {
  const [items, setItems] = useState<GuessItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openN, setOpenN] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      if (canPick) await pickGuesses(meetingId);
      setItems(await guessState(meetingId));
    } catch {
      setItems((x) => x ?? []);
    }
  }, [meetingId, canPick]);
  useEffect(() => {
    void load();
  }, [load, released]);

  if (!items?.length) return null;
  const choose = async (g: GuessItem, i: number) => {
    setBusy(true);
    setError("");
    try {
      await guess(meetingId, g.q.id, i);
      setItems((xs) => (xs ?? []).map((x) => (x.n === g.n ? { ...x, mine: i } : x)));
      setOpenN(null);
    } catch (e) {
      setError(meetingWords(e));
      void load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="a-stack m-guesses" aria-label="ניחוש לפני ההקראה">
      {items.map((g) =>
        g.released ? (
          <div key={g.n} className="a-card m-lit">
            <b>התשובה לניחוש {g.n}</b>
            <p className="a-small" dir="rtl">
              {isolateLatin(g.q.question, `gq${g.n}`)}
            </p>
            {g.explanation ? (
              <p className="a-para" dir="rtl">
                {richText(g.explanation, `ge${g.n}`)}
              </p>
            ) : null}
            <div className="a-row between">
              <span className="a-small a-muted" dir="rtl">
                {isolateLatin(guessLine(g, (i) => g.q.options[i] ?? LETTERS[i] ?? ""), `gl${g.n}`)}
              </span>
              <span className="a-chip">רק לך</span>
            </div>
          </div>
        ) : (
          <div key={g.n} className="a-card flat m-guess">
            <div className="a-row between">
              <b className="a-small">
                ניחוש על היום · {g.n} מתוך {items.length}
              </b>
              <span className="a-chip group">יידלק בהקראה</span>
            </div>
            <p className="a-small" dir="rtl">
              {isolateLatin(g.q.question, `gq${g.n}`)}
            </p>
            {openN === g.n ? (
              <>
                {g.q.vignette ? (
                  <p className="a-small a-muted" dir="rtl">
                    {isolateLatin(g.q.vignette, `gv${g.n}`)}
                  </p>
                ) : null}
                <div className="a-opts" role="radiogroup" aria-label={`ניחוש ${g.n}`}>
                  {g.q.options.map((o, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`a-opt${g.mine === i ? " picked" : ""}`}
                      role="radio"
                      aria-checked={g.mine === i}
                      disabled={busy}
                      onClick={() => void choose(g, i)}
                    >
                      <span className="l">{LETTERS[i] ?? i + 1}</span>
                      <span dir="rtl">{isolateLatin(o, `go${g.n}.${i}`)}</span>
                    </button>
                  ))}
                </div>
                <p className="a-small a-muted">רק לך. ניחוש לא נחשב טעות.</p>
              </>
            ) : (
              <div className="a-row between">
                <span className="a-small a-muted" dir="rtl">
                  {g.mine === null ? "עוד לא ניחשת." : isolateLatin(`ניחשת ${g.q.options[g.mine] ?? ""}.`, `gm${g.n}`)}
                </span>
                <button type="button" className="a-btn small m-guess-open" onClick={() => setOpenN(g.n)}>
                  {g.mine === null ? "לנחש" : "לשנות"}
                </button>
              </div>
            )}
          </div>
        ),
      )}
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
