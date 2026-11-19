# תמצית, release 4: the points read ahead, VAR, the wall, the day's meeting

Release 4 is everything on the branch `study/wave4` beyond release 3
(`RELEASE-3.md`). It merges four packages, in this order: B (the points to
know, read ahead after each summary, as Yoad's decision 2 redefines it), V
(disputes, VAR, the lecture's log and the spread, `var.md`), J (the
association wall, `wall.md`) and M (the day's meeting, `meeting.md`). It
follows Yoad's decisions of 17 November 2026
(`DECISIONS-2026-11-17.md`): no email accounts, and package B redefined.
This page is Yoad's production steps, in order, what to check on two
phones, and how to roll back. It replaces the production steps of
`var.md`, `wall.md`, `meeting.md` and `practice-2-api.md` §10: follow this
page, not theirs.

## What is in the release

Live at the merge, under production's flags, with no flag change:

- **B: the points to know, read ahead** (decision 2). Once the server's
  writer finishes a lecture's summary, the server reads the lecture's
  points to know by itself, part by part, once for the group. "מה ליצור"
  then opens with its numbers. While the read runs, it shows the progress
  with "הנקודות נקראות מעצמן". No question or card is written
  automatically: those are still made only on a tap.
  - About $0.24 for a lecture of five parts, through the ledger (kind
    `points`, no member's name on the rows).
  - It stops quietly at the optional features' line (80% of the month's
    $33). The screen then offers "לקרוא את הנקודות", as before.
  - A server switch, `points_ahead`, on by default (step 1 adds it). There
    is no flag.
- **The spread of corrections** (section V's trigger, whatever the flags).
  From step 1 on, every approved correction marks the questions and cards
  on its paragraph. They leave practice and the quiz until "עדיין נכון" or
  a fix, as Q's and C's ends already handle such marks. Undoing the
  correction removes the marks. This only happens where
  `VITE_STUDY_CORRECTIONS` is on, since nobody can approve a correction
  without it.
  - A card's "עדיין נכון" is in the lecture's deck, as in release 3.
  - A question's "עדיין נכון" is new: in the paragraph's "תרגול" tab
    (`VITE_STUDY_ANCHOR`, on since release 3), under the marked question,
    with "בבדיקה אחרי תיקון בפסקה". Any member's tap puts it back for the
    whole group. Before the review, nothing in the app could bring a
    marked question back.
  - The questions' marks obey a server switch, `spread_questions`, on by
    default (step 1 adds it). If you ever turn `VITE_STUDY_ANCHOR` off
    while `VITE_STUDY_CORRECTIONS` stays on, turn the switch off too
    ("Rolling back"), or marked questions would have no way back.

Built and off, each behind its own flag, for you to turn on (step 5):

- **`VITE_STUDY_VAR`: the yellow card, VAR and the lecture's log**
  (`corrections.html` s1-s3; needs `VITE_STUDY_CORRECTIONS`).
  - "לא מסכימים: כרטיס צהוב" works on a waiting correction or on any
    paragraph. Each side writes one line with its slides.
  - The others back a side without names. The split shows only after VAR
    is asked, and only from 3 backers.
  - VAR costs about $0.08 and runs one at a time. It separates "כתוב בשקף"
    from "פרשנות". "לקבל" pins the "פסיקת VAR" box under the paragraph,
    and sometimes adds a trap card for everyone.
  - "יומן התיקונים" (a chip on the lecture) lists the corrections, the
    verdicts and "כרטיס צהוב לשקף" for slips in the slides.
  - Whoever already studied a corrected line gets a private "עדכון". Until
    Today exists, it shows on "יחד".
- **`VITE_STUDY_WALL`: the association wall** (`wall.html`).
  - Each lecture has a wall. Entries are posted by name or "בלי שם", the
    author kept in an owner-only table.
  - Votes "מצחיק" and "נתקע לי", pins ("שלי"), and the marks "לא מדויק" and
    "לא מתאים".
  - Credit to another member shows only after their yes.
  - "תנו לי 3 מצחיקות": three drafts for a paragraph, about $0.02. They
    are saved for the group, so the next member gets them free; two
    phones asking at the same moment pay once. Each person has 5 paid
    requests a day.
  - "לנעוץ רגע" from the reader's or the follower's bar, and a photo of a
    sketch.
  - The week's winner on "יחד". The checked winner shows on the cards'
    back (op `wall_check`, about $0.01).
  - The paragraph sheet's "אסוציאציה" tab opens.
- **`VITE_STUDY_MEETING`: the day's meeting, M-1** (`meeting.html`,
  `today.html` s1; needs `VITE_STUDY_QUIZ`).
  - Planning "הפגישה הבאה" (when, what is read, who reads), and its band
    on "יחד".
  - Reading aloud with followers, and "לא ברור לי" without a name. The
    reader's card counts taps from 3 and offers "לעצור ולהסביר" ·
    "להמשיך" · "לשאלה פתוחה למחר", in the text right after the paragraph
    (the reader's bar keeps one line that points to it).
  - The opening "3 לקפה", the agenda, the closing group quiz, and the
    one-question stop at a part's end: at most two rituals a day
    (decision 7).
  - K-2's "אישור בקול" for a correction, only while two others follow.
  - No cost of its own: the rituals are the group quiz's.
- **`VITE_STUDY_GUESS`: the pre-guess and catch-up, M-2** (needs
  `VITE_STUDY_MEETING`). Decision 1 opens it without an account.
  - "ניחוש לפני · 2 שאלות" before the meeting, and "דינג!" when the reading
    reaches the answer.
  - "פגישה שפספסת" on "יחד" opens the catch-up for a member who missed the
    meeting. The next study day, it marks the lecture read for them.
  - With `VITE_STUDY_ANCHOR` on, the "לא ברור" toast says "הפסקה תחזור
    אליך מחר.".

**The SQL** adds sections B, V, J and M, each at version 1. It changes no
existing row. Release 3's code works on it (step 1).

**Not in this release:** Today, the pulse, in-app card review, progress and
the rest stay unset. Without the pulse (section U), "דרושה אסוציאציה" is
hidden, the agenda has no hot spot, and the reader gets no warning that
most of the group guessed wrong. There are no accounts to set up: decision 1
withdrew them (`VITE_STUDY_ACCOUNT` stays unset, and no email service is
needed).

## Before you start

- Release 3 is live:
  https://tamtzit.vercel.app/api/study/health answers
  `"schemaOk":true` and `"workerOk":true`, with
  `"schema":{"C":2,"F":1,"K":2,"N":1,"Q":2,"W":2,"Z":2}`.
- Server writing works (release 2's W1). B kicks the same worker with the
  same Vault secrets, so there is nothing new to set up.

The project is the Supabase project `/` already uses. Never create a
group anywhere: the group exists, and only one can exist.

## The steps, in order

### 1. Supabase: run the SQL of this release, before the merge

SQL Editor → paste **the whole** `supabase/study-schema.sql` **from the
branch `study/wave4`** → Run. Claude gives you the link once the branch is
pushed (on GitHub, open the file → "Copy raw file"). Don't use the file from
`main`, from `study/wave3`, or from `study/w4-b`, `study/w4-v`, `study/w4-j`
or `study/w4-m`: each of those lacks part of this release. The file can be
run again safely.

- **Expected:** it finishes without an error. NOTICEs like "… already
  exists, skipping" or "… does not exist, skipping" are harmless.
- **Check the registry:**

  ```sql
  select public.study_schema();
  ```

  It must answer
  `{"B": 1, "C": 2, "F": 1, "J": 1, "K": 2, "M": 1, "N": 1, "Q": 2, "V": 1, "W": 2, "Z": 2}`.
  B, J, M and V are new, and nothing else changes.
- **Check the two new switches** (both must say `true`):

  ```sql
  select name, enabled from study_private.features where name in ('points_ahead', 'spread_questions') order by name;
  ```

- **Check what is published for Realtime** (it must list
  `study_aids`, `study_disputes`, `study_meetings`, `study_slide_flags`):

  ```sql
  select string_agg(tablename, ', ' order by tablename) from pg_publication_tables
   where pubname = 'supabase_realtime'
     and tablename in ('study_aids', 'study_aid_authors', 'study_aid_votes', 'study_disputes', 'study_dispute_backs',
                       'study_slide_flags', 'study_updates', 'study_meetings', 'study_meeting_taps');
  ```

  Backing, votes, authors, taps and updates are never published.
- **Until step 2's deploy, today's app works as before:**
  - Release 3's code calls no function whose arguments changed, reads no
    column that went away, and writes nothing a grant now refuses. The
    contract of every function, column and grant release 3 uses is the same
    on this file.
  - Release 3's code needs F 1, W 2, Q 2, C 2 and K 2 (and N 1, Z 2 with
    its flags). This file keeps all of them, so health stays
    `"schemaOk":true`.
  - A summary that finishes before step 2 kicks the worker for its points.
    Release 3's worker answers 400 and nothing is read. Those lectures'
    points are read on a member's tap, as today.
- **What the file changes** (it changes no existing row):
  - **B at 1:**
    - a column `ahead_at` on `study_point_parts`;
    - the switch `points_ahead`;
    - two worker functions;
    - a trigger on the lecture becoming `ready`.
    - Section Q's `study_points_save` and `study_points_fail` also accept
      the server key alone, so the worker can save. A member's call is
      checked as before.
  - **V at 1:**
    - four tables (`study_disputes` and `study_slide_flags` published;
      `study_dispute_backs` and `study_updates` private);
    - their functions;
    - the spread's trigger on `study_edits`, and its switch
      `spread_questions` (on).
  - **J at 1:**
    - seven tables (`study_aids` published, with no author column; the
      group's drafts and winners; the owner-only authors, votes, pins and
      credits);
    - their functions. A wall photo must be the member's own upload in the
      group's folder, on one entry only.
    - a private table of holds (`study_private.aid_draft_holds`): two
      phones asking "תנו לי 3" on one paragraph at once pay once.
  - **M at 1:**
    - the meeting's tables (`study_meetings` published; taps, presence,
      the live reading, guesses, catch-ups and events private);
    - their functions. A meeting that started keeps its lecture, parts and
      day;
    - section Z's stub `study_quiz__pick_preset`, replaced with the same
      arguments.

### 2. Merge, which deploys

Tell Claude that step 1 is done. Claude merges `study/wave4` into `main`,
and Vercel deploys `main` to Production.

**The order matters less than in release 3, but keep it.** This code's own
needs (F 1, W 2, Q 1, C 1, K 1) are met by release 3's SQL as well, so
production's flags would still answer `schemaOk` true. But the read ahead,
VAR, the wall and the meeting all need step 1. Op `var` answers 503
"schema" without V, `mnemonic` and `wall_check` without J, and the read
ahead without B.

### 3. Check health and the server writer

Once the deploy is live, open
https://tamtzit.vercel.app/api/study/health. It should answer:

```json
{"ok":true,…,"worker":true,"workerOk":true,"budgetUsd":33,"schema":{"B":1,"C":2,"F":1,"J":1,"K":2,"M":1,"N":1,"Q":2,"V":1,"W":2,"Z":2},"schemaOk":true,…}
```

| If | Then |
|---|---|
| `"schemaOk":false` | Step 1 did not run on this project, or stopped half-way. Run the whole file again (step 1), then reload health. |
| `"workerOk":false` | Vault's `study_worker_key` is not the same value as Vercel's `STUDY_WORKER_KEY` (`RELEASE-2.md`, "Before you start"). No redeploy is needed once Vault is right. |
| The page is the old one | The deploy isn't live yet. Wait a minute and reload. |

Go on only when `schemaOk` and `workerOk` are `true`.

### 4. Check the read ahead (B), on a phone

Upload one short lecture and let the server write it. A few seconds after
the last part is written:

- Open the lecture's practice → "מה ליצור". Either the progress card ("N
  מתוך M חלקים", "הנקודות נקראות מעצמן") or the numbers already shows,
  without a tap. On the second phone, the same screen updates live.
- The upload never asked "להכין גם שאלות וכרטיסיות?".
- In the SQL Editor, the read ahead's rows:

  ```sql
  select u.kind, u.ref, u.user_id is null as by_server, u.settled_at is not null as settled, round(u.cost_usd, 3) as usd
    from public.study_usage u
   where u.kind = 'points'
     and u.lecture_id = (select id from public.study_lectures where deleted_at is null order by created_at desc limit 1)
   order by u.id;
  select part_idx, status, ahead_at is not null as ahead from public.study_point_parts
   where lecture_id = (select id from public.study_lectures where deleted_at is null order by created_at desc limit 1)
   order by part_idx;
  ```

  Expect one `points` row with ref `ahead` and one per further part
  (`part 1`, …), each `by_server` and `settled`. Every part should be
  `ready` and `ahead`.
- If nothing was read: check the switch (step 1). If the month's spend is
  above 80% of $33, the read was skipped on purpose.

### 5. Turn on the new features, when you choose

Vercel → Settings → Environment Variables → **Production**. Turn them on
one at a time if you like. Keep production's flags as they are.

| Name | Value | Needs (step 1 gave all of the SQL) |
|---|---|---|
| `VITE_STUDY_VAR` | `1` (new) | V 1; `VITE_STUDY_CORRECTIONS=1` |
| `VITE_STUDY_WALL` | `1` (new) | J 1 |
| `VITE_STUDY_MEETING` | `1` (new) | M 1; `VITE_STUDY_QUESTIONS=1` and `VITE_STUDY_QUIZ=1` |
| `VITE_STUDY_GUESS` | `1` (new) | M 1; `VITE_STUDY_MEETING=1` |

Then Deployments → the latest Production deployment → ⋯ → **Redeploy**.
The flags are built into the app, so nothing changes until the redeploy.

- A flag without what it needs shows nothing. `VAR` without `CORRECTIONS`,
  `MEETING` without `QUIZ`, and `GUESS` without `MEETING` each stay off.
- **Read each new prompt's first live answer before telling the group**
  (§12.7.7): the first VAR verdict, the first "תנו לי 3" drafts, and the
  first winner's check. The quality evals the spec names (VAR's V1-V5 on
  six disputes, the wall's J-7) need the real model, so they were not run
  here.
- Set no other `VITE_STUDY_*` variable. In particular, not
  `VITE_STUDY_ACCOUNT` (decision 1), `VITE_STUDY_TODAY`,
  `VITE_STUDY_PULSE` or `VITE_STUDY_CARDS_REVIEW`.
- Never set a `VITE_STUDY_*` flag on Preview: Preview deployments share the
  production database.

After the redeploy, health again shows `"schemaOk":true` (step 3).

### 6. Check each feature on two phones

On two phones (two members, A and B), on a lecture with questions and
cards. Some steps need a third member, and are marked so.

**VAR and the log** (`VITE_STUDY_VAR`):
- Phone A: a paragraph → "תיקון" tab → "לא מסכימים: כרטיס צהוב". Write one
  line, choose a slide, and send. The card opens as "כרטיס צהוב · {part}"
  with "מחכים לצד השני".
- Phone B: "יחד" shows "כרטיסים צהובים" without a reload. Open the card →
  "לכתוב את הצד השני", with one line and a slide.
- Backing: with two phones the card says "הגיבוי יוצג מ-3". The bars need
  three backers other than the reader.
- Phone A taps VAR. The line shows "≈ $0.08" with the group's month. On
  phone B at the same moment: "נבדק עכשיו במכשיר אחר. התוצאה תופיע כאן.".
  The verdict reaches both phones live, with "כתוב בשקף" and "פרשנות" and
  a certainty.
- "לקבל": the "פסיקת VAR" box appears under the paragraph on both phones.
- The lecture's chip "יומן התיקונים" lists the correction and the verdict.
  "כרטיס צהוב לשקף" adds a slip in a slide, and one tap takes it back.
- The spread: phone A proposes a correction on a paragraph with a question,
  and phone B approves it. The question leaves practice:

  ```sql
  select id, stale_at is not null as stale from public.study_questions
   where stale_edit is not null order by stale_at desc limit 5;
  ```

  On phone A, the paragraph's chip → "תרגול": the question says "בבדיקה
  אחרי תיקון בפסקה" with "עדיין נכון". Tap it: "סומן כנכון. השאלה חוזרת
  לתרגול." and "לתרגל את הפסקה" counts it again (the query above shows
  it no longer stale). On another correction, "ביטול" clears the mark
  instead. A third member who had answered that question gets "עדכון
  בסיכום" on "יחד", with "רק לך".

**The wall** (`VITE_STUDY_WALL`):
- Phone A: a lecture → the chip "אסוציאציות" → "תנו לי 3 מצחיקות" → a
  paragraph. Three drafts arrive (about $0.02), with "נשארו היום 4".
  "לפרסם כמו שהיא" on one.
- Phone B: the entry shows on the wall without a reload. Phone B opens
  "תנו לי 3" on the same paragraph: the three drafts show at once, with no
  call and no cost.
- On another paragraph, both phones tap "תנו לי 3" at the same moment.
  One writes the drafts; the other says "הטיוטות לפסקה הזאת נכתבות עכשיו
  בטלפון אחר. הן יופיעו כאן בעוד רגע." and then shows them. The ledger
  (end of this step) has one `mnemonic` row for that paragraph.
- Phone B votes "מצחיק". Phone A cannot vote on its own entry.
- Phone B posts "בלי שם" from "משלי". Phone A sees "בלי שם", never B's
  name.
- Phone A credits B on an entry. The name shows only after B taps "לאשר"
  on "יחד".
- The paragraph sheet has an "אסוציאציה" tab with the paragraph's entries.
- A winner needs 2 votes from others, so it needs a third member. Then
  "בגב הכרטיס של כולם" shows after the check (about $0.01).

**The meeting** (`VITE_STUDY_MEETING`):
- Phone A: "יחד" → "לקבוע את הפגישה הבאה": today in a few minutes, a
  lecture and its parts. Save. (No reader is planned ahead since section
  M 2: whoever taps "להקריא לקבוצה" reads.) Phone B's "יחד" shows the
  band "הקבוצה היום · {time}" without a reload.
- Phone A opens the meeting → "להתחיל להקריא". Phone B → "לעקוב אחרי
  ההקראה". Phone A's bar shows "עוקב אחד" (one line, above "ההקראה שלך
  משותפת"), and B's screen follows A's paragraph.
- Once A reads, the meeting screen no longer offers "לשנות את התכנון".
  A planning sheet opened before that cannot move the meeting to another
  lecture, parts or day: it answers "הפגישה כבר התחילה, ולכן אי אפשר
  לבטל אותה או להחליף את היום, ההרצאה או החלקים." (the database refuses
  it too).
- Phone B taps "לא ברור לי": the toast says "סומן, בלי שם." with "ביטול".
  The reader's card counts taps only from 3 members, so with two phones it
  shows none. With a third member, phone A's bar shows "3 ׳לא ברור׳ · ש׳ …",
  and the callout with "לעצור ולהסביר" sits in the text, right after the
  paragraph.
- At a part's last paragraph, phone A sees "עצירה: שאלה אחת על החלק".
  After the reading, "מבחן קבוצתי על מה שנקרא · 5 שאלות" opens the closing
  quiz on both phones.
- A second reader on another phone gets "ההקראה פעילה בטלפון אחר. אפשר
  לעקוב אחריה.".

**The pre-guess and catch-up** (`VITE_STUDY_GUESS`):
- The band shows "ניחוש לפני · 2 שאלות". Phone B guesses before the
  reading. When the reading reaches that paragraph, phone B sees "דינג!
  התשובה לניחוש 1" with its own line and "רק לך".
- A member who missed the meeting (a third phone, or phone B on a meeting it
  did not follow) sees "פגישה שפספסת" on "יחד" once the meeting is over.
  The catch-up opens with "בפרק הקודם של תמצית…". After "להתחיל השלמה" to
  the end, the lecture shows as read for them the next study day, at the
  meeting's time.

**The ledger**, after the checks above:

```sql
select kind, count(*), round(sum(cost_usd), 3) as usd, count(*) filter (where settled_at is null) as open
  from public.study_usage
 where kind in ('points', 'var', 'mnemonic', 'wall_check') and created_at > now() - interval '1 hour'
 group by 1 order by 1;
```

`open` must be 0.

### 7. Tell the group

Ask each member to close the app and open it again (on an iPhone, swipe
the Home Screen app away), so no phone keeps release 3's code. Tell them
what decision 1 means (`DECISIONS-2026-11-17.md`, "What it means for
members"):

- a member is the phone they joined from;
- clearing the browser's data, a new phone, or "יציאה מהמכשיר הזה" starts
  fresh;
- on an iPhone, use the Home Screen icon, not a Safari tab.

## What to watch

In the SQL Editor, during the first days:

```sql
-- The read ahead: lectures whose parts were read ahead, by day, and what it cost
select date_trunc('day', created_at) as day, count(*) as calls, round(sum(cost_usd), 2) as usd
  from public.study_usage where kind = 'points' and user_id is null group by 1 order by 1 desc;
-- Parts a read ahead could not save (they wait for a member's "לנסות שוב")
select l.title, p.part_idx, p.error from public.study_point_parts p join public.study_lectures l on l.id = p.lecture_id
 where p.ahead_at is not null and p.status = 'failed';
-- Yellow cards still open
select l.title, d.state, d.created_at from public.study_disputes d join public.study_lectures l on l.id = d.lecture_id
 where d.state in ('open', 'judged') order by d.created_at;
-- The month's spend by kind; "points", "var", "mnemonic" and "wall_check" are new
select kind, count(*), round(sum(cost_usd), 2) from public.study_usage
 where created_at >= date_trunc('month', now()) group by 1 order by 3 desc;
-- Reservations that never settled (a call died)
select kind, count(*) from public.study_usage
 where settled_at is null and created_at < now() - interval '15 minutes' and created_at >= date_trunc('month', now()) group by 1;
```

## Rolling back

Use the smallest rollback that fixes the problem.

- **The read ahead alone.** No redeploy:

  ```sql
  update study_private.features set enabled = false, changed_at = now() where name = 'points_ahead';
  ```

  Members read the points on a tap, as in release 3. Set it back to `true`
  to turn it on again.
- **One feature.** Vercel → Environment Variables → delete
  `VITE_STUDY_VAR`, `VITE_STUDY_WALL`, `VITE_STUDY_MEETING` or
  `VITE_STUDY_GUESS` (or set it to `0`) → Redeploy.
  - Its entries disappear, and a link to its screen lands on its lecture
    (or the library) with "התכונה הזו עוד לא פתוחה.".
  - Its rows stay in the database for when it comes back: cards and
    verdicts, wall entries, meetings, taps and guesses.
  - A pinned "פסיקת VAR" box and an applied correction stay in the summary.
  - The spread keeps marking questions and cards after approved
    corrections: it is section V's trigger, not VAR's flag. Members bring
    a card back from the deck and a question from the paragraph's "תרגול"
    tab. If `VITE_STUDY_ANCHOR` is off while `VITE_STUDY_CORRECTIONS` is
    on, turn the questions' marks off (no redeploy):

    ```sql
    update study_private.features set enabled = false, changed_at = now() where name = 'spread_questions';
    ```
- **The whole release (last resort).** Vercel → Deployments → the last
  Production deployment before the merge → ⋯ → Promote to Production
  (instant rollback). Then ask the group to reopen the app.
  - Release 3's code works with this SQL. Every function, column and grant
    it uses is unchanged.
  - Leave the SQL as it is. Before this release is deployed again, nothing
    has to change in it.
  - With release 3's worker, a finished summary's kick answers 400, so
    nothing is read ahead. Turn the switch off (above) if you prefer no
    kicks at all.
- **Never run an older `study-schema.sql`** (from `main` before this
  release, from `study/wave3`, or from any `study/w4-*` branch). It would
  take back the worker's path in `study_points_save` and
  `study_points_fail`, so a read ahead could never save. It would also put
  back Z's stub for the meeting's quiz presets. If it was run by mistake,
  run this release's file again.
- **Never** drop tables. Never run Supabase's sample clean-up of anonymous
  users: every member is an anonymous user (decision 1), and it would
  delete the group with its creator.

## What was tested (on `study/wave4`; local only)

No production, no real Supabase project and no real Anthropic call were
used, and no group was created anywhere real.

**The merge.** `study/w4-b` (B), `study/w4-v` (V), `study/w4-j` (J) and
`study/w4-m` (M) were merged in that order on top of `study/wave3`
(484b28a). The conflicts, and how each was resolved keeping both sides:

- **The registry test** (`src/study/lib/route.test.ts`): it now expects B,
  V, J and M at 1 beside wave 3's sections. It checks every package's
  flags against the SQL: V's with corrections, J's, M's two on release 2's
  set, and all of wave 4's together.
- **The seeded ops** (`server/study/ai.test.ts`): `var`, `mnemonic` and
  `wall_check` are built now, so they left the 501 list. The schema test
  runs each of them without its section.
- **`server/study/limits.ts`**: VAR's constants and the wall's, both kept.
- **`docs/study/README.md`**: both packages' lines.
- **The e2e mock** (`e2e/study/mock.cjs`): each package's flag set (`v`,
  `j`, `m`), and a new set `w4` for wave 4. It is wave 3's set with the
  anchor, plus `VAR`, `WALL`, `MEETING` and `GUESS`, against this branch's
  real SQL registry.
- **`e2e/study/schema-dump.json`**: written again by `npm run
  test:contract` from the merged SQL. It holds every function, column and
  grant each package's own dump had.
- **The SQL merged without a conflict.** Each package's lines sit between
  its own section's markers, in the file's order (F A W Q Z C K P M N V U J
  H B G E T). Sections B, V, J and M are byte for byte their branches'.
  B also changed section Q's `study_points_save` and `study_points_fail`
  (the worker's path) and F's list of worker functions, as on its branch.
- `shared/study/flags.ts`, `lib/helpCopy.ts`, `lib/failText.ts`,
  `features/collab.tsx`, `e2e/study/collab.cjs`: merged without a
  conflict. The paragraph sheet keeps one frame: תגובות · תיקון ·
  אסוציאציה · תרגול, each tab with its flag.

**Fixed at the merge** (each found by a check, then fixed):

- **The SQL checks stopped at J** (`supabase/tests/study.sql`). V's checks
  delete their four members at the end, but they left the last one's
  identity set. J's checks then inserted a card as postgres, whose
  `created_by` defaults to `auth.uid()`, and the insert failed on the
  foreign key. V's clean-up now resets the claim, as the other sections'
  checks do.
- **A test that failed two runs in five** (`server/study/work.test.ts`,
  B's). Parts 1 and 2 of the read ahead are read at once, so their two
  ledger rows land in either order. The test now compares those two sorted
  by part and every other row in order, with the same contents.

**The review's last round** (each finding checked here first; all ten were
real, and each fix has a check):

| Finding | What changed | Its check |
|---|---|---|
| M-DING-CLIPPED: "דינג!" ran past the screen's start edge; the toast covered it | the card sits against the follower's sticky bar, gutter to gutter; the toast moves to the top while it shows | meeting.cjs: the card inside the gutters and "הבנתי" whole at 390 and 360; the toast never over it |
| M-READER-CARD-COVERS: the reader's card filled the sticky top (58% of a 640-px screen) | one line in the reader's bar ("N עוקבים", "3 ׳לא ברור׳ · ש׳ 2" that scrolls to it, the part's stop); the callout and the warning in the text, right after their paragraph (meeting.html s3) | meeting.cjs: the sticky top under 35% at 390 and 360 (with the callout and with a proposal); the callout and the warning right after their paragraphs; the pointer scrolls to it |
| M-SHARED-LABEL-TWICE | "ההקראה שלך משותפת" once, in the room bar; while the meeting's bar shows, the room bar leaves out who is here, so the line stays whole | meeting.cjs: once, and not cut, at 390 and 360 |
| V-APPROVE-BELOW-FOLD | "לאשר" shares the row with "לא מסכימים: כרטיס צהוב" (corrections.html s1) | var.cjs: beside it at 390 and 360, on screen at 390 |
| J-VOTE-TEXT-TOP | the votes are a-up pills again; an `::after` gives the 44-px target | wall.cjs: a pill at most 28 px high with its label centred; a11y's 44-px check passes |
| J-SPOT-CHIP-GAPS | the "לפסקה: …" chip is one inline run, so "ה-NKCC2" stays together | wall.cjs |
| J-MOMENT-PIN-OFFSCREEN | the slide's picture is a 96-px thumbnail in the moment sheet | wall.cjs: "לנעוץ" on screen at 390 (at 360×640 the sheet scrolls to it, as other sheets there) |
| SEC4-1: nothing could bring a marked question back | "עדיין נכון" under a marked question (and card) in the paragraph's "תרגול" tab; the switch `spread_questions` (on) | SQL V8c2, V8f, V8g; var.cjs: an approved correction marks the question, "עדיין נכון" puts it back in "לתרגל את הפסקה" |
| SEC4-2: a started meeting could be moved to another lecture, and an aloud approval landed on it | `study_meeting_save` answers "meeting started" for a new lecture, parts or day once started; the sheet locks those fields | SQL SR4-2 to SR4-2d |
| SEC4-3: two phones' "תנו לי 3" at once both paid | `study_aid_drafts_begin` holds the text before the reservation ("busy" 409 to the other phone, which then shows the drafts free); saving or a failure releases it | wall.test.ts (two at once: one reservation, one call, one 409); SQL J18 to J18g |

| Test | Result |
|---|---|
| `npm run test:study` | 631 tests, 631 pass, 0 fail |
| `npm run test:contract` | 157 RPC calls and 99 table chains in 173 files match the schema (211 study functions, 54 study tables); 14 of the browser's written columns are granted to a member |
| `npm run build` | passes; the study entry 324.46 kB (limit 400 kB); in the e2e builds 324.49 kB with no flags, 324.56 kB with production's, 324.65 kB with wave 3's, 324.73 kB with all of wave 4's |
| `npm run test:bundle` | the study entry 336,043 bytes with every flag on (limit 400,000); no package screen in it. M's, V's and J's shares 3,753, 2,617 and 6,121 B; W's, C's and K's over the 8 kB guide, as in release 3 |
| The whole SQL loaded twice (stubs, board, `study-schema.sql` × 2) on a throwaway Postgres 16 | 0 errors; `supabase/tests/study.sql` exits 0 with 0 FAIL and 0 ERROR (1,102 lines of output, 647 of them "ok"); `{"B": 1, "C": 2, "F": 1, "J": 1, "K": 2, "M": 1, "N": 1, "Q": 2, "V": 1, "W": 2, "Z": 2}` |
| The upgrade: `study/wave3`'s `study-schema.sql` with data (its own checks with 0 FAIL, then a lecture with a written part, a question and a card on a paragraph, and a failed points row), then this file twice | 0 errors each time; the registry goes from `{"C": 2, "F": 1, "K": 2, "N": 1, "Q": 2, "W": 2, "Z": 2}` to the one above; all 38 rows of the 36 tables kept, and the content of the lectures, parts, questions, cards, members and points rows unchanged (the same hash); 18 new tables, empty; `ahead_at` added; `points_ahead` and `spread_questions` on; the holds table made |
| The contract of release 3's code on this SQL | every function's arguments, every column and every member grant in `study/wave3`'s schema dump is unchanged in this one |
| Health's `schemaOk` (`healthSchema` of this code) | true with the flags off, production's, release 2's and wave 3's, on release 3's SQL and on this one; with all of wave 4's flags, true on this SQL only (it asks M, N, V and J), hence step 1 before step 5 |
| `supabase/tests/writing-concurrency.sh` | WK1 to WK4 as expected |
| `supabase/tests/quiz-concurrency.sh` | K2 to K3c as expected |

The e2e flows ran on a mocked Supabase, on the branch's final code, in four
builds:

- `off`: every flag off;
- `rel1`: production's flags (`QUESTIONS`, `PRACTICE`, `CARDS`);
- **wave 3**: release 2's four with `ANCHOR`, `CORRECTIONS` and `ASK` (the
  set `k` with `E2E_ANCHOR=1`);
- **wave 4**: wave 3's with `VAR`, `WALL`, `MEETING` and `GUESS` (the set
  `w4`).

In the wave 3 and wave 4 builds, the release scripts (`cards`, `practice`,
`quiz`) ran as `rel2`, and `ahead` as `k`, as in release 3. Every
screenshot was checked by `a11y.cjs` in light and dark at 390×844 and
360×640. Every script exited 0, with no page error, no unmocked or refused
call, and no accessibility problem. The cell's number is the script's
checks that read "ok"; `summary`, `together` and `collab` check by waiting
for each step instead.

| Script | off | rel1 | wave 3 | wave 4 |
|---|---|---|---|---|
| `ahead.cjs` (B) | pass, 3 ok (practice off) | pass, 11 ok | pass, 11 ok | pass, 11 ok |
| `anchor.cjs` | pass, 3 ok | pass, 3 ok | pass, 18 ok | pass, 18 ok |
| `cards.cjs` | pass, 2 ok | pass, 26 ok | pass, 26 ok | pass, 26 ok |
| `collab.cjs` | pass (nothing of K) | pass | pass: 0 part writes, 0 refused | pass: tabs תגובות · תיקון · אסוציאציה · תרגול, 0 part writes, 0 refused |
| `meeting.cjs` (M) | pass, 4 ok (nothing of M) | pass, 4 ok | pass, 4 ok | pass, 53 ok |
| `practice.cjs` | pass, 3 ok | pass, 57 ok | pass, 57 ok | pass, 57 ok |
| `quiz.cjs` | pass, 2 ok (quiz replaced) | pass, 2 ok (quiz replaced) | pass, 47 ok | pass, 47 ok |
| `shell.cjs` | pass, 31 ok | pass, 30 ok | pass, 31 ok | pass, 31 ok |
| `summary.cjs` | pass | pass | pass | pass |
| `together.cjs` | pass | pass | pass | pass |
| `upload.cjs` | pass, 5 ok | pass, 5 ok | pass, 5 ok | pass, 5 ok |
| `var.cjs` (V) | pass, 4 ok (nothing of V) | pass, 4 ok | pass, 5 ok | pass, 37 ok |
| `wall.cjs` (J) | pass, 5 ok (nothing of J) | pass, 5 ok | pass, 5 ok | pass, 36 ok |
| `writing.cjs` | pass, 42 ok | pass, 42 ok | pass, 42 ok | pass, 42 ok |

Known gaps:

- At 360×640 the moment sheet ("לנעוץ רגע") with a picture attached is
  taller than the screen, so "לנעוץ" is reached by scrolling the sheet (at
  390×844 it is on screen). A sticky bar would cover the sheet's own
  fields, which a11y.cjs refuses.

- Only production can show some things:
  - the first live answers of VAR, the wall's drafts and the winner's
    check, and their real costs against the ledger;
  - the read ahead kicked by Supabase's pg_net on a real summary;
  - two real phones seeing a yellow card, a wall entry and a reading live.
- The mock's meeting has no wall moment, so catch-up's "אסוציאציה
  שננעצה" was checked only in SQL (M12c, with section J loaded: one memory
  aid in the pack).
- With two phones, backing (from 3), the reader's "לא ברור" count (from
  3), the wall's winner (2 votes from others) and "עדכון" (a member who is
  neither the author nor the approver) need a third member. The e2e runs
  had five to seven members.
- Without section U, the pulse's parts stay hidden: "דרושה אסוציאציה", the
  agenda's hot spot, and the reader's warning that most of the group
  guessed wrong.
