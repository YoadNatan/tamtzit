import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { flags } from "../lib/flags";
import type { Section } from "../lib/api";
import type { RecentEdit } from "../lib/collab";
import type { Corrections } from "../lib/correctionsStore";
import { useReaderFollowers } from "./meeting";
import type { Ctx, LectureCtx, LectureExt, ParagraphSheetProps, Spot } from "./types";
import { RouteLink } from "../components/Shell";
import { ThreadSheet } from "../components/Together";
import "../styles/collab.css";

/* ── Package K's slot (spec §5.3; §12.3.K): corrections, "לשאול" ──
 *
 * Small and static: the reader's hook, the library's two hooks and the
 * entry points. Everything heavier loads lazily (review F-8): the paragraph's
 * sheet with its four tabs (ParagraphSheet.tsx), the editor and the history
 * (EditPanel.tsx), "לשאול" (AskView.tsx), "תיקונים אחרונים" (RecentEdits.tsx)
 * and the data module (lib/collab.ts), which the hooks import() when a flag
 * is on. A correction is a proposal with a source that another member
 * approves (decision 5); the reader's paragraphs show its chips through F1's
 * SummaryView hooks (blockState: the count of corrections, "תיקון ממתין
 * לאישור", the 2-s flash). */

export const AskScreen = lazy(() => import("../components/AskView"));
const SheetFrame = lazy(() => import("../components/ParagraphSheet"));
const AskSheet = lazy(() => import("../components/AskView").then((m) => ({ default: m.AskSheet })));
const AloudCard = lazy(() => import("../components/EditPanel").then((m) => ({ default: m.AloudCard })));
const RecentEdits = lazy(() => import("../components/RecentEdits"));

/* ── One lecture's corrections (lib/correctionsStore.ts, loaded lazily) ──
 * The reader's hook loads the store module when corrections are on; the
 * sheet (a lazy chunk) reads the same store through its own hook, so nothing
 * is fetched twice. */
type StoreModule = typeof import("../lib/correctionsStore");
function useLazyCorrections(lectureId: string | null): { mod: StoreModule | null; data: Corrections | null } {
  const [mod, setMod] = useState<StoreModule | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!lectureId) return;
    let alive = true;
    let close: (() => void) | undefined;
    void import("../lib/correctionsStore").then((m) => {
      if (!alive) return;
      setMod(m);
      close = m.subscribe(lectureId, () => tick((n) => n + 1));
    });
    return () => {
      alive = false;
      close?.();
    };
  }, [lectureId]);
  return { mod, data: mod && lectureId ? mod.current(lectureId) : null };
}

/** The sheet's frame is needed once a second tab or K's thread extras are on;
 *  with none of them, a paragraph's sheet is today's thread. */
const FRAMED = flags.corrections || flags.ask || flags.wall || flags.anchor;

/** A paragraph's sheet: "תגובות" · "תיקון" · "אסוציאציה" (J) · "תרגול" (N), lazily. */
export function ParagraphSheet(p: ParagraphSheetProps) {
  if (!FRAMED) return <ThreadSheet {...p.thread} onClose={p.onClose} />;
  return (
    <Suspense
      fallback={
        <div className="a-scrim">
          <section className="a-sheet" aria-busy="true" aria-label="מה יושב על הפסקה">
            <p className="a-small a-muted loading">טוען…</p>
          </section>
        </div>
      }
    >
      <SheetFrame {...p} />
    </Suspense>
  );
}

/** K's additions to the lecture: the paragraphs' correction chips, "לשאול"
 *  over the reader (review UX-12: the reading and following go on under it),
 *  and, while this phone reads aloud in the day's meeting (section M), "אישור
 *  בקול" for the paragraph being read when another member's proposal waits on
 *  it (decision 5, SEC-3), shown only while two others follow, as the
 *  reader's card counts them (M's useReaderFollowers; the database checks
 *  the same live reading and the two followers). */
export function useLectureK(lc: LectureCtx): LectureExt {
  const { mod, data } = useLazyCorrections(flags.corrections ? lc.lecture.id : null);
  const [asking, setAsking] = useState<Spot | null>(null);
  const now = Date.now();
  const part = mod && data?.loaded ? (s: Section) => ({ blockState: mod.blockStateOf(data, s, now) }) : undefined;
  const followers = useReaderFollowers();
  const at = lc.reading && followers >= 2 ? lc.place : null;
  const waiting =
    flags.corrections && flags.meeting && at && data
      ? data.proposals.find((p) => p.state === "pending" && p.part_idx === at.part && p.anchor === at.anchor && p.proposed_by !== lc.ctx.userId)
      : undefined;
  return {
    part,
    ask: flags.ask ? (spot) => setAsking(spot) : undefined,
    overlay: asking ? (
      <Suspense fallback={null}>
        <AskSheet lc={lc} spot={asking} onClose={() => setAsking(null)} />
      </Suspense>
    ) : undefined,
    readerBar: waiting ? (
      <Suspense fallback={null}>
        <AloudCard lc={lc} proposal={waiting} onDone={() => void mod?.reload(lc.lecture.id)} />
      </Suspense>
    ) : undefined,
  };
}

/** Questions left today for "לשאול" (the library's "נשארו היום 18"), or null while unknown. */
export function useAsksLeft(ctx: Ctx): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!flags.ask) return;
    let alive = true;
    import("../lib/collab")
      .then((lib) => lib.asksLeft(ctx.group.id))
      .then((n) => alive && setLeft(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  return left;
}

/** The library card's chip, "2 תיקונים חדשים": corrections of the last 7
 *  days that still stand (not undone, not an undo), to the latest one. */
export function useEditsChip(ctx: Ctx): (lectureId: string) => ReactNode {
  const [recent, setRecent] = useState<RecentEdit[]>([]);
  useEffect(() => {
    if (!flags.corrections) return;
    let alive = true;
    import("../lib/collab")
      .then((lib) => lib.recentEdits(7))
      .then((r) => alive && setRecent(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  const byLecture = useMemo(() => {
    const undone = new Set(recent.map((e) => e.undo_of).filter(Boolean));
    const out = new Map<string, RecentEdit[]>();
    for (const e of recent) {
      if (e.source_kind === "undo" || e.undo_of || undone.has(e.id)) continue;
      out.set(e.lecture_id, [...(out.get(e.lecture_id) ?? []), e]);
    }
    return out;
  }, [recent]);
  return (lectureId) => {
    const list = byLecture.get(lectureId);
    if (!flags.corrections || !list?.length) return null;
    const last = list[0];
    return (
      <RouteLink to={{ v: "lecture", l: lectureId, at: { part: last.part_idx, anchor: last.anchor } }} go={ctx.go} className="a-chip busy k-chip">
        {list.length === 1 ? "תיקון חדש" : `${list.length} תיקונים חדשים`}
      </RouteLink>
    );
  };
}

/** "תיקונים אחרונים" on "יחד": proposals that wait for a second member, and
 *  the corrections of the last days, live (review UX-26). */
export function RecentEditsCard({ ctx }: { ctx: Ctx }) {
  if (!flags.corrections) return null;
  return (
    <Suspense fallback={null}>
      <RecentEdits ctx={ctx} />
    </Suspense>
  );
}
