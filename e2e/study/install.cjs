// Adding תמצית to the home screen (docs/study/install.md; VITE_STUDY_INSTALL),
// on a mocked Supabase, in Chromium with the phones' user agents (WebKit is
// not installed here): an iPhone's Safari (iOS 26 and 18, and an iPad), the
// built-in browser of another app (a WKWebView as WhatsApp's would be, and
// Instagram's), Android's Chrome with and without the browser's own prompt
// (a stubbed beforeinstallprompt, before React mounts too), the home-screen
// app itself (display-mode emulated by an init script), and a computer.
//
//   NODE_PATH=$(npm root -g) node e2e/study/install.cjs <dist> <out dir>
//
// The build decides what runs: with VITE_STUDY_INSTALL every case below; a
// build without it gets the off checks (?v=install is the library with no
// notice; no row, no card, no line on the join screen). E2E_FLAGS is the mock's
// flag set (default "i"; "s2" works the same: the flag needs no section).
// The screenshots are <out>/install-*-<scheme>.png (a11y.cjs at each).
const fs = require("fs");
const { chromium, devices } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/install.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(process.env.E2E_FLAGS || "i");

const IPHONE = devices["iPhone 15 Pro"]; // Version/26.x: Safari 26
const IOS26 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IOS18 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const WKWEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 360.0.0.30.109 (iPhone15,2; iOS 18_6; he_IL; he; scale=3.00; 1179x2556; 664380519)";
const PIXEL = devices["Pixel 7"];
const CLIP = ["clipboard-read", "clipboard-write"];
const DAY = 86_400_000;

const T = {
  step: "להוסיף למסך הבית",
  row: "להוסיף את תמצית למסך הבית",
  rowHere: "תמצית פתוחה מהאייקון ✓",
  title: "תמצית במסך הבית",
  walk1: "ההוספה למסך הבית נמצאת ב״שלי״.",
  walk2: "כאן. ההסבר מותאם לטלפון שלך.",
  make: "יצירת קוד אישי",
  copy: "העתקת הקוד",
  copied: "הקוד הועתק ✓",
  said: "הוספתי",
  saidDone: "מעכשיו נכנסים מהאייקון. אפשר לסגור את הלשונית בספארי.",
  later: "לא עכשיו",
  how: "איך מוסיפים",
  install: "התקנה",
  accepted: "הותקנה ✓ אפשר לפתוח מהאייקון.",
  dismissed: "אפשר להתקין גם אחר כך, מכאן.",
  safari: "פתיחה בספארי",
  copyLink: "העתקת הקישור",
  chromeMenu: "בתפריט ⋮ בוחרים ״התקנת אפליקציה״ או ״הוספה למסך הבית״.",
  standalone: "תמצית כבר פתוחה מהאייקון ✓",
  desktop: "במחשב אפשר פשוט להמשיך בדפדפן.",
  joinIos: "אחרי ההצטרפות אפשר להוסיף את תמצית למסך הבית. מסבירים בפנים.",
};

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  mock.db.codes.on = true; // the personal code is offered (section I)
  mock.seedLecture();
  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  let n = 0;
  const check = (name, ok, detail) => {
    n += 1;
    steps[`${String(n).padStart(2, "0")} ${name}`] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const shot = async (page, name, o) => a11y.push(...(await snap(page, out, `install-${name}`, o)));
  const id = (name) => mock.people[name].user.id;
  const guideMem = (o) => JSON.stringify({ v: 1, views: 0, did: [], list: [], tips: true, ...o });
  /** A member whose guide memory is long past (no first steps, no tour offer). */
  const old = (name) => ({ [`study-guide:${id(name)}`]: guideMem({ born: Date.now() - 30 * DAY, mode: "join", views: 9, known: ["today"] }) });
  /** A member who just started the first steps on this device. */
  const fresh = (name) => ({ [`study-guide:${id(name)}`]: guideMem({ born: Date.now(), mode: "join", known: ["today"] }) });
  const mem = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);
  const visible = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible());
  const homeReady = (page) => page.locator(".today .t-sec, main.library").first().waitFor({ timeout: 15000 });
  const waitBubble = (page, text, timeout = 8000) =>
    page.waitForFunction((t) => {
      const b = document.querySelector(".g-bubble:not([hidden])");
      return Boolean(b && b.textContent.includes(t));
    }, text, { timeout });
  const tab = (page, name) => page.locator(".ph-tabs").getByRole("link", { name });

  try {
    // Does this build have the flag? ?v=install on a computer shows its screen, or the library.
    const probe = await mock.open(browser, "שוהם", { path: "/?v=install" });
    await probe.page.locator("main.install-screen, main.library").first().waitFor({ timeout: 15000 });
    const on = (await probe.page.locator("main.install-screen").count()) > 0;
    await probe.ctx.close();
    steps["00 the build"] = on ? "VITE_STUDY_INSTALL on" : "VITE_STUDY_INSTALL off";

    if (!on) {
      // The flag off: nothing of it anywhere, and ?v=install is the library with no notice.
      const { page } = await mock.open(browser, "נועה", { device: IPHONE, userAgent: IOS26, storage: old("נועה"), path: "/?v=install" });
      await page.locator("main.library").waitFor({ timeout: 15000 });
      check("off: ?v=install is the library", new URL(page.url()).search === "?v=library", page.url());
      check("off: no notice", (await page.locator(".a-toast").count()) === 0 || !(await page.locator(".a-toast").innerText()).includes("עוד לא פתוחה"));
      await page.goto(mock.base + "/");
      await homeReady(page);
      await page.waitForTimeout(800);
      check("off: no card on the home", (await page.locator(".inst-card").count()) === 0);
      await page.goto(mock.base + "/?v=me");
      await page.locator("main.me-screen").waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
      check("off: no row in שלי", (await page.locator(".install-row, .inst-row-here").count()) === 0);
      const { page: v } = await mock.open(browser, null, { userAgent: WKWEBVIEW, isMobile: true, hasTouch: true, path: "/?join=ABC123" });
      await v.locator(".code-input").waitFor({ timeout: 15000 });
      check("off: no line on the join screen", (await v.locator(".join-inapp, .join-install").count()) === 0);
    } else {
      /* ── 1. iPhone, Safari 26, a member who just joined: the guide's step, its walk, the screen ── */
      {
        const { page, ctx } = await mock.open(browser, "נועה", { device: IPHONE, userAgent: IOS26, permissions: CLIP, storage: fresh("נועה"), path: "/" });
        await homeReady(page);
        await page.locator(".g-steps").waitFor({ timeout: 15000 });
        await page.waitForFunction(() => document.querySelectorAll(".g-steps li").length > 0, null, { timeout: 15000 });
        const items = await page.locator(".g-steps li b").allInnerTexts();
        check("iPhone: the guide's card has the step, second", items[1]?.trim() === T.step, JSON.stringify(items));
        check("iPhone: its line names the personal code", (await page.locator(".g-steps li", { hasText: T.step }).innerText()).includes("הקוד האישי"));
        check("iPhone: no install card while the guide's card is there", (await page.locator(".inst-card").count()) === 0);
        await page.getByRole("button", { name: `להראות: ${T.step}` }).click();
        await waitBubble(page, T.walk1);
        check("walk: first to שלי's tab", true);
        await tab(page, "שלי").click();
        await waitBubble(page, T.walk2);
        await page.waitForTimeout(400);
        const ringOk = await page.evaluate(() => {
          const r = document.querySelector(".g-ring:not([hidden])")?.getBoundingClientRect();
          const row = document.querySelector("a.install-row")?.getBoundingClientRect();
          if (!r || !row) return false;
          return r.left <= row.left + 2 && r.right >= row.right - 2 && r.top <= row.top + 2 && r.bottom >= row.bottom - 2;
        });
        check("walk: the row in שלי, ringed", ringOk);
        await shot(page, "1-me-row");
        await page.locator("a.install-row").click();
        await page.locator("main.install-screen").waitFor({ timeout: 10000 });
        check("the row opens ?v=install", new URL(page.url()).search === "?v=install", page.url());
        await page.locator(".g-bubble:not([hidden])").waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
        check("the walk ends on the member's own tap", (await page.locator(".g-bubble:not([hidden])").count()) === 0);
        check("three numbered cards", (await page.locator(".inst-step").count()) === 3, String(await page.locator(".inst-step").count()));
        check("Safari 26: ⋯ first, then the share icon", (await page.getByRole("img", { name: "כפתור שלוש הנקודות" }).count()) === 1 && (await page.getByRole("img", { name: "סמל השיתוף" }).count()) === 1);
        check("the arrow at Safari's bar, at the bottom", await visible(page.locator(".inst-arrow.bottom")));
        check("the missing row's hint", (await page.getByText("אין ״הוספה למסך הבית״? כנראה זה לא ספארי.", { exact: false }).count()) === 1);
        // Step 1: no code yet, so one is made here, then copied.
        await page.getByRole("button", { name: T.make }).click();
        const codeEl = page.locator(".inst-code");
        await codeEl.waitFor({ timeout: 10000 });
        const code = (await codeEl.innerText()).trim();
        check("step 1: the code, shown LTR", /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/.test(code) && (await codeEl.getAttribute("dir")) === "ltr", code);
        await shot(page, "2-iphone-steps");
        await page.getByRole("button", { name: T.copy }).click();
        await page.getByRole("button", { name: T.copied }).waitFor({ timeout: 5000 });
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        check("step 1: the code is in the clipboard", clip === code, clip);
        await page.getByRole("button", { name: T.said }).click();
        await page.getByText(T.saidDone).waitFor({ timeout: 5000 });
        check("הוספתי: the closing line", true);
        check("הוספתי: no arrow after", (await page.locator(".inst-arrow").count()) === 0);
        const im = await mem(page, "study-install");
        check("הוספתי: kept on this browser", Boolean(im?.done) && im.via === "said", JSON.stringify(im));
        const gm = await mem(page, `study-guide:${id("נועה")}`);
        check("הוספתי: the guide's step is ticked", gm?.did?.includes("install"), JSON.stringify(gm?.did));
        await page.reload();
        await page.locator("main.install-screen").waitFor({ timeout: 10000 });
        await page.goto(mock.base + "/");
        await homeReady(page);
        await page.waitForFunction(() => document.querySelectorAll(".g-steps li").length > 0, null, { timeout: 15000 });
        const s9 = await page.locator(".g-steps li", { hasText: T.step }).innerText();
        check("after a reload the step stays ticked", s9.includes("בוצע") || s9.includes("✓"), s9);
        await page.goto(mock.base + "/?v=me");
        await page.locator("a.install-row").waitFor({ timeout: 10000 });
        check("שלי: the row says it was added", (await page.locator("a.install-row .a-chip").innerText()).includes("נוסף"));
        await ctx.close();
      }

      /* ── 2. iPhone, an existing member: the home's card once; "לא עכשיו" for good ── */
      {
        const { page, ctx } = await mock.open(browser, "שוהם", { device: IPHONE, userAgent: IOS26, storage: old("שוהם"), path: "/" });
        await homeReady(page);
        const card = page.locator(".inst-card");
        await card.waitFor({ timeout: 10000 });
        check("existing member: the card on Today", (await card.innerText()).includes(T.title));
        check("the card: איך מוסיפים leads to the steps", (await card.getByRole("link", { name: T.how }).getAttribute("href")) === "/?v=install");
        check("one install surface: no guide card", (await page.locator(".g-steps").count()) === 0);
        await shot(page, "3-today-card");
        await card.getByRole("button", { name: T.later }).click();
        check("לא עכשיו: gone", (await card.count()) === 0);
        await page.reload();
        await homeReady(page);
        await page.waitForTimeout(1000);
        check("לא עכשיו: gone after a reload", (await page.locator(".inst-card").count()) === 0);
        await tab(page, "שלי").click();
        await page.locator("a.install-row").waitFor({ timeout: 10000 });
        check("the row in שלי stays", true);
        // iOS 18: the share icon line, no ⋯.
        await ctx.close();
        const { page: p18, ctx: c18 } = await mock.open(browser, "שוהם", { device: IPHONE, userAgent: IOS18, storage: old("שוהם"), path: "/?v=install" });
        await p18.locator("main.install-screen .inst-step").first().waitFor({ timeout: 10000 });
        check("iOS 18: the share icon, no ⋯", (await p18.getByRole("img", { name: "כפתור שלוש הנקודות" }).count()) === 0 && (await p18.getByRole("img", { name: "סמל השיתוף" }).count()) === 1);
        await c18.close();
        // An iPad says it is a Mac (with touch): the arrow at the top.
        const { page: pad, ctx: cpad } = await mock.open(browser, "שוהם", { userAgent: IPADOS, isMobile: true, hasTouch: true, viewport: { width: 820, height: 1180 }, storage: old("שוהם") });
        await cpad.addInitScript(() => {
          Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel", configurable: true });
          Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5, configurable: true });
        });
        await pad.goto(mock.base + "/?v=install");
        await pad.locator("main.install-screen .inst-step").first().waitFor({ timeout: 10000 });
        check("iPad: the arrow at the top", await visible(pad.locator(".inst-arrow.top")));
        await cpad.close();
      }

      /* ── 3. another app's browser: the way out, the invite's code kept ── */
      for (const [label, ua] of [
        ["a WKWebView (WhatsApp's would be one)", WKWEBVIEW],
        ["Instagram", INSTAGRAM],
      ]) {
        const { page, ctx } = await mock.open(browser, null, { userAgent: ua, isMobile: true, hasTouch: true, permissions: CLIP, path: "/?join=ABC123" });
        await page.locator(".code-input").waitFor({ timeout: 15000 });
        const callout = page.locator(".join-inapp");
        await callout.waitFor({ timeout: 5000 }).catch(() => undefined); // its words come with a lazy chunk, after the field
        check(`${label}: the join screen's callout`, await visible(callout));
        const href = await callout.getByRole("link", { name: T.safari }).getAttribute("href");
        check(`${label}: פתיחה בספארי keeps ?join=`, href === `x-safari-${mock.base}/?join=ABC123`, href);
        await callout.getByRole("button", { name: T.copyLink }).click();
        await callout.getByText("הקישור הועתק.", { exact: false }).waitFor({ timeout: 5000 });
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        check(`${label}: the link copied`, clip === `${mock.base}/?join=ABC123`, clip);
        check(`${label}: the join form is still there`, await visible(page.getByRole("button", { name: "הצטרפות" })));
        if (ua === WKWEBVIEW) await shot(page, "4-join-inapp");
        await ctx.close();
      }
      {
        const { page, ctx } = await mock.open(browser, "נועה", { userAgent: INSTAGRAM, isMobile: true, hasTouch: true, storage: old("נועה"), path: "/?v=install" });
        await page.locator("main.install-screen").waitFor({ timeout: 10000 });
        await page.locator(".inst-code-step").waitFor({ timeout: 10000 });
        const codeFirst = await page.evaluate(() => {
          const c = document.querySelector(".inst-code-step");
          const i = document.querySelector(".inst-inapp");
          return Boolean(c && i && c.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        check("Instagram, a member: the code first, then פותחים בספארי", codeFirst && (await page.locator(".inst-inapp").innerText()).includes("פותחים בספארי"));
        check("Instagram, a member: the way out", (await page.getByRole("link", { name: T.safari }).getAttribute("href")) === `x-safari-${mock.base}/?v=install`);
        await shot(page, "5-inapp-member");
        await ctx.close();
      }
      {
        // An iPhone's Safari on the join screen: one quiet line under the form.
        const { page, ctx } = await mock.open(browser, null, { device: IPHONE, userAgent: IOS26, path: "/?join=ABC123" });
        await page.locator(".code-input").waitFor({ timeout: 15000 });
        check("iPhone Safari: the join screen's quiet line", await visible(page.getByText(T.joinIos)));
        check("iPhone Safari: no callout", (await page.locator(".join-inapp").count()) === 0);
        await ctx.close();
      }

      /* ── 4. Android Chrome: the menu; the browser's own prompt ── */
      {
        const { page, ctx } = await mock.open(browser, "נועה", { device: PIXEL, storage: old("נועה"), path: "/?v=install" });
        await page.locator("main.install-screen .inst-step").first().waitFor({ timeout: 10000 });
        check("Android, no prompt: the menu's words", await visible(page.getByText(T.chromeMenu)));
        check("Android: no code step (the app shares Chrome's storage)", (await page.locator(".inst-code-step").count()) === 0);
        await shot(page, "6-android-menu");
        await page.getByRole("button", { name: T.said }).click();
        await page.getByText("מעכשיו נכנסים מהאייקון.").waitFor({ timeout: 5000 });
        check("Android: הוספתי", true);
        await ctx.close();
      }
      const stub = (outcome) =>
        `(() => { const e = new Event("beforeinstallprompt", { cancelable: true }); e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: "${outcome}", platform: "web" }); window.dispatchEvent(e); })()`;
      {
        const { page, ctx } = await mock.open(browser, "נועה", { device: PIXEL, storage: old("נועה"), path: "/" });
        await homeReady(page);
        await page.evaluate(stub("accepted"));
        const card = page.locator(".inst-card");
        await card.waitFor({ timeout: 10000 });
        const btn = card.getByRole("button", { name: T.install });
        check("Android, a prompt: the card's own התקנה", await visible(btn));
        await shot(page, "7-android-card");
        await btn.click();
        await page.waitForFunction(() => window.__prompted === 1, null, { timeout: 5000 });
        check("התקנה: the browser's dialog, once", true);
        await page.locator(".a-toast", { hasText: T.accepted }).waitFor({ timeout: 5000 });
        check("accepted: הותקנה ✓, the card gone", (await card.count()) === 0);
        const im = await mem(page, "study-install");
        check("accepted: kept", Boolean(im?.done) && im.via === "prompt", JSON.stringify(im));
        await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
        await page.waitForTimeout(300);
        const gm = await mem(page, `study-guide:${id("נועה")}`);
        check("the guide's step is ticked by the install", gm?.did?.includes("install"), JSON.stringify(gm?.did));
        await ctx.close();
      }
      {
        const { page, ctx } = await mock.open(browser, "נועה", { device: PIXEL, storage: old("נועה"), path: "/?v=install" });
        await page.locator("main.install-screen").waitFor({ timeout: 10000 });
        await page.evaluate(stub("dismissed"));
        await page.getByRole("button", { name: T.install }).click();
        await page.getByText(T.dismissed).waitFor({ timeout: 5000 });
        check("dismissed: the soft line, and the menu's way stays", await visible(page.getByText(T.chromeMenu)));
        check("dismissed: not marked added", !(await mem(page, "study-install"))?.done);
        await ctx.close();
      }
      {
        // The event before React mounts (the module has run, React has not rendered): the early listener keeps it.
        const { page, ctx } = await mock.open(browser, "נועה", { device: PIXEL, storage: old("נועה") });
        await ctx.addInitScript(`document.addEventListener("DOMContentLoaded", () => { window.__early = !document.querySelector("main"); ${stub("accepted")}; })`);
        await page.goto(mock.base + "/?v=install");
        await page.locator("main.install-screen").waitFor({ timeout: 10000 });
        await page.getByRole("button", { name: T.install }).waitFor({ timeout: 5000 }).catch(() => undefined);
        check("an early prompt is kept", (await page.evaluate(() => window.__early)) === true && (await visible(page.getByRole("button", { name: T.install }))));
        await ctx.close();
      }

      /* ── 5. the home-screen app itself ── */
      {
        const { page, ctx } = await mock.open(browser, "נועה", { device: IPHONE, userAgent: IOS26, standalone: true, storage: fresh("נועה"), path: "/" });
        await homeReady(page);
        await page.waitForFunction(() => document.querySelectorAll(".g-steps li").length > 0, null, { timeout: 15000 });
        const items = await page.locator(".g-steps li b").allInnerTexts();
        check("standalone: no step for it in a fresh list", !items.some((t) => t.includes(T.step)), JSON.stringify(items));
        check("standalone: no card", (await page.locator(".inst-card").count()) === 0);
        const im = await mem(page, "study-install");
        check("standalone: the launch is kept as added", Boolean(im?.done) && im.via === "standalone", JSON.stringify(im));
        await tab(page, "שלי").click();
        await page.locator(".inst-row-here").waitFor({ timeout: 10000 });
        check("standalone: שלי says it is open from the icon", (await page.locator(".inst-row-here").innerText()).includes(T.rowHere));
        await page.goto(mock.base + "/?v=install");
        await page.getByText(T.standalone).waitFor({ timeout: 10000 });
        check("standalone: ?v=install says so", true);
        await ctx.close();
      }
      {
        // The icon's first launch on iOS: an empty storage, the personal code first.
        const { page, ctx } = await mock.open(browser, null, { device: IPHONE, userAgent: IOS26, standalone: true, permissions: CLIP, path: "/" });
        await page.getByRole("button", { name: "כניסה עם הקוד האישי" }).waitFor({ timeout: 15000 });
        await page.getByRole("button", { name: "כניסה עם הקוד האישי" }).click();
        await page.getByRole("button", { name: "הדבקה" }).waitFor({ timeout: 10000 }).catch(() => undefined);
        check("the icon's first launch: the code's entry with הדבקה", await visible(page.getByRole("button", { name: "הדבקה" })));
        await ctx.close();
      }

      /* ── 6. a computer ── */
      {
        const { page, ctx } = await mock.open(browser, "שוהם", { viewport: { width: 1280, height: 800 }, storage: old("שוהם"), path: "/" });
        await homeReady(page);
        await page.waitForTimeout(800);
        check("computer: no card", (await page.locator(".inst-card").count()) === 0);
        await tab(page, "שלי").click();
        await page.locator("main.me-screen").waitFor({ timeout: 10000 });
        await page.waitForTimeout(500);
        check("computer: no row in שלי", (await page.locator(".install-row").count()) === 0);
        await page.evaluate(stub("accepted"));
        await page.locator("a.install-row").waitFor({ timeout: 5000 });
        check("computer with the browser's prompt: the row", true);
        await page.goto(mock.base + "/?v=install");
        await page.getByText(T.desktop).waitFor({ timeout: 10000 });
        check("computer, no prompt: one line", true);
        await shot(page, "8-desktop");
        await ctx.close();
      }
    }
  } catch (e) {
    check("no exception", false, e.stack || String(e));
  } finally {
    await browser.close();
    await mock.close();
  }
  const fails = Object.entries(steps).filter(([, v]) => v.startsWith("FAIL"));
  const problems = [...mock.problems, ...a11y];
  console.log(JSON.stringify({ flags: flags.set, steps, problems }, null, 2));
  process.exit(fails.length || problems.length ? 1 : 0);
})();
