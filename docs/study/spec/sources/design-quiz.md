# תמצית: the live group quiz (design)

**Scope.** Item 2 of the requirements: "מבחן קבוצתי בזמן אמת" and "מבחן תחרותי בזמן אמת", built on the practice questions of item 1 (`spec/design-questions.md`). One engine, two modes:

- **מבחן קבוצתי** (mode `coop`): everyone answers each question on their own phone; then the group sees how it answered, the right answer, why every option is right or wrong, and talks it over before moving on. No points.
- **מבחן תחרותי** (mode `race`): points for a right answer and more for a fast one, a table after every question, a podium at the end.

**Design only.** Nothing in the repo or in production was changed. No request went to `delo-logo-review.vercel.app` or to the real Supabase project, and no group or data was created anywhere real. Everything marked "tested" ran on local tools in this sandbox: Postgres 16.15, the repo's TypeScript 5.9.3 and `@supabase/supabase-js` 2.108.2, Playwright 1.63.0 with Chromium. All of it re-runs with `spec/quiz-proto/run-all.sh` (offline; throwaway databases are dropped).

**Built on** (read first; this design uses their names):

- `spec/design-questions.md`: `study_questions`, the hidden `study_question_keys`, the private `study_answers` (mode `'quiz'` already allowed), `study_question_flags`, `QuestionCard`, `FlagSheet`, the release flag. Its §2.4 asks the quiz for two things, both delivered here: functions that record quiz answers privately without returning the key and reveal keys only when a round closes (§2.2), and a condition in the practice functions that refuses an open round's question (§2.3).
- `spec/design-platform.md`: routes (§1.E, `{ v: "quiz"; q?; l?; isNew? }`), the "יחד" tab, the shell's live banner, the function budget (§3.1), the ledger (§3.5).
- `spec/research-claude.md` §1.7: "The live quiz reuses stored questions, so it costs nothing."
- `spec/research-auth.md` and `research-auth-merge.sql`: the account merge every user column must join.

**Proven here** (all under `spec/quiz-proto/`)

| What | Result | Where |
|---|---|---|
| The data model and every function, as exact SQL | Loaded **twice** on top of `study-schema.sql` + `design-platform.sql` + the questions block, on Postgres 16. **83 check lines, all as expected** (§6.1). With the quiz loaded, the repo's own `supabase/tests/study.sql` and the questions design's 80 checks still give **0 FAIL** | `sql/quiz.sql`, `sql/questions-hold.sql`, `sql/quiz-test.sql`, `run-sql.sh` |
| Six phones at once | Six answers in the same instant: all six kept, **one** reveal, six private copies. Six reveal requests in the same instant: **one** reveal, one version step | `run-concurrency.sh` |
| The account merge | A person who played on two devices keeps one seat; every user column of the quiz is merged (M1-M6) | `sql/merge-lines.sql`, `sql/merge-test.sql` |
| The client's logic | **27 checks**: the server clock with a phone 40 s off, every screen state, when a phone acts by itself, Realtime events, the race table, points equal to the SQL's. Plus the Supabase wrappers and the React hook (§4.3), type-checked under the repo's strict compiler options | `src/quizLogic.ts`, `src/quizApi.ts`, `src/useQuiz.ts`, `test/run.ts` |
| The Realtime contract | Against the installed supabase-js and a Phoenix 2.0.0 mock like the repo's e2e mock: a `postgres_changes` UPDATE reaches the callback as `payload.new` with **every column** of the quiz row; after the socket is dropped (a phone locking), the client **reconnects in about 1 s** and reports `SUBSCRIBED` again, where the quiz re-reads its state | `e2e/realtime-contract.cjs`, `out/realtime-contract.txt` |
| Payload sizes | With the questions design's two stand-in clinical cases: the state while a question is open **about 2.8-3.0 KB**; after its reveal **about 3.8-4.1 KB**; a Realtime event's row **about 650 bytes**; a two-round end summary **about 5.6 KB** (a few bytes vary with the timestamps) | `run-size.sh`, `sql/size-probe.sql` |

**Not verified, said plainly**

- **Phones.** How iOS and Android treat a web socket when the screen locks was not tested on devices. The design does not depend on it: a phone that comes back re-reads everything (§2.5), which the Realtime contract test exercised by dropping the socket.
- **Supabase's hosted Realtime** was not exercised (no requests to the real project). Its behaviour here comes from its documentation (RLS checked per subscriber, full rows in events, no replay for Postgres Changes) and from the mock test.
- **When `now()` starts.** Answers are stamped with the transaction's start time; that PostgREST starts the transaction as the request arrives is an assumption (it moves a stamp by milliseconds at most).
- **Wake Lock** support comes from MDN's compatibility data, not from devices.
- **The UI is not built**, so the Playwright run of §6.5 is a plan. The parts of it that could go wrong at the protocol level (row payloads, reconnects) were tested (§6.4).

---

## Decisions at a glance

1. **One engine, two modes.** `coop` and `race` share the tables and the functions; the mode changes only scoring, what is shown, and who may reveal early.
2. **The database is the referee.** The clock, the answer key and the scores stay in Postgres. A phone sends one thing, "option 2 for round 4"; the server stamps the time, keeps the first answer only, takes nothing after the reveal, and reads the key only inside the reveal, which scores everyone at once.
3. **One published row.** `study_quizzes` is the only quiz table in Realtime. Every step (join, open, reveal, new host, end) bumps its `version`; an answer only moves `answered_n`. Phones re-read `study_quiz_state()` when the version moves, and a 15-second ping catches anything missed while a socket was down. No presence, no broadcast (§2.5).
4. **Any phone may nudge; the server decides.** At the deadline plus 1.5 s any player's phone asks for the reveal, and any read of the state reveals a round 4.5 s after its deadline. The host is needed only to start and to move on, and a host not seen for 30 s can be replaced by any player.
5. **An open round holds its key.** While a round is open, practice, review and past-exam functions refuse its question (`study_question_keys.held_until`, §2.3). Without it, answering the same question in practice would return the key.
6. **Private by default.** In a group quiz the group sees counts per option, never names; each person sees only their own choices and result. In a race, points and places are shown to its players, which the setup and lobby say before anyone joins. Each answer is copied at the reveal into its owner's private `study_answers` (mode `'quiz'`), so quiz mistakes count in "הטעויות שלי" and weak points (open question 1).
7. **Fair timing.** Race points: 500 for a right answer plus up to 500 for speed, from the server's clock. Long questions and clinical cases get more time by their length. In a race even the host cannot reveal early.
8. **Cost: $0 of Claude per quiz.** It uses stored questions. About 460 Realtime messages for a 10-question quiz of six (the free plan includes 2 million a month).
9. **One open quiz per group.** A quiz nobody has touched for 20 minutes is over.
10. **Nothing new on Vercel.** No function, no environment variable; the browser calls the database functions with the member's own token, as it calls `study_join` today. A build flag, `VITE_STUDY_QUIZ`, keeps it off until it is switched on.

---

## 1. User stories and UI flow

### 1.1 Stories

- After the group reads a lecture together, Shoham opens a group quiz on it: 10 questions, a minute each. The others join from the banner. Everyone answers on their own phone; after each question the group sees "4 מתוך 6 ענו נכון", how many chose each option, why every option is right or wrong, and the slide. They talk, and Shoham moves on.
- Before an exam the group plays a race over a whole course: 15 questions, 30 seconds each, points for being right and fast, a table after every question and a podium at the end.
- Noa arrives late, taps the banner and joins in the middle. The questions she missed do not count for her.
- Shoham's phone locks in the middle of a question. The question still closes on time and the answer is shown. If her phone is still away when the group wants to go on, Noa takes over managing the quiz with one tap.
- A phone loses signal or goes to sleep. When it is back, the screen catches up at once, and an answer sent in time still counts.
- My choices and my score in a group quiz are visible only to me; the race table is visible only to the race's players. My quiz mistakes wait for me in "הטעויות שלי".
- A question turns out to be wrong: whoever manages the quiz cancels it for everyone; anyone can flag it for the group.
- A member who does not want to play can watch.

### 1.2 Where it lives

Routes follow the platform's `route.ts` (query strings on `/study/`, so `vercel.json` needs nothing):

| Screen | URL | Tab bar |
|---|---|---|
| Setup | `/study/?v=quiz&new=1`, preselected with `&l=<lectureId>` or `&c=<course>` (URL-encoded) | hidden |
| The room: lobby, question, reveal, end | `/study/?v=quiz&q=<quizId>` (shareable on WhatsApp) | hidden |

Entry points:

- the banner (every screen except the room itself);
- the "יחד" tab's card "מבחן קבוצתי" (platform §1.E);
- the lecture's action chip "מבחן קבוצתי" → `?v=quiz&new=1&l=<id>` (platform §1.E already lists it);
- practice P2 (a lecture's practice, questions design): a link "מבחן קבוצתי על ההרצאה";
- the end screen's "מבחן נוסף".

**If the quiz lands before the platform's shell:** `StudyApp`'s `View` gains `{ name: "quiz"; id?: string; lecture?: string; course?: string }` read from `?v=quiz`; `Library` shows `QuizBanner` above the courses and a header button "מבחן קבוצתי". Nothing else changes.

**Release.** Behind `VITE_STUDY_QUIZ` (off by default). It needs the questions SQL and question generation, so it is switched on with practice or after it. Whether it may go out before email sign-in is open question 2.

### 1.3 Screens

Copy is gender-neutral: infinitives, nouns, plurals, and "בטלפון של שוהם" instead of a gendered verb about a person. English terms stay in English, isolated with `isolateLatin`; times and scores are wrapped in `<bdi>`. Every screen works in the real dark mode (tokens in `study.css`) and at 360 px wide. Counts of people are names, not numbers with a noun ("בפנים: שוהם, נועה +2", as the reading room's "כאן: …" does), so no count needs a gendered "משתתף אחד".

**B. The banner** (the shell's `LiveBanner`; or the top of the library)

- Lobby: **"מבחן קבוצתי פתוח · בפנים: שוהם, נועה"** + **"להצטרף"**. A race: **"מבחן תחרותי פתוח · …"**.
- Running: **"מבחן קבוצתי עכשיו · שאלה 4 מתוך 10 · בפנים: שוהם, נועה +3"** + **"להצטרף"**.
- I am in it but on another screen: **"חזרה למבחן"**.
- Source: `study_quiz_open(group)` (names from the member list), refreshed by Postgres Changes on `study_quizzes` filtered by `group_id` (§2.5). Hidden on the quiz's own screens. A quiz untouched for 20 minutes is not shown.

**S. Setup: "מבחן קבוצתי חדש"**

- Back **"→ חזרה"**.
- **"איזה מבחן"**: two radio cards.
  - **"קבוצתי"**: "כל הקבוצה עונה, ואחרי כל שאלה רואים יחד כמה בחרו בכל תשובה, את ההסבר לכל תשובה, ומדברים על זה. בלי ניקוד."
  - **"תחרותי"**: "נקודות על תשובה נכונה, ועוד נקודות על מהירות. אחרי כל שאלה יש טבלה."
- **"על מה"**: lectures grouped by course in the library's order, a checkbox row each: the title and **"15 שאלות"** (`study_quiz_pool`). A course header row has **"כל הקורס"**. A lecture without questions: **"אין עדיין שאלות"** and a small link **"ליצירת שאלות"** (→ the questions design's P2 for that lecture). Preselected from `l` or `c`.
- **"כמה שאלות"**: 5 · 10 · 15 · 20. Counts above what is ready are disabled; under them: **"מוכנות 47 שאלות בהרצאות שנבחרו."**
- **"זמן לשאלה"**: 20 · 30 · 45 · 60 · 90 שניות. Under it: **"שאלות ארוכות ומקרים קליניים מקבלים יותר זמן, לפי האורך."**
- **"אילו שאלות"**: **"הכול"** · **"רק אמריקאיות"** · **"רק מקרים קליניים"**.
- A summary line: **"10 שאלות · בערך 12 דקות"** (Σ question times + 30 s a reveal in a group quiz, 10 s in a race).
- **"המבחן לא עולה מהתקציב: השאלות כבר כתובות."**
- The privacy line for the chosen mode:
  - group: **"רואים רק כמה בחרו בכל תשובה, בלי שמות. התשובות שלך נשמרות בתרגול שלך, גלויות רק לך."**
  - race: **"במבחן תחרותי כל המשתתפים רואים את הניקוד והדירוג של כל המשתתפים."**
- Primary **"פתיחת המבחן"**. Disabled with **"צריך לבחור הרצאה שיש לה שאלות."** when nothing is ready.
- `quiz open` (another member opened one first): **"יש כבר מבחן פתוח בקבוצה."** + **"להצטרף אליו"**.
- Defaults: group 10 × 60 s, race 10 × 30 s, all kinds; the last choice is remembered on the device (`localStorage` `study-quiz-setup`, in try/catch).

**L. Lobby**

- Top: **"→ יציאה"**, the quiz's title, a chip **"קבוצתי"** or **"תחרותי"**.
- **"ממתינים להתחלה"** and the settings: **"10 שאלות · 60 שניות לשאלה"**.
- The people, one row each: a dot (green: here; grey: away, not seen for 30 s), the name, and **"ניהול"** on the one managing.
- **"שיתוף קישור למבחן"**: `navigator.share({ text })`, else copy, with the text **"מבחן קבוצתי בתמצית: Antimalarials. מצטרפים כאן: <link>"**.
- Managing phone: primary **"להתחיל"**. If fewer questions are ready than chosen: **"יש רק 4 שאלות מוכנות, אז המבחן יהיה של 4."** Menu: **"ביטול המבחן"**.
- Other phones: **"המבחן יתחיל אחרי לחיצה על ״להתחיל״ בטלפון של שוהם."**
- A race, under the list: **"הניקוד והדירוג גלויים לכל המשתתפים."**
- A member who has not joined: primary **"להצטרף למבחן"**, and **"אפשר גם רק לצפות."**
- Leaving as the managing phone asks first: **"לצאת? ניהול המבחן יעבור לנועה."**

**C. Countdown** (the 3 s before a question opens)

- **"שאלה 1 מתוך 10"**, a large **"3"**, **"מתחילים…"**. The question has already arrived but is shown only at zero, so every phone shows it at the same server instant.
- A race adds **"נכון ומהר = יותר נקודות"**.

**Q. A question**

- A sticky top bar: **"✕"** (`aria-label="יציאה מהמבחן"`), **"שאלה 3 / 10"**, a ring timer with **"0:24"** (`role="timer"`), and in a race the player's own score **"1,940 נק׳"**.
- The questions design's `QuestionCard`: chips (**"מקרה קליני"**; the lecture's title when the quiz spans several lectures), the vignette, the lead-in in bold, options with Hebrew letter badges **א ב ג ד ה**, each at least 52 px tall.
- Group quiz: the link **"לא יודעים"** under the options.
- A status line: **"4 מתוך 6 ענו"** (a count, never names).
- The managing phone in a group quiz: a ghost button **"לחשוף עכשיו"** (for when the rest are talking it over already).
- After a tap: that option is marked **"נבחרה"** in a neutral colour (nothing says right or wrong), the others are disabled, and the line reads **"התשובה נקלטה."** In a race: **"התשובה נקלטה אחרי 7 שניות."** While it is being sent: **"שולחים…"**.
- The last 10 seconds: the timer turns to the warning colour, and a polite live region says **"נשארו 10 שניות"** once.
- Time is up with no answer: **"הזמן נגמר."**; then **"חושפים את התשובה…"**.
- Errors: `closed` → **"הזמן נגמר לפני שהתשובה הגיעה."**; no connection → **"אין חיבור כרגע. התשובה תישלח כשהחיבור יחזור, אם עוד יהיה זמן."**
- Joining in the middle: a toast **"מצטרפים באמצע: השאלות הקודמות לא נספרות."**

**R1. The reveal, group quiz**

- A headline in a live region: **"✓ תשובה נכונה"** · **"✗ התשובה הנכונה: ב"** · after "לא יודעים": **"התשובה הנכונה: ב"** · no answer: **"לא נשלחה תשובה. התשובה הנכונה: ב"**.
- The group: **"4 מתוך 6 ענו נכון"**, and when some chose "לא יודעים": **"· ״לא יודעים״: 1"**.
- Every option keeps its place, with a bar and its count as text (**"3"**), never colour alone. The right one: green border and **"התשובה הנכונה"**. Mine, when wrong: **"הבחירה שלך"**. Under each option, its explanation; slide tags are `src-tag` chips that open `?l=<id>&slide=<n>` (questions design), and Back returns to the room.
- The box **"מה לזכור"** with the takeaway.
- A line for the talk: **"זה הזמן לדבר על השאלה: למה כל תשובה נראתה נכונה, ומה כתוב בשקף."**
- The managing phone: primary **"לשאלה הבאה"** (after the last: **"לסיום המבחן"**) and a link **"ביטול השאלה"**, which asks **"לבטל את השאלה? היא לא תיספר לאף אחד, גם לא בתרגול."**
- The other phones: **"ממתינים לשאלה הבאה · ניהול: שוהם"**.
- Everyone: **"משהו לא בסדר בשאלה?"** → the questions design's `FlagSheet`.
- A cancelled question: a chip **"השאלה בוטלה · שוהם"**.

**R2. The reveal, race**

- Headline: **"✓ תשובה נכונה · +870"** · **"✗ 0 נקודות · התשובה הנכונה: ב"** · **"לא נשלחה תשובה · 0 נקודות"**.
- **"3 מתוך 6 ענו נכון"**, the options with their counts as in a group quiz; the explanations folded under **"להסברים"** (the race keeps its pace; one tap opens them).
- The table, all players: **"1. נועה · 2,690 (+870)"**, an arrow ↑ or ↓ when a place changed, my row highlighted.
- The managing phone: **"לשאלה הבאה"** (after the last: **"לסיום המבחן"**).

**E1. The end, group quiz**

- **"סוף המבחן"** and the quiz's title.
- The group: **"הקבוצה ענתה נכון על 72% מהתשובות"**; a strip per question, **"1 · 5/6"**, **"2 · 2/6"** … (a tap opens it read-only, as R1).
- **"הכי קשות לקבוצה"**: the two questions with the lowest share right, each with its lead-in's first words and **"2 מתוך 6 ענו נכון"**.
- A card marked **"גלוי רק לך"**: **"שלך: 8 מתוך 10"**, and (when practice is on) **"הטעויות נשמרו ב״הטעויות שלי״."**
- Primary **"מבחן נוסף"** (setup with the same choices), then **"לחזור על השאלות"**, **"חזרה לספרייה"**.

**E2. The end, race**

- **"סוף המבחן"**; the podium: **"מקום ראשון: נועה · 7,420"**, **"מקום שני: שוהם · 6,980"**, **"מקום שלישי: יעל · 5,100"**; then the whole table.
- **"המקום שלך: 2 מתוך 6 · 8 תשובות נכונות"**.
- Primary **"עוד סיבוב"** (a new race with the same choices), **"לחזור על השאלות"**, **"חזרה לספרייה"**.

**H. Managing and the connection** (lines over any room screen)

- The managing phone is away (`host_here` false), shown in the lobby and after a reveal, the moments the group needs it: **"לשוהם אין חיבור כרגע."** + **"לקחת את ניהול המבחן"**. On this phone after the tap: **"הניהול עבר לטלפון הזה."**; on the others: **"ניהול המבחן עבר לנועה."**
- The former manager, back: **"ניהול המבחן עבר לנועה בזמן שלא היה חיבור."**
- The socket is not subscribed for more than 2 s, or the device is offline: a thin bar **"מתחברים מחדש…"**; back: a toast **"החיבור חזר."**
- Leaving as a player: **"לצאת מהמבחן? אפשר לחזור דרך הבאנר."**
- Watching without playing: a top line **"צופים במבחן"** + **"להצטרף"**.
- A cancelled quiz: **"המבחן בוטל."** + **"חזרה לספרייה"**. An ended quiz opened from an old link by someone who did not play: **"המבחן הסתיים."** + **"מבחן חדש"**.

**Y. The "יחד" tab's card "מבחן קבוצתי"** (platform skeleton)

- An open quiz: the banner's line and button.
- Otherwise primary **"מבחן קבוצתי חדש"**, and the last three (`study_quiz_recent`): **"Antimalarials · קבוצתי · אתמול · הקבוצה 72%"**, followed only on my own phone by **"· שלך 8/10"** (a race: **"· המקום שלך: 2"**).

### 1.4 Who sees what

| What | The player | Other players | Members watching | Kept in |
|---|---|---|---|---|
| The open question (stem, options) | yes | yes | yes | `study_questions` (shared bank) |
| Its key and every option's explanation | after the reveal | after the reveal | after the reveal | `study_question_keys` (no grants) |
| My choice | yes | **never**: counts only | never | `study_quiz_answers` (no grants) |
| How many chose each option | after the reveal | after the reveal | after the reveal | computed in `study_quiz_state` |
| How many have answered so far | count | count | count | `study_quizzes.answered_n` |
| Race points, places, points this round | yes | yes | **no** | `study_quiz_players` (no grants) |
| My result in a group quiz | yes | **no** | no | `study_quiz_players` |
| My quiz answers in my mistakes and weak points | yes | no | no | `study_answers`, mode `'quiz'` (owner only) |
| The group's share right per quiz | yes | yes | yes ("יחד" card) | computed |

A small group can still infer: with two players in a group quiz and counts of one and one, each knows the other's choice. That is the nature of counts; the copy never names anyone.

### 1.5 Times

| Rule | Value | Where |
|---|---|---|
| A question opens after the managing phone's tap | 3 s (every phone has it by then) | `study_quiz__open` |
| Time for a question | `max(setting, ⌈characters ÷ 15⌉ + 10)` s, at most 240 (reading about 15 characters a second, plus 10 s to choose) | `study_quiz__seconds` |
| Answers taken after the deadline | 1.5 s (a tap sent in time is not lost in transit) | `study_quiz_answer` |
| Any player may reveal | from the deadline + 1.5 s | `study_quiz_reveal` |
| Any read of the state reveals | from the deadline + 4.5 s | `study_quiz__due` |
| A player is "away" (not waited for; a manager can be replaced) | not seen for 30 s | `study_quiz__all_answered`, `__host_here` |
| A phone's ping while the screen is on | every 15 s | `useQuiz` |
| A quiz is over | untouched for 20 minutes | `study_quiz_create`, `study_quiz_open` |
| An open round holds its key | until its reveal, or 10 minutes after its deadline | `__open`, `__reveal`, `questions-hold.sql` |

---

## 2. Data model

### 2.1 Tables

| Table | Who reads | Who writes | Realtime |
|---|---|---|---|
| `study_quizzes`: one row per game (mode, lectures, settings, state, the round on screen and its times, counts, `version`, who manages) | members of the group (RLS) | only the functions | **yes, the only quiz table** |
| `study_quiz_rounds`: one row per question of a game, chosen at the start; its time, opening, deadline, reveal, the key as revealed, cancellation | **nobody** (RLS on, no policy, no grant) | the functions | no |
| `study_quiz_players`: who plays, when they joined, the last sign of life, score and counts | **nobody** directly; `study_quiz_state()` hands each caller what they may see | the functions | no |
| `study_quiz_answers`: one row per player per round, the first answer; correctness and points set at the reveal | **nobody** directly | the functions | no |

Design rules:

- **Every write goes through a `security definer` function** that takes the quiz row's lock first (`select … for update`), so the answers, reveals and moves of one quiz run one at a time and each sees the others' result. Tested with six phones at once (§6.2).
- **The round list is not readable** until a round is on screen, so nobody can read the coming questions in the lobby. `study_quiz_state()` returns the current round only.
- **Own primary keys, and nothing private is published.** Realtime sends a deleted row's primary key to every subscriber without RLS ("RLS policies are not applied to `DELETE` statements", Postgres Changes doc); the only published table's key is a random quiz id that says nothing.
- **No column grants needed:** members never insert or update a quiz table; their only privilege is `select` on `study_quizzes` (RLS: their group's), and `execute` on the public functions. The internal `study_quiz__*` helpers are revoked from everyone.
- **Caps in the database:** 3-30 questions, 15-120 s a question (240 s with the length rule), 40 lectures, one open quiz per group (a partial unique index plus an advisory lock, so two members tapping at once get one quiz and one clear "quiz open").
- **The quiz block comes after the questions block** in `study-schema.sql`: it references `study_questions`, `study_question_keys`, `study_question_flags` and `study_answers`, and the file's policy-dropping loop (`tablename like 'study\_%'`) already drops and recreates its one policy on every run.

### 2.2 The SQL (append to `supabase/study-schema.sql`, after the practice-questions block)

Tested exactly as printed (`spec/quiz-proto/sql/quiz.sql`): loaded twice, then 83 checks (§6.1).

```sql
-- ═══════════════════════════════════════════════════════════════════════
--  PROPOSAL (not in the repo yet): the live group quiz, "מבחן קבוצתי"
--  (mode 'coop') and "מבחן תחרותי" (mode 'race'). To be appended to
--  supabase/study-schema.sql AFTER the practice-questions block
--  (design-questions.md): it reads study_questions, study_question_keys and
--  study_question_flags, and writes study_answers. Re-runnable.
--
--  The database is the referee
--  ───────────────────────────
--  The clock, the answer key and the scores stay in Postgres until their
--  time. A phone sends one thing, "option 2 for question 4", through
--  study_quiz_answer(); the server stamps the time itself and keeps the
--  first answer only. The key is read only inside the reveal, which scores
--  everyone at once, closes the round for good and copies each answer into
--  its owner's private study_answers (mode 'quiz'), so a quiz answer counts
--  in that member's own mistakes and weak points, as practice does. While a
--  round is open its key is "held" (study_question_keys.held_until), so the
--  practice functions refuse to hand it out (questions-hold.sql).
--
--  Who sees what
--  ─────────────
--  study_quizzes (the whole group): that a quiz is open or was held, its
--    lectures, settings, state, host, how many play and how many answered.
--    Nothing secret, so the library banner reads it and Realtime sends it.
--  study_quiz_rounds / _players / _answers: no grants at all.
--    study_quiz_state() hands each caller what they may see: the question
--    while it is open, never its key; after the reveal the key, every
--    option's explanation and the anonymous count per option; the others'
--    scores only in a race and only to its players; in a group quiz each
--    player's result only to that player.
--
--  Realtime: only study_quizzes is published. Everything a phone must react
--  to (a join, a question opening, the answer count, the reveal, a new host,
--  the end) changes that one row; Postgres Changes, checked against its RLS
--  for every subscriber, tells the phones, and they read study_quiz_state().
--  version changes on every step; an answer only moves answered_n.
--
--  Times: a question opens 3 s after the host's tap (every phone has it by
--  then and counts down to the same server instant); answers are taken until
--  1.5 s after its deadline (a tap sent in time is not lost in transit); a
--  round still open 3 s after that is revealed by whichever phone asks next;
--  a player not seen for 30 s is "away" (not waited for; a host who is away
--  can be replaced); a quiz untouched for 20 minutes is over.
-- ═══════════════════════════════════════════════════════════════════════

-- ── A quiz: one row per game. idx = the round on screen (-1 in the lobby);
--  opens_at/closes_at repeat that round's times so a phone can start counting
--  down from the Realtime event alone.
create table if not exists public.study_quizzes (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.study_groups (id) on delete cascade,
  mode        text        not null check (mode in ('coop', 'race')),
  title       text        not null check (char_length(title) between 1 and 200),
  lecture_ids uuid[]      not null check (cardinality(lecture_ids) between 1 and 40),
  kinds       text        not null default 'all' check (kinds in ('all', 'mcq', 'case')),
  n_wanted    int         not null check (n_wanted between 3 and 30),
  seconds     int         not null check (seconds between 15 and 120),
  state       text        not null default 'lobby'
                          check (state in ('lobby', 'question', 'reveal', 'ended', 'cancelled')),
  idx         int         not null default -1 check (idx between -1 and 29),
  n_total     int         not null default 0 check (n_total between 0 and 30),
  opens_at    timestamptz,
  closes_at   timestamptz,
  answered_n  int         not null default 0 check (answered_n >= 0),
  players_n   int         not null default 0 check (players_n >= 0),
  version     int         not null default 0,
  host_id     uuid        references auth.users (id) on delete set null,
  created_by  uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  ended_at    timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists study_quizzes_group on public.study_quizzes (group_id, created_at desc);
-- One live quiz per group: the banner shows "the" open quiz.
create unique index if not exists study_quizzes_one_open on public.study_quizzes (group_id)
  where state in ('lobby', 'question', 'reveal');

-- ── Its questions, chosen when it starts. seconds: the host's setting, or
--  more for a long question (study_quiz__seconds). answer: the key as it was
--  at the reveal (history stays right if an exam item is re-keyed later).
--  A question deleted with its lecture leaves the round without one: a round
--  not yet open is skipped, an open one is voided at its reveal.
create table if not exists public.study_quiz_rounds (
  id          uuid        primary key default gen_random_uuid(),
  quiz_id     uuid        not null references public.study_quizzes (id) on delete cascade,
  idx         int         not null check (idx between 0 and 29),
  question_id uuid        references public.study_questions (id) on delete set null,
  seconds     int         not null check (seconds between 15 and 240),
  opens_at    timestamptz,
  closes_at   timestamptz,
  revealed_at timestamptz,
  answer      smallint,
  voided_at   timestamptz,
  voided_by   uuid        references auth.users (id) on delete set null,
  unique (quiz_id, idx)
);
create index if not exists study_quiz_rounds_question on public.study_quiz_rounds (question_id);

-- ── Who plays. seen_at: the last sign of life (every answer, host action
--  and the phone's ping every 15 s while the screen is on). joined_idx: the
--  round on screen when they joined (-1: from the lobby).
create table if not exists public.study_quiz_players (
  quiz_id    uuid        not null references public.study_quizzes (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  joined_idx int         not null default -1,
  seen_at    timestamptz not null default now(),
  left_at    timestamptz,
  score      int         not null default 0 check (score >= 0),
  correct_n  int         not null default 0 check (correct_n >= 0),
  answered_n int         not null default 0 check (answered_n >= 0),
  primary key (quiz_id, user_id)
);
create index if not exists study_quiz_players_user on public.study_quiz_players (user_id);

-- ── One answer per player per round, the first one. choice null = "לא
--  יודעים" (group quiz only). ms: from the round's opening to the server's
--  receipt, capped at the round's time. correct and points are set by the
--  reveal, never before.
create table if not exists public.study_quiz_answers (
  round_id    uuid        not null references public.study_quiz_rounds (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  choice      smallint    check (choice >= 0),
  ms          int         not null check (ms between 0 and 240000),
  answered_at timestamptz not null,
  correct     boolean,
  points      int         not null default 0 check (points between 0 and 1000),
  primary key (round_id, user_id)
);
create index if not exists study_quiz_answers_user on public.study_quiz_answers (user_id);

-- ═══════════════════════════════════════════════════════════════════════
--  Internal helpers (no grants: only the functions below call them, as
--  their owner). The public functions take the quiz row lock first
--  (select ... for update), so answers, reveals and moves of one quiz run
--  one at a time and each sees the others' result.
-- ═══════════════════════════════════════════════════════════════════════

-- Seconds for one question: the host's setting, or more for a long one
-- (reading about 15 characters a second, plus 10 seconds to choose).
create or replace function public.study_quiz__seconds(p_setting int, p_chars int)
returns int language sql immutable set search_path = public as $$
  select least(240, greatest(p_setting, ceil(coalesce(p_chars, 0) / 15.0)::int + 10));
$$;

-- The caller is playing (joined and not left).
create or replace function public.study_quiz__playing(p_quiz uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.study_quiz_players p
                  where p.quiz_id = p_quiz and p.user_id = auth.uid() and p.left_at is null);
$$;

-- The host is still playing and was seen in the last 30 seconds.
create or replace function public.study_quiz__host_here(p_quiz uuid)
returns boolean language sql volatile security definer set search_path = public as $$
  select exists (select 1 from public.study_quizzes z
                   join public.study_quiz_players p on p.quiz_id = z.id and p.user_id = z.host_id
                  where z.id = p_quiz and p.left_at is null
                    and p.seen_at > clock_timestamp() - interval '30 seconds');
$$;

create or replace function public.study_quiz__seen(p_quiz uuid)
returns void language sql volatile security definer set search_path = public as $$
  update public.study_quiz_players p set seen_at = clock_timestamp()
   where p.quiz_id = p_quiz and p.user_id = auth.uid() and p.left_at is null;
$$;

-- Everyone still playing and not away (seen in the last 30 s) has answered
-- round p_idx. A player whose phone locked is not waited for; the deadline
-- still closes the round.
create or replace function public.study_quiz__all_answered(p_quiz uuid, p_idx int)
returns boolean language sql volatile security definer set search_path = public as $$
  select not exists (
    select 1 from public.study_quiz_players p
     where p.quiz_id = p_quiz and p.left_at is null
       and p.seen_at > clock_timestamp() - interval '30 seconds'
       and not exists (select 1 from public.study_quiz_answers a
                         join public.study_quiz_rounds r on r.id = a.round_id
                        where r.quiz_id = p_quiz and r.idx = p_idx and a.user_id = p.user_id));
$$;

-- Chooses the questions when the quiz starts (the players are known then):
-- keyed and not retired, from the chosen lectures and kinds; spread over the
-- summary's parts; questions flagged as wrong last; then those the fewest of
-- these players have answered before (counted from their private answers,
-- used only for the order, never returned); then at random. A group quiz
-- follows the lectures' order; a race is shuffled.
create or replace function public.study_quiz__pick(p_quiz uuid)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  z public.study_quizzes;
  n int;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  delete from public.study_quiz_rounds r where r.quiz_id = p_quiz;
  with pool as (
    select q.id,
           char_length(q.vignette) + char_length(q.question)
             + coalesce((select sum(char_length(o)) from unnest(q.options) as o), 0) as chars,
           array_position(z.lecture_ids, coalesce(q.lecture_id, q.ref_lecture)) as lec_pos,
           coalesce(q.part_idx, -1) as part_idx,
           exists (select 1 from public.study_question_flags f
                    where f.question_id = q.id and f.reason in ('wrong_key', 'two_answers', 'not_in_slides')) as flagged,
           (select count(distinct a.user_id)
              from public.study_answers a
              join public.study_quiz_players p on p.user_id = a.user_id and p.quiz_id = p_quiz and p.left_at is null
             where a.question_id = q.id) as seen,
           random() as rnd
      from public.study_questions q
     where q.group_id = z.group_id
       and coalesce(q.lecture_id, q.ref_lecture) = any (z.lecture_ids)
       and q.retired_at is null
       and q.has_key
       and (z.kinds = 'all' or q.kind = z.kinds)
  ),
  ranked as (
    select p.*, row_number() over (partition by p.lec_pos, p.part_idx order by p.flagged, p.seen, p.rnd) as rk
      from pool p
  ),
  chosen as (
    select c.* from ranked c order by c.flagged, c.rk, c.seen, c.rnd limit z.n_wanted
  )
  insert into public.study_quiz_rounds (quiz_id, idx, question_id, seconds)
  select p_quiz,
         (row_number() over (order by case when z.mode = 'coop' then c.lec_pos end,
                                      case when z.mode = 'coop' then c.part_idx end,
                                      c.rnd))::int - 1,
         c.id,
         public.study_quiz__seconds(z.seconds, c.chars::int)
    from chosen c;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Ends the quiz: an open round is revealed first (its answers count), then
-- the quiz is 'ended' ('cancelled' if it never left the lobby).
create or replace function public.study_quiz__finish(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare z public.study_quizzes;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or z.state not in ('lobby', 'question', 'reveal') then return; end if;
  if z.state = 'question' then
    perform public.study_quiz__reveal(p_quiz, z.idx);
  end if;
  update public.study_quizzes x
     set state = case when z.state = 'lobby' then 'cancelled' else 'ended' end, ended_at = now(),
         opens_at = null, closes_at = null, version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
end;
$$;

-- Opens the first round at or after p_idx that still has its question,
-- 3 seconds from now, or ends the quiz when none is left. The round's key
-- is held until its reveal (ten minutes past the deadline at most).
create or replace function public.study_quiz__open(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  r  public.study_quiz_rounds;
  t0 timestamptz := clock_timestamp() + interval '3 seconds';
begin
  select * into r from public.study_quiz_rounds x
   where x.quiz_id = p_quiz and x.idx >= p_idx and x.question_id is not null
   order by x.idx limit 1;
  if not found then
    perform public.study_quiz__finish(p_quiz);
    return;
  end if;
  update public.study_quiz_rounds x
     set opens_at = t0, closes_at = t0 + make_interval(secs => x.seconds)
   where x.id = r.id;
  update public.study_question_keys k
     set held_until = t0 + make_interval(secs => r.seconds) + interval '10 minutes'
   where k.question_id = r.question_id;
  update public.study_quizzes z
     set state = 'question', idx = r.idx, opens_at = t0, closes_at = t0 + make_interval(secs => r.seconds),
         answered_n = 0, version = z.version + 1, updated_at = now()
   where z.id = p_quiz;
end;
$$;

-- Scores round p_idx if it is the one open, and closes it: the key is read
-- here and nowhere before. Points (race): a right answer is worth 500, plus
-- up to 500 more for speed; a wrong one, "לא יודעים" or none, 0. A round
-- whose question was deleted meanwhile is voided.
create or replace function public.study_quiz__reveal(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  z   public.study_quizzes;
  r   public.study_quiz_rounds;
  k   smallint;
  t   timestamptz := clock_timestamp();
  lim int;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or z.state <> 'question' or z.idx <> p_idx then return; end if;
  select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = p_idx;
  if r.question_id is not null then
    select x.answer into k from public.study_question_keys x where x.question_id = r.question_id;
    update public.study_question_keys x set held_until = null where x.question_id = r.question_id;
  end if;
  if k is null then
    -- No question or no key any more: nothing is scored or recorded.
    update public.study_quiz_rounds x set revealed_at = t, voided_at = t, closes_at = least(x.closes_at, t)
     where x.id = r.id;
  else
    lim := r.seconds * 1000;
    update public.study_quiz_answers a
       set correct = (a.choice is not null and a.choice = k),
           points = case when z.mode = 'race' and a.choice is not null and a.choice = k
                         then 500 + floor(500.0 * (lim - least(a.ms, lim)) / lim)::int
                         else 0 end
     where a.round_id = r.id;
    update public.study_quiz_players p
       set score = p.score + a.points,
           correct_n = p.correct_n + case when a.correct then 1 else 0 end,
           answered_n = p.answered_n + 1
      from public.study_quiz_answers a
     where a.round_id = r.id and p.quiz_id = p_quiz and p.user_id = a.user_id;
    -- Each answer also lands in its owner's private practice record.
    insert into public.study_answers (user_id, question_id, choice, correct, mode, ms, answered_at)
    select a.user_id, r.question_id, a.choice, a.correct, 'quiz', a.ms, a.answered_at
      from public.study_quiz_answers a
     where a.round_id = r.id;
    update public.study_quiz_rounds x set revealed_at = t, answer = k, closes_at = least(x.closes_at, t)
     where x.id = r.id;
  end if;
  update public.study_quizzes x
     set state = 'reveal', closes_at = least(x.closes_at, t),
         answered_n = (select count(*) from public.study_quiz_answers a where a.round_id = r.id),
         version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
end;
$$;

-- A round whose time ran out (plus the grace and 3 s) and that nobody
-- revealed (every phone asleep) is revealed by whoever asks next.
create or replace function public.study_quiz__due(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare z public.study_quizzes;
begin
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if found and z.state = 'question' and clock_timestamp() > z.closes_at + interval '4.5 seconds' then
    perform public.study_quiz__reveal(p_quiz, z.idx);
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  What the phones call
-- ═══════════════════════════════════════════════════════════════════════

-- Opens a quiz in the lobby, with the caller as host and first player.
-- Errors: 'group not found', 'bad mode', 'bad kinds', 'bad count',
-- 'bad seconds', 'lecture not found', 'quiz open' (join that one instead).
create or replace function public.study_quiz_create(p_group uuid, p_mode text, p_lectures uuid[],
  p_count int, p_seconds int, p_kinds text default 'all')
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  lec    uuid[];
  t      text;
  course text;
  stale  uuid;
  qid    uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_group is null or not public.study_is_member(p_group) then raise exception 'group not found'; end if;
  if coalesce(p_mode, '') not in ('coop', 'race') then raise exception 'bad mode'; end if;
  if coalesce(p_kinds, '') not in ('all', 'mcq', 'case') then raise exception 'bad kinds'; end if;
  if p_count is null or p_count not between 3 and 30 then raise exception 'bad count'; end if;
  if p_seconds is null or p_seconds not between 15 and 120 then raise exception 'bad seconds'; end if;
  -- The lectures, once each, in the order given, every one of them in this group.
  select array_agg(x.l order by x.o) into lec
    from (select u.l, min(u.o) as o
            from unnest(p_lectures) with ordinality as u(l, o)
           where u.l is not null
           group by u.l) x;
  if lec is null or cardinality(lec) > 40
     or exists (select 1 from unnest(lec) as l(id) where public.study_lecture_group(l.id) is distinct from p_group) then
    raise exception 'lecture not found';
  end if;
  -- Two members tapping at once get one quiz and one 'quiz open', not an error from the index.
  perform pg_advisory_xact_lock(hashtext('study_quiz_create:' || p_group::text));
  -- A quiz nobody has touched for 20 minutes is over (its open round still counts).
  for stale in
    select x.id from public.study_quizzes x
     where x.group_id = p_group and x.state in ('lobby', 'question', 'reveal')
       and x.updated_at < now() - interval '20 minutes'
       and not exists (select 1 from public.study_quiz_players p
                        where p.quiz_id = x.id and p.seen_at > now() - interval '20 minutes')
  loop
    perform 1 from public.study_quizzes x where x.id = stale for update;
    perform public.study_quiz__finish(stale);
  end loop;
  if exists (select 1 from public.study_quizzes x
              where x.group_id = p_group and x.state in ('lobby', 'question', 'reveal')) then
    raise exception 'quiz open';
  end if;
  -- Title: the lecture's; or "<course> · n הרצאות" when they share a course; or the titles.
  select case when count(distinct btrim(l.course)) = 1 then min(btrim(l.course)) end into course
    from public.study_lectures l where l.id = any (lec);
  if cardinality(lec) = 1 then
    select l.title into t from public.study_lectures l where l.id = lec[1];
  elsif coalesce(course, '') <> '' then
    t := course || ' · ' || cardinality(lec) || ' הרצאות';
  else
    select string_agg(l.title, ' · ' order by u.o) into t
      from unnest(lec) with ordinality as u(id, o)
      join public.study_lectures l on l.id = u.id;
  end if;
  insert into public.study_quizzes (group_id, mode, title, lecture_ids, kinds, n_wanted, seconds,
                                    host_id, created_by, players_n, version)
  values (p_group, p_mode, left(coalesce(nullif(btrim(t), ''), 'מבחן'), 200), lec, p_kinds, p_count, p_seconds,
          me, me, 1, 1)
  returning id into qid;
  insert into public.study_quiz_players (quiz_id, user_id) values (qid, me);
  return qid;
end;
$$;

-- Joins (or re-joins) a quiz that is not over: from the lobby or mid-game
-- (a late joiner starts with the round on screen). A quiz left without a
-- host gets the newcomer as host. Errors: 'quiz not found', 'quiz over'.
create or replace function public.study_quiz_join(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
  n  int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then raise exception 'quiz over'; end if;
  if public.study_quiz__playing(p_quiz) then
    perform public.study_quiz__seen(p_quiz);
    return;
  end if;
  insert into public.study_quiz_players (quiz_id, user_id, joined_idx) values (p_quiz, me, z.idx)
  on conflict (quiz_id, user_id) do update set left_at = null, seen_at = clock_timestamp();
  select count(*) into n from public.study_quiz_players p where p.quiz_id = p_quiz and p.left_at is null;
  update public.study_quizzes x
     set players_n = n, host_id = coalesce(x.host_id, me), version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
end;
$$;

-- Leaves. A leaving host hands over to the player seen most recently; the
-- last one out ends the quiz; if everyone left has answered, the round is
-- revealed at once.
create or replace function public.study_quiz_leave(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  z    public.study_quizzes;
  n    int;
  heir uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  update public.study_quiz_players p set left_at = clock_timestamp()
   where p.quiz_id = p_quiz and p.user_id = me and p.left_at is null;
  if not found or z.state not in ('lobby', 'question', 'reveal') then return; end if;
  select count(*) into n from public.study_quiz_players p where p.quiz_id = p_quiz and p.left_at is null;
  if n = 0 then
    update public.study_quizzes x set players_n = 0 where x.id = p_quiz;
    perform public.study_quiz__finish(p_quiz);
    return;
  end if;
  if z.host_id = me then
    select p.user_id into heir from public.study_quiz_players p
     where p.quiz_id = p_quiz and p.left_at is null
     order by p.seen_at desc, p.joined_at
     limit 1;
  end if;
  update public.study_quizzes x
     set players_n = n, host_id = coalesce(heir, x.host_id), version = x.version + 1, updated_at = now()
   where x.id = p_quiz;
  if z.state = 'question' and public.study_quiz__all_answered(p_quiz, z.idx) then
    perform public.study_quiz__reveal(p_quiz, z.idx);
  end if;
end;
$$;

-- Host only. From the lobby (p_from = -1) it chooses the questions and opens
-- the first; after a reveal it opens the next, or ends the quiz after the
-- last. p_from is the round on the host's screen: a second tap, or a tap
-- after someone else moved on, does nothing.
-- Errors: 'not host', 'not revealed', 'no questions', 'quiz over'.
create or replace function public.study_quiz_next(p_quiz uuid, p_from int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
  n  int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then raise exception 'quiz over'; end if;
  if z.host_id is distinct from me then raise exception 'not host'; end if;
  perform public.study_quiz__seen(p_quiz);
  if z.idx <> p_from then return; end if;
  if z.state = 'question' then raise exception 'not revealed'; end if;
  if z.state = 'lobby' then
    n := public.study_quiz__pick(p_quiz);
    if n = 0 then raise exception 'no questions'; end if;
    update public.study_quizzes x set n_total = n, started_at = now() where x.id = p_quiz;
    perform public.study_quiz__open(p_quiz, 0);
  else
    perform public.study_quiz__open(p_quiz, z.idx + 1);
  end if;
end;
$$;

-- The one thing a player sends. Returns the answer kept (a retry after a
-- lost response gets the first one back), never whether it is right. The
-- time is the transaction's start (now()): when the request reached the
-- database, so waiting for the quiz row behind another answer costs nothing.
-- Errors: 'not playing', 'not open' (before the countdown ends), 'closed'
-- (revealed, moved on, or more than 1.5 s after the deadline), 'bad choice'.
create or replace function public.study_quiz_answer(p_quiz uuid, p_idx int, p_choice int)
returns table (idx int, choice int, ms int, answered_at timestamptz)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  me   uuid := auth.uid();
  t    timestamptz := now();
  z    public.study_quizzes;
  r    public.study_quiz_rounds;
  nopt int;
  took int;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if not public.study_quiz__playing(p_quiz) then raise exception 'not playing'; end if;
  select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = p_idx;
  if found and exists (select 1 from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me) then
    return query select p_idx, a.choice::int, a.ms, a.answered_at
                   from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me;
    return;
  end if;
  if z.state <> 'question' or z.idx <> p_idx then raise exception 'closed'; end if;
  if t < r.opens_at then raise exception 'not open'; end if;
  if t > r.closes_at + interval '1.5 seconds' then raise exception 'closed'; end if;
  select cardinality(q.options) into nopt from public.study_questions q where q.id = r.question_id;
  if nopt is null then raise exception 'closed'; end if;
  if p_choice is null then
    if z.mode <> 'coop' then raise exception 'bad choice'; end if;
  elsif p_choice < 0 or p_choice >= nopt then
    raise exception 'bad choice';
  end if;
  took := least(r.seconds * 1000, greatest(0, floor(extract(epoch from (t - r.opens_at)) * 1000)::int));
  insert into public.study_quiz_answers (round_id, user_id, choice, ms, answered_at)
  values (r.id, me, p_choice, took, t);
  update public.study_quiz_players p set seen_at = clock_timestamp() where p.quiz_id = p_quiz and p.user_id = me;
  if public.study_quiz__all_answered(p_quiz, p_idx) then
    perform public.study_quiz__reveal(p_quiz, p_idx);
  else
    update public.study_quizzes x
       set answered_n = (select count(*) from public.study_quiz_answers a where a.round_id = r.id),
           updated_at = now()
     where x.id = p_quiz;
  end if;
  return query select p_idx, p_choice, took, t;
end;
$$;

-- Closes the open round and shows the answer. Any player once the time and
-- the grace are over (so a host whose phone locked never stalls the round);
-- in a group quiz the host also earlier ("לחשוף עכשיו"; a race waits for
-- the clock or for everyone's answer). Revealing a round already revealed
-- does nothing. Errors: 'not playing', 'not open', 'too early'.
create or replace function public.study_quiz_reveal(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state <> 'question' or z.idx <> p_idx then return; end if;
  if not public.study_quiz__playing(p_quiz) then raise exception 'not playing'; end if;
  if clock_timestamp() < z.opens_at then raise exception 'not open'; end if;
  if clock_timestamp() < z.closes_at + interval '1.5 seconds'
     and not (z.mode = 'coop' and z.host_id = me) then
    raise exception 'too early';
  end if;
  perform public.study_quiz__seen(p_quiz);
  perform public.study_quiz__reveal(p_quiz, p_idx);
end;
$$;

-- Host only: ends the quiz (an open round is revealed first, so its answers
-- count). In the lobby this cancels it.
create or replace function public.study_quiz_end(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then return; end if;
  if z.host_id is distinct from me then raise exception 'not host'; end if;
  perform public.study_quiz__finish(p_quiz);
end;
$$;

-- A player takes over a host who left or has not been seen for 30 seconds
-- (phone locked, battery, closed tab). Error 'host here' otherwise.
create or replace function public.study_quiz_take_host(p_quiz uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state not in ('lobby', 'question', 'reveal') then raise exception 'quiz over'; end if;
  if not public.study_quiz__playing(p_quiz) then raise exception 'not playing'; end if;
  if z.host_id = me then return; end if;
  if public.study_quiz__host_here(p_quiz) then raise exception 'host here'; end if;
  update public.study_quizzes x set host_id = me, version = x.version + 1, updated_at = now() where x.id = p_quiz;
  perform public.study_quiz__seen(p_quiz);
end;
$$;

-- Host only, after a reveal: the question was wrong ("ביטול השאלה"). Its
-- points come off everyone's score and its answers leave the private
-- practice records (they were copied with the same time stamp). The round
-- says who voided it.
create or replace function public.study_quiz_void(p_quiz uuid, p_idx int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  z  public.study_quizzes;
  r  public.study_quiz_rounds;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz for update;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.host_id is distinct from me then raise exception 'not host'; end if;
  select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = p_idx;
  if not found or r.revealed_at is null then raise exception 'not revealed'; end if;
  if r.voided_at is not null then return; end if;
  update public.study_quiz_players p
     set score = greatest(0, p.score - a.points),
         correct_n = greatest(0, p.correct_n - case when a.correct then 1 else 0 end),
         answered_n = greatest(0, p.answered_n - 1)
    from public.study_quiz_answers a
   where a.round_id = r.id and p.quiz_id = p_quiz and p.user_id = a.user_id;
  delete from public.study_answers s
   using public.study_quiz_answers a
   where a.round_id = r.id and s.user_id = a.user_id and s.question_id = r.question_id
     and s.mode = 'quiz' and s.answered_at = a.answered_at;
  update public.study_quiz_answers a set points = 0 where a.round_id = r.id;
  update public.study_quiz_rounds x set voided_at = clock_timestamp(), voided_by = me where x.id = r.id;
  update public.study_quizzes x set version = x.version + 1, updated_at = now() where x.id = p_quiz;
end;
$$;

-- Every 15 s while the quiz screen is visible, and when it comes back:
-- a sign of life, the server's clock (the phone keeps its offset), and the
-- version (an event missed while the socket was down shows up here).
create or replace function public.study_quiz_ping(p_quiz uuid)
returns table (server_now timestamptz, version int, state text, idx int, answered_n int, host_here boolean)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare z public.study_quizzes;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  perform public.study_quiz__seen(p_quiz);
  if z.state = 'question' and clock_timestamp() > z.closes_at + interval '4.5 seconds' then
    perform public.study_quiz__due(p_quiz);
  end if;
  return query select clock_timestamp(), x.version, x.state, x.idx, x.answered_n, public.study_quiz__host_here(p_quiz)
                 from public.study_quizzes x where x.id = p_quiz;
end;
$$;

-- Everything one screen shows, filtered for the caller (see the header).
-- Members who do not play may watch (lobby, question, reveal) but see no
-- scores and no end summary.
create or replace function public.study_quiz_state(p_quiz uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  z      public.study_quizzes;
  r      public.study_quiz_rounds;
  q      public.study_questions;
  k      public.study_question_keys;
  player boolean;
  v_me   jsonb;
  v_rnd  jsonb;
  v_ppl  jsonb;
  v_sum  jsonb;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into z from public.study_quizzes x where x.id = p_quiz;
  if not found or not public.study_is_member(z.group_id) then raise exception 'quiz not found'; end if;
  if z.state = 'question' and clock_timestamp() > z.closes_at + interval '4.5 seconds' then
    perform public.study_quiz__due(p_quiz);
    select * into z from public.study_quizzes x where x.id = p_quiz;
  end if;
  player := exists (select 1 from public.study_quiz_players p where p.quiz_id = p_quiz and p.user_id = me);

  select jsonb_build_object('playing', p.left_at is null, 'score', p.score, 'correct_n', p.correct_n,
                            'answered_n', p.answered_n, 'joined_idx', p.joined_idx)
    into v_me
    from public.study_quiz_players p where p.quiz_id = p_quiz and p.user_id = me;

  if z.state in ('question', 'reveal') then
    select * into r from public.study_quiz_rounds x where x.quiz_id = p_quiz and x.idx = z.idx;
    select * into q from public.study_questions x where x.id = r.question_id;
    v_rnd := jsonb_build_object(
      'idx', r.idx, 'seconds', r.seconds, 'opens_at', r.opens_at, 'closes_at', r.closes_at,
      'voided', r.voided_at is not null, 'voided_by', r.voided_by,
      'q', case when q.id is null then null else jsonb_build_object(
             'id', q.id, 'kind', q.kind, 'vignette', q.vignette, 'question', q.question,
             'options', to_jsonb(q.options), 'slides', to_jsonb(q.slides), 'topic', q.topic, 'aspect', q.aspect,
             'lecture_id', coalesce(q.lecture_id, q.ref_lecture),
             'lecture_title', (select l.title from public.study_lectures l where l.id = coalesce(q.lecture_id, q.ref_lecture)))
           end,
      'mine', (select jsonb_build_object('choice', a.choice, 'ms', a.ms)
                 from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me));
    if z.state = 'reveal' then
      select * into k from public.study_question_keys x where x.question_id = r.question_id;
      v_rnd := v_rnd || jsonb_build_object(
        'answer', r.answer,
        'explanations', to_jsonb(coalesce(k.explanations, '{}'::text[])),
        'takeaway', coalesce(k.takeaway, ''),
        'counts', coalesce((select jsonb_agg(coalesce(c.n, 0) order by o.i)
                              from generate_series(0, coalesce(cardinality(q.options), 0) - 1) as o(i)
                              left join (select a.choice, count(*)::int as n from public.study_quiz_answers a
                                          where a.round_id = r.id and a.choice is not null group by a.choice) c
                                     on c.choice = o.i), '[]'::jsonb),
        'dont_know', (select count(*) from public.study_quiz_answers a where a.round_id = r.id and a.choice is null),
        'answered', (select count(*) from public.study_quiz_answers a where a.round_id = r.id),
        'right', (select count(*) from public.study_quiz_answers a where a.round_id = r.id and a.correct),
        'points', (select a.points from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me),
        'correct', (select a.correct from public.study_quiz_answers a where a.round_id = r.id and a.user_id = me));
    end if;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'user_id', p.user_id,
             'name', coalesce(m.name, ''),
             'host', p.user_id is not distinct from z.host_id,
             'here', p.left_at is null and p.seen_at > clock_timestamp() - interval '30 seconds',
             'left', p.left_at is not null,
             'joined_idx', p.joined_idx)
           || case when z.mode = 'race' and player
                   then jsonb_build_object('score', p.score, 'correct_n', p.correct_n,
                          'last_points', case when z.state = 'reveal' then
                              (select a.points from public.study_quiz_answers a where a.round_id = r.id and a.user_id = p.user_id)
                            end)
                   else '{}'::jsonb end
           order by p.joined_at), '[]'::jsonb)
    into v_ppl
    from public.study_quiz_players p
    left join public.study_members m on m.group_id = z.group_id and m.user_id = p.user_id
   where p.quiz_id = p_quiz;

  if z.state = 'ended' and player then
    select coalesce(jsonb_agg(jsonb_build_object(
             'idx', r2.idx, 'voided', r2.voided_at is not null,
             'q', case when q2.id is null then null else jsonb_build_object(
                    'id', q2.id, 'kind', q2.kind, 'vignette', q2.vignette, 'question', q2.question,
                    'options', to_jsonb(q2.options), 'slides', to_jsonb(q2.slides), 'topic', q2.topic,
                    'aspect', q2.aspect, 'lecture_id', coalesce(q2.lecture_id, q2.ref_lecture)) end,
             'answer', r2.answer, 'explanations', to_jsonb(coalesce(k2.explanations, '{}'::text[])),
             'takeaway', coalesce(k2.takeaway, ''),
             'answered', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id),
             'right', (select count(*) from public.study_quiz_answers a where a.round_id = r2.id and a.correct),
             'counts', coalesce((select jsonb_agg(coalesce(c.n, 0) order by o.i)
                                   from generate_series(0, coalesce(cardinality(q2.options), 0) - 1) as o(i)
                                   left join (select a.choice, count(*)::int as n from public.study_quiz_answers a
                                               where a.round_id = r2.id and a.choice is not null group by a.choice) c
                                          on c.choice = o.i), '[]'::jsonb),
             'mine', (select jsonb_build_object('choice', a.choice, 'correct', a.correct, 'points', a.points)
                        from public.study_quiz_answers a where a.round_id = r2.id and a.user_id = me))
             order by r2.idx), '[]'::jsonb)
      into v_sum
      from public.study_quiz_rounds r2
      left join public.study_questions q2 on q2.id = r2.question_id
      left join public.study_question_keys k2 on k2.question_id = r2.question_id
     where r2.quiz_id = p_quiz and r2.revealed_at is not null;
  end if;

  return jsonb_build_object(
    'now', clock_timestamp(),
    'quiz', jsonb_build_object(
      'id', z.id, 'group_id', z.group_id, 'mode', z.mode, 'title', z.title, 'lecture_ids', to_jsonb(z.lecture_ids),
      'kinds', z.kinds, 'n_wanted', z.n_wanted, 'seconds', z.seconds, 'state', z.state, 'idx', z.idx,
      'n_total', z.n_total, 'opens_at', z.opens_at, 'closes_at', z.closes_at, 'answered_n', z.answered_n,
      'players_n', z.players_n, 'version', z.version, 'host_id', z.host_id,
      'created_at', z.created_at, 'started_at', z.started_at, 'ended_at', z.ended_at),
    'me', v_me,
    'host_here', public.study_quiz__host_here(p_quiz),
    'players', v_ppl,
    'round', v_rnd,
    'summary', v_sum);
end;
$$;

-- The library banner: the group's live quiz, unless nobody has touched it
-- for 20 minutes. playing: the caller is in it; names: who is in it, in the
-- order they joined (the banner says "בפנים: שוהם, נועה +3").
create or replace function public.study_quiz_open(p_group uuid)
returns table (id uuid, mode text, title text, state text, idx int, n_total int, players_n int,
               host_id uuid, playing boolean, names text[])
language sql stable security definer set search_path = public as $$
  select z.id, z.mode, z.title, z.state, z.idx, z.n_total, z.players_n, z.host_id,
         exists (select 1 from public.study_quiz_players p
                  where p.quiz_id = z.id and p.user_id = auth.uid() and p.left_at is null),
         array(select coalesce(m.name, '') from public.study_quiz_players p
                 left join public.study_members m on m.group_id = z.group_id and m.user_id = p.user_id
                where p.quiz_id = z.id and p.left_at is null order by p.joined_at)
    from public.study_quizzes z
   where z.group_id = p_group
     and public.study_is_member(p_group)
     and z.state in ('lobby', 'question', 'reveal')
     and (z.updated_at > now() - interval '20 minutes'
          or exists (select 1 from public.study_quiz_players p
                      where p.quiz_id = z.id and p.seen_at > now() - interval '20 minutes'))
   order by z.created_at desc
   limit 1;
$$;

-- The setup screen: how many questions each lecture has ready (keyed, not
-- retired). Security invoker: RLS on study_questions keeps it to members.
create or replace function public.study_quiz_pool(p_group uuid)
returns table (lecture_id uuid, mcq int, cases int)
language sql stable set search_path = public as $$
  select coalesce(q.lecture_id, q.ref_lecture),
         (count(*) filter (where q.kind = 'mcq'))::int,
         (count(*) filter (where q.kind = 'case'))::int
    from public.study_questions q
   where q.group_id = p_group and q.retired_at is null and q.has_key
     and coalesce(q.lecture_id, q.ref_lecture) is not null
   group by 1;
$$;

-- The "יחד" tab: the group's last quizzes. The group's share of right
-- answers is shared; my_* are the caller's own, my_rank only in a race the
-- caller played (its table was shown to its players anyway).
create or replace function public.study_quiz_recent(p_group uuid, p_limit int default 5)
returns table (id uuid, mode text, title text, ended_at timestamptz, players_n int, rounds int,
               right_pct int, played boolean, my_correct int, my_answered int, my_rank int)
language sql stable security definer set search_path = public as $$
  select z.id, z.mode, z.title, z.ended_at,
         (select count(*) from public.study_quiz_players p where p.quiz_id = z.id)::int,
         (select count(*) from public.study_quiz_rounds r
           where r.quiz_id = z.id and r.revealed_at is not null and r.voided_at is null)::int,
         (select round(100.0 * count(*) filter (where a.correct) / nullif(count(*), 0))::int
            from public.study_quiz_answers a join public.study_quiz_rounds r on r.id = a.round_id
           where r.quiz_id = z.id and r.voided_at is null),
         me.user_id is not null, me.correct_n, me.answered_n,
         case when z.mode = 'race' and me.user_id is not null then
           (select count(*) + 1 from public.study_quiz_players o where o.quiz_id = z.id and o.score > me.score)::int
         end
    from public.study_quizzes z
    left join public.study_quiz_players me on me.quiz_id = z.id and me.user_id = auth.uid()
   where z.group_id = p_group and public.study_is_member(p_group) and z.state = 'ended'
   order by z.ended_at desc
   limit greatest(1, least(coalesce(p_limit, 5), 50));
$$;

-- ═══════════════════════════════════════════════════════════════════════
--  Row Level Security and privileges
-- ═══════════════════════════════════════════════════════════════════════
alter table public.study_quizzes      enable row level security;
alter table public.study_quiz_rounds  enable row level security;
alter table public.study_quiz_players enable row level security;
alter table public.study_quiz_answers enable row level security;

-- (In study-schema.sql the file's loop has already dropped this; the drop
-- keeps this block re-runnable on its own.)
drop policy if exists "study quizzes read" on public.study_quizzes;
create policy "study quizzes read" on public.study_quizzes
  for select using (public.study_is_member(group_id));
-- study_quiz_rounds, study_quiz_players, study_quiz_answers: no policy on purpose.

revoke all on public.study_quizzes, public.study_quiz_rounds, public.study_quiz_players, public.study_quiz_answers
  from anon, authenticated;
grant select on public.study_quizzes to authenticated;

revoke all on function public.study_quiz__seconds(int, int), public.study_quiz__playing(uuid),
  public.study_quiz__host_here(uuid), public.study_quiz__seen(uuid), public.study_quiz__all_answered(uuid, int),
  public.study_quiz__pick(uuid), public.study_quiz__finish(uuid), public.study_quiz__open(uuid, int),
  public.study_quiz__reveal(uuid, int), public.study_quiz__due(uuid)
  from public, anon, authenticated;
revoke all on function public.study_quiz_create(uuid, text, uuid[], int, int, text), public.study_quiz_join(uuid),
  public.study_quiz_leave(uuid), public.study_quiz_next(uuid, int), public.study_quiz_answer(uuid, int, int),
  public.study_quiz_reveal(uuid, int), public.study_quiz_end(uuid), public.study_quiz_take_host(uuid),
  public.study_quiz_void(uuid, int), public.study_quiz_ping(uuid), public.study_quiz_state(uuid),
  public.study_quiz_open(uuid), public.study_quiz_pool(uuid), public.study_quiz_recent(uuid, int)
  from public, anon;
grant execute on function public.study_quiz_create(uuid, text, uuid[], int, int, text), public.study_quiz_join(uuid),
  public.study_quiz_leave(uuid), public.study_quiz_next(uuid, int), public.study_quiz_answer(uuid, int, int),
  public.study_quiz_reveal(uuid, int), public.study_quiz_end(uuid), public.study_quiz_take_host(uuid),
  public.study_quiz_void(uuid, int), public.study_quiz_ping(uuid), public.study_quiz_state(uuid),
  public.study_quiz_open(uuid), public.study_quiz_pool(uuid), public.study_quiz_recent(uuid, int)
  to authenticated;

-- ── Realtime: the quiz row only (never rounds, players or answers).
do $$
begin
  begin
    alter publication supabase_realtime add table public.study_quizzes;
  exception when duplicate_object then
    null;
  end;
end $$;
```

### 2.3 The quiz's edits to the questions block (design-questions §2.2)

The questions design asked for this (its §2.4: "one more condition in `study_answer_question` and `study_question_feedback` that refuses a question while it is in an open quiz round"). A round **holds** its question's key: `study_question_keys` gains one column, and the five functions that hand out or change a key gain one condition each. In the build PR these lines are merged **into** the questions block (one definition of each function); `spec/quiz-proto/sql/questions-hold.sql` applies them as a patch after it, so both designs' tests run unchanged.

```sql
-- study_question_keys: one more column (in the block's create table, and for
-- databases created before it):
alter table public.study_question_keys add column if not exists held_until timestamptz;

-- study_answer_question: after "select * into k ...":
  if k.held_until > now() then raise exception 'in quiz'; end if;

-- study_question_feedback and study_exam_items_for_explain: one more where-condition:
    and (k.held_until is null or k.held_until <= now())

-- study_set_exam_key and study_set_explanations: before their update:
  if exists (select 1 from public.study_question_keys k
              where k.question_id = p_question and k.held_until > now()) then
    raise exception 'in quiz';
  end if;
```

Why all five: `study_answer_question` returns the key with the answer; `study_question_feedback` returns it to anyone who answered the question before (last week's practice); `study_exam_items_for_explain` returns a past-exam item's key; `study_set_exam_key` could re-key an exam item to one's own choice before the reveal; `study_set_explanations` would rewrite what the reveal shows. Retiring a question (`study_retire_question`) stays allowed: it reveals nothing, and the round still scores by its key. A quiz abandoned with a round open lets go by itself 10 minutes after the deadline (check QZ14d).

The practice session (questions design, P4) treats the new error `in quiz` like `retired`: it skips the question with the toast **"השאלה הזו נמצאת עכשיו במבחן קבוצתי. אפשר לחזור אליה אחרי החשיפה."**

### 2.4 The account merge (research-auth)

When `study_merge_claim()` lands, these lines go just before its `return 1;`, after the practice questions' lines. Tested with both (M1-M6, §6.1):

```sql
-- PROPOSAL: the lines the live quiz adds to study_merge_claim()
-- (research-auth-merge.sql), just before its "return 1;", after the practice
-- questions' lines. In a quiz both devices played, the account's player row
-- and answers stay and the device's go (a quiz's table has one row a person);
-- every other quiz row of the device moves to the account.
  delete from public.study_quiz_answers a
   using public.study_quiz_rounds r
   where a.round_id = r.id and a.user_id = src
     and exists (select 1 from public.study_quiz_players d where d.quiz_id = r.quiz_id and d.user_id = dst);
  delete from public.study_quiz_players p
   where p.user_id = src
     and exists (select 1 from public.study_quiz_players d where d.quiz_id = p.quiz_id and d.user_id = dst);
  update public.study_quiz_answers set user_id = dst where user_id = src;
  update public.study_quiz_players set user_id = dst where user_id = src;
  update public.study_quizzes set host_id = dst where host_id = src;
  update public.study_quizzes set created_by = dst where created_by = src;
  update public.study_quiz_rounds set voided_by = dst where voided_by = src;
```

### 2.5 Realtime

**What is published:** `study_quizzes` only. Each phone listens to Postgres Changes on its one row; the library banner listens to the group's rows.

| Subscription | Channel | Binding | Used by |
|---|---|---|---|
| The room | `study-quiz-<quizId>` | `UPDATE` on `public.study_quizzes`, `filter: id=eq.<quizId>` | `useQuiz` |
| The banner | `study-quizzes-<groupId>` | `*` on `public.study_quizzes`, `filter: group_id=eq.<groupId>` | `useOpenQuiz` |

**How a phone reacts** (`onRowEvent`, tested R1-R4):

- `version` changed → a step happened (join, leave, open, reveal, new manager, cancel, end) → read `study_quiz_state()` again.
- Same `version` → only `answered_n` (and `players_n`) moved → apply them from the event, no request.
- A payload without those fields → never trusted → read the state.

Each change event carries the full row ("By default each change event contains the full row", Postgres Changes doc); the test of §6.4 confirmed `payload.new` has every column with the installed client. The row is about 650 bytes.

**What the docs say that shapes this** (all fetched for this design; Evidence):

- **Authorization:** "Postgres Changes authorizes every event against each subscriber." The `study quizzes read` policy (`study_is_member(group_id)`) runs per event per phone: six checks per change.
- **Scale is not an issue at six:** the same page warns that changes "are processed on a single thread" and suggests Broadcast above ~3,000 concurrent subscribers. "Subscribing to Database Changes" recommends Broadcast "for scalability and security", and Postgres Changes as "a simpler method".
- **No replay for Postgres Changes.** Broadcast replay exists, but "Only messages published via Broadcast From the Database are available for replay." So a phone whose socket was down misses events, and the design covers that itself (below).

**Why not the alternatives**

- **Broadcast from the database** (`realtime.broadcast_changes()` / `realtime.send()` in a trigger, on a private channel): the docs' recommended path, with replay for private channels (supabase-js 2.74+). Not chosen: it needs a new private topic in `study_can_use_topic` and broadcast policies on `realtime.messages`, stubs for `realtime.send` in the SQL tests, and its one extra benefit, replay, only covers what the 15-second ping and the re-read on `SUBSCRIBED` already cover. It is the upgrade path if Postgres Changes ever misbehaves: the trigger would send the same row.
- **Presence or client broadcast** (as the reading room uses): not authoritative (each phone says what it likes), and a second source of truth beside the database. Presence is also the wrong tool for a stream of answers: "Presence is not designed for high-frequency updates … best suited for slow-changing state such as online/offline status" (Presence doc), and "Presence calls per client, per 30 seconds: 5" (Realtime limits doc). The platform's group channel (`groupLive`, presence `quiz?: quizId`) is therefore **not** used for the quiz: the banner reads the quiz row, which stays right when the managing phone locks. `groupLive` keeps presence for reading aloud only.

**Missed events, phones locking, reconnects** (tested in §6.3 and §6.4):

- realtime-js 2.108.2 sends a heartbeat every 25 s and reconnects after 1, 2, 5, then 10 s (`RealtimeClient.js`; the protocol doc gives the same backoff), then re-joins its channels. Measured with the mock: back in **1,027 ms**, statuses `SUBSCRIBED → CHANNEL_ERROR → SUBSCRIBED`.
- On every `SUBSCRIBED`, the room re-reads the state.
- Every 15 s while the screen is visible, `study_quiz_ping()` returns the server's clock, the `version` and whether the manager is here; a different version or manager status → re-read.
- On `visibilitychange` to visible, `pageshow` and `online` → ping and re-read at once. MDN: a page is hidden "because the device's screen is off", its timers are throttled, and "Transitioning to hidden is the last event that's reliably observable by the page". So the quiz never relies on timers in the background: everything is recomputed from the server's timestamps on return.
- **The screen stays on** during a quiz with the Screen Wake Lock API (`useWakeLock`). MDN: a lock is released when the page is hidden and must be requested again on `visibilitychange`. Support (MDN compatibility data): Chrome 84, Firefox 126, Safari 16.4; **on iPhone, 18.4 and later**, because 16.4-18.3 "Does not work in standalone Home Screen Web Apps" (WebKit bug 254545), which is how the group often runs the app. Where it fails, the app is silent and the recovery above does the work.

**Messages** ("Each database change counts as one message per client that listens to the event", Manage Realtime Messages usage): a 10-question quiz of six makes about 77 row changes (create, 5 joins, then per question an opening, 5 answer counts and the reveal, then the end), seen by six phones: **about 460 messages**, plus 77 per member who watches the banner meanwhile. The peak, six answers in one second, is 6 × 6 = 36 messages a second; the free plan allows 100 a second and 2 million a month (Realtime limits; pricing).

---

## 3. API

### 3.1 No new endpoint under `api/study/`, and no call to Claude

The quiz writes no text and reads no slides: its questions, explanations and takeaways were written once by practice's `op: "questions"` (questions design §3.2) and are stored. So:

- **No new Vercel function.** The browser calls the database functions below with the member's own token through `supabase-js` `rpc()`, exactly as it calls `study_join` and `study_group_code` today. Row Level Security and the functions' own checks decide; there is no service-role key (as the README says of the whole app). This also keeps the platform's function budget (§3.1: Hobby's 12) untouched.
- **No prompts, no JSON schema, no SDK use, no budget check, no ledger row.** Nothing here can spend `STUDY_MONTHLY_USD`. When the setup offers "ליצירת שאלות" for a lecture that has none, it opens practice's own generation (P2/P3), whose `op: "questions"` checks the budget first and charges the shared ledger as `practice` (questions design §3.7).

### 3.2 The functions (the quiz's API)

All `security definer`, `set search_path = public`, executable by `authenticated` only (anon gets "permission denied", check QZ15c). Errors are raised as plain text, which `supabase-js` returns as `error.message` (the existing `Join.tsx` already matches messages like "wrong code" this way).

| Function | Who may call | Arguments | Returns | Errors |
|---|---|---|---|---|
| `study_quiz_create` | a member of the group | `p_group uuid, p_mode text ('coop'·'race'), p_lectures uuid[], p_count int (3-30), p_seconds int (15-120), p_kinds text ('all'·'mcq'·'case', default 'all')` | the quiz id; the caller manages it and plays | `not signed in`, `group not found`, `bad mode`, `bad kinds`, `bad count`, `bad seconds`, `lecture not found`, `quiz open` |
| `study_quiz_join` | a member | `p_quiz uuid` | – (joins or re-joins; mid-game too) | `quiz not found`, `quiz over` |
| `study_quiz_leave` | a player | `p_quiz uuid` | – (hands managing on; the last one out ends it) | `quiz not found` |
| `study_quiz_next` | the managing player | `p_quiz uuid, p_from int` (the round on their screen; -1 in the lobby) | – (lobby: choose questions and open the first; after a reveal: open the next or end) | `not host`, `not revealed`, `no questions`, `quiz over` |
| `study_quiz_answer` | a player | `p_quiz uuid, p_idx int, p_choice int` (null = "לא יודעים", group quiz only) | `(idx, choice, ms, answered_at)`: the answer kept; never right or wrong | `not playing`, `not open`, `closed`, `bad choice` |
| `study_quiz_reveal` | a player after the deadline + 1.5 s; the manager of a group quiz any time after the opening | `p_quiz uuid, p_idx int` | – (a second reveal does nothing) | `not playing`, `not open`, `too early` |
| `study_quiz_void` | the manager, after a reveal | `p_quiz uuid, p_idx int` | – (points off; quiz copies leave `study_answers`) | `not host`, `not revealed` |
| `study_quiz_take_host` | a player, when the manager has not been seen for 30 s or has left | `p_quiz uuid` | – | `host here`, `not playing`, `quiz over` |
| `study_quiz_end` | the manager | `p_quiz uuid` | – (an open round is revealed first; in the lobby: cancelled) | `not host` |
| `study_quiz_ping` | a member | `p_quiz uuid` | `(server_now, version, state, idx, answered_n, host_here)`; marks the caller as seen; reveals a round 4.5 s past its deadline | `quiz not found` |
| `study_quiz_state` | a member | `p_quiz uuid` | `jsonb`, below (§3.3) | `quiz not found` |
| `study_quiz_open` | a member | `p_group uuid` | at most one row: `(id, mode, title, state, idx, n_total, players_n, host_id, playing, names)` | – (no row) |
| `study_quiz_pool` | a member (security invoker: RLS) | `p_group uuid` | per lecture: `(lecture_id, mcq, cases)` ready questions | – |
| `study_quiz_recent` | a member | `p_group uuid, p_limit int default 5` | the last ended quizzes: `(id, mode, title, ended_at, players_n, rounds, right_pct, played, my_correct, my_answered, my_rank)`, `my_*` the caller's own | – |

Every function that changes a quiz locks its row first; `study_quiz_answer` stamps the time with the transaction's start (`now()`), so waiting for the lock behind another phone's answer costs nothing.

### 3.3 `study_quiz_state` (what one screen gets)

Filtered for the caller: the key, explanations and counts only after the reveal; others' points only in a race and only to its players; the end summary only to players. The TypeScript types are the ones the client uses (`spec/quiz-proto/src/quizLogic.ts`, type-checked):

```ts
type QuizState = {
  now: string;                               // the server's clock (clock_timestamp())
  quiz: QuizRow;                             // the published row, plus created_at, started_at, ended_at
  me: { playing: boolean; score: number; correct_n: number; answered_n: number; joined_idx: number } | null; // null: watching
  host_here: boolean;                        // the managing phone was seen in the last 30 s
  players: Array<{ user_id: string; name: string; host: boolean; here: boolean; left: boolean; joined_idx: number;
                   score?: number; correct_n?: number; last_points?: number | null }>; // score…: race, players only
  round: null | {                            // question or reveal
    idx: number; seconds: number; opens_at: string; closes_at: string; voided: boolean; voided_by: string | null;
    q: { id; kind: "mcq" | "case"; vignette; question; options: string[]; slides: number[]; topic; aspect; lecture_id; lecture_title } | null;
    mine: { choice: number | null; ms: number } | null;
    // after the reveal only:
    answer?: number | null; explanations?: string[]; takeaway?: string; counts?: number[];
    dont_know?: number; answered?: number; right?: number; points?: number | null; correct?: boolean | null;
  };
  summary: null | Array<{ idx; voided; q; answer; explanations; takeaway; answered; right; counts;
                          mine: { choice: number | null; correct: boolean | null; points: number } | null }>; // ended, players only
};
type QuizRow = { id; group_id; mode: "coop" | "race"; title; lecture_ids: string[]; kinds: "all" | "mcq" | "case";
  n_wanted: number; seconds: number; state: "lobby" | "question" | "reveal" | "ended" | "cancelled"; idx: number;
  n_total: number; opens_at: string | null; closes_at: string | null; answered_n: number; players_n: number;
  version: number; host_id: string | null };
```

Measured with the questions design's two stand-in clinical cases (`run-size.sh`): about 2.8-3.0 KB while a question is open, 3.8-4.1 KB after its reveal, 5.6 KB for a two-round end summary.

### 3.4 Errors, end to end

| Code | Raised by | What the screen does (Hebrew) |
|---|---|---|
| `quiz open` | create | **"יש כבר מבחן פתוח בקבוצה."** + "להצטרף אליו" |
| `no questions` | next (start) | **"אין עדיין שאלות מוכנות בהרצאות שנבחרו."** + "ליצירת שאלות" |
| `not open` | answer | none: the countdown was a hair early; the phone waits until the opening + 200 ms and sends once more |
| `closed` | answer | **"הזמן נגמר לפני שהתשובה הגיעה."** and re-reads |
| `bad choice` | answer | **"התשובה לא נקלטה."** (a bug or a race "לא יודעים") |
| `not playing` | answer, reveal, take over | **"צריך להצטרף למבחן כדי לענות."** + "להצטרף" |
| `too early`, `not revealed`, `not host` | reveal, next, void | none: another phone already moved on; re-read |
| `host here` | take over | **"הטלפון שמנהל את המבחן מחובר, אז הניהול נשאר שם."** |
| `quiz over` / `quiz not found` | any | **"המבחן הסתיים."** / **"המבחן לא נמצא."** + "חזרה לספרייה" |
| `in quiz` | practice (`study_answer_question`) | in a practice session: **"השאלה הזו נמצאת עכשיו במבחן קבוצתי. אפשר לחזור אליה אחרי החשיפה."** and the next question |
| no response | any (offline) | the bar **"מתחברים מחדש…"**; an unsent answer waits and is sent once when the connection is back, if the round is still open |

---

## 4. Client

### 4.1 New files

| File | Exports | Notes |
|---|---|---|
| `src/study/lib/quiz.ts` | types `QuizRow`, `QuizState`, `QuizRound`, `QuizPlayer`, `SummaryRound`, `View`, `Ping`, `OpenQuiz`, `RecentQuiz`; `ServerClock`; `viewOf`, `nextAction`, `onRowEvent`, `pingNeedsState`, `rankRows`, `racePoints`, `clock`, `QUIZ_ERROR_TEXT`; `createQuiz`, `joinQuiz`, `leaveQuiz`, `nextRound`, `answerRound`, `revealRound`, `voidRound`, `takeHost`, `endQuiz`, `pingQuiz`, `quizState`, `openQuiz`, `quizPool`, `recentQuizzes`, `watchQuiz`, `watchOpenQuiz` | The pure half is `spec/quiz-proto/src/quizLogic.ts` (27 checks); the Supabase half is `src/quizApi.ts` with `sb` imported from `./api` |
| `src/study/lib/useQuiz.ts` | `useQuiz(quizId)` → `{ state, view, live, error, clock, refresh }`; `useWakeLock(on)` | `spec/quiz-proto/src/useQuiz.ts`, type-checked |
| `src/study/lib/useOpenQuiz.ts` | `useOpenQuiz(groupId)` → `OpenQuiz \| null` | `openQuiz()` on mount and on every `watchOpenQuiz` event (debounced 300 ms, as `Library`'s 400 ms) |
| `src/study/components/QuizSetup.tsx` | `QuizSetup({ group, lectureId?, course?, onGo })` | Screen S; lectures from `listLectures`, counts from `quizPool` |
| `src/study/components/Quiz.tsx` | `Quiz({ quizId, userId, group, onGo })` | The room: picks L, C, Q, R1/R2, E1/E2 from `view`; the H lines; the answer flow (§4.3). Own state: `pending` (`{ idx, choice } \| null`), `sheet` (`"flag" \| "leave" \| "void" \| null`, with a `{ studySheet: true }` history entry as `LectureView.openSheet` does), `toast`, `lastPlaces` (for the ↑↓ arrows) |
| `src/study/components/QuizParts.tsx` | `QuizLobby({ state, me, onStart, onJoin, onShare, onLeave })`, `QuizTimer({ opensAt, closesAt, clock })`, `OptionBars({ counts, answer, mine })` (passed to `QuestionCard` as `optionExtra`), `QuizTable({ players, me, lastPlaces })`, `QuizEnd({ state, me, onAgain, onReview, onLibrary })`, `HostAwayBar({ hostName, onTake })` | Small presentational pieces of the room; no data access |
| `src/study/components/QuizBanner.tsx` | `QuizBanner({ quiz, onGo })` | The banner line B; used by the shell's `LiveBanner`, or by `Library` without the shell |

### 4.2 Existing files touched

Assuming the platform's first PR (route, shell, "יחד") and the practice PR have landed, as the questions design assumes:

- **`src/study/lib/route.ts`** (platform): the quiz route gains `c?: string` (a course for the setup): `case "quiz": return { v, q: id(q.get("q")), l: id(l), c: q.get("c") ?? undefined, isNew: q.get("new") === "1" }`; `routeUrl` writes it back. `q` is checked as a UUID like `l`.
- **`src/study/StudyApp.tsx`**: for `{ v: "quiz", isNew }` render `QuizSetup`; for `{ v: "quiz", q }` render `Quiz`; both immersive (the platform's `tabOf` already returns `null` for `quiz`). Join keeps the route: `onJoined` replaces the URL with `routeUrl(route)`, not `/study/`, so a quiz link opened by someone not yet signed in lands in the lobby after joining (today it keeps only `?l=`). Behind `import.meta.env.VITE_STUDY_QUIZ === "1"`; off, a quiz route falls back to the library.
- **`src/study/components/Shell.tsx`** (platform `LiveBanner`): its quiz line comes from `useOpenQuiz(group.id)` rendered with `QuizBanner`; hidden when the route is `v=quiz`.
- **`src/study/components/Group.tsx`** (platform "יחד"): the card "מבחן קבוצתי" (screen Y) from `useOpenQuiz` and `recentQuizzes`.
- **`src/study/lib/api.ts`** (platform): `groupLive`'s presence drops the planned `quiz?: quizId` field (§2.5). Nothing else: `quiz.ts` imports `sb`.
- **`src/study/components/LectureView.tsx`**: the action chip "מבחן קבוצתי" → `go({ v: "quiz", isNew: true, l: lectureId })` (the platform lists the chip; this design supplies the target). Nothing else.
- **`src/study/components/QuestionCard.tsx`** (practice): three optional props, so the room reuses it:
  - `optionExtra?: (index: number) => React.ReactNode` (the count bar under each option at the reveal);
  - `foldWhy?: boolean` (a race folds the explanations under "להסברים");
  - `noDontKnow?: boolean` (a race has no "לא יודעים");
  - and `q` typed as the fields it renders (`Pick<PublicQuestion, "id" | "kind" | "vignette" | "question" | "options" | "slides" | "topic" | "aspect">`), which the quiz's `round.q` satisfies.
- **`src/study/components/PracticeSession.tsx`** (practice): the `in quiz` error skips the question with the toast of §2.3.
- **`src/study/components/LecturePractice.tsx`** (practice P2): a link **"מבחן קבוצתי על ההרצאה"** → the setup with `l`.
- **`src/study/components/Help.tsx`** (platform): the section "מבחן קבוצתי" becomes: **"מבחן חי לכל הקבוצה, מתוך שאלות התרגול. ״קבוצתי״: אחרי כל שאלה רואים כמה בחרו בכל תשובה (בלי שמות) ואת ההסברים, ומדברים. ״תחרותי״: נקודות על תשובה נכונה ומהירה וטבלה לכל המשתתפים. מה שעונים נשמר גם בתרגול שלך, גלוי רק לך. המבחן לא עולה מהתקציב."** The privacy note needs no new line: no new service sees anything.
- **`src/study/study.css`**: `.quiz` (immersive page), `.quiz-top` (sticky, as `.page-head.sticky`), `.quiz-timer` (a `conic-gradient` ring on `--accent`, `--warn-line` in the last 10 s; `prefers-reduced-motion`: no sweep, the number only), `.quiz-count`, `.quiz-people` and `.quiz-dot.here/.away`, `.opt-bar` (width by share, the count as text; `--accent-soft`, the right option `--ok`), `.quiz-table` with `.quiz-rank.up/.down` (arrows as text, not colour alone), `.quiz-podium`, `.quiz-banner`, `.quiz-setup` and `.quiz-modes` (radio cards). Only existing tokens, so dark mode follows; numbers in `<bdi>`.
- **`supabase/study-schema.sql`**: §2.2 appended after the practice block; §2.3 merged into the practice block; §2.4 into `study_merge_claim` when it lands.
- **`supabase/tests/study.sql`**: §6.1's checks appended.
- **`README.md`** (study section): "The live group quiz": the two modes, who sees what (§1.4), that the database keeps the clock, the key and the scores, the Realtime row, the costs (none), the flag.
- **`.env.example`**: unchanged (`VITE_STUDY_QUIZ` is set on Vercel when it is switched on, like `VITE_STUDY_PRACTICE`).

Not touched: `api/**`, `vercel.json`, `package.json` (no new dependency), `Together.tsx`, `SummaryView.tsx`.

### 4.3 Key sketches

**The Supabase half of `quiz.ts`** (as compiled in `spec/quiz-proto/src/quizApi.ts`):

```ts
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(error.message || "network");      // 'closed', 'quiz open', ...
  return data as T;
}
export const createQuiz = (o: { groupId: string; mode: Mode; lectures: string[]; count: number; seconds: number; kinds: Kinds }) =>
  rpc<string>("study_quiz_create", { p_group: o.groupId, p_mode: o.mode, p_lectures: o.lectures, p_count: o.count, p_seconds: o.seconds, p_kinds: o.kinds });
export async function answerRound(id: string, idx: number, choice: number | null) {
  return (await rpc<Array<{ idx: number; choice: number | null; ms: number; answered_at: string }>>("study_quiz_answer", { p_quiz: id, p_idx: idx, p_choice: choice }))[0];
}
export function watchQuiz(quizId: string, onRow: (row: Partial<QuizRow>) => void, onStatus: (status: string) => void): () => void {
  if (!sb) return () => undefined;
  const ch = sb.channel(`study-quiz-${quizId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "study_quizzes", filter: `id=eq.${quizId}` }, (p) => onRow(p.new as Partial<QuizRow>))
    .subscribe((status) => onStatus(status));
  return () => void sb?.removeChannel(ch);
}
```

**The server clock** (`ServerClock`): every state read and ping gives a sample `offset = server − (t0 + t1) / 2`; the sample with the shortest round trip of the last five wins. Countdowns use `clock.now()`, never `Date.now()`. The error is at most half the best round trip, whatever the phone's own clock says (check C1: a phone 40 s fast, five trips of 80-900 ms).

**The hook's one timer** (`useQuiz`, compiled): after every render it arms a single timeout from `nextAction(state, clock.now(), jitter, lastPing)`:

| Situation | Next action |
|---|---|
| before the opening | `tick` at the opening (the countdown, then the question) |
| during the round | `tick` every second |
| after the deadline, a player | `reveal` at deadline + 1.5 s + this phone's jitter (0-800 ms; six phones spread their requests, check A6; the database reveals once, check K2) |
| after the deadline, watching | `ping` at deadline + 4.5 s + jitter (the ping reveals) |
| otherwise | `ping` 15 s after the last |

Plus: Realtime (`onRowEvent`), re-read on `SUBSCRIBED`, on `visibilitychange` to visible, `pageshow` and `online`, and `useWakeLock` while the quiz is in the lobby, a question or a reveal.

**Answering** (in `Quiz.tsx`):

```ts
const answer = async (choice: number | null) => {
  const r = state?.round;
  if (!r || pending || r.mine) return;
  setPending({ idx: r.idx, choice });                 // the option shows "שולחים…"
  savePending(quizId, r.idx, choice);                 // sessionStorage (try/catch): resent once after a reload or an app switch
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await answerRound(quizId, r.idx, choice); break; }
      catch (e) {
        const m = e instanceof Error ? e.message : "network";
        if (m === "not open") { await sleep(Math.max(200, Date.parse(r.opens_at) - clock.now() + 200)); continue; }
        if (m === "network" && clock.now() < Date.parse(r.closes_at) + 1500) { await online(); continue; }   // the "online" event, or 3 s
        if (QUIZ_ERROR_TEXT[m as QuizError]) say(QUIZ_ERROR_TEXT[m as QuizError]!);
        break;
      }
    }
  } finally {
    clearPending(quizId); setPending(null); void refresh();   // the state says what was kept
  }
};
```

`sleep`, `online`, `say`, `savePending` and `clearPending` are small local helpers. On mount, a pending answer for the round on screen that the state shows as unanswered is sent once, if the round is still open.

**The banner's data** (`useOpenQuiz`): `openQuiz(groupId)` on mount and after each `watchOpenQuiz` event (300 ms debounce). It shows `names.slice(0, 2).join(", ")` and `+n` for the rest.

### 4.4 Accessibility and phone details

- Options are the `QuestionCard` radiogroup (`aria-label="תשובות"`); one tap answers, so they are disabled while a choice is sent.
- The timer is `role="timer"` with no live announcing; a separate polite region says **"נשארו 10 שניות"** once and **"הזמן נגמר."**; the reveal's headline is polite and takes the focus, as practice's feedback does.
- Right, wrong and "הבחירה שלך" always have a ✓/✗ label or text, never colour alone; counts are text beside the bars.
- Tap targets ≥ 44 px (options 52 px); no horizontal scroll at 360 px; `env(safe-area-inset-*)` on the sticky bar.
- `prefers-reduced-motion`: no ring sweep, no table re-ordering animation.
- Keys on a computer: 1-5 choose; Enter = "לשאלה הבאה" for the manager.

---

## 5. Edge cases and failure modes

### 5.1 What a cheater could do, and whether it matters in a group of six

| A player tries to… | Possible? | What stops it (check) | Matters here? |
|---|---|---|---|
| read the key in the network tab before answering | **no** | the key lives in `study_question_keys` (no grants); the state sends it only after the reveal (QZ3d) | – |
| answer the same question in practice to learn the key | **no** | the round holds the key: `in quiz` (QZ3e) | – |
| get the key from last week's practice review | **no** | feedback returns nothing for a held question (QZ3f), then works again after the reveal (QZ5d) | – |
| re-key a past-exam item to their own choice before the reveal | **no** | `in quiz` (QZ14b-c) | – |
| change an answer after seeing the others' | **no** | first answer kept (QZ4c, QZ5g); nothing after the reveal (QZ7b2) | – |
| claim a faster time | **no** | the server stamps the time; a phone sends only the choice (QZ4b, QZ10f) | – |
| answer after the deadline | 1.5 s grace, then **no** | `closed` | no |
| see who chose what in a group quiz | **no** | counts only, no names; `mine` only to its owner (QZ5c, QZ5f) | – |
| read the question up to 3 s early (it arrives with the countdown) | yes | it is sent ahead so every phone can show it at the same instant; no answer is accepted before the opening (QZ4) | little: a few seconds of reading |
| look it up in the summary, or ask a friend | yes | nothing an app can do | social; the group decides if a race is open-book |
| reveal early to cut the others' time (race) | **no** | in a race only the clock or everyone's answer reveals (QZ10d) | – |
| cancel a question they got wrong | yes, as manager | the round shows who cancelled it, on every phone | social, and visible |
| grab the managing role | only when the manager is away 30 s or left (QZ7d-e) | | no |
| play on two devices | yes, until email sign-in | two seats with the same name; the merge keeps one (M2) | harmless |
| a stranger or a signed-out visitor | **no** | membership checks and RLS (QZ1d-e); anon has no grants (QZ15b-c) | – |

The design stops the cheap and accidental ways (a key in a response, a second tap, a phone's clock) because they would make the private weak points wrong, not because six friends would cheat. What only a person can do (asking a friend) stays social.

### 5.2 The manager leaves, late joiners, reconnecting, phones locking

- **The manager taps "יציאה".** Managing passes to the player seen most recently (QZ11); the last one out ends the quiz (QZ11c).
- **The manager's phone locks or loses signal.** A question still closes at its deadline: any player's phone asks for the reveal 1.5 s after it, and any read of the state reveals it 4.5 s after it (QZ7b, QZ8). Moving on needs a manager: after 30 s without a sign of life from that phone, every other player sees "לקחת את ניהול המבחן" (QZ7, QZ7d). If the old manager comes back while the new one is here, they cannot take it back (QZ7e) unless the new one goes away.
- **Everyone's phone locks.** The round is revealed by the first phone back; the quiz waits. After 20 minutes untouched it is over: the banner hides it (QZ12) and the next new quiz closes it (QZ12b).
- **Late joiners.** Anyone in the group may join until the end, from the banner or the link. They see the round on screen with the time left and may still answer it; `joined_idx` records where they came in (QZ6); earlier rounds have no answer from them. A race's table shows them with their points so far.
- **A player away for 30 s** is not waited for: "everyone answered" counts only players seen in the last 30 s (`study_quiz__all_answered`), so one locked phone does not make five people wait for the clock each round. Their answer still counts if they come back while the round is open.
- **Reconnecting.** realtime-js reconnects by itself (1, 2, 5, 10 s) and the room re-reads on `SUBSCRIBED` (measured: 1,027 ms, §6.4). Events sent while the socket was down are not replayed; the re-read and the 15-second ping close the gap (R6).
- **A phone's clock is wrong.** Countdowns use the server's clock from round trips, off by at most half the best round trip (check C1: a phone 40 s fast). The phone's own clock never decides anything.
- **An answer in flight when the phone locks.** Either it reached the database or it did not; on return the state's `mine` says which, and an unsent answer is sent once if the round is still open (§4.3).
- **The screen turning off.** The Wake Lock keeps it on where supported (§2.5); iPhone home-screen apps before iOS 18.4 cannot, and recover on return.
- **Slow networks and fairness.** The time is stamped when the request reaches the database, so a slow connection loses about half its round trip: 25 points a second in a 20 s race round, about 4 points for a 300 ms trip.

### 5.3 Everything else

- **Two members open a quiz at once.** An advisory lock per group: one gets the quiz, the other `quiz open` and the "להצטרף אליו" button (QZ1b).
- **Fewer questions ready than chosen.** The quiz takes what there is (the lobby says so); none → `no questions` and the link to generate.
- **A flagged question** ("wrong key", "two answers", "not in the slides") is chosen last, only when nothing else is left (QZ3b).
- **The same questions again.** Choosing prefers questions the fewest of these players have answered before, counted from their private answers inside the function and never returned (`study_quiz__pick`).
- **A lecture deleted mid-quiz.** Its questions go; the open round has no question, is cancelled at its reveal, and rounds not yet open are skipped (QZ13-QZ13c).
- **A question retired mid-quiz** stays in this quiz (its key still scores it); the manager may cancel it. It is left out of later quizzes.
- **A question cancelled after the reveal.** Points come off everyone's score and the copies leave everyone's private record (QZ7f-g).
- **A long clinical case.** Its time grows with its length, up to 240 s (QZ3b: a 1,300-character case got 97 s against a 30 s setting).
- **A member leaves the group mid-quiz.** Every function refuses them (not a member); their seat stays, named "ללא שם", and counts as away.
- **The budget is used up.** The quiz is unaffected. Only generating new questions from the setup is refused, by practice's own check.
- **Deep links.** `?v=quiz&q=<id>` for a member not signed in → Join, then the room (the route is kept, §4.2). A cancelled or ended quiz from an old link shows "המבחן בוטל." or the end screen (players) / "המבחן הסתיים." (others).
- **Watching.** Members who did not join see the questions and reveals, never scores or the end summary (QZ9c, QZ10g), and cannot answer or reveal.
- **History.** Quizzes stay as history (small rows; deleted with the group). `study_quiz_recent` shows the last ones.

---

## 6. Tests

### 6.1 SQL (append to `supabase/tests/study.sql`)

The checks are `spec/quiz-proto/sql/quiz-test.sql`. They run in the same psql session right after the existing checks (they reuse its users, `:gid` and `:code`, and add two members, יעל and דנה, as fixtures). Time is simulated by moving a round's times into the past as the table owner, never by sleeping. Once the platform, practice and quiz blocks are in the repo, the run is today's:

```bash
su postgres -c "dropdb --if-exists studytest; createdb studytest"
cat supabase/tests/stubs.sql supabase/board-schema.sql supabase/study-schema.sql supabase/study-schema.sql \
  | su postgres -c "psql -q -v ON_ERROR_STOP=1 -d studytest -f -"
cat supabase/tests/study.sql | su postgres -c "psql -q -v ON_ERROR_STOP=1 -d studytest -f -" | grep -E "ok|FAIL|expect"
su postgres -c "dropdb studytest"
```

| Area | Checks |
|---|---|
| Creating | QZ1-QZ1e: the title, the manager, one open quiz per group, every bad input, strangers |
| Joining, and what members cannot touch | QZ2-QZ2d: joining twice is one seat; only the manager starts; rounds, answers and players are unreadable; the quiz row and answers cannot be written directly |
| Starting | QZ3-QZ3c: questions chosen, flagged last, long cases get more time, a group quiz keeps the lecture's order |
| The hold | QZ3d-QZ3f, QZ5d, QZ9f, QZ14-QZ14d: no key in the state before the reveal; practice, review and exam functions refuse a held key; released at the reveal; an abandoned hold expires |
| Answering | QZ4-QZ4h: not before the opening, the time taken, the first answer kept, no correctness returned, counts without a version step, players only, valid choices |
| The reveal | QZ5-QZ5h: automatic when everyone answered; key, explanations, counts, right/answered, my own result; copies into my private record, none visible to others; nothing changes after it; no scores in a group quiz |
| Late joiner and moving on | QZ6-QZ6e: `joined_idx`, an idempotent "next", "לא יודעים" |
| The manager's phone locks | QZ7-QZ7g: manager away, any player reveals after the deadline, no answers after, take over, no take over while the manager is here, cancelling removes the private copies |
| Every phone asleep | QZ8-QZ8b: the next state read reveals; the ping returns the clock and the version |
| The end | QZ9-QZ9f: the summary to players only, the banner clears, the recent list, no key held |
| A race | QZ10-QZ10h: the title of a multi-lecture quiz, kinds, no "לא יודעים", no early reveal, points equal the formula, watchers see no scores, scores move only at the reveal |
| Leaving | QZ11-QZ11c: managing passes on, the reveal when the rest answered, the last one out ends it |
| Forgotten quizzes | QZ12-QZ12b: hidden after 20 minutes, closed by the next quiz, the banner's names |
| A lecture deleted mid-quiz | QZ13-QZ13c |
| Realtime and anon | QZ15-QZ15c: only `study_quizzes` is published; anon reads and calls nothing |
| Merge | M1-M6 (`sql/merge-test.sql`): one seat for a person who played on two devices; every user column merged |
| The repo's and the questions design's checks | still 0 FAIL with the quiz loaded |

<details><summary>Output of <code>run-sql.sh</code> in this sandbox</summary>

```text
schema loaded twice: study-schema + design-platform + questions + questions-hold + quiz
 QZ1. Antimalarials · coop · lobby · players 1 · host is Shoham: true (expect Antimalarials · coop · lobby · players 1 · true)
  QZ1b. ok: one open quiz per group (quiz open)
  QZ1c. ok: modes are coop and race (bad mode)
  QZ1c. ok: 3 to 30 questions (bad count)
  QZ1c. ok: 15 to 120 seconds (bad seconds)
  QZ1c. ok: lectures of the group only (lecture not found)
  QZ1d. ok: a stranger cannot open a quiz (group not found)
 QZ1e. stranger sees 0 quizzes (expect 0)
  QZ1e. ok: stranger cannot read the state (quiz not found)
  QZ1e. ok: stranger cannot join (quiz not found)
 QZ2. Noa joined (twice): players 2, version 2 (expect 2, 2)
  QZ2b. ok: only the host starts (not host)
  QZ2c. ok: rounds are not readable (permission denied for table study_quiz_rounds)
  QZ2c. ok: answers are not readable (permission denied for table study_quiz_answers)
  QZ2c. ok: players are not readable directly (permission denied for table study_quiz_players)
  QZ2d. ok: the quiz row changes only through the functions (permission denied for table study_quizzes)
  QZ2d. ok: answers go through study_quiz_answer (permission denied for table study_quiz_answers)
 QZ3. started: question, round 0 of 5, opens in 3 s, version 3 (expect question, round 0 of 5, opens in 3 s, version 3)
 QZ3b. the flagged question was left out: true; long cases get more time: 30,97 (expect true; 30,97)
 QZ3c. a group quiz keeps the lecture's order: parts 0,0,0,1,1 (expect 0,0,0,1,1)
 QZ3d. Noa's screen: round 0, 5 options; key sent: false, explanations sent: false (expect 0, 5; false, false)
  QZ3e. ok: practice refuses a question in an open round (in quiz)
 QZ3f. feedback for it while open: 0 rows (expect 0, although Noa answered it last week)
  QZ4. ok: no answer before the round opens (not open)
 QZ4b. Noa answered option 3; time taken 1.9-2.6 s: true; the reply says nothing about right or wrong: true (expect key+1; true; true)
 QZ4c. a second tap keeps the first: option 3 (expect the same option)
 QZ4d. the row now: answered 1, version 3 (expect 1, 3: an answer is not a new step)
 QZ4e. Noa's screen keeps her choice: 3 (expect key+1)
  QZ4f. ok: a player cannot reveal early (too early)
  QZ4g. ok: only players answer (not playing)
  QZ4h. ok: the choice must be an option (bad choice)
 QZ5. Shoham answered 2 (expect the key)
 QZ5b. after the last answer: reveal, answered 2, version 4 (expect reveal, 2, 4)
 QZ5c. Noa sees: key 2, 5 explanations, counts [0, 0, 1, 1, 0], right 1 of 2, hers right: false, points 0 (expect the key, 5, one vote on the key and one next to it, 1 of 2, false, 0)
 QZ5d. hold released: feedback now gives 1 row (expect 1)
 QZ5e. Noa's private record has her quiz answer: 1 (expect 1, mode quiz, wrong)
 QZ5f. ...and none of Shoham's: 0 visible to Noa (expect 0)
 QZ5g. a re-sent answer after the reveal changes nothing: 3 (expect key+1, her first)
 QZ5h. a group quiz shows no one's score: none (expect none)
 QZ6. Yael joined during round 0; players 3 (expect 0; 3)
 QZ6b. a second tap on "next" did nothing: round 1, state question (expect 1, question)
 QZ6c. Yael answers round 1: 3 (expect the key)
 QZ6d. Noa answers "לא יודעים": null (expect null)
 QZ6e. Shoham has not answered: question, answered 2 (expect question, 2)
 QZ7. host here: false (expect false)
 QZ7b. after the deadline Noa revealed it: reveal (expect reveal)
  QZ7b2. ok: no answers after the reveal (closed)
  QZ7c. ok: only the host moves on (not host)
 QZ7d. Noa took over: host is Noa true (expect true)
  QZ7e. ok: no take-over while the host is here (host here)
 QZ7f. voided: true; Noa's quiz answers to it left in her record: 0 (expect true; 0)
 QZ7g. ...and Yael's: 0 (expect 0)
 QZ8. nobody revealed round 2; Yael's next look reveals it: reveal (expect reveal)
 QZ8b. her ping also answers with the clock and the version: true, reveal, 11 (expect true, reveal, the same version as the row)
 QZ9. ended: ended, rounds revealed 3 (expect ended, 3)
 QZ9b. Noa's summary: hers false,false,-, voided false,true,false (expect false,false,-; false,true,false)
 QZ9c. Dana (a member who did not play) gets no summary: null (expect null)
 QZ9d. the banner after the end: 0 open quiz (expect 0)
 QZ9e. recent: coop, 2 rounds, group right 50%, mine 0/1, rank - (expect coop, 2 rounds, 50%, 0/1, -)
 QZ9f. no key is held any more: 0 (expect 0)
 QZ10. title of a two-lecture race: פתוגן מאכסן · 2 הרצאות (expect פתוגן מאכסן · 2 הרצאות)
 QZ10b. only multiple-choice questions: true (expect true)
  QZ10c. ok: a race has no "לא יודעים" (bad choice)
  QZ10d. ok: in a race even the host waits for the clock (too early)
 QZ10e. all three answered: reveal (expect reveal)
 QZ10f. the table: שוהם 949 (+949), נועה כהן 749 (+749), יעל 0 (+0); Shoham's is 500 + 500 × (time left / 20 s): true (expect שוהם ≈950, נועה כהן ≈750, יעל 0; true)
 QZ10g. Dana, watching, sees no scores: none (expect none)
 QZ10h. Yael answered right, her score before the reveal: 0 (expect 0)
 QZ11. host after Noa left: יעל, players 2 (expect יעל, 2)
 QZ11b. revealed once the two who stayed answered: reveal; Yael's score now 974 (expect reveal; more than 500)
 QZ11c. the last one out ends it: ended (expect ended)
 QZ12. the banner hides a lobby untouched for 25 minutes: 0 (expect 0)
 QZ12b. a new quiz closes it: old cancelled, new lobby; banner 1 quiz, in it: נועה כהן (expect cancelled, lobby; 1 quiz, in it: נועה כהן)
 QZ13. the open round lost its question: null (expect null)
 QZ13b. its reveal voids it: true (expect true)
 QZ13c. no rounds with a question left, so it ends: ended (expect ended)
 QZ14. a held exam item is not handed out for explaining: 0 (expect 0)
  QZ14b. ok: no re-keying during its round (in quiz)
  QZ14c. ok: no new explanations during its round (in quiz)
 QZ14d. an expired hold lets go by itself: 1 (expect 1)
 QZ15. published quiz tables: study_quizzes (expect study_quizzes)
  QZ15b. ok: anon cannot read quizzes (permission denied for table study_quizzes)
  QZ15c. ok: anon cannot call the functions (permission denied for function study_quiz_state)
--- repo + questions checks with the quiz loaded: lines with FAIL or ERROR ---
0
--- merge (research-auth-merge.sql + questions lines + quiz lines) ---
 M1. claim returns 1 (expect 1)
 M2. quiz A: player rows 1, the account's answer kept: 1, host 11111111-0000-4000-8000-000000000001 (expect 1, 1, 11111111-…: the account)
 M3. quiz B: the laptop's seat moved to the account: 1 (expect 1)
 M4. rows left on the laptop's id: 0 (expect 0)
 M5. ok: every user column of the quiz tables is merged
 M6. the quiz adds 5 user columns (expect 5: host_id, created_by, voided_by, two user_id)
```

</details>

### 6.2 Six phones at once

`spec/quiz-proto/run-concurrency.sh`: a group of six in a race; six `psql` sessions answer the same round in the same instant, then, after a deadline, six sessions ask for the reveal in the same instant. It proves the row lock: every answer kept, the reveal once, the private copies once.

```text
quiz 8120f036-c9c1-4eba-87c4-2c5691dfdad4
 answer p3: 1 2036
 answer p2: 0 2036
 answer p1: 1 2051
 answer p4: 0 2058
 answer p6: 0 2066
 answer p5: 1 2066
 K1. answers 6, state reveal, version 8, private copies 6 (expect 6, reveal, 8, 6)
 K1b. scores: 948,0,949,0,948,0 (expect odd players > 500, even players 0)
 K2. after six reveals at once: state reveal, version 10, rounds revealed 2 (expect reveal, 10, 2: one reveal, one version step after the next)
```

### 6.3 Client logic (Node, offline)

`spec/quiz-proto/test/run.ts`, compiled with the repo's strict options (the TypeScript 5.9.3 in `node_modules`), together with the type-checked `quizApi.ts` and `useQuiz.ts`. In the build PR these move next to the code as `src/study/lib/quiz.test.ts`, run by the same `node` step the platform proposes for its own tests.

```text
ok   C1 clock: a phone 40 s fast still counts down to the server's deadline (error ≤ 40 ms with an 80 ms round trip) - 0 ms
ok   C2 clock: no samples means no offset
ok   C3 clock: a bad server time is ignored
ok   V1 view: before opens_at, a 3-2-1 countdown - {"v":"countdown","secs":3}
ok   V2 view: during the round, the time left and the options - {"v":"question","leftMs":10000,"answered":false,"canAnswer":true}
ok   V3 view: after answering, no second answer
ok   V4 view: a member watching cannot answer
ok   V5 view: after the deadline, waiting for the reveal
ok   V6 view: the other states map one to one
ok   V7 view: a round whose question was deleted cannot be answered
ok   A1 act: before the round, wake up when it opens - {"inMs":3000,"what":"tick"}
ok   A2 act: at the deadline, ask for the reveal after the 1.5 s grace plus this phone's jitter - {"inMs":1800,"what":"reveal"}
ok   A3 act: a member watching never asks for the reveal (only players may); it pings after the server's own 4.5 s - {"inMs":4800,"what":"ping"}
ok   A4 act: on the reveal screen, only the 15 s ping - {"inMs":5000,"what":"ping"}
ok   A5 act: during the round, tick every second
ok   A6 act: six phones' reveal requests spread over 0.8 s - 1500,1637,2012,2299
ok   R1 event: same version, only the count moved: applied without a request
ok   R2 event: a new version means a step: read the state
ok   R3 event: a partial payload (no version) is never trusted
ok   R4 event: before the first state, read it
ok   R5 ping: the same version and host: nothing to read
ok   R6 ping: a version missed while the socket was down: read the state
ok   R7 ping: the host's phone went quiet: read the state (shows the take-over button)
ok   P1 table: equal points share a place (1, 2, 2, 4) - נועה:1 יעל:2 שוהם:2 דנה:4
ok   P2 points: the SQL formula (500 + up to 500 for speed)
ok   P3 points: 2,010 ms of 20 s gives 949, as the SQL test printed
ok   P4 clock text
all ok
```

### 6.4 The Realtime contract (Playwright, done here)

`spec/quiz-proto/e2e/realtime-contract.cjs`: a page with the installed supabase-js (UMD build) subscribes to the quiz row exactly as `watchQuiz` does and reads the state on every `SUBSCRIBED`; a Phoenix 2.0.0 mock like `scripts/study-together-e2e.js`'s sends one `postgres_changes` UPDATE with the row, then closes the socket as a locking phone would.

```text
{
 "rowEvent": {
  "version": 6,
  "answered_n": 4,
  "idx": 2,
  "state": "question",
  "closes_at": "2026-11-15T18:00:23.000+00:00",
  "allColumns": true
 },
 "reconnect": {
  "sockets": 2,
  "secondSubscribedAfterMs": 1029,
  "stateReadsAfterDrop": 1,
  "statuses": [
   "SUBSCRIBED",
   "CHANNEL_ERROR",
   "SUBSCRIBED"
  ]
 },
 "errors": []
}
ok: both Realtime assumptions hold
```

### 6.5 Playwright e2e (mocked Supabase; the plan for the build)

A new script beside the existing ones, `scratchpad/scripts/study-quiz-e2e.js`, built from `study-together-e2e.js`: the same static server, the REST mock and the Phoenix 2.0.0 Realtime mock. Build: `VITE_SUPABASE_URL=https://mock.supabase.test VITE_SUPABASE_ANON_KEY=mock-anon-key VITE_STUDY_PRACTICE=1 VITE_STUDY_QUIZ=1 npx vite build --outDir <dir>`.

**Contexts** (390×844): שוהם (manages), נועה (her `Date.now` shifted +40 s by an init script, to prove the server clock), יעל, and דנה (watches). A fifth context in `colorScheme: "dark"` for screenshots.

**Mock additions**

- **Data:** the lecture of the together test; six questions with keys held only in the mock: the four stand-in items of `questions-proto/test/sample-part1.json` and `sample-part4.json` (real Hebrew, two clinical cases), plus two short ones.
- **REST:** `POST /rest/v1/rpc/study_quiz_*` served by `quizMock`, a ~250-line JavaScript port of `quiz.sql`'s state machine (create, join, leave, next, answer, reveal, void, take_host, end, ping, state, open, pool, recent) with the same rules and messages. Errors as the together test's `study_join` mock: HTTP 400 `{ message: "closed" }`. Time constants come from the environment so the run is quick: `E2E_LEAD_MS=3000`, `E2E_GRACE_MS=1500`, `E2E_DUE_MS=4500`, `E2E_AWAY_MS=4000` (30 s in the SQL). The mock logs every response body.
- **Realtime:** `notify(table, type, record)` sends `data.record` (the full row, with `columns` typing `version`, `answered_n`, `players_n`, `idx` as `int4`) and honours `eq` filters on `id` and `group_id` (the together test's `notify` ignores filters except for deletes). `dropSocket(name)` closes one context's socket. `E2E_BARE_EVENTS=1` sends `record: {}` to exercise the re-read path.
- **Wake Lock:** an init script replaces `navigator.wakeLock.request` with a recorder.

**Steps and assertions**

1. Shoham opens "יחד" → "מבחן קבוצתי חדש". The setup shows "6 שאלות" on the lecture and "המבחן לא עולה מהתקציב". She picks "קבוצתי", 5 questions, 20 s, and taps "פתיחת המבחן". The lobby reads "ממתינים להתחלה", with "ניהול" next to שוהם.
2. Noa's library shows the banner "מבחן קבוצתי פתוח · בפנים: שוהם" within 2 s. She taps "להצטרף"; both lobbies list נועה within 2 s.
3. Yael opens the shared link `?v=quiz&q=<id>` → "להצטרף למבחן". Dana opens it and stays: "צופים במבחן".
4. Shoham taps "להתחיל". All four show "3" then the question. The question appears on each page within 300 ms of the mock's `opens_at`, Noa's included despite her clock; the timers agree to the second.
5. Privacy: before each reveal, no mock response contains `answer`, `explanations`, `takeaway`, `counts` or another player's choice for the open round; no request reads `study_quiz_rounds`, `study_quiz_answers`, `study_quiz_players` or `study_question_keys`.
6. Noa answers: "התשובה נקלטה." The others show "1 מתוך 3 ענו", and Shoham's page made **no** state request in the second after that event (the same-version path).
7. Shoham and Yael answer: the reveal reaches all four at once. "2 מתוך 3 ענו נכון", the counts as text, "הבחירה שלך" on Noa's wrong choice only on Noa's page, five explanations, "מה לזכור". Dana sees the same without "הבחירה שלך".
8. Noa taps "משהו לא בסדר בשאלה?" → practice's FlagSheet → "נשלח לקבוצה."
9. "לשאלה הבאה". Nobody answers: "הזמן נגמר.", then the reveal on all pages within 2.5 s after the deadline; the mock saw at least one reveal request and moved the version once.
10. A phone locks: `dropSocket("יעל")` and Yael's page is set hidden (`visibilityState` overridden, `visibilitychange` dispatched). Shoham moves on; Noa answers. Yael's page is set visible: within 3 s it shows the current round with the right time left; Yael answers in time and it counts.
11. The manager leaves: Shoham's context closes. After the next reveal, Noa sees "לשוהם אין חיבור כרגע." and "לקחת את ניהול המבחן" (after `E2E_AWAY_MS`), taps it: "הניהול עבר לטלפון הזה." and "לשאלה הבאה"; Yael sees "ניהול: נועה".
12. Noa cancels the question ("ביטול השאלה", confirm): every page shows "השאלה בוטלה · נועה".
13. To the end: "הקבוצה ענתה נכון על …%", and each player's "שלך: x מתוך y" card differs and appears only on that player's page.
14. A race: Noa → "מבחן נוסף" → "תחרותי", 3 questions, 20 s; Yael joins. Noa sees no "לחשוף עכשיו". Answers 1 s apart: "+9xx" headlines; the table's order matches the mock's points; Dana sees no points.
15. With `E2E_BARE_EVENTS=1` for the race: every screen still moves (each event re-reads the state).
16. The banner: during the race Dana's library shows "מבחן תחרותי עכשיו · שאלה 1 מתוך 3"; after the end it disappears within 2 s.
17. Dark mode screenshots: the question, a group reveal, the race table, the end. ✓/✗ labels present; no horizontal overflow at 360 px (`scrollWidth`).
18. The Wake Lock recorder saw a request on entering the room and another after step 10's return.
19. No page errors, no unmocked calls.

Screenshots: `quiz-1-setup.png` … `quiz-9-dark-end.png`, as the existing scripts do.

### 6.6 Generated content: none, and the rubric for stand-ins

The quiz writes no text with Claude; its questions and explanations are judged by the questions design's rubric (its §6.4, R1-R10). Two things the quiz itself produces are judged the same way the summaries were: a separate agent, a rubric, stand-in output.

**R-set: the quiz a group gets.** Inputs: a fixture bank in the shape of `study_questions` (the questions design's stand-in items plus synthetic ones with realistic lengths, parts, topics, flags and earlier answers by some players), `study_quiz__pick` run on it for a group quiz and a race. The judge gets the bank and the chosen rounds (never the code) and grades each set:

| # | Pass when… |
|---|---|
| S1 | **Coverage:** the questions spread over the chosen lectures and parts; no part has two before every part with questions has one |
| S2 | **Trust:** no question flagged "wrong key", "two answers" or "not in the slides" while unflagged ones were left out |
| S3 | **Variety:** no two questions test the same fact (same topic and aspect with the same key point) |
| S4 | **Time:** each question's seconds let a careful reader read the vignette, the lead-in and the options and choose (spot-check the longest; the rule is ~15 characters a second + 10 s) |
| S5 | **Freshness:** questions these players had answered come after ones they had not |
| S6 | **Order:** a group quiz follows the lectures' order; a race is mixed |

Bar: S1, S2 and S4 on every set; S3, S5, S6 on 90%. A failing S3 adds the topic to `__pick`'s partition.

**R-copy: the Hebrew on the screens** (§1.3 and `QUIZ_ERROR_TEXT`). A Hebrew-reading judge grades each string:

| # | Pass when… |
|---|---|
| W1 | **Gender-neutral:** no singular gendered verb or adjective about the reader or another person (infinitives, plurals, nouns, "בטלפון של…") |
| W2 | **One reading on a phone:** clear at first glance, ≤ 12 words a line where possible |
| W3 | **The same words for the same things:** "מבחן קבוצתי", "מבחן תחרותי", "ניהול", "לחשוף", "התשובה הנכונה", "הבחירה שלך" |
| W4 | **True to §1.4:** every privacy statement matches who actually sees what |
| W5 | **Direction-safe:** English names, numbers, times and "+870" display in the right order inside Hebrew (rendered check through `isolateLatin` and `<bdi>`) |
| W6 | **Kind under pressure:** waiting and error lines neither blame nor rush |

Bar: W1 and W4 on every string; the rest on 90%.

### 6.7 Live checks (Yoad, read-only, Supabase SQL editor, after the first quizzes)

```sql
-- the last quizzes
select mode, state, n_total, players_n, created_at, ended_at from study_quizzes order by created_at desc limit 10;
-- per question: how many answered, how many right, average time, cancelled
select z.title, r.idx, r.seconds, r.voided_at is not null as cancelled, count(a.*) as answered,
       count(*) filter (where a.correct) as right_n, round(avg(a.ms)) as avg_ms
  from study_quiz_rounds r join study_quizzes z on z.id = r.quiz_id
  left join study_quiz_answers a on a.round_id = r.id
 where r.revealed_at is not null group by 1, 2, 3, 4 order by z.title, r.idx;
-- how often the 1.5 s grace saved a tap
select count(*) filter (where a.answered_at > r.closes_at) as in_grace, count(*) as all_answers
  from study_quiz_answers a join study_quiz_rounds r on r.id = a.round_id;
-- no key should be held outside a live round
select count(*) from study_question_keys where held_until > now();
```

---

## 7. Cost per use (USD)

**Claude: $0.00 per quiz.** The quiz makes no model call: 0 input tokens, 0 output tokens, so 0 × ($4 input, $20 output per million tokens for `claude-opus-5-5`, pricing page) = $0. Nothing is added to the ledger and `STUDY_MONTHLY_USD` is untouched.

**The questions it needs** are paid once, by practice, when a lecture has none yet: about $0.019 a question, **≈ $0.28 for a round of 15** (questions design §7, mid estimate; $0.19-0.65), charged to the same monthly budget as `practice`. Every later quiz and practice session on that lecture reuses them for $0. A month of three quizzes a week over lectures that already have questions costs $0 of Claude.

**Supabase** (free plan quotas from Supabase's docs):

| Resource | Per 10-question quiz of six | Arithmetic | Free plan |
|---|---|---|---|
| Realtime messages | **≈ 460** (+77 for each member watching the banner) | 77 row changes (1 create + 5 joins + 10 × (1 opening + 5 answer counts + 1 reveal) + 1 end) × 6 listening phones | 2 million a month: about 4,300 such quizzes |
| Peak Realtime rate | 36 messages a second | 6 answers in one second × 6 phones | 100 a second |
| Realtime connections | 6 | one socket per phone | 200 peak |
| Database calls | **≈ 400** | per question: 6 answers + 2 steps × 6 state reads + ≈ 18 pings (6 phones × ≈ 45 s ÷ 15 s); plus lobby and end | (Postgres compute, shared) |
| Data out | **≈ 0.6 MB** | per question 6 × 3.0 KB at the opening + 6 × 4.1 KB at the reveal ≈ 43 KB; × 10 ≈ 0.43 MB; pings ≈ 30 KB (180 × ~150 bytes); six end summaries of ten rounds ≈ 6 × 28 KB ≈ 0.17 MB (5.6 KB measured for two) | 5 GB a month uncached |

**Vercel:** nothing beyond serving the app's static files; no function runs.

---

## 8. Open questions only Yoad can answer

1. **Should quiz answers count in private mistakes and weak points?** Designed: yes, every answer is copied at the reveal into its owner's private record (mode `'quiz'`), so a quiz mistake waits in "הטעויות שלי" until answered right. The alternative is to copy only group-quiz answers, since a race's answers are rushed. (The questions design asked the same, its open question 6.)
2. **May the quiz go out before email sign-in?** Decision 11 puts sign-in before private progress ships. The quiz itself is shared, and its private copies stay invisible until practice screens ship (the merge then moves them to the saved account). Recommended: yes, together with question generation, because group learning is "the most essential part" for Shoham; practice's own screens still wait.
3. **The race table: everyone's points to every player (designed), or only the top three and one's own place?** Everyone's is the usual competitive game and the setup says so before anyone joins; the alternative is gentler when someone is last.
4. **May members watch a quiz without playing?** Designed: yes (they see questions and reveals, never scores). The alternative: players only.

---

## Appendix: Evidence

**Read in the repo** (`/home/user/delo-logo-review`, branch `claude/vigilant-johnson-lgk7xy`)

- `README.md` (the study app: anonymous members, RLS as the member, no service-role key, the budget, the reading channel, "A workaround for realtime-js", identity per device).
- `supabase/study-schema.sql` (tables, `study_is_member`, `study_lecture_group`, `study_can_use_topic`, the policy-dropping loop, explicit grants, the publication, the `realtime.messages` policies), `supabase/tests/stubs.sql`, `supabase/tests/study.sql` (run here with the quiz loaded: 0 FAIL).
- `api/_lib/study.ts` (`memberClient`, `assertBudget`, `usageCostUsd`, `textStream`, `errorText`), `api/study/section.ts` (the stream, fallbacks, the 270 s guard), `api/study/health.ts`, `vercel.json`, `package.json`, `tsconfig.api.json`, `.env.example`.
- `src/study/StudyApp.tsx` (views, URLs, Join keeping only `?l=`), `lib/api.ts` (`sb`, `watchGroup`, `watchLecture`, `readingRoom` and its presence workaround), `lib/generate.ts`, `components/Library.tsx`, `LectureView.tsx` (sheets and history, the follow logic), `Together.tsx` (sheets, copy style), `Join.tsx` (matching RPC error text), `SummaryView.tsx` (`isolateLatin`), `study.css` (tokens, dark mode), `study/index.html` (home-screen app metas).
- `node_modules/@supabase/realtime-js` 2.108.2: `RealtimeClient.js` (heartbeat 25 s, reconnect 1/2/5/10 s, optional worker heartbeat), `RealtimeChannel.js` (`_getPayloadRecords`: `payload.new` from `data.record`), `lib/transformers.js`. `node_modules/typescript/lib/lib.dom.d.ts` (`navigator.wakeLock`).
- Scratchpad: `scripts/study-together-e2e.js` and `scripts/study-e2e.js` (the REST and Phoenix mocks), `spec/design-questions.md` (+ `questions-proto/`, whose SQL is loaded in every run here), `spec/design-platform.md` (+ `.sql`, stubs), `spec/research-claude.md`, `spec/research-auth-merge.sql`.

**Fetched for this design** (copies in `spec/_quiz-docs/`, 2026-11-15; Supabase pages from their source in `github.com/supabase/supabase/apps/docs/content/`)

- https://supabase.com/docs/guides/realtime/postgres-changes: "By default each change event contains the full row"; "RLS policies are not applied to `DELETE` statements"; "Postgres Changes authorizes every event against each subscriber"; "processed on a single thread"; Broadcast above ~3,000 subscribers.
- https://supabase.com/docs/guides/realtime/subscribing-to-database-changes: Broadcast "the recommended method for scalability and security"; Postgres Changes "a simpler method"; `realtime.broadcast_changes()` needs a private channel and broadcast policies.
- https://supabase.com/docs/guides/realtime/broadcast: Broadcast from the Database (`realtime.send`, stored in `realtime.messages`, deleted after 3 days); replay for private channels, supabase-js 2.74+, "Only messages published via Broadcast From the Database are available for replay".
- https://supabase.com/docs/guides/realtime/authorization: RLS on `realtime.messages`, `extension` = `broadcast` or `presence`, `realtime.topic()`, private channels and the "Allow public access" setting.
- https://supabase.com/docs/guides/realtime/presence: `sync`, `join`, `leave`; "Presence is not designed for high-frequency updates"; "best suited for slow-changing state such as online/offline status" (why the quiz does not use it, §2.5).
- https://supabase.com/docs/guides/realtime/limits: free plan 200 connections, 100 messages a second, 100 channels a connection, "Presence calls per client, per 30 seconds: 5", Postgres change payload 1,024 KB.
- https://supabase.com/docs/guides/realtime/protocol: heartbeat "at least every 25 seconds"; reconnection backoff `[1000, 2000, 5000, 10000]` ms.
- https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages and its pricing partial: "Each database change counts as one message per client that listens to the event"; free quota 2 million. The connections partial: free 200 peak. https://supabase.com/docs/guides/platform/manage-your-usage/egress: free 5 GB uncached.
- https://developer.mozilla.org/docs/Web/API/Page_Visibility_API: hidden "because the device's screen is off"; background timers throttled; WebSocket pages exempt from throttling.
- https://developer.mozilla.org/docs/Web/API/Document/visibilitychange_event: "Transitioning to hidden is the last event that's reliably observable by the page".
- https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API and `WakeLock.request`: released when the document is hidden; request again on `visibilitychange`.
- MDN browser-compat-data `api/WakeLock.json` (github.com/mdn/browser-compat-data): Chrome 84, Firefox 126, Safari 16.4, Safari on iOS 18.4 (16.4-18.3 partial: "Does not work in standalone Home Screen Web Apps", WebKit bug 254545).
- Anthropic pricing, https://platform.claude.com/docs/en/about-claude/pricing, read in the copy fetched for the questions design (`spec/_q-docs/about-claude_pricing.md`), and the bundled `claude-api` skill's `shared/models.md`: Claude Opus 5.5 $4 input, $20 output per million tokens. Used only to state that zero tokens cost $0; the per-question cost of practice is the questions design's estimate.

**Experiments here** (`spec/quiz-proto/`, local only): `run-all.sh` → `tsc` (strict) + `node dist/test/run.js` (27 ok) + `run-sql.sh` (83 check lines as expected; the repo's and the questions design's checks 0 FAIL with the quiz loaded; merge M1-M6) + `run-concurrency.sh` (K1-K2); `e2e/realtime-contract.cjs` (Playwright 1.63.0, Chromium); `run-size.sh` (payload sizes). Postgres 16.15; throwaway databases dropped.
