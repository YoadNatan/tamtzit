/* ── Cloze cards (spec §5.5; design-cards §2.2, §3.5) ──
 *
 * A cloze card's front is one Hebrew sentence with exactly one {{…}}: the part
 * the student recalls; its back is empty. The server's checks
 * (server/study/cards.ts), the review screens and the Anki export all read a
 * card through these helpers, so a card means the same thing everywhere. Pure:
 * no imports, safe in the browser and on the server. */

/** Exactly one {{…}} of 1-80 characters and no other brace anywhere: the same
 *  rule as the study_cards_form CHECK on study_cards (section C of the SQL). */
export const CLOZE = /^([^{}]*)\{\{([^{}]{1,80})\}\}([^{}]*)$/;

/** The sentence around the hidden part, and the hidden part; null when the
 *  front is not a valid cloze. */
export function clozeParts(front: string): { before: string; answer: string; after: string } | null {
  const m = CLOZE.exec(front);
  return m ? { before: m[1], answer: m[2], after: m[3] } : null;
}

/** The front as the student sees it before answering. */
export function clozeQuestion(front: string, blank = "[…]"): string {
  const p = clozeParts(front);
  return p ? `${p.before}${blank}${p.after}` : front;
}

/** The whole sentence, as the answer side shows it. */
export function clozeFull(front: string): string {
  const p = clozeParts(front);
  return p ? `${p.before}${p.answer}${p.after}` : front;
}
