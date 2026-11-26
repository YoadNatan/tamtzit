import { useMemo, useState, type ReactNode } from "react";
import { STYLE_HE, type Style } from "../../../shared/study/practice2";
import { hueOf } from "../lib/hue";
import { lectureGroups, type LectureLite, type Preview } from "../lib/make";
import { usd } from "../lib/practice2";
import { about, makeBig, previewCover, previewHead, questionsWord, SETS } from "../lib/setsCopy";
import { Icon } from "./Icon";
import { Sheet } from "./Shell";

/* ── The parts of "סט חדש" (practice sets, design §5.3-5.4) ──
 * The preview card (what the set will be, computed on the phone), the
 * lecture sheet ("איזו הרצאה"), the type chips of "עוד אפשרויות" and the
 * confirmation of a set above $1 (OD17). Kit classes and tokens only; the
 * placement is styles/sets.css. */

/** A price as the screens print it, in its own LTR run: "כ-$0.40". */
export function Price({ dollars }: { dollars: number }) {
  return (
    <span className="mk-price">
      {about("")}
      <bdi dir="ltr">{usd(dollars)}</bdi>
    </span>
  );
}

/** One small tile per question, coloured by its type group, then the legend
 *  ("6 אמריקאית · 3 מקרה"). Decorative tiles; the legend says it in words. */
function TypeTiles({ groups }: { groups: Preview["groups"] }) {
  if (!groups.length) return null;
  return (
    <div className="mk-types">
      <div className="mk-tiles" aria-hidden="true">
        {groups.flatMap((g) => Array.from({ length: Math.min(g.n, 40) }, (_, i) => <i key={`${g.key}${i}`} data-g={g.key} />))}
      </div>
      <p className="a-small mk-legend">
        {groups.map((g, i) => (
          <span key={g.key}>
            {i ? <span aria-hidden="true"> · </span> : null}
            <i className="mk-dot" data-g={g.key} aria-hidden="true" />
            {g.n} {g.he}
          </span>
        ))}
      </p>
    </div>
  );
}

/** The preview: what the set will be, before anything is spent. `lines` go
 *  under it (the read, the example, little headroom, sets left today);
 *  `action` is the create button at L (the bar at the bottom elsewhere). */
export function PreviewCard({
  title,
  preview,
  loading,
  note,
  lines,
  action,
}: {
  title: string;
  preview: Preview | null;
  loading: boolean;
  /** Instead of the preview (offline, a failed load). */
  note?: ReactNode;
  lines: ReactNode[];
  action?: ReactNode;
}) {
  return (
    <section className="a-card mk-preview" aria-labelledby="mk-preview-h" aria-busy={loading || undefined}>
      <h2 id="mk-preview-h" className="a-h2">
        {preview ? (
          previewHead(preview.total, title)
        ) : (
          <>
            {SETS.preview.label}
            {title ? <> · {title}</> : null}
          </>
        )}
      </h2>
      {note ? (
        <div className="mk-note">{note}</div>
      ) : !preview ? (
        <div className="mk-skel" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <>
          <TypeTiles groups={preview.groups} />
          <p className="a-small mk-check">
            <Icon name="check" size={14} /> {SETS.preview.check}
          </p>
          {preview.estimated ? null : preview.cover.full ? (
            <p className="a-small mk-cover">{SETS.preview.coverFull}</p>
          ) : (
            <div className="mk-cover">
              <div className="a-bar" role="img" aria-label={previewCover(preview.cover.percent)}>
                <i style={{ width: `${preview.cover.percent}%` }} />
              </div>
              <p className="a-small" aria-hidden="true">
                {previewCover(preview.cover.percent)}
              </p>
            </div>
          )}
        </>
      )}
      {lines.filter(Boolean).length ? <div className="mk-lines">{lines}</div> : null}
      {action ? <div className="mk-go-in">{action}</div> : null}
    </section>
  );
}

/** The size control: 5 · 10 · 20 ("מספר אחר" is in "עוד אפשרויות"). */
export function SizeSeg({ sizes, value, custom, onPick }: { sizes: readonly number[]; value: number; custom: boolean; onPick: (n: number) => void }) {
  return (
    <div className="a-seg mk-size" role="radiogroup" aria-labelledby="mk-size-h">
      {sizes.map((n) => (
        <button key={n} type="button" className="a-btn" role="radio" aria-checked={!custom && value === n} aria-label={questionsWord(n)} onClick={() => onPick(n)}>
          {n}
        </button>
      ))}
    </div>
  );
}

/** "סוגי שאלות": one chip group, the chosen ones checked; whether they are
 *  the lecture's defaults or the member's last ones, and the way back. */
export function TypeChips({ offered, chosen, from, onToggle, onReset }: { offered: readonly Style[]; chosen: readonly Style[]; from: "default" | "last"; onToggle: (s: Style) => void; onReset: () => void }) {
  return (
    <div className="mk-field">
      <div className="a-sec">
        <h3 id="mk-types-h">{SETS.make.types}</h3>
        <span className="a-small a-muted">
          {from === "last" ? (
            <>
              {SETS.make.typesLast} ·{" "}
              <button type="button" className="a-link" onClick={onReset}>
                {SETS.make.typesReset}
              </button>
            </>
          ) : (
            SETS.make.typesDefault
          )}
        </span>
      </div>
      <div className="a-wrap mk-chips" role="group" aria-labelledby="mk-types-h">
        {offered.map((s) => {
          const on = chosen.includes(s);
          return (
            <button key={s} type="button" className={`a-chip${on ? " busy" : ""}`} aria-pressed={on} onClick={() => onToggle(s)}>
              {on ? "✓ " : ""}
              {STYLE_HE[s]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "איזו הרצאה": the group's lectures by course, a search, each with its
 *  bank's size; a 560 px dialog from 768 px (the kit's sheet). */
export function LectureSheet({
  lectures,
  counts,
  current,
  onPick,
  onClose,
}: {
  lectures: readonly LectureLite[];
  counts: Readonly<Record<string, number>>;
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => lectureGroups(lectures, q), [lectures, q]);
  return (
    <Sheet label={SETS.make.lectureSheet} className="mk-sheet" onClose={onClose} head={<h2>{SETS.make.lectureSheet}</h2>}>
      {(sheet) => (
        <>
          <label className="sr-only" htmlFor="mk-search">
            {SETS.make.lectureSearch}
          </label>
          <input id="mk-search" className="a-input mk-search" type="search" dir="rtl" placeholder={SETS.make.lectureSearch} value={q} onChange={(e) => setQ(e.target.value)} />
          {!lectures.length ? <p className="a-muted">{SETS.make.lectureEmpty}</p> : !groups.length ? <p className="a-muted">{SETS.make.lectureNotFound}</p> : null}
          <div className="mk-sheet-list" role="radiogroup" aria-label={SETS.make.lectureSheet}>
            {groups.map((g) => (
              <section key={g.course || "-"} className="mk-course">
                {g.course ? (
                  <h3 className="a-small mk-course-h" dir="auto">
                    {g.course}
                  </h3>
                ) : null}
                <ul className="a-list">
                  {g.lectures.map((l) => {
                    const n = counts[l.id] ?? 0;
                    const sub = l.status !== "ready" ? SETS.make.lectureNoSummary : n ? questionsWord(n) : SETS.make.lectureNone;
                    return (
                      <li key={l.id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={l.id === current}
                          className="a-li mk-lecture-opt"
                          data-hue={hueOf(l.id)}
                          onClick={() => sheet.closeThen(() => onPick(l.id))}
                        >
                          <span className="mk-radio" aria-hidden="true" />
                          <span className="mk-lecture-t">
                            <b dir="auto">{l.title}</b>
                            <span className="m">{sub}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

/** A set above $1 (OD17): "סט גדול · כ-$1.10 מתקציב הקבוצה", create or not now. */
export function BigSetSheet({ dollars, onGo, onClose }: { dollars: number; onGo: () => void; onClose: () => void }) {
  const [before, after] = makeBig("\u0000").split("\u0000");
  return (
    <Sheet label={SETS.make.bigGo} className="mk-big" onClose={onClose} head={<h2>{SETS.entry}</h2>}>
      {(sheet) => (
        <>
          <p className="mk-big-line">
            {before}
            <bdi dir="ltr">{usd(dollars)}</bdi>
            {after}
          </p>
          <div className="a-row sheet-actions">
            <button type="button" className="a-btn primary" onClick={() => sheet.closeThen(onGo)}>
              {SETS.make.bigGo}
            </button>
            <button type="button" className="a-btn ghost" onClick={sheet.close}>
              {SETS.make.bigNo}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
