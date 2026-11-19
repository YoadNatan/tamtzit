// Today's "studying together" flow, moved from
// docs/study/spec/fixtures/e2e-base/study-together-e2e.js onto the shared
// mock (spec §8.3, F-1): two members in one lecture, presence through the
// private reading channel, follow-the-reader with pause and resume, a reader
// who leaves, a question on a paragraph answered live, a deleted note, read
// marks and the library. The presence helper sends at most one update every
// 7 s per channel, so the waits for the reader's place are longer than the
// old script's; the mock refuses a sixth presence call in 30 s.
//
//   NODE_PATH=$(npm root -g) node e2e/study/together.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (off, rel1, notoday or all; mock.cjs's flagSetOf).
// With package N's flag (flagSetOf's anchor) a paragraph's comments show in
// its chip row ("תגובה" · "2 תגובות"), which opens the same thread, instead
// of the dot inside the paragraph.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/together.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const PLACE_MS = 40_000; // a place update waits for its presence slot (≤ 7 s per channel, 5 per 31 s)
const flags = flagSetOf();
/** A paragraph's comment count: the dot in it, or with N the chip under it. */
const notesOf = (page, part, blk) =>
  flags.anchor ? page.locator(`[data-part="${part}"] .n-anchor[data-spot="${part}.${blk}"] [data-chip="comments"]`) : page.locator(`[data-part="${part}"] [data-blk="${blk}"] .note-dot`);

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  const pages = {};
  const open = async (who) => {
    const { page } = await mock.open(browser, who, { path: `/?l=${L}` });
    await page.locator(".summary").first().waitFor({ timeout: 20000 });
    return page;
  };
  try {
    const shoham = await open("שוהם");
    const noa = await open("נועה");
    pages.shoham = shoham;
    pages.noa = noa;

    // Presence
    await shoham.getByText(/כאן: נועה/).waitFor({ timeout: PLACE_MS });
    await noa.getByText(/כאן: שוהם/).waitFor({ timeout: PLACE_MS });
    steps.presence = "both see each other";

    // Follow the reader
    await shoham.getByRole("button", { name: "להקריא לקבוצה" }).click();
    await noa.getByText(/הקראה: שוהם/).waitFor({ timeout: PLACE_MS });
    a11y.push(...(await snap(shoham, out, "together-0-reading")));
    await noa.getByRole("button", { name: "לעקוב" }).click();
    await noa.getByText(/מעקב: שוהם/).waitFor({ timeout: 5000 });
    const target = `[data-part="4"] [data-blk="3"]`;
    await shoham.locator(target).evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3, behavior: "instant" }));
    await noa.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return el.classList.contains("blk-marked") && r.top > 0 && r.bottom < window.innerHeight;
      },
      target,
      { timeout: PLACE_MS },
    );
    steps.follow = { target, noaScrollY: await noa.evaluate(() => Math.round(window.scrollY)), shohamScrollY: await shoham.evaluate(() => Math.round(window.scrollY)) };
    await noa.screenshot({ path: `${out}/together-1-follow.png` });

    await noa.waitForTimeout(800); // the smooth scroll ends
    await noa.mouse.move(200, 400);
    await noa.mouse.wheel(0, -600);
    await noa.getByRole("button", { name: "חזרה להקראה" }).waitFor({ timeout: 5000 });
    const target2 = `[data-part="6"] [data-blk="2"]`;
    await shoham.locator(target2).evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3, behavior: "instant" }));
    await noa.waitForFunction((sel) => document.querySelector(sel)?.classList.contains("blk-marked"), target2, { timeout: PLACE_MS });
    await noa.waitForTimeout(600);
    const stayed = await noa.locator(target2).evaluate((el) => el.getBoundingClientRect().top > window.innerHeight);
    await noa.screenshot({ path: `${out}/together-1b-paused.png` });
    await noa.getByRole("button", { name: "חזרה להקראה" }).click();
    await noa.waitForFunction(
      (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return r.top > 0 && r.bottom < window.innerHeight;
      },
      target2,
      { timeout: 10000 },
    );
    steps.pauseResume = { pausedStayedPut: stayed, resumedTo: target2 };

    await shoham.getByRole("button", { name: "→ לספרייה" }).click();
    await noa.getByText(/ההקראה של שוהם נעצרה לרגע/).waitFor({ timeout: PLACE_MS });
    await noa.screenshot({ path: `${out}/together-1c-waiting.png` });
    await shoham.locator(".lecture-card").first().click();
    await shoham.locator(".summary").first().waitFor({ timeout: 10000 });
    await noa.getByText("ההקראה הסתיימה.").waitFor({ timeout: PLACE_MS });
    steps.readerLeftAndCameBack = "waiting, then ended when the reader came back not reading";

    await shoham.getByRole("button", { name: "להקריא לקבוצה" }).click();
    await noa.getByRole("button", { name: "לעקוב" }).click({ timeout: PLACE_MS });
    await noa.getByText(/מעקב: שוהם/).waitFor({ timeout: 5000 });
    await shoham.getByRole("button", { name: "לסיים", exact: true }).click();
    await noa.getByText("ההקראה הסתיימה.").waitFor({ timeout: PLACE_MS });
    steps.readerStopped = "follower released";

    // A question on a paragraph
    const para = noa.locator(`[data-part="1"] [data-blk="2"]`);
    await para.scrollIntoViewIfNeeded();
    await para.click({ position: { x: 10, y: 10 } });
    await noa.getByRole("button", { name: "תגובה או שאלה" }).waitFor({ timeout: 5000 });
    steps.selectedOutline = await para.evaluate((el) => `${getComputedStyle(el).outlineStyle} focused=${document.activeElement === el}`);
    await noa.getByRole("button", { name: "תגובה או שאלה" }).click();
    await noa.getByRole("radio", { name: "שאלה לקבוצה" }).click();
    await noa.locator(".composer textarea").fill("למה Acetazolamide מפסיקה לעבוד אחרי כמה ימים?");
    await noa.getByRole("button", { name: "לשלוח" }).click();
    await noa.locator(".note.question").first().waitFor({ timeout: 5000 });
    a11y.push(...(await snap(noa, out, "together-2-thread")));
    const bodyLocked = await noa.evaluate(() => document.body.style.overflow);
    await noa.evaluate(() => history.back());
    await noa.locator(".a-sheet").waitFor({ state: "detached", timeout: 5000 });
    await noa.waitForTimeout(300);
    steps.backClosesSheet = {
      bodyLockedWhileOpen: bodyLocked === "hidden",
      stillOnLecture: (await noa.evaluate(() => location.search)) === `?l=${L}` && (await noa.locator(".summary").count()) > 0,
      unlocked: (await noa.evaluate(() => document.body.style.overflow)) === "",
    };

    // Shoham sees it live, answers, marks it answered
    await shoham.locator(".q-btn").waitFor({ timeout: 10000 });
    steps.openQuestionsOnShoham = (await shoham.locator(".q-count").textContent()).trim();
    await shoham.locator(".q-btn").click();
    await shoham.locator(".note-jump").first().click();
    await shoham.getByRole("button", { name: "תשובה" }).click();
    await shoham.locator(".composer textarea").fill("כי ה-acidosis מקטינה את ה-HCO₃⁻ המסונן.");
    await shoham.getByRole("button", { name: "לשלוח" }).click();
    await shoham.locator(".note.reply").first().waitFor({ timeout: 5000 });
    await shoham.getByRole("button", { name: "לסמן שנענתה" }).click();
    await shoham.getByText("שאלה שנענתה").waitFor({ timeout: 5000 });
    await shoham.waitForTimeout(900); // let the smooth scroll to the paragraph finish
    a11y.push(...(await snap(shoham, out, "together-3-answered")));
    await shoham.getByRole("button", { name: "סגירה" }).click();
    await notesOf(noa, 1, 2).waitFor({ timeout: 10000 });
    steps.noaSeesThread = (await notesOf(noa, 1, 2).textContent()).trim();
    await noa.waitForFunction(() => !document.querySelector(".q-btn"), null, { timeout: 10000 });
    steps.openQuestionsAfterAnswer = 0;

    await notesOf(noa, 1, 2).click();
    await noa.locator(".note:not(.reply)").getByRole("button", { name: "מחיקה" }).click();
    steps.deleteConfirm = (await noa.locator(".note-confirm span").textContent()).trim();
    await noa.locator(".note-confirm").getByRole("button", { name: "מחיקה" }).click();
    await shoham.waitForFunction(
      (anchor) => !document.querySelector(anchor ? `[data-part="1"] .n-anchor[data-spot="1.2"] [data-chip="comments"]` : `[data-part="1"] [data-blk="2"] .note-dot`),
      flags.anchor,
      { timeout: 10000 },
    );
    steps.deleteReachedShoham = flags.anchor ? "comments chip gone" : "note-dot gone";
    await noa.keyboard.press("Escape");
    await noa.locator(".a-sheet").waitFor({ state: "detached", timeout: 5000 });

    // Read marks
    await shoham.getByRole("button", { name: "סימון שקראתי" }).click();
    await shoham.getByRole("button", { name: "✓ קראתי" }).waitFor({ timeout: 5000 });
    await noa.getByText("קראו: שוהם").waitFor({ timeout: 10000 });
    steps.readMark = "Noa sees: קראו: שוהם";

    // The library shows it too
    await noa.getByRole("button", { name: "→ לספרייה" }).click();
    await noa.locator(".lc-together").getByText(/קראו: שוהם/).waitFor({ timeout: 10000 });
    steps.library = (await noa.locator(".lecture-card").first().innerText()).replace(/\n/g, " | ");
    a11y.push(...(await snap(noa, out, "together-4-library")));
    steps.horizontalOverflow = await shoham.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const { page: guest } = await mock.open(browser, null, { path: "/" });
    await guest.locator(".a-seg").waitFor({ timeout: 10000 });
    steps.joinTabs = await guest.locator(".a-seg").evaluate((el) => getComputedStyle(el).display);
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    steps.privateChannel = [...new Set(mock.privateJoins)];
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) {
      const bar = await pg.locator(".room-bar").innerText({ timeout: 1000 }).catch(() => "(no room bar)");
      console.error(`${who} room bar: ${bar.replace(/\n/g, " | ")}`);
      await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    }
    console.error(JSON.stringify({ problems: mock.problems, steps, calls: mock.calls.slice(-20) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
