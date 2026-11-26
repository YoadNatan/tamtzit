// Every main screen on every kind of device (docs/study/ux-p3.md, the
// cross-device audit's suite), on Playwright's presets in Chromium (WebKit is
// not installed: Safari itself needs a device):
//   devices: iPhone SE, iPhone 15, iPhone 15 Pro Max, Pixel 7, an iPad upright
//       and sideways (iPad Pro 11), and a computer at 1280×800 and 1920×1080
//       with a mouse;
//   screens: join (a visitor's), Today, the library, the reader, the reader's
//       contents (opened after scrolling on a phone; the side column at
//       1024 and up), a slide's sheet, a course, a practice session after a
//       pick, יחד, שלי, the install steps and the personal code's card; with
//       VITE_STUDY_SHEETS (flag sets "o0" and "o"), uploaded sheets' upload with the
//       synthetic sheet's PDF chosen (the pages and the details: two columns
//       from 760) and a ready sheet's review with an item open (the text on
//       the right, the page on the left from 760; the phone's list under it);
//   schemes: light everywhere; dark on iPhone 15, Pixel 7, the iPad sideways
//       and the 1280 computer (DARK=all for every device), which keeps the run
//       under about four minutes.
// Each screen, device and scheme fails on:
//   - a sideways scroll: the page wider than the device (Chromium's mobile
//     emulation zooms out to fit, so innerWidth must equal the device's width)
//     or scrollWidth over innerWidth;
//   - a11y.cjs's problems: a control's contrast, a hit area under 44×44 (on a
//     touch screen only: a mouse needs no finger's area), a title cut, a
//     sheet's tap-through;
//   - text that is read under 14 px: anything under 13 px, and 13 px only for
//     the few labels the type scale sets at 13 (the tab bar's labels and a
//     slide's tag under 768, a grade's interval, a length's count, a badge,
//     join's two tiles on a phone under 360);
//     a figure's own pins and drawn labels are part of the picture;
//   - any text's contrast under 4.5:1 (3:1 for large text) on a plain
//     background (text over a picture or a gradient is skipped; a disabled
//     control is exempt, as WCAG exempts it);
//   - a primary action that should show without scrolling and does not
//     (join's "הצטרפות", practice's "לבדוק" once a bet is picked, a sheet
//     wholly on screen);
//   - a console error, a page error or any of the mock's problems (a call to
//     a real host, an unknown column);
//   - a focused control under the tab bar or the rail, or under a screen's
//     bottom bar or top bar, in a Tab walk (on the iPads and computers, and on
//     iPhone 15 with a keyboard);
//   - the frame's asserts: the rail 88 wide from 1024, the reader's lines at
//     most 684 px from 768, a sheet in the middle of the screen from 768.
// One screenshot per screen, device and scheme: <out>/<screen>-<device>-<scheme>.png.
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=s2 node e2e/study/devices.cjs <dist> <out dir>
//   E2E_FLAGS=o0 or o (uploaded sheets) adds the screens sheet-upload and sheet-review.
//   DEVICES=iphone-se,desktop-1280 SCREENS=join,reader DARK=all  (to split a run)
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const a11y = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: E2E_FLAGS=s2 node e2e/study/devices.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(process.env.E2E_FLAGS || "s2");
const desk = (width, height) => ({ viewport: { width, height }, isMobile: false, hasTouch: false });
const ALL_DEVICES = [
  ["iphone-se", devices["iPhone SE"]],
  ["iphone-15", devices["iPhone 15"]],
  ["iphone-15-pro-max", devices["iPhone 15 Pro Max"]],
  ["pixel-7", devices["Pixel 7"]],
  ["ipad-portrait", devices["iPad Pro 11"]],
  ["ipad-landscape", devices["iPad Pro 11 landscape"]],
  ["desktop-1280", desk(1280, 800)],
  ["desktop-1920", desk(1920, 1080)],
];
const DARK_ON = new Set(["iphone-15", "pixel-7", "ipad-landscape", "desktop-1280"]);
const TAB_WALK = new Set(["iphone-15", "ipad-portrait", "ipad-landscape", "desktop-1280", "desktop-1920"]);
const ALL_SCREENS = ["join", "today", "library", "reader", "toc", "sheet", "course", "practice", "group", "me", "install", "code", ...(flags.sheets ? ["sheet-upload", "sheet-review"] : [])];
const pick = (env, all) => (env ? env.split(",").map((s) => s.trim()).filter(Boolean) : all);
const wantDevices = new Set(pick(process.env.DEVICES, ALL_DEVICES.map(([n]) => n)));
const wantScreens = new Set(pick(process.env.SCREENS, ALL_SCREENS));
const darkAll = process.env.DARK === "all";
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

/** In the page: the text that is read on screen, its size and its contrast.
 *  Returns problems as strings. */
const TEXT = ({ label13 }) => {
  const problems = [];
  const parse = (c) => {
    if (!c) return null;
    let m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(c);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(c);
    if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
    return null;
  };
  const over = (top, bottom) => {
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** What is painted behind: its own background and its ancestors', blended
   *  down to the page; null when a picture or a gradient is in the way. */
  const behind = (el) => {
    const layers = [];
    let opacity = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      opacity *= Number(s.opacity);
      if (s.backgroundImage !== "none") return null;
      if (n.tagName === "IMG" || n.tagName === "CANVAS" || n.tagName === "VIDEO") return null;
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0) layers.push(c);
      if (c && c[3] >= 1) break;
    }
    let color = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    if (color[3] < 1) color = over(color, parse(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255, 1]);
    if (color[3] < 1) color = over(color, [255, 255, 255, 1]);
    for (const l of layers.reverse()) color = over(l, color);
    return { color, opacity };
  };
  const shown = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      if (n.getAttribute("aria-hidden") === "true") return false;
    }
    return true;
  };
  const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""} "${(el.innerText || "").trim().slice(0, 30)}"`;
  const seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    // A figure's drawn labels and pins belong to the picture; screen-reader-only text is not shown.
    if (el.closest("svg, script, style, noscript, .qf-stage, .sr-only, .visually-hidden, [hidden]")) continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    const onScreen = rects.filter((r) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
    if (!onScreen.length) continue;
    if (!shown(el)) continue;
    // Text under a bar, a panel or a sheet's backdrop is not what is read there.
    const top = onScreen.find((r) => {
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return hit && (hit === el || el.contains(hit) || hit.contains(el));
    });
    if (!top) continue;
    // A clipped run (an input's ellipsis, a 1 px sr-only box) is not read as text.
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    if (size < 12.95) problems.push(`text ${size}px < 13px: ${name(el)}`);
    else if (size < 13.95 && !el.closest(label13)) problems.push(`text ${size}px < 14px: ${name(el)}`);
    if (el.closest(":disabled, [aria-disabled=true], .is-disabled")) continue;
    const fg = parse(s.color);
    const b = behind(el);
    if (!fg || !b) continue;
    const ink = over([fg[0], fg[1], fg[2], fg[3] * b.opacity], b.color);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(ink, b.color);
    if (got < need - 0.005) problems.push(`text contrast ${got.toFixed(2)}:1 < ${need}:1 on ${name(el)}`);
  }
  return problems;
};
/** The 13 px labels the type scale allows (tokens.css --text-tag, --text-tab). */
const LABEL13 = ".ph-tab, .a-tag, .src-tag, .a-grade small, .s-len small, .card-btn .ivl, .a-badge, .badge, .count-badge, .upload-detail, .join .a-seg > .a-btn";

/** In the page: is the focused control under a bar it is not in? */
const COVERED = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const bars = [...document.querySelectorAll(".ph-tabs, main > .ph-foot, .ph-head, .reader-top")].filter((b) => {
    const s = getComputedStyle(b);
    return (s.position === "fixed" || s.position === "sticky") && s.display !== "none" && s.visibility !== "hidden";
  });
  for (const bar of bars) {
    if (bar.contains(el) || el.contains(bar)) continue;
    // A sticky bar in the flow that is not stuck covers nothing.
    const b = bar.getBoundingClientRect();
    const x = Math.min(r.right, b.right) - Math.max(r.left, b.left);
    const y = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
    if (x > 2 && y > 2) {
      // Under it only if the bar is drawn above it there.
      const cx = Math.max(r.left, b.left) + x / 2;
      const cy = Math.max(r.top, b.top) + y / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (hit && bar.contains(hit)) return `${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" under ${bar.className.split(" ")[0]}`;
    }
  }
  return null;
};

(async () => {
  const t0 = Date.now();
  const mock = await createMock({ dist, flags: flags.set });
  const { db } = mock;
  mock.seedLecture();
  db.codes.on = true; // the personal code is offered (mocks/code.cjs): its card on שלי, its link on join
  const L = mock.LECTURE_ID;
  for (let i = 2; i <= 4; i++) {
    const t = ago(60 * i);
    db.lectures.push({ ...db.lectures[0], id: hex("eeeeeeee", 20 + i), title: `הרצאה לדוגמה ${i}`, created_at: t, updated_at: t, slides: [] });
  }
  // A lecture whose questions are all one-answer: the practice session.
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
      id: hex("9c300000", i + 1), group_id: db.group.id, lecture_id: L2, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: 2, kind: "mcq", difficulty: 1,
      vignette: "", question, options, slides: [slide], topic: "Diuretics", aspect: "other", has_key: true, model: "mock", created_by: null, created_at: ago(90), retired_at: null, retired_by: null,
      retire_note: "", anchor: 0, quote: "", part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: "case", form: "one", layout: null, series: null, step: null,
    };
    P.questions.push(x);
    P.keys.set(x.id, { answer, explanations: options.map((o, j) => (j === answer ? `${o}: כך בשקף.` : `${o} לא מתאימה כאן.`)), takeaway: "", whens: [] });
  });

  const browser = await chromium.launch();
  // Uploaded sheets (flag sets "o0" and "o"): the synthetic sheet's files, and a ready sheet of the course (mocks/sheets.cjs).
  let sheetFiles = null;
  let sheetRow = null;
  if (flags.sheets && (wantScreens.has("sheet-upload") || wantScreens.has("sheet-review"))) {
    const { makeSheetFiles, pageShots } = require("./fixtures/make-sheet.cjs");
    sheetFiles = await makeSheetFiles(browser, path.join(out, "files"));
    const clean = await pageShots(browser, path.join(out, "files"));
    sheetRow = db.sheetsMock.seed({ course: mock.fixture.outline.course, title: "תרגיל 3 · פרמקוקינטיקה", lecture: L, images: clean.slice(1) });
  }
  const steps = {};
  const problems = [];
  let shots = 0;
  const step = async (name, fn) => {
    try {
      const found = await fn();
      steps[name] = found && found.length ? `FAIL ${found.length} problem(s)` : "ok";
      for (const p of found ?? []) problems.push(`${name}: ${p}`);
    } catch (e) {
      steps[name] = `FAIL ${String(e.message).split("\n")[0]}`;
    }
  };
  let cid = null;
  /** The course's id, once the courses' mock has made its row (the library's first load). */
  const courseId = async () => {
    for (let i = 0; i < 50 && !cid; i++) {
      cid = db.coursesMock?.rows?.find((r) => !r.deleted_at)?.id ?? null;
      if (!cid) await pause(100);
    }
    return cid;
  };

  /** Every check on what is on screen now, in each scheme the device takes. */
  const checkNow = async (page, devName, dev, screen, o = {}) => {
    const found = [];
    const touch = Boolean(dev.hasTouch);
    const schemes = darkAll || DARK_ON.has(devName) ? ["light", "dark"] : ["light"];
    // A colour that is still fading from the other scheme is measured half way: no transitions while checking.
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" }).catch(() => undefined);
    for (const scheme of schemes) {
      await page.emulateMedia({ colorScheme: scheme });
      await pause(150);
      const before = mock.problems.length;
      const frame = await page.evaluate(() => ({ vw: innerWidth, sw: document.documentElement.scrollWidth }));
      if (frame.vw !== dev.viewport.width) found.push(`${scheme}: the page is ${frame.vw} wide on a ${dev.viewport.width} px screen (zoomed out to fit something wider)`);
      if (frame.sw > frame.vw + 1) found.push(`${scheme}: sideways scroll ${frame.sw} > ${frame.vw}`);
      const r = await a11y(page);
      for (const p of r.problems) if (touch || !p.startsWith("hit area")) found.push(`${scheme}: ${p}`);
      for (const p of await page.evaluate(TEXT, { label13: LABEL13 })) found.push(`${scheme}: ${p}`);
      if (o.primary) {
        const box = await page.locator(o.primary).first().boundingBox({ timeout: 1500 }).catch(() => null);
        const vh = dev.viewport.height;
        if (!box) found.push(`${scheme}: no primary action ${o.primary}`);
        else if (box.y < 0 || box.y + box.height > vh + 0.5) found.push(`${scheme}: the primary action ${o.primary} at ${Math.round(box.y)}–${Math.round(box.y + box.height)} is not on the ${vh} px screen`);
      }
      if (o.extra) for (const p of (await o.extra(page)) ?? []) found.push(`${scheme}: ${p}`);
      await page.screenshot({ path: path.join(out, `${screen}-${devName}-${scheme}.png`) });
      shots += 1;
      for (const p of mock.problems.slice(before)) found.push(`${scheme}: ${p}`);
    }
    await page.emulateMedia({ colorScheme: "light" });
    return found;
  };
  /** Tab through the screen: no focused control under a bar. */
  const tabWalk = async (page, devName, n = 24) => {
    if (!TAB_WALK.has(devName)) return [];
    const found = [];
    await page.evaluate(() => {
      document.activeElement?.blur?.();
      scrollTo(0, 0);
    });
    await pause(80);
    for (let i = 0; i < n; i++) {
      await page.keyboard.press("Tab");
      await pause(60);
      const c = await page.evaluate(COVERED);
      if (c) found.push(`Tab ${i + 1}: ${c}`);
    }
    await page.evaluate(() => document.activeElement?.blur?.());
    return found;
  };
  const go = async (page, url, ready) => {
    await page.goto(`${mock.base}${url}`);
    await page.locator(ready).first().waitFor({ timeout: 20000 });
    await pause(500);
  };

  try {
    for (const [devName, dev] of ALL_DEVICES) {
      if (!wantDevices.has(devName)) continue;
      const wide = dev.viewport.width >= 1024;
      const tablet = dev.viewport.width >= 768;
      const want = (s) => wantScreens.has(s);

      if (want("join"))
        await step(`${devName}: join`, async () => {
          const { page, ctx } = await mock.open(browser, null, { device: dev, viewport: dev.viewport, path: "/?join=ABC123" });
          await page.locator(".code-input").waitFor({ timeout: 20000 });
          await pause(500);
          const found = await checkNow(page, devName, dev, "join", { primary: ".join-form form .a-btn.primary" });
          await ctx.close();
          return found;
        });

      const { page, ctx } = await mock.open(browser, "שוהם", { device: dev, viewport: dev.viewport, path: "/?v=library" });
      await page.locator(".lecture-card").first().waitFor({ timeout: 20000 });
      cid ??= db.coursesMock?.rows?.find((r) => !r.deleted_at)?.id ?? null;
      try {
        if (want("today"))
          await step(`${devName}: Today`, async () => {
            await go(page, "/", "main.today");
            const found = await checkNow(page, devName, dev, "today", {
              extra: async (p) => {
                if (!wide) return [];
                const w = await p.locator(".ph-tabs").evaluate((el) => Math.round(el.getBoundingClientRect().width));
                return w === 88 ? [] : [`the rail is ${w} wide, not 88`];
              },
            });
            return found.concat(await tabWalk(page, devName, 16));
          });
        if (want("library"))
          await step(`${devName}: library`, async () => {
            await go(page, "/?v=library", ".lecture-card");
            const found = await checkNow(page, devName, dev, "library");
            return found.concat(await tabWalk(page, devName));
          });
        if (want("reader") || want("toc") || want("sheet"))
          await step(`${devName}: reader`, async () => {
            await go(page, `/?l=${L}`, ".summary p");
            const found = [];
            const lines = async (p) => {
              if (!tablet) return [];
              const widest = await p.evaluate(() => Math.max(...[...document.querySelectorAll(".summary p:not(.blk-selected)")].map((x) => Math.round(x.getBoundingClientRect().width))));
              return widest <= 684 ? [] : [`the reader's lines are ${widest} px wide (at most 684)`];
            };
            if (want("reader")) {
              found.push(...(await checkNow(page, devName, dev, "reader", { extra: lines })));
              found.push(...(await tabWalk(page, devName, 30)));
            }
            if (want("toc")) {
              // The contents after scrolling: a phone opens them from the top bar; 1024 and up has them beside the text.
              await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight / 3));
              await pause(400);
              if (!wide) {
                await page.getByRole("button", { name: "תוכן", exact: true }).click();
                await pause(400);
              }
              const sel = wide ? ".toc-side" : ".reader-top .toc, .toc";
              found.push(
                ...(await checkNow(page, devName, dev, "toc", {
                  extra: async (p) => {
                    const r = await p.locator(sel).first().boundingBox({ timeout: 1500 }).catch(() => null);
                    if (!r) return [`no contents (${sel})`];
                    return r.y < -1 || r.y > dev.viewport.height - 60 ? [`the contents at ${Math.round(r.y)}, not on screen`] : [];
                  },
                })),
              );
              if (!wide) {
                await page.getByRole("button", { name: "תוכן", exact: true }).click().catch(() => undefined);
                await pause(300);
              }
              await page.evaluate(() => scrollTo(0, 0));
              await pause(300);
            }
            if (want("sheet")) {
              await page.locator(".summary .a-tag").first().click();
              await page.locator(".a-sheet").waitFor({ timeout: 5000 });
              await pause(450);
              found.push(
                ...(await checkNow(page, devName, dev, "sheet", {
                  extra: async (p) => {
                    const s = await p.locator(".a-sheet").evaluate((el) => {
                      const b = el.getBoundingClientRect();
                      return { top: b.top, bottom: b.bottom, mid: b.top + b.height / 2, vh: innerHeight, vw: innerWidth };
                    });
                    const bad = [];
                    if (s.top < -1 || s.bottom > s.vh + 1) bad.push(`the sheet at ${Math.round(s.top)}–${Math.round(s.bottom)} is not wholly on the ${s.vh} px screen`);
                    if (s.vw >= 768 && s.vh >= 560 && Math.abs(s.mid - s.vh / 2) > 8) bad.push(`the sheet is not in the middle (${Math.round(s.mid)} of ${s.vh})`);
                    return bad;
                  },
                })),
              );
              await page.keyboard.press("Escape");
              await pause(300);
            }
            return found;
          });
        if (want("course") && cid)
          await step(`${devName}: course`, async () => {
            await go(page, `/?v=course&c=${cid}`, "main.course-page");
            await pause(300);
            const found = await checkNow(page, devName, dev, "course", {
              extra: async (p) => {
                if (dev.viewport.width < 600) return [];
                const w = await p.evaluate(() =>
                  [...document.querySelectorAll("main .a-btn.wide")].filter((b) => !b.closest(".ph-foot, .a-row, .a-sheet") && b.getBoundingClientRect().width > 0).map((b) => Math.round(b.getBoundingClientRect().width)),
                );
                return w.every((x) => x <= 480) ? [] : [`a wide button wider than 480: ${w}`];
              },
            });
            return found.concat(await tabWalk(page, devName));
          });
        if (want("practice"))
          await step(`${devName}: practice`, async () => {
            await go(page, `/?v=practice&s=l.${L2}&n=3`, ".pq-lead");
            await page.locator(".pq-options [role=radio]").first().click();
            await page.locator(".pq-bets").getByRole("radio").first().waitFor({ timeout: 5000 });
            await page.locator(".pq-bets").getByRole("radio").first().click();
            await pause(600);
            const found = await checkNow(page, devName, dev, "practice", {
              primary: "main > .ph-foot .a-btn.primary",
              extra: async (p) => {
                if (!tablet || wide) return [];
                const g = await p.evaluate(() => {
                  const opts = [...document.querySelectorAll(".pq-options [role=radio]")];
                  const last = opts[opts.length - 1].getBoundingClientRect();
                  const f = document.querySelector("main > .ph-foot .a-btn.primary").getBoundingClientRect();
                  return Math.round(f.top - last.bottom);
                });
                return g <= 260 ? [] : [`"לבדוק" is ${g} px under the last option`];
              },
            });
            return found;
          });
        if (want("group"))
          await step(`${devName}: יחד`, async () => {
            await go(page, "/?v=group", "main");
            await pause(500);
            const found = await checkNow(page, devName, dev, "group");
            return found.concat(await tabWalk(page, devName, 16));
          });
        if (want("me") || want("code"))
          await step(`${devName}: שלי`, async () => {
            await go(page, "/?v=me", "main");
            await pause(600);
            const found = [];
            if (want("me")) {
              found.push(...(await checkNow(page, devName, dev, "me")));
              found.push(...(await tabWalk(page, devName)));
            }
            if (want("code")) {
              const card = page.locator(".pc-card-wrap");
              await card.waitFor({ timeout: 10000 });
              await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
              await pause(400);
              found.push(...(await checkNow(page, devName, dev, "code")));
            }
            return found;
          });
        if (want("sheet-upload") && sheetFiles)
          await step(`${devName}: sheet-upload`, async () => {
            if (!(await courseId())) return ["no course row"];
            await go(page, `/?v=exams&new=sheet&c=${cid}&l=${L}`, "main.sheet-new");
            await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles(sheetFiles.pdf);
            await page.locator(".sx-pages").first().waitFor({ timeout: 60000 });
            await pause(500);
            const found = await checkNow(page, devName, dev, "sheet-upload", {
              primary: ".ph-foot .a-btn.primary",
              extra: async (p) => {
                const c = await p.evaluate(() => {
                  const f = document.querySelector(".sx-files").getBoundingClientRect();
                  const d = document.querySelector(".sx-details").getBoundingClientRect();
                  return { side: d.left >= f.right - 1, stacked: d.top >= f.bottom - 1 || f.top >= d.bottom - 1 };
                });
                if (dev.viewport.width >= 760) return c.side ? [] : ["the upload's details are not beside the pages (760 and up)"];
                return c.stacked ? [] : ["the upload's pages and details are not one under the other on a phone"];
              },
            });
            return found.concat(await tabWalk(page, devName, 16));
          });
        if (want("sheet-review") && sheetRow)
          await step(`${devName}: sheet-review`, async () => {
            if (!(await courseId())) return ["no course row"];
            await go(page, `/?v=exams&e=${sheetRow.id}&c=${cid}`, ".r-sum");
            await page.getByRole("radio", { name: /^הכל/ }).click();
            await page.locator(".r-head", { hasText: "שאלה 6" }).click();
            await page.locator(".r-item").waitFor({ timeout: 10000 });
            await pause(700);
            const found = await checkNow(page, devName, dev, "sheet-review", {
              extra: async (p) => {
                const r = await p.evaluate(() => {
                  const t = document.querySelector(".rw-text")?.getBoundingClientRect();
                  const g = document.querySelector(".rw-page")?.getBoundingClientRect();
                  return { wide: Boolean(document.querySelector(".exam-review.is-wide")), side: Boolean(t && g && t.left >= g.right - 1) };
                });
                if (dev.viewport.width >= 760) return r.wide && r.side ? [] : [`the review is not two columns, the text right of the page (${JSON.stringify(r)})`];
                return r.wide ? ["a phone's review is in two columns"] : [];
              },
            });
            return found.concat(await tabWalk(page, devName, 20));
          });
        if (want("install"))
          await step(`${devName}: install`, async () => {
            await go(page, "/?v=install", "main");
            await pause(600);
            if (new URL(page.url()).search !== "?v=install") return ["?v=install fell back (is VITE_STUDY_INSTALL on in this build?)"];
            const found = await checkNow(page, devName, dev, "install");
            return found.concat(await tabWalk(page, devName, 12));
          });
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await mock.close();
  }
  const failed = Object.entries(steps).filter(([, v]) => v !== "ok");
  for (const [k, v] of Object.entries(steps)) console.log(`${v === "ok" ? "ok  " : "FAIL"} ${k}${v === "ok" ? "" : `: ${v.slice(5)}`}`);
  const uniq = [...new Set(problems)];
  if (uniq.length) console.log("problems:\n  " + uniq.slice(0, 200).join("\n  "));
  console.log(`${Object.keys(steps).length - failed.length}/${Object.keys(steps).length} checks, ${shots} screenshots, ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
