import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";
import { numberBlocks, type NumberedBlock } from "../../shared/study/blocks.js";
import { clozeFull, clozeParts } from "../../shared/study/cloze.js";
import { estimateUsd, reserve, settle } from "./budget.js";
import { generateItems, settleFor } from "./claude.js";
import { fallbackReserve, modelFor } from "./routes.js";
import type { Op } from "./ops/types.js";
import { CARDS_SYSTEM, cardsRequest, correctionsForCards, type Correction } from "./prompts/cards.js";
import { placePara } from "./questions.js";
import { normalize, similarity } from "./similar.js";
import {
  anthropic,
  errorText,
  HttpError,
  keyed,
  lectureBlock,
  loadLecture,
  memberClient,
  MODEL,
  schemaOk,
  textStream,
  tidyMarkdown,
  type Lecture,
} from "./study.js";

/* ── Flashcards on the server: op "cards" of /api/study/ai (spec §4.7) ──
 *
 * One request writes one part of a generation round (study_card_round plans
 * the round; the phone sends one request per part, the first alone until its
 * "start" line, then two at a time). The steps: the member's token, the
 * lecture, the part claimed with the server key (409 "busy" while another
 * phone writes it, 409 "gave up" after its 3 paid tries), the inputs (the
 * lecture's cards for duplicates, the pictures the summary captioned, the
 * part's current corrections), a reservation of the call's worst case (kind
 * "cards", ref the batch id; 402 "budget" before the stream), then one model
 * call for the wanted number of cards, each checked, saved with the server key
 * and streamed as soon as it closes. A second call, with its own reservation,
 * writes what is missing when fewer were valid and more than 120 s remain.
 * Every call is settled after it, every claimed part is finished.
 *
 * The answer is textStream()'s NDJSON: {"t":"start"} when the model's response
 * starts (the phone may start the next part, which reads this one's cache
 * entry), {"t":"c",…} per saved card, {"t":"skip","why":…} per rejected one,
 * and {"t":"done","made","rejected","costUsd","unsettled"} at the end. */

// ── The format (design-cards §3.4): every field required, no enum, no union ──

export const CardItem = z.object({
  topic: z.string().describe("The drug, organism, disease or process the card is about, in English exactly as the lecture writes it"),
  aspect: z.string().describe("One key: mechanism, uses, pk, adverse, contra, interactions, resistance, dosing, classification, epidemiology, lifecycle, pathogenesis, clinical, diagnosis, treatment, prevention, other"),
  cloze: z.boolean().describe("true: front is one Hebrew sentence with exactly one part to recall inside {{ }} and back is an empty string; false: front is a question and back is its short answer"),
  front: z.string().describe("A cloze sentence with one {{ }}, or a complete Hebrew question ending with '?'. No slide numbers"),
  back: z.string().describe("The short answer to the question (at most about 15 words), or an empty string for a cloze card"),
  extra: z.string().describe("One short Hebrew sentence from the slides that makes the answer make sense, or an empty string"),
  figure: z.string().describe("A picture id from the request's list (fig:20-1) whose picture shows this fact, or an empty string"),
  slides: z.array(z.number().int()).describe("Every slide number the card relies on, at least one in the requested range"),
  para: z.number().int().describe("The number of the paragraph (¶) of the part shown in the request whose text states the card's fact; 0 when the part has no written summary"),
});
export const CardSet = z.object({ cards: z.array(CardItem) });
export type CardItem = z.infer<typeof CardItem>;

/** The aspect keys a card may carry: the list in CARDS_SYSTEM and in the CHECK
 *  on study_cards.aspect (cards.test.ts compares the two). F1's
 *  shared/study/aspects.ts holds the same keys with their Hebrew labels. */
export const ASPECT_KEYS = [
  "mechanism",
  "uses",
  "pk",
  "adverse",
  "contra",
  "interactions",
  "resistance",
  "dosing",
  "classification",
  "epidemiology",
  "lifecycle",
  "pathogenesis",
  "clinical",
  "diagnosis",
  "treatment",
  "prevention",
  "other",
] as const;
export type Aspect = (typeof ASPECT_KEYS)[number];

/** What study_save_card() receives (its p_card), and what a member's edit sends. */
export type SaveCard = {
  kind: "qa" | "cloze";
  front: string;
  back: string;
  extra: string;
  figure: string;
  slides: number[];
  topic: string;
  aspect: Aspect;
  /** C's end: the paragraph (data-blk) of the part the card sits on, null
   *  when it could not be placed, with the start of its text. */
  para?: number | null;
  quote?: string;
  model?: string;
};

/** A card already in the lecture (shared: the op reads them as the member). */
export type KnownCard = { id: string; kind: "qa" | "cloze"; front: string; back: string; topic: string; aspect: string; slides: number[] };

export type CardCtx = {
  lectureSlides: ReadonlySet<number>;
  from: number;
  to: number;
  /** Picture ids offered in the request ("fig:20-1"). */
  figures: ReadonlySet<string>;
  known: KnownCard[];
  /** C's end: the part's blocks (¶0 the heading); none when it has no written summary. */
  blocks?: readonly NumberedBlock[];
};

export type CardChecked = { ok: true; item: SaveCard; warnings: string[] } | { ok: false; reasons: string[] };

// ── Text helpers ──

/** tidyMarkdown() (hyphen ranges, no direction marks) on one line of text. */
const tidy = (s: string): string => tidyMarkdown(s).replace(/\s+/g, " ").trim();

/** A slide tag as the summaries write it: [ש' 5], [ש׳ 3-4, 9]. */
const TAG = /\[ש['׳]\s?(\d+(?:\s?-\s?\d+)?(?:\s?,\s?\d+(?:\s?-\s?\d+)?)*)\]/g;

/** Slide numbers named by the [ש' n] tags in a text (ranges expanded). */
function tagSlides(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(TAG)) {
    for (const part of m[1].split(",")) {
      const [a, b] = part.split("-").map((x) => Number(x.trim()));
      if (b === undefined) out.push(a);
      else for (let n = a; n <= b && n - a < 60; n++) out.push(n);
    }
  }
  return out;
}

/** The text a card is compared by: its fact, whatever its form. */
export const cardText = (c: { kind: "qa" | "cloze"; front: string; back: string }): string =>
  c.kind === "cloze" ? clozeFull(c.front) : `${c.front} ${c.back}`;

const HEBREW = /[א-ת]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const MARKDOWN = /\*\*|__|`|^#+\s|^\s*[-*]\s/gm;
const YES_NO = /^(האם|האמנם|נכון או לא|נכון\/לא נכון)/;
const META = /(בשקף|השקף|בהרצאה|המרצה|לפי השקפים)/;
const DUP_TEXT = 0.6;
const DUP_ANSWER = 0.85;

/** The near-duplicate of a card among the known ones, if any: nearly the same
 *  fact text, or the same topic and aspect with nearly the same answer
 *  (design-cards §3.6). */
export function duplicateCard(
  c: { kind: "qa" | "cloze"; front: string; back: string; topic: string; aspect: string },
  known: KnownCard[],
): KnownCard | null {
  const text = cardText(c);
  const ans = c.kind === "cloze" ? (clozeParts(c.front)?.answer ?? "") : c.back;
  for (const k of known) {
    if (similarity(text, cardText(k)) >= DUP_TEXT) return k;
    const kAns = k.kind === "cloze" ? (clozeParts(k.front)?.answer ?? "") : k.back;
    if (normalize(k.topic) === normalize(c.topic) && k.aspect === c.aspect && similarity(ans, kAns) >= DUP_ANSWER) return k;
  }
  return null;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** Items in an answer: comma or semicolon separated, or joined by a hyphenated
 *  "ו-" ("A, B ו-C" is three). A plain Hebrew "ו" prefix is not counted: it
 *  starts too many ordinary words. */
const items = (s: string) =>
  s
    .split(/[,;]|\s+ו-(?=\S)/)
    .map((x) => x.trim())
    .filter(Boolean).length;

/** Every check the schema cannot make (design-cards §3.5). Hard failures
 *  reject the card; fixes are applied and reported as warnings (they
 *  calibrate the prompt). The database repeats what it must not trust. */
export function checkCard(c: CardItem, ctx: CardCtx): CardChecked {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const clean = (s: string, field: string) => {
    let t = tidy(s);
    if (MARKDOWN.test(t)) {
      t = t.replace(MARKDOWN, "").trim();
      warnings.push(`markdown removed from ${field}`);
    }
    MARKDOWN.lastIndex = 0;
    for (const n of tagSlides(t)) if (!ctx.lectureSlides.has(n)) reasons.push(`tag names unknown slide ${n}`);
    if (/\[ש['׳]/.test(t)) {
      t = t.replace(/\s*\[ש['׳][^\]]*\]/g, "").trim();
      warnings.push(`slide tag removed from ${field}`);
    }
    return t;
  };
  let front = clean(c.front, "front");
  let back = clean(c.back, "back");
  let extra = clean(c.extra, "extra");
  const kind: "qa" | "cloze" = c.cloze ? "cloze" : "qa";

  if (front.length < 3 || front.length > 300) reasons.push("front empty or long");
  if (!HEBREW.test(front + back)) reasons.push("no Hebrew");
  if (YES_NO.test(front)) reasons.push("yes/no or true/false card");
  if (META.test(front + " " + back)) warnings.push("refers to the slide or the lecture");

  if (kind === "cloze") {
    const p = clozeParts(front);
    if (!p) reasons.push("a cloze needs exactly one {{ }}");
    else {
      const answer = p.answer.trim();
      if (!answer || answer.length > 60 || words(answer) > 6) reasons.push("cloze answer empty or longer than 6 words");
      if (p.before.length && WORD_CHAR.test(p.before.slice(-1))) reasons.push("cloze splits a word");
      if (p.after.length && WORD_CHAR.test(p.after[0])) reasons.push("cloze splits a word");
      const rest = `${p.before} ${p.after}`;
      if (rest.replace(/\s+/g, " ").trim().length < 12 || !HEBREW.test(rest)) reasons.push("cloze sentence has too little context");
      if (normalize(answer).length >= 4 && normalize(rest).includes(normalize(answer))) reasons.push("cloze answer appears in its sentence");
      if (items(answer) > 3) reasons.push("cloze hides a list");
      front = `${p.before.replace(/\s+$/, " ")}{{${answer}}}${p.after}`.replace(/\s+/g, " ").trim();
    }
    if (back) {
      warnings.push("cloze back cleared");
      back = "";
    }
  } else {
    if (/[{}]/.test(front)) reasons.push("braces in a question card");
    if (!back) reasons.push("question without an answer");
    if (back.length > 200 || words(back) > 30) reasons.push("answer longer than 30 words");
    if (items(back) > 3) reasons.push("answer is a list of more than 3");
    if (!front.endsWith("?")) warnings.push("question does not end with ?");
    const nb = normalize(back);
    if (nb.length >= 5 && normalize(front).includes(nb)) reasons.push("the answer is in the question");
  }
  if (extra.length > 400) {
    warnings.push("extra dropped: too long");
    extra = "";
  }

  // Slides: listed ones exist; at least one in the part.
  const slides = [...new Set(c.slides)].sort((a, b) => a - b);
  if (!slides.length) reasons.push("no slides");
  if (slides.some((n) => !ctx.lectureSlides.has(n))) reasons.push("unknown slide");
  if (!slides.some((n) => n >= ctx.from && n <= ctx.to)) reasons.push("outside the part");

  let figure = c.figure.trim();
  if (figure && !ctx.figures.has(figure)) {
    warnings.push(`figure ${figure} not offered: dropped`);
    figure = "";
  }

  const aspect = ASPECT_KEYS.find((k) => k === c.aspect.trim().toLowerCase());
  if (!aspect) warnings.push(`aspect "${c.aspect}" mapped to other`);
  const topic = tidy(c.topic).slice(0, 120);
  // C7 (C's end): the drug or organism is named in the visible part of the front.
  if (!reasons.length && !cueNamesTopic(front, topic)) reasons.push("cue");

  if (!reasons.length) {
    const dup = duplicateCard({ kind, front, back, topic, aspect: aspect ?? "other" }, ctx.known);
    if (dup) reasons.push(`duplicate of ${dup.id}`);
  }
  if (reasons.length) return { ok: false, reasons };
  // C's end: the paragraph the card sits on, placed by similarity when the model's number is not one of the part's.
  const blocks = ctx.blocks ?? [];
  const para = blocks.length ? placePara(c.para ?? 0, blocks, cardText({ kind, front, back }) + (extra ? ` ${extra}` : "")) : null;
  if (blocks.length && para !== c.para) warnings.push(para === null ? "paragraph not placed" : "paragraph placed by similarity");
  const block = para === null ? undefined : blocks.find((b) => b.n === para);
  return {
    ok: true,
    warnings,
    item: { kind, front, back, extra, figure, slides, topic, aspect: aspect ?? "other", para, quote: block ? block.text.slice(0, 80) : "" },
  };
}

/** C7: the card's English topic appears, case-insensitive, in its front
 *  outside the {{…}} of a cloze. A topic with no English (a process named in
 *  Hebrew) asks nothing. */
export function cueNamesTopic(front: string, topic: string): boolean {
  const t = topic.trim().toLowerCase();
  if (!/[a-z]/.test(t)) return true;
  const visible = front.replace(/\{\{[^}]*\}\}/g, " ").toLowerCase();
  return visible.includes(t);
}

/** About half the cards as cloze, as the facts allow (the prompt says so). */
export const clozeFor = (count: number): number => Math.round(count * 0.5);

/** What the op streams for a saved card (cards are not secret; the model that
 *  wrote it stays in the database). */
export type CardLine = { t: "c"; c: { id: string; part_idx: number; version: number } & Omit<SaveCard, "model"> };
export function toLine(id: string, partIdx: number, item: SaveCard): CardLine {
  const { model: _model, ...rest } = item;
  return { t: "c", c: { id, part_idx: partIdx, version: 1, ...rest } };
}

export type Figure = { id: string; slide: number; caption: string };

/** Pictures a part may attach: the summary's own captions for fig:n-k ids of
 *  slides in the range (the summary model saw the pictures; the card model
 *  gets only these lines, so no image tokens are spent). */
export function figureList(sectionsMarkdown: string[], from: number, to: number): Figure[] {
  const out = new Map<string, Figure>();
  for (const md of sectionsMarkdown) {
    for (const m of md.matchAll(/!\[([^\]]{0,400})\]\((fig:(\d+)-(\d+))\)/g)) {
      const slide = Number(m[3]);
      if (slide < from || slide > to || out.has(m[2])) continue;
      out.set(m[2], { id: m[2], slide, caption: tidy(m[1]).replace(/\s*\(שקף\s*\d+\)\s*$/, "").slice(0, 300) });
    }
  }
  return [...out.values()].sort((a, b) => a.slide - b.slide || a.id.localeCompare(b.id));
}

/** The covered list (spec §4.7): the facts already on cards with a slide in
 *  the part's range, as `topic: front → back` (a cloze as its whole
 *  sentence), each line at most 160 characters, the 40 most recent, oldest
 *  first. A second call of the same part sees the first call's cards here. */
export const COVERED_LINES = 40;
export const COVERED_CHARS = 160;
export function coveredFor(known: KnownCard[], part: { slide_from: number; slide_to: number }): Array<{ topic: string; text: string }> {
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  return known
    .filter((k) => k.slides.some((n) => n >= part.slide_from && n <= part.slide_to))
    .slice(-COVERED_LINES)
    .map((k) => {
      const topic = tidy(k.topic);
      const fact = tidy(k.kind === "cloze" ? clozeFull(k.front) : `${k.front} → ${k.back}`);
      return { topic, text: cut(fact, COVERED_CHARS - (topic ? topic.length + 2 : 0)) };
    });
}

/** One row of package K's study_edits, as the op reads it. */
export type EditRow = { anchor: number; rev: number; before_text: string; after_text: string; note: string | null };

/** A part's current corrections, netted per paragraph as "לשאול" nets them
 *  (§4.8; K's study_corrections_of does the same for a rewrite): the text
 *  before the first edit and after the last, the notes joined; a paragraph
 *  edited back to its text is dropped; the 20 most recent, in the part's order. */
export function netCorrections(rows: EditRow[]): Correction[] {
  const byAnchor = new Map<number, EditRow[]>();
  for (const r of rows) {
    const list = byAnchor.get(r.anchor);
    if (list) list.push(r);
    else byAnchor.set(r.anchor, [r]);
  }
  const net = [...byAnchor.entries()].map(([anchor, edits]) => {
    edits.sort((a, b) => a.rev - b.rev);
    const last = edits[edits.length - 1];
    return {
      anchor,
      rev: last.rev,
      before: edits[0].before_text,
      after: last.after_text,
      note: edits
        .map((e) => (e.note ?? "").trim())
        .filter(Boolean)
        .join(" · "),
    };
  });
  return net
    .filter((c) => c.before !== c.after)
    .sort((a, b) => b.rev - a.rev)
    .slice(0, 20)
    .sort((a, b) => a.anchor - b.anchor)
    .map((c) => ({ before: c.before.slice(0, 1500), after: c.after.slice(0, 1500), note: c.note.slice(0, 300) }));
}

/** What study_card_claim() hands the op: the part to write. `wanted` is what
 *  the part still lacks; effort is low after a timeout. */
export type Claim = {
  lecture_id: string;
  round: number;
  part_idx: number;
  heading: string;
  slide_from: number;
  slide_to: number;
  wanted: number;
  effort: "medium" | "low";
};

/** One model call of a part: the cached prefix (CARDS_SYSTEM, then the lecture
 *  with the breakpoint), the request as the user turn, and the part's
 *  corrections as one more block after it when there are any. The same bytes
 *  are used for the reservation's estimate and for the call. */
export function cardsCall(
  o: { lecture: Lecture; claim: Pick<Claim, "heading" | "slide_from" | "slide_to">; figures: Figure[]; corrections: Correction[]; known: KnownCard[]; blocks?: NumberedBlock[] },
  want: number,
): { system: Anthropic.Beta.BetaTextBlockParam[]; messages: Anthropic.Beta.BetaMessageParam[]; maxTokens: number; inputChars: number } {
  const deck = lectureBlock(o.lecture);
  const request = cardsRequest({
    heading: o.claim.heading,
    from: o.claim.slide_from,
    to: o.claim.slide_to,
    count: want,
    cloze: clozeFor(want),
    figures: o.figures,
    covered: coveredFor(o.known, o.claim),
    blocks: o.blocks,
  });
  const fixes = o.corrections.length ? correctionsForCards(o.corrections) : "";
  return {
    system: [
      { type: "text", text: CARDS_SYSTEM },
      { type: "text", text: deck, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: fixes
          ? [
              { type: "text", text: request },
              { type: "text", text: fixes },
            ]
          : request,
      },
    ],
    maxTokens: 4_000 + 500 * want,
    inputChars: CARDS_SYSTEM.length + deck.length + request.length + fixes.length,
  };
}

/** A second call only while this much of the 270 s remains. */
const SECOND_CALL_MS = 120_000;

/** Ends a claimed part: ready with however many cards were made (or when it
 *  had nothing left to write), else failed with its code. Never throws: a
 *  part left "writing" is free again after six minutes. */
async function finishBatch(
  sb: SupabaseClient,
  batchId: string,
  r: { made: number; rejected: number; model: string | null; costUsd: number; error: string | null; complete?: boolean },
): Promise<void> {
  const ready = r.made > 0 || r.complete === true;
  try {
    const { error } = await sb.rpc(
      "study_card_finish",
      keyed({
        p_batch: batchId,
        p_status: ready ? "ready" : "failed",
        p_rejected: r.rejected,
        p_model: r.model,
        p_cost: r.costUsd,
        p_error: ready ? null : (r.error ?? "empty"),
      }),
    );
    if (error) console.error(`study_card_finish ${batchId}: ${error.message}`);
  } catch (e) {
    console.error(`study_card_finish ${batchId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Writes one claimed part (design-cards §3.2, with the review's reservations):
 *  up to two model calls, each reserved before it (the first by the op, before
 *  the stream) and settled after it; every valid card is saved with the server
 *  key and streamed; the part is finished in every case. A refused second
 *  reservation keeps the cards the first call made. A model error is rethrown
 *  (textStream turns it into \u0000ERROR), and so is the reason a part that
 *  made nothing stopped (a refusal, the deadline, a refused second reservation). */
export async function writeCardBatch(o: {
  client: Anthropic;
  sb: SupabaseClient;
  lecture: Lecture;
  batchId: string;
  claim: Claim;
  known: KnownCard[];
  figures: Figure[];
  corrections: Correction[];
  /** C's end: the part's blocks, so each card sits on its paragraph. */
  blocks?: NumberedBlock[];
  stopAt: number; // started + 270_000
  write: (line: string) => void;
  /** The first call's reservation, taken by the op before the stream started. */
  reserved?: number;
  /** The cards key's model (routes.ts; left out: the default). */
  model?: string;
}): Promise<{ made: number; rejected: number; costUsd: number; unsettled: number }> {
  const routed = o.model ?? MODEL;
  const ctx: CardCtx = {
    lectureSlides: new Set(o.lecture.slides.map((s) => s.n)),
    from: o.claim.slide_from,
    to: o.claim.slide_to,
    figures: new Set(o.figures.map((f) => f.id)),
    known: [...o.known],
    blocks: o.blocks ?? [],
  };
  let accepted = 0;
  let made = 0;
  let rejected = 0;
  let costUsd = 0;
  let unsettled = 0;
  let model: string | null = null;
  let error: string | null = null;
  let started = false;
  let reserved = o.reserved;
  let saving: Promise<void> = Promise.resolve();
  const skip = (why: string) => o.write(JSON.stringify({ t: "skip", why }) + "\n");
  try {
    for (let call = 0; call < 2; call++) {
      const want = o.claim.wanted - accepted;
      if (want <= 0 || (call > 0 && Date.now() > o.stopAt - SECOND_CALL_MS)) break;
      const req = cardsCall({ lecture: o.lecture, claim: o.claim, figures: o.figures, corrections: o.corrections, known: ctx.known, blocks: o.blocks }, want);
      let rid: number;
      if (reserved !== undefined) rid = reserved;
      else {
        try {
          rid = await reserve(o.sb, {
            groupId: o.lecture.group_id,
            lectureId: o.lecture.id,
            kind: "cards",
            ref: o.batchId,
            estimateUsd: estimateUsd(routed, req.inputChars, req.maxTokens),
          });
        } catch (e) {
          // A refused second call (the 80% line, the member's share) keeps what the first made.
          if (call > 0 && e instanceof HttpError) {
            error = e.message;
            break;
          }
          throw e;
        }
      }
      reserved = undefined;
      const settleCall = settleFor(o.sb, rid, () => {
        unsettled += 1;
      });
      const res = await generateItems({
        client: o.client,
        model: routed,
        reserveFallback: fallbackReserve(o.sb, { groupId: o.lecture.group_id, lectureId: o.lecture.id, kind: "cards", ref: o.batchId }, () => {
          unsettled += 1;
        }, (sp) => {
          costUsd += sp.costUsd;
          model = sp.model;
        }),
        kind: "cards",
        ref: o.batchId,
        system: req.system,
        messages: req.messages,
        effort: o.claim.effort,
        maxTokens: req.maxTokens,
        stopAt: o.stopAt,
        wrapper: CardSet,
        item: CardItem,
        onStart: () => {
          if (started) return;
          started = true;
          o.write('{"t":"start"}\n');
        },
        onItem: (item, _i, servedBy) => {
          const r = checkCard(item, ctx);
          if (!r.ok || accepted >= o.claim.wanted) {
            rejected += 1;
            skip(r.ok ? "more than asked" : r.reasons[0]);
            return;
          }
          accepted += 1;
          const card = r.item;
          ctx.known.push({ id: "new", kind: card.kind, front: card.front, back: card.back, topic: card.topic, aspect: card.aspect, slides: card.slides });
          saving = saving.then(async () => {
            const { data, error: e } = await o.sb.rpc("study_save_card", keyed({ p_batch: o.batchId, p_card: { ...card, model: servedBy } }));
            if (e) {
              rejected += 1;
              skip(e.message);
              return;
            }
            made += 1;
            o.write(JSON.stringify(toLine(String(data), o.claim.part_idx, card)) + "\n");
          });
        },
        // Settles this call's reservation; the cost and the serving model are
        // kept for the part's row, also when the call then throws.
        ledger: async (s) => {
          costUsd += s.costUsd;
          model = s.model;
          return settleCall(s);
        },
      });
      // Items that were not valid JSON or did not fit the format.
      rejected += res.rejected;
      await saving;
      accepted = made; // a card the database refused frees its place for the second call
      if (res.stop === "refusal") {
        error = "refusal";
        break;
      }
      if (res.timedOut) {
        error = "timeout";
        break;
      }
    }
    // Nothing made, and stopped for a reason (a refusal, the deadline, a refused
    // second reservation): the stream ends with that code, as a part of
    // questions does (§4.6, which §4.7's steps follow), so the round counts it
    // as failed. With cards made, the part is ready and ends with its done line.
    if (made === 0 && error) throw new HttpError(error === "timeout" ? 504 : 502, error);
  } catch (e) {
    error = errorText(e);
    throw e; // textStream turns it into \0ERROR <code>
  } finally {
    await saving.catch(() => undefined);
    // A reservation no call used (nothing was left to write) is settled at $0.
    if (reserved !== undefined) await settle(o.sb, reserved, { model: routed, usage: null });
    await finishBatch(o.sb, o.batchId, { made, rejected, model, costUsd, error, complete: o.claim.wanted <= 0 });
  }
  return { made, rejected, costUsd, unsettled };
}

// ── The op ──

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The model call stops here, before Vercel ends the function at 300 s. */
const TIME_LIMIT_MS = 270_000;
/** Section C of the SQL, at the version this code needs (spec §2.11): C's
 *  end, whose study_save_card places a card on its paragraph. */
const NEEDS: Readonly<Record<string, number>> = { C: 2 };
/** PostgREST's answer for a table that does not exist: study_edits before
 *  package K's section is loaded (newer and older PostgREST). */
const NO_TABLE = new Set(["PGRST205", "42P01"]);
/** study_card_claim's refusals, as HTTP statuses. */
const CLAIM_STATUS: Record<string, number> = { busy: 409, "gave up": 409, "batch not found": 404, forbidden: 403, "not signed in": 401 };

let schemaChecked = false;
/** Once per instance, like assertSchema() for section F: a database without
 *  section C (a merge that came before its SQL) answers 503 "schema". */
async function assertCardsSchema(sb: SupabaseClient): Promise<void> {
  if (schemaChecked) return;
  const { data, error } = await sb.rpc("study_schema");
  if (error) throw new HttpError(500, error.message);
  if (!schemaOk(data, NEEDS)) throw new HttpError(503, "schema");
  schemaChecked = true;
}

type SectionRow = { idx: number; slide_from: number; slide_to: number; status: string; markdown: string; gen: number };

/** The inputs of a part: the lecture's active cards (duplicates and the
 *  covered list), the pictures the ready summary parts captioned in the range
 *  (only ids the lecture has, which study_save_card would refuse otherwise),
 *  and the part's current corrections. */
export async function readInputs(
  sb: SupabaseClient,
  lecture: Lecture,
  claim: Claim,
): Promise<{ known: KnownCard[]; figures: Figure[]; corrections: Correction[]; blocks: NumberedBlock[] }> {
  const [cards, sections] = await Promise.all([
    sb
      .from("study_cards")
      .select("id, kind, front, back, topic, aspect, slides")
      .eq("lecture_id", lecture.id)
      .is("deleted_at", null)
      .order("created_at")
      .order("id"),
    sb.from("study_sections").select("idx, slide_from, slide_to, status, markdown, gen").eq("lecture_id", lecture.id).order("idx"),
  ]);
  if (cards.error) throw new HttpError(500, cards.error.message);
  if (sections.error) throw new HttpError(500, sections.error.message);
  const parts = (sections.data ?? []) as SectionRow[];
  const have = new Set(lecture.slides.flatMap((s) => s.figures.map((f) => `fig:${s.n}-${f.k}`)));
  const figures = figureList(
    parts.filter((p) => p.status === "ready").map((p) => p.markdown),
    claim.slide_from,
    claim.slide_to,
  ).filter((f) => have.has(f.id));
  // The summary part this batch was planned from (a round planned before the
  // outline uses six-slide chunks, which have no corrections).
  const part = parts.find((p) => p.idx === claim.part_idx && p.slide_from === claim.slide_from && p.slide_to === claim.slide_to);
  let corrections: Correction[] = [];
  // C's end: a ready part's paragraphs, so each card sits on one (none for a six-slide chunk).
  const blocks = part && part.status === "ready" && part.markdown.trim() ? numberBlocks(part.markdown) : [];
  if (part) {
    const { data, error } = await sb
      .from("study_edits")
      .select("anchor, rev, before_text, after_text, note")
      .eq("lecture_id", lecture.id)
      .eq("part_idx", part.idx)
      .eq("gen", part.gen)
      .order("rev");
    if (error && !NO_TABLE.has(error.code)) throw new HttpError(500, error.message);
    corrections = error ? [] : netCorrections((data ?? []) as EditRow[]);
  }
  return { known: (cards.data ?? []) as KnownCard[], figures, corrections, blocks };
}

/** POST /api/study/ai { op: "cards", lectureId, batchId } */
export const cardsOp: Op = async (req, body, started) => {
  // Ids as the database writes them, so the batch's lecture compares as text.
  const lectureId = typeof body.lectureId === "string" ? body.lectureId.toLowerCase() : "";
  const batchId = typeof body.batchId === "string" ? body.batchId.toLowerCase() : "";
  if (!UUID.test(lectureId) || !UUID.test(batchId)) throw new HttpError(400, "lectureId and batchId required");
  const { sb } = await memberClient(req);
  await assertCardsSchema(sb);
  const client = anthropic();
  const lecture = await loadLecture(sb, lectureId);

  // The batch must be this lecture's before it is claimed (a claim spends one of its 3 tries).
  const batch = await sb.from("study_card_batches").select("lecture_id").eq("id", batchId).maybeSingle();
  if (batch.error) throw new HttpError(500, batch.error.message);
  if (!batch.data) throw new HttpError(404, "batch not found");
  if ((batch.data as { lecture_id: string }).lecture_id !== lectureId) throw new HttpError(400, "batch of another lecture");

  const claimed = await sb.rpc("study_card_claim", keyed({ p_batch: batchId }));
  if (claimed.error) throw new HttpError(CLAIM_STATUS[claimed.error.message] ?? 500, claimed.error.message);
  const row = (Array.isArray(claimed.data) ? claimed.data[0] : claimed.data) as Claim | null | undefined;
  if (!row) throw new HttpError(500, "no claim");
  const claim: Claim = { ...row, effort: row.effort === "low" ? "low" : "medium" };

  // From here the part is this request's: every way out finishes it.
  let inputs: { known: KnownCard[]; figures: Figure[]; corrections: Correction[]; blocks: NumberedBlock[] };
  let reserved: number | undefined;
  let model: string;
  try {
    [inputs, model] = await Promise.all([readInputs(sb, lecture, claim), modelFor(sb, lecture.group_id, "cards")]);
    if (claim.wanted > 0) {
      const first = cardsCall({ lecture, claim, ...inputs }, claim.wanted);
      reserved = await reserve(sb, {
        groupId: lecture.group_id,
        lectureId,
        kind: "cards",
        ref: batchId,
        estimateUsd: estimateUsd(model, first.inputChars, first.maxTokens),
      });
    }
  } catch (e) {
    await finishBatch(sb, batchId, { made: 0, rejected: 0, model: null, costUsd: 0, error: errorText(e), complete: claim.wanted <= 0 });
    throw e;
  }

  return textStream(async (write) => {
    // A phone that closed the stream stops reading, not writing: the cards are
    // still saved for the group and the part is finished.
    const out = (line: string) => {
      try {
        write(line);
      } catch {
        /* the stream is gone */
      }
    };
    const r = await writeCardBatch({ client, sb, lecture, batchId, claim, ...inputs, stopAt: started + TIME_LIMIT_MS, write: out, reserved, model });
    out(JSON.stringify({ t: "done", made: r.made, rejected: r.rejected, costUsd: Math.round(r.costUsd * 1e6) / 1e6, unsettled: r.unsettled }) + "\n");
  });
};
