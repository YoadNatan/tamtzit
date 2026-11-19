// node sections.js <page.html> <out-dir> <width> <scheme> <selector...>
const { chromium } = require("playwright");
const [page, out, width, scheme, ...sels] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: +width, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
  const p = await ctx.newPage();
  await p.goto("file://" + page);
  await p.waitForTimeout(1200);
  const docW = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  console.log("doc width", docW);
  for (const s of sels) {
    const el = await p.$(s);
    if (!el) { console.log("missing", s); continue; }
    const name = s.replace(/[^a-z0-9-]/gi, "_");
    await el.screenshot({ path: `${out}/${name}-${width}-${scheme}.png` });
    console.log("shot", s);
  }
  await b.close();
})();
