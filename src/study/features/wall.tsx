import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { Comment } from "../lib/api";
import { flags } from "../lib/flags";
import { RouteLink } from "../components/Shell";
import type { Ctx, LectureCtx, LectureExt, Spot } from "./types";

/* ── Package J's slot (§12.2.3; §12.5.J): the association wall ──
 *
 * Small and static: the hooks and the entry points. The wall's screens
 * (WallScreen: the wall, its drafts, the composer), "יחד"'s card, the
 * paragraph sheet's tab, the moment's sheet, the hint and the card's back
 * line, and the data module (lib/wall.ts), load lazily (review F-8), only
 * with VITE_STUDY_WALL. It replaces the spec's memory aids (op "mnemonic"
 * routes to J's server module). */

/** The wall (?v=wall: a lecture's or a drug's; x: its drafts, composer, a moment). */
export const WallScreen = lazy(() => import("../components/Wall"));

const Parts = () => import("../components/WallParts");
const Week = lazy(() => Parts().then((m) => ({ default: m.WeekCard })));
const Tab = lazy(() => Parts().then((m) => ({ default: m.ParagraphWallTab })));
const Hint = lazy(() => Parts().then((m) => ({ default: m.HintCard })));
const Back = lazy(() => Parts().then((m) => ({ default: m.BackLine })));
const Moment = lazy(() => import("../components/WallComposer").then((m) => ({ default: m.MomentSheet })));

/** "אסוציאציית השבוע" on "יחד", and credit requests, or null. */
export function WallCard({ ctx }: { ctx: Ctx }) {
  if (!flags.wall) return null;
  return (
    <Suspense fallback={null}>
      <Week ctx={ctx} />
    </Suspense>
  );
}

/** The paragraph sheet's "אסוציאציה" tab (rendered by K's ParagraphSheet), or null. */
export function ParagraphWall({ lc, spot }: { lc: LectureCtx; spot: Spot }) {
  if (!flags.wall) return null;
  return (
    <Suspense fallback={<p className="a-muted loading">טוען…</p>}>
      <Tab lc={lc} spot={spot} />
    </Suspense>
  );
}

/** J's additions to the lecture: the "אסוציאציות" chip in the action row,
 *  and "לנעוץ רגע" in the follower's one sticky bar (after M's "לא ברור לי")
 *  and in the reader's bar while reading aloud: a sheet over the reader, on
 *  the paragraph being read. */
export function useLectureJ(lc: LectureCtx): LectureExt {
  const [moment, setMoment] = useState<{ part: number; anchor: number } | null>(null);
  if (!flags.wall) return {};
  const go = lc.ctx.go;
  const place = lc.place;
  const pin = place ? (
    <button type="button" className="a-btn wall-moment" onClick={() => setMoment({ part: place.part, anchor: place.anchor })}>
      לנעוץ רגע
    </button>
  ) : null;
  return {
    chips: (
      <RouteLink to={{ v: "wall", l: lc.lecture.id }} go={go} className="a-chip fun wall-chip">
        אסוציאציות
      </RouteLink>
    ),
    followBar: lc.following ? pin : undefined,
    readerBar: lc.reading ? pin : undefined,
    overlay: moment ? (
      <Suspense fallback={null}>
        <Moment
          ctx={lc.ctx}
          lecture={lc.lecture}
          sections={lc.sections}
          part={moment.part}
          anchor={moment.anchor}
          figureUrl={lc.figureUrl}
          onClose={() => setMoment(null)}
        />
      </Suspense>
    ) : undefined,
  };
}

/** The hint on a card's front after two own lapses (C's review), or null. */
export function CardHint({ cardId, lapses }: { ctx: Ctx; cardId: string; lapses: number }) {
  if (!flags.wall || lapses < 2) return null;
  return (
    <Suspense fallback={null}>
      <Hint cardId={cardId} />
    </Suspense>
  );
}

/** The card's back: "בגב: ׳…׳ · {name}" (W-24), or null. A J-2 addition to
 *  the slot (C's review renders it under a revealed card). */
export function CardBackLine({ lectureId, cardId }: { lectureId: string; cardId: string }) {
  if (!flags.wall) return null;
  return (
    <Suspense fallback={null}>
      <Back lectureId={lectureId} cardId={cardId} />
    </Suspense>
  );
}

/** "להעביר לקיר האסוציאציות" under a group answer (K's thread, K6): the
 *  composer, prefilled with the answer and a credit to its author (only with
 *  their yes), or null. */
export function ToWall({ ctx, lecture, spot, comment }: { ctx: Ctx; lecture: string; spot: Spot; comment: Comment }) {
  if (!flags.wall) return null;
  const move = async () => {
    const { setComposerSeed } = await import("../lib/wall");
    const author = comment.author_id && comment.author_id !== ctx.userId ? { id: comment.author_id, name: ctx.nameOf(comment.author_id) } : null;
    setComposerSeed({
      lectureId: lecture,
      part: spot.part,
      anchor: spot.anchor,
      mode: "line",
      body: comment.body.replace(/^\*\*שאלה:\*\*[^\n]*\n+/, "").slice(0, 500),
      credit: author && author.name ? author : null,
    });
    ctx.go({ v: "wall", l: lecture, at: { part: spot.part, anchor: spot.anchor }, x: "post" });
  };
  return (
    <button type="button" className="a-link wall-to" onClick={() => void move()}>
      להעביר לקיר האסוציאציות
    </button>
  );
}

/* The wall's entries of a lecture, for N's chip row: one read per lecture,
 * live, shared by every paragraph's chip. */
type Lead = { body: string; quote: string; n: number };
const leads = new Map<string, Map<string, Lead>>();
const listeners = new Map<string, Set<() => void>>();

/** The paragraph's leading association, for N's chip row: a chip with its
 *  first words that opens the sheet's "אסוציאציה" tab. */
export function useParagraphWall(lc: LectureCtx): (part: number, anchor: number) => ReactNode {
  const lectureId = lc.lecture.id;
  const groupId = lc.ctx.group.id;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!flags.wall) return;
    let alive = true;
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => setTick((n) => n + 1);
    const set = listeners.get(lectureId) ?? new Set();
    set.add(bump);
    listeners.set(lectureId, set);
    void import("../lib/wall").then((lib) => {
      if (!alive) return;
      const load = () =>
        lib
          .getWall(groupId, { lecture: lectureId })
          .then((rows) => {
            const by = new Map<string, Lead>();
            for (const a of lib.tabRows(rows, "top")) {
              if (a.flag) continue;
              const k = `${a.part_idx}.${a.anchor}`;
              const cur = by.get(k);
              by.set(k, cur ? { ...cur, n: cur.n + 1 } : { body: a.body, quote: a.quote, n: 1 });
            }
            leads.set(lectureId, by);
            for (const f of listeners.get(lectureId) ?? []) f();
          })
          .catch(() => undefined);
      void load();
      stop = lib.watchWall(lectureId, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 400);
      });
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop?.();
      set.delete(bump);
    };
  }, [lectureId, groupId]);
  return (part, anchor) => {
    if (!flags.wall) return null;
    const lead = leads.get(lectureId)?.get(`${part}.${anchor}`);
    if (!lead) return null;
    const words = lead.body.replace(/\[ש['׳][^\]]*\]/g, "").trim().split(/\s+/).slice(0, 3).join(" ");
    return (
      <button
        key="wall"
        type="button"
        className="a-chip fun n-chip"
        data-chip="wall"
        aria-label={`אסוציאציה: ${lead.body}`}
        onClick={() => lc.openParagraph({ part, anchor, quote: lead.quote }, "mnemonic")}
      >
        <bdi>{words.length > 22 ? `${words.slice(0, 22)}…` : words}</bdi>
      </button>
    );
  };
}
