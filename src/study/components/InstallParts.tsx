import { useRef, useState } from "react";
import type { Ctx } from "../features/types";
import { isIos, writeInstall, type Env } from "../lib/install";
import { escapeUrl } from "../lib/installLazy";
import { INSTALL, OS } from "../lib/installCopy";
import { runPrompt } from "../lib/installPrompt";
import { copyText } from "../lib/personalCode";
import { RouteLink } from "./Shell";
import "../styles/install.css";

/* ── The install flow's small pieces (docs/study/install.md) ──
 * Loaded lazily by features/install.tsx: the row in "שלי", the home's card,
 * the join screen's line, and what the screen (InstallScreen.tsx) shares
 * with them: the pictures of Safari's buttons and the way out of another
 * app's browser. */

/** Safari's share button, as iOS draws it. */
export function ShareIcon() {
  return (
    <svg className="inst-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={INSTALL.ariaShare}>
      <path d="M8.5 9.5H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1.5" />
      <path d="M12 15V3" />
      <path d="M8 6.5 12 3l4 3.5" />
    </svg>
  );
}

/** iOS 26's "⋯" beside the address. */
export function MorePill() {
  return (
    <span className="inst-more" role="img" aria-label={INSTALL.ariaMore}>
      {OS.iosMore}
    </span>
  );
}

/** The share sheet's "הוספה למסך הבית" row, drawn small. */
export function AddRow() {
  return (
    <span className="inst-addrow" role="img" aria-label={INSTALL.ariaAddToHome}>
      <span aria-hidden="true">{OS.iosAddToHome}</span>
      <svg className="inst-ico small" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    </span>
  );
}

/** The real browser this phone has: Safari on iOS, Chrome on Android. */
export const browserOf = (env: Env) => (isIos(env) ? OS.safari : OS.chrome);

/** "פתיחה בספארי" (or בכרום) and "העתקת הקישור": the way out of another
 *  app's browser, followed only on a tap. The link is this address, so an
 *  invite keeps its code. */
export function EscapeButtons({ env }: { env: Env }) {
  const [said, setSaid] = useState<"" | "copied" | "hand">("");
  const field = useRef<HTMLInputElement>(null);
  const href = typeof location !== "undefined" ? location.href : "";
  const out = escapeUrl(env, href);
  const browser = browserOf(env);
  const copy = async () => {
    if (await copyText(href)) setSaid("copied");
    else {
      setSaid("hand");
      setTimeout(() => field.current?.select(), 0);
    }
  };
  return (
    <div className="a-stack inst-escape">
      <div className="a-row inst-acts">
        {out ? (
          <a className="a-btn primary inst-open" href={out}>
            {INSTALL.openIn(browser)}
          </a>
        ) : null}
        <button type="button" className="a-btn inst-copylink" onClick={() => void copy()}>
          {INSTALL.copyLink}
        </button>
      </div>
      {said === "copied" ? (
        <p className="a-small inst-said" role="status">
          {INSTALL.linkCopied(browser)}
        </p>
      ) : null}
      {said === "hand" ? (
        <>
          <p className="a-small a-muted">{INSTALL.linkByHand}</p>
          <input ref={field} className="a-input inst-link" dir="ltr" readOnly value={href} aria-label={INSTALL.copyLink} onFocus={(e) => e.currentTarget.select()} />
        </>
      ) : null}
      <p className="a-small a-muted">{INSTALL.inAppFallback(isIos(env))}</p>
    </div>
  );
}

/** "שלי": the row to the steps; in the app itself, a line saying so. */
export function InstallRow({ ctx, standalone, done }: { ctx: Ctx; standalone: boolean; done: boolean }) {
  return (
    <div className="a-list links-card inst-links">
      {standalone ? (
        <div className="a-li inst-row-here" role="status">
          <div>
            <b>{INSTALL.rowStandalone}</b>
          </div>
        </div>
      ) : (
        <RouteLink to={{ v: "install" }} go={ctx.go} className="a-li row-link install-row">
          <div>
            <b>{INSTALL.rowTitle}</b>
            <span className="m">{INSTALL.rowSub}</span>
          </div>
          {done ? <span className="a-chip ok">{INSTALL.rowDone}</span> : null}
        </RouteLink>
      )}
    </div>
  );
}

/** The home's card: "איך מוסיפים" (or the browser's own "התקנה") and "לא עכשיו", once. */
export function InstallCard({ ctx, env, prompt }: { ctx: Ctx; env: Env; prompt: boolean }) {
  const [gone, setGone] = useState(false);
  const [soft, setSoft] = useState(false);
  const box = useRef<HTMLElement>(null);
  if (gone) return null;
  const later = () => {
    // The button leaves with the card: the focus goes on to what follows it (Today's "התור שלי").
    let next = box.current?.nextElementSibling ?? null;
    let to: HTMLElement | null = null;
    while (next && !to) {
      to = next.matches("h2") ? (next as HTMLElement) : next.querySelector<HTMLElement>("h2, a[href], button");
      next = next.nextElementSibling;
    }
    writeInstall({ dismissed: Date.now() });
    setGone(true);
    ctx.say(INSTALL.cardLaterSaid);
    if (to) {
      if (to.tagName === "H2" && !to.hasAttribute("tabindex")) to.tabIndex = -1;
      const el = to;
      requestAnimationFrame(() => el.focus({ preventScroll: true }));
    }
  };
  const install = async () => {
    const r = await runPrompt();
    if (r === "accepted") {
      setGone(true);
      ctx.say(INSTALL.accepted);
    } else if (r === "dismissed") setSoft(true);
    else ctx.go({ v: "install" });
  };
  const direct = prompt && !isIos(env);
  return (
    <section ref={box} className="a-card inst-card" aria-labelledby="inst-card-h">
      <div className="inst-card-head">
        <span className="inst-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="6" y="2.5" width="12" height="19" rx="3" />
            <path d="M12 8.5v6M9 11.5h6" />
          </svg>
        </span>
        <div>
          <h2 className="a-h2" id="inst-card-h">
            {INSTALL.cardTitle}
          </h2>
          <p className="a-small a-muted">{INSTALL.cardLine}</p>
        </div>
      </div>
      {soft ? <p className="a-small a-muted">{INSTALL.dismissed}</p> : null}
      <div className="a-row inst-acts">
        {direct ? (
          <button type="button" className="a-btn primary inst-install" onClick={() => void install()}>
            {INSTALL.install}
          </button>
        ) : (
          <RouteLink to={{ v: "install" }} go={ctx.go} className="a-btn primary inst-how">
            {INSTALL.cardHow}
          </RouteLink>
        )}
        <button type="button" className="a-btn ghost inst-later" onClick={later}>
          {INSTALL.cardLater}
        </button>
      </div>
    </section>
  );
}

/** The join screen: another app's browser above the form; an iPhone's Safari one line under it. */
export function JoinInstall({ env }: { env: Env }) {
  if (env.kind === "ios-safari") return <p className="a-small a-muted join-install">{INSTALL.joinIos}</p>;
  return (
    <div className="a-callout warn join-inapp" role="note">
      <span>{INSTALL.joinInApp(browserOf(env), INSTALL.appName(env.kind === "ios-inapp" || env.kind === "android-inapp" ? env.app : "other"))}</span>
      <EscapeButtons env={env} />
    </div>
  );
}
