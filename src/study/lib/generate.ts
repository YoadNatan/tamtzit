import { getSections, isStuck, runOutline } from "./api";
import { getRecordingNotes, runSection } from "./writing";

/* ── Writing a lecture's summary from this phone ──
 *
 * 1. /api/study/outline splits the lecture into parts (once).
 * 2. The first part is written alone: it puts the lecture text into the API's
 *    prompt cache, and parts started together cannot read each other's cache
 *    writes. The rest are then written two at a time: quick, but few enough not
 *    to trip the per-minute limits of a new API key.
 *
 * Whoever has the lecture open drives this when the server does not write
 * it (spec §2.3). Every part is claimed on the server first, from the same
 * queue the server writer uses: a part another writer holds answers "busy",
 * which is not a failure. Such parts are counted, skipped, and looked at once
 * more after 20 s, in case they became free (a writer that died). A part left
 * "writing" past its lease counts as stuck and is written again.
 *
 * Some failures end the whole run instead of failing part after part: the
 * group's monthly budget, the server key or the database (forbidden, schema),
 * a switched-off feature, a missing or wrong API key, a lost session, and a
 * lecture deleted while it is written (the writing is cancelled: the server
 * claims nothing of a deleted lecture, so every other part would only fail
 * the same way).
 */

type Options = {
  onLive: (idx: number, text: string) => void;
  onChange: () => void;
  concurrency?: number;
};

const FATAL = new Set([
  "budget",
  "member_share",
  "off",
  "forbidden",
  "schema",
  "bad_api_key",
  "missing ANTHROPIC_API_KEY",
  "missing STUDY_WORKER_KEY",
  "not signed in",
  "session expired",
  "lecture not found",
]);
/** Someone else writes it: not a failure. */
const ELSEWHERE = new Set(["busy", "lease_lost"]);
/** How long a part another writer held waits before it is looked at again. */
export const BUSY_RECHECK_MS = 20_000;

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Writes `ids`: the first alone, then `width` at a time; busy ones are
 *  retried once after BUSY_RECHECK_MS if `stillDue` says so. Exported for
 *  its tests. */
export async function writeRound(
  ids: number[],
  one: (idx: number) => Promise<void>,
  stillDue: (busy: number[]) => Promise<number[]>,
  onChange: () => void,
  width: number,
): Promise<{ failed: number; busy: number }> {
  let failed = 0;
  const busy = new Set<number>();
  let fatal: Error | null = null;
  const queue: number[] = [];
  const writeOne = async (idx: number) => {
    try {
      await one(idx);
      busy.delete(idx);
    } catch (e) {
      const code = codeOf(e);
      if (ELSEWHERE.has(code)) busy.add(idx);
      else {
        failed += 1;
        if (FATAL.has(code)) {
          fatal = e as Error;
          queue.length = 0;
        }
      }
    }
    onChange();
  };
  const drain = async (list: number[]) => {
    queue.push(...list);
    const first = queue.shift();
    if (first !== undefined) await writeOne(first);
    const worker = async () => {
      for (let idx = queue.shift(); idx !== undefined; idx = queue.shift()) await writeOne(idx);
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(width, queue.length)) }, worker));
  };
  await drain(ids);
  if (!fatal && busy.size) {
    await wait(BUSY_RECHECK_MS);
    const again = await stillDue([...busy]);
    if (again.length) await drain(again);
  }
  if (fatal) throw fatal;
  return { failed, busy: busy.size };
}

/** Writes the lecture's outline (if it has none) and every part that is
 *  pending, failed or stuck. */
export async function generate(lectureId: string, opts: Options): Promise<{ failed: number; busy: number }> {
  let sections = await getSections(lectureId);
  if (!sections.length) {
    try {
      await runOutline(lectureId);
    } catch (e) {
      if (codeOf(e) !== "busy") throw e;
      // Another writer is outlining it: its parts appear soon.
      await wait(BUSY_RECHECK_MS);
      sections = await getSections(lectureId);
      opts.onChange();
      if (!sections.length) return { failed: 0, busy: 1 };
    }
    sections = await getSections(lectureId);
    opts.onChange();
  }
  const due = (s: (typeof sections)[number]) => s.status === "pending" || s.status === "failed" || isStuck(s);
  return writeRound(
    sections.filter(due).map((s) => s.idx),
    (idx) => runSection(lectureId, idx, (text) => opts.onLive(idx, text)),
    async (busy) => (await getSections(lectureId)).filter((s) => busy.includes(s.idx) && (s.status === "pending" || isStuck(s))).map((s) => s.idx),
    opts.onChange,
    opts.concurrency ?? 2,
  );
}

/** Writes the recording's notes of every part that waits for them, the same
 *  way (kind "notes"): the first alone, then two at a time. */
export async function generateNotes(lectureId: string, opts: Options): Promise<{ failed: number; busy: number }> {
  const stuck = (n: { status: string; lease_until: string | null }) => n.status === "writing" && Boolean(n.lease_until) && Date.parse(n.lease_until as string) < Date.now() - 30_000;
  const due = (n: { status: string; lease_until: string | null }) => n.status === "pending" || n.status === "failed" || stuck(n);
  const rows = await getRecordingNotes(lectureId);
  return writeRound(
    rows.filter(due).map((n) => n.part_idx),
    (idx) => runSection(lectureId, idx, (text) => opts.onLive(idx, text), "notes"),
    async (busy) => (await getRecordingNotes(lectureId)).filter((n) => busy.includes(n.part_idx) && (n.status === "pending" || stuck(n))).map((n) => n.part_idx),
    opts.onChange,
    opts.concurrency ?? 2,
  );
}
