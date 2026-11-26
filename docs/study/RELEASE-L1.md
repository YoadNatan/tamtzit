# תמצית, practice sets (section L at 1): Yoad's steps

"סט חדש", "סט בהכנה", the group's shelf "סטים של הקבוצה", a set's page with
the group's numbers, and the notices about new and solved sets:
[`sets.md`](sets.md). Yoad's choices for it (every set shared, the group's
numbers only from 3 others, $0.04 a question until the calibration, a $12
monthly line for sets, 5 new sets a member a day, the switch
`questions_paid`, auto-keep off) are in
[`DECISIONS-2026-11-26.md`](DECISIONS-2026-11-26.md) ("Practice sets").
Built on `dev`; each release point below works on its own and rolls back on
its own.

## Rules for all of it

- **Production only.** Never put `VITE_STUDY_MAKE` or `VITE_STUDY_SETS` on
  Preview: Preview shares the production database.
- **Order:** the code is merged to `main` and deployed first (the flags are
  off, so nothing changes), then part 10, then `VITE_STUDY_MAKE`, then
  `VITE_STUDY_SETS`. Never `VITE_STUDY_SETS` before part 10: the app would
  report the schema as missing (`"schemaOk": false`).
- **Before:** section R at 2 is installed (part 9, [`RELEASE-R1.md`](RELEASE-R1.md)
  release point 1). Part 9 has not changed for practice sets; R stays at 2.
- **Money:** making a set spends the group's budget (about $0.40 for 10
  questions). The checks below make one small set of 5 (about $0.20).
- Every step can be undone with "Rolling back" below; the switches work in
  seconds, without a redeploy.

## Release point 1: the SQL (no change in the app yet)

1. **Supabase → SQL Editor: run `supabase/parts/10.sql`** (section L, practice
   sets; safe to run again), to the end. NOTICEs are harmless; if one says
   pg_cron is off, sets still work (only the nightly clean-up waits for it).
   Then check, read only:
   ```sql
   select public.study_schema() -> 'L' as l;                                         -- 1
   select public.study_schema() -> 'R' as r;                                         -- 2
   select name, enabled from study_private.features
    where name in ('qsets', 'qsets_auto_keep', 'questions_paid') order by name;      -- true, false, true
   select jobname, schedule from cron.job where jobname = 'study-qsets-clean';       -- 29 3 * * *
   select kind, cat, push from study_private.notice_kinds
    where kind in ('set_shared', 'set_solved') order by kind;                        -- mine true; inapp false
   select study_private.kind_on('practice') as practice, study_private.kind_on('part') as summaries;  -- true, true
   ```
   Part 1 also changed (it carries `kind_on`'s new text, so a later re-run
   keeps it): it does **not** need to be run now.
2. **Check the app is unchanged:** open it; practice works as before.
   `https://<the app's address>/api/study/health` still says
   `"schemaOk": true`.

**Rolling back release point 1:** nothing to undo for the app. To stop
everything section L adds: `qsets` off (below). Its tables can stay.

## Release point 2: "סט חדש" (the new generator, no sharing yet)

3. **Vercel → Settings → Environment Variables → Production only:**
   `VITE_STUDY_MAKE` = `1`. (`STUDY_SETS_MONTHLY_USD` is not needed: unset is
   $12.) Redeploy Production (Deployments → the latest → Redeploy).
4. **Check** (on a phone, as yourself):
   - A lecture page, under the summary: "סט חדש" and "לפתור" (or "תרגול על
     ההרצאה"). The library's cards show "+ סט". Today's card "תרגול" has
     "סט חדש".
   - "סט חדש" opens one screen: the lecture, "כמה שאלות" (5 · 10 · 20), a
     preview with the question types and "אחרי הסט: p% מההרצאה מכוסים
     בבנק", and the button "ליצור 10 שאלות · כ-$0.40".
   - Choose **5** and tap "ליצור 5 שאלות · כ-$0.20" (this spends about
     $0.20): "סט בהכנה" shows a ring and "… מוכנות · עוד … בדרך"; within
     about a minute "להתחיל לפתור" starts the questions.

**Rolling back release point 2:** unset `VITE_STUDY_MAKE` and redeploy: the
old generator is back (it stays one release, OD22).

## Release point 3: sets and sharing

5. **Vercel → Production only:** `VITE_STUDY_SETS` = `1`. Redeploy Production.
6. **Check:**
   - `/api/study/health`: `"schemaOk": true` (it now asks for section L 1).
   - The questions of step 4 were made before sets were on, so they are in
     the bank but in no set. Make one more small set (5 questions, about
     $0.20): "ליצור" opens its page, `?v=sets&k=…`, and the practice hub
     (Today → "תרגול מהבנק", or the card) shows it under "סטים של הקבוצה".
   - Its page once ready: "מאת {your name}", "פותרים: 0", "לפתור",
     "לשלוח קישור", and the menu ⋯ ("לשנות שם", "להסתיר אצלי", "למחוק את
     הסט").
   - Ask one member (in WhatsApp) to open the app: Today shows "סטים חדשים
     בקבוצה (1) ‹", and the bell has "סט תרגול חדש בקבוצה" (with
     notifications on). After they solve it, your bell has "הסט ״…״ נפתר
     פעם אחת".
   - The group's numbers stay hidden until 3 other members finished a set
     ("הממוצע והתוצאות לפי שאלה מופיעים מ-3 פותרים נוספים").
7. **WhatsApp to the group (optional):**
   > חדש בתמצית: ״סט חדש״ יוצר שאלות על הרצאה בשתי לחיצות, וכל סט משותף עם הקבוצה ב״סטים של הקבוצה״. הציונים נשארים אישיים; ממוצע הקבוצה מופיע רק אחרי ש-3 פתרו.

**Rolling back release point 3:** unset `VITE_STUDY_SETS` and redeploy
(sets leave the app; "סט חדש" stays, without sharing). Faster, without a
redeploy: `qsets` off (below) empties the shelf, and making a set is refused.

## Later, once (read only)

- **The price's calibration** (OD11), after about a month of writing: the
  query in [`sets.md`](sets.md) ("What a set costs"), in the SQL Editor. Send
  Claude its one row; the $0.04 becomes the measured rate.
- **The month's spend by kind**, before changing the $12 line: in
  `sets.md` ("The owner's snippets").
- **Auto-keep** stays off until two weeks of measurement (OD15).

## Rolling back (switches, seconds, no redeploy)

```sql
-- 1. Stop all question spending (practice, solver, reword, style, points, bank):
update study_private.features set enabled = false, changed_at = now() where name = 'questions_paid';
-- 2. Sets off (the shelf empties, making a set is refused; questions stay in the bank):
update study_private.features set enabled = false, changed_at = now() where name = 'qsets';
-- 3. New sets in the inbox only, never pushed (run it again after any re-run
--    of part 9: R's registry insert turns push back on):
update study_private.notice_kinds set push = false where kind = 'set_shared';
-- Each back on: the same with true.
```

Then, if needed: unset `VITE_STUDY_SETS` and/or `VITE_STUDY_MAKE` and
redeploy. Only if sets ever fail a keep (their trigger is written never to):
`alter table public.study_questions disable trigger study_qset_items_from_bank;`.
Section L's tables and the column `study_answers.set_attempt` can stay: they
are unused without the flags.
