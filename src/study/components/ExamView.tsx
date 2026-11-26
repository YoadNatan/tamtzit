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
  unkeyedLine,
  wasConfirmed,
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
import { flags } from "../lib/flags";
import { richText } from "../lib/rich";
import { examKeySet, inexact, pageLines, seqComplete, step, uploadMeta, type UploadKind } from "../lib/sheets";
import { parsePageBox } from "../lib/exams";
import type { ScreenProps } from "../features/types";
import { drives, holdScreen, PageCrop, setDrive } from "./ExamParts";
import PageView from "./PageView";
import { BackLink, Head, Loading, RouteLink } from "./Shell";
import "../styles/exams.css";
import "../styles/sheets.css";

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
 * list under it. "לא לכלול בחישוב הנושאים" at the end.
 *
 * Uploaded sheets (VITE_STUDY_SHEETS, release A0; docs/study/sheets.md): the
 * screen knows an upload's kind (a sheet: "לתרגל כמו בדף", no simulation and
 * no "לא לכלול"); a true/false or match item is keyed by hand
 * (study_exam_key_set); an item whose copy is not in its page's PDF text is
 * "לבדיקה" ("ההעתקה שונה מהטקסט בקובץ", $0, lib/sheets.ts inexact); and from
 * 760 px the review is two columns, the text on the right and the page on
 * the left (PageView), with the keyboard: ↑ ↓ the item before or after, E
 * "לתקן טקסט". No key confirms: "לאשר" changes the answer for the whole
 * group, so it needs its button. */

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
  // Section O 1's kind (with the flag only: a build without it never asks for the column).
  const [kind, setKind] = useState<UploadKind>("exam");
  useEffect(() => {
    if (!flags.sheets) return;
    let alive = true;
    uploadMeta(examId)
      .then((m) => alive && setKind(m.kind))
      .catch(() => undefined); // the words stay a past exam's
    return () => {
      alive = false;
    };
  }, [examId]);
  const sheet = kind === "sheet";

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
        <Head back={back} title={sheet ? "דף תרגילים" : "מבחן קודם"} />
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
        <p className="a-para a-muted x-stalled">{sheet ? "הדף הזה לא עלה עד הסוף. אפשר להעלות אותו שוב מהקורס." : "המבחן הזה לא עלה עד הסוף. אפשר להעלות אותו שוב מהקורס."}</p>
        {courseId ? (
          <RouteLink to={{ v: "exams", isNew: sheet ? "sheet" : true, c: courseId }} go={ctx.go} className="a-btn">
            {flags.sheets ? "העלאת מבחן או דף תרגילים" : "העלאת מבחן קודם"}
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
  // A failed exam (no review) gets a new upload only, no paid re-read (owner's decision): its rows say what failed, without "לנסות שוב".
  const failedEmpty = status.status === "failed" && (review?.items.length ?? 0) === 0;
  const canRetry = !failedEmpty;
  const unitList =
    lines.length && (reading || failed.length) ? (
      <ul className="a-list x-units">
        {lines.map((l) => (
          <li key={l.key} className="a-li">
            <div>
              <b>{l.title}</b>
              <span className="m">
                {l.state === "failed" ? (
                  <span className="a-chip warn">{l.kind === "read" ? "לא נקראו" : "לא הצליח"}</span>
                ) : l.state === "running" ? (
                  "מעתיקים…"
                ) : l.state === "pending" ? (
                  "בתור"
                ) : (
                  ""
                )}
                {/* An expired link is the one failure worth a sentence: "לנסות שוב" brings fresh ones. */}
                {l.state === "failed" && l.error === "pages_expired" ? ` · ${failText(l.error, "exam")}` : ""}
              </span>
            </div>
            {l.state === "failed" && canRetry ? (
              <button type="button" className="a-btn small x-retry" disabled={busy} onClick={() => void retryAll(null)}>
                לנסות שוב
              </button>
            ) : l.state === "failed" ? null : (
              <span className={UNIT_CHIP[l.state]?.cls ?? "a-chip"}>{UNIT_CHIP[l.state]?.label ?? ""}</span>
            )}
          </li>
        ))}
      </ul>
    ) : null;
  // A failed exam with nothing found is not a review: its failure, and a new upload (WP6; no paid re-run).
  // In a review, "לנסות שוב" and its cost sit together in the callout at the top (ExamReviewBody).
  if (!review || reading || failedEmpty) {
    return (
      <main className="exam-review">
        {head}
        {sub}
        {progress}
        {unitList}
        {!reading && status.status === "failed" ? (
          <>
            <p className="a-error" role="alert">
              {failText(status.error ?? "", "exam") || (sheet ? "לא נמצאו שאלות בדף הזה." : "לא נמצאו שאלות במבחן הזה.")}
            </p>
            <div className="a-row">
              <RouteLink to={{ v: "exams", isNew: sheet ? "sheet" : true, c: courseId ?? undefined }} go={ctx.go} className="a-btn primary">
                {sheet ? "להעלות את הדף מחדש" : "להעלות מבחן מחדש"}
              </RouteLink>
            </div>
          </>
        ) : null}
        {reading ? (
          <>
            <div className="a-sec">
              <h2>כשזה נגמר</h2>
            </div>
            <p className="a-small a-muted">
              {sheet
                ? "בסוף יופיע כאן כמה שאלות נמצאו, והדף יופיע לכל הקבוצה בעמוד הקורס, לבדיקה ולתרגול. בשלב הזה מועתקות שאלות הבחירה; שאלות פתוחות וחישובים נספרים בלבד."
                : "לרוב 10–20 דקות. בסוף יופיע כאן כמה שאלות נמצאו, והמבחן יופיע לכל הקבוצה בעמוד הקורס, לבדיקה ולתרגול."}
            </p>
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
      failedParts={failed.length}
      unitList={unitList}
      reload={load}
      retry={retryAll}
      busy={busy}
      sheet={sheet}
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
  failedParts: number;
  reload: () => Promise<ExamStatus | null>;
  retry: (pages: number[] | null) => Promise<void>;
  busy: boolean;
  sheet: boolean;
}) {
  const { ctx, review, status } = p;
  // The copy against its page's PDF text (uploaded sheets, D9): items whose copy is not there are to check too.
  const [lines, setLines] = useState<Map<number, string[]> | null>(null);
  useEffect(() => {
    if (!flags.sheets) return;
    let alive = true;
    pageLines(p.examId)
      .then((m) => alive && setLines(m))
      .catch(() => undefined); // no flags: the review as before
    return () => {
      alive = false;
    };
  }, [p.examId]);
  const off = useMemo(() => (lines ? inexact(review.items, lines) : new Set<string>()), [review.items, lines]);
  const look = (q: ReviewItem) => itemState(q) !== "ok" || off.has(q.id);
  const counts = useMemo(() => {
    const c = reviewCounts(review.items);
    const toCheck = review.items.filter((q) => !q.retired && (itemState(q) !== "ok" || off.has(q.id))).length;
    return { ...c, toCheck, withAnswer: c.found - toCheck };
  }, [review.items, off]);
  const [filter, setFilter] = useState<Filter>(() => (counts.toCheck ? "look" : "all"));
  const [open, setOpen] = useState<string | null>(null);
  const [hidden, setHidden] = useState(review.exam.hidden);
  const [editTick, setEditTick] = useState(0);
  const closed = useRef<string | null>(null);
  const wide = useWide() && flags.sheets;
  const live = review.items.filter((q) => !q.retired);
  // The open item stays in the list until it is closed, even when "לאשר" moved it out of the filter (its "לבטל" with it).
  const shown = live.filter((q) => {
    if (q.id === open) return true;
    const st = itemState(q);
    if (filter === "look") return look(q);
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
  // The wide review's page: the open item's, else the one picked, else the first.
  const readPages = review.pages.filter((x) => !x.key).map((x) => x.n);
  const [pick, setPick] = useState<number | null>(null);
  const openItem = live.find((q) => q.id === open) ?? null;
  const pageNo = (openItem ? (parsePageBox(openItem.figure)?.page ?? openItem.page) : null) ?? pick ?? readPages[0] ?? 1;
  const ids = shown.map((q) => q.id);
  // The keyboard (matched on event.code, so a Hebrew layout works): ↑ ↓ the item before or after, E "לתקן טקסט".
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.code === "ArrowDown" || e.code === "ArrowUp") {
        const next = step(ids, open, e.code === "ArrowDown" ? 1 : -1);
        if (!next || next === open) return;
        e.preventDefault();
        setOpen(next);
      } else if (e.code === "KeyE" && open) {
        e.preventDefault();
        setEditTick((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const chips: Array<{ f: Filter; label: string; n: number }> = [
    { f: "all", label: "הכל", n: counts.found },
    { f: "look", label: "לבדיקה", n: counts.toCheck },
    { f: "suggested", label: "תשובה מוצעת", n: counts.suggested },
    { f: "nokey", label: "בלי תשובה", n: counts.nokey },
  ].filter((c) => c.f === "all" || c.n > 0) as Array<{ f: Filter; label: string; n: number }>;

  return (
    <main className={`exam-review${wide ? " is-wide" : ""}`}>
      {p.head}
      {p.sub}
      <section className="a-card r-sum" aria-label="מה נמצא">
        {/* Pages that were not read: said first, not only as a muted row under the summary (P3). */}
        {p.failedParts ? (
          <div className="a-callout warn r-unread" role="status">
            <p>{p.failedParts === 1 ? "חלק אחד מהמבחן לא נקרא, אז חסרות כאן שאלות." : `${p.failedParts} חלקים מהמבחן לא נקראו, אז חסרות כאן שאלות.`}</p>
            <p className="a-small a-muted x-retry-note">{REREAD_COST}</p>
            <button type="button" className="a-btn small" disabled={p.busy} onClick={() => void p.retry(null)}>
              לנסות שוב
            </button>
          </div>
        ) : null}
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
            {p.sheet ? "לתרגל כמו בדף" : "לתרגל את המבחן"}
          </RouteLink>
        ) : null}
        {/* A session asks only items with an answer (isActive): say so, rather than "1/6" after "12 נמצאו". */}
        {counts.found && unkeyedLine(review.items) ? <p className="a-small a-muted r-nokey-note">{unkeyedLine(review.items)}</p> : null}
        {p.courseId && counts.found >= 5 && !p.sheet ? (
          <RouteLink to={{ v: "mock", c: p.courseId, e: p.examId }} go={ctx.go} className="a-btn wide">
            סימולציה מהמבחן
          </RouteLink>
        ) : null}
      </section>
      {p.unitList}

      {wide ? (
        <div className="rw">
          <div className="rw-text">
      {live.length ? (
        <div className="r-filters" role="radiogroup" aria-label="להראות">
          {chips.map((c) => (
            <button key={c.f} type="button" className={`a-chip r-f-${c.f}`} role="radio" aria-checked={filter === c.f} onClick={() => setFilter(c.f)}>
              {c.label} · {c.n}
            </button>
          ))}
        </div>
      ) : null}

      {shown.length ? (
        <ul className="a-list r-rows">
          {shown.map((q) => (
            <li key={q.id} className="r-row">
              {open === q.id ? (
                <ItemCard {...p} q={q} log={review.key_log} onClose={() => close(q.id)} refresh={refresh} inexact={off.has(q.id)} editTick={editTick} />
              ) : (
                <button type="button" id={`rh-${q.id}`} className="a-li r-head" aria-expanded={false} onClick={() => setOpen(q.id)}>
                  <div>
                    <b>שאלה {q.no}</b>
                    <span className="m" dir="rtl">
                      {firstWords(q.question)}
                    </span>
                    {keyByLine(q, wasConfirmed(review.key_log, q.id)) ? <span className="r-who a-small">{keyByLine(q, wasConfirmed(review.key_log, q.id))}</span> : null}
                  </div>
                  <RowChip q={q} inexact={off.has(q.id)} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="a-para a-muted">{filter === "look" ? "אין שאלות לבדיקה." : "אין כאן שאלות."}</p>
      )}

            <p className="a-small a-muted rw-keys">מקשים: חצים למעלה ולמטה, השאלה הקודמת או הבאה · E: לתקן טקסט.</p>
          </div>
          <aside className="rw-page" aria-label="העמוד">
            <PageView
              groupId={p.groupId}
              examId={p.examId}
              pages={readPages}
              page={pageNo}
              current={open}
              items={live.map((q) => ({ id: q.id, label: `שאלה ${q.no}`, box: parsePageBox(q.figure) }))}
              onPage={(n) => {
                if (open) close(open);
                setPick(n);
              }}
              onPick={(id) => setOpen(id)}
            />
            <ul className="rw-here" aria-label="השאלות בעמוד הזה">
              {live
                .filter((q) => (parsePageBox(q.figure)?.page ?? q.page) === pageNo)
                .map((q) => (
                  <li key={q.id}>
                    <button type="button" className="a-chip" aria-current={q.id === open} onClick={() => setOpen(q.id)}>
                      שאלה {q.no}
                    </button>
                  </li>
                ))}
            </ul>
          </aside>
        </div>
      ) : (
        <>
      {live.length ? (
        <div className="r-filters" role="radiogroup" aria-label="להראות">
          {chips.map((c) => (
            <button key={c.f} type="button" className={`a-chip r-f-${c.f}`} role="radio" aria-checked={filter === c.f} onClick={() => setFilter(c.f)}>
              {c.label} · {c.n}
            </button>
          ))}
        </div>
      ) : null}

      {shown.length ? (
        <ul className="a-list r-rows">
          {shown.map((q) => (
            <li key={q.id} className="r-row">
              {open === q.id ? (
                <ItemCard {...p} q={q} log={review.key_log} onClose={() => close(q.id)} refresh={refresh} inexact={off.has(q.id)} editTick={editTick} />
              ) : (
                <button type="button" id={`rh-${q.id}`} className="a-li r-head" aria-expanded={false} onClick={() => setOpen(q.id)}>
                  <div>
                    <b>שאלה {q.no}</b>
                    <span className="m" dir="rtl">
                      {firstWords(q.question)}
                    </span>
                    {keyByLine(q, wasConfirmed(review.key_log, q.id)) ? <span className="r-who a-small">{keyByLine(q, wasConfirmed(review.key_log, q.id))}</span> : null}
                  </div>
                  <RowChip q={q} inexact={off.has(q.id)} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="a-para a-muted">{filter === "look" ? "אין שאלות לבדיקה." : "אין כאן שאלות."}</p>
      )}

        </>
      )}

      {p.sheet ? null : (
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
      )}
    </main>
  );
}

/** From 760 px wide (iPad portrait and wider): the review in two columns. */
function useWide(): boolean {
  const q = "(min-width: 760px)";
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

function RowChip({ q, inexact: off }: { q: ReviewItem; inexact?: boolean }) {
  const st = itemState(q);
  if (st === "ok" && off) return <span className="a-chip warn">לבדוק מול הדף</span>;
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
  /** Uploaded sheets: the copy is not in its page's PDF text (D9). */
  inexact?: boolean;
  /** Uploaded sheets: E pressed in the wide review ("לתקן טקסט"). */
  editTick?: number;
}) {
  const { q, ctx } = p;
  const [mode, setMode] = useState<"view" | "pick" | "edit" | "seq">("view");
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState({ question: q.question, vignette: q.vignette, options: [...q.options] });
  // A true/false or match item keyed by hand (section O 1): one value a statement, or an option a prompt.
  const size = q.form === "match" ? q.prompts.length : q.options.length;
  const [seqDraft, setSeqDraft] = useState<Array<number | null>>(() => Array.from({ length: size }, (_, i) => q.seq?.[i] ?? null));
  const tick = useRef(p.editTick ?? 0);
  useEffect(() => {
    if ((p.editTick ?? 0) === tick.current) return;
    tick.current = p.editTick ?? 0;
    setMode("edit");
  }, [p.editTick]);
  const st = itemState(q);
  const undo = lastUndoable(p.log, q.id);
  const confirmed = wasConfirmed(p.log, q.id);
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
  const saveSeq = () => {
    const seq = seqComplete(q.form, seqDraft, size);
    if (!seq) return ctx.say(q.form === "tf" ? "צריך לסמן נכון או לא נכון לכל משפט." : "צריך לבחור תשובה לכל שורה.");
    void run(() => examKeySet(q.id, null, seq), "התשובה סומנה.");
  };
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
          {p.inexact ? <p className="a-callout quiet r-exact">ההעתקה שונה מהטקסט בקובץ · כדאי לבדוק מול העמוד.</p> : null}
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
                    {/* Seen, not only heard: which option is the suggested or the marked answer. */}
                    {key ? (
                      <>
                        {" "}
                        <span className={`a-chip r-keytag${st === "suggested" ? " warn" : " ok"}`} aria-hidden="true">
                          {st === "suggested" ? "מוצעת" : "מסומנת"}
                        </span>
                        <span className="sr-only"> (התשובה {st === "suggested" ? "המוצעת" : "המסומנת"})</span>
                      </>
                    ) : null}
                  </span>
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
          {mode === "seq" ? (
            <div className="a-stack">
              <p className="a-small r-pickhint">{q.form === "tf" ? "לכל משפט: נכון או לא נכון. התשובה תשתנה לכל הקבוצה:" : "לכל שורה, התשובה המתאימה. התשובה תשתנה לכל הקבוצה:"}</p>
              <ol className="r-seq">
                {(q.form === "tf" ? q.options : q.prompts).map((t, i) => (
                  <li key={i}>
                    <span className="a-small" dir="rtl">
                      {q.form === "tf" ? `${LETTERS[i]}. ` : `${i + 1}. `}
                      {t}
                    </span>
                    {q.form === "tf" ? (
                      <div className="a-seg" role="radiogroup" aria-label={`משפט ${LETTERS[i]}`}>
                        {[1, 0].map((v) => (
                          <button
                            key={v}
                            type="button"
                            className="a-btn small"
                            role="radio"
                            aria-checked={seqDraft[i] === v}
                            disabled={sending}
                            onClick={() => setSeqDraft((d) => d.map((x, k) => (k === i ? v : x)))}
                          >
                            {v ? "נכון" : "לא נכון"}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <select
                        className="a-input"
                        aria-label={`שורה ${i + 1}`}
                        value={seqDraft[i] ?? ""}
                        disabled={sending}
                        onChange={(e) => setSeqDraft((d) => d.map((x, k) => (k === i ? (e.target.value === "" ? null : Number(e.target.value)) : x)))}
                      >
                        <option value="">לבחור</option>
                        {q.options.map((o, k) => (
                          <option key={k} value={k}>
                            {`${LETTERS[k]}. ${o}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ol>
              <div className="a-row">
                <button type="button" className="a-btn primary small" disabled={sending} onClick={saveSeq}>
                  לשמור
                </button>
                <button type="button" className="a-btn small" disabled={sending} onClick={() => setMode("view")}>
                  ביטול
                </button>
              </div>
            </div>
          ) : null}
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
          ) : flags.sheets && (q.form === "tf" || q.form === "match") ? (
            <button
              type="button"
              className="a-btn small"
              disabled={sending}
              onClick={() => {
                setSeqDraft(Array.from({ length: size }, (_, i) => q.seq?.[i] ?? null));
                setMode("seq");
              }}
            >
              {q.seq?.length ? "לסמן תשובה אחרת" : "לסמן תשובה"}
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
          סגירה
        </button>
      ) : null}
      {/* What a tap here does: the answer changes for the whole group, with the member's name, and can be undone. */}
      {mode === "view" && st === "suggested" ? (
        <p className="a-small a-muted r-group">האפליקציה הציעה את התשובה המסומנת ״מוצעת״. ״לאשר״ או ״לסמן תשובה אחרת״ משנים אותה לכל הקבוצה, עם השם שלך, ואפשר לבטל.</p>
      ) : mode === "view" && (one || flags.sheets) ? (
        <p className="a-small a-muted r-group">סימון תשובה משנה אותה לכל הקבוצה, עם השם שלך, ואפשר לבטל.</p>
      ) : null}
      {mode === "view" && q.page && st === "unclear" && !q.fixed && !q.answered ? <p className="a-small a-muted r-reread-note">{`${REREAD_COST} אם רק מילה שגויה, ״לתקן טקסט״ בחינם.`}</p> : null}
      {mode === "view" && !one && st === "nokey" && !flags.sheets ? <p className="a-small a-muted">בשאלת נכון או לא נכון ובשאלת התאמה עוד אי אפשר לסמן תשובה ביד.</p> : null}
      {keyByLine(q, confirmed) || undo ? (
        <p className="r-who a-small">
          {keyByLine(q, confirmed) ? <span>{keyByLine(q, confirmed)}</span> : null}
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
  const who = l.by || "מהקבוצה";
  if (l.undo_of !== null)
    return `${who}: ביטול (${l.origin_new === "solved" && l.new === null ? "חזרה לתשובה המוצעת" : l.new === null ? "בלי תשובה" : `חזרה ל-${letter(l.new)}`})`;
  // A confirmation: the same key, now a member's (a true/false or match item's has no letter).
  if (l.old === l.new && l.origin_old === "solved") return l.new === null ? `${who}: אישור התשובה המוצעת` : `${who}: אישור של ${letter(l.new)}`;
  if (l.new === null) return `${who}: מחיקת התשובה`;
  return l.old !== null ? `${who}: ${letter(l.new)} במקום ${letter(l.old)}` : `${who}: סימון ${letter(l.new)}`;
}
