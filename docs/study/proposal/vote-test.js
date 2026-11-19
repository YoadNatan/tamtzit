// Drive the vote widget with a mocked window.claude (db + user) and check tallies, saving, notes and other people's votes.
const { chromium } = require("playwright");
const page = process.argv[2];
const MOCK = `
(() => {
  const store = new Map([["u-shoham", { choices: { "live-quiz": "build", "wall": "talk" }, notes: { "wall": "רק אם זה מצחיק באמת" }, at: "x" }]]);
  const subs = [];
  window.__writes = [];
  const snap = () => ({ docs: [...store.entries()].map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)) })), metadata: { hasPendingWrites: false, fromCache: false } });
  const emit = () => subs.forEach((cb) => cb(snap()));
  window.__emitOther = (id, d) => { store.set(id, d); emit(); };
  const db = {
    collection: (path) => ({ onSnapshot: (cb, err) => { subs.push(cb); setTimeout(() => cb(snap()), 50); return () => {}; } }),
    doc: (path) => ({ set: async (body) => { window.__writes.push([path, body]); store.set(path.split("/")[1], body); setTimeout(emit, 20); } }),
  };
  const user = {
    id: async () => "u-yoad",
    can: async () => true,
    profiles: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: { "u-yoad": "יועד", "u-shoham": "שוהם" }[i] || "" }])),
  };
  window.claude = { use: async (n) => (n === "db" ? db : n === "user" ? user : null) };
})();`;
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(MOCK);
  await p.goto("file://" + page);
  await p.waitForTimeout(800);
  const status1 = await p.textContent("#vote-status");
  const tallyQuiz = await p.textContent('.vote[data-feature="live-quiz"] .vote-tally');
  const tallyWall = await p.textContent('.vote[data-feature="wall"] .vote-tally');
  await p.click('.vote[data-feature="practice"] button[data-v="build"]');
  await p.waitForTimeout(300);
  const pressed = await p.getAttribute('.vote[data-feature="practice"] button[data-v="build"]', "aria-pressed");
  const tallyPractice = await p.textContent('.vote[data-feature="practice"] .vote-tally');
  await p.fill('.vote[data-feature="practice"] textarea', "חייב להיות בשלב 1");
  await p.waitForTimeout(1400);
  await p.evaluate(() => window.__emitOther("u-noa", { choices: { practice: "skip" }, notes: {}, at: "y" }));
  await p.waitForTimeout(300);
  const tallyPractice2 = await p.textContent('.vote[data-feature="practice"] .vote-tally');
  const noteKept = await p.inputValue('.vote[data-feature="practice"] textarea');
  // toggle off
  await p.click('.vote[data-feature="practice"] button[data-v="build"]');
  await p.waitForTimeout(300);
  const pressedOff = await p.getAttribute('.vote[data-feature="practice"] button[data-v="build"]', "aria-pressed");
  const rows = await p.$$eval("#vote-summary-body tr", (rs) => rs.slice(0, 4).map((r) => r.innerText.replace(/\s+/g, " ")));
  const writes = await p.evaluate(() => window.__writes.map(([path, b]) => path + " " + JSON.stringify(b.choices) + " " + JSON.stringify(b.notes)));
  console.log(JSON.stringify({ status1, tallyQuiz, tallyWall, pressed, tallyPractice, tallyPractice2, noteKept, pressedOff, rows, writes, status2: await p.textContent("#vote-status"), errors }, null, 1));
  await b.close();
})();
