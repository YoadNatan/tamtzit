import type { LectureRow } from "./api";
import type { CardLite } from "./cards";
import type { MyCard } from "./cardsDeck";
import { deckCards, type QCard } from "./cardsQueue";

/* ── A review session's cards (package C; C's review, §12.3.C) ──
 * The scope's cards from the group's and the member's own, in deck order
 * (the library's lectures, then parts; C's end's rules, cardsQueue.deckCards):
 * "today" (every lecture), l.<lecture> or c.<course>. The review session
 * (CardReview) and Today's count of due cards (lib/today.ts) read the same
 * cards, so "7 כרטיסים" on Today is the session's first seven. */
export function scopeCards(
  scope: string,
  lectures: LectureRow[],
  lite: CardLite[],
  deck: { adopted: ReadonlySet<string>; userId: string; mine: MyCard[] },
): { cards: QCard[]; lectureIds: Set<string> } | null {
  let ids: Set<string>;
  if (scope === "today") ids = new Set(lectures.map((l) => l.id));
  else if (scope.startsWith("l.")) ids = new Set([scope.slice(2)]);
  else if (scope.startsWith("c.")) ids = new Set(lectures.filter((l) => l.course.trim() === scope.slice(2).trim()).map((l) => l.id));
  else return null;
  const cards = deckCards({
    cards: lite.filter((c) => ids.has(c.lecture_id)),
    lectureOrder: new Map(lectures.map((l, i) => [l.id, i])),
    adopted: deck.adopted,
    userId: deck.userId,
    mine: deck.mine.filter((m) => ids.has(m.lecture_id)),
  });
  return { cards, lectureIds: ids };
}
