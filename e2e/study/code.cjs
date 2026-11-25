// The personal code (docs/study/personal-code.md; SQL section I): a member
// who joins gets a code to keep; entering it in another browser (typed, or
// the #k= link) brings back the same member, never a new one, on a fresh
// page; a new code stops the old one; the group's opener makes a member a new
// code, and the member sees who did and that it was used; a member's own
// link on their own device asks nothing; another member's link asks first,
// and says when the member signed in here has no code to come back with; a
// personal code pasted into the group's code field opens the code's panel;
// "name taken" points to the code. The mock's plugin (mocks/code.cjs) plays
// the server.
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
const ALREADY_IN = "הכניסה כבר פעילה במכשיר הזה.";
const NO_CODE = "לכניסה בשם נועה אין קוד אישי, ואי אפשר יהיה לחזור אליה.";
const NAME_TAKEN = "השם הזה כבר בשימוש בקבוצה. זה השם שלך? נכנסים עם הקוד האישי. אחרת אפשר להוסיף אות או שם משפחה.";
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
    // The device keeps the code it came in with: "שלי" can show it again (review product 6).
    const cardB = b.locator(".pc-card");
    await cardB.waitFor({ timeout: 15000 });
    check("entry: שלי can show the code here", (await cardB.getByRole("button", { name: "הצגה" }).count()) === 1 && (await cardB.innerText()).includes("כניסה אחרונה עם הקוד:"), await cardB.innerText());

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
    // The personal code pasted into the group's code field: the code's panel, with it.
    await d.getByRole("button", { name: "חזרה להצטרפות לקבוצה" }).click();
    await d.locator(".code-input").fill(code.toLowerCase());
    const f4b = d.getByRole("textbox", { name: "הקוד האישי" });
    await f4b.waitFor({ timeout: 10000 });
    check("group field: a personal code opens its panel", (await f4b.inputValue()) === code, await f4b.inputValue());
    await d.getByRole("button", { name: "חזרה להצטרפות לקבוצה" }).click();
    // "name taken": the returning member is pointed at the code.
    await d.getByRole("tab", { name: "יש לי קוד קבוצה" }).click();
    await d.getByRole("textbox", { name: "השם שלך" }).fill("דנה");
    await d.locator(".code-input").fill("ABC123");
    await d.getByRole("button", { name: "הצטרפות" }).click();
    await d.locator(".a-error").waitFor({ timeout: 10000 });
    check("name taken: points to the code", (await d.locator(".a-error").innerText()).trim() === NAME_TAKEN, await d.locator(".a-error").innerText());
    check("name taken: the way in under it", (await d.getByRole("button", { name: "כניסה עם הקוד האישי", exact: true }).count()) === 1);
    // A body that is not JSON: 415, nothing counted.
    const plain = await d.evaluate(async () => (await fetch("/api/study/code", { method: "POST", headers: { "content-type": "text/plain" }, body: '{"code":"x"}' })).status);
    check("redeem: JSON only (415)", plain === 415, String(plain));

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
    const noticeText = await notice.innerText();
    check("דנה: the notice names שוהם", noticeText.includes("מי שפתחו את הקבוצה (שוהם) יצרו לך קוד אישי חדש"), noticeText);
    check("דנה: the notice says the code before stopped and the new one was used", noticeText.includes("הקוד הקודם כבר לא עובד.") && noticeText.includes("הקוד החדש כבר שימש לכניסה ב-"), noticeText);
    await notice.getByRole("button", { name: "הבנתי" }).click();
    await notice.waitFor({ state: "detached", timeout: 10000 });
    check("דנה: הבנתי clears it", (await a.locator(".pc-notice").count()) === 0);

    // 7. Own link, own device: nothing to ask. (a holds code2 from step 5; make it current again.)
    await a.goto(`${mock.base}/?v=me`);
    const cardA = a.locator(".pc-card");
    await cardA.waitFor({ timeout: 15000 });
    await cardA.getByRole("button", { name: "קוד חדש" }).click();
    await cardA.getByRole("button", { name: "יצירה" }).click();
    await cardA.locator(".pc-code").waitFor({ timeout: 10000 });
    const code4 = (await cardA.locator(".pc-code").innerText()).trim();
    const redeemsBefore = mock.db.codes.redeems.length;
    await a.goto(`${mock.base}/?v=library#k=${code4.replace(/-/g, "")}`);
    await a.locator(".a-toast", { hasText: ALREADY_IN }).waitFor({ timeout: 15000 });
    check("own link: one line, no question", (await a.getByRole("dialog").count()) === 0);
    check("own link: no redeem", mock.db.codes.redeems.length === redeemsBefore);

    // 8. נועה (no code) on her phone, the home first: the prompt is on Today.
    const { page: n } = await mock.open(browser, "נועה", { path: "/" });
    await n.locator(".pc-prompt").waitFor({ timeout: 15000 });
    check("home: the prompt for a member without a code", (await n.locator(".pc-prompt").innerText()).includes("חדש: קוד אישי."));
    // דנה's link on נועה's phone: asked first, with what is lost.
    await n.goto(`${mock.base}/?v=library#k=${code4.replace(/-/g, "")}`); // a new page load, as a tapped link is
    const ask = n.getByRole("dialog", { name: "כניסה עם הקוד האישי" });
    await ask.waitFor({ timeout: 15000 });
    await ask.locator(".pc-nocode").waitFor({ timeout: 10000 });
    check("other link: asks first, and says נועה has no code", (await ask.locator(".pc-nocode").innerText()).trim() === NO_CODE, await ask.innerText());
    check("other link: offers a code first", (await ask.getByRole("button", { name: "יצירת קוד קודם" }).count()) === 1);
    await shot(n, "5-link-other-member");
    await n.evaluate(() => (window.__pageBefore = true));
    await ask.getByRole("button", { name: "כניסה עם הקוד" }).click();
    await n.locator(".a-toast", { hasText: "חזרה לקבוצה בתור דנה." }).waitFor({ timeout: 15000 });
    check("other link: in as דנה", (await userOf(n)) === dana);
    // A fresh page: nothing of נועה's (the cards' outbox, its timer) keeps running with דנה's session.
    check("other link: on a fresh page", (await n.evaluate(() => window.__pageBefore)) !== true);
    await n.waitForTimeout(1500);
    check("other link: the question does not come back", (await n.getByRole("dialog").count()) === 0);

    // 9. Nothing the schema refuses, no error on any page; no member token on a redeem.
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
