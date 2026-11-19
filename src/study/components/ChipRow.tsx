import type { ReactNode } from "react";
import type { SheetTab } from "../features/types";
import type { Chip } from "../lib/anchor";

/* ── The chip row under a paragraph (package N; proposal/mockups/anchor.html s1) ──
 *
 * What the group built on the paragraph, as chips ("2 שאלות" · "2 כרטיסים"
 * · the wall's leading entry · "תגובה"), each opening the paragraph's sheet
 * on its tab; then one line only the member sees ("טעית כאן פעמיים." or
 * "סימנת כאן ׳לא ברור׳", with "רק לך"). While following a reader the row
 * is one dot; while reading aloud, nothing (useLectureN decides). */

const TAB: Record<Chip["key"], SheetTab> = { questions: "practice", cards: "practice", comments: "comments" };

export default function ChipRow({
  spot,
  chips,
  wall,
  pulse,
  mine,
  onOpen,
}: {
  /** "part.anchor", for the tests and the sheet. */
  spot: string;
  chips: Chip[];
  /** J's chip (the wall's leading entry), or null. */
  wall?: ReactNode;
  /** U's "הפסקה הזאת קשה לנו", or null. */
  pulse?: ReactNode;
  /** The private line ("" for none). */
  mine: string;
  onOpen: (tab: SheetTab) => void;
}) {
  const before = chips.filter((c) => c.key !== "comments");
  const comments = chips.find((c) => c.key === "comments");
  const chip = (c: Chip) => (
    <button key={c.key} type="button" className={`a-chip n-chip${c.open ? " warn" : ""}`} data-chip={c.key} onClick={() => onOpen(TAB[c.key])}>
      {c.label}
    </button>
  );
  // The bold sentence, then the rest ("טעית כאן פעמיים." · "השאלה חוזרת מחר.").
  const cut = mine.indexOf(". ");
  const head = cut < 0 ? mine : mine.slice(0, cut + 1);
  const rest = cut < 0 ? "" : mine.slice(cut + 2);
  return (
    <div className="n-anchor" data-spot={spot}>
      {before.length || wall || pulse || comments ? (
        <div className="a-wrap n-chips" role="group" aria-label="מה יושב על הפסקה">
          {before.map(chip)}
          {wall}
          {pulse}
          {comments ? chip(comments) : null}
        </div>
      ) : null}
      {mine ? (
        <button type="button" className="a-card flat n-mine" onClick={() => onOpen("practice")}>
          <span className="a-row between">
            <span className="a-small">
              <b>{head}</b>
              {rest ? ` ${rest}` : null}
            </span>
            <span className="a-chip">רק לך</span>
          </span>
        </button>
      ) : null}
    </div>
  );
}

/** The row while following a reader: one dot, so nothing pulls the eye. */
export function ChipDot({ spot }: { spot: string }) {
  return <span className="n-dot" data-spot={spot} role="img" aria-label="על הפסקה יש שאלות, כרטיסים או תגובות" />;
}
