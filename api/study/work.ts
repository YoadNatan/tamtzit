/// <reference path="../../server/study/env.d.ts" />
import { getDeadline, waitUntil } from "@vercel/functions"; // 3.10.5, pinned
import { pointsAheadStep } from "../../server/study/bank.js";
import { assertSchema, errorText, HttpError, json, serverClient, workerKey } from "../../server/study/study.js";
import { rpcStore, writeUnit, type Unit } from "../../server/study/writer.js";

/* GET  /api/study/work → { worker, secondsLeft }
 * POST /api/study/work  { lectureId }  Authorization: Bearer <STUDY_WORKER_KEY>
 * POST /api/study/work  { points }     the same key: read a written lecture's
 *                                      points to know ahead (package B,
 *                                      server/study/bank.ts; section B's
 *                                      trigger kicks it when the summary is done)
 *
 * The server writer (spec §2.3, §4.3.3). Only pg_net calls it: study_queue
 * kicks it when a lecture is saved or "המשך כתיבה" is tapped, study_finish
 * when a unit is done and the next may start, and the pg_cron sweeper every
 * minute for work that is due. It claims one unit (study_claim, with the
 * server key alone: no member, no service-role key), answers 202 at once so
 * pg_net's 10-second timeout never matters, and writes the unit in
 * waitUntil(): the outline, a part or a part's notes, saved through the RPCs.
 *
 *   401  no key on Vercel, or a wrong header
 *   400  {error:"lectureId"}           bad body ({error:"points"}: a read ahead's)
 *   503  {error:"schema"}              the database is older than this code; nothing claimed
 *   200  {claimed:false}               nothing to claim: a duplicate kick, harmless
 *   202  {claimed:true, kind, idx}     the unit runs on in waitUntil
 *   500  {error}                       the claim failed; the sweeper kicks again
 * A read ahead ({points}) answers 200 {claimed:false} (nothing to read, or
 * skipped: the cap), 202 {claimed:true, parts} (the read runs on in
 * waitUntil), 503 schema (no section B) or 500.
 *
 * The unit stops 25 s before the invocation's deadline (getDeadline(), which
 * includes waitUntil) and never after 270 s, so it is saved in time. A
 * writer that dies anyway leaves its lease to run out (330 s) and the next
 * claim counts it as an attempt. GET proves Fluid compute and 300 s on the
 * live deploy (the smoke test reads secondsLeft). */

// Node.js runtime (see health.ts): up to 300 s with Fluid compute, also on Hobby.
export const config = { maxDuration: 300 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The bearer header carries exactly the key, compared without stopping at
 *  the first difference. */
function keyMatches(header: string | null, key: string): boolean {
  const enc = new TextEncoder();
  const got = enc.encode(header ?? "");
  const want = enc.encode(`Bearer ${key}`);
  let diff = got.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (got[i] ?? 0) ^ want[i];
  return diff === 0;
}

async function handler(req: Request): Promise<Response> {
  const key = workerKey(); // trimmed: pg_net sends Vault's value, which has no stray space or line break
  if (req.method === "GET") {
    const d = getDeadline();
    return json(200, { worker: key.length >= 32, secondsLeft: d ? Math.round((d.getTime() - Date.now()) / 1000) : null });
  }
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (key.length < 32 || !keyMatches(req.headers.get("authorization"), key)) return new Response(null, { status: 401 });
  let lectureId: unknown = "";
  let points: unknown;
  try {
    const body = (await req.json()) as { lectureId?: unknown; points?: unknown };
    lectureId = body.lectureId ?? "";
    points = body.points;
  } catch {
    /* below */
  }
  if (points !== undefined) {
    if (typeof points !== "string" || !UUID.test(points)) return json(400, { error: "points" });
    return pointsAheadStep(points.toLowerCase(), Date.now());
  }
  if (typeof lectureId !== "string" || !UUID.test(lectureId)) return json(400, { error: "lectureId" });
  const id = lectureId;

  const sb = serverClient();
  let unit: Unit | null;
  try {
    await assertSchema(sb); // before the claim: an older database gets no half-written unit
    unit = await rpcStore(sb, key).claim(id);
  } catch (e) {
    return json(e instanceof HttpError && e.status === 503 ? 503 : 500, { error: errorText(e) });
  }
  if (!unit) return json(200, { claimed: false });

  const u = unit;
  const started = Date.now();
  const deadline = getDeadline()?.getTime() ?? started + 300_000;
  const stopAt = Math.min(deadline - 25_000, started + 270_000); // 25 s left to save
  waitUntil(
    writeUnit(rpcStore(sb, key), id, u, { stopAt }).catch((e) => console.error(`study work ${id} ${u.kind}${u.idx ?? ""}: ${errorText(e)}`)),
  );
  return json(202, { claimed: true, kind: u.kind, idx: u.idx });
}

export default { fetch: handler };
