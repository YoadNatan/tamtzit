// F-2: the app shell (spec §5.1; design-platform §6.3 D1-D4 and E1-E7).
// Tabs right to left with aria-current; the reader hides the tab bar; Back
// restores / and the scroll, and its words name where it goes; ?at=
// and ?slide= mark a paragraph; Noa's "להקריא לקבוצה" shows Shoham's banner
// line (one line, "+1" when a quiz line is also there), and "לעקוב" opens the
// lecture following; the privacy sheet before the first upload only; help's
// #privacy; Join's "מה נשמר ואיפה" signed out; "נמחקו לאחרונה" and "שחזור";
// "יחד" and "שלי"; the slide sheet; the schema gate; light and dark, 390 and
// 360 px (a11y.cjs at every step).
//
// F-2 (spec §12.2.7): the same steps under both tab sets. Without TODAY the
// spec's four tabs (ספרייה · תרגול · יחד · שלי, תרגול with practice or cards)
// and "/" is the library, with no notice; with TODAY (release 8 on)
// היום · ספרייה · יחד · שלי with no תרגול, "/" opens Today, with no
// live line, and ?v=library is the library.
//
// And what the F1 reviews found, so it stays fixed: a sheet closed by Back
// leaves the screen where it is; "לפסקה בסיכום" marks in place, every time,
// and leaves one entry for the reader; a route that is off never mounts; the
// privacy sheet closes by ✕, the backdrop, Escape and Back, keeps focus and
// covers the tab bar; the note over the upload form keeps the form; Join's
// code survives help; the back arrows' words; the members' confirm.
//
//   NODE_PATH=$(npm root -g) node e2e/study/shell.cjs <dist> <out dir> [off|rel1|all|notoday]
// The third argument (or E2E_FLAGS) says which flags the build was made with:
// none, release 1's three (QUESTIONS, PRACTICE, CARDS: docs/study/RELEASE-1.md),
// every VITE_STUDY_* flag (Today's tabs), or every flag but TODAY.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { makePptx } = require("./fixtures/make-pptx.cjs");

const [dist, out, flagArg] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/shell.cjs <dist> <out dir> [off|rel1|all|notoday]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const flags = flagSetOf(flagArg);
const all = flags.any; // a package's flags are on: the "תרגול" tab (questions or cards)
const today = flags.today; // Today's tab set
/** The library: "/" until Today, then ?v=library (§12.2.1). */
const LIB = today ? "/?v=library" : "/";
const isLib = (u) => u.pathname === "/" && u.search === (today ? "?v=library" : "");
const DAY = 86_400_000;

/** Whether a tag's slides ("6", "6-7", "6,8") include slide n (rich.tsx's slidesOf). */
const COVERS = (spec, n) =>
  String(spec)
    .split(",")
    .some((p) => {
      const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(p);
      return Boolean(m) && Number(m[1]) <= n && n <= Number(m[2] ?? m[1]);
    });

(async () => {
  const mock = await createMock({ dist, flags: flags.set });
  const { db, LECTURE_ID: L } = mock;
  mock.seedLecture();
  const noa = mock.people["נועה"].user.id;
  const shohamId = mock.people["שוהם"].user.id;
  // More lectures, so the library scrolls; one deleted two days ago by Noa.
  for (let i = 2; i <= 9; i++) {
    const t = new Date(Date.now() - i * 3600_000).toISOString();
    db.lectures.push({ ...db.lectures[0], id: `eeeeeeee-0000-4000-8000-00000000001${i}`, title: `הרצאה לדוגמה ${i}`, created_at: t, updated_at: t, slides: [] });
  }
  // A second written lecture (the same parts), to leave and come back to.
  const B = "eeeeeeee-0000-4000-8000-000000000012";
  for (const s of db.sections.filter((x) => x.lecture_id === L)) db.sections.push({ ...s, lecture_id: B });
  const deletedAt = new Date(Date.now() - 2 * DAY).toISOString();
  db.lectures.push({ ...db.lectures[0], id: "eeeeeeee-0000-4000-8000-000000000099", title: "הרצאה שנמחקה", deleted_at: deletedAt, deleted_by: noa, slides: [] });
  // An open question in the group, for "יחד".
  db.comments.push({ id: "c0000001-0000-4000-8000-000000000001", lecture_id: L, part_idx: 1, anchor: 3, quote: "שימושים: glaucoma", kind: "question", body: "מה עדיף במחלת גבהים?", parent_id: null, resolved: false, author_id: noa, created_at: new Date().toISOString() });
  const deck = path.join(out, "deck.pptx");
  await makePptx(deck);

  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  /** Whether a tap at the centre of an element lands on it. */
  const hitsItself = (loc) =>
    loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(h && (h === el || el.contains(h)));
    });
  const path0 = (page) => {
    const u = new URL(page.url());
    return u.pathname + u.search;
  };
  try {
    const { page: shoham } = await mock.open(browser, "שוהם", { path: "/" });
    if (today) {
      // F-2: with Today's set "/" opens Today, under its own tab and without the live line.
      await shoham.locator("main.today .ph-head .t", { hasText: "היום" }).waitFor({ timeout: 15000 });
      const home = { url: path0(shoham), current: (await shoham.locator('.ph-tabs .ph-tab[aria-current="page"]').innerText()).trim(), banner: await shoham.locator(".live-banner").count() };
      a11y.push(...(await snap(shoham, out, "shell-0-today")));
      await shoham.locator(".ph-tabs .ph-tab", { hasText: "ספרייה" }).click();
      await shoham.waitForURL(isLib, { timeout: 5000 });
      check("F-2 / opens Today; ספרייה is ?v=library", home.url === "/" && home.current === "היום" && home.banner === 0, JSON.stringify(home));
    }
    await shoham.getByRole("heading", { name: mock.GROUP.name }).waitFor({ timeout: 15000 });
    await shoham.locator(".lecture-card").first().waitFor({ timeout: 10000 });
    if (!today) check("F-2 / is the library until Today, with no notice", path0(shoham) === "/" && (await shoham.locator(".a-toast").count()) === 0, path0(shoham));

    // E1: the tabs, right to left, with aria-current
    const tabs = await shoham.locator(".ph-tabs .ph-tab").evaluateAll((els) => els.map((e) => ({ text: e.innerText.trim(), x: Math.round(e.getBoundingClientRect().x), current: e.getAttribute("aria-current") })));
    const labels = tabs.map((t) => t.text);
    const expected = today ? ["היום", "ספרייה", "יחד", "שלי"] : all ? ["ספרייה", "תרגול", "יחד", "שלי"] : ["ספרייה", "יחד", "שלי"];
    const libTab = labels.indexOf("ספרייה");
    check(
      "E1 tabs",
      JSON.stringify(labels) === JSON.stringify(expected) && tabs.every((t, i) => i === 0 || t.x < tabs[i - 1].x) && tabs[libTab].current === "page" && tabs.every((t, i) => i === libTab || !t.current),
      JSON.stringify(tabs),
    );
    if (flags.ask) {
      // The ask bar: §6.4's words, a Hebrew field while empty, typed text sets its own direction.
      const bar = shoham.locator(".ask-bar input");
      const empty = await bar.evaluate((el) => ({ placeholder: el.placeholder, label: el.getAttribute("aria-label"), direction: getComputedStyle(el).direction }));
      await bar.fill("Furosemide");
      const latin = await bar.evaluate((el) => getComputedStyle(el).direction);
      await bar.fill("משתנים");
      const hebrew = await bar.evaluate((el) => getComputedStyle(el).direction);
      await bar.fill("");
      check(
        "ask bar",
        empty.placeholder === "לשאול או לחפש בהרצאות…" && empty.label === "לשאול או לחפש בהרצאות" && empty.direction === "rtl" && latin === "ltr" && hebrew === "rtl",
        JSON.stringify({ empty, latin, hebrew }),
      );
    }
    a11y.push(...(await snap(shoham, out, "shell-1-library")));

    // "נמחקו לאחרונה" and "שחזור"
    const deletedRow = shoham.locator(".deleted li", { hasText: "הרצאה שנמחקה" });
    await deletedRow.waitFor({ timeout: 10000 });
    steps.deletedRow = (await deletedRow.innerText()).replace(/\n/g, " ");
    await deletedRow.getByRole("button", { name: "שחזור" }).click();
    await shoham.locator(".lecture-card", { hasText: "הרצאה שנמחקה" }).waitFor({ timeout: 10000 });
    check("restore", mock.calls.some((c) => c.includes("rpc/study_delete_lecture")) && db.lectures.find((l) => l.title === "הרצאה שנמחקה").deleted_at === null);

    // D1: the privacy sheet before the first upload, and not again
    const dialog = shoham.getByRole("dialog", { name: "לאן החומר הולך" });
    const openSheet = async () => {
      await shoham.getByRole("button", { name: "העלאת הרצאה" }).first().click();
      await dialog.waitFor({ timeout: 5000 });
    };
    const consent = () => shoham.evaluate(() => localStorage.getItem("study-privacy-v1"));
    await openSheet();
    a11y.push(...(await snap(shoham, out, "shell-2-privacy-sheet")));
    // Its last button, scrolled to, is not under the tab bar (390 and 360).
    const lastHits = [];
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
      await shoham.setViewportSize(vp);
      await dialog.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await shoham.waitForTimeout(100);
      lastHits.push(await hitsItself(dialog.getByRole("button", { name: "עוד בעזרה" })));
    }
    await shoham.setViewportSize({ width: 390, height: 844 });
    // Focus stays in the sheet: Tab from its last control goes round to its first.
    await dialog.getByRole("button", { name: "עוד בעזרה" }).focus();
    await shoham.keyboard.press("Tab");
    const afterLast = await shoham.evaluate(() => ({ inSheet: Boolean(document.activeElement?.closest('[aria-modal="true"]')), label: document.activeElement?.getAttribute("aria-label") }));
    await shoham.keyboard.press("Shift+Tab");
    const backToLast = await shoham.evaluate(() => document.activeElement?.textContent);
    check("D1 the privacy sheet covers the tab bar and keeps focus", lastHits.every(Boolean) && afterLast.inSheet && afterLast.label === "סגירה" && backToLast === "עוד בעזרה", JSON.stringify({ lastHits, afterLast, backToLast }));
    // ✕, the backdrop, Escape and Back close it, with nothing recorded and the library still there.
    const closes = {};
    await dialog.getByRole("button", { name: "סגירה" }).click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    closes.x = path0(shoham);
    await openSheet();
    await shoham.mouse.click(8, 8);
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    closes.backdrop = path0(shoham);
    await openSheet();
    await shoham.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    closes.escape = path0(shoham);
    await openSheet();
    await shoham.goBack();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await shoham.waitForTimeout(300);
    closes.back = path0(shoham);
    closes.consent = await consent();
    closes.library = await shoham.locator(".lecture-card").count();
    check("D1 the privacy sheet closes without consent", ["x", "backdrop", "escape", "back"].every((k) => closes[k] === LIB) && closes.consent === null && closes.library > 0, JSON.stringify(closes));
    // "עוד בעזרה": help, whose back arrow returns to the library in one tap (the sheet's entry went first).
    await openSheet();
    await shoham.getByRole("button", { name: "עוד בעזרה" }).click();
    await shoham.locator(".help h1").waitFor({ timeout: 10000 });
    const toHelp = { url: path0(shoham), back: await shoham.locator(".ph-head .back").innerText() };
    await shoham.locator(".ph-head .back").click();
    await shoham.waitForURL(isLib, { timeout: 5000 });
    await shoham.locator(".lecture-card").first().waitFor({ timeout: 10000 });
    check("D1 עוד בעזרה and back", toHelp.url === "/?v=help" && toHelp.back === "→ לספרייה" && (await dialog.count()) === 0 && (await consent()) === null, JSON.stringify(toHelp));
    // "הבנתי, ממשיכים": upload, whose back arrow names the library.
    await openSheet();
    await shoham.getByRole("button", { name: "הבנתי, ממשיכים" }).click();
    await shoham.waitForURL(/\?v=upload/);
    const uploadBack = await shoham.locator(".ph-head .back").innerText();
    a11y.push(...(await snap(shoham, out, "shell-3-upload")));
    // "מי רואה את הקבצים?" shows the note over the form: the deck read and the fields typed stay.
    await shoham.locator('input[type="file"]').setInputFiles(deck);
    await shoham.getByText(/20 שקפים/).waitFor({ timeout: 30000 });
    await shoham.locator("label:has-text('מרצה') input").fill("ד״ר בדיקה");
    await shoham.getByRole("link", { name: "מי רואה את הקבצים?" }).click();
    await dialog.waitFor({ timeout: 5000 });
    const noteUrl = path0(shoham);
    a11y.push(...(await snap(shoham, out, "shell-3b-upload-note")));
    await shoham.goBack();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await shoham.getByRole("link", { name: "מי רואה את הקבצים?" }).click();
    await dialog.getByRole("button", { name: "סגירה", exact: true }).last().click();
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    const form = { url: path0(shoham), drop: (await shoham.locator(".drop").innerText()).replace(/\n/g, " "), lecturer: await shoham.locator("label:has-text('מרצה') input").inputValue() };
    check("D1 the note over the upload form keeps it", noteUrl === "/?v=upload" && form.url === "/?v=upload" && /deck\.pptx/.test(form.drop) && form.lecturer === "ד״ר בדיקה", JSON.stringify({ noteUrl, form }));
    // One tap back to the library (the sheets left no entries behind), and no sheet before the next upload.
    await shoham.locator(".ph-head .back").click();
    await shoham.waitForURL(isLib);
    await shoham.getByRole("button", { name: "העלאת הרצאה" }).first().click();
    await shoham.waitForURL(/\?v=upload/);
    check("D1 privacy sheet once", (await dialog.count()) === 0 && uploadBack === "→ לספרייה" && (await consent()) === "1", uploadBack);
    await shoham.locator(".ph-head .back").click();
    await shoham.waitForURL(isLib);

    // E2, E3: the reader hides the tab bar; Back restores the library and the scroll, its words name where it goes
    await shoham.locator(".lecture-card").last().waitFor();
    await shoham.locator(".lc-together .a-chip.warn").first().waitFor({ timeout: 10000 }); // the library's extras are in
    await shoham.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
    await shoham.waitForTimeout(200);
    // Tap the card in the middle of the screen as a finger would (a locator click would scroll
    // first), and note what was on screen at that moment: the first card that starts on it.
    const seen = () => {
      const card = [...document.querySelectorAll(".lc")].find((e) => e.getBoundingClientRect().top >= 0);
      return { y: Math.round(window.scrollY), card: card?.dataset.anchor, top: Math.round(card?.getBoundingClientRect().top ?? -1) };
    };
    const before = await shoham.evaluate((seenSrc) => {
      const at = new Function(`return (${seenSrc})()`)();
      document.elementFromPoint(innerWidth / 2, innerHeight / 2).closest(".lecture-card").click();
      return at;
    }, seen.toString());
    await shoham.locator(".lecture-title h1").waitFor({ timeout: 10000 });
    const backWords = await shoham.locator(".ph-head .back").innerText();
    check("E2 reader hides the tabs", (await shoham.locator(".ph-tabs").count()) === 0 && backWords === "→ לספרייה", backWords);
    a11y.push(...(await snap(shoham, out, "shell-4-reader")));
    await shoham.locator(".ph-head .back").click();
    await shoham.waitForURL(isLib);
    // The same card at the same height (what was on screen is on screen again).
    await shoham.waitForTimeout(2200);
    const after = await shoham.evaluate((b) => {
      const card = document.querySelector(`[data-anchor="${b.card}"]`);
      return { y: Math.round(window.scrollY), top: Math.round(card?.getBoundingClientRect().top ?? -999) };
    }, before);
    check("E3 Back restores the scroll", before.y > 100 && Boolean(before.card) && Math.abs(after.top - before.top) < 6, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

    // E5: ?l=<id>&at=1.3 marks the paragraph; ?slide= marks the first that cites the slide
    await shoham.goto(`${mock.base}/?l=${L}&at=1.3`);
    await shoham.waitForFunction(() => {
      const el = document.querySelector('[data-part="1"] [data-blk="3"]');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return el.classList.contains("blk-marked") && r.top >= 0 && r.bottom <= innerHeight;
    }, null, { timeout: 10000 });
    steps["E5 at=1.3"] = "ok";
    await shoham.goto(`${mock.base}/?l=${L}&slide=17`);
    const marked = await shoham.waitForFunction(() => {
      const el = document.querySelector(".blk-marked");
      return el ? `${el.closest("[data-part]").dataset.part}.${el.dataset.blk}` : null;
    }, null, { timeout: 10000 }).then((h) => h.jsonValue());
    check("slide=17", marked === "6.1", marked);

    // The slide sheet over the reader (opened from the library): Back closes it; "לפסקה בסיכום"
    // marks the citing paragraph in place, twice in a row; then one tap of the back arrow is the library.
    await shoham.goto(`${mock.base}${LIB}`);
    await shoham.locator(`[data-anchor="lecture-${L}"] .lecture-card`).click();
    await shoham.locator('[data-part="7"]').waitFor({ timeout: 15000 });
    await shoham.locator('[data-part="6"] .src-link').first().click();
    await shoham.locator(".slide-sheet").waitFor({ timeout: 5000 });
    const sheetTitle = await shoham.locator(".slide-sheet h2").innerText();
    a11y.push(...(await snap(shoham, out, "shell-5-slide-sheet")));
    await shoham.goBack();
    await shoham.locator(".slide-sheet").waitFor({ state: "detached", timeout: 5000 });
    check("slide sheet", /^שקף 17/.test(sheetTitle) && path0(shoham) === `/?l=${L}`, `${sheetTitle} ${path0(shoham)}`);
    const jump = async (part) => {
      const tag = shoham.locator(`[data-part="${part}"] .src-link`).first();
      const n = Number(String(await tag.getAttribute("data-slides")).split(/[-,]/)[0]);
      await tag.click();
      await shoham.locator(".slide-sheet").waitFor({ timeout: 5000 });
      await shoham.getByRole("link", { name: "לפסקה בסיכום" }).click();
      await shoham.locator(".slide-sheet").waitFor({ state: "detached", timeout: 5000 });
      const got = await shoham.waitForFunction(
        (n) => {
          const el = document.querySelector(".blk-marked");
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { at: `${el.closest("[data-part]").dataset.part}.${el.dataset.blk}`, slides: [...el.querySelectorAll("[data-slides]")].map((t) => t.dataset.slides), onScreen: r.top >= 0 && r.bottom <= innerHeight, n };
        },
        n,
        { timeout: 5000 },
      ).then((h) => h.jsonValue());
      return { ...got, cites: got.slides.some((s) => COVERS(s, n)), url: path0(shoham) };
    };
    const first = await jump(6);
    const second = await jump(2); // within the first mark's 2 s
    await shoham.waitForTimeout(2300);
    const marksLeft = await shoham.locator(".blk-marked").count();
    const historyBefore = await shoham.evaluate(() => history.length);
    await shoham.locator(".ph-head .back").click();
    await shoham.waitForURL(isLib, { timeout: 5000 });
    await shoham.locator(".lecture-card").first().waitFor({ timeout: 10000 });
    check(
      "slide sheet: לפסקה בסיכום in place, twice, one Back",
      [first, second].every((j) => j.onScreen && j.cites && j.url === `/?l=${L}`) && first.at === "6.1" && second.at.startsWith("2.") && marksLeft === 0,
      JSON.stringify({ first, second, marksLeft, historyBefore }),
    );

    // E4: a practice link opens on "תרגול" (on "היום" with Today's tabs), or says that it is not open yet
    await shoham.goto(`${mock.base}/?v=practice&l=${L}`);
    if (flags.questions) {
      // The lecture's practice (package Q's P2, or its seed's placeholder before Q), on the "תרגול" tab ("היום" with Today's tabs).
      await shoham.locator('.ph-tabs .ph-tab[aria-current="page"]', { hasText: today ? "היום" : "תרגול" }).waitFor({ timeout: 10000 });
      const current = await shoham.locator('.ph-tabs .ph-tab[aria-current="page"]').innerText();
      check("E4 practice tab", current.trim() === (today ? "היום" : "תרגול"), current);
    } else {
      await shoham.locator(".a-toast", { hasText: "התכונה הזו עוד לא פתוחה." }).waitFor({ timeout: 10000 });
      check("E4 practice is off: the lecture, with a notice", new URL(shoham.url()).search === `?l=${L}`, shoham.url());
      // A route that is off is replaced while rendering: its screen never mounts, not even
      // for a frame, on in-app moves to it either. Twice: once its module has loaded, a screen
      // rendered before the replacement would mount at once.
      await shoham.evaluate(() => {
        window.__soon = 0;
        new MutationObserver((ms) => {
          // The seed's placeholder, or package Q's own screen once it is built.
          const screen = ".soon, .practice-lecture";
          for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches(screen) || n.querySelector(screen))) window.__soon += 1;
        }).observe(document.body, { childList: true, subtree: true });
      });
      for (let i = 0; i < 2; i++) {
        await shoham.locator(".a-toast").waitFor({ state: "detached", timeout: 8000 });
        await shoham.evaluate((l) => {
          history.pushState({ study: true, from: "lecture" }, "", `/?v=practice&l=${l}`);
          dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
        }, L);
        await shoham.locator(".a-toast", { hasText: "התכונה הזו עוד לא פתוחה." }).waitFor({ timeout: 5000 });
      }
      const mounts = await shoham.evaluate(() => window.__soon);
      check("E4 a route that is off never mounts", mounts === 0 && new URL(shoham.url()).search === `?l=${L}`, `${mounts} ${shoham.url()}`);
    }

    // E6: Noa reads aloud; Shoham's banner shows one line, "+1" with a quiz line too; "לעקוב" follows
    await shoham.goto(`${mock.base}${LIB}`);
    await shoham.locator(".lecture-card").first().waitFor({ timeout: 10000 });
    const { page: noaPage } = await mock.open(browser, "נועה", { path: `/?l=${L}` });
    await noaPage.locator(".summary").first().waitFor({ timeout: 15000 });
    await noaPage.getByRole("button", { name: "להקריא לקבוצה" }).click();
    const line = shoham.locator(".live-banner .live-slot.is-shown");
    await line.getByText(/הקראה עכשיו: נועה/).waitFor({ timeout: 40000 });
    steps.bannerLine = (await line.innerText()).replace(/\n/g, " | ");
    const followLook = await shoham.locator(".live-banner").getByRole("link", { name: "לעקוב" }).evaluate((el) => getComputedStyle(el).textDecorationLine);
    check("the banner's לעקוב is a button, not underlined", followLook === "none", followLook);
    a11y.push(...(await snap(shoham, out, "shell-6-banner")));
    // A quiz line (Z's slot) outranks reading aloud: the line shows it and ends with "+1".
    await shoham.evaluate(() => {
      const s = document.querySelector(".live-banner .live-slot");
      const span = document.createElement("span");
      span.className = "live-text e2e-quiz";
      span.textContent = "מבחן קבוצתי פתוח · בפנים: שוהם, נועה";
      s.append(span);
    });
    await shoham.locator(".live-more").waitFor({ timeout: 5000 });
    const shown = await shoham.locator(".live-banner .live-slot.is-shown").innerText();
    const more = await shoham.locator(".live-more").innerText();
    const height = await shoham.locator(".live-banner").evaluate((el) => el.getBoundingClientRect().height);
    check("banner one line, +1", /מבחן קבוצתי פתוח/.test(shown) && more.trim() === "+1" && height < 70, `${shown} ${more} ${height}`);
    await shoham.evaluate(() => document.querySelector(".e2e-quiz").remove());
    await shoham.locator(".live-more").waitFor({ state: "detached", timeout: 5000 });
    await shoham.locator(".live-banner").getByRole("link", { name: "לעקוב" }).click();
    await shoham.getByText(/מעקב: נועה/).waitFor({ timeout: 40000 });
    check("E6 follow from the banner", new URL(shoham.url()).searchParams.get("follow") === "1" && (await shoham.locator(".live-banner .live-slot.is-shown").count()) === 0);

    // A sheet closed by Back leaves the reader where it is, after a round trip out of it:
    // lecture B in the middle → the banner's "לעקוב" → Back to B (its place) → up to part 1 →
    // the comment sheet and the slide sheet, each opened and closed: the reader does not move.
    await shoham.goto(`${mock.base}/?l=${B}`);
    await shoham.locator('[data-part="7"]').waitFor({ timeout: 15000 });
    await shoham.evaluate(() => document.querySelector('[data-part="5"]').scrollIntoView({ block: "start", behavior: "instant" }));
    await shoham.locator(".live-banner").getByRole("link", { name: "לעקוב" }).waitFor({ timeout: 40000 });
    const left = await shoham.evaluate(() => Math.round(scrollY));
    await shoham.evaluate(() => document.querySelector(".live-banner a.live-act").click()); // tapped where it is
    await shoham.waitForURL(new RegExp(`l=${L}`));
    await shoham.goBack();
    await shoham.waitForURL((u) => u.search === `?l=${B}`);
    await shoham.locator('[data-part="7"]').waitFor({ timeout: 15000 });
    await shoham.waitForTimeout(2300);
    const returned = await shoham.evaluate(() => Math.round(scrollY));
    await shoham.evaluate(() => document.querySelector('[data-part="1"]').scrollIntoView({ block: "start", behavior: "instant" }));
    await shoham.waitForTimeout(300);
    const reading = await shoham.evaluate(() => Math.round(scrollY));
    const para = await shoham.evaluate(() => {
      const e = [...document.querySelectorAll('[data-part="1"] p[data-blk]')].find((x) => {
        const r = x.getBoundingClientRect();
        return r.top > 200 && r.bottom < innerHeight - 150;
      });
      const r = e.getBoundingClientRect();
      return { x: r.left + 20, y: r.top + 8 };
    });
    await shoham.mouse.click(para.x, para.y);
    await shoham.getByRole("button", { name: "תגובה או שאלה" }).first().click();
    await shoham.locator(".a-sheet").first().waitFor({ timeout: 5000 });
    await shoham.goBack();
    await shoham.locator(".a-sheet").first().waitFor({ state: "detached", timeout: 5000 });
    await shoham.waitForTimeout(2300);
    const afterThread = await shoham.evaluate(() => Math.round(scrollY));
    const tag = await shoham.evaluate(() => {
      const e = [...document.querySelectorAll('[data-part="1"] .src-link')].find((x) => {
        const r = x.getBoundingClientRect();
        return r.top > 150 && r.bottom < innerHeight - 40;
      });
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await shoham.mouse.click(tag.x, tag.y);
    await shoham.locator(".slide-sheet").waitFor({ timeout: 5000 });
    await shoham.locator('.slide-sheet button[aria-label="סגירה"]').click();
    await shoham.locator(".slide-sheet").waitFor({ state: "detached", timeout: 5000 });
    await shoham.waitForTimeout(2300);
    const afterSlide = await shoham.evaluate(() => Math.round(scrollY));
    check(
      "a sheet closed by Back keeps the reader's place",
      Math.abs(returned - left) < 120 && reading < left - 1000 && Math.abs(afterThread - reading) <= 2 && Math.abs(afterSlide - reading) <= 2 && path0(shoham) === `/?l=${B}`,
      JSON.stringify({ left, returned, reading, afterThread, afterSlide, url: path0(shoham) }),
    );
    await noaPage.getByRole("button", { name: "לסיים", exact: true }).click();
    await noaPage.close();

    // "יחד": who reads aloud, and the group's open questions (a tap opens the paragraph; its back arrow says "→ יחד")
    await shoham.goto(`${mock.base}/?v=group`);
    await shoham.getByText("אין הקראה כרגע. פותחים הרצאה ולוחצים ״להקריא לקבוצה״.").waitFor({ timeout: 40000 });
    await shoham.locator(".question-link").first().waitFor({ timeout: 10000 });
    a11y.push(...(await snap(shoham, out, "shell-7-group")));
    await shoham.locator(".question-link").first().click();
    await shoham.waitForFunction(() => document.querySelector('[data-part="1"] [data-blk="3"]')?.classList.contains("blk-marked"), null, { timeout: 10000 });
    const fromGroup = await shoham.locator(".ph-head .back").innerText();
    check("group question opens its paragraph", new URL(shoham.url()).searchParams.get("at") === "1.3" && fromGroup === "→ יחד", fromGroup);

    // "שלי": spend, the members and the creator's controls, help, sign-out. Ten more members, so the list is long.
    for (const n of ["אביב", "בר", "גל", "דור", "הדר", "טל", "יובל", "ליאור", "נוי", "עדי"]) mock.member(n);
    await shoham.goto(`${mock.base}/?v=me`);
    const spend = shoham.locator(".me-screen p", { hasText: "השימוש של הקבוצה החודש: $12.40 מתוך $33" });
    await spend.waitFor({ timeout: 10000 });
    await shoham.getByText("נוצל על ידך החודש: $1.20").waitFor();
    await shoham.locator(".members li").nth(11).waitFor({ timeout: 10000 });
    // On screen "(≈ ₪45)"; read aloud, "בערך".
    const spendShown = await spend.evaluate((el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll(".sr-only").forEach((n) => n.remove());
      return c.textContent;
    });
    const spendRead = await spend.ariaSnapshot();
    check("me: the spend line, ≈ read as בערך", spendShown === "השימוש של הקבוצה החודש: $12.40 מתוך $33 (≈ ₪45)" && /\(\s*בערך ₪45\)/.test(spendRead), `${spendShown} | ${spendRead}`);
    const removeButtons = await shoham.getByRole("button", { name: "הסרה מהקבוצה" }).count();
    a11y.push(...(await snap(shoham, out, "shell-8-me")));
    // At 360 × 640: the remove confirm opens under its member, in view above the tab bar, on "ביטול";
    // "ביטול" returns focus to the row. Every keyboard stop stays clear of the tab bar.
    await shoham.setViewportSize({ width: 360, height: 640 });
    await shoham.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const noaRow = shoham.locator(".members li", { hasText: "נועה" });
    await noaRow.getByRole("button", { name: "הסרה מהקבוצה" }).click();
    await noaRow.locator(".confirm").waitFor({ timeout: 5000 });
    await shoham.waitForTimeout(300);
    const placed = await noaRow.locator(".confirm").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), barTop: Math.round(document.querySelector(".ph-tabs").getBoundingClientRect().top), focus: document.activeElement?.textContent, text: el.querySelector("span")?.textContent };
    });
    await shoham.getByRole("button", { name: "ביטול" }).click();
    const focusBack = await shoham.evaluate(() => ({ text: document.activeElement?.textContent, row: document.activeElement?.closest("li")?.textContent?.slice(0, 4) }));
    check(
      "me: the remove confirm under its member",
      placed.top >= 0 && placed.bottom <= placed.barTop && placed.focus === "ביטול" && placed.text === "להסיר את נועה מהקבוצה? התגובות והתיקונים יישארו בסיכומים." && focusBack.text === "הסרה מהקבוצה" && focusBack.row === "נועה" && (await shoham.locator(".confirm").count()) === 0,
      JSON.stringify({ placed, focusBack }),
    );
    await shoham.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      document.activeElement?.blur?.();
    });
    const hidden = [];
    let stops = 0;
    for (let i = 0; i < 30; i++) {
      await shoham.keyboard.press("Tab");
      const r = await shoham.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || !el.closest("main")) return null;
        const b = el.getBoundingClientRect();
        const bar = document.querySelector(".ph-tabs").getBoundingClientRect();
        return { name: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 20), top: Math.round(b.top), bottom: Math.round(b.bottom), barTop: Math.round(bar.top) };
      });
      if (!r) continue;
      stops += 1;
      if (r.top < 0 || r.bottom > r.barTop) hidden.push(r);
    }
    await shoham.setViewportSize({ width: 390, height: 844 });
    check("me: every keyboard stop clear of the tab bar", stops > 12 && hidden.length === 0, JSON.stringify({ stops, hidden }));
    await shoham.getByRole("button", { name: "קוד הזמנה חדש" }).click();
    await shoham.getByText("להחליף את קוד ההזמנה? קישור הזמנה שכבר נשלח יפסיק לעבוד.").waitFor();
    await shoham.getByRole("button", { name: "החלפה" }).click();
    await shoham.locator(".a-toast", { hasText: "קוד ההזמנה הוחלף." }).waitFor({ timeout: 5000 });
    check("me: creator controls", removeButtons === db.members.length - 1 && db.group.join_code === "XYZ789" && (await shoham.getByRole("button", { name: "יציאה מהמכשיר הזה" }).count()) === (flags.account ? 0 : 1), `${removeButtons}`);
    // "פרטיות: מי רואה מה" opens help at the note; its back arrow says "→ שלי" and returns.
    await shoham.getByRole("link", { name: "פרטיות: מי רואה מה" }).click();
    await shoham.locator("details#privacy[open]").waitFor({ timeout: 10000 });
    const fromMe = await shoham.locator(".ph-head .back").innerText();
    await shoham.locator(".ph-head .back").click();
    await shoham.waitForURL((u) => u.search === "?v=me");
    check("help from שלי: → שלי", fromMe === "→ שלי", fromMe);

    // D2, D4: help, the privacy note at #privacy, the spend footer; the rows show they open
    await shoham.goto(`${mock.base}/?v=help#privacy`);
    await shoham.locator("details#privacy[open]").waitFor({ timeout: 10000 });
    const inView = await shoham.locator("details#privacy").evaluate((el) => el.getBoundingClientRect().top < innerHeight && el.getBoundingClientRect().bottom > 0);
    await shoham.getByText("השימוש של הקבוצה החודש: $12.40 מתוך $33").waitFor({ timeout: 10000 });
    const chevrons = await shoham.locator(".help summary").evaluateAll((els) => els.map((el) => getComputedStyle(el, "::after").borderBottomWidth));
    check("D2 help #privacy, D4 spend line", inView && chevrons.length >= 9 && chevrons.every((w) => w === "2px"), JSON.stringify(chevrons));
    // §6.2's lines that depend on what has shipped: the email line with accounts, and the
    // upload row's second sentence, which W's slot turns to the server's once W1 writes there.
    const note = await shoham.locator("details#privacy .privacy-note").innerText();
    const emailLine = /ספק המייל:\s*כתובת המייל נשמרת רק ב-Supabase לצורך כניסה, ולא מוצגת לקבוצה\. הקודים נשלחים דרך ספק המייל\./.test(note);
    const uploadRow = await shoham.locator("details", { has: shoham.locator("summary", { hasText: "העלאת הרצאה" }) }).evaluate((el) => el.querySelector("p").textContent);
    check(
      "D2 the note's account line and the upload row",
      emailLine === flags.account && uploadRow.includes("כדאי להשאיר את ההרצאה פתוחה עד שהסיכום נכתב.") && !uploadRow.includes("הסיכום נכתב בשרת"),
      JSON.stringify({ emailLine, uploadRow }),
    );
    a11y.push(...(await snap(shoham, out, "shell-9-help")));

    // D3: Join's "מה נשמר ואיפה" opens help signed out; help's back arrow returns to the
    // invite link with its code, and the name typed before.
    const { page: guest } = await mock.open(browser, null, { path: "/?join=ABC123" });
    await guest.getByPlaceholder("למשל: שוהם").fill("גל");
    await guest.getByRole("link", { name: "מה נשמר ואיפה" }).click();
    await guest.locator("details#privacy[open]").waitFor({ timeout: 10000 });
    check("D3 help signed out", (await guest.locator(".ph-tabs").count()) === 0 && new URL(guest.url()).search === "?v=help");
    a11y.push(...(await snap(guest, out, "shell-10-help-signed-out")));
    await guest.locator(".ph-head .back").click();
    await guest.locator(".code-input").waitFor({ timeout: 10000 });
    const joinAgain = { url: path0(guest), code: await guest.locator(".code-input").inputValue(), name: await guest.getByPlaceholder("למשל: שוהם").inputValue() };
    check("D3 back to the invite link", joinAgain.url === "/?join=ABC123" && joinAgain.code === "ABC123" && joinAgain.name === "גל", JSON.stringify(joinAgain));

    // The schema gate: a database older than the build shows one line only
    const schema0 = { ...db.schema };
    db.schema = {};
    await shoham.goto(`${mock.base}/`);
    await shoham.getByText("העדכון של האפליקציה עוד לא הושלם. כדאי לנסות שוב בעוד כמה דקות.").waitFor({ timeout: 10000 });
    a11y.push(...(await snap(shoham, out, "shell-11-gate")));
    db.schema = schema0;
    await shoham.getByRole("button", { name: "לנסות שוב" }).click();
    if (today) await shoham.locator("main.today .ph-head .t", { hasText: "היום" }).waitFor({ timeout: 10000 });
    else await shoham.locator(".lecture-card").first().waitFor({ timeout: 10000 });
    steps["schema gate"] = "ok";

    const problems = mock.problems;
    const failed = Object.entries(steps).filter(([, v]) => typeof v === "string" && v.startsWith("FAIL"));
    console.log(JSON.stringify({ errors: problems, steps, a11y }, null, 1));
    if (problems.length || a11y.length || failed.length) process.exitCode = 1;
    void shohamId;
  } catch (e) {
    console.error("FAILED:", e.message);
    console.error(JSON.stringify({ problems: mock.problems, steps, a11y, calls: mock.calls.slice(-12) }, null, 1));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await mock.close();
  }
})();
