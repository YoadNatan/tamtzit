import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { isSetForm, type Layout } from "../../../shared/study/forms";
import { STYLE_HE, type Style } from "../../../shared/study/practice2";
import { flags as buildFlags } from "../lib/flags";
import type { Feedback, Flag, PublicQuestion } from "../lib/practice";
import { autopsyOrder, betLabel, BETS, keepPrinted, printedOrder, type Bet } from "../lib/practiceSession";
import { reveal } from "../lib/reveal";
import { richText, slideTag } from "../lib/rich";
import { flagLine, LETTERS, pinNames } from "../lib/questionText";

/* The question types' pieces load with the first question that needs them. */
const QuestionFigure = lazy(() => import("./QuestionTypes").then((m) => ({ default: m.QuestionFigure })));
const TfAnswer = lazy(() => import("./QuestionTypes").then((m) => ({ default: m.TfAnswer })));
const MatchAnswer = lazy(() => import("./QuestionTypes").then((m) => ({ default: m.MatchAnswer })));
const OrderAnswer = lazy(() => import("./QuestionTypes").then((m) => ({ default: m.OrderAnswer })));

/* ── A practice question, as approved (proposal/mockups/practice.html) ──
 *
 * Before the answer: the style and the slide it is based on, the case and
 * the lead-in, the options (a tap picks one, it does not answer), the bet
 * "ניחוש · נראה לי · על בטוח" in a card marked "רק לך", and "לא יודעים". The
 * session's bottom bar holds "לבדוק" (it sends the choice with the bet as
 * p_confidence). After it, the autopsy: the verdict with the bet ("טעות ·
 * ׳נראה לי׳"), then the option chosen when it was wrong, then the key, then
 * the rest, each with its explanation and "מתי כן"; "מה לזכור"; the other
 * members' flags. Right and wrong are never colour alone: a ✓/✗ and words go
 * with them. Slide tags are buttons that open the slide (onSlide). Options
 * arrive in the showing's order, the feedback mapped to it. */

export type PracticeQuestionProps = {
  q: Pick<PublicQuestion, "id" | "kind" | "vignette" | "question" | "options" | "slides"> & {
    style?: string | null;
    study_question_flags?: Flag[];
    /** Question types: the form, the picture and what is drawn, a staged case's step; the group and lecture find the picture. */
    form?: string;
    figure?: string;
    layout?: Layout | null;
    series?: string | null;
    step?: number | null;
    group_id?: string;
    lecture_id?: string | null;
    /** An uploaded item ("exam") keeps its printed order after the answer (VITE_STUDY_SHEETS). */
    source?: string | null;
  };
  position?: { index: number; total: number };
  /** Before the answer: the option picked (shown place), and the bet. */
  picked?: number | null;
  /** A set question (tf, match, order): its answer so far (shown order), and its change. */
  pickedSet?: Array<number | null>;
  onPickSet?: (v: Array<number | null>) => void;
  /** A staged case: the step before this one was just answered here (the story so far starts folded). */
  stepFolded?: boolean;
  bet?: Bet | null;
  /** After the answer: the choice (null: "לא יודעים"; a list for a set question) and the feedback, in shown order. */
  chosen?: number | number[] | null;
  feedback: Feedback | null;
  /** The bet the answer was sent with (the verdict says it). */
  answeredBet?: Bet | null;
  busy?: boolean;
  nameOf: (userId: string) => string;
  me?: string;
  onPick?: (i: number) => void;
  onBet?: (b: Bet) => void;
  onDontKnow?: () => void;
  onSlide: (slide: number) => void;
  /** More chips beside the style (the lecture's title in a course session). */
  chips?: ReactNode;
  /** Under the question: a past exam's crop of its page (sources.md B1 S 2, the pg: figure). */
  media?: ReactNode;
  /** A line beside the verdict ("השאלה תחזור מחר…"). */
  note?: ReactNode;
  /** "טעויות ׳על בטוח׳" is promised only where progress shows it. */
  dangerList?: boolean;
  /** No bet (a question timed out, or one reviewed at the end). */
  noBet?: boolean;
  /** A picture question whose picture does not load: "לדלג" moves on without counting it. */
  onSkip?: () => void;
  autoFocus?: boolean;
  /** The screen takes 1-6 and Enter (a practice session): one line says so,
   *  shown only with a mouse (practice.css .pq-keys, P2). */
  keys?: boolean;
};

const styleName = (q: PracticeQuestionProps["q"]): string =>
  q.style && q.style in STYLE_HE ? STYLE_HE[q.style as Style] : q.kind === "case" ? STYLE_HE.case : "שאלה אמריקאית";

/** "ש׳ 38", "ש׳ 19-20", "ש׳ 33, 37". */
function slidesText(slides: readonly number[]): string {
  const s = [...new Set(slides)].sort((a, b) => a - b);
  if (!s.length) return "";
  if (s.length > 1 && s[s.length - 1] - s[0] === s.length - 1) return `${s[0]}-${s[s.length - 1]}`;
  return s.join(", ");
}

/** The verdict's chip: "נכון · ׳על בטוח׳", "טעות · ׳נראה לי׳", "בלי תשובה";
 *  a set question's wrong answer also says how much was right ("✗ טעות · 3 מתוך 4"). */
export function verdictOf(chosen: number | number[] | null | undefined, fb: Feedback, bet?: Bet | null): { text: string; tone: "ok" | "bad" | "plain" } {
  if (chosen === null || chosen === undefined) return { text: "בלי תשובה", tone: "plain" };
  const right = fb.correct ?? chosen === fb.answer;
  const b = betLabel(bet);
  const part = Array.isArray(chosen) && !right && fb.total ? ` · ${fb.right ?? 0} מתוך ${fb.total}` : "";
  return { text: `${right ? "✓ נכון" : "✗ טעות"}${part}${b ? ` · ׳${b}׳` : ""}`, tone: right ? "ok" : "bad" };
}


export default function PracticeQuestion(p: PracticeQuestionProps) {
  const { q, feedback: fb } = p;
  const [showFlags, setShowFlags] = useState(false);
  // A staged case's story so far: whether it is folded now (its summary says "(להראות)" while it is).
  const [sofarOpen, setSofarOpen] = useState(!p.stepFolded);
  // A picture question waits for its picture: nothing can be picked, bet or answered before it shows.
  const [figState, setFigState] = useState<"loading" | "ok" | "error">("loading");
  const head = useRef<HTMLHeadingElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const bets = useRef<HTMLElement>(null);
  const flags = q.study_question_flags ?? [];
  const others = flags.filter((f) => f.user_id !== p.me);
  const revealed = fb !== null;
  const autoFocus = p.autoFocus !== false;

  // After "לבדוק" the verdict takes focus, at the top of the screen.
  useEffect(() => {
    if (!revealed || !autoFocus || !head.current) return;
    head.current.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [revealed, autoFocus, q.id]);
  useEffect(() => {
    setShowFlags(false);
    setFigState("loading");
  }, [q.id]);

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const slides = slideTag(e.target);
    if (slides) {
      e.preventDefault();
      p.onSlide(slides[0]);
    }
  };
  // Arrows move between the options (a radio group).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowLeft: 1, ArrowUp: -1, ArrowRight: -1 };
    if (!(e.key in keys)) return;
    const items = [...(options.current?.querySelectorAll<HTMLButtonElement>("button.a-opt") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = (at + keys[e.key] + items.length) % items.length;
    items[next]?.focus();
    p.onPick?.(next);
  };

  const based = slidesText(q.slides);
  const form = buildFlags.qtypes ? (q.form ?? "one") : "one";
  const set = isSetForm(form);
  const tap = form === "tap";
  const steps = q.layout?.kind === "steps" ? q.layout : null;
  const picture = buildFlags.qtypes && (q.layout?.kind === "label" || q.layout?.kind === "image" || (q.style === "image" && Boolean(q.figure)));
  const waiting = picture && figState !== "ok";
  const busy = p.busy || (!revealed && waiting);
  const meta = (
    <div className="a-row between pq-meta">
      <span className="a-row pq-chips">
        <span className="a-chip pq-style">{styleName(q)}</span>
        {steps && q.step ? <span className="a-chip pq-step">{`שלב ${q.step} מתוך ${steps.of}`}</span> : null}
        {flags.length ? (
          <button type="button" className="a-chip warn pq-flagged" aria-expanded={showFlags} onClick={() => setShowFlags((v) => !v)}>
            סומנה כבעייתית
          </button>
        ) : null}
        {p.chips}
      </span>
      {based ? (
        <span className="a-small a-muted pq-based">
          {/* With practice sets the slide is said in full (§5.11: "ש׳" was never defined). */}
          {buildFlags.make ? "מבוסס על שקף" : "מבוסס על ש׳"} <bdi dir="ltr">{based}</bdi>
        </span>
      ) : null}
    </div>
  );
  const flagList = (list: Flag[]) =>
    list.length ? (
      <ul className="a-stack pq-flags">
        {list.map((f) => (
          <li key={f.id} className="a-small a-muted" dir="rtl">
            {richText(flagLine(f, p.nameOf), `f${f.id}`)}
          </li>
        ))}
      </ul>
    ) : null;
  // A staged case's later step: the story so far folded ("המקרה עד כאן"), what is new shown.
  const lead = steps && (q.step ?? 1) > 1 ? Math.min(steps.lead, q.vignette.length) : 0;
  const stem = (
    <>
      {lead > 0 ? (
        <details className="pq-sofar" open={!p.stepFolded} onToggle={(e) => setSofarOpen(e.currentTarget.open)}>
          <summary className="a-small">
            {sofarOpen ? "המקרה עד כאן" : "המקרה עד כאן (להראות)"}
            <span className="pq-sofar-chev" aria-hidden="true" />
          </summary>
          <p className="a-para pq-vignette" dir="rtl">
            {richText(q.vignette.slice(0, lead).trim(), "v0")}
          </p>
        </details>
      ) : null}
      {q.vignette.slice(lead).trim() ? (
        <p className="a-para pq-vignette" dir="rtl">
          {richText(q.vignette.slice(lead).trim(), "v")}
        </p>
      ) : null}
      <p className="a-q pq-lead" id={`lead-${q.id}`} dir="rtl">
        {richText(q.question, "l")}
      </p>
    </>
  );
  const figure = (answered: { right: number; chosen: number | null; names?: string[] } | null) =>
    picture ? (
      <Suspense fallback={<div className="qf-stage qf-wait-box" aria-hidden="true" />}>
        <QuestionFigure
          groupId={q.group_id ?? ""}
          lectureId={q.lecture_id ?? null}
          figure={q.figure ?? ""}
          layout={q.layout}
          picked={tap ? (p.picked ?? null) : undefined}
          onPick={tap && !answered ? p.onPick : undefined}
          answered={answered}
          disabled={p.busy}
          labelledBy={`lead-${q.id}`}
          onState={setFigState}
        />
      </Suspense>
    ) : null;
  const SetAnswer = form === "tf" ? TfAnswer : form === "match" ? MatchAnswer : OrderAnswer;
  const prompts = q.layout?.kind === "match" ? q.layout.prompts : undefined;

  if (!fb) {
    return (
      <article className="pq" onClick={onClick} aria-label={p.position ? `שאלה ${p.position.index} מתוך ${p.position.total}` : undefined}>
        {meta}
        {showFlags ? flagList(flags) : null}
        {stem}
        {figure(null)}
        {p.media}
        {set ? (
          <Suspense fallback={<p className="a-small a-muted">רגע…</p>}>
            <SetAnswer
              qid={q.id}
              options={q.options}
              prompts={prompts}
              value={p.pickedSet ?? q.options.map(() => null)}
              onChange={p.onPickSet}
              disabled={busy}
            />
          </Suspense>
        ) : (
        <div ref={options} className="a-opts pq-options" role="radiogroup" aria-label={tap ? "מספרים" : "תשובות"} onKeyDown={onKey}>
          {q.options.map((text, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={p.picked === i}
              tabIndex={p.picked === i || (p.picked == null && i === 0) ? 0 : -1}
              className={`a-opt${p.picked === i ? " picked" : ""}`}
              disabled={busy}
              onClick={() => {
                p.onPick?.(i);
                // "לבדוק" waits for "כמה בטוחים?": on a small phone it is under the fold.
                if (p.bet == null && !p.noBet) reveal(bets.current);
              }}
            >
              <span className="l">{LETTERS[i]}</span>
              <span className="pq-text" dir="rtl">
                {tap ? `מספר ${text}` : richText(text, `o${i}-`)}
              </span>
            </button>
          ))}
        </div>
        )}
        {p.keys && !set && !tap ? (
          <p className="a-small a-muted pq-keys">
            במקלדת: <bdi dir="ltr">1–{Math.min(q.options.length, 6)}</bdi> לבחירה · <kbd>Enter</kbd> לבדיקה (אחרי ״כמה בטוחים?״)
          </p>
        ) : null}
        {p.noBet ? null : (
          <section ref={bets} className="a-card flat pq-bet" aria-labelledby={`bet-${q.id}`}>
            <div className="a-row between">
              <b className="a-small" id={`bet-${q.id}`}>
                כמה בטוחים? לפני הבדיקה
              </b>
              <span className="a-chip">רק לך</span>
            </div>
            <div className="a-seg pq-bets" role="radiogroup" aria-labelledby={`bet-${q.id}`}>
              {BETS.map((b) => (
                <button key={b.bet} type="button" role="radio" className="a-btn" aria-checked={p.bet === b.bet} disabled={busy} onClick={() => p.onBet?.(b.bet)}>
                  {b.label}
                </button>
              ))}
            </div>
            <p className="a-small a-muted">
              {p.dangerList ? "טעות ׳על בטוח׳ חוזרת אליך בניסוח אחר. " : ""}התשובה ומה שסימנת נשמרים רק אצלך.
            </p>
          </section>
        )}
        {picture && figState === "error" ? (
          <p className="a-callout warn pq-nopic" role="status">
            בלי התמונה אי אפשר לענות על השאלה הזו.{" "}
            {p.onSkip ? (
              <button type="button" className="a-link" onClick={p.onSkip}>
                לדלג, בלי שזה ייספר
              </button>
            ) : null}
          </p>
        ) : null}
        {p.onDontKnow ? (
          <button type="button" className="a-link pq-dont-know" disabled={busy} onClick={p.onDontKnow}>
            לא יודעים
          </button>
        ) : null}
      </article>
    );
  }

  const chosen = p.chosen;
  const v = verdictOf(chosen, fb, p.answeredBet);
  if (set) {
    return (
      <article className="pq is-answered" onClick={onClick} aria-label={p.position ? `שאלה ${p.position.index} מתוך ${p.position.total}` : undefined}>
        <div className="a-row between pq-verdict" aria-live="polite">
          <h2 ref={head} tabIndex={-1} className={`a-chip ${v.tone === "plain" ? "" : v.tone}`.trim()}>
            {v.text}
          </h2>
          <span className="a-row">
            {p.note ? <span className="a-small a-muted pq-note">{p.note}</span> : null}
            <span className="a-chip">רק לך</span>
          </span>
        </div>
        {meta}
        {stem}
        {p.media}
        <Suspense fallback={<p className="a-small a-muted">רגע…</p>}>
          <SetAnswer qid={q.id} options={q.options} prompts={prompts} value={[]} feedback={{ ...fb, choices: Array.isArray(chosen) ? chosen : null }} />
        </Suspense>
        {fb.takeaway.trim() ? (
          <aside className="a-callout quiet pq-take" aria-label="מה לזכור" dir="rtl">
            <b>מה לזכור:</b> {richText(fb.takeaway, "t-", { tags: "link" })}
          </aside>
        ) : null}
        {flagList(others)}
      </article>
    );
  }
  const one = typeof chosen === "number" ? chosen : null;
  // An uploaded item keeps the printed order (VITE_STUDY_SHEETS, design D10); others put the chosen and the right option first.
  const order = keepPrinted(q, buildFlags.sheets) ? printedOrder(q.options.length) : autopsyOrder(q.options.length, one, fb.answer);
  const why = fb.explanations ?? [];
  const whens = fb.whens ?? [];
  // An uncovered past-exam item repeats one sentence in every why: shown once (review UX-22).
  const oneWhy = why.length > 1 && why.every((w) => w.trim() === why[0].trim()) ? why[0] : null;
  return (
    <article className="pq is-answered" onClick={onClick} aria-label={p.position ? `שאלה ${p.position.index} מתוך ${p.position.total}` : undefined}>
      <div className="a-row between pq-verdict" aria-live="polite">
        <h2 ref={head} tabIndex={-1} className={`a-chip ${v.tone === "plain" ? "" : v.tone}`.trim()}>
          {v.text}
        </h2>
        <span className="a-row">
          {p.note ? <span className="a-small a-muted pq-note">{p.note}</span> : null}
          <span className="a-chip">רק לך</span>
        </span>
      </div>
      {meta}
      {stem}
      {figure({ right: fb.answer, chosen: one, names: q.layout?.kind === "label" ? pinNames(q, fb) : undefined })}
      {p.media}
      <ol className="a-opts pq-autopsy" aria-label="התשובות וההסברים">
        {order.map((i) => {
          const right = i === fb.answer;
          const mine = one === i;
          const w = oneWhy === null ? (why[i] ?? "").trim() : "";
          const when = right ? "" : (whens[i] ?? "").trim();
          const mark = right ? (mine ? "✓ התשובה הנכונה · הבחירה שלך." : "✓ התשובה הנכונה.") : mine ? "✗ הבחירה שלך." : "";
          return (
            <li key={i} className={`a-opt${right ? " correct" : mine ? " wrong" : ""}${mine ? " picked" : ""}`} data-shown={i}>
              <span className="l">{LETTERS[i]}</span>
              <span className="pq-text" dir="rtl">
                {tap ? `מספר ${q.options[i]}` : richText(q.options[i], `o${i}-`)}
              </span>
              {mark || w || when ? (
                <span className="x" dir="rtl">
                  {mark ? <b className="pq-mark">{mark}</b> : null}
                  {mark && w ? " " : null}
                  {w ? richText(w, `w${i}-`, { tags: "link" }) : null}
                  {when ? (
                    <>
                      {" "}
                      <b>מתי כן:</b> {richText(when, `n${i}-`, { tags: "link" })}
                    </>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {oneWhy ? (
        <p className="a-small a-muted" dir="rtl">
          {richText(oneWhy, "w1-", { tags: "link" })}
        </p>
      ) : null}
      {!why.length ? <p className="a-small a-muted">ההסבר עוד לא נכתב.</p> : null}
      {fb.takeaway.trim() ? (
        <aside className="a-callout quiet pq-take" aria-label="מה לזכור" dir="rtl">
          <b>מה לזכור:</b> {richText(fb.takeaway, "t-", { tags: "link" })}
        </aside>
      ) : null}
      {flagList(others)}
    </article>
  );
}
