import { useEffect, useState } from "react";
import { failText } from "../lib/failText";
import { richText } from "../lib/rich";
import { deleteAid, flagAid, kindChip, markLine, photoUrl, pinAid, setComposerSeed, vote, type Aid } from "../lib/wall";
import type { Ctx } from "../features/types";
import { Icon } from "./Icon";
import { Avatar } from "./Shell";

/* ── One entry of the wall (package J; wall.html s1, fun design §5.5) ──
 *
 * The chips "מנצחת השבוע" and "בגב הכרטיס של כולם", the body with its slide
 * tags, "על מה זה: …", the photo or the slide's picture, the author (avatar
 * and name, or "בלי שם"), the kind's chip, "קרדיט: …", and the two votes as
 * toggle buttons (aria-pressed; none on one's own). A menu: "שלי" (or
 * "להוריד מ׳שלי׳"), "רמיקס", "לא מדויק", "לא מתאים", and for one's own
 * "עריכה" · "מחיקה". A mark shows its line (W-6). */

export type EntryProps = {
  ctx: Ctx;
  aid: Aid;
  /** A picture of the lecture's slide by its "fig:n-k" key (a moment's), or undefined. */
  figureUrl?: (figure: string) => string | undefined;
  /** After any change: reload the wall. */
  onChange: () => void;
  /** Show the lecture's title (the drug's wall, the group's). */
  showLecture?: boolean;
};

export default function WallEntry({ ctx, aid, figureUrl, onChange, showLecture }: EntryProps) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [mine, setMine] = useState({ funny: aid.my_funny, stuck: aid.my_stuck, fn: aid.funny_n, sn: aid.stuck_n });
  useEffect(() => setMine({ funny: aid.my_funny, stuck: aid.my_stuck, fn: aid.funny_n, sn: aid.stuck_n }), [aid.my_funny, aid.my_stuck, aid.funny_n, aid.stuck_n]);
  useEffect(() => {
    if (!aid.photo) return;
    let alive = true;
    photoUrl(aid.photo)
      .then((u) => alive && setPhoto(u))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [aid.photo]);

  const act = async (run: () => Promise<unknown>, said?: string) => {
    setBusy(true);
    setError("");
    setMenu(false);
    try {
      await run();
      if (said) ctx.say(said);
      onChange();
    } catch (e) {
      setError(failText(e instanceof Error ? e.message : "", "wall"));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (kind: "funny" | "stuck") =>
    act(async () => {
      const on = !(kind === "funny" ? mine.funny : mine.stuck);
      const r = await vote(aid.id, kind, on);
      setMine((m) => ({ ...m, [kind]: on, fn: r.funny, sn: r.stuck }));
    });
  const compose = (mode: "remix" | "edit") => {
    setComposerSeed({
      lectureId: aid.lecture_id,
      part: aid.part_idx,
      anchor: aid.anchor,
      mode,
      body: aid.body,
      fact: aid.fact,
      slides: aid.slides,
      remixOf: mode === "remix" ? aid.id : null,
      editId: mode === "edit" ? aid.id : undefined,
    });
    ctx.go({ v: "wall", l: aid.lecture_id, at: { part: aid.part_idx, anchor: aid.anchor }, x: "post" });
  };

  const chip = kindChip(aid);
  const mark = markLine(aid);
  const pic = aid.figure && figureUrl ? figureUrl(aid.figure) : undefined;
  return (
    <article className={`a-card wall-entry${aid.week ? " week" : ""}${aid.flag ? " marked" : ""}`} data-aid={aid.id} aria-label={aid.week ? "מנצחת השבוע" : undefined}>
      {aid.week || aid.on_cards ? (
        <div className="a-row between">
          {aid.week ? (
            <span className="a-chip fun">
              <Icon name="award" size={12} /> מנצחת השבוע
            </span>
          ) : (
            <span />
          )}
          {aid.on_cards ? (
            <span className="a-chip busy on-cards">
              <Icon name="cards" size={12} /> בגב הכרטיס של כולם
            </span>
          ) : null}
        </div>
      ) : null}
      {showLecture ? <p className="a-small a-muted">{richText(aid.lecture_title, `lt${aid.id}`)}</p> : null}
      <p className="a-para wall-body" dir="rtl">
        {richText(aid.body, `b${aid.id}`)}
      </p>
      {photo ? <img className="wall-photo" src={photo} alt={`צילום: ${aid.body}`} /> : null}
      {pic ? <img className="wall-photo" src={pic} alt={`מהשקף: ${aid.body}`} /> : null}
      <p className="a-small wall-fact" dir="rtl">
        <b>על מה זה:</b> {richText(aid.fact, `f${aid.id}`)}
      </p>
      {mark ? (
        <p className="a-small wall-mark" role="note">
          {richText(mark, `m${aid.id}`)}
        </p>
      ) : null}
      <div className="a-row between wall-foot">
        <span className="a-row wall-who">
          {aid.author ? (
            <>
              <Avatar id={aid.author} name={aid.author} />
              <b>{aid.author}</b>
            </>
          ) : (
            <span className="a-small a-muted">בלי שם</span>
          )}
          {chip ? <span className={`a-chip${aid.kind === "remix" || aid.kind === "draft" ? " busy" : ""}`}>{richText(chip, `k${aid.id}`)}</span> : null}
          {aid.credit ? <span className="a-small">קרדיט: {aid.credit}</span> : null}
        </span>
        <span className="a-row wall-votes">
          {aid.mine ? (
            <span className="a-small a-muted">{`מצחיק ${mine.fn} · נתקע לי ${mine.sn}`}</span>
          ) : (
            <>
              <button type="button" className={`a-up wall-vote${mine.funny ? " on" : ""}`} aria-pressed={mine.funny} disabled={busy} onClick={() => void toggle("funny")}>
                מצחיק {mine.fn}
              </button>
              <button type="button" className={`a-up wall-vote${mine.stuck ? " on" : ""}`} aria-pressed={mine.stuck} disabled={busy} onClick={() => void toggle("stuck")}>
                נתקע לי {mine.sn}
              </button>
            </>
          )}
          <span className="wall-menu">
            <button type="button" className="a-btn ghost icon" aria-label="עוד פעולות" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              ⋯
            </button>
            {menu ? (
              <ul>
                <li>
                  <button onClick={() => void act(() => pinAid(aid.id, !aid.pinned), aid.pinned ? "הורד מ׳שלי׳." : "ננעץ ב׳שלי׳: רק אצלך, בכרטיס ובחזרה.")}>
                    {aid.pinned ? "להוריד מ׳שלי׳" : "שלי"}
                  </button>
                </li>
                <li>
                  <button onClick={() => compose("remix")}>רמיקס</button>
                </li>
                {aid.flag !== "inaccurate" ? (
                  <li>
                    <button onClick={() => void act(() => flagAid(aid.id, "inaccurate"))}>לא מדויק</button>
                  </li>
                ) : aid.flagged_by ? (
                  <li>
                    <button onClick={() => void act(() => flagAid(aid.id, null))}>להסיר את הסימון</button>
                  </li>
                ) : null}
                {aid.flag !== "not_ok" ? (
                  <li>
                    <button onClick={() => void act(() => flagAid(aid.id, "not_ok"), "הוסתר מהקיר.")}>לא מתאים</button>
                  </li>
                ) : null}
                {aid.mine ? (
                  <>
                    <li>
                      <button onClick={() => compose("edit")}>עריכה</button>
                    </li>
                    <li>
                      <button className="danger-text" onClick={() => (setMenu(false), setConfirmDelete(true))}>
                        מחיקה
                      </button>
                    </li>
                  </>
                ) : null}
              </ul>
            ) : null}
          </span>
        </span>
      </div>
      {confirmDelete ? (
        <div className="a-callout warn confirm" role="alertdialog" aria-label="מחיקה">
          <span>למחוק את האסוציאציה מהקיר?</span>
          <div className="a-row">
            <button className="a-btn danger small" disabled={busy} onClick={() => void act(() => deleteAid(aid.id), "נמחקה.")}>
              מחיקה
            </button>
            <button className="a-btn ghost small" onClick={() => setConfirmDelete(false)}>
              ביטול
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
