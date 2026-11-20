import type { KeyboardEvent } from "react";
import type { Feedback } from "../lib/practice";
import { richText } from "../lib/rich";

/* ── "נכון / לא נכון": a mark per statement (docs/study/question-types.md) ──
 * Each statement is a row with two buttons, "נכון" and "לא נכון", a radio
 * group labelled by the statement (44 px targets), with the radio group's
 * keyboard: one Tab stop per row (the checked button, else "נכון"), and the
 * arrows switch the mark and move focus with it. "לבדוק" waits until every
 * row is marked. After the answer each row says in words whether the mark
 * was right ("✓ צדקת: המשפט נכון" / "✗ סימנת נכון, אבל המשפט לא נכון"), with
 * its explanation and slide tags. */

export type SetProps = {
  qid: string;
  options: string[];
  value: Array<number | null>;
  onChange?: (v: Array<number | null>) => void;
  disabled?: boolean;
  /** After the answer: the key and the choices, in the shown order. */
  feedback?: Feedback | null;
  prompts?: string[];
  /** No "לבדוק" on this screen (a simulation checks at the end): the instruction says only how to mark. */
  noCheck?: boolean;
};

const TRUE_FALSE = ["לא נכון", "נכון"];

export default function TfAnswer(p: SetProps) {
  const fb = p.feedback;
  if (fb?.seq) {
    const chose = fb.choices ?? null;
    return (
      <ol className="qt-tf qt-done" aria-label="המשפטים וההסברים">
        {p.options.map((text, i) => {
          const truth = fb.seq![i];
          const mine = chose ? chose[i] : null;
          const ok = mine !== null && mine === truth;
          const line =
            mine === null
              ? `המשפט ${truth ? "נכון" : "לא נכון"}`
              : ok
                ? `✓ צדקת: המשפט ${truth ? "נכון" : "לא נכון"}`
                : `✗ סימנת ${mine ? "נכון" : "לא נכון"}, אבל המשפט ${truth ? "נכון" : "לא נכון"}`;
          return (
            <li key={i} className={`qt-row ${mine === null ? "" : ok ? "correct" : "wrong"}`.trim()}>
              <p className="qt-text" dir="rtl">
                {richText(text, `s${i}-`)}
              </p>
              <p className="qt-mark" dir="rtl">
                <b>{line}</b>
                {fb.explanations[i]?.trim() ? <> {richText(fb.explanations[i], `w${i}-`, { tags: "link" })}</> : null}
              </p>
            </li>
          );
        })}
      </ol>
    );
  }
  const mark = (i: number, v: number) => p.onChange?.(p.value.map((x, k) => (k === i ? v : x)));
  // Arrows inside a row's pair: the other mark, checked and focused (a radio group's keys).
  const onKey = (i: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) || p.disabled) return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[role=radio]")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = (at + 1) % buttons.length;
    buttons[next].focus();
    mark(i, Number(buttons[next].dataset.v));
  };
  // Until every row is marked: what to do, and why "לבדוק" waits.
  const unmarked = !p.disabled && p.value.some((v) => v === null || v === undefined);
  return (
    <>
      {unmarked ? <p className="a-small a-muted qt-how">{p.noCheck ? "מסמנים כל משפט: נכון או לא נכון." : "מסמנים כל משפט: נכון או לא נכון. ״לבדוק״ נפתח כשכולם מסומנים."}</p> : null}
    <ol className="qt-tf" aria-label="המשפטים">
      {p.options.map((text, i) => {
        const id = `tf-${p.qid}-${i}`;
        return (
          <li key={i} className="qt-row">
            <p className="qt-text" id={id} dir="rtl">
              {richText(text, `s${i}-`)}
            </p>
            <div className="a-seg qt-two" role="radiogroup" aria-labelledby={id} onKeyDown={onKey(i)}>
              {[1, 0].map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  className="a-btn"
                  data-v={v}
                  aria-checked={p.value[i] === v}
                  tabIndex={p.value[i] === v || (p.value[i] == null && v === 1) ? 0 : -1}
                  disabled={p.disabled}
                  onClick={() => mark(i, v)}
                >
                  {TRUE_FALSE[v]}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
    </>
  );
}
