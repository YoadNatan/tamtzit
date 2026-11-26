import { lazy } from "react";

/* ── Practice sets' slot (docs/study/sets.md; VITE_STUDY_MAKE) ──
 * Only these stubs are in the study entry chunk (bundle owner QS, capped at
 * 2,000 B): no words, no data module. The screens load lazily, each in its
 * own chunk, and bring their words (lib/setsCopy.ts), their planning
 * (lib/make.ts) and their styles (styles/sets.css). Package Q's slot
 * (features/practice.tsx) routes to them while flags.make is on:
 *   ?v=practice&x=new[&l=…][&from=m]   "סט חדש": one screen, the price on its button
 *   ?v=practice&l=…&x=bank&r=…         "סט בהכנה": the set being written, then "להתחיל לפתור"
 * Without the flag the same routes are practice 2.0's (PracticeCreate,
 * PracticeBank), kept one release (OD22). Slice B's set screens join here. */

export const MakeScreen = lazy(() => import("../components/MakeScreen"));
export const MakeProgress = lazy(() => import("../components/MakeProgress"));
