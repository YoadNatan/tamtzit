# תמצית, release 2: the approved look, תרגול 2.0, the group quiz and server writing

Release 2 is everything on the branch `study/rel2` beyond release 1
(`RELEASE-1.md`). This page is Yoad's production steps, in order, what to
check, and how to roll back. It replaces `RELEASE-2-W.md` (server writing
alone): if you already did that page's steps 1 to 3, this page says where to
skip.

## What is in the release

- **The approved look, for the whole app.** The proposal's kit is the app's
  design system (`design-system.md`): its fonts, cards, chips, buttons, top
  and bottom bars and tab bar, in light and dark. It changes for everyone at
  the merge. No flag turns it off.
- **תרגול 2.0** (`proposal/practice-2/DECISIONS.md`, the four screens of
  `proposal/practice-2/mockups.html`, the question screens of
  `proposal/mockups/practice.html`). Its parts:
  - **מה ליצור:** the count by level (ממוקד · מלא · מקיף · משלי, מלא by
    default), which parts, which styles and the level. The count comes from
    the lecture's points to know, which are read once for the whole group
    (about $0.14 a lecture).
  - **דוגמה ומיקוד:** an exam question, pasted or photographed, is read back
    as "ככה השאלות ייכתבו: …". Then the focus line, and the cost before
    "ליצור N שאלות".
  - **הבנק נבנה:** the questions arrive with a coverage bar per part. A blind
    solver checks each one, and one the solver gets wrong is rewritten. Each
    question has "✓ להשאיר", "↻ לנסח מחדש" and "✕", and "להוסיף N לבנק"
    keeps the rest. A question enters the bank only when it is kept.
  - **סבב חדש:** from where (לא נענו · טעיתי · סימנתי · הכול), which parts,
    which style, how many (5, 10, all), and practice or exam mode.
  - **The question:** the bet "ניחוש · נראה לי · על בטוח" before "לבדוק".
    Then the autopsy (the choice, the key, the rest), each option with
    "מתי כן", then "מה לזכור" and "לפסקה".
  - **Two flags:** two members' flags take a question out of everyone's
    practice until someone checks it against the slide (the fix sheet).
  - **Who can create:** anyone in the group creates questions, and the bank
    is shared.
  - **Not anymore:** release 1's one-button sheet ("יצירת שאלות תרגול") is
    gone.
- **The group quiz** (`quiz.md`): "כולנו נגד המבחן" and "מירוץ", in the
  approved screens' look (`proposal/mockups/live-quiz.html`), behind
  `VITE_STUDY_QUIZ`.
  - A quiz calls no model and spends nothing.
  - "ליצור שאלות ולפתוח את המבחן", for a lecture without enough questions,
    spends like practice.
- **Server writing (W1)** (`RELEASE-2-W.md`): a new lecture's summary is
  written on Vercel, so the phone can be closed. "שיתוף" opens a sheet with
  the link and "הדפסה מהמכשיר".
- **The SQL:** section Q goes to version 2 (Q's end and practice 2.0), and
  sections W (version 1) and Z (version 2) are added. Release 1's rows are
  kept, and release 1's code keeps working on it.
- **No new Vercel variable,** and no new secret beyond W1's address in Vault
  (step 3). There is one new flag, `VITE_STUDY_QUIZ`.

**Not in this release:**
- W2, the hardening of server writing. It is its own pull request, after W1
  has written a lecture; see `RELEASE-2-W.md`, "W2 comes later". Never run
  the SQL from the branch `study/w`.
- The PDF made on the server and recordings (`VITE_STUDY_PDF`,
  `VITE_STUDY_RECORDINGS`). Their flags stay off.
- "הטעויות שלי", past exams, accounts, corrections, in-app card review
  (`VITE_STUDY_CARDS_REVIEW`) and every other `VITE_STUDY_*` flag. They stay
  unset.

## Before you start

- Release 1 is live: https://tamtzit.vercel.app/api/study/health
  answers `"schemaOk":true` and `"workerOk":true`.
- Release 1's three flags are set in Vercel → Settings → Environment
  Variables → **Production**: `VITE_STUDY_QUESTIONS`, `VITE_STUDY_PRACTICE`
  and `VITE_STUDY_CARDS`, each `1`. They stay on: practice 2.0 goes live with
  the merge, under these flags.
- The Vault key is exactly the key. In the SQL Editor:

  ```sql
  select length(decrypted_secret) from vault.decrypted_secrets where name = 'study_worker_key';
  ```

  It must say 64. If it says more, a space or line break was pasted into
  Vault. Put the key in again, with nothing around it between the quotes:

  ```sql
  select vault.update_secret(id, '<the key>') from vault.secrets where name = 'study_worker_key';
  ```

The project is the Supabase project `/` already uses. Never create a
group anywhere: the group exists, and only one can exist.

**Already did `RELEASE-2-W.md`'s steps 1 to 3?** Check in the SQL Editor:

```sql
select extname from pg_extension where extname in ('pg_net', 'pg_cron') order by 1;
select left(decrypted_secret, 8) from vault.decrypted_secrets where name = 'study_site_url';
```

If the first lists `pg_cron` and `pg_net`, and the second prints `https://`,
skip to step 4. Otherwise do steps 1 to 3.

## The steps, in order

### 1. Supabase: turn on pg_net

Supabase → Database → Extensions → search "pg_net" → turn it on. (In the SQL
Editor instead: `create extension if not exists pg_net with schema extensions;`.)

### 2. Supabase: turn on pg_cron

Supabase → Integrations → Cron → turn on pg_cron.

Check both (SQL Editor). It must list two rows, `pg_cron` and `pg_net`:

```sql
select extname, extversion from pg_extension where extname in ('pg_net', 'pg_cron') order by 1;
```

### 3. Supabase: the site's address in Vault

SQL Editor:

```sql
select vault.create_secret('https://tamtzit.vercel.app', 'study_site_url');
```

If it answers that the name already exists, update it instead:

```sql
select vault.update_secret(id, 'https://tamtzit.vercel.app') from vault.secrets where name = 'study_site_url';
```

Check (it must print the address, starting with `https://`):

```sql
select decrypted_secret from vault.decrypted_secrets where name = 'study_site_url';
```

This is production's address: pg_net calls `/api/study/work` there. A Preview
deployment is never the server writer. Nothing is written on the server yet,
because only the new app hands lectures to it.

### 4. Supabase: run the SQL of this release, before the merge

SQL Editor → paste **the whole** `supabase/study-schema.sql` **from the
branch Claude pushes this release to** (Claude gives the link: on GitHub, the
file → "Copy raw file") → Run. Don't use the file from `main`, from
`study/w`, or from an earlier release branch. The file can be run again
safely.

- **Expected:** it finishes without an error.
  - NOTICEs like "… already exists, skipping" or "… does not exist,
    skipping" are harmless.
  - With steps 1 to 3 done, no NOTICE mentions pg_net, pg_cron or a Vault
    secret.
  - If one does ("pg_cron is off…", "pg_net is off…", "Vault secret
    study_site_url is missing…", "Vault secret study_worker_key is
    missing…"), do that step and run the file again.
- **Check the registry:**

  ```sql
  select public.study_schema();
  ```

  It must answer `{"C": 1, "F": 1, "K": 1, "Q": 2, "W": 1, "Z": 2}`.
- **Check the two jobs:**

  ```sql
  select jobname, schedule from cron.job where jobname like 'study-%' order by 1;
  ```

  It must list `study-cron-cleanup` at `17 3 * * *` and `study-dispatch` at
  `* * * * *`.
- **Until step 5's deploy, today's app works as before.** The phones
  write the summaries, and section W keeps every write release 1 makes
  (`RELEASE-2-W.md`'s test). Release 1's answer call (without a bet) and its
  round of questions were run on this SQL in the upgrade test below.
- **What the file changes** (it changes no existing row):
  - It adds section W: the writing queue, its two jobs, two columns on
    `study_lectures`, and the recordings' tables, which stay empty.
  - It adds section Z: the quiz's tables and functions, and the quiz row on
    Realtime.
  - It raises Q to 2:
    - new columns on questions, keys, answers and batches, all empty on
      release 1's rows;
    - the points to know, the requests and the drafts, as new tables;
    - the counts of סבב חדש and the fix sheet.
  - Three of release 1's functions get new forms, with the old arguments
    still accepted: `study_answer_question`, `study_question_round` and
    `study_question_finish`.

### 5. Merge

Tell Claude that steps 1 to 4 are done; Claude merges the release into
`main`. Vercel deploys `main` to Production.

From this deploy on, the group sees the new look and practice 2.0 (release
1's flags are on). The quiz is still off.

### 6. Check health and the server writer

Once the deploy is live, open:

- https://tamtzit.vercel.app/api/study/health. It should answer:

  ```json
  {"ok":true,"anthropicKey":true,…,"worker":true,"workerOk":true,"budgetUsd":33,"schema":{"C":1,"F":1,"K":1,"Q":2,"W":1,"Z":2},"schemaOk":true,…}
  ```

- https://tamtzit.vercel.app/api/study/work. It should answer
  `{"worker":true,"secondsLeft":…}` with `secondsLeft` close to 300 (at
  least 250).

| If | Then |
|---|---|
| `"schemaOk":false` | The SQL and the code disagree: with release 1's flags this code needs Q at 2 and W at 1. Run step 4 again (the same file), then reload health. Until then the app shows "העדכון של האפליקציה עוד לא הושלם. כדאי לנסות שוב בעוד כמה דקות." |
| `/api/study/work` shows a page, or "not found" | The deploy isn't live yet. Wait a minute and reload. |
| `"worker":false` (in either) | `STUDY_WORKER_KEY` isn't set in Production. Vercel → Settings → Environment Variables → Production, then Deployments → the latest Production deployment → ⋯ → Redeploy. |
| `"worker":true` and `"workerOk":false` | Vault's `study_worker_key` is not the same value as Vercel's. Put the same key in Vault (see "Before you start"). No redeploy is needed. Until this is fixed, nothing new is written: no summary, no question. |
| `secondsLeft` under 250 | Fluid compute or the 300-second limit isn't in effect (Vercel → Settings → Functions). Turn server writing off (see "Rolling back", first bullet) until it is fixed. The phones then write. |

Go on only when `schemaOk` and `workerOk` are `true` and `/api/study/work`
says `"worker":true`.

### 7. Check server writing: one lecture

Upload one real lecture to the existing group (never create a group):
"העלאת הרצאה" → the file → "יצירת סיכום".

- **On the phone:** wait until the lecture page opens and the saving line
  is gone. The page then shows "הסיכום נכתב בשרת, חלק אחרי חלק…" under the
  title, and "מתכננים את מבנה הסיכום לפי נושאי ההרצאה… (בשרת)" until the
  parts appear.
- **Lock the phone.** Open the lecture 10 minutes later: it is written.
- **In the SQL Editor**, check that the server wrote it. The server's rows
  have no member (`by_server` true):

  ```sql
  select u.kind, u.ref, u.user_id is null as by_server, u.cost_usd, u.settled_at is not null as settled
    from public.study_usage u
   where u.lecture_id = (select id from public.study_lectures where deleted_at is null order by created_at desc limit 1)
   order by u.created_at;
  ```

  Expect one `outline` row and one `part` row per part, each with
  `by_server` and `settled` true. `select * from study_private.jobs;` is
  empty again once the lecture is written.
- **"שיתוף"** on the lecture opens the sheet with the link and "הדפסה
  מהמכשיר".

Keep this lecture for step 8.

### 8. Check practice 2.0

On a phone, on the lecture of step 7 (or another lecture without questions):
"תרגול" → the lecture → "יצירה". Each step below is a screen:

1. **מה ליצור:** the bottom button reads "לקרוא את הנקודות · כ-$0.14" (once
   for the group). Tap it. The same screen then shows the levels' counts
   (for example "ממוקד 12 · מלא 24 · מקיף 40") and each part its points.
   Choose **ממוקד** (the cheapest) and two styles.
2. **דוגמה ומיקוד:** paste one question from a past exam. The screen reads it
   back: "ככה השאלות ייכתבו: …". The cost card shows the count, the level and
   about $0.30. Tap "ליצור N שאלות".
3. **הבנק נבנה:** the count ("5/12") and the parts' bars grow. Each question
   shows the solver's chip (נבדקה ✓, בבדיקה…, הפותר טעה, לא נבדקה). On a
   second phone, the same screen grows live.
   - Keep one with "✓ להשאיר".
   - Remove one with "✕".
   - Reword one with "↻ לנסח מחדש" (about $0.03).
   - Then "להוסיף N לבנק" for the rest.
4. **סבב חדש:** "לא נענו" shows the bank's count. Choose 5 and practice
   mode → "להתחיל".
5. **A question:** pick an option, then a bet, then "לבדוק".
   - The autopsy shows the verdict with the bet, the options with "מתי כן",
     and "מה לזכור".
   - "לפסקה" opens the summary at the paragraph.

Then, in the SQL Editor:

```sql
-- what the request made, and what is in the bank now
select r.level, r.count, r.styles, d.status, d.check_state, count(*)
  from public.study_question_requests r join public.study_question_drafts d on d.request_id = r.id
 where r.created_at > now() - interval '1 hour'
 group by 1, 2, 3, 4, 5 order by 4, 5;
-- every model call reserved and settled once, by kind
select kind, count(*), round(sum(cost_usd), 3) as usd, count(*) filter (where settled_at is null) as open
  from public.study_usage
 where kind in ('points', 'practice', 'solver', 'reword', 'style') and created_at > now() - interval '1 hour'
 group by 1 order by 1;
-- the bet is saved (1 ניחוש, 2 נראה לי, 3 על בטוח)
select confidence, count(*) from public.study_answers where answered_at > now() - interval '1 hour' group by 1;
```

- **The drafts:** `kept` for what you kept or added, `removed` for "✕", and
  `replaced` for the reworded one. A `rejected` draft is one the solver got
  wrong twice.
- **The ledger:** `open` must be 0 once the screen says the bank is done.
  The total should be close to the screen's estimate.
- **Also check:** Vercel → Logs shows no 400 or 503 from `/api/study/ai`.
- **Release 1's questions** are in the bank as they were, and are practised
  the new way.

### 9. Turn on the quiz

Vercel → Settings → Environment Variables → **Production**. These four, each
`1`:

| Name | Value |
|---|---|
| `VITE_STUDY_QUESTIONS` | `1` (already set) |
| `VITE_STUDY_PRACTICE` | `1` (already set) |
| `VITE_STUDY_CARDS` | `1` (already set) |
| `VITE_STUDY_QUIZ` | `1` (new) |

Then Deployments → the latest Production deployment → ⋯ → **Redeploy**. The
flags are built into the app, so nothing changes until the redeploy.

- Set no other `VITE_STUDY_*` variable.
- Never set a `VITE_STUDY_*` flag on Preview: Preview deployments share the
  production database.

### 10. Check the quiz

- **Health:** `/api/study/health` again shows `"schemaOk":true`. With the
  quiz on, the app also needs `"Z":2`, which step 4 added.
- **Where it shows:** `/` → "תרגול" shows "מבחן קבוצתי", and "יחד"
  shows its card.
- **Play one quiz, on two phones:**
  - One phone opens a quiz of 5 questions on the lecture of step 8.
  - The other sees the banner "מבחן קבוצתי פתוח · בפנים: …" and joins with
    "להצטרף".
  - Play it to the end.
  - With two players the reveals say "2 ענו" and the end shows no group
    score. Counts and the group's score start at 3 players, as designed.
- **In the SQL Editor** (read only):

  ```sql
  select mode, state, n_total, players_n, created_at, ended_at
    from public.study_quizzes order by created_at desc limit 5;
  -- no key held outside a live round: 0 when no quiz is open
  select count(*) from public.study_question_keys where held_until > now();
  -- the quiz's answers are copied into each member's private practice
  select count(*) from public.study_answers where mode = 'quiz';
  ```

  A quiz spends nothing: `public.study_usage` gets no row from it.

### 11. Ask the group to reopen the app

Ask each member to close the app and open it again (on an iPhone, swipe the
Home Screen app away), so no phone keeps release 1's code. Until then, an old
copy writes summaries from the phone and practises the old way. Both still
work.

## What to watch

In the SQL Editor, during the first days:

```sql
-- Server writing: the queue (kicks_since_claim climbing towards 15 means the server isn't taking it)
select lecture_id, queued_at, last_kick_at, kicks_since_claim from study_private.jobs;
-- What pg_net got back from /api/study/work: 202 a part taken, 200 a harmless extra kick
select id, status_code, error_msg, created from net._http_response order by id desc limit 10;
-- The every-minute job should read succeeded
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'study-dispatch')
 order by start_time desc limit 5;
-- Reservations that never settled this month (a writer died)
select kind, count(*), round(sum(cost_usd), 2) from public.study_usage
 where settled_at is null and created_at >= date_trunc('month', now())
   and created_at < now() - interval '15 minutes' group by 1;
-- The month's spend by kind; compare with the Anthropic Console (within about 5%)
select kind, count(*), round(sum(cost_usd), 2) from public.study_usage
 where created_at >= date_trunc('month', now()) group by 1 order by 3 desc;
-- Questions two members' flags took out of practice, waiting for the fix sheet
select l.title, left(q.question, 80), q.hidden_at from public.study_questions q
  join public.study_lectures l on l.id = q.lecture_id
 where q.hidden_at is not null and q.retired_at is null order by q.hidden_at desc;
```

- **pg_net's answers.** 401: the key on Vercel and the key in Vault differ.
  404: `/api/study/work` isn't deployed. 503: the SQL is older than the code
  (run step 4 again). More in `RELEASE-2-W.md`, "What to watch".
- **The budget.** Everything spends from the same $33 a month. Questions,
  points, rewording and examples stop at 80% of the cap, and at 40% for one
  member. The rest of the cap stays for summaries. At that point
  דוגמה ומיקוד shows the line and its button waits.
- **The price of a question.** $0.025 a question (with the solver) is the
  approved figure. After the first lectures, compare it with the ledger:

  ```sql
  select kind, count(*), round(avg(cost_usd), 4) as avg_usd, round(sum(cost_usd), 2) as total_usd
    from public.study_usage
   where kind in ('points', 'practice', 'solver', 'reword', 'style') and settled_at is not null
   group by kind order by kind;
  ```

## Rolling back

Use the smallest rollback that fixes the problem.

- **Server writing only.** SQL Editor:

  ```sql
  delete from vault.secrets where name = 'study_site_url';
  ```

  - From then on the phones write the summaries, as in release 1, through
    the same claims.
  - A lecture already queued is written by the next phone that opens it.
  - No deploy and no SQL. To turn server writing on again, do step 3 again.
- **The quiz only.** Vercel → Environment Variables → delete
  `VITE_STUDY_QUIZ` (or set it to `0`) → Redeploy.
  - The quiz's entries disappear. A quiz link lands on the library (a
    lecture's quiz link on its practice) with the line "התכונה הזו עוד לא
    פתוחה.".
  - The quizzes and their answers stay in the database.
- **Practice and cards.** Delete `VITE_STUDY_QUESTIONS`,
  `VITE_STUDY_PRACTICE` and `VITE_STUDY_CARDS` (and `VITE_STUDY_QUIZ`), then
  Redeploy.
  - "תרגול" and the chips disappear.
  - Questions, drafts, points, answers and cards stay in the database for
    when the flags come back.
  - There is no flag for practice 2.0 alone: it is release 2's practice.
- **The whole release (last resort).**
  1. Turn server writing off, as above.
  2. Vercel → Deployments → the last Production deployment before the merge
     → ⋯ → Promote to Production (instant rollback).
  3. Ask the group to reopen the app.

  What happens then:
  - Release 1's code works with this SQL. Its practice, answers and round
    calls were tested on it.
  - Questions kept from drafts are ordinary questions to release 1. A
    question two flags took out of practice shows again there, because
    release 1 doesn't know that rule.
  - Drafts, requests and points stay unused.
  - Leave the SQL, pg_net, pg_cron and `study_worker_key` in Vault as they
    are: the next deploy of this release needs them. Before this release is
    deployed again, put `study_site_url` back in Vault (step 3), or server
    writing stays off.
  - Don't run release 1's `study-schema.sql` again. It sets section Q back
    to 1 and brings back release 1's forms of three functions
    (`study_question_round`, `study_answer_question`,
    `study_question_finish`) next to the new ones, so release 1's own round
    call fails ("function is not unique") and release 2 answers `schemaOk`
    false. If it was run by mistake, run this release's `study-schema.sql`
    again: it drops the old forms and sets Q back to 2.
- **Never** drop tables. Never run Supabase's sample clean-up of anonymous
  users: it would delete the group with its creator.

## What was tested (on `study/rel2`; local only)

No production, no real Supabase project and no real Anthropic call were
used. The branch merges `study/rel2-p` (practice 2.0's screens) and
`study/rel2-q` (the quiz's and W1's screens in the design system) without
conflicts. After the merge nothing drew release 1's `QuestionCard` any more,
so it went, with the old practice styles only it used (its two helpers moved
to `src/study/lib/questionText.ts`).

| Test | Result |
|---|---|
| `npm run test:study` | 506 tests, 506 pass, 0 fail |
| `npm run test:contract` | 88 RPC calls and 76 table chains in 136 files match the schema (138 study functions, 32 study tables) |
| `npm run build` | passes; the study entry 304.02 kB, no flags set (limit 400 kB) |
| `npm run test:bundle` | the study entry 314,869 bytes with every flag on; no package screen in it; Q's share 3.3 kB, Z's 7.0 kB |
| The whole SQL loaded twice (stubs, board, `study-schema.sql` × 2) on a throwaway Postgres 16 | 0 errors; `supabase/tests/study.sql`: 624 check lines, 0 FAIL, 0 ERROR; `{"C": 1, "F": 1, "K": 1, "Q": 2, "W": 1, "Z": 2}`; the jobs `study-cron-cleanup` (`17 3 * * *`) and `study-dispatch` (`* * * * *`) |
| The upgrade: `origin/main`'s `study-schema.sql` with release 1's data, then this file twice | 0 errors each time; the registry goes from `{"C": 1, "F": 1, "K": 1, "Q": 1}` to the one above; all 75 rows of the 26 tables kept, none changed |
| The upgrade: release 1's privileges and policies | 437 compared, none changed. Three function signatures were replaced by their new forms (`study_answer_question`, `study_question_round`, `study_question_finish`); release 1's calls to them still work |
| The upgrade: what runs on release 1's rows | release 1's answer call (no bet: confidence null) and round call; סבב חדש's counts and מה ליצור's parts; `study_queue` false until the address is in Vault; three members play a quiz on release 1's questions (the key held during the round and given back at the end, the bets copied into the private record) |
| `supabase/tests/quiz-concurrency.sh` (six psql sessions at once) | K1, K1b, K2, K3a, K3, K3b, K3c as expected |

The e2e flows ran on a mocked Supabase, each with every flag off (`off`),
with release 1's three flags (`rel1`), and with release 2's four (`rel2`).
Every screenshot was checked by `a11y.cjs` in light and dark at 390×844 and
360×640, which also fails on a clipped title, label or bar label and on a
bottom-bar or draft button whose words wrap. The three flag sets ran at the
same time, and `practice.cjs` passed again three times at once (45 ok each).

| Script | off | rel1 | rel2 |
|---|---|---|---|
| `summary.cjs` | pass, 0 a11y issues | pass, 0 | pass, 0 |
| `together.cjs` | pass, 0 | pass, 0 | pass, 0 |
| `shell.cjs` | pass, 31 checks ok, 0 | pass, 30 ok, 0 | pass, 30 ok, 0 |
| `practice.cjs` | pass, 3 ok (practice replaced), 0 | pass, 45 ok, 0 | pass, 45 ok, 0 |
| `cards.cjs` | pass, 2 ok, 0 | pass, 19 ok, 0 | pass, 19 ok, 0 |
| `writing.cjs` | pass, 29 ok, 0 | pass, 29 ok, 0 | pass, 29 ok, 0 |
| `quiz.cjs` | pass, 2 ok (quiz replaced), 0 | pass, 2 ok (quiz replaced), 0 | pass, 47 ok, 0 |

Known gaps:

- Only production can show some things: the device check of step 7, the
  first real questions of step 8 against the estimate, and the comparison
  with the Anthropic Console.
- The quality eval of the questions writer (Q-5) isn't built.
- W's, C's and K's shares of the study entry chunk are over the bundle
  check's 8 kB guide per package (17.6, 13.8 and 13.4 kB). The check passes
  and reports them.
