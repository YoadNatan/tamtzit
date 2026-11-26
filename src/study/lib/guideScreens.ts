import type { Flags } from "./flags";

/* ── Which screens have a "?" mini-guide (docs/study/guide.md §2.3) ──
 * One pure check, shared by the registry's screenGuide() (lib/guide.ts,
 * lazy) and the "?" button's hasScreenGuide() (lib/guideMark.ts, in the
 * entry), so the button never shows where the guide has nothing to say.
 * guide.test.ts checks the two agree on every screen. */

export type MiniRoute = { v: string; l?: string; s?: string; x?: string; run?: boolean; c?: string; e?: string; isNew?: boolean | string; many?: boolean };

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
      // Never a session: no "?" over a question, a running simulation's clock
      // (s=x.), its mistakes (s=w.) or an exam replayed (s=e.).
      return f.questions && !r.s && !r.x;
    // The course pages and past exams (docs/study/sources.md): the course
    // page; an exam's upload, or one exam (its reading and its review), not
    // the bare list; the simulation's setup; the course's own question (the
    // library's has none). The batch upload is "upload" with many.
    case "course":
      return f.courses;
    case "exams":
      // ExamsScreen: one exam (e), else the upload (isNew with its course), else the bare list.
      return f.exams && (Boolean(r.e) || Boolean(r.isNew && r.c));
    case "mock":
      return f.exams;
    case "ask":
      return f.ask && f.courses && Boolean(r.c);
    default:
      return false;
  }
}
