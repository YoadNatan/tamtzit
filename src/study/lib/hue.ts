/** A lecture's colour: one of the four lane colours (tokens.css --me-pop,
 *  --group-pop, --fun-pop, --ok-pop), the same for the lecture on every
 *  screen and every device, from its id. Decorative only: the strip down the
 *  start edge of its card in the library and of the meeting band
 *  (data-hue). Never the only sign of anything. */
export const HUES = 4;

export function hueOf(id: string): number {
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return (h % HUES) + 1;
}
