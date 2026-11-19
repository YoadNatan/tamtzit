import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { batchCost, cardUsd, type DeckSize } from "../../../shared/study/batch";
import { createLecture, getLecture, groupSpent, health, listLectures } from "../lib/api";
import { BATCH_MAX, clearBatch, markFile, newBatch, pickAgain, readBatch, remaining, resumeLine, sameFile, settle, writeBatch, type Batch } from "../lib/batch";
import { courseKey, coursesOf } from "../lib/courses";
import { guideMark } from "../lib/guideMark";
import { baseName, deckSize, figuresOf, fileProblem, readDeck } from "../lib/readDeck";
import { afterUpload, writingHelp } from "../features/writing";
import type { Ctx } from "../features/types";
import { BackLink, Head, RouteLink, StickyActions } from "./Shell";
import "../styles/courses.css";

/* ── "העלאה של כמה קבצים" (sources.md, phase 1; mockups batch.html, batch-progress.html) ──
 *
 * ?v=upload&many=1 (&c=<course id> from the course page): many lectures at
 * once, each a row with its type ("הרצאה"; past exams come with phase 2).
 * Every file is read here first, so the price is on the screen before
 * anything goes: "סיכומים ל-8 הרצאות: כ-$7 · נשארו החודש $24", and the
 * summaries that do not fit this month's budget wait for the next one (the
 * lectures themselves upload now). Then one file at a time, through the same
 * steps as one lecture's upload (its slides and pictures, the lecture, the
 * summary queued): "קוראים קובץ 4 מתוך 14 · כדאי להשאיר את המסך פתוח".
 *
 * Before the first file the list is written on the phone (lib/batch.ts); a
 * tab closed half way comes back to "הועלו 3. נשארו 11 קבצים · לבחור אותם
 * שוב", and the files picked again skip the ones already up. */

type RowState = "reading" | "ready" | "bad" | "already" | "waiting" | "uploading" | "done" | "failed";
type Row = { key: string; file: File; state: RowState; slides?: number; size?: DeckSize; note?: string; saved?: { done: number; total: number } };

const keyOf = (f: File) => `${f.name}|${f.size}`;
const ext = (name: string) => /\.(pptx|pdf)$/i.exec(name)?.[0] ?? "";

let wakeLock: { release(): Promise<void> } | null = null;
async function holdScreen(on: boolean): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
  try {
    if (on && !wakeLock && nav.wakeLock && document.visibilityState === "visible") wakeLock = await nav.wakeLock.request("screen");
    if (!on && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release();
    }
  } catch {
    wakeLock = null; // not allowed here: the batch runs anyway
  }
}

/** "$24" (from $5 down: "$3.40"), never more than what is left. */
const leftUsd = (usd: number) => (usd >= 5 ? `$${Math.floor(usd)}` : `$${(Math.floor(usd * 100) / 100).toFixed(2)}`);

export default function UploadMany({ ctx, courses, courseId }: { ctx: Ctx; courses: string[]; courseId: string | null }) {
  const groupId = ctx.group.id;
  const [course, setCourse] = useState("");
  const [cid, setCid] = useState<string | null>(courseId);
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<"pick" | "running" | "done">("pick");
  const [resume, setResume] = useState<Batch | null>(null);
  const [money, setMoney] = useState<{ spent: number; cap: number } | null>(null);
  const [current, setCurrent] = useState(0);
  const [note, setNote] = useState("");
  const reading = useRef<Promise<void>>(Promise.resolve());
  const serverWrites = writingHelp().serverWrites;

  // The course (from the course page), a batch that stopped half way, the month's money.
  useEffect(() => {
    let alive = true;
    (async () => {
      let name = "";
      if (courseId) {
        const rows = await coursesOf(groupId).catch(() => []);
        name = rows.find((r) => r.id === courseId)?.name ?? "";
      }
      let b = readBatch(groupId);
      if (b && courseId && b.courseId !== courseId && courseKey(b.course) !== courseKey(name)) b = null; // another course's batch
      if (b && remaining(b).length) {
        // A lecture whose insert got there while the tab was closing is up.
        const ids = new Set((await listLectures(groupId).catch(() => [])).map((l) => l.id));
        const { batch, landed } = settle(b, ids);
        if (landed.length) {
          writeBatch(groupId, batch);
          for (const e of landed) void getLecture(e.id ?? "").then((l) => l && afterUpload(l, [])).catch(() => undefined);
        }
        b = remaining(batch).length ? batch : null;
        if (!b) clearBatch(groupId);
      } else if (b) {
        clearBatch(groupId);
        b = null;
      }
      if (!alive) return;
      if (b) {
        setResume(b);
        setCourse(b.course);
        setCid(b.courseId ?? courseId);
      } else setCourse(name);
    })();
    Promise.all([groupSpent(groupId).catch(() => null), health()])
      .then(([spent, h]) => alive && spent !== null && typeof h?.budgetUsd === "number" && setMoney({ spent, cap: h.budgetUsd }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId, courseId]);

  // Leaving the screen ends the wake lock.
  useEffect(() => () => void holdScreen(false), []);

  const patch = useCallback((key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r))), []);

  /** Reads each new file in turn (its slides, characters, pictures), then lets it go: the upload reads it again. */
  const readAll = useCallback(
    (list: Row[]) => {
      reading.current = reading.current.then(async () => {
        for (const r of list) {
          if (r.state !== "reading") continue;
          try {
            const parsed = await readDeck(r.file);
            const size = deckSize(parsed);
            patch(r.key, { state: "ready", slides: size.slides, size });
          } catch {
            patch(r.key, { state: "bad", note: "לא הצלחנו לקרוא את הקובץ. אפשר לייצא אותו ל-PDF ולנסות שוב." });
          }
        }
      });
    },
    [patch],
  );

  const pick = (list: FileList | null) => {
    if (!list?.length) return;
    setNote("");
    let files = [...list];
    const added: Row[] = [];
    let skipped = 0;
    if (resume) {
      const got = pickAgain(resume, files);
      skipped = got.already.length;
      files = [...got.todo, ...got.extra];
    }
    const have = new Set(rows.map((r) => r.key));
    const room = BATCH_MAX - rows.length;
    let over = 0;
    for (const f of files) {
      if (have.has(keyOf(f))) continue;
      if (added.length >= room) {
        over++;
        continue;
      }
      have.add(keyOf(f));
      const problem = fileProblem(f);
      added.push({ key: keyOf(f), file: f, state: problem ? "bad" : "reading", note: problem || undefined });
    }
    setRows((rs) => [...rs, ...added]);
    const notes = [
      skipped ? (skipped === 1 ? "קובץ אחד כבר הועלה, ודילגנו עליו." : `${skipped} קבצים כבר הועלו, ודילגנו עליהם.`) : "",
      over ? `אפשר עד ${BATCH_MAX} קבצים בכל פעם. ${over === 1 ? "קובץ אחד לא נוסף" : `${over} קבצים לא נוספו`}.` : "",
    ].filter(Boolean);
    setNote(notes.join(" "));
    readAll(added);
  };

  const ready = rows.filter((r) => r.state === "ready" || r.state === "waiting" || r.state === "uploading" || r.state === "done" || r.state === "failed");
  const toUpload = rows.filter((r) => r.state === "ready");
  const stillReading = rows.some((r) => r.state === "reading");
  const cost = useMemo(
    () => (toUpload.length ? batchCost(toUpload.map((r) => r.size!), { spentUsd: money?.spent ?? 0, capUsd: money?.cap ?? Number.POSITIVE_INFINITY }) : null),
    [toUpload, money],
  );
  // The summaries past this month's budget, in upload order (the last ones).
  const fits = cost && money ? toUpload.length - cost.waiting : toUpload.length;
  const waitsNextMonth = (key: string) => phase === "pick" && money !== null && toUpload.findIndex((r) => r.key === key) >= fits;

  const start = async (list: Row[]) => {
    const name = course.trim();
    if (!name || !list.length) return;
    setPhase("running");
    setNote("");
    window.scrollTo({ top: 0 }); // the progress card, at the top
    void holdScreen(true);
    // The resume list, before the first file goes: the stopped batch's, with what was added.
    let batch: Batch =
      resume && courseKey(resume.course) === courseKey(name)
        ? { ...resume, files: [...resume.files, ...newBatch(name, cid, list.filter((r) => !resume.files.some((e) => sameFile(e, r.file))).map((r) => r.file)).files] }
        : newBatch(name, cid, list.map((r) => r.file));
    writeBatch(groupId, batch);
    setResume(null);
    for (const r of list) patch(r.key, { state: "waiting" });
    let n = 0;
    for (const r of list) {
      setCurrent(++n);
      patch(r.key, { state: "uploading", saved: { done: 0, total: r.slides ?? 0 } });
      try {
        const id = crypto.randomUUID();
        batch = markFile(batch, r.file, { id });
        writeBatch(groupId, batch);
        const parsed = await readDeck(r.file);
        const { lecture, figurePaths } = await createLecture(
          { groupId, title: baseName(r.file.name).trim() || r.file.name, lecturer: "", course: name, date: "", sourceName: r.file.name, kind: parsed.kind, slides: parsed.slides, figures: figuresOf(parsed), id },
          (done, total) => patch(r.key, { saved: { done, total } }),
        );
        await afterUpload(lecture, figurePaths).catch(() => undefined);
        batch = markFile(batch, r.file, { done: true });
        writeBatch(groupId, batch);
        patch(r.key, { state: "done" });
      } catch {
        patch(r.key, { state: "failed", note: "לא עלה. אפשר לנסות שוב." });
      }
    }
    guideMark("upload"); // the guide's first step (nothing without VITE_STUDY_GUIDE)
    if (!remaining(batch).length) clearBatch(groupId);
    void holdScreen(false);
    if (!cid) {
      const rows = await coursesOf(groupId).catch(() => []);
      setCid(rows.find((c) => c.name_key === courseKey(name))?.id ?? null);
    }
    setPhase("done");
  };

  const forget = () => {
    clearBatch(groupId);
    setResume(null);
  };

  const running = phase === "running";
  const total = rows.filter((r) => ["waiting", "uploading", "done", "failed"].includes(r.state)).length;
  const done = rows.filter((r) => r.state === "done").length;
  const failed = rows.filter((r) => r.state === "failed");
  const uploading = rows.find((r) => r.state === "uploading");
  const frac = uploading?.saved && uploading.saved.total ? uploading.saved.done / uploading.saved.total : 0;
  const back = cid ? { v: "course" as const, c: cid } : { v: "library" as const };

  return (
    <main className="upload upload-many">
      <Head back={<BackLink go={ctx.go} fallback={back} disabled={running} />} title="העלאה של כמה קבצים" />
      {course.trim() && (cid || phase !== "pick") ? (
        <p className="ph-sub">
          <bdi>{course}</bdi>
        </p>
      ) : null}

      {resume && phase === "pick" ? (
        <section className="a-card u-resume" aria-label="העלאה שנעצרה">
          <p>
            <b>{resumeLine(resume)}</b> · לבחור אותם שוב
          </p>
          <p className="a-small a-muted">
            ההעלאה נעצרה באמצע. בוחרים שוב את אותם קבצים, ומה שכבר עלה מדלגים עליו:{" "}
            {remaining(resume)
              .slice(0, 4)
              .map((f) => baseName(f.name))
              .join(" · ")}
            {remaining(resume).length > 4 ? ` ועוד ${remaining(resume).length - 4}` : ""}
          </p>
          <div className="a-row">
            <button type="button" className="a-btn ghost small" onClick={forget}>
              לא צריך
            </button>
          </div>
        </section>
      ) : null}

      {phase === "pick" ? (
        <>
          {!cid && !resume ? (
            <label className="a-field">
              <span>קורס או בלוק</span>
              <input
                className="a-input"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                list="study-courses-many"
                dir="auto"
                maxLength={120}
                placeholder="למשל: פתוגן-מאכסן"
              />
              <datalist id="study-courses-many">
                {courses.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          ) : null}
          <label className={`a-card dashed drop${rows.length ? " has-file" : ""}`}>
            <input
              type="file"
              multiple
              accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              onChange={(e) => {
                pick(e.target.files);
                e.target.value = "";
              }}
            />
            {resume && !rows.length ? (
              <span>
                <strong>לבחור אותם שוב</strong>
                <br />
                את אותם קבצים, מאיפה שהם שמורים בטלפון
              </span>
            ) : rows.length ? (
              <span>
                <strong>להוסיף עוד</strong>
                <br />
                {`עד ${BATCH_MAX} קבצים בכל פעם`}
              </span>
            ) : (
              <span>
                <strong>בחירת קבצים</strong>
                <br />
                {`מצגות PowerPoint ‏(.pptx) או PDF, עד ${BATCH_MAX} קבצים`}
              </span>
            )}
          </label>
        </>
      ) : null}

      {running ? (
        <section className="a-card x-prog" role="status">
          <span className="x-big">{`קוראים קובץ ${current} מתוך ${total}`}</span>
          <div className="a-bar">
            <i style={{ width: `${Math.round(((done + frac) / Math.max(1, total)) * 100)}%` }} />
          </div>
          <p className="a-small a-muted">
            כדאי להשאיר את המסך פתוח עד שכל הקבצים עולים.{serverWrites ? " את הסיכומים השרת ממשיך גם כשהטלפון סגור." : ""}
          </p>
        </section>
      ) : null}

      {phase === "done" ? (
        <section className="a-card x-prog" role="status">
          <span className="x-big">{done === 1 ? "הועלה קובץ אחד" : `הועלו ${done} קבצים`}</span>
          <p className="a-small a-muted">
            {failed.length
              ? `${failed.length === 1 ? "קובץ אחד לא עלה" : `${failed.length} קבצים לא עלו`}. אפשר לנסות שוב, או לבחור אותם שוב אחר כך.`
              : serverWrites
                ? "הסיכומים נכתבים בשרת. אפשר לסגור את האפליקציה."
                : "כל הרצאה מסוכמת כשפותחים אותה."}
          </p>
          <div className="a-row">
            {failed.length ? (
              <button type="button" className="a-btn" onClick={() => void start(failed)}>
                לנסות שוב
              </button>
            ) : null}
            <RouteLink to={back} go={ctx.go} className="a-btn primary">
              {cid ? "לעמוד הקורס" : "לספרייה"}
            </RouteLink>
          </div>
        </section>
      ) : null}

      {rows.length ? (
        <>
          {phase === "pick" ? (
            <div className="a-sec">
              <h2>{rows.length === 1 ? "נבחר קובץ אחד" : `נבחרו ${rows.length} קבצים`}</h2>
            </div>
          ) : null}
          <section className="a-card u-files" aria-label="הקבצים">
            {rows.map((r) => (
              <FileRow key={r.key} row={r} waits={waitsNextMonth(r.key)} queued={serverWrites} onRemove={phase === "pick" ? () => setRows((rs) => rs.filter((x) => x.key !== r.key)) : undefined} />
            ))}
          </section>
        </>
      ) : null}

      {note ? <p className="a-small a-muted">{note}</p> : null}

      {phase === "pick" && toUpload.length ? (
        <section className="a-card u-cost" aria-label="המחיר מראש">
          <div className="a-sec">
            <h2>המחיר מראש</h2>
          </div>
          <div className="line">
            <span>{toUpload.length === 1 ? "סיכום להרצאה אחת" : `סיכומים ל-${toUpload.length} הרצאות`}</span>
            <b>{`כ-${cardUsd(cost?.summariesUsd ?? 0)}`}</b>
          </div>
          {money ? (
            <div className="line total">
              <span>נשארו החודש</span>
              <b>{leftUsd(cost?.leftUsd ?? 0)}</b>
            </div>
          ) : null}
          {cost && money && cost.waiting ? (
            <p className="a-callout warn">
              {cost.waiting === 1 ? "סיכום אחד יחכה לחודש הבא." : `${cost.waiting} סיכומים יחכו לחודש הבא.`} ההרצאות עצמן עולות עכשיו.
            </p>
          ) : null}
        </section>
      ) : null}

      {phase === "pick" ? (
        <StickyActions>
          {rows.length ? (
            <button type="button" className="a-btn primary wide" disabled={!toUpload.length || stillReading || !course.trim()} onClick={() => void start(toUpload)}>
              {stillReading ? "קוראים את הקבצים…" : toUpload.length === 1 ? "העלאה (קובץ אחד)" : `העלאה (${toUpload.length} קבצים)`}
            </button>
          ) : null}
        </StickyActions>
      ) : null}
      {phase === "pick" && rows.length && !course.trim() && !stillReading ? <p className="a-small a-muted">צריך לכתוב לאיזה קורס הקבצים שייכים.</p> : null}
      {ready.length === 0 && rows.length && !stillReading && phase === "pick" ? <p className="a-small a-muted">אף קובץ לא מוכן להעלאה.</p> : null}
    </main>
  );
}

const STATE: Partial<Record<RowState, { label: string; cls: string }>> = {
  reading: { label: "קוראים…", cls: "a-chip busy" },
  waiting: { label: "מחכה", cls: "a-chip" },
  uploading: { label: "עולה…", cls: "a-chip busy" },
  done: { label: "✓ הועלה", cls: "a-chip ok" },
  failed: { label: "לא עלה", cls: "a-chip bad" },
  already: { label: "כבר הועלה", cls: "a-chip ok" },
};

function FileRow({ row: r, waits, queued, onRemove }: { row: Row; waits: boolean; queued: boolean; onRemove?: () => void }) {
  const e = ext(r.file.name);
  // The file's kind last, so its Latin word never sits between the Hebrew and the number.
  const format = e.toLowerCase() === ".pdf" ? "PDF" : e ? "PowerPoint" : "";
  const line = (...parts: Array<string | false | undefined>) => ["הרצאה", ...parts, format].filter(Boolean).join(" · ");
  const meta =
    r.state === "bad" || r.state === "failed"
      ? r.note
      : r.state === "uploading" && r.saved?.total
        ? line(`שומרים שקפים ${r.saved.done} מתוך ${r.saved.total}`)
        : r.state === "done"
          ? line(queued ? "הסיכום בתור" : `${r.slides ?? r.saved?.total ?? ""} שקפים`)
          : r.slides
            ? line(`${r.slides} שקפים`, waits && "יחכה לחודש הבא")
            : line();
  const chip = STATE[r.state];
  return (
    <div className="u-row" data-file={r.file.name}>
      <div>
        <div className="u-name" dir="auto">
          {e ? r.file.name.slice(0, -e.length) : r.file.name}
        </div>
        <span className={`m${r.state === "bad" || r.state === "failed" ? " bad" : ""}`}>{meta}</span>
      </div>
      <div className="u-end">
        {chip && r.state !== "reading" ? <span className={`${chip.cls} u-state`}>{chip.label}</span> : null}
        {r.state === "reading" ? <span className="a-chip busy u-state">קוראים…</span> : null}
        {onRemove ? (
          <button type="button" className="a-btn ghost icon" aria-label={`להסיר את ${r.file.name}`} onClick={onRemove}>
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}
