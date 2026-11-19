// Package G's flow and T-2's (§12.6.G's G-3, §12.4.T's D11; plan.html s1-s2,
// today.html; Yoad's decision 3 of 17 Nov 2026: usable early, with meters)
// on the shared mock with G's plugin (e2e/study/mocks/plan.cjs). Four
// members, three lectures:
//   1. נועה opens ?v=plan: no plan yet, "עוד אין תוכנית…" and "לבנות
//      תוכנית" (never a dead end); the setup (s2) builds it from the exam
//      date and the lectures: "מ-3 שבועות לפני · כ-3 שעות ביום", "בחופש
//      הלמידה · כ-10 שעות ביום", "כל הרצאה חוזרת 3 פעמים", "כולם יכולים
//      לערוך, ועל כל שינוי יש שם."; saving saves the next days as
//      marathons of the plan (PL2), never a past day.
//   2. The day (s1): "תוכנית · {title}" and "יום 2/21", the marathon meter,
//      decision 3's meter "התוכנית מדייקת ככל שמתרגלים: 0 מתוך 3 הרצאות
//      עם נתונים" with "עוד כ-20 תשובות ועוד 3 אנשים להרצאה הבאה",
//      "המסלול הקבוצתי" with "שינוי אחרון: נועה", "שאלות פתיחה", "המסלול
//      שלך" with "רק לך". The group practises: the meter counts a lecture
//      with data only from 20 answers of 3 members, and says how far the
//      next is ("עוד כ-12 תשובות ועוד אדם אחד להרצאה הבאה").
//   3. Yesterday's day did not finish: "אתמול לא הספקנו את …", the block
//      moved ("הוזז מאתמול"), the two prices; נועה picks "עוד שעה ביום עד
//      …", saved with her name. No red, no "מאחרים".
//   4. Her private lane: a relearning round that is due ("· סבב 2") and the
//      lecture the group read without her ("השלמה · …"); "שלי" links to it.
//   5. דנה changes the exam to two days from now: "שינוי אחרון: דנה";
//      Today shows "הלילה שלפני" with each lecture; the exam-eve view shows
//      the lecture's own summary slide, the wall's entries and נועה's own
//      confident mistakes, and "להדפסה".
//   6. "הקבוצה צריכה אותך" (T-2): off by default; איתי opts in on "שלי";
//      with nothing for him, the meter ("עוד אין שאלה בשבילך", how many more
//      right answers); then a question for him alone with why, and a
//      correction that waits; דנה, not opted in, sees nothing.
//   7. Marathons: the list, one day of the plan as a marathon (run-of-show,
//      "אולי", "להתחיל"), and a new one.
// Without VITE_STUDY_GROUP_PLAN (and VITE_STUDY_MARATHONS) it checks that
// nothing of G shows and nothing of G is called: ?v=plan and ?v=marathon land
// elsewhere; without VITE_STUDY_NEEDS_ME no card and no setting.
//
//   NODE_PATH=$(npm root -g) node e2e/study/plan.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "g" (wave 5's
// package G and T-2 on release 8's set), or a set without them.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/plan.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const MEMBERS = ["שוהם", "נועה", "דנה", "איתי"];
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms - 4 * 3_600_000));
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: MEMBERS });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const db = mock.db;
  const G = db.planMock;
  const id = (name) => mock.people[name].user.id;
  const today = dayOf(Date.now());
  const L2 = hex("9d100000", 2);
  const L3 = hex("9d100000", 3);

  /* ── the fixtures: two more lectures, the summary slide, a confident mistake, the wall ── */
  const t = ago(60 * 24 * 10);
  const lecture = (lid, title, parts, at = t) => {
    db.lectures.push({
      id: lid, group_id: db.group.id, course: "פתוגן מאכסן", title, lecturer: "", lecture_date: "2026-11-10", source_name: "deck.pptx", source_kind: "pptx", status: "ready", error: null,
      created_by: id("שוהם"), created_at: at, updated_at: at, queued_at: null, deleted_at: null, deleted_by: null,
      slides: Array.from({ length: parts * 4 }, (_, i) => ({ n: i + 1, title: `${title} ${i + 1}`, lines: [], tables: [], notes: "", figures: [] })),
    });
    for (let idx = 0; idx < parts; idx++)
      db.sections.push({ lecture_id: lid, idx, title: `${title} · ${idx + 1}`, slide_from: idx * 4 + 1, slide_to: idx * 4 + 4, markdown: `## ${title} ${idx + 1}\n\nפסקה. [ש' ${idx * 4 + 1}]`, status: "ready", error: null, updated_at: t, lease_until: null, attempts: 0, retry_at: null, writer: null, rev: 0, gen: 0 });
  };
  lecture(L2, "Leishmaniasis", 3);
  lecture(L3, "Helminths", 3, ago(60 * 24 * 9)); // uploaded after Leishmaniasis: the shared pass reads it second
  const L1 = db.lectures.find((l) => l.id === L);
  L1.slides.push({ n: L1.slides.length + 1, title: "סיכום: אתר וכוח", lines: ["Loop: הכי חזקות, NKCC2", "Thiazides: NCC, מורידות סידן בשתן", "Spironolactone: חוסכת אשלגן"], tables: [], notes: "", figures: [] });
  // נועה's confident mistake on L (the danger list, section P's: wrong after "על בטוח").
  const P = db.practice;
  if (P) {
    const q = {
      id: hex("9d300000", 1), group_id: db.group.id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", kind: "mcq", difficulty: 2, vignette: "",
      topic: "Loop diuretics", aspect: "mechanism", has_key: true, model: "mock", created_by: id("שוהם"), created_at: ago(3000), retired_at: null, retired_by: null, retire_note: "", quote: "",
      part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: null, points: [], request_id: null,
      part_idx: 2, anchor: 2, slides: [6], question: "Furosemide: איזה טרנספורטר היא מעכבת?", options: ["NKCC2", "NCC", "ENaC", "Carbonic anhydrase"],
    };
    P.questions.push(q);
    P.keys.set(q.id, { answer: 0, explanations: q.options.map((o) => `${o}.`), takeaway: "מה לזכור", whens: q.options.map(() => "") });
    P.answers.push({ id: hex("9d600000", 1), user_id: id("נועה"), question_id: q.id, choice: 1, correct: false, mode: "lecture", ms: 9000, confidence: 3, answered_at: ago(60 * 26) });
  }
  if (db.aids) {
    db.aids.push({ id: hex("9d500000", 1), group_id: db.group.id, lecture_id: L, part_idx: 2, anchor: 2, quote: "", drug: "Furosemide", kind: "line", body: "NKCC2 = שני כ׳ ושני סודיום: Furosemide סוגרת את שניהם.", fact: "Loop diuretics מעכבות NKCC2", slides: [6], photo: null, figure: null, remix_of: null, draft_id: null, draft_no: null, named_by: id("איתי"), credit_id: null, funny_n: 3, stuck_n: 4, flag: null, flagged_by: null, check_state: "ok", checked_at: ago(600), check_note: null, edited_at: null, created_at: ago(60 * 30) });
    db.aidWinners.push({ lecture_id: L, part_idx: 2, anchor: 2, aid_id: hex("9d500000", 1), since: ago(60 * 20) });
  }
  // The group read Leishmaniasis (the shared pass started with it yesterday): שוהם, דנה, איתי, not נועה.
  for (const n of ["שוהם", "דנה", "איתי"]) db.reads.push({ id: hex("9d700000", db.reads.length + 1), lecture_id: L2, user_id: id(n), read_at: ago(60 * 20) });

  const browser = await chromium.launch();
  const steps = { flags: flags.set };
  const ok = [];
  const a11y = [];
  const pages = {};
  const shot = async (page, name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  const expect = (cond, what) => {
    if (!cond) throw new Error(what);
    ok.push(what);
  };
  const open = async (who, path = "/") => {
    if (pages[who]) await pages[who].context().close().catch(() => undefined);
    const { page } = await mock.open(browser, who, { path });
    pages[who] = page;
    return page;
  };
  const text = async (page, sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
  try {
    if (!flags.groupPlan) {
      /* ── Nothing of G without its flags ── */
      const noa = await open("נועה", "/?v=plan");
      await noa.locator("main").first().waitFor({ timeout: 15000 });
      await noa.waitForTimeout(800);
      expect((await noa.locator("main.plan").count()) === 0, "?v=plan opens no plan");
      await noa.goto(`${mock.base}/?v=marathon`);
      await noa.locator("main").first().waitFor({ timeout: 15000 });
      await noa.waitForTimeout(800);
      expect((await noa.locator("main.plan").count()) === 0, "?v=marathon opens no marathons");
      await noa.goto(`${mock.base}/?v=group`);
      await noa.locator("main").first().waitFor({ timeout: 15000 });
      await noa.waitForTimeout(800);
      expect((await noa.locator(".pl-card").count()) === 0, "no plan card on \"יחד\"");
      await noa.goto(`${mock.base}/?v=me`);
      await noa.locator("main.me-screen").waitFor({ timeout: 15000 });
      await noa.waitForTimeout(800);
      expect((await noa.locator(".pl-me, .t-needs-setting").count()) === 0, "no lane row and no \"הקבוצה צריכה אותך\" setting on \"שלי\"");
      if (flags.today) {
        await noa.goto(`${mock.base}/`);
        await noa.locator("main.today").waitFor({ timeout: 15000 });
        await noa.waitForTimeout(800);
        expect((await noa.locator(".t-needs, .pl-eve").count()) === 0, "Today: no T-2 card, no exam-eve card");
      }
      expect(G.calls.length === 0, `nothing of G or T-2 is called: ${G.calls.map((c) => c.fn).join(", ")}`);
    } else {
      /* ── 1. No plan yet: the empty state, then the setup (plan.html s2) ── */
      const noa = await open("נועה", "/?v=plan");
      await noa.locator("main.plan .pl-empty").waitFor({ timeout: 20000 });
      expect((await text(noa, ".pl-empty")).includes("עוד אין תוכנית. מזינים את מבחן הבלוק פעם אחת, והתוכנית נבנית לבד."), "the empty state's words");
      expect((await noa.locator(".pl-empty").getByRole("link", { name: "לבנות תוכנית" }).count()) === 1, "and the way to build one: never a dead end");
      await shot(noa, "plan-1-empty");
      await noa.locator(".pl-empty").getByRole("link", { name: "לבנות תוכנית" }).click();
      await noa.locator("main.pl-setup").waitFor({ timeout: 15000 });
      const setup = await text(noa, "main.pl-setup");
      for (const w of ["תוכנית עד המבחן", "מ-3 שבועות לפני", "סבב משותף על כל הסיכומים", "כ-3 שעות ביום", "בחופש הלמידה", "שחזורים, ומה שלא ישב טוב", "כ-10 שעות ביום", "כל הרצאה חוזרת 3 פעמים", "המרווחים גדלים עד המבחן, וסבב נגמר רק כשכל שאלת מפתח נענית נכון.", "כולם יכולים לערוך, ועל כל שינוי יש שם.", "כל ההרצאות של הבלוק מסומנות"])
        expect(setup.includes(w), `the setup says "${w}"`);
      expect((await noa.locator(".pl-lectures input[type=checkbox]:checked").count()) === 3, "every lecture is checked");
      await noa.getByLabel("שם המבחן").fill("מבחן בלוק פתוגן-מאכסן");
      const exam = addDays(today, 20);
      await noa.getByLabel("תאריך המבחן").fill(exam);
      await shot(noa, "plan-2-setup", { primary: ".ph-foot .a-btn.primary" });
      await noa.locator(".ph-foot .a-btn.primary").click();

      /* ── 2. The day (plan.html s1) ── */
      await noa.locator("main.plan .pl-km").waitFor({ timeout: 20000 });
      await noa.waitForTimeout(1200);
      const plan = G.plans.find((p) => p.state === "active");
      expect(plan && plan.title === "מבחן בלוק פתוגן-מאכסן" && plan.exam_date === exam && plan.shared_from === addDays(exam, -21) && plan.leave_from === addDays(exam, -14), "the plan from the exam: 3 weeks and 2 weeks before");
      expect(plan.created_by === id("נועה") && plan.updated_by === id("נועה"), "with her name");
      const days = G.marathons.filter((m) => m.plan_id === plan.id);
      expect(days.length >= 5 && days.length <= 7 && days.every((d) => d.plan_day >= today && d.plan_day < addDays(today, 7)), `the next days saved as marathons of the plan, none in the past (${days.map((d) => d.plan_day).join(", ")})`);
      expect(days.every((d) => d.agenda[0].k === "intro" && d.agenda.some((b) => b.k === "read") && d.minutes >= 30 && d.minutes <= 720), "each with its run-of-show");
      const head = await text(noa, ".ph-head");
      expect(head.includes("תוכנית · מבחן בלוק פתוגן-מאכסן") && head.includes("יום 2/21"), `the head: ${head}`);
      expect((await text(noa, ".ph-sub")).includes("סבב משותף"), "the shared pass");
      const km = await text(noa, ".pl-km");
      expect(km.includes("ק״מ 21") && km.includes("כל הסיכומים נקראו") && km.includes("ק״מ 42: המבחן"), `the marathon meter: ${km}`);
      expect(km.includes("התוכנית מדייקת ככל שמתרגלים: 0 מתוך 3 הרצאות עם נתונים"), "decision 3's meter: nothing practised");
      expect(km.includes("עוד כ-20 תשובות ועוד 3 אנשים להרצאה הבאה"), "and how far the next lecture is");
      expect((await text(noa, "main.plan")).includes("שינוי אחרון: נועה"), "the last change's name");
      const rows = await noa.locator(".pl-day:not(.pl-mine) .pl-row").count();
      expect(rows >= 3 && (await text(noa, ".pl-day")).includes("שאלות פתיחה"), "the day's blocks, from the opening");
      expect((await text(noa, ".pl-day")).includes("הקראה ומבחן קבוצתי, 5 שאלות"), "read and quiz as one row");
      expect(!/מאחר|באיחור/.test(await text(noa, "main.plan")), "never \"מאחרים\"");

      // The group practises: 22 answers by 3 members on L (mostly wrong), 8 by 2 on Leishmaniasis.
      const answer = (lid, who, n, right) => {
        for (let i = 0; i < n; i++) G.answers.push({ lecture_id: lid, user_id: id(who), correct: i < right });
      };
      answer(L, "שוהם", 8, 2);
      answer(L, "דנה", 8, 2);
      answer(L, "איתי", 6, 2);
      answer(L2, "שוהם", 4, 3);
      answer(L2, "דנה", 4, 3);
      await noa.reload();
      await noa.locator("main.plan .pl-km").waitFor({ timeout: 20000 });
      await noa.waitForTimeout(800);
      const km2 = await text(noa, ".pl-km");
      expect(km2.includes("התוכנית מדייקת ככל שמתרגלים: 1 מתוך 3 הרצאות עם נתונים"), `one lecture has data: ${km2}`);
      expect(km2.includes("עוד כ-12 תשובות ועוד אדם אחד להרצאה הבאה"), "the next: 12 answers and one more person, never who");
      await shot(noa, "plan-3-day");

      /* ── 3. Yesterday did not finish: the block moved, the two prices ── */
      G.marathons.push({
        id: hex("9d800000", 1), group_id: db.group.id, title: "יום 1/21", starts_at: ago(60 * 30), minutes: 180, place: "", note: "", lecture_ids: [L], state: "live", step: 1, version: 3,
        agenda: [{ k: "intro", min: 5, title: "שאלות פתיחה" }, { k: "read", l: L, from: 0, to: 0, min: 50 }, { k: "quiz", l: L, n: 5, min: 10 }, { k: "break", min: 10 }, { k: "read", l: L, from: 1, to: 1, min: 50 }, { k: "quiz", l: L, n: 5, min: 10 }],
        created_by: id("שוהם"), updated_by: id("שוהם"), created_at: ago(60 * 40), updated_at: ago(60 * 30), plan_id: plan.id, plan_day: addDays(today, -1),
      });
      await noa.reload();
      await noa.locator("main.plan .pl-slip").waitFor({ timeout: 20000 });
      const slip = await text(noa, ".pl-slip");
      expect(/^אתמול לא הספקנו את /.test(slip) && slip.includes("הבלוק זז להיום. כדי לסיים בזמן, בוחרים מחיר:"), `the slip's words: ${slip}`);
      expect(/עוד שעה ביום עד (ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/.test(slip) && slip.includes("לוותר על יום חזרה אחד"), "the two prices");
      expect((await noa.locator(".pl-day .a-chip", { hasText: "הוזז מאתמול" }).count()) >= 1, "the moved block says so on today's day");
      const bg = await noa.locator(".pl-slip").evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(!/rgb\((2[0-5]\d|1\d\d), ([0-6]?\d), ([0-6]?\d)\)/.test(bg), `no red: ${bg}`);
      await shot(noa, "plan-4-slip");
      await noa.locator(".pl-slip button", { hasText: "עוד שעה ביום" }).click();
      await noa.locator(".pl-slip").waitFor({ state: "detached", timeout: 15000 });
      const s = plan.slips[plan.slips.length - 1];
      expect(s && s.choice === "longer" && s.by === id("נועה") && s.day === addDays(today, -1) && s.until > today, "the price is saved with her name");

      /* ── 4. Her private lane ── */
      G.rounds[id("נועה")] = [{ lecture_id: L, rounds: 1, key_total: 6, key_left: 2, last_day: addDays(today, -2), next_day: today }];
      await noa.goto(`${mock.base}/?v=me`);
      await noa.locator(".pl-me").waitFor({ timeout: 20000 });
      await noa.locator(".pl-me a").click();
      await noa.locator("main.plan .pl-mine, main.plan .pl-mine-empty").first().waitFor({ timeout: 20000 });
      await noa.waitForTimeout(600);
      const mine = await text(noa, "main.plan");
      expect(mine.includes("המסלול שלך") && mine.includes("רק לך"), "her lane, hers alone");
      expect(mine.includes("סבב 2") && mine.includes("2 שאלות מפתח עד סוף הסבב"), "the relearning round that is due");
      expect(mine.includes("השלמה · Leishmaniasis") && mine.includes("הקבוצה כבר קראה. לקרוא בקצב שלך"), "the lecture the group read without her");
      expect(G.calls.filter((c) => c.fn === "study_my_relearning").every((c) => c.who === id("נועה")), "her rounds are asked by her alone");
      await shot(noa, "plan-5-mine");

      /* ── 5. דנה moves the exam to two days from now: names, Today's eve card, the exam-eve view ── */
      const dana = await open("דנה", "/?v=plan");
      await dana.locator("main.plan .pl-km").waitFor({ timeout: 20000 });
      expect((await text(dana, "main.plan")).includes("שינוי אחרון: נועה"), "דנה sees who changed it last");
      await dana.locator(".pl-edit").click();
      await dana.locator("main.pl-setup").waitFor({ timeout: 15000 });
      expect((await text(dana, ".pl-slip, main.pl-setup")).includes("תוכנית עד המבחן"), "the setup, with the plan");
      await dana.getByRole("button", { name: "לערוך את המבחן" }).click();
      await dana.getByLabel("תאריך המבחן").fill(addDays(today, 2));
      await dana.locator(".ph-foot .a-btn.primary").click();
      await dana.locator("main.plan .pl-km").waitFor({ timeout: 20000 });
      await dana.waitForTimeout(800);
      expect(plan.version >= 3 && plan.updated_by === id("דנה"), "the change has her name");
      steps.days = G.marathons.filter((m) => m.plan_id === plan.id).map((m) => `${m.plan_day} ${m.state} ${m.title}`);
      expect(G.marathons.filter((m) => m.plan_id === plan.id && m.plan_day >= addDays(today, 2)).every((m) => m.state === "cancelled"), "days that are no longer the plan's (the exam moved earlier) are cancelled");
      expect((await text(dana, "main.plan")).includes("שינוי אחרון: דנה") && (await text(dana, ".ph-sub")).includes("חופש למידה"), "\"שינוי אחרון: דנה\", study leave");
      expect((await dana.locator(".pl-eve .a-chip").count()) === 3, "the plan offers the exam-eve view for each lecture");
      await shot(dana, "plan-6-leave");

      const n2 = await open("נועה", "/");
      await n2.locator("main.today .pl-eve").waitFor({ timeout: 20000 });
      const eve = await text(n2, ".pl-eve");
      expect(eve.includes("הלילה שלפני") && /המבחן (מחר|ביום (ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת))/.test(eve), `Today's eve card: ${eve}`);
      await shot(n2, "today-1-eve");
      await n2.locator(".pl-eve a", { hasText: L1.title.slice(0, 8) }).first().click();
      await n2.locator("main.eve").waitFor({ timeout: 15000 });
      await n2.locator("main.eve .eve-slide, main.eve .a-card.dashed").first().waitFor({ timeout: 15000 });
      await n2.waitForTimeout(800);
      const ev = await text(n2, "main.eve");
      expect(ev.includes("השקף המסכם") && ev.includes("סיכום: אתר וכוח") && ev.includes("Thiazides: NCC, מורידות סידן בשתן"), "the lecture's own summary slide, as it is");
      expect(ev.includes("האסוציאציות שלך") && ev.includes("NKCC2 = שני כ׳ ושני סודיום") && ev.includes("זוכה"), "the wall's winner");
      expect(ev.includes("הטעויות ׳על בטוח׳ שלך") && ev.includes("Furosemide: איזה טרנספורטר היא מעכבת?") && ev.includes("ענית ׳NCC׳") && ev.includes("נכון: NKCC2"), "her own confident mistake");
      expect((await n2.getByRole("button", { name: "להדפסה" }).count()) === 1, "\"להדפסה\"");
      await shot(n2, "eve-1");
      const d2 = await open("דנה", `/?v=eve&l=${L}`);
      await d2.locator("main.eve .a-card.dashed, main.eve .a-list").first().waitFor({ timeout: 15000 });
      await d2.waitForTimeout(800);
      const dev = await text(d2, "main.eve");
      expect(!dev.includes("Furosemide: איזה טרנספורטר") && dev.includes("אין לך טעויות ׳על בטוח׳ בהרצאה הזו."), "דנה's eve: none of נועה's mistakes, and what fills it");
      await shot(d2, "eve-2-empty");

      /* ── 6. "הקבוצה צריכה אותך" (T-2): opt-in, the meter, then a question for איתי alone ── */
      if (flags.needsMe) {
        const itai = await open("איתי", "/");
        await itai.locator("main.today").waitFor({ timeout: 20000 });
        await itai.waitForTimeout(1000);
        expect((await itai.locator(".t-needs").count()) === 0, "off by default: no card");
        await itai.goto(`${mock.base}/?v=me`);
        await itai.locator(".t-needs-setting").waitFor({ timeout: 15000 });
        expect(!(await itai.locator(".t-needs-setting input").isChecked()), "the setting starts off");
        G.needsMeter[id("איתי")] = { topics: 0, next: { topic: "Loop diuretics", lecture_id: L, short: 2 } };
        await itai.locator(".t-needs-setting input").check();
        await itai.waitForTimeout(500);
        expect(G.prefs.get(id("איתי")) === true, "he opted in");
        await shot(itai, "me-1-needs-setting");
        await itai.goto(`${mock.base}/`);
        await itai.locator("main.today .t-needs").waitFor({ timeout: 20000 });
        const meter = await text(itai, ".t-needs");
        expect(meter.includes("הקבוצה צריכה אותך") && meter.includes("רק לך") && meter.includes("עוד אין שאלה בשבילך"), `nothing for him yet: the meter (${meter})`);
        expect(meter.includes("שאלה פתוחה מגיעה למי שענו נכון על 4 מתוך 5 לפחות בנושא שלה (3 שאלות ומעלה).") && meter.includes("עוד כ-2 תשובות נכונות על Loop diuretics לנושא הבא."), "the rule and how far, from his own counts");
        await shot(itai, "today-2-needs-meter");
        G.needs[id("איתי")] = [
          { kind: "question", comment_id: hex("9d900000", 1), lecture_id: L, lecture_title: L1.title, part: 2, anchor: 2, quote: "NKCC2", body: "למה Furosemide עובדת גם כשה-GFR נמוך?", topic: "Loop diuretics", right: 4, of: 5 },
          { kind: "approval", proposal_id: hex("9da00000", 1), lecture_id: L, lecture_title: L1.title, part: 3, anchor: 2, note: "מהשקף 9", by: "שוהם" },
        ];
        db.comments.push({ id: hex("9d900000", 1), lecture_id: L, part_idx: 2, anchor: 2, quote: "NKCC2", kind: "question", body: "למה Furosemide עובדת גם כשה-GFR נמוך?", parent_id: null, resolved: false, author_id: id("נועה"), created_at: ago(60 * 5) });
        await itai.reload();
        await itai.locator("main.today .t-needs .t-needs-row").first().waitFor({ timeout: 20000 });
        const card = await text(itai, ".t-needs");
        expect(card.includes("שאלה פתוחה") && card.includes("למה Furosemide עובדת גם כשה-GFR נמוך?") && card.includes("הגיעה אליך כי ענית נכון על 4 מתוך 5 שאלות על Loop diuretics. גלוי רק לך."), "the question, with why, his alone");
        expect(card.includes("תיקון מחכה לאישור שני · שוהם"), "and the correction that waits");
        expect((await itai.locator(".t-needs").getByRole("link", { name: "לענות" }).getAttribute("href")).includes(`l=${L}`), "\"לענות\" opens the paragraph");
        // Review UI-3: one question, once. The mock's study_today still names it in open_question (as T 2
        // did); the screen shows it only under "הקבוצה צריכה אותך", never again in "בקבוצה".
        const times = ((await text(itai, "main.today")).match(/למה Furosemide עובדת גם כשה-GFR נמוך\?/g) ?? []).length;
        expect(times === 1 && (await itai.locator("main.today .t-group").count()) === 0, `the question shows once on Today (${times}), not again in "בקבוצה"`);
        await shot(itai, "today-3-needs");
        const d3 = await open("דנה", "/");
        await d3.locator("main.today").waitFor({ timeout: 20000 });
        await d3.waitForTimeout(1200);
        expect((await d3.locator(".t-needs").count()) === 0, "דנה did not opt in: nothing");
        expect(!db.todayMock.bodies.filter((b) => b.who === id("דנה")).some((b) => b.body.includes("הגיעה אליך") || b.body.includes(hex("9d900000", 1)) && b.body.includes("\"kind\":\"question\"")), "and no needs row reaches her");
      }

      /* ── 7. Marathons: the list, a day of the plan, a new one ── */
      const n3 = await open("נועה", "/?v=marathon");
      await n3.locator("main.plan .a-list, main.plan .pl-empty").first().waitFor({ timeout: 20000 });
      await n3.waitForTimeout(600);
      expect((await n3.locator("main.plan .a-list .a-li").count()) >= 1, "the plan's days are marathons in the list");
      const firstHref = await n3.locator("main.plan .a-list .a-li").first().getAttribute("href");
      const soonest = G.marathons.filter((m) => m.state !== "cancelled" && m.state !== "ended" && Date.parse(m.starts_at) + (m.minutes + 180) * 60_000 > Date.now()).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))[0];
      expect(firstHref.includes(`m=${soonest.id}`), `soonest first, cancelled days gone: ${await n3.locator("main.plan .a-list").innerText()}`);
      await shot(n3, "marathon-1-list");
      await n3.locator("main.plan .a-list .a-li").first().click();
      await n3.locator("main.plan .pl-day").waitFor({ timeout: 15000 });
      expect((await text(n3, ".ph-head")).startsWith("→") || (await text(n3, ".ph-head")).includes("ערב למידה ·"), "one marathon");
      const mid = new URL(n3.url()).searchParams.get("m");
      await n3.getByRole("radio", { name: "אולי" }).click();
      await n3.waitForTimeout(400);
      expect(G.people.some((p) => p.marathon_id === mid && p.user_id === id("נועה") && p.answer === "maybe"), "\"אולי\" is saved");
      await shot(n3, "marathon-2-day", { primary: ".ph-foot .a-btn.primary" });
      await n3.locator(".ph-foot .a-btn.primary", { hasText: "להתחיל" }).click();
      await n3.locator(".pl-day .a-chip", { hasText: "עכשיו" }).waitFor({ timeout: 15000 });
      expect(G.marathons.find((m) => m.id === mid).step === 0, "\"להתחיל\" moves it to its first step");
      await n3.goto(`${mock.base}/?v=marathon&new=1`);
      await n3.locator("main.pl-setup").waitFor({ timeout: 15000 });
      await n3.getByLabel("שם").fill("ערב Helminths");
      await n3.getByLabel("יום").fill(addDays(today, 1));
      await n3.locator(".pl-lectures label", { hasText: "Helminths" }).click();
      await shot(n3, "marathon-3-new", { primary: ".ph-foot .a-btn.primary" });
      await n3.locator(".ph-foot .a-btn.primary").click();
      await n3.locator("main.plan .pl-day").waitFor({ timeout: 15000 });
      const made = G.marathons.find((m) => m.title === "ערב Helminths");
      expect(made && !made.plan_id && made.agenda.some((b) => b.k === "read" && b.l === L3) && G.people.some((p) => p.marathon_id === made.id && p.user_id === id("נועה") && p.answer === "in"), "a marathon of its own, its maker in");

      /* ── "יחד": the plan's card ── */
      await n3.goto(`${mock.base}/?v=group`);
      await n3.locator(".pl-card").waitFor({ timeout: 20000 });
      const pc = await text(n3, ".pl-card");
      expect(pc.includes("תוכנית · מבחן בלוק פתוגן-מאכסן") && pc.includes("לתוכנית"), `the plan's card on "יחד": ${pc}`);
      expect((await n3.locator(".pl-card", { hasText: "מרתונים" }).count()) === 0, "the plan's card stands for the marathons");
    }
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, ok: ok.length, checks: ok, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, ok, steps, plans: G.plans, calls: mock.calls.slice(-25) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
