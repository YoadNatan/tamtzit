import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import ChipRow, { ChipDot } from "../components/ChipRow";
import type { Section } from "../lib/api";
import { groupChips, paragraphChips, privateLine, quoteAt, spotKey, type ParagraphChips } from "../lib/anchor";
import { flags } from "../lib/flags";
import { useParagraphPulse } from "./pulse";
import type { LectureCtx, LectureExt, Spot } from "./types";
import { useParagraphWall } from "./wall";
import "../styles/anchor.css";

/* ── Package N's slot (§12.2.3, §12.4.N): the paragraph anchor ──
 *
 * Under each paragraph of a ready part, the chip row (components/ChipRow):
 * the group's questions, cards, the wall's leading entry (J's slot) and the
 * comments, each opening the paragraph's sheet on its tab, and one line only
 * the member sees. While following a reader the row is one dot; while
 * reading aloud, nothing. The sheet's "תרגול" tab (components/PracticeTab,
 * lazy) lists the paragraph's questions and cards with her own state and
 * starts "לתרגל את הפסקה". Small and static; the tab loads with the sheet.
 * Behind VITE_STUDY_ANCHOR (with questions or cards), against section N. */

const Tab = lazy(() => import("../components/PracticeTab"));

/* ── One lecture's chips, shared by the reader's hook and the sheet's tab
 *    label ("תרגול · 4"), so nothing is fetched twice ── */
type Store = { rows: Map<string, ParagraphChips>; v: number; subs: Set<() => void> };
const stores = new Map<string, Store>();
function storeOf(lectureId: string): Store {
  let s = stores.get(lectureId);
  if (!s) stores.set(lectureId, (s = { rows: new Map(), v: 0, subs: new Set() }));
  return s;
}
function publish(lectureId: string, rows: ParagraphChips[]) {
  const s = storeOf(lectureId);
  s.rows = new Map(rows.map((r) => [spotKey(r.part_idx, r.anchor), r]));
  s.v += 1;
  s.subs.forEach((f) => f());
}
/** The tab's count after it loaded (it lists exactly that paragraph). */
export function setPracticeCount(lectureId: string, spot: Pick<Spot, "part" | "anchor">, questions: number, cards: number) {
  const s = storeOf(lectureId);
  const k = spotKey(spot.part, spot.anchor);
  const have = s.rows.get(k);
  if (have && have.questions === questions && have.cards === cards) return;
  s.rows = new Map(s.rows).set(k, {
    ...(have ?? { part_idx: spot.part, anchor: spot.anchor, comments: 0, aids: 0, my_wrong: 0, my_unclear: false }),
    questions,
    cards,
  });
  s.v += 1;
  s.subs.forEach((f) => f());
}
function useStore(lectureId: string): Store {
  const s = storeOf(lectureId);
  useSyncExternalStore(
    (f) => {
      s.subs.add(f);
      return () => void s.subs.delete(f);
    },
    () => s.v,
  );
  return s;
}

/** "תרגול · 4" in the sheet's tab row: the paragraph's questions and cards, or null when unknown. */
export function usePracticeCount(lectureId: string, spot: Pick<Spot, "part" | "anchor">): number | null {
  const s = useStore(lectureId);
  if (!flags.anchor) return null;
  const r = s.rows.get(spotKey(spot.part, spot.anchor));
  return r ? r.questions + r.cards : s.v ? 0 : null;
}

/** N's additions to the lecture: the chip row under each paragraph
 *  (blockExtras), one dot while following, nothing while reading aloud. */
export function useLectureN(lc: LectureCtx): LectureExt {
  const on = flags.anchor;
  const lectureId = lc.lecture.id;
  const store = useStore(lectureId);
  const wall = useParagraphWall(lc);
  const pulse = useParagraphPulse(lc);
  // Read again when a part changes (a rewrite, a correction) and when the
  // member comes back to the page (an answer or a card from another screen).
  const parts = lc.sections.map((s) => `${s.idx}:${s.status}:${s.gen ?? 0}:${s.rev ?? 0}`).join(",");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const again = () => document.visibilityState === "visible" && setTick((n) => n + 1);
    document.addEventListener("visibilitychange", again);
    window.addEventListener("pageshow", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("pageshow", again);
    };
  }, [on]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    paragraphChips(lectureId)
      .then((rows) => alive && publish(lectureId, rows))
      .catch(() => undefined); // the chips are extra: the reader stays as it is
    return () => {
      alive = false;
    };
  }, [on, lectureId, parts, tick]);

  if (!on) return {};
  const open = (part: number, anchor: number, tab: Parameters<LectureCtx["openParagraph"]>[1]) =>
    lc.openParagraph({ part, anchor, quote: quoteAt(part, anchor) }, tab);
  return {
    part: (s: Section) => ({
      blockExtras: (anchor: number) => {
        if (lc.reading) {
          // The reader's screen stays clean, but for U's "קשה לנו · כדאי להאט" (P-13).
          const hard = pulse(s.idx, anchor);
          return hard ? (
            <div key="n" className="n-anchor" data-spot={spotKey(s.idx, anchor)}>
              <div className="a-wrap n-chips">{hard}</div>
            </div>
          ) : null;
        }
        const c = store.rows.get(spotKey(s.idx, anchor));
        const chips = groupChips(c ?? { questions: 0, cards: 0 }, lc.notes(s.idx, anchor));
        const w = wall(s.idx, anchor);
        const p = pulse(s.idx, anchor);
        const mine = c ? privateLine(c, flags.today) : "";
        if (!chips.length && !w && !p && !mine) return null;
        if (lc.following) return <ChipDot key="n" spot={spotKey(s.idx, anchor)} />;
        return <ChipRow key="n" spot={spotKey(s.idx, anchor)} chips={chips} wall={w} pulse={p} mine={mine} onOpen={(tab) => open(s.idx, anchor, tab)} />;
      },
    }),
  };
}

/** The paragraph sheet's "תרגול" tab (rendered by the ParagraphSheet frame), or null. */
export function PracticeTab(p: { lc: LectureCtx; spot: Spot }) {
  if (!flags.anchor) return null;
  return (
    <Suspense fallback={<p className="a-small a-muted loading">טוען…</p>}>
      <Tab {...p} />
    </Suspense>
  );
}
