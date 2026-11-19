import { REASONS } from "../../../shared/study/aspects";
import type { Flag } from "./practice";

/* ── Words a practice question's screens share (package Q) ──
 * The options' Hebrew letter badges and a member's flag as one line. They
 * were QuestionCard's; practice 2.0 (PracticeQuestion) and the quiz
 * (QuizQuestion) each draw their own question now, so the card went and
 * these stayed. */

export const LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"] as const;

/** "הסימון של נועה: יש יותר מתשובה נכונה אחת. ״…״" (§6.1 #1). */
export function flagLine(f: Pick<Flag, "user_id" | "reason" | "note">, nameOf: (id: string) => string): string {
  const who = nameOf(f.user_id) || "ללא שם";
  const note = f.note.trim();
  return `הסימון של ${who}: ${REASONS[f.reason] ?? REASONS.other}.${note ? ` ״${note}״` : ""}`;
}

/** A name cut at the last whole word that fits in `max` characters, with
 *  "…" (lib/clip.ts). */
export { clip as shortName } from "./clip";
