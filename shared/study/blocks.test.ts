import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SummaryView from "../../src/study/components/SummaryView";
import { numberBlocks, reanchor, rehypeAnchors, tidy } from "./blocks.js";

/* numberBlocks is the server's (and the corrections editor's) view of a
 * part's paragraph anchors; SummaryView's data-blk is what every phone shows.
 * They must agree exactly, or a recording note or a correction lands on the
 * wrong paragraph. Checked on the synthetic fixture parts (e2e/study/fixtures),
 * rendered by the real SummaryView with react-dom/server. */

const PARTS = join(process.cwd(), "e2e", "study", "fixtures", "parts");
const parts = readdirSync(PARTS)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => ({ name: f, md: readFileSync(join(PARTS, f), "utf8") }));

// SummaryView draws a table inside a div and a box as an aside.
const SHOWN_AS: Record<string, string> = { table: "div", blockquote: "aside" };

function rendered(md: string): Array<{ n: number; tag: string }> {
  const html = renderToStaticMarkup(createElement(SummaryView, { markdown: md, onBlock: () => undefined }));
  return [...html.matchAll(/<(\w+)[^>]*\sdata-blk="(\d+)"/g)].map((m) => ({ n: Number(m[2]), tag: m[1] }));
}

test("the fixture parts are the structure of a real lecture: eight parts with tables, boxes, figures and lists", () => {
  assert.equal(parts.length, 8);
  const all = parts.map((p) => p.md).join("\n");
  for (const [what, re] of [
    ["a table", /^\|.*\|$/m],
    ["a box", /^> \*\*/m],
    ["a figure", /!\[[^\]]*\]\(fig:\d+-\d+\)/],
    ["a numbered list", /^\d+\. /m],
    ["a bullet list", /^- /m],
    ["a slide tag", /\[ש' \d+/],
  ] as const) assert.match(all, re, what);
});

test("numberBlocks equals SummaryView's data-blk on every fixture part", () => {
  let total = 0;
  for (const { name, md } of parts) {
    const server = numberBlocks(md);
    const client = rendered(md);
    assert.ok(server.length > 5, `${name}: ${server.length} blocks`);
    assert.deepEqual(
      server.map((b) => ({ n: b.n, tag: SHOWN_AS[b.tag] ?? b.tag })),
      client,
      `${name}: the anchors differ`,
    );
    assert.deepEqual(
      server.map((b) => b.n),
      server.map((_, i) => i),
      `${name}: anchors count up from 0`,
    );
    total += server.length;
  }
  assert.ok(total > 60, `${total} blocks`);
});

/* The static markup as elements, each with where it starts and ends and its
 * parent (react-dom/server's output is well formed and escapes ">" inside
 * attribute values, so a tag ends at the first ">"). */
type El = { tag: string; attrs: string; start: number; end: number; parent: El | null };
const VOID = new Set(["img", "br", "hr", "input", "source", "wbr", "col", "area", "meta", "link"]);
function elements(html: string): El[] {
  const out: El[] = [];
  const open: El[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [whole, close, tag, attrs] = m;
    const at = m.index ?? 0;
    if (close) {
      const el = open.pop();
      assert.equal(el?.tag, tag, `well-formed markup at ${at}`);
      el!.end = at + whole.length;
      continue;
    }
    const el: El = { tag, attrs, start: at, end: -1, parent: open[open.length - 1] ?? null };
    out.push(el);
    if (VOID.has(tag) || attrs.endsWith("/")) el.end = at + whole.length;
    else open.push(el);
  }
  assert.equal(open.length, 0, "every element closed");
  return out;
}
const attr = (el: El, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(el.attrs)?.[1];
const within = (el: El, outer: El) => el.start > outer.start && el.end <= outer.end;

test("the packages' hooks (blockExtras, blockState) draw beside the blocks and never move an anchor", () => {
  for (const { name, md } of parts) {
    const plain = rendered(md);
    const anchors = plain.map((b) => b.n);
    const state = (a: number) => ({ edited: a % 3 === 0 ? 2 : 0, flash: a === 4, editable: a !== 5 });
    const draw = (selected: number) =>
      renderToStaticMarkup(
        createElement(SummaryView, {
          markdown: md,
          onBlock: () => undefined,
          onAction: () => undefined,
          actions: ["comment", "edit"],
          selected,
          // W's "מההקלטה" box after each block; K's chip, flash and permission on it.
          blockExtras: (a: number) => createElement("aside", { className: "e2e-box", "data-for": a }, `מההקלטה ${a}`),
          blockState: state,
        }),
      );

    for (const selected of [4, 5]) {
      const html = draw(selected);
      const els = elements(html);
      // 1. The anchors are the plain render's, block by block.
      const blocks = els.filter((e) => attr(e, "data-blk") !== undefined);
      assert.deepEqual(
        blocks.map((e) => ({ n: Number(attr(e, "data-blk")), tag: e.tag })),
        plain,
        `${name}: the hooks moved an anchor`,
      );
      const blockOf = new Map(blocks.map((e) => [Number(attr(e, "data-blk")), e]));
      // 2. One box per block, after it and never inside it.
      const boxes = els.filter((e) => attr(e, "class") === "e2e-box");
      assert.deepEqual(
        boxes.map((b) => Number(attr(b, "data-for"))),
        anchors,
        `${name}: one box per block, in order`,
      );
      for (const box of boxes) {
        const a = Number(attr(box, "data-for"));
        const block = blockOf.get(a)!;
        assert.ok(box.start >= block.end, `${name}: the box of ${a} comes after its block`);
        for (let p = box.parent; p; p = p.parent) assert.notEqual(attr(p, "data-blk"), String(a), `${name}: the box of ${a} is inside its block`);
      }
      // 3. The flash, and the corrections chip on every corrected block (inside it).
      for (const [a, block] of blockOf) {
        const cls = (attr(block, "class") ?? "").split(" ");
        assert.equal(cls.includes("blk-updated"), a === 4, `${name}: blk-updated on ${a}`);
        const chips = els.filter((e) => (attr(e, "class") ?? "").split(" ").includes("edit-dot") && within(e, block) && !blocks.some((b) => b !== block && within(b, block) && within(e, b)));
        assert.equal(chips.length, state(a).edited > 0 ? 1 : 0, `${name}: the corrections chip on ${a}`);
      }
      // 4. "תיקון" is offered on the selected block only where it may be edited.
      const sel = blockOf.get(selected);
      if (!sel) continue;
      const actions = els.filter((e) => attr(e, "class") === "blk-actions" && within(e, sel));
      const editOffered = html.slice(sel.start, sel.end).includes('<button type="button" class="a-btn small">תיקון</button>');
      if (selected === 4) assert.ok(actions.length === 1 && editOffered, `${name}: "תיקון" offered on an editable block`);
      else assert.ok(!editOffered && html.slice(sel.start, sel.end).includes("תגובה או שאלה"), `${name}: "תיקון" hidden where editable is false`);
    }
  }
});

test("a block's text keeps its source tags and loses its Markdown", () => {
  const [, b1] = numberBlocks("## כותרת\n\n**מנגנון פעולה:** מעכב את ה-NKCC2. [ש' 6]\n");
  assert.equal(b1.tag, "p");
  assert.equal(b1.text, "מנגנון פעולה: מעכב את ה-NKCC2. [ש' 6]");
  const items = numberBlocks("- אחד\n- שניים\n\n1. שלוש\n");
  assert.deepEqual(items.map((b) => `${b.n}:${b.tag}:${b.text}`), ["0:li:אחד", "1:li:שניים", "2:li:שלוש"]);
});

test("tidy and rehypeAnchors are what SummaryView uses (moved, unchanged)", () => {
  assert.equal(tidy("שקפים 12–14 ו‏-3 – 4"), "שקפים 12-14 ו-3-4");
  const tree = { type: "root", children: [{ type: "element", tagName: "ul", children: [{ type: "element", tagName: "li" }, { type: "text" }, { type: "element", tagName: "li" }] }, { type: "element", tagName: "p" }] };
  rehypeAnchors()(tree);
  const blk = (n: { properties?: Record<string, unknown> }) => n.properties?.dataBlk;
  assert.deepEqual([blk(tree.children[0].children![0]), blk(tree.children[0].children![2]), blk(tree.children[1])], [0, 1, 2]);
});

test("reanchor: a note or comment follows its paragraph when the part changes", () => {
  const md = parts[2].md;
  const blocks = numberBlocks(md);
  const target = blocks.find((b) => b.text.startsWith("פרמקוקינטיקה"))!;
  const quote = target.text.slice(0, 80);
  assert.equal(reanchor(blocks, target.n, quote), target.n, "unchanged part: the same anchor");

  const inserted = numberBlocks(md.replace("### Furosemide, Bumetanide", "### Furosemide, Bumetanide\n\nפסקה חדשה שנוספה בכתיבה מחדש. [ש' 6]"));
  assert.equal(reanchor(inserted, target.n, quote), target.n + 1, "a paragraph written before it: the anchor moves with it");

  const corrected = numberBlocks(md.replace("t½ ≈ 1.5 h.", "t½ ≈ 1.5-2 h."));
  assert.equal(reanchor(corrected, target.n, quote), target.n, "its end corrected: it stays");

  const removed = numberBlocks(md.replace(/\*\*פרמקוקינטיקה:\*\*[^\n]*\n/, ""));
  assert.equal(reanchor(removed, target.n, quote), -1, "its paragraph is gone: the end of the part");

  assert.equal(reanchor(blocks, 2, ""), 2, "no quote: the anchor while it exists");
  assert.equal(reanchor(blocks, 999, ""), -1, "no quote and no such block: the end of the part");
  assert.equal(reanchor(blocks, 0, "**פרמקוקינטיקה:** ספיגה פומית [ש' 6]"), target.n, "a quote with Markdown and tags matches its plain text");
});
