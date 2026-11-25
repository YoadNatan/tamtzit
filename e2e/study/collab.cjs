// Package K's flow (§12.3.K: KA-4, KS-3; corrections.html, ask.html) on the
// shared mock: three members in the fixture lecture.
//   1. נועה proposes a correction to a table's cell: the editor, the source
//      (mandatory), "להציע לקבוצה"; she sees "לבטל את ההצעה", never "לאשר".
//   2. שוהם sees "תיקון ממתין לאישור" live, opens it (corrections.html s1),
//      checks it against the slide, approves it: נועה's table changes live.
//   3. A second correction by שוהם with an outside source, approved by איתי;
//      "ביטול" is offered on the paragraph's latest correction only; after
//      it, on nothing (an undo is never undone).
//   4. "אישור בקול": shown only to the reader of a live reading (every flag:
//      the meeting); refused while the reading is not live; never in K's set.
//   5. "לשאול" on a paragraph, over the reader (ask.html s1's answer card),
//      then "עדיין לא ברור? לשאול את הקבוצה": the question reaches שוהם's
//      thread with Claude's attempt folded (ask.html s2).
//   6. The ask screen, "יחד"'s "תיקונים אחרונים" and the library's chip.
//   W2: in the whole run no phone wrote a part (study_sections) and the
//      grants refused nothing: corrections reach the text only through
//      section K's functions, against W2's hardened grants.
// With K's flags off (off, rel1, rel2) it checks that nothing of K shows: no
// "תיקון" or "לשאול" on a paragraph, and the thread is today's sheet (with
// N's flag, E2E_ANCHOR=1, the one frame with "תרגול" and no "תיקון").
//
//   NODE_PATH=$(npm root -g) node e2e/study/collab.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "k" (release 2's
// four and VITE_STUDY_CORRECTIONS, VITE_STUDY_ASK), "all", or a set without K.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/collab.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const varOn = flags.var; // VITE_STUDY_VAR: the every-flag build and V's set "v"
const PLACE_MS = 40_000;

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: ["שוהם", "נועה", "איתי"] });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const a11y = [];
  const pages = {};
  const open = async (who, path = `/?l=${L}`) => {
    const { page } = await mock.open(browser, who, { path });
    pages[who] = page;
    if (path.includes("?l=")) await page.locator(".summary").first().waitFor({ timeout: 20000 });
    return page;
  };
  /** Taps a block and one of its actions. */
  const act = async (page, sel, action) => {
    // click() scrolls and retries while the reader re-renders the block (a part patched live).
    await page.locator(sel).first().click({ position: { x: 12, y: 12 } });
    const btn = page.locator(".blk-actions").getByRole("button", { name: action, exact: true });
    await btn.waitFor({ timeout: 5000 });
    await btn.click();
  };
  const TABLE = `[data-part="2"] .table-wrap.blk`;
  const MECH = `[data-part="2"] p.blk >> nth=0`;
  try {
    const noa = await open("נועה");
    if (!flags.corrections && !flags.ask) {
      // Nothing of K: the paragraph's actions and today's thread sheet.
      await noa.locator(`[data-part="2"] p.blk`).first().click({ position: { x: 12, y: 12 } });
      await noa.waitForTimeout(400);
      const labels = await noa.locator(".blk-actions button, .note-add").allInnerTexts();
      steps.actions = labels;
      if (labels.some((t) => /תיקון|לשאול/.test(t))) throw new Error(`K's actions show without K's flags: ${labels.join(", ")}`);
      await noa.locator(".note-add, .blk-actions button").first().click();
      if (flags.anchor) {
        // N's flag alone: the one frame, "מה יושב על הפסקה", with N's tab and no "תיקון".
        const frame = noa.getByRole("dialog", { name: "מה יושב על הפסקה" });
        await frame.waitFor({ timeout: 5000 });
        const tabs = await frame.getByRole("tab").allInnerTexts();
        steps.sheet = `the frame: ${tabs.join(" · ")}`;
        if (tabs.some((t) => /תיקון/.test(t)) || !tabs.some((t) => /^תרגול/.test(t))) throw new Error(`the frame's tabs without K's flags: ${tabs.join(", ")}`);
      } else {
        await noa.locator('.a-sheet[aria-label="תגובות ושאלות על הפסקה"]').waitFor({ timeout: 5000 });
        steps.sheet = "today's thread sheet";
      }
      steps.kCalls = mock.db.kCalls.length;
      if (mock.db.kCalls.length) throw new Error("K's RPCs were called with K's flags off");
    } else {
      const shoham = await open("שוהם");

      /* ── 1. a proposal with a source ── */
      await act(noa, TABLE, "תיקון");
      await noa.locator(".k-editor").waitFor({ timeout: 10000 });
      const row = noa.locator(".k-cells").nth(2); // Bumetanide
      await row.locator("input").nth(2).fill("1-1.5 h");
      steps.proposeDisabledWithoutSource = await noa.getByRole("button", { name: "להציע לקבוצה" }).isDisabled();
      await noa.getByRole("radio", { name: "שקף" }).click();
      await noa.locator(".k-source-set").getByRole("button", { name: "ש׳ 6", exact: true }).click();
      await noa.getByLabel("מה תוקן (לא חובה)").fill("בשקף 6 כתוב 1-1.5 h");
      await noa.locator(".k-preview").waitFor({ timeout: 5000 });
      await noa.locator(".k-quote").first().waitFor({ timeout: 5000 });
      a11y.push(...(await snap(noa, out, "k-1-editor")));
      await noa.getByRole("button", { name: "להציע לקבוצה" }).click();
      await noa.getByText("ההצעה נשמרה.", { exact: false }).waitFor({ timeout: 10000 });
      await noa.locator(".k-proposal").waitFor({ timeout: 10000 });
      steps.proposerSees = {
        withdraw: await noa.getByRole("button", { name: "לבטל את ההצעה" }).count(),
        approve: await noa.getByRole("button", { name: "לאשר" }).count(),
      };
      if (steps.proposerSees.approve !== 0 || steps.proposerSees.withdraw !== 1) throw new Error(`the proposer's buttons: ${JSON.stringify(steps.proposerSees)}`);
      const p1 = mock.db.proposals[0];
      steps.proposal = { kind: p1.kind, source: p1.source_kind, slides: p1.source_slides, state: p1.state };
      await noa.keyboard.press("Escape");
      await noa.locator(".a-sheet").waitFor({ state: "detached", timeout: 5000 });

      /* ── 2. another member approves it ── */
      const pending = shoham.locator(`[data-part="2"] .edit-dot.pending`);
      await pending.waitFor({ timeout: 15000 });
      steps.pendingChip = (await pending.innerText()).trim();
      await pending.click(); // the chip re-renders as the store reloads: click retries until it holds
      await shoham.locator(".k-proposal").waitFor({ timeout: 10000 });
      steps.tabs = await shoham.locator(".k-tabs [role=tab]").allInnerTexts();
      if (!varOn && (await shoham.getByRole("button", { name: "לא מסכימים" }).count())) throw new Error("the yellow card shows without VAR");
      await shoham.getByRole("button", { name: /לבדוק מול השקף/ }).click();
      await shoham.locator(".k-check").waitFor({ timeout: 10000 });
      steps.fixCheck = (await shoham.locator(".k-check").innerText()).trim();
      a11y.push(...(await snap(shoham, out, "k-2-proposal")));
      await shoham.getByRole("button", { name: "לאשר" }).click();
      await shoham.getByText("התיקון אושר ונשמר לכל הקבוצה.").waitFor({ timeout: 10000 });
      await noa.locator(TABLE).getByText(/1[-\u2011]1\.5 h/).waitFor({ timeout: 15000 });
      steps.liveOnNoa = "the table changed on נועה's phone";
      await shoham.locator(".k-history").waitFor({ timeout: 10000 });
      steps.historyLine = (await shoham.locator(".k-history .k-row").first().locator(".a-small.a-muted").first().innerText()).trim();
      if (!/תיקון: נועה · אישור: שוהם · מקור: שקף 6/.test(steps.historyLine)) throw new Error(`history line: ${steps.historyLine}`);
      await shoham.keyboard.press("Escape");
      await shoham.locator(".a-sheet").waitFor({ state: "detached", timeout: 5000 });

      /* ── 3. a second correction, "ביטול" only on the latest ── */
      await act(shoham, TABLE, "תיקון");
      await shoham.getByRole("button", { name: "תיקון הטבלה" }).click();
      await shoham.locator(".k-editor").waitFor({ timeout: 10000 });
      await shoham.locator(".k-cells").nth(3).locator("input").nth(2).fill("3-6 h");
      await shoham.getByRole("radio", { name: "חיצוני" }).click();
      await shoham.getByLabel("מאיפה?").fill("הספר, פרק 15");
      await shoham.getByRole("button", { name: "להציע לקבוצה" }).click();
      await shoham.getByText("ההצעה נשמרה.", { exact: false }).waitFor({ timeout: 10000 });
      await shoham.keyboard.press("Escape");
      const itai = await open("איתי");
      await itai.locator(`[data-part="2"] .edit-dot.pending`).click({ timeout: 15000 });
      await itai.getByRole("button", { name: "לאשר" }).click();
      await itai.getByText("התיקון אושר ונשמר לכל הקבוצה.").waitFor({ timeout: 10000 });
      await noa.locator(TABLE).getByText(/3[-\u2011]6 h/).waitFor({ timeout: 15000 });
      await noa.locator(`[data-part="2"] .edit-dot`).first().click();
      await noa.locator(".k-history").waitFor({ timeout: 10000 });
      // The second correction reaches נועה's store live (Realtime, then a reload).
      await noa.waitForFunction(() => document.querySelectorAll(".k-history .k-row:not(.original)").length === 2, null, { timeout: 15000 }).catch(() => undefined);
      steps.historyRows = await noa.locator(".k-history .k-row:not(.original)").count();
      steps.undoButtons = await noa.locator(".k-history").getByRole("button", { name: "ביטול", exact: true }).count();
      if (steps.historyRows !== 2 || steps.undoButtons !== 1) throw new Error(`undo on the latest only: ${steps.historyRows} rows, ${steps.undoButtons} buttons`);
      a11y.push(...(await snap(noa, out, "k-3-history")));
      await noa.locator(".k-history").getByRole("button", { name: "ביטול", exact: true }).click();
      await noa.getByText("התיקון בוטל.").waitFor({ timeout: 10000 });
      await noa.locator(TABLE).getByText(/3[-\u2011]4 h/).waitFor({ timeout: 15000 });
      await noa.waitForFunction(() => document.querySelectorAll(".k-history .k-row.undo").length === 1, null, { timeout: 10000 });
      steps.undoButtonsAfterUndo = await noa.locator(".k-history").getByRole("button", { name: "ביטול", exact: true }).count();
      if (steps.undoButtonsAfterUndo !== 0) throw new Error("an undo is offered for an undo");
      steps.undoRpc = mock.db.kCalls.filter((c) => c.fn === "study_undo_edit").length;
      await noa.keyboard.press("Escape");
      await noa.locator(".a-sheet").waitFor({ state: "detached", timeout: 5000 });

      /* ── 4. "אישור בקול": the reader's bar, only with the meeting ── */
      await act(noa, MECH, "תיקון");
      await noa.locator(".k-editor textarea").fill("**מנגנון פעולה:** מעכבות את ה-NKCC2 ב-thick ascending limb, ולכן הן המשתנים החזקים ביותר (עד כ-25% מה-Na⁺ המסונן). [ש' 6]");
      await noa.getByRole("button", { name: "להציע לקבוצה" }).click();
      await noa.getByText("ההצעה נשמרה.", { exact: false }).waitFor({ timeout: 10000 });
      await noa.keyboard.press("Escape");
      await shoham.getByRole("button", { name: "להקריא לקבוצה" }).click();
      const mech = shoham.locator(MECH);
      await mech.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3, behavior: "instant" }));
      await shoham.waitForTimeout(1500);
      if (flags.meeting) {
        // Decision 5 (§12.4.M): "אישור בקול" shows only while two others follow the reading, as the
        // reader's card counts them (section M); package M's meeting.cjs runs it with real followers.
        const aloud = shoham.getByRole("button", { name: "אישור בקול" });
        await shoham.locator(".reader-extra .m-followers").waitFor({ timeout: PLACE_MS });
        await shoham.waitForTimeout(8000); // the reader's card has read its count at least once
        steps.aloudNotLive = (await aloud.count()) === 0 ? "hidden with nobody following" : "SHOWN with nobody following";
        if (await aloud.count()) throw new Error("\"אישור בקול\" shows with nobody following");
        // Two others follow now (section M's presence, as study_meeting_here records it).
        const M = mock.db.meetingMock;
        const meet = M.meetings.find((m) => m.reading && m.reader_id === mock.people["שוהם"].user.id);
        for (const u of [mock.people["נועה"].user.id, "00000099-0000-4000-8000-000000000099"]) M.presence.set(`${meet.id}:${u}`, { first: Date.now(), last: Date.now() });
        // The reader's card grows the sticky bar: put the paragraph back on the reading line until the card counts two.
        for (let t = Date.now(); !(await aloud.count()) && Date.now() - t < PLACE_MS; ) {
          await mech.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3, behavior: "instant" }));
          await shoham.waitForTimeout(1500);
        }
        await aloud.waitFor({ timeout: PLACE_MS });
        a11y.push(...(await snap(shoham, out, "k-8-aloud")));
        await aloud.click();
        await shoham.getByText("התיקון אושר בקול ונשמר לכל הקבוצה.").waitFor({ timeout: 10000 });
        steps.aloud = mock.db.edits.at(-1).aloud;
      } else {
        steps.aloudShown = await shoham.getByRole("button", { name: "אישור בקול" }).count();
        if (steps.aloudShown) throw new Error("\"אישור בקול\" shows without the meeting");
      }
      await shoham.getByRole("button", { name: "לסיים", exact: true }).click();

      /* ── 5. "לשאול" over the reader, then the group ── */
      if (flags.ask) {
        await act(noa, MECH, "לשאול");
        await noa.locator(".k-ask-sheet").waitFor({ timeout: 10000 });
        await noa.getByLabel("השאלה").fill("למה ה-loop הכי חזקים?");
        await noa.getByRole("button", { name: "לשאול", exact: true }).click();
        await noa.locator(".k-answer").getByText("לא מופיע בשקפים", { exact: false }).waitFor({ timeout: 15000 });
        await noa.locator(".k-answer[aria-busy=true]").waitFor({ state: "detached", timeout: 15000 });
        await noa.getByRole("button", { name: "עדיין לא ברור? לשאול את הקבוצה" }).waitFor({ timeout: 5000 });
        a11y.push(...(await snap(noa, out, "k-4-ask-sheet")));
        await noa.getByRole("button", { name: "עדיין לא ברור? לשאול את הקבוצה" }).click();
        await noa.getByText("השאלה עלתה לפסקה.").waitFor({ timeout: 10000 });
        steps.share = mock.db.comments.filter((c) => c.ask_attempt).length;
        await noa.keyboard.press("Escape");
        await noa.locator(".a-sheet").waitFor({ state: "detached", timeout: 5000 });
        // שוהם answers in the thread; Claude's attempt is folded under the question.
        // With package N's flag the paragraph's comments are a chip in its row, not the dot (anchor.html).
        const thread = shoham.locator(flags.anchor ? `[data-part="2"] .n-anchor [data-chip="comments"]` : `[data-part="2"] .note-dot`).first();
        await thread.waitFor({ timeout: 15000 });
        await thread.click();
        await shoham.locator(".k-attempt").waitFor({ timeout: 10000 });
        await shoham.getByRole("button", { name: "תשובה", exact: true }).click();
        await shoham.locator(".composer textarea").fill("תחשבו על המקטע: ב-thick ascending limb נספג כרבע מה-Na⁺, ולכן עיכוב שם מוריד הכי הרבה. [ש' 6]");
        await shoham.getByRole("button", { name: "לשלוח" }).click();
        await shoham.locator(".note.reply").first().waitFor({ timeout: 10000 });
        await shoham.getByRole("button", { name: "לסמן שנענתה" }).click();
        await shoham.getByText("סומנה שנענתה: שוהם").waitFor({ timeout: 10000 });
        await shoham.locator(".k-attempt summary").click();
        a11y.push(...(await snap(shoham, out, "k-5-thread")));
        steps.thread = { attempt: await shoham.locator(".k-attempt").count(), answered: (await shoham.locator(".thread .a-chip.ok").first().innerText()).trim() };
        await shoham.keyboard.press("Escape");

        /* ── 6a. the ask screen ── */
        const ask = await open("נועה", `/?v=ask&l=${L}`);
        await ask.locator(".k-ask-screen").waitFor({ timeout: 15000 });
        await ask.getByLabel("השאלה").fill("למה אף פעם לא נותנים Furosemide פומית בבצקת ריאות?");
        await ask.getByRole("button", { name: "לשאול", exact: true }).click();
        await ask.locator(".k-answer").getByText("לא מופיע בשקפים", { exact: false }).waitFor({ timeout: 15000 });
        await ask.locator(".k-answer[aria-busy=true]").waitFor({ state: "detached", timeout: 15000 });
        steps.askSub = (await ask.locator(".ph-sub").first().innerText()).trim();
        await ask.evaluate(() => window.scrollTo(0, 0));
        a11y.push(...(await snap(ask, out, "k-6-ask-screen")));
      }

      /* ── 6b. "יחד" and the library ── */
      await noa.goto(`${mock.base}/?v=group`);
      await noa.locator(".k-recent").waitFor({ timeout: 15000 });
      steps.recent = (await noa.locator(".k-recent .a-li").allInnerTexts()).map((t) => t.replace(/\n/g, " | "));
      await noa.locator(".k-recent").scrollIntoViewIfNeeded();
      a11y.push(...(await snap(noa, out, "k-7-group")));
      await noa.goto(`${mock.base}/?v=library`);
      await noa.locator(".k-chip").first().waitFor({ timeout: 15000 });
      steps.libraryChip = (await noa.locator(".k-chip").first().innerText()).trim();
    }
    // W2 (§3.7): every correction above reached the part through section K's
    // functions on the server; no phone wrote a part or a lecture's writing
    // state, and the grants refused nothing (the mock answers 403 42501 as
    // PostgREST does since W2).
    const partWrites = mock.calls.filter((c) => / (POST|PATCH|DELETE|PUT) \/rest\/v1\/study_sections\b/.test(c)).length;
    steps.w2 = { partWrites, refused: (mock.db.refusedWrites ?? []).length };
    if (partWrites || steps.w2.refused) mock.problems.push(`W2: a phone wrote a part directly: ${JSON.stringify(steps.w2)}`);
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, steps, calls: mock.calls.slice(-25), kCalls: mock.db.kCalls.slice(-8).map((c) => c.fn) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
