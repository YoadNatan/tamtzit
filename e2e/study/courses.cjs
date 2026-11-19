// Courses (docs/study/sources.md, phase 1 "קורסים"; mockups course.html,
// batch.html, batch-progress.html) on the shared mock, at 390 px:
//   1. The library: each course heading links to its page; a course written
//      two ways (" פרמקולוגיה לדוגמה " and "פרמקולוגיה לדוגמה") is one course.
//   2. The course page: "2 הרצאות", "עוד אין תאריך"; the course's sheet sets
//      the exam's date, questions and minutes: "עוד 23 ימים", "100 שאלות ·
//      3 שעות" (study_course_set).
//   3. "לתרגל מה שכבר יש · בחינם (5)" opens s=c.<course>, and the session
//      shows the course's questions ($0: no call to /api/study/ai).
//   4. "לשאול על כל הקורס": "נבחרו 3 מתוך N פסקאות · מהרצאה אחת", the
//      answer, and its sources as links to the paragraph (?l=…&at=p.a).
//   5. "העלאה של כמה קבצים" with 12 generated .pptx files: a row each, the
//      price card with the month's money ("יחכו לחודש הבא" when little is
//      left); the upload holds the 4th lecture's insert on its way and the
//      tab reloads: "הועלו 4. נשארו 8 קבצים · לבחור אותם שוב" (the 4th got
//      there: its id was in the resume list), the library says so too, and
//      the 12 files picked again upload only the 8 left: 14 lectures, none
//      twice, the list cleared.
//   6. The course's sheet: "לשנות שם" moves every lecture's text; "לאחד
//      קורסים" moves them to the other course and opens its page.
//   7. 320 and 390 px, light and dark: no horizontal scroll on the course
//      page, the batch and the course question; the a11y check at 390/360.
// Without VITE_STUDY_COURSES (every set but "s1" and "all") it checks that
// nothing of it shows: no course link, ?v=course → the library, the batch →
// one lecture's upload, ?v=ask&c= → the library's question, no call of
// section S.
//
//   NODE_PATH=$(npm root -g) node e2e/study/courses.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "s1" ("prod"
// with VITE_STUDY_COURSES), "all", or a set without it ("prod").
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { makePptx } = require("./fixtures/make-pptx.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/courses.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const israelDay = (plus) => {
  const t = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" })}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + plus);
  return t.toISOString().slice(0, 10);
};

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: ["שוהם", "נועה"] });
  mock.seedLecture();
  const db = mock.db;
  const L = mock.LECTURE_ID;
  const COURSE = mock.fixture.outline.course; // "פרמקולוגיה לדוגמה"
  const t0 = new Date(Date.now() - 3600_000).toISOString();
  const A = db.members[0].user_id;
  const lecture = (id, title, course, status = "new") => ({
    id, group_id: db.group.id, course, title, lecturer: "", lecture_date: null, source_name: `${title}.pptx`, source_kind: "pptx", status, error: null,
    created_by: A, created_at: t0, updated_at: t0, queued_at: null, deleted_at: null, deleted_by: null, slides: [{ n: 1, title, lines: ["שורה"], tables: [], notes: "", figures: [] }],
  });
  // The same course written another way, and a second course.
  db.lectures.push(lecture("eeeeeeee-0000-4000-8000-000000000006", "משתנים: המשך", ` ${COURSE} `));
  db.lectures.push(lecture("eeeeeeee-0000-4000-8000-000000000007", "חיידקים גרם חיוביים", "מיקרו"));
  // Five questions of the fixture lecture: the course's "(5)".
  const ITEMS = [
    ["איפה פועלת Furosemide?", ["Proximal tubule", "Thick ascending limb", "Collecting duct", "DCT"], 1, 6],
    ["מה עושות Thiazides לסידן בדם?", ["מעלות", "מורידות", "לא משנות", "תלוי במינון"], 0, 10],
    ["איפה פועלות Thiazides?", ["DCT", "Proximal tubule", "Thick ascending limb", "Collecting duct"], 0, 10],
    ["Spironolactone והאשלגן?", ["מורידה", "מעלה", "לא משנה", "רק בכליה"], 1, 13],
    ["על מה פועלת Spironolactone?", ["קולטן לאלדוסטרון", "NKCC2", "ENaC", "Carbonic anhydrase"], 0, 13],
  ];
  if (db.practice)
    ITEMS.forEach(([question, options, answer, slide], i) => {
      const x = {
        id: `9c100000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, group_id: db.group.id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: 2,
        kind: "mcq", difficulty: 1, vignette: "", question, options, slides: [slide], topic: "Diuretics", aspect: "other", has_key: true, model: "mock", created_by: null, created_at: t0, retired_at: null, retired_by: null, retire_note: "",
        anchor: 0, quote: "", part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, form: "one", layout: null, series: null, step: null,
      };
      db.practice.questions.push(x);
      db.practice.keys.set(x.id, { answer, explanations: options.map((o, j) => (j === answer ? `${o}: כך בשקף.` : `${o} לא מתאימה כאן.`)), takeaway: "" });
    });

  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const ok = [];
  const a11y = [];
  let page = null;
  const open = async (who, p) => {
    if (page) await page.context().close().catch(() => undefined);
    ({ page } = await mock.open(browser, who, { path: p }));
    await page.locator("main").first().waitFor({ timeout: 15000 });
    return page;
  };
  const expect = (cond, what) => {
    if (!cond) throw new Error(what);
    ok.push(what);
  };
  const shot = async (name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  const go = async (p) => {
    await page.goto(`${mock.base}${p}`);
    await page.locator("main").first().waitFor({ timeout: 15000 });
  };
  /** No horizontal scroll at 320 and 390 px, light and dark. */
  const noSideScroll = async (name) => {
    const size = page.viewportSize();
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 700 });
        await page.waitForTimeout(150);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 1) throw new Error(`${name}: ${over} px of horizontal scroll at ${width} px (${scheme})`);
        if (width === 320) await page.screenshot({ path: path.join(out, `${name}-320-${scheme}.png`), fullPage: true });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize(size);
    ok.push(`${name}: no horizontal scroll at 320 and 390 px, light and dark`);
  };
  const sCalls = () => mock.calls.filter((c) => /rpc\/study_course/.test(String(c)));
  const aiCalls = () => mock.calls.filter((c) => /^api POST \/api\/study\/ai/.test(String(c))).length;

  try {
    if (!flags.courses) {
      /* ── Nothing of the courses without the flag ── */
      await open("שוהם", "/?v=library");
      await page.locator(".a-sec h2").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1200);
      expect((await page.locator(".lib-course").count()) === 0, "no course link in the library");
      await go(`/?v=course&c=${"c0000000-0000-4000-8000-000000000001"}`);
      await page.waitForURL((u) => !u.search.includes("v=course"), { timeout: 15000 });
      expect(true, "?v=course leads elsewhere");
      await go("/?v=upload&many=1");
      await page.waitForURL((u) => !u.search.includes("many="), { timeout: 15000 });
      await page.getByRole("heading", { name: "הרצאה חדשה" }).waitFor({ timeout: 15000 });
      expect((await page.getByText("להעלות כמה קבצים יחד").count()) === 0, "the batch → one lecture's upload, with no link to the batch");
      await go(`/?v=ask&c=${"c0000000-0000-4000-8000-000000000001"}`);
      await page.waitForURL((u) => !u.search.includes("c="), { timeout: 15000 });
      expect(true, "?v=ask&c= → the library's question");
      await page.waitForTimeout(400);
      expect(sCalls().length === 0, `no call of section S (${sCalls().join(", ")})`);
    } else {
      /* ── 1. the library's course links ── */
      await open("שוהם", "/?v=library");
      const link = page.locator(".lib-course", { hasText: COURSE });
      await link.first().waitFor({ timeout: 15000 });
      expect((await page.locator(".lib-course", { hasText: "מיקרו" }).count()) === 1, "every course heading is a link (מיקרו too)");
      const hrefs = await page.locator(".lib-course", { hasText: COURSE }).evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
      expect(hrefs.length === 1, `one course for its two spellings (${hrefs.join(", ")})`);
      await shot("courses-library");
      await link.first().click();
      await page.waitForURL(/v=course&c=c0000000-/, { timeout: 15000 });
      const courseUrl = new URL(page.url());
      const CID = courseUrl.searchParams.get("c");
      steps.course = CID;

      /* ── 2. the course page and its sheet ── */
      await page.getByRole("heading", { level: 1, name: COURSE }).waitFor({ timeout: 15000 });
      expect(norm(await page.locator(".ph-sub").first().innerText()) === "2 הרצאות", "the head: 2 הרצאות");
      expect(norm(await page.locator(".c-exam").innerText()).includes("עוד אין תאריך"), "no exam date yet");
      const free = page.locator(".c-free");
      expect(norm(await free.innerText()) === "לתרגל מה שכבר יש · בחינם (5)", "לתרגל מה שכבר יש · בחינם (5)");
      expect((await page.locator(".a-li.c-row").count()) === 2, "the lectures' segment lists both lectures");
      await page.getByRole("button", { name: "להוסיף תאריך" }).click();
      const sheet = page.locator(".c-sheet");
      await sheet.waitFor({ timeout: 10000 });
      await sheet.locator('input[type="date"]').fill(israelDay(23));
      await sheet.getByLabel("כמה שאלות").fill("100");
      await sheet.getByLabel("כמה דקות").fill("180");
      await shot("courses-sheet");
      await sheet.getByRole("button", { name: "לשמור" }).click();
      await page.locator(".c-days", { hasText: "עוד 23 ימים" }).waitFor({ timeout: 10000 });
      const card = norm(await page.locator(".c-exam").innerText());
      expect(card.includes(`המבחן ב-${Number(israelDay(23).slice(8))}.${Number(israelDay(23).slice(5, 7))}`) && card.includes("100 שאלות · 3 שעות"), `the exam card: ${card}`);
      const row = db.coursesMock.rows.find((r) => r.id === CID);
      expect(row.exam_n === 100 && row.exam_minutes === 180 && row.exam_date === israelDay(23), "study_course_set saved the date, 100 questions and 180 minutes");
      await shot("courses-page");
      await noSideScroll("courses-page");

      /* ── 3. לתרגל מה שכבר יש (s=c), $0 ── */
      const before = aiCalls();
      await free.click();
      await page.waitForURL(/v=practice&s=c\./, { timeout: 15000 });
      const s = new URL(page.url()).searchParams.get("s");
      expect(s === `c.${COURSE}`, `the session is the course's (${s})`);
      await page.getByText(new RegExp(ITEMS.map(([q]) => q.replace(/[?+]/g, "\\$&")).join("|"))).first().waitFor({ timeout: 15000 });
      expect(aiCalls() === before, "the course's questions open with no call to /api/study/ai");

      /* ── 4. לשאול על כל הקורס ── */
      await go(`/?v=course&c=${CID}`);
      await page.getByRole("link", { name: "לשאול על כל הקורס" }).click();
      await page.waitForURL(new RegExp(`v=ask&c=${CID}`), { timeout: 15000 });
      await page.getByRole("heading", { level: 1, name: "לשאול על כל הקורס" }).waitFor({ timeout: 15000 });
      await page.getByLabel("השאלה").fill("איפה פועלות Loop diuretics?");
      await page.getByRole("button", { name: "לשאול" }).click();
      const cut = page.locator(".k-answer:not([aria-busy]) .ca-cut");
      await cut.waitFor({ timeout: 15000 });
      const cutText = norm(await cut.innerText());
      expect(/^נבחרו 3 מתוך \d+ פסקאות · מהרצאה אחת$/.test(cutText), `the cut: ${cutText}`);
      const ask = db.coursesMock.asks[0];
      expect(db.coursesMock.asks.length === 1 && ask.courseId === CID, "one course question, for this course");
      const src = page.locator(".ca-src");
      expect((await src.count()) >= 1, `the answer's sources (${await src.count()})`);
      const first = norm(await src.first().innerText());
      expect(/^הרצאה 1 · ש׳ \d+/.test(first), `a source names the lecture and slide: ${first}`);
      await shot("courses-ask");
      await noSideScroll("courses-ask");
      await src.first().click();
      await page.waitForURL(new RegExp(`[?&]l=${L}&at=\\d+\\.\\d+`), { timeout: 15000 });
      expect(true, "a source opens its paragraph in the lecture");

      /* ── 5. העלאה של כמה קבצים: 12 files, the price, a stop half way, the resume ── */
      const deck = path.join(out, "deck.pptx");
      await makePptx(deck);
      // Handed over as buffers: the files keep their Hebrew names (a path with them is not read here).
      const bytes = fs.readFileSync(deck);
      const files = Array.from({ length: 12 }, (_, i) => ({
        name: `שיעור ${i + 1} - משתנים.pptx`,
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: bytes,
      }));
      db.spent = 31.5; // $1.50 left this month: some summaries wait
      await go(`/?v=course&c=${CID}`);
      await page.getByRole("link", { name: "העלאה של כמה קבצים" }).click();
      await page.waitForURL(/v=upload&c=c0000000-[0-9a-f-]+&many=1/, { timeout: 15000 });
      await page.getByRole("heading", { level: 1, name: "העלאה של כמה קבצים" }).waitFor({ timeout: 15000 });
      await page.locator('input[type="file"]').setInputFiles(files);
      const go12 = page.getByRole("button", { name: "העלאה (12 קבצים)" });
      await go12.waitFor({ timeout: 90000 });
      expect((await page.locator(".u-row").count()) === 12, "a row for each of the 12 files");
      expect(norm(await page.locator(".a-sec h2", { hasText: "נבחרו" }).innerText()) === "נבחרו 12 קבצים", "נבחרו 12 קבצים");
      const costText = norm(await page.locator(".u-cost").innerText());
      expect(costText.includes("סיכומים ל-12 הרצאות") && costText.includes("נשארו החודש $1.50"), `the price card: ${costText}`);
      expect(/\d+ סיכומים יחכו לחודש הבא\. ההרצאות עצמן עולות עכשיו\./.test(costText), "the summaries past the month's money wait for the next");
      expect((await page.locator(".u-row", { hasText: "יחכה לחודש הבא" }).count()) >= 1, "their rows say so");
      await shot("courses-batch", { primary: ".ph-foot .a-btn.primary" });
      await noSideScroll("courses-batch");
      const before4 = db.coursesMock.inserts;
      db.coursesMock.hold = (n) => n - before4 === 4;
      await go12.click();
      await page.locator(".x-big", { hasText: "קוראים קובץ 4 מתוך 12" }).waitFor({ timeout: 120000 });
      for (let i = 0; i < 300 && !db.coursesMock.held; i++) await pause(100);
      expect(db.coursesMock.held === 1, "the 4th lecture's insert is on its way");
      expect((await page.locator(".u-row", { hasText: "✓ הועלה" }).count()) === 3, "3 files are up");
      await page.screenshot({ path: path.join(out, "courses-batch-progress.png") });
      await page.reload();
      await page.locator(".u-resume").waitFor({ timeout: 15000 });
      const resume = norm(await page.locator(".u-resume").innerText());
      expect(resume.startsWith("הועלו 4. נשארו 8 קבצים · לבחור אותם שוב"), `back after the tab closed: ${resume.slice(0, 60)}`);
      await shot("courses-resume");
      // The library says so too, with a way back.
      await go("/?v=library");
      await page.locator(".lib-batch").waitFor({ timeout: 15000 });
      expect(norm(await page.locator(".lib-batch").innerText()).includes("הועלו 4. נשארו 8 קבצים"), "the library's line for the stopped batch");
      await page.locator(".lib-batch").getByRole("link", { name: "להמשיך" }).click();
      await page.waitForURL(/v=upload&c=c0000000-[0-9a-f-]+&many=1/, { timeout: 15000 });
      await page.locator(".u-resume").waitFor({ timeout: 15000 });
      await page.locator('input[type="file"]').setInputFiles(files);
      const go8 = page.getByRole("button", { name: "העלאה (8 קבצים)" });
      await go8.waitFor({ timeout: 90000 });
      expect(norm(await page.locator("main").innerText()).includes("4 קבצים כבר הועלו, ודילגנו עליהם."), "the 4 files already up are skipped");
      await go8.click();
      await page.locator(".x-big", { hasText: "הועלו 8 קבצים" }).waitFor({ timeout: 180000 });
      const inCourse = db.lectures.filter((l) => l.course.trim().toLowerCase() === COURSE.toLowerCase());
      const titles = inCourse.map((l) => l.title);
      expect(inCourse.length === 14 && new Set(titles).size === 14, `14 lectures in the course, none twice (${inCourse.length})`);
      const left = await page.evaluate((k) => localStorage.getItem(k), `study.batch.${db.group.id}`);
      expect(left === null, "the resume list is cleared");
      await shot("courses-batch-done");
      await page.getByRole("link", { name: "לעמוד הקורס" }).click();
      await page.waitForURL(new RegExp(`v=course&c=${CID}`), { timeout: 15000 });
      await page.locator(".ph-sub", { hasText: "14 הרצאות" }).waitFor({ timeout: 15000 });
      expect(true, "the course page counts 14 lectures");

      /* ── 6. the sheet: rename, then merge ── */
      await page.getByRole("button", { name: "הגדרות הקורס" }).click();
      await sheet.waitFor({ timeout: 10000 });
      await sheet.getByLabel("שם הקורס").fill("פרמקולוגיה");
      await sheet.getByRole("button", { name: "לשנות שם" }).click();
      await page.getByRole("heading", { level: 1, name: "פרמקולוגיה" }).waitFor({ timeout: 10000 });
      expect(db.lectures.filter((l) => l.course === "פרמקולוגיה").length === 14, "the new name is every lecture's course text");
      await page.getByRole("button", { name: "הגדרות הקורס" }).click();
      await sheet.waitFor({ timeout: 10000 });
      const micro = db.coursesMock.rows.find((r) => r.name === "מיקרו");
      await sheet.getByLabel("זה אותו קורס כמו").selectOption(micro.id);
      await sheet.getByRole("button", { name: "לאחד" }).click();
      await page.waitForURL(new RegExp(`v=course&c=${micro.id}`), { timeout: 15000 });
      await page.locator(".ph-sub", { hasText: "15 הרצאות" }).waitFor({ timeout: 15000 });
      expect(!db.coursesMock.rows.some((r) => r.id === CID) && db.lectures.filter((l) => l.course === "מיקרו").length === 15, "merged: 15 lectures in מיקרו, the other course gone");
    }
  } catch (e) {
    ok.push(`FAIL: ${e.message}`);
    if (page) await page.screenshot({ path: path.join(out, "courses-fail.png") }).catch(() => undefined);
  }
  await browser.close();
  await mock.close?.();
  steps.ok = ok;
  steps.a11y = a11y;
  steps.problems = mock.problems;
  console.log(JSON.stringify(steps, null, 2));
  const failed = ok.some((x) => x.startsWith("FAIL")) || a11y.length > 0 || mock.problems.length > 0;
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
