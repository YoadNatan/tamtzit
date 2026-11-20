import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelledLine,
  examHide,
  examItemEdit,
  examKeyConfirm,
  examKeyUndo,
  examLengthLine,
  examRetry,
  examReview,
  examStatus,
  examUnit,
  foundLine,
  itemState,
  keyByLine,
  lastUndoable,
  letter,
  LETTERS,
  readingLine,
  readingPercent,
  repeatsLine,
  reviewCounts,
  setExamKey,
  skippedLine,
  unitLines,
  type ExamStatus,
  type ItemState,
  type KeyLog,
  type Review,
  type ReviewItem,
} from "../lib/exams";
import { failText } from "../lib/failText";
import { richText } from "../lib/rich";
import type { ScreenProps } from "../features/types";
import { drives, holdScreen, PageCrop, setDrive } from "./ExamParts";
import { BackLink, Head, Loading, RouteLink } from "./Shell";
import "../styles/exams.css";

/* ── One past exam: its reading, then its review (sources.md B6.2, B7;
 *    mockups exam-reading.html and exam-review.html) ──
 *
 * ?v=exams&e=<exam>(&c=<course>). While the server copies the questions:
 * "מעתיקים עמודים 9–12 מתוך 28…", a row per 4 pages ("✓ הועתק", "עכשיו",
 * "מחכה", "לא נקראו · לנסות שוב"), and "אפשר לסגור את הטלפון": the reading
 * goes on without it (when the server cannot write, the phone copies the
 * pages itself while this screen is open, and says so). Then the review:
 * "נמצאו 98 שאלות · 91 עם תשובה · 7 לבדיקה", "לתרגל את המבחן", the filter
 * chips, and each item with its page beside the text: confirm a suggested
 * answer ("לאשר"), mark another ("לסמן תשובה אחרת"), undo a member's mark
 * ("סומנה ע״י נועה: ג׳ · לבטל"), fix a badly read item ("לא נקראה טוב ·
 * לתקן טקסט"), read its page again, and every change of its answer in a
 * list under it. "לא לכלול בחישוב הנושאים" at the end. */

const POLL_MS = 4_000;
/** What reading pages again costs ("לקרוא שוב את עמוד N", a unit's "לנסות שוב"). */
const REREAD_COST = "קריאה חוזרת נספרת בתקציב החודשי של הקבוצה, עד 3 פעמים ביום לכל מבחן.";
type Filter = "all" | "look" | "suggested" | "nokey";

const STATE_CHIP: Record<ItemState, { label: string; cls: string }> = {
  unclear: { label: "לא נקראה טוב", cls: "a-chip warn" },
  suggested: { label: "תשובה מוצעת · לא נבדקה", cls: "a-chip warn" },
  nokey: { label: "בלי תשובה", cls: "a-chip" },
  ok: { label: "", cls: "a-chip ok" },
};

const UNIT_CHIP: Record<string, { label: string; cls: string }> = {
  done: { label: "✓ הועתק", cls: "a-chip ok" },
  running: { label: "עכשיו", cls: "a-chip busy" },
  pending: { label: "מחכה", cls: "a-chip" },
};

const firstWords = (text: string, n = 7) => {
  const w = text.replace(/\*\*/g, "").trim().split(/\s+/);
  return w.length > n ? `${w.slice(0, n).join(" ")}…` : w.join(" ");
};
const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

export default function ExamView({ route, ctx }: ScreenProps<"exams">) {
  const examId = route.e ?? "";
  const courseId = route.c && /^[0-9a-f-]{36}$/.test(route.c) ? route.c : null;
  const [status, setStatus] = useState<ExamStatus | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const driving = useRef(false);
  const groupId = ctx.group.id;

  const load = useCallback(async () => {
    try {
      const s = await examStatus(examId);
      setStatus(s);
      if (s.status === "ready" || s.status === "failed" || s.found > 0) setReview(await examReview(examId));
      setError("");
      return s;
    } catch (e) {
      setError(failText(codeOf(e), "exam"));
      return null;
    }
  }, [examId]);

  // Follows the reading until nothing runs; the phone copies when the server cannot.
  const reading = status ? status.status === "reading" || status.status === "linking" : false;
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [reading, load]);
  useEffect(() => {
    if (!reading || !drives(examId) || driving.current) return;
    driving.current = true;
    void holdScreen(true);
    let alive = true;
    (async () => {
      try {
        for (let i = 0; i < 200 && alive; i++) {
          const r = await examUnit(examId);
          if (!r.claimed && r.status !== "reading") break;
          if (!r.claimed) await new Promise((ok) => setTimeout(ok, 3_000));
          void load();
        }
      } catch {
        // a refusal ends the phone's copying; the screen shows the units' state
      } finally {
        driving.current = false;
        void holdScreen(false);
        const s = await load();
        if (s && s.status !== "reading") setDrive(examId, false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reading, examId, load]);

  const back = <BackLink go={ctx.go} fallback={courseId ? { v: "course", c: courseId, seg: "exams" } : { v: "library" }} />;
  if (error && !status)
    return (
      <main className="exam-review">
        <Head back={back} title="מבחן קודם" />
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!status) return <Loading />;

  const retryAll = async (pages: number[] | null) => {
    setBusy(true);
    try {
      const r = review ?? (await examReview(examId));
      const n = await examRetry(
        examId,
        r.pages.map((p) => p.path),
        pages,
      );
      ctx.say(n === 1 ? "הדפים נשלחו שוב להעתקה." : "נשלח שוב להעתקה.");
      await load();
    } catch (e) {
      ctx.say(failText(codeOf(e), "exam"));
    } finally {
      setBusy(false);
    }
  };

  const by = review?.exam.by;
  const sub = (
    <p className="ph-sub">
      {examLengthLine(status) ? <span>{examLengthLine(status)}</span> : null}
      {status.pages ? (
        <>
          {examLengthLine(status) ? <span aria-hidden="true">·</span> : null}
          <span>{status.pages === 1 ? "דף אחד" : `${status.pages} דפים`}</span>
        </>
      ) : null}
      {by ? (
        <>
          {examLengthLine(status) || status.pages ? <span aria-hidden="true">·</span> : null}
          <span>
            הועלה ע״י <bdi>{by}</bdi>
          </span>
        </>
      ) : null}
    </p>
  );
  const head = <Head back={back} title={<bdi>{status.title}</bdi>} />;

  if (status.status === "uploading" || status.status === "new") {
    return (
      <main className="exam-review">
        {head}
        <p className="a-para a-muted">המבחן הזה לא עלה עד הסוף. אפשר להעלות אותו שוב מהקורס.</p>
        {courseId ? (
          <RouteLink to={{ v: "exams", isNew: true, c: courseId }} go={ctx.go} className="a-btn">
            העלאת מבחן קודם
          </RouteLink>
        ) : null}
      </main>
    );
  }

  const lines = unitLines(status.units);
  const failed = lines.filter((l) => l.state === "failed");
  const progress = reading ? (
    <section className="a-card x-prog" aria-live="polite">
      <span className="x-big">{readingLine(status) || "מעתיקים את השאלות…"}</span>
      <div className="a-bar" role="progressbar" aria-label="ההעתקה" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readingPercent(status.units)}>
        <i style={{ width: `${Math.max(4, readingPercent(status.units))}%` }} />
      </div>
      <p className="a-small a-muted">{drives(examId) ? "הטלפון מעתיק את הדפים. כדאי להשאיר את המסך פתוח." : "אפשר לסגור את הטלפון. ההעתקה ממשיכה בלעדיו."}</p>
    </section>
  ) : null;
  const unitList =
    lines.length && (reading || failed.length) ? (
      <ul className="a-list x-units">
        {lines.map((l) => (
          <li key={l.key} className="a-li">
            <div>
              <b>{l.title}</b>
              <span className="m">
                {l.state === "failed" ? (l.kind === "read" ? "לא נקראו" : "לא הצליח") : l.state === "running" ? "מעתיקים…" : l.state === "pending" ? "בתור" : ""}
                {/* An expired link is the one failure worth a sentence: "לנסות שוב" brings fresh ones. */}
                {l.state === "failed" && l.error === "pages_expired" ? ` · ${failText(l.error, "exam")}` : ""}
              </span>
            </div>
            {l.state === "failed" ? (
              <button type="button" className="a-btn small x-retry" disabled={busy} onClick={() => void retryAll(null)}>
                לנסות שוב
              </button>
            ) : (
              <span className={UNIT_CHIP[l.state]?.cls ?? "a-chip"}>{UNIT_CHIP[l.state]?.label ?? ""}</span>
            )}
          </li>
        ))}
      </ul>
    ) : null;
  // "לנסות שוב" reads the pages again: its cost, once under the rows.
  const retryNote = unitList && failed.length ? <p className="a-small a-muted x-retry-note">{REREAD_COST}</p> : null;

  if (!review || reading) {
    return (
      <main className="exam-review">
        {head}
        {sub}
        {progress}
        {unitList}
        {retryNote}
        {!reading && status.status === "failed" ? (
          <p className="a-error" role="alert">
            {failText(status.error ?? "", "exam") || "לא נמצאו שאלות במבחן הזה."}
          </p>
        ) : null}
        {reading ? (
          <>
            <div className="a-sec">
              <h2>כשזה נגמר</h2>
            </div>
            <p className="a-small a-muted">לרוב 10–20 דקות. בסוף יופיע כאן כמה שאלות נמצאו, והמבחן יופיע לכל הקבוצה בעמוד הקורס, לבדיקה ולתרגול.</p>
          </>
        ) : null}
      </main>
    );
  }

  return (
    <ExamReviewBody
      ctx={ctx}
      examId={examId}
      courseId={courseId}
      groupId={groupId}
      status={status}
      review={review}
      setReview={setReview}
      head={head}
      sub={sub}
      unitList={
        unitList ? (
          <>
            {unitList}
            {retryNote}
          </>
        ) : null
      }
      reload={load}
      retry={retryAll}
      busy={busy}
    />
  );
}

function ExamReviewBody(p: {
  ctx: ScreenProps<"exams">["ctx"];
  examId: string;
  courseId: string | null;
  groupId: string;
  status: ExamStatus;
  review: Review;
  setReview: (r: Review) => void;
  head: React.ReactNode;
  sub: React.ReactNode;
  unitList: React.ReactNode;
  reload: () => Promise<ExamStatus | null>;
  retry: (pages: number[] | null) => Promise<void>;
  busy: boolean;
}) {
  const { ctx, review, status } = p;
  const counts = useMemo(() => reviewCounts(review.items), [review.items]);
  const [filter, setFilter] = useState<Filter>(() => (counts.toCheck ? "look" : "all"));
  const [open, setOpen] = useState<string | null>(null);
  const [hidden, setHidden] = useState(review.exam.hidden);
  const closed = useRef<string | null>(null);
  const live = review.items.filter((q) => !q.retired);
  // The open item stays in the list until it is closed, even when "לאשר" moved it out of the filter (its "לבטל" with it).
  const shown = live.filter((q) => {
    if (q.id === open) return true;
    const st = itemState(q);
    if (filter === "look") return st !== "ok";
    if (filter === "suggested") return st === "suggested";
    if (filter === "nokey") return st === "nokey";
    return true;
  });
  // Focus follows the item: into the opened card (scrolled into view), back to its row when it closes.
  useEffect(() => {
    if (open) {
      const h = document.getElementById(`ri-${open}`);
      h?.focus({ preventScroll: true });
      h?.closest("article")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else if (closed.current) {
      document.getElementById(`rh-${closed.current}`)?.focus();
      closed.current = null;
    }
  }, [open]);
  const close = (id: string) => {
    closed.current = id;
    setOpen(null);
  };
  const refresh = async () => {
    const r = await examReview(p.examId);
    p.setReview(r);
  };
  const chips: Array<{ f: Filter; label: string; n: number }> = [
    { f: "all", label: "הכל", n: counts.found },
    { f: "look", label: "לבדיקה", n: counts.toCheck },
    { f: "suggested", label: "תשובה מוצעת", n: counts.suggested },
    { f: "nokey", label: "בלי תשובה", n: counts.nokey },
  ].filter((c) => c.f === "all" || c.n > 0) as Array<{ f: Filter; label: string; n: number }>;

  return (
    <main className="exam-review">
      {p.head}
      {p.sub}
      <section className="a-card r-sum" aria-label="מה נמצא">
        <div className="nums">
          <div>
            <b>{counts.found}</b>
            <span>נמצאו</span>
          </div>
          <div>
            <b>{counts.withAnswer}</b>
            <span>עם תשובה</span>
          </div>
          <div>
            <b>{counts.toCheck}</b>
            <span>לבדיקה</span>
          </div>
        </div>
        <p className="sr-only">{foundLine(counts)}</p>
        {skippedLine(status.skipped_open) ? <p className="a-small a-muted">{skippedLine(status.skipped_open)}</p> : null}
        {repeatsLine(status.repeats) ? <p className="a-small a-muted">{repeatsLine(status.repeats)}</p> : null}
        {cancelledLine(status.cancelled) ? <p className="a-small a-muted">{cancelledLine(status.cancelled)}</p> : null}
        {counts.found ? (
          <RouteLink to={{ v: "practice", s: `e.${p.examId}`, n: "all" }} go={ctx.go} className="a-btn primary wide">
            לתרגל את המבחן
          </RouteLink>
        ) : null}
        {p.courseId && counts.found >= 5 ? (
          <RouteLink to={{ v: "mock", c: p.courseId, e: p.examId }} go={ctx.go} className="a-btn wide">
            סימולציה מהמבחן
          </RouteLink>
        ) : null}
      </section>
      {p.unitList}

      {live.length ? (
        <div className="r-filters" role="radiogroup" aria-label="להראות">
          {chips.map((c) => (
            <button key={c.f} type="button" className="a-chip" role="radio" aria-checked={filter === c.f} onClick={() => setFilter(c.f)}>
              {c.label} · {c.n}
            </button>
          ))}
        </div>
      ) : null}

      <ul className="a-list r-rows">
        {shown.map((q) => (
          <li key={q.id} className="r-row">
            {open === q.id ? (
              <ItemCard {...p} q={q} log={review.key_log} onClose={() => close(q.id)} refresh={refresh} />
            ) : (
              <button type="button" id={`rh-${q.id}`} className="a-li r-head" aria-expanded={false} onClick={() => setOpen(q.id)}>
                <div>
                  <b>שאלה {q.no}</b>
                  <span className="m" dir="rtl">
                    {firstWords(q.question)}
                  </span>
                  {keyByLine(q) ? <span className="r-who a-small">{keyByLine(q)}</span> : null}
                </div>
                <RowChip q={q} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!shown.length ? <p className="a-para a-muted">{filter === "look" ? "אין שאלות לבדיקה." : "אין כאן שאלות."}</p> : null}

      <label className="a-card flat r-hide">
        <span className="a-stack">
          <span>לא לכלול בחישוב הנושאים</span>
          <span className="a-small a-muted">המבחן נשאר לתרגול. לכל הקבוצה: הוא לא ייכנס לחישוב הנושאים של הקורס, ולא ישמש כדוגמה לסגנון של שאלות חדשות.</span>
        </span>
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => {
            const v = e.target.checked;
            setHidden(v);
            examHide(p.examId, v).catch((err: unknown) => {
              setHidden(!v);
              ctx.say(failText(codeOf(err), "exam"));
            });
          }}
        />
      </label>
    </main>
  );
}

function RowChip({ q }: { q: ReviewItem }) {
  const st = itemState(q);
  if (st !== "ok") return <span className={STATE_CHIP[st].cls}>{st === "suggested" ? "תשובה מוצעת" : STATE_CHIP[st].label}</span>;
  if (q.form !== "one") return <span className="a-chip ok">יש תשובה</span>;
  return <span className="a-chip ok">תשובה {letter(q.answer)}</span>;
}

/** One item, opened: its page beside the text, its options with the key, and what can be done. */
function ItemCard(p: {
  ctx: ScreenProps<"exams">["ctx"];
  examId: string;
  groupId: string;
  q: ReviewItem;
  log: KeyLog[];
  onClose: () => void;
  refresh: () => Promise<void>;
  retry: (pages: number[] | null) => Promise<void>;
  busy: boolean;
}) {
  const { q, ctx } = p;
  const [mode, setMode] = useState<"view" | "pick" | "edit">("view");
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState({ question: q.question, vignette: q.vignette, options: [...q.options] });
  const st = itemState(q);
  const undo = lastUndoable(p.log, q.id);
  const history = p.log.filter((l) => l.question_id === q.id);
  const one = q.form === "one";

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setSending(true);
    try {
      await f();
      await p.refresh();
      if (done) ctx.say(done);
      setMode("view");
      // The button pressed may be gone now ("לאשר" once confirmed): the card's heading keeps the place.
      requestAnimationFrame(() => document.getElementById(`ri-${q.id}`)?.focus({ preventScroll: true }));
    } catch (e) {
      ctx.say(failText(codeOf(e), "exam") || "השינוי לא נשמר. כדאי לנסות שוב.");
    } finally {
      setSending(false);
    }
  };
  const mark = (i: number) => void run(() => setExamKey(q.id, i), `סומנה תשובה ${letter(i)}.`);
  const confirm = () =>
    one && q.answer !== null ? void run(() => setExamKey(q.id, q.answer), `התשובה ${letter(q.answer)} אושרה.`) : void run(() => examKeyConfirm(q.id), "התשובה המוצעת אושרה.");
  const saveEdit = () =>
    void run(async () => {
      if (draft.question.trim() !== q.question) await examItemEdit(q.id, "question", null, draft.question);
      if (draft.vignette.trim() !== q.vignette) await examItemEdit(q.id, "vignette", null, draft.vignette);
      for (const [i, o] of draft.options.entries()) if (o.trim() !== q.options[i]) await examItemEdit(q.id, "option", i, o);
    }, "התיקון נשמר.");

  return (
    <article className="a-card r-item" aria-labelledby={`ri-${q.id}`}>
      <div className="a-row between">
        <b id={`ri-${q.id}`} tabIndex={-1}>
          שאלה {q.no}
        </b>
        <span className="a-row">
          {st !== "ok" ? <span className={STATE_CHIP[st].cls}>{STATE_CHIP[st].label}</span> : null}
          <button type="button" className="a-btn ghost small" aria-label={`לסגור את שאלה ${q.no}`} onClick={p.onClose}>
            סגירה
          </button>
        </span>
      </div>
      {mode === "edit" ? (
        <div className="a-stack r-edit">
          {q.vignette || draft.vignette ? (
            <label className="a-field">
              <span>המקרה</span>
              <textarea className="a-input" rows={3} dir="rtl" value={draft.vignette} onChange={(e) => setDraft({ ...draft, vignette: e.target.value })} />
            </label>
          ) : null}
          <label className="a-field">
            <span>השאלה</span>
            <textarea className="a-input" rows={3} dir="rtl" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
          </label>
          {draft.options.map((o, i) => (
            <label key={i} className="a-field">
              <span>תשובה {letter(i)}</span>
              <input className="a-input" dir="rtl" value={o} onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, k) => (k === i ? e.target.value : x)) })} />
            </label>
          ))}
          <div className="a-row">
            <button type="button" className="a-btn primary small" disabled={sending} onClick={saveEdit}>
              לשמור
            </button>
            <button type="button" className="a-btn small" disabled={sending} onClick={() => setMode("view")}>
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="r-split">
            <div className="r-crop">
              <PageCrop groupId={p.groupId} examId={p.examId} figure={q.figure} page={q.page} zoom />
              {q.page ? <span className="a-small a-muted">עמוד {q.page}</span> : null}
            </div>
            <div className="a-stack r-text">
              {q.vignette ? (
                <p className="a-para" dir="rtl">
                  {richText(q.vignette, "v")}
                </p>
              ) : null}
              <p className="a-para" dir="rtl">
                {richText(q.question, "q")}
              </p>
            </div>
          </div>
          {q.form === "match" && q.prompts.length ? (
            <ol className="a-stack r-prompts" aria-label="מה להתאים">
              {q.prompts.map((t, i) => (
                <li key={i} className="a-small" dir="rtl">
                  {i + 1}. {t}
                </li>
              ))}
            </ol>
          ) : null}
          {mode === "pick" ? <p className="a-small r-pickhint">בוחרים את התשובה הנכונה. היא תשתנה לכל הקבוצה:</p> : null}
          <ol className="a-opts r-opts" aria-label="התשובות">
            {q.options.map((o, i) => {
              const key = one && q.answer === i;
              const seqMark = q.form === "tf" && q.seq ? (q.seq[i] ? " · נכון" : " · לא נכון") : "";
              const body = (
                <>
                  <span className="l">{LETTERS[i]}</span>
                  <span dir="rtl">
                    {richText(o, `o${i}`)}
                    {seqMark}
                  </span>
                  {key ? <span className="sr-only"> (התשובה {st === "suggested" ? "המוצעת" : "המסומנת"})</span> : null}
                </>
              );
              return (
                <li key={i} className={`a-opt${key ? " picked" : ""}`}>
                  {mode === "pick" ? (
                    <button type="button" className="r-optbtn" disabled={sending} onClick={() => mark(i)} aria-label={`לסמן את תשובה ${letter(i)}`}>
                      {body}
                    </button>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ol>
          {q.form === "match" && q.seq ? <p className="a-small a-muted">ההתאמה: {q.seq.map((v, i) => `${i + 1}→${letter(v)}`).join(" · ")}</p> : null}
        </>
      )}
      {mode === "view" ? (
        <div className="a-row r-acts">
          {st === "suggested" ? (
            <button type="button" className="a-btn primary small" disabled={sending} onClick={confirm}>
              לאשר
            </button>
          ) : null}
          {one ? (
            <button type="button" className="a-btn small" disabled={sending} onClick={() => setMode("pick")}>
              {q.answer === null ? "לסמן תשובה" : "לסמן תשובה אחרת"}
            </button>
          ) : null}
          <button type="button" className="a-btn small" disabled={sending} onClick={() => setMode("edit")}>
            {st === "unclear" ? "לא נקראה טוב · לתקן טקסט" : "לתקן טקסט"}
          </button>
          {/* A page read again would not change an item someone fixed or answered: "לתקן טקסט" does. */}
          {q.page && st === "unclear" && !q.fixed && !q.answered ? (
            <button type="button" className="a-btn small r-reread" disabled={sending || p.busy} onClick={() => void p.retry([q.page!])}>
              לקרוא שוב את עמוד {q.page}
            </button>
          ) : null}
        </div>
      ) : mode === "pick" ? (
        <button type="button" className="a-btn small" disabled={sending} onClick={() => setMode("view")}>
          ביטול
        </button>
      ) : null}
      {/* What a tap here does: the answer changes for the whole group, with the member's name, and can be undone. */}
      {mode === "view" && st === "suggested" ? (
        <p className="a-small a-muted r-group">האפליקציה הציעה את התשובה הזו. ״לאשר״ או ״לסמן תשובה אחרת״ משנים אותה לכל הקבוצה, עם השם שלך, ואפשר לבטל.</p>
      ) : mode === "view" && one ? (
        <p className="a-small a-muted r-group">סימון תשובה משנה אותה לכל הקבוצה, עם השם שלך, ואפשר לבטל.</p>
      ) : null}
      {mode === "view" && q.page && st === "unclear" && !q.fixed && !q.answered ? <p className="a-small a-muted r-reread-note">{`${REREAD_COST} אם רק מילה שגויה, ״לתקן טקסט״ בחינם.`}</p> : null}
      {mode === "view" && !one && st === "nokey" ? <p className="a-small a-muted">בשאלת נכון או לא נכון ובשאלת התאמה עוד אי אפשר לסמן תשובה ביד.</p> : null}
      {keyByLine(q) || undo ? (
        <p className="r-who a-small">
          {keyByLine(q) ? <span>{keyByLine(q)}</span> : null}
          {undo ? (
            <button type="button" className="a-link" disabled={sending} onClick={() => void run(() => examKeyUndo(q.id), "השינוי בוטל.")}>
              לבטל
            </button>
          ) : null}
        </p>
      ) : null}
      {history.length ? (
        <details className="r-log">
          <summary className="a-small">{history.length === 1 ? "שינוי אחד בתשובה" : `${history.length} שינויים בתשובה`}</summary>
          <ul className="a-stack">
            {history.map((l) => (
              <li key={l.id} className="a-small a-muted">
                {logLine(l)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

/** A change of an item's answer, in the log's words: "נועה: ג׳ במקום א׳" · "נועה: אישור של ב׳" · "נועה: ביטול". */
function logLine(l: KeyLog): string {
  const who = l.by || "חבר או חברה מהקבוצה";
  if (l.undo_of !== null)
    return `${who}: ביטול (${l.origin_new === "solved" && l.new === null ? "חזרה לתשובה המוצעת" : l.new === null ? "בלי תשובה" : `חזרה ל-${letter(l.new)}`})`;
  // A confirmation: the same key, now a member's (a true/false or match item's has no letter).
  if (l.old === l.new && l.origin_old === "solved") return l.new === null ? `${who}: אישור התשובה המוצעת` : `${who}: אישור של ${letter(l.new)}`;
  if (l.new === null) return `${who}: מחיקת התשובה`;
  return l.old !== null ? `${who}: ${letter(l.new)} במקום ${letter(l.old)}` : `${who}: סימון ${letter(l.new)}`;
}
