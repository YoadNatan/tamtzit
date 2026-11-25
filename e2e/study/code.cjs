// The personal code (docs/study/personal-code.md; SQL section I): a member
// who joins gets a code to keep; entering it in another browser (typed, or
// the #k= link) brings back the same member, never a new one; a new code
// stops the old one; the group's opener makes a member a new code, and the
// member sees who did. The mock's plugin (mocks/code.cjs) plays the server.
//
//   NODE_PATH=$(npm root -g) node e2e/study/code.cjs <dist> [set]
//   E2E_SHOTS=<dir>   also saves the four screens, light and dark (390×844)
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");

const [dist, flagArg] = process.argv.slice(2);
if (!dist) {
  console.error("usage: node e2e/study/code.cjs <dist> [set]");
  process.exit(2);
}
const flags = flagArg || process.env.E2E_FLAGS || "prod";
const SHOTS = process.env.E2E_SHOTS || "";
const CODE_RE = /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/;
const NOT_FOUND = "הקוד הזה לא נמצא. כדאי לבדוק אותו שוב, או לבקש קוד חדש ממי שפתחו את הקבוצה.";
const GROUP_HINT = "זה נראה כמו קוד הקבוצה. הקוד האישי ארוך יותר: 16 תווים.";
const steps = {};
let ok = true;
const check = (name, pass, detail) => {
  steps[name] = pass ? "ok" : `FAIL ${detail ?? ""}`;
  if (!pass) ok = false;
};

(async () => {
  const mock = await createMock({ dist, flags });
  mock.db.codes.on = true;
  const browser = await chromium.launch();
  const shot = async (page, name) => {
    if (!SHOTS) return;
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: "light" });
  };
  const userOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("study-auth") || "null")?.user?.id ?? null);
  const joins = () => mock.calls.filter((c) => /\/rpc\/study_join\b/.test(c)).length;
  const toEntry = async (page) => {
    await page.getByRole("button", { name: "כבר בקבוצה? כניסה עם הקוד האישי" }).click();
    const field = page.getByRole("textbox", { name: "הקוד האישי" });
    await field.waitFor({ timeout: 10000 });
    return field;
  };
  try {
    // 1. A visitor joins as דנה: the code's sheet, its WhatsApp link, then the app.
    const { page: a } = await mock.open(browser, null, { path: "/?join=ABC123" });
    await a.locator(".code-input").waitFor({ timeout: 15000 });
    await a.getByRole("textbox", { name: "השם שלך" }).fill("דנה");
    await a.getByRole("button", { name: "הצטרפות" }).click();
    const sheet = a.getByRole("dialog", { name: "הקוד האישי שלך" });
    await sheet.waitFor({ timeout: 15000 });
    const code = (await sheet.locator(".pc-code").innerText()).trim();
    check("join: the sheet shows a code", CODE_RE.test(code), code);
    const wa = (await sheet.getByRole("link", { name: "שליחה לעצמי בוואטסאפ" }).getAttribute("href")) ?? "";
    const waText = decodeURIComponent(wa.replace("https://wa.me/?text=", ""));
    check("join: WhatsApp's link with #k=", wa.startsWith("https://wa.me/?text=") && waText.includes(`/#k=${code.replace(/-/g, "")}`) && waText.includes(code), wa);
    check("join: the warning", (await sheet.getByText("לא מעבירים אותו לאף אחד: מי שמחזיקים בו נכנסים בשמך.").count()) === 1);
    await shot(a, "1-code-after-joining");
    await sheet.getByRole("button", { name: "שמרתי, ממשיכים" }).click();
    await a.locator(".ph-tabs").waitFor({ timeout: 15000 });
    check("join: the sheet closes onto the app", (await a.getByRole("dialog").count()) === 0);
    const dana = await userOf(a);
    check("join: דנה is a member", mock.db.members.some((m) => m.user_id === dana && m.name === "דנה"), dana);
    const membersBefore = mock.db.members.length;
    const joinsBefore = joins();

    // 2. Another browser: the entry, the code in lower case with spaces, the same member.
    const { page: b } = await mock.open(browser, null, { path: "/" });
    const field = await toEntry(b);
    await field.fill(code.toLowerCase().replace(/-/g, " "));
    await shot(b, "2-restore-entry");
    await b.getByRole("button", { name: "כניסה", exact: true }).click();
    await b.locator(".ph-tabs").waitFor({ timeout: 15000 });
    check("entry: the same user", (await userOf(b)) === dana, `${await userOf(b)} vs ${dana}`);
    const toast = await b.locator(".a-toast").innerText().catch(() => "");
    check("entry: back as דנה", toast.includes("חזרה לקבוצה בתור דנה."), toast);
    await b.goto(`${mock.base}/?v=me`);
    const mine = b.locator(".member-name", { hasText: "(החשבון שלך)" });
    await mine.waitFor({ timeout: 15000 });
    check("entry: שלי says דנה (החשבון שלך)", (await mine.innerText()).includes("דנה"), await mine.innerText());
    check("entry: no new member, no join", mock.db.members.length === membersBefore && joins() === joinsBefore, `${mock.db.members.length} ${joins()}`);

    // 3. The #k= link in a third browser: in as דנה, and the code leaves the address.
    const { page: c } = await mock.open(browser, null, { path: `/#k=${code.replace(/-/g, "")}` });
    await c.locator(".ph-tabs").waitFor({ timeout: 15000 });
    check("link: the same user", (await userOf(c)) === dana);
    check("link: #k= is gone from the address", !c.url().includes("#k="), c.url());

    // 4. A wrong code, and the group's code typed by mistake.
    const { page: d } = await mock.open(browser, null, { path: "/" });
    const f4 = await toEntry(d);
    await f4.fill("ZZZZ-ZZZZ-ZZZZ-ZZZZ");
    await d.getByRole("button", { name: "כניסה", exact: true }).click();
    await d.locator(".a-error").waitFor({ timeout: 10000 });
    check("wrong code: its line", (await d.locator(".a-error").innerText()).trim() === NOT_FOUND, await d.locator(".a-error").innerText());
    await f4.fill("ABC123");
    check("group code: the hint", (await d.getByText(GROUP_HINT).count()) >= 1);
    await d.getByRole("button", { name: "כניסה", exact: true }).click();
    check("group code: refused before any call", (await d.locator(".a-error").innerText()).trim() === GROUP_HINT);
    check("back to joining", await d.getByRole("button", { name: "חזרה להצטרפות לקבוצה" }).isVisible());

    // 5. שלי → "קוד חדש": the old code stops working.
    await a.goto(`${mock.base}/?v=me`);
    const card = a.locator(".pc-card");
    await card.waitFor({ timeout: 15000 });
    check("שלי: the card says when, and hides the code", (await card.innerText()).includes("יש קוד אישי מ-") && (await card.locator(".pc-mask").innerText()).endsWith(code.slice(-4)));
    await card.getByRole("button", { name: "קוד חדש" }).click();
    await card.getByRole("button", { name: "יצירה" }).click();
    await card.locator(".pc-code").waitFor({ timeout: 10000 });
    const code2 = (await card.locator(".pc-code").innerText()).trim();
    check("שלי: a new code is shown", CODE_RE.test(code2) && code2 !== code, code2);
    await card.scrollIntoViewIfNeeded();
    await shot(a, "3-code-under-me");
    const { page: e } = await mock.open(browser, null, { path: `/#k=${code.replace(/-/g, "")}` });
    await e.locator(".a-error").waitFor({ timeout: 15000 });
    check("the old code: not found", (await e.locator(".a-error").innerText()).trim() === NOT_FOUND, await e.locator(".a-error").innerText());
    check("the old code: no session", (await userOf(e)) === null);

    // 6. The opener (שוהם) makes דנה a new code; it brings back דנה; דנה sees who made it.
    const { page: s } = await mock.open(browser, "שוהם", { path: "/?v=me" });
    const row = s.locator("li.member", { hasText: "דנה" });
    await row.waitFor({ timeout: 15000 });
    check("opener: דנה has the chip", (await row.locator(".a-chip", { hasText: "יש קוד" }).count()) === 1);
    await row.getByRole("button", { name: "קוד אישי חדש" }).click();
    await row.getByRole("button", { name: "יצירה" }).click();
    const issued = s.getByRole("dialog", { name: "הקוד האישי של דנה" });
    await issued.waitFor({ timeout: 10000 });
    const code3 = (await issued.locator(".pc-code").innerText()).trim();
    check("opener: the sheet with דנה's code", CODE_RE.test(code3) && (await issued.getByText("להעביר רק לדנה, בהודעה פרטית. הקוד מוצג רק עכשיו.").count()) === 1, code3);
    const wa3 = decodeURIComponent(((await issued.getByRole("link", { name: "שליחה בוואטסאפ" }).getAttribute("href")) ?? "").replace("https://wa.me/?text=", ""));
    check("opener: WhatsApp's text names דנה", wa3.startsWith("דנה, זה הקוד האישי החדש שלך בתמצית: ") && wa3.includes(`#k=${code3.replace(/-/g, "")}`), wa3);
    await shot(s, "4-opener-new-code");
    await issued.getByRole("button", { name: "סגירה", exact: true }).last().click();
    const { page: g } = await mock.open(browser, null, { path: `/#k=${code3.replace(/-/g, "")}` });
    await g.locator(".ph-tabs").waitFor({ timeout: 15000 });
    check("opener's code: in as דנה", (await userOf(g)) === dana);
    await a.goto(`${mock.base}/?v=me`);
    const notice = a.locator(".pc-notice");
    await notice.waitFor({ timeout: 15000 });
    check("דנה: the notice names שוהם", (await notice.innerText()).includes("מי שפתחו את הקבוצה (שוהם) יצרו לך קוד אישי חדש"), await notice.innerText());
    await notice.getByRole("button", { name: "הבנתי" }).click();
    await notice.waitFor({ state: "detached", timeout: 10000 });
    check("דנה: הבנתי clears it", (await a.locator(".pc-notice").count()) === 0);

    // 7. Nothing the schema refuses, no error on any page; no member token on a redeem.
    check("redeem: never with a member token", !mock.db.codes.redeems.some((r) => r.withToken));
    check("no problems", mock.problems.length === 0, mock.problems.join(" | "));
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
