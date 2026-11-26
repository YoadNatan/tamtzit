import assert from "node:assert/strict";
import { test } from "node:test";
import { planRequest, styleCounts, type PlanAnswer, type PlanInputs, type PlanPoint } from "../../../shared/study/practice2";
import {
  blockOf,
  blockOfCode,
  cents,
  DEFAULT_CHOICES,
  defaultLecture,
  initialChoices,
  isBig,
  keyAction,
  lectureGroups,
  notesOf,
  offeredStyles,
  previewOf,
  progressStep,
  readSticky,
  readyDraft,
  roundSize,
  stepSize,
  tilesOf,
  writeSticky,
  type MakeChoices,
} from "./make";

/* "סט חדש" (practice sets, slice A): the preview the phone computes is the
 * server's plan, the price line, the rules that block the button, the
 * device's memory, the keyboard, and the generating screen's tiles. */

const pts = (part: number, n: number, red = 0): PlanPoint[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${part}-${i}`, part_idx: part, n: i, kind: "drug" as const, red_flag: i < red, weight: i === 0 ? 3 : 2 }));
const POINTS = [...pts(0, 6, 1), ...pts(1, 8, 2), ...pts(2, 4)];

function inputs(o: Partial<PlanInputs> = {}): PlanInputs {
  return {
    points: POINTS,
    covered: [],
    active: 12,
    free: 3,
    making: null,
    recent: null,
    headroom: { group80: 20, member40: 10, line: null },
    dailyLeft: null,
    perQuestionUsd: 0.04,
    readUsd: 0.14,
    styleUsd: 0.01,
    ...o,
  };
}
type Ans = Pick<PlanAnswer, "facts" | "defaults" | "points" | "parts">;
function answer(o: Partial<Ans> = {}): Ans {
  return {
    facts: undefined,
    defaults: ["case", "mechanism", "drug_choice", "adverse_contra"],
    points: { total: POINTS.length, current: true, stale: [], busy: false },
    parts: [0, 1, 2].map((i) => ({ part_idx: i, title: `חלק ${i}`, slide_from: i * 3 + 1, slide_to: i * 3 + 3, summary: "ready", points: 4, red_flags: 0, status: "ready", current: true, busy: false, error: null })),
    ...o,
  };
}
const choices = (o: Partial<MakeChoices> = {}): MakeChoices => ({ ...DEFAULT_CHOICES, ...o });

test("the preview is the server's plan: the custom level at the size, fresh first, the same styles", () => {
  const covered = ["p1-1", "p1-2", "p1-3", "p0-1"];
  const p = previewOf(answer(), inputs({ covered }), choices({ size: 10 }), false);
  const server = planRequest({ points: POINTS, level: "custom", count: 10, parts: [0, 1, 2], styles: ["case", "mechanism", "drug_choice", "adverse_contra"], covered });
  assert.deepEqual(p.plan, server);
  assert.equal(p.total, 10);
  assert.deepEqual(styleCounts(p.plan), styleCounts(server), "plan.styles");
  assert.equal(p.groups.reduce((n, g) => n + g.n, 0), 10, "every question in one tile group");
  assert.deepEqual(p.groups.map((g) => g.key), ["mcq", "case"]);
  assert.equal(p.stylesFrom, "default");
  // The coverage line: of 18 points, 4 covered before; the plan adds only new ones.
  assert.equal(p.cover.total, 18);
  assert.equal(p.cover.before, 4);
  assert.equal(p.cover.after, Math.min(18, 4 + p.plan.parts.reduce((n, x) => n + x.covers, 0)));
  assert.equal(p.cover.percent, 100, "10 questions cover the 14 new points, 2 each");
  const small = previewOf(answer(), inputs({ covered }), choices({ size: 5 }), false);
  assert.ok(small.cover.after < 18 && small.cover.percent < 100, "100 only when every point is covered");
});

test("the price on the button: the planned questions at the screen's rate, plus a stale read and an example", () => {
  const p = previewOf(answer(), inputs(), choices({ size: 10 }), false);
  assert.deepEqual(p.usd, { questions: 0.4, read: 0, example: 0, total: 0.4 }, "10 × $0.04 (OD11)");
  const stale = previewOf(answer({ points: { total: 18, current: false, stale: [1], busy: false } }), inputs(), choices({ size: 20 }), false);
  assert.equal(stale.usd.read, 0.14);
  assert.equal(stale.usd.total, 0.94);
  const ex = previewOf(answer(), inputs(), choices({ size: 5, exampleText: "שאלה" }), false);
  assert.deepEqual(ex.usd, { questions: 0.2, read: 0, example: 0.01, total: 0.21 });
  assert.equal(previewOf(answer(), inputs(), choices({ size: 5, exampleImage: true }), false).usd.example, 0.01);
  // Weighted by type: a staged case counts 2.5.
  const typed = previewOf(answer(), inputs(), choices({ size: 2, styles: ["steps"] }), true);
  assert.equal(typed.usd.questions, cents(2 * 2.5 * 0.04));
  assert.equal(cents(0.123), 0.13, "rounded up to the cent");
  assert.ok(isBig(1.01) && !isBig(1), "a confirmation above $1 (OD17)");
});

test("no points read yet: the size and its price, the read included, planned after the read", () => {
  const never = answer({ points: { total: 0, current: false, stale: [0, 1, 2], busy: false } });
  const p = previewOf(never, inputs({ points: [], covered: [] }), choices({ size: 10 }), false);
  assert.equal(p.estimated, true);
  assert.equal(p.total, 10);
  assert.deepEqual(p.usd, { questions: 0.4, read: 0.14, example: 0, total: 0.54 });
  assert.equal(blockOf(never, inputs({ points: [] }), p), null, "the generating screen reads first");
});

test("the types: the build's, the lecture's, the member's last ones", () => {
  assert.ok(!offeredStyles(false, null).includes("tf"), "the question types only with their flag");
  assert.ok(offeredStyles(true, null).includes("tf"));
  const noTable = { tables: false, figures: 0, labelled: 0, points: { drug: 6 } };
  assert.ok(!offeredStyles(false, noTable).includes("blank_table"), "a chip the lecture cannot have is hidden");
  const last = previewOf(answer(), inputs(), choices({ styles: ["case"] }), false);
  assert.deepEqual(last.styles, ["case"]);
  assert.equal(last.stylesFrom, "last");
  // A remembered type this lecture cannot have falls back to the defaults.
  const gone = previewOf(answer({ facts: { "0": noTable, "1": noTable, "2": noTable } }), inputs(), choices({ styles: ["blank_table"] }), false);
  assert.equal(gone.stylesFrom, "default");
  assert.ok(!gone.styles.includes("blank_table"));
});

test("what blocks the button, first reason first", () => {
  const p = (o: Partial<MakeChoices> = {}, i = inputs()) => previewOf(answer(), i, choices(o), false);
  assert.equal(blockOf(answer(), inputs(), p()), null);
  const unwritten = answer({ parts: answer().parts.map((x) => ({ ...x, summary: "writing" })) });
  assert.equal(blockOf(unwritten, inputs(), p()), "notReady");
  assert.equal(blockOf(answer(), inputs({ active: 150 }), p()), "full");
  assert.equal(blockOf(answer(), inputs({ headroom: { group80: 0, member40: 5, line: null } }), p()), "cap");
  assert.equal(blockOf(answer(), inputs({ headroom: { group80: 5, member40: 0, line: null } }), p()), "capMine");
  assert.equal(blockOf(answer(), inputs({ headroom: { group80: 5, member40: 5, line: 0 } }), p()), "line");
  assert.equal(blockOf(answer(), inputs({ dailyLeft: 0 }), p()), "daily");
  // Too big: the headroom must cover the cost plus $1.00; a smaller size is fine.
  const tight = inputs({ headroom: { group80: 1.5, member40: 9, line: null } });
  assert.equal(blockOf(answer(), tight, p({ size: 20 }, tight)), "tooBig", "$0.80 + $1 > $1.50");
  assert.equal(blockOf(answer(), tight, p({ size: 10 }, tight)), null, "$0.40 + $1 fits $1.50: a smaller set stays on");
  assert.equal(blockOf(answer(), inputs(), p({ styles: [] })), null, "no types chosen: the defaults");
});

test("the quiet lines: little headroom, and the sets left today only at 2 or fewer", () => {
  assert.deepEqual(notesOf(inputs()), { low: false, dailyLeft: null });
  assert.equal(notesOf(inputs({ headroom: { group80: 20, member40: 2.5, line: null } })).low, true, "the smallest headroom under $3");
  assert.equal(notesOf(inputs({ headroom: { group80: null, member40: null, line: null } })).low, false, "unknown: nothing said");
  assert.equal(notesOf(inputs({ dailyLeft: 3 })).dailyLeft, null);
  assert.equal(notesOf(inputs({ dailyLeft: 2 })).dailyLeft, 2);
  assert.equal(notesOf(inputs({ dailyLeft: 0 })).dailyLeft, null, "0 blocks instead");
});

test("a refusal's code is the screen's line, not 'לנסות שוב'", () => {
  for (const [code, b] of [
    ["reserve", "cap"],
    ["budget", "cap"],
    ["member_share", "capMine"],
    ["sets_line", "line"],
    ["daily_limit", "daily"],
    ["too_big", "tooBig"],
    ["off", "off"],
    ["summary not ready", "notReady"],
  ] as const)
    assert.equal(blockOfCode(code), b, code);
  assert.equal(blockOfCode("network"), null);
});

test("the device remembers the size and the types, never more", () => {
  const box = new Map<string, string>();
  const st = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v), removeItem: (k: string) => void box.delete(k) };
  assert.deepEqual(readSticky("u1", st), {});
  writeSticky("u1", { size: 20, styles: ["case", "tf"] }, st);
  assert.deepEqual([...box.keys()], ["study-make:u1"]);
  assert.deepEqual(readSticky("u1", st), { size: 20, styles: ["case", "tf"] });
  assert.deepEqual(readSticky("u2", st), {}, "per member");
  box.set("study-make:u1", JSON.stringify({ size: 99, styles: ["nope"] }));
  assert.deepEqual(readSticky("u1", st), {}, "a bad value is dropped");
  box.set("study-make:u1", "{");
  assert.deepEqual(readSticky("u1", st), {}, "broken JSON");
  assert.deepEqual(readSticky("u1", null), {}, "no storage");
  const throwing = { getItem: () => { throw new Error("denied"); } };
  assert.deepEqual(readSticky("u1", throwing), {});
  writeSticky("u1", {}, st);
  assert.equal(box.size, 0);
  assert.deepEqual(initialChoices({}).size, 10, "10 by default");
  assert.deepEqual(initialChoices({ size: 7 }).custom, true, "a number off the control is 'מספר אחר'");
});

test("the lecture without one in the route: the last read, else the newest written", () => {
  const L = (id: string, at: string, status = "ready", course = "") => ({ id, title: `הרצאה ${id}`, course, status, created_at: at });
  const ls = [L("a", "2026-11-01T10:00:00Z"), L("b", "2026-11-20T10:00:00Z", "writing"), L("c", "2026-11-10T10:00:00Z")];
  assert.equal(defaultLecture(ls, [{ lecture_id: "a", read_at: "2026-11-25T08:00:00Z" }, { lecture_id: "c", read_at: "2026-11-24T08:00:00Z" }]), "a");
  assert.equal(defaultLecture(ls, [{ lecture_id: "gone", read_at: "2026-11-26T08:00:00Z" }]), "c", "a deleted lecture's mark is skipped; the newest written");
  assert.equal(defaultLecture([L("b", "2026-11-20T10:00:00Z", "writing")], []), "b");
  assert.equal(defaultLecture([], []), null);
  const g = lectureGroups([L("x", "2026-11-01T00:00:00Z", "ready", "פרמקולוגיה"), L("y", "2026-11-02T00:00:00Z", "ready", ""), L("z", "2026-11-03T00:00:00Z", "ready", "פרמקולוגיה")]);
  assert.deepEqual(g.map((x) => [x.course, x.lectures.map((l) => l.id)]), [["פרמקולוגיה", ["z", "x"]], ["", ["y"]]]);
  assert.deepEqual(lectureGroups([L("x", "2026-11-01T00:00:00Z", "ready", "פרמקולוגיה")], "אנטומיה"), []);
});

test("the keyboard: ←/→ the size, Enter only from the body or the button, nothing in a field", () => {
  assert.equal(keyAction("ArrowLeft", { tag: "BODY", isBody: true }), "bigger", "right to left: 20 is on the left");
  assert.equal(keyAction("ArrowRight", { tag: "BODY", isBody: true }), "smaller");
  assert.equal(keyAction("Enter", { tag: "BODY", isBody: true }), "go");
  assert.equal(keyAction("Enter", { tag: "BUTTON", isButtonGo: true }), "go");
  assert.equal(keyAction("Enter", { tag: "BUTTON" }), null, "another button does its own thing");
  assert.equal(keyAction("Enter", { tag: "SUMMARY" }), null, "'עוד אפשרויות' opens");
  for (const t of [{ tag: "INPUT", type: "text" }, { tag: "INPUT", type: "number" }, { tag: "TEXTAREA" }, { tag: "DIV", editable: true }, { tag: "INPUT" }]) {
    assert.equal(keyAction("Enter", t), null, `${t.tag} ${t.type ?? ""}: typing in 'מיקוד' never creates`);
    assert.equal(keyAction("ArrowLeft", t), null, `${t.tag}: the arrows move the caret`);
  }
  assert.equal(keyAction("ArrowLeft", { tag: "BODY", isBody: true }, { ctrl: true }), null);
  assert.equal(stepSize(10, "bigger"), 20);
  assert.equal(stepSize(20, "bigger"), 20);
  assert.equal(stepSize(10, "smaller"), 5);
  assert.equal(stepSize(5, "smaller"), 5);
  assert.equal(stepSize(7, "bigger"), 10, "from a custom number to its nearest");
  assert.equal(stepSize(7, "smaller"), 5);
});

test("the generating screen's tiles: ready, on the way, did not come out", () => {
  const B = (id: string, wanted: number, status: "pending" | "writing" | "ready" | "failed", made = 0) => ({ id, wanted, made, status });
  const D = (id: string, batch: string, check = "ok", status = "pending", series: string | null = null, step: number | null = null) => ({ id, batch_id: batch, status, check_state: check, series, step });
  const t = tilesOf(
    [B("b1", 5, "ready", 5), B("b2", 5, "writing", 2), B("b3", 4, "failed", 1)],
    [D("1", "b1"), D("2", "b1"), D("3", "b1", "unchecked"), D("4", "b1", "failed"), D("5", "b1", "ok", "rejected"), D("6", "b2"), D("7", "b2", "checking"), D("8", "b3", "ok", "kept"), D("9", "b3", "ok", "pending", "s1", 2)],
  );
  assert.deepEqual(t.tiles, ["ready", "ready", "ready", "failed", "failed", "ready", "coming", "coming", "coming", "coming", "ready", "failed", "failed", "failed"]);
  assert.deepEqual({ ready: t.ready, coming: t.coming, failed: t.failed, unchecked: t.unchecked }, { ready: 5, coming: 4, failed: 5, unchecked: 1 });
  assert.equal(readyDraft(D("x", "b", "checking")), false);
  assert.equal(readyDraft(D("x", "b", "ok", "removed")), false);
  assert.equal(readyDraft(D("x", "b", "ok", "pending", "s", 1)), true, "a staged case counts once, by its first step");
  assert.deepEqual(tilesOf([], []).tiles, []);
});

test("the live region speaks at the first question, each quarter and the end; the round's size", () => {
  assert.equal(progressStep(0, 10), -1);
  assert.equal(progressStep(1, 10), 0);
  assert.equal(progressStep(3, 10), 1);
  assert.equal(progressStep(5, 10), 2);
  assert.equal(progressStep(9, 10), 3);
  assert.equal(progressStep(10, 10), 4);
  assert.deepEqual([1, 5, 6, 10, 11, 20, 21].map(roundSize), ["5", "5", "10", "10", "20", "20", "all"]);
});
