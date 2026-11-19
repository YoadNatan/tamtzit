import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Lecture } from "../lib/api";
import type { Card } from "../lib/cards";
import type { Go } from "../features/types";
import CardFace from "./CardFace";
import { SheetClose, StickyActions, useSheet } from "./Shell";

const SlideSheet = lazy(() => import("./SlideSheet"));

/* ── "עיון בכרטיסיות": the deck, one card at a time (spec §5.5, review UX-21) ──
 * Front, a tap, back, next. It writes nothing (no state, no review, no
 * settings), so it ships with VITE_STUDY_CARDS, before in-app review: an
 * iPhone member can study without the paid AnkiMobile. A full-screen layer
 * over the deck with its own history entry: Back, ✕ and Escape close it. */

export default function CardBrowse({
  cards,
  lecture,
  figureUrl,
  nameOf,
  go,
  onClose,
}: {
  cards: Card[];
  /** For the slide sheet's "לפסקה בסיכום". */
  go?: Go;
  lecture: Pick<Lecture, "id" | "slides">;
  figureUrl?: (fig: string) => string | undefined;
  nameOf: (id: string) => string;
  onClose: () => void;
}) {
  const box = useRef<HTMLElement>(null);
  const sheet = useSheet(box, onClose);
  const [deck] = useState(cards);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [slide, setSlide] = useState<number | null>(null);
  const action = useRef<HTMLButtonElement>(null);
  const card = deck[i];
  const last = i >= deck.length - 1;

  const next = () => {
    if (last) return sheet.close();
    setI((n) => n + 1);
    setRevealed(false);
  };

  useEffect(() => {
    action.current?.focus({ preventScroll: true });
  }, [i, revealed]);

  return (
    <>
      <div className="browse-backdrop" />
      <section ref={box} className="browse" role="dialog" aria-modal="true" aria-label="עיון בכרטיסיות" tabIndex={-1}>
        <div className="ph-head">
          <SheetClose onClick={sheet.close} />
          <span className="t" aria-hidden="true">
            עיון בכרטיסיות
          </span>
          <span className="a-chip busy review-counts" aria-live="polite">
            <bdi dir="ltr">
              {Math.min(i + 1, deck.length)}/{deck.length}
            </bdi>
          </span>
        </div>
        <div className="a-bar" aria-hidden="true">
          <i style={{ width: `${deck.length ? (100 * Math.min(i + 1, deck.length)) / deck.length : 0}%` }} />
        </div>
        <div className="card-stage">
          {card ? (
            <div
              className={`a-flash card-panel${revealed ? "" : " front-side"}`}
              role="region"
              aria-live="polite"
              aria-label="כרטיסייה"
              onClick={() => !revealed && setRevealed(true)}
            >
              <CardFace card={card} revealed={revealed} figureUrl={figureUrl} nameOf={nameOf} onSlide={setSlide} />
            </div>
          ) : null}
        </div>
        <StickyActions>
          {revealed ? (
            <button ref={action} className="a-btn primary wide" onClick={next}>
              {last ? "סיום" : "לכרטיסייה הבאה"}
            </button>
          ) : (
            <button ref={action} className="a-btn primary wide" onClick={() => setRevealed(true)}>
              הצגת התשובה
            </button>
          )}
        </StickyActions>
      </section>
      {slide !== null ? (
        <Suspense fallback={null}>
          <SlideSheet lecture={lecture} slide={slide} go={go} onClose={() => setSlide(null)} />
        </Suspense>
      ) : null}
    </>
  );
}
