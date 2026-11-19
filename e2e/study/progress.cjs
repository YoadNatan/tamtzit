// Packages A2 and Q-2 end to end (§12.3.A, §12.3.Q's Q-2; PS-3;
// proposal/mockups/progress-pulse.html s1 and practice.html s2), on the
// shared mock with A2's plugin (e2e/study/mocks/progress.cjs) over package
// Q's rows. Yoad's decision 1 (17 Nov 2026): no account; the member is the
// device's. Decision 3's meters: a number short of answers says how many more.
//   1. נועה, with a month of answers, opens "שלי": "ההתקדמות שלי" with her
//      counts, "הטעויות שלי" with its count, "חוזרות היום בניסוח אחר".
//   2. "ההתקדמות שלי": readiness as ranges ("{lo}–{hi}%", "טווח, לא ציון"),
//      a part still short of 20 answers with its meter ("עוד מעט תשובות",
//      "{n}/20"); the danger list with "היום", "מחר", "עוד 2 ימים" and its
//      line; "לפי היבט:" chips and the aspect meter; the calibration ring.
//      No "רצף", no flame.
//   3. "לתרגל את מה שחוזר היום": ?v=practice&s=r.<group>, "חוזרות היום";
//      the danger row's question asked in another wording ("בניסוח אחר"), a
//      miss says "חוזרת מחר בניסוח אחר"; recorded as mode "mistakes".
//   4. "הטעויות שלי" (s=m): yesterday's mistake asked in another wording
//      first, then today's as itself.
//   5. שוהם, with no answers: every place empty with its meter, never a dead
//      end; none of נועה's rows reach her phone.
// Without VITE_STUDY_PROGRESS (every set but "a5" and "all") nothing of A2
// or Q-2 shows: no rows on "שלי", ?v=progress and ?v=practice&s=r.… are
// replaced with their notice, and no progress function is called.
//
//   VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
//   VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 VITE_STUDY_QUIZ=1 VITE_STUDY_ANCHOR=1 \
//   VITE_STUDY_CORRECTIONS=1 VITE_STUDY_ASK=1 VITE_STUDY_VAR=1 VITE_STUDY_WALL=1 VITE_STUDY_MEETING=1 \
//   VITE_STUDY_GUESS=1 VITE_STUDY_PROGRESS=1 npx vite build --outDir <dist>
//   E2E_FLAGS=a5 NODE_PATH=$(npm root -g) node e2e/study/progress.cjs <dist> <out dir>
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const A2 = require("./mocks/progress.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/progress.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const MEMBERS = ["שוהם", "נועה"];
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const DAY_MIN = 24 * 60;
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const NOTICES = ["התכונה הזו עוד לא פתוחה.", "״הטעויות שלי״ עוד לא פתוחות."];

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: MEMBERS });
  mock.seedLecture();
  const { db, LECTURE_ID: L, GROUP } = mock;
  const P = db.practice;
  const shohamId = mock.people["שוהם"].user.id;
  const noaId = mock.people["נועה"].user.id;

  /* ── the rows: part 1 (Carbonic anhydrase inhibitors) answered on two days,
   *    twelve questions each time (24 first answers a day: a range); part 2
   *    (Loop diuretics) five answers (a meter); the danger list and the
   *    open mistakes on part 3's paragraphs (Thiazides) ── */
  let qn = 0;
  const question = (o) => {
    const n = ++qn;
    return {
      id: hex("a5300000", n), group_id: GROUP.id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: 1,
      kind: "mcq", difficulty: 2, vignette: "", question: `שאלת תרגול מספר ${n} על המשתנים?`, options: ["Acetazolamide", "Furosemide", "Spironolactone", "Mannitol"], slides: [4],
      topic: "Acetazolamide", aspect: "mechanism", has_key: true, model: "mock", created_by: shohamId, created_at: ago(40 * DAY_MIN - n), retired_at: null, retired_by: null, retire_note: "",
      anchor: null, quote: "", part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: null, points: [], request_id: null, ...o,
    };
  };
  const keyOf = (q) => ({ answer: 0, explanations: q.options.map((o) => `${o}: לפי השקף. [ש' ${q.slides[0]}]`), takeaway: "לפי השקפים.", whens: q.options.map(() => "") });
  const add = (...qs) => {
    for (const q of qs) {
      P.questions.push(q);
      P.keys.set(q.id, keyOf(q));
    }
    return qs;
  };
  let an = 0;
  const answer = (q, minutesAgo, correct, confidence = 2) =>
    P.answers.push({ id: hex("a5600000", ++an), user_id: noaId, question_id: q.id, choice: correct ? 0 : 1, correct, mode: "lecture", ms: 9000, confidence, answered_at: ago(minutesAgo) });

  const aspectsOf = ["mechanism", "mechanism", "mechanism", "adverse", "adverse", "adverse", "adverse", "uses", "uses", "uses", "uses", "pk"];
  const part1 = add(...aspectsOf.map((aspect, i) => question({ aspect, question: `Acetazolamide: שאלה ${i + 1} על מעכבי carbonic anhydrase?` })));
  // Two days ago and yesterday: 9 then 12 right (21 of 24), "על בטוח" on all but the three misses.
  part1.forEach((q, i) => answer(q, 2 * DAY_MIN + 30, i >= 3, i >= 3 ? 3 : 2)); // the three wrong ones were "נראה לי": no danger
  part1.forEach((q) => answer(q, DAY_MIN + 30, true, 3));
  const part2 = add(...[1, 2, 3, 4, 5].map((i) => question({ part_idx: 2, slides: [7], topic: "Furosemide", aspect: "uses", question: `Furosemide: שאלה ${i} על loop diuretics?` })));
  part2.forEach((q) => answer(q, 3 * DAY_MIN, true, 2));
  // The danger list on Thiazides (part 3): D1 wrong "על בטוח" yesterday, D2 on its paragraph (asked instead);
  // D3 wrong "על בטוח" three days ago, right "על בטוח" yesterday (back in 2 days); D4 wrong "על בטוח" today (back tomorrow).
  const th = (o) => question({ part_idx: 3, slides: [10], topic: "Thiazides", aspect: "adverse", options: ["Hypokalemia", "Hyperkalemia", "Hyponatremia only", "None"], ...o });
  const [D1, D2, D3, D4] = add(
    th({ anchor: 2, question: "Hydrochlorothiazide: איזו הפרעת אלקטרוליטים שכיחה?" }),
    th({ anchor: 2, question: "מה קורה לאשלגן תחת thiazides?" }),
    th({ anchor: 3, question: "Thiazides: מה ההשפעה על הסידן בשתן?", options: ["פוחת", "עולה", "לא משתנה", "תלוי מינון"] }),
    th({ anchor: 4, question: "Thiazides בסוכרת: מה לבדוק?", options: ["גלוקוז", "אשלגן בלבד", "שום דבר", "ליתיום"] }),
  );
  answer(D1, DAY_MIN + 10, false, 3);
  answer(D3, 3 * DAY_MIN, false, 3);
  answer(D3, DAY_MIN + 5, true, 3);
  answer(D4, 20, false, 3);
  // An open mistake from yesterday ("נראה לי", not a danger) on part 4's paragraph 2, with M2 beside it; and today's E1.
  const k = (o) => question({ part_idx: 4, slides: [13], topic: "Spironolactone", aspect: "contra", options: ["Hyperkalemia", "Hypokalemia", "Alkalosis", "None"], ...o });
  const [M1, M2, E1] = add(
    k({ anchor: 2, question: "Spironolactone עם ACE inhibitor: ממה נזהרים?" }),
    k({ anchor: 2, question: "מה הסיכון העיקרי של K⁺-sparing diuretics?" }),
    k({ anchor: 5, question: "Spironolactone: איזו תופעת לוואי הורמונלית?", options: ["Gynecomastia", "Hirsutism", "Hypothyroidism", "None"] }),
  );
  answer(M1, DAY_MIN + 15, false, 2);
  answer(E1, 15, false, 2);

  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const ok = [];
  const a11y = [];
  const pages = {};
  const expect = (cond, what) => {
    if (!cond) throw new Error(what);
    ok.push(what);
  };
  const open = async (who, path) => {
    if (pages[who]) await pages[who].context().close().catch(() => undefined);
    const { page } = await mock.open(browser, who, { path });
    pages[who] = page;
    await page.addInitScript((notices) => {
      const seen = () => {
        for (const el of document.querySelectorAll(".a-toast")) {
          const t = el.textContent || "";
          if (notices.some((n) => t.includes(n))) sessionStorage.setItem("e2e-notices", `${sessionStorage.getItem("e2e-notices") || ""}${t}\n`);
        }
      };
      new MutationObserver(seen).observe(document, { childList: true, subtree: true });
    }, NOTICES);
    await page.goto(`${mock.base}${path}`);
    await page.locator("main").first().waitFor({ timeout: 20000 });
    return page;
  };
  const noticesOf = (page) => page.evaluate(() => sessionStorage.getItem("e2e-notices") || "");
  const reads = (who) => A2.reads(db, who, GROUP.id, new Date().toISOString());

  try {
    if (!flags.progress) {
      /* ── Nothing of A2 or Q-2 without VITE_STUDY_PROGRESS ── */
      const noa = await open("נועה", "/?v=me");
      await noa.locator(".me-screen").waitFor({ timeout: 15000 });
      await noa.waitForTimeout(600);
      expect((await noa.getByText("ההתקדמות שלי").count()) === 0, "no \"ההתקדמות שלי\" on \"שלי\"");
      expect((await noa.getByText("הטעויות שלי").count()) === 0, "no \"הטעויות שלי\" on \"שלי\"");
      await noa.goto(`${mock.base}/?v=progress`);
      await noa.waitForURL((u) => !u.search.includes("v=progress"), { timeout: 15000 });
      expect(!new URL(noa.url()).search.includes("progress"), "?v=progress is replaced");
      await noa.goto(`${mock.base}/?v=practice&s=r.${GROUP.id}`);
      await noa.waitForURL((u) => !u.search.includes("s=r."), { timeout: 15000 });
      await noa.waitForTimeout(400);
      const landed = await noticesOf(noa);
      // ?v=progress → "שלי" with the general line; s=r.… → practice with the mistakes' line (with practice on), else the general one.
      expect(landed.includes("התכונה הזו עוד לא פתוחה.") && (!flags.questions || landed.includes("״הטעויות שלי״ עוד לא פתוחות.")), `each replaced route says why (${norm(landed)})`);
      expect(db.progressCalls.length === 0, "no call of section P's end or of another wording");
    } else {
      /* ── 1. "שלי" ── */
      const noa = await open("נועה", "/?v=me");
      const rows = noa.locator(".pr-me-rows");
      await rows.waitFor({ timeout: 15000 });
      const r = reads(noaId);
      const counts = { answers: r.readiness().reduce((n, x) => n + x.answers, 0), danger: r.danger(), mistakes: r.openMistakes().length, again: r.rewordings().length };
      const today = A2.dayText(r.today);
      const dueNow = counts.danger.filter((d) => d.due_day <= today).length;
      // Each question once: D1 is due on the danger list and is yesterday's open mistake too.
      const againDue = new Set([...counts.danger.filter((d) => d.due_day <= today).map((d) => d.question_id), ...r.rewordings().map((w) => w.question_id)]).size;
      expect(dueNow === 1 && counts.again === 2 && againDue === 2, `the fixture: D1 due, D1 and M1 again (${dueNow}, ${counts.again}, ${againDue})`);
      await noa.locator(".pr-me-progress .m", { hasText: "תשובות" }).waitFor({ timeout: 15000 });
      steps.me = (await rows.locator(".a-li").allInnerTexts()).map(norm);
      expect(steps.me[0].includes(`${counts.answers} תשובות ב-28 הימים האחרונים`) && steps.me[0].includes(dueNow === 1 ? "טעות ׳על בטוח׳ אחת להיום" : `${dueNow} טעויות ׳על בטוח׳ להיום`), `"ההתקדמות שלי": ${steps.me[0]}`);
      expect(steps.me[1].startsWith("הטעויות שלי") && steps.me[1].includes(`${counts.mistakes} טעויות פתוחות`), `"הטעויות שלי" with its count: ${steps.me[1]}`);
      expect(steps.me[2] && steps.me[2].includes("חוזרות היום בניסוח אחר") && steps.me[2].endsWith(String(againDue)), `what is due again today: ${steps.me[2]}`);
      expect((await noa.locator(".me-screen .links-card:not(.pr-me-rows)", { hasText: "הטעויות שלי" }).count()) === 0, "F's own \"הטעויות שלי\" link is not shown twice");
      a11y.push(...(await snap(noa, out, "a-1-me")));

      /* ── 2. "ההתקדמות שלי" ── */
      await rows.getByText("ההתקדמות שלי").click();
      await noa.locator(".progress-screen .pr-ready").waitFor({ timeout: 15000 });
      expect(new URL(noa.url()).search === "?v=progress", "the row opens ?v=progress");
      const text = norm(await noa.locator(".progress-screen").innerText());
      expect(text.includes("מוכנות לפי נושא") && text.includes("טווח, לא ציון") && text.includes("רק לך"), "the readiness head and \"רק לך\"");
      const ready = r.readiness();
      const ranged = ready.find((x) => x.part_idx === 1);
      expect(ranged && ranged.lo !== null, `part 1 has a range (${JSON.stringify(ranged)})`);
      const bars = (await noa.locator(".pr-ready .a-bars .r").allInnerTexts()).map(norm);
      steps.bars = bars;
      expect(bars[0].includes("Carbonic anhydrase inhibitors") && bars[0].includes(`${ranged.lo}–${ranged.hi}%`), `the range as text: ${bars[0]}`);
      expect(bars.some((b) => b.includes("Loop diuretics: עוד מעט תשובות") && b.includes("5/20")), "a part with 5 answers: \"עוד מעט תשובות\" and 5/20");
      expect(text.includes("טווח מופיע מ-20 תשובות לנושא. הכי קרוב: Loop diuretics, עוד 15 תשובות."), "the meter: the nearest part and how many more");
      const iStyle = await noa.locator(".pr-ready .a-bars .r").first().locator(".pr-range > i").evaluate((el) => ({ m: el.style.marginInlineStart, w: el.style.width }));
      expect(iStyle.m === `${ranged.lo}%` && iStyle.w === `${ranged.hi - ranged.lo}%`, `the bar is the range (${JSON.stringify(iStyle)})`);
      // The danger list
      const danger = r.danger();
      const dangerRows = (await noa.locator(".pr-danger-list > li").allInnerTexts()).map(norm);
      steps.danger = dangerRows;
      expect(dangerRows.length === danger.length && danger.length === 3, `three danger rows (${dangerRows.length})`);
      expect(dangerRows[0].includes("Hydrochlorothiazide") && dangerRows[0].includes("ענית ׳Hyperkalemia׳. נכון: Hypokalemia") && dangerRows[0].endsWith("היום"), `D1 due today: ${dangerRows[0]}`);
      expect(dangerRows.some((t) => t.includes("Thiazides בסוכרת") && t.endsWith("מחר")), "D4 tomorrow");
      expect(dangerRows.some((t) => t.includes("הסידן") && t.endsWith("עוד 2 ימים")), "D3 three days after its first right: in 2 days");
      expect(text.includes("חוזרות בניסוח אחר, עד פעמיים נכון ׳על בטוח׳.") && text.includes("ענית ׳על בטוח׳ וטעית"), "the danger list's words");
      const aspectText = norm(await noa.locator(".pr-aspects").innerText());
      steps.aspects = aspectText;
      const asp = r.aspects(null);
      expect(asp.filter((a) => a.bucket).every((a) => aspectText.includes(`${{ mechanism: "מנגנון פעולה", adverse: "תופעות לוואי", uses: "שימושים", contra: "התוויות נגד וזהירות" }[a.aspect]}: ${{ hot: "קשה", warm: "בינוני", cool: "יושב טוב" }[a.bucket]}`)), `"לפי היבט:" chips: ${aspectText}`);
      const waiting = asp.filter((a) => !a.bucket).sort((a, b) => b.questions - a.questions)[0];
      const AS = { mechanism: "מנגנון פעולה", contra: "התוויות נגד וזהירות", pk: "פרמקוקינטיקה" };
      expect(waiting && aspectText.includes(`היבט מופיע מ-4 שאלות. הכי קרוב: ${AS[waiting.aspect]}, עוד ${4 - waiting.questions === 1 ? "שאלה אחת" : `${4 - waiting.questions} שאלות`}.`), `the aspect meter: ${waiting && waiting.aspect} has ${waiting && waiting.questions} of 4`);
      const calText = norm(await noa.locator(".pr-calibration").innerText());
      steps.calibration = calText;
      expect(/^ב.*Carbonic anhydrase inhibitors, כשסימנת ׳על בטוח׳, צדקת ב-\d+% מהפעמים\./.test(calText.replace(/^\d+%\s*/, "")) && calText.includes("מופיע אחרי כ-20 תשובות."), `calibration names its part: ${calText}`);
      expect(!/רצף/.test(text), "no \"רצף\" anywhere (the flame is Today's)");
      await noa.evaluate(() => window.scrollTo(0, 0));
      a11y.push(...(await snap(noa, out, "a-2-progress")));
      await noa.goto(`${mock.base}/?v=progress&x=danger`);
      await noa.locator(".pr-danger-list").waitFor({ timeout: 15000 });
      await noa.waitForTimeout(400);
      const at = await noa.locator(".pr-danger").evaluate((el) => ({ top: Math.round(el.getBoundingClientRect().top), y: Math.round(scrollY), end: scrollY + innerHeight >= document.documentElement.scrollHeight - 2 }));
      expect(at.y > 0 && (at.top < 200 || at.end), `?v=progress&x=danger opens at the danger list (${JSON.stringify(at)})`);
      a11y.push(...(await snap(noa, out, "a-3-danger")));

      /* ── 3. what is due again today, in another wording ── */
      const againBtn = noa.locator(".pr-again");
      const againText = norm(await againBtn.innerText());
      expect(againText === `לתרגל את מה שחוזר היום (${againDue})`, `the button counts what is due, each once: ${againText}`);
      await againBtn.click();
      await noa.waitForURL((u) => u.search.includes(`s=r.${GROUP.id}`), { timeout: 15000 });
      await noa.locator(".practice-session .pq-options").waitFor({ timeout: 20000 });
      const head = norm(await noa.locator(".ph-head").first().innerText());
      expect(head.includes("חוזרות היום"), `the session's title: ${head}`);
      const stem1 = norm(await noa.locator(".practice-session").innerText());
      expect(stem1.includes("מה קורה לאשלגן תחת thiazides?") && (await noa.locator(".pq-again").count()) === 1, "D1 is asked as D2, its paragraph's other question, with \"בניסוח אחר\"");
      a11y.push(...(await snap(noa, out, "a-4-again-question", { primary: ".ph-foot .a-btn.primary" })));
      // A miss: pick a wrong option, "נראה לי", "לבדוק".
      const texts = await noa.locator(".pq-options button.a-opt .pq-text").evaluateAll((els) => els.map((e) => e.innerText.trim()));
      await noa.locator(".pq-options button.a-opt").nth(texts.findIndex((t) => t !== "Hypokalemia")).click();
      await noa.locator(".pq-bets").getByRole("radio", { name: "נראה לי", exact: true }).click();
      await noa.getByRole("button", { name: "לבדוק" }).click();
      await noa.locator(".pq-note").waitFor({ timeout: 15000 });
      const note = norm(await noa.locator(".pq-note").innerText());
      expect(note === "חוזרת מחר בניסוח אחר", `a miss on a paragraph with another question: "${note}"`);
      const sent = P.answers.filter((a) => a.user_id === noaId && a.question_id === D2.id).pop();
      expect(sent && sent.mode === "mistakes" && sent.confidence === 2, "recorded as \"mistakes\" with the bet");
      a11y.push(...(await snap(noa, out, "a-5-again-miss", { primary: ".ph-foot .a-btn.primary" })));
      steps.againQueue = await noa.evaluate(() => {
        const k = Object.keys(sessionStorage).find((x) => x.startsWith("study-session:") && x.includes(":r."));
        return k ? JSON.parse(sessionStorage.getItem(k)).ids : null;
      });
      expect(Array.isArray(steps.againQueue) && steps.againQueue[0] === D2.id && steps.againQueue.includes(M2.id) && !steps.againQueue.includes(M1.id) && !steps.againQueue.includes(E1.id) && !steps.againQueue.includes(D4.id),
        "r.<group>: the due danger row's wording, then yesterday's mistake's; not today's mistakes, not tomorrow's danger row");

      /* ── 4. "הטעויות שלי": yesterday's mistake in another wording first, then today's ── */
      await noa.goto(`${mock.base}/?v=me`);
      await noa.locator(".pr-me-mistakes").click();
      await noa.waitForURL((u) => u.search.includes("s=m"), { timeout: 15000 });
      await noa.locator(".practice-session .pq-options").waitFor({ timeout: 20000 });
      const queue = await noa.evaluate(() => {
        const k = Object.keys(sessionStorage).find((x) => x.startsWith("study-session:") && x.endsWith(":m|10"));
        return k ? JSON.parse(sessionStorage.getItem(k)).ids : null;
      });
      steps.mistakesQueue = queue;
      const firstDue = reads(noaId).rewordings().map((x) => x.ask_question);
      expect(Array.isArray(queue) && queue.slice(0, firstDue.length).join() === firstDue.join() && queue.includes(E1.id) && queue.indexOf(E1.id) >= firstDue.length && !queue.includes(M1.id),
        `m: the due ones in another wording first (${firstDue.length}), then today's mistakes as themselves`);
      expect(norm(await noa.locator(".ph-head").first().innerText()).includes("הטעויות שלי") && (await noa.locator(".pq-again").count()) === 1, "\"הטעויות שלי\" with \"בניסוח אחר\" on its first question");
      a11y.push(...(await snap(noa, out, "a-6-mistakes", { primary: ".ph-foot .a-btn.primary" })));

      /* ── 5. שוהם: no answers yet; every place says what it needs ── */
      const shoham = await open("שוהם", "/?v=progress");
      await shoham.locator(".progress-screen .pr-ready").waitFor({ timeout: 15000 });
      const empty = norm(await shoham.locator(".progress-screen").innerText());
      steps.empty = empty;
      expect(empty.includes("עוד אין תשובות ב-28 הימים האחרונים.") && empty.includes("עוד 20 תשובות בנושא אחד וזה כאן."), "readiness empty with its meter");
      expect(empty.includes("אין כרגע טעויות ׳על בטוח׳."), "the danger list empty, with what fills it");
      expect(empty.includes("עוד אין היבט עם 4 שאלות.") && empty.includes("כמה פעמים צדקת כשסימנת ׳על בטוח׳") && empty.includes("עוד 20."), "aspects and calibration say what they need");
      expect((await shoham.locator(".pr-empty .a-btn", { hasText: "לתרגל" }).count()) === 1, "never a dead end: \"לתרגל\"");
      expect(!empty.includes("Hydrochlorothiazide") && !empty.includes("Carbonic anhydrase inhibitors"), "none of נועה's rows on שוהם's phone");
      a11y.push(...(await snap(shoham, out, "a-7-empty")));
      await shoham.goto(`${mock.base}/?v=practice&s=r.${GROUP.id}`);
      await shoham.getByText("היום אין שאלות שחוזרות. טעות חוזרת ביום שאחרי, בניסוח אחר.").waitFor({ timeout: 15000 });
      expect(true, "an empty r.<group>: what brings a question back");
      a11y.push(...(await snap(shoham, out, "a-8-again-empty")));
      expect(db.progressCalls.every((c) => c.who === noaId || c.who === shohamId), "every progress call by a member, for herself");
      const landed = (await noticesOf(noa)) + (await noticesOf(shoham));
      expect(landed === "", `no control led to a route these flags replace (${norm(landed)})`);
    }
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, ok: ok.length, checks: ok, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, ok, steps, calls: mock.calls.slice(-25) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
