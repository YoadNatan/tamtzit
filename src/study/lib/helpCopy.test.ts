import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { ENDS, flagsFrom, type Ends, type Flags } from "./flags";
import { helpRows } from "./helpCopy";

/* F-15 (§12.2.7): the copy. No string of the app says "מבחן חי",
 * "תחרותי" or "נקודות על תשובה נכונה ומהירה" (the approved names are "מבחן
 * קבוצתי", "כולנו נגד המבחן" and "מירוץ", decision 2); and Help's rows are
 * §12.7.5's under each release's set: the spec's §6.2 with the designs' rows
 * (meeting §8.2, fun §5.8, server §9.2), each with its flag, §12.7.5's
 * sentences word for word where help carries them, and the spec's rows "מבחן
 * חי" and "תיקון בסיכום" replaced. The privacy note, and every §12.7.5
 * sentence only it carried, was removed on 19 Nov 2026 at Yoad's request.
 * tools/study-bundle.mjs checks the built bundle for the same three
 * strings. */

const root = process.cwd();
/** The plain copy pass (docs/study/COPY.md) rewords some of the spec's sentences:
 *  its table "| where | the spec said | now |", as a map from the old to the new. */
const COPY_NOW = new Map(
  [...readFileSync(join(process.cwd(), "docs", "study", "COPY.md"), "utf8").matchAll(/^\| [^|]+ \| "([^"]+)" \| "([^"]+)" \|$/gm)].map((m) => [m[1], m[2]] as const),
);

const FORBIDDEN = ["מבחן חי", "תחרותי", "נקודות על תשובה נכונה ומהירה"];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(tsx?|css|html)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test("no string of the app says מבחן חי, תחרותי or נקודות על תשובה נכונה ומהירה (decision 2, §6.0 rule 2 as §12 replaces it)", () => {
  const sources = [...files(join(root, "src", "study")), ...files(join(root, "shared", "study")), join(root, "index.html")];
  assert.ok(sources.length > 40, `${sources.length} files`);
  const found: string[] = [];
  for (const f of sources) {
    const text = readFileSync(f, "utf8");
    for (const bad of FORBIDDEN) if (text.includes(bad)) found.push(`${relative(root, f)}: ${bad}`);
  }
  assert.deepEqual(found, []);
});

/* ── releases (§12.7.6), each adding to the one before ── */
const R4 = ["QUESTIONS", "PRACTICE", "QUIZ", "MEETING", "ANCHOR"];
const R5 = [...R4, "CARDS"];
const R6 = [...R5, "CORRECTIONS", "VAR", "ASK", "WALL"];
const R7 = [...R6, "ACCOUNT"];
const R8 = [...R7, "PROGRESS", "CARDS_REVIEW", "TODAY", "GUESS", "PULSE"];
const R9 = [...R8, "MARATHONS", "GROUP_PLAN", "BOSS", "MUSEUM", "TRAPS", "BLANK_TABLE", "NEEDS_ME", "EVE"];
const R12 = [...R9, "PDF", "RECORDINGS", "EXAMS"];
/** Production's 27 flags (sources.md, phases 1 and 2): the course pages and past exams on, so the exams' row is read. */
const S2 = [
  "ANCHOR", "ASK", "BLANK_TABLE", "BOSS", "CARDS", "CARDS_REVIEW", "CORRECTIONS", "COURSES", "EVE", "EXAMS", "GROUP_PLAN", "GUESS", "GUIDE", "MARATHONS",
  "MEETING", "MUSEUM", "NEEDS_ME", "PRACTICE", "PROGRESS", "PULSE", "QTYPES", "QUESTIONS", "QUIZ", "TODAY", "TRAPS", "VAR", "WALL",
];
/** The guide on top of a release's set (docs/study/guide.md). */
const G1 = ["QUESTIONS", "PRACTICE", "CARDS", "GUIDE"];
const RELEASES: Array<[string, string[]]> = [
  ["1-2", []],
  ["4", R4],
  ["5", R5],
  ["6", R6],
  ["7", R7],
  ["8", R8],
  ["9", R9],
  ["12", R12],
  ["1 with the guide", G1],
  ["12 with the guide", [...R12, "GUIDE"]],
  ["production with the question types", [...R9, "GUIDE", "QTYPES"]],
  ["production with the courses (sources.md, phase 1)", [...R9, "GUIDE", "QTYPES", "COURSES"]],
  ["the courses alone", ["COURSES"]],
  // Production now (mock.cjs's "s2"): R12's EXAMS alone leaves f.exams off (flags.ts: practice && COURSES && EXAMS).
  ["production (27 flags, s2)", [...S2]],
];
const flagSet = (names: string[]): Flags => flagsFrom(Object.fromEntries(names.map((n) => [`VITE_STUDY_${n}`, "1"])));
const W = { serverWrites: false, devicePrint: false };
/** The approved releases have every end of §12.3 built: their copy is read so. */
const ALL_ENDS: Ends = { Q: true, C: true, B: true };

/** Help's rows: each title with the flag that shows it (the spec's §6.2 as
 *  the designs' tables replace and extend it). */
const HELP: Array<[string, (f: Flags) => boolean]> = [
  ["מה זה תמצית", () => true],
  ["מדריך לאפליקציה", (f) => f.guide], // the guide (docs/study/guide.md)
  ["העלאת הרצאה", () => true],
  ["קורסים", (f) => f.courses], // courses (docs/study/sources.md, phase 1)
  ["הנקודות שצריך לדעת", (f) => f.practice], // package B, decision 2 of 17 Nov 2026
  ["קריאה יחד", () => true],
  ["הפגישה היומית", (f) => f.meeting],
  ["היום", (f) => f.today],
  ["תגובות ושאלות", () => true],
  ["מה יושב על הפסקה", (f) => f.anchor],
  ["תיקון בסיכום", (f) => f.corrections],
  ["מחלוקות", (f) => f.var],
  ["סימון קריאה", () => true],
  ["תרגול", (f) => f.practice],
  ["סוגי שאלות", (f) => f.qtypes], // question types (docs/study/question-types.md)
  ["מבחנים קודמים", (f) => f.exams],
  ["שאלה משלי", (f) => f.traps],
  ["טבלה ריקה", (f) => f.blankTable], // package E, P10 (decision 3: usable early)
  ["מבחן קבוצתי", (f) => f.quiz],
  ["אתגר קבוצתי", (f) => f.boss],
  ["כרטיסיות", (f) => f.cards],
  ["לשאול את החומר", (f) => f.ask],
  ["קיר האסוציאציות", (f) => f.wall],
  ["מה קשה לקבוצה", (f) => f.pulse],
  ["טעויות נפוצות", (f) => f.museum],
  ["ההתקדמות שלי", (f) => f.progress],
  ["מפגשי למידה", (f) => f.marathons],
  ["תוכנית עד המבחן", (f) => f.groupPlan],
  ["שמירת החשבון", (f) => f.account],
  ["הקלטות", (f) => f.recordings],
  ["PDF ושיתוף", () => true],
  ["התקציב החודשי", () => true],
  ["כשמשהו נתקע", () => true],
];
test("help's rows, each with its flag, under every release's set; no privacy note", () => {
  for (const [release, names] of RELEASES) {
    const f = flagSet(names);
    assert.deepEqual(
      helpRows(f, W, ALL_ENDS).map((r) => r.title),
      HELP.filter(([, on]) => on(f)).map(([t]) => t),
      `release ${release}: help`,
    );
    const titles = helpRows(f, W, ALL_ENDS).map((r) => r.title);
    for (const gone of ["מבחן חי", "אסוציאציות", "ההתקדמות שלי ותוכנית", "פרטיות: מי רואה מה"]) assert.ok(!titles.includes(gone), `release ${release}: the row ${gone} is gone`);
    const text = shown(f);
    for (const gone of ["לאן החומר הולך", "מה נשמר ואיפה", "מי רואה את הקבצים"]) assert.ok(!text.includes(gone), `release ${release}: the privacy note is gone: ${gone}`);
  }
});

/** The text a set shows: every help row. */
function shown(f: Flags, ends: Ends = ALL_ENDS): string {
  return helpRows(f, W, ends)
    .flatMap((r) => [r.title, r.text])
    .join("\n");
}

test("§12.7.5's sentences, word for word, shown with their flag and only with it; the privacy note's are gone with it", () => {
  const md = readFileSync(join(root, "docs", "study", "spec", "addendum", "addendum.md"), "utf8");
  const section = md.slice(md.indexOf("#### 12.7.5"), md.indexOf("#### 12.7.6"));
  const bullets = [...section.matchAll(/^- \*\((\w+)\)\* (.+)$/gm)];
  assert.equal(bullets.length, 7, "quiz, meeting, corrections, var, pulse, wall, ask");
  const FLAG: Record<string, keyof Flags> = { quiz: "quiz", meeting: "meeting", corrections: "corrections", var: "var", pulse: "pulse", wall: "wall", ask: "ask" };
  // The bullets whose sentences only the privacy note carried (removed on 19 Nov 2026).
  const NOTE_ONLY = new Set(["quiz", "meeting", "var", "pulse", "wall"]);
  const every = flagSet([...R12, "QUIZ_ROUNDS"]);
  // Yoad's decisions of 17 Nov 2026 win over the addendum where they differ: a
  // sentence their table replaces ("| where | the addendum said | now |") is
  // checked, word for word, in its new wording.
  const decisions = readFileSync(join(root, "docs", "study", "DECISIONS-2026-11-17.md"), "utf8");
  const replaced = new Map(
    [...decisions.matchAll(/^\| §12\.7\.5[^|]*\| "([^"]+)" \| "([^"]+)" \|$/gm)].map((m) => [m[1], m[2]] as const),
  );
  assert.ok(replaced.size >= 1, "decision 1 rewords the pulse's bullet (package U)");
  for (const [, flag, line] of bullets) {
    const quotes = [...line.matchAll(/"([^"]+)"/g)]
      .map((m) => m[1].replace(/^…/, ""))
      .filter((q) => /[א-ת]/.test(q) && q.length > 12)
      .map((q) => replaced.get(q) ?? q)
      .map((q) => COPY_NOW.get(q) ?? q);
    assert.ok(quotes.length >= 1, `(${flag}) has its sentences`);
    if (NOTE_ONLY.has(flag)) {
      for (const q of quotes) assert.ok(!shown(every).includes(q), `(${flag}) went with the privacy note: ${q}`);
      continue;
    }
    for (const q of quotes) {
      assert.ok(shown(every).includes(q), `(${flag}) shown with every flag: ${q}`);
      const without = flagsFrom(Object.fromEntries([...R12].map((n) => [`VITE_STUDY_${n}`, "1"])));
      (without as Record<string, boolean>)[FLAG[flag]] = false;
      assert.ok(!shown(without).includes(q), `(${flag}) hidden without its flag: ${q}`);
    }
  }
  for (const old of replaced.keys()) assert.ok(!shown(every).includes(old), `the addendum's wording a decision replaced is gone: ${old}`);
  assert.ok(COPY_NOW.size >= 3, "docs/study/COPY.md's table");
  for (const old of COPY_NOW.keys()) assert.ok(!shown(every).includes(old), `the wording the plain copy replaced is gone: ${old}`);
});

test("the contradicted lines are gone: the race scores the bet, and a correction waits for a second approval", () => {
  for (const [release, names] of RELEASES) {
    const text = shown(flagSet(names));
    for (const bad of [...FORBIDDEN, "הטקסט משתנה לכל הקבוצה", "״קבוצתי״", "שלושת המקומות הראשונים"]) assert.ok(!text.includes(bad), `release ${release}: ${bad}`);
  }
  const r6 = shown(flagSet(R6));
  assert.ok(r6.includes("״מירוץ״: ניקוד לפי כמה הייתם בטוחים, ומהירות רק שוברת שוויון"), "decision 2");
  assert.ok(r6.includes("התיקון מתעדכן לכל הקבוצה אחרי אישור של עוד חבר או חברה, או אישור בקול בפגישה."), "decision 5");
});

test("the gating rule: before release 8 no row promises in-app review's private cards or Today's queue (§12.7.6)", () => {
  for (const names of [R5, R6, R7]) {
    const text = shown(flagSet(names));
    assert.ok(!text.includes("הופכת לכרטיסייה פרטית"), "private cards wait for in-app review");
    assert.ok(!text.includes("להיכנס לתור שלך"), "the queue waits for Today");
  }
  const r8 = shown(flagSet(R8));
  assert.ok(r8.includes("טעות שלך בתרגול או במבחן הקבוצתי הופכת לכרטיסייה פרטית, עם ההסבר בגב.") && r8.includes("כשמסמנים שנענתה, התשובה יכולה להיכנס לתור שלך ככרטיסייה."));
});

test("every line is gender-neutral (§6.0 rule 1)", () => {
  const text = shown(flagSet([...R12, "QUIZ_ROUNDS"]));
  for (const bad of ["מישהו", "מישהי", "מי הצביע ", "מי שמקבל ", "מי שפתח ", "נבחר רואה", "ואף אחד לא רואה למה", "ומי מקריא."]) assert.ok(!text.includes(bad), bad);
});

/* ── release 1 (docs/study/RELEASE-1.md): QUESTIONS, PRACTICE and CARDS, with
 * none of §12.3's ends and no section B. Help says what those screens do: the spec's §6.2 rows word for word, and nothing of the
 * bet, the autopsy, two-flag hiding, a deck of one's own, private cards or
 * questions written ahead. ── */
const R1 = ["QUESTIONS", "PRACTICE", "CARDS"];

/** Release 1's build, as it shipped: none of the ends. This branch's own
 *  ENDS (release 2) has Q's end; release 1's copy is still what helpRows
 *  gives without it. */
const R1_ENDS: Ends = { Q: false, C: false, B: false };

test("release 1: help is the spec's §6.2 for practice and cards, with nothing of the ends or the bank", () => {
  const f = flagSet(R1);
  // Release 1 had none of the ends: neither the bank's rows nor B's as decision 2 redefines them.
  const AHEAD = ["שאלות שנכתבות מראש", "הנקודות שצריך לדעת"];
  const rows = helpRows(f, W, R1_ENDS);
  assert.deepEqual(
    rows.map((r) => r.title),
    HELP.filter(([t, on]) => on(f) && !AHEAD.includes(t)).map(([t]) => t),
  );
  // The spec's rows (§6.2's table), word for word, as their flags leave them.
  const spec = readFileSync(join(root, "docs", "study", "spec", "spec-final.md"), "utf8");
  const specRow = (title: string) => new RegExp(`^\\| ${title} \\| \\w+ \\| (.+) \\|$`, "m").exec(spec)?.[1] ?? "";
  assert.equal(rows.find((r) => r.title === "תרגול")?.text, specRow("תרגול").replace(/ \*\(progress\)\*.*$/, ""));
  assert.equal(rows.find((r) => r.title === "כרטיסיות")?.text, specRow("כרטיסיות").replace(/, \*\(cards review\)\*.*$/, "."));
  const text = shown(f, R1_ENDS);
  for (const ahead of ["הימור", "למה מה שבחרת", "מתי כן", "שני דגלים", "חלק אחרי חלק", "החפיסה שלך", "כרטיס פרטי", "Batch", "אוטומטית", "מבחן קבוצתי", "מבחן חי"]) {
    assert.ok(!text.includes(ahead), `release 1 says nothing of: ${ahead}`);
  }
  // With progress on and still no end, the spec's mistakes sentence joins the practice row.
  const withProgress = helpRows(flagSet([...R1, "PROGRESS"]), W, R1_ENDS).find((r) => r.title === "תרגול")?.text ?? "";
  assert.ok(withProgress.endsWith("שאלה עם טעות נשארת ב״הטעויות שלי״ עד שעונים עליה נכון ביום אחר."), withProgress);
});

/* ── release 2 (docs/study/quiz.md): release 1 and the group quiz, still with
 * none of Q's, C's or B's ends, and no meeting. The quiz's help row says
 * what section Z does: the bet, the argument and the
 * second vote, the race scored by the bet, counts only from 3; nothing of
 * "שאלות פתיחה" (section M) or of a trap card (C's end). ── */
/** Release 2's build, as it shipped: Q's end, none of C's or B's. */
const R2_ENDS: Ends = { Q: true, C: false, B: false };

test("release 2: Q's end is built, so practice's help row is the end's (the bet, the autopsy, two flags)", () => {
  for (const names of [R1, [...R1, "QUIZ"]]) {
    const f = flagSet(names);
    const practice = helpRows(f, W, R2_ENDS).find((r) => r.title === "תרגול")?.text ?? "";
    assert.ok(practice.includes("מסמנים כמה בטוחים (ניחוש · נראה לי · על בטוח)") && practice.includes("׳מתי כן׳") && practice.includes("שני דגלים"), practice);
    const text = shown(f, R2_ENDS);
    for (const notYet of ["החפיסה שלך", "כרטיסייה פרטית", "שאלות שנכתבות מראש", "כתיבה מראש:"]) assert.ok(!text.includes(notYet), `release 2 says nothing of C's or B's ends: ${notYet}`);
  }
});

test("release 2: the quiz's help row, without the meeting's opening or a trap card", () => {
  const f = flagSet([...R1, "QUIZ"]);
  assert.ok(f.quiz && !f.meeting);
  const row = helpRows(f, W, R2_ENDS).find((r) => r.title === "מבחן קבוצתי")?.text ?? "";
  assert.ok(row.includes("עונים לבד ומסמנים כמה בטוחים (ניחוש · נראה לי · על בטוח); כשהקבוצה חצויה יש 90 שניות לשכנע ועונים שוב."), row);
  assert.ok(row.includes("״מירוץ״: ניקוד לפי כמה הייתם בטוחים, ומהירות רק שוברת שוויון; הטבלה רק לשחקני המירוץ ורק בתוך המשחק."), row);
  const text = shown(f, R2_ENDS);
  for (const later of ["שאלות פתיחה", "כרטיסיית ׳טעות נפוצה׳", "הפגישה היומית", "מבחן חי", "תחרותי"]) assert.ok(!text.includes(later), `release 2 says nothing of: ${later}`);
});

test("W2: every release says that taps at once count once, and that deleting stops the writing", () => {
  for (const [release, names] of RELEASES) {
    const f = flagSet(names);
    const stuck = helpRows(f, W, ENDS).find((r) => r.title === "כשמשהו נתקע")?.text ?? "";
    assert.ok(stuck.includes("כמה טלפונים שלוחצים יחד על אותו חלק נספרים כלחיצה אחת."), `release ${release}: ${stuck}`);
    assert.ok(stuck.includes("המחיקה עוצרת גם את כתיבת הסיכום, ואחרי ״שחזור״ ״המשך כתיבה״ ממשיך מאיפה שנעצר."), `release ${release}: ${stuck}`);
  }
});

/* ── this branch (study/w3-c): C's end is built. With production's flags
 * (release 2's) the cards' help row says the deck is added part by part;
 * the private cards and the review home are said only with in-app review
 * (VITE_STUDY_CARDS_REVIEW). Still nothing of section B. ── */
test("C's end: the cards' help row; private cards and the home only with review", () => {
  assert.deepEqual(ENDS, { Q: true, C: true, B: true }, "this branch has Q's and C's ends, and B as decision 2 redefines it");
  const f = flagSet([...R1, "QUIZ"]);
  const cards = helpRows(f, W).find((r) => r.title === "כרטיסיות")?.text ?? "";
  assert.ok(cards.includes("מוסיפים לחפיסה שלך חלק אחרי חלק, ועד 20 כרטיסיות חדשות ביום."), cards);
  assert.ok(!cards.includes("כרטיסייה פרטית") && !cards.includes("בית אחד לחזרות"), "no private card or home while review is off");
  const review = helpRows(flagSet([...R1, "QUIZ", "CARDS_REVIEW"]), W).find((r) => r.title === "כרטיסיות")?.text ?? "";
  assert.ok(review.includes("טעות שלך בתרגול או במבחן הקבוצתי הופכת לכרטיסייה פרטית, עם ההסבר בגב. בוחרים בית אחד לחזרות: האפליקציה או Anki."), review);
  for (const notYet of ["שאלות שנכתבות מראש", "כתיבה מראש:"]) assert.ok(!shown(f, ENDS).includes(notYet), `nothing of section B: ${notYet}`);
});

/* ── package B as Yoad's decision 2 (17 Nov 2026) redefines it: the points to
 * know are read after the summary, on the server; no question or card is
 * written automatically. Help says so with practice on, and never promises
 * questions or cards written ahead. ── */
test("B: help says the points are read after the summary, and nothing is written ahead", () => {
  const f = flagSet([...R1, "QUIZ"]);
  const help = helpRows(f, { serverWrites: true, devicePrint: true }).find((r) => r.title === "הנקודות שצריך לדעת")?.text ?? "";
  assert.ok(help.includes("הנקודות שצריך לדעת נקראות ממנו מעצמן, פעם אחת לכל הקבוצה"), help);
  assert.ok(help.includes("כשהשימוש החודשי מגיע ל-80% מהתקרה הקריאה מדלגת, ו״לקרוא את הנקודות״ נשאר בלחיצה."), "the cap: skipped, and the tap stays");
  assert.ok(help.includes("שאלות וכרטיסיות לא נכתבות מעצמן: רק כשבוחרים ליצור אותן."), "decision 2: no automatic questions or cards");
  const text = shown(f, ENDS);
  for (const gone of ["במצב החסכוני", "במצב ה-Batch", "שאלות וכרטיסיות נכתבות אוטומטית", "להכין גם שאלות וכרטיסיות"]) assert.ok(!text.includes(gone), `the bank's words are gone: ${gone}`);
  // Only with practice: the cards alone have no setup screen to open.
  assert.ok(!shown(flagSet(["CARDS"]), ENDS).includes("הנקודות שצריך לדעת נקראות"));
  assert.ok(!shown(flagSet([]), ENDS).includes("הנקודות שצריך לדעת נקראות"));
});

test("T-1: Today's help names only the rows the build queues (each waits for its own flag)", () => {
  const today = (names: string[]) => helpRows(flagSet(names), W, ALL_ENDS).find((r) => r.title === "היום")?.text ?? "";
  const all = today(["QUESTIONS", "PRACTICE", "QUIZ", "MEETING", "CARDS", "CARDS_REVIEW", "CORRECTIONS", "VAR", "PROGRESS", "TODAY"]);
  assert.equal(
    all,
    "המסך הראשון: הפגישה של היום, ומתחת ״התור שלי״ לפי הזמן שיש (10, 20 או 45 דקות): כרטיסיות שהגיע זמנן, טעויות מהמבחן הקבוצתי, טעות ׳על בטוח׳ בניסוח חדש, פסקאות שסימנת ׳לא ברור׳ ועדכונים בסיכום. מה שלא נכנס עובר למחר. מ-4 ימי למידה מתוך 7 יש סימון. הכול גלוי רק לך.",
  );
  // Production's set with Today and the review: cards only, no meeting, no quiz.
  assert.equal(
    today(["QUESTIONS", "PRACTICE", "CARDS", "CARDS_REVIEW", "TODAY"]),
    "המסך הראשון: ״התור שלי״ לפי הזמן שיש (10, 20 או 45 דקות): כרטיסיות שהגיע זמנן. מה שלא נכנס עובר למחר. מ-4 ימי למידה מתוך 7 יש סימון. הכול גלוי רק לך.",
  );
  assert.equal(today(["CARDS"]), "", "no Today, no row");
});

test("question types: help says which types there are and where to choose and filter them", () => {
  const f = flagSet([...R9, "QTYPES"]);
  const row = helpRows(f, W, ALL_ENDS).find((r) => r.title === "סוגי שאלות");
  assert.equal(
    row?.text,
    "יש כמה סוגים: אמריקאית, שאלה על תמונה, סימון על תמונה, התאמה, סידור, מקרה קליני בשלבים ונכון / לא נכון. איך עונים: בנכון / לא נכון מסמנים כל משפט; בהתאמה נוגעים במקום ואז בתשובה; בסידור נוגעים בשלבים מהראשון לאחרון, ו-↑ ↓ מזיזים; בסימון על תמונה בוחרים מה מסומן במספר, או נוגעים במספר שבשרטוט; במקרה בשלבים כל שלב הוא שאלה, והמקרה ממשיך. ב״סבב חדש״ בוחרים ״סוג שאלה״. סוגים חדשים נכתבים ב״שאלות חדשות״, מהתקציב של הקבוצה.",
  );
  assert.ok(!helpRows(flagSet(R9), W, ALL_ENDS).some((r) => r.title === "סוגי שאלות"), "not without the flag");
});

test("courses (sources.md, phase 1): help says what the course page does, with each sentence's own flag", () => {
  const row = (names: string[]) => helpRows(flagSet(names), W, ALL_ENDS).find((r) => r.title === "קורסים")?.text ?? "";
  assert.equal(row([...R9]), "", "no row without VITE_STUDY_COURSES");
  const all = row([...R9, "COURSES"]);
  for (const words of ["עמוד הקורס", "״לתרגל מה שכבר יש״", "״לשאול על כל הקורס״", "״נבחרו 12 מתוך 340 פסקאות״", "״העלאה של כמה קבצים״", "מחכים לחודש הבא", "בוחרים שוב את אותם קבצים", "בשם של הקובץ", "ממתינה לכתיבה", "לכל הקבוצה"])
    assert.ok(all.includes(words), words);
  const alone = row(["COURSES"]);
  assert.ok(!alone.includes("לתרגל") && !alone.includes("לשאול"), "without practice and ask, neither is promised");
});

test("past exams (sources.md, phase 2): help's row names where things are, what they cost and who sees a change", () => {
  const row = (names: string[]) => helpRows(flagSet(names), W, ALL_ENDS).find((r) => r.title === "מבחנים קודמים")?.text ?? "";
  assert.equal(row(R12), "", "EXAMS without COURSES: no past exams (flags.ts), no row");
  const text = row(S2);
  for (const words of ["״מבחנים קודמים״ ←", "״לבדיקה״", "״רק הטעויות״", "בתקציב החודשי", "לכל הקבוצה", "״סימולציה״"]) assert.ok(text.includes(words), words);
  for (const bad of ["מישהו", "השרת"]) assert.ok(!text.includes(bad), bad);
});
