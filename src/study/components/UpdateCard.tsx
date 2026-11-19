import { useState } from "react";
import { citedSlides } from "../../../shared/study/edits";
import type { Ctx, UpdateRow } from "../features/types";
import { sourceLine } from "../lib/collab";
import { failText } from "../lib/failText";
import { changeLines, reasonLine, updateSeen } from "../lib/var";
import { Avatar } from "./Shell";
import { SlideTagOf, vText } from "./VerdictCard";
import "../styles/var.css";

/* ── "עדכון בסיכום" (package V; corrections.html s3) ──
 * One correction that reached a member because she had already studied the
 * old line (a card she reviewed, a question she answered): the old line,
 * the new one with its slide, who corrected and who approved, the source,
 * and why it reached her ("רק לך"). "הבנתי" marks it seen; "לפסקה" opens
 * the paragraph. Private: study_my_updates gives each member her own. */

export default function UpdateCard({ ctx, update: u, onDone }: { ctx: Ctx; update: UpdateRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { was, now } = changeLines(u.before_text, u.after_text);
  const tags = citedSlides(u.after_text);
  const who = [`תיקון: ${u.author ?? "ללא שם"}`, u.aloud ? "אישור: בקול בפגישה" : `אישור: ${u.approver ?? "ללא שם"}`, sourceLine(u)].filter(Boolean).join(" · ");
  const seen = async () => {
    setBusy(true);
    setError("");
    try {
      await updateSeen(u.id);
      onDone();
    } catch (e) {
      setError(failText(e instanceof Error ? e.message : "", "today"));
      setBusy(false);
    }
  };
  return (
    <section className="a-card a-stack v-update" aria-label={`עדכון בסיכום · ${u.lecture_title}`}>
      <div className="a-row between">
        <b>
          עדכון בסיכום · <bdi>{u.lecture_title}</bdi>
        </b>
        <span className="a-chip busy">תוקן אחרי שלמדת</span>
      </div>
      <div className="a-row v-line">
        <span className="a-chip">היה</span>
        <span className="a-small a-muted">
          <s>{vText(was, `uw${u.id}`)}</s>
        </span>
      </div>
      <div className="a-row v-line">
        <span className="a-chip ok">עכשיו</span>
        <span className="a-small">
          <b>{vText(now, `un${u.id}`)}</b> <SlideTagOf slides={tags} />
        </span>
      </div>
      <div className="a-row v-line">
        {u.author ? <Avatar id={u.author} name={u.author} /> : null}
        <span className="a-small a-muted">{who}</span>
      </div>
      <p className="a-small a-muted">
        {reasonLine(u)} <span className="a-chip">רק לך</span>
      </p>
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
      <div className="a-row">
        <button className="a-btn primary wide" disabled={busy} onClick={() => void seen()}>
          הבנתי
        </button>
        <button className="a-btn" onClick={() => ctx.go({ v: "lecture", l: u.lecture_id, at: { part: u.part_idx, anchor: u.anchor } })}>
          לפסקה
        </button>
      </div>
    </section>
  );
}
