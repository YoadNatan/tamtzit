// Notifications, slice 3 (section R; VITE_STUDY_NOTIFY): the asks and the
// quiz setup's checkbox, on a mocked Supabase in Chromium, with the same fake
// PushManager and permission as notify-push.cjs (an init script). The
// design's e2e cases (its §13.3):
//  10. the asks: the first launch from the icon shows Today's card once; with
//      the guide's card holding the home, "לקבל התראות" is its first step and
//      there is no second card; the upload ask (the uploader's lecture while it
//      is written) once; "לא עכשיו" hides every ask for 14 days; the inbox's
//      line once ever, never where the device cannot be asked; "להפעיל
//      התראות" asks the browser once and turns pushes on;
//  11. the quiz setup: "להודיע לקבוצה" on by default; unchecked, the quiz is
//      opened and study_quiz_quiet follows with its id; checked, nothing;
//  and help's row and how-to "להפעיל התראות".
//
//   NODE_PATH=$(npm root -g) node e2e/study/notify-asks.cjs <dist> <out dir>
//
// A build without VITE_STUDY_NOTIFY checks only that none of this shows.
// E2E_FLAGS: the mock's flag set (default "notify"). Screenshots and the
// a11y check: <out>/asks-*-<scheme>.png.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/notify-asks.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(process.env.E2E_FLAGS || "notify");

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const VAPID = "B" + "A".repeat(86);
const WRITING = "7a000000-0000-4000-8000-0000000000a1";

/** The fake push (as notify-push.cjs): the permission and PushManager, kept in localStorage. */
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
  if (window.Notification) {
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => get("perm", cfg.perm || "default") });
    Notification.requestPermission = async () => {
      put("asked", get("asked", 0) + 1);
      const a = cfg.answer || "granted";
      put("perm", a);
      return a;
    };
  }
  if (window.PushManager) {
    const wrap = (s) =>
      s && {
        endpoint: s.endpoint,
        options: { userVisibleOnly: true },
        toJSON: () => ({ endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } }),
        getKey: () => null,
        unsubscribe: async () => (put("sub", null), true),
      };
    PushManager.prototype.subscribe = async function () {
      const s = { endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Math.random().toString(36).slice(2, 10)}`, p256dh: "B" + "x".repeat(86), auth: "y".repeat(22) };
      put("sub", s);
      return wrap(s);
    };
    PushManager.prototype.getSubscription = async function () {
      return wrap(get("sub", null)) || null;
    };
  }
}

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  mock.seedLecture();
  mock.member("איתי");
  mock.member("יעל");
  mock.member("דנה");
  mock.member("רוני");
  const { db, LECTURE_ID: L } = mock;
  const N = db.notifyMock;
  const id = (name) => mock.people[name].user.id;
  // Five questions on the lecture, for the quiz setup.
  const P = db.practice;
  const Z = db.quiz;
  if (P) P.notify = mock.notify;
  if (Z) Z.notify = mock.notify;
  if (P) {
    const t0 = new Date().toISOString();
    for (let i = 0; i < 6; i++) {
      const qid = `9c000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
      const options = ["אפשרות בדויה א", "אפשרות בדויה ב", "אפשרות בדויה ג", "אפשרות בדויה ד"];
      P.questions.push({
        id: qid, group_id: mock.GROUP.id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: 0, kind: "mcq", difficulty: 1,
        vignette: "", question: `שאלה בדויה ${i + 1}?`, options, slides: [1], topic: options[0], aspect: "other", has_key: true, model: "mock", created_by: null, created_at: t0,
        retired_at: null, retired_by: null, retire_note: "",
      });
      P.keys.set(qid, { answer: 0, explanations: options.map((o) => `${o}. [ש' 1]`), takeaway: `${options[0]}. [ש' 1]` });
    }
  }
  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  let n = 0;
  const check = (name, ok, detail) => {
    n += 1;
    steps[`${String(n).padStart(2, "0")} ${name}`] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const calls = (fn, who) => (N ? N.calls.filter((c) => c.fn === fn && (!who || c.who === id(who))) : []);
  const until = (fn, timeout = 5000) =>
    new Promise((ok) => {
      const t0 = Date.now();
      const tick = () => (fn() ? ok(true) : Date.now() - t0 > timeout ? ok(false) : setTimeout(tick, 50));
      tick();
    });
  const homeReady = (page) => page.locator(".today .t-sec, main.library").first().waitFor({ timeout: 15000 });
  const openPush = async (who, o = {}) => {
    const s = await mock.open(browser, who, { userAgent: o.ua, isMobile: o.isMobile, hasTouch: o.hasTouch, standalone: o.standalone });
    await s.ctx.addInitScript(fakePush, { perm: o.perm, answer: o.answer });
    if (o.init) await s.ctx.addInitScript(o.init.fn, o.init.arg);
    if (o.path) await s.page.goto(mock.base + o.path);
    return s;
  };
  const asked = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("e2e-push:asked") ?? "0"));
  const toastHas = (page, text, timeout = 5000) =>
    page
      .waitForFunction((t) => [...document.querySelectorAll(".a-toast, [role=status]")].some((e) => e.textContent.includes(t)), text, { timeout })
      .then(() => true)
      .catch(() => false);
  const askCard = (page, which) => page.locator(`.ntf-ask[data-ask="${which}"]`);
  const ANDROID_APP = { ua: ANDROID, isMobile: true, hasTouch: true, standalone: true };
  async function shot(page, name) {
    a11y.push(...(await snap(page, out, `asks-${name}`)));
  }

  try {
    const probe = await mock.open(browser, "שוהם", { path: "/?v=notify" });
    await probe.page.locator("main.notify-inbox, .today .t-sec, main.library").first().waitFor({ timeout: 15000 });
    const on = (await probe.page.locator("main.notify-inbox").count()) > 0;
    await probe.ctx.close();
    steps["00 the build"] = on ? "VITE_STUDY_NOTIFY on" : "VITE_STUDY_NOTIFY off";

    if (!on) {
      const { page, ctx } = await openPush("נועה", { ...ANDROID_APP, path: "/" });
      await homeReady(page);
      await page.waitForTimeout(2000);
      check("off: no ask on Today", (await page.locator(".ntf-ask").count()) === 0);
      await page.goto(`${mock.base}/?v=quiz&new=1&l=${L}`);
      await page.locator("main.quiz-setup").waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      check("off: no \"להודיע לקבוצה\"", (await page.getByText("להודיע לקבוצה").count()) === 0);
      await page.goto(`${mock.base}/?v=help`);
      await page.locator("main.help").waitFor({ timeout: 15000 });
      check("off: no help row on notifications", (await page.locator("main.help summary", { hasText: /^התראות$/ }).count()) === 0);
      await ctx.close();
    } else {
      N.health = { notify: true, vapid: VAPID };
      N.send = true;

      /* ── 10a. The first launch from the icon: Today's card, once ── */
      {
        const { page, ctx } = await openPush("איתי", { ...ANDROID_APP, path: "/" });
        await homeReady(page);
        const card = askCard(page, "home");
        const shown = await card.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
        check("from the icon: Today's card", shown && (await card.innerText()).includes("תמצית פתוחה מהאייקון ✓"));
        check("…with its words", shown && (await card.innerText()).includes("עכשיו אפשר גם לקבל התראות: כשמבחן קבוצתי נפתח, כשעונים בשרשור שלך וכשהסיכום מוכן."));
        check("…and no question yet", (await asked(page)) === 0);
        if (shown) await shot(page, "10-home");
        await page.reload();
        await homeReady(page);
        await page.waitForTimeout(2500);
        check("…once: not on the next launch", (await page.locator(".ntf-ask").count()) === 0);
        await ctx.close();
      }
      {
        // In a browser tab, never.
        const { page, ctx } = await openPush("יעל", { ua: ANDROID, isMobile: true, hasTouch: true, path: "/" });
        await homeReady(page);
        await page.waitForTimeout(2500);
        check("in a browser tab: no Today card", (await page.locator(".ntf-ask").count()) === 0);
        await ctx.close();
      }
      {
        // An iPhone's Safari tab cannot be asked (pushes only from the icon): no card.
        const { page, ctx } = await openPush("רוני", { ua: IPHONE, isMobile: true, hasTouch: true, path: "/" });
        await homeReady(page);
        await page.waitForTimeout(2500);
        check("an iPhone's Safari tab: no Today card", (await page.locator(".ntf-ask").count()) === 0);
        await ctx.close();
      }

      /* ── 10b. The guide's card holds the home: its first step is "לקבל התראות", no second card ── */
      {
        const uid = id("דנה");
        const { page, ctx } = await openPush("דנה", {
          ...ANDROID_APP,
          init: {
            fn: ([k]) => {
              if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ v: 1, born: Date.now(), mode: "join", views: 0, did: [], list: [], tips: true }));
            },
            arg: [`study-guide:${uid}`],
          },
          path: "/",
        });
        await homeReady(page);
        const card = page.locator(".g-steps");
        const hasGuide = await card.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
        if (hasGuide) {
          const first = page.locator(".g-steps .g-step").first();
          await page.locator('.g-step[data-step="S10"]').waitFor({ timeout: 10000 }).catch(() => undefined);
          check("the guide's card: \"לקבל התראות\" is its first step", (await first.getAttribute("data-step")) === "S10" && (await first.innerText()).includes("לקבל התראות"));
          await page.waitForTimeout(1500);
          check("…and no second card", (await page.locator(".ntf-ask").count()) === 0);
          await shot(page, "10-guide");
          // "להראות" points at שלי's tab, then (after the member's own tap) at the settings row.
          await first.getByRole("button", { name: /להראות/ }).click();
          const said = (t) => page.getByText(t).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
          check("…its walk points at שלי", await said("ההתראות נמצאות ב״שלי״."));
          await page.locator('nav a[href="/?v=me"], a[href="/?v=me"]').first().click();
          const second = await said("כאן בוחרים מה מקבלים, ומפעילים במכשיר הזה.");
          const row = await page.locator(".ntf-me-row").waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
          check("…then at \"הגדרות התראות\"", second && row, `${page.url()} ${await page.locator(".g-say").allInnerTexts()} rows=${await page.locator(".ntf-me-row").count()}`);
        } else steps["-- the guide's card"] = "skipped: no guide card in this build";
        await ctx.close();
      }

      /* ── 10c. Turning on from Today's card: one question, the toast; the guide hears it ── */
      {
        N.calls.length = 0;
        const { page, ctx } = await openPush("יעל", { ...ANDROID_APP, path: "/" });
        await homeReady(page);
        const card = askCard(page, "home");
        await card.waitFor({ timeout: 10000 });
        await card.getByRole("button", { name: "להפעיל התראות" }).click();
        check("להפעיל התראות: …one study_push_subscribe", await until(() => calls("study_push_subscribe", "יעל").length === 1));
        check("…after exactly one question", (await asked(page)) === 1);
        check("…the toast says what is on", await toastHas(page, "ההתראות פועלות: מבחן קבוצתי, תשובות אליך, ומה שהעלית כשהוא מוכן."));
        check("…and the card is gone", await card.waitFor({ state: "detached", timeout: 5000 }).then(() => true).catch(() => false));
        // On, the upload ask and the inbox's line never show.
        await page.goto(`${mock.base}/?v=notify`);
        await page.locator("main.notify-inbox").waitFor({ timeout: 15000 });
        await page.waitForTimeout(1500);
        check("on: no line in the inbox", (await page.locator(".ntf-offbar").count()) === 0);
        await ctx.close();
      }

      /* ── 10d. The upload ask: the uploader's lecture while it is written, once; "לא עכשיו" hides all for 14 days ── */
      {
        const t = new Date().toISOString();
        db.lectures.push({ ...db.lectures[0], id: WRITING, title: "הרצאה בדויה בכתיבה", status: "outlining", created_by: id("רוני"), created_at: t, updated_at: t, queued_at: t });
        const { page, ctx } = await openPush("רוני", { ua: ANDROID, isMobile: true, hasTouch: true, path: `/?l=${WRITING}` });
        const card = askCard(page, "upload");
        const shown = await card.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
        check("the uploader's lecture while it is written: \"להודיע כשהסיכום מוכן?\"", shown && (await card.innerText()).includes("להודיע כשהסיכום מוכן?"));
        check("…with where to choose", shown && (await card.innerText()).includes("אפשר לבחור מה מקבלים בשלי ← הגדרות התראות."));
        if (shown) await shot(page, "10-upload");
        if (shown) await card.getByRole("button", { name: "לא עכשיו" }).click();
        check("לא עכשיו: gone, no question", (await page.locator(".ntf-ask").count()) === 0 && (await asked(page)) === 0);
        await page.waitForFunction(() => typeof JSON.parse(localStorage.getItem("study-notify") ?? "{}").snooze === "number", null, { timeout: 3000 }).catch(() => undefined);
        const mem = await page.evaluate(() => JSON.parse(localStorage.getItem("study-notify") ?? "{}"));
        check("…every ask resting 14 days", typeof mem.snooze === "number" && mem.snooze - Date.now() > 13.9 * 86_400_000, JSON.stringify(mem));
        await page.goto(`${mock.base}/?v=notify`);
        await page.locator("main.notify-inbox").waitFor({ timeout: 15000 });
        await page.waitForTimeout(1500);
        check("…the inbox's line too", (await page.locator(".ntf-offbar").count()) === 0);
        await ctx.close();
        // Another member opening that lecture: no ask (it is the uploader's).
        const o = await openPush("נועה", { ua: ANDROID, isMobile: true, hasTouch: true, path: `/?l=${WRITING}` });
        await o.page.locator(".part-wait").waitFor({ timeout: 15000 }).catch(() => undefined);
        await o.page.waitForTimeout(2000);
        check("another member's view of it: no ask", (await o.page.locator(".ntf-ask").count()) === 0);
        await o.ctx.close();
      }

      /* ── 10e. The inbox's line: once ever, and never where the device cannot be asked ── */
      {
        const { page, ctx } = await openPush("נועה", { ua: ANDROID, isMobile: true, hasTouch: true, path: "/?v=notify" });
        await page.locator("main.notify-inbox").waitFor({ timeout: 15000 });
        const bar = page.locator(".ntf-offbar");
        const shown = await bar.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
        check("the inbox: \"ההתראות לא פועלות במכשיר הזה.\" with להפעיל", shown && (await bar.innerText()).includes("ההתראות לא פועלות במכשיר הזה."));
        if (shown) await shot(page, "10-offbar");
        if (shown) await bar.getByRole("link", { name: "להפעיל" }).click();
        check("…להפעיל opens the settings", await page.locator("main.notify-set").waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
        check("…without asking the browser", (await asked(page)) === 0);
        await page.goto(`${mock.base}/?v=notify`);
        await page.locator("main.notify-inbox").waitFor({ timeout: 15000 });
        await page.waitForTimeout(1500);
        check("…once ever", (await page.locator(".ntf-offbar").count()) === 0);
        await ctx.close();
        for (const [name, o] of [
          ["blocked", { ua: ANDROID, isMobile: true, hasTouch: true, perm: "denied" }],
          ["an iPhone's Safari tab", { ua: IPHONE, isMobile: true, hasTouch: true }],
        ]) {
          const s = await openPush("שוהם", { ...o, path: "/?v=notify" });
          await s.page.locator("main.notify-inbox").waitFor({ timeout: 15000 });
          await s.page.waitForTimeout(2000);
          check(`the inbox's line: never ${name}`, (await s.page.locator(".ntf-offbar").count()) === 0);
          await s.ctx.close();
        }
      }

      /* ── 11. The quiz setup's "להודיע לקבוצה" ── */
      {
        N.calls.length = 0;
        const { page, ctx } = await openPush("שוהם", { path: `/?v=quiz&new=1&l=${L}` });
        await page.locator("main.quiz-setup").waitFor({ timeout: 15000 });
        const box = page.getByRole("checkbox", { name: /להודיע לקבוצה/ });
        await box.waitFor({ timeout: 10000 });
        check("quiz setup: \"להודיע לקבוצה\", checked", await box.isChecked());
        check("…with its line", (await page.getByText("התראה לחברי הקבוצה כשהמבחן נפתח").count()) === 1);
        await shot(page, "11-quiz");
        await box.uncheck();
        await page.getByRole("button", { name: "פתיחת המבחן" }).click();
        await page.waitForURL(/v=quiz&q=/, { timeout: 15000 }).catch(() => undefined);
        const q = new URL(page.url()).searchParams.get("q");
        check("unchecked: the quiz opens", Boolean(q), page.url());
        check("…and study_quiz_quiet follows with its id", await until(() => calls("study_quiz_quiet", "שוהם").some((c) => c.body.p_quiz === q)), JSON.stringify(calls("study_quiz_quiet")));
        await ctx.close();
        // Checked (the default): nothing more.
        if (Z) for (const z of Z.quizzes) z.state = "ended";
        N.calls.length = 0;
        const s = await openPush("נועה", { path: `/?v=quiz&new=1&l=${L}` });
        await s.page.locator("main.quiz-setup").waitFor({ timeout: 15000 });
        await s.page.getByRole("checkbox", { name: /להודיע לקבוצה/ }).waitFor({ timeout: 10000 });
        await s.page.getByRole("button", { name: "פתיחת המבחן" }).click();
        await s.page.waitForURL(/v=quiz&q=/, { timeout: 15000 }).catch(() => undefined);
        await s.page.waitForTimeout(1000);
        check("checked: the quiz opens with no study_quiz_quiet", /v=quiz&q=/.test(s.page.url()) && calls("study_quiz_quiet").length === 0, s.page.url());
        await s.ctx.close();
      }

      /* ── Help: the row and the how-to ── */
      {
        const { page, ctx } = await openPush("נועה", { path: "/?v=help" });
        await page.locator("main.help").waitFor({ timeout: 15000 });
        const row = page.locator("main.help summary", { hasText: /^התראות$/ });
        check("help: the row \"התראות\"", (await row.count()) === 1);
        await row.click();
        check("…saying how to turn them on and why an iPhone needs the icon", (await page.locator("main.help details[open] p").innerText()).includes("באייפון ההתראות מגיעות רק כשפותחים את תמצית מהאייקון במסך הבית."));
        const search = page.locator("#howto input, .g-help input[type=search], input[type=search]").first();
        if ((await search.count()) > 0) {
          await search.fill("התראות");
          check("the how-to \"להפעיל התראות\" is found", await page.getByText("להפעיל התראות").first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
        }
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
