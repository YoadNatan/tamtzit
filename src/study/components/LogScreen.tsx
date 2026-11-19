import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScreenProps } from "../features/types";
import { getLecture, getSections, type Section } from "../lib/api";
import { editGist, listEdits, sourceLine, undoable, undoEdit, type Edit } from "../lib/collab";
import { failText } from "../lib/failText";
import { isolateLatin } from "../lib/rich";
import { CERTAINTY, flagSlide, lectureLog, removeSlideFlag, watchLectureDisputes, type LogEntry, type LogSlide, type LogVerdict } from "../lib/var";
import { BackLink, backTarget, Head, Loading, RouteLink, StickyActions } from "./Shell";
import { timeAgo } from "./Together";
import { SlideTagOf, vText } from "./VerdictCard";
import "../styles/var.css";

/* ── "יומן התיקונים" (?v=log&l=; package V; corrections.html s3's list) ──
 * A lecture's corrections (who corrected, who approved, the source; "ביטול"
 * only on a paragraph's latest correction, never on an undo: §12.3.K's
 * undoable()), the VAR verdicts (both sides, the outcome, the certainty)
 * and "טעות בשקף": slips in the deck itself (slide 28 repeats Quinine,
 * slide 29 says "pyridine"), each undone or put back in one tap. Newest
 * first, live. "כל שינוי ביומן: עם מקור, היסטוריה וביטול בלחיצה." */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");

export default function LogScreen({ route, ctx }: ScreenProps<"log">) {
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [title, setTitle] = useState("");
  const [lastSlide, setLastSlide] = useState(0);
  const [error, setError] = useState("");
  const [flagging, setFlagging] = useState(false);

  const load = useCallback(async () => {
    const [l, e, s] = await Promise.all([lectureLog(route.l), listEdits(route.l), getSections(route.l)]);
    setLog(l);
    setEdits(e);
    setSections(s);
  }, [route.l]);

  useEffect(() => {
    let alive = true;
    load().catch((e) => alive && setError(failText(codeOf(e), "dispute")));
    getLecture(route.l)
      .then((l) => {
        if (!alive || !l) return;
        setTitle(l.title);
        setLastSlide(Math.max(0, ...(l.slides ?? []).map((s) => s.n)));
      })
      .catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchLectureDisputes(route.l, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load().catch(() => undefined), 300);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, [route.l, load]);

  const genOf = useCallback((part: number) => sections.find((s) => s.idx === part)?.gen ?? 0, [sections]);
  const canUndo = useMemo(() => undoable(edits, genOf), [edits, genOf]);
  const run = async (f: () => Promise<unknown>, said?: string) => {
    setError("");
    try {
      await f();
      await load();
      if (said) ctx.say(said);
    } catch (e) {
      setError(failText(codeOf(e), "dispute"));
    }
  };

  // Back to the lecture reads "→ לסיכום", as the approved screens say.
  const backLabel = backTarget({ v: "lecture", l: route.l }).label === "→ להרצאה" ? "→ לסיכום" : undefined;
  return (
    <main className="v-log">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "lecture", l: route.l }} label={backLabel} />} title="יומן התיקונים" />
      <div className="a-sec">
        <h2>
          {/* "ב-Anti parasite" (a Hebrew prefix joins an English name with a hyphen); "ב״משתנים״" otherwise */}
          {!title ? "מה השתנה בהרצאה" : /^[A-Za-z]/.test(title) ? <>מה השתנה ב-<bdi dir="ltr">{title}</bdi></> : <>מה השתנה ב״<bdi>{title}</bdi>״</>}
        </h2>
        <span className="a-small a-muted">יומן התיקונים</span>
      </div>
      {error ? (
        <p className="a-error a-small" role="alert">
          {error}
        </p>
      ) : null}
      {log === null ? (
        error ? null : (
          <Loading />
        )
      ) : log.length === 0 ? (
        <p className="a-small a-muted">עוד אין ביומן תיקונים, הכרעות או טעויות בשקפים.</p>
      ) : (
        <ul className="a-list v-log-list" aria-label="יומן התיקונים">
          {log.map((e) =>
            e.kind === "edit" ? (
              <li key={e.id} className="a-li v-log-row">
                <div>
                  <b dir="rtl">{e.undo_of ? "ביטול של תיקון" : isolateLatin(editGist(e.before, e.after), `le${e.id}`)}</b>
                  <span className="m">
                    {[`${e.undo_of ? "ביטול" : "תיקון"}: ${e.author ?? "ללא שם"}`, e.undo_of ? "" : e.aloud ? "אישור: בקול בפגישה" : `אישור: ${e.approver ?? "ללא שם"}`, sourceLine(e)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="m">{timeAgo(e.at)}</span>
                  <span className="a-row v-log-acts">
                    <RouteLink to={{ v: "lecture", l: route.l, at: { part: e.part, anchor: e.anchor } }} go={ctx.go} className="a-link">
                      לפסקה
                    </RouteLink>
                    {canUndo.has(e.id) && !e.undone ? (
                      <button className="a-link" onClick={() => void run(() => undoEdit(e.id), "התיקון בוטל.")}>
                        ביטול
                      </button>
                    ) : null}
                  </span>
                </div>
                {e.undone ? <span className="a-chip">בוטל</span> : null}
              </li>
            ) : e.kind === "verdict" ? (
              <VerdictRow key={e.id} e={e} go={ctx.go} />
            ) : (
              <SlideRow key={e.id} e={e} onToggle={(remove) => void run(() => removeSlideFlag(e.id, remove), remove ? "הסימון ׳טעות בשקף׳ הוסר." : "הסימון ׳טעות בשקף׳ חזר.")} />
            ),
          )}
        </ul>
      )}
      <p className="a-small a-muted">כל שינוי ביומן: עם מקור, היסטוריה וביטול בלחיצה.</p>
      {flagging ? (
        <SlideFlagForm
          last={lastSlide}
          onCancel={() => setFlagging(false)}
          onSend={async (slides, note) => {
            setError("");
            try {
              await flagSlide(route.l, slides, note);
              setFlagging(false);
              await load();
              ctx.say("נוסף ליומן.");
            } catch (e) {
              setError(failText(codeOf(e), "dispute"));
            }
          }}
        />
      ) : (
        <StickyActions>
          <button className="a-btn primary wide" onClick={() => setFlagging(true)}>
            טעות בשקף
          </button>
        </StickyActions>
      )}
    </main>
  );
}

/** "הכרעה מול השקפים: …" with both sides and the outcome (corrections.html s3). */
function VerdictRow({ e, go }: { e: LogVerdict; go: ScreenProps<"log">["ctx"]["go"] }) {
  const c = e.certainty ? CERTAINTY[e.certainty] : null;
  return (
    <li className="a-li v-log-row">
      <div>
        <b>
          הכרעה מול השקפים
          {e.state === "overridden" ? " · בהרצאה נאמר אחרת" : e.state === "judged" ? " · מחכה להחלטה" : ""}
        </b>
        <span className="m">
          {`${e.name_a ?? "ללא שם"} מול ${e.name_b ?? "ללא שם"}: `}
          {vText(e.summary ?? "", `lv${e.id}`)} <SlideTagOf slides={[...new Set(e.slides)].sort((a, b) => a - b)} />
        </span>
        {e.state === "overridden" && e.decision_note ? <span className="m">{`בהרצאה: `}{vText(e.decision_note, `ln${e.id}`)}</span> : null}
        <span className="a-row v-log-acts">
          <RouteLink to={{ v: "dispute", d: e.id }} go={go} className="a-link">
            למחלוקת
          </RouteLink>
        </span>
      </div>
      {c ? <span className={`a-chip ${c.chip}`.trim()}>{c.short}</span> : null}
    </li>
  );
}

/** "טעות בשקף 28": the deck's own slip; removed in one tap, or put back. */
function SlideRow({ e, onToggle }: { e: LogSlide; onToggle: (remove: boolean) => void }) {
  const head = e.slides.length === 1 ? `טעות בשקף ${e.slides[0]}` : `טעות בשקפים ${e.slides.join(", ")}`;
  return (
    <li className={`a-li v-log-row${e.removed ? " removed" : ""}`}>
      <div>
        <b>{e.removed ? <s>{head}</s> : head}</b>
        <span className="m">
          {vText(e.note, `ls${e.id}`)} <SlideTagOf slides={e.slides} />
        </span>
        <span className="m">{e.removed ? `הוסר: ${e.removed_by ?? "ללא שם"}` : `נוסף: ${e.by ?? "ללא שם"} · ${timeAgo(e.at)}`}</span>
        <span className="a-row v-log-acts">
          <button className="a-link" onClick={() => onToggle(!e.removed)}>
            {e.removed ? "להחזיר" : "ביטול"}
          </button>
        </span>
      </div>
    </li>
  );
}

/** "טעות בשקף": which slides (1-4) and what is wrong on them (5-300 characters). */
function SlideFlagForm({ last, onSend, onCancel }: { last: number; onSend: (slides: number[], note: string) => Promise<void>; onCancel: () => void }) {
  const [spec, setSpec] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const slides = [...new Set(spec.split(/[\s,]+/).filter(Boolean).map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && (!last || n <= last));
  const bad = spec.trim() !== "" && (slides.length === 0 || slides.length > 4);
  return (
    <section className="a-card flat a-stack v-flag-form" aria-label="טעות בשקף">
      <b>טעות בשקף</b>
      <p className="a-small a-muted">טעות בשקפים עצמם: היא נשמרת ביומן של ההרצאה, והסיכום לא משתנה.</p>
      <label className="a-field">
        <span>{last ? `שקף (1-${last}; עד 4, בפסיקים)` : "שקף (עד 4, בפסיקים)"}</span>
        <input className="a-input" inputMode="numeric" dir="ltr" value={spec} onChange={(e) => setSpec(e.target.value)} />
      </label>
      {bad ? <p className="a-small a-error">צריך שקף אחד עד ארבעה מההרצאה.</p> : null}
      <label className="a-field">
        <span>מה לא תקין בשקף</span>
        <textarea className="a-input" dir="auto" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <StickyActions>
        <button className="a-btn ghost" onClick={onCancel}>
          ביטול
        </button>
        <button
          className="a-btn primary wide"
          disabled={busy || bad || !slides.length || note.trim().length < 5}
          onClick={() => {
            setBusy(true);
            void onSend(slides.slice(0, 4), note.trim()).finally(() => setBusy(false));
          }}
        >
          {busy ? "שומר…" : "להוסיף ליומן"}
        </button>
      </StickyActions>
    </section>
  );
}
