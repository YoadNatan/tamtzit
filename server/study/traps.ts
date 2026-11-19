import { z } from "zod/v4";
import { ASPECT_KEYS, cleanWhen, tagSlides, tidy, type Aspect } from "./questions.js";

/* ── A member's trap and its check (package E; spec §12.6.E) ──
 *
 * TrapVerdict is the schema op "trap_check" sends as the output format
 * (every field required, no enum, no nullable: the bank's rules for a
 * structured answer). checkTrap is deterministic and runs before anything is
 * saved: the options' count, every "why" ending with a tag of the lecture's
 * slides and naming no other option by its letter (the bank shows options in
 * a fresh order), "when" as section Q's rule (cleanWhen: '' for the key), the
 * takeaway with its tag, the topic and the aspect. The database checks the
 * counts again (study_trap_checked). */

export const TrapVerdict = z.object({
  ok: z.boolean().describe("true only when the question is right by the slides, as the instructions define it"),
  problem: z.string().describe("When ok is false: the first thing wrong, one short gender-neutral Hebrew line naming the slide that shows it; else an empty string"),
  options: z
    .array(
      z.object({
        why: z.string().describe("One or two Hebrew sentences from the slides on why this option is right or wrong, ending with its tag [ש' n]"),
        when: z.string().describe("For a wrong option: 'מתי כן: …' when the lecture gives a case where it is the answer; else an empty string, and always for the correct option"),
      }),
    )
    .describe("When ok is true: one entry per option, in the order given; else an empty array"),
  takeaway: z.string().describe("When ok is true: the tested fact as one Hebrew sentence ending with its tag; else an empty string"),
  topic: z.string().describe("The drug, organism, disease or process the question is about, in English as the lecture writes it"),
  aspect: z.string().describe("One key: mechanism, uses, pk, adverse, contra, interactions, resistance, dosing, classification, epidemiology, lifecycle, pathogenesis, clinical, diagnosis, treatment, prevention, other"),
});
export type TrapVerdictRaw = z.infer<typeof TrapVerdict>;

/** What the database is sent: a rejection with its problem, or the bank's explanations. */
export type CheckedTrap =
  | { ok: false; problem: string }
  | { ok: true; whys: string[]; whens: string[]; takeaway: string; topic: string; aspect: Aspect };

const WHY_MIN = 5;
const WHY_MAX = 450;
const PROBLEM_MIN = 3;
const PROBLEM_MAX = 300;
const TAKEAWAY_MAX = 600;
const TOPIC_MAX = 120;
/** A "why" that names another option by its letter ("תשובה ב", "אפשרות ג"):
 *  the bank shows the options in another order. */
const OPTION_BY_LETTER = /(?:תשובה|אפשרות)\s+[א-ו](?![א-ת])/;
/** A tag at the very end of a text, after its last period or none. */
const ENDS_WITH_TAG = /\[ש['׳]\s?\d+(?:\s?-\s?\d+)?(?:\s?,\s?\d+(?:\s?-\s?\d+)?)*\]\s*\.?$/;

/** A text whose tags name only the lecture's slides and that ends with one. */
function tagged(t: string, slides: ReadonlySet<number>): boolean {
  const tags = tagSlides(t);
  return ENDS_WITH_TAG.test(t) && tags.length > 0 && tags.every((n) => slides.has(n));
}

/** The deterministic checks. `draft` is what the member wrote (her options
 *  and the one she marked); `slides` the lecture's slide numbers. Null: no
 *  usable verdict (a rejection with no problem, or explanations that break
 *  the bank's rules), so nothing is saved and the op answers 502. */
export function checkTrap(v: TrapVerdictRaw, draft: { options: readonly string[]; answer: number }, slides: ReadonlySet<number>): CheckedTrap | null {
  if (!v.ok) {
    const problem = tidy(v.problem);
    if (problem.length < PROBLEM_MIN) return null;
    return { ok: false, problem: problem.length > PROBLEM_MAX ? problem.slice(0, PROBLEM_MAX - 1) + "…" : problem };
  }
  if (v.options.length !== draft.options.length) return null;
  const whys: string[] = [];
  const whens: string[] = [];
  for (let i = 0; i < v.options.length; i++) {
    const why = tidy(v.options[i].why);
    if (why.length < WHY_MIN || why.length > WHY_MAX || OPTION_BY_LETTER.test(why) || !tagged(why, slides)) return null;
    whys.push(why);
    whens.push(cleanWhen(v.options[i].when, i === draft.answer, slides));
  }
  const t = tidy(v.takeaway);
  const takeaway = t.length <= TAKEAWAY_MAX && tagged(t, slides) ? t : "";
  const topic = tidy(v.topic).slice(0, TOPIC_MAX);
  const aspect = (ASPECT_KEYS as readonly string[]).includes(v.aspect) ? (v.aspect as Aspect) : "other";
  return { ok: true, whys, whens, takeaway, topic, aspect };
}
