// Notifications, slice 2 (section R; VITE_STUDY_NOTIFY): pushes on this
// device, on a mocked Supabase in Chromium, with a fake PushManager and a
// fake permission (an init script; Playwright's Chromium has no push
// service). The design's e2e cases (its §13.3):
//   1. states: an iPhone's Safari tab → "ios-install"; the home-screen app →
//      "ask"; without PushManager → "ios-old" with the update path;
//      Instagram's browser → "inapp"; blocked → the iPhone and Chrome paths;
//      health without pushes → no row in שלי, ?v=notify&x=set opens the inbox;
//   2. enable: one tap → one requestPermission → one study_push_subscribe;
//      the toast says what is on; שלי says "פועלות ✓"; the test push
//      (study_notify_test, its toast, greyed 20 s); a worker that never gets
//      ready → "broken" after 10 s; offline → the offline line, no question;
//   3. no question without a tap: the tabs, the inbox and the settings;
//   4. settings: no device → the switches disabled with their line; each
//      switch and select saves its patch; a failed save goes back; "לשנות
//      שעות" shows the hours; the devices only with 2 or more;
//   8. the service worker's message (a push tapped with the app open) routes
//      and sees its notice;
//   9. the real public/sw.js in Chromium: registered at scope /, a push
//      (CDP ServiceWorker.deliverPushMessage, Declarative Web Push JSON)
//      shows its title, body, he/rtl and tag; pages and chunks never pass
//      through it;
//  12. account paths: signing out → study_push_unsubscribe; "ניתוק המכשירים
//      האחרים" → study_push_keep_only; another member on this device →
//      study_push_subscribe again;
//  13. the kill path: health without a VAPID key → the worker is removed.
//
//   NODE_PATH=$(npm root -g) node e2e/study/notify-push.cjs <dist> <out dir>
//
// A build without VITE_STUDY_NOTIFY checks only that nothing of this runs.
// E2E_FLAGS: the mock's flag set (default "notify"). Screenshots and the
// a11y check: <out>/push-*-<scheme>.png.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/notify-push.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(process.env.E2E_FLAGS || "notify");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPHONE_IG = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
// A VAPID public key's shape (65 bytes, 0x04 first): the fake PushManager never reads it.
const VAPID = "B" + "A".repeat(86);

/** The fake push: the permission, PushManager's subscribe/getSubscription,
 *  and (optionally) a worker that never gets ready. State lives in
 *  localStorage, so a reload or a new page keeps it, as a browser does. */
function fakePush(cfg) {
  const K = "e2e-push:";
  const get = (k, d) => {
    try {
      const v = localStorage.getItem(K + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  };
  const put = (k, v) => localStorage.setItem(K + k, JSON.stringify(v));
  if (cfg.noNotification) {
    delete window.Notification;
  } else if (window.Notification) {
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => get("perm", cfg.perm || "default") });
    Notification.requestPermission = async () => {
      put("asked", get("asked", 0) + 1);
      const a = cfg.answer || "granted";
      put("perm", a);
      return a;
    };
  }
  if (cfg.noPush) {
    delete window.PushManager;
  } else if (window.PushManager) {
    const wrap = (s) =>
      s && {
        endpoint: s.endpoint,
        options: { userVisibleOnly: true },
        toJSON: () => ({ endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } }),
        getKey: () => null,
        unsubscribe: async () => (put("sub", null), put("unsubscribes", get("unsubscribes", 0) + 1), true),
      };
    PushManager.prototype.subscribe = async function () {
      put("subscribes", get("subscribes", 0) + 1);
      const s = { endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2, 10)}`, p256dh: "B" + "x".repeat(86), auth: "y".repeat(22) };
      put("sub", s);
      return wrap(s);
    };
    PushManager.prototype.getSubscription = async function () {
      return wrap(get("sub", null)) || null;
    };
  }
  if (cfg.readyNever) Object.defineProperty(ServiceWorkerContainer.prototype, "ready", { configurable: true, get: () => new Promise(() => undefined) });
}

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  mock.seedLecture();
  mock.member("איתי"); // a third member, for the states and the personal code
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
  const calls = (fn, who) => N.calls.filter((c) => c.fn === fn && (!who || c.who === id(who)));
  const until = (fn, timeout = 4000) =>
    new Promise((ok) => {
      const t0 = Date.now();
      const tick = () => (fn() ? ok(true) : Date.now() - t0 > timeout ? ok(false) : setTimeout(tick, 50));
      tick();
    });
  const homeReady = (page) => page.locator(".today .t-sec, main.library").first().waitFor({ timeout: 15000 });
  const wired = () => {
    N.health = { notify: true, vapid: VAPID };
    N.send = true;
  };
  /** A member's page with the fake push. */
  const openPush = async (who, o = {}) => {
    const s = await mock.open(browser, who, { userAgent: o.ua, isMobile: o.isMobile, hasTouch: o.hasTouch, standalone: o.standalone });
    await s.ctx.addInitScript(fakePush, { perm: o.perm, answer: o.answer, noPush: o.noPush, readyNever: o.readyNever, noNotification: o.noNotification });
    if (o.path) await s.page.goto(mock.base + o.path);
    return s;
  };
  const pushStore = (page, k) => page.evaluate((key) => JSON.parse(localStorage.getItem("e2e-push:" + key) ?? "null"), k);
  const toastHas = (page, text, timeout = 4000) =>
    page
      .waitForFunction((t) => [...document.querySelectorAll(".a-toast, [role=status]")].some((e) => e.textContent.includes(t)), text, { timeout })
      .then(() => true)
      .catch(() => false);
  const settings = async (page) => {
    await page.locator("main.notify-set .ntf-device, main.notify-inbox").first().waitFor({ timeout: 15000 });
    return (await page.locator("main.notify-set .ntf-device").count()) > 0;
  };
  const deviceText = (page) => page.locator(".ntf-device").innerText();

  try {
    const probe = await mock.open(browser, "שוהם", { path: "/?v=notify" });
    await probe.page.locator("main.notify-inbox, .today .t-sec, main.library").first().waitFor({ timeout: 15000 });
    const on = (await probe.page.locator("main.notify-inbox").count()) > 0;
    await probe.ctx.close();
    steps["00 the build"] = on ? "VITE_STUDY_NOTIFY on" : "VITE_STUDY_NOTIFY off";

    if (!on) {
      wired();
      const { page } = await openPush("נועה", { perm: "granted", path: "/?v=me" });
      await page.locator("main.me-screen").waitFor({ timeout: 15000 });
      await page.waitForTimeout(2500);
      check("off: no settings row in שלי", (await page.getByText("הגדרות התראות").count()) === 0);
      const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
      check("off: no service worker", regs === 0, String(regs));
      check("off: no section R call", N.calls.length === 0, JSON.stringify(N.calls.map((c) => c.fn)));
      check("off: no question asked", ((await pushStore(page, "asked")) ?? 0) === 0);
    } else {
      /* ── 1. Health without pushes: no row, x=set is the inbox ── */
      {
        N.health = null;
        N.calls.length = 0;
        const { page, ctx } = await openPush("נועה", { perm: "default", path: "/?v=me" });
        await page.locator("main.me-screen").waitFor({ timeout: 15000 });
        await page.waitForTimeout(1500);
        check("no pushes on the server: no row in שלי", (await page.getByText("הגדרות התראות").count()) === 0);
        await page.goto(mock.base + "/?v=notify&x=set");
        await page.locator("main.notify-inbox").waitFor({ timeout: 15000 });
        check("…and ?v=notify&x=set opens the inbox", new URL(page.url()).search === "?v=notify", page.url());
        check("…with no gear", (await page.getByRole("link", { name: "הגדרות התראות" }).count()) === 0);
        check("…and the state is never asked", calls("study_notify_state").length === 0);
        // Pushes wired, but this member is not in the pilot and the switch is off.
        N.health = { notify: true, vapid: VAPID };
        N.send = false;
        await page.evaluate(() => localStorage.removeItem("study-notify"));
        await page.goto(mock.base + "/?v=notify&x=set");
        await page.locator("main.notify-inbox").waitFor({ timeout: 15000 });
        await page.waitForTimeout(800);
        check("the switch off and not in the pilot: the inbox too", new URL(page.url()).search === "?v=notify" && calls("study_notify_state").length > 0);
        await ctx.close();
      }

      /* ── 1. The device's states ── */
      wired();
      const states = [
        ["an iPhone's Safari tab", { ua: IPHONE, isMobile: true, hasTouch: true }, "באייפון, התראות מגיעות רק כשפותחים את תמצית מהאייקון במסך הבית."],
        ["the iPhone's home-screen app", { ua: IPHONE, isMobile: true, hasTouch: true, standalone: true }, "אפשר לקבל התראה כשמבחן קבוצתי נפתח"],
        ["the home-screen app on an old iOS (no PushManager)", { ua: IPHONE, isMobile: true, hasTouch: true, standalone: true, noPush: true }, "צריך iOS 16.4 ומעלה כדי לקבל התראות (הגדרות ← כללי ← עדכון תוכנה)."],
        ["Instagram's browser", { ua: IPHONE_IG, isMobile: true, hasTouch: true }, "בדפדפן של אינסטגרם אין התראות. פותחים את תמצית בספארי."],
        ["blocked on an iPhone", { ua: IPHONE, isMobile: true, hasTouch: true, standalone: true, perm: "denied" }, "באייפון: הגדרות ← עדכונים ← תמצית ← אפשר עדכונים."],
        ["blocked in Chrome", { ua: ANDROID, isMobile: true, hasTouch: true, perm: "denied" }, "בכרום: הסמל שליד הכתובת ← הגדרות אתר ← התראות ← לאפשר."],
        ["a browser without pushes", { ua: ANDROID, isMobile: true, hasTouch: true, noPush: true }, "הדפדפן הזה לא תומך בהתראות."],
      ];
      for (const [name, o, text] of states) {
        const { page, ctx } = await openPush("איתי", { ...o, path: "/?v=notify&x=set" });
        const shown = await settings(page);
        const t = shown ? await deviceText(page) : "";
        check(`state: ${name}`, shown && t.includes(text), t || page.url());
        if (name === "an iPhone's Safari tab") {
          check("…with the way to the home screen", (await page.locator(".ntf-device").getByRole("link", { name: "להוספה למסך הבית" }).count()) === 1);
          check("…its switches disabled with their line", (await page.locator(".ntf-switch input:disabled").count()) === 5 && (await page.getByText("יחולו כשההתראות יופעלו באחד המכשירים.").count()) === 1);
          await shot(page, "1-ios-install");
        }
        if (name === "blocked in Chrome") await shot(page, "1-denied");
        check(`…no question asked (${name})`, ((await pushStore(page, "asked")) ?? 0) === 0);
        await ctx.close();
      }

      /* ── 3. No question without a tap ── */
      {
        const { page, ctx } = await openPush("שוהם", { ua: ANDROID, isMobile: true, hasTouch: true, path: "/" });
        await homeReady(page);
        for (const p of ["/", "/?v=library", "/?v=group", "/?v=me", "/?v=notify", "/?v=notify&x=set"]) {
          await page.goto(mock.base + p);
          await page.waitForTimeout(1200);
        }
        await settings(page);
        await page.waitForTimeout(800);
        check("no question on the tabs, the inbox or the settings", ((await pushStore(page, "asked")) ?? 0) === 0);
        check("…and nothing subscribed", ((await pushStore(page, "subscribes")) ?? 0) === 0 && calls("study_push_subscribe", "שוהם").length === 0);
        const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? ""));
        check("the settings screen registers the push-only worker ahead of the tap", regs.length === 1 && regs[0].endsWith("/sw.js"), JSON.stringify(regs));
        await ctx.close();
      }

      /* ── 2 and 4. Enable, the settings, the test ── */
      {
        N.calls.length = 0;
        const { page, ctx } = await openPush("שוהם", { path: "/?v=me" });
        await page.locator("main.me-screen").waitFor({ timeout: 15000 });
        const row = page.locator(".ntf-me-row");
        await row.waitFor({ timeout: 10000 });
        check("שלי: the row says כבויות", (await row.innerText()).includes("כבויות"), await row.innerText());
        await row.click();
        await settings(page);
        check("settings: no device yet: the switches disabled", (await page.locator(".ntf-switch input:disabled").count()) === 5);
        await shot(page, "2-ask");
        await page.getByRole("button", { name: "להפעיל התראות במכשיר הזה" }).click();
        await page.getByText("ההתראות פועלות במכשיר הזה ✓").waitFor({ timeout: 15000 });
        check("one tap: one question", (await pushStore(page, "asked")) === 1);
        check("…one study_push_subscribe", await until(() => calls("study_push_subscribe", "שוהם").length === 1));
        const sub = calls("study_push_subscribe", "שוהם")[0]?.body ?? {};
        check("…with the device's keys, the key's id and the device", /^https:\/\/fcm\.googleapis\.com\//.test(sub.p_endpoint) && sub.p_p256dh?.length === 87 && sub.p_auth?.length === 22 && /^[\w-]{12}$/.test(sub.p_key_id) && sub.p_device === "linux" && sub.p_browser === "Chrome", JSON.stringify(sub));
        check("the toast says what is on", await toastHas(page, "ההתראות פועלות: מבחן קבוצתי, תשובות אליך, ומה שהעלית כשהוא מוכן."));
        check("focus moves to the device's status", await page.evaluate(() => document.activeElement?.classList.contains("ntf-status")));
        check("the switches work now, for every device", (await page.locator(".ntf-switch input:disabled").count()) === 0 && (await page.getByText("ההגדרות חלות על כל המכשירים שלך.").count()) === 1);
        await shot(page, "2-on");
        // The test push.
        await page.getByRole("button", { name: "שליחת התראת ניסיון" }).click();
        check("the test: study_notify_test", await until(() => calls("study_notify_test", "שוהם").length === 1));
        check("…its toast, with the computer's line", await toastHas(page, "ההתראה תגיע בעוד כמה שניות. אפשר לנעול את המסך או לצאת מהאפליקציה. לא הגיעה?"));
        check("…the button rests 20 s", await page.getByRole("button", { name: "שליחת התראת ניסיון" }).isDisabled());
        // 4. Each switch and select saves its patch.
        const patches = () => calls("study_notify_prefs_set", "שוהם").map((c) => JSON.stringify(c.body.p));
        const before = patches().length;
        await page.locator(".ntf-switch", { hasText: "עכשיו בקבוצה" }).locator("input").uncheck();
        check("a switch saves its patch ({live:false})", await until(() => patches().slice(before).includes('{"live":false}')));
        check("…and keeps its focus", await page.evaluate(() => document.activeElement?.getAttribute("name") === "live"));
        await page.locator(".ntf-switch", { hasText: "תזכורת יומית" }).locator("input").check();
        check("the reminder on: {digest:true}", await until(() => patches().includes('{"digest":true}')));
        await page.getByRole("combobox", { name: "תזכורת יומית: בשעה" }).selectOption("20:00");
        check("its hour: {digest_at:'20:00'}", await until(() => patches().includes('{"digest_at":"20:00"}')));
        check("…the hour's choices run 06:00-22:00 by halves", (await page.getByRole("combobox", { name: "תזכורת יומית: בשעה" }).locator("option").count()) === 33);
        await page.getByRole("button", { name: /^לשנות שעות/ }).click();
        await page.getByRole("combobox", { name: "תחילת שעות השקט" }).selectOption("22:30");
        check("לשנות שעות: the hours, {quiet_from:'22:30'}", await until(() => patches().includes('{"quiet_from":"22:30"}')));
        check("…the night's row says the new hours", (await page.locator(".ntf-switch", { hasText: "לא לשלוח בלילה" }).innerText()).includes("22:30"));
        // A failed save goes back, with its line.
        await page.route("**/rest/v1/rpc/study_notify_prefs_set", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' }));
        const shabbat = page.locator(".ntf-switch", { hasText: "לא לשלוח בשבת" }).locator("input");
        await shabbat.check();
        check("a failed save: its line", await toastHas(page, "לא הצלחנו לשמור. אפשר לנסות שוב."));
        check("…and the switch goes back", await page.waitForFunction(() => !document.querySelector("input[name=shabbat]").checked, null, { timeout: 3000 }).then(() => true).catch(() => false));
        await page.unroute("**/rest/v1/rpc/study_notify_prefs_set");
        // One device: no list; a second: the list.
        check("one device: no devices list", (await page.getByText("המכשירים שמקבלים התראות").count()) === 0);
        N.subs.push({ id: N.subSeq++, user_id: id("שוהם"), endpoint: "https://web.push.apple.com/e2e-phone", device: "iphone", browser: "Safari", created_at: new Date(Date.now() - 6 * 86_400_000).toISOString(), seen_at: new Date().toISOString(), ok_at: null });
        await page.reload();
        await settings(page);
        await page.getByText("המכשירים שמקבלים התראות").waitFor({ timeout: 8000 });
        const list = await page.locator(".ntf-dev").allInnerTexts();
        check("two devices: the list, this one marked", list.length === 2 && list.some((t) => t.includes("מחשב · כרום · המכשיר הזה")) && list.some((t) => t.startsWith("אייפון · מאז")), list.join(" | "));
        await shot(page, "4-devices");
        await page.locator(".ntf-dev", { hasText: "אייפון" }).getByRole("button", { name: "להסיר" }).click();
        check("להסיר: study_push_remove, and the list goes", (await until(() => calls("study_push_remove", "שוהם").length === 1)) && (await page.getByText("המכשירים שמקבלים התראות").waitFor({ state: "detached", timeout: 5000 }).then(() => true).catch(() => false)));
        // שלי says פועלות ✓.
        await page.goto(mock.base + "/?v=me");
        await row.waitFor({ timeout: 10000 });
        check("שלי: 'פועלות ✓'", (await row.innerText()).includes("פועלות ✓"), await row.innerText());
        // The inbox's gear.
        await page.goto(mock.base + "/?v=notify");
        await page.locator("main.notify-inbox").waitFor({ timeout: 15000 });
        const gear = page.getByRole("link", { name: "הגדרות התראות" });
        await gear.waitFor({ timeout: 8000 });
        await gear.click();
        await settings(page);
        check("the inbox's gear opens the settings, back to the inbox", (await page.locator(".ph-head .back").innerText()).includes("→ להתראות"));

        /* ── 8. The worker's message: a push tapped while the app is open ── */
        const a = N.add({ user_id: id("שוהם"), kind: "reply", args: { lecture: "הרצאה" }, route: { v: "lecture", l: L }, dedupe: "reply:sw" });
        await page.evaluate(
          ({ url, nid }) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "study-open", url, id: nid } })),
          { url: `${mock.base}/?l=${L}&nt=${a.id}`, nid: a.id },
        );
        await page.waitForURL((u) => u.searchParams.get("l") === L, { timeout: 8000 }).catch(() => undefined);
        check("the worker's message opens its screen, without nt", new URL(page.url()).searchParams.get("l") === L && !new URL(page.url()).searchParams.has("nt"), page.url());
        check("…and sees its notice", await until(() => Boolean(a.seen_at)));
        await page.evaluate((u) => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "study-open", url: u, id: 1 } })), "https://evil.example/?v=me");
        await page.waitForTimeout(500);
        check("…a message for another site is ignored", new URL(page.url()).searchParams.get("l") === L);

        /* ── 12. Another member on this device: subscribed again ── */
        const n0 = calls("study_push_subscribe").length;
        const other = mock.people["נועה"];
        await page.evaluate(
          (auth) => localStorage.setItem("study-auth", auth),
          JSON.stringify({ access_token: other.token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${other.token}`, user: other.user }),
        );
        await page.goto(mock.base + "/");
        await homeReady(page);
        check("another member on this device: study_push_subscribe as that member", await until(() => calls("study_push_subscribe", "נועה").length >= 1 && calls("study_push_subscribe").length > n0, 8000));
        // Sign-out on this device: study_push_unsubscribe first.
        await page.goto(mock.base + "/?v=me");
        await page.locator("main.me-screen").waitFor({ timeout: 15000 });
        await page.locator("button.signout").click();
        await page.locator(".confirm .a-btn.danger").click();
        check("signing out: study_push_unsubscribe for this device", await until(() => calls("study_push_unsubscribe", "נועה").length === 1, 8000));
        await page.waitForLoadState("load").catch(() => undefined);
        await page.waitForTimeout(500);
        check("…and the browser's subscription is dropped", (await pushStore(page, "unsubscribes").catch(() => null)) === 1 && (await pushStore(page, "sub").catch(() => "x")) === null);
        await ctx.close();
      }

      /* ── 12. "ניתוק המכשירים האחרים": only this device keeps pushes ── */
      {
        N.calls.length = 0;
        mock.db.codes.on = true;
        mock.db.codes.byUser.set(id("איתי"), { hash: "x", created_at: new Date().toISOString(), issued_by: id("איתי"), seen_at: new Date().toISOString(), replaced: false, used_at: null, uses: 0 });
        const { page, ctx } = await openPush("איתי", { perm: "granted", path: "/?v=me" });
        const card = page.locator(".pc-card");
        await card.waitFor({ timeout: 15000 });
        await card.getByRole("button", { name: "ניתוק המכשירים האחרים" }).click();
        await card.getByRole("button", { name: "ניתוק", exact: true }).click();
        check("ניתוק: study_push_keep_only", await until(() => calls("study_push_keep_only", "איתי").length === 1, 8000));
        mock.db.codes.on = false;
        await ctx.close();
      }

      /* ── 2. A worker that never gets ready: broken after 10 s; offline: no question ── */
      {
        wired();
        const { page, ctx } = await openPush("איתי", { readyNever: true, path: "/?v=notify&x=set" });
        await settings(page);
        const t0 = Date.now();
        await page.getByRole("button", { name: "להפעיל התראות במכשיר הזה" }).click();
        const broke = await page.getByText("ההרשמה להתראות לא הצליחה.").waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
        const took = Date.now() - t0;
        check("ready never comes: 'broken' after 10 s, with לנסות שוב", broke && took >= 9500 && (await page.getByRole("button", { name: "לנסות שוב" }).count()) === 1, `${took} ms`);
        await ctx.close();
        const off = await openPush("איתי", { path: "/?v=notify&x=set" });
        await settings(off.page);
        await off.ctx.setOffline(true);
        await off.page.getByRole("button", { name: "להפעיל התראות במכשיר הזה" }).click();
        check("offline before the tap: the offline line", await off.page.getByText("אין חיבור. אפשר לנסות שוב כשהחיבור חוזר.").waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
        check("…and no question", ((await pushStore(off.page, "asked")) ?? 0) === 0);
        await off.ctx.setOffline(false);
        await off.ctx.close();
      }

      /* ── 13. The kill path ── */
      {
        wired();
        const { page, ctx } = await openPush("שוהם", { path: "/?v=notify&x=set" });
        await settings(page);
        await page.getByRole("button", { name: "להפעיל התראות במכשיר הזה" }).click();
        await page.getByText("ההתראות פועלות במכשיר הזה ✓").waitFor({ timeout: 15000 });
        const regs = () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
        check("on: the worker is registered", (await regs()) === 1);
        // A day later: health again, now without a key.
        N.health = { notify: false, vapid: null };
        await page.evaluate(() => {
          const m = JSON.parse(localStorage.getItem("study-notify") || "{}");
          localStorage.setItem("study-notify", JSON.stringify({ ...m, keyAt: 1 }));
        });
        const h0 = N.healthCalls;
        await page.goto(mock.base + "/");
        await homeReady(page);
        let gone = false;
        for (let i = 0; i < 40 && !gone; i++) {
          gone = (await regs()) === 0;
          if (!gone) await page.waitForTimeout(250);
        }
        check("health without a key: the worker is removed", gone);
        check("…after one health call", N.healthCalls > h0);
        const m = await page.evaluate(() => JSON.parse(localStorage.getItem("study-notify") || "{}"));
        check("…and the key is forgotten", !m.key && !m.keyId, JSON.stringify(m));
        // A failed health never removes it.
        wired();
        await page.goto(mock.base + "/?v=notify&x=set");
        await settings(page);
        await page.getByText("ההתראות פועלות במכשיר הזה ✓").waitFor({ timeout: 15000 }).catch(() => undefined);
        await page.evaluate(() => {
          const x = JSON.parse(localStorage.getItem("study-notify") || "{}");
          localStorage.setItem("study-notify", JSON.stringify({ ...x, keyAt: 1 }));
        });
        await page.route("**/api/study/health", (r) => r.fulfill({ status: 503, body: "" }));
        await page.goto(mock.base + "/");
        await homeReady(page);
        await page.waitForTimeout(3000);
        check("a failed health keeps the worker", (await regs()) === 1);
        await ctx.close();
      }

      /* ── 9. The real public/sw.js in Chromium ── */
      {
        // The app's own resync stays out of it (no key from health); the page registers the worker itself.
        N.health = null;
        // Chromium's headless shell has no notifications: the full browser, headless.
        const full = await chromium.launch({ channel: "chromium" });
        const s = await mock.open(full, "שוהם", { path: "/?v=library", permissions: ["notifications"] });
        await homeReady(s.page);
        const cdp = await s.ctx.newCDPSession(s.page);
        const regIds = [];
        cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => {
          for (const r of e.registrations) if (!r.isDeleted && r.scopeURL === `${mock.base}/`) regIds.push(r.registrationId);
        });
        await cdp.send("ServiceWorker.enable");
        const scope = await s.page.evaluate(async () => {
          const r = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
          await navigator.serviceWorker.ready;
          return r.scope;
        });
        check("sw.js registers at scope /", scope === `${mock.base}/`, scope);
        await until(() => regIds.length > 0, 5000);
        const payload = {
          web_push: 8030,
          notification: { title: "מבחן קבוצתי נפתח עכשיו", body: "הרצאה מומצאת · להצטרף", navigate: `${mock.base}/?v=quiz&q=x&nt=9`, lang: "he", dir: "rtl", tag: "e2e-tag-1234567890abcd", silent: false },
          mutable: false,
          n: 9,
        };
        await cdp.send("ServiceWorker.deliverPushMessage", { origin: mock.base, registrationId: regIds[regIds.length - 1], data: JSON.stringify(payload) });
        let shown = null;
        for (let i = 0; i < 32 && !shown; i++) {
          shown = await s.page.evaluate(async () => {
            const r = await navigator.serviceWorker.ready;
            const list = await r.getNotifications();
            return list.length ? { title: list[0].title, body: list[0].body, dir: list[0].dir, lang: list[0].lang, tag: list[0].tag, data: list[0].data } : null;
          });
          if (!shown) await s.page.waitForTimeout(250);
        }
        check(
          "a push shows its title, body, rtl, he and tag",
          shown && shown.title === payload.notification.title && shown.body === payload.notification.body && shown.dir === "rtl" && shown.lang === "he" && shown.tag === payload.notification.tag && shown.data?.id === 9,
          JSON.stringify(shown),
        );
        // Pages and chunks never pass through it.
        const viaWorker = [];
        s.page.on("response", (r) => {
          if (r.fromServiceWorker()) viaWorker.push(r.url());
        });
        await s.page.reload();
        await homeReady(s.page);
        await s.page.goto(mock.base + "/?v=me");
        await s.page.locator("main.me-screen").waitFor({ timeout: 15000 });
        check("the page is controlled, yet no request passes through the worker", (await s.page.evaluate(() => Boolean(navigator.serviceWorker.controller))) && viaWorker.length === 0, viaWorker.join(" "));
        await s.ctx.close();
        await full.close();
      }
    }
  } catch (e) {
    check("no exception", false, e.stack || String(e));
  } finally {
    await browser.close();
    await mock.close();
  }
  async function shot(page, name) {
    a11y.push(...(await snap(page, out, `push-${name}`)));
  }
  const fails = Object.entries(steps).filter(([, v]) => v.startsWith("FAIL"));
  const problems = [...mock.problems, ...a11y];
  console.log(JSON.stringify({ flags: flags.set, steps, problems }, null, 2));
  process.exit(fails.length || problems.length ? 1 : 0);
})();
