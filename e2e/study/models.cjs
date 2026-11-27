// "השוואת מודלים" (docs/study/models.md; VITE_STUDY_MODELS, section Y 1) on
// the shared mock, with synthetic material only (no course material): the op
// "lab" and section Y's functions are played by mocks/lab.cjs, its models by
// deterministic stand-ins (no real model, no paid call). In order
// (design-models §12.3, scenarios 1-3, 7-8, 10-12):
//   1. The owner, empty: "שלי"'s row; the tabs; C5 and the first card
//      ("השוואה ראשונה מומלצת", the question check, Opus against Haiku, its
//      price); "להתחיל" fills the new comparison (the kind chosen, Opus and
//      Haiku ticked, "להריץ (עד $…)").
//   2. The price: a past exam's read with Fable goes past the run's $1.50:
//      C14 and the button disabled; a kind with no material says why (C55);
//      offline: C57.
//   3. Running: one combined count and its bar; no label, no model's name,
//      no time or cost on the page while it runs; leaving and opening it
//      again shows it done (the server finished it); blind until "הצגת השמות
//      והעלות" (the owner too), then the names, quality against price side
//      by side, the link to the results; answers still waiting a minute
//      later: the screen sends resume once; a timed-out answer: "לנסות שוב"
//      once; "לעצור את ההשוואה" with its confirm.
//   7. The results: a model per card, quality against the month's price,
//      "בסיס קטן"; the recommendation at 20 checked items each (C34b),
//      "להשתמש בו" → the route sheet's C36 → "מי כותב מה" shows "שונה ב-…";
//      the sheet's "חזרה לברירת המחדל"; an expensive model asks again (C38b)
//      and the summaries' line (C38).
//   8. "מי כותב מה": a member gets the list to rate (C51), never the tabs;
//      the routes switch off: C59; "כרגע רק Claude".
//  10. Refusals from seeded states: the switch off (C18, no primary), the
//      day's runs used (C16), the month's line used (C15).
//  11. 320, 390, 768 and 1440 px, light and dark, no sideways scroll; two
//      columns of answers from 768 px; the a11y check on every screen
//      (fieldsets with legends, labelled radios and checkboxes, the
//      progressbar's text, 44 px targets, focus kept in sheets).
// Without VITE_STUDY_MODELS (set "os"): no row on "שלי", ?v=models goes home,
// and the op "lab" is never called (12: the other sets' scripts stay as they were).
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=y node e2e/study/models.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: E2E_FLAGS=y node e2e/study/models.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const norm = (s) => String(s).replace(/[⁦-⁩‎‏]/g, "").replace(/\s+/g, " ").trim();
const PHONE = { width: 390, height: 844 };
const MODEL_NAMES = /Claude|Opus|Sonnet|Haiku|Fable/;

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: ["שוהם", "נועה"] });
  mock.seedLecture();
  const db = mock.db;
  const L = db.labMock;
  L.pace = 1200;
  const OWNER = db.group.created_by;
  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const ok = [];
  const a11y = [];
  let page = null;
  let context = null;
  const open = async (who, p, o = {}) => {
    if (context) await context.close().catch(() => undefined);
    ({ page, ctx: context } = await mock.open(browser, who, { viewport: o.viewport ?? PHONE }));
    await page.goto(mock.base + p);
    await page.locator("main").first().waitFor({ timeout: 15000 });
    return page;
  };
  const expect = (cond, what) => {
    if (!cond) throw new Error(what);
    ok.push(what);
  };
  const body = async () => norm(await page.locator("body").innerText());
  const has = async (text, ms = 10000) => {
    const t = Date.now();
    while (!(await body()).includes(text)) {
      if (Date.now() - t > ms) throw new Error(`waited for "${text}"; the page says: ${(await body()).slice(0, 600)}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    return true;
  };
  const shot = async (name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  const ops = (action) => L.calls.filter((c) => c.fn === `op lab ${action}`);
  const noSideScroll = async (name) => {
    const size = page.viewportSize();
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: width >= 768 ? 1000 : 700 });
        await page.waitForTimeout(200);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 1) throw new Error(`${name}: ${over} px of horizontal scroll at ${width} px (${scheme})`);
        if (width !== 320) await page.screenshot({ path: path.join(out, `${name}-${width}-${scheme}.png`), fullPage: true });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    ok.push(`${name}: no horizontal scroll at 320, 390, 768 and 1440 px, light and dark`);
  };

  try {
    if (!flags.models) {
      /* ── Without the flag: nothing shows, nothing is called ── */
      await open("שוהם", "/?v=me");
      await page.waitForTimeout(800);
      expect(!(await body()).includes("השוואת מודלים"), "without VITE_STUDY_MODELS: no row on שלי");
      await open("שוהם", "/?v=models");
      await page.waitForTimeout(600);
      expect(!new URL(page.url()).search.includes("v=models") || !(await body()).includes("השוואות החודש"), "?v=models goes home");
      expect(L.calls.length === 0, "neither section Y's functions nor the op lab are called");
    } else {
      /* ── 1. The owner, empty ── */
      await open("שוהם", "/?v=me");
      await page.getByRole("link", { name: /השוואת מודלים/ }).waitFor({ timeout: 10000 });
      expect(true, "שלי: the owner's row השוואת מודלים · איזה מודל כותב כל דבר, ובכמה");
      await page.getByRole("link", { name: /השוואת מודלים/ }).click();
      await page.getByRole("tablist", { name: "מה בהשוואת מודלים" }).waitFor({ timeout: 10000 });
      for (const t of ["השוואות", "תוצאות", "מי כותב מה"]) expect((await page.getByRole("tab", { name: t }).count()) === 1, `the owner's tab ${t}`);
      await has("השוואות החודש: $0 מתוך $3.30 · עוד 3 היום");
      expect((await page.getByRole("progressbar").count()) >= 1, "the month's line with its bar (C4)");
      await has("עוד אין השוואות. השוואה שולחת את אותו חומר לכמה מודלים");
      await has("השוואה ראשונה מומלצת");
      await has("הבדיקה של השאלות · 10 שאלות מהבנק");
      await has("Claude Opus 5.5 מול Claude Haiku 5.5 · עד $0.03");
      expect(true, "C5 and the first card: the question check, Opus against Haiku, up to $0.03");
      await shot("models-home-empty");
      await page.getByRole("link", { name: "להתחיל" }).click();
      await page.getByRole("radio", { name: "הבדיקה של השאלות" }).waitFor({ timeout: 10000 });
      expect((await page.getByRole("radio", { name: "הבדיקה של השאלות" }).getAttribute("aria-checked")) === "true", "the new comparison: the question check chosen");
      await page.getByRole("checkbox", { name: /Claude Haiku 5\.5/ }).waitFor({ timeout: 10000 });
      expect(await page.getByRole("checkbox", { name: /Claude Opus 5\.5/ }).isChecked(), "Opus ticked (today's model)");
      expect(await page.getByRole("checkbox", { name: /Claude Haiku 5\.5/ }).isChecked(), "Haiku ticked (the kind's candidate, OD11)");
      expect(!(await page.getByRole("checkbox", { name: /Mythos/ }).count()), "Mythos is never offered");
      await has("להריץ (עד $0.03)");
      await has("עד $0.03");
      expect(ops("price").length >= 2 && ops("run").length === 0, "the price is asked of the op, nothing run");
      await shot("models-new", { primary: ".ph-foot .a-btn.primary" });
      await noSideScroll("models-new");

      /* ── 2. The price: past the run's cap, no material, offline ── */
      await page.getByRole("radio", { name: "קריאת מבחן" }).click();
      await page.getByRole("checkbox", { name: /Claude Sonnet 5\.5/ }).waitFor({ timeout: 10000 });
      await has("מועד א׳ בדוי · עמודים 1-4");
      expect(await page.getByRole("checkbox", { name: /Claude Sonnet 5\.5/ }).isChecked(), "a past exam's read: Sonnet is the candidate");
      await page.getByRole("checkbox", { name: /Claude Fable 5\.2/ }).check();
      await has("ההשוואה הזאת עלולה לעלות $1.75, יותר מ-$1.50. אפשר להוריד מודל או לבחור חומר קצר יותר.");
      expect(await page.locator(".ph-foot .a-btn.primary").isDisabled(), "over the run's cap: C14 and the button disabled");
      await shot("models-new-cap", { primary: ".ph-foot .a-btn.primary" });
      await page.getByRole("checkbox", { name: /Claude Fable 5\.2/ }).uncheck();
      await has("להריץ (עד $0.75)");
      await page.getByRole("radio", { name: "קריאת דף תרגילים" }).click();
      await has("אין עדיין דף תרגילים שנבדק");
      expect(await page.locator(".ph-foot .a-btn.primary").isDisabled(), "a kind with no material says why (C55)");
      await page.getByRole("radio", { name: "הבדיקה של השאלות" }).click();
      await has("להריץ (עד $0.03)");
      await context.setOffline(true);
      await has("צריך חיבור כדי להריץ השוואה.");
      expect(await page.locator(".ph-foot .a-btn.primary").isDisabled(), "offline: C57 and the button disabled");
      await context.setOffline(false);
      await page.waitForTimeout(300);

      /* ── 3. Running, blind, done without the phone ── */
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.waitForURL(/[?&]r=/, { timeout: 10000 });
      const run1 = new URL(page.url()).searchParams.get("r");
      await has("מתוך 2 תשובות מוכנות");
      const runningText = await body();
      expect(!MODEL_NAMES.test(runningText.replace("הבדיקה של השאלות · 10 שאלות מהבנק", "")), "while it runs: no model's name on the page");
      expect(!/תשובה [אבגד]|\$\d/.test(runningText), "while it runs: no label, no cost");
      expect((await page.getByRole("progressbar").getAttribute("aria-valuetext"))?.includes("מתוך 2 תשובות מוכנות"), "the progressbar's text is the count");
      await has("אפשר לצאת מהמסך: ההשוואה ממשיכה גם בלי הטלפון.");
      await shot("models-running");
      // Leave, then open it again later: the server finished it.
      await page.goto(mock.base + "/?v=me");
      await page.locator("main").first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(L.pace * 3);
      await page.goto(mock.base + `/?v=models&r=${run1}`);
      await has("מוכנה");
      expect(L.runs.find((r) => r.id === run1).status === "done", "left and opened again: the run is done (the server finished it)");
      const doneText = await body();
      expect(!MODEL_NAMES.test(doneText.replace("הבדיקה של השאלות · 10 שאלות מהבנק", "")), "done, before the reveal: still no model's name (the owner is blind too)");
      await has("התשובות בלי שמות.");
      await has("10/10 תואמות למפתח");
      await page.getByRole("button", { name: "להציג את התשובה" }).first().click();
      await page.locator(".md-keyed").first().waitFor({ timeout: 5000 });
      expect(/שאלה 1: תשובה \d/.test(norm(await page.locator(".md-keyed").first().innerText())), "an answer-key answer in words (the question check's choices), its JSON in a fold");
      await shot("models-done-blind", { primary: ".ph-foot .a-btn.primary" });
      await noSideScroll("models-done-blind");
      await page.setViewportSize({ width: 768, height: 1000 });
      const cols = await page.locator(".md-answers").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(cols === 2, "from 768 px the answers sit in 2 columns");
      await page.setViewportSize(PHONE);
      await page.getByRole("button", { name: "הצגת השמות והעלות" }).click();
      await has("Claude Haiku 5.5");
      await has("איכות מול מחיר בהשוואה הזאת");
      await has("זול פי");
      await has("לתוצאות של ״הבדיקה של השאלות״");
      expect(L.seen.some((s) => s.run_id === run1 && s.user_id === OWNER), "the reveal is the owner's own (study_lab_reveal)");
      await shot("models-revealed");
      await noSideScroll("models-revealed");

      // Answers still waiting a minute later, no stream in this tab: resume, once.
      L.stall = true;
      L.backdate = 120000;
      await page.goto(mock.base + "/?v=models&x=new&k=solver");
      await has("להריץ (עד $0.03)");
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.waitForURL(/[?&]r=/, { timeout: 10000 });
      const run2 = new URL(page.url()).searchParams.get("r");
      L.stall = false;
      L.backdate = 0;
      await page.waitForTimeout(L.pace * 2);
      expect(L.outputs.some((o) => o.run_id === run2 && o.status === "waiting"), "one answer still waiting (never claimed)");
      await page.reload();
      await has("מוכנה", 15000);
      expect(ops("resume").length === 1, "opened again with an answer waiting: resume, once");

      // A timed-out answer: "לנסות שוב", once.
      await page.goto(mock.base + "/?v=models&x=new&k=fix_check");
      await page.getByRole("checkbox", { name: /Claude Fable 5\.2/ }).waitFor({ timeout: 10000 });
      await page.getByRole("checkbox", { name: /Claude Haiku 5\.5/ }).uncheck();
      await page.getByRole("checkbox", { name: /Claude Fable 5\.2/ }).check();
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.waitForURL(/[?&]r=/, { timeout: 10000 });
      await has("לא הספיקה בזמן", 15000);
      await has("מסכים עם ההחלטה של הקבוצה");
      await page.getByRole("button", { name: "לנסות שוב" }).click();
      await has("מוכנה");
      await page.waitForFunction(() => !document.body.innerText.includes("לא הספיקה בזמן"), null, { timeout: 15000 });
      expect(ops("retry").length === 1, "a timed-out answer tried once more (retry)");
      expect(!(await page.getByRole("button", { name: "לנסות שוב" }).count()), "and only once");

      // Cancel, with its confirm.
      L.runsToday = 0;
      L.pace = 20000;
      await page.goto(mock.base + "/?v=models&x=new&k=solver");
      await has("להריץ (עד $0.03)");
      await page.locator(".ph-foot .a-btn.primary").click();
      await page.waitForURL(/[?&]r=/, { timeout: 10000 });
      await page.getByRole("button", { name: "לעצור את ההשוואה" }).click();
      const dlg = page.getByRole("dialog", { name: "לעצור את ההשוואה" });
      await dlg.waitFor({ timeout: 5000 });
      await has("תשובות שעוד נכתבות ייעצרו, ומה שכבר נוצל ייספר.");
      a11y.push(...(await snap(page, out, "models-cancel-sheet")));
      await dlg.getByRole("button", { name: "לעצור" }).click();
      await has("ההשוואה נעצרה.");
      expect(ops("cancel").length === 1, "cancel: the op's cancel, after its confirm (C47)");
      L.pace = 1200;
      L.runsToday = 0;
      L.spent = 0.42;

      /* ── 7. The results and the recommendation ── */
      L.seedRuns(2, OWNER);
      await page.goto(mock.base + "/?v=models&x=board&k=solver");
      await page.locator(".md-model").first().waitFor({ timeout: 10000 });
      expect((await page.locator(".md-model").count()) === 2, "a card per model");
      await has("איכות");
      await has("בחודש");
      await has("Claude Haiku 5.5 זול פי");
      await has("ותאם למפתח ב-100% מתוך 30 שאלות (היום: 100%).");
      await has("בסיס קטן");
      expect(true, "the recommendation at 20 checked items each (C34b), with בסיס קטן");
      await shot("models-board");
      await noSideScroll("models-board");
      await page.locator(".md-rec").getByRole("button", { name: "להשתמש בו ל״הבדיקה של השאלות״" }).click();
      const sheet = page.getByRole("dialog", { name: "מי כותב ״הבדיקה של השאלות״" });
      await sheet.waitFor({ timeout: 5000 });
      await has("״הבדיקה של השאלות״: מעכשיו ב-Claude Haiku 5.5. לפי 30 הימים האחרונים: בערך");
      await has("במקום $2.70. אפשר לחזור לברירת המחדל מכאן בכל רגע.");
      a11y.push(...(await snap(page, out, "models-route-sheet")));
      await sheet.getByRole("button", { name: "החלפה" }).click();
      await has("המודל של ״הבדיקה של השאלות״ הוחלף.");
      expect(L.routes.solver?.model === "claude-haiku-5-5", "the route action sets the question check to Haiku");
      await page.waitForURL(/x=routes/, { timeout: 10000 });
      const solverRow = page.locator(".md-route-row", { hasText: "הבדיקה של השאלות" });
      await solverRow.waitFor({ timeout: 10000 });
      expect(/שונה ב-/.test(norm(await solverRow.innerText())) && norm(await solverRow.innerText()).includes("Claude Haiku 5.5"), "מי כותב מה: the row shows Haiku and שונה ב-…");
      await solverRow.click();
      await page.getByRole("dialog", { name: "מי כותב ״הבדיקה של השאלות״" }).getByRole("button", { name: "חזרה לברירת המחדל" }).click();
      await has("״הבדיקה של השאלות״ חוזר ל-Claude Opus 5.5.");
      expect(!L.routes.solver, "the sheet's חזרה לברירת המחדל clears the route");
      // An expensive model asks again, and the summaries keep their model while being written.
      await page.locator(".md-route-row", { hasText: "סיכומים" }).click();
      const parts = page.getByRole("dialog", { name: "מי כותב ״סיכומים״" });
      await parts.getByRole("radio", { name: /Claude Fable 5\.2/ }).check();
      await has("יקר בערך פי");
      await has("הרצאות שנכתבות עכשיו ימשיכו במודל הקודם עד שהכתיבה תסתיים.");
      await parts.getByRole("button", { name: "להחליף", exact: true }).click();
      await has("המודל של ״סיכומים״ הוחלף.");
      expect(ops("route").some((c) => c.body.route === "part" && c.body.confirmExpensive === true), "an expensive model is set with its second confirmation (OD14)");
      // OD10: one tap back to the model the kind had before, on the toast.
      await page.locator(".a-toast").getByRole("button", { name: "ביטול" }).click();
      await page.waitForFunction(() => document.querySelector(".md-route-row") && ![...document.querySelectorAll(".md-route-row")].some((r) => r.textContent.includes("סיכומים") && r.textContent.includes("Fable")), null, { timeout: 10000 });
      expect(!L.routes.part, "ביטול on the toast puts the route back as it was (the default here)");
      expect(ops("route").filter((c) => c.body.route === "part").length === 2, "the undo is one more route call");

      /* ── 8. מי כותב מה: providers, the switch; a member ── */
      await has("כרגע רק Claude");
      await page.locator(".md-fold", { hasText: "בדיקות ופעולות פנימיות" }).locator("summary").click();
      await has("בדיקת תיקון");
      await shot("models-routes");
      await noSideScroll("models-routes");
      L.routesOn = false;
      await page.reload();
      await has("המעבר בין מודלים כבוי כרגע: הכול נכתב ב-Claude Opus 5.5.");
      expect(true, "the routes switch off: C59");
      L.routesOn = true;
      await open("נועה", "/?v=me");
      await page.waitForTimeout(800);
      expect(!(await body()).includes("השוואת מודלים"), "a member: no owner's row on שלי, and no row to rate while nothing waits");
      await open("נועה", "/?v=models");
      await has("אין כרגע השוואות לדירוג.");
      expect(!(await page.getByRole("tablist").count()) && !(await body()).includes("מי כותב מה") && !(await body()).includes("השוואה חדשה"), "a member gets the list to rate: no tabs, no מי כותב מה, no השוואה חדשה");
      await shot("models-member-empty");

      /* ── 10. Refusals from seeded states ── */
      await open("שוהם", "/?v=models");
      L.on = false;
      await page.reload();
      await has("השוואות כבויות כרגע.");
      expect(!(await page.locator(".ph-foot .a-btn.primary").count()), "the switch off: C18 and no השוואה חדשה");
      await page.goto(mock.base + "/?v=models&x=new&k=solver");
      await has("השוואות כבויות כרגע.");
      expect(await page.locator(".ph-foot .a-btn.primary").isDisabled(), "a new comparison with the switch off: disabled");
      L.on = true;
      L.runsToday = 3;
      await page.reload();
      await has("היום כבר היו 3 השוואות. אפשר שוב מחר.");
      expect(await page.locator(".ph-foot .a-btn.primary").isDisabled(), "the day's runs used: C16 and disabled");
      L.runsToday = 0;
      L.spent = 3.3;
      await page.reload();
      await has("התקציב להשוואות החודש נגמר. אפשר שוב מה-1 בחודש.");
      expect(await page.locator(".ph-foot .a-btn.primary").isDisabled(), "the month's line used: C15 and disabled");
      await shot("models-new-line", { primary: ".ph-foot .a-btn.primary" });
      L.spent = 0;
      expect(ops("run").length === 4, `four runs started (${ops("run").length}), each by the owner's tap`);
    }

    steps.problems = mock.problems;
    steps.a11y = a11y;
    steps.ok = ok;
    fs.writeFileSync(path.join(out, "steps.json"), JSON.stringify(steps, null, 2));
    console.log(JSON.stringify({ flags: flags.set, ok: ok.length, problems: mock.problems, a11y }, null, 2));
    if (mock.problems.length || a11y.length) process.exitCode = 1;
  } catch (e) {
    console.error(e);
    if (page) await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => undefined);
    steps.error = String(e?.stack ?? e);
    steps.problems = mock.problems;
    steps.a11y = a11y;
    steps.ok = ok;
    fs.writeFileSync(path.join(out, "steps.json"), JSON.stringify(steps, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close?.();
  }
  process.exit(process.exitCode ?? 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
