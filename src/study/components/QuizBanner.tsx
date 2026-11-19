import type { Go } from "../features/types";
import { joinQuiz, MODE_NAME, namesLine, type OpenQuiz, type RecentQuiz } from "../lib/quizOpen";
import { isolateLatin } from "../lib/rich";
import { routeUrl } from "../lib/route";
import { Icon } from "./Icon";
import { RouteLink } from "./Shell";

/* ── The group quiz's line in the live banner, and its card on "יחד"
 * (package Z; design-quiz §1.3 B and Y, with the approved names of §12.0.4) ──
 * Static and small: the shell and "יחד" render them on every screen.
 *
 * The banner: "מבחן קבוצתי פתוח · בפנים: שוהם, נועה" (a race: "מירוץ
 * פתוח · …"), once it runs "מבחן קבוצתי עכשיו · שאלה 4 מתוך 10 · בפנים:
 * שוהם, נועה +3", with "להצטרף", or "חזרה למבחן" on a phone already in it.
 * Names, never a counted noun (§6.0 rule 1).
 *
 * "יחד": the open quiz's line, else "מבחן קבוצתי חדש"; the last three
 * quizzes, each with the group's share of right answers only when 3 or more
 * played (review SEC-6: a solo quiz never publishes its player's score), and
 * on this phone only, this member's own part: "שלך 8/10" in "כולנו נגד
 * המבחן", the place in a race ("המקום שלך במירוץ האחרון: 2 מתוך 4"). */

const name = (q: Pick<OpenQuiz, "mode">) => (q.mode === "race" ? "מירוץ" : "מבחן קבוצתי");

/** The banner's words for an open quiz. */
export function bannerText(q: OpenQuiz): string {
  const people = q.names.length ? ` · בפנים: ${namesLine(q.names)}` : "";
  if (q.state === "lobby") return `${name(q)} פתוח${people}`;
  return `${name(q)} עכשיו · שאלה ${Math.max(1, q.idx + 1)} מתוך ${q.n_total}${people}`;
}

/** "להצטרף" joins and opens the room; "חזרה למבחן" only opens it. A real
 *  link, so long-press and a new tab work too (the room offers "להצטרף למבחן"). */
function JoinLink({ quiz, go, className }: { quiz: OpenQuiz; go: Go; className: string }) {
  const join = async () => {
    if (!quiz.playing) await joinQuiz(quiz.id).catch(() => undefined); // the room says why, if it did not work
    go({ v: "quiz", q: quiz.id });
  };
  return (
    <a
      href={routeUrl({ v: "quiz", q: quiz.id })}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void join();
      }}
    >
      {quiz.playing ? "חזרה למבחן" : "להצטרף"}
    </a>
  );
}

export function QuizBanner({ quiz, go }: { quiz: OpenQuiz; go: Go }) {
  return (
    <>
      <span className="quiz-live-icon" aria-hidden="true">
        <Icon name="users" size={15} />
      </span>
      <span className="live-text">{isolateLatin(bannerText(quiz), "qb")}</span>
      <JoinLink quiz={quiz} go={go} className="a-btn primary small live-act" />
    </>
  );
}

/** "היום", "אתמול", or the day and month. */
function dayWord(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60_000) / 86_400_000);
  const ago = day(now) - day(d);
  if (ago <= 0) return "היום";
  if (ago === 1) return "אתמול";
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

export function QuizGroupCard({ open, recent, go }: { open: OpenQuiz | null; recent: RecentQuiz[] | null; go: Go }) {
  const lastRace = (recent ?? []).find((r) => r.mode === "race" && r.played && r.my_rank !== null);
  return (
    <section className="a-stack quiz-card" aria-labelledby="quiz-card-h">
      <div className="a-sec">
        <h2 id="quiz-card-h">מבחן קבוצתי</h2>
      </div>
      {open ? (
        <ul className="a-list">
          <li className="a-li quiz-card-open">
            <div className="a-row">
              <span className="quiz-live-icon" aria-hidden="true">
                <Icon name="users" size={15} />
              </span>
              <b dir="rtl">{isolateLatin(bannerText(open), "qc")}</b>
            </div>
            <JoinLink quiz={open} go={go} className="a-btn primary small" />
          </li>
        </ul>
      ) : (
        <RouteLink to={{ v: "quiz", isNew: true }} go={go} className="a-btn primary quiz-new">
          <Icon name="users" size={16} />
          מבחן קבוצתי חדש
        </RouteLink>
      )}
      {recent && recent.length ? (
        <ul className="a-list quiz-recent" aria-label="המבחנים האחרונים">
          {recent.map((r) => {
            const mine =
              r.played && r.mode !== "race" && r.my_answered !== null
                ? ` · שלך ${r.my_correct ?? 0}/${r.my_answered}`
                : r.played && r.mode === "race" && r.my_rank !== null && r !== lastRace
                  ? ` · המקום שלך: ${r.my_rank}`
                  : "";
            return (
              <li key={r.id} className="a-li">
                <div>
                  <b dir="rtl">{isolateLatin(r.title, `t${r.id}`)}</b>
                  <span className="m" dir="rtl">
                    {`${MODE_NAME[r.mode]} · ${dayWord(r.ended_at)}${r.right_pct !== null ? ` · הקבוצה ${r.right_pct}%` : ""}${mine}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {lastRace ? (
        <p className="a-small a-muted">
          המקום שלך במירוץ האחרון: {lastRace.my_rank} מתוך {lastRace.players_n}
        </p>
      ) : null}
    </section>
  );
}
