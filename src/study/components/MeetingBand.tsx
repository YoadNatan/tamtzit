import { useCallback, useEffect, useRef, useState } from "react";
import type { Ctx } from "../features/types";
import { flags } from "../lib/flags";
import { hueOf } from "../lib/hue";
import { meetingBand, myMissed, pickGuesses, slideRange, watchMeetings, whenLine, clockOf, type BandMeeting, type Missed } from "../lib/meeting";
import { isolateLatin } from "../lib/rich";
import { Avatar, RouteLink } from "./Shell";
import "../styles/meeting.css";

/* ── The meeting's band and its card on "יחד" (package M; today.html s1,
 * spec §12.4.M, the meeting design §4.4) ──
 *
 * study_meeting_band(): today's meetings, else the next one within 14 days.
 * A planned one: "הקבוצה היום · 09:00" with the slide range, the title, "הקראה:
 * שוהם" and, with M-2, "ניחוש לפני · 2 שאלות"; a live one: "הקראה עכשיו:
 * שוהם" and "לעקוב"; "3 לקפה" or the closing quiz while open; over: "הפגישה
 * של היום הסתיימה". The card adds "לקבוע את הפגישה הבאה", and with M-2 a
 * meeting this member missed ("פגישה שפספסת", catch-up: decision 1 opens it
 * without an account). Live through the meetings' channel and the group's
 * quiz channel. */

export function useBand(groupId: string): { rows: BandMeeting[] | null; error: boolean; reload: () => void } {
  const [rows, setRows] = useState<BandMeeting[] | null>(null);
  const [error, setError] = useState(false);
  const picked = useRef(new Set<string>());
  const reload = useCallback(() => {
    meetingBand(groupId)
      .then((r) => {
        setRows(r);
        setError(false);
        // M-2: the band offers "ניחוש לפני" once the meeting's two guesses are chosen (once per
        // meeting; the database keeps the first choice).
        const due = flags.guess ? r.filter((m) => m.guesses === 0 && !m.started_at && !m.over && !picked.current.has(m.id)) : [];
        for (const m of due) picked.current.add(m.id);
        if (due.length)
          void Promise.all(due.map((m) => pickGuesses(m.id).catch(() => [])))
            .then((ids) => (ids.some((x) => x.length) ? meetingBand(groupId).then(setRows) : undefined))
            .catch(() => undefined);
      })
      .catch(() => setError(true));
  }, [groupId]);
  useEffect(() => {
    reload();
    return watchMeetings(groupId, reload, undefined, { quizzes: flags.quiz });
  }, [groupId, reload]);
  return { rows, error, reload };
}

export function BandItem({ ctx, m }: { ctx: Ctx; m: BandMeeting }) {
  const who = m.reader_id ?? m.planned_reader;
  const name = who ? ctx.nameOf(who) || "ללא שם" : "";
  const slides = slideRange(m.slide_from, m.slide_to);
  const head = m.today ? `הקבוצה היום · ${clockOf(m.starts_at)}` : `הפגישה הבאה · ${whenLine(m)}`;
  const quizOpen = (q: BandMeeting["coffee"]) => Boolean(q && ["lobby", "question", "reveal"].includes(q.state));
  const live = m.today && m.reading && !m.over;
  return (
    <div className="a-card m-band" data-meeting={m.id} data-hue={hueOf(m.lecture_id)}>
      <div className="a-row between">
        <b>{head}</b>
        {slides ? <span className="a-tag">{slides}</span> : null}
      </div>
      <p className="a-para" dir="rtl">
        {isolateLatin(m.title ? `${m.lecture_title}: ${m.title}` : m.lecture_title, `bt${m.id}`)}
      </p>
      {m.over ? (
        <p className="a-small a-muted">הפגישה של היום הסתיימה.</p>
      ) : live ? (
        <div className="a-row between">
          <span className="a-row">
            {who ? <Avatar id={who} name={name} /> : null}
            <span className="a-small">
              הקראה עכשיו: <b>{name}</b>
            </span>
          </span>
          {m.reader_id !== ctx.userId ? (
            <RouteLink to={{ v: "lecture", l: m.lecture_id, follow: true }} go={ctx.go} className="a-btn primary small">
              לעקוב
            </RouteLink>
          ) : null}
        </div>
      ) : (
        <div className="a-row between">
          <span className="a-row">
            {who ? <Avatar id={who} name={name} /> : null}
            <span className="a-small">{who ? <>הקראה: <b>{name}</b></> : "עוד לא נקבע מי מקריאים"}</span>
          </span>
          {flags.guess && m.guesses > 0 && m.guess_released < m.guesses ? (
            <RouteLink to={{ v: "meeting", m: m.id }} go={ctx.go} className="a-btn small m-guess-btn">
              ניחוש לפני · {m.guesses === 1 ? "שאלה אחת" : `${m.guesses} שאלות`}
            </RouteLink>
          ) : null}
        </div>
      )}
      {quizOpen(m.coffee) ? (
        <RouteLink to={{ v: "meeting", m: m.id }} go={ctx.go} className="a-btn small m-band-quiz">
          3 לקפה פתוח
        </RouteLink>
      ) : quizOpen(m.closing) && m.closing ? (
        <RouteLink to={{ v: "quiz", q: m.closing.id }} go={ctx.go} className="a-btn small m-band-quiz">
          מבחן קבוצתי על מה שנקרא · פתוח
        </RouteLink>
      ) : null}
      <div className="a-row m-band-links">
        <RouteLink to={{ v: "meeting", m: m.id }} go={ctx.go} className="a-link">
          {m.today ? "לפגישה של היום" : "לפגישה"}
        </RouteLink>
      </div>
    </div>
  );
}

export default function MeetingBand({ ctx, card, compact }: { ctx: Ctx; card?: boolean; compact?: boolean }) {
  const { rows, error } = useBand(ctx.group.id);
  const [missed, setMissed] = useState<Missed[]>([]);
  useEffect(() => {
    if (!card || !flags.guess) return;
    let alive = true;
    myMissed(ctx.group.id)
      .then((r) => alive && setMissed(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [card, ctx.group.id]);

  if (!card) {
    if (!rows?.length) return null;
    return (
      <div className={`m-bands${compact ? " compact" : ""}`}>
        {rows.map((m) => (
          <BandItem key={m.id} ctx={ctx} m={m} />
        ))}
      </div>
    );
  }
  return (
    <section className="a-stack m-card" aria-labelledby="meeting-h">
      <div className="a-sec">
        <h2 id="meeting-h">הפגישה</h2>
      </div>
      {rows === null ? (
        <p className="a-card flat a-muted">{error ? "הפגישה לא נטענה. כדאי לבדוק את החיבור ולנסות שוב." : "טוען…"}</p>
      ) : rows.length === 0 ? (
        <p className="a-card flat a-muted">אין פגישה מתוכננת.</p>
      ) : (
        rows.map((m) => <BandItem key={m.id} ctx={ctx} m={m} />)
      )}
      {missed.length ? (
        <ul className="a-list m-missed">
          {missed.slice(0, 2).map((x) => (
            <li key={x.meeting_id}>
              <RouteLink to={{ v: "catchup", m: x.meeting_id }} go={ctx.go} className="a-li">
                <div>
                  <b>פגישה שפספסת</b>
                  <span className="m" dir="rtl">
                    {isolateLatin(x.title ? `${x.lecture_title}: ${x.title}` : x.lecture_title, `mx${x.meeting_id}`)}
                  </span>
                </div>
                <span className="a-chip">השלמה</span>
              </RouteLink>
            </li>
          ))}
        </ul>
      ) : null}
      <RouteLink to={{ v: "meeting", isNew: true }} go={ctx.go} className="a-btn">
        לקבוע את הפגישה הבאה
      </RouteLink>
    </section>
  );
}
