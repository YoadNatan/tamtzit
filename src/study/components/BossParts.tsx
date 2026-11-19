import "../styles/boss.css";
import { useEffect, useState, type CSSProperties } from "react";
import {
  BOSS,
  bossMeterLine,
  bossOf,
  groupNeedLine,
  headsChip,
  headChip,
  headsNeedLine,
  lootDay,
  lootDays,
  lootTitle,
  LOST_LINE,
  momentText,
  relapseLine,
  RULE_LINE,
  studyDayIso,
  trapLine,
  waitingLine,
  type BossOpen,
  type LootRow,
} from "../../../shared/study/boss";
import type { Ctx } from "../features/types";
import { bossLoot, bossLootSave, bossOpen } from "../lib/boss";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import type { QuizState } from "../lib/quiz";
import { isolateLatin } from "../lib/rich";
import { Avatar, BackLink, Head, RouteLink } from "./Shell";

/* ── The boss battle's pieces (package H, H-1; mockup boss.html; the fun
 * design B1-B3): the card on "יחד", the battle's HUD on Z's quiz screen,
 * and the battle's end with the moments and one's private loot. Loaded on
 * their own chunk by features/boss.tsx, so the study entry keeps only their
 * frames. Every number is the database's (section H): hit points from
 * rounds of at least 3 answers, a wrong answer costs the team, never a
 * person, and no moment names anyone. */

/** "קרב הבוס" on "יחד": the heads a battle would have now, the revenge
 *  round, and decision 3's meter; hidden while the switch is off or the
 *  member is out. */
export function BossCardBody({ ctx }: { ctx: Ctx }) {
  const [o, setO] = useState<BossOpen | null>(null);
  useEffect(() => {
    if (!flags.boss) return;
    let alive = true;
    bossOpen(ctx.group.id)
      .then((x) => alive && setO(x))
      .catch(() => undefined); // the card is extra
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  if (!flags.boss || !o || o.state === "off" || o.state === "out") return null;
  const revenge = o.revenge && o.revenge.heads?.length ? o.revenge : null;
  return (
    <section className="a-stack boss-card" aria-labelledby="boss-card-h">
      <div className="a-sec">
        <h2 id="boss-card-h">קרב הבוס</h2>
        {o.state === "open" && headsChip(o.heads.length) ? <span className="a-chip fun">{headsChip(o.heads.length)}</span> : null}
      </div>
      <RouteLink to={{ v: "boss", isNew: true }} go={ctx.go} className="a-li row-link">
        <div className="pulse-card-line">
          {o.state === "waiting" ? (
            <span>{waitingLine(o.join_days_left ?? 1)}</span>
          ) : (o.group_need ?? 0) > 0 ? (
            <span>{groupNeedLine(o.group_need ?? 0)}</span>
          ) : (
            <>
              {o.heads.length ? <b>{isolateLatin(o.heads.join(" · "), "bch")}</b> : null}
              <span className={o.heads.length ? "m" : undefined}>{isolateLatin(bossMeterLine(o), "bcm")}</span>
              {headsNeedLine(o.hot) ? <span className="m">{headsNeedLine(o.hot)}</span> : null}
            </>
          )}
        </div>
      </RouteLink>
      {revenge ? (
        <p className="a-small boss-revenge">
          <b>סבב נקמה:</b> {isolateLatin(revenge.heads?.join(" · ") ?? "", "bcr")} · {revenge.open ? "פתוח עכשיו" : "נפתח מחר"}
        </p>
      ) : null}
    </section>
  );
}

function Hp({ label, hp, tone }: { label: string; hp: number; tone: "ok" | "bad" }) {
  const v = Math.max(0, Math.min(100, hp));
  return (
    <div className="a-meter">
      <div className="a-row between">
        <b className="a-small">{label}</b>
        <b className="a-small">
          {v} <bdi dir="ltr">HP</bdi>
        </b>
      </div>
      <div className="a-bar" role="img" aria-label={`${label}: ${v} HP`}>
        <i style={{ width: `${v}%`, background: tone === "ok" ? "var(--ok)" : "var(--bad)" } as CSSProperties} />
      </div>
    </div>
  );
}

/** The HUD on Z's quiz screen (boss.html s1): both bars, a chip per head
 *  (fallen ✓, the one on screen marked), the relapse and the trap, and
 *  what the last reveal did. */
export function BossHudBody({ state }: { state: unknown }) {
  const b = bossOf(state);
  if (!b) return null;
  const z = (state as QuizState).quiz;
  const cur = b.head != null ? b.heads[b.head] : null;
  const last = z.state === "reveal" ? b.last_round : null;
  return (
    <section className="a-stack boss-hud" aria-label="קרב הבוס">
      <div className="a-row between">
        <span className="a-small a-muted">{isolateLatin(b.name, "bn")}</span>
        <span className="a-chip fun">{headChip(b)}</span>
      </div>
      <div className="a-card flat">
        <div className="a-grid2">
          <Hp label="הקבוצה" hp={b.team_hp} tone="ok" />
          <Hp label="הבוס" hp={b.boss_hp} tone="bad" />
        </div>
      </div>
      <ul className="a-wrap boss-heads" aria-label="הראשים">
        {b.heads.map((h, i) => (
          <li key={`${h.name}${i}`} className={`a-chip${h.down ? " ok" : i === b.head ? " fun" : ""}`} aria-current={i === b.head ? "true" : undefined}>
            {h.down ? "✓ " : ""}
            {isolateLatin(h.name, `bh${i}`)}
          </li>
        ))}
      </ul>
      {cur && b.relapse ? (
        <p className="a-small a-muted">
          {isolateLatin(relapseLine(cur.name), "brl")}
          {cur.slides[0] ? (
            <>
              {" "}
              <span className="a-tag">ש׳ {cur.slides.slice(0, 2).join("-")}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {cur && b.trap && z.state === "question" ? <div className="a-callout warn">{isolateLatin(trapLine(cur.name), "btr")}</div> : null}
      {last ? (
        <p className="a-small boss-last" role="status">
          {last.few ? (
            `פחות מ-${BOSS.PLAYERS} ענו, אז הסבב הזה לא נספר.`
          ) : (
            <>
              {last.dmg ? (
                <>
                  <bdi dir="ltr">−{last.dmg} HP</bdi> לבוס
                </>
              ) : (
                "הבוס לא נפגע"
              )}
              {" · "}
              {last.loss ? (
                <>
                  <bdi dir="ltr">−{last.loss} HP</bdi> לקבוצה
                </>
              ) : (
                "הקבוצה לא נפגעה"
              )}
            </>
          )}
        </p>
      ) : null}
      <p className="a-small a-muted">{RULE_LINE}</p>
    </section>
  );
}

/** The battle's end (boss.html s2): the group's result, the moments without
 *  names, and one's own loot with "לתוכנית שלי". Lost: no defeat screen,
 *  the heads still standing and tomorrow's revenge round. */
export function BossEndBody({ ctx, state }: { ctx: Ctx; state: unknown }) {
  const b = bossOf(state);
  const s = state as QuizState;
  const [loot, setLoot] = useState<LootRow[] | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState("");
  const quizId = s.quiz.id;
  const played = Boolean(s.me);
  useEffect(() => {
    if (!played) return;
    let alive = true;
    bossLoot(quizId)
      .then((r) => alive && setLoot(r))
      .catch(() => alive && setLoot([]));
    return () => {
      alive = false;
    };
  }, [quizId, played]);
  if (!b) return null;
  const won = b.outcome === "won";
  const standing = b.heads.filter((h) => !h.down);
  const today = studyDayIso();
  const days = loot ? lootDays(loot, today) : [];
  const save = async () => {
    setError("");
    try {
      const n = await bossLootSave(quizId);
      setSaved(n);
      ctx.say(n ? "השלל נכנס לתור שלך בימים הקרובים." : "השלל כבר בתור שלך.");
    } catch (e) {
      setError(failText(e instanceof Error ? e.message : "", "boss"));
    }
  };
  const lastMoment = [...b.moments].reverse().find((m) => m.t === "last" || m.t === "fall");
  const lastText = lastMoment ? momentText(lastMoment) : null;
  return (
    <>
      <Head back={<BackLink go={ctx.go} fallback={{ v: "group" }} />} title={isolateLatin(`קרב הבוס · ${b.name}`, "beh")}>
        <span className={`a-chip ${won ? "ok" : "busy"}`}>{won ? "ניצחון" : "סבב נקמה מחר"}</span>
      </Head>
      <section className="a-card boss-result" aria-labelledby="boss-end-h">
        <div className="a-row between">
          <span className="a-stack">
            <span className="a-h1" id="boss-end-h">
              {won ? "הבוס הובס!" : "הקרב נגמר"}
            </span>
            <span className="a-small">
              {won ? (
                <>
                  הקבוצה סיימה עם {b.team_hp} <bdi dir="ltr">HP</bdi> מתוך 100.
                </>
              ) : (
                <>
                  {standing.length === 1 ? "ראש אחד עוד עומד" : `${standing.length} ראשים עוד עומדים`}: {isolateLatin(standing.map((h) => h.name).join(" · "), "bst")}.
                </>
              )}
            </span>
          </span>
          <span className="a-ring" style={{ "--p": `${Math.max(0, Math.min(100, won ? b.team_hp : 100 - b.boss_hp))}%`, minWidth: 54 } as CSSProperties} aria-hidden="true">
            <span>{won ? b.team_hp : 100 - b.boss_hp}</span>
          </span>
        </div>
        {lastText ? <p className="a-para">{isolateLatin(`${lastText.title}. ${lastText.line}`, "blt")}</p> : null}
        {s.players.length ? (
          <div className="a-row boss-players" aria-label="שיחקו">
            {s.players
              .filter((p) => !p.left)
              .slice(0, 8)
              .map((p) => (
                <Avatar key={p.user_id} id={p.user_id} name={p.name || "ללא שם"} />
              ))}
          </div>
        ) : null}
        <span className="a-small">על השתתפות, לא על ציון.</span>
      </section>

      {b.moments.length ? (
        <section className="a-stack" aria-labelledby="boss-moments-h">
          <div className="a-sec">
            <h2 id="boss-moments-h">רגעי הקרב</h2>
            <span className="a-small a-muted">של הקבוצה, בלי שמות</span>
          </div>
          <ul className="a-list">
            {b.moments.map((m, i) => {
              const t = momentText(m);
              if (!t || m.t === "last") return null;
              return (
                <li key={i} className="a-li">
                  <div className="boss-moment">
                    <span className="a-row between">
                      <b>{isolateLatin(t.title, `mt${i}`)}</b>
                      <span className={`a-chip ${t.tone}`}>{/HP|relapse/.test(t.chip) ? <bdi dir="ltr">{t.chip}</bdi> : t.chip}</span>
                    </span>
                    <span className="m">
                      {isolateLatin(t.line, `ml${i}`)}
                      {m.slides && m.slides[0] ? (
                        <>
                          {" "}
                          <span className="a-tag">ש׳ {m.slides.slice(0, 2).join("-")}</span>
                        </>
                      ) : null}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {played ? (
        <section className="a-card flat boss-loot" aria-labelledby="boss-loot-h">
          {loot === null ? (
            <p className="a-small a-muted">טוען את השלל…</p>
          ) : loot.length ? (
            <>
              <div className="a-row between">
                <b id="boss-loot-h">{lootTitle(loot.length, days.length)}</b>
                <span className="a-chip">רק לך</span>
              </div>
              {days.flatMap((d) =>
                d.topics.map((t) => (
                  <div key={`${d.day}${t.topic}`} className="a-row between">
                    <span className="a-small">
                      <b>{lootDay(d.ahead)}</b> · {isolateLatin(t.topic, `lt${d.day}${t.topic}`)}
                      {t.n > 1 ? ` ×${t.n}` : ""}
                    </span>
                    {t.slides[0] ? <span className="a-tag">ש׳ {t.slides.join(",")}</span> : null}
                  </div>
                )),
              )}
              {error ? (
                <p className="a-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button type="button" className="a-btn primary wide" onClick={() => void save()} disabled={saved !== null}>
                {saved !== null ? "בתוכנית שלך ✓" : "לתוכנית שלי"}
              </button>
              {saved !== null && flags.today ? (
                <RouteLink to={{ v: "today" }} go={ctx.go} className="a-btn small">
                  להיום
                </RouteLink>
              ) : null}
            </>
          ) : (
            <>
              <div className="a-row between">
                <b id="boss-loot-h">השלל שלך</b>
                <span className="a-chip">רק לך</span>
              </div>
              <p className="a-small">בלי טעויות שלך בקרב הזה, אז אין שלל.</p>
            </>
          )}
        </section>
      ) : null}
      <p className="a-small a-muted">{won ? LOST_LINE : "סבב הנקמה מחכה ב׳יחד׳ מהיום הלימודי הבא, עם הראשים שנשארו."}</p>
    </>
  );
}
