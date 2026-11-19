import "../styles/museum.css";
import { useEffect, useState } from "react";
import {
  badgeText,
  claimOf,
  museumGroupNeedLine,
  museumMeterLine,
  plaqueLine,
  TRAP_CHIP,
  VACCINE_WHY,
  waitingLine,
  type Exhibit,
  type MuseumMeter,
  type TrapCardKind,
} from "../../../shared/study/museum";
import type { Ctx } from "../features/types";
import { flags } from "../lib/flags";
import { getMuseum, getMuseumMeter, museumPick, museumShown, trapCards } from "../lib/museum";
import { isolateLatin } from "../lib/rich";
import { RouteLink } from "./Shell";

/* ── The museum's small pieces (package U, U-3): its card on "יחד", the one
 * chip on a trap card with "למה זה כאן?", and the meeting's opening exhibit
 * (MU4). Loaded on their own chunk by features/pulse.tsx, so the study entry
 * keeps only their frames. */

/** The museum's card on "יחד": the newest exhibit and the meter (decision 3);
 *  hidden while the switch is off or the member is out. */
export function MuseumCardBody({ ctx }: { ctx: Ctx }) {
  const [d, setD] = useState<{ meter: MuseumMeter; exhibits: Exhibit[] } | null>(null);
  useEffect(() => {
    if (!flags.museum) return;
    let alive = true;
    (async () => {
      const meter = await getMuseumMeter(ctx.group.id);
      const exhibits = meter.state === "open" ? await getMuseum(ctx.group.id) : [];
      if (alive) setD({ meter, exhibits });
    })().catch(() => undefined); // the card is extra: "יחד" stays as it is
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  if (!flags.museum || !d) return null;
  const { meter, exhibits } = d;
  if (meter.state === "off" || meter.state === "out") return null;
  const top = exhibits.find((e) => e.state !== "retired") ?? exhibits[0] ?? null;
  const line =
    meter.state === "waiting" ? waitingLine(meter.join_days_left) : meter.group_need > 0 ? museumGroupNeedLine(meter.group_need) : museumMeterLine(meter);
  return (
    <section className="a-stack museum-card" aria-labelledby="museum-card-h">
      <div className="a-sec">
        <h2 id="museum-card-h">טעויות נפוצות</h2>
        {meter.state === "open" && meter.exhibits > 0 ? <span className="a-chip fun">{meter.exhibits}</span> : null}
      </div>
      <RouteLink to={{ v: "museum" }} go={ctx.go} className="a-li row-link">
        <div className="pulse-card-line">
          {top ? (
            <b className="museum-card-claim">
              טעות מס׳ {top.exhibit_no}: {isolateLatin(claimOf(top), `mc${top.trap_id}`)}
            </b>
          ) : null}
          <span className={top ? "m" : undefined}>{isolateLatin(line, "mcl")}</span>
        </div>
      </RouteLink>
    </section>
  );
}

/** The one chip on a trap card (review F-11): "טעות נפוצה · לחזרה"
 *  with "טעות מס׳ n" for a museum exhibit's card, else "טעות נפוצה בקבוצה".
 *  With `why`, museum.html s2's "למה זה כאן?" under a vaccine. */
export function TrapBadgeBody({ ctx, cardId, why }: { ctx: Ctx; cardId: string; why?: boolean }) {
  const [k, setK] = useState<TrapCardKind | null>(null);
  useEffect(() => {
    let alive = true;
    trapCards(ctx.group.id)
      .then((m) => alive && setK(m.get(cardId) ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, cardId]);
  const b = badgeText(k ?? { kind: "trap", exhibit_no: null });
  if (why) {
    if (!k || k.kind !== "museum") return null;
    return (
      <p className="a-callout museum-why">
        <b>למה זה כאן?</b> {VACCINE_WHY}
      </p>
    );
  }
  return (
    <span className="a-row trap-badge-row">
      <span className={`a-chip ${b.tone} card-badge`}>{b.chip || TRAP_CHIP}</span>
      {b.aside ? <span className="a-small a-muted">{b.aside}</span> : null}
    </span>
  );
}

/** MU4: the meeting opens with one exhibit (30 seconds), then the reading. */
export function ExhibitBody({ ctx, lectureId, onShown }: { ctx: Ctx; lectureId: string; onShown?: () => void }) {
  const [e, setE] = useState<Exhibit | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const id = await museumPick(lectureId);
      if (!id) return;
      const all = await getMuseum(ctx.group.id, lectureId);
      const found = all.find((x) => x.trap_id === id) ?? null;
      if (alive) setE(found);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, lectureId]);
  if (!e) return null;
  const shown = () => {
    void museumShown(e.trap_id).catch(() => undefined);
    onShown?.();
    setE(null);
  };
  return (
    <aside className="a-card flat museum-opening" aria-labelledby={`mo-${e.trap_id}`}>
      <div className="a-row between">
        <b className="a-small" id={`mo-${e.trap_id}`}>
          פותחים בטעות נפוצה
        </b>
        <span className="a-chip group">30 שניות</span>
      </div>
      <p className="a-h2">{isolateLatin(claimOf(e), `oc${e.trap_id}`)}</p>
      <p className="a-small a-muted">{isolateLatin(plaqueLine(e), `op${e.trap_id}`)}</p>
      <p className="a-para">
        <b>האמת:</b> {isolateLatin(e.truth, `ot${e.trap_id}`)}
        {e.slides[0] ? (
          <>
            {" "}
            <span className="a-tag">ש׳ {e.slides.slice(0, 2).join(",")}</span>
          </>
        ) : null}
      </p>
      <button type="button" className="a-btn small" onClick={shown}>
        ממשיכים בהקראה
      </button>
    </aside>
  );
}
