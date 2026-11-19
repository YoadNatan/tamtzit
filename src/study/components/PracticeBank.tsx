import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STYLE_HE, keepable, type Style } from "../../../shared/study/practice2";
import type { ScreenProps } from "../features/types";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import {
  keepAll,
  keepDraft,
  listDrafts,
  listRequests,
  removeDraft,
  requestBatches,
  requestKey,
  requestProgress,
  rewordDraft,
  takeMade,
  usd,
  useLocalRequest,
  watchBank,
  writable,
  writeRequest,
  writingSomewhere,
  type DraftRow,
  type PartProgress,
  type Request,
  type RequestBatch,
} from "../lib/practice2";
import { KEEP_SCREEN_ON, useRound } from "../lib/rounds";
import { barLabel, richText } from "../lib/rich";
import { LETTERS } from "../lib/questionText";
import { backTarget, Head, Loading, RouteLink, Sheet, StickyActions } from "./Shell";

/* ── Practice 2.0: הבנק נבנה (proposal/practice-2/mockups.html) ──
 *
 * ?v=practice&l=<lecture>&x=bank&r=<request>: the request's questions arrive
 * part by part. The top bar counts them ("17/24"); a bar per part shows how
 * many of its points to know the drafts cover ("מלריה 10/22"), from
 * study_request_progress, live on every phone (Realtime on the drafts and
 * batches). Each draft shows its style, the blind solver's verdict ("נבדקה
 * ✓", "בבדיקה…", "הפותר טעה" while the server rewrites it, "לא נבדקה" when
 * the solver could not run) and its slide, with "✓ להשאיר", "↻ לנסח מחדש"
 * (a sheet with an optional note and its cost) and "✕". Only a kept draft is
 * a question of the bank (decision 3); "להוסיף N לבנק" keeps every draft the
 * solver passed or could not check (study_draft_keep_all). Anyone in the
 * group may do all of it (decision 2). This phone writes the batches it was
 * given (rounds.ts); a batch that failed, or a request nobody is writing
 * any more, offers "להמשיך לכתוב". */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));
const leased = (d: Pick<DraftRow, "lease_until">, now: number) => Boolean(d.lease_until && Date.parse(d.lease_until) > now);
const slidesText = (slides: readonly number[]) => {
  const s = [...new Set(slides)].sort((a, b) => a - b);
  return s.length > 1 && s[s.length - 1] - s[0] === s.length - 1 ? `${s[0]}-${s[s.length - 1]}` : s.join(", ");
};

function verdict(d: DraftRow, now: number): { text: string; tone: string } {
  if (leased(d, now)) return { text: "מנוסחת מחדש…", tone: "busy" };
  if (d.check_state === "ok") return { text: "נבדקה ✓", tone: "ok" };
  if (d.check_state === "failed") return { text: "הפותר טעה", tone: "warn" };
  if (d.check_state === "unchecked") return { text: "לא נבדקה", tone: "warn" };
  return { text: "בבדיקה…", tone: "" };
}

export default function PracticeBank({ route, ctx }: ScreenProps<"practice">) {
  const lectureId = route.l ?? "";
  const [request, setRequest] = useState<Request | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [batches, setBatches] = useState<RequestBatch[]>([]);
  const [progress, setProgress] = useState<PartProgress[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [rewordFor, setRewordFor] = useState<DraftRow | null>(null);
  const [now, setNow] = useState(Date.now());
  const requestId = request?.id ?? route.r ?? "";
  const local = useLocalRequest(requestId);
  const round = useRound(requestKey(requestId));
  const running = Boolean(round?.running);

  const requestRef = useRef<Request | null>(null);
  const load = useCallback(async () => {
    let r = requestRef.current;
    if (!r) {
      const all = await listRequests(lectureId);
      r = (route.r ? all.find((x) => x.id === route.r) : all[0]) ?? null;
      if (!r) return setPhase("none");
      requestRef.current = r;
      setRequest(r);
    }
    const [ds, bs, pr] = await Promise.all([listDrafts(r.id), requestBatches(r.id), requestProgress(r.id)]);
    setDrafts(ds);
    setBatches(bs);
    setProgress(pr);
    setNow(Date.now());
    setPhase("ready");
  }, [lectureId, route.r]);

  useEffect(() => {
    let alive = true;
    load().catch(() => alive && setPhase((p) => (p === "ready" ? p : "error")));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchBank(lectureId, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load().catch(() => undefined), 250);
    });
    // A reword's lease and a writer's six minutes pass with no event.
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(clock);
      stop();
    };
  }, [lectureId, load]);
  // This phone's writing ended: read everything again.
  useEffect(() => {
    if (round && !round.running) void load().catch(() => undefined);
  }, [round?.running]);

  const pending = useMemo(() => drafts.filter((d) => d.status === "pending"), [drafts]);
  const kept = drafts.filter((d) => d.status === "kept").length;
  const toKeep = pending.filter((d) => keepable(d) && !leased(d, now));
  const made = progress.reduce((n, p) => n + p.made, 0);
  const wanted = progress.reduce((n, p) => n + p.wanted, 0) || batches.reduce((n, b) => n + b.wanted, 0);
  const openBatches = batches.filter((b) => b.status === "pending" || b.status === "writing");
  const coming = openBatches.reduce((n, b) => n + Math.max(0, b.wanted - b.made), 0);
  const failedBatches = batches.filter((b) => b.status === "failed");
  const canWrite = !running && batches.some((b) => writable(b, now)) && (failedBatches.length > 0 || !writingSomewhere(batches, now));

  const act = async (id: string, run: () => Promise<unknown>, done?: string) => {
    if (busy.has(id)) return;
    setBusy((b) => new Set(b).add(id));
    try {
      await run();
      // The list first, then the toast: it never shows while the card is still there.
      await load().catch(() => undefined);
      if (done) ctx.say(done);
    } catch (e) {
      ctx.say(failText(codeOf(e), "practice"));
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
    }
  };
  const resume = () => {
    if (!request) return;
    const ids = batches.filter((b) => writable(b, Date.now())).map((b) => b.id);
    void writeRequest(lectureId, request.id, ids).catch(() => undefined);
  };
  const back = () => {
    const parent = { v: "practice" as const, l: lectureId };
    if (requestId && takeMade(requestId) && history.length > 2) history.go(-2);
    else if (backTarget(parent).inApp) history.back();
    else ctx.go(parent, { replace: true });
  };

  const head = (
    <Head
      back={
        <button type="button" className="back" onClick={back}>
          → לתרגול
        </button>
      }
      title="הבנק נבנה"
    >
      {phase === "ready" ? (
        <span className="a-chip busy pb-count" aria-label={`${made} מתוך ${wanted} שאלות נכתבו`}>
          <bdi dir="ltr">
            {made}/{wanted}
          </bdi>
        </span>
      ) : null}
    </Head>
  );
  if (phase === "loading") return <Loading />;
  if (phase === "none" || phase === "error") {
    return (
      <main className="practice-bank">
        {head}
        <p className={phase === "error" ? "a-error" : "a-muted"}>{phase === "error" ? "הבנק לא נטען. כדאי לבדוק את החיבור ולנסות שוב." : failText("request not found", "practice")}</p>
        <RouteLink to={{ v: "practice", l: lectureId }} go={ctx.go} className="a-btn">
          לתרגול של ההרצאה
        </RouteLink>
      </main>
    );
  }

  const partTitle = (idx: number) => progress.find((p) => p.part_idx === idx)?.title || `חלק ${idx + 1}`;
  const draftCard = (d: DraftRow) => {
    const v = verdict(d, now);
    const working = busy.has(d.id) || leased(d, now);
    const rewriting = d.check_state === "failed" && openBatches.some((b) => b.id === d.batch_id);
    return (
      <li key={d.id} className="a-card flat pb-draft" data-draft={d.id}>
        <div className="a-row between">
          <span className="a-chip pb-style">{STYLE_HE[d.style as Style] ?? d.style}</span>
          <span className="a-row">
            <span className={`a-chip ${v.tone} pb-verdict`.replace("  ", " ")}>{v.text}</span>
            {d.slides.length ? (
              <span className="a-tag src-tag">
                ש׳ <bdi dir="ltr">{slidesText(d.slides)}</bdi>
              </span>
            ) : null}
          </span>
        </div>
        {d.vignette.trim() ? (
          <p className="a-small pb-vignette" dir="rtl">
            {richText(d.vignette, `v${d.id}`)}
          </p>
        ) : null}
        <p className="a-small pb-question" dir="rtl">
          <b>{richText(d.question, `q${d.id}`)}</b>
        </p>
        <details className="pb-options">
          <summary className="a-small">האפשרויות</summary>
          <ol className="a-stack a-small">
            {d.options.map((o, i) => (
              <li key={i} dir="rtl">
                {LETTERS[i]}. {richText(o, `o${d.id}${i}`)}
              </li>
            ))}
          </ol>
        </details>
        {d.check_state === "failed" ? (
          <p className="a-small a-muted">{rewriting ? "נכתבת מחדש אוטומטית." : "הפותר העיוור ענה אחרת מהמפתח. אפשר לנסח אותה מחדש או להוריד."}</p>
        ) : d.check_state === "unchecked" ? (
          <p className="a-small a-muted">הפותר העיוור לא הספיק לבדוק אותה. אפשר להשאיר אותה בכל זאת.</p>
        ) : null}
        {rewriting ? null : (
          <div className="a-row pb-actions">
            <button type="button" className="a-btn" disabled={working || !keepable(d)} onClick={() => void act(d.id, () => keepDraft(d.id), "נוספה לבנק.")}>
              ✓ להשאיר
            </button>
            <button type="button" className="a-btn" disabled={working || d.check_state === "checking"} onClick={() => setRewordFor(d)}>
              ↻ לנסח מחדש
            </button>
            <button type="button" className="a-btn ghost icon" aria-label="להוריד את השאלה" disabled={working} onClick={() => void act(d.id, () => removeDraft(d.id), "השאלה הורדה.")}>
              ✕
            </button>
          </div>
        )}
      </li>
    );
  };

  return (
    <main className="practice-bank">
      {head}
      <div className="a-bars pb-bars" role="list" aria-label="כמה מהנקודות שצריך לדעת השאלות מכסות, לפי חלק">
        {progress.map((p) => (
          <div key={p.part_idx} role="listitem" className={`r${p.points > 0 && p.covered >= p.points ? " ok" : ""}`} aria-label={`${p.title || `חלק ${p.part_idx + 1}`}: ${p.covered} מתוך ${p.points} נקודות`}>
            <span dir="auto">{barLabel(p.title || `חלק ${p.part_idx + 1}`, `bl${p.part_idx}-`)}</span>
            <span className="a-bar" aria-hidden="true">
              <i style={{ width: `${p.points ? Math.round((100 * p.covered) / p.points) : 0}%` }} />
            </span>
            <b aria-hidden="true">
              <bdi dir="ltr">
                {p.covered}/{p.points}
              </bdi>
            </b>
          </div>
        ))}
      </div>
      {running ? <p className="a-small a-muted">{KEEP_SCREEN_ON}</p> : null}
      {local.error && !running ? (
        <p className="a-error" role="alert">
          {failText(local.error, "practice")}
        </p>
      ) : null}
      {failedBatches.length ? (
        <ul className="a-stack pb-failed">
          {failedBatches.map((b) => (
            <li key={b.id} className="a-small">
              <bdi>{b.heading || partTitle(b.part_idx)}</bdi>: החלק לא נכתב. {failText(b.error ?? "empty", "practice")}
            </li>
          ))}
        </ul>
      ) : null}
      {canWrite ? (
        <button type="button" className="a-btn pb-resume" onClick={resume}>
          להמשיך לכתוב
        </button>
      ) : null}
      {kept ? <p className="a-small a-muted pb-kept">{kept === 1 ? "שאלה אחת כבר בבנק." : `${kept} שאלות כבר בבנק.`}</p> : null}

      {pending.length ? (
        <ul className="a-stack pb-drafts" aria-label="השאלות שמחכות להחלטה">
          {pending.map(draftCard)}
        </ul>
      ) : !openBatches.length ? (
        <p className="a-muted pb-done">{kept ? "כל השאלות של הבקשה טופלו." : "אין כאן שאלות שמחכות להחלטה."}</p>
      ) : null}

      <StickyActions>
        {coming > 0 ? (
          <span className="a-btn wide pb-more" role="status">
            עוד {coming} נכתבות…
          </span>
        ) : null}
        {toKeep.length || pending.length || openBatches.length || !flags.practice ? (
          <button type="button" className="a-btn primary wide pb-keep-all" disabled={!toKeep.length || busy.has("all")} onClick={() => void act("all", () => keepAll(requestId), toKeep.length === 1 ? "שאלה אחת נוספה לבנק." : `${toKeep.length} שאלות נוספו לבנק.`)}>
            {toKeep.length ? `להוסיף ${toKeep.length} לבנק` : "להוסיף לבנק"}
          </button>
        ) : (
          <RouteLink to={{ v: "practice", l: lectureId, x: "round" }} go={ctx.go} className="a-btn primary wide">
            לתרגל
          </RouteLink>
        )}
      </StickyActions>

      {rewordFor ? <RewordSheet draft={rewordFor} lectureId={lectureId} cost={usd(0.03)} onClose={() => setRewordFor(null)} onDone={(e) => (e ? ctx.say(failText(e, "practice")) : void load())} /> : null}
    </main>
  );
}

function RewordSheet({ draft, lectureId, cost, onClose, onDone }: { draft: DraftRow; lectureId: string; cost: string; onClose: () => void; onDone: (error?: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Sheet label="לנסח מחדש" className="reword-sheet" onClose={onClose} head={<h2>לנסח מחדש</h2>}>
      {(sheet) => (
        <>
          <p className="a-small" dir="rtl">
            <b>{richText(draft.question, "rq")}</b>
          </p>
          <label className="a-field">
            <span>מה לשנות? (רשות)</span>
            <textarea className="a-input" rows={3} maxLength={200} dir="rtl" placeholder="למשל: שאלה על המנגנון ולא על השם" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="a-small a-muted">
            אותה נקודה ואותו מפתח, בניסוח חדש, והפותר העיוור בודק אותה שוב. כ-<bdi dir="ltr">{cost}</bdi>.
          </p>
          <div className="a-row sheet-actions">
            <button
              type="button"
              className="a-btn primary"
              onClick={() =>
                sheet.closeThen(() => {
                  rewordDraft(lectureId, draft.id, note)
                    .then(() => onDone())
                    .catch((e: unknown) => onDone(codeOf(e)));
                })
              }
            >
              לנסח מחדש
            </button>
            <button type="button" className="a-btn ghost" onClick={sheet.close}>
              ביטול
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
