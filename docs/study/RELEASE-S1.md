# תמצית, courses (phase 1 of sources.md): Yoad's steps

Phase 1 of [`sources.md`](sources.md) ("קורסים"): a page for each course,
"העלאה של כמה קבצים" with the price first and a resume list, "לתרגל מה שכבר
יש · בחינם" over a whole course, and "לשאול על כל הקורס". It spends nothing
new on its own: a course question is one of the day's questions, as a
lecture's, and the batch's summaries are the usual summaries. A batch's
summaries that do not fit this month's budget are uploaded but wait for the
1st (the phone that uploaded them hands them to the writer then). Past exams
are phase 2 and stay off.

## What is in it

- **SQL section S at version 1** (part 8 of the SQL Editor's parts):
  `study_courses` with one row per course text of the group's lectures (the
  backfill), the trigger that adds a course when a lecture brings a new one,
  the switch `courses` (on), the course RPCs and `plan_id` on question
  requests. Re-runnable.
- **The server**: op `ask` with `scope: "course"`, the batch's price from the
  ledger, and the round's `planId` (no screen uses it yet).
- **The app**, behind `VITE_STUDY_COURSES`: the course links in the library,
  the course page and its sheet, the batch upload, the course question.

## Steps, in order

1. **The SQL first.** In the Supabase SQL Editor, run `supabase/parts/8.sql`
   (parts 1 to 7 are unchanged; running them again is harmless). It is
   re-runnable: a second run makes no new course.
2. **Check**: `select * from public.study_schema();` lists `"S": 1`, and
   `select name from public.study_courses;` lists the group's courses, one
   for each way a course was written up to case, spaces and the invisible
   direction marks a PDF pastes. (A part 8 run before this version is
   re-keyed in place by the new one: run the new `8.sql` once.)
3. **Merge and deploy** `dev` as usual. Nothing changes on screen yet.
4. **Turn it on**: on Vercel, set `VITE_STUDY_COURSES=1` and redeploy (VITE_
   values are built into the app).
5. **Check** `https://tamtzit-app.vercel.app/api/study/health`: `"schemaOk":
   true` (it asks for S 1 once the flag is on). In the app, the library's
   course names are links.

## Rolling back

Remove `VITE_STUDY_COURSES` and redeploy: the screens go and every link to
them lands on the library, the single upload or the library's question. To
stop the course RPCs and the course question on the server without a
redeploy: `update study_private.features set enabled = false where name =
'courses';` (they answer "עמודי הקורסים כבויים כרגע בשרת."). The SQL stays: it
changes nothing that earlier screens read.
