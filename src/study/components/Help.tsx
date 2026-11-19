import { useEffect, useRef, useState, type ReactNode } from "react";
import { groupSpent, health } from "../lib/api";
import { HEBREW } from "../lib/bidi";
import { EMAIL_PROVIDER, flags } from "../lib/flags";
import { matches } from "../lib/guide";
import { helpRows, privacyLines } from "../lib/helpCopy";
import { isolateLatin } from "../lib/rich";
import { writingHelp } from "../features/writing";
import type { Ctx } from "../features/types";
import { Head, Sheet } from "./Shell";

/** "$12.40", and a cap of "$33" without cents. */
const dollars = (n: number) => "$" + (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Help's footer for members: "השימוש של הקבוצה החודש: $12.40 מתוך $33". */
export function HelpSpend({ ctx }: { ctx: Ctx }) {
  const [line, setLine] = useState("");
  useEffect(() => {
    let alive = true;
    Promise.all([groupSpent(ctx.group.id), health()])
      .then(([spent, h]) => {
        if (!alive) return;
        const cap = h?.budgetUsd;
        setLine("השימוש של הקבוצה החודש: " + "$" + spent.toFixed(2) + (cap ? " מתוך " + dollars(cap) : ""));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);
  return line ? <>{line}</> : null;
}

/* ── Help and the privacy note (spec §6.2: F renders; §12.7.5) ──
 * The help screen (?v=help, #privacy scrolls to the note), reachable without
 * signing in from Join's "מה נשמר ואיפה"; the note itself; the sheet shown
 * before the first upload and the first recording on a device; and the note
 * alone over the upload form ("מי רואה את הקבצים?"). The rows and lines are
 * lib/helpCopy.ts's, each shown with its flag; what W has shipped comes
 * from W's slot. */

const t = (s: string, k: string) => isolateLatin(s, k);

/** The privacy note; `highlight` marks the recordings line (before the first
 *  recording); a sheet shows the title in its own head (`heading={false}`). */
export function PrivacyNote({ highlight, heading = true }: { highlight?: "recording"; heading?: boolean }) {
  return (
    <div className="privacy-note" dir="rtl">
      {heading ? <h3 className="a-h2">לאן החומר הולך</h3> : null}
      <ul>
        {privacyLines(flags, EMAIL_PROVIDER).map((l) => (
          <li key={l.key} className={highlight === "recording" && l.recording ? "is-highlight" : undefined}>
            <strong>
              {l.name ? <bdi dir={HEBREW.test(l.name) ? undefined : "ltr"}>{l.name}</bdi> : null}
              {l.head}
            </strong>{" "}
            {t(l.text, l.key)}
          </li>
        ))}
      </ul>
    </div>
  );
}

type HelpProps = {
  /** The top bar's back arrow (a signed-out visitor gets one to Join). */
  back: ReactNode;
  /** The spend line for members ("השימוש של הקבוצה החודש: …"); none signed out. */
  footer?: ReactNode;
  /** The guide's "איך עושים…?" for members (VITE_STUDY_GUIDE): its search also
   *  filters the rows below, which then come under "כל ההסברים". */
  howto?: (query: string, onQuery: (q: string) => void) => ReactNode;
};

export default function Help({ back, footer, howto }: HelpProps) {
  const note = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (location.hash !== "#privacy" || !note.current) return;
    note.current.open = true;
    note.current.scrollIntoView({ block: "start" });
  }, []);
  const rows = helpRows(flags, writingHelp());
  const shown = howto && query.trim() ? rows.filter((r) => matches(query, `${r.title} ${r.text ?? ""}`)) : rows;
  return (
    <main className="help">
      <Head back={back} title="עזרה" />
      {howto ? howto(query, setQuery) : null}
      {howto ? (
        <div className="a-sec">
          <h2>כל ההסברים</h2>
        </div>
      ) : null}
      <div className="a-list help-rows">
        {shown.map((r, i) => (
          <details key={r.title} id={r.id} ref={r.id === "privacy" ? note : undefined} open={r.id === "privacy" ? undefined : false}>
            <summary>{r.title}</summary>
            {r.text === null ? <PrivacyNote /> : <p className="a-para">{t(r.text, `h${i}`)}</p>}
          </details>
        ))}
      </div>
      {footer ? <p className="a-small a-muted help-foot">{footer}</p> : null}
    </main>
  );
}

const PRIVACY_KEYS = { upload: "study-privacy-v1", recording: "study-privacy-rec-v1" } as const;

/** Whether this device has seen the note before this kind of upload. */
export function privacySeen(kind: "upload" | "recording"): boolean {
  try {
    return localStorage.getItem(PRIVACY_KEYS[kind]) === "1";
  } catch {
    return false;
  }
}

const NOTE_TITLE = "לאן החומר הולך";

/** Before the first upload (and the first recording) on a device. "הבנתי,
 *  ממשיכים" records that the note was seen and goes on (onOk); "עוד בעזרה"
 *  opens help (onMore); ✕, the backdrop, Escape and Back close it without
 *  either (onClose), so a mistaken tap costs nothing. Both buttons close the
 *  sheet first, so Back from where they lead returns to the screen. */
export function PrivacySheet({ kind, onOk, onMore, onClose }: { kind: "upload" | "recording"; onOk: () => void; onMore: () => void; onClose: () => void }) {
  const ok = () => {
    try {
      localStorage.setItem(PRIVACY_KEYS[kind], "1");
    } catch {
      /* private mode: shown again next time */
    }
  };
  return (
    <Sheet label={NOTE_TITLE} className="privacy-sheet" onClose={onClose} head={<h2>{NOTE_TITLE}</h2>}>
      {(sheet) => (
        <>
          <PrivacyNote highlight={kind === "recording" ? "recording" : undefined} heading={false} />
          <div className="a-row sheet-actions">
            <button type="button" className="a-btn primary wide" onClick={() => (ok(), sheet.closeThen(onOk))}>
              הבנתי, ממשיכים
            </button>
            <button type="button" className="a-btn ghost" onClick={() => sheet.closeThen(onMore)}>
              עוד בעזרה
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** The note alone, over a screen whose work must stay (the upload form's
 *  "מי רואה את הקבצים?"): nothing is recorded, and closing returns to it. */
export function PrivacyNoteSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet label={NOTE_TITLE} className="privacy-sheet" onClose={onClose} head={<h2>{NOTE_TITLE}</h2>}>
      {(sheet) => (
        <>
          <PrivacyNote heading={false} />
          <div className="a-row sheet-actions">
            <button type="button" className="a-btn primary wide" onClick={sheet.close}>
              סגירה
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
