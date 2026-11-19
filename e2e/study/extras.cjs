// Package E's flow (§12.6.E, E-3: P10 and P11; proposal/mockups/practice.html
// s3) on the shared mock, with Yoad's decision 3 of 17 Nov 2026 (the extras
// open early, each with what there is and a meter, never a dead end):
//   1. שוהם's lecture practice: "טבלה ריקה" lists the fixture's three tables
//      (slides 8, 19, 20) with "3 טבלאות בשקפים של ההרצאה"; "שאלה משלי"
//      with "רק לך", its meter and "להוסיף שאלה משלי".
//   2. The blank table of slide 19: "טבלה ריקה · {title}", "1/2", "הטבלה
//      משקף 19, מהזיכרון · שורה אחר שורה"; the column's chips fill the "?"
//      cell; a right row says so; a wrong one strikes the cell, says "טעות
//      בשורה 2" · "נכנסה לכרטיסיות" · "רק לך", and makes one private card
//      (study_my_card_add, origin 'table'); the end counts both; again, the
//      same mistake adds no second card. $0: no call to /api/study/ai.
//   3. Decision 3's empty states: a lecture without tables says so, what a
//      table needs and where the group's other tables are, with a way there;
//      a slide without one points to the lecture's first.
//   4. A trap on ¶1.3 (?v=trap&l=&at=1.3): the paragraph quoted, the slide
//      chips from its tags; a lead-in without "?" is caught before any call;
//      "לבדוק מול השקפים · כ-$0.03" → "בודקים מול השקפים…" → "המלכודת נכנסה
//      לבנק של כולם…"; one reservation; in the bank with no author and no
//      created_by; the meter "שאלה אחת שלך בבנק".
//   5. A second trap the check rejects: the problem and "לתקן"; fixed, the
//      same draft passes (no new draft).
//   6. N's "תרגול" tab on ¶1.3 has "להוסיף שאלה משלי".
//   7. נועה: none of שוהם's drafts; practice shows "שאלה של מישהו מהקבוצה"
//      and answering never names the author (review SEC-7); after a live
//      quiz's reveal (the mock's stand-in for study_quiz__revealed) it says
//      "נכתבה ע״י שוהם · נבדקה מול השקפים"; שוהם's meter counts it.
//   8. איתי wrote ten drafts today: the meter says so and the check waits.
// Without the flags (every set but "e5" and "all") it checks that nothing of
// E shows, that ?v=trap and s=b.* lead elsewhere, and that no call of
// section E or op trap_check is made.
//
//   NODE_PATH=$(npm root -g) node e2e/study/extras.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "e5" (wave 5's
// "w5" with VITE_STUDY_TRAPS and VITE_STUDY_BLANK_TABLE), "all", or a set
// without E.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/extras.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const MEMBERS = ["שוהם", "נועה", "איתי"];
const norm = (s) => s.replace(/\s+/g, " ").trim();

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: MEMBERS });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const db = mock.db;
  // The deck stores a slide's tables as a list of tables (pptx.ts: string[][][]); the shared
  // fixture writes each slide's one table bare, so it is wrapped here, and slide 20's
  // comparison gets the deck's fuller table (the approved mockup's shape: a label, 3 columns).
  for (const sl of db.lectures.find((l) => l.id === L).slides) {
    if (Array.isArray(sl.tables) && sl.tables.length && typeof sl.tables[0]?.[0] === "string") sl.tables = [sl.tables];
    if (sl.n === 20)
      sl.tables = [
        [
          ["Class", "Site", "K+", "Ca2+"],
          ["Loop", "TAL", "יורד", "יורד"],
          ["Thiazides", "DCT", "יורד", "עולה"],
          ["K+ sparing", "CD", "עולה", "—"],
          ["CA inhibitors", "PCT", "יורד", "—"],
          ["Osmotic", "PCT", "—", "—"],
        ],
      ];
  }
  const E = db.extrasMock;
  const id = (name) => db.members.find((m) => m.name === name).user_id;
  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const ok = [];
  const a11y = [];
  const pages = {};
  const open = async (who, path) => {
    if (pages[who]) await pages[who].context().close().catch(() => undefined);
    const { page } = await mock.open(browser, who, { path });
    pages[who] = page;
    await page.locator("main").first().waitFor({ timeout: 15000 });
    return page;
  };
  const expect = (cond, what) => {
    if (!cond) throw new Error(what);
    ok.push(what);
  };
  const shot = async (page, name) => a11y.push(...(await snap(page, out, name)));
  const go = async (page, path) => {
    await page.goto(`${mock.base}${path}`);
    await page.locator("main").first().waitFor({ timeout: 15000 });
  };
  const aiCalls = () => mock.calls.filter((c) => /^api POST \/api\/study\/ai/.test(String(c))).length;
  try {
    if (!flags.traps && !flags.blankTable) {
      /* ── Nothing of E without its flags ── */
      const s = await open("שוהם", `/?v=practice&l=${L}`);
      await s.waitForTimeout(1200);
      expect((await s.getByRole("heading", { name: "טבלה ריקה" }).count()) === 0, "no \"טבלה ריקה\" in a lecture's practice");
      expect((await s.getByRole("heading", { name: "שאלה משלי" }).count()) === 0, "no \"שאלה משלי\" in a lecture's practice");
      await go(s, `/?v=trap&l=${L}&at=1.3`);
      await s.waitForURL((u) => !u.search.includes("v=trap"), { timeout: 15000 });
      expect(true, "?v=trap leads elsewhere");
      await go(s, `/?v=practice&s=b.${L}.19`);
      await s.waitForURL((u) => !u.search.includes("s=b."), { timeout: 15000 });
      expect(true, "s=b.* leads elsewhere");
      await s.waitForTimeout(400);
      expect(E.calls.length === 0, `no call of section E (${E.calls.map((c) => c.fn).join(", ")})`);
    } else {
      /* ── 1. the lecture's practice: the extras with their meters ── */
      const s = await open("שוהם", `/?v=practice&l=${L}`);
      const blank = s.locator(".extras-blank");
      await blank.locator(".blank-row").first().waitFor({ timeout: 15000 });
      expect(norm(await blank.locator(".blank-meter").innerText()) === "3 טבלאות בשקפים של ההרצאה", "the meter: 3 tables on the lecture's slides");
      const rows = (await blank.locator(".blank-row").allInnerTexts()).map(norm);
      steps.tables = rows;
      expect(rows.length === 3 && /ש׳ 8 · 2 שורות/.test(rows[0]) && /ש׳ 19/.test(rows[1]) && /ש׳ 20/.test(rows[2]), "the tables of slides 8, 19 and 20, with their rows");
      const traps = s.locator(".extras-traps");
      await traps.locator(".trap-next").waitFor({ timeout: 15000 });
      expect(/רק לך/.test(await traps.innerText()), "\"שאלה משלי\" is marked \"רק לך\"");
      expect(norm(await traps.locator(".trap-next").innerText()) === "שאלה שעוברת את הבדיקה נכנסת לבנק של כולם, בלי שם.", "the trap meter with nothing yet: what a trap does, not a lock");
      await blank.scrollIntoViewIfNeeded();
      await shot(s, "e-01-lecture-extras");

      /* ── 2. the blank table of slide 19 ── */
      const before = aiCalls();
      await blank.locator(".blank-row").nth(1).click();
      await s.waitForURL((u) => u.searchParams.get("s") === `b.${L}.19`, { timeout: 15000 });
      await s.locator(".blank-grid").waitFor({ timeout: 15000 });
      const h1 = norm(await s.locator("h1").first().innerText());
      expect(/^טבלה ריקה · /.test(h1), `the head "טבלה ריקה · {title}" (${h1})`);
      expect(norm(await s.locator(".blank-count").innerText()) === "0/2", "\"0/2\" in the top bar: no row checked yet");
      expect(norm(await s.locator(".ph-sub").first().innerText()) === "הטבלה משקף 19, מהזיכרון · שורה אחר שורה", "the line under it");
      expect((await s.locator(".blank-dot").count()) === 2, "the next row's cells are dots");
      expect(norm(await s.locator(".blank-slot").first().innerText()) === "?", "the cell to fill is \"?\"");
      const fill = async (...values) => {
        for (const v of values) await s.locator(".blank-chips").getByRole("button", { name: v, exact: true }).click();
      };
      await shot(s, "e-02-blank-start");
      await fill("TAL", "25%");
      await s.getByRole("button", { name: "לבדוק את השורה" }).click();
      await s.locator(".blank-result").waitFor({ timeout: 10000 });
      expect(/✓ שורה 1 נכונה/.test(await s.locator(".blank-result").innerText()), "a right row says so");
      await s.waitForFunction(() => document.querySelector(".blank-count")?.textContent?.trim() === "1/2", null, { timeout: 10000 }).catch(() => undefined);
      steps.afterRow1 = [norm(await s.locator(".blank-count").innerText()), norm(await s.locator(".blank-slot").first().innerText())];
      expect(norm(await s.locator(".blank-count").innerText()) === "1/2" && norm(await s.locator(".blank-slot").first().innerText()) === "?", "\"1/2\", and the next row opens at once (the mockup: the card stays under the chips)");
      await fill("TAL", "5%");
      await s.getByRole("button", { name: "לבדוק את השורה" }).click();
      const res = s.locator(".blank-result");
      await res.getByText("נכנסה לכרטיסיות").waitFor({ timeout: 10000 });
      const resText = norm(await res.innerText());
      steps.wrong = resText;
      expect(/✗ טעות בשורה 2/.test(resText) && /נכנסה לכרטיסיות/.test(resText) && /רק לך/.test(resText) && /בשקף: Thiazides · Site: ׳DCT׳\. ש׳ 19/.test(resText), "the wrong row: \"טעות בשורה 2\" · \"נכנסה לכרטיסיות\" · \"רק לך\", the slide's value");
      expect((await s.locator(".blank-said").count()) === 1 && norm(await s.locator(".blank-said").innerText()) === "TAL", "the wrong cell is struck");
      const cards = () => db.cardsMock.mine.filter((c) => c.origin === "table" && c.user_id === id("שוהם"));
      expect(cards().length === 1 && /Thiazides, Site\?$/.test(cards()[0].front) && /^DCT, לא ׳TAL׳\. \[ש׳ 19\]$/.test(cards()[0].back) && cards()[0].slides.join() === "19", "one private card for the wrong cell (origin 'table')");
      await shot(s, "e-03-blank-wrong");
      const end = s.locator(".blank-end");
      await end.waitFor({ timeout: 10000 });
      expect(/1 מתוך 2 שורות בלי טעות · תא אחד נכנס לכרטיסיות, רק לך/.test(norm(await end.innerText())), "the end counts the rows and the card");
      await end.scrollIntoViewIfNeeded();
      await shot(s, "e-04-blank-end");
      await end.getByRole("button", { name: "עוד פעם" }).click();
      await fill("TAL", "25%");
      await s.getByRole("button", { name: "לבדוק את השורה" }).click();
      await fill("TAL", "5%");
      await s.getByRole("button", { name: "לבדוק את השורה" }).click();
      await s.locator(".blank-result").getByText(/נכנסה לכרטיסיות|לא נשמרה/).waitFor({ timeout: 10000 });
      await s.waitForTimeout(400);
      expect(cards().length === 1, "the same mistake again adds no second card");
      // The mockup's moment (practice.html s3): a wrong row's card under the chips while the next row is filled.
      await go(s, `/?v=practice&l=${L}&s=b.${L}.20`);
      await s.locator(".blank-grid").waitFor({ timeout: 15000 });
      await fill("TAL", "יורד", "עולה");
      await s.getByRole("button", { name: "לבדוק את השורה" }).click();
      await s.locator(".blank-result").getByText("נכנסה לכרטיסיות").waitFor({ timeout: 10000 });
      await fill("DCT");
      expect(norm(await s.locator(".blank-count").innerText()) === "1/5" && /✗ טעות בשורה 1/.test(await s.locator(".blank-result").innerText()) && (await s.locator(".blank-chips").count()) === 1, "the next row is filled with the wrong row's card under the chips");
      expect(cards().length === 2 && /Loop, Ca2\+\?$/.test(cards()[1].front), "a second card, for slide 20's wrong cell");
      await shot(s, "e-03b-blank-mockup");
      expect(aiCalls() === before, "$0: the blank table calls no op");

      /* ── 3. decision 3: the empty states, with the way on ── */
      const L2 = "eeeeeeee-0000-4000-8000-000000000099";
      const t0 = new Date().toISOString();
      db.lectures.push({ ...db.lectures.find((l) => l.id === L), id: L2, title: "Antifungals", slides: Array.from({ length: 6 }, (_, i) => ({ n: i + 1, title: `שקף ${i + 1}`, lines: ["x"], tables: [], notes: "", figures: [] })), created_at: t0, updated_at: t0 });
      await go(s, `/?v=practice&l=${L2}`);
      const empty = s.locator(".extras-blank");
      await empty.locator(".blank-next").waitFor({ timeout: 15000 });
      const emptyText = norm(await empty.innerText());
      steps.empty = emptyText;
      expect(/בשקפים של ההרצאה הזו אין טבלה למילוי\./.test(emptyText), "a lecture without tables says so");
      expect(/טבלה ריקה נפתחת על טבלה בשקף עם 2 שורות לפחות מתחת לכותרת/.test(emptyText) && /בהרצאה אחרת יש 3 טבלאות בשקפים\./.test(emptyText), "the meter: what a table needs, and the group's other tables (real counts)");
      await empty.scrollIntoViewIfNeeded();
      await shot(s, "e-05-blank-empty");
      await empty.getByRole("link", { name: "לתרגול של הרצאה עם טבלה" }).click();
      await s.waitForURL((u) => u.searchParams.get("l") === L && !u.searchParams.get("s"), { timeout: 15000 });
      expect(true, "never a dead end: the way to a lecture with tables");
      await go(s, `/?v=practice&s=b.${L}.5`);
      await s.locator(".blank-empty").waitFor({ timeout: 15000 });
      expect(/בשקף 5 אין טבלה למילוי/.test(await s.locator(".blank-empty").innerText()), "a slide without a table says so");
      await s.locator(".blank-empty").getByRole("link", { name: "לטבלה בשקף 8" }).click();
      await s.waitForURL((u) => u.searchParams.get("s") === `b.${L}.8`, { timeout: 15000 });
      expect(true, "and leads to the lecture's first table");

      /* ── 4. a trap on ¶1.3 ── */
      await go(s, `/?v=trap&l=${L}&at=1.3`);
      await s.locator(".trap-form").waitFor({ timeout: 15000 });
      expect((await s.locator(".trap-quote").count()) === 1, "the paragraph is quoted");
      const pressed = await s.locator('.trap-form [aria-pressed="true"]').allInnerTexts();
      steps.slides = pressed.map(norm);
      expect(pressed.length >= 1, "the paragraph's own slide is chosen");
      expect(norm(await s.locator(".ph-sub").first().innerText()).startsWith("עוד אין שאלה שלך בבנק"), "the meter under the head");
      await s.getByLabel("השאלה").fill("מה Furosemide מעכבת בלולאה העולה");
      const answers = ["NKCC2", "ENaC", "NCC", "ROMK"];
      for (let i = 0; i < 4; i++) await s.getByLabel(`תשובה ${"אבגד"[i]}`).fill(answers[i]);
      await s.locator(".trap-key input").first().check();
      await s.getByLabel("מה מבלבל בה? (לא חובה)").fill("רוב האנשים בוחרים NCC");
      await s.getByLabel("מקרה (לא חובה)").fill("גבר בן 60 עם בצקת ריאות.");
      await s.evaluate(() => window.scrollTo(0, 0));
      await shot(s, "e-06-trap-form");
      const check = s.getByRole("button", { name: /^לבדוק מול השקפים · כ-\s?\$0\.03$/ });
      await check.click();
      await s.getByText("השאלה צריכה להסתיים בסימן שאלה.").waitFor({ timeout: 5000 });
      expect(E.drafts.length === 0 && E.reserved === 0, "a lead-in without \"?\" is caught before any call");
      await s.getByLabel("השאלה").fill("מה Furosemide מעכבת בלולאה העולה?");
      await check.click();
      await s.getByRole("button", { name: "בודקים מול השקפים…" }).waitFor({ timeout: 5000 });
      expect(true, "\"בודקים מול השקפים…\" while it checks");
      await s.locator(".trap-done").waitFor({ timeout: 15000 });
      expect(/השאלה נכנסה לבנק של כולם\. השם שלך יופיע אחרי שתישאל במבחן קבוצתי\./.test(await s.locator(".trap-done").innerText()), "passed: \"המלכודת נכנסה לבנק של כולם…\"");
      const q1 = db.practice.questions.find((q) => q.source === "member");
      expect(E.reserved === 1 && q1 && q1.created_by === null && q1.author_id === null && q1.anchor === 3 && q1.part_idx === 1, "one check; in the bank with no author and no created_by, on ¶1.3");
      await s.locator(".trap-meter").getByText("שאלה אחת שלך בבנק").waitFor({ timeout: 10000 });
      expect(true, "the meter: \"שאלה אחת שלך בבנק\"");
      await s.evaluate(() => window.scrollTo(0, 0));
      await shot(s, "e-07-trap-ok");

      /* ── 5. a trap the check rejects, then fixed ── */
      E.verdict = () => ({ problem: "לפי ש׳ 6 Furosemide פועלת בלולאה העולה העבה, לא באבובית המכונסת." });
      await s.getByRole("button", { name: "עוד שאלה" }).click();
      await s.getByLabel("השאלה").fill("איפה Furosemide פועלת?");
      const wrongOpts = ["באבובית המכונסת", "בלולאה העולה העבה", "באבובית הדיסטלית", "בגלומרולוס"];
      for (let i = 0; i < 4; i++) await s.getByLabel(`תשובה ${"אבגד"[i]}`).fill(wrongOpts[i]);
      await s.locator(".trap-key input").first().check();
      await s.getByRole("button", { name: /^לבדוק מול השקפים/ }).click();
      const problem = s.locator(".trap-problem");
      await problem.waitFor({ timeout: 15000 });
      expect(/לא עברה את הבדיקה/.test(await problem.innerText()) && /לפי ש׳ 6/.test(await problem.innerText()) && (await problem.getByRole("button", { name: "לתקן" }).count()) === 1, "rejected: the problem and \"לתקן\"");
      await s.evaluate(() => window.scrollTo(0, 0));
      await shot(s, "e-08-trap-rejected");
      await problem.getByRole("button", { name: "לתקן" }).click();
      E.verdict = () => "ok";
      await s.locator(".trap-key input").nth(1).check();
      const drafts = E.drafts.length;
      await s.getByRole("button", { name: /לתקן ולבדוק שוב/ }).click();
      await s.locator(".trap-done").waitFor({ timeout: 15000 });
      expect(E.drafts.length === drafts && E.drafts.filter((d) => d.state === "ok").length === 2, "fixed, the same draft passes: no new draft");
      const q2 = db.practice.questions.filter((q) => q.source === "member")[1];

      /* ── 6. N's "תרגול" tab ── */
      if (flags.anchor) {
        await go(s, `/?l=${L}`);
        await s.locator(".summary").first().waitFor({ timeout: 20000 });
        const row = s.locator('.n-anchor[data-spot="1.3"]');
        await row.waitFor({ timeout: 15000 });
        await row.locator(".n-chips button").first().click();
        const sheet = s.getByRole("dialog", { name: "מה יושב על הפסקה" });
        await sheet.getByRole("tab", { name: /^תרגול/ }).click();
        const add = sheet.getByRole("link", { name: "להוסיף שאלה משלי" });
        await add.waitFor({ timeout: 10000 });
        await shot(s, "e-09-anchor-tab");
        await add.click();
        await s.waitForURL((u) => u.searchParams.get("v") === "trap" && u.searchParams.get("at") === "1.3", { timeout: 15000 });
        expect(true, "N's \"תרגול\" tab opens \"להוסיף שאלה משלי\" on its paragraph");
      }

      /* ── 7. נועה: no draft of another, the trap in practice, named only by a live quiz ── */
      const n = await open("נועה", `/?v=trap&l=${L}`);
      await n.locator(".trap-form").waitFor({ timeout: 15000 });
      expect((await n.locator(".trap-mine").count()) === 0, "נועה sees none of שוהם's drafts");
      await go(n, `/?v=practice&s=l.${L}&n=all`);
      const chip = n.locator(".trap-chip");
      await chip.first().waitFor({ timeout: 15000 });
      expect(norm(await chip.first().innerText()) === "שאלה של מישהו מהקבוצה", "practice: \"שאלה של מישהו מהקבוצה\"");
      await shot(n, "e-10-practice-chip");
      await n.locator(".pq-options button.a-opt").first().click();
      await n.locator(".pq-bets").getByRole("radio", { name: "ניחוש", exact: true }).click();
      await n.getByRole("button", { name: "לבדוק", exact: true }).click();
      await n.locator(".pq-verdict").waitFor({ timeout: 15000 });
      expect(q1.author_id === null && q2.author_id === null && !/שוהם/.test(await n.locator("main").innerText()), "answering in practice never names the author (review SEC-7)");
      E.reveal(q1.id); // what section Z's final reveal does through study_quiz__revealed
      E.reveal(q2.id);
      await go(n, `/?v=practice&s=l.${L}&n=all`);
      await n.locator(".trap-chip").first().getByText("נכתבה ע״י שוהם · נבדקה מול השקפים").waitFor({ timeout: 15000 });
      expect(true, "after a live quiz's reveal: \"נכתבה ע״י שוהם · נבדקה מול השקפים\"");
      await shot(n, "e-11-practice-named");
      await go(s, `/?v=practice&l=${L}`);
      await s.locator(".extras-traps .trap-meter").waitFor({ timeout: 15000 });
      expect(norm(await s.locator(".extras-traps .trap-meter").innerText()) === "2 שאלות שלך בבנק · כולן כבר עם השם שלך", "שוהם's meter counts what the quiz named");
      await s.locator(".extras-traps").scrollIntoViewIfNeeded();
      await shot(s, "e-12-trap-meter");

      /* ── 8. איתי's ten drafts today ── */
      for (let i = 0; i < 10; i++)
        E.drafts.push({ id: `e5d10000-0000-4000-8000-${String(i).padStart(12, "0")}`, user_id: id("איתי"), group_id: db.group.id, lecture_id: L, part_idx: 1, anchor: null, quote: "", vignette: "", question: `שאלה ${i}?`, options: ["א", "ב", "ג", "ד"], answer: 0, note: "", slides: [6], state: "ok", problem: "", question_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      const it = await open("איתי", `/?v=trap&l=${L}`);
      await it.locator(".trap-next").waitFor({ timeout: 15000 });
      expect(/להיום נגמרו השאלות החדשות; מחר אפשר שוב\./.test(await it.locator(".trap-next").innerText()), "the day's ten: the meter says so");
      expect(await it.getByRole("button", { name: /^לבדוק מול השקפים/ }).isDisabled(), "and the check waits for tomorrow");
      steps.calls = [...new Set(E.calls.map((c) => c.fn))];
    }
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, ok: ok.length, checks: ok, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, ok, steps, calls: mock.calls.slice(-25), eCalls: E.calls.slice(-10) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
