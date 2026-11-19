// Package V's flow (§12.4.V: V-3, V-4; corrections.html s1-s3) on the shared
// mock: six members in the fixture lecture.
//   1. איתי's correction to the Loop diuretics' mechanism waits; נועה
//      disagrees: "לא מסכימים" on the proposal, one line with
//      slide 6; the card opens, "מחכים לצד השני"; the correction waits.
//   2. איתי finds the card on "יחד" and writes the other side.
//   3. מאיה, דניאל and רוני back a side: while backing is open every phone
//      shows only "{n} גיבו · הגיבוי יוצג אחרי הבדיקה, מ-3", never bars, never
//      a backer's name (review SEC-10).
//   4. שוהם asks VAR (≈ $0.08 and the group's month); רוני asks at the same
//      moment and gets "נבדק עכשיו במכשיר אחר" with no second reservation
//      (review SEC-15); the verdict reaches both phones live, the bars
//      appear (three others backed), the card's backing is closed.
//   5. "לקבל": the box is pinned under the paragraph on נועה's reader, live;
//      the trap card is made; the correction waits for approval again.
//   6. The spread: מאיה had reviewed a card on that paragraph; דניאל
//      approves the correction; "עדכון בסיכום" reaches מאיה only (not the
//      author, not the approver), on "יחד" (with Today: the first row of
//      her queue, in Today's session), and "הבנתי" clears it.
//   7. A yellow card on a paragraph with no proposal, VAR, "בהרצאה נאמר
//      אחרת" with a line: no box.
//   8. The log: the corrections, the verdicts, "טעות בשקף" added,
//      removed and put back.
// Without VAR (every set but "v" and "all") it checks that nothing of V
// shows: no "יומן התיקונים", no "לא מסכימים", no "מחלוקות", and a
// card's link goes to "יחד".
//
//   NODE_PATH=$(npm root -g) node e2e/study/var.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "v" (wave 3's
// with VITE_STUDY_VAR), "all", or a set without V.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/var.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const MEMBERS = ["שוהם", "נועה", "איתי", "מאיה", "דניאל", "רוני"];

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
  const id = (name) => db.members.find((m) => m.name === name).user_id;
  const browser = await chromium.launch();
  const steps = { flags: flags.set };
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
  const MECH_TEXT = db.sections[2].markdown.split("\n\n")[2];
  const PK = `[data-part="2"] [data-blk="3"]`;
  try {
    if (!flags.var) {
      /* ── Nothing of V without its flag ── */
      const noa = await open("נועה");
      expect((await noa.getByText("יומן התיקונים").count()) === 0, "no \"יומן התיקונים\" in the lecture");
      await noa.goto(`${mock.base}/?v=group`);
      await noa.locator("main").first().waitFor({ timeout: 15000 });
      await noa.waitForTimeout(500);
      expect((await noa.getByText("מחלוקות").count()) === 0, "no \"מחלוקות\" on \"יחד\"");
      await noa.goto(`${mock.base}/?v=dispute&d=fade0001-0000-4000-8000-000000000001`);
      await noa.waitForURL((u) => !u.search.includes("v=dispute"), { timeout: 15000 });
      expect(!new URL(noa.url()).search.includes("dispute"), "a yellow card's link leads elsewhere");
      expect(db.vCalls.length === 0, "no call of section V");
      if (flags.corrections) {
        db.proposals.push(proposal(db, L, id("איתי"), MECH_TEXT));
        const n2 = await open("נועה");
        await n2.locator(`[data-part="2"] .edit-dot.pending`).first().click();
        await n2.locator(".k-proposal").waitFor({ timeout: 10000 });
        expect((await n2.getByRole("button", { name: "לא מסכימים" }).count()) === 0, "no \"לא מסכימים\" on a waiting correction");
      }
    } else {
      /* ── 1. a yellow card on a waiting correction ── */
      const p1 = proposal(db, L, id("איתי"), MECH_TEXT);
      db.proposals.push(p1);
      // A question of the group on that paragraph (the spread marks it, step 6; review SEC4-1).
      const QS = {
        id: "abcd9301-0000-4000-8000-000000009301", group_id: db.members[0].group_id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: 2, anchor: 2,
        kind: "mcq", difficulty: 2, vignette: "", question: "כמה מה-Na⁺ המסונן נספג ב-thick ascending limb?", options: ["עד 25%", "65%", "5%", "1-2%"], slides: [6], topic: "Loop diuretics", aspect: "mechanism",
        has_key: true, model: "mock", created_by: id("שוהם"), created_at: new Date(Date.now() - 86_400_000).toISOString(), retired_at: null, retired_by: null, retire_note: "", quote: "",
        part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: null, points: [], request_id: null,
      };
      db.practice.questions.push(QS);
      // מאיה reviewed a card that leans on that paragraph (the spread finds her, step 6).
      db.vStudied.push({ lecture_id: L, part_idx: 2, anchor: 2, user_id: id("מאיה"), reason: "card", at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
      const noa = await open("נועה");
      await noa.locator(`[data-part="2"] .edit-dot.pending`).first().click();
      await noa.locator(".k-proposal").waitFor({ timeout: 10000 });
      a11y.push(...(await snap(noa, out, "v-0-proposal")));
      // "לאשר" is the primary beside "לא מסכימים", on one row (corrections.html s1; review V-APPROVE-BELOW-FOLD).
      const foot = await atSizes(noa, async () => ({
        approve: await boxIn(noa.locator(".k-foot").getByRole("button", { name: "לאשר" })),
        dispute: await boxIn(noa.locator(".k-foot").getByRole("button", { name: "לא מסכימים" })),
      }));
      steps.foot = foot.map((f) => `${f.size}: לאשר x ${f.approve.x0}..${f.approve.x1} y ${f.approve.y0}..${f.approve.y1}, dispute x ${f.dispute.x0}..${f.dispute.x1} y ${f.dispute.y0}..${f.dispute.y1}`).join("; ");
      // Beside it at both sizes; on screen at 390×844 (at 360×640 the sheet's words scroll first, as every sheet's there).
      expect(
        foot.every((f) => Math.abs((f.approve.y0 + f.approve.y1) / 2 - (f.dispute.y0 + f.dispute.y1) / 2) <= 3 && f.approve.x1 <= f.dispute.x0) && foot[0].approve.y1 <= foot[0].approve.vh,
        `לאשר beside the dispute button at 390 and 360, on screen at 390: ${steps.foot}`,
      );
      await noa.getByRole("button", { name: "לא מסכימים" }).click();
      await noa.getByLabel("הטענה, בשורה אחת").fill("בשקף 6 כתוב עד 25%, לא 20-25%.");
      await noa.locator(".k-dispute").scrollIntoViewIfNeeded();
      a11y.push(...(await snap(noa, out, "v-0-form")));
      await noa.getByRole("button", { name: "לפתוח מחלוקת" }).click();
      await noa.waitForURL(/v=dispute/, { timeout: 15000 });
      await noa.locator(".v-dispute .v-claims").waitFor({ timeout: 15000 });
      await noa.getByText("מחכים לצד השני.").waitFor({ timeout: 10000 });
      const d1 = db.disputes[0];
      expect(d1 && d1.proposal_id === p1.id && p1.state === "disputed", "the card holds the correction (disputed)");
      steps.title = (await noa.locator(".ph-head .t, .ph-head h1").first().innerText()).trim();
      expect(/^מחלוקת · Loop diuretics/.test(steps.title), `the title: ${steps.title}`);
      a11y.push(...(await snap(noa, out, "v-1-opened")));

      /* ── 2. the other side, from "יחד" ── */
      const itai = await open("איתי", "/?v=group");
      await itai.locator(".v-disputes .v-dispute-row").first().waitFor({ timeout: 15000 });
      steps.groupRow = (await itai.locator(".v-disputes .v-dispute-row").first().innerText()).replace(/\n/g, " | ");
      expect(/נועה · מחכים לצד השני/.test(steps.groupRow), `"יחד" lists the open card: ${steps.groupRow}`);
      await itai.locator(".v-disputes").scrollIntoViewIfNeeded();
      a11y.push(...(await snap(itai, out, "v-2-group")));
      await itai.locator(".v-disputes .v-dispute-row").first().click();
      await itai.getByRole("button", { name: "לכתוב את הצד השני" }).click();
      await itai.getByLabel("הטענה, בשורה אחת").fill("בשקף 6 כתוב שהן החזקות ביותר, וזה מה שחשוב כאן.");
      await itai.getByRole("button", { name: "לשלוח" }).click();
      await itai.locator(".v-claims .v-claim").nth(1).waitFor({ timeout: 10000 });
      // נועה's phone shows side b live.
      await noa.locator(".v-claims .v-claim").nth(1).waitFor({ timeout: 15000 });
      expect(true, "side b reaches the opener live");

      /* ── 3. backing, without names, the total only ── */
      const backers = [["מאיה", "נועה"], ["דניאל", "איתי"], ["רוני", "איתי"]];
      for (const [who, side] of backers) {
        const pg = await open(who, `/?v=dispute&d=${d1.id}`);
        await pg.getByRole("button", { name: `לגבות את ${side}` }).click();
        await pg.getByRole("button", { name: `✓ הגיבוי שלך: ${side}` }).waitFor({ timeout: 10000 });
      }
      const roni = pages["רוני"];
      await roni.getByText("3 גיבו · הגיבוי יוצג אחרי הבדיקה, מ-3").waitFor({ timeout: 10000 });
      expect((await roni.locator(".v-backing .a-bar").count()) === 0, "no bars while backing is open (review SEC-10)");
      const text = await roni.locator("main").innerText();
      expect(!/מאיה|דניאל/.test(text), "no backer's name on the card");
      expect(db.disputes[0].version === 2, "a back leaves the published row alone");
      a11y.push(...(await snap(roni, out, "v-3-backing")));

      /* ── 4. VAR: one at a time, the verdict live, the bars after it ── */
      const shoham = await open("שוהם", `/?v=dispute&d=${d1.id}`);
      await shoham.getByRole("button", { name: "לבדוק מול השקפים", exact: true }).waitFor({ timeout: 10000 });
      steps.spendLine = (await shoham.locator(".v-var .a-muted").innerText()).trim();
      expect(/\$0\.08 · השימוש של הקבוצה החודש: \$12\.40 מתוך \$33/.test(steps.spendLine), `the spend line: ${steps.spendLine}`);
      a11y.push(...(await snap(shoham, out, "v-4-var", { primary: ".ph-foot .a-btn.primary" })));
      db.varDelayMs = 2500;
      await roni.reload();
      await roni.getByRole("button", { name: "לבדוק מול השקפים", exact: true }).waitFor({ timeout: 10000 });
      await Promise.all([shoham.getByRole("button", { name: "לבדוק מול השקפים", exact: true }).click(), roni.getByRole("button", { name: "לבדוק מול השקפים", exact: true }).click()]);
      // Whichever phone came second reads "busy" (the database orders them, not the script).
      const BUSY = "נבדק עכשיו במכשיר אחר. התוצאה תופיע כאן.";
      steps.busyOn = await Promise.any([
        roni.getByText(BUSY).first().waitFor({ timeout: 10000 }).then(() => "רוני"),
        shoham.getByText(BUSY).first().waitFor({ timeout: 10000 }).then(() => "שוהם"),
      ]);
      expect(db.vCalls.filter((c) => c.fn === "api var").length === 2, "two phones asked VAR");
      expect(db.varReserved === 1, `one reservation for two taps (${db.varReserved})`);
      await shoham.locator(".v-verdict").waitFor({ timeout: 15000 });
      await roni.locator(".v-verdict").waitFor({ timeout: 15000 });
      expect(true, "the verdict reaches the other phone live");
      steps.bars = (await shoham.locator(".v-backing .r").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
      expect(steps.bars.length === 2 && /נועה 1/.test(steps.bars[0]) && /איתי 2/.test(steps.bars[1]), `the bars after VAR: ${steps.bars.join(" / ")}`);
      expect((await shoham.getByText("ודאות: פרשנות").count()) === 1 && (await shoham.locator(".v-verdict").getByText("כתוב בשקף").count()) >= 1, "the verdict's certainty and its items");
      expect((await roni.getByRole("button", { name: /לגבות את/ }).count()) === 0, "backing closed once VAR was asked");
      await shoham.locator(".v-verdict").scrollIntoViewIfNeeded();
      a11y.push(...(await snap(shoham, out, "v-5-verdict", { primary: ".ph-foot .a-btn.primary" })));

      /* ── 5. "לקבל": the box under the paragraph, live ── */
      await noa.goto(`${mock.base}/?l=${L}`);
      await noa.locator(".summary").first().waitFor({ timeout: 20000 });
      await noa.locator(`[data-part="2"] .v-open`).first().waitFor({ timeout: 15000 });
      await shoham.getByRole("button", { name: "לקבל", exact: true }).click();
      await shoham.getByText("התקבלה").waitFor({ timeout: 10000 });
      expect(d1.state === "accepted" && d1.trap_card && (db.vTrapCards ?? []).length === 1, "accepted, with the trap card for everyone");
      expect(p1.state === "pending", "the correction waits for approval again");
      const box = noa.locator(`[data-part="2"] .v-box`).first();
      await box.waitFor({ timeout: 15000 });
      await box.scrollIntoViewIfNeeded();
      expect((await noa.locator(`[data-part="2"] .v-open`).count()) === 0, "the open card's chip gave way to the box, live");
      a11y.push(...(await snap(noa, out, "v-6-box")));

      /* ── 6. the spread: "עדכון" for מאיה only ── */
      const daniel = await open("דניאל");
      await daniel.locator(`[data-part="2"] .edit-dot.pending`).first().click();
      await daniel.getByRole("button", { name: "לאשר" }).click();
      await daniel.getByText("התיקון אושר ונשמר לכל הקבוצה.").waitFor({ timeout: 10000 });
      // On "יחד" until Today; with Today (T-1) "עדכון" is the first row of her queue, and its session shows V's card.
      const maya = await open("מאיה", flags.today ? "/" : "/?v=group");
      if (flags.today) {
        await maya.locator('.t-row[data-kind="update"]').waitFor({ timeout: 15000 });
        expect((await maya.locator('.t-row[data-kind="update"]').innerText()).includes("תוקן אחרי שלמדת"), "Today's first row: the update");
        await maya.locator(".t-start .a-btn.primary").click();
      }
      const card = maya.locator(".v-update").first();
      await card.waitFor({ timeout: 15000 });
      steps.update = (await card.innerText()).replace(/\n/g, " | ");
      expect(/עדכון בסיכום/.test(steps.update) && /תוקן אחרי שלמדת/.test(steps.update) && /תיקון: איתי · אישור: דניאל · מקור: שקף 6/.test(steps.update) && /רק לך/.test(steps.update), `the update card: ${steps.update}`);
      expect(/חזרת על כרטיסייה שנשענה על השורה הישנה/.test(steps.update), "why it reached her");
      expect(db.updates.filter((u) => !u.seen_at).length === 1 && db.updates[0].user_id === id("מאיה"), "one update, hers: not the author's or the approver's");
      await card.scrollIntoViewIfNeeded();
      a11y.push(...(await snap(maya, out, "v-7-update")));
      await card.getByRole("button", { name: "הבנתי" }).click();
      await card.waitFor({ state: "detached", timeout: 10000 });
      expect(db.updates[0].seen_at, "\"הבנתי\" marks it seen");
      // Review SEC4-1: the correction took the paragraph's question out of practice; "עדיין נכון" in the
      // paragraph's "תרגול" tab brings it back for the whole group.
      expect(QS.stale_at && QS.stale_edit === db.edits.at(-1).id, "the spread marked the paragraph's question");
      if (flags.anchor) {
        await noa.goto(`${mock.base}/?l=${L}`);
        await noa.locator(".summary").first().waitFor({ timeout: 20000 });
        const chip = noa.locator('.n-anchor[data-spot="2.2"]').getByRole("button", { name: "שאלה", exact: true });
        await chip.click({ timeout: 15000 });
        const sheet = noa.getByRole("dialog", { name: "מה יושב על הפסקה" });
        const item = sheet.locator('.n-item[data-kind="question"]');
        await item.waitFor({ timeout: 10000 });
        steps.staleItem = (await item.innerText()).replace(/\s+/g, " ").trim();
        expect(/בבדיקה אחרי תיקון בפסקה/.test(steps.staleItem) && /עדיין נכון/.test(steps.staleItem), `the marked question says why and offers עדיין נכון: ${steps.staleItem}`);
        expect((await sheet.locator(".n-start").count()) === 0, "a marked question is not in לתרגל את הפסקה");
        await item.scrollIntoViewIfNeeded();
        a11y.push(...(await snap(noa, out, "v-7b-stale")));
        await item.getByRole("button", { name: "עדיין נכון" }).click();
        await noa.getByText("סומן כנכון. השאלה חוזרת לתרגול.").waitFor({ timeout: 10000 });
        await sheet.locator(".n-start").waitFor({ timeout: 10000 });
        steps.backInPractice = (await sheet.locator(".n-start").innerText()).replace(/\s+/g, " ").trim();
        expect(steps.backInPractice === "לתרגל את הפסקה · שאלה אחת", `back in the paragraph's practice: ${steps.backInPractice}`);
        expect(!QS.stale_at && QS.checked_by === id("נועה") && (await item.locator(".n-stale").count()) === 0, "עדיין נכון cleared the mark, checked by Noa");
        await noa.keyboard.press("Escape");
      }

      /* ── 7. a card on a paragraph, "בהרצאה נאמר אחרת" ── */
      await noa.goto(`${mock.base}/?l=${L}`);
      await noa.locator(".summary").first().waitFor({ timeout: 20000 });
      await noa.locator(PK).first().click({ position: { x: 12, y: 12 } });
      await noa.locator(".blk-actions").getByRole("button", { name: "תיקון", exact: true }).click();
      await noa.getByRole("button", { name: "ביטול", exact: true }).first().click(); // the editor opened at once (two taps)
      await noa.getByRole("button", { name: "לא מסכימים" }).click();
      await noa.getByLabel("הטענה, בשורה אחת").fill("הספיגה הפומית של Furosemide היא 10-90%, לא קבועה.");
      await noa.getByRole("button", { name: "לפתוח מחלוקת" }).click();
      await noa.waitForURL(/v=dispute/, { timeout: 15000 });
      const d2 = db.disputes[1];
      expect(d2 && d2.proposal_id === null && d2.anchor === 3, "a card on the paragraph itself");
      const itai2 = await open("איתי", `/?v=dispute&d=${d2.id}`);
      await itai2.getByRole("button", { name: "לכתוב את הצד השני" }).click();
      await itai2.getByLabel("הטענה, בשורה אחת").fill("במצגת כתוב 10-90% ואין שם פירוש.");
      await itai2.getByRole("button", { name: "לשלוח" }).click();
      db.varDelayMs = 300;
      db.varVerdict = { certainty: "slide", summary: "כתוב בשקף 6: 10-90%.", on_slides: [{ text: "Oral bioavailability 10-90%", slides: [6] }], interpretation: [], listen: false, trap: null };
      await itai2.getByRole("button", { name: "לבדוק מול השקפים", exact: true }).click();
      await itai2.locator(".v-verdict").waitFor({ timeout: 15000 });
      expect((await itai2.getByText("ודאות: כתוב בשקף").count()) === 1, "a verdict the slide settles");
      expect((await itai2.getByText("הגיבוי יוצג מ-3").count()) === 1, "no backers: \"הגיבוי יוצג מ-3\"");
      await itai2.getByRole("button", { name: "בהרצאה נאמר אחרת" }).click();
      await itai2.getByLabel("מה נאמר בהרצאה (לא חובה)").fill("המרצה אמר שבפועל רוב המטופלים בסביבות 50%.");
      await itai2.getByRole("button", { name: "לשמור: בהרצאה נאמר אחרת" }).click();
      await itai2.locator(".a-callout.warn").getByText("בהרצאה נאמר אחרת").waitFor({ timeout: 10000 });
      expect(d2.state === "overridden" && d2.trap_card === null && d2.decision_note.length > 0, "overridden, with its line, no card");
      a11y.push(...(await snap(itai2, out, "v-8-override")));

      /* ── 8. the log ── */
      await noa.goto(`${mock.base}/?l=${L}`);
      await noa.locator(".summary").first().waitFor({ timeout: 20000 });
      await noa.getByText("יומן התיקונים").first().click();
      await noa.locator(".v-log-list").waitFor({ timeout: 15000 });
      expect((await noa.locator(`[data-part="2"] .v-box`).count()) === 0, "the reader is gone (the log is its own screen)");
      await noa.getByRole("button", { name: "טעות בשקף" }).click();
      await noa.getByLabel(/^שקף/).fill("6");
      await noa.getByLabel("מה לא תקין בשקף").fill("בטבלה כתוב t½ ≈ 1.5 h ל-Furosemide, ובשקף 7 כתוב 2 h.");
      await noa.getByRole("button", { name: "להוסיף ליומן" }).click();
      await noa.getByText("טעות בשקף 6").waitFor({ timeout: 10000 });
      steps.log = (await noa.locator(".v-log-list > li").allInnerTexts()).map((t) => t.replace(/\n/g, " | "));
      expect(steps.log.length === 4, `the log: two verdicts, a correction, a slide flag (${steps.log.length})`);
      expect(steps.log.some((t) => /הכרעה מול השקפים · בהרצאה נאמר אחרת/.test(t)) && steps.log.some((t) => /נועה מול איתי/.test(t)), "the verdicts with both sides");
      expect(steps.log.some((t) => /תיקון: איתי · אישור: דניאל · מקור: שקף 6/.test(t) && /ביטול/.test(t)), "the correction with \"ביטול\" (the paragraph's latest)");
      await noa.evaluate(() => window.scrollTo(0, 0));
      a11y.push(...(await snap(noa, out, "v-9-log")));
      const flagRow = noa.locator(".v-log-list > li", { hasText: "טעות בשקף 6" });
      await flagRow.getByRole("button", { name: "ביטול" }).click();
      await flagRow.getByText("הוסר: נועה").waitFor({ timeout: 10000 });
      await flagRow.getByRole("button", { name: "להחזיר" }).click();
      await flagRow.getByText(/נוסף: נועה/).waitFor({ timeout: 10000 });
      expect(db.slideFlags[0].removed_at === null, "a slide flag removed and put back in one tap");
      // The correction's undo from the log: then no "ביטול" on anything of that paragraph.
      const editRow = noa.locator(".v-log-list > li", { hasText: "תיקון: איתי" });
      await editRow.getByRole("button", { name: "ביטול" }).click();
      await noa.getByText("התיקון בוטל.").waitFor({ timeout: 10000 });
      await noa.locator(".v-log-list > li", { hasText: "ביטול של תיקון" }).waitFor({ timeout: 10000 });
      expect((await noa.locator(".v-log-list > li", { hasText: "תיקון: איתי" }).getByRole("button", { name: "ביטול" }).count()) === 0, "an undone correction offers no \"ביטול\", nor does its undo");
    }
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, ok: ok.length, checks: ok, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, ok, steps, calls: mock.calls.slice(-25), vCalls: db.vCalls.slice(-8).map((c) => c.fn) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();

/** A waiting correction by `who` (section K's row, as K's plugin keeps it). */
function proposal(db, lectureId, who, before) {
  const t = new Date().toISOString();
  return {
    id: "abcd9001-0000-4000-8000-000000009001",
    lecture_id: lectureId, part_idx: 2, anchor: 2, gen: 0, base_rev: 0, occurrence: 1, kind: "paragraph",
    before_text: before, after_text: before.replace("עד 25%", "20-25%"), note: "", source_kind: "slide", source_slides: [6], source_at: null, source_note: "",
    state: "pending", proposed_by: who, approved_by: null, aloud: false, edit_id: null, created_at: t, decided_at: null, updated_at: t, check_ok: null, check_note: null, checked_at: null,
  };
}
