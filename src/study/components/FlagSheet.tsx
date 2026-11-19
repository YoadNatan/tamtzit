import { useState } from "react";
import { REASONS, type FlagReason } from "../../../shared/study/aspects";
import type { Flag } from "../lib/practice";
import { richText } from "../lib/rich";
import { Sheet } from "./Shell";

/* ── "מה לא בסדר בשאלה?" (P6; package Q, design-questions §1.3) ──
 *
 * A flag goes to the group: a reason and an optional note, shown under the
 * question with the member's name. It takes the question out of nobody's
 * practice: there is no "for everyone" box (package Q's review, finding Q2;
 * the addendum's SEC-13). "להסתיר ממני" takes it out of this person's own
 * practice on this device only, with no flag. A member who flagged it
 * already sees "הסימון שלך" and can delete it. */

const ORDER: FlagReason[] = ["wrong_key", "two_answers", "not_in_slides", "unclear", "duplicate", "other"];

export type FlagSheetProps = {
  myFlag: Flag | null;
  onSend: (reason: FlagReason, note: string) => Promise<void>;
  onDelete: (flag: Flag) => Promise<void>;
  onHide: () => void;
  onClose: () => void;
};

export default function FlagSheet({ myFlag, onSend, onDelete, onHide, onClose }: FlagSheetProps) {
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Sheet label="מה לא בסדר בשאלה?" className="flag-sheet" onClose={onClose} head={<h2>מה לא בסדר בשאלה?</h2>}>
      {(sheet) =>
        myFlag ? (
          <div className="flag-mine">
            <p dir="rtl">
              {richText(`הסימון שלך: ${REASONS[myFlag.reason] ?? REASONS.other}.${myFlag.note.trim() ? ` ״${myFlag.note.trim()}״` : ""}`, "mine")}
            </p>
            <div className="a-row sheet-actions">
              <button
                type="button"
                className="a-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await onDelete(myFlag);
                    sheet.close();
                  } catch {
                    setError("לא נשמר. כדאי לבדוק את החיבור ולנסות שוב.");
                    setBusy(false);
                  }
                }}
              >
                מחיקת הסימון
              </button>
              <button type="button" className="a-btn ghost" onClick={() => sheet.closeThen(onHide)}>
                להסתיר ממני
              </button>
            </div>
            {error ? <p className="a-error">{error}</p> : null}
          </div>
        ) : (
          <form
            className="flag-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!reason || busy) return;
              setBusy(true);
              setError("");
              try {
                await onSend(reason, note);
                sheet.close();
              } catch {
                setError("לא נשמר. כדאי לבדוק את החיבור ולנסות שוב.");
                setBusy(false);
              }
            }}
          >
            <fieldset className="flag-reasons">
              <legend className="sr-only">מה לא בסדר בשאלה?</legend>
              {ORDER.map((r) => (
                <label key={r} className="a-choice">
                  <input type="radio" name="flag-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                  <span>{REASONS[r]}</span>
                </label>
              ))}
            </fieldset>
            <label className="a-field flag-note">
              <span>פירוט (לא חובה)</span>
              <textarea
                className="a-input"
                value={note}
                maxLength={500}
                rows={3}
                dir="auto"
                placeholder="למשל: לפי שקף 23 גם Tafenoquine פועלת על hypnozoites"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {error ? <p className="a-error">{error}</p> : null}
            <div className="a-row sheet-actions">
              <button type="submit" className="a-btn primary" disabled={!reason || busy}>
                שליחה לקבוצה
              </button>
              <button type="button" className="a-btn ghost" onClick={() => sheet.closeThen(onHide)}>
                להסתיר ממני
              </button>
            </div>
          </form>
        )
      }
    </Sheet>
  );
}
