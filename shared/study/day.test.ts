import assert from "node:assert/strict";
import { test } from "node:test";
import { dateOfDay, dayOfDate, dayStart, shortDate, studyDay, weekday } from "./day.js";

/* The study day (Israel time from 04:00): design-me's checks D1-D9 and the
 * flashcards design's instants around 04:00 and the 2026 clock changes,
 * whose expected days were computed with Python's zoneinfo (cards-proto
 * test/days.py), so the rule is checked against an independent zone table. */

const at = (iso: string) => dateOfDay(studyDay(Date.parse(iso)));
const startOf = (date: string) => new Date(dayStart(dayOfDate(date))).toISOString();

test("D1-D4: the day an instant belongs to", () => {
  assert.equal(at("2026-11-14T10:00:00Z"), "2026-11-14", "D1 12:00 Israel is that day");
  assert.equal(at("2026-11-15T01:30:00Z"), "2026-11-14", "D2 03:30 Israel is still the day before");
  assert.equal(at("2026-11-15T02:00:00Z"), "2026-11-15", "D3 04:00 Israel starts the next day");
  assert.equal(at("2026-07-01T00:59:00Z"), "2026-06-30", "D4 summer time: 03:59 IDT is the day before");
});

test("D5-D7c: when a study day starts, on ordinary days and on 27 Mar and 25 Oct 2026", () => {
  assert.equal(startOf("2026-11-15"), "2026-11-15T02:00:00.000Z", "D5 04:00 Israel in winter (UTC+2)");
  assert.equal(startOf("2026-07-01"), "2026-07-01T01:00:00.000Z", "D6 04:00 Israel in summer (UTC+3)");
  assert.equal(startOf("2026-10-25"), "2026-10-25T02:00:00.000Z", "D7 the day the clocks go back");
  assert.equal(startOf("2026-03-27"), "2026-03-27T01:00:00.000Z", "D7b the day the clocks go forward: 04:00 is already summer time");
  assert.equal(at("2026-03-27T00:30:00Z"), "2026-03-26", "D7c that night, 03:30 summer time still belongs to the 26th");
});

test("D8-D9: weekdays and the Hebrew short date", () => {
  assert.equal(weekday(dayOfDate("2026-11-15")), 0, "D8 2026-11-15 is a Sunday");
  assert.equal(shortDate(dayOfDate("2026-11-19")), "ה׳ 19.11", "D9");
  assert.equal(dateOfDay(dayOfDate("2026-02-28") + 1), "2026-03-01", "day numbers are plain integers");
});

test("the flashcards design's instants equal Python's zoneinfo, around 04:00 and both 2026 clock changes", () => {
  const cases: Array<[string, string]> = [
    ["2026-01-10T01:59:00Z", "2026-01-09"],
    ["2026-01-10T02:00:00Z", "2026-01-10"],
    ["2026-07-10T00:59:00Z", "2026-07-09"],
    ["2026-07-10T01:00:00Z", "2026-07-10"],
    ["2026-03-26T23:30:00Z", "2026-03-26"],
    ["2026-03-27T00:30:00Z", "2026-03-26"],
    ["2026-03-27T01:30:00Z", "2026-03-27"],
    ["2026-03-27T02:30:00Z", "2026-03-27"],
    ["2026-10-24T23:30:00Z", "2026-10-24"],
    ["2026-10-25T00:30:00Z", "2026-10-24"],
    ["2026-10-25T01:30:00Z", "2026-10-24"],
    ["2026-10-25T02:30:00Z", "2026-10-25"],
    ["2026-11-15T21:59:00Z", "2026-11-15"],
    ["2026-11-16T01:59:00Z", "2026-11-15"],
    ["2026-11-16T02:00:00Z", "2026-11-16"],
    ["2026-12-31T23:00:00Z", "2026-12-31"],
  ];
  for (const [iso, day] of cases) assert.equal(at(iso), day, iso);
});

test("every instant of 2026, hour by hour, falls in the study day that starts at or before it", () => {
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3_600_000) {
    const d = studyDay(t);
    assert.ok(dayStart(d) <= t && t < dayStart(d + 1), new Date(t).toISOString());
  }
});
