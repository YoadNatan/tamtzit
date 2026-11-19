import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BOSS_NOT_COUNTED, failShort, failText, hasText, INTERNAL_CODES, isInternal, type Area } from "./failText";

/* F-13 (review FE-19; §12.2.7, §12.7.4): every exception the SQL can raise
 * reaches a screen as words. Each `raise exception '…'` of §3's SQL
 * (docs/study/spec/sql), of today's supabase/study-schema.sql and of §12's
 * SQL (docs/study/spec/addendum/sql), and each text a `raise exception '%',
 * why` can carry (the literals its *_problem function returns), must be in
 * failText, QUIZ_ERROR_TEXT, authErrorText or INTERNAL_CODES; and each of
 * §12's has words in every area whose screens call the function that raises
 * it, or is internal there. §12.7.4's own rows are failText's, word for word.
 * QUIZ_ERROR_TEXT and authErrorText belong to packages Z and A: once their
 * files exist the test reads their keys from them; until then it holds them
 * to the codes §4.11 and §12 give those maps. A load-time guard (a top-level
 * `do $$` block that stops the SQL editor's run) is not a code.
 *
 * The same for the ops of /api/study/ai (packages Q, C and K): every code an
 * op can answer before its stream (an HttpError's code), or end it with (a
 * part's reason, a check's 400), has words in the area its screen passes to
 * failText, or is in INTERNAL_CODES. */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const ADDENDUM_SQL = join("docs", "study", "spec", "addendum", "sql");
const addendumFiles = readdirSync(join(root, ADDENDUM_SQL))
  .filter((f) => f.endsWith(".sql"))
  .sort();
/** Load-time guards: top-level DO blocks, which no app call reaches. */
const noGuards = (sql: string) => sql.replace(/^do \$(\w*)\$[\s\S]*?^end \$\1\$;/gm, "");
const ADDENDUM = noGuards(addendumFiles.map((f) => read(join(ADDENDUM_SQL, f))).join("\n"));
const SQL = [read("docs/study/spec/sql/schema-additions.sql"), read("supabase/study-schema.sql"), ADDENDUM].map(noGuards).join("\n");

/** The literals a *_problem function returns (the texts of its callers' `raise exception '%', why`). */
function problemTexts(fn: string): string[] {
  const body = new RegExp(`create or replace function (?:public|study_private)\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`).exec(SQL)?.[0] ?? "";
  assert.ok(body, `the body of ${fn}`);
  return [...body.matchAll(/return '([^']+)'/g)].map((m) => m[1]);
}
function raisedIn(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/raise exception '([^'%]+)'/g)) out.add(m[1]);
  // raise exception '%', why  ←  why := public.study_x_problem(…): every text that function returns
  // (a function that only returns when there is a problem raises none of them).
  if (!/raise exception '%'/.test(sql)) return out;
  for (const fn of new Set([...sql.matchAll(/:=\s*(?:public|study_private)\.(\w+_problem)\(/g)].map((m) => m[1]))) {
    for (const t of problemTexts(fn)) out.add(t);
  }
  return out;
}

/** Keys of a map in a package's file, or the codes the spec gives it until the file exists. */
function packageCodes(file: string, pick: (src: string) => string[], fallback: string[]): { codes: Set<string>; from: string } {
  if (!existsSync(join(root, file))) return { codes: new Set(fallback), from: "§4.11 and §12.7.4" };
  return { codes: new Set(pick(read(file))), from: file };
}
const quiz = packageCodes(
  "src/study/lib/quiz.ts",
  (src) => {
    const block = /QUIZ_ERROR_TEXT[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src)?.[1] ?? "";
    return [...block.matchAll(/^\s*(?:"([^"]+)"|([a-z_]+))\s*:/gm)].map((m) => m[1] ?? m[2]);
  },
  [
    ...["quiz open", "no questions", "not open", "closed", "bad choice", "not playing", "too early", "not revealed", "not host", "host here", "quiz over", "quiz not found", "too late"],
    // §12: the meeting design's quiz rows (§8.1) and §12.3.Z's ("QUIZ_ERROR_TEXT + need 3, already, bad preset, bad bet")
    ...["bad preset", "bad parts", "meeting not found", "already", "bad bet", "bad count", "need 3"],
  ],
);
const auth = packageCodes(
  "src/study/lib/account.ts",
  (src) => [...src.matchAll(/case "([^"]+)":/g)].map((m) => m[1]),
  ["otp_expired", "over_email_send_rate_limit", "over_request_rate_limit", "otp_disabled", "email_exists", "email_address_invalid", "validation_failed", "email_address_not_authorized", "session_not_found", "not anonymous", "sign in first", "ticket not found", "confirm name"],
);

test("every exception the SQL raises has words, or is listed as internal (F-13, §12.2.7)", () => {
  const codes = raisedIn(SQL);
  assert.ok(codes.size > 150, `${codes.size} codes found in §3's and §12's SQL`);
  const missing = [...codes].filter((c) => !hasText(c) && !quiz.codes.has(c) && !auth.codes.has(c) && !isInternal(c));
  assert.deepEqual(missing, [], `codes with no Hebrew (quiz codes from ${quiz.from}, auth codes from ${auth.from})`);
});

/* ── §12.7.4: each of §12's raises has words in every area that calls it ──
 * The area of a function of §12's SQL: the screens that call it and show its
 * errors. Server-key functions are called by the op of that area, which
 * passes their errors on. "any": only every area's own rows count. */
const AREA_OF: Array<[RegExp, Area | "quiz" | "any"]> = [
  [/^study_(unclear_done|update_seen|today|needs_me|set_needs_me)$/, "today"],
  [/^study_aid_(hint|for_cards)$/, "cards"],
  [/^study_boss_loot$/, "quiz"], // the loot on Z's end screen (H's BossEnd)
  [/^study_quiz_/, "quiz"],
  [/^study_meeting_/, "meeting"],
  [/^study_(dispute_|slide_flag|lecture_log$)/, "dispute"],
  [/^study_pulse_/, "pulse"],
  [/^study_(museum_|trap_plaque)/, "museum"],
  [/^study_aid_/, "wall"],
  [/^study_(boss_|loot_done$)/, "boss"],
  [/^study_bank_/, "bank"],
  [/^study_(group_plan_|my_relearning$|exam_marks$)/, "plan"],
  [/^study_trap_/, "traps"],
  [/^study_(question_|answer_question$|save_question$|my_rewordings$|my_confusions$|paragraph_practice$)/, "practice"],
  [/^study_(add_card$|card_|save_card$|my_card_|my_deck$)/, "cards"],
  [/^(edit_apply|study_edit_block|study_undo_edit|study_propose_edit|study_approve_edit|study_withdraw_edit|study_edit_proposal_checked)$/, "corrections"],
  [/^study_ask_/, "ask"],
  [/^study_my_(readiness|danger_list|aspects|calibration)$/, "any"],
];

/** §12's functions that raise, each with its codes (problem functions' texts included). */
function addendumRaises(): Array<{ fn: string; codes: Set<string> }> {
  const out: Array<{ fn: string; codes: Set<string> }> = [];
  for (const m of ADDENDUM.matchAll(/create or replace function (?:public|study_private)\.(\w+)\(([\s\S]*?)\n\$\w*\$;/g)) {
    const codes = raisedIn(m[0]);
    if (codes.size) out.push({ fn: m[1], codes });
  }
  return out;
}

test("each of §12's raises has words in the area whose screens call it, or is internal there (§12.7.4)", () => {
  const fns = addendumRaises();
  assert.ok(fns.length > 100, `${fns.length} functions of §12 raise`);
  const unmapped = fns.filter(({ fn }) => !AREA_OF.some(([re]) => re.test(fn))).map(({ fn }) => fn);
  assert.deepEqual(unmapped, [], "every function of §12 that raises has the area its screens show it in");
  const missing: string[] = [];
  for (const { fn, codes } of fns) {
    const area = AREA_OF.find(([re]) => re.test(fn))![1];
    for (const c of codes) {
      const ok =
        area === "any"
          ? hasText(c, "writing") || isInternal(c)
          : area === "quiz"
            ? quiz.codes.has(c) || hasText(c, "writing") || isInternal(c)
            : hasText(c, area) || isInternal(c, area);
      if (!ok) missing.push(`${fn} (${area}): ${c}`);
    }
  }
  assert.deepEqual(missing, [], "a code a screen would show with the area's fallback");
});

/** Each op's area and its files; and what every op runs through (the router,
 *  the member's client, the ledger, the model call). The ops F seeds (J's,
 *  U's and E's) answer only "not built" until their packages (K-2 and V
 *  built theirs).
 *  (B's bank step is the worker's, in work.ts: no member's screen waits on it.) */
const OPS: Array<[Area, string[]]> = [
  [
    "practice",
    [
      "server/study/practice.ts",
      "server/study/questions.ts",
      "server/study/ops/practice.ts",
      // practice 2.0's actions, the points step, the blind solver, and the options a request may carry
      "server/study/practice2.ts",
      "server/study/points.ts",
      "server/study/solver.ts",
      "shared/study/practice2.ts",
    ],
  ],
  ["cards", ["server/study/cards.ts", "server/study/ops/cards.ts"]],
  ["ask", ["server/study/ask.ts"]],
  ["mnemonic", ["server/study/mnemonic.ts", "server/study/ops/wall.ts"]],
  ["museum", ["server/study/ops/pulse.ts"]],
  ["dispute", ["server/study/ops/var.ts"]],
  ["traps", ["server/study/ops/extras.ts"]],
  ["corrections", ["server/study/ops/fixcheck.ts"]],
];
const ROUTER = ["api/study/ai.ts", "server/study/study.ts", "server/study/budget.ts", "server/study/claude.ts"];

/** The codes a server file answers with: HttpError(status, "code"), a part's
 *  reason (error = "code"), what a check*Input function returns for a 400,
 *  what an options reader refuses with ({ ok: false, code: "code" }, sent
 *  as the op's 400), and errorText's own codes. */
function opCodes(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/new HttpError\(\s*[^,()]+,\s*"([^"]+)"\s*\)/g)) out.add(m[1]);
  for (const m of src.matchAll(/\{ ok: false, code: "([^"]+)" \}/g)) out.add(m[1]);
  for (const m of src.matchAll(/\berror = "([^"]+)"/g)) out.add(m[1]);
  for (const fn of src.matchAll(/export function (?:check\w*Input|errorText)\([\s\S]*?\n\}/g)) for (const m of fn[0].matchAll(/return "([^"]+)"/g)) out.add(m[1]);
  return out;
}
/** The area's fallback, which a code without words of its own gets. */
const fallbackOf = (area: Area) => failText("\u0000 no such code", area);

test("every code an op of /api/study/ai can answer has words in its area, or is internal (F-13, packages Q, C and K, and F's seeds)", () => {
  const shared = opCodes(ROUTER.map(read).join("\n"));
  const missing: string[] = [];
  const found: string[] = [];
  for (const [area, files] of OPS) {
    const codes = new Set([...opCodes(files.map(read).join("\n")), ...shared]);
    for (const c of codes) {
      found.push(`${area}:${c}`);
      if (!isInternal(c, area) && failText(c, area) === fallbackOf(area)) missing.push(`${area}:${c}`);
    }
  }
  // The scan finds them (e.g. the 400s of "לשאול", a part's refusal, a seed's 501), not nothing.
  for (const c of [
    "ask:no lectures",
    "ask:too long",
    "ask:bad history",
    "mnemonic:bad block",
    "practice:batch of another lecture",
    "cards:no claim",
    "cards:refusal",
    "practice:timeout",
    "dispute:busy",
    "dispute:not ready",
    "dispute:refusal",
    "traps:not built",
    // practice 2.0
    "practice:points stale",
    "practice:no example",
    "practice:count out of range",
    "practice:focus too long",
    "practice:note too long",
  ]) {
    assert.ok(found.includes(c), c);
  }
  assert.deepEqual(missing, [], "codes that would show only the area's fallback");
});

test("§12.7.4's own rows are failText's, word for word", () => {
  const md = read("docs/study/spec/addendum/addendum.md");
  const table = md.slice(md.indexOf("#### 12.7.4"), md.indexOf("#### 12.7.5"));
  const rows = [...table.matchAll(/^\| `([^`]+)` \| (\w+) \| (.+) \|$/gm)].map((m) => ({ code: m[1], area: m[2] as Area, text: m[3].trim() }));
  assert.ok(rows.length >= 13, `${rows.length} rows`);
  for (const r of rows) {
    if (r.code === "no heads") {
      // "the fun design's line, plus for a member the pulse does not count: "…""
      assert.equal(`"${BOSS_NOT_COUNTED}"`, /"([^"]+)"/.exec(r.text)?.[0], "no heads: the second line");
      assert.ok(hasText("no heads", "boss"), "no heads: the fun design's line");
      continue;
    }
    assert.equal(failText(r.code, r.area), r.text, `${r.area}:${r.code}`);
  }
  // The internal row: "`is reader`, `bad mode`, `checked` (wall, plan), `forbidden` (study_ask_to_group with an attempt)".
  assert.ok(isInternal("is reader") && isInternal("bad mode") && isInternal("checked", "wall") && isInternal("checked", "plan"));
  // `forbidden` keeps its words for every area (§6.3): the app never sends an attempt without the op's key.
  assert.ok(hasText("forbidden", "ask"));
});

test("INTERNAL_CODES lists only codes the SQL or the server raises, and none that has words where it is internal", () => {
  const codes = raisedIn(SQL);
  const server = [
    "server/study/study.ts",
    "server/study/budget.ts",
    "server/study/claude.ts",
    "api/study/ai.ts",
    "api/study/section.ts",
    "api/study/outline.ts",
    ...OPS.flatMap(([, files]) => files),
  ]
    .map(read)
    .join("\n");
  const split = (entry: string) => {
    const m = /^([a-z]+):(.+)$/.exec(entry);
    return m ? { area: m[1] as Area, code: m[2] } : { area: undefined, code: entry };
  };
  assert.deepEqual(
    INTERNAL_CODES.filter((e) => {
      const { code } = split(e);
      return !codes.has(code) && !server.includes(`"${code}"`);
    }),
    [],
    "internal codes nothing raises",
  );
  assert.deepEqual(
    INTERNAL_CODES.filter((e) => {
      const { area, code } = split(e);
      return hasText(code, area);
    }),
    [],
    "internal codes that have words",
  );
});

test("the area decides, then the code, then the area's fallback (§6.3)", () => {
  assert.equal(failText("budget"), "הקבוצה הגיעה לתקרת התקציב של החודש. אפשר להעלות אותה ב-Vercel (STUDY_MONTHLY_USD).");
  assert.equal(failText("budget", "cards"), "הקבוצה הגיעה לתקרת התקציב של החודש.");
  assert.equal(failText("budget", "dispute"), "הקבוצה הגיעה לתקרת התקציב של החודש.", "VAR as every optional feature");
  assert.equal(failText("reserve", "traps"), "זה נעצר עד סוף החודש, כדי שיישאר תקציב לסיכומים של ההרצאות הבאות.");
  assert.equal(failText("refusal", "ask"), "לא התקבלה תשובה לשאלה הזאת. אפשר לנסח אותה אחרת.");
  assert.equal(failText("timeout", "mnemonic"), "לא הצלחנו ליצור עכשיו. אפשר לנסות שוב.");
  assert.equal(failText("timeout", "museum"), "לא הצלחנו ליצור עכשיו. אפשר לנסות שוב.", "the plaque as the memory aids (fun §5.7)");
  assert.equal(failText("api_529"), "Claude עמוס כרגע. אפשר ללחוץ ״המשך כתיבה״ בעוד דקה.");
  assert.equal(failText("api_500", "practice"), "יותר מדי בקשות בבת אחת. אפשר לנסות שוב בעוד דקה.");
  assert.equal(failText("rate_limited", "museum"), "יותר מדי בקשות בבת אחת. אפשר לנסות שוב בעוד דקה.");
  assert.equal(failText("something new"), "הכתיבה נעצרה. אפשר ללחוץ ״המשך כתיבה״.");
  assert.equal(failText("something new", "corrections"), "לא נשמר. כדאי לבדוק את החיבור ולנסות שוב.");
  assert.equal(failText("something new", "plan"), "התוכנית לא נשמרה. אפשר לנסות שוב.");
  assert.equal(failText("something new", "cards"), "לא הצלחנו. אפשר לנסות שוב.");
  assert.equal(failText("something new", "meeting"), "לא הצלחנו. אפשר לנסות שוב.");
  assert.equal(failText("lecture not found", "plan"), "אחת ההרצאות כבר לא קיימת. כדאי לרענן.");
  assert.equal(failText("lecture not found"), "ההרצאה הזו נמחקה או לא נמצאה. אפשר לבדוק ב״נמחקו לאחרונה״.");
  assert.equal(failText("not signed in"), "הכניסה במכשיר הזה פגה. צריך להצטרף מחדש עם קוד הקבוצה.", "without flags.account");
  assert.equal(failText("conflict", "marathon"), "המרתון השתנה בינתיים. הגרסה החדשה נטענה, ואפשר לערוך שוב.");
  // §12's areas
  assert.equal(failText("conflict", "meeting"), "הפגישה השתנתה בינתיים. הגרסה החדשה נטענה, ואפשר לערוך שוב.");
  assert.equal(failText("conflict", "plan"), "התוכנית השתנתה בינתיים. הגרסה החדשה נטענה, ואפשר לערוך שוב.");
  assert.equal(failText("member not found", "meeting"), "מי שנבחרו להקראה כבר לא בקבוצה. כדאי לבחור שוב מהרשימה.");
  assert.equal(failText("member not found"), "רק מי שפתחו את הקבוצה יכולים לעשות את זה.", "the members' own row elsewhere");
  assert.equal(failText("not found", "today"), "לא נמצא. כדאי לרענן.");
  assert.equal(failText("group not found", "today"), "הקבוצה לא נמצאה. כדאי לרענן.");
  assert.equal(failText("too long", "dispute"), "עד 200 תווים.");
  assert.equal(failText("too long", "practice"), "עד 300 תווים.");
  // The ops' codes: the same code reads by its area.
  assert.equal(failText("too long", "ask"), "השאלה ארוכה מדי (עד 500 תווים).");
  assert.equal(failText("too long", "corrections"), "התיקון ארוך מדי.");
  assert.equal(failText("part not found", "mnemonic"), "החלק הזה לא נמצא בסיכום. כדאי לרענן.");
  assert.equal(failText("part not found", "corrections"), "לא נשמר. כדאי לבדוק את החיבור ולנסות שוב.");
  assert.equal(failText("bad block", "mnemonic"), "אי אפשר ליצור אסוציאציות לקטע הזה. אפשר לבחור פסקה אחרת.");
  assert.equal(failText("batch not found", "cards"), "החלק הזה לא נמצא. כדאי לרענן.");
  assert.equal(failText("batch not found", "practice"), "השאלה לא נמצאה. כדאי לרענן.");
  assert.equal(failText("timeout", "ask"), "התשובה נעצרה באמצע. אפשר לשאול שוב.", "a routing call stopped at its deadline");
  assert.equal(failText("no claim", "cards"), "לא הצלחנו. אפשר לנסות שוב.", "an internal code gets the area's fallback");
  assert.equal(failText("bad source", "practice"), "כדי להשאיר את השאלה צריך לבחור שקף שמראה שהמפתח נכון.");
  assert.equal(failText("bad source", "traps"), "צריך לבחור 1 עד 6 שקפים מההרצאה.");
  assert.equal(failText("bad source", "dispute"), "צריך מקור: שקף מההרצאה, דקה בהקלטה, או מקור חיצוני עם הסבר.");
  assert.equal(failText("daily_limit", "wall"), "אפשר להעלות עד 30 אסוציאציות ביום. מתחדש בחצות.");
  assert.equal(failText("daily_limit", "mnemonic"), "אפשר ליצור אסוציאציות עד 5 פעמים ביום. מתחדש בחצות.", "J's drafts: 5 a day (review F-19)");
  assert.equal(failText("server off", "bank"), "הכתיבה בשרת עוד לא פועלת, אז השאלות ייכתבו מהטלפון אחרי הסיכום.");
});

test("failShort names the reason of a part that is retried by itself", () => {
  assert.equal(failShort("timeout"), "לקח יותר מדי זמן");
  for (const c of ["rate_limited", "overloaded", "api_529", "network", "empty"]) assert.equal(failShort(c), "Claude עמוס", c);
  assert.equal(failShort("refusal"), "תקלה");
});

test("no string is gendered about the reader or another person (§6.0 rule 1, the review's known slips)", () => {
  const areas: Area[] = ["writing", "practice", "exam", "cards", "ask", "mnemonic", "corrections", "plan", "marathon", "pdf", "group", "meeting", "today", "dispute", "wall", "museum", "boss", "bank", "traps", "pulse"];
  const ops = OPS.flatMap(([, files]) => [...opCodes(files.map(read).join("\n"))]);
  const codes = [...raisedIn(SQL), ...ops, "rate_limited", "overloaded", "api_500", "timeout", "network", "refusal", "truncated", "empty", "bad turn", "budget", "reserve", "member_share"];
  const all = [...new Set(codes.flatMap((c) => areas.map((a) => failText(c, a))))].concat(BOSS_NOT_COUNTED);
  for (const bad of ["מי שמנהל", "מישהו", "מישהי", "ממי שפתח ", "יכול להעלות", "לא הצלחתי", "מי הצביע ", "סימנה"]) {
    assert.deepEqual(all.filter((t) => t.includes(bad)), [], bad);
  }
});
