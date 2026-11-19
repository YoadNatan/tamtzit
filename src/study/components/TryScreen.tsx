import { useState } from "react";
import type { ScreenProps, ParagraphAction } from "../features/types";
import { flags } from "../lib/flags";
import type { Feedback } from "../lib/practice";
import type { Bet } from "../lib/practiceSession";
import PracticeQuestion from "./PracticeQuestion";
import { BackLink, Head, RouteLink, StickyActions } from "./Shell";
import SummaryView from "./SummaryView";
import "../styles/guide.css";

/* ── "לנסות בלי לחץ" (?v=try; docs/study/guide.md §2.6) ──
 * A sandbox on the device: a paragraph to tap, with the actions it would
 * have, and (with practice) a question to answer with a bet. Both are the
 * app's own components with local data: nothing here is saved, sent, or
 * read from the group (no request at all), and the e2e mock refuses any
 * write while it is open. */

const PARAGRAPH = `## Loop diuretics

Furosemide חוסמת את NKCC2 ב-Thick ascending limb, ולכן היא המשתנת החזקה ביותר. [ש' 7]

שימושים: בצקת ריאות חריפה ואי ספיקת לב. [ש' 7-8]

> שימו לב: hypokalemia היא תופעת הלוואי השכיחה, ולכן בודקים אשלגן. [ש' 8]`;

const WHAT: Record<ParagraphAction, string> = {
  comment: "כאן הייתה נפתחת תגובה או שאלה לקבוצה, וכל הקבוצה הייתה רואה אותה.",
  edit: "כאן היה נפתח ״תיקון״, עם מקור. תיקון אמיתי מחכה לאישור מהקבוצה.",
  mnemonic: "כאן הייתה נכתבת אסוציאציה לקיר של הקבוצה.",
  ask: "כאן ״לשאול״ היה עונה מהשקפים, ונספר ב״נשארו היום״.",
};

const QUESTION = {
  id: "try-1",
  kind: "mcq" as const,
  vignette: "",
  question: "באיזה מקטע של הנפרון פועלת Furosemide?",
  options: ["Thick ascending limb", "Proximal tubule", "Distal convoluted tubule", "Collecting duct", "Glomerulus"],
  slides: [7],
  style: null,
};

const FEEDBACK: Feedback = {
  answer: 0,
  explanations: [
    "Furosemide חוסמת את NKCC2 ב-Thick ascending limb. [ש' 7]",
    "ב-Proximal tubule פועלת Acetazolamide, לא Furosemide.",
    "ב-Distal convoluted tubule פועלות התיאזידים.",
    "ב-Collecting duct פועלת Spironolactone, דרך aldosterone.",
    "ה-Glomerulus מסנן, ושם לא פועלת שום משתנת מהשקפים.",
  ],
  takeaway: "Loop diuretics: Thick ascending limb, והחשש הוא hypokalemia.",
};

export default function TryScreen({ route, ctx }: ScreenProps<"try">) {
  const bets = route.s === "b" && flags.practice;
  const actions: ParagraphAction[] = ["comment", ...(flags.corrections ? (["edit"] as const) : []), ...(flags.wall ? (["mnemonic"] as const) : []), ...(flags.ask ? (["ask"] as const) : [])];
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [bet, setBet] = useState<Bet | null>(null);
  const [answer, setAnswer] = useState<{ chosen: number | null; bet: Bet | null } | null>(null);

  const reset = () => {
    setPicked(null);
    setBet(null);
    setAnswer(null);
  };

  return (
    <main className="try-screen">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "me" }} />} title="לנסות בלי לחץ" />
      <p className="a-callout quiet try-note">כאן הכול לדוגמה: שום דבר לא נשמר ולא נשלח לקבוצה.</p>
      {flags.practice ? (
        <div className="a-seg try-seg" role="tablist" aria-label="מה מנסים">
          <button type="button" className="a-btn" role="tab" aria-selected={!bets} onClick={() => ctx.go({ v: "try" }, { replace: true })}>
            פסקה
          </button>
          <button type="button" className="a-btn" role="tab" aria-selected={bets} onClick={() => ctx.go({ v: "try", s: "b" }, { replace: true })}>
            שאלה עם ׳כמה בטוחים׳
          </button>
        </div>
      ) : null}

      {bets ? (
        <>
          <p className="a-small a-muted">בוחרים תשובה, ואז כמה בטוחים. ׳ניחוש׳ לא נחשב טעות.</p>
          <PracticeQuestion
            q={QUESTION}
            picked={picked}
            bet={bet}
            chosen={answer?.chosen}
            answeredBet={answer?.bet ?? null}
            feedback={answer ? FEEDBACK : null}
            nameOf={() => ""}
            onPick={setPicked}
            onBet={setBet}
            onDontKnow={() => setAnswer({ chosen: null, bet: null })}
            onSlide={() => ctx.say("בהרצאה אמיתית נפתח כאן השקף.")}
            note="לדוגמה, לא נשמר"
          />
          <StickyActions>
            {answer ? (
              <>
                <button type="button" className="a-btn primary wide" onClick={reset}>
                  עוד פעם
                </button>
                {flags.questions ? (
                  <RouteLink to={{ v: "practice" }} go={ctx.go} className="a-btn">
                    לתרגול
                  </RouteLink>
                ) : null}
              </>
            ) : (
              <button type="button" className="a-btn primary wide" disabled={picked === null || bet === null} onClick={() => setAnswer({ chosen: picked, bet })}>
                לבדוק
              </button>
            )}
          </StickyActions>
        </>
      ) : (
        <>
          <p className="a-small a-muted">נוגעים בפסקה, והפעולות שלה נפתחות מתחתיה.</p>
          <article className="lecture-body try-body">
            <section className="part" data-part={0}>
              <SummaryView
                markdown={PARAGRAPH}
                idPrefix="try-"
                selected={selected}
                onBlock={(a) => (setNote(""), setSelected((cur) => (cur === a ? null : a)))}
                actions={actions}
                onAction={(a) => (setSelected(null), setNote(WHAT[a]))}
              />
            </section>
          </article>
          <p className="a-callout try-what" role="status" aria-live="polite" hidden={!note}>
            {note ? `${note} בניסיון שום דבר לא נשלח.` : ""}
          </p>
        </>
      )}
    </main>
  );
}
