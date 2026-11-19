import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { tidy } from "./blocks.js";

/* ── Corrections that cannot move an anchor (package K; design-collab §2.2) ──
 *
 * The anchor of a block is its position among a part's top-level blocks (each
 * item of a top-level list counted on its own), exactly as SummaryView's
 * rehypeAnchors numbers data-blk. Comments, the reader's place, follow-the-
 * reader and recording notes point at anchors. A correction replaces the text
 * of ONE block with text that parses as one block of the same kind and leaves
 * every other byte of the part as it was, so every anchor keeps pointing at
 * the same paragraph.
 *
 * Two checks say so. The text rules (textKind, editProblem) are the ones the
 * database applies in study_block_kind() and study_block_edit_problem()
 * (section K of the SQL), so an old or altered phone cannot get past them.
 * checkEdit() also re-parses the whole part with the renderer's pipeline and
 * requires the same tags at the same anchors and every other block unchanged.
 *
 * Used by the corrections editor in the browser and by the "לשאול" and memory
 * aid ops on the server (the focus paragraph, a paragraph's source), so
 * nothing here touches the DOM or Node. Imports end in ".js" (spec §2.2). */

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

export type BlockKind = "heading" | "paragraph" | "item" | "box" | "table" | "figure";
export type Block = {
  /** The anchor (data-blk). */
  n: number;
  /** h2, p, li, blockquote, table, ... */
  tag: string;
  /** null: not editable here (a rule, code, raw HTML, nested structure). */
  kind: BlockKind | null;
  /** Offsets into the (tidy) markdown, widened to whole lines. */
  start: number;
  end: number;
  /** md.slice(start, end) */
  text: string;
};

// The pipeline react-markdown 9 runs (SummaryView), without rendering.
const makeProcessor = () => unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true });
let processor: ReturnType<typeof makeProcessor> | null = null;

function lineStart(md: string, i: number): number {
  const k = md.lastIndexOf("\n", i - 1);
  return k < 0 ? 0 : k + 1;
}
function lineEnd(md: string, i: number): number {
  const k = md.indexOf("\n", i);
  return k < 0 ? md.length : k;
}

function isFigureP(node: HastNode): boolean {
  const kids = (node.children ?? []).filter((c) => !(c.type === "text" && !(c.value ?? "").trim()));
  return kids.length === 1 && kids[0].tagName === "img" && String(kids[0].properties?.src ?? "").startsWith("fig:");
}

function kindOfTag(node: HastNode): BlockKind | null {
  const t = node.tagName ?? "";
  if (/^h[1-6]$/.test(t)) return "heading";
  if (t === "p") return isFigureP(node) ? "figure" : "paragraph";
  if (t === "li") return "item";
  if (t === "blockquote") return "box";
  if (t === "table") return "table";
  return null;
}

/** Every anchored block of a part with its source text, in anchor order.
 *  `md` should already be tidy, as rendered. */
export function blockSources(md: string): Block[] {
  processor ??= makeProcessor();
  const tree = processor.runSync(processor.parse(md)) as unknown as HastNode;
  const out: Block[] = [];
  const add = (node: HastNode) => {
    const s = node.position?.start.offset;
    const e = node.position?.end.offset;
    const n = out.length;
    if (typeof s !== "number" || typeof e !== "number") {
      out.push({ n, tag: node.tagName ?? "", kind: null, start: -1, end: -1, text: "" });
      return;
    }
    const start = lineStart(md, s);
    const end = lineEnd(md, Math.max(start, e - 1)); // the end of the block's last line
    const text = md.slice(start, end);
    let kind = kindOfTag(node);
    // Structure the text rules do not cover is not editable here.
    if (kind && textKind(text) !== kind) kind = null;
    if (kind === "item" && text.includes("\n")) kind = null; // an item with a nested list or a second paragraph
    out.push({ n, tag: node.tagName ?? "", kind, start, end, text });
  };
  for (const node of tree.children ?? []) {
    if (node.type !== "element") continue;
    if (node.tagName === "ul" || node.tagName === "ol") {
      for (const li of node.children ?? []) if (li.type === "element" && li.tagName === "li") add(li);
    } else add(node);
  }
  return out;
}

/* ── The text rules. study_block_kind() and study_block_edit_problem() in
 *    SQL implement exactly these, so the database refuses what the phone
 *    refuses even if a phone runs old or altered code. ── */

const HEADING = /^ {0,3}#{1,6}([ \t]|$)/;
const BOX = /^ {0,3}>/;
const TABLE = /^ {0,3}\|/;
const ITEM = /^ {0,3}([-*+]|[0-9]{1,9}[.)])([ \t]|$)/;
// A caption may not hold [ ] ` < or \ : each could end the picture early or swallow it.
const FIGURE = /^!\[[^[\]\n`<\\]*\]\(fig:[0-9]+-[0-9]+\)$/;

/** The kind of a block from its first characters (study_block_kind). */
export function textKind(t: string): BlockKind | null {
  if (!t) return null;
  if (HEADING.test(t)) return "heading";
  if (BOX.test(t)) return "box";
  if (TABLE.test(t)) return "table";
  if (ITEM.test(t)) return "item";
  if (FIGURE.test(t)) return "figure";
  return "paragraph";
}

const PARA_STARTS =
  /^( {0,3}(#{1,6}([ \t]|$)|>|[-*+]([ \t]|$)|[0-9]{1,9}[.)]([ \t]|$)|\||```|~~~|<|\[[^\]]*\]:|!\[)|( {4}|\t))/;
const THEMATIC = /^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
const EMPTY_LINE = /(^|\n)[ \t]*(\n|$)/;
const INDENT = /^[ \t]*/;
// A fence or an HTML block opened right after an item's marker, or inside a
// quote or a list nested in it ("- > ```", "- 1. <!--").
const ITEM_BLOCK = /^ {0,3}([-*+]|[0-9]{1,9}[.)])([ \t]*(>|[-*+][ \t]|[0-9]{1,9}[.)][ \t]))*[ \t]*(```|~~~|<[A-Za-z!?/])/;
const BOX_LABEL = /^ {0,3}> ?(\*\*[^*\n]{1,60}:\*\*)/;
// Review M9: a URL, "www." or a Markdown link (study_block_edit_problem's pattern).
const LINK = /(https?:\/\/[^\s)\]]+|www\.[^\s)\]]+|\]\()/gi;

/** Cells of a table row with leading and trailing pipes (\| is not a pipe). */
export function pipeCells(line: string): number {
  const t = line.trim().replace(/\\\|/g, "");
  return Math.max(0, t.split("|").length - 2);
}

export type EditProblem = "bad block" | "no change" | "too long" | "link";

/** null when replacing `before` by `after` keeps one block of the same kind
 *  (so no anchor moves) and adds no link; otherwise why not. */
export function editProblem(before: string, after: string): EditProblem | null {
  const k = textKind(before);
  if (!k) return "bad block";
  if (after === before) return "no change";
  if ([...after].length > 8000 || [...before].length > 8000) return "too long";
  if (after.includes("\r") || EMPTY_LINE.test(before) || EMPTY_LINE.test(after)) return "bad block";
  // The block keeps its indentation: two spaces before a paragraph that
  // follows a list make it part of the list's last item, and a space and a
  // tab make it code (both found by edits.test.ts; the spec's rules let them by).
  if (INDENT.exec(after)?.[0] !== INDENT.exec(before)?.[0]) return "bad block";
  if (textKind(after) !== k) return "bad block";
  const bl = before.split("\n");
  const al = after.split("\n");
  if ((k === "heading" || k === "paragraph" || k === "item" || k === "figure") && (bl.length !== 1 || al.length !== 1)) return "bad block";
  if (k === "heading") {
    if (/^ {0,3}(#{1,6})/.exec(before)?.[1] !== /^ {0,3}(#{1,6})/.exec(after)?.[1]) return "bad block";
    if (!/^ {0,3}#{1,6}[ \t]+[^ \t#]/.test(after)) return "bad block";
  }
  if (k === "item") {
    const m = (s: string) => /^ {0,3}([-*+]|[0-9]{1,9}[.)])[ \t]/.exec(s)?.[1];
    if (m(before) !== m(after) || !/^ {0,3}([-*+]|[0-9]{1,9}[.)])[ \t]+[^ \t]/.test(after)) return "bad block";
    // An item that reads as a rule ("- ---") is a rule, and a fence or an HTML
    // block opened inside an item (or in a quote or list nested in it) reaches
    // past its line (both found by edits.test.ts; the spec's rules let them by).
    if (THEMATIC.test(after) || ITEM_BLOCK.test(after)) return "bad block";
  }
  if (k === "figure") {
    const r = (s: string) => /\((fig:[0-9]+-[0-9]+)\)$/.exec(s)?.[1];
    if (r(before) !== r(after)) return "bad block";
  }
  if (k === "paragraph" && (PARA_STARTS.test(after) || THEMATIC.test(after))) return "bad block";
  if (k === "box") {
    if (!bl.every((l) => BOX.test(l)) || !al.every((l) => BOX.test(l))) return "bad block";
    if (BOX_LABEL.exec(before)?.[1] !== BOX_LABEL.exec(after)?.[1]) return "bad block";
  }
  if (k === "table") {
    const rowOk = (l: string) => TABLE.test(l) && /\|[ \t]*$/.test(l);
    if (!bl.every(rowOk) || !al.every(rowOk)) return "bad block";
    if (bl.length !== al.length || bl.length < 2 || bl[1] !== al[1]) return "bad block";
    // a backslash is allowed only as the escape of a pipe, so cells are counted exactly
    if (al.some((l) => l.replace(/\\\|/g, "").includes("\\"))) return "bad block";
    if (pipeCells(al[0]) !== pipeCells(al[1])) return "bad block";
  }
  // No new links in the trusted reader (review M9): a URL, "www." or a
  // Markdown link that the block did not already have. Structure comes first.
  const was = before.toLowerCase();
  for (const m of after.matchAll(LINK)) if (!was.includes(m[1].toLowerCase())) return "link";
  return null;
}

/** 0-based offsets where `blk` stands on whole lines of `md`
 *  (study_block_positions, which counts from 1). */
export function alignedPositions(md: string, blk: string): number[] {
  const out: number[] = [];
  if (!blk) return out;
  for (let i = md.indexOf(blk); i >= 0; i = md.indexOf(blk, i + 1)) {
    const okStart = i === 0 || md[i - 1] === "\n";
    const j = i + blk.length;
    const okEnd = j === md.length || md[j] === "\n";
    if (okStart && okEnd) out.push(i);
  }
  return out;
}

export type EditCheck =
  | { ok: true; md: string; occurrence: number; before: string; after: string; kind: BlockKind }
  | { ok: false; why: "not editable" | "shape" | EditProblem };

// The editor checks one part again and again: its blocks are parsed once.
let lastParsed: { md: string; blocks: Block[] } | null = null;
function blocksOf(md: string): Block[] {
  if (lastParsed?.md !== md) lastParsed = { md, blocks: blockSources(md) };
  return lastParsed.blocks;
}

/** The phone's full check: the text rules, then a re-parse proving that every
 *  anchor still points at the same block (same tags, other blocks' text
 *  unchanged). `md` is tidy(section.markdown); `afterRaw` is tidied here, as
 *  the database tidies it. The result carries what study_edit_block() takes:
 *  `before`, `after` and the whole-line `occurrence` of `before` (1 = first). */
export function checkEdit(md: string, anchor: number, afterRaw: string): EditCheck {
  const blocks = blocksOf(md);
  const b = blocks[anchor];
  if (!b || !b.kind) return { ok: false, why: "not editable" };
  const after = tidy(afterRaw);
  const problem = editProblem(b.text, after);
  if (problem) return { ok: false, why: problem };
  const next = md.slice(0, b.start) + after + md.slice(b.end);
  const nb = blockSources(next);
  const same =
    nb.length === blocks.length &&
    nb.every((x, i) => x.tag === blocks[i].tag && (i === anchor ? x.kind === b.kind && x.text === after : x.text === blocks[i].text));
  if (!same) return { ok: false, why: "shape" };
  const occurrence = alignedPositions(md, b.text).indexOf(b.start) + 1;
  return { ok: true, md: next, occurrence, before: b.text, after, kind: b.kind };
}

/* ── The editor's view of a block: a fixed prefix and suffix around the
 *    text a member edits, so markers, labels and figure ids cannot be
 *    touched by accident. ── */
export type Editable = { prefix: string; body: string; suffix: string };

export function editableParts(b: Pick<Block, "kind" | "text">): Editable | null {
  const t = b.text;
  switch (b.kind) {
    case "heading": {
      const m = /^( {0,3}#{1,6}[ \t]+)(.*)$/.exec(t);
      return m ? { prefix: m[1], body: m[2], suffix: "" } : null;
    }
    case "item": {
      const m = /^( {0,3}(?:[-*+]|[0-9]{1,9}[.)])[ \t]+)(.*)$/.exec(t);
      return m ? { prefix: m[1], body: m[2], suffix: "" } : null;
    }
    case "figure": {
      const m = /^(!\[)([^[\]\n`<\\]*)(\]\(fig:[0-9]+-[0-9]+\))$/.exec(t);
      return m ? { prefix: m[1], body: m[2], suffix: m[3] } : null;
    }
    case "box": {
      const lines = t.split("\n").map((l) => l.replace(/^ {0,3}> ?/, ""));
      const joined = lines.join(" ").trim();
      const m = /^(\*\*[^*\n]{1,60}:\*\*[ \t]*)(.*)$/.exec(joined);
      return m ? { prefix: "> " + m[1], body: m[2], suffix: "" } : { prefix: "> ", body: joined, suffix: "" };
    }
    case "paragraph":
      return { prefix: "", body: t, suffix: "" };
    default:
      return null; // tables have their own cell editor
  }
}

/** What the member typed, made one line (a new line would start a new block). */
export function compose(e: Editable, body: string): string {
  let clean = body.replace(/\s*\n\s*/g, " ").trim();
  if (e.suffix.startsWith("](")) clean = clean.replace(/[[\]]/g, (c) => (c === "[" ? "(" : ")")).replace(/[`<\\]/g, "");
  return e.prefix + clean + e.suffix;
}

/* ── Tables: edited cell by cell; rows and columns stay as they are (v1). ── */
export function tableCells(text: string): { cells: string[][]; delimiter: string } | null {
  const lines = text.split("\n");
  if (lines.length < 2) return null;
  const row = (l: string) =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, "|"));
  return { cells: [lines[0], ...lines.slice(2)].map(row), delimiter: lines[1] };
}

export function tableText(t: { cells: string[][]; delimiter: string }): string {
  const row = (r: string[]) =>
    "| " + r.map((c) => c.replace(/\s*\n\s*/g, " ").replace(/\\/g, "").trim().replace(/\|/g, "\\|") || " ").join(" | ") + " |";
  return [row(t.cells[0]), t.delimiter, ...t.cells.slice(1).map(row)].join("\n");
}

/* ── History: a word-level diff for "לפני / אחרי". ── */
export type DiffPart = { op: "same" | "del" | "ins"; text: string };
export function wordDiff(a: string, b: string): DiffPart[] | null {
  const x = a.split(/(\s+)/).filter(Boolean);
  const y = b.split(/(\s+)/).filter(Boolean);
  if (x.length > 700 || y.length > 700) return null; // too long to diff on a phone: show before and after whole
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (op: DiffPart["op"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push("same", x[i++]);
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", x[i++]);
    else push("ins", y[j++]);
  }
  while (i < x.length) push("del", x[i++]);
  while (j < y.length) push("ins", y[j++]);
  return out;
}

/** Slides a text cites ([ש' 12], [ש' 12-14], [ש' 2, 26]), in order; used by
 *  the memory aids and "לשאול". */
export function citedSlides(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\[ש['׳]\s?([\d\s,–-]+)\]/g)) {
    for (const part of m[1].split(",")) {
      const r = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
      if (!r) continue;
      const a = Number(r[1]);
      const b = r[2] ? Number(r[2]) : a;
      for (let k = Math.min(a, b); k <= Math.max(a, b) && k - Math.min(a, b) < 60; k++) out.add(k);
    }
  }
  return [...out].sort((p, q) => p - q);
}
