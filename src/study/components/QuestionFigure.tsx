import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Box } from "../../../shared/study/figureGeo";
import type { ImageLayout, LabelLayout, Layout } from "../../../shared/study/forms";
import { figurePathOf, figureUrls } from "../lib/api";
import { Sheet } from "./Shell";

/* ── A question's picture (docs/study/question-types.md) ──
 *
 * The slide's picture drawn on a white "paper" stage (slides are light, in
 * either theme): an SVG with the stage's own viewBox, the whole stored
 * picture placed and clipped to its visible frame, the slide's lines, and
 * white masks over printed labels (a PDF page). The numbered pins are HTML
 * buttons placed by percent in a left-to-right box, so the page's
 * right-to-left direction never mirrors the coordinates. In tap mode
 * ("באיזה מספר מסומן X?") a pin is a radio of the question's group; in name
 * mode ("מה מסומן במספר 3?") the pins only show, the asked one ringed. After
 * the answer each pin says ✓ or ✗ in a glyph, never colour alone. "להגדיל"
 * opens the same stage twice as wide in a sheet. The picture's alt is
 * generic: its caption could give the answer away. */

/** Signed picture URLs, cached for the visit (each is signed for six hours). */
const urls = new Map<string, Promise<string | null>>();
export function figureUrl(path: string): Promise<string | null> {
  let u = urls.get(path);
  if (!u) {
    u = figureUrls([path])
      .then((m) => m[path] ?? null)
      .catch(() => {
        urls.delete(path);
        return null;
      });
    urls.set(path, u);
  }
  return u;
}

/** A picture that is part of a question: its layout or, for a plain question about a picture, its figure id alone. */
export type FigureProps = {
  groupId: string;
  lectureId: string | null;
  figure: string;
  layout: Layout | null | undefined;
  /** "fig:3-1" → slide 3, for the alt text. */
  /** Tap mode: the pin picked (its index), and the pick. */
  picked?: number | null;
  onPick?: (i: number) => void;
  /** After the answer: the right pin and the chosen one (indexes), and each pin's name to show then. */
  answered?: { right: number; chosen: number | null; names?: string[] } | null;
  disabled?: boolean;
  /** The question's lead-in id (a tap radiogroup is labelled by it). */
  labelledBy?: string;
};

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

function Stage(p: FigureProps & { url: string | null; big?: boolean }) {
  const lay = p.layout && (p.layout.kind === "label" || p.layout.kind === "image") ? p.layout : null;
  const label = lay?.kind === "label" ? (lay as LabelLayout) : null;
  const image = lay?.kind === "image" ? (lay as ImageLayout) : null;
  const W = label ? label.stage.w : 1000;
  const H = label ? label.stage.h : 750;
  const crop: Box = image?.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const pins = label?.pins ?? [];
  const tap = label?.mode === "tap";
  const group = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const n = Number(/^fig:(\d+)-/.exec(p.figure)?.[1] ?? 0);
  const alt = `שרטוט משקף ${n || ""}${pins.length ? `, עם ${pins.length} מספרים` : ""}`.replace(" ,", ",");

  // Arrows move between pins in pin order (as the options' radio group).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!tap || !p.onPick) return;
    const keys: Record<string, number> = { ArrowDown: 1, ArrowLeft: 1, ArrowUp: -1, ArrowRight: -1 };
    if (!(e.key in keys)) return;
    const items = [...(group.current?.querySelectorAll<HTMLButtonElement>("button.qf-pin") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = (at + keys[e.key] + items.length) % items.length;
    items[next]?.focus();
    p.onPick(next);
  };

  // An image item: the stored picture as an <img>, cropped by a window over it (its natural size gives the ratio), masks over its text.
  if (!label) {
    const ratio = natural ? (natural.w * crop.w) / (natural.h * crop.h) : 4 / 3;
    return (
      <div className={`qf-stage qf-photo${p.big ? " big" : ""}`} style={{ aspectRatio: String(ratio) }} dir="ltr">
        {p.url ? (
          <div className="qf-crop" style={{ width: pct(1 / crop.w), height: pct(1 / crop.h), left: pct(-crop.x / crop.w), top: pct(-crop.y / crop.h) }}>
            <img src={p.url} alt={alt} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 4, h: e.currentTarget.naturalHeight || 3 })} />
            {(image?.masks ?? []).map((m, i) => (
              <span key={i} className="qf-mask-box" style={{ left: pct(m.x), top: pct(m.y), width: pct(m.w), height: pct(m.h) }} />
            ))}
          </div>
        ) : (
          <span className="qf-wait a-small a-muted">התמונה נטענת…</span>
        )}
      </div>
    );
  }

  const img = label.img;
  const clip = label.clip;
  const clipId = `qf-clip-${p.figure.replace(/[^a-z0-9]/gi, "")}${p.big ? "-big" : ""}`;
  return (
    <div className={`qf-stage${p.big ? " big" : ""}`} style={{ aspectRatio: `${W} / ${H}` }} dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={alt}>
        {clip ? (
          <defs>
            <clipPath id={clipId}>
              <rect x={clip.x * W} y={clip.y * H} width={clip.w * W} height={clip.h * H} />
            </clipPath>
          </defs>
        ) : null}
        {p.url ? (
          <image href={p.url} x={img.x * W} y={img.y * H} width={img.w * W} height={img.h * H} preserveAspectRatio="none" clipPath={clip ? `url(#${clipId})` : undefined} />
        ) : null}
        {label.lines.map((l, i) => (
          <line key={i} className="qf-line" x1={l[0] * W} y1={l[1] * H} x2={l[2] * W} y2={l[3] * H} />
        ))}
        {label.masks.map((m, i) => (
          <rect key={i} className="qf-mask" x={m.x * W} y={m.y * H} width={m.w * W} height={m.h * H} />
        ))}
        {(label.dots ?? []).map((d, i) => (
          <circle key={i} className="qf-dot" cx={d.x * W} cy={d.y * H} r={Math.min(W, H) * 0.012} />
        ))}
      </svg>
      {!p.url ? <span className="qf-wait a-small a-muted">התמונה נטענת…</span> : null}
      <div ref={group} className="qf-pins" role={tap ? "radiogroup" : undefined} aria-labelledby={tap ? p.labelledBy : undefined} onKeyDown={onKey}>
        {pins.map((pin, i) => {
          const asked = label.mode === "name" && label.ask === pin.n;
          const right = p.answered ? (tap ? p.answered.right === i : asked) : false;
          const wrongPick = p.answered && tap && p.answered.chosen === i && p.answered.right !== i;
          const name = p.answered?.names?.[i];
          const mark = right ? "✓" : wrongPick ? "✗" : "";
          const style = { left: pct(pin.x), top: pct(pin.y) };
          if (tap && !p.answered) {
            return (
              <button
                key={pin.n}
                type="button"
                role="radio"
                className={`qf-pin${p.picked === i ? " picked" : ""}`}
                style={style}
                aria-checked={p.picked === i}
                aria-label={`מספר ${pin.n}`}
                tabIndex={p.picked === i || (p.picked == null && i === 0) ? 0 : -1}
                disabled={p.disabled}
                onClick={() => p.onPick?.(i)}
              >
                <span aria-hidden="true">{pin.n}</span>
              </button>
            );
          }
          return (
            <span key={pin.n} className={`qf-pin static${asked ? " asked" : ""}${right ? " right" : ""}${wrongPick ? " wrong" : ""}`} style={style} aria-hidden={!asked && !mark}>
              <span>{pin.n}</span>
              {asked && !p.answered ? <span className="qf-ask">?</span> : null}
              {mark ? <b className="qf-mark">{mark}</b> : null}
              {name ? (
                <bdi className="qf-name" dir="ltr">
                  {name}
                </bdi>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function QuestionFigure(p: FigureProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const fig = p.figure || (p.layout && "fig" in p.layout ? (p.layout as { fig: string }).fig : "");
  const path = p.lectureId && fig ? figurePathOf(p.groupId, p.lectureId, fig) : null;
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) void figureUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  if (!fig) return null;
  return (
    <figure className="qfig">
      <Stage {...p} figure={fig} url={url} />
      <figcaption className="a-row between qf-foot">
        <span className="a-small a-muted">{p.layout?.kind === "label" && p.layout.mode === "tap" ? "אפשר לגעת במספר או לבחור למטה" : "מתוך השקפים"}</span>
        <button type="button" className="a-btn ghost qf-zoom" onClick={() => setBig(true)}>
          להגדיל
        </button>
      </figcaption>
      {big ? (
        <Sheet label="התמונה בגדול" head={<b>התמונה בגדול</b>} className="qf-sheet" onClose={() => setBig(false)}>
          <div className="qf-scroll">
            <Stage {...p} figure={fig} url={url} big />
          </div>
        </Sheet>
      ) : null}
    </figure>
  );
}
