/* ── A person's notification settings, and when pushes may go ──
 * The settings' defaults (Yoad's answers of 26 Nov 2026) and quiet hours,
 * the same rule as section R's study_private.notify_quiet() (a test reads the
 * defaults from study-schema.sql and checks the same instants): the night
 * window (23:00 to 07:30 by default) and, when chosen, Shabbat (Friday 16:00
 * to Saturday 20:30), Israel time. Windows that touch are passed together.
 * The settings screen uses it for "עכשיו שעות שקט". */

export type NotifyPrefs = {
  live: boolean; // "עכשיו בקבוצה"
  mine: boolean; // "בשבילך"
  digest: boolean; // the daily reminder
  digest_at: string; // "HH:MM"
  quiet: boolean;
  quiet_from: string;
  quiet_to: string;
  shabbat: boolean;
};

export const DEFAULT_PREFS: NotifyPrefs = {
  live: true,
  mine: true,
  digest: false,
  digest_at: "19:30",
  quiet: true,
  quiet_from: "23:00",
  quiet_to: "07:30",
  shabbat: false,
};

export const SHABBAT = { from: "16:00", to: "20:30" } as const;

const TZ = "Asia/Jerusalem";
const DAY_MS = 86_400_000;
const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type Wall = { day: number; sec: number }; // the Israel date (days since 1970-01-01) and the second of that day

function wall(ms: number): Wall {
  const p: Record<string, string> = {};
  for (const x of PARTS.formatToParts(new Date(ms))) p[x.type] = x.value;
  const day = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY_MS;
  return { day, sec: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second) + (((ms % 1000) + 1000) % 1000) / 1000 };
}

/** "HH:MM" → seconds of the day. */
const secOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60;
};

/** The instant of an Israel wall time (as SQL's "timestamp at time zone"). */
function instant(day: number, sec: number): number {
  const target = day * DAY_MS + sec * 1000;
  let t = target - 2 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const w = wall(t);
    t += target - (w.day * DAY_MS + w.sec * 1000);
  }
  return t;
}

/** Null when a push may go at `at` (ms); otherwise when the quiet window ends (ms). */
export function quietUntil(p: Pick<NotifyPrefs, "quiet" | "quiet_from" | "quiet_to" | "shabbat">, at: number): number | null {
  const from = secOf(p.quiet_from);
  const to = secOf(p.quiet_to);
  let t = at;
  for (let i = 0; i < 4; i++) {
    const w = wall(t);
    let end: number | null = null;
    if (p.quiet && from !== to) {
      if (from < to) {
        if (w.sec >= from && w.sec < to) end = instant(w.day, to);
      } else if (w.sec >= from) {
        end = instant(w.day + 1, to);
      } else if (w.sec < to) {
        end = instant(w.day, to);
      }
    }
    if (p.shabbat) {
      const dow = (((w.day + 4) % 7) + 7) % 7; // 0 Sunday … 5 Friday, 6 Saturday
      if ((dow === 5 && w.sec >= secOf(SHABBAT.from)) || (dow === 6 && w.sec < secOf(SHABBAT.to))) {
        const e = instant(w.day + (dow === 5 ? 1 : 0), secOf(SHABBAT.to));
        end = end === null ? e : Math.max(end, e);
      }
    }
    if (end === null || end <= t) break;
    t = end;
  }
  return t === at ? null : t;
}
