import { useCallback, useEffect, useRef, useState } from "react";
import type { LectureCtx } from "../features/types";
import { flags } from "../lib/flags";
import {
  guessLine,
  guessState,
  HERE_MS,
  imHere,
  meetingOn,
  meetingWords,
  tapUnclear,
  unclearToast,
  watchMeetings,
  type GuessItem,
  type MeetingRow,
} from "../lib/meeting";
import { isolateLatin, richText } from "../lib/rich";
import { Icon } from "./Icon";
import "../styles/meeting.css";

/* ── "לא ברור לי" in the follower's bar, and the guess that lights up
 * (package M; meeting.html s2, spec §12.4.M) ──
 *
 * While this phone follows a reading in the day's meeting on this lecture:
 * the button marks the paragraph being read, without a name or any text
 * (study_meeting_unclear; the reader's phone counts it only from 3 others,
 * and never sees who); a second tap on the same paragraph does nothing, and
 * the toast's "ביטול" takes it back. Following says "here" at once and every
 * 3 minutes (study_meeting_here: two followers make the reading live, for
 * the guesses and for "אישור בקול"). With M-2, when the reading reaches a
 * pre-guess's paragraph (the meeting row's guess_released, live) the phone
 * shows "דינג! התשובה לניחוש 1" with the explanation and her own line,
 * never a number. The reader never sees this bar (the database refuses the
 * reader's tap too: "is reader"). */

const LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"];

export default function FollowBar({ lc }: { lc: LectureCtx }) {
  const groupId = lc.ctx.group.id;
  const lectureId = lc.lecture.id;
  const [meeting, setMeeting] = useState<MeetingRow | null>(null);
  const [tapped, setTapped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [ding, setDing] = useState<GuessItem | null>(null);
  const released = useRef<number | null>(null);
  const say = lc.ctx.say;

  const load = useCallback(() => {
    meetingOn(groupId, lectureId)
      .then((m) => setMeeting(m))
      .catch(() => undefined);
  }, [groupId, lectureId]);
  useEffect(() => {
    load();
    return watchMeetings(groupId, (row) => {
      if (!row.id || row.lecture_id === lectureId) load();
    });
  }, [groupId, lectureId, load]);

  // Here: once following starts, and every 3 minutes while it goes on.
  const mid = meeting && meeting.reading ? meeting.id : null;
  useEffect(() => {
    if (!mid) return;
    const here = () => void imHere(mid).catch(() => undefined);
    here();
    const t = setInterval(here, HERE_MS);
    return () => clearInterval(t);
  }, [mid]);

  // M-2: a guess lit up while following ("דינג!").
  const rel = meeting?.guess_released ?? null;
  useEffect(() => {
    if (!flags.guess || !meeting || rel === null) return;
    const before = released.current;
    released.current = rel;
    if (before === null || rel <= before) return;
    let alive = true;
    guessState(meeting.id)
      .then((items) => {
        const g = items.find((x) => x.n === rel && x.released);
        if (!alive || !g) return;
        setDing(g);
        try {
          navigator.vibrate?.(80);
        } catch {
          /* not allowed: the card is enough */
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [rel, meeting]);

  const at = lc.place;
  const spot = at ? `${at.part}.${at.anchor}` : "";
  const done = Boolean(spot && tapped.has(spot));
  const tap = async () => {
    if (!mid || !at || done || busy) return;
    setBusy(true);
    try {
      await tapUnclear(mid, at.part, at.anchor, true);
      setTapped((s) => new Set(s).add(spot));
      say(unclearToast(flags.today || flags.anchor), {
        label: "ביטול",
        run: () =>
          void tapUnclear(mid, at.part, at.anchor, false)
            .then(() =>
              setTapped((s) => {
                const n = new Set(s);
                n.delete(spot);
                return n;
              }),
            )
            .catch(() => undefined),
      });
    } catch (e) {
      say(meetingWords(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="m-follow">
      {ding ? (
        <span className="a-card m-ding" role="status">
          <b>דינג! התשובה לניחוש {ding.n}</b>
          {ding.explanation ? (
            <span className="a-para" dir="rtl">
              {richText(ding.explanation, `dx${ding.n}`)}
            </span>
          ) : null}
          <span className="a-row between">
            <span className="a-small a-muted" dir="rtl">
              {isolateLatin(guessLine(ding, (i) => ding.q.options[i] ?? LETTERS[i] ?? ""), `dl${ding.n}`)}
            </span>
            <span className="a-chip">רק לך</span>
          </span>
          <button type="button" className="a-btn ghost small" onClick={() => setDing(null)}>
            הבנתי
          </button>
        </span>
      ) : null}
      <button
        type="button"
        className={`a-btn m-unclear${done ? " on" : ""}`}
        aria-pressed={done}
        disabled={!mid || !at || busy}
        onClick={() => void tap()}
      >
        <Icon name="check" size={14} />
        {done ? "סומן ׳לא ברור׳" : "לא ברור לי"}
      </button>
    </span>
  );
}
