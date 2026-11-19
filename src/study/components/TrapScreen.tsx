import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { tidy } from "../../../shared/study/blocks";
import { blockSources, citedSlides } from "../../../shared/study/edits";
import { TRAPS, trapMeter } from "../../../shared/study/extras";
import type { ScreenProps } from "../features/types";
import { getLecture, getSections, type Lecture, type Section } from "../lib/api";
import { checkTrap, meterRows, myTraps, submitTrap, type MyTrapRow } from "../lib/extras";
import { failText } from "../lib/failText";
import { LETTERS } from "../lib/questionText";
import { isolateLatin, richText } from "../lib/rich";
import { BackLink, Head, Loading, RouteLink, StickyActions } from "./Shell";
import "../styles/extras.css";

/* ── P11 "להוסיף שאלה משלי" (package E; spec §12.6.E) ──
 *
 * ?v=trap&l=<lecture>&at=<part>.<anchor> (from N's "תרגול" tab or a
 * lecture's practice), d=<draft> to fix one. The paragraph quoted; "מקרה (לא
 * חובה)", "השאלה", 4-5 options with "הנכונה", "מה מבלבל בה? (לא חובה)", the
 * slide chips (the paragraph's own tags first); "לבדוק מול השקפים · כ-$0.03"
 * → "בודקים מול השקפים…" → "השאלה נכנסה לבנק של כולם. השם שלך יופיע
 * אחרי שתישאל במבחן קבוצתי." or the problem and "לתקן". Without a paragraph
 * the member picks the part. The meter (decision 3) is the author's own:
 * her traps in the bank, the ones a live quiz already named, the ones to
 * fix, and what is left today. The draft is hers alone until it passes. */

type Phase = { k: "edit" } | { k: "checking" } | { k: "ok" } | { k: "rejected"; problem: string };

const blank = () => ["", "", "", ""];

export default function TrapScreen({ route, ctx }: ScreenProps<"trap">) {
  const lectureId = route.l;
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [mine, setMine] = useState<MyTrapRow[] | null>(null);
  const [error, setError] = useState("");
  const [part, setPart] = useState<number | null>(route.at?.part ?? null);
  const [vignette, setVignette] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(blank);
  const [answer, setAnswer] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [slides, setSlides] = useState<number[]>([]);
  const [draft, setDraft] = useState<string | null>(route.d ?? null);
  const [phase, setPhase] = useState<Phase>({ k: "edit" });
  const [fail, setFail] = useState("");
  const [tried, setTried] = useState(false);
  const loaded = useRef(false);
  const top = useRef<HTMLElement>(null);
  const questionBox = useRef<HTMLTextAreaElement>(null);

  const reload = () =>
    myTraps()
      .then(setMine)
      .catch(() => setMine([]));
  useEffect(() => {
    let alive = true;
    Promise.all([getLecture(lectureId), getSections(lectureId), myTraps().catch(() => [] as MyTrapRow[])])
      .then(([l, s, m]) => {
        if (!alive) return;
        if (!l) setError(failText("lecture not found", "traps"));
        setLecture(l);
        setSections(s);
        setMine(m);
      })
      .catch(() => alive && setError("המסך לא נטען. כדאי לבדוק את החיבור ולנסות שוב."));
    return () => {
      alive = false;
    };
  }, [lectureId]);

  // A draft to fix (d=…): its text comes back into the form, once.
  useEffect(() => {
    if (loaded.current || !mine || !route.d) return;
    const d = mine.find((x) => x.id === route.d);
    if (!d) return;
    loaded.current = true;
    setPart(d.part_idx);
    setVignette(d.vignette);
    setQuestion(d.question);
    setOptions(d.options);
    setAnswer(d.answer);
    setNote(d.note);
    setSlides(d.slides);
    if (d.state === "rejected") setPhase({ k: "rejected", problem: d.problem });
    if (d.state === "ok") setPhase({ k: "ok" });
  }, [mine, route.d]);

  const section = sections?.find((s) => s.idx === part) ?? null;
  const anchor = route.at && route.at.part === part ? route.at.anchor : null;
  const paragraph = useMemo(() => {
    if (!section || anchor === null || section.status !== "ready") return "";
    return blockSources(tidy(section.markdown ?? ""))[anchor]?.text?.trim() ?? "";
  }, [section, anchor]);
  // The slide chips: the paragraph's own tags first, then the part's slides.
  const chips = useMemo(() => {
    const have = new Set((lecture?.slides ?? []).map((s) => s.n));
    const own = citedSlides(paragraph).filter((n) => have.has(n));
    const range = section ? Array.from({ length: Math.max(0, section.slide_to - section.slide_from + 1) }, (_, i) => section.slide_from + i).filter((n) => have.has(n)) : [];
    return [...new Set([...own, ...range, ...slides])].slice(0, 24);
  }, [lecture, paragraph, section, slides]);
  useEffect(() => {
    if (!route.d && paragraph) setSlides((s) => (s.length ? s : citedSlides(paragraph).slice(0, TRAPS.SLIDES_MAX)));
  }, [paragraph, route.d]);

  const back = <BackLink go={ctx.go} fallback={route.at ? { v: "lecture", l: lectureId, at: route.at } : { v: "practice", l: lectureId }} />;
  if (error) {
    return (
      <main className="trap-screen">
        <Head back={back} title="שאלה משלי" />
        <p className="a-error" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!lecture || !sections || !mine) return <Loading />;

  const meter = trapMeter(meterRows(mine), Date.now());
  const here = mine.filter((m) => m.lecture_id === lectureId);
  const filled = options.map((o) => o.trim());
  const problems = [
    question.trim().length < TRAPS.QUESTION_MIN || !/\?\s*$/.test(question.trim()) ? "השאלה צריכה להסתיים בסימן שאלה." : "",
    filled.filter(Boolean).length < options.length ? "כל התשובות צריכות טקסט." : "",
    new Set(filled.map((o) => o.toLowerCase())).size < filled.length ? "התשובות צריכות להיות שונות זו מזו." : "",
    answer === null ? "צריך לסמן את התשובה הנכונה." : "",
    !slides.length ? "צריך לבחור לפחות שקף אחד." : "",
    part === null ? "צריך לבחור חלק." : "",
  ].filter(Boolean);
  const editable = phase.k === "edit" || phase.k === "rejected";

  const send = async () => {
    setTried(true);
    if (problems.length || part === null || answer === null) return;
    setFail("");
    setPhase({ k: "checking" });
    let id = draft;
    try {
      id = await submitTrap({
        draft,
        lectureId,
        part,
        anchor,
        quote: paragraph.slice(0, 200),
        vignette: vignette.trim(),
        question: question.trim(),
        options: filled,
        answer,
        note: note.trim(),
        slides,
      });
      setDraft(id);
      ctx.go({ v: "trap", l: lectureId, at: route.at, d: id }, { replace: true });
      const v = await checkTrap(id);
      setPhase(v.ok ? { k: "ok" } : { k: "rejected", problem: v.problem });
      top.current?.focus();
    } catch (e) {
      setPhase({ k: "edit" });
      setFail(failText(e instanceof Error ? e.message : "", "traps"));
    } finally {
      void reload();
    }
  };
  const fresh = () => {
    setDraft(null);
    setVignette("");
    setQuestion("");
    setOptions(blank());
    setAnswer(null);
    setNote("");
    setSlides(paragraph ? citedSlides(paragraph).slice(0, TRAPS.SLIDES_MAX) : []);
    setTried(false);
    setPhase({ k: "edit" });
    ctx.go({ v: "trap", l: lectureId, at: route.at }, { replace: true });
  };
  const toggleSlide = (n: number) =>
    setSlides((s) => (s.includes(n) ? s.filter((x) => x !== n) : s.length >= TRAPS.SLIDES_MAX ? s : [...s, n].sort((a, b) => a - b)));

  return (
    <main className="trap-screen">
      <Head
        back={back}
        title={
          <>
            שאלה משלי · <bdi>{lecture.title}</bdi>
          </>
        }
      />
      <p className="ph-sub trap-meter">
        <span>{meter.line || "עוד אין שאלה שלך בבנק"}</span>
        <span className="a-chip">רק לך</span>
      </p>
      {meter.next ? <p className="a-small a-muted trap-next">{meter.next}</p> : null}

      {phase.k === "ok" ? (
        <section className="a-card trap-done" aria-labelledby="trap-done-h">
          <h2 id="trap-done-h" className="a-h2" tabIndex={-1} ref={top as RefObject<HTMLHeadingElement>}>
            <span className="a-chip ok">✓ נבדקה מול השקפים</span>
          </h2>
          <p className="a-para">השאלה נכנסה לבנק של כולם. השם שלך יופיע אחרי שתישאל במבחן קבוצתי.</p>
          <div className="a-row">
            <button type="button" className="a-btn" onClick={fresh}>
              עוד שאלה
            </button>
            <RouteLink to={{ v: "practice", l: lectureId }} go={ctx.go} className="a-btn ghost">
              לתרגול של ההרצאה
            </RouteLink>
          </div>
        </section>
      ) : null}

      {phase.k === "rejected" ? (
        <aside className="a-callout warn trap-problem" role="alert">
          <b ref={top} tabIndex={-1}>
            לא עברה את הבדיקה
          </b>{" "}
          <span dir="rtl">{richText(phase.problem || "לפי השקפים משהו בשאלה לא מדויק.", "p")}</span>
          <span className="a-small a-muted"> הטיוטה נשמרה, רק אצלך.</span>
          <div className="a-row">
            <button type="button" className="a-btn small" onClick={() => questionBox.current?.focus()}>
              לתקן
            </button>
          </div>
        </aside>
      ) : null}

      {phase.k !== "ok" ? (
        <form
          className="a-stack trap-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {paragraph ? (
            <aside className="a-callout quiet trap-quote">
              <span className="a-small a-muted">על הפסקה</span>
              <p className="a-para" dir="rtl">
                {richText(paragraph, "q")}
              </p>
            </aside>
          ) : (
            <div className="a-stack">
              <span className="a-small a-muted" id="trap-part">
                על איזה חלק?
              </span>
              <div className="a-wrap" role="group" aria-labelledby="trap-part">
                {sections.map((s) => (
                  <button key={s.idx} type="button" className={`a-chip${part === s.idx ? " busy" : ""}`} aria-pressed={part === s.idx} disabled={!editable} onClick={() => setPart(s.idx)}>
                    {part === s.idx ? "✓ " : ""}
                    {isolateLatin(s.title || `חלק ${s.idx + 1}`, `p${s.idx}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="a-field">
            <span>מקרה (לא חובה)</span>
            <textarea className="a-input" rows={2} value={vignette} maxLength={TRAPS.VIGNETTE_MAX} disabled={!editable} onChange={(e) => setVignette(e.target.value)} dir="rtl" />
          </label>
          <label className="a-field">
            <span>השאלה</span>
            <textarea ref={questionBox} className="a-input" rows={2} value={question} maxLength={TRAPS.QUESTION_MAX} disabled={!editable} onChange={(e) => setQuestion(e.target.value)} dir="rtl" />
          </label>
          <fieldset className="a-stack trap-options">
            <legend className="a-small a-muted">התשובות · מסמנים את הנכונה</legend>
            {options.map((o, i) => (
              <div key={i} className="a-row trap-option">
                <span className="l">{LETTERS[i]}</span>
                <input
                  className="a-input"
                  value={o}
                  maxLength={TRAPS.OPTION_MAX}
                  aria-label={`תשובה ${LETTERS[i]}`}
                  disabled={!editable}
                  onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                  dir="rtl"
                />
                <label className="a-choice trap-key">
                  <input type="radio" name="trap-key" checked={answer === i} disabled={!editable} onChange={() => setAnswer(i)} />
                  <span>הנכונה</span>
                </label>
              </div>
            ))}
            {options.length < TRAPS.OPTIONS_MAX && editable ? (
              <button type="button" className="a-link" onClick={() => setOptions((all) => [...all, ""])}>
                + תשובה חמישית
              </button>
            ) : options.length > TRAPS.OPTIONS_MIN && editable ? (
              <button
                type="button"
                className="a-link"
                onClick={() => {
                  setOptions((all) => all.slice(0, TRAPS.OPTIONS_MIN));
                  setAnswer((a) => (a !== null && a >= TRAPS.OPTIONS_MIN ? null : a));
                }}
              >
                בלי התשובה החמישית
              </button>
            ) : null}
          </fieldset>
          <label className="a-field">
            <span>מה מבלבל בה? (לא חובה)</span>
            <input className="a-input" value={note} maxLength={TRAPS.NOTE_MAX} disabled={!editable} onChange={(e) => setNote(e.target.value)} placeholder="למשל: רוב האנשים בוחרים ECG" dir="rtl" />
          </label>
          <div className="a-stack">
            <span className="a-small a-muted" id="trap-slides">
              מאיזה שקף? (עד {TRAPS.SLIDES_MAX})
            </span>
            <div className="a-wrap" role="group" aria-labelledby="trap-slides">
              {chips.map((n) => (
                <button key={n} type="button" className={`a-chip${slides.includes(n) ? " busy" : ""}`} aria-pressed={slides.includes(n)} disabled={!editable} onClick={() => toggleSlide(n)}>
                  {slides.includes(n) ? "✓ " : ""}ש׳ <bdi dir="ltr">{n}</bdi>
                </button>
              ))}
            </div>
          </div>
          {tried && problems.length ? (
            <p className="a-error" role="alert">
              {problems[0]}
            </p>
          ) : null}
          {fail ? (
            <p className="a-error" role="alert">
              {fail}
            </p>
          ) : null}
          <p className="a-small a-muted">הטיוטה גלויה רק לך. אחרי הבדיקה היא נכנסת לבנק של כולם בלי שם, והשם מופיע רק אחרי שהשאלה נשאלה במבחן קבוצתי.</p>
        </form>
      ) : null}

      {here.length ? (
        <section className="a-stack trap-mine" aria-labelledby="trap-mine-h">
          <div className="a-sec">
            <h2 id="trap-mine-h">השאלות שלי בהרצאה</h2>
            <span className="a-chip">רק לך</span>
          </div>
          <ul className="a-list">
            {here.map((m) => (
              <li key={m.id} className="a-li trap-row">
                <div>
                  <b dir="rtl">{isolateLatin(m.question, `m${m.id}`)}</b>
                  <span className="m">
                    {m.state === "ok" ? (m.unmasked ? "בבנק · נשאלה במבחן קבוצתי, עם השם שלך" : "בבנק · בלי שם עד מבחן קבוצתי") : m.state === "rejected" ? "מחכה לתיקון" : "טיוטה, עוד לא נבדקה"}
                  </span>
                </div>
                {m.state !== "ok" && m.id !== draft ? (
                  <RouteLink to={{ v: "trap", l: lectureId, d: m.id, ...(m.anchor !== null ? { at: { part: m.part_idx, anchor: m.anchor } } : {}) }} go={ctx.go} className="a-btn small">
                    {m.state === "rejected" ? "לתקן" : "לבדוק"}
                  </RouteLink>
                ) : m.state === "ok" ? (
                  <span className={`a-chip${m.unmasked ? " ok" : ""}`}>{m.unmasked ? "✓ עם שם" : "בבנק"}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {phase.k !== "ok" ? (
        <StickyActions>
          <button type="button" className="a-btn primary wide" disabled={phase.k === "checking" || (meter.leftToday === 0 && !draft)} onClick={() => void send()}>
            {phase.k === "checking" ? (
              "בודקים מול השקפים…"
            ) : (
              <>
                {phase.k === "rejected" ? "לתקן ולבדוק שוב" : "לבדוק מול השקפים"} · כ-<bdi dir="ltr">${TRAPS.CHECK_USD.toFixed(2)}</bdi>
              </>
            )}
          </button>
        </StickyActions>
      ) : null}
    </main>
  );
}
