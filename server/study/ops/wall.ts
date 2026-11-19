import type { SupabaseClient } from "@supabase/supabase-js";
import { blockSources } from "../../../shared/study/edits.js";
import { usesLeft } from "../ask.js";
import { estimateUsd, reserve } from "../budget.js";
import { settleFor } from "../claude.js";
import { DAILY_DRAFTS, WALL_CHECK_CHARS, WALL_CHECK_MAX_TOKENS, WALL_DRAFTS_MAX_TOKENS, WALL_TIME_LIMIT_MS } from "../limits.js";
import { mnemonicSource } from "../mnemonic.js";
import { checkRequest, draftsRequest, WALL_CHECK_SYSTEM, WALL_DRAFTS_SYSTEM } from "../prompts/wall.js";
import { anthropic, deckText, HttpError, json, keyed, loadLecture, memberClient, MODEL, serverKey, slideText, textStream, tidyMarkdown, type StoredSlide } from "../study.js";
import { checkCall, draftSlides, paragraphHash, streamDrafts } from "../wall.js";
import type { Op } from "./types.js";

/* ── Package J's ops (spec §12.5.J): "mnemonic" (the wall's drafts) and
 *  "wall_check" (the would-be winner against its paragraph) ──
 *
 * op "mnemonic" { lectureId, part, anchor, gen } → NDJSON:
 *  1. member; the part ready (409 "part busy") and of the phone's generation
 *     (409 "part rewritten"); the block at `anchor` (an uneditable one: 400
 *     "bad block"); src_hash = sha256 of the block's text;
 *  2. drafts already saved for (lecture, part, anchor, hash), read with the
 *     member's token: {"t":"saved", id, fact, slides, drafts, left} and
 *     stop: no reservation, no call, $0, and the day's 5 untouched;
 *  3. else study_aid_drafts_begin(lecture, part, anchor, hash, key) holds
 *     the text for 2 minutes BEFORE anything is reserved (review SEC4-3:
 *     409 "busy" to a second phone at the same moment, which pays nothing;
 *     "saved" when another phone's drafts landed in between: answered as
 *     in 2); then reserve (kind "mnemonic", ref "<part>.<anchor>", 5 a day: 429
 *     "daily_limit"); the source as K's mnemonicSource (the block, or a
 *     heading's topic, and the slides it cites); the call, each draft
 *     streamed as it closes {"t":"d","d":{technique,hook,decode}} or
 *     {"t":"skip","why"}; the fact checked once the answer is whole;
 *     study_aid_drafts_save with the server key; settled in `finally`;
 *     {"t":"done", id, fact, slides, made, rejected, left}.
 *  No draft passed or no fact: the call is settled and the stream ends
 *  with "\u0000ERROR empty" (nothing is saved, so a retry may pay again).
 *  Saving clears the hold; anything that fails after it (a refused
 *  reservation, a call that did not finish) gives it back
 *  (study_aid_drafts_end), so a retry need not wait.
 *
 * op "wall_check" { aidId } → JSON { ok, problem, next }:
 *  1. member; study_aid_check_begin(aid, key) holds the entry for 2 minutes
 *     BEFORE anything is reserved (409 "busy", 409 "checked", 404 "aid not
 *     found");
 *  2. the paragraph's block and the entry's slides (at most 4,000
 *     characters); reserve (kind "wall_check", ref the entry, 20 a day);
 *     one call (effort low, max_tokens 1,000, {ok, problem});
 *  3. study_aid_check_done(aid, ok, problem, key): "not ok" marks the entry
 *     "לא מדויק" by the check; a call that did not finish, or anything that
 *     failed after the hold, gives the entry back unchecked (ok null).
 *  The model never sees a member's name. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nat = (x: unknown, max: number) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max;

type PartRow = { title: string; markdown: string; status: string; gen: number };

async function readPart(sb: SupabaseClient, lectureId: string, idx: number): Promise<PartRow> {
  const { data, error } = await sb.from("study_sections").select("idx, title, markdown, status, gen").eq("lecture_id", lectureId).eq("idx", idx).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "part not found");
  return data as PartRow;
}

/** The database's refusals, with their statuses. */
function refused(message: string): HttpError {
  switch (message) {
    case "busy":
    case "checked":
      return new HttpError(409, message);
    case "aid not found":
    case "lecture not found":
    case "part not found":
      return new HttpError(404, message);
    case "forbidden":
      return new HttpError(403, "forbidden");
    case "not signed in":
      return new HttpError(401, "not signed in");
    default:
      return new HttpError(400, message);
  }
}

type SavedRow = { id: string; fact: string; slides: number[]; drafts: unknown[] };

/** POST /api/study/ai { op: "mnemonic", lectureId, part, anchor, gen } */
export const mnemonicOp: Op = async (req, body, started) => {
  const lectureId = typeof body.lectureId === "string" ? body.lectureId.toLowerCase() : "";
  if (!UUID.test(lectureId) || !nat(body.part, 9999) || !nat(body.anchor, 9999) || !nat(body.gen, 1_000_000)) throw new HttpError(400, "bad request");
  const partIdx = body.part as number;
  const anchor = body.anchor as number;
  const { sb } = await memberClient(req);
  serverKey(); // 500 before anything is read or reserved
  const lecture = await loadLecture(sb, lectureId);
  const part = await readPart(sb, lectureId, partIdx);
  if (part.status !== "ready") throw new HttpError(409, "part busy");
  if (part.gen !== body.gen) throw new HttpError(409, "part rewritten");
  const blocks = blockSources(tidyMarkdown(part.markdown ?? ""));
  const source = mnemonicSource(blocks, anchor, lecture.slides, (s: StoredSlide) => slideText(s));
  if (!source) throw new HttpError(400, "bad block");
  const hash = await paragraphHash(blocks[anchor].text);
  const ref = `${partIdx}.${anchor}`;

  // The same text's drafts are the group's already: $0, nothing reserved.
  const readSaved = async () => {
    const prior = await sb
      .from("study_aid_drafts")
      .select("id, fact, slides, drafts")
      .eq("lecture_id", lectureId)
      .eq("part_idx", partIdx)
      .eq("anchor", anchor)
      .eq("src_hash", hash)
      .maybeSingle();
    if (prior.error) throw new HttpError(500, prior.error.message);
    return prior.data as SavedRow | null;
  };
  const answerSaved = async (row: SavedRow) => {
    const left = await usesLeft(sb, lecture.group_id, "mnemonic", null, DAILY_DRAFTS);
    return textStream(async (write) => {
      write(JSON.stringify({ t: "saved", id: row.id, fact: row.fact, slides: row.slides, drafts: row.drafts, left }) + "\n");
    });
  };
  const prior = await readSaved();
  if (prior) return answerSaved(prior);

  // The hold comes before the reservation: a second phone at the same moment pays nothing (review SEC4-3).
  const hold = await sb.rpc("study_aid_drafts_begin", keyed({ p_lecture: lectureId, p_part: partIdx, p_anchor: anchor, p_hash: hash }));
  if (hold.error) {
    if (hold.error.message === "busy") throw new HttpError(409, "busy");
    throw refused(hold.error.message);
  }
  if (hold.data === "saved") {
    const row = await readSaved();
    if (row) return answerSaved(row);
    throw new HttpError(409, "busy");
  }
  const release = async () => {
    try {
      const r = await sb.rpc("study_aid_drafts_end", keyed({ p_lecture: lectureId, p_part: partIdx, p_anchor: anchor, p_hash: hash }));
      if (r.error) console.error("study_aid_drafts_end", r.error.message);
    } catch {
      /* the hold expires in 2 minutes */
    }
  };

  const request = draftsRequest({ lectureTitle: lecture.title, course: lecture.course, partHeading: part.title, target: source.target, slides: source.slides });
  let reservation: Awaited<ReturnType<typeof reserve>>;
  let client: ReturnType<typeof anthropic>;
  try {
    client = anthropic();
    reservation = await reserve(sb, {
      groupId: lecture.group_id,
      lectureId,
      kind: "mnemonic",
      ref,
      estimateUsd: estimateUsd(MODEL, WALL_DRAFTS_SYSTEM.length + request.length, WALL_DRAFTS_MAX_TOKENS),
    });
  } catch (e) {
    await release();
    throw e;
  }

  return textStream(async (raw) => {
    // A phone that closed the stream stops reading; the call is still settled.
    const write = (line: string) => {
      try {
        raw(line);
      } catch {
        /* the stream is gone */
      }
    };
    let unsettled = 0;
    let saved = false;
    try {
      const r = await streamDrafts({
        client,
        ref,
        request,
        target: source.target,
        source: source.target + "\n" + source.slides,
        lectureText: deckText(lecture),
        stopAt: started + WALL_TIME_LIMIT_MS,
        write,
        signal: req.signal,
        ledger: settleFor(sb, reservation, () => {
          unsettled += 1;
        }),
      });
      if (!r.drafts.length || !r.fact) {
        if (r.stop === "refusal") throw new HttpError(502, "refusal");
        if (r.timedOut) throw new HttpError(504, "timeout");
        throw new HttpError(502, "empty");
      }
      const slides = draftSlides(r.fact, source.target, lecture.slides.map((s) => s.n));
      const save = await sb.rpc(
        "study_aid_drafts_save",
        keyed({ p_lecture: lectureId, p_part: partIdx, p_anchor: anchor, p_hash: hash, p_fact: r.fact, p_slides: slides, p_drafts: r.drafts, p_model: r.model }),
      );
      if (save.error) throw refused(save.error.message);
      saved = true;
      const left = await usesLeft(sb, lecture.group_id, "mnemonic", null, DAILY_DRAFTS);
      write(JSON.stringify({ t: "done", id: save.data as string, fact: r.fact, slides, made: r.drafts.length, rejected: r.rejected, left, unsettled }) + "\n");
    } finally {
      if (!saved) await release();
    }
  });
};

type Begun = { lecture_id: string; part: number; anchor: number; kind: string; body: string; fact: string; slides: number[]; group_id: string };

/** POST /api/study/ai { op: "wall_check", aidId } */
export const wallCheckOp: Op = async (req, body, started) => {
  const aid = typeof body.aidId === "string" && UUID.test(body.aidId) ? body.aidId.toLowerCase() : null;
  if (!aid) throw new HttpError(400, "bad request");
  const { sb } = await memberClient(req);
  // The hold comes first: a second phone pays nothing.
  const hold = await sb.rpc("study_aid_check_begin", keyed({ p_aid: aid }));
  if (hold.error) throw refused(hold.error.message);
  const b = hold.data as Begun;
  const giveBack = async () => {
    await sb.rpc("study_aid_check_done", keyed({ p_aid: aid, p_ok: null, p_note: "" }));
  };
  try {
    const lecture = await loadLecture(sb, b.lecture_id);
    const part = await readPart(sb, b.lecture_id, b.part);
    const block = blockSources(tidyMarkdown(part.markdown ?? ""))[b.anchor];
    if (!block?.text?.trim()) throw new HttpError(409, "part busy"); // rewritten under the entry: checked later
    const nums = [...new Set([...(b.slides ?? [])])];
    const slides = lecture.slides
      .filter((s) => nums.includes(s.n))
      .map(slideText)
      .join("\n\n");
    const paragraph = block.text.trim().slice(0, WALL_CHECK_CHARS);
    const request = checkRequest({ paragraph, slides: slides.slice(0, Math.max(0, WALL_CHECK_CHARS - paragraph.length)), aid: b.body, fact: b.fact });
    const reservation = await reserve(sb, {
      groupId: lecture.group_id,
      lectureId: lecture.id,
      kind: "wall_check",
      ref: aid,
      estimateUsd: estimateUsd(MODEL, WALL_CHECK_SYSTEM.length + request.length, WALL_CHECK_MAX_TOKENS),
    });
    const r = await checkCall({
      client: anthropic(),
      ref: aid,
      request,
      stopAt: started + WALL_TIME_LIMIT_MS,
      ledger: settleFor(sb, reservation),
      signal: req.signal,
    });
    if (!r.verdict) {
      await giveBack();
      throw new HttpError(r.timedOut ? 504 : 502, r.stop === "refusal" ? "refusal" : r.timedOut ? "timeout" : "truncated");
    }
    const done = await sb.rpc("study_aid_check_done", keyed({ p_aid: aid, p_ok: r.verdict.ok, p_note: r.verdict.problem }));
    if (done.error) throw refused(done.error.message);
    return json(200, { ok: r.verdict.ok, problem: r.verdict.problem, next: (done.data as string | null) ?? null });
  } catch (e) {
    // Anything that failed after the hold gives the entry back, unchecked.
    if (!(e instanceof HttpError && ["refusal", "timeout", "truncated"].includes(e.message))) {
      try {
        await giveBack();
      } catch {
        /* the hold expires in 2 minutes */
      }
    }
    throw e;
  }
};
