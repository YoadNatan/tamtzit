/* ── Release flags and the schema they need (spec §2.10, §2.11, §5.7; §12.2.2) ──
 * Pure, so the app (src/study/lib/flags.ts, from the build's VITE_STUDY_*
 * values) and /api/study/health (from the same variables, which Vercel gives
 * its functions too) read one table: what a build with these flags shows,
 * and the SQL sections it needs. ── */

const on = (v: unknown) => v === "1";

/** The flags from a set of build variables (pure, so tests build every
 *  release's set; the app uses `flags` in src/study/lib/flags.ts). */
export function flagsFrom(e: Record<string, unknown>) {
  const questions = on(e.VITE_STUDY_QUESTIONS);
  const cards = on(e.VITE_STUDY_CARDS);
  const practice = questions && on(e.VITE_STUDY_PRACTICE);
  const progress = on(e.VITE_STUDY_PROGRESS);
  const quiz = questions && on(e.VITE_STUDY_QUIZ);
  const corrections = on(e.VITE_STUDY_CORRECTIONS);
  const meeting = quiz && on(e.VITE_STUDY_MEETING);
  // T-1 (wave 5): Today waits only for its own flag (Yoad's decision 1 of 17
  // Nov 2026: a screen waits for its own package and flag). Its rows wait for
  // theirs: the danger row for progress, the cards for the in-app review, …
  const today = on(e.VITE_STUDY_TODAY);
  const pulse = progress && on(e.VITE_STUDY_PULSE);
  return {
    questions,
    practice,
    // Q-2: "הטעויות שלי" and another wording ride on progress (A2). Decision 1
    // (17 Nov 2026): no account; they are the device's member's own.
    mistakes: practice && progress,
    // Past exams (sources.md phase 2): the upload, the review, replaying an
    // exam and the simulation. They live in their course and are practised in
    // sessions, so they need the course pages and practice too (section S at 2).
    exams: practice && on(e.VITE_STUDY_COURSES) && on(e.VITE_STUDY_EXAMS),
    quiz,
    cards,
    cardsReview: cards && on(e.VITE_STUDY_CARDS_REVIEW), // C's review (release 8; no account, decision 1)
    corrections,
    ask: on(e.VITE_STUDY_ASK),
    recordings: on(e.VITE_STUDY_RECORDINGS),
    pdf: on(e.VITE_STUDY_PDF),
    account: on(e.VITE_STUDY_ACCOUNT),
    progress,
    marathons: on(e.VITE_STUDY_MARATHONS),
    fakeAsr: on(e.VITE_STUDY_FAKE_ASR), // e2e builds only
    // §12 (`mnemonics` is gone: the association wall replaces it)
    meeting, // M · release 4
    anchor: (questions || cards) && on(e.VITE_STUDY_ANCHOR), // N · release 4
    var: corrections && on(e.VITE_STUDY_VAR), // V · phase 2
    wall: on(e.VITE_STUDY_WALL), // J · phase 2
    today, // T-1 · release 8
    // M-2: the pre-guess and catch-up. Decision 1 (17 Nov 2026): no account and
    // no Today needed; catch-up is entered from the meeting's card on "יחד".
    guess: meeting && on(e.VITE_STUDY_GUESS), // M-2
    // Decision 3 (17 Nov 2026): phase 3's extras open early, with a meter.
    needsMe: today && on(e.VITE_STUDY_NEEDS_ME), // T-2 (section T at 2)
    pulse, // U · release 8 (+ the switch `pulse`)
    museum: pulse && cards && on(e.VITE_STUDY_MUSEUM), // U-3 · phase 3, usable early
    boss: pulse && quiz && on(e.VITE_STUDY_BOSS), // H · phase 3, usable early
    groupPlan: on(e.VITE_STUDY_MARATHONS) && on(e.VITE_STUDY_GROUP_PLAN), // G (section G 1; its days are P's marathons)
    traps: questions && on(e.VITE_STUDY_TRAPS), // E · phase 3
    blankTable: practice && cards && on(e.VITE_STUDY_BLANK_TABLE), // E · phase 3
    quizRounds: quiz && on(e.VITE_STUDY_QUIZ_ROUNDS), // E · phase 3 (design only)
    eve: progress && on(e.VITE_STUDY_EVE), // the exam-eve view (PR6; built with G and T-2): P 2
    // The guide (docs/study/guide.md): first steps for a new member, "?" on
    // each screen, "איך עושים…?" in help and a sandbox. It reads only what the
    // device and the group already have, writes nothing to the database and
    // calls no AI, so it needs no SQL section (requiredSchema is unchanged).
    guide: on(e.VITE_STUDY_GUIDE),
    // Question types (docs/study/question-types.md): image, label, staged
    // case, true/false, match and order. Section Q at 3 (the columns) and X 1
    // (answering a set, the geometry backfill).
    qtypes: practice && on(e.VITE_STUDY_QTYPES),
    // Courses (docs/study/sources.md, phase 1): the course page, the batch
    // upload, "לשאול על כל הקורס" and a round over several lectures. Section
    // S at 1 (study_courses, plan_id) and the switch `courses`.
    courses: on(e.VITE_STUDY_COURSES),
    // Adding תמצית to the home screen (docs/study/install.md): the steps for
    // each phone, the browser's own prompt, the row in "שלי", one card on the
    // home and the guide's step. Its memory stays on the device, so it needs
    // no SQL section (requiredSchema is unchanged).
    install: on(e.VITE_STUDY_INSTALL),
    // Notifications (docs/study/DECISIONS-2026-11-26.md): the bell and the
    // inbox, and where the device can, pushes to the phone or computer.
    // Section R at 1; sending is decided on the server (the switches
    // `notify` and `notify_hooks`, and the VAPID keys).
    notify: on(e.VITE_STUDY_NOTIFY),
    // Practice sets, slice A (docs/study/sets.md): one create screen, "סט
    // חדש", with the price on its button, and the generating screen, "סט
    // בהכנה". The server's actions are practice 2.0's, so it needs no SQL
    // section (requiredSchema is unchanged); without it, practice 2.0's
    // three-screen generator (kept one release, OD22).
    make: practice && on(e.VITE_STUDY_MAKE),
  } as const;
}

export type Flags = ReturnType<typeof flagsFrom>;

/** The addendum's ends (§12.1.4, §12.3) whose code this build has. A flag
 *  shows the screens the merged code has: without its end, practice and the
 *  flashcards are the spec's (§7.Q's Q-1, §7.C), they need their sections at
 *  version 1, and help says only what those screens do.
 *  Release 1 (QUESTIONS, PRACTICE, CARDS) shipped Q-1 and C without their
 *  ends and nothing of section B, the bank written ahead
 *  (docs/study/RELEASE-1.md). Release 2 (study/rel2) brings Q's end with
 *  practice 2.0 (section Q at version 2): Q is true. C's end (study/w3-c:
 *  the deck part by part, private cards, trap cards, the review home) sets
 *  C: the cards need section C at 2. B is package B as Yoad's decision 2 (17
 *  Nov 2026) redefines it (study/w4-b): the points to know read on the
 *  server after the summary, nothing written ahead; it sets only what help
 *  says, and no build needs section B (the setup screen
 *  reads its column when it is there). The merge that brings an end sets its
 *  entry to true. */
export type Ends = { Q: boolean; C: boolean; B: boolean };
export const ENDS: Ends = { Q: true, C: true, B: true };

/** The SQL sections, at their versions, a build with these flags needs
 *  (spec §2.11, §12.2.2): F and W always (every build writes through
 *  section W's leases and asks study_queue(), W1), and each package whose
 *  flag is on. Q and C at 2 once their ends are built (1 until then: release
 *  1; release 2 has Q's end, so questions and practice need Q 2); the quiz
 *  needs section Z at 2, its end, which package Z builds with its section
 *  (release 2: VITE_STUDY_QUIZ on release 1's three, against F 1, W 1, Q 2,
 *  Z 2, C 1; docs/study/quiz.md); K and P at 2 (their ends); never B: the
 *  bank's two lines hide while section B is missing (review F-5). W2's
 *  hardening raises the server code's W to 2 (REQUIRED_SCHEMA), not the
 *  app's: nothing the browser does needs it (it never wrote a part or a
 *  lecture's writing state); corrections do (W 2 with
 *  VITE_STUDY_CORRECTIONS). /api/study/health asks the same of the
 *  database, with the server code's own needs (server/study/study.ts,
 *  healthSchema). */
export function requiredSchema(f: Flags, ends: Ends = ENDS): Record<string, number> {
  return {
    F: 1,
    W: 1,
    ...(f.questions ? { Q: ends.Q ? 2 : 1 } : {}),
    // Question types: Q's columns (Q 3) and section X's functions. Z, M, H, U
    // and C's filters come with the same run of the file; the app needs none of them.
    ...(f.qtypes ? { Q: 3, X: 1 } : {}),
    ...(f.quiz ? { Z: 2 } : {}),
    ...(f.cards ? { C: ends.C ? 2 : 1 } : {}),
    ...(f.corrections || f.ask ? { K: 2 } : {}),
    // A correction's author and undo hold only once no member's token can
    // rewrite a part directly: corrections wait for W2's hardening (§3.7,
    // review M1; §12.1.1's "K-2: W2").
    ...(f.corrections ? { W: 2 } : {}),
    // Section A is the saved account's (A1), which decision 1 (17 Nov 2026)
    // withdrew: VITE_STUDY_ACCOUNT stays unset, and progress, marathons and
    // "הטעויות שלי" need only section P (A2: P's end at 2) and Q.
    ...(f.account ? { A: 1 } : {}),
    ...(f.progress || f.marathons ? { P: 2 } : {}),
    // M 2: no reader planned ahead (the band and the agenda name only the live reader).
    ...(f.meeting ? { M: 2 } : {}),
    ...(f.anchor ? { N: 1 } : {}),
    ...(f.var ? { V: 1 } : {}),
    // T-2 ("הקבוצה צריכה אותך") is section T's end: T at 2 (needsMe rides on
    // today); at 3 study_today leaves needs_me's question out of "בקבוצה"
    // (review UI-3), so needsMe asks for T 3.
    ...(f.today ? { T: f.needsMe ? 3 : 1 } : {}),
    // U-3 (wave 5, phase 3): the museum, and the boss's heads (hot topics
    // and the museum's exhibits), need U's traps (U at 2). Decision 3 (17 Nov
    // 2026): both may go on any time, each opening with a meter.
    ...(f.pulse ? { U: f.museum || f.boss ? 2 : 1 } : {}),
    ...(f.wall ? { J: 1 } : {}),
    // H 2: a battle's heads, rounds and log are no longer readable from the
    // table (review H-BATTLE-ROW-READ); G 2: the plan's meter counts up to the
    // study day's start and takes no caller's time (review G-METER-PNOW).
    ...(f.boss ? { H: 2 } : {}),
    ...(f.groupPlan ? { G: 2 } : {}),
    ...(f.traps || f.blankTable ? { E: 1 } : {}),
    // Courses (sources.md B8): section S at 1. Past exams and their
    // simulation (phase 2): S at 2, which has S 1 in it.
    ...(f.courses ? { S: 1 } : {}),
    ...(f.exams ? { S: 2 } : {}),
    // f.guide and f.install need nothing: both keep their memory on the device,
    // and f.make neither: its screens call practice 2.0's actions (Q 2).
    // Notifications: the inbox, the devices and the settings are section R's.
    ...(f.notify ? { R: 1 } : {}),
  };
}
