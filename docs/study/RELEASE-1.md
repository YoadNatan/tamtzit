# תמצית, release 1: practice questions and flashcards

Release 1 puts practice questions and flashcards (with Anki export) on top of
the app the group uses today (summaries, the library, reading together). It is on
the branch `claude/vigilant-johnson-lgk7xy` (built as `study/rel1`). This page is Yoad's production steps, in order, and
how to roll back. It follows the build spec's §9.1 steps 1 and 2
(`spec/spec-final.md`), for this release only.

## Read this first: the server key

From this release on, every call to Claude carries a **server key**, and that
includes writing summaries. The key has to be in two places, with the same
value:

- on Vercel, as the environment variable `STUDY_WORKER_KEY`;
- in Supabase Vault, as the secret `study_worker_key`.

If the variable is missing, a new summary stops with "מפתח השרת עוד לא הוגדר
(STUDY_WORKER_KEY ב-Vercel)." If the Vault secret is missing, shorter than 32
characters, or a different value, every call is refused as `forbidden`, and a
new summary stops with "אין גישה להרצאה הזו מהחשבון הזה." Lectures that are
already written can still be read either way, but nothing new gets written.
So the key (steps 1 to 3) and the SQL (step 4) both come **before** the merge.

## What is in the release

- **The foundation** (packages F0, F1 and F1Δ of the spec): the server key, one
  spend ledger with a reservation before every Claude call, section F of the
  SQL, the schema check and `/api/study/health`, and the app shell. The tabs
  are ספרייה · תרגול · יחד · שלי. "שלי" now has help, the privacy note, the
  members list (the group's creator can replace the invite code and remove a
  member) and "יציאה מהמכשיר הזה". Deleted lectures wait 30 days under
  "נמחקו לאחרונה".
- **Practice questions** (spec §7.Q, milestone Q-1): a lecture's questions are
  written once for the whole group, on a tap of "יצירת שאלות תרגול", with
  their cost shown first. A session asks them in rounds of 10, 20 or all, with
  the options in a new order each time, an explanation for every option, and
  "מצב מבחן" (the explanations wait until the end). The end of a round has
  "סבב נוסף" and "רק הטעויות מהסבב". A flag ("משהו לא בסדר בשאלה?") tells the
  group what is wrong with a question; "להסתיר ממני" hides it from your own
  practice. Answers and scores are private.
- **Flashcards** (spec §7.C): a lecture's deck is written once for the group,
  and the group can fix, add and delete cards, with history. There is
  "עיון בכרטיסיות" (browsing: front, tap, back), and export to Anki as a
  `.apkg` built on the phone, or as a text file.
- **On the server**: the ops of practice questions, cards and K (corrections,
  "לשאול"), and SQL sections Q, C and K. K has no screen in this release.

**Not in this release** (they stay on their branches, or behind flags that
stay off):

- The addendum's ends. Q's end is the bet, the autopsy, two-flag hiding and
  the solver (on `study/q`). C's end is the deck part by part and private
  cards (on `study/c`). Section B is questions and cards written ahead.
- The group quiz, in-app card review (`VITE_STUDY_CARDS_REVIEW`), "הטעויות
  שלי", accounts, corrections, "לשאול", memory aids, progress, marathons, the
  PDF, recordings and past exams.
- **No member can take a question out of practice for everyone.** A bad
  question is flagged, and each member can hide it from their own practice.
  To retire one for the whole group, use the SQL Editor (see "Retiring a
  question" below).

## The steps, in order

The project is the Supabase project `/` already uses
(`VITE_STUDY_SUPABASE_URL` on Vercel if it is set, otherwise the shared one).
Never create a group anywhere: the group exists, and only one can exist.

### 1. Make the server key

On your computer:

```bash
openssl rand -hex 32
```

That prints 64 letters and digits (or use
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
This is the key. Keep it in your password manager, and never put it in a
chat, a commit or an issue.

### 2. Vercel: the key and the cap

Vercel → the project → Settings → Environment Variables → **Production**:

| Name | Value |
|---|---|
| `STUDY_WORKER_KEY` | the key from step 1 |
| `STUDY_MONTHLY_USD` | `33` |

- `ANTHROPIC_API_KEY` stays as it is.
- Don't add any `VITE_STUDY_*` flag yet. That is step 9.
- Preview deployments share the production database. Never set a
  `VITE_STUDY_*` flag on Preview. The spec also puts `STUDY_WORKER_KEY` on
  Preview. Without it, a Preview deployment can still be read but can't
  write summaries.
- Saving the variables doesn't redeploy anything, and today's deployment
  doesn't read them, so nothing changes yet.
- Check that the Anthropic Console's monthly spend limit on the key's
  workspace is at least $10 above 33 (the README explains why).

### 3. Supabase: the same key in Vault

Supabase → SQL Editor, with the key from step 1 between the quotes:

```sql
select vault.create_secret('<the key from step 1>', 'study_worker_key');
```

If it answers that the name already exists (an earlier try), update it
instead:

```sql
select vault.update_secret(id, '<the key from step 1>') from vault.secrets where name = 'study_worker_key';
```

Check (it must say 64):

```sql
select length(decrypted_secret) from vault.decrypted_secrets where name = 'study_worker_key';
```

### 4. Supabase: run the SQL of this release

SQL Editor → paste **the whole** `supabase/study-schema.sql` **from the branch
`claude/vigilant-johnson-lgk7xy`** (https://github.com/YoadNatan/delo-logo-review/blob/claude/vigilant-johnson-lgk7xy/supabase/study-schema.sql, button "Copy raw file") → Run. The file can be run again safely.

- Expected: it finishes without an error. NOTICEs like "… already exists,
  skipping" or "… does not exist, skipping" are harmless. If it prints
  "realtime.messages not found", the project has no Realtime Authorization
  (as today), and follow-the-reader won't connect.
- Check:

  ```sql
  select public.study_schema();
  ```

  It must answer `{"C": 1, "F": 1, "K": 1, "Q": 1}`.
- From this moment until step 5's deploy is live (a few minutes), today's
  "מחיקה" of a lecture fails. Members can no longer delete lecture rows
  directly; the new code deletes through `study_delete_lecture` and keeps the
  lecture for 30 days. Everything else of today's app keeps working.
- What the file does: it adds sections F, Q, C and K (each at version 1) and
  copies what today's parts already spent into the new ledger (once). It
  also revokes `study_retire_question` from members (package Q's review,
  finding Q2).

### 5. Merge

Tell Claude that steps 1 to 4 are done; Claude merges the release into `main`.
Vercel deploys `main` to Production.

### 6. Check `/api/study/health`

Open https://tamtzit.vercel.app/api/study/health once the deploy is
live. It should answer:

```json
{"ok":true,"anthropicKey":true,…,"worker":true,"workerOk":true,"budgetUsd":33,"schema":{"C":1,"F":1,"K":1,"Q":1},"schemaOk":true,…}
```

| If | Then |
|---|---|
| `"schemaOk":false` | The SQL and the code disagree. Run step 4 again (the same file), then reload health. |
| `"worker":false` | `STUDY_WORKER_KEY` isn't set in Production. Do step 2, then Vercel → Deployments → the latest Production deployment → ⋯ → Redeploy. |
| `"worker":true` and `"workerOk":false` | Vault's `study_worker_key` is missing, too short, or not the same value as Vercel's. Do step 3 with the same key as on Vercel. No redeploy is needed. Until this is fixed, new summaries are refused. |
| `"budgetUsd":40` | `STUDY_MONTHLY_USD` is missing. Do step 2, then Redeploy. |

Go on only when `schemaOk` and `workerOk` are both `true`.

### 7. Run the SQL once more

Run the same `supabase/study-schema.sql` again. Parts the
old app wrote between step 4 and the deploy then join the ledger too. A part
is never counted twice.

### 8. Check today's flow

Open `/` and a lecture: the summary shows, and reading together works
as before. "שלי" → עזרה ends with "השימוש של הקבוצה החודש: $… מתוך $33".
Writing a summary is the real test of the key. If you want it, upload a short
lecture into the existing group: it should write as before, for well under
$1. Then delete it; it waits 30 days under "נמחקו לאחרונה".

### 9. Turn on release 1's flags

Vercel → Settings → Environment Variables → **Production**, exactly these
three:

| Name | Value |
|---|---|
| `VITE_STUDY_QUESTIONS` | `1` |
| `VITE_STUDY_PRACTICE` | `1` |
| `VITE_STUDY_CARDS` | `1` |

Then Deployments → the latest Production deployment → ⋯ → **Redeploy**. The
flags are built into the app, so nothing changes until the redeploy.

Set no other `VITE_STUDY_*` variable. `VITE_STUDY_QUIZ`,
`VITE_STUDY_CARDS_REVIEW`, `VITE_STUDY_ACCOUNT` and the rest stay unset, and
nothing on the practice or cards screens leads to them.

### 10. Check release 1

- `/api/study/health` again: `"schemaOk":true`. With the three flags on, the
  app needs F 1, Q 1 and C 1, which step 4 added.
- `/`: the tabs read ספרייה · תרגול · יחד · שלי. A lecture shows the
  chips "תרגול" and "כרטיסיות". "תרגול" lists the lectures, each with
  "יצירה".
- The first round of questions or cards spends from the group's budget (the
  sheet shows the estimate before "ליצור"). After the first one, check in the
  SQL Editor that the ledger settled it:

  ```sql
  select kind, cost_usd, settled_at from public.study_usage
   where kind in ('practice', 'cards') order by created_at desc limit 5;
  ```

  `settled_at` must be filled in. Also check that Vercel's logs show no 400
  from `/api/study/ai` (spec §9.1 step 9: the first live call of each op).

### 11. Ask the group to reopen the app

Ask each member to close the app and open it again (on an iPhone, swipe the
Home Screen app away), so no phone keeps the old code.

## Rolling back

- **Practice and cards only (the usual rollback):** Vercel → Environment
  Variables → delete `VITE_STUDY_QUESTIONS`, `VITE_STUDY_PRACTICE` and
  `VITE_STUDY_CARDS` (or set them to `0`) → Redeploy. The "תרגול" tab and the
  chips disappear; links to them land on the lecture or the library with one
  line saying so. The questions, cards, flags and answers stay in the
  database for when the flags come back. Don't touch the SQL.
- **Summaries fail after the merge:** the cause is the key (step 6's table).
  Fix steps 2 and 3. Don't roll back the SQL.
- **The whole release (last resort):** Vercel → Deployments → the last
  Production deployment before the merge → ⋯ → Promote to Production (instant
  rollback). Today's code works with the new SQL, and it doesn't need the key.
  The one exception is a lecture's "מחיקה", which fails until this release is
  deployed again. Leave `STUDY_WORKER_KEY`, the Vault secret and the SQL in
  place: the next deploy needs them.
- Never drop tables. Never run Supabase's sample clean-up of anonymous users:
  it would delete the group with its creator.

## Retiring a question for everyone

No member can do this in release 1. If a question is wrong, retire it in the
SQL Editor. First find the flagged questions and their ids:

```sql
select q.id, left(q.question, 80) as question, f.reason, f.note
  from public.study_question_flags f join public.study_questions q on q.id = f.question_id
 order by f.created_at desc;
```

Retire one (it leaves every member's practice; the answers stay):

```sql
update public.study_questions set retired_at = now(), retire_note = 'why'
 where id = '<question id>';
```

Put it back with `retired_at = null, retire_note = ''`.

## What was tested (on `study/rel1`; local only)

No production, no real Supabase project and no real Anthropic call were used.

- `npm run test:study`, `npm run test:contract` and `npm run build` pass. The
  study entry chunk is under 400 kB.
- The SQL was loaded twice (stubs, board, `study-schema.sql`) on a throwaway
  Postgres 16 with 0 errors, and `supabase/tests/study.sql` gave 0 FAIL.
- The upgrade was run from today's schema (`main`'s `study-schema.sql` with
  data), then this file twice: 0 errors. The ledger's copy counts each part
  once, including one the old code wrote between the runs. The data is kept.
  The key check answers as `/api/study/health` expects: refused without a
  Vault secret or with another value, accepted with the same one.
- The e2e flows on a mocked Supabase, each with every flag off and with
  release 1's three flags (against the registry this branch's SQL writes):
  `summary.cjs` (today's summary flow), `together.cjs`, `shell.cjs`,
  `practice.cjs` and `cards.cjs`.

Known gaps:

- The quality eval of the questions generator (Q-5) isn't built.
- The cards eval tool exists, but the eval itself was never run.
- A few minor review findings are left for later. Link-buttons on the
  practice screens show in the browser's link colour (Q7). Some practice
  lines aren't the documents' words (Q9). While cards are written, K2 says
  "עד שהשאלות נכתבות" (C's COPY). One card review end line only matters
  once review is on (K5-WAITING). C's share of the entry chunk is over its
  8 kB budget (BUNDLE-SHARE).
