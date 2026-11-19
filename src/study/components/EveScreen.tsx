import { useEffect, useState } from "react";
import { eveAids, EVE_EMPTY, summarySlide } from "../../../shared/study/eve";
import type { DangerRow } from "../../../shared/study/progress";
import type { ScreenProps } from "../features/types";
import { getLecture, type Lecture } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { listQuestionsByIds, type PublicQuestion } from "../lib/practice";
import { myDangerList } from "../lib/progress";
import { isolateLatin } from "../lib/rich";
import type { Aid } from "../lib/wall";
import { BackLink, Head, Loading, RouteLink } from "./Shell";
import "../styles/plan.css";

/* ── The exam-eve view (?v=eve&l=; spec §12.3.A's PR6, built with package G
 *    and T-2 in wave 5; Yoad's decision 3 of 17 Nov 2026) ──
 *
 * One lecture, the night before: "השקף המסכם" as the lecturer wrote it,
 * "האסוציאציות שלך" (the wall's pinned entries, then the paragraphs'
 * winners, then the member's own), and "הטעויות ׳על בטוח׳ שלך" (her danger
 * list's rows on this lecture), and "להדפסה". No new generator and no AI.
 * Each part opens with whatever there is, and an empty one says what fills
 * it (shared/study/eve.ts), never a lock. The errors are hers alone. */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");
type Data = { lecture: Lecture | null; errors: DangerRow[]; questions: Record<string, PublicQuestion>; aids: Aid[] };

export default function EveScreen({ route, ctx }: ScreenProps<"eve">) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      const [lecture, danger, aids] = await Promise.all([
        getLecture(route.l),
        myDangerList(ctx.group.id).catch(() => [] as DangerRow[]),
        flags.wall ? import("../lib/wall").then((w) => w.getWall(ctx.group.id, { lecture: route.l })).catch(() => [] as Aid[]) : Promise.resolve([] as Aid[]),
      ]);
      const errors = danger.filter((d) => d.lecture_id === route.l);
      const qs = errors.length ? await listQuestionsByIds(errors.map((d) => d.question_id)).catch(() => [] as PublicQuestion[]) : [];
      return { lecture, errors, questions: Object.fromEntries(qs.map((q) => [q.id, q])), aids };
    })()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(failText(codeOf(e), "today")));
    return () => {
      alive = false;
    };
  }, [ctx.group.id, route.l]);

  const title = data?.lecture?.title ?? "";
  const head = (
    <>
      <Head back={<BackLink go={ctx.go} fallback={flags.groupPlan ? { v: "plan" } : { v: "lecture", l: route.l }} />}>
        <h1 className="t">{title ? <>הלילה שלפני · {isolateLatin(title, "et")}</> : "הלילה שלפני"}</h1>
      </Head>
      <p className="ph-sub">
        <span>השקף, האסוציאציות והטעויות שלך</span>
        <span aria-hidden="true">·</span>
        <span className="a-chip">רק לך</span>
      </p>
    </>
  );
  if (error)
    return (
      <main className="plan eve">
        {head}
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!data)
    return (
      <main className="plan eve">
        {head}
        <Loading />
      </main>
    );
  const slide = data.lecture ? summarySlide(data.lecture.slides ?? []) : null;
  const aids = eveAids(data.aids);
  return (
    <main className="plan eve">
      {head}
      <section className="a-stack" aria-labelledby="eve-slide-h">
        <div className="a-sec">
          <h2 id="eve-slide-h" className="a-h2">
            השקף המסכם
          </h2>
          {slide ? <span className="a-tag">{`ש׳ ${slide.n}`}</span> : null}
        </div>
        {slide ? (
          <div className="a-card flat eve-slide">
            <b dir="rtl">{isolateLatin(slide.title, "es")}</b>
            {slide.lines.length ? (
              <ul className="lines">
                {slide.lines.map((line, i) => (
                  <li key={i} className="a-small" dir="auto">
                    {isolateLatin(line, `el${i}`)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="a-card dashed empty">
            <p className="a-small">{EVE_EMPTY.slide}</p>
            <RouteLink to={{ v: "lecture", l: route.l }} go={ctx.go} className="a-btn small">
              להרצאה
            </RouteLink>
          </div>
        )}
      </section>

      {flags.wall ? (
        <section className="a-stack" aria-labelledby="eve-aids-h">
          <div className="a-sec">
            <h2 id="eve-aids-h" className="a-h2">
              האסוציאציות שלך
            </h2>
          </div>
          {aids.length ? (
            <ul className="a-list">
              {aids.map((a) => (
                <li key={a.id} className="a-li">
                  <div>
                    <b dir="rtl">{isolateLatin(a.body, `ea${a.id}`)}</b>
                    <span className="m" dir="rtl">
                      {isolateLatin(a.fact, `ef${a.id}`)}
                      {a.slides[0] ? (
                        <>
                          {" "}
                          <span className="a-tag">{`ש׳ ${a.slides[0]}`}</span>
                        </>
                      ) : null}
                    </span>
                  </div>
                  <span className={`a-chip${a.pinned ? " group" : a.on_cards ? " ok" : ""}`}>{a.pinned ? "ננעצה" : a.on_cards ? "זוכה" : "שלך"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="a-card dashed empty">
              <p className="a-small">{EVE_EMPTY.aids}</p>
            </div>
          )}
        </section>
      ) : null}

      <section className="a-stack" aria-labelledby="eve-errors-h">
        <div className="a-sec">
          <h2 id="eve-errors-h" className="a-h2">
            הטעויות ׳על בטוח׳ שלך
          </h2>
          <span className="a-chip">רק לך</span>
        </div>
        {data.errors.length ? (
          <ul className="a-list">
            {data.errors.map((d) => (
              <li key={d.question_id} className="a-li">
                <div>
                  <b dir="rtl">{isolateLatin(data.questions[d.question_id]?.question ?? "שאלה", `eq${d.question_id}`)}</b>
                  <span className="m" dir="rtl">
                    {d.chosen ? <>ענית ׳{isolateLatin(d.chosen, `ec${d.question_id}`)}׳. </> : null}
                    נכון: {isolateLatin(d.right_text, `er${d.question_id}`)}
                    {d.slides[0] ? (
                      <>
                        {" "}
                        <span className="a-tag">{`ש׳ ${d.slides[0]}`}</span>
                      </>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="a-card dashed empty">
            <p className="a-small">{EVE_EMPTY.errors}</p>
          </div>
        )}
      </section>

      <div className="a-row eve-actions">
        <button type="button" className="a-btn primary" onClick={() => window.print()}>
          להדפסה
        </button>
        <RouteLink to={{ v: "lecture", l: route.l }} go={ctx.go} className="a-btn ghost">
          לסיכום המלא
        </RouteLink>
      </div>
    </main>
  );
}
