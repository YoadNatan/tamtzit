// Uploaded sheets, release A0 (docs/study/sheets.md; design-exams §5, §12;
// section O 1, VITE_STUDY_SHEETS) on the shared mock, with the synthetic
// exercise sheet only (fixtures/sheet/sheet6.json, made into files by
// fixtures/make-sheet.cjs: a text PDF with a cover page, a 2-page answers
// file, 6 photos with one turned and one blurred). Never real course material.
//   1. Help: "מבחנים ותרגילים" says what may be uploaded (OD6) and that the
//      pages are read by the AI services the app uses (OD5, a line, not a gate).
//   2. The course page: one segment "מבחנים ותרגילים", the upload first, the
//      empty line.
//   3. The phone upload from a lecture's link (new=sheet&l=): step 1 is the
//      two tiles and the Word line, nothing about where the pages go; a Word
//      file dropped is refused with its line; the PDF: "דף תרגילים" chosen,
//      the name from the file's ("sheet 3"), the lecture chosen, the cover
//      offered and left out (5 pages, its ID line never sent), the price on
//      the button; the sheet is study_sheet_create's (kind sheet, its
//      lecture, the answers marked), its pages uploaded and handed over.
//   4. The reading and the review on a phone: the counts, "4 שאלות פתוחות
//      דולגו.", "לתרגל כמו בדף", no simulation and no "לא לכלול בחישוב
//      הנושאים"; the exactness check ($0): an item whose copy is not in its
//      page's text is "לבדוק מול הדף" with "ההעתקה שונה מהטקסט בקובץ".
//   5. The wide review at 820 (iPad upright) and 1440: two columns, the text
//      on the right and the page on the left, the page's picture; the figure's
//      box opens its item; ArrowDown the next item, E "לתקן טקסט"; Enter
//      confirms nothing (no key change); under 760 the list as on a phone.
//   6. A computer (1440): the upload's two columns, a PDF dropped (a past exam
//      by default from new=1, switched to a sheet), the cover kept (6 pages),
//      "בקובץ נפרד" and the answers file dropped: "זה קובץ התשובות?" → "כן",
//      no lecture (a question bank); photos pasted (Ctrl+V): 6 pages, the
//      blurred one flagged with "לצלם שוב".
//   7. Keying by hand: the true/false item without a key, each statement
//      (study_exam_key_set with p_seq), then "לבטל" brings it back.
//   8. "לתרגל כמו בדף": a wrong pick, and after the answer the options stay
//      in the printed order (D10), the right one and the pick marked in place.
//   9. The simulation takes past exams only (OD9): the setup lists the exam,
//      never a sheet, even with the sheet's id in the address.
//  10. The course page with both kinds: "מבחנים קודמים" and "דפי תרגילים",
//      a sheet's lecture under its title, the head's counts.
//  11. A link opened with no member on the device (OD14): the landing card,
//      its two lines on how to open the app, the personal code, and the
//      sign-in lands on the same sheet. The join screen alone has no card.
//  12. Refusals in a sheet's words: the switch off (study_sheet_create
//      "off"), the sheets line spent (402 sheets_cap).
//  13. 320, 390, 820 and 1440 px, light and dark: no sideways scroll on the
//      course page, the upload with pages and the review; the a11y check on each.
// Without VITE_STUDY_SHEETS (any other set: "ps", "s2") it checks that nothing
// of it shows: a sheet in the data is never listed and never a simulation,
// the upload is past exams' own, an upload's link opened signed out has no
// card, and study_sheet_create is never called.
//
// Release A1's build (VITE_STUDY_SHEETS_FORMS, flag set "o") reads a sheet
// with the sheet reader: its flows are e2e/study/sheets-forms.cjs.
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=o0 node e2e/study/sheets.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { makeSheetFiles, pageShots, SHEET } = require("./fixtures/make-sheet.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: E2E_FLAGS=o0 node e2e/study/sheets.cjs <dist> <out dir>");
  process.exit(2);
}
if (flagSetOf().sheetForms) {
  console.error("sheets.cjs is release A0's (E2E_FLAGS=o0); release A1 (o) is e2e/study/sheets-forms.cjs");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const norm = (s) => String(s).replace(/[⁦-⁩‎‏]/g, "").replace(/\s+/g, " ").trim();
const CODE = "ABCD-EFGH-JKLM-NPQR";
const PHONE = { width: 390, height: 844 };
const IPAD = { width: 820, height: 1180 };
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
  /** No sideways scroll at 320, 390, 820 and 1440 px, light and dark; a screenshot of each at 320, 820 and 1440. */
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
  /** Files into the page as File objects, then dropped on a selector, or pasted (Ctrl+V). */
  const fileData = (paths) =>
    paths.map((p) => ({
      name: path.basename(p),
      type: p.endsWith(".pdf") ? "application/pdf" : p.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "image/jpeg",
      b64: fs.readFileSync(p).toString("base64"),
    }));
  const dropOn = async (sel, paths) =>
    page.evaluate(
      ({ sel, files }) => {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
        const el = document.querySelector(sel);
        el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
        el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      },
      { sel, files: fileData(paths) },
    );
  const paste = async (paths) =>
    page.evaluate(
      ({ files }) => {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
        document.body.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      },
      { files: fileData(paths) },
    );
  const sheetCalls = () => M.calls.filter((c) => c.fn === "study_sheet_create").length;
  const items = (eid) => db.practice.questions.filter((q) => q.exam_id === eid).sort((a, b) => a.exam_no - b.exam_no);
  const rowOf = (no) => page.locator(".r-head", { hasText: new RegExp(`שאלה ${no}(?!\\d)`) });

  try {
    await open("שוהם", "/?v=library");
    await page.waitForTimeout(800);
    const course = db.coursesMock?.rows.find((r) => r.name === COURSE);
    expect(Boolean(course), "the course row exists");
    const CID = course.id;
    const files = await makeSheetFiles(browser, path.join(out, "files"));
    const clean = await pageShots(browser, path.join(out, "files"));
    const word = path.join(out, "files", "sheet-3.docx");
    fs.writeFileSync(word, Buffer.from("PK\u0003\u0004 a synthetic Word file"));

    if (!flags.sheets) {
      /* ── Nothing of uploaded sheets without the flag ── */
      const exam = M.seed({ course: COURSE, title: "מועד א׳ 2024", n: 20 });
      const sheet = db.sheetsMock.seed({ course: COURSE, title: "דף שלא מופיע", lecture: LEC, images: clean.slice(1) });
      if (flagSetOf().exams) {
        await go(`/?v=course&c=${CID}&seg=exams`);
        await page.getByRole("tab", { name: "מבחנים קודמים" }).waitFor({ timeout: 15000 });
        const text = norm(await page.locator("main").innerText());
        expect(!text.includes("מבחנים ותרגילים") && !text.includes("דף שלא מופיע") && !text.includes("דפי תרגילים") && text.includes("מועד א׳ 2024"), "the course page: past exams only, the sheet never listed");
        expect(!norm(await page.locator(".ph-sub").first().innerText()).includes("דף"), "the head counts no sheet");
        await go(`/?v=exams&new=sheet&c=${CID}&l=${LEC}`);
        await page.getByRole("heading", { level: 1, name: "העלאת מבחן קודם" }).waitFor({ timeout: 15000 });
        expect(true, "new=sheet opens past exams' own upload");
        await go(`/?v=mock&c=${CID}&e=${sheet.id}`);
        await page.getByRole("heading", { level: 1, name: "סימולציה" }).waitFor({ timeout: 15000 });
        const srcs = (await page.locator(".s-src").allInnerTexts()).map(norm);
        expect(srcs.length === 1 && srcs[0].includes(exam.title), `the simulation lists the exam only (${srcs.join(" | ")})`);
      }
      // An upload's link signed out: the join screen without the card.
      const { page: fresh, ctx: fctx } = await mock.open(browser, null, { path: `/?v=exams&e=${sheet.id}&c=${CID}` });
      await fresh.locator(".code-input").waitFor({ timeout: 15000 });
      await fresh.waitForTimeout(500);
      expect((await fresh.locator(".join-deep").count()) === 0, "an upload's link signed out: no landing card");
      await fctx.close();
      expect(sheetCalls() === 0, "no call of study_sheet_create");
    } else {
      /* ── 1. help ── */
      await go("/?v=help");
      await page.getByText("מבחנים ותרגילים", { exact: true }).first().waitFor({ timeout: 15000 });
      await page.locator("details", { hasText: "מבחנים ותרגילים" }).first().locator("summary").click();
      const help = norm(await page.locator("details", { hasText: "מבחנים ותרגילים" }).first().innerText());
      expect(help.includes("מעלים רק חומר מצוות הקורס או חומר של הקבוצה."), "help: only course-staff material and the group's own (OD6)");
      expect(help.includes("הדפים שמעלים נקראים בשירותי הבינה המלאכותית שהאפליקציה משתמשת בהם."), "help: the providers line (OD5)");

      /* ── 2. the course page, empty ── */
      await go(`/?v=course&c=${CID}&seg=exams`);
      await page.getByRole("tab", { name: "מבחנים ותרגילים" }).waitFor({ timeout: 15000 });
      await page.getByText("עוד אין כאן מבחנים או דפי תרגילים. מעלים PDF או צילום, ואז אפשר לתרגל אותם כמו בדף.").waitFor({ timeout: 15000 });
      expect((await page.getByRole("link", { name: "העלאת מבחן או דף תרגילים" }).count()) === 1, "the course page: one segment, the upload first, the empty line");
      await shot("sheets-course-empty");

      /* ── 3. the phone upload from a lecture's link ── */
      await go(`/?v=exams&new=sheet&c=${CID}&l=${LEC}`);
      await page.getByRole("heading", { level: 1, name: "העלאת מבחן או דף תרגילים" }).waitFor({ timeout: 15000 });
      const step1 = norm(await page.locator("main").innerText());
      expect(step1.includes("קובץ PDF") && step1.includes("לצלם דפים") && step1.includes("קובץ Word? צריך קודם לשמור אותו כ-PDF."), "step 1: the two tiles and the Word line");
      for (const said of ["לאן", "Claude", "OpenAI", "בינה המלאכותית", "פרטיות"]) expect(!step1.includes(said), `no sentence about where the pages go (${said})`);
      expect((await page.locator(".ph-foot .a-btn.primary").count()) === 0, "no button before a page");
      await shot("sheets-upload-step1");
      await dropOn(".sx-zone", [word]);
      await page.locator("#sx-err-file", { hasText: "קובץ Word? צריך קודם לשמור אותו כ-PDF." }).waitFor({ timeout: 10000 });
      expect((await page.locator(".sx-pages").count()) === 0, "a Word file dropped: its line, no page");
      await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles(files.pdf);
      await page.locator(".sx-pages").first().waitFor({ timeout: 60000 });
      expect((await page.getByRole("radio", { name: "דף תרגילים" }).getAttribute("aria-checked")) === "true", "from a lecture's link the kind is דף תרגילים");
      expect((await page.getByRole("textbox", { name: "שם" }).inputValue()) === "sheet 3", "the name from the file's (sheet-3.pdf → sheet 3)");
      expect((await page.getByRole("combobox", { name: "הרצאה (לא חובה)" }).inputValue()) === LEC, "the lecture of the link is chosen");
      await page.locator(".sx-cover").waitFor({ timeout: 10000 });
      expect(norm(await page.locator(".sx-cover").innerText()).includes("עמוד 1 נראה כמו דף שער, עם שם או ת״ז."), "the cover page is offered to leave out");
      await page.getByRole("button", { name: "להוריד אותו" }).click();
      await page.locator(".sx-cover-off").waitFor({ timeout: 5000 });
      expect(norm(await page.locator(".sx-count").innerText()).startsWith("5 עמודים"), "the cover left out: 5 pages");
      expect(await page.getByLabel("מסומנות על הדף").isChecked(), "the answers: marked on the page by default");
      // The synthetic sheet's answers are a file of their own: "בקובץ נפרד", "להוסיף קובץ".
      await page.getByLabel("בקובץ נפרד").check();
      await page.locator('input[type=file][accept="application/pdf,.pdf,image/*"]').setInputFiles(files.answersPdf);
      await page.getByRole("list", { name: "קובץ התשובות, לפי הסדר" }).waitFor({ timeout: 60000 });
      const btn = page.locator(".ph-foot .a-btn.primary");
      const label = norm(await btn.innerText());
      expect(/^להעלות ולהעתיק · כ-\$\d+\.\d\d$/.test(label), `the price on the button before anything is sent: ${label}`);
      expect(norm(await page.locator(".x-cost-note").innerText()).startsWith("7 עמודים · לרוב"), "under it: the pages (5 and the answers file's 2) and the minutes");
      const upText = norm(await page.locator("main").innerText());
      for (const said of ["Claude", "OpenAI", "בינה המלאכותית"]) expect(!upText.includes(said), `with pages: nothing about where the pages go (${said})`);
      await shot("sheets-upload-phone", { primary: ".ph-foot .a-btn.primary" });
      await noSideScroll("sheets-upload-phone");
      await btn.click();
      await page.waitForURL(/v=exams&e=/, { timeout: 90000 });
      const EID = new URL(page.url()).searchParams.get("e");
      steps.sheet = EID;
      const ex = M.exams.find((e) => e.id === EID);
      expect(ex.kind === "sheet" && ex.title === "sheet 3" && ex.lecture_id === LEC && ex.key_source === "separate" && ex.hide_from_profile === true, `study_sheet_create: kind sheet, "sheet 3", its lecture, the answers apart (${JSON.stringify({ kind: ex.kind, title: ex.title, lecture: ex.lecture_id === LEC, ks: ex.key_source })})`);
      const op = M.calls.find((c) => c.fn === "op exam_read" && c.body.examId === EID && !c.body.action);
      expect(op && op.body.pages.length === 7 && op.body.pages.slice(0, 5).every((x) => !x.key) && op.body.pages.slice(5).every((x) => x.key), `7 pages handed over: the 5 without the cover, then the answers file's 2 (${op?.body.pages.length})`);
      const sent = op.body.pages.flatMap((x) => x.lines).join(" ");
      expect(!/ת[.״"]?ז|תעודת זהות|מספר סטודנט/.test(sent), "the cover's lines (name, ID) are never sent");
      expect(op.body.pages[0].lines.some((l) => l.includes("Mockazepam") || l.length > 10), "a text PDF's lines go with its pages");
      expect([...Array(7)].every((_, i) => db.files.has(`${db.group.id}/exams/${EID}/p${i + 1}.jpg`)), "every page uploaded to <group>/exams/<sheet>/p<n>.jpg");

      /* ── 4. the reading and the review on a phone ── */
      const prog = await page.locator(".x-prog").first().innerText({ timeout: 5000 }).catch(() => "");
      steps.reading = norm(prog);
      if (prog) await shot("sheets-reading");
      await until(() => ex.status === "ready", "the sheet's reading", 30000);
      await page.locator(".r-sum").waitFor({ timeout: 20000 });
      const its = items(EID);
      const nums = (await page.locator(".r-sum .nums b").allInnerTexts()).map(Number);
      steps.review = nums;
      expect(its.length === 6 && nums[0] === 6 && nums[1] === 4 && nums[0] === nums[1] + nums[2], `the exam reader's 6 choice items (the 8-option one refused); 4 keyed by the answers file, the true/false and match ones to key by hand (${nums.join(", ")})`);
      const sum = norm(await page.locator(".r-sum").innerText());
      expect(sum.includes("4 שאלות פתוחות דולגו."), "the 4 open and numeric items are counted, not copied");
      expect((await page.getByRole("link", { name: "לתרגל כמו בדף" }).count()) === 1, "לתרגל כמו בדף");
      expect((await page.getByRole("link", { name: "סימולציה מהמבחן" }).count()) === 0 && (await page.locator(".r-hide").count()) === 0, "a sheet: no simulation, no ״לא לכלול בחישוב הנושאים״");
      expect((await page.locator(".exam-review.is-wide").count()) === 0, "390 px: the list as on a phone");
      await page.getByRole("radio", { name: /^הכל/ }).click();
      expect((await page.locator(".r-head .a-chip", { hasText: "לבדוק מול הדף" }).count()) === 0, "the exam reader's copies are all in their pages' text");
      await shot("sheets-review-phone");
      await noSideScroll("sheets-review-phone");
      // A copy that is not in its page's text: "לבדוק מול הדף" (D9, $0).
      const q5 = its.find((q) => q.exam_no === 5);
      const was5 = { question: q5.question, options: q5.options };
      // A misread copy: none of it in the page's text (the check takes the question and its options together).
      q5.question = "מה מנגנון הפעולה של Fakeolol בכליה, ומה הסיבוך הנפוץ ביותר שלו בטיפול ממושך?";
      q5.options = ["חסימת תעלות נתרן בצינורית", "עלייה ברמת האשלגן בדם", "ירידה בסינון הכלייתי", "פריחה בעור אחרי שבוע"];
      await page.reload();
      await page.locator(".r-sum").waitFor({ timeout: 15000 });
      await page.getByRole("radio", { name: /^לבדיקה/ }).click();
      await rowOf(5).locator(".a-chip", { hasText: "לבדוק מול הדף" }).waitFor({ timeout: 10000 });
      await rowOf(5).click();
      await page.locator(".r-item .r-exact").waitFor({ timeout: 10000 });
      expect(norm(await page.locator(".r-item .r-exact").innerText()) === "ההעתקה שונה מהטקסט בקובץ · כדאי לבדוק מול העמוד.", "a copy not in its page's text: לבדוק מול הדף, ההעתקה שונה מהטקסט בקובץ");
      await shot("sheets-review-inexact");
      Object.assign(q5, was5);
      await page.reload();
      await page.locator(".r-sum").waitFor({ timeout: 15000 });

      /* ── 5. the wide review: 820 and 1440 ── */
      for (const [dev, vp] of [
        ["ipad", IPAD],
        ["desktop", DESK],
      ]) {
        await page.setViewportSize(vp);
        await page.locator(".exam-review.is-wide").waitFor({ timeout: 10000 });
        await page.getByRole("radio", { name: /^הכל/ }).click();
        const cols = await page.evaluate(() => {
          const t = document.querySelector(".rw-text").getBoundingClientRect();
          const p = document.querySelector(".rw-page").getBoundingClientRect();
          return { text: [Math.round(t.left), Math.round(t.right)], page: [Math.round(p.left), Math.round(p.right)] };
        });
        expect(cols.text[0] >= cols.page[1] - 1, `${dev}: two columns, the text on the right, the page on the left (${JSON.stringify(cols)})`);
        await page.waitForFunction(() => [...document.querySelectorAll(".pv-sheet img")].some((i) => i.complete && i.naturalWidth > 1), null, { timeout: 15000 });
        expect(true, `${dev}: the page's picture beside the copy`);
        // The figure's box opens its item.
        const q6 = items(EID).find((q) => q.exam_no === 6);
        const p6 = Number(/^pg:(\d+):/.exec(q6.figure)[1]);
        for (let i = 0; i < 6 && norm(await page.locator(".pv-at").innerText()) !== `עמוד ${p6} מתוך 5`; i++) await page.getByRole("button", { name: "העמוד הבא" }).click();
        const box = page.getByRole("button", { name: `שאלה 6, עמוד ${p6}` });
        await box.waitFor({ timeout: 10000 });
        await box.click();
        await page.locator(".r-item", { hasText: "שאלה 6" }).waitFor({ timeout: 10000 });
        expect((await box.getAttribute("aria-pressed")) === "true", `${dev}: the figure's box (page ${p6}) opens question 6`);
        await shot(`sheets-review-${dev}`);
        // The keys: ArrowDown the next item, E "לתקן טקסט"; Enter confirms nothing. The focus is on the
        // opened item's heading, as opening it leaves it (the a11y pass above walked the page with Tab).
        await page.locator(".r-item b[id^=ri-]").focus();
        await page.keyboard.press("ArrowDown");
        await page.locator(".r-item b[id^=ri-]", { hasText: "שאלה 7" }).waitFor({ timeout: 10000 });
        expect(true, `${dev}: ArrowDown opens the next item (שאלה 7)`);
        const logBefore = M.keyLog.length;
        const keysBefore = JSON.stringify([...db.practice.keys.entries()].filter(([id]) => items(EID).some((q) => q.id === id)));
        await page.keyboard.press("Enter");
        await page.locator("body").click({ position: { x: 5, y: 5 } });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);
        const keysAfter = JSON.stringify([...db.practice.keys.entries()].filter(([id]) => items(EID).some((q) => q.id === id)));
        expect(M.keyLog.length === logBefore && keysAfter === keysBefore, `${dev}: Enter confirms nothing (no key changed)`);
        await page.keyboard.press("ArrowUp");
        await page.locator(".r-item b[id^=ri-]", { hasText: "שאלה 6" }).waitFor({ timeout: 10000 });
        await page.keyboard.press("KeyE");
        await page.locator(".r-item .r-edit").waitFor({ timeout: 10000 });
        expect(true, `${dev}: ArrowUp back, E opens ״לתקן טקסט״`);
        await page.screenshot({ path: path.join(out, `sheets-review-${dev}-edit.png`) });
        await page.locator(".r-item").getByRole("button", { name: "ביטול" }).click();
        await page.locator(".r-item").getByRole("button", { name: /^לסגור את שאלה/ }).click();
      }
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(300);
      expect((await page.locator(".exam-review.is-wide").count()) === 0, "back under 760 px: the phone's list");

      /* ── 6. a computer: drop, the answers file, paste ── */
      await open("שוהם", `/?v=exams&new=1&c=${CID}`, { viewport: DESK });
      await page.getByRole("heading", { level: 1, name: "העלאת מבחן או דף תרגילים" }).waitFor({ timeout: 15000 });
      await shot("sheets-upload-desktop-step1");
      await dropOn(".sx-zone", [files.pdf]);
      await page.locator(".sx-pages").first().waitFor({ timeout: 60000 });
      expect((await page.getByRole("radio", { name: "מבחן קודם" }).getAttribute("aria-checked")) === "true", "a PDF dropped; new=1 starts as a past exam");
      const twoCols = await page.evaluate(() => {
        const f = document.querySelector(".sx-files").getBoundingClientRect();
        const d = document.querySelector(".sx-details").getBoundingClientRect();
        return { files: [Math.round(f.left), Math.round(f.right)], details: [Math.round(d.left), Math.round(d.right)] };
      });
      expect(twoCols.details[0] >= twoCols.files[1] - 1, `1440: the details on the right, the pages on the left (${JSON.stringify(twoCols)})`);
      await page.getByRole("radio", { name: "דף תרגילים" }).click();
      expect((await page.getByRole("textbox", { name: "שם" }).inputValue()) === "sheet 3", "switched to a sheet: the name from the file's");
      await page.getByRole("button", { name: "להשאיר" }).click();
      expect(norm(await page.locator(".sx-count").innerText()).startsWith("6 עמודים") && (await page.locator(".sx-cover").count()) === 0, "the cover kept: 6 pages, the offer gone");
      await page.getByRole("combobox", { name: "הרצאה (לא חובה)" }).selectOption("");
      await page.getByLabel("בקובץ נפרד").check();
      await dropOn(".sx-zone", [files.answersPdf]);
      const ask = page.getByRole("alertdialog", { name: "זה קובץ התשובות?" });
      await ask.waitFor({ timeout: 10000 });
      await ask.getByRole("button", { name: "כן" }).click();
      await page.getByRole("list", { name: "קובץ התשובות, לפי הסדר" }).waitFor({ timeout: 60000 });
      expect(norm(await page.locator(".sx-count").innerText()).startsWith("6 עמודים"), "a second file dropped with ״בקובץ נפרד״: asked, and it is the answers file (the pages stay 6)");
      await shot("sheets-upload-desktop", { primary: ".ph-foot .a-btn.primary" });
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.waitForURL(/v=exams&e=/, { timeout: 90000 });
      const EID2 = new URL(page.url()).searchParams.get("e");
      const ex2 = M.exams.find((e) => e.id === EID2);
      const op2 = M.calls.find((c) => c.fn === "op exam_read" && c.body.examId === EID2 && !c.body.action);
      expect(ex2.kind === "sheet" && ex2.lecture_id === null && ex2.key_source === "separate", "a question bank: a sheet with no lecture, the answers apart");
      expect(op2.body.pages.length === 8 && op2.body.pages.slice(6).every((x) => x.key) && op2.body.pages.slice(0, 6).every((x) => !x.key), "8 pages handed over: 6, then the 2 of the answers file");
      await until(() => ex2.status === "ready", "the second sheet's reading", 30000);
      await page.locator(".r-sum").waitFor({ timeout: 20000 });
      // Photos pasted (Ctrl+V / ⌘V) on a new upload: 6 pages, the blurred one flagged.
      await go(`/?v=exams&new=sheet&c=${CID}`);
      await page.getByRole("heading", { level: 1, name: "העלאת מבחן או דף תרגילים" }).waitFor({ timeout: 15000 });
      await paste(files.photos);
      await page.locator(".sx-pages").first().waitFor({ timeout: 30000 });
      await page.locator(".sx-warn").waitFor({ timeout: 30000 });
      const warn = norm(await page.locator(".sx-warn").innerText());
      expect(norm(await page.locator(".sx-count").innerText()).startsWith("6 עמודים") && warn.includes(`עמוד ${files.blurred}`) && warn.includes("לצלם שוב"), `6 photos pasted, page ${files.blurred} flagged: ${warn}`);
      expect((await page.locator(".sx-warn li").count()) === 1, "only the blurred photo is flagged (the turned one is sharp)");
      await shot("sheets-upload-photos", { primary: ".ph-foot .a-btn.primary" });
      await noSideScroll("sheets-upload-photos");

      /* ── 7. keying a true/false item by hand ── */
      await open("נועה", `/?v=exams&e=${EID2}&c=${CID}`, { viewport: DESK });
      await page.locator(".r-sum").waitFor({ timeout: 15000 });
      await page.getByRole("radio", { name: /^הכל/ }).click();
      const tf = items(EID2).find((q) => q.form === "tf");
      const tfKey = db.practice.keys.get(tf.id);
      const before = { seq: tfKey.seq ?? null, origin: tfKey.origin ?? null };
      await rowOf(tf.exam_no).click();
      const card = page.locator(".r-item");
      await card.getByRole("button", { name: /^לסמן תשובה( אחרת)?$/ }).click();
      const groups = card.locator(".r-seq [role=radiogroup]");
      const n = await groups.count();
      const want = [...Array(n)].map((_, i) => (i % 2 ? 0 : 1));
      for (let i = 0; i < n; i++) await groups.nth(i).getByRole("radio", { name: want[i] ? "נכון" : "לא נכון", exact: true }).click();
      // (A plain screenshot: the a11y pass narrows the page under 760 px, which draws the review anew.)
      await page.screenshot({ path: path.join(out, "sheets-key-tf.png") });
      await card.getByRole("button", { name: "לשמור" }).click();
      await until(() => JSON.stringify(db.practice.keys.get(tf.id).seq) === JSON.stringify(want), "the statements keyed");
      const set = M.calls.filter((c) => c.fn === "study_exam_key_set").at(-1);
      expect(n === tf.options.length && set.body.p_answer === null && JSON.stringify(set.body.p_seq) === JSON.stringify(want) && db.practice.keys.get(tf.id).origin === "member", `the true/false item keyed statement by statement (${JSON.stringify(set.body)})`);
      await card.locator(".r-who", { hasText: "נועה" }).waitFor({ timeout: 10000 });
      await card.getByRole("button", { name: "לבטל" }).click();
      await until(() => (db.practice.keys.get(tf.id).origin ?? null) === before.origin, "the undo");
      expect(JSON.stringify(db.practice.keys.get(tf.id).seq ?? null) === JSON.stringify(before.seq), `"לבטל" brings the statements back (${JSON.stringify(before)})`);

      /* ── 8. "לתרגל כמו בדף": the printed order after the answer ── */
      await open("שוהם", `/?v=exams&e=${EID}&c=${CID}`);
      await page.locator(".r-sum").waitFor({ timeout: 15000 });
      await page.getByRole("link", { name: "לתרגל כמו בדף" }).click();
      await page.waitForURL(new RegExp(`s=e\\.${EID}`), { timeout: 15000 });
      await page.locator(".pq-options").waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      const one = items(EID).find((q) => q.exam_no === 1);
      const key1 = db.practice.keys.get(one.id).answer;
      const shown = async () => (await page.locator(".pq-options .pq-text").allInnerTexts()).map(norm);
      expect(JSON.stringify(await shown()) === JSON.stringify(one.options.map(norm)), "item 1 as printed");
      const wrong = (key1 + one.options.length - 1) % one.options.length;
      await page.locator(".pq-options .a-opt").nth(wrong).click();
      await page.getByRole("radio", { name: "על בטוח" }).click();
      await page.getByRole("button", { name: "לבדוק" }).click();
      await page.locator(".pq-verdict").waitFor({ timeout: 10000 });
      const after = (await page.locator(".pq-autopsy .pq-text").allInnerTexts()).map(norm);
      const marks = await page.locator(".pq-autopsy .a-opt").evaluateAll((els) => els.map((e) => (e.classList.contains("correct") ? "c" : e.classList.contains("wrong") ? "w" : "")));
      expect(JSON.stringify(after) === JSON.stringify(one.options.map(norm)), `after the answer the options stay as printed (D10): ${after.join(" | ")}`);
      expect(marks[key1] === "c" && marks[wrong] === "w", `the right one and the pick marked in place (${marks.join(",")})`);
      const ans = db.practice.answers.filter((a) => a.question_id === one.id).pop();
      expect(ans && ans.correct === false && ans.mode === "exam", "the answer is recorded (mode 'exam', wrong)");
      await shot("sheets-practice-printed");

      /* ── 9. the simulation takes past exams only ── */
      const exam = M.seed({ course: COURSE, title: "מועד א׳ 2024", n: 20 });
      await go(`/?v=mock&c=${CID}&e=${EID}`);
      await page.getByRole("heading", { level: 1, name: "סימולציה" }).waitFor({ timeout: 15000 });
      const srcs = (await page.locator(".s-src").allInnerTexts()).map(norm);
      expect(srcs.length === 1 && srcs[0].includes(exam.title) && !srcs.some((s) => s.includes("sheet 3")), `the simulation lists the past exam only, even with a sheet's id (${srcs.join(" | ")})`);
      expect((await page.locator(".s-src").first().getAttribute("aria-checked")) === "true", "the past exam is chosen");

      /* ── 10. the course page with both kinds ── */
      await go(`/?v=course&c=${CID}&seg=exams`);
      await page.locator(".c-uploads h2", { hasText: "דפי תרגילים" }).waitFor({ timeout: 15000 });
      const heads = (await page.locator(".c-uploads h2").allInnerTexts()).map(norm);
      expect(JSON.stringify(heads) === JSON.stringify(["מבחנים קודמים", "דפי תרגילים"]), `each kind under its heading: ${heads.join(" | ")}`);
      const lectureTitle = db.lectures.find((l) => l.id === LEC).title;
      const sheetRow = page.locator(".c-exam-row", { has: page.locator("b", { hasText: "sheet 3" }) });
      const rowTexts = (await sheetRow.allInnerTexts()).map(norm);
      expect(rowTexts.length === 2 && rowTexts.some((t) => t.includes(lectureTitle)) && rowTexts.some((t) => !t.includes(lectureTitle)), `a sheet's lecture under its title, a bank without (${rowTexts.join(" | ")})`);
      const sub = norm(await page.locator(".ph-sub").first().innerText());
      expect(sub.includes("מבחן קודם אחד") && sub.includes("2 דפי תרגילים"), `the head counts both kinds: ${sub}`);
      expect((await page.getByRole("link", { name: "סימולציה" }).count()) === 1, "סימולציה (a past exam is ready)");
      await shot("sheets-course");
      await noSideScroll("sheets-course");

      /* ── 11. the link opened with no member: the landing card ── */
      const shohamId = db.members[0].user_id;
      db.codes.on = true;
      db.codes.byUser.set(shohamId, { hash: CODE.replace(/-/g, ""), created_at: new Date().toISOString(), issued_by: shohamId, seen_at: new Date().toISOString(), replaced: false, used_at: null, uses: 0 });
      {
        const { page: bare, ctx: bctx } = await mock.open(browser, null, { path: "/?join=ABC123" });
        await bare.locator(".code-input").waitFor({ timeout: 15000 });
        await bare.waitForTimeout(400);
        expect((await bare.locator(".join-deep").count()) === 0, "the join screen alone: no landing card");
        await bctx.close();
      }
      if (context) await context.close();
      ({ page, ctx: context } = await mock.open(browser, null, { path: `/?v=exams&e=${EID}&c=${CID}` }));
      const card11 = page.locator(".join-deep");
      await card11.waitFor({ timeout: 15000 });
      const cardText = norm(await card11.innerText());
      expect(cardText.includes("הקישור נפתח בדפדפן, לא באפליקציה.") && cardText.includes("אין קוד אישי? הקישור הוא לחברי הקבוצה."), "the landing card: the browser line and the members line");
      await card11.getByRole("button", { name: "לפתוח את תמצית מהאייקון במסך הבית" }).click();
      expect((await card11.locator(".join-deep-how li").count()) === 2, "how to open the app from its icon: two lines");
      await shot("sheets-landing");
      await noSideScroll("sheets-landing");
      await card11.getByRole("button", { name: "להמשיך כאן: כניסה עם הקוד האישי" }).click();
      await page.getByRole("textbox", { name: "הקוד האישי" }).fill(CODE);
      await page.getByRole("button", { name: "כניסה", exact: true }).click();
      await page.locator(".r-sum").waitFor({ timeout: 20000 });
      const landed = new URL(page.url());
      expect(landed.searchParams.get("v") === "exams" && landed.searchParams.get("e") === EID && db.codes.redeems.filter((r) => r.found).length === 1, `the personal code lands on the same sheet (${landed.search})`);
      db.codes.on = false;

      /* ── 12. refusals in a sheet's words ── */
      await open("שוהם", `/?v=exams&new=sheet&c=${CID}`);
      await page.getByRole("heading", { level: 1, name: "העלאת מבחן או דף תרגילים" }).waitFor({ timeout: 15000 });
      await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles(files.pdf);
      await page.locator(".sx-pages").first().waitFor({ timeout: 60000 });
      M.sheetsOn = false;
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.locator(".sx-details .a-error", { hasText: "העלאת דפי תרגילים עוד לא פתוחה בקבוצה." }).waitFor({ timeout: 30000 });
      expect(true, "the switch off: העלאת דפי תרגילים עוד לא פתוחה בקבוצה.");
      M.sheetsOn = true;
      M.sheetsCap = true;
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.locator(".sx-details .a-error", { hasText: "התקציב לדפי תרגילים נגמר החודש. מתחדש ב-1 בחודש." }).waitFor({ timeout: 60000 });
      expect(true, "the sheets line spent (402 sheets_cap): התקציב לדפי תרגילים נגמר החודש.");
      M.sheetsCap = false;
      await shot("sheets-refused");
    }
  } catch (e) {
    ok.push(`FAIL: ${e.message}`);
    if (page) await page.screenshot({ path: path.join(out, "sheets-fail.png"), fullPage: true }).catch(() => undefined);
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
