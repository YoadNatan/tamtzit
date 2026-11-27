import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockSources } from "../../../shared/study/edits.js";
import { estimateUsd, reserve } from "../budget.js";
import { cleanSchema, run, settleFor } from "../claude.js";
import { TRAP_CHECK_EFFORT, TRAP_CHECK_MAX_TOKENS, TRAP_CHECK_TIME_LIMIT_MS, TRAP_PARAGRAPH_CHARS } from "../limits.js";
import { TRAP_CHECK_SYSTEM, trapRequest } from "../prompts/extras.js";
import { fallbackReserve, modelFor } from "../routes.js";
import { anthropic, HttpError, json, keyed, lectureBlock, loadLecture, memberClient, serverKey, tidyMarkdown } from "../study.js";
import { checkTrap, TrapVerdict, type TrapVerdictRaw } from "../traps.js";
import type { Op } from "./types.js";

/* ── Package E's ops (spec §12.6.E) ──
 *
 * op "trap_check" { draftId } → JSON { ok, problem, questionId }:
 *  1. member; the draft, read with her token (RLS: her own drafts only):
 *     none → 404 "draft not found"; already passed → 409 "checked";
 *  2. the lecture (404 when hidden) and the paragraph the trap is on (the
 *     part's block at its anchor, else the quote she kept; at most 2,000
 *     characters);
 *  3. one reservation (kind "trap_check", ref the draft, 5 a day: 429
 *     "daily_limit"), one structured call (effort medium, max_tokens 2,500,
 *     system TRAP_CHECK_SYSTEM then the lecture, cached; the verdict's
 *     schema), stopped 120 s after the function started and settled in
 *     run()'s `finally`, a failed or stopped call too;
 *  4. checkTrap, then study_trap_checked(draft, …, key) with her token: ok
 *     puts the trap in everyone's bank with no author (the database shuffles
 *     its options with their explanations); not ok keeps the problem on her
 *     draft for "לתקן".
 *  A refusal answers 422 "refusal", a timeout 504, an answer that is no
 *  usable verdict 502 "truncated" (nothing saved; the draft stays as it was).
 *  The model never sees a member's name.
 *
 * op "whoami" ("מי אני?", Q11): design only this week, 501 and no call. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DraftRow = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number | null;
  quote: string;
  vignette: string;
  question: string;
  options: string[];
  answer: number;
  note: string;
  slides: number[];
  state: string;
};

/** The database's refusals of the save, with their statuses. */
function refused(message: string): HttpError {
  switch (message) {
    case "checked":
      return new HttpError(409, "checked");
    case "draft not found":
      return new HttpError(404, "draft not found");
    case "explanations do not match options":
      return new HttpError(502, "truncated"); // checkTrap counted them: this code should never send it
    case "forbidden":
      return new HttpError(403, "forbidden");
    case "not signed in":
      return new HttpError(401, "not signed in");
    default:
      return new HttpError(400, message);
  }
}

async function readDraft(sb: SupabaseClient, id: string): Promise<DraftRow> {
  const { data, error } = await sb
    .from("study_trap_drafts")
    .select("id, lecture_id, part_idx, anchor, quote, vignette, question, options, answer, note, slides, state")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  // Another member's draft is invisible (RLS): the same answer as none.
  if (!data) throw new HttpError(404, "draft not found");
  return data as DraftRow;
}

/** The paragraph the trap is on: the part's block at the anchor, else the quote. */
async function readParagraph(sb: SupabaseClient, d: DraftRow): Promise<string> {
  let text = d.quote ?? "";
  if (d.anchor != null) {
    const { data, error } = await sb.from("study_sections").select("markdown").eq("lecture_id", d.lecture_id).eq("idx", d.part_idx).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    const md = tidyMarkdown((data as { markdown: string | null } | null)?.markdown ?? "");
    const block = md ? blockSources(md)[d.anchor] : undefined;
    if (block?.text?.trim()) text = block.text.trim();
  }
  return text.length > TRAP_PARAGRAPH_CHARS ? text.slice(0, TRAP_PARAGRAPH_CHARS) + "…" : text;
}

/** POST /api/study/ai { op: "trap_check", draftId } */
export const trapCheckOp: Op = async (req, body, started) => {
  const id = typeof body.draftId === "string" && UUID.test(body.draftId) ? body.draftId.toLowerCase() : null;
  if (!id) throw new HttpError(400, "draftId required");
  const { sb } = await memberClient(req);
  serverKey(); // 500 before anything is read or reserved
  const d = await readDraft(sb, id);
  if (d.state === "ok") throw new HttpError(409, "checked");
  const lecture = await loadLecture(sb, d.lecture_id);
  const paragraph = await readParagraph(sb, d);
  const user = trapRequest({
    lectureTitle: lecture.title,
    paragraph,
    vignette: d.vignette,
    question: d.question,
    options: d.options,
    answer: d.answer,
    note: d.note,
    slides: d.slides,
  });
  const deck = lectureBlock(lecture);
  const client = anthropic();
  const model = await modelFor(sb, lecture.group_id, "trap_check");
  const reservation = await reserve(sb, {
    groupId: lecture.group_id,
    lectureId: lecture.id,
    kind: "trap_check",
    ref: d.id,
    estimateUsd: estimateUsd(model, TRAP_CHECK_SYSTEM.length + deck.length + user.length, TRAP_CHECK_MAX_TOKENS),
  });
  let text = "";
  const r = await run({
    client,
    model,
    reserveFallback: fallbackReserve(sb, { groupId: lecture.group_id, lectureId: lecture.id, kind: "trap_check", ref: d.id }),
    kind: "trap_check",
    ref: d.id,
    system: [
      { type: "text", text: TRAP_CHECK_SYSTEM },
      { type: "text", text: deck, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    effort: TRAP_CHECK_EFFORT,
    maxTokens: TRAP_CHECK_MAX_TOKENS,
    stopAt: started + TRAP_CHECK_TIME_LIMIT_MS,
    format: { type: "json_schema", schema: cleanSchema(zodOutputFormat(TrapVerdict).schema as Record<string, unknown>) },
    ledger: settleFor(sb, reservation),
    signal: req.signal,
    onText: (delta) => {
      text += delta;
    },
  });
  if (r.stop === "refusal") throw new HttpError(422, "refusal");
  if (r.stop === "timeout") throw new HttpError(504, "timeout");
  let raw: TrapVerdictRaw | null = null;
  try {
    const parsed = TrapVerdict.safeParse(JSON.parse(text)); // parsed once
    raw = parsed.success ? parsed.data : null;
  } catch {
    raw = null;
  }
  const verdict = raw ? checkTrap(raw, d, new Set(lecture.slides.map((s) => s.n))) : null;
  if (!verdict) throw new HttpError(502, "truncated"); // max_tokens, JSON that is not a verdict, or explanations that break the bank's rules

  const saved = await sb.rpc(
    "study_trap_checked",
    keyed(
      verdict.ok
        ? { p_draft: d.id, p_ok: true, p_problem: "", p_whys: verdict.whys, p_whens: verdict.whens, p_takeaway: verdict.takeaway, p_topic: verdict.topic, p_aspect: verdict.aspect }
        : { p_draft: d.id, p_ok: false, p_problem: verdict.problem, p_whys: [], p_whens: [], p_takeaway: "", p_topic: "", p_aspect: "" },
    ),
  );
  if (saved.error) throw refused(saved.error.message);
  return json(200, verdict.ok ? { ok: true, problem: "", questionId: saved.data as string } : { ok: false, problem: verdict.problem, questionId: null });
};

/** "מי אני?" (Q11): design only this week. */
export const whoamiOp: Op = async () => {
  throw new HttpError(501, "not built");
};
