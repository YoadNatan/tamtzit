import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ASPECTS } from "../../../shared/study/aspects";
import {
  aspectMeter,
  BUCKET_CHIP,
  BUCKET_TEXT,
  calibrationPick,
  CALIBRATION_MIN,
  dueChip,
  dueToday,
  rangeText,
  READINESS_MIN,
  readinessMeter,
  readinessOrder,
  ASPECT_MIN,
  type AspectRow,
  type CalibrationRow,
  type DangerRow,
  type ReadinessRow,
} from "../../../shared/study/progress";
import type { ScreenProps } from "../features/types";
import { lectureTitles, partTitles } from "../lib/api";
import { flags } from "../lib/flags";
import { listQuestionsByIds, type PublicQuestion } from "../lib/practice";
import { AGAIN_KEY, myAspects, myCalibration, myDangerList, myReadiness, myRewordings, todayText } from "../lib/progress";
import { barLabel, isolateLatin } from "../lib/rich";
import { BackLink, Head, Loading, RouteLink } from "./Shell";
import "../styles/progress.css";

/* ── "ההתקדמות שלי" (package A2; spec §12.3.A; proposal/mockups/progress-pulse.html s1) ──
 *
 * A private page: readiness per part as a range, not a score ("טווח, לא
 * ציון"); the danger list of "על בטוח" mistakes, each with when it comes
 * back ("היום" · "מחר" · "עוד 3 ימים") in another wording; weak points by
 * aspect (קשה · בינוני · יושב טוב); and calibration, how often "על בטוח" was
 * right. No streak and no flame (T's). Yoad's decision 1 (17 Nov 2026): it
 * is the device's member's, with no account. Wherever a number needs more
 * answers than there are, the place stays and says how many more (decision
 * 3's meter, counted from the member's own rows; shared/study/progress.ts
 * holds the thresholds). "לתרגל" opens what is due again today
 * (?v=practice&s=r.<group>, Q-2). */

type Data = {
  ready: ReadinessRow[];
  danger: DangerRow[];
  aspects: AspectRow[];
  calibration: CalibrationRow[];
  /** The danger rows' questions (their lead-ins). */
  questions: Record<string, PublicQuestion>;
  /** "lecture:part" → the part's heading; lecture → its title. */
  parts: Record<string, string>;
  titles: Record<string, string>;
  /** Open mistakes due again today in another wording (Q-2): their question ids. */
  again: string[];
};

const SHOWN = 8;

/** "במלריה" · "ב-Amebiasis": the prefix ב, with a hyphen before a Latin name. */
function calWhere(name: string) {
  return (
    <>
      {/^[A-Za-z0-9]/.test(name) ? "ב-" : "ב"}
      <bdi>{isolateLatin(name)}</bdi>
    </>
  );
}

export default function Progress({ route, ctx }: ScreenProps<"progress">) {
  const groupId = ctx.group.id;
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [allParts, setAllParts] = useState(false);
  const dangerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [ready, danger, aspects, calibration, rewordings] = await Promise.all([
        myReadiness(groupId),
        myDangerList(groupId),
        myAspects(groupId),
        myCalibration(groupId),
        flags.mistakes ? myRewordings(groupId) : Promise.resolve([]),
      ]);
      const lectures = [...new Set([...ready.map((r) => r.lecture_id), ...calibration.map((c) => c.lecture_id)].filter((x): x is string => Boolean(x)))];
      const [qs, parts, titles] = await Promise.all([
        danger.length ? listQuestionsByIds(danger.map((d) => d.question_id)) : Promise.resolve([] as PublicQuestion[]),
        partTitles(lectures).catch(() => []),
        lectureTitles(lectures).catch(() => ({}) as Record<string, string>),
      ]);
      if (!alive) return;
      setData({
        ready,
        danger,
        aspects,
        calibration,
        questions: Object.fromEntries(qs.map((q) => [q.id, q])),
        parts: Object.fromEntries(parts.map((p) => [`${p.lecture_id}:${p.idx}`, p.title])),
        titles,
        again: rewordings.map((w) => w.question_id),
      });
    })().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [groupId]);

  // ?v=progress&x=danger: straight to the danger list.
  useEffect(() => {
    if (data && route.x === "danger") dangerRef.current?.scrollIntoView({ block: "start" });
  }, [data, route.x]);

  const head = (
    <Head back={<BackLink go={ctx.go} fallback={{ v: "me" }} />} title="ההתקדמות שלי">
      <span className="a-chip">רק לך</span>
    </Head>
  );
  if (failed)
    return (
      <main className="progress-screen">
        {head}
        <p className="a-error" role="alert">
          ההתקדמות לא נטענה. כדאי לבדוק את החיבור ולנסות שוב.
        </p>
        <button type="button" className="a-btn" onClick={() => location.reload()}>
          לנסות שוב
        </button>
      </main>
    );
  if (!data) return <Loading />;

  const today = todayText();
  const practice = flags.today ? ({ v: "today" } as const) : ({ v: "practice" } as const);
  const heading = (r: { lecture_id: string | null; part_idx: number | null; heading?: string }) =>
    r.heading || (r.lecture_id !== null && r.part_idx !== null ? data.parts[`${r.lecture_id}:${r.part_idx}`] : undefined) || (r.lecture_id ? data.titles[r.lecture_id] : "") || "";

  /* ── readiness (PR2) ── */
  const ordered = readinessOrder(data.ready);
  const shown = allParts ? ordered : ordered.slice(0, SHOWN);
  const meter = readinessMeter(data.ready);
  const readiness = (
    <section className="a-stack pr-ready" aria-labelledby="pr-ready-h">
      <div className="a-sec">
        <h2 id="pr-ready-h">מוכנות לפי נושא</h2>
        <span className="a-small a-muted">טווח, לא ציון</span>
      </div>
      {ordered.length ? (
        <>
          <div className="a-bars">
            {shown.map((r) => {
              const ranged = r.lo !== null && r.hi !== null;
              const name = heading(r);
              return (
                <div key={`${r.lecture_id}:${r.part_idx}`} className="r" title={data.titles[r.lecture_id] ?? undefined}>
                  <span>
                    <bdi>{barLabel(name)}</bdi>
                    {ranged ? null : <span className="a-muted">: עוד מעט תשובות</span>}
                  </span>
                  <span
                    className="a-bar pr-range"
                    role="img"
                    aria-label={ranged ? `${name}: ${rangeText(r)}` : `${name}: ${r.answers} מתוך ${READINESS_MIN} תשובות`}
                  >
                    {ranged ? (
                      <i style={{ marginInlineStart: `${r.lo}%`, width: `${Math.max(2, (r.hi ?? 0) - (r.lo ?? 0))}%` }} />
                    ) : (
                      <i className="pr-count" style={{ width: `${Math.min(100, (100 * r.answers) / READINESS_MIN)}%` }} />
                    )}
                  </span>
                  <b>
                    <bdi dir="ltr">{ranged ? rangeText(r) : `${r.answers}/${READINESS_MIN}`}</bdi>
                  </b>
                </div>
              );
            })}
          </div>
          {ordered.length > SHOWN ? (
            <button type="button" className="a-link pr-more" aria-expanded={allParts} onClick={() => setAllParts(!allParts)}>
              {allParts ? "פחות נושאים" : `כל ${ordered.length} הנושאים`}
            </button>
          ) : null}
          {meter ? (
            <p className="a-small a-muted pr-meter">
              טווח מופיע מ-{READINESS_MIN} תשובות לנושא. הכי קרוב: <bdi>{isolateLatin(meter.heading || "נושא")}</bdi>, עוד {meter.left === 1 ? "תשובה אחת" : `${meter.left} תשובות`}.
            </p>
          ) : null}
        </>
      ) : (
        <div className="a-card dashed empty pr-empty">
          <p>עוד אין תשובות ב-28 הימים האחרונים.</p>
          <p className="a-small a-muted">טווח מוכנות מופיע מ-{READINESS_MIN} תשובות לנושא: עוד {READINESS_MIN} תשובות בנושא אחד וזה כאן.</p>
          {flags.questions ? (
            <RouteLink to={practice} go={ctx.go} className="a-btn small">
              לתרגל
            </RouteLink>
          ) : null}
        </div>
      )}
    </section>
  );

  /* ── the danger list (PR3) ── */
  const due = dueToday(data.danger, today);
  // Each question once: a danger row due today may also be an open mistake from an earlier day.
  const againCount = new Set([...due.map((d) => d.question_id), ...data.again]).size;
  const danger = (
    <section ref={dangerRef} className="a-stack pr-danger" aria-labelledby="pr-danger-h">
      <div className="a-sec">
        <h2 id="pr-danger-h">טעויות ׳על בטוח׳</h2>
        <span className="a-chip warn">ענית ׳על בטוח׳ וטעית</span>
      </div>
      {data.danger.length ? (
        <ul className="a-list pr-danger-list">
          {data.danger.map((d) => {
            const q = data.questions[d.question_id];
            const slide = d.slides[0];
            return (
              <li key={d.question_id} className="a-li">
                <div className="pr-danger-row">
                  <b dir="rtl">{isolateLatin(q?.question ?? "שאלה")}</b>
                  <span className="a-row between">
                    <span className="m">
                      {d.chosen ? (
                        <>
                          ענית ׳<bdi>{isolateLatin(d.chosen)}</bdi>׳.{" "}
                        </>
                      ) : null}
                      נכון: <bdi>{isolateLatin(d.right_text)}</bdi>
                      {slide ? (
                        <>
                          {" "}
                          <span className="a-tag src-tag">
                            ש׳ <bdi dir="ltr">{slide}</bdi>
                          </span>
                        </>
                      ) : null}
                    </span>
                    <span className="a-chip busy">{dueChip(d.due_day, today)}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="a-card dashed empty pr-empty">
          <p>אין כרגע טעויות ׳על בטוח׳.</p>
          <p className="a-small a-muted">תשובה שגויה אחרי ׳על בטוח׳ נכנסת לכאן, וחוזרת למחרת בניסוח אחר.</p>
        </div>
      )}
      {data.danger.length ? <p className="a-small a-muted">חוזרות בניסוח אחר, עד פעמיים נכון ׳על בטוח׳.</p> : null}
      {flags.mistakes && againCount ? (
        <RouteLink to={{ v: "practice", s: AGAIN_KEY(groupId) }} go={ctx.go} className="a-btn primary wide pr-again">
          לתרגל את מה שחוזר היום ({againCount})
        </RouteLink>
      ) : null}
    </section>
  );

  /* ── aspects (PR4) ── */
  const bucketed = data.aspects.filter((a) => a.bucket !== null);
  const aMeter = aspectMeter(data.aspects);
  const aspectName = (a: string) => ASPECTS[a as keyof typeof ASPECTS] ?? ASPECTS.other;
  const aspects = (
    <section className="a-stack pr-aspects" aria-label="לפי היבט">
      <div className="a-wrap">
        <b className="a-small">לפי היבט:</b>
        {bucketed.map((a) => (
          <span key={a.aspect} className={`a-chip ${a.bucket ? BUCKET_CHIP[a.bucket] : ""}`.trim()}>
            {aspectName(a.aspect)}: {a.bucket ? BUCKET_TEXT[a.bucket] : ""}
          </span>
        ))}
        {!bucketed.length ? <span className="a-small a-muted">עוד אין היבט עם {ASPECT_MIN} שאלות.</span> : null}
      </div>
      {aMeter ? (
        <p className="a-small a-muted pr-meter">
          היבט מופיע מ-{ASPECT_MIN} שאלות. הכי קרוב: {aspectName(aMeter.aspect)}, עוד {aMeter.left === 1 ? "שאלה אחת" : `${aMeter.left} שאלות`}.
        </p>
      ) : null}
    </section>
  );

  /* ── calibration (PR5) ── */
  const cal = calibrationPick(data.calibration);
  const calibration =
    "row" in cal ? (
      <section className="a-row pr-calibration" aria-label="כשסימנת ׳על בטוח׳">
        <span className="a-ring" style={{ "--p": `${cal.row.pct}%` } as CSSProperties} aria-hidden="true">
          <span>
            <bdi dir="ltr">{cal.row.pct}%</bdi>
          </span>
        </span>
        <span className="a-small">
          <b>
            {cal.row.scope === "all" ? "" : (
              <>
                {calWhere(heading({ lecture_id: cal.row.lecture_id, part_idx: cal.row.part_idx }) || "נושא")},{" "}
              </>
            )}
            כשסימנת ׳על בטוח׳, צדקת ב-{cal.row.pct}% מהפעמים.
          </b>{" "}
          <span className="a-muted">מופיע אחרי כ-{CALIBRATION_MIN} תשובות.</span>
        </span>
      </section>
    ) : (
      <section className="a-row pr-calibration" aria-label="כשסימנת ׳על בטוח׳">
        <span className="a-ring pr-ring-wait" style={{ "--p": `${Math.round((100 * (CALIBRATION_MIN - cal.left)) / CALIBRATION_MIN)}%` } as CSSProperties} aria-hidden="true">
          <span>
            <bdi dir="ltr">
              {CALIBRATION_MIN - cal.left}/{CALIBRATION_MIN}
            </bdi>
          </span>
        </span>
        <span className="a-small">
          <b>כמה פעמים צדקת כשסימנת ׳על בטוח׳</b>{" "}
          <span className="a-muted">
            מופיע אחרי כ-{CALIBRATION_MIN} תשובות: עוד {cal.left === 1 ? "אחת" : cal.left}.
          </span>
        </span>
      </section>
    );

  return (
    <main className="progress-screen">
      {head}
      <div className="a-stack pr-body">
        {readiness}
        {danger}
        {aspects}
        {calibration}
      </div>
    </main>
  );
}
