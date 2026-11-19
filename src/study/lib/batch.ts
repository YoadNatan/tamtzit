/* ── The batch upload's resume list (sources.md B6.8, "העלאה של כמה קבצים") ──
 *
 * A batch of 14 lectures takes minutes on a phone, and a phone that locks or
 * a tab that is closed stops it half way. Before the first file goes, the
 * screen writes the list here (localStorage, per group): the course and every
 * file's name, size and date, each with `done` once its lecture is saved.
 * Just before a lecture is inserted, its new id is written too: a tab killed
 * while the insert was on its way finds out, on its return, whether the
 * lecture got there (study_lectures has the id) instead of uploading it twice.
 *
 * On return the screen says "הועלו 3. נשארו 11 קבצים · לבחור אותם שוב". The
 * phone cannot keep the files themselves, so they are picked again; a file
 * matches an entry by name and size, and the ones already up are skipped.
 *
 * Pure but for the four storage calls, each in try/catch: private mode or a
 * full storage leaves the batch working, only without the resume. */

export type BatchFile = {
  name: string;
  size: number;
  lastModified: number;
  type: "lecture";
  done: boolean;
  /** The lecture's id, written just before its insert. */
  id?: string;
};
export type Batch = { v: 1; course: string; courseId: string | null; at: number; files: BatchFile[] };
/** What the picker gives (a File has these). */
export type FileLike = { name: string; size: number; lastModified: number };

/** A batch older than this is forgotten. */
export const BATCH_DAYS = 14;
/** At most this many files at a time. */
export const BATCH_MAX = 30;

export const batchKey = (groupId: string) => `study.batch.${groupId}`;

function valid(x: unknown, now: number): x is Batch {
  if (!x || typeof x !== "object") return false;
  const b = x as Batch;
  return (
    b.v === 1 &&
    typeof b.course === "string" &&
    typeof b.at === "number" &&
    now - b.at <= BATCH_DAYS * 86_400_000 &&
    Array.isArray(b.files) &&
    b.files.every((f) => f && typeof f.name === "string" && typeof f.size === "number" && typeof f.done === "boolean")
  );
}

export function readBatch(groupId: string, now = Date.now()): Batch | null {
  try {
    const raw = JSON.parse(localStorage.getItem(batchKey(groupId)) ?? "null") as unknown;
    return valid(raw, now) ? raw : null;
  } catch {
    return null;
  }
}
export function writeBatch(groupId: string, b: Batch): void {
  try {
    localStorage.setItem(batchKey(groupId), JSON.stringify(b));
  } catch {
    /* private mode or full: no resume, the batch goes on */
  }
}
export function clearBatch(groupId: string): void {
  try {
    localStorage.removeItem(batchKey(groupId));
  } catch {
    /* nothing kept */
  }
}

export function newBatch(course: string, courseId: string | null, files: FileLike[], now = Date.now()): Batch {
  return {
    v: 1,
    course,
    courseId,
    at: now,
    files: files.map((f) => ({ name: f.name, size: f.size, lastModified: f.lastModified, type: "lecture" as const, done: false })),
  };
}

export const sameFile = (e: Pick<BatchFile, "name" | "size">, f: FileLike) => e.name === f.name && e.size === f.size;

/** The entries still to upload. */
export const remaining = (b: Batch) => b.files.filter((f) => !f.done);
export const uploaded = (b: Batch) => b.files.filter((f) => f.done);

/** A copy with one entry changed (the entry that matches the file). */
export function markFile(b: Batch, f: FileLike, patch: Partial<Pick<BatchFile, "done" | "id">>): Batch {
  return { ...b, files: b.files.map((e) => (sameFile(e, f) ? { ...e, ...patch } : e)) };
}

/** Entries whose lecture got there although the tab stopped before it said
 *  so (their id is among the group's lectures) are done. */
export function settle(b: Batch, lectureIds: ReadonlySet<string>): { batch: Batch; landed: BatchFile[] } {
  const landed = b.files.filter((e) => !e.done && e.id && lectureIds.has(e.id));
  if (!landed.length) return { batch: b, landed };
  return { batch: { ...b, files: b.files.map((e) => (landed.includes(e) ? { ...e, done: true } : e)) }, landed };
}

/** Files picked again for a batch that stopped: the ones it still needs, the
 *  ones already up (skipped), and new ones it never had. */
export function pickAgain<F extends FileLike>(b: Batch, files: readonly F[]): { todo: F[]; already: F[]; extra: F[] } {
  const todo: F[] = [];
  const already: F[] = [];
  const extra: F[] = [];
  for (const f of files) {
    const e = b.files.find((x) => sameFile(x, f));
    if (!e) extra.push(f);
    else if (e.done) already.push(f);
    else if (!todo.some((t) => sameFile(t, f))) todo.push(f);
  }
  return { todo, already, extra };
}

/** "הועלו 3. נשארו 11 קבצים" (one left: "נשאר קובץ אחד"). */
export function resumeLine(b: Batch): string {
  const done = uploaded(b).length;
  const left = remaining(b).length;
  const leftWords = left === 1 ? "נשאר קובץ אחד" : `נשארו ${left} קבצים`;
  return done ? `${done === 1 ? "הועלה קובץ אחד" : `הועלו ${done}`}. ${leftWords}` : leftWords;
}
