import type { Feedback } from "../lib/practice";
import { richText } from "../lib/rich";

/* ── "נכון / לא נכון": a mark per statement (docs/study/question-types.md) ──
 * Each statement is a row with two buttons, "נכון" and "לא נכון", a radio
 * group labelled by the statement (44 px targets). "לבדוק" waits until every
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
  return (
    <ol className="qt-tf" aria-label="המשפטים">
      {p.options.map((text, i) => {
        const id = `tf-${p.qid}-${i}`;
        return (
          <li key={i} className="qt-row">
            <p className="qt-text" id={id} dir="rtl">
              {richText(text, `s${i}-`)}
            </p>
            <div className="a-seg qt-two" role="radiogroup" aria-labelledby={id}>
              {[1, 0].map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  className="a-btn"
                  aria-checked={p.value[i] === v}
                  disabled={p.disabled}
                  onClick={() => p.onChange?.(p.value.map((x, k) => (k === i ? v : x)))}
                >
                  {TRUE_FALSE[v]}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
