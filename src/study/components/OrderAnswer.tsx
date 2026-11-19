import { richText } from "../lib/rich";
import type { SetProps } from "./TfAnswer";

/* ── "סידור": put the steps in order (docs/study/question-types.md) ──
 * "הסדר שלך" is a numbered list on top, "השלבים" the pool below. Tapping a
 * step of the pool adds it at the end of the order; each placed step has
 * ↑ ↓ ✕ (44 px, named for a screen reader). No dragging. After the answer
 * each place says ✓ or ✗, then the right order with why each step sits
 * there. value[pos] is the option at that place (null: still empty). */

const compact = (v: Array<number | null>): Array<number | null> => {
  const placed = v.filter((x): x is number => x !== null);
  return v.map((_, i) => placed[i] ?? null);
};

export default function OrderAnswer(p: SetProps) {
  const fb = p.feedback;
  if (fb?.seq) {
    const chose = fb.choices ?? null;
    return (
      <div className="qt-order qt-done">
        {chose ? (
          <>
            <h3 className="a-small">הסדר שלך</h3>
            <ol className="qt-rows" aria-label="הסדר שלך">
              {chose.map((o, pos) => {
                const ok = o === fb.seq![pos];
                return (
                  <li key={pos} className={`qt-row ${ok ? "correct" : "wrong"}`}>
                    <b className="qt-mark">{ok ? "✓" : "✗"}</b> <bdi>{richText(p.options[o] ?? "", `c${pos}-`)}</bdi>
                    <span className="a-small a-muted"> {ok ? "במקום הנכון" : "לא במקום הזה"}</span>
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
        <h3 className="a-small">הסדר הנכון</h3>
        <ol className="qt-rows" aria-label="הסדר הנכון">
          {fb.seq.map((o, pos) => (
            <li key={pos} className="qt-row correct">
              <bdi>{richText(p.options[o] ?? "", `k${pos}-`)}</bdi>
              {fb.explanations[o]?.trim() ? (
                <p className="qt-mark" dir="rtl">
                  {richText(fb.explanations[o], `w${pos}-`, { tags: "link" })}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  const value = p.value;
  const placed = value.filter((x): x is number => x !== null);
  const set = (v: Array<number | null>) => p.onChange?.(compact(v));
  const move = (pos: number, d: -1 | 1) => {
    const to = pos + d;
    if (to < 0 || to >= placed.length) return;
    const v = [...value];
    [v[pos], v[to]] = [v[to], v[pos]];
    set(v);
  };
  return (
    <div className="qt-order">
      <h3 className="a-small" id={`order-${p.qid}`}>
        הסדר שלך
      </h3>
      {placed.length ? (
        <ol className="qt-rows qt-placed" aria-labelledby={`order-${p.qid}`}>
          {placed.map((o, pos) => (
            <li key={o} className="qt-row qt-step">
              <span className="qt-text" dir="rtl">
                <bdi>{richText(p.options[o], `o${pos}-`)}</bdi>
              </span>
              <span className="qt-moves">
                <button type="button" className="a-btn ghost icon" aria-label={`להזיז למעלה: ${p.options[o]}`} disabled={p.disabled || pos === 0} onClick={() => move(pos, -1)}>
                  ↑
                </button>
                <button type="button" className="a-btn ghost icon" aria-label={`להזיז למטה: ${p.options[o]}`} disabled={p.disabled || pos === placed.length - 1} onClick={() => move(pos, 1)}>
                  ↓
                </button>
                <button type="button" className="a-btn ghost icon" aria-label={`להוציא: ${p.options[o]}`} disabled={p.disabled} onClick={() => set(value.map((x) => (x === o ? null : x)))}>
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="a-small a-muted">לגעת בשלבים לפי הסדר, מהראשון לאחרון.</p>
      )}
      <h3 className="a-small" id={`pool-${p.qid}`}>
        השלבים
      </h3>
      <div className="a-wrap qt-bank" role="group" aria-labelledby={`pool-${p.qid}`}>
        {p.options.map((o, k) =>
          placed.includes(k) ? null : (
            <button key={k} type="button" className="a-chip qt-chip" disabled={p.disabled} onClick={() => set([...placed, k, ...value.slice(placed.length + 1)])}>
              <bdi>{o}</bdi>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
