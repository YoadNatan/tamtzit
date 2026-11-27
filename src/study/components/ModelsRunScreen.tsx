import { useCallback, useEffect, useRef, useState } from "react";
import { modelInfo } from "../../../shared/study/models";
import type { ScreenProps } from "../features/types";
import {
  cancelRun,
  continueRun,
  KEYED_KINDS,
  liveOf,
  onLive,
  projection,
  readBoard,
  readRun,
  readSource,
  reveal,
  times,
  type Board,
  type Output,
  type Run,
  type Source,
} from "../lib/models";
import { MC, modelsFail, routeName, usd } from "../lib/modelsCopy";
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
 * month at this run's rate. */

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
  // Follow it while it runs: the server's count (the stream's, in this tab, comes sooner).
  useEffect(() => {
    if (run?.status !== "running") return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [run?.status, load]);
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
          <div className="a-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={ready} aria-valuetext={MC.ready(ready, total)}>
            <i style={{ width: `${total ? Math.round((ready / total) * 100) : 0}%` }} />
          </div>
          <p className="a-small a-muted">{MC.leave}</p>
          {run.owner ? (
            <button type="button" className="a-link danger" disabled={busy || !online} onClick={() => setConfirm(true)}>
              {MC.cancel}
            </button>
          ) : null}
        </section>
      ) : (
        <>
          {run.status === "cancelled" ? <p className="a-callout warn">{MC.cancelled}</p> : null}
          {run.differs ? <p className="a-small a-muted">{MC.differs}</p> : null}
          {finished.length < 2 ? <p className="a-callout warn md-few">{finished.length === 1 ? MC.oneAnswer : MC.noAnswer}</p> : null}
          {!seen ? <p className="a-small md-blind">{run.member_rate ? MC.blindRated : MC.blind}</p> : null}
          {seen && finished.length ? <SideBySide run={run} keyed={keyed} maxCost={maxCost} /> : null}
          <div className="md-answers">
            {run.outputs.map((o) => (
              <AnswerCard key={o.label} o={o} run={run} board={board} groupBusy={busy} onRetry={() => void retry(o.label)} />
            ))}
          </div>
          {seen ? (
            <RouteLink to={{ v: "models", x: "board", k: run.route }} go={ctx.go} className="a-btn wide md-to-board">
              {MC.toBoard(routeName(run.route))}
            </RouteLink>
          ) : null}
          {!seen && run.owner && !run.member_rate && run.status === "done" ? (
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

/** The quality of one answer, 0-1, by its checks: the match with the key. */
function qualityOfOutput(o: Output): number | null {
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
        const q = qualityOfOutput(o);
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
            <QualityPrice quality={q} qualityText={q === null ? (MC.status[o.status ?? ""] ?? "—") : keyed ? `${Math.round(q * 100)}% · ${MC.items(items)}` : `${Math.round(q * 100)}%`} price={cost} priceText={usd(cost)} max={maxCost} small={keyed && items < 20} />
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
      <ChecksLine route={run.route} checks={o.checks} />
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
          {open ? <pre className="md-text" dir="auto">{pretty(o.text)}</pre> : null}
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
    </Sheet>
  );
}

