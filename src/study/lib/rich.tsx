import { Children, type ReactNode } from "react";
import { HEBREW, LATIN_RUN, trimRun } from "./bidi";

/* ── Rich text: the summary's inline conventions anywhere in the app ──
 * Moved from SummaryView's inline() (spec §5.5), so questions, explanations,
 * cards, quiz reveals, answers and corrections read like the summary:
 *
 *  - [ש' 12] or [ש' 12-14, 17] after a sentence is a slide tag carrying
 *    data-slides, drawn as the kit's .a-tag. With { tags: "link" } it is a
 *    button (.src-link) that a screen's click handler turns into SlideSheet
 *    (slideTag(), spec §2.7); otherwise a quiet label (.src-tag).
 *  - **bold** in plain strings (questions and explanations arrive as text).
 *  - every run of Latin text, with its digits and brackets, is isolated in
 *    <bdi dir="ltr">.
 */

export type RichOptions = {
  /** "link": tags are buttons that open the slide; "plain" (default): labels. */
  tags?: "link" | "plain";
  /** Slides the lecture does not have: their tags are shown muted (.a-tag.bad). */
  badSlides?: readonly number[];
};

const TAG = /\[ש['׳]\s?(\d+(?:\s?[-–]\s?\d+)?(?:\s?,\s?\d+(?:\s?[-–]\s?\d+)?)*)\]/g;

/** "12-14, 17" → [12, 13, 14, 17] (a range is at most 60 slides). */
export function slidesOf(spec: string): number[] {
  const out: number[] = [];
  for (const piece of spec.split(",")) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(piece);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 60; n++) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** The slides of a tapped tag, for a container's onClick: the closest
 *  .src-link from the event's target, or null when the tap was elsewhere. */
export function slideTag(target: EventTarget | null): number[] | null {
  const el = target instanceof Element ? target.closest<HTMLElement>(".src-link[data-slides]") : null;
  const slides = el ? slidesOf(el.dataset.slides ?? "") : [];
  return slides.length ? slides : null;
}

/** A bar's label (the kit's a-bars, where labels wrap): its Latin runs
 *  isolated, and a hyphen inside a word made non-breaking, so a line never
 *  ends in "(K⁺-" shown as "K⁺-)" before "sparing)". */
export function barLabel(text: string, keyBase = "b"): ReactNode[] {
  return isolateLatin(text.replace(/(?<=[A-Za-z0-9\u2070-\u209f])-(?=[A-Za-z])/g, "\u2011"), keyBase);
}

/** A number range's hyphen ("1-8%", "3-4 h") made non-breaking, so a line
 *  never ends in "1-" with "8%" on the next. */
export function keepRange(run: string): string {
  return run.replace(/(?<=\d)-(?=\d)/g, "\u2011");
}

/** Wraps every Latin run of a Hebrew string in <bdi dir="ltr">. A string
 *  with no Hebrew at all (a table cell "1 h", a bold "Proximal tubule:",
 *  a heading) is one run: inside the summary's right-to-left blocks its
 *  numbers and units would otherwise swap ("h 1", "½t", "3%≈"). Its spaces
 *  and closing punctuation stay outside, as for any run. */
export function isolateLatin(text: string, keyBase = "b"): ReactNode[] {
  if (!HEBREW.test(text)) {
    LATIN_RUN.lastIndex = 0;
    if (!LATIN_RUN.test(text)) return [text];
    const run = trimRun(text.trim());
    const at = run ? text.indexOf(run) : -1;
    if (at < 0) return [text];
    const out: ReactNode[] = [];
    if (at > 0) out.push(text.slice(0, at));
    out.push(
      <bdi key={`${keyBase}${at}`} dir="ltr">
        {keepRange(run)}
      </bdi>,
    );
    if (at + run.length < text.length) out.push(text.slice(at + run.length));
    return out;
  }
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  LATIN_RUN.lastIndex = 0;
  while ((m = LATIN_RUN.exec(text))) {
    const run = trimRun(m[0]);
    if (!run) continue;
    const start = m.index + (m[0].length - m[0].trimStart().length);
    const at = text.indexOf(run, m.index);
    const idx = at >= 0 ? at : start;
    if (idx > last) out.push(text.slice(last, idx));
    out.push(
      <bdi key={`${keyBase}${idx}`} dir="ltr">
        {keepRange(run)}
      </bdi>,
    );
    last = idx + run.length;
    LATIN_RUN.lastIndex = last;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A title that may be a file's name ("Lecture_07_Pharmacology_Renal-…"):
 *  a line may break after each "_" and "-" (<wbr>), so a long name wraps
 *  between its words, not inside one. */
export function softBreaks(text: string, keyBase = "w"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/[_-](?=\S)/g)) {
    const end = (m.index ?? 0) + 1;
    out.push(text.slice(last, end), <wbr key={`${keyBase}${end}`} />);
    last = end;
  }
  out.push(text.slice(last));
  return out;
}

function tag(spec: string, key: string, o: RichOptions): ReactNode {
  const shown = spec.replace(/\s/g, "").replace(/–/g, "-");
  const bad = o.badSlides?.length ? slidesOf(spec).some((n) => o.badSlides!.includes(n)) : false;
  const inner = (
    <>
      ש׳ <bdi dir="ltr">{shown}</bdi>
    </>
  );
  if (o.tags === "link")
    return (
      <button key={key} type="button" className={`a-tag src-link${bad ? " bad" : ""}`} data-slides={shown} aria-label={`שקף ${shown}`}>
        {inner}
      </button>
    );
  return (
    <span key={key} className={`a-tag src-tag${bad ? " bad" : ""}`} data-slides={shown} title={`שקף ${shown}`}>
      {inner}
    </span>
  );
}

/** Slide tags and Latin isolation for one string, without **bold** (the
 *  summary's strings arrive already parsed by react-markdown). */
function tagsAndLatin(text: string, keyBase: string, o: RichOptions): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(text))) {
    if (m.index > last) out.push(...isolateLatin(text.slice(last, m.index), `${keyBase}t${last}-`));
    out.push(tag(m[1], `${keyBase}s${m.index}`, o));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...isolateLatin(text.slice(last), `${keyBase}t${last}-`));
  return out;
}

/** A plain string with the summary's conventions: **bold**, slide tags and
 *  isolated Latin runs. */
export function richText(text: string, keyBase = "r", o: RichOptions = {}): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/\*\*(.+?)\*\*/g);
  parts.forEach((piece, i) => {
    if (!piece) return;
    const nodes = tagsAndLatin(piece, `${keyBase}${i}-`, o);
    out.push(i % 2 ? <strong key={`${keyBase}b${i}`}>{nodes}</strong> : nodes);
  });
  return out.flat();
}

/** For react-markdown's children: the strings among them get slide tags and
 *  Latin isolation; elements pass through. What SummaryView's inline() did. */
export function richChildren(children: ReactNode, o: RichOptions = {}): ReactNode {
  return Children.map(children, (c, i) => (typeof c === "string" ? tagsAndLatin(c, `c${i}-`, o) : c));
}
