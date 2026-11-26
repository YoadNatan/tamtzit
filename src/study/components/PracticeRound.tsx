import { useEffect, useMemo, useState } from "react";
import { SOURCE_HE, STYLE_HE, STYLES, sessionCount, sourceCounts, type SessionCount, type Source, type Style } from "../../../shared/study/practice2";
import { isNewStyle, TYPE_GROUPS } from "../../../shared/study/forms";
import type { ScreenProps } from "../features/types";
import { flags } from "../lib/flags";
import { lectureTitles, partTitles } from "../lib/api";
import { sessionCounts } from "../lib/practice2";
import { requestStart, type SessionPick } from "../lib/practiceSession";
import { BackLink, Head, Loading, StickyActions } from "./Shell";

/* ── Practice 2.0: סבב חדש (proposal/practice-2/mockups.html), as in AMBOSS ──
 *
 * ?v=practice&l=<lecture>&x=round: from where (לא נענו · טעיתי · סימנתי ·
 * הכול, each with its count), which parts, which style, how many (5, 10, or
 * all of them), and how: practice (the autopsy after each question) or exam
 * mode (a clock, the autopsies at the end). The counts are the member's own
 * (study_session_counts: only questions a session may ask), and "טעיתי" is
 * "הטעויות שלי"'s rule. "להתחיל" opens the lecture's session with this choice
 * (practiceSession.ts's start request, so "סבב נוסף" keeps it). */

const SOURCES: Source[] = ["new", "wrong", "flagged", "all"];
type Size = "5" | "10" | "all";
/** With practice sets (flags.make, design-practice §5.11): the member's own
 *  sources in one person ("שלא עניתי · שטעיתי · שסימנתי לבדיקה"; a flag is
 *  "סימנתי לבדיקה", never a bookmark). */
const SOURCE_MINE: Record<Source, string> = { new: "שלא עניתי", wrong: "שטעיתי", flagged: "שסימנתי לבדיקה", all: "הכול" };

export default function PracticeRound({ route, ctx }: ScreenProps<"practice">) {
  const lectureId = route.l ?? "";
  const [rows, setRows] = useState<SessionCount[] | null>(null);
  const [title, setTitle] = useState("");
  const [names, setNames] = useState<Record<number, string>>({});
  const [error, setError] = useState(false);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [parts, setParts] = useState<number[] | null>(null);
  const [style, setStyle] = useState<string>("all");
  const [size, setSize] = useState<Size | null>(null);
  const [timed, setTimed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([sessionCounts([lectureId]), lectureTitles([lectureId]).catch(() => ({}) as Record<string, string>), partTitles([lectureId]).catch(() => [])])
      .then(([r, t, p]) => {
        if (!alive) return;
        // A build without the question types never asks one: their counts are not offered.
        setRows(r.filter((x) => x.lecture_id === lectureId && (flags.qtypes || !isNewStyle(x.style))));
        setTitle(t[lectureId] ?? "");
        setNames(Object.fromEntries(p.map((x) => [x.idx, x.title])));
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [lectureId]);

  const present = useMemo(() => [...new Set((rows ?? []).map((r) => r.part_idx))].sort((a, b) => a - b), [rows]);
  const styles = useMemo(() => {
    const have = new Set((rows ?? []).map((r) => r.style));
    return [...STYLES.filter((s) => have.has(s)), ...(have.has("other") ? ["other" as const] : [])];
  }, [rows]);
  // Question types: "סוג שאלה" groups the styles (הכול · אמריקאיות · שאלות על תמונה …), only groups with questions.
  const groups = useMemo(() => {
    const have = new Set((rows ?? []).map((r) => r.style as string));
    return TYPE_GROUPS.filter((g) => g.styles === null || g.styles.some((x) => have.has(x)));
  }, [rows]);
  const chosenParts = parts ?? present;
  const group = flags.qtypes ? groups.find((g) => g.key === style) : undefined;
  const pickStyles = style === "all" ? undefined : flags.qtypes ? (group?.styles ? ([...group.styles] as Array<Style | "other">) : undefined) : [style as Style | "other"];
  const counts = rows ? sourceCounts(rows, { parts: chosenParts, styles: pickStyles }) : null;
  // The default: what was never answered and what was wrong, else everything.
  const from: Source[] = sources ?? (counts && counts.new + counts.wrong > 0 ? ["new", "wrong"] : ["all"]);
  const n = rows ? sessionCount(rows, { sources: from, parts: chosenParts, styles: pickStyles }) : 0;
  // "הכול (n)" only where it differs from a size (§5.11: "10" and "10 · הכול" both read as 10).
  const allShown = !flags.make || (n !== 5 && n !== 10);
  const sizes: Size[] = allShown ? ["5", "10", "all"] : ["5", "10"];
  const chosen: Size = size ?? (n > 10 ? "10" : "all");
  const howMany: Size = chosen === "all" && !allShown ? (String(n) as Size) : chosen;
  const asked = howMany === "all" ? n : Math.min(n, Number(howMany));

  if (error) {
    return (
      <main className="practice-round">
        <Head back={<BackLink go={ctx.go} fallback={{ v: "practice", l: lectureId }} />} title="סבב חדש" />
        <p className="a-error">הספירה לא נטענה. כדאי לבדוק את החיבור ולנסות שוב.</p>
      </main>
    );
  }
  if (!rows || !counts) return <Loading />;

  const toggleSource = (s: Source) => {
    if (s === "all") return setSources(["all"]);
    const cur = from.filter((x) => x !== "all");
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
    setSources(next.length ? next : ["all"]);
  };
  const toggleOne = (p: number) => {
    const next = chosenParts.includes(p) ? chosenParts.filter((x) => x !== p) : [...chosenParts, p].sort((a, b) => a - b);
    setParts(next.length ? next : chosenParts);
  };
  const start = () => {
    const pick: SessionPick = {
      sources: from,
      ...(chosenParts.length < present.length ? { parts: chosenParts } : {}),
      ...(pickStyles ? { styles: pickStyles } : {}),
    };
    const r = { v: "practice" as const, l: lectureId, s: `l.${lectureId}`, n: howMany };
    requestStart(ctx.userId, r, timed, pick);
    ctx.go(r);
  };
  const styleLabel = (s: string) => (s === "case" ? "רק מקרים קליניים" : s === "other" ? "שאלות אחרות" : STYLE_HE[s as Style]);

  return (
    <main className="practice-round">
      <Head
        back={<BackLink go={ctx.go} fallback={{ v: "practice", l: lectureId }} />}
        title={
          <>
            סבב חדש{title ? " · " : ""}
            {title ? <bdi>{title}</bdi> : null}
          </>
        }
      />
      {!present.length ? (
        <section className="a-card dashed">
          <p>עוד אין כאן שאלות לתרגל.</p>
        </section>
      ) : (
        <>
          <div className="a-sec">
            <h2 id="from-h">מאיפה</h2>
          </div>
          <div className="a-wrap pr-sources" role="group" aria-labelledby="from-h">
            {SOURCES.map((s) => {
              const on = from.includes(s);
              return (
                <button key={s} type="button" className={`a-chip${on ? " busy" : ""}`} aria-pressed={on} onClick={() => toggleSource(s)}>
                  {on ? "✓ " : ""}
                  {(flags.make ? SOURCE_MINE : SOURCE_HE)[s]} · {counts[s]}
                </button>
              );
            })}
          </div>

          {present.length > 1 ? (
            <>
              <div className="a-sec">
                <h2 id="parts-h">על מה</h2>
              </div>
              <div className="a-wrap pr-parts" role="group" aria-labelledby="parts-h">
                {present.map((p) => {
                  const on = chosenParts.includes(p);
                  return (
                    <button key={p} type="button" className={`a-chip${on ? " busy" : ""}`} aria-pressed={on} onClick={() => toggleOne(p)}>
                      {on ? "✓ " : ""}
                      <bdi>{names[p] || (p < 0 ? "בלי חלק" : `חלק ${p + 1}`)}</bdi>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {flags.qtypes ? (
            groups.length > 2 ? (
              <>
                <div className="a-sec">
                  <h2 id="type-h">סוג שאלה</h2>
                </div>
                <div className="a-wrap pr-types" role="radiogroup" aria-labelledby="type-h">
                  {groups.map((g) => {
                    const on = style === g.key;
                    return (
                      <button key={g.key} type="button" role="radio" aria-checked={on} className={`a-chip${on ? " busy" : ""}`} onClick={() => setStyle(g.key)}>
                        {on ? "✓ " : ""}
                        {g.he}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null
          ) : styles.length > 1 ? (
            <>
              <div className="a-sec">
                <h2 id="style-h">סגנון</h2>
              </div>
              <div className="a-wrap pr-styles" role="radiogroup" aria-labelledby="style-h">
                {["all", ...styles].map((s) => {
                  const on = style === s;
                  return (
                    <button key={s} type="button" role="radio" aria-checked={on} className={`a-chip${on ? " busy" : ""}`} onClick={() => setStyle(s)}>
                      {on ? "✓ " : ""}
                      {s === "all" ? "הכול" : styleLabel(s)}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          <div className="a-sec">
            <h2 id="size-h">כמה</h2>
          </div>
          <div className="a-seg pr-size" role="radiogroup" aria-labelledby="size-h">
            {sizes.map((x) => (
              <button key={x} type="button" className="a-btn" role="radio" aria-checked={howMany === x} onClick={() => setSize(x)}>
                {x === "all" ? (flags.make ? `הכול (${n})` : `${n} · הכול`) : x}
              </button>
            ))}
          </div>

          <div className="a-sec">
            <h2 id="how-h">איך</h2>
          </div>
          <div className="a-stack pr-mode" role="radiogroup" aria-labelledby="how-h">
            {[
              { exam: false, name: "תרגול", line: "הסבר אחרי כל שאלה" },
              { exam: true, name: "מצב מבחן", line: "עם שעון, ההסברים בסוף" },
            ].map((m) => (
              <button key={m.name} type="button" role="radio" aria-checked={timed === m.exam} className={`a-opt${timed === m.exam ? " picked" : ""}`} onClick={() => setTimed(m.exam)}>
                <span className="l" aria-hidden="true">
                  {timed === m.exam ? "◉" : "○"}
                </span>
                <span>
                  <b>{m.name}</b> · {m.line}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {present.length && !n ? <p className="a-small a-muted pr-none">אין שאלות שמתאימות לבחירה הזו.</p> : null}

      <StickyActions>
        <button type="button" className="a-btn primary wide" disabled={!n} onClick={start}>
          {asked === 1 ? "להתחיל · שאלה אחת" : `להתחיל · ${asked} שאלות`}
        </button>
      </StickyActions>
    </main>
  );
}
