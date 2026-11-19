import { useState } from "react";
import { createGroup, joinGroup, type Group } from "../lib/api";
import { failText } from "../lib/failText";
import { flags } from "../lib/flags";
import { markFresh } from "../lib/guideMark";
import { openAccount } from "../features/account";

/* ── Getting in ──
 * One person opens a group and gets a code; everyone else joins with the code
 * (or straight from the invite link, which carries it). No email, no password. */

type Props = { initialCode: string; onJoined: (g: Group) => void };

const NAME_KEY = "study-my-name";

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function Join({ initialCode, onJoined }: Props) {
  const [mode, setMode] = useState<"join" | "create">("join");
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(initialCode);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taken, setTaken] = useState(false);
  // The guide (VITE_STUDY_GUIDE): was a code ever here? Picking "פתיחת קבוצה
  // חדשה" without one is how a member ends up alone in a new group.
  const [hadCode] = useState(() => Boolean(initialCode));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("מה השם שלך?");
    if (mode === "join" && code.trim().length < 6) return setError("הקוד הוא 6 תווים. אפשר לבקש אותו מהקבוצה.");
    if (mode === "create" && !groupName.trim()) return setError("איך נקרא לקבוצה?");
    setBusy(true);
    setError("");
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
      if (/wrong code/i.test(msg)) setError(failText("wrong code"));
      else if (msg === "name taken") {
        setError(failText("name taken"));
        setTaken(true);
      } else if (/groups closed/i.test(msg)) setError(failText("groups closed"));
      else if (/anonymous/i.test(msg)) setError("הכניסה עוד לא הופעלה בשרת. צריך להפעיל Anonymous sign-ins ב-Supabase.");
      else if (/study_/i.test(msg) || /does not exist/i.test(msg)) setError("מסד הנתונים עוד לא הוכן. צריך להריץ את study-schema.sql ב-Supabase.");
      else setError("משהו השתבש בכניסה. אפשר לנסות שוב בעוד רגע.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="join">
      <div className="join-card">
        <p className="join-kicker">סיכום מלא לכל הרצאה</p>
        <h1 className="join-name">תמצית</h1>
        {flags.guide && initialCode ? <p className="a-small a-muted join-invited">יש הזמנה. נשאר רק להקליד שם.</p> : null}
        <p className="a-para a-muted">מעלים מצגת, ותוך כמה דקות יש סיכום בעברית לכל הקבוצה.</p>

        <div className="a-card join-form">
          <div className="a-seg" role="tablist" aria-label="איך נכנסים">
            <button type="button" className="a-btn" role="tab" aria-selected={mode === "join"} onClick={() => setMode("join")}>
              יש לי קוד
            </button>
            <button type="button" className="a-btn" role="tab" aria-selected={mode === "create"} onClick={() => setMode("create")}>
              פתיחת קבוצה חדשה
            </button>
          </div>
          {flags.guide && mode === "create" && !hadCode && !code ? (
            <p className="a-callout warn join-alone">כאן פותחים קבוצה חדשה וריקה. קיבלתם קישור? לוחצים ״יש לי קוד״ (הקוד בסוף הקישור).</p>
          ) : null}

          <form onSubmit={submit} className="a-stack">
            <label className="a-field">
              <span>השם שלך</span>
              <input className="a-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={60} placeholder="למשל: שוהם" />
            </label>
            {mode === "join" ? (
              <label className="a-field">
                <span>קוד הקבוצה</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  dir="ltr"
                  inputMode="text"
                  autoCapitalize="characters"
                  maxLength={8}
                  placeholder="ABC123"
                  className="a-input code-input"
                />
              </label>
            ) : (
              <label className="a-field">
                <span>שם הקבוצה</span>
                <input className="a-input" value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={80} placeholder="למשל: קבוצת הלמידה של שנה ג׳" />
              </label>
            )}
            {error ? (
              <p className="a-error" role="alert">
                {error}
              </p>
            ) : null}
            {error && taken && flags.account ? (
              <button type="button" className="a-link" onClick={() => openAccount("signin")}>
                כבר שמרת חשבון? כניסה עם מייל
              </button>
            ) : null}
            <button className="a-btn primary wide" disabled={busy}>
              {busy ? "רגע…" : mode === "join" ? "הצטרפות" : "פתיחת הקבוצה"}
            </button>
          </form>
        </div>
        {flags.account ? (
          <button type="button" className="a-link join-signin" onClick={() => openAccount("signin")}>
            כבר שמרת חשבון? כניסה עם מייל
          </button>
        ) : null}
      </div>
    </main>
  );
}
