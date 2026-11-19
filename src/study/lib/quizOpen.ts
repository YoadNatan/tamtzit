import { sb } from "./api";

/* ── The group quiz as the rest of the app sees it (package Z) ──
 * The group's open quiz for F1's live banner and the card on "יחד", the last
 * quizzes, joining one, and the calls' shared plumbing. Small, because it is
 * in the study entry (the bundle check's 8 kB a package); quiz.ts, with
 * everything else, loads with the quiz's screens and re-exports these. */

export type Mode = "coop" | "race" | "boss";
export type QuizStateName = "lobby" | "question" | "reveal" | "ended" | "cancelled";
export type OpenQuiz = { id: string; mode: Mode; title: string; state: QuizStateName; idx: number; n_total: number; players_n: number; host_id: string | null; playing: boolean; names: string[] };
export type RecentQuiz = {
  id: string;
  mode: Mode;
  title: string;
  ended_at: string;
  players_n: number;
  rounds: number;
  /** The group's share of right final votes: only for quizzes of 3 players or more (SEC-6). */
  right_pct: number | null;
  played: boolean;
  my_correct: number | null;
  my_answered: number | null;
  my_rank: number | null;
};

/** The mode's name on every screen (§12.0.4: the approved names). */
export const MODE_NAME: Record<Mode, string> = { coop: "כולנו נגד המבחן", race: "מירוץ", boss: "אתגר קבוצתי" };

/** "שוהם, נועה +3": the first two names and how many more. */
export function namesLine(names: readonly string[]): string {
  const shown = names.slice(0, 2).map((n) => n || "ללא שם");
  const more = names.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` +${more}` : ""}`;
}

/** A refusal's code: the database's exception text ('closed', 'quiz open'…);
 *  a request that never reached it is "network". */
export function codeOf(error: { message?: string; code?: string }): string {
  const m = error.message ?? "";
  if (!error.code && /fetch|network|load failed/i.test(m)) return "network";
  return m || "network";
}

export type Reply = { data: unknown; error: { message?: string; code?: string } | null };

export function db() {
  if (!sb) throw new Error("not-configured");
  return sb;
}

/** Awaits a call: its data, or Error(code). Each call names its function and
 *  arguments literally (db().rpc("study_quiz_…", { p_… })), so
 *  npm run test:contract checks them against the loaded schema (review FE-7). */
export async function run<T>(call: PromiseLike<Reply>): Promise<T> {
  let res: Reply;
  try {
    res = await call;
  } catch {
    throw new Error("network");
  }
  if (res.error) throw new Error(codeOf(res.error));
  return res.data as T;
}

export const joinQuiz = (id: string) => run<null>(db().rpc("study_quiz_join", { p_quiz: id }));
export const recentQuizzes = (groupId: string, limit = 3) => run<RecentQuiz[]>(db().rpc("study_quiz_recent", { p_group: groupId, p_limit: limit }));
export async function openQuiz(groupId: string): Promise<OpenQuiz | null> {
  return (await run<OpenQuiz[]>(db().rpc("study_quiz_open", { p_group: groupId })))[0] ?? null;
}

/** The group's quizzes, for the banner and "יחד": any change means "ask again". */
export function watchOpenQuiz(groupId: string, onChange: () => void): () => void {
  if (!sb) return () => undefined;
  const client = sb;
  const ch = client
    .channel(`study-quizzes-${groupId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "study_quizzes", filter: `group_id=eq.${groupId}` }, () => onChange())
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onChange();
    });
  return () => void client.removeChannel(ch);
}
