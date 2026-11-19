// Render one or more mockup fragments with the kit, in light and dark, and
// report any phone whose content overflows. Usage:
//   node measure.js <out-dir> <fragment.html> [<fragment.html> ...]
// Writes <out-dir>/<name>-light.png and -dark.png, prints JSON with, per
// phone, its caption and overflow in px (0 = fits).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const here = __dirname;
const kit = fs.readFileSync(path.join(here, "kit.css"), "utf8");
const sprite = fs.readFileSync(path.join(here, "parts", "sprite.html"), "utf8");
const [outDir, ...frags] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const report = {};
  for (const frag of frags) {
    const name = path.basename(frag, ".html");
    const body = fs.readFileSync(frag, "utf8");
    const page = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700;900&family=IBM+Plex+Sans+Hebrew:wght@400;500;600;700&display=swap">
<style>${kit}</style></head><body><div class="page"><div class="feat-phones" style="padding:20px;flex-wrap:wrap">${body}</div></div>${sprite}</body></html>`;
    const tmp = path.join(outDir, `${name}.test.html`);
    fs.writeFileSync(tmp, page);
    report[name] = {};
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1, colorScheme: scheme });
      const p = await ctx.newPage();
      await p.goto("file://" + tmp);
      await p.waitForTimeout(900);
      const res = await p.evaluate(() =>
        [...document.querySelectorAll("figure.mock")].map((f) => {
          const b = f.querySelector(".ph-body");
          const cap = (f.querySelector("figcaption") || {}).textContent || "";
          const over = b ? Math.max(0, b.scrollHeight - b.clientHeight) : -1;
          const wide = [...f.querySelectorAll(".phone *")].some((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === "visible" && el.clientWidth > 0);
          return { caption: cap.trim().slice(0, 60), overflowPx: over, wideChild: wide };
        }),
      );
      report[name][scheme] = res;
      await p.screenshot({ path: path.join(outDir, `${name}-${scheme}.png`), fullPage: true });
      await ctx.close();
    }
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})();
