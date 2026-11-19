import { db, run } from "./quizOpen";
import type { Exhibit, MuseumMeter, TrapCardKind } from "../../../shared/study/museum";

/* ── The museum's calls (package U, U-3; spec §12.5.U, the fun design §5.4) ──
 * Each names its function and arguments literally, so npm run test:contract
 * checks them against the loaded schema. Every read runs the night first
 * (through study_pulse_ready), so each is a POST. The database is the
 * referee: only a member the last night counted reads an exhibit or a
 * badge, and nothing shows before it opens (section U, U-3). */

export type { Exhibit, MuseumMeter, TrapCardKind } from "../../../shared/study/museum";

export const getMuseum = (groupId: string, lectureId?: string) =>
  run<Exhibit[]>(db().rpc("study_museum", lectureId ? { p_group: groupId, p_lecture: lectureId } : { p_group: groupId }));
export const getMuseumMeter = (groupId: string, lectureId?: string) =>
  run<MuseumMeter>(db().rpc("study_museum_meter", lectureId ? { p_group: groupId, p_lecture: lectureId } : { p_group: groupId }));

type TrapCardRow = { card_id: string; trap_id: string; lecture_id: string; exhibit_no: number | null; kind: "trap" | "museum" };
let cache: { group: string; at: number; p: Promise<Map<string, TrapCardKind>> } | null = null;
/** The open trap cards of the group, by card (the one chip on a trap card;
 *  one read a minute per phone, shared by every card on screen). */
export function trapCards(groupId: string): Promise<Map<string, TrapCardKind>> {
  if (cache && cache.group === groupId && Date.now() - cache.at < 60_000) return cache.p;
  const p = run<TrapCardRow[]>(db().rpc("study_trap_cards", { p_group: groupId }))
    .then((rows) => new Map(rows.map((r) => [r.card_id, { kind: r.kind, exhibit_no: r.exhibit_no }] as const)))
    .catch(() => {
      cache = null; // try again next time; the card keeps C's own chip meanwhile
      return new Map<string, TrapCardKind>();
    });
  cache = { group: groupId, at: Date.now(), p };
  return p;
}

/** MU4: the exhibit a meeting may open with (null: none, or not a reader). */
export const museumPick = (lectureId: string) => run<string | null>(db().rpc("study_museum_pick", { p_lecture: lectureId }));
/** MU4: the meeting opened with it (once is enough). */
export const museumShown = (trapId: string) => run<null>(db().rpc("study_museum_shown", { p_trap: trapId }));
