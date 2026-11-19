import type { MyTrap } from "../../../shared/study/extras";
import { postStudy, sb } from "./api";

/* ── Package E's data (spec §12.6.E): a member's own trap, the blank table ──
 *
 * Supabase and /api/study/ai calls for E's screens. Nothing here is imported
 * statically by the entry chunk: the slot module (features/extras.tsx) loads
 * it with import() when a flag of E is on, and E's screens import it inside
 * their own lazy chunks. Every wrapper throws Error(code) with the database's
 * or the op's code; the screens turn codes into words with failText(code,
 * "traps") (the blank table's card: "cards").
 *
 * Who sees what: a draft is its author's alone (RLS: study_trap_drafts own);
 * a passed trap is a question in everyone's bank with no author until a live
 * quiz's reveal unmasks it (study_questions.author_id, null till then); a
 * blank table's wrong cell is a private card (study_my_cards, owner-only). */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}

export type TrapDraft = {
  id: string;
  lecture_id: string;
  part_idx: number;
  anchor: number | null;
  quote: string;
  vignette: string;
  question: string;
  options: string[];
  answer: number;
  note: string;
  slides: number[];
  state: "draft" | "ok" | "rejected";
  problem: string;
  question_id: string | null;
  created_at: string;
  updated_at: string;
};
export type MyTrapRow = TrapDraft & { unmasked: boolean };

const DRAFT_COLUMNS = "id, lecture_id, part_idx, anchor, quote, vignette, question, options, answer, note, slides, state, problem, question_id, created_at, updated_at";

/** The member's own drafts (RLS: hers alone), newest first, each with
 *  whether its question has been unmasked by a live quiz. */
export async function myTraps(): Promise<MyTrapRow[]> {
  const { data, error } = await client().from("study_trap_drafts").select(DRAFT_COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (error) fail(error);
  const rows = (data ?? []) as TrapDraft[];
  const ids = rows.flatMap((r) => (r.question_id ? [r.question_id] : []));
  const named = new Set<string>();
  if (ids.length) {
    const q = await client().from("study_questions").select("id, unmasked_at").in("id", ids);
    if (q.error) fail(q.error);
    for (const r of (q.data ?? []) as Array<{ id: string; unmasked_at: string | null }>) if (r.unmasked_at) named.add(r.id);
  }
  return rows.map((r) => ({ ...r, unmasked: Boolean(r.question_id && named.has(r.question_id)) }));
}

/** The rows the meter counts. */
export const meterRows = (rows: readonly MyTrapRow[]): MyTrap[] => rows.map((r) => ({ state: r.state, created_at: r.created_at, unmasked: r.unmasked }));

export type TrapInput = {
  draft: string | null;
  lectureId: string;
  part: number;
  anchor: number | null;
  quote: string;
  vignette: string;
  question: string;
  options: string[];
  answer: number;
  note: string;
  slides: number[];
};

/** Saves (or, after a rejection, rewrites) the draft; its id. */
export async function submitTrap(t: TrapInput): Promise<string> {
  const { data, error } = await client().rpc("study_trap_submit", {
    p_draft: t.draft,
    p_lecture: t.lectureId,
    p_part: t.part,
    p_anchor: t.anchor,
    p_quote: t.quote,
    p_vignette: t.vignette,
    p_question: t.question,
    p_options: t.options,
    p_answer: t.answer,
    p_note: t.note,
    p_slides: t.slides,
  });
  if (error) fail(error);
  return String(data);
}

export type TrapVerdict = { ok: boolean; problem: string; questionId: string | null };

/** "לבדוק מול השקפים" (op trap_check, ≈ $0.03). */
export async function checkTrap(draftId: string): Promise<TrapVerdict> {
  const res = await postStudy("/api/study/ai", { op: "trap_check", draftId });
  const body = (await res.json().catch(() => ({}))) as Partial<TrapVerdict> & { error?: string };
  if (!res.ok || typeof body.ok !== "boolean") throw new Error(body.error ?? `http_${res.status}`);
  return { ok: body.ok, problem: body.problem ?? "", questionId: body.questionId ?? null };
}

/** Whether these questions are members' traps, and the author of each one a
 *  live quiz has unmasked (null until then). Only with section E. */
export async function trapAuthors(ids: string[]): Promise<Record<string, { member: boolean; author: string | null }>> {
  if (!ids.length) return {};
  const { data, error } = await client().from("study_questions").select("id, source, author_id, unmasked_at").in("id", ids);
  if (error) fail(error);
  const out: Record<string, { member: boolean; author: string | null }> = {};
  for (const r of (data ?? []) as Array<{ id: string; source: string; author_id: string | null; unmasked_at: string | null }>) {
    out[r.id] = { member: r.source === "member", author: r.unmasked_at ? r.author_id : null };
  }
  return out;
}

export type SlideTable = { lecture_id: string; slide: number; tbl: number; n_rows: number; n_cols: number; max_cell: number };

/** The tables on the group's slides, by shape (section E's study_slide_tables). */
export async function slideTables(groupId: string): Promise<SlideTable[]> {
  const { data, error } = await client().rpc("study_slide_tables", { p_group: groupId });
  if (error) fail(error);
  return (data ?? []) as SlideTable[];
}

/** A wrong cell of a blank table becomes the member's private card (section
 *  C's study_my_card_add, origin 'table'), once: a card with the same front
 *  already in her deck is not added again. True when added. */
export async function addTableCard(c: { lectureId: string; part: number; front: string; back: string; slide: number }): Promise<boolean> {
  const have = await client().from("study_my_cards").select("id").eq("lecture_id", c.lectureId).eq("origin", "table").eq("front", c.front).is("deleted_at", null).limit(1);
  if (have.error) fail(have.error);
  if ((have.data ?? []).length) return false;
  const { error } = await client().rpc("study_my_card_add", {
    p_lecture: c.lectureId,
    p_origin: "table",
    p_part: c.part,
    p_anchor: null,
    p_front: c.front,
    p_back: c.back,
    p_slides: [c.slide],
    p_comment: null,
  });
  if (error) {
    if (error.message === "already") return false;
    fail(error);
  }
  return true;
}
