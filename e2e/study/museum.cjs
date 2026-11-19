// Package U-3's flow (§12.5.U's U-3; museum.html) on the shared mock: six
// members in the fixture lecture, with Yoad's decisions 1 and 3 of 17 Nov
// 2026 (no accounts: a member of a week is counted; the museum opens with
// whatever it has, with a meter, never a dead end).
//   1. שוהם, counted last night: "טעויות נפוצות" on "יחד" with the newest
//      exhibit and the meter; the museum: the head with the course and the
//      number of exhibits, "רק טעויות ׳על בטוח׳ של לפחות 3 מכם · בלי שמות",
//      the newest exhibit as a card (number, "חדש", the claim, the plaque's
//      line, "האמת:", "מה בלבל:", slides), "עוד טעויות נפוצות" with "עוד טועים בה",
//      "עדיין פתוחה" and "נסגרה" last, the meter "4 טעויות נפוצות · עוד 2 הימורי
//      ׳על בטוח׳ שגויים לטעות הנפוצה הבאה", the footer; no member's name and no count
//      of people anywhere.
//   2. Decision 3: an empty museum is an empty state with its meter and
//      "לתרגל"; an exhibit found tonight says "טעות נפוצה חדשה נפתחת מחר"; a group
//      below 3 counted members says "עוד אדם אחד וזה נפתח".
//   3. רוני joined two days ago: not counted, so no exhibit; the days left.
//   4. נועה is out: the out line, no card on "יחד".
//   5. The trap card's one chip in C's review: "טעות נפוצה · לחזרה"
//      with "טעות מס׳ 4", and "למה זה כאן?" on its back (with CARDS_REVIEW).
//   6. The meeting opens with one exhibit (MU4), marked shown once.
//   7. The switch 'pulse' off: "התכונה הזו כבויה כרגע בשרת." and no card.
// Without the flag it checks that nothing of U-3 shows and no call of it is made.
//
//   NODE_PATH=$(npm root -g) node e2e/study/museum.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "h5" (wave 5 with
// VITE_STUDY_MUSEUM and VITE_STUDY_BOSS), "all", or a set without the museum.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf, GROUP } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const cardsPlugin = require("./mocks/cards.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/museum.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const MEMBERS = ["שוהם", "נועה", "איתי", "מאיה", "דניאל", "רוני"];
const NAMES = new RegExp(`((?<!לפחות )\\d+ (מכם|אנשים|חברים|תרגלו|טעו)(?![א-ת]))|${MEMBERS.join("|")}`);

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: MEMBERS });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const db = mock.db;
  const P = db.pulseMock;
  const M = db.museumMock;
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
    if (!flags.museum) {
      /* ── Nothing of U-3 without its flag ── */
      const s = await open("שוהם", "/?v=group");
      await s.locator("main").first().waitFor({ timeout: 15000 });
      await s.waitForTimeout(600);
      expect((await s.getByRole("heading", { name: "טעויות נפוצות" }).count()) === 0, "no \"טעויות נפוצות\" on \"יחד\"");
      await go(s, "/?v=museum");
      await s.waitForURL((u) => !u.search.includes("v=museum"), { timeout: 15000 });
      expect(!new URL(s.url()).search.includes("museum"), "?v=museum leads elsewhere");
      await s.waitForTimeout(400);
      expect(M.calls.length === 0, `no call of the museum (${M.calls.map((c) => c.fn).join(", ")})`);
    } else {
      const all = db.members.map((m) => m.user_id);
      P.night(all.filter((u) => u !== id("רוני")));
      P.joinDaysLeft[id("רוני")] = 5;
      const course = db.lectures.find((l) => l.id === L).course || "";
      const title = db.lectures.find((l) => l.id === L).title;
      const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
      const E = (n, state, stem, claim, truth, confused, slides, opened) => ({
        trap_id: `7c000000-0000-4000-8000-00000000000${n}`, lecture_id: L, lecture_title: title, course, exhibit_no: n, state, question_id: `q${n}`,
        stem, claim, truth, takeaway: "", confused, slides, plaque: null, opened_at: day(opened), card_id: state === "retired" ? null : `c${n}`,
      });
      M.exhibits = [
        E(4, "new", "איפה פועלת Furosemide?", "ב-proximal tubule", "ב-thick ascending limb, על NKCC2", "Acetazolamide היא זו שפועלת ב-proximal tubule.", [6, 7], 1),
        E(3, "falling", "Spironolactone והאשלגן?", "Spironolactone מורידה אשלגן", "מעלה אשלגן: K⁺-sparing", "", [13], 6),
        E(2, "hanging", "Mannitol באי ספיקת לב?", "Mannitol בטוחה באי ספיקת לב", "אסורה: מרחיבה את נפח הדם", "", [16], 9),
        E(1, "retired", "Thiazides והסידן בדם?", "Thiazides מורידות סידן בדם", "מעלות סידן: ספיגה מוגברת ב-DCT", "", [10], 20),
      ];
      M.need = 2;

      /* ── 1. the card on "יחד", then the museum ── */
      const s = await open("שוהם", "/?v=group");
      const card = s.locator(".museum-card");
      await card.waitFor({ timeout: 15000 });
      const cardText = await card.innerText();
      steps.card = cardText.replace(/\n/g, " | ");
      expect(/טעויות נפוצות/.test(cardText) && /טעות מס׳ 4: ׳ב-proximal tubule׳/.test(cardText) && /4 טעויות נפוצות · עוד 2 הימורי ׳על בטוח׳ שגויים לטעות הנפוצה הבאה/.test(cardText), "the card: the newest exhibit and the meter");
      await card.scrollIntoViewIfNeeded();
      await shot(s, "h5-museum-card");
      await card.locator("a").first().click();
      await s.waitForURL((u) => u.search.includes("v=museum"), { timeout: 15000 });
      await s.locator(".museum-feature").waitFor({ timeout: 15000 });
      const h1 = await s.locator("h1").first().innerText();
      expect(h1 === (course ? `טעויות נפוצות · ${course}` : "טעויות נפוצות"), `the head (${h1})`);
      expect((await s.locator(".ph-head .a-chip.fun").innerText()) === "4", "the number of exhibits in the head");
      const sub = await s.locator(".ph-sub").first().innerText();
      expect(/רק טעויות ׳על בטוח׳ של לפחות 3 מכם/.test(sub) && /בלי שמות/.test(sub), "the line under the head");
      const feat = await s.locator(".museum-feature").innerText();
      steps.feature = feat.replace(/\n/g, " | ");
      expect(/טעות מס׳ 4/.test(feat) && /חדש/.test(feat) && /׳ב-proximal tubule׳/.test(feat), "the newest exhibit: its number, \"חדש\", the claim");
      expect(/כמה מכם בחרו בזה ׳על בטוח׳ · שקף 6\./.test(feat), "the plaque's line from the exhibit's own slide (the op is deferred)");
      expect(/האמת: ב-thick ascending limb, על NKCC2/.test(feat) && /ש׳ 6,7/.test(feat) && /מה בלבל: Acetazolamide/.test(feat), "\"האמת:\" with its slides, \"מה בלבל:\"");
      const more = await s.locator(".museum-list li").allInnerTexts();
      steps.more = more.map((r) => r.replace(/\n/g, " | "));
      expect(more.length === 3 && /עוד טועים בה/.test(more[0]) && /עדיין פתוחה/.test(more[1]) && /נסגרה/.test(more[2]), "\"עוד טעויות נפוצות\": falling, hanging, retired last");
      expect((await s.getByRole("heading", { name: "עוד טעויות נפוצות" }).count()) === 1 && (await s.getByText("נסגרו: כולם ענו נכון ביומיים שונים").count()) === 1, "the section and its line");
      const meter = await s.locator(".museum-meter").innerText();
      expect(/4 טעויות נפוצות · עוד 2 הימורי ׳על בטוח׳ שגויים לטעות הנפוצה הבאה/.test(meter), "decision 3's meter under the exhibits");
      expect((await s.getByText("טעות חדשה מופיעה רק למחרת, כדי שאי אפשר יהיה לנחש מי.").count()) === 1, "the footer");
      const text = await s.locator("main").innerText();
      expect(!NAMES.test(text), "no member's name and no count of people");
      await shot(s, "h5-museum");

      /* ── 2. decision 3: an empty museum, tomorrow's exhibit, a small group ── */
      const kept = M.exhibits;
      M.exhibits = [];
      M.need = 1;
      await go(s, "/?v=museum");
      await s.locator(".museum-meter").waitFor({ timeout: 15000 });
      const empty = await s.locator("main").innerText();
      expect(/טעות נכנסת לכאן כש-3 מכם בוחרים ׳על בטוח׳ באותה תשובה שגויה/.test(empty) && /עוד אין טעויות נפוצות · עוד הימור ׳על בטוח׳ שגוי אחד לטעות הנפוצה הבאה/.test(empty), "empty: what makes an exhibit, and the meter");
      expect((await s.locator(".museum-meter").getByRole("link", { name: "לתרגל" }).count()) === (flags.questions ? 1 : 0), "never a dead end: practice beside it");
      expect((await s.locator(".ph-head .a-chip.fun").count()) === 0, "no \"0\" chip in the head of an empty museum");
      await shot(s, "h5-museum-empty");
      M.soon = 1;
      await go(s, "/?v=museum");
      await s.locator(".museum-meter").waitFor({ timeout: 15000 });
      expect(/עוד אין טעויות נפוצות · טעות נפוצה חדשה נפתחת מחר/.test(await s.locator(".museum-meter").innerText()), "found tonight: \"טעות נפוצה חדשה נפתחת מחר\"");
      M.soon = 0;
      P.groupNeed = 1;
      await go(s, "/?v=museum");
      await s.locator(".museum-meter").waitFor({ timeout: 15000 });
      expect(/הטעויות הנפוצות נפתחות מ-3 מתרגלים: עוד אדם אחד וזה נפתח\./.test(await s.locator(".museum-meter").innerText()), "a group below the floor: its meter");
      P.groupNeed = 0;
      M.exhibits = kept;
      M.need = 2;

      /* ── 3. רוני: not counted yet ── */
      const r = await open("רוני", "/?v=museum");
      await r.getByText(/הן ייפתחו לך בעוד 5 ימים\./).waitFor({ timeout: 15000 });
      expect((await r.locator(".museum-feature, .museum-list").count()) === 0, "רוני: no exhibit before a night counts him");
      expect(!M.calls.some((c) => c.fn === "study_museum" && c.who === id("רוני")), "רוני's phone never asks for the exhibits");
      await shot(r, "h5-museum-waiting");

      /* ── 4. נועה is out ── */
      P.out.add(id("נועה"));
      const n = await open("נועה", "/?v=museum");
      await n.getByText(/ולכן גם הטעויות הנפוצות לא מוצגות לך/).waitFor({ timeout: 15000 });
      await go(n, "/?v=group");
      await n.getByRole("heading", { name: "שאלות פתוחות" }).waitFor({ timeout: 15000 });
      await n.waitForTimeout(800);
      expect((await n.locator(".museum-card").count()) === 0, "out: no museum card on \"יחד\"");
      P.out.delete(id("נועה"));

      /* ── 5. the trap card's chip in C's review ── */
      if (flags.cardsReview) {
        const part = db.sections.find((x) => x.lecture_id === L)?.idx ?? 0;
        const c = cardsPlugin.trapCard(db, { lecture_id: L, part_idx: part, front: "Furosemide: איפה היא פועלת?", back: "ב-thick ascending limb, על NKCC2", extra: "טעות נפוצה: ב-proximal tubule", slides: [6] });
        M.traps = [{ card_id: c.id, trap_id: M.exhibits[0].trap_id, lecture_id: L, exhibit_no: 4, kind: "museum" }];
        db.cardsMock.settings.set(id("שוהם"), { new_per_day: 20, retention: 0.9, home: "app" });
        await go(s, `/?v=cards&s=l.${L}`);
        await s.getByRole("button", { name: "להציג תשובה" }).waitFor({ timeout: 15000 });
        await s.locator(".card-top").first().getByText("טעות נפוצה · לחזרה").waitFor({ timeout: 10000 }).catch(() => undefined);
        const top = await s.locator(".card-top").first().innerText();
        steps.badge = top.replace(/\n/g, " | ");
        expect(/טעות נפוצה · לחזרה/.test(top) && /טעות מס׳ 4/.test(top), `the vaccine's one chip (${steps.badge})`);
        await s.getByRole("button", { name: "להציג תשובה" }).click();
        await s.locator(".museum-why").waitFor({ timeout: 15000 });
        expect(/למה זה כאן\?/.test(await s.locator(".museum-why").innerText()), "\"למה זה כאן?\" on its back");
        await shot(s, "h5-museum-vaccine");
      }

      /* ── 6. the meeting opens with one exhibit ── */
      if (flags.meeting && db.meetingMock) {
        const today = new Date(Date.now() + 2 * 3_600_000 - 4 * 3_600_000).toISOString().slice(0, 10);
        const MT = "3e000000-0000-4000-8000-000000000778";
        const t0 = new Date().toISOString();
        db.meetingMock.meetings.push({
          id: MT, group_id: GROUP.id, day: today, starts_at: new Date(Date.now() + 3_600_000).toISOString(), lecture_id: L, part_from: 2, part_to: 3, title: "", planned_reader: null, reader_id: null, reading: false,
          started_at: null, read_part: null, guess_ids: [], guess_released: 0, cancelled_at: null, version: 1, created_by: id("שוהם"), updated_by: null, created_at: t0, updated_at: t0,
        });
        await go(s, `/?v=meeting&m=${MT}`);
        const ex = s.locator(".museum-opening");
        await ex.waitFor({ timeout: 15000 });
        const exText = await ex.innerText();
        expect(/פותחים בטעות נפוצה/.test(exText) && /30 שניות/.test(exText) && /׳ב-proximal tubule׳/.test(exText), "MU4: the meeting opens with the newest exhibit, 30 seconds");
        await ex.scrollIntoViewIfNeeded();
        await shot(s, "h5-museum-meeting");
        await ex.getByRole("button", { name: "ממשיכים בהקראה" }).click();
        await s.waitForTimeout(500);
        expect(M.shown.has(M.exhibits[0].trap_id) && (await s.locator(".museum-opening").count()) === 0, "marked shown, then the reading");
      }

      /* ── 7. the switch off ── */
      P.on = false;
      await go(s, "/?v=museum");
      await s.getByText("התכונה הזו כבויה כרגע בשרת.").waitFor({ timeout: 15000 });
      expect((await s.locator(".museum-feature").count()) === 0, "the switch off: no exhibit");
      await go(s, "/?v=group");
      await s.getByRole("heading", { name: "שאלות פתוחות" }).waitFor({ timeout: 15000 });
      await s.waitForTimeout(800);
      expect((await s.locator(".museum-card").count()) === 0, "the switch off: no card");
      P.on = true;
    }
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, ok: ok.length, checks: ok, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, ok, steps, calls: mock.calls.slice(-25), mCalls: M.calls.slice(-10) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
