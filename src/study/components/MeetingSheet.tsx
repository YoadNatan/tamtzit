import { useEffect, useMemo, useState } from "react";
import type { Ctx } from "../features/types";
import { getSections, listLectures, type LectureRow, type Section } from "../lib/api";
import { cancelMeeting, defaultWhen, israelInstant, israelParts, meetingWords, saveMeeting, slideRange, type BandMeeting } from "../lib/meeting";
import { isolateLatin } from "../lib/rich";
import { Sheet } from "./Shell";
import { pickerDir } from "../lib/bidi";

/* ── "הפגישה הבאה": planning (package M; the meeting design §4.3 item 1) ──
 *
 * "מתי" (a date and a time; by default tomorrow at the last meeting's time,
 * else 09:00), "מה קוראים" (a lecture, then its parts from one to another,
 * the slide range under them: "ש׳ 19-33"), "כותרת (לא חובה)". No reader is
 * planned ahead: whoever taps "להקריא לקבוצה" reads (the owner's request,
 * section M 2). Any member saves or changes it (as a
 * marathon); a stale version reloads the newer one ("conflict") and says so.
 * Before it starts, "לבטל את הפגישה". */

export default function MeetingSheet({
  ctx,
  meeting,
  lastStartsAt,
  onClose,
  onSaved,
}: {
  ctx: Ctx;
  meeting: BandMeeting | null;
  lastStartsAt: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const first = meeting ? israelParts(meeting.starts_at) : defaultWhen(lastStartsAt);
  const [date, setDate] = useState(first.date);
  const [time, setTime] = useState(first.time);
  const [lectures, setLectures] = useState<LectureRow[] | null>(null);
  const [lectureId, setLectureId] = useState(meeting?.lecture_id ?? "");
  const [parts, setParts] = useState<Section[]>([]);
  const [from, setFrom] = useState<number | null>(meeting?.part_from ?? null);
  const [to, setTo] = useState<number | null>(meeting?.part_to ?? null);
  const [title, setTitle] = useState(meeting?.title && meeting.title !== "" ? (meeting.title ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    listLectures(ctx.group.id)
      .then((l) => {
        if (!alive) return;
        setLectures(l.filter((x) => !x.deleted_at));
        if (!lectureId && l[0]) setLectureId(l[0].id);
      })
      .catch(() => alive && setLectures([]));
    return () => {
      alive = false;
    };
    // The list loads once; the chosen lecture is the form's.
  }, [ctx.group.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lectureId) return;
    let alive = true;
    getSections(lectureId)
      .then((s) => {
        if (!alive) return;
        setParts(s);
        const idx = s.map((x) => x.idx);
        setFrom((f) => (f !== null && idx.includes(f) ? f : (idx[0] ?? null)));
        setTo((t) => (t !== null && idx.includes(t) ? t : (idx[0] ?? null)));
        // The band names a meeting with no title of its own by its parts: that is not a title to keep.
        if (meeting) {
          const own = s.filter((x) => x.idx >= meeting.part_from && x.idx <= meeting.part_to).map((x) => x.title).join(" · ");
          setTitle((t) => (t === own ? "" : t));
        }
      })
      .catch(() => alive && setParts([]));
    return () => {
      alive = false;
    };
  }, [lectureId]);

  const pick = (idx: number) => {
    // A first tap chooses one part; a second extends the range to it.
    if (from === null || to === null || from !== to) {
      setFrom(idx);
      setTo(idx);
    } else if (idx < from) setFrom(idx);
    else setTo(idx);
  };
  const range = useMemo(() => {
    const a = parts.find((p) => p.idx === from);
    const b = parts.find((p) => p.idx === to);
    return a && b ? slideRange(a.slide_from, b.slide_to) : "";
  }, [parts, from, to]);
  // The title a meeting shows when none is given: the parts' own titles.
  const partsTitle = parts
    .filter((p) => from !== null && to !== null && p.idx >= from && p.idx <= to)
    .map((p) => p.title)
    .join(" · ");

  const save = async (close: () => void) => {
    const at = israelInstant(date, time);
    if (!at || !lectureId || from === null || to === null) return setError("צריך לבחור מתי ומה קוראים.");
    setBusy(true);
    setError("");
    try {
      const r = await saveMeeting({ id: meeting?.id ?? null, version: meeting?.version ?? null, groupId: ctx.group.id, startsAt: at, lectureId, partFrom: from, partTo: to, title: title.trim() });
      ctx.say(meeting ? "הפגישה עודכנה." : "הפגישה נקבעה.");
      onSaved(r.id);
      close();
    } catch (e) {
      setError(meetingWords(e));
      if (e instanceof Error && e.message === "conflict") onSaved(meeting?.id ?? "");
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (close: () => void) => {
    if (!meeting) return;
    setBusy(true);
    setError("");
    try {
      await cancelMeeting(meeting.id);
      ctx.say("הפגישה בוטלה.");
      onSaved("");
      close();
    } catch (e) {
      setError(meetingWords(e));
    } finally {
      setBusy(false);
    }
  };

  // A started meeting keeps its day, lecture and parts (review SEC4-2; the database refuses them too).
  const started = Boolean(meeting?.started_at);
  return (
    <Sheet label="הפגישה הבאה" className="m-plan" onClose={onClose} head={<h2 className="a-h2">{meeting ? "לשנות את הפגישה" : "הפגישה הבאה"}</h2>}>
      {(sheet) => (
        <div className="a-stack">
          <fieldset className="m-fields">
            <legend className="a-small">מתי</legend>
            <div className="a-row">
              <label className="a-field m-date">
                <span>תאריך</span>
                <input className="a-input" type="date" dir={pickerDir()} value={date} disabled={started} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="a-field m-time">
                <span>שעה</span>
                <input className="a-input" type="time" dir={pickerDir()} value={time} step={300} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
          </fieldset>
          <label className="a-field">
            <span>מה קוראים</span>
            <select className="a-input" value={lectureId} onChange={(e) => setLectureId(e.target.value)} disabled={started || !lectures?.length}>
              {(lectures ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
          {lectures && !lectures.length ? <p className="a-small a-muted">עוד אין הרצאות בספרייה.</p> : null}
          {started ? <p className="a-small a-muted m-started">הפגישה כבר התחילה: היום, ההרצאה והחלקים נשארים. אפשר לשנות את השעה והכותרת.</p> : null}
          {parts.length ? (
            <div className="a-stack">
              <div className="a-wrap m-parts" role="group" aria-label="החלקים">
                {parts.map((p) => {
                  const on = from !== null && to !== null && p.idx >= from && p.idx <= to;
                  return (
                    <button key={p.idx} type="button" className={`a-chip${on ? " busy" : ""}`} aria-pressed={on} disabled={started} onClick={() => pick(p.idx)}>
                      {on ? "✓ " : ""}
                      {isolateLatin(p.title, `pt${p.idx}`)}
                    </button>
                  );
                })}
              </div>
              {range ? <span className="a-small a-muted">{range}</span> : null}
            </div>
          ) : null}
          <label className="a-field">
            <span>כותרת (לא חובה)</span>
            <input className="a-input" value={title} maxLength={120} placeholder={partsTitle} onChange={(e) => setTitle(e.target.value)} dir="auto" />
          </label>
          {error ? (
            <p className="a-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="a-row sheet-actions">
            <button type="button" className="a-btn primary" disabled={busy || !lectureId || from === null} onClick={() => void save(sheet.close)}>
              {busy ? "שומר…" : "לשמור"}
            </button>
            <button type="button" className="a-btn ghost" onClick={sheet.close}>
              ביטול
            </button>
          </div>
          {meeting && !meeting.started_at ? (
            <button type="button" className="a-link danger m-cancel" disabled={busy} onClick={() => void cancel(sheet.close)}>
              לבטל את הפגישה
            </button>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
