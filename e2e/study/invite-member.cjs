// A member who opens the invite link again (a home-screen icon saved on the
// invite, or the link tapped twice) goes straight into the app: no join
// screen, and the code leaves the address. A visitor still gets the join
// screen with the code filled in. The manifest and the home-screen icon are served.
//
//   NODE_PATH=$(npm root -g) node e2e/study/invite-member.cjs <dist> [set]
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");

const [dist, flagArg] = process.argv.slice(2);
if (!dist) {
  console.error("usage: node e2e/study/invite-member.cjs <dist> [set]");
  process.exit(2);
}
const flags = flagArg || process.env.E2E_FLAGS || "prod";
const steps = {};
let ok = true;
const check = (name, pass, detail) => {
  steps[name] = pass ? "ok" : `FAIL ${detail ?? ""}`;
  if (!pass) ok = false;
};

(async () => {
  const mock = await createMock({ dist, flags });
  const browser = await chromium.launch();
  try {
    const { page } = await mock.open(browser, "שוהם", { path: "/?join=ABC123" });
    await page.locator(".ph-tabs").waitFor({ timeout: 15000 });
    check("member: straight into the app", (await page.locator(".code-input").count()) === 0);
    check("member: the code leaves the address", !new URL(page.url()).searchParams.has("join"), page.url());

    const { page: guest } = await mock.open(browser, null, { path: "/?join=ABC123" });
    await guest.locator(".code-input").waitFor({ timeout: 15000 });
    check("visitor: the join screen with the code", (await guest.locator(".code-input").inputValue()) === "ABC123");

    const res = await guest.request.get(`${mock.base}/manifest.webmanifest`);
    const man = res.ok() ? await res.json() : null;
    check("manifest: opens at /", man?.start_url === "/" && man?.display === "standalone", JSON.stringify(man));
    const icon = await guest.request.get(`${mock.base}/apple-touch-icon.png`);
    check("home-screen icon is served", icon.ok() && (await icon.body()).length > 500);
    check("index links both", (await guest.locator('link[rel="manifest"]').count()) === 1 && (await guest.locator('link[rel="apple-touch-icon"]').count()) === 1);
    // The installed app (docs/study/install.md): its identity, the paper colour, Android's shortcuts and pictures.
    check("manifest: the app's id is / (as start_url made it before)", man?.id === "/", man?.id);
    check("manifest: the title bar is the page's paper", man?.theme_color === "#f6f4fd" && man?.background_color === "#f6f4fd", man?.theme_color);
    check("manifest: every shortcut is in scope", Array.isArray(man?.shortcuts) && man.shortcuts.length > 0 && man.shortcuts.every((x) => x.url.startsWith("/")), JSON.stringify(man?.shortcuts));
    const maskable = man?.icons?.find((i) => i.purpose === "maskable");
    const maskRes = maskable ? await guest.request.get(`${mock.base}${maskable.src}`) : null;
    check("manifest: a padded maskable icon of its own", Boolean(maskable && maskable.src !== "/icon-512.png" && maskRes?.ok()), maskable?.src);
    const shots = man?.screenshots ?? [];
    const forms = new Set(shots.map((x) => x.form_factor));
    let shotsOk = forms.has("narrow") && forms.has("wide");
    for (const x of shots) {
      const r = await guest.request.get(`${mock.base}${x.src}`);
      const body = r.ok() ? await r.body() : Buffer.alloc(0);
      // A PNG's size is in its IHDR: width at byte 16, height at 20.
      const size = body.length > 24 ? `${body.readUInt32BE(16)}x${body.readUInt32BE(20)}` : "";
      if (size !== x.sizes || !x.label) shotsOk = false;
    }
    check("manifest: narrow and wide screenshots, served at their sizes, labelled", shotsOk, JSON.stringify(shots));
    const meta = (name) => guest.locator(`meta[name="${name}"]`).evaluateAll((els) => els.map((e) => e.getAttribute("content")));
    check("index: the theme colours are the paper's", JSON.stringify(await meta("theme-color")) === JSON.stringify(["#f6f4fd", "#121022"]));
    check("index: iOS's status bar style", JSON.stringify(await meta("apple-mobile-web-app-status-bar-style")) === JSON.stringify(["default"]));
  } catch (e) {
    ok = false;
    steps.error = String(e);
  } finally {
    await browser.close();
    await mock.close?.();
  }
  console.log(JSON.stringify(steps, null, 2));
  process.exit(ok ? 0 : 1);
})();
