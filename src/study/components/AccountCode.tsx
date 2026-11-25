import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { newPersonalCode, personalCodeSeen, personalCodeStatus, signOutOthers, type CodeStatus } from "../lib/api";
import { failText } from "../lib/failText";
import {
  cacheCode,
  cachedCode,
  cacheFresh,
  copyText,
  formatCode,
  laterActive,
  laterNow,
  looksLikeGroupCode,
  maskCode,
  parseCode,
  selfMessage,
  waLink,
} from "../lib/personalCode";
import type { Ctx } from "../features/types";
import { Sheet } from "./Shell";

/* ── The personal code's screens (docs/study/personal-code.md) ──
 * Loaded lazily by features/account.tsx (the identity slot): the code shown
 * with its ways to keep it, the sheet after joining and the opener's sheet,
 * the entry on the join screen, the card on "שלי", the prompt and the
 * opener's notice above the library, and the question before a #k= link
 * replaces the member signed in here. */

export const CODE_CHANGED = "study-code-changed";
/** Tells the card and the banners that the member's code changed. */
export function codeChanged(): void {
  window.dispatchEvent(new Event(CODE_CHANGED));
}

/** "25.11", the day in Israel. */
export function codeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const [, m, day] = d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).split("-");
  return `${Number(day)}.${Number(m)}`;
}

/** "25.11, 14:02", Israel time. */
export function codeWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${codeDate(iso)}, ${time}`;
}

const origin = () => location.origin;

/** The code, large and left to right, with WhatsApp, copy and share. */
export function CodeShow({ code, waText, waLabel }: { code: string; waText: string; waLabel: string }) {
  const [copied, setCopied] = useState(false);
  const [byHand, setByHand] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const shown = formatCode(code);
  useEffect(() => {
    if (byHand) field.current?.select();
  }, [byHand]);
  const copy = async () => {
    if (await copyText(shown)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } else setByHand(true);
  };
  const share = async () => {
    try {
      await navigator.share({ text: waText });
    } catch {
      /* the share sheet was closed */
    }
  };
  return (
    <div className="a-stack pc-show">
      {byHand ? (
        <input ref={field} className="a-input pc-code pc-field" dir="ltr" readOnly value={shown} aria-label="הקוד האישי" onFocus={(e) => e.currentTarget.select()} />
      ) : (
        <p className="pc-code" dir="ltr" aria-label="הקוד האישי">
          {shown}
        </p>
      )}
      {byHand ? <p className="a-small a-muted">אפשר לסמן את הקוד ולהעתיק.</p> : null}
      <div className="a-row pc-actions">
        <a className="a-btn primary pc-wa" href={waLink(waText)} target="_blank" rel="noopener">
          {waLabel}
        </a>
        <button type="button" className="a-btn" onClick={() => void copy()}>
          {copied ? "הועתק" : "העתקה"}
        </button>
        {typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
          <button type="button" className="a-btn ghost" onClick={() => void share()}>
            שיתוף
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A bottom sheet with a code: the member's own (after joining, or the
 *  prompt's), or the one the opener just made for a member. */
export function CodeSheet({
  title,
  text,
  warn,
  code,
  waText,
  waLabel,
  done,
  onClose,
}: {
  title: string;
  text: string;
  warn?: string;
  code: string;
  waText: string;
  waLabel: string;
  done: string;
  onClose: () => void;
}) {
  return (
    <Sheet label={title} className="pc-sheet" head={<h2>{title}</h2>} onClose={onClose}>
      {(sheet) => (
        <div className="a-stack pc-body">
          <p className="a-para">{text}</p>
          <CodeShow code={code} waText={waText} waLabel={waLabel} />
          {warn ? <p className="a-callout warn">{warn}</p> : null}
          <button type="button" className="a-btn primary wide" onClick={sheet.close}>
            {done}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** The member's own code, as the sheet after joining shows it. */
export function MyCodeSheet({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <CodeSheet
      title="הקוד האישי שלך"
      text="עם הקוד הזה נכנסים מכל טלפון או דפדפן, עם אותו שם ואותה התקדמות. כדאי לשמור אותו עכשיו, למשל בהודעה לעצמך בוואטסאפ."
      warn="לא מעבירים אותו לאף אחד: מי שמחזיקים בו נכנסים בשמך."
      code={code}
      waText={selfMessage(origin(), code)}
      waLabel="שליחה לעצמי בוואטסאפ"
      done="שמרתי, ממשיכים"
      onClose={onClose}
    />
  );
}

const HAND_PASTE = "אפשר ללחוץ לחיצה ארוכה בשדה ולבחור ״הדבקה״.";
const GROUP_HINT = "זה נראה כמו קוד הקבוצה. הקוד האישי ארוך יותר: 16 תווים.";
const MALFORMED = "הקוד האישי הוא 16 תווים, אותיות ומספרים.";

/** "כניסה עם הקוד האישי": the field, paste, and the sign-in. `onCode`
 *  signs the device in (StudyApp's restore) and throws a code on failure. */
export function CodeEntry({
  initial = "",
  initialError = "",
  onCode,
  onBack,
  titled = true,
}: {
  initial?: string;
  initialError?: string;
  onCode: (code: string) => Promise<void>;
  onBack?: () => void;
  titled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(initialError);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const canPaste = typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const t = text.trim().slice(0, 300);
      const c = parseCode(t);
      setValue(c ? formatCode(c) : t);
      setHint("");
      setError("");
    } catch {
      setHint(HAND_PASTE);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const code = parseCode(value);
    if (!code) return setError(looksLikeGroupCode(value) ? GROUP_HINT : MALFORMED);
    setBusy(true);
    setError("");
    try {
      await onCode(code);
    } catch (err) {
      setError(failText(err instanceof Error ? err.message : "", "group"));
    } finally {
      setBusy(false);
    }
  };
  const groupLike = !error && looksLikeGroupCode(value);
  return (
    <form className="a-stack pc-entry" onSubmit={(e) => void submit(e)}>
      {titled ? <h2 className="pc-title">כניסה עם הקוד האישי</h2> : null}
      <label className="a-field">
        <span>הקוד האישי</span>
        <input
          ref={input}
          className="a-input pc-input"
          dir="ltr"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
          onBlur={() => {
            // Shown as everywhere else: XXXX-XXXX-XXXX-XXXX, once it reads as a code.
            const c = parseCode(value);
            if (c) setValue(formatCode(c));
          }}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={300}
          aria-describedby={`${id}-hint`}
        />
      </label>
      <p id={`${id}-hint`} className="a-small a-muted">
        {groupLike ? GROUP_HINT : "אפשר להדביק את הקוד או את הקישור כולו."}
      </p>
      {hint ? <p className="a-small a-muted">{hint}</p> : null}
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="a-row">
        {canPaste ? (
          <button type="button" className="a-btn" onClick={() => void paste()}>
            הדבקה
          </button>
        ) : null}
        <button className="a-btn primary wide" disabled={busy}>
          {busy ? "רגע…" : "כניסה"}
        </button>
      </div>
      {onBack ? (
        <button type="button" className="a-link pc-back" onClick={onBack}>
          חזרה להצטרפות לקבוצה
        </button>
      ) : null}
    </form>
  );
}

/** The entry as a sheet (openAccount("enter") away from the join screen). */
export function EnterSheet({ onCode, onClose }: { onCode: (code: string) => Promise<void>; onClose: () => void }) {
  return (
    <Sheet label="כניסה עם הקוד האישי" className="pc-sheet" head={<h2>כניסה עם הקוד האישי</h2>} onClose={onClose}>
      {(sheet) => <CodeEntry titled={false} onCode={(c) => onCode(c).then(() => sheet.close())} />}
    </Sheet>
  );
}

/** A #k= link opened where another member is signed in. When that member
 *  has no code, saying yes loses them for good: said first, with a way to
 *  make their code before (a link from someone else can be a trap). */
export function LinkConfirm({
  name,
  onYes,
  onMake,
  onClose,
}: {
  name: string;
  onYes: () => Promise<void>;
  onMake: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [noCode, setNoCode] = useState(false);
  useEffect(() => {
    let alive = true;
    personalCodeStatus()
      .then((s) => alive && setNoCode(!s.has_code))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Sheet label="כניסה עם הקוד האישי" className="pc-sheet" head={<h2>כניסה עם הקוד האישי</h2>} onClose={onClose}>
      {(sheet) => (
        <div className="a-stack pc-body">
          <p className="a-para">במכשיר הזה כבר יש כניסה בשם {name}. להיכנס במקום זה עם הקוד האישי?</p>
          {noCode ? <p className="a-callout warn pc-nocode">לכניסה בשם {name} אין קוד אישי, ואי אפשר יהיה לחזור אליה.</p> : null}
          {error ? (
            <p className="a-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="a-row">
            <button
              type="button"
              className="a-btn primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                onYes()
                  .then(() => sheet.close())
                  .catch((e: unknown) => setError(failText(e instanceof Error ? e.message : "", "group")))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "רגע…" : "כניסה עם הקוד"}
            </button>
            {noCode ? (
              <button
                type="button"
                className="a-btn"
                disabled={busy}
                onClick={() => {
                  sheet.close();
                  onMake();
                }}
              >
                יצירת קוד קודם
              </button>
            ) : null}
            <button type="button" className="a-btn ghost" onClick={sheet.close}>
              ביטול
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** The opener's notice: a new code was made for this member; whether it
 *  replaced one; whether it already brought a device in (the opener sees the
 *  code, so a use the member did not make shows here); and where to cut off
 *  the other devices (`onMe`: the button is right below, on "שלי"). */
export function noticeText(s: CodeStatus, onMe: boolean): string {
  const who = s.by_name ? `מי שפתחו את הקבוצה (${s.by_name})` : "מי שפתחו את הקבוצה";
  return [
    `${who} יצרו לך קוד אישי חדש ב-${codeDate(s.created_at)}.`,
    s.replaced ? "הקוד הקודם כבר לא עובד." : "",
    s.uses > 0 && s.used_at ? `הקוד החדש כבר שימש לכניסה ב-${codeWhen(s.used_at)}.` : "",
    `אם זה לא היה בבקשתך: ${onMe ? "" : "ב״שלי״ ← "}״ניתוק המכשירים האחרים״.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The member's code status, again whenever it changes. */
function useCodeStatus(): [CodeStatus | null, () => void] {
  const [status, setStatus] = useState<CodeStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(CODE_CHANGED, on);
    return () => window.removeEventListener(CODE_CHANGED, on);
  }, []);
  useEffect(() => {
    let alive = true;
    personalCodeStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tick]);
  return [status, () => setTick((t) => t + 1)];
}

type Ask = null | "new" | "others";

/** "הקוד האישי" on "שלי". */
export function CodeCard({ ctx }: { ctx: Ctx }) {
  const [status, refresh] = useCodeStatus();
  const [shown, setShown] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const cached = cachedCode(ctx.userId);
  const fresh = status?.has_code ? cacheFresh(cached, status.created_at) : false;

  const make = async () => {
    setBusy(true);
    try {
      const code = await newPersonalCode();
      cacheCode(ctx.userId, code);
      setShown(code);
      setAsk(null);
      codeChanged();
      refresh();
      return true;
    } catch (e) {
      ctx.say(failText(e instanceof Error ? e.message : "", "group"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // "ניתוק": the new code first, then the other sessions, so no one holding
  // the old code gets in between the two and keeps a session (review 2, 6).
  const cutOthers = async () => {
    if (!(await make())) return;
    try {
      await signOutOthers();
      ctx.say("המכשירים האחרים נותקו. הקוד החדש מוצג כאן.");
    } catch {
      ctx.say("הקוד הוחלף, אבל הניתוק לא הושלם. אפשר לנסות שוב.");
    }
  };

  if (!status) return null;
  return (
    <section className="a-stack pc-card-wrap" aria-labelledby="pc-h">
      <div className="a-sec">
        <h2 id="pc-h">הקוד האישי</h2>
      </div>
      <div className="a-card flat a-stack pc-card">
        {status.notice ? <Notice status={status} onMe onSeen={refresh} /> : null}
        {!status.has_code ? (
          <>
            <p>עוד אין קוד אישי. בלעדיו, טלפון חדש או דפדפן אחר מתחילים מאפס.</p>
            {shown ? null : (
              <button type="button" className="a-btn primary" disabled={busy} onClick={() => void make()}>
                {busy ? "רגע…" : "יצירת קוד אישי"}
              </button>
            )}
          </>
        ) : fresh || shown ? (
          <>
            <p>יש קוד אישי מ-{codeDate(status.created_at)}.</p>
            {shown ? null : (
              <p className="pc-mask" dir="ltr">
                {maskCode(cached?.code ?? "")}
              </p>
            )}
          </>
        ) : (
          <p>יש קוד אישי מ-{codeDate(status.created_at)}. הוא לא שמור במכשיר הזה. אם הוא אבד: ״קוד חדש״.</p>
        )}
        {shown ? <CodeShow code={shown} waText={selfMessage(origin(), shown)} waLabel="שליחה לעצמי בוואטסאפ" /> : null}
        {status.has_code && status.used_at ? <p className="a-small a-muted pc-used">כניסה אחרונה עם הקוד: {codeWhen(status.used_at)}.</p> : null}
        {status.has_code ? (
          <div className="a-row pc-actions">
            {fresh && cached ? (
              <button type="button" className="a-btn" onClick={() => setShown(shown ? null : cached.code)} aria-expanded={Boolean(shown)}>
                {shown ? "הסתרה" : "הצגה"}
              </button>
            ) : null}
            <button type="button" className="a-btn ghost" onClick={() => setAsk("new")}>
              קוד חדש
            </button>
            <button type="button" className="a-btn ghost" onClick={() => setAsk("others")}>
              ניתוק המכשירים האחרים
            </button>
          </div>
        ) : null}
        {ask === "new" ? (
          <ConfirmLine
            text="ליצור קוד חדש? הקוד הקודם יפסיק לעבוד. מכשירים שכבר מחוברים יישארו מחוברים."
            act="יצירה"
            busy={busy}
            onAct={() => void make()}
            onCancel={() => setAsk(null)}
          />
        ) : null}
        {ask === "others" ? (
          <ConfirmLine
            text="לנתק את כל המכשירים האחרים? הם ייצאו, וגם ייווצר קוד חדש. המכשיר הזה נשאר מחובר."
            act="ניתוק"
            busy={busy}
            onAct={() => void cutOthers()}
            onCancel={() => setAsk(null)}
          />
        ) : null}
      </div>
    </section>
  );
}

/** A confirm under what it is about, focus on "ביטול". */
function ConfirmLine({ text, act, busy, onAct, onCancel }: { text: string; act: string; busy: boolean; onAct: () => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
    box.current?.querySelector<HTMLButtonElement>(".confirm-cancel")?.focus({ preventScroll: true });
  }, [text]);
  return (
    <div ref={box} className="a-callout warn confirm" role="alert">
      <span>{text}</span>
      <div className="a-row">
        <button type="button" className="a-btn danger" disabled={busy} onClick={onAct}>
          {act}
        </button>
        <button type="button" className="a-btn ghost confirm-cancel" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </div>
  );
}

function Notice({ status, onMe = false, onSeen }: { status: CodeStatus; onMe?: boolean; onSeen: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="a-callout warn pc-notice" role="status">
      <span>{noticeText(status, onMe)}</span>
      <div className="a-row">
        <button
          type="button"
          className="a-btn small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            personalCodeSeen()
              .catch(() => undefined)
              .finally(() => {
                setBusy(false);
                codeChanged();
                onSeen();
              });
          }}
        >
          הבנתי
        </button>
      </div>
    </div>
  );
}

/** On the home (Today) and above the library: the opener's notice, or the
 *  prompt for a member without a code ("אחר כך" hides it for 3 days). */
export function CodeBanners({ ctx }: { ctx: Ctx }) {
  const [status, refresh] = useCodeStatus();
  const [later, setLater] = useState(() => laterActive(ctx.userId));
  const [sheet, setSheet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!status) return null;
  if (status.notice) return <Notice status={status} onSeen={refresh} />;
  return (
    <>
      {!status.has_code && !later ? (
        <div className="a-callout pc-prompt" role="status">
          <span>חדש: קוד אישי. איתו נכנסים מכל טלפון או דפדפן, עם אותו שם ואותה התקדמות.</span>
          <div className="a-row">
            <button
              type="button"
              className="a-btn primary small"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                newPersonalCode()
                  .then((code) => {
                    cacheCode(ctx.userId, code);
                    setSheet(code);
                  })
                  .catch((e: unknown) => ctx.say(failText(e instanceof Error ? e.message : "", "group")))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "רגע…" : "יצירת הקוד"}
            </button>
            <button
              type="button"
              className="a-btn ghost small"
              onClick={() => {
                laterNow(ctx.userId);
                setLater(true);
              }}
            >
              אחר כך
            </button>
          </div>
        </div>
      ) : null}
      {sheet ? (
        <MyCodeSheet
          code={sheet}
          onClose={() => {
            setSheet(null);
            codeChanged();
          }}
        />
      ) : null}
    </>
  );
}
