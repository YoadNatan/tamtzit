/* ── Near-duplicate text (design-questions §3.6) ──
 * Character-trigram Jaccard similarity, shared by the duplicate checks of
 * practice questions (Q) and flashcards (C). Trigrams are robust to Hebrew's
 * prefixed letters and to word order: on the design's stand-in a reworded copy
 * of a case scored 0.87, unrelated questions 0.01-0.08. */

/** A slide tag as the summaries write it: [ש' 5], [ש׳ 3-4, 9]. */
const TAG = /\[ש['׳]\s?(\d+(?:\s?-\s?\d+)?(?:\s?,\s?\d+(?:\s?-\s?\d+)?)*)\]/g;

/** Lower case, letters and digits only, without slide tags and bold marks. */
export function normalize(s: string): string {
  return s
    .replace(TAG, " ")
    .replace(/\*\*/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function trigrams(s: string): Set<string> {
  const t = ` ${normalize(s)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Jaccard similarity of the two texts' character trigrams, 0 to 1. */
export function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** How much of `query` is in `text`: the share of the query's character
 *  trigrams that the text has, 0 to 1. A short question against a long
 *  paragraph or a part's headings, where Jaccard would be small for every
 *  text (the course ask's context, sources.md B6.9). */
export function coverage(query: string, text: string): number {
  const Q = trigrams(query);
  if (!Q.size) return 0;
  const T = trigrams(text);
  let inter = 0;
  for (const x of Q) if (T.has(x)) inter++;
  return inter / Q.size;
}
