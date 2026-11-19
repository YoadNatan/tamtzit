import { useCallback, useEffect, useState } from "react";
import { tidy } from "../../../shared/study/blocks";
import { blockSources, citedSlides } from "../../../shared/study/edits";
import type { ScreenProps } from "../features/types";
import { getLecture, getSections, groupSpent, health } from "../lib/api";
import { failText } from "../lib/failText";
import { barLabel } from "../lib/rich";
import {
  askVar,
  backingView,
  backSide,
  closeDispute,
  decide,
  disputeRow,
  disputeState,
  share,
  watchDispute,
  writeClaim,
  type DisputeRow,
  type DisputeState,
  type Side,
} from "../lib/var";
import { Avatar, BackLink, backTarget, Head, Loading, StickyActions } from "./Shell";
import VerdictCard, { AfterAccept, SlideTagOf, vText } from "./VerdictCard";
import "../styles/var.css";

/* ── One yellow card (?v=dispute&d=; package V; corrections.html s2) ──
 *
 * "מחלוקת · {part}": each side's line with its slides and its name;
 * "מחכים לצד השני" until another member writes side b ("לכתוב את הצד
 * השני"); "עם מי הצדק? גיבוי בלי שמות": the others back a side, and while
 * backing is open only the total shows ("{n} גיבו · הגיבוי יוצג אחרי ה-VAR,
 * מ-3"); "VAR" with its cost and the group's spend; "בודקים מול השקפים…";
 * the verdict ("הכרעה מול השקפים"); then "לקבל" (the box is pinned and the trap
 * card joins everyone's deck) or "בהרצאה נאמר אחרת" with a line. Once VAR
 * is asked, backing closes and the bars show from three others (review
 * SEC-10). Live: the card's row is published (never the backing). */

type Loaded = { state: DisputeState; row: DisputeRow | null; partTitle: string; paragraph: string; slides: number[]; lectureTitle: string };

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");
function words(e: unknown): string {
  const c = codeOf(e);
  if (!c || c === "Failed to fetch" || c === "TypeError") return "לא נשמר. כדאי לבדוק את החיבור ולנסות שוב.";
  return failText(c, "dispute");
}

/** Where a card stands, for a refusal's lifetime. */
const phaseOf = (s: Pick<DisputeState, "state" | "backing_open">) => `${s.state}:${s.backing_open}`;

/** "$12.40", and a cap of "$33" without cents. */
const dollars = (n: number) => "$" + (Number.isInteger(n) ? String(n) : n.toFixed(2));

export default function DisputeScreen({ route, ctx }: ScreenProps<"dispute">) {
  const [data, setData] = useState<Loaded | null>(null);
  // A refusal belongs to the card as it was when it came ("busy", "not
  // open"): once the card moves on (a verdict, a decision), its words go.
  const [failure, setFailure] = useState<{ text: string; phase: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [spend, setSpend] = useState("");

  const load = useCallback(async (): Promise<DisputeState> => {
    const state = await disputeState(route.d);
    const [row, sections, lecture] = await Promise.all([disputeRow(route.d), getSections(state.lecture_id), getLecture(state.lecture_id)]);
    const part = sections.find((s) => s.idx === state.part);
    const block = part?.markdown ? blockSources(tidy(part.markdown))[state.anchor] : undefined;
    const paragraph = block?.text ?? state.quote;
    const have = new Set((lecture?.slides ?? []).map((s) => s.n));
    const slides = [...new Set([...state.a.slides, ...(state.b?.slides ?? []), ...citedSlides(paragraph)])].filter((n) => have.size === 0 || have.has(n)).slice(0, 8);
    setData({ state, row, partTitle: part?.title ?? "", paragraph, slides, lectureTitle: lecture?.title ?? "" });
    return state;
  }, [route.d]);

  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    load()
      .then(() => undefined)
      .catch((e) => alive && setFailure({ text: words(e), phase: "" }));
    void disputeRow(route.d)
      .then((r) => {
        if (alive && r) stop = watchDispute(r, () => void load().catch(() => undefined));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      stop?.();
    };
  }, [route.d, load]);

  useEffect(() => {
    let alive = true;
    Promise.all([groupSpent(ctx.group.id), health()])
      .then(([spent, h]) => alive && setSpend("השימוש של הקבוצה החודש: " + "$" + spent.toFixed(2) + (h?.budgetUsd ? " מתוך " + dollars(h.budgetUsd) : "")))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, data?.state.state]);

  const act = async (name: string, f: () => Promise<unknown>, after?: () => void) => {
    setBusy(name);
    setFailure(null);
    try {
      await f();
      await load();
      after?.();
    } catch (e) {
      const now = await load().catch(() => null);
      setFailure({ text: words(e), phase: now ? phaseOf(now) : "" });
    } finally {
      setBusy("");
    }
  };

  const fallback = data ? { v: "lecture" as const, l: data.state.lecture_id, at: { part: data.state.part, anchor: data.state.anchor } } : { v: "group" as const };
  // Back to the lecture reads "→ לסיכום", as the approved card says.
  const back = <BackLink go={ctx.go} fallback={fallback} label={data && backTarget(fallback).label === "→ להרצאה" ? "→ לסיכום" : undefined} />;
  if (!data)
    return (
      <main className="v-dispute">
        <Head back={back} title="מחלוקת" />
        {failure ? (
          <p className="a-error" role="alert">
            {failure.text}
          </p>
        ) : (
          <Loading />
        )}
      </main>
    );

  const s = data.state;
  const me = ctx.userId;
  const isSide = me === s.a.author_id || (s.b && me === s.b.author_id);
  const judging = Boolean(data.row?.judging_until && new Date(data.row.judging_until).getTime() > Date.now());
  const backing = backingView(s);
  const nameOf = (x: Side | null) => x?.name || "ללא שם";

  return (
    <main className="v-dispute">
      <Head back={back} title={`מחלוקת${data.partTitle ? " · " + data.partTitle : ""}`} />
      <section className="a-card flat a-stack v-claims" aria-label="הטענות">
        <ClaimLine side={s.a} id="a" />
        <div className="a-divider" />
        {s.b ? (
          <ClaimLine side={s.b} id="b" />
        ) : s.state === "open" && me !== s.a.author_id ? (
          <ClaimForm
            slides={data.slides}
            busy={busy === "claim"}
            onSend={(claim, slides) => void act("claim", () => writeClaim(s.id, claim, slides))}
          />
        ) : (
          <p className="a-small a-muted">מחכים לצד השני.</p>
        )}
      </section>

      {s.b ? (
        <section className="a-bars v-backing" aria-label="עם מי הצדק? גיבוי בלי שמות">
          <b className="a-small v-backing-h">עם מי הצדק? גיבוי בלי שמות</b>
          {backing.kind === "bars" ? (
            (["a", "b"] as const).map((k) => {
              const n = k === "a" ? backing.a : backing.b;
              return (
                <div key={k} className="r">
                  <span>{barLabel(nameOf(k === "a" ? s.a : s.b), `bn${k}`)}</span>
                  <div className="a-bar group" role="img" aria-label={`${nameOf(k === "a" ? s.a : s.b)}: ${n}`}>
                    <i style={{ width: `${share(n, backing.a + backing.b)}%` }} />
                  </div>
                  <b>{n}</b>
                </div>
              );
            })
          ) : (
            <p className="a-small a-muted v-backing-line">{backing.line}</p>
          )}
          {s.backing_open && !isSide ? (
            <div className="a-row v-back-row">
              {(["a", "b"] as const).map((k) => (
                <button
                  key={k}
                  className={`a-chip${s.mine === k ? " busy" : ""}`}
                  aria-pressed={s.mine === k}
                  disabled={Boolean(busy)}
                  onClick={() => void act("back", () => backSide(s.id, s.mine === k ? null : k))}
                >
                  {s.mine === k ? `✓ הגיבוי שלך: ${nameOf(k === "a" ? s.a : s.b)}` : `לגבות את ${nameOf(k === "a" ? s.a : s.b)}`}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {s.verdict ? <VerdictCard verdict={s.verdict} id={s.id} /> : null}

      {s.state === "open" && s.b ? (
        <section className="a-card flat a-stack v-var" aria-label="בדיקה מול השקפים">
          {busy === "var" || judging ? (
            <p className="a-small" role="status">
              {busy === "var" ? "בודקים מול השקפים…" : "נבדק עכשיו במכשיר אחר. התוצאה תופיע כאן."}
            </p>
          ) : (
            <>
              <p className="a-small">
                הבדיקה משווה את שתי הטענות לשקפים, בלי השמות, ומפרידה בין מה שכתוב בשקף לבין פרשנות.
                {s.backing_open ? " הגיבוי נסגר כשמבקשים בדיקה." : ""}
              </p>
              <p className="a-small a-muted">
                <span aria-hidden="true">≈</span>
                <span className="sr-only">בערך</span> $0.08{spend ? ` · ${spend}` : ""}
              </p>
            </>
          )}
        </section>
      ) : null}

      {s.state === "judged" && s.verdict ? <AfterAccept verdict={s.verdict} id={s.id} /> : null}
      {s.state === "accepted" && s.verdict ? (
        <>
          <AfterAccept verdict={s.verdict} id={s.id} done />
          <p className="a-small a-muted">{`הכרעה: ${s.decided_by ?? "ללא שם"}`}</p>
        </>
      ) : null}
      {s.state === "overridden" ? (
        <aside className="a-callout warn a-stack v-override-box" aria-label="בהרצאה נאמר אחרת">
          <b>בהרצאה נאמר אחרת</b>
          {s.decision_note ? <p className="a-small">{vText(s.decision_note, `dn${s.id}`)}</p> : null}
          <p className="a-small a-muted">{`הכרעה: ${s.decided_by ?? "ללא שם"}`}</p>
        </aside>
      ) : null}
      {s.state === "closed" ? <p className="a-small a-muted">המחלוקת בוטלה.</p> : null}

      {failure && failure.phase === phaseOf(s) ? (
        <p className="a-error a-small" role="alert">
          {failure.text}
        </p>
      ) : null}

      {s.state === "judged" ? (
        <Decide busy={busy} onDecide={(d, note) => void act("decide", () => decide(s.id, d, note))} />
      ) : (
        <StickyActions>
          {s.state === "open" && s.b && !judging ? (
            <button className="a-btn primary wide" disabled={Boolean(busy)} onClick={() => void act("var", () => askVar(s.id))}>
              {busy === "var" ? "בודקים מול השקפים…" : "לבדוק מול השקפים"}
            </button>
          ) : null}
          {s.state === "open" && me === s.a.author_id ? (
            <button className="a-btn ghost" disabled={Boolean(busy)} onClick={() => void act("close", () => closeDispute(s.id))}>
              לבטל את המחלוקת
            </button>
          ) : null}
          {s.state !== "open" ? (
            <button className="a-btn" onClick={() => ctx.go({ v: "lecture", l: s.lecture_id, at: { part: s.part, anchor: s.anchor } })}>
              לפסקה
            </button>
          ) : null}
        </StickyActions>
      )}
    </main>
  );
}

/** "{שם}: ״…״ [ש׳ 20]" with the side's initial (corrections.html s2). */
function ClaimLine({ side, id }: { side: Side; id: string }) {
  return (
    <div className="a-row v-claim">
      {side.author_id ? <Avatar id={side.author_id} name={side.name || "?"} /> : null}
      <p className="a-para">
        <b>{side.name || "ללא שם"}:</b> ״{vText(side.claim, `c${id}`)}״ <SlideTagOf slides={side.slides} />
      </p>
    </div>
  );
}

/** "לכתוב את הצד השני": one line, 5-240 characters, with 1-4 slides. */
export function ClaimForm({ slides: offered, busy, onSend, label = "לכתוב את הצד השני" }: { slides: number[]; busy: boolean; onSend: (claim: string, slides: number[]) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [claim, setClaim] = useState("");
  const [slides, setSlides] = useState<number[]>(offered.slice(0, 1));
  if (!open)
    return (
      <div className="a-row v-claim-open">
        <span className="a-small a-muted">מחכים לצד השני.</span>
        <button className="a-btn" onClick={() => setOpen(true)}>
          {label}
        </button>
      </div>
    );
  return (
    <div className="a-stack v-claim-form">
      <label className="a-field">
        <span>הטענה, בשורה אחת</span>
        <input className="a-input" dir="auto" maxLength={240} value={claim} onChange={(e) => setClaim(e.target.value)} />
      </label>
      <div className="a-wrap" role="group" aria-label="שקפים">
        {offered.map((n) => (
          <button
            key={n}
            type="button"
            className={`a-chip${slides.includes(n) ? " busy" : ""}`}
            aria-pressed={slides.includes(n)}
            onClick={() => setSlides((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n].slice(-4)))}
          >
            {slides.includes(n) ? `✓ ש׳ ${n}` : `ש׳ ${n}`}
          </button>
        ))}
      </div>
      <div className="a-row">
        <button className="a-btn primary" disabled={busy || claim.trim().length < 5 || !slides.length} onClick={() => onSend(claim.trim(), slides)}>
          {busy ? "שומר…" : "לשלוח"}
        </button>
        <button className="a-btn ghost" onClick={() => setOpen(false)}>
          ביטול
        </button>
      </div>
    </div>
  );
}

/** The bottom bar of a judged card: "בהרצאה נאמר אחרת" (with an optional line) and "לקבל". */
function Decide({ busy, onDecide }: { busy: string; onDecide: (d: "accept" | "override", note: string) => void }) {
  const [overriding, setOverriding] = useState(false);
  const [note, setNote] = useState("");
  if (overriding)
    return (
      <div className="a-stack v-override">
        <label className="a-field">
          <span>מה נאמר בהרצאה (לא חובה)</span>
          <input className="a-input" dir="auto" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <StickyActions>
          <button className="a-btn ghost" onClick={() => setOverriding(false)}>
            ביטול
          </button>
          <button className="a-btn primary wide" disabled={Boolean(busy)} onClick={() => onDecide("override", note.trim())}>
            {busy === "decide" ? "שומר…" : "לשמור: בהרצאה נאמר אחרת"}
          </button>
        </StickyActions>
      </div>
    );
  return (
    <StickyActions>
      <button className="a-btn" disabled={Boolean(busy)} onClick={() => setOverriding(true)}>
        בהרצאה נאמר אחרת
      </button>
      <button className="a-btn primary wide" disabled={Boolean(busy)} onClick={() => onDecide("accept", "")}>
        {busy === "decide" ? "שומר…" : "לקבל"}
      </button>
    </StickyActions>
  );
}
