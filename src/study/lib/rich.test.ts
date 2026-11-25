import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { barLabel, isolateLatin, keepRange, richChildren, softBreaks } from "./rich";

/* The summary's direction rules (lib/rich.tsx; docs/study/ux-p1.md, WP3). */

const html = (nodes: unknown) => renderToStaticMarkup(createElement(Fragment, null, nodes as never));

test("a string with no Hebrew is still isolated when it has Latin or digits: a table cell \"1 h\" never reads \"h 1\"", () => {
  assert.equal(html(isolateLatin("1 h")), '<bdi dir="ltr">1 h</bdi>');
  assert.equal(html(isolateLatin("t½")), '<bdi dir="ltr">t½</bdi>');
  assert.equal(html(isolateLatin("K⁺")), '<bdi dir="ltr">K⁺</bdi>');
  assert.equal(html(isolateLatin("≈3%")), '<bdi dir="ltr">≈3%</bdi>');
  // A bold label: its colon and the spaces stay outside, so they sit between it and the Hebrew.
  assert.equal(html(isolateLatin("Proximal tubule: ")), '<bdi dir="ltr">Proximal tubule</bdi>: ');
  // Nothing Latin, nothing to isolate.
  assert.equal(html(isolateLatin(" · ")), " · ");
  assert.equal(html(isolateLatin("")), "");
});

test("a number range keeps its two ends on one line (a non-breaking hyphen), inside Hebrew too", () => {
  assert.equal(keepRange("3-4 h"), "3‑4 h");
  assert.equal(keepRange("K⁺-sparing"), "K⁺-sparing");
  assert.equal(html(isolateLatin("3-4 h")), '<bdi dir="ltr">3‑4 h</bdi>');
  assert.equal(html(isolateLatin("ירידה של 1-8% בשנה")), 'ירידה של <bdi dir="ltr">1‑8%</bdi> בשנה');
  assert.equal(keepRange("1-2-3"), "1‑2‑3", "a chain: every hyphen");
});

test("a bar's label: a hyphen inside a Latin word is non-breaking; no lookbehind (Safari before 16.4 cannot compile one)", () => {
  assert.ok(html(barLabel("משתנים (K⁺-sparing)")).includes("K⁺\u2011sparing"));
  assert.ok(html(barLabel("a-b-c")).includes("a\u2011b\u2011c"), "a chain: every hyphen");
  const src = readFileSync(join(process.cwd(), "src", "study", "lib", "rich.tsx"), "utf8");
  assert.ok(!/\(\?<[=!]/.test(src), "rich.tsx has no lookbehind");
});

test("\"NKCC2 = שני\": the equals sign stays with the Hebrew", () => {
  assert.equal(html(isolateLatin("NKCC2 = שני כ׳")), '<bdi dir="ltr">NKCC2</bdi> = שני כ׳');
});

test("react-markdown's strings (a summary table's cells) go through the same rule", () => {
  assert.equal(html(richChildren(["1.5 h"])), '<bdi dir="ltr">1.5 h</bdi>');
  assert.equal(html(richChildren(["חצי חיים 3-4 h"])), 'חצי חיים <bdi dir="ltr">3‑4 h</bdi>');
});

test("a file's name as a title may break after \"_\" and \"-\", nowhere else", () => {
  assert.equal(html(softBreaks("Lecture_07_Renal-Physiology")), "Lecture_<wbr/>07_<wbr/>Renal-<wbr/>Physiology");
  assert.equal(html(softBreaks("הרצאה 3")), "הרצאה 3");
  assert.equal(html(softBreaks("סוף_")), "סוף_");
});
