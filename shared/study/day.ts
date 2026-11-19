/* ── The study day: Israel time, starting 04:00 ──
 * The same rule as SQL's ((t at time zone 'Asia/Jerusalem') - interval '4 hours')::date
 * (sections P and C, tested to agree in C22 and ME14), shared by the browser
 * and the server; package C's fsrs.ts imports studyDay from here (spec §2.12
 * #9). Days are counted since 1970-01-01, so day arithmetic is plain integers.
 * Ported unchanged from design-me Appendix B. */

export const TZ = "Asia/Jerusalem";
const DAY_MS = 86_400_000;

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function wall(ms: number): { y: number; m: number; d: number; h: number; min: number } {
  const p: Record<string, string> = {};
  for (const x of PARTS.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute) };
}

/** The study day an instant falls in: Israel's calendar date, minus one before 04:00. */
export function studyDay(ms: number): number {
  const w = wall(ms);
  const day = Date.UTC(w.y, w.m - 1, w.d) / DAY_MS;
  return w.h < 4 ? day - 1 : day;
}

/** "2026-11-15" → its day number. */
export function dayOfDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Day number → "2026-11-15". */
export function dateOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** The instant a study day starts: 04:00 Israel time on that date. */
export function dayStart(day: number): number {
  // Start from 04:00 UTC and correct by the zone's offset at that moment
  // (twice, for the days the clocks change).
  let t = day * DAY_MS + 4 * 3_600_000;
  for (let i = 0; i < 2; i++) {
    const w = wall(t);
    const shown = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
    t += day * DAY_MS + 4 * 3_600_000 - shown;
  }
  return t;
}

/** "ה׳ 20.11" */
export const WEEKDAY_HE = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
export function shortDate(day: number): string {
  const [, m, d] = dateOfDay(day).split("-").map(Number);
  return `${WEEKDAY_HE[weekday(day)]} ${d}.${m}`;
}
