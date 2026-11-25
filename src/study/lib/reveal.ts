/* ── What a tap asks for next, brought into view (docs/study/ux-p1.md, WP4) ──
 * A pick that needs a second tap ("כמה בטוחים?" after an answer) must not
 * leave that second step under the fold of a small phone: the answer is sent
 * only with it, and a timed round runs out. After the next paint the element
 * scrolls the least it needs ("nearest"), clear of the sticky bars (the
 * page's scroll-padding), smoothly unless reduced motion is asked for. */
export function reveal(el: Element | null | undefined): void {
  if (!el || typeof window === "undefined") return;
  requestAnimationFrame(() => {
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: still ? "auto" : "smooth" });
  });
}
