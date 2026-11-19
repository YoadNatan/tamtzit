import { useEffect, useState } from "react";
import { groupNeedLine, lectureLine, needLine, PULSE, SETTING_LINE, waitingLine, type Meter, type PulseRow } from "../../../shared/study/pulse";
import type { Ctx } from "../features/types";
import { lectureTitles } from "../lib/api";
import { flags } from "../lib/flags";
import { getMeter, getOptOut, getPulse, setOptOut } from "../lib/pulse";
import { isolateLatin } from "../lib/rich";
import { RouteLink } from "./Shell";

/* ── The pulse's card on "יחד" and its setting under "שלי" (package U, U-2;
 * the fun design §5.5, P-11 and P-12, with decision 3's meter) ──
 * Loaded on their own chunk by features/pulse.tsx's PulseCard and
 * PulseSettingRow, so the study entry keeps only their two small frames. */

type CardData = { meter: Meter; rows: PulseRow[]; titles: Record<string, string> };

/** P-11 "דופק הקבוצה" on "יחד": up to three lectures with hot topics; below
 *  the floor, the meter (decision 3); hidden while the switch is off or the
 *  member is out. */
export function PulseCardBody({ ctx }: { ctx: Ctx }) {
  const [d, setD] = useState<CardData | null>(null);
  useEffect(() => {
    if (!flags.pulse) return;
    let alive = true;
    (async () => {
      const meter = await getMeter(ctx.group.id);
      const rows = meter.state === "open" ? await getPulse(ctx.group.id) : [];
      const ids = [...new Set([...rows.map((r) => r.lecture_id), ...(meter.state === "open" ? meter.lectures.map((m) => m.lecture_id) : [])])];
      const titles = ids.length ? await lectureTitles(ids) : {};
      if (alive) setD({ meter, rows, titles });
    })().catch(() => undefined); // the card is extra: "יחד" stays as it is
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  if (!flags.pulse || !d || d.meter.state === "off" || d.meter.state === "out") return null;
  const { meter, rows, titles } = d;
  const hot = new Map<string, PulseRow[]>();
  for (const r of rows) if (r.bucket === "hot") hot.set(r.lecture_id, [...(hot.get(r.lecture_id) ?? []), r]);
  const lines: Array<{ key: string; to: { v: "pulse"; l?: string }; title?: string; text: string }> = [];
  if (meter.state === "waiting") lines.push({ key: "w", to: { v: "pulse" }, text: waitingLine(meter.join_days_left) });
  if (meter.state === "open") {
    for (const [id, rs] of [...hot].slice(0, 3)) lines.push({ key: id, to: { v: "pulse", l: id }, title: titles[id] ?? "", text: lectureLine(rs) });
    if (!lines.length) {
      if (meter.group_need > 0) lines.push({ key: "g", to: { v: "pulse" }, text: groupNeedLine(meter.group_need) });
      else if (rows.length) lines.push({ key: "c", to: { v: "pulse" }, text: "הכול יושב טוב" });
      else {
        const close = meter.lectures.filter((m) => m.need != null).sort((a, b) => (a.need ?? 9) - (b.need ?? 9))[0];
        lines.push({ key: "m", to: close ? { v: "pulse", l: close.lecture_id } : { v: "pulse" }, title: close ? titles[close.lecture_id] ?? "" : undefined, text: close ? needLine(close.need ?? PULSE.FLOOR) : `עוד אין דופק. הוא מופיע כשלפחות ${PULSE.FLOOR} מכם מתרגלים הרצאה.` });
      }
    }
  }
  return (
    <section className="a-stack pulse-card" aria-labelledby="pulse-card-h">
      <div className="a-sec">
        <h2 id="pulse-card-h">דופק הקבוצה</h2>
        {meter.state === "open" && rows.length ? <span className="a-small a-muted">עודכן הלילה</span> : null}
      </div>
      <ul className="a-list">
        {lines.map((l) => (
          <li key={l.key}>
            <RouteLink to={l.to} go={ctx.go} className="a-li row-link">
              <div className="pulse-card-line">
                {l.title ? (
                  <b>
                    <bdi>{l.title}</bdi>
                  </b>
                ) : null}
                <span className={l.title ? "m" : undefined}>{isolateLatin(l.text, `pc${l.key}`)}</span>
              </div>
            </RouteLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** P-12 "לא לכלול אותי בדופק" under "שלי" → הגדרות. */
export function PulseSettingBody({ ctx }: { ctx: Ctx }) {
  const [out, setOut] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!flags.pulse) return;
    let alive = true;
    getOptOut(ctx.group.id)
      .then((o) => alive && setOut(o))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  if (!flags.pulse || out === null) return null;
  const change = async (next: boolean) => {
    setBusy(true);
    setOut(next); // at once: the box follows the tap, and goes back if the write fails
    try {
      await setOptOut(ctx.group.id, next);
      ctx.say(next ? "יצאת מהספירה. מהלילה הבא התשובות שלך לא נספרות, והדופק לא מוצג לך." : "חזרת לספירה. הדופק יחזור אחרי הספירה של הלילה.");
    } catch {
      setOut(!next);
      ctx.say("ההגדרה לא נשמרה. כדאי לבדוק את החיבור.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="a-li setting-row setting-check pulse-setting">
      <span className="a-stack">
        <span>לא לכלול אותי בדופק</span>
        <small className="a-small a-muted">{SETTING_LINE}</small>
      </span>
      <input type="checkbox" checked={out} disabled={busy} onChange={(e) => void change(e.target.checked)} />
    </label>
  );
}

