import "../styles/boss.css";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { BOSS, bossBar, bossMeterLine, groupNeedLine, headsChip, headsNeedLine, NO_HEADS_LINE, PLAYERS_LINE, SUB_LINE, waitingLine, type BossOpen } from "../../../shared/study/boss";
import type { ScreenProps } from "../features/types";
import { listLectures, type LectureRow } from "../lib/api";
import { bossCreate, bossOpen } from "../lib/boss";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { quizErrorText } from "../lib/quiz";
import { isolateLatin } from "../lib/rich";
import { BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";

/* ── קרב הבוס: a new battle (?v=boss, ?v=boss&new=1, ?v=boss&l=; package H,
 * H-1; boss.html, the fun design B1) ──
 *
 * The lectures to fight on (every lecture, or one), the heads a battle on
 * them would have now (2-4 of the pulse's hot topics and the museum's
 * exhibits), decision 3's meter ("3 מתוך 8 נושאים חמים · עוד כ-20 תשובות
 * לנושא הבא"), the seconds a question, and "לפתוח את הקרב": Z's lobby of
 * a quiz in mode "boss" (?v=quiz&q=). With fewer than two heads the screen
 * stays open with the meter and practice beside it, never a dead end. A lost
 * battle's revenge round opens from the next study day. */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");
const SECONDS = [30, 45, 60] as const;

export default function BossScreen({ route, ctx }: ScreenProps<"boss">) {
  const [lectures, setLectures] = useState<LectureRow[] | null>(null);
  const [pick, setPick] = useState<string | null>(route.l ?? null); // null: every lecture
  const [open, setOpen] = useState<BossOpen | null>(null);
  const [seconds, setSeconds] = useState<number>(45);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    listLectures(ctx.group.id)
      .then((l) => alive && setLectures(l))
      .catch(() => alive && setLectures([]));
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  useEffect(() => {
    let alive = true;
    setOpen(null);
    bossOpen(ctx.group.id, pick ? [pick] : undefined)
      .then((o) => alive && setOpen(o))
      .catch((e) => alive && setError(failText(codeOf(e), "boss")));
    return () => {
      alive = false;
    };
  }, [ctx.group.id, pick]);

  const ready = useMemo(() => (lectures ?? []).filter((l) => l.status === "ready"), [lectures]);

  const start = async (revenge?: string) => {
    setBusy(true);
    setError("");
    try {
      const q = await bossCreate({ groupId: ctx.group.id, lectures: pick ? [pick] : ready.map((l) => l.id), seconds, revenge });
      ctx.go({ v: "quiz", q });
    } catch (e) {
      const code = codeOf(e);
      setError(code === "quiz open" ? quizErrorText("quiz open") ?? failText(code, "boss") : failText(code, "boss"));
      setBusy(false);
    }
  };

  const head = (
    <>
      <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title="קרב הבוס">
        {open && open.state === "open" && headsChip(open.heads.length) ? <span className="a-chip fun">{headsChip(open.heads.length)}</span> : null}
      </Head>
      <p className="ph-sub">
        <span>{SUB_LINE}</span>
      </p>
    </>
  );
  if (!open && !error)
    return (
      <main className="boss-screen">
        {head}
        <Loading />
      </main>
    );

  const practice = flags.practice ? (
    <RouteLink to={pick ? { v: "practice", l: pick } : { v: "practice" }} go={ctx.go} className="a-btn small">
      לתרגל
    </RouteLink>
  ) : null;
  const canStart = Boolean(open && open.state === "open" && open.heads.length >= BOSS.MIN_HEADS && !(open.group_need ?? 0));
  const revenge = open?.revenge && open.revenge.heads?.length ? open.revenge : null;

  return (
    <main className="boss-screen">
      {head}
      {open?.state === "off" ? <p className="a-card flat a-muted boss-state">{failText("off", "boss")}</p> : null}
      {open?.state === "out" ? (
        <div className="a-card flat boss-state">
          <p>התשובות שלך לא נספרות בדופק, ולכן גם ראשי הבוס לא מוצגים. אפשר לחזור לספירה ב׳שלי׳.</p>
          <RouteLink to={{ v: "me" }} go={ctx.go} className="a-btn small">
            לשלי
          </RouteLink>
        </div>
      ) : null}
      {open?.state === "waiting" ? (
        <div className="a-card flat boss-state" data-meter="waiting">
          <p>{waitingLine(open.join_days_left ?? 1)}</p>
          {practice}
        </div>
      ) : null}

      {open?.state === "open" ? (
        <>
          <section className="a-stack" aria-labelledby="boss-on-h">
            <div className="a-sec">
              <h2 id="boss-on-h">על מה נלחמים</h2>
            </div>
            <div className="a-wrap boss-lectures" role="radiogroup" aria-label="ההרצאות">
              <button type="button" role="radio" aria-checked={pick === null} className={`a-chip${pick === null ? " fun" : ""}`} onClick={() => setPick(null)}>
                כל ההרצאות
              </button>
              {ready.map((l) => (
                <button key={l.id} type="button" role="radio" aria-checked={pick === l.id} className={`a-chip${pick === l.id ? " fun" : ""}`} onClick={() => setPick(l.id)}>
                  <bdi>{l.title}</bdi>
                </button>
              ))}
            </div>
          </section>

          <section className="a-stack" aria-labelledby="boss-heads-h">
            <div className="a-sec">
              <h2 id="boss-heads-h">הראשים</h2>
              <span className="a-small a-muted">עד {BOSS.MAX_HEADS}, מהדופק ומהמוזיאון</span>
            </div>
            {open.heads.length ? (
              <ul className="a-wrap boss-heads">
                {open.heads.map((h) => (
                  <li key={h} className="a-chip fun">
                    {isolateLatin(h, `h${h}`)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="a-card dashed empty">{NO_HEADS_LINE}</p>
            )}
            <div className="a-card flat boss-meter" data-meter="heads">
              <p className="a-small">
                <b>{(open.group_need ?? 0) > 0 ? groupNeedLine(open.group_need ?? 0) : isolateLatin(bossMeterLine(open), "bm")}</b>
              </p>
              <div className="a-bar group" role="img" aria-label={bossBar(open).label}>
                <i style={{ width: `${bossBar(open).pct}%` } as CSSProperties} />
              </div>
              {headsNeedLine(open.hot) ? (
                <p className="a-small a-muted">
                  {headsNeedLine(open.hot)} {practice ? "תרגול מגלה אותם." : ""}
                </p>
              ) : null}
              {!canStart ? practice : null}
            </div>
          </section>

          {revenge ? (
            <section className="a-card flat boss-revenge" aria-labelledby="boss-rev-h">
              <div className="a-row between">
                <b id="boss-rev-h">סבב נקמה</b>
                <span className={`a-chip ${revenge.open ? "warn" : ""}`.trim()}>{revenge.open ? "פתוח" : "נפתח מחר"}</span>
              </div>
              <p className="a-small">{isolateLatin(`${revenge.name}: ${revenge.heads?.join(" · ") ?? ""}`, "rv")}</p>
              {revenge.open ? (
                <button type="button" className="a-btn" disabled={busy} onClick={() => void start(revenge.battle)}>
                  לסבב הנקמה
                </button>
              ) : null}
            </section>
          ) : null}

          <section className="a-stack" aria-labelledby="boss-secs-h">
            <div className="a-sec">
              <h2 id="boss-secs-h">שניות לשאלה</h2>
            </div>
            <div className="a-wrap" role="radiogroup" aria-label="שניות לשאלה">
              {SECONDS.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={seconds === n} className={`a-chip${seconds === n ? " group" : ""}`} onClick={() => setSeconds(n)}>
                  {n}
                </button>
              ))}
            </div>
            <p className="a-small a-muted">{PLAYERS_LINE}</p>
          </section>
        </>
      ) : null}

      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      {open?.state === "open" ? (
        <StickyActions>
          <button type="button" className="a-btn primary wide" disabled={!canStart || busy} onClick={() => void start()}>
            {busy ? "פותחים…" : "לפתוח את הקרב"}
          </button>
        </StickyActions>
      ) : null}
    </main>
  );
}
