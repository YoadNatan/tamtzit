import { lazy, Suspense, useEffect, useState } from "react";
import { flags } from "../lib/flags";
import { listQuestionsByIds, type PublicQuestion } from "../lib/practice";

/* ── A live quiz question's picture (question types) ──
 * The quiz's state carries the question's text only; a question about a
 * picture ("שאלה על תמונה", "סימון על תמונה" by its number) is drawn here
 * from its row, read by id, with its pins shown but never tapped (the room
 * answers with the options). At the reveal the asked pin says ✓. Nothing
 * without the flag, and nothing for a plain question. */

const QuestionFigure = lazy(() => import("./QuestionTypes").then((m) => ({ default: m.QuestionFigure })));
const rows = new Map<string, Promise<PublicQuestion | null>>();
const rowOf = (id: string) => {
  let p = rows.get(id);
  if (!p) {
    p = listQuestionsByIds([id])
      .then(([q]) => q ?? null)
      .catch(() => {
        rows.delete(id);
        return null;
      });
    rows.set(id, p);
  }
  return p;
};

export default function QuizMedia({ questionId, revealed }: { questionId: string | null | undefined; revealed?: boolean }) {
  const [q, setQ] = useState<PublicQuestion | null>(null);
  useEffect(() => {
    let alive = true;
    setQ(null);
    if (flags.qtypes && questionId) void rowOf(questionId).then((x) => alive && setQ(x));
    return () => {
      alive = false;
    };
  }, [questionId]);
  if (!q) return null;
  const lay = q.layout;
  const picture = lay?.kind === "label" || lay?.kind === "image" || (q.style === "image" && Boolean(q.figure));
  if (!picture) return null;
  return (
    <Suspense fallback={null}>
      <QuestionFigure groupId={q.group_id} lectureId={q.lecture_id} figure={q.figure ?? ""} layout={lay} answered={revealed ? { right: -1, chosen: null } : null} />
    </Suspense>
  );
}
