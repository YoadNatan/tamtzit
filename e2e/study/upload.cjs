// Uploading a PDF and a .pptx on a browser like an iPhone's: pdf.js 6 calls
// Map.prototype.getOrInsertComputed, Math.sumPrecise and Uint8Array's base64
// methods and iterates a ReadableStream with for await, which iPhone browsers (all Safari's engine) do not all have yet.
// Before src/study/lib/polyfills.ts every PDF failed there with "לא הצלחתי
// לקרוא את הקובץ". This script removes those features from the page and from
// pdf.js's worker before any script runs, then reads and saves each file;
// it runs the same flow with the browser as it is, too.
//
//   NODE_PATH=$(npm root -g) node e2e/study/upload.cjs <dist> <out dir>
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock, flagSetOf } = require("./mock.cjs");
const { snap } = require("./a11y.cjs");
const { makePptx } = require("./fixtures/make-pptx.cjs");

const [dist, out] = process.argv.slice(2);
if (!dist || !out) {
  console.error("usage: node e2e/study/upload.cjs <dist> <out dir>");
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

// What an iPhone browser may lack (removed from the page and the worker).
const IPHONE = `(() => { for (const [o, k] of [
  [Map.prototype, "getOrInsertComputed"], [Map.prototype, "getOrInsert"],
  [WeakMap.prototype, "getOrInsertComputed"], [WeakMap.prototype, "getOrInsert"],
  [Math, "sumPrecise"], [Uint8Array, "fromBase64"], [Uint8Array, "fromHex"],
  [Uint8Array.prototype, "toBase64"], [Uint8Array.prototype, "toHex"],
]) { try { delete o[k]; } catch {} }
  // Safari cannot iterate a ReadableStream with for await (pdf.js reads a page's text that way).
  try { delete ReadableStream.prototype[Symbol.asyncIterator]; delete ReadableStream.prototype.values; } catch {}
})();`;

(async () => {
  const browser = await chromium.launch();
  const pdf = path.join(out, "deck.pdf");
  {
    const p = await browser.newPage();
    await p.setContent(
      '<h1>Diuretics</h1><p>Loop diuretics: furosemide</p><div style="page-break-after:always"></div><h1>Thiazides</h1><p>Hydrochlorothiazide</p><div style="page-break-after:always"></div><h1>K-sparing</h1><p>Spironolactone</p>',
    );
    await p.pdf({ path: pdf });
    await p.close();
  }
  const pptx = path.join(out, "deck.pptx");
  await makePptx(pptx);

  const results = [];
  const a11y = [];
  let failed = 0;
  for (const iphone of [true, false]) {
    for (const [file, expect] of [
      [pdf, /3 שקפים/],
      [pptx, /20 שקפים/],
    ]) {
      const label = `${iphone ? "iphone" : "browser"} ${path.extname(file)}`;
      const mock = await createMock({ dist, members: [], flags: flagSetOf().set });
      const { page } = await mock.open(browser, null);
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      if (iphone) {
        await page.addInitScript(IPHONE);
        // Only the worker file itself (.mjs): the .js beside it is the module that names its URL.
        await page.route(/pdf\.worker[^/]*\.mjs$/, async (route) => {
          const r = await route.fetch();
          await route.fulfill({ response: r, body: `${IPHONE}\n${await r.text()}`, headers: { ...r.headers(), "content-type": "text/javascript" } });
        });
      }
      try {
        await page.goto(`${mock.base}/?join=ABC123`);
        await page.locator(".code-input").waitFor({ timeout: 10000 });
        await page.getByPlaceholder("למשל: שוהם").fill("שוהם");
        await page.getByRole("button", { name: "הצטרפות" }).click();
        // With Today's set the invite lands on Today; the library is its own tab.
        if (flagSetOf().today) await page.locator(".ph-tabs .ph-tab", { hasText: "ספרייה" }).click();
        await page.getByRole("heading", { name: mock.GROUP.name }).waitFor({ timeout: 10000 });
        await page.evaluate(() => localStorage.setItem("study-privacy-v1", "1"));
        await page.getByRole("button", { name: "העלאת הרצאה ראשונה" }).click();
        if (iphone) {
          const lacks = await page.evaluate(
            () => typeof Map.prototype.getOrInsertComputed === "undefined" && typeof Math.sumPrecise === "undefined" && !(Symbol.asyncIterator in ReadableStream.prototype),
          );
          if (!lacks) throw new Error("the page still has the features this run removes");
        }
        await page.locator('input[type="file"]').setInputFiles(file);
        const ok = page.locator(".drop", { hasText: expect });
        const bad = page.getByText(/לא הצלחתי לקרוא את הקובץ/);
        await Promise.race([ok.waitFor({ timeout: 30000 }), bad.waitFor({ timeout: 30000 })]);
        if (await bad.count()) throw new Error("read failed: לא הצלחתי לקרוא את הקובץ");
        if (iphone && path.extname(file) === ".pdf") a11y.push(...(await snap(page, out, "upload-iphone-pdf", { primary: ".ph-foot .a-btn.primary" })));
        await page.getByRole("button", { name: "יצירת סיכום" }).click();
        await page.waitForURL(/\/\?l=/, { timeout: 60000 });
        const lec = mock.db.lectures[0];
        const files = mock.db.files.size;
        if (!lec || !files) throw new Error("not saved");
        // Question types (set "prod"): slide 3's picture is stored with its 5 labels' geometry (pptxGeo.ts).
        let geoNote = "";
        if (flagSetOf().qtypes && path.extname(file) === ".pptx") {
          const fig = lec.slides.find((s) => s.n === 3)?.figures?.[0];
          const n = fig?.geo?.labels?.length ?? 0;
          if (n !== 5) throw new Error(`slide 3's figure has ${n} labels, not 5`);
          geoNote = ", slide 3's picture with its 5 labels";
        }
        results.push(`ok ${label}: read and saved, ${lec.slides.length} slides, ${files} files${geoNote}`);
      } catch (e) {
        failed++;
        results.push(`FAIL ${label}: ${e.message}${errors.length ? ` (${errors.slice(0, 2).join(" | ")})` : ""}`);
        await page.screenshot({ path: path.join(out, `fail-${label.replace(/\W+/g, "-")}.png`) }).catch(() => undefined);
      }
      await page.close();
      await mock.close?.();
    }
  }
  // A file that is not a PDF: the error, and under it the small print with the build and the step.
  {
    const bad = path.join(out, "broken.pdf");
    fs.writeFileSync(bad, Buffer.from("this is not a pdf at all"));
    const mock = await createMock({ dist, members: [], flags: flagSetOf().set });
    const { page } = await mock.open(browser, null);
    try {
      await page.goto(`${mock.base}/?join=ABC123`);
      await page.locator(".code-input").waitFor({ timeout: 10000 });
      await page.getByPlaceholder("למשל: שוהם").fill("שוהם");
      await page.getByRole("button", { name: "הצטרפות" }).click();
      if (flagSetOf().today) await page.locator(".ph-tabs .ph-tab", { hasText: "ספרייה" }).click();
      await page.getByRole("heading", { name: mock.GROUP.name }).waitFor({ timeout: 10000 });
      await page.evaluate(() => localStorage.setItem("study-privacy-v1", "1"));
      await page.getByRole("button", { name: "העלאת הרצאה ראשונה" }).click();
      await page.locator('input[type="file"]').setInputFiles(bad);
      await page.getByText(/לא הצלחתי לקרוא את הקובץ/).waitFor({ timeout: 30000 });
      const detail = await page.locator(".upload-detail").innerText();
      if (!/^\S+ · 0\.0 MB · open: \w+: /.test(detail)) throw new Error(`small print: ${detail}`);
      a11y.push(...(await snap(page, out, "upload-broken-pdf")));
      results.push(`ok broken .pdf: the error and its small print (${detail.slice(0, 80)})`);
    } catch (e) {
      failed++;
      results.push(`FAIL broken .pdf: ${e.message}`);
    }
    await page.close();
    await mock.close?.();
  }
  await browser.close();
  for (const r of results) console.log(r);
  console.log(`a11y issues: ${a11y.length}`);
  for (const a of a11y) console.log("  a11y", JSON.stringify(a));
  process.exit(failed || a11y.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
