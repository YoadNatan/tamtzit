import { useEffect, useMemo, useState } from "react";
import type { Ctx } from "../features/types";
import { flags } from "../lib/flags";
import { COPY, howTos, NO_HITS, readMemory, searchHowTos, walkOf, writeMemory, type Facts } from "../lib/guide";
import { guideFacts } from "../lib/guideFacts";
import { guideSend } from "../lib/guideMark";
import "../styles/guide.css";

/* ── "מדריך לאפליקציה" and "איך עושים…?" (docs/study/guide.md §2.4) ──
 * Help's top for members: first "מדריך לאפליקציה" with the app tour (it
 * runs right here, over the tab bar), then a local search (no request leaves the
 * phone) over the how-tos and help's own rows, which it filters too. Each
 * answer is one line; "הראו לי" starts the walk that shows it on the real
 * screens, and stops before anything the group would see or pay for. */

export default function HowTo({ ctx, query, onQuery }: { ctx: Ctx; query: string; onQuery: (q: string) => void }) {
  const list = useMemo(() => howTos(flags), []);
  const hits = useMemo(() => searchHowTos(query, list), [query, list]);
  const [open, setOpen] = useState<string | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);

  useEffect(() => {
    let alive = true;
    guideFacts(ctx)
      .then((f) => alive && setFacts(f))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx]);

  /** The tour, which also answers the home's offer (the tour was found). */
  const startTour = (opener: HTMLElement) => {
    const m = readMemory(ctx.userId);
    if (!m.offer) writeMemory(ctx.userId, { ...m, offer: "taken" });
    guideSend({ type: "tour", opener });
  };

  useEffect(() => {
    if (location.hash === "#howto") document.getElementById("howto")?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <>
      <section className="a-stack g-help-guide" aria-labelledby="g-help-h">
        <div className="a-sec">
          <h2 id="g-help-h">{COPY.guideTitle}</h2>
        </div>
        <div className="a-list">
          <div className="a-li">
            <div>
              <b>{COPY.tourTitle}</b>
              <span className="m">{COPY.meTourLine}</span>
            </div>
            <button type="button" className="a-btn small primary" onClick={(e) => startTour(e.currentTarget)}>
              {COPY.tourStart}
            </button>
          </div>
        </div>
      </section>
      <section className="a-stack howto" id="howto" aria-labelledby="howto-h">
        <div className="a-sec">
          <h2 id="howto-h">איך עושים…?</h2>
        </div>
        <label className="a-field">
          <span className="sr-only">איך עושים…?</span>
          <input
            type="search"
            className="a-input"
            dir={query ? "auto" : "rtl"}
            value={query}
            maxLength={80}
            enterKeyHint="search"
            placeholder="איך עושים…? למשל: לתרגל, להעלות, תגובה"
            onChange={(e) => onQuery(e.target.value)}
          />
        </label>
        <p className="a-small a-muted" role="status" aria-live="polite">
          {query.trim() ? (hits.length ? `${hits.length} תשובות` : NO_HITS) : "שאלות נפוצות"}
        </p>
        {hits.length ? (
          <ul className="a-list howto-list">
            {hits.map((h) => {
              const expanded = open === h.key;
              const walk = h.walk && facts ? walkOf(h.walk, flags, facts) : null;
              return (
                <li key={h.key} className="howto-item">
                  <button type="button" className="a-li howto-q" aria-expanded={expanded} aria-controls={`howto-${h.key}`} onClick={() => setOpen(expanded ? null : h.key)}>
                    <b>{h.title}</b>
                    <span aria-hidden="true" className="howto-chev" />
                  </button>
                  {expanded ? (
                    <div className="a-stack howto-a" id={`howto-${h.key}`}>
                      <p className="a-para">{h.answer}</p>
                      {walk ? (
                        <div className="a-row">
                          <button type="button" className="a-btn small primary" onClick={(e) => guideSend({ type: "walk", walk: walk.id, opener: e.currentTarget })}>
                            {COPY.showMe}
                          </button>
                        </div>
                      ) : h.open ? (
                        <div className="a-row">
                          <button type="button" className="a-btn small primary" onClick={() => ctx.go(h.open!.route)}>
                            {h.open.label}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </>
  );
}
