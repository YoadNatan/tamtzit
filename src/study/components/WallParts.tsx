import "../styles/wall.css";
import { useCallback, useEffect, useState } from "react";
import { failText } from "../lib/failText";
import { richText } from "../lib/rich";
import {
  answerCredit,
  backLine,
  creditRequests,
  getForCards,
  getHint,
  getWall,
  getWeek,
  setComposerSeed,
  watchWall,
  type Aid,
  type CardAid,
  type CreditRequest,
  type Hint,
} from "../lib/wall";
import { useNeededCards } from "../features/pulse";
import type { Ctx, LectureCtx, Spot } from "../features/types";
import { Icon } from "./Icon";
import { Avatar, RouteLink } from "./Shell";
import WallEntry from "./WallEntry";

/* ── J's pieces on other packages' screens (spec §12.5.J; fun design §5.5) ──
 * Loaded lazily by features/wall.tsx, only with VITE_STUDY_WALL:
 *  - WeekCard on "יחד" (W-21, W-22): "אסוציאציית השבוע" with the week's
 *    winner, and the credit requests addressed to the member;
 *  - ParagraphWallTab, the paragraph sheet's "אסוציאציה" (K's frame);
 *  - HintCard, C's review after two own lapses (cards.html s2, W-23);
 *  - BackLine, the card's back (W-24). */

/** "אסוציאציית השבוע" and the credit requests waiting for the member. */
export function WeekCard({ ctx }: { ctx: Ctx }) {
  const [week, setWeek] = useState<Aid | null>(null);
  const [asks, setAsks] = useState<CreditRequest[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [id, reqs] = await Promise.all([getWeek(ctx.group.id), creditRequests(ctx.group.id)]);
      setAsks(reqs);
      if (!id) return setWeek(null);
      const rows = await getWall(ctx.group.id);
      setWeek(rows.find((r) => r.id === id) ?? null);
    } catch {
      /* "יחד" stays as it is */
    }
  }, [ctx.group.id]);
  useEffect(() => void load(), [load]);
  const answer = async (id: string, ok: boolean) => {
    setError("");
    try {
      await answerCredit(id, ok);
      ctx.say(ok ? "השם שלך מופיע עכשיו על האסוציאציה." : "בסדר, בלי השם.");
      await load();
    } catch (e) {
      setError(failText(e instanceof Error ? e.message : "", "wall"));
    }
  };
  if (!week && !asks.length) return null;
  return (
    <section className="a-card wall-week a-stack" aria-label="אסוציאציית השבוע">
      {week ? (
        <>
          <div className="a-row between">
            <span className="a-chip fun">
              <Icon name="award" size={12} /> אסוציאציית השבוע
            </span>
            <RouteLink to={{ v: "wall", l: week.lecture_id }} go={ctx.go} className="a-btn small">
              לקיר
            </RouteLink>
          </div>
          <p className="a-para" dir="rtl">
            {richText(week.body, "wk")}
          </p>
          <p className="a-small a-muted">
            {week.author ? `${week.author} · ` : "בלי שם · "}
            ביום חמישי מקריאים אותה בפגישה.
          </p>
        </>
      ) : null}
      {asks.map((r) => (
        <div key={r.aid_id} className="a-card flat wall-credit-ask a-stack">
          <p className="a-small" dir="rtl">
            <b>בקשת קרדיט:</b> ׳{richText(r.body, `c${r.aid_id}`)}׳
          </p>
          <p className="a-small a-muted">{r.asked_by ? `מאת ${r.asked_by}` : "בלי שם"}</p>
          <div className="a-row">
            <button className="a-btn small" onClick={() => void answer(r.aid_id, true)}>
              לאשר
            </button>
            <button className="a-btn ghost small" onClick={() => void answer(r.aid_id, false)}>
              לא, תודה
            </button>
          </div>
        </div>
      ))}
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The paragraph sheet's "אסוציאציה" tab: its entries (the winner first and
 *  marked), "תנו לי 3 מצחיקות" · "משלי" · "צילום של שרבוט", "לקיר של ההרצאה". */
export function ParagraphWallTab({ lc, spot }: { lc: LectureCtx; spot: Spot }) {
  const ctx = lc.ctx;
  const lecture = lc.lecture.id;
  const [rows, setRows] = useState<Aid[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getWall(ctx.group.id, { lecture })
      .then((r) => setRows(r.filter((a) => a.part_idx === spot.part && a.anchor === spot.anchor)))
      .catch((e) => setError(failText(e instanceof Error ? e.message : "", "wall")));
  }, [ctx.group.id, lecture, spot.part, spot.anchor]);
  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchWall(lecture, () => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [load, lecture]);
  const at = { part: spot.part, anchor: spot.anchor };
  const compose = (mode: "line" | "sketch") => {
    setComposerSeed({ lectureId: lecture, part: spot.part, anchor: spot.anchor, mode });
    ctx.go({ v: "wall", l: lecture, at, x: "post" });
  };
  const figureOf = (fig: string) => {
    const m = /^fig:(\d+)-(\d+)$/.exec(fig);
    const path = m && lc.lecture.slides.find((s) => s.n === Number(m[1]))?.figures?.find((f) => f.k === Number(m[2]))?.path;
    return path ? lc.figureUrl(path) : undefined;
  };
  const sorted = (rows ?? []).slice().sort((a, b) => Number(b.on_cards) - Number(a.on_cards) || b.funny_n + b.stuck_n - (a.funny_n + a.stuck_n));
  // U's "דרושה אסוציאציה": a card on this paragraph that at least 3 members keep forgetting.
  const needed = useNeededCards(ctx.group.id, lecture).find((n) => n.part_idx === spot.part && n.anchor === spot.anchor);
  return (
    <div className="a-stack wall-tab-panel">
      {needed ? (
        <aside className="a-callout warn wall-needed">
          <span>
            <b>דרושה אסוציאציה.</b> כמה מכם שוכחים את זה: {richText(needed.front, `pn${spot.part}.${spot.anchor}`)}
          </span>
        </aside>
      ) : null}
      {rows === null && !error ? <p className="a-muted loading">טוען…</p> : null}
      {rows && !rows.length ? <p className="a-small a-muted">עוד אין אסוציאציה לפסקה הזו. אפשר להתחיל משלוש טיוטות, או לכתוב אחת משלך.</p> : null}
      {sorted.map((a) => (
        <WallEntry key={a.id} ctx={ctx} aid={a} figureUrl={figureOf} onChange={load} />
      ))}
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
      <button className="a-btn primary wide" onClick={() => ctx.go({ v: "wall", l: lecture, at, x: "drafts" })}>
        <Icon name="smile" size={14} /> תנו לי 3 מצחיקות
      </button>
      <div className="a-grid2">
        <button className="a-btn" onClick={() => compose("line")}>
          <Icon name="pen" size={12} /> משלי
        </button>
        <button className="a-btn" onClick={() => compose("sketch")}>
          <Icon name="image" size={12} /> צילום של שרבוט
        </button>
      </div>
      <RouteLink to={{ v: "wall", l: lecture }} go={ctx.go} className="a-link wall-to-wall">
        לקיר של ההרצאה
      </RouteLink>
    </div>
  );
}

/** C's review, a card forgotten twice: the hint from the wall (cards.html s2). */
export function HintCard({ cardId }: { cardId: string }) {
  const [hint, setHint] = useState<Hint | null>(null);
  useEffect(() => {
    let alive = true;
    getHint(cardId)
      .then((h) => alive && setHint(h))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [cardId]);
  if (!hint) return null;
  return (
    <div className="a-card flat wall-hint" role="note" aria-label="רמז">
      <div className="a-row between">
        <span className="a-chip fun">{hint.pinned ? "רמז שנעצת · שלי" : "רמז מהקיר"}</span>
        <span className="a-row">
          {hint.author ? (
            <>
              <Avatar id={hint.author} name={hint.author} />
              <span className="a-small">{hint.author}</span>
            </>
          ) : (
            <span className="a-small a-muted">בלי שם</span>
          )}
        </span>
      </div>
      <p className="a-para" dir="rtl">
        {richText(hint.body, `h${hint.aid_id}`)}
      </p>
    </div>
  );
}

const forCards = new Map<string, Promise<CardAid[]>>();

/** The card's back: "בגב: ׳…׳ · {name}" (W-24), the member's pin or the group's winner. */
export function BackLine({ lectureId, cardId }: { lectureId: string; cardId: string }) {
  const [aid, setAid] = useState<CardAid | null>(null);
  useEffect(() => {
    let alive = true;
    if (!forCards.has(lectureId)) forCards.set(lectureId, getForCards(lectureId).catch(() => []));
    void forCards.get(lectureId)!.then((rows) => alive && setAid(rows.find((r) => r.card_id === cardId) ?? null));
    // Fresh for the next review: a vote may change the winner.
    const t = setTimeout(() => forCards.delete(lectureId), 60_000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [lectureId, cardId]);
  if (!aid) return null;
  return (
    <p className="a-small wall-back" dir="rtl">
      <span className="a-chip fun">{aid.pinned ? "שלי" : "מהקיר"}</span> {richText(backLine(aid), `bl${cardId}`)}
    </p>
  );
}
