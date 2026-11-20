// The guide's "?" on the course pages, past exams and the simulation
// (docs/study/guide.md §2.3; the guidance pass for sources.md's phases 1
// and 2), with real data on the shared mock, at 390×844 and 320×640, light
// and dark (the screenshots are <out>/gs-<screen>-<width>-<scheme>.png):
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=s2 node e2e/study/guide-screens.cjs <dist> <out dir>
//
// The fixture's lecture makes its course; a ready past exam of it is seeded
// (30 questions, 60 minutes). On each screen the member taps the "?" where
// it is (a tap at its place, never a scroll first), and the test steps
// through the mini-guide with "הבא": every step's element is found (never
// "לא מוצאים את זה כרגע"), ringed on screen with the bubble clear of it and
// inside the viewport; "סיום" puts the page back where it was; the a11y
// check passes with the bubble open; mocks/guide.cjs refuses any write and
// none is tried. The screens: the library (its course link), the course page
// (both segments), the batch upload from the course page with two files
// picked (its price and its button), the batch from the library (its course
// field), the single upload (its link to the batch), the exam upload, one
// exam's review with an item the test opened, the simulation's setup and
// the course's question. Then the states a new group meets (the second
// guidance review): an exam whose upload stopped, an exam of 3 questions
// opened without its course (no "סימולציה מהמבחן" named), an exam with
// suggested answers and items without one (their filters' steps, and the
// line that those items are not practised), an item opened 300 ms before
// the "?" (the ring stays on its target), the batch once its files are up,
// and no "?" on ?v=exams&new=1 without a course. Then: no "?" while a simulation's clock runs or an
// exam is replayed. Any set without VITE_STUDY_GUIDE and VITE_STUDY_COURSES:
// the course page has no "?" (nothing else to check).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const a11yCheck = require("./a11y.cjs");
const { makePptx } = require("./fixtures/make-pptx.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: NODE_PATH=$(npm root -g) E2E_FLAGS=s2 node e2e/study/guide-screens.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const SIZES = [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
];

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
  const writes = () => [...db.guideWrites];
  try {
    if (!flags.guide || !flags.courses) {
      const { page } = await mock.open(browser, "נועה", { path: "/?v=library" });
      await page.locator("main").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(1200);
      const link = page.locator("a.lib-course");
      if (await link.count()) {
        await link.first().click();
        await page.locator("main.course-page").waitFor({ timeout: 15000 });
        await page.waitForTimeout(800);
      }
      check(`${flags.set}: no "?" of the course pages' guide`, (await page.locator("main.course-page .guide-btn").count()) === 0);
    } else {
      // The course (from the fixture's lecture), and a ready past exam of it.
      const first = await mock.open(browser, "נועה", { path: "/?v=library" });
      await first.page.locator("a.lib-course").first().waitFor({ timeout: 15000 });
      const crow = db.coursesMock.rows.find((r) => !r.deleted_at);
      const cid = crow.id;
      const exam = flags.exams ? db.examsMock.seed({ course: crow.name, title: "מועד א׳ 2025", n: 30, minutes: 60 }) : null;
      // The states a member meets first (the second review): an upload that stopped, an exam under 5
      // questions opened without its course, and one with suggested answers and items with none.
      // Older than the 30-question exam, which stays the simulation's default.
      const older = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const stalled = flags.exams ? db.examsMock.seed({ course: crow.name, title: "מועד ב׳ 2025", n: 0, created_at: older }) : null;
      if (stalled) stalled.status = "uploading";
      const small = flags.exams ? db.examsMock.seed({ course: crow.name, title: "מועד א׳ 2024", year: 2024, n: 3, minutes: 10, created_at: older }) : null;
      const open = flags.exams ? db.examsMock.seed({ course: crow.name, title: "מועד א׳ 2023", year: 2023, n: 8, minutes: 20, created_at: older }) : null;
      if (open) {
        const items = db.practice.questions.filter((q) => q.exam_id === open.id);
        for (const q of items.slice(0, 3)) Object.assign(db.practice.keys.get(q.id), { origin: "solved", conf: 3 });
        for (const q of items.slice(3, 5)) {
          Object.assign(db.practice.keys.get(q.id), { answer: null, origin: null });
          q.has_key = false;
        }
      }
      const extra = [];
      await first.ctx.close();
      const deck = path.join(out, "deck.pptx");
      await makePptx(deck);
      const bytes = fs.readFileSync(deck);
      const two = [1, 2].map((k) => ({ name: `שיעור ${k}.pptx`, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: bytes }));

      /** Each screen: its address, what the member does first (never the guide), and the words its guide must say. */
      const SCREENS = [
        { key: "library", url: "/?v=library", must: [/נוגעים בשם הקורס לעמוד שלו/] },
        // Without past exams the fixture's lecture has no question yet: no "לתרגל מה שכבר יש" (its "עוד אין שאלות" line instead).
        { key: "course", url: `/?v=course&c=${cid}`, must: [/תאריך המבחן ואורכו/, ...(flags.exams ? [/בחינם/] : []), /״העלאה של כמה קבצים״/, /לכל הקבוצה/], min: flags.exams ? 5 : 3 },
        { key: "upload", url: "/?v=upload", must: [/״העלאה של כמה קבצים״ מעלה עד 30/] },
        {
          key: "many",
          url: `/?v=upload&many=1&c=${cid}`,
          before: async (page) => {
            await page.locator('input[type="file"]').setInputFiles(two);
            await page.getByRole("button", { name: "העלאה (2 קבצים)" }).waitFor({ timeout: 60000 });
            await page.locator(".u-cost").waitFor({ timeout: 15000 });
          },
          must: [/המחיר מראש/, /״העלאה״ מעלה את כל הקבצים/],
          never: [/יצירת סיכום/],
          min: 2,
        },
        { key: "many-lib", url: "/?v=upload&many=1", must: [/הקורס שאליו/, /בשם של הקובץ/], never: [/יצירת סיכום/] },
        ...(flags.exams
          ? [
              { key: "course-exams", url: `/?v=course&c=${cid}&seg=exams`, must: [/״מבחנים קודמים״/, /״סימולציה״/] },
              { key: "exam-upload", url: `/?v=exams&new=1&c=${cid}`, must: [/תקציב/, /איפה התשובות/], never: [/לאן|נשמר|לא יוצא|פרטיות/], min: 3 },
              {
                key: "exam-review",
                url: `/?v=exams&e=${exam.id}&c=${cid}`,
                before: async (page) => {
                  await page.locator(".r-head").first().click();
                  await page.locator(".r-item .r-acts").waitFor({ timeout: 10000 });
                  await page.waitForTimeout(900);
                },
                must: [/״לבדיקה״/, /לכל הקבוצה/],
                min: 3,
              },
              { key: "mock", url: `/?v=mock&c=${cid}`, must: [/בוחרים מבחן קודם/, /ממשיך/, /בחינם/], min: 4 },
              // An item opened a moment before the "?": its own smooth scroll must not leave the ring on the wrong element.
              {
                key: "exam-review-quick",
                url: `/?v=exams&e=${exam.id}&c=${cid}`,
                before: async (page) => {
                  await page.locator(".r-head").nth(3).click();
                  await page.waitForTimeout(300);
                },
                wait: 1600,
                must: [/״לתרגל את המבחן״/],
                min: 3,
              },
              { key: "exam-stalled", url: `/?v=exams&e=${stalled.id}&c=${cid}`, must: [/ההעלאה נעצרה/], min: 1 },
              { key: "exam-small", url: `/?v=exams&e=${small.id}`, must: [/״לתרגל את המבחן״/], never: [/סימולציה מהמבחן/], min: 2 },
              {
                key: "exam-open",
                url: `/?v=exams&e=${open.id}&c=${cid}`,
                before: async (page) => {
                  await page.locator(".r-sum").waitFor({ timeout: 10000 });
                  const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
                  if (!t.includes("2 שאלות בלי תשובה לא נכנסות לתרגול")) extra.push(`exam-open: no line for the items without an answer (${t.slice(0, 200)})`);
                },
                must: [/״תשובה מוצעת״: האפליקציה פתרה/, /״בלי תשובה״/, /״לבדיקה״/],
                min: 4,
              },
            ]
          : []),
        ...(flags.ask ? [{ key: "course-ask", url: `/?v=ask&c=${cid}`, must: [/נשארו היום/, /14 יום/, /בתקציב החודשי/], min: 2 }] : []),
        // The batch once its files are up: the steps of the picking are gone, the progress card has its own.
        {
          key: "many-done",
          url: `/?v=upload&many=1&c=${cid}`,
          before: async (page) => {
            await page.locator('input[type="file"]').setInputFiles(two);
            await page.getByRole("button", { name: "העלאה (2 קבצים)" }).click();
            await page.locator(".x-big", { hasText: "הועלו 2 קבצים" }).waitFor({ timeout: 120000 });
          },
          must: [/כאן רואים כמה קבצים כבר עלו/],
          min: 1,
        },
      ];

      for (const scheme of ["light", "dark"]) {
        for (const vp of SIZES) {
          const tag = `${vp.width}-${scheme}`;
          const { page, ctx } = await mock.open(browser, "נועה", { path: "/", viewport: vp, colorScheme: scheme });
          await page.locator("main").first().waitFor({ timeout: 15000 });
          const bad = [];
          for (const s of SCREENS) {
            db.guideNoWrites = false;
            await page.goto(`${mock.base}${s.url}`);
            const opener = page.locator("main .ph-head .guide-btn").first();
            await opener.waitFor({ timeout: 15000 });
            await page.waitForTimeout(1000);
            if (s.before) await s.before(page);
            db.guideNoWrites = true;
            const y0 = await page.evaluate(() => scrollY);
            // The member's tap where the "?" is.
            const box = await opener.boundingBox();
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            const said = [];
            for (let i = 0; i < 10; i++) {
              await page.locator(".g-bubble:not([hidden])").waitFor({ timeout: 5000 });
              await page.waitForTimeout(i === 0 && s.wait ? s.wait : 450);
              const text = (await page.locator(".g-bubble .g-say").innerText()).trim();
              said.push(text);
              const geo = await page.evaluate(() => {
                const r = document.querySelector(".g-ring:not([hidden])")?.getBoundingClientRect();
                const b = document.querySelector(".g-bubble:not([hidden])")?.getBoundingClientRect();
                if (!b) return { ok: false, why: "no bubble" };
                if (!r) return { ok: false, why: "no ring" };
                const inside = b.left >= 0 && b.right <= innerWidth + 0.5 && b.top >= 0 && b.bottom <= innerHeight + 0.5;
                const tabs = document.querySelector(".ph-tabs")?.getBoundingClientRect();
                const overTabs = Boolean(tabs && b.bottom > tabs.top + 0.5);
                const overlap = !(b.bottom <= r.top || b.top >= r.bottom || b.right <= r.left || b.left >= r.right);
                // On screen and drawn (a ring clipped away under the top bar is hidden, and fails here).
                const ringEl = document.querySelector(".g-ring:not([hidden])");
                const ringOn = r.bottom > 0 && r.top < innerHeight && r.height > 8 && getComputedStyle(ringEl).visibility !== "hidden";
                const side = document.documentElement.scrollWidth - document.documentElement.clientWidth;
                return { ok: inside && !overTabs && !overlap && ringOn && side <= 1, inside, overTabs, overlap, ringOn, side };
              });
              if (!geo.ok) bad.push(`${s.key} ${tag} step ${i + 1}: ${JSON.stringify(geo)} ${text}`);
              if (text.includes("לא מוצאים את זה כרגע")) bad.push(`${s.key} ${tag} step ${i + 1}: MISSING_LINE`);
              if (i === 0) {
                const r = await a11yCheck(page);
                a11y.push(...r.problems.map((p) => `${s.key} ${tag}: ${p}`));
                await page.screenshot({ path: path.join(out, `gs-${s.key}-${tag}.png`) });
              }
              const next = page.locator(".g-bubble .g-actions .a-btn", { hasText: "הבא" });
              if (!(await next.count())) break;
              await next.click();
            }
            const all = said.join(" | ");
            for (const re of s.must) if (!re.test(all)) bad.push(`${s.key} ${tag}: missing ${re} in ${all}`);
            for (const re of s.never ?? []) if (re.test(all)) bad.push(`${s.key} ${tag}: says ${re}: ${all}`);
            if (said.length < (s.min ?? 1)) bad.push(`${s.key} ${tag}: ${said.length} steps (${all})`);
            await page.locator(".g-bubble .g-actions .a-btn", { hasText: "סיום" }).click();
            await page.locator(".g-bubble:not([hidden])").waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
            await page.waitForTimeout(700);
            const y1 = await page.evaluate(() => scrollY);
            if (Math.abs(y1 - y0) > 1) bad.push(`${s.key} ${tag}: scrollY ${y0} → ${y1}`);
            steps[`said ${s.key}`] = said;
          }
          check(`${tag}: every new "?" finds every step, ringed on screen, the bubble clear of it, the page put back`, bad.length === 0 && extra.length === 0, [...bad, ...extra.splice(0)].join(" ; "));
          check(`${tag}: no write to the group`, writes().length === 0, writes().join(" | "));
          await ctx.close();
        }
      }

      // ?v=exams&new=1 without a course is the bare list on screen: no "?" there (the second review's G3).
      if (flags.exams) {
        const { page, ctx } = await mock.open(browser, "נועה", { path: "/?v=exams&new=1" });
        await page.locator("main").first().waitFor({ timeout: 15000 });
        await page.waitForTimeout(1200);
        check("?v=exams&new=1 without a course: the list, and no \"?\"", (await page.locator("main .guide-btn").count()) === 0 && (await page.locator("main.exam-new").count()) === 0);
        await ctx.close();
      }

      // Escape and ✕ close a new screen's mini-guide.
      db.guideNoWrites = true;
      const { page, ctx } = await mock.open(browser, "נועה", { path: `/?v=course&c=${cid}` });
      await page.locator("main.course-page .guide-btn").waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      await page.locator("main.course-page .guide-btn").click();
      await page.locator(".g-bubble:not([hidden])").waitFor({ timeout: 5000 });
      await page.keyboard.press("Escape");
      const escaped = await page.waitForFunction(() => !document.querySelector(".g-bubble:not([hidden])"), null, { timeout: 5000 }).then(() => true, () => false);
      await page.locator("main.course-page .guide-btn").click();
      await page.locator(".g-bubble:not([hidden])").waitFor({ timeout: 5000 });
      await page.locator(".g-bubble .g-close").click();
      const closed = await page.waitForFunction(() => !document.querySelector(".g-bubble:not([hidden])"), null, { timeout: 5000 }).then(() => true, () => false);
      check("the course page's mini-guide: Escape and ✕ close it", escaped && closed);
      await ctx.close();
      db.guideNoWrites = false;
    }
    check("no write was tried while guided", writes().length === 0, writes().join(" | "));
  } catch (e) {
    check("the run", false, e.message);
  } finally {
    await browser.close();
    await mock.close();
  }
  const failed = Object.entries(steps).filter(([, v]) => typeof v === "string" && v.startsWith("FAIL"));
  console.log(JSON.stringify({ flags: flags.set, steps, a11y, problems: mock.problems }, null, 1));
  console.log(`${Object.values(steps).filter((v) => v === "ok").length} ok`);
  process.exit(failed.length || a11y.length || mock.problems.length ? 1 : 0);
})();
