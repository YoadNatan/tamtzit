// Package T-1's flow and C's review in Today (§12.4.T: T-3; §12.3.C: CS-4;
// today.html s1, cards.html s1-s2) on the shared mock with T's plugin
// (e2e/study/mocks/today.cjs). Four members in the fixture lecture:
//   1. נועה opens /: Today ("היום · יום …") with the day's meeting
//      (M's band), "התור שלי" with "רק לך" and the chips 10 · 20 דק׳ · 45,
//      the rows of her cut in the table's order with their chips and an
//      example ("עדכון בסיכום", "1 מהמבחן הקבוצתי · טעית אתמול", "פסקה שסימנת
//      ׳לא ברור׳ · מהפגישה", "N כרטיסים · הגיע הזמן"), "להתחיל · n דק׳", the
//      flame "ימי למידה 4/7" and its line, and "בקבוצה": איתי's open question.
//      The danger row shows only with VITE_STUDY_PROGRESS ("all", "w5").
//      With release 8's set ("w5", wave 5's integration) two more rows come
//      from the other packages: Q-2's "טעות אחת בניסוח אחר" (A2's counts:
//      a guess she missed two days ago, its paragraph's other question) and
//      U-2's "תרגול קצר · {topic}" (a topic hot for her and not for the
//      group); in the session each opens its route ("לתרגל": practice's
//      r.<group> with "בניסוח אחר", then the topic), and Back returns to
//      the next step.
//   2. The minute chips: 10 cuts the queue (greedy: a smaller row still
//      fits), the choice stays after a reload (per device).
//   3. "להתחיל": the session runs each step through its owner's component:
//      V's "עדכון" card ("הבנתי"), the quiz return as practice's question
//      (mode "mistakes", the bet), the "לא ברור" paragraph ("לפסקה",
//      "הבנתי"), then C's review for the cut's cards: a card she forgot
//      twice with the wall's hint and the line "שכחת את הכרטיס הזה פעמיים,
//      אז מגיע רמז", her private card announced ("הבא בתור · מטעות שלך"),
//      until the end: "התור של היום הושלם. מה שנשאר עובר למחר."
//   4. Today again: what she did is gone; nothing left: "אין כלום בתור
//      כרגע." and "תרגול חופשי".
//   5. דנה missed yesterday's meeting: "פגישה שפספסת" with "השלמה · n דק׳"
//      (M's catch-up); her home for reviews is Anki, so no cards row; none of
//      נועה's rows reach her phone. איתי sees no "בקבוצה" of his own.
//   6. The review on its own (?v=cards&s=today), done for today: "להיום".
// Without VITE_STUDY_TODAY ("off", "rel1", "w4") it checks that nothing of T
// shows: "/" is the library, no "היום" tab, ?v=today&run=1 lands on the
// library, and study_today is never called.
//
//   NODE_PATH=$(npm root -g) node e2e/study/today.cjs <dist> <out dir>
// E2E_FLAGS names the build's flags (mock.cjs's flagSetOf): "t" (wave 4's set
// with VITE_STUDY_TODAY and VITE_STUDY_CARDS_REVIEW), "w5" (release 8 on wave
// 4's set: "t" with VITE_STUDY_PROGRESS and VITE_STUDY_PULSE), "all", or a set
// without Today.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const cardsPlugin = require("./mocks/cards.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/today.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf();
const MEMBERS = ["שוהם", "נועה", "דנה", "איתי"];
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms - 4 * 3_600_000));

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: MEMBERS });
  mock.seedLecture();
  const L = mock.LECTURE_ID;
  const db = mock.db;
  db.notifyCards = mock.notify;
  const id = (name) => mock.people[name].user.id;
  const T = db.todayMock;
  const P = db.practice;
  const M = db.meetingMock;
  const C = db.cardsMock;
  const progress = flags.progress;
  // Wave 5's integration: Q-2's row (A2's counts) and U-2's "רק אצלך חם" reach Today through its slots.
  const again = Boolean(flags.mistakes);
  const pulse = Boolean(flags.pulse);

  /* ── the fixtures ── */
  const question = (n, o) => ({
    id: hex("7d300000", n), group_id: db.group.id, lecture_id: L, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", kind: "mcq", difficulty: 2, vignette: "",
    topic: "Loop diuretics", aspect: "mechanism", has_key: true, model: "mock", created_by: id("שוהם"), created_at: ago(3000 - n), retired_at: null, retired_by: null, retire_note: "", quote: "",
    part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: null, points: [], request_id: null, ...o,
  });
  const Q = [
    question(1, { part_idx: 2, anchor: 2, slides: [6], question: "Furosemide: איזה טרנספורטר היא מעכבת?", options: ["NKCC2", "NCC", "ENaC", "Carbonic anhydrase"] }),
    question(2, { part_idx: 1, anchor: 1, slides: [4], question: "Acetazolamide: מה המנגנון?", options: ["עיכוב carbonic anhydrase", "עיכוב NKCC2", "חסימת ENaC", "אנטגוניסט לאלדוסטרון"] }),
    question(3, { part_idx: 1, anchor: 1, slides: [4], question: "איזה אנזים מעכבת Acetazolamide בצינורית הקרובה?", options: ["carbonic anhydrase", "Na⁺/K⁺-ATPase", "ACE", "NCC"] }),
  ];
  P.questions.push(...Q);
  for (const q of Q) P.keys.set(q.id, { answer: 0, explanations: q.options.map((o, i) => (i === 0 ? `${o}: כך בשקף. [ש' ${q.slides[0]}]` : `${o}: לא לפי השקף.`)), takeaway: "מה לזכור", whens: q.options.map(() => "") });
  // נועה's wrong first vote yesterday, right in the discussion; her "על בטוח" miss on Q2, asked as Q3.
  T.returns.push({ user_id: id("נועה"), question_id: Q[0].id, lecture_id: L, wrong_at: ago(60 * 24), step: 1, choice: 1, bet: 3, fixed_in_discussion: true });
  // And a return on its third day (step 2), on Q2: the table puts it after the cards.
  T.returns.push({ user_id: id("נועה"), question_id: Q[1].id, lecture_id: L, wrong_at: ago(60 * 24 * 3), step: 2, choice: 2, bet: 2, fixed_in_discussion: false });
  T.danger.push({ user_id: id("נועה"), question_id: Q[1].id, ask_id: Q[2].id, lecture_id: L, wrong_at: ago(60 * 26) });
  T.flame.set(id("נועה"), 4);
  // Q-2: a guess she missed two days ago on ¶4.1 (not "על בטוח", so not the danger list); the
  // paragraph's other question asks it again (A2's mock counts it: again_due 1).
  const Q4 = question(4, { part_idx: 4, anchor: 1, slides: [11], topic: "Potassium-sparing", question: "Spironolactone: מה המנגנון?", options: ["אנטגוניסט לאלדוסטרון", "עיכוב NKCC2", "עיכוב NCC", "עיכוב carbonic anhydrase"] });
  const Q5 = question(5, { part_idx: 4, anchor: 1, slides: [11], topic: "Potassium-sparing", question: "על איזה קולטן פועלת Spironolactone?", options: ["הקולטן למינרלוקורטיקואידים", "ENaC", "NKCC2", "V2"] });
  if (again) {
    P.questions.push(Q4, Q5);
    for (const q of [Q4, Q5]) P.keys.set(q.id, { answer: 0, explanations: q.options.map((o, i) => (i === 0 ? `${o}: כך בשקף. [ש' 11]` : `${o}: לא לפי השקף.`)), takeaway: "מה לזכור", whens: q.options.map(() => "") });
    P.answers.push({ id: hex("7d600000", 1), user_id: id("נועה"), question_id: Q4.id, choice: 1, correct: false, mode: "lecture", ms: 9000, confidence: 1, answered_at: ago(60 * 48) });
  }
  // U-2: the last night counted all four; "Loop diuretics · מנגנון" sits well with the group and is hot for her alone.
  if (pulse) {
    const U = db.pulseMock;
    U.night(MEMBERS.map(id));
    U.topics.push({ lecture_id: L, topic_key: "loop diuretics", topic: "Loop diuretics", aspect: "mechanism", bucket: "cool", slides: [6], closed_week: false, cutoff: U.cutoff });
    U.mine[id("נועה")] = [{ lecture_id: L, topic_key: "loop diuretics", aspect: "mechanism", items: 4, wrong: 3, mine: "hot", topic: "Loop diuretics" }];
  }

  // Yesterday's meeting: נועה was there and tapped "לא ברור" on ¶2.2; דנה was not. Today's, planned at 09:00.
  const t0 = ago(60 * 24 + 30);
  const Y = hex("7d000000", 1);
  const meeting = (o) => ({
    group_id: db.group.id, lecture_id: L, part_from: 2, part_to: 2, title: "", planned_reader: null, reader_id: null, reading: false, started_at: null, read_part: null,
    guess_ids: [], guess_released: 0, cancelled_at: null, version: 1, created_by: id("שוהם"), updated_by: null, created_at: t0, updated_at: t0, ...o,
  });
  M.meetings.push(meeting({ id: Y, day: dayOf(Date.parse(t0)), starts_at: t0, reader_id: id("שוהם"), started_at: t0, read_part: 2 }));
  const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
  M.meetings.push(meeting({ id: hex("7d000000", 2), day: dayOf(Date.now()), starts_at: later, part_from: 3, part_to: 4 }));
  M.presence.set(`${Y}:${id("נועה")}`, { first: Date.parse(t0), last: Date.parse(t0) + 3_600_000 });
  M.presence.set(`${Y}:${id("איתי")}`, { first: Date.parse(t0), last: Date.parse(t0) + 3_600_000 });
  M.taps.push({ id: hex("7d100000", 1), meeting_id: Y, user_id: id("נועה"), lecture_id: L, part: 2, anchor: 3, quote: "Loop diuretics גורמות להיפוקלמיה", at: Date.parse(t0) + 600_000, done_at: null });
  M.events.push({ meeting_id: Y, kind: "explain", part: 2, anchor: 3, quote: "", comment_id: null, by: id("שוהם"), at: Date.parse(t0) + 900_000 });

  // A correction that reached נועה (V's "עדכון"): she had reviewed a card on the paragraph (Thiazides,
  // another part than the quiz's and the cards', which V's spread would mark).
  if (!db.edits) db.edits = [];
  const before = db.sections[3].markdown.split("\n\n")[2];
  db.edits.push({ id: hex("7d200000", 1), lecture_id: L, part_idx: 3, anchor: 2, kind: "paragraph", before_text: before, after_text: before.replace("כ-5%", "כ-5%-7%"), author_id: id("איתי"), approved_by: id("שוהם"), aloud: false, source_kind: "slide", source_slides: [9], source_at: null, source_note: "", created_at: ago(120) });
  if (db.updates) db.updates.push({ id: hex("7d210000", 1), user_id: id("נועה"), edit_id: hex("7d200000", 1), lecture_id: L, part_idx: 3, anchor: 2, reason: "card", reason_at: ago(60 * 48), created_at: ago(110), seen_at: null });

  // The group's open question (איתי's), newest.
  db.comments.push({ id: hex("7d400000", 1), lecture_id: L, part_idx: 2, anchor: 2, quote: "NKCC2", kind: "question", body: "למה Furosemide עובדת גם כשה-GFR נמוך?", parent_id: null, resolved: false, author_id: id("איתי"), created_at: ago(60 * 20) });

  // Cards: every part with cards in נועה's deck (ten new), a trap card (new for all), her private card,
  // and a card she forgot twice (due since yesterday) with the wall's winning association on its paragraph.
  const card = (o) => cardsPlugin.trapCard(db, { source: "ai", created_by: id("שוהם"), anchor: null, quote: "", ...o });
  for (const part of [0, 1, 2, 3, 4]) for (const s of cardsPlugin.SAMPLES[part]) {
    const { para, ...f } = s;
    card({ lecture_id: L, part_idx: part, ...f, anchor: para ?? null });
  }
  card({ source: "trap", lecture_id: L, part_idx: 2, kind: "qa", front: "Furosemide או Thiazide: מי מעלה סידן בשתן?", back: "Furosemide (Loop) מעלה; Thiazide מורידה.", slides: [8], trap_key: "e2e-trap" });
  const forgot = card({ lecture_id: L, part_idx: 2, anchor: 2, kind: "qa", front: "איזה טרנספורטר מעכבות Loop diuretics?", back: "NKCC2.", extra: "בלולאה העולה העבה.", slides: [6] });
  for (const part of [0, 1, 2, 3, 4]) C.adoptions.push({ user_id: id("נועה"), lecture_id: L, part_idx: part, added_at: ago(60 * 72) });
  const yesterday = Date.now() - 86_400_000;
  C.states.set(`${id("נועה")}:${forgot.id}`, {
    user_id: id("נועה"), card_id: forgot.id, state: 2, step: 0, stability: 1.2, difficulty: 7.5, due: new Date(yesterday).toISOString(), last_review: new Date(yesterday - 3 * 86_400_000).toISOString(),
    reps: 5, lapses: 2, suspended: false, updated_at: new Date(yesterday).toISOString(),
  });
  cardsPlugin.mistakeCard(db, id("נועה"), { lecture_id: L, part_idx: 2, anchor: 2, origin: "quiz", question_id: Q[0].id, front: "Furosemide: איזה טרנספורטר היא מעכבת?", back: "NKCC2", extra: "ענית NCC, אבל NCC הוא של ה-Thiazides. [ש' 6]", slides: [6] });
  C.settings.set(id("נועה"), { new_per_day: 20, retention: 0.9, home: "app" });
  C.settings.set(id("דנה"), { new_per_day: 20, retention: 0.9, home: "anki" });
  if (db.aids) {
    db.aids.push({ id: hex("7d500000", 1), group_id: db.group.id, lecture_id: L, part_idx: 2, anchor: 2, quote: "", drug: "Furosemide", kind: "line", body: "NKCC2 = שני כ׳ ושני סודיום: Furosemide סוגרת את שניהם.", fact: "Loop diuretics מעכבות NKCC2", slides: [6], photo: null, figure: null, remix_of: null, draft_id: null, draft_no: null, named_by: id("איתי"), credit_id: null, funny_n: 3, stuck_n: 4, flag: null, flagged_by: null, check_state: "ok", checked_at: ago(600), check_note: null, edited_at: null, created_at: ago(60 * 30) });
    db.aidWinners.push({ lecture_id: L, part_idx: 2, anchor: 2, aid_id: hex("7d500000", 1), since: ago(60 * 20) });
  }

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
    page.on("pageerror", (e) => mock.problems.push(`pageerror ${who}: ${e.message}`));
    return page;
  };
  const rows = (page) => page.locator(".t-queue .t-row").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-kind")}: ${e.innerText.replace(/\s+/g, " ").trim()}`));
  const callsBy = (who) => T.calls.filter((c) => c.who === id(who)).length;
  try {
    if (!flags.today) {
      /* ── Nothing of T without its flag ── */
      const noa = await open("נועה");
      await noa.locator("main").first().waitFor({ timeout: 15000 });
      await noa.waitForTimeout(800);
      expect((await noa.locator("main.today").count()) === 0 && (await noa.locator("main.library").count()) === 1, "/ is the library, not Today");
      expect((await noa.locator(".ph-tabs .ph-tab", { hasText: "היום" }).count()) === 0, "no \"היום\" tab");
      await noa.goto(`${mock.base}/?v=today&run=1`);
      await noa.locator("main").first().waitFor({ timeout: 15000 });
      await noa.waitForTimeout(800);
      expect((await noa.locator("main.today").count()) === 0 && (await noa.locator("main.library").count()) === 1, "?v=today&run=1 opens no session: the library");
      expect(T.calls.length === 0, "study_today is never called");
    } else {
      /* ── 1. Today, as today.html s1 ── */
      const noa = await open("נועה");
      await noa.locator("main.today .t-queue, main.today .t-empty").first().waitFor({ timeout: 20000 });
      const title = (await noa.locator(".ph-head .t").first().innerText()).trim();
      expect(/^היום · (יום [א-ו]׳|שבת)$/.test(title), `the title: ${title}`);
      expect((await noa.locator(".ph-tabs .ph-tab", { hasText: "היום" }).getAttribute("aria-current")) === "page", "the tab \"היום\" is current");
      await noa.locator(".m-band").first().waitFor({ timeout: 10000 });
      expect((await noa.locator(".m-band").first().innerText()).includes("הקבוצה היום"), "the day's meeting on top (M's band)");
      const minutes = await noa.locator(".t-minutes button").allInnerTexts();
      expect(minutes.join(" · ") === "10 · 20 דק׳ · 45", `the minute chips: ${minutes.join(" · ")}`);
      expect((await noa.locator(".t-sec .a-chip", { hasText: "רק לך" }).count()) === 1, "\"רק לך\" beside \"התור שלי\"");
      await noa.locator('.t-row[data-kind="card"]').waitFor({ timeout: 15000 });
      steps.rows = await rows(noa);
      const kinds = steps.rows.map((r) => r.split(":")[0]);
      const want = ["update", "quiz", ...(progress ? ["danger"] : []), ...(again ? ["again"] : []), "unclear", "card", "quiz", ...(pulse ? ["practice"] : [])];
      expect(JSON.stringify(kinds) === JSON.stringify(want), `the rows in the table's order: ${kinds.join(", ")} (expect ${want.join(", ")})`);
      expect(steps.rows[0].includes("עדכון בסיכום") && steps.rows[0].includes("תוקן אחרי שלמדת"), "the update's row");
      expect(steps.rows[1].includes("1 מהמבחן הקבוצתי") && steps.rows[1].includes("טעית אתמול") && steps.rows[1].includes("Furosemide: איזה טרנספורטר") && /ש׳ 6/.test(steps.rows[1]), "the quiz return: its chip, its question and slide");
      if (progress) expect(steps.rows[2].includes("1 מטעויות ׳על בטוח׳, בניסוח חדש") && steps.rows[2].includes("על בטוח") && steps.rows[2].includes("איזה אנזים מעכבת"), "the danger row in its other wording (progress)");
      else expect(!steps.rows.some((r) => r.includes("מטעויות ׳על בטוח׳")), "no danger row without progress");
      if (again) {
        const againRow = steps.rows.find((r) => r.startsWith("again"));
        expect(againRow.includes("טעות אחת בניסוח אחר") && againRow.includes("בניסוח אחר"), `Q-2's row from A2's counts: ${againRow}`);
      }
      if (pulse) {
        const pulseRow = steps.rows.find((r) => r.startsWith("practice"));
        expect(pulseRow.includes("תרגול קצר · Loop diuretics") && pulseRow.includes("חלש אצלך, ולא אצל הקבוצה"), `U-2's "רק אצלך חם" row: ${pulseRow}`);
      }
      const unclearRow = steps.rows.find((r) => r.startsWith("unclear"));
      expect(unclearRow.includes("פסקה שסימנת ׳לא ברור׳") && unclearRow.includes("מהפגישה") && unclearRow.includes("היפוקלמיה"), "the \"לא ברור\" paragraph from the meeting");
      const cardRow = steps.rows.find((r) => r.startsWith("card"));
      // Due: the forgotten card; new: her ten in the deck, the trap card and her private card (first among the new).
      expect(/13 כרטיסים/.test(cardRow) && cardRow.includes("הגיע הזמן") && cardRow.includes("למשל"), `the cards' row: ${cardRow}`);
      const startText = (await noa.locator(".t-start .a-btn.primary").innerText()).trim();
      steps.start = startText;
      const step2Row = steps.rows[steps.rows.length - (pulse ? 2 : 1)];
      expect(step2Row.includes("1 מהמבחן הקבוצתי") && step2Row.includes("טעית לפני 3 ימים"), "the third day's return after the cards");
      // 30 + 75 + 90 + 13 × 30 + 75 = 660 s (+ 75 with the danger row, + 75 with Q-2's, + 180 with U-2's topic).
      const fullSeconds = 660 + (progress ? 75 : 0) + (again ? 75 : 0) + (pulse ? 180 : 0);
      expect(startText === `להתחיל · ${Math.ceil(fullSeconds / 60)} דק׳`, `"${startText}"`);
      expect((await noa.locator(".t-flame").innerText()).trim() === "ימי למידה 4/7", "the flame 4/7");
      await noa.locator(".t-flame").click();
      expect((await noa.locator(".t-flame-line").innerText()).includes("4 מתוך 7 הימים האחרונים") && (await noa.locator(".t-flame-line").innerText()).includes("גלוי רק לך"), "the flame's line, private");
      await noa.locator(".t-flame").click();
      const group = await noa.locator(".t-group").innerText();
      expect(group.includes("שאלה פתוחה") && group.includes("איתי") && group.includes("למה Furosemide עובדת"), "\"בקבוצה\": איתי's open question with \"לענות\"");
      expect((await noa.locator(".t-group").getByRole("link", { name: "לענות" }).getAttribute("href")).includes(`l=${L}`), "\"לענות\" opens its paragraph");
      await noa.evaluate(() => window.scrollTo(0, 0));
      await shot(noa, "today-1-home");

      /* ── 2. the minute chips: 10 cuts greedily, and the choice stays on this device ── */
      await noa.locator(".t-minutes button", { hasText: /^10$/ }).click();
      const ten = await rows(noa);
      steps.ten = ten;
      // 600 s: update 30, quiz 75, (danger 75), unclear 90, then the cards of 30 s while they fit; the third
      // day's return (75 s) fits only when the cards leave room for it: greedy, in the table's order.
      const used = 30 + 75 + (progress ? 75 : 0) + (again ? 75 : 0) + 90;
      const cardsFit = Math.min(13, Math.floor((600 - used) / 30));
      expect(ten.some((r) => r.startsWith("card") && r.includes(`${cardsFit} כרטיסים`)), `10 minutes: ${cardsFit} cards (${ten.find((r) => r.startsWith("card"))})`);
      const step2Fits = used + cardsFit * 30 + 75 <= 600;
      expect(ten.some((r) => r.includes("טעית לפני 3 ימים")) === step2Fits, `10 minutes: the third day's return ${step2Fits ? "fits" : "waits for tomorrow"}`);
      expect((await noa.locator(".t-start .a-btn.primary").innerText()).trim() === `להתחיל · ${Math.ceil((used + cardsFit * 30 + (step2Fits ? 75 : 0)) / 60)} דק׳`, "the start's minutes follow the cut");
      await noa.reload();
      await noa.locator('.t-row[data-kind="card"]').waitFor({ timeout: 15000 });
      expect((await noa.locator(".t-minutes button[aria-pressed=true]").innerText()).trim() === "10 דק׳", "10 kept after a reload (per device)");
      await noa.locator(".t-minutes button", { hasText: /^20$/ }).click();
      await noa.locator(".t-minutes button[aria-pressed=true]", { hasText: "20 דק׳" }).waitFor();

      /* ── 3. the session ── */
      await noa.locator(".t-start .a-btn.primary").click();
      await noa.waitForURL((u) => u.search.includes("run=1"), { timeout: 10000 });
      // 3a. V's update card.
      await noa.locator(".t-session .v-update").waitFor({ timeout: 15000 });
      expect((await noa.locator(".t-progress").innerText()).trim() === `0/${17 + (progress ? 1 : 0) + (again ? 1 : 0) + (pulse ? 1 : 0)}`, `the session's count: ${await noa.locator(".t-progress").innerText()}`);
      await shot(noa, "today-2-update");
      await noa.locator(".v-update").getByRole("button", { name: "הבנתי" }).click();
      expect(true, "\"הבנתי\" on the update");
      // 3b. The quiz return as practice's question.
      await noa.locator(".t-session .pq-options").waitFor({ timeout: 15000 });
      expect((await noa.locator(".t-session .ph-sub").innerText()).includes("טעית אתמול"), "the step's reason: \"טעית אתמול\"");
      expect((await noa.locator(".t-why").innerText()).includes("הבנת בדיון"), "\"הבנתי בדיון\" said");
      await shot(noa, "today-3-question");
      const opts = await noa.locator(".pq-options button.a-opt .pq-text").allInnerTexts();
      await noa.locator(".pq-options button.a-opt").nth(opts.findIndex((t) => t.includes("NKCC2"))).click();
      await noa.locator(".pq-bets").getByRole("radio", { name: "על בטוח", exact: true }).click();
      await noa.getByRole("button", { name: "לבדוק" }).click();
      await noa.locator(".pq-autopsy, .pq-verdict").first().waitFor({ timeout: 10000 });
      const ans = P.answers.find((a) => a.user_id === id("נועה") && a.question_id === Q[0].id);
      expect(ans && ans.mode === "mistakes" && ans.correct && ans.confidence === 3, "answered as a return (mode \"mistakes\", the bet, right)");
      await noa.getByRole("button", { name: "להמשיך" }).click();
      if (progress) {
        // 3b'. The danger row, asked in its other wording.
        await noa.locator(".t-session .pq-options").waitFor({ timeout: 15000 });
        expect((await noa.locator(".t-session .pq-lead").innerText()).includes("איזה אנזים מעכבת"), "the danger row's other wording");
        await noa.locator(".pq-options button.a-opt").first().click();
        await noa.locator(".pq-bets").getByRole("radio", { name: "נראה לי", exact: true }).click();
        await noa.getByRole("button", { name: "לבדוק" }).click();
        await noa.getByRole("button", { name: "להמשיך" }).click();
      }
      if (again) {
        // 3b''. Q-2's row: "לתרגל" opens what is due again today, in another wording; Back returns here.
        await noa.locator(".t-other").waitFor({ timeout: 15000 });
        expect((await noa.locator(".t-session .ph-sub").innerText()).includes("בניסוח אחר") && (await noa.locator(".t-other").innerText()).includes("טעות אחת בניסוח אחר"), "Q-2's step, with its reason");
        await shot(noa, "today-3b-again", { primary: ".ph-foot .a-btn.primary" });
        await noa.getByRole("button", { name: "לתרגל" }).click();
        await noa.waitForURL((u) => u.search.includes(`s=r.${db.group.id}`), { timeout: 15000 });
        await noa.locator(".practice-session .pq-options").waitFor({ timeout: 20000 });
        expect((await noa.locator(".practice-session").innerText()).includes("על איזה קולטן פועלת Spironolactone?") && (await noa.locator(".pq-again").count()) === 1, "the missed guess asked as its paragraph's other question, \"בניסוח אחר\"");
        await noa.locator(".pq-options button.a-opt .pq-text", { hasText: "הקולטן למינרלוקורטיקואידים" }).click();
        await noa.locator(".pq-bets").getByRole("radio", { name: "נראה לי", exact: true }).click();
        await noa.getByRole("button", { name: "לבדוק" }).click();
        await noa.locator(".pq-autopsy, .pq-verdict").first().waitFor({ timeout: 10000 });
        const sent = P.answers.filter((a) => a.user_id === id("נועה") && a.question_id === Q5.id).pop();
        expect(sent && sent.mode === "mistakes" && sent.correct, "answered in practice's mistakes mode");
        await noa.goBack();
        await noa.waitForURL((u) => u.search.includes("run=1"), { timeout: 15000 });
      }
      // 3c. The "לא ברור" paragraph.
      await noa.locator(".t-unclear").waitFor({ timeout: 15000 });
      expect((await noa.locator(".t-unclear").innerText()).includes("היפוקלמיה") && (await noa.locator(".t-unclear").innerText()).includes("עצרנו להסביר"), "the paragraph, and that the meeting stopped on it");
      expect((await noa.locator(".t-unclear").getByRole("link", { name: "לפסקה" }).getAttribute("href")).includes(`l=${L}`), "\"לפסקה\" to its paragraph");
      await shot(noa, "today-4-unclear", { primary: ".ph-foot .a-btn.primary" });
      await noa.getByRole("button", { name: "הבנתי" }).click();
      // 3d. C's review for the cut's seven cards: the forgotten one first, with the wall's hint.
      await noa.locator(".card-panel").waitFor({ timeout: 15000 });
      expect((await noa.locator(".review-top .back").innerText()).trim() === "→ להיום", "the review's back reads \"→ להיום\"");
      expect((await noa.locator(".review-progress").innerText()).trim() === "0/13", `the review holds the cut's 13: ${await noa.locator(".review-progress").innerText()}`);
      if (flags.wall) {
        await noa.locator(".wall-hint").waitFor({ timeout: 10000 });
        await noa.locator(".review-top .ph-sub", { hasText: "שכחת את הכרטיס הזה פעמיים, אז מגיע רמז" }).waitFor({ timeout: 5000 });
        expect((await noa.locator(".card-panel .a-chip.bad").innerText()).trim() === "נשכח פעמיים", "\"נשכח פעמיים\" and the wall's hint, with its line (cards.html s2)");
      }
      await shot(noa, "today-5-card-hint", { primary: ".ph-foot .a-btn.primary" });
      let seenNext = false;
      // "קל" on each: no learning step brings a card back within this session (C's own rule would).
      for (let i = 0; i < 13; i++) {
        if (!seenNext && (await noa.locator(".next-mine").count())) {
          seenNext = true;
          steps.nextMine = (await noa.locator(".next-mine").innerText()).replace(/\n/g, " | ");
        }
        await noa.getByRole("button", { name: "להציג תשובה" }).click();
        await noa.locator(".card-buttons").waitFor({ timeout: 5000 });
        if (i === 0) await shot(noa, "today-6-card-back", { primary: ".ph-foot .card-btn.good" });
        await noa.locator(".card-buttons .card-btn.easy").click();
        if (i < 12) await noa.locator(".card-panel.front-side").waitFor({ timeout: 5000 });
      }
      // 3e. After the cards, the third day's return.
      await noa.locator(".t-session .pq-options").waitFor({ timeout: 15000 });
      expect((await noa.locator(".t-session .ph-sub").innerText()).includes("טעית לפני 3 ימים"), "after the cards, back to Today's session: the third day's return");
      await noa.locator(".pq-options button.a-opt").first().click();
      await noa.locator(".pq-bets").getByRole("radio", { name: "ניחוש", exact: true }).click();
      await noa.getByRole("button", { name: "לבדוק" }).click();
      await noa.getByRole("button", { name: "להמשיך" }).click();
      expect(seenNext && /הבא בתור · מטעות שלך/.test(steps.nextMine) && /מהמבחן הקבוצתי/.test(steps.nextMine), `her private card announced: ${steps.nextMine}`);
      if (pulse) {
        // 3e'. U-2's topic: "לתרגל" opens the topic's practice; Back returns to the end.
        await noa.locator(".t-other").waitFor({ timeout: 15000 });
        expect((await noa.locator(".t-session .ph-sub").innerText()).includes("חלש אצלך, ולא אצל הקבוצה") && (await noa.locator(".t-other").innerText()).includes("Loop diuretics"), "U-2's step, with its reason");
        await noa.getByRole("button", { name: "לתרגל" }).click();
        await noa.waitForURL((u) => u.search.includes("s=t.loop") && u.search.includes("n=5"), { timeout: 15000 });
        expect(true, "the topic's practice, five questions");
        await noa.goBack();
        await noa.waitForURL((u) => u.search.includes("run=1"), { timeout: 15000 });
      }
      // 3f. The end.
      await noa.locator(".t-done").waitFor({ timeout: 15000 });
      expect((await noa.locator(".t-done").innerText()).includes("התור של היום הושלם. מה שנשאר עובר למחר."), "the end's words");
      expect(C.reviews.filter((r) => r.user_id === id("נועה")).length + C.myReviews.filter((r) => r.user_id === id("נועה")).length >= 1, "the answers went through the outbox");
      await shot(noa, "today-7-done", { primary: ".ph-foot .a-btn.primary" });

      /* ── 4. Today again: what she did is gone ── */
      await noa.getByRole("link", { name: "להיום" }).click();
      await noa.locator("main.today .t-queue, main.today .t-empty").first().waitFor({ timeout: 15000 });
      await noa.waitForTimeout(800);
      const after = await rows(noa);
      steps.after = after;
      expect(!after.some((r) => /^(update|quiz|unclear|danger|again):/.test(r)), `the update, the return and the paragraph are done: ${after.join(" / ")}`);
      if (!after.length) {
        expect((await noa.locator(".t-empty").innerText()).trim() === "אין כלום בתור כרגע.", "the empty queue's words");
        await shot(noa, "today-8-empty");
      }

      /* ── 5. דנה: the missed meeting, Anki as her home, nothing of נועה's ── */
      const dana = await open("דנה");
      await dana.locator("main.today .t-missed").waitFor({ timeout: 20000 });
      const missed = await dana.locator(".t-missed").innerText();
      expect(missed.includes("פגישה שפספסת") && /השלמה( · \d+ דק׳)?/.test(missed), `the missed meeting with its catch-up: ${missed.replace(/\n/g, " | ")}`);
      await dana.locator(".t-missed .t-catchup", { hasText: /דק׳/ }).waitFor({ timeout: 10000 });
      expect((await dana.locator(".t-missed").getAttribute("href")).includes(`m=${Y}`), "it opens M's catch-up");
      await dana.waitForTimeout(800);
      expect((await dana.locator('.t-row[data-kind="card"]').count()) === 0, "her home is Anki: no cards row (C6)");
      const danaBodies = T.bodies.filter((b) => b.who === id("דנה")).map((b) => b.body).join(" ");
      expect(!danaBodies.includes(Q[0].id) && !danaBodies.includes(Q[2].id) && !danaBodies.includes("היפוקלמיה"), "none of נועה's rows reach דנה");
      expect((await dana.locator(".t-flame").innerText()).trim() === "ימי למידה 0/7", "her own flame");
      await shot(dana, "today-9-missed");
      await dana.locator(".t-missed").click();
      await dana.locator(".m-catchup").waitFor({ timeout: 15000 });
      expect((await dana.locator(".m-catchup .back").first().innerText()).trim() === "→ להיום", "catch-up's back reads \"→ להיום\"");
      const itai = await open("איתי");
      await itai.locator("main.today .t-queue, main.today .t-empty").first().waitFor({ timeout: 20000 });
      await itai.waitForTimeout(600);
      expect((await itai.locator(".t-group", { hasText: "למה Furosemide עובדת" }).count()) === 0, "איתי never sees his own question in \"בקבוצה\"");
      expect(!JSON.stringify(T.bodies).includes("הסבר") && !T.bodies.some((b) => /"answer"\s*:/.test(b.body)), "no key in any answer of study_today");

      /* ── 6. the review on its own, done for today: its end leads to Today ── */
      const n2 = await open("נועה", "/?v=cards&s=today");
      await n2.locator(".review-end").waitFor({ timeout: 15000 });
      expect((await n2.locator(".review-end").getByRole("link", { name: "להיום" }).count()) === 1, "the review's end offers \"להיום\" once Today is the home");
      expect(callsBy("נועה") >= 2 && callsBy("דנה") >= 1, "study_today was asked by each member for her own");
    }
    steps.unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ errors: problems, ok: ok.length, checks: ok, steps, a11y }, null, 1));
    if (problems.length || a11y.length || steps.unmocked.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    for (const [who, pg] of Object.entries(pages)) await pg.screenshot({ path: `${out}/fail-${who}.png` }).catch(() => undefined);
    console.error(JSON.stringify({ problems: mock.problems, ok, steps, today: T.bodies.slice(-2), calls: mock.calls.slice(-25) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
