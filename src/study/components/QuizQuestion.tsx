import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { Feedback, PublicQuestion } from "../lib/practice";
import { richText, slideTag } from "../lib/rich";

/* ── The quiz's question, in the approved screens' markup
 * (docs/study/proposal/mockups/live-quiz.html: the kit's a-q, a-opts, a-opt) ──
 *
 * What practice's old QuestionCard did for the room, drawn as the approved quiz
 * draws it, so the room keeps its look whatever practice's screens become:
 * the question, the options with their Hebrew letter badges, one tap to
 * choose (the room then asks for the bet), "לא יודעים" where the mode has it.
 * At the reveal every option keeps its place: the right one .correct with
 * "✓ התשובה הנכונה", a wrong choice .wrong.picked with "✗ הבחירה שלך" (never
 * by colour alone), each with its explanation (.x) and its slide tags, which
 * open the slide (onSlide). A race folds the explanations under "להסברים".
 * The headline takes focus at the reveal, at the top of the screen. */

export const LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"] as const;

type Props = {
  q: Pick<PublicQuestion, "id" | "kind" | "vignette" | "question" | "options">;
  /** "שאלה 3 מתוך 10", for screen readers on the question itself. */
  position: { index: number; total: number };
  /** undefined: not answered; null: "לא יודעים"; else the option sent. */
  chosen: number | null | undefined;
  /** The option chosen before the bet (vote 1): outlined, not sent yet. */
  picked?: number | null;
  /** null until the reveal. */
  feedback: Feedback | null;
  /** The answer is being sent, or the question waits for its reveal. */
  busy?: boolean;
  onChoose: (choice: number | null) => void;
  onSlide: (slide: number) => void;
  /** "משהו לא בסדר בשאלה?" (practice's flag sheet). */
  onFlag?: () => void;
  /** After an option's text (the round's trap at the reveal). */
  optionExtra?: (index: number) => ReactNode;
  /** Explanations folded under "להסברים" (a race). */
  foldWhy?: boolean;
  /** No "לא יודעים". */
  noDontKnow?: boolean;
  /** More chips after "מקרה קליני" (the lecture's title in a course quiz). */
  chips?: ReactNode;
  /** At the end of the chips' row: "מבוסס על ש׳ 27, 33". */
  aside?: ReactNode;
  /** The headline's words, when the room has its own (a race's points). */
  headline?: string;
  /** Under the lead-in: the question's picture (question types: QuizMedia). */
  media?: ReactNode;
};

/** The headline at the reveal (practice's P5 words). */
function headlineOf(chosen: number | null | undefined, fb: Feedback): { text: string; tone: "ok" | "bad" | "plain" } {
  const letter = LETTERS[fb.answer] ?? String(fb.answer + 1);
  if (chosen === null) return { text: `התשובה הנכונה: ${letter}`, tone: "plain" };
  const right = fb.correct ?? chosen === fb.answer;
  return right ? { text: "✓ תשובה נכונה", tone: "ok" } : { text: `✗ התשובה הנכונה: ${letter}`, tone: "bad" };
}

export default function QuizQuestion(p: Props) {
  const { q, feedback: fb, chosen } = p;
  const [unfolded, setUnfolded] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const answered = chosen !== undefined;

  // At the reveal the headline takes focus, at the top of the screen.
  const revealed = fb !== null;
  useEffect(() => {
    if (!revealed || !head.current) return;
    head.current.focus({ preventScroll: true });
    head.current.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
  }, [revealed, q.id]);
  useEffect(() => setUnfolded(false), [q.id]);

  // A tap on a slide tag anywhere in the question opens that slide.
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const slides = slideTag(e.target);
    if (slides) {
      e.preventDefault();
      p.onSlide(slides[0]);
    }
  };
  // Arrows move between the options (a radio group); choosing is a tap or Enter.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowLeft: 1, ArrowUp: -1, ArrowRight: -1 };
    if (!(e.key in keys)) return;
    const items = [...(options.current?.querySelectorAll<HTMLButtonElement>("button.quiz-opt") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    items[(at + keys[e.key] + items.length) % items.length]?.focus();
  };

  const why = fb?.explanations ?? [];
  // The same sentence under every option (an uncovered past-exam item): shown once.
  const oneWhy = why.length > 1 && why.every((w) => w.trim() === why[0].trim()) ? why[0] : null;
  const folded = Boolean(p.foldWhy) && !unfolded;
  const hl = fb ? headlineOf(chosen, fb) : null;

  return (
    <article className="a-stack quiz-question-card" onClick={onClick} aria-label={`שאלה ${p.position.index} מתוך ${p.position.total}`}>
      <div className="quiz-live" aria-live="polite">
        {fb && hl ? (
          <h2 ref={head} tabIndex={-1} className={`quiz-headline is-${hl.tone}`}>
            {p.headline ?? hl.text}
          </h2>
        ) : null}
      </div>

      {q.kind === "case" || p.chips || p.aside ? (
        <div className="a-row between quiz-chips">
          <span className="a-wrap">
            {q.kind === "case" ? <span className="a-chip">מקרה קליני</span> : null}
            {p.chips}
          </span>
          {p.aside}
        </div>
      ) : null}

      {q.vignette.trim() ? (
        <p className="a-para quiz-vignette" dir="rtl">
          {richText(q.vignette, "v")}
        </p>
      ) : null}
      <p className="a-q" dir="rtl">
        {richText(q.question, "l")}
      </p>
      {p.media ?? null}

      {!fb ? (
        <div ref={options} className="a-opts" role="radiogroup" aria-label="תשובות" onKeyDown={onKey}>
          {q.options.map((text, i) => {
            const on = chosen === i || (chosen === undefined && p.picked === i);
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={on}
                className={`a-opt quiz-opt${on ? " picked" : ""}${p.picked === i && chosen === undefined ? " quiz-picked" : ""}`}
                disabled={p.busy || answered}
                onClick={() => p.onChoose(i)}
              >
                <span className="l">{LETTERS[i]}</span>
                <span className="quiz-opt-text">
                  <span dir="rtl">{richText(text, `o${i}-`)}</span>
                  {p.busy && chosen === i ? <span className="quiz-spin" role="img" aria-label="שולחים…" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <ol className="a-opts" aria-label="התשובות וההסברים">
          {q.options.map((text, i) => {
            const right = i === fb.answer;
            const mine = chosen === i;
            const w = oneWhy === null ? why[i]?.trim() : "";
            return (
              <li key={i} className={`a-opt quiz-opt${right ? " correct" : mine ? " wrong" : ""}${mine ? " picked" : ""}`}>
                <span className="l">{LETTERS[i]}</span>
                <span className="quiz-opt-text">
                  <span dir="rtl">{richText(text, `o${i}-`)}</span>
                  {right || mine ? (
                    <span className={`a-chip quiz-mark ${right ? "ok" : "bad"}`}>{right ? (mine ? "✓ התשובה הנכונה · הבחירה שלך" : "✓ התשובה הנכונה") : "✗ הבחירה שלך"}</span>
                  ) : null}
                  {p.optionExtra?.(i)}
                </span>
                {w && !folded ? (
                  <span className="x" dir="rtl">
                    {richText(w, `w${i}-`, { tags: "link" })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {fb && oneWhy && !folded ? (
        <p className="a-small a-muted" dir="rtl">
          {richText(oneWhy, "w1-", { tags: "link" })}
        </p>
      ) : null}
      {fb && !why.length ? <p className="a-small a-muted">ההסבר עוד לא נכתב.</p> : null}
      {fb && p.foldWhy && !unfolded && why.length ? (
        <button type="button" className="a-link quiz-unfold" onClick={() => setUnfolded(true)}>
          להסברים
        </button>
      ) : null}

      {!answered && !p.noDontKnow ? (
        <button type="button" className="a-link quiz-dont-know" disabled={p.busy} onClick={() => p.onChoose(null)}>
          לא יודעים
        </button>
      ) : null}

      {fb && fb.takeaway.trim() && !folded ? (
        <section className="a-callout quiet quiz-take" aria-labelledby={`take-${q.id}`}>
          <h3 id={`take-${q.id}`}>מה לזכור</h3>
          <p dir="rtl">{richText(fb.takeaway, "t-", { tags: "link" })}</p>
        </section>
      ) : null}
      {fb && p.onFlag ? (
        <button type="button" className="a-link quiz-flag-link" onClick={p.onFlag}>
          משהו לא בסדר בשאלה?
        </button>
      ) : null}
    </article>
  );
}
