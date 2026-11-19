# תמצית, W2: the hardening of server writing

W2 is milestone W2 of the build spec (`spec/spec-final.md` §3.7; addendum
§12.3.W, wave 3), on the branch `study/w3-w2`, on top of `main` with W1
live (release 2). It takes away members' direct writes to summary parts and
to a lecture's writing state: from now on only the writer's functions (with
the server key) and, once they ship, corrections change a part. Corrections
(`VITE_STUDY_CORRECTIONS`) wait for it. This page is Yoad's production steps,
in order. Details: [`writing.md`](writing.md), "W2, the hardening".

## What is in it

- **The hardening** (the end of section W): members can no longer insert,
  change or delete a part, or change a lecture's status, outline or error.
  Renaming a lecture (title, lecturer, course, date) still works. A new
  lecture is inserted only with the nine columns the upload sends (review
  W-R1). Section W goes to version 2.
- **"המשך כתיבה" counts once.** Several phones tapping the same stopped
  part at the same moment start it over once and use one of the day's three
  restarts. The part then reads "ממתין לתורו" until a writer takes it.
- **Deleting a lecture stops its writing**, on the server and on a phone
  that was writing it; the reader says why. After "שחזור", "המשך כתיבה"
  writes the rest.
- **Help and privacy**: "כשמשהו נתקע" and the Supabase line say the above.
- **No flags, no Vercel variable, no Vault secret.** The server code needs
  section W at version 2: until the SQL has run, `/api/study/health` says
  `"schemaOk": false` and writing answers 503 "schema". So the SQL goes
  first.

## Before you start

W1 is live and has written a lecture (`RELEASE-2-W.md`, "W2 comes later"):

```sql
select count(*) from public.study_usage u join public.study_lectures l on l.id = u.lecture_id
 where u.user_id is null and u.kind = 'part' and u.settled_at is not null and u.created_at >= l.queued_at;
```

It must be above 0. Never create a group: the group exists.

## The steps, in order

### 1. Supabase: run the SQL, before the merge

SQL Editor → paste **the whole** `supabase/study-schema.sql` **from the branch
`study/w3-w2`** → Run. The file can be run again safely. NOTICEs like
"… already exists, skipping" are harmless.

Check the registry:

```sql
select public.study_schema();
```

It must answer `{"C": 1, "F": 1, "K": 1, "Q": 2, "W": 2, "Z": 2}` (only W
changes, from 1 to 2).

Check the hardening (both must say `false`):

```sql
select has_table_privilege('authenticated', 'public.study_sections', 'UPDATE') as part_update,
       has_column_privilege('authenticated', 'public.study_lectures', 'status', 'UPDATE') as status_update;
```

From this moment until the merge, the live app keeps working: its browser
code never wrote a part (the server functions did, with the server key), and
its upload sends exactly the nine columns still allowed.

### 2. Merge, which deploys

Merge `study/w3-w2` into `main`. Vercel deploys it.

### 3. Check the deploy

`https://tamtzit.vercel.app/api/study/health` must answer
`"schemaOk":true` and `"workerOk":true`. Then open a lecture whose summary is
written: it reads as before.

Nothing else: no flag to set.

## If something goes wrong

- `schemaOk:false` after the merge: step 1 did not run on this project, or
  stopped half-way. Run the whole file again, then reload health.
- To undo the merge, revert it on GitHub: the old code works with the
  hardened database (it never wrote a part with a member's token). The SQL
  stays; there is nothing to undo in it.

## Test results on this branch

| Test | Result |
|---|---|
| `npm run test:study` | 525 tests, 525 pass, 0 fail |
| `npm run test:contract` | 88 RPC calls and 77 table chains in 138 files match the schema (138 study functions, 32 study tables); 16 of the browser's written columns are granted to a member |
| `npm run build` | passes; the study entry 304.40 kB with no flags (limit 400 kB) |
| `npm run test:bundle` | the study entry 315,284 bytes with every flag on; no package screen in it (W's share 17,973 B, 17,562 B on `main`: over its 8 kB budget before W2 too) |
| The whole SQL twice (stubs, board, `study-schema.sql` × 2) on a throwaway Postgres 16 | 0 errors; `supabase/tests/study.sql` exits 0, 0 FAIL, 0 ERROR; `{"C": 1, "F": 1, "K": 1, "Q": 2, "W": 2, "Z": 2}` |
| The upgrade: `origin/main`'s `study-schema.sql` with its checks' data and a half-written lecture, then this file twice | 0 errors each time; the registry's W goes from 1 to 2; all 65 rows of the 40 tables kept, none changed; of 765 privileges and policies only W2's change (`study_sections`: members read only; `study_lectures`: insert of the upload's nine columns, update of title, lecturer, course, date); after it a member's update or delete of a part, a status change and an insert with a restart count are refused, renaming and the upload pass, and two taps on the failed part spend one restart |
| `supabase/tests/writing-concurrency.sh` | WK1-WK4 as expected (WK2 counts 7 restarts without the row lock: the check catches it) |
| `supabase/tests/quiz-concurrency.sh` | K1, K1b, K2, K3a, K3, K3b, K3c as expected |

The e2e scripts ran on a mocked Supabase with every flag off (`off`), release
1's flags (`rel1`, production's), release 2's (`rel2`, with the quiz), and
`writing.cjs` also with every flag (`all`, `notoday`). Every script exited 0
with no page error, no unmocked or refused call, and no accessibility
problem (light and dark, 390×844 and 360×640): `summary`, `together`,
`upload`, `shell`, `writing` (41 steps; 47 with every flag), `cards`,
`practice`, `quiz`.
