// "השוואת מודלים": the blind rating (docs/study/models.md; VITE_STUDY_MODELS,
// section Y 1, WP8) on the shared mock, with synthetic material only: the op
// "lab" and section Y's functions are mocks/lab.cjs's, its models
// deterministic stand-ins (no real model, no paid call). Design-models
// §12.3, scenarios 4-6:
//   4. Blind, the owner too: a practice comparison run from "השוואה חדשה"
//      ("עוד אפשרויות" holds the AI score, off); once done, no model's name,
//      no $ and no time on the page until the caller saves; one score per
//      answer (labelled radios in a fieldset), the error tick and its note;
//      "שמירה והצגת השמות" disabled with C27b until every answer has a score
//      and a best pick; the draft survives a reload; taps made offline wait
//      (C56) and are sent when the connection returns; after saving the
//      names show with "הדירוג שלי" (C30). The AI score asked for reaches
//      the op.
//   5. A member (second page): "שלי"'s row with the count opens the oldest
//      waiting run directly; no tabs, no "השוואה חדשה"; a summary's run
//      (the owner rates it alone) is not in the member's list; skip → C28 →
//      the count drops; a full rating with "אין הבדל" shows the group's
//      score; the kind's results open read only.
//   6. Share: the owner's "לשלוח לקבוצה לדירוג" opens the sheet with C49's
//      text and a WhatsApp link.
// And the layout: 320 to 1440 px, light and dark, no sideways scroll; two
// answers side by side from 768 px; the a11y check on every screen.
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=y node e2e/study/models-rate.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: E2E_FLAGS=y node e2e/study/models-rate.cjs <dist> <out dir>");
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
  L.pace = 900;
  const OWNER = db.group.created_by;
  const MEMBER = db.members.find((m) => m.user_id !== OWNER).user_id;
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
      if (Date.now() - t > ms) throw new Error(`waited for "${text}"; the page says: ${(await body()).slice(0, 700)}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    return true;
  };
  const until = async (f, what, ms = 10000) => {
    const t = Date.now();
    while (!(await f())) {
      if (Date.now() - t > ms) throw new Error(`waited for: ${what}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const shot = async (name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  const ops = (action) => L.calls.filter((c) => c.fn === `op lab ${action}`);
  const blind = async (who) => {
    const t = await body();
    expect(!MODEL_NAMES.test(t), `${who}: no model's name before saving`);
    expect(!t.includes("$"), `${who}: no $ before saving`);
    expect(!/שניות|טוקנים/.test(t), `${who}: no time and no tokens before saving`);
  };
  const panel = (label) => page.locator(".md-rate-panel.on", { has: page.getByRole("heading", { name: `תשובה ${label}` }) });
  const noSideScroll = async (name) => {
    const size = page.viewportSize();
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: width >= 768 ? 1000 : 700 });
        await page.waitForTimeout(200);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 1) throw new Error(`${name}: ${over} px of horizontal scroll at ${width} px (${scheme})`);
        if (width >= 768) {
          const shown = await page.locator(".md-rate-panel").evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== "none").length);
          if (shown < 2) throw new Error(`${name}: ${shown} answer(s) shown at ${width} px, not side by side`);
        }
        if (width !== 320) await page.screenshot({ path: path.join(out, `${name}-${width}-${scheme}.png`), fullPage: true });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize(size);
    await page.waitForTimeout(200);
    ok.push(`${name}: no horizontal scroll at 320, 390, 768 and 1440 px, light and dark; two answers side by side from 768 px`);
  };

  try {
    if (!flags.models) throw new Error("this script needs the flag set y (VITE_STUDY_MODELS)");

    /* ── 4. Blind, the owner too ── */
    await open("שוהם", "/?v=models&x=new&k=practice");
    await page.getByRole("radio", { name: "שאלות תרגול" }).waitFor({ timeout: 10000 });
    expect((await page.getByRole("radio", { name: "שאלות תרגול" }).getAttribute("aria-checked")) === "true", "the new comparison: שאלות תרגול chosen");
    await has("הקבוצה מדרגת");
    await page.getByRole("checkbox", { name: /Claude Sonnet 5\.5/ }).waitFor({ timeout: 10000 });
    expect(await page.getByRole("checkbox", { name: /Claude Opus 5\.5/ }).isChecked(), "Opus ticked (today's model)");
    expect(await page.getByRole("checkbox", { name: /Claude Sonnet 5\.5/ }).isChecked(), "Sonnet ticked (the rated kinds' candidate)");
    await page.getByText("עוד אפשרויות").click();
    const ai = page.getByRole("checkbox", { name: /גם ציון של AI/ });
    await ai.waitFor({ timeout: 5000 });
    expect(!(await ai.isChecked()), "the AI score is under עוד אפשרויות, off by default (OD12)");
    const button = page.locator(".ph-foot .a-btn.primary");
    await has("להריץ (עד $0.38)");
    expect(true, "the button's worst case holds the answers and practice's paid checks (2 × $0.004)");
    await shot("rate-new-practice", { primary: ".ph-foot .a-btn.primary" });
    await button.click();
    await page.waitForURL(/[?&]r=/, { timeout: 10000 });
    const run1 = new URL(page.url()).searchParams.get("r");
    expect(ops("run").at(-1)?.body.judge !== true, "run without the AI score");
    await has("התשובות בלי שמות. השמות, הזמן והעלות יופיעו אחרי הדירוג.", 15000);
    await page.locator(".md-rate").waitFor({ timeout: 15000 });
    await blind("the owner");
    expect((await page.getByRole("button", { name: "תשובה א" }).count()) === 0, "the answers by label only");
    const sw = page.getByRole("group", { name: "התשובות" });
    expect((await sw.getByRole("button").count()) === 3, "the switcher: two answers and the last step");
    expect((await sw.getByRole("button").first().getAttribute("aria-pressed")) === "true", "the first answer is pressed");
    await has("3/3 שאלות עברו בדיקה");
    await has("הבדיקה ענתה כמו המפתח בכל השאלות");
    expect(true, "the automatic checks and the paid check sit with each answer (C29)");
    await has("בהשוואה הזאת כל מודל כתב פחות פריטים מבדרך כלל");
    expect(true, "how the request differs (count) is said");
    const first = (await page.locator(".md-rate-panel.on .md-answer-name").innerText()).replace(/\s+/g, " ").trim().split(" ").pop();
    const second = first === "א" ? "ב" : "א";
    const fs1 = page.locator(".md-rate-panel.on fieldset").first();
    expect((await fs1.locator("legend").innerText()).includes(`כמה טובה תשובה ${first}?`), "one score per answer: a fieldset with its legend");
    expect((await fs1.getByRole("radio").count()) === 5, "five labelled radios");
    expect((await page.getByText("דירוג מפורט").count()) >= 1, "the owner's optional detail (דירוג מפורט)");
    await shot("rate-owner-first");
    await noSideScroll("rate-owner");
    await fs1.getByRole("radio", { name: "4 · טוב" }).check();
    await until(() => L.ratings.some((r) => r.user_id === OWNER && r.overall === 4), "the score is saved when tapped");
    expect(true, "the score is saved when tapped (study_lab_rate)");
    await sw.getByRole("button", { name: "איזו תשובה הכי טובה?" }).click();
    await has(`חסר דירוג לתשובה ${second}`);
    expect(await page.getByRole("button", { name: "שמירה והצגת השמות" }).isDisabled(), "save disabled with C27b");
    await page.reload();
    await page.locator(".md-rate").waitFor({ timeout: 15000 });
    await page.getByRole("group", { name: "התשובות" }).getByRole("button").first().click();
    expect(await page.locator(".md-rate-panel.on fieldset").first().getByRole("radio", { name: "4 · טוב" }).isChecked(), "the score survives a reload");
    // Offline: the taps wait on the device (C56) and go when the connection returns.
    await context.setOffline(true);
    await has("אין חיבור. הדירוג יישמר כשהחיבור יחזור.");
    await page.getByRole("group", { name: "התשובות" }).getByRole("button").nth(1).click();
    const p2 = page.locator(".md-rate-panel.on");
    await p2.locator("fieldset").first().getByRole("radio", { name: "3 · סביר" }).check();
    await p2.getByRole("checkbox", { name: "יש כאן טעות עובדתית" }).check();
    await p2.getByRole("textbox").fill("המינון בשקף אחר (בדוי)");
    await page.waitForTimeout(900);
    expect(!L.ratings.some((r) => r.user_id === OWNER && r.overall === 3), "offline: nothing is sent");
    await shot("rate-offline");
    await context.setOffline(false);
    await until(() => L.ratings.some((r) => r.user_id === OWNER && r.overall === 3 && r.error_flag && r.note.includes("המינון")), "the offline taps are sent when the connection returns");
    expect(true, "the taps made offline are kept in the draft and sent when the connection returns, with no reload");
    await page.reload();
    await page.locator(".md-rate").waitFor({ timeout: 15000 });
    // 6. Share, before the owner reveals.
    await page.getByRole("button", { name: "לשלוח לקבוצה לדירוג" }).click();
    const share = page.getByRole("dialog", { name: "לשלוח לקבוצה לדירוג" });
    await share.waitFor({ timeout: 5000 });
    expect(norm(await share.innerText()).includes(`יש השוואה חדשה לדירוג בתמצית (בערך 2 דקות): `), "the share sheet with C49's text");
    expect(norm(await share.innerText()).includes(`r=${run1}`), "the run's own link");
    const wa = await share.getByRole("link", { name: "לשלוח בוואטסאפ" }).getAttribute("href");
    expect(wa?.startsWith("https://wa.me/?text=") && decodeURIComponent(wa).includes(`r=${run1}`), "a WhatsApp link with the text");
    await shot("rate-share-sheet");
    await page.keyboard.press("Escape");
    await share.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
    // The last step, then the names.
    await page.getByRole("group", { name: "התשובות" }).getByRole("button", { name: "איזו תשובה הכי טובה?" }).click();
    expect(!(await body()).includes("חסר דירוג לתשובה"), "every answer has its score");
    await has("חסרה בחירה: איזו תשובה הכי טובה");
    await page.getByRole("radiogroup", { name: "איזו תשובה הכי טובה?" }).getByRole("radio", { name: `תשובה ${first}` }).check();
    await shot("rate-best");
    await blind("the owner, at the last step");
    await page.getByRole("button", { name: "שמירה והצגת השמות" }).click();
    await has("הדירוג נשמר.");
    await has("Claude");
    await has("הדירוג שלי 4");
    await has(`הבחירה שלי: תשובה ${first}`);
    expect(/שניות/.test(await body()) && (await body()).includes("$"), "after saving: the names, the time and the cost (C30)");
    expect(L.seen.some((s) => s.run_id === run1 && s.user_id === OWNER && s.rated && s.best_label === first), "the reveal recorded the best pick");
    await shot("rate-owner-revealed");
    // The AI score asked for reaches the op.
    await open("שוהם", "/?v=models&x=new&k=points");
    await page.getByRole("checkbox", { name: /Claude Sonnet 5\.5/ }).waitFor({ timeout: 10000 });
    await has("להריץ (עד $0.18)");
    await page.getByText("עוד אפשרויות").click();
    await page.getByRole("checkbox", { name: /גם ציון של AI/ }).check();
    await has("להריץ (עד $0.24)");
    expect(true, "the AI score's worst case joins the button's");
    await page.locator(".ph-foot .a-btn.primary").click();
    await page.waitForURL(/[?&]r=/, { timeout: 10000 });
    expect(ops("run").at(-1)?.body.judge === true, "the run asks the op for the AI score");
    await has("התשובות בלי שמות", 15000);

    /* ── 5. A member ── */
    const part = L.seedRated("part", OWNER, ["claude-opus-5-5", "claude-sonnet-5-5"], 2 * 3_600_000);
    const old = L.seedRated("cards", OWNER, ["claude-opus-5-5", "claude-sonnet-5-5"], 3 * 3_600_000);
    const todo = L.runs.filter((r) => r.member_rate && r.status === "done").length;
    await open("נועה", "/?v=me");
    await has(`השוואות לדירוג · ${todo} מחכות`);
    expect(!(await body()).includes("איזה מודל כותב כל דבר"), "a member has no owner's row");
    await page.getByRole("link", { name: /השוואות לדירוג/ }).click();
    await page.waitForURL(/[?&]r=/, { timeout: 10000 });
    expect(new URL(page.url()).searchParams.get("r") === old.id, "the row opens the oldest waiting run directly");
    await page.locator(".md-rate").waitFor({ timeout: 15000 });
    await blind("a member");
    expect(!(await page.getByText("דירוג מפורט").count()), "a member has no detail");
    expect(!(await page.getByRole("button", { name: "לשלוח לקבוצה לדירוג" }).count()), "a member has no share");
    await shot("rate-member");
    await page.getByRole("group", { name: "התשובות" }).getByRole("button", { name: "איזו תשובה הכי טובה?" }).click();
    await page.getByRole("button", { name: "לדלג על ההשוואה הזאת" }).click();
    const skip = page.getByRole("dialog", { name: "לדלג על ההשוואה הזאת" });
    await skip.waitFor({ timeout: 5000 });
    expect(norm(await skip.innerText()).includes("השמות יוצגו, והדירוג בהשוואה הזאת לא ייספר."), "skip asks first (C28)");
    await shot("rate-skip-sheet");
    await skip.getByRole("button", { name: "לדלג" }).click();
    await has("ההשוואה הזאת דולגה");
    await has("Claude");
    expect(L.seen.some((s) => s.run_id === old.id && s.user_id === MEMBER && !s.rated), "skipped: seen, not rated");
    await open("נועה", "/?v=models");
    expect(!(await page.getByRole("tablist").count()) && !(await body()).includes("השוואה חדשה") && !(await body()).includes("מי כותב מה"), "a member's list: no tabs, no השוואה חדשה, no מי כותב מה");
    expect(!(await body()).includes(part.title), "a summary's run is not in a member's list (the owner rates it alone)");
    await has("דולגה");
    await shot("rate-member-list");
    await open("נועה", "/?v=me");
    await has(`השוואות לדירוג · ${todo - 1 === 1 ? "אחת מחכה" : `${todo - 1} מחכות`}`);
    expect(true, "the count dropped after the skip");
    // A full rating of the owner's practice run, "אין הבדל".
    await open("נועה", `/?v=models&r=${run1}`);
    await page.locator(".md-rate").waitFor({ timeout: 15000 });
    for (let i = 0; i < 2; i++) {
      await page.getByRole("group", { name: "התשובות" }).getByRole("button").nth(i).click();
      await page.locator(".md-rate-panel.on fieldset").first().getByRole("radio", { name: i === 0 ? "5 · מצוין" : "2 · חלש" }).check();
    }
    await page.getByRole("group", { name: "התשובות" }).getByRole("button", { name: "איזו תשובה הכי טובה?" }).click();
    await page.getByRole("radiogroup", { name: "איזו תשובה הכי טובה?" }).getByRole("radio", { name: "אין הבדל" }).check();
    await page.getByRole("button", { name: "שמירה והצגת השמות" }).click();
    await has("הבחירה שלי: אין הבדל");
    await has("(2 דירגו)");
    expect(true, "after the member's reveal: the group's score with n (C30)");
    expect(!(await body()).includes("בחודש בקצב הנוכחי"), "a member gets no monthly projection");
    await page.getByRole("link", { name: "לתוצאות של ״שאלות תרגול״" }).click();
    await page.waitForURL(/x=board/, { timeout: 10000 });
    await page.locator(".md-model").first().waitFor({ timeout: 10000 });
    expect(!(await page.getByRole("button", { name: /להשתמש בו/ }).count()) && !(await page.getByRole("tablist").count()), "a member's results are read only");
    expect(/\d\.\d\/5 · (השוואה אחת|\d+ השוואות)/.test(await body()), "the group's score on the results, with how many comparisons it rests on");
    await shot("rate-member-board");
    await open("נועה", "/?v=me");
    await page.waitForTimeout(800);
    const left = L.runs.filter((r) => r.member_rate && r.status === "done" && !L.seen.some((s) => s.run_id === r.id && s.user_id === MEMBER)).length;
    if (left) await has(`השוואות לדירוג · ${left === 1 ? "אחת מחכה" : `${left} מחכות`}`);
    else expect(!(await body()).includes("השוואות לדירוג"), "nothing waits: no row");
    expect(true, `"שלי" counts ${left} waiting after the member's rating`);

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
