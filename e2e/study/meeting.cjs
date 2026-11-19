// M-3, M-4, M-5 (spec §12.4.M; the meeting design's 9.M): the day's meeting
// end to end, on the shared mock with package M's plugin (e2e/study/mocks/
// meeting.cjs) over Z's quizzes, Q's questions and K's proposals. Seven
// members (שוהם, נועה, מאיה, איתי, דניאל, רוני, דנה) at 390×844, light and
// dark, a11y.cjs at every screenshot step (390 and 360 px), no page error,
// no unmocked call.
//
//   NODE_PATH=$(npm root -g) node e2e/study/meeting.cjs <dist> <out dir> [off|rel1|rel2|k|m]
//
// With the meeting's flags (set "m": wave 3's flags + MEETING + GUESS):
//   1  Shoham plans today's meeting (the lecture, parts 0-1; no reader is
//      planned ahead, M 2); "יחד" shows the band "הקבוצה היום · HH:MM · ש׳ 1-5"
//      with no reader line;
//   2  M-2: four members guess before the reading (no key on any phone);
//   3  "שאלות פתיחה": Noa opens it, two join, three questions stacked with
//      "1/3"…, each reveal a word ("רובכם צדקו"), never a number; the agenda's
//      lines (today's reading, the open question sent from yesterday);
//   4  Shoham reads aloud ("להתחיל להקריא"), Noa, Maya and Itai follow;
//      with the switch pulse the reader is warned before guess 1's paragraph;
//      the reading reaches it: every follower's "דינג! התשובה לניחוש 1" with
//      her own line; a second member's "להקריא לקבוצה" gets the "reading" toast;
//   5  Noa and Maya tap "לא ברור לי" on one paragraph: Shoham's card shows
//      nothing; Itai's third tap: "3 ׳לא ברור׳ · בלי שמות"; no follower ever
//      asks for the reader's card; "לעצור ולהסביר" clears it; on the next
//      paragraph "לשאלה פתוחה למחר" posts a question;
//   6  K-2's "אישור בקול" for Noa's pending proposal on the paragraph being
//      read, with two others following;
//   7  at the part's last paragraph "עצירה: שאלה אחת על החלק" opens a
//      one-question quiz; the meeting screen's closing "מבחן קבוצתי על מה
//      שנקרא · 5 שאלות" opens the lobby with the parts read;
//   8  M-5: Dana, absent yesterday, sees "פגישה שפספסת" on "יחד", the pack,
//      the check, and the end line; "קראו" lists her from the next study day
//      at the meeting's time; Noa, who was there, is never offered it.
// Without the meeting's flag: no meeting card on "יחד", ?v=meeting and
// ?v=catchup replaced, and nothing calls section M.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");

const [dist, out, flagArg] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/meeting.cjs <dist> <out dir> [off|rel1|rel2|k|m]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(flagArg);
const PLACE_MS = 40_000; // a place update waits for its presence slot (≤ 7 s per channel)
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms - 4 * 3_600_000));
const israel = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

(async () => {
  const mock = await createMock({ dist, flags: flags.set, members: ["שוהם", "נועה", "מאיה", "איתי", "דניאל", "רוני", "דנה"] });
  const { db, LECTURE_ID: L, GROUP } = mock;
  mock.seedLecture();
  const id = (name) => mock.people[name].user.id;
  const P = db.practice;
  const M = db.meetingMock;

  /* ── yesterday's lecture L2, its parts and questions; today's questions on L's first part ── */
  const L2 = hex("3e200000", 1);
  const t0 = ago(60 * 24 + 30); // yesterday's meeting started 24.5 hours ago
  db.lectures.push({
    id: L2, group_id: GROUP.id, course: "פרמקולוגיה", title: "Antiparasitic agents", lecturer: "", lecture_date: "2026-11-16", source_name: "p.pptx", source_kind: "pptx", status: "ready", error: null,
    created_by: id("שוהם"), created_at: ago(60 * 48), updated_at: ago(60 * 48), queued_at: null, deleted_at: null, deleted_by: null,
    slides: Array.from({ length: 20 }, (_, i) => ({ n: i + 1, title: `שקף ${i + 1}`, lines: [], tables: [], notes: "", figures: [] })),
  });
  db.sections.push(
    { lecture_id: L2, idx: 0, title: "Leishmaniasis: טיפול", slide_from: 1, slide_to: 10, markdown: "## Leishmaniasis: טיפול\n\nMiltefosine טרטוגנית: אמצעי מניעה בטיפול ועוד 5 חודשים. [ש' 6]\n\nPentostam דורשת ECG לפני ובמהלך הטיפול. [ש' 8]", status: "ready", error: null, updated_at: ago(60 * 48), lease_until: null, attempts: 0, retry_at: null, writer: null, rev: 0, gen: 0 },
    { lecture_id: L2, idx: 1, title: "מנגנונים", slide_from: 11, slide_to: 20, markdown: "## מנגנונים\n\nSb(V) הופך ל-Sb(III) בתוך הטפיל. [ש' 15]", status: "ready", error: null, updated_at: ago(60 * 48), lease_until: null, attempts: 0, retry_at: null, writer: null, rev: 0, gen: 0 },
  );
  const question = (n, o) => ({
    id: hex("3e300000", n), group_id: GROUP.id, batch_id: null, exam_id: null, exam_no: null, ref_lecture: null, source: "ai", kind: "mcq", difficulty: 2, vignette: "",
    topic: "x", aspect: "uses", has_key: true, model: "mock", created_by: id("שוהם"), created_at: ago(300 - n), retired_at: null, retired_by: null, retire_note: "", quote: "",
    part_gen: 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null, style: null, points: [], request_id: null, ...o,
  });
  const Q = [
    // yesterday's parts (L2 ¶0): the opening's two, a teaser first; one older (L2 part 1)
    question(1, { lecture_id: L2, part_idx: 0, anchor: 1, slides: [6], teaser: "Miltefosine סיימה קורס, אבל עוד לא עזבה", question: "מה Miltefosine מחייבת אחרי הקורס?", options: ["אמצעי מניעה בטיפול ו-5 חודשים אחריו", "בדיקת G6PD לפני כל מנה", "בלי אלכוהול 48 שעות", "ניטור ECG בכל הטיפול"] }),
    question(2, { lecture_id: L2, part_idx: 0, anchor: 2, slides: [8], question: "למה Pentostam דורשת ECG?", options: ["הארכת QTc", "היפוקלמיה", "ברדיקרדיה בלבד", "אין צורך"] }),
    question(3, { lecture_id: L2, part_idx: 1, anchor: 1, slides: [15], question: "איך Pentostam הופכת לפעילה?", options: ["Sb(V) → Sb(III)", "Sb(III) → Sb(V)", "אצטילציה בכבד", "אין שינוי"] }),
    // today's first part (L ¶0.1, ¶0.2): the two guesses
    question(4, { lecture_id: L, part_idx: 0, anchor: 1, slides: [1], teaser: "משתן על כל מקטע", question: "מה מגבירים משתנים בשתן?", options: ["הפרשת Na⁺ ומים", "ספיגת K⁺", "הפרשת גלוקוז", "ספיגת מים בלבד"] }),
    question(5, { lecture_id: L, part_idx: 0, anchor: 2, slides: [2], question: "איפה נספג רוב ה-Na⁺?", options: ["proximal tubule", "thick ascending limb", "distal convoluted tubule", "collecting duct"] }),
    question(6, { lecture_id: L, part_idx: 1, anchor: 2, slides: [4], question: "מה מעכבת Acetazolamide?", options: ["carbonic anhydrase", "NKCC2", "NCC", "ENaC"] }),
  ];
  P.questions.push(...Q);
  for (const q of Q) P.keys.set(q.id, { answer: 0, explanations: q.options.map((o, i) => (i === 0 ? `${o}: כך בשקף. [ש' ${q.slides[0]}]` : `${o}: לא לפי השקף.`)), takeaway: "מה לזכור", whens: q.options.map(() => "") });

  /* ── yesterday's meeting on L2: Noa was there, Dana was not; a stop, an answered question, a question sent to today ── */
  const Y = hex("3e000000", 900);
  M.meetings.push({
    id: Y, group_id: GROUP.id, day: dayOf(Date.parse(t0)), starts_at: t0, lecture_id: L2, part_from: 0, part_to: 0, title: "", planned_reader: null, reader_id: id("שוהם"), reading: false,
    started_at: t0, read_part: 0, guess_ids: [], guess_released: 0, cancelled_at: null, version: 3, created_by: id("שוהם"), updated_by: null, created_at: t0, updated_at: t0,
  });
  for (const who of ["נועה", "מאיה", "איתי", "דניאל", "רוני"]) M.presence.set(`${Y}:${id(who)}`, { first: Date.parse(t0), last: Date.parse(t0) + 3_600_000 });
  M.events.push({ meeting_id: Y, kind: "explain", part: 0, anchor: 1, quote: "", comment_id: null, by: id("שוהם"), at: Date.parse(t0) + 600_000 });
  const plus = (min) => new Date(Date.parse(t0) + min * 60_000).toISOString();
  db.comments.push(
    { id: hex("3e400000", 1), lecture_id: L2, part_idx: 0, anchor: 2, quote: "Pentostam", kind: "question", body: "למה Pentostam מחייבת ECG?", parent_id: null, resolved: true, author_id: id("איתי"), created_at: plus(5) },
    { id: hex("3e400000", 2), lecture_id: L2, part_idx: 0, anchor: 2, quote: "", kind: "comment", body: "הארכת QTc, היפוך גלי T והפרעות קצב. [ש' 8]", parent_id: hex("3e400000", 1), resolved: false, author_id: id("מאיה"), created_at: plus(20) },
    { id: hex("3e400000", 3), lecture_id: L2, part_idx: 1, anchor: 1, quote: "Sb(V)", kind: "question", body: "מה עושה LMT-Ros3?", parent_id: null, resolved: false, author_id: id("מאיה"), created_at: plus(25) },
  );
  M.events.push({ meeting_id: Y, kind: "question", part: 1, anchor: 1, quote: "", comment_id: hex("3e400000", 3), by: id("שוהם"), at: Date.parse(t0) + 1_600_000 });

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
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (await fn()) return true;
      await new Promise((ok) => setTimeout(ok, 150));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const open = async (who, path) => (await mock.open(browser, who, { path })).page;
  const calledBy = (fn, who) => M.calls.filter((c) => c.fn === fn && c.who === id(who)).length;
  /** Puts a paragraph on the reading line (a third of the way down), as reading scrolls it there. */
  const readTo = async (page, part, anchor) => {
    await page.evaluate(
      ([p, a]) => {
        const el = document.querySelector(`.lecture-body [data-part="${p}"] [data-blk="${a}"]`);
        if (!el) return;
        const head = document.querySelector(".reader-top")?.getBoundingClientRect().bottom ?? 0;
        window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - Math.max(head + 4, window.innerHeight / 3 - 4));
      },
      [part, anchor],
    );
    await page.waitForTimeout(600);
  };
  /** Runs fn at 390×844 and at 360×640, then puts the viewport back. */
  const atSizes = async (page, fn) => {
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
  };
  const boxOf = (page, sel) =>
    page.evaluate((q) => {
      const el = document.querySelector(q);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x0: Math.round(r.left), x1: Math.round(r.right), y0: Math.round(r.top), y1: Math.round(r.bottom), w: window.innerWidth, h: window.innerHeight };
    }, sel);
  /** The reader's screen: how much the sticky top takes, and "ההקראה שלך משותפת" shown once (review M-SHARED-LABEL-TWICE). */
  const readerTop = (page) =>
    atSizes(page, async () => {
      const top = await boxOf(page, ".reader-top");
      const shared = await page.evaluate(() => [...document.querySelectorAll(".reader-top *")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes("ההקראה שלך משותפת"))).length);
      const cut = await page.evaluate(() => {
        const st = document.querySelector(".room-bar .room-status");
        return st ? st.scrollWidth > st.clientWidth + 1 : null;
      });
      return { bottom: top.y1, share: Math.round((top.y1 / top.h) * 100), shared, cut };
    });

  try {
    if (!flags.meeting) {
      /* ── without the flag: no meeting anywhere, nothing calls section M ── */
      const noa = await open("נועה", "/?v=group");
      await noa.getByRole("heading", { name: "יחד" }).waitFor({ timeout: 15000 });
      await noa.waitForTimeout(800);
      check("off: no meeting card on יחד", (await noa.locator(".m-card, .m-band").count()) === 0 && !(await noa.getByText("לקבוע את הפגישה הבאה").count()));
      await noa.goto(`${mock.base}/?v=meeting&m=${Y}`);
      await noa.waitForTimeout(1500);
      check("off: ?v=meeting is replaced", !search(noa).includes("v=meeting"), search(noa));
      await noa.goto(`${mock.base}/?v=catchup&m=${Y}`);
      await noa.waitForTimeout(1500);
      check("off: ?v=catchup is replaced", !search(noa).includes("v=catchup"), search(noa));
      await noa.goto(`${mock.base}/?l=${L}`);
      await noa.locator(".summary").first().waitFor({ timeout: 20000 });
      await noa.waitForTimeout(800);
      check("off: nothing calls section M", M.calls.length === 0, JSON.stringify(M.calls.slice(0, 5)));
      await shot(noa, "meeting-off-group");
    } else {
      /* ── 1. planning, and the band on "יחד" ── */
      const shoham = await open("שוהם", "/?v=group");
      await shoham.locator(".m-card").waitFor({ timeout: 15000 });
      check("1 before planning: אין פגישה מתוכננת. with לקבוע את הפגישה הבאה", (await shoham.getByText("אין פגישה מתוכננת.").count()) === 1);
      await shoham.locator(".m-card").getByRole("link", { name: "לקבוע את הפגישה הבאה" }).click();
      const plan = shoham.getByRole("dialog", { name: "הפגישה הבאה" });
      await plan.locator(".m-parts .a-chip").first().waitFor({ timeout: 10000 });
      const soon = israel(Date.now() + 2 * 60_000);
      await plan.getByLabel("תאריך").fill(soon.date);
      await plan.getByLabel("שעה").fill(soon.time);
      await plan.getByRole("combobox").selectOption(L);
      await plan.locator(".m-parts .a-chip").nth(0).click();
      await plan.locator(".m-parts .a-chip").nth(0).click();
      await plan.locator(".m-parts .a-chip").nth(1).click();
      check("1 no reader is planned ahead: no \"מי מקריאים\" in the sheet", (await plan.getByRole("radiogroup").count()) === 0 && (await plan.getByText("מי מקריאים").count()) === 0);
      check("1 the plan: parts 0-1 chosen, the slide range under them", norm(await plan.locator(".m-parts + .a-small").innerText()) === "ש׳ 1-5", await plan.locator(".m-parts + .a-small").innerText());
      await shot(shoham, "meeting-01-plan");
      await plan.getByRole("button", { name: "לשמור" }).click();
      await plan.waitFor({ state: "detached", timeout: 10000 });
      const today = M.meetings.find((m) => m.id !== Y);
      check("1 saved: today, the lecture, parts 0-1, no reader sent", today && today.day === dayOf(Date.now()) && today.lecture_id === L && today.part_from === 0 && today.part_to === 1 && today.planned_reader === null && !M.readerSent, JSON.stringify(today));
      await shoham.goto(`${mock.base}/?v=group`);
      const band = shoham.locator(`.m-band[data-meeting="${today.id}"]`);
      await band.waitFor({ timeout: 10000 });
      const bandText = norm(await band.innerText());
      check(`1 "יחד": הקבוצה היום · ${soon.time} · ש׳ 1-5, no reader line`, bandText.startsWith(`הקבוצה היום · ${soon.time}`) && bandText.includes("ש׳ 1-5") && !bandText.includes("הקראה") && !bandText.includes("מי מקריאים"), bandText);
      if (flags.guess) {
        const g = await band.locator(".m-guess-btn").waitFor({ timeout: 10000 }).then(() => band.locator(".m-guess-btn").innerText()).catch(() => "none");
        check("1 M-2 on the band: ניחוש לפני · 2 שאלות (the band chose the two guesses)", norm(g) === "ניחוש לפני · 2 שאלות" && today.guess_ids.length === 2, g);
      }
      const noaG = await open("נועה", "/?v=group");
      await noaG.locator(`.m-band[data-meeting="${today.id}"]`).waitFor({ timeout: 10000 });
      check("1 Dana's yesterday is offered to her only: Noa (there) has no פגישה שפספסת", (await noaG.getByText("פגישה שפספסת").count()) === 0);
      await shot(noaG, "meeting-02-group");

      /* ── 2. M-2: the pre-guess, before the reading ── */
      const meetingUrl = `/?v=meeting&m=${today.id}`;
      const guessers = {};
      for (const [who, pick] of [["נועה", 1], ["מאיה", 1], ["איתי", 1], ["דניאל", 0]]) {
        const page = who === "נועה" ? noaG : await open(who, meetingUrl);
        if (who === "נועה") await page.goto(`${mock.base}${meetingUrl}`);
        const card = page.locator(".m-guess").first();
        await card.waitFor({ timeout: 15000 });
        await card.getByRole("button", { name: "לנחש" }).click();
        await card.locator(".a-opt").nth(pick).click();
        await until(() => M.guesses.some((g) => g.user_id === id(who)), 8000, `${who}'s guess`);
        guessers[who] = page;
      }
      const first = norm(await noaG.locator(".m-guess").first().locator(".a-row").first().innerText());
      check("2 ניחוש על היום · 1 מתוך 2 with יידלק בהקראה", first === "ניחוש על היום · 1 מתוך 2 יידלק בהקראה", first);
      check("2 her guess folds to its line: ניחשת ספיגת K⁺. with לשנות", norm(await noaG.locator(".m-guess").first().innerText()).endsWith("מה מגבירים משתנים בשתן? ניחשת ספיגת K⁺. לשנות"), await noaG.locator(".m-guess").first().innerText());
      check("2 no key on any phone before the reading", !M.bodies.some((b) => b.fn === "study_meeting_guess_state" && /"answer"|"explanation"/.test(b.body)));
      check("2 a guess is never an answer (study_answers untouched)", !P.answers.some((a) => [Q[3].id, Q[4].id].includes(a.question_id)));
      await shot(noaG, "meeting-03-guess");

      /* ── 3. "שאלות פתיחה": Noa opens it, Maya and Itai join; three stacked questions, a word per reveal ── */
      const noa = noaG;
      await noa.getByRole("button", { name: "לפתוח את שאלות הפתיחה" }).click();
      await noa.locator(".m-inline").waitFor({ timeout: 10000 });
      for (const who of ["מאיה", "איתי"]) {
        const page = guessers[who];
        await page.reload();
        await page.getByRole("button", { name: "להצטרף" }).click({ timeout: 15000 });
        await page.getByText("מחכים להתחלה.").waitFor({ timeout: 10000 });
      }
      await noa.getByRole("button", { name: /להתחיל · 3 שאלות/ }).click({ timeout: 10000 });
      const players = [noa, guessers["מאיה"], guessers["איתי"]];
      for (let round = 0; round < 3; round++) {
        for (const [i, page] of players.entries()) {
          const cur = page.locator(".m-current");
          await cur.locator(".a-opt").first().waitFor({ timeout: 20000 });
          await until(async () => !(await cur.locator(".a-opt").first().isDisabled()), 15000, "the question to open");
          // two right (option 0), one wrong
          await cur.locator(".a-opt").nth(i === 2 ? 1 : 0).click();
          if (round === 0 && i === 0) {
            const head = norm(await noa.locator(".ph-head").innerText());
            check("3 the opening's head: שאלות פתיחה · מה קראנו בפעם הקודמת with 1/3", head.includes("שאלות פתיחה · מה קראנו בפעם הקודמת") && head.includes("1/3"), head);
            await shot(noa, "meeting-04-coffee");
          }
          await cur.locator(".m-bets").getByRole("button", { name: "נראה לי" }).click();
        }
        await noa.locator(".m-folded").nth(round).waitFor({ timeout: 20000 });
        const chip = norm(await noa.locator(".m-folded").nth(round).locator(".a-chip").innerText());
        check(`3 round ${round + 1}'s reveal: רובכם צדקו, a word`, chip === "רובכם צדקו", chip);
        if (round === 1) {
          const head = norm(await noa.locator(".ph-head").innerText());
          check("3 the head counts 2/3 on the second question", head.includes("2/3"), head);
        }
        await noa.getByRole("button", { name: round < 2 ? "לשאלה הבאה" : "לסיום" }).click({ timeout: 15000 });
      }
      const coffee = db.quiz.quizzes.find((z) => z.meeting_id === today.id && z.preset === "coffee");
      await until(() => coffee.state === "ended", 15000, "the opening to end");
      const asked = db.quiz.rounds.filter((r) => r.quiz_id === coffee.id).map((r) => r.question_id);
      check("3 the opening asked yesterday's two (the teaser first) and one older, none of today's parts", asked.join(",") === [Q[0].id, Q[1].id, Q[2].id].join(","), JSON.stringify(asked));
      check("3 no count of answers in any of its states", !db.quiz.bodies.some((b) => b.fn === "study_quiz_state" && JSON.parse(b.body)?.quiz?.preset === "coffee" && /"counts":\[|"right":\d/.test(b.body)));
      await noa.locator(".m-agenda").waitFor({ timeout: 10000 });
      const agenda = await noa.locator(".m-agenda > li").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
      check(
        "3 the agenda: today's reading (no reader before anyone reads aloud), the question sent from yesterday's meeting",
        agenda.length === 2 && agenda[0].startsWith("היום: ") && agenda[0].includes("ש׳ 1-5") && !agenda[0].includes("הקראה") && !agenda[0].includes("מי מקריאים") && agenda[1].startsWith("שאלה פתוחה: מה עושה LMT-Ros3?") && agenda[1].includes("מהפגישה הקודמת"),
        JSON.stringify(agenda),
      );
      await shot(noa, "meeting-05-agenda", { primary: ".ph-foot .a-btn.primary" });

      /* ── 4. reading aloud: the reader, the followers, the warning, the guess lighting up ── */
      db.meetingPulse = true; // decision 1's switch: the guess warning is on
      await shoham.goto(`${mock.base}${meetingUrl}`);
      await shoham.getByRole("link", { name: "להתחיל להקריא" }).click({ timeout: 15000 });
      await shoham.locator(".summary").first().waitFor({ timeout: 20000 });
      await until(() => M.meetings.find((m) => m.id === today.id).reading, 15000, "the reading to start");
      await readTo(shoham, 0, 0);
      const followers = {};
      for (const who of ["נועה", "מאיה", "איתי"]) {
        const page = who === "נועה" ? noa : guessers[who];
        await page.goto(`${mock.base}/?l=${L}&follow=1`);
        await page.getByText(/מעקב: שוהם/).waitFor({ timeout: PLACE_MS });
        await page.locator(".m-unclear").waitFor({ timeout: 10000 });
        followers[who] = page;
      }
      await until(() => calledBy("study_meeting_here", "איתי") > 0 && calledBy("study_meeting_here", "מאיה") > 0, 15000, "the followers' here");
      // The reader's card: one line in the reader's bar, its callouts in the reading flow (meeting.html s3).
      const bar = shoham.locator(".reader-extra");
      const card = shoham.locator(".lecture-body");
      await card.locator(".m-warn").waitFor({ timeout: 20000 });
      const warn = norm(await card.locator(".m-warn").innerText());
      check("4 the reader is warned before guess 1's paragraph: בפסקה הבאה: ניחוש 1 · כדאי להאט · רוב הקבוצה ניחשה לא נכון", warn.startsWith("בפסקה הבאה: ניחוש 1 כדאי להאט") && warn.endsWith("רוב הקבוצה ניחשה לא נכון"), warn);
      check(
        "4 the warning is in the reading flow, right after the paragraph being read (0.0)",
        await shoham.evaluate(() => {
          const w = document.querySelector(".lecture-body .m-warn");
          const blks = [...document.querySelectorAll('.lecture-body [data-part="0"] [data-blk]')].filter((b) => b.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING);
          return blks.at(-1)?.dataset.blk === "0" && !document.querySelector(".reader-top .m-warn");
        }),
      );
      const three = await until(async () => norm(await bar.locator(".m-followers").innerText()) === "3 עוקבים", 20000, "3 עוקבים").catch(() => false);
      check("4 the reader's bar counts the followers: 3 עוקבים", three, await bar.locator(".m-followers").innerText());
      await shot(shoham, "meeting-06-reader-warn");
      const top6 = await readerTop(shoham);
      check("4 the reader's sticky top keeps most of the screen for the text (under 35%) at 390 and 360", top6.every((t) => t.share < 35), JSON.stringify(top6));
      check("4 ההקראה שלך משותפת shows once, in the room bar, whole at 390 and 360", top6.every((t) => t.shared === 1 && t.cut === false) && (await shoham.locator(".room-bar").getByText("ההקראה שלך משותפת").count()) === 1, JSON.stringify(top6));
      await readTo(shoham, 0, 0);
      await readTo(shoham, 0, 1);
      for (const who of ["נועה", "מאיה"]) {
        await followers[who].locator(".m-ding").waitFor({ timeout: PLACE_MS });
      }
      const ding = norm(await noa.locator(".m-ding").innerText());
      check("4 דינג! on Noa's phone with her own line, like most of the group, רק לך", ding.startsWith("דינג! התשובה לניחוש 1") && ding.includes("ניחשת ספיגת K⁺, כמו רוב הקבוצה") && ding.includes("רק לך"), ding);
      check("4 no number in any guess state", !M.bodies.some((b) => b.fn === "study_meeting_guess_state" && /"(counts?|right|answered|guessers)"/.test(b.body)));
      await shot(noa, "meeting-07-ding");
      // The card spans the screen gutter to gutter, its "הבנתי" whole (review M-DING-CLIPPED).
      const dingAt = await atSizes(noa, async () => ({ card: await boxOf(noa, ".m-ding"), ok: await boxOf(noa, ".m-ding .a-btn") }));
      check(
        "4 דינג! is on screen at 390 and 360: the card inside the gutters, הבנתי whole",
        dingAt.every((d) => d.card && d.card.x0 >= 15 && d.card.x1 <= d.card.w - 15 && d.ok.x0 >= 0 && d.ok.x1 <= d.ok.w && d.ok.y1 <= d.ok.h),
        JSON.stringify(dingAt),
      );
      // A second member's "להקריא לקבוצה" during the live reading (the bar offers only "לעקוב" once it
      // sees the reader; ?read=1 starts reading at once, as a phone that has not seen her yet would).
      const roni = await open("רוני", `/?l=${L}&read=1`);
      await roni.locator(".summary").first().waitFor({ timeout: 20000 });
      await roni.getByText("ההקראה פעילה בטלפון אחר. אפשר לעקוב אחריה.").waitFor({ timeout: 20000 });
      check("4 another member cannot take over a live reading (the reading toast)", M.log.some((l) => l.startsWith("study_meeting_reading רוני: reading")));
      await roni.close();

      /* ── 5. "לא ברור לי" from 3 others; the reader's three answers ── */
      for (const who of ["נועה", "מאיה"]) await followers[who].locator(".m-ding").getByRole("button", { name: "הבנתי" }).click();
      check("5 הבנתי closes the answer", (await noa.locator(".m-ding").count()) === 0 && (await followers["מאיה"].locator(".m-ding").count()) === 0);
      await readTo(shoham, 0, 2);
      const tapOn = async (who, part, anchor) => {
        const page = followers[who];
        await page.waitForFunction(([p, a]) => document.querySelector(`[data-part="${p}"] [data-blk="${a}"]`)?.classList.contains("blk-marked"), [part, anchor], { timeout: PLACE_MS });
        await page.locator(".m-unclear").click();
        await until(() => M.taps.some((t) => t.user_id === id(who) && t.part === part && t.anchor === anchor), 8000, `${who}'s tap`);
      };
      await tapOn("נועה", 0, 2);
      const toast = norm(await noa.locator(".a-toast").innerText());
      check("5 the tap's toast: סומן, בלי שם. הפסקה תחזור אליך מחר. with ביטול (the paragraph's chip brings it back)", toast.startsWith("סומן, בלי שם. הפסקה תחזור אליך מחר.") && toast.includes("ביטול"), toast);
      await shot(noa, "meeting-08-follower");
      {
        // A guess's answer lit up on this paragraph is never under the toast.
        const d = await boxOf(noa, ".m-ding");
        const t = await boxOf(noa, ".shell > .a-toast");
        check("5 the toast is never drawn over דינג!", !d || !t || t.y1 <= d.y0 || t.y0 >= d.y1, JSON.stringify({ d, t }));
      }
      await tapOn("מאיה", 0, 2);
      await shoham.waitForTimeout(7000);
      check("5 two taps: the reader's card shows nothing", (await card.locator(".m-callout").count()) === 0);
      await tapOn("איתי", 0, 2);
      await card.locator(".m-callout").waitFor({ timeout: 15000 });
      const callout = norm(await card.locator(".m-callout").innerText());
      check("5 three taps: 3 ׳לא ברור׳ · בלי שמות with ש׳ 2 and the three answers", callout.startsWith("3 ׳לא ברור׳ · בלי שמות ש׳ 2") && callout.includes("לעצור ולהסביר") && callout.includes("להמשיך") && callout.includes("לשאלה פתוחה למחר"), callout);
      check(
        "5 the callout is in the reading flow, right after the paragraph the taps name (0.2), not in the sticky top",
        await shoham.evaluate(() => {
          const c = document.querySelector(".lecture-body .m-callout");
          const blks = [...document.querySelectorAll('.lecture-body [data-part="0"] [data-blk]')].filter((b) => b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
          return blks.at(-1)?.dataset.blk === "2" && !document.querySelector(".reader-top .m-callout");
        }),
      );
      const pointer = bar.locator(".m-tap-link");
      check("5 the reader's bar points to it in one line: 3 ׳לא ברור׳ · ש׳ 2", norm(await pointer.innerText()) === "3 ׳לא ברור׳ · ש׳ 2", await pointer.innerText());
      check("5 no follower asked for the reader's card", ["נועה", "מאיה", "איתי"].every((w) => calledBy("study_meeting_reader_view", w) === 0));
      check("5 no tap kept any text", M.taps.every((t) => t.quote === ""));
      await shot(shoham, "meeting-09-reader");
      const top9 = await readerTop(shoham);
      check("5 with the callout, the sticky top stays under 35% of the screen at 390 and 360", top9.every((t) => t.share < 35 && t.shared === 1 && t.cut === false), JSON.stringify(top9));
      await shoham.evaluate(() => window.scrollTo(0, 0));
      await pointer.click();
      await shoham.waitForTimeout(1200);
      const seen = await boxOf(shoham, ".lecture-body .m-callout");
      const head9 = await boxOf(shoham, ".reader-top");
      check("5 the pointer scrolls to the callout, below the sticky top", seen && seen.y0 >= head9.y1 && seen.y1 <= seen.h, JSON.stringify({ seen, head9 }));
      await readTo(shoham, 0, 2);
      await card.getByRole("button", { name: "לעצור ולהסביר" }).click();
      await card.locator(".m-callout").waitFor({ state: "detached", timeout: 10000 });
      check("5 לעצור ולהסביר records the stop and clears the callout", M.events.some((e) => e.meeting_id === today.id && e.kind === "explain" && e.part === 0 && e.anchor === 2));
      await readTo(shoham, 0, 3);
      for (const who of ["נועה", "מאיה", "איתי"]) await tapOn(who, 0, 3);
      await card.locator(".m-callout").waitFor({ timeout: 15000 });
      await card.getByRole("button", { name: "לשאלה פתוחה למחר" }).click();
      const field = card.locator(".m-callout").getByRole("textbox");
      check("5 the question is prefilled: לא ברור בהקראה:", (await field.inputValue()) === "לא ברור בהקראה: ");
      await field.fill("לא ברור בהקראה: למה NaHCO₃ דווקא שם?");
      await card.getByRole("button", { name: "לשלוח לסדר היום" }).click();
      await until(() => M.events.some((e) => e.meeting_id === today.id && e.kind === "question" && e.part === 0 && e.anchor === 3), 10000, "the open question");
      check("5 the question is on the paragraph, for tomorrow's agenda", db.comments.some((c) => c.kind === "question" && c.body === "לא ברור בהקראה: למה NaHCO₃ דווקא שם?" && c.part_idx === 0 && c.anchor === 3));

      /* ── 6. "אישור בקול": Noa's proposal on the paragraph being read, two others following ── */
      if (flags.corrections) {
        const sec0 = db.sections.find((s) => s.lecture_id === L && s.idx === 0);
        const before = sec0.markdown.split("\n\n").find((b) => b.startsWith("**דרך מתן:**"));
        db.proposals.push({
          id: hex("abcd9999", 1), lecture_id: L, part_idx: 0, anchor: 8, gen: 0, base_rev: sec0.rev ?? 0, occurrence: 1, kind: "paragraph", before_text: before, after_text: before.replace("5-10 דקות", "5-15 דקות"),
          note: "", source_kind: "slide", source_slides: [3], source_at: null, source_note: "", state: "pending", proposed_by: id("נועה"), approved_by: null, aloud: false, edit_id: null,
          created_at: ago(30), decided_at: null, updated_at: ago(30), check_ok: null, check_note: null, checked_at: null,
        });
        mock.notify("study_edit_proposals", "INSERT", db.proposals[db.proposals.length - 1]);
        await shoham.reload();
        await shoham.locator(".summary").first().waitFor({ timeout: 20000 });
        await shoham.getByRole("button", { name: "להקריא לקבוצה" }).click({ timeout: PLACE_MS }).catch(() => undefined);
        await readTo(shoham, 0, 8);
        const aloud = shoham.locator(".k-aloud");
        await aloud.waitFor({ timeout: 30000 });
        check("6 הצעת תיקון · נועה with אישור בקול on the reader's bar", norm(await aloud.innerText()).startsWith("הצעת תיקון · נועה ממתין לאישור"), await aloud.innerText());
        await shot(shoham, "meeting-10-aloud");
        const top10 = await readerTop(shoham);
        check("6 with the proposal and שאלות: the sticky top under 35%, ההקראה שלך משותפת once and whole, at 390 and 360", top10.every((t) => t.share < 35 && t.shared === 1 && t.cut === false), JSON.stringify(top10));
        await readTo(shoham, 0, 8);
        await aloud.getByRole("button", { name: "אישור בקול" }).click();
        await until(() => db.proposals[db.proposals.length - 1].state === "applied", 10000, "the approval");
        const e = db.edits[db.edits.length - 1];
        check("6 approved aloud by the reader: the history says בקול", e.aloud === true && e.approved_by === id("שוהם") && e.author_id === id("נועה"));
      }

      /* ── 7. the part's one-question stop, and the closing ── */
      const last0 = await shoham.evaluate(() => Math.max(...[...document.querySelectorAll('.lecture-body [data-part="0"] [data-blk]')].map((b) => Number(b.dataset.blk))));
      await readTo(shoham, 0, last0);
      const stop = shoham.locator(".m-part-stop");
      await stop.waitFor({ timeout: 15000 });
      check("7 at the part's last paragraph: עצירה: שאלה אחת על החלק", norm(await stop.innerText()) === "עצירה: שאלה אחת על החלק");
      await stop.click();
      await until(() => search(shoham).startsWith("?v=quiz&q="), 10000, "the stop's quiz");
      const stopQuiz = db.quiz.quizzes.find((z) => z.meeting_id === today.id && z.preset === "stop");
      check("7 the stop: one question on part 0, co-op", stopQuiz && stopQuiz.n_wanted === 1 && stopQuiz.part_from === 0 && stopQuiz.part_to === 0 && stopQuiz.mode === "coop", JSON.stringify(stopQuiz));
      stopQuiz.state = "ended";
      stopQuiz.ended_at = new Date().toISOString();
      await shoham.goto(`${mock.base}${meetingUrl}`);
      const closing = shoham.getByRole("button", { name: "מבחן קבוצתי על מה שנקרא · 5 שאלות" });
      await closing.waitFor({ timeout: 15000 });
      await shot(shoham, "meeting-11-closing", { primary: ".ph-foot .a-btn.primary" });
      await closing.click();
      await until(() => search(shoham).startsWith("?v=quiz&q="), 10000, "the closing's lobby");
      const end = db.quiz.quizzes.find((z) => z.meeting_id === today.id && z.preset === "end");
      check("7 the closing: preset end on the parts read, 5 questions", end && end.n_wanted === 5 && end.part_from === 0 && end.part_to >= 0, JSON.stringify(end));

      /* ── 8. M-5: catch-up for Dana, who missed yesterday ── */
      if (flags.guess) {
        const dana = await open("דנה", "/?v=group");
        await dana.getByText("פגישה שפספסת").waitFor({ timeout: 15000 });
        await dana.getByText("פגישה שפספסת").click();
        await dana.locator(".m-piece").first().waitFor({ timeout: 15000 });
        const pieces = await dana.locator(".m-piece").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
        const sub = norm(await dana.locator(".ph-sub").innerText());
        check(
          "8 the pack: התעכבנו על (the paragraph's own words), שאלה שנפתרה with its answer, no wall without J",
          pieces.length === 2 && pieces[0].startsWith("התעכבנו על עצרנו להסביר Miltefosine טרטוגנית") && pieces[1].startsWith("שאלה שנפתרה נענתה למה Pentostam מחייבת ECG?") && pieces[1].includes("הארכת QTc"),
          JSON.stringify(pieces),
        );
        check("8 בפרק הקודם של תמצית… · {n} דק׳ · רק לך", /^בפרק הקודם של תמצית… · \d+ דק׳ רק לך$/.test(sub), sub);
        check("8 the readers' line: no time, no ׳באיחור׳", (await dana.getByText("בסוף ההשלמה מצטרפים לרשימה, בלי שעה ובלי ׳באיחור׳.", { exact: false }).count()) === 1);
        await shot(dana, "meeting-12-catchup", { primary: ".ph-foot .a-btn.primary" });
        await dana.getByRole("button", { name: "להתחיל השלמה" }).click();
        for (let i = 0; i < 5; i++) {
          if (await dana.getByText("ההשלמה הושלמה.", { exact: false }).count()) break;
          await dana.locator(".pq-options button.a-opt").first().click({ timeout: 10000 });
          await dana.locator(".ph-foot .a-btn.primary").click();
          await dana.locator(".pq-verdict").waitFor({ timeout: 10000 });
          await dana.locator(".ph-foot .a-btn.primary").click();
          await dana.waitForTimeout(300);
        }
        await dana.getByText("ההשלמה הושלמה. מחר ההרצאה תסומן כנקראה, בשעת הפגישה.").waitFor({ timeout: 10000 });
        await shot(dana, "meeting-13-catchup-done");
        check("8 finished: not in קראו today", !db.reads.some((r) => r.lecture_id === L2 && r.user_id === id("דנה")));
        M.catchups.find((c) => c.user_id === id("דנה")).done_at -= 86_400_000;
        await dana.goto(`${mock.base}/?v=group`);
        await until(() => db.reads.some((r) => r.lecture_id === L2 && r.user_id === id("דנה")), 15000, "the read mark the next day");
        const mark = db.reads.find((r) => r.lecture_id === L2 && r.user_id === id("דנה"));
        check("8 the next study day: Dana in קראו, at the meeting's time", mark.read_at === t0, JSON.stringify(mark));
        check("8 Noa, who was there, was never offered it", !M.bodies.some((b) => b.fn === "study_my_missed" && b.who === id("נועה") && b.body.includes(Y)));
      }
      steps.horizontalOverflow = await noa.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (steps.horizontalOverflow) failed.push("horizontalOverflow");
    }
    const unmocked = mock.problems.filter((p) => p.startsWith("unmocked"));
    const problems = mock.problems.filter((p) => !p.startsWith("unmocked"));
    console.log(JSON.stringify({ flags: flags.set, meeting: flags.meeting, failed, errors: problems, unmocked, steps, a11y }, null, 1));
    if (failed.length || problems.length || unmocked.length || a11y.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ steps, failed, problems: mock.problems, log: M?.log, calls: mock.calls.slice(-25) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
