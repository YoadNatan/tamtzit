import "../styles/pulse.css";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ASPECT_HE, aspectOf } from "../../../shared/study/aspects";
import { flags } from "../lib/flags";
import { getNeeded, getSpots, pulseReady, type Needed } from "../lib/pulse";
import type { Ctx, LectureCtx } from "./types";

/* ── Package U's slot (§12.2.3): the anonymous counts, the pulse, the museum ──
 * U-1 and U-2 (wave 5): the pulse's screen loads lazily from its own file
 * (review F-8); the card on "יחד", the setting under "שלי", the paragraph's
 * chip and "דרושה אסוציאציה" for J's wall are here, small, each behind the
 * flag `pulse`. U-3 (wave 5, phase 3, usable early by decision 3): the museum
 * (MuseumScreen, lazy), its card on "יחד", the one chip on a trap card
 * (CardBadge, with "למה זה כאן?" as VaccineWhy) and the meeting's opening
 * exhibit (ExhibitCard), each behind the flag `museum` and loaded on its own
 * chunk (components/MuseumParts.tsx). */

/** The group's pulse (?v=pulse, one lecture with l). */
export const PulseScreen = lazy(() => import("../components/Pulse"));

/** "{topic} · {aspect}" as the screens show it: the topic isolated (a drug's
 *  Latin name or a Hebrew topic), so the dot never jumps to the line's start. */
export function TopicLabel({ topic, aspect }: { topic: string; aspect: string }) {
  const a = aspectOf(aspect);
  return (
    <>
      <bdi>{topic}</bdi>
      {a === "other" ? null : <> · {ASPECT_HE[a]}</>}
    </>
  );
}

/** The trap museum (?v=museum): U-3. */
export const MuseumScreen = lazy(() => import("../components/Museum"));

const LazyCard = lazy(() => import("../components/PulseParts").then((m) => ({ default: m.PulseCardBody })));
const LazyMuseumCard = lazy(() => import("../components/MuseumParts").then((m) => ({ default: m.MuseumCardBody })));
const LazyBadge = lazy(() => import("../components/MuseumParts").then((m) => ({ default: m.TrapBadgeBody })));
const LazyExhibit = lazy(() => import("../components/MuseumParts").then((m) => ({ default: m.ExhibitBody })));
const LazySetting = lazy(() => import("../components/PulseParts").then((m) => ({ default: m.PulseSettingBody })));

/** P-11 "דופק הקבוצה" on "יחד" (its body loads with its own chunk). */
export function PulseCard({ ctx }: { ctx: Ctx }) {
  if (!flags.pulse) return null;
  return (
    <Suspense fallback={null}>
      <LazyCard ctx={ctx} />
    </Suspense>
  );
}

/** The museum's card on "יחד" (U-3): the newest exhibit and the meter. */
export function MuseumCard({ ctx }: { ctx: Ctx }) {
  if (!flags.museum) return null;
  return (
    <Suspense fallback={null}>
      <LazyMuseumCard ctx={ctx} />
    </Suspense>
  );
}

/** P-12 "לא לכלול אותי בדופק" under "שלי" → הגדרות (its own chunk). */
export function PulseSettingRow({ ctx }: { ctx: Ctx }) {
  if (!flags.pulse) return null;
  return (
    <Suspense fallback={null}>
      <LazySetting ctx={ctx} />
    </Suspense>
  );
}

/** The one chip on a trap card (C's review, Today; review F-11), with the
 *  museum flag: "חיסון · ממוזיאון המלכודות · מוצג מס׳ n" for an exhibit's
 *  card, else "מלכודת של הקבוצה". Null without the flag (C keeps its own). */
export function CardBadge({ ctx, cardId }: { ctx: Ctx; cardId: string }) {
  if (!flags.museum) return null;
  return (
    <Suspense fallback={<span className="a-chip group card-badge">מלכודת של הקבוצה</span>}>
      <LazyBadge ctx={ctx} cardId={cardId} />
    </Suspense>
  );
}

/** museum.html s2's "למה זה כאן?" under a museum exhibit's card, or null. */
export function VaccineWhy({ ctx, cardId }: { ctx: Ctx; cardId: string }) {
  if (!flags.museum) return null;
  return (
    <Suspense fallback={null}>
      <LazyBadge ctx={ctx} cardId={cardId} why />
    </Suspense>
  );
}

/** MU4: the meeting opens with one exhibit of its lecture (30 seconds), or null. */
export function ExhibitCard({ ctx, lectureId, onShown }: { ctx: Ctx; lectureId: string; onShown?: () => void }) {
  if (!flags.museum) return null;
  return (
    <Suspense fallback={null}>
      <LazyExhibit ctx={ctx} lectureId={lectureId} onShown={onShown} />
    </Suspense>
  );
}

/** P-13 "הפסקה הזאת קשה לנו" for N's chip row, by paragraph ("קשה לנו · כדאי
 *  להאט" on the reader's own screen). Only paragraphs at least 3 members
 *  found hard, and only for a member the night counted (the table's policy). */
export function useParagraphPulse(lc: LectureCtx): (part: number, anchor: number) => ReactNode {
  const [spots, setSpots] = useState<Set<string> | null>(null);
  const lectureId = lc.lecture.id;
  const groupId = lc.ctx.group.id;
  useEffect(() => {
    if (!flags.pulse) return;
    let alive = true;
    pulseReady(groupId)
      .then((cut) => (cut ? getSpots(lectureId) : []))
      .then((rows) => alive && setSpots(new Set(rows.map((r) => `${r.part_idx}.${r.anchor}`))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId, lectureId]);
  const reading = lc.reading;
  return (part: number, anchor: number) =>
    spots?.has(`${part}.${anchor}`) ? (
      <span key="pulse" className="a-chip group pulse-spot" data-pulse-spot={`${part}.${anchor}`}>
        {reading ? "קשה לנו · כדאי להאט" : "הפסקה הזאת קשה לנו"}
      </span>
    ) : null;
}

/** "דרושה אסוציאציה" for J's wall (its tab "דרושות" and the request card):
 *  cards at least 3 members keep forgetting, without a winner yet. */
export function useNeededCards(groupId: string, lectureId: string | undefined): Needed[] {
  const [rows, setRows] = useState<Needed[]>([]);
  useEffect(() => {
    if (!flags.pulse) return;
    let alive = true;
    getNeeded(groupId, lectureId)
      .then((r) => alive && setRows(r ?? []))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId, lectureId]);
  return flags.pulse ? rows : [];
}
