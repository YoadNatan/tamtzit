import { dateOfDay, dayOfDate, studyDay } from "../../../shared/study/day";
import { blockRow, blockTimes, dayName, eveOpen, minutesOfClock, nextBlock, type LectureFact } from "../../../shared/study/lane";
import { lectureTitles } from "./api";
import { activePlan, planDayRows } from "./groupPlan";

/* ── The plan in brief, for the cards outside the plan's screen (package G):
 *    "הבלוק הבא: {title} · {time}" on "יחד", the lane's row on "שלי", and
 *    the exam-eve card on Today. Loaded lazily by features/plan.tsx. ── */

const israelClock = (now: number): number => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(now));
  return minutesOfClock(p);
};

/** The plan's title and the next block of today's or the next saved day. */
export async function planBrief(groupId: string, now = Date.now()): Promise<{ title: string; exam_date: string; lecture_ids: string[]; next: string } | null> {
  const plan = await activePlan(groupId);
  if (!plan) return null;
  const today = dateOfDay(studyDay(now));
  const days = (await planDayRows(plan.id)).filter((d) => d.plan_day >= today && d.state !== "ended" && d.agenda.length);
  let next = "";
  const d = days[0];
  if (d) {
    const titles = await lectureTitles(d.agenda.map((b) => b.l).filter((l): l is string => Boolean(l))).catch(() => ({}) as Record<string, string>);
    const facts: Record<string, LectureFact> = Object.fromEntries(Object.entries(titles).map(([id, title]) => [id, { id, title, parts: 1, readers: 0, readByMe: false }]));
    const start = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d.starts_at));
    const times = blockTimes(d.agenda, start);
    const nb = d.plan_day === today ? nextBlock(d.agenda, start, israelClock(now)) : { i: d.agenda.findIndex((b) => b.k !== "intro"), chip: "" };
    const i = nb && nb.i >= 0 ? nb.i : -1;
    if (i >= 0) {
      const row = blockRow(d.agenda[i], facts, d.agenda[i + 1]);
      const when = d.plan_day === today ? times[i] : `${dayName(d.plan_day)} ${times[i]}`;
      next = `הבלוק הבא: ${row.title} · ${when}`;
    }
  }
  return { title: plan.title, exam_date: plan.exam_date, lecture_ids: plan.lecture_ids, next };
}

/** The exam-eve card: from LANE.EVE_DAYS before the exam to its day, or null. */
export async function eveBrief(groupId: string, now = Date.now()): Promise<{ when: string; lectures: Array<{ id: string; title: string }> } | null> {
  const plan = await activePlan(groupId);
  const today = dateOfDay(studyDay(now));
  if (!plan || !eveOpen(plan, today)) return null;
  const left = dayOfDate(plan.exam_date) - dayOfDate(today);
  const titles = await lectureTitles(plan.lecture_ids);
  return {
    when: left === 0 ? "המבחן היום" : left === 1 ? "המבחן מחר" : `המבחן ביום ${dayName(plan.exam_date)}`,
    lectures: plan.lecture_ids.filter((l) => titles[l]).map((l) => ({ id: l, title: titles[l] })),
  };
}
