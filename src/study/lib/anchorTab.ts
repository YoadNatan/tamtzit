import { countWord } from "./anchor";

/* ── The paragraph sheet's "תרגול" tab: its data and words (package N; §12.4.N) ──
 * study_paragraph_practice: one paragraph's questions and cards, each with
 * the caller's own state; the words are proposal/mockups/anchor.html s2's.
 * Loads with the tab (components/PracticeTab.tsx) and with a paragraph's
 * practice session, never in the entry chunk. */

export type TabQuestion = {
  id: string;
  kind: "mcq" | "case";
  style: string | null;
  question: string;
  teaser: string;
  stale: boolean;
  hidden: boolean;
  answered: number;
  wrong: number;
  last_correct: boolean | null;
};
export type TabCard = {
  id: string;
  kind: "qa" | "cloze";
  front: string;
  source: string;
  stale: boolean;
  in_deck: boolean;
  lapses: number;
};
export type ParagraphPractice = { questions: TabQuestion[]; cards: TabCard[] };

async function client() {
  const { sb } = await import("./api");
  if (!sb) throw new Error("not-configured");
  return sb;
}
function fail(error: { message?: string }): never {
  throw error instanceof Error ? error : new Error(error.message || "unknown");
}

/** One paragraph's "תרגול" tab. Error: "lecture not found". */
export async function paragraphPractice(lectureId: string, part: number, anchor: number): Promise<ParagraphPractice> {
  const { data, error } = await (await client()).rpc("study_paragraph_practice", { p_lecture: lectureId, p_part: part, p_anchor: anchor });
  if (error) fail(error);
  const d = (data ?? {}) as Partial<ParagraphPractice>;
  return { questions: d.questions ?? [], cards: d.cards ?? [] };
}

/** "עדיין נכון" on a question a correction marked (section Q's end,
 *  study_question_still_true): it goes back into practice and quizzes for
 *  the whole group (review SEC4-1). Error: "question not found". */
export async function questionStillTrue(questionId: string): Promise<void> {
  const { error } = await (await client()).rpc("study_question_still_true", { p_question: questionId });
  if (error) fail(error);
}

/** "לתרגל את הפסקה": the practice session of one paragraph's questions. */
export const paragraphSession = (lectureId: string, part: number, anchor: number) => `p.${lectureId}.${part}.${anchor}`;

/** A question's line in the tab: "שאלה" or "שאלה · מקרה קליני". */
export const questionKind = (q: Pick<TabQuestion, "kind" | "style">) => (q.style === "case" || (!q.style && q.kind === "case") ? "שאלה · מקרה קליני" : "שאלה");

export type ItemState = { label: string; tone: "bad" | "ok" | "busy" | "warn" | "" };

/** Her state on a question: wrong twice, wrong, not yet, right; a marked or
 *  hidden question says why it is out of practice. */
export function questionState(q: Pick<TabQuestion, "answered" | "wrong" | "last_correct" | "stale" | "hidden">): ItemState {
  if (q.hidden) return { label: "הוסתרה עד בדיקה", tone: "warn" };
  if (q.stale) return { label: "בבדיקה אחרי תיקון בפסקה", tone: "warn" };
  if (!q.answered) return { label: "עוד לא ענית", tone: "" };
  if (q.last_correct) return { label: "ענית נכון", tone: "ok" };
  return q.wrong >= 2 ? { label: "טעית פעמיים", tone: "bad" } : { label: "טעית", tone: "bad" };
}

export function cardState(c: Pick<TabCard, "in_deck" | "stale">): ItemState {
  if (c.stale) return { label: "בבדיקה אחרי תיקון בפסקה", tone: "warn" };
  return c.in_deck ? { label: "בחפיסה", tone: "busy" } : { label: "עוד לא בחפיסה", tone: "" };
}

/** The questions "לתרגל את הפסקה" asks: not hidden, not marked. */
export const practiceable = (qs: readonly TabQuestion[]) => qs.filter((q) => !q.hidden && !q.stale);

/** "של הקבוצה: 2 שאלות, 2 כרטיסים" (hidden questions are not the group's practice). */
export function groupLine(p: ParagraphPractice): string {
  const q = p.questions.filter((x) => !x.hidden).length;
  const parts = [q ? countWord(q, "שאלה אחת", "שאלות") : "", p.cards.length ? countWord(p.cards.length, "כרטיס אחד", "כרטיסים") : ""].filter(Boolean);
  return parts.length ? `של הקבוצה: ${parts.join(", ")}` : "";
}

/** The tab's count, "תרגול · 4": the group's questions (not the hidden) and cards. */
export const tabCount = (p: ParagraphPractice) => p.questions.filter((q) => !q.hidden).length + p.cards.length;
