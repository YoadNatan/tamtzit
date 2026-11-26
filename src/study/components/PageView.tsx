import { useEffect, useState } from "react";
import type { PageBox } from "../lib/exams";
import { examPagePath, pageUrl } from "./ExamParts";

/* ── One page of an upload beside its copy (uploaded sheets, release A0;
 *    design-exams §5.7) ──
 * The wide review's left column (text right, page left, from 760 px): the
 * page the open item is on, at the column's full width, zoomable (− +) and
 * opened whole in a tab (⤢); "עמוד 2 מתוך 6" with the pages before and after.
 * Each item's figure box on the page is outlined and is a button that opens
 * its item ("שאלה 3, עמוד 2"); the open item's is filled. The items of the
 * page are listed under it too, so a page with no boxes (the reader drew a
 * box only for a figure) still leads to its items. View only in A0: drawing
 * a box is release A1's. */

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
}) {
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
          {url ? (
            <a className="a-btn ghost small" href={url} target="_blank" rel="noopener noreferrer" aria-label={`לפתוח את עמוד ${p.page} כולו`}>
              ⤢
            </a>
          ) : null}
        </span>
      </div>
      <div className="pv-scroll">
        <div className="pv-sheet" style={{ width: `${ZOOMS[zoom] * 100}%` }}>
          {state === "ok" && url ? (
            <img src={url} alt={`עמוד ${p.page}`} onError={() => setState("error")} />
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
        </div>
      </div>
    </section>
  );
}
