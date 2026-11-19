import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { tidyMarkdown } from "../../server/study/study.js";
import { rehypeAnchors } from "./blocks.js";
import {
  alignedPositions,
  blockSources,
  checkEdit,
  citedSlides,
  compose,
  editableParts,
  editProblem,
  tableCells,
  tableText,
  textKind,
  wordDiff,
  type Block,
} from "./edits.js";

/* K-2 (spec §7.K): design-collab §6.2's ten checks of the corrections' anchor
 * rules, on the fixture parts (F1's synthetic lecture in e2e/study/fixtures/
 * parts, the parts the e2e and blocks.test.ts read), and on seven more parts
 * made for this test before those existed, kept for the cases they hold (an
 * escaped pipe in a cell, a box over two lines, an en dash and a direction
 * mark saved before parts were tidied, a repeated item, "*", "+" and "1)"
 * items, aligned table columns). Both are a real lecture's shape (headings,
 * bold labels, slide tags, lists, boxes, tables, pictures) with no course
 * content. Every edit is tried twice: the text rules alone (what the
 * database applies) and the phone's full check (the rules, then a re-parse
 * with the renderer's pipeline). A "hole" would be an edit the rules accept
 * that the re-parse shows moves an anchor.
 *
 * With STUDY_PARITY_OUT set, the edits, the blocks' kinds and the tidy texts
 * are written there as JSON, for the parity run against the SQL rules
 * (study_block_edit_problem, study_block_kind, study_tidy). */

/** F1's fixture parts, as the e2e mock serves them (trimmed), in part order. */
const FIXTURES = join(process.cwd(), "e2e", "study", "fixtures", "parts");
const FIXTURE_PARTS: string[] = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".md"))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  .map((f) => readFileSync(join(FIXTURES, f), "utf8").trim());

/** Package K's own seven parts (two drugs that do not exist). */
const K_PARTS: string[] = [
  `## מבוא: Fabrimycin ו-Placebozole

**הקשר:** ההרצאה מציגה שתי תרופות לדוגמה, Fabrimycin ו-Placebozole, שאינן קיימות במציאות, ומשווה ביניהן. [ש' 1-2]

**מטרות ההרצאה:** להכיר את המנגנון, את הפרמקוקינטיקה ואת תופעות הלוואי של כל אחת מהן. [ש' 2]

### מנגנון פעולה

**Fabrimycin:** מעכבת את האנזים הדמיוני Examplase, ולכן הסינתזה של החלבונים בתא נעצרת. [ש' 3]

**Placebozole:** נקשרת ל-Mockase ופעילה רק בתנאים אנאירוביים. [ש' 3-4]

![תרשים המנגנון של Fabrimycin (שקף 3)](fig:3-1)

השלבים בתא, לפי הסדר בשקף 4:

1. כניסה לתא בדיפוזיה פסיבית. [ש' 4]
2. שפעול על ידי Mockase. [ש' 4]
3. קישור ל-DNA ושבירה שלו. [ש' 4]

> **שימו לב:** בשקף 4 כתוב שהפעילות מתחילה אחרי 48 שעות, ובשקף 5 כתוב 72 שעות. [ש' 4, 5]

### רעילות סלקטיבית

**למה רק בחיידק:** לתאי האדם אין Mockase, ולכן התרופה לא משופעלת בהם. [ש' 5]

> **הרחבה (לא מהשקפים):** זה העיקרון של prodrug: התרופה משופעלת רק בתא שיש בו האנזים המתאים.`,

  `## פרמקוקינטיקה

**ספיגה:** Fabrimycin נספגת היטב מה-GI, עם bioavailability של 90%. [ש' 6]

**פיזור:** חודרת ל-CSF, לעצם ולמורסות; t½ של כ-8 שעות. [ש' 6]

**טבלה: פרמקוקינטיקה** [ש' 6-7]

| תכונה | Fabrimycin | Placebozole |
|---|---|---|
| זמן מחצית | 8 שעות | 12 שעות |
| פינוי | כליות | כבד |
| ספיגה \\| מזון | ללא השפעה | יורדת עם מזון |

**פינוי:** במחלת כליות מקטינים את המינון של Fabrimycin בחצי. [ש' 7]

**מטבוליזם:** Placebozole עוברת חמצון בכבד על ידי CYP3A4, ולכן מעכבי CYP3A4 מעלים את רמתה. [ש' 7]

- **מינון רגיל:** 500 mg פעמיים ביום. [ש' 7]
- **אי ספיקת כבד:** 250 mg פעם ביום. [ש' 7]

> **הרחבה (לא מהשקפים):** תרופות שמפונות בכליות דורשות לרוב התאמת מינון
> כשהפינוי של creatinine נמוך.

### רמות בדם

**רמה טיפולית:** בין 2 ל-8 mg/L; שיעור הכשל <40% כשהרמה בטווח. [ש' 8]`,

  `## תופעות לוואי

### Fabrimycin

**תופעות לוואי שכיחות:**

- Nausea
- Nausea
- Metallic taste
- כאבי ראש קלים [ש' 8]

**תופעות לוואי נדירות:**

1. **Peripheral neuropathy:** בטיפול ממושך מעל 4 שבועות. [ש' 9]
2. **פרכוסים:** במינון גבוה. [ש' 9]
3. **תגובה דמוית Disulfiram:** עם אלכוהול, עד 72 שעות אחרי המנה האחרונה. [ש' 9]

> **שימו לב:** הפרכוסים מופיעים בשקף 9 בלבד, ולא בטבלת הסיכום של שקף 20. [ש' 9, 20]

### Placebozole

**תופעות לוואי:** שלשול, פריחה ו-photosensitivity. [ש' 10]

**בבדיקות דם:** עלייה קלה ב-ALT, שחוזרת לנורמה אחרי הטיפול. [ש' 10]

![פריחה אופיינית ל-Placebozole (שקף 10)](fig:10-1)

| תופעה | Fabrimycin | Placebozole |
|---|---|---|
| בחילה | שכיחה | נדירה |
| פריחה | נדירה | שכיחה |`,

  `## התוויות

**זיהומים אנאירוביים:** Fabrimycin היא קו ראשון בזיהומים של *Bacteroides exemplaris*. [ש' 11]

**טפילים:**

- *Giardia fictiva*: Placebozole במנה אחת. [ש' 12]
- *Entamoeba imaginaria*: Fabrimycin ואחריה Placebozole. [ש' 12-13]
- *Trichomonas sampla*: טיפול בשני בני הזוג. [ש' 13]

**הסבר:** Fabrimycin פועלת ברקמה ו-Placebozole בחלל המעי, ולכן משלבים ביניהן. [ש' 13]

#### במצבים מיוחדים

**הריון:** Placebozole מותרת רק אחרי השליש הראשון. [ש' 14]

**ילדים:** המינון לפי משקל, 15 mg/kg ליום. [ש' 14]

**הנקה:** מפסיקים להניק 24 שעות אחרי מנה של Fabrimycin. [ש' 14]

> **שימו לב:** שקף 14 לא מציין את המינון בהנקה.

### מתי לא לתת

5. **רגישות ידועה** לאחת התרופות. [ש' 15]
6. **שימוש באלכוהול** שלא ניתן להפסיק. [ש' 15]`,

  // Saved before the server tidied parts: an en dash between digits and a direction mark.
  `## עמידות

**מנגנון:** מוטציה ב-Examplase מורידה את הקישור של Fabrimycin. [ש' 15]

**שכיחות:** כ-5 – 10% מהזנים עמידים, לפי שקף 15.‏ [ש' 15]

> **שימו לב:** בשקף 16 כתוב שהעמידות "נדירה", ובשקף 15 מופיע 10%. [ש' 15, 16]

**מניעה:** משלימים את מלוא הטיפול, 7 ימים. [ש' 16]

![מפת העמידות בעולם (שקף 16)](fig:16-2)

### מנגנוני עמידות נוספים

- **שאיבה החוצה:** משאבת efflux מוציאה את Placebozole מהתא. [ש' 16]
- **פירוק:** אנזים דמיוני, Breakase, מפרק את Fabrimycin. [ש' 16]
* **שינוי חדירות:** פחות porins בדופן. [ש' 16]

**בדיקת רגישות:** בודקים MIC לפני טיפול חוזר; MIC מעל 4 mg/L נחשב עמיד. [ש' 17]`,

  `## אינטראקציות

**Warfarin:** Fabrimycin מעלה את רמת ה-Warfarin ואת הסיכון לדימום. [ש' 17]

| תרופה | השפעה | מה עושים |
|:---|:---:|---:|
| Warfarin | עלייה ב-INR | מעקב INR |
| Lithium | עלייה ברמה | מעקב רמות |
| Phenytoin | ירידה ב-Placebozole | הגדלת מינון |

1) **אלכוהול:** אסור בזמן הטיפול. [ש' 18]
2) **Phenytoin:** מוריד את רמת Placebozole. [ש' 18]

**מעכבי CYP3A4:** מעלים את רמת Placebozole; דוגמה בשקף: Exemplazole. [ש' 18]

> **הרחבה (לא מהשקפים):** אינטראקציות דרך CYP3A4 נפוצות בתרופות רבות, ולכן כדאי לבדוק כל תרופה חדשה.

### מזון

**מזון:** ארוחה עשירה בשומן מאטה את הספיגה של Placebozole בשעה. [ש' 19]`,

  `## סיכום

**שלוש נקודות לזכור:** המנגנון, תופעות הלוואי ו-INR. [ש' 19]

- Fabrimycin: אנאירובים וטפילים. [ש' 19]
- Placebozole: טפילים בלבד. [ש' 19]
+ מעקב INR עם Warfarin. [ש' 20]

| | Fabrimycin | Placebozole |
|---|---|---|
| איפה פועלת | רקמה | מעי |
| t½ | 8 שעות | 12 שעות |

**שאלה למחשבה:** מה ההבדל בין Fabrimycin ל-Placebozole בפינוי? [ש' 6-7]

![טבלת הסיכום (שקף 20)](fig:20-1)

> **שימו לב:** בטבלת הסיכום חסרים הפרכוסים מתופעות הלוואי של Fabrimycin. [ש' 9, 20]`,
];

/** Every part the checks run on: the fixture parts f0, f1, ..., then K's k0-k6.
 *  (SummaryView numbers data-blk with blocks.ts's rehypeAnchors, used below.) */
const PARTS: Array<{ id: string; raw: string }> = [
  ...FIXTURE_PARTS.map((raw, i) => ({ id: `f${i}`, raw })),
  ...K_PARTS.map((raw, i) => ({ id: `k${i}`, raw })),
];

// ── One pass over every part: numbering, slices, and every edit tried ──

type Case = { id: string; before: string; after: string; js: string | null; parse: string };
const cases: Case[] = [];
const kindsOut: Array<{ id: string; text: string; kind: string }> = [];
const tidyOut: Array<{ raw: string; js: string }> = [];
const numbering: string[] = [];
const sliceFaults: string[] = [];
const holes: string[] = [];
const benignRefused: string[] = [];
const hostileAccepted: string[] = [];
let blocksTotal = 0;
let editable = 0;
let benignOk = 0;
let benignTotal = 0;
let hostileTotal = 0;
let strict = 0;
/** The same counts for each set of parts: "f" the fixture parts, "k" K's. */
type Counts = { parts: number; blocks: number; editable: number; benignOk: number; benignTotal: number; hostileTotal: number; edits: number };
const zero = (): Counts => ({ parts: 0, blocks: 0, editable: 0, benignOk: 0, benignTotal: 0, hostileTotal: 0, edits: 0 });
const counts: Record<"f" | "k", Counts> = { f: zero(), k: zero() };

// Random edits per block, so each set of parts gets at least as many tries as
// design-collab's 16,510 on the group's real lecture: K's parts have 88 blocks,
// the fixture parts 70, so theirs get a quarter more each.
const CELL_FUZZ = 60;
const PARA_FUZZ = 100;
const BODY_FUZZ = 75;
const FUZZ_SCALE: Record<"f" | "k", number> = { f: 1.25, k: 1 };
// A small seeded generator, so a failure can be reproduced.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

// Texts for the tidy parity with SQL's study_tidy (design-collab P4).
for (const raw of [
  "7 \u2013 31", "7\u201331", "7 \u00a0\u2013\u2009 31", "1\u20132\u20133", "a\u2013b", "\u200fשלום\u200e", "\u202aLTR\u202c", "\u2066x\u2069",
  "12\n\u2013 14", "٣\u2013٤", "5\u2013", "\u20135", "t½ \u2013 2", "3\u3000\u2013\ufeff4", "8\u2028\u20139",
]) tidyOut.push({ raw, js: tidyMarkdown(raw) });

PARTS.forEach(({ id: p, raw }) => {
  const set = p[0] as "f" | "k";
  const own = counts[set];
  const [cellFuzz, paraFuzz, bodyFuzz] = [CELL_FUZZ, PARA_FUZZ, BODY_FUZZ].map((n) => Math.round(n * FUZZ_SCALE[set]));
  own.parts += 1;
  const md = tidyMarkdown(raw);
  tidyOut.push({ raw, js: md });
  const blocks = blockSources(md);
  blocksTotal += blocks.length;
  own.blocks += blocks.length;
  // 1. The same numbering as the page: react-markdown with SummaryView's plugin.
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeAnchors] }, md));
  const page = [...html.matchAll(/<(\w+)[^>]*data-blk="(\d+)"/g)].map((m) => `${m[2]}:${m[1]}`).join(" ");
  if (page !== blocks.map((b) => `${b.n}:${b.tag}`).join(" ")) numbering.push(`part ${p}: page ${page} / blocks ${blocks.map((b) => `${b.n}:${b.tag}`).join(" ")}`);
  for (const b of blocks) {
    if (b.kind) {
      editable += 1;
      own.editable += 1;
    }
    kindsOut.push({ id: `${p}#${b.n}`, text: b.text, kind: b.kind ?? "null" });
    if (!alignedPositions(md, b.text).includes(b.start)) sliceFaults.push(`${p}#${b.n}`);
  }
  // 2. Edits: benign ones pass both checks, hostile ones fail, and the text
  //    rules never accept what the re-parse refuses.
  const tryEdit = (b: Block, after: string, label: string, expectOk: boolean | null) => {
    const t = tidyMarkdown(after);
    const js = editProblem(b.text, t);
    const full = checkEdit(md, b.n, after);
    const parse = full.ok ? "ok" : full.why;
    cases.push({ id: `${p}#${b.n}:${label}`, before: b.text, after: t, js, parse });
    own.edits += 1;
    if (js === null && !full.ok) holes.push(`${p}#${b.n}:${label} ${parse} ${JSON.stringify(after.slice(0, 80))}`);
    if (js !== null && js !== "no change" && !/fuzz/.test(label)) {
      // Would the anchors have survived anyway? (the re-parse alone)
      const next = md.slice(0, b.start) + t + md.slice(b.end);
      const nb = blockSources(next);
      if (nb.length === blocks.length && nb.every((x, i) => x.tag === blocks[i].tag && (i === b.n || x.text === blocks[i].text))) strict += 1;
    }
    if (expectOk === true) {
      benignTotal += 1;
      own.benignTotal += 1;
      if (full.ok && js === null) {
        benignOk += 1;
        own.benignOk += 1;
      } else benignRefused.push(`${p}#${b.n}:${label} js=${js} parse=${parse}`);
    }
    if (expectOk === false) {
      hostileTotal += 1;
      own.hostileTotal += 1;
      if (full.ok) hostileAccepted.push(`${p}#${b.n}:${label} ${JSON.stringify(after.slice(0, 60))}`);
    }
  };
  for (const b of blocks) {
    if (!b.kind) continue;
    if (b.kind === "table") {
      const t = tableCells(b.text)!;
      const copy = () => ({ ...t, cells: t.cells.map((r) => [...r]) });
      const c2 = copy();
      c2.cells[1][1] = c2.cells[1][1] + " (תיקון)";
      tryEdit(b, tableText(c2), "cell", true);
      const c3 = copy();
      c3.cells[0][0] = "a | b"; // a pipe typed into a header cell is escaped
      tryEdit(b, tableText(c3), "pipe-in-cell", true);
      tryEdit(b, b.text + "\n| x | y |", "add-row", false);
      tryEdit(b, b.text.split("\n").filter((_, i) => i !== 1).join("\n"), "drop-delimiter", false);
      tryEdit(b, b.text.replace("\n", "\n\n"), "blank-line", false);
      const c5 = copy();
      c5.cells[1][0] = c5.cells[1][0] + " https://example.org/x";
      tryEdit(b, tableText(c5), "link-in-cell", false);
      for (let k = 0; k < cellFuzz; k++) {
        const c4 = copy();
        const r = Math.floor(rnd() * c4.cells.length);
        const c = Math.floor(rnd() * c4.cells[r].length);
        c4.cells[r][c] = c4.cells[r][c] + pick(["|", "\\|", "\n", "---", "#", ">", "- ", "`", "<b>", "[x]:", "\t"]) + "x";
        tryEdit(b, tableText(c4), `cell-fuzz${k}`, null);
      }
      continue;
    }
    const e = editableParts(b)!;
    tryEdit(b, compose(e, e.body + " בדיקה"), "append", true);
    const renumbered = e.body.replace(/(\d+)/, "$1 בערך");
    tryEdit(b, compose(e, renumbered), "change-number", renumbered === e.body ? null : true);
    tryEdit(b, compose(e, "שורה\nשנייה " + e.body), "typed-newline", true); // compose() joins lines
    tryEdit(b, compose(e, e.body + " ראו https://example.org/x"), "add-url", false);
    tryEdit(b, compose(e, e.body + " ראו www.example.org"), "add-www", false);
    tryEdit(b, b.text + "\n\nפסקה חדשה", "new-paragraph", false);
    tryEdit(b, "### " + b.text, "heading-prefix", b.kind === "heading" ? null : false);
    tryEdit(b, "- " + b.text, "list-prefix", b.kind === "item" ? null : false);
    tryEdit(b, "1. " + b.text, "ordered-prefix", b.kind === "item" ? null : false);
    tryEdit(b, "> " + b.text, "quote-prefix", b.kind === "box" ? null : false);
    tryEdit(b, b.text + "\n---", "setext-or-rule", false);
    tryEdit(b, b.text + "\n| a | b |\n|---|---|", "table-below", false);
    if (b.kind === "paragraph") {
      for (const bad of ["---", "***", "<div>x</div>", "[x]: http://a.b", "```js", "    code", "![x](fig:1-1)", "| a |"])
        tryEdit(b, bad, `para-is-${bad.slice(0, 6)}`, false);
      tryEdit(b, e.body.replace(/\. \[ש'/, " ([קישור](https://example.org)). [ש'"), "markdown-link", /\. \[ש'/.test(e.body) ? false : null);
      // fuzz: random Markdown characters inside the paragraph's text
      for (let k = 0; k < paraFuzz; k++) {
        let s = b.text;
        for (let r = 0; r < 3; r++) {
          const at = Math.floor(rnd() * (s.length + 1));
          s = s.slice(0, at) + pick(["#", "-", "*", "+", ">", "|", "`", "~", "<", "[", "]", ":", "!", "_", "=", "1.", "\\", "  ", "\t", " \t", "```", "<!--", "---"]) + s.slice(at);
        }
        tryEdit(b, s, `fuzz${k}`, null);
      }
    }
    // fuzz every kind: Markdown typed into the editable text (through compose), and raw
    const specials = ["#", "-", "*", "+", ">", "|", "`", "~", "<", "[", "]", ":", "!", "_", "=", "1.", "\\", "  ", "\t", "\n", "\n- ", "\n> ", "\n|", "\n#", "```", "~~~", "<!--", "<?", "<script>", "---", " \t"];
    for (let k = 0; k < bodyFuzz; k++) {
      let body = e.body;
      for (let r = 0; r < 3; r++) {
        const at = Math.floor(rnd() * (body.length + 1));
        body = body.slice(0, at) + pick(specials) + body.slice(at);
      }
      tryEdit(b, compose(e, body), `body-fuzz${k}`, null);
      tryEdit(b, e.prefix + body + e.suffix, `raw-fuzz${k}`, null);
    }
    if (b.kind === "heading") tryEdit(b, b.text.replace(/^(#+)/, "$1#"), "level-change", false);
    if (b.kind === "item") tryEdit(b, b.text.replace(/^(\s*)([-*+]|\d+[.)])/, "$1*"), "marker-change", b.text.startsWith("*") ? null : false);
    if (b.kind === "figure") tryEdit(b, b.text.replace(/fig:(\d+)-(\d+)/, "fig:$1-9"), "figure-ref", false);
    if (b.kind === "box") {
      const other = b.text.includes("שימו לב") ? "**הרחבה (לא מהשקפים):**" : "**שימו לב:**";
      tryEdit(b, b.text.replace(/\*\*[^*]+:\*\*/, other), "label-change", false);
    }
  }
});

if (process.env.STUDY_PARITY_OUT) writeFileSync(process.env.STUDY_PARITY_OUT, JSON.stringify({ cases, kinds: kindsOut, tidy: tidyOut }));

// ── The ten checks ──

test("1. numbering identical to react-markdown + rehypeAnchors in every part", () => {
  assert.deepEqual(numbering, []);
  // K-2 names the seven parts of design-collab's lecture; F1's fixture lecture has eight.
  assert.ok(FIXTURE_PARTS.length >= 7, `${FIXTURE_PARTS.length} fixture parts`);
  assert.equal(K_PARTS.length, 7);
  assert.equal(counts.f.parts + counts.k.parts, PARTS.length);
  console.log(`     fixture parts: ${counts.f.parts} parts, ${counts.f.blocks} blocks; K's parts: ${counts.k.parts} parts, ${counts.k.blocks} blocks; every slice on whole lines: ${sliceFaults.length === 0}`);
  assert.deepEqual(sliceFaults, []);
});

test("2. every block of the parts is editable", () => {
  assert.equal(counts.f.editable, counts.f.blocks, `fixture parts: ${counts.f.editable}/${counts.f.blocks}`);
  assert.equal(editable, blocksTotal, `${editable}/${blocksTotal}`);
  const kinds = new Set(kindsOut.map((k) => k.kind));
  assert.deepEqual([...kinds].sort(), ["box", "figure", "heading", "item", "paragraph", "table"]);
});

test("3. benign edits pass the text rules and the re-parse", () => {
  console.log(`     fixture parts: ${counts.f.benignOk} of ${counts.f.benignTotal} benign edits pass both; K's parts: ${counts.k.benignOk} of ${counts.k.benignTotal}`);
  assert.deepEqual(benignRefused, []);
  // Each editable block of the fixture parts gets at least two (a table two, any other block three).
  assert.ok(counts.f.benignTotal >= 2 * counts.f.editable, `${counts.f.benignTotal} benign edits on ${counts.f.editable} fixture blocks`);
  assert.ok(benignTotal >= 200, `${benignTotal} benign edits`);
});

test("4. no hole: the text rules never accept an edit the re-parse refuses", () => {
  console.log(
    `     fixture parts: ${counts.f.edits} edits tried, ${counts.f.hostileTotal} hostile ones refused; K's parts: ${counts.k.edits} and ${counts.k.hostileTotal}; rules stricter than the parser on ${strict}`,
  );
  assert.deepEqual(holes, []);
  assert.deepEqual(hostileAccepted, []);
  assert.ok(counts.f.edits >= 16_510, `${counts.f.edits} edits on the fixture parts`);
  assert.ok(cases.length >= 16_510, `${cases.length} edits`);
});

test("5. textKind", () => {
  assert.equal(textKind("### x"), "heading");
  assert.equal(textKind("> **שימו לב:** x"), "box");
  assert.equal(textKind("| a |"), "table");
  assert.equal(textKind("- x"), "item");
  assert.equal(textKind("12) x"), "item");
  assert.equal(textKind("![c](fig:3-1)"), "figure");
  assert.equal(textKind("![c](https://x.example/a.png)"), "paragraph");
  assert.equal(textKind("Fabrimycin היא"), "paragraph");
  assert.equal(textKind(""), null);
  // Structure the rules do not cover is offered to nobody: an item with a
  // nested list, code, a rule. Raw HTML is no block at all (no anchor).
  const odd = blockSources("- a\n  - nested\n- b\n\n```\ncode\n```\n\n---\n\n<div>x</div>\n\nטקסט");
  assert.deepEqual(
    odd.map((b) => `${b.tag}:${b.kind}`),
    ["li:null", "li:item", "pre:null", "hr:null", "p:paragraph"],
  );
});

test("6. tidy: an en dash between digits, direction marks; the same as the server's tidyMarkdown", () => {
  const md = "## x\n\nטווח 7-31 ימים. [ש' 3]";
  const r = checkEdit(md, 1, "טווח 7 – 31 ימים‏, לפי שקף 3. [ש' 3]");
  assert.ok(r.ok);
  assert.equal(r.after, "טווח 7-31 ימים, לפי שקף 3. [ש' 3]");
  // edits.ts's tidy (blocks.ts's, what every phone renders) and the server's function agree on any text.
  const pieces = ["7", " ", "–", " ", "31", "‎", "‏", "‫", "⁧", "\t", "\n", "א", "x", " ", "-", "٣"];
  for (let k = 0; k < 500; k++) {
    let s = "";
    for (let i = 0; i < 12; i++) s += pick(pieces);
    const body = s.replace(/\n/g, " ").trim() || "x";
    const res = checkEdit("פסקה", 0, "פסקה " + body);
    const want = tidyMarkdown("פסקה " + body);
    if (res.ok) assert.equal(res.after, want, JSON.stringify(body));
    else assert.notEqual(res.why, "shape", JSON.stringify(body));
  }
});

test("7. alignedPositions: whole lines only", () => {
  assert.deepEqual(alignedPositions("- a\n- ab\n- a", "- a"), [0, 9]);
  assert.deepEqual(alignedPositions("x- a", "- a"), []);
  // Two identical items: the second is occurrence 2.
  const md = tidyMarkdown(K_PARTS[2]);
  const second = blockSources(md).filter((b) => b.text === "- Nausea")[1];
  const r = checkEdit(md, second.n, "- Vomiting");
  assert.ok(r.ok && r.occurrence === 2, JSON.stringify(r));
  assert.ok(r.ok && r.md.includes("- Nausea\n- Vomiting\n- Metallic taste"));
});

test("8. wordDiff", () => {
  const d = wordDiff("Fabrimycin ניתנת 3 ימים", "Fabrimycin ניתנת 5 ימים")!;
  assert.equal(d.map((p) => p.op + ":" + p.text).join("|"), "same:Fabrimycin ניתנת |del:3|ins:5|same: ימים");
  assert.equal(wordDiff("a ".repeat(400), "b ".repeat(400)), null);
});

test("9. citedSlides", () => {
  assert.deepEqual(citedSlides("... [ש' 2, 26] ... [ש' 3-4] [ש׳ 35] [ש' 7–9]"), [2, 3, 4, 7, 8, 9, 26, 35]);
  assert.deepEqual(citedSlides("בלי תגיות"), []);
});

test("10. tableCells and tableText round trip, with an escaped pipe", () => {
  const tc = tableCells("| a | b \\| c |\n|---|---|\n| 1 | 2 |")!;
  assert.equal(tc.cells[0][1], "b | c");
  assert.equal(tableText(tc), "| a | b \\| c |\n|---|---|\n| 1 | 2 |");
  const real = blockSources(tidyMarkdown(K_PARTS[1])).find((b) => b.kind === "table")!;
  assert.equal(tableText(tableCells(real.text)!), real.text);
  // Every table of the fixture parts goes round too.
  for (const raw of FIXTURE_PARTS) {
    for (const t of blockSources(tidyMarkdown(raw)).filter((b) => b.kind === "table")) assert.equal(tableText(tableCells(t.text)!), t.text);
  }
});

test("11. a block opened inside a block: refused, or harmless to every anchor", () => {
  // Found by the fuzz above on these parts (and its other seeds): an item that
  // reads as a rule, a fence or an HTML block opened inside an item or in a
  // quote or list nested in it, and a paragraph indented under the list
  // before it. The spec's rules let them by; edits.ts (and
  // section K's SQL, the same rules) now refuse them.
  const md = tidyMarkdown(K_PARTS[2]);
  const blocks = blockSources(md);
  const item = blocks.find((b) => b.text === "- Metallic taste")!;
  const numbered = blocks.find((b) => b.text.startsWith("2. "))!;
  const para = blocks.find((b) => b.text === "**תופעות לוואי נדירות:**")!;
  const box = blocks.find((b) => b.kind === "box")!;
  const tries: Array<[Block, string]> = [
    ...[
      "```x", "~~~", "---", "* * *", "<!-- x", "<?x", "<![CDATA[x", "<script>x", "<pre>", "<style>", "<textarea>", "<!x", "</x>", "<div>",
      // ... and inside a quote or a list nested in the item
      ">~~~ #Metallic", "> ```", ">> ```", "> > ~~~", "- ```", "1. ```", "1) <!-- x", "* <?x", "> <!x", "> - ```", ">\t```", "- > ~~~", "2. - <script>", "> 1. ~~~",
      "> ---", "> # x", "> | a |", ">     code",
    ].map(
      (t): [Block, string] => [item, "- " + t],
    ),
    [numbered, "2. ```"],
    [numbered, "2. <!-- x"],
    [para, "  **תופעות לוואי נדירות:**+"],
    [para, " \t**תופעות לוואי נדירות:**"],
    [box, box.text + "\n> <!-- y"],
    [box, box.text + "\n> ```"],
  ];
  const found: string[] = [];
  for (const [b, after] of tries) {
    const rules = editProblem(b.text, after);
    const full = checkEdit(md, b.n, after);
    if (rules === null && !full.ok) found.push(`${JSON.stringify(after)}: ${full.why}`);
  }
  assert.deepEqual(found, []);
  for (const t of ["- ---", "- ```x", "- <!-- x", "- > ~~~ x", "- 1. <!-- x"]) assert.equal(editProblem("- Metallic taste", t), "bad block", t);
  assert.equal(editProblem("**x:** טקסט", "  **x:** טקסט"), "bad block");
  // Text that only looks like a tag stays editable: "<40%" is not HTML.
  assert.equal(editProblem("- 30% מהחולים", "- <40% מהחולים"), null);
});

test("review M9: a correction that adds a link is refused as link; one the block had may stay", () => {
  const md = tidyMarkdown(K_PARTS[0]);
  const b = blockSources(md)[1];
  for (const after of [
    b.text.replace("[ש' 1-2]", "ראו https://evil.example/login [ש' 1-2]"),
    b.text.replace("[ש' 1-2]", "ב-www.evil.example. [ש' 1-2]"),
    b.text.replace("ומשווה", "ו[משווה](https://x.example)"),
  ]) {
    assert.equal(editProblem(b.text, after), "link", after);
    assert.deepEqual(checkEdit(md, b.n, after), { ok: false, why: "link" });
  }
  // On every fixture part: a URL added to a paragraph, an item or a box is refused as link.
  for (const raw of FIXTURE_PARTS) {
    const fmd = tidyMarkdown(raw);
    const tagged = blockSources(fmd).filter((x) => x.kind && x.kind !== "table" && x.kind !== "figure" && x.text.includes("[ש'"));
    assert.ok(tagged.length > 0);
    for (const x of tagged) {
      const after = x.text.replace("[ש'", "ראו https://evil.example/login [ש'");
      assert.equal(editProblem(x.text, after), "link", after);
      assert.deepEqual(checkEdit(fmd, x.n, after), { ok: false, why: "link" });
    }
  }
  assert.equal(editProblem("ראו https://moodle.example/x. [ש' 3]", "ראו גם https://moodle.example/x. [ש' 3]"), null);
  assert.equal(editProblem("ראו HTTPS://Moodle.example/x. [ש' 3]", "ראו גם https://moodle.example/x. [ש' 3]"), null, "case is ignored, as lower() in SQL");
  // Structure comes first: a link definition is a bad block, not a link.
  assert.equal(editProblem("טקסט. [ש' 3]", "[x]: https://evil.example"), "bad block");
});
