import { useState } from "react";
import type { FigureGeo } from "../../../shared/study/figureGeo";
import { setLectureGeo, type Lecture } from "../lib/api";
import { failText } from "../lib/failText";
import { Sheet } from "./Shell";

/* ── "לסמן תוויות בשרטוטים": an older lecture's picture labels, read again
 *    from its own file on this phone (docs/study/question-types.md) ──
 *
 * A lecture uploaded before the question types has its pictures but not
 * where their labels sit, which "סימון על תמונה" needs. A member picks the
 * same file again: it is read here with the upload's own readers (nothing is
 * uploaded again), checked to be the same deck (the number of slides and
 * their titles; for PowerPoint each picture too, and its proportions within
 * 3%), and each picture's labels are saved with study_lecture_set_geo. */

/** Whether a lecture's pictures have no label geometry yet (the backfill's offer). */
export function needsGeo(lecture: Pick<Lecture, "slides">): boolean {
  const figures = lecture.slides.flatMap((s) => s.figures ?? []);
  return figures.length > 0 && !figures.some((f) => f.geo);
}

/** A PNG's or JPEG's width and height from its first bytes (no decoding), or null. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The geometry to save, or why the file is not the lecture's: the same slides and titles; for PowerPoint, each picture (n, k) and its proportions. */
export function matchDeck(
  lecture: Pick<Lecture, "slides" | "source_kind">,
  deck: { slides: Array<{ n: number; title: string; images?: string[]; geo?: Array<FigureGeo | null> }> },
  aspects?: ReadonlyMap<string, number>,
): { ok: true; geo: Array<{ n: number; k: number; geo: FigureGeo }> } | { ok: false } {
  if (deck.slides.length !== lecture.slides.length) return { ok: false };
  for (let i = 0; i < deck.slides.length; i++) if (norm(deck.slides[i].title) !== norm(lecture.slides[i].title ?? "")) return { ok: false };
  const out: Array<{ n: number; k: number; geo: FigureGeo }> = [];
  for (const s of lecture.slides) {
    const d = deck.slides.find((x) => x.n === s.n);
    for (const f of s.figures ?? []) {
      if (lecture.source_kind === "pptx") {
        if (!d || !d.images || f.k < 1 || f.k > d.images.length) return { ok: false };
        const a = aspects?.get(`${s.n}-${f.k}`);
        if (a !== undefined && f.w > 0 && f.h > 0 && Math.abs(a / (f.w / f.h) - 1) > 0.03) return { ok: false };
      }
      const g = d?.geo?.[lecture.source_kind === "pptx" ? f.k - 1 : 0];
      if (g) out.push({ n: s.n, k: f.k, geo: g });
    }
  }
  return { ok: true, geo: out };
}

export default function GeoBackfill({ lecture, onClose, onDone }: { lecture: Lecture; onClose: () => void; onDone?: (n: number) => void }) {
  const [state, setState] = useState<{ busy: boolean; said: string; error: string }>({ busy: false, said: "", error: "" });
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setState({ busy: true, said: "קוראים את הקובץ…", error: "" });
    try {
      const data = await file.arrayBuffer();
      let found: ReturnType<typeof matchDeck>;
      if (lecture.source_kind === "pptx") {
        const { readPptx } = await import("../lib/pptx");
        const deck = await readPptx(data);
        const aspects = new Map<string, number>();
        for (const s of deck.slides)
          for (const [i, path] of s.images.entries()) {
            const bytes = await deck.image(path);
            const size = bytes ? imageSize(bytes) : null;
            if (size && size.h > 0) aspects.set(`${s.n}-${i + 1}`, size.w / size.h);
          }
        found = matchDeck(lecture, deck, aspects);
      } else {
        const { readPdf } = await import("../lib/pdf");
        const deck = await readPdf(data);
        const geo = new Map<number, FigureGeo | null>();
        for (const s of lecture.slides) if ((s.figures ?? []).length) geo.set(s.n, (await deck.pageImage(s.n).catch(() => null))?.geo ?? null);
        found = matchDeck(lecture, { slides: deck.slides.map((s) => ({ n: s.n, title: s.title, geo: [geo.get(s.n) ?? null] })) });
      }
      if (!found.ok) return setState({ busy: false, said: "", error: "זה לא אותו קובץ. צריך את הקובץ שממנו ההרצאה הועלתה." });
      if (!found.geo.length) return setState({ busy: false, said: "", error: "לא נמצאו בקובץ שרטוטים עם תוויות." });
      const n = await setLectureGeo(lecture.id, found.geo);
      setState({ busy: false, said: `נוספו סימונים ל-${n} שרטוטים.`, error: "" });
      onDone?.(n);
    } catch (e) {
      setState({ busy: false, said: "", error: failText(e instanceof Error ? e.message : String(e), "practice") });
    }
  };
  return (
    <Sheet label="לסמן תוויות בשרטוטים" head={<b>לסמן תוויות בשרטוטים</b>} className="geo-sheet" onClose={onClose}>
      <div className="a-stack">
        <p dir="rtl">
          כדי ליצור שאלות ״סימון על תמונה״ צריך לדעת איפה כל תווית בשרטוט. בוחרים שוב את הקובץ שממנו ההרצאה הועלתה. הוא נקרא רק בטלפון ולא עולה שוב.
        </p>
        <label className="a-btn primary wide">
          לבחור את הקובץ
          <input
            type="file"
            accept={lecture.source_kind === "pdf" ? "application/pdf,.pdf" : ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"}
            className="sr-only"
            disabled={state.busy}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </label>
        <p className="a-small" aria-live="polite">
          {state.said}
        </p>
        {state.error ? (
          <p className="a-error" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
