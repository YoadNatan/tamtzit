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
