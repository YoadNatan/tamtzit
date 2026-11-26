/* ── Uploaded sheets, release A1: the pure helpers (docs/study/sheets.md) ──
 * What the screens decide without the server: a typed number, a printed
 * table, a part's letter, the review's words, a drawn box, the typed draft of
 * an open answer kept on the device. No client here, so the unit tests read
 * it (lib/sheetForms.ts re-exports it with the RPCs). */

export type SheetFormName = "one" | "tf" | "match" | "open" | "numeric";
export type SolutionOrigin = "exam" | "sheet" | "solved" | "member" | null;

/** An item's printed label ("3א", "2.1"); before O 2, its number. */
export const labelOf = (q: { label?: string | null; no: number }): string => q.label || String(q.no);

/** A typed number: "," or "." as the decimal point, "-" or "−" for minus, "1.2e-3", "1.2×10^-3"
 *  (also "x", "*", "·" and a superscript minus). Spaces and a trailing unit-less "=" are ignored. null: not a number. */
export function numericParse(raw: string): number | null {
  let s = String(raw ?? "")
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, "")
    .replace(/[−–‒﹣－]/g, "-")
    .replace(/⁻/g, "-")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (d) => String("⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(d)));
  if (!s) return null;
  // 1.2×10^-3, 1.2x10-3, 1,2·10^(−3)
  const sci = /^([+-]?\d+(?:[.,]\d+)?)(?:[×xX*·])10\^?\(?([+-]?\d+)\)?$/.exec(s);
  if (sci) s = `${sci[1]}e${sci[2]}`;
  s = s.replace(",", ".");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** A number as the verdict says it: at most 6 significant digits, no trailing zeros. */
export function numText(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n !== 0 && (Math.abs(n) >= 1e7 || Math.abs(n) < 1e-4)) return n.toExponential(3).replace(/\.?0+e/, "e");
  return String(Number(n.toPrecision(6)));
}
/** Within the item's tolerance (percent of the answer; 1 when not said; an answer of 0 only by 0), as the server checks. */
export function numericOk(value: number, key: number, tolPct: number | null | undefined): boolean {
  const t = (Math.abs(key) * (tolPct ?? 1)) / 100;
  return Math.abs(value - key) <= Math.max(t, 1e-12);
}

/** A copy's text as printed: lines, and Markdown pipe rows as a table (header first; a |---| row is skipped). */
export type TextBlock = { kind: "text"; lines: string[] } | { kind: "table"; rows: string[][] };
export function parseTable(text: string): TextBlock[] {
  const out: TextBlock[] = [];
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const last = out[out.length - 1];
    if (isRow(line)) {
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (last?.kind === "table") last.rows.push(cells);
      else out.push({ kind: "table", rows: [cells] });
    } else if (last?.kind === "text") last.lines.push(line);
    else out.push({ kind: "text", lines: [line] });
  }
  // Blank lines at the ends of a text block say nothing.
  for (const b of out) if (b.kind === "text") while (b.lines.length && !b.lines[b.lines.length - 1].trim()) b.lines.pop();
  return out.filter((b) => (b.kind === "text" ? b.lines.some((l) => l.trim()) : b.rows.length));
}

const PART_LETTERS = "אבגדהוזחטיכל";
/** A multi-part question's part: "סעיף א׳ מתוך 3" (its letter by its step, 1-12). */
export function partOf(q: { series?: string | null; step?: number | null }, all: ReadonlyArray<{ series?: string | null; step?: number | null }>): { letter: string; index: number; total: number } | null {
  if (!q.series || !q.step) return null;
  const total = all.filter((x) => x.series === q.series).length;
  if (total < 2) return null;
  return { letter: `${PART_LETTERS[q.step - 1] ?? q.step}׳`, index: q.step, total };
}
export const partLine = (p: { letter: string; total: number }) => `סעיף ${p.letter} מתוך ${p.total}`;

/** Where an answer or a solution came from, in the review's words (one term per concept, COPY.md). */
export function originLine(origin: SolutionOrigin, by?: string | null): string {
  if (origin === "solved") return "תשובה מוצעת · לא נבדקה";
  if (origin === "sheet") return "מקובץ התשובות";
  if (origin === "exam") return "מסומנת על הדף";
  if (origin === "member") return by ? `נבדקה ע״י ${by}` : "נבדקה ע״י הקבוצה";
  return "";
}
/** "6.9 שעות" (a number with its unit). */
export const numLine = (n: number | null | undefined, unit: string | null | undefined): string => (n === null || n === undefined ? "" : `${numText(n)}${unit ? ` ${unit}` : ""}`);

/** The form's name on an item's tag and in the edit sheet. */
export const FORM_NAME: Record<SheetFormName, string> = { one: "בחירה", tf: "נכון/לא נכון", match: "התאמה", open: "פתוחה", numeric: "מספרית" };
/** The most options a form takes on an upload (design D7: one-answer up to 10, the set forms up to 6). */
export const maxOptions = (form: SheetFormName): number => (form === "one" ? 10 : form === "tf" || form === "match" ? 6 : 0);

/** An item that is keyed: a choice key, a number, or a model answer (study_private.exam_unkeyed's rule). */
export const keyedItem = (q: { form: SheetFormName; answer: number | null; seq: number[] | null; num?: number | null; model_answer?: string | null }): boolean =>
  q.form === "numeric" ? q.num !== null && q.num !== undefined : q.form === "open" ? Boolean(q.model_answer) : q.answer !== null || Boolean(q.seq?.length);

/* ── An open answer's draft: on the device only (OD8), every access in try/catch ── */

const draftKey = (user: string, questionId: string) => `study-open-draft:${user}:${questionId}`;
export function loadDraft(user: string, questionId: string): string {
  try {
    return localStorage.getItem(draftKey(user, questionId)) ?? "";
  } catch {
    return "";
  }
}
export function saveDraft(user: string, questionId: string, text: string): void {
  try {
    if (text) localStorage.setItem(draftKey(user, questionId), text.slice(0, 8000));
    else localStorage.removeItem(draftKey(user, questionId));
  } catch {
    /* private mode: the draft lives as long as the screen */
  }
}
export const dropDraft = (user: string, questionId: string) => saveDraft(user, questionId, "");

/** A figure box drawn on a page, in thousandths of its width and height: "pg:<page>:x,y,w,h" (at least 10 a side). */
export function boxFigure(page: number, a: { x: number; y: number }, b: { x: number; y: number }): string | null {
  const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  const x = clamp(Math.min(a.x, b.x));
  const y = clamp(Math.min(a.y, b.y));
  const w = clamp(Math.max(a.x, b.x)) - x;
  const h = clamp(Math.max(a.y, b.y)) - y;
  if (w < 10 || h < 10 || page < 1) return null;
  return `pg:${page}:${x},${y},${w},${h}`;
}
/** The whole page as a figure ("כל העמוד כאיור"). */
export const wholePage = (page: number) => `pg:${page}:0,0,1000,1000`;
export const MAX_FIGURES = 4;
