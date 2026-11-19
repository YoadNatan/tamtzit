import { useEffect, useState } from "react";
import { needsMeLines, type NeedsMeMeter, type NeedsMeRow } from "../../../shared/study/today";
import { whyLine } from "../../../shared/study/today";
import type { Ctx } from "../features/types";
import { failText } from "../lib/failText";
import { isolateLatin } from "../lib/rich";
import { sb } from "../lib/api";
import { RouteLink } from "./Shell";

/* ── T-2: "הקבוצה צריכה אותך" (package T; spec §12.4.T's D11; today.html's
 *    group card; Yoad's decision 3 of 17 Nov 2026) ──
 *
 * On Today, after "בקבוצה", for a member who opted in: an open question of
 * another member in a topic she mastered, with why (hers alone), and a
 * correction that waits for a second approval. When nothing waits for her,
 * her own meter instead of an empty block: the topics she can help in and
 * how many more right answers the nearest one needs. Off by default; the
 * setting is on "שלי" → הגדרות. Nobody learns who opted in, who was chosen
 * or why. Loaded lazily by features/today.tsx. */

function client() {
  if (!sb) throw new Error("not-configured");
  return sb;
}
const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");

async function meterOf(groupId: string): Promise<NeedsMeMeter> {
  const { data, error } = await client().rpc("study_needs_me_meter", { p_group: groupId });
  if (error) throw new Error(error.message);
  const m = (data ?? {}) as NeedsMeMeter;
  return { on: m.on === true, topics: Number(m.topics ?? 0), next: m.next ?? null, open: Number(m.open ?? 0) };
}

export function NeedsMeBody({ ctx, rows }: { ctx: Ctx; rows: NeedsMeRow[] }) {
  const [meter, setMeter] = useState<NeedsMeMeter | null>(null);
  useEffect(() => {
    if (rows.length) return;
    let alive = true;
    meterOf(ctx.group.id)
      .then((m) => alive && setMeter(m))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, rows.length]);
  if (!rows.length && !meter?.on) return null;
  const lines = !rows.length && meter ? needsMeLines(meter) : null;
  return (
    <section className="a-card flat t-needs" aria-label="הקבוצה צריכה אותך">
      <div className="a-row between">
        <b>הקבוצה צריכה אותך</b>
        <span className="a-chip">רק לך</span>
      </div>
      {rows.map((r) =>
        r.kind === "question" ? (
          <div key={r.comment_id} className="t-needs-row">
            <div className="a-row between">
              <span className="a-small">
                <b>שאלה פתוחה</b> · <bdi>{r.lecture_title}</bdi>
              </span>
              <RouteLink to={{ v: "lecture", l: r.lecture_id, at: { part: r.part, anchor: r.anchor } }} go={ctx.go} className="a-btn small">
                לענות
              </RouteLink>
            </div>
            <p className="a-small" dir="rtl">
              {isolateLatin(r.body, `nq${r.comment_id}`)}
            </p>
            <p className="a-small a-muted" dir="rtl">
              {isolateLatin(whyLine(r), `nw${r.comment_id}`)}
            </p>
          </div>
        ) : (
          <div key={r.proposal_id} className="t-needs-row">
            <div className="a-row between">
              <span className="a-small">
                <b>תיקון מחכה לאישור שני</b> · {r.by || "ללא שם"}
              </span>
              <RouteLink to={{ v: "lecture", l: r.lecture_id, at: { part: r.part, anchor: r.anchor } }} go={ctx.go} className="a-btn small">
                לבדוק
              </RouteLink>
            </div>
            <p className="a-small a-muted" dir="rtl">
              <bdi>{r.lecture_title}</bdi>
              {r.note ? <> · {isolateLatin(r.note, `nn${r.proposal_id}`)}</> : null}
            </p>
          </div>
        ),
      )}
      {lines ? (
        <div className="t-needs-row t-needs-meter">
          <p className="a-small">
            <b>{lines.head}</b>
          </p>
          <p className="a-small a-muted" dir="rtl">
            {isolateLatin(lines.line, "nm")}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** "הקבוצה צריכה אותך" on or off (שלי → הגדרות): off by default. */
export function NeedsMeToggle({ ctx }: { ctx: Ctx }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    meterOf(ctx.group.id)
      .then((m) => alive && setOn(m.on))
      .catch(() => alive && setOn(false));
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  const change = async (next: boolean) => {
    setBusy(true);
    setOn(next); // at once; back if the database refuses
    try {
      const { error } = await client().rpc("study_set_needs_me", { p_group: ctx.group.id, p_on: next });
      if (error) throw new Error(error.message);
      ctx.say(next ? "״הקבוצה צריכה אותך״ פועל. מה שמגיע אליך גלוי רק לך." : "״הקבוצה צריכה אותך״ כבוי.");
    } catch (e) {
      setOn(!next);
      ctx.say(failText(codeOf(e), "group"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="a-li setting-row setting-check t-needs-setting">
      <span className="a-stack">
        <span>הקבוצה צריכה אותך</span>
        <span className="a-small a-muted">שאלה פתוחה בנושא שבו ענית נכון יכולה להגיע אליך, ורק אליך. כבוי עד שמפעילים.</span>
      </span>
      <input type="checkbox" checked={on === true} disabled={on === null} onChange={(e) => !busy && void change(e.target.checked)} />
    </label>
  );
}
