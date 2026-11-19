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
import { prepareUnit, rpcStore, writerTiming, type Part } from "../../server/study/writer.js";

/* POST /api/study/outline  { lectureId }
 * Splits the lecture into consecutive parts (3–8 slides each, along the
 * lecture's topics) and answers with { parts } at the end of a text stream.
 * Each part is then written by /api/study/section, or by the server writer.
 *
 * The device path (spec §4.3.4): the outline is claimed through study_claim
 * with the member's token and the server key, like every unit, so it is
 * never written twice. When nothing is claimed, the lecture already has its
 * parts (answered as they are, so an old phone carries on) or another writer
 * is outlining it (409 "busy"). The call's worst case is reserved first; a
 * refusal ends the outline with its code and answers 402/429/403 before any
 * stream. study_outline_done inserts the parts once and settles the
 * reservation (a parse that threw keeps its estimate: review FE-24). */

// Node.js runtime (see health.ts): up to 300 s with Fluid compute, also on Hobby.
export const config = { maxDuration: 300 };

async function handler(req: Request): Promise<Response> {
  const started = Date.now();
  try {
    const { lectureId } = await readBody<{ lectureId?: string }>(req);
    if (!lectureId || typeof lectureId !== "string") throw new HttpError(400, "lectureId missing");
    const { sb } = await memberClient(req);
    await assertSchema(sb);
    await loadLecture(sb, lectureId); // 404 for another group's lecture or a deleted one
    const store = rpcStore(sb, serverKey());
    const unit = await store.claim(lectureId, { kind: "outline" });
    if (!unit) {
      const { data, error } = await sb.from("study_sections").select("idx, title, slide_from, slide_to").eq("lecture_id", lectureId).order("idx");
      if (error) throw new HttpError(500, error.message);
      const rows = (data ?? []) as Array<{ title: string; slide_from: number; slide_to: number }>;
      if (!rows.length) throw new HttpError(409, "busy");
      const parts: Part[] = rows.map((r) => ({ heading: r.title, from: r.slide_from, to: r.slide_to }));
      return textStream(async (write) => write(JSON.stringify({ parts })));
    }
    const prep = await prepareUnit(store, lectureId, unit, { stopAt: started + writerTiming.deviceMs });
    if ("done" in prep) throw prep.done.refused ?? new HttpError(500, prep.done.error ?? "outline");
    return textStream(async (write) => {
      const r = await prep.run();
      if (r.status !== "ready" || !r.parts) throw new HttpError(500, r.error ?? "outline");
      write(JSON.stringify({ parts: r.parts }));
    });
  } catch (e) {
    return json(e instanceof HttpError ? e.status : 500, { error: errorText(e) });
  }
}

export default { fetch: handler };
