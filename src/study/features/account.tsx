import type { Session } from "@supabase/supabase-js";
import type { Ctx } from "./types";

/* ── Package A's identity slot (spec §5.3) ──
 * Seeded by F1 with no-ops; package A (A1) owns this file. */

/** A1's sheets (sign in, save the account), rendered by StudyApp in both branches. */
export function AccountLayer(_p: { session: Session | null }) {
  return null;
}

/** Opens A1's sheet: save this device's account, or sign in with an email. */
export function openAccount(_mode: "save" | "signin"): void {}

/** Run once after the session loads: "merged" makes the app reload. */
export async function accountStartup(): Promise<"none" | "merged" | "resume"> {
  return "none";
}

/** "שמירת החשבון" on "שלי", or null. */
export function AccountCard(_p: { ctx: Ctx }) {
  return null;
}

/** Nudges and announcements above the library's courses, or null. */
export function AccountBanners(_p: { ctx: Ctx }) {
  return null;
}
