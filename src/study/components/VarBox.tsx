import type { Go } from "../features/types";
import { CERTAINTY, type DisputeRow } from "../lib/var";
import { RouteLink } from "./Shell";
import { SlideTagOf, vText } from "./VerdictCard";
import "../styles/var.css";

/* ── Under a paragraph in the reader (package V) ──
 * The pinned "פסיקת VAR" box after "לקבל" (corrections.html s2's "הפסיקה
 * ננעצת בסיכום"), and the chip of a yellow card that is still open or
 * waits for its decision. Rendered after the block, never inside it. */

export default function VarBox({ rows, go }: { rows: DisputeRow[]; go: Go }) {
  return (
    <>
      {rows.map((d) =>
        d.state === "accepted" && d.verdict ? (
          <aside key={d.id} className="a-callout v-box" aria-label="פסיקת VAR">
            <div className="a-row between">
              <b className="a-small">
                פסיקת <bdi dir="ltr">VAR</bdi>
              </b>
              <span className={`a-chip ${(CERTAINTY[d.verdict.certainty] ?? CERTAINTY.unclear).chip}`.trim()}>{(CERTAINTY[d.verdict.certainty] ?? CERTAINTY.unclear).label}</span>
            </div>
            <span className="a-small">
              {vText(d.verdict.summary, `vb${d.id}`)} <SlideTagOf slides={[...new Set([...d.slides_a, ...d.slides_b])].sort((a, b) => a - b)} />
            </span>
            <RouteLink to={{ v: "dispute", d: d.id }} go={go} className="a-link v-box-link">
              לכרטיס הצהוב
            </RouteLink>
          </aside>
        ) : (
          <RouteLink key={d.id} to={{ v: "dispute", d: d.id }} go={go} className="a-chip warn v-open">
            {d.state === "judged" ? "כרטיס צהוב · יש פסיקה" : "כרטיס צהוב · פתוח"}
          </RouteLink>
        ),
      )}
    </>
  );
}
