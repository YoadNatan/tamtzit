import { useEffect, useState } from "react";
import type { Ctx } from "../features/types";
import { practiceOverview } from "../lib/practice";
import { RouteLink } from "./Shell";

/* ── Practice sets: the lecture page's row after reading (design-practice §5.1) ──
 * Under the summary, "אחרי הקריאה" is one row: "סט חדש" (the create screen on
 * this lecture) and the lecture's practice, "לפתור" once the lecture has a
 * bank. It loads lazily through the slot (features/qsets.tsx), with its words
 * and its read of the bank's size, so the lecture page's entry code holds
 * only a condition. */

export default function MakeEntry({ ctx, lectureId }: { ctx: Ctx; lectureId: string }) {
  const [bank, setBank] = useState(0);
  useEffect(() => {
    let alive = true;
    practiceOverview(ctx.group.id)
      .then((rows) => alive && setBank(rows.find((r) => r.lecture_id === lectureId)?.questions ?? 0))
      .catch(() => undefined); // offline: the row without the bank's word
    return () => {
      alive = false;
    };
  }, [ctx.group.id, lectureId]);
  return (
    <div className="a-row mk-after" role="group" aria-label="אחרי הקריאה">
      <RouteLink to={{ v: "practice", l: lectureId, x: "new" }} go={ctx.go} className="a-btn mk-after-new">
        סט חדש
      </RouteLink>
      <RouteLink to={{ v: "practice", l: lectureId }} go={ctx.go} className="a-btn mk-after-solve">
        {bank > 0 ? "לפתור" : "תרגול על ההרצאה"}
      </RouteLink>
    </div>
  );
}
