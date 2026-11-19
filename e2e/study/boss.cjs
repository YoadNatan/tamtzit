// Package H's flow (§12.5.H's H-2 … H-4; boss.html) on the shared mock: six
// members in the fixture lecture, with Yoad's decisions 1 and 3 of 17 Nov
// 2026 (no accounts: a member of a week is counted; the boss opens early,
// with a meter, never a dead end).
//   1. שוהם, counted last night: "אתגר קבוצתי" on "יחד" with the heads and the
//      meter "3 מתוך 8 נושאים קשים · עוד כ-20 תשובות לנושא הבא".
//   2. The new battle's screen: the lectures, the heads, the meter, the
//      seconds, "לפתוח את האתגר".
//   3. Decision 3: one hot topic is not a battle yet: the screen stays open
//      with "האתגר נפתח משני נושאים קשים: עוד נושא אחד." and "לתרגל".
//   4. רוני joined two days ago: no heads, the days left.
//   5. The battle: Z's lobby in mode "boss" with the HUD; "להתחיל" with two
//      players answers "לאתגר קבוצתי צריך לפחות 3 משתתפים."; with three, the
//      rounds in head order: a head falls at 80% right, the trap's −20 when
//      half fall for it, a relapse, the win; the HUD shows both HP bars and a
//      chip a head; nothing names a player.
//   6. The end: "עברתם את האתגר!", the moments without names, her own loot with
//      "לתוכנית שלי"; the loot reaches Today ("מהקרב") on its day.
//   7. A lost battle's revenge round opens from the next study day.
//   8. The switch 'pulse' off: "התכונה הזו כבויה כרגע בשרת." and no card.
// Without the flag it checks that nothing of H shows and no call of it is made.
//
//   NODE_PATH=$(npm root -g) node e2e/study/boss.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "h5", "all", or a set without the boss.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/boss.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const MEMBERS = ["שוהם", "נועה", "איתי", "מאיה", "דניאל", "רוני"];
const OTHERS = new RegExp(MEMBERS.filter((n) => n !== "שוהם").join("|"));
const PRIMARY = ".ph-foot .a-btn.primary";
const until = async (fn, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
};

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: MEMBERS });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const db = mock.db;
  const P = db.pulseMock;
  const B = db.bossMock;
  const Z = db.quiz;
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
    if (!flags.boss) {
      /* ── Nothing of H without its flag ── */
      const s = await open("שוהם", "/?v=group");
      await s.locator("main").first().waitFor({ timeout: 15000 });
      await s.waitForTimeout(600);
      expect((await s.getByRole("heading", { name: "אתגר קבוצתי" }).count()) === 0, "no \"אתגר קבוצתי\" on \"יחד\"");
      await go(s, "/?v=boss&new=1");
      await s.waitForURL((u) => !u.search.includes("v=boss"), { timeout: 15000 });
      expect(!new URL(s.url()).search.includes("boss"), "?v=boss leads elsewhere");
      await s.waitForTimeout(400);
      expect(B.calls.length === 0, `no call of section H (${B.calls.map((c) => c.fn).join(", ")})`);
    } else {
      const all = db.members.map((m) => m.user_id);
      P.night(all.filter((u) => u !== id("רוני")));
      P.joinDaysLeft[id("רוני")] = 5;
      // The heads: five keyed questions of the fixture lecture, on three topics (as quiz.cjs seeds its own).
      db.practice.notify = mock.notify;
      Z.notify = mock.notify;
      const ITEMS = [
        ["איפה פועלת Furosemide?", ["Proximal tubule", "Thick ascending limb", "Collecting duct", "DCT"], 1, 6, 2, "Furosemide"],
        ["מה עושות Thiazides לסידן בדם?", ["מעלות", "מורידות", "לא משנות", "תלוי במינון"], 0, 10, 3, "Thiazides"],
        ["איפה פועלות Thiazides?", ["DCT", "Proximal tubule", "Thick ascending limb", "Collecting duct"], 0, 10, 3, "Thiazides"],
        ["Spironolactone והאשלגן?", ["מורידה", "מעלה", "לא משנה", "רק בכליה"], 1, 13, 4, "Spironolactone"],
        ["על מה פועלת Spironolactone?", ["קולטן לאלדוסטרון", "NKCC2", "ENaC", "Carbonic anhydrase"], 0, 13, 4, "Spironolactone"],
      ];
      const t0 = new Date().toISOString();
      const Q = ITEMS.map(([question, options, answer, slide, part, topic], i) => {
        const x = {
          id: `9c000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, group_id: db.group.id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: part,
          kind: "mcq", difficulty: 1, vignette: "", question, options, slides: [slide], topic, aspect: "other", has_key: true, model: "mock", created_by: null, created_at: t0, retired_at: null, retired_by: null, retire_note: "",
        };
        db.practice.questions.push(x);
        db.practice.keys.set(x.id, { answer, explanations: options.map((o, j) => (j === answer ? `${o}: כך בשקף.` : `${o} לא מתאימה כאן.`)), takeaway: "" });
        return x;
      });
      const key = (qid) => db.practice.keys.get(qid).answer;
      const wrong = (qid) => (key(qid) === 0 ? 1 : 0);
      const head = (name, qs, trap) => ({ name, qs: qs.map((x) => x.id), trap_q: trap ? qs[0].id : null, trap_opt: trap ? wrong(qs[0].id) : null, slides: qs[0].slides.slice(0, 2) });
      B.heads = [head("Furosemide", [Q[0]]), head("Thiazides", [Q[1], Q[2]]), head("Spironolactone", [Q[3], Q[4]], true)];
      B.hot = 3;
      B.topics = 8;
      B.answersNext = 20;

      /* ── 1. the card on "יחד" ── */
      const s = await open("שוהם", "/?v=group");
      const card = s.locator(".boss-card");
      await card.waitFor({ timeout: 15000 });
      const cardText = await card.innerText();
      steps.card = cardText.replace(/\n/g, " | ");
      expect(/אתגר קבוצתי/.test(cardText) && /3 נושאים/.test(cardText) && /Furosemide · Thiazides · Spironolactone/.test(cardText), "the card: the heads");
      expect(/3 מתוך 8 נושאים קשים · עוד כ-20 תשובות לנושא הבא/.test(cardText), "the card: decision 3's meter, Yoad's example");
      await card.scrollIntoViewIfNeeded();
      await shot(s, "h5-boss-card");

      /* ── 2. the new battle's screen ── */
      await card.locator("a").first().click();
      await s.waitForURL((u) => u.search.includes("v=boss"), { timeout: 15000 });
      await s.locator(".boss-meter").waitFor({ timeout: 15000 });
      expect((await s.locator("h1").first().innerText()) === "אתגר קבוצתי", "the head");
      expect((await s.locator(".ph-sub").first().innerText()).includes("באתגר רק נושאים שלפחות 3 מכם מתקשים בהם"), "boss.html's line under the head");
      expect((await s.locator(".boss-heads li").allInnerTexts()).join(",") === "Furosemide,Thiazides,Spironolactone", "the heads, in order");
      expect(/3 מתוך 8 נושאים קשים · עוד כ-20 תשובות לנושא הבא/.test(await s.locator(".boss-meter").innerText()), "the meter beside them");
      // Review UI-2: the bar fills what its line says (3 of 8), and its label is the line.
      const bar = async () =>
        (await s.waitForTimeout(400), s).locator(".boss-meter .a-bar").evaluate((el) => ({ label: el.getAttribute("aria-label"), pct: Math.round((100 * el.querySelector("i").getBoundingClientRect().width) / el.getBoundingClientRect().width) }));
      const b3 = await bar();
      steps.bar3 = b3;
      expect(Math.abs(b3.pct - 38) <= 2 && /^3 מתוך 8 נושאים קשים/.test(b3.label || ""), "the bar is 3/8 under \"3 מתוך 8\", with the line as its label");
      expect((await s.getByRole("radio", { name: "כל ההרצאות" }).getAttribute("aria-checked")) === "true", "every lecture by default");
      expect((await s.getByText("אתגר צריך לפחות 3 משתתפים").count()) === 1, "three players, said before the lobby");
      const startBtn = s.locator(PRIMARY, { hasText: "לפתוח את האתגר" });
      expect(await startBtn.isEnabled(), "\"לפתוח את האתגר\" with three heads");
      await shot(s, "h5-boss-setup");

      /* ── 3. decision 3: one hot topic ── */
      const keep = B.heads;
      B.heads = keep.slice(0, 1);
      B.hot = 1;
      B.answersNext = 6;
      await go(s, "/?v=boss&new=1");
      await s.locator(".boss-meter").waitFor({ timeout: 15000 });
      const m1 = await s.locator(".boss-meter").innerText();
      expect(/1 מתוך 8 נושאים קשים · עוד כ-6 תשובות לנושא הבא/.test(m1) && /האתגר נפתח משני נושאים קשים: עוד נושא אחד\./.test(m1), "one head: the meter and what the battle still needs");
      expect(await s.locator(PRIMARY, { hasText: "לפתוח את האתגר" }).isDisabled(), "no battle from one head");
      const b1 = await bar();
      steps.bar1 = b1;
      expect(Math.abs(b1.pct - 13) <= 2 && /^1 מתוך 8 נושאים קשים/.test(b1.label || ""), "one head: the bar is 1/8");
      expect((await s.locator(".a-chip", { hasText: "נושא אחד" }).count()) >= 1 && !(await s.locator("main").innerText()).includes("1 נושאים"), "the chip: \"נושא אחד\", never \"1 נושאים\"");
      expect((await s.locator(".boss-meter").getByRole("link", { name: "לתרגל" }).count()) === 1, "never a dead end: practice beside it");
      await shot(s, "h5-boss-meter");
      B.heads = keep;
      B.hot = 3;
      B.answersNext = 20;

      /* ── 4. רוני: not counted yet ── */
      const r = await open("רוני", "/?v=boss&new=1");
      await r.getByText(/הנושאים ייפתחו לך בעוד 5 ימים\./).waitFor({ timeout: 15000 });
      expect((await r.locator(".boss-heads").count()) === 0, "רוני: no heads before a night counts him");
      await shot(r, "h5-boss-waiting");

      /* ── 5. the battle ── */
      await go(s, "/?v=boss&new=1");
      await s.locator(PRIMARY, { hasText: "לפתוח את האתגר" }).click();
      await s.waitForURL((u) => u.search.includes("v=quiz") && u.search.includes("q="), { timeout: 15000 });
      const q = Z.quizzes[Z.quizzes.length - 1];
      expect(q.mode === "boss" && q.title === `אתגר קבוצתי · ${db.lectures.find((l) => l.id === L).title}`, `a quiz in mode "boss" (${q.title})`);
      await s.locator(".boss-hud").waitFor({ timeout: 15000 });
      expect((await s.locator("h1").first().innerText()) === "אתגר קבוצתי", "the lobby says \"אתגר קבוצתי\"");
      const lobbyHud = await s.locator(".boss-hud").innerText();
      expect(/הקבוצה/.test(lobbyHud) && /100/.test(lobbyHud) && /3 נושאים/.test(lobbyHud), "the HUD in the lobby: both bars, three heads");
      await s.locator(PRIMARY, { hasText: "להתחיל" }).click();
      await s.getByText("לאתגר קבוצתי צריך לפחות 3 משתתפים.").waitFor({ timeout: 15000 });
      expect(true, "two players: \"לאתגר קבוצתי צריך לפחות 3 משתתפים.\"");
      const others = [id("איתי"), id("מאיה")];
      for (const u of others) Z.players.push({ quiz_id: q.id, user_id: u, joined_at: Date.now(), joined_idx: -1, seen_at: Date.now(), left_at: null, score: 0, correct_n: 0, answered_n: 0, ms_total: 0 });
      q.players_n = 3;
      await s.waitForTimeout(300);
      await s.locator(PRIMARY, { hasText: "להתחיל" }).click();
      const roundNow = () => Z.rounds.find((x) => x.quiz_id === q.id && x.idx === q.idx);
      /** One round: the two other phones answer (the mock, as their phones would), then שוהם on screen. */
      const play = async (mine, theirs, bet = "ניחוש") => {
        await until(async () => q.state === "question" && Date.now() >= Date.parse(roundNow().opens_at), 15000, "the question opens");
        const rr = roundNow();
        theirs.forEach((choice, i) => {
          Z.answers.push({ round_id: rr.id, user_id: others[i], choice, ms: 5000, answered_at: new Date().toISOString(), vote: 1, bet: 1, correct: null, points: 0 });
          const p = Z.players.find((x) => x.quiz_id === q.id && x.user_id === others[i]);
          p.seen_at = Date.now();
        });
        await s.locator("button.quiz-opt").nth(mine).waitFor({ timeout: 15000 });
        await until(async () => s.locator("button.quiz-opt").nth(mine).isEnabled(), 15000, "the options open");
        await s.locator("button.quiz-opt").nth(mine).click();
        if (await s.locator(".quiz-bets button").count()) await s.locator(".quiz-bets button", { hasText: bet }).click({ timeout: 10000 });
        await until(async () => q.state === "reveal", 15000, "the reveal");
        await s.locator("li.quiz-opt").first().waitFor({ timeout: 15000 });
      };
      const next = async () => {
        for (const p of Z.players.filter((x) => x.quiz_id === q.id)) p.seen_at = Date.now();
        await s.locator(PRIMARY, { hasText: /לשאלה הבאה|לסיום המבחן/ }).click();
      };
      const hud = () => db.bossMock.stateOf(q);
      const k = () => key(roundNow().question_id);
      // Round 1 · Furosemide (one question): all right: it falls.
      await until(async () => q.state === "question", 15000, "round 1");
      await play(k(), [k(), k()]);
      expect(hud().heads[0].down && hud().team_hp === 100, "round 1: Furosemide falls at 100% right, the team untouched");
      const reveal1 = await s.locator(".boss-hud").innerText();
      expect(/−34 לאתגר/.test(reveal1) && /הקבוצה לא איבדה נקודות/.test(reveal1), `the reveal says what it did (${reveal1.replace(/\n/g, " | ")})`);
      await shot(s, "h5-boss-reveal");
      await next();
      // Round 2 · Thiazides 1/2: all right: half its hit points.
      await until(async () => q.state === "question" && q.idx === 1, 15000, "round 2");
      await play(k(), [k(), k()]);
      expect(hud().heads[1].hp === 16 && !hud().heads[1].down, `round 2: a head loses its share (${hud().heads[1].hp})`);
      await next();
      // Round 3 · Thiazides 2/2: all right: it falls.
      await until(async () => q.state === "question" && q.idx === 2, 15000, "round 3");
      await play(k(), [k(), k()]);
      await next();
      // Round 4 · Spironolactone's trap: both others fall for it (−20).
      await until(async () => q.state === "question" && q.idx === 3, 15000, "round 4");
      await s.locator(".boss-hud .a-callout.warn").waitFor({ timeout: 15000 });
      expect(/Spironolactone: אם חצי מכם בוחרים באותה תשובה שגויה/.test(await s.locator(".boss-hud .a-callout.warn").innerText()), "the trap round's callout");
      expect((await s.locator(".boss-heads li[aria-current]").innerText()).includes("Spironolactone"), "the head on screen is marked");
      expect((await s.locator(".boss-hud").innerText()).includes("נושא 3/3"), "\"נושא 3/3\"");
      await s.locator("button.quiz-opt").first().waitFor({ timeout: 15000 });
      await until(async () => s.locator("button.quiz-opt").first().isEnabled(), 15000, "the trap round's options");
      await shot(s, "h5-boss-hud");
      const trapOpt = B.battles[B.battles.length - 1].heads[2].trap_opt;
      await play(k(), [trapOpt, trapOpt]);
      expect(hud().moments.some((m) => m.t === "trap") && hud().team_hp <= 80, `the trap cost the team (${hud().team_hp})`);
      await next();
      // Round 5 · Spironolactone 2/2: שוהם wrong, the others right: it is still standing: a relapse.
      await until(async () => q.state === "question" && q.idx === 4, 15000, "round 5");
      await play((key(roundNow().question_id) + 1) % 2, [k(), k()]);
      expect(hud().moments.some((m) => m.t === "relapse") && hud().heads[2].relapses === 1, "a head still standing relapses: its key question comes back");
      await next();
      // Round 6 · the relapse: all right: the head falls at once, the battle is won.
      await until(async () => q.state === "question" && q.idx === 5, 15000, "the relapse round");
      expect(hud().relapse === true, "the relapse round");
      await play(k(), [k(), k()]);
      expect(hud().outcome === "won" && hud().boss_hp === 0, "won: every head down");
      await next();

      /* ── 6. the end ── */
      await s.locator(".boss-result").waitFor({ timeout: 15000 });
      const end = await s.locator("main").innerText();
      steps.end = end.replace(/\n/g, " | ").slice(0, 600);
      expect(/עברתם את האתגר!/.test(end) && /לקבוצה נשארו \d+ נקודות מתוך 100\./.test(end) && /ניצחון/.test(end), "\"עברתם את האתגר!\" and the team's HP");
      expect(/רגעים מהאתגר/.test(end) && /של הקבוצה, בלי שמות/.test(end) && /טעות נפוצה: Spironolactone/.test(end) && /Spironolactone חזר/.test(end), "the moments: the trap, the relapse, without names");
      const moments = await s.locator(".boss-moment").allInnerTexts();
      expect(!moments.some((t) => OTHERS.test(t) || /שוהם/.test(t)), "no moment names anyone");
      const lootText = await s.locator(".boss-loot").innerText();
      expect(/לחזרה שלך: טעות אחת, יום אחד/.test(lootText) && /מחר · /.test(lootText) && /רק לך/.test(lootText), `her own loot: one mistake, tomorrow (${lootText.replace(/\n/g, " | ")})`);
      await shot(s, "h5-boss-end");
      await s.getByRole("button", { name: "לתוכנית שלי" }).click();
      await until(async () => B.loot.length === 1, 10000, "the loot saved");
      expect(B.loot[0].user_id === id("שוהם"), "\"לתוכנית שלי\": her loot, hers alone");
      if (flags.today) {
        B.loot[0].due_on = new Date(Date.now() + 2 * 3_600_000 - 4 * 3_600_000).toISOString().slice(0, 10);
        await go(s, "/");
        const row = s.locator(".today, main").getByText("שאלה אחת מהאתגר");
        await row.first().waitFor({ timeout: 15000 });
        expect(true, "Today: \"שאלה אחת מהאתגר\" on its day");
        await shot(s, "h5-boss-today");
      }

      /* ── 7. a lost battle: the revenge round from the next study day ── */
      const ended = Z.quizzes.find((x) => x.id === q.id);
      expect(ended.state === "ended", "the battle's quiz ended");
      // Days pass: the won battle two study days ago, then a lost one yesterday (the group's last battle).
      B.battles[B.battles.length - 1].ended_at = Date.now() - 2 * 86_400_000;
      B.battles.push({ ...B.battles[B.battles.length - 1], id: "7b200000-0000-4000-8000-000000000099", quiz_id: "7b100000-0000-4000-8000-000000000099", outcome: "lost", ended_at: Date.now() - 86_400_000,
        heads: B.heads.map((h, i) => ({ ...h, key_q: h.qs[0], max: 33, hp: i === 0 ? 0 : 20, relapses: 0, down: i === 0 })), log: [] });
      await go(s, "/?v=boss&new=1");
      const rev = s.locator(".boss-revenge");
      await rev.waitFor({ timeout: 15000 });
      expect(/סבב חוזר/.test(await rev.innerText()) && /Thiazides · Spironolactone/.test(await rev.innerText()) && /פתוח/.test(await rev.innerText()), "the revenge round: the heads still standing, open");
      await shot(s, "h5-boss-revenge");
      await rev.getByRole("button", { name: "לסבב החוזר" }).click();
      await s.waitForURL((u) => u.search.includes("v=quiz"), { timeout: 15000 });
      const rq = Z.quizzes[Z.quizzes.length - 1];
      expect(B.battles[B.battles.length - 1].revenge_of === "7b200000-0000-4000-8000-000000000099" && B.battles[B.battles.length - 1].heads.length === 2, "the revenge battle: the two heads left, at full HP");
      Object.assign(rq, { state: "cancelled" });

      /* ── 8. the switch off ── */
      P.on = false;
      await go(s, "/?v=boss&new=1");
      await s.getByText("התכונה הזו כבויה כרגע בשרת.").waitFor({ timeout: 15000 });
      await go(s, "/?v=group");
      await s.getByRole("heading", { name: "שאלות פתוחות" }).waitFor({ timeout: 15000 });
      await s.waitForTimeout(800);
      expect((await s.locator(".boss-card").count()) === 0, "the switch off: no card");
      P.on = true;
    }
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, ok: ok.length, checks: ok, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, ok, steps, calls: mock.calls.slice(-25), bCalls: B.calls.slice(-10), zlog: Z.log.slice(-10) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
