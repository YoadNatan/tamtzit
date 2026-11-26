// Practice sets, slice B (docs/study/sets.md; WP11-WP13, the design's §14
// steps 5-8 and the set sessions), against the mock (mocks/practice.cjs for
// the requests, batches, drafts and answers; mocks/sets.cjs for section L 1),
// with two members, שוהם and נועה:
//  - שוהם: "ליצור" makes a set (create with `set`) and opens its page,
//    ?v=sets&k=…, as "סט בהכנה"; "להתחיל לפתור" keeps the checked questions
//    and solves the set (s=k.…) in its order, each answer through
//    study_qset_answer with the attempt; the round's end: "רק אצלי", the
//    group's numbers ("פותרים: 1", the floor's line, no average), the opt-in
//    to show the name (asked once), "לחזור על הטעויות" as the free primary,
//    "שאלות חדשות על הטעויות" and "לשלוח קישור";
//  - נועה: the shelf "סטים של הקבוצה" with the set under "חדשים" ("חדש",
//    "מאת שוהם"), its page ("פותרים: 1 · שלי: עוד לא"), "חדש" cleared once
//    opened, "להסתיר אצלי" folding it under "הוסתרו (1)" and "להחזיר", no
//    delete for a member who neither made it nor made the group;
//  - group numbers (OD5): with 3 more finishers the average and the bands
//    appear for נועה, never a best score; names only of who chose;
//  - a set's link opened signed out: the line above Join;
//  - D6/OD20: נועה's "ליצור" while שוהם's set is open answers with the open
//    set, "לפתוח את הסט" opens it with "מאת שוהם", "ליצור סט נוסף בכל זאת"
//    makes a second one;
//  - the author's menu: rename and delete (the set leaves the shelf).
// Synthetic Hebrew content only; screenshots stay out of the repo.
//
//   <every s2 flag> VITE_STUDY_INSTALL=1 VITE_STUDY_NOTIFY=1 VITE_STUDY_MAKE=1 VITE_STUDY_SETS=1 \
//   VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
//     npx vite build --outDir <dist>
//   NODE_PATH=$(npm root -g) node e2e/study/sets-b.cjs <dist> <out dir> [ps]

const fs = require("fs");
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const plugin = require("./mocks/practice.cjs");
const setsPlugin = require("./mocks/sets.cjs");
const todayPlugin = require("./mocks/today.cjs");

const [dist, out, flagSet = process.env.E2E_FLAGS || "ps"] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/sets-b.cjs <dist> <out dir> [ps]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const norm = (s) => String(s).replace(/[‎‏⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
const FOOT_GO = ".make-screen > .ph-foot .mk-go";
const START = ".ph-foot .mk-start-btn";

(async () => {
  const mock = await createMock({ dist, plugins: [plugin, setsPlugin, todayPlugin], flags: flagSet });
  const { db, LECTURE_ID: L } = mock;
  const P = db.practice;
  const Q = db.qsetsMock;
  P.notify = mock.notify;
  Q.notify = mock.notify;
  mock.seedLecture();
  P.p2pace = 200;

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
  const calls = (fn) => Q.calls.filter((c) => c.fn === fn);

  try {
    const { page: shoham } = await mock.open(browser, "שוהם", { path: `/?v=practice&l=${L}&x=new` });
    const shohamId = db.members.find((m) => m.name === "שוהם").user_id;

    /* ── WP12: "ליצור" makes a set and opens its page as "סט בהכנה" ── */
    await until(async () => /ליצור 10 שאלות · כ-\$/.test(norm(await shoham.locator(FOOT_GO).innerText())), 15000, "the price on the button");
    const shared = await shoham.locator(".mk-preview", { hasText: "הסט ישותף עם הקבוצה" }).count();
    check("create: the preview says the set is shared with the group (OD3)", shared === 1, String(shared));
    // Written at a pace a person sees (the first ready question before the last).
    P.p2pace = 1200;
    await shoham.locator(FOOT_GO).click();
    await until(async () => /v=sets&k=/.test(search(shoham)), 30000, "the set's page");
    const setId = new URL(shoham.url()).searchParams.get("k");
    const made = P.p2calls.filter((c) => c.action === "create").pop();
    check("create: with VITE_STUDY_SETS 'create' carries the set ({want}) and opens ?v=sets&k=", made?.body?.set?.want === 10 && Q.sets.length === 1 && Q.sets[0].id === setId, JSON.stringify(made?.body));
    await shoham.locator(".mk-ring").waitFor({ timeout: 15000 });
    const genHead = await text(shoham, ".ph-head h1");
    // The button as soon as one question is ready (read at once: the author's keep may follow quickly).
    let startWords = "";
    await until(async () => {
      startWords = (await shoham.locator(START).count()) ? norm(await shoham.locator(START).first().innerText({ timeout: 1000 }).catch(() => "")) : "";
      return Boolean(startWords);
    }, 60000, "the first question ready");
    if (await shoham.locator(START).count()) await shot(shoham, "setsb-01-generating", { primary: START });
    check("set page while made: 'סט בהכנה' with the ring and 'להתחיל לפתור (k)' from the first ready question", genHead.startsWith("סט בהכנה") && /להתחיל לפתור \(\d+\)/.test(startWords), `${genHead} · ${startWords}`);

    P.p2pace = 250;
    /* ── review UX-1: when writing ends, the author's device keeps the checked questions itself (auto-keep ships off, OD15) ── */
    await until(async () => (await shoham.locator(".qs-page .qs-go").count()) > 0, 90000, "the set page after the author's own keep");
    const keptAuto = Q.items.filter((i) => i.set_id === setId).length;
    const pageHead = norm(await shoham.locator(".qs-head h1").innerText());
    check(
      "writing ended on the author's device: the checked questions joined the set with no tap, and the set page took over with 'לפתור' (one h1: the set's title)",
      keptAuto >= 5 && (await shoham.locator("h1").count()) === 1 && /שאלות$/.test(pageHead) && norm(await shoham.locator(".qs-go").innerText()) === "לפתור",
      JSON.stringify({ keptAuto, pageHead }),
    );
    await shot(shoham, "setsb-01b-ready-author", { primary: ".qs-go" });

    /* ── WP13: "לפתור" solves the set (s=k.) with an attempt ── */
    await shoham.locator(".qs-go").click();
    await until(async () => search(shoham).includes(`s=k.${setId}`), 15000, "the set's session");
    await shoham.locator(".pq-lead").first().waitFor({ timeout: 15000 });
    const items = Q.items.filter((i) => i.set_id === setId).length;
    const att = calls("study_qset_attempt_start").length;
    check("session: the kept questions joined the set (L's trigger) and an attempt began", items >= 5 && att === 1, JSON.stringify({ items, att }));
    // The first question answered with a pick and a bet; the rest "לא יודעים".
    const first = shoham.locator(".pq-options button.a-opt").first();
    let answered = 0;
    if (await first.count()) {
      await first.click();
      await shoham.locator(".pq-bets").getByRole("radio", { name: "נראה לי", exact: true }).click();
      await shoham.locator(".practice-session > .ph-foot .a-btn.primary").click();
      await shoham.locator(".pq-next").waitFor({ timeout: 15000 });
      await shoham.locator(".pq-next").click();
      answered += 1;
    }
    for (let i = 0; i < 40 && !(await shoham.locator(".pq-end").count()); i++) {
      const dk = shoham.locator(".pq-dont-know");
      if (await dk.count()) {
        await dk.first().click();
        await shoham.locator(".pq-next").waitFor({ timeout: 15000 });
        answered += 1;
      }
      await shoham.locator(".pq-next").click();
      await until(async () => (await shoham.locator(".pq-end").count()) > 0 || (await shoham.locator(".pq-dont-know").count()) > 0, 10000, "the next question");
    }
    await shoham.locator(".pq-end").waitFor({ timeout: 15000 });
    const stamped = P.answers.filter((a) => a.user_id === shohamId && a.set_attempt).length;
    const viaWrapper = mock.calls.filter((c) => /study_qset_answer/.test(c)).length;
    check("session: every answer of the round went through study_qset_answer with the attempt", stamped === answered && answered === items && viaWrapper >= answered, JSON.stringify({ stamped, answered, items, viaWrapper }));
    await until(async () => (await shoham.locator(".qs-stats").count()) > 0, 15000, "the group's numbers at the end");
    const end = {
      only: await shoham.locator(".pq-score .a-chip").innerText(),
      stats: norm(await shoham.locator(".qs-stats").innerText()),
      optin: await shoham.locator(".qs-optin").count(),
      primary: norm(await shoham.locator(".practice-session > .ph-foot .a-btn.primary").innerText()),
      links: norm(await shoham.locator(".pq-set-links").innerText()),
      finished: calls("study_qset_attempt_finish").length,
    };
    check(
      "round end (§5.10): 'רק אצלי', 'פותרים: 1' with the floor's line and no average, the opt-in once, 'לחזור על הטעויות' as primary, new questions on the mistakes and the link",
      end.only === "רק אצלי" && /פותרים: 1/.test(end.stats) && /מ-3 פותרים נוספים/.test(end.stats) && !/ממוצע הקבוצה/.test(end.stats) && end.optin === 1 && end.primary === "לחזור על הטעויות" && /שאלות חדשות על הטעויות/.test(end.links) && /לשלוח קישור/.test(end.links) && end.finished === 1,
      JSON.stringify(end),
    );
    await shot(shoham, "setsb-02-round-end");
    await shoham.locator(".qs-optin").getByRole("button", { name: "להציג" }).click();
    await until(async () => /מי פתרו: שוהם/.test(norm(await shoham.locator(".qs-stats").innerText())), 10000, "the name shown");
    check("OD7: the opt-in shows the name among who solved, without a score", Q.prefs.get(shohamId)?.show_name === true, "");

    /* ── WP12: נועה's shelf, the set's page, "חדש" cleared, hide and bring back ── */
    const { page: noa } = await mock.open(browser, "נועה", { path: "/?v=sets" });
    await noa.locator(".qs-card").first().waitFor({ timeout: 15000 });
    const shelf1 = {
      head: norm(await noa.locator(".qs-group .a-sec h2").first().innerText()),
      badge: await noa.locator(".qs-card .qs-new").count(),
      meta: norm(await noa.locator(".qs-card-meta").first().innerText()),
      nums: norm(await noa.locator(".qs-card-nums").first().innerText()),
    };
    check("shelf: the set under 'חדשים' with 'חדש', 'מאת שוהם', 'פותרים: 1 · שלי: עוד לא'", shelf1.head === "חדשים" && shelf1.badge === 1 && /מאת שוהם/.test(shelf1.meta) && shelf1.nums === "פותרים: 1 · שלי: עוד לא", JSON.stringify(shelf1));
    await shot(noa, "setsb-03-shelf");
    await noa.locator(".qs-card-link").first().click();
    await until(async () => search(noa).includes(`k=${setId}`), 10000, "the set's page");
    await noa.locator(".qs-head").waitFor({ timeout: 15000 });
    const page1 = { by: norm(await noa.locator(".qs-by").innerText()), stats: norm(await noa.locator(".qs-stats").innerText()), del: 0 };
    await noa.locator(".qs-menu").click();
    await noa.locator(".qs-menu-sheet").waitFor({ timeout: 5000 });
    page1.menu = norm(await noa.locator(".qs-menu-sheet .a-list").innerText());
    page1.del = await noa.locator(".qs-menu-sheet .qs-delete").count();
    check("set page: 'מאת שוהם', 'פותרים: 1', 'שלי: עוד לא', the floor's line; the menu has hide and no delete for נועה", /מאת שוהם/.test(page1.by) && /פותרים: 1/.test(page1.stats) && /שלי: עוד לא/.test(page1.stats) && /מ-3 פותרים נוספים/.test(page1.stats) && /להסתיר אצלי/.test(page1.menu) && page1.del === 0 && !/לשנות שם/.test(page1.menu), JSON.stringify(page1));
    await shot(noa, "setsb-04-menu");
    await noa.locator(".qs-menu-sheet").getByRole("button", { name: "להסתיר אצלי" }).click();
    await until(async () => /v=sets$/.test(search(noa)) || search(noa) === "?v=sets", 10000, "back on the shelf");
    await noa.locator(".qs-hidden > summary").waitFor({ timeout: 10000 });
    const hidden = { summary: norm(await noa.locator(".qs-hidden > summary").innerText()), fresh: await noa.locator(".qs-group").count(), seen: Q.marks.find((m) => m.set_id === setId && m.user_id !== shohamId)?.seen_at ? 1 : 0 };
    check("hide for oneself: the set folds under 'הוסתרו (1)'; opening it cleared 'חדש'", hidden.summary === "הוסתרו (1)" && hidden.fresh === 0 && hidden.seen === 1, JSON.stringify(hidden));
    await noa.locator(".qs-hidden > summary").click();
    await noa.locator(".qs-hidden").getByRole("button", { name: "להחזיר" }).click();
    await until(async () => (await noa.locator(".qs-hidden").count()) === 0 && (await noa.locator(".qs-card").count()) === 1, 10000, "the set back");
    check("'להחזיר' brings it back, no longer new", (await noa.locator(".qs-card .qs-new").count()) === 0, "");

    /* ── OD5: the group's numbers from 3 other finishers ── */
    const others = ["עומר", "דנה", "יעל"].map((name, i) => {
      const id = `0f0f0f0f-0000-4000-8000-00000000000${i + 1}`;
      db.members.push({ group_id: db.group.id, user_id: id, name });
      return id;
    });
    const total = Q.items.filter((i) => i.set_id === setId).length;
    Q.finisher(others[0], setId, total, total);
    Q.finisher(others[1], setId, total, total);
    Q.finisher(others[2], setId, 0, total);
    await noa.goto(`${mock.base}/?v=sets&k=${setId}`);
    await noa.locator(".qs-stats").waitFor({ timeout: 15000 });
    await until(async () => /ממוצע הקבוצה/.test(norm(await noa.locator(".qs-stats").innerText())), 10000, "the average");
    await noa.locator(".qs-perq > summary").click();
    const nums = { stats: norm(await noa.locator(".qs-stats").innerText()), bands: await noa.locator(".qs-band").count() };
    check("OD5: with 4 other finishers the average and the per-question bands appear; never a best score; names only of who chose", /פותרים: 4/.test(nums.stats) && /ממוצע הקבוצה \d+(\.\d)?\/\d+/.test(nums.stats) && nums.bands === total && /שאלה 1 (רוב צדקו|חלק צדקו|רוב טעו)/.test(nums.stats) && !/הגבוה/.test(nums.stats) && /מי פתרו: שוהם$|מי פתרו: שוהם /.test(nums.stats) && !/עומר/.test(nums.stats), JSON.stringify(nums));
    await shot(noa, "setsb-05-numbers");

    /* ── a set's link opened signed out: the line above Join ── */
    const anon = await browser.newContext({ locale: "he-IL" });
    const out1 = await anon.newPage();
    await out1.goto(`${mock.base}/?v=sets&k=${setId}`);
    await out1.locator(".join-set").waitFor({ timeout: 15000 });
    const line = norm(await out1.locator(".join-set").innerText());
    check("signed out on ?v=sets&k=: 'הסט נמצא בקבוצה…' above Join, the address kept", line.startsWith("הסט נמצא בקבוצה. מי שכבר בקבוצה: כניסה עם הקוד האישי") && search(out1).includes(`k=${setId}`), line);
    await anon.close();

    /* ── D6/OD20: an open set on the lecture ── */
    const t = new Date().toISOString();
    const rq = { id: "ae0000ff-0000-4000-8000-0000000000ff", lecture_id: L };
    P.batches.push({ id: "ba0000ff-0000-4000-8000-0000000000ff", lecture_id: L, round: 99, part_idx: 0, heading: "", slide_from: 1, slide_to: 1, wanted: 5, status: "writing", made: 0, rejected: 0, error: null, attempts: 1, created_by: shohamId, created_at: t, updated_at: t, request_id: rq.id, seq: 0, points: [], styles: [] });
    const open = Q.begin({ lectureId: L, request: rq, want: 10, by: shohamId });
    await noa.goto(`${mock.base}/?v=practice&l=${L}&x=new`);
    await until(async () => /ליצור \d+ שאלות · כ-\$/.test(norm(await noa.locator(FOOT_GO).innerText())), 15000, "noa's create screen");
    const before = Q.sets.length;
    await noa.locator(FOOT_GO).click();
    await noa.locator(".mk-open").waitFor({ timeout: 15000 });
    const callout = norm(await noa.locator(".mk-open").innerText());
    check("D6: 'ליצור' during שוהם's set shows it: 'יש סט בהכנה על ההרצאה · מאת שוהם', open it or make another", /^יש סט בהכנה על ההרצאה · מאת שוהם · \d+\/10/.test(callout) && /לפתוח את הסט/.test(callout) && /ליצור סט נוסף בכל זאת/.test(callout) && Q.sets.length === before, callout);
    await shot(noa, "setsb-06-open-set");
    await noa.locator(".mk-open").getByRole("link", { name: "לפתוח את הסט" }).click();
    await until(async () => search(noa).includes(`k=${open.id}`), 10000, "the open set");
    await noa.locator(".mk-by").waitFor({ timeout: 15000 });
    check("'לפתוח את הסט' opens it as 'סט בהכנה' with 'מאת שוהם'", /מאת שוהם/.test(norm(await noa.locator(".mk-by").innerText())), "");
    P.batches.find((b) => b.request_id === rq.id).status = "ready";

    /* ── the author's menu: rename, then delete (the set leaves the shelf) ── */
    await shoham.goto(`${mock.base}/?v=sets&k=${setId}`);
    await shoham.locator(".qs-menu").click();
    await shoham.locator(".qs-menu-sheet").getByRole("button", { name: "לשנות שם" }).click();
    await shoham.locator(".a-sheet input.a-input").fill("סט לחזרה לפני המבחן");
    await shoham.locator(".a-sheet").getByRole("button", { name: "לשמור" }).click();
    await until(async () => (await text(shoham, ".qs-head h1")) === "סט לחזרה לפני המבחן", 10000, "the new title");
    await shoham.locator(".qs-menu").click();
    await shoham.locator(".qs-menu-sheet").getByRole("button", { name: "למחוק את הסט" }).click();
    const confirm = norm(await shoham.locator(".a-sheet").last().innerText());
    await shoham.locator(".a-sheet").last().getByRole("button", { name: "למחוק את הסט" }).click();
    await until(async () => search(shoham) === "?v=sets", 10000, "the shelf");
    await shoham.waitForTimeout(500);
    const gone = await shoham.locator(`.qs-card-link[href*="${setId}"]`).count();
    check("the author renames and deletes; the set leaves the shelf, its questions stay in the bank", /השאלות נשארות בבנק של הקבוצה/.test(confirm) && gone === 0 && Q.sets.find((s) => s.id === setId).deleted_at && P.questions.filter((q) => q.request_id).length >= total, JSON.stringify({ confirm, gone }));
    await shot(shoham, "setsb-07-shelf-after");

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
