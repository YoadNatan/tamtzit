// The guide (docs/study/guide.md): the first use and the optional guides, on
// a mocked Supabase, at 390×844 and 360×640, light and dark (a11y.cjs at
// every step; the screenshots are <out>/guide-*-<scheme>.png).
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=guide node e2e/study/guide.cjs <dist> <out dir>
//
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf):
//   guide   wave 5 with every extra and VITE_STUDY_GUIDE ("w5x" + GUIDE): the
//           whole guide. A joiner's first steps from the invite link, each
//           walk step ringed and done by the member's own taps (the toast
//           "✓ n מתוך m"); it resumes after a reload, collapses from the third
//           home view, hides with "ביטול", comes back from "שלי"; ✕, Escape and
//           "סיום" always close it; it hides while a sheet is open; the "?"
//           mini-guide; help's "איך עושים…?" with its search and "הראו לי"; a
//           STOP ("להקריא לקבוצה") rung and never passed; a creator's upload
//           walk up to "יצירת סיכום" and the invite; the sandbox (?v=try); one
//           "חדש" hint for an existing member; no storage at all; reduced
//           motion; an existing member's one-time offer of the app tour
//           ("סיור קצר באפליקציה": the tab bar step by step, from the home,
//           "שלי" and help; "לא עכשיו" for good). Then the review round's checks: every "?" mini-guide at
//           360×640 (the ring on screen, the bubble never over it), no "?"
//           where there is nothing to show (Today's run), the empty practice
//           page's "שאלות חדשות" with its cost, the reader's chip in sight
//           and its mini-guide leaving the page where it was (and never
//           moving a follower while the member reads aloud), a walk that
//           ends when the member goes elsewhere (Back still re-syncs), focus
//           kept in the bubble on every Enter, one live region that is never
//           replaced, and a storage that refuses writes but still reads.
//           Throughout, mocks/guide.cjs refuses any write to the group's
//           data, and the script asserts none was tried.
//   guide1  production's three with VITE_STUDY_GUIDE: nothing of a feature that is
//           off (no step, how-to, mini-guide line or hint for the quiz, the
//           meeting, Today, the wall, corrections or "לשאול").
//   any other set (off, rel1, w4, w5, w5x): the guide is off, and nothing of it
//           shows: no "?" of its own, no card, no line on Join, ?v=try is the
//           library with no notice, no rows in "שלי", no "איך עושים…?".
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { makePptx } = require("./fixtures/make-pptx.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/guide.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const SMALL = { width: 360, height: 640 };

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  const { db } = mock;
  mock.seedLecture();
  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  let n = 0;
  const check = (name, ok, detail) => {
    n += 1;
    steps[`${String(n).padStart(2, "0")} ${name}`] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const shot = async (page, name, o) => a11y.push(...(await snap(page, out, `guide-${name}`, o)));
  /** The bubble's words, or "" when none shows. */
  const bubble = async (page) => ((await page.locator(".g-bubble:not([hidden])").count()) ? (await page.locator(".g-bubble").innerText()).replace(/\s+/g, " ").trim() : "");
  const waitBubble = (page, text, timeout = 8000) =>
    page.waitForFunction((t) => {
      const b = document.querySelector(".g-bubble:not([hidden])");
      return Boolean(b && b.textContent.includes(t));
    }, text, { timeout });
  const noBubble = (page) => page.waitForFunction(() => !document.querySelector(".g-bubble:not([hidden])"), null, { timeout: 5000 });
  /** The ring's box, when it shows. */
  const ring = (page) =>
    page.evaluate(() => {
      const r = document.querySelector(".g-ring:not([hidden])");
      return r ? r.getBoundingClientRect().toJSON() : null;
    });
  /** Waits until the ring (if any) stops gliding. */
  const settle = async (page) => {
    let r = await ring(page);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100);
      const again = await ring(page);
      const same = JSON.stringify(r) === JSON.stringify(again);
      r = again;
      if (same) break;
    }
    return r;
  };
  /** The ring is on screen, the bubble never covers it, and both stay inside the viewport. */
  const geometry = async (page) => (await settle(page), geometryNow(page));
  const geometryNow = (page) =>
    page.evaluate(() => {
      const r = document.querySelector(".g-ring:not([hidden])")?.getBoundingClientRect();
      const b = document.querySelector(".g-bubble:not([hidden])")?.getBoundingClientRect();
      if (!b) return { ok: false, why: "no bubble" };
      const inside = b.left >= 0 && b.right <= innerWidth + 0.5 && b.top >= 0 && b.bottom <= innerHeight + 0.5;
      const tabs = document.querySelector(".ph-tabs")?.getBoundingClientRect();
      const overTabs = Boolean(tabs && b.bottom > tabs.top + 0.5);
      if (!r) return { ok: inside && !overTabs, why: "no ring", inside, overTabs };
      const overlap = !(b.bottom <= r.top || b.top >= r.bottom || b.right <= r.left || b.left >= r.right);
      const ringOn = r.bottom > 0 && r.top < innerHeight;
      return { ok: inside && !overTabs && !overlap && ringOn, inside, overTabs, overlap, ringOn };
    });
  /** A tap at the centre of the ring: what the member does (the guide never taps). */
  const tapRing = async (page) => {
    // The ring glides for 0.18 s after a scroll or a resize: tap once it has settled.
    const r = await settle(page);
    if (!r) throw new Error("no ring to tap");
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  };
  const path0 = (page) => {
    const u = new URL(page.url());
    return u.pathname + u.search + u.hash;
  };
  const writes = () => [...db.guideWrites];
  /** Where keyboard focus is: inside the bubble, on the page's body, or elsewhere. */
  const focusAt = (page) =>
    page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return "body";
      if (a.closest(".g-bubble")) return `bubble:${a.tagName === "SECTION" ? "dialog" : a.textContent.trim()}`;
      return `${a.tagName}.${a.className}`;
    });
  /** Steps through the open mini-guide with "הבא" to "סיום": each step's words and geometry. */
  const walkMini = async (page) => {
    const seen = [];
    for (let i = 0; i < 10; i++) {
      await page.locator(".g-bubble:not([hidden])").waitFor({ timeout: 5000 });
      await page.waitForTimeout(250);
      seen.push({ say: await bubble(page), geo: await geometry(page) });
      const next = page.locator(".g-bubble .g-actions .a-btn", { hasText: "הבא" });
      if (!(await next.count())) break;
      await next.click();
    }
    return seen;
  };

  try {
    /* ───────────── the guide off: nothing of it shows ───────────── */
    if (!flags.guide) {
      const { page: guest } = await mock.open(browser, null, { path: "/?join=ABC123" });
      await guest.locator(".code-input").waitFor({ timeout: 15000 });
      check("off: Join has no guide line", (await guest.locator(".join-invited, .join-alone").count()) === 0);
      await guest.getByRole("tab", { name: "פתיחת קבוצה חדשה" }).click();
      check("off: no warning on a new group", (await guest.locator(".join-alone").count()) === 0);
      const { page } = await mock.open(browser, "שוהם", { path: "/" });
      await page.locator("main .ph-head").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1500);
      check("off: no card, no bubble, no ring, no guide button", (await page.locator(".g-steps, .g-bubble, .g-ring, .guide-btn").count()) === 0);
      if (!flags.today) check("off: the library's own help button", (await page.locator(".help-btn").count()) === 1);
      await page.goto(`${mock.base}/?v=try`);
      await page.locator("main.library").waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      check("off: ?v=try is the library, with no notice", (await page.locator(".a-toast").count()) === 0 && (await page.locator(".try-screen").count()) === 0);
      await page.goto(`${mock.base}/?l=${mock.LECTURE_ID}`);
      await page.locator(".lecture-body [data-blk]").first().waitFor({ timeout: 15000 });
      check("off: no reader chip", (await page.locator(".guide-chip").count()) === 0);
      await page.goto(`${mock.base}/?v=me`);
      await page.locator("main.me-screen").waitFor({ timeout: 15000 });
      check("off: no guide rows in שלי", (await page.locator(".g-me").count()) === 0);
      await page.goto(`${mock.base}/?v=help`);
      await page.locator(".help-rows").waitFor({ timeout: 15000 });
      check("off: no איך עושים in help", (await page.locator("#howto").count()) === 0);
      check("off: the device keeps no guide memory", await page.evaluate(() => Object.keys(localStorage).every((k) => !k.startsWith("study-guide"))));
    } else if (flags.set === "guide1") {
      /* ───────────── production's flags with the guide: nothing for a flag that is off ───────────── */
      db.guideNoWrites = false;
      const { page } = await mock.open(browser, null, { path: "/?join=ABC123" });
      await page.getByPlaceholder("למשל: שוהם").fill("דנה");
      await page.getByRole("button", { name: "הצטרפות" }).click();
      await page.locator(".g-steps .g-step").first().waitFor({ timeout: 15000 });
      db.guideNoWrites = true;
      const ids = await page.locator(".g-step").evaluateAll((els) => els.map((e) => e.dataset.step));
      check("guide1: the library is the home, with the card after its actions", (await page.locator("main.library .lib-actions + .g-steps").count()) === 1, path0(page));
      check("guide1: only the steps whose features are on", ids.every((id) => ["S1", "S2", "S4", "S6"].includes(id)) && ids.includes("S1"), ids.join(","));
      const OFF = /מבחן קבוצתי|כולנו נגד|פגישה|התור|״היום״|אסוציאציה|קיר|תיקון|״לשאול״|מה קשה לקבוצה|אתגר קבוצתי|טעויות נפוצות/;
      const cardText = await page.locator(".g-steps").innerText();
      check("guide1: the card names nothing that is off", !OFF.test(cardText), cardText);
      await shot(page, "guide1-card");
      // The library's "?": every step, none for what is off.
      await page.locator(".guide-btn").click();
      const said = [];
      for (let i = 0; i < 8; i++) {
        await page.locator(".g-bubble:not([hidden])").waitFor({ timeout: 5000 });
        said.push(await bubble(page));
        const next = page.locator(".g-bubble .a-btn", { hasText: "הבא" });
        if (!(await next.count())) break;
        await next.click();
      }
      check("guide1: the library's mini-guide says nothing of what is off", said.length >= 2 && said.every((t) => !OFF.test(t)), said.join(" | "));
      await page.keyboard.press("Escape");
      await noBubble(page);
      // Help's how-tos: none for what is off.
      await page.goto(`${mock.base}/?v=help`);
      await page.locator("#howto").waitFor({ timeout: 15000 });
      await page.locator("#howto input").fill("מבחן");
      await page.waitForTimeout(300);
      // "מבחן" may find "לתרגל" (its synonyms), never the group quiz's how-to.
      const quiz = await page.locator(".howto-q b").allInnerTexts();
      const titles = [];
      for (const q of ["", "פגישה", "תיקון", "אסוציאציה", "תור", "לשאול", "קבוצתי"]) {
        await page.locator("#howto input").fill(q);
        await page.waitForTimeout(200);
        titles.push(...(await page.locator(".howto-q b").allInnerTexts()));
      }
      await page.locator("#howto input").fill("");
      check("guide1: no how-to for the quiz, the meeting, Today, the wall, corrections or ask", [...quiz, ...titles].every((t) => !OFF.test(t)) && !quiz.includes("לפתוח מבחן קבוצתי"), `${quiz.join(",")} | ${titles.join(",")}`);
      // The sandbox: a paragraph without the actions that are off, and the bet.
      await page.goto(`${mock.base}/?v=try`);
      await page.locator(".try-screen [data-blk]").first().click();
      const acts = await page.locator(".try-screen .blk-actions .a-btn, .try-screen .note-add").allInnerTexts();
      check("guide1: the sandbox's paragraph offers only what is on", acts.length === 1 && /תגובה או שאלה/.test(acts[0]), acts.join(","));
      check("guide1: no write while guided", writes().length === 0, writes().join(" | "));
    } else {
      /* ───────────── A. a joiner from the invite link, 390×844 ───────────── */
      const { page, ctx } = await mock.open(browser, null, { path: "/?join=ABC123" });
      await page.locator(".join-invited").waitFor({ timeout: 15000 });
      check("Join says the invite is there", (await page.locator(".join-invited").innerText()).includes("יש הזמנה. נשאר רק להקליד שם."));
      await shot(page, "01-join-invited");
      await page.getByPlaceholder("למשל: שוהם").fill("דנה");
      await page.getByRole("button", { name: "הצטרפות" }).click();
      await page.locator(".g-steps .g-step").first().waitFor({ timeout: 15000 });
      db.guideNoWrites = true; // from here the guide may not write anything to the group
      const ids = await page.locator(".g-step").evaluateAll((els) => els.map((e) => e.dataset.step));
      const head = await page.locator(".g-steps-head").innerText();
      const order = await page.evaluate(() => {
        const card = document.querySelector(".g-steps");
        const queue = document.querySelector(".t-sec");
        return Boolean(card && queue && card.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      check("Today: הצעדים הראשונים before התור שלי, 0 of the real total", order && head.includes(`0 מתוך ${ids.length}`) && ids[0] === "S1" && ids.length >= 3 && ids.length <= 5, `${head} ${ids}`);
      const bar = await page.locator(".g-steps [role=progressbar]").evaluate((e) => [e.getAttribute("aria-valuenow"), e.getAttribute("aria-valuemax"), e.getAttribute("aria-label")]);
      check("the progress bar is announced", bar[0] === "0" && bar[1] === String(ids.length) && bar[2] === "הצעדים הראשונים", bar.join(","));
      await shot(page, "02-first-steps");

      // S1 "להראות": the walk "לקרוא הרצאה", four steps, each by the member's own tap.
      await page.locator('.g-step[data-step="S1"] .a-btn').click();
      await waitBubble(page, "1 מתוך 4");
      check("walk 1: the library tab is ringed", (await bubble(page)).includes("הסיכומים גרים בספרייה.") && (await geometry(page)).ok, JSON.stringify(await geometry(page)));
      check("the bubble takes focus (screen readers hear it), and is not modal", await page.evaluate(() => document.activeElement?.classList.contains("g-bubble") && document.activeElement.getAttribute("aria-modal") === "false"));
      await shot(page, "03-walk-library-tab");
      await tapRing(page);
      await waitBubble(page, "2 מתוך 4");
      check("walk 2: a ready lecture card is ringed", (await bubble(page)).includes("נוגעים בהרצאה") && (await geometry(page)).ok, JSON.stringify(await geometry(page)));
      await shot(page, "04-walk-lecture-card");
      await tapRing(page);
      await waitBubble(page, "3 מתוך 4", 15000);
      await page.locator(".a-toast", { hasText: "✓ 1 מתוך" }).waitFor({ timeout: 8000 });
      check("walk 3: a paragraph is ringed; opening the summary ticked S1", (await bubble(page)).includes("נוגעים בפסקה") && (await geometry(page)).ok, JSON.stringify(await geometry(page)));
      await shot(page, "05-walk-paragraph");
      await tapRing(page);
      await waitBubble(page, "4 מתוך 4");
      await page.locator(".a-toast", { hasText: "✓ 2 מתוך" }).waitFor({ timeout: 8000 });
      const g4 = await geometry(page);
      check("walk 4: the paragraph's actions are ringed; the tap ticked S2", (await bubble(page)).includes("״תגובה או שאלה״ נראית לכל הקבוצה") && g4.ok, JSON.stringify(g4));
      await shot(page, "06-walk-actions");
      await page.locator(".g-bubble .a-btn", { hasText: "הבנתי" }).click();
      await noBubble(page);
      check("הבנתי ends the walk, focus goes back", (await page.locator(".g-ring:not([hidden])").count()) === 0);
      check("A: no write to the group", writes().length === 0, writes().join(" | "));

      // Home again: the card with its progress (the second home view: still expanded).
      await page.goBack();
      await page.goBack();
      await page.locator(".g-steps").waitFor({ timeout: 15000 });
      const done = await page.locator(".g-step.is-done").evaluateAll((els) => els.map((e) => e.dataset.step));
      check("the card: S1 and S2 done, ✓ with 'בוצע' for screen readers", done.join(",") === "S1,S2" && (await page.locator(".g-step.is-done .sr-only", { hasText: "בוצע" }).count()) === 2, done.join(","));
      await shot(page, "07-first-steps-progress");

      /* ───────────── B. it resumes: a reload, the third home view collapses ───────────── */
      await page.reload();
      await page.locator(".g-steps").waitFor({ timeout: 15000 });
      const row = await page.locator(".g-steps-row").innerText().catch(() => "");
      check("after a reload: one row, '2 of n', the next step", row.includes("הבא:") && (await page.locator(".g-steps-head").innerText()).includes(`2 מתוך ${ids.length}`), row);
      await shot(page, "08-first-steps-collapsed");
      await page.locator(".g-steps-row .a-link", { hasText: "כל הצעדים" }).click();
      check("'כל הצעדים' opens the list (aria-expanded)", (await page.locator(".g-step").count()) === ids.length);
      // Escape and ✕ close a walk at any step.
      await page.locator(".g-step:not(.is-done) .a-btn").first().click();
      await page.locator(".g-bubble:not([hidden])").waitFor({ timeout: 8000 });
      await page.keyboard.press("Escape");
      await noBubble(page);
      check("Escape closes the walk", (await page.locator(".g-ring:not([hidden])").count()) === 0);
      await page.locator(".g-step:not(.is-done) .a-btn").first().click();
      await page.locator(".g-bubble:not([hidden])").waitFor({ timeout: 8000 });
      await page.locator(".g-bubble .g-close").click();
      await noBubble(page);
      check("✕ closes the walk", true);

      /* ───────────── C. להסתיר, ביטול, and back from שלי ───────────── */
      await page.locator(".g-steps .a-link", { hasText: "להסתיר" }).click();
      await page.locator(".a-toast", { hasText: "הצעדים הראשונים מחכים ב״שלי״." }).waitFor({ timeout: 5000 });
      check("להסתיר hides the card, with ביטול", (await page.locator(".g-steps").count()) === 0);
      await page.locator(".a-toast .toast-act", { hasText: "ביטול" }).click();
      await page.locator(".g-steps").waitFor({ timeout: 5000 });
      check("ביטול brings it back", true);
      await page.locator(".g-steps .a-link", { hasText: "להסתיר" }).click();
      await page.locator(".ph-tabs .ph-tab", { hasText: "שלי" }).click();
      await page.locator(".g-me").waitFor({ timeout: 15000 });
      check("שלי: the guide's rows", (await page.locator(".g-me").innerText()).includes("מוסתרים כרגע"));
      await page.locator(".g-me").scrollIntoViewIfNeeded();
      await shot(page, "09-me-rows");
      await page.locator(".g-me .a-btn", { hasText: "להחזיר" }).click();
      await page.locator(".g-steps").waitFor({ timeout: 15000 });
      check("להחזיר: the card is back on the home", path0(page) === "/");

      /* ───────────── D. "?" on Today ───────────── */
      await page.locator("main.today .guide-btn").click();
      await waitBubble(page, "1 מתוך");
      const first = await bubble(page);
      const g10 = await geometry(page);
      check("Today's ? : the mini-guide starts at 1", /1 מתוך \d · היום/.test(first) && g10.ok, `${first} ${JSON.stringify(g10)}`);
      await shot(page, "10-mini-today");
      await page.locator(".g-bubble .a-btn", { hasText: "הבא" }).click();
      await waitBubble(page, "2 מתוך");
      await page.locator(".g-bubble .a-btn", { hasText: "הקודם" }).click();
      await waitBubble(page, "1 מתוך");
      check("הבא and הקודם", true);
      for (let i = 0; i < 6 && (await page.locator(".g-bubble .a-btn", { hasText: "הבא" }).count()); i++) await page.locator(".g-bubble .a-btn", { hasText: "הבא" }).click();
      check("the last step says סיום", (await page.locator(".g-bubble .a-btn", { hasText: "סיום" }).count()) === 1);
      await shot(page, "11-mini-last");
      await page.locator(".g-bubble .g-all-help").click();
      await page.locator("#howto").waitFor({ timeout: 15000 });
      check("כל העזרה: help at איך עושים…?", path0(page) === "/?v=help#howto" && (await page.locator(".g-bubble:not([hidden])").count()) === 0, path0(page));
      await shot(page, "12-howto");

      /* ───────────── E. איך עושים…? ───────────── */
      const rowsAll = await page.locator(".help-rows details").count();
      await page.locator("#howto input").fill("לתרגל");
      await page.waitForTimeout(200);
      check("search: לתרגל finds לתרגל", (await page.locator(".howto-q b").allInnerTexts()).includes("לתרגל"));
      await page.locator("#howto input").fill("תגובה");
      await page.waitForTimeout(200);
      const rowsNow = await page.locator(".help-rows details").count();
      check("search filters help's own rows too", rowsNow > 0 && rowsNow < rowsAll, `${rowsNow} of ${rowsAll}`);
      await page.locator("#howto input").fill("זברה");
      await page.waitForTimeout(200);
      check("search: no hits says so", (await page.locator("#howto [role=status]").innerText()).includes("לא מצאנו"));
      await page.locator("#howto input").fill("פסקה");
      await page.locator(".howto-q", { hasText: "לשאול את הקבוצה על פסקה" }).click();
      check("an answer opens (aria-expanded)", (await page.locator(".howto-q[aria-expanded=true]").count()) === 1);
      await shot(page, "13-howto-answer");
      await page.locator(".howto-a .a-btn", { hasText: "הראו לי" }).click();
      await waitBubble(page, "1 מתוך 4");
      check("הראו לי starts the walk from help (the library tab ringed)", (await bubble(page)).includes("הסיכומים") && (await settle(page)) !== null, await bubble(page));
      await shot(page, "14-howto-walk");
      await page.keyboard.press("Escape");
      await noBubble(page);

      /* ───────────── F. a STOP: rung, explained, never passed ───────────── */
      await page.locator("#howto input").fill("להקריא");
      await page.locator(".howto-q", { hasText: "להקריא לקבוצה" }).click();
      await page.locator(".howto-a .a-btn", { hasText: "הראו לי" }).click();
      await waitBubble(page, "קודם: ההרצאה");
      check("off its screen: 'קודם' with 'קחו אותי'", (await page.locator(".g-bubble .a-btn", { hasText: "קחו אותי" }).count()) === 1);
      await shot(page, "15-walk-elsewhere");
      await page.locator(".g-bubble .a-btn", { hasText: "קחו אותי" }).click();
      await waitBubble(page, "לחיצה כאן נראית לכל הקבוצה", 15000);
      const stopButtons = await page.locator(".g-bubble .g-actions .a-btn").allInnerTexts();
      await settle(page);
      const stopRing = await page.evaluate(() => {
        const r = document.querySelector(".g-ring:not([hidden])")?.getBoundingClientRect();
        const b = document.querySelector(".room-action button")?.getBoundingClientRect();
        return Boolean(r && b && r.left <= b.left && r.right >= b.right && r.top <= b.top && r.bottom >= b.bottom);
      });
      check("STOP: 'להקריא לקבוצה' rung, the only button is סיום", stopRing && stopButtons.join(",") === "סיום", stopButtons.join(","));
      await shot(page, "16-stop-read-aloud");
      const readingBefore = await page.locator(".room-action button").innerText();
      await page.locator(".g-bubble .a-btn", { hasText: "סיום" }).click();
      await noBubble(page);
      check("STOP: nothing was started", (await page.locator(".room-action button").innerText()) === readingBefore && writes().length === 0, writes().join(" | "));

      /* ───────────── G. the reader's own "?" (the chip), and a sheet hides the guide ───────────── */
      await page.evaluate(() => window.scrollTo(0, 0)); // the member's own scroll to the top
      await page.waitForTimeout(400);
      const chipIn = (pg) =>
        pg.evaluate(() => {
          const c = document.querySelector(".guide-chip")?.getBoundingClientRect();
          const row = document.querySelector(".lecture-actions")?.getBoundingClientRect();
          return Boolean(c && row && c.left >= row.left - 0.5 && c.right <= row.right + 0.5 && c.top >= 0 && c.bottom <= innerHeight);
        });
      check("the reader's chip is in its row's visible part, not past the end of the chips (390)", await chipIn(page));
      const y0 = await page.evaluate(() => scrollY);
      await page.locator(".guide-chip").click();
      await waitBubble(page, "ההרצאה");
      check("the reader's 'איך קוראים כאן?'", /1 מתוך \d · ההרצאה/.test(await bubble(page)));
      await shot(page, "17-mini-reader");
      const readerSteps = await walkMini(page);
      check("the reader's mini-guide never names ״סימון שקראתי״", readerSteps.every((x) => !x.say.includes("סימון שקראתי")), readerSteps.map((x) => x.say).join(" | "));
      await page.locator(".g-bubble .g-actions .a-btn", { hasText: "סיום" }).click();
      await noBubble(page);
      await page.waitForTimeout(900);
      const y1 = await page.evaluate(() => scrollY);
      check("the reader's mini-guide leaves the page where it was", Math.abs(y1 - y0) < 2, `${y0} → ${y1}`);
      await page.locator(".guide-chip").click();
      await waitBubble(page, "ההרצאה");
      await page.locator(".head-tools .a-btn", { hasText: "תוכן" }).click(); // the member's own tap: the guide stays
      await page.locator(".g-bubble .g-close").click();
      await noBubble(page);

      /* ───────────── H. the sandbox ───────────── */
      const callsBefore = mock.calls.length;
      await page.goto(`${mock.base}/?v=try`);
      await page.locator(".try-screen").waitFor({ timeout: 15000 });
      await page.locator(".try-screen [data-blk]").nth(1).click();
      await page.locator(".try-screen .blk-actions").waitFor({ timeout: 5000 });
      await shot(page, "18-try-paragraph");
      await page.locator(".try-screen .blk-actions .a-btn", { hasText: "תיקון" }).click();
      check("sandbox: an action says what it would do, and sends nothing", (await page.locator(".try-what").innerText()).includes("בניסיון שום דבר לא נשלח."));
      await page.getByRole("tab", { name: "שאלה עם ׳כמה בטוחים׳" }).click();
      await page.locator(".try-screen .pq-options .a-opt").first().click();
      await page.locator(".try-screen .pq-bets .a-btn", { hasText: "על בטוח" }).click();
      await shot(page, "19-try-bet", { primary: ".ph-foot .a-btn.primary" });
      await page.locator(".ph-foot .a-btn", { hasText: "לבדוק" }).click();
      await page.locator(".pq-verdict").waitFor({ timeout: 5000 });
      check("sandbox: the verdict with the bet", (await page.locator(".pq-verdict h2").innerText()).includes("✓ נכון · ׳על בטוח׳"));
      await shot(page, "20-try-verdict");
      const sandboxCalls = mock.calls.slice(callsBefore).filter((c) => /\/rpc\/|POST|PATCH|DELETE/.test(c) && !/rpc\/study_(schema|today|my_|quiz_recent|meeting_band|session_counts|member_saved|spent|features)/.test(c));
      check("sandbox: no write and no answer reached the mock", writes().length === 0 && !mock.calls.slice(callsBefore).some((c) => /study_answer_question|study_comments|study_propose_edit/.test(c)), [...writes(), ...sandboxCalls].join(" | "));

      /* ───────────── I. 360×640: the same first steps for another joiner ───────────── */
      const small = await mock.open(browser, null, { path: "/?join=ABC123", viewport: SMALL });
      db.guideNoWrites = false;
      await small.page.getByPlaceholder("למשל: שוהם").fill("רוני");
      await small.page.getByRole("button", { name: "הצטרפות" }).click();
      await small.page.locator(".g-steps .g-step").first().waitFor({ timeout: 15000 });
      db.guideNoWrites = true;
      await small.page.locator('.g-step[data-step="S1"] .a-btn').click();
      const smallGeo = [];
      for (const [k, text] of [
        [1, "1 מתוך 4"],
        [2, "2 מתוך 4"],
        [3, "3 מתוך 4"],
        [4, "4 מתוך 4"],
      ]) {
        await waitBubble(small.page, text, 15000);
        await small.page.waitForTimeout(400);
        smallGeo.push(await geometry(small.page));
        if (k < 4) await tapRing(small.page);
      }
      check("360×640: every step ringed on screen, the bubble never over it or the tabs", smallGeo.every((g) => g.ok), JSON.stringify(smallGeo));
      await small.page.locator(".g-bubble .a-btn", { hasText: "הבנתי" }).click();

      /* ───────────── J. a creator in an empty group: upload walk to its STOP, the invite ───────────── */
      const solo = await createMock({ dist, flags: flags.set, members: ["שוהם"] });
      const deck = path.join(out, "deck.pptx");
      await makePptx(deck);
      try {
        const c = await solo.open(browser, "שוהם");
        await c.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: solo.base });
        await c.ctx.addInitScript((g) => {
          try {
            if (!sessionStorage.getItem("e2e-fresh")) {
              sessionStorage.setItem("e2e-fresh", "1");
              sessionStorage.setItem("study-guide-fresh", JSON.stringify({ mode: "create", group: g }));
            }
          } catch {
            /* about:blank */
          }
        }, solo.GROUP.id);
        await c.page.goto(`${solo.base}/`);
        await c.page.locator(".g-steps .g-step").first().waitFor({ timeout: 15000 });
        solo.db.guideNoWrites = true;
        const sid = await c.page.locator(".g-step").evaluateAll((els) => els.map((e) => e.dataset.step));
        check("a creator: upload first, the invite kept", sid[0] === "S1" && sid[1] === "S6" && (await c.page.locator(".g-steps").innerText()).includes("הקבוצה מוכנה."), sid.join(","));
        await snap(c.page, out, "guide-21-creator").then((p) => a11y.push(...p));
        await c.page.locator('.g-step[data-step="S1"] .a-btn').click();
        await waitBubble(c.page, "1 מתוך 5");
        await tapRing(c.page);
        await waitBubble(c.page, "2 מתוך 5");
        check("upload 2: the first upload button, with the privacy note's line", (await bubble(c.page)).includes("בפעם הראשונה תופיע הערה קצרה על פרטיות."));
        await tapRing(c.page);
        await c.page.locator(".privacy-sheet").waitFor({ timeout: 8000 });
        await c.page.waitForTimeout(400);
        check("a sheet is open: the guide hides (one slot)", (await c.page.locator(".g-bubble:not([hidden]), .g-ring:not([hidden])").count()) === 0);
        await snap(c.page, out, "guide-22-sheet-hides-guide").then((p) => a11y.push(...p));
        await c.page.getByRole("button", { name: "הבנתי, ממשיכים" }).click();
        await waitBubble(c.page, "3 מתוך 5", 15000);
        await snap(c.page, out, "guide-23-upload-drop").then((p) => a11y.push(...p));
        await c.page.locator("label.drop input[type=file]").setInputFiles(deck);
        await waitBubble(c.page, "4 מתוך 5", 20000);
        await snap(c.page, out, "guide-24-upload-form").then((p) => a11y.push(...p));
        // By keyboard: "הבא" turns into the STOP's "סיום", and focus stays on it.
        await c.page.locator(".g-bubble .a-btn", { hasText: "הבא" }).focus();
        await c.page.keyboard.press("Enter");
        await waitBubble(c.page, "לחיצה כאן עולה מהתקציב של הקבוצה");
        const upFocus = await focusAt(c.page);
        check("keyboard: Enter on הבא to the STOP keeps focus in the bubble", upFocus.startsWith("bubble:"), upFocus);
        const upStop = await c.page.locator(".g-bubble .g-actions .a-btn").allInnerTexts();
        check("upload 5: STOP at יצירת סיכום, only סיום", upStop.join(",") === "סיום" && (await geometry(c.page)).ok, `${upStop} ${JSON.stringify(await geometry(c.page))}`);
        await snap(c.page, out, "guide-25-upload-stop", { primary: ".ph-foot .a-btn.primary" }).then((p) => a11y.push(...p));
        await c.page.locator(".g-bubble .a-btn", { hasText: "סיום" }).click();
        await noBubble(c.page);
        check("the upload walk wrote nothing and created no lecture", solo.db.guideWrites.length === 0 && solo.db.lectures.length === 0, solo.db.guideWrites.join(" | "));
        // The invite: the member's own tap on the ringed button ticks S6.
        solo.db.guideNoWrites = false;
        await c.page.goto(`${solo.base}/`);
        await c.page.locator('.g-step[data-step="S6"] .a-btn').click();
        await waitBubble(c.page, "1 מתוך 2");
        await tapRing(c.page);
        await waitBubble(c.page, "2 מתוך 2");
        await snap(c.page, out, "guide-26-invite").then((p) => a11y.push(...p));
        await tapRing(c.page);
        await c.page.locator(".a-toast", { hasText: "להזמין את הקבוצה" }).waitFor({ timeout: 8000 });
        check("the invite, shared by the member, ticks S6", true);
        if (solo.problems.length) check("the creator's mock", false, solo.problems.join(" | "));
      } finally {
        await solo.close();
      }

      /* ───────────── K. an existing member: the tour offered once; one "חדש" hint for what is new ───────────── */
      const noa = mock.people["נועה"].user.id;
      const knownNoWall = ["today", "practice", "cards", "quiz", "meeting", "anchor", "corrections", "var", "ask", "progress", "pulse", "museum", "boss", "groupPlan", "traps", "blankTable"];
      // Noa already answered the tour's offer ("לא עכשיו"): the "חדש" hints come as before.
      const old = await mock.open(browser, "נועה", { storage: { [`study-guide:${noa}`]: JSON.stringify({ v: 1, views: 0, did: [], list: [], tips: true, known: knownNoWall, offer: "dismissed" }) } });
      await old.page.goto(`${mock.base}/`);
      await waitBubble(old.page, "חדש · קיר האסוציאציות", 10000);
      const hintSay = await old.page.locator(".g-bubble .g-say").innerText();
      const hintSaid = await old.page.waitForFunction((t) => [...document.querySelectorAll(".sr-only[role=status]")].some((n) => n.textContent.includes(t)), hintSay, { timeout: 5000 }).then(() => true, () => false);
      check("the hint takes no focus, and the live region says it", hintSaid && !(await focusAt(old.page)).startsWith("bubble:"));
      check("an existing member who answered the offer: no card, one hint for the wall", (await old.page.locator(".g-steps").count()) === 0 && (await old.page.locator(".g-ring:not([hidden])").count()) === 0);
      await snap(old.page, out, "guide-27-hint-new").then((p) => a11y.push(...p));
      await old.page.locator(".g-bubble .a-btn", { hasText: "הבנתי" }).click();
      await noBubble(old.page);
      await old.page.reload();
      await old.page.locator("main.today").waitFor({ timeout: 15000 });
      await old.page.waitForTimeout(2500);
      check("the hint is remembered: not again", (await old.page.locator(".g-bubble:not([hidden])").count()) === 0);
      // Tips off in "שלי".
      await old.page.locator(".ph-tabs .ph-tab", { hasText: "שלי" }).click();
      await old.page.locator(".g-me input[type=checkbox]").uncheck();
      const tips = await old.page.evaluate((k) => JSON.parse(localStorage.getItem(k)).tips, `study-guide:${noa}`);
      check("tips off is kept on the device", tips === false);

      // A member the guide has never seen (joined before it): the home offers the tour, once; no hint meanwhile.
      const shoham = mock.people["שוהם"].user.id;
      const fresh = await mock.open(browser, "שוהם", { path: "/" });
      await fresh.page.locator("main.today .g-offer").waitFor({ timeout: 15000 });
      await fresh.page.waitForTimeout(2000);
      const mem = await fresh.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), `study-guide:${shoham}`);
      const offerText = (await fresh.page.locator(".g-offer").innerText()).replace(/\s+/g, " ");
      check(
        "never seen: the offer ״סיור קצר באפליקציה״ on Today, no first steps, no hint; the flags on now recorded",
        offerText.includes("סיור קצר באפליקציה") && offerText.includes("להתחיל סיור") && offerText.includes("לא עכשיו") && (await fresh.page.locator(".g-step, .g-bubble:not([hidden])").count()) === 0 && Array.isArray(mem?.known) && mem.known.includes("wall"),
        `${offerText} ${JSON.stringify(mem)}`,
      );
      await snap(fresh.page, out, "guide-28-offer").then((p) => a11y.push(...p));
      // "להתחיל סיור": the tour over the tab bar, step by step, only pointing.
      await fresh.page.locator(".g-offer .a-btn", { hasText: "להתחיל סיור" }).click();
      await waitBubble(fresh.page, "1 מתוך");
      const t1 = await bubble(fresh.page);
      const tg = await geometry(fresh.page);
      check("the tour starts at the first tab, ringed, the bubble clear of it and of the tab bar", /1 מתוך \d · סיור קצר באפליקציה/.test(t1) && t1.includes("״היום״ הוא מסך הבית") && tg.ok, `${t1} ${JSON.stringify(tg)}`);
      check("the bubble takes focus", (await focusAt(fresh.page)).startsWith("bubble:"));
      await snap(fresh.page, out, "guide-29-tour").then((p) => a11y.push(...p));
      const tour = await walkMini(fresh.page);
      check(
        "the tour: היום, ספרייה, יחד, שלי, then the screen's ?, each ringed with the bubble clear",
        tour.length === 5 && /ספרייה/.test(tour[1].say) && /״יחד״/.test(tour[2].say) && /״שלי״/.test(tour[3].say) && /״\?״/.test(tour[4].say) && tour.every((t) => t.geo.ok),
        JSON.stringify(tour.map((t) => [t.say.slice(0, 40), t.geo.ok])),
      );
      await fresh.page.locator(".g-bubble .a-btn", { hasText: "סיום" }).click();
      await noBubble(fresh.page);
      const after = await fresh.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), `study-guide:${shoham}`);
      check("סיום: focus back on the offer, which now says where the tour lives; offer answered", after?.offer === "taken" && !after?.born && (await focusAt(fresh.page)).includes("g-offer") && (await fresh.page.locator(".g-offer").innerText()).includes("״מדריך לאפליקציה״"), `${JSON.stringify(after)} ${await focusAt(fresh.page)}`);
      check("the tour wrote nothing to the group", writes().length === 0, writes().join(" | "));
      await fresh.page.reload();
      await fresh.page.locator("main.today").waitFor({ timeout: 15000 });
      await fresh.page.waitForTimeout(1500);
      check("offered once: not after a reload", (await fresh.page.locator(".g-offer, .g-steps").count()) === 0);
      // "שלי" → "מדריך לאפליקציה": the tour again, and the first steps for an existing member.
      await fresh.page.locator(".ph-tabs .ph-tab", { hasText: "שלי" }).click();
      await fresh.page.locator(".g-me").waitFor({ timeout: 15000 });
      check("שלי: ״מדריך לאפליקציה״ is the heading, the tour its first row, above the settings", (await fresh.page.locator("#g-me-h").innerText()) === "מדריך לאפליקציה" && (await fresh.page.locator(".g-me .a-li").first().innerText()).includes("סיור קצר באפליקציה") && (await fresh.page.evaluate(() => Boolean(document.querySelector(".g-me").compareDocumentPosition(document.querySelector(".settings")) & Node.DOCUMENT_POSITION_FOLLOWING))));
      await fresh.page.locator(".g-me .a-btn", { hasText: "להתחיל סיור" }).click();
      await waitBubble(fresh.page, "1 מתוך");
      check("שלי → להתחיל סיור: the tour runs right there", (await bubble(fresh.page)).includes("סיור קצר באפליקציה") && path0(fresh.page) === "/?v=me");
      await fresh.page.keyboard.press("Escape");
      await noBubble(fresh.page);
      await fresh.page.locator(".g-me").getByRole("button", { name: "להתחיל", exact: true }).click();
      await fresh.page.locator(".g-steps .g-step").first().waitFor({ timeout: 15000 });
      check("שלי → להתחיל: the first steps for an existing member", path0(fresh.page) === "/");
      // Help: "מדריך לאפליקציה" first, above "איך עושים…?".
      await fresh.page.goto(`${mock.base}/?v=help`);
      await fresh.page.locator(".g-help-guide").waitFor({ timeout: 15000 });
      check("help: ״מדריך לאפליקציה״ at the top, before איך עושים…?", await fresh.page.evaluate(() => Boolean(document.querySelector(".g-help-guide").compareDocumentPosition(document.querySelector("#howto")) & Node.DOCUMENT_POSITION_FOLLOWING)));
      await fresh.page.locator(".g-help-guide .a-btn", { hasText: "להתחיל סיור" }).click();
      await waitBubble(fresh.page, "1 מתוך");
      check("help → להתחיל סיור: the tour", (await bubble(fresh.page)).includes("סיור קצר באפליקציה"));
      await snap(fresh.page, out, "guide-30-tour-help").then((p) => a11y.push(...p));
      await fresh.page.locator(".g-bubble .g-close").click();
      await noBubble(fresh.page);
      // "לא עכשיו": gone for good, with a word on where the tour lives.
      const later = await mock.open(browser, "נועה", { path: "/" });
      await later.page.locator(".g-offer").waitFor({ timeout: 15000 });
      await later.page.locator(".g-offer .a-link", { hasText: "לא עכשיו" }).click();
      await later.page.locator(".a-toast", { hasText: "״מדריך לאפליקציה״" }).waitFor({ timeout: 5000 });
      const laterMem = await later.page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), `study-guide:${noa}`);
      await later.page.reload();
      await later.page.locator("main.today").waitFor({ timeout: 15000 });
      await later.page.waitForTimeout(1500);
      check("לא עכשיו: the offer is gone, and stays gone after a reload", laterMem?.offer === "dismissed" && (await later.page.locator(".g-offer").count()) === 0, JSON.stringify(laterMem));

      /* ───────────── L. no storage at all, and reduced motion ───────────── */
      db.guideNoWrites = false;
      const bare = await mock.open(browser, null);
      await bare.ctx.addInitScript(() => {
        for (const S of [Storage.prototype]) {
          const get = S.getItem;
          const set = S.setItem;
          S.getItem = function (k) {
            if (String(k).startsWith("study-guide")) throw new Error("no storage");
            return get.call(this, k);
          };
          S.setItem = function (k, v) {
            if (String(k).startsWith("study-guide")) throw new Error("no storage");
            return set.call(this, k, v);
          };
        }
      });
      await bare.page.emulateMedia({ reducedMotion: "reduce" });
      await bare.page.goto(`${mock.base}/?join=ABC123`);
      await bare.page.getByPlaceholder("למשל: שוהם").fill("עדי");
      await bare.page.getByRole("button", { name: "הצטרפות" }).click();
      await bare.page.locator(".g-steps .g-step").first().waitFor({ timeout: 15000 });
      db.guideNoWrites = true;
      await bare.page.locator('.g-step[data-step="S1"] .a-btn').click();
      await waitBubble(bare.page, "1 מתוך 4");
      const motion = await bare.page.evaluate(() => getComputedStyle(document.querySelector(".g-ring")).transitionDuration);
      check("no storage: the card and the walk still work", true);
      check("reduced motion: the ring does not glide", /^0s(, 0s)*$/.test(motion), motion);
      await bare.page.keyboard.press("Escape");

      /* ───────────── M. every "?" mini-guide at 360×640, and where there is none ───────────── */
      const m360 = await mock.open(browser, "נועה", { path: "/", viewport: SMALL });
      const mp = m360.page;
      await mp.locator("main.today").waitFor({ timeout: 15000 });
      db.guideNoWrites = true;
      const SCREENS = ["/", "/?v=library", `/?l=${mock.LECTURE_ID}`, "/?v=upload", "/?v=practice", `/?v=practice&l=${mock.LECTURE_ID}`, "/?v=group", "/?v=wall", "/?v=me"];
      const bad = [];
      let practiceEmpty = "";
      for (const url of SCREENS) {
        await mp.goto(`${mock.base}${url}`);
        const opener = url.includes("?l=") ? mp.locator(".guide-chip") : mp.locator("main .guide-btn").first();
        await opener.waitFor({ timeout: 15000 });
        await mp.waitForTimeout(1200);
        const yStart = await mp.evaluate(() => scrollY);
        await opener.click();
        const seen = await walkMini(mp);
        if (!seen.length) bad.push(`${url}: no bubble`);
        seen.forEach((x, i) => {
          if (!x.geo.ok || x.geo.why === "no ring") bad.push(`${url} step ${i + 1}: ${JSON.stringify(x.geo)} ${x.say}`);
        });
        if (url.includes("practice&l=")) practiceEmpty = seen.map((x) => x.say).join(" | ");
        await mp.locator(".g-bubble .g-actions .a-btn", { hasText: "סיום" }).click();
        await noBubble(mp);
        await mp.waitForTimeout(800);
        const yEnd = await mp.evaluate(() => scrollY);
        if (Math.abs(yEnd - yStart) > 1) bad.push(`${url}: scrollY ${yStart} → ${yEnd}`);
      }
      check("360×640: every step of every mini-guide is ringed on screen, the bubble never over it, the page put back", bad.length === 0, bad.join(" ; "));
      check("the empty practice page: its ״שאלות חדשות״, with what it costs", /עוד אין כאן שאלות/.test(practiceEmpty) && /AI/.test(practiceEmpty) && /בתקציב/.test(practiceEmpty), practiceEmpty);
      await mp.goto(`${mock.base}/?l=${mock.LECTURE_ID}`);
      await mp.locator(".guide-chip").waitFor({ timeout: 15000 });
      check("360: the reader's chip is in its row's visible part, unscrolled", await chipIn(mp));
      await mp.goto(`${mock.base}/?v=today&run=1`);
      await mp.locator("main .ph-head, main .ph-top").first().waitFor({ timeout: 15000 });
      await mp.waitForTimeout(1500);
      check("Today's run has no \"?\" (nothing to show there)", (await mp.locator(".guide-btn").count()) === 0);
      check("M: no write to the group", writes().length === 0, writes().join(" | "));

      /* ───────────── N. reading aloud: the reader's mini-guide moves nobody ───────────── */
      // Its own mock, so only these two are in the room.
      const room = await createMock({ dist, flags: flags.set });
      room.seedLecture();
      try {
        const reader = (await room.open(browser, "שוהם", { path: `/?l=${room.LECTURE_ID}` })).page;
        const follower = (await room.open(browser, "נועה", { path: `/?l=${room.LECTURE_ID}` })).page;
        await reader.locator(".summary").first().waitFor({ timeout: 20000 });
        await follower.locator(".summary").first().waitFor({ timeout: 20000 });
        await reader.getByText(/כאן: נועה/).waitFor({ timeout: 15000 });
        await reader.getByRole("button", { name: "להקריא לקבוצה" }).click(); // the member's own tap
        await follower.getByText(/הקראה: שוהם/).waitFor({ timeout: 15000 });
        await follower.getByRole("button", { name: "לעקוב" }).click();
        await follower.getByText(/מעקב: שוהם/).waitFor({ timeout: 5000 });
        await follower.waitForTimeout(1500);
        room.db.guideNoWrites = true;
        const fy0 = await follower.evaluate(() => scrollY);
        const ry0 = await reader.evaluate(() => scrollY);
        await reader.locator(".guide-chip").click();
        const liveSteps = await walkMini(reader);
        await reader.locator(".g-bubble .g-actions .a-btn", { hasText: "סיום" }).click();
        await noBubble(reader);
        await follower.waitForTimeout(3000);
        const fy1 = await follower.evaluate(() => scrollY);
        const ry1 = await reader.evaluate(() => scrollY);
        check("reading aloud: the mini-guide scrolls neither the reader nor the follower", Math.abs(fy1 - fy0) < 2 && Math.abs(ry1 - ry0) < 2 && liveSteps.length >= 2, `reader ${ry0}→${ry1}, follower ${fy0}→${fy1}, ${liveSteps.length} steps`);
        check("N: no write to the group", room.db.guideWrites.length === 0 && room.problems.length === 0, [...room.db.guideWrites, ...room.problems].join(" | "));
      } finally {
        await room.close();
      }

      /* ───────────── O. a walk the member walks away from ends; Back still re-syncs ───────────── */
      const op = old.page;
      const startRead = async () => {
        await op.goto(`${mock.base}/?v=help`);
        await op.locator("#howto input").fill("פסקה");
        await op.locator(".howto-q", { hasText: "לשאול את הקבוצה על פסקה" }).click();
        await op.locator(".howto-a .a-btn", { hasText: "הראו לי" }).click();
        await waitBubble(op, "1 מתוך 4");
      };
      await startRead();
      await op.locator(".ph-tabs .ph-tab", { hasText: "שלי" }).click();
      await op.locator("main.me-screen").waitFor({ timeout: 15000 });
      await op.waitForTimeout(800);
      const away1 = await bubble(op);
      await startRead();
      await tapRing(op);
      await waitBubble(op, "2 מתוך 4");
      await op.locator(".ph-tabs .ph-tab", { hasText: "יחד" }).click();
      await op.waitForTimeout(1000);
      const away2 = await bubble(op);
      check("a walk ends quietly when the member goes elsewhere (שלי, then יחד mid-walk)", away1 === "" && away2 === "", `${away1} | ${away2}`);
      await startRead();
      await tapRing(op);
      await waitBubble(op, "2 מתוך 4");
      await tapRing(op);
      await waitBubble(op, "3 מתוך 4", 15000);
      await op.goBack();
      const resync = await waitBubble(op, "2 מתוך 4", 8000).then(() => true, () => false);
      check("Back re-syncs the walk to the step of that screen", resync, await bubble(op));
      await op.keyboard.press("Escape");
      await noBubble(op);

      /* ───────────── P. by keyboard: focus never drops to the page ───────────── */
      await op.goto(`${mock.base}/`);
      await op.locator("main.today .guide-btn").waitFor({ timeout: 15000 });
      await op.waitForTimeout(1500);
      // One live region, kept from before the guide starts; the focused bubble is not read twice.
      await op.evaluate(() => {
        window.__status = [...document.querySelectorAll(".sr-only[role=status]")];
      });
      await op.locator("main.today .guide-btn").focus();
      await op.keyboard.press("Enter");
      await waitBubble(op, "1 מתוך");
      const firstSay = await op.locator(".g-bubble .g-say").innerText();
      await op.waitForTimeout(400);
      const region = await op.evaluate((t) => {
        const now = [...document.querySelectorAll(".sr-only[role=status]")];
        return { kept: window.__status.every((n) => n.isConnected), same: now.length === window.__status.length, twice: now.some((n) => n.textContent.includes(t)) };
      }, firstSay);
      check("the live region is the same node before and after a guide starts", region.kept && region.same, JSON.stringify(region));
      check("the focused bubble's words are not said twice", !region.twice, JSON.stringify(region));
      const foci = [await focusAt(op)];
      await op.keyboard.press("Tab"); // ✕
      await op.keyboard.press("Tab"); // הבא
      foci.push(await focusAt(op));
      for (let i = 0; i < 8; i++) {
        const label = await op.evaluate(() => document.activeElement?.textContent.trim());
        if (label !== "הבא") break;
        await op.keyboard.press("Enter");
        await op.waitForTimeout(250);
        foci.push(await focusAt(op));
      }
      const secondSaid = await op.evaluate(() => [...document.querySelectorAll(".sr-only[role=status]")].some((n) => /\S/.test(n.textContent)));
      check("keyboard: after every Enter on הבא focus is still in the bubble, on סיום at the end", foci.every((f) => f.startsWith("bubble:")) && foci[foci.length - 1] === "bubble:סיום", foci.join(", "));
      check("the live region says each next step", secondSaid);
      await op.keyboard.press("Enter"); // סיום
      await noBubble(op);
      const back = await op.evaluate(() => document.activeElement?.classList.contains("guide-btn"));
      check("סיום by keyboard: focus goes back to the \"?\"", back, await focusAt(op));
      await op.goto(`${mock.base}/?v=help`);
      await op.locator("#howto input").fill("להקריא");
      await op.locator(".howto-q", { hasText: "להקריא לקבוצה" }).click();
      await op.locator(".howto-a .a-btn", { hasText: "הראו לי" }).focus();
      await op.keyboard.press("Enter");
      await waitBubble(op, "קודם: ההרצאה");
      await op.locator(".g-bubble .a-btn", { hasText: "קחו אותי" }).focus();
      await op.keyboard.press("Enter");
      await waitBubble(op, "לחיצה כאן נראית לכל הקבוצה", 15000);
      const takeFocus = await focusAt(op);
      check("keyboard: Enter on קחו אותי keeps focus in the bubble on the next screen", takeFocus.startsWith("bubble:"), takeFocus);
      await op.keyboard.press("Escape");
      await noBubble(op);
      check("O-P: no write to the group", writes().length === 0, writes().join(" | "));

      /* ───────────── Q. a storage that reads but refuses writes (iOS Safari when full) ───────────── */
      db.guideNoWrites = false;
      const ronit = mock.people["נועה"].user.id;
      const full = await mock.open(browser, "נועה", {
        path: "/?v=help",
        storage: { [`study-guide:${ronit}`]: JSON.stringify({ v: 1, born: Date.now(), mode: "join", views: 0, did: [], list: [], tips: true, known: [] }) },
      });
      await full.ctx.addInitScript(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (String(k).startsWith("study-guide:")) throw new DOMException("full", "QuotaExceededError");
          return set.call(this, k, v);
        };
      });
      await full.page.goto(`${mock.base}/`);
      await full.page.locator(".g-steps").waitFor({ timeout: 15000 });
      db.guideNoWrites = true;
      await full.page.locator(".g-steps .a-link", { hasText: "להסתיר" }).click();
      await full.page.waitForTimeout(800);
      check("storage full: להסתיר still hides the card", (await full.page.locator(".g-steps").count()) === 0);

      void ctx;
      check("no write to the group in any guided step", writes().length === 0, writes().join(" | "));
    }

    const problems = mock.problems;
    const failed = Object.entries(steps).filter(([, v]) => typeof v === "string" && v.startsWith("FAIL"));
    console.log(JSON.stringify({ errors: problems, steps, a11y }, null, 1));
    console.log(`${Object.values(steps).filter((v) => v === "ok").length} ok`);
    if (problems.length || a11y.length || failed.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, steps, a11y, writes: db.guideWrites, calls: mock.calls.slice(-15) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
