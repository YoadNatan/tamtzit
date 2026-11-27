# תמצית, uploaded sheets (section O): Yoad's steps

Uploading a past exam or an exercise sheet ("דף תרגילים") and getting its
questions exactly as printed, then (later slices) open and numeric questions
and similar questions: [`sheets.md`](sheets.md). Yoad's choices for it (sheets
$6 a month, similar questions $5, other providers may see this material, one
practice set per sheet, simulations of past exams only) are in
[`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md) ("Uploaded sheets").
Built on `dev`; each release point below works on its own and rolls back on
its own. Release points not built yet are marked so. Release A1 (open and numeric
questions) is built too: "Release A1, start to finish" below. Release B's SQL
and server (similar questions, O9 and O10) are built; its app part (O11, O12)
is not: "Release point 4" below.

## Rules for all of it

- **Production only.** Never put `VITE_STUDY_SHEETS` (or the later
  `VITE_STUDY_SHEETS_FORMS`, `VITE_STUDY_SIMILAR`) on Preview: Preview shares
  the production database.
- **Order:** the code is merged to `main` and deployed first (the flags are
  off, so nothing changes), then the SQL, then the flag. Never the flag before
  the SQL: the app would report the schema as missing (`"schemaOk": false`).
- **Before:** sections R and L are installed (part 9, then part 10:
  [`RELEASE-R1.md`](RELEASE-R1.md), [`RELEASE-L1.md`](RELEASE-L1.md)). If
  they are not, they come with this release's run: parts 1 to 12, in order
  (part 9 holds I and R, part 10 L, parts 11 and 12 O). That is exactly what
  the tests ran on a copy of production's current schema (`eed179e`).
- **Since O5 (26 Nov 2026) section O starts part 11** and its version 2 (the
  sheet reader's SQL, dark until release A1's flag) edits sections Q, Z, M, H
  and T in place (parts 2, 3, 5 and 7): every SQL step below runs **parts 2 to
  11 in order**, each to the end. Part 11 alone stops at once with "section O
  2 needs parts 2 to 9 run first" (nothing is half done: run parts 2 to 11).
- **Since O9 (27 Nov 2026) the file is in 12 parts** and section O's version 3
  (similar questions, dark while the switch `similar` is off) is part 12. O 3
  edits section F (part 1: `kind_on`) and section E (part 7) in place, besides
  L's `kind_on` (part 10): from this `dev`, **every SQL step below runs parts 1
  to 12 in order**, each to the end, whichever release it is for (a step's
  "parts 2 to 11" from an older `dev` means parts 1 to 12 now; part 12 alone
  stops at once with "section O 3 needs part 11 run first"). After it,
  `study_schema() ->> 'O'` is `3`. Tested on a copy of production's schema
  (`eed179e`), then parts 1 to 12 twice, and on `4b9b832`'s with twin rows in
  the database before parts 1 to 12 ran twice again.
- **Money:** release point 1 spends nothing. Reading a sheet spends the
  group's budget like a past exam (about $0.05 a page), within the sheets line
  ($6 a month) from release point 2.

## Release A0, start to finish (the exact steps)

Release A0 is release points 1 and 2 below in one go: uploading a past exam
or an exercise sheet, its questions copied by the exam reader, the course
page by kind, the wide review, keying by hand. It was tested on `dev` (O4):
`e2e/study/sheets.cjs` and `devices.cjs` / `wide.cjs` on the mock, and the
SQL on a copy of production's schema (`eed179e`) with parts 2 to 11 run
twice (O5; [`sheets.md`](sheets.md), "The A0 e2e"). Nothing here spends money
until step 8. Do them in order; each says what to see.

1. **The two read-only checks** below ("Before anything"): is `exams` on
   (OD1), and the month's spend by kind (OD2). Send Claude the rows. If the
   spend without sheets is above about $15 a month, stop here: the sheets
   line goes down first.
2. **Merge `dev` into `main`** and let Vercel deploy Production. Every new
   flag is off, so the app does not change. Check
   `https://<the app's address>/api/study/health` says `"schemaOk": true`.
3. **The SQL: parts 1 to 12** (parts 2 to 11 before O9). In Supabase → SQL Editor, first read only:
   ```sql
   select public.study_schema() ->> 'I' as i, public.study_schema() ->> 'R' as r,
          public.study_schema() ->> 'L' as l, public.study_schema() ->> 'O' as o;
   ```
   Whatever it says (production at `eed179e` has none of I, R, L, O): run
   **`supabase/parts/1.sql`, `2.sql`, … `12.sql` in order**, each to the end.
   Parts 2, 3, 5 and 7 carry O 2's edits of the pickers (the quiz, the
   meeting's quiz, the boss and Today draw only choice questions), part 9 I
   and R, part 10 L, part 11 O (O 1 and O 2), part 12 O 3 (similar questions,
   dark: the switch `similar` is off); parts 1 and 7 carry O 3's in-place
   edits (`kind_on`, E's source check). This is the order the tests ran, twice over, on a copy of
   production's schema. NOTICEs are harmless. Then, read only:
   ```sql
   select public.study_schema() ->> 'O' as o, public.study_schema() ->> 'L' as l;   -- 3, 1 (2, 1 before O9)
   select to_regprocedure('public.study_sheet_create(uuid,jsonb)') is not null as sheet_create,
          to_regprocedure('public.study_sheet_room(uuid)') is not null as room,
          to_regprocedure('study_private.q_plain(text,text)') is not null as pickers;  -- true, true, true
   select kind, count(*) from public.study_exams group by kind;                        -- every existing upload: exam
   select name, enabled from study_private.features where name in ('exams', 'sheets') order by name;  -- exams as before; sheets false
   ```
   If I, R or L were missing before this step, also follow
   [`RELEASE-R1.md`](RELEASE-R1.md) and [`RELEASE-L1.md`](RELEASE-L1.md) for
   their own flags later; none of them is needed for sheets. O 2 is in, but
   nothing of it shows or spends until release A1's flag (below).
4. **Vercel → Settings → Environment Variables → Production only:**
   `STUDY_SHEETS_MONTHLY_USD` = `6` (unset is 6) and `STUDY_MONTHLY_USD` =
   `33` (if step 1 found it unset). Never on Preview: Preview shares the
   production database.
5. **The switches** (SQL Editor):
   ```sql
   update study_private.features set enabled = true, changed_at = now() where name in ('exams', 'sheets');
   ```
6. **Vercel → Production only:** `VITE_STUDY_SHEETS` = `1`. It needs
   `VITE_STUDY_COURSES`, `VITE_STUDY_EXAMS` and `VITE_STUDY_PRACTICE` = `1`
   (check they are there; if `VITE_STUDY_EXAMS` was not, the members get past
   exams with this release too). Redeploy Production (Deployments → the
   latest → Redeploy).
7. **Check, without spending:**
   - `/api/study/health`: `"schemaOk": true` (it now asks for `O: 1`),
     `"schema"` has `"O": 1`, `"features"` has `"sheets": true`.
   - In the app, a course's page: the segment "מבחנים ותרגילים" and
     "העלאת מבחן או דף תרגילים"; Help → "מבחנים ותרגילים" has the two lines
     (only course-staff or the group's own material; the pages are read by
     the AI services the app uses).
   - Open the upload, choose a short PDF of the group's own: "מה זה?" and the
     price on the button show **before** anything is sent. Leave with "→
     לקורס" (nothing is uploaded or spent).
   - On a computer or an iPad, an existing past exam's review is two
     columns (the text on the right, the page on the left).
8. **The first real sheet (spends about $0.05 a page, from the sheets line):**
   one member uploads one short exercise sheet of the course staff's (a few
   pages, answers marked or in a file). Within about 10 minutes it is in
   "דפי תרגילים" with its questions; open questions and calculations are
   counted, not copied (release A1 copies them). Then, read only:
   ```sql
   select e.kind, e.status, e.n_questions, e.skipped_open, round(sum(j.cost_usd), 2) as usd
     from public.study_exams e join study_private.exam_jobs j on j.exam_id = e.id
    where e.kind = 'sheet' group by e.id order by e.created_at desc limit 3;
   ```
   Send Claude the row and, if any copy reads wrong, its item numbers.
9. **WhatsApp to the group (optional):**
   > חדש בתמצית: בעמוד הקורס, ״מבחנים ותרגילים״ ← ״העלאת מבחן או דף תרגילים״. מעלים דף תרגילים של הקורס (PDF או צילום), השאלות מועתקות כמו בדף, ותרגול ב״לתרגל כמו בדף״. רק חומר של צוות הקורס או של הקבוצה.

**Rolling back release A0:** the switch `sheets` off stops new sheets at
once; hiding every sheet and unsetting the flag are below ("Rolling back").
Part 11's columns and functions (and the pickers' `q_plain` in parts 2 to 7) stay: they are harmless to the old code.

## Before anything: two checks (read only)

In Supabase → SQL Editor. Each query only reads; send Claude the results.

**1. Is past exams' switch on?** (OD1; sheets need it.)

```sql
select name, enabled, changed_at from study_private.features
 where name in ('courses', 'exams', 'sheets') order by name;
select public.study_schema() ->> 'S' as s, public.study_schema() ->> 'O' as o;
```

Expected now: `courses` true; `exams` true or false (if false, the members
have no past exams yet: release point 2 turns it on with `sheets`, or both
stay off); no `sheets` row and `o` null until release point 1.

**2. The monthly line and last two months' spend by kind** (OD2). In Vercel →
Settings → Environment Variables (Production), `STUDY_MONTHLY_USD` should be
`33` (unset is 40). Then:

```sql
select to_char(date_trunc('month', created_at at time zone 'Asia/Jerusalem'), 'YYYY-MM') as month, kind,
       count(*) as calls, round(sum(cost_usd), 2) as usd
  from public.study_usage
 where created_at >= date '2026-10-01'
 group by 1, 2 order by 1 desc, 4 desc;
```

The sheets and similar lines assume the rest of a month stays under about
$15; if it is above, tell Claude and the two lines go down.

**3. (Optional, for the unit sizes of release A1)** the model's output speed
from the ledger: the query in [`sheets.md`](sheets.md) ("How long a unit
takes"). Send Claude the rows.

## Release point 1: the SQL (sections O 1 and O 2; no change in the app yet)

1. **Supabase → SQL Editor: run `supabase/parts/1.sql` to `12.sql` in order** (from an older `dev`: `2.sql` to `11.sql`),
   each to the end (safe to run again). Part 11 is section O (O 1, and O 2:
   the sheet reader's SQL, dark until release A1); parts 2, 3, 5 and 7 carry
   O 2's in-place edits of the pickers; parts 9 and 10 are I, R and L, which
   O follows. Then check, read only:
   ```sql
   select public.study_schema() -> 'O' as o, public.study_schema() -> 'L' as l;   -- 3, 1 (2, 1 before O9)
   select name, enabled from study_private.features where name in ('exams', 'sheets') order by name;  -- exams as before; sheets false
   select column_name, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'study_exams' and column_name in ('kind', 'lecture_id') order by 1;
   -- kind 'exam'::text; lecture_id (no default)
   select kind, count(*) from public.study_exams group by kind;                    -- every existing upload: exam
   ```
2. **Check the app is unchanged:** open it; the course page and past exams (if
   on) work as before. `https://<the app's address>/api/study/health` still
   says `"schemaOk": true`.

**Rolling back release point 1:** nothing to undo for the app (the new
columns default to a past exam, and the switch `sheets` is off). O 1's
redefinitions of section S's functions only filter by the new kind, which is
`exam` for every existing upload. O 2's redefinitions (the exam queue's claim,
advance, printed count and "no key") keep a past exam's units exactly as
before (reader `exam`, solve units of 20); its widened checks only allow
more, and the pickers' `q_plain` is true for every existing question.
Two things change for any upload once O 2 is in: a unit the budget refused
on a **sheet** keeps the sheet "reading" (error `budget`) instead of
finishing it without answers, and a sheet's units stop at once when the
switch `sheets` goes off.

## Release point 2: sheets in the app (release A0)

Built and tested on `dev` (O2-O4; the steps in one go are "Release A0,
start to finish" above). Spends only when a
member uploads: a sheet is read like a past exam (about $0.05 a page), and
never past the sheets line ($6 a month) or the room under the 80% line.

1. **Parts 1 to 12 again** (2 to 11 before O9) if release point 1 ran from an older `dev` (part
   10 then held O 1, without `study_sheet_room`). Check, read only:
   ```sql
   select public.study_schema() -> 'O' as o;                                        -- 2, or 3 from O9's dev
   select to_regprocedure('public.study_sheet_room(uuid)') is not null as room;     -- true
   ```
2. **Vercel → Settings → Environment Variables (Production):** `STUDY_SHEETS_MONTHLY_USD`
   = `6` (unset is 6; the line in dollars), and `STUDY_MONTHLY_USD` = `33` if
   check 2 above found it unset.
3. **The switches** (SQL Editor; `exams` too if check 1 found it off):
   ```sql
   update study_private.features set enabled = true, changed_at = now() where name in ('exams', 'sheets');
   ```
4. **Vercel:** `VITE_STUDY_SHEETS=1` on **Production only** (with
   `VITE_STUDY_EXAMS`, `VITE_STUDY_COURSES` and `VITE_STUDY_PRACTICE`, which
   it needs), then redeploy.
5. **Check:** `https://<the app's address>/api/study/health` says
   `"schemaOk": true`. In the app, a course's page has the segment "מבחנים
   ותרגילים" and "העלאת מבחן או דף תרגילים"; uploading a short PDF of the
   group's own shows the price on the button before anything is sent.

**Rolling back release point 2:** the switch `sheets` off (below) stops new
sheets at once; unset `VITE_STUDY_SHEETS` and redeploy to hide the screens.
A build without the flag never lists a sheet, and a simulation never takes
one, whatever the flag.

## Release A1, start to finish (release point 3: open and numeric questions)

Built and tested on `dev`: the SQL (O5: section O 2 in part 11, with the
pickers' edits in parts 2, 3, 5 and 7), the server's sheet reader (O6) and
the client (O7, `VITE_STUDY_SHEETS_FORMS`), with its e2e (O8:
`e2e/study/sheets-forms.cjs` on the mock, flag set `o`). What members get:
an exercise sheet copied exactly as printed, open questions, calculations,
multi-part questions and tables included; answering a calculation (checked at
$0) and an open question (self-marked, personal); "⋯ עוד" in the review to
fix a question, its figure or its answer, add a missed one or take one out;
"להעתיק גם N שאלות פתוחות" on past exams; a sheet the budget stopped can go
on or finish; the lecture page lists its sheets ([`sheets.md`](sheets.md),
"Release A1 in the app"). It comes after release A0 (above). Nothing here
spends money until step 7. Do them in order; each says what to see.

1. **The read-only check** "2. The monthly line and last two months' spend
   by kind" below (OD2), if it was not sent since release A0. Send Claude the
   rows. If the spend without sheets is above about $15 a month, stop here:
   the sheets line goes down first. Optional: query 3 (the model's speed).
2. **Merge `dev` into `main`** and let Vercel deploy Production. The new flag
   is off, so the app does not change.
   `https://<the app's address>/api/study/health` says `"schemaOk": true`.
3. **The SQL, only if needed.** Supabase → SQL Editor, read only:
   ```sql
   select public.study_schema() ->> 'O' as o;                                                   -- 2 or 3
   ```
   If it says `2` or `3`, the SQL is in already (release A0's run from this
   `dev` has O 2, and from O9's O 3): go on to step 4. If it says `1` or
   nothing: run **`supabase/parts/1.sql`, `2.sql`, … `12.sql` in order**,
   each to the end (part 11 alone stops at once with "section O 2 needs parts
   2 to 9 run first"; nothing is half done). Then, read only:
   ```sql
   select public.study_schema() ->> 'O' as o;                                                   -- 3 (2 before O9)
   select conname, pg_get_constraintdef(oid) like '%numeric%' as widened from pg_constraint
    where conname = 'study_questions_form_x' and conrelid = 'public.study_questions'::regclass;  -- true
   select count(*) as rows_not_plain from public.study_questions
    where not study_private.q_plain(source, form);                                              -- 0 before any sheet is read by the sheet reader
   select name, enabled from study_private.features where name in ('exams', 'sheets') order by name;  -- both true since release A0
   ```
4. **Vercel → Settings → Environment Variables → Production only:**
   `VITE_STUDY_SHEETS_FORMS` = `1` (it needs `VITE_STUDY_SHEETS`, which
   release A0 set); `STUDY_SHEETS_MONTHLY_USD` = `6` and `STUDY_MONTHLY_USD`
   = `33` stay as release A0 set them. Never on Preview: Preview shares the
   production database. Redeploy Production (Deployments → the latest →
   Redeploy).
5. **Check, without spending:**
   - `/api/study/health`: `"schemaOk": true` (it now asks for `O: 2`),
     `"schema"` has `"O": 2`.
   - Help → "מבחנים ותרגילים" has the two new lines (open and numeric
     answers; "⋯ עוד", open-add and the pause).
   - A lecture's page, under the summary: "דפי תרגילים של ההרצאה" (its
     sheets, or "עוד אין דף תרגילים להרצאה הזו.") and "+ העלאת דף תרגילים".
   - A sheet's review (an existing one, read in release A0): each item's
     card has "⋯ עוד" (do not save anything); at the end "+ להוסיף שאלה
     שלא הועתקה".
   - A past exam with skipped open questions: "להעתיק גם N שאלות פתוחות ·
     כ-$…" with its price. Do not press it yet (it spends).
6. **(Optional) the first open-add** on one past exam with skipped open
   questions: press the button; the exam stays usable while they are copied
   (a few minutes); then "הועתקו גם N שאלות פתוחות.".
7. **The first sheet read by the sheet reader (spends about $0.07 a page and
   $0.02 an item solved, from the sheets line):** one member uploads one
   short exercise sheet of the course staff's from a lecture's page ("+
   העלאת דף תרגילים"), with open questions or calculations, answers in a
   file or marked. Within about 10 minutes it is in "דפי תרגילים" with every
   question, open and numeric ones too. Then, read only:
   ```sql
   select q.form, count(*), round(avg(q.exact)::numeric, 2) as exact, count(*) filter (where q.parse_conf = 1) as to_check
     from public.study_questions q join public.study_exams e on e.id = q.exam_id
    where e.kind = 'sheet' and e.created_at > now() - interval '1 day' group by 1;
   select j.kind, j.range ->> 'reader' as reader, j.status, j.error, round(j.cost_usd, 3) as usd
     from study_private.exam_jobs j join public.study_exams e on e.id = j.exam_id
    where e.kind = 'sheet' and e.created_at > now() - interval '1 day' order by j.created_at;
   ```
   Send Claude the rows (the exactness line, 0.55, and the unit sizes are
   set from them) and, if any copy reads wrong, its labels.
8. **WhatsApp to the group (optional):**
   > חדש בתמצית: דפי תרגילים מועתקים עכשיו כמו בדף, גם שאלות פתוחות, חישובים וטבלאות. בחישוב כותבים מספר ובודקים; בשאלה פתוחה כותבים, ״להראות פתרון״, ומסמנים איך הלך (זה רק אצלך). טעות בהעתקה? ״⋯ עוד״ ← ״לתקן את השאלה״. בעמוד ההרצאה: ״דפי תרגילים של ההרצאה״.

**Stopping A1's spend:** the switch `sheets` off stops a sheet's units at once
(the claim refuses them; a unit already running finishes, at most 200 s). A
unit the budget refuses holds its sheet ("נעצר: נגמר התקציב החודשי") until a
member resumes it within the lines or finishes it without suggested answers.

**Rolling back release A1:** unset `VITE_STUDY_SHEETS_FORMS` and redeploy.
The app is release A0's again: sheets are read by the exam reader, a sheet's
open and numeric items stay in the database but are never asked (the client
draws choice items only), and the quiz, the meeting, the boss and Today never
drew them (`q_plain`). The SQL stays (nothing to undo).

## Release point 4 (release B: similar questions) — SQL and server built, the app's part not yet

Built and tested on `dev`: the SQL (O9: section O 3 in **part 12**, with
in-place edits in **part 1** (section F's `kind_on`), **part 7** (section E's
source check, kept when wider) and **part 10** (section L's `kind_on`)) and
the server (O10: the similar job, op `similar`, `/api/study/work
{similar}`). Not built: the app's screens and their flag
`VITE_STUDY_SIMILAR` (O11) and their e2e (O12). So the steps below up to 5
can go now and change nothing members see; step 6 waits for O11. Details:
[`sheets.md`](sheets.md) ("SQL section O 3", "Similar questions on the
server"). Before: practice sets are released (`study_schema() ->> 'L'` is
`1`, [`RELEASE-L1.md`](RELEASE-L1.md)): a run's questions go into a
practice set.

1. **Read only** (SQL Editor):
   ```sql
   select public.study_schema() ->> 'O' as o, public.study_schema() ->> 'L' as l;   -- 2 (or 3), 1
   select name, enabled from study_private.features where name in ('exams', 'sheets', 'similar') order by name;
   ```
   And the month's spend by kind (OD2's query, "Before anything" above): the
   similar line ($5) assumes the month's spend without sheets and similar
   questions stays under about $15.
2. **Merge `dev` into `main`** and let Vercel deploy Production (nothing
   changes: the switch `similar` is off once the SQL runs, and no screen asks
   for it). `/api/study/health` says `"schemaOk": true`.
3. **The SQL: parts 1 to 12**, exactly: **`supabase/parts/1.sql`, `2.sql`, …
   `12.sql` in order**, each to the end (safe to run again; part 12 alone
   stops at once with "section O 3 needs part 11 run first"). Part 1 carries
   `kind_on`'s line for the kind `similar`, part 7 section E's source check
   (replaced only while it lacks `member`, so a later run keeps O 3's wider
   one), part 10 L's `kind_on` (the same text as part 1's), part 12 O 3 (the
   twins' columns and checks, the runs, the jobs, the switch `similar` off,
   the cron job `study-similar-dispatch`, R's kind `similar_ready`). Then,
   read only:
   ```sql
   select public.study_schema() ->> 'O' as o;                                               -- 3
   select name, enabled from study_private.features where name = 'similar';                 -- false
   select jobname, schedule from cron.job where jobname = 'study-similar-dispatch';         -- one row, * * * * *
   select pg_get_constraintdef(oid) like '%twin%' as twin from pg_constraint
    where conname = 'study_questions_source_check' and conrelid = 'public.study_questions'::regclass;  -- true
   ```
4. **Vercel → Settings → Environment Variables → Production only:**
   `STUDY_SIMILAR_MONTHLY_USD` = `5` (the code's default is 5 too; set it so
   the line is visible), then redeploy. `/api/study/health`: `"schemaOk":
   true`, `features.similar` false.
5. **The switch on** (SQL Editor), only when step 6 is ready to follow:
   ```sql
   update study_private.features set enabled = true, changed_at = now() where name = 'similar';
   ```
6. **Not yet:** `VITE_STUDY_SIMILAR` = `1` (Production only) and a redeploy,
   once O11's screens are built: "ליצור 2 כמוה" after a wrong answer and
   "שאלות דומות לכל הדף" at the end of a sheet.

**What it spends:** only on a member's tap, reserved whole under that member
before it starts (2 similar questions of an item: about $0.07, at most about
$0.19 held; a whole sheet of 14 questions: about $0.47, at most about $1.2
held), never past the member's 40%, 10 taps a day, or the similar line ($5 a
month), and charged call by call; what a run did not use is let go when it
ends. Watch it, read only:
```sql
select (created_at at time zone 'Asia/Jerusalem')::date as day, ref, count(*) as rows, round(sum(cost_usd), 2) as usd
  from public.study_usage where kind = 'similar' and created_at >= date_trunc('month', now())
 group by 1, 2 order by 1 desc, 2;                                   -- ref ask: open reservations (0 once a run ends); ref unit: the calls
select scope, status, count(*) as runs, sum(made) as made, sum(dropped) as dropped, round(sum(charged_usd), 2) as usd
  from public.study_similar_runs where created_at >= date_trunc('month', now()) group by 1, 2 order by 1, 2;
```
Many `dropped` against `made` means the checks drop good questions: send
Claude the rows (the closeness and blind-check rules are tunable).

**Stopping:** the switch off (below). New runs and every reservation of kind
`similar` stop at once, and so do the jobs' claims; the sweeper then stops
the runs that wait (`stopped`) and lets their reservations go. A call
already running ends within 200 s.

**Rolling back release B:** the switch off; then (once it exists) unset
`VITE_STUDY_SIMILAR` and redeploy. Similar questions already made stay in
their sheet's practice set; the SQL stays (its widened checks cannot be
narrowed once twin rows exist).

## Rolling back (switches, seconds, no redeploy)

```sql
-- 0. No new similar questions, and the runs that wait stop (release B):
update study_private.features set enabled = false, changed_at = now() where name = 'similar';
-- 1. No new sheets (the members' sheets stay):
update study_private.features set enabled = false, changed_at = now() where name = 'sheets';
-- 2. Hide every sheet (reversible: set deleted_at back to null for those rows):
update public.study_exams set deleted_at = now() where kind = 'sheet' and deleted_at is null;
-- Back on: the same switch with true.
```

Then, if needed: unset `VITE_STUDY_SHEETS` and redeploy.
