// C-5 (spec §7.C): flashcards end to end, design-cards §6.3 steps 1-16, on the
// shared mock with package C's plugin (e2e/study/mocks/cards.cjs). Two members
// (שוהם, נועה) at 390×844, a fixed clock (18:00 in Israel), light and dark,
// a11y.cjs at every screenshot step, no page error, no unmocked call, no
// horizontal overflow at 360 px.
//
//   NODE_PATH=$(npm root -g) node e2e/study/cards.cjs <dist> <out dir> [rel1|rel2|review|r5|all|off]
//
// The third argument (or E2E_FLAGS) says which flags the build was made with:
//   rel1    release 1 (QUESTIONS, PRACTICE, CARDS; docs/study/RELEASE-1.md), against the
//           registry this branch's SQL writes: as r5
//   rel2    release 2 (release 1's three and QUIZ), against the same registry: as r5
//   r5      release 5 (QUESTIONS, PRACTICE, QUIZ, CARDS): the deck, its writing, fixes,
//           export and "עיון בכרטיסיות"; no control opens a review session, and ?v=cards&s=…
//           is replaced with its notice (review UX-1, UX-21); then a share sheet closed
//           without sharing (ANKI-CANCEL) and a round a 402 stopped (STUCK-ROUND)
//   review  release 5 + CARDS_REVIEW: all of the above, then review sessions (steps 8-14)
//   all     every flag on: as review
//   off     every flag off: the cards routes are replaced, the library has no cards chip
// C's end (§12.3.C, CA-3 and CS-4), with every flag set that has the cards: the deck page of
// cards.html s3 (its ring, a row per part with "להוסיף", the whole deck added and taken out again,
// the export of the member's own deck), "מאיפה זה?" opening the card's paragraph, a card a
// correction marked and "עדיין נכון"; with review on, also the review home asked once, a private
// card from a practice mistake first among the new with its origin chip and the next one
// announced, and a marked card left out of a session.
// With E2E_ANKI_PYTHON set to a Python that has anki 26.9.4, the exported package is also
// imported by Anki itself (C-4); otherwise its structure is checked here.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const cardsPlugin = require("./mocks/cards.cjs");

const root = path.join(__dirname, "..", "..");
const JSZip = require(path.join(root, "node_modules", "jszip"));
const initSqlJs = require(path.join(root, "node_modules", "sql.js"));

const [dist, out, flagSet = process.env.E2E_FLAGS || "review"] = process.argv.slice(2);
if (!dist || !out || !["rel1", "rel2", "review", "r5", "all", "off"].includes(flagSet)) {
  console.error("usage: node e2e/study/cards.cjs <dist> <out dir> [rel1|rel2|review|r5|all|off]");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const review = flagSet === "review" || flagSet === "all";
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

/** The latest 18:00 in Israel at or before now: a known hour, never ahead of the sessions' tokens. */
function lastSixPm() {
  const hm = (t) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
  let t = Math.floor(Date.now() / 60_000) * 60_000;
  while (hm(t) !== "18:00") t -= 60_000;
  return t;
}

(async () => {
  const mock = await createMock({ dist, plugins: [cardsPlugin], flags: flagSet });
  const { db, LECTURE_ID: L, GROUP } = mock;
  const m = db.cardsMock;
  db.notifyCards = mock.notify;
  mock.seedLecture();
  // A picture on slide 6, which the Loop diuretics card shows with its answer.
  const lecture = db.lectures.find((l) => l.id === L);
  const pic = `${GROUP.id}/${L}/s6-1.jpg`;
  lecture.slides.find((s) => s.n === 6).figures = [{ k: 1, path: pic, w: 160, h: 100 }];
  db.files.set(pic, JPEG);
  const shohamId = mock.people["שוהם"].user.id;
  const noaId = mock.people["נועה"].user.id;
  // The pages' clock, and the plugin's with it.
  const T0 = lastSixPm();
  const setAt = Date.now();
  m.offset = T0 - setAt;

  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  const requests = [];
  const pages = [];
  /** The Realtime joins every page sent so far (kept in its sessionStorage across loads). */
  const joins = async () => {
    const out = [];
    for (const { who, page } of pages) {
      const list = await page.evaluate(() => JSON.parse(sessionStorage.getItem("e2e-ws") || "[]")).catch(() => []);
      for (const payload of list) out.push({ who, payload });
    }
    return out;
  };
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const until = async (fn, ms = 15_000, label = "condition") => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
      await new Promise((ok) => setTimeout(ok, 100));
    }
  };
  /** A member's page on a path, on the fixed clock, with its requests and socket frames logged. */
  const openAt = async (who, p, opt = {}) => {
    const { page, ctx } = await mock.open(browser, who, opt);
    await ctx.clock.install({ time: T0 + (Date.now() - setAt) });
    // Every frame the page sends on its sockets, across its loads (the Realtime joins name their tables).
    await ctx.addInitScript(() => {
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (d) {
        try {
          const all = JSON.parse(sessionStorage.getItem("e2e-ws") || "[]");
          if (/phx_join/.test(String(d))) sessionStorage.setItem("e2e-ws", JSON.stringify([...all, String(d)]));
        } catch {
          /* the frame still goes */
        }
        return send.call(this, d);
      };
    });
    page.on("request", (r) => requests.push({ who, url: r.url(), at: Date.now() }));
    pages.push({ who, page });
    await page.goto(mock.base + p);
    return { page, ctx };
  };
  const row = (page, text) => page.locator(".card-row", { hasText: text });
  /** C's end: the deck page lists parts; a part's name opens its cards. Opens every part (and "ועוד"). */
  const openParts = async (page) => {
    await page.locator(".deck-part").first().waitFor({ timeout: 10_000 });
    const more = page.locator(".more-parts .part-toggle");
    if (await more.count()) await more.click();
    const closed = page.locator('.deck-part .part-toggle[aria-expanded="false"]');
    for (let i = 0; i < 20 && (await closed.count()); i++) await closed.first().click();
  };
  /** Opens a card's row in the deck, unless it is open already (a tap on an open row closes it). */
  const expand = async (page, text) => {
    await openParts(page);
    if (!(await row(page, text).locator(".card-row-body").count())) await row(page, text).locator(".card-row-main").click();
    await row(page, text).locator(".card-row-body").waitFor();
  };
  /** The deck's active cards, as its line under the title says them ("6 כרטיסים · 8 חלקים · …"). */
  const deckCount = async (page) => {
    const sub = page.locator(".deck-sub");
    if (!(await sub.count())) return 0;
    const text = await sub.innerText();
    return /^כרטיסייה אחת/.test(text.trim()) ? 1 : Number((/(\d+) כרטיסיות/.exec(text) ?? [])[1] ?? 0);
  };

  let sh;
  let no;
  try {
    if (flagSet === "off") {
      // Every flag off: no cards anywhere; a link to them lands on the library with its notice.
      ({ page: sh } = await openAt("שוהם", `/?v=cards&l=${L}`));
      await sh.getByText("התכונה הזו עוד לא פתוחה.").waitFor({ timeout: 10_000 });
      check("off: ?v=cards is replaced, with the notice", (await sh.locator(".card-row").count()) === 0 && !/v=cards/.test(sh.url()));
      await sh.goto(mock.base + "/?v=library");
      await sh.locator(".lecture-card").first().waitFor();
      check("off: no cards chip on the library card", (await sh.locator(".lc-chips a", { hasText: "כרטיסיות" }).count()) === 0);
      a11y.push(...(await snap(sh, out, "cards-0-off")));
      return;
    }

    /* ── 1. Shoham opens the deck and writes it ── */
    ({ page: sh } = await openAt("שוהם", `/?v=cards&l=${L}`));
    await sh.getByText("עוד אין כרטיסיות להרצאה הזו.").waitFor({ timeout: 15_000 });
    a11y.push(...(await snap(sh, out, "cards-1-empty")));
    ({ page: no } = await openAt("נועה", `/?v=cards&l=${L}`));
    await no.getByText("עוד אין כרטיסיות להרצאה הזו.").waitFor({ timeout: 15_000 });
    await no.evaluate(() => (window.__sameLoad = 1));
    await sh.getByRole("button", { name: "יצירת כרטיסיות" }).click();
    await sh.getByText(/כ-6 כרטיסיות מהשקפים בלבד/).waitFor();
    await sh.getByText(/נוצלו החודש \$12\.40 מתוך \$33\./).waitFor();
    check("1. the sheet: about 6 cards, the cost and the month's spend", (await sh.getByText(/עלות משוערת: כ-\$0\.05/).count()) === 1);
    a11y.push(...(await snap(sh, out, "cards-1-generate")));
    // Part 3 is another phone's (busy); part 4 stops at the time guard before its first card.
    m.busyPart = 3;
    m.failPart = 4;
    await sh.getByRole("button", { name: "ליצור", exact: true }).click();
    await sh.getByText(/נכתבות כרטיסיות: \d+ מתוך 6/).waitFor({ timeout: 10_000 });
    a11y.push(...(await snap(sh, out, "cards-2-writing")));

    /* ── 2. One request alone until its start line, then never more than two ── */
    await until(() => m.api.length >= 6 && m.api.every((x) => x.end), 30_000, "the round's six requests");
    const first = m.api[0];
    const inFlight = (t) => m.api.filter((x) => x.start <= t && t < x.end).length;
    const peak = Math.max(...m.api.map((x) => inFlight(x.start)));
    check(
      "2. the first part alone until its start line, then at most two in flight",
      first.part === 0 && m.api.slice(1).every((x) => x.start >= first.startLine) && peak <= 2,
      JSON.stringify({ first: first.part, peak, starts: m.api.map((x) => [x.part, x.start - first.start, x.startLine && x.startLine - first.start]) }),
    );

    /* ── 3. Cards arrive one by one on both phones, without a reload ── */
    await until(async () => (await deckCount(sh)) >= 4 && (await deckCount(no)) >= 4, 15_000, "four cards on both phones");
    check("3. Noa saw the cards arrive live, on the same page load", (await no.evaluate(() => window.__sameLoad === 1)) && (await deckCount(no)) >= 4);
    // 15. A part another phone holds, and a part that failed.
    await sh.locator(".gen-parts li", { hasText: "Thiazides" }).getByText(/· נכתב במכשיר אחר…/).waitFor({ timeout: 10_000 });
    await sh.getByText("החלק הזה לא נכתב. החלק לקח יותר מדי זמן. ״לנסות שוב״ יכתוב אותו מהר יותר.").waitFor({ timeout: 10_000 });
    a11y.push(...(await snap(sh, out, "cards-15-failed")));
    const before = m.api.length;
    await sh.getByRole("button", { name: "לנסות שוב" }).click();
    await until(() => m.api.length === before + 1 && m.api[before].end, 10_000, "the retried part");
    check("15. 'לנסות שוב' reruns that part only", m.api[before].part === 4 && m.api[before].status === 200, JSON.stringify(m.api[before]));
    cardsPlugin.finishElsewhere(db, 3, noaId);
    await until(async () => (await deckCount(sh)) === 6 && (await deckCount(no)) === 6, 15_000, "six cards on both phones");
    await sh.locator(".gen").waitFor({ state: "detached", timeout: 10_000 });
    check("15. the busy part was skipped and written by the other phone; the round went on", m.batches.every((b) => b.status === "ready"));
    a11y.push(...(await snap(sh, out, "cards-3-deck")));
    for (const p of [sh, no]) await openParts(p);

    /* ── 4. Noa fixes card 1; Shoham sees it live, then undoes it from the history ── */
    const c1 = "באיזה מקטע של הנפרון נספג רוב ה-Na+?";
    await expand(no, c1);
    await row(no, c1).getByRole("button", { name: "עריכה" }).click();
    const noaSheet = no.locator(".a-sheet");
    await noaSheet.getByText("עריכת כרטיסייה").waitFor();
    a11y.push(...(await snap(no, out, "cards-4-edit")));
    await noaSheet.locator("label", { hasText: "תשובה" }).locator("input").fill("Proximal tubule, כ-65% מה-Na+.");
    await noaSheet.getByRole("button", { name: "שמירה" }).click();
    await no.getByText("התיקון נשמר לכל הקבוצה.").waitFor();
    await openParts(sh);
    await row(sh, c1).getByText("נערכה ע״י נועה").waitFor({ timeout: 10_000 });
    await expand(sh, c1);
    await row(sh, c1).getByText("Proximal tubule, כ-65% מה-Na+.").waitFor();
    await row(sh, c1).getByRole("button", { name: "היסטוריה" }).click();
    await sh.getByText(/תיקון · נועה · /).waitFor();
    a11y.push(...(await snap(sh, out, "cards-4-history")));
    await sh.getByRole("button", { name: "החזרה לגרסה הקודמת" }).first().click();
    await sh.getByText(/החזרת גרסה · שוהם/).waitFor({ timeout: 10_000 });
    await sh.keyboard.press("Escape");
    await row(sh, c1).getByText("Proximal tubule, כ-65%.", { exact: true }).waitFor({ timeout: 10_000 });
    await expand(no, c1);
    await row(no, c1).getByText("Proximal tubule, כ-65%.", { exact: true }).waitFor({ timeout: 10_000 });
    check("4. a fix shows live with its author; the history puts the text back on both screens", true);

    /* ── 5. Both edit card 2; Noa saves first ── */
    const c2 = "מה מנגנון הפעולה של Acetazolamide?";
    for (const p of [sh, no]) {
      await expand(p, c2);
      await row(p, c2).getByRole("button", { name: "עריכה" }).click();
      await p.locator(".a-sheet").getByText("עריכת כרטיסייה").waitFor();
    }
    await no.locator(".a-sheet label", { hasText: "תשובה" }).locator("input").fill("עיכוב carbonic anhydrase בצינורית הקרובה.");
    await no.locator(".a-sheet").getByRole("button", { name: "שמירה" }).click();
    await no.getByText("התיקון נשמר לכל הקבוצה.").waitFor();
    await sh.locator(".a-sheet label", { hasText: "תשובה" }).locator("input").fill("מעכבת את carbonic anhydrase.");
    await sh.locator(".a-sheet").getByRole("button", { name: "שמירה" }).click();
    await sh.getByText("הכרטיסייה נערכה בינתיים במכשיר אחר. הגרסה החדשה מוצגת עכשיו, ואפשר לערוך שוב.").waitFor();
    const newer = await sh.locator(".a-sheet .newer").innerText();
    const draft = await sh.locator(".a-sheet label", { hasText: "תשובה" }).locator("input").inputValue();
    check("5. a conflict: Noa's version shows, Shoham's draft stays in the field", newer.includes("בצינורית הקרובה") && draft === "מעכבת את carbonic anhydrase.", JSON.stringify({ newer, draft }));
    a11y.push(...(await snap(sh, out, "cards-5-conflict")));
    await sh.locator(".a-sheet").getByRole("button", { name: "שמירה" }).click();
    await sh.getByText("התיקון נשמר לכל הקבוצה.").waitFor();
    check("5. saving again goes on top of Noa's version", m.cards.find((c) => c.front === c2).back === "מעכבת את carbonic anhydrase." && m.cards.find((c) => c.front === c2).version === 3);

    /* ── 6. Delete a card, undo, delete again ── */
    const c3 = "איזו קבוצה היא החזקה ביותר בטבלת ההשוואה?";
    await expand(sh, c3);
    await row(sh, c3).getByRole("button", { name: "מחיקה לכל הקבוצה" }).click();
    await sh.getByText("הכרטיסייה נמחקה לכל הקבוצה.").waitFor();
    await sh.locator(".a-toast").getByRole("button", { name: "ביטול" }).click();
    await until(() => !m.cards.find((c) => c.front === c3).deleted_at, 5000, "the restore");
    await row(sh, c3).locator(".card-row-main").first().waitFor();
    await expand(sh, c3);
    await row(sh, c3).getByRole("button", { name: "מחיקה לכל הקבוצה" }).click();
    for (const p of [sh, no]) await p.locator(".deleted-cards summary", { hasText: "כרטיסייה אחת נמחקה" }).waitFor({ timeout: 10_000 });
    await no.locator(".deleted-cards summary").click();
    await no.getByText(/נמחקה ע״י שוהם · /).waitFor();
    check("6. deleted, undone, deleted again: under 'נמחקו' on both phones", (await deckCount(sh)) === 5 && (await deckCount(no)) === 5);

    /* ── 7. Export to Anki (the download path), sql-wasm only after the tap ── */
    const tapAt = Date.now();
    const wasmBefore = requests.filter((r) => /sql-wasm/.test(r.url) && r.at < tapAt).length;
    await sh.getByRole("button", { name: "ייצוא ל-Anki" }).first().click();
    const exportSheet = sh.locator(".a-sheet", { hasText: "מה לייצא" });
    // Nothing of the deck is Shoham's own yet (decision 8): the whole deck is the choice.
    await exportSheet.getByText("כל החפיסה (5 כרטיסיות)").waitFor();
    check("7. before any part is added, the sheet offers no deck of one's own", (await exportSheet.getByText(/^החפיסה שלך/).count()) === 0);
    await exportSheet.getByText(/כ-0\.\dMB/).waitFor();
    a11y.push(...(await snap(sh, out, "cards-7-export")));
    const [download] = await Promise.all([sh.waitForEvent("download", { timeout: 20_000 }), exportSheet.getByRole("button", { name: "ייצוא" }).click()]);
    const file = path.join(out, "cards-export.apkg");
    await download.saveAs(file);
    await sh.getByText("הקובץ מוכן. פותחים אותו באפליקציית Anki.").waitFor();
    const wasmAfter = requests.filter((r) => /sql-wasm/.test(r.url) && r.at >= tapAt).length;
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const SQL = await initSqlJs();
    const col = new SQL.Database(await zip.file("collection.anki2").async("uint8array"));
    const decks = Object.values(JSON.parse(col.exec("select decks from col")[0].values[0][0])).map((d) => d.name);
    const notes = col.exec("select flds, tags from notes")[0].values;
    const cloze = notes.find(([f]) => f.includes("בצינורית הרחוקה"));
    const media = JSON.parse(await zip.file("media").async("string"));
    col.close();
    check(
      "7. the package: one deck, 5 notes (the deleted card left out), the cloze rendered, the picture inside",
      /^tamtzit-\d{4}-\d{2}-\d{2}\.apkg$/.test(download.suggestedFilename()) &&
        decks.includes("תמצית::פרמקולוגיה לדוגמה::משתנים (Diuretics)") &&
        notes.length === 5 &&
        Boolean(cloze) &&
        cloze[0].split("\u001f")[0].includes('<span class="cloze">[…]</span>') &&
        Object.values(media).includes(`tz-${L}-s6-1.jpg`),
      JSON.stringify({ name: download.suggestedFilename(), decks, notes: notes.length, media }),
    );
    check("7. sql-wasm was not requested before 'ייצוא ל-Anki' (C-7)", wasmBefore === 0 && wasmAfter >= 1, JSON.stringify({ wasmBefore, wasmAfter }));
    if (process.env.E2E_ANKI_PYTHON) {
      const work = path.join(out, "anki-import");
      fs.rmSync(work, { recursive: true, force: true });
      fs.mkdirSync(work, { recursive: true });
      const py = [
        "import sys",
        "from anki.collection import Collection, ImportAnkiPackageOptions, ImportAnkiPackageRequest",
        "col = Collection(sys.argv[2])",
        "log = col.import_anki_package(ImportAnkiPackageRequest(package_path=sys.argv[1], options=ImportAnkiPackageOptions())).log",
        "n = [col.get_note(i) for i in col.find_notes('')]",
        "print(len(log.new), sum(1 for x in n if x['Image']), col.fix_integrity()[1])",
      ].join("\n");
      const res = execFileSync(process.env.E2E_ANKI_PYTHON, ["-I", "-c", py, file, path.join(work, "c.anki2")]).toString().trim();
      check("7. Anki 26.9.4 imports it: 5 notes, 1 with its picture, Check Database passes", res === "5 1 True", res);
    }

    /* ── C's end (CA-3, CS-4): the deck page part by part, the export of one's own deck ── */
    await sh.keyboard.press("Escape").catch(() => undefined);
    await sh.reload(); // the page as it opens: every part's row closed, as the approved page shows them
    await sh.locator(".my-deck").waitFor({ timeout: 10_000 });
    await sh.locator(".deck-part").first().waitFor({ timeout: 10_000 });
    const ring = async () => Number((await sh.locator(".deck-ring .a-ring span").innerText()).trim());
    const shownParts = await sh.locator(".deck-part[data-part]").count();
    const moreParts = (await sh.locator(".more-parts").innerText().catch(() => "")).trim();
    check(
      "C3. the deck page: 5 כרטיסים · 8 חלקים · made once for the group; the ring at 0, no part in her deck, five rows and 'ועוד 3 חלקים', its name in Anki",
      /^5 כרטיסיות · \d+ חלקים · נוצרו פעם אחת לכל הקבוצה$/.test((await sh.locator(".deck-sub").innerText()).trim()) &&
        (await ring()) === 0 &&
        (await sh.getByText("בחפיסה שלך: 0 כרטיסיות").count()) === 1 &&
        (await sh.locator(".deck-part .a-chip.ok").count()) === 0 &&
        (await sh.locator(".anki-path").innerText()).includes("תמצית::פרמקולוגיה לדוגמה::משתנים (Diuretics)") &&
        shownParts === 5 &&
        moreParts.startsWith("ועוד 3 חלקים:"),
      JSON.stringify({ sub: await sh.locator(".deck-sub").innerText(), ring: await ring(), shownParts, moreParts }),
    );
    // Part 0 into her deck: its row says so, the ring counts it, and the export offers "החפיסה שלך".
    const part0 = sh.locator('.deck-part[data-part="0"]');
    const part0Cards = Number(await part0.getAttribute("data-cards"));
    await part0.getByRole("button", { name: "להוסיף" }).click();
    await part0.locator(".a-chip.ok", { hasText: `${part0Cards} בחפיסה ✓` }).waitFor();
    await until(async () => (await ring()) === part0Cards, 5000, "the ring");
    const part0Live = m.cards.filter((c) => c.part_idx === 0 && !c.deleted_at).length;
    check("C3. 'להוסיף' on part 0: in the database, its chip, the ring", m.adoptions.some((a) => a.user_id === shohamId && a.part_idx === 0) && part0Cards === part0Live && part0Cards > 0, JSON.stringify({ part0Cards, part0Live, adoptions: m.adoptions }));
    a11y.push(...(await snap(sh, out, "cards-c3-deck")));
    await sh.getByRole("button", { name: "ייצוא ל-Anki" }).first().click();
    const mineSheet = sh.locator(".a-sheet", { hasText: "מה לייצא" });
    // The deck page's word for a count (cards.html s3): "כרטיס אחד", "5 כרטיסים".
    await mineSheet.getByText(`החפיסה שלך (${part0Cards === 1 ? "כרטיסייה אחת" : `${part0Cards} כרטיסיות`})`, { exact: true }).waitFor();
    await mineSheet.getByText("כל החפיסה (5 כרטיסיות)").waitFor();
    a11y.push(...(await snap(sh, out, "cards-c3-export")));
    const [ownDownload] = await Promise.all([sh.waitForEvent("download", { timeout: 20_000 }), mineSheet.getByRole("button", { name: "ייצוא", exact: true }).click()]);
    const ownFile = path.join(out, "cards-export-mine.apkg");
    await ownDownload.saveAs(ownFile);
    {
      const zip2 = await JSZip.loadAsync(fs.readFileSync(ownFile));
      const SQL2 = await initSqlJs();
      const col2 = new SQL2.Database(await zip2.file("collection.anki2").async("uint8array"));
      const own = col2.exec("select flds from notes")[0].values.map(([x]) => x.split("\u001f")[0]);
      col2.close();
      check("C3. the export of her own deck carries only the parts she added", own.length === part0Cards && own.some((x) => x.includes("נספג")), JSON.stringify(own));
    }
    // Every part, then out of her deck, then back with "ביטול".
    await sh.getByRole("button", { name: "להוסיף את כל החלקים" }).click();
    await until(async () => (await ring()) === 5, 5000, "every part in the deck");
    await sh.getByRole("button", { name: "להוציא מהחפיסה שלי" }).click();
    await until(async () => (await ring()) === 0, 5000, "the deck emptied");
    await sh.locator(".a-toast").getByRole("button", { name: "ביטול" }).click();
    await until(async () => (await ring()) === 5, 5000, "the deck back");
    check("C3. every part added, taken out, and back with 'ביטול'", m.adoptions.filter((a) => a.user_id === shohamId).length >= 6 && (await sh.getByRole("button", { name: "להוסיף את כל החלקים" }).count()) === 0);
    // "מאיפה זה?": the card's paragraph, and "לפסקה" opens the reader at it.
    await expand(sh, c1);
    const source = row(sh, c1).locator(".card-source");
    await source.getByText("מאיפה זה?").waitFor({ timeout: 10_000 });
    const marked = (await source.locator(".a-para.marked").innerText()).trim();
    a11y.push(...(await snap(sh, out, "cards-c3-source")));
    const toPara = await source.getByRole("link", { name: "לפסקה" }).getAttribute("href");
    await source.getByRole("link", { name: "לפסקה" }).click();
    await until(() => !/v=cards/.test(sh.url()) && /[?&]l=/.test(sh.url()), 10_000, "the reader");
    await sh.locator('[data-blk="1"]').first().waitFor({ timeout: 10_000 });
    const readerHas = (await sh.locator('[data-blk="1"]').first().innerText()).replace(/\s+/g, " ").trim();
    check(
      "CA-3. 'מאיפה זה?' shows the paragraph and 'לפסקה' opens the reader at it",
      marked.length > 10 && /[?&]at=0\.1(&|$)/.test(toPara ?? "") && readerHas.slice(0, 20) === marked.replace(/\s+/g, " ").slice(0, 20),
      JSON.stringify({ marked, toPara, readerHas: readerHas.slice(0, 60) }),
    );
    await sh.goBack();
    await sh.locator(".my-deck").waitFor({ timeout: 10_000 });
    // A card a correction marked (section V marks it): the chip, then "עדיין נכון".
    const furoCard = m.cards.find((c) => !c.deleted_at && c.front !== c1 && c.front !== c2);
    const furo = furoCard.front.split("{{")[0].slice(0, 16);
    furoCard.stale_at = new Date(Date.now() + m.offset).toISOString();
    mock.notify("study_cards", "UPDATE", { ...furoCard });
    await openParts(sh);
    await row(sh, furo).getByText("בבדיקה אחרי תיקון בפסקה").waitFor({ timeout: 10_000 });
    await expand(sh, furo);
    a11y.push(...(await snap(sh, out, "cards-c3-stale")));
    await row(sh, furo).getByRole("button", { name: "עדיין נכון" }).click();
    await row(sh, furo).getByText("בבדיקה אחרי תיקון בפסקה").waitFor({ state: "detached", timeout: 10_000 });
    check("C3. a marked card says so; 'עדיין נכון' clears it", furoCard.stale_at === null && furoCard.checked_by === shohamId, JSON.stringify({ stale: furoCard.stale_at, by: furoCard.checked_by }));

    /* ── release 5: "עיון בכרטיסיות", and no control opens a review session ── */
    await sh.getByRole("button", { name: "עיון בכרטיסיות" }).click();
    const browse = sh.locator(".browse");
    await browse.getByRole("button", { name: "הצגת התשובה" }).waitFor();
    a11y.push(...(await snap(sh, out, "cards-r5-browse-front", { primary: ".browse .ph-foot .a-btn.primary" })));
    await browse.getByRole("button", { name: "הצגת התשובה" }).click();
    await browse.getByRole("button", { name: "לכרטיסייה הבאה" }).waitFor();
    a11y.push(...(await snap(sh, out, "cards-r5-browse-back", { primary: ".browse .ph-foot .a-btn.primary" })));
    await browse.getByRole("button", { name: "לכרטיסייה הבאה" }).click();
    await browse.getByRole("button", { name: "הצגת התשובה" }).waitFor();
    await sh.keyboard.press("Escape");
    await browse.waitFor({ state: "detached" });
    check("r5. 'עיון בכרטיסיות': front, tap, back, next; it wrote nothing", m.reviews.length === 0 && m.states.size === 0);
    const reviewLinks = async (p) => p.evaluate(() => [...document.querySelectorAll("a[href]")].filter((a) => /[?&]s=/.test(a.getAttribute("href"))).length);
    if (!review) {
      check("r5. the deck has no control that opens a review session", (await reviewLinks(sh)) === 0 && (await sh.getByRole("link", { name: "לחזור על ההרצאה" }).count()) === 0);
      await sh.goto(mock.base + "/?v=cards");
      await sh.getByRole("heading", { name: "כרטיסיות" }).waitFor();
      await sh.locator(".deck-row").first().waitFor();
      check("r5. the cards of the day: decks and export only", (await reviewLinks(sh)) === 0 && (await sh.locator(".today-box").count()) === 0);
      a11y.push(...(await snap(sh, out, "cards-r5-today")));
      await sh.goto(mock.base + "/?v=cards&s=today");
      await sh.getByText("החזרה על כרטיסיות באפליקציה תיפתח בקרוב. בינתיים: ״עיון בכרטיסיות״ או ייצוא ל-Anki.").waitFor();
      check("r5. a review link is replaced with its notice", !/s=today/.test(sh.url()));
      await sh.goto(mock.base + "/?v=library");
      const chip = sh.locator(".lc-chips a", { hasText: "כרטיסיות" });
      await chip.waitFor({ timeout: 10_000 });
      check("r5. the library card's chip: '5 כרטיסיות' to the deck", (await chip.innerText()).trim() === "5 כרטיסיות" && (await reviewLinks(sh)) === 0);
      a11y.push(...(await snap(sh, out, "cards-r5-library")));

      /* ── ANKI-CANCEL: a share sheet closed without sharing is no export ── */
      await sh.goto(mock.base + `/?v=cards&l=${L}`);
      await sh.locator(".deck-summary").waitFor({ timeout: 10_000 });
      const exported = `study-anki-exported:${L}`;
      const lastBefore = await sh.evaluate((k) => localStorage.getItem(k), exported);
      // The phone's share sheet takes files (the iPhone's home-screen app), and the person closes it.
      await sh.evaluate(() => {
        navigator.canShare = () => true;
        navigator.share = () => Promise.reject(new DOMException("Share canceled", "AbortError"));
      });
      await sh.getByRole("button", { name: "ייצוא ל-Anki" }).first().click();
      const cancelSheet = sh.locator(".a-sheet", { hasText: "מה לייצא" });
      await cancelSheet.getByText("כל החפיסה (5 כרטיסיות)").waitFor();
      await cancelSheet.getByRole("button", { name: "ייצוא", exact: true }).click();
      await cancelSheet.getByRole("button", { name: "מכינים את החבילה…" }).waitFor({ state: "detached", timeout: 20_000 });
      await sh.waitForTimeout(500);
      const lastAfter = await sh.evaluate((k) => localStorage.getItem(k), exported);
      const readyToast = await sh.getByText("הקובץ מוכן. פותחים אותו באפליקציית Anki.").count();
      check(
        "ANKI-CANCEL: the share sheet closed: the export sheet stays, no 'הקובץ מוכן', the last export unchanged",
        (await cancelSheet.count()) === 1 && (await cancelSheet.getByRole("button", { name: "ייצוא", exact: true }).isEnabled()) && readyToast === 0 && lastBefore !== null && lastAfter === lastBefore,
        JSON.stringify({ lastBefore, lastAfter, readyToast }),
      );
      await sh.keyboard.press("Escape");
      await cancelSheet.waitFor({ state: "detached" });

      /* ── STUCK-ROUND: a round a 402 stopped before its parts started goes on with one "לנסות שוב" ── */
      const L2 = "eeeeeeee-0000-4000-8000-000000000031";
      db.lectures.push({ ...lecture, id: L2, title: "משתנים: הרצאה שנייה" });
      for (const sec of db.sections.filter((x) => x.lecture_id === L)) db.sections.push({ ...sec, lecture_id: L2 });
      await sh.goto(mock.base + `/?v=cards&l=${L2}`);
      await sh.getByText("עוד אין כרטיסיות להרצאה הזו.").waitFor({ timeout: 15_000 });
      m.budget = true;
      const calls0 = m.api.length;
      await sh.getByRole("button", { name: "יצירת כרטיסיות" }).click();
      await sh.getByRole("button", { name: "ליצור", exact: true }).click();
      await sh.locator(".a-toast", { hasText: "הקבוצה הגיעה לתקרת התקציב של החודש." }).waitFor({ timeout: 10_000 });
      const stopped = () => m.batches.filter((b) => b.lecture_id === L2);
      check(
        "STUCK-ROUND: a 402 ends the round after one request, its parts left pending",
        m.api.length === calls0 + 1 && m.api[calls0].status === 402 && stopped().length > 1 && stopped().every((b) => b.status === "pending"),
        JSON.stringify({ calls: m.api.length - calls0, parts: stopped().map((b) => b.status) }),
      );
      const roundRetry = sh.locator(".gen-retry").getByRole("button", { name: "לנסות שוב" });
      await roundRetry.waitFor({ timeout: 10_000 });
      m.budget = false;
      await sh.reload();
      await sh.getByText(/נכתבות כרטיסיות: 0 מתוך \d+\./).waitFor({ timeout: 15_000 });
      await roundRetry.waitFor({ timeout: 10_000 });
      const retryCount = await sh.getByRole("button", { name: "לנסות שוב" }).count();
      a11y.push(...(await snap(sh, out, "cards-stuck-round")));
      await roundRetry.click();
      await until(() => stopped().every((b) => b.status === "ready"), 30_000, "every part the 402 stopped");
      await sh.locator(".gen").waitFor({ state: "detached", timeout: 10_000 });
      const madeL2 = m.cards.filter((c) => c.lecture_id === L2 && !c.deleted_at).length;
      await until(async () => (await deckCount(sh)) === madeL2, 10_000, "the written cards in the deck");
      check(
        "STUCK-ROUND: after a reload, one 'לנסות שוב' under the bar writes every part the 402 stopped",
        retryCount === 1 && madeL2 === stopped().reduce((n, b) => n + b.made, 0) && madeL2 > 0 && (await sh.getByRole("button", { name: "עוד כרטיסיות" }).isEnabled()),
        JSON.stringify({ retryCount, madeL2, parts: stopped().map((b) => [b.part_idx, b.status, b.made]) }),
      );
      return;
    }

    /* ── C6 (CS-4): the review home, asked once ── */
    await sh.goto(mock.base + "/?v=cards");
    const homeSheet = sh.locator(".a-sheet", { hasText: "איפה חוזרים על הכרטיסיות?" });
    await homeSheet.waitFor({ timeout: 10_000 });
    a11y.push(...(await snap(sh, out, "cards-c6-home")));
    await homeSheet.getByText(/^באפליקציה/).click();
    await homeSheet.getByRole("button", { name: "שמירה" }).click();
    await homeSheet.waitFor({ state: "detached" });
    await until(() => m.settings.get(shohamId)?.home === "app", 5000, "the home");
    await sh.reload();
    await sh.getByRole("button", { name: "הגדרות" }).waitFor({ timeout: 10_000 });
    check("C6. the home sheet once: saved on her row, not asked again", (await homeSheet.count()) === 0);

    /* ── 14 (part). Settings: the new-card limit at 5 ── */
    await sh.getByRole("button", { name: "הגדרות" }).click();
    const settings = sh.locator(".a-sheet", { hasText: "הגדרות כרטיסיות" });
    await settings.getByText("ההגדרות שלך בלבד, בכל המכשירים.").waitFor();
    a11y.push(...(await snap(sh, out, "cards-9-settings")));
    for (let i = 0; i < 3; i++) await settings.getByRole("button", { name: "פחות חדשות ביום" }).click();
    await until(() => m.settings.get(shohamId)?.new_per_day === 5, 5000, "the settings row");
    await sh.keyboard.press("Escape");
    await sh.getByText("חדשות היום, מתוך 5").waitFor();
    a11y.push(...(await snap(sh, out, "cards-1-today")));

    /* ── 8. A review session on the lecture ── */
    await sh.goto(mock.base + `/?v=cards&s=l.${L}`);
    await sh.getByRole("button", { name: "להציג תשובה" }).waitFor();
    a11y.push(...(await snap(sh, out, "cards-8-front", { primary: ".review .ph-foot .a-btn.primary" })));
    await sh.getByRole("button", { name: "להציג תשובה" }).click();
    const buttons = sh.locator(".card-btn");
    await buttons.first().waitFor();
    const boxes = await buttons.evaluateAll((els) => els.map((e) => ({ word: e.firstElementChild.textContent, ivl: e.querySelector(".ivl").textContent, label: e.getAttribute("aria-label"), x: e.getBoundingClientRect().x, h: e.getBoundingClientRect().height })));
    const easyDays = Number((/^(\d+) ימים$/.exec(boxes[3].ivl) ?? [])[1]);
    check(
      "8. the buttons: שוב 1 דק׳ · קשה 6 דק׳ · טוב 10 דק׳ · קל about 8 ימים, right to left, each ≥ 44 px",
      boxes.map((b) => b.word).join() === "שוב,קשה,טוב,קל" &&
        boxes.slice(0, 3).map((b) => b.ivl).join() === "1 דק׳,6 דק׳,10 דק׳" &&
        easyDays >= 6 && easyDays <= 10 &&
        boxes[0].x > boxes[1].x && boxes[1].x > boxes[2].x && boxes[2].x > boxes[3].x &&
        boxes.every((b) => b.h >= 44) &&
        boxes[2].label === "טוב: הכרטיסייה תחזור בעוד 10 דקות" &&
        (await sh.evaluate(() => document.activeElement?.classList.contains("good"))),
      JSON.stringify(boxes),
    );
    a11y.push(...(await snap(sh, out, "cards-8-back", { primary: ".review .card-btn.good" })));

    /* ── 9. טוב → the next card; the review as sent; שוב comes back after 4 cards ── */
    const frontNow = () => sh.locator(".card-front").first().innerText();
    const shown = [await frontNow()];
    await sh.getByRole("button", { name: /^טוב:/ }).click();
    await until(() => m.reviews.length === 1, 5000, "the first review");
    const r1 = m.reviews[0];
    const s1 = m.states.get(`${shohamId}:${r1.card_id}`);
    check("9. the outbox sent study_card_review: prev reps 0, the next state learning", r1.state_before === 0 && s1.state === 1 && s1.reps === 1, JSON.stringify({ r1, s1 }));
    const answerWith = async (word) => {
      await sh.getByRole("button", { name: "להציג תשובה" }).click();
      await sh.getByRole("button", { name: new RegExp(`^${word}:`) }).click();
    };
    shown.push(await frontNow());
    await answerWith("שוב"); // card 2: back after four cards
    for (let i = 0; i < 4; i++) {
      shown.push(await frontNow());
      await answerWith("טוב");
    }
    shown.push(await frontNow());
    check("9. 'שוב' brings the card back after 4 cards", shown[6] === shown[1] && new Set(shown.slice(2, 6)).size === 4 && !shown.slice(2, 6).includes(shown[1]), JSON.stringify(shown));

    /* ── 10. Swipes: 60% left answers טוב; 10% springs back; vertical answers nothing; never from the edge ── */
    const answered = () => m.reviews.length + (m.undone?.length ?? 0);
    const drained = () => sh.evaluate((u) => (localStorage.getItem(`study-cards-outbox:${u}`) || "[]") === "[]", shohamId);
    await until(drained, 10_000, "the answers so far sent");
    await sh.getByRole("button", { name: "להציג תשובה" }).click();
    await sh.locator(".card-btn").first().waitFor();
    const stage = await sh.locator(".card-stage").boundingBox();
    const y = stage.y + stage.height / 2;
    const vw = sh.viewportSize().width;
    const drag = async (x0, x1, y0 = y, y1 = y, rest = 0) => {
      await sh.mouse.move(x0, y0);
      await sh.mouse.down();
      await sh.mouse.move(x1, y1, { steps: 12 });
      if (rest) await sh.waitForTimeout(rest);
      await sh.mouse.up();
      await sh.waitForTimeout(400);
    };
    let n0 = answered();
    await drag(vw / 2, vw / 2 - 0.1 * vw, y, y, 250);
    const stillBack = (await sh.locator(".card-btn").count()) === 4;
    await drag(vw / 2, vw / 2 + 4, y - 120, y + 140);
    const stillBack2 = (await sh.locator(".card-btn").count()) === 4;
    await drag(10, 10 + 0.6 * vw);
    await drag(vw - 10, vw - 10 - 0.6 * vw);
    const stillBack3 = (await sh.locator(".card-btn").count()) === 4 && answered() === n0;
    await drag(vw / 2 + 0.2 * vw, vw / 2 - 0.4 * vw);
    await until(() => answered() === n0 + 1, 5000, "the swipe's answer");
    const swiped = m.reviews[m.reviews.length - 1];
    check("10. 10% springs back; a vertical drag and a drag from 10 px off the edge answer nothing; 60% left is טוב", stillBack && stillBack2 && stillBack3 && swiped.rating === 3, JSON.stringify({ stillBack, stillBack2, stillBack3, rating: swiped.rating }));

    /* ── 11. Undo: the last card again, unanswered ── */
    n0 = m.reviews.length;
    const lastId = swiped.id;
    await sh.getByRole("button", { name: "ביטול התשובה האחרונה" }).click();
    await sh.getByText("התשובה בוטלה.").waitFor();
    await sh.getByRole("button", { name: "להציג תשובה" }).waitFor();
    check("11. undo: study_card_undo, the card shown again, unanswered", m.reviews.length === n0 - 1 && (m.undone ?? []).includes(lastId) && (await frontNow()) === m.cards.find((c) => c.id === swiped.card_id).front.replace(/\{\{.*\}\}/, "[…]"));

    /* ── 12. Offline: three answers wait, then arrive in order, once each ── */
    const ctxSh = sh.context();
    m.offline = true;
    await ctxSh.setOffline(true);
    const waitingIds = [];
    for (let i = 0; i < 3; i++) {
      await sh.getByRole("button", { name: "להציג תשובה" }).click();
      await sh.getByRole("button", { name: /^טוב:/ }).click();
    }
    await sh.getByText("אין חיבור. התשובות נשמרות במכשיר ויישלחו כשהחיבור יחזור.").waitFor();
    await sh.getByText("3 ממתינות לשליחה").waitFor();
    for (const r of await sh.evaluate((u) => JSON.parse(localStorage.getItem(`study-cards-outbox:${u}`) || "[]"), shohamId)) waitingIds.push(r.id);
    a11y.push(...(await snap(sh, out, "cards-12-offline", { primary: ".review .ph-foot .a-btn.primary" })));
    m.offline = false;
    await ctxSh.setOffline(false);
    await until(() => waitingIds.length === 3 && waitingIds.every((id) => m.reviewOrder.includes(id)), 40_000, "the three waiting answers");
    const order = waitingIds.map((id) => m.reviewOrder.indexOf(id));
    check("12. back online: the three answers arrive in order, once each", order[0] < order[1] && order[1] < order[2] && waitingIds.every((id) => m.reviewCalls.get(id) === 1), JSON.stringify({ order, calls: waitingIds.map((id) => m.reviewCalls.get(id)) }));

    /* ── 14. The end of the session ── */
    await sh.getByRole("button", { name: "עוד פעולות" }).click();
    await sh.getByRole("button", { name: "סיום החזרה" }).click();
    await sh.getByRole("heading", { name: /^סיום (החזרה|להיום)$/ }).waitFor();
    await sh.getByText("גלוי רק לך.").waitFor();
    const endText = await sh.locator(".review-end").innerText();
    check("14. the end: the numbers, private, tomorrow", /\d+ כרטיסיות · \d+ נזכרו · \d+ ״שוב״ · \d+ דק׳/.test(endText) && /מחר: \d+ לחזרה\./.test(endText), endText);
    a11y.push(...(await snap(sh, out, "cards-14-end")));
    // A new day's limit: five new cards are seen, and the rest wait for "עוד 10 חדשות להיום".
    await sh.goto(mock.base + "/?v=cards");
    await sh.getByText("חדשות היום, מתוך 5").waitFor();
    await sh.goto(mock.base + `/?v=cards&l=${L}`);
    await sh.getByRole("button", { name: "הוספת כרטיסייה" }).click();
    const add = sh.locator(".a-sheet", { hasText: "כרטיסייה חדשה" });
    await add.getByText("כרטיסייה שנוספת ידנית מסומנת בשם מי שהוסיף אותה.").waitFor();
    await add.getByRole("radio", { name: "השלמה" }).click();
    const sentence = add.locator("label", { hasText: "משפט" }).locator("textarea");
    await sentence.fill("Spironolactone היא mineralocorticoid receptor antagonist.");
    await sentence.evaluate((el) => el.setSelectionRange(el.value.indexOf("mineralocorticoid"), el.value.indexOf(".")));
    await add.getByRole("button", { name: "סימון החלק להשלמה" }).click();
    await add.getByText("תצוגה: Spironolactone היא […].").waitFor();
    // The mark puts the caret back in the sentence on the next frame; on a busy machine that frame can
    // land after the next fill has focused another field and steal its keystrokes. Wait for it first.
    await sh.waitForFunction((el) => document.activeElement === el, await sentence.elementHandle(), { timeout: 5000 });
    await add.locator("label", { hasText: "שקפים" }).locator("input").fill("12");
    a11y.push(...(await snap(sh, out, "cards-6-add")));
    await add.getByRole("button", { name: "שמירה" }).click();
    await until(() => m.cards.some((c) => c.source === "member"), 10_000, "the member's card");
    const mineCard = m.cards.find((c) => c.source === "member");
    check("6. the cloze was marked from the selection", mineCard.front === "Spironolactone היא {{mineralocorticoid receptor antagonist}}." && mineCard.kind === "cloze" && mineCard.slides.join() === "12", JSON.stringify(mineCard));
    await until(async () => (await deckCount(sh)) === 6, 10_000, "the member's card in the deck");
    await openParts(sh);
    await row(sh, "Spironolactone היא").getByText("נוספה ע״י שוהם").waitFor({ timeout: 10_000 });
    check("6. a member's own card, its cloze marked from the selection, 'נוספה ע״י שוהם'", true);
    await sh.getByRole("button", { name: "להתחיל מחדש" }).click();
    await sh.getByText("להתחיל את כל הכרטיסיות של ההרצאה מההתחלה? היסטוריית החזרות נשמרת.").waitFor();
    await sh.locator(".confirm").getByRole("button", { name: "להתחיל מחדש" }).click();
    await until(() => [...m.states.values()].filter((s) => s.user_id === shohamId).length === 0, 5000, "the reset");
    await sh.goto(mock.base + `/?v=cards&s=l.${L}`);
    await sh.getByRole("heading", { name: /^סיום / }).waitFor({ timeout: 10_000 });
    await sh.getByText(/נשארו \d+ חדשות\. המגבלה היא 5 חדשות ביום\./).waitFor();
    a11y.push(...(await snap(sh, out, "cards-14-limit")));
    await sh.getByRole("button", { name: "עוד 10 חדשות להיום" }).click();
    await sh.getByRole("button", { name: "להציג תשובה" }).waitFor();
    check("14. the new-card limit: 'נשארו … חדשות' and 'עוד 10 חדשות להיום' goes on", true);
    // One card answered שוב: in learning, due within minutes, so Shoham's own chip counts it.
    await answerWith("שוב");
    await until(async () => (await sh.evaluate((u) => localStorage.getItem(`study-cards-outbox:${u}`) || "[]", shohamId)) === "[]", 10_000, "the last answer sent");

    /* ── 13. Privacy: each sees their own numbers; nobody reads another's ── */
    await sh.goto(mock.base + "/?v=library");
    await no.goto(mock.base + "/?v=library");
    const chipOf = (p) => p.locator(".lc", { hasText: "משתנים (Diuretics)" }).locator(".lc-chips a").last();
    await chipOf(no).waitFor({ timeout: 10_000 });
    await chipOf(sh).waitFor({ timeout: 10_000 });
    const noaChip = (await chipOf(no).innerText()).trim();
    const shChip = (await chipOf(sh).innerText()).trim();
    const noaPrivate = db.calls.filter((c) => c.startsWith("נועה") && /study_card_(states|reviews|settings)/.test(c));
    const leaks = noaPrivate.filter((c) => c.includes(shohamId));
    const frames = await joins();
    const privateBindings = frames.filter((f) => /phx_join/.test(f.payload) && /study_card_(states|reviews|settings)/.test(f.payload));
    const deckJoins = frames.filter((f) => /"table":"study_cards"/.test(f.payload));
    check(
      "13. Noa's chip counts the deck (she answered nothing); Shoham's is her own; no read of another's rows; no Realtime on private tables",
      noaChip === "6 כרטיסיות" && /^\d+ לחזרה$/.test(shChip) && leaks.length === 0 && m.denied.length === 0 && privateBindings.length === 0 && deckJoins.length > 0,
      JSON.stringify({ noaChip, shChip, leaks, denied: m.denied, privateBindings: privateBindings.length, deckJoins: deckJoins.length, joins: frames.length }),
    );
    a11y.push(...(await snap(no, out, "cards-13-library")));

    /* ── C's end under review (CS-4): Noa's private cards from her mistakes, first among the new,
       with their origin chips; the next one announced; a card a correction marked left out ── */
    const c2Card = m.cards.find((c) => c.front === c2);
    c2Card.stale_at = new Date(Date.now() + m.offset).toISOString();
    mock.notify("study_cards", "UPDATE", { ...c2Card });
    const mistake1 = cardsPlugin.mistakeCard(db, noaId, {
      lecture_id: L, part_idx: 0, anchor: 1, origin: "practice", front: "מה מנגנון הספיגה במקטע הראשון של הנפרון?", back: "ספיגה של Na+ בצינורית הקרובה.", extra: "ענית Loop of Henle, אבל שם נספג רק כרבע.", slides: [2],
    });
    const mistake2 = cardsPlugin.mistakeCard(db, noaId, {
      lecture_id: L, part_idx: 1, anchor: null, origin: "quiz", front: "איזו תרופה גורמת ל-hyperchloremic metabolic acidosis?", back: "Acetazolamide.", extra: "ענית Furosemide, אבל היא גורמת ל-alkalosis.", slides: [5],
    });
    // Noa adds two parts: the marked card's (part 1) and another written one.
    const other = m.cards.find((c) => !c.deleted_at && !c.stale_at && c.source === "ai" && c.part_idx > 1);
    const noaParts = [1, other.part_idx];
    await no.goto(mock.base + `/?v=cards&l=${L}`);
    await openParts(no);
    for (const pi of noaParts) await no.locator(`.deck-part[data-part="${pi}"]`).getByRole("button", { name: "להוסיף" }).click();
    await until(() => noaParts.every((pi) => m.adoptions.some((a) => a.user_id === noaId && a.part_idx === pi)), 5000, "Noa's two parts");
    await no.goto(mock.base + `/?v=cards&s=l.${L}`);
    const noaHome = no.locator(".a-sheet", { hasText: "איפה חוזרים על הכרטיסיות?" });
    await noaHome.waitFor({ timeout: 10_000 });
    await noaHome.getByRole("button", { name: "שמירה" }).click();
    await noaHome.waitFor({ state: "detached" });
    await no.getByRole("button", { name: "להציג תשובה" }).waitFor();
    const front1 = (await no.locator(".card-front").first().innerText()).trim();
    const badge1 = (await no.locator(".card-panel .card-badge").innerText()).trim();
    const nextLine = no.locator(".next-mine");
    await nextLine.getByText("הבא בתור · מטעות שלך").waitFor();
    const nextOrigin = (await nextLine.locator(".a-chip").innerText()).trim();
    a11y.push(...(await snap(no, out, "cards-c1-mine", { primary: ".review .ph-foot .a-btn.primary" })));
    check(
      "CS-4. a private card from a practice mistake comes first among the new, with its origin; the next one is announced",
      front1 === mistake1.front && badge1 === "מטעות שלך · מהתרגול" && nextOrigin === "מהמבחן הקבוצתי" && m.settings.get(noaId)?.home === "app",
      JSON.stringify({ front1, badge1, nextOrigin, home: m.settings.get(noaId) }),
    );
    await no.getByRole("button", { name: "להציג תשובה" }).click();
    await no.locator(".card-source").getByText("מאיפה זה?").waitFor({ timeout: 10_000 });
    a11y.push(...(await snap(no, out, "cards-c1-back", { primary: ".review .card-btn.good" })));
    await no.getByRole("button", { name: /^טוב:/ }).click();
    await until(() => m.myReviews.some((r) => r.card_id === mistake1.id && r.user_id === noaId), 5000, "the private card's answer");
    // The rest: the second private card, then part 1's cards but the marked one.
    const seen = [mistake1.front];
    for (let i = 0; i < 30; i++) {
      if (!(await no.getByRole("button", { name: "להציג תשובה" }).count())) break;
      seen.push((await no.locator(".card-front").first().innerText()).trim());
      await no.getByRole("button", { name: "להציג תשובה" }).click();
      await no.getByRole("button", { name: /^טוב:/ }).click();
      await no.waitForTimeout(150);
    }
    const noaGroup = m.reviews.filter((r) => r.user_id === noaId).map((r) => m.cards.find((c) => c.id === r.card_id)?.front);
    check(
      "CS-4. the private cards' answers go to study_my_card_review; the marked card stays out of the session; only her two parts are new for her",
      m.myReviews.filter((r) => r.user_id === noaId).length >= 2 &&
        seen[1] === mistake2.front &&
        !noaGroup.includes(c2) &&
        noaGroup.length >= 1 &&
        noaGroup.every((x) => noaParts.includes(m.cards.find((c) => c.front === x)?.part_idx)),
      JSON.stringify({ seen, noaGroup, mine: m.myReviews.length }),
    );
    // "עדיין נכון" on the deck brings it back.
    await no.goto(mock.base + `/?v=cards&l=${L}`);
    await expand(no, c2);
    await row(no, c2).getByRole("button", { name: "עדיין נכון" }).click();
    await until(() => c2Card.stale_at === null, 5000, "the mark cleared");

    /* ── 15 (rest). The budget: the sheet says so; a 402 ends the round at once ── */
    await sh.goto(mock.base + `/?v=cards&l=${L}`);
    db.spent = 33;
    await sh.getByRole("button", { name: "עוד כרטיסיות" }).click();
    const more = sh.locator(".a-sheet", { hasText: "עוד כרטיסיות" });
    await more.getByText("הקבוצה הגיעה לתקרת התקציב של החודש.").waitFor();
    check("15. at the cap the sheet says so and 'ליצור' is off", await more.getByRole("button", { name: "ליצור" }).isDisabled());
    a11y.push(...(await snap(sh, out, "cards-15-budget")));
    await sh.keyboard.press("Escape");
    db.spent = 12.4;
    m.budget = true;
    const calls0 = m.api.length;
    await sh.getByRole("button", { name: "עוד כרטיסיות" }).click();
    await more.getByText(/כ-1 כרטיסיות נוספות/).waitFor();
    await more.getByRole("button", { name: "ליצור" }).click();
    await sh.locator(".a-toast", { hasText: "הקבוצה הגיעה לתקרת התקציב של החודש." }).waitFor({ timeout: 10_000 });
    await sh.waitForTimeout(1500);
    check("15. a 402 ends the round: one request, nothing loops", m.api.length === calls0 + 1 && m.api[calls0].status === 402, JSON.stringify(m.api.slice(calls0)));
    m.budget = false;

    /* ── 16. Dark mode: K2, K4 front and back, K5 (each snap above ran light and dark too) ── */
    const { page: dark } = await openAt("נועה", `/?v=cards&s=l.${L}`, { colorScheme: "dark" });
    await dark.getByRole("button", { name: "להציג תשובה" }).waitFor();
    await dark.screenshot({ path: path.join(out, "cards-16-dark-front.png") });
    await dark.getByRole("button", { name: "להציג תשובה" }).click();
    await dark.locator(".card-btn").first().waitFor();
    const words = await dark.locator(".card-btn").evaluateAll((els) => els.map((e) => e.firstElementChild.textContent).join());
    await dark.screenshot({ path: path.join(out, "cards-16-dark-back.png") });
    a11y.push(...(await snap(dark, out, "cards-16-dark", { primary: ".review .card-btn.good", scheme: "dark" })));
    check("16. dark: the buttons keep their words", words === "שוב,קשה,טוב,קל", words);

    /* ── the ledger: one reservation and one settle per mocked model call ── */
    const reserves = db.calls.filter((c) => /^cards rpc study_reserve .*"p_key":"server-key".*"p_kind":"cards"/.test(c));
    const settles = db.calls.filter((c) => /^cards rpc study_settle .*"p_key":"server-key"/.test(c));
    const modelCalls = m.api.filter((x) => x.status === 200 || String(x.status).startsWith("error")).length;
    check("ledger: one study_reserve and one study_settle per model call, with the key, kind cards, ref the batch", reserves.length === modelCalls && settles.length === modelCalls, JSON.stringify({ reserves: reserves.length, settles: settles.length, modelCalls }));
  } catch (e) {
    steps.error = String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e);
    if (sh) await sh.screenshot({ path: path.join(out, "cards-error-shoham.png") }).catch(() => undefined);
    if (no) await no.screenshot({ path: path.join(out, "cards-error-noa.png") }).catch(() => undefined);
  } finally {
    await browser.close();
    await mock.close();
    const problems = [...new Set(mock.problems)];
    const failed = Object.values(steps).filter((v) => v !== "ok").length + (steps.error ? 0 : 0);
    console.log(JSON.stringify({ flags: flagSet, steps, a11y, problems }, null, 1));
    process.exit(failed || a11y.length || problems.length ? 1 : 0);
  }
})();
