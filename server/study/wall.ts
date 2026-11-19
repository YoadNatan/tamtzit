import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { citedSlides } from "../../shared/study/edits.js";
import { cleanSchema, JsonArrayItems, run, type Ledger } from "./claude.js";
import { WALL_CHECK_EFFORT, WALL_CHECK_MAX_TOKENS, WALL_DRAFTS_EFFORT, WALL_DRAFTS_MAX_TOKENS } from "./limits.js";
import { WALL_CHECK_SYSTEM, WALL_DRAFTS_SYSTEM } from "./prompts/wall.js";

/* ── The association wall's server code (package J, spec §12.5.J) ──
 *
 * "תנו לי 3": three drafts for one paragraph, one of each technique, with
 * the paragraph's deciding fact. Each draft is checked in code as it closes
 * in the stream (checkDraft: the addendum's checkDrafts, K's checkMnemonic
 * rules and one of each technique) and shown or skipped; the fact is checked
 * once the answer is whole (checkFact). The drafts that passed are saved for
 * the whole group, keyed by the paragraph and the sha256 of its text
 * (study_aid_drafts_save, with the server key), so the same text is never
 * paid for twice.
 *
 * The check of a would-be winner (op wall_check): one short call, effort
 * low, schema {ok, problem}; the model never sees who wrote the entry. */

export const TECHNIQUES = ["משחק מילים", "חרוז", "סצנה הזויה"] as const;

export const Draft = z.object({
  technique: z.string().describe('One of: "משחק מילים", "חרוז", "סצנה הזויה"'),
  hook: z.string().describe("The draft itself, short enough to say in one breath"),
  decode: z.string().describe("How the draft maps to the fact"),
});
export const DraftSet = z.object({
  fact: z.string().describe("The paragraph's deciding fact, in a few words from the paragraph, with its slide tag"),
  drafts: z.array(Draft).describe("Three drafts, one of each technique, in order"),
});
export type DraftItem = z.infer<typeof Draft>;

export const CheckVerdict = z.object({
  ok: z.boolean().describe("true only if every fact the aid states or implies is in the paragraph or its slides, unchanged, and the aid keeps the house rule"),
  problem: z.string().describe('When not ok, one short Hebrew line naming what is wrong; "" when ok'),
});
export type CheckItem = z.infer<typeof CheckVerdict>;

/** The JSON schemas sent (the plain schema, never a parse helper). */
export const DRAFTS_SCHEMA = cleanSchema(zodOutputFormat(DraftSet).schema as Record<string, unknown>);
export const CHECK_SCHEMA = cleanSchema(zodOutputFormat(CheckVerdict).schema as Record<string, unknown>);

/** sha256 of a paragraph's text as written now: a corrected paragraph gets
 *  another hash, so it may get new drafts; the same text never pays twice. */
export async function paragraphHash(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.trim()));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── The checks (deterministic; a failed draft is skipped, not shown) ── */
const GENDERED = /(^|[\s"'(״«])(שים|שימי|זכור|זכרי|תזכור|תזכרי|דמיין|דמייני|תדמיין|תדמייני|תחשוב|תחשבי|תשים|תשימי)(?=[\s,.:;!?"')״»]|$)/;
const LATIN_WORD = /[A-Za-z][A-Za-z-]{3,}/g;
const TAG = /\[ש['׳][^\]]*\]/g;
const NUM = /\d+(?:[.,]\d+)?/g;
const tidy = (s: string) => s.replace(/\*+/g, "").replace(/[ \t\r\n]+/g, " ").trim();
const len = (s: string) => [...s].length;

/** The text rules every draft and the fact keep: no markup, URL or emoji, no
 *  singular gendered address, every number in the material. */
function textRules(all: string, source: string): string | null {
  if (/[<>`#]|https?:/i.test(all)) return "markup";
  if (/\p{Extended_Pictographic}/u.test(all)) return "emoji";
  if (GENDERED.test(all)) return "gendered";
  // Whole numbers only: "6" is not in "16" (K's substring rule would pass it).
  const have = new Set(source.match(NUM) ?? []);
  for (const n of all.replace(TAG, "").match(NUM) ?? []) if (!have.has(n)) return `number ${n} not in the paragraph`;
  return null;
}

/** One draft: the technique is one of the three; hook 3-200 characters,
 *  decode 10-400; the text rules; and no English term of the lecture in the
 *  decode that this paragraph and its slides do not have (no pairing from
 *  elsewhere). `source` is the paragraph and its slides; `lectureText` the deck. */
export function checkDraft(d: DraftItem, source: string, lectureText: string): { ok: true; item: DraftItem } | { ok: false; why: string } {
  const item = { technique: tidy(d.technique), hook: tidy(d.hook), decode: tidy(d.decode) };
  if (!(TECHNIQUES as readonly string[]).includes(item.technique)) return { ok: false, why: "technique" };
  if (len(item.hook) < 3 || len(item.hook) > 200) return { ok: false, why: "hook length" };
  if (len(item.decode) < 10 || len(item.decode) > 400) return { ok: false, why: "decode length" };
  const broke = textRules(`${item.hook}\n${item.decode}`, source);
  if (broke) return { ok: false, why: broke };
  const src = source.toLowerCase();
  const lec = lectureText.toLowerCase();
  for (const w of `${item.hook}\n${item.decode}`.match(LATIN_WORD) ?? []) {
    const lw = w.toLowerCase();
    if (lw.length >= 5 && lec.includes(lw) && !src.includes(lw)) return { ok: false, why: `term ${w} is from another part of the lecture` };
  }
  return { ok: true, item };
}

/** The deciding fact: 5-300 characters; the text rules; every English word
 *  of 4+ letters in the material; and the paragraph's slide tag when the
 *  paragraph has one (added from the paragraph itself when the model left
 *  it out: the tag is the paragraph's, not a claim). */
export function checkFact(fact: string, target: string, source: string): { ok: true; fact: string } | { ok: false; why: string } {
  let f = tidy(fact);
  if (len(f) < 5 || len(f) > 300) return { ok: false, why: "fact length" };
  const broke = textRules(f, source);
  if (broke) return { ok: false, why: broke };
  const src = source.toLowerCase();
  for (const w of f.match(LATIN_WORD) ?? []) if (!src.includes(w.toLowerCase())) return { ok: false, why: `term ${w} not in the paragraph` };
  const cited = citedSlides(target);
  if (cited.length && !citedSlides(f).some((n) => cited.includes(n))) {
    const tagged = `${f} [ש׳ ${cited[0]}]`;
    if (len(tagged) > 300) return { ok: false, why: "fact length" };
    f = tagged;
  }
  return { ok: true, fact: f };
}

/** The slides a saved row names: those its fact cites, else the paragraph's;
 *  only the lecture's own, at most 6. */
export function draftSlides(fact: string, target: string, have: number[]): number[] {
  const own = new Set(have);
  const pick = (xs: number[]) => xs.filter((n) => own.has(n)).slice(0, 6);
  const f = pick(citedSlides(fact));
  return f.length ? f : pick(citedSlides(target));
}

export type DraftsResult = {
  drafts: DraftItem[];
  fact: string | null;
  rejected: number;
  why: string | null;
  model: string;
  stop: string | null;
  timedOut: boolean;
};

/** Streams the drafts one by one through claude.ts's run(): {"t":"d"} per
 *  draft that passed, {"t":"skip"} per refused one; the call is settled in
 *  run()'s `finally` through `ledger`. The fact is read and checked once the
 *  answer is whole. */
export async function streamDrafts(o: {
  client: Anthropic;
  ref: string;
  request: string;
  target: string;
  source: string; // the paragraph and its cited slides, for the checks
  lectureText: string; // the whole deck, for the checks
  stopAt: number;
  write: (line: string) => void;
  ledger: Ledger;
  signal?: AbortSignal;
}): Promise<DraftsResult> {
  const scan = new JsonArrayItems();
  const seen = new Set<string>();
  const drafts: DraftItem[] = [];
  let rejected = 0;
  let text = "";
  const res = await run({
    client: o.client,
    kind: "mnemonic",
    ref: o.ref,
    system: [{ type: "text", text: WALL_DRAFTS_SYSTEM }],
    messages: [{ role: "user", content: o.request }],
    effort: WALL_DRAFTS_EFFORT,
    maxTokens: WALL_DRAFTS_MAX_TOKENS,
    stopAt: o.stopAt,
    format: { type: "json_schema", schema: DRAFTS_SCHEMA },
    ledger: o.ledger,
    signal: o.signal,
    onText: (delta) => {
      text += delta;
      for (const raw of scan.push(delta)) {
        const p = Draft.safeParse(raw);
        const r = p.success ? checkDraft(p.data, o.source, o.lectureText) : ({ ok: false, why: "shape" } as const);
        if (r.ok && !seen.has(r.item.technique) && drafts.length < 3) {
          seen.add(r.item.technique);
          drafts.push(r.item);
          o.write(JSON.stringify({ t: "d", d: r.item }) + "\n");
        } else {
          rejected += 1;
          o.write(JSON.stringify({ t: "skip", why: r.ok ? "a second draft of one technique" : r.why }) + "\n");
        }
      }
    },
  });
  let fact: string | null = null;
  let why: string | null = null;
  try {
    const whole = DraftSet.safeParse(JSON.parse(text));
    if (whole.success) {
      const f = checkFact(whole.data.fact, o.target, o.source);
      if (f.ok) fact = f.fact;
      else why = f.why;
    } else why = "shape";
  } catch {
    why = "truncated";
  }
  return { drafts, fact, rejected: rejected + scan.bad, why, model: res.model, stop: res.stop, timedOut: res.timedOut };
}

/** The check's one call: the verdict, or null when it did not finish (a
 *  refusal, a timeout, an answer that is not the schema's). The `problem`
 *  line is cleaned (one line, at most 300 characters, no markup); a "not ok"
 *  with no line says so in general words. */
export async function checkCall(o: {
  client: Anthropic;
  ref: string;
  request: string;
  stopAt: number;
  ledger: Ledger;
  signal?: AbortSignal;
}): Promise<{ verdict: CheckItem | null; stop: string | null; model: string; timedOut: boolean }> {
  let text = "";
  const r = await run({
    client: o.client,
    kind: "wall_check",
    ref: o.ref,
    system: [{ type: "text", text: WALL_CHECK_SYSTEM }],
    messages: [{ role: "user", content: o.request }],
    effort: WALL_CHECK_EFFORT,
    maxTokens: WALL_CHECK_MAX_TOKENS,
    stopAt: o.stopAt,
    format: { type: "json_schema", schema: CHECK_SCHEMA },
    ledger: o.ledger,
    signal: o.signal,
    onText: (d) => {
      text += d;
    },
  });
  if (r.stop === "refusal" || r.timedOut) return { verdict: null, stop: r.stop, model: r.model, timedOut: r.timedOut };
  try {
    const p = CheckVerdict.safeParse(JSON.parse(text));
    if (!p.success) return { verdict: null, stop: r.stop, model: r.model, timedOut: false };
    const problem = p.data.ok ? "" : tidy(p.data.problem).replace(/[<>`#*]/g, "").slice(0, 300) || "לא תואם לפסקה או לשקף.";
    return { verdict: { ok: p.data.ok, problem }, stop: r.stop, model: r.model, timedOut: false };
  } catch {
    return { verdict: null, stop: r.stop, model: r.model, timedOut: false };
  }
}
