import { useEffect, useState, type MouseEvent } from "react";
import { figureUrls, type Lecture } from "../lib/api";
import { isolateLatin } from "../lib/rich";
import { routeUrl, type Route } from "../lib/route";
import type { Go } from "../features/types";
import { Sheet } from "./Shell";

/* ── A slide over any screen (spec §2.7, review UX-4) ──
 * Every [ש' n] tag of every package opens this sheet: the slide's title,
 * lines and tables as text, its pictures, and "לפסקה בסיכום", the paragraph
 * citing that slide. Over the lecture's own reader (onParagraph) the sheet
 * closes and the reader scrolls there and marks it, with no new screen; over
 * any other screen it closes and opens the reader at ?l=<id>&slide=n, so Back
 * from the reader returns to that screen. In a live quiz (inQuiz) the link is
 * hidden while a round is open, and the quiz closes the sheet itself when the
 * next countdown starts (onClose). Back, Escape, ✕ and the backdrop close it. */

type Props = {
  lecture: Pick<Lecture, "id" | "slides">;
  slide: number;
  onClose: () => void;
  /** In a live round: no "לפסקה בסיכום". */
  inQuiz?: boolean;
  /** Navigation for "לפסקה בסיכום" (without it, the link loads the page). */
  go?: Go;
  /** Over this lecture's reader: the paragraph citing the slide, in place
   *  (LectureCtx.toSlide). Called once the sheet has closed. */
  onParagraph?: (slide: number) => void;
  /** A picture's signed URL, when the screen already has them. */
  figureUrl?: (path: string) => string | undefined;
};

export default function SlideSheet({ lecture, slide, onClose, inQuiz, go, onParagraph, figureUrl }: Props) {
  const s = lecture.slides.find((x) => x.n === slide);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const paths = (s?.figures ?? []).map((f) => f.path).filter((p) => !figureUrl?.(p));
    if (!paths.length) return;
    let alive = true;
    figureUrls(paths)
      .then((u) => alive && setUrls(u))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [s, figureUrl]);

  const pictures = (s?.figures ?? []).map((f) => ({ k: f.k, url: figureUrl?.(f.path) ?? urls[f.path] })).filter((p) => p.url);
  const target: Route = { v: "lecture", l: lecture.id, slide };

  return (
    <Sheet
      label={`שקף ${slide}`}
      className="slide-sheet"
      onClose={onClose}
      head={
        <h2 dir="rtl">
          שקף <bdi dir="ltr">{slide}</bdi>
          {s?.title ? <> · {isolateLatin(s.title, "st")}</> : null}
        </h2>
      }
    >
      {(sheet) => (
        <>
          {s ? (
            <div className="slide-body" dir="rtl">
              {s.lines
                .filter((line, i) => !(i === 0 && line === s.title))
                .map((line, i) => (
                  <p key={i} className="a-para" dir="auto">
                    {isolateLatin(line, `l${i}`)}
                  </p>
                ))}
              {s.tables.map((table, ti) => (
                <div key={ti} className="table-wrap">
                  <table className="a-table" dir="rtl">
                    <tbody>
                      {table.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => (
                            <td key={ci} dir="auto">
                              {isolateLatin(cell, `c${ti}-${ri}-${ci}`)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {pictures.map((p) => (
                <figure key={p.k} className="slide-figure">
                  <img src={p.url} alt={`שקף ${slide}`} loading="lazy" />
                </figure>
              ))}
            </div>
          ) : (
            <p className="a-muted">אין שקף כזה בהרצאה.</p>
          )}
          {!inQuiz && s ? (
            <div className="a-row sheet-actions">
              <a
                className="a-btn primary"
                href={routeUrl(target)}
                onClick={(e: MouseEvent<HTMLAnchorElement>) => {
                  if (!onParagraph && !go) return; // the link loads the page
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  // Closed first, through Back: a move starts from the screen under the sheet.
                  sheet.closeThen(() => (onParagraph ? onParagraph(slide) : go?.(target)));
                }}
              >
                לפסקה בסיכום
              </a>
            </div>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
