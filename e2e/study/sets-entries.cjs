// Practice sets, slice B's entry points and slice C's notices (docs/study/sets.md;
// WP14, WP15 and WP17; the design's §4 tap counts and §14 steps 6, 7, 9, 10
// and 11), against the mock (mocks/practice.cjs, mocks/sets.cjs and
// mocks/notify.cjs), flag set ps, with two members, שוהם and נועה:
//  - §4: the lecture page with no questions → the first question on screen in
//    3 taps (סט חדש → ליצור → להתחיל לפתור); made → visible to the group in 0;
//    Today's row → solving the new set in 3 (the row → the set → לפתור);
//    Today → a new set, the lecture prefilled, in 2 (סט חדש → ליצור);
//  - Today (step 6): one row "סטים חדשים בקבוצה (1)" and the free primary
//    "לפתור סט חדש" on an empty queue; opening the set clears it;
//  - the inbox (WP17): נועה's set_shared ("סט תרגול חדש בקבוצה", "{lecture} ·
//    n שאלות · מאת שוהם"); שוהם's set_solved once נועה finished ("הסט ״…״
//    נפתר פעם אחת");
//  - the mistakes (step 10): the set's end and "הטעויות שלי"'s end offer
//    "שאלות חדשות על הטעויות · כ-$0.40" beside the free "לחזור על הטעויות",
//    which opens the create screen from the mistakes ("…בלי לציין שהוא על
//    טעויות");
//  - the hub's "סטים של הקבוצה" and "לכל הסטים", the lecture page's "סטים על
//    ההרצאה (n)" and D6's line while שוהם makes another set;
//  - a paused set (step 9): שוהם's Today "הסט … נעצר באמצע · להמשיך ליצור",
//    נועה's "להמשיך ליצור" with "העלות נרשמת על מי שממשיך";
//  - "שלי"'s names row (OD7);
//  - the caps (step 11): the 80% line, the 40% share, the sets line, the
//    day's sets;
//  - a set's link opened signed out (step 7): the line above Join, the
//    personal code, and the same set after the sign-in.
// Synthetic Hebrew content only; screenshots stay out of the repo.
//
//   <every s2 flag> VITE_STUDY_INSTALL=1 VITE_STUDY_NOTIFY=1 VITE_STUDY_MAKE=1 VITE_STUDY_SETS=1 \
//   VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
//     npx vite build --outDir <dist>
//   NODE_PATH=$(npm root -g) node e2e/study/sets-entries.cjs <dist> <out dir> [ps]

const fs = require("fs");
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const plugin = require("./mocks/practice.cjs");
const setsPlugin = require("./mocks/sets.cjs");
const todayPlugin = require("./mocks/today.cjs");

const [dist, out, flagSet = process.env.E2E_FLAGS || "ps"] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/sets-entries.cjs <dist> <out dir> [ps]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const norm = (s) => String(s).replace(/[‎‏⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const FOOT_GO = ".make-screen > .ph-foot .mk-go";
const START = ".ph-foot .mk-start-btn";
const CODE = "ABCD-EFGH-JKLM-NPQR";

(async () => {
  const mock = await createMock({ dist, plugins: [plugin, setsPlugin, todayPlugin], flags: flagSet });
  const { db, LECTURE_ID: L } = mock;
  const P = db.practice;
  const Q = db.qsetsMock;
  const N = db.notifyMock;
  P.notify = mock.notify;
  Q.notify = mock.notify;
  mock.seedLecture();
  P.p2pace = 200;
  const lectureTitle = db.lectures[0].title;

  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const search = (page) => new URL(page.url()).search;
  const until = async (fn, ms = 20000, what = "condition") => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const shot = async (page, name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  const text = async (page, sel) => norm(await page.locator(sel).first().innerText({ timeout: 15000 }));
  /** Answers every question of the round with "לא יודעים", to its end. */
  const answerAll = async (page) => {
    for (let i = 0; i < 60 && !(await page.locator(".pq-end").count()); i++) {
      const dk = page.locator(".pq-dont-know");
      if (await dk.count()) {
        await dk.first().click();
        await page.locator(".pq-next").waitFor({ timeout: 15000 });
      }
      await page.locator(".pq-next").click();
      await until(async () => (await page.locator(".pq-end").count()) > 0 || (await page.locator(".pq-dont-know").count()) > 0, 10000, "the next question");
    }
    await page.locator(".pq-end").waitFor({ timeout: 15000 });
  };

  try {
    const { page: shoham } = await mock.open(browser, "שוהם", { path: `/?l=${L}` });
    const shohamId = db.members.find((m) => m.name === "שוהם").user_id;

    /* ── §4: the lecture page with no questions → the first question, 3 taps ── */
    let taps = 0;
    const tap = async (loc) => {
      await loc.click();
      taps += 1;
    };
    await shoham.locator(".mk-after-new").waitFor({ timeout: 15000 });
    check("lecture page: no 'סטים על ההרצאה' before the group has a set on it", (await shoham.locator(".mk-after-sets").count()) === 0, "");
    await tap(shoham.locator(".mk-after-new"));
    await until(async () => /ליצור 10 שאלות · כ-\$/.test(norm(await shoham.locator(FOOT_GO).innerText())), 15000, "the price on the button");
    await tap(shoham.locator(FOOT_GO));
    await until(async () => /v=sets&k=/.test(search(shoham)), 30000, "the set's page");
    const setId = new URL(shoham.url()).searchParams.get("k");
    // Once every question is written the author's device keeps them (review UX-1) and the set's page
    // takes over: its "לפתור" is the third tap ("להתחיל לפתור" if it is tapped before the end).
    const SOLVE = ".qs-page .ph-foot .qs-go";
    await until(async () => (await shoham.locator(SOLVE).count()) > 0, 60000, "every question written and kept");
    const third = SOLVE;
    await tap(shoham.locator(third));
    await shoham.locator(".pq-lead").first().waitFor({ timeout: 15000 });
    check("§4 the lecture page with no questions → the first question on screen: 3 taps (סט חדש → ליצור → לפתור, the set kept by the author's device)", taps === 3 && search(shoham).includes(`s=k.${setId}`), `${taps} · ${third}`);
    await answerAll(shoham);
    const shohamEnd = { mistakesNew: norm(await shoham.locator(".pq-mistakes-new").first().innerText()) };
    check("set's end: 'שאלות חדשות על הטעויות · כ-$0.40', the price in the label", shohamEnd.mistakesNew === "שאלות חדשות על הטעויות · כ-$0.40 ‹", JSON.stringify(shohamEnd));
    await until(async () => Q.sets.find((s) => s.id === setId)?.notified_at, 15000, "the set announced");

    /* ── made → visible to the group: 0 taps. נועה's Today (step 6) ── */
    const noaId = db.members.find((m) => m.name === "נועה").user_id;
    const { page: noa } = await mock.open(browser, "נועה", { path: "/" });
    await noa.locator(".t-sets-new").waitFor({ timeout: 15000 });
    const today = {
      rows: await noa.locator(".t-sets-new").count(),
      row: norm(await noa.locator(".t-sets-new").innerText()),
      primary: (await noa.locator(".t-start .t-solve-set").count()) ? norm(await noa.locator(".t-start .t-solve-set").innerText()) : "",
      bankLink: await noa.locator(".t-practice .t-free").count(),
    };
    check("Today (step 6): one row 'סטים חדשים בקבוצה (1) ‹' and, with an empty queue, the free primary names the set: 'לפתור: {lecture} · 10 שאלות' (the bank a link)", today.rows === 1 && today.row === "סטים חדשים בקבוצה (1) ‹" && today.primary === `לפתור: ${lectureTitle} · 10 שאלות` && today.bankLink === 1, JSON.stringify(today));
    await shot(noa, "setsc-01-today");

    /* ── WP17: the inbox ── */
    const shared = N.notices.filter((n) => n.kind === "set_shared");
    check("set_shared (WP17): the group but the author, once, the shelf as obj, the set as route", shared.length === db.members.filter((m) => m.user_id !== shohamId).length && shared.every((n) => n.obj === "qsets" && n.route.k === setId && n.count === 1) && !shared.some((n) => n.user_id === shohamId), JSON.stringify(shared.map((n) => ({ u: n.user_id, c: n.count }))));
    await noa.goto(`${mock.base}/?v=notify`);
    await noa.locator("main.notify-inbox .inbox-row").first().waitFor({ timeout: 15000 });
    const sharedRow = noa.locator(".inbox-row", { hasText: "סט תרגול חדש בקבוצה" });
    const inbox = { n: await sharedRow.count(), body: (await sharedRow.count()) ? norm(await sharedRow.locator(".inbox-b").innerText()) : "", href: (await sharedRow.count()) ? await sharedRow.getAttribute("href") : "" };
    check("the inbox: 'סט תרגול חדש בקבוצה' with '{lecture} · n שאלות · מאת שוהם', linking to the set", inbox.n === 1 && new RegExp(`^${lectureTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · \\d+ שאלות · מאת שוהם$`).test(inbox.body) && (inbox.href ?? "").includes(`k=${setId}`), JSON.stringify(inbox));
    await shot(noa, "setsc-02-inbox");

    /* ── §4: Today's row → solving the new set, 3 taps ── */
    await noa.goto(`${mock.base}/`);
    await noa.locator(".t-sets-new").waitFor({ timeout: 15000 });
    taps = 0;
    await tap(noa.locator(".t-sets-new"));
    await noa.locator(".qs-card-link").first().waitFor({ timeout: 15000 });
    await tap(noa.locator(".qs-card-link").first());
    await noa.locator(".qs-go").waitFor({ timeout: 15000 });
    await tap(noa.locator(".qs-go"));
    await noa.locator(".pq-lead").first().waitFor({ timeout: 15000 });
    check("§4 another member: Today's row → solving the new set: 3 taps (the row → the set → לפתור)", taps === 3 && search(noa).includes(`s=k.${setId}`), String(taps));
    await answerAll(noa);
    const noaEnd = { primary: norm(await noa.locator(".practice-session > .ph-foot .a-btn.primary").innerText()), link: norm(await noa.locator(".pq-mistakes-new").first().innerText()) };
    check("set's end for נועה: 'לחזור על הטעויות' free, the paid way with its price", noaEnd.primary === "לחזור על הטעויות" && noaEnd.link === "שאלות חדשות על הטעויות · כ-$0.40 ‹", JSON.stringify(noaEnd));
    const marked = Q.marks.find((m) => m.set_id === setId && m.user_id === noaId)?.seen_at;
    await noa.goto(`${mock.base}/`);
    await noa.locator(".t-practice").waitFor({ timeout: 15000 });
    await noa.waitForTimeout(800);
    check("opening the set cleared 'חדש': no Today row any more, and no 'לפתור סט חדש' once solved", Boolean(marked) && (await noa.locator(".t-sets-new").count()) === 0 && (await noa.locator(".t-solve-set").count()) === 0, String(marked));

    /* ── WP17: שוהם's set_solved ── */
    await until(async () => N.notices.some((n) => n.kind === "set_solved" && n.user_id === shohamId), 10000, "set_solved");
    await shoham.goto(`${mock.base}/?v=notify`);
    await shoham.locator("main.notify-inbox .inbox-row").first().waitFor({ timeout: 15000 });
    const solvedRow = shoham.locator(".inbox-row", { hasText: "נפתר" });
    const solved = { n: await solvedRow.count(), t: (await solvedRow.count()) ? norm(await solvedRow.locator(".inbox-t").innerText()) : "", shared: await shoham.locator(".inbox-row", { hasText: "סט תרגול חדש" }).count() };
    check("set_solved (WP17): 'הסט ״…״ נפתר פעם אחת' in the author's inbox only; no set_shared for the author", solved.n === 1 && /^הסט ״.+״ נפתר פעם אחת/.test(solved.t) && solved.shared === 0 && !N.notices.some((n) => n.kind === "set_solved" && n.user_id !== shohamId), JSON.stringify(solved));
    await shot(shoham, "setsc-03-inbox-solved");

    /* ── step 10: "הטעויות שלי"'s end ── */
    await noa.goto(`${mock.base}/?v=practice&s=m`);
    await noa.locator(".pq-lead").first().waitFor({ timeout: 15000 });
    await answerAll(noa);
    const mEnd = { primary: norm(await noa.locator(".practice-session > .ph-foot .a-btn.primary").innerText()), link: (await noa.locator(".pq-mistakes-new").count()) ? norm(await noa.locator(".pq-mistakes-new").first().innerText()) : "" };
    check("step 10 the mistakes' end: 'לחזור על הטעויות' as the free primary, 'שאלות חדשות על הטעויות · כ-$0.40' secondary", mEnd.primary === "לחזור על הטעויות" && mEnd.link === "שאלות חדשות על הטעויות · כ-$0.40 ‹", JSON.stringify(mEnd));
    await shot(noa, "setsc-04-mistakes-end");
    await noa.locator(".pq-mistakes-new").first().click();
    await until(async () => search(noa).includes("x=new") && search(noa).includes("from=m") && search(noa).includes(`l=${L}`), 15000, "the create screen from the mistakes");
    await until(async () => (await noa.locator(".mk-preview", { hasText: "בלי לציין שהוא על טעויות" }).count()) > 0, 15000, "the mistakes' line");
    check("step 10 the paid way opens 'סט חדש' on the mistakes' lecture, 'הסט ישותף עם הקבוצה כמו כל סט, בלי לציין שהוא על טעויות'", true, "");

    /* ── the hub's list ── */
    await noa.goto(`${mock.base}/?v=practice`);
    await noa.locator(".qs-hub .qs-card").first().waitFor({ timeout: 15000 });
    const hub = await noa.evaluate(() => {
      const main = document.querySelector("main.practice-home");
      const kids = [...main.children].map((e) => e.className);
      return {
        make: kids.findIndex((c) => /practice-make-card/.test(c)),
        sets: kids.findIndex((c) => /qs-hub/.test(c)),
        bank: kids.findIndex((c) => /practice-bank-h/.test(c)),
        head: main.querySelector(".qs-hub h2")?.textContent.trim(),
        all: main.querySelector(".qs-hub-all")?.textContent.trim(),
        allHref: main.querySelector(".qs-hub-all")?.getAttribute("href") ?? "",
        cards: main.querySelectorAll(".qs-hub .qs-card").length,
      };
    });
    check("hub: 'סטים של הקבוצה' after the 'סט חדש' card and before 'תרגול מהבנק', the newest sets, 'לכל הסטים ‹' to the shelf", hub.make >= 0 && hub.sets > hub.make && hub.bank > hub.sets && hub.head === "סטים של הקבוצה" && hub.all === "לכל הסטים ‹" && /v=sets$/.test(hub.allHref) && hub.cards === 1, JSON.stringify(hub));
    await shot(noa, "setsc-05-hub");

    /* ── the lecture page: "סטים על ההרצאה (n)" and D6's line ── */
    const t = new Date().toISOString();
    const rq = { id: "ae0000fe-0000-4000-8000-0000000000fe", lecture_id: L };
    const batch = { id: "ba0000fe-0000-4000-8000-0000000000fe", lecture_id: L, round: 98, part_idx: 0, heading: "", slide_from: 1, slide_to: 1, wanted: 5, status: "writing", made: 0, rejected: 0, error: null, attempts: 1, created_by: shohamId, created_at: t, updated_at: t, request_id: rq.id, seq: 0, points: [], styles: [] };
    P.batches.push(batch);
    P.qrequests.push({ id: rq.id, group_id: db.group.id, lecture_id: L, round: 98, level: "custom", count: 5, parts: [0], styles: ["mcq"], difficulty: "exam", style_note: "", style_example: "", focus: "", points: [], created_by: shohamId, created_at: t });
    const open = Q.begin({ lectureId: L, request: rq, want: 10, by: shohamId });
    await noa.goto(`${mock.base}/?l=${L}`);
    await noa.locator(".mk-after-sets").waitFor({ timeout: 15000 });
    await noa.locator(".mk-after-open").waitFor({ timeout: 15000 });
    const lec = { sets: norm(await noa.locator(".mk-after-sets").innerText()), href: await noa.locator(".mk-after-sets").getAttribute("href"), open: norm(await noa.locator(".mk-after-open").innerText()) };
    check("lecture page: 'סטים על ההרצאה (2) ‹' to the lecture's shelf, and D6's line 'יש סט בהכנה על ההרצאה · מאת שוהם · k/10' with 'לפתוח את הסט'", lec.sets === "סטים על ההרצאה (2) ‹" && (lec.href ?? "").includes(`v=sets&l=${L}`) && /^יש סט בהכנה על ההרצאה · מאת שוהם · \d+\/10 לפתוח את הסט ‹$/.test(lec.open), JSON.stringify(lec));
    await noa.locator(".mk-after-open").scrollIntoViewIfNeeded();
    await shot(noa, "setsc-06-lecture-row");

    /* ── step 9: the set paused (nothing moved for 7 minutes) ── */
    batch.updated_at = new Date(Date.now() - 7 * 60_000).toISOString();
    await shoham.goto(`${mock.base}/`);
    await shoham.locator(".t-resume").first().waitFor({ timeout: 15000 });
    const resume = { n: await shoham.locator(".t-resume").count(), t: norm(await shoham.locator(".t-resume").first().innerText()), href: await shoham.locator(".t-resume").first().getAttribute("href") };
    check("step 9 Today: the author's own paused set, 'הסט על ״{lecture}״ נעצר באמצע · להמשיך ליצור ‹', to the set", resume.n === 1 && resume.t === `הסט על ״${lectureTitle}״ נעצר באמצע · להמשיך ליצור ‹` && (resume.href ?? "").includes(`k=${open.id}`), JSON.stringify(resume));
    await shot(shoham, "setsc-07-today-resume");
    await noa.goto(`${mock.base}/?v=sets&k=${open.id}`);
    await noa.locator(".mk-paused").waitFor({ timeout: 20000 });
    const paused = norm(await noa.locator(".mk-paused").innerText());
    check("step 9 another member: 'היצירה נעצרה באמצע', 'להמשיך ליצור' and 'העלות נרשמת על מי שממשיך' (OD16)", /היצירה נעצרה באמצע/.test(paused) && /להמשיך ליצור/.test(paused) && /העלות נרשמת על מי שממשיך/.test(paused), paused);
    await shot(noa, "setsc-08-paused");
    batch.status = "ready";
    batch.updated_at = new Date().toISOString();

    /* ── "שלי": the names row (OD7) ── */
    await noa.goto(`${mock.base}/?v=me`);
    await noa.locator(".qs-me-names").waitFor({ timeout: 15000 });
    const before = await noa.locator(".qs-me-names input").isChecked();
    await noa.locator(".qs-me-names input").click();
    await until(async () => Q.prefs.get(noaId)?.show_name === true, 10000, "the choice saved");
    check("'שלי' (OD7): 'להציג את השם שלי ברשימת מי פתרו' with 'רק השם, בלי ציון', off until turned on, saved", before === false && /^להציג את השם שלי ברשימת מי פתרו/.test(norm(await noa.locator(".qs-me-names").innerText())) && /בלי ציון/.test(norm(await noa.locator(".qs-me-names").innerText())), String(before));
    await noa.locator(".qs-me-names").scrollIntoViewIfNeeded();
    await shot(noa, "setsc-09-me");

    /* ── §4: Today → a new set, the lecture prefilled: 2 taps ── */
    const setsBefore = Q.sets.length;
    await noa.goto(`${mock.base}/`);
    await noa.locator(".t-practice .t-make").waitFor({ timeout: 15000 });
    taps = 0;
    await tap(noa.locator(".t-practice .t-make"));
    await until(async () => /ליצור \d+ שאלות · כ-\$/.test(norm(await noa.locator(FOOT_GO).innerText())) && (await noa.locator(FOOT_GO).isEnabled()), 15000, "the price from Today");
    await tap(noa.locator(FOOT_GO));
    await until(async () => /v=sets&k=/.test(search(noa)), 30000, "the new set");
    check("§4 Today → a new set (the lecture prefilled): 2 taps (סט חדש → ליצור)", taps === 2 && Q.sets.length === setsBefore + 1 && Q.sets[Q.sets.length - 1].created_by === noaId, String(taps));
    // Written and kept by its author's device (review UX-1): the set's page with "לפתור".
    await until(async () => (await noa.locator(".qs-page .ph-foot .qs-go").count()) > 0, 60000, "נועה's set written");

    /* ── step 11: the caps ── */
    const capOf = async (headroom, dailyLeft) => {
      P.inputs = { headroom, dailyLeft };
      await noa.goto(`${mock.base}/?v=practice&l=${L}&x=new`);
      await noa.locator(".mk-block").waitFor({ timeout: 15000 });
      return { text: norm(await noa.locator(".mk-block").innerText()), off: !(await noa.locator(FOOT_GO).isEnabled()) };
    };
    const caps = {
      cap: await capOf({ group80: 0, member40: 5, line: 5 }, 3),
      capMine: await capOf({ group80: 5, member40: 0, line: 5 }, 3),
      line: await capOf({ group80: 5, member40: 5, line: 0 }, 3),
      daily: await capOf({ group80: 5, member40: 5, line: 5 }, 0),
    };
    await shot(noa, "setsc-10-daily");
    P.inputs = null;
    check(
      "step 11 the caps: the 80% line, the 40% share, the sets line, the day's sets, each in its words with the button off",
      caps.cap.text.startsWith("תקציב השאלות של הקבוצה לחודש הזה נגמר") && caps.capMine.text.startsWith("החלק האישי בתקציב החודשי נוצל") && caps.line.text.startsWith("הסטים של החודש הגיעו לתקרה שנקבעה") && caps.daily.text.startsWith("המכסה היומית של סטים חדשים נוצלה") && Object.values(caps).every((c) => c.off),
      JSON.stringify(caps),
    );

    /* ── step 7: a set's link signed out, the personal code, the same set ── */
    db.codes.on = true;
    db.codes.byUser.set(noaId, { hash: CODE.replace(/-/g, ""), created_at: new Date().toISOString(), issued_by: noaId, seen_at: new Date().toISOString(), replaced: false, used_at: null, uses: 0 });
    const { page: fresh } = await mock.open(browser, null, { path: `/?v=sets&k=${setId}` });
    await fresh.locator(".join-set").waitFor({ timeout: 15000 });
    await fresh.getByRole("button", { name: "כבר בקבוצה? כניסה עם הקוד האישי" }).click();
    await fresh.getByRole("textbox", { name: "הקוד האישי" }).fill(CODE);
    await fresh.getByRole("button", { name: "כניסה", exact: true }).click();
    await fresh.locator(".qs-head").waitFor({ timeout: 20000 });
    const landed = { search: search(fresh), title: await text(fresh, ".qs-head h1"), redeems: db.codes.redeems.filter((r) => r.found).length };
    const title = Q.sets.find((s) => s.id === setId).title;
    check("step 7 a fresh browser: the line above Join, the personal code, and the sign-in lands on the same set (no sessionStorage)", landed.search === `?v=sets&k=${setId}` && landed.title === title && landed.redeems === 1, JSON.stringify(landed));
    db.codes.on = false;

    const problems = mock.problems;
    const failed = Object.entries(steps).filter(([, v]) => typeof v === "string" && v.startsWith("FAIL"));
    console.log(JSON.stringify({ flags: flagSet, errors: problems, steps, a11y }, null, 1));
    if (problems.length || a11y.length || failed.length) process.exitCode = 1;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, steps, a11y, calls: mock.calls.slice(-20), q: Q.calls.slice(-10).map((c) => c.fn) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
