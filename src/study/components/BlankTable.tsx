import { useEffect, useMemo, useState } from "react";
import { cardOf, EMPTY, savedLabel, type SaveState, fillColumns, firstBlankTable, lectureBlankTables, tableName, wrongCells, wrongParts, blankKey, type BlankTable as Table } from "../../../shared/study/blankTable";
import type { Ctx } from "../features/types";
import { getLecture, getSections, type Lecture, type Section } from "../lib/api";
import { addTableCard } from "../lib/extras";
import { failText } from "../lib/failText";
import { BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";
import "../styles/extras.css";

/* ── P10 "טבלה ריקה" (package E; proposal/mockups/practice.html s3) ──
 *
 * The slide's table with its cells empty: "טבלה ריקה · {title}" and
 * "{row}/{rows}" in the top bar, "הטבלה משקף {n}, מהזיכרון · שורה אחר שורה"
 * under it. Row by row, the chips under the table are the column's values;
 * a tap fills the cell marked "?" and moves on. "לבדוק את השורה" compares
 * the row with the slide and opens the next one, as the mockup shows: the
 * checked row's card stays under the chips while the next row is filled. A
 * wrong cell is struck, the slide's value beside it, and becomes the
 * member's private card ("טעות בשורה 4" · "נכנסה לכרטיסיות" · "רק לך";
 * section C's study_my_card_add, origin 'table'). The top bar counts the
 * rows checked. $0: the key is the slide's own table. Nothing of it is the
 * group's. */

type Done = { answers: Record<number, string>; wrong: number[]; saved: SaveState };

export default function BlankTable({ ctx, lectureId, slide }: { ctx: Ctx; lectureId: string; slide: number }) {
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [col, setCol] = useState<number | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([getLecture(lectureId), getSections(lectureId).catch(() => [] as Section[])])
      .then(([l, s]) => {
        if (!alive) return;
        if (!l) setError(failText("lecture not found", "practice"));
        setLecture(l);
        setSections(s);
      })
      .catch(() => alive && setError("הטבלה לא נטענה. כדאי לבדוק את החיבור ולנסות שוב."));
    return () => {
      alive = false;
    };
  }, [lectureId]);

  const t: Table | null = useMemo(() => {
    const s = lecture?.slides.find((x) => x.n === slide);
    return s ? firstBlankTable(s) : null;
  }, [lecture, slide]);
  const cols = t ? fillColumns(t) : [];
  /** The row being filled: the first one not checked yet. */
  const row = done.length;
  const finished = t ? done.length >= t.rows.length : false;
  const active = finished ? null : (col ?? cols.find((c) => answers[c] === undefined) ?? null);

  // A new row (or a new run) starts at its first cell.
  useEffect(() => {
    setAnswers({});
    setCol(null);
  }, [row, run]);

  const back = <BackLink go={ctx.go} fallback={{ v: "practice", l: lectureId }} />;
  if (error) {
    return (
      <main className="blank-table">
        <Head back={back} title="טבלה ריקה" />
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!lecture) return <Loading />;
  if (!t) {
    // Nothing to fill on this slide: the empty state, with the way to the lecture's tables.
    const others = lectureBlankTables(lecture.slides);
    return (
      <main className="blank-table">
        <Head back={back} title="טבלה ריקה" />
        <section className="a-card dashed blank-empty">
          <h2 className="a-h2">בשקף {slide} אין טבלה למילוי</h2>
          <p className="a-small a-muted">
            {others.length ? `בהרצאה הזו יש ${others.length === 1 ? "טבלה אחת" : `${others.length} טבלאות`} למילוי.` : "טבלה ריקה נפתחת על טבלה בשקף עם 2 שורות לפחות מתחת לכותרת."}
          </p>
          {others.length ? (
            <RouteLink to={{ v: "practice", l: lectureId, s: blankKey(lectureId, others[0].slide) }} go={ctx.go} className="a-btn">
              לטבלה בשקף {others[0].slide}
            </RouteLink>
          ) : null}
        </section>
      </main>
    );
  }

  const partOf = (n: number) => sections.find((s) => n >= s.slide_from && n <= s.slide_to)?.idx ?? 0;
  const pick = (value: string) => {
    if (finished || active === null) return;
    const next = { ...answers, [active]: value };
    setAnswers(next);
    setCol(cols.find((c) => c !== active && next[c] === undefined) ?? null);
  };
  const check = () => {
    const wrong = wrongCells(t, row, answers);
    const entry: Done = { answers, wrong, saved: wrong.length ? "pending" : "no" };
    const at = row;
    setDone((d) => [...d.slice(0, at), entry]);
    if (!wrong.length) return;
    // Each wrong cell is a private card, once.
    void Promise.all(wrong.map((c) => addTableCard({ lectureId, part: partOf(t.slide), slide: t.slide, ...cardOf(t, at, c, answers[c]) })))
      .then(() => setDone((d) => d.map((x, i) => (i === at ? { ...x, saved: "yes" } : x))))
      .catch((e: unknown) => {
        setDone((d) => d.map((x, i) => (i === at ? { ...x, saved: "failed" } : x)));
        ctx.say(failText(e instanceof Error ? e.message : "", "cards"));
      });
  };
  const again = () => {
    setDone([]);
    setRun((n) => n + 1);
  };

  const last = done.length ? done.length - 1 : null;
  const result = last === null ? null : done[last];
  const rightRows = done.filter((d) => !d.wrong.length).length;
  // The end counts only the cells whose cards are saved (review UI-1).
  const wrongTotal = done.reduce((n, d) => n + (d.saved === "yes" ? d.wrong.length : 0), 0);
  const tables = lectureBlankTables(lecture.slides);
  const nextTable = tables[tables.findIndex((x) => x.slide === t.slide) + 1] ?? null;
  const cell = (r: number, c: number) => {
    const value = t.rows[r][c];
    if (!t.fill[c])
      return (
        <td key={c}>
          <bdi dir="auto">{value}</bdi>
        </td>
      );
    const d = done[r];
    if (d) {
      const said = d.answers[c];
      return (
        <td key={c} className={d.wrong.includes(c) ? "blank-cell wrong" : "blank-cell"}>
          {d.wrong.includes(c) ? (
            <>
              <s className="blank-said">
                <bdi dir="auto">{said === undefined ? "?" : said}</bdi>
              </s>{" "}
              <bdi dir="auto">{value}</bdi>
            </>
          ) : (
            <bdi dir="auto">{value}</bdi>
          )}
        </td>
      );
    }
    if (r !== row) return <td key={c} className="a-muted blank-dot">·</td>;
    const said = answers[c];
    return (
      <td key={c} className="blank-cell now">
        <button
          type="button"
          className={`a-chip${c === active ? " busy" : ""} blank-slot`}
          aria-label={`${t.header[c]}: ${said ?? "ריק"}`}
          aria-pressed={c === active}
          onClick={() => setCol(c)}
        >
          <bdi dir="auto">{said === undefined ? "?" : said}</bdi>
        </button>
      </td>
    );
  };

  return (
    <main className="blank-table">
      <Head
        back={back}
        title={
          <>
            טבלה ריקה · <bdi dir="auto">{tableName(t)}</bdi>
          </>
        }
      >
        <span className="a-chip busy blank-count" aria-label={`נבדקו ${done.length} מתוך ${t.rows.length} שורות`}>
          <bdi dir="ltr">
            {done.length}/{t.rows.length}
          </bdi>
        </span>
      </Head>
      <p className="ph-sub">הטבלה משקף {t.slide}, מהזיכרון · שורה אחר שורה</p>
      <div className="a-card flat blank-card">
        <table className="a-table blank-grid">
          <thead>
            <tr>
              {t.header.map((h, c) => (
                <th key={c} scope="col">
                  {h === EMPTY ? "" : <bdi dir="auto">{h}</bdi>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i} className={i === row ? "blank-now" : undefined} aria-current={i === row ? "true" : undefined}>
                {r.map((_, c) =>
                  c === 0 ? (
                    <th key={c} scope="row">
                      <bdi dir="auto">{r[0]}</bdi>
                    </th>
                  ) : (
                    cell(i, c)
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {active !== null ? (
        <div className="a-stack blank-chips" role="group" aria-label={`הערכים של ${t.header[active]}`}>
          <p className="a-small a-muted">
            <bdi dir="auto">{t.header[active]}</bdi>
          </p>
          <div className="a-row">
            {t.chips[active].map((v) => (
              <button key={v} type="button" className="a-btn" aria-pressed={answers[active] === v} onClick={() => pick(v)}>
                <bdi dir="auto">{v}</bdi>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {result ? (
        <div className="a-card flat blank-result" role="status">
          {result.wrong.length ? (
            <>
              <div className="a-row between">
                <span className="a-chip bad">✗ טעות בשורה {(last ?? 0) + 1}</span>
                <span className="a-row">
                  <span className="a-small a-muted">
                    {savedLabel(result.saved, result.wrong.length)}
                  </span>
                  <span className="a-chip">רק לך</span>
                </span>
              </div>
              <p className="a-small blank-line" dir="rtl">
                בשקף:{" "}
                {wrongParts(t, last ?? 0, result.wrong).map((w, i) => (
                  <span key={i}>
                    {i ? "; " : ""}
                    <bdi dir="auto">{w.row}</bdi> · <bdi dir="auto">{w.col}</bdi>: ׳<bdi dir="auto">{w.value}</bdi>׳
                  </span>
                ))}
                .{" "}
                <span className="a-tag src-tag">
                  ש׳ <bdi dir="ltr">{t.slide}</bdi>
                </span>
              </p>
            </>
          ) : (
            <div className="a-row between">
              <span className="a-chip ok">✓ שורה {(last ?? 0) + 1} נכונה</span>
              <span className="a-small a-muted">כמו בשקף</span>
            </div>
          )}
        </div>
      ) : null}
      {finished ? (
        <section className="a-card blank-end" aria-labelledby="blank-end-h">
          <h2 id="blank-end-h" className="a-h2">
            הטבלה מלאה
          </h2>
          <p className="a-small">
            {rightRows} מתוך {t.rows.length} שורות בלי טעות
            {wrongTotal ? ` · ${wrongTotal === 1 ? "תא אחד נכנס" : `${wrongTotal} תאים נכנסו`} לכרטיסיות, רק לך` : ""}
          </p>
          <div className="a-row">
            <button type="button" className="a-btn" onClick={again}>
              עוד פעם
            </button>
            {nextTable ? (
              <RouteLink to={{ v: "practice", l: lectureId, s: blankKey(lectureId, nextTable.slide) }} go={ctx.go} className="a-btn">
                לטבלה הבאה
              </RouteLink>
            ) : null}
          </div>
        </section>
      ) : null}
      <StickyActions>
        {finished ? (
          <RouteLink to={{ v: "practice", l: lectureId }} go={ctx.go} className="a-btn primary wide">
            חזרה לתרגול
          </RouteLink>
        ) : (
          <button type="button" className="a-btn primary wide" disabled={cols.some((c) => answers[c] === undefined)} onClick={check}>
            לבדוק את השורה
          </button>
        )}
      </StickyActions>
    </main>
  );
}
