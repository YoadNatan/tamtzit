import type { ScreenProps } from "../features/types";
import SetPage from "./SetPage";
import SetsShelf from "./SetsShelf";

/* ── ?v=sets (practice sets, slice B): the shelf, or one set (k) ──
 * One lazy chunk behind the slot (features/qsets.tsx), so the slot keeps a
 * single stub for both screens (bundle owner QS). */
export default function SetsScreen({ route, ctx }: ScreenProps<"sets">) {
  return route.k ? <SetPage key={route.k} route={route} ctx={ctx} /> : <SetsShelf key={route.l ?? ""} route={route} ctx={ctx} />;
}
