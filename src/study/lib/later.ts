/* ── Summaries that wait for next month (sources.md B8, "העלאה של כמה קבצים") ──
 *
 * The batch's price card says which summaries do not fit this month's
 * budget ("3 סיכומים יחכו לחודש הבא"). Those lectures are uploaded now but
 * not handed to the writer: handed over, each part would be refused at the
 * cap and the lecture would stay failed, after its outline had already been
 * paid for. Their ids are kept here (localStorage, per group) with the month
 * they were uploaded in (UTC, as the ledger's month), and from the 1st of the
 * next month the library or the course page hands them over (releaseLater).
 * Meanwhile the uploader's phone does not start them by itself when one of
 * them is opened (features/writing.tsx); "התחלת הסיכום" on the lecture still
 * starts one by hand.
 *
 * Small and pure but for the storage calls, each in try/catch, so the entry
 * chunk may import it: nothing is written without VITE_STUDY_COURSES. */

export type LaterItem = { id: string; month: string };

export const laterKey = (groupId: string) => `study.later.${groupId}`;
/** The ledger's month (UTC): "2026-11". */
export const monthOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);

function read(groupId: string): LaterItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(laterKey(groupId)) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is LaterItem => Boolean(x) && typeof x.id === "string" && /^\d{4}-\d{2}$/.test(String(x.month))) : [];
  } catch {
    return [];
  }
}
function write(groupId: string, items: LaterItem[]): void {
  try {
    if (items.length) localStorage.setItem(laterKey(groupId), JSON.stringify(items));
    else localStorage.removeItem(laterKey(groupId));
  } catch {
    /* private mode or full: the lecture waits for a tap on "התחלת הסיכום" */
  }
}

/** This lecture's summary waits for next month. */
export function addLater(groupId: string, id: string, now = Date.now()): void {
  const items = read(groupId);
  if (!items.some((x) => x.id === id)) write(groupId, [...items, { id, month: monthOf(now) }]);
}

/** Whether this lecture's summary is waiting (this month's, not yet due). */
export function isLater(groupId: string, id: string, now = Date.now()): boolean {
  const month = monthOf(now);
  return read(groupId).some((x) => x.id === id && x.month >= month);
}

/** The ones whose month has passed. */
export function dueLater(groupId: string, now = Date.now()): string[] {
  const month = monthOf(now);
  return read(groupId)
    .filter((x) => x.month < month)
    .map((x) => x.id);
}

export function dropLater(groupId: string, ids: readonly string[]): void {
  write(
    groupId,
    read(groupId).filter((x) => !ids.includes(x.id)),
  );
}

let releasing = false;
/** Hands the summaries whose month has passed to the writer, once each:
 *  `queue` answers whether it is settled (queued, or nothing to do: the
 *  lecture is gone or already written); one that throws stays for the next
 *  time. Returns how many were settled. */
export async function releaseLater(groupId: string, queue: (id: string) => Promise<boolean>, now = Date.now()): Promise<number> {
  const due = dueLater(groupId, now);
  if (!due.length || releasing) return 0;
  releasing = true;
  const done: string[] = [];
  try {
    for (const id of due) {
      try {
        if (await queue(id)) done.push(id);
      } catch {
        /* offline or refused: tried again next time */
      }
    }
  } finally {
    dropLater(groupId, done);
    releasing = false;
  }
  return done.length;
}
