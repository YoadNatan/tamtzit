// Notifications, slice 1 (section R; VITE_STUDY_NOTIFY): the bell and the
// inbox, on a mocked Supabase in Chromium. The design's e2e cases 5-7 and
// 14-16 (its §13.3; pushes, the settings and the asks come with slice 2):
//   5. a notice comes by Realtime: the bell shows it within 2 s ("התראות,
//      אחת חדשה"); opening the inbox sees everything (study_notices_seen with
//      no ids) and the bell goes to 0 while the dots stay; a reply twice is
//      one row, "2 תשובות חדשות"; a quiz that ended reads "הסתיים · לתוצאות";
//      a notice that comes while the inbox is open joins its top, seen; a
//      tap goes where the notice points;
//   6. seen by the screen: opening the lecture of an unseen "הסיכום מוכן"
//      sees it (study_notices_seen_obj 'lec:<id>'), and one that comes while
//      the lecture is open is seen at once;
//   7. a push's link (?nt=<id>) sees its notice and leaves the address,
//      keeping the rest of it (n=10 too);
//  14. a build without the flag: no bell, ?v=notify is the home with no
//      notice, no service worker;
//  15. the inbox's a11y check (light and dark, 390 and 360 px) and 320 px;
//  16. (npm run test:bundle: R's share of the entry chunk, and no R module
//      but its slot there.)
//
//   NODE_PATH=$(npm root -g) node e2e/study/notify.cjs <dist> <out dir>
//
// The build decides what runs (a probe of ?v=notify). E2E_FLAGS is the
// mock's flag set (default "notify"; "s2" and "i" work the same, since
// section R is in this branch's SQL). Screenshots: <out>/notify-*-<scheme>.png.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/notify.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(process.env.E2E_FLAGS || "notify");
const MIN = 60_000;

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const N = mock.db.notifyMock;
  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  let n = 0;
  const check = (name, ok, detail) => {
    n += 1;
    steps[`${String(n).padStart(2, "0")} ${name}`] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const id = (name) => mock.people[name].user.id;
  /** A notice as the server's hooks write it, then Realtime's INSERT (or UPDATE, coalesced). */
  const notice = (who, o) => {
    const before = N.notices.length;
    const row = N.add({ user_id: id(who), ...o });
    mock.notify("study_notices", N.notices.length > before ? "INSERT" : "UPDATE", row);
    return row;
  };
  const calls = (fn, who) => N.calls.filter((c) => c.fn === fn && (!who || c.who === id(who)));
  const homeReady = (page) => page.locator(".today .t-sec, main.library").first().waitFor({ timeout: 15000 });
  const bell = (page) => page.locator(".ph-head a.bell");
  const bellIs = (page, label, timeout = 2500) =>
    page
      .waitForFunction((l) => document.querySelector(".ph-head a.bell")?.getAttribute("aria-label") === l, label, { timeout })
      .then(() => true)
      .catch(() => false);
  const until = (fn, timeout = 3000) =>
    new Promise((ok) => {
      const t0 = Date.now();
      const tick = () => (fn() ? ok(true) : Date.now() - t0 > timeout ? ok(false) : setTimeout(tick, 50));
      tick();
    });
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const QUIZ = "abcdef01-0000-4000-8000-000000000001";
  const LECTURE_TITLE = mock.db.lectures[0].title;

  try {
    const probe = await mock.open(browser, "שוהם", { path: "/?v=notify" });
    await probe.page.locator("main.notify-inbox, .today .t-sec, main.library").first().waitFor({ timeout: 15000 });
    const on = (await probe.page.locator("main.notify-inbox").count()) > 0;
    await probe.ctx.close();
    steps["00 the build"] = on ? "VITE_STUDY_NOTIFY on" : "VITE_STUDY_NOTIFY off";
    N.calls.length = 0;

    if (!on) {
      /* ── 14. The flag off ── */
      const { page } = await mock.open(browser, "נועה", { path: "/" });
      await homeReady(page);
      await page.waitForTimeout(800);
      check("off: no bell", (await bell(page).count()) === 0);
      await page.goto(mock.base + "/?v=notify");
      await homeReady(page);
      await page.waitForTimeout(500);
      check("off: ?v=notify is the home", (await page.locator("main.notify-inbox").count()) === 0);
      check("off: no notice", (await page.locator(".a-toast").count()) === 0 || !(await page.locator(".a-toast").innerText()).includes("עוד לא פתוחה"));
      const regs = await page.evaluate(async () => (navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0));
      check("off: no service worker", regs === 0, String(regs));
      check("off: no section R call", N.calls.length === 0, JSON.stringify(N.calls.map((c) => c.fn)));
    } else {
      /* ── 5. The bell and the inbox ── */
      {
        // An older, seen notice (for "קודם") and one whose quiz ended (live, over: not counted).
        notice("שוהם", { kind: "summary_ready", args: { lecture: LECTURE_TITLE }, route: { v: "lecture", l: L }, obj: null, dedupe: "old", at: Date.now() - 3 * 86_400_000, seen_at: ago(2 * 86_400_000) });
        notice("שוהם", { kind: "quiz_open", args: { lecture: LECTURE_TITLE, title: "סבב בדוי", name: "נועה", k: 1 }, route: { v: "quiz", q: QUIZ }, obj: `quiz:${QUIZ}`, dedupe: `quiz:${QUIZ}`, at: Date.now() - 40 * MIN, ends_at: ago(10 * MIN) });
        const { page } = await mock.open(browser, "שוהם", { path: "/" });
        await homeReady(page);
        await bell(page).waitFor({ timeout: 10000 });
        check("the bell on the home, before the guide's ?", await page.evaluate(() => {
          const b = document.querySelector(".ph-head a.bell");
          const g = document.querySelector(".ph-head .guide-btn");
          return Boolean(b) && (!g || Boolean(b.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING));
        }));
        check("an ended quiz is not counted: the bell says התראות", await bellIs(page, "התראות"));
        check("no count shown at 0", (await page.locator(".bell-n").count()) === 0);
        const t0 = Date.now();
        notice("שוהם", { kind: "reply", args: { lecture: LECTURE_TITLE, part: 3 }, route: { v: "lecture", l: L, at: { part: 2, anchor: 0 } }, dedupe: "reply:root-1" });
        const shown = await bellIs(page, "התראות, אחת חדשה", 2000);
        check("a notice by Realtime: the bell within 2 s, 'התראות, אחת חדשה'", shown, `${Date.now() - t0} ms`);
        check("its count: 1", (await page.locator(".bell-n").innerText().catch(() => "")) === "1");
        notice("שוהם", { kind: "reply", args: { lecture: LECTURE_TITLE, part: 3 }, route: { v: "lecture", l: L, at: { part: 2, anchor: 0 } }, dedupe: "reply:root-1" });
        await page.waitForTimeout(700);
        check("a second reply in the thread is the same notice (coalesced)", await bellIs(page, "התראות, אחת חדשה"));
        for (let i = 0; i < 10; i++) N.add({ user_id: id("שוהם"), kind: "answer", args: { lecture: LECTURE_TITLE, part: 1 }, route: { v: "lecture", l: L }, dedupe: `ans-${i}` });
        notice("שוהם", { kind: "answer", args: { lecture: LECTURE_TITLE, part: 1 }, route: { v: "lecture", l: L }, dedupe: "ans-last" });
        check("12 new: the count is 9+", (await bellIs(page, "התראות, 12 חדשות")) && (await page.locator(".bell-n").innerText()) === "9+");
        await shot(page, "1-bell");

        await bell(page).click();
        await page.locator("main.notify-inbox .inbox-row").first().waitFor({ timeout: 10000 });
        check("the bell opens ?v=notify", new URL(page.url()).search === "?v=notify", page.url());
        check("opening the inbox sees everything (study_notices_seen, no ids)", await until(() => calls("study_notices_seen", "שוהם").some((c) => c.body.p_ids === null)));
        check("every notice is seen on the server", await until(() => N.notices.filter((x) => x.user_id === id("שוהם")).every((x) => x.seen_at)));
        const rows = await page.locator(".inbox-row").allInnerTexts();
        check("the inbox: 50 a page, last changed first", rows.length === 14, String(rows.length));
        check("the newest first", rows[0].includes("יש תשובה לשאלה שלך"), rows[0]);
        check("the dots stay for this visit (13 unread)", (await page.locator(".inbox-row.unseen").count()) === 13);
        check("unread rows say חדש to a screen reader", (await page.locator(".inbox-row.unseen .sr-only").first().innerText()).includes("חדש"));
        check("the coalesced reply: '2 תשובות חדשות בשרשור שלך'", rows.some((r) => r.includes("2 תשובות חדשות בשרשור שלך")), rows.join(" | "));
        const ended = page.locator(".inbox-row", { hasText: "לתוצאות" });
        check("the ended quiz: 'מבחן קבוצתי נפתח', 'הסתיים · לתוצאות'", (await ended.count()) === 1 && (await ended.innerText()).includes("מבחן קבוצתי נפתח") && !(await ended.innerText()).includes("עכשיו"));
        check("…linked to the quiz (its results)", (await ended.getAttribute("href")) === `/?v=quiz&q=${QUIZ}`);
        check("today and earlier", (await page.locator(".inbox-day h2").allInnerTexts()).join(",") === "היום,קודם");
        check("times are left to right", (await page.locator(".inbox-row bdi[dir=ltr].inbox-time").count()) === rows.length);
        // One more while the inbox is open: it joins the top, seen, with its dot.
        const late = notice("שוהם", { kind: "summary_ready", args: { lecture: LECTURE_TITLE }, route: { v: "lecture", l: L }, obj: `lec:${L}`, dedupe: `lec:${L}:ready` });
        const joined = await page
          .waitForFunction(() => document.querySelector(".inbox-row")?.textContent.includes("הסיכום מוכן"), null, { timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        check("a notice while the inbox is open joins its top, with a dot", joined && (await page.locator(".inbox-row").first().getAttribute("class")).includes("unseen"));
        check("…and is seen", await until(() => Boolean(late.seen_at)));
        await shot(page, "2-inbox");
        // 320 px: nothing wider than the screen.
        await page.setViewportSize({ width: 320, height: 640 });
        await page.waitForTimeout(200);
        const wide = await page.evaluate(() => document.scrollingElement.scrollWidth);
        check("320 px: no sideways scroll", wide <= 320, String(wide));
        await page.setViewportSize({ width: 390, height: 844 });
        // A tap goes where the notice points.
        await page.locator(".inbox-row", { hasText: "2 תשובות חדשות" }).click();
        await page.waitForURL((u) => u.searchParams.get("l") === L, { timeout: 10000 });
        check("a tap opens its screen (the lecture, its paragraph)", new URL(page.url()).searchParams.get("at") === "2.0", page.url());
        await page.goBack();
        await page.locator("main.notify-inbox").waitFor({ timeout: 10000 });
        await page.goBack();
        await homeReady(page);
        check("back home, the bell is at 0", await bellIs(page, "התראות", 4000));
        await page.close();
      }

      /* ── 6. Seen by the screen ── */
      {
        N.calls.length = 0;
        notice("נועה", { kind: "summary_ready", args: { lecture: LECTURE_TITLE }, route: { v: "lecture", l: L }, obj: `lec:${L}`, dedupe: `lec:${L}:ready`, lecture_id: L });
        const { page } = await mock.open(browser, "נועה", { path: "/" });
        await homeReady(page);
        check("an unseen summary: the bell says 1", await bellIs(page, "התראות, אחת חדשה", 8000));
        check("the home sees nothing by itself", calls("study_notices_seen_obj").length === 0 && calls("study_notices_seen").length === 0);
        await page.goto(mock.base + `/?l=${L}`);
        check("opening the lecture sees it (study_notices_seen_obj 'lec:<id>')", await until(() => calls("study_notices_seen_obj", "נועה").some((c) => c.body.p_obj === `lec:${L}`), 8000));
        check("…on the server", N.notices.filter((x) => x.user_id === id("נועה")).every((x) => x.seen_at));
        // With the lecture open, another one about it: seen at once.
        const again = notice("נועה", { kind: "summary_failed", args: { lecture: LECTURE_TITLE, why: "x" }, route: { v: "lecture", l: L }, obj: `lec:${L}`, dedupe: `lec:${L}:failed`, lecture_id: L });
        check("one that comes while the lecture is open is seen at once", await until(() => Boolean(again.seen_at), 4000));
        const other = notice("נועה", { kind: "reply", args: { lecture: LECTURE_TITLE, part: 1 }, route: { v: "lecture", l: L }, dedupe: "reply:root-2" });
        await page.waitForTimeout(1200);
        check("a notice about no object stays unseen", !other.seen_at);
        await page.goto(mock.base + "/");
        await homeReady(page);
        check("the home's bell: just that one", await bellIs(page, "התראות, אחת חדשה", 8000));
        await page.close();
      }

      /* ── 7. A push's link: ?nt=<id> ── */
      {
        N.calls.length = 0;
        const a = notice("נועה", { kind: "reply", args: { lecture: LECTURE_TITLE, part: 2 }, route: { v: "lecture", l: L }, dedupe: "reply:root-3" });
        const { page } = await mock.open(browser, "נועה", { path: `/?l=${L}&nt=${a.id}` });
        check("?nt on a lecture: that notice is seen (study_notices_seen with its id)", await until(() => calls("study_notices_seen", "נועה").some((c) => JSON.stringify(c.body.p_ids) === JSON.stringify([a.id])), 10000));
        await page.waitForFunction(() => !new URL(location.href).searchParams.has("nt"), null, { timeout: 5000 }).catch(() => undefined);
        const u1 = new URL(page.url());
        check("…the address loses nt and keeps the lecture", !u1.searchParams.has("nt") && u1.searchParams.get("l") === L, page.url());
        const b = notice("נועה", { kind: "code_used", group_id: null, args: { at: new Date().toISOString() }, route: { v: "me" }, dedupe: "code:1" });
        await page.goto(mock.base + `/?nt=${b.id}`);
        await homeReady(page);
        check("?nt alone: the home, and the notice seen", await until(() => Boolean(b.seen_at), 8000));
        check("…the address is /", new URL(page.url()).pathname === "/" && new URL(page.url()).search === "", page.url());
        const c = notice("נועה", { kind: "answer", args: { lecture: LECTURE_TITLE, part: 2 }, route: { v: "practice", l: L, n: "10" }, dedupe: "ans-x" });
        await page.goto(mock.base + `/?v=practice&l=${L}&n=10&nt=${c.id}`);
        check("?nt on practice: seen", await until(() => Boolean(c.seen_at), 10000));
        await page.waitForFunction(() => !new URL(location.href).searchParams.has("nt"), null, { timeout: 5000 }).catch(() => undefined);
        const u3 = new URL(page.url());
        check("…n=10 stays", !u3.searchParams.has("nt") && u3.searchParams.get("n") === "10" && u3.searchParams.get("l") === L, page.url());
        await page.goto(mock.base + "/?nt=abc");
        await homeReady(page);
        await page.waitForTimeout(500);
        check("a malformed nt is dropped, nothing marked", new URL(page.url()).search === "" && !calls("study_notices_seen", "נועה").some((x) => x.body.p_ids && x.body.p_ids.some((i) => typeof i !== "number")));
        await page.close();
      }

      /* ── The rest of the inbox: empty, a failed read, the settings' address ── */
      {
        const p = mock.member("איתי");
        const { page } = await mock.open(browser, p.name, { path: "/?v=notify&x=set" });
        await page.locator("main.notify-inbox").waitFor({ timeout: 15000 });
        await page.getByText("אין התראות חדשות. כשמשהו יקרה בקבוצה, הוא יופיע כאן.").waitFor({ timeout: 8000 });
        check("an empty inbox says so", true);
        check("x=set opens the inbox while pushes are not offered (e2e/study/notify-push.cjs has the rest)", new URL(page.url()).search === "?v=notify", page.url());
        check("no settings gear while pushes are not offered", (await page.getByRole("link", { name: "הגדרות התראות" }).count()) === 0);
        await shot(page, "3-empty");
        // A failed read: the line and "לנסות שוב".
        await page.route("**/rest/v1/rpc/study_notices_mine", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }));
        await page.reload();
        await page.getByText("לא הצלחנו לטעון את ההתראות.").waitFor({ timeout: 10000 });
        check("a failed read says so, with לנסות שוב", await page.getByRole("button", { name: "לנסות שוב" }).isVisible());
        await page.unroute("**/rest/v1/rpc/study_notices_mine");
        await page.getByRole("button", { name: "לנסות שוב" }).click();
        await page.getByText("אין התראות חדשות.", { exact: false }).waitFor({ timeout: 8000 });
        check("לנסות שוב reads it again", (await page.getByText("לא הצלחנו לטעון את ההתראות.").count()) === 0);
        // Paging: 55 notices, 50 then "עוד".
        for (let i = 0; i < 55; i++) N.add({ user_id: id(p.name), kind: "reply", args: { lecture: LECTURE_TITLE, part: 1 }, route: { v: "lecture", l: L }, dedupe: `page-${i}`, at: Date.now() - i * MIN });
        await page.reload();
        await page.locator(".inbox-row").first().waitFor({ timeout: 10000 });
        check("a page is 50 rows", (await page.locator(".inbox-row").count()) === 50);
        await page.getByRole("button", { name: "עוד" }).click();
        await page.waitForFunction(() => document.querySelectorAll(".inbox-row").length === 55, null, { timeout: 8000 }).catch(() => undefined);
        check("עוד: the rest", (await page.locator(".inbox-row").count()) === 55);
        check("…and no more עוד", (await page.getByRole("button", { name: "עוד" }).count()) === 0);
        await page.close();
      }

      /* ── A deep screen has no bell; a tab screen does ── */
      {
        const { page } = await mock.open(browser, "שוהם", { path: `/?l=${L}` });
        await page.locator(".ph-head").first().waitFor({ timeout: 15000 });
        await page.waitForTimeout(1000);
        check("the lecture (no tab bar): no bell", (await bell(page).count()) === 0);
        for (const [tabName, ready] of [["ספרייה", "main.library"], ["יחד", "main.group-screen"], ["שלי", "main.me-screen"]]) {
          await page.goto(mock.base + "/");
          await homeReady(page);
          await page.locator(".ph-tabs").getByRole("link", { name: tabName }).click();
          await page.locator(ready).waitFor({ timeout: 10000 });
          await bell(page).waitFor({ timeout: 5000 }).catch(() => undefined);
          check(`${tabName}: the bell`, (await bell(page).count()) === 1);
        }
        await page.close();
      }
    }
  } catch (e) {
    check("no exception", false, e.stack || String(e));
  } finally {
    await browser.close();
    await mock.close();
  }
  async function shot(page, name) {
    a11y.push(...(await snap(page, out, `notify-${name}`)));
  }
  const fails = Object.entries(steps).filter(([, v]) => v.startsWith("FAIL"));
  const problems = [...mock.problems, ...a11y];
  console.log(JSON.stringify({ flags: flags.set, steps, problems }, null, 2));
  process.exit(fails.length || problems.length ? 1 : 0);
})();
