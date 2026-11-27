import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenProps } from "../features/types";
import { listQuestionsByIds, type PublicQuestion } from "../lib/practice";
import { driveRun, lastSheetRun, rememberedRun, rememberRun, runOf, sheetSet, sheetTitle, similarOf, similarPlan, similarStart, type Plan, type Run } from "../lib/similar";
import { sheetButton, sheetMade, sheetOne, SIM, similarFail, simButton, simHave, simResult, simRunning, simTitle, twinOf } from "../lib/similarCopy";
import { Loading, Sheet, type SheetControl } from "./Shell";
import "../styles/similar.css";

/* ── Similar questions on the screens (release B, VITE_STUDY_SIMILAR;
 *    docs/study/sheets.md, design-exams §5.10, §5.11) ──
 *
 * SimilarOffer (the default): after a wrong answer to a sheet's item, or to
 * one of its similar questions (a "twin"), in the session: the twins it has
 * already, free ("2 שאלות דומות · לתרגל"), and "עוד שאלות כמוה", a bottom
 * sheet with the price on its button ("ליצור 2 כמוה · כ-$0.10"). A run
 * goes on while the member practises; its result is the one line said
 * aloud (a polite live region), and its twins are asked right after the
 * question on screen. A run joined (another tap on the same question) says
 * so. After a lock or an app switch the run's row is read again.
 *
 * SheetSimilar: "שאלות דומות לכל הדף" at the end of a sheet's round and in
 * the review's "⋯": one similar question for each question without one (24
 * at most), once a day for a sheet, into the sheet's practice set on
 * "סטים של הקבוצה" (section L, ?v=sets&k=).
 *
 * TwinChip: a twin's "דומה לשאלה 3א בתרגיל 3 · נבדקה"; a tap peeks at the
 * source question, read only. */

type Ctx = ScreenProps<"practice">["ctx"];
const POLL_MS = 3_000;
const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));
const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** A run's row, read every few seconds while it runs (and the screen is seen). */
function useRun(runId: string | null): Run | null {
  const [run, setRun] = useState<Run | null>(null);
  useEffect(() => {
    setRun(null);
    if (!runId) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive) return;
      const r = visible() ? await runOf(runId).catch(() => null) : null;
      if (!alive) return;
      if (r) setRun(r);
      if (!r || r.status === "running") t = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [runId]);
  return run;
}

export default function SimilarOffer(p: {
  ctx: Ctx;
  questionId: string;
  /** The sheet, when the item is one of its own (a twin finds its sheet through study_similar_of). */
  examId: string | null;
  /** The round's questions: twins already in it are not offered again. */
  inRound: readonly string[];
  /** Puts these questions right after the one on screen; how many were new. */
  onAdd: (ids: string[]) => Promise<number>;
  /** "לתרגל עכשיו": on to the next question (the first twin). */
  onNext: () => void;
}) {
  const [state, setState] = useState<{ examId: string; plan: Plan; price: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [line, setLine] = useState("");
  const [result, setResult] = useState("");
  const [added, setAdded] = useState(0);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // What a tap would make: the root's label, its twins, the room under its 6, the price. Nothing shows when it may not have any.
  useEffect(() => {
    let live = true;
    (async () => {
      const examId = p.examId ?? (await similarOf(p.questionId)).exam_id;
      const r = await similarPlan(examId, "item", p.questionId);
      if (!live) return;
      setState({ examId, plan: r.plan, price: r.priceUsd });
      const back = r.plan.joined ?? (r.plan.root ? rememberedRun(r.plan.root) : null);
      if (back) {
        setJoined(Boolean(r.plan.joined));
        setRunId(back);
      }
    })().catch(() => live && setState(null)); // not eligible, off, an exam's item: no offer
    return () => {
      live = false;
    };
  }, [p.questionId, p.examId]);

  const run = useRun(runId);
  const ended = run && run.status !== "running" ? run : null;
  const root = state?.plan.root ?? null;
  // The run's end: its twins asked next, and one line.
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!ended || said.current === ended.id) return;
    said.current = ended.id;
    if (root) rememberRun(root, null);
    void (async () => {
      let n = 0;
      if (ended.made > 0) {
        const t = await similarOf(p.questionId).catch(() => null);
        const fresh = (t?.twins ?? []).map((x) => x.id).filter((id) => !p.inRound.includes(id));
        n = fresh.length ? await p.onAdd(fresh).catch(() => 0) : 0;
      }
      if (!alive.current) return;
      setAdded(n);
      setResult(simResult(ended));
    })();
  }, [ended, root, p]);

  const free = (state?.plan.twins ?? []).filter((id) => !p.inRound.includes(id));
  const addFree = async () => {
    const n = await p.onAdd(free).catch(() => 0);
    if (n > 0) p.ctx.say(SIM.added);
  };

  const start = useCallback(
    async (sheet: SheetControl) => {
      if (!state) return;
      setBusy(true);
      setLine("");
      try {
        const r = await similarStart({ examId: state.examId, scope: "item", questionId: p.questionId, make: true, pages: state.plan.pages });
        sheet.close();
        if (r.kind === "joined") {
          setJoined(true);
          setRunId(r.runId);
        } else if (r.kind === "twins") {
          await p.onAdd(r.twins.filter((id) => !p.inRound.includes(id)));
        } else {
          if (root) rememberRun(root, r.runId);
          setRunId(r.runId);
          // The phone's fallback when the server cannot write: the run's job here, while the screen is open.
          if (!r.server) void driveRun(r.runId, () => alive.current).catch(() => undefined);
        }
      } catch (e) {
        sheet.close();
        setLine(similarFail(codeOf(e)));
      } finally {
        setBusy(false);
      }
    },
    [state, p, root],
  );

  if (!state) return null;
  const room = state.plan.room ?? 0;
  const per = Math.max(1, Math.min(2, room));
  const label = state.plan.label ?? "";
  const running = Boolean(runId) && !ended;
  return (
    <div className="sim-row" role="group" aria-label={simTitle(label)}>
      {free.length ? (
        <button type="button" className="a-link sim-have" onClick={() => void addFree()}>
          {simHave(free.length)} ‹
        </button>
      ) : null}
      {!runId && (room > 0 || !free.length) ? (
        <button type="button" className="a-btn small sim-more" onClick={() => setOpen(true)}>
          {SIM.more}
        </button>
      ) : null}
      {running ? <p className="a-small a-muted sim-running">{joined ? SIM.joined : simRunning(per)}</p> : null}
      <p className="a-small sim-result" aria-live="polite">
        {result}
      </p>
      {result && added > 0 ? (
        <button type="button" className="a-btn small primary sim-now" onClick={p.onNext}>
          {SIM.practiceNow}
        </button>
      ) : null}
      {line ? (
        <p className="a-small a-error sim-fail" role="status">
          {line}
        </p>
      ) : null}
      {open ? (
        <Sheet label={simTitle(label)} head={<h2 dir="auto">{simTitle(label)}</h2>} className="sim-sheet" onClose={() => setOpen(false)}>
          {(sheet) => (
            <div className="a-stack sim-sheet-body">
              <p className="a-para">{SIM.rule}</p>
              {room > 0 ? (
                <button type="button" className="a-btn primary wide sim-make" disabled={busy} onClick={() => void start(sheet)}>
                  {simButton(per, state.price)}
                </button>
              ) : (
                <p className="a-para a-muted">{SIM.max}</p>
              )}
            </div>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}

/** "שאלות דומות לכל הדף" (the end of a sheet's round, the review's "⋯"). */
export function SheetSimilar({ ctx, examId }: { ctx: Ctx; examId: string }) {
  const [state, setState] = useState<{ plan: Plan; price: number; setId: string | null } | null>(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [setId, setSetId] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => {
    let live = true;
    (async () => {
      const [r, last] = await Promise.all([similarPlan(examId, "sheet"), lastSheetRun(examId).catch(() => null)]);
      const set = last?.set_id ?? (await sheetSet(examId));
      if (!live) return;
      setState({ plan: r.plan, price: r.priceUsd, setId: set });
      setSetId(set);
      if (r.plan.joined) setRunId(r.plan.joined);
    })().catch((e) => live && setFailed(codeOf(e)));
    return () => {
      live = false;
    };
  }, [examId]);
  const run = useRun(runId);
  const set = run?.set_id ?? setId;
  const toSet = set ? (
    <button type="button" className="a-link sim-set" onClick={() => ctx.go({ v: "sets", k: set })}>
      {run && run.status !== "running" && run.made > 0 ? sheetMade(run.made) : SIM.sheetSolve} ‹
    </button>
  ) : null;

  if (failed) return failed === "off" || failed === "exam not found" ? null : <p className="a-small a-muted sim-fail">{similarFail(failed)}</p>;
  if (!state) return <Loading />;
  const begin = async () => {
    setBusy(true);
    try {
      const r = await similarStart({ examId, scope: "sheet", pages: state.plan.pages });
      if (r.kind === "run") {
        if (r.setId) setSetId(r.setId);
        setRunId(r.runId);
        ctx.say(SIM.sheetStarted);
        if (!r.server) void driveRun(r.runId, () => alive.current).catch(() => undefined);
      } else if (r.kind === "joined") setRunId(r.runId);
    } catch (e) {
      ctx.say(similarFail(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };
  const items = state.plan.items ?? [];
  return (
    <div className="a-stack sim-sheet-offer">
      {runId ? (
        <>
          <p className="a-small sim-result" aria-live="polite">
            {run && run.status !== "running" ? simResult(run) : ""}
          </p>
          {!run || run.status === "running" ? <p className="a-small a-muted">{SIM.sheetMaking}</p> : null}
          {toSet}
        </>
      ) : state.plan.today ? (
        set ? (
          <button type="button" className="a-link sim-set" onClick={() => ctx.go({ v: "sets", k: set })}>
            {SIM.sheetToday} ‹
          </button>
        ) : (
          <p className="a-small a-muted">{SIM.sheetToday}</p>
        )
      ) : items.length ? (
        <>
          <button type="button" className="a-btn wide sim-sheet-go" disabled={busy} onClick={() => void begin()}>
            {sheetButton(state.price)}
          </button>
          <p className="a-small a-muted">{sheetOne(items.length, state.plan.more ?? 0)}</p>
          <p className="a-small a-muted">{SIM.sheetHint}</p>
        </>
      ) : (
        <>
          <p className="a-small a-muted">{SIM.sheetAll}</p>
          {toSet}
        </>
      )}
    </div>
  );
}

/** A twin's chip, and its source question to peek at (read only, "סגירה"). */
export function TwinChip({ questionId }: { questionId: string }) {
  const [info, setInfo] = useState<{ root: string; label: string; title: string } | null>(null);
  const [peek, setPeek] = useState<PublicQuestion | null | "loading">(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const t = await similarOf(questionId);
      const title = await sheetTitle(t.exam_id);
      if (live) setInfo({ root: t.root, label: t.label, title });
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [questionId]);
  if (!info) return null;
  const show = async () => {
    setPeek("loading");
    const [q] = await listQuestionsByIds([info.root]).catch(() => [] as PublicQuestion[]);
    setPeek(q ?? null);
  };
  return (
    <>
      <button type="button" className="a-chip ok sim-twin" onClick={() => void show()}>
        <bdi>{twinOf(info.label, info.title)}</bdi>
      </button>
      {peek ? (
        <Sheet label={SIM.peekHead} head={<h2>{SIM.peekHead}</h2>} className="sim-peek" onClose={() => setPeek(null)}>
          {(sheet) =>
            peek === "loading" ? (
              <Loading />
            ) : (
              <div className="a-stack">
                <p className="a-small a-muted">
                  שאלה <bdi>{info.label}</bdi>
                  {info.title ? (
                    <>
                      {" · "}
                      <bdi>{info.title}</bdi>
                    </>
                  ) : null}
                </p>
                {peek.vignette.trim() ? (
                  <p className="sim-peek-text" dir="auto">
                    {peek.vignette}
                  </p>
                ) : null}
                <p className="sim-peek-text a-q" dir="auto">
                  {peek.question}
                </p>
                {peek.options.length ? (
                  <ol className="sim-peek-options">
                    {peek.options.map((o, i) => (
                      <li key={i}>
                        <span aria-hidden="true">{"אבגדהוזחטי"[i] ?? i + 1}. </span>
                        <bdi>{o}</bdi>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <button type="button" className="a-btn wide" onClick={sheet.close}>
                  {SIM.close}
                </button>
              </div>
            )
          }
        </Sheet>
      ) : null}
    </>
  );
}
