import { useEffect, useRef, useState, type ReactNode } from "react";
import { groupCreator, groupSpent, health, memberSaved, members, mySpent, removeMember, rotateCode, signOut, type Member } from "../lib/api";
import { failText } from "../lib/failText";
import { flags, ILS_PER_USD } from "../lib/flags";
import { APP_PATH, meLinks } from "../lib/route";
import { AccountCard } from "../features/account";
import { ReviewHomeSetting } from "../features/cards";
import { GuideMeRows } from "../features/guide";
import { MyLaneRows } from "../features/plan";
import { MeRows } from "../features/progress";
import { PulseSettingRow } from "../features/pulse";
import { NeedsMeSetting } from "../features/today";
import type { ScreenProps } from "../features/types";
import { Head, openPrivacy, readSize, RouteLink, saveSize, shareInvite, SIZES } from "./Shell";

/* ── "שלי" (spec §5.1; §12.2.3) ──
 * 1 the account (A1); 2 "ההתקדמות שלי" with the danger list (A2), "הטעויות
 * שלי" (Q's screen, F's link) and one's own lane of the group's plan (G);
 * 3 settings: where cards are reviewed and how many new a day (C), out of
 * the pulse (U), "הקבוצה צריכה אותך" (T), the text size (the whole app's)
 * and, with recordings, their boxes (W); 4 the month's spend; 5 the group:
 * its members, the invite, and for the group's creator a new invite code
 * and removing a member (review M4); 6 help and privacy; 7 signing out of
 * this device (A1's card takes it once accounts ship). */

const REC_KEY = "study-rec-notes";

/** "$12.40" */
export const usd = (n: number) => `$${n.toFixed(2)}`;

/** The month's spend line, with "(≈ ₪45)" at ILS_PER_USD. "≈" is read as
 *  "בערך": a screen reader gets the word, the screen keeps the sign. */
export function spendLine(spent: number, cap: number | undefined): ReactNode {
  const head = "השימוש של הקבוצה החודש: " + usd(spent);
  if (!cap) return head;
  const capText = "$" + (Number.isInteger(cap) ? String(cap) : cap.toFixed(2));
  return (
    <>
      {head + " מתוך " + capText + " ("}
      <span aria-hidden="true">≈</span>
      <span className="sr-only">בערך</span>
      {" ₪" + Math.round(spent * ILS_PER_USD) + ")"}
    </>
  );
}

/** A confirm right under what it is about, brought into view, with focus on
 *  "ביטול" (the safe choice); the screen returns focus when it is cancelled. */
function Confirm({ text, act, busy, onAct, onCancel }: { text: string; act: string; busy: boolean; onAct: () => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
    box.current?.querySelector<HTMLButtonElement>(".confirm-cancel")?.focus({ preventScroll: true });
  }, [text]);
  return (
    <div ref={box} className="a-callout warn confirm" role="alert">
      <span>{text}</span>
      <div className="a-row">
        <button className="a-btn danger" disabled={busy} onClick={onAct}>
          {act}
        </button>
        <button className="a-btn ghost confirm-cancel" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </div>
  );
}

export default function Me({ ctx }: ScreenProps<"me">) {
  const [size, setSize] = useState(readSize);
  const [recNotes, setRecNotes] = useState(() => {
    try {
      return localStorage.getItem(REC_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [spend, setSpend] = useState<{ group: number; mine: number; cap?: number } | null>(null);
  const [people, setPeople] = useState<Member[]>([]);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [creator, setCreator] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "code" } | { kind: "remove"; member: Member } | null>(null);
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const isCreator = creator === ctx.userId;
  const ask = (c: NonNullable<typeof confirm>, from: HTMLElement) => {
    opener.current = from;
    setConfirm(c);
  };
  const cancel = () => {
    setConfirm(null);
    if (opener.current?.isConnected) opener.current.focus();
  };

  useEffect(() => {
    let alive = true;
    const g = ctx.group.id;
    Promise.all([groupSpent(g), mySpent(g).catch(() => 0), health()])
      .then(([group, mine, h]) => alive && setSpend({ group, mine, cap: h?.budgetUsd }))
      .catch(() => undefined);
    members(g).then((m) => alive && setPeople(m)).catch(() => undefined);
    memberSaved(g).then((s) => alive && setSaved(s)).catch(() => undefined);
    groupCreator(g).then((c) => alive && setCreator(c)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ctx.group.id]);

  const changeSize = (d: number) => {
    const next = SIZES[Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(size) + d))];
    setSize(next);
    saveSize(next);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setConfirm(null);
      // Back to the button that asked (gone when its member was removed).
      if (opener.current?.isConnected) opener.current.focus();
    } catch (e) {
      ctx.say(failText(e instanceof Error ? e.message : "", "group"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="me-screen">
      <Head title="שלי" />
      <AccountCard ctx={ctx} />
      <MeRows ctx={ctx} />
      {/* With progress on, A2's MeRows shows "הטעויות שלי" with its count (decision 1: no account). */}
      {meLinks(flags).length && !flags.progress ? (
        <nav className="a-list links-card">
          {meLinks(flags).map((m) => (
            <RouteLink key={m.label} to={m.route} go={ctx.go} className="a-li row-link">
              {m.label}
            </RouteLink>
          ))}
        </nav>
      ) : null}
      <MyLaneRows ctx={ctx} />

      <section className="a-stack" aria-labelledby="settings-h">
        <div className="a-sec">
          <h2 id="settings-h">הגדרות</h2>
        </div>
        <div className="a-list settings">
          <ReviewHomeSetting ctx={ctx} />
          <PulseSettingRow ctx={ctx} />
          <NeedsMeSetting ctx={ctx} />
          <div className="a-li setting-row">
            <span>גודל הטקסט</span>
            <span className="size-ctl">
              <button className="a-btn small" onClick={() => changeSize(-1)} aria-label="טקסט קטן יותר" disabled={size === SIZES[0]}>
                א-
              </button>
              <bdi dir="ltr" className="size-now">
                {size}
              </bdi>
              <button className="a-btn small" onClick={() => changeSize(1)} aria-label="טקסט גדול יותר" disabled={size === SIZES[SIZES.length - 1]}>
                א+
              </button>
            </span>
          </div>
          {flags.recordings ? (
            <label className="a-li setting-row setting-check">
              <span>להציג הערות מההקלטה</span>
              <input
                type="checkbox"
                checked={recNotes}
                onChange={(e) => {
                  setRecNotes(e.target.checked);
                  try {
                    localStorage.setItem(REC_KEY, e.target.checked ? "1" : "0");
                  } catch {
                    /* private mode */
                  }
                }}
              />
            </label>
          ) : null}
        </div>
      </section>

      <section className="a-stack" aria-labelledby="spend-h">
        <div className="a-sec">
          <h2 id="spend-h">התקציב החודשי</h2>
        </div>
        <div className="a-card flat">
          {spend ? (
            <>
              <p>{spendLine(spend.group, spend.cap)}</p>
              <p className="a-small a-muted">נוצל על ידך החודש: {usd(spend.mine)}</p>
            </>
          ) : (
            <p className="a-muted">טוען…</p>
          )}
        </div>
      </section>

      <section className="a-stack" aria-labelledby="group-h">
        <div className="a-sec">
          <h2 id="group-h">הקבוצה</h2>
        </div>
        <ul className="a-list members">
          {people.map((m) => (
            <li key={m.user_id} className="member">
              <div className="a-li">
                <span className="member-name">
                  {m.name}
                  {m.user_id === ctx.userId ? <span className="a-small a-muted"> (החשבון שלך)</span> : null}
                  {saved[m.user_id] ? <span className="a-chip ok">שמור</span> : null}
                </span>
                {isCreator && m.user_id !== ctx.userId ? (
                  <button className="a-btn ghost small" onClick={(e) => ask({ kind: "remove", member: m }, e.currentTarget)}>
                    הסרה מהקבוצה
                  </button>
                ) : null}
              </div>
              {/* The confirm opens under the member it is about (review M4), never below the whole list. */}
              {confirm?.kind === "remove" && confirm.member.user_id === m.user_id ? (
                <Confirm
                  text={`להסיר את ${m.name} מהקבוצה? התגובות והתיקונים יישארו בסיכומים.`}
                  act="הסרה"
                  busy={busy}
                  onCancel={cancel}
                  onAct={() =>
                    void run(async () => {
                      await removeMember(ctx.group.id, m.user_id);
                      setPeople((p) => p.filter((x) => x.user_id !== m.user_id));
                      ctx.say(`${m.name} כבר לא בקבוצה.`);
                    })
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
        <div className="a-row">
          <button className="a-btn" onClick={() => void shareInvite(ctx.group.id, ctx.group.name, ctx.say)}>
            הזמנה לקבוצה
          </button>
          {isCreator ? (
            <button className="a-btn ghost" onClick={(e) => ask({ kind: "code" }, e.currentTarget)}>
              קוד הזמנה חדש
            </button>
          ) : null}
        </div>
        {confirm?.kind === "code" ? (
          <Confirm
            text="להחליף את קוד ההזמנה? קישור הזמנה שכבר נשלח יפסיק לעבוד."
            act="החלפה"
            busy={busy}
            onCancel={cancel}
            onAct={() =>
              void run(async () => {
                await rotateCode(ctx.group.id);
                ctx.say("קוד ההזמנה הוחלף.");
              })
            }
          />
        ) : null}
      </section>

      <GuideMeRows ctx={ctx} />

      <nav className="a-list links-card">
        <RouteLink to={{ v: "help" }} go={ctx.go} className="a-li row-link">
          עזרה
        </RouteLink>
        <a href={`${APP_PATH}?v=help#privacy`} className="a-li row-link" onClick={(e) => (e.preventDefault(), openPrivacy("me"))}>
          פרטיות: מי רואה מה
        </a>
      </nav>

      {!flags.account ? (
        <div className="a-row">
          <button className="a-btn ghost signout" onClick={() => void signOut().then(() => location.assign(APP_PATH))}>
            יציאה מהמכשיר הזה
          </button>
        </div>
      ) : null}
    </main>
  );
}
