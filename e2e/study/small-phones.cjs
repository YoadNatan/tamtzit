// Small phones, the on-screen keyboard and the notch (docs/study/ux-p1.md,
// WP4-WP7), on Playwright's phone presets in Chromium (WebKit is not
// installed: iOS's own keyboard and real insets need a device):
//   WP4 what a tap asks for next is on screen: after a pick, "כמה בטוחים?"
//       (practice, the live quiz) scrolls into view, clear of the bars; on
//       an iPhone SE the boss's four answers show under its HUD; Today's
//       "להתחיל" is on the first screen of an iPhone 15 and the queue's first
//       row on an SE (the tour's offer is under the queue); the simulation's
//       grid sheet shows "להגיש"; a stopped lecture says so by its title;
//   WP5 with the keyboard up (the viewport shrunk by 42%, as Android does) a
//       focused field and its button are not covered (the trap form, a
//       paragraph's comment composer); on a 1280 px computer, Tab through the
//       cards' deck and the wall: no focused control under the bars;
//   WP6 the ask screen keeps a 320 px page 320 wide; an exam photo's tools
//       never overlap or leave their card; the contents open in view after
//       scrolling; following on an SE shows the whole status; a failed exam
//       says so with "להעלות מבחן מחדש" and no empty list;
//   WP7 on an iPhone 15 with its insets emulated (59 top, 34 bottom), the top
//       bar under the live banner does not pad for the notch again.
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=s2 node e2e/study/small-phones.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const cardsPlugin = require("./mocks/cards.cjs");
const { makeExamFiles } = require("./fixtures/make-exam.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/small-phones.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(process.env.E2E_FLAGS || "s2");

const SE = devices["iPhone SE"];
const I15 = devices["iPhone 15"];
const PIXEL = devices["Pixel 7"];
const DESK = { viewport: { width: 1280, height: 800 } };
const PRIMARY = ".ph-foot .a-btn.primary";
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

/** In the page: where the screen is free to show things (under the sticky
 *  head and the banner, above the tab bar and a sticky bottom bar). */
const FREE = () => {
  const top = Math.max(0, ...[...document.querySelectorAll(".shell-stack, .ph-head, .ph-top")].map((e) => (getComputedStyle(e).position === "sticky" || getComputedStyle(e).position === "fixed" ? e.getBoundingClientRect().bottom : 0)));
  const bars = [...document.querySelectorAll(".ph-tabs, main > .ph-foot, main.today > .t-start")].filter((e) => {
    const p = getComputedStyle(e).position;
    return (p === "sticky" || p === "fixed") && getComputedStyle(e).display !== "none";
  });
  const bottom = Math.min(innerHeight, ...bars.map((e) => e.getBoundingClientRect().top));
  return { top, bottom, vh: innerHeight, vw: innerWidth };
};
/** Whether a locator's box is wholly inside the free part of the screen. */
async function shown(page, loc, o = {}) {
  const r = await loc.boundingBox();
  const free = await page.evaluate(FREE);
  const bottom = o.ignoreBars ? free.vh : free.bottom;
  const ok = Boolean(r) && r.y >= free.top - 1 && r.y + r.height <= bottom + 1;
  return { ok, r: r && { y: Math.round(r.y), b: Math.round(r.y + r.height) }, free };
}
/** Whether a tap at the element's centre lands on it (nothing drawn over it). */
const uncovered = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { ok: Boolean(t) && (el === t || el.contains(t)), on: t ? `${t.tagName.toLowerCase()}.${String(t.className).split(" ")[0]}` : null, y: Math.round(r.y), b: Math.round(r.bottom), vh: innerHeight };
  });

(async () => {
  const names = ["שוהם", "נועה", "איתי", "מאיה"];
  const mock = await createMock({ dist, flags: flags.set, members: names });
  const { db } = mock;
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const id = (name) => mock.people[name].user.id;
  let seq = 0;
  const fresh = () => mock.member(`חבר ${++seq}`).name;

  // Questions (practice rounds, the boss, Today's returns).
  const P = db.practice;
  P.notify = mock.notify;
  db.notifyCards = mock.notify;
  db.notifyWall = mock.notify;
  if (db.quiz) db.quiz.notify = mock.notify;
  const lec = db.lectures.find((l) => l.id === L);
  for (const sl of lec.slides) if (Array.isArray(sl.tables) && sl.tables.length && typeof sl.tables[0]?.[0] === "string") sl.tables = [sl.tables];
  for (let i = 0; i < 12; i++)
    P.points.push({ id: hex("b0170000", 900 + i), lecture_id: L, part_idx: 0, n: i, kind: i % 2 ? "process" : "structure", subject: "Nephron", text: `נקודה ${i + 1} על הנפרון`, anchor: i % 3, quote: "", slides: [3], red_flag: false, weight: 2, created_at: ago(60), updated_at: ago(60) });
  for (const s of db.sections.filter((x) => x.lecture_id === L))
    P.pointParts.set(`${L}:${s.idx}`, { lecture_id: L, part_idx: s.idx, status: "ready", src: s.markdown, lease_until: null, attempts: 0, error: null, updated_at: ago(60) });
  const ITEMS = [
    ["איפה פועלת Furosemide?", ["Proximal tubule", "Thick ascending limb", "Collecting duct", "DCT"], 1, 6, 2, "Furosemide"],
    ["מה עושות Thiazides לסידן בדם?", ["מעלות", "מורידות", "לא משנות", "תלוי במינון"], 0, 10, 3, "Thiazides"],
    ["איפה פועלות Thiazides?", ["DCT", "Proximal tubule", "Thick ascending limb", "Collecting duct"], 0, 10, 3, "Thiazides"],
    ["Spironolactone והאשלגן?", ["מורידה", "מעלה", "לא משנה", "רק בכליה"], 1, 13, 4, "Spironolactone"],
    ["מטופל בן 67 עם אי ספיקת לב ובצקות מקבל Furosemide במינון גבוה ומתלונן על חולשת שרירים. מה ההפרעה האלקטרוליטית הסבירה ביותר ומה המנגנון שלה בנפרון?", ["Hypokalemia: יותר Na⁺ מגיע ל-collecting duct ומוחלף ב-K⁺", "Hyperkalemia: עיכוב ENaC", "Hypercalcemia: ספיגה מוגברת ב-DCT", "Hyponatremia בלבד, בלי שינוי ב-K⁺"], 0, 6, 2, "Furosemide"],
  ];
  const mcq = ITEMS.map(([question, options, answer, slide, part, topic], i) => {
    const x = {
      id: hex("9c000000", i + 1), group_id: db.group.id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: part, kind: "mcq", difficulty: 1,
      vignette: i === 4 ? "גבר בן 67, אי ספיקת לב." : "", question, options, slides: [slide], topic, aspect: "other", has_key: true, model: "mock", created_by: null, created_at: ago(60), retired_at: null,
      retired_by: null, retire_note: "", anchor: 0, quote: "", part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: "case", points: [],
      request_id: null, form: "one", layout: null, series: null, step: null,
    };
    P.questions.push(x);
    P.keys.set(x.id, { answer, explanations: options.map((o, j) => (j === answer ? `${o}: כך בשקף ${slide}.` : `${o} לא מתאימה כאן.`)), takeaway: "מה לזכור", whens: [] });
    return x;
  });
  const B = db.bossMock;
  if (B) {
    const wrong = (qid) => (P.keys.get(qid).answer === 0 ? 1 : 0);
    const head = (name, qs, trap) => ({ name, qs: qs.map((x) => x.id), trap_q: trap ? qs[0].id : null, trap_opt: trap ? wrong(qs[0].id) : null, slides: qs[0].slides.slice(0, 2) });
    B.heads = [head("Furosemide", [mcq[0]]), head("Thiazides", [mcq[1], mcq[2]]), head("Spironolactone", [mcq[3]], true)];
    B.hot = 3;
    B.topics = 8;
    B.answersNext = 20;
  }
  // Today's queue (returns): for whoever asks, so a fresh member has rows.
  const Tm = db.todayMock;
  const queueFor = (who) => {
    Tm.returns.push({ user_id: id(who), question_id: mcq[0].id, lecture_id: L, wrong_at: ago(60 * 24), step: 1, choice: 0, bet: 3, fixed_in_discussion: true });
    Tm.returns.push({ user_id: id(who), question_id: mcq[1].id, lecture_id: L, wrong_at: ago(60 * 24 * 3), step: 2, choice: 2, bet: 2, fixed_in_discussion: false });
    Tm.returns.push({ user_id: id(who), question_id: mcq[3].id, lecture_id: L, wrong_at: ago(60 * 24 * 2), step: 1, choice: 0, bet: 2, fixed_in_discussion: false });
  };
  // Cards (the deck's Tab walk) and the wall (its Tab walk).
  for (const part of [0, 1, 2, 3, 4])
    for (const s of cardsPlugin.SAMPLES[part] ?? []) {
      const { para, ...f } = s;
      cardsPlugin.trapCard(db, { source: "ai", created_by: id("שוהם"), quote: "", lecture_id: L, part_idx: part, ...f, anchor: para ?? null });
    }
  if (db.aids) {
    const aid = (n, o) => ({
      id: hex("9d500000", n), group_id: db.group.id, lecture_id: L, part_idx: 2, anchor: 2, quote: "", drug: "Furosemide", kind: "line", body: "", fact: "Loop diuretics מעכבות NKCC2", slides: [6], photo: null, figure: null,
      remix_of: null, draft_id: null, draft_no: null, named_by: id("איתי"), credit_id: null, funny_n: 0, stuck_n: 0, flag: null, flagged_by: null, check_state: "ok", checked_at: ago(600), check_note: null, edited_at: null, created_at: ago(60 * 30), ...o,
    });
    for (let n = 1; n <= 6; n++) db.aids.push(aid(n, { body: `NKCC2 = שני כ׳ ושני סודיום, משפט ${n} לזכירה.`, funny_n: n % 3, stuck_n: n % 4, created_at: ago(60 * n) }));
  }
  // A lecture whose writing stopped (part 2 failed four times).
  const LF = hex("eeeeeeee", 77);
  db.lectures.push({ ...lec, id: LF, title: "הרצאה שהכתיבה בה נעצרה", status: "writing", created_at: ago(30), updated_at: ago(30) });
  for (const s of db.sections.filter((x) => x.lecture_id === L))
    db.sections.push({ ...s, lecture_id: LF, ...(s.idx >= 2 ? { status: "failed", markdown: "", error: "timeout", attempts: 4, retry_at: null } : {}) });

  const browser = await chromium.launch();
  const steps = {};
  let n = 0;
  const check = (name, ok, detail) => {
    n += 1;
    steps[`${String(n).padStart(2, "0")} ${name}`] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  /** One step: a failure is recorded, with what the screen said, and the
   *  next step runs. ONLY=<words> runs only the steps whose name has them. */
  let last = null;
  const step = async (name, fn) => {
    if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
    last = null;
    try {
      await fn();
    } catch (e) {
      const said = last ? await last.locator("main").first().innerText().catch(() => "") : "";
      check(`${name} (ran to the end)`, false, `${e.message.split("\n")[0]} | ${said.replace(/\s+/g, " ").slice(0, 300)}`);
    }
  };
  const openAs = async (who, opt) => {
    const o = await mock.open(browser, who, opt);
    last = o.page;
    return o;
  };

  // The course's row (the exam screens need it): the library makes it.
  {
    const { page, ctx } = await mock.open(browser, "שוהם", { path: "/?v=library" });
    await page.locator("main.library").waitFor({ timeout: 20000 });
    await pause(1200);
    await ctx.close();
  }
  const COURSE = mock.fixture.outline.course;
  const CID = db.coursesMock?.rows.find((r) => r.name === COURSE)?.id;
  const EX = db.examsMock;

  try {
    /* ───────── WP4: what a tap asks for next ───────── */
    for (const [key, device] of [["iphone-se", SE], ["iphone-15", I15]]) {
      await step(`${key}: practice`, async () => {
        const { page, ctx } = await openAs(fresh(), { device, path: `/?v=practice&l=${L}&x=round` });
        await page.locator(PRIMARY, { hasText: "להתחיל" }).click({ timeout: 20000 });
        await page.locator(".pq .pq-options .a-opt").first().waitFor({ timeout: 20000 });
        await pause(400);
        await page.locator(".pq-options .a-opt").first().click();
        await pause(900);
        const bets = await shown(page, page.locator(".pq-bets"));
        check(`${key}: practice, after a pick "כמה בטוחים?" is on screen, clear of the bottom bar`, bets.ok, JSON.stringify(bets));
        await shot(page, `wp4-practice-picked-${key}`);
        await ctx.close();
      });

      await step(`${key}: boss and live quiz`, async () => {
        const host = fresh();
        db.pulseMock?.night(db.members.map((m) => m.user_id)); // counted in the hard topics: the challenge opens
        const { page, ctx } = await openAs(host, { device, path: "/?v=boss&new=1" });
        await page.locator(".boss-meter").waitFor({ timeout: 20000 });
        await page.locator(PRIMARY, { hasText: "לפתוח את האתגר" }).click();
        await page.waitForURL((u) => u.search.includes("v=quiz") && u.search.includes("q="), { timeout: 20000 });
        await page.locator(".boss-hud").waitFor({ timeout: 20000 });
        const Z = db.quiz;
        const q = Z.quizzes[Z.quizzes.length - 1];
        for (const u of [id("איתי"), id("מאיה")]) Z.players.push({ quiz_id: q.id, user_id: u, joined_at: Date.now(), joined_idx: -1, seen_at: Date.now(), left_at: null, score: 0, correct_n: 0, answered_n: 0, ms_total: 0 });
        q.players_n = 3;
        await pause(500);
        await page.locator(PRIMARY, { hasText: "להתחיל" }).click();
        await page.locator("button.quiz-opt").first().waitFor({ timeout: 20000 });
        const t0 = Date.now();
        while (Date.now() - t0 < 15000 && !(await page.locator("button.quiz-opt").first().isEnabled())) await pause(200);
        await pause(300);
        if (key === "iphone-se") {
          const last = await shown(page, page.locator("button.quiz-opt").nth(3));
          check("iphone-se: the boss's HUD leaves all four answers on screen", last.ok, JSON.stringify(last));
          await shot(page, "wp4-boss-question-iphone-se");
        }
        await page.locator("button.quiz-opt").first().click();
        await pause(900);
        const bets = await shown(page, page.locator(".quiz-bets"));
        check(`${key}: live quiz, after a pick "כמה בטוחים?" is on screen`, bets.ok, JSON.stringify(bets));
        await shot(page, `wp4-quiz-picked-${key}`);
        for (const z of Z.quizzes) if (z.state !== "ended") Object.assign(z, { state: "ended", ended_at: new Date().toISOString() });
        await ctx.close();
      });

      await step(`${key}: Today`, async () => {
        const who = fresh();
        queueFor(who);
        const { page, ctx } = await openAs(who, { device, path: "/" });
        await page.locator("main.today .t-queue .t-row").first().waitFor({ timeout: 20000 });
        await pause(800);
        if (key === "iphone-15") {
          const start = await shown(page, page.locator("main.today > .t-start"), { ignoreBars: true });
          const tabs = await page.locator(".ph-tabs").boundingBox();
          const sticky = await page.locator("main.today > .t-start").evaluate((e) => getComputedStyle(e).position);
          check("iphone-15 (659 px): \"להתחיל\" is on the first screen, sticky over the tab bar", start.ok && sticky === "sticky" && start.r.b <= tabs.y + 1, JSON.stringify({ start, sticky, tabs: tabs?.y }));
        } else {
          const row = await shown(page, page.locator("main.today .t-queue .t-row").first());
          check("iphone-se: the queue's first row is on the first screen", row.ok, JSON.stringify(row));
        }
        if (flags.guide) {
          const order = await page.evaluate(() => {
            const q = document.querySelector("main.today .t-queue, main.today .t-empty");
            const g = document.querySelector("main.today .g-offer");
            return g && q ? Boolean(q.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
          });
          check(`${key}: the tour's offer is under the queue`, order === true, String(order));
        }
        await shot(page, `wp4-today-${key}`);
        await ctx.close();
      });
    }

    await step("iphone-se: the simulation's grid", async () => {
      if (!EX || !CID) return check("the simulation's grid (exams on)", !flags.exams, "no exams mock");
      EX.seed({ course: COURSE, title: "מועד ב׳ 2024", n: 60, minutes: 108 });
      const { page, ctx } = await openAs(fresh(), { device: SE, path: `/?v=mock&c=${CID}` });
      await page.locator(".s-src", { hasText: "מועד ב׳ 2024" }).click({ timeout: 20000 });
      await page.locator(PRIMARY).click();
      await page.waitForURL(/s=x\./, { timeout: 20000 });
      await page.locator(".m-pos").waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: "מפת השאלות" }).click();
      await page.locator(".m-sheet").waitFor({ timeout: 10000 });
      await pause(500);
      const submit = page.locator(".m-sheet").getByRole("button", { name: "להגיש" });
      const r = await submit.boundingBox();
      const sheet = await page.locator(".m-sheet").boundingBox();
      const cover = await uncovered(submit);
      check("iphone-se: the grid sheet shows \"להגיש\" without scrolling it", Boolean(r) && r.y + r.height <= Math.min(sheet.y + sheet.height, 568) + 1 && cover.ok, JSON.stringify({ r, sheet, cover }));
      await shot(page, "wp4-grid-iphone-se");
      await ctx.close();
    });

    await step("iphone-se: a stopped lecture", async () => {
      const { page, ctx } = await openAs(fresh(), { device: SE, path: `/?l=${LF}` });
      const box = page.locator(".lecture-stopped");
      await box.waitFor({ timeout: 20000 });
      const where = await shown(page, box, { ignoreBars: true });
      const text = (await box.innerText()).replace(/\s+/g, " ");
      check("iphone-se: a stopped lecture says so by its title, with \"המשך כתיבה\", on the first screen", where.ok && /\d+ חלקים לא נכתבו\./.test(text) && text.includes("המשך כתיבה"), JSON.stringify({ where, text }));
      await shot(page, "wp4-lecture-stopped-iphone-se");
      await ctx.close();
    });

    /* ───────── WP5: the keyboard ───────── */
    for (const [key, device] of [["iphone-se", SE], ["iphone-15", I15], ["pixel-7", PIXEL]]) {
      const kb = async (page) => {
        const vp = page.viewportSize();
        await page.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.58) });
        await pause(400);
        await page.evaluate(() => document.activeElement?.scrollIntoView({ block: "nearest" }));
        await pause(300);
        return () => page.setViewportSize(vp);
      };
      await step(`${key}: the trap form`, async () => {
        const { page, ctx } = await openAs(fresh(), { device, path: `/?v=trap&l=${L}&at=1.3` });
        await page.locator(".trap-form").waitFor({ timeout: 20000 });
        const fields = page.locator(".trap-form textarea, .trap-form input[type=text], .trap-form input:not([type])");
        const count = await fields.count();
        for (const i of [0, count - 1]) {
          await fields.nth(i).focus();
          const back = await kb(page);
          const f = await uncovered(fields.nth(i));
          const foot = await page.locator("main > .ph-foot").evaluate((e) => getComputedStyle(e).position).catch(() => "none");
          check(`${key}: the trap form's field ${i + 1} with the keyboard up: not under the bottom bar`, f.ok && f.b <= f.vh && foot !== "sticky", JSON.stringify({ f, foot }));
          if (i === 0) await shot(page, `wp5-trap-keyboard-${key}`);
          await back();
        }
        await ctx.close();
      });
      await step(`${key}: a paragraph's comment composer`, async () => {
        const { page, ctx } = await openAs(fresh(), { device, path: `/?l=${L}` });
        const para = page.locator(`[data-part="1"] [data-blk="2"]`);
        await para.waitFor({ timeout: 20000 });
        await pause(1500); // the read marks and chips arrive and redraw the paragraphs
        await para.click({ position: { x: 10, y: 10 } });
        await page.getByRole("button", { name: "תגובה או שאלה" }).click({ timeout: 8000 });
        const ta = page.locator(".a-sheet .composer textarea");
        await ta.waitFor({ timeout: 8000 });
        await ta.focus();
        const back = await kb(page);
        const t = await uncovered(ta);
        const send = await uncovered(page.locator(".a-sheet .composer").getByRole("button", { name: "לשלוח" }));
        check(`${key}: the comment composer with the keyboard up: the field and "לשלוח" in view`, t.ok && send.ok && t.b <= t.vh && send.b <= send.vh, JSON.stringify({ t, send }));
        await shot(page, `wp5-composer-keyboard-${key}`);
        await back();
        await ctx.close();
      });
    }

    for (const [name, url, ready] of [
      ["the cards' deck", `/?v=cards&l=${L}`, "main"],
      ["the wall", `/?v=wall&l=${L}`, "main"],
    ]) {
      await step(`desktop-1280: ${name}`, async () => {
        const { page, ctx } = await openAs(fresh(), { ...DESK, path: url });
        await page.locator(ready).first().waitFor({ timeout: 20000 });
        await pause(1500);
        const covered = [];
        let stops = 0;
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press("Tab");
          await pause(40);
          const s = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body || el.closest(".a-sheet, .ph-tabs, .ph-foot, .ph-head, .ph-top, .shell-stack")) return null;
            const r = el.getBoundingClientRect();
            if (r.bottom <= 0 || r.top >= innerHeight || !r.width) return null;
            const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            const ok = Boolean(t) && (el === t || el.contains(t));
            return { ok, text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 24), on: t ? String(t.className).split(" ")[0] || t.tagName : null };
          });
          if (!s) continue;
          stops += 1;
          if (!s.ok) covered.push(s);
        }
        check(`desktop-1280: Tab through ${name}: no focused control under the bars (${stops} stops)`, stops > 3 && covered.length === 0, JSON.stringify(covered.slice(0, 4)));
        await ctx.close();
      });
    }

    /* ───────── WP6: controls that broke ───────── */
    await step("iphone-se: the ask screen", async () => {
      const { page, ctx } = await openAs(fresh(), { device: SE, path: `/?v=ask&l=${L}` });
      await page.locator(".k-ask-screen .a-wrap > .a-chip").first().waitFor({ timeout: 20000 });
      await pause(500);
      const w = await page.evaluate(() => ({ inner: innerWidth, scroll: document.documentElement.scrollWidth }));
      check("iphone-se: the ask screen's chips wrap: the page stays 320 px wide", w.inner === 320 && w.scroll <= 320, JSON.stringify(w));
      await shot(page, "wp6-ask-iphone-se");
      await ctx.close();
    });

    if (EX && CID) {
      const files = await makeExamFiles(browser, path.join(out, "exam-files"));
      for (const [key, opt] of [["iphone-se", { device: SE }], ["desktop-1280", DESK]]) {
        await step(`${key}: exam photos`, async () => {
          const { page, ctx } = await openAs(fresh(), { ...opt, path: `/?v=exams&new=1&c=${CID}` });
          await page.getByRole("radio", { name: "לצלם דפים" }).click({ timeout: 20000 });
          await page.locator("#x-photos").setInputFiles(files.photos.slice(0, 6));
          await page.locator(".x-th").nth(5).waitFor({ timeout: 30000 });
          await pause(400);
          const bad = await page.evaluate(() => {
            const out = [];
            for (const th of document.querySelectorAll(".x-th")) {
              const card = th.getBoundingClientRect();
              const bs = [...th.querySelectorAll(".x-tools .a-btn")].map((b) => b.getBoundingClientRect());
              bs.forEach((a, i) => {
                if (a.left < card.left - 0.5 || a.right > card.right + 0.5) out.push(`button ${i + 1} leaves its card`);
                if (a.height < 43.5) out.push(`button ${i + 1} is ${Math.round(a.height)} px tall`);
                bs.slice(i + 1).forEach((b, j) => {
                  if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(`buttons ${i + 1} and ${i + j + 2} overlap`);
                });
              });
            }
            return out;
          });
          const strip = await page.locator(".x-strip").evaluate((s) => ({ sw: s.scrollWidth, cw: s.clientWidth }));
          check(`${key}: an exam photo's tools: 2×2, 44 px, inside the card, no overlap`, bad.length === 0, bad.slice(0, 4).join("; "));
          if (key === "desktop-1280") check("desktop-1280: with a mouse the photo strip wraps (nothing to scroll sideways)", strip.sw <= strip.cw + 1, JSON.stringify(strip));
          await shot(page, `wp6-exam-photos-${key}`);
          await ctx.close();
        });
      }
      await step("iphone-se: a failed exam", async () => {
        const failed = {
          id: hex("e0e00000", 882), group_id: db.group.id, course: COURSE, year: 2021, moed: "א׳", minutes: null, key_source: "marked", error: "no questions", skipped_open: 0, hide_from_profile: false,
          deleted_at: null, n_questions: 0, pages: 6, key_pages: 0, created_by: id("שוהם"), created_at: ago(30), retries: 0, title: "מועד ב׳ 2021", status: "failed",
        };
        EX.exams.push(failed);
        const { page, ctx } = await openAs(fresh(), { device: SE, path: `/?v=exams&e=${failed.id}&c=${CID}` });
        await page.locator("main [role=alert]").waitFor({ timeout: 20000 });
        await pause(800);
        const again = page.getByRole("link", { name: "להעלות מבחן מחדש" });
        check("a failed exam: its failure, \"להעלות מבחן מחדש\", no empty list", (await again.isVisible()) && (await page.locator("ul.r-rows").count()) === 0, await page.locator("main").innerText());
        await again.click();
        await page.getByRole("heading", { level: 1, name: "העלאת מבחן קודם" }).waitFor({ timeout: 15000 });
        check("\"להעלות מבחן מחדש\" opens a new upload", new URL(page.url()).searchParams.get("new") === "1");
        await ctx.close();
      });
    }

    await step("iphone-15: the contents after scrolling", async () => {
      const { page, ctx } = await openAs(fresh(), { device: I15, path: `/?l=${L}` });
      await page.locator(".summary").first().waitFor({ timeout: 20000 });
      await page.evaluate(() => window.scrollTo(0, 3000));
      await pause(400);
      await page.locator(".head-tools .a-btn", { hasText: "תוכן" }).click();
      const toc = page.locator("nav.toc");
      await toc.waitFor({ timeout: 5000 });
      const r = await toc.boundingBox();
      check("iphone-15: \"תוכן\" after scrolling opens in view", Boolean(r) && r.y >= 0 && r.y < 659 && r.y + r.height <= 659 + 1, JSON.stringify(r));
      await shot(page, "wp6-toc-scrolled-iphone-15");
      // An entry takes the reader there, and the contents close.
      await toc.locator("li a").nth(3).click();
      await pause(1200);
      check("an entry closes the contents and moves the reader", (await toc.count()) === 0);
      await ctx.close();
    });

    /* ───────── WP6 following on an SE, WP7 the notch under the banner ───────── */
    await step("reading aloud: following on an SE, and the notch under the banner", async () => {
      const { page: noa, ctx: noaCtx } = await mock.open(browser, "נועה", { ...DESK, path: `/?l=${L}` });
      await noa.locator(".summary").first().waitFor({ timeout: 20000 });
      await noa.getByRole("button", { name: "להקריא לקבוצה" }).click();

      const { page, ctx } = await openAs(fresh(), { device: SE, path: `/?l=${L}&follow=1` });
      const status = page.locator(".room-status.following");
      await status.waitFor({ timeout: 40000 });
      await pause(500);
      const fit = await status.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, text: e.innerText }));
      check("iphone-se: following, the status is whole (\"מעקב: נועה\")", fit.sw <= fit.cw + 1 && fit.text.includes("נועה"), JSON.stringify(fit));
      await shot(page, "wp6-follow-iphone-se");
      await ctx.close();

      const ctx15 = await browser.newContext({ ...I15, deviceScaleFactor: 1 });
      const viaCtx = { newContext: async () => ctx15 };
      const { page: p15 } = await mock.open(viaCtx, fresh(), {});
      const cdp = await ctx15.newCDPSession(p15);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
      await p15.goto(`${mock.base}/?v=practice&l=${L}`);
      await p15.locator(".live-banner .live-slot.is-shown").waitFor({ timeout: 40000 });
      await pause(800);
      const m = await p15.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top);width:1px";
        document.body.appendChild(probe);
        const inset = probe.getBoundingClientRect().height;
        probe.remove();
        const banner = document.querySelector(".live-banner").getBoundingClientRect();
        const head = document.querySelector("main > .ph-head");
        const t = head.querySelector(".t, h1");
        return { inset, bannerBottom: Math.round(banner.bottom), headTop: Math.round(head.getBoundingClientRect().top), pad: parseFloat(getComputedStyle(head).paddingTop), titleTop: Math.round((t ?? head).getBoundingClientRect().top) };
      });
      check("iphone-15 (insets 59/34): under the banner the top bar does not pad for the notch again (gap under 16 px)", m.inset === 59 && m.pad < 16 && m.titleTop - m.bannerBottom < 32 && Math.abs(m.headTop - m.bannerBottom) <= 1, JSON.stringify(m));
      await shot(p15, "wp7-banner-notch-iphone-15");
      await noa.getByRole("button", { name: "לסיים", exact: true }).click();
      await p15.locator(".live-banner.is-empty").waitFor({ state: "attached", timeout: 40000 });
      await pause(600);
      const plain = await p15.evaluate(() => parseFloat(getComputedStyle(document.querySelector("main > .ph-head")).paddingTop));
      check("iphone-15 (insets 59/34): with no banner the top bar pads for the notch", plain >= 59, String(plain));
      await shot(p15, "wp7-plain-notch-iphone-15");
      await ctx15.close();
      await noaCtx.close();
    });

    const failed = Object.entries(steps).filter(([, v]) => v.startsWith("FAIL"));
    console.log(JSON.stringify({ errors: mock.problems, steps }, null, 1));
    if (mock.problems.length || failed.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, steps }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
