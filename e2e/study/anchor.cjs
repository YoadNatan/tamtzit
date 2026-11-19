// N-2 (§12.4.N; the meeting design's N-2): the paragraph anchor end to end,
// on the shared mock with package N's plugin (e2e/study/mocks/anchor.cjs)
// over Q's and C's rows. Two members (שוהם, נועה) at 390×844, light and
// dark, a11y.cjs at every screenshot step (390 and 360 px), no page error,
// no unmocked call.
//
//   NODE_PATH=$(npm root -g) node e2e/study/anchor.cjs <dist> <out dir> [off|rel1|rel2|all|notoday]
//
// The third argument (or E2E_FLAGS) names the build's flags as mock.cjs's
// flagSetOf does; E2E_ANCHOR=1 says a release's build has VITE_STUDY_ANCHOR
// too ("all" and "notoday" have it). With the flag:
//   1  under ¶1.3 the chip row "2 שאלות · 2 כרטיסיות · תגובה" (a card placed by
//      its point's slide, one by its own anchor; the hidden question not
//      counted; the comment in the row, not the dot), and "טעית כאן פעמיים."
//      with "רק לך" for Noa only;
//   2  a chip opens "מה יושב על הפסקה" on "תרגול · 4": "של הקבוצה: 2 שאלות,
//      2 כרטיסים", her states (טעית פעמיים · עוד לא ענית · הוסתרה עד בדיקה ·
//      בחפיסה · עוד לא בחפיסה) and "לתרגל את הפסקה · 2 שאלות"; "תגובות · 1"
//      shows the thread;
//   3  "לתרגל את הפסקה" asks exactly those two questions; a wrong answer's
//      "לפסקה" opens the paragraph, marked, with "מהשאלה שטעית בה, ישר
//      לפסקה", and her chip counts the new mistake;
//   4  following Shoham's reading, Noa's rows are one dot each; the reader's
//      screen has neither;
//   5  a paragraph with only a comment: its "תרגול" says "עוד אין שאלות או
//      כרטיסים על הפסקה הזו.";
// without it: no chip row, the comment's dot as before, ?v=practice&s=p.… is
// replaced, and nothing calls section N.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out, flagArg] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/anchor.cjs <dist> <out dir> [off|rel1|rel2|k|all|notoday]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(flagArg);
// Every flag on: Today adds "השאלה חוזרת מחר." (decision 12) and WALL the sheet's "אסוציאציה" tab.
const every = flags.set === "all" || flags.set === "notoday";
const back = flags.today ? " השאלה חוזרת מחר." : "";
const PLACE_MS = 40_000; // a place update waits for its presence slot (≤ 7 s per channel)
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  const { db, LECTURE_ID: L, GROUP } = mock;
  mock.seedLecture();
  const shohamId = mock.people["שוהם"].user.id;
  const noaId = mock.people["נועה"].user.id;
  const P = db.practice;
  const C = db.cardsMock;

  /* ── the rows: part 1 of the fixture (Acetazolamide), ¶3 "שימושים … [ש' 4]" ── */
  const POINT = hex("a7200000", 1);
  P.points.push(
    { id: POINT, lecture_id: L, part_idx: 1, n: 1, kind: "indication", subject: "Acetazolamide", text: "Acetazolamide ב-acute mountain sickness.", anchor: 3, quote: "שימושים", slides: [4], red_flag: false, weight: 3, created_at: ago(60), updated_at: ago(60) },
    { id: hex("a7200000", 2), lecture_id: L, part_idx: 1, n: 2, kind: "adverse", subject: "Acetazolamide", text: "Hyperchloremic metabolic acidosis.", anchor: 6, quote: "", slides: [5], red_flag: false, weight: 2, created_at: ago(60), updated_at: ago(60) },
  );
  const question = (n, o) => ({
    id: hex("a7300000", n), group_id: GROUP.id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: 1,
    kind: "mcq", difficulty: 2, vignette: "", options: ["Acetazolamide", "Furosemide", "Spironolactone", "Mannitol"], slides: [4], topic: "Acetazolamide", aspect: "uses",
    has_key: true, model: "mock", created_by: shohamId, created_at: ago(120 - n), retired_at: null, retired_by: null, retire_note: "", anchor: null, quote: "",
    part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: null, points: [], request_id: null, ...o,
  });
  const QA = question(1, {
    kind: "case", style: "case", anchor: 3, quote: "שימושים",
    vignette: "גבר בן 34 מתכנן טרק בהרים גבוהים ומבקש טיפול מונע ל-acute mountain sickness.", question: "איזו תרופה מהשקפים מתאימה לו?",
  });
  const QB = question(2, { question: "באיזה מצב משמשת Acetazolamide לפי השקפים?", options: ["Glaucoma", "Hypertension", "Heart failure", "Edema"], points: [POINT] });
  const QH = question(3, { question: "שאלה שהוסתרה אחרי שני דגלים", anchor: 3, hidden_at: ago(30) });
  const QX = question(4, { question: "מה מנגנון הפעולה של Acetazolamide?", anchor: 2, slides: [4] });
  P.questions.push(QA, QB, QH, QX);
  for (const q of [QA, QB, QH, QX]) P.keys.set(q.id, { answer: 0, explanations: q.options.map((o) => `${o}: לפי השקף. [ש' 4]`), takeaway: "Acetazolamide ב-acute mountain sickness. [ש' 4]", whens: q.options.map(() => "") });
  P.answers.push(
    { id: hex("a7600000", 1), user_id: noaId, question_id: QA.id, choice: 1, correct: false, mode: "lecture", ms: 9000, confidence: 2, answered_at: ago(60 * 26) },
    { id: hex("a7600000", 2), user_id: noaId, question_id: QA.id, choice: 2, correct: false, mode: "lecture", ms: 8000, confidence: 2, answered_at: ago(90) },
  );
  const card = (n, o) => ({
    id: hex("a7400000", n), group_id: GROUP.id, lecture_id: L, batch_id: null, source: "ai", part_idx: 1, kind: "qa", back: "", extra: "", figure: "", slides: [4],
    topic: "Acetazolamide", aspect: "uses", model: "mock", version: 1, created_by: shohamId, created_at: ago(100 - n), updated_by: null, updated_at: ago(100 - n),
    deleted_at: null, deleted_by: null, ...o,
  });
  const C1 = card(1, { front: "באיזו מחלת גבהים משמשת Acetazolamide?", back: "acute mountain sickness" }); // placed by its point's slide
  const C2 = card(2, { kind: "cloze", front: "Acetazolamide מעכבת את ה-{{carbonic anhydrase}}.", anchor: 3 }); // its own anchor (C's end)
  C.cards.push(C1, C2);
  C.states.set(`${noaId}:${C1.id}`, { user_id: noaId, card_id: C1.id, state: 2, step: 0, stability: 3.2, difficulty: 5, due: ago(-60 * 24), last_review: ago(60 * 24), reps: 3, lapses: 1, suspended: false });
  db.comments.push(
    { id: hex("a7500000", 1), lecture_id: L, part_idx: 1, anchor: 3, quote: "שימושים", kind: "comment", body: "גם ב-metabolic alkalosis, לפי השקף.", parent_id: null, resolved: false, author_id: shohamId, created_at: ago(40) },
    { id: hex("a7500000", 2), lecture_id: L, part_idx: 1, anchor: 2, quote: "מנגנון פעולה", kind: "question", body: "למה השתן נעשה בסיסי?", parent_id: null, resolved: false, author_id: shohamId, created_at: ago(30) },
  );

  const browser = await chromium.launch();
  const steps = {};
  const failed = [];
  const a11y = [];
  const check = (name, ok, detail) => {
    steps[name] = ok ? "ok" : `FAIL ${detail ?? ""}`;
    if (!ok) failed.push(name);
  };
  const shot = async (page, name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  const search = (page) => new URL(page.url()).search;
  const until = async (fn, ms = 15000, what = "condition") => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const open = async (who, path = `/?l=${L}`) => {
    const { page } = await mock.open(browser, who, { path });
    await page.locator(".summary").first().waitFor({ timeout: 20000 });
    return page;
  };
  const row = (page, spot) => page.locator(`.n-anchor[data-spot="${spot}"]`);
  const chipTexts = (page, spot) => row(page, spot).locator(".n-chips button").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));

  try {
    if (!flags.anchor) {
      /* ── without the flag: the reader as it is ── */
      const noa = await open("נועה");
      await noa.locator('[data-part="1"] [data-blk="3"] .note-dot').waitFor({ timeout: 10000 });
      check("off: no chip row, the comment's dot in the paragraph", (await noa.locator(".n-anchor, .n-dot").count()) === 0);
      await shot(noa, "anchor-off-1-reader");
      await noa.goto(`${mock.base}/?v=practice&s=p.${L}.1.3`);
      await noa.waitForTimeout(1500);
      check("off: ?v=practice&s=p.… is replaced", !search(noa).includes("s=p."), search(noa));
      check("off: nothing calls section N", db.anchorCalls.length === 0, JSON.stringify(db.anchorCalls));
    } else {
      /* ── 1. the chip row ── */
      const noa = await open("נועה");
      await row(noa, "1.3").waitFor({ timeout: 15000 });
      await noa.locator('[data-part="1"] [data-blk="3"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
      const chips = await chipTexts(noa, "1.3");
      const mine = norm(await row(noa, "1.3").locator(".n-mine").innerText());
      check(
        "1 Noa's row under ¶1.3: 2 שאלות · 2 כרטיסיות · תגובה, the comment in the row and not the dot",
        chips.join("|") === "2 שאלות|2 כרטיסיות|תגובה" && (await noa.locator('[data-part="1"] [data-blk="3"] .note-dot').count()) === 0,
        JSON.stringify(chips),
      );
      check("1 her private line: טעית כאן פעמיים. with רק לך", mine === `טעית כאן פעמיים.${back} רק לך`, mine);
      check("1 a paragraph with a question to the group: its chip in the row", (await chipTexts(noa, "1.2")).join("|") === "שאלה|תגובה", JSON.stringify(await chipTexts(noa, "1.2")));
      await noa.locator('[data-part="1"] [data-blk="3"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
      await noa.waitForTimeout(300);
      await shot(noa, "anchor-01-chips");
      const shoham = await open("שוהם");
      await row(shoham, "1.3").waitFor({ timeout: 15000 });
      check(
        "1 Shoham sees the group's chips and no private line of Noa's",
        (await chipTexts(shoham, "1.3")).join("|") === "2 שאלות|2 כרטיסיות|תגובה" && (await shoham.locator(".n-mine").count()) === 0,
        JSON.stringify(await chipTexts(shoham, "1.3")),
      );

      /* ── 2. the sheet's "תרגול" tab ── */
      await row(noa, "1.3").getByRole("button", { name: "2 שאלות" }).click();
      const sheet = noa.getByRole("dialog", { name: "מה יושב על הפסקה" });
      await sheet.locator(".n-item").first().waitFor({ timeout: 10000 });
      const tabs = await sheet.getByRole("tab").evaluateAll((els) => els.map((e) => `${e.innerText.replace(/\s+/g, " ").trim()}${e.getAttribute("aria-selected") === "true" ? "*" : ""}`));
      const items = await sheet.locator(".n-item").evaluateAll((els) => els.map((e) => [e.querySelector(".m").innerText, e.querySelector(".a-chip").innerText].join(" / ")));
      const headLine = norm(await sheet.locator(".n-tab-head").innerText());
      const start = norm(await sheet.locator(".n-start").innerText());
      // The one frame K and N share, in anchor.html s2's order: תגובות · תיקון (K, with CORRECTIONS) · אסוציאציה (J, with WALL) · תרגול.
      const wantTabs = ["תגובות · 1", ...(flags.corrections ? ["תיקון"] : []), ...(flags.wall ? ["אסוציאציה"] : []), "תרגול · 4*"].join("|");
      check("2 the tabs: תגובות · 1, תיקון with CORRECTIONS, אסוציאציה with WALL, and תרגול · 4, on תרגול", tabs.join("|") === wantTabs, JSON.stringify(tabs));
      check("2 the group's line and her marks", headLine === "של הקבוצה: 2 שאלות, 2 כרטיסיות הסימונים רק לך", headLine);
      check(
        "2 her states: טעית פעמיים · עוד לא ענית · הוסתרה עד בדיקה · בחפיסה · עוד לא בחפיסה",
        items.join("|") === "שאלה · מקרה קליני / טעית פעמיים|שאלה / עוד לא ענית|שאלה / הוסתרה עד בדיקה|כרטיסייה / בחפיסה|כרטיסייה / עוד לא בחפיסה",
        JSON.stringify(items),
      );
      check("2 the primary action: לתרגל את הפסקה · 2 שאלות", start === "לתרגל את הפסקה · 2 שאלות", start);
      check("2 the slide tag of the paragraph in the head", norm(await sheet.locator(".k-sheet-head .a-tag").innerText()) === "ש׳ 4");
      await shot(noa, "anchor-02-tab");
      await sheet.getByRole("tab", { name: "תגובות · 1" }).click();
      await sheet.getByText("גם ב-metabolic alkalosis, לפי השקף.").waitFor({ timeout: 5000 });
      check("2 תגובות · 1 shows the paragraph's thread", (await sheet.locator(".note").count()) === 1);
      await shot(noa, "anchor-03-comments");
      await sheet.getByRole("tab", { name: "תרגול · 4" }).click();
      await sheet.locator(".n-start").waitFor({ timeout: 5000 });

      /* ── 3. "לתרגל את הפסקה": exactly those questions; a wrong answer leads back ── */
      await sheet.locator(".n-start").click();
      await until(() => search(noa).startsWith("?v=practice"), 10000, "the session");
      await noa.locator(".pq-options").waitFor({ timeout: 10000 });
      const sessionUrl = search(noa);
      const count = norm(await noa.locator(".ph-head .a-chip").first().innerText());
      const lead = norm(await noa.locator(".pq-lead").first().innerText());
      check("3 the session: p.<lecture>.1.3, all of them, two questions, the unanswered one first", sessionUrl === `?v=practice&s=p.${L}.1.3&n=all` && count === "1/2" && lead === norm(QB.question), JSON.stringify({ sessionUrl, count, lead }));
      const texts = await noa.locator(".pq-options button.a-opt .pq-text").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
      await noa.locator(".pq-options button.a-opt").nth(texts.findIndex((t) => t !== "Glaucoma")).click();
      await noa.locator(".pq-bets").getByRole("radio", { name: "נראה לי", exact: true }).click();
      await noa.locator(".ph-foot .a-btn.primary").click();
      await noa.locator(".pq-verdict").waitFor({ timeout: 10000 });
      check("3 the answer is recorded as the lecture's, wrong", P.answers.some((a) => a.user_id === noaId && a.question_id === QB.id && !a.correct && a.mode === "lecture"));
      await noa.locator(".pq-paragraph").click();
      await until(() => search(noa).startsWith(`?l=${L}`), 10000, "the paragraph");
      await noa.getByText("מהשאלה שטעית בה, ישר לפסקה").waitFor({ timeout: 5000 });
      await noa.waitForFunction(() => document.querySelector('[data-part="1"] [data-blk="3"]')?.classList.contains("blk-marked"), null, { timeout: 10000 });
      check("3 לפסקה: the lecture at ¶1.3, marked, with the toast", search(noa) === `?l=${L}&at=1.3`, search(noa));
      await shot(noa, "anchor-04-toast");
      const counted = await until(async () => norm(await row(noa, "1.3").locator(".n-mine").innerText().catch(() => "")) === `טעית כאן 3 פעמים.${back} רק לך`, 10000, "the new mistake").catch(() => false);
      check("3 her row counts the new mistake: טעית כאן 3 פעמים.", counted, await row(noa, "1.3").locator(".n-mine").innerText().catch(() => "none"));
      await noa.goBack();
      await noa.locator(".pq-verdict").waitFor({ timeout: 10000 });
      await noa.goBack();
      await noa.locator(".summary").first().waitFor({ timeout: 10000 });

      /* ── 4. following a reader: one dot; the reader's screen: nothing ── */
      await noa.goto(`${mock.base}/?l=${L}`);
      await row(noa, "1.3").waitFor({ timeout: 15000 });
      await shoham.getByRole("button", { name: "להקריא לקבוצה" }).click();
      await noa.getByRole("button", { name: "לעקוב" }).click({ timeout: PLACE_MS });
      await noa.getByText(/מעקב: שוהם/).waitFor({ timeout: 5000 });
      await noa.locator('.n-dot[data-spot="1.3"]').waitFor({ timeout: 10000 });
      check(
        "4 following: each row is one dot with its label; the reader's screen has neither",
        (await noa.locator(".n-anchor").count()) === 0 &&
          (await noa.locator('.n-dot[data-spot="1.3"]').getAttribute("aria-label")) === "על הפסקה יש שאלות, כרטיסיות או תגובות" &&
          (await shoham.locator(".n-anchor, .n-dot").count()) === 0,
      );
      await noa.locator('[data-part="1"] [data-blk="3"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
      await shot(noa, "anchor-05-following");
      await shoham.getByRole("button", { name: "לסיים", exact: true }).click();
      await noa.getByText("ההקראה הסתיימה.").waitFor({ timeout: PLACE_MS });
      await row(noa, "1.3").waitFor({ timeout: 10000 });
      check("4 after the reading the rows come back", (await noa.locator(".n-dot").count()) === 0);

      /* ── 5. a paragraph with only a comment: "תרגול" is empty ── */
      db.comments.push({ id: hex("a7500000", 3), lecture_id: L, part_idx: 1, anchor: 4, quote: "", kind: "comment", body: "הערה בלי שאלות", parent_id: null, resolved: false, author_id: shohamId, created_at: ago(1) });
      await noa.reload();
      await row(noa, "1.4").waitFor({ timeout: 15000 });
      await row(noa, "1.4").getByRole("button", { name: "תגובה" }).click();
      const sheet2 = noa.getByRole("dialog", { name: "מה יושב על הפסקה" });
      await sheet2.getByText("הערה בלי שאלות").waitFor({ timeout: 5000 });
      await sheet2.getByRole("tab", { name: "תרגול" }).click();
      await sheet2.getByText("עוד אין שאלות או כרטיסיות על הפסקה הזו.").waitFor({ timeout: 5000 });
      check("5 an empty paragraph's תרגול says so", (await sheet2.locator(".n-start").count()) === 0);
      await shot(noa, "anchor-06-empty");
      await noa.keyboard.press("Escape");
      await sheet2.waitFor({ state: "detached", timeout: 5000 });
      check("5 Escape closes the sheet and the lecture stays", search(noa) === `?l=${L}`, search(noa));
      steps.horizontalOverflow = await noa.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (steps.horizontalOverflow) failed.push("horizontalOverflow");
    }
    const unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ flags: flags.set, anchor: flags.anchor, failed, errors: problems, unmocked, steps, a11y }, null, 1));
    if (failed.length || problems.length || unmocked.length || a11y.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ steps, failed, problems: mock.problems, calls: mock.calls.slice(-25) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
