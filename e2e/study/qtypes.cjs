// Question types end to end (docs/study/question-types.md), against the mock
// (e2e/study/mocks/practice.cjs): "שאלות חדשות" with its two chip groups and
// the defaults (label on, since slide 3's picture has its labels); a request
// written in every type, read-only in the bank, the staged case one card,
// kept whole; a round of נכון / לא נכון (the verdict "✗ טעות · 2 מתוך 3 ·
// ׳נראה לי׳", the bet sent), התאמה by taps and by the keyboard (✕ gives a
// chip back), סידור by taps and ↑ ↓, a label by its number (no other label's
// name in the page before the answer, the pins and the "מספר N" radios), a
// label by its name (the asked pin ringed), a picture question (the picture
// loads from its signed URL), a staged case (step 2 after step 1, "שלב 2
// מתוך 2", the story so far folded), a set question asked again in "הטעויות
// שלי", 360 px without sideways scroll, light and dark through a11y.cjs, and
// "לסמן תוויות בשרטוטים" on a lecture without labels (the fixture deck picked
// again: 5 labels for slide 3's picture). On a build without the flag (w5x):
// no new chips, and no question of a new type is ever asked.
//
//   NODE_PATH=$(npm root -g) E2E_FLAGS=prod node e2e/study/qtypes.cjs <dist> <out dir>   (prod, s1, s2 or w5x)
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const plugin = require("./mocks/practice.cjs");
const { makePptx } = require("./fixtures/make-pptx.cjs");

const [dist, out] = process.argv.slice(2);
const flagSet = flagSetOf().set;
if (!dist || !out || !["prod", "s1", "s2", "w5x"].includes(flagSet)) {
  console.error("usage: E2E_FLAGS=prod|s1|s2|w5x node e2e/study/qtypes.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const on = flagSetOf().qtypes;
const PRIMARY = ".ph-foot .a-btn.primary";
const L3 = "eeeeeeee-0000-4000-8000-000000000033";
const GEO = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "nephron-geo.json"), "utf8"));
const norm = (s) => String(s).replace(/[‎‏⁦-⁩]/g, "").replace(/\s+/g, " ").trim();

(async () => {
  const mock = await createMock({ dist, plugins: [plugin], flags: flagSet });
  const { db, LECTURE_ID: L } = mock;
  const P = db.practice;
  mock.seedLecture();
  const browser = await chromium.launch();
  const steps = {};
  const a11y = [];
  const check = (name, ok, detail) => {
    steps[name] = ok === true ? "ok" : `FAIL ${detail ?? ""}`;
  };
  const shot = async (page, name, o = {}) => a11y.push(...(await snap(page, out, name, o)));
  const until = async (fn, ms = 15000, what = "condition") => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const verdict = async (page) => norm(await page.locator(".pq-verdict h2").innerText({ timeout: 10000 }));
  const bet = (page, words) => page.locator(".pq-bets").getByRole("radio", { name: words, exact: true }).click();
  /** A round of one type group from "סבב חדש". */
  const round = async (page, group) => {
    await page.goto(`${mock.base}/?v=practice&l=${L}&x=round`);
    await page.locator(".pr-types").waitFor({ timeout: 15000 });
    await page.locator(".pr-types").getByRole("radio", { name: group }).click();
    await page.locator(PRIMARY).click();
    await page.locator(".pq").first().waitFor({ timeout: 15000 });
  };
  const next = (page) => page.locator(".pq-next").click();
  // The points of part 0 (slide 3's part): structures and processes, 12 of them, read and current.
  const points = (lectureId) => {
    const sec = db.sections.find((s) => s.lecture_id === lectureId && s.idx === 0);
    for (let i = 0; i < 12; i++)
      P.points.push({
        id: `b0170000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`, lecture_id: lectureId, part_idx: 0, n: i, kind: i % 2 ? "process" : "structure",
        subject: "Nephron", text: `נקודה ${i + 1} על הנפרון`, anchor: i % 3, quote: "", slides: [3], red_flag: false, weight: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    for (const s of db.sections.filter((x) => x.lecture_id === lectureId))
      P.pointParts.set(`${lectureId}:${s.idx}`, { lecture_id: lectureId, part_idx: s.idx, status: "ready", src: s.markdown, lease_until: null, attempts: 0, error: null, updated_at: new Date().toISOString() });
    void sec;
  };

  try {
    if (!on) {
      /* ── w5x: the flag off ── */
      points(L);
      plugin.seedTypes(db, L, GEO);
      const plainId = "9c000000-0000-4000-8000-000000000001";
      P.questions.push({ ...P.questions[0], id: plainId, style: "case", form: "one", layout: null, figure: "", series: null, step: null, question: "שאלה רגילה על הנפרון?", options: ["א1", "ב2", "ג3", "ד4"] });
      P.keys.set(plainId, { answer: 0, explanations: ["כן [ש' 3]", "לא [ש' 3]", "לא [ש' 3]", "לא [ש' 3]"], takeaway: "", whens: [] });
      const { page } = await mock.open(browser, "שוהם", { path: `/?v=practice&l=${L}&x=new` });
      await page.locator(".pc-styles").waitFor({ timeout: 15000 });
      const chips = await page.locator(".pc-styles button").allInnerTexts();
      check("w5x 1 no new type chips without the flag", !(await page.locator(".pc-types").count()) && !chips.some((t) => /תמונה|התאמה|סידור|נכון \/ לא נכון|בשלבים/.test(t)), JSON.stringify(chips));
      await page.goto(`${mock.base}/?v=practice&l=${L}&s=l.${L}&n=all`);
      await page.locator(".pq").first().waitFor({ timeout: 15000 });
      const pos = norm(await page.locator(".pq-pos").innerText());
      const lead = norm(await page.locator(".pq-lead").innerText());
      check("w5x 2 a session asks the plain question only; seeded new types never", pos === "1/1" && lead === "שאלה רגילה על הנפרון?", `${pos} ${lead}`);
      const selects = mock.calls.filter((c) => /study_questions/.test(c) && /form|layout/.test(c));
      check("w5x 3 the types' columns are never read", selects.length === 0, JSON.stringify(selects.slice(0, 2)));
    } else {
      /* ── 1. שאלות חדשות: two groups, the defaults, a request of every type, read-only in the bank ── */
      points(L);
      const { page } = await mock.open(browser, "שוהם", { path: `/?v=practice&l=${L}&x=new` });
      await page.locator(".pc-types").waitFor({ timeout: 15000 });
      await until(async () => (await page.locator(".pc-types button[aria-pressed=true]").count()) > 0, 10000, "the defaults");
      const pressed = async (sel) => (await page.locator(`${sel} button[aria-pressed=true]`).allInnerTexts()).map((t) => norm(t.replace("✓", "")));
      const mcq = await pressed(".pc-styles");
      const types = await pressed(".pc-types");
      const labelOn = !(await page.locator(".pc-types button", { hasText: "סימון על תמונה" }).isDisabled());
      check(
        "1a both chip groups; the defaults for the part (case, נכון / לא נכון, התאמה, סידור, סימון על תמונה, מקרה בשלבים); label enabled",
        mcq.join(",") === "מקרה קליני" && types.join(",") === "סימון על תמונה,מקרה קליני בשלבים,נכון / לא נכון,התאמה,סידור" && labelOn,
        JSON.stringify({ mcq, types, labelOn }),
      );
      const why = await page.locator(".pc-why").allInnerTexts();
      check("1b every type this part can have is on offer, with no reason line (its picture has labels)", why.length === 0 && !(await page.locator(".pc-geo").count()), JSON.stringify(why));
      await shot(page, "qtypes-01-create", { primary: PRIMARY });
      await page.locator(PRIMARY).click(); // "המשך: דוגמה ומיקוד"
      await page.waitForURL(/x=example/, { timeout: 15000 });
      await page.locator(PRIMARY, { hasText: "ליצור" }).click();
      await page.waitForURL(/x=bank/, { timeout: 15000 });
      await until(async () => (await page.locator(".pb-draft").count()) >= 5 && !(await page.locator(".pb-more").count()), 40000, "every draft");
      await until(async () => !(await page.locator(".pb-verdict", { hasText: /נבדקת|בבדיקה/ }).count()), 15000, "every check");
      const cards = await page.locator(".pb-draft").evaluateAll((els) =>
        els.map((e) => ({ style: e.querySelector(".pb-style")?.textContent, steps: e.querySelectorAll(".pb-step").length, figure: Boolean(e.querySelector(".qfig")), reword: [...e.querySelectorAll("button")].some((b) => b.textContent.includes("לנסח")) })),
      );
      const byStyle = Object.fromEntries(cards.map((c) => [c.style, c]));
      check(
        "1c every type's draft read-only in the bank; the staged case one card of 2 steps without לנסח מחדש; the label with its picture",
        ["נכון / לא נכון", "התאמה", "סידור", "סימון על תמונה", "מקרה קליני בשלבים"].every((s) => byStyle[s]) &&
          byStyle["מקרה קליני בשלבים"].steps === 2 &&
          !byStyle["מקרה קליני בשלבים"].reword &&
          byStyle["סימון על תמונה"].figure,
        JSON.stringify(cards),
      );
      await page.locator(".qfig img, .qfig svg").first().waitFor({ timeout: 10000 });
      await shot(page, "qtypes-02-bank", { primary: PRIMARY });
      const keepWords = (await page.locator(".pb-keep-all").innerText()).trim();
      check("1c2 the bank's button counts cards, a staged case once (review QT-10)", keepWords === `להוסיף ${cards.length} לבנק`, `${keepWords} · ${cards.length} cards`);
      await page.locator(".pb-keep-all").click();
      await until(async () => P.drafts.filter((d) => d.status === "pending").length === 0, 15000, "keep all");
      const kept = P.questions.filter((q) => q.series);
      check("1d keep all: the staged case is kept whole, its 2 steps in one series", kept.length === 2 && kept[0].series === kept[1].series && kept.map((q) => q.step).sort().join() === "1,2", JSON.stringify(kept.map((q) => [q.series, q.step])));
      // From here, a clean bank of one question of each type.
      P.questions.length = 0;
      P.keys.clear();
      const ids = plugin.seedTypes(db, L, GEO);

      /* ── 2. נכון / לא נכון ── */
      await round(page, "נכון / לא נכון");
      await page.locator(".qt-tf").waitFor({ timeout: 10000 });
      await shot(page, "qtypes-03-tf", { primary: PRIMARY });
      const rows = page.locator(".qt-tf .qt-row");
      for (let i = 0; i < 3; i++) await rows.nth(i).getByRole("radio", { name: "נכון", exact: true }).click();
      await bet(page, "נראה לי");
      await page.locator(PRIMARY).click();
      const v2 = await verdict(page);
      const whys = await page.locator(".qt-done .qt-row .qt-mark").allInnerTexts();
      const sent = P.answers.filter((a) => a.question_id === ids.tf).pop();
      check(
        "2 tf: the verdict counts the right statements, every statement shows its why, the bet is sent",
        v2 === "✗ טעות · 2 מתוך 3 · ׳נראה לי׳" && whys.length === 3 && whys.some((w) => w.includes("סימנת נכון, אבל המשפט לא נכון")) && sent?.confidence === 2 && JSON.stringify(sent?.choices) === "[1,1,1]",
        JSON.stringify({ v2, whys, sent }),
      );
      await shot(page, "qtypes-04-tf-answered", { primary: ".pq-next" });

      /* ── 3. התאמה: taps, ✕, the keyboard ── */
      await round(page, "התאמה");
      await page.locator(".qt-match").waitFor({ timeout: 10000 });
      const slot = (i) => page.locator(".qt-slot").nth(i);
      const chip = (t) => page.locator(".qt-bank .qt-chip", { hasText: new RegExp(`^${t}$`) });
      await slot(0).click();
      await chip("ENaC").click();
      const placedWrong = norm(await slot(0).innerText());
      await page.locator(".qt-clear").first().click();
      const back = await chip("ENaC").count();
      check("3a a chip placed by taps, and ✕ gives it back to the bank", placedWrong === "ENaC" && back === 1, `${placedWrong} ${back}`);
      await slot(0).click();
      await chip("NKCC2").click();
      await chip("NCC").click(); // a chip first: it waits for a slot
      await slot(1).click();
      // The third by the keyboard only: focus its slot, Enter, Tab to the chip, Enter.
      await slot(2).focus();
      await page.keyboard.press("Enter");
      for (let t = 0; t < 12; t++) {
        const f = await page.evaluate(() => document.activeElement?.textContent?.trim());
        if (f === "ENaC") break;
        await page.keyboard.press("Tab");
      }
      await page.keyboard.press("Enter");
      const placed = await page.locator(".qt-slot").allInnerTexts();
      const live = norm(await page.locator(".qt-match [aria-live]").innerText());
      check("3b by taps and by the keyboard; the live line says what was placed", placed.map(norm).join(",") === "NKCC2,NCC,ENaC" && live === "ENaC שובץ ליד Amiloride", JSON.stringify({ placed, live }));
      await shot(page, "qtypes-05-match", { primary: PRIMARY });
      await bet(page, "על בטוח");
      await page.locator(PRIMARY).click();
      check("3c the match answered right", (await verdict(page)) === "✓ נכון · ׳על בטוח׳", await verdict(page));

      /* ── 4. סידור: taps and ↑ ↓ ── */
      await round(page, "סידור");
      await page.locator(".qt-order").waitFor({ timeout: 10000 });
      for (const t of ["Glomerulus", "Loop of Henle", "Proximal tubule", "Collecting duct"]) await page.locator(".qt-order .qt-bank .qt-chip", { hasText: t }).click();
      const focusOf = () => page.evaluate(() => document.activeElement?.getAttribute("data-f") ?? document.activeElement?.tagName ?? "");
      const afterAdd = await focusOf();
      await page.getByRole("button", { name: "להזיז למעלה: Proximal tubule" }).click();
      const afterUp = await focusOf();
      const orderLive = norm(await page.locator(".qt-order [aria-live]").innerText());
      check(
        "4k focus stays on the list (review F2): the pool's last step added → its ✕; ↑ → the same step's ↑ at its new place; a live line says it",
        /^out-\d+$/.test(afterAdd) && /^up-\d+$/.test(afterUp) && orderLive === "Proximal tubule הוזז למקום 2",
        JSON.stringify({ afterAdd, afterUp, orderLive }),
      );
      const order = (await page.locator(".qt-placed .qt-step .qt-text").allInnerTexts()).map(norm);
      check("4a steps added by taps, one moved up", order.join(",") === "Glomerulus,Proximal tubule,Loop of Henle,Collecting duct", JSON.stringify(order));
      await shot(page, "qtypes-06-order", { primary: PRIMARY });
      await bet(page, "נראה לי");
      await page.locator(PRIMARY).click();
      check("4b the order answered right", (await verdict(page)) === "✓ נכון · ׳נראה לי׳", await verdict(page));

      /* ── 5-7. pictures: a label by its name, a label by its number, a picture question ── */
      await round(page, "שאלות על תמונה");
      // 6. name mode first (seeded first): numbered pins, the asked one ringed.
      await page.locator(".qfig .qf-pin").first().waitFor({ timeout: 10000 });
      const pins = await page.locator(".qfig .qf-pin").count();
      const asked = await page.locator(".qfig .qf-pin.asked").count();
      check("6 label by its name: 5 numbered pins, the asked pin ringed", pins === 5 && asked === 1, `${pins} ${asked}`);
      await shot(page, "qtypes-07-label-name", { primary: PRIMARY });
      await page.locator(".pq-options button.a-opt", { hasText: "Loop of Henle" }).click();
      await bet(page, "על בטוח");
      await page.locator(PRIMARY).click();
      await verdict(page);
      const legend6 = (await page.locator(".qf-legend li").allInnerTexts()).map(norm);
      const named6 = plugin.pinsOf(GEO).filter((p) => ["Glomerulus", "Loop of Henle", "Collecting duct", "Proximal tubule"].includes(p.label));
      check(
        "6b after the answer the drawing is named under it (review QT-5): every option that is a pin, by its number; no floating name chips",
        legend6.length === 5 && named6.every((p) => legend6[p.n - 1].includes(p.label)) && (await page.locator(".qf-name").count()) === 0,
        JSON.stringify(legend6),
      );
      await shot(page, "qtypes-07b-label-name-answered", { primary: ".pq-next" });
      await next(page);
      // 5. tap mode: no other label's name anywhere before the answer; pins are radios; "מספר N" too.
      await page.locator(".qfig .qf-pins[role=radiogroup]").waitFor({ timeout: 10000 });
      const html = await page.content();
      const leaked = ["Glomerulus", "Proximal tubule", "Distal convoluted tubule", "Collecting duct"].filter((t) => html.includes(t));
      const fallback = await page.locator(".pq-options button.a-opt", { hasText: "מספר 1" }).count();
      check("5a before the answer, no other label's name is in the page; the radio fallback \"מספר 1…5\"", leaked.length === 0 && fallback === 1, JSON.stringify({ leaked, fallback }));
      await shot(page, "qtypes-08-label-tap", { primary: PRIMARY });
      const target = plugin.pinsOf(GEO).find((p) => p.label === "Loop of Henle").n;
      const pinBox = await page.locator(`.qfig .qf-pin[aria-label="מספר ${target}"]`).boundingBox();
      await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2);
      const picked = await page.locator(`.pq-options button.a-opt[aria-checked=true]`).innerText();
      await bet(page, "נראה לי");
      await page.locator(PRIMARY).click();
      const v5 = await verdict(page);
      const names = (await page.locator(".qf-legend li").allInnerTexts()).map(norm);
      check(
        "5b a pin tapped by its place is the answer; after it every pin's name is a numbered list under the picture",
        norm(picked).includes(`מספר ${target}`) && v5 === "✓ נכון · ׳נראה לי׳" && names.length === 5 && plugin.pinsOf(GEO).every((p) => names[p.n - 1].startsWith(`${p.n}`) && names[p.n - 1].includes(p.label)),
        JSON.stringify({ picked, v5, names }),
      );
      await shot(page, "qtypes-09-label-tap-answered", { primary: ".pq-next" });
      await next(page);
      // 7. a picture question: the <img> loads from the signed URL.
      await page.locator(".qf-photo img").waitFor({ timeout: 10000 });
      await until(async () => (await page.locator(".qf-photo img").evaluate((i) => i.complete && i.naturalWidth)) > 0, 10000, "the picture");
      const src = await page.locator(".qf-photo img").getAttribute("src");
      check("7 the picture question's <img> loads from the signed URL", /\/object\/sign\/study\/.*s3-1\.jpg/.test(src ?? ""), src);
      await shot(page, "qtypes-10-image", { primary: PRIMARY });

      /* ── 7b. a picture that does not load (review QT-2): said, nothing answerable, "לדלג"; "לנסות שוב" loads it ── */
      const picPath = `${mock.GROUP.id}/${L}/s3-1.jpg`;
      const picBytes = db.files.get(picPath);
      db.files.delete(picPath);
      await round(page, "שאלות על תמונה");
      await page.locator(".qf-fail").first().waitFor({ timeout: 15000 });
      const failText = norm(await page.locator(".qf-fail").first().innerText());
      const optsOff = await page.locator(".pq-options button.a-opt").evaluateAll((b) => b.every((x) => x.disabled));
      const betsOff = await page.locator(".pq-bets button").evaluateAll((b) => b.every((x) => x.disabled));
      const skip = await page.getByRole("button", { name: "לדלג, בלי שזה ייספר" }).count();
      check("7b a missing picture: \"התמונה לא נטענה\" with \"לנסות שוב\"; no option or bet can be chosen; \"לדלג\" is offered", failText === "התמונה לא נטענה. לנסות שוב" && optsOff && betsOff && skip === 1, JSON.stringify({ failText, optsOff, betsOff, skip }));
      await shot(page, "qtypes-10b-picture-failed", { primary: PRIMARY });
      db.files.set(picPath, picBytes);
      await page.locator(".qf-fail button", { hasText: "לנסות שוב" }).first().click();
      await page.locator(".qfig svg image, .qf-photo img").first().waitFor({ timeout: 10000 });
      const optsOn = await page.locator(".pq-options button.a-opt").evaluateAll((b) => b.some((x) => !x.disabled));
      check("7c \"לנסות שוב\" signs it again and the question opens", optsOn && (await page.locator(".qf-fail").count()) === 0, String(optsOn));
      const answeredBefore = P.answers.length;
      db.files.delete(picPath);
      await round(page, "שאלות על תמונה");
      await page.getByRole("button", { name: "לדלג, בלי שזה ייספר" }).waitFor({ timeout: 15000 });
      const leadBefore = norm(await page.locator(".pq-lead").first().innerText());
      await page.getByRole("button", { name: "לדלג, בלי שזה ייספר" }).click();
      await page.waitForTimeout(600);
      const leadAfter = (await page.locator(".pq-lead").count()) ? norm(await page.locator(".pq-lead").first().innerText()) : "(the session's end)";
      check("7d \"לדלג\" moves on and nothing is counted", P.answers.length === answeredBefore && leadAfter !== leadBefore, JSON.stringify({ counted: P.answers.length - answeredBefore, leadBefore, leadAfter }));
      db.files.set(picPath, picBytes);

      /* ── 7e. pins close together (review QT-1): the stage starts wider in its own scroll box, the pins 32 px apart or more ── */
      // A new label item (never answered, so the round asks it) whose pins stand in a tight column.
      const denseId = "9c000000-0000-4000-8000-0000000000d1";
      const nameQ = P.questions.find((q) => q.id === ids.labelName);
      P.questions.push({ ...nameQ, id: denseId, layout: { ...nameQ.layout, stage: { w: 960, h: 540 }, pins: nameQ.layout.pins.map((p, i) => ({ ...p, x: 0.82, y: 0.2 + 0.07 * i })) } });
      P.keys.set(denseId, { ...P.keys.get(ids.labelName) });
      await page.setViewportSize({ width: 360, height: 740 });
      await round(page, "שאלות על תמונה");
      // The round may start with the picture question: "לא יודעים" until the label item is on screen.
      for (let k = 0; k < 4 && !(await page.locator(".qf-dense").count()); k++) {
        await page.locator(".qfig svg image, .qf-photo img").first().waitFor({ timeout: 10000 });
        if (await page.locator(".qf-dense").count()) break;
        await page.locator(".pq-dont-know").click();
        await next(page);
      }
      await page.locator(".qf-dense .qf-pin").first().waitFor({ timeout: 15000 });
      const gap = await page.locator(".qf-dense .qf-pin").evaluateAll((els) => {
        const c = els.map((e) => e.getBoundingClientRect()).map((r) => [r.x + r.width / 2, r.y + r.height / 2]);
        let m = Infinity;
        for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) m = Math.min(m, Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]));
        return Math.round(m);
      });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      check("7e crowded pins at 360 px: the stage starts zoomed in a scrollable box, pins at least 31 px apart, no sideways page scroll", gap >= 31 && sw <= 360, JSON.stringify({ gap, sw }));
      await shot(page, "qtypes-10c-dense", { primary: PRIMARY });
      await page.setViewportSize({ width: 390, height: 844 });

      /* ── 8. a staged case ── */
      await round(page, "מקרה בשלבים");
      const s1 = norm(await page.locator(".pq-step").innerText());
      await page.locator(".pq-options button.a-opt", { hasText: "Hyperkalemia" }).click();
      await bet(page, "נראה לי");
      await page.locator(PRIMARY).click();
      await verdict(page);
      await next(page);
      const s2 = norm(await page.locator(".pq-step").innerText());
      const folded = await page.locator("details.pq-sofar").count();
      const open = await page.locator("details.pq-sofar").evaluate((d) => d.open);
      check("8 step 2 follows step 1: \"שלב 2 מתוך 2\", the story so far folded under \"המקרה עד כאן\"", s1 === "שלב 1 מתוך 2" && s2 === "שלב 2 מתוך 2" && folded === 1 && !open, JSON.stringify({ s1, s2, folded, open }));
      await shot(page, "qtypes-11-steps", { primary: PRIMARY });

      /* ── 9. a set question asked again among "הטעויות שלי" ── */
      await page.goto(`${mock.base}/?v=practice&s=m.${L}&n=all`);
      await page.locator(".pq").first().waitFor({ timeout: 15000 });
      const again = await page.locator(".qt-tf").count();
      check("9 the tf mistake comes back in \"הטעויות שלי\" as itself, answerable", again === 1, String(again));

      /* ── 10. 360 px: no sideways scroll on the set screens ── */
      await page.setViewportSize({ width: 360, height: 740 });
      const wide = [];
      for (const g of ["התאמה", "סידור", "שאלות על תמונה"]) {
        await round(page, g);
        const w = await page.evaluate(() => document.documentElement.scrollWidth);
        if (w > 360) wide.push(`${g}: ${w}`);
      }
      check("10 at 360×740 no question type scrolls sideways", wide.length === 0, JSON.stringify(wide));
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({ path: path.join(out, "qtypes-12-picture-360-dark.png") });
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 390, height: 844 });

      /* ── 11. "לסמן תוויות בשרטוטים": a lecture whose picture has no labels yet ── */
      const lec = db.lectures.find((l) => l.id === L);
      db.lectures.push({ ...lec, id: L3, title: "משתנים: בלי תוויות", slides: lec.slides.map((s) => ({ ...s, figures: (s.figures ?? []).map(({ geo: _g, ...f }) => ({ ...f, path: f.path.replace(L, L3) })) })) });
      for (const s of db.sections.filter((x) => x.lecture_id === L)) db.sections.push({ ...s, lecture_id: L3 });
      db.files.set(`${mock.GROUP.id}/${L3}/s3-1.jpg`, fs.readFileSync(path.join(__dirname, "fixtures", "nephron.png")));
      await page.goto(`${mock.base}/?l=${L3}`);
      const geoBtn = page.getByRole("button", { name: "לסמן תוויות בשרטוטים" });
      await geoBtn.waitFor({ timeout: 15000 });
      await geoBtn.click();
      const deck = path.join(out, "deck.pptx");
      await makePptx(deck);
      await page.locator(".geo-sheet input[type=file]").setInputFiles(deck);
      await page.getByText("נוספו סימונים ל-1 שרטוטים.").waitFor({ timeout: 20000 });
      const call = (P.geoCalls ?? []).pop();
      check(
        "11 the same file picked again: study_lecture_set_geo gets slide 3's picture with its 5 labels",
        call?.lecture === L3 && call.geo.length === 1 && call.geo[0].n === 3 && call.geo[0].k === 1 && call.geo[0].geo.labels.length === 5,
        JSON.stringify(call?.geo?.map((g) => [g.n, g.k, g.geo.labels.length])),
      );
      await shot(page, "qtypes-13-backfill");
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
