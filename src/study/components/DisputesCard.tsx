import { useEffect, useState } from "react";
import type { Ctx, UpdateRow } from "../features/types";
import { lectureTitles } from "../lib/api";
import { flags } from "../lib/flags";
import { myUpdates, openDisputes, watchGroupDisputes, type DisputeRow } from "../lib/var";
import { RouteLink } from "./Shell";
import { timeAgo } from "./Together";
import UpdateCard from "./UpdateCard";
import { vText } from "./VerdictCard";
import "../styles/var.css";

/* ── "מחלוקות" on "יחד" (package V; §12.2.3's DisputesCard) ──
 * The group's yellow cards that are open or wait for a decision, newest
 * first, live; each opens its card. Until Today ships (T's queue hands each
 * "עדכון" to UpdateCard), the member's own unseen updates show here first,
 * so a correction that reached her is never lost. Renders nothing while
 * there is neither. */

export default function DisputesCard({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [updates, setUpdates] = useState<UpdateRow[]>([]);

  useEffect(() => {
    let alive = true;
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      const [d, u] = await Promise.all([openDisputes(), flags.today ? Promise.resolve([]) : myUpdates(ctx.group.id).catch(() => [] as UpdateRow[])]);
      const ids = [...new Set(d.map((x) => x.lecture_id))];
      const t = ids.length ? await lectureTitles(ids) : {};
      if (!alive || mine !== seq) return;
      setRows(d);
      setTitles(t);
      setUpdates(u);
    };
    void load().catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchGroupDisputes(ctx.group.id, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load().catch(() => undefined), 300);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [ctx.group.id]);

  // Only this group's lectures (RLS shows the member's groups; titles come from them).
  const shown = rows.filter((d) => titles[d.lecture_id] !== undefined);
  if (!shown.length && !updates.length) return null;
  const name = (id: string | null) => (id ? ctx.nameOf(id) : "") || "ללא שם";
  return (
    <>
      {updates.map((u) => (
        <UpdateCard key={u.id} ctx={ctx} update={u} onDone={() => setUpdates((list) => list.filter((x) => x.id !== u.id))} />
      ))}
      {shown.length ? (
        <section className="v-disputes" aria-labelledby="v-disputes-h">
          <div className="a-sec">
            <h2 id="v-disputes-h">מחלוקות</h2>
            <span className="a-small a-muted">גיבוי בלי שמות</span>
          </div>
          <div className="a-list">
            {shown.map((d) => (
              <RouteLink key={d.id} to={{ v: "dispute", d: d.id }} go={ctx.go} className="a-li v-dispute-row">
                <div>
                  <b dir="rtl">{vText(d.claim_a, `da${d.id}`)}</b>
                  <span className="m">{d.claim_b ? `${name(d.author_a)} מול ${name(d.author_b)}` : `${name(d.author_a)} · מחכים לצד השני`}</span>
                  <span className="m">
                    <bdi>{titles[d.lecture_id]}</bdi> · {timeAgo(d.updated_at)}
                  </span>
                </div>
                <span className="a-chip warn">{d.state === "judged" ? "יש הכרעה" : "פתוחה"}</span>
              </RouteLink>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
