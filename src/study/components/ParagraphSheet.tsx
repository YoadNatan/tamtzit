import { useEffect, useMemo, useRef, useState } from "react";
import { tidy } from "../../../shared/study/blocks";
import { blockSources, citedSlides } from "../../../shared/study/edits";
import type { Comment } from "../lib/api";
import { addAnswerCard, commentExtras, slideSpec } from "../lib/collab";
import { failText } from "../lib/failText";
import { ENDS, flags } from "../lib/flags";
import { PracticeTab, usePracticeCount } from "../features/anchor";
import { ParagraphWall, ToWall } from "../features/wall";
import type { ParagraphSheetProps, SheetTab } from "../features/types";
import EditPanel from "./EditPanel";
import { Icon } from "./Icon";
import { SheetClose } from "./Shell";
import { isolateLatin } from "./SummaryView";
import { ThreadPanel, useSheet, type CommentExtra } from "./Together";

/* ── A paragraph's sheet: "מה יושב על הפסקה" (§12.3.K; anchor.html s2,
 *    ask.html s2, corrections.html s1) ──
 *
 * The head (its title, the paragraph's slide tags, ✕, the paragraph's first
 * words), a row of tabs and the tab's panel: "תגובות" (the thread,
 * Together's ThreadPanel, with section K's end: Claude's attempt folded under
 * its question, who marked a question answered), "תיקון" (EditPanel: the
 * history, a proposal waiting for approval, the editor), "אסוציאציה" (J's
 * ParagraphWall) and "תרגול" (N's PracticeTab, with its count), each behind
 * its flag; with one tab the row hides. One frame, shared by K and N
 * (package N built it first, minimally; K's is the frame both use). LectureView opens it on a tab, over the reader, with
 * its own history entry (Back closes it), and keeps the thread's draft. The
 * asker who marks her question answered gets the card sheet (K4, with C's
 * end and flags.cards): her question and the chosen answer as a private
 * card, "להוסיף לתור שלי" on. */

type TabDef = { id: SheetTab; label: string; on: boolean };
export const TABS: TabDef[] = [
  { id: "comments", label: "תגובות", on: true },
  { id: "edit", label: "תיקון", on: flags.corrections },
  { id: "mnemonic", label: "אסוציאציה", on: flags.wall },
  { id: "practice", label: "תרגול", on: flags.anchor },
];

/** The private card from an answered question needs C's end (study_my_card_add). */
const ANSWER_CARD = flags.cards && ENDS.C;

export default function ParagraphSheet({ lc, spot, tab, thread, onTab, onClose }: ParagraphSheetProps) {
  const box = useRef<HTMLElement>(null);
  useSheet(box, onClose);
  const tabs = TABS.filter((t) => t.on);
  const shown = tabs.some((t) => t.id === tab) ? tab : "comments";
  const [extras, setExtras] = useState<Record<string, CommentExtra>>({});
  const [cardFor, setCardFor] = useState<Comment | null>(null);

  // The paragraph's slide tags, for the head (anchor.html s2).
  const section = lc.sections.find((s) => s.idx === spot.part);
  const slides = useMemo(() => {
    const b = section?.status === "ready" ? blockSources(tidy(section.markdown))[spot.anchor] : undefined;
    return b ? citedSlides(b.text) : [];
  }, [section?.markdown, section?.status, spot.anchor]);

  // Section K's end on the thread: Claude's attempts and who marked a question answered.
  const key = thread.comments.map((c) => `${c.id}${c.resolved ? "+" : ""}`).join(",");
  useEffect(() => {
    if (!flags.ask && !flags.corrections) return;
    let alive = true;
    const ids = key ? key.split(",").map((k) => k.replace(/\+$/, "")) : [];
    commentExtras(ids)
      .then((rows) => alive && setExtras(Object.fromEntries(rows.map((r) => [r.id, { ask_attempt: r.ask_attempt, resolved_by: r.resolved_by }]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key]);

  // The tab's count, as anchor.html s2 draws it: "תגובות · 1", "תרגול · 4".
  const practice = usePracticeCount(lc.lecture.id, spot);
  const count = (id: SheetTab) => (id === "comments" ? thread.comments.length : id === "practice" ? (practice ?? 0) : 0);
  const label = (t: TabDef) => (count(t.id) ? `${t.label} · ${count(t.id)}` : t.label);

  return (
    <div className="a-scrim" onClick={onClose}>
      <section
        ref={box}
        tabIndex={-1}
        className="a-sheet k-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="k-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="a-sheet-head k-sheet-head">
          <h2 id="k-sheet-title">מה יושב על הפסקה</h2>
          <span className="a-row">
            {slides.length ? <span className="a-tag src-tag">ש׳ {slideSpec(slides)}</span> : null}
            <SheetClose onClick={onClose} />
          </span>
        </header>
        {thread.quote ? (
          <p className="a-small a-muted sheet-quote" dir="rtl">
            {isolateLatin(`״${thread.quote}…״`, "q")}
          </p>
        ) : null}
        {tabs.length > 1 ? (
          <div className="a-wrap k-tabs" role="tablist" aria-label="מה יושב על הפסקה">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`k-tab-${t.id}`}
                aria-selected={t.id === shown}
                aria-controls="k-tab-panel"
                className={`a-chip k-tab${t.id === shown ? " busy" : ""}`}
                onClick={() => onTab(t.id)}
              >
                {label(t)}
              </button>
            ))}
          </div>
        ) : null}
        <div
          id="k-tab-panel"
          className="a-stack k-panel"
          role={tabs.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={tabs.length > 1 ? `k-tab-${shown}` : undefined}
        >
          {shown === "comments" ? (
            cardFor ? (
              <AnswerCard lc={lc} question={cardFor} comments={thread.comments} extras={extras} onResolve={thread.onResolve} onDone={() => setCardFor(null)} />
            ) : (
              <ThreadPanel
                {...thread}
                extras={extras}
                onAskerResolve={ANSWER_CARD ? (c) => setCardFor(c) : undefined}
                afterAnswer={flags.wall ? (c) => <ToWall ctx={lc.ctx} lecture={lc.lecture.id} spot={spot} comment={c} /> : undefined}
              />
            )
          ) : null}
          {shown === "edit" ? <EditPanel lc={lc} spot={spot} /> : null}
          {shown === "mnemonic" ? <ParagraphWall lc={lc} spot={spot} /> : null}
          {shown === "practice" ? <PracticeTab lc={lc} spot={spot} /> : null}
        </div>
      </section>
    </div>
  );
}

/** K4 (ask.html s2): the asker marks her question answered, and her question
 *  with the chosen answer becomes a private card (section C's private cards,
 *  origin "answer"). Both sides editable, 300 characters at most. */
function AnswerCard({
  lc,
  question,
  comments,
  extras,
  onResolve,
  onDone,
}: {
  lc: ParagraphSheetProps["lc"];
  question: Comment;
  comments: Comment[];
  extras: Record<string, CommentExtra>;
  onResolve: (c: Comment, resolved: boolean) => Promise<void>;
  onDone: () => void;
}) {
  const replies = comments.filter((c) => c.parent_id === question.id);
  const members = replies.filter((c) => !extras[c.id]?.ask_attempt);
  const chosen = members[members.length - 1] ?? replies[replies.length - 1];
  const [front, setFront] = useState(question.body.slice(0, 300));
  const [back, setBack] = useState((chosen?.body ?? "").slice(0, 300));
  const [toQueue, setToQueue] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onResolve(question, true);
      if (toQueue && front.trim() && back.trim()) {
        const have = new Set(lc.lecture.slides.map((s) => s.n));
        await addAnswerCard({
          lectureId: lc.lecture.id,
          part: question.part_idx,
          anchor: question.anchor,
          front: front.trim(),
          back: back.trim(),
          slides: citedSlides(`${front} ${back}`).filter((n) => have.has(n)).slice(0, 12),
          commentId: question.id,
        });
        lc.ctx.say("נוספה כרטיסייה לתור שלך · רק לך");
      }
      onDone();
    } catch (e) {
      setError(failText(e instanceof Error ? e.message : "", "cards"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="a-card flat k-mine a-stack">
      <div className="a-row between">
        <span className="a-row">
          <Icon name="cards" size={14} />
          <b className="a-small">לסמן שנענתה, וכרטיסייה לתור שלך</b>
        </span>
        <span className="a-chip">רק לך</span>
      </div>
      <label className="a-field">
        <span>השאלה</span>
        <textarea className="a-input" dir="auto" rows={2} maxLength={300} value={front} onChange={(e) => setFront(e.target.value)} />
      </label>
      <label className="a-field">
        <span>התשובה</span>
        <textarea className="a-input" dir="auto" rows={3} maxLength={300} value={back} onChange={(e) => setBack(e.target.value)} />
      </label>
      <label className="a-choice">
        <input type="checkbox" checked={toQueue} onChange={(e) => setToQueue(e.target.checked)} />
        <span>להוסיף לתור שלי</span>
      </label>
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
      <div className="a-row sheet-actions">
        <button className="a-btn primary" disabled={busy || (toQueue && (front.trim().length < 3 || !back.trim()))} onClick={() => void save()}>
          {busy ? "שומר…" : "לסמן שנענתה"}
        </button>
        <button className="a-btn ghost" onClick={onDone}>
          ביטול
        </button>
      </div>
    </div>
  );
}
