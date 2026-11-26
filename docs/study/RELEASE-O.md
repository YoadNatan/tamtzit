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
  they are not, run part 9 and then part 10 now: part 10 holds L and O, and
  running both is exactly what the tests ran on a copy of production's
  current schema.
- **Money:** release point 1 spends nothing. Reading a sheet spends the
  group's budget like a past exam (about $0.05 a page), within the sheets line
  ($6 a month) from release point 2.

## Release A0, start to finish (the exact steps)

Release A0 is release points 1 and 2 below in one go: uploading a past exam
or an exercise sheet, its questions copied by the exam reader, the course
page by kind, the wide review, keying by hand. It was tested on `dev` (O4):
`e2e/study/sheets.cjs` and `devices.cjs` / `wide.cjs` on the mock, and the
SQL on a copy of production's schema (`eed179e`) with parts 9 and 10 run
twice ([`sheets.md`](sheets.md), "The A0 e2e"). Nothing here spends money
until step 8. Do them in order; each says what to see.

1. **The two read-only checks** below ("Before anything"): is `exams` on
   (OD1), and the month's spend by kind (OD2). Send Claude the rows. If the
   spend without sheets is above about $15 a month, stop here: the sheets
   line goes down first.
2. **Merge `dev` into `main`** and let Vercel deploy Production. Every new
   flag is off, so the app does not change. Check
   `https://<the app's address>/api/study/health` says `"schemaOk": true`.
3. **Which parts to run.** In Supabase → SQL Editor, read only:
   ```sql
   select public.study_schema() ->> 'I' as i, public.study_schema() ->> 'R' as r,
          public.study_schema() ->> 'L' as l, public.study_schema() ->> 'O' as o;
   ```
   - `i`, `r` or `l` empty (production at `eed179e` has none of them): run
     **`supabase/parts/9.sql`** to the end, then **`supabase/parts/10.sql`**
     to the end. This is the order the tests ran; parts 1 to 8 need no
     re-run for O (their only changes are the parts' headers and comments,
     and `kind_on`'s text, which part 10 sets too).
   - `i` 1, `r` 2 and `l` 1 already: run **`supabase/parts/10.sql`** only
     (section O 1 is in it, after L).
   NOTICEs are harmless. Then, read only:
   ```sql
   select public.study_schema() ->> 'O' as o, public.study_schema() ->> 'L' as l;   -- 1, 1
   select to_regprocedure('public.study_sheet_create(uuid,jsonb)') is not null as sheet_create,
          to_regprocedure('public.study_sheet_room(uuid)') is not null as room;      -- true, true
   select kind, count(*) from public.study_exams group by kind;                        -- every existing upload: exam
   select name, enabled from study_private.features where name in ('exams', 'sheets') order by name;  -- exams as before; sheets false
   ```
   If part 9 ran in this step, also follow [`RELEASE-R1.md`](RELEASE-R1.md)
   and [`RELEASE-L1.md`](RELEASE-L1.md) for their own flags later; none of
   them is needed for sheets.
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
Part 10's columns and functions stay: they are harmless to the old code.

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

## Release point 1: the SQL (section O 1; no change in the app yet)

1. **Supabase → SQL Editor: run `supabase/parts/10.sql`** to the end (sections
   L and O; safe to run again). Nothing else changed in parts 1 to 9 for O 1.
   Then check, read only:
   ```sql
   select public.study_schema() -> 'O' as o, public.study_schema() -> 'L' as l;   -- 1, 1
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
columns default to a past exam, and the switch `sheets` is off). O 1's three
redefinitions of section S's functions only filter by the new kind, which is
`exam` for every existing upload.

## Release point 2: sheets in the app (release A0)

Built and tested on `dev` (O2-O4; the steps in one go are "Release A0,
start to finish" above). Spends only when a
member uploads: a sheet is read like a past exam (about $0.05 a page), and
never past the sheets line ($6 a month) or the room under the 80% line.

1. **Part 10 again** if release point 1 ran before this was merged: part 10
   gained `study_sheet_room` (the sheets line's figures) inside O 1. Run
   `supabase/parts/10.sql` to the end (safe to run again; parts 1 to 9 are
   unchanged by O 1). Check, read only:
   ```sql
   select public.study_schema() -> 'O' as o;                                        -- 1
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

## Release points 3 and 4 (releases A1 and B) — not built yet

A1 (open and numeric questions, `VITE_STUDY_SHEETS_FORMS`, SQL O 2) and B
(similar questions, `VITE_STUDY_SIMILAR`, SQL O 3, after L) will list exactly
which parts to run: their SQL edits sections outside O (Q, Z, H, M, T, E, F)
in place, so those releases run more than part 10.

## Rolling back (switches, seconds, no redeploy)

```sql
-- 1. No new sheets (the members' sheets stay):
update study_private.features set enabled = false, changed_at = now() where name = 'sheets';
-- 2. Hide every sheet (reversible: set deleted_at back to null for those rows):
update public.study_exams set deleted_at = now() where kind = 'sheet' and deleted_at is null;
-- Back on: the same switch with true.
```

Then, if needed: unset `VITE_STUDY_SHEETS` and redeploy.
