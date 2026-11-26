import { useEffect, useMemo, useState } from "react";
import { blankKey, lectureBlankTables, shapeOk, tableName, type SlideLike } from "../../../shared/study/blankTable";
import { blankMeter, trapMeter } from "../../../shared/study/extras";
import type { Ctx } from "../features/types";
import { myTraps, meterRows, slideTables, type MyTrapRow } from "../lib/extras";
import { flags } from "../lib/flags";
import { isolateLatin } from "../lib/rich";
import { RouteLink } from "./Shell";
import "../styles/extras.css";

/* ── A lecture's practice: the extras (package E; spec §12.6.E, decision 3) ──
 *
 * "טבלה ריקה": the lecture's slides with a table to fill, each a way in
 * (?v=practice&s=b.<lecture>.<slide>), and the meter: how many tables there
 * are, and where the group's other tables are when this lecture has none
 * (the empty state, never a dead end). "שאלה משלי": the author's own meter
 * (in the bank, named, waiting for a live quiz, to fix) and "להוסיף מלכודת
 * משלי". Each part with its flag. */

type Others = { tables: number; lectures: number; first: string | null };

export default function ExtrasCard({ ctx, lectureId, slides }: { ctx: Ctx; lectureId: string; slides: readonly SlideLike[] }) {
  const tables = useMemo(() => (flags.blankTable ? lectureBlankTables(slides) : []), [slides]);
  const [others, setOthers] = useState<Others | null>(null);
  const [mine, setMine] = useState<MyTrapRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    // The group's other tables are read only when this lecture has none (the empty state's meter).
    // With practice sets (§5.11) a lecture without a table shows no "טבלה ריקה" card, so nothing to read.
    if (flags.blankTable && !tables.length && !flags.make)
      slideTables(ctx.group.id)
        .then((rows) => {
          const other = rows.filter((r) => r.lecture_id !== lectureId && shapeOk(r));
          const lectures = [...new Set(other.map((r) => r.lecture_id))];
          alive && setOthers({ tables: other.length, lectures: lectures.length, first: lectures[0] ?? null });
        })
        .catch(() => alive && setOthers({ tables: 0, lectures: 0, first: null }));
    if (flags.traps)
      myTraps()
        .then((rows) => alive && setMine(rows.filter((r) => r.lecture_id === lectureId)))
        .catch(() => alive && setMine([]));
    return () => {
      alive = false;
    };
  }, [ctx.group.id, lectureId, tables.length]);

  const blank = flags.blankTable && (tables.length || !flags.make) ? blankMeter(tables.length, others ?? { tables: 0, lectures: 0 }) : null;
  const traps = flags.traps && mine ? trapMeter(meterRows(mine), Date.now()) : null;

  return (
    <>
      {blank ? (
        <section className={`a-card extras-blank${blank.empty ? " dashed" : ""}`} aria-labelledby="blank-h">
          <div className="a-sec">
            <h2 id="blank-h">טבלה ריקה</h2>
            <span className="a-small a-muted">בלי עלות</span>
          </div>
          <p className="a-small a-muted blank-meter">{blank.line}</p>
          {tables.length ? (
            <ul className="a-list blank-list">
              {tables.map((t) => (
                <RouteLink key={t.slide} to={{ v: "practice", l: lectureId, s: blankKey(lectureId, t.slide) }} go={ctx.go} className="a-li blank-row">
                  <div>
                    <b dir="rtl">{isolateLatin(tableName(t), `bt${t.slide}`)}</b>
                    <span className="m">
                      {flags.make ? "שקף" : "ש׳"} <bdi dir="ltr">{t.slide}</bdi> · {t.rows.length} שורות
                    </span>
                  </div>
                  <span className="a-chip busy">למלא</span>
                </RouteLink>
              ))}
            </ul>
          ) : null}
          {blank.next && (blank.empty ? others : true) ? <p className="a-small a-muted blank-next">{blank.next}</p> : null}
          {blank.empty && others?.first ? (
            <RouteLink to={{ v: "practice", l: others.first }} go={ctx.go} className="a-btn small">
              לתרגול של הרצאה עם טבלה
            </RouteLink>
          ) : null}
        </section>
      ) : null}
      {flags.traps ? (
        <section className="a-card extras-traps" aria-labelledby="traps-h">
          <div className="a-sec">
            <h2 id="traps-h">שאלה משלי</h2>
            {/* With practice sets (§5.11): the question is the group's, so not "רק לך". */}
            {flags.make ? <span className="a-small a-muted traps-where">נכנסת לבנק של הקבוצה בלי שם</span> : <span className="a-chip">רק לך</span>}
          </div>
          {traps ? (
            <>
              {traps.line ? <p className="a-small trap-meter">{traps.line}</p> : null}
              {traps.next ? <p className="a-small a-muted trap-next">{traps.next}</p> : null}
            </>
          ) : (
            <p className="a-small a-muted">טוען…</p>
          )}
          <RouteLink to={{ v: "trap", l: lectureId }} go={ctx.go} className="a-btn add-trap">
            להוסיף שאלה משלי
          </RouteLink>
        </section>
      ) : null}
    </>
  );
}
