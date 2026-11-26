import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { STYLE_HE, type Options, type Style } from "../../../shared/study/practice2";
import type { Ctx, ScreenProps } from "../features/types";
import { lectureTitles } from "../lib/api";
import { flags } from "../lib/flags";
import { failCode, failText } from "../lib/failText";
import { BUDGET_CODES, blockOfCode, progressStep, readyDraft, roundSize, tilesOf, type Block, type TileState } from "../lib/make";
import {
  askPlan,
  createRequest,
  keepAll,
  listDrafts,
  listRequests,
  markMade,
  readPoints,
  readStyle,
  requestBatches,
  requestKey,
  useLocalRequest,
  watchBank,
  writable,
  writeRequest,
  writingSomewhere,
  type DraftRow,
  type Request,
  type RequestBatch,
} from "../lib/practice2";
import { requestStart } from "../lib/practiceSession";
import { useRound } from "../lib/rounds";
import { genBudgetStop, genCount, genFailed, genProgressSaid, genStart, genTileLabel, genTitle, SETS, slideWord } from "../lib/setsCopy";
import "../styles/sets.css";
import FailCode from "./FailCode";
import { BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";

/* ── "סט בהכנה" (practice sets, design §5.5; VITE_STUDY_MAKE) ──
 *
 * Two ways in. MakeJob: "ליצור" on "סט חדש" when the lecture must be read
 * first or an example was given: phase 0 reads them here (the points stream,
 * once for the whole group; the example with action "style", whose failure
 * only means the usual style), then creates the request and moves to the
 * second. The default export, ?v=practice&l=…&x=bank&r=<request>: the set
 * being written, from this phone (rounds.ts, which goes on outside the
 * screen) or another. A ring and one line ("6 מוכנות · עוד 4 בדרך"), the
 * button "להתחיל לפתור (6)" as soon as one is ready (it keeps the checked
 * questions, the existing keep-all, and starts a round of the lecture's new
 * questions), and "פרטים": a tile per question (בדרך · מוכנה · לא יצאה) and
 * the ready ones. A batch that failed offers "לנסות שוב"; a budget line
 * reached in the middle says so instead; offline, what is here stays. */

export type Job = {
  lectureId: string;
  title: string;
  /** The request's options, without the example's read (added here). */
  options: Options;
  /** The lecture's points are stale or were never read: read them first. */
  read: boolean;
  /** How many parts the read takes (the bar). */
  parts: number;
  example: { text?: string; image?: { mediaType: string; data: string } } | null;
};

const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));
const BLOCK_TEXT: Partial<Record<Block, string>> = {
  cap: SETS.make.cap,
  capMine: SETS.make.capMine,
  line: SETS.make.line,
  daily: SETS.make.daily,
  tooBig: SETS.make.tooBig,
  off: SETS.make.off,
  notReady: SETS.make.notReady,
  full: SETS.make.full,
};
/** A read another device holds: wait for it this long, asking every few seconds. */
const WAIT_MS = 6 * 60_000;
const POLL_MS = 4_000;
const STREAM_MS = 330_000;
const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  return online;
}

/** The ring: the share ready, the number in the middle (the words say it beside). */
function Ring({ ready, total }: { ready: number; total: number }) {
  const p = total ? Math.round((100 * ready) / total) : 0;
  return (
    <span className="a-ring mk-ring" style={{ "--p": `${p}%` } as CSSProperties} aria-hidden="true">
      <span>{ready}</span>
    </span>
  );
}

/* ─────────────────────────── phase 0 ─────────────────────────── */

/** Reads what must be read, then creates the request and opens it (replacing "סט חדש" in history). */
export function MakeJob({ ctx, job, onBack }: { ctx: Ctx; job: Job; onBack: () => void }) {
  const [step, setStep] = useState<"read" | "style" | "create" | "failed">(job.read ? "read" : job.example ? "style" : "create");
  const [done, setDone] = useState(0);
  const [elsewhere, setElsewhere] = useState(false);
  const [styleFailed, setStyleFailed] = useState(false);
  const [error, setError] = useState<{ text: string; code: string } | null>(null);
  const [runs, setRuns] = useState(0);
  const online = useOnline();
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  useEffect(() => {
    let style: Options["style"] | undefined;
    const fail = (code: string, raw?: unknown) => {
      if (!alive.current) return;
      const b = blockOfCode(code);
      setError({ text: b && BLOCK_TEXT[b] ? BLOCK_TEXT[b]! : code === "points stale" ? SETS.gen.readFail : code === "already making" ? SETS.err.alreadyMaking : failText(code, "practice"), code: b ? "" : failCode(raw ?? code, "practice") });
      setStep("failed");
    };
    const run = async () => {
      if (job.read) {
        setStep("read");
        setDone(0);
        const ctl = new AbortController();
        const cap = setTimeout(() => ctl.abort(), STREAM_MS);
        let code = "";
        try {
          await readPoints(job.lectureId, (line) => {
            if (alive.current && (line.t === "part" || line.t === "fail")) setDone((n) => n + 1);
          }, { signal: ctl.signal });
        } catch (e) {
          if (!ctl.signal.aborted) code = codeOf(e);
        } finally {
          clearTimeout(cap);
        }
        if (code && code !== "busy" && code !== "network") return fail(code);
        // Another phone reads it (busy), or the stream was lost: the database says when it is done.
        if (code === "busy") setElsewhere(true);
        const until = Date.now() + WAIT_MS;
        for (;;) {
          if (!alive.current) return;
          let plan;
          try {
            plan = await askPlan(job.lectureId);
          } catch (e) {
            const c = codeOf(e);
            if (c !== "network" || Date.now() > until) return fail(c, e);
            await pause(POLL_MS);
            continue;
          }
          if (!plan.points.busy && !plan.points.stale.length) break;
          if (!plan.points.busy || Date.now() > until) return fail("points stale");
          await pause(POLL_MS);
        }
      }
      if (job.example) {
        if (!alive.current) return;
        setStep("style");
        try {
          const a = await readStyle(job.lectureId, job.example);
          style = { description: a.description, example: a.example, sig: a.sig };
        } catch {
          // A failed or refused read: the usual style, and the screen says so.
          if (alive.current) setStyleFailed(true);
        }
      }
      if (!alive.current) return;
      setStep("create");
      try {
        // Slice B: the set is made once what had to be read was read (its page is ?v=sets&k=).
        const made = await createRequest(job.lectureId, { ...job.options, ...(style ? { style } : {}) }, flags.sets ? { set: { want: job.options.count ?? 10 } } : {});
        if (made.set && !made.request) {
          if (alive.current) ctx.go({ v: "sets", k: made.set.id }, { replace: true });
          return;
        }
        markMade(made.request.id);
        void writeRequest(job.lectureId, made.request.id, made.batches.map((b) => b.id)).catch(() => undefined);
        if (alive.current) ctx.go(made.set ? { v: "sets", k: made.set.id } : { v: "practice", l: job.lectureId, x: "bank", r: made.request.id }, { replace: true });
      } catch (e) {
        if (codeOf(e) === "already making") return fail("already making", e);
        fail(codeOf(e), e);
      }
    };
    void run();
  }, [runs]);

  const total = Math.max(1, job.parts);
  const reading = step === "read";
  return (
    <main className="make-progress">
      <Head
        back={
          <button type="button" className="back" onClick={onBack}>
            → {SETS.make.title}
          </button>
        }
        title={genTitle(job.title)}
      />
      <section className="mk-hero" aria-live="polite">
        <Ring ready={reading ? Math.min(done, total) : 0} total={reading ? total : 1} />
        <div className="mk-hero-t">
          <h2 className="a-h2">{step === "failed" ? SETS.gen.paused : reading ? (elsewhere ? SETS.gen.readingElsewhere : SETS.gen.reading) : step === "style" ? SETS.gen.styleRead : SETS.gen.starting}</h2>
          {reading ? (
            <div className="a-bar mk-read-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(done, total)} aria-label={SETS.gen.reading}>
              <i style={{ width: `${Math.round((100 * Math.min(done, total)) / total)}%` }} />
            </div>
          ) : null}
        </div>
      </section>
      {styleFailed ? (
        <p className="a-small mk-warn" role="status">
          {SETS.gen.styleFail}
        </p>
      ) : null}
      {!online ? (
        <p className="a-small mk-offline" role="status">
          {SETS.gen.offline} {SETS.gen.offlineGoesOn}
        </p>
      ) : null}
      <aside className="a-callout mk-keep">{SETS.gen.keepOpen}</aside>
      {error ? (
        <>
          <p className="a-error" role="alert">
            {error.text}
          </p>
          <FailCode code={error.code} />
        </>
      ) : null}
      {step === "failed" ? (
        <StickyActions>
          <button
            type="button"
            className="a-btn primary wide"
            onClick={() => {
              setError(null);
              setElsewhere(false);
              setStyleFailed(false);
              setRuns((n) => n + 1);
            }}
          >
            {SETS.make.retry}
          </button>
        </StickyActions>
      ) : null}
    </main>
  );
}

/* ─────────────────────────── the set being written ─────────────────────────── */

/** Slice B (VITE_STUDY_SETS): the set this request fills. Its page,
 *  ?v=sets&k=<set>, shows this screen while the set is made: "להתחיל לפתור"
 *  then solves the set (s=k.<set>), Back goes to the group's sets, another
 *  member's screen says who made it, and the page takes over once it is ready. */
export type ForSet = { id: string; by: string | null; onDone?: () => void };

export default function MakeProgress({ route, ctx, set }: ScreenProps<"practice"> & { set?: ForSet }) {
  const lectureId = route.l ?? "";
  const requestId = route.r ?? "";
  const [request, setRequest] = useState<Request | null>(null);
  const [batches, setBatches] = useState<RequestBatch[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [said, setSaid] = useState("");
  const local = useLocalRequest(requestId);
  const round = useRound(requestKey(requestId));
  const running = Boolean(round?.running);
  const online = useOnline();
  const wide = useWide();

  const batchesRef = useRef<RequestBatch[]>([]);
  const load = useCallback(async () => {
    const [all, bs, ds] = await Promise.all([listRequests(lectureId), requestBatches(requestId), listDrafts(requestId)]);
    const r = all.find((x) => x.id === requestId) ?? null;
    if (!r) return setPhase("none");
    setRequest(r);
    batchesRef.current = bs;
    setBatches(bs);
    setDrafts(ds);
    setNow(Date.now());
    setPhase("ready");
  }, [lectureId, requestId]);

  useEffect(() => {
    let alive = true;
    load().catch(() => alive && setPhase((p) => (p === "ready" ? p : "error")));
    lectureTitles([lectureId])
      .then((t) => alive && setTitle(t[lectureId] ?? ""))
      .catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchBank(lectureId, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load().catch(() => undefined), 250);
    });
    // Realtime can drop with no event, and a writer's six minutes pass with none: read again every 10 s.
    const poll = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) void load().catch(() => undefined);
    }, 10_000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(poll);
      stop();
    };
  }, [lectureId, load]);
  useEffect(() => {
    if (round && !round.running) void load().catch(() => undefined);
  }, [round?.running]);
  // Back online: read again, and when this phone was writing the set and its
  // round stopped meanwhile (a part lost to the connection), write on.
  const wasOff = useRef(false);
  useEffect(() => {
    if (!online) {
      wasOff.current = true;
      return;
    }
    if (!wasOff.current) return;
    wasOff.current = false;
    void load()
      .then(() => {
        const r = roundRef.current;
        if (r && !r.running) resumeRef.current();
      })
      .catch(() => undefined);
  }, [online]);

  const t = useMemo(() => tilesOf(batches, drafts), [batches, drafts]);
  const total = t.tiles.length;
  const readyList = useMemo(() => drafts.filter(readyDraft), [drafts]);
  const failedBatches = batches.filter((b) => b.status === "failed");
  const budgetCode = local.error && BUDGET_CODES.has(local.error) ? local.error : failedBatches.find((b) => b.error && BUDGET_CODES.has(b.error))?.error ?? null;
  const canWrite = !running && batches.some((b) => writable(b, now)) && (failedBatches.length > 0 || !writingSomewhere(batches, now));
  const paused = !running && t.coming > 0 && canWrite && !failedBatches.length;
  const mine = request?.created_by === ctx.userId;
  const done = total > 0 && t.coming === 0;

  // The live region: the first ready question, each quarter, the end.
  const lastStep = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "ready") return;
    const s = progressStep(t.ready, total);
    if (lastStep.current === null) {
      lastStep.current = s;
      return;
    }
    if (s > lastStep.current) setSaid(s === 4 ? `${SETS.gen.done}. ${genCount(t.ready, 0)}` : genProgressSaid(t.ready, total));
    lastStep.current = s;
  }, [t.ready, total, phase]);

  const resume = () => {
    if (!request) return;
    const ids = batchesRef.current.filter((b) => writable(b, Date.now())).map((b) => b.id);
    if (ids.length) void writeRequest(lectureId, request.id, ids).catch(() => undefined);
  };
  const roundRef = useRef(round);
  roundRef.current = round;
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  const start = async () => {
    if (!request || starting || t.ready < 1) return;
    setStarting(true);
    setStartError("");
    try {
      // The checked questions enter the group's bank with one tap (D3), then a round of the lecture's new ones.
      if (drafts.some((d) => d.status === "pending" && readyDraft(d))) await keepAll(request.id);
      if (set) {
        // A set: its own questions, in its order (questions ready later join the round, "להוסיף לסט").
        const r = { v: "practice" as const, s: `k.${set.id}` };
        requestStart(ctx.userId, r, false);
        ctx.go(r);
        return;
      }
      const r = { v: "practice" as const, l: lectureId, s: `l.${lectureId}`, n: roundSize(t.ready) };
      requestStart(ctx.userId, r, false, { sources: ["new"], parts: request.parts });
      ctx.go(r);
    } catch (e) {
      setStartError(failText(codeOf(e), "practice"));
      setStarting(false);
    }
  };

  // A set's page takes over once nothing is being written any more.
  const doneOnce = useRef(false);
  useEffect(() => {
    if (!set?.onDone || !done || running || doneOnce.current) return;
    doneOnce.current = true;
    set.onDone();
  }, [done, running, set]);
  const head = (
    <>
      <Head back={<BackLink go={ctx.go} fallback={set ? { v: "sets" } : { v: "practice", l: lectureId }} />} title={genTitle(title)} />
      {set?.by && !mine ? <p className="a-small a-muted mk-by">{set.by}</p> : null}
    </>
  );
  if (phase === "loading") return <Loading />;
  if (phase === "none" || phase === "error") {
    return (
      <main className="make-progress">
        {head}
        <p className={phase === "error" ? "a-error" : "a-muted"} role={phase === "error" ? "alert" : undefined}>
          {phase === "error" ? SETS.gen.loadFail : SETS.gen.notFound}
        </p>
        {phase === "error" ? (
          <button type="button" className="a-btn" onClick={() => void load().catch(() => setPhase("error"))}>
            {SETS.make.retry}
          </button>
        ) : (
          <RouteLink to={{ v: "practice", l: lectureId, x: "new" }} go={ctx.go} className="a-btn">
            {SETS.entry}
          </RouteLink>
        )}
      </main>
    );
  }

  const stem = (d: DraftRow) => {
    const text = `${d.vignette ? `${d.vignette} ` : ""}${d.question}`.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  };

  return (
    <main className="make-progress">
      {head}
      {running ? <aside className="a-callout mk-keep">{SETS.gen.keepOpen}</aside> : null}

      <div className="mk-pgrid">
        <div className="mk-pstart">
          <section className="mk-hero">
            <Ring ready={t.ready} total={total} />
            <div className="mk-hero-t">
              <h2 className="a-h2 mk-count">{genCount(t.ready, t.coming)}</h2>
              {done && !t.failed ? <p className="a-small a-muted">{SETS.gen.done}</p> : null}
            </div>
          </section>
          <p className="sr-only" role="status" aria-live="polite">
            {said}
          </p>

          {!online ? (
            <p className="a-small mk-offline" role="status">
              {SETS.gen.offline}
              {t.coming ? ` ${SETS.gen.offlineGoesOn}` : ""}
            </p>
          ) : null}
          {budgetCode ? (
            <div className="a-callout warn mk-budget" role="status">
              <b>{genBudgetStop(t.ready)}</b>
              <p className="a-small">{BLOCK_TEXT[blockOfCode(budgetCode) ?? "cap"] ?? SETS.make.cap}</p>
            </div>
          ) : t.failed > 0 && done ? (
            <div className="a-row mk-failed" role="status">
              <span>{genFailed(t.failed)}</span>
              {canWrite && online ? (
                <button type="button" className="a-btn" onClick={resume}>
                  {SETS.make.retry}
                </button>
              ) : null}
            </div>
          ) : paused ? (
            <div className="a-callout mk-paused" role="status">
              <b>{SETS.gen.paused}</b>
              <div className="a-row">
                <button type="button" className="a-btn" onClick={resume} disabled={!online}>
                  {SETS.gen.resume}
                </button>
                {mine ? null : <span className="a-small a-muted">{SETS.gen.resumeCost}</span>}
              </div>
            </div>
          ) : null}

          <details className="mk-details" open={wide || undefined}>
            <summary>{SETS.gen.details}</summary>
            <ul className="mk-qtiles" role="list" aria-label={SETS.gen.details}>
              {t.tiles.map((s: TileState, i) => (
                <li key={i} data-s={s} aria-label={genTileLabel(i + 1, s)}>
                  <span aria-hidden="true">{s === "ready" ? "✓" : s === "failed" ? "✕" : "•"}</span>
                </li>
              ))}
            </ul>
            <p className="a-small a-muted mk-qlegend" aria-hidden="true">
              <span data-s="ready">✓ {SETS.gen.tile.ready}</span>
              <span data-s="coming">• {SETS.gen.tile.coming}</span>
              <span data-s="failed">✕ {SETS.gen.tile.failed}</span>
            </p>
          </details>
        </div>

        <section className="mk-pend" aria-labelledby="mk-ready-h">
          <h3 id="mk-ready-h" className="a-small mk-ready-h">
            {SETS.gen.readyList}
          </h3>
          {readyList.length ? (
            <ul className="a-list mk-ready">
              {readyList.map((d) => (
                <li key={d.id} className="a-li">
                  <div>
                    <span className="m">{STYLE_HE[d.style as Style] ?? d.style}</span>
                    <span dir="rtl" className="mk-stem">
                      {stem(d)}
                    </span>
                  </div>
                  {d.slides.length ? <span className="a-small a-muted mk-slide">{slideWord(Math.min(...d.slides))}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="a-small a-muted">{SETS.gen.readyNone}</p>
          )}
          <RouteLink to={{ v: "practice", l: lectureId, x: "review", r: requestId }} go={ctx.go} className="a-small a-link mk-review">
            {SETS.gen.review} ‹
          </RouteLink>
        </section>
      </div>

      {startError ? (
        <p className="a-error" role="alert">
          {startError}
        </p>
      ) : null}
      <StickyActions>
        <div className="mk-start-wrap">
          <button type="button" className="a-btn primary wide mk-start-btn" disabled={t.ready < 1 || starting} onClick={() => void start()}>
            {genStart(t.ready)}
          </button>
          <p className="a-small a-muted mk-start-note">{SETS.gen.startNote}</p>
        </div>
      </StickyActions>
    </main>
  );
}

/** From 1024 px the details are open (design §5.9). */
function useWide(): boolean {
  const [wide] = useState(() => {
    try {
      return matchMedia("(min-width: 1024px)").matches;
    } catch {
      return false;
    }
  });
  return wide;
}
