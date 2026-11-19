/* ── A wall photo on the phone (package J; spec §12.5.J, fun design §5.4) ──
 *
 * shrinkPhoto keeps the slides' rule: at most 1280 px on the long side,
 * JPEG at 0.8, and re-encoded lower until it is at most 600 kB; still larger:
 * "too big" (the composer says W-20). It draws through an <img> and a
 * <canvas> (iPhone Safari decodes HEIC photos this way, and has no
 * OffscreenCanvas before 16.4), and the result is always a JPEG: the
 * bucket takes image/jpeg, and the database a .jpg path. Pure size maths in
 * fitSize, for the tests. */

export const MAX_SIDE = 1280;
export const MAX_BYTES = 600_000;
const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4];

/** The size to draw at: the long side at most `max`, never upscaled. */
export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      no(new Error("bad photo"));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, q: number): Promise<Blob | null> {
  return new Promise((ok) => canvas.toBlob((b) => ok(b), "image/jpeg", q));
}

/** The photo as a JPEG of at most 1280 px and 600 kB; throws Error("too big") or Error("bad photo"). */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const img = await loadImage(file);
  const { w, h } = fitSize(img.naturalWidth, img.naturalHeight);
  if (!w) throw new Error("bad photo");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("bad photo");
  g.fillStyle = "#fff"; // a transparent PNG gets a white backing, as the slides' pictures do
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  for (const q of QUALITIES) {
    const b = await toBlob(canvas, q);
    if (b && b.size <= MAX_BYTES) return b;
  }
  throw new Error("too big");
}
