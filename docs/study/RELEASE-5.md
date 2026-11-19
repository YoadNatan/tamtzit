# תמצית, release 5: Today, progress and the pulse, then the end-of-semester extras

Release 5 is everything on the branch `study/wave5` beyond release 4
(`RELEASE-4.md`). It assumes releases 3 and 4 are done: `RELEASE-3.md`,
then `RELEASE-4.md`, each to its last step. It carries two groups of
features, each behind its own flags:

- **The approved plan's release 8**, without the account (decision 1):
  progress and "הטעויות שלי" in another wording (A2, Q-2), the in-app card
  review (C), Today (T-1), and the pulse (U-1, U-2).
- **Phase 3's extras, usable early** (decision 3): the trap museum (U-3), the
  boss battle (H-1), the group's marathon plan and marathons (G), "הקבוצה
  צריכה אותך" (T-2), the exam-eve view, the blank table (P10) and a member's
  own trap (P11).

It follows Yoad's decisions of 17 November 2026
(`DECISIONS-2026-11-17.md`): no email accounts, and the extras open early
with a meter. This page is Yoad's production steps, in order, what to check
on two or three phones, what the meters should say on a young group, and
how to roll back. It replaces the production steps of `progress.md`,
`pulse.md`, `today.md`, `boss-museum.md`, `plan.md` and `extras.md`:
follow this page, not theirs.

## What is in the release

**Live at the merge, under production's flags, with no flag change:
nothing a member sees.** The SQL adds sections and functions, and the code
adds screens behind flags that are unset. Two things run on the server from
step 1, both quiet:

- The pulse's night is scheduled (pg_cron `study-pulse-night`, 02:17 UTC),
  but its switch `pulse` is **off**. Off, the night counts nothing and every
  pulse, museum, trap and boss output is hidden, whatever the flags.
- `study_questions` gains two empty columns for a member's own trap
  (`author_id`, `unmasked_at`), and its "Claude's or an exam item" check is
  replaced by one that also allows a member's checked trap. No existing row
  changes.

**Step 5 (release 8), each behind its own flag:**

- **`VITE_STUDY_PROGRESS`: "ההתקדמות שלי" and "הטעויות שלי"** (A2, Q-2;
  `progress-pulse.html` s1, `practice.html` s2). Only the member's own rows,
  "רק לך".
  - Readiness per part as a range ("{lo}–{hi}%") from 20 first answers a
    day in 28 days; below that the row says how many more ("{n}/20").
  - "רשימת הסכנה": every wrong "על בטוח" answer, with when it comes back
    ("מחר", "עוד N ימים"); it leaves after two right "על בטוח" answers on
    two later days.
  - "לפי היבט" (חם · פושר · יושב טוב) from 4 questions, the calibration
    ring from 20 "על בטוח" answers.
  - "הטעויות שלי" asks an earlier mistake first, in another wording
    ("בניסוח אחר"), when its paragraph has another question. A miss says
    "חוזרת מחר בניסוח אחר".
- **`VITE_STUDY_CARDS_REVIEW`: the cards reviewed in the app** (C's end,
  `cards.html` s1-s2; needs `VITE_STUDY_CARDS`). The queue with private
  cards first, "מאיפה זה?", the review home asked once (Anki or the app).
- **`VITE_STUDY_TODAY`: "היום" as the home** (`today.html` s1-s2). The tabs
  become היום · ספרייה · יחד · שלי.
  - The day's meeting and a missed meeting's catch-up.
  - "התור שלי" cut to 10, 20 or 45 minutes from one table: updates, the
    group quiz's returns, the danger row, "בניסוח אחר", "לא ברור", due
    cards, and (with their flags) the boss's loot, "רק אצלך חם" and the
    private lane. Each row shows only with its own flag.
  - The flame ("להבה 4/7", the member's own), "בקבוצה", and one session that
    runs the queue and leads back to Today.
- **`VITE_STUDY_GUESS`** (wave 4's M-2), if it is not on yet: the pre-guess
  and catch-up. It needs `VITE_STUDY_MEETING`.
- **`VITE_STUDY_PULSE` and the switch `pulse`: the group's pulse** (U-2,
  `progress-pulse.html` s2; needs `VITE_STUDY_PROGRESS`).
  - Each lecture's topics as חם · פושר · יושב טוב, in words only, counted
    each night from members who joined a week before. A word shows only
    where at least 3 different members practised. "אצלך" (the member's own)
    shows at any count.
  - The card on "יחד", "הפסקה הזאת קשה לנו" in a paragraph's chip row,
    "דרושה אסוציאציה" on the wall, the meeting agenda's hot spot, and the
    group quiz's and practice's hard questions first.
  - "לא לכלול אותי בדופק" under "שלי" → הגדרות. A member who opts out is
    neither counted nor shown the pulse.

**Step 7 (the extras), each behind its own flag, any time (decision 3).
Each opens at once with what there is, and a meter of what more is needed:**

- **`VITE_STUDY_MUSEUM`: traps and the museum** (U-3, `museum.html`; needs
  the pulse and `VITE_STUDY_CARDS`).
  - A trap is a wrong option at least 3 counted members chose. It opens the
    next study day, and its card ("מלכודת של הקבוצה") joins every deck.
  - An exhibit is a trap at least 3 members chose "על בטוח". The museum
    shows it with "בלי שמות", and it retires ("בפנסיה") once everyone
    active is right on two different days.
  - The vaccine's chip in the card review ("חיסון · ממוזיאון המלכודות"),
    the card on "יחד", and a meeting that opens with one exhibit.
  - The plaque written by Claude is not built (its prompt needs a live check
    first). The museum shows the exhibit's own text, at no cost.
- **`VITE_STUDY_BOSS`: the boss battle** (H-1, `boss.html`; needs the pulse
  and `VITE_STUDY_QUIZ`).
  - Its heads are the chosen lectures' hot topics, then the museum's
    exhibits: 2 to 4 heads. It needs at least 3 players.
  - The battle runs on the group quiz with a HUD (hit points, the trap's
    −20, relapses). A round counts from 3 answers. Lost: a revenge round the
    next study day, never a defeat screen.
  - The end shows moments without names, and the private loot ("השלל שלך"),
    which comes back in Today as "מהקרב".
- **`VITE_STUDY_MARATHONS` and `VITE_STUDY_GROUP_PLAN`: marathons and the
  group's plan** (G, `plan.html`).
  - `MARATHONS` alone: the marathons' list, a run-of-show with "אני בפנים ·
    אולי · לא הפעם", "להתחיל" / "הבלוק הבא" / "סיום", and new and edit.
  - With `GROUP_PLAN`: the plan from the exam's date and its lectures
    ("לבנות תוכנית"). Its days are saved as marathons, a day that slipped
    offers two prices with the name of whoever chose, and "המסלול שלך · רק
    לך" also shows on "שלי" and as Today's row 9.
- **`VITE_STUDY_NEEDS_ME`: "הקבוצה צריכה אותך"** (T-2; needs
  `VITE_STUDY_TODAY`). Off for each member until they turn it on in "שלי" →
  הגדרות. An open question of another member reaches one member who mastered
  its topic, with why, "גלוי רק לך".
- **`VITE_STUDY_EVE`: the exam-eve view** (needs `VITE_STUDY_PROGRESS`).
  "הלילה שלפני · {lecture}" shows the lecture's own summary slide, the
  member's associations, and their own "על בטוח" mistakes. It makes no
  AI call.
- **`VITE_STUDY_BLANK_TABLE`: "טבלה ריקה"** (P10; needs `VITE_STUDY_PRACTICE`
  and `VITE_STUDY_CARDS`). A slide's table is filled from memory, row by row.
  A wrong cell becomes the member's private card. It costs nothing.
- **`VITE_STUDY_TRAPS`: "מלכודת משלי"** (P11; needs `VITE_STUDY_QUESTIONS`).
  - A member writes a trap question, and op `trap_check` checks it against
    the slides, about $0.03, 5 a day each.
  - A passed trap goes into everyone's bank without its author. The
    author's name shows only after it is asked in a group quiz.

**The SQL** raises U to 2 and T to 3, and adds P at 2, H at 2, G at 2 and
E at 1 beside release 4's sections. It changes no existing row. Release 4's
code works on it (step 1).

**Not in this release:** accounts. Decision 1 withdrew them, so
`VITE_STUDY_ACCOUNT` stays unset and no email service is needed. Also not
in it: the museum's plaque by Claude, narrated attacks in the boss's HUD,
`VITE_STUDY_QUIZ_ROUNDS` (Q11 is a design only; leave it unset), and the
recordings' exam marks in the plan (the recordings switch is off).

## Before you start

- Release 4 is live:
  https://tamtzit.vercel.app/api/study/health answers
  `"schemaOk":true` and `"workerOk":true`, with
  `"schema":{"B":1,"C":2,"F":1,"J":1,"K":2,"M":1,"N":1,"Q":2,"V":1,"W":2,"Z":2}`.
- Nothing new to set up outside Supabase and Vercel: no key, no secret, no
  email service. The only new spend is op `trap_check` (step 7), through the
  ledger and inside the month's cap.

The project is the Supabase project `/` already uses. Never create a
group anywhere: the group exists, and only one can exist.

## The steps, in order

### 1. Supabase: run the SQL of this release, before the merge

SQL Editor → paste **the whole** `supabase/study-schema.sql` **from the
branch `study/wave5`** → Run. Claude gives you the link once the branch is
pushed (on GitHub, open the file → "Copy raw file"). Don't use the file from
`main`, from `study/wave4` or `study/wave3`, or from any `study/w5-*`
branch: each of those lacks part of this release. The file can be run again
safely.

- **Expected:** it finishes without an error. NOTICEs like "… already
  exists, skipping" or "… does not exist, skipping" are harmless.
- **Check the registry:**

  ```sql
  select public.study_schema();
  ```

  It must answer
  `{"B": 1, "C": 2, "E": 1, "F": 1, "G": 2, "H": 2, "J": 1, "K": 2, "M": 1, "N": 1, "P": 2, "Q": 2, "T": 3, "U": 2, "V": 1, "W": 2, "Z": 2}`.
  E, G, H, P, T and U are new, and nothing else changes.
- **Check the switch and the night** (`pulse` must say `false` for now, and
  the job must be listed):

  ```sql
  select name, enabled from study_private.features where name = 'pulse';
  select jobname, schedule from cron.job where jobname = 'study-pulse-night';
  ```

- **Check what is published for Realtime** (it must list
  `study_group_plans`, `study_marathon_people`, `study_marathons`):

  ```sql
  select string_agg(tablename, ', ' order by tablename) from pg_publication_tables
   where pubname = 'supabase_realtime'
     and tablename in ('study_marathons', 'study_marathon_people', 'study_group_plans', 'study_traps',
                       'study_boss_battles', 'study_loot', 'study_trap_drafts', 'study_member_prefs',
                       'study_pulse_topics', 'study_pulse_optout');
  ```

  The pulse's words, the traps, battles, loot, drafts and preferences are
  never published.
- **Until step 2's deploy, today's app works as before:**
  - Release 4's code calls no function whose arguments changed, reads no
    column that went away, and writes nothing a grant now refuses. Every
    function, column and grant in release 4's contract is the same in this
    file.
  - Release 4's code needs at most F 1, W 2, Q 2, Z 2, C 2, K 2, M 1, N 1,
    V 1 and J 1. This file keeps all of them, so health stays
    `"schemaOk":true`.
- **What the file changes** (no existing row changes; 18 new tables, all
  empty):
  - **P at 2** (A2): reading progress and the reading log
    (`study_read_parts`, `study_read_places`), the private plan's three
    tables, marathons and who is in (`study_marathons`,
    `study_marathon_people`, published), and the progress functions (the
    danger list, readiness, aspects, calibration, rewordings), each
    answering the caller's own rows only.
  - **U at 2** (U-1, U-2, U-3):
    - the pulse's private counts (`study_private.pulse_*`) and the words
      members read (`study_pulse_topics`, `_questions`, `_cards`,
      `_spots`), the opt-out table, the switch `pulse` (off), and the night's
      pg_cron job;
    - the traps (`study_traps`), their cards through section C, and the
      museum's functions;
    - section Z's `study_quiz__signal` and section M's hot-spot stub,
      replaced with the same arguments.
  - **H at 2**: `study_boss_battles`, of which members read only a
    battle's plain facts (its name, lectures, hit points and outcome, never
    its heads, planned rounds or log), `study_loot` (owner-only), and the
    boss's functions. Section Z's three boss hooks are filled in, with the
    same arguments.
  - **G at 2**: `study_group_plans` (published), two columns on
    `study_marathons` (`plan_id`, `plan_day`), and the plan's functions and
    meter. The meter counts answers up to the start of the study day (04:00
    Israel time), as the pulse does, so today's practice shows tomorrow.
  - **E at 1**:
    - `study_trap_drafts` (owner-only);
    - the two columns on `study_questions`, with the check replaced as above;
    - the trap's submit and check functions, and `study_slide_tables`;
    - section Z's `study_quiz__revealed` hook, which names a trap's author
      at a group quiz's reveal.
  - **T at 3**: Today's functions (`study_today` and its parts),
    `study_member_prefs` (owner-only), and T-2's functions and meter. A
    question "הקבוצה צריכה אותך" brings a member is not listed again under
    "בקבוצה".

### 2. Merge, which deploys

Tell Claude that step 1 is done. Claude merges `study/wave5` into `main`,
and Vercel deploys `main` to Production.

**Keep the order.** With production's flags, this code needs only what
release 4's SQL already has (health asks for F 1, W 2, Q 2, C 2 and K 1),
so health stays
`schemaOk` either way. But every flag of steps 5 and 7 needs step 1's
sections, and op `trap_check` answers 503 "schema" without section E.

### 3. Check health

Once the deploy is live, open
https://tamtzit.vercel.app/api/study/health. It should answer:

```json
{"ok":true,…,"worker":true,"workerOk":true,"budgetUsd":33,"schema":{"B":1,"C":2,"E":1,"F":1,"G":2,"H":2,"J":1,"K":2,"M":1,"N":1,"P":2,"Q":2,"T":3,"U":2,"V":1,"W":2,"Z":2},"schemaOk":true,…}
```

| If | Then |
|---|---|
| `"schemaOk":false` | Step 1 did not run on this project, or stopped half-way. Run the whole file again (step 1), then reload health. |
| `"workerOk":false` | Vault's `study_worker_key` is not the same value as Vercel's `STUDY_WORKER_KEY` (`RELEASE-2.md`, "Before you start"). No redeploy is needed once Vault is right. |
| The page is the old one | The deploy isn't live yet. Wait a minute and reload. |

Go on only when `schemaOk` and `workerOk` are `true`.

### 4. Check on a phone that nothing changed yet

Open the app. It still opens on the library, with the same tabs and the same
practice, cards and group quiz as before. Nothing in this release shows
until its flag is on.

### 5. Turn on release 8's flags, then the pulse's switch

Vercel → Settings → Environment Variables → **Production**. Keep
production's flags as they are, and add:

| Name | Value | Needs (step 1 gave all of the SQL) |
|---|---|---|
| `VITE_STUDY_PROGRESS` | `1` (new) | P 2 (and Q 2 for "הטעויות שלי", with `VITE_STUDY_PRACTICE`) |
| `VITE_STUDY_CARDS_REVIEW` | `1` (new) | C 2; `VITE_STUDY_CARDS=1` |
| `VITE_STUDY_TODAY` | `1` (new) | T 1 |
| `VITE_STUDY_PULSE` | `1` (new) | U 1 and P 2; `VITE_STUDY_PROGRESS=1` |
| `VITE_STUDY_GUESS` | `1`, if it is not set yet (`RELEASE-4.md` step 5) | M 1; `VITE_STUDY_MEETING=1` |

Then Deployments → the latest Production deployment → ⋯ → **Redeploy**.
The flags are built into the app, so nothing changes until the redeploy.

Once the redeploy is live, turn the pulse on in the SQL Editor:

```sql
update study_private.features set enabled = true, changed_at = now() where name = 'pulse';
```

The first member who opens the pulse (or pg_cron at 02:17 UTC) counts
everything up to the start of today's study day (04:00 Israel time). After
that it counts once a night.

- A flag without what it needs shows nothing. `PULSE` without `PROGRESS`,
  `CARDS_REVIEW` without `CARDS`, and `GUESS` without `MEETING` each stay
  off.
- Set no other `VITE_STUDY_*` variable in this step. In particular, never
  set `VITE_STUDY_ACCOUNT` (decision 1).
- Never set a `VITE_STUDY_*` flag on Preview: Preview deployments share the
  production database.

After the redeploy, health again shows `"schemaOk":true` (step 3).

### 6. Check release 8 on two phones

Use two phones (two members, A and B) on a lecture with questions and
cards. Some steps need a third member, and are marked so.

**Today** (`VITE_STUDY_TODAY`):
- `/` opens "היום · יום …" with the tabs היום · ספרייה · יחד · שלי.
- "התור שלי" with "רק לך" and the chips 10 · 20 דק׳ · 45. Each chip cuts the
  queue again; the choice stays on the phone.
- "להתחיל · {n} דק׳" runs the queue in one session ("{done}/{total}", "→
  להיום"), and its end says "התור של היום הושלם. מה שנשאר עובר למחר.".
- The flame: a tap says "… מתוך 7 הימים האחרונים … גלוי רק לך.".
- A member's open question shows on the other phone under "בקבוצה".
- An empty queue says "אין כלום בתור כרגע." with "תרגול חופשי": never a dead
  end.

**Progress and mistakes** (`VITE_STUDY_PROGRESS`):
- Phone A answers a question wrong "על בטוח". "שלי" → "ההתקדמות שלי": the
  danger list shows it with "מחר", with "רק לך". Phone B's progress does not
  show it.
- A part with few answers says how many more ("{n}/20"), never a blank.
- Next study day: Today's queue on phone A has "1 מרשימת הסכנה, בניסוח
  חדש", and "הטעויות שלי" asks it in another wording ("בניסוח אחר") when
  its paragraph has another question.

**The card review** (`VITE_STUDY_CARDS_REVIEW`):
- A lecture's deck → review. The first time it asks where to review (the app
  or Anki), once. In the app, "הבא בתור" and "מאיפה זה?" work, and the end
  offers "להיום".
- Today's queue counts the same cards as the review's own queue.

**The pulse** (`VITE_STUDY_PULSE`, the switch on):
- "יחד" shows the pulse's card, or its meter. A lecture's pulse (from the
  lecture or "יחד") shows the sections that have words, each row with
  "אצלך" on the left. Below the floor it shows the meter (see "What the
  meters should show").
- Phone B: "שלי" → הגדרות → "לא לכלול אותי בדופק". Its pulse screen says
  "התשובות שלך לא נספרות בדופק, ולכן גם הדופק לא מוצג." and its card goes.
  Turn it back on: the pulse returns after the next night's count.
- A member who joined less than a week ago sees "הדופק ייפתח לך בעוד N
  ימים".
- With a meeting planned on a lecture with a hot topic, its agenda shows
  "נקודה חמה: …".

### 7. Turn on the extras, when you choose

Any time after step 5 (decision 3), one at a time if you like. Vercel →
Environment Variables → **Production**:

| Name | Value | Needs (step 1 gave all of the SQL) |
|---|---|---|
| `VITE_STUDY_MUSEUM` | `1` (new) | U 2; `PULSE` (with `PROGRESS`) and `CARDS`, and the switch `pulse` on |
| `VITE_STUDY_BOSS` | `1` (new) | U 2 and H 2; `PULSE` (with `PROGRESS`) and `QUIZ`, and the switch on |
| `VITE_STUDY_MARATHONS` | `1` (new) | P 2 |
| `VITE_STUDY_GROUP_PLAN` | `1` (new) | G 2; `MARATHONS` |
| `VITE_STUDY_NEEDS_ME` | `1` (new) | T 3; `TODAY` |
| `VITE_STUDY_EVE` | `1` (new) | P 2; `PROGRESS` (and `WALL` for the associations) |
| `VITE_STUDY_BLANK_TABLE` | `1` (new) | E 1; `PRACTICE` and `CARDS` |
| `VITE_STUDY_TRAPS` | `1` (new) | E 1; `QUESTIONS` (and `QUIZ`, for the author's name to ever show) |

Then **Redeploy**, as in step 5.

- Leave `VITE_STUDY_QUIZ_ROUNDS` and `VITE_STUDY_ACCOUNT` unset.
- **Read the first live `trap_check` answer before telling the group**
  (§12.7.7). Its prompt needs the real model, so it was checked here only
  against mocks: check that the explanations follow the slides, name no
  option by its letter, and that the ledger row settled (end of step 8).
- The switch `pulse` must stay on for the museum and the boss. Off, both say
  "התכונה הזו כבויה כרגע בשרת.".

After the redeploy, health again shows `"schemaOk":true` (step 3).

### 8. Check the extras on two or three phones

Several extras exist to keep anything anonymous from fewer than 3 members,
so their full screens need a third member. With two phones, check that the
meter says how many more are needed (the next section).

**The museum** (`VITE_STUDY_MUSEUM`):
- "יחד" shows the museum's card with its meter. `?v=museum` opens "מוזיאון
  המלכודות" with "רק טעויות ׳על בטוח׳ של לפחות 3 מכם · בלי שמות" and the
  footer "מוצג נפתח רק למחרת, כדי שאי אפשר יהיה לנחש מי.".
- Empty: "מוצג נולד כש-3 מכם בוחרים ׳על בטוח׳ באותה תשובה שגויה." with the
  meter and "לתרגל".
- *Three phones:* the same question, the same wrong option, "על בטוח" on
  each. After the next night: the trap's card ("מלכודת של הקבוצה") is in
  every deck, and the next study day the exhibit hangs in the museum, with
  the vaccine's chip in the card review.

**The boss** (`VITE_STUDY_BOSS`):
- "יחד" → the boss's card → `?v=boss&new=1`: the lectures, the heads a
  battle would have now, the meter, and "קרב צריך לפחות 3 משתתפים: מתחת
  לזה כל פגיעה הייתה מגלה מי טעה.".
- Below 2 hot topics: "הקרב נפתח משני נושאים חמים: עוד …" with "לתרגל", and
  "לפתוח את הקרב" waits.
- The meter's bar fills what its line says: "3 מתוך 8 נושאים חמים" fills
  3/8; below the floor, "עוד אדם אחד וזה נפתח" fills 2/3. One head reads
  "ראש אחד", and no heads shows no chip.
- *Three phones, with 2 hot topics:* "לפתוח את הקרב" opens the group quiz's
  lobby. The HUD sits above the clock ("ראש 1/2", both bars). The end shows
  "רגעי הקרב · של הקבוצה, בלי שמות", and each phone's own "השלל שלך". Its
  mistakes come back in Today as "מהקרב".

**Marathons and the plan** (`MARATHONS`, `GROUP_PLAN`):
- "יחד" → "לבנות תוכנית": the exam's name, date and lectures, then save. The
  plan's day shows "מרתון · {title}", "יום n/N", the group lane with "שינוי
  אחרון: {name}", "המסלול שלך · רק לך", and the meter "התוכנית מדייקת ככל
  שמתרגלים: N מתוך M הרצאות עם נתונים". The meter counts up to the start
  of the study day: what the group practises today moves it tomorrow.
- Phone B sees the plan live, edits a day, and phone A sees "שינוי אחרון:"
  with B's name.
- A marathon: "אני בפנים" on both phones shows both names; "להתחיל" then
  "הבלוק הבא" moves both phones once, even when both tap at once.

**"הקבוצה צריכה אותך"** (`NEEDS_ME`):
- Off by default: Today shows nothing of it. Phone A turns it on in "שלי" →
  הגדרות. Today then shows A's own meter ("עוד אין שאלה בשבילך" and how many
  more right answers, on which topic).
- When a question reaches A under "הקבוצה צריכה אותך", Today shows it there
  only, not a second time under "בקבוצה".
- Once A has 3 or more answers in a topic with 4 of 5 right, an open
  question by B on that topic (2 hours old or more) reaches A, "הגיעה אליך
  כי ענית נכון על …. גלוי רק לך.".

**The exam eve** (`EVE`):
- `?v=eve&l=` from a lecture (and from Today and the plan within two days of
  the exam): "הלילה שלפני · {lecture}", the summary slide or "לא נמצא
  בהרצאה שקף שמסכם אותה…", the member's associations, and their own "על
  בטוח" mistakes. Each empty part says what fills it.

**The blank table** (`BLANK_TABLE`):
- A lecture from PowerPoint with a table: its practice has "טבלה ריקה" with
  "N טבלאות בשקפים של ההרצאה". Fill a row with a wrong cell: "טעות בשורה …
  · נשמרת ככרטיס…" for a moment, then "נכנסה לכרטיסיות · רק לך", and the
  card is in the member's deck once.
- A PDF lecture: "בשקפים של ההרצאה הזו אין טבלה למילוי." and where the
  group's other tables are.

**A member's own trap** (`TRAPS`):
- A paragraph's sheet → "תרגול" → "להוסיף מלכודת משלי". Write it, choose a
  slide, "לבדוק מול השקפים · כ-$0.03". Passed: "המלכודת נכנסה לבנק של
  כולם. השם שלך יופיע אחרי שתישאל במבחן קבוצתי.".
- Phone B practises the lecture: the question shows "מלכודת של חבר בקבוצה",
  never A's name. After a group quiz asks it, its reveal shows "נכתבה ע״י
  {A} · נבדקה מול השקפים".
- The meter on A's card: "נשארו היום … מלכודות חדשות"; the 11th of a day
  waits for tomorrow.

**The ledger**, after the checks above:

```sql
select kind, count(*), round(sum(cost_usd), 3) as usd, count(*) filter (where settled_at is null) as open
  from public.study_usage
 where kind = 'trap_check' and created_at > now() - interval '1 hour'
 group by 1 order by 1;
```

`open` must be 0. Nothing else in this release calls Claude.

### 9. Tell the group

Ask each member to close the app and open it again (on an iPhone, swipe
the Home Screen app away), so no phone keeps release 4's code. Tell them:

- "היום" is the new home: what to do today, cut to the minutes they have.
- Progress, mistakes, the flame and Today's queue are theirs alone.
- The pulse counts the group's answers each night, without names, and shows
  a topic only where at least 3 of them practised. "לא לכלול אותי בדופק" is
  under "שלי" → הגדרות. One person on two phones counts as two members
  (decision 1).
- The extras start small and fill as the group practises. Each says what it
  is waiting for, and never who.
- "הקבוצה צריכה אותך" is off until each member turns it on.

## What the meters should show on a young group

On the first days, with six members who joined weeks ago and a few dozen
answers each, expect mostly meters. Every number comes from real counts, so
these are ranges, not promises:

| Screen | Likely on day one | What moves it |
|---|---|---|
| Progress | most parts "{n}/20"; the calibration ring "עוד N"; the danger list with a few rows | the member's own first answers of each day |
| Pulse | most lectures "עוד אדם אחד וזה נפתח" or "עוד 2 אנשים וזה נפתח"; a lecture all six practise may say "2 מתוך 5 נושאים פתוחים · עוד אדם אחד לנושא הבא" | 3 different members on a topic, counted at night |
| Museum | "אין עדיין מוצגים · עוד 3 הימורי ׳על בטוח׳ שגויים למוצג הבא" (or 2, or 1) | 3 members choosing the same wrong option "על בטוח" |
| Boss | "0 מתוך 8 נושאים חמים · עוד כ-12 תשובות לנושא הבא" and "הקרב נפתח משני נושאים חמים: עוד 2 נושאים." | hot topics from the pulse, then exhibits |
| Plan | "התוכנית מדייקת ככל שמתרגלים: 0 מתוך 12 הרצאות עם נתונים" and "עוד כ-14 תשובות ועוד אדם אחד להרצאה הבאה" | 20 answers by 3 members on a lecture, in the 28 days before today's study day (today's answers count tomorrow) |
| "הקבוצה צריכה אותך" | "עוד אין שאלה בשבילך" with "עוד כ-2 תשובות נכונות על {topic} לנושא הבא." | the member's own right answers on a topic |
| Own trap | "מלכודת שעוברת את הבדיקה נכנסת לבנק של כולם, בלי שם." (from the first draft of a day, also "נשארו היום 9 מלכודות חדשות.") | the member's own drafts |
| Blank table | "N טבלאות בשקפים של ההרצאה" on PowerPoint lectures | the slides themselves |
| Today's flame | "להבה 1/7" to "להבה 3/7" | the member's own active days |

If a group screen shows a number from fewer than 3 members, that is a bug:
stop the pulse (the switch, "Rolling back") and tell Claude.

To see the real counts behind the meters as one member would, in the SQL
Editor (it reads, then rolls back):

```sql
select id as group_id from public.study_groups;                 -- the one group
select user_id, joined_at from public.study_members order by joined_at;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<one member''s user_id>', true);
select public.study_pulse_meter('<group_id>');
select public.study_museum_meter('<group_id>');
select public.study_boss_open('<group_id>');
rollback;
```

## What to watch

In the SQL Editor, during the first days:

```sql
-- The pulse's nights: when each ran, and how many members it counted
select r.cutoff, cardinality(r.members) as counted from study_private.pulse_runs r;
-- Traps and exhibits, by state (never who)
select state, count(*), count(exhibit_no) as exhibits from public.study_traps group by 1 order by 1;
-- Boss battles and their outcomes
select outcome, count(*) from public.study_boss_battles group by 1;
-- Members' traps checked, passed and waiting
select state, count(*) from public.study_trap_drafts group by 1;
-- The month's spend by kind; "trap_check" is new
select kind, count(*), round(sum(cost_usd), 2) from public.study_usage
 where created_at >= date_trunc('month', now()) group by 1 order by 3 desc;
-- Reservations that never settled (a call died)
select kind, count(*) from public.study_usage
 where settled_at is null and created_at < now() - interval '15 minutes' and created_at >= date_trunc('month', now()) group by 1;
```

## Rolling back

Use the smallest rollback that fixes the problem.

- **The pulse and everything built on it.** No redeploy:

  ```sql
  update study_private.features set enabled = false, changed_at = now() where name = 'pulse';
  ```

  From that moment nothing is counted, and the pulse, the museum, the trap
  cards' chips and the boss's heads are hidden ("התכונה הזו כבויה כרגע
  בשרת."). The flags can stay. Set it back to `true` to turn it on again;
  the next read counts.
- **One feature.** Vercel → Environment Variables → delete its
  `VITE_STUDY_*` flag (or set it to `0`) → Redeploy.
  - Its entries disappear, and a link to its screen lands on its lecture
    (or the library) with "התכונה הזו עוד לא פתוחה.".
  - Its rows stay in the database for when it comes back: progress, plans
    and marathons, battles and loot, drafts and passed traps.
  - A passed member's trap stays in the bank as a question without its
    author, whatever the flags.
  - Turning `VITE_STUDY_TODAY` off brings back the library as the home.
    `NEEDS_ME` then shows nothing.
- **The whole release (last resort).** Vercel → Deployments → the last
  Production deployment before the merge → ⋯ → Promote to Production
  (instant rollback). Then turn the pulse's switch off (above), and ask the
  group to reopen the app.
  - Release 4's code works with this SQL. Every function, column and grant
    it uses is unchanged.
  - Leave the SQL as it is. Before this release is deployed again, nothing
    has to change in it.
- **Never run an older `study-schema.sql`** (from `main` before this
  release, from `study/wave4` or `study/wave3`, or from any `study/w5-*`
  branch). It would put back section Z's stubs for the boss's state, the
  reveal and the group's signal, so a battle would lose its hit points, a
  member's trap would never be named, and the quiz would stop asking the
  group's hard questions first. If it was run by mistake, run this
  release's file again.
- **Never** drop tables. Never run Supabase's sample clean-up of anonymous
  users: every member is an anonymous user (decision 1), and it would
  delete the group with its creator.

## What was tested (on `study/wave5`; local only)

No production, no real Supabase project and no real Anthropic call were
used, and no group was created anywhere real.

**The merge.** `study/wave5`'s first round (A2 and Q-2, U-1 and U-2, T-1
with C's review, on `study/wave4`) was already merged. On it, `study/w5-h`
(U-3 and H-1), `study/w5-g` (G, T-2 and the exam eve) and `study/w5-e` (E)
were merged in that order. The conflicts, and how each was resolved keeping
both sides:

- **`shared/study/flags.ts`**: the schema each flag needs has T at 2 with
  `NEEDS_ME` (G's) and U at 2 with the museum or the boss (H's), each only
  with its own flags.
- **The registry test** (`src/study/lib/route.test.ts`): it expects U 2,
  H 1, G 1, E 1 and T 2 beside wave 5's P 2. It keeps every package's flag
  checks, and adds wave 5 with every phase-3 extra on the SQL.
- **The e2e mock** (`e2e/study/mock.cjs`): the flag sets `h5`, `g` and `e5`
  all run against this branch's real SQL registry, and the new set `w5x` is
  `w5` with every phase-3 flag. The full stand-in schema has U 2 and T 2.
- **Today's mock** (`e2e/study/mocks/today.cjs`): it answers H's loot and
  T-2's rows together.
- **`docs/study/README.md`**: every package's line.
- **`e2e/study/schema-dump.json`**: written again by `npm run
  test:contract` from the merged SQL.
- **The SQL merged without a conflict.** Each package's lines sit between
  its own section's markers, in the file's order (F A W Q Z C K P M N V U J
  H B G E T).

**The review round, after the merge.** Seven findings were checked; all
seven were real and are fixed, each with a test that fails on the code
before it:

- **UI-1, the blank table:** a wrong row said "נכנסה לכרטיסיות" while the
  card was still being saved. It now says "נשמרת ככרטיס…" until the save
  lands, and the end counts only saved cards (`savedLabel()`, unit test;
  `extras.cjs` waits for the real save).
- **UI-2, the boss's bar:** the bar measured the heads against 4 under a
  line that counts the hot topics out of all topics. It now fills what the
  line says (3 of 8), or 2 of 3 counted below the floor, with the line as
  its label (`bossBar()`, unit test; `boss.cjs` measures the bar).
- **UI-3, Today:** one open question could show twice, under "בקבוצה" and
  under "הקבוצה צריכה אותך". Section T at 3 leaves it out of "בקבוצה"
  (check T4b2), and the screen drops it as well (`groupQuestion()`, unit
  test; `plan.cjs` checks it shows once).
- **UI-4, "0 ראשים" and "1 ראשים":** the chip now reads "ראש אחד", and
  shows nothing for none (`headsChip()`, unit test). The museum's "0" chip
  went the same way.
- **UI-5, a literal floor:** the museum's bar took the floor as a literal 3.
  It now uses `MUSEUM.FLOOR`, and `meters.test.ts` fails on any bar computed
  against a literal 3. The empty-state lines of the pulse and the boss now
  take the number from the constants too.
- **G-METER-PNOW (security):** `study_group_plan_meter` took any time from
  the caller and counted up to it, so a member could recover another
  member's answer times to the second. Section G at 2 drops that form. The
  meter counts up to the start of today's study day, as the pulse does
  (checks GS6b2, GS6b3).
- **H-BATTLE-ROW-READ (security):** any member could read a battle's whole
  row, including the heads (the pulse's hot topics and each head's trap)
  and the planned questions in order. Section H at 2 grants members only the
  plain columns (checks HB6c-HB6h).

`NEEDS_ME` now needs T 3, `BOSS` H 2 and `GROUP_PLAN` G 2. Production's
flags need what they needed on wave 4 (health asks for F 1, W 2, Q 2, C 2
and K 1), so step 1 changes nothing they read.

Each fix was checked against the code before it: `supabase/tests/study.sql`
of this branch, run on the SQL from before the review round, fails 13 checks
(HB0c, HB6c to HB6f, HB6h and H-reg: a member reads the heads, the planned
rounds and the log; GS6b2: an answer moves the plan meter within a second;
GS6b3, GS6d and GS-reg: the `p_now` form exists; T4b2 and T-reg: Today's
"בקבוצה" names the question "הקבוצה צריכה אותך" already shows). On this
branch it fails none. The unit tests (`savedLabel()`, `bossBar()`,
`headsChip()`, `groupNeedPct()`, `groupQuestion()` and the literal-floor
scan) name functions the code before the round did not have, and the scan
fails on the museum's old `(3 - meter.group_need) / 3`.

**Added at the merge: every meter's thresholds in one place.**
`shared/study/meters.ts` now holds them all:

- one `FLOOR` of 3, which the pulse, the museum, the boss's players and the
  plan's buckets all take;
- `PULSE`, `MUSEUM`, `BOSS`, `PLAN`, `NEEDS_ME`, `TRAPS`, `BLANK` and A2's
  minimums. Each package's module re-exports its own.

The words that state the floor ("מ-3 מתרגלים", "לפחות 3 מכם") are built
from it. `shared/study/meters.test.ts` fails if:

- any of the SQL's 25 threshold functions in sections U, H, G and T differs
  from its constant, or the SQL gains one the module does not name;
- the plan's meter, the boss's heads or the museum's meter take a literal
  floor, or show anything but the meter below it;
- another module defines a meter's constant again;
- the three meters Yoad approved stop coming out word for word from real
  counts.

| Test | Result |
|---|---|
| `npm run test:study` | 709 tests, 709 pass, 0 fail |
| `npm run test:contract` | 196 RPC calls and 116 table chains in 210 files match the schema (268 study functions, 72 study tables); 15 of the browser's written columns are granted to a member |
| `npm run build` | passes; the study entry 341.33 kB (limit 400 kB); in the e2e builds 341.36 kB with no flags, 341.43 kB with production's, 341.60 kB with wave 4's, 341.70 kB with `w5`, 341.91 kB with `w5x` |
| `npm run test:bundle` | the study entry 353,939 bytes with every flag on, 353,305 with every flag off (limit 400,000); no package screen in it. U's, G's, E's, T's and H's shares 5,932, 3,990, 2,373, 1,800 and 1,305 B; W's, C's and K's over the 8 kB guide, as before |
| The whole SQL loaded twice (stubs, board, `study-schema.sql` × 2) on a throwaway Postgres 16 | 0 errors; `supabase/tests/study.sql` exits 0 with 0 FAIL and 0 ERROR (4,646 lines of output, 969 of them "ok"); `{"B": 1, "C": 2, "E": 1, "F": 1, "G": 2, "H": 2, "J": 1, "K": 2, "M": 1, "N": 1, "P": 2, "Q": 2, "T": 3, "U": 2, "V": 1, "W": 2, "Z": 2}` |
| The upgrade from `study/wave4` (b8836aa): its `study-schema.sql` with its own checks (0 FAIL) and a member's data (a lecture, a part, two questions with keys and wrong answers, a card, a question comment, a meeting with a tap), then this file twice | 0 errors each time; the registry goes from `{"B": 1, "C": 2, "F": 1, "J": 1, "K": 2, "M": 1, "N": 1, "Q": 2, "V": 1, "W": 2, "Z": 2}` to the one above; all 47 rows of the 54 tables kept, every row equal on its own columns (16 tables with rows, 0 rows differing); 18 new tables, empty; the only new columns `study_questions.author_id` and `unmasked_at`, empty; `pulse` off, the night's job made. As that member: progress, Today (1 return, 1 danger, 1 "לא ברור", flame 2) and the pulse, museum and boss reads answer ("off" while the switch is off); a battle's plain columns read, its `heads` refused; the plan meter has the one form `(p_plan uuid)` |
| The upgrade from `study/wave3` (484b28a), the same way | 0 errors each time; from `{"C": 2, "F": 1, "K": 2, "N": 1, "Q": 2, "W": 2, "Z": 2}` to the one above; all 40 rows of the 36 tables kept, equal on their own columns; 36 new tables, empty |
| The upgrade from this branch before the review round (27da7f4: G 1, H 1, T 2), with its own checks, a member's data, a group plan and a boss battle, then this file twice | 0 errors each time; from G 1, H 1, T 2 to the registry above; the plan, the battle and the answers kept, equal on every column; one form of `study_group_plan_meter`, `(p_plan uuid)`; members granted only the battle's 11 plain columns |
| This branch's `supabase/tests/study.sql` on the SQL from before the review round | 13 FAIL, each a finding's check (above); on this SQL, 0 |
| The contract of release 4's code on this SQL | every function's arguments, every column and every member grant of the 211 functions and 54 tables in `study/wave4`'s schema dump is unchanged in this one; the only difference is two added columns on `study_questions` (`author_id`, `unmasked_at`) |
| Health's `schemaOk` (`healthSchema` of this code) | on this SQL: true with the flags off, production's, wave 4's, release 8's on production's, `w5` and `w5x`. On release 4's SQL: true with the flags off, production's and wave 4's; false with any of steps 5 and 7, hence step 1 first. On `main`'s SQL (W 1, C 1, K 1) false even with the flags off: releases 3 and 4 run first, as `RELEASE-3.md` and `RELEASE-4.md` say |
| `supabase/tests/quiz-concurrency.sh` | K1 to K3c as expected (six phones at once on one quiz, with the boss's hooks in place) |
| `supabase/tests/writing-concurrency.sh` | WK1 to WK4 as expected |

The e2e flows ran on a mocked Supabase, on the branch's final code, in five
builds:

- `off`: every flag off;
- `rel1`: production's flags (`QUESTIONS`, `PRACTICE`, `CARDS`);
- `w4`: wave 4's (release 2's four with `ANCHOR`, `CORRECTIONS`, `ASK`,
  `VAR`, `WALL`, `MEETING` and `GUESS`);
- `w5`: wave 4's with release 8's (`PROGRESS`, `CARDS_REVIEW`, `TODAY`,
  `PULSE`): step 5;
- `w5x`: `w5` with every phase-3 flag (`MUSEUM`, `BOSS`, `MARATHONS`,
  `GROUP_PLAN`, `NEEDS_ME`, `EVE`, `TRAPS`, `BLANK_TABLE`, and the unused
  `QUIZ_ROUNDS`): step 7.

In the `w4`, `w5` and `w5x` builds the release scripts (`practice`, `quiz`)
ran as `rel2`, `cards` as `rel2` on `w4` and as `review` (C's in-app
review) on `w5` and `w5x`, and `ahead` as `k`, as before. Every screenshot
was checked by `a11y.cjs` in light and dark at 390×844 and 360×640. All 105
runs exited 0, with no page error, no unmocked or refused call, and no
accessibility problem; three scripts ran in parallel. The cell's number is
the script's checks that read "ok"; `summary`, `together` and `collab`
check by waiting for each step instead. With a flag off, each package's
script checks that nothing of it shows and its links land safely.

| Script | off | rel1 | wave 4 | `w5` | `w5x` |
|---|---|---|---|---|---|
| `ahead.cjs` (B) | pass, 3 ok | pass, 11 ok | pass, 11 ok | pass, 11 ok | pass, 11 ok |
| `anchor.cjs` | pass, 3 ok | pass, 3 ok | pass, 18 ok | pass, 18 ok | pass, 18 ok |
| `cards.cjs` | pass, 2 ok | pass, 26 ok | pass, 26 ok | pass, 37 ok | pass, 37 ok |
| `collab.cjs` | pass | pass | pass | pass | pass |
| `meeting.cjs` (M) | pass, 4 ok | pass, 4 ok | pass, 53 ok | pass, 53 ok | pass, 53 ok |
| `practice.cjs` | pass, 3 ok | pass, 57 ok | pass, 57 ok | pass, 57 ok | pass, 57 ok |
| `quiz.cjs` | pass, 2 ok | pass, 2 ok | pass, 47 ok | pass, 47 ok | pass, 47 ok |
| `shell.cjs` | pass, 31 ok | pass, 30 ok | pass, 31 ok | pass, 31 ok | pass, 31 ok |
| `summary.cjs` | pass | pass | pass | pass | pass |
| `together.cjs` | pass | pass | pass | pass | pass |
| `upload.cjs` | pass, 5 ok | pass, 5 ok | pass, 5 ok | pass, 5 ok | pass, 5 ok |
| `var.cjs` (V) | pass, 4 ok | pass, 4 ok | pass, 37 ok | pass, 38 ok | pass, 38 ok |
| `wall.cjs` (J) | pass, 5 ok | pass, 5 ok | pass, 36 ok | pass, 36 ok | pass, 36 ok |
| `writing.cjs` | pass, 42 ok | pass, 42 ok | pass, 42 ok | pass, 42 ok | pass, 42 ok |
| `today.cjs` (T) | pass, 4 ok | pass, 4 ok | pass, 4 ok | pass, 54 ok | pass, 54 ok |
| `progress.cjs` (A2, Q-2) | pass, 5 ok | pass, 5 ok | pass, 5 ok | pass, 38 ok | pass, 38 ok |
| `pulse.cjs` (U) | pass, 4 ok | pass, 4 ok | pass, 5 ok | pass, 44 ok | pass, 44 ok |
| `museum.cjs` (U-3) | pass, 3 ok | pass, 3 ok | pass, 3 ok | pass, 3 ok | pass, 26 ok |
| `boss.cjs` (H) | pass, 3 ok | pass, 3 ok | pass, 3 ok | pass, 3 ok | pass, 40 ok |
| `plan.cjs` (G, T-2, eve) | pass, 5 ok | pass, 5 ok | pass, 5 ok | pass, 6 ok | pass, 69 ok |
| `extras.cjs` (E) | pass, 5 ok | pass, 5 ok | pass, 5 ok | pass, 5 ok | pass, 42 ok |

After the review round the whole matrix ran again on the final code. In it,
`cards.cjs` failed once on `w5` and once on `w5x` (check 6: the slide "12"
landed in the cloze's sentence). The cause was the script, not the app: the
card sheet puts the caret back in the sentence on the next animation frame
after "סימון החלק להשלמה", and with three lanes at once that frame came
after the script had focused the slides field. The script now waits for
the caret first (a233524); `cards.cjs` then passed on all five builds, and
five runs at once on `w5x` passed too. `extras.cjs` on `w5x` (review UI-1)
passed in the matrix and in four runs at once.

A young group (two members, a few answers, on the `w5x` build): every
phase-3 screen opens with what there is and its meter, with no
accessibility problem in light and dark at 390×844 and 360×640. The boss's
bar is 2/3 under "הבוס נבנה מ-3 מתרגלים: עוד אדם אחד וזה נפתח.", with no
heads chip; the museum shows no "0" chip; the plan says "התוכנית מדייקת ככל
שמתרגלים: 0 מתוך 1 הרצאות עם נתונים" and "עוד כ-12 תשובות ועוד אדם אחד
להרצאה הבאה"; Today's "הקבוצה צריכה אותך" says "עוד אין שאלה בשבילך" and
"עוד כ-2 תשובות נכונות על Loop diuretics לנושא הבא."

Known gaps:

- Only production can show some things:
  - the first live answers of `trap_check`, and their real cost against the
    ledger;
  - the pulse's night on pg_cron, and a night that counts real answers;
  - two or three real phones on one boss battle, a plan edited live, and a
    museum exhibit the day after three real "על בטוח" bets.
- The museum's plaque by Claude (op `plaque`) and the boss HUD's narrated
  attacks are not built. The museum shows the exhibit's own text, and the
  privacy note does not say that a plaque is sent to Anthropic.
- The plan's per-topic time within a day (PL6's last part) and the
  recordings' exam marks in the plan (REC4 on the phone) are not built. Their
  SQL is in, and checked.
- With two phones, the museum, the boss and the pulse's words need a third
  member (the floor of 3). The e2e runs had five to seven members.
