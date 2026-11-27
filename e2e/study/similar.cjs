// Uploaded sheets' release B (docs/study/sheets.md; VITE_STUDY_SIMILAR,
// section O 3 with L 1) on the shared mock, with the synthetic sheet only
// (fixtures/sheet/sheet6.json: fictional drugs, no course material). No real
// host, no paid call: the op "similar" and its worker are played by
// mocks/similar.cjs. In order:
//   1. Help's "מבחנים ותרגילים" says how similar questions are made and checked.
//   2. "לתרגל כמו בדף", a wrong answer to item 1: "עוד שאלות כמוה" opens the
//      bottom sheet "שאלות כמו שאלה 1" with "ליצור 2 כמוה · כ-$…" (the op's
//      plan, nothing reserved); the start says make: true; the run goes on
//      while practising; one of the two is dropped by the check ("נוצרה שאלה
//      אחת · אחת לא עברה בדיקה", the polite line); "לתרגל עכשיו" asks the
//      twin right after it, with its chip "דומה לשאלה 1 ב… · נבדקה" and the
//      peek at its source (read only).
//   3. Joined: another member's run on item 6 is making them; a wrong answer
//      there says "כבר מכינים שאלות כמו זו", and its twins join the round when
//      it ends. Existing twins first: in a new round item 1's twin is offered
//      free ("שאלה דומה אחת · לתרגל", no start).
//   4. Refusals in the row's words: the similar line (402 similar_cap), the
//      daily taps (429), an item with 6 twins (no "עוד שאלות כמוה", only its
//      twins), the switch off (no offer at all).
//   5. The end of the sheet's round: "שאלות דומות לכל הדף · כ-$…", one for each
//      question without one; started, then "נוצרו N שאלות דומות · לפתור" to
//      the sheet's practice set (L's set page, kind sheet, its author line);
//      on "סטים של הקבוצה"; the requester's similar_ready and the group's
//      set_shared; solving the set (s=k.) shows the twin's chip and offers
//      more after a wrong answer; the review's "⋯" then says "היום כבר נוצרו
//      שאלות דומות לדף הזה" (once a day).
//   6. 390, 820 and 1440 px, light and dark, no sideways scroll (320 too);
//      the a11y check on every screen. problems: [], a11y: [].
// Without VITE_STUDY_SIMILAR (set "o"): a wrong answer offers nothing, the
// review has no "⋯", and the op "similar" is never called.
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=os node e2e/study/similar.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { pageShots } = require("./fixtures/make-sheet.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: E2E_FLAGS=os node e2e/study/similar.cjs <dist> <out dir>");
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
  const S = db.similarMock;
  M.pace = 250;
  clearInterval(M.timer);
  M.timer = setInterval(() => M.tick(), M.pace);
  M.timer.unref?.();
  S.pace = 1500;
  const COURSE = mock.fixture.outline.course;
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
        if (width !== 320) await page.screenshot({ path: path.join(out, `${name}-${width}-${scheme}.png`), fullPage: true });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    ok.push(`${name}: no horizontal scroll at 320, 390, 820 and 1440 px, light and dark`);
  };
  const ops = (action) => S.calls.filter((c) => c.fn === `op similar ${action}`);
  const items = (eid) => db.practice.questions.filter((q) => q.exam_id === eid).sort((a, b) => a.exam_no - b.exam_no);
  const byLabel = (eid, label) => items(eid).find((q) => q.no_label === label);
  const twinsOf = (q) => db.practice.questions.filter((t) => t.source === "twin" && t.twin_of === q.id);
  const article = async () => norm(await page.locator("article.pq, .sa").first().innerText());
  /** A choice question on screen answered wrong (with a bet). */
  const answerWrong = async (q) => {
    const key = db.practice.keys.get(q.id).answer;
    await page.locator(".pq-options .a-opt").first().waitFor({ timeout: 15000 });
    const texts = (await page.locator(".pq-options .pq-text").allInnerTexts()).map(norm);
    const right = texts.indexOf(norm(q.options[key]));
    await page.locator(".pq-options .a-opt").nth(right === 0 ? 1 : 0).click();
    await page.getByRole("radio", { name: "על בטוח" }).click();
    await page.getByRole("button", { name: "לבדוק" }).click();
    await page.locator(".pq-verdict").waitFor({ timeout: 10000 });
  };
  /** One step on: the next question, else "לדלג" (an open or numeric item), else "לא יודעים". */
  const onward = async () => {
    if (await page.locator(".pq-next").count()) return page.locator(".pq-next").click();
    const skip = page.getByRole("button", { name: "לדלג", exact: true });
    if (await skip.count()) return skip.first().click();
    await page.locator(".pq-dont-know").first().click();
    await page.locator(".pq-next").waitFor({ timeout: 10000 });
    await page.locator(".pq-next").click();
  };
  /** On through the round until the question whose text has `text` (skipping the rest). */
  const skipTo = async (text) => {
    for (let i = 0; i < 40; i++) {
      await page.locator("article.pq, .sa").first().waitFor({ timeout: 10000 });
      if ((await article()).includes(text)) return;
      await onward();
      await page.waitForTimeout(200);
    }
    throw new Error(`never reached "${text}"`);
  };
  const toEnd = async () => {
    for (let i = 0; i < 60 && !(await page.locator(".pq-end").count()); i++) {
      await onward();
      await page.waitForTimeout(150);
    }
    await page.locator(".pq-end").waitFor({ timeout: 10000 });
  };

  try {
    await open("שוהם", "/?v=library");
    await page.waitForTimeout(800);
    const course = db.coursesMock?.rows.find((r) => r.name === COURSE);
    expect(Boolean(course), "the course row exists");
    const CID = course.id;
    const clean = await pageShots(browser, path.join(out, "files"));
    const sheet = db.sheetsMock.seed({ course: COURSE, title: "תרגיל 3 · פרמקוקינטיקה", lecture: null, images: clean.slice(1), forms: true });
    const EID = sheet.id;
    const one = byLabel(EID, "1");
    const six = byLabel(EID, "6");
    expect(Boolean(one && six), "the seeded sheet has items 1 and 6");

    if (!flags.similar) {
      /* ── Nothing of release B without its flag ── */
      await open("שוהם", `/?v=practice&s=e.${EID}&n=all`);
      await answerWrong(one);
      await page.waitForTimeout(1500);
      expect((await page.locator(".sim-row, .sim-more").count()) === 0, "without VITE_STUDY_SIMILAR: a wrong answer offers nothing");
      await open("שוהם", `/?v=exams&e=${EID}&c=${CID}`);
      await page.locator(".r-sum").waitFor({ timeout: 15000 });
      expect((await page.locator(".ss-head-more").count()) === 0, "and the review has no ⋯");
      expect(S.calls.length === 0, "the op similar and its reads are never called");
      steps.off = true;
    } else {
      /* ── 1. help ── */
      await open("שוהם", "/?v=help");
      const row = page.locator("details", { hasText: "מבחנים ותרגילים" }).first();
      await row.waitFor({ timeout: 15000 });
      if (!(await row.getAttribute("open"))) await row.locator("summary").click();
      const help = norm(await row.innerText());
      expect(help.includes("״עוד שאלות כמוה״ יוצר 2 שאלות דומות") && help.includes("״שאלות דומות לכל הדף״") && help.includes("ושאלה שלא עברה בדיקה לא נשמרת"), "help's row says how similar questions are made and checked");

      /* ── 2. a wrong answer, "עוד שאלות כמוה", the run, the twin asked next ── */
      S.drop = 1;
      await open("שוהם", `/?v=practice&s=e.${EID}&n=all`);
      expect((await article()).includes(norm(one.question)), "the round starts at item 1");
      await answerWrong(one);
      await page.locator(".sim-more").waitFor({ timeout: 10000 });
      expect(ops("plan").length === 1 && ops("plan")[0].body.scope === "item" && ops("plan")[0].body.questionId === one.id, "the offer asks the op's plan (nothing reserved)");
      expect(norm(await page.locator(".sim-more").innerText()) === "עוד שאלות כמוה", "after a wrong answer: עוד שאלות כמוה");
      await shot("similar-offer", { primary: ".ph-foot .a-btn.primary" });
      await page.locator(".sim-more").click();
      const dialog = page.getByRole("dialog", { name: "שאלות כמו שאלה 1" });
      await dialog.waitFor({ timeout: 5000 });
      const make = norm(await dialog.locator(".sim-make").innerText());
      expect(/^ליצור 2 כמוה · כ-\$0\.\d0$/.test(make) && norm(await dialog.innerText()).includes("אותו נושא ואותה רמה, מקרה חדש."), `the sheet: ${make}`);
      await shot("similar-sheet", { primary: ".sim-make" });
      await noSideScroll("similar-sheet");
      await dialog.locator(".sim-make").click();
      await dialog.waitFor({ state: "detached", timeout: 5000 });
      expect(ops("start").length === 1 && ops("start")[0].body.make === true && ops("start")[0].body.scope === "item", "the start says make: true (practise existing twins first is the op's default)");
      expect(S.runs.length === 1 && S.runs[0].per === 2 && S.runs[0].items[0] === one.id && S.runs[0].created_by === db.members[0].user_id, "a run of 2 on item 1, in the requester's name");
      await page.locator(".sim-running").waitFor({ timeout: 5000 });
      expect(norm(await page.locator(".sim-running").innerText()) === "יוצרים 2 שאלות ובודקים אותן… · אפשר להמשיך לתרגל", "while it runs: יוצרים 2 שאלות ובודקים אותן…");
      expect((await page.locator(".sim-running").getAttribute("aria-live")) === null && (await page.locator(".sim-result").getAttribute("aria-live")) === "polite", "only the result line is a live region");
      await page.locator(".sim-result", { hasText: "נוצרה" }).waitFor({ timeout: 15000 });
      expect(norm(await page.locator(".sim-result").innerText()) === "נוצרה שאלה אחת · אחת לא עברה בדיקה", "the end: one made, one dropped by the check");
      S.drop = 0;
      const twin1 = twinsOf(one)[0];
      expect(Boolean(twin1) && twin1.from_exam === EID && twin1.exam_id === null, "the twin is its sheet's (from_exam), no exam_id");
      await shot("similar-made", { primary: ".ph-foot .a-btn.primary" });
      await page.locator(".sim-now").click();
      await page.waitForTimeout(400);
      expect((await article()).includes("(שאלה דומה"), "לתרגל עכשיו: the twin is asked right after item 1");
      const chip = page.locator(".sim-twin");
      await chip.waitFor({ timeout: 10000 });
      expect(norm(await chip.innerText()) === "דומה לשאלה 1 בתרגיל 3 · פרמקוקינטיקה · נבדקה", `the twin's chip: ${norm(await chip.innerText())}`);
      const twinShown = (await page.locator(".pq-options .pq-text").allInnerTexts()).map(norm);
      expect(JSON.stringify(twinShown) === JSON.stringify(twin1.options.map(norm)), "a twin's options in its printed order (D10)");
      await chip.click();
      const peek = page.getByRole("dialog", { name: "השאלה המקורית" });
      await peek.locator(".sim-peek-options").waitFor({ timeout: 5000 });
      expect(norm(await peek.innerText()).includes(norm(one.question)) && (await peek.locator(".sim-peek-options li").count()) === one.options.length, "the peek shows the source question, read only");
      await shot("similar-peek");
      await peek.getByRole("button", { name: "סגירה" }).last().click();
      await peek.waitFor({ state: "detached", timeout: 5000 });
      await noSideScroll("similar-twin");

      /* ── 3. joined: another member's run on item 6 ── */
      const other = S.begin({ examId: EID, scope: "item", items: [six.id], per: 2, by: db.members[1].user_id, doneAt: Date.now() + 3_600_000 });
      await skipTo(norm(six.question).slice(0, 30));
      await answerWrong(six);
      await page.locator(".sim-running", { hasText: "כבר מכינים שאלות כמו זו" }).waitFor({ timeout: 10000 });
      expect((await page.locator(".sim-more").count()) === 0 && ops("start").length === 1, "joined: כבר מכינים שאלות כמו זו, nothing started or reserved");
      await shot("similar-joined", { primary: ".ph-foot .a-btn.primary" });
      other.doneAt = Date.now();
      await page.locator(".sim-result", { hasText: "נוצרו 2" }).waitFor({ timeout: 15000 });
      expect(twinsOf(six).length === 2, "the joined run's twins are made");
      await page.locator(".sim-now").click();
      await page.waitForTimeout(400);
      expect((await article()).includes("(שאלה דומה"), "the joined run's twins join the round right after item 6");

      /* ── 3b. existing twins first ($0), for another member in a new round ── */
      const starts = ops("start").length;
      await open("נועה", `/?v=practice&s=e.${EID}&n=all`);
      await answerWrong(one);
      await page.locator(".sim-have").waitFor({ timeout: 10000 });
      expect(norm(await page.locator(".sim-have").innerText()) === "שאלה דומה אחת · לתרגל ‹", "the twin item 1 has: free, first");
      await page.locator(".sim-have").click();
      await page.waitForTimeout(400);
      await page.locator(".pq-next").click();
      await page.waitForTimeout(400);
      expect((await article()).includes(norm(twin1.question).slice(0, 25)) && ops("start").length === starts, "practised next, nothing started");

      /* ── 4. refusals in the row's words ── */
      const five = byLabel(EID, "5");
      S.cap = true;
      await skipTo(norm(five.question).slice(0, 25));
      await answerWrong(five);
      await page.locator(".sim-more").click();
      await page.getByRole("dialog").locator(".sim-make").click();
      await page.locator(".sim-fail").waitFor({ timeout: 10000 });
      expect(norm(await page.locator(".sim-fail").innerText()) === "התקציב לשאלות דומות נגמר החודש. מתחדש ב-1 בחודש.", "the similar line spent: its words (402 similar_cap)");
      await shot("similar-cap");
      S.cap = false;
      S.failNext = "daily_limit";
      await page.locator(".sim-more").click();
      await page.getByRole("dialog").locator(".sim-make").click();
      await page.locator(".sim-fail", { hasText: "מחר" }).waitFor({ timeout: 10000 });
      expect(norm(await page.locator(".sim-fail").innerText()) === "היום כבר נוצרו הרבה שאלות דומות. אפשר שוב מחר.", "10 taps a day: its words (429)");
      // Six twins already: only those, no more to make.
      const nine = byLabel(EID, "9");
      for (let i = 0; i < 6; i++) S.begin({ examId: EID, scope: "item", items: [nine.id], per: 1, by: db.members[1].user_id, doneAt: Date.now() - 1 });
      S.tick();
      expect(twinsOf(nine).length === 6, "item 9 has 6 twins");
      await skipTo(norm(nine.question).slice(0, 25));
      await answerWrong(nine);
      await page.locator(".sim-have").waitFor({ timeout: 10000 });
      expect(norm(await page.locator(".sim-have").innerText()).startsWith("6 שאלות דומות · לתרגל") && (await page.locator(".sim-more").count()) === 0, "6 a root: its twins, no עוד שאלות כמוה");
      // The switch off: nothing offered.
      S.on = false;
      await open("נועה", `/?v=practice&s=e.${EID}&n=all`);
      await answerWrong(one);
      await page.waitForTimeout(1500);
      expect((await page.locator(".sim-row").count()) === 0, "the switch off: no offer");
      S.on = true;

      /* ── 5. the end of the sheet's round: the whole sheet ── */
      await open("שוהם", `/?v=practice&s=e.${EID}&n=all`);
      await toEnd();
      const offer = page.locator(".sim-sheet-go");
      await offer.waitFor({ timeout: 10000 });
      const planned = S.plan(EID, null, "sheet");
      const label = norm(await offer.innerText());
      expect(/^שאלות דומות לכל הדף · כ-\$\d+\.\d\d$/.test(label), `the end of the round: ${label}`);
      expect(
        norm(await page.locator(".sim-sheet-offer").innerText()).includes(
          planned.items.length === 1
            ? "שאלה דומה אחת לשאלה היחידה שעוד אין לה דומה."
            : `שאלה דומה אחת לכל אחת מ-${planned.items.length} השאלות שעוד אין להן דומה.`,
        ) && norm(await page.locator(".sim-sheet-offer").innerText()).includes("״סטים של הקבוצה״"),
        `one for each of the ${planned.items.length} questions without one, into the group's sets`,
      );
      await shot("similar-sheet-offer");
      await noSideScroll("similar-sheet-offer");
      await offer.click();
      await until(() => ops("start").some((c) => c.body.scope === "sheet"), "the whole sheet's start");
      const run = S.runs.find((r) => r.scope === "sheet");
      expect(run && run.items.length === planned.items.length && run.per === 1, "a run of the whole sheet, one each");
      const toSet = page.locator(".sim-set", { hasText: "שאלות דומות · לפתור" });
      await toSet.waitFor({ timeout: 15000 });
      const set = db.qsetsMock.sets.find((x) => x.kind === "sheet" && x.exam_id === EID);
      expect(Boolean(set) && set.title === "שאלות דומות · תרגיל 3 · פרמקוקינטיקה" && set.state === "ready", "the sheet's one practice set (L, kind sheet), ready");
      const ready = db.notifyMock.notices.find((n) => n.kind === "similar_ready" && n.user_id === db.members[0].user_id);
      expect(Boolean(ready) && ready.route.k === set.id && ready.args.k === run.made, "the requester's similar_ready, to the set");
      expect(db.notifyMock.notices.some((n) => n.kind === "set_shared" && n.user_id === db.members[1].user_id), "the group hears through L's set_shared");
      await toSet.click();
      await page.waitForURL(new RegExp(`v=sets&k=${set.id}`), { timeout: 15000 });
      await page.locator("main h1, main h2").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      const setPage = norm(await page.locator("main").innerText());
      expect(setPage.includes("שאלות דומות · תרגיל 3 · פרמקוקינטיקה") && setPage.includes("שוהם"), "the set page: its title and its author");
      await shot("similar-set-page");
      await noSideScroll("similar-set-page");
      await page.goto(`${mock.base}/?v=sets`);
      await page.waitForTimeout(1200);
      expect(norm(await page.locator("main").innerText()).includes("שאלות דומות · תרגיל 3 · פרמקוקינטיקה"), "on סטים של הקבוצה");
      await shot("similar-shelf");

      /* ── 5b. solving the set: the twin's chip, more after a wrong answer ── */
      await page.goto(`${mock.base}/?v=practice&s=k.${set.id}&n=all`);
      await page.locator(".sim-twin").first().waitFor({ timeout: 15000 });
      const first = db.practice.questions.find((q) => q.id === db.qsetsMock.items.filter((i) => i.set_id === set.id).sort((a, b) => a.pos - b.pos)[0].question_id);
      if (first.form === "one" || !first.form) {
        await answerWrong(first);
        await page.locator(".sim-row").waitFor({ timeout: 10000 });
        expect((await page.locator(".sim-more, .sim-have").count()) > 0, "a wrong answer in the sheet's set offers more like it");
      }
      await shot("similar-set-session");
      // A numeric twin answered in the set's round counts in the set's score (study_qset_answer_value, stamped on the attempt).
      const setQs = db.qsetsMock.items.filter((i) => i.set_id === set.id).sort((a, b) => a.pos - b.pos).map((i) => db.practice.questions.find((q) => q.id === i.question_id));
      const numTwin = setQs.find((q) => q && q.form === "numeric");
      if (numTwin) {
        await page.goto(`${mock.base}/?v=practice&s=k.${set.id}&n=all`);
        await skipTo(numTwin.question.slice(0, 20));
        const k = db.practice.keys.get(numTwin.id);
        await page.getByLabel(/^התשובה/).fill(String(k.num));
        await page.getByRole("button", { name: "לבדוק", exact: true }).click();
        await page.locator(".sa-verdict").first().waitFor({ timeout: 10000 });
        const row = db.practice.answers.filter((a) => a.question_id === numTwin.id).pop();
        const att = row && db.qsetsMock.attempts.find((a) => a.id === row.set_attempt);
        expect(Boolean(row && row.correct && att && att.set_id === set.id), `a numeric twin in the set's round: the answer is right and stamped on the set's attempt (${JSON.stringify(row ?? null)})`);
        const fin = db.qsetsMock.finish({ ...att });
        expect(fin.answered >= 1 && fin.right_n >= 1, `the attempt's score counts it (answered ${fin.answered}, right ${fin.right_n})`);
        await shot("similar-set-numeric");
      } else steps.setNumeric = "no numeric twin in the set";

      /* ── 5c. the review's ⋯: once a day ── */
      await open("שוהם", `/?v=exams&e=${EID}&c=${CID}`, { viewport: DESK });
      await page.locator(".r-sum").waitFor({ timeout: 15000 });
      await page.getByRole("button", { name: "עוד פעולות לדף" }).click();
      const menu = page.getByRole("dialog", { name: "עוד פעולות לדף" });
      await menu.waitFor({ timeout: 5000 });
      await menu.locator(".sim-set, .a-muted", { hasText: "היום כבר נוצרו שאלות דומות לדף הזה" }).first().waitFor({ timeout: 10000 });
      expect(true, "the review's ⋯: היום כבר נוצרו שאלות דומות לדף הזה (one run of the whole sheet a day)");
      await page.setViewportSize(PHONE);
      await shot("similar-menu");
      await noSideScroll("similar-menu");
    }

    steps.problems = mock.problems;
    steps.a11y = a11y;
    steps.ok = ok;
    fs.writeFileSync(path.join(out, "steps.json"), JSON.stringify(steps, null, 2));
    console.log(JSON.stringify({ flags: flags.set, ok: ok.length, problems: mock.problems, a11y }, null, 2));
    if (mock.problems.length || a11y.length) process.exitCode = 1;
  } catch (e) {
    console.error(e);
    if (page) await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => undefined);
    steps.error = String(e?.stack ?? e);
    steps.problems = mock.problems;
    steps.ok = ok;
    fs.writeFileSync(path.join(out, "steps.json"), JSON.stringify(steps, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
    clearInterval(M.timer);
    await mock.close?.();
  }
  process.exit(process.exitCode ?? 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
