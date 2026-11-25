// When the connection or the server fails (docs/study/ux-p1.md, WP1), on an
// iPhone 15 and a 1280 px computer:
//   - startup with the API answering 503, then aborted: a member with a
//     session never sees the join screen; "אין חיבור כרגע" with "לנסות שוב"
//     shows, the button brings the home back once the API answers, and so
//     does the connection's return by itself (the window's "online");
//   - the library when its read fails: the error with role=alert and
//     "לנסות שוב", no "טוען…" beside it; the button loads the shelf;
//   - "יחד" when the meetings fail: no "לקבוע את הפגישה הבאה";
//   - a tab whose screen's code cannot be fetched (aborted, then offline):
//     #root is never empty, the tab bar stays, "המסך לא נטען" with "לנסות
//     שוב"; offline, the one-line notice at the top; back online the screen
//     comes;
//   - a11y.cjs on each new state (light and dark, 390 and 360 px).
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=s2 node e2e/study/resilience.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");
const { createMock, flagSetOf, SB } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/resilience.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(process.env.E2E_FLAGS || "s2");

const T = {
  offline: "אין חיבור כרגע. כדאי לבדוק את החיבור ולנסות שוב.",
  auto: "הקבוצה תיפתח מעצמה כשהחיבור יחזור.",
  line: "אין חיבור. מה שכבר נטען נשאר כאן.",
  screen: "המסך לא נטען. כדאי לבדוק את החיבור ולנסות שוב.",
  library: "הספרייה לא נטענה. כדאי לבדוק את החיבור ולנסות שוב.",
  retry: "לנסות שוב",
  nextMeeting: "לקבוע את הפגישה הבאה",
};
/** What a failure on purpose writes to the console: the failed module, React's report of the boundary's catch. */
const EXPECTED = /dynamically imported module|The above error occurred|study: a screen failed|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|Failed to fetch/;

const DEVICES = [
  { key: "iphone-15", opt: { device: devices["iPhone 15"] }, phone: true },
  { key: "desktop-1280", opt: { viewport: { width: 1280, height: 800 } }, phone: false },
];

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  mock.seedLecture();
  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  let n = 0;
  const check = (name, ok, detail) => {
    n += 1;
    steps[`${String(n).padStart(2, "0")} ${name}`] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const home = (page) => (flags.today ? page.locator("main.today .ph-head .t") : page.locator("main.library")).first();
  const rootFilled = (page) => page.evaluate(() => (document.getElementById("root")?.innerHTML.length ?? 0) > 0);
  const assets = fs.readdirSync(path.join(dist, "assets"));
  const chunk = (name) => assets.find((f) => new RegExp(`^${name}-[\\w-]+\\.js$`).test(f));

  try {
    for (const d of DEVICES) {
      const shot = async (page, name) => {
        if (d.phone) a11y.push(...(await snap(page, out, `resilience-${name}`)));
        else await page.screenshot({ path: path.join(out, `resilience-${name}-${d.key}.png`) });
      };

      // 1. Startup with the API answering 503: no join screen, the connection's gate.
      {
        const { page, ctx } = await mock.open(browser, "שוהם", d.opt);
        let joinSeen = false;
        await ctx.route(`${SB}/rest/**`, (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"unavailable"}' }));
        page.on("framenavigated", () => undefined);
        await page.goto(`${mock.base}/`);
        const gate = page.locator(".connection-gate");
        const t0 = Date.now();
        while (Date.now() - t0 < 30000 && !(await gate.isVisible().catch(() => false))) {
          if (await page.locator("main.join").count()) joinSeen = true;
          await page.waitForTimeout(200);
        }
        const text = await gate.innerText().catch(() => "");
        check(`${d.key}: API 503 at startup, a signed-in member gets the connection's gate, never Join`, !joinSeen && text.includes(T.offline) && text.includes(T.auto) && (await gate.getByRole("button", { name: T.retry }).isVisible()), JSON.stringify({ joinSeen, text }));
        if (d.phone) await shot(page, "1-startup-503");
        else await shot(page, "1-startup-503");
        // Still nothing for a while (the gate does not turn into Join later).
        await page.waitForTimeout(2500);
        check(`${d.key}: the gate stays, no Join`, (await page.locator("main.join").count()) === 0 && (await gate.isVisible()));
        await ctx.unroute(`${SB}/rest/**`);
        await gate.getByRole("button", { name: T.retry }).click();
        await home(page).waitFor({ timeout: 20000 });
        check(`${d.key}: "לנסות שוב" brings the home once the API answers`, true);

        // 1b. Aborted at startup, then the connection's return retries by itself.
        await ctx.route(`${SB}/rest/**`, (r) => r.abort("failed"));
        await page.reload();
        await gate.waitFor({ timeout: 30000 });
        check(`${d.key}: an aborted API at startup gives the gate too`, (await page.locator("main.join").count()) === 0);
        await ctx.setOffline(true);
        await ctx.unroute(`${SB}/rest/**`);
        await ctx.setOffline(false); // the window's "online"
        await home(page).waitFor({ timeout: 20000 });
        check(`${d.key}: the connection's return opens the home by itself`, true);
        await ctx.close();
      }

      // 2. A tab whose code cannot be fetched (aborted): never a blank app.
      {
        const { page, ctx } = await mock.open(browser, "שוהם", { ...d.opt, path: "/" });
        await home(page).waitFor({ timeout: 20000 });
        const me = chunk("Me");
        await ctx.route(`**/assets/${me}`, (r) => r.abort("failed"));
        await page.locator(".ph-tabs .ph-tab", { hasText: "שלי" }).click();
        const failed = page.locator(".screen-failed");
        await failed.waitFor({ timeout: 20000 });
        const filled = await rootFilled(page);
        const tabs = await page.locator(".ph-tabs").isVisible();
        const text = await failed.innerText();
        check(`${d.key}: a tab whose chunk is aborted: "המסך לא נטען" with "לנסות שוב", #root not empty, the tab bar stays`, filled && tabs && text.includes(T.screen) && text.includes(T.retry), JSON.stringify({ me, filled, tabs, text }));
        await shot(page, "2-chunk-aborted");
        // Another tab still works, and back to "שלי" once the chunk is reachable.
        await page.locator(".ph-tabs .ph-tab", { hasText: "ספרייה" }).click();
        await page.locator("main.library").waitFor({ timeout: 20000 });
        check(`${d.key}: another tab opens after the failure`, (await page.locator(".screen-failed").count()) === 0);
        await page.locator(".ph-tabs .ph-tab", { hasText: "שלי" }).click();
        await failed.waitFor({ timeout: 20000 });
        await ctx.unroute(`**/assets/${me}`);
        await failed.getByRole("button", { name: T.retry }).click();
        await page.locator("main.me-screen, main .signout").first().waitFor({ timeout: 20000 });
        check(`${d.key}: "לנסות שוב" loads the screen once its code is reachable`, true);

        // 3. Offline: the line at the top, and a screen not loaded yet waits for the connection.
        await page.locator(".ph-tabs .ph-tab", { hasText: flags.today ? "היום" : "ספרייה" }).click();
        await page.waitForTimeout(500);
        await ctx.setOffline(true);
        const line = page.locator(".offline-line");
        await line.waitFor({ timeout: 5000 });
        check(`${d.key}: offline, one line at the top says so`, (await line.innerText()).trim() === T.line);
        await page.locator(".ph-tabs .ph-tab", { hasText: "יחד" }).click();
        await failed.waitFor({ timeout: 20000 });
        await failed.getByRole("button", { name: T.retry }).click();
        await page.waitForTimeout(300);
        const still = await failed.innerText();
        check(`${d.key}: offline, "לנסות שוב" says the connection is still missing and the page stays`, (await rootFilled(page)) && still.includes("עדיין אין חיבור"), still);
        await shot(page, "3-offline-tab");
        await ctx.setOffline(false);
        await page.locator("main.group-screen").waitFor({ timeout: 30000 });
        check(`${d.key}: back online, the screen comes by itself and the line goes`, (await line.count()) === 0);
        await ctx.close();
      }

      if (!d.phone) continue;

      // 4. The library's read fails: the error, "לנסות שוב", no "טוען…".
      {
        const { page, ctx } = await mock.open(browser, "שוהם", { ...d.opt, path: "/?v=library" });
        await page.locator("main.library .lecture-card").first().waitFor({ timeout: 20000 });
        await ctx.route(`${SB}/rest/v1/study_lectures*`, (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"unavailable"}' }));
        await page.reload();
        const err = page.locator("main.library .lib-error");
        await err.waitFor({ timeout: 30000 });
        await page.waitForTimeout(500);
        const alert = await err.locator("[role=alert]").innerText();
        const loading = await page.locator("main.library .loading").count();
        check("the library's failed read: role=alert, \"לנסות שוב\", no \"טוען…\" beside it", alert.trim() === T.library && loading === 0 && (await err.getByRole("button", { name: T.retry }).isVisible()), JSON.stringify({ alert, loading }));
        await shot(page, "4-library-error");
        await ctx.unroute(`${SB}/rest/v1/study_lectures*`);
        await err.getByRole("button", { name: T.retry }).click();
        await page.locator("main.library .lecture-card").first().waitFor({ timeout: 20000 });
        check("\"לנסות שוב\" loads the shelf", (await err.count()) === 0);

        // 5. "יחד" when the meetings fail: no button to set the next one.
        if (flags.meeting) {
          await ctx.route(`${SB}/rest/v1/rpc/study_meeting*`, (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"unavailable"}' }));
          await ctx.route(`${SB}/rest/v1/study_meetings*`, (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"message":"unavailable"}' }));
          await page.goto(`${mock.base}/?v=group`);
          await page.locator("main.group-screen").waitFor({ timeout: 20000 });
          await page.getByText("הפגישה לא נטענה", { exact: false }).waitFor({ timeout: 30000 });
          check("\"יחד\": the meeting failed to load, so no \"לקבוע את הפגישה הבאה\"", (await page.getByText(T.nextMeeting).count()) === 0);
        }
        await ctx.close();
      }
    }

    const problems = mock.problems.filter((p) => !EXPECTED.test(p));
    const failed = Object.entries(steps).filter(([, v]) => v.startsWith("FAIL"));
    console.log(JSON.stringify({ errors: problems, expected: mock.problems.length - problems.length, steps, a11y }, null, 1));
    if (problems.length || a11y.length || failed.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, steps, a11y }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
