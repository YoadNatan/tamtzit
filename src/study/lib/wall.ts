import type { RealtimeChannel } from "@supabase/supabase-js";
import { tidy } from "../../../shared/study/blocks";
import { blockSources, citedSlides } from "../../../shared/study/edits";
import type { Section } from "./api";
import { postStudy, readLines, sb } from "./api";

/* ── The association wall: the data (package J; spec §12.5.J) ──
 *
 * Supabase and /api/study/ai calls for J's screens. Nothing here is imported
 * statically by the entry chunk: the slot module (features/wall.tsx) loads
 * it with import() when VITE_STUDY_WALL is on, and J's screens import it
 * inside their own lazy chunks. Every wrapper throws Error(code) with the
 * database's or the op's code; the screens turn codes into words with
 * failText(code, "wall") (or "mnemonic" for the drafts' op).
 *
 * What a member reads of the wall comes from study_aid_wall: the entries
 * with the author's name only when posted by name, a credit only after the
 * credited member said yes, the totals of the votes, and the caller's own
 * votes, pin and authorship. Who wrote an entry posted without a name, who
 * voted, pins and credit requests are never published (Realtime carries
 * study_aids only, which has no author column). */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}

export type AidKind = "line" | "remix" | "sketch" | "meme" | "moment" | "draft";
/** One entry as study_aid_wall gives it to the caller. */
export type Aid = {
  id: string;
  lecture_id: string;
  lecture_title: string;
  part_idx: number;
  anchor: number;
  quote: string;
  drug: string;
  kind: AidKind;
  body: string;
  fact: string;
  slides: number[];
  photo: string | null;
  figure: string | null;
  /** The author's name, only when posted by name. */
  author: string | null;
  /** The credited member's name, only after their yes. */
  credit: string | null;
  funny_n: number;
  stuck_n: number;
  my_funny: boolean;
  my_stuck: boolean;
  mine: boolean;
  pinned: boolean;
  /** The paragraph's winner: on everyone's cards. */
  on_cards: boolean;
  /** The week's winner. */
  week: boolean;
  flag: "inaccurate" | "not_ok" | null;
  /** Who marked it; null with a flag: the check found it. */
  flagged_by: string | null;
  check_note: string;
  remix_of: string | null;
  draft_id: string | null;
  draft_no: number | null;
  created_at: string;
};

export type Technique = "משחק מילים" | "חרוז" | "סצנה הזויה";
export type Draft = { technique: Technique | string; hook: string; decode: string };
/** A paragraph's saved drafts (study_aid_drafts). */
export type DraftRow = { id: string; part_idx: number; anchor: number; src_hash: string; fact: string; slides: number[]; drafts: Draft[]; created_at: string };

export type WallTab = "top" | "new" | "needed" | "mine";

/* ─────────────────────────── pure rules ─────────────────────────── */

const votes = (a: Pick<Aid, "funny_n" | "stuck_n">) => a.funny_n + a.stuck_n;

/** The order of a tab: "הכי טובות" by votes, then more "נתקע לי", then the
 *  older (the winner's own rule); "חדשות" newest first; "שלי" the caller's
 *  pins and entries, newest first. "לא מתאים" is the author's alone (the
 *  database already left it out for everyone else). */
export function tabRows(rows: Aid[], tab: WallTab): Aid[] {
  const time = (a: Aid) => Date.parse(a.created_at);
  if (tab === "new") return [...rows].sort((a, b) => time(b) - time(a) || (a.id < b.id ? -1 : 1));
  if (tab === "mine") return rows.filter((a) => a.mine || a.pinned).sort((a, b) => time(b) - time(a));
  if (tab === "needed") return [];
  return [...rows].sort((a, b) => votes(b) - votes(a) || b.stuck_n - a.stuck_n || time(a) - time(b) || (a.id < b.id ? -1 : 1));
}

/** The kind's chip (W-2): "שרבוט", "מם", "רמיקס", "רמיקס לטיוטה של Claude", "מהפגישה", "טיוטה של Claude"; none for a line. */
export function kindChip(a: Pick<Aid, "kind" | "draft_id">): string | null {
  switch (a.kind) {
    case "sketch":
      return "שרבוט";
    case "meme":
      return "מם";
    case "remix":
      return a.draft_id ? "רמיקס לטיוטה של Claude" : "רמיקס";
    case "moment":
      return "מהפגישה";
    case "draft":
      return "טיוטה של Claude";
    default:
      return null;
  }
}

/** The mark's line (W-6), or null. */
export function markLine(a: Pick<Aid, "flag" | "flagged_by" | "check_note" | "mine">): string | null {
  if (a.flag === "not_ok") return a.mine ? "מוסתר מהקיר: סומן ׳לא מתאים׳. אפשר לתקן או למחוק." : null;
  if (a.flag === "inaccurate") return a.flagged_by ? `סומן ׳לא מדויק׳ · ${a.flagged_by}` : `לא מדויק לפי הבדיקה: ${a.check_note}`;
  return null;
}

/** The English names of a paragraph, for "על איזו תרופה?" (lower-case keys,
 *  at most 6, in order; the database keeps the drug in lower case too). */
export function drugChips(text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(/\[ש['׳][^\]]*\]/g, "").matchAll(/[A-Z][a-z][A-Za-z-]{3,}/g)) {
    const w = m[0];
    if (!out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w);
    if (out.length >= 6) break;
  }
  return out;
}

/** The composer's checks before posting (the database checks again). */
export function composerError(o: { body: string; fact: string; photo: boolean; kind: AidKind }): string | null {
  const len = (s: string) => [...s.trim()].length;
  if (len(o.body) < 3 || len(o.body) > 500) return "bad body";
  if (len(o.fact) < 3 || len(o.fact) > 300) return "bad fact";
  if ((o.kind === "sketch" || o.kind === "meme") !== o.photo) return "bad photo";
  return null;
}

/** A paragraph of a ready part: its text and first words, or null. */
export function paragraphOf(sections: Section[], part: number, anchor: number): { text: string; quote: string } | null {
  const s = sections.find((x) => x.idx === part);
  if (!s || s.status !== "ready") return null;
  const b = blockSources(tidy(s.markdown))[anchor];
  if (!b?.kind || !b.text.trim()) return null;
  return { text: b.text, quote: firstWords(b.text) };
}

/** A paragraph's first words, for a quote and a chip: no tags, no Markdown. */
export function firstWords(t: string, max = 60): string {
  const plain = t
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/\[ש['׳][^\]]*\]/g, "")
    .replace(/[*#>|_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${sp > 20 ? cut.slice(0, sp) : cut}…`;
}

/** Every paragraph of the lecture that can carry an entry, part by part ("על איזו פסקה?"). */
export function paragraphs(sections: Section[]): Array<{ part: number; title: string; anchor: number; quote: string; slides: number[] }> {
  const out: Array<{ part: number; title: string; anchor: number; quote: string; slides: number[] }> = [];
  for (const s of sections) {
    if (s.status !== "ready") continue;
    for (const b of blockSources(tidy(s.markdown))) {
      if (!b.kind || b.kind === "heading" || !b.text.trim()) continue;
      out.push({ part: s.idx, title: s.title, anchor: b.n, quote: firstWords(b.text), slides: citedSlides(b.text) });
    }
  }
  return out;
}

/** sha256 of a paragraph's text, as the op keys its drafts (null where the
 *  browser has no Web Crypto: then the latest saved drafts count as current). */
export async function paragraphHash(text: string): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text.trim()));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** The Anki Extra's line and the card's back line (W-24). */
export function backLine(a: { body: string; author: string | null }): string {
  return `בגב: ׳${a.body}׳ · ${a.author ?? "בלי שם"}`;
}
export function ankiExtra(a: { body: string; author: string | null }): string {
  return `אסוציאציה: ${a.body}${a.author ? ` (${a.author})` : ""}`;
}

/* ─────────────────────────── reading ─────────────────────────── */

/** The wall for the caller: a lecture's, a drug's across lectures, or the group's. */
export async function getWall(groupId: string, o: { lecture?: string; drug?: string } = {}): Promise<Aid[]> {
  const { data, error } = await client().rpc("study_aid_wall", { p_group: groupId, p_lecture: o.lecture ?? null, p_drug: o.drug ?? null });
  if (error) fail(error);
  return ((data ?? []) as Aid[]).map((a) => ({ ...a, slides: a.slides ?? [] }));
}

/** The week's winner's id, or null. */
export async function getWeek(groupId: string): Promise<string | null> {
  const { data, error } = await client().rpc("study_aid_week", { p_group: groupId });
  if (error) fail(error);
  return (data as string | null) ?? null;
}

/** The latest drafts saved for a paragraph, or null. */
export async function getDrafts(lectureId: string, part: number, anchor: number): Promise<DraftRow | null> {
  const { data, error } = await client()
    .from("study_aid_drafts")
    .select("id, part_idx, anchor, src_hash, fact, slides, drafts, created_at")
    .eq("lecture_id", lectureId)
    .eq("part_idx", part)
    .eq("anchor", anchor)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) fail(error);
  return ((data ?? [])[0] as DraftRow | undefined) ?? null;
}

export type CreditRequest = { aid_id: string; lecture_id: string; part_idx: number; anchor: number; body: string; fact: string; slides: number[]; asked_by: string; asked_at: string };

/** The credit requests waiting for the caller. */
export async function creditRequests(groupId: string): Promise<CreditRequest[]> {
  const { data, error } = await client().rpc("study_aid_credit_requests", { p_group: groupId });
  if (error) fail(error);
  return (data ?? []) as CreditRequest[];
}

export type Hint = { aid_id: string; body: string; fact: string; slides: number[]; photo: string | null; figure: string | null; author: string | null; pinned: boolean };

/** The hint for one of the caller's cards: her pin on its paragraph, else the group's winner. */
export async function getHint(cardId: string): Promise<Hint | null> {
  const { data, error } = await client().rpc("study_aid_hint", { p_card: cardId });
  if (error) fail(error);
  return ((data ?? [])[0] as Hint | undefined) ?? null;
}

export type CardAid = { card_id: string; aid_id: string; body: string; fact: string; slides: number[]; author: string | null; pinned: boolean; since: string };

/** The association on each of a lecture's cards (the card's back, Anki's Extra). */
export async function getForCards(lectureId: string): Promise<CardAid[]> {
  const { data, error } = await client().rpc("study_aid_for_cards", { p_lecture: lectureId });
  if (error) fail(error);
  return (data ?? []) as CardAid[];
}

/** Live: a new entry, a fix, a vote's totals or a deletion on a lecture's
 *  wall. One channel per lecture, shared by every listener on the page (the
 *  reader's chips and the sheet's tab at once): Supabase refuses a second
 *  set of callbacks on a channel that is already subscribed. */
const walls = new Map<string, { ch: RealtimeChannel; fns: Set<() => void> }>();
export function watchWall(lectureId: string, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  let w = walls.get(lectureId);
  if (!w) {
    const fns = new Set<() => void>();
    const all = () => {
      for (const f of [...fns]) f();
    };
    const ch: RealtimeChannel = sb
      .channel(`study-wall-${lectureId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "study_aids", filter: `lecture_id=eq.${lectureId}` }, all)
      // A deleted row carries only its key: listen to every delete.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "study_aids" }, all)
      .subscribe();
    w = { ch, fns };
    walls.set(lectureId, w);
  }
  const mine = w;
  mine.fns.add(onChange);
  return () => {
    mine.fns.delete(onChange);
    if (!mine.fns.size && walls.get(lectureId) === mine) {
      walls.delete(lectureId);
      void sb?.removeChannel(mine.ch);
    }
  };
}

/* ─────────────────────────── writing ─────────────────────────── */

export type NewAid = {
  lectureId: string;
  part: number;
  anchor: number;
  quote: string;
  kind: AidKind;
  body: string;
  fact: string;
  slides: number[];
  drug?: string;
  named: boolean;
  remixOf?: string | null;
  draftId?: string | null;
  draftNo?: number | null;
  photo?: string | null;
  figure?: string | null;
  credit?: string | null;
};

/** Posts an entry; returns its id. */
export async function postAid(a: NewAid): Promise<string> {
  const { data, error } = await client().rpc("study_aid_post", {
    p_lecture: a.lectureId,
    p_part: a.part,
    p_anchor: a.anchor,
    p_quote: a.quote.slice(0, 200),
    p_kind: a.kind,
    p_body: a.body.trim(),
    p_fact: a.fact.trim(),
    p_slides: a.slides.slice(0, 6),
    p_drug: (a.drug ?? "").trim().toLowerCase().slice(0, 60),
    p_named: a.named,
    p_remix_of: a.remixOf ?? null,
    p_draft: a.draftId ?? null,
    p_draft_no: a.draftNo ?? null,
    p_photo: a.photo ?? null,
    p_figure: a.figure ?? null,
    p_credit: a.credit ?? null,
  });
  if (error) fail(error);
  return data as string;
}

/** The author fixes an entry; returns the entry to check next, if any. */
export async function editAid(id: string, body: string, fact: string, slides: number[]): Promise<string | null> {
  const { data, error } = await client().rpc("study_aid_edit", { p_aid: id, p_body: body.trim(), p_fact: fact.trim(), p_slides: slides.slice(0, 6) });
  if (error) fail(error);
  return (data as string | null) ?? null;
}

/** The author deletes an entry, and its photo from Storage (only the Storage API removes files). */
export async function deleteAid(id: string): Promise<void> {
  const { data, error } = await client().rpc("study_aid_delete", { p_aid: id });
  if (error) fail(error);
  const photo = data as string | null;
  if (photo) await client().storage.from("study").remove([photo]).catch(() => undefined);
}

/** A vote on or off. When the answer names an entry that would win unchecked,
 *  its check runs in the background (op wall_check); a failed check shows on
 *  the entry ("לא מדויק לפי הבדיקה"), nothing else does. */
export async function vote(id: string, kind: "funny" | "stuck", on: boolean): Promise<{ funny: number; stuck: number; check: string | null }> {
  const { data, error } = await client().rpc("study_aid_vote", { p_aid: id, p_kind: kind, p_on: on });
  if (error) fail(error);
  const r = data as { funny: number; stuck: number; check: string | null };
  if (r.check) void checkAid(r.check).catch(() => undefined);
  return r;
}

/** "לא מדויק" · "לא מתאים", or null to take a mark off. */
export async function flagAid(id: string, flag: "inaccurate" | "not_ok" | null): Promise<void> {
  const { error } = await client().rpc("study_aid_flag", { p_aid: id, p_flag: flag });
  if (error) fail(error);
}

/** "שלי": pin an entry for oneself, or take the pin off. */
export async function pinAid(id: string, on: boolean): Promise<void> {
  const { error } = await client().rpc("study_aid_pin", { p_aid: id, p_on: on });
  if (error) fail(error);
}

/** "לאשר" · "לא, תודה". */
export async function answerCredit(id: string, ok: boolean): Promise<void> {
  const { error } = await client().rpc("study_aid_credit_answer", { p_aid: id, p_ok: ok });
  if (error) fail(error);
}

/** A photo to the group's wall folder (<group>/wall/<uuid>.jpg); its path. */
export async function uploadPhoto(groupId: string, blob: Blob): Promise<string> {
  const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : fallbackUuid();
  const path = `${groupId}/wall/${id}.jpg`;
  const { error } = await client().storage.from("study").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) fail(error);
  return path;
}
function fallbackUuid(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A photo's signed URL (10 minutes), or null. */
export async function photoUrl(path: string): Promise<string | null> {
  const { data } = await client().storage.from("study").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

/* ─────────────────────────── the ops ─────────────────────────── */

export type DraftLine =
  | { t: "saved"; id: string; fact: string; slides: number[]; drafts: Draft[]; left: number | null }
  | { t: "d"; d: Draft }
  | { t: "skip"; why: string }
  | { t: "done"; id: string; fact: string; slides: number[]; made: number; rejected: number; left: number | null };

/** "תנו לי 3": op mnemonic's NDJSON lines; throws Error(code). */
export async function draftsStream(o: { lectureId: string; part: number; anchor: number; gen: number }, onLine: (l: DraftLine) => void, signal?: AbortSignal): Promise<void> {
  const res = await postStudy("/api/study/ai", { op: "mnemonic", ...o }, { signal });
  await readLines(res, (l) => onLine(l as DraftLine));
}

/** op wall_check: the would-be winner against its paragraph. */
export async function checkAid(aidId: string): Promise<{ ok: boolean; problem: string; next: string | null }> {
  const res = await postStudy("/api/study/ai", { op: "wall_check", aidId });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; problem?: string; next?: string | null; error?: string };
  if (!res.ok || typeof body.ok !== "boolean") throw new Error(body.error ?? `http_${res.status}`);
  // The next entry of that paragraph that may win, checked too (one at a time).
  if (body.next && body.next !== aidId) void checkAid(body.next).catch(() => undefined);
  return { ok: body.ok, problem: body.problem ?? "", next: body.next ?? null };
}

/** How many paid draft requests the member has left today (5 a day). */
export async function draftsLeft(groupId: string): Promise<number> {
  const { data, error } = await client().rpc("study_my_uses_today", { p_group: groupId, p_kind: "mnemonic", p_ref: null });
  if (error) fail(error);
  return Math.max(0, 5 - Number(data ?? 0));
}

/* ─────────────────────────── the composer's hand-over ─────────────────────────── */

/** What a screen hands the composer (a remix, a draft "כמו שהיא", an edit,
 *  K6's answer, a credit): kept in memory for the next composer only. A
 *  reload starts a plain "משלי". */
export type ComposerSeed = {
  lectureId: string;
  part: number;
  anchor: number;
  mode: "line" | "remix" | "sketch" | "draft" | "moment" | "edit";
  body?: string;
  fact?: string;
  slides?: number[];
  remixOf?: string | null;
  draftId?: string | null;
  draftNo?: number | null;
  editId?: string;
  credit?: { id: string; name: string } | null;
};
let seed: ComposerSeed | null = null;
export function setComposerSeed(s: ComposerSeed | null): void {
  seed = s;
}
export function takeComposerSeed(lectureId: string, part: number, anchor: number): ComposerSeed | null {
  const s = seed && seed.lectureId === lectureId && seed.part === part && seed.anchor === anchor ? seed : null;
  seed = null;
  return s;
}

/** The unsent composer text on this phone (cleared on post; F's forgetOtherUsers removes other users'). */
export const draftKey = (userId: string, lectureId: string) => `study-wall-draft:${userId}:${lectureId}`;
export const tabKey = (userId: string) => `study-wall-tab:${userId}`;
export function readLocal(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
export function writeLocal(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode: kept on screen only */
  }
}
