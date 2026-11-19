# Practice questions (package Q)

What the study app's practice does, where it lives, and how it is tested. The
build spec is `spec/spec-final.md` (§3 section Q, §4.6, §5.4-§5.5, §6.4 "Copy · Q",
§7.Q); the screens are design-questions §1.3 with the review's changes.

## What a member sees

Practice 2.0 (`proposal/practice-2/DECISIONS.md`, its four screens in
`mockups.html`, and the approved question screens in
`proposal/mockups/practice.html`), in the design system
(`design-system.md`):

- **The "תרגול" tab** (`?v=practice`, P1): per course, each lecture with its
  questions and the member's own counts ("15 שאלות · תורגלו 6 · 2 טעויות"),
  "יצירה" (to מה ליצור) where there are none yet, "נכתבות שאלות…" while
  a request or a round is written, "לתרגל את כל הקורס", the cards of today
  (package C's slot) and "מבחן קבוצתי" (package Z) when their flags are on.
- **A lecture's practice** (`?v=practice&l=<id>`): the bank's size, the
  member's own line ("רק לך"), "סבב חדש" and "שאלות חדשות"; "הבנק נבנה"
  with its count while a request is written or has drafts waiting; the
  questions two members' flags hid ("מחכות לבדיקה", each with "לבדוק מול
  השקף": the fix sheet); one member's flags, read only; the ones this member
  hid, with "להציג שוב"; "מבחן קבוצתי על ההרצאה" with the quiz's flag.
- **מה ליצור** (`&x=new`): how many questions by level, with the plan's
  numbers for this lecture's points to know (ממוקד · מלא · מקיף · משלי;
  מלא by default), which parts (each with its points), which styles
  (several), and the level (קל · כמו במבחן · קשה). When the points were
  never read, or a part changed since, the bottom bar's one button reads
  them, with the cost on it ("לקרוא את הנקודות · כ-$0.14", once for the
  whole group); the screen then opens on the counts. Another phone reading
  them shows live.
- **דוגמה ומיקוד** (`&x=example`): an exam question pasted or photographed,
  read back ("ככה השאלות ייכתבו: …"), the focus line, the count, the level
  and the cost (the blind solver included), the month's spend, and "ליצור N
  שאלות". At 80% of the month's cap (40% for one member) it says so and
  waits.
- **הבנק נבנה** (`&x=bank&r=<request>`): the count in the top bar, a
  coverage bar per part, and each draft with its style, the blind solver's
  verdict ("נבדקה ✓", "בבדיקה…", "הפותר טעה" while the server rewrites it,
  "לא נבדקה"), its slide and its options, "✓ להשאיר", "↻ לנסח מחדש" (a
  sheet: an optional note and the cost) and "✕"; "להוסיף N לבנק" in the
  bottom bar. A batch that failed says why, and "להמשיך לכתוב" writes it
  again (as it does for a request nobody is writing any more). Its back
  arrow returns past the two screens that made the request.
- **סבב חדש** (`&x=round`): from where (לא נענו · טעיתי · סימנתי · הכול,
  each with the member's own count), which parts, which style, how many (5,
  10, all), and practice or exam mode; "להתחיל · N שאלות".
- **A session** (`?v=practice&s=l.<id>&n=5|10|20|all`): the top bar
  ("תרגול · <lecture>", "4/15") over the progress bar; the style and "מבוסס
  על ש׳"; a tap picks an option; the bet (ניחוש · נראה לי · על בטוח, "רק
  לך") before "לבדוק"; then the autopsy: the verdict with the bet ("✗ טעות ·
  ׳נראה לי׳"), the option chosen when wrong, the key, the rest, each with its
  explanation and "מתי כן", "מה לזכור", the other members' flags; in the
  bottom bar "לפסקה: <part>" (the summary at the question's paragraph,
  re-anchored when the part was written again), the flag and "לשאלה הבאה".
  Slide tags open the slide over the session; the URL stays. The end of a
  round: the score ("רק לך"), "לחזור על" with each mistake's autopsy and
  "לפסקה", "סבב נוסף" (with the same choice), "רק הטעויות מהסבב".
- **The library**: a chip "15 שאלות" on a lecture's card, to its practice.

**Question types** (`VITE_STUDY_QTYPES`, [question-types.md](question-types.md)):
besides multiple choice, a question about a slide's picture, a label to name
("מה מסומן במספר 3?") or to find ("באיזה מספר מסומן X?"), נכון / לא נכון,
התאמה, סידור and a staged clinical case. "שאלות חדשות" offers them in their
own chip group; "סבב חדש" filters by "סוג שאלה". A set question (tf, match,
order) is right only when every part is; the verdict shows how many were
right ("✗ טעות · 3 מתוך 4").

## Who sees what

The questions, their rounds and flags are the group's. The key and the
explanations are hidden from every client: a member gets them only by
answering (`study_answer_question`, which records the answer) or for a
question already answered (`study_question_feedback`). Answers are private:
the app never reads `study_answers` or `study_question_keys`; the hub's and
P2's own numbers come from the caller-only functions (`study_practice_overview`,
`study_my_latest`, `study_my_mistakes`). The e2e asserts both, and that no
streamed line carries a key.

## How it works

| Piece | File |
|---|---|
| Data: questions, rounds, answers (with the bet and "מתי כן"), the caller's results, flags, live updates | `src/study/lib/practice.ts` (the library chip loads it lazily, so it stays out of the entry chunk) |
| Practice 2.0's calls: op "questions" (plan, points, style, create, a request's batches, reword), the drafts' RPCs, the request's progress, סבב חדש's counts, the fix sheet's calls, the choices between the two creating screens | `src/study/lib/practice2.ts` |
| Writing a release-1 round (the live quiz's setup still does) | `src/study/lib/practiceGenerate.ts` |
| What a session asks and in what order (`pickQueue`, within סבב חדש's pick), each showing's option order, the bet, the autopsy's order, "מצב מבחן", the session in `sessionStorage`, "להסתיר ממני", the start request | `src/study/lib/practiceSession.ts` |
| A practice question: the pick, the bet, the autopsy | `src/study/components/PracticeQuestion.tsx` |
| The options' letters and a flag's line (QuestionCard's helpers; the card itself went, as the quiz draws its own `QuizQuestion`) | `src/study/lib/questionText.ts` |
| The flag sheet, the fix sheet | `src/study/components/FlagSheet.tsx`, `FixSheet.tsx` |
| P1, a lecture's practice, a session | `src/study/components/PracticeHome.tsx`, `LecturePractice.tsx`, `PracticeSession.tsx` |
| מה ליצור and דוגמה ומיקוד, הבנק נבנה, סבב חדש | `src/study/components/PracticeCreate.tsx`, `PracticeBank.tsx`, `PracticeRound.tsx` |
| The slot: the screens (lazy), the library chip; past exams wait for Q-2 | `src/study/features/practice.tsx` |
| Styles (tokens only, light and dark) | `src/study/styles/practice.css` |
| The server: op "questions", its checks and prompts | `server/study/practice.ts`, `questions.ts`, `prompts/questions.ts` |

Details that are easy to miss:

- **Option order.** A session gives every showing its own order (all-numeric
  options stay ascending), keeps it with the session so a reload shows the
  same order, sends the stored index to `study_answer_question` and moves the
  explanations with the options (review UX-2). The live quiz shows the stored
  order on every phone.
- **"מצב מבחן" and סבב חדש's choice.** The session's route cannot say them,
  so "להתחיל" leaves a one-time request beside the member's sessions
  (`study-session:<user>:start`) with the mode and the pick (sources, parts,
  style); the session screen takes it and starts fresh, and keeps the pick
  for "סבב נוסף". Each question gets `study_quiz__seconds`'s clock; at zero it
  is "לא יודעים". No feedback until the end, then every question with every
  explanation; the answers are recorded with mode `exam`.
- **Mistakes.** A wrong answer stays a mistake until it is answered right on
  a later study day (04:00, Israel time). With "הטעויות שלי" on (`PROGRESS`),
  a right answer on the same day says "תשובה נכונה. השאלה תחזור מחר, כדי לבדוק
  שזה נשאר.", and on a later day "יצאה מרשימת הטעויות".
- **The bet.** "לבדוק" waits for an option and a bet; both go to
  `study_answer_question` (`p_confidence` 1-3), stored with the answer and
  shown to nobody else. "לא יודעים" sends no choice and no bet.
- **Two flags.** Two different members' flags of reasons wrong key, not in
  the slides, two answers or unclear hide a question from everyone's
  practice and every count (`hidden_at`); the second flag's toast says so.
  Any member then checks it against the slide (`FixSheet`: the key and the
  flags without names, 1-6 slides, keep or retire).
- **Flags.** A single flag tells the group what is wrong with a question: a
  reason and a note, shown under the question with the member's name, and
  on the lecture's practice. It takes the question out of nobody's practice. There is no "for everyone"
  box, and no member retires a question for everyone or puts one back
  (package Q's review, finding Q2; the addendum's SEC-13):
  `study_retire_question` is revoked from members and stays the owner's, in
  the SQL editor. A flag sent in a session can be deleted in the same session
  ("מחיקת הסימון": the sheet keeps the stored row's id, finding Q5).
  "להסתיר ממני" hides a question from this member's own sessions on this
  device (`study-question-hidden:<user>`).

## Flags

`VITE_STUDY_QUESTIONS` shows the tab, P1, P2 and the chip; `VITE_STUDY_PRACTICE`
adds sessions. Release 1 (`RELEASE-1.md`) turns both on with
`VITE_STUDY_CARDS`, without the quiz: nothing on these screens links to it
then. "הטעויות שלי" (P1's card, P8, `s=m`) and past exams (`?v=exams`) are
milestone Q-2. The addendum's practice (the bet, the autopsy, two-flag
hiding: Q's end, §12.3.Q) is not in release 1, whose build needed section Q
at version 1. On `study/rel2` Q's end, practice 2.0's server and its screens
are merged and `ENDS.Q` is true (`shared/study/flags.ts`): with questions on
the build needs Q 2, and help and the privacy note describe the end's
practice. Creating questions (מה ליצור, דוגמה ומיקוד, הבנק נבנה) needs
`VITE_STUDY_QUESTIONS`; סבב חדש and sessions need `VITE_STUDY_PRACTICE`.

The server and the SQL of Q's end and of תרגול 2.0 are in
`practice-2-api.md`. The SQL is section Q at version 2.

## Tests

```bash
npm run test:study -- questions practiceSession practice2   # the server, the shared module and the screens' helpers
npm run test:contract                                         # every RPC and column named here exists
VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
  VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 VITE_STUDY_QUIZ=1 npx vite build --outDir /tmp/study-e2e-q
NODE_PATH=$(npm root -g) node e2e/study/practice.cjs /tmp/study-e2e-q /tmp/study-e2e-q-out rel2
```

Run `practice.cjs` again with `rel1` (release 1's build:
`VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1`), `all`
(every flag) and `off` (no flag); `rel1` and `rel2` run against what this
branch's SQL registers. It plays the whole flow with two phones (24 screens,
each through `a11y.cjs` in light and dark at 390 and 360 px). Its mock,
`e2e/study/mocks/practice.cjs`, answers section Q's tables and functions
(practice 2.0's included) per member and streams op "questions" (every
action) for real; the e2e mock
loads it for every script, so F's flows also run against a build with
practice on. The quality eval of §8.4 (Q-5) is not built yet: it needs no
API key (stand-in writers and a judge play the model, as `tools/evals/cards.mjs`
does for the cards), but `tools/evals/questions.mjs` does not exist.
