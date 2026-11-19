/* ── The paragraph anchor: the data and its words (package N; §12.4.N) ──
 *
 * Section N answers two questions about a lecture's paragraphs, for the
 * caller only: what sits on each paragraph (study_paragraph_chips: the
 * group's questions, cards, comments and wall entries, and her own "טעית
 * כאן" and "לא ברור") and one paragraph's "תרגול" tab
 * (study_paragraph_practice: its questions and cards, each with her own
 * state). A question sits on its own anchor, else on the first point to
 * know it covers, else on the first point sharing a slide; a card on its own
 * anchor once section C's end gives it one, else by the points. The words
 * here are the approved mockup's (proposal/mockups/anchor.html) and the
 * meeting design's §5, §8.3. This file is the chip row's, in the entry
 * chunk; the tab's data and words are lib/anchorTab.ts, which loads with the
 * tab. Pure apart from the call, which reaches the client through import()
 * so the unit tests load this file without it. */

export type ParagraphChips = {
  part_idx: number;
  anchor: number;
  questions: number;
  cards: number;
  /** Top-level comments, questions and answers (the reader counts its own, live). */
  comments: number;
  /** The wall's entries (section J), 0 without it. */
  aids: number;
  /** Her wrong answers on its questions that are still wrong now. */
  my_wrong: number;
  /** Her "לא ברור" of the last 14 days (section M), false without it. */
  my_unclear: boolean;
};

async function client() {
  const { sb } = await import("./api");
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}

/** Every paragraph of a lecture with anything on it, for the caller. */
export async function paragraphChips(lectureId: string): Promise<ParagraphChips[]> {
  const { data, error } = await (await client()).rpc("study_paragraph_chips", { p_lecture: lectureId });
  if (error) fail(error);
  return (data ?? []) as ParagraphChips[];
}

/* ── keys ── */

export const spotKey = (part: number, anchor: number) => `${part}.${anchor}`;

/* ── words ── */

/** "שאלה" · "2 שאלות" (singular forms for one, as the meeting design says). */
export function countWord(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

export type Chip = { key: "questions" | "cards" | "comments"; label: string; open?: boolean };

/** The group's chips under a paragraph, in the mockup's order (the wall's
 *  chip, between cards and comments, comes from J's slot). */
export function groupChips(c: Pick<ParagraphChips, "questions" | "cards">, notes?: { total: number; open: number }): Chip[] {
  const out: Chip[] = [];
  if (c.questions > 0) out.push({ key: "questions", label: countWord(c.questions, "שאלה", "שאלות") });
  if (c.cards > 0) out.push({ key: "cards", label: countWord(c.cards, "כרטיס", "כרטיסים") });
  if (notes && notes.total > 0) out.push({ key: "comments", label: countWord(notes.total, "תגובה", "תגובות"), open: notes.open > 0 });
  return out;
}

/** The private line under the chips, or "" (decision 12: before Today, no
 *  promise that the question comes back). */
export function privateLine(c: Pick<ParagraphChips, "my_wrong" | "my_unclear">, today: boolean): string {
  if (c.my_wrong > 0) {
    const head = c.my_wrong === 1 ? "טעית כאן." : c.my_wrong === 2 ? "טעית כאן פעמיים." : `טעית כאן ${c.my_wrong} פעמים.`;
    return today ? `${head} השאלה חוזרת מחר.` : head;
  }
  return c.my_unclear ? "סימנת כאן ׳לא ברור׳" : "";
}

/** The first words of a paragraph in the reader, without its slide tags
 *  (SummaryView's quoteOf, read from the page). */
export function quoteAt(part: number, anchor: number): string {
  const el = document.querySelector<HTMLElement>(`.lecture-body [data-part="${part}"] [data-blk="${anchor}"]`);
  if (!el) return "";
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".a-tag, button, .blk-actions").forEach((n) => n.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** The slide tags of a paragraph in the reader ("ש׳ 19-20,37-38"), or "". */
export function slidesAt(part: number, anchor: number): string {
  const el = document.querySelector<HTMLElement>(`.lecture-body [data-part="${part}"] [data-blk="${anchor}"]`);
  const tags = el ? [...el.querySelectorAll<HTMLElement>("[data-slides]")].map((t) => t.dataset.slides ?? "").filter(Boolean) : [];
  return tags.length ? `ש׳ ${tags.join(",")}` : "";
}
