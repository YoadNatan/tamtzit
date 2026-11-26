import { useEffect, useState } from "react";
import type { Ctx } from "../features/types";
import { myNamesPref, setNamesPref, shelf, watchSets, type ShelfRow } from "../lib/sets";
import { SETS } from "../lib/setsCopy";
import "../styles/sets.css";
import SetCard from "./SetCard";
import { RouteLink } from "./Shell";

/* ── Practice sets' entry points that load lazily (design §5.1, WP14) ──
 * Each is a part of this one lazy chunk, behind its screen's own lazy()
 * with its own boundary (a chunk that cannot load costs the part, never the
 * screen), and only with VITE_STUDY_SETS:
 *   HubSets       the practice hub's "סטים של הקבוצה": the 3 newest sets the
 *                 member did not hide, vertical, and "לכל הסטים ‹";
 *   MeNamesRow    "שלי"'s row for OD7's choice, "להציג את השם שלי ברשימת מי
 *                 פתרו" (asked once at the end of the first finished set,
 *                 then only here).
 * Today's rows and the lecture page's row read the shelf through their own
 * modules (TodayScreen, MakeEntry). */

const HUB_SETS = 3;

/** The hub's list (§5.2): nothing when the group has no set yet (the "סט חדש" card is right above). */
export function HubSets({ ctx }: { ctx: Ctx }) {
  const groupId = ctx.group.id;
  const [rows, setRows] = useState<ShelfRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      shelf(groupId, undefined, 12)
        .then((r) => alive && setRows(r.filter((x) => !x.is_hidden).slice(0, HUB_SETS)))
        .catch(() => undefined); // offline: what is shown stays
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchSets({ groupId }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 500);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [groupId]);
  if (!rows?.length) return null;
  return (
    <section className="a-stack qs-hub" aria-labelledby="qs-hub-h">
      <div className="a-sec qs-hub-head">
        <h2 id="qs-hub-h">{SETS.hub.sets}</h2>
        <RouteLink to={{ v: "sets" }} go={ctx.go} className="a-link qs-hub-all">
          {SETS.hub.all} ‹
        </RouteLink>
      </div>
      <ul className="a-stack qs-hub-list">
        {rows.map((r) => (
          <li key={r.id}>
            <SetCard row={r} go={ctx.go} userId={ctx.userId} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "שלי": whether the member's name shows among who solved a set (OD7; never with a score). */
export function MeNamesRow() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    myNamesPref()
      .then((p) => alive && setOn(p?.show_name ?? false))
      .catch(() => alive && setOn(false));
    return () => {
      alive = false;
    };
  }, []);
  if (on === null) return null;
  return (
    <label className="a-li setting-row setting-check qs-me-names">
      <span>
        {SETS.me.names}
        <span className="a-small a-muted qs-me-note">{SETS.me.namesNote}</span>
      </span>
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          setBusy(true);
          setNamesPref(next)
            .catch(() => setOn(!next))
            .finally(() => setBusy(false));
        }}
      />
    </label>
  );
}
