// Z-4 (spec §7.Z; design-quiz §6.5 steps 1-19 as the addendum amends them,
// §12.3.Z's ZA-4): the group quiz end to end, on six phones against the
// mock (mocks/quiz.cjs, a port of section Z's state machine with Z's end).
//
//   A  "כולנו נגד המבחן", six members: the setup from "יחד", the lobby (who is
//      in, who it waits for), the banner's "להצטרף", the shared link, a member
//      who only watches; the countdown on every phone at the server's
//      instant, Noa's clock 40 s fast; nothing of the key before a reveal; an
//      answer moves only the count; a split vote (3 of 5) argues 90 s with
//      vote 1's bars and no key, "לסבב 2", vote 2 without a bet, the reveal's
//      two rounds ("100%, היה 60%"), the round's trap, the private "−6" and
//      "הבנתי בדיון"; a flag to the group; 80%: explained at once, "הבחירה
//      שלך" on its owner's phone only; a slide tag opens the slide over the
//      reveal (URL kept) and the next countdown closes it on every phone;
//      under 30%: every player's phone opens the question's slide; nobody
//      answers: the reveal comes by itself; a locked phone comes back to the
//      right time and its answer counts; the manager's phone goes, "לקחת את
//      ניהול המבחן"; "ביטול השאלה"; the end: the team's score, 80% "עברנו" or
//      not, the record, the question that broke the group, each phone's own
//      line; "יחד" afterwards;
//   B  "מירוץ": the bet is the score, time breaks ties, the table (top three
//      and one's own place) to the race's players only; no "לחשוף עכשיו";
//      events without columns still move every screen; the banner to a
//      member outside it; the podium;
//   C  a lecture without questions (review UX-5): "ליצור שאלות ולפתוח את
//      המבחן" with practice's estimate, the lobby at once while the questions
//      stream, "להתחיל" from 5 ready, one reservation and one settlement per
//      model call;
//   D  two answers: "2 ענו" and no bars; the lobby's "השיא".
// Throughout: Z-6, no request to /api/study/ai during a quiz on questions
// already written; no page error, no unmocked call, no request to a real
// host; no route these flags replace (UX-1); a11y.cjs at every screenshot
// (light and dark, 390×844 and 360×640). The wake lock is asked for in the
// room and again after a phone comes back.
//
//   VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
//   VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 VITE_STUDY_QUIZ=1 \
//     npx vite build --outDir <dist>
//   NODE_PATH=$(npm root -g) node e2e/study/quiz.cjs <dist> <out dir> [rel2|rel1|off]
// rel2: release 2 (release 1's three and QUIZ; docs/study/quiz.md), against
// the registry this branch's SQL writes. rel1 and off: the quiz is off, so
// its routes are replaced (with the notice), and no screen calls it.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out, flagSet = process.env.E2E_FLAGS || "rel2"] = process.argv.slice(2);
if (!dist || !out || !["rel2", "rel1", "off"].includes(flagSet)) {
  console.error("usage: node e2e/study/quiz.cjs <dist> <out dir> [rel2|rel1|off]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const PRIMARY = ".ph-foot .a-btn.primary";
const L2 = "eeeeeeee-0000-4000-8000-000000000031";
const norm = (s) => String(s).replace(/[‎‏⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const LETTERS = ["א", "ב", "ג", "ד", "ה"];

/* ── the bank: twelve keyed questions on the fixture lecture (a diuretics deck made for the tests).
 * Their slides have no tables: the mock stores the fixture's slides 8, 19 and 20 with one table's
 * rows where the app keeps a list of tables (pptx.ts: string[][][]), which SlideSheet cannot draw. ── */
const ITEMS = [
  ["באיזה מקטע של הנפרון נספג רוב ה-Na+ המסונן?", ["Proximal tubule", "Thick ascending limb", "Distal convoluted tubule", "Collecting duct", "Glomerulus"], 0, 2, 0],
  ["מה המנגנון של Acetazolamide?", ["עיכוב carbonic anhydrase", "עיכוב NKCC2", "עיכוב NCC", "חסימת ENaC", "אנטגוניזם ל-aldosterone"], 0, 4, 1],
  ["איזה מעכב מבין אלה פועל על NKCC2?", ["Hydrochlorothiazide", "Furosemide", "Amiloride", "Mannitol", "Acetazolamide"], 1, 6, 2],
  ["מה שימוש מרכזי של loop diuretics?", ["Glaucoma", "בצקת ריאות חריפה", "Nephrolithiasis", "Hyperaldosteronism", "Acute mountain sickness"], 1, 7, 2],
  ["איזו תופעת לוואי מאפיינת loop diuretics?", ["Hyperkalemia", "Gynecomastia", "Ototoxicity", "Hypercalcemia", "Metabolic acidosis"], 2, 7, 2],
  ["על מה פועלות Thiazides?", ["NKCC2", "NCC", "ENaC", "Carbonic anhydrase", "Aquaporin"], 1, 9, 3],
  ["מה שימוש של Thiazides?", ["Hypertension", "בצקת מוחית", "Glaucoma", "Hyperkalemia", "Hypercalcemia"], 0, 10, 3],
  ["איזו תופעת לוואי של Thiazides מופיעה בשקפים?", ["Hypokalemia", "Hyperkalemia", "Ototoxicity", "Gynecomastia", "אבנים בכליות"], 0, 11, 3],
  ["מה מנגנון Spironolactone?", ["חסימת ENaC", "אנטגוניזם ל-mineralocorticoid receptor", "עיכוב NCC", "עיכוב NKCC2", "אוסמוטי"], 1, 12, 4],
  ["איזה משתנה ניתן IV בלבד?", ["Mannitol", "Furosemide", "Spironolactone", "Hydrochlorothiazide", "Amiloride"], 0, 15, 5],
  ["איזה שילוב מסוכן עם Digoxin?", ["Hypokalemia", "Hyperkalemia", "Hypercalcemia", "Hyperglycemia", "Hyperuricemia"], 0, 17, 6],
  ["איך משפיעות loop diuretics על Ca2+?", ["מורידות הפרשה", "מעלות הפרשה", "בלי השפעה", "רק בלילה", "רק עם Thiazides"], 1, 18, 6],
];

(async () => {
  const names = ["שוהם", "נועה", "יעל", "דנה", "מאיה", "רוני"];
  const mock = await createMock({ dist, flags: flagSet, members: names });
  const { db, LECTURE_ID: L } = mock;
  const P = db.practice;
  const Z = db.quiz;
  P.notify = mock.notify;
  Z.notify = mock.notify;
  mock.seedLecture();
  // A second lecture with no questions yet (phase C).
  db.lectures.push({ ...db.lectures[0], id: L2, title: "משתנים: הרצאה שנייה" });
  for (const s of db.sections.filter((x) => x.lecture_id === L)) db.sections.push({ ...s, lecture_id: L2 });
  const t0 = new Date().toISOString();
  ITEMS.forEach(([question, options, answer, slide, part], i) => {
    const id = `9b000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    P.questions.push({
      id, group_id: mock.GROUP.id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", part_idx: part, kind: "mcq", difficulty: 1,
      vignette: "", question, options, slides: [slide], topic: options[answer], aspect: "other", has_key: true, model: "mock", created_by: null, created_at: t0,
      retired_at: null, retired_by: null, retire_note: "",
    });
    P.keys.set(id, {
      answer,
      explanations: options.map((o, j) => (j === answer ? `${o} היא התשובה לפי השקף. [ש' ${slide}]` : `${o} לא מתאימה כאן. [ש' ${slide}]`)),
      takeaway: `${options[answer]}. [ש' ${slide}]`,
    });
  });

  // Six phones in one browser: no page may have its timers throttled as a background tab
  // (each phone shows its own page in front).
  const browser = await chromium.launch({ args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
  const steps = {};
  const a11y = [];
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const until = async (fn, ms = 15000, what = "condition") => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (await fn()) return true;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const textOf = async (page) => norm(await page.locator("body").innerText().catch(() => ""));
  const see = (page, words, ms = 15000) => until(async () => (await textOf(page)).includes(norm(words)), ms, `"${words}"`);
  const NOTICES = ["התכונה הזו עוד לא פתוחה."];
  const pages = {};
  /** A member's phone. o.skew: its clock this many ms fast (Noa's +40 s). Every phone records its
   *  wake lock requests and the replaced routes' notices (kept in sessionStorage across loads). */
  const phone = async (name, at, o = {}) => {
    const { page, ctx } = await mock.open(browser, name);
    await ctx.addInitScript(
      ({ skew, notices }) => {
        if (skew) {
          const real = Date.now.bind(Date);
          Date.now = () => real() + skew;
        }
        window.__wake = 0;
        Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => ((window.__wake += 1), { release: async () => undefined }) } });
        const seen = () => {
          for (const el of document.querySelectorAll(".a-toast")) {
            const t = el.textContent || "";
            if (notices.some((n) => t.includes(n))) sessionStorage.setItem("e2e-notices", `${sessionStorage.getItem("e2e-notices") || ""}${t}\n`);
          }
        };
        new MutationObserver(seen).observe(document, { childList: true, subtree: true });
      },
      { skew: o.skew ?? 0, notices: NOTICES },
    );
    await page.goto(mock.base + at);
    pages[name] = page;
    who.set(page, name);
    return { page, ctx };
  };
  const notices = async () => {
    let all = "";
    for (const p of Object.values(pages)) all += await p.evaluate(() => sessionStorage.getItem("e2e-notices") || "").catch(() => "");
    return all;
  };
  const quizNow = () => Z.quizzes[Z.quizzes.length - 1];
  const roundNow = (q = quizNow()) => Z.rounds.find((r) => r.quiz_id === q.id && r.idx === q.idx);
  const keyNow = () => P.keys.get(roundNow().question_id).answer;
  const optionText = (k) => P.questions.find((x) => x.id === roundNow().question_id).options[k];
  const who = new Map();
  /** Taps option i (vote 1 selects it), then a bet ("ניחוש", "נראה לי", "על בטוח"), or nothing in
   *  vote 2; done when the database (the mock) kept it (the last answer reveals at once). */
  const answer = async (page, i, bet) => {
    const uid = mock.people[who.get(page)].user.id;
    const q = quizNow();
    const r = roundNow(q);
    const vote = q.vote;
    try {
      await page.locator("button.quiz-opt").nth(i).waitFor({ timeout: 15000 });
      await until(async () => page.locator("button.quiz-opt").nth(i).isEnabled(), 15000, "the options open");
      await page.locator("button.quiz-opt").nth(i).click();
      if (bet) await page.locator(".quiz-bets button", { hasText: bet }).click({ timeout: 10000 });
      await until(async () => Z.answers.some((a) => a.round_id === r.id && a.user_id === uid && a.vote === vote), 10000, `${who.get(page)}'s answer kept`);
    } catch (e) {
      throw new Error(`${who.get(page)} could not answer round ${r.idx + 1} (vote ${vote}, quiz ${q.state}/${q.stage}): ${e.message.split("\n")[0]} | ${(await textOf(page)).slice(0, 300)}`);
    }
  };
  const question = (page) => until(async () => (await page.locator("button.quiz-opt").count()) > 0 && (await page.locator(".quiz-count").count()) === 0, 20000, "the question");
  const revealed = (page) => until(async () => (await page.locator("li.quiz-opt").count()) > 0, 35000, "the reveal");
  const next = async (page) => {
    await page.locator(PRIMARY, { hasText: /לשאלה הבאה|לסיום המבחן/ }).click();
  };
  const aiBefore = () => db.calls.filter((c) => c.startsWith("api POST /api/study/ai")).length;

  try {
    if (flagSet !== "rel2") {
      /* ── the quiz is off: its routes are replaced, with the notice; nothing calls it ── */
      const { page } = await phone("שוהם", `/?v=quiz&new=1&l=${L}`);
      await page.locator(".a-toast", { hasText: "התכונה הזו עוד לא פתוחה." }).waitFor({ timeout: 15000 });
      const search = new URL(page.url()).search;
      check("off: the setup is replaced by the lecture's practice (or the lecture), with the notice", search === `?v=practice&l=${L}` || search === `?l=${L}`, search);
      await page.goto(`${mock.base}/?v=group`);
      await page.locator("h1", { hasText: "יחד" }).waitFor({ timeout: 15000 });
      const calls = db.calls.filter((c) => /study_quiz_/.test(c));
      check("off: no quiz card, no banner line, no quiz call", (await page.locator(".quiz-card").count()) === 0 && calls.length === 0, JSON.stringify(calls));
      a11y.push(...(await snap(page, out, `quiz-${flagSet}-group`)));
    } else {
      /* ═════════ A. "כולנו נגד המבחן" on six phones ═════════ */
      const aiAtStart = aiBefore();
      // A1: Shoham opens "יחד" → "מבחן קבוצתי חדש".
      const { page: shoham, ctx: shohamCtx } = await phone("שוהם", "/?v=group");
      await shoham.locator(".quiz-card a", { hasText: "מבחן קבוצתי חדש" }).click();
      await see(shoham, "מבחן קבוצתי חדש");
      await see(shoham, "12 שאלות");
      const setupText = await textOf(shoham);
      check(
        "1 the setup: the lecture with its 12 questions, the default mode, no cost",
        setupText.includes("המבחן לא עולה מהתקציב: השאלות כבר כתובות.") &&
          (await shoham.locator(".quiz-mode[aria-checked=true]").innerText()).includes("כולנו נגד המבחן") &&
          setupText.includes("בלי טבלה: ניקוד ההימור רק לך. 80% זה ׳עברנו׳.") &&
          setupText.includes("נקודות וטבלה לשחקני המירוץ, רק במשחק."),
        setupText.slice(0, 400),
      );
      await shoham.locator("label.a-choice", { hasText: "משתנים (Diuretics)" }).locator("input").check();
      await shoham.locator('[aria-labelledby="qs-count"] button', { hasText: /^10$/ }).click();
      await shoham.locator('[aria-labelledby="qs-time"] button', { hasText: /^20$/ }).click();
      await see(shoham, "10 שאלות · בערך 8 דקות");
      // The count shown selected is the one the quiz asks for, never a disabled one (review LOOK-5).
      const counts = await shoham.locator('[aria-labelledby="qs-count"] button').evaluateAll((els) => els.map((e) => [e.innerText.trim(), e.getAttribute("aria-checked"), e.disabled]));
      check(
        "1 the counts: 10 selected; 15 and 20 above the 12 ready are off; הכול (12) offered",
        JSON.stringify(counts) === JSON.stringify([["5", "false", false], ["10", "true", false], ["הכול", "false", false], ["15", "false", true], ["20", "false", true]]),
        JSON.stringify(counts),
      );
      a11y.push(...(await snap(shoham, out, "quiz-1-setup", { primary: PRIMARY })));
      await shoham.locator(PRIMARY, { hasText: "פתיחת המבחן" }).click();
      await see(shoham, "ממתינים להתחלה");
      const quiz = quizNow();
      check("1 the lobby: the quiz is open, Shoham manages it, no record yet", /[?&]q=/.test(shoham.url()) && (await shoham.locator(".quiz-people li", { hasText: "שוהם" }).innerText()).includes("ניהול") && !(await textOf(shoham)).includes("השיא"), shoham.url());

      // A2: Noa's library (her clock 40 s fast) shows the banner within 2 s; "להצטרף" joins.
      const { page: noa } = await phone("נועה", "/?v=library", { skew: 40_000 });
      const banner = noa.locator(".live-banner .live-text");
      const t2 = Date.now();
      await until(async () => norm(await banner.innerText().catch(() => "")).includes("מבחן קבוצתי פתוח · בפנים: שוהם"), 6000, "Noa's banner");
      check("2 Noa's banner: \"מבחן קבוצתי פתוח · בפנים: שוהם\" (within 2 s of her page's start)", Date.now() - t2 < 4000, `${Date.now() - t2} ms`);
      await noa.locator(".live-banner a", { hasText: "להצטרף" }).click();
      await see(noa, "ממתינים להתחלה");
      await until(async () => (await shoham.locator(".quiz-people li", { hasText: "נועה" }).count()) === 1, 5000, "Noa in Shoham's lobby");
      check("2 both lobbies list Noa", (await noa.locator(".quiz-people li", { hasText: "נועה" }).count()) === 1, "");

      // A3: Yael, Maya and Roni open the shared link and join; Dana opens it and watches.
      const link = `/?v=quiz&q=${quiz.id}`;
      const { page: yael, ctx: yaelCtx } = await phone("יעל", link);
      const { page: maya } = await phone("מאיה", link);
      const { page: roni } = await phone("רוני", link);
      const { page: dana } = await phone("דנה", link);
      for (const p of [yael, maya, roni]) {
        await p.locator(PRIMARY, { hasText: "להצטרף למבחן" }).click();
        await until(async () => (await p.locator(PRIMARY, { hasText: "להצטרף למבחן" }).count()) === 0, 8000, "joined");
      }
      await see(dana, "צופים במבחן");
      await see(dana, "אפשר גם רק לצפות.");
      await until(async () => (await textOf(shoham)).includes("5 מתוך 6") && (await textOf(shoham)).includes("מחכים לדנה"), 8000, "the lobby's count");
      check("3 the link: three join, Dana watches; the lobby says 5 מתוך 6 and waits for Dana", true);
      a11y.push(...(await snap(shoham, out, "quiz-2-lobby", { primary: PRIMARY })));
      a11y.push(...(await snap(dana, out, "quiz-2b-watching", { primary: PRIMARY })));

      // A4: "להתחיל": "3" then the question on every phone at the server's instant (Noa's clock +40 s).
      // Each page notes the moment its first option is drawn, on the real clock (performance's,
      // which Noa's skewed Date.now does not move).
      for (const p of [shoham, noa, yael])
        await p.evaluate(() => {
          window.__shown = 0;
          const mo = new MutationObserver(() => {
            if (!window.__shown && document.querySelector("button.quiz-opt")) {
              window.__shown = performance.timeOrigin + performance.now();
              mo.disconnect();
            }
          });
          mo.observe(document.body, { childList: true, subtree: true });
        });
      await shoham.locator(PRIMARY, { hasText: "להתחיל" }).click();
      await see(noa, "מתחילים…", 5000);
      for (const p of [shoham, noa, yael]) await until(async () => (await p.evaluate(() => window.__shown)) > 0, 10000, "the first question");
      const opensAt = Date.parse(roundNow().opens_at);
      const late = [];
      for (const p of [shoham, noa, yael]) late.push(Math.round((await p.evaluate(() => window.__shown)) - opensAt));
      check("4 the question appears on each phone within 300 ms of the server's opening, Noa's too (clock +40 s)", late.every((d) => d > -150 && d < 300), late.join(","));
      const clocks = await Promise.all([shoham, noa, yael].map((p) => p.locator(".quiz-clock").innerText()));
      const secs = clocks.map((c) => Number(norm(c).split(":")[1]));
      check("4 the timers agree to the second", Math.max(...secs) - Math.min(...secs) <= 1, clocks.join(" "));
      check("18 the wake lock was asked for in the room", (await noa.evaluate(() => window.__wake)) >= 1);

      /* Round 1: 3 of 5 right (60%) → the group argues, then votes again. */
      const k1 = keyNow();
      const wrong1 = (k1 + 1) % 5;
      // The approved question screen: Yael has chosen an option, the bet row waits (and passes a11y).
      await yael.locator("button.quiz-opt").nth(k1).click();
      await until(async () => (await yael.locator(".quiz-picked").count()) === 1 && (await yael.locator(".quiz-bets button:enabled").count()) === 3, 3000, "the bet row");
      check("4 a member who has not answered sees no bottom bar (no empty strip; review LOOK-6)", (await yael.locator(".ph-foot").count()) === 0, String(await yael.locator(".ph-foot").count()));
      a11y.push(...(await snap(yael, out, "quiz-2c-question", { primary: undefined })));
      const stateCalls = () => db.calls.filter((c) => c.startsWith("שוהם POST /rest/v1/rpc/study_quiz_state")).length;
      const before6 = stateCalls();
      await answer(noa, wrong1, "על בטוח");
      await see(noa, "התשובה נקלטה.", 5000);
      await until(async () => (await textOf(shoham)).includes("ענו 1 מתוך 5"), 4000, "the count on Shoham's phone");
      await new Promise((ok) => setTimeout(ok, 1000));
      check("6 Noa's answer: \"התשובה נקלטה.\"; the others see \"ענו 1 מתוך 5\" with no request (only the count moved)", stateCalls() === before6, `${stateCalls() - before6} state reads`);
      await answer(maya, wrong1, "נראה לי");
      await answer(shoham, k1, "על בטוח");
      await answer(yael, k1, "ניחוש");
      // The privacy of the open round, before it is revealed (step 5).
      const leaks = Z.bodies
        .filter((b) => b.fn === "study_quiz_state")
        .map((b) => JSON.parse(b.body))
        .filter((s) => s && s.quiz.state === "question")
        .filter((s) => s.round && ["answer", "explanations", "takeaway", "counts", "right", "trap"].some((k) => k in s.round));
      const tables = db.calls.filter((c) => /\/rest\/v1\/(study_quiz_rounds|study_quiz_answers|study_quiz_players|study_question_keys)/.test(c));
      check("5 before a reveal no response carries the key, the explanations or the counts, and no request reads the quiz's private tables", leaks.length === 0 && tables.length === 0, JSON.stringify({ leaks: leaks.length, tables }));
      await answer(roni, k1, "נראה לי");
      await see(noa, "חצויה: 90 שניות לשכנע");
      const argueText = await textOf(noa);
      const left = /הסבב השני נפתח בעוד (\d):(\d\d)/.exec(argueText);
      const argueLeaks = Z.bodies.map((b) => JSON.parse(b.body)).filter((s) => s && s.quiz && s.quiz.stage === "argue" && s.round && "answer" in s.round);
      check(
        "ZA-4 a split round (3 of 5) argues: vote 1's bars without the key, 90 s, and no key on any phone",
        argueText.includes("סבב 1 · עונים לבד") && left && Number(left[1]) * 60 + Number(left[2]) >= 80 && (await noa.locator(".quiz-bars li").count()) === 2 && (await noa.locator(".quiz-bars .ok").count()) === 0 && argueLeaks.length === 0,
        argueText.slice(0, 300),
      );
      a11y.push(...(await snap(noa, out, "quiz-3-argue")));
      await shoham.locator(PRIMARY, { hasText: "לסבב 2" }).click();
      await see(noa, "סבב 2 · אחרי הוויכוח");
      await question(noa);
      check("ZA-4 vote 2: no bet row, the note", (await noa.locator(".quiz-bets").count()) === 0 && (await textOf(noa)).includes("בסבב 2 אין הימור: נספר ההימור של הסבב הראשון."));
      for (const p of [noa, maya, shoham, yael, roni]) await answer(p, k1, null);
      await revealed(noa);
      const r1 = await textOf(noa);
      check(
        "ZA-4 the reveal after the revote: both rounds' bars, \"100%, היה 60%\", the trap, the private −6 and \"הבנתי בדיון\"",
        r1.includes("סבב 1 · עונים לבד") &&
          r1.includes("סבב 2 · אחרי הוויכוח") &&
          r1.includes("100%, היה 60%") &&
          norm(await noa.locator("li.quiz-opt").nth(wrong1).innerText()).includes("המלכודת של הסבב") &&
          r1.includes("׳על בטוח׳: −6 · נשמר רק אצלך.") &&
          r1.includes("בסבב 2: נכון · הבנתי בדיון"),
        r1.slice(0, 500),
      );
      await see(maya, "׳נראה לי׳: −2 · נשמר רק אצלך.");
      await revealed(dana);
      const d1 = await textOf(dana);
      check("ZA-4 a member who watches sees the key and the explanations, never the counts, the trap or anyone's choice", (await dana.locator(".quiz-bars").count()) === 0 && !d1.includes("המלכודת של הסבב") && !d1.includes("הבחירה שלך") && d1.includes("התשובה הנכונה"), d1.slice(0, 300));
      a11y.push(...(await snap(noa, out, "quiz-4-revote", { primary: undefined })));
      // Step 8: Noa flags the question.
      await noa.getByRole("button", { name: "משהו לא בסדר בשאלה?" }).click();
      const flagSheet = noa.getByRole("dialog", { name: "מה לא בסדר בשאלה?" });
      await flagSheet.locator("input[type=radio]").first().check();
      await flagSheet.getByRole("button", { name: "שליחה לקבוצה" }).click();
      await noa.locator(".a-toast", { hasText: "נשלח לקבוצה." }).waitFor({ timeout: 8000 });
      check("8 \"משהו לא בסדר בשאלה?\" → the flag goes to the group", P.flags.some((f) => f.question_id === roundNow().question_id && f.user_id === mock.people["נועה"].user.id));

      /* Round 2: 4 of 5 right (80%) → explained at once. */
      await next(shoham);
      await question(noa);
      const k2 = keyNow();
      await answer(noa, k2, "נראה לי");
      await answer(shoham, k2, "נראה לי");
      await answer(yael, k2, "ניחוש");
      await answer(maya, k2, "על בטוח");
      await answer(roni, (k2 + 2) % 5, "ניחוש");
      await revealed(roni);
      const r2 = await textOf(roni);
      const mine = async (p) => (await p.locator("li.quiz-opt .quiz-mark", { hasText: "הבחירה שלך" }).count()) > 0;
      check(
        "7 80% is explained at once: \"4 מתוך 5 ענו נכון\", the counts as text, \"הבחירה שלך\" on its owner's phone only",
        r2.includes("4 מתוך 5 ענו נכון") && (await roni.locator("li.quiz-opt.wrong .quiz-mark", { hasText: "✗ הבחירה שלך" }).count()) === 1 && !(await mine(dana)) && r2.includes("זה הזמן לדבר על השאלה"),
        r2.slice(0, 400),
      );
      a11y.push(...(await snap(roni, out, "quiz-5-reveal", { primary: undefined })));
      // UX-4: a slide tag opens the slide over the reveal, the URL stays; the next countdown closes it.
      const urlBefore = noa.url();
      await noa.locator("li.quiz-opt .src-link").first().click();
      const slideSheet = noa.getByRole("dialog", { name: /שקף/ });
      await slideSheet.waitFor({ timeout: 8000 });
      check("UX-4 a slide tag opens SlideSheet over the reveal and the URL stays", noa.url() === urlBefore, noa.url());
      a11y.push(...(await snap(noa, out, "quiz-5b-slide")));
      await next(shoham);
      await until(async () => (await noa.getByRole("dialog", { name: /שקף/ }).count()) === 0, 8000, "the slide closed by the countdown");
      check("UX-4 the host's next question closes the slide on every phone", true);

      /* Round 3: 1 of 5 right (20%) → every player's phone opens the question's slide. */
      await question(noa);
      const k3 = keyNow();
      await answer(shoham, k3, "נראה לי");
      for (const p of [noa, yael, maya, roni]) await answer(p, (k3 + 1) % 5, "ניחוש");
      await revealed(noa);
      await until(async () => (await noa.getByRole("dialog", { name: /שקף/ }).count()) === 1 && (await yael.getByRole("dialog", { name: /שקף/ }).count()) === 1, 8000, "the slide on every phone");
      check("ZA-4 under 30%: \"רוב הקבוצה טעתה\" and the question's slide opens on every player's phone", (await textOf(noa)).includes("רוב הקבוצה טעתה: פותחים את השקף.") && (await dana.getByRole("dialog", { name: /שקף/ }).count()) === 0);
      a11y.push(...(await snap(yael, out, "quiz-6-source")));

      /* Round 4: nobody answers → "הזמן נגמר.", and the reveal comes by itself. The host closes
       * the slide first ("סגירה": back to the quiz); the other phones' slides close at the countdown. */
      await shoham.getByRole("dialog", { name: /שקף/ }).getByRole("button", { name: "סגירה" }).click();
      await next(shoham);
      await until(async () => (await noa.getByRole("dialog", { name: /שקף/ }).count()) === 0, 8000, "the slide closed by the countdown");
      await question(noa);
      const closes4 = Date.parse(roundNow().closes_at);
      await see(noa, "הזמן נגמר.", 30000);
      await revealed(noa);
      const after = Date.now() - closes4;
      const r4 = await textOf(noa);
      check("9 nobody answered: \"הזמן נגמר.\", then the reveal within 3.5 s of the deadline, with no answer", after < 3500 && r4.includes("לא נשלחה תשובה. התשובה הנכונה:") && r4.includes("0 ענו"), `${after} ms`);

      /* Round 5: Yael's phone locks; it comes back to the right time and her answer counts. */
      await next(shoham);
      await mock.dropSocket("יעל");
      await yael.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await question(noa);
      const k5 = keyNow();
      const wakeBefore = await yael.evaluate(() => window.__wake);
      await answer(noa, k5, "נראה לי");
      await new Promise((ok) => setTimeout(ok, 2000));
      await yael.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const back = Date.now();
      await until(async () => (await yael.locator("button.quiz-opt").count()) > 0, 3000, "Yael's question after the lock");
      const yClock = norm(await yael.locator(".quiz-clock").innerText());
      const leftNow = Math.ceil((Date.parse(roundNow().closes_at) - Date.now()) / 1000);
      const ySecs = Number(yClock.split(":")[0]) * 60 + Number(yClock.split(":")[1]);
      check("10 a phone back from a lock shows the open question within 3 s, with the right time left", Date.now() - back < 3000 && Math.abs(ySecs - leftNow) <= 2, `${yClock} vs ${leftNow} s`);
      await answer(yael, k5, "ניחוש");
      check("10 its answer counts", Z.answers.some((a) => a.round_id === roundNow().id && a.user_id === mock.people["יעל"].user.id));
      check("18 the wake lock was asked for again after the phone came back", (await yael.evaluate(() => window.__wake)) > wakeBefore);
      for (const p of [shoham, maya, roni]) await answer(p, k5, "ניחוש");
      await revealed(noa);

      /* Round 6: the manager's phone goes mid-round; the round still closes on time; once the
       * manager is away (30 s in the SQL, E2E_AWAY_MS here) Noa takes over. */
      await next(shoham);
      await question(noa);
      const k6 = keyNow();
      await shohamCtx.close();
      for (const p of [noa, yael, maya, roni]) await answer(p, k6, "ניחוש");
      await revealed(noa);
      await see(noa, "לשוהם אין חיבור כרגע.", Number(process.env.E2E_AWAY_MS || 20000) + 5000);
      a11y.push(...(await snap(noa, out, "quiz-7-host-away", { primary: undefined })));
      await noa.getByRole("button", { name: "לקחת את ניהול המבחן" }).click();
      await noa.locator(".a-toast", { hasText: "הניהול עבר לטלפון הזה." }).waitFor({ timeout: 8000 });
      await noa.locator(PRIMARY, { hasText: "לשאלה הבאה" }).waitFor({ timeout: 8000 });
      await see(yael, "ניהול: נועה", 8000);
      check("11 \"לקחת את ניהול המבחן\": \"הניהול עבר לטלפון הזה.\" and \"לשאלה הבאה\" on Noa's phone; Yael sees \"ניהול: נועה\"", true);

      /* Round 7: Noa cancels the question for everyone. */
      await next(noa);
      await question(yael);
      const k7 = keyNow();
      for (const p of [noa, yael, maya, roni]) await answer(p, k7, "ניחוש");
      await revealed(noa);
      await noa.getByRole("button", { name: "ביטול השאלה" }).click();
      await noa.getByRole("dialog", { name: "ביטול השאלה" }).getByRole("button", { name: "ביטול השאלה" }).click();
      for (const p of [noa, yael, maya, dana]) await see(p, "השאלה בוטלה · נועה", 8000);
      check("12 \"ביטול השאלה\": every phone shows \"השאלה בוטלה · נועה\"", true);

      /* Rounds 8-10, then the end. */
      for (let i = 8; i <= 10; i++) {
        await next(noa);
        await question(yael);
        const k = keyNow();
        for (const p of [noa, yael, maya, roni]) await answer(p, k, i === 8 ? "על בטוח" : "נראה לי");
        await revealed(noa);
      }
      await noa.locator(PRIMARY, { hasText: "לסיום המבחן" }).click();
      await see(noa, "סוף המבחן");
      await see(yael, "סוף המבחן");
      const end = await textOf(noa);
      const endY = await textOf(yael);
      const team = Z.quizzes[0];
      const fin = Z.rounds.filter((r) => r.quiz_id === team.id && r.revealed_at && !r.voided_at).flatMap((r) => Z.answers.filter((a) => a.round_id === r.id && a.vote === r.vote));
      const pct = Math.round((100 * fin.filter((a) => a.correct).length) / fin.length);
      const noaLine = /שלך: \d+ מתוך \d+ · ניקוד ההימור: \S+/.exec(end)?.[0];
      const yaelLine = /שלך: \d+ מתוך \d+ · ניקוד ההימור: \S+/.exec(endY)?.[0];
      check(
        "13 the end: the team's score and 80% \"עברנו\" or not, a new record, the question that broke the group, each phone's own line only there",
        end.includes(`הקבוצה ענתה נכון על ${pct}%`) &&
          end.includes(pct >= 80 ? "עברנו!" : "80% זה ׳עברנו׳") &&
          end.includes("שיא חדש!") &&
          end.includes("השאלה ששברה את הקבוצה") &&
          Boolean(noaLine) &&
          Boolean(yaelLine) &&
          noaLine !== yaelLine &&
          !endY.includes(noaLine),
        `${pct}% | ${noaLine} | ${yaelLine}`,
      );
      a11y.push(...(await snap(noa, out, "quiz-8-end", { primary: PRIMARY })));
      await see(dana, "המבחן הסתיים.");
      check("13 a member who did not play: \"המבחן הסתיים.\" and \"מבחן חדש\"", (await dana.getByRole("link", { name: "מבחן חדש" }).count()) === 1);
      await maya.goto(`${mock.base}/?v=group`);
      await until(async () => (await maya.locator(".quiz-recent li").count()) >= 1, 8000, "the recent quizzes on יחד");
      const recent = norm(await maya.locator(".quiz-recent li").first().innerText());
      check("Y \"יחד\": the quiz with the group's share and this member's own line", recent.includes(`כולנו נגד המבחן · היום · הקבוצה ${pct}%`) && /· שלך \d+\/\d+$/.test(recent), recent);
      a11y.push(...(await snap(maya, out, "quiz-9-group")));
      check("Z-6 no request to /api/study/ai during a quiz on questions already written", aiBefore() === aiAtStart, `${aiBefore() - aiAtStart}`);

      /* ═════════ B. "מירוץ" ═════════ */
      await noa.locator(PRIMARY, { hasText: "מבחן נוסף" }).click();
      await see(noa, "מבחן קבוצתי חדש");
      await noa.locator(".quiz-mode", { hasText: "מירוץ" }).click();
      await noa.locator('[aria-labelledby="qs-count"] button', { hasText: /^5$/ }).click();
      await noa.locator('[aria-labelledby="qs-time"] button', { hasText: /^20$/ }).click();
      check("14 the setup again: the lecture chosen, \"מירוץ\" says who sees the points", (await noa.locator("label.a-choice input:checked").count()) === 1 && (await textOf(noa)).includes("במירוץ: נקודות וטבלה לשחקני המירוץ, רק במשחק."));
      await noa.locator(PRIMARY, { hasText: "פתיחת המבחן" }).click();
      await see(noa, "ממתינים להתחלה");
      const race = quizNow();
      await dana.goto(`${mock.base}/?v=library`);
      await until(async () => norm(await dana.locator(".live-banner .live-text").innerText().catch(() => "")).includes("מירוץ פתוח · בפנים: נועה"), 6000, "Dana's banner");
      for (const p of [yael, roni, maya]) {
        await p.goto(`${mock.base}/?v=quiz&q=${race.id}`);
        await p.locator(PRIMARY, { hasText: "להצטרף למבחן" }).click();
        await until(async () => (await p.locator(PRIMARY, { hasText: "להצטרף למבחן" }).count()) === 0, 8000, "joined the race");
      }
      Z.bare = true; // step 15: rows with no columns; every screen still moves (each event re-reads)
      await noa.locator(PRIMARY, { hasText: "להתחיל" }).click();
      await question(noa);
      check("14 the race's host has no \"לחשוף עכשיו\"", (await noa.locator(PRIMARY, { hasText: "לחשוף עכשיו" }).count()) === 0);
      await until(async () => norm(await dana.locator(".live-banner .live-text").innerText().catch(() => "")).includes("מירוץ עכשיו · שאלה 1 מתוך 5"), 6000, "Dana's banner, running");
      check("16 the banner to a member outside the race: \"מירוץ עכשיו · שאלה 1 מתוך 5\"", true);
      const kr = keyNow();
      await answer(noa, kr, "נראה לי");
      await new Promise((ok) => setTimeout(ok, 1000));
      await answer(yael, kr, "נראה לי");
      await new Promise((ok) => setTimeout(ok, 1000));
      await answer(roni, (kr + 1) % 5, "ניחוש");
      await answer(maya, (kr + 1) % 5, "על בטוח");
      await revealed(noa);
      await revealed(maya);
      const tableOf = async (p) => (await p.locator(".quiz-table li").allInnerTexts()).map(norm);
      const tNoa = await tableOf(noa);
      const tMaya = await tableOf(maya);
      check(
        "14 a race scores the bet, time breaks the tie; the top three, and Maya's own fourth place on her phone",
        norm(await noa.locator(".quiz-headline").innerText()) === "✓ תשובה נכונה · +2" &&
          norm(await maya.locator(".quiz-headline").innerText()) === `✗ −6 נקודות · התשובה הנכונה: ${LETTERS[kr]}` &&
          JSON.stringify(tNoa) === JSON.stringify(["1. נועה · 2 (+2)", "2. יעל · 2 (+2)", "3. רוני · 0 (0)"]) &&
          tMaya.length === 4 &&
          tMaya[3] === "4. מאיה · −6 (−6)",
        JSON.stringify({ tNoa, tMaya }),
      );
      a11y.push(...(await snap(maya, out, "quiz-10-race", { primary: undefined })));
      check("15 rows without columns: every screen moved (by re-reading)", true);
      Z.bare = false;
      const danaBodies = Z.bodies.filter((b) => b.fn === "study_quiz_state" && b.who === mock.people["דנה"].user.id && JSON.parse(b.body)?.quiz?.mode === "race");
      check("14 a member outside the race reads no points", danaBodies.every((b) => !/"score"/.test(JSON.stringify(JSON.parse(b.body).players))), `${danaBodies.length} reads`);
      for (let i = 2; i <= 5; i++) {
        await next(noa);
        await question(yael);
        const k = keyNow();
        await answer(noa, k, "נראה לי");
        await answer(yael, k, "על בטוח");
        await answer(roni, k, "ניחוש");
        await answer(maya, (k + 1) % 5, "ניחוש");
        await revealed(noa);
      }
      await noa.locator(PRIMARY, { hasText: "לסיום המבחן" }).click();
      await see(noa, "סוף המבחן");
      const podium = (await noa.locator(".quiz-podium li").allInnerTexts()).map(norm);
      check("E2 the podium and one's own place", podium.length === 3 && podium[0].startsWith("מקום ראשון:") && (await textOf(noa)).includes("המקום שלך: "), JSON.stringify(podium));
      a11y.push(...(await snap(noa, out, "quiz-11-podium", { primary: PRIMARY })));
      await until(async () => (await dana.locator(".live-banner .live-text").count()) === 0 || !norm(await dana.locator(".live-banner .live-text").innerText()).includes("מירוץ"), 4000, "the banner gone");
      check("16 after the end the banner goes", true);
      await noa.goto(`${mock.base}/?v=group`);
      await see(noa, "המקום שלך במירוץ האחרון: ", 8000);
      check("Y \"יחד\": the player's own place in the last race", /המקום שלך במירוץ האחרון: \d מתוך 4/.test(await textOf(noa)));

      /* ═════════ C. A lecture without questions (review UX-5) ═════════ */
      P.pace = { start: 400, line: 600 };
      const aiC = aiBefore();
      const { page: shoham2 } = await phone("שוהם", `/?v=quiz&new=1&l=${L2}`);
      await see(shoham2, "ליצור שאלות ולפתוח את המבחן");
      // The estimate comes with the month's spending (its own read), a moment after the button.
      await see(shoham2, "נוצלו החודש", 8000).catch(() => undefined);
      const cText = await textOf(shoham2);
      check("UX-5 a lecture without questions offers \"ליצור שאלות ולפתוח את המבחן\" with practice's estimate", cText.includes("אין עדיין שאלות") && /עלות משוערת: כ-\$\d+\.\d\d מהתקציב החודשי של הקבוצה\./.test(cText) && cText.includes("נוצלו החודש $12.40 מתוך $33."), cText.slice(-500));
      a11y.push(...(await snap(shoham2, out, "quiz-12-write", { primary: PRIMARY })));
      await shoham2.locator(PRIMARY, { hasText: "ליצור שאלות ולפתוח את המבחן" }).click();
      await see(shoham2, "ממתינים להתחלה");
      await see(shoham2, "נכתבות שאלות:", 10000);
      const start = shoham2.locator(PRIMARY, { hasText: "להתחיל" });
      const readyNow = () => P.questions.filter((x) => x.lecture_id === L2).length;
      check("UX-5 the lobby opens at once while the questions are written, and \"להתחיל\" waits for 5", (await start.isDisabled()) && readyNow() < 5, `${readyNow()} ready`);
      a11y.push(...(await snap(shoham2, out, "quiz-13-writing")));
      await until(async () => readyNow() >= 5, 60000, "5 questions");
      await until(async () => start.isEnabled(), 10000, "\"להתחיל\" enabled");
      check("UX-5 from 5 ready \"להתחיל\" is on", true);
      await until(async () => !P.requests.some((r) => r.end === null && r.status === 200), 60000, "the round's parts done");
      const reserves = db.calls.filter((c) => c.startsWith("ledger study_reserve kind=practice")).length;
      const settles = db.calls.filter((c) => c.startsWith("ledger study_settle kind=practice")).length;
      const modelCalls = P.requests.filter((r) => r.status === 200).length;
      check("UX-5 one reservation and one settlement per model call, through Q's op \"questions\" (Z-6: the only Claude calls)", reserves === modelCalls && settles === modelCalls && modelCalls > 0 && aiBefore() - aiC === P.requests.length, JSON.stringify({ reserves, settles, modelCalls, ai: aiBefore() - aiC }));
      await shoham2.getByRole("button", { name: "ביטול המבחן" }).click();
      await see(shoham2, "המבחן בוטל.");

      /* ═════════ D. Two answers; the lobby's record ═════════ */
      await shoham2.goto(`${mock.base}/?v=quiz&new=1&l=${L}`);
      await shoham2.locator('[aria-labelledby="qs-count"] button', { hasText: /^5$/ }).click();
      await shoham2.locator(PRIMARY, { hasText: "פתיחת המבחן" }).click();
      await see(shoham2, "ממתינים להתחלה");
      await see(shoham2, `השיא: ${pct}%`);
      check("ZA-4 the lobby shows the group's record", true);
      const two = quizNow();
      await yael.goto(`${mock.base}/?v=quiz&q=${two.id}`);
      await yael.locator(PRIMARY, { hasText: "להצטרף למבחן" }).click();
      await until(async () => (await yael.locator(PRIMARY, { hasText: "להצטרף למבחן" }).count()) === 0, 8000, "Yael joined");
      await shoham2.locator(PRIMARY, { hasText: "להתחיל" }).click();
      await question(shoham2);
      const kd = keyNow();
      await answer(shoham2, kd, "נראה לי");
      await answer(yael, (kd + 1) % 5, "ניחוש");
      await revealed(yael);
      check("Z-4 a reveal of two answers: \"2 ענו\" and no bars", (await textOf(yael)).includes("2 ענו") && (await yael.locator(".quiz-bars").count()) === 0);
      a11y.push(...(await snap(yael, out, "quiz-14-two", { primary: undefined })));

      /* ── UX-1: under these flags no step landed on a route that is off ── */
      const landed = await notices();
      check("UX-1 no control led to a route these flags replace (no notice all along)", landed === "", landed);
    }

    const problems = mock.problems;
    const failed = Object.entries(steps).filter(([, v]) => typeof v === "string" && v.startsWith("FAIL"));
    console.log(JSON.stringify({ flags: flagSet, errors: problems, steps, a11y }, null, 1));
    if (problems.length || a11y.length || failed.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, steps, a11y, log: Z.log.slice(-10), calls: mock.calls.slice(-14) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
