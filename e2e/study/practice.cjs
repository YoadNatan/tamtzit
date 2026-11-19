// Practice 2.0 end to end (docs/study/proposal/practice-2: DECISIONS.md and
// mockups.html; the approved question screens, proposal/mockups/practice.html;
// the API, docs/study/practice-2-api.md), against the mock
// (e2e/study/mocks/practice.cjs): a lecture with no questions; מה ליצור with
// the points to know read once for the group (another phone sees it live),
// the plan's numbers for each level (מלא by default), parts with their points,
// several styles and the level; דוגמה ומיקוד with a photographed and pasted
// example read back, a focus line and the cost; הבנק נבנה with the batches
// written as release 1 writes a round (the first alone until its start line,
// never more than two at once), coverage bars per part as drafts arrive, the
// blind solver's verdicts (a rewrite, a rejection, one it could not check),
// "✓ להשאיר", "↻ לנסח מחדש" (its sheet and note), "✕" and "להוסיף N לבנק",
// live on a second phone; סבב חדש (from where, parts, style, how many, practice
// or exam mode) with the member's own counts; the question as approved: a
// pick, the bet before "לבדוק" (p_confidence), the autopsy (the choice, the
// key, the rest) with "מתי כן", "רק לך", a slide tag opening the slide and
// "לפסקה" opening the paragraph; two members' flags hiding a question from
// everyone and the fix sheet bringing it back; the end of a round; exam
// mode; a failed batch and "להמשיך לכתוב"; the month's cap; one reservation
// and one settlement per model call; privacy (no request reads answers or
// keys, no line carries them); the old one-button sheet and its "80 שאלות"
// gone. Screenshots at every step, each through a11y.cjs in light and dark
// at 390×844 and 360×640.
//
//   VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
//   VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 [VITE_STUDY_QUIZ=1] \
//     npx vite build --outDir <dist>
//   NODE_PATH=$(npm root -g) node e2e/study/practice.cjs <dist> <out dir> [rel1|rel2|all|off]
// rel1: release 1's flags (QUESTIONS, PRACTICE, CARDS); rel2: release 2's
// (those and QUIZ); all: every flag; off: every flag off (practice is
// replaced, with its line). rel1 and rel2 run against the registry this
// branch's SQL writes.
const fs = require("fs");
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const plugin = require("./mocks/practice.cjs");

const [dist, out, flagSet = process.env.E2E_FLAGS || "rel2"] = process.argv.slice(2);
if (!dist || !out || !["rel1", "rel2", "all", "off"].includes(flagSet)) {
  console.error("usage: node e2e/study/practice.cjs <dist> <out dir> [rel1|rel2|all|off]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const quizOn = flagSet === "rel2" || flagSet === "all";
const L2 = "eeeeeeee-0000-4000-8000-000000000021";
const PRIMARY = ".ph-foot .a-btn.primary";
const norm = (s) => String(s).replace(/[\u200e\u200f\u2066-\u2069]/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
// The fixture's points to know per part (mocks/practice.cjs) and its red flags.
const POINTS = [4, 4, 6, 6, 5, 4, 5, 4];
const RED = [0, 1, 1, 1, 1, 1, 0, 0];
const halfUp = (x) => Math.floor(x + 0.5 + 1e-9);
const level = (l, parts) =>
  parts.reduce((s, i) => s + (l === "focused" ? Math.min(POINTS[i], Math.max(halfUp(POINTS[i] / 4), RED[i])) : l === "full" ? halfUp(POINTS[i] / 2) : POINTS[i]), 0);

(async () => {
  const mock = await createMock({ dist, plugins: [plugin], flags: flagSet });
  const { db, LECTURE_ID: L } = mock;
  const P = db.practice;
  P.notify = mock.notify;
  mock.seedLecture();
  // A second lecture with the same parts, for a batch that fails.
  db.lectures.push({ ...db.lectures[0], id: L2, title: "משתנים: הרצאה שנייה" });
  for (const s of db.sections.filter((x) => x.lecture_id === L)) db.sections.push({ ...s, lecture_id: L2 });
  const shohamId = mock.people["שוהם"].user.id;
  const noaId = mock.people["נועה"].user.id;

  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const search = (page) => new URL(page.url()).search;
  const until = async (fn, ms = 15000, what = "condition") => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const shot = async (page, name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  /** The question on screen, from its lead-in, and its key's option text. */
  const onScreen = async (page) => {
    const lead = norm(await page.locator(".pq-lead").first().innerText());
    const q = P.questions.find((x) => norm(x.question) === lead);
    if (!q) throw new Error(`no question "${lead}"`);
    return { q, right: q.options[P.keys.get(q.id).answer], key: P.keys.get(q.id) };
  };
  const optionTexts = (page) => page.locator(".pq-options button.a-opt .pq-text").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  const pick = async (page, text) => {
    const texts = await optionTexts(page);
    const i = texts.findIndex((t) => norm(t) === norm(text));
    if (i < 0) throw new Error(`no option "${text}" in ${JSON.stringify(texts)}`);
    await page.locator(".pq-options button.a-opt").nth(i).click();
    return i;
  };
  const bet = (page, words) => page.locator(".pq-bets").getByRole("radio", { name: words, exact: true }).click();
  const verdict = async (page) => norm(await page.locator(".pq-verdict h2").innerText({ timeout: 10000 }));
  const NOTICES = ["התכונה הזו עוד לא פתוחה.", "״הטעויות שלי״ עוד לא פתוחות.", "החזרה על כרטיסיות באפליקציה תיפתח בקרוב."];
  const watchNotices = async (page) => {
    const install = (notices) => {
      const seen = () => {
        for (const el of document.querySelectorAll(".a-toast")) {
          const t = el.textContent || "";
          if (notices.some((n) => t.includes(n))) sessionStorage.setItem("e2e-notices", `${sessionStorage.getItem("e2e-notices") || ""}${t}\n`);
        }
      };
      new MutationObserver(seen).observe(document, { childList: true, subtree: true });
    };
    await page.addInitScript(install, NOTICES);
    await page.evaluate(install, NOTICES);
  };
  const noticesOf = (page) => page.evaluate(() => sessionStorage.getItem("e2e-notices") || "");
  const ledger = (kind) => ({
    reserve: mock.calls.filter((c) => c.startsWith(`ledger study_reserve kind=${kind} `) && c.endsWith("p_key=1")).length,
    settle: mock.calls.filter((c) => c.startsWith(`ledger study_settle kind=${kind} `) && c.endsWith("p_key=1")).length,
  });

  try {
    if (flagSet === "off") {
      // Every flag off: practice and its new screens are replaced by the lecture, with the line; no tab, no chip, no call.
      const { page } = await mock.open(browser, "שוהם", { path: `/?v=practice&l=${L}&x=new` });
      await page.locator(".a-toast", { hasText: "התכונה הזו עוד לא פתוחה." }).waitFor({ timeout: 15000 });
      check("off: מה ליצור is replaced by the lecture, with a notice", search(page) === `?l=${L}`, search(page));
      await page.goto(`${mock.base}/?v=practice&l=${L}&x=round`);
      await page.locator(".a-toast", { hasText: "התכונה הזו עוד לא פתוחה." }).waitFor({ timeout: 15000 });
      check("off: סבב חדש is replaced by the lecture, with a notice", search(page) === `?l=${L}`, search(page));
      await page.goto(`${mock.base}/?v=library`);
      await page.locator(".lecture-card").first().waitFor({ timeout: 10000 });
      const tabs = await page.locator(".ph-tabs .ph-tab").allInnerTexts();
      const chips = await page.locator(".lc-chips a").count();
      const calls = mock.calls.filter((c) => /study_question|study_practice|study_my_|study_points|study_draft|study_session|\/api\/study\/ai/.test(c));
      check("off: no tab, no chip, no practice call", !tabs.some((t) => t.includes("תרגול")) && chips === 0 && calls.length === 0, JSON.stringify({ tabs, chips, calls }));
      await shot(page, "practice-off-library");
    } else {
      const { page: shoham } = await mock.open(browser, "שוהם", { path: `/?v=practice&l=${L}` });
      const { page: noa } = await mock.open(browser, "נועה", { path: `/?v=practice&l=${L}` });
      await watchNotices(shoham);
      await watchNotices(noa);

      /* ── 1. A lecture with no questions: no one-button sheet, no "80" ── */
      await shoham.getByRole("heading", { name: "עוד אין שאלות תרגול להרצאה הזו." }).waitFor({ timeout: 15000 });
      const emptyText = norm(await shoham.locator("main").innerText());
      check(
        "1 the lecture's practice: the head, one way in (שאלות חדשות), no old sheet, no 80",
        norm(await shoham.locator(".ph-head .back").innerText()) === "→ להרצאה" &&
          norm(await shoham.locator(".ph-head .t").innerText()) === `תרגול · ${db.lectures[0].title}` &&
          (await shoham.getByRole("link", { name: "שאלות חדשות" }).count()) === 1 &&
          !emptyText.includes("יצירת שאלות תרגול") &&
          !/\b80\b/.test(emptyText),
        emptyText,
      );
      await shot(shoham, "practice-01-empty");

      /* ── 2. מה ליצור: the points to know, read once for the group ── */
      await shoham.getByRole("link", { name: "שאלות חדשות" }).click();
      await shoham.getByRole("heading", { name: "קודם: הנקודות שצריך לדעת" }).waitFor({ timeout: 10000 });
      check(
        "2 מה ליצור: its URL; reading the points is the bottom bar's action, with its cost before anything is spent (no disabled המשך)",
        search(shoham) === `?v=practice&l=${L}&x=new` &&
          norm(await shoham.locator(PRIMARY).innerText()) === "לקרוא את הנקודות · כ-$0.14" &&
          !(await shoham.locator(PRIMARY).isDisabled()) &&
          (await shoham.locator(".ph-foot .a-btn").count()) === 1 &&
          (await shoham.locator(".ph-head .t").innerText()).startsWith("שאלות חדשות ·"),
        JSON.stringify({ url: search(shoham), bar: norm(await shoham.locator(PRIMARY).innerText()), head: await shoham.locator(".ph-head .t").innerText(), off: await shoham.locator(PRIMARY).isDisabled() }),
      );
      await shot(shoham, "practice-02-points", { primary: PRIMARY });
      await noa.goto(`${mock.base}/?v=practice&l=${L}&x=new`);
      await noa.getByRole("heading", { name: "קודם: הנקודות שצריך לדעת" }).waitFor({ timeout: 10000 });
      // Each part its own call on the server, six at once, slow: they end one by one, over about 18 s.
      P.pointsDelay = (l, i) => 3000 + 1500 * i;
      await shoham.getByRole("button", { name: "לקרוא את הנקודות" }).click();
      const status = (page) => page.locator(".pc-reading [role=status]").innerText({ timeout: 10000 }).then(norm);
      const doneOf = async (page) => Number((/^(\d+) מתוך 8 חלקים/.exec(await status(page)) ?? [])[1] ?? -1);
      const states = (page) => page.locator(".pc-read-parts li").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
      await shoham.locator(".pc-reading", { hasText: "קוראים את הנקודות שצריך לדעת…" }).waitFor({ timeout: 10000 });
      const first = { status: await status(shoham), states: await states(shoham), bar: norm(await shoham.locator(PRIMARY).innerText()) };
      check(
        "2 reading: every part with its state from the start, 0 of 8, about two minutes for eight parts, the bar says so and waits",
        /^0 מתוך 8 חלקים · בערך 2 דקות$/.test(first.status) &&
          first.states.length === 8 &&
          first.states.every((x) => x === "reading" || x === "waiting") &&
          first.bar === "קוראים את הנקודות…" &&
          (await shoham.locator(PRIMARY).isDisabled()) &&
          (await shoham.locator(".pc-reading", { hasText: "הקריאה ממשיכה בשרת" }).count()) === 1,
        JSON.stringify(first),
      );
      // Once the claim shows: the server calls six at once, in order; the last two wait their turn.
      const queued = "reading,reading,reading,reading,reading,reading,waiting,waiting";
      await until(async () => (await states(shoham)).join() === queued, 2500, "six parts read, two waiting").catch(() => false);
      const turn = { states: await states(shoham), chips: (await shoham.locator(".pc-read-parts li .a-chip").allInnerTexts()).map(norm) };
      check(
        "2 six parts read at once (נקרא…), the other two wait their turn (ממתין)",
        turn.states.join() === queued && turn.chips.join() === "נקרא…,נקרא…,נקרא…,נקרא…,נקרא…,נקרא…,ממתין,ממתין",
        JSON.stringify(turn),
      );
      await shot(shoham, "practice-03a-points-reading", { primary: PRIMARY });
      await noa.locator(".pc-points", { hasText: "קוראים את הנקודות שצריך לדעת במכשיר אחר…" }).waitFor({ timeout: 10000 });
      check("2 another phone sees the points being read, live, part by part", (await states(noa)).length === 8);
      await shot(noa, "practice-03-points-elsewhere", { primary: PRIMARY });
      // The parts arrive one by one: the count moves while others are still read.
      await until(async () => (await doneOf(shoham)) >= 2, 15000, "two parts read");
      const some = { done: await doneOf(shoham), states: await states(shoham), chips: (await shoham.locator(".pc-read-parts li[data-state=ready] .a-chip").allInnerTexts()).map(norm) };
      check(
        "2 the parts arrive one by one: ready ones with their points, the others still read",
        some.done >= 2 && some.done < 8 && some.states.includes("reading") && some.chips.every((t) => /^✓ \d+ נקודות$/.test(t)) && some.chips.length === some.done,
        JSON.stringify(some),
      );
      await shot(shoham, "practice-03b-points-arriving", { primary: PRIMARY });
      // The member leaves mid-reading (the page and its stream are gone) and comes back.
      const left = await doneOf(shoham);
      await shoham.goto(`${mock.base}/?v=practice&l=${L}`);
      await shoham.getByRole("heading", { name: "עוד אין שאלות תרגול להרצאה הזו." }).waitFor({ timeout: 15000 });
      await shoham.goto(`${mock.base}/?v=practice&l=${L}&x=new`);
      await shoham.locator(".pc-reading", { hasText: "קוראים את הנקודות שצריך לדעת…" }).waitFor({ timeout: 10000 });
      const back = await doneOf(shoham);
      const backText = norm(await shoham.locator(".pc-reading h2").innerText());
      await shot(shoham, "practice-03c-points-back", { primary: PRIMARY });
      await until(async () => (await shoham.locator(".pc-levels").count()) > 0 || (await doneOf(shoham)) > back, 20000, "the count moving after coming back");
      check(
        "2 back mid-reading: the true count (not 0), still this phone's read (not 'another phone'), and it moves",
        back >= left && back < 8 && backText === "קוראים את הנקודות שצריך לדעת…",
        JSON.stringify({ left, back, backText }),
      );
      await shoham.locator(".pc-levels").waitFor({ timeout: 30000 });
      await noa.locator(".pc-levels").waitFor({ timeout: 15000 });
      const read1 = P.pointReads.at(-1);
      check(
        "2 the reading went on without the phone: all eight parts saved, each its own call, reserved and settled",
        read1.parts.length === 8 && [...P.pointParts.values()].filter((x) => x.lecture_id === L && x.status === "ready").length === 8 && P.lines.includes(JSON.stringify({ t: "done", parts: 8, points: 38, costUsd: 0.13, unsettled: 0 })),
        JSON.stringify({ read1, lines: P.lines.slice(-3) }),
      );
      P.pointsDelay = null;
      const all = [0, 1, 2, 3, 4, 5, 6, 7];
      const levels = await shoham.locator(".pc-levels [role=radio]").evaluateAll((els) => els.map((e) => ({ t: e.innerText.replace(/\s+/g, " ").trim(), on: e.getAttribute("aria-checked") })));
      const sub = norm(await shoham.locator(".ph-sub").innerText());
      const parts0 = (await shoham.locator(".pc-parts button").allInnerTexts()).map(norm);
      const styles0 = await shoham.locator(".pc-styles button").evaluateAll((els) => els.map((e) => [e.innerText.replace(/\s+/g, " ").trim(), e.getAttribute("aria-pressed")]));
      const diff = await shoham.locator(".pc-difficulty [aria-checked=true]").innerText();
      check(
        "2 the plan's numbers: ממוקד · מלא · מקיף by the points, מלא by default, every part with its points, four styles, כמו במבחן",
        sub === `20 שקפים · 38 נקודות שצריך לדעת` &&
          levels.map((x) => x.t).join("|") === `ממוקד ${level("focused", all)}|מלא ${level("full", all)}|מקיף ${level("deep", all)}|מספר אחר …` &&
          levels.find((x) => x.on === "true")?.t.startsWith("מלא") &&
          parts0.length === 8 &&
          parts0.every((t, i) => t.startsWith("✓ ") && t.endsWith(`· ${POINTS[i]}`)) &&
          styles0.filter(([, on]) => on === "true").map(([t]) => t).join("|") === "✓ מקרה קליני|✓ מנגנון|✓ תרופה לבחירה|✓ תופעות והתוויות נגד" &&
          styles0.length === 7 &&
          diff === "כמו במבחן" &&
          ledger("points").reserve === 8 &&
          ledger("points").settle === 8 &&
          P.points.length === 38,
        JSON.stringify({ sub, levels, parts0, styles0, diff, points: ledger("points") }),
      );
      await shot(shoham, "practice-04-setup", { primary: PRIMARY });

      /* ── 3. The choices: a part out, a style in; the plan follows ── */
      // With the question types (VITE_STUDY_QTYPES, the prod build) "סוגים נוספים" starts with the
      // plan's defaults on; this script follows the multiple-choice path, so it turns them off first
      // (qtypes.cjs covers the other types). Without the flag there is no such group.
      const typesOn = (await shoham.locator(".pc-types").count()) > 0;
      for (let i = 0; typesOn && i < 8 && (await shoham.locator(".pc-types button[aria-pressed=true]").count()) > 0; i++)
        await shoham.locator(".pc-types button[aria-pressed=true]").first().click();
      const plansBefore = P.p2calls.filter((c) => c.action === "plan").length;
      await shoham.locator(".pc-parts button").first().click();
      await shoham.locator(".pc-styles button", { hasText: "השוואה" }).click();
      const seven = [1, 2, 3, 4, 5, 6, 7];
      const levelTexts = () => shoham.locator(".pc-levels [role=radio]").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
      await until(async () => (await levelTexts()).includes(`מלא ${level("full", seven)}`), 10000, "מלא's number for seven parts");
      await shoham.locator(".pc-levels [role=radio]", { hasText: "ממוקד" }).click();
      await shoham.locator(".pc-level-line", { hasText: "ממוקד: רק החשוב ביותר" }).waitFor();
      await shoham.locator(".pc-levels [role=radio]", { hasText: "מלא" }).click();
      const lastPlan = P.p2calls.filter((c) => c.action === "plan").pop();
      check(
        "3 a part out and a style in: plan asked again (free) with them, מלא's number follows",
        P.p2calls.filter((c) => c.action === "plan").length > plansBefore &&
          JSON.stringify(lastPlan.body.options.parts) === JSON.stringify(seven) &&
          lastPlan.body.options.styles.join() === "case,mechanism,drug_choice,adverse_contra,compare" &&
          norm(await shoham.locator(".a-sec", { hasText: "על מה" }).innerText()).endsWith(`${POINTS.slice(1).reduce((a, b) => a + b, 0)} נקודות`),
        JSON.stringify(lastPlan?.body.options),
      );
      await shoham.locator(PRIMARY).click();

      /* ── 4. דוגמה ומיקוד: a photo and a pasted question read back, a focus line, the cost ── */
      await shoham.getByRole("heading", { name: "דוגמה ומיקוד" }).waitFor({ timeout: 10000 });
      const n = level("full", seven);
      await shoham.locator(".pc-cost", { hasText: `${n} שאלות · כמו במבחן` }).waitFor({ timeout: 10000 });
      check(
        "4 דוגמה ומיקוד: its URL, its back words, the count, the level and the cost (blind solver, the whole group, the month)",
        search(shoham) === `?v=practice&l=${L}&x=example` &&
          norm(await shoham.locator(".ph-head .back").innerText()) === "→ מה ליצור" &&
          norm(await shoham.locator(".pc-cost").innerText()) ===
            `${n} שאלות · כמו במבחן כ-$${(n * 0.025).toFixed(2)} כל שאלה נפתרת שוב בלי המפתח לפני שהיא נכנסת לבנק. נשמרות לכל הקבוצה. נוצלו החודש $12.40 מתוך $33.` &&
          norm(await shoham.locator(PRIMARY).innerText()) === `ליצור ${n} שאלות`,
        norm(await shoham.locator(".pc-cost").innerText()),
      );
      // A photo (any picture: the app shrinks it to a JPEG) and the question pasted as text.
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
      await shoham.locator(".pc-example input[type=file]").setInputFiles({ name: "exam.png", mimeType: "image/png", buffer: png });
      await shoham.locator(".pc-example .a-chip", { hasText: "תמונה צורפה" }).waitFor({ timeout: 10000 });
      await shoham.locator("#pc-example").fill("אישה בת 28 חוזרת מטיול בהודו עם חום כל 48 שעות. במשטח: P. vivax. מה הצעד הבא לפני מתן הטיפול?\nא. … ב. … ג. … ד. … ה. …");
      const blocked = await shoham.locator(PRIMARY).isDisabled();
      await shoham.locator(".pc-read").click();
      await shoham.locator(".pc-style", { hasText: "ככה השאלות ייכתבו:" }).waitFor({ timeout: 10000 });
      await shoham.locator("#pc-focus").fill("Loop diuretics ו-Thiazides, ומה בודקים לפני טיפול");
      const styleRead = P.styleReads?.[0];
      check(
        "4 the example read back once (text and photo, kind style), then ליצור; before the read ליצור waits",
        blocked && styleRead?.image === true && styleRead.text.startsWith("אישה בת 28") && ledger("style").reserve === 1 && ledger("style").settle === 1 && (await shoham.locator(PRIMARY).isEnabled()),
        JSON.stringify({ blocked, styleRead, style: ledger("style") }),
      );
      await shot(shoham, "practice-05-example", { primary: PRIMARY });

      /* ── 5. הבנק נבנה: the batches, drafts arriving, the blind solver, coverage per part ── */
      P.p2pace = 500;
      // In part 3 ("Thiazides"): the solver gets the first draft wrong once (rewritten), and the second
      // twice (rejected); in part 5 it could not check the first.
      P.solverFails = (d, k) => d.part_idx === 3 && k < 2;
      P.solverStillFails = (d) => d.part_idx === 3 && P.drafts.filter((x) => x.batch_id === d.batch_id).indexOf(d) === 1;
      P.unchecked = (d, k) => d.part_idx === 5 && k === 0;
      const held = new Set([6, 7]);
      P.hold = (b) => b.lecture_id === L && held.has(b.part_idx);
      await shoham.locator(PRIMARY).click();
      await shoham.getByRole("heading", { name: "הבנק נבנה" }).waitFor({ timeout: 10000 });
      const rq = P.qrequests[0];
      await noa.goto(`${mock.base}/?v=practice&l=${L}`);
      await noa.locator(".practice-building").waitFor({ timeout: 15000 });
      check(
        "5 ליצור: the request with the options (parts, styles, focus, the signed example), the bank's URL in place of the example's",
        search(shoham) === `?v=practice&l=${L}&x=bank&r=${rq.id}` &&
          rq.count === n &&
          rq.parts.join() === seven.join() &&
          rq.styles.join() === "case,mechanism,drug_choice,adverse_contra,compare" &&
          rq.focus === "Loop diuretics ו-Thiazides, ומה בודקים לפני טיפול" &&
          rq.style_note.startsWith("מקרה של 2-3 שורות") &&
          rq.level === "full" &&
          rq.difficulty === "exam",
        JSON.stringify(rq),
      );
      await until(async () => (await shoham.locator(".pb-draft").count()) >= 3, 20000, "the first drafts");
      const writingChip = norm(await shoham.locator(".pb-count").innerText());
      const more = norm(await shoham.locator(".pb-more").innerText());
      await shot(shoham, "practice-06-bank-writing", { primary: PRIMARY });
      await shot(noa, "practice-07-lecture-building");
      check(
        "5 while written: the count (made/wanted) in the head, 'עוד N נכתבות…', Noa's lecture shows the bank being built",
        new RegExp(`^\\d+/${n}$`).test(writingChip) && /^עוד \d+ נכתבות…$/.test(more) && norm(await noa.locator(".practice-building").innerText()).startsWith("הבנק נבנה"),
        JSON.stringify({ writingChip, more }),
      );
      await noa.getByRole("link", { name: "לבנק שנבנה" }).click();
      await noa.getByRole("heading", { name: "הבנק נבנה" }).waitFor({ timeout: 10000 });
      held.clear();
      const bs = () => P.batches.filter((b) => b.request_id === rq.id);
      await until(() => bs().every((b) => b.status === "ready"), 60000, "every batch");
      await until(async () => (await shoham.locator(".pb-more").count()) === 0 && (await shoham.locator(".pb-verdict", { hasText: "בבדיקה…" }).count()) === 0, 15000, "the solver's verdicts on screen");
      const rs = P.requests.filter((r) => bs().some((b) => b.id === r.batch)).sort((a, b) => a.start - b.start);
      const inFlight = (t) => rs.filter((r) => r.start <= t && (r.end ?? Infinity) > t).length;
      check(
        "5 the batches: the first alone until its start line, then never more than two at once, each once",
        rs.length === bs().length && rs[1].start >= rs[0].startLine && Math.max(...rs.map((r) => inFlight(r.start))) <= 2,
        JSON.stringify(rs.map((r) => [r.part, r.start - rs[0].start, (r.startLine ?? 0) - rs[0].start])),
      );
      const bars = await shoham.locator(".pb-bars .r").evaluateAll((els) => els.map((e) => ({ t: e.innerText.replace(/\s+/g, " ").trim(), ok: e.classList.contains("ok") })));
      const pendingNow = P.drafts.filter((d) => d.request_id === rq.id && d.status === "pending");
      const cards = await shoham.locator(".pb-draft").count();
      const replacedLines = P.lines.filter((l) => /"t":"draft"/.test(l) && /"replaces":"/.test(l)).length;
      const dropped = P.drafts.filter((d) => d.status === "rejected").length;
      const unchecked = norm(await shoham.locator(".pb-draft", { has: shoham.locator(".pb-verdict", { hasText: "לא נבדקה" }) }).first().innerText());
      // Every point covered, but the two points of the draft the solver rejected (in Thiazides, part 3).
      const covered = (i) => (i === 3 ? POINTS[i] - 2 : POINTS[i]);
      check(
        "5 coverage bars per part (7; full where every point is covered), each draft with its style, verdict and slide; the solver's rewrite, its rejection, one unchecked",
        bars.length === 7 &&
          bars.every((b, j) => b.ok === (covered(j + 1) === POINTS[j + 1]) && b.t.endsWith(`${covered(j + 1)}/${POINTS[j + 1]}`)) &&
          cards === pendingNow.length &&
          pendingNow.length === n - dropped &&
          replacedLines === 1 &&
          dropped === 1 &&
          unchecked.includes("הבדיקה לא הספיקה לבדוק אותה") &&
          (await shoham.locator(".pb-verdict", { hasText: "נבדקה ✓" }).count()) === pendingNow.length - 1 &&
          (await shoham.locator(".pb-draft .a-tag").first().innerText()).startsWith("ש׳") &&
          norm(await shoham.locator(".pb-count").innerText()) === `${n - dropped}/${n}`,
        JSON.stringify({ bars, cards, pending: pendingNow.length, replacedLines, dropped }),
      );
      await shot(shoham, "practice-08-bank-checked", { primary: PRIMARY });

      /* ── 6. Each draft: ✓ להשאיר, ✕, ↻ לנסח מחדש (with a note) ── */
      const firstDraft = async () => shoham.locator(".pb-draft").first().getAttribute("data-draft");
      const keepId = await firstDraft();
      await shoham.locator(`.pb-draft[data-draft="${keepId}"]`).getByRole("button", { name: "✓ להשאיר" }).click();
      await shoham.locator(".a-toast", { hasText: "נוספה לבנק." }).waitFor({ timeout: 10000 });
      // The kept card has left the list before the next first card is read (review T1).
      await shoham.locator(`.pb-draft[data-draft="${keepId}"]`).waitFor({ state: "detached", timeout: 10000 });
      const removeId = await firstDraft();
      await shoham.locator(`.pb-draft[data-draft="${removeId}"]`).getByRole("button", { name: "להוריד את השאלה" }).click();
      await shoham.locator(".a-toast", { hasText: "השאלה הורדה." }).waitFor({ timeout: 10000 });
      await shoham.locator(`.pb-draft[data-draft="${removeId}"]`).waitFor({ state: "detached", timeout: 10000 });
      const rewordId = await firstDraft();
      await shoham.locator(`.pb-draft[data-draft="${rewordId}"]`).getByRole("button", { name: "↻ לנסח מחדש" }).click();
      const sheet = shoham.getByRole("dialog", { name: "לנסח מחדש" });
      await sheet.getByLabel("מה לשנות? (רשות)").fill("שאלה על המנגנון ולא על השם");
      // The toast of the removal is still up: it is drawn above the sheet, never over its cost line (review LOOK-7).
      const overlap = await shoham.evaluate(() => {
        const t = document.querySelector(".shell > .a-toast");
        const sh = document.querySelector('.a-sheet[aria-modal="true"]');
        if (!t || !sh) return t ? "no sheet" : "no toast";
        const a = t.getBoundingClientRect();
        const b = sh.getBoundingClientRect();
        return a.bottom <= b.top ? "clear" : `toast ${Math.round(a.top)}-${Math.round(a.bottom)} over the sheet from ${Math.round(b.top)}`;
      });
      check("6 a toast while the reword sheet is open sits above the sheet, clear of its cost line", overlap === "clear", overlap);
      await shot(shoham, "practice-09-reword");
      await sheet.getByRole("button", { name: "לנסח מחדש" }).click();
      await until(() => P.drafts.some((d) => d.replaces === rewordId && d.check_state === "ok"), 10000, "the reworded draft");
      await shoham.locator(".pb-question", { hasText: "(ניסוח חדש)" }).first().waitFor({ timeout: 10000 });
      await noa.locator(`.pb-draft[data-draft="${keepId}"]`).waitFor({ state: "detached", timeout: 10000 });
      check(
        "6 kept (into the bank with its key), removed, reworded with the note (kind reword); Noa's bank follows live",
        P.drafts.find((d) => d.id === keepId).status === "kept" &&
          P.questions.some((q) => q.id === P.drafts.find((d) => d.id === keepId).question_id && P.keys.has(q.id)) &&
          P.drafts.find((d) => d.id === removeId).status === "removed" &&
          P.drafts.find((d) => d.id === rewordId).status === "replaced" &&
          P.rewords?.[0]?.note === "שאלה על המנגנון ולא על השם" &&
          ledger("reword").reserve === 1 &&
          ledger("reword").settle === 1 &&
          (await noa.locator(`.pb-draft[data-draft="${removeId}"]`).count()) === 0,
        JSON.stringify({ rewords: P.rewords, reword: ledger("reword") }),
      );

      /* ── 7. להוסיף N לבנק ── */
      const keepableNow = () => P.drafts.filter((d) => d.request_id === rq.id && d.status === "pending" && ["ok", "unchecked"].includes(d.check_state)).length;
      // The screen catches up with the reworded draft's check before the bar is read (review T1, LOOK-8).
      await until(async () => norm(await shoham.locator(PRIMARY).innerText()) === `להוסיף ${keepableNow()} לבנק`, 10000, "the bar's count").catch(() => {});
      const keepable = keepableNow();
      check("7 the bottom bar says how many it adds", norm(await shoham.locator(PRIMARY).innerText()) === `להוסיף ${keepable} לבנק`, norm(await shoham.locator(PRIMARY).innerText()));
      await shoham.locator(PRIMARY).click();
      await shoham.locator(".a-toast", { hasText: `${keepable} שאלות נוספו לבנק.` }).waitFor({ timeout: 10000 });
      await shoham.getByRole("link", { name: "לתרגל", exact: true }).waitFor({ timeout: 10000 });
      const bankSize = P.questions.filter((q) => q.lecture_id === L).length;
      check(
        "7 every draft the solver passed or could not check went in; nothing waits; the bar offers לתרגל",
        bankSize === keepable + 1 && P.drafts.filter((d) => d.request_id === rq.id && d.status === "pending").length === 0 && norm(await shoham.locator(".pb-kept").innerText()) === `${bankSize} שאלות כבר בבנק.`,
        JSON.stringify({ bankSize, keepable }),
      );
      await shot(shoham, "practice-10-bank-done", { primary: PRIMARY });

      // Privacy: no draft line, nor any streamed line, carries a key, an explanation or "מתי כן".
      const leaked = P.lines.filter((l) => /"t":"(q|draft)"/.test(l)).filter((l) => /"(answer|explanations|takeaway|whens|why|correct)"/.test(l));
      const direct = mock.calls.filter((c) => /study_answers|study_question_keys|study_question_draft_keys/.test(c));
      check("7 privacy: no line carries a key or its explanations, no request reads answers or keys", leaked.length === 0 && direct.length === 0 && P.lines.some((l) => /"t":"draft"/.test(l)), JSON.stringify({ leaked: leaked.length, direct }));

      /* ── 8. Back past the two screens that made it: the lecture's practice ── */
      await shoham.locator(".ph-head .back").click();
      await shoham.locator(".practice-ready").waitFor({ timeout: 10000 });
      const ready = norm(await shoham.locator(".practice-ready").innerText());
      const cases = P.questions.filter((q) => q.lecture_id === L && q.kind === "case").length;
      check(
        "8 הבנק נבנה's back returns to the lecture's practice: the bank's size, סבב חדש, שאלות חדשות",
        search(shoham) === `?v=practice&l=${L}` &&
          ready.startsWith(`${bankSize} שאלות · ${cases} מקרים קליניים`) &&
          (await shoham.getByRole("link", { name: "סבב חדש" }).count()) === 1 &&
          (await shoham.getByRole("link", { name: "שאלות חדשות" }).count()) === 1 &&
          (await shoham.locator(".practice-building").count()) === 0 &&
          (quizOn ? (await shoham.getByRole("link", { name: "מבחן קבוצתי על ההרצאה" }).count()) === 1 : (await shoham.getByRole("link", { name: "מבחן קבוצתי על ההרצאה" }).count()) === 0),
        `${search(shoham)} ${ready}`,
      );
      await shot(shoham, "practice-11-lecture");

      /* ── 9. סבב חדש: from where, parts, style, how many, how ── */
      await shoham.getByRole("link", { name: "סבב חדש" }).click();
      await shoham.locator(".pr-sources").waitFor({ timeout: 10000 });
      const sources = (await shoham.locator(".pr-sources button").allInnerTexts()).map(norm);
      const startText = norm(await shoham.locator(PRIMARY).innerText());
      check(
        "9 סבב חדש: the member's own counts, לא נענו and טעיתי chosen, 10 of them, practice mode",
        search(shoham) === `?v=practice&l=${L}&x=round` &&
          sources.join("|") === `✓ לא נענו · ${bankSize}|✓ טעיתי · 0|סימנתי · 0|הכול · ${bankSize}` &&
          (await shoham.locator(".pr-size [aria-checked=true]").innerText()) === "10" &&
          norm(await shoham.locator(".pr-size [role=radio]").last().innerText()) === `${bankSize} · הכול` &&
          (await shoham.locator(".pr-mode [aria-checked=true] b").innerText()) === "תרגול" &&
          (await shoham.locator(".pr-parts button").count()) === 7 &&
          // With the question types a round picks a type group ("סוג שאלה"), shown only when the bank
          // has more than one; this bank is all multiple-choice, so neither picker is there.
          (typesOn
            ? (await shoham.locator(".pr-types, .pr-styles").count()) === 0
            : (await shoham.locator(".pr-styles [role=radio]", { hasText: "רק מקרים קליניים" }).count()) === 1) &&
          startText === "להתחיל · 10 שאלות",
        JSON.stringify({ sources, startText }),
      );
      await shot(shoham, "practice-12-round", { primary: PRIMARY });
      // "רק מקרים קליניים" counts only the cases; back to הכול; then 5. With the question types there is
      // no style filter (the type groups replace it): the count stays the whole bank.
      if (typesOn) {
        const allCount = norm(await shoham.locator(".pr-sources button").last().innerText());
        await shoham.locator(".pr-size [role=radio]", { hasText: /^5$/ }).click();
        check("9 a style narrows the counts (cases only)", allCount === `הכול · ${bankSize}`, allCount);
      } else {
        await shoham.locator(".pr-styles [role=radio]", { hasText: "רק מקרים קליניים" }).click();
        const caseCount = norm(await shoham.locator(".pr-sources button").last().innerText());
        await shoham.locator(".pr-styles [role=radio]", { hasText: "הכול" }).click();
        await shoham.locator(".pr-size [role=radio]", { hasText: /^5$/ }).click();
        check("9 a style narrows the counts (cases only)", caseCount === `הכול · ${cases}`, caseCount);
      }
      await shoham.locator(PRIMARY).click();

      /* ── 10. A question as approved: pick, bet, לבדוק; the autopsy ── */
      await shoham.locator(".pq-options").waitFor({ timeout: 10000 });
      const sessionUrl = search(shoham);
      await until(async () => norm(await shoham.locator(".ph-head .t").innerText()).includes("·"), 10000, "the lecture's title in the head");
      const head = norm(await shoham.locator(".ph-head").innerText());
      const q1 = await onScreen(shoham);
      check(
        "10 the session: its URL, 'תרגול · <lecture>' and 1/5 in the head, the style and the slide, five options, the bet marked רק לך, לבדוק waiting",
        sessionUrl === `?v=practice&l=${L}&s=l.${L}&n=5` &&
          head === `→ לתרגול תרגול · ${db.lectures[0].title} 1/5` &&
          (await shoham.locator(".pq-options button.a-opt").count()) === 5 &&
          norm(await shoham.locator(".pq-based").innerText()).startsWith("מבוסס על ש׳") &&
          (await shoham.locator(".pq-bet .a-chip", { hasText: "רק לך" }).count()) === 1 &&
          (await shoham.locator(PRIMARY).isDisabled()),
        head,
      );
      const wrong1 = q1.q.options.find((o) => o !== q1.right);
      await pick(shoham, wrong1);
      const pickedOnly = (await shoham.locator(PRIMARY).isDisabled()) && (await shoham.locator(".pq-options .a-opt.picked").count()) === 1 && !P.answers.some((a) => a.question_id === q1.q.id);
      await bet(shoham, "נראה לי");
      await shot(shoham, "practice-13-question", { primary: PRIMARY });
      await shoham.locator(PRIMARY).click();
      const v1 = await verdict(shoham);
      const autopsy = await shoham.locator(".pq-autopsy > li").evaluateAll((els) =>
        els.map((e) => ({ cls: e.className, text: e.querySelector(".pq-text")?.innerText.replace(/\s+/g, " ").trim(), x: e.querySelector(".x")?.innerText.replace(/\s+/g, " ").trim() ?? "" })),
      );
      const a1 = P.answers.filter((a) => a.question_id === q1.q.id).pop();
      check(
        "10 a tap picks (nothing sent), לבדוק sends the choice with the bet (2); the verdict, then the choice, the key, the rest, each with מתי כן",
        pickedOnly &&
          a1?.confidence === 2 &&
          a1.choice === q1.q.options.indexOf(wrong1) &&
          v1 === "✗ טעות · ׳נראה לי׳" &&
          autopsy.length === 5 &&
          autopsy[0].cls.includes("wrong") &&
          autopsy[0].cls.includes("picked") &&
          norm(autopsy[0].text) === norm(wrong1) &&
          autopsy[0].x.startsWith("✗ הבחירה שלך.") &&
          autopsy[0].x.includes("מתי כן:") &&
          autopsy[1].cls.includes("correct") &&
          norm(autopsy[1].text) === norm(q1.right) &&
          autopsy[1].x.startsWith("✓ התשובה הנכונה.") &&
          !autopsy[1].x.includes("מתי כן") &&
          autopsy.slice(2).every((o) => o.x.includes("מתי כן:") && !/[✓✗]/.test(o.x)) &&
          (await shoham.locator(".pq-verdict .a-chip", { hasText: "רק לך" }).count()) === 1 &&
          (await shoham.locator(".pq-take").innerText()).startsWith("מה לזכור:"),
        JSON.stringify({ pickedOnly, a1, v1, autopsy }),
      );
      const foot = (await shoham.locator(".ph-foot .a-btn").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim() || e.getAttribute("aria-label")))).map(norm);
      // The part's name, whole or cut at its last word within 24 characters (lib/questionText's
      // shortName; never a CSS ellipsis, which would clip an English name from its start).
      const fullTitle = norm(db.sections.find((s) => s.lecture_id === L && s.idx === q1.q.part_idx).title);
      const cut = (t, max) => {
        if (t.length <= max) return t;
        const head = t.slice(0, max - 1);
        const at = head.lastIndexOf(" ");
        return `${(at >= max / 2 ? head.slice(0, at) : head).replace(/[\s:·,–-]+$/u, "")}…`;
      };
      const partTitle = cut(fullTitle, 24);
      check("10 the bottom bar: לפסקה with its part, the flag, לשאלה הבאה", foot.join("|") === `לפסקה: ${partTitle}|משהו לא בסדר בשאלה?|לשאלה הבאה`, JSON.stringify(foot));
      await shot(shoham, "practice-14-autopsy", { primary: PRIMARY });
      // Dark: the wrong choice and the key keep their marks, in the dark colours.
      await shoham.emulateMedia({ colorScheme: "dark" });
      const dark = await shoham.evaluate(() => ({
        page: getComputedStyle(document.body).backgroundColor,
        right: getComputedStyle(document.querySelector(".pq-autopsy .a-opt.correct")).borderTopColor,
        wrongL: getComputedStyle(document.querySelector(".pq-autopsy .a-opt.wrong > .l")).backgroundColor,
      }));
      await shoham.emulateMedia({ colorScheme: "light" });
      check("10 dark: the page, the key's border and the wrong letter in the dark colours", dark.page === "rgb(18, 16, 34)" && dark.right === "rgb(98, 224, 156)" && dark.wrongL === "rgb(255, 138, 133)", JSON.stringify(dark));

      /* ── 11. A slide tag opens the slide; לפסקה opens the paragraph; Back returns ── */
      const tag = shoham.locator(".pq-autopsy .src-link").first();
      const tagSlides = await tag.getAttribute("data-slides");
      await tag.click();
      const slideDialog = shoham.getByRole("dialog", { name: `שקף ${tagSlides.split(/[-,]/)[0]}` });
      await slideDialog.waitFor({ timeout: 10000 });
      check("11 a slide tag opens SlideSheet and the URL stays", search(shoham) === sessionUrl, search(shoham));
      await shot(shoham, "practice-15-slide");
      await slideDialog.getByRole("button", { name: "סגירה" }).click();
      await slideDialog.waitFor({ state: "detached", timeout: 5000 });
      await shoham.locator(".pq-paragraph").click();
      await until(() => search(shoham).startsWith(`?l=${L}`), 10000, "the paragraph");
      const para = search(shoham);
      await shoham.locator(`[data-part="${q1.q.part_idx}"] [data-blk="${q1.q.anchor}"]`).waitFor({ timeout: 10000 });
      check("11 לפסקה: the lecture at the question's paragraph", para === `?l=${L}&at=${q1.q.part_idx}.${q1.q.anchor}`, para);
      await shot(shoham, "practice-16-paragraph");
      await shoham.goBack();
      await shoham.locator(".pq-verdict").waitFor({ timeout: 10000 });
      check("11 Back returns to the same autopsy", search(shoham) === sessionUrl && (await verdict(shoham)) === "✗ טעות · ׳נראה לי׳");

      /* ── 12. A right answer 'על בטוח'; 'לא יודעים' with no bet ── */
      await shoham.locator(PRIMARY).click();
      await shoham.locator(".pq-pos", { hasText: "2/5" }).waitFor({ timeout: 10000 });
      const q2 = await onScreen(shoham);
      await pick(shoham, q2.right);
      await bet(shoham, "על בטוח");
      await shoham.locator(PRIMARY).click();
      const v2 = await verdict(shoham);
      const first2 = await shoham.locator(".pq-autopsy > li").first().evaluate((e) => ({ cls: e.className, x: e.querySelector(".x")?.innerText.trim() }));
      check(
        "12 right 'על בטוח': ✓ נכון · ׳על בטוח׳, the key first, marked as the choice",
        v2 === "✓ נכון · ׳על בטוח׳" && first2.cls.includes("correct") && first2.cls.includes("picked") && first2.x.startsWith("✓ התשובה הנכונה · הבחירה שלך.") && P.answers.filter((a) => a.question_id === q2.q.id).pop()?.confidence === 3,
        JSON.stringify({ v2, first2 }),
      );
      await shoham.locator(PRIMARY).click();
      await shoham.locator(".pq-pos", { hasText: "3/5" }).waitFor({ timeout: 10000 });
      const q3 = await onScreen(shoham);
      await shoham.getByRole("button", { name: "לא יודעים" }).click();
      const v3 = await verdict(shoham);
      const a3 = P.answers.filter((a) => a.question_id === q3.q.id).pop();
      check("12 'לא יודעים': no choice, no bet, the key first", v3 === "בלי תשובה" && a3?.choice === null && a3.confidence === null && (await shoham.locator(".pq-autopsy > li").first().getAttribute("class")).includes("correct"), JSON.stringify({ v3, a3 }));

      /* ── 13. Two members' flags hide a question from everyone; the fix sheet brings it back ── */
      // Noa's flag first (the app's request, from Noa's phone), then Shoham's from the autopsy.
      await noa.evaluate(async (qid) => {
        const s = JSON.parse(localStorage.getItem("study-auth"));
        await fetch("https://mock.supabase.test/rest/v1/study_question_flags", {
          method: "POST",
          headers: { authorization: `Bearer ${s.access_token}`, "content-type": "application/json", apikey: "mock-anon-key" },
          body: JSON.stringify({ question_id: qid, reason: "two_answers", note: "גם ב׳ נכונה לפי שקף 4" }),
        });
      }, q3.q.id);
      await shoham.getByRole("button", { name: "משהו לא בסדר בשאלה?" }).click();
      const flagDialog = shoham.getByRole("dialog", { name: "מה לא בסדר בשאלה?" });
      await flagDialog.getByText("התשובה המסומנת שגויה").click();
      await shot(shoham, "practice-17-flag");
      await flagDialog.getByRole("button", { name: "שליחה לקבוצה" }).click();
      await shoham.locator(".a-toast", { hasText: "זה הדגל השני, אז השאלה יצאה מהתרגול של כולם" }).waitFor({ timeout: 10000 });
      check("13 the second member's counting flag hides the question for everyone (hidden_at), and the toast says so", Boolean(q3.q.hidden_at) && P.flags.filter((f) => f.question_id === q3.q.id).length === 2);
      // Out of every count while hidden: Noa's סבב חדש counts one fewer.
      await noa.goto(`${mock.base}/?v=practice&l=${L}&x=round`);
      await noa.locator(".pr-sources").waitFor({ timeout: 10000 });
      const noaAll = norm(await noa.locator(".pr-sources button").last().innerText());
      check("13 a hidden question leaves every count", noaAll === `הכול · ${bankSize - 1}`, noaAll);
      await noa.goto(`${mock.base}/?v=practice&l=${L}`);
      const fixRow = noa.locator(".fix-row");
      await fixRow.waitFor({ timeout: 10000 });
      await fixRow.getByRole("button", { name: "לבדוק מול השקף" }).click();
      const fixDialog = noa.getByRole("dialog", { name: "לבדוק מול השקף" });
      await fixDialog.locator(".fix-options .a-opt.correct").waitFor({ timeout: 10000 });
      const fixText = norm(await fixDialog.innerText());
      check(
        "13 the fix sheet: the key and its explanations, both flags without names, the question's slides chosen",
        fixText.includes("✓ המפתח.") &&
          fixText.includes("יש יותר מתשובה נכונה אחת · ״גם ב׳ נכונה לפי שקף 4״") &&
          fixText.includes("התשובה המסומנת שגויה") &&
          !fixText.includes("שוהם") &&
          (await fixDialog.locator(".a-chip[aria-pressed=true]").count()) === q3.q.slides.length,
        fixText.slice(0, 400),
      );
      await shot(noa, "practice-18-fix");
      await fixDialog.getByLabel("למה (לא חובה)").fill("שקף 9 אומר את זה במפורש");
      await fixDialog.getByRole("button", { name: "להשאיר בתרגול" }).click();
      await noa.locator(".a-toast", { hasText: "השאלה חזרה לתרגול של כולם." }).waitFor({ timeout: 10000 });
      await fixRow.waitFor({ state: "detached", timeout: 10000 });
      check(
        "13 'להשאיר בתרגול' with the slides and a note: back in everyone's practice",
        !q3.q.hidden_at && P.fixes?.[0]?.verdict === "keep" && JSON.stringify(P.fixes[0].slides) === JSON.stringify(q3.q.slides) && P.fixes[0].note === "שקף 9 אומר את זה במפורש" && P.fixes[0].by === noaId,
        JSON.stringify(P.fixes),
      );

      /* ── 14. The end of the round ── */
      for (const i of [4, 5]) {
        await shoham.locator(PRIMARY).click();
        await shoham.locator(".pq-pos", { hasText: `${i}/5` }).waitFor({ timeout: 10000 });
        const qi = await onScreen(shoham);
        await pick(shoham, qi.right);
        await bet(shoham, "ניחוש");
        await shoham.locator(PRIMARY).click();
        await shoham.locator(".pq-verdict").waitFor({ timeout: 10000 });
      }
      check("14 the last question says לסיכום הסבב", norm(await shoham.locator(PRIMARY).innerText()) === "לסיכום הסבב");
      await shoham.locator(PRIMARY).click();
      await shoham.getByRole("heading", { name: "סוף הסבב" }).waitFor({ timeout: 10000 });
      const end = norm(await shoham.locator(".pq-end").innerText());
      const rows = (await shoham.locator(".pq-review-row").allInnerTexts()).map(norm);
      check(
        "14 the end: 3 מתוך 5, רק לך, לחזור על the two, סבב נוסף and רק הטעויות מהסבב",
        (await shoham.locator(".pq-score b").innerText()) === "3 מתוך 5" &&
          end.includes("רק לך") &&
          end.includes("לחזור על") &&
          rows.length === 2 &&
          norm(await shoham.locator(PRIMARY).innerText()) === "סבב נוסף" &&
          (await shoham.getByRole("button", { name: "רק הטעויות מהסבב" }).count()) === 1,
        JSON.stringify({ end, rows }),
      );
      await shot(shoham, "practice-19-end", { primary: PRIMARY });
      await shoham.locator(".pq-review-row").first().click();
      await shoham.locator(".pq-review-body .pq-autopsy").waitFor({ timeout: 5000 });
      check("14 a row opens its autopsy and לפסקה", (await shoham.locator(".pq-review-body .pq-read").count()) === 1 && (await shoham.locator(".pq-review-body .pq-autopsy > li").count()) === 5);

      /* ── 15. סבב חדש from the mistakes, in exam mode: a clock, no autopsy until the end ── */
      await shoham.goto(`${mock.base}/?v=practice&l=${L}&x=round`);
      await shoham.locator(".pr-sources").waitFor({ timeout: 10000 });
      const sources2 = (await shoham.locator(".pr-sources button").allInnerTexts()).map(norm);
      await shoham.locator(".pr-sources button", { hasText: "לא נענו" }).click(); // leaves טעיתי
      await shoham.locator(".pr-mode [role=radio]", { hasText: "מצב מבחן" }).click();
      const start2 = norm(await shoham.locator(PRIMARY).innerText());
      check(
        "15 the counts after the round: לא נענו one fewer per answer, טעיתי the two, סימנתי the flag",
        sources2.join("|") === `✓ לא נענו · ${bankSize - 5}|✓ טעיתי · 2|סימנתי · 1|הכול · ${bankSize}` && start2 === "להתחיל · 2 שאלות",
        JSON.stringify({ sources2, start2 }),
      );
      await shoham.locator(PRIMARY).click();
      await shoham.locator(".pq-pos", { hasText: "1/2" }).waitFor({ timeout: 10000 });
      const clock = norm(await shoham.locator(".pq-clock").innerText());
      const askedIds = [];
      await shot(shoham, "practice-20-exam", { primary: PRIMARY });
      let autopsies = 0;
      for (let i = 1; i <= 2; i++) {
        await shoham.locator(".pq-pos", { hasText: `${i}/2` }).waitFor({ timeout: 10000 });
        const qi = await onScreen(shoham);
        askedIds.push(qi.q.id);
        await pick(shoham, qi.right);
        await bet(shoham, "נראה לי");
        await shoham.locator(PRIMARY).click();
        if (i < 2) {
          await shoham.locator(".pq-pos", { hasText: "2/2" }).waitFor({ timeout: 10000 });
          autopsies += await shoham.locator(".pq-autopsy").count();
        }
      }
      await shoham.getByRole("heading", { name: "סוף הסבב" }).waitFor({ timeout: 10000 });
      const items = await shoham.locator(".pq-exam-item").count();
      const examAnswers = P.answers.slice(-2);
      check(
        "15 exam mode on the mistakes: exactly the round's two wrong ones, a clock, no autopsy before the end, both after, recorded as exam with the bet",
        /^\d:\d\d$/.test(clock) &&
          autopsies === 0 &&
          items === 2 &&
          (await shoham.locator(".pq-exam-item .pq-autopsy").count()) === 2 &&
          askedIds.sort().join() === [q1.q.id, q3.q.id].sort().join() &&
          examAnswers.every((a) => a.mode === "exam" && a.confidence === 2),
        JSON.stringify({ clock, autopsies, items, askedIds, examAnswers }),
      );
      await shot(shoham, "practice-21-exam-end", { primary: PRIMARY });

      /* ── 16. The library's chip and the hub ── */
      await shoham.goto(`${mock.base}/?v=library`);
      const chip = shoham.locator(".lc", { hasText: db.lectures[0].title }).locator(".lc-chips a", { hasText: `${bankSize} שאלות` }).first();
      await chip.waitFor({ timeout: 10000 });
      check("16 library: the bank's chip opens the lecture's practice", (await chip.getAttribute("href")) === `/?v=practice&l=${L}`);
      await shoham.goto(`${mock.base}/?v=practice`);
      const create2 = shoham.locator(".practice-row", { hasText: "משתנים: הרצאה שנייה" }).getByRole("link", { name: "יצירה" });
      await create2.waitFor({ timeout: 10000 });
      check("16 the hub: a lecture with no questions links 'יצירה' to מה ליצור", (await create2.getAttribute("href")) === `/?v=practice&l=${L2}&x=new`);
      await shot(shoham, "practice-22-hub");

      /* ── 17. A batch that fails: its reason and "להמשיך לכתוב"; the month's cap ── */
      P.solverFails = () => false;
      P.unchecked = () => false;
      P.fail = (b) => b.lecture_id === L2 && b.part_idx === 2;
      await create2.click();
      // The points of L2: part 2's call times out, and the server dies while reading part 5 (its lease runs out, no event).
      P.pointsFail = (l, i) => (l === L2 && i === 2 ? "timeout" : null);
      P.pointsStall = (l, i) => l === L2 && i === 5;
      await shoham.getByRole("button", { name: "לקרוא את הנקודות" }).click();
      await shoham.getByRole("heading", { name: "הקריאה נעצרה באמצע" }).waitFor({ timeout: 20000 });
      const stoppedRows = await shoham.locator(".pc-read-parts li").evaluateAll((els) => els.map((e) => [e.getAttribute("data-state"), e.innerText.replace(/\s+/g, " ").trim()]));
      check(
        "17 a read the server dropped: never 'reading' forever; the part that failed with its reason, the dropped one stopped, the rest kept, and לנסות שוב",
        stoppedRows.length === 8 &&
          stoppedRows.filter(([x]) => x === "ready").length === 6 &&
          stoppedRows[2][0] === "failed" &&
          stoppedRows[2][1].includes("הקריאה של החלק לקחה יותר מדי זמן.") &&
          stoppedRows[5][0] === "stopped" &&
          norm(await shoham.locator(PRIMARY).innerText()) === "לנסות שוב · כ-$0.14" &&
          !(await shoham.locator(PRIMARY).isDisabled()),
        JSON.stringify(stoppedRows),
      );
      const stoppedLine = norm(await shoham.locator(".pc-reading [role=status]").innerText());
      check("17 a stopped read's count: the failed part and the stopped one, both not read", stoppedLine === "6 מתוך 8 חלקים · 2 לא נקראו", stoppedLine);
      await shot(shoham, "practice-22a-points-stopped", { primary: PRIMARY });
      // לנסות שוב reads only the two parts; part 2 is refused this time.
      P.pointsStall = null;
      P.pointsFail = (l, i) => (l === L2 && i === 2 ? "refusal" : null);
      await shoham.locator(PRIMARY).click();
      await shoham.getByRole("heading", { name: "חלק אחד לא נקרא" }).waitFor({ timeout: 20000 });
      const failedRows = (await shoham.locator(".pc-failed .pc-read-parts li").allInnerTexts()).map(norm);
      check(
        "17 לנסות שוב reads only the parts not read; a part that fails again: its reason in Hebrew, לנסות שוב, and the counts of the rest",
        P.pointReads.at(-1).parts.join() === "2,5" &&
          failedRows.length === 1 &&
          failedRows[0].includes("המודל סירב לקרוא את החלק הזה.") &&
          norm(await shoham.locator(PRIMARY).innerText()) === "לנסות שוב · כ-$0.14" &&
          (await shoham.locator(".pc-levels").count()) === 1,
        JSON.stringify({ reads: P.pointReads.at(-1), failedRows }),
      );
      await shot(shoham, "practice-22b-points-failed", { primary: PRIMARY });
      P.pointsFail = null;
      await shoham.locator(PRIMARY).click();
      await shoham.locator(PRIMARY, { hasText: "המשך: דוגמה ומיקוד" }).waitFor({ timeout: 20000 });
      check("17 the part read on the second try: every part has its points", P.pointReads.at(-1).parts.join() === "2" && [...P.pointParts.values()].filter((x) => x.lecture_id === L2 && x.status === "ready").length === 8);
      await shoham.locator(".pc-levels").waitFor({ timeout: 20000 });
      await shoham.locator(".pc-levels [role=radio]", { hasText: "ממוקד" }).click();
      await shoham.locator(".pc-levels [role=radio][aria-checked=true]", { hasText: "ממוקד" }).waitFor();
      await shoham.locator(PRIMARY).click();
      await shoham.getByRole("heading", { name: "דוגמה ומיקוד" }).waitFor({ timeout: 10000 });
      const nFocused = level("focused", all);
      await shoham.locator(PRIMARY, { hasText: `ליצור ${nFocused} שאלות` }).click();
      await shoham.getByRole("heading", { name: "הבנק נבנה" }).waitFor({ timeout: 10000 });
      const rq2 = P.qrequests[1];
      const bs2 = () => P.batches.filter((b) => b.request_id === rq2.id);
      await until(() => bs2().every((b) => b.status === "ready" || b.status === "failed"), 60000, "the second request");
      const failedLine = shoham.locator(".pb-failed li");
      await failedLine.waitFor({ timeout: 10000 });
      const resume = shoham.getByRole("button", { name: "להמשיך לכתוב" });
      await resume.waitFor({ timeout: 10000 });
      const failText = norm(await failedLine.innerText());
      check(
        "17 a batch that timed out: its part and reason, and להמשיך לכתוב (ממוקד's count, the rest written)",
        failText.includes("החלק לא נכתב. החלק לקח יותר מדי זמן.") && rq2.count === nFocused && rq2.level === "focused" && bs2().filter((b) => b.status === "failed").length === 1,
        failText,
      );
      await shot(shoham, "practice-23-failed", { primary: PRIMARY });
      const failedBatch = bs2().find((b) => b.status === "failed");
      const before = P.requests.length;
      await resume.click();
      await until(() => failedBatch.status === "ready", 15000, "the failed batch, written again");
      check("17 להמשיך לכתוב writes only that batch again", P.requests.slice(before).length === 1 && P.requests[before].batch === failedBatch.id, JSON.stringify(P.requests.slice(before).map((r) => r.part)));
      // The month's optional spending stops at 80% of the cap: the cost card says so and ליצור waits.
      db.spent = 30;
      await shoham.goto(`${mock.base}/?v=practice&l=${L2}&x=example`);
      await shoham.locator(".pc-cost").waitFor({ timeout: 10000 });
      await shoham.locator(".a-error", { hasText: "זה נעצר עד סוף החודש" }).waitFor({ timeout: 10000 });
      check("17 at 80% of the month's cap: the line, and ליצור waits", await shoham.locator(PRIMARY).isDisabled());
      await shot(shoham, "practice-24-cap", { primary: PRIMARY });
      db.spent = 12.4;

      /* ── 18. One reservation and one settlement per model call, by kind ── */
      const batchesRun = P.requests.filter((r) => r.status === 200 && P.batches.find((b) => b.id === r.batch)?.request_id).length;
      const solverRuns = P.requests.filter((r) => r.status === 200 && P.batches.find((b) => b.id === r.batch)?.status === "ready" && r.end).length;
      const kinds = { practice: ledger("practice"), solver: ledger("solver"), points: ledger("points"), style: ledger("style"), reword: ledger("reword") };
      check(
        "18 the ledger: practice one per batch call, solver one per batch written, points one per part read (8 on L; 7, then the 2 and 5 again, then 2 on L2, the dropped one never settled by its dead server), style once, reword once, each reserved and settled",
        kinds.practice.reserve === batchesRun &&
          kinds.practice.settle === batchesRun &&
          kinds.solver.reserve === kinds.solver.settle &&
          kinds.solver.reserve === batchesRun - 1 &&
          kinds.points.reserve === P.pointCalls &&
          kinds.points.settle === P.pointCalls &&
          P.pointCalls === 8 + 7 + 2 + 1 &&
          kinds.style.reserve === 1 &&
          kinds.reword.reserve === 1,
        JSON.stringify({ kinds, batchesRun, solverRuns, pointCalls: P.pointCalls }),
      );

      /* ── 19. Reading the points when the phone loses its connection, two members tap at once, or the stream never ends ── */
      // L2's summary changes: its points are stale again.
      const staleL2 = () => {
        for (const sec of db.sections.filter((x) => x.lecture_id === L2)) sec.markdown += " ";
      };
      const pointsPost = (route) => (route.request().postData() || "").includes('"action":"points"');
      const reads0 = P.pointReads.length;
      staleL2();
      await shoham.goto(`${mock.base}/?v=practice&l=${L2}&x=new`);
      const again = shoham.getByRole("button", { name: "לקרוא שוב את הנקודות" });
      await again.waitFor({ timeout: 15000 });
      // The ask never reaches the server (no signal at the tap): the no-connection line, and the button again.
      await shoham.route("**/api/study/ai", async (route) => {
        if (!pointsPost(route)) return route.continue();
        await new Promise((ok) => setTimeout(ok, 800));
        return route.abort("internetdisconnected");
      });
      await again.click();
      await shoham.locator(".a-error", { hasText: "אין חיבור כרגע" }).waitFor({ timeout: 10000 });
      const offline = { error: norm(await shoham.locator(".a-error").innerText()), bar: norm(await shoham.locator(PRIMARY).innerText()), claims: P.pointReads.length - reads0, reading: await shoham.locator(".pc-reading").count() };
      check(
        "19 an ask that never reached the server: the no-connection line, nothing read, and the button to read again",
        offline.error === "אין חיבור כרגע. כדאי לבדוק את החיבור ולנסות שוב." && offline.bar === "לקרוא שוב את הנקודות · כ-$0.14" && offline.claims === 0 && offline.reading === 0,
        JSON.stringify(offline),
      );
      await shot(shoham, "practice-25-points-offline", { primary: PRIMARY });
      await shoham.unroute("**/api/study/ai");

      // Two members tap at once: Noa's ask reaches the server first, Shoham's is refused ("busy").
      P.pointsDelay = () => 4000;
      await noa.goto(`${mock.base}/?v=practice&l=${L2}&x=new`);
      const noaAgain = noa.getByRole("button", { name: "לקרוא שוב את הנקודות" });
      await noaAgain.waitFor({ timeout: 15000 });
      let release = null;
      await shoham.route("**/api/study/ai", async (route) => {
        if (!pointsPost(route)) return route.continue();
        await new Promise((ok) => (release = ok));
        return route.continue();
      });
      await again.click();
      await until(async () => release !== null, 5000, "Shoham's ask held");
      await noaAgain.click();
      await until(async () => P.pointReads.length > reads0, 5000, "Noa's claim");
      release();
      // Shoham's refusal comes back; the screen follows Noa's read from the database.
      await until(async () => (await shoham.locator(".pc-reading h2").count()) > 0, 5000, "Shoham's screen following the read");
      await shoham.waitForTimeout(1500);
      const race = {
        claimedBy: P.pointReads.at(-1).user === noaId ? "noa" : "shoham",
        reads: P.pointReads.length - reads0,
        shoham: norm(await shoham.locator(".pc-reading h2").innerText()),
        noa: norm(await noa.locator(".pc-reading h2").innerText()),
        shohamNote: norm(await shoham.locator(".pc-reading .a-muted").innerText()),
        errors: await shoham.locator(".a-error").count(),
      };
      check(
        "19 two members tap at once: one read; the refused phone says it is read on another phone (not 'אפשר לצאת מהמסך'), the other that it is its own",
        race.claimedBy === "noa" &&
          race.reads === 1 &&
          race.shoham === "קוראים את הנקודות שצריך לדעת במכשיר אחר…" &&
          race.noa === "קוראים את הנקודות שצריך לדעת…" &&
          race.shohamNote === "המסך יתעדכן כשהקריאה תסתיים." &&
          race.errors === 0,
        JSON.stringify(race),
      );
      await shot(shoham, "practice-26-points-busy", { primary: PRIMARY });
      await shoham.unroute("**/api/study/ai");
      await shoham.locator(".pc-levels").waitFor({ timeout: 30000 });
      await noa.locator(".pc-levels").waitFor({ timeout: 15000 });

      // The stream never ends on this phone (it slept, the connection died without an error) while the server reads every part.
      P.pointsDelay = (l, i) => 800 + 300 * i;
      P.pointsFail = (l, i) => (l === L2 && i === 2 ? "timeout" : null);
      staleL2();
      await shoham.reload();
      await again.waitFor({ timeout: 15000 });
      let served = false;
      await shoham.route("**/api/study/ai", async (route) => {
        if (!pointsPost(route)) return route.continue();
        await route.fetch(); // the server reads it all; the answer never reaches the phone
        served = true;
      });
      const reads1 = P.pointReads.length;
      await again.click();
      await until(async () => served, 20000, "the server's read to end");
      await shoham.getByRole("heading", { name: "חלק אחד לא נקרא" }).waitFor({ timeout: 10000 });
      const hang = {
        server: [...P.pointParts.values()].filter((x) => x.lecture_id === L2).map((x) => x.status).join(),
        reading: await shoham.locator(".pc-reading").count(),
        failed: (await shoham.locator(".pc-failed .pc-read-parts li").allInnerTexts()).map(norm),
        bar: norm(await shoham.locator(PRIMARY).innerText()),
        disabled: await shoham.locator(PRIMARY).isDisabled(),
        reads: P.pointReads.length - reads1,
      };
      check(
        "19 a stream that never ends: the database ends the read on the screen; the failed part with its reason and לנסות שוב, never a disabled 'קוראים' forever",
        hang.server === "ready,ready,failed,ready,ready,ready,ready,ready" &&
          hang.reading === 0 &&
          hang.failed.length === 1 &&
          hang.failed[0].includes("הקריאה של החלק לקחה יותר מדי זמן.") &&
          hang.bar === "לנסות שוב · כ-$0.14" &&
          !hang.disabled &&
          hang.reads === 1,
        JSON.stringify(hang),
      );
      await shot(shoham, "practice-27-points-hang-ended", { primary: PRIMARY });
      await shoham.unroute("**/api/study/ai");
      P.pointsFail = null;
      P.pointsDelay = null;

      /* ── UX-1: under these flags no step landed on a route that is off ── */
      const landed = (await noticesOf(shoham)) + (await noticesOf(noa));
      check("UX-1 no control led to a route these flags replace (no notice line all along)", landed === "", landed);
      check("the old one-button sheet is gone from the app", !mock.calls.some((c) => c.includes("study_question_round")), JSON.stringify(mock.calls.filter((c) => c.includes("study_question_round"))));
      void shohamId;
    }

    const problems = mock.problems;
    const failed = Object.entries(steps).filter(([, v]) => typeof v === "string" && v.startsWith("FAIL"));
    console.log(JSON.stringify({ flags: flagSet, errors: problems, steps, a11y }, null, 1));
    if (problems.length || a11y.length || failed.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, steps, a11y, calls: mock.calls.slice(-14) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
