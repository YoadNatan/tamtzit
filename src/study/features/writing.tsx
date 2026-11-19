import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { numberBlocks, reanchor } from "../../../shared/study/blocks";
import { isStuck, startedOver, type Lecture, type Section } from "../lib/api";
import { failShort, failText, hasText } from "../lib/failText";
import { flags } from "../lib/flags";
import { generate } from "../lib/generate";
import { richText } from "../lib/rich";
import { Icon } from "../components/Icon";
import {
  clock,
  getRecording,
  getRecordingNotes,
  queueWriting,
  rememberServer,
  serverKnownOn,
  serverSilent,
  watchRecording,
  type NotesRow,
  type RecNote,
} from "../lib/writing";
import "../styles/writing.css";
import type { LectureCtx, LectureExt, Writing } from "./types";

/* ── Package W's slot (spec §5.3): writing the summary, sharing and printing it ──
 *
 * Writing (W1). Once the slides are saved, afterUpload() hands the lecture to
 * the server (study_queue): the summary is then written there part by part,
 * and the phone may close. The reader shows the server's text as it grows
 * (study_progress patches the part in place), says why a part stopped and
 * when it is tried again, and "המשך כתיבה" restarts the failed parts
 * (study_queue, at most three times a day). When the server does not
 * write (study_queue answers false), or has been silent for 3 minutes while
 * work waits, the phone writes as before, through the same claims, so two
 * writers never write one part.
 *
 * Deleting a lecture cancels its writing (W2's e2e): the server claims
 * nothing of a deleted lecture, this phone's run stops at the first part the
 * device path refuses ("lecture not found"), and the reader says why and
 * offers nothing to tap, until the lecture is restored ("שחזור").
 *
 * Sharing (W1). "שיתוף" opens the share sheet: the link, printing on the
 * device, and (with VITE_STUDY_PDF, W3) the server's PDF.
 *
 * Recordings (with VITE_STUDY_RECORDINGS): the "מההקלטה" boxes after their
 * paragraphs, re-anchored by their first words, hidden by the per-device
 * setting on "שלי". Adding a recording is W4's sheet. */

const ShareSheet = lazy(() => import("../components/ShareSheet"));

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");
const BUTTON = "״המשך כתיבה״";
/** A part of a deleted lecture that was not written: its writing was cancelled. */
export const STOPPED_DELETED = "הכתיבה נעצרה: ההרצאה נמחקה.";

/** The summary's writing state for LectureView. */
export function useWriting(lc: LectureCtx): Writing {
  const { lecture, sections, refresh, ctx } = lc;
  const lectureId = lecture.id;
  const userId = ctx.userId;
  const say = ctx.say;
  const [live, setLive] = useState<Record<number, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false); // writing or queueing right now (a ref: taps come faster than renders)
  const started = useRef(false);
  const server = Boolean(lecture.queued_at);
  // Deleted (by this phone or another member): its writing is cancelled.
  const gone = Boolean(lecture.deleted_at);
  const allReady = sections.length > 0 && sections.every((s) => s.status === "ready");

  useEffect(() => {
    if (server) rememberServer(true);
  }, [server]);

  // While the server writes, the clock moves on: the minutes until a retry,
  // and the 3-minute rule for a server that went silent.
  useEffect(() => {
    if (!server || allReady) return;
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, [server, allReady]);

  /** This phone writes what is left (the device path). */
  const write = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setError("");
    try {
      const { failed } = await generate(lectureId, {
        onLive: (idx, text) => setLive((m) => ({ ...m, [idx]: text })),
        onChange: () => void refresh().catch(() => undefined),
      });
      if (failed) setError(`${failed === 1 ? "חלק אחד לא נכתב" : `${failed} חלקים לא נכתבו`}. אפשר ללחוץ ${BUTTON}.`);
    } catch (e) {
      setError(failText(codeOf(e), "writing"));
    } finally {
      busy.current = false;
      setRunning(false);
      setLive({});
      void refresh().catch(() => undefined);
    }
  }, [lectureId, refresh]);

  /** "המשך כתיבה": every tap goes through study_queue (server or not; review
   *  FE-4), then the server writes, or this phone. A tap restarts what failed
   *  (p_retry_failed, at most three times a lecture a day: review M6); a tap
   *  with nothing failed, only parts waiting (a phone slept, another writer
   *  was busy), restarts nothing, so it is not one of those three. */
  const continueWriting = useCallback(() => {
    if (busy.current || lecture.deleted_at) return;
    busy.current = true;
    void (async () => {
      setError("");
      const restart = lecture.status === "failed" || sections.some((s) => s.status === "failed" && !startedOver(s));
      let queued = false;
      try {
        queued = await queueWriting(lecture, { retryFailed: restart });
      } catch (e) {
        busy.current = false;
        setError(failText(codeOf(e), "writing")); // "retry limit": three a day
        return;
      }
      busy.current = false;
      if (queued) {
        say("השרת ממשיך לכתוב.");
        void refresh().catch(() => undefined);
        return;
      }
      await write();
    })();
  }, [lecture, sections, say, refresh, write]);

  // The uploader's phone writes a new lecture the server did not take, as
  // before. Anyone who opens a lecture whose writing stopped half-way (a
  // phone went to sleep), or whose server went silent for 3 minutes while
  // work waits, picks it up once. Parts that failed wait for a tap on "המשך
  // כתיבה" (or for their retry time on the server), so a broken key or a
  // refusal never loops.
  useEffect(() => {
    if (started.current || busy.current || gone) return;
    const fresh = !server && lecture.status === "new" && lecture.created_by === userId;
    const stalled =
      !server && sections.length > 0 && sections.some((s) => s.status === "pending" || isStuck(s)) && !sections.some((s) => s.status === "writing" && !isStuck(s));
    const silent = server && serverSilent(lecture, sections, now);
    if (fresh || stalled || silent) {
      started.current = true;
      void write();
    }
  }, [lecture, sections, userId, server, now, gone, write]);

  /** A waiting part's status line (design-platform §1.A step 4). */
  const partLine = (s: Section): string => {
    if (gone) return STOPPED_DELETED;
    if (startedOver(s)) return "ממתין לתורו";
    if (s.status === "failed") {
      const code = s.error ?? "";
      if ((s.attempts ?? 0) >= 4 || code === "lost") return `נעצר אחרי 4 ניסיונות. אפשר ללחוץ ${BUTTON}.`;
      const at = s.retry_at ? Date.parse(s.retry_at) : NaN;
      if (server && Number.isFinite(at) && at > now) return `נעצר: ${failShort(code)}. ניסיון חוזר אוטומטי בעוד ${Math.max(1, Math.ceil((at - now) / 60_000))} דק׳.`;
      const text = code && hasText(code) ? failText(code, "writing") : "החלק הזה לא נכתב.";
      return text.includes(BUTTON) ? text : `${text} אפשר ללחוץ ${BUTTON}.`;
    }
    if (s.status === "writing" && !isStuck(s, now)) return "נכתב עכשיו במכשיר אחר…";
    return "ממתין לתורו";
  };

  /** The text to show as "נכתב עכשיו…": this phone's stream, or the text so
   *  far another writer saved (the server's from its first moment). */
  const streaming = (s: Section): string | undefined => {
    if (live[s.idx] !== undefined) return live[s.idx];
    if (s.status !== "writing" || isStuck(s, now)) return undefined;
    return s.markdown || s.writer === "server" ? s.markdown : undefined;
  };

  const needsWork = server
    ? sections.some((s) => s.status === "failed" && !startedOver(s)) || (sections.length === 0 && lecture.status === "failed") || serverSilent(lecture, sections, now)
    : sections.length === 0
      ? lecture.status !== "outlining" || now - new Date(lecture.updated_at).getTime() > 3 * 60 * 1000
      : sections.some((s) => s.status === "pending" || s.status === "failed" || isStuck(s, now));

  // Before its outline exists, a lecture the server holds is being planned
  // there: the reader says so ("…מבנה הסיכום") rather than "not started".
  const planning = server && sections.length === 0 && (lecture.status === "new" || lecture.status === "outlining") && !serverSilent(lecture, sections, now);
  // An outline that failed leaves the lecture failed with no parts, its reason
  // in lecture.error (budget, too many slides, no slides; "lost" after three
  // dead writers, which is the outline's own line). The server path never
  // throws it to this phone, so the reader says it from the row, on either
  // path, until a tap starts it over.
  const outlineFailed = sections.length === 0 && lecture.status === "failed";
  const outlineError = outlineFailed && !running ? failText(lecture.error === "lost" ? "outline" : (lecture.error ?? ""), "writing") : "";
  return {
    live,
    running: running || (planning && !gone),
    error: gone ? failText("lecture not found", "writing") : error || outlineError,
    needsWork: !running && !gone && needsWork,
    // The outline's failure lines ask for "המשך כתיבה" (spec §6.3), so the
    // button says so too; "התחלת הסיכום" is for a lecture nobody started.
    buttonText: sections.length || outlineFailed ? "המשך כתיבה" : "התחלת הסיכום",
    continueWriting,
    partLine,
    streaming,
  };
}

/** Whether the server still has something of this lecture to write by
 *  itself: the outline, a part waiting or being written, or a stopped part
 *  whose retry time is set. Not once all that is left waits for a tap on
 *  "המשך כתיבה" (a failed outline, a refusal, four attempts), nor once the
 *  lecture is deleted (the server claims nothing of it). */
export function serverGoesOn(lecture: Pick<Lecture, "status" | "deleted_at">, sections: Section[]): boolean {
  if (lecture.status === "failed" || lecture.deleted_at) return false;
  if (!sections.length) return true;
  return sections.some((s) => s.status === "pending" || s.status === "writing" || (s.status === "failed" && (s.attempts ?? 0) < 4 && Boolean(s.retry_at)));
}

/* ── The recording's notes, for the reader and the print layout ── */

const REC_KEY = "study-rec-notes";
function showRecNotes(): boolean {
  try {
    return localStorage.getItem(REC_KEY) !== "0"; // on unless switched off on "שלי"
  } catch {
    return true;
  }
}

/** The lecture's ready notes (with VITE_STUDY_RECORDINGS), kept live. */
function useRecNotes(lectureId: string): NotesRow[] {
  const [rows, setRows] = useState<NotesRow[]>([]);
  useEffect(() => {
    if (!flags.recordings) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      Promise.all([getRecording(lectureId), getRecordingNotes(lectureId)])
        .then(([rec, notes]) => alive && setRows(rec ? notes.filter((n) => n.status === "ready" && n.items?.length) : []))
        .catch(() => undefined);
    void load();
    const stop = watchRecording(lectureId, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 300);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [lectureId]);
  return rows;
}

function RecNoteBox({ note, k }: { note: RecNote; k: string }) {
  return (
    <aside className="a-callout rec rec-note" dir="rtl">
      <p className="rec-head">
        <strong>מההקלטה</strong>
        {note.at_s !== null && note.at_s !== undefined ? (
          <span className="rec-time">
            <bdi dir="ltr">{clock(note.at_s)}</bdi>
          </span>
        ) : null}
      </p>
      <p>{richText(note.text, k)}</p>
    </aside>
  );
}

/** A part's boxes by paragraph: each note under the block that opens with its
 *  quote (the part may have changed since), notes of the whole part (¶-1, or
 *  a paragraph that is gone) after the last block. */
function notesByBlock(s: Section, items: RecNote[]): ((anchor: number) => ReactNode) | undefined {
  if (!items.length || !s.markdown) return undefined;
  const blocks = numberBlocks(s.markdown);
  const last = blocks.length ? blocks[blocks.length - 1].n : -1;
  const at = new Map<number, RecNote[]>();
  for (const n of items) {
    const a = n.anchor === -1 ? -1 : reanchor(blocks, n.anchor, n.quote ?? "");
    const key = a === -1 ? last : a;
    at.set(key, [...(at.get(key) ?? []), n]);
  }
  return (anchor) => {
    const list = at.get(anchor);
    return list ? list.map((n, i) => <RecNoteBox key={`r${s.idx}-${anchor}-${i}`} note={n} k={`r${s.idx}-${anchor}-${i}`} />) : null;
  };
}

/** W's note under the title, the share sheet, and the recording's boxes. */
export function useLectureW(lc: LectureCtx): LectureExt {
  const { lecture, sections, ctx } = lc;
  const [sharing, setSharing] = useState(false);
  const rows = useRecNotes(lecture.id);
  const show = useMemo(showRecNotes, [lecture.id]);
  const byPart = useMemo(() => new Map(rows.map((r) => [r.part_idx, r.items])), [rows]);
  const extrasFor = useCallback((s: Section) => notesByBlock(s, byPart.get(s.idx) ?? []), [byPart]);
  // The note promises that writing goes on with the app closed, so it shows
  // only while the server still has something to write by itself.
  const goesOn = Boolean(lecture.queued_at) && serverGoesOn(lecture, sections);

  return {
    top:
      goesOn ? (
        <div className="a-card flat server-note" role="status">
          <div className="a-row server-note-line">
            <span className="server-note-icon" aria-hidden="true">
              <Icon name="pen" size={14} />
            </span>
            <p className="a-small">
              <b>הסיכום נכתב בשרת, חלק אחרי חלק.</b> אפשר לסגור את האפליקציה: הכתיבה ממשיכה, וכל הקבוצה תראה כאן כל חלק שנגמר.
            </p>
          </div>
          {sections.length ? (
            <div className="a-bar" aria-hidden="true">
              <i style={{ width: `${Math.round((100 * sections.filter((x) => x.status === "ready").length) / sections.length)}%` }} />
            </div>
          ) : null}
        </div>
      ) : undefined,
    part: byPart.size && show ? (s) => ({ blockExtras: extrasFor(s) }) : undefined,
    share: () => setSharing(true),
    overlay: sharing ? (
      <Suspense fallback={null}>
        <ShareSheet
          lecture={lecture}
          sections={sections}
          groupName={ctx.group.name}
          say={ctx.say}
          hasNotes={byPart.size > 0}
          extrasFor={extrasFor}
          onClose={() => setSharing(false)}
        />
      </Suspense>
    ) : undefined,
  };
}

/** After a new lecture is saved: the server writes it, if it can. The
 *  pictures the writer sends (the saved lecture's own, so nothing is read
 *  back) go along signed for 48 hours. Never throws: Upload goes on, and the
 *  phone writes the lecture when the server does not. */
export async function afterUpload(lecture: Lecture, _figurePaths: string[]): Promise<void> {
  try {
    await queueWriting(lecture);
  } catch {
    /* the phone writes it, as before */
  }
}

/** The upload's saving line: with the server writing, it says the app may be
 *  closed once the slides are saved (design-platform §1.A step 1). */
export function uploadNote(done: number, total: number): string | null {
  const line = `שומרים את השקפים והתמונות: ${done} מתוך ${total}`;
  return serverKnownOn() ? `${line}. כדאי להשאיר את המסך פתוח עד שהשמירה נגמרת. אחרי זה הסיכום נכתב בשרת, גם אם סוגרים את האפליקציה.` : line;
}

/** What help says about writing and sharing (spec §6.2): "שיתוף" offers
 *  printing on the device (W1); the summary is written on the server once
 *  this device has seen the group's server write (study_queue answered true,
 *  or a lecture it opened was queued), so help never promises a server that
 *  Yoad has not set up yet (§9.1 step 4). */
export function writingHelp(): { serverWrites: boolean; devicePrint: boolean } {
  return { serverWrites: serverKnownOn(), devicePrint: true };
}
