// Past exams (docs/study/sources.md, phase 2 "מבחנים קודמים"; mockups
// exam-upload.html, exam-reading.html, exam-review.html, sim-setup.html,
// sim-running.html, sim-grid.html, sim-result.html) on the shared mock, at
// 390 px, with the synthetic 12-page exam (fixtures/exam/exam12.json, made
// into files by fixtures/make-exam.cjs: a text PDF, its key sheet, 12 photos):
//   1. The course page: "מבחנים קודמים", "העלאת מבחן קודם".
//   2. The upload, as a PDF with its key sheet apart ("בקובץ נפרד"): the
//      year, the מועד, the minutes; the price on the button before anything
//      is sent, and no sentence about where the exam goes (decision 1). The
//      13 pages are drawn at 1,500 px, uploaded to <group>/exams/<exam>/p<n>.jpg,
//      signed and handed over (op exam_read): the 13th is the key, the PDF's
//      lines go with the pages.
//   3. The reading: "מעתיקים עמודים 1–4 מתוך 12…" and a row per 4 pages; the
//      phone closes mid-read (the tab is gone) and the reading still finishes;
//      a unit that failed says "לא נקראו · לנסות שוב", and "לנסות שוב" reads it.
//   4. The review: "נמצאו N שאלות · M עם תשובה · K לבדיקה", "2 שאלות פתוחות
//      דולגו." (the fixture's open questions), the filters, an item's page
//      crop beside its text; "לאשר" a suggested answer, "לסמן תשובה אחרת" and
//      "לבטל" (the key log: the change and its undo), "לא נקראה טוב · לתקן
//      טקסט" (the item log), "לא לכלול בחישוב הנושאים".
//   5. "לתרגל את המבחן" (s=e.): the exam's order, its options as printed
//      ("א+ב נכונות" stays third) on two showings; the answer's mode is 'exam'.
//   6. The simulation: the setup (the newest ready exam chosen; the lengths
//      short first: "קצר · 20 שאלות · 36 דקות", "חצי", "מלא"; "קודם שאלות שעוד
//      לא ראיתי" on, not offered for the whole exam), running against one clock with the page's fake clock: a
//      pick, "לסמן לחזרה", the grid; the phone "locked" for 5 minutes (the
//      clock moved, the tab reloaded) comes back to the same deadline, the
//      same question, its pick and its flag; at zero it submits by itself;
//      the result: "N מתוך M", the mistakes, "רק הטעויות" (w.<attempt>). A
//      second simulation left on the server past its deadline is submitted
//      when it is opened again. Every counted pick is a study_answers row with
//      mode 'exam' and its attempt_id.
//   7. Photos ("לצלם דפים"): 13 photographed pages, one removed, one moved
//      down, one turned; "אין תשובות" costs more; 12 pages with no lines are
//      uploaded and read.
//   8. 320 and 390 px, light and dark: no horizontal scroll on every screen;
//      the a11y check on each.
// Without VITE_STUDY_EXAMS (every set but "s2" and "all") it checks that
// nothing of it shows: no "מבחנים קודמים" on the course page, ?v=exams, ?v=mock
// and s=x. lead elsewhere, no call of the exams' RPCs.
//
//   NODE_PATH=$(npm root -g) node e2e/study/exams.cjs <dist> <out dir>
// E2E_FLAGS: "s2" ("s1" with VITE_STUDY_EXAMS), or a set without it ("s1", "prod").
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { makeExamFiles, FIXTURE } = require("./fixtures/make-exam.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/exams.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const norm = (s) => String(s).replace(/[\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
const ID0 = "e0e00000-0000-4000-8000-000000000999";

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: ["שוהם", "נועה"] });
  mock.seedLecture();
  const db = mock.db;
  const COURSE = mock.fixture.outline.course;
  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const ok = [];
  const a11y = [];
  let page = null;
  let context = null;
  const open = async (who, p, o = {}) => {
    if (context) await context.close().catch(() => undefined);
    ({ page, ctx: context } = await mock.open(browser, who, {}));
    if (o.clock) await context.clock.install({ time: Date.now() + db.examsMock.offset });
    await page.goto(mock.base + p);
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
  const examCalls = () => (db.examsMock?.calls ?? []).length;
  const until = async (cond, what, ms = 20000) => {
    const t = Date.now();
    while (!(await cond())) {
      if (Date.now() - t > ms) throw new Error(`waited for ${what}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  try {
    // The course row exists once the courses' mock has seen the lectures.
    await open("שוהם", "/?v=library");
    await page.waitForTimeout(800);
    const course = db.coursesMock?.rows.find((r) => r.name === COURSE);
    if (!flags.exams) {
      /* ── Nothing of past exams without the flag ── */
      if (course) {
        await go(`/?v=course&c=${course.id}`);
        await page.locator(".ph-sub").first().waitFor({ timeout: 15000 });
        expect(!norm(await page.locator(".ph-sub").first().innerText()).includes("מבחנים"), "the course page's head counts no exams");
        expect((await page.getByRole("tab", { name: "מבחנים קודמים" }).count()) === 0, "no past exams' segment");
        expect((await page.getByRole("link", { name: "סימולציה" }).count()) === 0, "no simulation");
        await go(`/?v=mock&c=${course.id}`);
        await page.waitForURL((u) => !u.search.includes("v=mock"), { timeout: 15000 });
        expect(true, "?v=mock leads elsewhere");
      }
      await go(`/?v=exams&e=${ID0}`);
      await page.waitForURL((u) => !u.search.includes("v=exams"), { timeout: 15000 });
      expect(true, "?v=exams leads elsewhere");
      await go(`/?v=practice&s=x.${ID0}`);
      await page.waitForURL((u) => !u.search.includes("x."), { timeout: 15000 });
      expect(true, "a simulation's link leads elsewhere");
      await page.waitForTimeout(400);
      expect(examCalls() === 0, "no call of the exams' RPCs");
    } else {
      const files = await makeExamFiles(browser, path.join(out, "files"));
      steps.files = { pdf: fs.statSync(files.pdf).size, keyPdf: fs.statSync(files.keyPdf).size, photos: files.photos.length };
      const CID = course.id;

      /* ── 1. the course page: the exams' segment ── */
      await go(`/?v=course&c=${CID}&seg=exams`);
      await page.getByText("עוד אין מבחנים קודמים בקורס.").waitFor({ timeout: 15000 });
      expect((await page.getByRole("link", { name: "סימולציה" }).count()) === 0, "no simulation before a ready exam");
      await page.getByRole("link", { name: "העלאת מבחן קודם" }).click();
      await page.getByRole("heading", { level: 1, name: "העלאת מבחן קודם" }).waitFor({ timeout: 15000 });

      /* ── 2. the upload: a PDF and its key sheet ── */
      const main = page.locator("main");
      const text = norm(await main.innerText());
      for (const said of ["לאן", "נשמר", "לא יוצא", "פרטיות", "Claude"]) expect(!text.includes(said), `no sentence about where the exam goes (${said})`);
      // The guidance pass's lines: the price and the timing only (decision 1).
      const costNote = norm(await page.locator(".x-cost-note").innerText());
      expect(costNote.includes("המחיר יופיע על הכפתור אחרי שבוחרים קובץ") && costNote.includes("בתקציב החודשי של הקבוצה") && costNote.includes("לכל מי שבקבוצה בנפרד") && text.includes("10–20 דקות"), `above the button: when the price comes, what it costs, whose limit, how long (${costNote})`);
      expect(text.includes("התשובה מוקפת או מסומנת על הדף.") && text.includes("דף תשובות בקובץ או בתמונות משלו."), "each answer option says what it means");
      await page.locator("#x-pdf").setInputFiles(files.pdf);
      await page.locator(".x-picked", { hasText: "12 דפים" }).waitFor({ timeout: 60000 });
      await page.getByRole("textbox", { name: "שנה" }).fill("2025");
      await page.getByRole("radio", { name: "א׳" }).click();
      await page.getByLabel("בקובץ נפרד").check();
      await page.locator("#x-keyfile").setInputFiles(files.keyPdf);
      await page.getByText(/exam-2025-a-key\.pdf · דף אחד/).waitFor({ timeout: 60000 });
      await page.getByRole("textbox", { name: "כמה זמן היה המבחן? (דקות)" }).fill("30");
      const btn = page.locator(".ph-foot .a-btn.primary");
      const label = norm(await btn.innerText());
      expect(/^להעלות ולהעתיק( את השאלות)? · כ-\$\d+\.\d\d$/.test(label), `the price on the button before the upload: ${label}`);
      await shot("exams-upload-pdf", { primary: ".ph-foot .a-btn.primary" });
      await noSideScroll("exams-upload-pdf");
      await btn.click();
      await page.waitForURL(/v=exams&e=/, { timeout: 90000 });
      const EID = new URL(page.url()).searchParams.get("e");
      steps.exam = EID;
      const op = db.examsMock.calls.find((c) => c.fn === "op exam_read" && c.body.examId === EID && !c.body.action);
      expect(op && op.body.pages.length === 13, `13 pages handed over (${op?.body.pages.length})`);
      expect(op.body.pages[12].key === true && op.body.pages.slice(0, 12).every((x) => !x.key), "the 13th page is the key sheet's");
      // A page of the text PDF keeps its lines as a hint; a page under 80 characters reads as a scan (page 4: a question's head).
      const withLines = op.body.pages.slice(0, 12).filter((x) => x.lines.length > 0).map((x) => x.n);
      steps.linePages = withLines;
      expect(withLines.includes(1) && withLines.includes(5) && !withLines.includes(4) && op.body.pages[0].lines.some((l) => l.includes("Examplomycin")), `the PDF's text lines go with its pages (${withLines.join(",")}), page 4 a scan`);
      expect(op.body.pages[0].lines.some((l) => l.includes("מנגנון הפעולה")), `the Hebrew in reading order: ${op.body.pages[0].lines[1]}`);
      expect(op.body.pages.every((x) => Math.max(x.w, x.h) === 1500), `pages drawn at 1,500 px (${op.body.pages[0].w}×${op.body.pages[0].h})`);
      expect([...Array(13)].every((_, i) => db.files.has(`${db.group.id}/exams/${EID}/p${i + 1}.jpg`)), "every page uploaded to <group>/exams/<exam>/p<n>.jpg");
      expect(Object.keys(op.body.urls).length === 13 && typeof op.body.until === "string", "a signed link for every page, and until when");
      const ex = db.examsMock.exams.find((e) => e.id === EID);
      expect(ex.title === "מועד א׳ 2025" && ex.minutes === 30 && ex.key_source === "separate", `the exam: ${ex.title}, 30 minutes, the key apart`);

      /* ── 3. the reading; the phone closes; a failed unit and "לנסות שוב" ── */
      await page.locator(".x-prog .x-big").waitFor({ timeout: 15000 });
      const line = norm(await page.locator(".x-prog .x-big").innerText());
      // A unit reading pages, the key sheet read first, or the first pages waiting their turn (never "copying" a unit that waits).
      expect(/^(מעתיקים עמודים \d+–\d+ מתוך 12…|קוראים את דף התשובות…|עמודים \d+–\d+ בתור…)$/.test(line), `the reading's line: ${line}`);
      expect(norm(await page.locator(".x-prog").innerText()).includes("אפשר לסגור את הטלפון"), "אפשר לסגור את הטלפון");
      await shot("exams-reading");
      await noSideScroll("exams-reading");
      await context.close();
      context = null;
      // The tab is gone; the server goes on.
      await until(() => ex.status === "ready", "the reading to finish with the phone closed", 30000);
      expect(true, "closing the phone mid-read still finishes");
      await open("שוהם", `/?v=exams&e=${EID}&c=${CID}`);
      await page.locator(".r-sum").waitFor({ timeout: 15000 });

      /* ── 4. the review ── */
      const items = db.practice.questions.filter((q) => q.exam_id === EID);
      const expectedNos = new Set(FIXTURE.units.flatMap((u) => u.reply.questions.map((q) => q.no)));
      expect(items.length === expectedNos.size, `every item saved once (${items.length} of ${expectedNos.size})`);
      const k = (no) => db.practice.keys.get(items.find((q) => q.exam_no === no).id);
      expect(k(2).answer === 0 && k(2).origin === "sheet", "the key sheet merged by number (item 2: א׳)");
      const nums = (await page.locator(".r-sum .nums b").allInnerTexts()).map(Number);
      steps.review = nums;
      expect(nums[0] === items.length && nums[0] === nums[1] + nums[2], `found = with an answer + to check (${nums.join(", ")})`);
      expect(norm(await page.locator(".r-sum").innerText()).includes("2 שאלות פתוחות דולגו."), "2 שאלות פתוחות דולגו.");
      await shot("exams-review");
      await noSideScroll("exams-review");
      // The badly read item: its page beside the text, "לתקן טקסט" logged.
      await page.getByRole("radio", { name: /^הכל/ }).click();
      await page.locator(".r-head", { hasText: "שאלה 10" }).click();
      const card = page.locator(".r-item");
      await card.waitFor({ timeout: 10000 });
      expect(norm(await card.innerText()).includes("לא נקראה טוב"), "item 10 is marked לא נקראה טוב");
      await card.locator(".x-crop img").waitFor({ timeout: 15000 });
      expect(true, "the page beside the item's text");
      await card.getByRole("button", { name: "לא נקראה טוב · לתקן טקסט" }).click();
      const q10 = items.find((q) => q.exam_no === 10);
      await card.getByRole("textbox", { name: "השאלה" }).fill(`${q10.question} (תוקן)`);
      await card.getByRole("button", { name: "לשמור" }).click();
      await until(() => db.examsMock.itemLog.length === 1, "the item log");
      expect(q10.question.endsWith("(תוקן)") && db.examsMock.itemLog[0].field === "question", "the fix is saved and logged");
      await card.getByRole("button", { name: /לסגור את שאלה 10/ }).click();
      // Item 3: its crop (pg:3:…) beside the text.
      await page.locator(".r-head", { hasText: "שאלה 3" }).click();
      await page.locator(".r-item .x-crop.is-box img").waitFor({ timeout: 15000 });
      expect(true, "item 3's figure is a crop of its page");
      await shot("exams-review-item");
      await noSideScroll("exams-review-item");
      await page.locator(".r-item").getByRole("button", { name: /לסגור את שאלה 3/ }).click();
      // A suggested answer: "לאשר", then another answer and "לבטל".
      const sug = items.find((q) => db.practice.keys.get(q.id).origin === "solved" && q.form === "one");
      expect(Boolean(sug), `a suggested answer to confirm (item ${sug?.exam_no})`);
      await page.getByRole("radio", { name: /^תשובה מוצעת/ }).click();
      await page.locator(".r-head", { hasText: `שאלה ${sug.exam_no}` }).click();
      expect(norm(await page.locator(".r-item").innerText()).includes("תשובה מוצעת · לא נבדקה"), "תשובה מוצעת · לא נבדקה");
      const groupLine = await page.evaluate(() => {
        const acts = document.querySelector(".r-item .r-acts");
        const line = document.querySelector(".r-item .r-group");
        return line && acts && acts.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING ? line.textContent : "";
      });
      expect(groupLine.includes("לכל הקבוצה") && groupLine.includes("ואפשר לבטל"), `under ״לאשר״: the answer changes for the whole group (${groupLine})`);
      const was = db.practice.keys.get(sug.id).answer;
      await page.locator(".r-item").getByRole("button", { name: "לאשר" }).click();
      await until(() => db.practice.keys.get(sug.id).origin === "member", "the confirmation");
      expect(db.practice.keys.get(sug.id).answer === was && db.examsMock.keyLog.length === 1, "לאשר: the same answer, origin member, logged");
      await page.getByRole("radio", { name: /^הכל/ }).click();
      // The item stays open after "לאשר" (under "הכל" now, no longer a suggested one).
      await page.locator(".r-item", { hasText: `שאלה ${sug.exam_no}` }).waitFor({ timeout: 10000 });
      await page.locator(".r-item").getByRole("button", { name: "לסמן תשובה אחרת" }).click();
      const other = (was + 1) % sug.options.length;
      await page.locator(".r-item").getByRole("button", { name: `לסמן את תשובה ${["א׳", "ב׳", "ג׳", "ד׳", "ה׳"][other]}` }).click();
      await until(() => db.practice.keys.get(sug.id).answer === other, "the other answer");
      await page.locator(".r-item .r-who", { hasText: "סומנה ע״י שוהם" }).waitFor({ timeout: 10000 });
      expect(true, "סומנה ע״י שוהם");
      await page.locator(".r-item").getByRole("button", { name: "לבטל" }).click();
      await until(() => db.practice.keys.get(sug.id).answer === was, "the undo");
      const log = db.examsMock.keyLog;
      expect(log.length === 3 && log[2].undo_of === 2 && db.practice.keys.get(sug.id).origin === "member", "the key log: a confirmation, a change, and its undo");
      await page.locator(".r-item .r-log summary").click();
      expect((await page.locator(".r-item .r-log li").count()) === 3, "the item's changes listed under it");
      await page.locator(".r-hide input").check();
      await until(() => ex.hide_from_profile === true, "לא לכלול בחישוב הנושאים");
      expect(true, "לא לכלול בחישוב הנושאים saved");
      await page.locator(".r-hide input").uncheck();

      /* ── 5. "לתרגל את המבחן": the exam's order, its options as printed ── */
      await page.getByRole("link", { name: "לתרגל את המבחן" }).click();
      await page.waitForURL(new RegExp(`s=e\\.${EID}`), { timeout: 15000 });
      await page.locator(".pq-options").waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      expect((await page.locator(".guide-btn, .g-bubble:not([hidden])").count()) === 0, "replaying an exam: no \"?\" and no bubble over the question");
      const one = items.find((q) => q.exam_no === 1);
      const shown = async () => (await page.locator(".pq-options .pq-text").allInnerTexts()).map(norm);
      const first = await shown();
      expect(JSON.stringify(first) === JSON.stringify(one.options.map(norm)), `item 1 as printed: ${first.join(" | ")}`);
      expect(first[2] === "א+ב נכונות", "״א+ב נכונות״ stays third");
      await page.locator(".pq-options .a-opt").nth(2).click();
      await page.getByRole("radio", { name: "על בטוח" }).click();
      await page.getByRole("button", { name: "לבדוק" }).click();
      await page.locator(".pq-verdict").waitFor({ timeout: 10000 });
      const ans = db.practice.answers.filter((a) => a.question_id === one.id).pop();
      expect(ans && ans.mode === "exam", "the answer is recorded with mode 'exam'");
      await shot("exams-replay");
      // A new session over the same exam: the same order again.
      await go(`/?v=exams&e=${EID}&c=${CID}`);
      await page.getByRole("link", { name: "לתרגל את המבחן" }).waitFor({ timeout: 15000 });
      await page.evaluate(() => sessionStorage.clear());
      await go(`/?v=practice&s=e.${EID}&n=all`);
      await page.locator(".pq-options").waitFor({ timeout: 15000 });
      expect(JSON.stringify(await shown()) === JSON.stringify(first), "the same order on a second showing");

      /* ── 6. the simulation ── */
      // A bigger exam of the course, older: the lengths short first.
      const big = db.examsMock.seed({ course: COURSE, title: "מועד ב׳ 2024", n: 60, minutes: 108 });
      await go(`/?v=course&c=${CID}`);
      await page.getByRole("link", { name: "סימולציה" }).waitFor({ timeout: 15000 });
      expect((await page.getByRole("link", { name: "לתרגל מבחן קודם" }).count()) === 1, "the course page: סימולציה and לתרגל מבחן קודם");
      await page.getByRole("link", { name: "סימולציה" }).click();
      await page.getByRole("heading", { level: 1, name: "סימולציה" }).waitFor({ timeout: 15000 });
      const srcs = page.locator(".s-src");
      expect((await srcs.count()) === 2 && (await srcs.first().getAttribute("aria-checked")) === "true" && norm(await srcs.first().innerText()).includes("מועד א׳ 2025"), "the newest ready exam is chosen");
      await srcs.nth(1).click();
      const lens = (await page.locator(".s-len > button").allInnerTexts()).map(norm);
      expect(JSON.stringify(lens) === JSON.stringify(["קצר 20 שאלות 36 דקות", "חצי 50 שאלות 90 דקות", "מלא 60 שאלות 108 דקות"]), `the lengths, short first: ${lens.join(" | ")}`);
      expect((await page.locator(".s-len > button").first().getAttribute("aria-checked")) === "true", "short is chosen first");
      expect(await page.getByRole("checkbox", { name: "קודם שאלות שעוד לא ראיתי" }).isChecked(), "קודם שאלות שעוד לא ראיתי is on");
      // The whole exam has every question: the choice is not offered for it.
      await page.locator(".s-len > button").last().click();
      expect((await page.getByRole("checkbox", { name: "קודם שאלות שעוד לא ראיתי" }).count()) === 0, "no 'not seen first' for the whole exam");
      await page.locator(".s-len > button").first().click();
      await shot("exams-sim-setup", { primary: ".ph-foot .a-btn.primary" });
      await noSideScroll("exams-sim-setup");
      // The uploaded exam, whole (12 questions of the 14 it printed, 30 minutes), against the page's fake clock.
      await open("שוהם", `/?v=mock&c=${CID}&e=${EID}`, { clock: true });
      await page.getByRole("heading", { level: 1, name: "סימולציה" }).waitFor({ timeout: 15000 });
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.waitForURL(/s=x\./, { timeout: 15000 });
      const AID = new URL(page.url()).searchParams.get("s").slice(2);
      const att = () => db.examsMock.attempts.find((a) => a.id === AID);
      const deadline = att().deadline;
      await page.locator(".m-pos", { hasText: `שאלה 1 מתוך ${items.length}` }).waitFor({ timeout: 15000 });
      expect((await page.locator(".guide-btn, .g-bubble:not([hidden])").count()) === 0, "while the clock runs: no \"?\" and no bubble over the question");
      const clock = async () => norm(await page.locator(".m-time").innerText());
      // 30 minutes were for the 14 questions it printed (2 open ones skipped): 26 for the 12 copied.
      expect(/^0:(25|26):\d\d$/.test(await clock()), `one clock for the whole simulation: ${await clock()}`);
      // A pick, no feedback; the next question, flagged.
      await page.locator(".pq-options .a-opt").nth(2).click();
      await until(() => Boolean(att().picks[items.find((q) => q.exam_no === 1).id]), "the pick on the server");
      expect((await page.locator(".pq-verdict, .a-opt.correct, .a-opt.wrong").count()) === 0, "no feedback while it runs");
      await page.getByRole("button", { name: "לשאלה הבאה" }).click();
      await page.locator(".m-pos", { hasText: "שאלה 2 מתוך" }).waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "לסמן לחזרה" }).click();
      await until(() => att().flagged.includes(1) && att().position === 1, "the flag and the place on the server");
      await shot("exams-sim-running", { primary: ".ph-foot .a-btn.primary" });
      await noSideScroll("exams-sim-running");
      await page.getByRole("button", { name: "מפת השאלות" }).click();
      const sheet = page.locator(".m-sheet");
      await sheet.waitFor({ timeout: 10000 });
      expect(norm(await sheet.innerText()).includes(`להגיש עכשיו? נשארו ${items.length - 1} שאלות בלי תשובה.`), "the grid's submit line counts the empty ones");
      expect((await sheet.locator(".m-grid button.f").count()) === 1 && (await sheet.locator(".m-grid button:not(.e)").count()) === 1, "the grid: one answered, one flagged");
      expect(norm(await sheet.locator(".m-leave").innerText()) === "יוצאים באמצע? השעון ממשיך. חוזרים מ״סימולציה״ בעמוד הקורס.", "the grid says the clock goes on when leaving");
      await shot("exams-sim-grid");
      await sheet.getByRole("button", { name: "סגירה" }).click();
      // The phone locked for 5 minutes: the clock moved, the tab is reloaded.
      const before = await clock();
      db.examsMock.offset += 5 * 60_000;
      await page.clock.fastForward(5 * 60_000);
      await page.reload();
      await page.locator(".m-pos", { hasText: "שאלה 2 מתוך" }).waitFor({ timeout: 15000 });
      const after = await clock();
      const secs = (t) => t.split(":").reduce((n, x) => n * 60 + Number(x), 0);
      expect(Math.abs(secs(before) - secs(after) - 300) <= 3, `5 minutes later, the same deadline: ${before} → ${after}`);
      expect(att().deadline === deadline, "the server's deadline did not move");
      expect((await page.getByRole("button", { name: "מסומנת לחזרה" }).count()) === 1, "the flag came back");
      // At zero it submits by itself.
      const left = secs(after);
      db.examsMock.offset += (left + 2) * 1000;
      await page.clock.fastForward((left + 2) * 1000);
      await page.locator(".e-score").waitFor({ timeout: 15000 });
      expect(Boolean(att().finished_at) && att().auto === true, "at zero the simulation was submitted by the clock");
      const res = norm(await page.locator(".e-score").innerText());
      expect(res.includes("הוגשה כשהזמן נגמר"), `the result: ${res}`);
      const rows = db.practice.answers.filter((a) => a.attempt_id === AID);
      expect(rows.length === 1 && rows[0].mode === "exam", `study_answers: one row for the one counted pick, mode 'exam', with its attempt_id (${rows.length})`);
      const score = att().score;
      expect(res.includes(`${score.right} מתוך ${score.counted}`), `${score.right} מתוך ${score.counted}`);
      if (score.suggested) expect(res.includes("תשובה מוצעת: האפליקציה פתרה"), "the result says what a suggested answer is");
      // A suggested answer is "המוצעת" in the result, never "✓ הנכונה".
      const solvedRow = score.items.find((it) => it.origin === "solved" && it.form === "one" && it.answer !== null && (!it.counted || !it.correct));
      if (solvedRow) {
        await page.locator(".e-row .a-li", { hasText: `שאלה ${solvedRow.pos}` }).first().click();
        const opened = norm(await page.locator(".e-item").first().innerText());
        expect(opened.includes("התשובה המוצעת") && !opened.includes("✓ הנכונה"), `a solved item's key reads ״התשובה המוצעת״: ${opened}`);
        steps.solvedShown = solvedRow.pos;
      }
      await shot("exams-sim-result");
      await noSideScroll("exams-sim-result");
      // "רק הטעויות": the mistakes asked again.
      await page.getByRole("link", { name: "רק הטעויות" }).click();
      await page.waitForURL(new RegExp(`s=w\\.${AID}`), { timeout: 15000 });
      await page.getByRole("heading", { level: 1, name: "הטעויות מהסימולציה" }).waitFor({ timeout: 15000 });
      expect(true, "רק הטעויות opens the simulation's mistakes");
      // A second simulation (the bigger exam, short) left past its deadline: submitted on its next load.
      await open("שוהם", `/?v=mock&c=${CID}&e=${big.id}`, { clock: true });
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.waitForURL(/s=x\./, { timeout: 15000 });
      const AID2 = new URL(page.url()).searchParams.get("s").slice(2);
      const att2 = () => db.examsMock.attempts.find((a) => a.id === AID2);
      await page.locator(".m-pos", { hasText: "שאלה 1 מתוך 20" }).waitFor({ timeout: 15000 });
      expect(db.examsMock.mocks.find((m) => m.id === att2().mock_id).minutes === 36, "short: 20 questions, 36 minutes");
      await page.locator(".pq-options .a-opt").first().click();
      await until(() => Object.keys(att2().picks).length === 1, "the pick");
      // "→ יציאה" with time left: the toast says the clock goes on, and where to come back from.
      await page.getByRole("button", { name: "→ יציאה" }).click();
      await page.locator(".a-toast", { hasText: "השעון ממשיך" }).waitFor({ timeout: 8000 });
      expect(norm(await page.locator(".a-toast").first().innerText()).includes("חוזרים מ״סימולציה״ בעמוד הקורס"), "leaving mid-simulation: ״השעון ממשיך״");
      await context.close();
      context = null;
      db.examsMock.offset += 40 * 60_000;
      await open("שוהם", `/?v=practice&s=x.${AID2}`, { clock: true });
      await page.locator(".e-score").waitFor({ timeout: 15000 });
      expect(att2().auto === true && Boolean(att2().finished_at), "past its deadline, the server submitted it on the next load");

      /* ── 7. photos, no answers ── */
      await go(`/?v=exams&new=1&c=${CID}`);
      await page.getByRole("radio", { name: "לצלם דפים" }).click();
      await page.locator("#x-photos").setInputFiles([...files.photos, files.photos[0]]);
      await page.locator(".x-th").nth(12).waitFor({ timeout: 15000 });
      expect((await page.locator(".x-th").count()) === 13, "13 photos in the strip");
      await page.getByRole("button", { name: "למחוק את דף 13", exact: true }).click();
      await page.getByRole("button", { name: "לאחר את דף 1", exact: true }).click();
      await page.getByRole("button", { name: "להקדים את דף 2", exact: true }).click();
      await page.getByRole("button", { name: "לסובב את דף 5", exact: true }).click();
      expect((await page.locator(".x-th").count()) === 12, "one removed: 12 pages");
      await page.getByRole("textbox", { name: "שנה" }).fill("2023");
      const priceMarked = norm(await page.locator(".ph-foot .a-btn.primary").innerText());
      await page.getByLabel("אין תשובות").check();
      const priceNone = norm(await page.locator(".ph-foot .a-btn.primary").innerText());
      const usd = (s) => Number(/\$(\d+\.\d\d)/.exec(s)[1]);
      expect(usd(priceNone) > usd(priceMarked), `no answers costs more (${priceMarked} → ${priceNone})`);
      expect(norm(await page.locator(".x-keys").innerText()).includes("תשובה מוצעת · לא נבדקה"), "אין תשובות says the answers will be suggested");
      await shot("exams-upload-photos", { primary: ".ph-foot .a-btn.primary" });
      await noSideScroll("exams-upload-photos");
      // Its first read unit fails once ("unreadable"): the row says so, and "לנסות שוב" reads it.
      db.examsMock.fail = (u) => u.kind === "read" && u.pages[0] === 1 && u.exam_id !== EID;
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.waitForURL(/v=exams&e=/, { timeout: 90000 });
      const EID2 = new URL(page.url()).searchParams.get("e");
      const op2 = db.examsMock.calls.find((c) => c.fn === "op exam_read" && c.body.examId === EID2 && !c.body.action);
      expect(op2.body.pages.length === 12 && op2.body.pages.every((x) => x.lines.length === 0 && !x.key), "12 photographed pages, no lines, no key");
      expect(op2.body.pages[4].w > op2.body.pages[4].h && op2.body.pages[0].h > op2.body.pages[0].w, "the turned page is drawn turned");
      const ex2 = db.examsMock.exams.find((e) => e.id === EID2);
      await until(() => ex2.status === "ready", "the photos' reading", 30000);
      await page.locator(".r-sum").waitFor({ timeout: 20000 });
      const failedRow = page.locator(".x-units .a-li", { hasText: "לא נקראו" });
      await failedRow.waitFor({ timeout: 15000 });
      expect(norm(await failedRow.innerText()).includes("לא נקראו"), `a unit that failed: ${norm(await failedRow.innerText())}`);
      const before2 = db.practice.questions.filter((q) => q.exam_id === EID2).length;
      await failedRow.getByRole("button", { name: "לנסות שוב" }).click();
      await until(() => db.examsMock.units.filter((u) => u.exam_id === EID2 && u.pages?.[0] === 1).every((u) => u.status === "done"), "the retried unit", 30000);
      await until(() => ex2.status === "ready", "ready again", 30000);
      const after2 = db.practice.questions.filter((q) => q.exam_id === EID2).length;
      expect(after2 > before2 && ex2.retries === 1, `"לנסות שוב" read pages 1–4 (${before2} → ${after2} items)`);
      await page.locator(".x-units").waitFor({ state: "detached", timeout: 20000 });
      expect(true, "the photographed exam is read too, every unit");
    }
  } catch (e) {
    ok.push(`FAIL: ${e.message}`);
    if (page) await page.screenshot({ path: path.join(out, "exams-fail.png"), fullPage: true }).catch(() => undefined);
  }
  await browser.close();
  clearInterval(db.examsMock?.timer);
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
