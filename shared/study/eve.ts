/* ── The exam-eve view, pure (spec §12.3.A's PR6, as the proposal cut it:
 *    "שקף 37 כמו שהוא, האסוציאציות הנעוצות והטעויות ׳על בטוח׳ שלך"; no new
 *    generator, no AI) ──
 *
 * summarySlide picks the lecture's own summary slide as the lecturer wrote
 * it: the last slide whose title says it sums up ("סיכום", "Summary",
 * "Take-home", "Key points", "Conclusions", "לסיכום", "נקודות חשובות"). None
 * found: null, and the screen says so instead of inventing one. eveAids orders
 * the wall's entries: the ones pinned in a meeting, then the paragraphs'
 * winners (on everyone's cards), then the member's own, each once. */

const SUMMARY = /(^|[^א-ת])(לסיכום|סיכום|סיכומים|נקודות חשובות|נקודות מפתח|דגשים)([^א-ת]|$)|\b(summary|summing up|take[\s-]?home|key (points|messages|facts)|conclusions?|recap|bottom line)\b/i;

export type EveSlide = { n: number; title: string; lines: string[]; tables?: string[][][] };

export function summarySlide<S extends EveSlide>(slides: readonly S[]): S | null {
  for (let i = slides.length - 1; i >= 0; i--) if (SUMMARY.test(slides[i].title ?? "")) return slides[i];
  return null;
}

export function eveAids<A extends { id: string; pinned: boolean; on_cards: boolean; mine: boolean; flag?: string | null }>(aids: readonly A[], max = 8): A[] {
  const ok = aids.filter((a) => !a.flag);
  const seen = new Set<string>();
  const out: A[] = [];
  for (const pass of [(a: A) => a.pinned, (a: A) => a.on_cards, (a: A) => a.mine])
    for (const a of ok) if (pass(a) && !seen.has(a.id) && out.length < max) {
      seen.add(a.id);
      out.push(a);
    }
  return out;
}

/** Decision 3: what each empty part of the view is waiting for, in words. */
export const EVE_EMPTY = {
  slide: "לא נמצא בהרצאה שקף שמסכם אותה. הסיכום המלא נמצא בהרצאה.",
  aids: "עוד אין אסוציאציות נעוצות או זוכות בהרצאה הזו. מה שננעץ בפגישה או זוכה בהצבעה מופיע כאן.",
  errors: "אין לך טעויות ׳על בטוח׳ בהרצאה הזו. תשובה שגויה אחרי ׳על בטוח׳ מופיעה כאן עד שעונים עליה נכון פעמיים.",
} as const;
