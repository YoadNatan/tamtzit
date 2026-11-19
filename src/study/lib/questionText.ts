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

/** "סימון על תמונה" after the answer: every pin's name, by pin index, read
 *  from what the server wrote (server/study/labels.ts), never guessed.
 *  Tap mode ("באיזה מספר מסומן X?", options '1'…'m'): the right pin is the
 *  lead-in's X, every other pin its own line "N הוא NAME." whole (a name
 *  may itself hold a period: "N. vagus"). Name mode ("מה מסומן במספר n
 *  בשרטוט?"): the asked pin is the key; a wrong option that is a pin starts
 *  its why with "מסומן במספר N בשרטוט.", so that pin is named by the option.
 *  "" where nothing names a pin. */
export function pinNames(
  q: { question: string; options: readonly string[]; layout?: { kind: string; mode?: string; pins?: readonly { n: number }[]; ask?: number } | null },
  fb: { answer: number; explanations: readonly string[] },
): string[] {
  const lay = q.layout;
  if (!lay || lay.kind !== "label" || !lay.pins) return [];
  const names = lay.pins.map(() => "");
  const index = new Map(lay.pins.map((p, i) => [p.n, i]));
  if (lay.mode === "tap") {
    const asked = /^באיזה מספר מסומן (.+)\?$/s.exec(q.question.trim())?.[1]?.trim() ?? "";
    for (let i = 0; i < names.length; i++) {
      const e = (fb.explanations[i] ?? "").trim();
      if (i === fb.answer) names[i] = asked;
      else names[i] = (/^\d+ הוא (.+)\.$/s.exec(e)?.[1] ?? /^\d+ הוא (.+?)\.(?:\s|$)/s.exec(e)?.[1] ?? "").trim();
    }
    return names;
  }
  const ask = lay.ask !== undefined ? index.get(lay.ask) : undefined;
  if (ask !== undefined && fb.answer >= 0) names[ask] = q.options[fb.answer] ?? "";
  q.options.forEach((o, k) => {
    if (k === fb.answer) return;
    const n = Number(/^מסומן במספר (\d+) בשרטוט\./.exec((fb.explanations[k] ?? "").trim())?.[1] ?? 0);
    const at = n ? index.get(n) : undefined;
    if (at !== undefined) names[at] = o;
  });
  return names;
}
