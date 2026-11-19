import { useEffect, useState } from "react";
import { getSections, type Section } from "../lib/api";
import type { Card } from "../lib/cards";
import { isolateLatin, richText } from "../lib/rich";
import type { Go } from "../features/types";
import { Icon } from "./Icon";
import { RouteLink } from "./Shell";

/* ── "מאיפה זה?": the paragraph a card sits on (C's end; cards.html s1) ──
 * Under a revealed card in a session, and in the deck's open row: the part
 * and its heading, the card's paragraph marked, the one after it muted, and
 * "לפסקה" to the reader at that paragraph. The part is read once per
 * lecture on this page; a part written again since the card was made finds
 * the paragraph again by its first words (reanchor, as practice does). A
 * card with no paragraph (one written before C's end, or one that could not
 * be placed) shows nothing here: its slide tags stay on the card. */

const cache = new Map<string, Promise<Section[]>>();
function sectionsOf(lectureId: string): Promise<Section[]> {
  let p = cache.get(lectureId);
  if (!p) {
    p = getSections(lectureId).catch((e) => {
      cache.delete(lectureId);
      throw e;
    });
    cache.set(lectureId, p);
  }
  return p;
}

type Found = { part: number; heading: string; anchor: number; text: string; next: string | null };

/** The card's paragraph in its part as the reader numbers it now, or null. */
export function useCardParagraph(card: Pick<Card, "lecture_id" | "part_idx" | "anchor" | "quote"> | undefined): Found | null {
  const [found, setFound] = useState<Found | null>(null);
  const lecture = card?.lecture_id;
  const part = card?.part_idx ?? null;
  const anchor = card?.anchor ?? null;
  const quote = card?.quote ?? "";
  useEffect(() => {
    setFound(null);
    if (!lecture || part === null || anchor === null) return;
    let alive = true;
    void (async () => {
      const sec = (await sectionsOf(lecture)).find((s) => s.idx === part);
      if (!sec?.markdown) return;
      const { numberBlocks, reanchor } = await import("../../../shared/study/blocks");
      const blocks = numberBlocks(sec.markdown);
      const at = reanchor(blocks, anchor, quote);
      const i = blocks.findIndex((b) => b.n === at);
      if (!alive || i < 0) return;
      const after = blocks.slice(i + 1).find((b) => b.tag !== "h1" && b.tag !== "h2" && b.tag !== "h3");
      setFound({ part, heading: sec.title, anchor: at, text: blocks[i].text, next: after?.text ?? null });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lecture, part, anchor, quote]);
  return found;
}

export default function CardSource({ card, go, topic }: { card: Pick<Card, "id" | "lecture_id" | "part_idx" | "anchor" | "quote" | "topic">; go: Go; topic?: boolean }) {
  const p = useCardParagraph(card);
  if (!p) return null;
  return (
    <section className="a-card flat card-source" aria-label="מאיפה זה?">
      <div className="a-row between">
        <span className="a-row">
          <Icon name="book" size={14} />
          <b>מאיפה זה?</b>
        </span>
        <RouteLink to={{ v: "lecture", l: card.lecture_id, at: { part: p.part, anchor: p.anchor } }} go={go} className="a-btn small">
          לפסקה
        </RouteLink>
      </div>
      <span className="a-small a-muted">
        בסיכום: חלק {p.part + 1}
        {p.heading ? <> · {isolateLatin(p.heading, `h${card.id}`)}</> : null}
        {topic && card.topic ? (
          <>
            {" "}
            · <bdi dir="ltr">{card.topic}</bdi>
          </>
        ) : null}
      </span>
      <p className="a-para marked">{richText(p.text, `p${card.id}`)}</p>
      {p.next ? <p className="a-para a-muted">{richText(p.next, `n${card.id}`)}</p> : null}
    </section>
  );
}
