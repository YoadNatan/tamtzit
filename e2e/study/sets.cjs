// Practice sets, slice A (docs/study/sets.md; the design's §14 e2e steps 1-4
// and 12), against the mock (mocks/practice.cjs: practice 2.0's actions, with
// "plan"'s inputs): "סט חדש" from a lecture page in at most two interactions
// before paying, with the price on the button, the preview's types and its
// coverage as a percentage, "עוד אפשרויות" closed; the lecture read first as
// the generating screen's phase ("קוראים את ההרצאה · כ-2 דקות"); "סט בהכנה"
// with its ring and count, the three tile states in "פרטים", a batch that
// did not come out with "לנסות שוב", and "להתחיל לפתור (k)" keeping the
// checked questions and starting a round; a budget line reached mid-set
// ("הסט נעצר כי התקציב נגמר", never "לנסות שוב"); an example whose read
// fails ("הדוגמה לא נקראה"), the set written in the usual style; offline on
// both screens and back; at 1280 px the keyboard (←/→ the size, Enter on the
// body creates, typing in "מיקוד" never does), the sticky preview with its
// button and no bottom bar, and the lecture sheet as a 560 px dialog.
// Synthetic Hebrew content only; screenshots stay out of the repo.
//
//   <every s2 flag> VITE_STUDY_INSTALL=1 VITE_STUDY_NOTIFY=1 VITE_STUDY_MAKE=1 \
//   VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
//     npx vite build --outDir <dist>
//   NODE_PATH=$(npm root -g) node e2e/study/sets.cjs <dist> <out dir> [pm]
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const plugin = require("./mocks/practice.cjs");

const [dist, out, flagSet = process.env.E2E_FLAGS || "pm"] = process.argv.slice(2);
if (!dist || !out || !["pm", "ps"].includes(flagSet)) {
  console.error("usage: node e2e/study/sets.cjs <dist> <out dir> [pm|ps]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const norm = (s) => String(s).replace(/[‎‏⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const FOOT_GO = ".make-screen > .ph-foot .mk-go";
const START = ".ph-foot .mk-start-btn";

(async () => {
  const mock = await createMock({ dist, plugins: [plugin], flags: flagSet });
  const { db, LECTURE_ID: L } = mock;
  const P = db.practice;
  P.notify = mock.notify;
  mock.seedLecture();

  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const search = (page) => new URL(page.url()).search;
  const until = async (fn, ms = 20000, what = "condition") => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const shot = async (page, name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  const text = async (page, sel) => norm(await page.locator(sel).first().innerText({ timeout: 15000 }));
  /** Every text these elements ever showed on the page (a line can last a moment). */
  const record = async (page, sel) => {
    const install = (s) => {
      const seen = () => {
        for (const el of document.querySelectorAll(s)) {
          const t = (el.textContent || "").replace(/\s+/g, " ").trim();
          const all = sessionStorage.getItem("e2e-seen") || "";
          if (t && !all.includes(t)) sessionStorage.setItem("e2e-seen", `${all}${t}\n`);
        }
      };
      new MutationObserver(seen).observe(document, { childList: true, subtree: true, characterData: true });
    };
    await page.addInitScript(install, sel);
    await page.evaluate(install, sel);
  };
  const seenTexts = (page) => page.evaluate(() => sessionStorage.getItem("e2e-seen") || "");
  const creates = () => P.p2calls.filter((c) => c.action === "create");
  const tiles = (page) => page.locator(".mk-qtiles > li").evaluateAll((els) => els.map((e) => e.getAttribute("data-s")));

  try {
    const { page: shoham, ctx: shohamCtx } = await mock.open(browser, "שוהם", { path: `/?v=practice&l=${L}` });
    await record(shoham, ".mk-hero h2, .mk-warn, .mk-count, .mk-offline");

    /* ── 1. The lecture page → סט חדש → ליצור: two interactions, the price on the button ── */
    await shoham.getByRole("link", { name: "שאלות חדשות" }).first().click();
    await until(async () => search(shoham).includes("x=new"), 10000, "the create screen");
    await shoham.locator(".mk-preview").waitFor({ timeout: 15000 });
    await until(async () => /ליצור 10 שאלות · כ-\$/.test(norm(await shoham.locator(FOOT_GO).innerText())), 15000, "the price on the button");
    const one = {
      title: await text(shoham, ".ph-head h1"),
      button: norm(await shoham.locator(FOOT_GO).innerText()),
      enabled: await shoham.locator(FOOT_GO).isEnabled(),
      lecture: await text(shoham, ".mk-lecture b"),
      more: await shoham.locator("details.mk-more").evaluate((d) => d.open),
      read: await shoham.locator(".mk-preview", { hasText: "כולל קריאת ההרצאה (פעם אחת לכל הקבוצה)" }).count(),
      check: await shoham.locator(".mk-preview", { hasText: "כל שאלה נבדקת לפני שהיא נכנסת לבנק" }).count(),
      size: await shoham.locator(".mk-size [aria-checked=true]").innerText(),
      planCalls: P.p2calls.filter((c) => c.action === "plan" && c.body.inputs === true).length,
    };
    // Never read: 10 questions at $0.04 and the read, $0.14 (the mock's), once for the group.
    check(
      "1 סט חדש: one screen, the lecture prefilled, 10 by default, 'עוד אפשרויות' closed, the price on the button with the read in it",
      one.title === "סט חדש" && one.button === "ליצור 10 שאלות · כ-$0.54" && one.enabled && one.lecture.length > 0 && !one.more && one.read === 1 && one.check === 1 && one.size === "10" && one.planCalls === 1,
      JSON.stringify(one),
    );
    await shot(shoham, "sets-01-create-never-read", { primary: FOOT_GO });
    // A size or a type costs no call (D13).
    await shoham.locator(".mk-size").getByRole("radio", { name: "5 שאלות" }).click();
    await until(async () => norm(await shoham.locator(FOOT_GO).innerText()) === "ליצור 5 שאלות · כ-$0.34", 5000, "the price at 5");
    await shoham.locator(".mk-size").getByRole("radio", { name: "10 שאלות" }).click();
    check("1 a size changes the price on the phone, with no call", P.p2calls.filter((c) => c.action === "plan").length === one.planCalls, `${P.p2calls.filter((c) => c.action === "plan").length}`);

    /* ── 3. The read as the generating screen's phase, then 2. "סט בהכנה" ── */
    // One part's batch fails once (לנסות שוב); one draft is wrong twice (rejected: "לא יצאה").
    P.p2pace = 400;
    P.fail = (b) => Boolean(b.request_id) && b.part_idx === 7;
    P.solverFails = (d, k) => d.part_idx === 6 && k === 0;
    P.solverStillFails = (d) => d.part_idx === 6;
    await shoham.locator(FOOT_GO).click(); // interaction 2
    await until(async () => (await seenTexts(shoham)).includes("קוראים את ההרצאה · כ-2 דקות, פעם אחת לכל הקבוצה"), 10000, "the read phase");
    check("3 the lecture is read first, as a phase: 'קוראים את ההרצאה · כ-2 דקות' (nothing created before the read)", P.pointReads?.length === 1, JSON.stringify(P.pointReads));
    await until(async () => /x=bank&r=/.test(search(shoham)), 20000, "the generating screen");
    const made = creates()[0];
    check(
      "1 ליצור: one request, the custom level at 10, two interactions after the lecture page",
      creates().length === 1 && made.body.options.level === "custom" && made.body.options.count === 10 && !made.body.options.style,
      JSON.stringify(made?.body?.options),
    );
    await shoham.locator(".mk-ring").waitFor({ timeout: 10000 });
    const head = await text(shoham, ".ph-head h1");
    await shoham.locator(".mk-details > summary").click();
    let states = new Set();
    await until(async () => {
      for (const s of await tiles(shoham)) states.add(s);
      return states.has("coming") && states.has("ready");
    }, 20000, "tiles on the way and ready");
    const keepOpen = await shoham.locator(".mk-keep", { hasText: "היצירה רצה מהמכשיר הזה" }).count();
    await shot(shoham, "sets-02-generating", { primary: START });
    await until(async () => (await tiles(shoham)).every((s) => s !== "coming"), 60000, "every batch over");
    for (const s of await tiles(shoham)) states.add(s);
    const failedLine = await text(shoham, ".mk-failed");
    check(
      "2 סט בהכנה: ring and count, the 'keep open' callout, 10 tiles in three states (בדרך · מוכנה · לא יצאה)",
      head.startsWith("סט בהכנה · ") && keepOpen === 1 && (await tiles(shoham)).length === 10 && states.has("coming") && states.has("ready") && states.has("failed"),
      JSON.stringify({ head, keepOpen, states: [...states] }),
    );
    check("2 a batch that failed: '{n} שאלות לא יצאו' with 'לנסות שוב'", /^(\d+ שאלות|שאלה אחת) לא (יצאו|יצאה) לנסות שוב$/.test(failedLine), failedLine);
    await shot(shoham, "sets-03-failed", { primary: START });
    await shoham.locator(".mk-failed").getByRole("button", { name: "לנסות שוב" }).click();
    await until(async () => (await tiles(shoham)).filter((s) => s === "failed").length === 1, 30000, "the batch written again");
    const after = norm(await shoham.locator(".mk-failed").innerText());
    check("2 'לנסות שוב' writes the failed batch again; the rejected question stays 'לא יצאה', with no button", after === "שאלה אחת לא יצאה", after);
    const count = await text(shoham, ".mk-count");
    const readyN = (await tiles(shoham)).filter((s) => s === "ready").length;
    const startLabel = norm(await shoham.locator(START).innerText());
    check("2 the count and the button agree: 'להתחיל לפתור (9)'", count === "9 שאלות מוכנות" && startLabel === `להתחיל לפתור (${readyN})` && readyN === 9, JSON.stringify({ count, startLabel, readyN }));
    // The ready list: type and stem, "שקף N", and the way to the drafts one by one.
    const list = await shoham.locator(".mk-ready li").count();
    const slideWords = await shoham.locator(".mk-ready .mk-slide").allInnerTexts();
    check("2 the ready list: 9 questions, 'שקף N' (never 'ש׳')", list === 9 && slideWords.every((s) => /^שקף \d+$/.test(norm(s))), JSON.stringify({ list, slideWords }));
    const keepsBefore = mock.calls.filter((c) => c.includes("study_draft_keep_all")).length;
    await shoham.locator(START).click();
    await until(async () => /s=l\./.test(search(shoham)), 15000, "the round");
    await shoham.locator(".pq-lead").first().waitFor({ timeout: 15000 });
    const rq = P.qrequests[P.qrequests.length - 1];
    const pendingLeft = P.drafts.filter((d) => d.request_id === rq.id && d.status === "pending" && (d.check_state === "ok" || d.check_state === "unchecked")).length;
    check(
      "2 'להתחיל לפתור' keeps the checked questions with one tap and starts a round",
      mock.calls.filter((c) => c.includes("study_draft_keep_all")).length === keepsBefore + 1 && pendingLeft === 0 && /n=10/.test(search(shoham)),
      JSON.stringify({ calls: mock.calls.filter((c) => c.includes("keep_all")), pendingLeft, s: search(shoham) }),
    );
    P.fail = () => false;
    P.solverFails = () => false;
    P.solverStillFails = () => false;

    /* ── 2. A budget line reached in the middle: the budget's words, not "לנסות שוב" ── */
    await shoham.goto(`${mock.base}/?v=practice&l=${L}&x=new`);
    await until(async () => /ליצור \d+ שאלות · כ-\$/.test(norm(await shoham.locator(FOOT_GO).innerText())), 15000, "the create screen again");
    const second = norm(await shoham.locator(FOOT_GO).innerText());
    // $0.04 a question, weighted by type (a true/false item 1.2): $0.40-0.45 for these defaults.
    check("1 the points now read: no read in the price ($0.04 a question, by type)", /^ליצור 10 שאלות · כ-\$0\.4\d$/.test(second) && (await shoham.locator(".mk-preview", { hasText: "כולל קריאת" }).count()) === 0, second);
    const cover = norm(await shoham.locator(".mk-cover p").first().innerText());
    const typesLine = norm(await shoham.locator(".mk-legend").innerText());
    check("1 the preview: the types with their counts, the coverage as a percentage (never 'נקודות')", /^אחרי הסט: \d{1,3}% מההרצאה מכוסים בבנק$/.test(cover) && /\d+ \S/.test(typesLine) && !/נקודות/.test(await shoham.locator(".mk-preview").innerText()), JSON.stringify({ cover, typesLine }));
    await shot(shoham, "sets-04-create-read", { primary: FOOT_GO });
    P.budget = true;
    await shoham.locator(".mk-size").getByRole("radio", { name: "5 שאלות" }).click();
    await shoham.locator(FOOT_GO).click();
    await until(async () => /x=bank&r=/.test(search(shoham)), 15000, "the second set");
    await shoham.locator(".mk-budget").waitFor({ timeout: 20000 });
    const budget = norm(await shoham.locator(".mk-budget").innerText());
    const retry = await shoham.getByRole("button", { name: "לנסות שוב" }).count();
    check("2 a 402 mid-set: 'הסט נעצר כי התקציב נגמר' and the line's words, never 'לנסות שוב'", budget.startsWith("הסט נעצר כי התקציב נגמר") && budget.includes("מתחדש ב-1 בחודש") && retry === 0, JSON.stringify({ budget, retry }));
    await shot(shoham, "sets-05-budget-stop");
    P.budget = false;

    /* ── 3. An example whose read fails: the usual style, said so ── */
    P.styleFail = "daily_limit";
    await shoham.goto(`${mock.base}/?v=practice&l=${L}&x=new`);
    await until(async () => /כ-\$/.test(norm(await shoham.locator(FOOT_GO).innerText())), 15000, "the create screen");
    await shoham.locator("details.mk-more > summary").click();
    await shoham.getByRole("button", { name: "להדביק טקסט" }).click();
    await shoham.locator("#mk-example").fill("מטופלת בת 30 עם חום. מה הטיפול? א. ... ב. ...");
    await until(async () => (await shoham.locator(".mk-preview", { hasText: "כולל קריאת הדוגמה" }).count()) === 1, 5000, "the example in the price");
    const withEx = norm(await shoham.locator(FOOT_GO).innerText());
    const createsBefore = creates().length;
    await shoham.locator(FOOT_GO).click();
    await until(async () => /x=bank&r=/.test(search(shoham)), 20000, "the set without the example's style");
    const exCreate = creates()[createsBefore];
    check(
      "3 a failed example read: 'הדוגמה לא נקראה · השאלות נכתבות בסגנון הרגיל', and the set is written anyway, in the usual style",
      (await seenTexts(shoham)).includes("הדוגמה לא נקראה · השאלות נכתבות בסגנון הרגיל") && (await seenTexts(shoham)).includes("קוראים את הדוגמה…") && exCreate && !exCreate.body.options.style && withEx === "ליצור 5 שאלות · כ-$0.21",
      JSON.stringify({ withEx, style: exCreate?.body?.options?.style ?? null, seen: await seenTexts(shoham) }),
    );
    P.styleFail = null;

    /* ── 4. Offline: the create screen waits; the generating screen keeps its tiles, then goes on ── */
    await shoham.goto(`${mock.base}/?v=practice&l=${L}&x=new`);
    await until(async () => /כ-\$/.test(norm(await shoham.locator(FOOT_GO).innerText())), 15000, "the create screen");
    await shohamCtx.setOffline(true);
    await shoham.locator(".mk-offline", { hasText: "אין חיבור כרגע. התצוגה תתעדכן כשהחיבור יחזור." }).waitFor({ timeout: 5000 });
    const offDisabled = await shoham.locator(FOOT_GO).isDisabled();
    await shot(shoham, "sets-06-create-offline", { primary: FOOT_GO });
    await shohamCtx.setOffline(false);
    await until(async () => shoham.locator(FOOT_GO).isEnabled(), 5000, "the button back");
    check("4 offline on the create screen: the line, and the button off until the connection is back", offDisabled === true, String(offDisabled));
    P.p2pace = 1500;
    await shoham.locator(".mk-size").getByRole("radio", { name: "5 שאלות" }).click();
    await shoham.locator(FOOT_GO).click();
    await until(async () => /x=bank&r=/.test(search(shoham)), 15000, "the offline set");
    await shoham.locator(".mk-ring").waitFor({ timeout: 10000 });
    await shoham.locator(".mk-details > summary").click();
    await until(async () => (await tiles(shoham)).includes("ready"), 20000, "a first ready question");
    await shohamCtx.setOffline(true);
    await shoham.locator(".mk-offline", { hasText: "אין חיבור. מה שכבר נטען נשאר כאן." }).waitFor({ timeout: 5000 });
    const offTiles = await tiles(shoham);
    await shot(shoham, "sets-07-generating-offline");
    await new Promise((ok) => setTimeout(ok, 1500));
    await shohamCtx.setOffline(false);
    P.p2pace = 250;
    await until(async () => {
      const t = await tiles(shoham);
      return t.length === 5 && t.every((s) => s === "ready");
    }, 90000, "the set finished after the connection came back").catch(async (e) => {
      const rq = P.qrequests[P.qrequests.length - 1];
      throw new Error(`${e.message}: tiles ${JSON.stringify(await tiles(shoham))}, batches ${JSON.stringify(P.batches.filter((b) => b.request_id === rq.id).map((b) => [b.status, b.made, b.wanted, b.error, b.attempts]))}`);
    });
    check("4 offline on the generating screen: the line, the tiles kept, and the set goes on when back", offTiles.length === 5 && offTiles.includes("ready"), JSON.stringify(offTiles));

    /* ── 12. 1280 px: the keyboard, the sticky preview with its button, the 560 px sheet ── */
    const { page: wide } = await mock.open(browser, "נועה", { path: `/?v=practice&l=${L}&x=new`, viewport: { width: 1280, height: 860 } });
    await until(async () => /כ-\$/.test(norm(await wide.locator(".mk-go-card").innerText())), 15000, "the wide create screen");
    const layout = await wide.evaluate(() => ({
      foot: getComputedStyle(document.querySelector(".make-screen > .ph-foot")).display,
      sticky: getComputedStyle(document.querySelector(".mk-end")).position,
      card: !!document.querySelector(".mk-go-card")?.offsetParent,
      cols: getComputedStyle(document.querySelector(".mk-grid")).gridTemplateColumns.split(" ").length,
    }));
    check("12 L: two columns, the preview sticky with the button in it, no bottom bar", layout.foot === "none" && layout.sticky === "sticky" && layout.card && layout.cols === 2, JSON.stringify(layout));
    await wide.screenshot({ path: `${out}/sets-08-create-1280.png` });
    await shot(wide, "sets-08-create-wide", { primary: FOOT_GO }); // the check measures at 390 and 360, where the bar is back
    await wide.locator("body").click({ position: { x: 640, y: 830 } });
    await wide.evaluate(() => document.activeElement?.blur?.());
    await wide.keyboard.press("ArrowLeft");
    const big = await wide.locator(".mk-size [aria-checked=true]").innerText();
    await wide.keyboard.press("ArrowRight");
    await wide.keyboard.press("ArrowRight");
    const small = await wide.locator(".mk-size [aria-checked=true]").innerText();
    await wide.keyboard.press("ArrowLeft");
    await wide.locator("details.mk-more > summary").click();
    const before12 = creates().length;
    const focus = wide.getByRole("textbox", { name: "מיקוד" });
    await focus.fill("תופעות לוואי ומינונים");
    await focus.press("Enter");
    await focus.press("ArrowLeft");
    await new Promise((ok) => setTimeout(ok, 600));
    const typed = { creates: creates().length - before12, size: await wide.locator(".mk-size [aria-checked=true]").innerText(), x: search(wide) };
    check("12 ←/→ change the size on the body (← is bigger, right to left)", big === "20" && small === "5", JSON.stringify({ big, small }));
    check("12 typing in 'מיקוד' never creates, and its arrows move the caret", typed.creates === 0 && typed.size === "10" && /x=new/.test(typed.x), JSON.stringify(typed));
    // The lecture sheet: a 560 px dialog from 768 px.
    await wide.getByRole("button", { name: "להחליף ‹" }).click();
    await wide.locator(".mk-sheet").waitFor({ timeout: 5000 });
    await wide.screenshot({ path: `${out}/sets-09-sheet-1280.png` });
    const sheetW = (await wide.locator(".mk-sheet").boundingBox()).width;
    const opts = await wide.locator(".mk-lecture-opt").count();
    await shot(wide, "sets-09-lecture-sheet");
    await wide.keyboard.press("Escape");
    await until(async () => (await wide.locator(".mk-sheet").count()) === 0, 5000, "the sheet closed");
    check("12 the lecture sheet: a dialog about 560 px wide, the group's lectures as radios", sheetW >= 500 && sheetW <= 600 && opts >= 1, JSON.stringify({ sheetW, opts }));
    await wide.evaluate(() => document.activeElement?.blur?.());
    await wide.keyboard.press("Enter");
    await until(async () => /x=bank&r=/.test(search(wide)), 15000, "Enter on the body creates");
    const last = creates()[creates().length - 1];
    check("12 Enter on the body creates, with the focus written in", creates().length === before12 + 1 && last.body.options.focus === "תופעות לוואי ומינונים", JSON.stringify(last?.body?.options));
    await wide.locator(".mk-ring").waitFor({ timeout: 10000 });
    const detailsOpen = await wide.locator(".mk-details").evaluate((d) => d.open);
    check("12 L: the generating screen opens with its details", detailsOpen === true, String(detailsOpen));
    await new Promise((ok) => setTimeout(ok, 2500));
    await wide.screenshot({ path: `${out}/sets-10-generating-1280.png` });
    await shot(wide, "sets-10-generating-wide");

    const problems = mock.problems;
    const failed = Object.entries(steps).filter(([, v]) => typeof v === "string" && v.startsWith("FAIL"));
    console.log(JSON.stringify({ flags: flagSet, errors: problems, steps, a11y }, null, 1));
    if (problems.length || a11y.length || failed.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, steps, a11y, calls: mock.calls.slice(-14), p2: P.p2calls.slice(-6).map((c) => c.action) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
