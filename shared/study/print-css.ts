/* ── The print layout of a summary (spec §4.5, design-platform §3.7) ──
 * One stylesheet for both ways out of the app: the server's PDF (W3, which
 * injects it into the page it renders) and printing on the device ("הדפסה
 * מהמכשיר", injected as <style id="study-print-css"> while the share sheet
 * prints). A4 with page numbers in the footer ("עמוד N מתוך M"), a title
 * page, a table of contents, each part on a new page, boxes in their colours
 * and pictures never split. Light colours only: the app's dark tokens apply
 * to the screen alone (study.css: @media screen and (prefers-color-scheme:
 * dark)). Device printing adds .pd-local: WebKit has no @page margin boxes,
 * so the table of contents prints without numbers it cannot trust.
 * Fonts: the server's PDF has IBM Plex Sans Hebrew and Frank Ruhl Libre;
 * the app loads neither (no font CDN at runtime), so device printing falls
 * to "Rubik Variable", the face the app itself self-hosts and has loaded. */

export const PRINT_CSS = `@page { size: A4; margin: 16mm 15mm 18mm;
  @bottom-center { content: "עמוד " counter(page) " מתוך " counter(pages); direction: rtl;
                   font-family: "IBM Plex Sans Hebrew", "Rubik Variable", sans-serif; font-size: 9pt; color: #5d6573; } }   /* tested */
@page :first { @bottom-center { content: none; } @top-center { content: none; } }            /* bottom: tested */
.print-doc { display: none; }
@media print {
  body > :not(.print-doc) { display: none !important; }
  .print-doc { display: block; color: #1d2128; background: #fff; font-family: "IBM Plex Sans Hebrew", "Rubik Variable", "Tamtzit Symbols", sans-serif; }
  .pd-title { break-after: page; min-height: 240mm; display: grid; align-content: center; gap: 6mm; text-align: center; }
  .pd-title h1 { font: 700 28pt "Frank Ruhl Libre", "Rubik Variable", serif; margin: 0; }
  .pd-eyebrow, .pd-meta, .pd-foot { color: #5d6573; font-size: 11pt; margin: 0; }
  .pd-toc { break-after: page; }
  .pd-toc ol { list-style: none; margin: 0; padding: 0; }
  .pd-toc li { display: flex; align-items: baseline; gap: 3mm; padding: 1.2mm 0; }
  .pd-toc li.l3 { padding-inline-start: 8mm; font-size: 10pt; color: #5d6573; }
  .pd-toc a { color: inherit; text-decoration: none; }
  .pd-dots { flex: 1; border-bottom: 1px dotted #8b93a1; }
  .pd-pg { min-width: 8mm; text-align: left; font-variant-numeric: tabular-nums; }
  .pd-local .pd-pg, .pd-local .pd-dots { display: none; }        /* device printing: no numbers we can trust */
  .print-doc .part { break-before: page; }
  .summary { font-size: 11pt; line-height: 1.6; }
  .summary p, .summary li { max-width: none; orphans: 2; widows: 2; }
  .summary h2, .summary h3 { break-after: avoid; }
  .a-callout, .slide-figure, .summary tr { break-inside: avoid; }                                             /* tested */
  .table-wrap { overflow: visible; border: 1px solid #e2ded4; }
  .summary thead { display: table-header-group; }
  .slide-figure img { max-height: 95mm; }
  .a-callout, .summary th, .src-tag { -webkit-print-color-adjust: exact; print-color-adjust: exact; }       /* tested */
  .a-callout { background: #eaf1fb; border-color: #9db8e0; } .a-callout.warn { background: #fdf3dc; border-color: #e0b252; }
  .a-callout.rec { background: #fbe9ec; border-color: #d98a99; } .a-callout.quiet { background: #fff; border-color: #e2ded4; }
  .note-dot, .note-add, .rec-time-btn { display: none !important; }
}`;
