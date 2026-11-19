/* ── Slide pictures, made small ──
 *
 * Lecture decks carry huge PNGs (one 38-slide deck: 14 pictures, 7 MB). The
 * model sees nothing extra above ~1,500 px, and a phone downloads every one of
 * them in the reader, so each picture is redrawn once in the browser as a JPEG
 * no larger than MAX_SIDE on its long edge, on a white background (slide
 * diagrams are often transparent PNGs, which turn black as JPEG otherwise).
 */

const MAX_SIDE = 1400;
const QUALITY = 0.84;

export type SmallImage = { blob: Blob; width: number; height: number };

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
};

export function mimeFor(path: string): string {
  return MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export async function shrinkImage(bytes: Uint8Array, mime: string, maxSide = MAX_SIDE): Promise<SmallImage> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const bitmap = await createImageBitmap(new Blob([copy.buffer], { type: mime }));
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no-canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode-failed"))), "image/jpeg", QUALITY),
  );
  return { blob, width, height };
}

/** Base64 of a blob without the data: prefix, for an API image block. */
export async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(bin);
}
