import { lazy } from "react";
import { retryImport } from "../lib/staleChunk";
import type { ScreenProps } from "./types";

/* ── "השוואת מודלים"'s slot (docs/study/models.md; VITE_STUDY_MODELS, section Y) ──
 * The only module of package Y in the study entry chunk (capped at 1,500 B
 * by tools/study-bundle.mjs): no words, no data. ?v=models loads
 * components/ModelsScreen.tsx lazily, which picks the owner's tabs, a
 * member's list, a new comparison (x=new) or a run (r=…), each its own lazy
 * chunk with its words (lib/modelsCopy.ts), its reads (lib/models.ts) and its
 * styles (styles/models.css). The row on "שלי" is ModelsParts' ModelsRows,
 * which Me (already lazy) imports lazily itself. */

const Screen = lazy(retryImport(() => import("../components/ModelsScreen")));

/** ?v=models (allowed() sends it home without the flag). */
export function ModelsRoute({ route, ctx }: ScreenProps<"models">) {
  return <Screen route={route} ctx={ctx} />;
}
