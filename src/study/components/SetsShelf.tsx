import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScreenProps } from "../features/types";
import { hideSet, shelf, shelfGroups, watchSets, type ShelfRow } from "../lib/sets";
import { SETS, shelfHidden } from "../lib/setsCopy";
import "../styles/sets.css";
import SetCard from "./SetCard";
import { BackLink, Head, Loading, OFFLINE_LINE, RouteLink, useOnline } from "./Shell";

/* ── "סטים של הקבוצה" (practice sets, design §5.8; VITE_STUDY_SETS) ──
 * ?v=sets (and ?v=sets&l=<lecture>: the sets on a lecture). Every set is
 * here from the moment it is created (OD3): first the ones the member has not
 * opened ("חדשים"), then by lecture, the lecture with the latest activity
 * first; sets the member hid for themselves fold at the end ("הוסתרו",
 * each with "להחזיר"). One filter, "שלי", only once the group has more than
 * 20 sets. Follows the group's sets live. Offline, what is loaded stays. */

const FILTER_FROM = 20;

export default function SetsShelf({ route, ctx }: ScreenProps<"sets">) {
  const groupId = ctx.group.id;
  const [rows, setRows] = useState<ShelfRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const online = useOnline();

  const load = useCallback(
    () =>
      shelf(groupId, route.l, 200)
        .then((r) => {
          setRows(r);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [groupId, route.l],
  );
  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchSets({ groupId }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 500);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [groupId, load]);

  const shown = useMemo(() => (rows && onlyMine ? rows.filter((r) => r.is_mine) : (rows ?? [])), [rows, onlyMine]);
  const g = useMemo(() => shelfGroups(shown), [shown]);
  const head = <Head back={<BackLink go={ctx.go} fallback={route.l ? { v: "practice", l: route.l } : { v: "practice" }} />} title={SETS.shelf.title} />;

  if (!rows) {
    if (!failed) return <Loading />;
    return (
      <main className="qs-shelf">
        {head}
        <p className="a-error">{SETS.make.loadFail}</p>
        <button type="button" className="a-btn" onClick={() => void load()}>
          {SETS.make.retry}
        </button>
      </main>
    );
  }
  const unhide = (id: string) => {
    void hideSet(id, false)
      .then(load)
      .catch(() => ctx.say(SETS.make.loadFail));
  };
  const card = (r: ShelfRow, inLecture = false) => (
    <li key={r.id}>
      <SetCard row={r} go={ctx.go} userId={ctx.userId} inLecture={inLecture} />
    </li>
  );
  return (
    <main className="qs-shelf">
      {head}
      {!online || failed ? (
        <p className="a-small a-muted qs-offline" role="status">
          {OFFLINE_LINE}
        </p>
      ) : null}
      {rows.length > FILTER_FROM ? (
        <div className="a-row qs-filter">
          <button type="button" className="a-chip" aria-pressed={onlyMine} onClick={() => setOnlyMine((x) => !x)}>
            {SETS.shelf.mine}
          </button>
        </div>
      ) : null}
      {!shown.length ? (
        <p className="a-muted qs-empty">
          {SETS.shelf.empty} ·{" "}
          <RouteLink to={route.l ? { v: "practice", l: route.l, x: "new" } : { v: "practice", x: "new" }} go={ctx.go} className="a-link">
            {SETS.entry} ‹
          </RouteLink>
        </p>
      ) : null}
      {g.fresh.length ? (
        <section className="qs-group" aria-labelledby="qs-new-h">
          <div className="a-sec">
            <h2 id="qs-new-h">{SETS.shelf.newHead}</h2>
          </div>
          <ul className="qs-grid">{g.fresh.map((r) => card(r))}</ul>
        </section>
      ) : null}
      {g.lectures.map((l, i) => (
        <section key={l.lecture_id ?? `none-${i}`} className="qs-group" aria-labelledby={`qs-l-${i}`}>
          <div className="a-sec">
            <h2 id={`qs-l-${i}`} dir="auto">
              {[l.course, l.title].filter(Boolean).join(" · ")}
            </h2>
          </div>
          <ul className="qs-grid">{l.rows.map((r) => card(r, true))}</ul>
        </section>
      ))}
      {g.hidden.length ? (
        <details className="qs-hidden">
          <summary>{shelfHidden(g.hidden.length)}</summary>
          <ul className="qs-grid">
            {g.hidden.map((r) => (
              <li key={r.id} className="qs-hidden-row">
                <SetCard row={r} go={ctx.go} userId={ctx.userId} compact />
                <button type="button" className="a-btn small ghost" onClick={() => unhide(r.id)}>
                  {SETS.set.menu.unhide}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}
