// Package Q's plugin for the e2e mock (spec §8.3): section Q's tables and
// functions as PostgREST would answer them for each member, and op
// "questions" of /api/study/ai, streamed for real (U+200B, {"t":"start"},
// one {"t":"q"} line per question with its public fields only, then
// {"t":"done"}). The key and the explanations stay in the mock: no client
// request may read study_answers or study_question_keys, and no streamed
// line carries them. The questions are synthetic, about the fixture lecture
// (e2e/study/fixtures: a diuretics deck made for the tests).
//
// The script steers it through db.practice (each test a function of the batch row):
//   pace: { start, line }   ms before the start line, between questions
//   hold(b)                 the part waits after its claim while this is true
//   busy(b)                 another phone holds the part: 409 busy once, and
//                           that phone finishes it a moment later
//   fail(b)                 the part stops after its start line with
//                           "\u0000ERROR timeout" once (nothing made)
//   budget                  402 budget after the claim (the part fails "budget")
//   inQuiz                  question ids an open live-quiz round holds ("in quiz")
//   requests                every op call: part, start, start line, end, status
//   lines                   every line streamed, for the privacy check
// db.calls gets "ledger study_reserve …" before and "ledger study_settle …"
// after every mocked model call (spec §8.3), with the batch as ref and the key.
// Practice 2.0 (points, plan, style, create, drafts, the blind solver,
// reword, the session counts, the bet and two-flag hiding) is below, with
// its own levers.
const SIX_MINUTES = 6 * 60_000;
const now = () => new Date().toISOString();
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const hex = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** The base mock's users: token tok-<n> is uuid(n). */
const userOfToken = (token) => {
  const m = /^tok-(\d+)$/.exec(token || "");
  return m ? `${m[1].padStart(8, "0")}-0000-4000-8000-${m[1].padStart(12, "0")}` : null;
};

/* ── the questions: one per part in round 1 (written for the fixture's slides), a plain one after ── */
const ROUND1 = [
  {
    kind: "mcq", difficulty: 1, topic: "Proximal tubule", aspect: "other", slides: [2, 3], vignette: "",
    question: "באיזה מקטע של הנפרון נספג רוב ה-Na+ המסונן?",
    options: ["Proximal tubule", "Thick ascending limb", "Distal convoluted tubule", "Collecting duct", "Glomerulus"],
    explanations: [
      "לפי השקף, כ-65% מה-Na+ נספג ב-Proximal tubule, יותר מבכל מקטע אחר. [ש' 2]",
      "ב-Thick ascending limb נספג כ-25% מה-Na+, פחות מאשר ב-Proximal tubule. [ש' 2]",
      "ב-Distal convoluted tubule נספג רק כ-5% מה-Na+. [ש' 2]",
      "ב-Collecting duct נספג כ-3% מה-Na+, בבקרת aldosterone דרך ENaC. [ש' 2-3]",
      "השקפים לא מונים את ה-Glomerulus בין אתרי הספיגה של Na+. [ש' 2]",
    ],
    takeaway: "רוב ה-Na+ המסונן, כ-65%, נספג ב-Proximal tubule. [ש' 2]",
  },
  {
    kind: "case", difficulty: 2, topic: "Acetazolamide", aspect: "uses", slides: [4],
    vignette: "גבר בן 34 מתכנן טרק בהרים גבוהים ומגיע למרפאה לפני הנסיעה. הוא מבקש טיפול מונע ל-acute mountain sickness.",
    question: "איזו תרופה מהשקפים מתאימה לו?",
    options: ["Acetazolamide", "Furosemide", "Spironolactone", "Mannitol", "Hydrochlorothiazide"],
    explanations: [
      "Acetazolamide, מעכב carbonic anhydrase, משמשת ב-acute mountain sickness. [ש' 4]",
      "Furosemide היא loop diuretic, והשקפים מביאים אותה לבצקת ריאות חריפה. [ש' 7]",
      "Spironolactone משמשת ב-heart failure וב-hyperaldosteronism. [ש' 12]",
      "Mannitol ניתנת IV בלבד, להורדת לחץ תוך-גולגולתי. [ש' 15-16]",
      "Hydrochlorothiazide היא קו ראשון ב-hypertension. [ש' 9-10]",
    ],
    takeaway: "Acetazolamide משמשת ב-glaucoma וב-acute mountain sickness. [ש' 4]",
  },
  {
    kind: "mcq", difficulty: 1, topic: "Furosemide", aspect: "mechanism", slides: [6], vignette: "",
    question: "מה מנגנון הפעולה של Furosemide?",
    options: ["עיכוב NKCC2", "עיכוב NCC", "חסימת ENaC", "עיכוב carbonic anhydrase", "אנטגוניזם ל-mineralocorticoid receptor"],
    explanations: [
      "Loop diuretics כמו Furosemide מעכבות את NKCC2. [ש' 6]",
      "עיכוב NCC הוא המנגנון של ה-Thiazides. [ש' 9]",
      "חסימת ENaC היא המנגנון של Amiloride ו-Triamterene. [ש' 14]",
      "עיכוב carbonic anhydrase הוא המנגנון של Acetazolamide. [ש' 4]",
      "Spironolactone היא mineralocorticoid receptor antagonist. [ש' 12]",
    ],
    takeaway: "Furosemide ו-Bumetanide מעכבות NKCC2. [ש' 6]",
  },
  {
    kind: "case", difficulty: 2, topic: "Hydrochlorothiazide", aspect: "adverse", slides: [11],
    vignette: "אישה בת 58 מטופלת ב-Hydrochlorothiazide בשל hypertension. בבדיקת דם שגרתית נמצאה עלייה ברמת הסוכר.",
    question: "איזו תופעת לוואי של התרופה מתאימה לממצא?",
    options: ["Hyperglycemia", "Ototoxicity", "Gynecomastia", "Hyperkalemia", "Hyperchloremic metabolic acidosis"],
    explanations: [
      "Hyperglycemia, hyperlipidemia ו-hyperuricemia הן תופעות לוואי של Thiazides. [ש' 11]",
      "Ototoxicity היא תופעת לוואי של loop diuretics. [ש' 8]",
      "Gynecomastia היא תופעת לוואי של Spironolactone. [ש' 13]",
      "Thiazides מורידות K+, ו-hyperkalemia מופיעה עם Spironolactone. [ש' 13, 20]",
      "Hyperchloremic metabolic acidosis היא תופעת לוואי של Acetazolamide. [ש' 5]",
    ],
    takeaway: "Thiazides עלולות לגרום ל-hyperglycemia, hyperlipidemia ו-hyperuricemia. [ש' 11]",
  },
  {
    kind: "mcq", difficulty: 1, topic: "Spironolactone", aspect: "adverse", slides: [13], vignette: "",
    question: "איזו תופעת לוואי מאפיינת את Spironolactone?",
    options: ["Gynecomastia", "Hypokalemia", "Ototoxicity", "Hyperglycemia", "אבנים בכליות"],
    explanations: [
      "Gynecomastia ו-hyperkalemia הן תופעות הלוואי של Spironolactone. [ש' 13]",
      "Spironolactone חוסכת אשלגן, ולכן היא גורמת ל-hyperkalemia ולא ל-hypokalemia. [ש' 13]",
      "Ototoxicity היא תופעת לוואי של loop diuretics. [ש' 8]",
      "Hyperglycemia היא תופעת לוואי של Thiazides. [ש' 11]",
      "אבנים בכליות הן תופעת לוואי של Acetazolamide. [ש' 5]",
    ],
    takeaway: "Spironolactone עלולה לגרום ל-hyperkalemia ול-gynecomastia. [ש' 13]",
  },
  {
    kind: "mcq", difficulty: 2, topic: "Mannitol", aspect: "contra", slides: [15, 16], vignette: "",
    question: "באיזה מצב קליני אסור לתת Mannitol?",
    options: ["Heart failure", "לחץ תוך-גולגולתי מוגבר", "Glaucoma", "Hypercalcemia", "Nephrolithiasis של calcium"],
    explanations: [
      "Heart failure היא התוויית נגד ל-Mannitol. [ש' 16]",
      "לחץ תוך-גולגולתי מוגבר הוא שימוש של Mannitol, לא התוויית נגד. [ש' 16]",
      "Glaucoma מופיעה בשקפים בין השימושים של Acetazolamide. [ש' 4]",
      "Hypercalcemia מופיעה בין השימושים של loop diuretics. [ש' 7]",
      "Nephrolithiasis של calcium היא שימוש של Thiazides. [ש' 10]",
    ],
    takeaway: "Mannitol ניתנת IV בלבד, ו-heart failure היא התוויית נגד. [ש' 15-16]",
  },
  {
    kind: "case", difficulty: 3, topic: "Digoxin", aspect: "interactions", slides: [8, 17],
    vignette: "גבר בן 70 מטופל ב-Digoxin בשל אי-ספיקת לב, ומתחיל טיפול ב-Furosemide בשל בצקות ברגליים.",
    question: "איזו הפרעה אלקטרוליטית מעלה את הסיכון ברעילות של Digoxin בשילוב הזה?",
    options: ["Hypokalemia", "Hyperkalemia", "Hypercalcemia", "Hyperglycemia", "Hyperuricemia"],
    explanations: [
      "השקף מציין את השילוב של Digoxin עם hypokalemia, ו-loop diuretics גורמות ל-hypokalemia. [ש' 8, 17]",
      "Hyperkalemia מופיעה עם משתנים חוסכי אשלגן, לא עם loop diuretics. [ש' 13-14]",
      "השקפים מביאים את hypercalcemia בין השימושים של loop diuretics, לא כסיכון עם Digoxin. [ש' 7]",
      "Hyperglycemia היא תופעת לוואי של Thiazides. [ש' 11]",
      "Hyperuricemia היא תופעת לוואי של Thiazides. [ש' 11]",
    ],
    takeaway: "Digoxin עם hypokalemia הוא שילוב מסוכן, ו-loop diuretics גורמות ל-hypokalemia. [ש' 8, 17]",
  },
  {
    kind: "mcq", difficulty: 2, topic: "Thiazides", aspect: "other", slides: [20], vignette: "",
    question: "לפי טבלת ההשוואה, איך משפיעות loop diuretics ו-Thiazides על Ca2+?",
    options: ["Loop מעלות, Thiazides מורידות", "שתיהן מעלות", "שתיהן מורידות", "Loop מורידות, Thiazides מעלות", "לאף אחת אין השפעה"],
    explanations: [
      "בטבלה: loop diuretics מסומנות up ו-Thiazides down בעמודת Ca2+. [ש' 20]",
      "Thiazides מסומנות down בעמודת Ca2+. [ש' 20]",
      "Loop diuretics מסומנות up בעמודת Ca2+. [ש' 20]",
      "זה הפוך מהטבלה: loop מסומנות up ו-Thiazides down. [ש' 20]",
      "בטבלה לשתיהן יש השפעה על Ca2+. [ש' 20]",
    ],
    takeaway: "Loop diuretics מעלות את הפרשת Ca2+, ו-Thiazides מורידות אותה. [ש' 20]",
  },
];

function plainItem(round, b) {
  const s = b.slide_from;
  return {
    kind: "mcq", difficulty: 1, topic: b.heading.replace(/[^A-Za-z ,+-]/g, "").trim() || "Diuretics", aspect: "other", slides: [s], vignette: "",
    question: `מה נכון לפי השקפים ${b.slide_from}-${b.slide_to}? (סבב ${round}, חלק ${b.part_idx + 1})`,
    options: ["המשפט שמופיע בשקף", "משפט שהשקף סותר", "משפט מהרצאה אחרת", "משפט שלא מופיע בשקפים", "משפט שהפוך מהשקף"],
    explanations: [0, 1, 2, 3, 4].map((i) => `${i ? "זה לא מה שכתוב בשקף." : "כך כתוב בשקף."} [ש' ${s}]`),
    takeaway: `המשפט שמופיע בשקף ${s}. [ש' ${s}]`,
  };
}

/** The stored order: the options turned by `r`, the key and the explanations with them. */
function stored(item, r) {
  const n = item.options.length;
  const at = (i) => (i + r) % n;
  return { ...item, options: item.options.map((_, i) => item.options[at(i)]), explanations: item.explanations.map((_, i) => item.explanations[at(i)]), answer: (n - (r % n)) % n };
}

/* ── PostgREST, small (the base mock's rules, for these tables) ── */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseSelect(sel) {
  const cols = [];
  const embeds = [];
  for (const item of splitTop(sel || "*")) {
    const m = /^([a-z_]+)\s*\(\s*([\s\S]*)\)$/.exec(item);
    if (m) embeds.push({ table: m[1], ...parseSelect(m[2]) });
    else cols.push(item.replace(/\s+/g, ""));
  }
  return { cols, embeds };
}
function matches(v, op) {
  if (op.startsWith("not.")) return !matches(v, op.slice(4));
  const [k, ...rest] = op.split(".");
  const arg = rest.join(".");
  const s = v === null || v === undefined ? null : String(v);
  if (k === "eq") return s === arg;
  if (k === "neq") return s !== arg;
  if (k === "is") return arg === "null" ? v === null || v === undefined : String(v) === arg;
  if (k === "in") return arg.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")).includes(s);
  throw new Error(`filter ${op} not mocked`);
}
const studyDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.parse(iso) - 4 * 3_600_000));


/* ══════════════ practice 2.0 (docs/study/practice-2-api.md) ══════════════
 * The points to know, requests, drafts and the blind solver, as section Q at
 * version 2 answers them: action "plan" (free), "points" (streamed, once per
 * lecture), "style", "create", a request's batch written as drafts with the
 * solver's verdicts (and the server's rewrite of one it got wrong), "reword";
 * the drafts' RPCs, study_request_progress, study_session_counts, and Q's
 * end on answering (the bet, "מתי כן", two-flag hiding and the fix sheet).
 * The keys of drafts stay here (P.draftKeys), as study_question_draft_keys.
 * Steered through db.practice:
 *   pointsPer             the points of each part when read (by part_idx)
 *   solverFails(d, k)     the solver gets draft k of a batch wrong (rewritten once)
 *   solverStillFails(d)   the rewrite is wrong too: the draft is rejected
 *   unchecked(d, k)       the solver could not run on it
 *   p2pace                ms between draft lines
 *   pointsDelay(l, i)     ms until part i's points call ends (default p2pace × 1-3, staggered)
 *   pointsFail(l, i)      part i's call fails with this reason
 *   pointsStall(l, i)     the server dies while reading part i: it stays claimed until
 *                         its lease runs out (stallMs), with no event */
const POINTS_PER = [4, 4, 6, 6, 5, 4, 5, 4];
const RED_FLAGS = [0, 1, 1, 1, 1, 1, 0, 0];
const KINDS = ["drug", "mechanism", "indication", "adverse", "contra", "number"];
const STYLE_ORDER = ["case", "mechanism", "drug_choice", "adverse_contra", "compare", "not_true", "blank_table"];
const halfUp = (x) => Math.floor(x + 0.5 + 1e-9);
function partQuestions(level, points, red) {
  if (points <= 0) return 0;
  if (level === "focused") return Math.min(points, Math.max(halfUp(points / 4), red));
  if (level === "full") return halfUp(points / 2);
  return points;
}
/** shared/study/practice2.ts's shareOut, for משלי and the 40 cap. */
function shareOut(total, weights, caps) {
  const n = weights.length;
  const cap = (i) => (caps ? caps[i] : Infinity);
  const out = new Array(n).fill(0);
  const live = weights.map((w, i) => w > 0 && cap(i) > 0);
  const sum = weights.reduce((s, w, i) => s + (live[i] ? w : 0), 0);
  if (total <= 0 || sum <= 0) return out;
  const raw = weights.map((w, i) => (live[i] ? (total * w) / sum : 0));
  for (let i = 0; i < n; i++) out[i] = Math.min(cap(i), Math.floor(raw[i] + 1e-9));
  if (total >= live.filter(Boolean).length) for (let i = 0; i < n; i++) if (live[i] && out[i] === 0) out[i] = 1;
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r + 1e-9) })).filter(({ i }) => live[i]).sort((a, b) => b.rem - a.rem || a.i - b.i);
  while (left > 0) {
    let moved = false;
    for (const { i } of order) {
      if (left <= 0) break;
      if (out[i] < cap(i)) {
        out[i] += 1;
        left -= 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  while (left < 0) {
    let k = -1;
    for (let i = n - 1; i >= 0; i--) if (out[i] > 1 && (k < 0 || out[i] > out[k])) k = i;
    if (k < 0) break;
    out[k] -= 1;
    left += 1;
  }
  return out;
}
function perPart(level, counts, count) {
  if (level === "custom") {
    const room = counts.map((c) => c.points * 2);
    const want = Math.max(0, Math.min(Math.floor(count ?? 0), 40, room.reduce((s, x) => s + x, 0)));
    return shareOut(want, counts.map((c) => c.points), room);
  }
  const raw = counts.map((c) => partQuestions(level, c.points, c.red_flags));
  const total = raw.reduce((s, x) => s + x, 0);
  return total <= 40 ? raw : shareOut(40, raw, raw);
}
const batchSizes = (q) => {
  if (q <= 0) return [];
  const k = Math.ceil(q / 5);
  return Array.from({ length: k }, (_, i) => Math.floor(q / k) + (i < q % k ? 1 : 0));
};
const round2 = (x) => Math.ceil(x * 100 - 1e-9) / 100 || 0;
const WORDS = ["Furosemide", "Acetazolamide", "Hydrochlorothiazide", "Spironolactone", "Mannitol", "Amiloride", "Digoxin", "Bumetanide"];

/** A synthetic draft about a part: its key at a place that turns with k, "מתי כן" on each wrong option. */
function draftItem(section, style, k, rewrite) {
  const drug = WORDS[(section.idx + k) % WORDS.length];
  const s = section.slide_from;
  const options = [`${drug} מתאימה לפי השקף`, `${drug} אסורה במצב הזה`, "אין לה מקום בהרצאה", `רק עם ${WORDS[(section.idx + k + 1) % WORDS.length]}`, "שום תשובה אינה נכונה"];
  const answer = (k + section.idx) % 5;
  const order = options.map((_, i) => (i + answer) % 5); // stored place i holds option order[i]; the key ends at `answer`
  const stored = order.map((i) => options[i]);
  const key = stored.indexOf(options[0]);
  const why = stored.map((o, i) => (i === key ? `כך כתוב בשקף. [ש' ${s}]` : `זה לא מה שכתוב בשקף על ${drug}. [ש' ${s}]`));
  const whens = stored.map((o, i) => (i === key ? "" : `בשאלה על ${WORDS[(section.idx + i + 2) % WORDS.length]}`));
  return {
    kind: style === "case" ? "case" : "mcq",
    vignette: style === "case" ? `מטופל בן ${40 + k} מגיע למרפאה. ברקע: ${section.title}.` : "",
    question: `${rewrite ? "(ניסוח חדש) " : ""}${section.title}: מה נכון לגבי ${drug}? (${k + 1})`,
    options: stored,
    answer: key,
    explanations: why,
    whens,
    takeaway: `${drug}: מה שהשקף אומר. [ש' ${s}]`,
    slides: [s],
  };
}

function p2Seed(P) {
  Object.assign(P, {
    points: [],
    pointParts: new Map(),
    qrequests: [],
    drafts: [],
    draftKeys: new Map(),
    pointsPer: POINTS_PER,
    solverFails: () => false,
    solverStillFails: () => false,
    unchecked: () => false,
    p2pace: 250,
    p2calls: [],
    // The points' reading: per part, ms until its call ends, a failure's reason, or a server that dies with it.
    pointsDelay: null,
    pointsFail: null,
    pointsStall: null,
    stallMs: 1500,
  });
  P.seq.request = 0;
  P.seq.draft = 0;
  P.seq.point = 0;
}

/** A section's points state, as study_points_state answers it. */
function pointsState(db, P, lectureId) {
  return db.sections
    .filter((s) => s.lecture_id === lectureId)
    .sort((a, b) => a.idx - b.idx)
    .map((s) => {
      const pp = P.pointParts.get(`${lectureId}:${s.idx}`);
      const mine = P.points.filter((p) => p.lecture_id === lectureId && p.part_idx === s.idx);
      return {
        part_idx: s.idx, title: s.title, slide_from: s.slide_from, slide_to: s.slide_to, summary: s.status,
        points: mine.length, red_flags: mine.filter((p) => p.red_flag).length, status: pp?.status ?? "pending",
        current: Boolean(pp && pp.src === s.markdown && pp.status !== "writing"), busy: pp?.status === "writing" && Date.parse(pp.lease_until) > Date.now(), error: pp?.error ?? null,
      };
    });
}

function planOf(db, P, lectureId, o) {
  const parts = pointsState(db, P, lectureId);
  const level = o.level ?? "full";
  const chosen = o.parts?.length ? parts.filter((p) => o.parts.includes(p.part_idx)) : parts.filter((p) => p.points > 0);
  const counts = chosen.filter((p) => p.points > 0).map((p) => ({ part_idx: p.part_idx, points: p.points, red_flags: p.red_flags }));
  const q = perPart(level, counts, o.count);
  const sum = (l) => perPart(l, counts).reduce((s, x) => s + x, 0);
  const total = q.reduce((s, x) => s + x, 0);
  const stale = parts.filter((p) => p.summary === "ready" && !p.current).map((p) => p.part_idx);
  return {
    parts, counts, q, level, total, stale,
    answer: {
      lecture: { slides: db.lectures.find((l) => l.id === lectureId)?.slides.length ?? 0 },
      parts,
      points: { total: parts.reduce((s, p) => s + p.points, 0), current: stale.length === 0 && parts.some((p) => p.points > 0), stale, busy: parts.some((p) => p.busy) },
      levels: { focused: sum("focused"), full: sum("full"), deep: sum("deep") },
      plan: { level, total, parts: counts.map((c, i) => ({ ...c, questions: q[i], covers: level === "focused" ? q[i] : c.points })), batches: q.reduce((n, x) => n + batchSizes(x).length, 0) },
      estimate: {
        readUsd: stale.length ? 0.14 : 0, questionsUsd: round2(total * 0.025), solverUsd: round2(total * 0.005), totalUsd: round2((stale.length ? 0.14 : 0) + total * 0.025), perQuestionUsd: 0.025,
        levels: { focused: round2(sum("focused") * 0.025), full: round2(sum("full") * 0.025), deep: round2(sum("deep") * 0.025) }, rewordUsd: 0.03, styleUsd: 0.01,
      },
      spent: { groupUsd: db.spent, mineUsd: db.mySpent, capUsd: db.budgetUsd, share: 0.8, memberShare: 0.4 },
    },
  };
}

const LEVELS = ["focused", "full", "deep", "custom"];
const DIFFS = ["easy", "exam", "hard"];
function readOptions(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const level = o.level ?? "full";
  if (!LEVELS.includes(level)) return { code: "bad level" };
  if (level === "custom" && !(Number.isInteger(o.count) && o.count >= 1 && o.count <= 40)) return { code: "count out of range" };
  if (o.parts !== undefined && (!Array.isArray(o.parts) || !o.parts.length)) return { code: "bad parts" };
  const styles = o.styles ?? ["case", "mechanism", "drug_choice", "adverse_contra"];
  if (!Array.isArray(styles) || !styles.length || !styles.every((s) => STYLE_ORDER.includes(s))) return { code: "bad styles" };
  if (o.difficulty !== undefined && !DIFFS.includes(o.difficulty)) return { code: "bad difficulty" };
  if (typeof o.focus === "string" && o.focus.trim().length > 200) return { code: "focus too long" };
  if (o.style && o.style.sig !== "a".repeat(64)) return { code: "bad style" };
  return { options: { level, count: o.count, parts: o.parts, styles: STYLE_ORDER.filter((s) => styles.includes(s)), difficulty: o.difficulty ?? "exam", focus: o.focus ?? "", style: o.style ?? null } };
}

/** The draft line's public fields (never the key, the explanations or "מתי כן"). */
const draftLine = (d) => {
  const { lecture_id, status, question_id, created_at, updated_at, lease_until, group_id, ...pub } = d;
  return pub;
};

module.exports = {
  seed(db) {
    db.practice = {
      batches: [],
      questions: [],
      keys: new Map(),
      answers: [],
      flags: [],
      requests: [],
      lines: [],
      pace: { start: 300, line: 400 },
      hold: () => false,
      busy: () => false,
      fail: () => false,
      busyDone: new Set(),
      failDone: new Set(),
      budget: false,
      inQuiz: new Set(),
      seq: { batch: 0, question: 0, flag: 0 },
      notify: null,
    };
    p2Seed(db.practice);
  },

  async rest({ method, path, query, body, who, db, notify, single, json: reply, refuse: refuseWith, check }) {
    // The base mock reads the awaited value: a request answered here returns true.
    const json = async (b, s) => {
      await reply(b, s);
      return true;
    };
    const refuse = async (m, s) => {
      await refuseWith(m, s);
      return true;
    };
    const P = db.practice;
    if (!P) return undefined;
    P.notify = P.notify ?? notify;
    const where = `${method} ${path}`;
    const me = who ? who.id : null;
    const isMember = me && db.members.some((m) => m.user_id === me);
    const lectureOf = (id) => db.lectures.find((l) => l.id === id);
    const qOf = (id) => P.questions.find((q) => q.id === id);
    /** "✓ להשאיר": the draft enters the bank with its key (study_private.draft_to_bank). */
    const keepToBank = (d, who) => {
      const lecture = lectureOf(d.lecture_id);
      const n = ++P.seq.question;
      const q = {
        id: hex("9a000000", n), group_id: lecture.group_id, lecture_id: lecture.id, batch_id: d.batch_id, exam_id: null, exam_no: null, ref_lecture: null, source: "ai",
        part_idx: d.part_idx, kind: d.kind, difficulty: d.difficulty, vignette: d.vignette, question: d.question, options: d.options, slides: d.slides,
        topic: d.topic, aspect: d.aspect, has_key: true, model: "mock", created_by: d.created_by, created_at: now(), retired_at: null, retired_by: null, retire_note: "",
        anchor: d.anchor, quote: d.quote ?? "", part_gen: d.part_gen ?? 0, teaser: "", figure: "", option_tags: [], hidden_at: null, stale_at: null, fixed_at: null,
        style: d.style, points: d.points, request_id: d.request_id,
      };
      P.questions.push(q);
      P.keys.set(q.id, P.draftKeys.get(d.id));
      Object.assign(d, { status: "kept", question_id: q.id, decided_by: who, decided_at: now(), lease_until: null, updated_at: now() });
      notify("study_questions", "INSERT", q);
      notify("study_question_drafts", "UPDATE", d);
      return q.id;
    };

    if (path === "/rest/v1/study_answers" || path === "/rest/v1/study_question_keys") return undefined; // the base mock refuses and records it

    /* ── tables ── */
    const TABLES = {
      study_questions: () => P.questions,
      study_question_batches: () => P.batches,
      study_question_flags: () => P.flags,
      study_question_requests: () => P.qrequests,
      study_question_drafts: () => P.drafts,
      study_points: () => P.points,
      study_point_parts: () => [...P.pointParts.values()],
    };
    // Two different members' counting flags hide a question (Q's end); fewer show it again.
    const rehide = (q) => {
      if (!q) return;
      const counting = P.flags.filter((f) => f.question_id === q.id && ["wrong_key", "not_in_slides", "two_answers", "unclear"].includes(f.reason) && (!q.fixed_at || f.created_at > q.fixed_at));
      const was = q.hidden_at ?? null;
      q.hidden_at = new Set(counting.map((f) => f.user_id)).size >= 2 ? (was ?? now()) : null;
      if (was !== q.hidden_at) notify("study_questions", "UPDATE", q);
    };
    const table = path.replace(/^\/rest\/v1\//, "");
    if (TABLES[table]) {
      if (!isMember) return json([], 200);
      if (method === "GET") {
        const sel = parseSelect(query.get("select") || "*");
        check.cols(table, sel.cols, where);
        for (const e of sel.embeds) check.cols(e.table, e.cols, where);
        let rows = [...TABLES[table]()];
        for (const [k, v] of query) {
          if (["select", "order", "limit", "offset"].includes(k)) continue;
          check.cols(table, [k], where);
          rows = rows.filter((r) => matches(r[k], v));
        }
        const order = query.get("order");
        if (order) {
          const keys = order.split(",").map((x) => {
            const [col, dir] = x.split(".");
            check.cols(table, [col], where);
            return [col, dir === "desc" ? -1 : 1];
          });
          rows.sort((a, b) => {
            for (const [c, d] of keys) {
              if (a[c] === b[c]) continue;
              if (a[c] === null) return 1;
              if (b[c] === null) return -1;
              return (a[c] > b[c] ? 1 : -1) * d;
            }
            return 0;
          });
        }
        return json(
          rows.map((r) => {
            const out = {};
            for (const c of sel.cols) if (c === "*") Object.assign(out, r);
            else out[c] = r[c] === undefined ? null : r[c];
            for (const e of sel.embeds)
              if (e.table === "study_question_flags") out[e.table] = P.flags.filter((f) => f.question_id === r.id).map((f) => Object.fromEntries(e.cols.map((c) => [c, f[c]])));
            return out;
          }),
        );
      }
      if (table === "study_question_flags" && method === "POST") {
        const row = Array.isArray(body) ? body[0] : body;
        check.cols(table, Object.keys(row || {}), where);
        const q = qOf(row?.question_id);
        if (!q) return refuse("new row violates row-level security policy", 403);
        if (P.flags.some((f) => f.question_id === q.id && f.user_id === me)) return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
        const f = { id: hex("f1a90000", ++P.seq.flag), question_id: q.id, user_id: me, reason: row.reason, note: row.note || "", created_at: now() };
        P.flags.push(f);
        notify("study_question_flags", "INSERT", f);
        rehide(q);
        // "return=representation" (insert(...).select(...)): the row as stored, with its id.
        const sel = query.get("select");
        if (!sel) return json(null, 201);
        const cols = parseSelect(sel).cols;
        check.cols(table, cols, where);
        const stored = Object.fromEntries(cols.map((c) => [c, f[c] === undefined ? null : f[c]]));
        return json(single ? stored : [stored], 201);
      }
      if (table === "study_question_flags" && method === "DELETE") {
        const id = (query.get("id") || "").replace(/^eq\./, "");
        const gone = P.flags.filter((f) => f.id === id && f.user_id === me);
        P.flags = P.flags.filter((f) => !gone.includes(f));
        for (const g of gone) notify("study_question_flags", "DELETE", {}, g);
        for (const g of gone) rehide(qOf(g.question_id));
        return json(null, 200);
      }
      return refuse(`${method} ${table} not allowed`, 403);
    }

    /* ── functions ── */
    if (!path.startsWith("/rest/v1/rpc/")) return undefined;
    const fn = path.slice("/rest/v1/rpc/".length);
    const mine = () => P.answers.filter((a) => a.user_id === me);
    const latestOf = () => {
      const by = new Map();
      for (const a of mine()) {
        const cur = by.get(a.question_id);
        by.set(a.question_id, { last: !cur || a.answered_at >= cur.last.answered_at ? a : cur.last, times: (cur?.times ?? 0) + 1 });
      }
      return by;
    };
    // study_open_mistakes: wrong until answered right on a later study day (review UX-2).
    const openMistakes = (groupId) => {
      const out = [];
      const wrong = new Map();
      for (const a of mine()) if (!a.correct && (!wrong.has(a.question_id) || a.answered_at > wrong.get(a.question_id))) wrong.set(a.question_id, a.answered_at);
      for (const [qid, at] of wrong) {
        const q = qOf(qid);
        if (!q || q.group_id !== groupId || q.retired_at) continue;
        const wrongDay = mine()
          .filter((a) => a.question_id === qid && !a.correct)
          .map((a) => studyDay(a.answered_at))
          .sort()
          .pop();
        if (mine().some((a) => a.question_id === qid && a.correct && studyDay(a.answered_at) > wrongDay)) continue;
        out.push({ question_id: qid, wrong_at: at });
      }
      return out.sort((a, b) => (a.wrong_at < b.wrong_at ? -1 : 1));
    };
    const RPCS = new Set([
      "study_question_round",
      "study_answer_question",
      "study_question_feedback",
      "study_practice_overview",
      "study_my_mistakes",
      "study_open_mistakes",
      "study_my_latest",
      "study_my_topic_stats",
      "study_retire_question",
      "study_points_state",
      "study_request_progress",
      "study_draft_keep",
      "study_draft_keep_all",
      "study_draft_remove",
      "study_session_counts",
      "study_question_whens",
      "study_question_for_fix",
      "study_question_fix",
    ]);
    if (!RPCS.has(fn)) return undefined;
    check.rpc(fn, body, where);
    if (!me || !isMember) return refuse("not signed in", 401);
    switch (fn) {
      case "study_question_round": {
        const lecture = lectureOf(body.p_lecture);
        if (!lecture || lecture.deleted_at) return refuse("lecture not found");
        const mineB = P.batches.filter((b) => b.lecture_id === lecture.id);
        const last = mineB.length ? Math.max(...mineB.map((b) => b.round)) : 0;
        const open = mineB.filter((b) => b.round === last && (b.status === "pending" || b.status === "writing"));
        if (last && open.length) return json([{ round: last, batches: open.length, fresh: false }]);
        if (P.questions.filter((q) => q.lecture_id === lecture.id && !q.retired_at).length >= 80) return refuse("enough questions");
        // The SQL's plan: one question per 2.5 slides (6-25), shared by slide count, largest remainder, at most 5 a part.
        const parts = db.sections.filter((s) => s.lecture_id === lecture.id).map((s) => ({ part_idx: s.idx, heading: s.title, from: s.slide_from, to: s.slide_to, n: s.slide_to - s.slide_from + 1 }));
        const total = parts.reduce((n, p) => n + p.n, 0);
        const t = Math.min(25, Math.max(6, Math.round(total / 2.5)));
        const base = parts.map((p) => ({ ...p, fl: Math.floor((t * p.n) / total), rem: (t * p.n) / total - Math.floor((t * p.n) / total) }));
        const extra = t - base.reduce((n, p) => n + p.fl, 0);
        const ranked = [...base].sort((a, b) => b.rem - a.rem || a.part_idx - b.part_idx);
        const round = last + 1;
        let made = 0;
        for (const p of base) {
          const wanted = Math.min(5, p.fl + (ranked.indexOf(p) < extra ? 1 : 0));
          if (wanted < 1) continue;
          const t0 = now();
          const b = { id: hex("ba000000", ++P.seq.batch), lecture_id: lecture.id, round, part_idx: p.part_idx, heading: p.heading, slide_from: p.from, slide_to: p.to, wanted, status: "pending", made: 0, rejected: 0, model: null, cost_usd: 0, error: null, attempts: 0, created_by: me, created_at: t0, updated_at: t0 };
          P.batches.push(b);
          notify("study_question_batches", "INSERT", b);
          made += 1;
        }
        if (!made) return refuse("no slides");
        return json([{ round, batches: made, fresh: true }]);
      }
      case "study_answer_question": {
        const q = qOf(body.p_question);
        if (!q) return refuse("question not found");
        if (q.retired_at) return refuse("retired");
        const k = P.keys.get(q.id);
        if (P.inQuiz?.has(q.id)) return refuse("in quiz"); // an open live-quiz round holds its key
        if (!k || k.answer === null) return refuse("no key");
        const choice = body.p_choice === null || body.p_choice === undefined ? null : Number(body.p_choice);
        if (choice !== null && (choice < 0 || choice >= q.options.length)) return refuse("bad choice");
        if (!["lecture", "course", "mistakes", "quiz", "exam"].includes(body.p_mode ?? "lecture")) return refuse("bad mode");
        if (q.hidden_at) return refuse("hidden");
        const bet = body.p_confidence ?? null;
        if (bet !== null && ![1, 2, 3].includes(bet)) return refuse("bad bet");
        const correct = choice === k.answer;
        P.answers.push({ user_id: me, question_id: q.id, choice, correct, mode: body.p_mode ?? "lecture", ms: body.p_ms ?? null, confidence: bet, answered_at: now() });
        return json([{ answer: k.answer, explanations: k.explanations, takeaway: k.takeaway, correct, whens: k.whens ?? [] }]);
      }
      case "study_question_feedback": {
        const answered = new Set(mine().map((a) => a.question_id));
        return json((body.p_ids || []).filter((id) => answered.has(id) && P.keys.has(id)).map((id) => ({ question_id: id, ...P.keys.get(id) })));
      }
      case "study_practice_overview": {
        const latest = latestOf();
        const wrongNow = new Set(openMistakes(body.p_group).map((m) => m.question_id));
        const by = new Map();
        for (const q of P.questions.filter((x) => x.group_id === body.p_group && !x.retired_at && x.has_key)) {
          const k = q.lecture_id ?? `exam:${q.exam_id}`;
          const row = by.get(k) ?? { lecture_id: q.lecture_id, exam_id: q.exam_id, questions: 0, answered: 0, wrong_now: 0, last_at: null };
          row.questions += 1;
          const l = latest.get(q.id);
          if (l) {
            row.answered += 1;
            if (!row.last_at || l.last.answered_at > row.last_at) row.last_at = l.last.answered_at;
          }
          if (wrongNow.has(q.id)) row.wrong_now += 1;
          by.set(k, row);
        }
        return json([...by.values()]);
      }
      case "study_my_mistakes":
      case "study_open_mistakes":
        return json(openMistakes(body.p_group).filter((m) => !body.p_lecture || qOf(m.question_id)?.lecture_id === body.p_lecture));
      case "study_my_latest":
        return json([...latestOf()].filter(([qid]) => qOf(qid)?.group_id === body.p_group).map(([qid, x]) => ({ question_id: qid, correct: x.last.correct, answered_at: x.last.answered_at, times: x.times })));
      case "study_my_topic_stats":
        return json([]);
      case "study_points_state":
        return json(pointsState(db, P, body.p_lecture));
      case "study_request_progress": {
        const rq = P.qrequests.find((r) => r.id === body.p_request);
        if (!rq) return refuse("request not found");
        return json(
          rq.parts.map((idx) => {
            const ds = P.drafts.filter((d) => d.request_id === rq.id && d.part_idx === idx);
            const live = ds.filter((d) => (d.status === "pending" || d.status === "kept") && d.check_state !== "failed");
            const pts = P.points.filter((x) => rq.points.includes(x.id) && x.part_idx === idx);
            const covered = new Set(live.flatMap((d) => d.points).filter((id) => pts.some((x) => x.id === id)));
            const bs = P.batches.filter((b) => b.request_id === rq.id && b.part_idx === idx);
            return {
              part_idx: idx, title: db.sections.find((x) => x.lecture_id === rq.lecture_id && x.idx === idx)?.title ?? "", points: pts.length, covered: covered.size,
              wanted: bs.reduce((n, b) => n + b.wanted, 0), made: ds.filter((d) => d.status === "pending" || d.status === "kept").length,
              kept: ds.filter((d) => d.status === "kept").length, pending: ds.filter((d) => d.status === "pending").length,
              checking: ds.filter((d) => d.status === "pending" && d.check_state === "checking").length, failed: ds.filter((d) => d.status === "pending" && d.check_state === "failed").length,
              open: bs.some((b) => b.status === "pending" || b.status === "writing"),
            };
          }),
        );
      }
      case "study_draft_keep":
      case "study_draft_remove": {
        const d = P.drafts.find((x) => x.id === body.p_draft);
        if (!d) return refuse("draft not found");
        if (d.status !== "pending") return refuse("not pending");
        if (d.lease_until && Date.parse(d.lease_until) > Date.now()) return refuse("busy");
        if (fn === "study_draft_remove") {
          Object.assign(d, { status: "removed", decided_by: me, decided_at: now(), updated_at: now() });
          notify("study_question_drafts", "UPDATE", d);
          return json(null);
        }
        if (!["ok", "unchecked"].includes(d.check_state)) return refuse("not checked");
        return json(keepToBank(d, me));
      }
      case "study_draft_keep_all": {
        const rq = P.qrequests.find((r) => r.id === body.p_request);
        if (!rq) return refuse("request not found");
        const out = [];
        for (const d of P.drafts.filter((x) => x.request_id === rq.id && x.status === "pending" && ["ok", "unchecked"].includes(x.check_state) && !(x.lease_until && Date.parse(x.lease_until) > Date.now())).sort((a, b) => a.part_idx - b.part_idx || (a.created_at < b.created_at ? -1 : 1)))
          out.push({ draft_id: d.id, question_id: keepToBank(d, me) });
        return json(out);
      }
      case "study_session_counts": {
        const wrong = new Set(openMistakes(db.group.id).map((m) => m.question_id));
        const answered = new Set(mine().map((a) => a.question_id));
        const cells = new Map();
        for (const q of P.questions.filter((x) => (body.p_lectures || []).includes(x.lecture_id) && !x.retired_at && !x.hidden_at && !x.stale_at && x.has_key)) {
          const style = q.style ?? (q.kind === "case" ? "case" : "other");
          const state = wrong.has(q.id) ? "wrong" : answered.has(q.id) ? "right" : "new";
          const flagged = P.flags.some((f) => f.question_id === q.id && f.user_id === me);
          const k = [q.lecture_id, q.part_idx ?? -1, style, state, flagged].join("|");
          const c = cells.get(k) ?? { lecture_id: q.lecture_id, part_idx: q.part_idx ?? -1, style, state, flagged, n: 0 };
          c.n += 1;
          cells.set(k, c);
        }
        return json([...cells.values()]);
      }
      case "study_question_whens": {
        const answered = new Set(mine().map((a) => a.question_id));
        return json((body.p_ids || []).filter((id) => answered.has(id) && P.keys.has(id)).map((id) => ({ question_id: id, whens: P.keys.get(id).whens ?? [] })));
      }
      case "study_question_for_fix": {
        const q = qOf(body.p_question);
        if (!q) return refuse("question not found");
        if (!q.hidden_at) return refuse("not flagged");
        const k = P.keys.get(q.id);
        return json([{ answer: k.answer, explanations: k.explanations, takeaway: k.takeaway, whens: k.whens ?? [], hidden: true, flags: P.flags.filter((f) => f.question_id === q.id).map((f) => ({ reason: f.reason, note: f.note, at: f.created_at })) }]);
      }
      case "study_question_fix": {
        const q = qOf(body.p_question);
        if (!q) return refuse("question not found");
        if (!["keep", "retire"].includes(body.p_verdict)) return refuse("bad verdict");
        if (!q.hidden_at) return refuse("not flagged");
        const n = lectureOf(q.lecture_id)?.slides.length ?? 0;
        const sl = body.p_slides || [];
        if (body.p_verdict === "keep" && (sl.length < 1 || sl.length > 6 || sl.some((x) => x < 1 || x > n))) return refuse("bad source");
        Object.assign(q, { hidden_at: null, fixed_by: me, fixed_at: now(), fix_slides: sl, fix_note: String(body.p_note || "").trim() });
        if (body.p_verdict === "retire") Object.assign(q, { retired_at: now(), retired_by: me, retire_note: q.fix_note });
        P.fixes = [...(P.fixes ?? []), { question_id: q.id, verdict: body.p_verdict, slides: sl, note: q.fix_note, by: me }];
        notify("study_questions", "UPDATE", q);
        return json(null);
      }
      case "study_retire_question":
        // Revoked from members (package Q's review, finding Q2; SEC-13): only the owner retires a question.
        return refuse("permission denied for function study_retire_question", 403);
    }
    return undefined;
  },

  async api(req, res, db, body) {
    const P = db.practice;
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    // Op "questions" only: another package's op (cards) is its plugin's, and the mock reads
    // the body once and hands it over (mock.cjs).
    if (!P || p !== "/api/study/ai" || req.method !== "POST" || body?.op !== "questions") return undefined;
    const send = (out, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return true;
    };
    const me = userOfToken((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!me || !db.members.some((m) => m.user_id === me)) return send({ error: "not signed in" }, 401);
    const lectureId = String(body.lectureId || "").toLowerCase();
    const batchId = String(body.batchId || "").toLowerCase();
    const notify = (...a) => P.notify?.(...a);
    if (body.action !== undefined && body.action !== "write") return p2Action({ req, res, db, P, body, me, lectureId, send, notify });
    const b = P.batches.find((x) => x.id === batchId);
    if (!b) return send({ error: "batch not found" }, 404);
    if (b.lecture_id !== lectureId) return send({ error: "batch of another lecture" }, 400);
    const log = { batch: b.id, part: b.part_idx, round: b.round, user: me, start: Date.now(), startLine: null, end: null, status: 200 };
    P.requests.push(log);
    const touch = (patch) => {
      Object.assign(b, patch, { updated_at: now() });
      notify("study_question_batches", "UPDATE", b);
    };
    const lecture = db.lectures.find((l) => l.id === lectureId);
    const save = (who) => {
      const item = b.round === 1 && ROUND1[b.part_idx] ? ROUND1[b.part_idx] : plainItem(b.round, b);
      const n = ++P.seq.question;
      const s = stored(item, n % 5);
      const q = {
        id: hex("9a000000", n), group_id: lecture.group_id, lecture_id: lecture.id, batch_id: b.id, exam_id: null, exam_no: null, ref_lecture: null, source: "ai",
        part_idx: b.part_idx, kind: s.kind, difficulty: s.difficulty, vignette: s.vignette, question: s.question, options: s.options, slides: s.slides,
        topic: s.topic, aspect: s.aspect, has_key: true, model: "mock", created_by: who, created_at: now(), retired_at: null, retired_by: null, retire_note: "",
      };
      P.questions.push(q);
      P.keys.set(q.id, { answer: s.answer, explanations: s.explanations, takeaway: s.takeaway });
      notify("study_questions", "INSERT", q);
      touch({ made: b.made + 1 });
      return q;
    };

    // The claim (study_question_claim): busy, gave up, or this request's.
    if (P.busy(b) && !P.busyDone.has(b.id)) {
      P.busyDone.add(b.id);
      log.status = 409;
      // Another phone (נועה's) holds the part, and finishes it a moment later.
      touch({ status: "writing", attempts: b.attempts + 1 });
      const other = db.members.find((m) => m.user_id !== me)?.user_id ?? me;
      setTimeout(() => {
        while (b.made < b.wanted) save(other);
        touch({ status: "ready" });
      }, 3000);
      return send({ error: "busy" }, 409);
    }
    const stale = b.status === "writing" && Date.now() - Date.parse(b.updated_at) > SIX_MINUTES;
    if (b.attempts >= 3 && b.status !== "ready") return send({ error: "gave up" }, 409);
    if (!(b.status === "pending" || b.status === "failed" || stale)) {
      log.status = 409;
      return send({ error: "busy" }, 409);
    }
    touch({ status: "writing", attempts: b.attempts + 1, error: null });
    if (P.budget) {
      log.status = 402;
      touch({ status: "failed", error: "budget" });
      return send({ error: "budget" }, 402);
    }

    if (b.request_id) return p2Write({ res, db, P, b, me, log, touch, notify });

    db.calls.push(`ledger study_reserve kind=practice ref=${b.id} p_key=1`);
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.write("​");
    while (P.hold(b)) await pause(50);
    await pause(P.pace.start);
    res.write('{"t":"start"}\n');
    log.startLine = Date.now();
    P.lines.push('{"t":"start"}');
    if (P.fail(b) && !P.failDone.has(b.id)) {
      P.failDone.add(b.id);
      await pause(P.pace.line);
      db.calls.push(`ledger study_settle kind=practice ref=${b.id} p_key=1`);
      touch({ status: "failed", error: "timeout" });
      log.end = Date.now();
      res.end("\n\u0000ERROR timeout");
      return true;
    }
    let made = 0;
    while (b.made < b.wanted) {
      await pause(P.pace.line);
      const q = save(me);
      made += 1;
      const line = JSON.stringify({ t: "q", q: { id: q.id, part_idx: q.part_idx, kind: q.kind, difficulty: q.difficulty, vignette: q.vignette, question: q.question, options: q.options, slides: q.slides, topic: q.topic, aspect: q.aspect } });
      P.lines.push(line);
      res.write(line + "\n");
    }
    db.calls.push(`ledger study_settle kind=practice ref=${b.id} p_key=1`);
    touch({ status: "ready" });
    log.end = Date.now();
    const done = JSON.stringify({ t: "done", made, rejected: 0, costUsd: Math.round(0.019 * made * 1e6) / 1e6, unsettled: 0 });
    P.lines.push(done);
    res.end(done + "\n");
    return true;
  },
};

/* ── practice 2.0's op actions ── */
const STYLE_SIG = "a".repeat(64);

/** A request's batch: drafts as they are written, then the blind solver's verdicts, and the server's one rewrite of a draft it got wrong. */
async function p2Write({ res, db, P, b, me, log, touch, notify }) {
  const rq = P.qrequests.find((r) => r.id === b.request_id);
  const section = db.sections.find((x) => x.lecture_id === b.lecture_id && x.idx === b.part_idx);
  db.calls.push(`ledger study_reserve kind=practice ref=${b.id} p_key=1`);
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.write("\u200b");
  while (P.hold(b)) await pause(50);
  await pause(P.pace.start);
  const line = (x) => {
    const t = JSON.stringify(x);
    P.lines.push(t);
    res.write(t + "\n");
  };
  line({ t: "start" });
  log.startLine = Date.now();
  if (P.fail(b) && !P.failDone.has(b.id)) {
    P.failDone.add(b.id);
    await pause(P.pace.line);
    db.calls.push(`ledger study_settle kind=practice ref=${b.id} p_key=1`);
    touch({ status: "failed", error: "timeout" });
    log.end = Date.now();
    res.end("\n\u0000ERROR timeout");
    return true;
  }
  const per = Math.max(1, Math.ceil(b.points.length / Math.max(1, b.wanted)));
  const made = [];
  const save = (k, rewrite, replaces) => {
    const style = b.styles[k] ?? rq.styles[0];
    const item = draftItem(section, style, k + b.seq * 5 + (rewrite ? 7 : 0), rewrite);
    const t = now();
    const d = {
      id: hex("d4000000", ++P.seq.draft), group_id: db.group.id, lecture_id: b.lecture_id, request_id: rq.id, batch_id: b.id, part_idx: b.part_idx, style,
      points: b.points.slice(k * per, k * per + per), kind: item.kind, difficulty: 2, vignette: item.vignette, question: item.question, options: item.options,
      slides: item.slides, topic: section.title.replace(/[^A-Za-z ,+-]/g, "").trim() || "Diuretics", aspect: "other", anchor: k % 3, quote: "", part_gen: section.gen ?? 0,
      teaser: "", figure: "", option_tags: [], status: "pending", check_state: "checking", rewrites: rewrite ? 1 : 0, replaces: replaces ?? null, lease_until: null,
      question_id: null, model: "mock", created_by: rq.created_by, decided_by: null, decided_at: null, created_at: t, updated_at: t,
    };
    P.drafts.push(d);
    P.draftKeys.set(d.id, { answer: item.answer, explanations: item.explanations, takeaway: item.takeaway, whens: item.whens });
    notify("study_question_drafts", "INSERT", d);
    line({ t: "draft", d: draftLine(d), ...(replaces ? { replaces } : {}) });
    return d;
  };
  for (let k = 0; k < b.wanted; k++) {
    await pause(P.p2pace);
    made.push({ k, d: save(k, false) });
    touch({ made: b.made + 1 });
  }
  // The blind solver: one call after the writer's.
  db.calls.push(`ledger study_reserve kind=solver ref=${b.id} p_key=1`);
  await pause(P.p2pace);
  const failed = [];
  for (const { k, d } of made) {
    const state = P.unchecked(d, k) ? "unchecked" : P.solverFails(d, k) ? "failed" : "ok";
    Object.assign(d, { check_state: state, updated_at: now() });
    notify("study_question_drafts", "UPDATE", d);
    line({ t: "check", id: d.id, state });
    if (state === "failed") failed.push({ k, d });
  }
  db.calls.push(`ledger study_settle kind=solver ref=${b.id} p_key=1`);
  let rejected = 0;
  for (const { k, d } of failed) {
    await pause(P.p2pace * 2);
    if (P.solverStillFails(d)) {
      Object.assign(d, { status: "rejected", updated_at: now() });
      notify("study_question_drafts", "UPDATE", d);
      line({ t: "drop", id: d.id });
      rejected += 1;
      continue;
    }
    Object.assign(d, { status: "replaced", updated_at: now() });
    notify("study_question_drafts", "UPDATE", d);
    const again = save(k, true, d.id);
    Object.assign(again, { check_state: "ok" });
    notify("study_question_drafts", "UPDATE", again);
    line({ t: "check", id: again.id, state: "ok" });
  }
  db.calls.push(`ledger study_settle kind=practice ref=${b.id} p_key=1`);
  touch({ status: "ready" });
  log.end = Date.now();
  const done = JSON.stringify({ t: "done", made: b.wanted - rejected, rejected, solverRejected: rejected, costUsd: Math.round(0.025 * b.wanted * 1e6) / 1e6, unsettled: 0 });
  P.lines.push(done);
  res.end(done + "\n");
  return true;
}

async function p2Action({ res, db, P, body, me, lectureId, send, notify }) {
  const lecture = db.lectures.find((l) => l.id === lectureId);
  P.p2calls.push({ action: body.action, body, user: me, at: Date.now() });
  if (!lecture) return send({ error: "lecture not found" }, 404);
  const stream = () => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.write("\u200b");
    return (x) => {
      const t = JSON.stringify(x);
      P.lines.push(t);
      res.write(t + "\n");
    };
  };
  switch (body.action) {
    case "plan": {
      const r = readOptions(body.options);
      if (r.code) return send({ error: r.code }, 400);
      return send(planOf(db, P, lectureId, r.options).answer);
    }
    case "points": {
      // As server/study/points.ts reads them: the stale parts claimed at once (one updated_at), each
      // part its own call, six at once, each reserved and settled, saved or failed as its call ends,
      // its line written at once; the reading goes on when the phone closes the stream.
      const state = pointsState(db, P, lectureId);
      if (state.some((p) => p.busy)) return send({ error: "busy" }, 409);
      if (!state.some((p) => p.summary === "ready")) return send({ error: "summary not ready" }, 409);
      const stale = state.filter((p) => p.summary === "ready" && !p.current);
      res.on("error", () => undefined);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.write("\u200b");
      const out = (x) => {
        const t = JSON.stringify(x);
        P.lines.push(t);
        if (!res.destroyed && !res.writableEnded) res.write(t + "\n");
      };
      if (!stale.length) {
        out({ t: "done", parts: 0, points: 0, costUsd: 0, unsettled: 0 });
        res.end();
        return true;
      }
      const claimedAt = now();
      for (const p of stale) {
        const stall = P.pointsStall?.(lectureId, p.part_idx) ?? false;
        const was = P.pointParts.get(`${lectureId}:${p.part_idx}`);
        const pp = {
          lecture_id: lectureId, part_idx: p.part_idx, src_md5: "x", try_md5: "y", status: "writing", attempts: (was?.attempts ?? 0) + 1,
          // A part whose server dies keeps its claim until the lease runs out (no event says so).
          lease_until: new Date(Date.now() + (stall ? P.stallMs : 6 * 60_000)).toISOString(), error: null, model: "mock", cost_usd: 0, updated_at: claimedAt, src: was?.src,
        };
        P.pointParts.set(`${lectureId}:${p.part_idx}`, pp);
        notify("study_point_parts", "UPDATE", pp);
      }
      P.pointReads = [...(P.pointReads ?? []), { lectureId, parts: stale.map((p) => p.part_idx), at: Date.now(), user: me }];
      const done = { parts: 0, points: 0 };
      let started = false;
      const readPart = async (p) => {
        const key = `${lectureId}:${p.part_idx}`;
        if (P.pointsStall?.(lectureId, p.part_idx)) return; // the server died with it
        P.pointCalls = (P.pointCalls ?? 0) + 1;
        db.calls.push(`ledger study_reserve kind=points ref=${lectureId} p_key=1`);
        if (!started) {
          started = true;
          await pause(P.pace.start);
          out({ t: "start" });
        }
        await pause(P.pointsDelay ? P.pointsDelay(lectureId, p.part_idx) : P.p2pace * (1 + (p.part_idx % 3)));
        db.calls.push(`ledger study_settle kind=points ref=${lectureId} p_key=1`);
        const pp = P.pointParts.get(key);
        const why = P.pointsFail?.(lectureId, p.part_idx) ?? null;
        if (why) {
          Object.assign(pp, { status: "failed", error: why, lease_until: null, updated_at: now() });
          notify("study_point_parts", "UPDATE", pp);
          out({ t: "fail", part: p.part_idx, why });
          return;
        }
        const section = db.sections.find((x) => x.lecture_id === lectureId && x.idx === p.part_idx);
        P.points = P.points.filter((x) => !(x.lecture_id === lectureId && x.part_idx === p.part_idx));
        const n = P.pointsPer[p.part_idx] ?? 3;
        for (let i = 0; i < n; i++)
          P.points.push({
            id: hex("b0170000", ++P.seq.point), lecture_id: lectureId, part_idx: p.part_idx, n: i, kind: KINDS[i % KINDS.length], subject: WORDS[(p.part_idx + i) % WORDS.length],
            text: `נקודה ${i + 1} של ${section.title}`, anchor: i, quote: "", slides: [section.slide_from], red_flag: i < (RED_FLAGS[p.part_idx] ?? 0), weight: i === 0 ? 3 : 2, created_at: now(), updated_at: now(),
          });
        Object.assign(pp, { status: "ready", src: section.markdown, lease_until: null, attempts: 0, updated_at: now() });
        notify("study_point_parts", "UPDATE", pp);
        done.parts += 1;
        done.points += n;
        out({ t: "part", part: p.part_idx, points: n });
      };
      const queue = [...stale];
      await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
        while (queue.length) await readPart(queue.shift());
      }));
      out({ t: "done", parts: done.parts, points: done.points, costUsd: 0.13, unsettled: 0 });
      if (!res.destroyed && !res.writableEnded) res.end();
      return true;
    }
    case "style": {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const image = body.image && typeof body.image.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(body.image.mediaType) ? body.image : null;
      if ((!text && !image) || text.length > 3000) return send({ error: "bad example" }, 400);
      db.calls.push(`ledger study_reserve kind=style ref=${lectureId} p_key=1`);
      await pause(P.pace.line);
      db.calls.push(`ledger study_settle kind=style ref=${lectureId} p_key=1`);
      P.styleReads = [...(P.styleReads ?? []), { text, image: Boolean(image) }];
      return send({
        description: "מקרה של 2-3 שורות עם גיל, מין ונסיעה, חמש אפשרויות, ושאלה על הצעד הבא. בעברית, עם המונחים באנגלית.",
        example: text || "שאלה מהתמונה", optionCount: 5, case: true, sig: STYLE_SIG, costUsd: 0.008, unsettled: 0,
      });
    }
    case "create": {
      const r = readOptions(body.options);
      if (r.code) return send({ error: r.code }, 400);
      const plan = planOf(db, P, lectureId, r.options);
      if (plan.stale.length) return send({ error: "points stale" }, 409);
      if (!plan.total) return send({ error: "no points" }, 400);
      const last = Math.max(0, ...P.batches.filter((b) => b.lecture_id === lectureId).map((b) => b.round));
      const chosen = plan.counts.map((c) => c.part_idx);
      const pointIds = P.points.filter((x) => x.lecture_id === lectureId && chosen.includes(x.part_idx)).map((x) => x.id);
      const t = now();
      const rq = {
        id: hex("ae000000", ++P.seq.request), group_id: db.group.id, lecture_id: lectureId, round: last + 1, level: r.options.level, count: plan.total, parts: chosen,
        styles: r.options.styles, difficulty: r.options.difficulty, style_note: r.options.style?.description ?? "", style_example: r.options.style?.example ?? "", focus: r.options.focus.trim(),
        points: pointIds, created_by: me, created_at: t,
      };
      P.qrequests.push(rq);
      notify("study_question_requests", "INSERT", rq);
      const batches = [];
      let slot = 0;
      plan.counts.forEach((c, i) => {
        const pts = P.points.filter((x) => x.lecture_id === lectureId && x.part_idx === c.part_idx).map((x) => x.id);
        const sizes = batchSizes(plan.q[i]);
        let at = 0;
        sizes.forEach((wanted, seq) => {
          const take = Math.ceil((pts.length * wanted) / Math.max(1, plan.q[i]));
          const styles = Array.from({ length: wanted }, () => rq.styles[slot++ % rq.styles.length]);
          const s = db.sections.find((x) => x.lecture_id === lectureId && x.idx === c.part_idx);
          const b = {
            id: hex("ba000000", ++P.seq.batch), lecture_id: lectureId, round: rq.round, part_idx: c.part_idx, heading: s.title, slide_from: s.slide_from, slide_to: s.slide_to, wanted,
            status: "pending", made: 0, rejected: 0, model: null, cost_usd: 0, error: null, attempts: 0, created_by: me, created_at: t, updated_at: t,
            request_id: rq.id, seq, points: pts.slice(at, at + take), styles,
          };
          at += take;
          P.batches.push(b);
          notify("study_question_batches", "INSERT", b);
          batches.push(b);
        });
      });
      return send({
        request: { id: rq.id, round: rq.round, level: rq.level, count: rq.count, parts: rq.parts, styles: rq.styles, difficulty: rq.difficulty },
        batches: batches.map((b) => ({ id: b.id, part_idx: b.part_idx, seq: b.seq, wanted: b.wanted })),
        plan: plan.answer.plan.parts,
        estimate: { questionsUsd: plan.answer.estimate.questionsUsd },
      });
    }
    case "reword": {
      const d = P.drafts.find((x) => x.id === String(body.draftId || "").toLowerCase());
      if (!d) return send({ error: "draft not found" }, 404);
      if (typeof body.note === "string" && body.note.trim().length > 200) return send({ error: "note too long" }, 400);
      if (d.status !== "pending") return send({ error: "not pending" }, 409);
      if (d.lease_until && Date.parse(d.lease_until) > Date.now()) return send({ error: "busy" }, 409);
      Object.assign(d, { lease_until: new Date(Date.now() + 120_000).toISOString(), updated_at: now() });
      notify("study_question_drafts", "UPDATE", d);
      P.rewords = [...(P.rewords ?? []), { draft: d.id, note: body.note ?? "" }];
      db.calls.push(`ledger study_reserve kind=reword ref=${d.id} p_key=1`);
      const out = stream();
      await pause(P.pace.start);
      out({ t: "start" });
      await pause(P.p2pace * 2);
      const section = db.sections.find((x) => x.lecture_id === d.lecture_id && x.idx === d.part_idx);
      const item = draftItem(section, d.style, 11 + (P.rewords.length % 5), true);
      const t = now();
      const nd = { ...d, id: hex("d4000000", ++P.seq.draft), vignette: item.vignette, question: item.question, options: item.options, rewrites: d.rewrites + 1, replaces: d.id, check_state: "checking", lease_until: null, created_at: t, updated_at: t };
      P.drafts.push(nd);
      P.draftKeys.set(nd.id, { answer: item.answer, explanations: item.explanations, takeaway: item.takeaway, whens: item.whens });
      Object.assign(d, { status: "replaced", lease_until: null, updated_at: t });
      notify("study_question_drafts", "UPDATE", d);
      notify("study_question_drafts", "INSERT", nd);
      out({ t: "draft", d: draftLine(nd), replaces: d.id });
      await pause(P.p2pace);
      Object.assign(nd, { check_state: "ok", updated_at: now() });
      notify("study_question_drafts", "UPDATE", nd);
      out({ t: "check", id: nd.id, state: "ok" });
      db.calls.push(`ledger study_settle kind=reword ref=${d.id} p_key=1`);
      out({ t: "done", made: 1, rejected: 0, solverRejected: 0, costUsd: 0.03, unsettled: 0 });
      res.end();
      return true;
    }
    default:
      return send({ error: "bad action" }, 400);
  }
}
