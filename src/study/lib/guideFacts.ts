import { courseKey } from "../../../shared/study/courseKey";
import { writingHelp } from "../features/writing";
import type { Ctx } from "../features/types";
import { listLectures, members } from "./api";
import { flags } from "./flags";
import type { Facts } from "./guide";
import { sessionCounts } from "./practice2";

/* ── What the guide knows of the group (docs/study/guide.md) ──
 * Only the app's existing reads: the lectures (and the courses their course
 * texts make), the members and, with
 * practice, the session counts (how many questions each lecture has). No
 * write, no new RPC, no AI. One read at a time per group, kept for 20 s. */

let cache: { group: string; at: number; facts: Promise<Facts> } | null = null;

export function guideFacts(ctx: Ctx, fresh = false): Promise<Facts> {
  if (!fresh && cache && cache.group === ctx.group.id && Date.now() - cache.at < 20_000) return cache.facts;
  const facts = (async (): Promise<Facts> => {
    const [lectures, people] = await Promise.all([listLectures(ctx.group.id), members(ctx.group.id).catch(() => [])]);
    const ready = lectures.filter((l) => l.status === "ready").map((l) => l.id);
    const writing = lectures.filter((l) => l.status !== "ready" && l.status !== "failed").length;
    let practiceLecture: string | null = null;
    if (flags.practice && ready.length) {
      const counts = await sessionCounts(ready.slice(0, 20)).catch(() => []);
      practiceLecture = ready.find((id) => counts.some((c) => c.lecture_id === id && c.n > 0)) ?? null;
    }
    // The courses the library links to: the lectures' course texts, as the course pages match them.
    const courses = new Set(lectures.map((l) => courseKey(l.course ?? "")).filter(Boolean)).size;
    return { lectures: lectures.length, ready, writing, members: people.length, practiceLecture, queue: null, serverWrites: writingHelp().serverWrites, courses };
  })();
  cache = { group: ctx.group.id, at: Date.now(), facts };
  facts.catch(() => {
    if (cache?.facts === facts) cache = null;
  });
  return facts;
}
