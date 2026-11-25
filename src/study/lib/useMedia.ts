import { useEffect, useState } from "react";

/** Whether a media query matches now, and again whenever that changes (an
 *  iPad turned, a desktop window made narrower). False where there is no
 *  matchMedia (the unit tests). */
export function useMedia(query: string): boolean {
  const now = () => typeof matchMedia === "function" && matchMedia(query).matches;
  const [on, setOn] = useState(now);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const change = () => setOn(mq.matches);
    change();
    mq.addEventListener?.("change", change);
    return () => mq.removeEventListener?.("change", change);
  }, [query]);
  return on;
}

/** The side rail and the reader's contents column (tokens.css: L). */
export const WIDE_L = "(min-width: 1024px)";
