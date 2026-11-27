import { lazy, useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_MODEL } from "../../../shared/study/models";
import type { Ctx, ScreenProps } from "../features/types";
import type { Route } from "../lib/route";
import { retryImport } from "../lib/staleChunk";
import {
  dayOf,
  isOwner,
  KEYED_KINDS,
  LAB_KINDS,
  listRuns,
  month,
  preselect,
  price,
  projection,
  readBoard,
  readState,
  recommend,
  totalOf,
  type Board,
  type ModelsState,
  type RunRow,
} from "../lib/models";
import { KNOWN_KEYS, MC, ROUTE_NAMES, ROUTE_SUBLINE, routeName, usd } from "../lib/modelsCopy";
import "../styles/models.css";
import { BudgetLine, ModelCard, ModelName, ProvidersBlock, RecCallout, RouteSheet, useKeys } from "./ModelsParts";
import { BackLink, Head, Loading, OFFLINE_LINE, RouteLink, StickyActions, useOnline } from "./Shell";

/* ── ?v=models: "השוואת מודלים" (docs/study/models.md; design-models §5.1-§5.7) ──
 * A run (r=…) and a new comparison (x=new) are their own lazy chunks. The
 * owner (the group's creator, or a lab admin; the server decides) gets three
 * tabs: השוואות (the month's line and the runs), תוצאות (a kind's results,
 * quality against price, model by model) and מי כותב מה (each kind's model,
 * its month, the route sheet, the providers). A member gets the runs that
 * wait for ratings, then the rated ones; never the tabs. */

const RunScreen = lazy(retryImport(() => import("./ModelsRunScreen")));
const NewScreen = lazy(retryImport(() => import("./ModelsNewScreen")));

export default function ModelsScreen({ route, ctx }: ScreenProps<"models">) {
  if (route.r) return <RunScreen route={route} ctx={ctx} />;
  if (route.x === "new") return <NewScreen route={route} ctx={ctx} />;
  return <Home route={route} ctx={ctx} />;
}

function Home({ route, ctx }: ScreenProps<"models">) {
  const [owner, setOwner] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void isOwner(ctx.group.id)
      .then((o) => alive && setOwner(o))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  const back = <BackLink go={ctx.go} fallback={{ v: "me" }} />;
  if (owner === null) {
    if (!failed) return <Loading />;
    return (
      <main className="md-screen">
        <Head back={back} title={MC.title} />
        <p className="a-error">{MC.failed}</p>
      </main>
    );
  }
  if (!owner) return <MemberList ctx={ctx} back={back} />;
  return <OwnerHome route={route} ctx={ctx} back={back} />;
}

/* ── A member: the runs to rate ── */

function MemberList({ ctx, back }: { ctx: Ctx; back: React.ReactNode }) {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void listRuns(ctx.group.id)
      .then(setRows)
      .catch(() => setFailed(true));
  }, [ctx.group.id]);
  const todo = (rows ?? []).filter((r) => r.mine === "todo");
  const done = (rows ?? []).filter((r) => r.mine === "rated" || r.mine === "skipped");
  return (
    <main className="md-screen">
      <Head back={back} title={MC.memberTitle} />
      {failed ? <p className="a-error">{MC.failed}</p> : null}
      {!rows && !failed ? <Loading /> : null}
      {rows && !todo.length ? <p className="a-muted">{MC.memberEmpty}</p> : null}
      {todo.length ? (
        <ul className="a-list md-runs">
          {todo.map((r) => (
            <li key={r.id}>
              <RouteLink to={{ v: "models", r: r.id }} go={ctx.go} className="a-li row-link">
                <div>
                  <b>{r.title}</b>
                  <div className="a-small a-muted">{dayOf(r.created_at)}</div>
                </div>
                <span className="a-chip">{MC.toRate}</span>
              </RouteLink>
            </li>
          ))}
        </ul>
      ) : null}
      {done.length ? (
        <section className="a-stack" aria-labelledby="md-rated-h">
          <div className="a-sec">
            <h2 id="md-rated-h">{MC.rated}</h2>
          </div>
          <ul className="a-list md-runs">
            {done.map((r) => (
              <li key={r.id}>
                <RouteLink to={{ v: "models", r: r.id }} go={ctx.go} className="a-li row-link">
                  <div>
                    <b>{r.title}</b>
                    <div className="a-small a-muted">{dayOf(r.created_at)}</div>
                  </div>
                  <span className="a-chip">{r.mine === "rated" ? MC.rated : MC.skipped}</span>
                </RouteLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

/* ── The owner: three tabs ── */

type TabKey = "runs" | "board" | "routes";

function OwnerHome({ route, ctx, back }: ScreenProps<"models"> & { back: React.ReactNode }) {
  const tab: TabKey = route.x === "board" ? "board" : route.x === "routes" ? "routes" : "runs";
  const [state, setState] = useState<ModelsState | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(
    () =>
      readState(ctx.group.id)
        .then((s) => {
          setState(s);
          setFailed(false);
        })
        .catch(() => setFailed(true)),
    [ctx.group.id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const to = (t: TabKey): Route => (t === "runs" ? { v: "models" } : t === "board" ? { v: "models", x: "board", ...(route.k ? { k: route.k } : {}) } : { v: "models", x: "routes" });
  return (
    <main className="md-screen">
      <Head back={back} title={MC.title} />
      <div className="a-seg md-tabs" role="tablist" aria-label={MC.tabsLabel}>
        {(["runs", "board", "routes"] as const).map((t) => (
          <button key={t} type="button" className="a-btn small" role="tab" aria-selected={tab === t} onClick={() => ctx.go(to(t), { replace: true })}>
            {MC.tabs[t]}
          </button>
        ))}
      </div>
      {failed && !state ? <p className="a-error">{MC.failed}</p> : null}
      {!state && !failed ? <Loading /> : null}
      {state ? (
        <div role="tabpanel" aria-label={MC.tabs[tab]}>
          {tab === "runs" ? <RunsTab ctx={ctx} state={state} /> : tab === "board" ? <BoardTab ctx={ctx} state={state} routeKey={route.k} onState={load} /> : <RoutesTab ctx={ctx} state={state} onState={load} />}
        </div>
      ) : null}
    </main>
  );
}

/* ── השוואות ── */

function RunsTab({ ctx, state }: { ctx: Ctx; state: ModelsState }) {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const online = useOnline();
  useEffect(() => {
    void listRuns(ctx.group.id)
      .then(setRows)
      .catch(() => setFailed(true));
  }, [ctx.group.id]);
  const off = !state.switches.lab;
  return (
    <section className="a-stack md-runs-tab">
      <BudgetLine state={state} />
      {off ? (
        <p className="a-callout warn" role="status">
          {MC.off}
        </p>
      ) : null}
      {!online || failed ? (
        <p className="a-small a-muted" role="status">
          {OFFLINE_LINE}
        </p>
      ) : null}
      {!rows && !failed ? <Loading /> : null}
      {rows && !rows.length ? (
        <>
          <p className="a-muted md-empty">{MC.empty}</p>
          {!off ? <FirstCard ctx={ctx} /> : null}
        </>
      ) : null}
      {rows?.length ? (
        <ul className="md-run-list">
          {rows.map((r) => (
            <li key={r.id}>
              <RouteLink to={{ v: "models", r: r.id }} go={ctx.go} className="a-card md-run-card">
                <b className="md-run-title">{r.title}</b>
                <span className="a-small a-muted">
                  {MC.runModels(r.total)} · {dayOf(r.created_at)}
                  {KEYED_KINDS.has(r.route) ? ` · ${MC.runChecked}` : ""}
                </span>
                <span className="a-row between md-run-foot">
                  <span className={`a-chip${r.status === "running" ? " busy" : r.status === "cancelled" ? " warn" : ""}`}>{r.status === "running" ? MC.ready(r.ready, r.total) : (MC.runStatus[r.status] ?? r.status)}</span>
                  <span className="a-small">{r.cost_usd !== null ? usd(r.cost_usd) : r.status === "done" ? MC.notSeen : ""}</span>
                </span>
              </RouteLink>
            </li>
          ))}
        </ul>
      ) : null}
      {!off ? (
        <StickyActions>
          <RouteLink to={{ v: "models", x: "new" }} go={ctx.go} className="a-btn primary wide">
            {MC.newRun}
          </RouteLink>
        </StickyActions>
      ) : null}
    </section>
  );
}

/** C50: the first comparison, one tap from empty: the question check on 10 bank questions, Opus against Haiku (else a decided correction). */
function FirstCard({ ctx }: { ctx: Ctx }) {
  const [offer, setOffer] = useState<{ route: string; title: string; total: number; models: string[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const route of ["solver", "fix_check"]) {
        const models = preselect(route, DEFAULT_MODEL);
        try {
          const p = await price(ctx.group.id, route, models);
          if (alive) setOffer({ route, title: p.title, total: totalOf(models, p.models), models });
          return;
        } catch {
          /* no material for this kind: the next */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  if (!offer) return null;
  return (
    <article className="a-card md-first">
      <h2 className="a-h2">{MC.firstTitle}</h2>
      <p>{offer.title}</p>
      <p className="a-small">
        <ModelName id={offer.models[0]} /> {MC.vs} <ModelName id={offer.models[1]} /> · {MC.firstUpTo(usd(offer.total))}
      </p>
      <RouteLink to={{ v: "models", x: "new", k: offer.route }} go={ctx.go} className="a-btn primary">
        {MC.start}
      </RouteLink>
    </article>
  );
}

/* ── תוצאות ── */

function BoardTab({ ctx, state, routeKey, onState }: { ctx: Ctx; state: ModelsState; routeKey?: string; onState: () => void }) {
  const kind = routeKey && ROUTE_NAMES[routeKey] ? routeKey : "solver";
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const keys = useKeys();
  useEffect(() => {
    let alive = true;
    setBoard(null);
    void readBoard(ctx.group.id, kind)
      .then((b) => alive && setBoard(b))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [ctx.group.id, kind]);
  const kinds = [...LAB_KINDS] as string[];
  const max = useMemo(() => {
    if (!board) return 0;
    return Math.max(0, ...board.models.map((m) => (board.usage30 ? projection({ key: kind, model: m.model, today: board.today, usage: board.usage30, board: board.models }).usd : (m.mean_usd ?? 0))));
  }, [board, kind]);
  const rec = board ? recommend({ route: kind, today: board.today, models: board.models, usage: board.usage30 }) : null;
  const models = board ? [...board.models].sort((a, b) => Number(b.today) - Number(a.today) || a.model.localeCompare(b.model)) : [];
  return (
    <section className="a-stack md-board">
      <div className="a-wrap md-kinds" role="radiogroup" aria-label={MC.boardKinds}>
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={k === kind} className={`a-chip md-kind${k === kind ? " on" : ""}`} onClick={() => ctx.go({ v: "models", x: "board", k }, { replace: true })}>
            {routeName(k)}
          </button>
        ))}
      </div>
      {ROUTE_SUBLINE[kind] ? <p className="a-small a-muted">{ROUTE_SUBLINE[kind]}</p> : null}
      {failed ? <p className="a-error">{MC.failed}</p> : null}
      {!board && !failed ? <Loading /> : null}
      {board && !board.models.length ? (
        <div className="a-card flat md-board-empty">
          <p>{MC.boardEmpty(routeName(kind))}</p>
          <p className="a-small a-muted">{MC.boardHidden}</p>
          {state.switches.lab ? (
            <RouteLink to={{ v: "models", x: "new", k: kind }} go={ctx.go} className="a-btn small">
              {MC.boardEmptyNew(routeName(kind))}
            </RouteLink>
          ) : null}
        </div>
      ) : null}
      {board && rec ? <RecCallout rec={rec} route={kind} onUse={() => setSheet(rec.model)} /> : null}
      {board?.models.length ? (
        <>
          <div className="md-cards" aria-label={MC.boardLabel}>
            {models.map((m) => (
              <ModelCard key={m.model} m={m} route={kind} board={board} max={max} onUse={() => setSheet(m.model)} />
            ))}
          </div>
          {board.usage30 ? (
            <p className="a-small a-muted">
              {MC.monthNote} {month(board.usage30, kind).usd > 0 ? MC.last30(routeName(kind), usd(month(board.usage30, kind).usd)) : ""}
            </p>
          ) : null}
        </>
      ) : null}
      {sheet ? (
        <RouteSheet
          ctx={ctx}
          routeKey={kind}
          state={state}
          keys={keys}
          preset={sheet}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            onState();
            ctx.go({ v: "models", x: "routes" }, { replace: true });
          }}
        />
      ) : null}
    </section>
  );
}

/* ── מי כותב מה ── */

function RoutesTab({ ctx, state, onState }: { ctx: Ctx; state: ModelsState; onState: () => void }) {
  const [usage, setUsage] = useState<Board["usage30"]>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const keys = useKeys();
  useEffect(() => {
    let alive = true;
    void readBoard(ctx.group.id, "part")
      .then((b) => alive && setUsage(b.usage30))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id, state]);
  const known = KNOWN_KEYS as readonly string[];
  const inside = Object.keys(ROUTE_NAMES).filter((k) => !known.includes(k));
  const row = (k: string) => {
    const r = state.routes[k];
    const model = state.switches.routes ? (r?.model ?? DEFAULT_MODEL) : DEFAULT_MODEL;
    const p = projection({ key: k, model, today: model, usage });
    return (
      <li key={k}>
        <button type="button" className="a-li row-link md-route-row" onClick={() => setSheet(k)} aria-haspopup="dialog">
          <span className="md-route-name">
            <b>{routeName(k)}</b>
            <span className="a-small a-muted">
              {usage ? p.usd > 0 ? <><bdi dir="ltr">≈{usd(p.usd)}</bdi> {MC.perMonthShort}</> : "$0" : ""}
              {usage && p.rough && p.usd > 0 ? ` · ${MC.rough}` : ""}
            </span>
          </span>
          <span className="md-route-model">
            <ModelName id={model} />
            <span className={`a-chip${r ? " ok" : ""}`}>{r ? MC.chipChanged(dayOf(r.set_at)) : MC.chipDefault}</span>
          </span>
        </button>
      </li>
    );
  };
  return (
    <section className="a-stack md-routes">
      {!state.switches.routes ? (
        <p className="a-callout warn" role="status">
          {MC.routesOff}
        </p>
      ) : (
        <p className="a-small a-muted">{MC.routesLead}</p>
      )}
      <ul className="a-list md-route-list">{known.map(row)}</ul>
      <details className="md-fold">
        <summary>{MC.inside}</summary>
        <ul className="a-list md-route-list">{inside.map(row)}</ul>
      </details>
      <ProvidersBlock ctx={ctx} state={state} keys={keys} onChange={onState} />
      {sheet ? (
        <RouteSheet
          ctx={ctx}
          routeKey={sheet}
          state={state}
          keys={keys}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            onState();
          }}
        />
      ) : null}
    </section>
  );
}
