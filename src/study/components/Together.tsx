import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon } from "./Icon";
import { Avatar, SheetClose } from "./Shell";
import SummaryView, { isolateLatin } from "./SummaryView";
import type { Comment, CommentKind, InRoom } from "../lib/api";

/* ── Studying together ──
 *
 * Shoham's group reads every lecture together: one reads aloud and the others
 * follow on their own phones. "Anything that improves group learning is the
 * most essential part." Three pieces live here:
 *
 *  - RoomBar: who has the lecture open right now, and "follow the reader":
 *    the reader's place scrolls the others' screens. One line, so the sticky
 *    header stays small on a phone.
 *  - ThreadPanel: comments and questions on one paragraph, with replies, and
 *    a question can be marked answered by anyone (who marked it shows, K's
 *    end). ThreadSheet shows it in a sheet of its own; K's ParagraphSheet on
 *    its "תגובות" tab. A shared answer from "לשאול" reads "שותפה ע״י {שם}": a
 *    member's token wrote it, not Claude (review B1.3); Claude's attempt,
 *    attached to a question asked from "לשאול", folds under "מצורף: הניסיון
 *    של Claude לענות" (ask.html s2).
 *  - QuestionsSheet: the lecture's open questions, to jump to each one.
 *
 * Copy is gender-neutral (infinitives and nouns): the group is mixed.
 */

export function timeAgo(iso: string, now = Date.now()): string {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

/** A sheet takes the focus when it opens, gives it back to whatever opened it
 * when it closes, and closes on Escape (also K's ParagraphSheet's). */
export function useSheet(box: RefObject<HTMLElement>, onClose: () => void) {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [box]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/* ─────────────────────────── the room ─────────────────────────── */

export type FollowState = "off" | "on" | "paused" | "waiting";

type RoomProps = {
  /** Members present now, already checked against the group. */
  people: InRoom[];
  me: string;
  nameOf: (userId: string) => string;
  reading: boolean;
  following: string | null;
  follow: FollowState;
  onRead: (on: boolean) => void;
  onFollow: (userId: string | null) => void;
  onResume: () => void;
  /** The open-questions button, kept on this row so the header stays one line. */
  extra?: ReactNode;
  /** While reading aloud with the meeting's bar above ("N עוקבים"), who is here
   *  gives way, so "ההקראה שלך משותפת" stays whole (review M-SHARED-LABEL-TWICE). */
  hideHere?: boolean;
};

export function RoomBar({ people, me, nameOf, reading, following, follow, onRead, onFollow, onResume, extra, hideHere }: RoomProps) {
  const others = people.filter((p) => p.user_id !== me);
  const names = others.map((p) => nameOf(p.user_id) || "ללא שם");
  const shown = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
  const readers = others.filter((p) => p.reading);
  const followedName = following ? nameOf(following) || "ללא שם" : "";

  let action: ReactNode;
  if (reading) {
    action = (
      <>
        <span className="room-status">ההקראה שלך משותפת</span>
        <button className="a-btn small" onClick={() => onRead(false)}>
          לסיים
        </button>
      </>
    );
  } else if (following && follow === "waiting") {
    action = (
      <>
        <span className="room-status">ההקראה של {followedName} נעצרה לרגע</span>
        <button className="a-btn small" onClick={() => onFollow(null)}>
          להפסיק
        </button>
      </>
    );
  } else if (following && follow === "paused") {
    action = (
      <>
        <button className="a-btn primary small" onClick={onResume}>
          חזרה להקראה
        </button>
        <button className="a-btn ghost small" onClick={() => onFollow(null)}>
          להפסיק
        </button>
      </>
    );
  } else if (following) {
    action = (
      <>
        <span className="room-status following">מעקב: {followedName}</span>
        <button className="a-btn small" onClick={() => onFollow(null)}>
          להפסיק
        </button>
      </>
    );
  } else if (readers.length) {
    const r = readers[0];
    action = (
      <>
        <span className="room-status">הקראה: {nameOf(r.user_id) || "ללא שם"}</span>
        <button className="a-btn primary small" onClick={() => onFollow(r.user_id)}>
          לעקוב
        </button>
      </>
    );
  } else {
    action = (
      <button className="a-btn ghost small" onClick={() => onRead(true)}>
        להקריא לקבוצה
      </button>
    );
  }

  return (
    <div className="ph-sub room-bar" aria-live="polite">
      {others.length && !hideHere ? (
        <span className="room-here" title={names.join(", ")}>
          <span className="room-dot" aria-hidden="true" />
          <span className="room-names">כאן: {shown}</span>
        </span>
      ) : null}
      <span className="room-action">{action}</span>
      {extra}
    </div>
  );
}

/* ─────────────────────────── one paragraph's thread ─────────────────────────── */

type ThreadProps = {
  quote: string;
  comments: Comment[];
  me: string;
  nameOf: (userId: string) => string;
  /** The text being typed, kept by the page so closing the sheet never loses it. */
  draft: string;
  onDraft: (text: string) => void;
  onSend: (kind: CommentKind, body: string, parentId: string | null) => Promise<void>;
  onResolve: (c: Comment, resolved: boolean) => Promise<void>;
  onDelete: (c: Comment) => Promise<void>;
  onClose: () => void;
};

/** What section K's end adds to a comment (read beside F's columns). */
export type CommentExtra = { ask_attempt: boolean; resolved_by: string | null };

export type ThreadPanelProps = Omit<ThreadProps, "quote" | "onClose"> & {
  /** Claude's attempt and who marked a question answered, by comment id. */
  extras?: Record<string, CommentExtra>;
  /** The asker marks her own question answered: K's card sheet instead of the plain mark. */
  onAskerResolve?: (c: Comment) => void;
  /** Under a member's answer to a question (J's "להעביר לקיר האסוציאציות"). */
  afterAnswer?: (c: Comment) => ReactNode;
};

/** A top-level note a member shared from another screen (its words are Claude's or the wall's, a member posted them). */
const SHARED_LABEL: Partial<Record<CommentKind, string>> = { answer: "תשובה מ״לשאול״", mnemonic: "אסוציאציה" };

/** The thread over the reader: its own sheet, headed by the paragraph's
 *  first words (a paragraph sheet with more tabs renders ThreadPanel inside
 *  its own frame, components/ParagraphSheet.tsx). */
export function ThreadSheet({ onClose, ...thread }: ThreadProps) {
  const box = useRef<HTMLElement>(null);
  useSheet(box, onClose);
  return (
    <div className="a-scrim" onClick={onClose}>
      <section
        ref={box}
        tabIndex={-1}
        className="a-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="תגובות ושאלות על הפסקה"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="a-sheet-head">
          <p className="a-small a-muted sheet-quote" dir="rtl">
            {isolateLatin(thread.quote ? `״${thread.quote}…״` : "הפסקה", "q")}
          </p>
          <SheetClose onClick={onClose} />
        </header>
        <ThreadPanel {...thread} />
      </section>
    </div>
  );
}

/** One paragraph's comments and questions, and the composer. */
export function ThreadPanel({ comments, me, nameOf, draft, onDraft, onSend, onResolve, onDelete, extras, onAskerResolve, afterAnswer }: ThreadPanelProps) {
  const [kind, setKind] = useState<CommentKind>("comment");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [confirm, setConfirm] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tops = comments.filter((c) => !c.parent_id);
  const isAttempt = (c: Comment) => Boolean(extras?.[c.id]?.ask_attempt);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSend(replyTo ? "comment" : kind, text, replyTo?.id ?? null);
      onDraft("");
      setReplyTo(null);
    } catch {
      setError("לא נשלח. כדאי לבדוק את החיבור ולנסות שוב.");
    } finally {
      setBusy(false);
    }
  };

  const act = (fn: () => Promise<void>) => () => void fn().catch(() => setError("הפעולה לא הצליחה."));

  /** Claude's attempt, folded under the question it came with (ask.html s2). */
  const attempt = (c: Comment) => (
    <details key={c.id} className="note k-attempt">
      <summary className="a-row">
        <Icon name="chat" size={14} />
        <span className="a-small a-muted">מצורף: הניסיון של <bdi dir="ltr">Claude</bdi> לענות</span>
      </summary>
      <div className="a-callout quiet">
        <SummaryView markdown={c.body} compact />
      </div>
    </details>
  );

  /** One note: the thread's first, or a reply under a rule in the same card. */
  const item = (c: Comment, reply: boolean, parent?: Comment) => {
    const replies = repliesOf(c.id).filter((r) => !isAttempt(r)).length;
    const who = nameOf(c.author_id) || "ללא שם";
    const shared = !reply ? SHARED_LABEL[c.kind] : undefined;
    const answers = reply && parent?.kind === "question";
    const markedBy = !reply && c.kind === "question" && c.resolved ? extras?.[c.id]?.resolved_by : null;
    return (
      <div key={c.id} className={`note${reply ? " reply" : ""}${c.kind === "question" ? " question" : ""}${c.resolved ? " resolved" : ""}`}>
        <div className="a-row between note-head">
          <span className="a-row">
            <Avatar id={c.author_id} name={who} />
            <b>{who}</b>
            <span className="a-small a-muted">{answers ? `${timeAgo(c.created_at)} · תשובה` : timeAgo(c.created_at)}</span>
          </span>
          {c.kind === "question" && !reply ? (
            <span className={`a-chip ${c.resolved ? "ok" : "warn"}`}>{c.resolved ? "שאלה שנענתה" : "שאלה פתוחה"}</span>
          ) : shared ? (
            <span className="a-chip busy">{shared}</span>
          ) : null}
        </div>
        {shared ? (
          <div className="note-body note-rich">
            <SummaryView markdown={c.body} compact />
            <p className="a-small a-muted">שותפה ע״י {who}</p>
          </div>
        ) : (
          <p dir="auto" className="a-para note-body">
            {isolateLatin(c.body, `n${c.id}`)}
          </p>
        )}
        {!reply ? repliesOf(c.id).filter(isAttempt).map(attempt) : null}
        {markedBy ? <p className="a-small a-muted">סומנה שנענתה: {nameOf(markedBy) || "ללא שם"}</p> : null}
        {confirm?.id === c.id ? (
          <div className="a-row note-confirm" role="alert">
            <span>{replies ? `למחוק, יחד עם ${replies === 1 ? "התשובה" : `${replies} התשובות`}?` : "למחוק?"}</span>
            <button
              className="a-btn danger small"
              onClick={act(async () => {
                await onDelete(c);
                setConfirm(null);
              })}
            >
              מחיקה
            </button>
            <button className="a-btn ghost small" onClick={() => setConfirm(null)}>
              ביטול
            </button>
          </div>
        ) : (
          <div className="a-row note-actions">
            {!reply ? (
              <button className="a-link" onClick={() => setReplyTo(c)}>
                תשובה
              </button>
            ) : null}
            {c.kind === "question" && !reply ? (
              <button
                className="a-link"
                onClick={!c.resolved && c.author_id === me && onAskerResolve ? () => onAskerResolve(c) : act(() => onResolve(c, !c.resolved))}
              >
                {c.resolved ? "לפתוח מחדש" : "לסמן שנענתה"}
              </button>
            ) : null}
            {c.author_id === me ? (
              <button className="a-link danger push" onClick={() => setConfirm(c)}>
                מחיקה
              </button>
            ) : null}
          </div>
        )}
        {answers && afterAnswer ? afterAnswer(c) : null}
      </div>
    );
  };

  return (
    <>
      {tops.length ? (
        <ul className="a-stack notes">
          {tops.map((t) => (
            <li key={t.id} className={`a-card flat thread${t.kind === "question" ? " question" : ""}${t.resolved ? " resolved" : ""}`}>
              {item(t, false)}
              {repliesOf(t.id)
                .filter((r) => !isAttempt(r))
                .map((r) => [<div key={`d${r.id}`} className="a-divider" />, item(r, true, t)])}
            </li>
          ))}
        </ul>
      ) : (
        <p className="a-small a-muted">עוד אין כאן תגובות. אפשר לשאול את הקבוצה או להוסיף הערה למה שנאמר בהרצאה.</p>
      )}
      <div className="a-stack composer">
        {replyTo ? (
          <p className="a-small a-muted">
            תשובה ל{nameOf(replyTo.author_id) ? `־${nameOf(replyTo.author_id)}` : "תגובה"}{" "}
            <button className="a-link" onClick={() => setReplyTo(null)}>
              ביטול
            </button>
          </p>
        ) : (
          <div className="a-seg composer-kind" role="radiogroup" aria-label="סוג">
            <button className="a-btn small" role="radio" aria-checked={kind === "comment"} onClick={() => setKind("comment")}>
              תגובה
            </button>
            <button className="a-btn small" role="radio" aria-checked={kind === "question"} onClick={() => setKind("question")}>
              שאלה לקבוצה
            </button>
          </div>
        )}
        <div className="composer-row">
          <textarea
            className="a-input"
            dir="auto"
            rows={2}
            maxLength={2000}
            value={draft}
            aria-label={replyTo ? "התשובה" : kind === "question" ? "השאלה" : "התגובה"}
            placeholder={replyTo ? "התשובה שלך" : kind === "question" ? "מה לא ברור בפסקה?" : "הערה, תיקון או משהו שנאמר בהרצאה"}
            onChange={(e) => onDraft(e.target.value)}
          />
          <button className="a-btn primary" disabled={!draft.trim() || busy} onClick={() => void send()}>
            {busy ? "בשליחה…" : "לשלוח"}
          </button>
        </div>
        {error ? (
          <p className="a-error a-small" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

/* ─────────────────────────── open questions ─────────────────────────── */

type QuestionsProps = {
  questions: Comment[];
  nameOf: (userId: string) => string;
  onPick: (q: Comment) => void;
  onClose: () => void;
};

export function QuestionsSheet({ questions, nameOf, onPick, onClose }: QuestionsProps) {
  const box = useRef<HTMLElement>(null);
  useSheet(box, onClose);
  return (
    <div className="a-scrim" onClick={onClose}>
      <section ref={box} tabIndex={-1} className="a-sheet" role="dialog" aria-modal="true" aria-label="שאלות פתוחות" onClick={(e) => e.stopPropagation()}>
        <header className="a-sheet-head">
          <h2>שאלות פתוחות</h2>
          <SheetClose onClick={onClose} />
        </header>
        <ul className="a-list notes">
          {questions.map((q) => (
            <li key={q.id} className="note question">
              <button className="a-li note-jump" onClick={() => onPick(q)}>
                <div>
                  <span className="m" dir="rtl">
                    {isolateLatin(q.quote ? `״${q.quote}…״` : "", `j${q.id}`)}
                  </span>
                  <b dir="auto" className="note-body">
                    {isolateLatin(q.body, `b${q.id}`)}
                  </b>
                  <span className="m">
                    {nameOf(q.author_id) || "ללא שם"} · {timeAgo(q.created_at)}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
