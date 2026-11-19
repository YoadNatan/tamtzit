// Package B end to end, as Yoad's decision 2 (17 Nov 2026) redefines it: once
// server writing finishes a summary, the server reads the lecture's points to
// know by itself (server/study/bank.ts; docs/study/practice-2-api.md §10), so
// practice 2.0's מה ליצור opens with its numbers. Against the mock, with
// package Q's plugin (mocks/practice.cjs) and B's (mocks/ahead.cjs, which plays
// the worker): the setup screen shows the read ahead's progress on every phone
// as the server's ("נקראות מעצמן", never "במכשיר אחר"), part by part, live;
// then opens with the numbers, and no phone asked for the read; a part the read
// ahead failed shows its reason and "לנסות שוב", which reads only that part;
// a text is never read ahead twice; at the cap the read ahead skips quietly and
// "לקרוא את הנקודות" stays; no question or card is written; help says what
// B does. Screenshots at every step, each through
// a11y.cjs in light and dark at 390×844 and 360×640.
//
//   VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
//   VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 [more] npx vite build --outDir <dist>
//   NODE_PATH=$(npm root -g) node e2e/study/ahead.cjs <dist> <out dir> [off|rel1|rel2|k|all|notoday]
// B adds no flag: its screen is practice's (VITE_STUDY_PRACTICE). off: practice
// is replaced, and help says nothing of B.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const practice = require("./mocks/practice.cjs");
const ahead = require("./mocks/ahead.cjs");

const [dist, out, flagSet = process.env.E2E_FLAGS || "rel1"] = process.argv.slice(2);
if (!dist || !out || !["off", "rel1", "rel2", "k", "all", "notoday"].includes(flagSet)) {
  console.error("usage: node e2e/study/ahead.cjs <dist> <out dir> [off|rel1|rel2|k|all|notoday]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const L2 = "eeeeeeee-0000-4000-8000-000000000031";
const L3 = "eeeeeeee-0000-4000-8000-000000000032";
const PRIMARY = ".ph-foot .a-btn.primary";
const norm = (s) => String(s).replace(/[‎‏⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const POINTS = [4, 4, 6, 6, 5, 4, 5, 4]; // mocks/practice.cjs's points per part

(async () => {
  const mock = await createMock({ dist, plugins: [practice, ahead], flags: flagSet });
  const { db, LECTURE_ID: L } = mock;
  const P = db.practice;
  P.notify = mock.notify;
  db.ahead.notify = mock.notify;
  mock.seedLecture();
  // Two more written lectures with the same parts: one whose read ahead fails a part, one at the cap.
  for (const [id, title] of [
    [L2, "משתנים: הרצאה שנייה"],
    [L3, "משתנים: הרצאה שלישית"],
  ]) {
    db.lectures.push({ ...db.lectures[0], id, title });
    for (const s of db.sections.filter((x) => x.lecture_id === L)) db.sections.push({ ...s, lecture_id: id });
  }

  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const search = (page) => new URL(page.url()).search;
  const until = async (fn, ms = 15000, what = "condition") => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const shot = async (page, name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  const status = (page) => page.locator(".pc-reading [role=status]").innerText({ timeout: 10000 }).then(norm);
  const doneOf = async (page) => Number((/^(\d+) מתוך 8 חלקים/.exec(await status(page)) ?? [])[1] ?? -1);
  const states = (page) => page.locator(".pc-read-parts li").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  const memberReads = () => (P.pointReads ?? []).length;
  /** Op calls that spend (every action but the free "plan"): none of B's reading is a phone's. */
  const aiCalls = () => P.p2calls.filter((c) => c.action !== "plan").length;
  const written = () => P.batches.length + P.qrequests.length + P.drafts.length + P.questions.length;

  try {
    if (flagSet === "off") {
      // Practice is off: its setup screen is replaced, and help says nothing of B.
      const { page } = await mock.open(browser, "שוהם", { path: `/?v=practice&l=${L}&x=new` });
      await page.locator(".a-toast", { hasText: "התכונה הזו עוד לא פתוחה." }).waitFor({ timeout: 15000 });
      check("off: מה ליצור is replaced by the lecture, with a notice", search(page) === `?l=${L}`, search(page));
      await page.goto(`${mock.base}/?v=help`);
      await page.locator(".help h1").waitFor({ timeout: 10000 });
      const text = norm(await page.locator("main").textContent());
      check("off: help says nothing of the points read ahead", !text.includes("הנקודות שצריך לדעת נקראות"), text.slice(0, 200));
      check("off: no question or card question at upload (B's slot asks nothing)", !text.includes("להכין גם שאלות וכרטיסיות"));
      await shot(page, "ahead-off-help");
    } else {
      /* ── 1. The summary is written: the server reads the points ahead, by itself ── */
      const { page: shoham } = await mock.open(browser, "שוהם", { path: `/?v=practice&l=${L}` });
      const { page: noa } = await mock.open(browser, "נועה", { path: `/?v=practice&l=${L}` });
      await shoham.getByRole("heading", { name: "עוד אין שאלות תרגול להרצאה הזו." }).waitFor({ timeout: 15000 });
      // Each part its own call on the server, six at once: they end one by one, over about 14 s.
      const run1 = db.ahead.run(L, { delay: (i) => 3500 + 1200 * i });
      await shoham.getByRole("link", { name: "שאלות חדשות" }).click();
      await shoham.locator(".pc-reading", { hasText: "קוראים את הנקודות שצריך לדעת…" }).waitFor({ timeout: 10000 });
      await noa.goto(`${mock.base}/?v=practice&l=${L}&x=new`);
      await noa.locator(".pc-reading", { hasText: "קוראים את הנקודות שצריך לדעת…" }).waitFor({ timeout: 10000 });
      const first = {
        url: search(shoham),
        head: norm(await shoham.locator(".pc-reading h2").innerText()),
        noaHead: norm(await noa.locator(".pc-reading h2").innerText()),
        line: norm(await shoham.locator(".pc-reading .a-muted").last().innerText()),
        noaLine: norm(await noa.locator(".pc-reading .a-muted").last().innerText()),
        status: await status(shoham),
        states: await states(shoham),
        bar: norm(await shoham.locator(PRIMARY).innerText()),
        off: await shoham.locator(PRIMARY).isDisabled(),
      };
      const LINE = "הסיכום נכתב, אז הנקודות נקראות מעצמן, פעם אחת לכל הקבוצה. אפשר לצאת מהמסך: הוא יתעדכן כשהקריאה תסתיים.";
      check(
        "1 מה ליצור opens on the server's read ahead: the existing progress, every part with its state, as the server's on both phones (never 'במכשיר אחר')",
        first.url === `?v=practice&l=${L}&x=new` &&
          first.head === "קוראים את הנקודות שצריך לדעת…" &&
          first.noaHead === first.head &&
          first.line === LINE &&
          first.noaLine === LINE &&
          /^0 מתוך 8 חלקים · בערך 2 דקות$/.test(first.status) &&
          first.states.length === 8 &&
          first.states.every((x) => x === "reading" || x === "waiting") &&
          first.bar === "קוראים את הנקודות…" &&
          first.off,
        JSON.stringify(first),
      );
      check("1 no phone asked for the read (no tap, no op call): the server's, after the summary", memberReads() === 0 && aiCalls() === 0, JSON.stringify({ reads: P.pointReads, calls: P.p2calls.map((c) => c.action) }));
      await shot(shoham, "ahead-01-reading", { primary: PRIMARY });
      await shot(noa, "ahead-01b-reading-noa", { primary: PRIMARY });

      /* ── 2. The parts arrive one by one, live ── */
      await until(async () => (await doneOf(shoham)) >= 2, 15000, "two parts read");
      const some = { done: await doneOf(shoham), states: await states(shoham), chips: (await shoham.locator(".pc-read-parts li[data-state=ready] .a-chip").allInnerTexts()).map(norm) };
      check(
        "2 the parts arrive one by one: ready ones with their points, the others still read",
        some.done >= 2 && some.done < 8 && some.states.includes("reading") && some.chips.every((t) => /^✓ \d+ נקודות$/.test(t)) && some.chips.length === some.done,
        JSON.stringify(some),
      );
      await shot(shoham, "ahead-02-arriving", { primary: PRIMARY });

      /* ── 3. Read: מה ליצור opens with its numbers ── */
      await run1;
      await shoham.locator(".pc-levels").waitFor({ timeout: 20000 });
      await noa.locator(".pc-levels").waitFor({ timeout: 15000 });
      const ready = {
        sub: norm(await shoham.locator(".ph-sub").innerText()),
        levels: (await shoham.locator(".pc-levels [role=radio]").allInnerTexts()).map(norm),
        parts: (await shoham.locator(".pc-parts button").allInnerTexts()).map(norm),
        bar: norm(await shoham.locator(PRIMARY).innerText()),
        off: await shoham.locator(PRIMARY).isDisabled(),
        reading: await shoham.locator(".pc-reading, .pc-points").count(),
      };
      check(
        "3 the read ended: מה ליצור opens with the numbers (38 points, the levels, each part's count), המשך enabled",
        ready.sub === "20 שקפים · 38 נקודות שצריך לדעת" &&
          ready.levels.length === 4 &&
          ready.levels[1].startsWith("מלא") &&
          ready.parts.length === 8 &&
          ready.parts.every((t, i) => t.startsWith("✓ ") && t.endsWith(`· ${POINTS[i]}`)) &&
          ready.bar === "המשך: דוגמה ומיקוד" &&
          !ready.off &&
          ready.reading === 0,
        JSON.stringify(ready),
      );
      const reserves = mock.calls.filter((c) => c.startsWith("ledger study_reserve kind=points ") && c.includes("member=none"));
      const settles = mock.calls.filter((c) => c.startsWith("ledger study_settle kind=points ") && c.includes("member=none"));
      check(
        "3 one call a part, each reserved (the first as ref ahead) and settled, no member's; no question or card written",
        reserves.length === 8 && settles.length === 8 && reserves[0].includes("ref=ahead ") && memberReads() === 0 && aiCalls() === 0 && written() === 0,
        JSON.stringify({ reserves, settles: settles.length, written: written() }),
      );
      await shot(shoham, "ahead-03-ready", { primary: PRIMARY });

      /* ── 4. Never twice for the same text ── */
      const again = await db.ahead.run(L, {});
      check("4 the read ahead never reads a text twice: nothing claimed the second time", again.claimed === false && again.parts.length === 0, JSON.stringify(again));

      /* ── 5. A part the read ahead could not read: its reason, and "לנסות שוב" reads only it ── */
      await db.ahead.run(L2, { delay: () => 300, fail: (i) => (i === 2 ? "truncated" : null) });
      await shoham.goto(`${mock.base}/?v=practice&l=${L2}&x=new`);
      await shoham.getByRole("heading", { name: "חלק אחד לא נקרא" }).waitFor({ timeout: 15000 });
      const failed = {
        items: (await shoham.locator(".pc-failed .pc-read-parts li").allInnerTexts()).map(norm),
        bar: norm(await shoham.locator(PRIMARY).innerText()),
        off: await shoham.locator(PRIMARY).isDisabled(),
      };
      check(
        "5 a part the read ahead failed: its reason, and the bar offers to read it again (with its cost)",
        failed.items.length === 1 && failed.items[0].includes("הקריאה של החלק נקטעה באמצע.") && failed.bar === "לנסות שוב · כ-$0.14" && !failed.off,
        JSON.stringify(failed),
      );
      await shot(shoham, "ahead-04-failed", { primary: PRIMARY });
      P.pointsDelay = () => 600;
      await shoham.getByRole("button", { name: /לנסות שוב/ }).click();
      await shoham.locator(".pc-levels").waitFor({ timeout: 20000 });
      const retry = P.pointReads?.at(-1);
      check(
        "5 לנסות שוב reads only the part that failed (the member's tap), and מה ליצור opens with the numbers",
        retry?.lectureId === L2 && JSON.stringify(retry.parts) === "[2]" && norm(await shoham.locator(".ph-sub").innerText()) === "20 שקפים · 38 נקודות שצריך לדעת",
        JSON.stringify(retry),
      );
      P.pointsDelay = null;

      /* ── 6. At the cap: skipped quietly; "לקרוא את הנקודות" stays ── */
      const capped = await db.ahead.run(L3, { capped: true });
      await shoham.goto(`${mock.base}/?v=practice&l=${L3}&x=new`);
      await shoham.getByRole("heading", { name: "קודם: הנקודות שצריך לדעת" }).waitFor({ timeout: 15000 });
      const skip = {
        capped,
        bar: norm(await shoham.locator(PRIMARY).innerText()),
        off: await shoham.locator(PRIMARY).isDisabled(),
        failed: await shoham.locator(".pc-failed, .pc-reading, .a-error").count(),
      };
      check(
        "6 at the optional features' line the read ahead skips quietly: no failure shown, and לקרוא את הנקודות stays a tap",
        capped.skipped === "reserve" && skip.bar === "לקרוא את הנקודות · כ-$0.14" && !skip.off && skip.failed === 0,
        JSON.stringify(skip),
      );
      await shot(shoham, "ahead-05-skipped", { primary: PRIMARY });

      /* ── 7. Help says what B does, and nothing of a bank ── */
      await shoham.goto(`${mock.base}/?v=help`);
      await shoham.locator(".help h1").waitFor({ timeout: 10000 });
      // Its row, opened as a member opens it.
      await shoham.locator(".help-rows summary", { hasText: "הנקודות שצריך לדעת" }).click();
      const help = norm(await shoham.locator("main").textContent());
      check(
        "7 help: the points read after the summary, the cap's skip, and questions and cards only on a tap",
        help.includes("הנקודות שצריך לדעת נקראות ממנו מעצמן, פעם אחת לכל הקבוצה") &&
          help.includes("שאלות וכרטיסיות לא נכתבות מעצמן: רק כשבוחרים ליצור אותן.") &&
          !help.includes("במצב החסכוני") &&
          !help.includes("להכין גם שאלות וכרטיסיות"),
        help.slice(0, 400),
      );
      await shot(shoham, "ahead-06-help");
      check("nothing was written ahead: no batch, request, draft or question", written() === 0, String(written()));
    }

    const problems = mock.problems;
    const failedSteps = Object.entries(steps).filter(([, v]) => typeof v === "string" && v.startsWith("FAIL"));
    console.log(JSON.stringify({ flags: flagSet, errors: problems, steps, a11y }, null, 1));
    if (problems.length || a11y.length || failedSteps.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, steps, a11y, calls: mock.calls.slice(-14) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
