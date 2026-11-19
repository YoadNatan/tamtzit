# תמצית, release 2: writing the summary on the server (W1)

> Release 2 ships as a whole from `study/rel2`: follow `RELEASE-2.md`, which
> includes these steps. This page stays for its detail on server writing.

Release 2 writes a lecture's summary on the server. Once the slides and
pictures of a new lecture are saved, the phone can be closed: the summary is
written part by part on Vercel, and the whole group sees each part appear.
It is milestone W1 of the build spec (`spec/spec-final.md` §2.3, §4.3, §7.W),
on the branch `claude/vigilant-johnson-lgk7xy` (built as `study/rel2-w`): W1 on top of release 1. This page is Yoad's
production steps, in order, what to watch, and how to roll back. It follows
the spec's §9.1 step 4, for W1 only.

**W2 comes later.** W2, the hardening of the spec's §3.7, is not in this
release. It is its own pull request, with its own SQL, and it ships only
after W1 is live and has written a lecture (see "W2 comes later" below).

## What is in the release

- **Server writing.** After "יצירת סיכום" the phone saves the slides and
  pictures, then hands the lecture to the database (`study_queue`). Supabase
  calls `/api/study/work` on Vercel through pg_net, and the server writes
  the outline, then the parts: the first part alone (it fills the prompt
  cache), then two at a time. A pg_cron job checks the queue every minute.
  The text so far is saved every 15 seconds, so the group sees it grow.
- **One queue for every writer.** The server and the phones claim a part
  before writing it (`study_claim`), so no part is written twice. When the
  server is not set up, or is silent for 3 minutes while work waits, the
  phones write as they do today.
- **On the phone.** A note under the title, "הסיכום נכתב בשרת, חלק אחרי
  חלק…", while the server still has something to write. The planning line
  "מתכננים את מבנה הסיכום לפי נושאי ההרצאה… (בשרת)". Each waiting part says
  why it waits or stopped, and when it is tried again. "המשך כתיבה" starts
  failed parts over, at most three times a lecture in a study day.
- **"שיתוף"** opens a sheet with the link and "הדפסה מהמכשיר" (printing on
  the phone or computer, with a title page and a table of contents).
- **The server key is read without spaces or a line break around it.** A
  space or line break pasted after `STUDY_WORKER_KEY` on Vercel no longer
  breaks the key. The Vault secret `study_worker_key` must still be exactly
  the key.
- **No flags, and no new Vercel variable.** The SQL adds section W at
  version 1.

**Not in this release:** W2 (below); the PDF made on the server (W3,
`VITE_STUDY_PDF`) and recordings (W4, `VITE_STUDY_RECORDINGS` and the switch
`recordings`). Their flags and switch stay off. The recordings' tables are
created, and stay empty.

## Before you start

- Release 1 is live: `/api/study/health` answers `"schemaOk":true` and
  `"workerOk":true`.
- The Vault key is exactly the key. In the SQL Editor:

  ```sql
  select length(decrypted_secret) from vault.decrypted_secrets where name = 'study_worker_key';
  ```

  It must say 64 (the key from release 1, step 1). If it says more, a space
  or line break was pasted into Vault. Put the key in again, with nothing
  around it between the quotes:

  ```sql
  select vault.update_secret(id, '<the key>') from vault.secrets where name = 'study_worker_key';
  ```

The project is the Supabase project `/` already uses. Never create a
group anywhere: the group exists, and only one can exist.

## The steps, in order

### 1. Supabase: turn on pg_net

Supabase → Database → Extensions → search "pg_net" → turn it on. (In the
SQL Editor instead: `create extension if not exists pg_net with schema extensions;`.)

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

- This is production's address: pg_net calls `/api/study/work` there. A
  Preview deployment is never the server writer.
- The server key is already in Vault from release 1 (`study_worker_key`).
  Nothing else goes in Vault.
- Nothing is written on the server yet: only the new app hands lectures to
  it, and it is not deployed yet.

### 4. Supabase: run the SQL of this release, before the merge

SQL Editor → paste **the whole** `supabase/study-schema.sql` **from the branch
`claude/vigilant-johnson-lgk7xy`**
(https://github.com/YoadNatan/delo-logo-review/blob/claude/vigilant-johnson-lgk7xy/supabase/study-schema.sql,
button "Copy raw file") → Run. The file can be run again safely.

- Expected: it finishes without an error. NOTICEs like "… already exists,
  skipping" or "… does not exist, skipping" are harmless. With steps 1 to 3
  done, no NOTICE mentions pg_net, pg_cron or a Vault secret. If one does
  ("pg_cron is off…", "pg_net is off…", "Vault secret study_site_url is
  missing…", "Vault secret study_worker_key is missing…"), do that step and
  run the file again.
- Check the registry:

  ```sql
  select public.study_schema();
  ```

  It must answer `{"C": 1, "F": 1, "K": 1, "Q": 1, "W": 1}`.
- Check the two jobs:

  ```sql
  select jobname, schedule from cron.job where jobname like 'study-%' order by 1;
  ```

  It must list `study-cron-cleanup` at `17 3 * * *` (daily, it clears the
  jobs' old run records) and `study-dispatch` at `* * * * *` (every minute,
  it kicks the server for work that is due).
- From now until step 5's deploy, today's app works as before: the phones
  write the summaries, and this SQL keeps every write release 1 makes.
- What the file does: it adds section W (the queue, leases and retry times,
  the writing functions, the recordings' tables), two columns on
  `study_lectures` (`retry_day`, `retries`: the three restarts a day), and
  the two jobs. It changes no existing row and no permission of release 1.

### 5. Merge

Tell Claude that steps 1 to 4 are done; Claude merges the release into
`main`. Vercel deploys `main` to Production.

### 6. Check health and the server writer

Once the deploy is live, open:

- https://tamtzit.vercel.app/api/study/health. It should answer:

  ```json
  {"ok":true,"anthropicKey":true,…,"worker":true,"workerOk":true,"budgetUsd":33,"schema":{"C":1,"F":1,"K":1,"Q":1,"W":1},"schemaOk":true,…}
  ```

- https://tamtzit.vercel.app/api/study/work. It should answer
  `{"worker":true,"secondsLeft":…}` with `secondsLeft` close to 300 (at
  least 250).

| If | Then |
|---|---|
| `"schemaOk":false` | The SQL and the code disagree. Run step 4 again (the same file), then reload health. |
| `/api/study/work` shows a page, or "not found" | The deploy isn't live yet. Wait a minute and reload. |
| `"worker":false` (in either) | `STUDY_WORKER_KEY` isn't set in Production. Vercel → Settings → Environment Variables → Production, then Deployments → the latest Production deployment → ⋯ → Redeploy. |
| `"worker":true` and `"workerOk":false` | Vault's `study_worker_key` is not the same value as Vercel's. Put the same key in Vault (see "Before you start"). No redeploy is needed. Until this is fixed, nothing new is written. |
| `secondsLeft` under 250 | Fluid compute or the 300-second limit isn't in effect (`vercel.json` turns Fluid on; check Vercel → Settings → Functions), so the server would cut parts off before they are saved. Turn server writing off ("Rolling back", first bullet) until it is fixed: the phones then write. |

Go on only when `schemaOk` and `workerOk` are `true` and `/api/study/work`
says `"worker":true`.

### 7. Write one lecture on the server

Upload one real lecture to the existing group (never create a group):
"העלאת הרצאה" → the file → "יצירת סיכום".

- Wait until the lecture page opens: the saving line is gone, so the slides
  and pictures are saved and the lecture is with the server. The page shows
  the note "הסיכום נכתב בשרת, חלק אחרי חלק…" under the title, and
  "מתכננים את מבנה הסיכום לפי נושאי ההרצאה… (בשרת)" until the parts
  appear.
- Lock the phone. Open the lecture 10 minutes later: it is written.
- Check in the SQL Editor that the server wrote it. Each row is one call to
  Claude; the server's rows have no member (`by_server` true):

  ```sql
  select u.kind, u.ref, u.user_id is null as by_server, u.cost_usd, u.settled_at is not null as settled
    from public.study_usage u
   where u.lecture_id = (select id from public.study_lectures where deleted_at is null order by created_at desc limit 1)
   order by u.created_at;
  ```

  Expect one `outline` row and one `part` row per part, each `by_server`
  and `settled` true. `select * from study_private.jobs;` is empty again
  once the lecture is written.
- Compare the month's spend with the Anthropic Console (it should match
  within about 5%):

  ```sql
  select kind, count(*), round(sum(cost_usd), 2) from public.study_usage
   where created_at >= date_trunc('month', now()) group by 1 order by 3 desc;
  ```

- If you like, delete the test lecture afterwards ("מחיקה"; it waits 30
  days under "נמחקו לאחרונה").

### 8. Ask the group to reopen the app

Ask each member to close the app and open it again (on an iPhone, swipe the
Home Screen app away), so no phone keeps release 1's code. Until then an old
copy writes from the phone as it does today.

Lectures written before this release keep their state. One that stopped
half-way is written the old way when someone opens it, or by the server
after a tap on "המשך כתיבה".

## What to watch

In the SQL Editor, during the first days:

```sql
-- The queue: a lecture is here while it is being written. kicks_since_claim
-- climbing towards 15 means the server isn't taking it.
select lecture_id, queued_at, last_kick_at, kicks_since_claim from study_private.jobs;

-- What pg_net got back from /api/study/work.
select id, status_code, error_msg, created from net._http_response order by id desc limit 10;

-- Parts that stopped, or are being written now.
select l.title, s.idx, s.status, s.error, s.attempts, s.retry_at
  from public.study_sections s join public.study_lectures l on l.id = s.lecture_id
 where s.status in ('failed', 'writing') and l.deleted_at is null
 order by l.created_at desc, s.idx;

-- The every-minute job.
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'study-dispatch')
 order by start_time desc limit 5;

-- Reservations that never settled this month (a writer died).
select kind, count(*), round(sum(cost_usd), 2) from public.study_usage
 where settled_at is null and created_at >= date_trunc('month', now())
   and created_at < now() - interval '15 minutes' group by 1;
```

- **pg_net's answers.** 202 means a part was taken; 200 is a harmless extra
  kick (nothing to take). 401: the key on Vercel and the key in Vault
  differ (health shows `"workerOk":false`). 404: `/api/study/work` isn't
  deployed (before the merge, or after a rollback). 503: the SQL is older
  than the code (run step 4 again).
- **Stopped parts.** `timeout` is tried again after a minute.
  `rate_limited`, `overloaded`, `network`, `empty` and `api_5xx` are tried
  again after 2, 4, 8… minutes, four attempts in all. `refusal`, `budget`,
  `lost` (four writers died) and `figures_expired` wait for a tap on "המשך
  כתיבה".
- **The job** should read `succeeded` every minute.
- **Open reservations.** A few stay at their estimate when a writer dies
  (that errs on the safe side). If they keep appearing, look at Vercel →
  Logs → `/api/study/work` for lines starting "study work".
- **The budget.** The server spends from the same $33 a month as the phones.
  When the month's cap is reached, a new lecture stops with "הקבוצה הגיעה
  לתקרת התקציב של החודש…" and "המשך כתיבה".
- **Vercel → Usage**, after the first week: `/api/study/work` runs up to
  about 4.5 minutes a part, mostly waiting for Claude. Active CPU and
  Provisioned Memory should stay well inside Hobby's monthly allowance
  (spec §2.1).

## Rolling back

- **Server writing only (the usual rollback).** SQL Editor:

  ```sql
  delete from vault.secrets where name = 'study_site_url';
  ```

  From then on `study_queue` answers false and the phones write, as in
  release 1, through the same claims. The every-minute job does nothing. A
  lecture already queued is written by the next phone that opens it, after
  3 minutes without progress, or at once with "המשך כתיבה". No deploy and
  no SQL. To turn server writing on again, do step 3 again.
- **The whole release (last resort).** First turn server writing off as
  above. Then Vercel → Deployments → the last Production deployment before
  the merge → ⋯ → Promote to Production (instant rollback). Release 1's code
  works with this SQL: section W leaves every write release 1 makes in
  place. Leave the SQL, pg_net, pg_cron and the Vault key as they are: the
  next deploy of this release needs them. Don't run release 1's
  `study-schema.sql` again: it would take away section W's rules on the
  recordings' tables. Ask the group to reopen the app.
- Never drop tables. Never run Supabase's sample clean-up of anonymous
  users: it would delete the group with its creator.

## W2 comes later

W2 is the spec's §3.7: it takes away members' direct writes to summary parts
and to a lecture's writing state, so that only the writer's functions (with
the server key) can change them. It is not in this release, and it waits for
proof that W1 is live:

1. `/api/study/work` answers `{"worker":true,…}` (step 6), and
2. the server has written a lecture (step 7). This must be above 0:

   ```sql
   select count(*) from public.study_usage u join public.study_lectures l on l.id = u.lecture_id
    where u.user_id is null and u.kind = 'part' and u.settled_at is not null and u.created_at >= l.queued_at;
   ```

Then W2 is its own pull request, with its SQL run before its merge, like this
one. Until then:

- Never run `study-schema.sql` from the branch `study/w`. It holds W2's SQL,
  which would refuse the parts release 1's code writes, and a part already
  paid for would lose its text.
- The limit of three "המשך כתיבה" restarts a day holds for the app. A member
  who writes to the database directly with their own sign-in can still get
  around it, as they can write parts today. W2 closes this.
- Corrections (`VITE_STUDY_CORRECTIONS`, release 3) wait for W2.

## What was tested (on `study/rel2-w`; local only)

No production, no real Supabase project and no real Anthropic call were used.

- `npm run test:study` (every unit test, including `work.test.ts`, whose last
  test replays pg_net's kicks into `work.ts` against this SQL on a local
  Postgres until a three-part lecture is written, and `section.test.ts`),
  `npm run test:contract` and `npm run build` pass. The study entry chunk is
  under 400 kB.
- The SQL was loaded twice (stubs, board, `study-schema.sql`) on a throwaway
  Postgres 16 with 0 errors, and `supabase/tests/study.sql` gave 0 FAIL.
- The upgrade was run from release 1's schema (`main`'s `study-schema.sql`)
  with data (a group, lectures, written and half-written parts, the ledger,
  questions with a key, an answer and a flag, cards with an edit, a
  correction, a comment), then this file twice: 0 errors, every row of the
  26 tables kept, none of release 1's privileges or policies changed (437
  compared), the registry and the two jobs as above. After it, release
  1's own writes as a member still work, `study_queue` answers false until
  the address is in Vault and true after it, with one kick to production's
  `/api/study/work` carrying the Vault key. Without pg_net and pg_cron the
  file still loads, with the NOTICEs above.
- The server key with a space or line break pasted around it on Vercel:
  health shows `"workerOk":true`, and the server writer accepts pg_net's
  kick (unit tests that failed before the change).
- The e2e flows on a mocked Supabase, each with every flag off and with
  release 1's three flags: `writing.cjs` (server writing, the restart rules,
  sharing and printing), `summary.cjs` (also with a part that times out),
  `together.cjs`, `shell.cjs`, `practice.cjs` and `cards.cjs`.
  `writing.cjs` also passes with every flag on (the PDF option and the
  recording's notes, which stay off in this release).
- The six findings of W's review were checked on this branch (W-R1's fix
  belongs to W2, and was checked on `study/w`).

Known gaps:

- W's share of the study entry chunk is about 17 kB, over the bundle check's
  8 kB guide per package (the check passes; it reports the share).
- The device check of step 7 and the comparison with the Anthropic Console
  can only be done on production.
