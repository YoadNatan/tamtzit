import { useEffect, useState } from "react";
import type { Ctx } from "../features/types";
import { flags } from "../lib/flags";
import { practiceOverview } from "../lib/practice";
import { lectureMaking, shelf, type Making } from "../lib/sets";
import { lectureSets, makeOpen, SETS } from "../lib/setsCopy";
import "../styles/sets.css";
import { RouteLink } from "./Shell";

/* ── Practice sets: the lecture page's row after reading (design-practice §5.1) ──
 * Under the summary, "אחרי הקריאה" is one row: "סט חדש" (the create screen on
 * this lecture) and the lecture's practice, "לפתור" once the lecture has a
 * bank. It loads lazily through the slot (features/qsets.tsx), with its words
 * and its read of the bank's size, so the lecture page's entry code holds
 * only a condition. With VITE_STUDY_SETS (WP14) it adds "סטים על ההרצאה (n)
 * ‹" (the shelf on this lecture) and, while someone makes a set on it, D6's
 * line "יש סט בהכנה על ההרצאה · מאת {name} · k/n" with "לפתוח את הסט". */

export default function MakeEntry({ ctx, lectureId }: { ctx: Ctx; lectureId: string }) {
  const [bank, setBank] = useState(0);
  const [sets, setSets] = useState(0);
  const [making, setMaking] = useState<Making | null>(null);
  useEffect(() => {
    let alive = true;
    practiceOverview(ctx.group.id)
      .then((rows) => alive && setBank(rows.find((r) => r.lecture_id === lectureId)?.questions ?? 0))
      .catch(() => undefined); // offline: the row without the bank's word
    if (flags.sets) {
      shelf(ctx.group.id, lectureId, 40)
        .then((rows) => alive && setSets(rows.filter((r) => !r.is_hidden).length))
        .catch(() => undefined);
      lectureMaking(lectureId)
        .then((rows) => alive && setMaking(rows.find((r) => r.author_name) ?? null))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [ctx.group.id, lectureId]);
  return (
    <div className="mk-after-wrap">
      <div className="a-row mk-after" role="group" aria-label="אחרי הקריאה">
        <RouteLink to={{ v: "practice", l: lectureId, x: "new" }} go={ctx.go} className="a-btn mk-after-new">
          {SETS.entry}
        </RouteLink>
        <RouteLink to={{ v: "practice", l: lectureId }} go={ctx.go} className="a-btn mk-after-solve">
          {bank > 0 ? SETS.set.solve : "תרגול על ההרצאה"}
        </RouteLink>
        {sets > 0 ? (
          <RouteLink to={{ v: "sets", l: lectureId }} go={ctx.go} className="a-link mk-after-sets">
            {lectureSets(sets)} ‹
          </RouteLink>
        ) : null}
      </div>
      {making ? (
        <p className="a-small mk-after-open" role="status">
          {makeOpen(making.author_name || "", making.made, making.want)}{" "}
          <RouteLink to={{ v: "sets", k: making.set_id }} go={ctx.go} className="a-link mk-after-open-go">
            {SETS.make.openGo} ‹
          </RouteLink>
        </p>
      ) : null}
    </div>
  );
}
