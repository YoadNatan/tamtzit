import {
  assertSchema,
  errorText,
  HttpError,
  json,
  loadLecture,
  memberClient,
  readBody,
  serverKey,
  textStream,
} from "../../server/study/study.js";
import { prepareUnit, rpcStore, writerTiming } from "../../server/study/writer.js";

/* POST /api/study/section  { lectureId, idx, kind?: "part" | "notes" }
 * Writes one part of the summary (or, with kind "notes", that part's notes
 * from the recording) from a member's phone. The text streams back as it is
 * written; the group sees it grow too (study_progress every ~15 s) and it is
 * saved through study_finish when the model finishes.
 *
 * The device path (spec §4.3.4): the part is claimed through study_claim
 * with the member's token and the server key, from the same queue as the
 * server writer, so two writers never write one part: a part someone else
 * holds answers 409 "busy", which generate.ts treats as "someone else is
 * writing it". Pictures come from the queue's 48-hour links when the server
 * signed them, else they are signed here for 30 minutes. The part's
 * corrections (study_part_corrections, read after the claim) go to the
 * writer, so a rewrite keeps them. The call's worst case is reserved before
 * the stream starts: a refusal ("budget") answers 402 there, so generate.ts
 * stops the run, and the reservation is settled by study_finish (p_charge).
 *
 * Vercel ends a function after 300 s. A part still being written at 270 s
 * is stopped and saved as failed ("timeout"); the next try writes it at
 * medium effort, which finishes sooner. A failed unit ends the stream with
 * "\u0000ERROR <code>". */

// Node.js runtime (see health.ts): up to 300 s with Fluid compute, also on Hobby.
export const config = { maxDuration: 300 };

/** Pictures signed here are good for 30 minutes, as before. */
const SIGN_SECONDS = 60 * 30;

async function handler(req: Request): Promise<Response> {
  const started = Date.now();
  try {
    const { lectureId, idx, kind = "part" } = await readBody<{ lectureId?: string; idx?: number; kind?: string }>(req);
    if (!lectureId || typeof lectureId !== "string" || typeof idx !== "number" || !Number.isInteger(idx)) {
      throw new HttpError(400, "lectureId and idx required");
    }
    if (kind !== "part" && kind !== "notes") throw new HttpError(400, "bad request");
    const { sb } = await memberClient(req);
    await assertSchema(sb);
    await loadLecture(sb, lectureId); // 404 for another group's lecture or a deleted one
    const store = rpcStore(sb, serverKey());
    const unit = await store.claim(lectureId, { kind, idx });
    if (!unit) throw new HttpError(409, "busy");

    const prep = await prepareUnit(store, lectureId, unit, {
      stopAt: started + writerTiming.deviceMs,
      signFigures: async (paths) => {
        const out: Record<string, string> = {};
        try {
          const { data } = await sb.storage.from("study").createSignedUrls(paths, SIGN_SECONDS);
          for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
        } catch {
          /* a picture that cannot be signed is left out */
        }
        return out;
      },
      corrections: async (part) => {
        const { data, error } = await sb.rpc("study_part_corrections", { p_lecture: lectureId, p_part: part });
        if (error) throw new HttpError(error.message === "forbidden" ? 403 : 500, error.message);
        return data;
      },
    });
    if ("done" in prep) {
      if (prep.done.refused) throw prep.done.refused;
      const code = prep.done.error ?? "writer";
      return textStream(async () => {
        throw new HttpError(500, code);
      });
    }
    return textStream(async (write) => {
      let sent = 0;
      const r = await prep.run((all) => {
        if (all.length > sent) write(all.slice(sent));
        sent = all.length;
      });
      if (r.status === "failed") throw new HttpError(r.error === "timeout" ? 504 : 500, r.error ?? "writer");
    });
  } catch (e) {
    return json(e instanceof HttpError ? e.status : 500, { error: errorText(e) });
  }
}

export default { fetch: handler };
