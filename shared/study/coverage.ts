/* ── Near-duplicate text and coverage (design-questions §3.6; design-exams D9) ──
 * Character trigrams, robust to Hebrew's prefixed letters and to word order.
 * Moved here from server/study/similar.ts (which re-exports them) so the
 * phone can check an uploaded sheet's copy against its PDF's own text ($0).
 * Pure. */

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

export function trigrams(s: string): Set<string> {
  const t = ` ${normalize(s)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** How much of `query` is in `text`: the share of the query's character
 *  trigrams that the text has, 0 to 1. A short question against a long
 *  paragraph or a part's headings, where Jaccard would be small for every
 *  text (the course ask's context, sources.md B6.9), or an uploaded item
 *  against its page's text (an exact copy scores near 1). */
export function coverage(query: string, text: string): number {
  const Q = trigrams(query);
  if (!Q.size) return 0;
  const T = trigrams(text);
  let inter = 0;
  for (const x of Q) if (T.has(x)) inter++;
  return inter / Q.size;
}
