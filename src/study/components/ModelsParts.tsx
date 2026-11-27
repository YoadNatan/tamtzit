import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ALL_MODELS, DEFAULT_MODEL, labelOf, modelInfo } from "../../../shared/study/models";
import type { Ctx } from "../features/types";
import { flags } from "../lib/flags";
import {
  checkedOf,
  FIRST_MODELS,
  isOwner,
  KEYED_KINDS,
  listRuns,
  nextPrice,
  priceFactor,
  projection,
  PROVIDERS,
  providersSet,
  qualityOf,
  readBoard,
  routable,
  setProvider,
  setRoute,
  staleDate,
  times,
  todoCount,
  tooFew,
  type Board,
  type BoardModel,
  type Checks,
  type ModelsState,
  type Recommendation,
} from "../lib/models";
import { iso, MC, modelsFail, routeName, usd } from "../lib/modelsCopy";
import "../styles/models.css";
import { RouteLink, Sheet } from "./Shell";

/* ── "השוואת מודלים": the parts the screens share (docs/study/models.md) ──
 * The row on "שלי", the budget line, a label's circle, an answer's checks,
 * the side-by-side bars of quality and price, a model's results card, the
 * route sheet of "מי כותב מה" and the providers' block. A lazy module
 * (tools/study-bundle.mjs, package Y): Me and the screens load it. Model
 * names are never translated and sit in <bdi dir="ltr">. */

/** A model's name, left to right inside the Hebrew line. */
export const ModelName = ({ id }: { id: string }) => (
  <bdi dir="ltr" className="md-name">
    {labelOf(id)}
  </bdi>
);

/** A blind answer's label (א-ד) in its circle. */
export const LabelDot = ({ label }: { label: string }) => (
  <span className="md-dot" aria-hidden="true">
    {label}
  </span>
);

/* ── "שלי" ── */

/** "השוואת מודלים" for the owner; "השוואות לדירוג · {n} מחכות" for anyone while runs wait (no badge, no dot). */
export function ModelsRows({ ctx }: { ctx: Ctx }) {
  const [owner, setOwner] = useState(false);
  const [todo, setTodo] = useState(0);
  const [oldest, setOldest] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void isOwner(ctx.group.id)
      .then((o) => alive && setOwner(o))
      .catch(() => undefined);
    void todoCount(ctx.group.id)
      .then((n) => {
        if (!alive) return;
        setTodo(n);
        // The row opens the oldest run waiting for the caller's rating directly (design-models §5.1).
        if (n > 0)
          void listRuns(ctx.group.id)
            .then((rows) => {
              const wait = rows.filter((r) => r.mine === "todo" && r.member_rate);
              if (alive && wait.length) setOldest(wait[wait.length - 1].id);
            })
            .catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  if (!flags.models || (!owner && todo === 0)) return null;
  return (
    <nav className="a-list links-card md-me" aria-label={MC.title}>
      {owner ? (
        <RouteLink to={{ v: "models" }} go={ctx.go} className="a-li row-link md-me-row">
          <div>
            <b>{MC.ownerRow}</b>
            <div className="a-small a-muted">{MC.ownerSub}</div>
          </div>
        </RouteLink>
      ) : null}
      {todo > 0 ? (
        <RouteLink to={oldest ? { v: "models", r: oldest } : { v: "models" }} go={ctx.go} className="a-li row-link md-me-row">
          <div>
            <b>{MC.todoRow(todo)}</b>
            <div className="a-small a-muted">{MC.todoSub}</div>
          </div>
        </RouteLink>
      ) : null}
    </nav>
  );
}

/* ── The month's line ── */

/** "השוואות החודש: $0.84 מתוך $3.30 · עוד 2 היום", with its bar. */
export function BudgetLine({ state }: { state: ModelsState }) {
  const { spent_usd: spent, line_usd: line, runs_today: today, daily_runs: daily } = state.lab;
  const left = Math.max(0, daily - today);
  const pct = line > 0 ? Math.min(100, Math.round((spent / line) * 100)) : 0;
  return (
    <div className="md-budget">
      <p className="a-small">{MC.budget(usd(spent), usd(line), left)}</p>
      <div className="a-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={MC.budgetAria(usd(spent), usd(line))}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── An answer's automatic checks ($0, the server's checksFor) ── */

/** The chips of an answer's checks, in words (C29): the match with the key, false rejects, the group's decision, the copy. */
export function checkChips(route: string, c: Checks | undefined, checkStatus?: string): Array<{ text: string; tone: "ok" | "warn" | "bad" | "" }> {
  if (!c || Object.keys(c).length === 0) return [];
  const out: Array<{ text: string; tone: "ok" | "warn" | "bad" | "" }> = [];
  const items = Number(c.items) || 0;
  const match = Number(c.match) || 0;
  const n = (k: string) => Number(c[k]) || 0;
  const share = (a: number, b: number): "ok" | "warn" | "bad" => (a === b ? "ok" : b > 0 && a / b >= 0.8 ? "warn" : "bad");
  if (c.pass === false && match === 0 && route !== "ask" && route !== "part") out.push({ text: MC.checks.unreadable, tone: "bad" });
  // The kinds members rate: production's own checks, and practice's paid check (the solver).
  if (route === "practice" || route === "set_write" || route === "points" || route === "cards") {
    if (items > 0) out.push({ text: (route === "points" ? MC.checks.points : route === "cards" ? MC.checks.cards : MC.checks.questions)(match, items), tone: share(match, items) });
    if (route === "points" && n("red") > 0) out.push({ text: MC.checks.red(n("red")), tone: "" });
    if ("solved" in c) out.push(n("solver_differs") > 0 ? { text: MC.checks.solverDiffers(n("solver_differs")), tone: "warn" } : { text: MC.checks.solverAgrees, tone: "ok" });
    else if (checkStatus === "pending") out.push({ text: MC.checks.pending, tone: "" });
    else if (checkStatus === "running") out.push({ text: MC.checks.running, tone: "" });
    return out;
  }
  if (route === "ask" || route === "part") {
    const tags = route === "part" ? match : n("tags");
    out.push(tags > 0 ? { text: MC.checks.tags(tags), tone: "ok" } : { text: MC.checks.noTags, tone: "warn" });
    if (n("bad") > 0) out.push({ text: MC.checks.badTags(n("bad")), tone: "bad" });
    if (route === "part" && n("numbers_of") > 0) out.push({ text: MC.checks.numbers(n("numbers"), n("numbers_of")), tone: share(n("numbers"), n("numbers_of")) });
    return out;
  }
  if (route === "fix_check") {
    if (c.pass !== false) out.push(c.agrees ? { text: MC.checks.agrees, tone: "ok" } : { text: MC.checks.disagrees, tone: "bad" });
    return out;
  }
  if (items > 0) {
    const all = match === items;
    out.push({ text: route === "exam_read" || route === "sheet_read" ? MC.checks.copied(match, items) : MC.checks.match(match, items), tone: all ? "ok" : match / items >= 0.8 ? "warn" : "bad" });
  }
  const fr = Number(c.false_rejects) || 0;
  if (route === "solver" && fr > 0) out.push({ text: MC.checks.falseRejects(fr), tone: "warn" });
  const missing = Number(c.missing) || 0;
  if (missing > 0) out.push({ text: MC.checks.missing(missing), tone: "warn" });
  return out;
}

export function ChecksLine({ route, checks, checkStatus }: { route: string; checks: Checks | undefined; checkStatus?: string }) {
  const chips = checkChips(route, checks, checkStatus);
  if (!chips.length) return null;
  return (
    <div className="a-wrap md-checks">
      {chips.map((c) => (
        <span key={c.text} className={`a-chip${c.tone ? ` ${c.tone}` : ""}`}>
          {c.text}
        </span>
      ))}
    </div>
  );
}

/* ── Quality against price, side by side ── */

/** Two bars on one row: quality (of 100) and price (against the dearest shown), each with its figure. */
export function QualityPrice({ quality, qualityText, price, priceText, max, small }: { quality: number | null; qualityText: string; price: number; priceText: string; max: number; small?: boolean }) {
  const q = quality === null ? 0 : Math.round(quality * 100);
  const p = max > 0 ? Math.max(3, Math.round((price / max) * 100)) : 0;
  return (
    <div className="md-qp">
      <div className="md-qp-cell">
        <span className="a-small a-muted">{MC.quality}</span>
        <div className="a-bar md-q" role="img" aria-label={`${MC.quality}: ${qualityText}`}>
          <i style={{ width: `${q}%` }} />
        </div>
        <b className="md-qp-n">
          {qualityText}
          {small ? <span className="a-chip warn md-small">{MC.small}</span> : null}
        </b>
      </div>
      <div className="md-qp-cell">
        <span className="a-small a-muted">{MC.price}</span>
        <div className="a-bar md-p" role="img" aria-label={`${MC.price}: ${priceText}`}>
          <i style={{ width: `${p}%` }} />
        </div>
        <b className="md-qp-n">{priceText}</b>
      </div>
    </div>
  );
}

/* ── The results of a kind: one card a model ── */

/** `onUse` offers "להשתמש בו ל״…״"; `noUse` says instead why production cannot take the model (routable). */
export function ModelCard({ m, route, board, max, onUse, noUse }: { m: BoardModel; route: string; board: Board; max: number; onUse?: () => void; noUse?: string }) {
  const { q, n } = qualityOf(m, route);
  const keyed = KEYED_KINDS.has(route);
  const p = projection({ key: route, model: m.model, today: board.today, usage: board.usage30, board: board.models });
  const qText = q === null ? "—" : keyed ? `${Math.round(q * 100)}% · ${MC.items(n)}` : `${((m.score ?? 0) as number).toFixed(1)}/5 · ${MC.runsN(n)}`;
  const monthly = board.usage30 ? p.usd : (m.mean_usd ?? 0);
  return (
    <article className={`a-card md-model${m.today ? " today" : ""}`} aria-label={labelOf(m.model)}>
      <header className="a-row between">
        <h3 className="md-model-name">
          <ModelName id={m.model} />
        </h3>
        {m.today ? <span className="a-chip ok">{MC.tagToday}</span> : null}
      </header>
      <QualityPrice
        quality={q}
        qualityText={qText}
        price={monthly}
        priceText={board.usage30 ? `${usd(p.usd)} ${MC.col.perMonth}${p.rough ? ` · ${MC.rough}` : ""}` : `${usd(m.mean_usd)} ${MC.col.perCall}`}
        max={max}
        small={tooFew(route, m)}
      />
      <dl className="md-facts a-small">
        <div>
          <dt>{MC.col.perCall}</dt>
          <dd>{usd(m.mean_usd)}</dd>
        </div>
        <div>
          <dt>{MC.col.refusals}</dt>
          <dd>{m.answers ? `${m.refused}/${m.answers}` : "—"}</dd>
        </div>
        {route === "solver" ? (
          <div>
            <dt>{MC.col.falseRejects}</dt>
            <dd>{m.false_rejects}</dd>
          </div>
        ) : null}
        {!keyed ? (
          <div>
            <dt>{MC.col.flags}</dt>
            <dd>{m.flags}</dd>
          </div>
        ) : null}
        <div>
          <dt>{MC.col.runs}</dt>
          <dd>{m.runs}</dd>
        </div>
        {m.p50_ms ? (
          <div>
            <dt>{MC.col.speed}</dt>
            <dd>{MC.seconds(Math.round(m.p50_ms / 1000))}</dd>
          </div>
        ) : null}
      </dl>
      {tooFew(route, m) ? <p className="a-small a-muted">{keyed ? MC.tooFewItems(m.items, 20) : MC.tooFew(m.runs)}</p> : null}
      {!m.today && noUse ? (
        <span className="a-chip md-unroutable">{noUse}</span>
      ) : onUse && !m.today ? (
        <button type="button" className="a-btn small" onClick={onUse}>
          {MC.use(routeName(route))}
        </button>
      ) : null}
    </article>
  );
}

/** The recommendation's callout (C34, C34b) and its button. */
export function RecCallout({ rec, route, onUse }: { rec: Recommendation; route: string; onUse: () => void }) {
  const name = iso(labelOf(rec.model));
  return (
    <aside className="a-callout md-rec" aria-label={MC.use(routeName(route))}>
      <p>
        {rec.keyed ? MC.recKey(name, times(rec.times), rec.a, rec.n, rec.b) : MC.recRated(name, times(rec.times), rec.a, rec.b)}
        {rec.small ? <span className="a-chip warn md-small">{MC.small}</span> : null}
      </p>
      <button type="button" className="a-btn primary small" onClick={onUse}>
        {MC.use(routeName(route))}
      </button>
    </aside>
  );
}

/* ── "מי כותב מה": the route sheet ── */

/** The models a key may take, the newest four first; the current one always shown. */
function routeChoices(key: string, state: ModelsState, keys: Record<string, boolean> | null): string[] {
  const ok = ALL_MODELS.filter((m) => routable(key, m, { providers: state.providers, keys })).map((m) => m.id);
  return ok;
}

export function RouteSheet({
  ctx,
  routeKey,
  state,
  keys,
  preset,
  onClose,
  onDone,
  onUndo,
}: {
  ctx: Ctx;
  routeKey: string;
  state: ModelsState;
  keys: Record<string, boolean> | null;
  preset?: string;
  onClose: () => void;
  onDone: () => void;
  /** After "ביטול" on the toast put the old route back: read the state again. */
  onUndo?: () => void;
}) {
  const name = routeName(routeKey);
  const current = state.routes[routeKey]?.model ?? DEFAULT_MODEL;
  const [board, setBoard] = useState<Board | null>(null);
  const choices = useMemo(() => routeChoices(routeKey, state, keys), [routeKey, state, keys]);
  // A preset production cannot take (not in the list) is ignored: the sheet opens on today's model.
  const [pick, setPick] = useState(preset && choices.includes(preset) ? preset : current);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void readBoard(ctx.group.id, routeKey)
      .then((b) => alive && setBoard(b))
      .catch(() => alive && setBoard({ route: routeKey, today: current, models: [], usage30: null }));
    return () => {
      alive = false;
    };
  }, [ctx.group.id, routeKey, current]);
  const first = choices.filter((id) => FIRST_MODELS.includes(id) || id === current || id === pick);
  const shown = more ? choices : first;
  const proj = (id: string) => projection({ key: routeKey, model: id, today: current, usage: board?.usage30 ?? null, board: board?.models });
  const now = proj(current);
  const chosen = proj(pick);
  const info = modelInfo(pick);
  const expensive = Boolean(info?.expensive) && pick !== current;
  const ratio = now.usd > 0 ? chosen.usd / now.usd : 0;
  const next = nextPrice(pick);
  const apply = async (model: string | null, confirmExpensive = false) => {
    setBusy(true);
    setError("");
    try {
      // One tap back to the model the kind had before (OD10), not only to the default.
      const prev = state.routes[routeKey]?.model ?? null;
      await setRoute(ctx.group.id, routeKey, model, confirmExpensive);
      ctx.say(model ? MC.changed(name) : MC.backSay(name), {
        label: MC.undo,
        run: () =>
          void setRoute(ctx.group.id, routeKey, prev, true)
            .then(() => onUndo?.())
            .catch((e: unknown) => ctx.say(modelsFail(e instanceof Error ? e.message : ""))),
      });
      onDone();
    } catch (e) {
      setError(modelsFail(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet label={MC.sheetTitle(name)} head={<h2 className="a-h2">{MC.sheetTitle(name)}</h2>} onClose={onClose} className="md-sheet">
      <p className="a-small a-muted">{MC.sheetLead}</p>
      <fieldset className="md-radios">
        <legend className="a-small">{MC.sheetTitle(name)}</legend>
        {shown.map((id) => {
          const p = proj(id);
          return (
            <label key={id} className={`a-li md-radio${id === pick ? " on" : ""}`}>
              <input type="radio" name="md-route" value={id} checked={id === pick} onChange={() => setPick(id)} />
              <span className="md-radio-name">
                <ModelName id={id} />
                {id === current ? <span className="a-chip ok">{MC.tagToday}</span> : null}
                {modelInfo(id)?.expensive ? <span className="a-chip warn">{MC.tagExpensive}</span> : null}
              </span>
              <span className="md-radio-usd a-small">
                {board ? (
                  <>
                    <bdi dir="ltr">≈{usd(p.usd)}</bdi> {MC.perMonthShort}
                  </>
                ) : (
                  "…"
                )}
                {board && p.rough ? <span className="a-muted"> · {MC.rough}</span> : null}
              </span>
            </label>
          );
        })}
      </fieldset>
      {choices.length > first.length ? (
        <button type="button" className="a-link" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? MC.fewerModels : MC.moreModels(choices.length - first.length)}
        </button>
      ) : null}
      {board && !board.models.length ? <p className="a-small a-muted">{MC.noBoard}</p> : null}
      {pick !== current ? (
        <div className="a-callout md-say" role="status">
          <p>{now.base > 0 ? MC.routeSay(name, iso(labelOf(pick)), usd(chosen.usd), usd(now.usd)) : MC.routeNoUse(name, iso(labelOf(pick)))}</p>
          {next ? <p className="a-small">{MC.nextPrice(next.split("-").reverse().join("."), iso(labelOf(pick)), usd(chosen.usd * priceFactor(pick, next)))}</p> : null}
          {routeKey === "part" || routeKey === "outline" ? <p className="a-small">{MC.summaries}</p> : null}
          {modelInfo(pick)?.provider !== "anthropic" ? <p className="a-small">{MC.otherProvider(name, PROVIDERS.find((x) => x.id === modelInfo(pick)?.provider)?.name ?? "")}</p> : null}
          {expensive ? <p className="a-small">{MC.expensive(iso(labelOf(pick)), times(ratio || 2), usd(chosen.usd))}</p> : null}
        </div>
      ) : null}
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="a-row md-sheet-actions">
        <button type="button" className="a-btn primary" disabled={busy || pick === current} onClick={() => void apply(pick, expensive)}>
          {expensive ? MC.changeAnyway : MC.change}
        </button>
        <button type="button" className="a-btn" onClick={onClose}>
          {MC.sheetNo}
        </button>
      </div>
      {state.routes[routeKey] ? (
        <button type="button" className="a-link md-back-default" disabled={busy} onClick={() => void apply(null)}>
          {MC.back}
        </button>
      ) : null}
    </Sheet>
  );
}

/* ── "מי כותב מה": providers ── */

export function ProvidersBlock({ ctx, state, keys, onChange }: { ctx: Ctx; state: ModelsState; keys: Record<string, boolean> | null; onChange: () => void }) {
  const [sheet, setSheet] = useState<{ kind: "key" | "approve"; id: string } | null>(null);
  const [scope, setScope] = useState<"all" | "text">("all");
  const [busy, setBusy] = useState(false);
  const any = PROVIDERS.some((p) => keys?.[p.id]);
  const set = async (id: string, allowed: boolean) => {
    setBusy(true);
    try {
      await setProvider(ctx.group.id, id, allowed, allowed ? scope : "all");
      onChange();
    } catch (e) {
      ctx.say(modelsFail(e instanceof Error ? e.message : ""));
    } finally {
      setBusy(false);
      setSheet(null);
    }
  };
  const rows = (
    <ul className="a-list md-providers">
      {PROVIDERS.map((p) => {
        const hasKey = keys?.[p.id] === true;
        const ok = state.providers[p.id]?.allowed === true;
        const checked = checkedOf(p.id);
        return (
          <li key={p.id} className="a-li md-provider">
            <div>
              <b>
                <bdi dir="ltr">{p.name}</bdi>
              </b>
              {unverifiedOf(p.id) ? (
                <div className="a-small md-stale">{MC.pricesUnchecked}</div>
              ) : checked ? (
                <div className={`a-small ${staleDate(checked) ? "md-stale" : "a-muted"}`}>{staleDate(checked) ? MC.stale : MC.pricesChecked(checked.split("-").reverse().join("."))}</div>
              ) : null}
            </div>
            <div className="a-wrap">
              {hasKey ? (
                <span className="a-chip ok">{MC.configured}</span>
              ) : (
                <button type="button" className="a-chip md-chip-btn" onClick={() => setSheet({ kind: "key", id: p.id })}>
                  {MC.noKey}
                </button>
              )}
              {hasKey ? (
                ok ? (
                  <>
                    <span className="a-chip ok">{MC.approved}</span>
                    {state.providers[p.id]?.scope === "text" ? <span className="a-chip">{MC.scopeTextChip}</span> : null}
                    <button type="button" className="a-link" disabled={busy} onClick={() => void set(p.id, false)}>
                      {MC.unapprove}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="a-btn small"
                    disabled={busy}
                    onClick={() => {
                      setScope("all");
                      setSheet({ kind: "approve", id: p.id });
                    }}
                  >
                    {MC.approve}
                  </button>
                )
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
  const p = PROVIDERS.find((x) => x.id === sheet?.id);
  return (
    <section className="a-stack md-provider-block" aria-labelledby="md-prov-h">
      <div className="a-sec">
        <h2 id="md-prov-h">{MC.providers}</h2>
      </div>
      {any ? (
        rows
      ) : (
        <details className="md-fold">
          <summary>{MC.onlyClaude}</summary>
          {rows}
        </details>
      )}
      {sheet && p ? (
        <Sheet label={sheet.kind === "key" ? MC.keyTitle(p.name) : MC.approveTitle(p.name)} head={<h2 className="a-h2">{sheet.kind === "key" ? MC.keyTitle(p.name) : MC.approveTitle(p.name)}</h2>} onClose={() => setSheet(null)}>
          {sheet.kind === "key" ? (
            <>
              {MC.keyLimit[p.id] ? <p>{MC.keyLimit[p.id]}</p> : null}
              <p>{MC.keyText(p.name, p.env)}</p>
              {unverifiedOf(p.id) ? <p className="a-small a-muted">{MC.keyPrices}</p> : null}
            </>
          ) : (
            <>
              <fieldset className="md-scope">
                <legend>{MC.scopeLegend}</legend>
                {(["all", "text"] as const).map((s) => (
                  <label key={s} className="md-scope-opt">
                    <input type="radio" name="md-scope" value={s} checked={scope === s} onChange={() => setScope(s)} />
                    <span>
                      <b>{s === "all" ? MC.scopeAll : MC.scopeText}</b>
                      <span className="a-small a-muted"> · {s === "all" ? MC.scopeAllSub : MC.scopeTextSub}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <p>{MC.approveText(p.name, scope)}</p>
              <div className="a-row md-sheet-actions">
                <button type="button" className="a-btn primary" disabled={busy} onClick={() => void set(p.id, true)}>
                  {MC.approveYes}
                </button>
                <button type="button" className="a-btn" onClick={() => setSheet(null)}>
                  {MC.sheetNo}
                </button>
              </div>
            </>
          )}
        </Sheet>
      ) : null}
    </section>
  );
}

/** Whether any of a provider's models has a price not yet checked on the vendor's page. */
const unverifiedOf = (provider: string): boolean => ALL_MODELS.some((m) => m.provider === provider && !m.verified);

/** Whether health says any provider's key is set (null: it did not answer). */
export function useKeys(): Record<string, boolean> | null {
  const [keys, setKeys] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let alive = true;
    void providersSet()
      .then((k) => alive && setKeys(k))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return keys;
}

/** A confirm in a sheet: the question, the yes and the no. */
export function Confirm({ label, text, yes, no, onYes, onClose, danger }: { label: string; text: ReactNode; yes: string; no: string; onYes: () => void; onClose: () => void; danger?: boolean }) {
  return (
    <Sheet label={label} head={<h2 className="a-h2">{label}</h2>} onClose={onClose}>
      {(s) => (
        <>
          <p>{text}</p>
          <div className="a-row md-sheet-actions">
            <button
              type="button"
              className={`a-btn ${danger ? "danger" : "primary"}`}
              onClick={() => {
                s.close();
                onYes();
              }}
            >
              {yes}
            </button>
            <button type="button" className="a-btn" onClick={s.close}>
              {no}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
