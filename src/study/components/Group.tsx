import { useEffect, useState } from "react";
import { groupLive, groupQuestions, lectureTitles, type GroupQuestion, type LiveReader } from "../lib/api";
import { isolateLatin } from "../lib/rich";
import { BossCard } from "../features/boss";
import { RecentEditsCard } from "../features/collab";
import { MeetingCard } from "../features/meeting";
import { PlanCard } from "../features/plan";
import { MarathonsCard } from "../features/progress";
import { MuseumCard, PulseCard } from "../features/pulse";
import { QuizCard } from "../features/quiz";
import { DisputesCard } from "../features/var";
import { WallCard } from "../features/wall";
import type { ScreenProps } from "../features/types";
import { Head, RouteLink } from "./Shell";
import { timeAgo } from "./Together";

/* ── "יחד" (spec §5.1; §12.2.3) ──
 * In order: "עכשיו", who is reading aloud (the group channel), with
 * "לעקוב"; the day's meeting (M); the group quiz (Z); "שאלות פתוחות", every
 * unresolved question in the group, a tap opens its paragraph; the pulse
 * (U); the wall (J); the museum (U); the boss (H); recent corrections (K);
 * yellow cards (V); marathons (A2); the group's plan (G). Each package's card
 * renders nothing until it has something to show. */

export default function Group({ ctx }: ScreenProps<"group">) {
  const [readers, setReaders] = useState<LiveReader[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<GroupQuestion[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const live = groupLive(ctx.group.id, { id: ctx.userId }, setReaders);
    return () => live.leave();
  }, [ctx.group.id, ctx.userId]);

  useEffect(() => {
    let alive = true;
    groupQuestions(ctx.group.id)
      .then((q) => alive && setQuestions(q))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);

  const reading = readers.filter((r) => r.user_id !== ctx.userId);
  const readingKey = reading.map((r) => r.reading).join(",");
  useEffect(() => {
    const ids = readingKey.split(",").filter((id) => id && titles[id] === undefined);
    if (!ids.length) return;
    lectureTitles(ids)
      .then((t) => setTitles((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, t[id] ?? ""])) })))
      .catch(() => undefined);
  }, [readingKey, titles]);

  return (
    <main className="group-screen">
      <Head title="יחד" />

      <section className="a-stack" aria-labelledby="now-h">
        <div className="a-sec">
          <h2 id="now-h">עכשיו</h2>
        </div>
        {reading.length ? (
          <ul className="a-list">
            {reading.map((r) => (
              <li key={r.user_id} className="a-li now-row">
                <div>
                  <b>
                    הקראה עכשיו: {ctx.nameOf(r.user_id) || "ללא שם"}
                    {titles[r.reading] ? (
                      <>
                        {" "}
                        · <bdi>{titles[r.reading]}</bdi>
                      </>
                    ) : null}
                  </b>
                </div>
                <RouteLink to={{ v: "lecture", l: r.reading, follow: true }} go={ctx.go} className="a-btn primary small">
                  לעקוב
                </RouteLink>
              </li>
            ))}
          </ul>
        ) : (
          <p className="a-card flat a-muted">אין הקראה כרגע. פותחים הרצאה ולוחצים ״להקריא לקבוצה״.</p>
        )}
      </section>

      <MeetingCard ctx={ctx} />
      <QuizCard ctx={ctx} />

      <section className="a-stack" aria-labelledby="open-h">
        <div className="a-sec">
          <h2 id="open-h">שאלות פתוחות</h2>
        </div>
        {questions === null ? (
          <p className="a-card flat a-muted">{error ? "השאלות לא נטענו. כדאי לבדוק את החיבור ולנסות שוב." : "טוען…"}</p>
        ) : questions.length === 0 ? (
          <p className="a-card flat a-muted">אין שאלות פתוחות בקבוצה.</p>
        ) : (
          <ul className="a-list open-questions">
            {questions.map((q) => (
              <li key={q.id}>
                <RouteLink to={{ v: "lecture", l: q.lecture_id, at: { part: q.part_idx, anchor: q.anchor } }} go={ctx.go} className="a-li question-link">
                  <div>
                    <b className="q-body" dir="auto">
                      {isolateLatin(q.body, `b${q.id}`)}
                    </b>
                    {q.quote ? (
                      <span className="m" dir="rtl">
                        {isolateLatin(`״${q.quote}…״`, `q${q.id}`)}
                      </span>
                    ) : null}
                    <span className="m">
                      <bdi>{q.title}</bdi> · {ctx.nameOf(q.author_id) || "ללא שם"} · {timeAgo(q.created_at)}
                    </span>
                  </div>
                </RouteLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PulseCard ctx={ctx} />
      <WallCard ctx={ctx} />
      <MuseumCard ctx={ctx} />
      <BossCard ctx={ctx} />
      <RecentEditsCard ctx={ctx} />
      <DisputesCard ctx={ctx} />
      <MarathonsCard ctx={ctx} />
      <PlanCard ctx={ctx} />
    </main>
  );
}
