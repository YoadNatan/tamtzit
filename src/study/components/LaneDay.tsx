import { blockRow, blockTimes, clockOf, dayRows, minutesOfClock, nextBlock, type Block, type LectureFact } from "../../../shared/study/lane";
import { isolateLatin } from "../lib/rich";

/* ── One day of a lane: its blocks as plan.html s1 lists them (package G) ──
 * The time, the block's title, its slides and line, and one chip: "בעוד 20
 * דק׳" (or "עכשיו") on the block that comes next today, "הוזז מאתמול" on a
 * block that moved from a day that slipped. A read block and the quiz after
 * it on the same lecture are one row ("הקראה ומבחן קבוצתי, 5 שאלות"). Used
 * by the plan's day and by a marathon's run-of-show. No red, no "מאחרים". */

const slidesTag = (s: [number, number] | null) => (s ? (s[0] === s[1] ? `ש׳ ${s[0]}` : `ש׳ ${s[0]}-${s[1]}`) : "");

export default function LaneDay({
  blocks,
  start,
  facts,
  nowMin,
  movedLabel = "הוזז מאתמול",
  current,
  label,
}: {
  blocks: readonly Block[];
  start: string;
  facts: Record<string, LectureFact>;
  /** Minutes after midnight now, when the day is today (the "בעוד" chip). */
  nowMin?: number | null;
  movedLabel?: string;
  /** The step on screen in a live marathon. */
  current?: number;
  label: string;
}) {
  const times = blockTimes(blocks, start);
  const last = blocks.length ? clockOf(minutesOfClock(times[blocks.length - 1]) + blocks[blocks.length - 1].min) : start;
  /** When the row ending before step j ends: step j's start, or the day's end. */
  const endOf = (j: number) => times[j] ?? last;
  const next = nowMin === null || nowMin === undefined ? null : nextBlock(blocks, start, nowMin);
  return (
    <ul className="a-list pl-day" aria-label={label}>
      {dayRows(blocks).map(({ i, block, next: q }) => {
        const row = blockRow(block, facts, q, endOf(i + (q ? 2 : 1)));
        const tag = slidesTag(row.slides);
        const chip =
          current !== undefined && current >= 0 && (current === i || (q && current === i + 1))
            ? { text: "עכשיו", cls: "busy" }
            : next && (next.i === i || (q && next.i === i + 1))
              ? { text: next.chip, cls: "busy" }
              : block.moved
                ? { text: movedLabel, cls: "group" }
                : null;
        return (
          <li key={i} className={`a-li pl-row${block.k === "break" ? " pl-break" : ""}`} data-k={block.k}>
            <b className="a-small pl-time">{times[i]}</b>
            <div className="pl-body">
              <b dir="rtl">{isolateLatin(row.title, `pt${i}`)}</b>
              {tag || row.line ? (
                <span className="m" dir="rtl">
                  {tag ? <span className="a-tag">{tag}</span> : null}
                  {tag && row.line ? " " : ""}
                  {row.line}
                </span>
              ) : null}
            </div>
            {chip ? <span className={`a-chip ${chip.cls}`}>{chip.text}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
