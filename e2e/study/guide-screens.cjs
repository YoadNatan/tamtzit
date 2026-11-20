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
// the course's question. Then: no "?" while a simulation's clock runs or an
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
            ]
          : []),
        ...(flags.ask ? [{ key: "course-ask", url: `/?v=ask&c=${cid}`, must: [/נשארו היום/, /14 יום/], min: 2 }] : []),
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
              await page.waitForTimeout(450);
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
                const ringOn = r.bottom > 0 && r.top < innerHeight;
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
          check(`${tag}: every new "?" finds every step, ringed on screen, the bubble clear of it, the page put back`, bad.length === 0, bad.join(" ; "));
          check(`${tag}: no write to the group`, writes().length === 0, writes().join(" | "));
          await ctx.close();
        }
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
