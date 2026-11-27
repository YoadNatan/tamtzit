import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FSI, PDI } from "./bidiText.js";
import { BODY_MAX, catOf, cut, FALLBACK_TITLE, KINDS, overTitle, render, TITLE_MAX, type Surface } from "./notifyCopy.js";

// Invented titles and names only (no course material).
const NOW = Date.parse("2026-11-26T12:00:00Z"); // 14:00 in Israel
const L = "הרצאה בדויה על כליות";
const SURFACES: Surface[] = ["lock", "inbox"];

/** Every notice's words, pinned: [kind, args, count, surface, title, body]. */
const PINNED: Array<[string, Record<string, unknown>, number, Surface, string, string]> = [
  ["quiz_open", { mode: "coop", lecture: L, more: 1, title: "עצירה: כותרת בדויה", name: "נועה" }, 1, "lock", "מבחן קבוצתי נפתח עכשיו", `${L} ועוד הרצאה · להצטרף`],
  ["quiz_open", { mode: "coop", lecture: L, more: 1, title: "עצירה: כותרת בדויה", name: "נועה" }, 1, "inbox", "מבחן קבוצתי נפתח עכשיו", "עצירה: כותרת בדויה · נועה בפנים"],
  ["quiz_open", { mode: "race", lecture: L }, 1, "lock", "מירוץ נפתח עכשיו", `${L} · להצטרף`],
  ["quiz_open", { mode: "race", lecture: L, more: 3, title: "מבחן בדוי", name: "נועה", in: 2 }, 1, "inbox", "מירוץ נפתח עכשיו", "מבחן בדוי · נועה ועוד 2 בפנים"],
  ["boss_open", { course: "קורס בדוי" }, 1, "lock", "אתגר קבוצתי נפתח עכשיו", "קורס בדוי · להצטרף"],
  ["meeting_soon", { lecture: L, at: "2026-11-26T16:00:00Z" }, 1, "lock", "הפגישה מתחילה בעוד 15 דקות", `${L} · 18:00`],
  ["reading", { lecture: L, name: "נועה" }, 1, "lock", "ההקראה התחילה", `${L} · אפשר להצטרף`],
  ["reading", { lecture: L, name: "נועה" }, 1, "inbox", "ההקראה התחילה", `${L} · מקריאים עכשיו: נועה`],
  ["session_soon", { title: "מפגש בדוי", at: "18:30" }, 1, "lock", "מפגש הלמידה מתחיל בעוד 30 דקות", "18:30"],
  ["session_soon", { title: "מפגש בדוי", at: "18:30" }, 1, "inbox", "מפגש הלמידה מתחיל בעוד 30 דקות", "מפגש בדוי · 18:30"],
  ["reply", { lecture: L, part: 3 }, 1, "lock", "תשובה חדשה בשרשור שלך", `${L} · חלק 3`],
  ["reply", { lecture: L, part: 3 }, 2, "lock", "2 תשובות חדשות בשרשור שלך", `${L} · חלק 3`],
  ["reply", { lecture: L, part: 3 }, 11, "inbox", "11 תשובות חדשות בשרשור שלך", `${L} · חלק 3`],
  ["answer", { lecture: L, part: 1 }, 1, "lock", "יש תשובה לשאלה שלך", `${L} · חלק 1`],
  ["answer", { lecture: L, part: 1 }, 3, "lock", "יש 3 תשובות לשאלה שלך", `${L} · חלק 1`],
  ["credit_ask", { lecture: L }, 1, "lock", "בקשה לקרדיט על דרך לזכור", `${L} · לאשר או לדחות`],
  ["dispute", { lecture: L }, 1, "lock", "נפתחה מחלוקת על תיקון שהצעת", `${L} · אפשר להוסיף את הצד שלך`],
  ["dispute_done", { lecture: L }, 1, "lock", "ההכרעה במחלוקת מוכנה", L],
  ["needs_me", { lecture: L }, 1, "lock", "שאלה פתוחה שאפשר לעזור בה", L],
  ["summary_ready", { lecture: L }, 1, "lock", "הסיכום מוכן", L],
  ["summary_failed", { lecture: L }, 1, "lock", "הכתיבה נעצרה", `${L} · אפשר ללחוץ ״המשך כתיבה״`],
  ["summary_failed", { lecture: L, why: "budget" }, 1, "lock", "הכתיבה נעצרה: התקציב החודשי נגמר", `${L} · אפשר להמשיך כשהתקציב מתחדש`],
  ["summary_failed", { lecture: L, why: "daily_limit" }, 1, "lock", "הכתיבה נעצרה: המכסה היומית נגמרה", `${L} · אפשר להמשיך מחר`],
  ["exam_ready", { course: "קורס בדוי", year: 2025, moed: "מועד א" }, 1, "lock", "המבחן הקודם מוכן לתרגול", "קורס בדוי 2025 מועד א"],
  ["exam_ready", { course: "קורס בדוי", year: 2025, kind: "sheet" }, 1, "lock", "דף התרגילים מוכן לתרגול", "קורס בדוי 2025"],
  ["exam_failed", { course: "קורס בדוי", year: 2025 }, 1, "lock", "קריאת המבחן לא הצליחה", "קורס בדוי 2025 · אפשר לנסות שוב"],
  ["exam_failed", { course: "קורס בדוי", year: 2025, why: "reserve" }, 1, "lock", "קריאת המבחן לא הצליחה", "קורס בדוי 2025 · אפשר להמשיך כשהתקציב מתחדש"],
  ["digest", { cards: 1, meet: "18:00", course: "קורס בדוי", days: 1 }, 1, "lock", "היום בתמצית", "כרטיסייה אחת לחזרה · הפגישה ב-18:00 · המבחן בקורס בדוי מחר"],
  ["digest", { cards: 11, course: "Invented Kinetics", days: 4 }, 1, "lock", "היום בתמצית", `11 כרטיסיות לחזרה · המבחן ב-${FSI}Invented Kinetics${PDI} בעוד 4 ימים`],
  ["digest", { cards: 2, course: "קורס בדוי", days: 0 }, 1, "lock", "היום בתמצית", "2 כרטיסיות לחזרה · המבחן בקורס בדוי היום"],
  ["digest", {}, 1, "lock", "היום בתמצית", ""],
  ["code_used", { at: "2026-11-26T09:05:00Z" }, 1, "lock", "נכנסו עם הקוד האישי היום, בשעה 11:05", "אם זה המכשיר שלך, אין מה לעשות. אם לא: שלי ← ניתוק המכשירים האחרים"],
  ["code_used", { at: "2026-11-25T21:30:00Z" }, 1, "lock", "נכנסו עם הקוד האישי אתמול, בשעה 23:30", "אם זה המכשיר שלך, אין מה לעשות. אם לא: שלי ← ניתוק המכשירים האחרים"],
  ["code_used", { at: "2026-11-20T10:00:00Z" }, 1, "lock", "נכנסו עם הקוד האישי ב-20.11, בשעה 12:00", "אם זה המכשיר שלך, אין מה לעשות. אם לא: שלי ← ניתוק המכשירים האחרים"],
  ["code_used", {}, 1, "lock", "נכנסו עם הקוד האישי", "אם זה המכשיר שלך, אין מה לעשות. אם לא: שלי ← ניתוק המכשירים האחרים"],
  ["test", {}, 1, "lock", "התראת ניסיון", "ככה ייראו ההתראות מתמצית"],
  ["update", { lecture: L }, 1, "inbox", "תיקון הגיע לשורה שלמדת", L],
  ["edit_wait", { lecture: L }, 1, "inbox", "תיקון מחכה לאישור", L],
  ["lecture_new", { lecture: L }, 1, "inbox", "סיכום חדש בספרייה", L],
  ["meeting_set", { lecture: L, at: "2026-12-01T16:00:00Z" }, 1, "inbox", "נקבעה פגישה", `${L} · יום ג׳ 18:00`],
  ["mystery", { title: "כותרת בדויה" }, 1, "inbox", FALLBACK_TITLE, "כותרת בדויה"],
  ["mystery", { title: "כותרת בדויה" }, 1, "lock", FALLBACK_TITLE, ""],
  ["set_shared", { lecture: L, k: 10, name: "נועה" }, 1, "lock", "סט תרגול חדש בקבוצה", "אפשר לפתור מ״סטים של הקבוצה״"],
  ["set_shared", { lecture: L, k: 10, name: "נועה" }, 1, "inbox", "סט תרגול חדש בקבוצה", `${L} · 10 שאלות · מאת נועה`],
  ["set_shared", { lecture: L, k: 1, name: "נועה" }, 1, "inbox", "סט תרגול חדש בקבוצה", `${L} · שאלה אחת · מאת נועה`],
  ["set_shared", {}, 3, "inbox", "3 סטים חדשים בקבוצה", "אפשר לפתור מ״סטים של הקבוצה״"],
  ["set_shared", {}, 2, "lock", "2 סטים חדשים בקבוצה", "אפשר לפתור מ״סטים של הקבוצה״"],
  ["set_solved", { title: "משתנים · 10 שאלות", k: 1 }, 1, "inbox", "הסט ״משתנים · 10 שאלות״ נפתר פעם אחת", "אפשר לראות את המספרים של הקבוצה"],
  ["set_solved", { title: "משתנים · 10 שאלות", k: 3 }, 3, "inbox", "הסט ״משתנים · 10 שאלות״ נפתר 3 פעמים", "אפשר לראות את המספרים של הקבוצה"],
  ["set_solved", { title: "משתנים · 10 שאלות", k: 2 }, 2, "lock", "הסט נפתר 2 פעמים", "אפשר לראות את המספרים של הקבוצה"],
  ["similar_ready", { k: 14, kind: "sheet", course: "קורס בדוי" }, 1, "lock", "השאלות הדומות מוכנות", "קורס בדוי · 14 שאלות · אפשר לפתור מ״סטים של הקבוצה״"],
  ["similar_ready", { k: 1, kind: "sheet" }, 1, "inbox", "השאלות הדומות מוכנות", "שאלה אחת · אפשר לפתור מ״סטים של הקבוצה״"],
  ["similar_ready", { title: "כותרת בדויה" }, 1, "lock", "השאלות הדומות מוכנות", "אפשר לפתור מ״סטים של הקבוצה״"],
  ["summary_ready", { lecture: "הרצאה בדויה על Invented Kinetics" }, 1, "lock", "הסיכום מוכן", `הרצאה בדויה על ${FSI}Invented Kinetics${PDI}`],
  ["meeting_soon", { lecture: "Invented Kinetics", at: "2026-07-01T15:00:00Z" }, 1, "lock", "הפגישה מתחילה בעוד 15 דקות", `${FSI}Invented Kinetics${PDI} · 18:00`],
];

test("every notice's words, pinned (invented titles)", () => {
  for (const [kind, args, n, surface, title, body] of PINNED) {
    assert.deepEqual(render(kind, args, n, surface, NOW), { title, body }, `${kind} ${JSON.stringify(args)} ×${n} ${surface}`);
  }
});

test("every kind is pinned at least once", () => {
  const pinned = new Set(PINNED.map((p) => p[0]));
  for (const k of Object.keys(KINDS)) assert.ok(pinned.has(k), k);
});

test("the lock screen never shows a quiz's title or a name", () => {
  const secret = { title: "כותרת סודית", name: "שם סודי", lecture: L, course: "קורס בדוי", mode: "race", more: 2, in: 4, at: "2026-11-26T16:00:00Z" };
  for (const kind of Object.keys(KINDS)) {
    const { title, body } = render(kind, secret, 1, "lock", NOW);
    for (const s of [title, body]) {
      assert.ok(!s.includes("שם סודי"), `${kind}: a name on the lock screen`);
      assert.ok(!s.includes("כותרת סודית"), `${kind}: a title on the lock screen`);
    }
  }
  // A kind this build does not know (a later package's, wired before its words ship): the title, never its args.
  for (const kind of ["lab_new", "mystery"]) assert.deepEqual(render(kind, secret, 1, "lock", NOW), { title: FALLBACK_TITLE, body: "" }, kind);
  // The inbox, inside the app, may show them.
  assert.match(render("quiz_open", secret, 1, "inbox", NOW).body, /כותרת סודית · שם סודי ועוד 4 בפנים/);
  // A shared set (OD10): neither the lecture nor the author's name on the lock screen, at any count.
  for (const n of [1, 2, 7]) {
    const r = render("set_shared", secret, n, "lock", NOW);
    assert.ok(!`${r.title} ${r.body}`.includes(L), `set_shared ×${n}: the lecture on the lock screen`);
    assert.ok(!`${r.title} ${r.body}`.includes("שם סודי"), `set_shared ×${n}: the author's name on the lock screen`);
  }
  assert.match(render("set_shared", secret, 1, "inbox", NOW).body, /מאת שם סודי/);
});

test("every kind fits: title within 60, body within 120, on both surfaces, with the longest args", () => {
  const long = "א".repeat(200);
  const longEn = "Invented Kinetics ".repeat(12);
  for (const kind of [...Object.keys(KINDS), "unknown_kind"]) {
    for (const args of [{}, { lecture: long, title: long, name: long, course: long, more: 39, in: 30, part: 199, cards: 999, days: 120, meet: "18:00", at: "2026-11-26T16:00:00Z", year: 2026, moed: long },
      { lecture: longEn, title: longEn, course: longEn, name: longEn }]) {
      for (const surface of SURFACES) {
        for (const n of [1, 2, 11, 999]) {
          const r = render(kind, args, n, surface, NOW);
          assert.ok(Array.from(r.title).length <= TITLE_MAX, `${kind} title ${Array.from(r.title).length}`);
          assert.ok(Array.from(r.body).length <= BODY_MAX, `${kind} body ${Array.from(r.body).length}`);
          assert.ok(r.title.length > 0, `${kind}: a title`);
          assert.equal(r.title.split(FSI).length, r.title.split(PDI).length, `${kind}: isolates paired in the title`);
          assert.equal(r.body.split(FSI).length, r.body.split(PDI).length, `${kind}: isolates paired in the body`);
        }
      }
    }
  }
});

test("a live notice that is over: its own past tense (a cancelled meeting says so); a quiz keeps its title", () => {
  assert.equal(overTitle("meeting_soon", { lecture: L }), "הפגישה התקיימה");
  assert.equal(overTitle("meeting_soon", { lecture: L, off: true }), "הפגישה בוטלה");
  assert.equal(overTitle("reading", {}), "ההקראה הסתיימה");
  assert.equal(overTitle("session_soon", { title: "x" }), "מפגש הלמידה התקיים");
  assert.equal(overTitle("quiz_open", {}), null);
  assert.equal(overTitle("boss_open", {}), null);
  assert.equal(overTitle("reply", {}), null);
  assert.equal(overTitle("mystery", null), null);
  for (const kind of Object.keys(KINDS)) if (KINDS[kind].over) assert.equal(KINDS[kind].cat, "live", kind);
});

test("a stop for the budget or the day's limit never invites a retry that cannot work", () => {
  for (const why of ["budget", "reserve", "member_share", "daily_limit"]) {
    for (const kind of ["summary_failed", "exam_failed"]) {
      const { title, body } = render(kind, { lecture: L, course: "קורס בדוי", why }, 1, "lock", NOW);
      assert.ok(!/לנסות שוב|המשך כתיבה/.test(title + body), `${kind} ${why}: ${title} / ${body}`);
    }
  }
});

test("no gendered forms; the app's plain words", () => {
  // ("את" alone is left out: it is also the object marker, "את הצד שלך".)
  const all = Object.keys(KINDS).flatMap((kind) =>
    SURFACES.flatMap((s) => [1, 2].map((n) => render(kind, { lecture: L, course: "קורס בדוי", name: "נועה", title: "כותרת", why: "budget", cards: 2, days: 2, at: "2026-11-26T16:00:00Z" }, n, s, NOW))),
  );
  const text = all.map((r) => `${r.title} ${r.body}`).join(" ");
  for (const w of [/(^|\s)אתה(\s|$)/, /לחצי|לחץ(\s|$)/, /תוכלי|תוכל(\s|$)/, /היכנסי|היכנס(\s|$)/, /מוזמנ/, /יקר(ה)?(\s|$)/, /(^|\s)בואי?(\s|$)/]) {
    assert.ok(!w.test(text), `${w}`);
  }
  // COPY.md: no metaphors for app mechanics.
  for (const w of ["בוס", "דופק", "מוזיאון", "כרטיס צהוב", "VAR", "פסיקה"]) assert.ok(!text.includes(w), w);
});

test("unknown kinds and bad input never throw", () => {
  assert.deepEqual(render("sets_shared_v9", { title: "כותרת בדויה" }), { title: FALLBACK_TITLE, body: "כותרת בדויה" });
  assert.deepEqual(render("x", null), { title: FALLBACK_TITLE, body: "" });
  assert.deepEqual(render("toString", {}), { title: FALLBACK_TITLE, body: "" }, "no prototype keys");
  assert.equal(render("reply", { lecture: 5, part: "x" }, Number.NaN).title, "תשובה חדשה בשרשור שלך");
  assert.equal(render("reply", { lecture: L }, -3).title, "תשובה חדשה בשרשור שלך");
  assert.equal(render("summary_ready", { lecture: `${FSI}${L}` }).body, L, "direction marks in a title are dropped");
  assert.equal(render("code_used", { at: "not a time" }).title, "נכנסו עם הקוד האישי");
  assert.equal(catOf("quiz_open"), "live");
  assert.equal(catOf("nope"), "inapp");
});

test("cut: within the limit, an ellipsis, and never an open isolate", () => {
  assert.equal(cut("קצר", 10), "קצר");
  assert.equal(cut("א".repeat(20), 10), `${"א".repeat(9)}…`);
  const s = `${"א".repeat(5)} ${FSI}Invented Kinetics${PDI}`;
  const c = cut(s, 12);
  assert.ok(Array.from(c).length <= 12, c);
  assert.equal(c.split(FSI).length, c.split(PDI).length, c);
  assert.ok(c.endsWith("…"));
});

test("the copy covers the kinds section R registers, in the same categories", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  const r = sql.slice(sql.indexOf("-- ════ BEGIN SECTION R "));
  const block = /insert into study_private\.notice_kinds \(kind, cat, ttl, delay, push\) values([\s\S]*?)on conflict/.exec(r)?.[1] ?? "";
  const rows = [...block.matchAll(/\('([a-z_]+)',\s*'([a-z]+)'/g)].map((m) => [m[1], m[2]] as const);
  assert.equal(rows.length, 25, "R 1 and R 2's kinds, and the three reserved");
  // Reserved for packages not built yet: their packages add their words
  // (set_shared was reserved for practice sets, similar_ready for uploaded
  // sheets' release B, which have them now).
  const reserved = new Set(["lab_new"]);
  for (const [kind, cat] of rows) {
    if (reserved.has(kind)) {
      assert.equal(catOf(kind), "inapp", `${kind}: no words until its package`);
      continue;
    }
    assert.ok(kind in KINDS, `${kind} has words`);
    assert.equal(KINDS[kind].cat, cat, kind);
  }
});

test("the copy covers the kinds section L registers or wires, in R's categories", () => {
  const sql = readFileSync(join(process.cwd(), "supabase", "study-schema.sql"), "utf8");
  const l = sql.slice(sql.indexOf("-- ════ BEGIN SECTION L "), sql.indexOf("-- ════ END SECTION L ════"));
  const block = /insert into study_private\.notice_kinds \(kind, cat, ttl, delay, push\) values([\s\S]*?)on conflict/.exec(l)?.[1] ?? "";
  const rows = [...block.matchAll(/\('([a-z_]+)',\s*'([a-z]+)',\s*'[^']+',\s*'[^']+',\s*(true|false)\)/g)].map((m) => [m[1], m[2], m[3]] as const);
  assert.deepEqual(rows, [["set_solved", "inapp", "false"]], "L registers set_solved, inbox only");
  assert.equal(KINDS.set_solved.cat, "inapp");
  // set_shared is R's reserved row ('mine', pushed); L's hook writes it.
  assert.equal(KINDS.set_shared.cat, "mine");
  assert.match(l, /study_private\.notice_add\(u, p_group, 'set_shared'/);
  assert.match(l, /'set_solved',/);
});

