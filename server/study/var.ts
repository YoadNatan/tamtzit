import { z } from "zod/v4";
import { citedSlides } from "../../shared/study/edits.js";
import { VAR_MAX_SLIDES } from "./limits.js";
import { slideText, type StoredSlide } from "./study.js";

/* ── VAR's verdict and its checks (package V; spec §12.4.V) ──
 *
 * Verdict is the schema the op sends as the output format (no enum for
 * certainty: spec §2.6; checked in code). checkVerdict is deterministic and
 * runs before the verdict is saved: what the model calls a quote must be on
 * its slide, the certainty must agree with the lists, and the trap card
 * must pass the cards' rules; the database checks the shape again
 * (study_private.verdict_ok). */

export const Verdict = z.object({
  certainty: z.string(), // "slide" | "interpretation" | "unclear" (checked in code: no enum in the schema, spec §2.6)
  summary: z.string(), // one Hebrew line for the box and the log
  on_slides: z.array(z.object({ text: z.string(), slides: z.array(z.number().int()) })), // what the slides say, quoted
  interpretation: z.array(z.object({ text: z.string(), slides: z.array(z.number().int()) })), // reasoning beyond the slides
  listen: z.boolean(), // "כדאי לשמוע בהקלטה"
  trap: z.object({ front: z.string(), back: z.string(), slides: z.array(z.number().int()) }).nullable(),
});
export type VerdictRaw = z.infer<typeof Verdict>;

export type Certainty = "slide" | "interpretation" | "unclear";
export type VerdictItem = { text: string; slides: number[] };
export type CheckedVerdict = {
  certainty: Certainty;
  summary: string;
  on_slides: VerdictItem[];
  interpretation: VerdictItem[];
  listen: boolean;
  trap: { front: string; back: string; slides: number[] } | null;
};

/** Case, whitespace and punctuation do not count when a quote is matched to its slide. */
export function normalizeQuote(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The slides VAR reads: both claims' and the paragraph's own [ש׳ n] tags,
 *  in that order, without repeats, only the deck's, at most VAR_MAX_SLIDES. */
export function varSlides(deck: Pick<StoredSlide, "n">[], a: number[], b: number[], paragraph: string): number[] {
  const have = new Set(deck.map((s) => s.n));
  const out: number[] = [];
  for (const n of [...a, ...b, ...citedSlides(paragraph)]) {
    if (Number.isInteger(n) && have.has(n) && !out.includes(n)) out.push(n);
    if (out.length >= VAR_MAX_SLIDES) break;
  }
  return out;
}

/** A trap card as the cards' rules allow it (section C, spec §4.4): a
 *  question of 5-400 characters, an answer of 1-300, no cloze braces. */
export function trapOk(t: { front: string; back: string }): boolean {
  const front = t.front.trim();
  const back = t.back.trim();
  return front.length >= 5 && front.length <= 400 && /[?？]/.test(front) && back.length >= 1 && back.length <= 300 && !/\{\{|\}\}/.test(front + back);
}

/** The deterministic checks before a verdict is saved. `sent` is the slides
 *  the call read. Null: no usable verdict (no summary of 5-300 characters). */
export function checkVerdict(v: VerdictRaw, sent: StoredSlide[]): CheckedVerdict | null {
  const nums = new Set(sent.map((s) => s.n));
  const textOf = new Map(sent.map((s) => [s.n, normalizeQuote(slideText(s))]));
  const keep = (slides: number[]) => [...new Set(slides.filter((n) => nums.has(n)))].slice(0, 6);
  const itemOk = (t: string) => t.length >= 3 && t.length <= 300;

  const summary = oneLine(v.summary);
  if (summary.length < 5 || summary.length > 300) return null;

  const onSlides: VerdictItem[] = [];
  const interpretation: VerdictItem[] = [];
  for (const raw of v.on_slides) {
    const item = { text: oneLine(raw.text), slides: keep(raw.slides) };
    if (!itemOk(item.text)) continue;
    const q = normalizeQuote(item.text);
    // A quote is a quote only when one of its slides holds it word for word.
    const quoted = q.length > 0 && item.slides.some((n) => (textOf.get(n) ?? "").includes(q));
    if (quoted && onSlides.length < 4) onSlides.push(item);
    else interpretation.push(item);
  }
  for (const raw of v.interpretation) {
    const item = { text: oneLine(raw.text), slides: keep(raw.slides) };
    if (itemOk(item.text)) interpretation.push(item);
  }
  // What moved over comes first: it bears on the dispute, the model put it first.
  const interp = interpretation.slice(0, 3);

  let certainty: Certainty = v.certainty === "slide" || v.certainty === "interpretation" || v.certainty === "unclear" ? v.certainty : "unclear";
  if (certainty === "slide" && !(onSlides.length > 0 && interp.length === 0)) certainty = "interpretation";

  let trap: CheckedVerdict["trap"] = null;
  if (v.trap && trapOk(v.trap)) {
    const back = v.trap.back.trim();
    const slides = keep(v.trap.slides);
    trap = { front: v.trap.front.trim(), back, slides: slides.length ? slides : keep(citedSlides(back)) };
  }

  return { certainty, summary, on_slides: onSlides, interpretation: interp, listen: v.listen === true, trap };
}
