import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";

/* ── A part's blocks: the paragraph anchors every feature points at ──
 *
 * Every top-level block of a summary part (paragraph, heading, table, box,
 * and each item of a top-level list) has a number, its anchor, counted in the
 * order the Markdown gives them. SummaryView writes it as data-blk; comments,
 * follow-the-reader, recording notes, corrections and cards point at it. The
 * same Markdown gives the same anchors on every phone and on the server,
 * because both run the pipeline react-markdown 9 builds:
 *
 *   unified().use(remarkParse).use(remarkGfm).use(remarkRehype).use(rehypeAnchors)
 *
 * Used by the browser (SummaryView) and the server (the notes prompt), so
 * nothing here touches the DOM or Node. Imports end in ".js" (spec §2.2). */

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/** Numbers the top-level blocks (and the items of top-level lists) as data-blk.
 *  Moved here from SummaryView.tsx, unchanged. */
export function rehypeAnchors() {
  return (tree: HastNode) => {
    let n = 0;
    for (const node of tree.children ?? []) {
      if (node.type !== "element") continue;
      if (node.tagName === "ul" || node.tagName === "ol") {
        for (const li of node.children ?? []) {
          if (li.type === "element" && li.tagName === "li") li.properties = { ...li.properties, dataBlk: n++ };
        }
      } else {
        node.properties = { ...node.properties, dataBlk: n++ };
      }
    }
  };
}

/** The clean-up every phone applies before rendering (moved here from
 *  SummaryView.tsx, unchanged): an en dash between digits becomes a hyphen,
 *  and invisible direction marks go. The server tidies a part the same way
 *  before saving it. */
export function tidy(md: string): string {
  return md.replace(/(\d)\s*–\s*(\d)/g, "$1-$2").replace(/[‎‏‪-‮⁦-⁩]/g, "");
}

export type NumberedBlock = {
  /** The anchor: SummaryView's data-blk. */
  n: number;
  /** p, h2, li, table, blockquote… */
  tag: string;
  /** The block's text, whitespace collapsed; source tags such as [ש' 12] stay. */
  text: string;
};

function hastText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

const makeProcessor = () => unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeAnchors);
// Built on first use, so a page that only renders (SummaryView imports
// rehypeAnchors and tidy from here) never builds a second pipeline.
let processor: ReturnType<typeof makeProcessor> | null = null;

/** Every anchored block of a part, in anchor order: exactly the data-blk
 *  numbers SummaryView renders for the same Markdown (blocks.test.ts checks
 *  it against react-markdown on the fixture parts). */
export function numberBlocks(markdown: string): NumberedBlock[] {
  processor ??= makeProcessor();
  const tree = processor.runSync(processor.parse(tidy(markdown))) as unknown as HastNode;
  const out: NumberedBlock[] = [];
  const walk = (node: HastNode) => {
    const n = node.properties?.dataBlk;
    if (node.type === "element" && typeof n === "number") {
      out.push({ n, tag: node.tagName ?? "", text: hastText(node).replace(/\s+/g, " ").trim() });
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(tree);
  return out.sort((a, b) => a.n - b.n);
}

/** Text compared when re-anchoring: no source tags, no Markdown marks,
 *  whitespace collapsed (a comment's quote is cut the same way). */
function plain(s: string): string {
  return s
    .replace(/\[ש['׳]\s?[\d\s,–-]+\]/g, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Where something stored against a paragraph (a recording note, a comment)
 *  belongs after the part was written again or corrected: `anchor` while that
 *  block still opens with `quote` (the first words of the block it was made
 *  on); else the block that opens with it, nearest to the old anchor; else a
 *  block that contains it; else -1, the end of the part. */
export function reanchor(blocks: NumberedBlock[], anchor: number, quote: string): number {
  const q = plain(quote);
  const at = blocks.find((b) => b.n === anchor);
  if (!q) return at ? anchor : -1;
  if (at && plain(at.text).startsWith(q)) return anchor;
  const nearest = (list: NumberedBlock[]) =>
    list.reduce<NumberedBlock | null>((best, b) => (!best || Math.abs(b.n - anchor) < Math.abs(best.n - anchor) ? b : best), null);
  const opens = nearest(blocks.filter((b) => plain(b.text).startsWith(q)));
  if (opens) return opens.n;
  const holds = nearest(blocks.filter((b) => plain(b.text).includes(q)));
  if (holds) return holds.n;
  // The same block with its opening words kept but its end corrected.
  if (at && q.length >= 30 && plain(at.text).slice(0, 30) === q.slice(0, 30)) return anchor;
  return -1;
}
