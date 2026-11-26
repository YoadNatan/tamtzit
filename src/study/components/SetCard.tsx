import type { Go } from "../features/types";
import { hueOf } from "../lib/hue";
import { requestStart } from "../lib/practiceSession";
import { renamed, setWhen, solvable, type ShelfRow } from "../lib/sets";
import { questionsWord, setBy, SETS, shelfMaking, statsMine, statsSolvers } from "../lib/setsCopy";
import { RouteLink } from "./Shell";

/* ── A set's card (practice sets, design §5.8; VITE_STUDY_SETS) ──
 * On the shelf "סטים של הקבוצה" and the hub's list: the lecture (its hue on
 * the start edge), "חדש" until the card is opened, the size, "מאת {name}"
 * and when, then the group's count and the member's own ("פותרים: 3 · שלי:
 * עוד לא"), or "בהכנה 6/10" while it is being made. The title is the card's
 * link to the set's page; "לפתור" starts the set from the first question it
 * has (a set still being made can be solved from one question on). The
 * heading is the set's own title when it was renamed; else the lecture's,
 * or, under a lecture's heading on the shelf (inLecture), the size. A set
 * written but not kept yet (its author left before the keep) reads "מוכן
 * לפתרון" with "לפתור" to its page, never "0 שאלות". */

export default function SetCard({ row, go, userId, compact = false, inLecture = false }: { row: ShelfRow; go: Go; userId: string; compact?: boolean; inLecture?: boolean }) {
  const making = row.state !== "ready";
  const waiting = !making && row.size === 0 && row.made > 0;
  const size = questionsWord(making ? row.want : waiting ? row.made : row.size);
  const own = renamed(row);
  const heading = own ? row.title : inLecture ? size : row.lecture_title || row.title;
  const mine = row.my_score !== null && row.my_total ? statsMine(row.my_score, row.my_total) : SETS.stats.mineNotYet;
  const when = setWhen(row.created_at);
  const by = row.author_name ? setBy(row.author_name, when) : when;
  const solve = () => {
    const r = { v: "practice" as const, s: `k.${row.id}` };
    requestStart(userId, r, false);
    go(r);
  };
  return (
    <article className="a-card qs-card" data-hue={row.lecture_id ? hueOf(row.lecture_id) : undefined} data-new={row.is_new ? "" : undefined}>
      <div className="qs-card-top">
        <RouteLink to={{ v: "sets", k: row.id }} go={go} className="qs-card-link">
          <b dir="auto">{heading}</b>
        </RouteLink>
        {row.is_new ? <span className="a-chip qs-new">{SETS.shelf.newBadge}</span> : null}
      </div>
      <p className="a-small a-muted qs-card-meta">
        {[heading === size ? null : size, by].filter(Boolean).join(" · ")}
      </p>
      {compact ? null : (
        <div className="qs-card-foot">
          <p className="a-small qs-card-nums">
            {making ? (
              <span className="a-chip busy">{row.paused ? SETS.gen.paused : shelfMaking(row.made, row.want)}</span>
            ) : waiting ? (
              <span className="a-chip">{SETS.shelf.ready}</span>
            ) : (
              `${statsSolvers(row.solvers)} · ${mine}`
            )}
          </p>
          {solvable(row) ? (
            <button type="button" className="a-btn small qs-solve" onClick={solve}>
              {SETS.set.solve}
            </button>
          ) : waiting ? (
            <RouteLink to={{ v: "sets", k: row.id }} go={go} className="a-btn small qs-solve">
              {SETS.set.solve}
            </RouteLink>
          ) : null}
        </div>
      )}
    </article>
  );
}
