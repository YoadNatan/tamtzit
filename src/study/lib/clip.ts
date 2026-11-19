/** A text cut at the last whole word that fits in `max` characters, with
 *  "…" (a word longer than half of `max` is cut inside). The cut is made here,
 *  in logical order, never by a CSS ellipsis: in a right-to-left line that
 *  cuts an English name from its start ("…etics)"). Names, quotes and the
 *  gist of a correction share it, so no preview stops in the middle of a word. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const at = head.lastIndexOf(" ");
  return `${(at >= max / 2 ? head.slice(0, at) : head).replace(/[\s:·,–-]+$/u, "")}…`;
}

/** "כרטיסייה אחת" or "5 כרטיסיות": the deck's word for a count of cards
 *  (cards.html s3), on the deck page and in the export sheet alike. */
export const cardsWord = (n: number): string => (n === 1 ? "כרטיסייה אחת" : `${n} כרטיסיות`);
