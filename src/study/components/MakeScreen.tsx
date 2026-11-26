import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DIFFICULTIES, FOCUS_MAX, STYLES, type Difficulty, type Options, type PlanAnswer, type Style } from "../../../shared/study/practice2";
import type { ScreenProps } from "../features/types";
import { listLectures, readMarks } from "../lib/api";
import { failCode, failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { hueOf } from "../lib/hue";
import { shrinkImage, toBase64 } from "../lib/images";
import {
  blockOf,
  blockOfCode,
  CUSTOM_MAX,
  defaultLecture,
  factsFor,
  freeWorthIt,
  initialChoices,
  isBig,
  keyAction,
  notesOf,
  offeredStyles,
  partsOf,
  previewOf,
  readSticky,
  SIZES,
  stepSize,
  stylesOf,
  writeSticky,
  type Block,
  type LectureLite,
  type MakeChoices,
} from "../lib/make";
import { listQuestionsByIds, myMistakes, practiceOverview } from "../lib/practice";
import { askPlanInputs, createRequest, markMade, openOnLecture, writeRequest, type OpenOnLecture } from "../lib/practice2";
import { makeGo, makeOpen, previewDaily, previewFree, SETS } from "../lib/setsCopy";
import "../styles/sets.css";
import FailCode from "./FailCode";
import { Icon } from "./Icon";
import { BigSetSheet, LectureSheet, PreviewCard, Price, SizeSeg, TypeChips } from "./MakeParts";
import type { Job } from "./MakeProgress";
import { BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";

/* ── "סט חדש" (practice sets, design §5.3; VITE_STUDY_MAKE) ──
 *
 * ?v=practice&x=new[&l=<lecture>][&from=m]: two decisions before paying,
 * which lecture (the route's, else the last one the member read) and how
 * many (5 · 10 · 20, 10 by default, the device's last size), and the
 * preview: the types, the bank's coverage after the set, and the price on
 * the button. Everything else waits closed under "עוד אפשרויות". The preview
 * is computed on the phone from one free "plan" with its inputs (asked on
 * open and when the lecture changes, D13), so a size or a type costs no call.
 * "ליצור" creates the request and opens "סט בהכנה" (x=bank&r=); when the
 * lecture must be read first, or an example was given, the generating screen
 * reads them as its first phase (D4), then creates. Whatever blocks the
 * button (a line of the budget, the day's sets, a full lecture, a summary
 * still written) says so in words, with the way that is still open. */

const MakeJob = lazy(() => import("./MakeProgress").then((m) => ({ default: m.MakeJob })));

/** The last plan of each lecture this session, so coming back shows it at once. */
const seen = new Map<string, PlanAnswer>();
const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));
const moreKey = (user: string) => `study-make-more:${user}`;

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

/** The block's words. */
const BLOCK_TEXT: Record<Block, string> = {
  notReady: SETS.make.notReady,
  full: SETS.make.full,
  cap: SETS.make.cap,
  capMine: SETS.make.capMine,
  line: SETS.make.line,
  daily: SETS.make.daily,
  tooBig: SETS.make.tooBig,
  noTypes: SETS.make.noTypes,
  noPoints: SETS.make.noPoints,
  off: SETS.make.off,
};

export default function MakeScreen({ route, ctx }: ScreenProps<"practice">) {
  const groupId = ctx.group.id;
  const [lectures, setLectures] = useState<LectureLite[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [listFailed, setListFailed] = useState(false);
  const [picked, setPicked] = useState<string | null>(route.l ?? null);
  const lectureId = route.l ?? picked ?? "";
  const [answer, setAnswer] = useState<PlanAnswer | null>(() => (route.l ? (seen.get(route.l) ?? null) : null));
  const [planError, setPlanError] = useState("");
  const [choices, setChoices] = useState<MakeChoices>(() => initialChoices(readSticky(ctx.userId)));
  const [image, setImage] = useState<{ mediaType: string; data: string } | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [sheet, setSheet] = useState<"lecture" | "big" | null>(null);
  const [creating, setCreating] = useState(false);
  /** Slice B (D6, OD20): the set someone is making on this lecture, from a 409 "already making". */
  const [openSet, setOpenSet] = useState<OpenOnLecture | null>(null);
  const [createError, setCreateError] = useState<{ text: string; code: string; block: Block | null } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [more, setMore] = useState(() => {
    try {
      return localStorage.getItem(moreKey(ctx.userId)) === "1";
    } catch {
      return false;
    }
  });
  const online = useOnline();
  const file = useRef<HTMLInputElement>(null);
  const goRef = useRef<() => void>(() => undefined);

  // The group's lectures (the row's title, the sheet) and their banks' sizes.
  useEffect(() => {
    let alive = true;
    listLectures(groupId)
      .then(async (rows) => {
        if (!alive) return;
        const lite = rows.map((l) => ({ id: l.id, title: l.title, course: l.course ?? "", status: l.status, created_at: l.created_at }));
        setLectures(lite);
        if (!route.l) {
          const marks = await readMarks(lite.map((l) => l.id)).catch(() => []);
          if (!alive) return;
          const id = defaultLecture(
            lite,
            marks.filter((m) => m.user_id === ctx.userId),
          );
          if (id) {
            setPicked(id);
            // The address names the lecture now, so a reload or a shared link opens the same screen.
            ctx.go({ v: "practice", l: id, x: "new", ...(route.from ? { from: route.from } : {}) }, { replace: true });
          }
        }
      })
      .catch(() => alive && setListFailed(true));
    practiceOverview(groupId)
      .then((rows) => alive && setCounts(Object.fromEntries(rows.filter((r) => r.lecture_id).map((r) => [r.lecture_id as string, r.questions]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId]);

  // The plan with its inputs: once per lecture (and again when the connection comes back after a failure).
  const current = useRef(lectureId);
  current.current = lectureId;
  const ask = useCallback(async () => {
    const id = lectureId;
    if (!id) return;
    setPlanError("");
    try {
      const a = await askPlanInputs(id);
      seen.set(id, a);
      // A lecture changed meanwhile: its own answer is on the way.
      if (current.current === id) setAnswer(a);
    } catch (e) {
      if (current.current === id) setPlanError(codeOf(e));
    }
  }, [lectureId]);
  useEffect(() => {
    setAnswer(seen.get(lectureId) ?? null);
    setCreateError(null);
    void ask();
  }, [ask]);
  useEffect(() => {
    if (online && planError) void ask();
  }, [online]);

  // From the mistakes (from=m): the parts that hold the member's open mistakes of this lecture.
  useEffect(() => {
    if (route.from !== "m" || !lectureId) return;
    let alive = true;
    myMistakes(groupId, lectureId)
      .then((m) => listQuestionsByIds(m.map((x) => x.question_id)))
      .then((qs) => {
        if (!alive) return;
        const parts = [...new Set(qs.filter((q) => q.lecture_id === lectureId && q.part_idx !== null).map((q) => Number(q.part_idx)))].sort((a, b) => a - b);
        if (parts.length) setChoices((c) => ({ ...c, parts }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [route.from, lectureId, groupId]);

  const inputs = answer?.inputs ?? null;
  const preview = useMemo(() => (answer && inputs ? previewOf(answer, inputs, { ...choices, exampleImage: Boolean(image) }, flags.qtypes) : null), [answer, inputs, choices, image]);
  const block = answer && inputs && preview ? blockOf(answer, inputs, preview) : null;
  const notes = inputs ? notesOf(inputs) : { low: false, dailyLeft: null };
  const lecture = lectures?.find((l) => l.id === lectureId) ?? null;
  const title = lecture?.title ?? "";
  const set = (f: (c: MakeChoices) => MakeChoices) => {
    setCreateError(null);
    setChoices(f);
  };

  const parts = answer && inputs ? partsOf(inputs, choices.parts) : null;
  const facts = answer && parts ? factsFor(answer, parts.chosen) : null;
  const offered = offeredStyles(flags.qtypes, facts);
  const styles = answer ? stylesOf(choices, answer, offered) : { styles: [] as Style[], from: "default" as const };
  const hasExample = Boolean(choices.exampleText.trim() || image);
  const shownBlock: Block | null = createError?.block ?? block;
  const offline = !online;
  const ready = Boolean(preview && !shownBlock && !offline && !creating && preview.total > 0);

  /** The options "create" sends: the custom level at the size, the chosen parts and types. */
  const options = (): Options => ({
    level: "custom",
    count: Math.max(1, Math.min(CUSTOM_MAX, Math.round(choices.size) || 1)),
    ...(choices.parts && parts && parts.chosen.length < parts.all.length ? { parts: parts.chosen } : {}),
    styles: styles.styles.length ? styles.styles : ["case"],
    difficulty: choices.difficulty,
    focus: choices.focus.trim(),
  });

  const create = async (confirmed = false, force = false) => {
    if (!ready || !preview || !answer) return;
    if (!confirmed && isBig(preview.usd.total)) return setSheet("big");
    writeSticky(ctx.userId, { size: choices.size, ...(choices.styles?.length ? { styles: choices.styles } : {}) });
    const read = answer.points.stale.length > 0;
    if (read || hasExample) {
      // The generating screen reads first (D4), then creates.
      setJob({
        lectureId,
        title,
        options: options(),
        read,
        parts: answer.points.stale.length,
        example: hasExample ? { ...(choices.exampleText.trim() ? { text: choices.exampleText.trim() } : {}), ...(image ? { image } : {}) } : null,
      });
      return;
    }
    setCreating(true);
    setCreateError(null);
    setOpenSet(null);
    try {
      const o = options();
      // Slice B: every new set is on the group's shelf from now on (OD3); its page is ?v=sets&k=.
      const made = await createRequest(lectureId, o, flags.sets ? { set: { want: o.count ?? choices.size }, force } : {});
      if (made.set && !made.request) return ctx.go({ v: "sets", k: made.set.id }, { replace: true });
      markMade(made.request.id);
      // Written from this phone, outside the screen (rounds.ts): "סט בהכנה" shows them arrive.
      void writeRequest(lectureId, made.request.id, made.batches.map((b) => b.id)).catch(() => undefined);
      ctx.go(made.set ? { v: "sets", k: made.set.id } : { v: "practice", l: lectureId, x: "bank", r: made.request.id }, { replace: true });
    } catch (e) {
      const open = openOnLecture(e);
      if (open) {
        setOpenSet(open);
        setCreating(false);
        return;
      }
      const code = codeOf(e);
      const b = blockOfCode(code);
      setCreateError({ text: b ? "" : failText(code, "practice"), code: b ? "" : failCode(e, "practice"), block: b });
      setCreating(false);
      if (code === "points stale") void ask();
    }
  };
  goRef.current = () => void create();

  // The keyboard (pointer: fine): ←/→ the size, Enter creates from the body or the button.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || job || sheet) return;
      const t = e.target as HTMLElement | null;
      const a = keyAction(
        e.key,
        { tag: t?.tagName ?? "BODY", type: (t as HTMLInputElement | null)?.type, editable: Boolean(t?.isContentEditable), isButtonGo: t?.dataset?.go === "1", isBody: !t || t === document.body || t.tagName === "MAIN" },
        { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey },
      );
      if (!a) return;
      e.preventDefault();
      if (a === "go") goRef.current();
      else setChoices((c) => ({ ...c, size: stepSize(c.size, a), custom: false }));
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [job, sheet]);

  const pickImage = async (f: File | undefined) => {
    if (!f) return;
    try {
      const small = await shrinkImage(new Uint8Array(await f.arrayBuffer()), f.type || "image/jpeg");
      setImage({ mediaType: "image/jpeg", data: await toBase64(small.blob) });
    } catch {
      setCreateError({ text: failText("bad example", "practice"), code: "", block: null });
    }
  };
  const toggleMore = (open: boolean) => {
    setMore(open);
    try {
      localStorage.setItem(moreKey(ctx.userId), open ? "1" : "0");
    } catch {
      /* remembered while the screen is open */
    }
  };
  const toggleType = (s: Style) =>
    set((c) => {
      const cur = styles.styles;
      const next = cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : STYLES.filter((x) => x === s || cur.includes(x));
      return { ...c, styles: next };
    });
  const togglePart = (p: number) =>
    set((c) => {
      if (!parts) return c;
      const cur = parts.chosen;
      const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p].sort((a, b) => a - b);
      return { ...c, parts: next.length === parts.all.length || !next.length ? (next.length ? null : cur) : next };
    });

  if (job) {
    return (
      <Suspense fallback={<Loading />}>
        <MakeJob ctx={ctx} job={job} onBack={() => setJob(null)} />
      </Suspense>
    );
  }

  const back = <BackLink go={ctx.go} fallback={lectureId ? { v: "practice", l: lectureId } : { v: "practice" }} />;
  if (!lectureId) {
    // No lecture in the route and none to pick yet (or the group has none).
    return (
      <main className="make-screen">
        <Head back={back} title={SETS.make.title} />
        {listFailed ? (
          <p className="a-error" role="alert">
            {SETS.make.loadFail}
          </p>
        ) : lectures && !lectures.length ? (
          <p className="a-muted">{SETS.make.lectureEmpty}</p>
        ) : (
          <Loading />
        )}
      </main>
    );
  }

  const firstFail = !answer && planError;
  const note = offline && !answer ? (
    <p className="a-small" role="status">
      {SETS.make.offline}
    </p>
  ) : firstFail ? (
    <>
      <p className="a-error" role="alert">
        {SETS.make.loadFail}
      </p>
      <FailCode code={failCode(planError, "practice")} />
      <button type="button" className="a-btn" onClick={() => void ask()}>
        {SETS.make.retry}
      </button>
    </>
  ) : undefined;

  const lines = [
    preview && answer?.points.stale.length ? (
      <p key="read" className="a-small">
        <Icon name="book" size={14} /> {SETS.preview.read}
      </p>
    ) : null,
    preview && hasExample ? (
      <p key="ex" className="a-small">
        {SETS.preview.example}
      </p>
    ) : null,
    preview ? (
      <p key="bank" className="a-small a-muted mk-bank">
        <Icon name="users" size={14} /> {flags.sets ? (route.from ? SETS.preview.sharedMistakes : SETS.preview.shared) : SETS.preview.bank}
      </p>
    ) : null,
    offline && answer ? (
      <p key="off" className="a-small mk-offline" role="status">
        {SETS.make.offline}
      </p>
    ) : null,
    notes.low && !shownBlock ? (
      <p key="low" className="a-small mk-warn">
        {SETS.preview.low}
      </p>
    ) : null,
    notes.dailyLeft !== null && !shownBlock ? (
      <p key="daily" className="a-small a-muted">
        {previewDaily(notes.dailyLeft)}
      </p>
    ) : null,
  ];

  const label = !preview ? SETS.make.computing : creating ? SETS.make.creating : null;
  const goButton = (where: "foot" | "card") =>
    shownBlock === "full" ? (
      <RouteLink to={{ v: "practice", l: lectureId, x: "round" }} go={ctx.go} className={`a-btn primary wide mk-go mk-go-${where}`}>
        {SETS.make.fullGo}
      </RouteLink>
    ) : (
      <button type="button" className={`a-btn primary wide mk-go mk-go-${where}`} data-go="1" disabled={!ready} onClick={() => void create()}>
        {label ?? (
          <span>
            {makeGo(preview!.total)} · <Price dollars={preview!.usd.total} />
          </span>
        )}
      </button>
    );

  const partRows = answer?.parts.filter((p) => p.points > 0 || answer.points.stale.includes(p.part_idx)) ?? [];

  return (
    <main className="make-screen">
      <Head back={back} title={SETS.make.title} />
      <div className="mk-grid">
        <div className="mk-start">
          <div className="a-card flat mk-lecture" data-hue={hueOf(lectureId)}>
            <div className="mk-lecture-t">
              <b dir="auto">{title || "…"}</b>
              {lecture?.course ? (
                <span className="a-small a-muted" dir="auto">
                  {lecture.course}
                </span>
              ) : null}
            </div>
            <button type="button" className="a-link mk-change" onClick={() => setSheet("lecture")} disabled={!lectures}>
              {SETS.make.lectureChange} ‹
            </button>
          </div>

          <div className="mk-field">
            <div className="a-sec">
              <h2 id="mk-size-h">{SETS.make.howMany}</h2>
              {choices.custom ? <span className="a-small a-muted">{choices.size}</span> : null}
            </div>
            <SizeSeg sizes={SIZES} value={choices.size} custom={choices.custom} onPick={(n) => set((c) => ({ ...c, size: n, custom: false }))} />
            <p className="a-small a-muted mk-keys" aria-hidden="true">
              {SETS.make.keys}
            </p>
          </div>

          {shownBlock ? (
            <div className="a-callout warn mk-block" role="status">
              {BLOCK_TEXT[shownBlock]}
            </div>
          ) : null}
          {openSet ? (
            <div className="a-callout warn mk-open" role="status">
              <b>{makeOpen(openSet.author_name ?? "", openSet.made, openSet.want)}</b>
              <div className="a-row">
                <RouteLink to={{ v: "sets", k: openSet.set_id }} go={ctx.go} className="a-btn small">
                  {SETS.make.openGo}
                </RouteLink>
                <button type="button" className="a-link" onClick={() => void create(true, true)}>
                  {SETS.make.openForce}
                </button>
              </div>
            </div>
          ) : null}
          {createError?.text ? (
            <>
              <p className="a-error" role="alert">
                {createError.text}
              </p>
              <FailCode code={createError.code} />
            </>
          ) : null}
          {inputs && freeWorthIt(inputs.free) && shownBlock !== "full" ? (
            <RouteLink to={{ v: "practice", l: lectureId, x: "round" }} go={ctx.go} className="a-small a-link mk-free">
              {previewFree(inputs.free ?? 0)} · {SETS.preview.freeGo} ‹
            </RouteLink>
          ) : null}

          <details className="mk-more" open={more} onToggle={(e) => toggleMore((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>{SETS.make.more}</summary>
            <div className="mk-more-body">
              <div className="mk-field">
                <div className="a-sec">
                  <h3 id="mk-level-h">{SETS.make.level}</h3>
                </div>
                <div className="a-seg mk-level" role="radiogroup" aria-labelledby="mk-level-h">
                  {DIFFICULTIES.map((d: Difficulty) => (
                    <button key={d} type="button" className="a-btn" role="radio" aria-checked={choices.difficulty === d} onClick={() => set((c) => ({ ...c, difficulty: d }))}>
                      {SETS.make.levels[d]}
                    </button>
                  ))}
                </div>
              </div>

              {answer ? <TypeChips offered={offered} chosen={styles.styles} from={styles.from} onToggle={toggleType} onReset={() => set((c) => ({ ...c, styles: null }))} /> : null}

              {partRows.length > 1 ? (
                <div className="mk-field">
                  <div className="a-sec">
                    <h3 id="mk-parts-h">{SETS.make.parts}</h3>
                  </div>
                  <ul className="a-list mk-parts" aria-labelledby="mk-parts-h">
                    {partRows.map((p) => {
                      const on = !parts || parts.chosen.includes(p.part_idx);
                      return (
                        <li key={p.part_idx}>
                          <label className="a-li mk-part">
                            <input type="checkbox" checked={on} onChange={() => togglePart(p.part_idx)} />
                            <span dir="auto">{p.title || `חלק ${p.part_idx + 1}`}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div className="mk-field">
                <div className="a-sec">
                  <h3 id="mk-ex-h">{SETS.make.example}</h3>
                  {hasExample ? <span className="a-small a-muted">{SETS.make.exampleNote}</span> : null}
                </div>
                <div className="a-row mk-ex-btns" role="group" aria-labelledby="mk-ex-h">
                  <button type="button" className="a-btn" aria-expanded={showPaste || Boolean(choices.exampleText)} onClick={() => setShowPaste(true)}>
                    {SETS.make.examplePaste}
                  </button>
                  <button type="button" className="a-btn" onClick={() => file.current?.click()}>
                    {SETS.make.examplePhoto}
                  </button>
                </div>
                <p className="a-small a-muted">{SETS.make.examplePhotoHint}</p>
                {showPaste || choices.exampleText ? (
                  <>
                    <label className="sr-only" htmlFor="mk-example">
                      {SETS.make.example}
                    </label>
                    <textarea
                      id="mk-example"
                      className="a-input"
                      rows={4}
                      maxLength={3000}
                      dir="rtl"
                      placeholder={SETS.make.examplePlaceholder}
                      value={choices.exampleText}
                      onChange={(e) => {
                        const exampleText = e.target.value;
                        set((c) => ({ ...c, exampleText }));
                      }}
                    />
                  </>
                ) : null}
                {image ? (
                  <div className="a-row">
                    <span className="a-chip">{SETS.make.exampleAdded}</span>
                    <button type="button" className="a-link" onClick={() => setImage(null)}>
                      {SETS.make.exampleRemove}
                    </button>
                  </div>
                ) : null}
                <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" hidden onChange={(e) => void pickImage(e.target.files?.[0])} />
              </div>

              <label className="a-field mk-field">
                <span>{SETS.make.focus}</span>
                <input
                  className="a-input"
                  dir="rtl"
                  maxLength={FOCUS_MAX}
                  placeholder={SETS.make.focusPlaceholder}
                  value={choices.focus}
                  onChange={(e) => {
                    const focus = e.target.value;
                    set((c) => ({ ...c, focus }));
                  }}
                />
              </label>

              <label className="a-field mk-field mk-custom">
                <span>{SETS.make.custom}</span>
                <input
                  className="a-input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={CUSTOM_MAX}
                  value={choices.custom ? choices.size : ""}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    if (!e.target.value) return set((c) => ({ ...c, custom: false, size: (SIZES as readonly number[]).includes(c.size) ? c.size : 10 }));
                    set((c) => ({ ...c, custom: true, size: Math.max(1, Math.min(CUSTOM_MAX, v || 1)) }));
                  }}
                />
              </label>
            </div>
          </details>
        </div>

        <div className="mk-end">
          <PreviewCard title={title} preview={preview} loading={!preview && !note} note={note} lines={lines} action={goButton("card")} />
        </div>
      </div>

      <StickyActions>{goButton("foot")}</StickyActions>

      {sheet === "lecture" && lectures ? (
        <LectureSheet
          lectures={lectures}
          counts={counts}
          current={lectureId}
          onClose={() => setSheet(null)}
          onPick={(id) => {
            setSheet(null);
            if (id === lectureId) return;
            setPicked(id);
            // Another lecture's parts are not this one's.
            setChoices((c) => ({ ...c, parts: null }));
            ctx.go({ v: "practice", l: id, x: "new" }, { replace: true });
          }}
        />
      ) : null}
      {sheet === "big" && preview ? <BigSetSheet dollars={preview.usd.total} onClose={() => setSheet(null)} onGo={() => void create(true)} /> : null}
    </main>
  );
}
