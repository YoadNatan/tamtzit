import { lazy, Suspense, useEffect, useState } from "react";
import { Loading, RouteLink } from "../components/Shell";
import { flags } from "../lib/flags";
import type { Ctx, LectureCtx, Spot } from "./types";

/* ── Package E's slot (§12.2.3): phase-3 extras, usable early (decision 3) ──
 * Seeded by F1Δ; package E owns this file. Its screens load lazily from their
 * own files (review F-8), and so does its data module: what stays here is a
 * link and a chip. With VITE_STUDY_TRAPS and VITE_STUDY_BLANK_TABLE off, each
 * export renders nothing and reads nothing. */

/** A member's own trap on a paragraph (?v=trap&l=&at=, d a draft). */
export const TrapScreen = lazy(() => import("../components/TrapScreen"));
const BlankTable = lazy(() => import("../components/BlankTable"));
const LectureExtras = lazy(() => import("../components/ExtrasCard"));

/** "טבלה ריקה": a slide's table from memory, in Q's practice screen
 *  (?v=practice&s=b.<lecture>.<slide>), or null. */
export function BlankTableSession(p: { ctx: Ctx; lectureId: string; slide: number }) {
  if (!flags.blankTable) return null;
  return (
    <Suspense fallback={<Loading />}>
      <BlankTable key={`${p.lectureId}.${p.slide}`} {...p} />
    </Suspense>
  );
}

/** "להוסיף מלכודת משלי" in N's "תרגול" tab, or null. */
export function AddTrap({ lc, spot }: { lc: LectureCtx; spot: Spot }) {
  if (!flags.traps) return null;
  return (
    <RouteLink to={{ v: "trap", l: lc.lecture.id, at: { part: spot.part, anchor: spot.anchor } }} go={lc.ctx.go} className="a-btn add-trap">
      להוסיף מלכודת משלי
    </RouteLink>
  );
}

/** A lecture's practice: "טבלה ריקה" (its tables, with the meter) and "מלכודת
 *  משלי" (the author's meter), each with its flag; null with both off. */
export function ExtrasCard(p: { ctx: Ctx; lectureId: string; slides: ReadonlyArray<{ n: number; title?: string; tables?: unknown }> }) {
  if (!flags.blankTable && !flags.traps) return null;
  return (
    <Suspense fallback={null}>
      <LectureExtras {...p} />
    </Suspense>
  );
}

/** A member's trap in practice ("מלכודת של חבר בקבוצה") or, once a live quiz
 *  unmasked it, its author ("נכתבה ע״י רוני · נבדקה מול השקפים"); `chip` in a
 *  question's chip row, else the reveal's line. Nothing for any other
 *  question, and nothing with VITE_STUDY_TRAPS off. `source` when the caller
 *  has it (practice), else it is read (the quiz). */
export function TrapChip({ ctx, questionId, source, chip = true }: { ctx: Ctx; questionId: string; source?: string; chip?: boolean }) {
  const [who, setWho] = useState<{ member: boolean; author: string | null } | null>(null);
  const known = source !== undefined;
  useEffect(() => {
    setWho(null);
    if (!flags.traps || (known && source !== "member")) return;
    let alive = true;
    import("../lib/extras")
      .then(({ trapAuthors }) => trapAuthors([questionId]))
      .then((m) => alive && setWho(m[questionId] ?? null))
      .catch(() => undefined); // an extra: a failure only hides the line
    return () => {
      alive = false;
    };
  }, [questionId, source, known]);
  if (!flags.traps || !who?.member) return null;
  const name = who.author ? ctx.nameOf(who.author) || "חבר בקבוצה" : "";
  const text = who.author ? `נכתבה ע״י ${name} · נבדקה מול השקפים` : "מלכודת של חבר בקבוצה";
  return chip ? <span className="a-chip fun trap-chip">{text}</span> : <p className="a-small a-muted trap-author">{text}</p>;
}

/** The rounds "המלכודות שלנו" and "מי אני?" in Z's quiz setup (Q11: design only), or null. */
export function RoundPicker(_p: { ctx: Ctx; onPick: (kind: "member" | "whoami") => void }) {
  return null;
}
