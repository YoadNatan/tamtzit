import assert from "node:assert/strict";
import { test } from "node:test";
import { countWord, groupChips, privateLine } from "./anchor";
import { cardState, groupLine, paragraphSession, practiceable, questionKind, questionState, tabCount, type TabQuestion } from "./anchorTab";
import { flagsFrom, requiredSchema } from "./flags";
import { allowed, parseRoute, routeUrl } from "./route";
import { modeOf, parseScope, pickQueue, unpracticed, type SessionQuestion } from "./practiceSession";

/* Package N (§12.4.N): the chip row's words, the "תרגול" tab's states, the
 * paragraph's practice session (p.<lecture>.<part>.<anchor>), and the flag. */

const L = "eeeeeeee-0000-4000-8000-000000000005";
const q = (o: Partial<TabQuestion>): TabQuestion => ({
  id: "q",
  kind: "mcq",
  style: null,
  question: "?",
  teaser: "",
  stale: false,
  hidden: false,
  answered: 0,
  wrong: 0,
  last_correct: null,
  ...o,
});

test("the chips: singular for one, the mockup's order, comments from the reader's live count", () => {
  assert.equal(countWord(1, "שאלה", "שאלות"), "שאלה");
  assert.equal(countWord(2, "שאלה", "שאלות"), "2 שאלות");
  assert.deepEqual(
    groupChips({ questions: 2, cards: 2 }, { total: 1, open: 0 }).map((c) => c.label),
    ["2 שאלות", "2 כרטיסים", "תגובה"],
  );
  assert.deepEqual(
    groupChips({ questions: 1, cards: 1 }).map((c) => c.label),
    ["שאלה", "כרטיס"],
  );
  assert.deepEqual(groupChips({ questions: 0, cards: 0 }, { total: 3, open: 1 }), [{ key: "comments", label: "3 תגובות", open: true }]);
  assert.deepEqual(groupChips({ questions: 0, cards: 0 }), []);
});

test("the private line: her wrong answers, then her ׳לא ברור׳; 'השאלה חוזרת מחר' only with Today (decision 12)", () => {
  assert.equal(privateLine({ my_wrong: 2, my_unclear: true }, false), "טעית כאן פעמיים.");
  assert.equal(privateLine({ my_wrong: 2, my_unclear: false }, true), "טעית כאן פעמיים. השאלה חוזרת מחר.");
  assert.equal(privateLine({ my_wrong: 1, my_unclear: false }, false), "טעית כאן.");
  assert.equal(privateLine({ my_wrong: 3, my_unclear: false }, false), "טעית כאן 3 פעמים.");
  assert.equal(privateLine({ my_wrong: 0, my_unclear: true }, false), "סימנת כאן ׳לא ברור׳");
  assert.equal(privateLine({ my_wrong: 0, my_unclear: false }, true), "");
});

test("the tab's states: wrong twice, wrong, not yet, right; a marked or hidden question says why", () => {
  assert.deepEqual(questionState(q({ answered: 3, wrong: 2, last_correct: false })), { label: "טעית פעמיים", tone: "bad" });
  assert.deepEqual(questionState(q({ answered: 1, wrong: 1, last_correct: false })), { label: "טעית", tone: "bad" });
  assert.deepEqual(questionState(q({})), { label: "עוד לא ענית", tone: "" });
  assert.deepEqual(questionState(q({ answered: 2, wrong: 1, last_correct: true })), { label: "ענית נכון", tone: "ok" });
  assert.equal(questionState(q({ stale: true, answered: 1, last_correct: true })).label, "בבדיקה אחרי תיקון בפסקה");
  assert.equal(questionState(q({ hidden: true })).label, "הוסתרה עד בדיקה");
  assert.deepEqual(cardState({ in_deck: true, stale: false }), { label: "בחפיסה", tone: "busy" });
  assert.deepEqual(cardState({ in_deck: false, stale: false }), { label: "עוד לא בחפיסה", tone: "" });
  assert.equal(cardState({ in_deck: true, stale: true }).label, "בבדיקה אחרי תיקון בפסקה");
  assert.equal(questionKind({ kind: "case", style: null }), "שאלה · מקרה קליני");
  assert.equal(questionKind({ kind: "mcq", style: "case" }), "שאלה · מקרה קליני");
  assert.equal(questionKind({ kind: "case", style: "mechanism" }), "שאלה");
});

test("the tab's lines: the group's counts without hidden questions, and what 'לתרגל את הפסקה' asks", () => {
  const tab = {
    questions: [q({ id: "a" }), q({ id: "b", answered: 1 }), q({ id: "c", hidden: true }), q({ id: "d", stale: true })],
    cards: [{ id: "x", kind: "qa" as const, front: "?", source: "ai", stale: false, in_deck: true, lapses: 0 }],
  };
  assert.equal(groupLine(tab), "של הקבוצה: 3 שאלות, כרטיס אחד");
  assert.equal(groupLine({ questions: [], cards: [] }), "");
  assert.equal(tabCount(tab), 4);
  assert.deepEqual(
    practiceable(tab.questions).map((x) => x.id),
    ["a", "b"],
  );
});

test("a paragraph's session: its key parses, keeps the paragraph's questions in reading order, and records as the lecture's", () => {
  const key = paragraphSession(L, 7, 12);
  assert.equal(key, `p.${L}.7.12`);
  assert.deepEqual(parseScope(key), { kind: "paragraph", lecture: L, part: 7, anchor: 12 });
  assert.equal(parseScope(`p.${L}.7`), null);
  assert.equal(parseScope("p.not-a-lecture.1.2"), null);
  assert.equal(modeOf(parseScope(key)!), "lecture");
  const at = (n: number) => new Date(Date.UTC(2026, 10, 1, 10, n)).toISOString();
  const mk = (id: string, part: number, created: number, lecture = L): SessionQuestion => ({
    id,
    lecture_id: lecture,
    ref_lecture: null,
    exam_no: null,
    part_idx: part,
    created_at: at(created),
    topic: "",
    vignette: "",
    question: id,
    options: ["a", "b"],
  });
  const questions = [mk("q3", 7, 3), mk("q1", 7, 1), mk("q2", 7, 2), mk("other-part", 6, 0), mk("other-lecture", 7, 0, "eeeeeeee-0000-4000-8000-000000000009")];
  const latest = new Map([["q2", { correct: false, at: at(30), times: 1 }]]);
  assert.deepEqual(pickQueue({ key, questions, latest, size: "all", random: () => 0.5 }), ["q1", "q3", "q2"]);
  assert.equal(unpracticed({ key, questions, latest, answered: ["q1"] }), 1);
});

test("the route: ?v=practice&s=p.… needs practice and ANCHOR; the flag needs questions or cards and section N", () => {
  const route = parseRoute(`v=practice&s=p.${L}.3.4`);
  assert.deepEqual(route, { v: "practice", s: `p.${L}.3.4` });
  assert.equal(routeUrl(route), `/?v=practice&s=p.${L}.3.4`);
  const rel2 = flagsFrom({ VITE_STUDY_QUESTIONS: "1", VITE_STUDY_PRACTICE: "1", VITE_STUDY_CARDS: "1", VITE_STUDY_QUIZ: "1" });
  const withN = flagsFrom({ VITE_STUDY_QUESTIONS: "1", VITE_STUDY_PRACTICE: "1", VITE_STUDY_CARDS: "1", VITE_STUDY_ANCHOR: "1" });
  assert.equal(rel2.anchor, false);
  assert.equal(withN.anchor, true);
  assert.notDeepEqual(allowed(route, rel2).route, route);
  assert.deepEqual(allowed(route, withN).route, route);
  assert.equal(flagsFrom({ VITE_STUDY_ANCHOR: "1" }).anchor, false);
  assert.equal(requiredSchema(withN).N, 1);
  assert.equal(requiredSchema(rel2).N, undefined);
});
