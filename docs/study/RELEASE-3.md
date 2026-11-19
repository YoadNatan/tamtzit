# תמצית, release 3: W2, corrections and "לשאול", C's end, the paragraph anchor

Release 3 is everything on the branch `study/wave3` beyond release 2
(`RELEASE-2.md`). It merges four packages, in this order: W2 (the
hardening of server writing, `RELEASE-W2.md`), K-1 and K-2 (corrections and
"לשאול", `corrections.md`), C's end (`RELEASE-C2.md`, `cards.md`) and N
(the paragraph anchor, `anchor.md`). This page is Yoad's production steps,
in order, what to check on the phone, and how to roll back. It replaces the
production steps of `RELEASE-W2.md`, `RELEASE-C2.md`, `corrections.md` and
`anchor.md`: follow this page, not theirs.

## What is in the release

Live at the merge, under production's flags (`VITE_STUDY_QUESTIONS`,
`VITE_STUDY_PRACTICE`, `VITE_STUDY_CARDS`), with no flag change:

- **W2, the hardening of server writing** (spec §3.7):
  - Members can no longer add, change or delete a part of a summary, or
    change a lecture's status, outline or error. Renaming a lecture still
    works. Only the server's writer and, once they are on, approved
    corrections change a part.
  - "המשך כתיבה" spends one of the day's three restarts once, however many
    phones tap at the same moment. The part then reads "ממתין לתורו".
  - Deleting a lecture stops its writing, on the server and on a phone that
    was writing it. After "שחזור", "המשך כתיבה" writes the rest.
- **C's end: the deck as approved** (`proposal/mockups/cards.html` s3):
  - **Decision 8, your deck part by part.** The deck page shows the ring of
    your own deck and a row per part with "להוסיף" or "7 בחפיסה ✓". Nothing
    is in anyone's deck until they add it. The export offers "החפיסה שלך"
    first and "כל החפיסה" second. This is a change the group will notice:
    tell them at step 7.
  - "מאיפה זה?" on an open card shows its paragraph, and "לפסקה" opens the
    reader there (cards written after the merge).
  - Trap cards ("מלכודת של הקבוצה"): when 3 players choose the same wrong
    option in a group quiz, it becomes a group card, closed until the next
    study day. This needs the quiz, so it starts only once `VITE_STUDY_QUIZ`
    is on.
  - Private cards from a member's own wrong answers are written and kept
    private. They show only with in-app review (`VITE_STUDY_CARDS_REVIEW`),
    which stays off.

Built and off, each behind its own flag, for you to turn on (step 5):

- **`VITE_STUDY_ANCHOR`: the paragraph anchor** (`anchor.html`). Under each
  paragraph, chips of what the group built on it: "2 שאלות" · "2 כרטיסים"
  · "תגובה", and a line only you see ("טעית כאן פעמיים." · "רק לך"). A chip
  opens the paragraph's sheet, "מה יושב על הפסקה". Its "תרגול" tab lists
  the paragraph's questions and cards with your state on each, and
  "לתרגל את הפסקה · N שאלות" asks exactly those. No cost.
- **`VITE_STUDY_CORRECTIONS`: corrections** (`corrections.html` s1). On a
  paragraph, "תיקון" opens "הצעת תיקון": the text (a table cell by cell), a
  preview with the change marked, and a mandatory source: a slide, a
  recording minute or an outside note. Another member approves it ("לאשר");
  never the one who proposed it. Then everyone sees the new text, live.
  "ביטול" undoes the paragraph's latest correction in one tap.
  "לבדוק מול השקף" compares a proposal with its slide (about $0.01, 10 a
  day for each member). The paragraph's sheet gains the "תיקון" tab, and
  "יחד" gains "תיקונים אחרונים".
- **`VITE_STUDY_ASK`: "לשאול"** (`ask.html`). A question about a lecture,
  answered from the slides, the group's summary and the questions the group
  already answered (sent without names). It works as a screen and as a
  sheet over the reader. "עדיין לא ברור? לשאול את הקבוצה" puts the question
  on the paragraph with Claude's attempt folded under it. It spends from
  the same $33 a month (20 questions a day for each member, and the usual
  80% and 40% stops).

All three flags open the same paragraph sheet, one frame for all its tabs:
תגובות · תיקון · אסוציאציה · תרגול, each tab with its flag. The association
tab is package J's and stays off.

**The SQL** takes sections W, C and K to version 2 and adds section N at
version 1. It changes no existing row, and release 2's code works on it
(step 1).

**Not in this release:** the quiz flag is yours to set, as before (this
release needs nothing from it). In-app card review
(`VITE_STUDY_CARDS_REVIEW`), the meeting (`VITE_STUDY_MEETING`, so "אישור
בקול" is never offered), the wall, VAR, accounts and every other
`VITE_STUDY_*` flag stay unset.

## Before you start

- Release 2 is live:
  https://tamtzit.vercel.app/api/study/health answers
  `"schemaOk":true` and `"workerOk":true`, with
  `"schema":{"C":1,"F":1,"K":1,"Q":2,"W":1,"Z":2}`.
- W1 has written at least one lecture on the server (W2 needs it). In the
  SQL Editor:

  ```sql
  select count(*) from public.study_usage u join public.study_lectures l on l.id = u.lecture_id
   where u.user_id is null and u.kind = 'part' and u.settled_at is not null and u.created_at >= l.queued_at;
  ```

  It must be above 0. If it is 0, upload one lecture first and let the
  server write it (`RELEASE-2.md`, step 7).

The project is the Supabase project `/` already uses. Never create a
group anywhere: the group exists, and only one can exist.

## The steps, in order

### 1. Supabase: run the SQL of this release, before the merge

SQL Editor → paste **the whole** `supabase/study-schema.sql` **from the
branch `study/wave3`** (Claude gives the link once the branch is pushed: on
GitHub, the file → "Copy raw file") → Run. Don't use the file from `main`
or from `study/w3-w2`, `study/w3-k`, `study/w3-c` or `study/w3-n`: each of
those has only its own package. The file can be run again safely.

- **Expected:** it finishes without an error. NOTICEs like "… already
  exists, skipping" or "… does not exist, skipping" are harmless.
- **Check the registry:**

  ```sql
  select public.study_schema();
  ```

  It must answer `{"C": 2, "F": 1, "K": 2, "N": 1, "Q": 2, "W": 2, "Z": 2}`.
  Only W, C and K change (each from 1 to 2), and N is new.
- **Check W2's hardening** (both must say `false`):

  ```sql
  select has_table_privilege('authenticated', 'public.study_sections', 'UPDATE') as part_update,
         has_column_privilege('authenticated', 'public.study_lectures', 'status', 'UPDATE') as status_update;
  ```

- **Check C's private tables** (the first says `3`, the second `0`):

  ```sql
  select count(*) filter (where relrowsecurity) as rls_on from pg_class
   where relname in ('study_card_adoptions', 'study_my_cards', 'study_my_card_reviews') and relnamespace = 'public'::regnamespace;
  select count(*) as published from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename in ('study_card_adoptions', 'study_my_cards', 'study_my_card_reviews');
  ```

- **Check K's proposals are live** (it must say `1`):

  ```sql
  select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'study_edit_proposals';
  ```

- **Until step 2's deploy, today's app works as before:**
  - Its browser code never wrote a part (the server's functions do), and its
    upload sends exactly the nine columns still allowed.
  - Release 2's card screens read and write the same rows; the new columns
    and tables stay unused.
  - It never calls K's changed functions, and "לסמן שנענתה" keeps working
    (it now also records who marked it).
  - Section N adds functions only.
  - Release 2's code needs F 1, W 1, Q 2, C 1 and K 1 (and Z 2 with the
    quiz), all of which this file keeps or raises, so health stays
    `"schemaOk":true`.
- **What the file changes** (it changes no existing row):
  - W to 2: members' writes to parts and to a lecture's writing state are
    taken away, and restarts take a row lock.
  - C to 2: cards get their paragraph (anchor, quote), trap cards and stale
    marks. Three new private tables: the deck by part, private cards and
    their reviews. A trigger writes a private card on a member's first wrong
    answer, and never blocks saving the answer.
  - K to 2: proposals with a source, approval, undo, the share path of
    "לשאול", who marked a question answered, and the slide check's result.
    The proposals table is added to Realtime. The history gains a column
    `occurrence` (which of two paragraphs that read the same a correction
    wrote, so "ביטול" puts the text back in that one); existing rows keep
    it empty.
  - N at 1: two read functions for the chips and the "תרגול" tab, members
    only.

### 2. Merge, which deploys

Tell Claude that step 1 is done; Claude merges `study/wave3` into `main`.
Vercel deploys `main` to Production.

**The order matters.** This code needs W at 2 and C at 2 whatever the
flags. If it deploys before step 1, health says `"schemaOk":false`, the app
shows "העדכון של האפליקציה עוד לא הושלם. כדאי לנסות שוב בעוד כמה דקות.",
and server writing and the op "cards" answer 503 "schema".

### 3. Check health and the server writer

Once the deploy is live, open
https://tamtzit.vercel.app/api/study/health. It should answer:

```json
{"ok":true,…,"worker":true,"workerOk":true,"budgetUsd":33,"schema":{"C":2,"F":1,"K":2,"N":1,"Q":2,"W":2,"Z":2},"schemaOk":true,…}
```

| If | Then |
|---|---|
| `"schemaOk":false` | Step 1 did not run on this project, or stopped half-way. Run the whole file again (step 1), then reload health. |
| `"workerOk":false` | Vault's `study_worker_key` is not the same value as Vercel's `STUDY_WORKER_KEY` (`RELEASE-2.md`, "Before you start"). No redeploy is needed once Vault is right. |
| The page is the old one | The deploy isn't live yet. Wait a minute and reload. |

Go on only when `schemaOk` and `workerOk` are `true`.

### 4. Check what changed at the merge, on a phone

- **W2.** Open a lecture whose summary is written: it reads as before.
  Upload one lecture: the server writes it, as in release 2. Then, in the SQL
  Editor, the writer's rows:

  ```sql
  select u.kind, u.user_id is null as by_server, u.settled_at is not null as settled
    from public.study_usage u
   where u.lecture_id = (select id from public.study_lectures where deleted_at is null order by created_at desc limit 1)
   order by u.created_at;
  ```

  Expect one `outline` row and one `part` row per part, each `by_server`
  and `settled`.
- **C's end.** A lecture's "כרטיסיות":
  - the deck page shows "N כרטיסים · M חלקים · נוצרו פעם אחת לכל הקבוצה"
    and the ring at 0 for you;
  - "להוסיף" on a part turns it into "{x} בחפיסה ✓", and "להוציא מהחפיסה
    שלי" takes it out again;
  - "ייצוא ל-Anki" in the bottom bar offers "החפיסה שלך" and "כל החפיסה";
    the file opens in Anki;
  - on a card written after the merge, "מאיפה זה?" shows the paragraph and
    "לפסקה" opens it.

### 5. Turn on the new features, when you choose

Vercel → Settings → Environment Variables → **Production**. Turn them on
one at a time if you like: each is independent. Keep production's flags as
they are.

| Name | Value | Needs (step 1 gave all of it) |
|---|---|---|
| `VITE_STUDY_QUESTIONS` | `1` (already set) | Q 2 |
| `VITE_STUDY_PRACTICE` | `1` (already set) | Q 2 |
| `VITE_STUDY_CARDS` | `1` (already set) | C 2 |
| `VITE_STUDY_ANCHOR` | `1` (new) | N 1 |
| `VITE_STUDY_CORRECTIONS` | `1` (new) | K 2 and W 2 |
| `VITE_STUDY_ASK` | `1` (new) | K 2 |

Then Deployments → the latest Production deployment → ⋯ → **Redeploy**.
The flags are built into the app, so nothing changes until the redeploy.

- `VITE_STUDY_QUIZ` stays as you set it; this release needs nothing from
  it.
- Set no other `VITE_STUDY_*` variable. In particular, not
  `VITE_STUDY_CARDS_REVIEW` (in-app review waits for accounts) and not
  `VITE_STUDY_MEETING`.
- Never set a `VITE_STUDY_*` flag on Preview: Preview deployments share the
  production database.

After the redeploy, health again shows `"schemaOk":true` (step 3).

### 6. Check each feature on the phone

On two phones (two members), on a lecture with questions and cards.

**The paragraph anchor** (`VITE_STUDY_ANCHOR`):
- Under a paragraph with questions: "2 שאלות" · "2 כרטיסים" and, if it has
  comments, "תגובה" or "3 תגובות". The comments' dot inside the paragraph is
  gone: the chip replaces it.
- On a paragraph where you answered wrong: "טעית כאן פעמיים." with "רק לך".
  The other phone does not see your line.
- Tap "2 שאלות": the sheet "מה יושב על הפסקה" opens on "תרגול · 4", with
  the slide tag in its head, "של הקבוצה: 2 שאלות, 2 כרטיסים", and your state
  on each item ("טעית פעמיים", "עוד לא ענית", "בחפיסה", …).
- "לתרגל את הפסקה · 2 שאלות" asks exactly those two. After a wrong answer,
  "לפסקה" leads back, with the toast "מהשאלה שטעית בה, ישר לפסקה".

**Corrections** (`VITE_STUDY_CORRECTIONS`):
- Phone A: tap a paragraph → "תיקון". Change a word, choose "שקף" and a
  slide (its words show under it), tap "להציע לקבוצה". Phone A sees "לבטל
  את ההצעה", never "לאשר".
- Phone B: "תיקון ממתין לאישור" appears on the paragraph without a reload.
  Open it: the change is marked, with the source, "חסר עוד אישור אחד מהקבוצה"
  and "לאשר". Optionally "לבדוק מול השקף · כ-$0.01".
- Phone B taps "לאשר": both phones show the new text, with a short flash on
  phone A. The history line reads "תיקון: A · אישור: B · מקור: שקף …".
- "ביטול" on that correction puts the old text back at once. It is offered
  on the paragraph's latest correction only, never on an undo.
- "יחד" shows "תיקונים אחרונים", and the library's card shows "תיקון חדש".
- In the SQL Editor (read only):

  ```sql
  select state, source_kind, proposed_by is not null, approved_by is not null, decided_at
    from public.study_edit_proposals order by created_at desc limit 5;
  ```

**"לשאול"** (`VITE_STUDY_ASK`):
- On a paragraph → "לשאול": the sheet opens over the reader, and the reading
  goes on under it. Ask something the slides answer: the answer cites the
  slides. Ask something they don't: it says "לא מופיע בשקפים".
- "עדיין לא ברור? לשאול את הקבוצה": "השאלה עלתה לפסקה.". On phone B the
  paragraph's thread shows the question with "מצורף: הניסיון של Claude
  לענות" folded under it. Phone B answers and taps "לסמן שנענתה": "סומנה
  שנענתה: B".
- The screen: the library's bar → "לשאול", or `/?v=ask`.
- In the SQL Editor, every call reserved and settled once:

  ```sql
  select kind, count(*), round(sum(cost_usd), 3) as usd, count(*) filter (where settled_at is null) as open
    from public.study_usage
   where kind in ('ask', 'fix_check') and created_at > now() - interval '1 hour'
   group by 1 order by 1;
  ```

  `open` must be 0.

### 7. Ask the group to reopen the app

Ask each member to close the app and open it again (on an iPhone, swipe the
Home Screen app away), so no phone keeps release 2's code. Tell them about
decision 8: their deck is now theirs, part by part, so each adds the parts
they want on a lecture's "כרטיסיות" ("להוסיף" or "להוסיף את כל החלקים")
before the next export to Anki.

## What to watch

In the SQL Editor, during the first days:

```sql
-- Proposals waiting for a second member (each paragraph has at most one)
select l.title, p.part_idx, p.anchor, p.source_kind, p.created_at
  from public.study_edit_proposals p join public.study_lectures l on l.id = p.lecture_id
 where p.state = 'pending' order by p.created_at;
-- "המשך כתיבה" restarts used today (at most 3 a day per lecture; several phones tapping at once count once)
select title, retries from public.study_lectures where retry_day = current_date and deleted_at is null;
-- The month's spend by kind; "ask" and "fix_check" are new
select kind, count(*), round(sum(cost_usd), 2) from public.study_usage
 where created_at >= date_trunc('month', now()) group by 1 order by 3 desc;
-- Reservations that never settled (a call died)
select kind, count(*) from public.study_usage
 where settled_at is null and created_at < now() - interval '15 minutes' and created_at >= date_trunc('month', now()) group by 1;
-- Private cards written from wrong answers (owner-only rows; this counts them)
select count(*) from public.study_my_cards;
```

## Rolling back

Use the smallest rollback that fixes the problem.

- **One feature.** Vercel → Environment Variables → delete
  `VITE_STUDY_ANCHOR`, `VITE_STUDY_CORRECTIONS` or `VITE_STUDY_ASK` (or set
  it to `0`) → Redeploy.
  - Its entries disappear; a link to "לשאול" lands on its lecture (or the
    library) with "התכונה הזו עוד לא פתוחה.".
  - Proposals, corrections already applied, questions shared from "לשאול"
    and every chip's data stay in the database. An applied correction stays
    in the summary: the flag hides only the screens.
- **The whole release (last resort).** Vercel → Deployments → the last
  Production deployment before the merge → ⋯ → Promote to Production
  (instant rollback). Then ask the group to reopen the app.
  - Release 2's code works with this SQL: its screens read and write the
    same rows, and its browser never wrote a part.
  - Leave the SQL as it is. Before this release is deployed again, nothing
    has to change in it.
  - A deck added part by part stays in the database for when the release
    comes back.
- **Never run an older `study-schema.sql`** (from `main` before this
  release, or from any `study/w3-*` branch). It would give members back
  direct writes to parts, set W, C or K back to 1, and the code of this
  release would answer `schemaOk` false. If it was run by mistake, run this
  release's file again: it takes the grants away again and sets the
  registry back.
- **Never** drop tables. Never run Supabase's sample clean-up of anonymous
  users: it would delete the group with its creator.

## What was tested (on `study/wave3`; local only)

No production, no real Supabase project and no real Anthropic call were
used, and no group was created anywhere real.

**The merge.** `study/w3-w2` (W2), `study/w3-k` (K), `study/w3-c` (C's end)
and `study/w3-n` (N) were merged in that order on top of `main` (fe57848).
The conflicts, and how each was resolved keeping both sides:

- The health and registry tests (`server/study/ai.test.ts`,
  `src/study/lib/route.test.ts`): they now expect W 2, C 2, K 2 and N 1
  together. Corrections ask for K 2 and W 2, "לשאול" for K 2, and the op
  "cards" for C 2.
- `server/study/study.ts`: the op "cards" needs C 2 and "ask" needs K 2, the
  two ends' values.
- `shared/study/flags.ts`, the icons, `docs/study/design-system.md` and
  the help tests: both sides kept (W2's help test and C's both run).
- **One paragraph sheet for K and N.** N had built a minimal
  `ParagraphSheet.tsx` for K to extend; K had the full one.
  - The merged frame is K's: tabs תגובות · תיקון · אסוציאציה · תרגול, the
    thread's extras, and the answer card.
  - It adds N's count on "תרגול" ("תרגול · 4", as `anchor.html` s2 draws
    it).
  - Its head styles moved into `styles/collab.css`, which loads with K's
    slot whatever the flags.
  - `Together.tsx` (one `ThreadPanel`) and `features/collab.tsx` (the lazy
    frame, opened when any of its tabs' flags is on) are K's side, which
    already held N's split.
- `e2e/study/mock.cjs`: K's flag set `k` and N's `E2E_ANCHOR` together.
- The SQL merged without conflicts: each package's lines sit between its
  own section's markers, in the file's order (F A W Q Z C K P M N V U J H B
  G E T).
- **K-2 on W2 for real.** K's e2e set now runs against the registry this
  SQL writes (W 2, K 2) instead of a database with every section assumed.
  `collab.cjs` checks that in the whole corrections and "לשאול" run no phone
  wrote a part and the grants refused nothing. The mock answers 403 42501 to
  any write the grants refuse, as PostgREST does.

**Fixed after the wave's review** (each checked first, then fixed):

- **"ביטול" touched the wrong paragraph** (SQL, section K). When the
  corrected text also stood as another, earlier paragraph of the part, the
  one-tap undo put the old text back in that other paragraph. A correction
  now records which occurrence it wrote, and its undo goes there while the
  part is unchanged; after other changes the text must stand exactly once,
  or the undo answers "edit conflict" and changes nothing. Checks KU1-KU3b.
- **An undo from K's first version could be undone** (SQL, section K).
  Release 2's history rows have no source; an undo among them is now
  recognised by its `undo_of`, so undoing it ("bad undo") can no longer
  re-apply a correction nobody approved. Check KU4, and the upgrade below.
- **Right-to-left in the correction screens.** A table column's header
  ("t½") above its field, the slide check's note, and each line of the
  quoted slide now keep their own direction (a Hebrew line of a slide is no
  longer laid out left to right).
- **Previews end at a whole word with "…"** ("תיקונים אחרונים", "לפסקה: …").
- **The Anki export counts as the deck page does:** "החפיסה שלך (כרטיס אחד)",
  "כל החפיסה (5 כרטיסים)".
- **A deleted lecture's footer** offers only "לספרייה · נמחקו לאחרונה";
  the read mark, the practice link and the delete button return with
  "שחזור".

| Test | Result |
|---|---|
| `npm run test:study` | 570 tests, 570 pass, 0 fail |
| `npm run test:contract` | 105 RPC calls and 90 table chains in 151 files match the schema (156 study functions, 36 study tables); 14 of the browser's written columns are granted to a member |
| `npm run build` | passes; the study entry 315.79 kB with no flags (limit 400 kB; 315.98 kB with wave 3's flags) |
| `npm run test:bundle` | the study entry 327,122 bytes with every flag on; no package screen in it. W's, C's and K's shares (17,973, 15,645 and 20,491 B) are over the 8 kB guide, as on their branches; N's is 7,240 B |
| The whole SQL loaded twice (stubs, board, `study-schema.sql` × 2) on a throwaway Postgres 16 | 0 errors; `supabase/tests/study.sql` exits 0: 829 lines, 0 FAIL, 0 ERROR; `{"C": 2, "F": 1, "K": 2, "N": 1, "Q": 2, "W": 2, "Z": 2}` |
| The upgrade: `origin/main`'s `study-schema.sql` with data (its own checks, then a lecture with parts, a correction, a thread, cards with a member's review state and settings), then this file twice | 0 errors each time; the registry goes from `{"C": 1, "F": 1, "K": 1, "Q": 2, "W": 1, "Z": 2}` to the one above; all 54 rows of the 32 tables kept, the parts, comments and cards unchanged; 4 new tables, empty |
| The upgrade with K's first version's undo: on `origin/main`'s SQL a member corrects a paragraph and undoes it with release 2's `study_edit_block`, then this file twice | 0 errors; another member's `study_undo_edit` of that undo answers "bad undo" and the paragraph keeps its text (before the fix it re-applied the correction) |
| `supabase/tests/writing-concurrency.sh` | WK1 to WK4 as expected |
| `supabase/tests/quiz-concurrency.sh` | K1 to K3c as expected |

The e2e flows ran on a mocked Supabase, on the branch's final commit, in
five builds:

- `off`: every flag off;
- `rel1`: production's flags (`QUESTIONS`, `PRACTICE`, `CARDS`);
- `rel2`: production's flags with `QUIZ`;
- **wave 3**: release 2's four with `ANCHOR`, `CORRECTIONS` and `ASK`,
  with K's set `k` and `E2E_ANCHOR=1`. The release scripts (`cards`,
  `practice`, `quiz`) ran there as `rel2`.
- `rel1` + `ANCHOR`: production's flags with the anchor alone
  (`E2E_ANCHOR=1`).

Every screenshot was checked by `a11y.cjs` in light and dark at 390×844 and
360×640. Every script exited 0, with no page error, no unmocked or refused
call, and no accessibility problem. The cell's number is the script's
checks that read "ok"; `summary`, `together` and `collab` check by waiting
for each step instead.

| Script | off | rel1 | rel2 | wave 3 | rel1 + `ANCHOR` |
|---|---|---|---|---|---|
| `anchor.cjs` | pass, 3 ok (nothing of N) | pass, 3 ok | pass, 3 ok | pass, 18 ok | pass, 18 ok |
| `cards.cjs` | pass, 2 ok | pass, 26 ok | pass, 26 ok | pass, 26 ok | pass, 26 ok |
| `collab.cjs` | pass (nothing of K) | pass | pass | pass: tabs תגובות · תיקון · תרגול, 0 part writes, 0 refused | pass: no "תיקון", 0 part writes |
| `practice.cjs` | pass, 3 ok | pass, 57 ok | pass, 57 ok | pass, 57 ok | pass, 57 ok |
| `quiz.cjs` | pass, 2 ok (quiz replaced) | pass, 2 ok (quiz replaced) | pass, 47 ok | pass, 47 ok | pass, 2 ok (quiz replaced) |
| `shell.cjs` | pass, 31 ok | pass, 30 ok | pass, 30 ok | pass, 31 ok | pass, 30 ok |
| `summary.cjs` | pass | pass | pass | pass | pass |
| `together.cjs` | pass | pass | pass | pass | pass |
| `upload.cjs` | pass, 5 ok | pass, 5 ok | pass, 5 ok | pass, 5 ok | pass, 5 ok |
| `writing.cjs` | pass, 42 ok | pass, 42 ok | pass, 42 ok | pass, 42 ok | pass, 42 ok |

The last column is the anchor alone on production's flags (`rel1` with
`ANCHOR`, the likely first step of step 5).

Known gaps:

- Corrections and "לשאול" were tested on a build that also has the quiz
  (K's set `k`). The harness has no set with them and without the quiz.
  They don't depend on it.
- Only production can show some things: the slide check's and "לשאול"'s
  real answers and costs against the ledger, and two real phones seeing a
  correction live.
- "אישור בקול" needs the meeting (section M), which isn't built. It is
  never offered.
