import type { CSSProperties } from "react";
import { avgOutOf, bandKey, type Stats } from "../lib/sets";
import { SETS, statsAvg, statsCounted, statsMine, statsNames, statsQuestion, statsSolvers } from "../lib/setsCopy";

/* ── The group's numbers on a set (practice sets, design §5.7, OD5) ──
 * "פותרים: k" always and the member's own score ("שלי"); the group's average
 * and how each question went for the group only once at least 3 OTHER
 * members whom Pulse counts finished (the server sends neither before,
 * study_qset_stats), both over the first 3 (6, …) of them to finish and
 * without the viewer, the average rounded ("הממוצע והתוצאות: 3 הפותרים
 * הראשונים, בעיגול"), each question as one of three bands; no best
 * score. Names only of members who chose to show theirs, never with a score.
 * Each member counts with their first finished attempt, scored on the first
 * answer per question. `compact`: the round's end (the bands stay on the
 * set's page). */

export default function SetStats({ stats, size, compact = false }: { stats: Stats | null; size: number; compact?: boolean }) {
  if (!stats) return null;
  const n = stats.mine?.total || size;
  const avg = avgOutOf(stats.avg, n);
  const mine = stats.mine ? Math.max(0, Math.min(100, Math.round((100 * stats.mine.right_n) / Math.max(1, stats.mine.total)))) : null;
  const enough = stats.others >= stats.floor;
  return (
    <section className="a-card qs-stats" aria-label={statsSolvers(stats.solvers)} data-compact={compact ? "" : undefined}>
      <div className="a-row between qs-stats-head">
        <b>{statsSolvers(stats.solvers)}</b>
        {avg !== null ? <b className="qs-avg">{statsAvg(avg, n)}</b> : null}
      </div>
      {stats.mine ? (
        <div className="a-meter qs-mine">
          <div className="a-bar" role="img" aria-label={statsMine(stats.mine.right_n, stats.mine.total)}>
            <i style={{ width: `${mine}%`, background: "var(--me-pop)" } as CSSProperties} />
          </div>
          <span className="a-small">{statsMine(stats.mine.right_n, stats.mine.total)}</span>
        </div>
      ) : (
        <p className="a-small a-muted">{SETS.stats.mineNotYet}</p>
      )}
      {!enough ? <p className="a-small a-muted qs-wait">{SETS.stats.wait}</p> : null}
      {enough && !compact && stats.per_q?.some((p) => p.band !== null) ? (
        <details className="qs-perq">
          <summary>{SETS.stats.perQ}</summary>
          <ul className="a-list">
            {stats.per_q
              .filter((p) => p.band !== null)
              .map((p) => (
                <li key={p.question_id} className="a-small qs-band" data-band={p.band}>
                  <span>{statsQuestion(p.pos)}</span> <b>{SETS.stats.bands[bandKey(p.band!)]}</b>
                  {p.band === 1 ? <span className="a-chip warn">{SETS.stats.hard}</span> : null}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      {enough && stats.counted > 0 && avg !== null ? <p className="a-small a-muted qs-counted">{statsCounted(stats.counted)}</p> : null}
      {stats.names.length ? <p className="a-small qs-names">{statsNames(stats.names)}</p> : null}
      <p className="a-small a-muted qs-privacy">{SETS.stats.privacy}</p>
    </section>
  );
}
