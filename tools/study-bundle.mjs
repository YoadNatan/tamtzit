#!/usr/bin/env node
// The study app's bundle check (spec §5.3; §12.2.5, review F-8; F-11).
// Builds the site as `npm run build` does (vite.config.ts, the one entry,
// index.html, split as it is in production), with every VITE_STUDY_* flag
// on, in memory, and reads the study entry chunk:
//
//   - it must stay under 410 kB (Vite's kB, 1,000 bytes; raised from 400 for
//     the wave of notifications, practice sets, sheets and models, owner's
//     decision OD2 of 26 Nov 2026, docs/study/DECISIONS-2026-11-26.md);
//   - no package screen may be in it: src/study/components/*Screen.tsx, and
//     Catchup.tsx, Museum.tsx, Pulse.tsx, Wall.tsx and Boss.tsx (each slot
//     module loads its screens lazily; a static import would carry the screen
//     into every page load);
//   - no chunk of the study app may say "מבחן חי", "תחרותי" or "נקודות על
//     תשובה נכונה ומהירה" (decision 2's names: F-15);
//
// and lists each package's static share of the entry chunk (budget: 8 kB a
// package; F's shell and the libraries have none). A package of the wave has
// a hard cap of its own (notifications, R: 1,200 B; practice sets, QS:
// 2,000 B, design-practice §10 and OD2) and only its slot module in the
// entry: every other module of it must load lazily. Practice sets did not
// move entry code to lazy chunks first (the design's WP1 "6 kB"): under the
// 410 kB limit the wave fits without it (docs/study/sets.md has the numbers).
//
//   npm run test:bundle
//   node tools/study-bundle.mjs --flags off      the same with every flag off
//
// It writes nothing: no dist/, no cache outside node_modules/.cache.
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { relative, sep } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const flagsOff = process.argv.includes("--flags") && process.argv[process.argv.indexOf("--flags") + 1] === "off";

const FLAGS = [
  "QUESTIONS", "PRACTICE", "QUIZ", "CARDS", "CARDS_REVIEW", "CORRECTIONS", "ASK", "RECORDINGS", "PDF", "ACCOUNT",
  "PROGRESS", "MARATHONS", "EXAMS", "MEETING", "ANCHOR", "VAR", "WALL", "TODAY", "GUESS", "NEEDS_ME", "PULSE",
  "MUSEUM", "BOSS", "GROUP_PLAN", "TRAPS", "BLANK_TABLE", "QUIZ_ROUNDS", "EVE", "GUIDE", "QTYPES", "COURSES", "INSTALL",
  "NOTIFY", "MAKE", "SETS", "SHEETS", "SHEETS_FORMS", "SIMILAR",
];
for (const f of FLAGS) {
  if (flagsOff) delete process.env[`VITE_STUDY_${f}`];
  else process.env[`VITE_STUDY_${f}`] = "1";
}

const LIMIT = 410_000;
const PACKAGE_BUDGET = 8_000;
/** A package's hard cap on its static share, where it has one (failing the check). */
const PACKAGE_CAP = { R: 1_200, QS: 2_000, O: 1_500 };
/** Packages whose only module in the entry may be their slot (features/<slot>.tsx). */
const SLOT_ONLY = ["R", "QS", "O"];
const FORBIDDEN = ["מבחן חי", "תחרותי", "נקודות על תשובה נכונה ומהירה"];
/** A package's screen: never in the entry chunk. */
const SCREEN = /^src\/study\/components\/(?:\w+Screen|Catchup|Museum|Pulse|Wall|Boss)\.tsx$/;

/* ── Who owns a module (spec §5.5, §10.2; §12.1.2) ── */
const SLOT = {
  writing: "W", practice: "Q", quiz: "Z", cards: "C", collab: "K", account: "A", progress: "A",
  meeting: "M", anchor: "N", var: "V", today: "T", pulse: "U", wall: "J", boss: "H", bank: "B", plan: "G", extras: "E",
  guide: "D", // the guide (docs/study/guide.md)
  courses: "S", // courses and past exams (docs/study/sources.md)
  install: "L", // adding the app to the home screen (docs/study/install.md)
  notify: "R", // notifications: the bell, the inbox, pushes (section R)
  qsets: "QS", // practice sets: "סט חדש", the shelf, the set page (docs/study/sets.md)
  sheets: "O", // uploaded sheets: the upload, the wide review, the landing card (docs/study/sheets.md)
};
/** A style sheet named otherwise than its package's slot. */
const STYLE = { sets: "QS", similar: "O" };
const COMPONENT = {
  Q: ["PracticeHome", "LecturePractice", "PracticeSession", "PracticeQuestion", "PracticeCreate", "PracticeBank", "PracticeRound", "FlagSheet", "FixSheet", "Exams"],
  Z: ["QuizSetup", "Quiz", "QuizParts", "QuizBanner", "QuizQuestion"],
  C: ["CardsToday", "LectureCards", "CardReview", "CardFace", "CardSheets", "CardBrowse", "DeckParts", "MyCardFace"],
  K: ["Together", "ParagraphSheet", "EditPanel", "MnemonicPanel", "AskView", "RecentEdits"],
  A: ["Account", "Progress", "Marathon", "DangerList", "Readiness", "Calibration", "EveScreen"],
  W: ["ShareSheet", "PrintDoc", "RecordingSheet"],
  M: ["MeetingScreen", "MeetingSheet", "MeetingBand", "ReaderCard", "FollowBar", "GuessCards", "Catchup"],
  N: ["ChipRow", "PracticeTab"],
  V: ["DisputeScreen", "VerdictCard", "LogScreen", "UpdateCard", "DisputesCard", "VarBox"],
  T: ["TodayScreen", "TodaySession", "Flame", "NeedsMe"],
  U: ["Pulse", "PulseParts", "Museum", "TrapBadge"],
  J: ["Wall", "WallDrafts", "WallComposer", "WallEntry", "CardHint"],
  H: ["Boss", "BossHud", "BossEnd"],
  G: ["PlanScreen", "PlanSetup", "LaneDay", "SlipCard"],
  E: ["TrapScreen", "BlankTable", "RoundPicker", "ExtrasCard"],
  D: ["GuideLayer", "GuideSteps", "HowTo", "GuideMe", "TryScreen"],
  S: ["CourseScreen", "UploadMany", "CourseAsk"],
  L: ["InstallScreen", "InstallParts"],
  R: ["NotifyScreen", "InboxScreen", "NotifyParts"],
  QS: ["MakeScreen", "MakeParts", "MakeProgress", "MakeEntry", "SetPage", "SetsShelf", "SetsScreen", "SetStats", "SetCard", "SetJoinNote", "SetsEntries"],
  O: ["SheetUpload", "PageView", "DeepLinkCard", "SheetText", "SheetAnswer", "SheetEdit", "SheetSolution", "SheetsLecture", "SimilarSheet"],
};
const LIB = {
  W: ["generate", "writing", "transcript", "transcribe", "transcribe.worker", "pdf-export"],
  Q: ["practice", "practice2", "practiceGenerate", "practiceSession", "questionText", "exams"],
  Z: ["quiz", "useQuiz", "useOpenQuiz"],
  C: ["cards", "cardsGenerate", "cardsQueue", "cardsOutbox", "anki", "sqljs.d"],
  K: ["collab", "correctionsStore"],
  A: ["account", "progress", "marathon", "useReadingTracker"],
  M: ["meeting"], N: ["anchor", "anchorTab"], V: ["var"], T: ["today"], U: ["pulse"], J: ["wall", "photo"], H: ["boss"], B: ["bank"], G: ["groupPlan"], E: ["extras"],
  D: ["guide", "guideMark", "guideFacts"],
  S: ["courses", "batch"],
  L: ["install", "installPrompt", "installCopy", "installLazy"],
  R: ["notify", "notices", "notifyText"],
  QS: ["make", "setsCopy", "sets"],
  O: ["sheets", "sheetForms", "sheetPure", "similarCopy", "similar"],
};
const SHARED = {
  C: ["cloze", "fsrs"], K: ["edits"], T: ["today"], G: ["lane"], E: ["blankTable", "extras"], A: ["estimates", "plan", "agenda"], U: ["pulse"], S: ["batch"],
  R: ["notifyCopy", "notifyRoute", "notifyQuiet", "b64url", "bidiText"],
  O: ["sheetPrice", "coverage"],
};
const byName = (table) => Object.fromEntries(Object.entries(table).flatMap(([pkg, names]) => names.map((n) => [n, pkg])));
const COMPONENT_OF = byName(COMPONENT);
const LIB_OF = byName(LIB);
const SHARED_OF = byName(SHARED);

function ownerOf(id) {
  if (id.includes(`${sep}node_modules${sep}`) || id.includes("/node_modules/")) return "libraries";
  const rel = relative(root, id.split("?")[0]).split(sep).join("/");
  let m;
  if ((m = /^src\/study\/features\/(\w+)\.tsx?$/.exec(rel))) return SLOT[m[1]] ?? "F";
  if ((m = /^src\/study\/components\/([\w.]+)\.tsx?$/.exec(rel))) return COMPONENT_OF[m[1]] ?? "F";
  if ((m = /^src\/study\/lib\/([\w.]+)\.tsx?$/.exec(rel))) return LIB_OF[m[1]] ?? "F";
  if ((m = /^src\/study\/styles\/(\w+)\.css$/.exec(rel))) return STYLE[m[1]] ?? SLOT[m[1]] ?? m[1];
  if ((m = /^shared\/study\/(\w+)\.ts$/.exec(rel))) return SHARED_OF[m[1]] ?? "F";
  if (rel.startsWith("src/study/") || rel === "index.html") return "F";
  return "other";
}

const started = Date.now();
const out = await build({
  root,
  configFile: `${root}vite.config.ts`,
  logLevel: "error",
  build: { write: false, reportCompressedSize: false, chunkSizeWarningLimit: 10_000 },
});
const chunks = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).filter((c) => c.type === "chunk");
const entry = chunks.find((c) => c.isEntry && c.facadeModuleId && relative(root, c.facadeModuleId).split(sep).join("/") === "index.html");
if (!entry) {
  console.error("No study entry chunk in the build.");
  process.exit(1);
}

const problems = [];
const bytes = Buffer.byteLength(entry.code, "utf8");
if (bytes >= LIMIT) problems.push(`the study entry chunk is ${bytes.toLocaleString("en")} bytes (limit ${LIMIT.toLocaleString("en")})`);

const ids = Object.keys(entry.modules);
for (const id of ids) {
  const rel = relative(root, id.split("?")[0]).split(sep).join("/");
  if (SCREEN.test(rel)) problems.push(`a package screen is in the study entry chunk: ${rel} (load it lazily inside its slot module)`);
}

// Every chunk the study app loads, from its entry: the forbidden names.
const byFile = new Map(chunks.map((c) => [c.fileName, c]));
const reach = new Set();
const walk = (c) => {
  if (!c || reach.has(c.fileName)) return;
  reach.add(c.fileName);
  for (const f of [...c.imports, ...c.dynamicImports]) walk(byFile.get(f));
};
walk(entry);
for (const f of reach) {
  const code = byFile.get(f).code;
  for (const bad of FORBIDDEN) if (code.includes(bad)) problems.push(`${f} says "${bad}" (the approved names: "מבחן קבוצתי", "כולנו נגד המבחן", "מירוץ")`);
}

// Each package's static share of the entry chunk.
const share = {};
for (const [id, m] of Object.entries(entry.modules)) {
  const who = ownerOf(id);
  share[who] = (share[who] ?? 0) + m.renderedLength;
  if (SLOT_ONLY.includes(who)) {
    const rel = relative(root, id.split("?")[0]).split(sep).join("/");
    if (!/^src\/study\/features\/\w+\.tsx?$/.test(rel)) problems.push(`${rel} is in the study entry chunk: package ${who} keeps only its slot module there (load it lazily)`);
  }
}
for (const [who, cap] of Object.entries(PACKAGE_CAP)) {
  if (!flagsOff && (share[who] ?? 0) > cap) problems.push(`package ${who}'s share of the study entry chunk is ${share[who]} B (its cap: ${cap.toLocaleString("en")} B)`);
}
const ORDER = ["F", "W", "Q", "Z", "C", "K", "A", "M", "N", "V", "T", "U", "J", "H", "B", "G", "E", "D", "S", "L", "R", "QS", "O", "libraries", "other"];
const lines = [...ORDER, ...Object.keys(share).filter((k) => !ORDER.includes(k))]
  .filter((k) => k in share || k in PACKAGE_CAP) // a capped package shows its 0 too
  .map((k) => {
    const n = share[k] ?? 0;
    const budgeted = k.length === 1 && k !== "F";
    const cap = PACKAGE_CAP[k];
    const note = cap ? `  (cap ${cap.toLocaleString("en")} B)` : budgeted ? (n > PACKAGE_BUDGET ? "  over the 8 kB budget" : "") : "  (no budget)";
    return `  ${k.padEnd(10)} ${String(n).padStart(8)} B${note}`;
  });

console.log(`study entry chunk: ${entry.fileName}, ${bytes.toLocaleString("en")} bytes (limit ${LIMIT.toLocaleString("en")}), every flag ${flagsOff ? "off" : "on"}`);
console.log(`modules in it: ${ids.length}; chunks the app can load: ${reach.size}; built in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log("each package's static share of the entry chunk (rendered bytes, before minification's last pass):");
for (const l of lines) console.log(l);
if (problems.length) {
  console.error(`\nThe bundle check failed:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("ok: under the limit, each capped package within its cap, no package screen in the entry chunk, none of the replaced quiz names");
