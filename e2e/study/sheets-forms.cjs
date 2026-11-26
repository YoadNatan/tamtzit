// Uploaded sheets' release A1 (docs/study/sheets.md; VITE_STUDY_SHEETS_FORMS,
// section O 2) on the shared mock, with the synthetic sheet only
// (fixtures/make-sheet.cjs, sheet6.json: fictional drugs, no course
// material). No real host, no paid call. In order:
//   1. Help's "מבחנים ותרגילים" says how open and numeric questions are
//      answered and what "⋯ עוד" fixes.
//   2. The lecture page's row "דפי תרגילים של ההרצאה" (empty), its "+ העלאת
//      דף תרגילים" opens the upload as a sheet with the lecture.
//   3. The upload sends forms: true (the sheet reader) with the answers file;
//      the review has all 11 printed items: labels as printed ("3א"), the
//      forms' tags (מספרית, פתוחה), a table as a labelled table, a
//      multi-part question's parts, 8 options, a numeric item's answer from the
//      answers file and its worked solution ("פתרון מלא"), an open item's
//      model answer and rubric. The lecture page's row then lists the sheet.
//   4. "⋯ עוד": the edit sheet ("לתקן את השאלה") fixes a question's lines and
//      adds an option (study_exam_item_fix, logged); "לסמן איור" draws a box on
//      the page at 1440 ("לסמן" on) and "כל העמוד כאיור" in one tap;
//      "לתקן תשובה" on a numeric item sets its tolerance (study_item_solution,
//      origin member); "+ להוסיף שאלה שלא הועתקה" adds an open item; "להוציא
//      את השאלה" takes it out and "להחזיר" brings it back; once answered, the
//      edit sheet says only text may change.
//   5. "לתרגל כמו בדף": a numeric part with a comma ("3,0": ✓, a study_answers
//      row with its value), a multi-part question's part line and folded case,
//      a wrong numeric answer with the typographic minus, a table in practice,
//      an open item's draft surviving a reload, "להראות פתרון", the rubric and
//      "צדקתי" (an open mark, never an answer row: OD8); the round's score
//      leaves the open item out.
//   6. Open-add on a past exam read by the exam reader: "להעתיק גם 2 שאלות
//      פתוחות · כ-$…" (dry for the price), the exam stays ready while its open
//      and numeric items are copied.
//   7. The budget pause (D23): "נעצר: נגמר התקציב החודשי.", "להמשיך" refused
//      while the line is spent, then "לסיים בלי תשובות מוצעות".
//   8. A topic session never asks an open or numeric item (design D15).
//   9. 320, 390, 820 and 1440 px, light and dark, no sideways scroll; the a11y
//      check on every screen. problems: [], a11y: [].
// Without VITE_STUDY_SHEETS_FORMS (set "o0", "ps"): the upload never sends
// forms, the lecture page has no row, and a sheet's open item is never asked.
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=o node e2e/study/sheets-forms.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { makeSheetFiles, pageShots } = require("./fixtures/make-sheet.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: E2E_FLAGS=o node e2e/study/sheets-forms.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const norm = (s) => String(s).replace(/[⁦-⁩‎‏]/g, "").replace(/\s+/g, " ").trim();
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: ["שוהם", "נועה"] });
  mock.seedLecture();
  const db = mock.db;
  const M = db.examsMock;
  M.pace = 250;
  clearInterval(M.timer);
  M.timer = setInterval(() => M.tick(), M.pace);
  M.timer.unref?.();
  const COURSE = mock.fixture.outline.course;
  const LEC = mock.LECTURE_ID;
  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const ok = [];
  const a11y = [];
  let page = null;
  let context = null;
  const open = async (who, p, o = {}) => {
    if (context) await context.close().catch(() => undefined);
    ({ page, ctx: context } = await mock.open(browser, who, { viewport: o.viewport ?? PHONE }));
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
  const until = async (cond, what, ms = 20000) => {
    const t = Date.now();
    while (!(await cond())) {
      if (Date.now() - t > ms) throw new Error(`waited for ${what}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const noSideScroll = async (name) => {
    const size = page.viewportSize();
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: width >= 820 ? 1000 : 700 });
        await page.waitForTimeout(200);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 1) throw new Error(`${name}: ${over} px of horizontal scroll at ${width} px (${scheme})`);
        if (width !== 390) await page.screenshot({ path: path.join(out, `${name}-${width}-${scheme}.png`), fullPage: true });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    ok.push(`${name}: no horizontal scroll at 320, 390, 820 and 1440 px, light and dark`);
  };
  const calls = (fn) => M.calls.filter((c) => c.fn === fn);
  const items = (eid) => db.practice.questions.filter((q) => q.exam_id === eid).sort((a, b) => a.exam_no - b.exam_no);
  const byLabel = (eid, label) => items(eid).find((q) => q.no_label === label);
  const rowOf = (label) => page.locator(".r-head").filter({ has: page.locator("b", { hasText: new RegExp(`^\\s*שאלה ${label}(\\s|·|$)`) }) });
  const openItem = async (label) => {
    await page.getByRole("radio", { name: /^הכל/ }).click();
    const already = page.locator(".r-item").filter({ has: page.locator(`[id^="ri-"]`, { hasText: new RegExp(`^\\s*שאלה ${label}(\\s|·|$)`) }) });
    if (await already.count()) return already.first();
    await rowOf(label).first().click();
    await page.locator(".r-item").first().waitFor({ timeout: 10000 });
    return page.locator(".r-item").first();
  };

  try {
    await open("שוהם", "/?v=library");
    await page.waitForTimeout(800);
    const course = db.coursesMock?.rows.find((r) => r.name === COURSE);
    expect(Boolean(course), "the course row exists");
    const CID = course.id;
    const files = await makeSheetFiles(browser, path.join(out, "files"));
    const clean = await pageShots(browser, path.join(out, "files"));

    if (!flags.sheetForms) {
      /* ── Nothing of release A1 without its flag ── */
      await go(`/?v=lecture&l=${LEC}`);
      await page.waitForTimeout(1500);
      expect((await page.locator(".sl").count()) === 0, "the lecture page: no row of sheets");
      if (flags.sheets) {
        const sheet = db.sheetsMock.seed({ course: COURSE, title: "דף עם שאלות פתוחות", lecture: LEC, images: clean.slice(1), forms: true });
        await go(`/?v=practice&s=e.${sheet.id}&n=all`);
        await page.locator(".pq").first().waitFor({ timeout: 15000 });
        const total = Number(norm(await page.locator(".pq-pos").innerText()).split("/")[1]);
        const plain = items(sheet.id).filter((q) => q.has_key && ["one", "tf", "match"].includes(q.form)).length;
        expect(total === plain, `practising the sheet asks its choice items only (${total} of ${items(sheet.id).length})`);
        expect((await page.locator(".sa").count()) === 0, "no open or numeric answer on screen");
      }
      expect(calls("op exam_read").every((c) => c.body.forms !== true), "the upload never sends forms");
    } else {
      /* ── 1. help ── */
      await go("/?v=help");
      await page.getByText("מבחנים ותרגילים", { exact: true }).first().waitFor({ timeout: 15000 });
      await page.locator("details", { hasText: "מבחנים ותרגילים" }).first().locator("summary").click();
      const help = norm(await page.locator("details", { hasText: "מבחנים ותרגילים" }).first().innerText());
      expect(help.includes("שאלות פתוחות נבדקות לבד ונספרות רק בהתקדמות האישית.") && help.includes("״⋯ עוד״") && help.includes("״לסיים בלי תשובות מוצעות״"), "help: open and numeric answers, ⋯ עוד, the pause");

      /* ── 2. the lecture page's row ── */
      await go(`/?v=lecture&l=${LEC}`);
      const row = page.locator(".sl");
      await row.waitFor({ timeout: 20000 });
      expect(norm(await row.innerText()).includes("עוד אין דף תרגילים להרצאה הזו."), "the lecture page: דפי תרגילים של ההרצאה, none yet");
      await shot("forms-lecture-empty");
      await row.getByRole("link", { name: "+ העלאת דף תרגילים" }).click();
      await page.getByRole("heading", { level: 1, name: "העלאת מבחן או דף תרגילים" }).waitFor({ timeout: 15000 });
      const up = new URL(page.url());
      expect(up.searchParams.get("new") === "sheet" && up.searchParams.get("l") === LEC && up.searchParams.get("c") === CID, `the row opens the upload as a sheet with its lecture (${up.search})`);

      /* ── 3. the upload with the sheet reader, the review ── */
      await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles(files.pdf);
      await page.locator(".sx-pages").first().waitFor({ timeout: 60000 });
      await page.getByRole("button", { name: "להוריד אותו" }).click();
      await page.getByLabel("בקובץ נפרד").check();
      await page.locator('input[type=file][accept="application/pdf,.pdf,image/*"]').setInputFiles(files.answersPdf);
      await page.getByRole("list", { name: "קובץ התשובות, לפי הסדר" }).waitFor({ timeout: 60000 });
      const label = norm(await page.locator(".ph-foot .a-btn.primary").innerText());
      expect(/^להעלות ולהעתיק · כ-\$\d+\.\d\d$/.test(label), `the sheet reader's price on the button: ${label}`);
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.waitForURL(/v=exams&e=/, { timeout: 90000 });
      const EID = new URL(page.url()).searchParams.get("e");
      steps.sheet = EID;
      const op = calls("op exam_read").find((c) => c.body.examId === EID && !c.body.action);
      expect(op?.body.forms === true, "the upload asks for the sheet reader (forms: true)");
      const ex = M.exams.find((e) => e.id === EID);
      await until(() => ex.status === "ready", "the sheet's reading", 40000);
      await page.locator(".r-sum").waitFor({ timeout: 20000 });
      const nums = (await page.locator(".r-sum .nums b").allInnerTexts()).map(Number);
      steps.review = nums;
      expect(nums[0] === 11 && items(EID).length === 11, `every printed item, open, numeric and 8 options too: 11 (${nums.join(", ")})`);
      expect(!norm(await page.locator(".r-sum").innerText()).includes("דולגו"), "nothing skipped");
      await page.getByRole("radio", { name: /^הכל/ }).click();
      const heads = (await page.locator(".r-head b").allInnerTexts()).map(norm);
      steps.heads = heads;
      expect(["שאלה 1", "שאלה 3א", "שאלה 3ב · מספרית", "שאלה 3ג · פתוחה", "שאלה 4 · מספרית", "שאלה 8 · פתוחה", "שאלה 9"].every((h) => heads.includes(h)), "labels as printed, with the forms' tags");
      await shot("forms-review-phone");
      await noSideScroll("forms-review-phone");
      // A table, labelled and focusable.
      let card = await openItem("5");
      const table = card.getByRole("region", { name: "טבלה בשאלה 5" });
      await table.waitFor({ timeout: 10000 });
      expect((await table.locator("th").count()) === 3 && (await table.locator("tbody tr").count()) === 3 && (await table.getAttribute("tabindex")) === "0", "a printed table: a table with its header, in a focusable labelled region");
      await card.getByRole("button", { name: "לסגור את שאלה 5" }).click();
      // A numeric part: its answer from the answers file, the part line, the worked solution.
      card = await openItem("3ב");
      const t3b = norm(await card.innerText());
      expect(t3b.includes("סעיף ב׳ מתוך 3") && t3b.includes("התשובה: 3 שעות") && t3b.includes("מקובץ התשובות"), "3ב: סעיף ב׳ מתוך 3, the answer 3 שעות from the answers file");
      expect(t3b.includes("מטופל בן 60 (בדוי)"), "a part carries the question's shared case");
      await card.locator("details.ss-sol summary").click();
      expect(norm(await card.locator("details.ss-sol").innerText()).includes("הן שתי מחציות חיים"), "פתרון מלא: the worked solution");
      await shot("forms-review-numeric");
      await card.getByRole("button", { name: "לסגור את שאלה 3ב" }).click();
      card = await openItem("8");
      const t8 = norm(await card.innerText());
      expect(t8.includes("תשובה לדוגמה") && (await card.locator(".sa-rubric li").count()) === 3, "an open item: its model answer and rubric");
      await card.getByRole("button", { name: "לסגור את שאלה 8" }).click();
      card = await openItem("9");
      expect((await card.locator(".r-opts li").count()) === 8, "a one-answer item with 8 options");
      await card.getByRole("button", { name: "לסגור את שאלה 9" }).click();

      /* ── 4. ⋯ עוד: the edit sheet, the answer, add, retire ── */
      card = await openItem("1");
      await card.getByRole("button", { name: "⋯ עוד" }).click();
      await card.getByRole("button", { name: "לתקן את השאלה" }).click();
      const se = card.locator(".se");
      await se.waitFor({ timeout: 10000 });
      expect((await se.getByRole("radio", { name: "פתוחה" }).count()) === 1 && (await se.getByRole("radio", { name: "מספרית" }).count()) === 1, "the edit sheet: the five forms");
      await se.getByLabel("השאלה").fill("איזה מהמשפטים הבאים נכון\nלגבי Fictazole?");
      await se.getByRole("button", { name: "+ אפשרות" }).click();
      await se.getByRole("textbox", { name: "אפשרות ו" }).fill("אף אחת מהתשובות");
      await shot("forms-edit-sheet");
      await se.getByRole("button", { name: "לשמור" }).click();
      await page.getByText("התיקון נשמר.").first().waitFor({ timeout: 10000 });
      const q1 = byLabel(EID, "1");
      const fix1 = calls("study_exam_item_fix").pop();
      expect(q1.options.length === 6 && q1.question.includes("\n") && fix1.body.p_patch.options?.length === 6 && !("form" in fix1.body.p_patch), "study_exam_item_fix: the question's lines kept, an option added, only what changed");
      expect(M.itemLog.some((l) => l.question_id === q1.id && l.field === "options"), "the change is logged");
      // לסמן איור: the whole page in one tap.
      card = await openItem("1");
      await card.getByRole("button", { name: "⋯ עוד" }).click();
      await card.getByRole("button", { name: "לסמן איור" }).click();
      await card.locator(".se").getByRole("button", { name: "כל העמוד כאיור" }).click();
      await card.locator(".se").getByRole("button", { name: "לשמור" }).click();
      await page.getByText("התיקון נשמר.").first().waitFor({ timeout: 10000 });
      expect(byLabel(EID, "1").figures.some((f) => /:0,0,1000,1000$/.test(f)), "כל העמוד כאיור: one tap, the whole page as the item's figure");
      // לתקן תשובה on a numeric item.
      card = await openItem("4");
      await card.getByRole("button", { name: "לתקן תשובה" }).click();
      await card.getByLabel("טווח (אחוזים)").fill("2");
      await card.locator(".se").getByRole("button", { name: "לשמור" }).click();
      await page.getByText("התשובה עודכנה לכל הקבוצה.").first().waitFor({ timeout: 10000 });
      const k4 = db.practice.keys.get(byLabel(EID, "4").id);
      expect(k4.num_tol === 2 && k4.origin === "member" && calls("study_item_solution").pop().body.p_patch.num_tol === 2, "study_item_solution: the tolerance, origin member");
      card = await openItem("4");
      expect(norm(await card.innerText()).includes("נבדקה ע״י שוהם"), "the answer now says who checked it");
      await card.getByRole("button", { name: "לסגור את שאלה 4" }).click();
      // + להוסיף שאלה שלא הועתקה.
      await page.getByRole("button", { name: "+ להוסיף שאלה שלא הועתקה" }).click();
      const add = page.locator(".ss-tail .se");
      await add.waitFor({ timeout: 10000 });
      await add.getByLabel("מספור").fill("10");
      await add.getByRole("radio", { name: "פתוחה" }).click();
      await add.getByLabel("השאלה").fill("מה ההבדל בין Fictazole ל-Placebrin (בדויות) בפינוי?");
      await add.getByRole("button", { name: "לשמור" }).click();
      await page.getByText("שאלה 10 נוספה.").first().waitFor({ timeout: 10000 });
      const q10 = byLabel(EID, "10");
      expect(q10 && q10.form === "open" && q10.options.length === 0, "study_exam_item_add: an open item, after its page's last");
      await rowOf("10").first().waitFor({ timeout: 10000 });
      // להוציא את השאלה, then להחזיר.
      card = await openItem("10");
      await card.getByRole("button", { name: "⋯ עוד" }).click();
      await card.getByRole("button", { name: "להוציא את השאלה" }).click();
      expect(norm(await card.locator(".ss-retire").innerText()).includes("להוציא את שאלה 10 מהדף?"), "retire asks first");
      await card.locator(".ss-retire").getByRole("button", { name: "להוציא" }).click();
      await page.getByText("שאלה 10 הוצאה מהדף.").first().waitFor({ timeout: 10000 });
      expect(Boolean(byLabel(EID, "10").retired_at), "study_exam_item_retire");
      await page.locator(".ss-retired summary").click();
      await shot("forms-retired");
      await page.locator(".ss-retired").getByRole("button", { name: "להחזיר" }).click();
      await page.getByText("שאלה 10 חזרה לדף.").first().waitFor({ timeout: 10000 });
      expect(!byLabel(EID, "10").retired_at, "להחזיר: study_exam_item_unretire");
      // The wide review: a box drawn on the page with "לסמן".
      await page.setViewportSize(DESK);
      await page.locator(".exam-review.is-wide").waitFor({ timeout: 10000 });
      card = await openItem("6");
      await card.getByRole("button", { name: "⋯ עוד" }).click();
      await card.getByRole("button", { name: "לסמן איור" }).click();
      const draw = card.locator(".se-draw");
      await draw.waitFor({ timeout: 10000 });
      await page.waitForFunction(() => [...document.querySelectorAll(".se-draw .pv-sheet img")].some((i) => i.complete && i.naturalWidth > 1), null, { timeout: 15000 });
      const before6 = byLabel(EID, "6").figures.length;
      await draw.getByRole("button", { name: "לסמן", exact: true }).click();
      await draw.locator(".pv-scroll").scrollIntoViewIfNeeded();
      const vis = await draw.locator(".pv-scroll").boundingBox();
      const bb = await draw.locator(".pv-sheet").boundingBox();
      const y0 = Math.max(bb.y, vis.y) + 20;
      await page.mouse.move(bb.x + bb.width * 0.2, y0);
      await page.mouse.down();
      await page.mouse.move(bb.x + bb.width * 0.5, y0 + 120, { steps: 6 });
      await page.mouse.up();
      const seText = norm(await card.locator(".se").innerText());
      expect(seText.includes(`איור ${before6 + 1}`), `לסמן: a drag draws a box (${before6}; ${await draw.getByRole("button", { name: "לסמן", exact: true }).getAttribute("aria-pressed")}; ${JSON.stringify(bb)} ${JSON.stringify(vis)}; ${seText.slice(seText.indexOf("איור"), seText.indexOf("איור") + 80)})`);
      await page.screenshot({ path: path.join(out, "forms-draw-desktop.png"), fullPage: true });
      await card.locator(".se").getByRole("button", { name: "לשמור" }).click();
      await page.getByText("התיקון נשמר.").first().waitFor({ timeout: 10000 });
      await shot("forms-review-desktop");
      expect(byLabel(EID, "6").figures.length === before6 + 1, `the drawn box is saved (${byLabel(EID, "6").figures.join(" ")})`);
      await page.setViewportSize(PHONE);
      // The lecture page's row lists the sheet.
      await go(`/?v=lecture&l=${LEC}`);
      await page.locator(".sl a", { hasText: "sheet 3" }).waitFor({ timeout: 20000 });
      expect(true, "the lecture page's row lists the sheet");
      await shot("forms-lecture-row");

      /* ── 5. practice as on paper ── */
      await go(`/?v=practice&s=e.${EID}&n=all`);
      await page.locator(".pq").first().waitFor({ timeout: 15000 });
      const total = Number(norm(await page.locator(".pq-pos").innerText()).split("/")[1]);
      steps.practiceTotal = total;
      const at = async () => {
        const art = page.locator("article.pq").first();
        const t = norm(await art.innerText());
        return t;
      };
      const next = async () => {
        await page.locator(".pq-next").click();
        await page.waitForTimeout(250);
      };
      let seen3b = false;
      let seen4 = false;
      let seen3c = false;
      for (let i = 0; i < total; i++) {
        await page.locator("article.pq").first().waitFor({ timeout: 10000 });
        const t = await at();
        if (t.includes("חשבו את זמן מחצית החיים של Placebrin")) {
          // 3ב: a part of a multi-part question, its case folded after 3א was answered.
          expect(t.includes("סעיף ב׳ מתוך 3") && (await page.locator(".sa-stem-fold").count()) === 1, "3ב in practice: סעיף ב׳ מתוך 3, the shared case folded");
          await page.getByLabel(/^התשובה/).fill("3,0");
          await shot("forms-practice-numeric", { primary: ".ph-foot .a-btn.primary" });
          await page.getByRole("button", { name: "לבדוק", exact: true }).click();
          await page.locator(".sa-verdict", { hasText: "✓ נכון · 3 שעות" }).waitFor({ timeout: 10000 });
          const row3b = db.practice.answers.filter((a) => a.question_id === byLabel(EID, "3ב").id).pop();
          expect(row3b && row3b.value === 3 && row3b.correct === true && row3b.mode === "exam", "a comma is a decimal point: ✓, an answer row with its value (OD7)");
          await page.locator(".sa-sol summary").click();
          expect(norm(await page.locator(".sa-sol").innerText()).includes("בטווח של ±1%"), "פתרון מלא with the tolerance");
          seen3b = true;
          await noSideScroll("forms-practice-numeric");
          await next();
        } else if (t.includes("נפח הפיזור של Stubamide")) {
          await page.getByLabel(/^התשובה/).fill("−200");
          await page.getByRole("button", { name: "לבדוק", exact: true }).click();
          await page.locator(".sa-verdict", { hasText: "✗ התשובה: 200 מ״ג" }).waitFor({ timeout: 10000 });
          const row4 = db.practice.answers.filter((a) => a.question_id === byLabel(EID, "4").id).pop();
          expect(row4 && row4.value === -200 && row4.correct === false, "the typographic minus: -200, ✗ התשובה: 200 מ״ג");
          seen4 = true;
          await next();
        } else if (t.includes("הסבירו מדוע ריכוז התרופה אינו יורד")) {
          // 3ג: an open part; the draft stays on the device through a reload.
          await page.getByLabel("התשובה שלך").fill("בכל שעה יורד חלק קבוע");
          await page.reload();
          await page.locator(".sa").first().waitFor({ timeout: 15000 });
          expect((await page.getByLabel("התשובה שלך").inputValue()) === "בכל שעה יורד חלק קבוע", "an open answer's draft survives a reload (on the device only)");
          expect(!JSON.stringify(M.calls).includes("בכל שעה יורד חלק קבוע"), "the draft is never sent");
          await shot("forms-practice-open", { primary: ".ph-foot .a-btn.primary" });
          await page.getByRole("button", { name: "להראות פתרון" }).click();
          await page.locator(".sa-rubric").waitFor({ timeout: 10000 });
          expect((await page.locator(".sa-rubric li").count()) === 2, "להראות פתרון: the model answer and its rubric");
          await page.getByRole("radio", { name: "צדקתי" }).click();
          await page.locator(".pq-next").waitFor({ timeout: 10000 });
          const q3c = byLabel(EID, "3ג");
          expect(M.openMarks.some((m) => m.question_id === q3c.id && m.self_mark === 2) && !db.practice.answers.some((a) => a.question_id === q3c.id), "צדקתי: the member's own mark, never an answer row (OD8)");
          seen3c = true;
          await noSideScroll("forms-practice-open");
          await next();
        } else if ((await page.locator(".sa").count()) > 0) {
          // Another open or numeric item: skip it.
          await page.getByRole("button", { name: "לדלג" }).click();
          await page.waitForTimeout(250);
        } else {
          if (t.includes("לפי הטבלה")) expect((await page.locator("article.pq .sheet-table table").count()) === 1, "a table in practice, as printed");
          await page.locator(".pq-dont-know").click();
          await page.locator(".pq-next").waitFor({ timeout: 10000 });
          await next();
        }
        if (await page.locator(".pq-end, .practice-end").count()) break;
      }
      expect(seen3b && seen4 && seen3c, "the round asked 3ב, 4 and 3ג");

      /* ── 6. open-add on a past exam ── */
      const exam = M.seedRead({ course: COURSE, title: "מועד א׳ 2023" });
      await go(`/?v=exams&e=${exam.id}&c=${CID}`);
      const addBtn = page.locator(".ss-openadd");
      await addBtn.waitFor({ timeout: 15000 });
      const addText = norm(await addBtn.innerText());
      expect(/^להעתיק גם 2 שאלות פתוחות · כ-\$\d+\.\d\d$/.test(addText) && calls("op exam_read").some((c) => c.body.action === "open_add" && c.body.dry === true), `the price first (dry): ${addText}`);
      await shot("forms-openadd");
      await addBtn.click();
      await page.locator(".ss-extra").waitFor({ timeout: 10000 });
      const states = [];
      await until(async () => {
        states.push(exam.status);
        return items(exam.id).filter((q) => q.form === "open" || q.form === "numeric").length === 2 && M.units.filter((u) => u.exam_id === exam.id && u.extra).every((u) => u.status === "done");
      }, "open-add's units", 30000);
      expect(states.every((s) => s === "ready"), "the exam stays ready while open-add runs");
      await page.reload();
      await page.locator(".ss-extra", { hasText: "הועתקו גם 2 שאלות פתוחות." }).waitFor({ timeout: 15000 });
      expect((await page.locator(".ss-openadd").count()) === 0 && exam.skipped_open === 0, "copied: no button, nothing skipped");

      /* ── 7. the budget pause ── */
      const held = db.sheetsMock.seed({ course: COURSE, title: "דף בלי תשובות", lecture: null, images: clean.slice(1), forms: true, keySource: "none", pause: true });
      await go(`/?v=exams&e=${held.id}&c=${CID}`);
      const pause = page.locator(".ss-paused");
      await pause.waitFor({ timeout: 15000 });
      expect(norm(await pause.innerText()).includes("נעצר: נגמר התקציב החודשי."), "a held sheet: נעצר: נגמר התקציב החודשי.");
      await shot("forms-paused");
      await noSideScroll("forms-paused");
      M.sheetsCap = true;
      await pause.getByRole("button", { name: "להמשיך" }).click();
      await page.getByText("התקציב החודשי עוד לא מספיק להמשך.", { exact: false }).first().waitFor({ timeout: 10000 });
      expect(held.status === "reading", "להמשיך while the line is spent: refused, still held");
      M.sheetsCap = false;
      await pause.getByRole("button", { name: "לסיים בלי תשובות מוצעות" }).click();
      await until(() => held.status === "ready", "the held sheet finishing", 20000);
      await page.locator(".r-sum").waitFor({ timeout: 20000 });
      expect(calls("op exam_read").some((c) => c.body.examId === held.id && c.body.action === "resume" && c.body.skipSolve === true), "לסיים בלי תשובות מוצעות: resume with skipSolve");

      /* ── 8. a topic session never asks an open or numeric item ── */
      // The past exam's first item (never answered) and its two copied open and numeric items.
      const topicItems = [items(exam.id)[0], ...items(exam.id).filter((q) => q.form === "open" || q.form === "numeric")];
      expect(topicItems.length === 3 && topicItems.every((q) => q.has_key), "three keyed items on one topic");
      for (const q of topicItems) q.topic = "פרמקוקינטיקה בדויה";
      await go(`/?v=practice&s=t.${encodeURIComponent("פרמקוקינטיקה בדויה")}&n=all`);
      await page.locator(".pq").first().waitFor({ timeout: 15000 });
      expect(norm(await page.locator(".pq-pos").innerText()) === "1/1" && (await page.locator(".sa").count()) === 0, "a topic session: the choice item only (plainOnly)");
    }
  } catch (e) {
    ok.push(`FAIL: ${e.message}`);
    if (page) await page.screenshot({ path: path.join(out, "forms-fail.png"), fullPage: true }).catch(() => undefined);
  }
  await browser.close();
  clearInterval(M.timer);
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
