import { useEffect, useRef, useState, type PointerEvent } from "react";
import { parsePageBox, type PageBox } from "../lib/exams";
import { boxFigure } from "../lib/sheetPure";
import { examPagePath, pageUrl } from "./ExamParts";

/* ── One page of an upload beside its copy (uploaded sheets, release A0;
 *    design-exams §5.7) ──
 * The wide review's left column (text right, page left, from 760 px): the
 * page the open item is on, at the column's full width, zoomable (− +) and
 * opened whole in a tab (⤢); "עמוד 2 מתוך 6" with the pages before and after.
 * Each item's figure box on the page is outlined and is a button that opens
 * its item ("שאלה 3, עמוד 2"); the open item's is filled. The items of the
 * page are listed under it too, so a page with no boxes (the reader drew a
 * box only for a figure) still leads to its items.
 * Release A1 (the edit sheet, design §5.8): with `draw`, a "לסמן" toggle;
 * while it is on, a drag draws a figure box and the page does not pan; while
 * it is off, the page scrolls and zooms as before. The item's own boxes are
 * outlined. "כל העמוד כאיור" (the edit sheet's) is the way without a drag. */

export type PageItem = { id: string; label: string; box: PageBox | null };

const ZOOMS = [1, 1.5, 2, 3];

export default function PageView(p: {
  groupId: string;
  examId: string;
  pages: number[];
  page: number;
  items: PageItem[];
  current: string | null;
  onPage: (n: number) => void;
  onPick: (id: string) => void;
  /** The edit sheet: the item's boxes, and a new one drawn on this page ("pg:<page>:x,y,w,h"). */
  draw?: { boxes: string[]; onBox: (figure: string) => void; full?: boolean };
}) {
  const [marking, setMarking] = useState(false);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const at1000 = (e: PointerEvent<HTMLDivElement>) => {
    const r = sheet.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * 1000, y: ((e.clientY - r.top) / Math.max(1, r.height)) * 1000 };
  };
  const drawing = Boolean(p.draw && marking && !p.draw.full);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [zoom, setZoom] = useState(0);
  const at = p.pages.indexOf(p.page);
  useEffect(() => {
    let alive = true;
    setState("loading");
    setUrl(null);
    void pageUrl(examPagePath(p.groupId, p.examId, p.page)).then((u) => {
      if (!alive) return;
      setUrl(u);
      setState(u ? "ok" : "error");
    });
    return () => {
      alive = false;
    };
  }, [p.groupId, p.examId, p.page]);
  const here = p.items.filter((i) => i.box?.page === p.page);
  return (
    <section className="pv" aria-label={`עמוד ${p.page}`}>
      <div className="pv-bar">
        <b className="pv-at">
          עמוד {p.page} מתוך {p.pages.length}
        </b>
        <span className="pv-tools">
          {/* Right to left: the page before is to the right. */}
          <button type="button" className="a-btn ghost small" aria-label="העמוד הקודם" disabled={at <= 0} onClick={() => p.onPage(p.pages[at - 1])}>
            →
          </button>
          <button type="button" className="a-btn ghost small" aria-label="העמוד הבא" disabled={at < 0 || at >= p.pages.length - 1} onClick={() => p.onPage(p.pages[at + 1])}>
            ←
          </button>
          <button type="button" className="a-btn ghost small" aria-label="להקטין" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>
            −
          </button>
          <button type="button" className="a-btn ghost small" aria-label="להגדיל" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>
            +
          </button>
          {p.draw ? (
            <button type="button" className="a-btn small pv-mark" aria-pressed={marking} disabled={p.draw.full} onClick={() => setMarking((m) => !m)}>
              לסמן
            </button>
          ) : null}
          {url ? (
            <a className="a-btn ghost small" href={url} target="_blank" rel="noopener noreferrer" aria-label={`לפתוח את עמוד ${p.page} כולו`}>
              ⤢
            </a>
          ) : null}
        </span>
      </div>
      <div className="pv-scroll">
        <div
          ref={sheet}
          className={`pv-sheet${drawing ? " drawing" : ""}`}
          style={{ width: `${ZOOMS[zoom] * 100}%` }}
          onPointerDown={
            drawing
              ? (e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  const a = at1000(e);
                  setDrag({ a, b: a });
                }
              : undefined
          }
          onPointerMove={drawing && drag ? (e) => setDrag({ a: drag.a, b: at1000(e) }) : undefined}
          onPointerUp={
            drawing && drag
              ? (e) => {
                  const f = boxFigure(p.page, drag.a, at1000(e));
                  setDrag(null);
                  if (f) p.draw!.onBox(f);
                }
              : undefined
          }
          onPointerCancel={() => setDrag(null)}
        >
          {state === "ok" && url ? (
            // No native drag of the picture: on a computer it would cancel a box being drawn.
            <img src={url} alt={`עמוד ${p.page}`} draggable={false} onDragStart={(e) => e.preventDefault()} onError={() => setState("error")} />
          ) : (
            <div className={`pv-wait${state === "error" ? " is-error" : ""}`} role="img" aria-label={state === "error" ? `עמוד ${p.page} לא נטען` : `עמוד ${p.page}`}>
              {state === "error" ? <span className="a-small a-muted">העמוד לא נטען</span> : null}
            </div>
          )}
          {state === "ok"
            ? here.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className={`pv-box${i.id === p.current ? " on" : ""}`}
                  style={{ left: `${i.box!.x / 10}%`, top: `${i.box!.y / 10}%`, width: `${i.box!.w / 10}%`, height: `${i.box!.h / 10}%` }}
                  aria-label={`${i.label}, עמוד ${p.page}`}
                  aria-pressed={i.id === p.current}
                  onClick={() => p.onPick(i.id)}
                >
                  <span aria-hidden="true">{i.label.replace(/^שאלה /, "")}</span>
                </button>
              ))
            : null}
          {state === "ok" && p.draw
            ? p.draw.boxes
                .map((f) => parsePageBox(f))
                .filter((b): b is PageBox => Boolean(b && b.page === p.page))
                .map((b, i) => <span key={i} className="pv-mine" style={{ left: `${b.x / 10}%`, top: `${b.y / 10}%`, width: `${b.w / 10}%`, height: `${b.h / 10}%` }} aria-hidden="true" />)
            : null}
          {drag ? (
            <span
              className="pv-new"
              aria-hidden="true"
              style={{
                left: `${Math.min(drag.a.x, drag.b.x) / 10}%`,
                top: `${Math.min(drag.a.y, drag.b.y) / 10}%`,
                width: `${Math.abs(drag.b.x - drag.a.x) / 10}%`,
                height: `${Math.abs(drag.b.y - drag.a.y) / 10}%`,
              }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
