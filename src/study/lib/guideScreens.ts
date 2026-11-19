import type { Flags } from "./flags";

/* ── Which screens have a "?" mini-guide (docs/study/guide.md §2.3) ──
 * One pure check, shared by the registry's screenGuide() (lib/guide.ts,
 * lazy) and the "?" button's hasScreenGuide() (lib/guideMark.ts, in the
 * entry), so the button never shows where the guide has nothing to say.
 * guide.test.ts checks the two agree on every screen. */

export type MiniRoute = { v: string; l?: string; s?: string; x?: string; run?: boolean };

export function miniScreen(r: MiniRoute, f: Flags): boolean {
  switch (r.v) {
    case "today":
      return f.today && !r.run;
    case "library":
    case "lecture":
    case "upload":
    case "group":
    case "me":
      return true;
    case "wall":
      return f.wall && !r.x;
    case "practice":
      return f.questions && !r.s && !r.x;
    default:
      return false;
  }
}
