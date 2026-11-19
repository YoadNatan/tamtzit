import { useState, type ReactNode } from "react";
import { clozeParts } from "../../../shared/study/cloze";
import type { Card } from "../lib/cards";
import { isolateLatin } from "../lib/rich";
import { RouteLink } from "./Shell";
import type { Go } from "../features/types";

/* ── A card's two faces (design-cards §1.3 K2, K4; spec §5.5) ──
 * Shared by the deck's expanded row, the review session and "עיון
 * בכרטיסיות". Before the answer: the front (a cloze's hidden part as […] in a
 * soft pill). After it: the front, muted, then the answer (a cloze: the whole
 * sentence, the hidden part bold and underlined), the explanation, the
 * picture (tap to zoom), and the card's slides, each a tag that opens the
 * slide over the screen (review UX-4), "לקריאה בסיכום", and who fixed or
 * added it. English inside Hebrew is isolated, as everywhere in the app. */

export type FaceCard = Pick<Card, "id" | "lecture_id" | "kind" | "front" | "back" | "extra" | "figure" | "slides" | "source" | "created_by" | "updated_by"> & Pick<Card, "origin">;

/** Where a private card came from (C's end), as its chip says it. */
export const ORIGIN_WORDS: Record<NonNullable<Card["origin"]>, string> = {
  quiz: "מהמבחן הקבוצתי",
  practice: "מהתרגול",
  answer: "מהשאלה שלך",
  table: "מטבלה ריקה",
};

/** The one chip that says whose a card is (C's end; review F-11: one chip):
 *  the group's deck, the group's trap card, or a private card from one's own
 *  mistake. */
export function CardBadge({ card }: { card: Pick<Card, "source" | "origin"> }) {
  if (card.source === "trap") return <span className="a-chip warn card-badge">מלכודת של הקבוצה</span>;
  if (card.source === "mine") return <span className="a-chip card-badge">{card.origin ? `מטעות שלך · ${ORIGIN_WORDS[card.origin]}` : "מטעות שלך"}</span>;
  return <span className="a-chip group card-badge">מהחפיסה של הקבוצה</span>;
}

/** A cloze front as the student sees it before answering. */
export function clozeFront(front: string, key: string): ReactNode {
  const p = clozeParts(front);
  if (!p) return isolateLatin(front, key);
  return (
    <>
      {isolateLatin(p.before, `${key}b`)}
      <span className="cloze-blank" aria-label="החלק החסר">
        […]
      </span>
      {isolateLatin(p.after, `${key}a`)}
    </>
  );
}

/** A cloze's whole sentence, the hidden part bold and underlined. */
export function clozeWhole(front: string, key: string): ReactNode {
  const p = clozeParts(front);
  if (!p) return isolateLatin(front, key);
  return (
    <>
      {isolateLatin(p.before, `${key}b`)}
      <b className="cloze-hit">
        <bdi>{isolateLatin(p.answer, `${key}h`)}</bdi>
      </b>
      {isolateLatin(p.after, `${key}a`)}
    </>
  );
}

/** The front's text, one line (K2's collapsed row). */
export function frontText(c: Pick<Card, "kind" | "front">, key = "f"): ReactNode {
  return c.kind === "cloze" ? clozeFront(c.front, key) : isolateLatin(c.front, key);
}

/** "נערכה ע״י נועה" or "נוספה ע״י שוהם", or nothing. */
export function byLine(c: Pick<Card, "source" | "created_by" | "updated_by">, nameOf: (id: string) => string): string {
  if (c.updated_by && nameOf(c.updated_by)) return `נערכה ע״י ${nameOf(c.updated_by)}`;
  if (c.source === "member" && c.created_by && nameOf(c.created_by)) return `נוספה ע״י ${nameOf(c.created_by)}`;
  return "";
}

export default function CardFace({
  card,
  revealed,
  lectureTitle,
  figureUrl,
  nameOf,
  onSlide,
  go,
  showChip = true,
  top,
}: {
  card: FaceCard;
  revealed: boolean;
  /** In a session over several lectures: the card's lecture, small and muted. */
  lectureTitle?: string;
  /** A figure id's picture URL ("fig:12-1"), when the lecture has it. */
  figureUrl?: (fig: string) => string | undefined;
  nameOf: (id: string) => string;
  /** A slide tag was tapped: open SlideSheet over the screen. */
  onSlide?: (slide: number) => void;
  /** For "לקריאה בסיכום" (the reader at the card's first slide). */
  go?: Go;
  showChip?: boolean;
  /** A row over the front (the session's badge and "ראית אתמול", cards.html s1). */
  top?: ReactNode;
}) {
  const [zoom, setZoom] = useState(false);
  const picture = revealed && card.figure ? figureUrl?.(card.figure) : undefined;
  const by = byLine(card, nameOf);
  return (
    <div className={`card-face${revealed ? " revealed" : ""}`}>
      {lectureTitle ? (
        <p className="card-lecture" dir="auto">
          {lectureTitle}
        </p>
      ) : null}
      {top}
      {showChip && card.kind === "cloze" ? <span className="a-chip">השלמה</span> : null}
      <p className="front card-front" dir="rtl">
        {revealed && card.kind === "cloze" ? clozeFront(card.front, `f${card.id}`) : frontText(card, `f${card.id}`)}
      </p>
      {revealed ? (
        <>
          <div className="a-divider card-divider" role="separator" />
          <p className="a-para card-back" dir="rtl">
            {card.kind === "cloze" ? clozeWhole(card.front, `w${card.id}`) : isolateLatin(card.back, `b${card.id}`)}
          </p>
          {card.extra ? (
            <p className="card-extra" dir="rtl">
              {isolateLatin(card.extra, `x${card.id}`)}
            </p>
          ) : null}
          {picture ? (
            <figure className={`card-figure${zoom ? " zoomed" : ""}`}>
              <button type="button" onClick={() => setZoom((z) => !z)} aria-label={zoom ? "להקטין את התמונה" : "להגדיל את התמונה"}>
                <img src={picture} alt="" loading="lazy" />
              </button>
            </figure>
          ) : null}
          {card.slides.length || by ? (
            <div className="card-foot">
              {card.slides.map((n) => (
                <button key={n} type="button" className="a-tag src-link" data-slides={n} aria-label={`שקף ${n}`} onClick={() => onSlide?.(n)}>
                  ש׳ <bdi dir="ltr">{n}</bdi>
                </button>
              ))}
              {card.slides.length && go ? (
                <RouteLink to={{ v: "lecture", l: card.lecture_id, slide: card.slides[0] }} go={go} className="a-link">
                  לקריאה בסיכום
                </RouteLink>
              ) : null}
              {by ? <span>{by}</span> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
