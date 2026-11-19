# The group quiz (package Z)

What the study app's group quiz does, where it lives, how it is tested, and
the steps that turn it on in production (release 2). The build spec is
`spec/spec-final.md` (§3 section Z, §5.8, §6 "Copy · Z", §7.Z) with the
addendum's Z's end (`spec/addendum/addendum.md` §12.3.Z), which wins where they
differ; the design is `spec/sources/design-quiz.md`, and the approved screens
are `proposal/mockups/live-quiz.html`.

## What a member sees

- **Where it starts.** "מבחן קבוצתי" on "תרגול" (P1), "מבחן קבוצתי על ההרצאה"
  on a lecture's practice (P2), the lecture's chip "מבחן קבוצתי", and the
  card "מבחן קבוצתי" on "יחד" with "מבחן קבוצתי חדש" and the last quizzes
  ("{title} · כולנו נגד המבחן · היום · הקבוצה 83% · שלך 7/10"; after a race only
  "המקום שלך: 2", and "המקום שלך במירוץ האחרון: 2 מתוך 4").
- **The setup** (`?v=quiz&new=1`, `&l=<lecture>` from a lecture): the mode,
  "כולנו נגד המבחן" (the default; the group's record, "השיא: 86%") or "מירוץ";
  the lectures by course with their ready questions ("12 שאלות", or "אין עדיין
  שאלות · ליצירת שאלות"); 5 · 10 · 15 · 20 questions; 20-90 seconds a
  question (long ones and cases get more, by length); which kinds; "10 שאלות ·
  בערך 15 דקות" and the privacy line of the mode. **A lecture without enough
  questions** (one lecture, fewer than 5 ready; review UX-5) offers "ליצור
  שאלות ולפתוח את המבחן" with practice's estimate and the month's spending:
  the lobby opens at once, this phone writes a round through Q's op
  "questions" (F1's `rounds.ts`, the same reservation and ledger as practice),
  the lobby shows "נכתבות שאלות: 3 מתוך 10", and "להתחיל" waits for 5.
- **While a quiz is open**, the live banner on every screen of the group says
  "מבחן קבוצתי פתוח · בפנים: שוהם, נועה" (or "מירוץ פתוח", or "… עכשיו · שאלה 3
  מתוך 10") with "להצטרף"; a shared link (`?v=quiz&q=<id>`) does the same. A
  member who does not join watches ("צופים במבחן"): questions and reveals,
  never anyone's points. Joining in the middle: "מצטרפים באמצע: השאלות
  הקודמות לא נספרות."
- **The lobby**: who is in (a dot: connected or not), the rules of the mode,
  the link for WhatsApp, and the host's "להתחיל".
- **A question**: "3, 2, 1" on every phone at once (the server's clock, not
  the phone's), then the question, the timer, and the options. Vote 1 is
  alone, with a bet: "ניחוש" (+1 right, 0 wrong), "נראה לי" (+2, −2), "על
  בטוח" (+3, −6) (decision 2). An option chosen without a bet goes as "ניחוש"
  when 3 seconds are left. "לא יודעים" only in "כולנו נגד המבחן". After
  answering: "התשובה נקלטה." and "✓ התשובה נעולה עד החשיפה"; the top says
  "ענו 4 מתוך 6". The host of a "כולנו נגד המבחן" can reveal early ("לחשוף
  עכשיו").
- **The reveal** follows Mazur's rule on vote 1, from 3 answers: 70% right or
  more, the explanation; 30-70%, "חצויה: 90 שניות לשכנע": the counts without
  the key, 90 seconds of talking, then vote 2 (no bet; it counts for the
  group, the bet stays vote 1's); under 30%, the source: the slide opens on
  every player's phone ("רוב הקבוצה טעתה: פותחים את השקף."). Counts are shown
  only from 3 answers ("2 ענו" below that); the most chosen wrong option
  (unique, chosen by 2 or more of 3 or more) is "המלכודת של הסבב". Each player
  sees, alone ("רק לך"), their own bet's points; after a revote "בסבב 2: נכון ·
  הבנתי בדיון". The host can cancel a wrong question ("ביטול השאלה": it counts
  for nobody, also not in practice) and flag it with practice's sheet.
- **The race**: points by the bet only, speed only breaks a tie; the table
  ("1. נועה · 7 (+3)") goes only to the race's players and only during the
  game; the end is a podium of three and one's own place.
- **The end of "כולנו נגד המבחן"**: "הקבוצה ענתה נכון על 83%", "עברנו!" from
  80%, "שיא חדש!" over the group's record, the strip of questions, the question
  that broke the group, and one's own line ("שלך: 7 מתוך 10 · ניקוד ההימור: +9",
  "רק לך"). A solo quiz's score is never shown to the group.
- **When things go wrong**: a phone that lost its connection shows
  "מתחברים מחדש…" and catches up ("החיבור חזר."); a locked phone comes back to
  the right question and second; a host whose phone has not been heard from
  for 30 seconds (or who left) shows "לשוהם אין חיבור כרגע." with "לקחת את
  ניהול המבחן" to everyone else.

## Who sees what

Everything a phone shows comes from `study_quiz_state`, which gives each
member only what they may see: the key and the explanations only after the
reveal (the key is held from practice while its round is open,
`held_until`), counts only from 3 answers, the race's points only to its
players while it runs, and one's own bet and score only to oneself. The app
never reads the quiz's tables directly, only the functions; Realtime carries
only the quiz row (version, state, counts), never an answer. Every answer is
also copied at the reveal into its owner's private practice record (mode
`quiz`), so a mistake made in a quiz waits in the member's own mistakes.

## How it works

| Piece | File |
|---|---|
| Data: the calls, the view of the state on a phone, the server's clock, the one timer's next step, Realtime, the bet, the counts, the error texts | `src/study/lib/quiz.ts` |
| One hook per quiz screen: the state, Realtime, the ping, the timer, coming back from a locked phone, the wake lock | `src/study/lib/useQuiz.ts` |
| The open quiz of the group for the banner and "יחד" (one subscription per group, shared), and the little of the data they need, in the study entry (6 kB of the 8 kB a package may add there) | `src/study/lib/useOpenQuiz.ts`, `quizOpen.ts` |
| The setup, the room, their parts (bars, votes, the table, the end, the rules), in the approved screens' markup (`docs/study/proposal/mockups/live-quiz.html`) | `src/study/components/QuizSetup.tsx`, `Quiz.tsx`, `QuizParts.tsx` |
| The question and its reveal (the kit's `a-q`, `a-opts`, `a-opt`: the room's own, so practice's screens can change without moving it) | `src/study/components/QuizQuestion.tsx` |
| The banner's line and the card on "יחד" | `src/study/components/QuizBanner.tsx` |
| The slot (the screens are lazy) | `src/study/features/quiz.tsx` |
| Styles (the design system's components placed, tokens only, light and dark) | `src/study/styles/quiz.css` |
| The database: section Z with Z's end | `supabase/study-schema.sql`, between Z's markers |

Details that are easy to miss:

- **The database decides everything.** Opening a question, closing it, the
  reveal, the revote and the end are steps in SQL; every phone asks for the
  steps that are due (the reveal 1.5 seconds after the time, spread over 0.8
  seconds between phones) and the database takes the first and ignores the
  rest. A read of the state also makes a due step happen, so a quiz never
  stops while one phone is in it.
- **One timer.** Each phone keeps the server's clock (the offset of its
  fastest reply) and one timer: the next second on the screen, the reveal, or
  the 15-second ping. The screen and the timer read the same instant, so the
  question appears at the opening on every phone (the e2e measures under 300
  ms; locally about 10 ms).
- **No Claude call.** A quiz calls no model (Z-6). Only "ליצור שאלות ולפתוח את
  המבחן" writes questions, through practice's op, and spends like practice.
- **Questions.** The bank's questions of the chosen lectures and kinds that
  have a key: never a retired one, one a correction marked stale, or one two
  flags hid; flagged ones last; spread over the lectures' parts, those fewer
  of the players answered before first (counted from 3 players); in "כולנו
  נגד המבחן" in the lectures' order, in a race shuffled.

## Left out (with their hook points)

The addendum's Z's end is in the SQL as written; these parts of it wait for
other packages, and the app shows nothing of them:

- **"3 לקפה" and "stop"** (package M, the meeting): presets `coffee` and `stop`
  are refused with `meeting not found` until `study_meetings` exists;
  `study_quiz__pick_preset` returns nothing. Preset `end` (the meeting's
  closing quiz) is accepted without a meeting; only M's screens will open it.
  The route keeps `preset`, `m`, `pf` and `pt`; the slot's `QuizInline` (the
  quiz inside a meeting) renders nothing.
- **Trap cards** (C's end): a round's trap is named at the reveal; making it a
  group card is `study_private.trap_card` of C's end, so `study_quiz__trap_card`
  makes nothing until then, and the privacy line about trap cards appears only
  with C's end.
- **U's signal** (`study_quiz__signal`), **the boss battle** (H: mode `boss`,
  `study_quiz__pick_boss`, `__after_reveal`, `__boss_state`; the room already
  shows H's `BossHud` and `BossEnd` for that mode) and **E's members' traps**
  (`study_quiz__revealed`): no-ops until their sections.
- **A part range and "לחזור על השאלות"**: the SQL takes `p_part_from`/`p_part_to`
  for one lecture, but the setup offers no part chips yet, and the end's
  "לחזור על השאלות" needs practice's session to take a quiz's questions
  (`s=q.<quiz>`), which Q's session does not do yet.

## Flags

`VITE_STUDY_QUIZ` shows the quiz, on top of `VITE_STUDY_QUESTIONS` (without it
the quiz stays off). Release 2 is release 1's three flags plus this one. With
the quiz on, the app needs section Z at version 2 (`requiredSchema` in
`shared/study/flags.ts`, read by `src/study/lib/flags.ts`; the schema gate
shows otherwise). No API function changed, but `/api/study/health`'s
`schemaOk` asks for what the app built with the deployment's flags needs as
well as the server's sections (`healthSchema` in `server/study/study.ts`):
with the quiz on it is `true` only once `"schema"` shows `"Z":2`.

## Tests

```bash
npm run test:study -- quiz                       # Z-3: the client's logic (the view, the clock, the timer, events, the bet, the table)
npm run test:contract                            # every RPC and column the app names exists in the SQL
bash supabase/tests/quiz-concurrency.sh          # Z-2: six psql sessions at once (one reveal, one revote, every answer counted)
VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key \
  VITE_STUDY_QUESTIONS=1 VITE_STUDY_PRACTICE=1 VITE_STUDY_CARDS=1 VITE_STUDY_QUIZ=1 npx vite build --outDir /tmp/study-e2e-z
NODE_PATH=$(npm root -g) node e2e/study/quiz.cjs /tmp/study-e2e-z /tmp/study-e2e-z-out rel2   # Z-4
```

The SQL's checks are section Z's part of `supabase/tests/study.sql` (Z-1:
the spec's, with Z's end's ZA and ZS checks). `quiz.cjs` plays design-quiz
§6.5 with six phones against the mock (`e2e/study/mocks/quiz.cjs`, a port of
the SQL's steps): A, a "כולנו נגד המבחן" of ten questions (the banner, the link,
the countdown with one phone's clock 40 seconds fast, every reveal of Mazur's
rule, the slide, a locked phone, the host gone and taken over, a cancelled
question, the end); B, a race (the table only to its
players, rows without columns, the podium); C, a lecture without questions
(UX-5, through op "questions" for real against the mock); D, a reveal of two
answers. Every screen is checked by `a11y.cjs` at 390×844 and 360×640, light
and dark. With the flag off (`off`, `rel1`), it checks that the routes are
replaced and nothing links to the quiz.

## What was tested (on `study/z`; local only)

No production, no real Supabase project, no real model call: a throwaway
local Postgres and the e2e mock.

| Test | Result |
|---|---|
| The whole `study-schema.sql` (every section), loaded twice on the stubs and the board's schema | 0 errors; `tests/study.sql`: 420 check lines, 0 FAIL, 0 ERROR (116 of them section Z's QZ, ZA and ZS); `{"C": 1, "F": 1, "K": 1, "Q": 1, "Z": 2}` |
| Z-1: only sections F, Q and Z, loaded twice, with their checks | 0 errors; 296 check lines, 0 FAIL, 0 ERROR; `{"F": 1, "Q": 1, "Z": 2}` |
| Z-2: `quiz-concurrency.sh` (six psql sessions: a race's answers and six reveals at once; a split round's six second votes at once) | K1, K1b, K2, K3a, K3, K3b, K3c as expected |
| The upgrade: release 1's file (`origin/main`) with release 1's data, then this file twice | 0 errors each time; the registry goes from `{"C": 1, "F": 1, "K": 1, "Q": 1}` to `{"C": 1, "F": 1, "K": 1, "Q": 1, "Z": 2}`; every row kept; three members play a quiz on release 1's questions (the key held during the round, not in a member's state before the reveal, given back at the end; the answers copied as mode `quiz`) |
| Z-3 and the rest: `npm run test:study` | 404 tests, 0 failing (39 in `quiz.test.ts`) |
| `npm run test:contract` | 59 RPC calls and 58 table chains match the schema |
| `npm run build`, `npm run test:bundle` | the study entry 302,339 bytes with every flag on (limit 400,000); the quiz's screens lazy (`Quiz` 28 kB, `QuizSetup` 9 kB); Z's share of the entry 6.0 kB |
| Z-4: `quiz.cjs` with release 2's flags | 45 of 45 steps; 17 screens in light and dark at 390×844, every one through `a11y.cjs` at 390×844 and 360×640: 0 issues |
| Z-6 | no request to `/api/study/ai` during a quiz on written questions; the only model calls are op "questions" for a lecture without questions, each reserved and settled once |
| `summary.cjs`, `together.cjs`, `shell.cjs`, `practice.cjs`, `cards.cjs`, `quiz.cjs` with every flag off and with release 1's flags | all pass, 0 accessibility issues |

## Production (release 2), for Yoad

Release 2 ships as a whole: `RELEASE-2.md` has the steps in order (these
are its steps 4, 5, 9 and 10).

Release 1 must be live (`RELEASE-1.md`). The quiz adds no server key, no
Vercel function and no cost: only SQL and one flag.

1. **Run the SQL.** Supabase → SQL Editor → paste the whole
   `supabase/study-schema.sql` of this release (its branch once it is on
   GitHub, or `main` after the merge) → Run. It can be run again safely, and today's app keeps
   working (it only adds section Z and five columns on the questions and one
   on the answers). Check:

   ```sql
   select public.study_schema();
   ```

   It must answer `{"C": 1, "F": 1, "K": 1, "Q": 1, "Z": 2}` on the quiz's
   own branch; on `study/rel2` (with W1 and practice 2.0's server)
   `{"C": 1, "F": 1, "K": 1, "Q": 2, "W": 1, "Z": 2}`.
2. **Merge.** Tell Claude the SQL ran; Claude merges into `main`, and Vercel
   deploys it. Nothing changes for the group yet (the flag is off).
3. **Check `/api/study/health`**: `"schemaOk":true` and `"schema"` with
   `"Z":2`.
4. **Turn the quiz on.** Vercel → Settings → Environment Variables →
   Production: add `VITE_STUDY_QUIZ` = `1`, keeping `VITE_STUDY_QUESTIONS`,
   `VITE_STUDY_PRACTICE` and `VITE_STUDY_CARDS` at `1`. Then Deployments → the
   latest Production deployment → ⋯ → **Redeploy**.
5. **Check.** `/` → "תרגול" shows "מבחן קבוצתי"; "יחד" shows its card. On
   two phones: one opens a quiz of 5 questions on a lecture with questions,
   the other sees the banner and joins; play it to the end. With two players
   the reveals say "2 ענו" and the end shows no group score: counts and the
   group's score start at 3 players, as designed. Then, in the SQL Editor
   (read only):

   ```sql
   -- the last quizzes
   select mode, preset, state, n_total, players_n, created_at, ended_at
     from public.study_quizzes order by created_at desc limit 10;
   -- per question: answers of each vote, right, average time, cancelled
   select z.title, r.idx, r.seconds, r.voided_at is not null as cancelled, a.vote,
          count(a.*) as answered, count(*) filter (where a.correct) as right_n, round(avg(a.ms)) as avg_ms
     from public.study_quiz_rounds r join public.study_quizzes z on z.id = r.quiz_id
     left join public.study_quiz_answers a on a.round_id = r.id
    where r.revealed_at is not null group by 1, 2, 3, 4, 5 order by z.title, r.idx, a.vote;
   -- how often the 1.5 s grace saved a tap
   select count(*) filter (where a.answered_at > r.closes_at) as in_grace, count(*) as all_answers
     from public.study_quiz_answers a join public.study_quiz_rounds r on r.id = a.round_id;
   -- no key held outside a live round: 0 when no quiz is open
   select count(*) from public.study_question_keys where held_until > now();
   ```

   A quiz spends nothing: `public.study_usage` gets no row from it (only
   "ליצור שאלות ולפתוח את המבחן" adds practice's rows).
6. **Ask the group to reopen the app** (on an iPhone, swipe the Home Screen app
   away), so no phone keeps the old code.

**Rolling back:** Vercel → Environment Variables → delete `VITE_STUDY_QUIZ`
(or set it to `0`) → Redeploy. The quiz's entries disappear; a quiz link lands
on the library (a lecture's quiz link on its practice) with one line, "התכונה
הזו עוד לא פתוחה.". The quizzes and answers stay in the database. Don't touch
the SQL, and never drop tables.
