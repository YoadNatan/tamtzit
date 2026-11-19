// Package J's flow (§12.5.J: J-4, J-5, J-6; wall.html s1-s3, cards.html s2)
// on the shared mock: five members in the fixture lecture.
//   1. שוהם opens the lecture's wall from its chip ("אסוציאציות"): empty.
//      From a paragraph's "אסוציאציה" (the sheet's tab) "משלי": the composer
//      with the house rule; a post by name, with "על מה זה?" required.
//   2. דניאל posts on the same paragraph without a name. נועה's wall shows
//      "בלי שם" for it (the row carries no author); her own entry has no
//      vote buttons.
//   3. Votes: נועה "מצחיק", מאיה "נתקע לי" on שוהם's; the second vote makes
//      it the would-be winner: one op wall_check (one reservation), then
//      "בגב הכרטיס של כולם", live on איתי's page. "אסוציאציית השבוע" on
//      "יחד".
//   4. Marks: איתי's "לא מדויק" takes the chip off; he lifts it and it comes
//      back. "לא מתאים" hides דניאל's from נועה, not from דניאל.
//   5. "תנו לי 3": נועה picks a paragraph; three drafts stream (one paid
//      request, "נשארו היום 5" before); מאיה opens the same paragraph and
//      sees them with no op call and no reservation; "לפרסם כמו שהיא" posts
//      the exact draft (kind draft); "רמיקס" opens the composer prefilled.
//   6. "לנעוץ רגע": שוהם reads aloud, נועה follows, and pins a moment on the
//      paragraph being read, with the slide's picture ("לצרף") and a credit
//      to איתי, which only איתי sees ("לאשר" puts his name on).
//   7. K6: under a member's answer in the paragraph's thread, "להעביר לקיר
//      האסוציאציות" opens the composer prefilled, with a credit request.
//   8. A sketch: a photo is shrunk, uploaded to <group>/wall/, posted;
//      deleting the entry removes the file.
//   9. With E2E_REVIEW=1 (a build with VITE_STUDY_CARDS_REVIEW too): a card
//      forgotten twice shows the wall's hint, and its back the "בגב" line.
// Without the wall (every set but "j" and "all") it checks that nothing of J
// shows: no "אסוציאציות" chip, no "אסוציאציה" action, ?v=wall goes to the
// lecture, nothing on "יחד", no call of section J.
//
//   NODE_PATH=$(npm root -g) node e2e/study/wall.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "j" (wave 3's
// with VITE_STUDY_WALL), "all", or a set without J.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/wall.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const REVIEW = process.env.E2E_REVIEW === "1";
const MEMBERS = ["שוהם", "נועה", "איתי", "מאיה", "דניאל"];


/** Runs fn at 390×844 and at 360×640, then puts the viewport back (the look's checks). */
async function atSizes(page, fn) {
  const vp = page.viewportSize();
  const res = [];
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400);
    res.push({ size: `${size.width}x${size.height}`, ...(await fn()) });
  }
  await page.setViewportSize(vp);
  await page.waitForTimeout(400);
  return res;
}
const boxIn = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x0: Math.round(r.left), x1: Math.round(r.right), y0: Math.round(r.top), y1: Math.round(r.bottom), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
});

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: MEMBERS });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const db = mock.db;
  db.notifyWall = mock.notify;
  db.notifyCards = mock.notify;
  const id = (name) => db.members.find((m) => m.name === name).user_id;
  const browser = await chromium.launch();
  const steps = { flags: flags.set, review: REVIEW };
  const ok = [];
  const a11y = [];
  const pages = {};
  const open = async (who, path = `/?l=${L}`) => {
    if (pages[who]) await pages[who].context().close().catch(() => undefined);
    const { page } = await mock.open(browser, who, { path });
    pages[who] = page;
    if (path.includes("?l=")) await page.locator(".summary").first().waitFor({ timeout: 20000 });
    return page;
  };
  const expect = (cond, what) => {
    if (!cond) throw new Error(what);
    ok.push(what);
  };
  const until = async (f, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await f()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out: ${what}`);
  };
  /** Taps a paragraph and one of its actions. */
  const act = async (page, sel, action) => {
    await page.locator(sel).first().click({ position: { x: 12, y: 12 } });
    const btn = page.locator(".blk-actions").getByRole("button", { name: action, exact: true });
    await btn.waitFor({ timeout: 5000 });
    await btn.click();
  };
  const MECH = `[data-part="2"] [data-blk="2"]`;
  const wallOf = (who) => open(who, `/?v=wall&l=${L}`);
  const entry = (page, text) => page.locator(".wall-entry", { hasText: text });
  const SHOHAM_BODY = "Furosemide חוסמת את NKCC2: המשאבה הכי חזקה, עד 25%.";
  const DANIEL_BODY = "Loop = הלולאה של הרכבת: הכי מהירה, הכי הרבה נוסעים יורדים.";
  // A picture on slide 6, for "גם בשקף: … · לצרף" (the moment).
  const FIG = `${db.group.id}/${L}/s6-1.jpg`;
  db.lectures[0].slides.find((s) => s.n === 6).figures = [{ k: 1, path: FIG, w: 400, h: 300 }];
  db.files.set(FIG, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  try {
    if (!flags.wall) {
      /* ── Nothing of J without its flag ── */
      const noa = await open("נועה");
      expect((await noa.locator(".wall-chip").count()) === 0 && (await noa.getByText("אסוציאציות", { exact: true }).count()) === 0, "no \"אסוציאציות\" chip in the lecture");
      await noa.locator(MECH).first().click({ position: { x: 12, y: 12 } });
      await noa.waitForTimeout(300);
      expect((await noa.locator(".blk-actions").getByRole("button", { name: "אסוציאציה", exact: true }).count()) === 0, "no \"אסוציאציה\" action on a paragraph");
      await noa.goto(`${mock.base}/?v=wall&l=${L}`);
      await noa.waitForURL((u) => !u.search.includes("v=wall"), { timeout: 15000 });
      expect(new URL(noa.url()).search.includes(`l=${L}`), "the wall's link leads to the lecture");
      await noa.goto(`${mock.base}/?v=group`);
      await noa.locator("main").first().waitFor({ timeout: 15000 });
      await noa.waitForTimeout(600);
      expect((await noa.getByText("אסוציאציית השבוע").count()) === 0, "nothing of the wall on \"יחד\"");
      expect(db.wallCalls.length === 0 && db.wallOps.length === 0, "no call of section J and no op");
    } else {
      /* ── 1. The wall from the lecture's chip; the sheet's tab; "משלי" by name ── */
      const shoham = await open("שוהם");
      await shoham.locator(".wall-chip").click();
      await shoham.waitForURL(/v=wall/, { timeout: 15000 });
      await shoham.getByText(/עוד אין אסוציאציות בהרצאה הזו/).waitFor({ timeout: 15000 });
      steps.title = (await shoham.locator(".ph-head .t").first().innerText()).trim();
      expect(/^אסוציאציות · /.test(steps.title), `the title: ${steps.title}`);
      a11y.push(...(await snap(shoham, out, "j-0-empty", { primary: ".ph-foot .a-btn.primary" })));
      await shoham.goBack();
      await shoham.locator(".summary").first().waitFor({ timeout: 15000 });
      await act(shoham, MECH, "אסוציאציה");
      const tab = shoham.locator(".k-sheet .wall-tab-panel");
      await tab.waitFor({ timeout: 10000 });
      await tab.getByText(/עוד אין אסוציאציה לפסקה הזו/).waitFor({ timeout: 10000 });
      a11y.push(...(await snap(shoham, out, "j-1-tab")));
      await tab.getByRole("button", { name: "משלי" }).click();
      await shoham.waitForURL(/x=post/, { timeout: 15000 });
      await shoham.getByLabel("האסוציאציה").fill(SHOHAM_BODY);
      await shoham.getByText("צולים את התרופה, אף פעם לא אנשים או מטופלים.").waitFor();
      await shoham.getByRole("button", { name: "לפרסם" }).click();
      await shoham.getByRole("alert").filter({ hasText: "חסרה שורת ׳על מה זה?׳" }).waitFor({ timeout: 5000 });
      expect(db.aids.length === 0, "\"על מה זה?\" is required: nothing posted without it");
      await shoham.getByLabel("על מה זה? (חובה, שיהיה מובן גם בלי הפגישה)").fill("Loop diuretics מעכבות NKCC2, עד 25% מה-Na⁺ [ש' 6]");
      await shoham.getByRole("button", { name: "Furosemide" }).click();
      a11y.push(...(await snap(shoham, out, "j-2-composer", { primary: ".ph-foot .a-btn.primary" })));
      // The paragraph chip is one inline run: "ה-NKCC2" keeps its English beside its Hebrew prefix (review J-SPOT-CHIP-GAPS).
      const spot = shoham.locator(".wall-spot");
      steps.spot = (await spot.innerText()).replace(/\s+/g, " ").trim();
      steps.spotDisplay = await spot.evaluate((el) => getComputedStyle(el).display);
      // Not a flex box (a flex item is blockified, so "block" or "inline-block"): its text and <bdi> runs share one line box.
      expect(!/flex|grid/.test(steps.spotDisplay) && steps.spot.includes("ה-NKCC2"), `the paragraph chip, one run (${steps.spotDisplay}): ${steps.spot}`);
      await shoham.getByRole("button", { name: "לפרסם" }).click();
      await shoham.waitForURL(/t=new/, { timeout: 15000 });
      await entry(shoham, "Furosemide חוסמת").waitFor({ timeout: 10000 });
      const a1 = db.aids[0];
      expect(a1 && a1.named_by === id("שוהם") && a1.drug === "furosemide" && a1.slides.join() === "6" && a1.part_idx === 2 && a1.anchor === 2, "posted by name, with its drug, slide and paragraph");

      /* ── 2. Without a name; what נועה sees ── */
      const daniel = await open("דניאל", `/?v=wall&l=${L}&at=2.2&x=post`);
      await daniel.getByLabel("האסוציאציה").fill(DANIEL_BODY);
      await daniel.getByLabel("על מה זה? (חובה, שיהיה מובן גם בלי הפגישה)").fill("Loop: המשתנים החזקים ביותר [ש' 6]");
      await daniel.getByRole("radio", { name: "בלי שם" }).click();
      await daniel.getByText("בלי שם: השם נשמר רק כדי שאפשר יהיה למחוק.").waitFor();
      await daniel.getByRole("button", { name: "לפרסם" }).click();
      await daniel.waitForURL(/t=new/, { timeout: 15000 });
      const a2 = db.aids[1];
      expect(a2 && a2.named_by === null && db.aidAuthors.some((w) => w.aid_id === a2.id && w.user_id === id("דניאל")), "no author on the shared row; the author only in the owner's table");
      const noa = await wallOf("נועה");
      await entry(noa, "הלולאה של הרכבת").waitFor({ timeout: 15000 });
      const dRow = (await entry(noa, "הלולאה של הרכבת").innerText()).replace(/\n/g, " | ");
      expect(/בלי שם/.test(dRow) && !/דניאל/.test(dRow), `"בלי שם" for דניאל's on נועה's page: ${dRow}`);
      expect((await entry(noa, "Furosemide חוסמת").innerText()).includes("שוהם"), "שוהם's by name");
      await noa.goto(`${mock.base}/?v=wall&l=${L}&at=2.3&x=post`);
      await noa.getByLabel("האסוציאציה").fill("פרמקוקינטיקה של Furosemide: לפעמים עשר, לפעמים תשעים.");
      await noa.getByLabel("על מה זה? (חובה, שיהיה מובן גם בלי הפגישה)").fill("ספיגה פומית 10-90% [ש' 6]");
      await noa.getByRole("button", { name: "לפרסם" }).click();
      await noa.waitForURL(/t=new/, { timeout: 15000 });
      const mineRow = entry(noa, "לפעמים עשר");
      await mineRow.waitFor({ timeout: 10000 });
      expect((await mineRow.locator(".wall-vote").count()) === 0 && (await entry(noa, "Furosemide חוסמת").locator(".wall-vote").count()) === 2, "no vote buttons on one's own entry, two on another's");

      /* ── 3. Votes, the check, the winner on the cards, live ── */
      const itai = await wallOf("איתי");
      await entry(itai, "Furosemide חוסמת").waitFor({ timeout: 15000 });
      await entry(noa, "Furosemide חוסמת").getByRole("button", { name: /^מצחיק/ }).click();
      await until(() => a1.funny_n === 1, 5000, "נועה's vote");
      await entry(itai, "Furosemide חוסמת").getByRole("button", { name: "מצחיק 1" }).waitFor({ timeout: 10000 });
      ok.push("a vote reaches a second page live");
      expect(db.wallOps.filter((o) => o.op === "wall_check").length === 0, "one vote: no check yet");
      const maya = await wallOf("מאיה");
      await entry(maya, "Furosemide חוסמת").getByRole("button", { name: /^נתקע לי/ }).click();
      await until(() => db.wallOps.some((o) => o.op === "wall_check" && o.answer), 10000, "the check");
      expect(db.wallOps.filter((o) => o.op === "wall_check").length === 1 && db.wallReserves.filter((r) => r.kind === "wall_check").length === 1, "the vote that makes it the would-be winner: one wall_check, one reservation");
      await entry(itai, "Furosemide חוסמת").getByText("בגב הכרטיס של כולם").waitFor({ timeout: 10000 });
      ok.push("\"בגב הכרטיס של כולם\" once checked, live on another page");
      await itai.reload();
      await entry(itai, "Furosemide חוסמת").getByText("מנצחת השבוע").waitFor({ timeout: 10000 });
      a11y.push(...(await snap(itai, out, "j-3-wall", { primary: ".ph-foot .a-btn.primary" })));
      // The votes are wall.html's small pills; the 44-px target is the kit's ::after (review J-VOTE-TEXT-TOP).
      const vote = await boxIn(entry(itai, "Furosemide חוסמת").locator(".wall-vote").first());
      const label = await entry(itai, "Furosemide חוסמת").locator(".wall-vote").first().evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const b = r.getBoundingClientRect();
        return { y0: Math.round(b.top), y1: Math.round(b.bottom) };
      });
      steps.vote = JSON.stringify({ vote, label });
      expect(vote.h <= 28 && Math.abs((label.y0 + label.y1) / 2 - (vote.y0 + vote.y1) / 2) <= 3, `the vote is a pill with its label in the middle: ${steps.vote}`);
      await itai.goto(`${mock.base}/?v=group`);
      await itai.locator(".wall-week").waitFor({ timeout: 15000 });
      expect((await itai.locator(".wall-week").innerText()).includes("Furosemide חוסמת"), "\"אסוציאציית השבוע\" on \"יחד\"");

      /* ── 4. Marks ── */
      await itai.goto(`${mock.base}/?v=wall&l=${L}`);
      const e1 = entry(itai, "Furosemide חוסמת");
      await e1.waitFor({ timeout: 15000 });
      await e1.getByRole("button", { name: "עוד פעולות" }).click();
      await e1.getByRole("button", { name: "לא מדויק" }).click();
      await e1.getByText("סומן ׳לא מדויק׳ · איתי").waitFor({ timeout: 10000 });
      expect((await e1.getByText("בגב הכרטיס של כולם").count()) === 0 && db.aidWinners.length === 0, "\"לא מדויק\" takes it off the cards");
      a11y.push(...(await snap(itai, out, "j-4-marked")));
      await e1.getByRole("button", { name: "עוד פעולות" }).click();
      await e1.getByRole("button", { name: "להסיר את הסימון" }).click();
      await e1.getByText("בגב הכרטיס של כולם").waitFor({ timeout: 10000 });
      ok.push("its marker lifts the mark, and it is back on the cards");
      const e2 = entry(itai, "הלולאה של הרכבת");
      await e2.getByRole("button", { name: "עוד פעולות" }).click();
      await e2.getByRole("button", { name: "לא מתאים" }).click();
      await e2.waitFor({ state: "detached", timeout: 10000 });
      await noa.reload();
      await entry(noa, "Furosemide חוסמת").waitFor({ timeout: 15000 });
      expect((await entry(noa, "הלולאה של הרכבת").count()) === 0, "\"לא מתאים\" hides it from נועה");
      await daniel.goto(`${mock.base}/?v=wall&l=${L}`);
      await entry(daniel, "הלולאה של הרכבת").getByText("מוסתר מהקיר: סומן ׳לא מתאים׳. אפשר לתקן או למחוק.").waitFor({ timeout: 15000 });
      ok.push("and not from its author, who reads why");

      /* ── 5. "תנו לי 3" ── */
      await noa.getByRole("button", { name: "תנו לי 3 מצחיקות" }).click();
      const pick = noa.locator(".a-sheet", { hasText: "על איזו פסקה?" });
      await pick.waitFor({ timeout: 10000 });
      a11y.push(...(await snap(noa, out, "j-5-pick")));
      await pick.getByRole("button", { name: /פרמקוקינטיקה/ }).first().click();
      await noa.waitForURL(/x=drafts/, { timeout: 15000 });
      await noa.getByText("כ-$0.02 · נשמרות לכל הקבוצה · נשארו היום 5").waitFor({ timeout: 15000 });
      a11y.push(...(await snap(noa, out, "j-6-drafts-ask")));
      await noa.locator(".wall-ask").getByRole("button", { name: "תנו לי 3 מצחיקות" }).click();
      await noa.locator(".wall-draft").nth(2).waitFor({ timeout: 15000 });
      await noa.getByRole("button", { name: "לפרסם כמו שהיא" }).first().waitFor({ timeout: 10000 });
      steps.drafts = await noa.locator(".wall-draft .a-chip").allInnerTexts();
      expect(steps.drafts.join() === "1 · משחק מילים,2 · חרוז,3 · סצנה הזויה", `three drafts, one of each technique: ${steps.drafts}`);
      expect(db.wallReserves.filter((r) => r.kind === "mnemonic").length === 1 && db.aidDrafts.length === 1, "one paid request, saved for the group");
      a11y.push(...(await snap(noa, out, "j-7-drafts")));
      const opsBefore = db.wallOps.length;
      const maya2 = await open("מאיה", `/?v=wall&l=${L}&at=2.3&x=drafts`);
      await maya2.locator(".wall-draft").nth(2).waitFor({ timeout: 15000 });
      expect(db.wallOps.length === opsBefore && db.wallReserves.filter((r) => r.kind === "mnemonic").length === 1, "a second member sees the saved drafts with no op call and no reservation");
      await maya2.getByRole("button", { name: "לפרסם כמו שהיא" }).nth(1).click();
      await maya2.waitForURL(/x=post/, { timeout: 15000 });
      expect((await maya2.getByLabel("האסוציאציה").inputValue()) === db.aidDrafts[0].drafts[1].hook && (await maya2.getByLabel("האסוציאציה").getAttribute("readonly")) !== null, "\"לפרסם כמו שהיא\": the exact draft, unchanged");
      expect((await maya2.getByLabel("על מה זה? (חובה, שיהיה מובן גם בלי הפגישה)").inputValue()) === db.aidDrafts[0].fact, "the fact prefilled from the drafts");
      await maya2.getByRole("button", { name: "לפרסם" }).click();
      await maya2.waitForURL(/t=new/, { timeout: 15000 });
      const ad = db.aids.find((a) => a.kind === "draft");
      expect(ad && ad.draft_no === 2 && ad.draft_id === db.aidDrafts[0].id, "posted as Claude's draft #2");
      await noa.getByRole("button", { name: "רמיקס" }).first().click();
      await noa.waitForURL(/x=post/, { timeout: 15000 });
      const field = noa.getByLabel("האסוציאציה");
      expect((await field.inputValue()) === db.aidDrafts[0].drafts[0].hook, "\"רמיקס\" opens the composer prefilled");
      await field.fill("Furosemide = פורה סמיך: בפה זה הימור, מעשר עד תשעים.");
      await noa.getByRole("button", { name: "לפרסם" }).click();
      await noa.waitForURL(/t=new/, { timeout: 15000 });
      const ar = db.aids.find((a) => a.kind === "remix");
      expect(ar && ar.draft_id === db.aidDrafts[0].id && ar.draft_no === 1, "a remix of draft #1");
      await entry(noa, "פורה סמיך").getByText("רמיקס לטיוטה של Claude").waitFor({ timeout: 10000 });

      /* ── 6. "לנעוץ רגע" while following ── */
      const sh = await open("שוהם");
      const nf = await open("נועה");
      await sh.getByRole("button", { name: "להקריא לקבוצה" }).click();
      await nf.getByText(/הקראה: שוהם/).waitFor({ timeout: 40000 });
      await nf.getByRole("button", { name: "לעקוב" }).click();
      await nf.getByText(/מעקב: שוהם/).waitFor({ timeout: 5000 });
      await sh.locator(MECH).evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3, behavior: "instant" }));
      await nf.waitForFunction((sel) => document.querySelector(sel)?.classList.contains("blk-marked"), MECH, { timeout: 40000 });
      // The slide's picture: a real JPEG drawn on the page, served as the stored figure.
      const fig = await nf.evaluate(async () => {
        const c = document.createElement("canvas");
        c.width = 400;
        c.height = 300;
        const g = c.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, 400, 300);
        g.strokeStyle = "#0d5c63";
        g.lineWidth = 8;
        g.beginPath();
        g.moveTo(40, 250);
        g.bezierCurveTo(60, 40, 340, 40, 360, 250);
        g.stroke();
        g.fillStyle = "#1d2128";
        g.font = "bold 28px sans-serif";
        g.fillText("NKCC2", 150, 160);
        const b = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
        return Array.from(new Uint8Array(await b.arrayBuffer()));
      });
      db.files.set(FIG, Buffer.from(fig));
      await nf.locator(".follow-bar").getByRole("button", { name: "לנעוץ רגע" }).click();
      const moment = nf.locator(".a-sheet", { hasText: "לנעוץ רגע" });
      await moment.getByText("לפסקה שמוקראת עכשיו").waitFor({ timeout: 10000 });
      await moment.getByLabel("האסוציאציה").fill("Furosemide היא האקסית: אסור לשתות לידה, ואחרי זה הכול יוצא בשתן.");
      await moment.getByLabel("על מה זה? (חובה, שיהיה מובן גם בלי הפגישה)").fill("Loop: המשתנים החזקים ביותר, עד 25% [ש' 6]");
      await moment.getByRole("button", { name: "איתי" }).click();
      await moment.getByText("רק באישור של איתי").waitFor();
      await moment.getByRole("button", { name: /לצרף/ }).click();
      await moment.locator(".wall-photo").waitFor({ timeout: 10000 });
      a11y.push(...(await snap(nf, out, "j-8-moment")));
      // "לנעוץ" at the sheet's foot with the picture attached as a thumbnail (wall.html s3; review J-MOMENT-PIN-OFFSCREEN).
      const pinAt = await atSizes(nf, async () => boxIn(moment.getByRole("button", { name: "לנעוץ", exact: true })));
      steps.pinAt = pinAt.map((b) => `${b.size}: y ${b.y0}..${b.y1} of ${b.vh}`).join("; ");
      // On screen at 390×844 without scrolling the sheet; at 360×640 the sheet scrolls to it (a sticky bar would cover its fields).
      expect(pinAt[0].y1 <= pinAt[0].vh && pinAt[0].y0 >= 0, `לנעוץ on screen at 390 (360 scrolls): ${steps.pinAt}`);
      await moment.getByRole("button", { name: "לנעוץ", exact: true }).click();
      await nf.getByText("נשלחה בקשת קרדיט לאיתי.").waitFor({ timeout: 10000 });
      const am = db.aids.find((a) => a.kind === "moment");
      expect(am && am.part_idx === 2 && am.anchor === 2 && am.figure === "fig:6-1" && am.credit_id === null && db.aidCredits.some((r) => r.aid_id === am.id && r.user_id === id("איתי")), "a moment on the paragraph being read, with the slide's picture, a credit asked");
      const it2 = await open("איתי", "/?v=group");
      await it2.locator(".wall-credit-ask").waitFor({ timeout: 15000 });
      expect((await it2.locator(".wall-credit-ask").innerText()).includes("מאת נועה"), "the credit request reaches איתי alone");
      await it2.locator(".wall-week").scrollIntoViewIfNeeded();
      a11y.push(...(await snap(it2, out, "j-9-group")));
      const ma3 = await open("מאיה", "/?v=group");
      await ma3.waitForTimeout(800);
      expect((await ma3.locator(".wall-credit-ask").count()) === 0, "no credit request on another member's page");
      await it2.locator(".wall-credit-ask").getByRole("button", { name: "לאשר" }).click();
      await it2.getByText("השם שלך מופיע עכשיו על האסוציאציה.").waitFor({ timeout: 10000 });
      await it2.goto(`${mock.base}/?v=wall&l=${L}&t=new`);
      await entry(it2, "האקסית").getByText("קרדיט: איתי").waitFor({ timeout: 15000 });
      ok.push("\"לאשר\" puts the credited name on");

      /* ── 7. K6: an answer in the thread, to the wall ── */
      const t = new Date().toISOString();
      db.comments.push({ id: "c0c00001-0000-4000-8000-000000000001", lecture_id: L, part_idx: 2, anchor: 2, quote: "", kind: "question", body: "איך זוכרים שהן החזקות?", author_id: id("שוהם"), parent_id: null, resolved: false, created_at: t });
      db.comments.push({ id: "c0c00001-0000-4000-8000-000000000002", lecture_id: L, part_idx: 2, anchor: 2, quote: "", kind: "comment", body: "חושבים על הלולאה הארוכה: עד 25% מה-Na⁺.", author_id: id("איתי"), parent_id: "c0c00001-0000-4000-8000-000000000001", resolved: false, created_at: t });
      const sk = await open("שוהם");
      await act(sk, MECH, "תגובה או שאלה");
      await sk.getByRole("button", { name: "להעביר לקיר האסוציאציות" }).click();
      await sk.waitForURL(/x=post/, { timeout: 15000 });
      expect((await sk.getByLabel("האסוציאציה").inputValue()).includes("הלולאה הארוכה") && (await sk.getByText("לתת קרדיט לאיתי?").count()) === 1, "K6: the composer prefilled with the answer, a credit to its author offered");

      /* ── 8. A sketch: shrunk, uploaded, posted; deleting removes the file ── */
      await daniel.goto(`${mock.base}/?v=wall&l=${L}&at=2.3&x=post`);
      const jpeg = await daniel.evaluate(async () => {
        const c = document.createElement("canvas");
        c.width = 4000;
        c.height = 3000;
        const g = c.getContext("2d");
        for (let i = 0; i < 400; i++) {
          g.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`;
          g.fillRect(Math.random() * 4000, Math.random() * 3000, 300, 200);
        }
        const b = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.95));
        return Array.from(new Uint8Array(await b.arrayBuffer()));
      });
      // The composer offers the photo in "צילום של שרבוט" (from the drafts' footer).
      await daniel.goto(`${mock.base}/?v=wall&l=${L}&at=2.3&x=drafts`);
      await daniel.getByRole("button", { name: "צילום של שרבוט" }).click();
      await daniel.waitForURL(/x=post/, { timeout: 15000 });
      await daniel.locator(".wall-file").setInputFiles({ name: "sketch.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg) });
      await daniel.locator(".wall-photo").waitFor({ timeout: 15000 });
      const size = await daniel.locator(".wall-photo").evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight }));
      expect(size.w === 1280 && size.h === 960, `a 4000 × 3000 photo shrunk to ${size.w} × ${size.h}`);
      await daniel.getByLabel("כיתוב").fill("שרבוט: NKCC2 כמשאבה עם שלושה פתחים.");
      await daniel.getByLabel("על מה זה? (חובה, שיהיה מובן גם בלי הפגישה)").fill("NKCC2 ב-thick ascending limb [ש' 6]");
      await daniel.getByRole("button", { name: "לפרסם" }).click();
      await daniel.waitForURL(/t=new/, { timeout: 15000 });
      const as = db.aids.find((a) => a.kind === "sketch");
      const key = as?.photo;
      expect(key && key.startsWith(`${db.group.id}/wall/`) && db.files.has(key) && db.files.get(key).length <= 600_000, `the photo in <group>/wall/, at most 600 kB (${db.files.get(key)?.length})`);
      const se = entry(daniel, "שרבוט: NKCC2");
      await se.locator("img.wall-photo").waitFor({ timeout: 10000 });
      await se.getByRole("button", { name: "עוד פעולות" }).click();
      await se.getByRole("button", { name: "מחיקה" }).click();
      await se.getByRole("button", { name: "מחיקה" }).last().click();
      await until(() => !db.files.has(key), 10000, "the file removed");
      ok.push("deleting the entry removes its photo from Storage");

      /* ── 9. The hint after two lapses, and the card's back (a build with the cards' review) ── */
      if (REVIEW && db.cardsMock) {
        const m = db.cardsMock;
        const me = id("שוהם");
        const card = {
          id: "ca2d0001-0000-4000-8000-000000000001", group_id: db.group.id, lecture_id: L, batch_id: null, version: 1, source: "ai", part_idx: 2, kind: "qa",
          front: "איזה טרנספורטר מעכבות Loop diuretics?", back: "NKCC2.", extra: "", figure: "", slides: [6], topic: "Loop diuretics", aspect: "mechanism",
          created_by: me, created_at: t, updated_by: null, updated_at: t, deleted_at: null, deleted_by: null, model: null, anchor: 2, quote: "", part_gen: null,
          trap_key: null, stale_at: null, stale_edit: null, checked_by: null, checked_at: null, opens_at: null,
        };
        m.cards.push(card);
        m.adoptions.push({ user_id: me, lecture_id: L, part_idx: 2, added_at: t });
        m.settings.set(me, { user_id: me, new_per_day: 20, retention: 0.9, home: "app", updated_at: t });
        m.states.set(`${me}:${card.id}`, { user_id: me, card_id: card.id, state: 2, step: 0, stability: 3, difficulty: 5, due: new Date(Date.now() - 3600_000).toISOString(), last_review: new Date(Date.now() - 86_400_000).toISOString(), reps: 4, lapses: 2, suspended: false, updated_at: t });
        const rv = await open("שוהם", `/?v=cards&s=l.${L}`);
        await rv.locator(".wall-hint").waitFor({ timeout: 20000 });
        steps.hint = (await rv.locator(".wall-hint").innerText()).replace(/\n/g, " | ");
        expect(/רמז מהקיר/.test(steps.hint) && /Furosemide חוסמת/.test(steps.hint), `the wall's hint on a card forgotten twice: ${steps.hint}`);
        a11y.push(...(await snap(rv, out, "j-10-hint", { primary: ".review .ph-foot .a-btn.primary" })));
        await rv.getByRole("button", { name: "להציג תשובה" }).click();
        await rv.locator(".wall-back").waitFor({ timeout: 10000 });
        steps.back = (await rv.locator(".wall-back").innerText()).replace(/\s+/g, " ").trim();
        expect(/בגב:/.test(steps.back) && steps.back.includes("Furosemide חוסמת") && /· שוהם$/.test(steps.back), `the card's back: ${steps.back}`);
        await rv.locator(".wall-back").scrollIntoViewIfNeeded();
        a11y.push(...(await snap(rv, out, "j-11-back")));
      }

      /* ── Privacy: no row sent to a member names an anonymous entry's author ── */
      const aidsOut = JSON.stringify(db.aids.map((a) => ({ named_by: a.named_by, id: a.id })));
      expect(!JSON.parse(aidsOut).some((a) => a.id === a2.id && a.named_by), "the published row of an entry without a name has no author");
      steps.wallCalls = db.wallCalls.length;
      steps.ops = db.wallOps.map((o) => `${o.op}:${o.answer}`);
      steps.reserves = db.wallReserves.map((r) => `${r.kind}:${r.ref.slice(0, 12)}`);
    }
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, ok: ok.length, checks: ok, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, ok, steps, calls: mock.calls.slice(-25), wallCalls: db.wallCalls.slice(-8).map((c) => c.fn) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
