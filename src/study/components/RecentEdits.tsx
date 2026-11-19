import { useEffect, useState } from "react";
import { lectureTitles } from "../lib/api";
import { editGist, isUndo, recentEdits, sourceLine, waitingProposals, watchGroupCorrections, type RecentEdit, type WaitingProposal } from "../lib/collab";
import type { Ctx } from "../features/types";
import { RouteLink } from "./Shell";
import { isolateLatin } from "./SummaryView";
import { timeAgo } from "./Together";

/* ── "תיקונים אחרונים" on "יחד" (review UX-26; decision 5; corrections.html s3's list) ──
 * Proposals that wait for a second member's "לאשר" first (each opens its
 * paragraph, where the "תיקון" tab has the button), then the corrections of
 * the last 7 days with who corrected, who approved and the source. Live: a
 * new proposal or correction anywhere in the group shows without a reload.
 * Renders nothing while there is neither. */

export default function RecentEdits({ ctx }: { ctx: Ctx }) {
  const [edits, setEdits] = useState<RecentEdit[]>([]);
  const [waiting, setWaiting] = useState<WaitingProposal[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    let seq = 0;
    const load = async () => {
      const mine = ++seq;
      const [e, w] = await Promise.all([recentEdits(7), waitingProposals()]);
      if (!alive || mine !== seq) return;
      const ids = [...new Set([...e, ...w].map((x) => x.lecture_id))];
      const t = ids.length ? await lectureTitles(ids) : {};
      if (!alive || mine !== seq) return;
      setEdits(e);
      setWaiting(w);
      setTitles(t);
    };
    void load().catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchGroupCorrections(ctx.group.id, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load().catch(() => undefined), 300);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [ctx.group.id]);

  // Only lectures of this group (RLS shows the member's groups; titles come from them).
  const shownWaiting = waiting.filter((p) => titles[p.lecture_id] !== undefined);
  const undone = new Set(edits.map((e) => e.undo_of).filter(Boolean));
  const shownEdits = edits.filter((e) => titles[e.lecture_id] !== undefined && !isUndo(e) && !undone.has(e.id)).slice(0, 8);
  if (!shownWaiting.length && !shownEdits.length) return null;
  const name = (id: string | null) => (id ? ctx.nameOf(id) : "") || "ללא שם";
  return (
    <section className="k-recent" aria-labelledby="k-recent-h">
      <div className="a-sec">
        <h2 id="k-recent-h">תיקונים אחרונים</h2>
        <span className="a-small a-muted">עם מקור, היסטוריה וביטול</span>
      </div>
      <div className="a-list">
        {shownWaiting.map((p) => (
          <RouteLink key={p.id} to={{ v: "lecture", l: p.lecture_id, at: { part: p.part_idx, anchor: p.anchor } }} go={ctx.go} className="a-li k-recent-row">
            <div>
              <b>{`הצעת תיקון · ${name(p.proposed_by)}`}</b>
              <span className="m" dir="rtl">
                {isolateLatin(editGist(p.before_text, p.after_text), `w${p.id}`)}
              </span>
              <span className="m">
                <bdi>{titles[p.lecture_id]}</bdi> · {timeAgo(p.created_at)}
              </span>
            </div>
            <span className="a-chip warn">ממתין לאישור</span>
          </RouteLink>
        ))}
        {shownEdits.map((e) => (
          <RouteLink key={e.id} to={{ v: "lecture", l: e.lecture_id, at: { part: e.part_idx, anchor: e.anchor } }} go={ctx.go} className="a-li k-recent-row">
            <div>
              <b dir="rtl">{isolateLatin(editGist(e.before_text, e.after_text), `e${e.id}`)}</b>
              <span className="m">
                {[`תיקון: ${name(e.author_id)}`, e.aloud ? "אישור: בקול בפגישה" : `אישור: ${name(e.approved_by)}`, sourceLine(e)].filter(Boolean).join(" · ")}
              </span>
              <span className="m">
                <bdi>{titles[e.lecture_id]}</bdi> · {timeAgo(e.created_at)}
              </span>
            </div>
          </RouteLink>
        ))}
      </div>
    </section>
  );
}
