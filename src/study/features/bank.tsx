import { useEffect, useRef } from "react";
import type { Lecture } from "../lib/api";
import type { Ctx } from "./types";

/* ── Package B's slot (§12.2.3) ──
 * Seeded by F1Δ; package B owns this file. Yoad's decision 2 (17 Nov 2026)
 * redefines B: no question or card is written automatically, so nothing is
 * "בהכנה במצב חסכוני" and the upload asks nothing. What B does instead, the
 * points to know read on the server once the summary is written, shows on
 * practice 2.0's setup screen (PracticeCreate.tsx, readProgress's `ahead`). */

/** The addendum's "השאלות בהכנה במצב חסכוני…" line: never shown (nothing is
 *  written ahead). Kept as F's slot so Q's and C's pages need no change. */
export function BankLine(_p: { ctx: Ctx; lectureId: string; kind: "questions" | "cards" }) {
  return null;
}

/** After an upload (F's Upload, after W's afterUpload). The addendum's
 *  "להכין גם שאלות וכרטיסיות?" is removed (decision 2): questions and cards
 *  are made only on a member's tap, and the points to know need no question
 *  (the server reads them after the summary, within the cap). It calls onDone
 *  once, at once, and the upload goes on to the lecture. */
export function BankAfterUpload({ onDone }: { ctx: Ctx; lecture: Lecture; onDone: () => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);
  return null;
}
