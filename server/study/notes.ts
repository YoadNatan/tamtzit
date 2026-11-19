import { z } from "zod/v4";
import type { NumberedBlock } from "../../shared/study/blocks.js";
import { tidyMarkdown } from "./study.js";

/* ── "מההקלטה": a part's notes from the lecture's recording (spec §4.4) ──
 * The model answers one JSON document per part (at most 8 notes, so it is
 * parsed at the end, not streamed item by item). Every field is required and
 * there are no unions, enums or bounds (§2.6). The notes are then checked
 * here, deterministically, before they are saved apart from the part
 * (study_recording_notes): writing them into the part's Markdown would
 * renumber every later paragraph and move comments, the reader's place and
 * corrections. */

export const Notes = z.object({
  notes: z.array(
    z.object({
      para: z.number().int(), // the paragraph's ¶ number in this part; -1 = the end of the part
      at: z.string(), // "41:10" or "1:02:05" as in the transcript; "" when it has no times
      text: z.string(), // the note, Hebrew, 1-3 sentences
    }),
  ),
});
export type NoteDraft = z.infer<typeof Notes>["notes"][number];

/** A saved note: the paragraph it belongs to, the first 80 characters of
 *  that paragraph (to re-anchor it if the part changes), its time in the
 *  recording in seconds (null without one), and its text. */
export type RecNoteItem = { anchor: number; quote: string; at_s: number | null; text: string };

const MAX_NOTES = 12;
const IMPERATIVE = /^(שימ[וי]|זכר[וי]|תזכר)/;

/** "41:10" → 2470, "1:02:05" → 3725; null for anything else. */
export function clockSeconds(at: string): number | null {
  const m = /^\s*(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\s*$/.exec(at);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** The notes worth saving: a paragraph that exists (or -1), a time inside the
 *  recording, 10-600 characters of tidied text that states a fact (a note
 *  opening with an imperative is dropped), no duplicates, at most 12. */
export function checkNotes(
  drafts: NoteDraft[],
  blocks: NumberedBlock[],
  o: { hasTimes: boolean; durationS: number | null },
): RecNoteItem[] {
  const byAnchor = new Map(blocks.map((b) => [b.n, b]));
  const seen = new Set<string>();
  const out: RecNoteItem[] = [];
  for (const d of drafts) {
    if (out.length >= MAX_NOTES) break;
    if (!Number.isInteger(d.para) || (d.para !== -1 && !byAnchor.has(d.para))) continue;
    const text = tidyMarkdown(d.text ?? "").trim();
    if (text.length < 10 || text.length > 600 || IMPERATIVE.test(text) || seen.has(text)) continue;
    seen.add(text);
    let at_s = o.hasTimes ? clockSeconds(d.at ?? "") : null;
    if (at_s !== null && o.durationS !== null && at_s > o.durationS + 60) at_s = null;
    out.push({ anchor: d.para, quote: d.para === -1 ? "" : (byAnchor.get(d.para)?.text ?? "").slice(0, 80), at_s, text });
  }
  return out;
}

/** The model's notes from what it streamed: the text of the model that
 *  answered last (after a server-side fallback the last model's answer
 *  counts), else everything that streamed, when the fallback continued the
 *  first model's text. Null when neither is complete, valid JSON. */
export function parseNotes(byModel: Map<string, string>, lastModel: string): NoteDraft[] | null {
  const tries = [byModel.get(lastModel) ?? "", [...byModel.values()].join("")];
  for (const raw of tries) {
    try {
      const p = Notes.safeParse(JSON.parse(raw));
      if (p.success) return p.data.notes;
    } catch {
      /* not complete JSON */
    }
  }
  return null;
}
