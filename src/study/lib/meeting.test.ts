import assert from "node:assert/strict";
import { test } from "node:test";
import type { BandMeeting } from "./meeting";

// meeting.ts reads the app's Supabase client (api.ts), which reads Vite's import.meta.env.
(import.meta as unknown as { env: Record<string, string> }).env = {};
const { CARD_MS, catchupEmpty, catchupMinutes, coffeeChip, dayText, guessLine, HEARTBEAT_MS, HERE_MS, israelInstant, israelParts, PLACE_MS, PlaceReporter, ritualsNow, slideRange, unclearToast, whenLine } =
  await import("./meeting");

/* M-2 (spec §12.4.M): the place throttle, the heartbeat and the presence
 * refresh; the words for the majority (never a number); the coffee chip;
 * catch-up's minutes; the study day and Israel's clock; decision 7's two
 * rituals; decision 1's promise. */

/** A fake clock: timers fire when time is moved past them. */
function fakeClock() {
  let now = 1_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    set: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (t: unknown) => void timers.delete(t as number),
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

test("the reader's place: at most one call in 5 s, the last place always sent, a heartbeat every 20 s", () => {
  const clock = fakeClock();
  const sent: Array<{ at: number; place: string }> = [];
  const r = new PlaceReporter((p, a) => sent.push({ at: clock.now(), place: `${p}.${a}` }), clock);
  r.place(0, 1);
  assert.deepEqual(sent.map((s) => s.place), ["0.1"], "the first place goes at once");
  clock.advance(1000);
  r.place(0, 2);
  clock.advance(1000);
  r.place(0, 3);
  clock.advance(1000);
  r.place(0, 4);
  assert.equal(sent.length, 1, "nothing more inside the 5 s");
  clock.advance(2000);
  assert.deepEqual(sent.map((s) => s.place), ["0.1", "0.4"], "the trailing call sends the last place only");
  assert.equal(sent[1].at - sent[0].at, PLACE_MS);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].at - sent[i - 1].at >= PLACE_MS, "never two calls within 5 s");
  // The same place again sends nothing; standing still sends the heartbeat.
  r.place(0, 4);
  clock.advance(HEARTBEAT_MS - 1);
  assert.equal(sent.length, 2);
  clock.advance(1);
  assert.deepEqual(sent.map((s) => s.place), ["0.1", "0.4", "0.4"], "a heartbeat 20 s after the last call, at the same place");
  clock.advance(HEARTBEAT_MS * 3);
  assert.equal(sent.length, 6, "and every 20 s after, while reading");
  r.stop();
  clock.advance(HEARTBEAT_MS * 3);
  assert.equal(sent.length, 6, "nothing after stop");
});

test("a burst of scrolling sends one call per 5 s window, ending on the last place", () => {
  const clock = fakeClock();
  const sent: string[] = [];
  const at: number[] = [];
  const r = new PlaceReporter((p, a) => {
    sent.push(`${p}.${a}`);
    at.push(clock.now());
  }, clock);
  for (let i = 0; i < 60; i++) {
    r.place(Math.floor(i / 10), i % 10);
    clock.advance(250);
  }
  clock.advance(PLACE_MS);
  assert.equal(sent[sent.length - 1], "5.9", "the last place is always sent");
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= PLACE_MS);
  assert.ok(sent.length <= Math.ceil((60 * 250) / PLACE_MS) + 1, `${sent.length} calls for 15 s of scrolling`);
  r.stop();
});

test("the timings the database's rules need", () => {
  assert.equal(PLACE_MS, 5_000);
  assert.ok(HEARTBEAT_MS < 60_000 && HEARTBEAT_MS === 20_000, "a live reading reports within the database's minute");
  assert.ok(HERE_MS === 180_000 && HERE_MS < 10 * 60_000, "a follower's presence (10 minutes in the database) is refreshed every 3 minutes");
  assert.equal(CARD_MS, 6_000);
});

test("the majority's words: a released guess's own line, never a number", () => {
  const opt = (i: number) => ["Sporozoite", "Hypnozoite", "Schizont"][i];
  assert.equal(guessLine({ mine: 1, correct: false, majority: { most_right: false, spread: false, with_most: true } }, opt), "ניחשת Hypnozoite, כמו רוב הקבוצה");
  assert.equal(guessLine({ mine: 0, correct: true, majority: { most_right: false, spread: false, with_most: false } }, opt), "ניחשת Sporozoite, נכון. רוב הקבוצה ניחשה אחרת.");
  assert.equal(guessLine({ mine: 2, correct: false, majority: { most_right: false, spread: true, with_most: false } }, opt), "ניחשת Schizont. הקבוצה התפזרה בין התשובות.");
  assert.equal(guessLine({ mine: 2, correct: false, majority: null }, opt), "ניחשת Schizont.", "fewer than 3 guessers: her own guess only");
  assert.equal(guessLine({ mine: null, correct: null, majority: { most_right: true, spread: false, with_most: false } }, opt), "לא ניחשת. רוב הקבוצה צדקה.");
  for (const m of [null, { most_right: true, spread: false, with_most: true }, { most_right: false, spread: true, with_most: false }]) {
    for (const mine of [null, 0, 1]) assert.ok(!/\d/.test(guessLine({ mine, correct: mine === 0, majority: m }, opt)), "no digit in any line");
  }
});

test("the coffee chip: the round's majority as a word, nothing below 3 answers", () => {
  assert.deepEqual(coffeeChip("most_right"), { text: "רובכם צדקו", tone: "ok" });
  assert.deepEqual(coffeeChip("split"), { text: "הקבוצה חלוקה", tone: "warn" });
  assert.deepEqual(coffeeChip("most_wrong"), { text: "רובכם טעו", tone: "bad" });
  assert.equal(coffeeChip(null), null);
  assert.equal(coffeeChip(undefined), null);
});

test("catch-up's minutes, as the database counts them, and the empty catch-up", () => {
  const stop = { part: 0, anchor: 1, quote: "" };
  const res = { id: "r", question: "?", part: 0, anchor: 1, answer: "!", answer_by: "דניאל" };
  const pin = { id: "p", body: "x", fact: "y", part: 0, anchor: 2, by: null };
  assert.equal(catchupMinutes({ stops: [stop], resolved: [res], pins: [pin], questions: ["a", "b", "c"] }), 10, "2 + 1 + 1 + ½ → 1 + 4.5 → 5 (M12c)");
  assert.equal(catchupMinutes({ stops: [stop], resolved: [res], pins: [], questions: ["a", "b", "c"] }), 9);
  assert.equal(catchupMinutes({ stops: [], resolved: [], pins: [], questions: [] }), 2);
  assert.equal(catchupMinutes({ stops: [stop, stop], resolved: [], pins: [pin, pin, pin], questions: Array(5).fill("q") }), 2 + 2 + 2 + 8);
  assert.ok(catchupEmpty({ stops: [], resolved: [], pins: [], questions: [] }));
  assert.ok(!catchupEmpty({ stops: [], resolved: [], pins: [], questions: ["a"] }));
});

test("the study day and Israel's clock", () => {
  // 03:30 in Israel is still yesterday's study day; 04:00 is today's.
  assert.equal(dayText(Date.parse("2026-11-17T01:30:00Z")), "2026-11-16", "03:30 Israel (UTC+2)");
  assert.equal(dayText(Date.parse("2026-11-17T02:00:00Z")), "2026-11-17", "04:00 Israel");
  assert.equal(israelInstant("2026-11-18", "09:00"), "2026-11-18T07:00:00.000Z", "winter: UTC+2");
  assert.equal(israelInstant("2026-07-01", "09:00"), "2026-07-01T06:00:00.000Z", "summer: UTC+3");
  assert.equal(israelInstant("2026-11-18", "9am"), null);
  assert.deepEqual(israelParts("2026-11-18T07:05:00.000Z"), { date: "2026-11-18", time: "09:05" });
  assert.equal(slideRange(19, 33), "ש׳ 19-33");
  assert.equal(slideRange(19, 19), "ש׳ 19");
  assert.equal(slideRange(null, 3), "");
  const now = Date.parse("2026-11-17T08:00:00Z");
  assert.equal(whenLine({ day: "2026-11-17", starts_at: "2026-11-17T07:00:00Z" }, now), "היום · 09:00");
  assert.equal(whenLine({ day: "2026-11-18", starts_at: "2026-11-18T07:00:00Z" }, now), "מחר · 09:00");
  assert.equal(whenLine({ day: "2026-11-19", starts_at: "2026-11-19T07:00:00Z" }, now), "יום ה׳ · 09:00");
});

test("decision 7: at most two rituals a day, the opening before the reading and the closing after it", () => {
  const base: Pick<BandMeeting, "coffee" | "closing" | "started_at" | "reading" | "reader_id" | "over"> = { coffee: null, closing: null, started_at: null, reading: false, reader_id: null, over: false };
  assert.deepEqual(ritualsNow(base, false), { coffee: "offer", closing: "none" }, "before: the opening is offered, the closing is not");
  assert.deepEqual(ritualsNow(base, true), { coffee: "none", closing: "none" }, "skipped");
  assert.deepEqual(ritualsNow({ ...base, coffee: { id: "c", state: "question" } }, false), { coffee: "live", closing: "none" });
  assert.deepEqual(ritualsNow({ ...base, coffee: { id: "c", state: "ended" }, started_at: "2026-11-17T07:00:00Z" }, false), { coffee: "done", closing: "none" }, "after the opening, before the reading: no closing yet");
  const read = { ...base, started_at: "2026-11-17T07:10:00Z", reading: true, reader_id: "u1" };
  assert.deepEqual(ritualsNow(read, false), { coffee: "none", closing: "offer" }, "once the reading started: no opening any more, the closing");
  assert.deepEqual(ritualsNow({ ...read, coffee: { id: "c", state: "ended" } }, false), { coffee: "done", closing: "offer" });
  assert.deepEqual(ritualsNow({ ...read, closing: { id: "e", state: "lobby" } }, false), { coffee: "none", closing: "live" });
  assert.deepEqual(ritualsNow({ ...read, closing: { id: "e", state: "ended" }, over: true }, false), { coffee: "none", closing: "done" }, "one closing: never a second");
  assert.deepEqual(ritualsNow({ ...read, over: true }, false), { coffee: "none", closing: "none" }, "an ended meeting offers nothing");
});

test("decision 1: the tap's toast promises tomorrow only when something brings the paragraph back", () => {
  assert.equal(unclearToast(true), "סומן, בלי שם. הפסקה תחזור אליך מחר.");
  assert.equal(unclearToast(false), "סומן, בלי שם. הסימון נשמר רק אצלך.");
});
