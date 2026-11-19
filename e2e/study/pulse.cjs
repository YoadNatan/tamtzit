// Package U's flow (§12.5.U, U-4: U-1 and U-2; progress-pulse.html s2) on the
// shared mock: six members in the fixture lecture, with Yoad's decisions 1
// and 3 of 17 Nov 2026 (no accounts: a member of a week is counted; below the
// floor a meter, never a dead end).
//   1. שוהם, counted last night: "דופק הקבוצה" on "יחד" names the lecture's
//      hot topics; its screen has חם · פושר · יושב טוב, "אצלך" and "רק לך",
//      her own chips, "רק אצלך חם, אז זה נכנס לתור האישי", "החור שנסגר
//      השבוע" once, the meter of the topics still below 3, "מחר בפגישה:"
//      (tomorrow's meeting) and the footer; no number of people and no name
//      anywhere; the slide tag opens the slide, the topic its practice.
//   2. Every lecture (?v=pulse): "נקודות חמות: …".
//   3. Decision 3: a lecture below the floor shows "עוד אדם אחד וזה נפתח"
//      and her own rows; a group below the floor its own meter; the card on
//      "יחד" says it too.
//   4. רוני joined two days ago: not counted, so the group's words stay
//      hidden; his meter counts the days ("בעוד 5 ימים") and his own rows show.
//   5. נועה opts out under "שלי": the screen says she is out, the card goes;
//      a night counts without her; back in, she waits for the next night
//      ("מחר"), then reads again.
//   6. The hooks: "הפסקה הזאת קשה לנו" in the paragraph's chip row; J's
//      "דרושה אסוציאציה" with "משלי" and "תנו לי 3 מצחיקות" (and in the
//      paragraph sheet's "אסוציאציה" tab); M's agenda line "נקודה חמה: …"
//      with its slide; practice asks for the group's signal.
//   7. The switch 'pulse' off: "התכונה הזו כבויה כרגע בשרת." and no card.
// Without the flag (every set but "u" and "all") it checks that nothing of U
// shows and that no call of section U is made.
//
//   NODE_PATH=$(npm root -g) node e2e/study/pulse.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "u" (wave 4's
// with VITE_STUDY_PROGRESS and VITE_STUDY_PULSE), "all", or a set without U.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf, GROUP } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/pulse.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const MEMBERS = ["שוהם", "נועה", "איתי", "מאיה", "דניאל", "רוני"];
const NUMBERS_OR_NAMES = new RegExp(`(\\d+ (מכם|אנשים|חברים|תרגלו|טעו))|${MEMBERS.filter((n) => n !== "שוהם").join("|")}`);

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: MEMBERS });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const db = mock.db;
  const P = db.pulseMock;
  const id = (name) => db.members.find((m) => m.name === name).user_id;
  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const ok = [];
  const a11y = [];
  const pages = {};
  const open = async (who, path) => {
    if (pages[who]) await pages[who].context().close().catch(() => undefined);
    const { page } = await mock.open(browser, who, { path });
    pages[who] = page;
    return page;
  };
  const expect = (cond, what) => {
    if (!cond) throw new Error(what);
    ok.push(what);
  };
  const shot = async (page, name) => a11y.push(...(await snap(page, out, name)));
  const go = async (page, path) => {
    await page.goto(`${mock.base}${path}`);
    await page.locator("main").first().waitFor({ timeout: 15000 });
  };
  try {
    if (!flags.pulse) {
      /* ── Nothing of U without its flag ── */
      const s = await open("שוהם", "/?v=group");
      await s.locator("main").first().waitFor({ timeout: 15000 });
      await s.waitForTimeout(600);
      expect((await s.getByRole("heading", { name: "דופק הקבוצה" }).count()) === 0, "no \"דופק הקבוצה\" on \"יחד\"");
      await go(s, "/?v=pulse");
      await s.waitForURL((u) => !u.search.includes("v=pulse"), { timeout: 15000 });
      expect(!new URL(s.url()).search.includes("pulse"), "?v=pulse leads elsewhere");
      await go(s, "/?v=me");
      await s.getByRole("heading", { name: "הגדרות" }).waitFor({ timeout: 15000 });
      expect((await s.getByText("לא לכלול אותי בדופק").count()) === 0, "no \"לא לכלול אותי בדופק\" under \"שלי\"");
      if (flags.wall) {
        await go(s, `/?v=wall&l=${L}`);
        await s.getByText("הכי טובות").first().waitFor({ timeout: 15000 });
        expect((await s.getByRole("button", { name: "דרושות" }).count()) === 0, "no \"דרושות\" on the wall");
      }
      await s.waitForTimeout(400);
      expect(P.calls.length === 0, `no call of section U (${P.calls.map((c) => c.fn).join(", ")})`);
    } else {
      /* ── the night's words for the fixture lecture ── */
      const all = db.members.map((m) => m.user_id);
      P.night(all.filter((u) => u !== id("רוני")));
      P.joinDaysLeft[id("רוני")] = 5;
      const T = (topic_key, topic, aspect, bucket, slides, closed = false) => ({ lecture_id: L, topic_key, topic, aspect, bucket, slides, closed_week: closed, cutoff: P.cutoff });
      P.topics = [
        T("loop diuretics", "Loop diuretics", "mechanism", "hot", [6, 7]),
        T("thiazides", "Thiazides", "adverse", "hot", [10]),
        T("spironolactone", "Spironolactone", "interactions", "warm", [13]),
        T("acetazolamide", "Acetazolamide", "uses", "cool", [4], true),
        T("mannitol", "Mannitol", "contra", "cool", [16], true),
      ];
      const mineRow = (topic_key, topic, aspect, mine) => ({ lecture_id: L, topic_key, topic, aspect, items: 2, wrong: mine === "hot" ? 2 : 0, mine });
      for (const who of ["שוהם", "נועה", "רוני"])
        P.mine[id(who)] = [
          mineRow("loop diuretics", "Loop diuretics", "mechanism", "hot"),
          mineRow("thiazides", "Thiazides", "adverse", "cool"),
          mineRow("spironolactone", "Spironolactone", "interactions", "hot"),
        ];
      P.meter = [{ lecture_id: L, open: 5, waiting: 1, need: 1 }];
      P.brief[L] = { hot: { topic: "Loop diuretics", aspect: "mechanism", slides: [6] }, question: { question_id: "q1", question: "כמה מה-Na⁺ המסונן נספג ב-thick ascending limb?", kind: "mcq", slides: [6] } };
      P.spots = [{ lecture_id: L, part_idx: 2, anchor: 2 }];
      P.needed = [{ card_id: "c1", lecture_id: L, part_idx: 2, anchor: 2, front: "Furosemide: איזה טרנספורטר היא מעכבת?", slides: [6] }];
      // Tomorrow's meeting on the lecture (section M's row, as M's plugin keeps it).
      const dayOf = (ms) => new Date(ms + 2 * 3_600_000 - 4 * 3_600_000).toISOString().slice(0, 10);
      const tomorrow = dayOf(Date.now() + 86_400_000);
      const MT = "3e000000-0000-4000-8000-000000000777";
      const t0 = new Date().toISOString();
      db.meetingMock.meetings.push({
        id: MT, group_id: GROUP.id, day: tomorrow, starts_at: `${tomorrow}T18:00:00.000Z`, lecture_id: L, part_from: 2, part_to: 3, title: "", planned_reader: null, reader_id: null, reading: false,
        started_at: null, read_part: null, guess_ids: [], guess_released: 0, cancelled_at: null, version: 1, created_by: id("שוהם"), updated_by: null, created_at: t0, updated_at: t0,
      });

      /* ── 1. שוהם: the card on "יחד", then the lecture's pulse ── */
      const s = await open("שוהם", "/?v=group");
      const card = s.locator(".pulse-card");
      await card.waitFor({ timeout: 15000 });
      const cardText = await card.innerText();
      steps.card = cardText.replace(/\n/g, " | ");
      expect(/דופק הקבוצה/.test(cardText) && /נקודות חמות: Loop diuretics, Thiazides/.test(cardText) && /עודכן הלילה/.test(cardText), "the card names the lecture's hot topics, \"עודכן הלילה\"");
      await card.scrollIntoViewIfNeeded();
      await shot(s, "u-1-group-card");
      await card.locator("a").first().click();
      await s.waitForURL((u) => u.search.includes("v=pulse") && u.search.includes(`l=${L}`), { timeout: 15000 });
      await s.locator(".pulse-section").first().waitFor({ timeout: 15000 });
      const heads = await s.locator(".pulse-section .a-sec h2").allInnerTexts();
      expect(heads.join(",") === "חם,פושר,יושב טוב", `the sections חם · פושר · יושב טוב (${heads})`);
      expect((await s.locator(".pulse-section").first().getByText("אצלך", { exact: true }).count()) === 1 && (await s.locator(".pulse-section").first().getByText("רק לך").count()) === 1, "the first section carries \"אצלך\" and \"רק לך\"");
      expect((await s.locator(".pulse-section").nth(1).getByText("אצלך", { exact: true }).count()) === 0, "only the first");
      const sub = await s.locator(".ph-sub").first().innerText();
      expect(/מתעדכן בלילה/.test(sub) && /בלי שמות, רק איפה ש-3 לפחות תרגלו/.test(sub), "the line under the head");
      const h1 = await s.locator("h1").first().innerText();
      expect(/דופק הקבוצה · /.test(h1), `the head "דופק הקבוצה · {title}" (${h1})`);
      const rows = await s.locator(".pulse-row").allInnerTexts();
      steps.rows = rows.map((r) => r.replace(/\n/g, " | "));
      expect(rows.length === 5, `five rows (${rows.length})`);
      expect(/Loop diuretics · מנגנון פעולה/.test(rows[0]) && /ש׳ 6/.test(rows[0]) && /חם$/.test(rows[0].trim()), "a row: topic · aspect, its slide, the member's own chip");
      expect((await s.getByText("רק אצלך חם, אז זה נכנס לתור האישי").count()) === 1, "P-5 on the warm row that is hot for her");
      expect((await s.getByText("החור שנסגר השבוע").count()) === 1, "P-6 once, though two rows closed this week");
      const meterLine = await s.locator('[data-meter="lecture"]').innerText();
      expect(/5 מתוך 6 נושאים פתוחים · עוד אדם אחד לנושא הבא/.test(meterLine), `decision 3: the meter of the topics still below 3 (${meterLine})`);
      const brief = await s.locator(".pulse-brief").innerText();
      steps.brief = brief;
      expect(/^מחר בפגישה:/.test(brief) && /הנקודה החמה ׳Loop diuretics · מנגנון פעולה׳/.test(brief) && /ובמבחן הקבוצתי ׳/.test(brief), "\"מחר בפגישה:\" with the hot point and the quiz's question");
      expect((await s.getByText("אפשר לצאת מהספירה ב׳שלי׳.").count()) === 1, "the footer");
      const whole = await s.locator("main").innerText();
      expect(!NUMBERS_OR_NAMES.test(whole), "no count of people and no member's name on the pulse");
      await s.evaluate(() => window.scrollTo(0, 0));
      await shot(s, "u-2-pulse-lecture");
      await s.locator(".pulse-slide").first().click();
      await s.getByRole("dialog").waitFor({ timeout: 10000 });
      expect(/שקף 6|ש׳ 6/.test(await s.getByRole("dialog").innerText()), "the slide tag opens slide 6");
      await s.keyboard.press("Escape");
      await s.getByRole("dialog").waitFor({ state: "detached", timeout: 10000 });
      const before = P.calls.filter((c) => c.fn === "signals").length;
      await s.locator(".pulse-topic").first().click();
      await s.waitForURL((u) => u.searchParams.get("v") === "practice" && u.searchParams.get("s") === "t.loop diuretics", { timeout: 15000 });
      expect(true, "a topic opens its practice (s=t.<topic>)");
      await s.waitForTimeout(1200);
      expect(P.calls.filter((c) => c.fn === "signals").length > before, "practice reads the group's signal (Q10)");

      /* ── 2. every lecture ── */
      await go(s, "/?v=pulse");
      await s.locator(".pulse-lectures").waitFor({ timeout: 15000 });
      const list = await s.locator(".pulse-lectures").innerText();
      expect(/נקודות חמות: Loop diuretics, Thiazides/.test(list), "P-10: the lecture's line");
      await shot(s, "u-3-pulse-list");

      /* ── 3. decision 3: below the floor, a meter and her own rows ── */
      const saved = { topics: P.topics, meter: P.meter };
      P.topics = [];
      P.meter = [{ lecture_id: L, open: 0, waiting: 2, need: 1 }];
      await go(s, `/?v=pulse&l=${L}`);
      await s.locator('[data-meter="lecture"]').waitFor({ timeout: 15000 });
      expect(/עוד אין דופק להרצאה הזו/.test(await s.locator(".empty").innerText()), "P-9 empty");
      expect(/עוד אדם אחד וזה נפתח/.test(await s.locator('[data-meter="lecture"]').innerText()), "the meter: \"עוד אדם אחד וזה נפתח\"");
      expect((await s.locator(".pulse-mine .pulse-row").count()) === 3, "and her own rows (\"אצלך\", hers at any count)");
      await shot(s, "u-4-meter-lecture");
      P.meter = [];
      P.groupNeed = 1;
      await go(s, `/?v=pulse&l=${L}`);
      await s.locator('[data-meter="group"]').waitFor({ timeout: 15000 });
      expect(/הדופק נפתח מ-3 מתרגלים: עוד אדם אחד וזה נפתח\./.test(await s.locator('[data-meter="group"]').innerText()), "the group's meter below 3 counted");
      await shot(s, "u-5-meter-group");
      await go(s, "/?v=group");
      await s.locator(".pulse-card").waitFor({ timeout: 15000 });
      expect(/עוד אדם אחד וזה נפתח/.test(await s.locator(".pulse-card").innerText()), "the card shows the meter, not nothing");
      Object.assign(P, saved, { groupNeed: 0 });

      /* ── 4. רוני: two days in the group, not counted yet ── */
      const r = await open("רוני", `/?v=pulse&l=${L}`);
      await r.locator('[data-meter="waiting"]').waitFor({ timeout: 15000 });
      const wait = await r.locator('[data-meter="waiting"]').innerText();
      expect(/שבוע בקבוצה/.test(wait) && /הדופק ייפתח לך בעוד 5 ימים/.test(wait) && !/חשבון/.test(wait), `P-14 with the days left, no account (${wait.replace(/\n/g, " ")})`);
      expect((await r.locator(".pulse-section:not(.pulse-mine)").count()) === 0, "none of the group's words");
      expect((await r.locator(".pulse-mine .pulse-row").count()) === 3, "his own rows");
      await shot(r, "u-6-waiting");

      /* ── 5. נועה opts out, and comes back ── */
      const n = await open("נועה", "/?v=me");
      const box = n.getByRole("checkbox", { name: /לא לכלול אותי בדופק/ });
      await box.waitFor({ timeout: 15000 });
      expect(!(await box.isChecked()), "in the count");
      expect(/מי שיוצאים מהספירה לא רואים את הדופק/.test(await n.locator(".pulse-setting").innerText()), "P-12 with its last sentence");
      await n.locator(".pulse-setting").scrollIntoViewIfNeeded();
      await shot(n, "u-7-setting");
      await box.check();
      await n.getByText("יצאת מהספירה.", { exact: false }).waitFor({ timeout: 10000 });
      expect(P.out.has(id("נועה")), "her own opt-out row");
      await go(n, `/?v=pulse&l=${L}`);
      await n.locator(".pulse-state").first().waitFor({ timeout: 15000 });
      expect(/התשובות שלך לא נספרות בדופק, ולכן גם הדופק לא מוצג/.test(await n.locator("main").innerText()), "out: she reads nothing (reciprocal)");
      await shot(n, "u-8-out");
      await go(n, "/?v=group");
      await n.getByRole("heading", { name: "שאלות פתוחות" }).waitFor({ timeout: 15000 });
      await n.waitForTimeout(800);
      expect((await n.locator(".pulse-card").count()) === 0, "no card while out");
      // A night while she is out leaves her out of the count; back in, she waits for the next one.
      P.night(all.filter((u) => u !== id("רוני")));
      await go(n, "/?v=me");
      await n.getByRole("checkbox", { name: /לא לכלול אותי בדופק/ }).uncheck();
      await n.getByText("חזרת לספירה.", { exact: false }).waitFor({ timeout: 10000 });
      expect(!P.out.has(id("נועה")), "her row is gone");
      await go(n, `/?v=pulse&l=${L}`);
      await n.locator('[data-meter="waiting"]').waitFor({ timeout: 15000 });
      expect(/הדופק ייפתח לך מחר/.test(await n.locator('[data-meter="waiting"]').innerText()), "back in: the next night counts her (\"מחר\")");
      P.night(all.filter((u) => u !== id("רוני")));
      await go(n, `/?v=pulse&l=${L}`);
      await n.locator(".pulse-row").first().waitFor({ timeout: 15000 });
      expect(true, "after the night she reads the pulse again");

      /* ── 6. the hooks: the paragraph, the wall, the agenda ── */
      await go(s, `/?l=${L}`);
      await s.locator(".summary").first().waitFor({ timeout: 20000 });
      const chip = s.locator('.pulse-spot[data-pulse-spot="2.2"]');
      await chip.waitFor({ timeout: 15000 });
      expect((await chip.innerText()) === "הפסקה הזאת קשה לנו", "P-13 in the paragraph's chip row");
      expect((await s.locator(".pulse-spot").count()) === 1, "only on the hard paragraph");
      await chip.scrollIntoViewIfNeeded();
      await shot(s, "u-9-paragraph");
      if (flags.wall) {
        await go(s, `/?v=wall&l=${L}&t=needed`);
        const need = s.locator(".wall-needed");
        await need.waitFor({ timeout: 15000 });
        expect(/דרושה אסוציאציה\. כמה מכם שוכחים את זה: Furosemide/.test(await need.innerText()) && /ש׳ 6/.test(await need.innerText()), "J's \"דרושה אסוציאציה\" with the card and its slide");
        expect((await s.locator(".wall-list .empty").count()) === 0, "no empty line beside a request");
        await shot(s, "u-10-wall-needed");
        await need.getByRole("button", { name: "תנו לי 3 מצחיקות" }).click();
        await s.waitForURL((u) => u.search.includes("x=drafts") && u.search.includes("at=2.2"), { timeout: 15000 });
        expect(true, "\"תנו לי 3 מצחיקות\" opens the paragraph's drafts");
        await go(s, `/?v=wall&l=${L}&t=needed`);
        await s.locator(".wall-needed").getByRole("button", { name: "משלי" }).click();
        await s.waitForURL((u) => u.search.includes("x=post") && u.search.includes("at=2.2"), { timeout: 15000 });
        expect(true, "\"משלי\" opens the composer on the paragraph");
      }
      if (flags.meeting) {
        await go(s, `/?v=meeting&m=${MT}`);
        const hot = s.locator(".m-agenda").getByText(/נקודה חמה:/);
        await hot.waitFor({ timeout: 15000 });
        const line = await hot.innerText();
        expect(/נקודה חמה: Loop diuretics · מנגנון פעולה/.test(line) && /ש׳ 6/.test(line), `M's agenda: the hot spot with its slide (${line})`);
        await hot.scrollIntoViewIfNeeded();
        await shot(s, "u-11-agenda");
        // Out of the count: no hot spot for her.
        P.out.add(id("שוהם"));
        await go(s, `/?v=meeting&m=${MT}`);
        await s.locator(".m-agenda").waitFor({ timeout: 15000 });
        await s.waitForTimeout(600);
        expect((await s.locator(".m-agenda").getByText(/נקודה חמה:/).count()) === 0, "out of the count: no hot spot in her agenda");
        P.out.delete(id("שוהם"));
      }

      /* ── 7. the switch off ── */
      P.on = false;
      await go(s, `/?v=pulse&l=${L}`);
      await s.getByText("התכונה הזו כבויה כרגע בשרת.").waitFor({ timeout: 15000 });
      expect((await s.locator(".pulse-row").count()) === 0, "the switch off: no row");
      await go(s, "/?v=group");
      await s.getByRole("heading", { name: "שאלות פתוחות" }).waitFor({ timeout: 15000 });
      await s.waitForTimeout(800);
      expect((await s.locator(".pulse-card").count()) === 0, "the switch off: no card");
      P.on = true;
    }
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, ok: ok.length, checks: ok, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, ok, steps, calls: mock.calls.slice(-25), pCalls: P.calls.slice(-10) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
