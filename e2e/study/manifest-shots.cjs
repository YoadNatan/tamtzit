// The web app manifest's screenshots (public/screenshots/, docs/study/install.md):
// Chrome's richer install sheet on Android and computers shows them (iOS
// ignores them). Made from the e2e mock, so every name and summary in them is
// the fixture's, never a member's. Narrow: 390×844 (a lecture's summary,
// the library); wide: 1280×800 (the library, a summary).
//
//   NODE_PATH=$(npm root -g) node e2e/study/manifest-shots.cjs <dist> [out dir]
//
// <dist> is a mock build (VITE_SUPABASE_URL=https://mock.supabase.test) with
// production's flags; the out dir defaults to public/screenshots. The file
// names are the manifest's: re-run this after a visible change and commit them.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createMock } = require("./mock.cjs");

const [dist, outArg] = process.argv.slice(2);
if (!dist) {
  console.error("usage: node e2e/study/manifest-shots.cjs <dist> [out dir]");
  process.exit(2);
}
const out = outArg || path.join(__dirname, "..", "..", "public", "screenshots");
fs.mkdirSync(out, { recursive: true });

const SHOTS = [
  { file: "narrow-lecture.png", path: "/?v=lecture&l=LECTURE", size: { width: 390, height: 844 }, ready: ".lecture-body [data-blk]" },
  { file: "narrow-library.png", path: "/?v=library", size: { width: 390, height: 844 }, ready: "li.lc .lecture-card" },
  { file: "wide-library.png", path: "/?v=library", size: { width: 1280, height: 800 }, ready: "li.lc .lecture-card" },
  { file: "wide-lecture.png", path: "/?v=lecture&l=LECTURE", size: { width: 1280, height: 800 }, ready: ".lecture-body [data-blk]" },
];

(async () => {
  const mock = await createMock({ dist, flags: "i" });
  mock.seedLecture();
  const browser = await chromium.launch();
  const id = mock.people["נועה"].user.id;
  // A member past the first steps, the card put off: the screens as they are day to day.
  const storage = {
    [`study-guide:${id}`]: JSON.stringify({ v: 1, born: Date.now() - 40 * 86_400_000, mode: "join", views: 9, did: [], list: [], tips: false, known: [], offer: "dismissed" }),
    "study-install": JSON.stringify({ v: 1, dismissed: Date.now() }),
  };
  let failed = false;
  try {
    for (const s of SHOTS) {
      const { page, ctx } = await mock.open(browser, "נועה", { viewport: s.size, storage, path: s.path.replace("LECTURE", mock.LECTURE_ID) });
      await page.locator(s.ready).first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, s.file) });
      console.log(`${s.file} ${s.size.width}x${s.size.height}`);
      await ctx.close();
    }
  } catch (e) {
    failed = true;
    console.error(e);
  } finally {
    await browser.close();
    await mock.close();
  }
  if (mock.problems.length) console.error(mock.problems.join("\n"));
  process.exit(failed || mock.problems.length ? 1 : 0);
})();
