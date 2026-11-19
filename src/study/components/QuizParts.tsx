import type { CSSProperties, ReactNode } from "react";
import { barRows, BET_SCALE, hardest, MODE_NAME, pct, signed, tableRows, type QuizPlayer, type QuizState } from "../lib/quiz";
import { barLabel, isolateLatin } from "../lib/rich";
import { Icon, type IconName } from "./Icon";
import { LETTERS } from "./QuizQuestion";

/* ── The room's pieces (package Z; design-quiz §4.1 QuizParts, the approved
 * screens of docs/study/proposal/mockups/live-quiz.html) ──
 * Presentational only: no data access. Right and wrong never by colour
 * alone (a ✓ and words), counts as text beside the bars, numbers isolated. */

/** One vote's bars (the kit's a-bars): the options someone chose, most
 *  chosen first, the key marked with ✓ and "התשובה הנכונה" (at the final
 *  reveal only), the count as text at the end. */
export function Bars({ counts, options, answer, label }: { counts: number[] | null | undefined; options: string[]; answer?: number | null; label: string }) {
  const rows = barRows(counts, options, answer);
  if (!rows.length) return null;
  const top = Math.max(...rows.map((r) => r.n));
  return (
    <ul className="a-bars quiz-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.i} className={`r${r.right ? " ok" : ""}`}>
          <span dir="rtl">
            {r.right ? "✓ " : ""}
            <span className="quiz-bar-letter">{LETTERS[r.i]}</span> {barLabel(r.text, `b${r.i}-`)}
            {r.right ? <span className="sr-only"> · התשובה הנכונה</span> : null}
          </span>
          <span className="a-bar" aria-hidden="true">
            <i style={{ width: `${Math.round((100 * r.n) / Math.max(1, top))}%` }} />
          </span>
          <b>{r.n}</b>
        </li>
      ))}
    </ul>
  );
}

/** A vote's block on the reveal: its title, a chip, its bars. */
export function VoteBlock({ title, chip, chipTone, children }: { title: string; chip?: string; chipTone?: "warn" | "ok"; children: ReactNode }) {
  return (
    <section className="a-stack quiz-vote">
      <div className="a-row between">
        <b className="a-small">{title}</b>
        {chip ? <span className={`a-chip ${chipTone ?? ""}`}>{chip}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** The race's table (decision 2; review UX-24; the kit's a-lead rows): the
 *  top three and this player's own place, by points and then time, with the
 *  round's points and an arrow when a place changed. Only the race's players
 *  get scores. */
export function RaceTable({ players, me, before }: { players: QuizPlayer[]; me: string; before?: Record<string, number> }) {
  const rows = tableRows(players, me);
  if (!rows.length) return null;
  return (
    <section className="a-stack" aria-labelledby="quiz-table-h">
      <div className="a-sec">
        <h2 id="quiz-table-h">הטבלה</h2>
        <span className="a-chip">רק במשחק</span>
      </div>
      <ol className="a-card flat quiz-table" aria-labelledby="quiz-table-h">
        {rows.map((p) => {
          const was = before?.[p.user_id];
          const move = was === undefined || was === p.rank ? "" : was > p.rank ? "↑" : "↓";
          return (
            <li key={p.user_id} className={`a-lead${p.mine ? " me" : ""}`}>
              <span className="r">{p.rank}.</span>
              <span>
                {p.name || "ללא שם"} · <bdi dir="ltr">{signed(p.score ?? 0).replace(/^\+/, "")}</bdi>
                {typeof p.last_points === "number" ? (
                  <>
                    {" "}
                    (<bdi dir="ltr">{signed(p.last_points)}</bdi>)
                  </>
                ) : null}
              </span>
              {move ? (
                <span className="s" aria-label={move === "↑" ? "עלה במקום" : "ירד במקום"}>
                  {move}
                </span>
              ) : (
                <span className="s" />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The end of a quiz, for its players (design-quiz §1.3 E1/E2 with the
 *  approved end of §12.3.Z: the team's score, 80% "עברנו", the record, the
 *  question that broke the group; the private line "רק לך"). */
export function QuizEnd({ state, me, children }: { state: QuizState; me: string; children?: ReactNode }) {
  const z = state.quiz;
  const summary = state.summary ?? [];
  const broke = hardest(summary);
  const team = state.team ?? null;
  const race = z.mode === "race";
  const ranked = race ? tableRows(state.players, me) : [];
  const mine = ranked.find((p) => p.mine);
  const PLACE = ["מקום ראשון", "מקום שני", "מקום שלישי"];
  const revoted = summary.some((r) => r.vote === 2);
  return (
    <section className="a-stack quiz-end" aria-labelledby="quiz-end-h">
      <h2 id="quiz-end-h" className="a-h1">
        סוף המבחן
      </h2>
      {race ? (
        <>
          <ol className="a-list quiz-podium" aria-label="הפודיום">
            {ranked.slice(0, 3).map((p, i) => (
              <li key={p.user_id} className={`a-li${p.mine ? " is-mine" : ""}`}>
                <span>
                  <b>{PLACE[Math.min(i, 2)]}:</b> {p.name || "ללא שם"} · <bdi dir="ltr">{p.score ?? 0}</bdi>
                </span>
                {i === 0 ? <Icon name="award" size={18} /> : null}
              </li>
            ))}
          </ol>
          {mine && state.me ? (
            <p className="a-card flat quiz-mine">
              המקום שלך: {mine.rank} מתוך {state.players.filter((p) => typeof p.score === "number").length} · {state.me.correct_n} תשובות נכונות
            </p>
          ) : null}
        </>
      ) : (
        <>
          {team && team.right_pct !== null ? (
            <div className="a-card quiz-team">
              <div className="a-ring" style={{ "--p": `${Math.max(0, Math.min(100, team.right_pct))}%` } as CSSProperties} aria-hidden="true">
                <span>
                  <bdi dir="ltr">{team.right_pct}%</bdi>
                </span>
              </div>
              <div className="a-stack">
                <p className="quiz-team-pct">הקבוצה ענתה נכון על {team.right_pct}%</p>
                <div className="a-wrap">
                  <span className={`a-chip ${team.passed ? "ok" : ""}`}>{team.passed ? "עברנו!" : "80% זה ׳עברנו׳"}</span>
                  {team.new_record ? <span className="a-chip busy">שיא חדש!</span> : null}
                </div>
              </div>
            </div>
          ) : null}
          <div className="a-sec">
            <h3>השאלות</h3>
          </div>
          <ul className="a-wrap quiz-strip" aria-label="השאלות">
            {summary.map((r) => (
              <li key={r.idx} className="a-chip">
                {r.idx + 1} · {r.voided ? "השאלה בוטלה" : typeof r.right === "number" ? `${r.right}/${r.answered}` : `${r.answered ?? 0} ענו`}
              </li>
            ))}
          </ul>
          {broke && broke.q ? (
            <section className="a-stack" aria-labelledby="quiz-broke-h">
              <div className="a-sec">
                <h3 id="quiz-broke-h">השאלה ששברה את הקבוצה</h3>
              </div>
              <div className="a-card flat">
                <p className="a-q" dir="rtl">
                  {isolateLatin(firstWords(broke.q.question), "bk")}
                </p>
                <p className="a-small a-muted">
                  {broke.right} מתוך {broke.answered} ענו נכון
                </p>
              </div>
            </section>
          ) : null}
          {state.me ? (
            <section className="a-card flat quiz-private" aria-label="רק לך">
              <div className="a-row between">
                <span className="a-small">
                  <b>שלך: {state.me.correct_n} מתוך {state.me.answered_n}</b> · ניקוד ההימור: <bdi dir="ltr">{signed(state.me.score)}</bdi>
                </span>
                <span className="a-chip">רק לך</span>
              </div>
              {revoted ? <p className="a-small a-muted">הטעויות נשמרו אצלך, גם אלה שתוקנו בוויכוח.</p> : null}
            </section>
          ) : null}
        </>
      )}
      {children}
    </section>
  );
}

function firstWords(text: string, n = 9): string {
  const words = text.replace(/\*\*/g, "").trim().split(/\s+/);
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : words.join(" ");
}

/** The lobby's rules (the approved lobby: the kit's a-list), by mode. */
export function Rules({ mode, seconds }: { mode: QuizState["quiz"]["mode"]; seconds: number }) {
  const time = seconds === 60 ? "דקה לשאלה" : `${seconds} שניות לשאלה`;
  const rows: Array<[IconName, string, string]> =
    mode === "race"
      ? [
          ["clock", time, "מהירות רק שוברת שוויון"],
          ["chat", "קודם לבד, עם הימור", BET_SCALE],
          ["award", "נקודות וטבלה לשחקני המירוץ, רק במשחק.", "בלי שמות על התשובות"],
        ]
      : [
          ["clock", time, "בלי נקודות על מהירות"],
          ["chat", "קודם לבד, עם הימור", "קבוצה חצויה? 90 שניות לשכנע, ואז עונים שוב"],
          ["user", "בלי שמות על התשובות", "כל טלפון רואה רק את ההימור והטעויות שלו"],
          ["award", "בסוף: ציון הקבוצה", "והשאלה ששברה את הקבוצה"],
        ];
  return (
    <section className="a-stack" aria-labelledby="quiz-rules-h">
      <div className="a-sec">
        <h2 id="quiz-rules-h">החוקים</h2>
      </div>
      <ul className="a-list quiz-rules">
        {rows.map(([icon, b, m]) => (
          <li key={b} className="a-li">
            <div>
              <b className="a-row" dir="rtl">
                <Icon name={icon} size={15} />
                <span>{isolateLatin(b, "rb")}</span>
              </b>
              <span className="m" dir="rtl">
                {isolateLatin(m, "rm")}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "כולנו נגד המבחן" or "מירוץ", with the mode's line (the approved lobby's a-opt, chosen). */
export function ModeLine({ mode, record }: { mode: QuizState["quiz"]["mode"]; record?: number | null }) {
  return (
    <section className="a-stack" aria-labelledby="quiz-mode-h">
      <div className="a-sec">
        <h2 id="quiz-mode-h">מצב</h2>
      </div>
      <div className="a-opt picked quiz-mode">
        <span className="l">
          <Icon name={mode === "race" ? "bolt" : "users"} size={14} />
        </span>
        <span className="a-row between">
          <b>{MODE_NAME[mode]}</b>
          {mode === "coop" && typeof record === "number" ? <span className="a-chip busy">השיא: {record}%</span> : null}
        </span>
        <span className="x">
          {mode === "race"
            ? "נקודות וטבלה לשחקני המירוץ, רק במשחק."
            : mode === "boss"
              ? "כל הקבוצה ביחד מול הנושאים הקשים: עונים לבד, ותשובות נכונות סוגרות נושא."
              : "בלי טבלה: ניקוד ההימור רק לך. 80% זה ׳עברנו׳."}
        </span>
      </div>
    </section>
  );
}

/** "83%, היה 33%": the share right after the revote, and before it. */
export function revoteChip(right: number, answered: number, right1: number, answered1: number): string {
  return `${pct(right, answered)}%, היה ${pct(right1, answered1)}%`;
}
