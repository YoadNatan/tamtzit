# תמצית, C's end: the deck part by part, private cards, trap cards

C's end is package C's second half (addendum §12.3.C, mockup
`proposal/mockups/cards.html`), on the branch `study/w3-c`, on top of `main`
(release 2: the deck, browsing and the Anki export are live with
`VITE_STUDY_CARDS`). Section C goes to version 2. This page is Yoad's
production steps, in order. Details: [`cards.md`](cards.md), "C's end".

## What is in it

With production's flags as they are (no flag changes):

- **The deck page as approved** (cards.html s3): "54 כרטיסים · 8 חלקים ·
  נוצרו פעם אחת לכל הקבוצה", the ring of your own deck, a row per part with
  "להוסיף" or "7 בחפיסה ✓" (a part's name opens its cards), "להוסיף את כל
  החלקים", "להוציא מהחפיסה שלי", the group's latest fix ("תוקן לכולם" with
  "לבטל"), the deck's name in Anki, and "ייצוא ל-Anki · .apkg" in the
  bottom bar.
- **Decision 8: your deck, part by part.** Nothing is in anyone's deck until
  they add it. The export offers "החפיסה שלך" (the parts you added, trap
  cards, cards you wrote) first and "כל החפיסה" second.
- **"מאיפה זה?"**: an open card shows the paragraph it came from and
  "לפסקה" opens the reader there. New cards are placed on their paragraph
  by the server (the op "cards" sends the part paragraph by paragraph).
- **C7**: the writer names the drug in the front ("Chloroquine: מה ה-t½
  הסופי?"); a card that hides it is rejected.
- **Trap cards**: when 3 or more players choose the same wrong option in a
  group quiz, that option becomes a group card ("מלכודת של הקבוצה"), closed
  until the next study day (04:00). Nobody makes one by hand.
- **Marks after a correction**: a card a correction marks says "בבדיקה אחרי
  תיקון בפסקה" with "עדיין נכון" (section V marks cards; until V ships
  nothing marks one).
- **Private cards from your own mistakes** are written by the database on
  every wrong practice or quiz answer, owner-only, never published. They are
  shown, reviewed and exported only with in-app review.
- **The worker path**: the card functions accept the server key alone, for
  section B's batch writer (not built yet).

Built and off (`VITE_STUDY_CARDS_REVIEW` stays off until accounts):
review sessions in the approved look (cards.html s1, s2), private cards in
them first among the new with their origin, "הבא בתור · מטעות שלך", the
review home asked once ("איפה חוזרים על הכרטיסים?", also in the cards'
settings and under "שלי"), and with Anki as the home nothing waits for
review in the app.

## The steps, in order

### 1. Supabase: run the SQL, before the merge

SQL Editor → paste **the whole** `supabase/study-schema.sql` **from the
branch `study/w3-c`** → Run. The file can be run again safely; NOTICEs like
"… already exists, skipping" are harmless. Never create a group.

```sql
select public.study_schema();
```

It must answer `{"C": 2, "F": 1, "K": 1, "Q": 2, "W": 1, "Z": 2}` (only C
changes, from 1 to 2; if W2 was merged first, W is 2).

Check the new private tables (both lines must say `3` and `0`):

```sql
select count(*) filter (where relrowsecurity) as rls_on from pg_class
 where relname in ('study_card_adoptions', 'study_my_cards', 'study_my_card_reviews') and relnamespace = 'public'::regnamespace;
select count(*) as published from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename in ('study_card_adoptions', 'study_my_cards', 'study_my_card_reviews');
```

### 2. Merge `study/w3-c` into `main` and let Vercel deploy

No Vercel variable changes. `VITE_STUDY_CARDS_REVIEW` stays off.

### 3. Check

- `https://<site>/api/study/health` → `"schemaOk": true`. (Before step 1
  it would say `false` and the op "cards" would answer 503 "schema": the
  cards need section C at 2.)
- On a phone: a lecture's "כרטיסיות" shows the deck page with the ring at
  0; "להוסיף" on a part turns it into "{x} בחפיסה ✓"; "ייצוא ל-Anki"
  offers "החפיסה שלך" and "כל החפיסה"; an open card shows "מאיפה זה?" (on
  cards written after the merge).

## Rollback

Revert the merge on `main`. The SQL stays: section C at 2 serves release 2's
screens too (they read and write the same rows; the new columns and tables
are simply unused).
