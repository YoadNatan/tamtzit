import assert from "node:assert/strict";
import { test } from "node:test";
import { imageBoxes, pdfFigureGeo, type PdfItem } from "./pdfGeo";

/* A PDF page's diagram labels (docs/study/question-types.md): the image
 * boxes from the operator list (the CTM over save, restore, transform and
 * form XObjects), and the short text items inside the largest region. */

const OPS = { save: 10, restore: 11, transform: 12, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };

test("imageBoxes: the unit square under the CTM, restored after each save", () => {
  const ops = {
    fnArray: [OPS.save, OPS.transform, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintImageXObject, OPS.paintFormXObjectBegin, OPS.paintInlineImageXObject, OPS.paintFormXObjectEnd],
    argsArray: [null, [1, 0, 0, 1, 100, 200], [300, 0, 0, 150, 0, 0], ["img1"], null, ["img2"], [[2, 0, 0, 2, 10, 10], null], [{}], null],
  };
  assert.deepEqual(imageBoxes(ops, OPS), [
    [100, 200, 400, 350],
    [0, 0, 1, 1],
    [10, 10, 12, 12],
  ]);
});

/** A viewport of a 600×800 page (PDF y upwards) at scale 1. */
const vp = { width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] };
const item = (str: string, x: number, y: number, width = 60, height = 10): PdfItem => ({ str, transform: [height, 0, 0, height, x, y], width, height });

test("pdfFigureGeo: labels inside the image region (grown 5%), baked, the page as the picture", () => {
  const boxes: Array<[number, number, number, number]> = [
    [100, 200, 500, 600], // the diagram: 400×400 of 600×800 = 33%
    [0, 0, 20, 20], // a logo
  ];
  const items = [
    item("Renal physiology", 20, 760, 300, 20), // the title, outside the region
    item("Glomerulus", 150, 550),
    item("Loop of Henle", 300, 300),
    item("Collecting duct", 480, 250), // ends beyond the region but its middle is within 5%
    item("This is a long sentence of the page with many words in it", 120, 400, 300),
  ];
  const geo = pdfFigureGeo(items, boxes, vp);
  assert.ok(geo);
  assert.deepEqual(geo.labels.map((l) => l.t), ["Glomerulus", "Loop of Henle", "Collecting duct"]);
  assert.equal(geo.baked, true);
  assert.equal(geo.src, "pdf");
  assert.ok(geo.img.x < 0 && geo.img.y < 0 && geo.img.w > 1, "the whole page is larger than the stage");
});

test("pdfFigureGeo: no region of 10-90%, or fewer than 3 labels: null", () => {
  assert.equal(pdfFigureGeo([item("A", 10, 10)], [[0, 0, 600, 800]], vp), null, "a full-page image is a background");
  assert.equal(pdfFigureGeo([item("Glomerulus", 150, 550), item("Loop", 300, 300)], [[100, 200, 500, 600]], vp), null);
});
