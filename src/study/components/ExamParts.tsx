import { useEffect, useState } from "react";
import { cropStyle, pageUrls, parsePageBox } from "../lib/exams";

/* ── Pieces the past-exam screens share (sources.md, phase 2) ──
 * PageCrop: an exam page's picture, or the box of it an item names
 * (pg:<page>:<x>,<y>,<w>,<h>, thousandths), cut by CSS from the stored page:
 * nothing is cropped or stored twice. Its picture is signed once per page and
 * kept for the visit. */

const signed = new Map<string, Promise<string | null>>();
/** A page's picture, signed once per visit (the review's PageView shares it). */
export function pageUrl(path: string): Promise<string | null> {
  let p = signed.get(path);
  if (!p) {
    p = pageUrls([path])
      .then((m) => m[path] ?? null)
      .catch(() => null);
    signed.set(path, p);
    void p.then((u) => {
      if (!u) signed.delete(path);
    });
  }
  return p;
}

export const examPagePath = (groupId: string, examId: string, page: number) => `${groupId}/exams/${examId}/p${page}.jpg`;

/** A page, or its box: the item's figure when it has one, else the whole page
 *  `page`. zoom: a tap opens the whole page (the review, where the text is
 *  checked against it). */
export function PageCrop({ groupId, examId, figure, page, label, zoom }: { groupId: string; examId: string; figure?: string | null; page?: number | null; label?: string; zoom?: boolean }) {
  const box = parsePageBox(figure);
  const n = box?.page ?? page ?? null;
  const [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let alive = true;
    setImg(null);
    setState("loading");
    if (!n) {
      setState("error");
      return;
    }
    void pageUrl(examPagePath(groupId, examId, n)).then((url) => {
      if (!alive) return;
      if (!url) return setState("error");
      const im = new Image();
      im.onload = () => {
        if (!alive) return;
        setImg({ url, w: im.naturalWidth || 3, h: im.naturalHeight || 4 });
        setState("ok");
      };
      im.onerror = () => alive && setState("error");
      im.src = url;
    });
    return () => {
      alive = false;
    };
  }, [groupId, examId, n]);
  if (!n) return null;
  const alt = label ?? (box ? `האיור מעמוד ${n} של המבחן` : `עמוד ${n} של המבחן`);
  if (state !== "ok" || !img) {
    return (
      <div className={`x-crop${state === "error" ? " is-error" : " is-wait"}`} role="img" aria-label={state === "error" ? `${alt} לא נטען` : alt}>
        {state === "error" ? <span className="a-small a-muted">העמוד לא נטען</span> : null}
      </div>
    );
  }
  const c = box ? cropStyle(box, img) : null;
  const shown = c ? (
    <div className="x-crop is-box" style={{ aspectRatio: c.ratio }}>
      <img src={img.url} alt={alt} style={{ width: c.width, left: c.left, top: c.top }} />
    </div>
  ) : (
    <div className="x-crop" style={{ aspectRatio: `${img.w} / ${img.h}` }}>
      <img src={img.url} alt={alt} style={{ width: "100%", left: 0, top: 0 }} />
    </div>
  );
  if (!zoom) return shown;
  return (
    <a className="x-zoom" href={img.url} target="_blank" rel="noopener noreferrer" aria-label={`${alt}: לפתוח את העמוד כולו`}>
      {shown}
    </a>
  );
}

/** Keeps the screen on while the phone uploads (or copies, when the server cannot). */
let wakeLock: { release(): Promise<void> } | null = null;
export async function holdScreen(on: boolean): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
  try {
    if (on && !wakeLock && nav.wakeLock && document.visibilityState === "visible") wakeLock = await nav.wakeLock.request("screen");
    if (!on && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release();
    }
  } catch {
    wakeLock = null; // not allowed here: the work goes on anyway
  }
}

/** The phone copies this exam itself (the server cannot write: no pg_net): kept for the exam's screen. */
const driveKey = (examId: string) => `study.exam.drive.${examId}`;
export function setDrive(examId: string, on: boolean): void {
  try {
    if (on) sessionStorage.setItem(driveKey(examId), "1");
    else sessionStorage.removeItem(driveKey(examId));
  } catch {
    /* the screen asks the server again */
  }
}
export function drives(examId: string): boolean {
  try {
    return sessionStorage.getItem(driveKey(examId)) === "1";
  } catch {
    return false;
  }
}
