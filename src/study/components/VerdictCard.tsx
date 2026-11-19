import { isValidElement, type ReactNode } from "react";
import { slideSpec } from "../lib/collab";
import { isolateLatin } from "../lib/rich";
import { CERTAINTY, type Verdict } from "../lib/var";
import "../styles/var.css";

/* ── "הכרעה מול השקפים" (package V; corrections.html s2) ──
 * The verdict as the approved card draws it: its certainty chip ("ודאות:
 * פרשנות"), what the slides say ("כתוב בשקף", each quote with its slides),
 * what is interpretation ("פרשנות"), and "כדאי לשמוע בהקלטה" when the
 * lecturer's words would settle it. A word goes with every colour. */

/** A line written by a member or by VAR, as the summary's lines read:
 *  Latin runs isolated left to right (isolateLatin). A run that is only
 *  numbers ("25%", "20-25%", "6: 10-90%") is split at its spaces, each number
 *  isolated and kept on one line, so a right-to-left line reads "6:" before
 *  "10-90%" and never breaks "20-" from "25%". */
const NUMERIC = /^[\d.,:%\s–-]+$/;
export function vText(text: string, key: string): ReactNode[] {
  return isolateLatin(text, key).flatMap((n, i): ReactNode[] => {
    if (!isValidElement<{ children?: unknown }>(n) || typeof n.props.children !== "string" || !NUMERIC.test(n.props.children)) return [n];
    return n.props.children.split(/([:;,]?\s+)/).map((t, j) =>
      j % 2 ? (
        t
      ) : (
        <bdi key={`${key}n${i}-${j}`} dir="ltr" className="v-num">
          {t}
        </bdi>
      ),
    );
  });
}

export function SlideTagOf({ slides }: { slides: number[] }) {
  if (!slides.length) return null;
  return (
    <span className="a-tag src-tag">
      ש׳ <bdi dir="ltr">{slideSpec(slides)}</bdi>
    </span>
  );
}

export default function VerdictCard({ verdict, id }: { verdict: Verdict; id: string }) {
  const c = CERTAINTY[verdict.certainty] ?? CERTAINTY.unclear;
  return (
    <section className="a-card v-verdict" aria-label="הכרעה מול השקפים">
      <div className="a-row between">
        <b>
          הכרעה מול השקפים
        </b>
        <span className={`a-chip ${c.chip}`.trim()}>{c.label}</span>
      </div>
      <p className="a-small">{vText(verdict.summary, `vs${id}`)}</p>
      {verdict.on_slides.map((x, i) => (
        <p key={`o${i}`} className="a-small v-item">
          <span className="a-chip ok">כתוב בשקף</span> <bdi dir="auto">{vText(x.text, `vo${id}${i}`)}</bdi> <SlideTagOf slides={x.slides} />
        </p>
      ))}
      {verdict.interpretation.map((x, i) => (
        <p key={`i${i}`} className="a-small v-item">
          <span className="a-chip warn">פרשנות</span> {vText(x.text, `vi${id}${i}`)} <SlideTagOf slides={x.slides} />
        </p>
      ))}
      {verdict.listen ? <span className="a-small a-muted">כדאי לשמוע בהקלטה מה נאמר על זה.</span> : null}
    </section>
  );
}

/** "אחרי ׳לקבל׳": what accepting does, with the trap card it adds (corrections.html s2). */
export function AfterAccept({ verdict, id, done }: { verdict: Verdict; id: string; done?: boolean }) {
  return (
    <section className="a-card flat" aria-label="אחרי לקבל">
      <div className="a-row between">
        <b className="a-small">{done ? "התקבלה" : "אחרי ׳לקבל׳"}</b>
        {verdict.trap ? <span className="a-chip group">לתור של כולם</span> : null}
      </div>
      <p className="a-small a-muted">{verdict.trap ? (done ? "ההכרעה הוצמדה לסיכום, ונוספה כרטיסייה על הטעות:" : "ההכרעה תוצמד לסיכום, ותתווסף כרטיסייה על הטעות:") : done ? "ההכרעה הוצמדה לסיכום." : "ההכרעה תוצמד לסיכום."}</p>
      {verdict.trap ? (
        <p className="a-small">
          <b>{vText(verdict.trap.front, `tf${id}`)}</b> {vText(verdict.trap.back.replace(/\s*\[ש['׳][^\]]*\]\s*/g, " ").trim(), `tb${id}`)} <SlideTagOf slides={verdict.trap.slides} />
        </p>
      ) : null}
    </section>
  );
}
