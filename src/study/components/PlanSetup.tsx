import { useMemo, useState } from "react";
import { dateOfDay, dayOfDate } from "../../../shared/study/day";
import { blockRow, buildLane, dayName, LANE, slipPrices, type GroupPlan, type LectureFact, type Missed } from "../../../shared/study/lane";
import type { Ctx } from "../features/types";
import { failText } from "../lib/failText";
import { lectureFacts, planDayRows, priceSlip, savePlan, saveLaneDays, todayIso } from "../lib/groupPlan";
import { isolateLatin } from "../lib/rich";
import { Icon } from "./Icon";
import { BackLink, Head, StickyActions } from "./Shell";

/* ── The plan's setup, and the price of a day that slipped (package G;
 *    plan.html s2: "תוכנית עד המבחן") ──
 *
 * The block exam once: its name, its date and its lectures ("כל ההרצאות של
 * הבלוק מסומנות. מכאן התוכנית נבנית לבד."); the two phases with their hours
 * ("מ-3 שבועות לפני" · "בחופש הלמידה"); "כל הרצאה חוזרת 3-4 פעמים" with the
 * growing gaps; and, when a day slipped, its card with the two prices ("עוד
 * שעה ביום עד שישי" · "לוותר על יום חזרה אחד"), with no red. Any member may
 * change the plan, and every change carries a name ("כולם יכולים לערוך, ועל
 * כל שינוי יש שם."). Saving builds the lane and saves its next 7 days as
 * marathons of the plan (PL2). */

const codeOf = (e: unknown) => (e instanceof Error ? e.message : "");
const SHARED_HOURS = [2, 3, 4] as const;
const LEAVE_HOURS = [8, 10, 12] as const;

export default function PlanSetup({
  ctx,
  plan,
  lectures,
  facts,
  missed,
  onSaved,
}: {
  ctx: Ctx;
  plan: GroupPlan | null;
  lectures: Array<{ id: string; title: string }>;
  facts: Record<string, LectureFact>;
  missed: Missed | null;
  onSaved: () => void;
}) {
  const today = todayIso();
  const [title, setTitle] = useState(plan?.title ?? "");
  const [exam, setExam] = useState(plan?.exam_date ?? dateOfDay(dayOfDate(today) + 30));
  const [chosen, setChosen] = useState<string[]>(() => plan?.lecture_ids ?? lectures.map((l) => l.id));
  const [shared, setShared] = useState(plan ? Math.round(plan.shared_minutes / 60) : 3);
  const [leave, setLeave] = useState(plan ? Math.round(plan.leave_minutes / 60) : 10);
  const [rounds, setRounds] = useState(plan?.rounds ?? LANE.ROUNDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(!plan);
  const order = useMemo(() => {
    // Oldest lecture first: the order the shared pass reads them.
    const pos = new Map((plan?.lecture_ids ?? []).map((l, i) => [l, i]));
    return [...lectures].reverse().sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
  }, [lectures, plan]);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const examOk = /^\d{4}-\d{2}-\d{2}$/.test(exam) && exam > today && dayOfDate(exam) - dayOfDate(today) <= 180;
  const ready = title.trim().length > 0 && examOk && chosen.length > 0 && chosen.length <= 40;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const ids = order.map((l) => l.id).filter((id) => chosen.includes(id));
      const r = await savePlan(ctx.group.id, { title: title.trim(), exam_date: exam, lecture_ids: ids, shared_minutes: shared * 60, leave_minutes: leave * 60, rounds }, plan);
      // The lane's next days, as marathons of the plan (PL2), rewritten for the change.
      const p: GroupPlan = {
        ...(plan ?? { id: r.id, group_id: ctx.group.id, slips: [], created_by: ctx.userId, updated_at: new Date().toISOString(), day_start: "09:00" }),
        id: r.id,
        version: r.version,
        title: title.trim(),
        exam_date: exam,
        lecture_ids: ids,
        shared_from: dateOfDay(dayOfDate(exam) - LANE.SHARED_DAYS),
        leave_from: dateOfDay(dayOfDate(exam) - LANE.LEAVE_DAYS),
        shared_minutes: shared * 60,
        leave_minutes: leave * 60,
        rounds,
        updated_by: ctx.userId,
      } as GroupPlan;
      // The lectures' real parts, so the saved days read what the screen shows.
      const real = await lectureFacts(ctx.group.id, ctx.userId, ids).catch(() => null);
      const known = Object.fromEntries(ids.map((id) => [id, real?.facts[id] ?? facts[id] ?? { id, title: lectures.find((l) => l.id === id)?.title ?? "", parts: 1, readers: 0, readByMe: false }]));
      const saved = await planDayRows(r.id).catch(() => []);
      await saveLaneDays(p, buildLane(p, known, null, []), saved, (l) => known[l]?.title ?? "", Boolean(plan)).catch(() => 0);
      ctx.say(plan ? "התוכנית עודכנה, עם השם שלך." : "התוכנית נבנתה. כולם רואים אותה ב״יחד״.");
      onSaved();
      ctx.go({ v: "plan" }, { replace: true });
    } catch (e) {
      const code = codeOf(e);
      setError(failText(code, "plan"));
      if (code === "conflict") onSaved();
    } finally {
      setBusy(false);
    }
  };

  const steps = Array.from({ length: rounds }, (_, i) => i + 1);
  return (
    <main className="plan pl-setup">
      <Head back={<BackLink go={ctx.go} fallback={{ v: "plan" }} label={plan ? "→ למרתון" : undefined} />} title="תוכנית עד המבחן" />
      <section className="a-card flat pl-exam">
        <div className="a-row between">
          <span className="a-row">
            <Icon name="cal" size={14} />
            <b dir="rtl">{title.trim() ? isolateLatin(title.trim(), "px") : "מבחן הבלוק"}</b>
          </span>
          {plan ? (
            <button type="button" className="a-btn ghost icon" aria-label="לערוך את המבחן" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <Icon name="pen" size={14} />
            </button>
          ) : null}
        </div>
        <span className="a-small a-muted">
          {examOk ? `${dayName(exam)}, ${exam.split("-").reverse().slice(0, 2).map(Number).join(".")}` : "בוחרים תאריך"} · {chosen.length === lectures.length ? "כל ההרצאות של הבלוק מסומנות" : `${chosen.length} מתוך ${lectures.length} הרצאות מסומנות`}. מכאן התוכנית נבנית לבד.
        </span>
        {open ? (
          <div className="a-stack pl-fields">
            <label className="a-field">
              <span>שם המבחן</span>
              <input className="a-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} dir="auto" placeholder="מבחן בלוק פתוגן-מאכסן" />
            </label>
            <label className="a-field">
              <span>תאריך המבחן</span>
              <input className="a-input" type="date" value={exam} min={dateOfDay(dayOfDate(today) + 1)} max={dateOfDay(dayOfDate(today) + 180)} onChange={(e) => setExam(e.target.value)} />
            </label>
            <fieldset className="pl-lectures">
              <legend className="a-small">ההרצאות של הבלוק</legend>
              {order.map((l) => (
                <label key={l.id} className="a-choice">
                  <input type="checkbox" checked={chosen.includes(l.id)} onChange={() => toggle(l.id)} />
                  <span dir="rtl">{isolateLatin(l.title, `pl${l.id}`)}</span>
                </label>
              ))}
              {!lectures.length ? <p className="a-small a-muted">עוד אין הרצאות בספרייה. מעלים הרצאה, והיא נכנסת לתוכנית.</p> : null}
            </fieldset>
          </div>
        ) : null}
      </section>

      <ul className="a-list pl-phases">
        <li className="a-li">
          <div>
            <b>מ-3 שבועות לפני</b>
            <span className="m">סבב משותף על כל הסיכומים</span>
            <div className="a-seg pl-hours" role="radiogroup" aria-label="שעות ביום בסבב המשותף">
              {SHARED_HOURS.map((h) => (
                <button key={h} type="button" className="a-btn small" role="radio" aria-checked={shared === h} onClick={() => setShared(h)}>
                  {h}
                </button>
              ))}
            </div>
          </div>
          <span className="a-chip">{`כ-${shared} שעות ביום`}</span>
        </li>
        <li className="a-li">
          <div>
            <b>בחופש הלמידה</b>
            <span className="m">שחזורים, ומה שלא ישב טוב</span>
            <div className="a-seg pl-hours" role="radiogroup" aria-label="שעות ביום בחופש הלמידה">
              {LEAVE_HOURS.map((h) => (
                <button key={h} type="button" className="a-btn small" role="radio" aria-checked={leave === h} onClick={() => setLeave(h)}>
                  {h}
                </button>
              ))}
            </div>
          </div>
          <span className="a-chip">{`כ-${leave} שעות ביום`}</span>
        </li>
      </ul>

      <section className="a-card flat pl-rounds">
        <b>{`כל הרצאה חוזרת ${rounds} פעמים`}</b>
        <div className="a-row pl-gaps" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s} className="a-row">
              <span className={`a-chip${s <= 2 ? " ok" : s === 3 ? " busy" : ""}`}>{s}</span>
              <span className="a-divider" style={{ width: `${[5, 12, 22, 30][i] ?? 8}%` }} />
            </span>
          ))}
          <Icon name="flag" size={14} />
        </div>
        <div className="a-seg" role="radiogroup" aria-label="כמה פעמים כל הרצאה חוזרת">
          {[2, 3, 4].map((n) => (
            <button key={n} type="button" className="a-btn small" role="radio" aria-checked={rounds === n} onClick={() => setRounds(n)}>
              {n} פעמים
            </button>
          ))}
        </div>
        <span className="a-small a-muted">המרווחים גדלים עד המבחן, וסבב נגמר רק כשכל שאלת מפתח נענית נכון.</span>
      </section>

      {plan && missed ? <SlipCard ctx={ctx} plan={plan} missed={missed} facts={facts} onPriced={onSaved} /> : null}
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="a-small a-muted">כולם יכולים לערוך, ועל כל שינוי יש שם.</p>
      <StickyActions>
        <button type="button" className="a-btn primary wide" disabled={!ready || busy} onClick={() => void save()}>
          {plan ? "לשמור את התוכנית" : "לבנות את התוכנית"}
        </button>
      </StickyActions>
    </main>
  );
}

/** A day that slipped (PL5): its first block, where it moved, and the two prices. No red, no "מאחרים". */
export function SlipCard({ ctx, plan, missed, facts, onPriced }: { ctx: Ctx; plan: GroupPlan; missed: Missed; facts: Record<string, LectureFact>; onPriced: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = todayIso();
  const first = missed.blocks.find((b) => b.k === "read") ?? missed.blocks[0];
  const row = first ? blockRow(first, facts) : null;
  const when = missed.day === today ? "היום" : dayOfDate(today) - dayOfDate(missed.day) === 1 ? "אתמול" : `ביום ${dayName(missed.day)}`;
  const nextDay = buildLane(plan, facts).find((d) => d.day > missed.day)?.day;
  const to = nextDay && dayOfDate(nextDay) - dayOfDate(today) === 1 ? "למחר" : nextDay === today ? "להיום" : nextDay ? `ליום ${dayName(nextDay)}` : "ליום הבא";
  const prices = slipPrices(plan, missed.day);
  const choose = async (choice: "longer" | "drop_review") => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await priceSlip(plan.id, missed.day, choice, choice === "longer" ? prices.until : null);
      ctx.say(`נבחר: ${choice === "longer" ? prices.longer : prices.drop}. השינוי נשמר עם השם שלך.`);
      onPriced();
    } catch (e) {
      setError(failText(codeOf(e), "plan"));
    } finally {
      setBusy(false);
    }
  };
  const tag = row?.slides ? (row.slides[0] === row.slides[1] ? `ש׳ ${row.slides[0]}` : `ש׳ ${row.slides[0]}-${row.slides[1]}`) : "";
  return (
    <section className="a-card flat pl-slip" aria-label="יום שלא הספקנו">
      <div className="a-row between">
        <b dir="rtl">
          {when} לא הספקנו את {isolateLatin(row?.title ?? "הבלוק", "ps")}
        </b>
        {tag ? <span className="a-tag">{tag}</span> : null}
      </div>
      <p className="a-small">{`הבלוק זז ${to}. כדי לסיים בזמן, בוחרים מחיר:`}</p>
      <div className="a-stack">
        <button type="button" className="a-btn" disabled={busy} onClick={() => void choose("longer")}>
          {prices.longer}
        </button>
        <button type="button" className="a-btn" disabled={busy} onClick={() => void choose("drop_review")}>
          {prices.drop}
        </button>
      </div>
      {error ? (
        <p className="a-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
