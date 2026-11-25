import { lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, newPersonalCode } from "../lib/api";
import { cacheCode, codesOn } from "../lib/personalCode";
import type { Ctx } from "./types";

/* ── Package A's identity slot (spec §5.3) ──
 * Decision 1 of 17 Nov 2026 (no accounts), amended 25 Nov 2026: the
 * personal code (docs/study/personal-code.md, SQL section I). A member's
 * code brings back the same member on any device. Everything here shows
 * only when /api/study/health says "codes" (lib/personalCode.ts codesOn),
 * so a database without section I never changes a screen. The screens load
 * lazily (components/AccountCode.tsx). */

const UI = () => import("../components/AccountCode");
const CodeCard = lazy(() => UI().then((m) => ({ default: m.CodeCard })));
const CodeBanners = lazy(() => UI().then((m) => ({ default: m.CodeBanners })));
const MyCodeSheet = lazy(() => UI().then((m) => ({ default: m.MyCodeSheet })));
const EnterSheet = lazy(() => UI().then((m) => ({ default: m.EnterSheet })));
const LinkConfirm = lazy(() => UI().then((m) => ({ default: m.LinkConfirm })));
export const CodeEntry = lazy(() => UI().then((m) => ({ default: m.CodeEntry })));
export const CodeSheet = lazy(() => UI().then((m) => ({ default: m.CodeSheet })));

type Mode = "save" | "signin" | "enter" | "new";
const OPEN = "study-account";

/** Opens the slot's sheet: "new" makes the member's first code and shows it
 *  (right after joining or opening a group); "enter" the entry with a code.
 *  "save" and "signin" were the withdrawn email account's: nothing. */
export function openAccount(mode: Mode): void {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: mode }));
}

/** The question a member's #k= link asks (StudyApp hands it over). */
export type PendingLink = { code: string; name: string };

/** The slot's sheets, rendered by StudyApp in both branches: the code after
 *  joining, the entry, and a #k= link opened where a member is signed in. */
export function AccountLayer({
  restore,
  link,
  onLinkDone,
}: {
  session: Session | null;
  /** Signs this device in as the code's member (StudyApp's). */
  restore?: (code: string) => Promise<void>;
  link?: PendingLink | null;
  onLinkDone?: () => void;
}) {
  const [sheet, setSheet] = useState<null | { kind: "new"; code: string } | { kind: "enter" }>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const mode = (e as CustomEvent<Mode>).detail;
      if (mode === "enter" && restore) setSheet({ kind: "enter" });
      if (mode !== "new") return;
      // Only once codes work end to end; any failure skips the sheet quietly.
      void (async () => {
        if (!(await codesOn())) return;
        const s = await getSession();
        if (!s) return;
        const code = await newPersonalCode();
        cacheCode(s.user.id, code);
        setSheet({ kind: "new", code });
      })().catch(() => undefined);
    };
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
  }, [restore]);
  return (
    <Suspense fallback={null}>
      {sheet?.kind === "new" ? <MyCodeSheet code={sheet.code} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "enter" && restore ? <EnterSheet onCode={restore} onClose={() => setSheet(null)} /> : null}
      {link && restore ? <LinkConfirm name={link.name} onYes={() => restore(link.code)} onClose={() => onLinkDone?.()} /> : null}
    </Suspense>
  );
}

/** Run once after the session loads: "merged" makes the app reload. */
export async function accountStartup(): Promise<"none" | "merged" | "resume"> {
  return "none";
}

/** Whether the server offers codes, once known (false until then). */
export function useCodesOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void codesOn().then((v) => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

/** "הקוד האישי" on "שלי", or null. */
export function AccountCard({ ctx }: { ctx: Ctx }) {
  const on = useCodesOn();
  return on ? (
    <Suspense fallback={null}>
      <CodeCard ctx={ctx} />
    </Suspense>
  ) : null;
}

/** Nudges and announcements above the library's courses, or null: the
 *  opener's notice, and the prompt for a member with no code yet. */
export function AccountBanners({ ctx }: { ctx: Ctx }) {
  const on = useCodesOn();
  return on ? (
    <Suspense fallback={null}>
      <CodeBanners ctx={ctx} />
    </Suspense>
  ) : null;
}
