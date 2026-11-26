import { trigrams } from "../../shared/study/coverage.js";

/* ── Near-duplicate text (design-questions §3.6) ──
 * Character-trigram Jaccard similarity, shared by the duplicate checks of
 * practice questions (Q) and flashcards (C). Trigrams are robust to Hebrew's
 * prefixed letters and to word order: on the design's stand-in a reworded copy
 * of a case scored 0.87, unrelated questions 0.01-0.08. normalize and
 * coverage live in shared/study/coverage.ts (the phone checks an uploaded
 * sheet's copy with coverage) and are re-exported here. */

export { coverage, normalize } from "../../shared/study/coverage.js";

/** Jaccard similarity of the two texts' character trigrams, 0 to 1. */
export function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
