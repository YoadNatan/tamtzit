import { useEffect, useRef, useState, type ReactNode } from "react";
import { failText } from "../lib/failText";
import {
  answerValue,
  dropDraft,
  loadDraft,
  numericParse,
  numLine,
  openMark,
  openShow,
  originLine,
  questionSolution,
  saveDraft,
  type SolutionOrigin,
  type ValueResult,
} from "../lib/sheetForms";
import SheetText from "./SheetText";
import "../styles/sheetForms.css";

/* ── An open or a numeric question in practice, "כמו בדף" (uploaded sheets,
 *    release A1; design-exams §5.9, D12, D13) ──
 *
 * Numeric: one field ("התשובה", the unit a fixed suffix), "לבדוק" checks it
 * at $0 within its tolerance (study_answer_value, an answer row like any
 * practice answer, OD7): "✓ נכון · 3 שעות" or "✗ התשובה: 3 שעות", and "פתרון
 * מלא" with where it came from and the tolerance. The field takes "," or ".",
 * either minus, "1.2e-3" and "1.2×10^-3"; the decimal pad (inputmode decimal), with
 * "−" and "×10ⁿ" keys under the field, since iOS's decimal pad has neither.
 * Open: the member writes on the device only (a draft kept per item in
 * localStorage, through a lock or an app switch, cleared once marked), then
 * "להראות פתרון" (study_open_show) shows the model answer, its rubric and the
 * worked solution, and "איך הלך?" (צדקתי · חלקית · טעיתי, study_open_mark) is
 * the member's own mark: personal, never an answer row (OD8).
 * No network during "לבדוק" or "להראות פתרון": the answer stays here. */

export type SheetAnswerItem = {
  id: string;
  form: "open" | "numeric";
  vignette: string;
  question: string;
  label: string;
  unit: string | null;
};
type Shown = { model_answer: string | null; rubric: string[]; solution: string | null; origin: SolutionOrigin; solution_origin: SolutionOrigin };
type Checked = { correct: boolean; num: number | null; unit: string | null; tol: number | null; solution: string | null; origin: SolutionOrigin; solution_origin: SolutionOrigin };

const OFFLINE = "אין חיבור · התשובה נשארת כאן · לנסות שוב";
const MARKS: Array<{ v: 0 | 1 | 2; label: string }> = [
  { v: 2, label: "צדקתי" },
  { v: 1, label: "חלקית" },
  { v: 0, label: "טעיתי" },
];
const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));
const offline = (e: unknown) => (typeof navigator !== "undefined" && navigator.onLine === false) || /fetch|network|load failed/i.test(codeOf(e));

export default function SheetAnswer(p: {
  item: SheetAnswerItem;
  userId: string;
  mode: string;
  /** "שאלה 3 מתוך 14", and a part's "סעיף א׳ מתוך 3". */
  position?: string;
  part?: string;
  /** A multi-part question's later part, the one before it just answered: the shared case starts folded. */
  stemFolded?: boolean;
  chips?: ReactNode;
  media?: ReactNode;
  /** Already answered in this round (correct as recorded): the verdict and the solution, read back. */
  answered: { correct: boolean } | null;
  /** The answer is in: the session records it (correct; personal: an open item's own mark, never in a score). */
  onAnswered: (correct: boolean, personal: boolean) => void;
  /** The primary action ("לבדוק" / "להראות פתרון") for the session's bottom bar, as every question's; null: none now. */
  onAction?: (a: { label: string; busy: boolean; run: () => void } | null) => void;
  onSkip?: () => void;
  /** The end of a round's list: no field, the verdict only. */
  read?: boolean;
  /** How a numeric answer is sent (a practice set's round stamps it on its attempt); study_answer_value by default. */
  sendValue?: (value: number | null, ms: number) => Promise<ValueResult>;
}) {
  const { item: q } = p;
  const shownAt = useRef(Date.now());
  const [text, setText] = useState(() => (q.form === "open" ? loadDraft(p.userId, q.id) : ""));
  const [bad, setBad] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [mark, setMark] = useState<0 | 1 | 2 | null>(null);
  const [stemOpen, setStemOpen] = useState(!p.stemFolded);
  const head = useRef<HTMLParagraphElement>(null);
  const numRef = useRef<HTMLInputElement>(null);
  /** "−" / "×10ⁿ": the sign at the caret ("1.2e-3" is a number the parser reads). */
  const insert = (c: string) => {
    const el = numRef.current;
    const at = el?.selectionStart ?? text.length;
    const to = el?.selectionEnd ?? at;
    const next = text.slice(0, at) + c + text.slice(to);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + c.length, at + c.length);
    });
  };

  // Answered before this screen (a reload, the end's list): the solution comes back once the member answered.
  useEffect(() => {
    if (!p.answered || checked || shown) return;
    let alive = true;
    questionSolution(q.id)
      .then((s) => {
        if (!alive || !s) return;
        if (q.form === "numeric")
          setChecked({ correct: p.answered!.correct, num: s.num, unit: s.num_unit, tol: s.num_tol, solution: s.solution, origin: s.origin, solution_origin: s.solution_origin });
        else setShown({ model_answer: s.model_answer, rubric: s.rubric ?? [], solution: s.solution, origin: s.origin, solution_origin: s.solution_origin });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [q.id, p.answered, q.form, checked, shown]);

  const check = async (dontKnow: boolean) => {
    const v = dontKnow ? null : numericParse(text);
    if (!dontKnow && v === null) return setBad(text.trim() ? "צריך לכתוב מספר, למשל 6.9 או ‎-0.5‎" : "צריך לכתוב תשובה");
    setBad("");
    setBusy(true);
    try {
      const ms = Date.now() - shownAt.current;
      const r = await (p.sendValue ? p.sendValue(v, ms) : answerValue(q.id, v, p.mode, ms));
      setChecked({
        correct: r.correct,
        num: r.num,
        unit: r.unit ?? q.unit,
        tol: r.tol,
        solution: r.solution,
        origin: r.origin,
        solution_origin: r.solution_origin,
      });
      p.onAnswered(r.correct, false);
      requestAnimationFrame(() => head.current?.focus());
    } catch (e) {
      setBad(offline(e) ? OFFLINE : failText(codeOf(e), "exam"));
    } finally {
      setBusy(false);
    }
  };
  const show = async () => {
    setBusy(true);
    setBad("");
    try {
      const r = await openShow(q.id);
      setShown({ model_answer: r.model_answer, rubric: r.rubric ?? [], solution: r.solution, origin: r.origin, solution_origin: r.solution_origin });
      requestAnimationFrame(() => head.current?.focus());
    } catch (e) {
      setBad(offline(e) ? OFFLINE : failText(codeOf(e), "exam"));
    } finally {
      setBusy(false);
    }
  };
  const self = async (m: 0 | 1 | 2) => {
    setBusy(true);
    setBad("");
    try {
      await openMark(q.id, m);
      setMark(m);
      dropDraft(p.userId, q.id);
      p.onAnswered(m === 2, true);
    } catch (e) {
      setBad(offline(e) ? OFFLINE : failText(codeOf(e), "exam"));
    } finally {
      setBusy(false);
    }
  };

  const fieldId = `sa-in-${q.id}`;
  const done = Boolean(p.answered) || mark !== null;
  // The bottom bar's button: "לבדוק" before a numeric answer, "להראות פתרון" before an open one's solution.
  const act = p.read || done ? null : q.form === "numeric" ? (checked ? null : "check") : shown ? null : "show";
  const runRef = useRef<() => void>(() => undefined);
  runRef.current = () => void (act === "check" ? check(false) : show());
  const { onAction } = p;
  useEffect(() => {
    onAction?.(act ? { label: busy ? (act === "check" ? "בודקים…" : "רגע…") : act === "check" ? "לבדוק" : "להראות פתרון", busy, run: () => runRef.current() } : null);
  }, [act, busy, onAction]);
  useEffect(() => () => onAction?.(null), [onAction]);
  const stem = q.vignette.trim() ? (
    p.stemFolded ? (
      <details className="sa-stem-fold" open={stemOpen} onToggle={(e) => setStemOpen(e.currentTarget.open)}>
        <summary className="a-small">{stemOpen ? "המקרה" : "המקרה (להראות)"}</summary>
        <SheetText text={q.vignette} label={q.label} />
      </details>
    ) : (
      <SheetText text={q.vignette} label={q.label} />
    )
  ) : null;
  const solution = (s: { solution: string | null; solution_origin: SolutionOrigin; tol?: number | null }) =>
    s.solution || s.tol ? (
      <details className="sa-sol">
        <summary>פתרון מלא</summary>
        {s.solution ? <SheetText text={s.solution} label={q.label} /> : null}
        {s.solution && originLine(s.solution_origin) ? <p className="a-small a-muted">{originLine(s.solution_origin)}</p> : null}
        {q.form === "numeric" && s.tol ? <p className="a-small a-muted">בטווח של ±{s.tol}%</p> : null}
      </details>
    ) : null;

  return (
    <article className="pq sa" aria-label={p.position}>
      <div className="a-row between pq-meta">
        <span className="a-row pq-chips">
          <span className="a-chip pq-style">{q.form === "numeric" ? "שאלה מספרית" : "שאלה פתוחה"}</span>
          {p.part ? <span className="a-chip pq-step sa-part-chip">{p.part}</span> : null}
          {p.chips}
        </span>
      </div>
      {stem}
      <SheetText text={q.question} label={q.label} className="pq-lead" />
      {p.media}

      {q.form === "numeric" ? (
        checked ? (
          <section className="a-stack" aria-live="polite">
            <p ref={head} tabIndex={-1} className={`sa-verdict${checked.correct ? " ok" : ""}`}>
              {checked.correct ? `✓ נכון · ${numLine(checked.num, checked.unit)}` : `✗ התשובה: ${numLine(checked.num, checked.unit)}`}
            </p>
            {checked.origin === "solved" ? <p className="a-small"><span className="a-chip warn">תשובה מוצעת · לא נבדקה</span></p> : null}
            {solution(checked)}
          </section>
        ) : p.read || done ? (
          <p className="sa-verdict">{p.answered?.correct ? "✓ נכון" : "✗ טעות"}</p>
        ) : (
          <div className="a-stack">
            <label className="a-field" htmlFor={fieldId}>
              <span>התשובה{q.unit ? ` (${q.unit})` : ""}</span>
            </label>
            <div className="sa-num">
              <input
                id={fieldId}
                ref={numRef}
                className="a-input"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                dir="ltr"
                value={text}
                disabled={busy}
                aria-describedby={bad ? `${fieldId}-bad` : undefined}
                aria-invalid={bad ? true : undefined}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void check(false);
                  }
                }}
              />
              {q.unit ? (
                <span className="sa-unit" aria-hidden="true">
                  {q.unit}
                </span>
              ) : null}
            </div>
            {/* The numbers pad has no minus and no exponent on every phone: the two keys it lacks. */}
            <div className="a-row sa-keys" role="group" aria-label="סימנים למספר">
              <button type="button" className="a-btn small" aria-label="מינוס" disabled={busy} onClick={() => insert("-")}>
                −
              </button>
              <button type="button" className="a-btn small" aria-label="כפול 10 בחזקת" disabled={busy} onClick={() => insert("e")}>
                ×10ⁿ
              </button>
            </div>
            {bad ? (
              <p id={`${fieldId}-bad`} className="a-small a-error" role="alert">
                {bad}
              </p>
            ) : null}
            <div className="a-row">
              <button type="button" className="a-link pq-dont-know" disabled={busy} onClick={() => void check(true)}>
                לא יודעים
              </button>
              {p.onSkip ? (
                <button type="button" className="a-link" disabled={busy} onClick={p.onSkip}>
                  לדלג
                </button>
              ) : null}
            </div>

          </div>
        )
      ) : (
        <>
          {!shown && !p.read && !done ? (
            <div className="a-stack">
              <label className="a-field" htmlFor={fieldId}>
                <span>התשובה שלך</span>
                <textarea
                  id={fieldId}
                  className="a-input"
                  rows={4}
                  dir="auto"
                  placeholder="לכתוב תשובה (נשאר במכשיר)"
                  value={text}
                  disabled={busy}
                  onChange={(e) => {
                    setText(e.target.value);
                    saveDraft(p.userId, q.id, e.target.value);
                  }}
                />
              </label>
              {bad ? (
                <p className="a-small a-error" role="alert">
                  {bad}
                </p>
              ) : null}
              <p className="a-small a-muted">שאלות פתוחות נבדקות לבד ונספרות רק בהתקדמות האישית.</p>
              {p.onSkip ? (
                <div className="a-row">
                  <button type="button" className="a-link" disabled={busy} onClick={p.onSkip}>
                    לדלג
                  </button>
                </div>
              ) : null}

            </div>
          ) : null}
          {shown ? (
            <section className="a-stack" aria-live="polite">
              {text.trim() && !done ? (
                <div className="a-callout quiet">
                  <p className="a-small a-muted">מה שכתבת:</p>
                  <p className="st-p" dir="auto">
                    {text}
                  </p>
                </div>
              ) : null}
              <p ref={head} tabIndex={-1} className="sa-verdict">
                {shown.origin === "solved" ? "תשובה מוצעת · לא נבדקה" : originLine(shown.origin) || "התשובה"}
              </p>
              {shown.model_answer ? <SheetText text={shown.model_answer} label={q.label} /> : <p className="a-muted">אין עדיין תשובה לשאלה הזו.</p>}
              {shown.rubric.length ? (
                <ul className="sa-rubric" aria-label="מה צריך להיות בתשובה">
                  {shown.rubric.map((r, i) => (
                    <li key={i} dir="auto">
                      {r}
                    </li>
                  ))}
                </ul>
              ) : null}
              {solution(shown)}
              {!p.read ? (
                <div className="sa-self">
                  <p className="a-small" id={`sa-self-${q.id}`}>
                    איך הלך?
                  </p>
                  <div className="a-seg" role="radiogroup" aria-labelledby={`sa-self-${q.id}`}>
                    {MARKS.map((m) => (
                      <button key={m.v} type="button" className="a-btn" role="radio" aria-checked={mark === m.v} disabled={busy || done} onClick={() => void self(m.v)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {bad ? (
                    <p className="a-small a-error" role="alert">
                      {bad}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : p.read || done ? (
            <p className="a-small a-muted">{p.answered?.correct ? "סימנת: צדקתי" : "סומנה"}</p>
          ) : null}
        </>
      )}
    </article>
  );
}
