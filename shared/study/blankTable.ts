import { BLANK } from "./extras.js";

/* ── P10 "טבלה ריקה": a slide's table from memory (package E; spec §12.6.E) ──
 *
 * $0: the key is the slide's own table (the deck's `tables`, read at upload).
 * The first row is the header and the first column the row's label; every
 * other column whose values are few and short (BLANK.CHIP_VALUES,
 * BLANK.CHIP_CHARS) is filled from memory, row by row, with chips of that
 * column's values; a column that is not is shown as on the slide. A wrong
 * cell becomes the member's private card (section C's study_my_card_add,
 * origin 'table'): cardOf writes it. Pure, so the screen, the meter and the
 * tests read one table. */

/** A slide as the deck stores it: its number, title and tables (rows of cells). */
export type SlideLike = { n: number; title?: string; tables?: unknown };

/** A table's shape, as study_slide_tables reports it for the meter. */
export type TableShape = { n_rows: number; n_cols: number; max_cell: number };

/** The shape rule: a header, 2-15 rows under it, 2-6 columns, no cell of prose. */
export function shapeOk(s: TableShape): boolean {
  const body = s.n_rows - 1;
  return body >= BLANK.MIN_BODY_ROWS && body <= BLANK.MAX_BODY_ROWS && s.n_cols >= BLANK.MIN_COLS && s.n_cols <= BLANK.MAX_COLS && s.max_cell <= BLANK.MAX_CELL;
}

/** An empty cell reads as the slide's dash. */
export const EMPTY = "—";

/** One cell as shown: spaces collapsed, an empty cell the dash. */
export function cellText(raw: unknown): string {
  const t = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return t && !/^[-–—]+$/.test(t) ? t : EMPTY;
}

/** Two cells are the same answer: case, spaces, dashes and the slash of a
 *  cell's lines aside. */
export function sameCell(a: string, b: string): boolean {
  const k = (s: string) =>
    cellText(s)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‐-―]/g, "-")
      .replace(/\s*\/\s*/g, " / ")
      .replace(/\s+/g, " ");
  return k(a) === k(b);
}

export type BlankTable = {
  slide: number;
  /** Which table of the slide (0: its first). */
  tbl: number;
  title: string;
  header: string[];
  /** The rows under the header, every row as wide as the widest, cells as shown. */
  rows: string[][];
  /** Per column: filled from memory (true) or shown (false). Column 0, the label, is shown. */
  fill: boolean[];
  /** Per column: its chips, the column's distinct values in the order they first appear. */
  chips: string[][];
};

function asTable(raw: unknown): string[][] | null {
  if (!Array.isArray(raw)) return null;
  const rows = raw.filter((r): r is unknown[] => Array.isArray(r)).map((r) => r.map(cellText));
  return rows.length ? rows : null;
}

/** The slide's table `tbl` as a blank table, or null when its shape or its
 *  columns leave nothing to fill. */
export function blankTableOf(slide: SlideLike, tbl = 0): BlankTable | null {
  const tables = Array.isArray(slide.tables) ? slide.tables : [];
  const t = asTable(tables[tbl]);
  if (!t) return null;
  const cols = Math.max(...t.map((r) => r.length));
  const maxCell = Math.max(...t.flat().map((c) => (c === EMPTY ? 0 : c.length)));
  if (!shapeOk({ n_rows: t.length, n_cols: cols, max_cell: maxCell })) return null;
  const pad = (r: string[]) => [...r, ...Array.from({ length: cols - r.length }, () => EMPTY)];
  const [head, ...body] = t.map(pad);
  const chips: string[][] = [];
  const fill: boolean[] = [];
  for (let c = 0; c < cols; c++) {
    const values: string[] = [];
    for (const r of body) if (!values.some((v) => sameCell(v, r[c]))) values.push(r[c]);
    chips.push(values);
    fill.push(c > 0 && values.length >= 2 && values.length <= BLANK.CHIP_VALUES && values.every((v) => v.length <= BLANK.CHIP_CHARS));
  }
  if (!fill.some(Boolean)) return null;
  return { slide: slide.n, tbl, title: (slide.title ?? "").trim(), header: head, rows: body, fill, chips };
}

/** The first table of a slide that can be filled, or null. */
export function firstBlankTable(slide: SlideLike): BlankTable | null {
  const n = Array.isArray(slide.tables) ? slide.tables.length : 0;
  for (let i = 0; i < n; i++) {
    const t = blankTableOf(slide, i);
    if (t) return t;
  }
  return null;
}

/** Every slide of the lecture with a table to fill, in slide order. */
export function lectureBlankTables(slides: readonly SlideLike[]): BlankTable[] {
  return slides.map(firstBlankTable).filter((t): t is BlankTable => t !== null);
}

/** The columns of a row to fill, in order. */
export const fillColumns = (t: BlankTable): number[] => t.fill.flatMap((f, c) => (f ? [c] : []));

/** The cells of row `r` that are wrong, by column; a cell left empty is wrong. */
export function wrongCells(t: BlankTable, r: number, answers: Readonly<Record<number, string | undefined>>): number[] {
  return fillColumns(t).filter((c) => answers[c] === undefined || !sameCell(answers[c] as string, t.rows[r][c]));
}

/** The table's name for the top bar: the slide's title, else "ש׳ n". */
export const tableName = (t: BlankTable): string => t.title || `ש׳ ${t.slide}`;

/** The private card a wrong cell becomes: the row and the column asked, the
 *  slide's value, its tag. 3-400 and 1-300 characters (section C's limits). */
export function cardOf(t: BlankTable, r: number, c: number, answered: string | undefined): { front: string; back: string } {
  const label = t.rows[r][0] === EMPTY ? `שורה ${r + 1}` : t.rows[r][0];
  const col = t.header[c] === EMPTY ? `עמודה ${c + 1}` : t.header[c];
  const front = `טבלה ריקה · ${tableName(t)}: ${label}, ${col}?`.slice(0, 400);
  const back = `${t.rows[r][c]}${answered && !sameCell(answered, t.rows[r][c]) ? `, לא ׳${answered}׳` : ""}. [ש׳ ${t.slide}]`.slice(0, 300);
  return { front, back };
}

/** What the slide says in each wrong cell of row `r`: its row, its column, its value. */
export function wrongParts(t: BlankTable, r: number, wrong: readonly number[]): Array<{ row: string; col: string; value: string }> {
  const label = t.rows[r][0] === EMPTY ? `שורה ${r + 1}` : t.rows[r][0];
  return wrong.map((c) => ({ row: label, col: t.header[c] === EMPTY ? `עמודה ${c + 1}` : t.header[c], value: t.rows[r][c] }));
}

/** The line under a wrong row, as text: what the slide says in each wrong cell. */
export function wrongLine(t: BlankTable, r: number, wrong: readonly number[]): string {
  const label = t.rows[r][0] === EMPTY ? `שורה ${r + 1}` : t.rows[r][0];
  const col = (c: number) => (t.header[c] === EMPTY ? `עמודה ${c + 1}` : t.header[c]);
  return `בשקף: ${wrong.map((c) => `${label} · ${col(c)}: ׳${t.rows[r][c]}׳`).join("; ")}. [ש׳ ${t.slide}]`;
}

/** A wrong row's cards: saving ("pending"), saved ("yes"), or not saved
 *  ("failed"). "נכנסה לכרטיסיות" only once the cards are in (review UI-1):
 *  the screen never says a card is saved before it is. */
export type SaveState = "yes" | "no" | "failed" | "pending";
export function savedLabel(saved: SaveState, cells: number): string {
  if (saved === "failed") return cells === 1 ? "לא נשמרה ככרטיסייה" : "לא נשמרו ככרטיסיות";
  if (saved === "pending") return cells === 1 ? "נשמרת ככרטיסייה…" : "נשמרות ככרטיסיות…";
  return cells === 1 ? "נכנסה לכרטיסיות" : "נכנסו לכרטיסיות";
}

/** The session key of a blank table (§12.2.1: s=b.<lecture>.<slide>). */
export const blankKey = (lectureId: string, slide: number): string => `b.${lectureId}.${slide}`;

/** A blank table's key, parsed: null when it is not one. */
export function parseBlankKey(s: string): { lecture: string; slide: number } | null {
  const m = /^b\.([0-9a-f-]{36})\.([1-9]\d{0,2})$/.exec(s);
  return m ? { lecture: m[1], slide: Number(m[2]) } : null;
}
