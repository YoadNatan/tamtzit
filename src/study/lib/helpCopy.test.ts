import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { ENDS, flagsFrom, type Ends, type Flags } from "./flags";
import { helpRows, privacyLines } from "./helpCopy";

/* F-15 (§12.2.7): the copy. No string of the app says "מבחן חי",
 * "תחרותי" or "נקודות על תשובה נכונה ומהירה" (the approved names are "מבחן
 * קבוצתי", "כולנו נגד המבחן" and "מירוץ", decision 2); and Help's rows and the
 * privacy note's lines are §12.7.5's under each release's set: the spec's
 * §6.2 with the designs' rows and lines (meeting §8.2, fun §5.8, server
 * §9.2), each with its flag, §12.7.5's sentences word for word, and the
 * spec's rows "מבחן חי" and "תיקון בסיכום" replaced. tools/study-bundle.mjs
 * checks the built bundle for the same three strings. */

const root = process.cwd();
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
];
const flagSet = (names: string[]): Flags => flagsFrom(Object.fromEntries(names.map((n) => [`VITE_STUDY_${n}`, "1"])));
const W = { serverWrites: false, devicePrint: false };
/** The approved releases have every end of §12.3 built: their copy is read so. */
const ALL_ENDS: Ends = { Q: true, C: true, B: true };

/** Help's rows: each title with the flag that shows it (the spec's §6.2 as
 *  the designs' tables replace and extend it). */
const HELP: Array<[string, (f: Flags) => boolean]> = [
  ["מה זה תמצית", () => true],
  ["המדריך", (f) => f.guide], // the guide (docs/study/guide.md)
  ["העלאת הרצאה", () => true],
  ["הנקודות שצריך לדעת", (f) => f.practice], // package B, decision 2 of 17 Nov 2026
  ["קריאה יחד", () => true],
  ["הפגישה היומית", (f) => f.meeting],
  ["היום", (f) => f.today],
  ["תגובות ושאלות", () => true],
  ["מה יושב על הפסקה", (f) => f.anchor],
  ["תיקון בסיכום", (f) => f.corrections],
  ["כרטיס צהוב ו-VAR", (f) => f.var],
  ["סימון קריאה", () => true],
  ["תרגול", (f) => f.practice],
  ["מבחנים קודמים", (f) => f.exams],
  ["מלכודת משלי", (f) => f.traps],
  ["טבלה ריקה", (f) => f.blankTable], // package E, P10 (decision 3: usable early)
  ["מבחן קבוצתי", (f) => f.quiz],
  ["קרב הבוס", (f) => f.boss],
  ["כרטיסיות", (f) => f.cards],
  ["לשאול את החומר", (f) => f.ask],
  ["קיר האסוציאציות", (f) => f.wall],
  ["דופק הקבוצה", (f) => f.pulse],
  ["מוזיאון המלכודות", (f) => f.museum],
  ["ההתקדמות שלי", (f) => f.progress],
  ["מרתוני למידה", (f) => f.marathons],
  ["תוכנית המרתון", (f) => f.groupPlan],
  ["שמירת החשבון", (f) => f.account],
  ["הקלטות", (f) => f.recordings],
  ["PDF ושיתוף", () => true],
  ["פרטיות: מי רואה מה", () => true],
  ["התקציב החודשי", () => true],
  ["כשמשהו נתקע", () => true],
];
/** The privacy note's lines: each head with its flag. */
const PRIVACY: Array<[string, (f: Flags) => boolean]> = [
  ["בטלפון שלך:", () => true],
  [" (מסד הנתונים והאחסון):", () => true],
  [":", () => true], // Anthropic (Claude)
  ["קריאה מראש:", (f) => f.practice], // package B, decision 2 of 17 Nov 2026
  [" (השרת של האפליקציה):", () => true],
  [":", () => true], // Google Fonts
  ["הקלטות:", (f) => f.recordings],
  [":", (f) => f.account], // the email provider
  ["מי רואה מה בקבוצה:", () => true],
  ["ספירה בלי שמות:", (f) => f.pulse],
  ["בפגישה:", (f) => f.meeting],
  ["כרטיס צהוב:", (f) => f.var],
  ["קיר האסוציאציות:", (f) => f.wall],
  ["היום:", (f) => f.today],
  ["בתרגול:", (f) => f.practice],
  ["בכרטיסיות:", (f) => f.cards],
  ["מתחת לפסקה:", (f) => f.anchor],
  ["בהתקדמות:", (f) => f.progress],
  ["מלכודת משלי:", (f) => f.traps],
  ["טבלה ריקה:", (f) => f.blankTable], // package E, P10
  ["תוכנית המרתון:", (f) => f.groupPlan],
  ["ההזמנה:", () => true],
  ["ניהול האפליקציה:", () => true],
  ["כשמשתפים:", () => true],
];

test("help's rows and the privacy note's lines, each with its flag, under every release's set", () => {
  for (const [release, names] of RELEASES) {
    const f = flagSet(names);
    assert.deepEqual(
      helpRows(f, W, ALL_ENDS).map((r) => r.title),
      HELP.filter(([, on]) => on(f)).map(([t]) => t),
      `release ${release}: help`,
    );
    assert.deepEqual(
      privacyLines(f, "ספק המייל", ALL_ENDS).map((l) => l.head),
      PRIVACY.filter(([, on]) => on(f)).map(([h]) => h),
      `release ${release}: the privacy note`,
    );
    const titles = helpRows(f, W, ALL_ENDS).map((r) => r.title);
    for (const gone of ["מבחן חי", "אסוציאציות", "ההתקדמות שלי ותוכנית"]) assert.ok(!titles.includes(gone), `release ${release}: the spec's row ${gone} is replaced`);
  }
});

/** The text a set shows: every help row and privacy line. */
function shown(f: Flags, ends: Ends = ALL_ENDS): string {
  return [...helpRows(f, W, ends).flatMap((r) => [r.title, r.text ?? ""]), ...privacyLines(f, "ספק המייל", ends).flatMap((l) => [l.name ?? "", l.head, l.text])].join("\n");
}

test("§12.7.5's sentences, word for word, shown with their flag and only with it", () => {
  const md = readFileSync(join(root, "docs", "study", "spec", "addendum", "addendum.md"), "utf8");
  const section = md.slice(md.indexOf("#### 12.7.5"), md.indexOf("#### 12.7.6"));
  const bullets = [...section.matchAll(/^- \*\((\w+)\)\* (.+)$/gm)];
  assert.equal(bullets.length, 7, "quiz, meeting, corrections, var, pulse, wall, ask");
  const FLAG: Record<string, keyof Flags> = { quiz: "quiz", meeting: "meeting", corrections: "corrections", var: "var", pulse: "pulse", wall: "wall", ask: "ask" };
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
      .map((q) => replaced.get(q) ?? q);
    assert.ok(quotes.length >= 1, `(${flag}) has its sentences`);
    for (const q of quotes) {
      assert.ok(shown(every).includes(q), `(${flag}) shown with every flag: ${q}`);
      const without = flagsFrom(Object.fromEntries([...R12].map((n) => [`VITE_STUDY_${n}`, "1"])));
      (without as Record<string, boolean>)[FLAG[flag]] = false;
      assert.ok(!shown(without).includes(q), `(${flag}) hidden without its flag: ${q}`);
    }
  }
  for (const old of replaced.keys()) assert.ok(!shown(every).includes(old), `the addendum's wording a decision replaced is gone: ${old}`);
});

test("the contradicted lines are gone: the race scores the bet, and a correction waits for a second approval", () => {
  for (const [release, names] of RELEASES) {
    const text = shown(flagSet(names));
    for (const bad of [...FORBIDDEN, "הטקסט משתנה לכל הקבוצה", "״קבוצתי״", "שלושת המקומות הראשונים"]) assert.ok(!text.includes(bad), `release ${release}: ${bad}`);
  }
  const r6 = shown(flagSet(R6));
  assert.ok(r6.includes("״מירוץ״: ניקוד לפי ההימור, ומהירות רק שוברת שוויון"), "decision 2");
  assert.ok(r6.includes("התיקון מתעדכן לכל הקבוצה אחרי אישור של עוד חבר או חברה, או אישור בקול בפגישה."), "decision 5");
});

test("the gating rule: before release 8 no row promises in-app review's private cards or Today's queue (§12.7.6)", () => {
  for (const names of [R5, R6, R7]) {
    const text = shown(flagSet(names));
    assert.ok(!text.includes("הופכת לכרטיס פרטי"), "private cards wait for in-app review");
    assert.ok(!text.includes("להיכנס לתור שלך"), "the queue waits for Today");
  }
  const r8 = shown(flagSet(R8));
  assert.ok(r8.includes("טעות שלך בתרגול או במבחן הקבוצתי הופכת לכרטיס פרטי, עם הנתיחה בגב.") && r8.includes("כשמסמנים שנענתה, התשובה יכולה להיכנס לתור שלך ככרטיס."));
});

test("every line is gender-neutral (§6.0 rule 1) and names the services in <bdi> (rule 3)", () => {
  const text = shown(flagSet([...R12, "QUIZ_ROUNDS"]));
  for (const bad of ["מישהו", "מישהי", "מי הצביע ", "מי שמקבל ", "מי שפתח ", "נבחר רואה", "ואף אחד לא רואה למה", "ומי מקריא."]) assert.ok(!text.includes(bad), bad);
  const names = privacyLines(flagSet(R12), "ספק המייל", ALL_ENDS).map((l) => l.name).filter(Boolean);
  assert.deepEqual(names, ["Supabase", "Anthropic (Claude)", "Vercel", "Google Fonts", "ספק המייל"]);
  assert.deepEqual(
    privacyLines(flagSet(["ACCOUNT"]), "Resend").filter((l) => l.key === "email").map((l) => [l.name, l.text.endsWith("דרך Resend.")]),
    [["Resend", true]],
    "the email provider, once Yoad names it",
  );
});

/* ── release 1 (docs/study/RELEASE-1.md): QUESTIONS, PRACTICE and CARDS, with
 * none of §12.3's ends and no section B. Help and the privacy note say what
 * those screens do: the spec's §6.2 rows word for word, and nothing of the
 * bet, the autopsy, two-flag hiding, a deck of one's own, private cards or
 * questions written ahead. ── */
const R1 = ["QUESTIONS", "PRACTICE", "CARDS"];

/** Release 1's build, as it shipped: none of the ends. This branch's own
 *  ENDS (release 2) has Q's end; release 1's copy is still what helpRows
 *  and privacyLines give without it. */
const R1_ENDS: Ends = { Q: false, C: false, B: false };

test("release 1: help and the privacy note are the spec's §6.2 for practice and cards, with nothing of the ends or the bank", () => {
  const f = flagSet(R1);
  // Release 1 had none of the ends: neither the bank's rows nor B's as decision 2 redefines them.
  const AHEAD = ["שאלות שנכתבות מראש", "כתיבה מראש:", "הנקודות שצריך לדעת", "קריאה מראש:", "בתרגול:", "בכרטיסיות:"];
  const rows = helpRows(f, W, R1_ENDS);
  assert.deepEqual(
    rows.map((r) => r.title),
    HELP.filter(([t, on]) => on(f) && !AHEAD.includes(t)).map(([t]) => t),
  );
  assert.deepEqual(
    privacyLines(f, "ספק המייל", R1_ENDS).map((l) => l.head),
    PRIVACY.filter(([h, on]) => on(f) && !AHEAD.includes(h)).map(([h]) => h),
  );
  // The spec's rows (§6.2's table), word for word, as their flags leave them.
  const spec = readFileSync(join(root, "docs", "study", "spec", "spec-final.md"), "utf8");
  const specRow = (title: string) => new RegExp(`^\\| ${title} \\| \\w+ \\| (.+) \\|$`, "m").exec(spec)?.[1] ?? "";
  assert.equal(rows.find((r) => r.title === "תרגול")?.text, specRow("תרגול").replace(/ \*\(progress\)\*.*$/, ""));
  assert.equal(rows.find((r) => r.title === "כרטיסיות")?.text, specRow("כרטיסיות").replace(/, \*\(cards review\)\*.*$/, "."));
  const text = shown(f, R1_ENDS);
  for (const ahead of ["הימור", "הנתיחה", "מתי כן", "שני דגלים", "חלק אחרי חלק", "החפיסה שלך", "כרטיס פרטי", "Batch", "אוטומטית", "מבחן קבוצתי", "מבחן חי"]) {
    assert.ok(!text.includes(ahead), `release 1 says nothing of: ${ahead}`);
  }
  // With progress on and still no end, the spec's mistakes sentence joins the practice row.
  const withProgress = helpRows(flagSet([...R1, "PROGRESS"]), W, R1_ENDS).find((r) => r.title === "תרגול")?.text ?? "";
  assert.ok(withProgress.endsWith("שאלה עם טעות נשארת ב״הטעויות שלי״ עד שעונים עליה נכון ביום אחר."), withProgress);
});

/* ── release 2 (docs/study/quiz.md): release 1 and the group quiz, still with
 * none of Q's, C's or B's ends, and no meeting. The quiz's help row and its
 * privacy sentence say what section Z does: the bet, the argument and the
 * second vote, the race scored by the bet, counts only from 3; nothing of
 * "3 לקפה" (section M) or of a trap card (C's end). ── */
/** Release 2's build, as it shipped: Q's end, none of C's or B's. */
const R2_ENDS: Ends = { Q: true, C: false, B: false };

test("release 2: Q's end is built, so practice's help row and privacy line are the end's (the bet, the autopsy, two flags)", () => {
  for (const names of [R1, [...R1, "QUIZ"]]) {
    const f = flagSet(names);
    const practice = helpRows(f, W, R2_ENDS).find((r) => r.title === "תרגול")?.text ?? "";
    assert.ok(practice.includes("הימור ביטחון (ניחוש · נראה לי · על בטוח)") && practice.includes("׳מתי כן׳") && practice.includes("שני דגלים"), practice);
    assert.ok(privacyLines(f, "ספק המייל", R2_ENDS).some((l) => l.key === "practice" && l.head === "בתרגול:"));
    const text = shown(f, R2_ENDS);
    for (const notYet of ["החפיסה שלך", "כרטיס פרטי", "שאלות שנכתבות מראש", "כתיבה מראש:"]) assert.ok(!text.includes(notYet), `release 2 says nothing of C's or B's ends: ${notYet}`);
  }
});

test("release 2: the quiz's help row and privacy sentence, without the meeting's opening or a trap card", () => {
  const f = flagSet([...R1, "QUIZ"]);
  assert.ok(f.quiz && !f.meeting);
  const row = helpRows(f, W, R2_ENDS).find((r) => r.title === "מבחן קבוצתי")?.text ?? "";
  assert.ok(row.includes("עונים לבד עם הימור (ניחוש · נראה לי · על בטוח); כשהקבוצה חצויה יש 90 שניות לשכנע ועונים שוב."), row);
  assert.ok(row.includes("״מירוץ״: ניקוד לפי ההימור, ומהירות רק שוברת שוויון; הטבלה רק לשחקני המירוץ ורק בתוך המשחק."), row);
  const group = privacyLines(f, "ספק המייל", R2_ENDS).find((l) => l.key === "group")?.text ?? "";
  assert.ok(group.includes("כשעונים פחות משלושה רואים רק כמה ענו, ומבחן של פחות משלושה לא מציג ציון לקבוצה."), group);
  const text = shown(f, R2_ENDS);
  for (const later of ["3 לקפה", "כרטיס מלכודת", "הפגישה היומית", "מבחן חי", "תחרותי"]) assert.ok(!text.includes(later), `release 2 says nothing of: ${later}`);
  // The two sentences come back with what they describe.
  assert.ok(shown(flagSet([...R1, "QUIZ", "MEETING"]), R2_ENDS).includes("ב״3 לקפה״ רואים רק אם רוב הקבוצה צדקה."));
  assert.ok(shown(f, ALL_ENDS).includes("כרטיס מלכודת נוצר רק כשלפחות 3 בחרו באותה תשובה, ונפתח למחרת."));
});

test("W2: every release says that taps at once count once, that deleting stops the writing, and that no phone changes a part directly", () => {
  for (const [release, names] of RELEASES) {
    const f = flagSet(names);
    const stuck = helpRows(f, W, ENDS).find((r) => r.title === "כשמשהו נתקע")?.text ?? "";
    assert.ok(stuck.includes("כמה טלפונים שלוחצים יחד על אותו חלק נספרים כלחיצה אחת."), `release ${release}: ${stuck}`);
    assert.ok(stuck.includes("המחיקה עוצרת גם את כתיבת הסיכום, ואחרי ״שחזור״ ״המשך כתיבה״ ממשיך מאיפה שנעצר."), `release ${release}: ${stuck}`);
    const db = privacyLines(f, "ספק המייל", ENDS).find((l) => l.key === "supabase")?.text ?? "";
    assert.ok(db.includes("הסיכומים נכתבים רק דרך השרת: אי אפשר לשנות או למחוק חלק בסיכום ישירות מהטלפון."), `release ${release}: ${db}`);
  }
});

/* ── this branch (study/w3-c): C's end is built. With production's flags
 * (release 2's) the cards' help row says the deck is added part by part,
 * the privacy note has its cards line, and the quiz's sentence names the
 * trap card the SQL now makes; the private cards and the review home are
 * said only with in-app review (VITE_STUDY_CARDS_REVIEW). Still nothing of
 * section B. ── */
test("C's end: the cards' help row, the privacy note's cards line and the quiz's trap card sentence; private cards and the home only with review", () => {
  assert.deepEqual(ENDS, { Q: true, C: true, B: true }, "this branch has Q's and C's ends, and B as decision 2 redefines it");
  const f = flagSet([...R1, "QUIZ"]);
  const cards = helpRows(f, W).find((r) => r.title === "כרטיסיות")?.text ?? "";
  assert.ok(cards.includes("מוסיפים לחפיסה שלך חלק אחרי חלק, ועד 20 כרטיסים חדשים ביום."), cards);
  assert.ok(!cards.includes("כרטיס פרטי") && !cards.includes("בית אחד לחזרות"), "no private card or home while review is off");
  assert.equal(privacyLines(f, "ספק המייל").find((l) => l.key === "cards")?.text, "החפיסה שלך, הכרטיסים הפרטיים מהטעויות והזיכרון של כל כרטיס גלויים רק לך.");
  assert.ok(shown(f, ENDS).includes("כרטיס מלכודת נוצר רק כשלפחות 3 בחרו באותה תשובה, ונפתח למחרת."));
  const review = helpRows(flagSet([...R1, "QUIZ", "CARDS_REVIEW"]), W).find((r) => r.title === "כרטיסיות")?.text ?? "";
  assert.ok(review.includes("טעות שלך בתרגול או במבחן הקבוצתי הופכת לכרטיס פרטי, עם הנתיחה בגב. בוחרים בית אחד לחזרות: האפליקציה או Anki."), review);
  for (const notYet of ["שאלות שנכתבות מראש", "כתיבה מראש:"]) assert.ok(!shown(f, ENDS).includes(notYet), `nothing of section B: ${notYet}`);
});

/* ── package B as Yoad's decision 2 (17 Nov 2026) redefines it: the points to
 * know are read after the summary, on the server; no question or card is
 * written automatically. Help and the privacy note say so with practice on,
 * and never promise questions or cards written ahead. ── */
test("B: help and the privacy note say the points are read after the summary, and nothing is written ahead", () => {
  const f = flagSet([...R1, "QUIZ"]);
  const help = helpRows(f, { serverWrites: true, devicePrint: true }).find((r) => r.title === "הנקודות שצריך לדעת")?.text ?? "";
  assert.ok(help.includes("הנקודות שצריך לדעת נקראות ממנו מעצמן, פעם אחת לכל הקבוצה"), help);
  assert.ok(help.includes("כשהשימוש החודשי מגיע ל-80% מהתקרה הקריאה מדלגת, ו״לקרוא את הנקודות״ נשאר בלחיצה."), "the cap: skipped, and the tap stays");
  assert.ok(help.includes("שאלות וכרטיסיות לא נכתבות מעצמן: רק כשבוחרים ליצור אותן."), "decision 2: no automatic questions or cards");
  const privacy = privacyLines(f, "ספק המייל").find((l) => l.key === "ahead");
  assert.equal(privacy?.head, "קריאה מראש:");
  assert.ok(privacy?.text.includes("שום דבר פרטי לא נשלח"), privacy?.text);
  const text = shown(f, ENDS);
  for (const gone of ["במצב החסכוני", "במצב ה-Batch", "שאלות וכרטיסיות נכתבות אוטומטית", "להכין גם שאלות וכרטיסיות"]) assert.ok(!text.includes(gone), `the bank's words are gone: ${gone}`);
  // Only with practice: the cards alone have no setup screen to open.
  assert.ok(!shown(flagSet(["CARDS"]), ENDS).includes("הנקודות שצריך לדעת נקראות"));
  assert.ok(!shown(flagSet([]), ENDS).includes("קריאה מראש:"));
});

test("T-1: Today's help names only the rows the build queues (each waits for its own flag)", () => {
  const today = (names: string[]) => helpRows(flagSet(names), W, ALL_ENDS).find((r) => r.title === "היום")?.text ?? "";
  const all = today(["QUESTIONS", "PRACTICE", "QUIZ", "MEETING", "CARDS", "CARDS_REVIEW", "CORRECTIONS", "VAR", "PROGRESS", "TODAY"]);
  assert.equal(
    all,
    "המסך הראשון: הפגישה של היום, ומתחת ״התור שלי״ לפי הזמן שיש (10, 20 או 45 דקות): כרטיסים שהגיע זמנם, טעויות מהמבחן הקבוצתי, טעות ׳על בטוח׳ בניסוח חדש, פסקאות שסימנת ׳לא ברור׳ ועדכונים בסיכום. מה שלא נכנס עובר למחר. הלהבה נדלקת ב-4 מתוך 7 ימים. הכול גלוי רק לך.",
  );
  // Production's set with Today and the review: cards only, no meeting, no quiz.
  assert.equal(
    today(["QUESTIONS", "PRACTICE", "CARDS", "CARDS_REVIEW", "TODAY"]),
    "המסך הראשון: ״התור שלי״ לפי הזמן שיש (10, 20 או 45 דקות): כרטיסים שהגיע זמנם. מה שלא נכנס עובר למחר. הלהבה נדלקת ב-4 מתוך 7 ימים. הכול גלוי רק לך.",
  );
  assert.equal(today(["CARDS"]), "", "no Today, no row");
});
