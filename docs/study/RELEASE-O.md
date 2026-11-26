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

## Release point 2: sheets in the app (release A0) — not built yet

The upload, the course page by kind, the wide review and hand keying come in
the next packages (O2-O4). This section will then say: turn on `exams` and
`sheets`, set `VITE_STUDY_SHEETS=1` on Production only, redeploy, and check.

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
