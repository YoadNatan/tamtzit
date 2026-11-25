import { isValidElement, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeAnchors, tidy } from "../../../shared/study/blocks";
import { isolateLatin, richChildren, slideTag, type RichOptions } from "../lib/rich";
import type { BlockState, ParagraphAction } from "../features/types";

/* ── The summary on the page ──
 *
 * A lecture summary arrives as Markdown written by the model (never raw HTML:
 * react-markdown does not render it). Three conventions on top of Markdown:
 *
 *  - Figures:  ![כיתוב](fig:12-1)  is picture 1 of slide 12, resolved by
 *    `figureUrl`. Unknown or missing pictures render nothing.
 *  - Callouts: a block quote that opens with **הרחבה**, **שימו לב**,
 *    **דגש מהמרצה** or **מההקלטה** gets its own box, so outside knowledge,
 *    conflicts between slides and the lecturer's words stand apart.
 *  - Sources:  [ש' 12] or [ש' 12-14] after a sentence is a tag that points
 *    back to the slides; with `onTag` it is a button that opens SlideSheet.
 *
 * Direction. Every block is right-to-left (never dir="auto": a paragraph that
 * opens with "Fluconazole" would flip to left-to-right), and every run of
 * Latin text, with its digits, units, ® and brackets, is isolated in <bdi>
 * (lib/rich.tsx).
 *
 * Paragraph anchors. Every top-level block (paragraph, heading, list item,
 * table, box) gets a number, its anchor (shared/study/blocks.ts), counted in
 * the order the Markdown gives them. The same Markdown gives the same anchors
 * on every phone and on the server. Nothing this file adds around a block
 * (actions, boxes from the packages' hooks) carries data-blk, so anchors never
 * move.
 *
 * Links are text (review M9): a link written by a member, a transcript or the
 * model renders as its words and its host, never as an anchor that could lead
 * out of the reader.
 */

/** Comments on one paragraph: how many, and how many are open questions. */
export type BlockNotes = { total: number; open: number };

export { isolateLatin };

type Props = {
  markdown: string;
  figureUrl?: (slide: number, index: number) => string | undefined;
  /** Heading ids are prefixed with this, so two summaries on one page never clash. */
  idPrefix?: string;
  /** Comments per paragraph anchor. */
  notes?: Record<number, BlockNotes>;
  /** The paragraph tapped by this reader (shows its actions). */
  selected?: number | null;
  /** The paragraph the group's reader is on, or a deep link's target. */
  marked?: number | null;
  /** A tap on a paragraph (not on a link, picture or button). */
  onBlock?: (anchor: number, quote: string) => void;
  /** Open a paragraph's comments (its comment count). */
  onNotes?: (anchor: number, quote: string) => void;
  /** The actions offered under a selected paragraph, each behind its flag. */
  actions?: readonly ParagraphAction[];
  /** One of the selected paragraph's actions (or the edit chip) was tapped. */
  onAction?: (action: ParagraphAction, anchor: number, quote: string) => void;
  /** A slide tag was tapped: its slides (tags become buttons). */
  onTag?: (slides: number[]) => void;
  /** Tags of slides the lecture does not have are muted. */
  badSlides?: readonly number[];
  /** No anchors and no handlers: answers, comment bodies, previews. */
  compact?: boolean;
  /** Pictures load at once (printing). */
  eager?: boolean;
  /** Rendered after an anchored block, never inside it (W's "מההקלטה" boxes). */
  blockExtras?: (anchor: number) => ReactNode;
  /** A block's corrections chip, "תיקון ממתין לאישור", its 2-s flash and whether "תיקון" is offered (K). */
  blockState?: (anchor: number) => BlockState;
};

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

function anchorOf(node: unknown): number | undefined {
  const v = (node as HastNode | undefined)?.properties?.dataBlk;
  return typeof v === "number" ? v : undefined;
}

/** The first words of a paragraph, without its source tags. */
function quoteOf(node: unknown): string {
  return hastText(node as HastNode)
    .replace(/\[ש['׳]\s?[\d\s,–-]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

const NOTE_ICON = (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path
      d="M4 3.5h12A1.5 1.5 0 0 1 17.5 5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

/** The kit's callouts: "הרחבה" the default, "שימו לב" .warn, the lecturer's
 *  words .rec, any other quote .quiet. */
const CALLOUTS: Array<[RegExp, string]> = [
  [/^הרחבה/, "a-callout"],
  [/^שימו לב/, "a-callout warn"],
  [/^דגש מהמרצה/, "a-callout rec"],
  [/^מההקלטה/, "a-callout rec"],
];

/** The words of each paragraph action (the copy deck, §6.4 F/W 1.E). */
export const ACTION_LABEL: Record<ParagraphAction, string> = {
  comment: "תגובה או שאלה",
  edit: "תיקון",
  mnemonic: "אסוציאציה",
  ask: "לשאול",
};

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function hostOf(href: string | undefined): string {
  try {
    return href ? new URL(href).host : "";
  } catch {
    return "";
  }
}

export function headingId(prefix: string, index: number) {
  return `${prefix}h${index}`;
}

export default function SummaryView({
  markdown,
  figureUrl,
  idPrefix = "",
  notes,
  selected,
  marked,
  onBlock,
  onNotes,
  actions,
  onAction,
  onTag,
  badSlides,
  compact,
  eager,
  blockExtras,
  blockState,
}: Props) {
  let headingIndex = 0;
  const nextId = () => headingId(idPrefix, headingIndex++);
  const rich: RichOptions = { tags: onTag && !compact ? "link" : "plain", badSlides };
  const inline = (children: ReactNode) => richChildren(children, rich);
  const interactive = !compact;

  /** Attributes for an anchored block: its number, highlight classes and the tap. */
  const blockProps = (node: unknown, base?: string) => {
    const a = interactive ? anchorOf(node) : undefined;
    if (a === undefined) return { className: base };
    const state = blockState?.(a);
    const cls = [base, "blk", selected === a ? "blk-selected" : "", marked === a ? "blk-marked" : "", state?.flash ? "blk-updated" : ""]
      .filter(Boolean)
      .join(" ");
    if (!onBlock) return { "data-blk": a, className: cls };
    return {
      "data-blk": a,
      className: cls,
      // Reachable from the keyboard too: Enter or Space selects the paragraph.
      tabIndex: 0,
      onClick: (e: MouseEvent<HTMLElement>) => {
        if ((e.target as HTMLElement).closest("a, button, img, .a-tag")) return;
        onBlock(a, quoteOf(node));
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onBlock(a, quoteOf(node));
      },
    };
  };

  /** Inside a block, at its end: the comment count, the corrections chip, and
   *  the selected paragraph's actions. */
  const extras = (node: unknown) => {
    const a = interactive ? anchorOf(node) : undefined;
    if (a === undefined) return null;
    const quote = () => quoteOf(node);
    const out: ReactNode[] = [];
    const n = notes?.[a];
    if (onNotes && n && n.total > 0)
      out.push(
        <button
          key="notes"
          type="button"
          className={`a-chip note-dot${n.open ? " warn" : ""}`}
          onClick={() => onNotes(a, quote())}
          aria-label={n.open ? `${n.total} תגובות, ${n.open} שאלות פתוחות` : `${n.total} תגובות`}
        >
          {NOTE_ICON}
          <bdi dir="ltr">{n.total}</bdi>
        </button>,
      );
    const state = blockState?.(a);
    if (onAction && state?.edited && state.edited > 0)
      out.push(
        <button key="edits" type="button" className="a-chip busy edit-dot" onClick={() => onAction("edit", a, quote())} aria-label={`תיקונים בפסקה: ${state.edited}. היסטוריה`}>
          {state.edited === 1 ? "תיקון" : `${state.edited} תיקונים`}
        </button>,
      );
    if (onAction && state?.pending)
      out.push(
        <button key="pending" type="button" className="a-chip warn edit-dot pending" onClick={() => onAction("edit", a, quote())}>
          תיקון ממתין לאישור
        </button>,
      );
    if (selected === a && (onAction || onNotes)) {
      const shown = (onAction ? (actions ?? ["comment"]) : ["comment" as const]).filter((x) => x !== "edit" || state?.editable !== false);
      const run = (x: ParagraphAction) => (x === "comment" && !onAction ? onNotes!(a, quote()) : onAction!(x, a, quote()));
      if (shown.length === 1 && shown[0] === "comment" && !(n && n.total > 0))
        out.push(
          <button key="add" type="button" className="a-chip busy note-add" onClick={() => run("comment")}>
            {NOTE_ICON}
            {ACTION_LABEL.comment}
          </button>,
        );
      else if (shown.length && !(shown.length === 1 && shown[0] === "comment"))
        out.push(
          <span key="actions" className="blk-actions" role="group" aria-label="פעולות על הפסקה">
            {shown.map((x) => (
              <button key={x} type="button" className="a-btn small" onClick={() => run(x)}>
                {ACTION_LABEL[x]}
              </button>
            ))}
          </span>,
        );
    }
    return out.length ? out : null;
  };

  /** After a block: what the packages' hooks add (never inside it). */
  const after = (node: unknown) => {
    const a = interactive ? anchorOf(node) : undefined;
    return a === undefined || !blockExtras ? null : blockExtras(a);
  };

  const components: Components = {
    h1: ({ children, node }) => (
      <>
        <h1 id={nextId()} dir="rtl" {...blockProps(node)}>
          {inline(children)}
          {extras(node)}
        </h1>
        {after(node)}
      </>
    ),
    h2: ({ children, node }) => (
      <>
        <h2 id={nextId()} dir="rtl" {...blockProps(node)}>
          {inline(children)}
          {extras(node)}
        </h2>
        {after(node)}
      </>
    ),
    h3: ({ children, node }) => (
      <>
        <h3 id={nextId()} dir="rtl" {...blockProps(node)}>
          {inline(children)}
          {extras(node)}
        </h3>
        {after(node)}
      </>
    ),
    p: ({ children, node }) => (
      <>
        <p dir="rtl" {...blockProps(node)}>
          {inline(children)}
          {extras(node)}
        </p>
        {after(node)}
      </>
    ),
    li: ({ children, node }) => {
      const more = after(node);
      return (
        <>
          <li dir="rtl" {...blockProps(node)}>
            {inline(children)}
            {extras(node)}
          </li>
          {more ? <li className="blk-extras">{more}</li> : null}
        </>
      );
    },
    strong: ({ children }) => <strong>{inline(children)}</strong>,
    em: ({ children }) => <em>{inline(children)}</em>,
    td: ({ children }) => <td dir="rtl">{inline(children)}</td>,
    th: ({ children }) => <th dir="rtl">{inline(children)}</th>,
    table: ({ children, node }) => (
      <>
        <div {...blockProps(node, "table-wrap")}>
          <table dir="rtl">{children}</table>
          {extras(node)}
        </div>
        {after(node)}
      </>
    ),
    blockquote: ({ children, node }) => {
      const first = textOf(children).trim();
      const cls = CALLOUTS.find(([re]) => re.test(first))?.[1] ?? "a-callout quiet";
      return (
        <>
          <aside dir="rtl" {...blockProps(node, cls)}>
            {children}
            {extras(node)}
          </aside>
          {after(node)}
        </>
      );
    },
    img: ({ src, alt }) => {
      const m = /^fig:(\d+)-(\d+)$/.exec(src ?? "");
      const url = m && figureUrl ? figureUrl(Number(m[1]), Number(m[2])) : undefined;
      if (!m || !url) return null;
      const pic = <img src={url} alt={alt ?? ""} loading={eager ? "eager" : "lazy"} />;
      return (
        <figure className="slide-figure">
          {/* With slide sheets, a tap on the picture opens its slide, big (the summary's own click below). */}
          {onTag && !compact ? (
            <button type="button" className="slide-zoom" data-slide={m[1]} aria-label={`הגדלה: שקף ${m[1]}`}>
              {pic}
            </button>
          ) : (
            pic
          )}
          {alt ? <figcaption dir="rtl">{isolateLatin(alt, "c")}</figcaption> : null}
        </figure>
      );
    },
    // Links are text: their words, then their host in brackets when the
    // words do not already show it (review M9).
    a: ({ href, children }) => {
      const host = hostOf(href);
      const words = textOf(children);
      return (
        <span className="link-text">
          {inline(children)}
          {host && !words.includes(host) ? (
            <>
              {" "}(<bdi dir="ltr">{host}</bdi>)
            </>
          ) : null}
        </span>
      );
    },
  };

  return (
    <div
      className={`summary${compact ? " compact" : ""}`}
      dir="rtl"
      lang="he"
      onClick={
        onTag && !compact
          ? (e) => {
              const zoom = e.target instanceof Element ? e.target.closest<HTMLElement>(".slide-zoom[data-slide]") : null;
              const slides = zoom ? [Number(zoom.dataset.slide)] : slideTag(e.target);
              if (slides) onTag(slides);
            }
          : undefined
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={compact ? [] : [rehypeAnchors]}
        components={components}
        urlTransform={(url) => (url.startsWith("fig:") ? url : defaultUrlTransform(url))}
      >
        {tidy(markdown)}
      </ReactMarkdown>
    </div>
  );
}

/** Headings for a table of contents, in the order SummaryView numbers them. */
export function outline(markdown: string): Array<{ level: number; text: string; index: number }> {
  const out: Array<{ level: number; text: string; index: number }> = [];
  let index = 0;
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, "").trim(), index: index++ });
  }
  return out;
}
