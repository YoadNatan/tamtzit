import { useEffect, useState, type ReactNode } from "react";
import { groupSpent, health } from "../lib/api";
import { flags } from "../lib/flags";
import { matches } from "../lib/guide";
import { helpRows } from "../lib/helpCopy";
import { isolateLatin } from "../lib/rich";
import { writingHelp } from "../features/writing";
import type { Ctx } from "../features/types";
import { Head } from "./Shell";

/** "$12.40", and a cap of "$33" without cents. */
const dollars = (n: number) => "$" + (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Help's footer for members: "השימוש של הקבוצה החודש: $12.40 מתוך $33". */
export function HelpSpend({ ctx }: { ctx: Ctx }) {
  const [line, setLine] = useState("");
  useEffect(() => {
    let alive = true;
    Promise.all([groupSpent(ctx.group.id), health()])
      .then(([spent, h]) => {
        if (!alive) return;
        const cap = h?.budgetUsd;
        setLine("השימוש של הקבוצה החודש: " + "$" + spent.toFixed(2) + (cap ? " מתוך " + dollars(cap) : ""));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  return line ? <>{line}</> : null;
}

/* ── Help (spec §6.2: F renders) ──
 * The help screen (?v=help). The rows are lib/helpCopy.ts's, each shown with
 * its flag; what W has shipped comes from W's slot. */

const t = (s: string, k: string) => isolateLatin(s, k);

type HelpProps = {
  /** The top bar's back arrow (help opens only inside the app, for members). */
  back: ReactNode;
  /** The spend line ("השימוש של הקבוצה החודש: …"). */
  footer?: ReactNode;
  /** The guide's "איך עושים…?" for members (VITE_STUDY_GUIDE): its search also
   *  filters the rows below, which then come under "כל ההסברים". */
  howto?: (query: string, onQuery: (q: string) => void) => ReactNode;
};

export default function Help({ back, footer, howto }: HelpProps) {
  const [query, setQuery] = useState("");
  const rows = helpRows(flags, writingHelp());
  const shown = howto && query.trim() ? rows.filter((r) => matches(query, `${r.title} ${r.text}`)) : rows;
  return (
    <main className="help">
      <Head back={back} title="עזרה" />
      {howto ? howto(query, setQuery) : null}
      {howto ? (
        <div className="a-sec">
          <h2>כל ההסברים</h2>
        </div>
      ) : null}
      <div className="a-list help-rows">
        {shown.map((r, i) => (
          <details key={r.title} open={false}>
            <summary>{r.title}</summary>
            <p className="a-para">{t(r.text, `h${i}`)}</p>
          </details>
        ))}
      </div>
      {footer ? <p className="a-small a-muted help-foot">{footer}</p> : null}
    </main>
  );
}
