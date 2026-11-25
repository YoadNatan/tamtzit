import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { flags } from "../lib/flags";
import { freshFor } from "../lib/guideMark";
import { cardWanted, envNow, guideBusy, INSTALL_CHANGED, installWanted, isInApp, readInstall, type Env, type InstallMemory } from "../lib/install";
import { canPrompt, promptVersion, subscribePrompt } from "../lib/installPrompt";
import type { Ctx, ScreenProps } from "./types";

/* ── Adding תמצית to the home screen (docs/study/install.md; VITE_STUDY_INSTALL) ──
 * The slot the app's screens render, each nothing without the flag: the
 * row in "שלי", one card on the home, the join screen's line, and the
 * screen itself (?v=install). These wrappers decide from lib/install.ts
 * whether anything shows; everything with words or pictures loads lazily
 * (components/InstallParts.tsx and InstallScreen.tsx). */

const Parts = () => import("../components/InstallParts");
const Row = lazy(() => Parts().then((m) => ({ default: m.InstallRow })));
const Card = lazy(() => Parts().then((m) => ({ default: m.InstallCard })));
const JoinNote = lazy(() => Parts().then((m) => ({ default: m.JoinInstall })));
const Screen = lazy(() => import("../components/InstallScreen"));

/** Where this page runs, the browser's prompt and the device's memory, kept
 *  current: the prompt can come late, the display mode can change, and
 *  another screen can mark the app added. */
export function useInstall(): { env: Env; prompt: boolean; memory: InstallMemory } {
  useSyncExternalStore(subscribePrompt, promptVersion, promptVersion);
  const [memory, setMemory] = useState(readInstall);
  const [env, setEnv] = useState(envNow);
  useEffect(() => {
    const on = () => {
      setMemory(readInstall());
      setEnv(envNow());
    };
    window.addEventListener(INSTALL_CHANGED, on);
    let mq: MediaQueryList | null = null;
    try {
      mq = matchMedia("(display-mode: standalone)");
      mq.addEventListener?.("change", on);
    } catch {
      /* an old browser */
    }
    return () => {
      window.removeEventListener(INSTALL_CHANGED, on);
      mq?.removeEventListener?.("change", on);
    };
  }, []);
  return { env, prompt: canPrompt(), memory };
}

/** "שלי": the row to the steps, high on the screen; in the app itself, one
 *  line saying so; nothing on a computer without the browser's prompt. */
export function InstallMeRow({ ctx }: { ctx: Ctx }) {
  const s = useInstall();
  if (!flags.install) return null;
  if (s.env.kind !== "standalone" && !installWanted(s.env, s.prompt)) return null;
  return (
    <Suspense fallback={null}>
      <Row ctx={ctx} standalone={s.env.kind === "standalone"} done={Boolean(s.memory.done)} />
    </Suspense>
  );
}

/** The home's card (Today, or the library before Today): once, while the
 *  guide's own card is not there, until it is added or put off. */
export function InstallHomeCard({ ctx }: { ctx: Ctx }) {
  const s = useInstall();
  const [busy] = useState(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(`study-guide:${ctx.userId}`);
    } catch {
      raw = "{}"; // no storage: the guide's card cannot hold the home
    }
    return guideBusy(flags.guide, Boolean(freshFor(ctx.group.id)), raw, Date.now());
  });
  if (!flags.install || !cardWanted({ env: s.env, canPrompt: s.prompt, memory: s.memory, guideBusy: busy })) return null;
  return (
    <Suspense fallback={null}>
      <Card ctx={ctx} env={s.env} prompt={s.prompt} />
    </Suspense>
  );
}

/** The join screen: another app's browser gets the way out above the form
 *  (the invite's code kept), an iPhone's Safari one quiet line under it. */
export function JoinInstallNote({ place }: { place: "top" | "bottom" }) {
  const [env] = useState(envNow);
  if (!flags.install) return null;
  if (place === "top" ? !isInApp(env) : env.kind !== "ios-safari") return null;
  return (
    <Suspense fallback={null}>
      <JoinNote env={env} />
    </Suspense>
  );
}

/** ?v=install: the steps for this device. */
export function InstallScreen({ route, ctx }: ScreenProps<"install">) {
  return <Screen route={route} ctx={ctx} />;
}
