import { db, run } from "./quizOpen";
import type { BossOpen, LootRow } from "../../../shared/study/boss";

/* ── The boss battle's calls (package H, H-1; spec §12.5.H) ──
 * Each names its function and arguments literally, so npm run test:contract
 * checks them against the loaded schema. A battle itself is Z's quiz
 * (?v=quiz&q=): its state, answers and reveals are Z's calls; the HUD reads
 * study_quiz_state's `boss`. No Claude: a battle costs $0. */

export type { BossOpen, BossState, LootRow } from "../../../shared/study/boss";

/** The heads a battle on these lectures (every lecture by default) would have, the revenge round and the meter. */
export const bossOpen = (groupId: string, lectures?: string[]) =>
  run<BossOpen>(db().rpc("study_boss_open", lectures && lectures.length ? { p_group: groupId, p_lectures: lectures } : { p_group: groupId }));
/** Opens a battle as a live quiz in mode "boss" (its lobby); a revenge round takes the lost battle's id. */
export const bossCreate = (o: { groupId: string; lectures: string[] | null; seconds: number; revenge?: string }) =>
  run<string>(
    db().rpc(
      "study_boss_create",
      o.revenge
        ? { p_group: o.groupId, p_lectures: null, p_seconds: o.seconds, p_revenge: o.revenge }
        : { p_group: o.groupId, p_lectures: o.lectures, p_seconds: o.seconds },
    ),
  );
/** The caller's own loot of a battle (B3), previewed. */
export const bossLoot = (quizId: string) => run<LootRow[]>(db().rpc("study_boss_loot", { p_quiz: quizId }));
/** "לתוכנית שלי": the loot becomes the caller's private review list. */
export const bossLootSave = (quizId: string) => run<number>(db().rpc("study_boss_loot_save", { p_quiz: quizId }));
/** A loot item answered in Today's queue. */
export const lootDone = (questionId: string) => run<number>(db().rpc("study_loot_done", { p_question: questionId }));
