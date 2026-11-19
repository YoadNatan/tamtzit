import { useEffect, useMemo, useRef, useState } from "react";
import type { Ctx } from "../features/types";
import { flags } from "../lib/flags";
import { cardState, COPY, firstSteps, hintFlags, isDone, NO_FACTS, offerWanted, readMemory, writeMemory, type Facts, type Memory } from "../lib/guide";
import { guideFacts } from "../lib/guideFacts";
import { freshFor, GUIDE_EVENT, guideSend, type GuideCommand } from "../lib/guideMark";
import { RouteLink } from "./Shell";
import "../styles/guide.css";

/* ── "הצעדים הראשונים" (docs/study/guide.md §2.1) ──
 * The home's card for a member new on this device: up to five real things
 * to do, each ticked off when it is really done (a paragraph opened, an
 * answer sent with a bet, …), each with "להראות", which walks there with
 * the ring and the bubble. Expanded on the first two home views, one row
 * from the third, "כל הצעדים בוצעו." when done, gone after 14 days or on
 * "להסתיר" (with "ביטול"); "שלי" brings it back. Never a scrim, never in
 * the way of the home's own blocks.
 *
 * A member who never had the first steps (joined before the guide) gets,
 * in the same place, a one-time offer instead: "סיור קצר באפליקציה" with
 * "להתחיל סיור" (the app tour over the tab bar) and "לא עכשיו". Either
 * answer is kept on the device and the offer never comes back; the tour
 * stays in "שלי" ← "מדריך לאפליקציה" and at the top of help. */

/** One count per home view (React's development double effect counts once). */
let lastView = 0;

export default function GuideSteps({ ctx, home, queue }: { ctx: Ctx; home: "today" | "library"; queue: number | null }) {
  const [m, setM] = useState<Memory>(() => {
    const now = Date.now();
    let mem = readMemory(ctx.userId);
    const fresh = freshFor(ctx.group.id, true);
    if (fresh) {
      // Join's success: the first steps start now, and what is on now is not "חדש".
      mem = { ...mem, born: now, mode: fresh.mode, views: 0, did: [], list: [], hidden: false, closed: false, known: hintFlags(flags) };
      writeMemory(ctx.userId, mem);
    }
    if (mem.born && now - lastView > 1500) {
      lastView = now;
      mem = { ...mem, views: mem.views + 1 };
      writeMemory(ctx.userId, mem);
    }
    return mem;
  });
  const [facts, setFacts] = useState<Facts | null>(null);
  const [open, setOpen] = useState(false);
  /** The offer was answered with "להתחיל סיור" on this view: it stays as one line saying where the tour lives. */
  const [offerOpen, setOfferOpen] = useState(false);

  // The memory changes elsewhere: a mark ticked a step, "שלי" brought the card back.
  useEffect(() => {
    const on = (e: Event) => {
      const cmd = (e as CustomEvent<GuideCommand>).detail;
      if (cmd?.type === "changed") setM(readMemory(ctx.userId));
    };
    window.addEventListener(GUIDE_EVENT, on);
    return () => window.removeEventListener(GUIDE_EVENT, on);
  }, [ctx.userId]);

  const live = Boolean(m.born) && !m.closed && !m.hidden;
  useEffect(() => {
    if (!live) return;
    let alive = true;
    guideFacts(ctx, true)
      .then((f) => alive && setFacts(f))
      .catch(() => alive && setFacts(NO_FACTS));
    return () => {
      alive = false;
    };
  }, [ctx, live]);

  const steps = useMemo(() => (facts ? firstSteps(flags, { ...facts, queue }, m) : []), [facts, queue, m]);

  // The list is kept once shown: a done step never leaves it.
  const ids = steps.map((s) => s.id).join(",");
  useEffect(() => {
    if (!facts || !ids || ids === m.list.join(",")) return;
    const next = { ...readMemory(ctx.userId), list: steps.map((s) => s.id) };
    writeMemory(ctx.userId, next);
    setM(next);
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (patch: Partial<Memory>) => {
    const next = { ...readMemory(ctx.userId), ...patch };
    writeMemory(ctx.userId, next);
    setM(next);
    guideSend({ type: "changed" });
  };

  const state = cardState(m, steps, Date.now());
  if (state === "none") return offerWanted(m) || offerOpen ? <TourOffer ctx={ctx} home={home} onAnswer={() => setOfferOpen(true)} /> : null;
  if (state === "hidden" || state === "retired") return null;
  if (!facts) return <div className="g-steps-hold" aria-hidden="true" style={{ minHeight: state === "collapsed" ? 76 : 260 }} />;
  if (!steps.length) return null;

  const done = steps.filter((s) => isDone(s, m)).length;
  const total = steps.length;
  const next = steps.find((s) => !isDone(s, m) && s.walk) ?? steps.find((s) => !isDone(s, m));
  const show = (walk: string | undefined, el: HTMLElement) => walk && guideSend({ type: "walk", walk, opener: el });
  const hide = () => {
    save({ hidden: true });
    ctx.say(COPY.hidden, { label: COPY.undo, run: () => save({ hidden: false }) });
  };

  const bar = (
    <div className="a-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={COPY.cardTitle}>
      <i style={{ width: `${Math.round((100 * done) / total)}%` }} />
    </div>
  );

  if (state === "done")
    return (
      <section className="a-card g-steps" aria-labelledby="g-steps-h" data-home={home}>
        <div className="g-steps-head">
          <h2 className="a-h2" id="g-steps-h">
            {COPY.cardTitle}
          </h2>
          <span className="a-chip ok">{`${done} מתוך ${total}`}</span>
        </div>
        {bar}
        <div className="g-steps-row">
          <span className="a-small">{COPY.allDone}</span>
          <button type="button" className="a-btn small" onClick={() => save({ closed: true })}>
            {COPY.close}
          </button>
        </div>
      </section>
    );

  const expanded = state === "expanded" || open;
  return (
    <section className="a-card g-steps" aria-labelledby="g-steps-h" data-home={home}>
      <div className="g-steps-head">
        <h2 className="a-h2" id="g-steps-h">
          {COPY.cardTitle}
        </h2>
        <span className="a-chip">{`${done} מתוך ${total}`}</span>
      </div>
      {bar}
      {expanded ? (
        <>
          <p className="a-small a-muted">{m.mode === "create" ? COPY.createLine : COPY.joinLine(ctx.group.me)}</p>
          <ul className="a-list" id="g-steps-list">
            {steps.map((s) => {
              const ok = isDone(s, m);
              return (
                <li key={s.id} className={`a-li g-step${ok ? " is-done" : ""}`} data-step={s.id}>
                  <span className="g-check" aria-hidden={!ok}>
                    {ok ? (
                      <>
                        <span aria-hidden="true">✓</span>
                        <span className="sr-only">בוצע</span>
                      </>
                    ) : null}
                  </span>
                  <div>
                    <b>
                      {s.title}
                      {s.chip ? <span className="a-chip busy g-step-chip"> {s.chip}</span> : null}
                    </b>
                    <span className="m">{s.line}</span>
                    {s.skipped && !ok ? <span className="a-small a-muted">{COPY.skipped}</span> : null}
                  </div>
                  {s.walk ? (
                    <button type="button" className={`a-btn small${ok ? " ghost" : ""}`} onClick={(e) => show(s.walk, e.currentTarget)} aria-label={`${COPY.show}: ${s.title}`}>
                      {COPY.show}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="g-steps-foot">
            <RouteLink to={{ v: "try" }} go={ctx.go} className="a-link">
              {COPY.tryIt}
            </RouteLink>
            {open ? (
              <button type="button" className="a-link" aria-expanded="true" aria-controls="g-steps-list" onClick={() => setOpen(false)}>
                פחות
              </button>
            ) : null}
            <button type="button" className="a-link" onClick={hide}>
              {COPY.hide}
            </button>
          </div>
        </>
      ) : (
        <div className="g-steps-row">
          <span className="a-small">{next ? `הבא: ${next.title}` : COPY.allDone}</span>
          {next?.walk ? (
            <button type="button" className="a-btn small" onClick={(e) => show(next.walk, e.currentTarget)} aria-label={`${COPY.show}: ${next.title}`}>
              {COPY.show}
            </button>
          ) : null}
          <button type="button" className="a-link" aria-expanded="false" aria-controls="g-steps-list" onClick={() => setOpen(true)}>
            כל הצעדים
          </button>
        </div>
      )}
    </section>
  );
}

/** The home's one-time offer of the app tour (docs/study/guide.md). The
 *  tour only points: it starts over the tab bar, and the member's own taps
 *  do the rest. After "להתחיל סיור" the card stays for this view as one line
 *  saying where the tour lives, and takes focus back when the tour ends. */
function TourOffer({ ctx, home, onAnswer }: { ctx: Ctx; home: "today" | "library"; onAnswer: () => void }) {
  const [started, setStarted] = useState(false);
  const [gone, setGone] = useState(false);
  const card = useRef<HTMLElement>(null);
  const answer = (offer: Memory["offer"]) => {
    writeMemory(ctx.userId, { ...readMemory(ctx.userId), offer });
    guideSend({ type: "changed" });
  };
  if (gone) return null;
  const start = () => {
    answer("taken");
    onAnswer();
    setStarted(true);
    guideSend({ type: "tour", opener: card.current });
  };
  const later = () => {
    answer("dismissed");
    setGone(true);
    ctx.say(COPY.offerWhere);
  };
  return (
    <section ref={card} className="a-card g-steps g-offer" aria-labelledby="g-offer-h" data-home={home} tabIndex={-1}>
      <div className="g-steps-head">
        <h2 className="a-h2" id="g-offer-h">
          {COPY.tourTitle}
        </h2>
      </div>
      {started ? (
        <div className="g-steps-row">
          <span className="a-small">{COPY.offerWhere}</span>
          <button type="button" className="a-btn small" onClick={() => setGone(true)}>
            {COPY.close}
          </button>
        </div>
      ) : (
        <>
          <p className="a-small a-muted">{COPY.offerLine}</p>
          <div className="a-row g-offer-actions">
            <button type="button" className="a-btn primary small" onClick={start}>
              {COPY.tourStart}
            </button>
            <button type="button" className="a-link" onClick={later}>
              {COPY.offerLater}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
