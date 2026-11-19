import "../styles/museum.css";
import { useEffect, useState, type CSSProperties } from "react";
import {
  claimOf,
  EMPTY_LINE,
  FOOT_LINE,
  groupNeedPct,
  meterPct,
  museumGroupNeedLine,
  museumMeterLine,
  museumTitle,
  OUT_LINE,
  plaqueLine,
  RETIRE_LINE,
  STATE_CHIP,
  SUB_LINE,
  waitingLine,
  type Exhibit,
  type MuseumMeter,
} from "../../../shared/study/museum";
import type { ScreenProps } from "../features/types";
import { getLecture } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { getMuseum, getMuseumMeter } from "../lib/museum";
import { isolateLatin } from "../lib/rich";
import { BackLink, Head, Loading, RouteLink } from "./Shell";

/* ── טעויות נפוצות (?v=museum, ?v=museum&l=; package U, U-3; mockup
 * museum.html screen 1, the fun design §5.5's M-1 … M-12) ──
 *
 * The head "טעויות נפוצות · {course}" with the number of exhibits; the
 * line "רק טעויות ׳על בטוח׳ של לפחות 3 מכם · בלי שמות"; the newest exhibit
 * still hanging as a card (its number and state, the claim, the plaque, the
 * truth and what confused, each with its slides); "עוד במוזיאון" with the
 * rest, retired ones last ("נסגרה"); the footer "מוצג נפתח רק למחרת".
 *
 * Decision 3 (17 Nov 2026): the museum opens with whatever it has. Under the
 * exhibits (or in place of them) the meter says, from the night's counts,
 * how many exhibits there are and how many more wrong "על בטוח" bets the
 * closest candidate needs; nothing below the floor of 3 members is ever an
 * exhibit, and the meter never says which question or who. A member the
 * night has not counted sees when it opens for them; an opted-out member,
 * how to come back. Never a dead end: practice is one tap away. */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");

type Data = { meter: MuseumMeter; exhibits: Exhibit[] };

function Slides({ n }: { n: number[] }) {
  if (!n.length) return null;
  return (
    <>
      {" "}
      <span className="a-tag">ש׳ {n.slice(0, 3).join(",")}</span>
    </>
  );
}

export default function MuseumScreen({ route, ctx }: ScreenProps<"museum">) {
  const [data, setData] = useState<Data | null>(null);
  const [lectureTitle, setLectureTitle] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    (async () => {
      const meter = await getMuseumMeter(ctx.group.id, route.l);
      const exhibits = meter.state === "open" ? await getMuseum(ctx.group.id, route.l) : [];
      if (alive) setData({ meter, exhibits });
    })().catch((e) => alive && setError(failText(codeOf(e), "museum")));
    if (route.l)
      getLecture(route.l)
        .then((l) => alive && l && setLectureTitle(l.title))
        .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, route.l]);

  const exhibits = data?.exhibits ?? [];
  const named = museumTitle(exhibits, route.l ? lectureTitle : undefined);
  const head = (
    <>
      <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />}>
        <h1 className="t">{named ? <>טעויות נפוצות · {isolateLatin(named, "mt")}</> : "טעויות נפוצות"}</h1>
        {data && data.meter.state === "open" && exhibits.length > 0 ? (
          <span className="a-chip fun" aria-label={`${exhibits.length} מוצגים`}>
            {exhibits.length}
          </span>
        ) : null}
      </Head>
      <p className="ph-sub">
        <span>{SUB_LINE}</span>
        <span aria-hidden="true">·</span>
        <b className="museum-nonames">בלי שמות</b>
      </p>
    </>
  );

  if (error)
    return (
      <main className="museum-screen">
        {head}
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!data)
    return (
      <main className="museum-screen">
        {head}
        <Loading />
      </main>
    );

  const { meter } = data;
  const practice = flags.practice ? (
    <RouteLink to={{ v: "practice" }} go={ctx.go} className="a-btn small">
      לתרגל
    </RouteLink>
  ) : null;

  if (meter.state !== "open")
    return (
      <main className="museum-screen">
        {head}
        {meter.state === "off" ? <p className="a-card flat a-muted museum-state">{failText("off", "museum")}</p> : null}
        {meter.state === "out" ? (
          <div className="a-card flat museum-state">
            <p>{OUT_LINE}</p>
            <RouteLink to={{ v: "me" }} go={ctx.go} className="a-btn small">
              לשלי
            </RouteLink>
          </div>
        ) : null}
        {meter.state === "waiting" ? (
          <div className="a-card flat museum-state" data-meter="waiting">
            <p>{waitingLine(meter.join_days_left)}</p>
            <Bar pct={Math.round((100 * Math.max(0, meter.join_days - meter.join_days_left)) / Math.max(1, meter.join_days))} label={`${Math.max(0, meter.join_days - meter.join_days_left)} מתוך ${meter.join_days} ימים בקבוצה`} />
            {practice}
          </div>
        ) : null}
      </main>
    );

  const hanging = exhibits.filter((e) => e.state !== "retired");
  const feature = hanging[0] ?? null;
  const rest = exhibits.filter((e) => e !== feature);
  const meterLine = meter.group_need > 0 ? museumGroupNeedLine(meter.group_need) : museumMeterLine(meter);
  const meterBlock = (
    <div className="a-card flat museum-meter" data-meter={meter.group_need > 0 ? "group" : "bets"}>
      <p className="a-small">
        <b>{meterLine}</b>
      </p>
      <Bar pct={meter.group_need > 0 ? groupNeedPct(meter.group_need) : meterPct(meter)} label={meterLine} />
      {!exhibits.length ? practice : null}
    </div>
  );

  return (
    <main className="museum-screen">
      {head}
      {!exhibits.length ? (
        <>
          <p className="a-card dashed empty">{EMPTY_LINE}</p>
          {meterBlock}
        </>
      ) : null}
      {feature ? <FeatureCard e={feature} /> : null}
      {rest.length ? (
        <section className="a-stack" aria-labelledby="museum-more-h">
          <div className="a-sec">
            <h2 id="museum-more-h">{feature ? "עוד טעויות נפוצות" : "כל הטעויות"}</h2>
            <span className="a-small a-muted">{RETIRE_LINE}</span>
          </div>
          <ul className="a-list museum-list">
            {rest.map((e) => (
              <li key={e.trap_id} className="a-li" data-state={e.state}>
                <div className="museum-li">
                  <span className="a-row between">
                    <b>{isolateLatin(claimOf(e), `c${e.trap_id}`)}</b>
                    <StateChip e={e} />
                  </span>
                  <span className="m">
                    האמת: {isolateLatin(e.truth, `t${e.trap_id}`)}
                    <Slides n={e.slides} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {exhibits.length ? meterBlock : null}
      <p className="a-small a-muted">{FOOT_LINE}</p>
    </main>
  );
}

function StateChip({ e }: { e: Exhibit }) {
  const c = STATE_CHIP[e.state];
  if (!c.tone) return <span className="a-small a-muted museum-state-word">{c.text}</span>;
  return <span className={`a-chip ${c.tone}`}>{c.text}</span>;
}

function FeatureCard({ e }: { e: Exhibit }) {
  return (
    <article className="a-card museum-feature" aria-labelledby={`ex-${e.trap_id}`}>
      <div className="a-row between">
        <span className="a-chip fun">טעות מס׳ {e.exhibit_no}</span>
        <StateChip e={e} />
      </div>
      <p className="a-small a-muted museum-stem">
        <bdi>{isolateLatin(e.stem, `s${e.trap_id}`)}</bdi>
      </p>
      <h2 className="a-h2" id={`ex-${e.trap_id}`}>
        {isolateLatin(claimOf(e), `c${e.trap_id}`)}
      </h2>
      <span className="a-small a-muted">{isolateLatin(plaqueLine(e), `p${e.trap_id}`)}</span>
      <div className="a-divider" />
      <p className="a-para">
        <b>האמת:</b> {isolateLatin(e.truth, `t${e.trap_id}`)}
        <Slides n={e.slides} />
      </p>
      {e.confused ? (
        <p className="a-para">
          <b>מה בלבל:</b> {isolateLatin(e.confused, `f${e.trap_id}`)}
        </p>
      ) : null}
      {e.takeaway ? (
        <p className="a-small a-muted">
          <b>מה לזכור:</b> {isolateLatin(e.takeaway, `k${e.trap_id}`)}
        </p>
      ) : null}
    </article>
  );
}

/** A meter's bar (the words beside it carry the meaning; the bar is extra). */
function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="a-bar group" role="img" aria-label={label}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` } as CSSProperties} />
    </div>
  );
}
