import { Suspense, useEffect, useRef, useState } from "react";
import { createGroup, joinGroup, type Group } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { markFresh } from "../lib/guideMark";
import { CodeEntry, openAccount, useCodesOn } from "../features/account";
import { JoinInstallNote } from "../features/install";
import { formatCode, parseCode, standalone } from "../lib/personalCode";

/* ── Getting in ──
 * One person opens a group and gets a code; everyone else joins with the code
 * (or straight from the invite link, which carries it). No email, no password.
 * A member coming back on another phone or browser uses their personal code
 * (docs/study/personal-code.md): "כניסה עם הקוד האישי" turns the card into
 * the code's panel, once the server offers codes. */

type Props = {
  initialCode: string;
  onJoined: (g: Group) => void;
  /** A session is on this device (a member removed, or a join half done). */
  signedIn?: boolean;
  /** Open on the code's panel: a #k= link that failed, with its line. */
  codePanel?: { code: string; error: string } | null;
  /** Signs in as the personal code's member (StudyApp's restore). */
  restore?: (code: string) => Promise<void>;
};

const NAME_KEY = "study-my-name";
/** The server is not set up for joining yet (its cause goes to the console). */
const JOIN_NOT_READY = "ההצטרפות לא זמינה כרגע. אפשר לנסות שוב בעוד כמה דקות.";
/** "name taken" once the personal code is offered: a returning member is
 *  pointed at their code before a second "דנה 2" is made. */
const NAME_TAKEN_CODE = "השם הזה כבר בשימוש בקבוצה. זה השם שלך? נכנסים עם הקוד האישי. אחרת אפשר להוסיף אות או שם משפחה.";

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function Join({ initialCode, onJoined, signedIn = false, codePanel = null, restore }: Props) {
  const [mode, setMode] = useState<"join" | "create">("join");
  const codes = useCodesOn() && Boolean(restore);
  const [panel, setPanel] = useState(Boolean(codePanel));
  // A personal code pasted into the group's code field: the code's panel, with it.
  const [panelCode, setPanelCode] = useState("");
  useEffect(() => {
    if (codePanel) setPanel(true);
  }, [codePanel]);
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(initialCode);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taken, setTaken] = useState(false);
  // Which field the error is about (it gets aria-invalid, the error's id and the focus), or none.
  const [bad, setBad] = useState<"name" | "code" | "group" | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLInputElement>(null);
  const fail = (text: string, field: "name" | "code" | "group" | null) => {
    setError(text);
    setBad(field);
    const ref = field === "name" ? nameRef : field === "code" ? codeRef : field === "group" ? groupRef : null;
    ref?.current?.focus();
  };
  // The guide (VITE_STUDY_GUIDE): was a code ever here? Picking "פתיחת קבוצה
  // חדשה" without one is how a member ends up alone in a new group.
  const [hadCode] = useState(() => Boolean(initialCode));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return fail("מה השם שלך?", "name");
    if (mode === "join" && code.trim().length < 6) return fail("הקוד הוא 6 תווים. אפשר לבקש אותו מהקבוצה.", "code");
    if (mode === "create" && !groupName.trim()) return fail("איך נקרא לקבוצה?", "group");
    setBusy(true);
    setError("");
    setBad(null);
    setTaken(false);
    try {
      try {
        localStorage.setItem(NAME_KEY, name.trim());
      } catch {
        /* private mode */
      }
      const g = mode === "join" ? await joinGroup(code, name) : await createGroup(groupName, name);
      markFresh(mode, g.id); // the guide's first steps on the home (nothing without VITE_STUDY_GUIDE)
      onJoined(g);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (/wrong code/i.test(msg)) fail(failText("wrong code"), "code");
      else if (msg === "name taken") {
        fail(failText("name taken"), "name");
        setTaken(true);
      } else if (/groups closed/i.test(msg)) fail(failText("groups closed"), null);
      else if (/anonymous/i.test(msg) || /study_/i.test(msg) || /does not exist/i.test(msg)) {
        // The server is not set up (anonymous sign-ins off, or the SQL not run): words for a member, the cause for whoever runs it.
        console.warn("join: the server is not ready:", msg);
        fail(JOIN_NOT_READY, null);
      } else fail("משהו השתבש בכניסה. אפשר לנסות שוב בעוד רגע.", null);
    } finally {
      setBusy(false);
    }
  };

  const toCode = () => {
    setError("");
    setBad(null);
    setPanel(true);
  };

  /** The group's code field: 6 characters. A whole invite link gives its
   *  code; a personal code (or its link or message) opens the code's panel
   *  with it, instead of being cut to 8 characters and failing as "wrong code". */
  const typeCode = (raw: string) => {
    const personal = codes ? parseCode(raw) : null;
    if (personal && raw.replace(/[\s-]/g, "").length > 8) {
      setPanelCode(formatCode(personal));
      toCode();
      return;
    }
    const invite = /[?&]join=([0-9A-Za-z]{6})\b/.exec(raw);
    setCode((invite ? invite[1] : raw).toUpperCase().slice(0, 8));
  };

  if (panel && restore && (codes || codePanel)) {
    return (
      <main className="join">
        <div className="join-card">
          <p className="join-kicker">סיכום מלא לכל הרצאה</p>
          <h1 className="join-name">תמצית</h1>
          <div className="a-card join-form">
            <Suspense fallback={<p className="a-muted">טוען…</p>}>
              <CodeEntry
                initial={panelCode || codePanel?.code || ""}
                initialError={panelCode ? "" : (codePanel?.error ?? "")}
                onCode={restore}
                onBack={() => {
                  setPanelCode("");
                  setPanel(false);
                }}
              />
            </Suspense>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="join">
      <div className="join-card">
        {codes && !signedIn && standalone() ? (
          <div className="a-callout join-home">
            <span>מי שכבר בקבוצה נכנסים כאן עם הקוד האישי.</span>
            <button type="button" className="a-btn primary small" onClick={toCode}>
              כניסה עם הקוד האישי
            </button>
          </div>
        ) : null}
        {/* Another app's built-in browser: the way out to the real one first (VITE_STUDY_INSTALL). */}
        <JoinInstallNote place="top" />
        <p className="join-kicker">סיכום מלא לכל הרצאה</p>
        <h1 className="join-name">תמצית</h1>
        {flags.guide && initialCode ? <p className="a-small a-muted join-invited">יש הזמנה. נשאר רק להקליד שם.</p> : null}
        <p className="a-para a-muted">מעלים מצגת, ותוך כמה דקות יש סיכום בעברית לכל הקבוצה.</p>
        {/* The way back for a returning member, above the fold even at 320×568 (the home-screen callout says it already). */}
        {codes && !(!signedIn && standalone()) ? (
          <button type="button" className="a-link join-signin join-code-link" onClick={toCode}>
            כבר בקבוצה? כניסה עם הקוד האישי
          </button>
        ) : null}

        <div className="a-card join-form">
          <div className="a-seg" role="tablist" aria-label="איך נכנסים">
            <button type="button" className="a-btn" role="tab" aria-selected={mode === "join"} onClick={() => setMode("join")}>
              יש לי קוד קבוצה
            </button>
            <button type="button" className="a-btn" role="tab" aria-selected={mode === "create"} onClick={() => setMode("create")}>
              פתיחת קבוצה חדשה
            </button>
          </div>
          {flags.guide && mode === "create" && !hadCode && !code ? (
            <p className="a-callout warn join-alone">כאן פותחים קבוצה חדשה וריקה. קיבלתם קישור? לוחצים ״יש לי קוד קבוצה״ (הקוד בסוף הקישור).</p>
          ) : null}

          <form onSubmit={submit} className="a-stack">
            <label className="a-field">
              <span>השם שלך</span>
              <input
                ref={nameRef}
                className="a-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="given-name"
                enterKeyHint={mode === "join" && code.trim().length >= 6 ? "go" : "next"}
                maxLength={60}
                placeholder="למשל: שוהם"
                aria-invalid={bad === "name" || undefined}
                aria-describedby={bad === "name" ? "join-error" : undefined}
              />
            </label>
            {mode === "join" ? (
              <label className="a-field">
                <span>קוד הקבוצה</span>
                <input
                  ref={codeRef}
                  value={code}
                  onChange={(e) => typeCode(e.target.value)}
                  dir="ltr"
                  inputMode="text"
                  enterKeyHint="go"
                  aria-invalid={bad === "code" || undefined}
                  aria-describedby={bad === "code" ? "join-error" : undefined}
                  autoCapitalize="characters"
                  maxLength={codes ? 300 : 8}
                  placeholder="ABC123"
                  className="a-input code-input"
                />
              </label>
            ) : (
              <label className="a-field">
                <span>שם הקבוצה</span>
                <input
                  ref={groupRef}
                  className="a-input"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  maxLength={80}
                  enterKeyHint="go"
                  placeholder="למשל: קבוצת הלמידה של שנה ג׳"
                  aria-invalid={bad === "group" || undefined}
                  aria-describedby={bad === "group" ? "join-error" : undefined}
                />
              </label>
            )}
            {error ? (
              <p className="a-error" role="alert" id="join-error">
                {taken && codes ? NAME_TAKEN_CODE : error}
              </p>
            ) : null}
            {error && taken && flags.account ? (
              <button type="button" className="a-link" onClick={() => openAccount("signin")}>
                כבר שמרת חשבון? כניסה עם מייל
              </button>
            ) : null}
            {error && taken && codes ? (
              <button type="button" className="a-link" onClick={toCode}>
                כניסה עם הקוד האישי
              </button>
            ) : null}
            <button className="a-btn primary wide" disabled={busy}>
              {busy ? "רגע…" : mode === "join" ? "הצטרפות" : "פתיחת הקבוצה"}
            </button>
          </form>
        </div>
        {/* An iPhone's Safari: one quiet line that the home screen comes after joining. */}
        <JoinInstallNote place="bottom" />
        {flags.account ? (
          <button type="button" className="a-link join-signin" onClick={() => openAccount("signin")}>
            כבר שמרת חשבון? כניסה עם מייל
          </button>
        ) : null}
      </div>
    </main>
  );
}
