import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DIFFICULTIES, DIFFICULTY_HE, LEVEL_HE, REQUEST_MAX, STYLE_HE, STYLES, FOCUS_MAX, type Level, type Style } from "../../../shared/study/practice2";
import type { ScreenProps } from "../features/types";
import { getLecture, type Lecture } from "../lib/api";
import { failText } from "../lib/failText";
import { shrinkImage, toBase64 } from "../lib/images";
import {
  askPlan,
  createRequest,
  loadChoices,
  markMade,
  optionsOf,
  pointParts,
  readPoints,
  readStyle,
  saveChoices,
  usd,
  watchBank,
  writeRequest,
  type Choices,
  type PlanAnswer,
} from "../lib/practice2";
import { dropReading, failedParts, markReading, type PartView, type PointPartRow, pointsReason, readingHere, readProgress, readTime } from "../lib/pointsRead";
import { barLabel, richText } from "../lib/rich";
import { BackLink, Head, Loading, StickyActions } from "./Shell";

/* ── Practice 2.0: מה ליצור and דוגמה ומיקוד (proposal/practice-2/mockups.html) ──
 *
 * ?v=practice&l=<lecture>&x=new: how many questions (ממוקד · מלא · מקיף ·
 * משלי, with the plan's numbers for the material; מלא by default, decision
 * 1), which parts (each with its points to know), which styles (several at
 * once) and the level. Every change asks action "plan" again (free). When
 * the points to know were never read, or a part changed since, the screen
 * says what reading them costs, once for the whole group, and reads them on a
 * tap (action "points"). The server reads each part in its own call, several
 * at once, and goes on when the phone leaves; the screen shows each part's
 * state (ממתין · נקרא… · ✓ N נקודות · לא נקרא, with the reason) from the
 * database (pointsRead.ts), live, on this phone, on a phone that comes back
 * and on another member's; a read the server dropped offers "לנסות שוב".
 * Once server writing finishes a summary the server reads its points ahead
 * by itself (package B, decision 2 of 17 Nov 2026): the screen shows that
 * read's progress the same way, as the server's ("נקראות מעצמן"), and
 * opens with the numbers once it ends.
 *
 * ?v=practice&l=<lecture>&x=example: an example question pasted or
 * photographed, read back ("ככה השאלות ייכתבו: …", action "style"), an
 * optional focus line, and the cost before anything is written ("24 שאלות
 * · כמו במבחן · כ-$0.60"). "ליצור N שאלות" makes the request (action
 * "create"), starts writing its batches from this phone (rounds.ts: the
 * writing goes on outside the screen) and opens הבנק נבנה.
 *
 * The two screens share the choices through sessionStorage (practice2.ts). */

const LEVEL_LINE: Record<Level, string> = {
  focused: "ממוקד: רק החשוב ביותר, דגלים אדומים, התוויות נגד ותרופות לבחירה.",
  full: "מלא: כל נקודה שצריך לדעת מופיעה לפחות פעם. דגלים אדומים תמיד בפנים.",
  deep: "מקיף: כל נקודה שצריך לדעת, מכמה כיוונים.",
  custom: "משלי: מספר שבוחרים, והשאלות הולכות לנקודות החשובות קודם.",
};
const LEVELS: Level[] = ["focused", "full", "deep", "custom"];
const codeOf = (e: unknown) => (e instanceof Error ? e.message : String(e ?? ""));

/** The plan for the choices on screen, asked again (debounced) whenever they
 *  change, and live while points are read anywhere (Realtime on
 *  study_point_parts). `withRows`: also the parts' rows (study_point_parts),
 *  which say which parts the read in progress took. Each ask is numbered:
 *  `applied` is the number of the one on screen, `issued()` the latest asked,
 *  so a caller knows when the screen shows data asked after some moment.
 *  `refresh` resolves to what it put on screen (null: failed or overtaken). */
function usePlan(lectureId: string, choices: Choices, withRows = false) {
  const [plan, setPlan] = useState<PlanAnswer | null>(null);
  const [rows, setRows] = useState<PointPartRow[] | null>(null);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(0);
  const seq = useRef(0);
  const known = useRef<number[] | null>(null);
  const ask = useCallback(async (): Promise<{ plan: PlanAnswer; rows: PointPartRow[] | null } | null> => {
    const n = ++seq.current;
    try {
      // Only parts the summary has: a part chosen on another visit may be gone.
      const parts = choices.parts && known.current ? choices.parts.filter((p) => known.current!.includes(p)) : choices.parts;
      const [p, r] = await Promise.all([
        askPlan(lectureId, optionsOf({ ...choices, parts: parts && parts.length ? parts : null }, { withExample: false })),
        withRows ? pointParts(lectureId).catch(() => null) : Promise.resolve(null),
      ]);
      if (n !== seq.current) return null;
      known.current = p.parts.map((x) => x.part_idx);
      setPlan(p);
      setRows(r);
      setApplied(n);
      setError("");
      return { plan: p, rows: r };
    } catch (e) {
      if (n === seq.current) setError(failText(codeOf(e), "practice"));
      return null;
    }
  }, [lectureId, withRows, JSON.stringify({ ...choices, focus: "", exampleText: "", style: null })]);
  useEffect(() => {
    const t = setTimeout(() => void ask(), plan ? 250 : 0);
    return () => clearTimeout(t);
  }, [ask]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchBank(lectureId, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void ask(), 400);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [lectureId, ask]);
  const issued = useCallback(() => seq.current, []);
  return { plan, rows, error, refresh: ask, applied, issued };
}

/** While points are read: the plan again every few seconds (a Realtime event
 *  missed while the phone slept, a lease that ran out, which no event says),
 *  and at once when the page is shown again. */
function useFollow(active: boolean, refresh: () => Promise<unknown>) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [active, refresh]);
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [refresh]);
}
const POLL_MS = 4_000;
/** The points' stream: the function's 300 s, and a margin. */
const STREAM_MS = 330_000;

/** "6 נקודות", "נקודה אחת". */
const pointsWord = (n: number) => (n === 1 ? "נקודה אחת" : `${n} נקודות`);

/** One part of the read: its title, and its state as a chip; a failure's reason under the title. */
function ReadPart({ v }: { v: PartView }) {
  const chip: Record<PartView["state"], [string, string]> = {
    waiting: ["", "ממתין"],
    reading: ["busy", "נקרא…"],
    ready: ["ok", `✓ ${pointsWord(v.points)}`],
    failed: ["bad", "לא נקרא"],
    stopped: ["warn", "נעצר"],
  };
  const [cls, label] = chip[v.state];
  return (
    <li className="a-li" data-state={v.state}>
      <div>
        <b>
          <bdi>{barLabel(v.title, `t${v.part_idx}-`)}</bdi>
        </b>
        {v.state === "failed" ? <span className="m">{pointsReason(v.error)}</span> : null}
        {v.state === "stopped" ? <span className="m">{pointsReason("stopped")}</span> : null}
      </div>
      <span className={`a-chip${cls ? ` ${cls}` : ""}`}>{label}</span>
    </li>
  );
}

function useLecture(lectureId: string): { lecture: Lecture | null; error: boolean } {
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    getLecture(lectureId)
      .then((l) => alive && (l ? setLecture(l) : setError(true)))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [lectureId]);
  return { lecture, error };
}

/** A toggle chip: "✓ אמבות · 6". */
function Toggle({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`a-chip${on ? " busy" : ""}`} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {on ? "✓ " : ""}
      {children}
    </button>
  );
}

export default function PracticeCreate({ route, ctx }: ScreenProps<"practice">) {
  return route.x === "example" ? <ExampleScreen route={route} ctx={ctx} /> : <SetupScreen route={route} ctx={ctx} />;
}

/* ─────────────────────────── מה ליצור ─────────────────────────── */

function SetupScreen({ route, ctx }: ScreenProps<"practice">) {
  const lectureId = route.l ?? "";
  const { lecture, error: lost } = useLecture(lectureId);
  const [choices, setChoicesState] = useState<Choices>(() => loadChoices(ctx.userId, lectureId));
  const setChoices = (f: (c: Choices) => Choices) =>
    setChoicesState((c) => {
      const next = f(c);
      saveChoices(ctx.userId, lectureId, next);
      return next;
    });
  const { plan, rows, error, refresh, applied, issued } = usePlan(lectureId, choices, true);
  // The stale parts when this phone asked, while its stream is open.
  const [asked, setAsked] = useState<number[] | null>(null);
  const [readError, setReadError] = useState("");
  // This phone's read: seen its claim in the rows (`seen`), or the plan asked
  // after its stream opened (`after`); then the database ends it, not the stream.
  const claim = useRef({ seen: false, after: Infinity });
  const stream = useRef<AbortController | null>(null);
  const claimed = asked !== null && (claim.current.seen || applied >= claim.current.after);
  const progress = plan ? readProgress(plan.parts, rows, asked, claimed) : null;
  useFollow(Boolean(progress?.active), refresh);
  const active = Boolean(progress?.active);
  const live = Boolean(progress?.live);
  useEffect(() => {
    if (asked && live) claim.current.seen = true;
  }, [asked, live]);
  // The read is over in the database (every claimed part saved, failed or
  // dropped) while the stream still hangs (a phone that slept, a connection
  // that died without an error): close it; the screen shows how it ended.
  useEffect(() => {
    if (asked && claimed && !live) stream.current?.abort();
  }, [asked, claimed, live]);
  // Not this phone's read any more (it ended, or it never started): another
  // phone's from now on. Not while the plan could not be asked (offline).
  useEffect(() => {
    if (plan && !active && !asked && !error) dropReading(lectureId);
  }, [plan, active, asked, error, lectureId]);

  // The server reads on whatever happens to this stream: each line only asks
  // for the database's state sooner. The stream opens only after the server
  // claimed the parts and reserved the first call (the read has started).
  const read = async () => {
    if (asked || !plan) return;
    const ctl = new AbortController();
    stream.current = ctl;
    claim.current = { seen: false, after: Infinity };
    setAsked(plan.points.stale);
    setReadError("");
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      markReading(lectureId);
    };
    // A function runs 300 s at most: a stream still open well after that is dead.
    const cap = setTimeout(() => ctl.abort(), STREAM_MS);
    let code = "";
    try {
      await readPoints(
        lectureId,
        (line) => {
          if (line.t === "part" || line.t === "fail") void refresh();
        },
        {
          signal: ctl.signal,
          open: () => {
            start();
            claim.current.after = issued() + 1;
            void refresh();
          },
        },
      );
    } catch (e) {
      if (!ctl.signal.aborted) code = codeOf(e);
    } finally {
      clearTimeout(cap);
      stream.current = null;
    }
    if (code === "network" && !started) {
      // Lost before the answer came: did the ask reach the server? The rows say.
      const now = await refresh();
      if (now && readProgress(now.plan.parts, now.rows, null).live) start();
    }
    // network after the start: the phone lost the stream, not the reading.
    if (code === "network" && started) code = "";
    if (code) {
      dropReading(lectureId);
      // busy: another member's read started first; the screen shows it.
      setReadError(code === "busy" ? "" : code === "network" ? failText("network", "practice") : pointsReason(code));
    }
    // The database's state before `asked` goes, so the screen (and whose read it is) follows it, not the stream.
    await refresh();
    setAsked(null);
  };

  if (lost) {
    return (
      <main className="practice-new">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "practice", l: lectureId }} />} title="שאלות חדשות" />
        <p className="a-error">{failText("lecture not found", "practice")}</p>
      </main>
    );
  }
  if (!lecture || (!plan && !error)) return <Loading />;

  const title = (
    <>
      שאלות חדשות · <bdi>{lecture.title}</bdi>
    </>
  );
  if (!plan) {
    return (
      <main className="practice-new">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "practice", l: lectureId }} />} title={title} />
        <p className="a-error" role="alert">
          {error}
        </p>
        <button type="button" className="a-btn" onClick={() => void refresh()}>
          לנסות שוב
        </button>
      </main>
    );
  }

  const withPoints = plan.parts.filter((p) => p.points > 0);
  const chosenParts = choices.parts?.length ? withPoints.filter((p) => choices.parts!.includes(p.part_idx)) : withPoints;
  const chosenPoints = chosenParts.reduce((n, p) => n + p.points, 0);
  const stale = plan.points.stale.length > 0;
  const prog = progress!;
  const reading = prog.active;
  const stopped = !reading && prog.stopped;
  const mine = asked !== null || readingHere(lectureId);
  // The server's read ahead (package B): started when the summary was written, nobody's tap.
  const ahead = prog.ahead && !mine;
  const failed = reading || stopped ? [] : failedParts(plan.parts);
  const never = plan.points.total === 0;
  const writing = plan.parts.some((p) => p.summary !== "ready");
  const levelCount = (l: Level) => (l === "custom" ? (choices.level === "custom" ? String(choices.count) : "…") : String(plan.levels[l]));
  const ready = !stale && !reading && !stopped && !never && chosenPoints > 0 && choices.styles.length > 0 && plan.plan.total > 0;
  const toggle = <T,>(list: readonly T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const left = prog.parts.filter((v) => v.state === "reading" || v.state === "waiting").length;

  return (
    <main className="practice-new">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "practice", l: lectureId }} />} title={title} />
      <p className="ph-sub">
        <span>{plan.lecture.slides} שקפים</span>
        {plan.points.total ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{plan.points.total} נקודות שצריך לדעת</span>
          </>
        ) : null}
      </p>

      {reading || stopped ? (
        <section className="a-card flat pc-points pc-reading" aria-labelledby="reading-h">
          <h2 id="reading-h" className="a-h2">
            {stopped ? "הקריאה נעצרה באמצע" : `קוראים את הנקודות שצריך לדעת${mine || ahead ? "" : " במכשיר אחר"}…`}
          </h2>
          <p className="a-small" role="status">
            {prog.done} מתוך {prog.total} חלקים
            {reading && left ? ` · ${readTime(left)}` : ""}
            {prog.missed ? ` · ${prog.missed === 1 ? "חלק אחד לא נקרא" : `${prog.missed} לא נקראו`}` : ""}
          </p>
          <div className="a-bar" aria-hidden="true">
            <i style={{ width: `${prog.total ? Math.round((100 * prog.done) / prog.total) : 0}%` }} />
          </div>
          <ul className="a-list pc-read-parts" aria-label="החלקים">
            {prog.parts.map((v) => (
              <ReadPart key={v.part_idx} v={v} />
            ))}
          </ul>
          <p className="a-small a-muted">
            {stopped
              ? "השרת הפסיק לפני שכל החלקים נשמרו. החלקים שכבר נקראו נשארים, ואפשר לקרוא את השאר שוב."
              : ahead
                ? "הסיכום נכתב, אז הנקודות נקראות מעצמן, פעם אחת לכל הקבוצה. אפשר לצאת מהמסך: הוא יתעדכן כשהקריאה תסתיים."
                : mine
                  ? "אפשר לצאת מהמסך או לנעול את הטלפון: הקריאה ממשיכה בשרת, והמסך יתעדכן כשחוזרים."
                  : "המסך יתעדכן כשהקריאה תסתיים."}
          </p>
        </section>
      ) : failed.length ? (
        <section className="a-card flat pc-points pc-failed" aria-labelledby="points-h">
          <h2 id="points-h" className="a-h2">
            {never ? "הנקודות שצריך לדעת לא נקראו" : failed.length === 1 ? "חלק אחד לא נקרא" : `${failed.length} חלקים לא נקראו`}
          </h2>
          <ul className="a-list pc-read-parts" aria-label="החלקים שלא נקראו">
            {failed.map((p) => (
              <ReadPart key={p.part_idx} v={{ part_idx: p.part_idx, title: p.title || `חלק ${p.part_idx + 1}`, state: "failed", points: 0, error: p.error }} />
            ))}
          </ul>
          <p className="a-small a-muted">״לנסות שוב״ קורא רק את החלקים שלא נקראו.</p>
        </section>
      ) : never || stale ? (
        <section className="a-card flat pc-points" aria-labelledby="points-h">
          <h2 id="points-h" className="a-h2">
            {never ? "קודם: הנקודות שצריך לדעת" : "הסיכום תוקן מאז שהנקודות נקראו"}
          </h2>
          <p className="a-small">
            {writing && never
              ? failText("summary not ready", "practice")
              : "מהסיכום נקראות התרופות, המנגנונים, ההתוויות, תופעות הלוואי, התוויות הנגד והמספרים שצריך לזכור. לפיהן נקבע כמה שאלות, והן נקראות פעם אחת לכל הקבוצה."}
          </p>
          {writing && never ? null : <p className="a-small a-muted">כל חלק נקרא בנפרד, כמה בבת אחת: {readTime(plan.points.stale.length)}.</p>}
        </section>
      ) : null}
      {readError || error ? (
        <p className="a-error" role="alert">
          {readError || error}
        </p>
      ) : null}

      {never || reading || stopped ? null : (
        <>
          <div className="a-sec">
            <h2 id="count-h">כמה שאלות</h2>
            <span className="a-small a-muted">לפי החומר</span>
          </div>
          <div className="a-grade pc-levels" role="radiogroup" aria-labelledby="count-h">
            {LEVELS.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={choices.level === l} onClick={() => setChoices((c) => ({ ...c, level: l }))}>
                {LEVEL_HE[l]}
                <small>{levelCount(l)}</small>
              </button>
            ))}
          </div>
          <p className="a-small a-muted pc-level-line">{LEVEL_LINE[choices.level]}</p>
          {choices.level === "custom" ? (
            <label className="a-field pc-count">
              <span>כמה שאלות (עד {REQUEST_MAX})</span>
              <input
                className="a-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={REQUEST_MAX}
                value={choices.count}
                onChange={(e) => setChoices((c) => ({ ...c, count: Math.max(1, Math.min(REQUEST_MAX, Math.round(Number(e.target.value)) || 1)) }))}
              />
            </label>
          ) : null}

          <div className="a-sec">
            <h2 id="parts-h">על מה</h2>
            <span className="a-small a-muted">{chosenPoints} נקודות</span>
          </div>
          <div className="a-wrap pc-parts" role="group" aria-labelledby="parts-h">
            {plan.parts.map((p) => {
              const on = p.points > 0 && (!choices.parts?.length || choices.parts.includes(p.part_idx));
              return (
                <Toggle
                  key={p.part_idx}
                  on={on}
                  disabled={p.points === 0}
                  onClick={() =>
                    setChoices((c) => {
                      const all = withPoints.map((x) => x.part_idx);
                      const cur = c.parts?.length ? c.parts.filter((x) => all.includes(x)) : all;
                      const next = toggle(cur, p.part_idx);
                      return { ...c, parts: next.length === all.length ? null : next.length ? next : cur };
                    })
                  }
                >
                  <bdi>{p.title || `חלק ${p.part_idx + 1}`}</bdi> · {p.points}
                </Toggle>
              );
            })}
          </div>

          <div className="a-sec">
            <h2 id="styles-h">סגנונות</h2>
            <span className="a-small a-muted">אפשר כמה</span>
          </div>
          <div className="a-wrap pc-styles" role="group" aria-labelledby="styles-h">
            {STYLES.map((s: Style) => (
              <Toggle
                key={s}
                on={choices.styles.includes(s)}
                onClick={() => setChoices((c) => ({ ...c, styles: c.styles.includes(s) && c.styles.length === 1 ? c.styles : STYLES.filter((x) => (x === s ? !c.styles.includes(s) : c.styles.includes(x))) }))}
              >
                {STYLE_HE[s]}
              </Toggle>
            ))}
          </div>

          <div className="a-sec">
            <h2 id="diff-h">רמה</h2>
          </div>
          <div className="a-seg pc-difficulty" role="radiogroup" aria-labelledby="diff-h">
            {DIFFICULTIES.map((d) => (
              <button key={d} type="button" className="a-btn" role="radio" aria-checked={choices.difficulty === d} onClick={() => setChoices((c) => ({ ...c, difficulty: d }))}>
                {DIFFICULTY_HE[d]}
              </button>
            ))}
          </div>
        </>
      )}

      <StickyActions>
        {never || stale || reading || stopped ? (
          // The points come first: reading them is this screen's action (its cost on the button);
          // when they are read the same screen opens on the counts.
          <button type="button" className="a-btn primary wide" disabled={reading || plan.points.stale.length === 0 || (writing && never)} onClick={() => void read()}>
            {reading ? (
              "קוראים את הנקודות…"
            ) : (
              <span>
                {stopped || failed.length ? "לנסות שוב" : never ? "לקרוא את הנקודות" : "לקרוא שוב את הנקודות"} · כ-<bdi dir="ltr">{usd(plan.estimate.readUsd)}</bdi>
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            className="a-btn primary wide"
            disabled={!ready}
            onClick={() => {
              saveChoices(ctx.userId, lectureId, choices);
              ctx.go({ v: "practice", l: lectureId, x: "example" });
            }}
          >
            המשך: דוגמה ומיקוד
          </button>
        )}
      </StickyActions>
    </main>
  );
}

/* ─────────────────────────── דוגמה ומיקוד ─────────────────────────── */

function ExampleScreen({ route, ctx }: ScreenProps<"practice">) {
  const lectureId = route.l ?? "";
  const { lecture } = useLecture(lectureId);
  const [choices, setChoicesState] = useState<Choices>(() => loadChoices(ctx.userId, lectureId));
  const setChoices = (f: (c: Choices) => Choices) =>
    setChoicesState((c) => {
      const next = f(c);
      saveChoices(ctx.userId, lectureId, next);
      return next;
    });
  const { plan, error } = usePlan(lectureId, choices);
  const [image, setImage] = useState<{ mediaType: string; data: string; name: string } | null>(null);
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleError, setStyleError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const pickImage = async (f: File | undefined) => {
    if (!f) return;
    setStyleError("");
    try {
      const small = await shrinkImage(new Uint8Array(await f.arrayBuffer()), f.type || "image/jpeg");
      setImage({ mediaType: "image/jpeg", data: await toBase64(small.blob), name: f.name });
      setChoices((c) => ({ ...c, style: null }));
    } catch {
      setStyleError(failText("bad example", "practice"));
    }
  };
  const readExample = async () => {
    const text = choices.exampleText.trim();
    if (styleBusy || (!text && !image)) return;
    setStyleBusy(true);
    setStyleError("");
    try {
      const a = await readStyle(lectureId, { ...(text ? { text } : {}), ...(image ? { image: { mediaType: image.mediaType, data: image.data } } : {}) });
      setChoices((c) => ({ ...c, style: { description: a.description, example: a.example, sig: a.sig } }));
    } catch (e) {
      setStyleError(failText(codeOf(e), "practice"));
    } finally {
      setStyleBusy(false);
    }
  };
  const create = async () => {
    if (creating || !plan) return;
    setCreating(true);
    setCreateError("");
    try {
      const made = await createRequest(lectureId, optionsOf(choices));
      markMade(made.request.id);
      // The batches are written from this phone, outside the screen: the bank shows them arrive.
      void writeRequest(lectureId, made.request.id, made.batches.map((b) => b.id)).catch(() => undefined);
      setChoices((c) => ({ ...c, focus: "", exampleText: "", style: null }));
      ctx.go({ v: "practice", l: lectureId, x: "bank", r: made.request.id }, { replace: true });
    } catch (e) {
      setCreateError(failText(codeOf(e), "practice"));
      setCreating(false);
    }
  };

  if (!lecture || (!plan && !error)) return <Loading />;
  const back = <BackLink go={ctx.go} fallback={{ v: "practice", l: lectureId, x: "new" }} label="→ מה ליצור" />;
  if (!plan) {
    return (
      <main className="practice-new">
        <Head back={back} title="דוגמה ומיקוד" />
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  const n = plan.plan.total;
  const total = plan.estimate.totalUsd || plan.estimate.questionsUsd;
  const spent = plan.spent;
  const stop = spent.groupUsd !== null && spent.groupUsd >= spent.capUsd * spent.share;
  const mineStop = spent.mineUsd !== null && spent.memberShare !== null && spent.mineUsd >= spent.capUsd * spent.memberShare;
  const hasExample = Boolean(choices.exampleText.trim() || image);

  return (
    <main className="practice-new">
      <Head back={back} title="דוגמה ומיקוד" />

      <div className="a-sec">
        <h2 id="example-h">דוגמה לסגנון</h2>
        <span className="a-small a-muted">רשות</span>
      </div>
      <div className="a-card flat pc-example">
        <label className="sr-only" htmlFor="pc-example">
          שאלה ממבחן קודם, עם האפשרויות
        </label>
        <textarea
          id="pc-example"
          className="a-input"
          rows={4}
          maxLength={3000}
          dir="rtl"
          placeholder="להדביק כאן שאלה ממבחן קודם, עם האפשרויות"
          value={choices.exampleText}
          onChange={(e) => {
            const text = e.target.value;
            setChoices((c) => ({ ...c, exampleText: text, style: null }));
          }}
        />
        {image ? (
          <div className="a-row">
            <span className="a-chip">תמונה צורפה</span>
            <button
              type="button"
              className="a-link"
              onClick={() => {
                setImage(null);
                setChoices((c) => ({ ...c, style: null }));
              }}
            >
              להסיר את התמונה
            </button>
          </div>
        ) : null}
        <div className="a-row between">
          <button type="button" className="a-btn ghost pc-photo" onClick={() => file.current?.click()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            {image ? "לצלם שוב" : "או לצלם"}
          </button>
          <button type="button" className="a-btn pc-read" disabled={!hasExample || styleBusy || Boolean(choices.style)} onClick={() => void readExample()}>
            {styleBusy ? "קוראים…" : (
              <>
                <span>
                  לקרוא את הסגנון · כ-<bdi dir="ltr">{usd(plan.estimate.styleUsd)}</bdi>
                </span>
              </>
            )}
          </button>
        </div>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" hidden onChange={(e) => void pickImage(e.target.files?.[0])} />
      </div>
      {styleError ? (
        <p className="a-error" role="alert">
          {styleError}
        </p>
      ) : null}
      {choices.style ? (
        <aside className="a-callout pc-style" dir="rtl">
          <b>ככה השאלות ייכתבו:</b> {richText(choices.style.description, "sd")}
        </aside>
      ) : null}

      <div className="a-sec">
        <h2>על מה להתמקד</h2>
        <span className="a-small a-muted">רשות</span>
      </div>
      <label className="sr-only" htmlFor="pc-focus">
        על מה להתמקד
      </label>
      <input
        id="pc-focus"
        className="a-input pc-focus"
        dir="rtl"
        maxLength={FOCUS_MAX}
        placeholder="למשל: מלריה בהריון, ומה בודקים לפני טיפול"
        value={choices.focus}
        onChange={(e) => {
          const focus = e.target.value;
          setChoices((c) => ({ ...c, focus }));
        }}
      />

      <section className="a-card flat pc-cost" aria-label="מה זה עולה">
        <div className="a-row between">
          <b className="a-small">
            {n} שאלות · {DIFFICULTY_HE[choices.difficulty]}
          </b>
          <span className="a-chip">
            <span>כ-<bdi dir="ltr">{usd(total)}</bdi></span>
          </span>
        </div>
        <p className="a-small a-muted">כל שאלה נבדקת בידי פותר עיוור לפני שהיא נכנסת לבנק. נשמרות לכל הקבוצה.</p>
        {spent.groupUsd !== null ? (
          <p className="a-small a-muted">
            נוצלו החודש <bdi dir="ltr">{usd(spent.groupUsd)}</bdi> מתוך <bdi dir="ltr">{usd(spent.capUsd)}</bdi>.
          </p>
        ) : null}
      </section>
      {stop || mineStop || createError ? (
        <p className="a-error" role="alert">
          {createError || failText(mineStop && !stop ? "member_share" : "reserve", "practice")}
        </p>
      ) : null}

      {hasExample && !choices.style && !styleBusy ? <p className="a-small a-muted pc-hint">כדי ליצור בסגנון של הדוגמה, קודם קוראים אותה. אפשר גם למחוק אותה וליצור בלי.</p> : null}
      <StickyActions>
        <button type="button" className="a-btn primary wide" disabled={creating || stop || mineStop || n < 1 || (hasExample && !choices.style)} onClick={() => void create()}>
          {creating ? "יוצרים…" : `ליצור ${n} שאלות`}
        </button>
      </StickyActions>
    </main>
  );
}
