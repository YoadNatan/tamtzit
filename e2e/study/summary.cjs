// Today's summary flow, moved from docs/study/spec/fixtures/e2e-base/study-e2e.js
// onto the shared mock (spec §8.3, F-1): join from an invite link, upload the
// synthetic deck, the outline and three parts written (streamed), figures,
// direction, the table of contents, back to the library. What the shell
// changes is accounted for (review FE-18): the script finds "יציאה" under
// "שלי".
//
//   VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
//     npx vite build --outDir <dist>
//   NODE_PATH=$(npm root -g) node e2e/study/summary.cjs <dist> <out dir>
// E2E_FLAGS=all when the build has every flag on (Today is then the home, and
// the flow goes to the library by its tab), notoday for every flag but TODAY,
// rel1 for release 1's three (QUESTIONS, PRACTICE, CARDS: docs/study/RELEASE-1.md).
// E2E_TIMEOUT_PART=<idx>: that part's first write fails the way a 270 s timeout does.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { makePptx } = require("./fixtures/make-pptx.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/summary.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();

(async () => {
  const mock = await createMock({ dist, members: [], flags: flags.set });
  const db = mock.db;
  const deck = path.join(out, "deck.pptx");
  await makePptx(deck);
  const browser = await chromium.launch();
  const steps = {};
  const shell = {};
  const a11y = [];
  try {
    // A visitor with no session, as when a member opens the invite link.
    const { page } = await mock.open(browser, null);
    // 1. invite link → join
    await page.goto(`${mock.base}/?join=ABC123`);
    await page.locator(".code-input").waitFor({ timeout: 10000 });
    a11y.push(...(await snap(page, out, "summary-0-join")));
    await page.getByPlaceholder("למשל: שוהם").fill("שוהם");
    steps.codePrefilled = await page.locator(".code-input").inputValue();
    await page.getByRole("button", { name: "הצטרפות" }).click();
    if (flags.today) {
      // The invite's route is the home: Today (release 8's tabs); the library is its own tab.
      await page.locator("main.today .ph-head .t", { hasText: "היום" }).waitFor({ timeout: 10000 });
      steps.homeAfterJoin = page.url().replace(mock.base, "");
      await page.locator(".ph-tabs .ph-tab", { hasText: "ספרייה" }).click();
    }
    await page.getByRole("heading", { name: mock.GROUP.name }).waitFor({ timeout: 10000 });
    steps.signupMetadata = db.lastSignup && db.lastSignup.data;
    steps.urlAfterJoin = page.url().replace(mock.base, "");
    a11y.push(...(await snap(page, out, "summary-1-library-empty")));

    // 2. upload the synthetic deck
    await page.getByRole("button", { name: "העלאת הרצאה ראשונה" }).click();
    await page.locator('input[type="file"]').setInputFiles(deck);
    await page.getByText(/20 שקפים/).waitFor({ timeout: 30000 });
    steps.detected = await page.locator(".drop").innerText();
    steps.prefilledTitle = await page.locator("label:has-text('שם ההרצאה') input").inputValue();
    await page.locator("label:has-text('מרצה') input").fill("ד״ר בדיקה");
    await page.locator("label:has-text('קורס או בלוק') input").fill("פרמקולוגיה לדוגמה");
    a11y.push(...(await snap(page, out, "summary-2-upload", { primary: ".ph-foot .a-btn.primary" })));
    await page.getByRole("button", { name: "יצירת סיכום" }).click();

    // 3. the lecture is saved and written
    await page.waitForURL(/\/\?l=/, { timeout: 60000 });
    if (process.env.E2E_TIMEOUT_PART) {
      await page.getByText(/החלק לקח יותר מדי זמן לשרת/).waitFor({ timeout: 60000 });
      steps.timeoutMessage = true;
      steps.progressAfterTimeout = await page.getByText(/נכתבו \d+ מתוך \d+ חלקים/).textContent();
      await page.locator(".lecture-foot").getByRole("button", { name: "המשך כתיבה" }).click();
      steps.retried = true;
    }
    await page.getByText(/חלקים · 20 שקפים/).waitFor({ timeout: 60000 });
    const lec = db.lectures[0];
    steps.storedSlides = lec.slides.length;
    steps.storedFigures = lec.slides.reduce((n, s) => n + s.figures.length, 0);
    steps.uploadedFiles = db.files.size;
    steps.uploadedBytes = [...db.files.values()].reduce((n, b) => n + b.length, 0);
    steps.slide16 = lec.slides.find((s) => s.n === 16).lines.slice(0, 4);
    steps.drawingText = lec.slides.flatMap((s) => s.lines.filter((l) => l.startsWith("מתוך שרטוט בשקף:")).map((l) => `${s.n}: ${l}`));
    steps.sections = db.sections.map((s) => `${s.idx}:${s.slide_from}-${s.slide_to}:${s.status}`);
    await page.waitForTimeout(800);
    a11y.push(...(await snap(page, out, "summary-3-lecture")));

    // 4. reading: figures, direction, table of contents
    steps.figuresShown = await page.locator(".slide-figure img").count();
    await page.locator(".slide-figure img").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    steps.firstFigureLoaded = await page.locator(".slide-figure img").first().evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
    // Where characters land on screen: a range reads left to right, and a
    // bracket that opens Hebrew text sits to the right of it.
    steps.geometry = await page.evaluate(() => {
      const xOf = (node, i) => {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        return Math.round(r.getBoundingClientRect().left);
      };
      const findText = (needle) => {
        const w = document.createTreeWalker(document.querySelector(".summary"), NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.includes(needle)) return n;
        return null;
      };
      const res = {};
      const range = findText("1-8");
      if (range) {
        const i = range.textContent.indexOf("1-8");
        res.range_1_8 = xOf(range, i) < xOf(range, i + 2) ? "1 left of 8 (correct)" : "REVERSED";
      }
      const slow = findText("לאט");
      if (slow) {
        const t = slow.textContent;
        const open = t.lastIndexOf("(", t.indexOf("לאט"));
        const close = t.indexOf(")", t.indexOf("לאט"));
        res.paren_לאט = open >= 0 && close >= 0 ? (xOf(slow, open) > xOf(slow, close) ? "( right of ) (correct in RTL)" : "FLIPPED") : `not in one text node: ${JSON.stringify(t.slice(0, 40))}`;
      }
      return res;
    });
    steps.bdiFurosemide = await page.locator("bdi", { hasText: "Furosemide" }).first().innerText().catch(() => "");
    steps.autoDirBlocks = await page.locator(".summary [dir=auto]").count();
    steps.srcTags = await page.locator(".src-tag, .src-link").count();
    steps.callouts = await page.locator(".summary .a-callout:not(.rec):not(.quiet)").count();
    steps.tables = await page.locator(".summary table").count();
    await page.getByRole("button", { name: "תוכן" }).click();
    steps.tocEntries = await page.locator(".toc li").count();
    a11y.push(...(await snap(page, out, "summary-4-toc")));
    await page.getByRole("button", { name: "תוכן" }).click();

    // 5. back to the library
    await page.getByRole("button", { name: "→ לספרייה" }).click();
    await page.getByText("מוכן").first().waitFor({ timeout: 10000 });
    steps.libraryCard = await page.locator(".lecture-card").first().innerText();
    a11y.push(...(await snap(page, out, "summary-5-library")));

    // The shell's own change: "יציאה" lives under "שלי" now (in A1's card once accounts ship).
    shell.signOutInLibrary = await page.getByRole("button", { name: "יציאה" }).count();
    await page.getByRole("link", { name: "שלי" }).click();
    await page.getByRole("heading", { name: "שלי" }).waitFor({ timeout: 10000 });
    shell.signOutUnderMe = (await page.getByRole("button", { name: "יציאה מהמכשיר הזה" }).count()) === (flags.account ? 0 : 1);
    if (!shell.signOutUnderMe) throw new Error("יציאה is not where it should be under שלי");
    a11y.push(...(await snap(page, out, "summary-6-me")));

    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    steps.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, steps, shell, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, calls: mock.calls.slice(-15), steps }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
