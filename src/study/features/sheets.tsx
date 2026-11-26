import { lazy, Suspense } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import { flags } from "../lib/flags";

/* ── Uploaded sheets' slot (docs/study/sheets.md; VITE_STUDY_SHEETS) ──
 * Only these stubs are in the study entry chunk (bundle owner O, capped at
 * 1,500 B): no words, no data module. Package Q's slot (features/practice.tsx)
 * shows the upload of a past exam or an exercise sheet, SheetUpload, in the
 * place of past exams' own while the flag is on; the review is past exams'
 * screen (ExamView), which reads the flag itself. On the join screen opened
 * from an upload's link (?v=exams&e=…) with no member on the device, a card
 * says how to reach it (a home-screen app keeps its own storage, so a link
 * that opens in the browser starts signed out). */

export const SheetUpload = lazy(() => import("../components/SheetUpload"));
const Card = lazy(() => import("../components/DeepLinkCard"));

/** Above Join when the address is an upload's link; nothing otherwise. */
export function SheetJoinNote({ onCode }: { onCode?: () => void }) {
  return flags.sheets && /[?&]v=exams\b/.test(location.search) && /[?&]e=/.test(location.search) ? (
    <ErrorBoundary reset="sheet-join" fallback="none">
      <Suspense fallback={null}>
        <Card onCode={onCode} />
      </Suspense>
    </ErrorBoundary>
  ) : null;
}
