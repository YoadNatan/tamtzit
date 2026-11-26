import { useEffect, useRef, useState } from "react";
import { LETTERS, type ReviewItem } from "../lib/exams";
import { failText } from "../lib/failText";
import {
  FORM_NAME,
  itemAdd,
  itemFix,
  itemSolution,
  labelOf,
  MAX_FIGURES,
  maxOptions,
  numericParse,
  numText,
  wholePage,
  type ItemPatch,
  type SheetFormName,
  type SolutionPatch,
} from "../lib/sheetForms";
import PageView from "./PageView";
import "../styles/sheetForms.css";

/* ── The edit sheet and the answer editor (uploaded sheets, release A1;
 *    design-exams §5.8, §5.6 "⋯ עוד") ──
 *
 * "לתקן את השאלה {label}" (study_exam_item_fix) and "+ להוסיף שאלה שלא
 * הועתקה" (study_exam_item_add): the label, the form (בחירה · נכון/לא נכון ·
 * התאמה · פתוחה · מספרית), the case text and the question (their lines
 * kept), the options (moved, removed, up to 10 for one answer, 6 for
 * true/false and match), a match item's rows, and up to 4 figure boxes:
 * "לסמן על העמוד" draws one on the page (PageView's "לסמן" toggle; with it
 * off the page scrolls and zooms), "כל העמוד כאיור" takes the whole page in
 * one tap (and with a screen reader), "להסיר" takes them off. Once anyone
 * answered or marked the item only its text may change: "כבר ענו על השאלה:
 * אפשר לתקן רק טקסט." Every change is for the whole group and is logged.
 *
 * "לתקן תשובה" beyond a choice (study_item_solution): a numeric item's
 * number, unit and tolerance, an open item's model answer and rubric, and
 * any item's worked solution. */

type Draft = { label: string; form: SheetFormName; vignette: string; question: string; options: string[]; prompts: string[]; figures: string[]; page: number };
const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));
const FORMS: SheetFormName[] = ["one", "tf", "match", "open", "numeric"];

export default function EditSheet(p: {
  groupId: string;
  examId: string;
  /** The item to fix; none: a new one ("+ להוסיף שאלה שלא הועתקה"). */
  q: ReviewItem | null;
  pages: number[];
  /** A new item's page (the one on screen). */
  page: number;
  /** Open on the figures ("לסמן איור"). */
  figuresFirst?: boolean;
  onDone: (said: string) => void;
  onCancel: () => void;
  onRetire?: () => void;
}) {
  const { q } = p;
  const used = Boolean(q && (q.answered || q.marked));
  const [d, setD] = useState<Draft>(() => ({
    label: q ? labelOf(q) : "",
    form: (q?.form as SheetFormName) ?? "one",
    vignette: q?.vignette ?? "",
    question: q?.question ?? "",
    options: q ? [...q.options] : ["", ""],
    prompts: q ? [...q.prompts] : [],
    figures: q ? [...(q.figures ?? (q.figure ? [q.figure] : []))] : [],
    page: q?.page ?? p.page,
  }));
  const [drawOn, setDrawOn] = useState(Boolean(p.figuresFirst));
  const [sending, setSending] = useState(false);
  const [bad, setBad] = useState("");
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    head.current?.focus();
    head.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const set = (x: Partial<Draft>) => setD((v) => ({ ...v, ...x }));
  const choice = d.form === "one" || d.form === "tf" || d.form === "match";
  const max = maxOptions(d.form);
  const title = q ? `לתקן את שאלה ${labelOf(q)}` : "להוסיף שאלה שלא הועתקה";
  const figPage = d.figures.length ? Number(/^pg:(\d+):/.exec(d.figures[d.figures.length - 1])?.[1] ?? d.page) : d.page;
  const [viewPage, setViewPage] = useState(figPage);

  const save = async () => {
    setBad("");
    const label = d.label.trim();
    if (!label) return setBad("צריך מספור, כמו בדף (למשל 3 או 3א).");
    if (d.question.trim().length < 2) return setBad("צריך את טקסט השאלה.");
    const opts = d.options.map((o) => o.trim());
    if (choice && (opts.length < 2 || opts.some((o) => !o))) return setBad("לכל אפשרות צריך טקסט, ולפחות שתיים.");
    if (d.form === "match" && (d.prompts.length < 2 || d.prompts.some((x) => !x.trim()))) return setBad("בשאלת התאמה צריך לפחות שתי שורות להתאים.");
    setSending(true);
    try {
      const base: ItemPatch = { label, vignette: d.vignette, question: d.question, figures: d.figures };
      if (!used) Object.assign(base, { form: d.form });
      if (choice) base.options = opts;
      if (d.form === "match") base.prompts = d.prompts.map((x) => x.trim());
      if (q) {
        // Only what changed: once the item was answered, its form and its number of options stay.
        const patch: ItemPatch = {};
        if (label !== labelOf(q)) patch.label = label;
        if (!used && d.form !== q.form) patch.form = d.form;
        if (d.vignette !== q.vignette) patch.vignette = d.vignette;
        if (d.question !== q.question) patch.question = d.question;
        if (choice && JSON.stringify(opts) !== JSON.stringify(q.options)) patch.options = opts;
        if (d.form === "match" && JSON.stringify(base.prompts) !== JSON.stringify(q.prompts)) patch.prompts = base.prompts;
        if (JSON.stringify(d.figures) !== JSON.stringify(q.figures ?? (q.figure ? [q.figure] : []))) patch.figures = d.figures;
        if (!Object.keys(patch).length) return p.onCancel();
        await itemFix(q.id, patch);
        p.onDone("התיקון נשמר.");
      } else {
        await itemAdd(p.examId, { ...base, label, form: d.form, question: d.question, page: d.page });
        p.onDone(`שאלה ${label} נוספה.`);
      }
    } catch (e) {
      setBad(failText(codeOf(e), "exam") || "השינוי לא נשמר. כדאי לנסות שוב.");
    } finally {
      setSending(false);
    }
  };

  const move = (list: "options" | "prompts", i: number, by: -1 | 1) =>
    setD((v) => {
      const a = [...v[list]];
      const j = i + by;
      if (j < 0 || j >= a.length) return v;
      [a[i], a[j]] = [a[j], a[i]];
      return { ...v, [list]: a };
    });
  const listEditor = (list: "options" | "prompts", name: (i: number) => string, cap: number, addLabel: string) => (
    <div className="a-stack">
      {d[list].map((o, i) => (
        <div key={i} className="se-opt">
          <span className="l" aria-hidden="true">
            {list === "options" ? LETTERS[i] : `${i + 1}.`}
          </span>
          <input
            className="a-input"
            dir="auto"
            aria-label={name(i)}
            value={o}
            disabled={sending}
            onChange={(e) => set({ [list]: d[list].map((x, k) => (k === i ? e.target.value : x)) } as Partial<Draft>)}
          />
          <button type="button" className="a-btn ghost small" aria-label={`להעלות את ${name(i)}`} disabled={sending || used || i === 0} onClick={() => move(list, i, -1)}>
            ↑
          </button>
          <button type="button" className="a-btn ghost small" aria-label={`להוריד את ${name(i)}`} disabled={sending || used || i === d[list].length - 1} onClick={() => move(list, i, 1)}>
            ↓
          </button>
          <button
            type="button"
            className="a-btn ghost small"
            aria-label={`להסיר את ${name(i)}`}
            disabled={sending || used || d[list].length <= 2}
            onClick={() => set({ [list]: d[list].filter((_, k) => k !== i) } as Partial<Draft>)}
          >
            ✕
          </button>
        </div>
      ))}
      {!used && d[list].length < cap ? (
        <button type="button" className="a-btn small" disabled={sending} onClick={() => set({ [list]: [...d[list], ""] } as Partial<Draft>)}>
          {addLabel}
        </button>
      ) : null}
    </div>
  );

  return (
    <section className="a-card se" aria-labelledby="se-title">
      <div className="a-row between">
        <h3 id="se-title" ref={head} tabIndex={-1}>
          {title}
        </h3>
        <button type="button" className="a-btn ghost small" aria-label="סגירה" disabled={sending} onClick={p.onCancel}>
          ✕
        </button>
      </div>
      {used ? <p className="a-callout quiet a-small">כבר ענו על השאלה: אפשר לתקן רק טקסט.</p> : null}
      <label className="a-field">
        <span>מספור</span>
        <input className="a-input se-label" dir="auto" maxLength={20} value={d.label} disabled={sending} onChange={(e) => set({ label: e.target.value })} />
      </label>
      {!q ? (
        <label className="a-field">
          <span>עמוד</span>
          <select className="a-input" value={d.page} disabled={sending} onChange={(e) => set({ page: Number(e.target.value) })}>
            {p.pages.map((n) => (
              <option key={n} value={n}>
                עמוד {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="a-field">
        <span id="se-form">סוג</span>
        <div className="se-forms" role="radiogroup" aria-labelledby="se-form">
          {FORMS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              className="a-chip"
              aria-checked={d.form === f}
              disabled={sending || used}
              onClick={() =>
                set({
                  form: f,
                  options: f === "open" || f === "numeric" ? [] : d.options.length >= 2 ? d.options.slice(0, maxOptions(f)) : ["", ""],
                  prompts: f === "match" ? (d.prompts.length ? d.prompts : ["", ""]) : [],
                })
              }
            >
              {FORM_NAME[f]}
            </button>
          ))}
        </div>
      </div>
      <label className="a-field">
        <span>טקסט המקרה</span>
        <textarea className="a-input" rows={4} dir="auto" value={d.vignette} disabled={sending} onChange={(e) => set({ vignette: e.target.value })} />
      </label>
      <label className="a-field">
        <span>השאלה</span>
        <textarea className="a-input" rows={4} dir="auto" value={d.question} disabled={sending} onChange={(e) => set({ question: e.target.value })} />
      </label>
      <p className="a-small a-muted">השורות נשמרות כמו שהן. טבלה: שורה לכל שורה בטבלה, עם | בין התאים.</p>
      {d.form === "match" ? (
        <div className="a-field">
          <span>מה להתאים</span>
          {listEditor("prompts", (i) => `שורה ${i + 1}`, 6, "+ שורה")}
        </div>
      ) : null}
      {choice ? (
        <div className="a-field">
          <span>{d.form === "tf" ? "משפטים" : "אפשרויות"}</span>
          {listEditor("options", (i) => `${d.form === "tf" ? "משפט" : "אפשרות"} ${LETTERS[i]}`, max, d.form === "tf" ? "+ משפט" : "+ אפשרות")}
        </div>
      ) : null}
      <div className="a-field">
        <span>איור</span>
        {d.figures.length ? (
          <ul className="a-stack">
            {d.figures.map((f, i) => (
              <li key={f + i} className="a-row between">
                <span className="a-small">{`איור ${i + 1} · עמוד ${/^pg:(\d+):/.exec(f)?.[1] ?? "?"}${/:0,0,1000,1000$/.test(f) ? " · כל העמוד" : ""}`}</span>
                <button type="button" className="a-btn ghost small" aria-label={`להסיר את איור ${i + 1}`} disabled={sending} onClick={() => set({ figures: d.figures.filter((_, k) => k !== i) })}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="a-small a-muted">אין איור.</p>
        )}
        <div className="se-figs">
          <button type="button" className="a-btn small" aria-expanded={drawOn} disabled={sending || d.figures.length >= MAX_FIGURES} onClick={() => setDrawOn((v) => !v)}>
            לסמן על העמוד
          </button>
          <button
            type="button"
            className="a-btn small"
            disabled={sending || d.figures.length >= MAX_FIGURES}
            onClick={() => set({ figures: [...d.figures.filter((f) => !f.startsWith(`pg:${viewPage}:0,0,1000,1000`)), wholePage(viewPage)].slice(0, MAX_FIGURES) })}
          >
            כל העמוד כאיור
          </button>
          {d.figures.length ? (
            <button type="button" className="a-btn small" disabled={sending} onClick={() => set({ figures: [] })}>
              להסיר
            </button>
          ) : null}
        </div>
        {drawOn ? (
          <div className="se-draw">
            <p className="a-small a-muted">״לסמן״ פעיל: גוררים מסגרת סביב האיור. כבוי: אפשר לגלול ולהגדיל. עד 4 איורים.</p>
            <PageView
              groupId={p.groupId}
              examId={p.examId}
              pages={p.pages}
              page={viewPage}
              items={[]}
              current={null}
              onPage={setViewPage}
              onPick={() => undefined}
              draw={{ boxes: d.figures, full: d.figures.length >= MAX_FIGURES, onBox: (f) => setD((v) => ({ ...v, figures: [...v.figures, f].slice(0, MAX_FIGURES) })) }}
            />
          </div>
        ) : null}
      </div>
      {bad ? (
        <p className="a-error a-small" role="alert">
          {bad}
        </p>
      ) : null}
      <div className="a-row between">
        {q && p.onRetire ? (
          <button type="button" className="a-btn small" disabled={sending} onClick={p.onRetire}>
            להוציא את השאלה
          </button>
        ) : (
          <span />
        )}
        <span className="a-row">
          <button type="button" className="a-btn small" disabled={sending} onClick={p.onCancel}>
            ביטול
          </button>
          <button type="button" className="a-btn primary small" disabled={sending} onClick={() => void save()}>
            {sending ? "שומרים…" : "לשמור"}
          </button>
        </span>
      </div>
    </section>
  );
}

/** "לתקן תשובה" beyond a choice, and any item's worked solution ("פתרון מלא"). */
export function AnswerEdit(p: { q: ReviewItem; onDone: (said: string) => void; onCancel: () => void }) {
  const { q } = p;
  const [num, setNum] = useState(q.num !== null && q.num !== undefined ? numText(q.num) : "");
  const [unit, setUnit] = useState(q.num_unit ?? "");
  const [tol, setTol] = useState(q.num_tol !== null && q.num_tol !== undefined ? String(q.num_tol) : "1");
  const [answer, setAnswer] = useState(q.model_answer ?? "");
  const [rubric, setRubric] = useState((q.rubric ?? []).join("\n"));
  const [solution, setSolution] = useState(q.solution ?? "");
  const [sending, setSending] = useState(false);
  const [bad, setBad] = useState("");
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus(), []);
  const save = async () => {
    setBad("");
    const patch: SolutionPatch = {};
    if (q.form === "numeric") {
      const n = numericParse(num);
      const t = numericParse(tol);
      if (n === null) return setBad("צריך מספר, למשל 6.9.");
      if (t === null || t < 0 || t > 50) return setBad("הטווח הוא בין 0 ל-50 אחוז.");
      if (n !== q.num) patch.num = n;
      if (unit.trim() !== (q.num_unit ?? "")) patch.num_unit = unit.trim();
      if (t !== (q.num_tol ?? 1)) patch.num_tol = t;
    }
    if (q.form === "open") {
      if (!answer.trim()) return setBad("צריך תשובה לדוגמה.");
      const r = rubric
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      if (r.length > 6) return setBad("עד 6 נקודות.");
      if (answer.trim() !== (q.model_answer ?? "")) patch.model_answer = answer.trim();
      if (JSON.stringify(r) !== JSON.stringify(q.rubric ?? [])) patch.rubric = r;
    }
    if (solution.trim() !== (q.solution ?? "")) patch.solution = solution.trim();
    if (!Object.keys(patch).length) return p.onCancel();
    setSending(true);
    try {
      await itemSolution(q.id, patch);
      p.onDone("התשובה עודכנה לכל הקבוצה.");
    } catch (e) {
      setBad(failText(codeOf(e), "exam") || "השינוי לא נשמר. כדאי לנסות שוב.");
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="a-card se" aria-labelledby={`ae-${q.id}`}>
      <h3 id={`ae-${q.id}`} ref={head} tabIndex={-1}>
        לתקן תשובה · שאלה {labelOf(q)}
      </h3>
      {q.form === "numeric" ? (
        <>
          <label className="a-field">
            <span>התשובה</span>
            <input className="a-input" inputMode="text" dir="ltr" autoComplete="off" value={num} disabled={sending} onChange={(e) => setNum(e.target.value)} />
          </label>
          <label className="a-field">
            <span>יחידה</span>
            <input className="a-input" dir="auto" maxLength={30} value={unit} disabled={sending} onChange={(e) => setUnit(e.target.value)} />
          </label>
          <label className="a-field">
            <span>טווח (אחוזים)</span>
            <input className="a-input" inputMode="decimal" dir="ltr" value={tol} disabled={sending} onChange={(e) => setTol(e.target.value)} />
          </label>
        </>
      ) : null}
      {q.form === "open" ? (
        <>
          <label className="a-field">
            <span>תשובה לדוגמה</span>
            <textarea className="a-input" rows={4} dir="auto" value={answer} disabled={sending} onChange={(e) => setAnswer(e.target.value)} />
          </label>
          <label className="a-field">
            <span>מה צריך להיות בתשובה (נקודה בכל שורה, עד 6)</span>
            <textarea className="a-input" rows={4} dir="auto" value={rubric} disabled={sending} onChange={(e) => setRubric(e.target.value)} />
          </label>
        </>
      ) : null}
      <label className="a-field">
        <span>פתרון מלא</span>
        <textarea className="a-input" rows={5} dir="auto" value={solution} disabled={sending} onChange={(e) => setSolution(e.target.value)} />
      </label>
      <p className="a-small a-muted">התשובה תשתנה לכל הקבוצה, עם השם שלך.</p>
      {bad ? (
        <p className="a-error a-small" role="alert">
          {bad}
        </p>
      ) : null}
      <div className="a-row">
        <button type="button" className="a-btn primary small" disabled={sending} onClick={() => void save()}>
          {sending ? "שומרים…" : "לשמור"}
        </button>
        <button type="button" className="a-btn small" disabled={sending} onClick={p.onCancel}>
          ביטול
        </button>
      </div>
    </section>
  );
}
