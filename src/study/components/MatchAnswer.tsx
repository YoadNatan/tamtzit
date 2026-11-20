import { useEffect, useRef, useState } from "react";
import { richText } from "../lib/rich";
import type { SetProps } from "./TfAnswer";

/* ── "התאמה": tap to place, no dragging (docs/study/question-types.md) ──
 * The prompts are rows, each with its slot; the bank's chips sit below. Tap a
 * slot to choose it (aria-pressed), then a chip to place it there (focus
 * moves to the next empty slot); or tap a chip first and it waits for a
 * slot. A placed chip leaves the bank; ✕ in its slot gives it back. Every
 * control is a native button, so the keyboard works (Tab and Enter), and a
 * live line says what was placed. Focus never falls off the page: after a
 * placement it goes to the next empty slot, or to the slot just filled when
 * none is empty; after ✕, to that slot. After the answer each row says ✓ or ✗,
 * the right match and why. value[i] is the option placed at prompt i. */

export default function MatchAnswer(p: SetProps) {
  const prompts = p.prompts ?? [];
  const [slot, setSlot] = useState<number | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  const slots = useRef<Array<HTMLButtonElement | null>>([]);
  // The slot to focus once the rows are drawn again (the chip or ✕ that was pressed is gone by then).
  const focusSlot = useRef<number | null>(null);
  useEffect(() => {
    const at = focusSlot.current;
    if (at === null) return;
    focusSlot.current = null;
    slots.current[at]?.focus();
  });
  useEffect(() => {
    setSlot(null);
    setHeld(null);
    setSaid("");
  }, [p.qid]);
  const fb = p.feedback;

  if (fb?.seq) {
    const chose = fb.choices ?? null;
    return (
      <ol className="qt-match qt-done" aria-label="ההתאמות וההסברים">
        {prompts.map((pr, i) => {
          const right = fb.seq![i];
          const mine = chose ? chose[i] : null;
          const ok = mine !== null && mine === right;
          return (
            <li key={i} className={`qt-row ${mine === null ? "" : ok ? "correct" : "wrong"}`.trim()}>
              <p className="qt-text" dir="rtl">
                <b>{richText(pr, `p${i}-`)}</b>
              </p>
              <p className="qt-mark" dir="rtl">
                <b>{mine === null ? "" : ok ? "✓ נכון: " : `✗ שיבצת ${p.options[mine] ?? ""}. המתאים: `}</b>
                {mine === null ? <b>המתאים: </b> : null}
                <bdi>{richText(p.options[right] ?? "", `r${i}-`)}</bdi>
                {fb.explanations[right]?.trim() ? <> · {richText(fb.explanations[right], `w${i}-`, { tags: "link" })}</> : null}
              </p>
            </li>
          );
        })}
      </ol>
    );
  }

  const place = (at: number, option: number) => {
    const next = p.value.map((v, k) => (k === at ? option : v === option ? null : v));
    p.onChange?.(next);
    setSaid(`${p.options[option]} שובץ ליד ${prompts[at]}`);
    setSlot(null);
    setHeld(null);
    const empty = next.findIndex((v, k) => v === null && k !== at);
    focusSlot.current = empty >= 0 ? empty : at;
  };
  const placed = new Set(p.value.filter((v): v is number => v !== null));
  return (
    <div className="qt-match">
      <ol className="qt-rows" aria-label="פריטים להתאמה">
        {prompts.map((pr, i) => {
          const v = p.value[i];
          return (
            <li key={i} className="qt-row qt-pair">
              <span className="qt-text" dir="rtl">
                {richText(pr, `p${i}-`)}
              </span>
              <span className="qt-slotbox">
                <button
                  ref={(el) => (slots.current[i] = el)}
                  type="button"
                  className={`a-btn qt-slot${slot === i ? " on" : ""}${v !== null ? " full" : ""}`}
                  aria-pressed={slot === i}
                  aria-label={v !== null ? `${pr}: ${p.options[v]}` : `מקום ל${pr}`}
                  disabled={p.disabled}
                  onClick={() => (held !== null ? place(i, held) : setSlot(slot === i ? null : i))}
                >
                  {v !== null ? <bdi>{p.options[v]}</bdi> : <span className="a-muted">לבחור</span>}
                </button>
                {v !== null ? (
                  <button
                    type="button"
                    className="a-btn ghost icon qt-clear"
                    aria-label={`להחזיר את ${p.options[v]}`}
                    disabled={p.disabled}
                    onClick={() => {
                      p.onChange?.(p.value.map((x, k) => (k === i ? null : x)));
                      setSaid(`${p.options[v]} חזר לרשימה`);
                      focusSlot.current = i;
                    }}
                  >
                    ✕
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="a-wrap qt-bank" role="group" aria-label="תשובות לשיבוץ">
        {p.options.map((o, k) =>
          placed.has(k) ? null : (
            <button
              key={k}
              type="button"
              className={`a-chip qt-chip${held === k ? " on" : ""}`}
              aria-pressed={held === k}
              disabled={p.disabled}
              onClick={() => (slot !== null ? place(slot, k) : setHeld(held === k ? null : k))}
            >
              <bdi>{o}</bdi>
            </button>
          ),
        )}
      </div>
      <p className="a-small a-muted" aria-live="polite">
        {said || (slot === null && held === null ? "נוגעים במקום ואז בתשובה, או בתשובה ואז במקום." : held !== null ? "עכשיו נוגעים במקום." : "עכשיו נוגעים בתשובה.")}
      </p>
    </div>
  );
}
