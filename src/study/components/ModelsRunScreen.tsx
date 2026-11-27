import { useCallback, useEffect, useRef, useState } from "react";
import { modelInfo } from "../../../shared/study/models";
import type { Ctx, ScreenProps } from "../features/types";
import {
  cancelRun,
  continueRun,
  differsOf,
  dropDraft,
  KEYED_KINDS,
  liveOf,
  loadDraft,
  mergeDraft,
  missingScore,
  onLive,
  projection,
  rate,
  RATED_KINDS,
  readBoard,
  readRun,
  readSource,
  reveal,
  runSteps,
  saveDraft,
  shownOf,
  times,
  type Board,
  type Output,
  type RateDraft,
  type Rating,
  type Run,
  type Source,
} from "../lib/models";
import { waLink } from "../lib/personalCode";
import { shareUrl } from "../lib/route";
import { keyedLines, MC, modelsFail, routeName, usd } from "../lib/modelsCopy";
import "../styles/models.css";
import { ChecksLine, Confirm, LabelDot, ModelName, QualityPrice } from "./ModelsParts";
import { BackLink, Head, Loading, RouteLink, Sheet, StickyActions, useOnline } from "./Shell";

/* ── ?v=models&r=<run>: one comparison (design-models §5.4, §5.6) ──
 * While it runs: one combined count and its bar, never a label's status, a
 * model's name, a time or a cost (D12; the server's study_lab_run gives
 * nothing more); the owner can leave (the run goes on without the phone) or
 * stop it. Re-opened after a minute with answers still waiting, the owner's
 * screen asks the server once to start them ("resume"). Once it is done:
 * every answer under its label (א-ד), its status and its automatic checks,
 * the answer itself folded; a failed answer can be tried once more. For a
 * kind members do not rate (the answer-key kinds), "הצגת השמות והעלות"
 * reveals the names, times and costs to the caller (the owner too is blind
 * until then), with quality against price side by side, and each model's
 * month at this run's rate.
 *
 * The kinds rated by people (practice, a set's batch, points, cards, "לשאול",
 * a summary part; WP8, design-models §5.5): once it is done, anyone who may
 * rate it (members for the short kinds, the owner for every kind: OD3, the
 * owner is blind too) rates each answer blind: one score 1-5, "יש כאן טעות
 * עובדתית" with an optional note, the owner's optional detail; each tap is
 * saved at once (study_lab_rate) and kept on the device (a draft that
 * survives a reload, and taps made offline are sent when the connection
 * returns, C56); at the end the best pick, then "שמירה והצגת השמות"
 * (study_lab_reveal), or a skip (C28). Only then the names, times, costs,
 * the group's score and the AI score show (C30). The owner sends the run to
 * the group's WhatsApp (C49) and runs the paid checks left pending. */

const POLL_MS = 3000;
/** After this long with answers still waiting, the owner's screen sends resume once (design-models §5.4). */
const RESUME_AFTER_MS = 60_000;

export default function ModelsRunScreen({ route, ctx }: ScreenProps<"models">) {
  const id = route.r!;
  const [run, setRun] = useState<Run | null>(null);
  const [failed, setFailed] = useState("");
  const [, setTick] = useState(0);
  const [material, setMaterial] = useState<Source | null | "open">(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const resumed = useRef(false);
  const online = useOnline();

  const load = useCallback(
    () =>
      readRun(id)
        .then((r) => {
          setRun(r);
          setFailed("");
          return r;
        })
        .catch((e: unknown) => {
          setFailed(modelsFail(e instanceof Error ? e.message : ""));
          return null;
        }),
    [id],
  );
  useEffect(() => {
    void load();
    return onLive(() => setTick((n) => n + 1));
  }, [load]);
  // Follow it while it runs (the server's count; the stream's, in this tab, comes sooner), and while its paid steps run.
  const stepping = Boolean(run && run.status === "done" && (run.outputs.some((o) => o.check_status === "running") || run.judge === "running"));
  useEffect(() => {
    if (run?.status !== "running" && !stepping) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [run?.status, stepping, load]);
  // A done stream in this tab: read the run at once.
  const live = liveOf(id);
  useEffect(() => {
    if (live?.done) void load();
  }, [live?.done, load]);
  // Re-opened: answers still waiting after a minute, no stream here: resume once.
  useEffect(() => {
    if (!run || !run.owner || run.status !== "running" || resumed.current || liveOf(id)) return;
    if (Date.now() - Date.parse(run.created_at) < RESUME_AFTER_MS) return;
    resumed.current = true;
    void continueRun("resume", id)
      .catch(() => undefined)
      .then(() => load());
  }, [run, id, load]);
  // Seen: the kind's results, for each model's month at this run's rate.
  const seen = Boolean(run?.mine);
  useEffect(() => {
    if (!seen || !run?.owner) return;
    void readBoard(ctx.group.id, run.route)
      .then(setBoard)
      .catch(() => undefined);
  }, [seen, run?.owner, run?.route, ctx.group.id]);

  const back = <BackLink go={ctx.go} fallback={{ v: "models" }} />;
  if (!run) {
    return failed ? (
      <main className="md-screen">
        <Head back={back} title={MC.title} />
        <p className="a-error">{failed}</p>
      </main>
    ) : (
      <Loading />
    );
  }

  const running = run.status === "running";
  const ready = running && live && !live.done ? Math.max(live.ready, run.ready) : run.ready;
  const total = run.total || live?.total || 0;
  const finished = run.outputs.filter((o) => o.status === "done" || o.status === "truncated");
  const keyed = KEYED_KINDS.has(run.route);
  const rated = RATED_KINDS.has(run.route);
  // The blind rating: a done run of a kind rated by people, 2 answers or more, not yet revealed by the caller.
  const rating = rated && run.status === "done" && run.can_rate && !seen && finished.length >= 2;
  const pending = run.owner && run.status === "done" && run.outputs.some((o) => o.check_status === "pending");

  const openMaterial = () => {
    setMaterial("open");
    void readSource(id)
      .then(setMaterial)
      .catch(() => setMaterial({ source: {}, material: null, kept: false }));
  };
  const stop = async () => {
    setBusy(true);
    try {
      await cancelRun(id);
      ctx.say(MC.cancelled);
      await load();
    } catch (e) {
      ctx.say(modelsFail(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
  };
  const retry = async (label: string) => {
    setBusy(true);
    try {
      await continueRun("retry", id, label);
    } catch (e) {
      ctx.say(modelsFail(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
      void load();
    }
  };
  const checkNow = async () => {
    setBusy(true);
    try {
      await runSteps("check", id);
    } catch (e) {
      ctx.say(modelsFail(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
      void load();
    }
  };
  const show = async () => {
    setBusy(true);
    try {
      await reveal(id);
      await load();
    } catch (e) {
      ctx.say(modelsFail(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
  };

  const maxCost = Math.max(0, ...run.outputs.map((o) => Number(o.cost_usd) || 0));
  return (
    <main className="md-screen md-run">
      <Head back={back} title={run.title} />
      <div className="a-row between md-run-head">
        <span className="a-small a-muted">{routeName(run.route)}</span>
        <button type="button" className="a-btn small" onClick={openMaterial} aria-haspopup="dialog">
          {MC.material}
        </button>
      </div>

      {running ? (
        <section className="a-card md-progress" aria-live="polite">
          <p>
            <b>{MC.ready(ready, total)}</b>
          </p>
          <div className={`a-bar${ready === 0 ? " md-wait" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={ready} aria-valuetext={MC.ready(ready, total)}>
            <i style={{ width: `${total ? Math.round((ready / total) * 100) : 0}%` }} />
          </div>
          <p className="a-small a-muted">
            {ready === 0 ? `${MC.usually} ` : ""}
            {MC.leave}
          </p>
          {run.owner ? (
            <button type="button" className="a-link danger" disabled={busy || !online} onClick={() => setConfirm(true)}>
              {MC.cancel}
            </button>
          ) : null}
        </section>
      ) : (
        <>
          {run.status === "cancelled" ? <p className="a-callout warn">{MC.cancelled}</p> : null}
          {differsOf(run.differs).map((d) => (
            <p key={d} className="a-small a-muted md-differs">
              {MC.differsWords[d] ?? MC.differs}
            </p>
          ))}
          {finished.length < 2 ? <p className="a-callout warn md-few">{finished.length === 1 ? MC.oneAnswer : MC.noAnswer}</p> : null}
          {!seen ? <p className="a-small md-blind">{rated || run.member_rate ? MC.blindRated : MC.blind}</p> : null}
          {RATED_KINDS.has(run.route) && run.mine && !run.mine.rated ? <p className="a-small a-muted">{MC.skippedNote}</p> : null}
          {run.mine?.rated && run.mine.best ? <p className="a-small">{run.mine.best === "=" ? MC.bestSame : MC.bestMine(run.mine.best)}</p> : null}
          {seen && finished.length ? <SideBySide run={run} keyed={keyed} maxCost={maxCost} /> : null}
          {pending ? (
            <div className="a-callout md-pending" role="status">
              <p className="a-small">{MC.checkNote}</p>
              <button type="button" className="a-btn small" disabled={busy || !online} onClick={() => void checkNow()}>
                {busy ? MC.checking : MC.checkNow}
              </button>
            </div>
          ) : null}
          {run.owner && run.member_rate && run.status === "done" && finished.length >= 2 ? <ShareRun run={run} say={ctx.say} /> : null}
          {rating ? (
            <RateFlow key={run.id} run={run} ctx={ctx} onDone={() => void load()} />
          ) : (
            <div className="md-answers">
              {run.outputs.map((o) => (
                <AnswerCard key={o.label} o={o} run={run} board={board} groupBusy={busy} onRetry={() => void retry(o.label)} />
              ))}
            </div>
          )}
          {seen ? (
            <RouteLink to={{ v: "models", x: "board", k: run.route }} go={ctx.go} className="a-btn wide md-to-board">
              {MC.toBoard(routeName(run.route))}
            </RouteLink>
          ) : null}
          {!seen && run.owner && !rated && run.status === "done" ? (
            <StickyActions>
              <div className="md-run-foot-bar">
                <button type="button" className="a-btn primary wide" disabled={busy || !online} onClick={() => void show()}>
                  {MC.reveal}
                </button>
                <p className="a-small a-muted">{MC.revealNote}</p>
              </div>
            </StickyActions>
          ) : null}
        </>
      )}

      {confirm ? <Confirm label={MC.cancel} text={MC.cancelConfirm} yes={MC.cancelYes} no={MC.cancelNo} danger onYes={() => void stop()} onClose={() => setConfirm(false)} /> : null}
      {material ? <MaterialSheet route={run.route} source={material === "open" ? null : material} onClose={() => setMaterial(null)} /> : null}
    </main>
  );
}

/** The quality of one answer, 0-1: the match with the key for an answer-key
 *  kind; for a rated kind the group's mean score (of 5), else the caller's own. */
function qualityOfOutput(o: Output, keyed: boolean): number | null {
  if (!keyed) {
    const g = o.group?.mean;
    if (g !== null && g !== undefined && Number(o.group?.n) > 0) return Number(g) / 5;
    return o.my?.overall ? o.my.overall / 5 : null;
  }
  const items = Number(o.checks?.items) || 0;
  return items > 0 ? (Number(o.checks?.match) || 0) / items : null;
}

/** After the reveal: each answer's quality against its price, side by side, and how much cheaper than today's model. */
function SideBySide({ run, keyed, maxCost }: { run: Run; keyed: boolean; maxCost: number }) {
  const outs = run.outputs.filter((o) => o.model);
  const ref = outs.find((o) => o.model === "claude-opus-5-5") ?? outs[0];
  return (
    <section className="a-card md-side" aria-labelledby="md-side-h">
      <h2 id="md-side-h" className="a-h2">
        {MC.side}
      </h2>
      {outs.map((o) => {
        const q = qualityOfOutput(o, keyed);
        const items = Number(o.checks?.items) || 0;
        const cost = Number(o.cost_usd) || 0;
        const refCost = Number(ref?.cost_usd) || 0;
        const k = cost > 0 && refCost > 0 && o !== ref ? refCost / cost : 0;
        return (
          <div key={o.label} className="md-side-row">
            <div className="a-row between">
              <b>
                <LabelDot label={o.label} /> <ModelName id={o.model!} />
              </b>
              {k >= 1.2 ? <span className="a-chip ok">{MC.cheaper(times(k))}</span> : k > 0 && k <= 1 / 1.2 ? <span className="a-chip warn">{MC.dearer(times(1 / k))}</span> : null}
            </div>
            <QualityPrice quality={q} qualityText={q === null ? (MC.status[o.status ?? ""] ?? "—") : keyed ? `${Math.round(q * 100)}% · ${MC.items(items)}` : `${(q * 5).toFixed(1)}/5`} price={cost} priceText={usd(cost)} max={maxCost} />
          </div>
        );
      })}
    </section>
  );
}

function AnswerCard({ o, run, board, groupBusy, onRetry }: { o: Output; run: Run; board: Board | null; groupBusy: boolean; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  const status = o.status ?? "waiting";
  const shown = status === "error" && o.reason === "not started" ? MC.notStarted : (MC.status[status] ?? status);
  const tone = status === "done" ? "ok" : status === "truncated" || status === "timeout" ? "warn" : status === "refused" || status === "error" ? "bad" : "";
  const canRetry = run.owner && (status === "timeout" || status === "error") && (o.tries ?? 0) < 1 && o.reason !== "cancelled";
  const tokens = o.usage ? Number((o.usage as Record<string, unknown>).input_tokens ?? 0) + Number((o.usage as Record<string, unknown>).output_tokens ?? 0) : 0;
  const p = o.model && board?.usage30 ? projection({ key: run.route, model: o.model, today: board.today, usage: board.usage30, board: board.models }) : null;
  return (
    <article className="a-card md-answer" aria-label={MC.answer(o.label)}>
      <header className="a-row between md-answer-head">
        <h3 className="md-answer-name">
          <LabelDot label={o.label} />
          {o.model ? <ModelName id={o.model} /> : MC.answer(o.label)}
        </h3>
        <span className={`a-chip${tone ? ` ${tone}` : ""}`}>{shown}</span>
      </header>
      <ChecksLine route={run.route} checks={o.checks} checkStatus={o.check_status} />
      {o.model && RATED_KINDS.has(run.route) ? <RatedFacts o={o} /> : null}
      {o.model ? (
        <p className="a-small md-answer-facts">
          {o.latency_ms ? `${MC.seconds(Math.round(o.latency_ms / 1000))} · ` : ""}
          {usd(o.cost_usd)}
          {run.owner && tokens ? ` · ${MC.tokens(tokens)}` : ""}
          {run.owner && p && p.base > 0 ? ` · ${MC.perMonth(usd(p.usd))}${p.rough ? ` (${MC.rough})` : ""}` : ""}
          {modelInfo(o.model)?.verified === false ? ` · ${MC.tagUnverified}` : ""}
        </p>
      ) : null}
      {o.text ? (
        <>
          <button type="button" className="a-link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? MC.hideText : MC.showText}
          </button>
          {open ? RATED_KINDS.has(run.route) ? <ShownAnswer route={run.route} text={o.text} /> : <KeyedAnswer route={run.route} text={o.text} /> : null}
        </>
      ) : null}
      {canRetry ? (
        <button type="button" className="a-btn small" disabled={groupBusy} onClick={onRetry}>
          {MC.retry}
        </button>
      ) : null}
    </article>
  );
}

/** An answer's text: JSON indented, anything else as it came. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** An answer-key kind's answer in words (keyedLines): the solver's choice per
 *  question, a correction check's verdict and reason, a reader's numbered
 *  questions; the model's raw JSON stays behind a small fold. */
function KeyedAnswer({ route, text }: { route: string; text: string }) {
  const lines = keyedLines(route, text);
  return (
    <div className="md-shown">
      {lines.length ? (
        <ol className="md-keyed">
          {lines.map((l, i) => (
            <li key={i} dir="auto">
              {l}
            </li>
          ))}
        </ol>
      ) : null}
      <details className="md-fold">
        <summary className="a-small">{MC.rawJson}</summary>
        <pre className="md-text" dir="auto">
          {pretty(text)}
        </pre>
      </details>
    </div>
  );
}

/** "החומר": what the run was given, as the server marks it showable (never a key). */
function MaterialSheet({ route, source, onClose }: { route: string; source: Source | null; onClose: () => void }) {
  const m = (source?.material ?? null) as Record<string, unknown> | null;
  const items = Array.isArray(m?.items) ? (m!.items as Array<{ vignette?: string; question?: string; options?: string[] }>) : [];
  const pages = Array.isArray(m?.pages) ? (m!.pages as Array<{ n: number }>) : [];
  return (
    <Sheet label={MC.materialTitle} head={<h2 className="a-h2">{MC.materialTitle}</h2>} onClose={onClose} className="md-sheet">
      {!source ? <Loading /> : null}
      {source && (!source.kept || !m) ? <p className="a-muted">{MC.materialGone}</p> : null}
      {m && typeof m.title === "string" ? <p className="a-small a-muted">{m.title}</p> : null}
      {items.length ? (
        <ol className="md-material-list">
          {items.map((q, i) => (
            <li key={i}>
              <p dir="auto">{`${q.vignette ? `${q.vignette} ` : ""}${q.question ?? ""}`}</p>
              {q.options?.length ? (
                <ol className="md-options">
                  {q.options.map((x, j) => (
                    <li key={j} dir="auto">
                      {x}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {route === "fix_check" && m ? (
        <div className="md-fix">
          <p className="a-small a-muted">{MC.before}</p>
          <p dir="auto">{String(m.before ?? "")}</p>
          <p className="a-small a-muted">{MC.after}</p>
          <p dir="auto">{String(m.after ?? "")}</p>
        </div>
      ) : null}
      {pages.length ? <p>{MC.pages(pages.map((p) => p.n).join(", "))}</p> : null}
      {m && typeof m.heading === "string" && Array.isArray(m.slides) ? <p>{MC.partOf(m.heading, Number(m.slides[0]), Number(m.slides[1]))}</p> : null}
      {m && typeof m.question === "string" ? (
        <>
          <p className="a-small a-muted">{MC.askedQuestion}</p>
          <p dir="auto">{m.question}</p>
        </>
      ) : null}
    </Sheet>
  );
}


/* ── After the reveal, a rated kind (C30) ── */

function RatedFacts({ o }: { o: Output }) {
  const g = o.group;
  const parts = [
    o.my?.overall ? MC.yours(o.my.overall) : "",
    g && Number(g.n) > 0 && g.mean !== null ? MC.groupScore(Number(g.mean).toFixed(1), Number(g.n)) : MC.groupNone,
    g && Number(g.errors) > 0 ? MC.flagged(Number(g.errors)) : "",
    o.ai?.overall ? MC.ai(o.ai.overall) : "",
    o.ai?.errors?.length ? MC.aiErrors(o.ai.errors.length) : "",
  ].filter(Boolean);
  return <p className="a-small md-rated-facts">{parts.join(" · ")}</p>;
}

/* ── An answer as the app shows it (questions, points, cards, text) ── */

export function ShownAnswer({ route, text }: { route: string; text: string }) {
  const s = shownOf(route, text);
  if (s.kind === "questions")
    return (
      <ol className="md-shown md-shown-q">
        {s.items.map((q, i) => (
          <li key={i}>
            {q.vignette ? <p dir="auto">{q.vignette}</p> : null}
            <p dir="auto">
              <b>{q.question}</b>
            </p>
            <ol className="md-options">
              {q.options.map((x, j) => (
                <li key={j} dir="auto" className={x.correct ? "md-correct" : undefined}>
                  {x.text}
                  {x.correct ? <span className="a-chip ok md-small">{MC.rate.correct}</span> : null}
                </li>
              ))}
            </ol>
            {q.takeaway ? (
              <p className="a-small a-muted" dir="auto">
                {q.takeaway}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    );
  if (s.kind === "points")
    return (
      <ul className="md-shown">
        {s.items.map((p, i) => (
          <li key={i} dir="auto">
            {p.subject ? <b>{p.subject}: </b> : null}
            {p.text}
            {p.red ? <span className="a-chip bad md-small">{MC.rate.red}</span> : null}
          </li>
        ))}
      </ul>
    );
  if (s.kind === "cards")
    return (
      <ul className="md-shown md-shown-cards">
        {s.items.map((c, i) => (
          <li key={i}>
            <p dir="auto">
              <span className="a-small a-muted">{MC.rate.front}: </span>
              {c.front}
            </p>
            <p dir="auto">
              <span className="a-small a-muted">{MC.rate.back}: </span>
              {c.back}
            </p>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="md-shown md-shown-text" dir="auto">
      {s.text}
    </div>
  );
}

/* ── The blind rating (design-models §5.5) ── */

const EMPTY: Rating = { overall: null, error: false, note: "" };

function RateFlow({ run, ctx, onDone }: { run: Run; ctx: Ctx; onDone: () => void }) {
  const outs = run.outputs.filter((o) => o.id && (o.status === "done" || o.status === "truncated"));
  const others = run.outputs.filter((o) => !outs.includes(o));
  const [draft, setDraft] = useState<RateDraft>(() => mergeDraft(loadDraft(run.id), run.outputs));
  const first = outs.findIndex((o) => !draft.by[o.id!]?.overall);
  const [at, setAt] = useState<number | "best">(first < 0 ? "best" : first);
  const [busy, setBusy] = useState(false);
  const [skipAsk, setSkipAsk] = useState(false);
  const [error, setError] = useState("");
  const online = useOnline();
  const sending = useRef(new Set<string>());
  const top = useRef<HTMLDivElement | null>(null);

  // Every tap with a score is sent at once; offline, it waits in the draft and goes when the connection returns (C56).
  const flush = useCallback(async (d: RateDraft): Promise<boolean> => {
    let all = true;
    for (const o of outs) {
      const r = d.by[o.id!];
      if (!r?.overall || r.sent) continue;
      if (sending.current.has(o.id!)) {
        all = false;
        continue;
      }
      sending.current.add(o.id!);
      try {
        await rate(o.id!, { overall: r.overall, error: r.error, note: r.note, accuracy: r.accuracy, hebrew: r.hebrew, structure: r.structure });
        setDraft((cur) => {
          const now = cur.by[o.id!];
          if (!now || now.overall !== r.overall || now.error !== r.error || now.note !== r.note || now.accuracy !== r.accuracy || now.hebrew !== r.hebrew || now.structure !== r.structure) return cur;
          const next = { ...cur, by: { ...cur.by, [o.id!]: { ...now, sent: true } } };
          saveDraft(run.id, next);
          return next;
        });
      } catch (e) {
        all = false;
        const code = e instanceof Error ? e.message : "";
        if (code && code !== "network" && !/fetch|network/i.test(code)) setError(modelsFail(code));
      } finally {
        sending.current.delete(o.id!);
      }
    }
    return all;
    // `outs` comes from the run, which this component's key fixes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);
  useEffect(() => {
    if (!online) return;
    const t = setTimeout(() => void flush(draft), 500);
    return () => clearTimeout(t);
  }, [draft, online, flush]);

  const change = (id: string, patch: Partial<Rating>) =>
    setDraft((d) => {
      const next = { ...d, by: { ...d.by, [id]: { ...EMPTY, ...d.by[id], ...patch, sent: false } } };
      saveDraft(run.id, next);
      return next;
    });
  const pickBest = (b: string) =>
    setDraft((d) => {
      const next = { ...d, best: b };
      saveDraft(run.id, next);
      return next;
    });
  const go = (to: number | "best") => {
    setAt(to);
    top.current?.scrollIntoView({ block: "start" });
    // The tapped "next" button hides with its panel: focus moves to what opened (its heading, or the best pick's).
    requestAnimationFrame(() => document.getElementById(to === "best" ? `md-best-${run.id}` : `md-panel-${run.id}-${to}`)?.focus({ preventScroll: true }));
  };
  const missing = missingScore(outs, draft);
  const why = missing ? MC.rate.missing(missing) : !draft.best ? MC.rate.missingBest : !online ? MC.rate.offline : "";
  const save = async () => {
    if (why || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!(await flush(draft))) {
        // One more try for a tap that was still on its way.
        await new Promise((r) => setTimeout(r, 400));
        await flush(loadDraft(run.id));
      }
      await reveal(run.id, draft.best);
      dropDraft(run.id);
      ctx.say(MC.rate.saved);
      onDone();
    } catch (e) {
      setError(modelsFail(e instanceof Error ? e.message : ""));
      setBusy(false);
    }
  };
  const skip = async () => {
    setBusy(true);
    try {
      await reveal(run.id, null, true);
      dropDraft(run.id);
      onDone();
    } catch (e) {
      setError(modelsFail(e instanceof Error ? e.message : ""));
      setBusy(false);
    }
  };

  return (
    <section className="md-rate" aria-label={MC.rate.switcher}>
      <div ref={top} className="a-wrap md-switch" role="group" aria-label={MC.rate.switcher}>
        {outs.map((o, i) => (
          <button
            key={o.label}
            type="button"
            className={`a-btn small md-switch-btn${at === i ? " on" : ""}`}
            aria-pressed={at === i}
            aria-label={`${MC.answer(o.label)} · ${draft.by[o.id!]?.overall ? MC.rate.rated : MC.rate.notRated}`}
            onClick={() => go(i)}
          >
            <LabelDot label={o.label} />
            {draft.by[o.id!]?.overall ? <span aria-hidden="true"> ✓</span> : null}
          </button>
        ))}
        <button type="button" className={`a-btn small md-switch-btn${at === "best" ? " on" : ""}`} aria-pressed={at === "best"} onClick={() => go("best")}>
          {MC.rate.best}
        </button>
      </div>
      {!online ? (
        <p className="a-small a-muted" role="status">
          {MC.rate.offline}
        </p>
      ) : null}
      <div className="md-rate-grid">
        {outs.map((o, i) => (
          <article key={o.label} className={`a-card md-rate-panel${at === i ? " on" : ""}`} aria-label={MC.answer(o.label)}>
            <header className="a-row between md-answer-head">
              <h3 className="md-answer-name" id={`md-panel-${run.id}-${i}`} tabIndex={-1}>
                <LabelDot label={o.label} />
                {MC.answer(o.label)}
              </h3>
              {o.status === "truncated" ? <span className="a-chip warn">{MC.status.truncated}</span> : null}
            </header>
            <ChecksLine route={run.route} checks={o.checks} checkStatus={o.check_status} />
            <ShownAnswer route={run.route} text={o.text ?? ""} />
            {(o.text ?? "").length > 1500 ? <p className="a-small a-muted md-scroll-hint">{MC.rate.scrollMore}</p> : null}
            <ScoreBox label={o.label} id={o.id!} r={draft.by[o.id!] ?? EMPTY} owner={run.owner} onChange={(p) => change(o.id!, p)} />
            <button type="button" className="a-btn wide md-next" onClick={() => go(i + 1 < outs.length ? i + 1 : "best")}>
              {i + 1 < outs.length ? MC.rate.next(outs[i + 1].label) : MC.rate.last}
            </button>
          </article>
        ))}
      </div>
      {others.length ? (
        <ul className="a-small a-muted md-rate-others">
          {others.map((o) => (
            <li key={o.label}>
              {MC.answer(o.label)}: {o.reason === "not started" ? MC.notStarted : (MC.status[o.status ?? ""] ?? o.status)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className={`a-card md-rate-best${at === "best" ? " on" : ""}`}>
        <fieldset className="md-best">
          <legend id={`md-best-${run.id}`} tabIndex={-1}>
            {MC.rate.best}
          </legend>
          <div className="a-wrap" role="radiogroup" aria-label={MC.rate.best}>
            {[...outs.map((o) => o.label), "="].map((l) => (
              <label key={l} className={`a-chip md-best-pick${draft.best === l ? " on" : ""}`}>
                <input type="radio" name={`best-${run.id}`} checked={draft.best === l} onChange={() => pickBest(l)} />
                {l === "=" ? MC.rate.same : MC.answer(l)}
              </label>
            ))}
          </div>
        </fieldset>
        {error ? (
          <p className="a-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="a-btn primary wide" disabled={Boolean(why) || busy} onClick={() => void save()}>
          {MC.rate.save}
        </button>
        <p className="a-small md-why" role="status">
          {why}
        </p>
        <button type="button" className="a-link" disabled={busy || !online} onClick={() => setSkipAsk(true)}>
          {MC.rate.skip}
        </button>
      </div>
      {skipAsk ? <Confirm label={MC.rate.skip} text={MC.rate.skipConfirm} yes={MC.rate.skipYes} no={MC.rate.skipNo} onYes={() => void skip()} onClose={() => setSkipAsk(false)} /> : null}
    </section>
  );
}

/** One answer's score box: one score 1-5 (labelled radios in a fieldset), the error tick and its note, the owner's detail. */
function ScoreBox({ label, id, r, owner, onChange }: { label: string; id: string; r: Rating; owner: boolean; onChange: (p: Partial<Rating>) => void }) {
  const scale = (name: string, value: number | null | undefined, set: (n: number) => void, legend: string) => (
    <fieldset className="md-score">
      <legend>{legend}</legend>
      <div className="md-score-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`md-score-n${value === n ? " on" : ""}`}>
            <input type="radio" name={`${name}-${id}`} checked={value === n} onChange={() => set(n)} aria-label={`${n} · ${MC.rate.scale[n - 1]}`} />
            <span aria-hidden="true">{n}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div className="md-scorebox">
      {scale("overall", r.overall, (n) => onChange({ overall: n }), MC.rate.score(label))}
      <p className="a-small a-muted md-scale-ends" aria-hidden="true">
        <span>1 · {MC.rate.scale[0]}</span>
        <span>5 · {MC.rate.scale[4]}</span>
      </p>
      <label className="md-error-tick">
        <input type="checkbox" checked={r.error} onChange={(e) => onChange({ error: e.target.checked })} />
        {MC.rate.error}
      </label>
      {r.error ? (
        <label className="md-note">
          <span className="a-small a-muted">{MC.rate.note}</span>
          <input type="text" className="a-input" maxLength={300} value={r.note} onChange={(e) => onChange({ note: e.target.value })} dir="auto" />
        </label>
      ) : null}
      {owner ? (
        <details className="md-fold md-detail">
          <summary>{MC.rate.detail}</summary>
          {(["accuracy", "hebrew", "structure"] as const).map((k) => (
            <div key={k}>{scale(k, r[k], (n) => onChange({ [k]: n }), MC.rate.detailRows[k])}</div>
          ))}
        </details>
      ) : null}
    </div>
  );
}

/* ── "לשלוח לקבוצה לדירוג" (C49) ── */

function ShareRun({ run, say }: { run: Run; say: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const text = MC.shareText(shareUrl(`?v=models&r=${run.id}`));
  const other = async () => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
    }
    await copy();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      say(MC.shareCopied);
    } catch {
      say(MC.failed);
    }
  };
  return (
    <>
      <button type="button" className="a-btn wide md-share" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {MC.share}
      </button>
      {open ? (
        <Sheet label={MC.shareTitle} head={<h2 className="a-h2">{MC.shareTitle}</h2>} onClose={() => setOpen(false)} className="md-sheet">
          <p className="md-share-text" dir="auto">
            {text}
          </p>
          <div className="a-stack md-sheet-actions">
            <a className="a-btn primary wide" href={waLink(text)} target="_blank" rel="noopener noreferrer">
              {MC.shareWhatsApp}
            </a>
            <button type="button" className="a-btn wide" onClick={() => void other()}>
              {MC.shareOther}
            </button>
            <button type="button" className="a-btn wide" onClick={() => void copy()}>
              {MC.shareCopy}
            </button>
          </div>
          <p className="a-small a-muted">{MC.shareNote}</p>
        </Sheet>
      ) : null}
    </>
  );
}
