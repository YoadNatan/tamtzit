import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { flags } from "../lib/flags";
import type { Section } from "../lib/api";
import type { DisputeRow } from "../lib/var";
import { RouteLink } from "../components/Shell";
import type { Ctx, LectureCtx, LectureExt, UpdateRow } from "./types";

/* ── Package V's slot (§12.2.3; §12.4.V): disputes, VAR, the lecture's log ──
 *
 * Small and static: the reader's hook and three entry points. The screens,
 * the box under a paragraph, "יחד"'s card, the update card and the data
 * module (lib/var.ts) load lazily (review F-8), only with VITE_STUDY_VAR. */

/** One yellow card (?v=dispute&d=). */
export const DisputeScreen = lazy(() => import("../components/DisputeScreen"));

/** A lecture's log (?v=log&l=). */
export const LogScreen = lazy(() => import("../components/LogScreen"));

const VarBox = lazy(() => import("../components/VarBox"));
const DisputesList = lazy(() => import("../components/DisputesCard"));
const Update = lazy(() => import("../components/UpdateCard"));

/** A lecture's yellow cards, live (study-disputes-<lecture>). */
function useLectureDisputes(lectureId: string | null): DisputeRow[] {
  const [rows, setRows] = useState<DisputeRow[]>([]);
  useEffect(() => {
    if (!lectureId) return;
    let alive = true;
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void import("../lib/var").then((lib) => {
      if (!alive) return;
      const load = () =>
        lib
          .lectureDisputes(lectureId)
          .then((r) => alive && setRows(r))
          .catch(() => undefined);
      void load();
      stop = lib.watchLectureDisputes(lectureId, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 300);
      });
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop?.();
    };
  }, [lectureId]);
  return rows;
}

/** V's additions to the lecture: under a paragraph, the pinned "פסיקת VAR"
 *  box (after "לקבל") or the chip of its open yellow card; in the action
 *  row, "יומן התיקונים". */
export function useLectureV(lc: LectureCtx): LectureExt {
  const rows = useLectureDisputes(flags.var ? lc.lecture.id : null);
  const byBlock = useMemo(() => {
    const out = new Map<string, DisputeRow[]>();
    for (const d of rows) out.set(`${d.part_idx}:${d.anchor}`, [...(out.get(`${d.part_idx}:${d.anchor}`) ?? []), d]);
    return out;
  }, [rows]);
  if (!flags.var) return {};
  const go = lc.ctx.go;
  return {
    chips: (
      <RouteLink to={{ v: "log", l: lc.lecture.id }} go={go} className="a-chip v-log-chip">
        יומן התיקונים
      </RouteLink>
    ),
    part: rows.length
      ? (s: Section) => ({
          blockExtras: (anchor: number) => {
            const here = byBlock.get(`${s.idx}:${anchor}`);
            if (!here?.length) return null;
            return (
              <Suspense fallback={null}>
                <VarBox rows={here} go={go} />
              </Suspense>
            );
          },
        })
      : undefined,
  };
}

/** Open yellow cards on "יחד" (and, until Today ships, the member's own "עדכון" cards), or null. */
export function DisputesCard({ ctx }: { ctx: Ctx }) {
  if (!flags.var) return null;
  return (
    <Suspense fallback={null}>
      <DisputesList ctx={ctx} />
    </Suspense>
  );
}

/** "עדכון בסיכום" in Today's queue; onDone once it was seen ("הבנתי"). */
export function UpdateCard({ ctx, update, onDone }: { ctx: Ctx; update: UpdateRow; onDone: () => void }) {
  if (!flags.var) return null;
  return (
    <Suspense fallback={null}>
      <Update ctx={ctx} update={update} onDone={onDone} />
    </Suspense>
  );
}
