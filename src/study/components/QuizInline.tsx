import { useEffect, useRef, useState } from "react";
import type { Ctx } from "../features/types";
import { coffeeChip } from "../lib/meeting";
import { answerRound, BET_WORDS, clock as clockText, joinQuiz, nextRound, quizErrorText, type Bet, type QuizQuestion } from "../lib/quiz";
import { isolateLatin, richText } from "../lib/rich";
import { useQuiz } from "../lib/useQuiz";
import { Icon } from "./Icon";

/* ── A quiz stacked inside the meeting screen (Z's QuizInline, as section M's
 * opening needs it; meeting.html s1) ──
 *
 * "3 לקפה": three questions on the earlier meetings' parts, 45 s each,
 * co-op, answered alone with the bet. The page shows them stacked:
 * answered ones fold to one line (the right answer, the slide and the
 * majority chip, "רובכם צדקו" · "הקבוצה חלוקה" · "רובכם טעו": a word, never a
 * number), the current one open with its options and the bet, the rest
 * waiting. Its host starts it and moves it on; anyone joins. The same
 * engine as the room (useQuiz: the server's clock, Realtime, the reveal at
 * the deadline), drawn small. */

const LETTERS = ["א", "ב", "ג", "ד", "ה", "ו"];
type Folded = { idx: number; q: QuizQuestion | null; answer: number | null; majority: "most_right" | "split" | "most_wrong" | null | undefined };

export default function QuizInline({ ctx, quizId, onState }: { ctx: Ctx; quizId: string; onState?: (s: { idx: number; total: number; state: string }) => void }) {
  const { state, view, refresh } = useQuiz(quizId);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const folded = useRef<Map<number, Folded>>(new Map());
  const z = state?.quiz;
  const r = state?.round ?? null;
  const total = z ? z.n_total || z.n_wanted : 3;

  // Keep each revealed round folded, in order.
  if (r && r.q && (z?.state === "reveal" || z?.state === "ended") && r.answer !== undefined && r.answer !== null) {
    folded.current.set(r.idx, { idx: r.idx, q: r.q, answer: r.answer, majority: r.majority });
  }
  for (const s of state?.summary ?? []) folded.current.set(s.idx, { idx: s.idx, q: s.q, answer: s.answer, majority: s.majority });

  const idx = z?.idx ?? -1;
  useEffect(() => {
    setSelected(null);
  }, [idx]);
  useEffect(() => {
    if (z) onState?.({ idx: z.idx, total, state: z.state });
  }, [z?.idx, z?.state, total]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state || !z || !view) return <p className="a-small a-muted loading">טוען…</p>;
  const host = z.host_id === ctx.userId;
  const playing = Boolean(state.me?.playing);
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await f();
      await refresh();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(code === "no questions" ? "עוד אין שאלות על ההרצאות הקודמות. אפשר לדלג לסדר היום." : (quizErrorText(code) ?? "משהו השתבש. אפשר לנסות שוב."));
    } finally {
      setBusy(false);
    }
  };
  const send = (bet: Bet) => {
    if (selected === null || !r) return;
    void act(() => answerRound(quizId, r.idx, selected, bet, 1));
  };

  const done = [...folded.current.values()].sort((a, b) => a.idx - b.idx);
  const line = (f: Folded) => {
    const chip = coffeeChip(f.majority);
    const right = f.q && f.answer !== null ? f.q.options[f.answer] : "";
    return (
      <div key={f.idx} className="a-card flat m-folded">
        <b className="a-small" dir="rtl">
          {f.idx + 1} · {isolateLatin(f.q?.teaser || f.q?.question || "", `fq${f.idx}`)}
        </b>
        <div className="a-row between">
          <span className="a-small a-muted" dir="rtl">
            {isolateLatin(right, `fa${f.idx}`)} {f.q?.slides.length ? <span className="a-tag">ש׳ {f.q.slides[0]}</span> : null}
          </span>
          {chip ? <span className={`a-chip ${chip.tone}`}>{chip.text}</span> : null}
        </div>
      </div>
    );
  };

  if (view.v === "lobby") {
    const names = state.players.filter((p) => !p.left).map((p) => p.name || "ללא שם");
    return (
      <div className="a-stack m-inline">
        <p className="a-small">בפנים: {names.join(", ") || "עוד אף אחד"}</p>
        {!playing ? (
          <button type="button" className="a-btn" disabled={busy} onClick={() => void act(() => joinQuiz(quizId))}>
            להצטרף
          </button>
        ) : host ? (
          <button type="button" className="a-btn m-start" disabled={busy} onClick={() => void act(() => nextRound(quizId, -1))}>
            להתחיל · {total} שאלות
          </button>
        ) : (
          <p className="a-small a-muted">מחכים להתחלה.</p>
        )}
        {error ? <p className="a-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  if (view.v === "ended" || view.v === "cancelled") {
    return <div className="a-stack m-inline">{done.length ? done.map(line) : <p className="a-small a-muted">3 לקפה הסתיים.</p>}</div>;
  }

  const q = r?.q ?? null;
  const open = view.v === "question" || view.v === "countdown" || view.v === "waiting";
  const sent = r?.mine ?? null;
  const left = view.v === "question" ? view.leftMs : 0;
  return (
    <div className="a-stack m-inline">
      {done.filter((f) => f.idx < idx || view.v === "reveal").map(line)}
      {open && q ? (
        <div className="a-stack m-current">
          <div className="a-row between">
            <span className={`a-chip ${left <= 10_000 ? "warn" : "group"}`} role="timer" aria-label="הזמן שנשאר">
              <Icon name="clock" size={13} />
              <bdi dir="ltr">{view.v === "countdown" ? `0:0${view.secs}` : clockText(left)}</bdi>
            </span>
            <span className="a-small a-muted">
              ענו {z.answered_n} מתוך {z.players_n}
            </span>
          </div>
          <p className="a-q" dir="rtl">
            {idx + 1} · {richText(q.vignette ? `${q.vignette} ${q.question}` : q.question, `cq${idx}`)}{" "}
            {q.slides.length ? <span className="a-tag">ש׳ {q.slides[0]}</span> : null}
          </p>
          <div className="a-opts" role="radiogroup" aria-label={`שאלה ${idx + 1}`}>
            {q.options.map((o, i) => {
              const mine = sent ? sent.choice === i : selected === i;
              return (
                <button
                  key={i}
                  type="button"
                  className={`a-opt${mine ? " picked" : ""}`}
                  role="radio"
                  aria-checked={mine}
                  disabled={!playing || Boolean(sent) || view.v !== "question" || busy}
                  onClick={() => setSelected(i)}
                >
                  <span className="l">{LETTERS[i] ?? i + 1}</span>
                  <span dir="rtl">{isolateLatin(o, `co${idx}.${i}`)}</span>
                </button>
              );
            })}
          </div>
          {playing && !sent && view.v === "question" ? (
            <div className="a-row m-bets" role="group" aria-label="ההימור">
              {([1, 2, 3] as const).map((b) => (
                <button key={b} type="button" className="a-btn small" disabled={selected === null || busy} onClick={() => send(b)}>
                  {BET_WORDS[b]}
                </button>
              ))}
            </div>
          ) : sent ? (
            <p className="a-small a-muted">התשובה נעולה עד החשיפה.</p>
          ) : !playing ? (
            <button type="button" className="a-btn small" disabled={busy} onClick={() => void act(() => joinQuiz(quizId))}>
              להצטרף
            </button>
          ) : null}
        </div>
      ) : null}
      {view.v === "reveal" && host && z.idx + 1 < total ? (
        <button type="button" className="a-btn m-next" disabled={busy} onClick={() => void act(() => nextRound(quizId, z.idx))}>
          לשאלה הבאה
        </button>
      ) : view.v === "reveal" && host ? (
        <button type="button" className="a-btn m-next" disabled={busy} onClick={() => void act(() => nextRound(quizId, z.idx))}>
          לסיום
        </button>
      ) : null}
      {Array.from({ length: Math.max(0, total - Math.max(idx + 1, done.length)) }, (_, k) => {
        const n = Math.max(idx + 1, done.length) + k + 1;
        return (
          <p key={n} className="a-small a-muted m-later">
            {n} · עוד שאלה
          </p>
        );
      })}
      {error ? <p className="a-error" role="alert">{error}</p> : null}
    </div>
  );
}
