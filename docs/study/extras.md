# טבלה ריקה and מלכודת משלי (package E: P10 and P11)

What package E adds to תמצית in wave 5 (spec §12.6.E; the approved mockup
`proposal/mockups/practice.html` screen 3 "טבלה ריקה מהזיכרון"), with Yoad's
decisions 1 and 3 of 17 Nov 2026, how it is built, and Yoad's steps to turn
it on. Branch `study/w5-e`, on top of `study/wave5`. Q11 (the quiz rounds
"המלכודות שלנו" and "מי אני?") stays design only: `RoundPicker` renders
nothing, op `whoami` answers 501, and `VITE_STUDY_QUIZ_ROUNDS` shows nothing.

## What the group gets

- **"טבלה ריקה"** (P10, `?v=practice&s=b.<lecture>.<slide>`): the slide's
  own table with its cells empty. "טבלה ריקה · {title}" and "{row}/{rows}"
  in the top bar, "הטבלה משקף {n}, מהזיכרון · שורה אחר שורה" under it.
  Row by row, the chips under the table are the column's values; a tap fills
  the cell marked "?" and moves on. "לבדוק את השורה" compares the row with
  the slide: a right row says so; a wrong cell is struck with the slide's
  value beside it, and the card under the table says "טעות בשורה {r}" ·
  "נכנסה לכרטיסיות" · "רק לך". Each wrong cell becomes the member's private
  card (section C's `study_my_card_add`, origin `'table'`), once: the same
  mistake again adds no second card. At the end: "{k} מתוך {rows} שורות בלי
  טעות · תא אחד נכנס לכרטיסיות, רק לך", "עוד פעם", "לטבלה הבאה". $0: the
  key is the slide's table; nothing is sent to Claude.
- **"מלכודת משלי"** (P11, `?v=trap&l=&at=`, `d=` a draft): the paragraph
  quoted, "מקרה (לא חובה)", "השאלה", 4-5 options with "הנכונה", "מה המלכודת?
  (לא חובה)" and the slide chips (the paragraph's own tags chosen first, at
  most 6). "לבדוק מול השקפים · כ-$0.03" saves the draft, then op
  `trap_check` judges it ("בודקים מול השקפים…"):
  - passed: "המלכודת נכנסה לבנק של כולם. השם שלך יופיע אחרי שתישאל במבחן
    קבוצתי." The trap is a question in everyone's bank, with Claude's
    explanation and "מתי כן" for each option, the author's text unchanged,
    and no author;
  - not right by the slides: "לא עברה את הבדיקה", the problem in one line
    with its slide, "לתקן"; "לתקן ולבדוק שוב" rewrites the same draft.
  Without `at` the member picks the part. "המלכודות שלי בהרצאה" lists hers,
  each with its state ("בבנק · בלי שם עד מבחן קבוצתי", "בבנק · נשאלה במבחן
  קבוצתי, עם השם שלך", "מחכה לתיקון").
- **In practice** a member's trap carries the chip "מלכודת של חבר בקבוצה";
  once a live quiz's reveal unmasked it, "נכתבה ע״י {name} · נבדקה מול
  השקפים". The group quiz's reveal shows the same line under the options
  (live-quiz.html's "שלב 3" line), read after the reveal.
- **Where they open**: a lecture's practice has a "טבלה ריקה" card (its
  tables, each a way in) and a "מלכודת משלי" card ("רק לך", the meter,
  "להוסיף מלכודת משלי"); N's paragraph sheet, tab "תרגול", has "להוסיף
  מלכודת משלי" on that paragraph.

## Decision 1: no accounts

Nothing of E needed an account. A trap's author is the member (the phone
she joined from) who wrote the draft; the drafts are owner-only rows
(`study_trap_drafts`, RLS: `user_id = auth.uid()`), as decision 1 keeps
every owner-only row owner-only between members.

## Decision 3: usable early, with a meter

The flags may go on any time. Each opens with what there is and says what
more needs, from real counts; nothing is a dead end.

- **The blank table**: a lecture's practice says "3 טבלאות בשקפים של
  ההרצאה" and lists them. A lecture with none (a PDF, or slides without
  tables) shows the empty state: "בשקפים של ההרצאה הזו אין טבלה למילוי.",
  what a table needs ("טבלה ריקה נפתחת על טבלה בשקף עם 2 שורות לפחות מתחת
  לכותרת, ממצגת PowerPoint.") and where the group's other tables are ("ב-2
  הרצאות אחרות יש 4 טבלאות בשקפים.", with "לתרגול של הרצאה עם טבלה").
  The other lectures' count comes from the new `study_slide_tables(group)`,
  which reports every table's shape (rows, columns, longest cell) under the
  caller's own rights; which shapes count is decided in one place,
  `shared/study/blankTable.ts`'s `shapeOk`. A slide without a table (an old
  link) points to the lecture's first table.
- **The trap**: the meter is the author's own, from her drafts and their
  questions: "2 מלכודות שלך בבנק · אחת כבר עם השם שלך · אחת מחכה לתיקון",
  then what more needs ("אחת עוד מחכה למבחן קבוצתי, ואז יופיע השם.") and
  the day's limit ("נשארו היום 8 מלכודות חדשות."; at 10, "להיום נגמרו
  המלכודות החדשות; מחר אפשר שוב." and the check waits).
- **The privacy floor** (anything the group sees anonymously counts only
  from 3 different members) has nothing to count in E: a passed trap is a
  question, content, not a count of members, and its author is named by the
  live quiz the author agreed to when writing it; a blank table is the
  slide's own. The meters count tables and the author's own rows, never
  other members.
- **One place for the numbers**: `shared/study/meters.ts` (`TRAPS`, `BLANK`, with every other meter's since wave 5's integration; `shared/study/extras.ts` re-exports them)
  with `extras.test.ts`, which checks each number against section E's SQL
  (10 drafts a day, 4-5 options, 8-400 characters, 1-6 slides, the
  vignette's 1,200 and the note's 300) and the server's `POLICY` (5 checks a
  day).

## How it is built

- **SQL, section E at 1** (`supabase/study-schema.sql`, E's markers; checks
  ES1-ES9 in `supabase/tests/study.sql`): as §12.6.E writes it, with three
  additions:
  - `study_questions` gains source `'member'`, `author_id` (null until
    unmasked) and `unmasked_at`; section Q's "an exam item, or Claude's"
    check becomes `study_questions_exam_shape`. New: a check that only a
    member's trap, unmasked, has an author (`study_questions_author_shape`).
  - `study_trap_drafts` (owner-only, never published, no member writes it
    directly); `study_trap_submit` (the shape, the lecture's slides and part,
    10 new drafts a day, a rewrite only of one's own draft that has not
    passed); `study_trap_checked` (the server key and the author's token):
    rejected keeps the problem; passed inserts the question with no author
    and `created_by` null, and its key. New: the options are shuffled once,
    with their explanations and "מתי כן" (section Q's rule: the bank's order
    is the server's), so the author's habit of where the key sits does not
    carry into the bank.
  - Z's hook `study_quiz__revealed(quiz, question)`, which Z's final reveal
    (`study_quiz__score`) calls: it names a member's trap's author once. No
    trigger on `study_answers` (review SEC-7: `study_answer_question`
    refuses mode `quiz`, so practice never unmasks). ES5 runs Z's own
    `study_quiz__score` on a real round, not only the hook.
  - New: `study_slide_tables(group)` for the blank table's meter (security
    invoker).
- **Server, op `trap_check`** (`server/study/ops/extras.ts`, `traps.ts`,
  `prompts/extras.ts`): the draft read with the member's token; one
  reservation (kind `trap_check`, ref the draft, 5 a day); one structured
  call (effort medium, max_tokens 2,500, system `TRAP_CHECK_SYSTEM` then the
  lecture, cached; schema `{ ok, problem, options: [{ why, when }],
  takeaway, topic, aspect }`), settled in `run()`'s `finally`; `checkTrap`
  (one explanation per option, each ending with a tag of the lecture's
  slides and naming no option by its letter, "when" by section Q's rule);
  then `study_trap_checked` with the key. `TRAP_CHECK_SYSTEM` is §12.6.E's
  text verbatim followed by `QUESTIONS_SYSTEM`'s language rules, sliced
  from it. A refusal is 422, a timeout 504, an unusable answer 502 (nothing
  saved). The model never sees a member's name.
- **Client**: `features/extras.tsx` (the slot: `TrapScreen` and the blank
  table lazy, `AddTrap`, `ExtrasCard`, `TrapChip`, `RoundPicker` null),
  `components/TrapScreen.tsx`, `BlankTable.tsx`, `ExtrasCard.tsx`,
  `lib/extras.ts`, `shared/study/blankTable.ts`, `shared/study/extras.ts`,
  `styles/extras.css`. Small edits in other packages' files: Q's practice
  slot routes `s=b.*` to the blank table and its lecture screen shows
  `ExtrasCard`; Q's session and Z's reveal show `TrapChip`; N's tab shows
  `AddTrap`; `lib/practice.ts`'s source type gains `member`. E's share of
  the entry chunk is 2.4 kB.
- **Help and privacy**: "מלכודת משלי" gains the cost, the limits and the
  meter; a new "טבלה ריקה" row; the privacy note's "מלכודת משלי:" says
  practice never names the author and the meter is hers alone, and a new
  "טבלה ריקה:" line says what is filled and the cards stay hers and nothing
  goes to Claude.

## Yoad's steps

1. **SQL** (Supabase → SQL Editor): run the whole `supabase/study-schema.sql`
   of this branch once. It is safe on wave 5's, wave 4's and wave 3's
   databases with their data. Afterwards `select public.study_schema();`
   shows `"E": 1` beside the rest.
2. **Flags**, any time (decision 3): `VITE_STUDY_BLANK_TABLE=1` (needs
   `VITE_STUDY_QUESTIONS`, `VITE_STUDY_PRACTICE` and `VITE_STUDY_CARDS`,
   production's) and `VITE_STUDY_TRAPS=1` (needs `VITE_STUDY_QUESTIONS`) in
   Vercel (Production), then redeploy. Each needs section E at 1. No new
   key, no switch: a check spends through the ledger (≈ $0.03, 5 a day a
   member, inside the monthly cap and a member's share).
3. `VITE_STUDY_QUIZ_ROUNDS` stays unset (Q11 is design only).

## The checks (this branch, final code)

| Check | Result |
|---|---|
| `npm run test:study` | 681 tests, 681 pass (new: `server/study/traps.test.ts`, `shared/study/blankTable.test.ts`, `shared/study/extras.test.ts`; `route.test.ts`'s registry with E 1 and E's flags on production's and wave 5's sets; `helpCopy.test.ts` with "טבלה ריקה"; `ai.test.ts` counts `trap_check` as built and keeps it in the schema gate) |
| `npm run test:contract` | 175 RPC calls and 110 table chains in 193 files match the schema (246 study functions, 67 study tables); 15 written columns granted |
| `npm run build` | passes; the study entry 333.88 kB (limit 400 kB) |
| `npm run test:bundle` | 346,145 bytes with every flag on; E's share 2,373 B; no package screen in the entry |
| The whole SQL twice on throwaway Postgres 16, then `supabase/tests/study.sql` | 0 load errors; 0 FAIL, 0 ERROR (844 "ok" lines, section E's 42: ES1-ES9, ES-reg); registry `{"B": 1, "C": 2, "E": 1, "F": 1, "J": 1, "K": 2, "M": 1, "N": 1, "P": 2, "Q": 2, "T": 1, "U": 1, "V": 1, "W": 2, "Z": 2}` |
| Upgrade from `study/wave5`'s, `study/wave4`'s and `study/wave3`'s SQL with data (their own checks 0 FAIL, then a lecture, a part, questions, answers, a card, a comment, a meeting), then this file twice | 0 errors each run; every table's rows kept and the content's hash unchanged (the two new columns of `study_questions` aside); new tables empty |

The e2e flows on the mocked Supabase, five builds: `off`, `rel1`
(production's), `w4` (wave 4's), `w5` (release 8) and `e5` (`w5` with
`TRAPS` and `BLANK_TABLE`). Every script exited 0 with no page error, no
unmocked or refused call and no accessibility problem, with one exception:
`meeting.cjs` on `w4` timed out once in the three-lane parallel run (the
part's stop button, as wave 5's integration saw) and passed twice alone
(53 ok).

| Script | off | rel1 | w4 | w5 | e5 |
|---|---|---|---|---|---|
| `extras.cjs` (E) | 5 ok (nothing of E) | 5 ok | 5 ok | 5 ok | 42 ok |
| `ahead.cjs` | 3 | 11 | 11 | 11 | 11 |
| `anchor.cjs` | 3 | 3 | 18 | 18 | 18 |
| `cards.cjs` | 2 | 26 | 26 | 37 | 37 |
| `meeting.cjs` | 4 | 4 | 53 (alone) | 53 | 53 |
| `practice.cjs` | 3 | 57 | 57 | 57 | 57 |
| `progress.cjs` | 5 | 5 | 5 | 38 | 38 |
| `pulse.cjs` | 4 | 4 | 5 | 44 | 44 |
| `quiz.cjs` | 2 | 2 | 47 | 47 | 47 |
| `shell.cjs` | 31 | 30 | 31 | 31 | 31 |
| `today.cjs` | 4 | 4 | 4 | 54 | 54 |
| `var.cjs` | 4 | 4 | 37 | 38 | 38 |
| `wall.cjs` | 5 | 5 | 36 | 36 | 36 |
| `writing.cjs` | 42 | 42 | 42 | 42 | 42 |
| `collab.cjs`, `summary.cjs`, `together.cjs`, `upload.cjs` | pass | pass | pass | pass | pass |

Known gaps: the quiz reveal's author line is built and type-checked, and
the unmask is checked in SQL through Z's own `study_quiz__score` (ES5), but
no e2e step drives a live quiz to it (`extras.cjs` uses the mock's stand-in
for the hook, then reads the line in practice). The prompt's quality
against real slides is not measured here (no call to Anthropic).
