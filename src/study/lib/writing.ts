import type { RealtimeChannel } from "@supabase/supabase-js";
import { isStuck, postStudy, sb, type Lecture, type LectureRow, type Section } from "./api";

/* ── Writing on the server, from the phone's side (spec §2.3, §5.4) ──
 *
 * After a lecture is saved, and on every "המשך כתיבה", the phone hands the
 * writing to the server with study_queue: the slides' pictures go along,
 * signed for 48 hours (the worker has no Storage access of its own), and a
 * tap also starts the failed parts over (at most three times a day). When
 * study_queue answers false (pg_net, pg_cron or the site's address are not
 * set up) the phone writes, as before, through /api/study/outline and
 * /api/study/section, which claim from the same queue as the server.
 *
 * The recording's notes ("מההקלטה") are read here too; recordings themselves
 * are added by package W's recording sheet (W4). */

/** How long the queue's picture links are good for. */
const QUEUE_SECONDS = 48 * 3600;
/** study_queue refuses a map larger than this (300,000 characters). */
const QUEUE_MAX_CHARS = 290_000;
/** Pictures smaller than this on their longer side are thumbnails (as the writer has it). */
const MIN_FIGURE_SIDE = 100;
/** Whether this device has seen the group's server write (uploadNote's line). */
const SERVER_KEY = "study-server-on";

/** Remembers whether the group's server writes, for the upload's note. */
export function rememberServer(on: boolean): void {
  try {
    localStorage.setItem(SERVER_KEY, on ? "1" : "0");
  } catch {
    /* private mode: the note stays the plain one */
  }
}

/** Whether this device last saw the server write (false when unknown). */
export function serverKnownOn(): boolean {
  try {
    return localStorage.getItem(SERVER_KEY) === "1";
  } catch {
    return false;
  }
}

/** The pictures the writer sends with the parts: whole-page renders of a PDF,
 *  the embedded pictures (not thumbnails) of a PowerPoint. */
export function writerFigurePaths(lecture: Pick<Lecture, "source_kind" | "slides">): string[] {
  const pdf = lecture.source_kind === "pdf";
  return lecture.slides.flatMap((s) =>
    (s.figures ?? []).filter((f) => (pdf ? f.k === 0 : f.k >= 1 && (!f.w || Math.max(f.w, f.h) >= MIN_FIGURE_SIDE))).map((f) => f.path),
  );
}

/** Hands the lecture to the server writer: true when the server writes it,
 *  false when the phone should (no server writing, or any error). With
 *  `retryFailed` ("המשך כתיבה") its failed parts start over first, server or
 *  not; a fourth tap in a study day throws Error("retry limit"). A lecture
 *  deleted meanwhile throws Error("lecture not found"): nobody writes it. */
export async function queueWriting(
  lecture: Pick<Lecture, "id" | "source_kind" | "slides">,
  o: { retryFailed?: boolean; figurePaths?: string[] } = {},
): Promise<boolean> {
  if (!sb) return false;
  const paths = o.figurePaths ?? writerFigurePaths(lecture);
  const figures: Record<string, string> = {};
  if (paths.length) {
    try {
      const { data } = await sb.storage.from("study").createSignedUrls(paths, QUEUE_SECONDS);
      let size = 2;
      for (const d of data ?? []) {
        if (!d.path || !d.signedUrl) continue;
        size += d.path.length + d.signedUrl.length + 6;
        if (size > QUEUE_MAX_CHARS) break; // the rest are signed by the phone that writes them
        figures[d.path] = d.signedUrl;
      }
    } catch {
      /* no fresh links: the queue keeps the ones it has */
    }
  }
  const { data, error } = await sb.rpc("study_queue", {
    p_lecture: lecture.id,
    p_figures: figures,
    p_until: new Date(Date.now() + QUEUE_SECONDS * 1000).toISOString(),
    p_retry_failed: o.retryFailed === true,
  });
  if (error) {
    if (error.message === "retry limit" || error.message === "lecture not found") throw new Error(error.message);
    return false;
  }
  const on = data === true;
  rememberServer(on);
  return on;
}

/** Work the server should be doing now: the outline, a pending part, a part
 *  whose writer's lease ran out, or a failed part whose retry time came. */
function workDue(l: Pick<LectureRow, "status">, ss: Section[], now: number): boolean {
  if (!ss.length) return l.status === "new" || l.status === "outlining" || l.status === "writing";
  return ss.some(
    (s) =>
      s.status === "pending" ||
      isStuck(s, now) ||
      (s.status === "failed" && (s.attempts ?? 0) < 4 && Boolean(s.retry_at) && Date.parse(s.retry_at as string) <= now),
  );
}

/** The server was handed the lecture but has done nothing for 3 minutes
 *  while work waits (pg_net or the worker is down): the page that has the
 *  lecture open writes it from the device (design-platform §1.A step 6). The
 *  device path claims too, so it never collides with a server that wakes up. */
export function serverSilent(l: Pick<LectureRow, "status" | "updated_at" | "queued_at">, ss: Section[], now = Date.now()): boolean {
  if (!l.queued_at || !workDue(l, ss, now)) return false;
  const due = ss.map((s) => (s.retry_at && Date.parse(s.retry_at) <= now ? s.retry_at : null));
  const times = [l.updated_at, l.queued_at, ...ss.map((s) => s.updated_at), ...due]
    .filter((t): t is string => Boolean(t))
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t));
  return times.length > 0 && now - Math.max(...times) > 3 * 60_000;
}

/** Reads a streamed answer of /api/study/section (a U+200B first byte, the
 *  text, and a failure as "\n\u0000ERROR <code>"). */
async function readText(res: Response, onText?: (all: string) => void): Promise<string> {
  if (!res.ok || !res.body) {
    let msg = `http_${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let all = "";
  const check = (final: boolean) => {
    const shown = all.replace(/^​/, "");
    const err = shown.indexOf("\u0000ERROR");
    if (err >= 0) throw new Error(shown.slice(err + 7).trim() || "error");
    if (!final) onText?.(shown);
    return shown;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    all += dec.decode(value, { stream: true });
    check(false);
  }
  all += dec.decode();
  return check(true);
}

/** Writes one part (or, with kind "notes", that part's notes) from this
 *  phone; throws Error("busy") when another writer holds it. */
export async function runSection(lectureId: string, idx: number, onText: (text: string) => void, kind: "part" | "notes" = "part"): Promise<void> {
  await readText(await postStudy("/api/study/section", kind === "part" ? { lectureId, idx } : { lectureId, idx, kind }), onText);
}

/* ── The recording and its notes (read here; added by W4's sheet) ── */

export type Recording = {
  id: string;
  lecture_id: string;
  source: "file" | "paste" | "browser";
  source_name: string;
  link_url: string | null;
  duration_s: number | null;
  has_times: boolean;
  status: "transcribing" | "ready" | "failed";
  created_by: string;
};
/** One "מההקלטה" note: its paragraph, that paragraph's first words (to find
 *  it again if the part changes), its time in seconds, its text. */
export type RecNote = { anchor: number; quote: string; at_s: number | null; text: string };
export type NotesRow = { id: string; lecture_id: string; part_idx: number; items: RecNote[]; status: "pending" | "writing" | "ready" | "failed"; error: string | null; lease_until: string | null };

export async function getRecording(lectureId: string): Promise<Recording | null> {
  if (!sb) return null;
  const { data, error } = await sb
    .from("study_recordings")
    .select("id, lecture_id, source, source_name, link_url, duration_s, has_times, status, created_by")
    .eq("lecture_id", lectureId)
    .maybeSingle();
  if (error) throw new Error(error.message || "unknown");
  return (data as Recording | null) ?? null;
}

export async function getRecordingNotes(lectureId: string): Promise<NotesRow[]> {
  if (!sb) return [];
  const { data, error } = await sb
    .from("study_recording_notes")
    .select("id, lecture_id, part_idx, items, status, error, lease_until")
    .eq("lecture_id", lectureId)
    .order("part_idx");
  if (error) throw new Error(error.message || "unknown");
  return (data ?? []) as NotesRow[];
}

/** Live changes to the lecture's recording and notes (channel
 *  study-recording-<lecture>). A filter on lecture_id never matches a delete,
 *  so deletes are listened to unfiltered (review FE-13). */
export function watchRecording(lectureId: string, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const ch: RealtimeChannel = sb
    .channel(`study-recording-${lectureId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_recordings", filter: `lecture_id=eq.${lectureId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_recording_notes", filter: `lecture_id=eq.${lectureId}` }, onChange)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "study_recordings" }, onChange)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "study_recording_notes" }, onChange)
    .subscribe();
  return () => void sb?.removeChannel(ch);
}

/** "41:10", or "1:02:05" past the hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
