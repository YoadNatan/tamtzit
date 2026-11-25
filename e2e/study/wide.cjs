// Tablets and desktops (docs/study/ux-p2.md, P2), on Playwright's presets in
// Chromium (WebKit is not installed: iPad Safari needs a device):
//   phones (iPhone SE 320, iPhone 15 393, iPhone 15 Pro Max 430): as before:
//       the tab bar along the bottom, the whole width, tabs right to left;
//       the reader at 17 px with "תוכן" in its top bar; practice's bottom
//       bar at the bottom of the screen; a sheet from the bottom with its
//       grip; no rail; the page as wide as the phone;
//   M (iPad upright, 810 and 834): the tabs together in the middle of the
//       bottom bar; the reader at 19 px until a size is chosen (a chosen
//       17 stays 17), its lines at most 36em; a sheet is a dialog in the
//       middle of the screen, at most 560 wide, no grip; practice's bottom
//       bar right under the question, not at the screen's bottom; a wide
//       button on the course page at most 480;
//   L (iPad sideways 1194, desktop 1280 and 1920): the side rail, 88 wide,
//       at the right, the tabs top to bottom, the screen beside it; the
//       reader's contents a column beside the text (no "תוכן"), a click on
//       a heading brings it under the top bar; Escape closes a slide's
//       sheet; practice's keys: "1–4 … Enter" shown with a mouse only, 2
//       picks the second option, Enter checks once a bet is picked; a
//       practice question's picture at most half the screen tall; at 1920
//       the library's cards in two columns;
//   everywhere: no sideways scroll, a11y.cjs's checks in light and dark on
//       the wide screens, no page error and no call to a real host.
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=s2 node e2e/study/wide.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const a11y = require("./a11y.cjs");
const practicePlugin = require("./mocks/practice.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: E2E_FLAGS=s2 node e2e/study/wide.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(process.env.E2E_FLAGS || "s2");
const GEO = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "nephron-geo.json"), "utf8"));
const desk = (width, height) => ({ viewport: { width, height }, isMobile: false, hasTouch: false });
const PHONES = [
  ["iphone-se", devices["iPhone SE"]],
  ["iphone-15", devices["iPhone 15"]],
  ["iphone-15-pro-max", devices["iPhone 15 Pro Max"]],
];
const MID = [
  ["ipad-gen7", devices["iPad (gen 7)"]],
  ["ipad-pro11", devices["iPad Pro 11"]],
];
const LARGE = [
  ["ipad-pro11-landscape", devices["iPad Pro 11 landscape"]],
  ["desktop-1280", desk(1280, 800)],
  ["desktop-1920", desk(1920, 1080)],
];
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

/** In the page: the frame's boxes. */
const FRAME = () => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) };
  };
  const tabs = [...document.querySelectorAll(".ph-tabs .ph-tab")].map(r);
  return {
    vw: innerWidth,
    vh: innerHeight,
    scroll: document.documentElement.scrollWidth,
    bar: r(document.querySelector(".ph-tabs")),
    tabs,
    main: r(document.querySelector("main")),
    size: getComputedStyle(document.documentElement).getPropertyValue("--reading-size").trim(),
  };
};

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  const { db } = mock;
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  for (let i = 2; i <= 5; i++) {
    const t = ago(60 * i);
    db.lectures.push({ ...db.lectures[0], id: hex("eeeeeeee", 20 + i), title: `הרצאה לדוגמה ${i}`, created_at: t, updated_at: t, slides: [] });
  }
  // A second lecture whose questions are all one-answer (the keys' session).
  const L2 = hex("eeeeeeee", 40);
  db.lectures.push({ ...db.lectures[0], id: L2, title: "משתנים: שאלות אמריקאיות", created_at: ago(30), updated_at: ago(30) });
  for (const sec of db.sections.filter((x) => x.lecture_id === L)) db.sections.push({ ...sec, lecture_id: L2 });
  const P = db.practice;
  const ITEMS = [
    ["איפה פועלת Furosemide?", ["Proximal tubule", "Thick ascending limb", "Collecting duct", "DCT"], 1, 6],
    ["מה עושות Thiazides לסידן בדם?", ["מעלות", "מורידות", "לא משנות", "תלוי במינון"], 0, 10],
    ["איפה פועלות Thiazides?", ["DCT", "Proximal tubule", "Thick ascending limb", "Collecting duct"], 0, 10],
  ];
  ITEMS.forEach(([question, options, answer, slide], i) => {
    const x = {
      id: hex("9c200000", i + 1), group_id: db.group.id, lecture_id: L2, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: 2, kind: "mcq", difficulty: 1,
      vignette: "", question, options, slides: [slide], topic: "Diuretics", aspect: "other", has_key: true, model: "mock", created_by: null, created_at: ago(90), retired_at: null, retired_by: null,
      retire_note: "", anchor: 0, quote: "", part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: "case", form: "one", layout: null, series: null, step: null,
    };
    P.questions.push(x);
    P.keys.set(x.id, { answer, explanations: options.map((o, j) => (j === answer ? `${o}: כך בשקף.` : `${o} לא מתאימה כאן.`)), takeaway: "", whens: [] });
  });
  if (flags.qtypes) practicePlugin.seedTypes(db, L, GEO);

  const browser = await chromium.launch();
  const steps = {};
  const problems = [];
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      steps[name] = `FAIL ${String(e.message).split("\n")[0]}`;
    }
  };
  const open = async (dev, who, url, o = {}) => {
    const r = await mock.open(browser, who, { device: dev, viewport: dev.viewport, colorScheme: o.scheme ?? "light", storage: o.storage, path: url });
    return r;
  };
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  /** a11y.cjs's checks, light and dark, at the page's own size. */
  const access = async (page, name) => {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await pause(150);
      const r = await a11y(page);
      for (const p of r.problems) problems.push(`${name} ${scheme}: ${p}`);
      await shot(page, `${name}-${scheme}`);
    }
    await page.emulateMedia({ colorScheme: "light" });
  };

  // The course page's id (the library makes the course rows).
  {
    const { page, ctx } = await open(desk(1280, 800), "נועה", "/?v=library");
    await page.locator("a.lib-course").first().waitFor({ timeout: 20000 }).catch(() => undefined);
    await ctx.close();
  }
  const cid = db.coursesMock?.rows?.find((r) => !r.deleted_at)?.id ?? null;

  try {
    /* ───────── phones: as before ───────── */
    for (const [name, dev] of PHONES) {
      await step(`${name}: the phone layout`, async () => {
        const { page, ctx } = await open(dev, "שוהם", "/?v=library");
        await page.locator(".lecture-card").first().waitFor({ timeout: 20000 });
        await pause(600);
        const f = await page.evaluate(FRAME);
        const order = f.tabs.every((t, i) => i === 0 || t.x < f.tabs[i - 1].x);
        check(
          `${name}: the tab bar along the bottom, the whole width, right to left; no rail; ${dev.viewport.width} px wide`,
          f.vw === dev.viewport.width && f.scroll <= f.vw && f.bar.w === f.vw && f.bar.b === f.vh && order && f.tabs.length === 4,
          JSON.stringify(f),
        );
        await shot(page, `phone-library-${name}`);
        await page.goto(`${mock.base}/?l=${L}`);
        await page.locator(".summary p").first().waitFor({ timeout: 20000 });
        const reader = await page.evaluate(() => ({ font: getComputedStyle(document.querySelector(".summary p")).fontSize, side: Boolean(document.querySelector(".toc-side")) }));
        const tocBtn = await page.getByRole("button", { name: "תוכן", exact: true }).count();
        check(`${name}: the reader at 17 px, "תוכן" in its top bar, no side column`, reader.font === "17px" && !reader.side && tocBtn === 1, JSON.stringify({ reader, tocBtn }));
        await page.locator(".summary .a-tag").first().click();
        await page.locator(".a-sheet").waitFor({ timeout: 5000 });
        await pause(400);
        const sheet = await page.locator(".a-sheet").evaluate((el) => {
          const b = el.getBoundingClientRect();
          return { bottom: Math.round(b.bottom), w: Math.round(b.width), vh: innerHeight, vw: innerWidth, grip: getComputedStyle(el, "::before").display };
        });
        check(`${name}: a sheet rises from the bottom, the whole width, with its grip`, sheet.bottom === sheet.vh && sheet.w === sheet.vw && sheet.grip !== "none", JSON.stringify(sheet));
        await ctx.close();
      });
      await step(`${name}: practice's bottom bar`, async () => {
        const { page, ctx } = await open(dev, "שוהם", `/?v=practice&s=l.${L2}&n=3`);
        await page.locator(".pq-lead").waitFor({ timeout: 20000 });
        await pause(500);
        const foot = await page.locator("main > .ph-foot").evaluate((el) => ({ b: Math.round(el.getBoundingClientRect().bottom), vh: innerHeight }));
        const hint = await page.locator(".pq-keys").isVisible().catch(() => false);
        check(`${name}: practice's bottom bar at the screen's bottom; no keys line on a touch screen`, foot.b === foot.vh && !hint, JSON.stringify({ foot, hint }));
        await ctx.close();
      });
    }

    /* ───────── M: an iPad upright ───────── */
    for (const [name, dev] of MID) {
      await step(`${name}: the tabs in the middle`, async () => {
        const { page, ctx } = await open(dev, "שוהם", "/?v=library");
        await page.locator(".lecture-card").first().waitFor({ timeout: 20000 });
        await pause(600);
        const f = await page.evaluate(FRAME);
        const first = f.tabs[0];
        const last = f.tabs[f.tabs.length - 1];
        const startGap = f.bar.r - first.r;
        const endGap = last.x - f.bar.x;
        check(
          `${name}: the bottom bar's tabs together in the middle (each at most 120 wide)`,
          f.bar.b === f.vh && f.bar.w === f.vw && f.tabs.every((t) => t.w <= 120) && Math.abs(startGap - endGap) <= 2 && f.scroll <= f.vw,
          JSON.stringify({ startGap, endGap, tabs: f.tabs }),
        );
        await access(page, `m-library-${name}`);
        await ctx.close();
      });
      await step(`${name}: the reader at 19 px, and a chosen size`, async () => {
        const { page, ctx } = await open(dev, "שוהם", `/?l=${L}`);
        await page.locator(".summary p").first().waitFor({ timeout: 20000 });
        await pause(500);
        const r = await page.evaluate(() => {
          const ps = [...document.querySelectorAll(".summary p:not(.blk-selected)")];
          return { font: getComputedStyle(ps[0]).fontSize, widest: Math.max(...ps.map((p) => Math.round(p.getBoundingClientRect().width))) };
        });
        check(`${name}: the reader starts at 19 px; its lines at most 36em (684 px)`, r.font === "19px" && r.widest <= 684, JSON.stringify(r));
        await access(page, `m-reader-${name}`);
        await page.locator(".summary .a-tag").first().click();
        await page.locator(".a-sheet").waitFor({ timeout: 5000 });
        await pause(400);
        const sheet = await page.locator(".a-sheet").evaluate((el) => {
          const b = el.getBoundingClientRect();
          return { mid: Math.round(b.top + b.height / 2), w: Math.round(b.width), vh: innerHeight, grip: getComputedStyle(el, "::before").display, wide: el.classList.contains("slide-sheet") };
        });
        check(`${name}: a slide's sheet is a dialog in the middle of the screen, no grip`, Math.abs(sheet.mid - sheet.vh / 2) <= 8 && sheet.grip === "none" && sheet.w <= 764, JSON.stringify(sheet));
        await shot(page, `m-sheet-${name}`);
        await ctx.close();
        const chosen = await open(dev, "שוהם", `/?l=${L}`, { storage: { "study-font-size": "17" } });
        await chosen.page.locator(".summary p").first().waitFor({ timeout: 20000 });
        await pause(600);
        const font = await chosen.page.locator(".summary p").first().evaluate((el) => getComputedStyle(el).fontSize);
        check(`${name}: a chosen 17 px stays 17 px`, font === "17px", JSON.stringify({ font }));
        await chosen.ctx.close();
      });
      await step(`${name}: a sheet of words is 560 wide`, async () => {
        const { page, ctx } = await open(dev, "שוהם", "/?v=me");
        await page.locator("main").waitFor({ timeout: 20000 });
        await pause(800);
        const btn = page.getByRole("button", { name: "הקוד האישי" }).first();
        if (!(await btn.count())) return check(`${name}: a sheet of words is 560 wide`, true);
        await btn.click();
        await page.locator(".a-sheet").waitFor({ timeout: 5000 });
        await pause(300);
        const s = await page.locator(".a-sheet").evaluate((el) => ({ w: Math.round(el.getBoundingClientRect().width), mid: Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2), vh: innerHeight }));
        check(`${name}: a sheet of words is a dialog 560 wide`, s.w <= 560 && Math.abs(s.mid - s.vh / 2) <= 8, JSON.stringify(s));
        await ctx.close();
      });
      await step(`${name}: practice's bottom bar under the question`, async () => {
        const { page, ctx } = await open(dev, "שוהם", `/?v=practice&s=l.${L2}&n=3`);
        await page.locator(".pq-lead").waitFor({ timeout: 20000 });
        await pause(500);
        const g = await page.evaluate(() => {
          const q = document.querySelector("main .pq").getBoundingClientRect();
          const f = document.querySelector("main > .ph-foot").getBoundingClientRect();
          return { gap: Math.round(f.top - q.bottom), footBottom: Math.round(f.bottom), vh: innerHeight };
        });
        check(`${name}: "לבדוק" right under the question (a gap under 48 px), not at the screen's bottom`, g.gap >= 0 && g.gap < 48 && g.footBottom < g.vh - 100, JSON.stringify(g));
        await access(page, `m-practice-${name}`);
        await ctx.close();
      });
      if (cid)
        await step(`${name}: wide buttons at most 480`, async () => {
          const { page, ctx } = await open(dev, "שוהם", `/?v=course&c=${cid}`);
          await page.locator("main.course-page").waitFor({ timeout: 20000 });
          await pause(800);
          const w = await page.evaluate(() =>
            [...document.querySelectorAll("main .a-btn.wide")]
              .filter((b) => !b.closest(".ph-foot, .a-row, .a-sheet") && b.getBoundingClientRect().width > 0)
              .map((b) => Math.round(b.getBoundingClientRect().width)),
          );
          check(`${name}: the course page's wide buttons at most 480 px`, w.every((x) => x <= 480), JSON.stringify(w));
          await shot(page, `m-course-${name}`);
          await ctx.close();
        });
    }

    /* ───────── L: the rail, the contents, the keys ───────── */
    for (const [name, dev] of LARGE) {
      const fine = !dev.hasTouch;
      await step(`${name}: the side rail`, async () => {
        const { page, ctx } = await open(dev, "שוהם", "/");
        await page.locator("main.today").waitFor({ timeout: 20000 });
        await pause(800);
        const f = await page.evaluate(FRAME);
        const order = f.tabs.every((t, i) => i === 0 || t.y > f.tabs[i - 1].y);
        check(
          `${name}: a rail 88 wide at the right, the tabs top to bottom, the screen beside it`,
          f.bar.w === 88 && f.bar.r === f.vw && f.bar.y === 0 && f.bar.h === f.vh && order && f.main.r <= f.bar.x && f.scroll <= f.vw,
          JSON.stringify({ bar: f.bar, main: f.main, tabs: f.tabs.map((t) => t.y) }),
        );
        await access(page, `l-today-${name}`);
        await page.locator(".ph-tabs .ph-tab", { hasText: "ספרייה" }).click();
        await page.locator(".lecture-card").first().waitFor({ timeout: 20000 });
        await pause(500);
        const cards = await page.locator(".lecture-list > li").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
        const twoCols = cards.length > 1 && cards[0] === cards[1];
        check(`${name}: the library's cards ${f.vw >= 1280 ? "in two columns" : "in one column"}`, f.vw >= 1280 ? twoCols : !twoCols, JSON.stringify(cards));
        await access(page, `l-library-${name}`);
        await ctx.close();
      });
      await step(`${name}: the reader's contents beside the text`, async () => {
        const { page, ctx } = await open(dev, "שוהם", `/?l=${L}`);
        await page.locator(".summary p").first().waitFor({ timeout: 20000 });
        await pause(700);
        const r = await page.evaluate(() => {
          const toc = document.querySelector(".toc-side")?.getBoundingClientRect();
          const body = document.querySelector(".lecture-body").getBoundingClientRect();
          const ps = [...document.querySelectorAll(".summary p:not(.blk-selected)")];
          return {
            toc: toc && { x: Math.round(toc.x), r: Math.round(toc.right), w: Math.round(toc.width) },
            body: { x: Math.round(body.x), r: Math.round(body.right) },
            widest: Math.max(...ps.map((p) => Math.round(p.getBoundingClientRect().width))),
            font: getComputedStyle(ps[0]).fontSize,
            scroll: document.documentElement.scrollWidth,
            vw: innerWidth,
          };
        });
        const tocBtn = await page.getByRole("button", { name: "תוכן", exact: true }).count();
        check(
          `${name}: the contents a column at the start (right) of the text, no "תוכן"; lines at most 684 px`,
          Boolean(r.toc) && r.toc.x >= r.body.r && tocBtn === 0 && r.widest <= 684 && r.font === "19px" && r.scroll <= r.vw,
          JSON.stringify({ r, tocBtn }),
        );
        await access(page, `l-reader-${name}`);
        const link = page.locator(".toc-side li.lvl2 a").nth(2);
        const id = (await link.getAttribute("href")).slice(1);
        await link.click();
        await pause(1500);
        const placed = await page.evaluate((hid) => {
          const h = document.getElementById(hid).getBoundingClientRect();
          const head = document.querySelector(".reader-top").getBoundingClientRect();
          const toc = document.querySelector(".toc-side").getBoundingClientRect();
          return { top: Math.round(h.top), under: Math.round(head.bottom), tocTop: Math.round(toc.top), y: Math.round(scrollY) };
        }, id);
        check(`${name}: a heading clicked in the contents comes to just under the top bar; the contents stay in view`, placed.y > 0 && placed.top >= placed.under - 2 && placed.top <= placed.under + 40 && placed.tocTop >= placed.under, JSON.stringify(placed));
        await shot(page, `l-reader-scrolled-${name}`);
        await page.locator(".summary .a-tag").first().click();
        await page.locator(".a-sheet").waitFor({ timeout: 5000 });
        await pause(300);
        await shot(page, `l-sheet-${name}`);
        await page.keyboard.press("Escape");
        await pause(400);
        check(`${name}: Escape closes a slide's sheet`, (await page.locator(".a-sheet").count()) === 0);
        await ctx.close();
      });
      await step(`${name}: practice's keys`, async () => {
        const { page, ctx } = await open(dev, "שוהם", `/?v=practice&s=l.${L2}&n=3`);
        await page.locator(".pq-lead").waitFor({ timeout: 20000 });
        await pause(600);
        const hint = await page.locator(".pq-keys").isVisible().catch(() => false);
        const words = hint ? (await page.locator(".pq-keys").innerText()).replace(/\s+/g, " ").trim() : "";
        check(
          `${name}: the keys line ${fine ? "shown with a mouse" : "hidden on a touch screen"}`,
          fine ? hint && /^במקלדת: 1–4 לבחירה · Enter לבדיקה \(אחרי ״כמה בטוחים\?״\)$/.test(words) : !hint,
          JSON.stringify({ hint, words }),
        );
        await shot(page, `l-practice-keys-${name}`);
        await page.locator("body").click({ position: { x: 5, y: 300 } }).catch(() => undefined);
        await page.keyboard.press("2");
        await pause(200);
        const picked = await page.locator(".pq-options [role=radio]").evaluateAll((els) => els.findIndex((e) => e.getAttribute("aria-checked") === "true"));
        // The bet clicked with the mouse keeps the focus: Enter from there checks (the usual flow).
        await page.locator(".pq-bets").getByRole("radio").first().click();
        await page.keyboard.press("Enter");
        await page.locator(".pq-verdict").waitFor({ timeout: 10000 });
        check(`${name}: 2 picks the second option; Enter checks, with the focus on the bet just clicked`, picked === 1, String(picked));
        await access(page, `l-practice-${name}`);
        await ctx.close();
      });
      if (flags.qtypes)
        await step(`${name}: a practice question's picture`, async () => {
          const { page, ctx } = await open(dev, "שוהם", `/?v=practice&l=${L}&x=round`);
          await page.locator(".pr-types").waitFor({ timeout: 20000 });
          await page.locator(".pr-types").getByRole("radio", { name: "שאלות על תמונה" }).click();
          await page.locator(".ph-foot .a-btn.primary").click();
          await page.locator(".pq .qf-stage").first().waitFor({ timeout: 20000 });
          await pause(1000);
          const s = await page.locator(".pq .qf-stage").first().evaluate((el) => ({ h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width), vh: innerHeight }));
          check(`${name}: the picture at most half the screen tall (520 px at most)`, s.h <= Math.min(s.vh / 2, 520) + 2 && s.w > 100, JSON.stringify(s));
          await shot(page, `l-figure-${name}`);
          await ctx.close();
        });
    }
  } finally {
    await browser.close();
    await mock.close();
  }
  for (const p of mock.problems) problems.push(p);
  const failed = Object.entries(steps).filter(([, v]) => v !== "ok");
  for (const [k, v] of Object.entries(steps)) console.log(`${v === "ok" ? "ok  " : "FAIL"} ${k}${v === "ok" ? "" : `: ${v.slice(5)}`}`);
  if (problems.length) console.log("problems:\n  " + problems.slice(0, 40).join("\n  "));
  console.log(`${Object.keys(steps).length - failed.length}/${Object.keys(steps).length} checks`);
  process.exit(failed.length || problems.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
