import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MODEL, modelInfo } from "../../../shared/study/models";
import type { ScreenProps } from "../features/types";
import { FIRST_MODELS, LAB_KINDS, offered, preselect, price, readState, savedPick, savePick, startRun, totalOf, type ModelsState, type Price } from "../lib/models";
import { MC, modelsFail, ROUTE_SUBLINE, routeName, usd } from "../lib/modelsCopy";
import "../styles/models.css";
import { BudgetLine, ModelName, useKeys } from "./ModelsParts";
import { BackLink, Head, Loading, StickyActions, useOnline } from "./Shell";

/* ── ?v=models&x=new[&k=<kind>]: "השוואה חדשה" (design-models §5.3) ──
 * Three short steps, filled in: the kind (the ones with an answer key now),
 * its material (read on the server as the run will read it, with each
 * model's worst case on it: the op's "price", nothing reserved), and 2 to 4
 * models (today's model and the kind's candidate picked; the newest four
 * first, the older ones folded). The button says the run's worst case; a
 * run over the cap, over what is left of the month's line, past today's
 * runs, offline or with the switch off cannot start, and says why. */

export default function ModelsNewScreen({ route, ctx }: ScreenProps<"models">) {
  const kind = route.k && (LAB_KINDS as readonly string[]).includes(route.k) ? route.k : "solver";
  const [state, setState] = useState<ModelsState | null>(null);
  const [failed, setFailed] = useState("");
  const [quote, setQuote] = useState<Price | null>(null);
  const [quoteFail, setQuoteFail] = useState<Record<string, string>>({});
  const [again, setAgain] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const online = useOnline();
  const keys = useKeys();

  useEffect(() => {
    void readState(ctx.group.id)
      .then(setState)
      .catch((e: unknown) => setFailed(modelsFail(e instanceof Error ? e.message : "")));
  }, [ctx.group.id]);
  const today = state?.routes[kind]?.model ?? DEFAULT_MODEL;
  const models = useMemo(() => (state ? offered({ providers: state.providers, keys }) : []), [state, keys]);
  // The models offered, as one string: a new array with the same models asks for no new price.
  const ids = models.map((m) => m.id).join(",");

  useEffect(() => {
    if (!state) return;
    let alive = true;
    setQuote(null);
    setError("");
    const saved = savedPick(kind)?.filter((id) => ids.split(",").includes(id));
    setPicked(saved && saved.length >= 2 ? saved : preselect(kind, today));
    void price(ctx.group.id, kind, ids.split(","))
      .then((p) => {
        if (!alive) return;
        setQuote(p);
        setQuoteFail((f) => ({ ...f, [kind]: "" }));
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const code = e instanceof Error ? e.message : "";
        setQuoteFail((f) => ({ ...f, [kind]: code === "no material" ? (MC.noMaterial[kind] ?? modelsFail(code)) : modelsFail(code) }));
      });
    return () => {
      alive = false;
    };
    // `again`: the question check's "שאלות אחרות" picks them again.
  }, [ctx.group.id, kind, state, ids, today, again]);

  const back = <BackLink go={ctx.go} fallback={{ v: "models" }} />;
  if (!state) {
    return failed ? (
      <main className="md-screen">
        <Head back={back} title={MC.newTitle} />
        <p className="a-error">{failed}</p>
      </main>
    ) : (
      <Loading />
    );
  }

  const usable = quote ? models.filter((m) => quote.models[m.id]?.usd !== undefined) : models;
  const first = usable.filter((m) => FIRST_MODELS.includes(m.id) || picked.includes(m.id) || m.id === today);
  const rest = usable.filter((m) => !first.includes(m));
  const shown = more ? usable : first;
  const total = quote ? totalOf(picked, quote.models) : 0;
  const left = Math.max(0, state.lab.line_usd - state.lab.spent_usd);
  const cap = quote?.runCap ?? state.lab.run_cap;
  const dailyDone = state.lab.runs_today >= state.lab.daily_runs;
  const noMaterial = quoteFail[kind];
  const why = !state.switches.lab
    ? MC.off
    : !online
      ? MC.offline
      : dailyDone
        ? MC.dailyDone(state.lab.runs_today)
        : picked.length < 2
          ? MC.pickTwo
          : picked.length > 4
            ? MC.pickMax
            : quote && total > cap
              ? MC.overCap(usd(total), usd(cap))
              : quote && total > left
                ? MC.overLine(usd(left))
                : "";
  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    savePick(kind, next);
  };
  const go = async () => {
    if (!quote || why || busy) return;
    setBusy(true);
    setError("");
    try {
      const run = await startRun({ group: ctx.group.id, route: kind, models: picked, source: quote.source });
      ctx.go({ v: "models", r: run }, { replace: true });
    } catch (e) {
      setError(modelsFail(e instanceof Error ? e.message : ""));
      setBusy(false);
    }
  };

  return (
    <main className="md-screen md-new">
      <Head back={back} title={MC.newTitle} />
      <BudgetLine state={state} />

      <section className="a-stack md-step" aria-labelledby="md-s1">
        <h2 id="md-s1" className="md-step-h">
          <span className="md-step-n" aria-hidden="true">
            1
          </span>
          {MC.step1}
        </h2>
        <div className="a-wrap md-kinds" role="radiogroup" aria-labelledby="md-s1">
          {LAB_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={k === kind}
              aria-disabled={Boolean(quoteFail[k]) && k !== kind}
              className={`a-chip md-kind${k === kind ? " on" : ""}`}
              onClick={() => ctx.go({ v: "models", x: "new", k }, { replace: true })}
            >
              {routeName(k)}
            </button>
          ))}
        </div>
        {ROUTE_SUBLINE[kind] ? <p className="a-small a-muted">{ROUTE_SUBLINE[kind]}</p> : null}
      </section>

      <section className="a-stack md-step" aria-labelledby="md-s2">
        <h2 id="md-s2" className="md-step-h">
          <span className="md-step-n" aria-hidden="true">
            2
          </span>
          {MC.step2}
        </h2>
        {noMaterial ? (
          <p className="a-callout warn md-no-material" role="status">
            {noMaterial}
          </p>
        ) : !quote ? (
          <p className="a-small a-muted" role="status">
            {MC.pricing}
          </p>
        ) : (
          <div className="a-card flat md-material">
            <p>{quote.title.split(" · ").slice(1).join(" · ") || quote.title}</p>
            {kind === "solver" ? (
              <button type="button" className="a-link" onClick={() => setAgain((n) => n + 1)}>
                {MC.againRandom}
              </button>
            ) : null}
          </div>
        )}
      </section>

      <section className="a-stack md-step" aria-labelledby="md-s3">
        <h2 id="md-s3" className="md-step-h">
          <span className="md-step-n" aria-hidden="true">
            3
          </span>
          {MC.step3}
        </h2>
        <fieldset className="md-pick" aria-labelledby="md-s3" disabled={Boolean(noMaterial)}>
          <ul className="a-list">
            {shown.map((m) => {
              const est = quote?.models[m.id]?.usd;
              const on = picked.includes(m.id);
              return (
                <li key={m.id}>
                  <label className={`a-li md-check${on ? " on" : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(m.id)} />
                    <span className="md-check-name">
                      <ModelName id={m.id} />
                      {m.id === today ? <span className="a-chip ok">{MC.tagToday}</span> : null}
                      {!m.verified ? <span className="a-chip warn">{MC.tagUnverified}</span> : null}
                      {m.expensive ? <span className="a-chip warn">{MC.tagExpensive}</span> : null}
                    </span>
                    <span className="md-check-usd a-small">{est !== undefined ? `≈${usd(est)}` : quote ? "" : "…"}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        {rest.length ? (
          <button type="button" className="a-link" onClick={() => setMore(!more)} aria-expanded={more}>
            {more ? MC.fewerModels : MC.moreModels(rest.length)}
          </button>
        ) : null}
        {models.every((m) => modelInfo(m.id)?.provider === "anthropic") ? <p className="a-small a-muted">{MC.otherProviders}</p> : null}
        {quote ? <p className="a-small a-muted">{MC.priceNote}</p> : null}
      </section>

      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      <StickyActions>
        <div className="md-run-foot-bar">
          <button type="button" className="a-btn primary wide" disabled={!quote || Boolean(why) || busy || Boolean(noMaterial)} onClick={() => void go()}>
            {busy ? MC.starting : MC.runButton(usd(total))}
          </button>
          <p className="a-small md-why" role="status">
            {why && !noMaterial ? why : MC.left(usd(left))}
          </p>
        </div>
      </StickyActions>
    </main>
  );
}
