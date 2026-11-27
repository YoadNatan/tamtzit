import type { KeyboardEvent } from "react";

/* ── A radiogroup of buttons as ARIA asks it (the review's nit): one tab stop
 *    (the checked button, roving tabindex) and the arrow keys move and choose
 *    within it, Home and End to its ends. RTL: ArrowLeft is the next button. ── */

/** The props of the i-th of n radio buttons, `on` is the checked one's index. */
export function radioProps(i: number, on: number, n: number, choose: (i: number) => void) {
  return {
    role: "radio" as const,
    "aria-checked": i === on,
    tabIndex: i === on || (on < 0 && i === 0) ? 0 : -1,
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
      const next = e.key === (rtl ? "ArrowLeft" : "ArrowRight") || e.key === "ArrowDown";
      const prev = e.key === (rtl ? "ArrowRight" : "ArrowLeft") || e.key === "ArrowUp";
      const to = next ? (i + 1) % n : prev ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      e.stopPropagation();
      choose(to);
      const group = e.currentTarget.closest('[role="radiogroup"]');
      requestAnimationFrame(() => (group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to] ?? null)?.focus());
    },
  };
}
