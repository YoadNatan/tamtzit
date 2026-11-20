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
 * the answer each pin says ✓ or ✗ in a glyph, never colour alone, and the
 * pins' names are a numbered list under the picture. "להגדיל" opens the
 * same stage twice as wide in a sheet; when the pins would sit closer than
 * 32 px at the card's width, the stage starts zoomed in a scrollable box.
 * The picture is loaded before anything can be answered: until it is, the
 * question says so (onState), and a picture that does not load says
 * "התמונה לא נטענה" with "לנסות שוב". The picture's alt is generic: its
 * caption could give the answer away. */

/** Signed picture URLs, cached for the visit (each is signed for six hours); a failure is never cached. */
const urls = new Map<string, Promise<string | null>>();
export function figureUrl(path: string): Promise<string | null> {
  let u = urls.get(path);
  if (!u) {
    u = figureUrls([path])
      .then((m) => {
        const got = m[path] ?? null;
        if (!got) urls.delete(path);
        return got;
      })
      .catch(() => {
        urls.delete(path);
        return null;
      });
    urls.set(path, u);
  }
  return u;
}
/** Forgets a picture's URL (its picture did not load: "לנסות שוב" signs it again). */
export const forgetFigure = (path: string) => void urls.delete(path);

export type FigureState = "loading" | "ok" | "error";

/** A picture that is part of a question: its layout or, for a plain question about a picture, its figure id alone. */
export type FigureProps = {
  groupId: string;
  lectureId: string | null;
  figure: string;
  layout: Layout | null | undefined;
  /** Tap mode: the pin picked (its index), and the pick. */
  picked?: number | null;
  onPick?: (i: number) => void;
  /** After the answer: the right pin and the chosen one (indexes), and each pin's name to show then. */
  answered?: { right: number; chosen: number | null; names?: string[] } | null;
  disabled?: boolean;
  /** The question's lead-in id (a tap radiogroup is labelled by it). */
  labelledBy?: string;
  /** Whether the picture is there yet: the question waits for "ok". */
  onState?: (s: FigureState) => void;
};

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
/** Pins closer than this on screen are hard to tell apart and to tap. */
export const PIN_MIN_PX = 32;

/** The smallest distance between two pins' centres, in px, when the stage is `width` px wide. */
export function minPinGap(layout: Pick<LabelLayout, "pins" | "stage">, width: number): number {
  const h = (width * layout.stage.h) / layout.stage.w;
  let min = Infinity;
  const ps = layout.pins;
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) min = Math.min(min, Math.hypot((ps[i].x - ps[j].x) * width, (ps[i].y - ps[j].y) * h));
  return min;
}

/** How much to widen the stage so its closest pins are PIN_MIN_PX apart (1: no need; at most 2.5). */
export function zoomFor(layout: Pick<LabelLayout, "pins" | "stage">, width: number): number {
  if (!(width > 0) || layout.pins.length < 2) return 1;
  const gap = minPinGap(layout, width);
  return gap >= PIN_MIN_PX ? 1 : Math.min(2.5, PIN_MIN_PX / Math.max(gap, 1));
}

type StageProps = FigureProps & { url: string | null; state: FigureState; natural: { w: number; h: number } | null; big?: boolean; scale?: number; onRetry: () => void };

function Stage(p: StageProps) {
  const lay = p.layout && (p.layout.kind === "label" || p.layout.kind === "image") ? p.layout : null;
  const label = lay?.kind === "label" ? (lay as LabelLayout) : null;
  const image = lay?.kind === "image" ? (lay as ImageLayout) : null;
  const W = label ? label.stage.w : 1000;
  const H = label ? label.stage.h : 750;
  const crop: Box = image?.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const pins = label?.pins ?? [];
  const tap = label?.mode === "tap";
  const group = useRef<HTMLDivElement>(null);
  const n = Number(/^fig:(\d+)-/.exec(p.figure)?.[1] ?? 0);
  const alt = `שרטוט משקף ${n || ""}${pins.length ? `, עם ${pins.length} מספרים` : ""}`.replace(" ,", ",");
  const shown = p.state === "ok" && p.url;
  const scaled = p.scale && p.scale > 1 ? { width: `${(p.scale * 100).toFixed(1)}%`, maxWidth: "none" } : {};

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

  const status =
    p.state === "error" ? (
      <div className="qf-wait qf-fail" role="alert">
        <span className="a-small">התמונה לא נטענה.</span>
        <button type="button" className="a-btn ghost small" onClick={p.onRetry}>
          לנסות שוב
        </button>
      </div>
    ) : p.state === "loading" ? (
      <span className="qf-wait a-small a-muted">התמונה נטענת…</span>
    ) : null;

  // An image item: the stored picture as an <img>, cropped by a window over it (its natural size gives the ratio), masks over its text.
  if (!label) {
    const ratio = p.natural ? (p.natural.w * crop.w) / (p.natural.h * crop.h) : 4 / 3;
    return (
      <div className={`qf-stage qf-photo${p.big ? " big" : ""}`} style={{ aspectRatio: String(ratio) }} dir="ltr">
        {shown ? (
          <div className="qf-crop" style={{ width: pct(1 / crop.w), height: pct(1 / crop.h), left: pct(-crop.x / crop.w), top: pct(-crop.y / crop.h) }}>
            <img src={p.url!} alt={alt} />
            {(image?.masks ?? []).map((m, i) => (
              <span key={i} className="qf-mask-box" style={{ left: pct(m.x), top: pct(m.y), width: pct(m.w), height: pct(m.h) }} />
            ))}
          </div>
        ) : (
          status
        )}
      </div>
    );
  }

  const img = label.img;
  const clip = label.clip;
  const clipId = `qf-clip-${p.figure.replace(/[^a-z0-9]/gi, "")}${p.big ? "-big" : ""}`;
  const blocked = p.disabled || p.state !== "ok";
  return (
    <div className={`qf-stage${p.big ? " big" : ""}`} style={{ aspectRatio: `${W} / ${H}`, ...scaled }} dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={alt}>
        {clip ? (
          <defs>
            <clipPath id={clipId}>
              <rect x={clip.x * W} y={clip.y * H} width={clip.w * W} height={clip.h * H} />
            </clipPath>
          </defs>
        ) : null}
        {shown ? (
          <image href={p.url!} x={img.x * W} y={img.y * H} width={img.w * W} height={img.h * H} preserveAspectRatio="none" clipPath={clip ? `url(#${clipId})` : undefined} />
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
      {status}
      <div ref={group} className="qf-pins" role={tap ? "radiogroup" : undefined} aria-labelledby={tap ? p.labelledBy : undefined} onKeyDown={onKey}>
        {pins.map((pin, i) => {
          const asked = label.mode === "name" && label.ask === pin.n;
          const right = p.answered ? (tap ? p.answered.right === i : asked) : false;
          const wrongPick = p.answered && tap && p.answered.chosen === i && p.answered.right !== i;
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
                disabled={blocked}
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
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** After the answer: every pin's name, as a numbered list under the picture ("1 Aorta ✓"). */
function Legend({ layout, answered }: { layout: LabelLayout; answered: NonNullable<FigureProps["answered"]> }) {
  const names = answered.names ?? [];
  if (!names.some(Boolean)) return null;
  const tap = layout.mode === "tap";
  return (
    <ol className="qf-legend" aria-label="מה מסומן בשרטוט">
      {layout.pins.map((pin, i) => {
        const right = tap ? answered.right === i : layout.ask === pin.n;
        const wrong = tap && answered.chosen === i && answered.right !== i;
        return (
          <li key={pin.n} className={right ? "right" : wrong ? "wrong" : undefined}>
            <b className="qf-num" aria-hidden="true">
              {pin.n}
            </b>
            <span className="sr-only">{`מספר ${pin.n}: `}</span>
            {/* A pin that is none of the options has no name to show: say so, not a lone "·". */}
            {names[i] ? <bdi dir="ltr">{names[i]}</bdi> : <span className="a-muted">לא בשאלה</span>}
            {right ? (
              <b className="qf-legend-mark">
                <span aria-hidden="true">✓</span>
                <span className="sr-only">{tap ? "התשובה הנכונה" : "המספר שנשאל"}</span>
              </b>
            ) : wrong ? (
              <b className="qf-legend-mark">
                <span aria-hidden="true">✗</span>
                <span className="sr-only">הבחירה שלך</span>
              </b>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function QuestionFigure(p: FigureProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<FigureState>("loading");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [tries, setTries] = useState(0);
  const [big, setBig] = useState(false);
  const [width, setWidth] = useState(0);
  const box = useRef<HTMLElement>(null);
  const fig = p.figure || (p.layout && "fig" in p.layout ? (p.layout as { fig: string }).fig : "");
  const path = p.lectureId && fig ? figurePathOf(p.groupId, p.lectureId, fig) : null;
  const onState = p.onState;

  // Signs the picture, then loads it before showing it: a picture that does not load is an error, never a blank stage.
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setState("loading");
    if (!path) {
      setState("error");
      return;
    }
    void figureUrl(path).then((u) => {
      if (!alive) return;
      if (!u) {
        setState("error");
        return;
      }
      const im = new Image();
      im.onload = () => {
        if (!alive) return;
        setNatural({ w: im.naturalWidth || 4, h: im.naturalHeight || 3 });
        setUrl(u);
        setState("ok");
      };
      im.onerror = () => {
        if (!alive) return;
        forgetFigure(path);
        setState("error");
      };
      im.src = u;
    });
    return () => {
      alive = false;
    };
  }, [path, tries]);
  useEffect(() => onState?.(state), [state, onState]);

  // The card's width, for the pins' spacing.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fig]);

  if (!fig) return null;
  const label = p.layout?.kind === "label" ? p.layout : null;
  const scale = label ? zoomFor(label, width) : 1;
  const retry = () => {
    if (path) forgetFigure(path);
    setTries((n) => n + 1);
  };
  const stage = <Stage {...p} figure={fig} url={url} state={state} natural={natural} scale={scale} onRetry={retry} />;
  return (
    <figure className="qfig" ref={box}>
      {scale > 1 ? (
        <div className="qf-scroll qf-dense" tabIndex={0} role="group" aria-label="השרטוט, מוגדל">
          {stage}
        </div>
      ) : (
        stage
      )}
      {label && p.answered ? <Legend layout={label} answered={p.answered} /> : null}
      <figcaption className="a-row between qf-foot">
        <span className="a-small a-muted">
          {scale > 1 ? "השרטוט מוגדל: אפשר לגלול לצדדים" : label?.mode === "tap" ? "אפשר לגעת במספר או לבחור למטה" : "מתוך השקפים"}
        </span>
        <button type="button" className="a-btn ghost qf-zoom" disabled={state !== "ok"} onClick={() => setBig(true)}>
          להגדיל
        </button>
      </figcaption>
      {big ? (
        <Sheet label="התמונה בגדול" head={<b>התמונה בגדול</b>} className="qf-sheet" onClose={() => setBig(false)}>
          <div className="qf-scroll">
            <Stage {...p} figure={fig} url={url} state={state} natural={natural} big onRetry={retry} />
          </div>
        </Sheet>
      ) : null}
    </figure>
  );
}
