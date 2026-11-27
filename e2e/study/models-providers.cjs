// "השוואת מודלים" with other providers (design-models §12.3, scenario 9;
// WP9: OpenAI and Google), on the shared mock with synthetic material only:
// no real model, no key, no paid call. Health's `providers` booleans are
// played by db.providers (whether a key is set on Vercel); the group's
// consent by mocks/lab.cjs's study_model_provider_set; the op "lab" refuses
// a provider without its key, its consent or a scope that takes the kind,
// as server/study/lab.ts's labRefusal does. In order:
//   1. No key: "ספקים" folded as "כרגע רק Claude"; "אין מפתח ב-Vercel" opens
//      the key sheet (the provider's spend limit first, the variable's name,
//      Production only, the unchecked prices); a new comparison offers Claude
//      only; help's line names Anthropic alone.
//   2. OpenAI's and Google's keys set: the block opens, each "מוגדר" with
//      "לאשר שליחה"; still Claude only until the group approves.
//   3. "לאשר שליחה" for OpenAI: what is sent ("כל החומר", the default, scope
//      all) and its words (C42); approved. For Google: "רק טקסט" (scope
//      text), its own words; the chip "רק טקסט".
//   4. A new comparison: practice offers GPT (scope all) with "מחיר לא נבדק"
//      and not Gemini (scope text, a kind with pictures); points offers both.
//      A points run with Gemini and Opus runs blind (no model's name while it
//      runs), and its answers are served by the providers' stand-ins.
//   5. "מי כותב מה": an unverified price is never offered for production
//      (the route sheet lists Claude only).
//   6. Help: Anthropic, and for comparisons OpenAI and Google; "לבטל את
//      האישור" takes OpenAI back.
//   7. 320 to 1440 px, light and dark, no sideways scroll; the a11y check on
//      the providers' block and both sheets.
//   8. OpenRouter (WP10): its key sheet (the account blocks retaining hosts
//      and hosts in China); with its key and "לאשר שליחה", a new comparison
//      offers DeepSeek, Qwen, Kimi and GLM tagged "מחיר לא נבדק"; the model
//      only its maker serves says "המעבד של Alibaba Cloud נמצא בסין." (C43),
//      the others do not; a model without vision is not offered for a kind
//      with pictures; a points run with DeepSeek runs blind on OpenRouter's
//      slot; the route sheet still offers Claude only; help names OpenRouter.
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=y node e2e/study/models-providers.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: E2E_FLAGS=y node e2e/study/models-providers.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const norm = (s) => String(s).replace(/[⁦-⁩‎‏]/g, "").replace(/\s+/g, " ").trim();
const PHONE = { width: 390, height: 844 };
const MODEL_NAMES = /Claude|Opus|Sonnet|Haiku|Fable|GPT|Gemini|DeepSeek|Qwen|Kimi|GLM/;

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: ["שוהם", "נועה"] });
  mock.seedLecture();
  const db = mock.db;
  const L = db.labMock;
  L.pace = 1200;
  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const ok = [];
  const a11y = [];
  let page = null;
  let context = null;
  const open = async (who, p) => {
    if (context) await context.close().catch(() => undefined);
    ({ page, ctx: context } = await mock.open(browser, who, { viewport: PHONE }));
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
  const shot = async (name) => a11y.push(...(await snap(page, out, name)));
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
  const block = () => page.locator(".md-provider-block");
  const row = (name) => page.locator(".md-provider", { hasText: name });
  const offeredNames = async () => {
    await page.getByRole("checkbox", { name: /Claude Opus 5\.5/ }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(400); // the price answers, then the list settles
    // Each approved provider is its own group, folded unless one of its models is ticked: open them to read the names.
    const closed = page.locator(".md-new details.md-prov:not([open]) > summary");
    for (let i = 0; i < 5 && (await closed.count()); i++) await closed.first().click();
    return norm(await page.locator(".md-new").innerText());
  };
  /** A provider's group in a new comparison (its unverified note said once, in the summary). */
  const group = (name) => page.locator(".md-new details.md-prov", { hasText: name });

  try {
    if (!flags.models) throw new Error("run with E2E_FLAGS=y (VITE_STUDY_MODELS)");

    /* ── 1. No key ── */
    await open("שוהם", "/?v=models&x=routes");
    await has("ספקים");
    await has("כרגע רק Claude");
    expect(!(await block().getByRole("button", { name: "לאשר שליחה" }).count()), "no key: nothing to approve");
    await block().locator("summary", { hasText: "כרגע רק Claude" }).click();
    await row("OpenAI").getByRole("button", { name: "אין מפתח ב-Vercel" }).click();
    const keySheet = page.getByRole("dialog", { name: "להוסיף את OpenAI" });
    await keySheet.waitFor({ timeout: 5000 });
    await has("אצל OpenAI: קרדיט מראש של $5, והטעינה האוטומטית כבויה (Settings ← Billing).");
    await has("משתנה בשם OPENAI_API_KEY, בסביבת Production בלבד.");
    await has("הערך לא מוצג ולא מוזן באפליקציה.");
    await has("בהשוואות הם מוערכים פי 1.5, ואי אפשר להעביר אליהם סוג עבודה עד שהם נבדקים.");
    expect(true, "the key sheet (C42b): the spend limit first, the variable, Production only, the unchecked prices");
    await shot("providers-key-sheet");
    await page.keyboard.press("Escape");
    await keySheet.waitFor({ state: "detached", timeout: 5000 });
    await row("Google").getByRole("button", { name: "אין מפתח ב-Vercel" }).click();
    await has("אצל Google: מפתח מפרויקט שהחיוב (Billing) פעיל בו");
    await has("ומכסה יומית נמוכה של בקשות ב-Google Cloud (Quotas)");
    await has("משתנה בשם GEMINI_API_KEY");
    expect(true, "Google's key sheet: a billing project and a daily request quota");
    await page.keyboard.press("Escape");
    await page.goto(mock.base + "/?v=models&x=new&k=points");
    let names = await offeredNames();
    expect(!/GPT|Gemini/.test(names), "no key: a new comparison offers Claude only");
    await page.goto(mock.base + "/?v=help");
    await has("החומר של הקבוצה נשלח לכתיבה ל-Anthropic (Claude), בלי שמות של חברי הקבוצה.");
    expect(true, "help: Anthropic alone (OD21)");

    /* ── 2. Keys set ── */
    db.providers = { anthropic: true, openai: true, google: true, openrouter: false };
    await open("שוהם", "/?v=models&x=routes");
    await row("OpenAI").waitFor({ timeout: 10000 });
    expect(!(await block().locator("details", { hasText: "כרגע רק Claude" }).count()), "a key set: the block is open, not folded");
    expect(norm(await row("OpenAI").innerText()).includes("מוגדר") && (await row("OpenAI").getByRole("button", { name: "לאשר שליחה" }).count()) === 1, "OpenAI: מוגדר, לאשר שליחה");
    expect(norm(await row("Google").innerText()).includes("מוגדר"), "Google: מוגדר");
    expect(norm(await row("OpenRouter").innerText()).includes("אין מפתח ב-Vercel"), "OpenRouter: no key");
    await has("המחירים עוד לא נבדקו מול הדף של הספק");
    expect(true, "an unverified provider says its prices are not checked yet (D16)");
    await page.goto(mock.base + "/?v=models&x=new&k=points");
    names = await offeredNames();
    expect(!/GPT|Gemini/.test(names), "keys alone offer nothing: the group has not approved");

    /* ── 3. Consent ── */
    await page.goto(mock.base + "/?v=models&x=routes");
    await row("OpenAI").getByRole("button", { name: "לאשר שליחה" }).click();
    const approve = page.getByRole("dialog", { name: "לאשר שליחה ל-OpenAI?" });
    await approve.waitFor({ timeout: 5000 });
    expect((await approve.getByRole("group", { name: "מה יישלח" }).count()) === 1, "what is sent: a fieldset with its legend");
    expect(await approve.getByRole("radio", { name: /כל החומר/ }).isChecked(), "scope all is the default (OD19 as the owner changed it)");
    await has("יישלחו לשם חומרים מההרצאות (גם תמונות), מבחנים ודפים שהועלו, ונוסח שחברי הקבוצה כתבו, בלי שמות של חברי הקבוצה.");
    await shot("providers-approve-sheet");
    await approve.getByRole("button", { name: "לאשר", exact: true }).click();
    await approve.waitFor({ state: "detached", timeout: 5000 });
    await row("OpenAI").getByText("מאושר").waitFor({ timeout: 10000 });
    expect(L.providers.openai?.allowed === true && L.providers.openai.scope === "all", "OpenAI approved with scope all (recorded, D17)");
    await row("Google").getByRole("button", { name: "לאשר שליחה" }).click();
    const approveG = page.getByRole("dialog", { name: "לאשר שליחה ל-Google?" });
    await approveG.getByRole("radio", { name: /רק טקסט/ }).check();
    await has("יישלח לשם רק טקסט מההרצאות, בלי תמונות, בלי מבחנים ודפים שהועלו ובלי נוסח שחברי הקבוצה כתבו");
    await approveG.getByRole("button", { name: "לאשר", exact: true }).click();
    await row("Google").getByText("רק טקסט").waitFor({ timeout: 10000 });
    expect(L.providers.google?.allowed === true && L.providers.google.scope === "text", "Google approved with scope text: the chip רק טקסט");
    await shot("providers-approved");
    await noSideScroll("providers-block");

    /* ── 4. A new comparison ── */
    await page.goto(mock.base + "/?v=models&x=new&k=practice");
    names = await offeredNames();
    expect(names.includes("GPT-6.2 Sol") && names.includes("GPT-6 Luna"), "practice: OpenAI's models offered (scope all)");
    expect(!names.includes("Gemini"), "practice: Gemini not offered (scope text; practice sends pictures)");
    expect(norm(await group("GPT-6.2 Sol").locator("summary").innerText()).includes("מחיר לא נבדק"), "an unverified price is said once, on its provider's group: מחיר לא נבדק");
    expect(!norm(await page.locator(".md-new label", { hasText: "GPT-6.2 Sol" }).innerText()).includes("מחיר לא נבדק"), "not on every row");
    expect(norm(await page.locator(".md-new label", { hasText: "GPT-6.2 Sol" }).innerText()).includes("עד $"), "a model's worst case reads עד $…");
    await page.goto(mock.base + "/?v=models&x=new&k=points");
    names = await offeredNames();
    expect(names.includes("Gemini 3.8 Flash") && names.includes("GPT-6.2 Sol"), "points: both providers offered (text kinds)");
    await shot("providers-new");
    if (await page.getByRole("checkbox", { name: /Claude Sonnet 5\.5/ }).isChecked()) await page.getByRole("checkbox", { name: /Claude Sonnet 5\.5/ }).uncheck();
    await page.getByRole("checkbox", { name: /Gemini 3\.8 Flash/ }).check();
    expect(await page.getByRole("checkbox", { name: /Claude Opus 5\.5/ }).isChecked(), "Opus beside Gemini");
    const go = page.locator(".ph-foot .a-btn.primary");
    await page.waitForFunction(() => !document.querySelector(".ph-foot .a-btn.primary")?.disabled, null, { timeout: 10000 });
    await go.click();
    await page.waitForURL(/r=/, { timeout: 10000 });
    await has("תשובות מוכנות");
    const during = await body();
    expect(!MODEL_NAMES.test(during.replace(/השוואת מודלים/g, "")), "blind while it runs: no model's name, Gemini's included");
    const run = L.runs[L.runs.length - 1];
    const outs = L.outputs.filter((o) => o.run_id === run.id);
    expect(outs.some((o) => o.model === "google:gemini-3.8-flash" && o.provider === "google"), "the run has Gemini's slot, served by google");
    await has("התשובות בלי שמות", 20000);
    expect(true, "the run finished; the blind rating opens (scenario 4 holds for every provider)");

    /* ── 5. Production routes: never an unverified price ── */
    await page.goto(mock.base + "/?v=models&x=routes");
    await page.locator(".md-route-row", { hasText: "נקודות שצריך לדעת" }).click();
    const routeSheet = page.getByRole("dialog", { name: "מי כותב ״נקודות שצריך לדעת״" });
    await routeSheet.waitFor({ timeout: 5000 });
    const sheetText = norm(await routeSheet.innerText());
    expect(!/GPT|Gemini/.test(sheetText) && sheetText.includes("Claude Opus 5.5"), "the route sheet offers no unverified price (D16): Claude only");
    await page.keyboard.press("Escape");

    /* ── 6. Help, and the undo ── */
    await page.goto(mock.base + "/?v=help");
    await has("החומר של הקבוצה נשלח לכתיבה ל-Anthropic (Claude), ובהשוואת מודלים גם ל-OpenAI ו-Google. אף אחד מהם לא מקבל שמות של חברי הקבוצה.");
    expect(true, "help: the approved providers named (OD21, informational)");
    await page.goto(mock.base + "/?v=models&x=routes");
    await row("OpenAI").getByRole("button", { name: "לבטל את האישור" }).click();
    await row("OpenAI").getByRole("button", { name: "לאשר שליחה" }).waitFor({ timeout: 10000 });
    expect(L.providers.openai?.allowed === false, "לבטל את האישור: OpenAI is off again");
    await page.goto(mock.base + "/?v=models&x=new&k=points");
    names = await offeredNames();
    expect(!names.includes("GPT") && names.includes("Gemini 3.8 Flash"), "after the undo: no GPT in a new comparison");

    /* ── 8. OpenRouter: DeepSeek, Qwen, Kimi and GLM (WP10, OD22) ── */
    await page.goto(mock.base + "/?v=models&x=routes");
    await row("OpenRouter").getByRole("button", { name: "אין מפתח ב-Vercel" }).click();
    const orSheet = page.getByRole("dialog", { name: "להוסיף את OpenRouter" });
    await orSheet.waitFor({ timeout: 5000 });
    await has("אצל OpenRouter: קרדיט מראש של $5, הטעינה האוטומטית כבויה, ובהגדרות חסימה של ספקים ששומרים את המידע או מתאמנים עליו ושל ספקים שנמצאים בסין.");
    await has("משתנה בשם OPENROUTER_API_KEY, בסביבת Production בלבד.");
    expect(true, "OpenRouter's key sheet: $5 prepaid, the account blocks retaining hosts and hosts in China (OD18, OD22)");
    await shot("providers-openrouter-key");
    await page.keyboard.press("Escape");
    await orSheet.waitFor({ state: "detached", timeout: 5000 });
    db.providers = { anthropic: true, openai: true, google: true, openrouter: true };
    await open("שוהם", "/?v=models&x=routes");
    await row("OpenRouter").getByRole("button", { name: "לאשר שליחה" }).click();
    const approveOr = page.getByRole("dialog", { name: "לאשר שליחה ל-OpenRouter?" });
    await approveOr.waitFor({ timeout: 5000 });
    expect(await approveOr.getByRole("radio", { name: /כל החומר/ }).isChecked(), "OpenRouter: scope all by default");
    await approveOr.getByRole("button", { name: "לאשר", exact: true }).click();
    await row("OpenRouter").getByText("מאושר").waitFor({ timeout: 10000 });
    expect(L.providers.openrouter?.allowed === true && L.providers.openrouter.scope === "all", "OpenRouter approved with scope all (D17)");
    await page.goto(mock.base + "/?v=models&x=new&k=points");
    names = await offeredNames();
    if (!names.includes("DeepSeek V4 Pro")) {
      await page.locator(".md-new button.a-link", { hasText: /עוד \d+ מודלים/ }).click();
      names = norm(await page.locator(".md-new").innerText());
    }
    for (const n of ["DeepSeek V4 Pro", "DeepSeek V4 Flash", "Qwen4 Max", "Kimi K3", "GLM 5.3"]) expect(names.includes(n), `points: ${n} offered through OpenRouter`);
    const qmax = page.locator(".md-new label", { hasText: "Qwen4 Max" });
    expect(norm(await qmax.innerText()).includes("הבקשות למודל הזה מעובדות בסין (Alibaba Cloud)."), "C43: the model only its maker serves says where it is processed");
    expect(norm(await group("Qwen4 Max").locator("summary").innerText()).includes("מחיר לא נבדק"), "OpenRouter's group: מחיר לא נבדק");
    const pro = page.locator(".md-new label", { hasText: "DeepSeek V4 Pro" });
    expect(!norm(await pro.innerText()).includes("בסין"), "DeepSeek V4 Pro: on hosts outside China, no C43 line");
    await shot("providers-openrouter-new");
    await noSideScroll("providers-openrouter-new");
    for (const id of ["claude-sonnet-5-5", "claude-haiku-5-5", "google:gemini-3.8-flash"]) {
      const box = page.locator(".md-new label", { hasText: id === "google:gemini-3.8-flash" ? "Gemini 3.8 Flash" : id === "claude-haiku-5-5" ? "Claude Haiku 5.5" : "Claude Sonnet 5.5" }).getByRole("checkbox");
      if ((await box.count()) && (await box.isChecked())) await box.uncheck();
    }
    await pro.getByRole("checkbox").check();
    expect(await page.getByRole("checkbox", { name: /Claude Opus 5\.5/ }).isChecked(), "Opus beside DeepSeek");
    await page.waitForFunction(() => !document.querySelector(".ph-foot .a-btn.primary")?.disabled, null, { timeout: 10000 });
    await page.locator(".ph-foot .a-btn.primary").click();
    await page.waitForURL(/r=/, { timeout: 10000 });
    await has("תשובות מוכנות");
    expect(!MODEL_NAMES.test((await body()).replace(/השוואת מודלים/g, "")), "blind while it runs: no model's name, DeepSeek's included");
    const orRun = L.runs[L.runs.length - 1];
    expect(
      L.outputs.some((o) => o.run_id === orRun.id && o.model === "openrouter:deepseek/deepseek-v4-pro" && o.provider === "openrouter"),
      "the run has DeepSeek's slot, served by openrouter",
    );
    await has("התשובות בלי שמות", 20000);
    expect(L.refusal("openrouter:deepseek/deepseek-v4-pro", "part") === "no vision" && L.refusal("openrouter:moonshotai/kimi-k3", "part") === null, "a kind with pictures: DeepSeek refused (no vision), Kimi K3 reads them");
    await page.goto(mock.base + "/?v=models&x=routes");
    await page.locator(".md-route-row", { hasText: "נקודות שצריך לדעת" }).click();
    const routeSheet2 = page.getByRole("dialog", { name: "מי כותב ״נקודות שצריך לדעת״" });
    await routeSheet2.waitFor({ timeout: 5000 });
    expect(!/DeepSeek|Qwen|Kimi|GLM/.test(norm(await routeSheet2.innerText())), "the route sheet offers no OpenRouter model: unverified prices (D16)");
    await page.keyboard.press("Escape");
    await page.goto(mock.base + "/?v=help");
    await has("ובהשוואת מודלים גם ל-Google ו-OpenRouter.");
    expect(true, "help names OpenRouter once approved (OD21)");

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
