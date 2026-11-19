# Writing a summary on the server, sharing and printing it (package W)

How the study app writes a lecture's summary once its slides are saved, so the phone may close, and how a summary leaves the app. Built as the spec's milestones W1 (server writing, device printing) and W2 (the hardening of §3.7). They ship as two pull requests: W1 is release 2 (branch `study/rel2-w`, W1 on top of release 1; Yoad's steps in [`RELEASE-2-W.md`](RELEASE-2-W.md)), live since release 2; W2 is the branch `study/w3-w2`, on top of `main` with W1 live (Yoad's steps in [`RELEASE-W2.md`](RELEASE-W2.md)). The PDF made on the server (W3), recordings (W4) and phone transcription (W5) come later. The setup, in order, is the README's study section, step 6.

## W2, the hardening

- **Parts and a lecture's writing state change only through the writer's functions** (spec §3.7, the end of section W). Members lose insert, update and delete on `study_sections` and update on a lecture's writing columns (status, outline, error); they keep renaming a lecture (title, lecturer, course, date). A member inserts a lecture only with the nine columns the upload sends (review W-R1: a forged restart count of -1000000 lifted the limit of three restarts a day). Section W records version 2, and the server code needs it (`REQUIRED_SCHEMA`'s W is 2): until the SQL has run, `/api/study/health` says `schemaOk: false` and writing answers 503 "schema". The app's own requirement stays W 1: the browser never wrote a part.
- **A restart counts once.** `study_queue` locks the lecture's row and counts a tap of "המשך כתיבה" only when it finds something to start over. Phones tapping the same failed part at once restart it once and spend one of the day's three restarts. A part started over and not yet claimed (failed, no attempts, a retry time) reads "ממתין לתורו" and offers no button.
- **Deleting cancels the writing.** The server plans and claims nothing of a deleted lecture; the phone's run stops at the first part the device path refuses ("lecture not found"); the reader says why, marks each unwritten part "נעצר" ("הכתיבה נעצרה: ההרצאה נמחקה."), and offers nothing until "שחזור".
- **Checked** by `supabase/tests/study.sql` (H1-H4, M6r, M6s), `supabase/tests/writing-concurrency.sh` (six writers or six taps at once), `npm run test:contract` (the browser's writes against the member's grants), and `e2e/study/writing.cjs` H1-H5 (stuck parts, double dispatch, retries, cancel; the mock refuses any write the grants refuse, 403 42501).

## The flow

```
upload ─► rpc study_queue(lecture, pictures signed 48 h) ─► pg_net POST /api/study/work ─┐
pg_cron, every minute ─► study_private.dispatch() ─► pg_net POST ────────────────────────┤
                                                                                         ▼
 /api/study/work (Node, maxDuration 300): Bearer STUDY_WORKER_KEY → assertSchema → rpc study_claim → 202
 → in waitUntil: study_writing_input → study_reserve → stream Claude, study_progress every ~15 s
   → study_finish / study_outline_done (p_charge settles the reservation) → the next unit is kicked
```

- **Units.** A lecture is written as its outline, then its parts, then (with a recording) each part's notes. The first part is written alone, so it fills the prompt cache; then two at a time per lecture, three per group.
- **The database owns the state** (section W of `supabase/study-schema.sql`): the queue (`study_private.jobs`), leases of 330 s, retry times (1 minute after a timeout; 2^n minutes, at most 30, after a rate limit, an overload, a network error or an empty answer; never by itself after a refusal, the budget or four attempts), and the sweeper. A writer that dies counts as an attempt; after the last one the unit fails as `lost` and the sweeper stops kicking it.
- **Every writer claims first.** `study_claim` hands out one unit under a per-group lock. The server writer (`api/study/work.ts`) calls it with the server key alone; a phone's device path (`api/study/outline.ts`, `api/study/section.ts`) with the member's token and the key. A unit another writer holds answers 409 `busy`, which the phone treats as someone else's part. Without the key the database answers `forbidden`: no member can save text as Claude's, take over a lease, or spend the budget.
- **The text so far** is saved every 15 s while it grows (`study_progress`), so the group sees a part appear; a refused save means the lease was taken over, and the writer stops (`lease_lost`).
- **The ledger.** Before each model call the writer reserves its worst case (`study_reserve`: a refusal ends the unit with its code, and no model is called); `study_finish` and `study_outline_done` settle that reservation with the real cost (`p_charge`), even when the lease was lost. A writer that dies leaves its estimate in the ledger.
- **Pictures.** `study_queue` takes only this lecture's own figure paths, each signed by Storage for that path; the writer also requires the project's own address and reads each link's expiry from its token. A part whose links are expired, about to expire (under 10 minutes), from another host or for another path fails `figures_expired`; "המשך כתיבה" signs fresh ones. On the device path, pictures the queue lacks are signed for 30 minutes.
- **Corrections survive a rewrite.** A part written again gets the group's corrections of its earlier version as one more block at the end of the request (`correctionsForRewrite`), so everything before that block, the cached prefix included, stays the same bytes.
- **Without the server** (no pg_net, pg_cron or `study_site_url`), `study_queue` answers false and the phone writes, as before, through the same claims. A page with the lecture open also writes it when the server has been silent for 3 minutes while work waits.

## On the phone

- `afterUpload` (in `src/study/features/writing.tsx`) queues the lecture once the slides are saved; the saving line says the app may then be closed, on a device that has seen the server write.
- The reader shows, under the title, "הסיכום נכתב בשרת, חלק אחרי חלק…" while the server writes; each waiting part says "ממתין לתורו", "נכתב עכשיו במכשיר אחר…", "נעצר: {סיבה}. ניסיון חוזר אוטומטי בעוד {n} דק׳.", or why it stopped.
- **"המשך כתיבה"** calls `study_queue` on every tap, server or not. When something failed (a part, or the outline) it passes `p_retry_failed: true`: the failed units start over, at most three times a lecture per study day (then "retry limit"). A tap with nothing failed (parts only waiting: a phone slept, another writer was busy) restarts nothing and is not one of the three. With the server on, the toast says "השרת ממשיך לכתוב."; otherwise this phone writes.
- An outline that failed (the budget, too many slides, no slides, three dead writers) shows its reason and "המשך כתיבה". The note under the title shows only while the server still has something to write by itself.
- `generate.ts` skips a `busy` part and looks again after 20 s; the budget, the server key, the schema or a switched-off feature stop the run.

## Sharing and printing

"שיתוף" opens the share sheet (`ShareSheet.tsx`): "קישור לסיכום"; "הדפסה מהמכשיר", which lays the summary out for paper (`PrintDoc.tsx`: a title page, a table of contents, each part on a new page) and prints it with `PRINT_CSS` (`shared/study/print-css.ts`); and, with `VITE_STUDY_PDF` once W3 ships, "קובץ PDF", which sends the same layout to `/api/study/pdf`. Both wait until every part is written. A downloaded PDF whose name is not plain ASCII is saved as `tamtzit-<date>.pdf` (Chromium names a Hebrew download "download").

## Where things are

| What | File |
|---|---|
| Section W of the SQL, its checks | `supabase/study-schema.sql`, `supabase/tests/study.sql` (between the W markers) |
| The server writer | `api/study/work.ts` |
| The device path | `api/study/outline.ts`, `api/study/section.ts` |
| The writer both use | `server/study/writer.ts` |
| Recording notes (inert until W4 and the switch `recordings`) | `server/study/notes.ts`, `server/study/prompts/recording.ts` |
| The phone's side | `src/study/features/writing.tsx`, `src/study/lib/writing.ts`, `src/study/lib/generate.ts` |
| Sharing and printing | `src/study/components/ShareSheet.tsx`, `PrintDoc.tsx`, `src/study/lib/pdf-export.ts`, `shared/study/print-css.ts` |
| Tests | `server/study/work.test.ts`, `server/study/section.test.ts`, `src/study/lib/generate.test.ts`, `supabase/tests/writing-concurrency.sh`, `e2e/study/writing.cjs` with `e2e/study/mocks/writing.cjs` |

## Checking it on production (read-only)

```sql
-- the queue, and what pg_net got back (401: the key on Vercel and in Vault differ)
select * from study_private.jobs;
select id, status_code, error_msg, created from net._http_response order by id desc limit 10;
-- a lecture's parts
select idx, status, error, attempts, retry_at, writer, lease_until from public.study_sections where lecture_id = '<id>' order by idx;
-- reservations that never settled this month (a writer died, or a settle failed)
select kind, count(*), round(sum(cost_usd), 2) from public.study_usage
 where settled_at is null and created_at >= date_trunc('month', now()) and created_at < now() - interval '15 minutes' group by 1;
```
