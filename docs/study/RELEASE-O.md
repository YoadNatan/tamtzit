# תמצית, uploaded sheets (section O): Yoad's steps

Uploading a past exam or an exercise sheet ("דף תרגילים") and getting its
questions exactly as printed, then (later slices) open and numeric questions
and similar questions: [`sheets.md`](sheets.md). Yoad's choices for it (sheets
$6 a month, similar questions $5, other providers may see this material, one
practice set per sheet, simulations of past exams only) are in
[`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md) ("Uploaded sheets").
Built on `dev`; each release point below works on its own and rolls back on
its own. Release points not built yet are marked so.

## Rules for all of it

- **Production only.** Never put `VITE_STUDY_SHEETS` (or the later
  `VITE_STUDY_SHEETS_FORMS`, `VITE_STUDY_SIMILAR`) on Preview: Preview shares
  the production database.
- **Order:** the code is merged to `main` and deployed first (the flags are
  off, so nothing changes), then the SQL, then the flag. Never the flag before
  the SQL: the app would report the schema as missing (`"schemaOk": false`).
- **Before:** sections R and L are installed (part 9, then part 10:
  [`RELEASE-R1.md`](RELEASE-R1.md), [`RELEASE-L1.md`](RELEASE-L1.md)). If
  they are not, they come with this release's run: parts 2 to 11, in order
  (part 9 holds I and R, part 10 L, part 11 O). That is exactly what the
  tests ran on a copy of production's current schema (`eed179e`).
- **Since O5 (26 Nov 2026) section O starts part 11** and its version 2 (the
  sheet reader's SQL, dark until release A1's flag) edits sections Q, Z, M, H
  and T in place (parts 2, 3, 5 and 7): every SQL step below runs **parts 2 to
  11 in order**, each to the end. Part 11 alone stops at once with "section O
  2 needs parts 2 to 9 run first" (nothing is half done: run parts 2 to 11).
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
3. **The SQL: parts 2 to 11.** In Supabase → SQL Editor, first read only:
   ```sql
   select public.study_schema() ->> 'I' as i, public.study_schema() ->> 'R' as r,
          public.study_schema() ->> 'L' as l, public.study_schema() ->> 'O' as o;
   ```
   Whatever it says (production at `eed179e` has none of I, R, L, O): run
   **`supabase/parts/2.sql`, `3.sql`, … `11.sql` in order**, each to the end.
   Parts 2, 3, 5 and 7 carry O 2's edits of the pickers (the quiz, the
   meeting's quiz, the boss and Today draw only choice questions), part 9 I
   and R, part 10 L, part 11 O (O 1 and O 2). Part 1 needs no re-run (only its
   header changed). This is the order the tests ran, twice over, on a copy of
   production's schema. NOTICEs are harmless. Then, read only:
   ```sql
   select public.study_schema() ->> 'O' as o, public.study_schema() ->> 'L' as l;   -- 2, 1
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

1. **Supabase → SQL Editor: run `supabase/parts/2.sql` to `11.sql` in order**,
   each to the end (safe to run again). Part 11 is section O (O 1, and O 2:
   the sheet reader's SQL, dark until release A1); parts 2, 3, 5 and 7 carry
   O 2's in-place edits of the pickers; parts 9 and 10 are I, R and L, which
   O follows. Then check, read only:
   ```sql
   select public.study_schema() -> 'O' as o, public.study_schema() -> 'L' as l;   -- 2, 1
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

1. **Parts 2 to 11 again** if release point 1 ran from an older `dev` (part
   10 then held O 1, without `study_sheet_room`). Check, read only:
   ```sql
   select public.study_schema() -> 'O' as o;                                        -- 2
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

## Release point 3 (release A1: open and numeric questions) — the SQL and the server are built, the client is not

Built on `dev` (O5, O6): SQL section O 2 (part 11, with the pickers' edits in
parts 2, 3, 5 and 7) and the server's sheet reader ([`sheets.md`](sheets.md),
"SQL section O 2" and "The sheet reader on the server"). It runs only for a
client that sends `forms: true`, which comes with `VITE_STUDY_SHEETS_FORMS`
(O7, not built yet); until then nothing of it shows or spends. When the
client is built, this point will be:

1. Parts 2 to 11 in order, if release point 1 ran before O 2 was merged
   (`select public.study_schema() ->> 'O';` says `1`). Then, read only:
   ```sql
   select public.study_schema() ->> 'O' as o;                                                   -- 2
   select conname, pg_get_constraintdef(oid) like '%numeric%' as widened from pg_constraint
    where conname = 'study_questions_form_x' and conrelid = 'public.study_questions'::regclass;  -- true
   select count(*) as rows_not_plain from public.study_questions
    where not study_private.q_plain(source, form);                                              -- 0 before any sheet is read by the sheet reader
   ```
2. Vercel (Production only): `VITE_STUDY_SHEETS_FORMS` = `1`, with
   `STUDY_SHEETS_MONTHLY_USD` = `6` and `STUDY_MONTHLY_USD` = `33` as for A0.
   Redeploy. `/api/study/health`: `"schemaOk": true`, `"schema"` has `"O": 2`.
3. The first sheet read by the sheet reader (spends; read only afterwards):
   ```sql
   select q.form, count(*), round(avg(q.exact)::numeric, 2) as exact, count(*) filter (where q.parse_conf = 1) as to_check
     from public.study_questions q join public.study_exams e on e.id = q.exam_id
    where e.kind = 'sheet' and e.created_at > now() - interval '1 day' group by 1;
   select j.kind, j.range ->> 'reader' as reader, j.status, j.error, round(j.cost_usd, 3) as usd
     from study_private.exam_jobs j join public.study_exams e on e.id = j.exam_id
    where e.kind = 'sheet' and e.created_at > now() - interval '1 day' order by j.created_at;
   ```
   Send Claude the rows (the exactness line, 0.55, and the unit sizes are
   set from them).

**Stopping A1's spend:** the switch `sheets` off stops a sheet's units at once
(the claim refuses them; a unit already running finishes, at most 200 s). A
unit the budget refuses holds its sheet ("נעצר: נגמר התקציב החודשי") until a
member resumes it within the lines.

## Release point 4 (release B: similar questions) — not built yet

B (`VITE_STUDY_SIMILAR`, SQL O 3, after L) will list exactly which parts to
run: its SQL edits sections E and F in place, so it runs more than part 11.

## Rolling back (switches, seconds, no redeploy)

```sql
-- 1. No new sheets (the members' sheets stay):
update study_private.features set enabled = false, changed_at = now() where name = 'sheets';
-- 2. Hide every sheet (reversible: set deleted_at back to null for those rows):
update public.study_exams set deleted_at = now() where kind = 'sheet' and deleted_at is null;
-- Back on: the same switch with true.
```

Then, if needed: unset `VITE_STUDY_SHEETS` and redeploy.
