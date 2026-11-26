import { Fragment } from "react";
import { parseTable } from "../lib/sheetPure";
import "../styles/sheetForms.css";

/* ── An uploaded item's text exactly as printed (uploaded sheets, release A1;
 *    design-exams §5.6, D8) ──
 * The sheet reader keeps the lines and stores a printed table as Markdown
 * pipe rows. Here each line stays a line (each with its own direction, so an
 * English line in a Hebrew question reads left to right), a table is a
 * <table> inside a focusable labelled region that scrolls sideways on a
 * phone, "[?]" (a word the reader could not read) is a chip "מילה לא
 * ברורה", and "[…]" (an item cut at its limit) says so under the text. */

const UNCLEAR = /\[\?\]/g;

function Line({ text, k }: { text: string; k: string }) {
  const parts = text.split(UNCLEAR);
  return (
    <span className="st-line" dir="auto">
      {parts.map((p, i) => (
        <Fragment key={`${k}-${i}`}>
          {p.replace(/\[…\]/g, "…")}
          {i < parts.length - 1 ? (
            <span className="a-chip warn st-unclear" title="מילה לא ברורה">
              מילה לא ברורה
            </span>
          ) : null}
        </Fragment>
      ))}
    </span>
  );
}

export default function SheetText({ text, label, className }: { text: string; label: string; className?: string }) {
  const blocks = parseTable(text);
  const cut = /\[…\]/.test(text);
  let tables = 0;
  return (
    <div className={`sheet-text${className ? ` ${className}` : ""}`}>
      {blocks.map((b, i) =>
        b.kind === "text" ? (
          <p key={i} className="st-p">
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j ? <br /> : null}
                <Line text={l} k={`${i}-${j}`} />
              </Fragment>
            ))}
          </p>
        ) : (
          <div key={i} className="sheet-table" tabIndex={0} role="region" aria-label={`טבלה ${++tables > 1 ? `${tables} ` : ""}בשאלה ${label}`}>
            <table>
              <thead>
                <tr>
                  {b.rows[0].map((c, j) => (
                    <th key={j} scope="col" dir="auto">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.slice(1).map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, j) => (
                      <td key={j} dir="auto">
                        {c || <span className="sr-only">ריק</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
      {cut ? <p className="a-small a-muted st-cut">הטקסט ארוך מדי ונחתך · כדאי לבדוק מול העמוד</p> : null}
    </div>
  );
}
