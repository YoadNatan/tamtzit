import { forwardRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Lecture, Section } from "../lib/api";
import SummaryView, { headingId, outline } from "./SummaryView";

/* ── A summary laid out for paper (spec §4.5; design-platform §1.B, §4.3) ──
 * Portaled into <body> as .print-doc only while the share sheet prints or
 * makes a PDF; PRINT_CSS (shared/study/print-css.ts) shows it, and only it,
 * when printing. A title page, a table of contents (every ## and ### of every
 * part, each a link with a dotted leader and its page number, which the
 * server's PDF fills in; `local` hides the numbers on the device), then each
 * part on a new page, rendered by the reader's own SummaryView: the same
 * boxes, tables, pictures (loaded eagerly) and slide tags, and no buttons. */

export type PrintProps = {
  lecture: Lecture;
  sections: Section[];
  figureUrl: (slide: number, k: number) => string | undefined;
  groupName: string;
  /** Device printing: no page numbers of ours (WebKit has no @page margin boxes). */
  local?: boolean;
  /** A part's "מההקלטה" boxes, when they are included. */
  extrasFor?: (s: Section) => ((anchor: number) => ReactNode) | undefined;
};

const dmy = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
function lectureDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${Number(day)}.${Number(m)}.${y}`;
}

/** The table of contents' entries: ids as SummaryView gives the headings (p-s<i>-h<n>). */
export function printToc(sections: Section[]): Array<{ id: string; level: number; text: string }> {
  return sections.flatMap((s) =>
    outline(s.markdown)
      .filter((h) => h.level >= 2 && h.level <= 3)
      .map((h) => ({ id: headingId(`p-s${s.idx}-`, h.index), level: h.level, text: h.text })),
  );
}

const PrintDoc = forwardRef<HTMLDivElement, PrintProps>(function PrintDoc({ lecture, sections, figureUrl, groupName, local, extrasFor }, ref) {
  const meta = [lecture.lecturer, lectureDate(lecture.lecture_date), lecture.course].filter(Boolean).join(" · ");
  const toc = printToc(sections);
  return createPortal(
    <div ref={ref} className={`print-doc${local ? " pd-local" : ""}`} dir="rtl" lang="he">
      <section className="pd-title">
        <p className="pd-eyebrow">סיכום הרצאה · תמצית</p>
        <h1 dir="auto">{lecture.title}</h1>
        {meta ? (
          <p className="pd-meta" dir="auto">
            {meta}
          </p>
        ) : null}
        <p className="pd-meta">
          {sections.length} חלקים · {lecture.slides.length} שקפים
        </p>
        <p className="pd-foot">
          {groupName} · הופק ב-{dmy(new Date())}
        </p>
      </section>
      <nav className="pd-toc">
        <h2>תוכן העניינים</h2>
        <ol>
          {toc.map((h) => (
            <li key={h.id} className={`l${h.level}`}>
              <a href={`#${h.id}`} dir="auto">
                {h.text}
              </a>
              <span className="pd-dots" />
              <span className="pd-pg" data-pg={h.id}>
                00
              </span>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((s) => (
        <section key={s.idx} className="part" data-part={s.idx}>
          <SummaryView markdown={s.markdown} figureUrl={figureUrl} idPrefix={`p-s${s.idx}-`} eager blockExtras={extrasFor?.(s)} />
        </section>
      ))}
    </div>,
    document.body,
  );
});

export default PrintDoc;
