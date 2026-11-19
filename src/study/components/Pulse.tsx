import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { studyDay, dateOfDay } from "../../../shared/study/day";
import {
  BUCKET_CHIP,
  BUCKET_HE,
  briefHead,
  EMPTY_LINE,
  groupNeedLine,
  lectureLine,
  lectureMeterLine,
  mergePulse,
  needLine,
  OUT_LINE,
  PULSE,
  sections,
  waitingLine,
  type Bucket,
  type LectureMeter,
  type MergedRow,
} from "../../../shared/study/pulse";
import { TopicLabel } from "../features/pulse";
import type { ScreenProps } from "../features/types";
import { getLecture, lectureTitles, type Lecture } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { meetingBand } from "../lib/meeting";
import { getBrief, getMeter, getMyPulse, getPulse, type Brief, type Meter, type MyRow, type PulseRow } from "../lib/pulse";
import { isolateLatin } from "../lib/rich";
import type { Route } from "../lib/route";
import { Icon } from "./Icon";
import { BackLink, Head, Loading, RouteLink } from "./Shell";
import SlideSheet from "./SlideSheet";

/* ── מה קשה לקבוצה (?v=pulse, ?v=pulse&l=; package U, U-2; progress-pulse.html
 * screen 2, the fun design §5.5 and its copy P-1 … P-14) ──
 *
 * One lecture: the head "מה קשה לקבוצה · {title}" and the line under it; the
 * sections קשה · בינוני · יושב טוב (only non-empty ones), the first one's header
 * carrying "אצלך" and "רק לך"; a row is "{topic} · {aspect}" with its slide
 * tag, the member's own chip on the left, "רק אצלך חם, אז זה נכנס לתור
 * האישי" or (one row at most) "החור שנסגר השבוע"; a tap practises the topic.
 * Then "מחר בפגישה:" (or "בפגישה הבאה:") and the footer. Every lecture (no
 * l): one row a lecture, "קשה לקבוצה: …" or "הכול יושב טוב".
 *
 * Decision 3 (17 Nov 2026): below the floor the screen never ends in a lock.
 * It shows the meter from the night's counts (study_pulse_meter: "עוד אדם
 * אחד וזה נפתח", or how many days until the night counts this member) and
 * the member's own "אצלך" rows, which are theirs to see at any count. */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");

type Data = { meter: Meter; group: PulseRow[]; mine: MyRow[]; brief: Brief | null; nextMeeting: string | null };

export default function PulseScreen({ route, ctx }: ScreenProps<"pulse">) {
  const [data, setData] = useState<Data | null>(null);
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [slide, setSlide] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    (async () => {
      const meter = await getMeter(ctx.group.id);
      const open = meter.state === "open";
      const [group, mine, brief, band] = await Promise.all([
        open ? getPulse(ctx.group.id, route.l) : Promise.resolve([] as PulseRow[]),
        meter.state === "off" ? Promise.resolve([] as MyRow[]) : getMyPulse(ctx.group.id, route.l),
        open && route.l ? getBrief(route.l).catch(() => null) : Promise.resolve(null),
        open && route.l && flags.meeting ? meetingBand(ctx.group.id).catch(() => []) : Promise.resolve([]),
      ]);
      const next = band.find((m) => m.lecture_id === route.l && !m.over) ?? null;
      if (alive) setData({ meter, group, mine, brief, nextMeeting: next ? next.day : null });
    })().catch((e) => alive && setError(failText(codeOf(e), "pulse")));
    if (route.l)
      getLecture(route.l)
        .then((l) => alive && setLecture(l))
        .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, route.l]);

  // Every lecture: their titles.
  const lectureIds = useMemo(() => {
    if (route.l || !data) return [];
    const ids = new Set<string>(data.group.map((r) => r.lecture_id));
    if (data.meter.state === "open") for (const m of data.meter.lectures) ids.add(m.lecture_id);
    for (const m of data.mine) ids.add(m.lecture_id);
    return [...ids];
  }, [data, route.l]);
  useEffect(() => {
    if (!lectureIds.length) return;
    let alive = true;
    lectureTitles(lectureIds)
      .then((t) => alive && setTitles(t))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lectureIds]);

  const title = route.l ? lecture?.title ?? "" : "";
  const head = (
    <>
      <Head back={<BackLink go={ctx.go} fallback={route.l ? { v: "pulse" } : { v: "group" }} />}>
        <h1 className="t">{title ? <>מה קשה לקבוצה · {isolateLatin(title, "pt")}</> : "מה קשה לקבוצה"}</h1>
      </Head>
      <p className="ph-sub">
        <span>מתעדכן בלילה</span>
        <span aria-hidden="true">·</span>
        <span>בלי שמות, רק איפה ש-3 לפחות תרגלו</span>
      </p>
    </>
  );

  if (error)
    return (
      <main className="pulse-screen">
        {head}
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!data)
    return (
      <main className="pulse-screen">
        {head}
        <Loading />
      </main>
    );

  const { meter } = data;
  const practise = (topicKey: string): Route | null => (flags.practice ? { v: "practice", s: `t.${topicKey}` } : null);

  return (
    <main className="pulse-screen">
      {head}
      {meter.state === "off" ? <p className="a-card flat a-muted pulse-state">{failText("off", "pulse")}</p> : null}
      {meter.state === "out" ? (
        <div className="a-card flat pulse-state">
          <p>{OUT_LINE}</p>
          <RouteLink to={{ v: "me" }} go={ctx.go} className="a-btn small">
            לשלי
          </RouteLink>
        </div>
      ) : null}
      {meter.state === "waiting" ? (
        <div className="a-card flat pulse-state" data-meter="waiting">
          <p>{waitingLine(meter.join_days_left)}</p>
          <MeterBar done={Math.max(0, meter.join_days - meter.join_days_left)} of={meter.join_days} label={`${Math.max(0, meter.join_days - meter.join_days_left)} מתוך ${meter.join_days} ימים בקבוצה`} />
        </div>
      ) : null}

      {meter.state === "open" && route.l ? (
        <LectureBody ctx={ctx} data={data} lectureId={route.l} practise={practise} onSlide={setSlide} />
      ) : null}
      {meter.state === "open" && !route.l ? <LectureList ctx={ctx} data={data} titles={titles} /> : null}

      {meter.state === "waiting" || meter.state === "out" ? <MineOnly ctx={ctx} rows={data.mine} titles={titles} perLecture={!route.l} practise={practise} /> : null}

      {meter.state === "open" ? <p className="a-small a-muted">אפשר לצאת מהספירה ב׳שלי׳.</p> : null}
      {slide !== null && lecture ? <SlideSheet lecture={lecture} slide={slide} onClose={() => setSlide(null)} go={ctx.go} /> : null}
    </main>
  );
}

/** A meter: a bar and its words (the words carry the meaning; the bar is extra). */
function MeterBar({ done, of, label }: { done: number; of: number; label: string }) {
  const pct = of > 0 ? Math.round((100 * Math.min(done, of)) / of) : 0;
  return (
    <div className="a-row pulse-meter">
      <div className="a-bar group" role="img" aria-label={label}>
        <i style={{ width: `${pct}%` } as CSSProperties} />
      </div>
    </div>
  );
}

function OwnChip({ bucket }: { bucket: Bucket | undefined }) {
  if (!bucket) return null;
  return <span className={`a-chip ${BUCKET_CHIP[bucket]}`.trim()}>{BUCKET_HE[bucket]}</span>;
}

function LectureBody({
  ctx,
  data,
  lectureId,
  practise,
  onSlide,
}: {
  ctx: ScreenProps<"pulse">["ctx"];
  data: Data;
  lectureId: string;
  practise: (k: string) => Route | null;
  onSlide: (n: number) => void;
}) {
  const meter = data.meter.state === "open" ? data.meter : null;
  const rows = mergePulse(data.group, data.mine);
  const lm: LectureMeter | undefined = meter?.lectures.find((m) => m.lecture_id === lectureId);
  const meterLine = lectureMeterLine(lm);
  const groupNeed = meter?.group_need ?? 0;
  const brief = data.brief;
  const today = dateOfDay(studyDay(Date.now()));

  if (!rows.length) {
    // Decision 3: an empty state with its meter, and the member's own rows.
    return (
      <>
        <p className="a-card dashed empty">{EMPTY_LINE}</p>
        {groupNeed > 0 ? (
          <div className="a-card flat pulse-state" data-meter="group">
            <p className="a-small">{groupNeedLine(groupNeed)}</p>
            <MeterBar done={PULSE.FLOOR - groupNeed} of={PULSE.FLOOR} label={`${PULSE.FLOOR - groupNeed} מתוך ${PULSE.FLOOR} נספרים`} />
          </div>
        ) : lm && lm.need != null ? (
          <div className="a-card flat pulse-state" data-meter="lecture">
            <p className="a-small">
              <b>{needLine(lm.need)}</b> <span className="a-muted">· הנושא הקרוב ביותר נפתח מ-{PULSE.FLOOR} מתרגלים.</span>
            </p>
            <MeterBar done={PULSE.FLOOR - lm.need} of={PULSE.FLOOR} label={`${PULSE.FLOOR - lm.need} מתוך ${PULSE.FLOOR} מתרגלים`} />
          </div>
        ) : null}
        <MineOnly ctx={ctx} rows={data.mine} titles={{}} perLecture={false} practise={practise} />
      </>
    );
  }

  const secs = sections(rows);
  return (
    <>
      {secs.map((s, i) => (
        <section key={s.bucket} className="a-stack pulse-section" aria-labelledby={`pulse-${s.bucket}`}>
          <div className="a-sec">
            <h2 id={`pulse-${s.bucket}`}>{BUCKET_HE[s.bucket]}</h2>
            {i === 0 ? (
              <span className="a-row">
                <span className="a-small a-muted">אצלך</span>
                <span className="a-chip">רק לך</span>
              </span>
            ) : null}
          </div>
          <ul className="a-list">
            {s.rows.map((r) => (
              <PulseLine key={`${r.topic_key}|${r.aspect}`} row={r} to={practise(r.topic_key)} go={ctx.go} onSlide={onSlide} />
            ))}
          </ul>
        </section>
      ))}
      {meterLine ? (
        <div className="pulse-state" data-meter="lecture">
          <p className="a-small a-muted">{meterLine}</p>
          {lm ? <MeterBar done={lm.open} of={lm.open + lm.waiting} label={meterLine} /> : null}
        </div>
      ) : null}
      {brief && (brief.hot || brief.question) ? (
        <aside className="a-callout pulse-brief">
          <b>{briefHead(data.nextMeeting, today)}</b> {brief.hot ? (
            <>
              הנושא הקשה ׳<TopicLabel topic={brief.hot.topic} aspect={brief.hot.aspect} />׳
            </>
          ) : null}
          {brief.hot && brief.question ? ", ובמבחן הקבוצתי " : brief.question ? "במבחן הקבוצתי " : null}
          {brief.question ? <>׳{isolateLatin(brief.question.question, "bq")}׳</> : null}
          {(brief.question?.slides ?? brief.hot?.slides ?? [])[0] ? (
            <>
              {" "}
              <span className="a-tag">ש׳ {(brief.question?.slides ?? brief.hot?.slides ?? [])[0]}</span>
            </>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

function PulseLine({ row, to, go, onSlide }: { row: MergedRow; to: Route | null; go: ScreenProps<"pulse">["ctx"]["go"]; onSlide: (n: number) => void }) {
  const label = <TopicLabel topic={row.topic} aspect={row.aspect} />;
  const first = row.slides[0];
  return (
    <li className="a-li pulse-row" data-bucket={row.bucket}>
      <div>
        <b>
          {to ? (
            <RouteLink to={to} go={go} className="pulse-topic">
              {label}
            </RouteLink>
          ) : (
            label
          )}
          {first ? (
            <>
              {" "}
              <button type="button" className="a-tag pulse-slide" onClick={() => onSlide(first)} aria-label={`שקף ${first}`}>
                ש׳ {first}
              </button>
            </>
          ) : null}
        </b>
        {row.alone ? <span className="m">קשה רק לך, אז זה נכנס לתור האישי</span> : null}
        {row.closedNote ? (
          <span className="m">
            <Icon name="award" size={11} /> החור שנסגר השבוע
          </span>
        ) : null}
      </div>
      <OwnChip bucket={row.mine} />
    </li>
  );
}

function LectureList({ ctx, data, titles }: { ctx: ScreenProps<"pulse">["ctx"]; data: Data; titles: Record<string, string> }) {
  const meter = data.meter.state === "open" ? data.meter : null;
  const byLecture = new Map<string, PulseRow[]>();
  for (const r of data.group) byLecture.set(r.lecture_id, [...(byLecture.get(r.lecture_id) ?? []), r]);
  const waiting = (meter?.lectures ?? []).filter((m) => !byLecture.has(m.lecture_id) && m.need != null);
  const ids = [...byLecture.keys()];
  if (!ids.length && !waiting.length)
    return (
      <>
        <p className="a-card dashed empty">עוד אין מספיק תשובות. זה מופיע בכל הרצאה שלפחות {PULSE.FLOOR} מכם מתרגלים, ומתעדכן בלילה.</p>
        {meter && meter.group_need > 0 ? <p className="a-small a-muted">{groupNeedLine(meter.group_need)}</p> : null}
      </>
    );
  return (
    <ul className="a-list pulse-lectures">
      {ids.map((id) => (
        <li key={id}>
          <RouteLink to={{ v: "pulse", l: id }} go={ctx.go} className="a-li">
            <div>
              <b>
                <bdi>{titles[id] ?? ""}</bdi>
              </b>
              <span className="m">{isolateLatin(lectureLine(byLecture.get(id) ?? []), `ll${id}`)}</span>
              {lectureMeterLine(meter?.lectures.find((m) => m.lecture_id === id)) ? (
                <span className="m">{lectureMeterLine(meter?.lectures.find((m) => m.lecture_id === id))}</span>
              ) : null}
            </div>
          </RouteLink>
        </li>
      ))}
      {waiting.map((m) => (
        <li key={m.lecture_id}>
          <RouteLink to={{ v: "pulse", l: m.lecture_id }} go={ctx.go} className="a-li" >
            <div>
              <b>
                <bdi>{titles[m.lecture_id] ?? ""}</bdi>
              </b>
              <span className="m">{needLine(m.need ?? PULSE.FLOOR)}</span>
            </div>
          </RouteLink>
        </li>
      ))}
    </ul>
  );
}

/** The member's own rows ("אצלך"), at any count: theirs alone (decision 3). */
function MineOnly({
  ctx,
  rows,
  titles,
  perLecture,
  practise,
}: {
  ctx: ScreenProps<"pulse">["ctx"];
  rows: MyRow[];
  titles: Record<string, string>;
  perLecture: boolean;
  practise: (k: string) => Route | null;
}) {
  if (!rows.length) return null;
  const order: Record<Bucket, number> = { hot: 0, warm: 1, cool: 2 };
  const sorted = [...rows].sort((a, b) => order[a.mine] - order[b.mine] || a.topic_key.localeCompare(b.topic_key)).slice(0, 8);
  return (
    <section className="a-stack pulse-section pulse-mine" aria-labelledby="pulse-mine-h">
      <div className="a-sec">
        <h2 id="pulse-mine-h">אצלך</h2>
        <span className="a-chip">רק לך</span>
      </div>
      <ul className="a-list">
        {sorted.map((r) => {
          const to = practise(r.topic_key);
          const label = <TopicLabel topic={r.topic || r.topic_key} aspect={r.aspect} />;
          return (
            <li key={`${r.lecture_id}|${r.topic_key}|${r.aspect}`} className="a-li pulse-row" data-bucket={r.mine}>
              <div>
                <b>
                  {to ? (
                    <RouteLink to={to} go={ctx.go} className="pulse-topic">
                      {label}
                    </RouteLink>
                  ) : (
                    label
                  )}
                </b>
                {perLecture && titles[r.lecture_id] ? (
                  <span className="m">
                    <bdi>{titles[r.lecture_id]}</bdi>
                  </span>
                ) : null}
              </div>
              <OwnChip bucket={r.mine} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
