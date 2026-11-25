import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCodesOn } from "../features/account";
import { useInstall } from "../features/install";
import type { ScreenProps } from "../features/types";
import { newPersonalCode, personalCodeStatus, type CodeStatus } from "../lib/api";
import { failText } from "../lib/failText";
import { guideMark } from "../lib/guideMark";
import { isIos, markInstalled, type Env } from "../lib/install";
import { INSTALL } from "../lib/installCopy";
import { runPrompt } from "../lib/installPrompt";
import { cacheCode, cachedCode, cacheFresh, copyText, formatCode } from "../lib/personalCode";
import { AddRow, browserOf, EscapeButtons, MorePill, ShareIcon } from "./InstallParts";
import { BackLink, Head } from "./Shell";
import "../styles/install.css";

/* ── "תמצית במסך הבית" (?v=install; docs/study/install.md) ──
 * The steps for the device the page runs on:
 *  - an iPhone's Safari: copy the personal code (the icon starts without
 *    this sign-in: its storage is its own), Share → Add to Home Screen (iOS
 *    26: "⋯" first), Add, then the icon's "כניסה עם הקוד האישי" and paste;
 *    an arrow points at Safari's bar;
 *  - Chrome, Edge or Firefox on an iPhone: the same, from their share icon;
 *  - another app's built-in browser: the code first, then the way out to
 *    Safari (or Chrome on Android);
 *  - Android: the browser's own "התקנה" when it offered one, else its menu
 *    (the installed app keeps this sign-in: nothing to copy);
 *  - a computer: "התקנה" when the browser offers it, else one line;
 *  - the home-screen app itself: one line.
 * "הוספתי" is the member's word that it was added (iOS cannot tell). */

/** A line that replaces the button just pressed ("הוספתי", "התקנה"): it takes
 *  the focus, so a screen reader does not fall back to the page's top. */
export function DoneLine({ children, className = "a-card inst-done" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <p ref={ref} className={className} role="status" tabIndex={-1}>
      {children}
    </p>
  );
}

function Step({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`a-card inst-step ${className}`.trim()}>
      <h2 className="a-h2 inst-step-h">{title}</h2>
      {children}
    </section>
  );
}

/** Step 1 on an iPhone: the member's code, copied. Made here if there is
 *  none; a new one (after a confirm) if this device does not hold it. */
function CodeStep({ userId, say, title }: { userId: string; say: (t: string) => void; title?: string }) {
  const codes = useCodesOn();
  const [status, setStatus] = useState<CodeStatus | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<"" | "yes" | "hand">("");
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const newBtn = useRef<HTMLButtonElement>(null);
  const askBox = useRef<HTMLDivElement>(null);
  /** Where the focus goes once "קוד חדש" or "ביטול" has left the screen. */
  const back = useRef<"" | "ask" | "new">("");
  useEffect(() => {
    if (back.current === "ask") askBox.current?.querySelector<HTMLButtonElement>(".confirm-cancel")?.focus({ preventScroll: true });
    else if (back.current === "new") newBtn.current?.focus({ preventScroll: true });
    back.current = "";
  }, [ask]);
  useEffect(() => {
    if (!codes) return;
    let alive = true;
    personalCodeStatus()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        const c = cachedCode(userId);
        if (s.has_code && c && cacheFresh(c, s.created_at)) setCode(c.code);
      })
      .catch(() => alive && setStatus({ has_code: false, created_at: null, by_opener: false, by_name: null, notice: false, replaced: false, used_at: null, uses: 0 }));
    return () => {
      alive = false;
    };
  }, [codes, userId]);

  const make = async () => {
    setBusy(true);
    try {
      const c = await newPersonalCode();
      cacheCode(userId, c);
      setCode(c);
      setAsk(false);
      window.dispatchEvent(new Event("study-code-changed")); // "שלי"'s card reads it again
    } catch (e) {
      say(failText(e instanceof Error ? e.message : "", "group"));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!code) return;
    if (await copyText(formatCode(code))) setCopied("yes");
    else {
      setCopied("hand");
      setTimeout(() => field.current?.select(), 0);
    }
  };

  let body: ReactNode;
  if (!codes) body = <p className="a-small a-muted">{INSTALL.codeOff}</p>;
  else if (!status)
    body = (
      <p className="a-small a-muted" role="status">
        טוען…
      </p>
    );
  else if (code)
    body = (
      <>
        <p className="a-small a-muted">{INSTALL.codeLine}</p>
        {copied === "hand" ? (
          <>
            <p className="a-small">{INSTALL.codeByHand}</p>
            <input ref={field} className="a-input pc-code pc-field" dir="ltr" readOnly value={formatCode(code)} aria-label={INSTALL.codeLabel} onFocus={(e) => e.currentTarget.select()} />
          </>
        ) : (
          <p className="pc-code inst-code" dir="ltr">
            <span className="sr-only">{INSTALL.codeLabel}: </span>
            {formatCode(code)}
          </p>
        )}
        <button type="button" className={`a-btn wide inst-copy${copied === "yes" ? "" : " primary"}`} onClick={() => void copy()}>
          {copied === "yes" ? INSTALL.codeCopied : INSTALL.codeCopy}
        </button>
      </>
    );
  else if (!status.has_code)
    body = (
      <>
        <p className="a-small a-muted">{INSTALL.codeNone}</p>
        <button type="button" className="a-btn primary wide inst-make" disabled={busy} onClick={() => void make()}>
          {busy ? "רגע…" : INSTALL.codeMake}
        </button>
      </>
    );
  else
    body = (
      <>
        <p className="a-small a-muted">{INSTALL.codeElsewhere}</p>
        {ask ? (
          <div ref={askBox} className="a-callout warn confirm" role="alert">
            <span>{INSTALL.codeNewAsk}</span>
            <div className="a-row">
              <button type="button" className="a-btn danger" disabled={busy} onClick={() => void make()}>
                {INSTALL.codeNewYes}
              </button>
              <button
                type="button"
                className="a-btn ghost confirm-cancel"
                onClick={() => {
                  back.current = "new";
                  setAsk(false);
                }}
              >
                {INSTALL.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            ref={newBtn}
            type="button"
            className="a-btn inst-new"
            onClick={() => {
              back.current = "ask";
              setAsk(true);
            }}
          >
            {INSTALL.codeNew}
          </button>
        )}
      </>
    );
  return (
    <Step title={title ?? (codes ? INSTALL.codeTitle : INSTALL.codeOffTitle)} className="inst-code-step">
      {body}
    </Step>
  );
}

/** "הוספתי": the member says it was added. */
function Said({ onSaid }: { onSaid: () => void }) {
  return (
    <button
      type="button"
      className="a-btn primary wide inst-said-btn"
      onClick={() => {
        markInstalled("said");
        guideMark("install");
        onSaid();
      }}
    >
      {INSTALL.said}
    </button>
  );
}

/** The arrow at Safari's bar: bottom on an iPhone, top on an iPad (under
 *  the screen's head, clear of its title). Chrome, Edge and Firefox on an
 *  iPhone keep their share icon in different places, so none there. It bobs
 *  three times and rests (WCAG 2.2.2). The text carries the meaning: the
 *  arrow is decoration. */
function Pointer({ at }: { at: "top" | "bottom" }) {
  return (
    <div className={`inst-arrow ${at}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v15M5.5 12.5 12 19l6.5-6.5" />
      </svg>
    </div>
  );
}

function IosSteps({ env, userId, say }: { env: Extract<Env, { kind: "ios-safari" | "ios-browser" }>; userId: string; say: (t: string) => void }) {
  const codes = useCodesOn();
  const [said, setSaid] = useState(false);
  if (said) return <DoneLine>{INSTALL.saidDone}</DoneLine>;
  const safari26 = env.kind === "ios-safari" && (env.safari ?? 0) >= 26;
  // The "Open as Web App" switch: iOS 26; said with an "if" where the version is unknown.
  const maySwitch = safari26 || env.kind === "ios-browser" || (env.kind === "ios-safari" && env.safari === null);
  const other = env.kind === "ios-browser";
  return (
    <>
      <CodeStep userId={userId} say={say} />
      <Step title={INSTALL.shareTitle}>
        {env.kind === "ios-browser" ? (
          <p>{INSTALL.shareOther}</p>
        ) : safari26 ? (
          <>
            <p className="inst-line">
              {INSTALL.shareMoreBefore}
              <MorePill />
              {INSTALL.shareMoreAfter}
            </p>
            <p className="inst-line a-muted">
              {INSTALL.shareIconAlso} <ShareIcon />
            </p>
          </>
        ) : (
          <p className="inst-line">
            {INSTALL.shareIcon} <ShareIcon />
          </p>
        )}
        {/* Chrome, Edge or Firefox: shareOther already names the row and the way to Safari. */}
        {other ? null : (
          <>
            <p className="inst-line">
              {INSTALL.shareScroll} <AddRow />
            </p>
            <p className="a-small a-muted inst-missing">{INSTALL.shareMissing}</p>
          </>
        )}
      </Step>
      <Step title={INSTALL.addTitle}>
        {maySwitch ? <p>{INSTALL.addSwitch}</p> : null}
        <p>{codes ? INSTALL.addLine : INSTALL.addLineOff}</p>
        <Said onSaid={() => setSaid(true)} />
      </Step>
      {other ? null : <Pointer at={env.ipad ? "top" : "bottom"} />}
    </>
  );
}

function InAppSteps({ env, userId, say }: { env: Extract<Env, { kind: "ios-inapp" | "android-inapp" }>; userId: string; say: (t: string) => void }) {
  const codes = useCodesOn();
  const browser = browserOf(env);
  // The code first: this sign-in lives only inside the other app's browser.
  return (
    <>
      {codes ? <CodeStep userId={userId} say={say} /> : null}
      <Step title={`${codes ? "2. " : ""}${INSTALL.inAppTitle(browser)}`} className="inst-inapp">
        <p>{INSTALL.inAppLine}</p>
        {codes ? <p className="a-small a-muted">{INSTALL.inAppMember(browser)}</p> : null}
        <EscapeButtons env={env} />
      </Step>
    </>
  );
}

/** Android and computers: the browser's own "התקנה", or its menu. */
function PromptSteps({ env, prompt }: { env: Env; prompt: boolean }) {
  const codes = useCodesOn();
  const [result, setResult] = useState<"" | "accepted" | "dismissed">("");
  const [said, setSaid] = useState(false);
  const desktop = env.kind === "desktop";
  const install = async () => {
    const r = await runPrompt();
    if (r === "accepted" || r === "dismissed") setResult(r);
  };
  if (result === "accepted") return <DoneLine>{INSTALL.accepted}</DoneLine>;
  if (said) return <DoneLine>{INSTALL.saidDoneAndroid}</DoneLine>;
  if (desktop && !prompt) return <p className="a-card flat inst-none">{INSTALL.desktopNone}</p>;
  const menu = env.kind === "android-samsung" ? INSTALL.samsungMenu : env.kind === "android-other" ? INSTALL.otherMenu : INSTALL.chromeMenu;
  return (
    <>
      {prompt ? (
        <Step title={desktop ? INSTALL.desktopTitle : INSTALL.promptTitle}>
          <p>{desktop ? INSTALL.desktopLine : INSTALL.promptLine}</p>
          <button type="button" className="a-btn primary wide inst-install" onClick={() => void install()}>
            {INSTALL.install}
          </button>
        </Step>
      ) : (
        <Step title={INSTALL.menuTitle}>
          <p>{menu}</p>
          {env.kind === "android-chrome" ? <p className="a-small a-muted inst-tab">{INSTALL.chromeTab}</p> : null}
          <Said onSaid={() => setSaid(true)} />
        </Step>
      )}
      {/* Put off in the browser's dialog: the event is spent; the menu's way stays (Chrome may offer again later). */}
      {result === "dismissed" ? (
        <p className="a-small a-muted inst-soft" role="status">
          {INSTALL.dismissed}
        </p>
      ) : null}
      {!desktop && codes ? <p className="a-small a-muted inst-safety">{INSTALL.androidSafety}</p> : null}
    </>
  );
}

export default function InstallScreen({ ctx }: ScreenProps<"install">) {
  const { env, prompt } = useInstall();
  let body: ReactNode;
  if (env.kind === "standalone") body = <p className="a-card inst-done" role="status">{INSTALL.standalone}</p>;
  else if (env.kind === "ios-safari" || env.kind === "ios-browser") body = <IosSteps env={env} userId={ctx.userId} say={ctx.say} />;
  else if (env.kind === "ios-inapp" || env.kind === "android-inapp") body = <InAppSteps env={env} userId={ctx.userId} say={ctx.say} />;
  else body = <PromptSteps env={env} prompt={prompt} />;
  return (
    <main className="install-screen" data-env={env.kind}>
      <Head back={<BackLink go={ctx.go} fallback={{ v: "me" }} />} title={INSTALL.title} />
      {env.kind !== "standalone" ? <p className="a-para a-muted inst-intro">{INSTALL.intro}</p> : null}
      <div className="a-stack inst-steps" data-ios={isIos(env) ? "1" : undefined}>
        {body}
      </div>
    </main>
  );
}
